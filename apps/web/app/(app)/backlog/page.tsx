"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStatus } from "@/hooks/use-auth-status";
import { useAppUserId } from "@/hooks/use-app-user-id";
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Trash2,
  Circle,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  fetchAreas,
  fetchBacklog,
  fetchSprints,
  patchTask,
  patchTasksBulkSprint,
  createSubtask,
  patchSubtask,
  deleteSubtask,
  type AreaRow,
  type TaskRow,
  type SubtaskRow,
} from "@/lib/api";
import { SkeletonListItem } from "@/lib/skeleton";
import {
  cn,
  displayPhysicalEnergy,
  displayWorkDepth,
  isTaskOverdue,
} from "@/lib/utils";
import { TagChip } from "@/components/TagChip";
import { TimerButton } from "@/components/TimerButton";
import {
  fetchDailyPreferences,
  moveDaily,
  newIdempotencyKey,
  type ExecutionTarget,
} from "@/lib/daily-api";
import { useCalendarDate } from "@/hooks/use-calendar-date";
import { TaskDetailPanel } from "@/components/TaskDetailPanel";

const RECURRENCE_PRESETS: { label: string; value: string }[] = [
  { label: "No repeat", value: "" },
  { label: "Daily", value: "FREQ=DAILY" },
  { label: "Weekly", value: "FREQ=WEEKLY" },
  { label: "Monthly", value: "FREQ=MONTHLY" },
];

type AreaFilter = string;

function localISODate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function displayAreaName(area?: AreaRow): string {
  if (!area) return "Unknown area";
  return area.name.trim().toLowerCase() === "growth"
    ? "Professional"
    : area.name;
}

function areaDotColor(area?: AreaRow): string {
  const n = (area?.name ?? "").toLowerCase();
  if (n.includes("personal")) return "var(--rose)";
  if (n.includes("professional") || n.includes("growth"))
    return "var(--emerald)";
  if (n.includes("work")) return "var(--sky)";
  return area?.color ?? "var(--teal)";
}

function taskMeta(t: TaskRow): string {
  const parts: string[] = [];
  const captured = new Date(t.createdAt);
  if (!Number.isNaN(captured.getTime())) {
    parts.push(
      `captured ${captured.toLocaleDateString(undefined, { weekday: "short" })}`,
    );
  }
  const depth = displayWorkDepth(t);
  if (depth === "deep") parts.push("deep work");
  else if (depth === "shallow") parts.push("shallow work");
  parts.push(`${displayPhysicalEnergy(t)} energy`);
  if (t.dueDate) parts.push(`due ${t.dueDate.slice(0, 10)}`);
  return parts.join(" · ");
}

export default function BacklogPage() {
  const { status } = useAuthStatus();
  const userId = useAppUserId();
  const qc = useQueryClient();
  const [areaFilter, setAreaFilter] = useState<AreaFilter>("all");
  const [newSubtaskTitles, setNewSubtaskTitles] = useState<
    Record<string, string>
  >({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDate, setBulkDate] = useState("");
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const moveKeysRef = useRef(new Map<string, string>());
  const preferencesQ = useQuery({
    queryKey: ["daily-preferences", userId],
    queryFn: fetchDailyPreferences,
    enabled: Boolean(userId),
  });
  const todayYmd = useCalendarDate(preferencesQ.data?.timezone);
  const moveWithReceipt = (targets: ExecutionTarget[], date: string) => {
    const fingerprint = JSON.stringify({ userId, targets, date });
    let key = moveKeysRef.current.get(fingerprint);
    if (!key) {
      key = newIdempotencyKey();
      moveKeysRef.current.set(fingerprint, key);
    }
    return moveDaily(targets, date, key);
  };

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
    mutationFn: ({ taskId, areaId }: { taskId: string; areaId: string }) =>
      patchTask(taskId, { areaId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["backlog", userId] });
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addSubtaskM = useMutation({
    mutationFn: ({ taskId, title }: { taskId: string; title: string }) =>
      createSubtask({ taskId, title }),
    onSuccess: (_data, vars) => {
      setNewSubtaskTitles((prev) => ({ ...prev, [vars.taskId]: "" }));
      void qc.invalidateQueries({ queryKey: ["backlog", userId] });
    },
  });

  const updateSubtaskM = useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<SubtaskRow>;
    }) => patchSubtask(id, updates),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["backlog", userId] }),
  });

  const deleteSubtaskM = useMutation({
    mutationFn: (id: string) => deleteSubtask(id),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["backlog", userId] }),
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

  const bulkAssignSprint = useMutation({
    mutationFn: ({
      taskIds,
      sprintId,
    }: {
      taskIds: string[];
      sprintId: string;
    }) => patchTasksBulkSprint(taskIds, sprintId),
    onSuccess: (data, vars) => {
      const sprintName =
        sprintsQ.data?.sprints.find((s) => s.id === vars.sprintId)?.name ??
        "sprint";
      toast.success(
        `Added ${data.updated} task${data.updated === 1 ? "" : "s"} to ${sprintName}`,
      );
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ["backlog", userId] });
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      void qc.invalidateQueries({ queryKey: ["sprintTasks"] });
      void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const moveToDate = useMutation({
    mutationFn: ({
      tasks = [],
      targets,
      date,
    }: {
      tasks?: TaskRow[];
      targets?: ExecutionTarget[];
      date: string;
    }) =>
      moveWithReceipt(
        targets ??
          tasks.map((task): ExecutionTarget => ({
            targetType: "task",
            targetId: task.id,
            expectedRevision: task.revision,
          })),
        date,
      ),
    onSuccess: (_result, vars) => {
      toast.success(
        vars.date === todayYmd ? "Added to Today" : "Planned date saved",
      );
      setSelected(new Set());
      setBulkDate("");
      void qc.invalidateQueries({ queryKey: ["backlog"] });
      void qc.invalidateQueries({ queryKey: ["tasks-today"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["calendar-progress"] });
    },
    onError: (error: Error) =>
      toast.error(
        `${error.message}. Refresh and retry if a task changed elsewhere.`,
      ),
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
    return area?.id === areaFilter;
  }

  const filteredGroups = Array.from(grouped.entries()).filter(([areaId]) =>
    matchesAreaFilter(areaMap.get(areaId)),
  );

  const total = q.data?.length;
  const selectedTasks = (q.data ?? []).filter((task) => selected.has(task.id));
  const selectedHasChildWork = selectedTasks.some((task) =>
    (task._subtasks ?? []).some((subtask) => !subtask.completed),
  );
  const headline =
    total === undefined
      ? "Inbox"
      : total === 0
        ? "Nothing awaits triage."
        : total === 1
          ? "One thing awaits triage."
          : `${total} things await triage.`;

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--teal)]">
          Capture &amp; triage
        </p>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className="mt-1.5 font-display text-[32px] font-normal leading-[1.05] text-[var(--ink)] md:text-[52px]">
            {headline}
          </h1>
          <p className="shrink-0 text-sm text-muted">
            capture → clarify → commit → execute
          </p>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {["all", ...(areasQ.data ?? []).map((area) => area.id)].map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setAreaFilter(key)}
            className={cn(
              "min-h-11 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              areaFilter === key
                ? "border-[var(--ink-btn-bg)] bg-[var(--ink-btn-bg)] text-[var(--ink-btn-fg)]"
                : "border-[var(--hairline)] text-muted hover:bg-[var(--teal-a08)]",
            )}
          >
            {key === "all"
              ? "All areas"
              : displayAreaName(areasQ.data?.find((area) => area.id === key))}
          </button>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="sticky top-3 z-20 flex flex-wrap items-center gap-3 rounded-[14px] border border-[var(--teal-a30)] bg-[var(--teal-a08)] px-4 py-3 backdrop-blur-sm">
          <span className="text-[13px] font-semibold text-[var(--ink)]">
            {selected.size} selected
          </span>
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            <button
              type="button"
              disabled={
                !preferencesQ.isSuccess ||
                moveToDate.isPending ||
                selectedHasChildWork
              }
              onClick={() =>
                moveToDate.mutate({ tasks: selectedTasks, date: todayYmd })
              }
              className="min-h-11 rounded-lg border border-[var(--hairline)] px-3 text-[13px] text-[var(--teal)] disabled:opacity-40"
            >
              Add to today
            </button>
            <label className="text-[13px] text-muted">
              Choose date
              <input
                type="date"
                value={bulkDate}
                min={todayYmd}
                onChange={(event) => setBulkDate(event.target.value)}
                className="ml-2 min-h-11 rounded-lg border border-[var(--hairline)] bg-[var(--card)] px-2"
              />
            </label>
            <button
              type="button"
              disabled={
                !preferencesQ.isSuccess ||
                !bulkDate ||
                moveToDate.isPending ||
                selectedHasChildWork
              }
              onClick={() =>
                moveToDate.mutate({ tasks: selectedTasks, date: bulkDate })
              }
              className="min-h-11 rounded-lg px-3 text-[13px] text-[var(--teal)] disabled:opacity-40"
            >
              Move selected
            </button>
            <select
              className="cursor-pointer rounded-lg border border-[var(--hairline)] bg-[var(--card)] px-3 py-1.5 text-[13px] font-medium text-[var(--teal)] outline-none disabled:opacity-50"
              value=""
              disabled={bulkAssignSprint.isPending}
              aria-label="Add selected tasks to sprint"
              onChange={(e) => {
                const sprintId = e.target.value;
                if (!sprintId) return;
                bulkAssignSprint.mutate({
                  taskIds: Array.from(selected),
                  sprintId,
                });
              }}
            >
              <option value="">
                {bulkAssignSprint.isPending
                  ? "Adding…"
                  : `Add ${selected.size} to sprint →`}
              </option>
              {(sprintsQ.data?.sprints ?? [])
                .filter((s) => s.status !== "completed")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-[13px] font-medium text-muted hover:bg-[var(--teal-a08)]"
            >
              Clear
            </button>
          </div>
          {selectedHasChildWork && (
            <p className="w-full text-xs text-muted">
              Selected parents contain unfinished steps. Open each parent to
              choose the steps to schedule.
            </p>
          )}
        </div>
      )}

      {q.isLoading && (
        <div className="space-y-2">
          <SkeletonListItem />
          <SkeletonListItem />
          <SkeletonListItem />
        </div>
      )}

      <div className="flex flex-col gap-7">
        {filteredGroups.map(([areaId, tasks]) => {
          const area = areaMap.get(areaId);
          const groupIds = tasks.map((t) => t.id);
          const allSelected =
            groupIds.length > 0 && groupIds.every((id) => selected.has(id));
          return (
            <section key={areaId}>
              <div className="mb-2.5 flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--teal)]"
                  checked={allSelected}
                  onChange={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (allSelected)
                        groupIds.forEach((id) => next.delete(id));
                      else groupIds.forEach((id) => next.add(id));
                      return next;
                    })
                  }
                  aria-label={`Select all in ${displayAreaName(area)}`}
                />
                <span
                  className="h-[9px] w-[9px] shrink-0 rounded-full"
                  style={{ backgroundColor: areaDotColor(area) }}
                />
                <h2 className="font-display text-[19px] font-normal italic text-[var(--ink)]">
                  {displayAreaName(area)}
                </h2>
                <span className="text-xs text-[var(--muted-soft)]">
                  {tasks.length}
                </span>
              </div>
              <ul className="stagger-list overflow-hidden rounded-[14px] border border-[var(--hairline)] bg-[var(--card)] shadow-[var(--card-shadow)]">
                {tasks.map((t) => {
                  const open = expandedId === t.id;
                  const showHigh =
                    t.priority === "high" || t.priority === "urgent";
                  return (
                    <li
                      key={t.id}
                      className="border-b border-[var(--hairline-soft)] text-[var(--ink)] last:border-b-0"
                    >
                      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 px-5 py-[15px]">
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--teal)]"
                          checked={selected.has(t.id)}
                          onChange={() => toggleSelect(t.id)}
                          aria-label={`Select ${t.title}`}
                        />
                        <button
                          type="button"
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[var(--teal-a08)] hover:text-[var(--ink)]"
                          aria-expanded={open}
                          aria-label={`${open ? "Hide" : "Show"} details for ${t.title}`}
                          onClick={() => setExpandedId(open ? null : t.id)}
                        >
                          {open ? (
                            <ChevronDown size={16} />
                          ) : (
                            <ChevronRight size={16} />
                          )}
                        </button>
                        <div className="min-w-0 flex-1 basis-48">
                          <p className="text-[15px] font-medium">
                            {t.title}
                            {showHigh && (
                              <span className="ml-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--high)]">
                                {t.priority === "urgent" ? "Urgent" : "High"}
                              </span>
                            )}
                            {isTaskOverdue(t, todayYmd) && (
                              <span className="ml-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--rose)]">
                                Overdue
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted">
                            {taskMeta(t)}
                          </p>
                        </div>
                        {t._subtasksTotal !== undefined &&
                          t._subtasksTotal > 0 && (
                            <span className="shrink-0 rounded-full border border-[var(--hairline)] px-2.5 py-0.5 text-xs text-muted">
                              {t._subtasksDone}/{t._subtasksTotal}
                            </span>
                          )}
                        {(t._tags ?? []).slice(0, 2).map((tag) => (
                          <TagChip
                            key={tag.id}
                            name={tag.name}
                            color={tag.color}
                            size="xs"
                          />
                        ))}
                        <TimerButton taskId={t.id} compact />
                        <button
                          type="button"
                          onClick={() => setDetailTaskId(t.id)}
                          className="min-h-11 rounded-lg px-2 text-[13px] text-[var(--teal)] hover:underline"
                        >
                          Details
                        </button>
                        <button
                          type="button"
                          disabled={
                            !preferencesQ.isSuccess || moveToDate.isPending
                          }
                          onClick={() => {
                            if (
                              (t._subtasks ?? []).some(
                                (subtask) => !subtask.completed,
                              )
                            )
                              setExpandedId(t.id);
                            else
                              moveToDate.mutate({ tasks: [t], date: todayYmd });
                          }}
                          className="min-h-11 rounded-lg px-2 text-[13px] font-medium text-[var(--teal)] hover:underline disabled:opacity-40"
                        >
                          {(t._subtasks ?? []).some(
                            (subtask) => !subtask.completed,
                          )
                            ? "Choose steps"
                            : "Add to today"}
                        </button>
                        <select
                          className="max-w-[150px] shrink-0 cursor-pointer appearance-none rounded border-none bg-transparent text-[13px] font-medium text-[var(--teal)] outline-none hover:underline disabled:cursor-default disabled:opacity-50"
                          value={t.sprintId ?? ""}
                          disabled={patchMeta.isPending}
                          aria-label="Add to sprint"
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === "") {
                              patchMeta.mutate({
                                taskId: t.id,
                                sprintId: null,
                              });
                              return;
                            }
                            const sprintName =
                              sprintsQ.data?.sprints.find((s) => s.id === val)
                                ?.name || "sprint";
                            const newStatus = [
                              "todo",
                              "in_progress",
                              "done",
                            ].includes(t.status)
                              ? t.status
                              : "todo";
                            patchMeta.mutate(
                              {
                                taskId: t.id,
                                sprintId: val,
                                status: newStatus,
                              },
                              {
                                onSuccess: () => {
                                  toast.success(`Added to ${sprintName}`);
                                  void qc.invalidateQueries({
                                    queryKey: ["backlog", userId],
                                  });
                                },
                              },
                            );
                          }}
                        >
                          <option value="">Add to sprint →</option>
                          {(sprintsQ.data?.sprints ?? [])
                            .filter((s) => s.status !== "completed")
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                        </select>
                      </div>
                      {open && (
                        <div className="space-y-2 border-t border-[var(--hairline-soft)] bg-background px-5 py-4 text-[11px]">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <label className="text-muted">
                              Due date
                              <input
                                type="date"
                                className="mt-1 w-full rounded-lg border border-[var(--hairline)] bg-[var(--card)] px-2 py-1.5 text-[var(--ink)]"
                                defaultValue={t.dueDate?.slice(0, 10) ?? ""}
                                onBlur={(e) => {
                                  const v = e.target.value.trim();
                                  if (v !== (t.dueDate?.slice(0, 10) ?? "")) {
                                    patchMeta.mutate({
                                      taskId: t.id,
                                      dueDate: v || null,
                                    });
                                  }
                                }}
                              />
                            </label>
                            <label className="text-muted">
                              Area
                              <select
                                className="mt-1 w-full rounded-lg border border-[var(--hairline)] bg-[var(--card)] px-2 py-1.5 text-[var(--ink)]"
                                value={t.areaId}
                                disabled={moveArea.isPending}
                                onChange={(e) =>
                                  moveArea.mutate({
                                    taskId: t.id,
                                    areaId: e.target.value,
                                  })
                                }
                                aria-label="Category / area"
                              >
                                {(areasQ.data ?? []).map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {displayAreaName(a)}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="text-muted sm:col-span-2">
                              Sprint
                              <select
                                className="mt-1 w-full rounded-lg border border-[var(--hairline)] bg-[var(--card)] px-2 py-1.5 text-[var(--ink)]"
                                defaultValue={t.sprintId ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  patchMeta.mutate({
                                    taskId: t.id,
                                    sprintId: v === "" ? null : v,
                                  });
                                }}
                              >
                                <option value="">No sprint (Inbox)</option>
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
                                className="mt-1 w-full rounded-lg border border-[var(--hairline)] bg-[var(--card)] px-2 py-1.5 capitalize text-[var(--ink)]"
                                defaultValue={t.priority}
                                onChange={(e) =>
                                  patchMeta.mutate({
                                    taskId: t.id,
                                    priority: e.target.value,
                                  })
                                }
                              >
                                {(
                                  ["urgent", "high", "normal", "low"] as const
                                ).map((p) => (
                                  <option key={p} value={p}>
                                    {p}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="text-muted">
                              Physical energy
                              <select
                                className="mt-1 w-full rounded-lg border border-[var(--hairline)] bg-[var(--card)] px-2 py-1.5 text-[var(--ink)]"
                                defaultValue={displayPhysicalEnergy(t)}
                                onChange={(e) =>
                                  patchMeta.mutate({
                                    taskId: t.id,
                                    physicalEnergy: e.target.value,
                                  })
                                }
                              >
                                {(["low", "medium", "high"] as const).map(
                                  (p) => (
                                    <option key={p} value={p}>
                                      {p}
                                    </option>
                                  ),
                                )}
                              </select>
                            </label>
                            <label className="text-muted">
                              Depth
                              <select
                                className="mt-1 w-full rounded-lg border border-[var(--hairline)] bg-[var(--card)] px-2 py-1.5 capitalize text-[var(--ink)]"
                                defaultValue={displayWorkDepth(t)}
                                onChange={(e) =>
                                  patchMeta.mutate({
                                    taskId: t.id,
                                    workDepth: e.target.value,
                                  })
                                }
                              >
                                {(["shallow", "normal", "deep"] as const).map(
                                  (p) => (
                                    <option key={p} value={p}>
                                      {p}
                                    </option>
                                  ),
                                )}
                              </select>
                            </label>
                            <label className="text-muted">
                              Recurrence
                              <select
                                className="mt-1 w-full rounded-lg border border-[var(--hairline)] bg-[var(--card)] px-2 py-1.5 text-[var(--ink)]"
                                defaultValue={
                                  t.recurrenceRule &&
                                  RECURRENCE_PRESETS.some(
                                    (p) => p.value === t.recurrenceRule,
                                  )
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
                                  !RECURRENCE_PRESETS.some(
                                    (p) => p.value === t.recurrenceRule,
                                  ) && (
                                    <option value="__keep">
                                      Custom (unchanged)
                                    </option>
                                  )}
                              </select>
                            </label>
                          </div>

                          {/* SUBTASKS SECTION */}
                          <div className="mt-4 border-t border-[var(--hairline-soft)] pt-4">
                            <div className="mb-2 flex items-center justify-between">
                              <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                                Subtasks
                              </h4>
                            </div>
                            <ul className="mb-3 space-y-1.5">
                              {(t._subtasks ?? []).map((sub) => (
                                <li
                                  key={sub.id}
                                  className="group flex items-center gap-2 rounded-lg border border-[var(--hairline-soft)] bg-[var(--card)] px-2 py-1.5"
                                >
                                  <button
                                    className="shrink-0 text-muted transition-colors hover:text-[var(--success-text)]"
                                    onClick={() =>
                                      updateSubtaskM.mutate({
                                        id: sub.id,
                                        updates: { completed: !sub.completed },
                                      })
                                    }
                                  >
                                    {sub.completed ? (
                                      <CheckCircle2
                                        size={14}
                                        className="text-[var(--success-text)]"
                                      />
                                    ) : (
                                      <Circle size={14} />
                                    )}
                                  </button>
                                  <input
                                    className={cn(
                                      "flex-1 rounded bg-transparent px-1 text-xs text-[var(--ink)] outline-none focus:ring-1 focus:ring-[var(--teal-a30)]",
                                      sub.completed &&
                                        "text-muted line-through",
                                    )}
                                    defaultValue={sub.title}
                                    onBlur={(e) => {
                                      const val = e.target.value.trim();
                                      if (val && val !== sub.title)
                                        updateSubtaskM.mutate({
                                          id: sub.id,
                                          updates: { title: val },
                                        });
                                    }}
                                  />
                                  {!sub.completed && (
                                    <button
                                      type="button"
                                      disabled={
                                        !preferencesQ.isSuccess ||
                                        moveToDate.isPending
                                      }
                                      onClick={() =>
                                        moveToDate.mutate({
                                          targets: [
                                            {
                                              targetType: "subtask",
                                              targetId: sub.id,
                                              expectedRevision: sub.revision,
                                            },
                                          ],
                                          date: todayYmd,
                                        })
                                      }
                                      className="min-h-11 shrink-0 rounded-lg px-2 text-[var(--teal)] hover:underline disabled:opacity-40"
                                    >
                                      Add to today
                                    </button>
                                  )}

                                  <button
                                    onClick={() =>
                                      deleteSubtaskM.mutate(sub.id)
                                    }
                                    className="hover-actions sm-transition rounded p-0.5 text-muted opacity-0 hover:text-[var(--rose)] group-hover:opacity-100"
                                    title="Delete subtask"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </li>
                              ))}
                              {(t._subtasks ?? []).length === 0 && (
                                <p className="px-1 text-[11px] italic text-[var(--muted-soft)]">
                                  No subtasks yet
                                </p>
                              )}
                            </ul>
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                placeholder="+ Add subtask..."
                                className="flex-1 rounded-lg border border-[var(--hairline)] bg-[var(--card)] px-3 py-1.5 text-xs text-[var(--ink)] placeholder:text-muted focus:border-[var(--teal)] focus:outline-none"
                                value={newSubtaskTitles[t.id] ?? ""}
                                onChange={(e) =>
                                  setNewSubtaskTitles((prev) => ({
                                    ...prev,
                                    [t.id]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  const val = newSubtaskTitles[t.id] ?? "";
                                  if (e.key === "Enter" && val.trim()) {
                                    e.preventDefault();
                                    addSubtaskM.mutate({
                                      taskId: t.id,
                                      title: val.trim(),
                                    });
                                  }
                                }}
                              />
                            </div>
                          </div>

                          <p className="mt-3 text-[11px] text-[var(--muted-soft)]">
                            Blur date fields to save. Other fields save on
                            change.
                          </p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {!q.isLoading &&
        (q.data?.length ?? 0) > 0 &&
        filteredGroups.length === 0 && (
          <p className="text-center text-sm text-muted">
            No tasks in this category filter.
          </p>
        )}

      {!q.isLoading && (q.data?.length ?? 0) === 0 && (
        <div className="mt-6 flex flex-col items-center justify-center rounded-[14px] border border-dashed border-[var(--hairline)] bg-[var(--card)] py-16 text-center shadow-[var(--card-shadow)]">
          <CheckCircle2 size={32} className="mb-4 text-[var(--teal)]" />
          <p className="font-display text-[19px] font-normal italic text-[var(--ink)]">
            Inbox cleared.
          </p>
          <p className="mt-1 max-w-sm text-[13px] text-muted">
            All caught up. Use the Brain Dump (Ctrl/Cmd+Shift+D) to capture new
            tasks, or head to the{" "}
            <Link
              href="/plan?view=board"
              className="text-[var(--teal)] hover:underline"
            >
              Plan board
            </Link>
            .
          </p>
        </div>
      )}

      {!q.isLoading && (q.data?.length ?? 0) > 0 && (
        <p className="text-[13px] text-muted">
          Captured work lives here until it earns a spot in a sprint. Capture
          fast with{" "}
          <span className="font-semibold text-[var(--ink)]">Brain dump</span>,
          clarify when you have a spare minute.
        </p>
      )}
      {detailTaskId && (
        <TaskDetailPanel
          taskId={detailTaskId}
          userId={userId}
          isOpen={true}
          onClose={() => setDetailTaskId(null)}
        />
      )}
    </div>
  );
}
