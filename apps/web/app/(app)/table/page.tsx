"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { deleteTask, fetchTasks, patchTask, postBulkStatus } from "@/lib/api";
import { SkeletonRow } from "@/lib/skeleton";
import { normalizeYmd } from "@/lib/timeline-utils";
import { displayPhysicalEnergy, displayWorkDepth } from "@/lib/utils";
import { TaskTableRow } from "@/components/TaskTableRow";

type SortKey =
  | "title"
  | "status"
  | "priority"
  | "energyLevel"
  | "workDepth"
  | "physicalEnergy"
  | "dueDate";
type SortDir = "asc" | "desc";

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
// Cognitive load rank: deep_work = most demanding → shown first ascending
const COGNITIVE_ORDER: Record<string, number> = { deep_work: 0, shallow: 1, admin: 2, quick_win: 3 };

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
  const [sortKey, setSortKey] = useState<SortKey>("dueDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const q = useQuery({
    queryKey: ["tasks", userId],
    queryFn: () => fetchTasks(),
    enabled: Boolean(userId),
  });

  const roots = useMemo(() => {
    const items = q.data ?? [];
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
          cmp = (COGNITIVE_ORDER[a.energyLevel] ?? 99) - (COGNITIVE_ORDER[b.energyLevel] ?? 99);
          break;
        case "workDepth":
          cmp = displayWorkDepth(a).localeCompare(displayWorkDepth(b));
          break;
        case "physicalEnergy":
          cmp = displayPhysicalEnergy(a).localeCompare(displayPhysicalEnergy(b));
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

  return (
    <div>
      <h1 className="font-display text-2xl text-foreground">Task table</h1>
      <div className="mt-4 flex items-center min-h-[36px]">
        {selCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-primary/10 border border-primary/20 px-3 py-1.5 animate-fadeIn">
            <span className="text-xs font-semibold text-primary">{selCount} selected</span>
            <div className="h-4 w-[1px] bg-primary/20 mx-1" />
            <button
              type="button"
              className="text-[11px] font-medium text-foreground hover:text-white transition-colors disabled:opacity-40"
              disabled={bulk.isPending}
              onClick={() => bulk.mutate("done")}
            >
              Mark done
            </button>
            <div className="h-3 w-[1px] bg-primary/20" />
            <button
              type="button"
              className="text-[11px] font-medium text-foreground hover:text-white transition-colors disabled:opacity-40"
              disabled={bulk.isPending}
              onClick={() => bulk.mutate("todo")}
            >
              Mark todo
            </button>
            <div className="h-3 w-[1px] bg-primary/20" />
            <button
              type="button"
              className="text-[11px] font-medium text-danger hover:text-red-400 transition-colors disabled:opacity-40"
              disabled={bulk.isPending}
              onClick={() => {
                if (!confirm(`Delete ${selCount} tasks?`)) return;
                const ids = Object.entries(sel).filter(([, v]) => v).map(([k]) => k);
                if (!ids.length) return;
                // Run deletes sequentially
                Promise.all(ids.map(id => deleteTask(id))).then(() => {
                  toast.success(`Deleted ${selCount} tasks`);
                  setSel({});
                  void qc.invalidateQueries({ queryKey: ["tasks", userId] });
                }).catch((e: Error) => toast.error(e.message));
              }}
            >
              Delete
            </button>
          </div>
        )}
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
              <th
                className="cursor-pointer select-none p-2 transition-colors hover:text-foreground"
                title="Cognitive load required: shallow (minimal focus), admin (routine), deep work (high focus)."
                onClick={() => toggleSort("energyLevel")}
              >
                <span className="inline-flex items-center gap-1">
                  Cognitive
                  {sortKey === "energyLevel" &&
                    (sortDir === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
                </span>
              </th>
              <SortHeader field="dueDate" label="Due" />
              <th className="p-2 text-[10px] uppercase text-muted">Scheduled (next sub)</th>
              <th className="p-2 text-[10px] uppercase text-muted">Tags</th>
              <th className="p-2 text-[10px] uppercase text-muted">Timer</th>
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
              <TaskTableRow 
                key={t.id} 
                task={t} 
                index={i} 
                userId={userId} 
                todayYmd={todayYmd} 
                selected={Boolean(sel[t.id])} 
                onSelectToggle={(checked) => setSel((s) => ({ ...s, [t.id]: checked }))} 
              />
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
