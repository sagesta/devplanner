"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { ChevronDown, ChevronRight, Inbox, CheckCircle2, Trash2, Plus, Circle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import {
  fetchAreas,
  fetchBacklog,
  fetchSprints,
  patchTask,
  createSubtask,
  patchSubtask,
  deleteSubtask,
  type AreaRow,
  type TaskRow,
  type SubtaskRow,
} from "@/lib/api";
import { SkeletonListItem } from "@/lib/skeleton";
import { cn, displayPhysicalEnergy, displayWorkDepth, isTaskOverdue } from "@/lib/utils";
import { TagChip } from "@/components/TagChip";
import { TimerButton } from "@/components/TimerButton";

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500/20 text-red-300",
  high: "bg-orange-500/20 text-orange-300",
  normal: "bg-zinc-500/20 text-zinc-300",
  low: "bg-zinc-700/20 text-zinc-500",
};

const RECURRENCE_PRESETS: { label: string; value: string }[] = [
  { label: "No repeat", value: "" },
  { label: "Daily", value: "FREQ=DAILY" },
  { label: "Weekly", value: "FREQ=WEEKLY" },
  { label: "Monthly", value: "FREQ=MONTHLY" },
];

type AreaFilter = "all" | "work" | "personal";

function localISODate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function BacklogPage() {
  const { status } = useSession();
  const userId = useAppUserId();
  const qc = useQueryClient();
  const [areaFilter, setAreaFilter] = useState<AreaFilter>("all");
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const todayYmd = localISODate();

  const areasQ = useQuery({
    queryKey: ["areas", userId],
    queryFn: () => fetchAreas(),
    enabled: Boolean(userId),
  });

  const sprintsQ = useQuery({
    queryKey: ["sprints", userId],
    queryFn: () => fetchSprints(),
    enabled: Boolean(userId),
  });

  const q = useQuery({
    queryKey: ["backlog", userId],
    queryFn: () => fetchBacklog(),
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

  const addSubtaskM = useMutation({
    mutationFn: ({ taskId, title }: { taskId: string; title: string }) =>
      createSubtask({ taskId, title }),
    onSuccess: () => {
      setNewSubtaskTitle("");
      void qc.invalidateQueries({ queryKey: ["backlog", userId] });
    },
  });

  const updateSubtaskM = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<SubtaskRow> }) =>
      patchSubtask(id, updates),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["backlog", userId] }),
  });

  const deleteSubtaskM = useMutation({
    mutationFn: (id: string) => deleteSubtask(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["backlog", userId] }),
  });

  const patchMeta = useMutation({
    mutationFn: (body: { taskId: string } & Record<string, unknown>) => {
      const { taskId, ...rest } = body;
      return patchTask(taskId, rest);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["backlog", userId] });
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (status === "loading") {
    return (
      <div className="space-y-2">
        <SkeletonListItem />
        <SkeletonListItem />
      </div>
    );
  }
  if (!userId) return null;

  const areaMap = new Map<string, AreaRow>();
  for (const a of areasQ.data ?? []) areaMap.set(a.id, a);

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
              <div className="mb-2 flex items-center gap-2">
                {area?.color && (
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: area.color }} />
                )}
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {area?.name ?? "Unknown area"}
                </h2>
                <span className="text-[10px] text-muted/60">{tasks.length}</span>
              </div>
              <ul className="space-y-1.5 stagger-list">
                {tasks.map((t) => {
                  const open = expandedId === t.id;
                  return (
                    <li
                      key={t.id}
                      className="overflow-hidden rounded-lg border border-white/10 bg-surface text-sm text-foreground card-hover"
                    >
                      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                        <button
                          type="button"
                          className="rounded p-0.5 text-muted hover:bg-white/10 hover:text-foreground"
                          aria-expanded={open}
                          onClick={() => setExpandedId(open ? null : t.id)}
                        >
                          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                        {isTaskOverdue(t, todayYmd) && (
                          <span className="rounded-full bg-red-500/20 px-1.5 py-0.5 text-[8px] font-semibold uppercase text-red-200">
                            Overdue
                          </span>
                        )}
                        <span className="min-w-0 flex-1">{t.title}</span>
                        {t._subtasksTotal !== undefined && t._subtasksTotal > 0 && (
                          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-muted">
                            {t._subtasksDone}/{t._subtasksTotal}
                          </span>
                        )}
                        {(t._tags ?? []).slice(0, 2).map((tag) => (
                          <TagChip key={tag.id} name={tag.name} color={tag.color} size="xs" />
                        ))}
                        <TimerButton taskId={t.id} compact />
                        <select
                          className="max-w-[140px] rounded-md border border-white/10 bg-primary/10 text-primary px-2 py-1 text-[11px] font-medium transition-colors hover:bg-primary/20"
                          value={t.sprintId ?? ""}
                          disabled={patchMeta.isPending}
                          onChange={(e) => patchMeta.mutate({ taskId: t.id, sprintId: e.target.value === "" ? null : e.target.value })}
                        >
                          <option value="">Add to sprint →</option>
                          {(sprintsQ.data?.sprints ?? []).filter(s => s.status !== "completed").map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        <select
                          className="max-w-[140px] rounded-md border border-white/10 bg-background px-2 py-1 text-[11px] text-muted"
                          value={t.areaId}
                          disabled={moveArea.isPending}
                          onChange={(e) => moveArea.mutate({ taskId: t.id, areaId: e.target.value })}
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
                      </div>
                      {open && (
                        <div className="space-y-2 border-t border-white/10 bg-background/30 px-3 py-3 text-[11px]">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <label className="text-muted">
                              Due date
                              <input
                                type="date"
                                className="mt-1 w-full rounded-md border border-white/10 bg-background px-2 py-1.5 text-foreground"
                                defaultValue={t.dueDate?.slice(0, 10) ?? ""}
                                onBlur={(e) => {
                                  const v = e.target.value.trim();
                                  if (v !== (t.dueDate?.slice(0, 10) ?? "")) {
                                    patchMeta.mutate({ taskId: t.id, dueDate: v || null });
                                  }
                                }}
                              />
                            </label>

                            <label className="text-muted sm:col-span-2">
                              Sprint
                              <select
                                className="mt-1 w-full rounded-md border border-white/10 bg-background px-2 py-1.5 text-foreground"
                                defaultValue={t.sprintId ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  patchMeta.mutate({
                                    taskId: t.id,
                                    sprintId: v === "" ? null : v,
                                  });
                                }}
                              >
                                <option value="">No sprint (backlog)</option>
                                {(sprintsQ.data?.sprints ?? []).map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="text-muted">
                              Priority
                              <select
                                className="mt-1 w-full rounded-md border border-white/10 bg-background px-2 py-1.5 capitalize"
                                defaultValue={t.priority}
                                onChange={(e) =>
                                  patchMeta.mutate({ taskId: t.id, priority: e.target.value })
                                }
                              >
                                {(["urgent", "high", "normal", "low"] as const).map((p) => (
                                  <option key={p} value={p}>
                                    {p}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="text-muted">
                              Physical energy
                              <select
                                className="mt-1 w-full rounded-md border border-white/10 bg-background px-2 py-1.5"
                                defaultValue={displayPhysicalEnergy(t)}
                                onChange={(e) =>
                                  patchMeta.mutate({
                                    taskId: t.id,
                                    physicalEnergy: e.target.value,
                                  })
                                }
                              >
                                {(["low", "medium", "high"] as const).map((p) => (
                                  <option key={p} value={p}>
                                    {p}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="text-muted">
                              Depth
                              <select
                                className="mt-1 w-full rounded-md border border-white/10 bg-background px-2 py-1.5 capitalize"
                                defaultValue={displayWorkDepth(t)}
                                onChange={(e) =>
                                  patchMeta.mutate({ taskId: t.id, workDepth: e.target.value })
                                }
                              >
                                {(["shallow", "normal", "deep"] as const).map((p) => (
                                  <option key={p} value={p}>
                                    {p}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="text-muted sm:col-span-2">
                              Recurrence
                              <select
                                className="mt-1 w-full rounded-md border border-white/10 bg-background px-2 py-1.5"
                                defaultValue={
                                  t.recurrenceRule &&
                                  RECURRENCE_PRESETS.some((p) => p.value === t.recurrenceRule)
                                    ? t.recurrenceRule!
                                    : t.recurrenceRule
                                      ? "__keep"
                                      : ""
                                }
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v === "__keep") return;
                                  patchMeta.mutate({
                                    taskId: t.id,
                                    recurrenceRule: v === "" ? null : v,
                                  });
                                }}
                              >
                                {RECURRENCE_PRESETS.map((p) => (
                                  <option key={p.label} value={p.value}>
                                    {p.label}
                                  </option>
                                ))}
                                {t.recurrenceRule &&
                                  !RECURRENCE_PRESETS.some((p) => p.value === t.recurrenceRule) && (
                                    <option value="__keep">Custom (unchanged)</option>
                                  )}
                              </select>
                            </label>
                          </div>
                          
                          {/* SUBTASKS SECTION */}
                          <div className="mt-4 pt-4 border-t border-white/10">
                            <div className="mb-2 flex items-center justify-between">
                              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">Subtasks</h4>
                            </div>
                            <ul className="mb-3 space-y-1.5">
                              {(t._subtasks ?? []).map((sub) => (
                                <li key={sub.id} className="flex items-center gap-2 rounded-md bg-white/5 px-2 py-1.5 group">
                                  <button
                                    className="shrink-0 text-muted hover:text-white"
                                    onClick={() => updateSubtaskM.mutate({ id: sub.id, updates: { completed: !sub.completed }})}
                                  >
                                    {sub.completed ? <CheckCircle2 size={14} className="text-success" /> : <Circle size={14} />}
                                  </button>
                                  <input 
                                    className={cn("flex-1 bg-transparent px-1 text-xs outline-none focus:ring-1 focus:ring-primary/50 rounded", sub.completed && "line-through text-muted")}
                                    defaultValue={sub.title}
                                    onBlur={(e) => {
                                      const val = e.target.value.trim();
                                      if (val && val !== sub.title) updateSubtaskM.mutate({ id: sub.id, updates: { title: val }});
                                    }}
                                  />
                                  <input
                                    type="date"
                                    className="w-24 shrink-0 rounded bg-background px-1 text-[10px] text-muted border border-transparent hover:border-white/10 outline-none"
                                    defaultValue={sub.scheduledDate?.slice(0, 10) ?? ""}
                                    title="Scheduled date"
                                    onChange={(e) => updateSubtaskM.mutate({ id: sub.id, updates: { scheduledDate: e.target.value || null } })}
                                  />
                                  <button
                                    onClick={() => deleteSubtaskM.mutate(sub.id)}
                                    className="opacity-0 group-hover:opacity-100 p-0.5 text-muted hover:bg-danger/20 hover:text-danger rounded sm-transition"
                                    title="Delete subtask"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </li>
                              ))}
                              {(t._subtasks ?? []).length === 0 && (
                                <p className="text-[10px] text-muted/60 italic px-1">No subtasks yet</p>
                              )}
                            </ul>
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                placeholder="+ Add subtask..."
                                className="flex-1 rounded-md border border-white/5 bg-background px-3 py-1.5 text-xs focus:border-primary/50 focus:outline-none"
                                value={newSubtaskTitle}
                                onChange={e => setNewSubtaskTitle(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === "Enter" && newSubtaskTitle.trim()) {
                                    e.preventDefault();
                                    addSubtaskM.mutate({ taskId: t.id, title: newSubtaskTitle.trim() });
                                  }
                                }}
                              />
                            </div>
                          </div>

                          <p className="mt-3 text-[10px] text-muted/70">
                            Blur date fields to save. Other fields save on change.
                          </p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {!q.isLoading && (q.data?.length ?? 0) > 0 && filteredGroups.length === 0 && (
        <p className="mt-6 text-center text-sm text-muted">No tasks in this category filter.</p>
      )}

      {!q.isLoading && (q.data?.length ?? 0) === 0 && (
        <div className="mt-12 flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-surface/50 py-16 text-center">
          <CheckCircle2 size={32} className="mb-4 text-primary/40" />
          <p className="text-foreground font-medium text-sm">Your backlog is clean!</p>
          <p className="mt-1 text-xs text-muted max-w-sm">
            All caught up. Use the Brain Dump (Ctrl/Cmd+Shift+D) to capture new tasks, or head to the{" "}
            <Link href="/board" className="text-primary hover:underline font-medium">
              Board
            </Link>.
          </p>
        </div>
      )}
    </div>
  );
}
