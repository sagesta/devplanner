"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStatus } from "@/hooks/use-auth-status";
import confetti from "canvas-confetti";
import { AlertTriangle, CheckCircle2, Play, Square } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import {
  fetchBacklog,
  fetchTasks,
  fetchToday,
  patchTask,
  patchSubtask,
  postAutoSchedule,
  postScheduleApply,
  type ScheduleProposal,
  type TaskRow,
} from "@/lib/api";
import {
  LS_PHYSICAL_ENERGY,
  type PhysicalEnergyLevel,
} from "@/lib/planner-prefs";
import { SkeletonListItem } from "@/lib/skeleton";
import { cn, isTaskOverdue } from "@/lib/utils";
import { PriorityAnchorsCard } from "@/components/priority-anchors-card";
import { GettingStartedCard } from "@/components/getting-started-card";
import { GlobalTimerIndicator } from "@/components/GlobalTimerIndicator";
import { useActiveTimer } from "@/hooks/use-active-timer";
import { useCalendarDate } from "@/hooks/use-calendar-date";
import {
  fetchDailyFocus,
  fetchDailyPreferences,
  moveDaily,
  newIdempotencyKey,
  putDailyFocus,
  type ExecutionTarget,
} from "@/lib/daily-api";
import { TaskDetailPanel } from "@/components/TaskDetailPanel";

function readEnergyFilter(): PhysicalEnergyLevel | "" {
  const saved = localStorage.getItem(LS_PHYSICAL_ENERGY);
  return saved === "low" || saved === "medium" || saved === "high" ? saved : "";
}
function subscribeEnergyFilter(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("devplanner-energy-filter-change", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("devplanner-energy-filter-change", listener);
  };
}

function localISODate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 3,
  high: 2,
  normal: 1,
  low: 0,
};

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
  revision: number;
};

type DoneVars = {
  id: string;
  type: "task" | "subtask";
  title?: string;
  priorityLabel?: string;
  taskId?: string;
};

function handleDialogKeys(
  event: React.KeyboardEvent<HTMLElement>,
  close: () => void,
) {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== "Tab") return;
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      "input:not(:disabled),button:not(:disabled),select:not(:disabled)",
    ),
  );
  if (!controls.length) return;
  if (event.shiftKey && document.activeElement === controls[0]) {
    event.preventDefault();
    controls[controls.length - 1]?.focus();
  } else if (
    !event.shiftKey &&
    document.activeElement === controls[controls.length - 1]
  ) {
    event.preventDefault();
    controls[0]?.focus();
  }
}

function isOpenTask(task: TaskRow): boolean {
  return task.status !== "done" && task.status !== "cancelled";
}

function compareTasksForExecution(a: TaskRow, b: TaskRow): number {
  const priorityDelta =
    (PRIORITY_ORDER[b.priority] ?? 1) - (PRIORITY_ORDER[a.priority] ?? 1);
  if (priorityDelta !== 0) return priorityDelta;
  const aDate = a.dueDate ?? a.scheduledDate ?? "9999-12-31";
  const bDate = b.dueDate ?? b.scheduledDate ?? "9999-12-31";
  return aDate.localeCompare(bDate);
}

function itemSize(item: NowItem): "big" | "medium" | "small" {
  if ((item.estimatedMinutes ?? 0) >= 90 || item.priorityLabel === "urgent")
    return "big";
  if ((item.estimatedMinutes ?? 0) >= 30 || item.priorityLabel === "high")
    return "medium";
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
  const energyFilter = useSyncExternalStore(
    subscribeEnergyFilter,
    readEnergyFilter,
    () => "",
  );
  const [rescueDismissed, setRescueDismissed] = useState(false);
  const [showFinished, setShowFinished] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerSelected, setPickerSelected] = useState<string[]>([]);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [detailSubtaskId, setDetailSubtaskId] = useState<string | null>(null);
  const [moveItem, setMoveItem] = useState<NowItem | null>(null);
  const [pendingCompletion, setPendingCompletion] = useState<NowItem | null>(
    null,
  );
  const [stoppingForCompletion, setStoppingForCompletion] = useState(false);
  const [moveDate, setMoveDate] = useState("");
  const moveOpenerRef = useRef<HTMLElement | null>(null);
  const completionOpenerRef = useRef<HTMLElement | null>(null);
  const moveKeysRef = useRef(new Map<string, string>());

  useEffect(() => {
    if (!moveItem) return;
    moveOpenerRef.current = document.activeElement as HTMLElement;
    document.getElementById("daily-move-date")?.focus();
    return () => moveOpenerRef.current?.focus();
  }, [moveItem]);
  useEffect(() => {
    if (!pendingCompletion) return;
    completionOpenerRef.current = document.activeElement as HTMLElement;
    document.getElementById("daily-completion-cancel")?.focus();
    return () => completionOpenerRef.current?.focus();
  }, [pendingCompletion]);
  const [scheduleProposals, setScheduleProposals] = useState<
    ScheduleProposal[]
  >([]);
  const [schedulePreviewId, setSchedulePreviewId] = useState("");
  const [scheduleApplyKey, setScheduleApplyKey] = useState("");
  const [selectedProposalIds, setSelectedProposalIds] = useState<string[]>([]);
  const preferencesQ = useQuery({
    queryKey: ["daily-preferences", userId],
    queryFn: fetchDailyPreferences,
    enabled: Boolean(userId),
  });
  const todayLocal = useCalendarDate(preferencesQ.data?.timezone);
  const dateReady = preferencesQ.isSuccess;
  const moveWithReceipt = (targets: ExecutionTarget[], date: string) => {
    const fingerprint = JSON.stringify({ userId, targets, date });
    let key = moveKeysRef.current.get(fingerprint);
    if (!key) {
      key = newIdempotencyKey();
      moveKeysRef.current.set(fingerprint, key);
    }
    return moveDaily(targets, date, key);
  };

  const {
    isRunning,
    elapsed,
    activeLog,
    startTimer,
    stopActiveTimer,
    isStarting,
    isStopping,
  } = useActiveTimer();

  const q = useQuery({
    queryKey: ["tasks-today", userId, todayLocal],
    queryFn: () => fetchToday(todayLocal),
    enabled: Boolean(userId) && dateReady,
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
  const focusQ = useQuery({
    queryKey: ["daily-focus", userId, todayLocal],
    queryFn: () => fetchDailyFocus(todayLocal),
    enabled: Boolean(userId) && dateReady,
  });
  const focusMut = useMutation({
    mutationFn: (item: NowItem) =>
      putDailyFocus({
        date: todayLocal,
        targetType: item.type,
        targetId: item.id,
      }),
    onSuccess: () => {
      toast.success(isRunning ? "Next after current saved" : "Up next saved");
      void qc.invalidateQueries({
        queryKey: ["daily-focus", userId, todayLocal],
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const moveMut = useMutation({
    mutationFn: ({
      targets,
      date,
    }: {
      targets: ExecutionTarget[];
      date: string;
    }) => moveWithReceipt(targets, date),
    onSuccess: (_result, vars) => {
      toast.success(
        vars.date === todayLocal ? "Added to Today" : "Planned date saved",
      );
      setMoveItem(null);
      setPickerSelected([]);
      setPickerOpen(false);
      void qc.invalidateQueries({ queryKey: ["tasks-today"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["backlog"] });
      void qc.invalidateQueries({ queryKey: ["daily-focus"] });
      void qc.invalidateQueries({ queryKey: ["calendar-progress"] });
    },
    onError: (error: Error) =>
      toast.error(
        `${error.message}. Refresh and retry if this item changed elsewhere.`,
      ),
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
        toast.success(
          `Recurring task — next one ${nextDate ? `scheduled for ${nextDate}` : "created"}.`,
        );
      }
      // Nudge: finishing a meaningful task is worth capturing as proof of progress.
      if (
        vars.type === "task" &&
        (vars.priorityLabel === "urgent" || vars.priorityLabel === "high") &&
        vars.title
      ) {
        toast("Nice work — log this win?", {
          description: "Save it to Accomplishments for reviews and CVs.",
          action: {
            label: "Log win",
            onClick: () =>
              router.push(
                `/review?view=accomplishments&title=${encodeURIComponent(vars.title ?? "")}&taskId=${encodeURIComponent(vars.taskId ?? "")}`,
              ),
          },
        });
      }
      void qc.invalidateQueries({
        queryKey: ["tasks-today", userId, todayLocal],
      });
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      void qc.invalidateQueries({ queryKey: ["backlog", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rescueMut = useMutation({
    mutationFn: (ids: string[]) => {
      const source = [...(tasksForRescue.data ?? []), ...(inboxQ.data ?? [])];
      const targets = ids
        .map((id) => source.find((task) => task.id === id))
        .filter((task): task is TaskRow => Boolean(task))
        .map((task) => ({
          targetType: "task" as const,
          targetId: task.id,
          expectedRevision: task.revision,
        }));
      return moveWithReceipt(targets, todayLocal);
    },
    onSuccess: () => {
      toast.success("Tasks scheduled for today");
      void qc.invalidateQueries({
        queryKey: ["tasks-today", userId, todayLocal],
      });
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      void qc.invalidateQueries({ queryKey: ["backlog", userId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const autoScheduleMut = useMutation({
    mutationFn: () => postAutoSchedule(todayLocal),
    onSuccess: (data) => {
      if (data.error) throw new Error(data.error);
      const proposals = data.proposals ?? [];
      setSchedulePreviewId(data.previewId);
      setScheduleApplyKey(newIdempotencyKey());
      setScheduleProposals(proposals);
      setSelectedProposalIds(proposals.map((p) => p.id));
      if (proposals.length === 0)
        toast.success("No unfinished work needs moving.");
    },
    onError: (e: Error) => toast.error(`Auto-schedule failed: ${e.message}`),
  });

  const applyScheduleMut = useMutation({
    mutationFn: (ids: string[]) =>
      postScheduleApply(schedulePreviewId, ids, scheduleApplyKey),
    onSuccess: (data) => {
      toast.success(`Applied ${data.applied} schedule change(s).`);
      setScheduleProposals([]);
      setSchedulePreviewId("");
      setSelectedProposalIds([]);
      void qc.invalidateQueries({
        queryKey: ["tasks-today", userId, todayLocal],
      });
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      void qc.invalidateQueries({ queryKey: ["backlog", userId] });
      void qc.invalidateQueries({ queryKey: ["calendar-progress"] });
    },
    onError: (e: Error) =>
      toast.error(`Could not apply schedule: ${e.message}`),
  });

  const persistEnergy = useCallback((next: PhysicalEnergyLevel | "") => {
    if (next) localStorage.setItem(LS_PHYSICAL_ENERGY, next);
    else localStorage.removeItem(LS_PHYSICAL_ENERGY);
    window.dispatchEvent(new Event("devplanner-energy-filter-change"));
  }, []);

  const allItems = useMemo(() => {
    const items: NowItem[] = [];
    const raw = q.data?.tasks ?? [];

    for (const t of raw) {
      if (energyFilter && t.physicalEnergy !== energyFilter && t.physicalEnergy)
        continue;

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
            revision: s.revision,
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
          revision: t.revision,
        });
      }
    }

    items.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (a.priorityValue !== b.priorityValue)
        return b.priorityValue - a.priorityValue;
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
      const running = allItems.find(
        (i) =>
          i.type === "task" && i.taskId === activeLog.taskId && !i.completed,
      );
      if (running) return running;
    }
    const focus = focusQ.data?.focus;
    if (focus) {
      const selected = allItems.find(
        (i) =>
          i.type === focus.targetType &&
          i.id === focus.targetId &&
          !i.completed,
      );
      if (selected) return selected;
    }
    return allItems.find((i) => !i.completed) ?? null;
  }, [allItems, activeLog, focusQ.data?.focus]);

  const todayFocusItems = useMemo(() => {
    const unfinished = allItems.filter((i) => !i.completed);
    return showAll ? unfinished : unfinished.slice(0, 7);
  }, [allItems, showAll]);

  const upNextItems = useMemo(() => {
    return todayFocusItems.filter((i) => i.id !== activeItem?.id);
  }, [todayFocusItems, activeItem]);

  // "Finished earlier" agenda rows — done root tasks scheduled today + completed subtasks.
  const finishedToday = useMemo(() => {
    const rows: { id: string; title: string; time: string }[] = [];
    for (const t of q.data?.tasks ?? []) {
      const todaySubs = (t._subtasks ?? []).filter(
        (s) => s.scheduledDate === todayLocal,
      );
      if (todaySubs.length > 0) {
        for (const s of todaySubs) {
          if (s.completed) {
            rows.push({
              id: s.id,
              title: s.title,
              time: s.scheduledTime?.slice(0, 5) ?? "—",
            });
          }
        }
      } else if (t.status === "done") {
        rows.push({ id: t.id, title: t.title, time: "—" });
      }
    }
    return rows;
  }, [q.data?.tasks, todayLocal]);

  const allRootTasks = useMemo(
    () => tasksForRescue.data ?? q.data?.tasks ?? [],
    [tasksForRescue.data, q.data?.tasks],
  );

  const overdueRoots = useMemo(() => {
    return allRootTasks.filter((t) => isTaskOverdue(t, todayLocal));
  }, [allRootTasks, todayLocal]);
  const deadlineWarnings = useMemo(
    () =>
      allRootTasks.filter(
        (task) =>
          isOpenTask(task) &&
          Boolean(task.dueDate) &&
          task.dueDate!.slice(0, 10) <= todayLocal,
      ),
    [allRootTasks, todayLocal],
  );

  const unscheduledRoots = useMemo(() => {
    return (inboxQ.data ?? [])
      .filter((t) => isOpenTask(t) && !t.scheduledDate)
      .sort(compareTasksForExecution);
  }, [inboxQ.data]);

  const pickerCandidates = useMemo(
    (): Array<{
      key: string;
      title: string;
      parent: string;
      target: ExecutionTarget;
    }> =>
      unscheduledRoots.flatMap(
        (
          task,
        ): Array<{
          key: string;
          title: string;
          parent: string;
          target: ExecutionTarget;
        }> => {
          const unfinished = (task._subtasks ?? []).filter(
            (sub) => !sub.completed && !sub.scheduledDate,
          );
          if (unfinished.length > 0)
            return unfinished.map((sub) => ({
              key: `subtask:${sub.id}`,
              title: sub.title,
              parent: task.title,
              target: {
                targetType: "subtask" as const,
                targetId: sub.id,
                expectedRevision: sub.revision,
              },
            }));
          return [
            {
              key: `task:${task.id}`,
              title: task.title,
              parent: "",
              target: {
                targetType: "task" as const,
                targetId: task.id,
                expectedRevision: task.revision,
              },
            },
          ];
        },
      ),
    [unscheduledRoots],
  );
  const visibleCandidates = pickerCandidates.filter((candidate) =>
    `${candidate.title} ${candidate.parent}`
      .toLowerCase()
      .includes(pickerSearch.toLowerCase()),
  );

  const taskMix = useMemo(() => {
    return todayFocusItems.reduce(
      (acc, item) => {
        acc[itemSize(item)] += 1;
        return acc;
      },
      { big: 0, medium: 0, small: 0 },
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

  const hasScheduledItems = (q.data?.tasks.length ?? 0) > 0;
  const hasUnfinishedPlan = (q.data?.tasks ?? []).some((task) => {
    const todaySubs = (task._subtasks ?? []).filter(
      (sub) => sub.scheduledDate === todayLocal,
    );
    return todaySubs.length > 0
      ? todaySubs.some((sub) => !sub.completed)
      : isOpenTask(task);
  });
  const isTimerRunningForActive =
    isRunning &&
    activeItem?.type === "task" &&
    activeLog?.taskId === activeItem.taskId;
  const capacity = q.data?.dailyCapacity ?? 0;
  const used = q.data?.usedMinutes ?? 0;
  const hasCapacityData = capacity > 0;
  const capacityPercent = hasCapacityData
    ? Math.min(100, Math.round((used / capacity) * 100))
    : 0;
  const selectedProposals = scheduleProposals.filter((p) =>
    selectedProposalIds.includes(p.id),
  );
  const winsToday = q.data?.doneTodayCount ?? finishedToday.length;
  const totalToday =
    winsToday + allItems.filter((item) => !item.completed).length;
  const weekday = new Date(todayLocal + "T12:00:00").toLocaleDateString(
    undefined,
    {
      weekday: "long",
      month: "long",
      day: "numeric",
    },
  );
  const statusLine = `${winsToday} of ${totalToday} done · ${
    overdueRoots.length > 0
      ? `${overdueRoots.length} overdue`
      : "nothing overdue"
  }`;
  const elapsedMins = Math.floor(elapsed / 60);
  const heroMeta = activeItem
    ? [
        activeItem.parentTitle,
        activeItem.estimatedMinutes
          ? `${activeItem.estimatedMinutes}m estimate`
          : null,
        isHighPriority(activeItem.priorityLabel)
          ? `${activeItem.priorityLabel} priority`
          : null,
        `${activeItem.physicalEnergy} energy`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const commitCompletion = (item: NowItem) => {
    doneMut.mutate({
      id: item.id,
      type: item.type,
      title: item.type === "task" ? item.title : item.parentTitle,
      priorityLabel: item.priorityLabel,
      taskId: item.taskId,
    });
  };
  const completeItem = (item: NowItem) => {
    if (isRunning && activeLog?.taskId === item.taskId)
      setPendingCompletion(item);
    else commitCompletion(item);
  };
  const stopThenComplete = async () => {
    if (!pendingCompletion) return;
    setStoppingForCompletion(true);
    try {
      await stopActiveTimer();
      commitCompletion(pendingCompletion);
      setPendingCompletion(null);
    } catch {
      // The timer hook shows the failure. Keep the item unfinished for retry.
    } finally {
      setStoppingForCompletion(false);
    }
  };

  const tomorrow = (() => {
    const day = new Date(`${todayLocal}T12:00:00`);
    day.setDate(day.getDate() + 1);
    return localISODate(day);
  })();
  const moveOne = (item: NowItem, date: string) =>
    moveMut.mutate({
      targets: [
        {
          targetType: item.type,
          targetId: item.id,
          expectedRevision: item.revision,
        },
      ],
      date,
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
            Today&apos;s work.
          </h1>
          <p className="shrink-0 text-sm text-muted">{statusLine}</p>
        </div>
        {hasCapacityData && (
          <div className="mt-5 flex items-center gap-3">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--track)]">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-300",
                  used > capacity ? "bg-[var(--high)]" : "bg-[var(--teal)]",
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

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("devplanner:open-quick-add"))
          }
          className="min-h-11 rounded-full bg-[var(--ink-btn-bg)] px-5 text-sm font-semibold text-[var(--ink-btn-fg)]"
        >
          Add task
        </button>
        <button
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          className="min-h-11 rounded-full border border-[var(--hairline)] px-5 text-sm font-medium text-[var(--ink)]"
        >
          Pick from Inbox
        </button>
      </div>
      {pickerOpen && (
        <section
          aria-label="Pick from Inbox"
          className="rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-4"
        >
          <label
            className="block text-sm font-medium text-[var(--ink)]"
            htmlFor="today-inbox-search"
          >
            Find an Inbox item
          </label>
          <input
            id="today-inbox-search"
            value={pickerSearch}
            onChange={(event) => setPickerSearch(event.target.value)}
            placeholder="Search Inbox"
            className="mt-2 min-h-11 w-full rounded-lg border border-[var(--hairline)] bg-background px-3 text-[var(--ink)]"
          />
          <div className="mt-2 max-h-72 overflow-y-auto">
            {visibleCandidates.map((candidate) => (
              <label
                key={candidate.key}
                className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-[var(--hairline-soft)] py-2 text-sm text-[var(--ink)]"
              >
                <input
                  type="checkbox"
                  checked={pickerSelected.includes(candidate.key)}
                  onChange={() =>
                    setPickerSelected((selected) =>
                      selected.includes(candidate.key)
                        ? selected.filter((key) => key !== candidate.key)
                        : [...selected, candidate.key],
                    )
                  }
                />
                <span>
                  {candidate.title}
                  {candidate.parent && (
                    <span className="block text-xs text-muted">
                      {candidate.parent}
                    </span>
                  )}
                </span>
              </label>
            ))}
            {visibleCandidates.length === 0 && (
              <p className="py-4 text-sm text-muted">
                No matching Inbox items.
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={
              !dateReady || moveMut.isPending || pickerSelected.length === 0
            }
            onClick={() =>
              moveMut.mutate({
                targets: pickerCandidates
                  .filter((candidate) => pickerSelected.includes(candidate.key))
                  .map((candidate) => candidate.target),
                date: todayLocal,
              })
            }
            className="mt-3 min-h-11 rounded-full bg-[var(--ink-btn-bg)] px-5 text-sm font-semibold text-[var(--ink-btn-fg)] disabled:opacity-40"
          >
            {moveMut.isPending
              ? "Adding…"
              : `Add ${pickerSelected.length} to today`}
          </button>
        </section>
      )}

      {/* Only pitch onboarding when data actually loaded — an outage is not an empty planner. */}
      {!q.isLoading &&
        !inboxQ.isLoading &&
        !tasksForRescue.isLoading &&
        !q.isError &&
        !inboxQ.isError &&
        !tasksForRescue.isError && (
          <GettingStartedCard
            hasAnyTask={
              allRootTasks.length > 0 || (inboxQ.data?.length ?? 0) > 0
            }
            hasTodayPlan={hasScheduledItems}
            hasDoneTask={winsToday > 0}
          />
        )}

      {deadlineWarnings.length > 0 && (
        <section
          aria-label="Due and overdue reminders"
          className="rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-4"
        >
          <h2 className="text-sm font-semibold text-[var(--ink)]">
            Due and overdue
          </h2>
          <p className="mt-1 text-xs text-muted">
            Moving planned work does not change its deadline.
          </p>
          <ul className="mt-2 space-y-1">
            {deadlineWarnings.slice(0, 5).map((task) => (
              <li
                key={task.id}
                className="flex min-h-11 items-center justify-between gap-2 text-sm"
              >
                <button
                  type="button"
                  onClick={() => setDetailTaskId(task.id)}
                  className="min-w-0 text-left text-[var(--teal)] hover:underline"
                >
                  {task.title}
                </button>
                <span className="shrink-0 text-xs text-muted">
                  Due {task.dueDate?.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
          {deadlineWarnings.length > 5 && (
            <p className="text-xs text-muted">
              And {deadlineWarnings.length - 5} more due items.
            </p>
          )}
        </section>
      )}

      {/* ─── Rollover proposals ─────────────────────────────────── */}
      {scheduleProposals.length > 0 && (
        <section className="rounded-2xl border border-[var(--teal-a30)] bg-[var(--card)] p-5 shadow-[var(--card-shadow)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-display text-[22px] text-[var(--ink)]">
                Review schedule changes
              </h2>
              <p className="mt-1 text-[13px] text-muted">
                Unfinished work can roll forward. Nothing changes until you
                approve it.
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
                disabled={
                  selectedProposals.length === 0 || applyScheduleMut.isPending
                }
                onClick={() =>
                  applyScheduleMut.mutate(
                    selectedProposals.map((proposal) => proposal.id),
                  )
                }
              >
                {applyScheduleMut.isPending
                  ? "Applying"
                  : `Apply ${selectedProposals.length}`}
              </button>
            </div>
          </div>
          <ul className="mt-4">
            {scheduleProposals.map((proposal) => {
              const checked = selectedProposalIds.includes(proposal.id);
              return (
                <li
                  key={proposal.id}
                  className="border-b border-[var(--hairline-soft)] py-3 last:border-b-0"
                >
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 accent-[var(--teal)]"
                      checked={checked}
                      onChange={() => {
                        setScheduleApplyKey(newIdempotencyKey());
                        setSelectedProposalIds((prev) =>
                          checked
                            ? prev.filter((id) => id !== proposal.id)
                            : [...prev, proposal.id],
                        );
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium text-[var(--ink)]">
                        {proposal.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {proposal.fromDate} to {proposal.toDate} ·{" "}
                        {proposal.estimatedMinutes}m
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted-soft)]">
                        {proposal.reason}
                      </p>
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
                <AlertTriangle
                  size={11}
                  className="shrink-0 text-[var(--high)]"
                />
                <span className="min-w-0 truncate">{t.title}</span>
                <span className="shrink-0 text-[var(--muted-soft)]">
                  {t.dueDate?.slice(0, 10) ?? t.scheduledDate?.slice(0, 10)}
                </span>
              </li>
            ))}
            {overdueRoots.length > 5 && (
              <li className="py-2 text-xs text-[var(--muted-soft)]">
                …and {overdueRoots.length - 5} more
              </li>
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
              <h2 className="font-display text-[26px] italic text-[var(--ink)]">
                Couldn&apos;t load today.
              </h2>
              <p className="mt-2 text-sm text-muted">
                Your plan is safe — check your connection and retry.
              </p>
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
                  <p className="text-[13px] font-semibold text-[var(--teal)]">
                    {itemTime(activeItem)}
                  </p>
                  {activeItem.estimatedMinutes && (
                    <p className="mt-0.5 text-[11px] text-muted">
                      {activeItem.estimatedMinutes}m
                    </p>
                  )}
                </div>
                <div className="min-w-0 border-l-2 border-[var(--teal)] pl-5">
                  <p
                    className={cn(
                      "text-[11px] font-semibold uppercase tracking-[0.08em]",
                      isTimerRunningForActive
                        ? "text-[var(--teal)]"
                        : "text-muted",
                    )}
                  >
                    {isTimerRunningForActive
                      ? `In progress · ${elapsedMins} min`
                      : "Up now · start when ready"}
                  </p>
                  <h2 className="mt-1 font-display text-[23px] leading-[1.2] text-[var(--ink)] md:text-[26px]">
                    <button
                      type="button"
                      onClick={() => {
                        setDetailTaskId(activeItem.taskId);
                        setDetailSubtaskId(
                          activeItem.type === "subtask" ? activeItem.id : null,
                        );
                      }}
                      className="inline-flex min-h-11 items-center text-left underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--teal)]"
                      aria-label={`Open details for ${activeItem.title}`}
                    >
                      {activeItem.title}
                    </button>
                  </h2>
                  {heroMeta && (
                    <p className="mt-1 text-[13px] text-muted">{heroMeta}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <button
                      type="button"
                      disabled={!dateReady || moveMut.isPending}
                      onClick={() => moveOne(activeItem, tomorrow)}
                      className="min-h-11 rounded-lg px-2 text-[var(--teal)] hover:underline"
                    >
                      Move to tomorrow
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMoveItem(activeItem);
                        setMoveDate(tomorrow);
                      }}
                      className="min-h-11 rounded-lg px-2 text-[var(--teal)] hover:underline"
                    >
                      Choose date
                    </button>
                  </div>
                </div>
                <div className="flex gap-2 max-md:w-full">
                  {isTimerRunningForActive ? (
                    <button
                      onClick={() => {
                        void stopActiveTimer().catch(() => {});
                      }}
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
                      title={
                        isRunning
                          ? "Stop the current active timer first"
                          : "Start timer"
                      }
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
                  className="grid grid-cols-[minmax(0,1fr)_44px] items-center gap-x-2 gap-y-1 border-b border-[var(--hairline-soft)] px-3 py-3 sm:grid-cols-[72px_minmax(0,1fr)_44px] sm:gap-x-4 sm:px-6"
                >
                  <div className="order-0 hidden text-right sm:block">
                    <p
                      className={cn(
                        "text-[13px] font-medium",
                        item.scheduledTime ? "text-[var(--ink)]" : "text-muted",
                      )}
                    >
                      {itemTime(item)}
                    </p>
                    {item.estimatedMinutes && (
                      <p className="mt-0.5 text-[11px] text-muted">
                        {item.estimatedMinutes}m
                      </p>
                    )}
                  </div>
                  <div className="order-1 min-w-0 border-l-2 border-[var(--hairline)] pl-3 sm:pl-5">
                    <p className="text-[15px] font-medium text-[var(--ink)]">
                      <button
                        type="button"
                        onClick={() => {
                          setDetailTaskId(item.taskId);
                          setDetailSubtaskId(
                            item.type === "subtask" ? item.id : null,
                          );
                        }}
                        className="min-h-11 text-left hover:underline focus-visible:outline-2 focus-visible:outline-[var(--teal)]"
                      >
                        {item.title}
                      </button>
                      {isHighPriority(item.priorityLabel) && <HighLabel />}
                    </p>
                    {item.parentTitle && (
                      <p className="mt-0.5 text-xs text-muted">
                        {item.parentTitle}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-muted sm:hidden">
                      {itemTime(item)}
                      {item.estimatedMinutes
                        ? ` · ${item.estimatedMinutes}m`
                        : ""}
                    </p>
                  </div>
                  <div className="order-3 col-span-full flex flex-wrap gap-1 pl-3 text-xs sm:col-start-2 sm:pl-5">
                    <button
                      type="button"
                      disabled={focusMut.isPending || !dateReady}
                      onClick={() => focusMut.mutate(item)}
                      className="min-h-11 rounded-lg px-2 text-[var(--teal)]"
                    >
                      Do next
                    </button>
                    <button
                      type="button"
                      disabled={moveMut.isPending || !dateReady}
                      onClick={() => moveOne(item, tomorrow)}
                      className="min-h-11 rounded-lg px-2 text-[var(--teal)]"
                    >
                      Tomorrow
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMoveItem(item);
                        setMoveDate(tomorrow);
                      }}
                      className="min-h-11 rounded-lg px-2 text-[var(--teal)]"
                    >
                      Choose date
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => completeItem(item)}
                    disabled={doneMut.isPending}
                    aria-label={`Complete ${item.title}`}
                    title="Mark done"
                    className="order-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-[var(--rule)] bg-transparent p-0 transition-colors hover:border-[var(--success-text)] hover:bg-[var(--success-bg)] disabled:opacity-40"
                  />
                </div>
              ))}
              {allItems.filter((item) => !item.completed).length > 7 && (
                <button
                  type="button"
                  onClick={() => setShowAll((value) => !value)}
                  className="mt-3 min-h-11 self-start rounded-lg px-4 text-sm text-[var(--teal)] hover:underline"
                >
                  {showAll
                    ? "Show fewer"
                    : `Show all ${allItems.filter((item) => !item.completed).length} tasks`}
                </button>
              )}
            </>
          ) : energyFilter && hasUnfinishedPlan ? (
            <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-10 text-center">
              <h2 className="font-display text-[26px] text-[var(--ink)]">
                No tasks match this filter.
              </h2>
              <button
                type="button"
                onClick={() => persistEnergy("")}
                className="mt-3 min-h-11 rounded-full px-4 text-[var(--teal)] underline"
              >
                Clear filter
              </button>
            </div>
          ) : hasScheduledItems || winsToday > 0 ? (
            /* Everything planned is finished */
            <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-10 text-center shadow-[var(--card-shadow)]">
              <h2 className="font-display text-[28px] italic text-[var(--ink)]">
                Day cleared.
              </h2>
              <p className="mt-2 text-sm text-muted">
                Everything planned for today is done. Log a win, or pull
                something from the{" "}
                <Link
                  href="/backlog"
                  className="text-[var(--teal)] hover:underline"
                >
                  Inbox
                </Link>
                .
              </p>
            </div>
          ) : (
            /* Nothing scheduled yet */
            <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-10 text-center shadow-[var(--card-shadow)]">
              <h2 className="font-display text-[28px] italic text-[var(--ink)]">
                Nothing on the agenda.
              </h2>
              <p className="mt-2 text-sm text-muted">
                Add one task to start, or pick work from the{" "}
                <Link
                  href="/backlog"
                  className="text-[var(--teal)] hover:underline"
                >
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
                {showFinished
                  ? "Hide finished"
                  : `${finishedToday.length} finished earlier — show`}
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
                  <p className="text-right text-[13px] font-medium text-muted">
                    {row.time}
                  </p>
                  <p className="min-w-0 border-l-2 border-[var(--hairline)] pl-5 text-[15px] font-medium text-[var(--ink)] line-through">
                    {row.title}
                  </p>
                  <CheckCircle2
                    size={20}
                    className="shrink-0 text-[var(--success-text)]"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Pull from Inbox when the agenda is empty */}
          {!q.isLoading &&
            !hasScheduledItems &&
            !inboxQ.isLoading &&
            unscheduledRoots.length > 0 && (
              <div className="mt-6">
                <div className="mb-2.5 flex items-baseline justify-between gap-3">
                  <h3 className="font-display text-[19px] italic text-[var(--ink)]">
                    Pull from Inbox
                  </h3>
                  <Link
                    href="/backlog"
                    className="text-[13px] text-[var(--teal)] hover:underline"
                  >
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
                        <p className="mt-0.5 text-xs capitalize text-muted">
                          {task.priority} priority
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={rescueMut.isPending}
                        className="min-h-11 shrink-0 whitespace-nowrap rounded-lg px-2 text-[13px] text-[var(--teal)] hover:underline disabled:opacity-50"
                        onClick={() => {
                          if (
                            (task._subtasks ?? []).some((sub) => !sub.completed)
                          ) {
                            setPickerOpen(true);
                            setPickerSearch(task.title);
                          } else rescueMut.mutate([task.id]);
                        }}
                      >
                        {(task._subtasks ?? []).some((sub) => !sub.completed)
                          ? "Choose steps →"
                          : "Add to today →"}
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
            <h3 className="font-display text-[19px] italic text-[var(--ink)]">
              Win condition
            </h3>
            <PriorityAnchorsCard variant="margin" className="mt-3" />
          </div>
          <div>
            <h3 className="font-display text-[19px] italic text-[var(--ink)]">
              Progress
            </h3>
            <p className="mt-2.5 font-display text-[34px] text-[var(--ink)]">
              {winsToday}
              <span className="text-[20px] text-muted"> / {totalToday}</span>
            </p>
            <p className="mt-0.5 text-[13px] text-muted">tasks done today</p>
            <div className="mt-2.5 flex flex-col items-start gap-1.5">
              <Link
                href="/review"
                className="text-[13px] text-[var(--teal)] hover:underline"
              >
                Weekly review →
              </Link>
              <button
                type="button"
                onClick={() => autoScheduleMut.mutate()}
                disabled={autoScheduleMut.isPending}
                className="text-[13px] text-[var(--teal)] hover:underline disabled:opacity-50"
                title="Preview unfinished work that should roll forward"
              >
                {autoScheduleMut.isPending
                  ? "Reviewing…"
                  : "Move unfinished work"}
              </button>
            </div>
          </div>
          <div>
            <h3 className="font-display text-[19px] italic text-[var(--ink)]">
              Mix
            </h3>
            <p className="mt-2.5 text-[13px] leading-[1.6] text-muted">
              {taskMix.big} big · {taskMix.medium} medium · {taskMix.small}{" "}
              small
            </p>
            <label className="mt-1.5 flex items-center gap-2 text-[13px] text-muted">
              {energyFilter ? (
                <span className="capitalize">
                  {energyFilter}-energy filter on ·
                </span>
              ) : (
                <span>Energy filter off ·</span>
              )}
              <select
                className="cursor-pointer border-none bg-transparent p-0 text-[13px] text-[var(--teal)] focus:outline-none"
                value={energyFilter}
                onChange={(e) =>
                  persistEnergy(
                    e.target.value === ""
                      ? ""
                      : (e.target.value as PhysicalEnergyLevel),
                  )
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
      {moveItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMoveItem(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={`Choose planned date for ${moveItem.title}`}
            onKeyDown={(event) =>
              handleDialogKeys(event, () => setMoveItem(null))
            }
            className="w-full max-w-sm rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-5"
          >
            <h2 className="font-display text-xl text-[var(--ink)]">
              Move planned work
            </h2>
            <p className="mt-1 text-sm text-muted">
              The due date stays the same.
            </p>
            <label className="mt-4 block text-sm text-[var(--ink)]">
              Planned date
              <input
                id="daily-move-date"
                type="date"
                min={todayLocal}
                value={moveDate}
                onChange={(event) => setMoveDate(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-lg border border-[var(--hairline)] bg-background px-3 text-[var(--ink)]"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMoveItem(null)}
                className="min-h-11 rounded-lg px-4 text-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!dateReady || !moveDate || moveMut.isPending}
                onClick={() => moveOne(moveItem, moveDate)}
                className="min-h-11 rounded-lg bg-[var(--ink-btn-bg)] px-4 text-[var(--ink-btn-fg)] disabled:opacity-40"
              >
                {moveMut.isPending ? "Saving…" : "Move"}
              </button>
            </div>
          </section>
        </div>
      )}
      {pendingCompletion && (
        <div
          className="fixed inset-0 z-[55] flex items-center justify-center bg-black/70 p-4"
          role="presentation"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={`Complete ${pendingCompletion.title} while timing`}
            onKeyDown={(event) =>
              handleDialogKeys(event, () => setPendingCompletion(null))
            }
            className="w-full max-w-sm rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-5"
          >
            <h2 className="font-display text-xl text-[var(--ink)]">
              Timer is running
            </h2>
            <p className="mt-2 text-sm text-muted">
              Choose what happens to the timer before completing{" "}
              {pendingCompletion.title}.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {pendingCompletion.type === "subtask" && (
                <button
                  type="button"
                  disabled={doneMut.isPending || stoppingForCompletion}
                  onClick={() => {
                    commitCompletion(pendingCompletion);
                    setPendingCompletion(null);
                  }}
                  className="min-h-11 rounded-lg border border-[var(--hairline)] px-4 text-left text-sm text-[var(--ink)]"
                >
                  Complete step, keep parent timer running
                </button>
              )}
              <button
                type="button"
                disabled={doneMut.isPending || stoppingForCompletion}
                onClick={() => {
                  void stopThenComplete();
                }}
                className="min-h-11 rounded-lg bg-[var(--ink-btn-bg)] px-4 text-left text-sm text-[var(--ink-btn-fg)] disabled:opacity-40"
              >
                {stoppingForCompletion
                  ? "Stopping timer…"
                  : "Stop timer and complete"}
              </button>
              <button
                id="daily-completion-cancel"
                type="button"
                disabled={stoppingForCompletion}
                onClick={() => setPendingCompletion(null)}
                className="min-h-11 rounded-lg px-4 text-left text-sm text-muted"
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}
      {detailTaskId && (
        <TaskDetailPanel
          taskId={detailTaskId}
          userId={userId}
          selectedSubtaskId={detailSubtaskId}
          isOpen={true}
          onClose={() => setDetailTaskId(null)}
        />
      )}
    </div>
  );
}
