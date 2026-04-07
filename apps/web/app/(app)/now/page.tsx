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
  type SubtaskRow,
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

// ─── Types ────────────────────────────────────────────────────────────────────

type SubtaskItem = {
  id: string;
  taskId: string;
  title: string;
  scheduledTime: string | null;
  estimatedMinutes: number | null;
  completed: boolean;
};

type TaskGroup = {
  taskId: string;
  taskTitle: string;
  priority: string;
  physicalEnergy: string;
  energyLevel: string;
  tags: Array<{ id: number; name: string; color: string | null }>;
  timed: SubtaskItem[];
  untimed: SubtaskItem[];
};

// ─── SubtaskRow component ──────────────────────────────────────────────────────

function SubtaskListItem({
  sub,
  onDone,
  isDoneAnimating,
}: {
  sub: SubtaskItem;
  onDone: (sub: SubtaskItem) => void;
  isDoneAnimating: boolean;
}) {
  const { activeLog, isRunning, elapsed, startTimer, stopActiveTimer, isStarting, isStopping } =
    useActiveTimer();
  const isTimerRunningForThis = isRunning && activeLog?.taskId === sub.taskId;
  const timeBlock = sub.scheduledTime ? sub.scheduledTime.slice(0, 5) : null;

  return (
    <li
      className={cn(
        "group flex items-center gap-3 rounded-xl border bg-background/60 px-4 py-3 transition-all duration-200",
        sub.completed
          ? "border-white/5 opacity-40"
          : "border-white/10 hover:border-primary/30 hover:bg-background/80",
        isDoneAnimating && "animate-done-flash"
      )}
    >
      {/* Checkbox */}
      <button
        type="button"
        onClick={() => onDone(sub)}
        disabled={sub.completed}
        className="shrink-0 transition-transform hover:scale-110"
        title={sub.completed ? "Completed" : "Mark done"}
      >
        {sub.completed ? (
          <CheckCircle2 size={18} className="text-success" />
        ) : (
          <Circle size={18} className="text-muted hover:text-primary" />
        )}
      </button>

      {/* Title */}
      <span
        className={cn(
          "flex-1 min-w-0 text-sm text-foreground",
          sub.completed && "line-through text-muted"
        )}
      >
        {sub.title}
      </span>

      {/* Meta */}
      <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted">
        {timeBlock && (
          <span className="flex items-center gap-1 font-mono">
            <Clock size={10} />
            {timeBlock}
          </span>
        )}
        {sub.estimatedMinutes ? <span>{sub.estimatedMinutes}m</span> : null}
      </div>

      {/* Timer */}
      {!sub.completed && (
        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
          {isTimerRunningForThis ? (
            <button
              onClick={() => stopActiveTimer()}
              disabled={isStopping}
              className="flex items-center gap-1.5 rounded-lg bg-danger/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-danger transition-colors disabled:opacity-50"
            >
              <span className="text-[10px]">■</span>
              <span className="font-mono">{formatElapsed(elapsed)}</span>
            </button>
          ) : (
            <button
              onClick={() => startTimer(sub.taskId)}
              disabled={isStarting || isRunning}
              title={isRunning ? "Stop current timer first" : "Start timer"}
              className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-muted hover:bg-primary/20 hover:text-primary transition-colors disabled:opacity-30"
            >
              <span className="text-[10px]">▶</span>
              Start
            </button>
          )}
        </div>
      )}
    </li>
  );
}

// ─── TaskGroupSection ─────────────────────────────────────────────────────────

function TaskGroupSection({
  group,
  onSubtaskDone,
  doneId,
}: {
  group: TaskGroup;
  onSubtaskDone: (sub: SubtaskItem) => void;
  doneId: string | null;
}) {
  const allDone =
    group.timed.every((s) => s.completed) && group.untimed.every((s) => s.completed);

  return (
    <div
      className={cn(
        "rounded-2xl border p-4 transition-all duration-300",
        allDone ? "border-white/5 bg-surface/30 opacity-60" : "border-white/10 bg-surface/60"
      )}
    >
      {/* Task heading */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className={cn("text-sm font-semibold text-foreground", allDone && "line-through text-muted")}>
          {group.taskTitle}
        </h3>
        {(group.tags ?? []).map((tag) => (
          <TagChip key={tag.id} name={tag.name} color={tag.color} size="xs" />
        ))}
        {allDone && (
          <span className="ml-auto rounded-full bg-success/20 px-2 py-0.5 text-[10px] font-semibold text-success">
            All done ✓
          </span>
        )}
      </div>

      {/* Timed subtasks */}
      {group.timed.length > 0 && (
        <ul className="space-y-1.5 mb-2">
          {group.timed.map((s) => (
            <SubtaskListItem
              key={s.id}
              sub={s}
              onDone={onSubtaskDone}
              isDoneAnimating={doneId === s.id}
            />
          ))}
        </ul>
      )}

      {/* Untimed subtasks */}
      {group.untimed.length > 0 && (
        <>
          {group.timed.length > 0 && (
            <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted/60">
              Unscheduled for today
            </p>
          )}
          <ul className="space-y-1.5">
            {group.untimed.map((s) => (
              <SubtaskListItem
                key={s.id}
                sub={s}
                onDone={onSubtaskDone}
                isDoneAnimating={doneId === s.id}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NowPage() {
  const { status } = useSession();
  const userId = useAppUserId();
  const qc = useQueryClient();
  const [doneId, setDoneId] = useState<string | null>(null);
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
    mutationFn: async ({ id, type }: { id: string; type: "task" | "subtask" }) => {
      setDoneId(id);
      if (type === "task") await patchTask(id, { status: "done" });
      else await patchSubtask(id, { completed: true });
    },
    onSuccess: () => {
      confetti({ particleCount: 40, spread: 55, startVelocity: 22, ticks: 50, origin: { y: 0.72 } });
      setTimeout(() => {
        setDoneId(null);
        void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
        void qc.invalidateQueries({ queryKey: ["tasks", userId] });
        toast.success("Done! ✓");
      }, 400);
    },
    onError: (e: Error) => {
      setDoneId(null);
      toast.error(e.message);
    },
  });

  // ── Build grouped data ─────────────────────────────────────────────

  const { groups, flatTasks } = useMemo(() => {
    const raw = q.data?.tasks ?? [];
    const taskGroups: TaskGroup[] = [];
    const flat: Array<{
      id: string;
      title: string;
      priority: string;
      physicalEnergy: string;
      energyLevel: string;
      tags: Array<{ id: number; name: string; color: string | null }>;
      status: string;
      isOverdue: boolean;
    }> = [];

    for (const t of raw) {
      const subs = t._subtasks ?? [];
      const todaySubs = subs.filter((s) => s.scheduledDate === todayLocal);

      if (todaySubs.length > 0) {
        // Task has subtasks scheduled today — group them
        const subtaskItems: SubtaskItem[] = todaySubs.map((s) => ({
          id: s.id,
          taskId: t.id,
          title: s.title,
          scheduledTime: s.scheduledTime,
          estimatedMinutes: s.estimatedMinutes,
          completed: s.completed,
        }));

        // Filter by energy
        if (energyFilter && t.physicalEnergy !== energyFilter && t.physicalEnergy) continue;

        // Sort timed first, then untimed, sort timed by time
        const timed = subtaskItems
          .filter((s) => s.scheduledTime)
          .sort((a, b) => (a.scheduledTime ?? "").localeCompare(b.scheduledTime ?? ""));
        const untimed = subtaskItems.filter((s) => !s.scheduledTime);

        taskGroups.push({
          taskId: t.id,
          taskTitle: t.title,
          priority: t.priority,
          physicalEnergy: t.physicalEnergy ?? "medium",
          energyLevel: t.energyLevel ?? "normal",
          tags: t._tags ?? [],
          timed,
          untimed,
        });
      } else {
        // No subtasks for today — this is a flat task
        if (energyFilter && t.physicalEnergy !== energyFilter && t.physicalEnergy) continue;
        flat.push({
          id: t.id,
          title: t.title,
          priority: t.priority,
          physicalEnergy: t.physicalEnergy ?? "medium",
          energyLevel: t.energyLevel ?? "normal",
          tags: t._tags ?? [],
          status: t.status,
          isOverdue: isTaskOverdue(t, todayLocal),
        });
      }
    }

    // Sort groups: incomplete first
    taskGroups.sort((a, b) => {
      const aDone = a.timed.every((s) => s.completed) && a.untimed.every((s) => s.completed);
      const bDone = b.timed.every((s) => s.completed) && b.untimed.every((s) => s.completed);
      if (aDone !== bDone) return aDone ? 1 : -1;
      // Sort by earliest timed subtask
      const aTime = a.timed[0]?.scheduledTime ?? "zz";
      const bTime = b.timed[0]?.scheduledTime ?? "zz";
      return aTime.localeCompare(bTime);
    });

    return { groups: taskGroups, flatTasks: flat };
  }, [q.data?.tasks, energyFilter, todayLocal]);

  const overdueRoots = useMemo(() => {
    const allTasks = tasksForRescue.data ?? [];
    return allTasks.filter((t) => isTaskOverdue(t, todayLocal));
  }, [tasksForRescue.data, todayLocal]);

  const unscheduledRoots = useMemo(() => {
    const allTasks = tasksForRescue.data ?? [];
    return allTasks.filter((t) => t.status !== "done" && !isTaskOverdue(t, todayLocal));
  }, [tasksForRescue.data, todayLocal]);

  const persistEnergy = useCallback((next: PhysicalEnergyLevel | "") => {
    setEnergyFilter(next);
    if (typeof window === "undefined") return;
    if (next) localStorage.setItem(LS_PHYSICAL_ENERGY, next);
    else localStorage.removeItem(LS_PHYSICAL_ENERGY);
  }, []);

  // Focus item: pick the first incomplete subtask (or flat task) across all groups
  const focusInfo = useMemo(() => {
    // Active timer first
    if (activeLog) {
      for (const g of groups) {
        const sub = [...g.timed, ...g.untimed].find(
          (s) => s.taskId === activeLog.taskId && !s.completed
        );
        if (sub) return { sub, group: g };
      }
    }
    // First incomplete timed subtask
    for (const g of groups) {
      const sub = g.timed.find((s) => !s.completed) ?? g.untimed.find((s) => !s.completed);
      if (sub) return { sub, group: g };
    }
    return null;
  }, [activeLog, groups]);

  const totalSubtasks = groups.reduce((s, g) => s + g.timed.length + g.untimed.length, 0);
  const totalMinutes = groups.reduce(
    (s, g) =>
      s +
      [...g.timed, ...g.untimed].reduce((a, x) => a + (x.estimatedMinutes ?? 0), 0),
    0
  );
  const doneToday = q.data?.doneTodayCount ?? 0;

  const handleSubtaskDone = (sub: SubtaskItem) => {
    doneMut.mutate({ id: sub.id, type: "subtask" });
  };

  if (status === "loading") {
    return (
      <div className="space-y-4">
        <SkeletonListItem />
        <SkeletonListItem />
        <SkeletonListItem />
      </div>
    );
  }
  if (!userId) return null;

  const hasContent = groups.length > 0 || flatTasks.length > 0;
  const isTimerRunningForFocus =
    isRunning && focusInfo && activeLog?.taskId === focusInfo.sub.taskId;

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* ── Overdue Banner ─────────────────────────────────────────── */}
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
            {totalSubtasks > 0 && (
              <span className="ml-2">
                · {totalSubtasks} subtask{totalSubtasks !== 1 ? "s" : ""}
                {totalMinutes > 0 && ` · ~${Math.round((totalMinutes / 60) * 10) / 10}h`}
              </span>
            )}
            {doneToday > 0 && (
              <span className="ml-2">
                · ✅ {doneToday} done today 🔥
              </span>
            )}
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

      {q.isLoading && (
        <div className="space-y-3">
          <SkeletonListItem />
          <SkeletonListItem />
        </div>
      )}

      {/* ── Focus Mode Box ─────────────────────────────────────────── */}
      {!q.isLoading && focusInfo && (
        <section className="flex flex-col items-center justify-center min-h-[44vh] gap-5 rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/5 to-surface/60 p-8 shadow-sm transition-all duration-300">
          <div className="text-center">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted/70 mb-1">
              {focusInfo.group.taskTitle}
            </p>
            <h2 className="text-2xl font-semibold text-foreground max-w-lg">
              {focusInfo.sub.title}
            </h2>
            {focusInfo.sub.scheduledTime && (
              <p className="mt-1 text-sm text-muted font-mono">
                ⏰ {focusInfo.sub.scheduledTime.slice(0, 5)}
                {focusInfo.sub.estimatedMinutes && ` · ${focusInfo.sub.estimatedMinutes}m est`}
              </p>
            )}
          </div>

          {/* Timer */}
          <div className="relative flex items-center justify-center py-4 px-12">
            {isTimerRunningForFocus && (
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
                "text-5xl font-mono font-semibold tracking-wider z-10 relative transition-colors duration-200",
                isTimerRunningForFocus ? "text-primary" : "text-foreground/60"
              )}
            >
              {isTimerRunningForFocus ? formatElapsed(elapsed) : "00:00:00"}
            </div>
          </div>

          {isTimerRunningForFocus ? (
            <button
              onClick={() => stopActiveTimer()}
              disabled={isStopping}
              className="w-full max-w-xs rounded-full py-3 text-sm font-semibold bg-danger hover:bg-red-600 text-white transition-colors disabled:opacity-50 flex justify-center items-center gap-2"
            >
              <span className="text-lg leading-none mt-[-2px]">■</span> Stop Timer
            </button>
          ) : (
            <button
              onClick={() => startTimer(focusInfo.sub.taskId)}
              disabled={isStarting || isRunning}
              title={isRunning ? "Stop the current active timer first" : "Start timer"}
              className="w-full max-w-xs rounded-full py-3 text-sm font-semibold bg-primary hover:bg-primary-hover text-white transition-colors disabled:opacity-50 flex justify-center items-center gap-2"
            >
              <span className="text-sm leading-none mt-[1px]">▶</span> Start Timer
            </button>
          )}

          {focusInfo.sub.estimatedMinutes && (
            <p className="text-xs text-muted/70">
              Estimated: {focusInfo.sub.estimatedMinutes}m
            </p>
          )}
        </section>
      )}

      {/* ── Empty state ────────────────────────────────────────────── */}
      {!q.isLoading && !hasContent && (
        <div className="mt-8 flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-surface/50 py-16 text-center">
          <Sparkles size={32} className="text-primary/40 mb-3" />
          <p className="text-foreground font-medium text-sm">Nothing scheduled for today.</p>
          <p className="text-muted/80 text-xs mt-1">
            Open a task drawer, add subtasks and set their dates — or use AI to spread subtasks.
          </p>
        </div>
      )}

      {/* ── Task Groups (subtask-led) ──────────────────────────────── */}
      {!q.isLoading && groups.length > 0 && (
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground border-b border-border pb-2 px-1">
            Today&apos;s plan
          </h3>
          {groups.map((g) => (
            <TaskGroupSection
              key={g.taskId}
              group={g}
              onSubtaskDone={handleSubtaskDone}
              doneId={doneId}
            />
          ))}
        </section>
      )}

      {/* ── Flat tasks scheduled for today (no subtasks) ──────────── */}
      {!q.isLoading && flatTasks.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3 px-1 border-b border-border pb-2">
            Tasks for today
          </h3>
          <ul className="space-y-2">
            {flatTasks.map((t) => (
              <li
                key={t.id}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-xl border bg-surface px-4 py-3 transition-all",
                  t.status === "done" ? "border-white/5 opacity-50" : "border-white/10 hover:border-white/15",
                  t.isOverdue && "border-danger/30 ring-1 ring-danger/10"
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className={cn("text-sm font-medium text-foreground", t.status === "done" && "line-through text-muted")}>
                    {t.title}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                    <span className="capitalize">{t.priority}</span>
                    {t.isOverdue && (
                      <span className="rounded-full bg-danger/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-red-200">
                        Overdue
                      </span>
                    )}
                    {(t.tags ?? []).slice(0, 3).map((tag) => (
                      <TagChip key={tag.id} name={tag.name} color={tag.color} size="xs" />
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <TimerButton taskId={t.id} />
                  {t.status !== "done" && (
                    <button
                      type="button"
                      disabled={doneMut.isPending}
                      className="rounded-lg bg-success/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-success transition-colors disabled:opacity-50"
                      onClick={() => doneMut.mutate({ id: t.id, type: "task" })}
                    >
                      ✓ Done
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Unscheduled fallback (shown when nothing scheduled today) ── */}
      {!q.isLoading && !hasContent && !tasksForRescue.isLoading && unscheduledRoots.length > 0 && (
        <section className="mt-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 px-1 border-b border-border pb-2">
            Unscheduled tasks
          </h3>
          <ul className="space-y-2">
            {unscheduledRoots.slice(0, 15).map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-surface px-4 py-3 hover:border-white/15 transition-all"
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
