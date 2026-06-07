"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import confetti from "canvas-confetti";
import {
  AlertTriangle,
  ArrowRight,
  CalendarPlus,
  CheckCircle2,
  Circle,
  Clock,
  Inbox,
  ListChecks,
  PackageCheck,
  Play,
  Square,
  Target,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import {
  fetchBacklog,
  fetchTasks,
  fetchToday,
  patchTask,
  patchSubtask,
  patchTasksBulkSchedule,
  postAutoSchedule,
  postScheduleApply,
  type ScheduleProposal,
  type TaskRow,
} from "@/lib/api";
import { LS_PHYSICAL_ENERGY, type PhysicalEnergyLevel } from "@/lib/planner-prefs";
import { SkeletonListItem } from "@/lib/skeleton";
import { cn, isTaskOverdue } from "@/lib/utils";
import { PriorityAnchorsCard } from "@/components/priority-anchors-card";
import { useActiveTimer, formatElapsed } from "@/hooks/use-active-timer";

function localISODate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 3, high: 2, normal: 1, low: 0 };

type NowItem = {
  id: string;
  type: "subtask" | "task";
  taskId: string;
  title: string;
  parentTitle?: string;
  completed: boolean;
  priorityValue: number;
  priorityLabel: string;
  scheduledTime: string | null;
  estimatedMinutes: number | null;
  physicalEnergy: string;
};

function isOpenTask(task: TaskRow): boolean {
  return task.status !== "done" && task.status !== "cancelled";
}

function compareTasksForExecution(a: TaskRow, b: TaskRow): number {
  const priorityDelta = (PRIORITY_ORDER[b.priority] ?? 1) - (PRIORITY_ORDER[a.priority] ?? 1);
  if (priorityDelta !== 0) return priorityDelta;
  const aDate = a.dueDate ?? a.scheduledDate ?? "9999-12-31";
  const bDate = b.dueDate ?? b.scheduledDate ?? "9999-12-31";
  return aDate.localeCompare(bDate);
}

function priorityClass(priority: string): string {
  if (priority === "urgent") return "border-red-500/20 bg-red-500/10 text-red-300";
  if (priority === "high") return "border-orange-500/20 bg-orange-500/10 text-orange-300";
  if (priority === "low") return "border-white/10 bg-white/5 text-muted";
  return "border-white/10 bg-white/5 text-foreground";
}

function taskDateLabel(task: TaskRow): string {
  const due = task.dueDate?.slice(0, 10);
  const scheduled = task.scheduledDate?.slice(0, 10);
  if (due) return `Due ${due}`;
  if (scheduled) return `Scheduled ${scheduled}`;
  return "No date";
}

function itemSize(item: NowItem): "big" | "medium" | "small" {
  if ((item.estimatedMinutes ?? 0) >= 90 || item.priorityLabel === "urgent") return "big";
  if ((item.estimatedMinutes ?? 0) >= 30 || item.priorityLabel === "high") return "medium";
  return "small";
}

function QuestionTile({
  label,
  value,
  meta,
  Icon,
  tone = "text-primary",
  action,
  metaHref,
}: {
  label: string;
  value: string;
  meta: string;
  Icon: LucideIcon;
  tone?: string;
  action?: React.ReactNode;
  metaHref?: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-surface px-4 py-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
        <Icon size={14} className={tone} />
        {label}
      </div>
      <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug text-foreground">
        {value}
      </p>
      {metaHref ? (
        <Link href={metaHref} className="mt-2 block truncate text-xs text-primary hover:underline">
          {meta}
        </Link>
      ) : (
        <p className="mt-2 truncate text-xs text-muted">{meta}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export default function NowPage() {
  const { status } = useSession();
  const userId = useAppUserId();
  const qc = useQueryClient();
  const [energyFilter, setEnergyFilter] = useState<PhysicalEnergyLevel | "">("");
  const [rescueDismissed, setRescueDismissed] = useState(false);
  const [scheduleProposals, setScheduleProposals] = useState<ScheduleProposal[]>([]);
  const [selectedProposalIds, setSelectedProposalIds] = useState<string[]>([]);
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

  const inboxQ = useQuery({
    queryKey: ["backlog", userId],
    queryFn: () => fetchBacklog(),
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
      void qc.invalidateQueries({ queryKey: ["backlog", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rescueMut = useMutation({
    mutationFn: (ids: string[]) => patchTasksBulkSchedule(ids, todayLocal),
    onSuccess: () => {
      toast.success("Tasks scheduled for today");
      void qc.invalidateQueries({ queryKey: ["tasks-today", userId, todayLocal] });
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      void qc.invalidateQueries({ queryKey: ["backlog", userId] });
    },
  });

  const autoScheduleMut = useMutation({
    mutationFn: () => postAutoSchedule(todayLocal),
    onSuccess: (data) => {
      if (data.error) throw new Error(data.error);
      const proposals = data.proposals ?? [];
      setScheduleProposals(proposals);
      setSelectedProposalIds(proposals.map((p) => p.id));
      if (proposals.length === 0) toast.success("No rollover changes needed.");
    },
    onError: (e: Error) => toast.error(`Auto-schedule failed: ${e.message}`),
  });

  const applyScheduleMut = useMutation({
    mutationFn: (proposals: ScheduleProposal[]) => postScheduleApply(proposals),
    onSuccess: (data) => {
      toast.success(`Applied ${data.applied} schedule change(s).`);
      setScheduleProposals([]);
      setSelectedProposalIds([]);
      void qc.invalidateQueries({ queryKey: ["tasks-today", userId, todayLocal] });
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      void qc.invalidateQueries({ queryKey: ["backlog", userId] });
      void qc.invalidateQueries({ queryKey: ["calendar-progress"] });
    },
    onError: (e: Error) => toast.error(`Could not apply schedule: ${e.message}`),
  });

  const persistEnergy = useCallback((next: PhysicalEnergyLevel | "") => {
    setEnergyFilter(next);
    if (typeof window === "undefined") return;
    if (next) localStorage.setItem(LS_PHYSICAL_ENERGY, next);
    else localStorage.removeItem(LS_PHYSICAL_ENERGY);
  }, []);

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
            scheduledTime: s.scheduledTime,
            estimatedMinutes: s.estimatedMinutes,
            physicalEnergy: t.physicalEnergy ?? "medium",
          });
        }
      } else if (t.status !== "done") {
        items.push({
          id: t.id,
          type: "task",
          taskId: t.id,
          title: t.title,
          completed: false,
          priorityValue: PRIORITY_ORDER[t.priority] ?? 1,
          priorityLabel: t.priority,
          scheduledTime: null,
          estimatedMinutes: null,
          physicalEnergy: t.physicalEnergy ?? "medium",
        });
      }
    }

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

  const activeItem = useMemo(() => {
    if (activeLog) {
      const running = allItems.find((i) => i.taskId === activeLog.taskId && !i.completed);
      if (running) return running;
    }
    return allItems.find((i) => !i.completed) ?? null;
  }, [allItems, activeLog]);

  const todayFocusItems = useMemo(() => {
    return allItems.filter((i) => !i.completed).slice(0, 7);
  }, [allItems]);

  const upNextItems = useMemo(() => {
    return todayFocusItems.filter((i) => i.id !== activeItem?.id);
  }, [todayFocusItems, activeItem]);

  const allRootTasks = useMemo(() => tasksForRescue.data ?? q.data?.tasks ?? [], [
    tasksForRescue.data,
    q.data?.tasks,
  ]);

  const overdueRoots = useMemo(() => {
    return allRootTasks.filter((t) => isTaskOverdue(t, todayLocal));
  }, [allRootTasks, todayLocal]);

  const unscheduledRoots = useMemo(() => {
    return (inboxQ.data ?? [])
      .filter((t) => isOpenTask(t) && !t.scheduledDate && !isTaskOverdue(t, todayLocal))
      .sort(compareTasksForExecution);
  }, [inboxQ.data, todayLocal]);

  const taskMix = useMemo(() => {
    return todayFocusItems.reduce(
      (acc, item) => {
        acc[itemSize(item)] += 1;
        return acc;
      },
      { big: 0, medium: 0, small: 0 }
    );
  }, [todayFocusItems]);

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
  const capacity = q.data?.dailyCapacity ?? 0;
  const used = q.data?.usedMinutes ?? 0;
  const hasCapacityData = capacity > 0;
  const capacityPercent = hasCapacityData ? Math.min(100, Math.round((used / capacity) * 100)) : 0;
  const selectedProposals = scheduleProposals.filter((p) => selectedProposalIds.includes(p.id));
  const winsToday = q.data?.doneTodayCount ?? allItems.filter((item) => item.completed).length;
  const plannedTodayCount = todayFocusItems.length;
  const nextVisibleTask = upNextItems[0] ?? null;
  const nextInboxTask = unscheduledRoots[0] ?? null;
  const attentionTask = overdueRoots[0] ?? null;

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-5 pb-10">
      <header className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Execution today</p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">Today</h1>
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

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          {hasCapacityData && (
            <div className="min-w-[210px] rounded-lg border border-white/10 bg-surface px-3 py-2">
              <div className="flex items-center justify-between gap-3 text-[11px] text-muted">
                <span className="font-semibold uppercase tracking-wide">Capacity</span>
                <span className={cn("font-medium", used > capacity ? "text-red-300" : "text-foreground")} title="Daily capacity in minutes">
                  {used} / {capacity} min
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/40">
                <div
                  className={cn("h-full rounded-full", used > capacity ? "bg-red-500" : "bg-primary")}
                  style={{ width: `${capacityPercent}%` }}
                />
              </div>
            </div>
          )}

          <label className="min-w-[160px] text-[11px] font-semibold uppercase tracking-wide text-muted">
            Filter by energy
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface px-2 py-2 text-xs font-normal text-foreground"
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
          </label>

          <button
            onClick={() => autoScheduleMut.mutate()}
            disabled={autoScheduleMut.isPending}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-white/10 disabled:opacity-50"
            title="Preview unfinished work that should roll forward"
          >
            <ArrowRight size={14} />
            {autoScheduleMut.isPending ? "Reviewing" : "Preview rollover"}
          </button>
        </div>
      </header>

      <section className="grid gap-3 lg:grid-cols-3">
        <QuestionTile
          Icon={Target}
          label="What am I doing today?"
          value={activeItem?.title ?? todayFocusItems[0]?.title ?? "Nothing locked yet"}
          meta={activeItem?.parentTitle ?? `${todayFocusItems.length} task(s) selected`}
          action={!activeItem && todayFocusItems.length === 0 ? (
            <Link href="/backlog" className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/25 transition-colors">
              <CalendarPlus size={12} />
              Lock tasks
            </Link>
          ) : undefined}
        />
        <QuestionTile
          Icon={PackageCheck}
          label="What is next?"
          value={nextVisibleTask?.title ?? nextInboxTask?.title ?? "No next task visible"}
          meta={
            nextVisibleTask?.parentTitle ??
            (nextInboxTask ? `Available in Inbox · ${nextInboxTask.priority}` : "Pull one from Inbox →")
          }
          metaHref={nextVisibleTask || nextInboxTask ? undefined : "/backlog"}
          tone="text-emerald-300"
        />
        <QuestionTile
          Icon={AlertTriangle}
          label="What needs attention?"
          value={attentionTask?.title ?? "No overdue tasks"}
          meta={attentionTask ? taskDateLabel(attentionTask) : "Clean for now"}
          metaHref={attentionTask ? undefined : "/review?view=progress"}
          tone="text-amber-300"
        />
      </section>

      {scheduleProposals.length > 0 && (
        <section className="rounded-lg border border-primary/25 bg-primary/5 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-primary" />
              <div>
                <h2 className="text-sm font-semibold text-foreground">Review schedule changes</h2>
                <p className="mt-1 text-xs text-muted">
                  Unfinished work can roll forward. Nothing changes until you approve it.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-muted hover:bg-white/5"
                onClick={() => {
                  setScheduleProposals([]);
                  setSelectedProposalIds([]);
                }}
              >
                Dismiss
              </button>
              <button
                type="button"
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-40"
                disabled={selectedProposals.length === 0 || applyScheduleMut.isPending}
                onClick={() => applyScheduleMut.mutate(selectedProposals)}
              >
                {applyScheduleMut.isPending ? "Applying" : `Apply ${selectedProposals.length}`}
              </button>
            </div>
          </div>
          <ul className="mt-3 space-y-2">
            {scheduleProposals.map((proposal) => {
              const checked = selectedProposalIds.includes(proposal.id);
              return (
                <li key={proposal.id} className="rounded-lg border border-white/10 bg-surface px-3 py-2">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 rounded border-white/20"
                      checked={checked}
                      onChange={() =>
                        setSelectedProposalIds((prev) =>
                          checked ? prev.filter((id) => id !== proposal.id) : [...prev, proposal.id]
                        )
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{proposal.title}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {proposal.fromDate} to {proposal.toDate} - {proposal.estimatedMinutes}m
                      </p>
                      <p className="mt-1 text-xs text-muted/80">{proposal.reason}</p>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {overdueRoots.length >= 3 && !rescueDismissed && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-foreground">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-medium">{overdueRoots.length} overdue tasks. Move them into today?</span>
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
          <ul className="mt-2 space-y-1">
            {overdueRoots.slice(0, 5).map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-xs text-amber-200/80">
                <AlertTriangle size={10} className="shrink-0 text-amber-400/60" />
                <span className="truncate">{t.title}</span>
                <span className="shrink-0 text-amber-400/50">{t.dueDate?.slice(0, 10) ?? t.scheduledDate?.slice(0, 10)}</span>
              </li>
            ))}
            {overdueRoots.length > 5 && (
              <li className="text-xs text-amber-400/50">…and {overdueRoots.length - 5} more</li>
            )}
          </ul>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
        <div className="space-y-5">
          <section className="rounded-lg border border-white/10 bg-surface">
            <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <Clock size={14} className="text-primary" />
                  Work block
                </div>
                <h2 className="mt-1 text-base font-semibold text-foreground">
                  {activeItem?.title ?? "No active block"}
                </h2>
                {activeItem?.parentTitle && (
                  <p className="mt-1 text-xs text-muted">{activeItem.parentTitle}</p>
                )}
              </div>
              <div className="text-left sm:text-right">
                <p
                  className={cn(
                    "font-mono text-2xl font-semibold tabular-nums",
                    isTimerRunningForActive ? "text-primary" : "text-foreground/70"
                  )}
                >
                  {isTimerRunningForActive ? formatElapsed(elapsed) : "00:00:00"}
                </p>
                <p className="text-xs text-muted">
                  {activeItem?.scheduledTime ? activeItem.scheduledTime.slice(0, 5) : "Start when ready"}
                </p>
              </div>
            </div>

            {activeItem ? (
              <div className="grid gap-4 p-4 md:grid-cols-[1fr_auto] md:items-center">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  {activeItem.estimatedMinutes && (
                    <span className="rounded border border-white/10 bg-white/5 px-2 py-1">
                      {activeItem.estimatedMinutes}m estimate
                    </span>
                  )}
                  <span className={cn("rounded border px-2 py-1 capitalize", priorityClass(activeItem.priorityLabel))}>
                    {activeItem.priorityLabel}
                  </span>
                  <span className="rounded border border-white/10 bg-white/5 px-2 py-1 capitalize">
                    {activeItem.physicalEnergy} energy
                  </span>
                </div>
                <div className="flex gap-2">
                  {isTimerRunningForActive ? (
                    <button
                      onClick={() => stopActiveTimer()}
                      disabled={isStopping}
                      className="inline-flex min-w-[120px] items-center justify-center gap-2 rounded-lg bg-danger px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                    >
                      <Square size={16} className="fill-current" />
                      Stop
                    </button>
                  ) : (
                    <button
                      onClick={() => startTimer(activeItem.taskId)}
                      disabled={isStarting || isRunning}
                      title={isRunning ? "Stop the current active timer first" : "Start timer"}
                      className="inline-flex min-w-[120px] items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
                    >
                      <Play size={16} className="fill-current" />
                      Start
                    </button>
                  )}
                  <button
                    onClick={() => doneMut.mutate({ id: activeItem.id, type: activeItem.type })}
                    disabled={doneMut.isPending}
                    className="inline-flex min-w-[120px] items-center justify-center gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-2.5 text-sm font-semibold text-success transition-colors hover:bg-success/20 disabled:opacity-50"
                  >
                    <CheckCircle2 size={16} />
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4">
                <p className="text-sm text-muted">Pick a task to start your work block.</p>
                {unscheduledRoots.length > 0 ? (
                  <select
                    className="mt-2 w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm text-foreground"
                    defaultValue=""
                    onChange={(e) => {
                      const id = e.target.value;
                      if (id) rescueMut.mutate([id]);
                    }}
                  >
                    <option value="" disabled>Select a task from Inbox…</option>
                    {unscheduledRoots.slice(0, 10).map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title} ({task.priority})
                      </option>
                    ))}
                  </select>
                ) : (
                  <Link href="/backlog" className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-2 text-xs font-medium text-foreground hover:bg-white/15 transition-colors">
                    <Inbox size={14} />
                    Go to Inbox
                  </Link>
                )}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-white/10 bg-surface">
            <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <ListChecks size={14} className="text-primary" />
                  Today tasks
                </div>
                <p className="mt-1 text-sm text-foreground">
                  {todayFocusItems.length} task{todayFocusItems.length !== 1 ? "s" : ""} added · Recommended: 3–7
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px] text-muted">
                <span className="rounded border border-white/10 bg-white/5 px-2 py-1">1 big: {taskMix.big}</span>
                <span className="rounded border border-white/10 bg-white/5 px-2 py-1">3 medium: {taskMix.medium}</span>
                <span className="rounded border border-white/10 bg-white/5 px-2 py-1">5 small: {taskMix.small}</span>
              </div>
            </div>

            {q.isLoading ? (
              <div className="space-y-2 p-4">
                <SkeletonListItem />
                <SkeletonListItem />
              </div>
            ) : todayFocusItems.length > 0 ? (
              <ul className="divide-y divide-white/5">
                {todayFocusItems.map((item) => {
                  const active = item.id === activeItem?.id;
                  return (
                    <li
                      key={item.id}
                      className={cn(
                        "grid gap-3 px-4 py-3 transition-colors sm:grid-cols-[auto_1fr_auto] sm:items-center",
                        active ? "bg-primary/5" : "hover:bg-white/[0.03]"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => doneMut.mutate({ id: item.id, type: item.type })}
                        className="hidden text-muted transition-colors hover:text-success sm:block"
                        aria-label={`Complete ${item.title}`}
                      >
                        <Circle size={18} />
                      </button>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {active && (
                            <span className="rounded border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                              Now
                            </span>
                          )}
                          <p className="min-w-0 truncate text-sm font-medium text-foreground">{item.title}</p>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                          {item.parentTitle && <span className="truncate">{item.parentTitle}</span>}
                          {item.scheduledTime && <span>{item.scheduledTime.slice(0, 5)}</span>}
                          {item.estimatedMinutes && <span>{item.estimatedMinutes}m</span>}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "w-fit rounded border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
                          priorityClass(item.priorityLabel)
                        )}
                      >
                        {item.priorityLabel}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="p-4">
                <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center">
                  <Inbox size={28} className="mx-auto mb-3 text-primary/50" />
                  <p className="font-semibold text-foreground">Nothing scheduled for today.</p>
                  <p className="mt-1 text-sm text-muted">Move 3-7 tasks here before you start.</p>
                </div>
              </div>
            )}

            {!q.isLoading && !hasScheduledItems && !inboxQ.isLoading && unscheduledRoots.length > 0 && (
              <div className="border-t border-white/10 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Pull from Inbox
                  </p>
                  <Link href="/backlog" className="text-xs font-medium text-primary hover:underline">
                    Open Inbox
                  </Link>
                </div>
                <ul className="space-y-2">
                  {unscheduledRoots.slice(0, 5).map((task) => (
                    <li
                      key={task.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-background/40 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
                        <p className="mt-0.5 text-xs capitalize text-muted">{task.priority}</p>
                      </div>
                      <button
                        type="button"
                        disabled={rescueMut.isPending}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-primary/20 hover:text-primary disabled:opacity-50"
                        onClick={() => rescueMut.mutate([task.id])}
                      >
                        <CalendarPlus size={12} />
                        Today
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-5">
          <section className="rounded-lg border border-white/10 bg-surface">
            <div className="border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                <Trophy size={14} className="text-emerald-300" />
                Weekly review + wins
              </div>
              <p className="mt-1 text-sm text-foreground">Proof of progress</p>
            </div>
            <div className="grid grid-cols-2 divide-x divide-white/10 border-b border-white/10">
              <div className="px-4 py-3">
                <p className="text-2xl font-semibold text-foreground">{winsToday}</p>
                <p className="text-xs text-muted">done today</p>
              </div>
              <div className="px-4 py-3">
                <p className="text-2xl font-semibold text-foreground">{plannedTodayCount}</p>
                <p className="text-xs text-muted">planned today</p>
              </div>
            </div>
            <div className="p-4">
              <Link
                href="/review"
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
              >
                Go to Weekly Review
                <ArrowRight size={14} />
              </Link>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <Target size={14} className="text-primary" />
              Win condition
            </div>
            <PriorityAnchorsCard variant="week" />
          </section>
        </aside>
      </div>
    </div>
  );
}
