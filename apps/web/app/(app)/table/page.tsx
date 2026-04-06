"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { deleteTask, fetchTasks, getDevUserId, patchTask, postBulkStatus, type TaskRow } from "@/lib/api";
import { SkeletonRow } from "@/lib/skeleton";
import { StatusDot } from "@/components/task-card";
import { cn } from "@/lib/utils";

const STATUS_CYCLE: Record<string, string> = {
  backlog: "todo",
  todo: "in_progress",
  in_progress: "done",
  done: "backlog",
};

type SortKey = "title" | "status" | "priority" | "energyLevel" | "scheduledDate";
type SortDir = "asc" | "desc";

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export default function TablePage() {
  const userId = getDevUserId();
  const qc = useQueryClient();
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [editCell, setEditCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  const q = useQuery({
    queryKey: ["tasks", userId, "table"],
    queryFn: () => fetchTasks(userId),
    enabled: Boolean(userId),
  });

  const roots = useMemo(() => {
    const items = (q.data ?? []).filter((t) => !t.parentTaskId);
    return items.sort((a, b) => {
      let cmp = 0;
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
        case "scheduledDate":
          cmp = (a.scheduledDate ?? "").localeCompare(b.scheduledDate ?? "");
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
    mutationFn: ({ id, field, value }: { id: string; field: string; value: string }) =>
      patchTask(id, { [field]: value }),
    onSuccess: () => {
      setEditCell(null);
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteTask(id, userId),
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
      return postBulkStatus(userId, ids, status);
    },
    onSuccess: (r) => {
      toast.success(`Updated ${r.updated} tasks`);
      setSel({});
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!userId) return <p className="text-muted">Set NEXT_PUBLIC_DEV_USER_ID</p>;

  const selCount = Object.values(sel).filter(Boolean).length;

  function SortHeader({ field, label }: { field: SortKey; label: string }) {
    const active = sortKey === field;
    return (
      <th
        className="p-2 cursor-pointer select-none hover:text-foreground transition-colors"
        onClick={() => toggleSort(field)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {active && (sortDir === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
        </span>
      </th>
    );
  }

  return (
    <div>
      <h1 className="font-display text-2xl text-foreground">Task table</h1>
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          className="rounded-lg bg-white/10 px-3 py-1.5 text-xs hover:bg-white/15 transition-colors disabled:opacity-40"
          disabled={selCount === 0}
          onClick={() => bulk.mutate("done")}
        >
          Mark {selCount > 0 ? selCount : ""} done
        </button>
        <button
          type="button"
          className="rounded-lg bg-white/10 px-3 py-1.5 text-xs hover:bg-white/15 transition-colors disabled:opacity-40"
          disabled={selCount === 0}
          onClick={() => bulk.mutate("todo")}
        >
          Mark {selCount > 0 ? selCount : ""} todo
        </button>
        {selCount > 0 && (
          <span className="text-[10px] text-muted">{selCount} selected</span>
        )}
      </div>
      <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/10 bg-surface text-[10px] uppercase tracking-wider text-muted">
            <tr>
              <th className="p-2 w-8">
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
              <th className="p-2 w-4" />
              <SortHeader field="title" label="Title" />
              <SortHeader field="status" label="Status" />
              <SortHeader field="priority" label="Priority" />
              <SortHeader field="energyLevel" label="Energy" />
              <SortHeader field="scheduledDate" label="Scheduled" />
              <th className="p-2 w-10 text-right text-[10px] uppercase text-muted"> </th>
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
                  "border-b border-white/5 hover:bg-white/[0.03] transition-colors",
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
                  className="p-2 text-foreground cursor-pointer"
                  onDoubleClick={() => {
                    setEditCell({ id: t.id, field: "title" });
                    setEditValue(t.title);
                  }}
                >
                  {editCell?.id === t.id && editCell.field === "title" ? (
                    <input
                      autoFocus
                      className="w-full rounded border border-primary/50 bg-background px-1 py-0.5 text-sm"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") inlineEdit.mutate({ id: t.id, field: "title", value: editValue });
                        if (e.key === "Escape") setEditCell(null);
                      }}
                      onBlur={() => setEditCell(null)}
                    />
                  ) : (
                    <span className={cn(t.status === "done" && "line-through opacity-60")}>{t.title}</span>
                  )}
                </td>
                <td className="p-2 text-muted text-xs capitalize">{t.status.replace("_", " ")}</td>
                <td className="p-2 text-muted text-xs capitalize">{t.priority}</td>
                <td className="p-2 text-muted text-xs">{t.energyLevel.replace("_", " ")}</td>
                <td className="p-2 text-muted text-xs">{t.scheduledDate ?? "—"}</td>
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
