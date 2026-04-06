"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { fetchAreas, fetchBacklog, getDevUserId, patchTask, type AreaRow, type TaskRow } from "@/lib/api";
import { SkeletonListItem } from "@/lib/skeleton";
import { cn } from "@/lib/utils";

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500/20 text-red-300",
  high: "bg-orange-500/20 text-orange-300",
  normal: "bg-zinc-500/20 text-zinc-300",
  low: "bg-zinc-700/20 text-zinc-500",
};

type AreaFilter = "all" | "work" | "personal";

export default function BacklogPage() {
  const userId = getDevUserId();
  const qc = useQueryClient();
  const [areaFilter, setAreaFilter] = useState<AreaFilter>("all");

  const areasQ = useQuery({
    queryKey: ["areas", userId],
    queryFn: () => fetchAreas(userId),
    enabled: Boolean(userId),
  });

  const q = useQuery({
    queryKey: ["backlog", userId],
    queryFn: () => fetchBacklog(userId),
    enabled: Boolean(userId),
  });

  const moveArea = useMutation({
    mutationFn: ({ taskId, areaId }: { taskId: string; areaId: string }) => patchTask(taskId, { areaId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["backlog", userId] });
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!userId) return <p className="text-muted">Set NEXT_PUBLIC_DEV_USER_ID</p>;

  const areaMap = new Map<string, AreaRow>();
  for (const a of areasQ.data ?? []) areaMap.set(a.id, a);

  // Group tasks by area
  const grouped = new Map<string, TaskRow[]>();
  for (const t of q.data ?? []) {
    const aid = t.areaId;
    if (!grouped.has(aid)) grouped.set(aid, []);
    grouped.get(aid)!.push(t);
  }

  function matchesAreaFilter(area: AreaRow | undefined): boolean {
    if (areaFilter === "all") return true;
    const n = (area?.name ?? "").toLowerCase();
    if (areaFilter === "work") return n.includes("work");
    return n.includes("personal");
  }

  const filteredGroups = Array.from(grouped.entries()).filter(([areaId]) =>
    matchesAreaFilter(areaMap.get(areaId))
  );

  return (
    <div>
      <h1 className="font-display text-2xl text-foreground">Backlog</h1>
      <p className="mt-1 text-sm text-muted">
        Tasks without a sprint — {q.data?.length ?? 0} total.
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(["all", "work", "personal"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setAreaFilter(key)}
            className={cn(
              "rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
              areaFilter === key
                ? "bg-primary text-white"
                : "bg-white/5 text-muted hover:bg-white/10 hover:text-foreground"
            )}
          >
            {key === "all" ? "All areas" : key === "work" ? "Work" : "Personal"}
          </button>
        ))}
      </div>

      {q.isLoading && (
        <div className="mt-4 space-y-2">
          <SkeletonListItem />
          <SkeletonListItem />
          <SkeletonListItem />
        </div>
      )}

      <div className="mt-4 space-y-6">
        {filteredGroups.map(([areaId, tasks]) => {
          const area = areaMap.get(areaId);
          return (
            <div key={areaId}>
              <div className="flex items-center gap-2 mb-2">
                {area?.color && (
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: area.color }}
                  />
                )}
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {area?.name ?? "Unknown area"}
                </h2>
                <span className="text-[10px] text-muted/60">{tasks.length}</span>
              </div>
              <ul className="space-y-1.5 stagger-list">
                {tasks.map((t) => (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-surface px-3 py-2.5 text-sm text-foreground card-hover"
                  >
                    <span className="min-w-0 flex-1">{t.title}</span>
                    <select
                      className="max-w-[140px] rounded-md border border-white/10 bg-background px-2 py-1 text-[11px] text-muted"
                      value={t.areaId}
                      disabled={moveArea.isPending}
                      onChange={(e) =>
                        moveArea.mutate({ taskId: t.id, areaId: e.target.value })
                      }
                      aria-label="Category / area"
                    >
                      {(areasQ.data ?? []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <span
                      className={cn(
                        "inline-block rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider",
                        PRIORITY_COLORS[t.priority] ?? PRIORITY_COLORS.normal
                      )}
                    >
                      {t.priority}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {!q.isLoading &&
        (q.data?.length ?? 0) > 0 &&
        filteredGroups.length === 0 && (
          <p className="mt-6 text-center text-sm text-muted">No tasks in this category filter.</p>
        )}

      {!q.isLoading && (q.data?.length ?? 0) === 0 && (
        <div className="mt-12 flex flex-col items-center text-center">
          <Inbox size={32} className="text-primary/40 mb-3" />
          <p className="text-muted text-sm">Empty backlog.</p>
          <p className="text-muted/60 text-xs mt-1">
            <Link href="/board" className="text-primary hover:underline">Board</Link> or brain dump (Ctrl/Cmd+Shift+D).
          </p>
        </div>
      )}
    </div>
  );
}
