"use client";

import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PRIORITY_BAR_CLASS } from "@/components/task-card";
import {
  fetchAreas,
  fetchSprints,
  fetchTaskDetail,
  fetchTasks,
  getDevUserId,
  patchTask,
  type AreaRow,
  type SprintRow,
  type TaskRow,
} from "@/lib/api";
import {
  addDaysYMD,
  barPixels,
  eachDayFrom,
  layoutTaskBar,
  startOfWeekMonday,
  toYMD,
  type BarLayout,
} from "@/lib/timeline-utils";
import { cn } from "@/lib/utils";

const DAY_W = 44;
const NUM_DAYS = 21;

type ScheduledRow = { task: TaskRow; layout: BarLayout };

function shortWeekday(ymd: string): string {
  const d = new Date(ymd + "T12:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function DroppableDay({
  ymd,
  dayWidth,
  isToday,
}: {
  ymd: string;
  dayWidth: number;
  isToday: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `timeline-day-${ymd}`, data: { ymd } });
  return (
    <div
      ref={setNodeRef}
      style={{ width: dayWidth, minWidth: dayWidth }}
      className={cn(
        "shrink-0 border-l border-white/10 py-1 text-center transition-colors",
        isToday && "bg-primary/10",
        isOver && "bg-primary/25 ring-1 ring-primary/40 ring-inset"
      )}
    >
      <span className="block text-[9px] font-medium uppercase tracking-wide text-muted">{shortWeekday(ymd)}</span>
      <span className="block text-[11px] tabular-nums text-foreground">{ymd.slice(8)}</span>
    </div>
  );
}

function UnscheduledDraggable({
  task,
  areaColor,
}: {
  task: TaskRow;
  areaColor?: string | null;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex cursor-grab items-center gap-2 rounded-lg border border-white/10 bg-background/90 px-2 py-1.5 active:cursor-grabbing",
        isDragging && "opacity-50"
      )}
      {...listeners}
      {...attributes}
    >
      {areaColor && (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: areaColor }} />
      )}
      <span className="truncate text-xs text-foreground">{task.title}</span>
      <span
        className={cn(
          "ml-auto shrink-0 rounded px-1 py-0.5 text-[8px] font-semibold uppercase text-white",
          PRIORITY_BAR_CLASS[task.priority] ?? PRIORITY_BAR_CLASS.normal
        )}
      >
        {task.priority.slice(0, 1)}
      </span>
    </div>
  );
}

function TimelineBar({
  task,
  areaName,
  layout,
  dayWidth,
  numDays,
  isDone,
  scheduleSource,
  onOpenDetail,
  onDragReschedule,
}: {
  task: TaskRow;
  areaName?: string;
  layout: BarLayout;
  dayWidth: number;
  numDays: number;
  isDone: boolean;
  scheduleSource: "scheduled" | "due";
  onOpenDetail?: (id: string) => void;
  onDragReschedule: (taskId: string, startIdx: number, deltaDays: number) => void;
}) {
  const { left, width } = barPixels(layout, dayWidth, numDays);
  const barClass = PRIORITY_BAR_CLASS[task.priority] ?? PRIORITY_BAR_CLASS.normal;
  const [dragging, setDragging] = useState(false);
  const [offsetX, setOffsetX] = useState(0);
  const dragRef = useRef<{ startClientX: number; startIdx: number } | null>(null);
  const skipClickRef = useRef(false);

  const tooltip = [
    task.title,
    `Status: ${task.status.replace("_", " ")}`,
    `Priority: ${task.priority}`,
    scheduleSource === "due" && !task.scheduledDate ? "Shown on due date (no scheduled day set)" : null,
    task.scheduledDate ? `Scheduled: ${task.scheduledDate}` : null,
    task.scheduledStartTime && task.scheduledEndTime
      ? `Time: ${task.scheduledStartTime.slice(0, 5)}–${task.scheduledEndTime.slice(0, 5)}`
      : null,
    task.dueDate ? `Due: ${task.dueDate}` : null,
    task.estimatedMinutes != null ? `Estimate: ${task.estimatedMinutes}m` : null,
    areaName ? `Area: ${areaName}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      className="pointer-events-none absolute inset-y-0 left-0"
      style={{ width: numDays * dayWidth }}
    >
      <button
        type="button"
        title={tooltip}
        className={cn(
          "pointer-events-auto absolute top-1 flex h-7 max-w-full min-w-[10px] cursor-grab items-center overflow-hidden rounded-md px-1.5 text-left text-[10px] font-medium text-white shadow-md shadow-black/20 active:cursor-grabbing",
          barClass,
          isDone && "opacity-45 saturate-50",
          scheduleSource === "due" && !task.scheduledDate && "ring-1 ring-dashed ring-white/40"
        )}
        style={{
          left: left + offsetX,
          width,
          transform: dragging ? "scale(1.02)" : undefined,
          zIndex: dragging ? 20 : 1,
        }}
        onClick={() => {
          if (skipClickRef.current) {
            skipClickRef.current = false;
            return;
          }
          onOpenDetail?.(task.id);
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = { startClientX: e.clientX, startIdx: layout.startIdx };
          setDragging(true);
          setOffsetX(0);
        }}
        onPointerMove={(e) => {
          if (!dragRef.current) return;
          setOffsetX(e.clientX - dragRef.current.startClientX);
        }}
        onPointerUp={(e) => {
          if (!dragRef.current) return;
          const { startClientX, startIdx } = dragRef.current;
          e.currentTarget.releasePointerCapture(e.pointerId);
          const deltaDays = Math.round((e.clientX - startClientX) / dayWidth);
          dragRef.current = null;
          setDragging(false);
          setOffsetX(0);
          if (deltaDays !== 0) {
            skipClickRef.current = true;
            onDragReschedule(task.id, startIdx, deltaDays);
          }
        }}
        onPointerCancel={(e) => {
          dragRef.current = null;
          setDragging(false);
          setOffsetX(0);
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
        }}
      >
        <span className="truncate drop-shadow-sm">{task.title}</span>
      </button>
    </div>
  );
}

export function TimelineBoard() {
  const userId = getDevUserId();
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => startOfWeekMonday(new Date()));
  const [sprintId, setSprintId] = useState<string>("");
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [dragUnschedId, setDragUnschedId] = useState<string | null>(null);

  const days = useMemo(() => eachDayFrom(weekStart, NUM_DAYS), [weekStart]);
  const todayYMD = toYMD(new Date());

  const areasQ = useQuery({
    queryKey: ["areas", userId],
    queryFn: () => fetchAreas(userId),
    enabled: Boolean(userId),
  });

  const sprintsQ = useQuery({
    queryKey: ["sprints", userId],
    queryFn: () => fetchSprints(userId),
    enabled: Boolean(userId),
  });

  const tasksQ = useQuery({
    queryKey: ["tasks", userId, sprintId || "all"],
    queryFn: () => fetchTasks(userId, sprintId || undefined),
    enabled: Boolean(userId),
  });

  const areaMap = useMemo(() => {
    const m = new Map<string, AreaRow>();
    for (const a of areasQ.data ?? []) m.set(a.id, a);
    return m;
  }, [areasQ.data]);

  const roots = useMemo(
    () => (tasksQ.data ?? []).filter((t) => !t.parentTaskId),
    [tasksQ.data]
  );

  const { scheduledRows, unscheduled } = useMemo(() => {
    const scheduled: ScheduledRow[] = [];
    const unsched: TaskRow[] = [];
    for (const task of roots) {
      const laid = layoutTaskBar(
        task.scheduledDate,
        task.dueDate,
        task.scheduledStartTime,
        task.scheduledEndTime,
        task.estimatedMinutes,
        weekStart,
        NUM_DAYS
      );
      if (laid.inView) {
        scheduled.push({ task, layout: laid.layout });
      } else {
        const hasAnchor = Boolean(task.scheduledDate || task.dueDate);
        if (!hasAnchor) unsched.push(task);
      }
    }
    scheduled.sort((a, b) => {
      const da = a.task.scheduledDate ?? a.task.dueDate ?? "";
      const db = b.task.scheduledDate ?? b.task.dueDate ?? "";
      return da.localeCompare(db) || a.task.title.localeCompare(b.task.title);
    });
    return { scheduledRows: scheduled, unscheduled: unsched };
  }, [roots, weekStart]);

  const rescheduleMutation = useMutation({
    mutationFn: async ({ taskId, newYMD }: { taskId: string; newYMD: string }) => {
      return patchTask(taskId, { scheduledDate: newYMD });
    },
    onMutate: async ({ taskId, newYMD }) => {
      const key = ["tasks", userId, sprintId || "all"] as const;
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<TaskRow[]>(key);
      if (prev) {
        qc.setQueryData(
          key,
          prev.map((t) => (t.id === taskId ? { ...t, scheduledDate: newYMD } : t))
        );
      }
      return { prev, key };
    },
    onError: (err: Error, _v, ctx) => {
      if (ctx?.prev && ctx.key) qc.setQueryData(ctx.key, ctx.prev);
      toast.error(err.message);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
    },
  });

  const onBarDragReschedule = useCallback(
    (taskId: string, startIdx: number, deltaDays: number) => {
      const newIdx = Math.max(0, Math.min(NUM_DAYS - 1, startIdx + deltaDays));
      const newYMD = days[newIdx];
      if (!newYMD) return;
      rescheduleMutation.mutate({ taskId, newYMD });
    },
    [days, rescheduleMutation]
  );

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = (e: DragEndEvent) => {
    setDragUnschedId(null);
    const id = e.active.id as string;
    const over = e.over?.id as string | undefined;
    if (!over || !over.startsWith("timeline-day-")) return;
    const ymd = over.replace("timeline-day-", "");
    rescheduleMutation.mutate({ taskId: id, newYMD: ymd });
  };

  const draggedUnsched = dragUnschedId ? unscheduled.find((t) => t.id === dragUnschedId) : null;

  if (!userId) {
    return <p className="text-muted">Set NEXT_PUBLIC_DEV_USER_ID in .env.local</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-white/10 bg-surface px-2 py-1.5 text-muted hover:bg-white/5 hover:text-foreground"
            onClick={() => setWeekStart((w) => addDaysYMD(w, -7))}
            title="Previous week"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="rounded-lg border border-white/10 bg-surface px-2 py-1.5 text-muted hover:bg-white/5 hover:text-foreground"
            onClick={() => setWeekStart((w) => addDaysYMD(w, 7))}
            title="Next week"
          >
            <ChevronRight size={18} />
          </button>
          <button
            type="button"
            className="rounded-lg border border-white/10 bg-surface px-3 py-1.5 text-xs text-foreground hover:bg-white/5"
            onClick={() => setWeekStart(startOfWeekMonday(new Date()))}
          >
            This week
          </button>
          <span className="text-xs text-muted">
            {days[0]} → {days[NUM_DAYS - 1]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="timeline-sprint" className="text-[10px] uppercase tracking-wide text-muted">
            Sprint
          </label>
          <select
            id="timeline-sprint"
            className="rounded-lg border border-white/10 bg-background px-2 py-1.5 text-xs text-foreground"
            value={sprintId}
            onChange={(e) => setSprintId(e.target.value)}
          >
            <option value="">All tasks</option>
            {(sprintsQ.data?.sprints ?? []).map((s: SprintRow) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <DndContext
        sensors={dndSensors}
        collisionDetection={pointerWithin}
        onDragStart={(e) => setDragUnschedId(e.active.id as string)}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragUnschedId(null)}
      >
        <div className="overflow-hidden rounded-xl border border-white/10 bg-surface">
          <div className="flex flex-col">
            <div className="flex border-b border-white/10">
              <div
                className="flex w-[200px] shrink-0 items-end border-r border-white/10 px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted md:w-[240px]"
              >
                Task
              </div>
              <div className="flex min-w-0 flex-1 overflow-x-auto">
                <div className="flex" style={{ width: NUM_DAYS * DAY_W }}>
                  {days.map((ymd) => (
                    <DroppableDay
                      key={ymd}
                      ymd={ymd}
                      dayWidth={DAY_W}
                      isToday={ymd === todayYMD}
                    />
                  ))}
                </div>
              </div>
            </div>

            {tasksQ.isLoading && (
              <div className="space-y-2 p-4">
                <div className="animate-shimmer h-8 rounded" />
                <div className="animate-shimmer h-8 rounded" />
                <div className="animate-shimmer h-8 rounded" />
              </div>
            )}

            {!tasksQ.isLoading &&
              scheduledRows.map(({ task, layout }) => {
                const area = areaMap.get(task.areaId);
                const scheduleSource = task.scheduledDate ? ("scheduled" as const) : ("due" as const);
                return (
                  <div key={task.id} className="flex border-b border-white/5">
                    <div className="flex w-[200px] shrink-0 items-center border-r border-white/10 px-2 py-1 md:w-[240px]">
                      <span className="truncate text-xs text-foreground">{task.title}</span>
                    </div>
                    <div className="relative min-h-10 min-w-0 flex-1 overflow-x-auto">
                      <div className="relative h-10" style={{ width: NUM_DAYS * DAY_W }}>
                        {days.map((ymd, di) => (
                          <div
                            key={ymd}
                            className={cn(
                              "absolute top-0 h-full border-l border-white/[0.06]",
                              ymd === todayYMD && "bg-primary/[0.04]"
                            )}
                            style={{ left: di * DAY_W, width: DAY_W }}
                          />
                        ))}
                        <TimelineBar
                          task={task}
                          areaName={area?.name}
                          layout={layout}
                          dayWidth={DAY_W}
                          numDays={NUM_DAYS}
                          isDone={task.status === "done"}
                          scheduleSource={scheduleSource}
                          onOpenDetail={(id) => setOpenTaskId(id)}
                          onDragReschedule={onBarDragReschedule}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}

            {!tasksQ.isLoading && scheduledRows.length === 0 && (
              <p className="p-6 text-center text-sm text-muted">
                {unscheduled.length > 0
                  ? "Nothing dated in this range — drag chips below onto a date, change the week, or set dates on the board."
                  : "No scheduled or due tasks in this window. Navigate weeks or add dates from the board / table."}
              </p>
            )}
          </div>
        </div>

        {unscheduled.length > 0 && (
          <div className="rounded-xl border border-dashed border-white/15 bg-surface/50 p-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Unscheduled — drag onto a date above
            </p>
            <div className="flex flex-wrap gap-2">
              {unscheduled.map((t) => (
                <UnscheduledDraggable key={t.id} task={t} areaColor={areaMap.get(t.areaId)?.color} />
              ))}
            </div>
          </div>
        )}

        <DragOverlay>
          {draggedUnsched && (
            <div className="rounded-lg border border-white/20 bg-background px-2 py-1.5 text-xs shadow-xl">
              {draggedUnsched.title}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {openTaskId && (
        <TaskDetailModal taskId={openTaskId} userId={userId} onClose={() => setOpenTaskId(null)} />
      )}
    </div>
  );
}

function TaskDetailModal({
  taskId,
  userId,
  onClose,
}: {
  taskId: string;
  userId: string;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => fetchTaskDetail(userId, taskId),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh] animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-auto rounded-xl border border-white/10 bg-surface p-5 shadow-2xl animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        {q.isLoading && <div className="animate-shimmer h-6 w-2/3 rounded" />}
        {q.data && (
          <>
            <h2 className="font-display text-lg text-foreground">{q.data.task.title}</h2>
            <p className="mt-2 text-xs text-muted capitalize">
              {q.data.task.status.replace("_", " ")} · {q.data.task.priority} priority
            </p>
            {(q.data.task.scheduledDate || q.data.task.dueDate) && (
              <p className="mt-2 text-xs text-muted">
                {q.data.task.scheduledDate && <>Scheduled {q.data.task.scheduledDate}</>}
                {q.data.task.scheduledDate && q.data.task.dueDate && " · "}
                {q.data.task.dueDate && <>Due {q.data.task.dueDate}</>}
              </p>
            )}
            {q.data.task.description && (
              <p className="mt-3 text-sm text-foreground/90">{q.data.task.description}</p>
            )}
          </>
        )}
        <button
          type="button"
          className="mt-4 text-xs text-primary hover:underline"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}
