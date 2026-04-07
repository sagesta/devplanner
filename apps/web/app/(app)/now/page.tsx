"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import confetti from "canvas-confetti";
import { Clock, Sparkles, CheckCircle2, Circle, CalendarPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import {
  fetchTasks,
  fetchToday,
  patchTask,
  patchSubtask,
  patchTasksBulkSchedule,
  type TaskRow,
} from "@/lib/api";
import { LS_PHYSICAL_ENERGY, type PhysicalEnergyLevel } from "@/lib/planner-prefs";
import { SkeletonListItem } from "@/lib/skeleton";
import { cn, displayPhysicalEnergy, isTaskOverdue } from "@/lib/utils";
import { TagChip } from "@/components/TagChip";
import { TimerButton } from "@/components/TimerButton";
import { useActiveTimer, formatElapsed } from "@/hooks/use-active-timer";

function localISODate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 3, high: 2, normal: 1, low: 0 };

type NowItem = {
  id: string; // subtask ID or task ID (if fallback task)
  type: "subtask" | "task";
  taskId: string;
  title: string;
  parentTitle?: string;
  completed: boolean;
  priorityValue: number;
  priorityLabel: string;
  tags: any[];
  scheduledTime: string | null;
  estimatedMinutes: number | null;
  physicalEnergy: string;
};

export default function NowPage() {
  const { status } = useSession();
  const userId = useAppUserId();
  const qc = useQueryClient();
  const [energyFilter, setEnergyFilter] = useState<PhysicalEnergyLevel | "">("");
  const [rescueDismissed, setRescueDismissed] = useState(false);
  const todayLocal = useMemo(() => localISODate(), []);

  const { isRunning, elapsed, activeLog, startTimer, stopActiveTimer, isStarting, isStopping } =
    useActiveTimer();

  useEffect(() => {
    const v = localStorage.getItem(LS_PHYSICAL_ENERGY);
    if (v === "low" || v === "medium" || v === "high") setEnergyFilter(v as PhysicalEnergyLevel);
  }, []);

  const q = useQuery({
    queryKey: ["tasks-today", userId, todayLocal],
    queryFn: () => fetchToday(todayLocal),
    enabled: Boolean(userId),
  });

  const tasksForRescue = useQuery({
    queryKey: ["tasks", userId],
    queryFn: () => fetchTasks(),
    enabled: Boolean(userId),
  });

  const doneMut = useMutation({
    mutationFn: async ({ id, type }: { id: string; type: "task" | "subtask" }) => {
      if (type === "task") return patchTask(id, { status: "done" });
      return patchSubtask(id, { completed: true });
    },
    onSuccess: () => {
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.9 },
        colors: ["#2dd4bf", "#818cf8", "#f472b6"],
      });
      void qc.invalidateQueries({ queryKey: ["tasks-today", userId, todayLocal] });
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rescueMut = useMutation({
    mutationFn: (ids: string[]) => patchTasksBulkSchedule(ids, todayLocal),
    onSuccess: () => {
      toast.success("Tasks scheduled for today");
      void qc.invalidateQueries({ queryKey: ["tasks-today", userId, todayLocal] });
    },
  });

  const persistEnergy = useCallback((next: PhysicalEnergyLevel | "") => {
    setEnergyFilter(next);
    if (typeof window === "undefined") return;
    if (next) localStorage.setItem(LS_PHYSICAL_ENERGY, next);
    else localStorage.removeItem(LS_PHYSICAL_ENERGY);
  }, []);

  // 1. Compile the unified list of NowItems
  const allItems = useMemo(() => {
    const items: NowItem[] = [];
    const raw = q.data?.tasks ?? [];

    for (const t of raw) {
      if (energyFilter && t.physicalEnergy !== energyFilter && t.physicalEnergy) continue;
      
      const subs = t._subtasks ?? [];
      const todaySubs = subs.filter((s) => s.scheduledDate === todayLocal);

      if (todaySubs.length > 0) {
        for (const s of todaySubs) {
          items.push({
            id: s.id,
            type: "subtask",
            taskId: t.id,
            title: s.title,
            parentTitle: t.title,
            completed: s.completed,
            priorityValue: PRIORITY_ORDER[t.priority] ?? 1,
            priorityLabel: t.priority,
            tags: t._tags ?? [],
            scheduledTime: s.scheduledTime,
            estimatedMinutes: s.estimatedMinutes,
            physicalEnergy: t.physicalEnergy ?? "medium"
          });
        }
      } else {
        // Fallback for legacy tasks that are due today but have no subtasks
        if (t.status === "done") continue;
        items.push({
          id: t.id,
          type: "task",
          taskId: t.id,
          title: t.title,
          completed: false,
          priorityValue: PRIORITY_ORDER[t.priority] ?? 1,
          priorityLabel: t.priority,
          tags: t._tags ?? [],
          scheduledTime: null,
          estimatedMinutes: null,
          physicalEnergy: t.physicalEnergy ?? "medium"
        });
      }
    }

    // Sort by priority (high to low), then by time (if set), then alphabetically.
    items.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (a.priorityValue !== b.priorityValue) return b.priorityValue - a.priorityValue;
      if (a.scheduledTime || b.scheduledTime) {
        if (!a.scheduledTime) return 1;
        if (!b.scheduledTime) return -1;
        return a.scheduledTime.localeCompare(b.scheduledTime);
      }
      return a.title.localeCompare(b.title);
    });

    return items;
  }, [q.data?.tasks, energyFilter, todayLocal]);

  // 2. Extract Active Item and Up Next Item
  const activeItem = useMemo(() => {
    // If a timer is running, the running item is active
    if (activeLog) {
      const running = allItems.find((i) => i.taskId === activeLog.taskId && !i.completed);
      if (running) return running;
    }
    // Otherwise, first incomplete item
    return allItems.find((i) => !i.completed) ?? null;
  }, [allItems, activeLog]);

  const upNextItems = useMemo(() => {
    return allItems.filter((i) => !i.completed && i.id !== activeItem?.id);
  }, [allItems, activeItem]);

  const overdueRoots = useMemo(() => {
    const bgTasks = tasksForRescue.data ?? [];
    return bgTasks.filter((t) => isTaskOverdue(t, todayLocal));
  }, [tasksForRescue.data, todayLocal]);

  const unscheduledRoots = useMemo(() => {
    const bgTasks = tasksForRescue.data ?? [];
    return bgTasks.filter((t) => t.status !== "done" && !isTaskOverdue(t, todayLocal));
  }, [tasksForRescue.data, todayLocal]);

  if (status === "loading") {
    return (
      <div className="space-y-4">
        <SkeletonListItem />
        <SkeletonListItem />
      </div>
    );
  }
  if (!userId) return null;

  const hasScheduledItems = allItems.length > 0;
  const isTimerRunningForActive = isRunning && activeItem && activeLog?.taskId === activeItem.taskId;

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl text-foreground">Now</h1>
          <p className="mt-1 text-sm text-muted">
            <time dateTime={todayLocal}>
              {new Date(todayLocal + "T12:00:00").toLocaleDateString(undefined, {
                weekday: "long",
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </time>
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium uppercase tracking-wide text-muted">
            Match my energy
          </label>
          <select
            className="rounded-lg border border-white/10 bg-surface px-2 py-1.5 text-xs text-foreground"
            value={energyFilter}
            onChange={(e) =>
              persistEnergy(e.target.value === "" ? "" : (e.target.value as PhysicalEnergyLevel))
            }
          >
            <option value="">All tasks</option>
            <option value="low">Low energy</option>
            <option value="medium">Medium energy</option>
            <option value="high">High energy</option>
          </select>
        </div>
      </div>

      {overdueRoots.length >= 3 && !rescueDismissed && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>You have {overdueRoots.length} overdue tasks. Reschedule all to today?</span>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => rescueMut.mutate(overdueRoots.map((t) => t.id))}
              disabled={rescueMut.isPending}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-40"
            >
              Reschedule all
            </button>
            <button
              onClick={() => setRescueDismissed(true)}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-muted hover:bg-white/5"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {q.isLoading && (
        <div className="space-y-3">
          <SkeletonListItem />
          <SkeletonListItem />
        </div>
      )}

      {/* ── Active Timer Slot ──────────────────────────────────────── */}
      {!q.isLoading && activeItem && (
        <section className="flex flex-col items-center justify-center min-h-[44vh] gap-5 rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/5 to-surface/60 p-8 shadow-sm transition-all duration-300">
          <div className="text-center w-full max-w-2xl">
            {activeItem.parentTitle && (
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted/70 mb-2 border-b border-white/5 pb-2 inline-block">
                {activeItem.parentTitle}
              </p>
            )}
            <h2 className="text-2xl font-semibold text-foreground">
              {activeItem.title}
            </h2>
            <div className="mt-3 flex items-center justify-center gap-2 text-xs text-muted">
              {activeItem.scheduledTime && (
                <span className="flex items-center gap-1 bg-white/5 px-2 py-1 rounded">
                  <Clock size={12} /> {activeItem.scheduledTime.slice(0, 5)}
                </span>
              )}
              {activeItem.estimatedMinutes && (
                <span className="bg-white/5 px-2 py-1 rounded">{activeItem.estimatedMinutes}m est</span>
              )}
              <span className={cn("px-2 py-1 rounded uppercase font-semibold text-[10px]", 
                activeItem.priorityLabel === 'urgent' ? 'bg-red-500/20 text-red-400' :
                activeItem.priorityLabel === 'high' ? 'bg-orange-500/20 text-orange-400' :
                'bg-white/5 text-muted')}>
                {activeItem.priorityLabel}
              </span>
            </div>
          </div>

          <div className="relative flex items-center justify-center py-4 px-12 mt-2">
            {isTimerRunningForActive && (
              <div
                className="absolute inset-0 rounded-full animate-spin pointer-events-none"
                style={{
                  background: "conic-gradient(from 0deg, var(--primary) at 50% 50%, transparent)",
                  opacity: 0.12,
                  animationDuration: "4s",
                }}
              />
            )}
            <div
              className={cn(
                "text-6xl font-mono font-semibold tracking-wider z-10 relative transition-colors duration-200",
                isTimerRunningForActive ? "text-primary" : "text-foreground/60"
              )}
            >
              {isTimerRunningForActive ? formatElapsed(elapsed) : "00:00:00"}
            </div>
          </div>

          <div className="flex gap-3 w-full max-w-md mt-4">
             {isTimerRunningForActive ? (
                <button
                  onClick={() => stopActiveTimer()}
                  disabled={isStopping}
                  className="flex-1 rounded-xl py-3.5 text-sm font-semibold bg-danger hover:bg-red-600 text-white transition-colors disabled:opacity-50 flex justify-center items-center gap-2"
                >
                  <span className="text-lg leading-none mt-[-2px]">■</span> Pause
                </button>
              ) : (
                <button
                  onClick={() => startTimer(activeItem.taskId)}
                  disabled={isStarting || isRunning}
                  title={isRunning ? "Stop the current active timer first" : "Start timer"}
                  className="flex-1 rounded-xl py-3.5 text-sm font-semibold bg-primary hover:bg-primary-hover text-white transition-colors disabled:opacity-50 flex justify-center items-center gap-2 shadow-lg shadow-primary/20"
                >
                  <span className="text-lg leading-none mt-[-1px]">▶</span> Start
                </button>
              )}
              
              <button
                onClick={() => doneMut.mutate({ id: activeItem.id, type: activeItem.type })}
                disabled={doneMut.isPending}
                className="flex-1 rounded-xl border border-success/30 bg-success/10 hover:bg-success/20 py-3.5 text-sm font-semibold text-success transition-all flex justify-center items-center gap-2"
              >
                <CheckCircle2 size={18} /> Done
              </button>
          </div>
        </section>
      )}

      {/* ── Empty State ────────────────────────────────────────────── */}
      {!q.isLoading && !hasScheduledItems && (
        <div className="mt-8 flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-surface/50 py-20 text-center">
          <Sparkles size={36} className="text-primary/40 mb-4" />
          <p className="text-foreground font-semibold text-lg">Nothing scheduled for today.</p>
          <p className="text-muted/80 text-sm mt-2 max-w-sm">
            Open the backlog, pick a task, and add some subtasks scheduled for today.
          </p>
        </div>
      )}

      {/* ── Up Next ────────────────────────────────────────────────── */}
      {!q.isLoading && upNextItems.length > 0 && (
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground border-b border-border pb-2 px-1">
            Up carefully next
          </h3>
          <ul className="space-y-2">
            {upNextItems.map(item => (
               <li
                key={item.id}
                className="group flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-white/10 bg-surface/60 px-4 py-3 hover:border-primary/30 transition-all"
               >
                 <div className="flex items-center gap-3 flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => doneMut.mutate({ id: item.id, type: item.type })}
                      className="shrink-0 transition-transform hover:scale-110"
                    >
                      <Circle size={20} className="text-muted hover:text-success" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-foreground flex items-center gap-2">
                        <span className="truncate">{item.title}</span>
                      </div>
                      <div className="flex text-[10px] text-muted/80 mt-0.5 gap-2 truncate">
                        {item.parentTitle && <span>{item.parentTitle}</span>}
                        {item.scheduledTime && (
                          <span className="text-primary/70 flex items-center gap-1">
                            · <Clock size={10} /> {item.scheduledTime.slice(0, 5)}
                          </span>
                        )}
                      </div>
                    </div>
                 </div>
                 <div className="flex items-center gap-2 shrink-0">
                    <span className={cn("px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider", 
                      item.priorityLabel === 'urgent' ? 'bg-red-500/10 text-red-400' :
                      item.priorityLabel === 'high' ? 'bg-orange-500/10 text-orange-400' :
                      'bg-white/5 text-muted')}>
                      {item.priorityLabel}
                    </span>
                 </div>
               </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Unscheduled tasks fallback ─────────────────────────────── */}
      {!q.isLoading && !hasScheduledItems && !tasksForRescue.isLoading && unscheduledRoots.length > 0 && (
        <section className="mt-8">
          <h3 className="text-sm font-semibold text-foreground mb-3 px-1 border-b border-border pb-2">
            Unscheduled tasks you could work on
          </h3>
          <ul className="space-y-2">
            {unscheduledRoots.slice(0, 8).map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-surface px-4 py-3 hover:border-white/15 transition-all"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-foreground text-sm font-medium">{t.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                    <span className="capitalize">{t.priority}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={rescueMut.isPending}
                    className="flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-primary/20 hover:text-primary transition-colors disabled:opacity-50"
                    onClick={() => rescueMut.mutate([t.id])}
                  >
                    <CalendarPlus size={12} />
                    Schedule for today
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

    </div>
  );
}
