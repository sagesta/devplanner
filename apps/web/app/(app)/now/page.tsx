"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import confetti from "canvas-confetti";
import { Clock, Timer, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { fetchTasks, fetchToday, patchTask, patchTasksBulkSchedule, type TaskRow } from "@/lib/api";
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

export default function NowPage() {
  const { status } = useSession();
  const userId = useAppUserId();
  const qc = useQueryClient();
  const [doneId, setDoneId] = useState<string | null>(null);
  const [energyFilter, setEnergyFilter] = useState<PhysicalEnergyLevel | "">("");
  const [rescueDismissed, setRescueDismissed] = useState(false);
  const todayLocal = useMemo(() => localISODate(), []);

  // Use the global active timer hook
  const { activeLog, isRunning, elapsed, startTimer, stopActiveTimer, isStarting, isStopping } = useActiveTimer();

  useEffect(() => {
    const v = localStorage.getItem(LS_PHYSICAL_ENERGY);
    if (v === "low" || v === "medium" || v === "high") setEnergyFilter(v);
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

  const rescueMut = useMutation({
    mutationFn: (ids: string[]) => patchTasksBulkSchedule(ids, todayLocal),
    onSuccess: (r) => {
      toast.success(`Rescheduled ${r.updated} task(s) to today`);
      setRescueDismissed(true);
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const doneMut = useMutation({
    mutationFn: async (taskId: string) => {
      setDoneId(taskId);
      await patchTask(taskId, { status: "done" });
    },
    onSuccess: () => {
      confetti({ particleCount: 40, spread: 55, startVelocity: 22, ticks: 50, origin: { y: 0.72 } });
      setTimeout(() => {
        setDoneId(null);
        void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
        toast.success("Done! ✓");
      }, 400);
    },
    onError: (e: Error) => {
      setDoneId(null);
      toast.error(e.message);
    },
  });

  const tasks = useMemo(() => {
    const raw = q.data?.tasks ?? [];
    let list = [...raw];
    if (energyFilter) {
      list = list.filter((t) => displayPhysicalEnergy(t) === energyFilter);
    }
    list.sort((a, b) => {
      const ta = a.scheduledStartTime ?? "";
      const tb = b.scheduledStartTime ?? "";
      if (ta && tb) return ta.localeCompare(tb);
      if (ta) return -1;
      if (tb) return 1;
      return a.title.localeCompare(b.title);
    });
    return list;
  }, [q.data?.tasks, energyFilter]);

  const overdueRoots = useMemo(() => {
    const roots = (tasksForRescue.data ?? []).filter((t) => !t.parentTaskId);
    return roots.filter((t) => isTaskOverdue(t, todayLocal));
  }, [tasksForRescue.data, todayLocal]);

  const persistEnergy = useCallback((next: PhysicalEnergyLevel | "") => {
    setEnergyFilter(next);
    if (typeof window === "undefined") return;
    if (next) localStorage.setItem(LS_PHYSICAL_ENERGY, next);
    else localStorage.removeItem(LS_PHYSICAL_ENERGY);
  }, []);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Auto-select the active task if running, else keep manual selection, else pick first available
  const focusTask = useMemo(() => {
    if (activeLog) {
      return tasks.find(t => t.id === activeLog.taskId) || null;
    }
    if (selectedTaskId) {
      const manual = tasks.find(t => t.id === selectedTaskId);
      if (manual) return manual;
    }
    // Default to top-priority not-done task
    return tasks.find(t => t.status !== "done") || tasks[0] || null;
  }, [activeLog, selectedTaskId, tasks]);

  if (status === "loading") {
    return (
      <div className="space-y-4">
        <SkeletonListItem />
        <SkeletonListItem />
        <SkeletonListItem />
      </div>
    );
  }
  const allTasks = tasksForRescue.data ?? [];
  const unscheduledRoots = allTasks.filter((t) => !t.parentTaskId && !t.scheduledDate && t.status !== "done");

  if (!userId) return null;

  const totalMinutes = tasks.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);
  const doneToday = q.data?.doneTodayCount ?? 0;

  // Determine sum of duration seconds for today for active component
  // (In a full prod we might fetch this directly, but for now we'll pretend or just show the current elapsed + previously fetched logs if we had them. Let's just use what's available or leave it standard for now)

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* Overdue Banner */}
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

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl text-foreground">Now</h1>
          <p className="mt-1 text-sm text-muted">
            <time dateTime={todayLocal}>
              {new Date(todayLocal + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "short", day: "numeric" })}
            </time>
            {tasks.length > 0 && <span className="ml-2">· {tasks.length} task{tasks.length !== 1 ? "s" : ""}{totalMinutes > 0 && ` · ~${Math.round((totalMinutes / 60) * 10) / 10}h`}</span>}
            {doneToday > 0 && <span className="ml-2">· ✅ {doneToday} task{doneToday !== 1 ? "s" : ""} done today 🔥</span>}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium uppercase tracking-wide text-muted">Match my energy</label>
          <select
            className="rounded-lg border border-white/10 bg-surface px-2 py-1.5 text-xs text-foreground"
            value={energyFilter}
            onChange={(e) => persistEnergy(e.target.value === "" ? "" : (e.target.value as PhysicalEnergyLevel))}
          >
            <option value="">All tasks</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>

      {q.isLoading && (
        <div className="space-y-3">
          <SkeletonListItem />
          <SkeletonListItem />
        </div>
      )}

      {/* Focus Mode Central Box */}
      {!q.isLoading && tasks.length > 0 && (
        <section className="flex flex-col items-center justify-center min-h-[50vh] gap-6 rounded-2xl border border-white/5 bg-surface/50 p-8 shadow-sm transition-all duration-300">
          {focusTask ? (
            <>
              <h2 className="text-2xl font-semibold text-center text-foreground max-w-lg">
                {focusTask.title}
              </h2>
              
              <div className="relative flex items-center justify-center py-6 px-12">
                {/* Ambient Ring */}
                {isRunning && activeLog?.taskId === focusTask.id && (
                  <div 
                    className="absolute inset-0 rounded-full animate-spin pointer-events-none" 
                    style={{ 
                      background: "conic-gradient(from 0deg, var(--primary) at 50% 50%, transparent)",
                      opacity: 0.15,
                      animationDuration: "4s"
                    }} 
                  />
                )}
                
                {/* Time Display */}
                <div className={cn(
                  "text-5xl font-mono font-semibold tracking-wider z-10 relative transition-colors duration-200",
                  (isRunning && activeLog?.taskId === focusTask.id) ? "text-primary" : "text-foreground"
                )}>
                  {isRunning && activeLog?.taskId === focusTask.id ? formatElapsed(elapsed) : "00:00:00"}
                </div>
              </div>

              {/* Start/Stop Button */}
              {isRunning && activeLog?.taskId === focusTask.id ? (
                <button
                  onClick={() => stopActiveTimer()}
                  disabled={isStopping}
                  className="w-full max-w-xs rounded-full py-3 text-sm font-semibold bg-danger hover:bg-red-600 text-white transition-colors disabled:opacity-50 flex justify-center items-center gap-2"
                >
                  <span className="text-lg leading-none mt-[-2px]">■</span> Stop Timer
                </button>
              ) : (
                <button
                  onClick={() => startTimer(focusTask.id)}
                  disabled={isStarting || isRunning}
                  title={isRunning ? "Stop the current active timer first" : "Start timer"}
                  className="w-full max-w-xs rounded-full py-3 text-sm font-semibold bg-primary hover:bg-primary-hover text-white transition-colors disabled:opacity-50 flex justify-center items-center gap-2"
                >
                  <span className="text-sm leading-none mt-[1px]">▶</span> Start Timer
                </button>
              )}

              {/* Logged time context */}
              <div className="text-sm text-muted">
                {focusTask.estimatedMinutes ? `Est: ${focusTask.estimatedMinutes}m` : "No estimate set"}
              </div>
            </>
          ) : (
             <div className="flex flex-col items-center text-center">
              <Sparkles size={32} className="text-primary/40 mb-3" />
              <p className="text-muted text-sm">Select a task from below to focus on.</p>
            </div>
          )}
        </section>
      )}

      {/* Up Next List */}
      {!q.isLoading && tasks.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3 px-1 border-b border-border pb-2">Up carefully next</h3>
          <ul className="space-y-2 stagger-list">
            {tasks.map((t) => {
              const timeBlock = t.scheduledStartTime && t.scheduledEndTime ? `${t.scheduledStartTime.slice(0, 5)}–${t.scheduledEndTime.slice(0, 5)}` : null;
              const isSelected = focusTask?.id === t.id;

              return (
                <li
                  key={t.id}
                  onClick={() => setSelectedTaskId(t.id)}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-xl border bg-surface px-4 py-3 transition-all cursor-pointer",
                    isSelected ? "border-primary/50 shadow-md ring-1 ring-primary/20" : "border-white/10 hover:border-white/15 hover:shadow-md",
                    doneId === t.id && "animate-done-flash",
                    t.status === "done" && "opacity-50 grayscale",
                    isTaskOverdue(t, todayLocal) && !isSelected && "border-danger/30 ring-1 ring-danger/10"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("text-foreground", isSelected && "font-semibold")}>{t.title}</span>
                      {isTaskOverdue(t, todayLocal) && (
                        <span className="rounded-full bg-danger/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-red-200">Overdue</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                      {timeBlock && <span className="flex items-center gap-1 font-mono"><Clock size={10} />{timeBlock}</span>}
                      {t.estimatedMinutes && <span>{t.estimatedMinutes}m</span>}
                      <span title="Physical energy">E:{displayPhysicalEnergy(t)}</span>
                      <span className="capitalize">{t.energyLevel.replace("_", " ")}</span>
                    </div>
                    {(t._tags ?? []).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(t._tags ?? []).slice(0, 3).map((tag) => (
                          <TagChip key={tag.id} name={tag.name} color={tag.color} size="xs" />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <TimerButton taskId={t.id} />
                    <button
                      type="button"
                      disabled={doneMut.isPending}
                      className="rounded-lg bg-success/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-success transition-colors disabled:opacity-50"
                      onClick={() => doneMut.mutate(t.id)}
                    >
                      ✓ Done
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!q.isLoading && tasks.length === 0 && (
        <div className="mt-12 flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-surface/50 py-16 text-center">
          <Sparkles size={32} className="text-primary/40 mb-3" />
          <p className="text-foreground font-medium text-sm">Nothing scheduled for today.</p>
          <p className="text-muted/80 text-xs mt-1">
            Use Brain Dump (Ctrl/Cmd+Shift+D) to capture tasks, or select an unscheduled one below.
          </p>
        </div>
      )}

      {/* Unscheduled Tasks Section */}
      {!q.isLoading && tasks.length === 0 && !tasksForRescue.isLoading && unscheduledRoots.length > 0 && (
        <section className="mt-8">
          <h3 className="text-sm font-semibold text-foreground mb-3 px-1 border-b border-border pb-2">Unscheduled tasks</h3>
          <ul className="space-y-2 stagger-list">
            {unscheduledRoots.slice(0, 15).map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-surface px-4 py-3 hover:border-white/15 hover:shadow-md transition-all"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-foreground text-sm font-medium">{t.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                    <span className="capitalize">{t.priority}</span>
                    <span title="Physical energy">E:{displayPhysicalEnergy(t)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={rescueMut.isPending}
                    className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-white/20 transition-colors disabled:opacity-50"
                    onClick={() => rescueMut.mutate([t.id])}
                  >
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
