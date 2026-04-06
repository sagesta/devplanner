"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { deleteTask, fetchTasks, patchTask, postBulkStatus, type TaskRow } from "@/lib/api";
import { SkeletonRow } from "@/lib/skeleton";
import { StatusDot } from "@/components/task-card";
import { normalizeYmd } from "@/lib/timeline-utils";
import { cn, displayPhysicalEnergy, displayWorkDepth, isTaskOverdue } from "@/lib/utils";

const STATUS_CYCLE: Record<string, string> = {
  backlog: "todo",
  todo: "in_progress",
  in_progress: "done",
  done: "backlog",
};

type SortKey =
  | "title"
  | "status"
  | "priority"
  | "energyLevel"
  | "workDepth"
  | "physicalEnergy"
  | "scheduledDate"
  | "dueDate";
type SortDir = "asc" | "desc";

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function localISODate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function TablePage() {
  const { status } = useSession();
  const userId = useAppUserId();
  const qc = useQueryClient();
  const todayYmd = localISODate();
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [sortKey, setSortKey] = useState<SortKey>("scheduledDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [editCell, setEditCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  const q = useQuery({
    queryKey: ["tasks", userId, "table"],
    queryFn: () => fetchTasks(),
    enabled: Boolean(userId),
  });

  const roots = useMemo(() => {
    const items = (q.data ?? []).filter((t) => !t.parentTaskId);
    return items.sort((a, b) => {
      let cmp = 0;
      const dateCmp = (x: string | null | undefined, y: string | null | undefined) => {
        const xs = normalizeYmd(x) ?? "";
        const ys = normalizeYmd(y) ?? "";
        if (!xs && !ys) return 0;
        if (!xs) return 1;
        if (!ys) return -1;
        return xs.localeCompare(ys);
      };
      switch (sortKey) {
        case "title":
          cmp = a.title.localeCompare(b.title);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "priority":
          cmp = (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2);
          break;
        case "energyLevel":
          cmp = a.energyLevel.localeCompare(b.energyLevel);
          break;
        case "workDepth":
          cmp = displayWorkDepth(a).localeCompare(displayWorkDepth(b));
          break;
        case "physicalEnergy":
          cmp = displayPhysicalEnergy(a).localeCompare(displayPhysicalEnergy(b));
          break;
        case "scheduledDate":
          cmp = dateCmp(a.scheduledDate, b.scheduledDate);
          break;
        case "dueDate":
          cmp = dateCmp(a.dueDate, b.dueDate);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [q.data, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => patchTask(id, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tasks", userId] }),
  });

  const inlineEdit = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: unknown }) => {
      const body: Record<string, unknown> = { [field]: value };
      return patchTask(id, body);
    },
    onSuccess: () => {
      setEditCell(null);
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function commitEdit(id: string, field: string, raw: string) {
    let value: unknown = raw;
    if (field === "scheduledDate" || field === "dueDate") {
      value = raw.trim() === "" ? null : raw.trim();
    }
    if (field === "title") value = raw.trim();
    inlineEdit.mutate({ id, field, value });
  }

  const del = useMutation({
    mutationFn: (id: string) => deleteTask(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      void qc.invalidateQueries({ queryKey: ["tasks-today"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulk = useMutation({
    mutationFn: async (status: "done" | "todo") => {
      const ids = Object.entries(sel).filter(([, v]) => v).map(([k]) => k);
      if (!ids.length) return { updated: 0 };
      return postBulkStatus(ids, status);
    },
    onSuccess: (r) => {
      toast.success(`Updated ${r.updated} tasks`);
      setSel({});
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (status === "loading") {
    return (
      <div className="space-y-2">
        <SkeletonRow />
        <SkeletonRow />
      </div>
    );
  }
  if (!userId) return null;

  const selCount = Object.values(sel).filter(Boolean).length;

  function SortHeader({ field, label }: { field: SortKey; label: string }) {
    const active = sortKey === field;
    return (
      <th
        className="cursor-pointer select-none p-2 transition-colors hover:text-foreground"
        onClick={() => toggleSort(field)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {active && (sortDir === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
        </span>
      </th>
    );
  }

  function startEdit(t: TaskRow, field: string, current: string) {
    setEditCell({ id: t.id, field });
    setEditValue(current);
  }

  return (
    <div>
      <h1 className="font-display text-2xl text-foreground">Task table</h1>
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          className="rounded-lg bg-white/10 px-3 py-1.5 text-xs transition-colors hover:bg-white/15 disabled:opacity-40"
          disabled={selCount === 0}
          onClick={() => bulk.mutate("done")}
        >
          Mark {selCount > 0 ? selCount : ""} done
        </button>
        <button
          type="button"
          className="rounded-lg bg-white/10 px-3 py-1.5 text-xs transition-colors hover:bg-white/15 disabled:opacity-40"
          disabled={selCount === 0}
          onClick={() => bulk.mutate("todo")}
        >
          Mark {selCount > 0 ? selCount : ""} todo
        </button>
        {selCount > 0 && <span className="text-[10px] text-muted">{selCount} selected</span>}
      </div>
      <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="border-b border-white/10 bg-surface text-[10px] uppercase tracking-wider text-muted">
            <tr>
              <th className="w-8 p-2">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={selCount === roots.length && roots.length > 0}
                  onChange={(e) => {
                    const all: Record<string, boolean> = {};
                    if (e.target.checked) for (const t of roots) all[t.id] = true;
                    setSel(all);
                  }}
                />
              </th>
              <th className="w-4 p-2" />
              <SortHeader field="title" label="Title" />
              <SortHeader field="status" label="Status" />
              <SortHeader field="priority" label="Priority" />
              <SortHeader field="physicalEnergy" label="Energy" />
              <SortHeader field="workDepth" label="Depth" />
              <SortHeader field="energyLevel" label="Cognitive" />
              <SortHeader field="scheduledDate" label="Scheduled" />
              <SortHeader field="dueDate" label="Due" />
              <th className="w-10 p-2 text-right text-[10px] uppercase text-muted"> </th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            )}
            {roots.map((t, i) => (
              <tr
                key={t.id}
                className={cn(
                  "border-b border-white/5 transition-colors hover:bg-white/[0.03]",
                  i % 2 === 1 && "bg-white/[0.01]"
                )}
              >
                <td className="p-2">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={Boolean(sel[t.id])}
                    onChange={(e) => setSel((s) => ({ ...s, [t.id]: e.target.checked }))}
                  />
                </td>
                <td className="p-2">
                  <StatusDot
                    status={t.status}
                    onClick={() => {
                      const next = STATUS_CYCLE[t.status] ?? "todo";
                      statusMut.mutate({ id: t.id, status: next });
                    }}
                  />
                </td>
                <td
                  className="cursor-pointer p-2 text-foreground"
                  onClick={() => startEdit(t, "title", t.title)}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    {isTaskOverdue(t, todayYmd) && (
                      <span className="rounded-full bg-red-500/20 px-1.5 py-0.5 text-[8px] font-semibold uppercase text-red-200">
                        Overdue
                      </span>
                    )}
                    {editCell?.id === t.id && editCell.field === "title" ? (
                      <input
                        autoFocus
                        className="w-full min-w-[120px] rounded border border-primary/50 bg-background px-1 py-0.5 text-sm"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit(t.id, "title", editValue);
                          if (e.key === "Escape") setEditCell(null);
                        }}
                        onBlur={() => {
                          if (editCell?.id === t.id && editCell.field === "title") {
                            if (editValue.trim() && editValue !== t.title) commitEdit(t.id, "title", editValue);
                            else setEditCell(null);
                          }
                        }}
                      />
                    ) : (
                      <span className={cn(t.status === "done" && "line-through opacity-60")}>{t.title}</span>
                    )}
                  </div>
                </td>
                <td
                  className="cursor-pointer p-2 text-xs capitalize text-muted"
                  onClick={() => startEdit(t, "status", t.status)}
                >
                  {editCell?.id === t.id && editCell.field === "status" ? (
                    <select
                      autoFocus
                      className="w-full rounded border border-primary/50 bg-background px-1 py-0.5 text-xs"
                      value={editValue}
                      onChange={(e) => {
                        setEditValue(e.target.value);
                        inlineEdit.mutate({ id: t.id, field: "status", value: e.target.value });
                      }}
                      onBlur={() => setEditCell(null)}
                    >
                      {(["backlog", "todo", "in_progress", "done", "blocked", "cancelled"] as const).map((s) => (
                        <option key={s} value={s}>
                          {s.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                  ) : (
                    t.status.replace("_", " ")
                  )}
                </td>
                <td
                  className="cursor-pointer p-2 text-xs capitalize text-muted"
                  onClick={() => startEdit(t, "priority", t.priority)}
                >
                  {editCell?.id === t.id && editCell.field === "priority" ? (
                    <select
                      autoFocus
                      className="w-full rounded border border-primary/50 bg-background px-1 py-0.5 text-xs capitalize"
                      value={editValue}
                      onChange={(e) => {
                        inlineEdit.mutate({ id: t.id, field: "priority", value: e.target.value });
                      }}
                      onBlur={() => setEditCell(null)}
                    >
                      {(["urgent", "high", "normal", "low"] as const).map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  ) : (
                    t.priority
                  )}
                </td>
                <td
                  className="cursor-pointer p-2 text-xs text-muted"
                  onClick={() => startEdit(t, "physicalEnergy", t.physicalEnergy ?? "medium")}
                >
                  {editCell?.id === t.id && editCell.field === "physicalEnergy" ? (
                    <select
                      autoFocus
                      className="w-full rounded border border-primary/50 bg-background px-1 py-0.5 text-xs"
                      value={editValue}
                      onChange={(e) => {
                        inlineEdit.mutate({ id: t.id, field: "physicalEnergy", value: e.target.value });
                      }}
                      onBlur={() => setEditCell(null)}
                    >
                      {(["low", "medium", "high"] as const).map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  ) : (
                    displayPhysicalEnergy(t)
                  )}
                </td>
                <td
                  className="cursor-pointer p-2 text-xs text-muted"
                  onClick={() => startEdit(t, "workDepth", t.workDepth ?? "normal")}
                >
                  {editCell?.id === t.id && editCell.field === "workDepth" ? (
                    <select
                      autoFocus
                      className="w-full rounded border border-primary/50 bg-background px-1 py-0.5 text-xs capitalize"
                      value={editValue}
                      onChange={(e) => {
                        inlineEdit.mutate({ id: t.id, field: "workDepth", value: e.target.value });
                      }}
                      onBlur={() => setEditCell(null)}
                    >
                      {(["shallow", "normal", "deep"] as const).map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  ) : (
                    displayWorkDepth(t)
                  )}
                </td>
                <td
                  className="cursor-pointer p-2 text-xs text-muted"
                  onClick={() => startEdit(t, "energyLevel", t.energyLevel)}
                >
                  {editCell?.id === t.id && editCell.field === "energyLevel" ? (
                    <select
                      autoFocus
                      className="w-full rounded border border-primary/50 bg-background px-1 py-0.5 text-xs"
                      value={editValue}
                      onChange={(e) => {
                        inlineEdit.mutate({ id: t.id, field: "energyLevel", value: e.target.value });
                      }}
                      onBlur={() => setEditCell(null)}
                    >
                      {(["deep_work", "shallow", "admin", "quick_win"] as const).map((p) => (
                        <option key={p} value={p}>
                          {p.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                  ) : (
                    t.energyLevel.replace("_", " ")
                  )}
                </td>
                <td
                  className="cursor-pointer p-2 text-xs text-muted"
                  onClick={() => startEdit(t, "scheduledDate", normalizeYmd(t.scheduledDate) ?? "")}
                >
                  {editCell?.id === t.id && editCell.field === "scheduledDate" ? (
                    <input
                      type="date"
                      autoFocus
                      className="w-full rounded border border-primary/50 bg-background px-1 py-0.5 text-xs"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit(t.id, "scheduledDate", editValue);
                        if (e.key === "Escape") setEditCell(null);
                      }}
                      onBlur={() => {
                        const v = editValue.trim();
                        const prev = normalizeYmd(t.scheduledDate) ?? "";
                        if (v !== prev) commitEdit(t.id, "scheduledDate", v);
                        else setEditCell(null);
                      }}
                    />
                  ) : (
                    normalizeYmd(t.scheduledDate) ?? "—"
                  )}
                </td>
                <td
                  className="cursor-pointer p-2 text-xs text-muted"
                  onClick={() => startEdit(t, "dueDate", normalizeYmd(t.dueDate) ?? "")}
                >
                  {editCell?.id === t.id && editCell.field === "dueDate" ? (
                    <input
                      type="date"
                      autoFocus
                      className="w-full rounded border border-primary/50 bg-background px-1 py-0.5 text-xs"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit(t.id, "dueDate", editValue);
                        if (e.key === "Escape") setEditCell(null);
                      }}
                      onBlur={() => {
                        const v = editValue.trim();
                        const prev = normalizeYmd(t.dueDate) ?? "";
                        if (v !== prev) commitEdit(t.id, "dueDate", v);
                        else setEditCell(null);
                      }}
                    />
                  ) : (
                    normalizeYmd(t.dueDate) ?? "—"
                  )}
                </td>
                <td className="p-2 text-right">
                  <button
                    type="button"
                    className="rounded p-1 text-muted hover:bg-red-500/15 hover:text-red-300"
                    title="Delete task"
                    disabled={del.isPending}
                    onClick={() => {
                      if (!confirm(`Delete “${t.title}”?`)) return;
                      del.mutate(t.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!q.isLoading && roots.length === 0 && (
        <p className="mt-6 text-center text-sm text-muted">
          No tasks yet. Add some from the{" "}
          <a href="/board" className="text-primary hover:underline">
            Board
          </a>{" "}
          or Brain dump.
        </p>
      )}
    </div>
  );
}
