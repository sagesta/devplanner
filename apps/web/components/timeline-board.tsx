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
import { useSession } from "next-auth/react";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { ChevronLeft, ChevronRight, CalendarOff, CheckCircle2, Circle } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PRIORITY_BAR_CLASS } from "@/components/task-card";
import {
  fetchAreas,
  fetchSprints,
  fetchTasks,
  patchTask,
  patchSubtask,
  type AreaRow,
  type SprintRow,
  type SubtaskRow,
  type TaskRow,
} from "@/lib/api";
import {
  addDaysYMD,
  eachDayFrom,
  normalizeYmd,
  startOfWeekMonday,
  toYMD,
} from "@/lib/timeline-utils";
import { cn } from "@/lib/utils";
import { ZoomControl, zoomToDays, type ZoomLevel } from "@/components/ZoomControl";

const DAY_W = 44;

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskBand = {
  task: TaskRow;
  area: AreaRow | undefined;
  /** YMD of earliest scheduled subtask (or task.dueDate as fallback) */
  startYmd: string | null;
  /** YMD of latest scheduled subtask (or task.dueDate as fallback) */
  endYmd: string | null;
  subtasks: SubtaskRow[];
};

// ─── Utility ──────────────────────────────────────────────────────────────────

function shortWeekday(ymd: string): string {
  const d = new Date(ymd + "T12:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function ymdToIdx(ymd: string, days: string[]): number {
  return days.indexOf(ymd);
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

// ─── DroppableDay ─────────────────────────────────────────────────────────────

function DroppableDay({
  ymd,
  isToday,
}: {
  ymd: string;
  isToday: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `timeline-day-${ymd}`, data: { ymd } });
  return (
    <div
      ref={setNodeRef}
      data-date={ymd}
      style={{ width: DAY_W, minWidth: DAY_W }}
      className={cn(
        "shrink-0 border-l border-white/10 py-1 text-center transition-colors",
        isToday && "bg-primary/10",
        isOver && "bg-primary/25 ring-1 ring-primary/40 ring-inset"
      )}
    >
      <span className="block text-[9px] font-medium uppercase tracking-wide text-muted">
        {shortWeekday(ymd)}
      </span>
      <span className="block text-[11px] tabular-nums text-foreground">{ymd.slice(8)}</span>
    </div>
  );
}

// ─── SubtaskDot ───────────────────────────────────────────────────────────────

function SubtaskDot({
  sub,
  colIdx,
  rowIdx,
  totalInCol,
  days,
  onToggle,
  onDragReschedule,
}: {
  sub: SubtaskRow;
  colIdx: number;
  rowIdx: number;
  totalInCol: number;
  days: string[];
  onToggle: (sub: SubtaskRow) => void;
  onDragReschedule: (subId: string, newYmd: string) => void;
}) {
  const dragRef = useRef<{ startX: number; startCol: number } | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const skipClickRef = useRef(false);

  // Stack dots vertically when multiple subtasks on same day
  const dotSize = 10;
  const gapY = 14;
  const top = 4 + rowIdx * gapY;
  const left = colIdx * DAY_W + (DAY_W / 2) - dotSize / 2 + offsetX;

  const tooltip = `${sub.title}${sub.scheduledTime ? " · " + sub.scheduledTime.slice(0, 5) : ""}${sub.estimatedMinutes ? " · " + sub.estimatedMinutes + "m" : ""}${sub.completed ? " · ✓ done" : ""}`;

  return (
    <>
      <button
        type="button"
        title={tooltip}
        className={cn(
          "absolute z-10 rounded-full border-2 transition-all cursor-grab active:cursor-grabbing hover:scale-125",
          sub.completed
            ? "border-success/80 bg-success/50"
            : "border-primary/80 bg-primary/40 hover:bg-primary/70",
          dragging && "scale-125 z-20"
        )}
        style={{
          width: dotSize,
          height: dotSize,
          top,
          left,
        }}
        onClick={() => {
          if (skipClickRef.current) { skipClickRef.current = false; return; }
          setExpanded((v) => !v);
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = { startX: e.clientX, startCol: colIdx };
          setDragging(true);
          setOffsetX(0);
        }}
        onPointerMove={(e) => {
          if (!dragRef.current) return;
          setOffsetX(e.clientX - dragRef.current.startX);
        }}
        onPointerUp={(e) => {
          if (!dragRef.current) return;
          const { startX, startCol } = dragRef.current;
          e.currentTarget.releasePointerCapture(e.pointerId);
          const deltaDays = Math.round((e.clientX - startX) / DAY_W);
          dragRef.current = null;
          setDragging(false);
          setOffsetX(0);
          if (deltaDays !== 0) {
            skipClickRef.current = true;
            const newIdx = clamp(startCol + deltaDays, 0, days.length - 1);
            const newYmd = days[newIdx];
            if (newYmd) onDragReschedule(sub.id, newYmd);
          }
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
          setOffsetX(0);
        }}
      />

      {/* Expanded popover */}
      {expanded && (
        <div
          className="absolute z-30 min-w-[180px] rounded-xl border border-white/10 bg-surface p-3 shadow-2xl text-xs"
          style={{
            top: top + dotSize + 4,
            left: clamp(left - 80, 0, DAY_W * days.length - 200),
          }}
        >
          <p className="font-medium text-foreground mb-1">{sub.title}</p>
          {sub.scheduledTime && (
            <p className="text-muted">⏰ {sub.scheduledTime.slice(0, 5)}</p>
          )}
          {sub.estimatedMinutes && (
            <p className="text-muted">~{sub.estimatedMinutes}m</p>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(sub);
              setExpanded(false);
            }}
            className={cn(
              "mt-2 flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors w-full",
              sub.completed
                ? "bg-white/5 text-muted hover:bg-white/10"
                : "bg-success/20 text-success hover:bg-success/30"
            )}
          >
            {sub.completed ? (
              <><Circle size={12} /> Mark incomplete</>
            ) : (
              <><CheckCircle2 size={12} /> Mark done</>
            )}
          </button>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="mt-1 w-full text-center text-[10px] text-muted hover:text-foreground"
          >
            close
          </button>
        </div>
      )}
    </>
  );
}

// ─── TaskBandRow ──────────────────────────────────────────────────────────────

function TaskBandRow({
  band,
  days,
  numDays,
  todayYMD,
  onSubtaskToggle,
  onSubtaskDragReschedule,
  onTaskBarDrag,
}: {
  band: TaskBand;
  days: string[];
  numDays: number;
  todayYMD: string;
  onSubtaskToggle: (sub: SubtaskRow) => void;
  onSubtaskDragReschedule: (subId: string, newYmd: string) => void;
  onTaskBarDrag: (taskId: string, startIdx: number, deltaDays: number) => void;
}) {
  const barClass = PRIORITY_BAR_CLASS[band.task.priority] ?? PRIORITY_BAR_CLASS.normal;

  // Compute bar span indices
  const startIdx = band.startYmd ? clamp(ymdToIdx(band.startYmd, days), 0, numDays - 1) : -1;
  const endIdx = band.endYmd ? clamp(ymdToIdx(band.endYmd, days), 0, numDays - 1) : -1;

  const hasBar = startIdx !== -1 || endIdx !== -1;
  const barStart = startIdx !== -1 ? startIdx : endIdx;
  const barEnd = endIdx !== -1 ? endIdx : startIdx;
  const barLeft = barStart * DAY_W;
  const barWidth = (barEnd - barStart + 1) * DAY_W;

  // Subtasks grouped by day column index
  const subsByCol = useMemo<Map<number, SubtaskRow[]>>(() => {
    const m = new Map<number, SubtaskRow[]>();
    for (const s of band.subtasks) {
      if (!s.scheduledDate) continue;
      const idx = ymdToIdx(s.scheduledDate, days);
      if (idx === -1) continue;
      const arr = m.get(idx) ?? [];
      arr.push(s);
      m.set(idx, arr);
    }
    return m;
  }, [band.subtasks, days]);

  // Row height: need room for stacked dots
  const maxDotsInCol = Math.max(0, ...Array.from(subsByCol.values()).map((a) => a.length));
  const rowH = Math.max(44, 16 + maxDotsInCol * 14 + 4);

  const dragRef = useRef<{ startX: number; startIdx: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [barOffsetX, setBarOffsetX] = useState(0);
  const skipClickRef = useRef(false);

  return (
    <div className="flex border-b border-white/5">
      {/* Label */}
      <div className="flex w-[200px] shrink-0 items-start border-r border-white/10 px-2 pt-2.5 pb-2 md:w-[240px]">
        <div className="min-w-0">
          <span className="block truncate text-xs font-medium text-foreground" title={band.task.title}>
            {band.task.title}
          </span>
          <span className="text-[10px] text-muted capitalize">
            {band.task.status.replace("_", " ")}
            {band.task.dueDate && ` · due ${band.task.dueDate}`}
          </span>
        </div>
      </div>

      {/* Grid */}
      <div className="relative min-h-10 min-w-0 flex-1" style={{ height: rowH }}>
        <div className="relative h-full" style={{ width: numDays * DAY_W }}>
          {/* Day grid lines */}
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

          {/* Parent task bar */}
          {hasBar && (
            <div
              className={cn(
                "pointer-events-auto absolute top-1 flex h-5 items-center overflow-hidden rounded-md px-1.5 text-left text-[9px] font-medium text-white/90 opacity-60 cursor-grab active:cursor-grabbing",
                barClass,
                dragging && "opacity-90 z-20"
              )}
              style={{
                left: barLeft + barOffsetX,
                width: Math.max(barWidth, 12),
                transition: dragging ? "none" : undefined,
              }}
              title={`${band.task.title} — drag to shift`}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                dragRef.current = { startX: e.clientX, startIdx: barStart };
                setDragging(true);
                setBarOffsetX(0);
              }}
              onPointerMove={(e) => {
                if (!dragRef.current) return;
                setBarOffsetX(e.clientX - dragRef.current.startX);
              }}
              onPointerUp={(e) => {
                if (!dragRef.current) return;
                const { startX, startIdx } = dragRef.current;
                e.currentTarget.releasePointerCapture(e.pointerId);
                const delta = Math.round((e.clientX - startX) / DAY_W);
                dragRef.current = null;
                setDragging(false);
                setBarOffsetX(0);
                if (delta !== 0) onTaskBarDrag(band.task.id, startIdx, delta);
              }}
              onPointerCancel={() => {
                dragRef.current = null;
                setDragging(false);
                setBarOffsetX(0);
              }}
            >
              <span className="truncate drop-shadow-sm">{band.task.title}</span>
            </div>
          )}

          {/* Subtask dots */}
          {Array.from(subsByCol.entries()).map(([colIdx, subs]) =>
            subs.map((sub, rowIdx) => (
              <SubtaskDot
                key={sub.id}
                sub={sub}
                colIdx={colIdx}
                rowIdx={rowIdx}
                totalInCol={subs.length}
                days={days}
                onToggle={onSubtaskToggle}
                onDragReschedule={onSubtaskDragReschedule}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── UnscheduledDraggable ─────────────────────────────────────────────────────

function UnscheduledDraggable({
  id,
  title,
  priority,
  areaColor,
  extra,
}: {
  id: string;
  title: string;
  priority: string;
  areaColor?: string | null;
  extra?: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex cursor-grab flex-col gap-0.5 rounded-lg border border-white/10 bg-background/90 px-2 py-1.5 active:cursor-grabbing",
        isDragging && "opacity-50"
      )}
      {...listeners}
      {...attributes}
    >
      <div className="flex items-center gap-2">
        {areaColor && (
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: areaColor }} />
        )}
        <span className="max-w-[200px] shrink truncate text-xs text-foreground" title={title}>
          {title}
        </span>
        <span
          className={cn(
            "ml-auto shrink-0 rounded px-1 py-0.5 text-[8px] font-semibold uppercase text-white",
            PRIORITY_BAR_CLASS[priority] ?? PRIORITY_BAR_CLASS.normal
          )}
        >
          {priority.slice(0, 1)}
        </span>
      </div>
      {extra && (
        <span className="pl-4 text-[9px] font-mono text-amber-200/80">{extra}</span>
      )}
    </div>
  );
}

// ─── Main TimelineBoard ───────────────────────────────────────────────────────

export function TimelineBoard() {
  const { status } = useSession();
  const userId = useAppUserId();
  const qc = useQueryClient();
  const [anchorDate, setAnchorDate] = useState(() => startOfWeekMonday(new Date()));
  const [sprintId, setSprintId] = useState<string>("");
  const [zoom, setZoom] = useState<ZoomLevel>("3-week");
  const NUM_DAYS = zoomToDays(zoom);
  const todayYMD = toYMD(new Date());

  const chartStartDate = useMemo(() => {
    if (zoom === "day") return addDaysYMD(anchorDate, -3);
    if (zoom === "week") return addDaysYMD(anchorDate, -6);
    if (zoom === "month") return anchorDate;
    return startOfWeekMonday(new Date(anchorDate + "T12:00:00"));
  }, [zoom, anchorDate]);

  const days = useMemo(() => eachDayFrom(chartStartDate, NUM_DAYS), [chartStartDate, NUM_DAYS]);

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

  const tasksQ = useQuery({
    queryKey: ["tasks", userId, sprintId || "all"],
    queryFn: () => fetchTasks(sprintId || undefined),
    enabled: Boolean(userId),
  });

  const areaMap = useMemo(() => {
    const m = new Map<string, AreaRow>();
    for (const a of areasQ.data ?? []) m.set(a.id, a);
    return m;
  }, [areasQ.data]);

  // ── Build bands ────────────────────────────────────────────────────

  const { bands, unscheduled } = useMemo(() => {
    const taskBands: TaskBand[] = [];
    type UnschedItem = { id: string; title: string; priority: string; areaId: string; extra?: string };
    const unsched: UnschedItem[] = [];

    for (const task of tasksQ.data ?? []) {
      const subs = task._subtasks ?? [];

      if (subs.length > 0) {
        // Compute span from scheduled subtask dates
        const scheduledDates = subs
          .map((s) => s.scheduledDate)
          .filter((d): d is string => !!d)
          .sort();

        const startYmd = scheduledDates[0] ?? normalizeYmd(task.dueDate) ?? null;
        const endYmd = scheduledDates[scheduledDates.length - 1] ?? normalizeYmd(task.dueDate) ?? null;

        // Determine if anything is in view
        const inView =
          (startYmd && startYmd <= days[NUM_DAYS - 1] && startYmd >= days[0]) ||
          (endYmd && endYmd <= days[NUM_DAYS - 1] && endYmd >= days[0]) ||
          subs.some((s) => s.scheduledDate && days.includes(s.scheduledDate));

        if (inView) {
          taskBands.push({
            task,
            area: areaMap.get(task.areaId),
            startYmd,
            endYmd,
            subtasks: subs,
          });
        } else {
          // Only add to unscheduled if task isn't done and has unscheduled subs
          const hasUnscheduled = subs.some((s) => !s.scheduledDate && !s.completed);
          if (hasUnscheduled && task.status !== "done") {
            unsched.push({
              id: `task-${task.id}`,
              title: task.title,
              priority: task.priority,
              areaId: task.areaId,
              extra: startYmd ? `Earliest: ${startYmd}` : "No subtask dates",
            });
          }
        }
      } else {
        // Flat task with no subtasks — show on its dueDate
        const anchor = normalizeYmd(task.dueDate);
        if (anchor && days.includes(anchor)) {
          taskBands.push({
            task,
            area: areaMap.get(task.areaId),
            startYmd: anchor,
            endYmd: anchor,
            subtasks: [],
          });
        } else if (task.status !== "done") {
          unsched.push({
            id: `task-${task.id}`,
            title: task.title,
            priority: task.priority,
            areaId: task.areaId,
            extra: anchor ? `Due: ${anchor}` : undefined,
          });
        }
      }
    }

    // Sort by band start date
    taskBands.sort((a, b) => (a.startYmd ?? "zz").localeCompare(b.startYmd ?? "zz"));

    return { bands: taskBands, unscheduled: unsched };
  }, [tasksQ.data, days, NUM_DAYS, areaMap]);

  // ── Mutations ──────────────────────────────────────────────────────

  const subtaskRescheduleMut = useMutation({
    mutationFn: ({ subId, newYmd }: { subId: string; newYmd: string }) =>
      patchSubtask(subId, { scheduledDate: newYmd }),
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["tasks", userId] }),
  });

  const subtaskToggleMut = useMutation({
    mutationFn: (sub: SubtaskRow) => patchSubtask(sub.id, { completed: !sub.completed }),
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["tasks", userId] }),
  });

  const taskDueDateMut = useMutation({
    mutationFn: ({ taskId, newYmd }: { taskId: string; newYmd: string }) =>
      patchTask(taskId, { dueDate: newYmd }),
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["tasks", userId] }),
  });

  const onSubtaskDragReschedule = useCallback(
    (subId: string, newYmd: string) => subtaskRescheduleMut.mutate({ subId, newYmd }),
    [subtaskRescheduleMut]
  );

  const onTaskBarDrag = useCallback(
    (taskId: string, startIdx: number, deltaDays: number) => {
      const newIdx = clamp(startIdx + deltaDays, 0, NUM_DAYS - 1);
      const newYmd = days[newIdx];
      if (newYmd) taskDueDateMut.mutate({ taskId, newYmd });
    },
    [days, taskDueDateMut, NUM_DAYS]
  );

  // DnD for unscheduled chips → drop onto day header
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [dragUnschedId, setDragUnschedId] = useState<string | null>(null);

  const onDragEnd = (e: DragEndEvent) => {
    setDragUnschedId(null);
    const id = e.active.id as string;
    const over = e.over?.id as string | undefined;
    if (!over?.startsWith("timeline-day-")) return;
    const ymd = over.replace("timeline-day-", "");
    if (id.startsWith("task-")) {
      taskDueDateMut.mutate({ taskId: id.replace("task-", ""), newYmd: ymd });
    }
  };

  const draggedUnsched = dragUnschedId ? unscheduled.find((u) => u.id === dragUnschedId) : null;

  if (status === "loading") return <p className="text-muted">Loading…</p>;
  if (!userId) return null;

  return (
    <div className="space-y-4">
      {/* ── Controls ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-white/10 bg-surface px-2 py-1.5 text-muted hover:bg-white/5 hover:text-foreground"
            onClick={() => setAnchorDate((w) => addDaysYMD(w, -7))}
            title="Previous period"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="rounded-lg border border-white/10 bg-surface px-2 py-1.5 text-muted hover:bg-white/5 hover:text-foreground"
            onClick={() => setAnchorDate((w) => addDaysYMD(w, 7))}
            title="Next period"
          >
            <ChevronRight size={18} />
          </button>
          <button
            type="button"
            className="rounded-lg border border-white/10 bg-surface px-3 py-1.5 text-xs text-foreground hover:bg-white/5"
            onClick={() => setAnchorDate(toYMD(new Date()))}
          >
            Today
          </button>
          <span className="text-xs text-muted">
            {days[0]} → {days[NUM_DAYS - 1]}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <ZoomControl value={zoom} onChange={setZoom} />
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
      </div>

      {/* ── Legend ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 text-[10px] text-muted px-1">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-8 rounded-sm bg-primary/50 opacity-60" /> Task span
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-primary/80 bg-primary/40" /> Incomplete subtask
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-success/80 bg-success/50" /> Done subtask
        </span>
        <span className="text-muted/60">Click a dot to expand · Drag to reschedule</span>
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
            {/* Header row */}
            <div className="flex border-b border-white/10">
              <div className="flex w-[200px] shrink-0 items-end border-r border-white/10 px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted md:w-[240px]">
                Task
              </div>
              <div className="flex min-w-0 flex-1 overflow-x-auto">
                <div className="flex" style={{ width: NUM_DAYS * DAY_W }}>
                  {days.map((ymd) => (
                    <DroppableDay key={ymd} ymd={ymd} isToday={ymd === todayYMD} />
                  ))}
                </div>
              </div>
            </div>

            {/* Loading skeleton */}
            {tasksQ.isLoading && (
              <div className="space-y-2 p-4">
                <div className="animate-shimmer h-8 rounded" />
                <div className="animate-shimmer h-8 rounded" />
                <div className="animate-shimmer h-8 rounded" />
              </div>
            )}

            {/* Band rows */}
            {!tasksQ.isLoading &&
              bands.map((band) => (
                <TaskBandRow
                  key={band.task.id}
                  band={band}
                  days={days}
                  numDays={NUM_DAYS}
                  todayYMD={todayYMD}
                  onSubtaskToggle={(sub) => subtaskToggleMut.mutate(sub)}
                  onSubtaskDragReschedule={onSubtaskDragReschedule}
                  onTaskBarDrag={onTaskBarDrag}
                />
              ))}

            {/* Empty */}
            {!tasksQ.isLoading && bands.length === 0 && (
              <div className="flex flex-col items-center justify-center p-12 text-center bg-white/[0.01]">
                <CalendarOff size={28} className="mb-3 text-primary/30" />
                <p className="max-w-md text-sm text-muted">
                  {unscheduled.length > 0
                    ? "Nothing dated in this range. Drag chips from below onto a date, or navigate to a different period."
                    : "No scheduled tasks in this window. Add dates from the task drawer or use AI to spread subtasks."}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Unscheduled chips */}
        {unscheduled.length > 0 && (
          <div className="rounded-xl border border-dashed border-white/15 bg-surface/50 p-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
              No dates or outside this window — drag onto a date above
            </p>
            <div className="flex flex-wrap gap-2">
              {unscheduled.map((u) => (
                <UnscheduledDraggable
                  key={u.id}
                  id={u.id}
                  title={u.title}
                  priority={u.priority}
                  areaColor={areaMap.get(u.areaId)?.color}
                  extra={u.extra}
                />
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
    </div>
  );
}
