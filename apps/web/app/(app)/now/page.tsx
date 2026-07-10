"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStatus } from "@/hooks/use-auth-status";
import confetti from "canvas-confetti";
import { AlertTriangle, CheckCircle2, Play, Square } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { GettingStartedCard } from "@/components/getting-started-card";
import { GlobalTimerIndicator } from "@/components/GlobalTimerIndicator";
import { useActiveTimer } from "@/hooks/use-active-timer";

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

type DoneVars = {
  id: string;
  type: "task" | "subtask";
  title?: string;
  priorityLabel?: string;
  taskId?: string;
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

function itemSize(item: NowItem): "big" | "medium" | "small" {
  if ((item.estimatedMinutes ?? 0) >= 90 || item.priorityLabel === "urgent") return "big";
  if ((item.estimatedMinutes ?? 0) >= 30 || item.priorityLabel === "high") return "medium";
  return "small";
}

function itemTime(item: NowItem): string {
  return item.scheduledTime ? item.scheduledTime.slice(0, 5) : "Anytime";
}

function isHighPriority(label: string): boolean {
  return label === "high" || label === "urgent";
}

/** Inline HIGH marker used next to task titles (design: 11px uppercase, --high). */
function HighLabel() {
  return (
    <span className="ml-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--high)]">
      High
    </span>
  );
}

export default function NowPage() {
  const { status } = useAuthStatus();
  const userId = useAppUserId();
  const qc = useQueryClient();
  const router = useRouter();
  const [energyFilter, setEnergyFilter] = useState<PhysicalEnergyLevel | "">("");
  const [rescueDismissed, setRescueDismissed] = useState(false);
  const [showFinished, setShowFinished] = useState(false);
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
    mutationFn: async ({ id, type }: DoneVars) => {
      if (type === "task") return patchTask(id, { status: "done" });
      return patchSubtask(id, { completed: true });
    },
    onSuccess: (data, vars) => {
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        confetti({
          particleCount: 80,
          spread: 60,
          origin: { y: 0.9 },
          colors: ["#2dd4bf", "#818cf8", "#f472b6"],
        });
      }
      const next = (data as { spawnedNext?: TaskRow | null }).spawnedNext;
      if (next) {
        const nextDate = next.scheduledDate ?? next.dueDate;
        toast.success(`Recurring task — next one ${nextDate ? `scheduled for ${nextDate}` : "created"}.`);
      }
      // Nudge: finishing a meaningful task is worth capturing as proof of progress.
      if (vars.type === "task" && (vars.priorityLabel === "urgent" || vars.priorityLabel === "high") && vars.title) {
        toast("Nice work — log this win?", {
          description: "Save it to Accomplishments for reviews and CVs.",
          action: {
            label: "Log win",
            onClick: () =>
              router.push(
                `/review?view=accomplishments&title=${encodeURIComponent(vars.title ?? "")}&taskId=${encodeURIComponent(vars.taskId ?? "")}`
              ),
          },
        });
      }
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

  // "Finished earlier" agenda rows — done root tasks scheduled today + completed subtasks.
  const finishedToday = useMemo(() => {
    const rows: { id: string; title: string; time: string }[] = [];
    for (const t of q.data?.tasks ?? []) {
      const todaySubs = (t._subtasks ?? []).filter((s) => s.scheduledDate === todayLocal);
      if (todaySubs.length > 0) {
        for (const s of todaySubs) {
          if (s.completed) {
            rows.push({ id: s.id, title: s.title, time: s.scheduledTime?.slice(0, 5) ?? "—" });
          }
        }
      } else if (t.status === "done") {
        rows.push({ id: t.id, title: t.title, time: "—" });
      }
    }
    return rows;
  }, [q.data?.tasks, todayLocal]);

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
      <div className="mx-auto max-w-[1160px] space-y-4">
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
  const winsToday = q.data?.doneTodayCount ?? finishedToday.length;
  const totalToday = winsToday + todayFocusItems.length;
  const weekday = new Date(todayLocal + "T12:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const statusLine = `${winsToday} of ${totalToday} done · ${
    overdueRoots.length > 0
      ? `${overdueRoots.length} overdue`
      : "nothing overdue"
  }`;
  const elapsedMins = Math.floor(elapsed / 60);
  const heroMeta = activeItem
    ? [
        activeItem.parentTitle,
        activeItem.estimatedMinutes ? `${activeItem.estimatedMinutes}m estimate` : null,
        isHighPriority(activeItem.priorityLabel) ? `${activeItem.priorityLabel} priority` : null,
        `${activeItem.physicalEnergy} energy`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const completeItem = (item: NowItem) =>
    doneMut.mutate({
      id: item.id,
      type: item.type,
      title: item.type === "task" ? item.title : item.parentTitle,
      priorityLabel: item.priorityLabel,
      taskId: item.taskId,
    });

  return (
    <div className="mx-auto flex max-w-[1160px] flex-col gap-7 pb-6">
      {/* ─── Header ─────────────────────────────────────────────── */}
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--teal)]">
            <time dateTime={todayLocal}>{weekday}</time>
          </p>
          {/* Mobile: the nav timer chip lives here, inline with the date eyebrow. */}
          <GlobalTimerIndicator className="md:hidden" />
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className="mt-1.5 font-display text-[32px] leading-[1.05] text-[var(--ink)] md:text-[52px]">
            A deep-work kind of day.
          </h1>
          <p className="shrink-0 text-sm text-muted">{statusLine}</p>
        </div>
        {hasCapacityData && (
          <div className="mt-5 flex items-center gap-3">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--track)]">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-300",
                  used > capacity ? "bg-[var(--high)]" : "bg-[var(--teal)]"
                )}
                style={{ width: `${capacityPercent}%` }}
              />
            </div>
            <span className="text-xs text-muted">
              Capacity {used} / {capacity} min
            </span>
          </div>
        )}
      </header>

      {/* Only pitch onboarding when data actually loaded — an outage is not an empty planner. */}
      {!q.isLoading && !inboxQ.isLoading && !tasksForRescue.isLoading &&
        !q.isError && !inboxQ.isError && !tasksForRescue.isError && (
        <GettingStartedCard
          hasAnyTask={allRootTasks.length > 0 || (inboxQ.data?.length ?? 0) > 0}
          hasTodayPlan={hasScheduledItems}
        />
      )}

      {/* ─── Rollover proposals ─────────────────────────────────── */}
      {scheduleProposals.length > 0 && (
        <section className="rounded-2xl border border-[var(--teal-a30)] bg-[var(--card)] p-5 shadow-[var(--card-shadow)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-display text-[22px] text-[var(--ink)]">Review schedule changes</h2>
              <p className="mt-1 text-[13px] text-muted">
                Unfinished work can roll forward. Nothing changes until you approve it.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                className="rounded-full border border-[var(--hairline)] px-[18px] py-[9px] text-[13px] text-muted transition-colors hover:text-[var(--ink)]"
                onClick={() => {
                  setScheduleProposals([]);
                  setSelectedProposalIds([]);
                }}
              >
                Dismiss
              </button>
              <button
                type="button"
                className="rounded-full bg-[var(--ink-btn-bg)] px-5 py-[9px] text-[13px] font-semibold text-[var(--ink-btn-fg)] transition-opacity hover:opacity-85 disabled:opacity-40"
                disabled={selectedProposals.length === 0 || applyScheduleMut.isPending}
                onClick={() => applyScheduleMut.mutate(selectedProposals)}
              >
                {applyScheduleMut.isPending ? "Applying" : `Apply ${selectedProposals.length}`}
              </button>
            </div>
          </div>
          <ul className="mt-4">
            {scheduleProposals.map((proposal) => {
              const checked = selectedProposalIds.includes(proposal.id);
              return (
                <li key={proposal.id} className="border-b border-[var(--hairline-soft)] py-3 last:border-b-0">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 accent-[var(--teal)]"
                      checked={checked}
                      onChange={() =>
                        setSelectedProposalIds((prev) =>
                          checked ? prev.filter((id) => id !== proposal.id) : [...prev, proposal.id]
                        )
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium text-[var(--ink)]">{proposal.title}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {proposal.fromDate} to {proposal.toDate} · {proposal.estimatedMinutes}m
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted-soft)]">{proposal.reason}</p>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ─── Overdue rescue ─────────────────────────────────────── */}
      {overdueRoots.length >= 3 && !rescueDismissed && (
        <section className="rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-5 shadow-[var(--card-shadow)]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[15px] font-medium text-[var(--ink)]">
              <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--high)]">
                Overdue
              </span>
              {overdueRoots.length} tasks slipped. Move them into today?
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => rescueMut.mutate(overdueRoots.map((t) => t.id))}
                disabled={rescueMut.isPending}
                className="rounded-full bg-[var(--ink-btn-bg)] px-[18px] py-[9px] text-[13px] font-semibold text-[var(--ink-btn-fg)] transition-opacity hover:opacity-85 disabled:opacity-40"
              >
                Reschedule all
              </button>
              <button
                onClick={() => setRescueDismissed(true)}
                className="rounded-full border border-[var(--hairline)] px-[18px] py-[9px] text-[13px] text-muted transition-colors hover:text-[var(--ink)]"
              >
                Dismiss
              </button>
            </div>
          </div>
          <ul className="mt-3">
            {overdueRoots.slice(0, 5).map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-2 border-b border-[var(--hairline-soft)] py-2 text-[13px] text-muted last:border-b-0"
              >
                <AlertTriangle size={11} className="shrink-0 text-[var(--high)]" />
                <span className="min-w-0 truncate">{t.title}</span>
                <span className="shrink-0 text-[var(--muted-soft)]">
                  {t.dueDate?.slice(0, 10) ?? t.scheduledDate?.slice(0, 10)}
                </span>
              </li>
            ))}
            {overdueRoots.length > 5 && (
              <li className="py-2 text-xs text-[var(--muted-soft)]">…and {overdueRoots.length - 5} more</li>
            )}
          </ul>
        </section>
      )}

      {/* ─── Agenda + margin notes ──────────────────────────────── */}
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-12">
        <div className="flex flex-col">
          {q.isLoading ? (
            <div className="space-y-2">
              <SkeletonListItem />
              <SkeletonListItem />
            </div>
          ) : q.isError ? (
            <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-10 text-center shadow-[var(--card-shadow)]">
              <h2 className="font-display text-[26px] italic text-[var(--ink)]">Couldn&apos;t load today.</h2>
              <p className="mt-2 text-sm text-muted">Your plan is safe — check your connection and retry.</p>
              <button
                type="button"
                onClick={() => void q.refetch()}
                className="mt-5 rounded-full bg-[var(--ink-btn-bg)] px-5 py-[11px] text-[13px] font-semibold text-[var(--ink-btn-fg)] transition-opacity hover:opacity-85"
              >
                Retry
              </button>
            </div>
          ) : activeItem ? (
            <>
              {/* Hero agenda card */}
              <div className="grid items-center gap-4 rounded-2xl border border-[var(--teal-a30)] bg-[var(--card)] px-6 py-[22px] shadow-[var(--card-shadow)] md:grid-cols-[72px_minmax(0,1fr)_auto] md:gap-5">
                <div className="hidden text-right md:block">
                  <p className="text-[13px] font-semibold text-[var(--teal)]">{itemTime(activeItem)}</p>
                  {activeItem.estimatedMinutes && (
                    <p className="mt-0.5 text-[11px] text-muted">{activeItem.estimatedMinutes}m</p>
                  )}
                </div>
                <div className="min-w-0 border-l-2 border-[var(--teal)] pl-5">
                  <p
                    className={cn(
                      "text-[11px] font-semibold uppercase tracking-[0.08em]",
                      isTimerRunningForActive ? "text-[var(--teal)]" : "text-muted"
                    )}
                  >
                    {isTimerRunningForActive
                      ? `In progress · ${elapsedMins} min`
                      : "Up now · start when ready"}
                  </p>
                  <h2 className="mt-1 font-display text-[23px] leading-[1.2] text-[var(--ink)] md:text-[26px]">
                    {activeItem.title}
                  </h2>
                  {heroMeta && <p className="mt-1 text-[13px] text-muted">{heroMeta}</p>}
                </div>
                <div className="flex gap-2 max-md:w-full">
                  {isTimerRunningForActive ? (
                    <button
                      onClick={() => stopActiveTimer()}
                      disabled={isStopping}
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--ink-btn-bg)] px-5 py-[11px] text-[13px] font-semibold text-[var(--ink-btn-fg)] transition-opacity hover:opacity-85 disabled:opacity-50 max-md:flex-1"
                    >
                      <Square size={12} className="fill-current" />
                      Stop
                    </button>
                  ) : (
                    <button
                      onClick={() => startTimer(activeItem.taskId)}
                      disabled={isStarting || isRunning}
                      title={isRunning ? "Stop the current active timer first" : "Start timer"}
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--ink-btn-bg)] px-5 py-[11px] text-[13px] font-semibold text-[var(--ink-btn-fg)] transition-opacity hover:opacity-85 disabled:opacity-50 max-md:flex-1"
                    >
                      <Play size={12} className="fill-current" />
                      Start
                    </button>
                  )}
                  <button
                    onClick={() => completeItem(activeItem)}
                    disabled={doneMut.isPending}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--success-border)] bg-[var(--success-bg)] px-5 py-[11px] text-[13px] font-semibold text-[var(--success-text)] transition-opacity hover:opacity-85 disabled:opacity-50 max-md:flex-1"
                  >
                    <CheckCircle2 size={12} />
                    Done
                  </button>
                </div>
              </div>

              {/* Agenda rows */}
              {upNextItems.map((item) => (
                <div
                  key={item.id}
                  className="grid items-center gap-5 border-b border-[var(--hairline-soft)] px-6 py-[18px] grid-cols-[56px_minmax(0,1fr)_auto] md:grid-cols-[72px_minmax(0,1fr)_auto]"
                >
                  <div className="text-right">
                    <p
                      className={cn(
                        "text-[13px] font-medium",
                        item.scheduledTime ? "text-[var(--ink)]" : "text-muted"
                      )}
                    >
                      {itemTime(item)}
                    </p>
                    {item.estimatedMinutes && (
                      <p className="mt-0.5 text-[11px] text-muted">{item.estimatedMinutes}m</p>
                    )}
                  </div>
                  <div className="min-w-0 border-l-2 border-[var(--hairline)] pl-5">
                    <p className="text-[15px] font-medium text-[var(--ink)]">
                      {item.title}
                      {isHighPriority(item.priorityLabel) && <HighLabel />}
                    </p>
                    {item.parentTitle && (
                      <p className="mt-0.5 text-xs text-muted">{item.parentTitle}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => completeItem(item)}
                    disabled={doneMut.isPending}
                    aria-label={`Complete ${item.title}`}
                    title="Mark done"
                    className="h-5 w-5 shrink-0 rounded-full border-2 border-[var(--rule)] bg-transparent p-0 transition-colors hover:border-[var(--success-text)] hover:bg-[var(--success-bg)] disabled:opacity-40"
                  />
                </div>
              ))}
            </>
          ) : hasScheduledItems || winsToday > 0 ? (
            /* Everything planned is finished */
            <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-10 text-center shadow-[var(--card-shadow)]">
              <h2 className="font-display text-[28px] italic text-[var(--ink)]">Day cleared.</h2>
              <p className="mt-2 text-sm text-muted">
                Everything planned for today is done. Log a win, or pull something from the{" "}
                <Link href="/backlog" className="text-[var(--teal)] hover:underline">
                  Inbox
                </Link>
                .
              </p>
            </div>
          ) : (
            /* Nothing scheduled yet */
            <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-10 text-center shadow-[var(--card-shadow)]">
              <h2 className="font-display text-[28px] italic text-[var(--ink)]">Nothing on the agenda.</h2>
              <p className="mt-2 text-sm text-muted">
                Move 3–7 tasks here before you start — capture fast with Brain dump, or pull from the{" "}
                <Link href="/backlog" className="text-[var(--teal)] hover:underline">
                  Inbox
                </Link>
                .
              </p>
            </div>
          )}

          {/* Finished earlier */}
          {finishedToday.length > 0 && (
            <div className="mt-3 px-6">
              <button
                type="button"
                className="text-[13px] text-[var(--teal)] hover:underline"
                onClick={() => setShowFinished((s) => !s)}
              >
                {showFinished ? "Hide finished" : `${finishedToday.length} finished earlier — show`}
              </button>
            </div>
          )}
          {showFinished && (
            <div className="mt-1">
              {finishedToday.map((row) => (
                <div
                  key={row.id}
                  className="grid items-center gap-5 border-b border-[var(--hairline-soft)] px-6 py-3.5 opacity-55 grid-cols-[56px_minmax(0,1fr)_auto] md:grid-cols-[72px_minmax(0,1fr)_auto]"
                >
                  <p className="text-right text-[13px] font-medium text-muted">{row.time}</p>
                  <p className="min-w-0 border-l-2 border-[var(--hairline)] pl-5 text-[15px] font-medium text-[var(--ink)] line-through">
                    {row.title}
                  </p>
                  <CheckCircle2 size={20} className="shrink-0 text-[var(--success-text)]" />
                </div>
              ))}
            </div>
          )}

          {/* Pull from Inbox when the agenda is empty */}
          {!q.isLoading && !hasScheduledItems && !inboxQ.isLoading && unscheduledRoots.length > 0 && (
            <div className="mt-6">
              <div className="mb-2.5 flex items-baseline justify-between gap-3">
                <h3 className="font-display text-[19px] italic text-[var(--ink)]">Pull from Inbox</h3>
                <Link href="/backlog" className="text-[13px] text-[var(--teal)] hover:underline">
                  Open Inbox →
                </Link>
              </div>
              <div className="overflow-hidden rounded-[14px] border border-[var(--hairline)] bg-[var(--card)] shadow-[var(--card-shadow)]">
                {unscheduledRoots.slice(0, 5).map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-3.5 border-b border-[var(--hairline-soft)] px-5 py-[15px] last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium text-[var(--ink)]">
                        {task.title}
                        {isHighPriority(task.priority) && <HighLabel />}
                      </p>
                      <p className="mt-0.5 text-xs capitalize text-muted">{task.priority} priority</p>
                    </div>
                    <button
                      type="button"
                      disabled={rescueMut.isPending}
                      className="shrink-0 whitespace-nowrap text-[13px] text-[var(--teal)] hover:underline disabled:opacity-50"
                      onClick={() => rescueMut.mutate([task.id])}
                    >
                      Add to today →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ─── Margin notes ───────────────────────────────────────── */}
        <aside className="flex flex-col gap-7 border-t border-[var(--hairline-soft)] pt-7 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <div>
            <h3 className="font-display text-[19px] italic text-[var(--ink)]">Win condition</h3>
            <PriorityAnchorsCard variant="margin" className="mt-3" />
          </div>
          <div>
            <h3 className="font-display text-[19px] italic text-[var(--ink)]">Progress</h3>
            <p className="mt-2.5 font-display text-[34px] text-[var(--ink)]">
              {winsToday}
              <span className="text-[20px] text-muted"> / {totalToday}</span>
            </p>
            <p className="mt-0.5 text-[13px] text-muted">tasks done today</p>
            <div className="mt-2.5 flex flex-col items-start gap-1.5">
              <Link href="/review" className="text-[13px] text-[var(--teal)] hover:underline">
                Weekly review →
              </Link>
              <button
                type="button"
                onClick={() => autoScheduleMut.mutate()}
                disabled={autoScheduleMut.isPending}
                className="text-[13px] text-[var(--teal)] hover:underline disabled:opacity-50"
                title="Preview unfinished work that should roll forward"
              >
                {autoScheduleMut.isPending ? "Reviewing…" : "Preview rollover"}
              </button>
            </div>
          </div>
          <div>
            <h3 className="font-display text-[19px] italic text-[var(--ink)]">Mix</h3>
            <p className="mt-2.5 text-[13px] leading-[1.6] text-muted">
              {taskMix.big} big · {taskMix.medium} medium · {taskMix.small} small
            </p>
            <label className="mt-1.5 flex items-center gap-2 text-[13px] text-muted">
              {energyFilter ? (
                <span className="capitalize">{energyFilter}-energy filter on ·</span>
              ) : (
                <span>Energy filter off ·</span>
              )}
              <select
                className="cursor-pointer border-none bg-transparent p-0 text-[13px] text-[var(--teal)] focus:outline-none"
                value={energyFilter}
                onChange={(e) =>
                  persistEnergy(e.target.value === "" ? "" : (e.target.value as PhysicalEnergyLevel))
                }
                aria-label="Filter agenda by energy"
              >
                <option value="">all tasks</option>
                <option value="low">low energy</option>
                <option value="medium">medium energy</option>
                <option value="high">high energy</option>
              </select>
            </label>
          </div>
        </aside>
      </div>
    </div>
  );
}
