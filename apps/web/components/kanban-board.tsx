"use client";

import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { ChevronDown, ChevronUp, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import {
  createTask,
  deleteTask,
  fetchAreas,
  fetchTaskDetail,
  fetchTasks,
  patchTask,
  type AreaRow,
  type TaskRow,
} from "@/lib/api";
import { SkeletonCard } from "@/lib/skeleton";
import { cn, displayPhysicalEnergy, displayWorkDepth, isTaskOverdue } from "@/lib/utils";
import { StatusDot, SubtaskBar, TaskCard } from "./task-card";

const COLS = [
  ["backlog", "Backlog"],
  ["todo", "Todo"],
  ["in_progress", "In progress"],
  ["done", "Done"],
] as const;

const STATUS_CYCLE: Record<string, string> = {
  backlog: "todo",
  todo: "in_progress",
  in_progress: "done",
  done: "backlog",
};

function DraggableCard({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px,${transform.y}px,0)`, zIndex: 50 }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40 scale-[0.97]"
      )}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  );
}

function DroppableColumn({
  id,
  title,
  count,
  children,
  onAdd,
  showColumnEmpty,
}: {
  id: string;
  title: string;
  count: number;
  children: React.ReactNode;
  onAdd: () => void;
  /** stress-test-fix: designed empty column state */
  showColumnEmpty?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      className={cn(
        "min-h-[260px] rounded-xl border border-white/10 bg-surface p-3 transition-all duration-200",
        isOver && "ring-2 ring-primary/50 border-primary/30 bg-surface/80"
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
          <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-white/5 px-1 text-[10px] text-muted">
            {count}
          </span>
        </div>
        <button
          type="button"
          className="rounded p-0.5 text-muted hover:bg-white/10 hover:text-foreground transition-colors"
          onClick={onAdd}
          title="Add task"
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="flex min-h-[200px] flex-col">
        <div className="flex-1 space-y-2 stagger-list">{children}</div>
        {showColumnEmpty && (
          <div className="mt-2 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-white/12 bg-white/[0.02] px-4 py-10 text-center">
            <p className="text-[11px] text-muted">No tasks here yet</p>
            <button
              type="button"
              className="mt-3 text-xs font-medium text-primary hover:underline"
              onClick={onAdd}
            >
              + Add task
            </button>
            <p className="mt-2 text-[10px] text-muted/50">Or drop a card from another column</p>
          </div>
        )}
      </div>
    </section>
  );
}

const RECURRENCE_PRESETS: { label: string; value: string }[] = [
  { label: "No repeat", value: "" },
  { label: "Daily", value: "FREQ=DAILY" },
  { label: "Weekly", value: "FREQ=WEEKLY" },
  { label: "Weekdays", value: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
];

function toPgTime(v: string): string | null {
  if (!v) return null;
  return v.length === 5 ? `${v}:00` : v;
}

function InlineAddTask({
  userId,
  areaId,
  status,
  onDone,
}: {
  userId: string;
  areaId: string;
  status: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [more, setMore] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("");
  const [startT, setStartT] = useState("");
  const [endT, setEndT] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const m = useMutation({
    mutationFn: () =>
      createTask({
        areaId,
        title: title.trim(),
        status,
        scheduledDate: scheduledDate || null,
        scheduledStartTime: toPgTime(startT),
        scheduledEndTime: toPgTime(endT),
        recurrenceRule: recurrence || null,
      }),
    onSuccess: () => {
      setTitle("");
      setScheduledDate("");
      setStartT("");
      setEndT("");
      setRecurrence("");
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
      inputRef.current?.focus();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="animate-slideIn space-y-2 rounded-md border border-white/10 bg-background/40 p-2">
      <div className="flex gap-1.5">
        <input
          ref={inputRef}
          autoFocus
          className="flex-1 rounded-md border border-white/10 bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted/50"
          placeholder="Task title…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim()) m.mutate();
            if (e.key === "Escape") onDone();
          }}
        />
        <button
          type="button"
          onClick={() => onDone()}
          className="rounded p-1 text-muted hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>
      <button
        type="button"
        className="flex w-full items-center justify-center gap-1 text-[10px] text-muted hover:text-foreground"
        onClick={() => setMore((v) => !v)}
      >
        {more ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        Date &amp; time (optional)
      </button>
      {more && (
        <div className="grid gap-2 text-[10px]">
          <label className="text-muted">
            Day
            <input
              type="date"
              className="mt-0.5 w-full rounded border border-white/10 bg-background px-1.5 py-1 text-foreground"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
            />
          </label>
          <div className="grid grid-cols-2 gap-1">
            <label className="text-muted">
              Start
              <input
                type="time"
                className="mt-0.5 w-full rounded border border-white/10 bg-background px-1.5 py-1 text-foreground"
                value={startT}
                onChange={(e) => setStartT(e.target.value)}
              />
            </label>
            <label className="text-muted">
              End
              <input
                type="time"
                className="mt-0.5 w-full rounded border border-white/10 bg-background px-1.5 py-1 text-foreground"
                value={endT}
                onChange={(e) => setEndT(e.target.value)}
              />
            </label>
          </div>
          <label className="text-muted">
            Recurrence
            <select
              className="mt-0.5 w-full rounded border border-white/10 bg-background px-1.5 py-1 text-foreground"
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value)}
            >
              {RECURRENCE_PRESETS.map((p) => (
                <option key={p.label} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

function localISODate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function KanbanBoard() {
  const { status } = useSession();
  const userId = useAppUserId();
  const qc = useQueryClient();
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [addingCol, setAddingCol] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const todayYmd = useMemo(() => localISODate(), []);

  const areasQ = useQuery({
    queryKey: ["areas", userId],
    queryFn: () => fetchAreas(),
    enabled: Boolean(userId),
  });

  const q = useQuery({
    queryKey: ["tasks", userId],
    queryFn: () => fetchTasks(),
    enabled: Boolean(userId),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const m = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => patchTask(id, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tasks", userId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const priMut = useMutation({
    mutationFn: ({ id, priority }: { id: string; priority: string }) => patchTask(id, { priority }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tasks", userId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    const overId = e.over?.id as string | undefined;
    const activeId = e.active.id as string;
    if (!overId || !activeId) return;
    if (!COLS.some(([k]) => k === overId)) return;
    m.mutate({ id: activeId, status: overId });
  };

  const roots = (q.data ?? []).filter((t) => !t.parentTaskId);
  const areaMap = new Map<string, AreaRow>();
  for (const a of areasQ.data ?? []) {
    areaMap.set(a.id, a);
  }
  const defaultAreaId = areasQ.data?.[0]?.id ?? "";
  const draggedTask = dragId ? roots.find((t) => t.id === dragId) : null;

  if (status === "loading") {
    return <p className="text-muted">Loading…</p>;
  }
  if (!userId) return null;

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={(e) => setDragId(e.active.id as string)}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragId(null)}
      >
        <div className="grid gap-3 md:grid-cols-4">
          {COLS.map(([key, label]) => {
            const colTasks = roots.filter((t) => t.status === key);
            return (
              <DroppableColumn
                key={key}
                id={key}
                title={label}
                count={colTasks.length}
                showColumnEmpty={!q.isLoading && colTasks.length === 0 && addingCol !== key}
                onAdd={() => setAddingCol(addingCol === key ? null : key)}
              >
                {q.isLoading && (
                  <>
                    <SkeletonCard />
                    <SkeletonCard />
                    <SkeletonCard />
                  </>
                )}
                {colTasks.map((t) => {
                  const area = areaMap.get(t.areaId);
                  return (
                    <div key={t.id} className="space-y-0.5">
                      <DraggableCard id={t.id}>
                        <TaskCard
                          title={t.title}
                          status={t.status}
                          priority={t.priority}
                          energyLevel={t.energyLevel}
                          areaColor={area?.color}
                          areaName={area?.name}
                          scheduledDate={t.scheduledDate}
                          scheduledStartTime={t.scheduledStartTime}
                          scheduledEndTime={t.scheduledEndTime}
                          subtasksDone={t._subtasksDone}
                          subtasksTotal={t._subtasksTotal}
                          overdue={isTaskOverdue(t, todayYmd)}
                          depthLabel={displayWorkDepth(t)}
                          energyLabel={displayPhysicalEnergy(t)}
                          onPriorityChange={(priority) => priMut.mutate({ id: t.id, priority })}
                          onStatusCycle={() => {
                            const next = STATUS_CYCLE[t.status] ?? "todo";
                            m.mutate({ id: t.id, status: next });
                          }}
                        />
                      </DraggableCard>
                      <div className="flex items-center gap-2 pl-1">
                        <button
                          type="button"
                          className="text-[10px] text-primary/70 hover:text-primary hover:underline transition-colors"
                          onClick={() => setOpenTaskId(t.id)}
                        >
                          Details / subtasks
                        </button>
                        <button
                          type="button"
                          className="rounded p-0.5 text-muted hover:bg-red-500/15 hover:text-red-300"
                          title="Delete task"
                          onClick={() => {
                            if (!confirm(`Delete “${t.title}”?`)) return;
                            void (async () => {
                              try {
                                await deleteTask(t.id);
                                toast.success("Task deleted");
                                void qc.invalidateQueries({ queryKey: ["tasks", userId] });
                                void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
                              } catch (e) {
                                toast.error(String(e));
                              }
                            })();
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {addingCol === key && (
                  <InlineAddTask
                    userId={userId}
                    areaId={defaultAreaId}
                    status={key}
                    onDone={() => setAddingCol(null)}
                  />
                )}
              </DroppableColumn>
            );
          })}
        </div>
        <DragOverlay>
          {draggedTask && (
            <div className="rotate-2 scale-105 opacity-90 shadow-2xl">
              <TaskCard
                title={draggedTask.title}
                status={draggedTask.status}
                priority={draggedTask.priority}
                energyLevel={draggedTask.energyLevel}
                areaColor={areaMap.get(draggedTask.areaId)?.color}
                overdue={isTaskOverdue(draggedTask, todayYmd)}
                depthLabel={displayWorkDepth(draggedTask)}
                energyLabel={displayPhysicalEnergy(draggedTask)}
                showStatusAdvance={false}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>
      {openTaskId && (
        <TaskDrawer taskId={openTaskId} userId={userId} onClose={() => setOpenTaskId(null)} />
      )}
    </>
  );
}

function TaskDrawer({
  taskId,
  userId,
  onClose,
}: {
  taskId: string;
  userId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => fetchTaskDetail(taskId),
  });

  const areasQ = useQuery({
    queryKey: ["areas", userId],
    queryFn: () => fetchAreas(),
    enabled: Boolean(userId),
  });

  const [title, setTitle] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [startT, setStartT] = useState("");
  const [endT, setEndT] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const [areaId, setAreaId] = useState("");
  const [priority, setPriority] = useState("normal");
  const [workDepth, setWorkDepth] = useState<string>("normal");
  const [physicalEnergy, setPhysicalEnergy] = useState<string>("medium");

  useEffect(() => {
    const t = q.data?.task;
    if (!t) return;
    setScheduledDate(t.scheduledDate ?? "");
    setStartT(t.scheduledStartTime ? t.scheduledStartTime.slice(0, 5) : "");
    setEndT(t.scheduledEndTime ? t.scheduledEndTime.slice(0, 5) : "");
    const rr = t.recurrenceRule ?? "";
    if (!rr) setRecurrence("");
    else if (RECURRENCE_PRESETS.some((p) => p.value === rr)) setRecurrence(rr);
    else setRecurrence("__custom");
    setAreaId(t.areaId);
    setPriority(t.priority ?? "normal");
    setWorkDepth(t.workDepth ?? "normal");
    setPhysicalEnergy(t.physicalEnergy ?? "medium");
  }, [q.data?.task]);

  const addSub = useMutation({
    mutationFn: async () => {
      if (!title.trim() || !q.data) return null;
      return createTask({
        areaId: q.data.task.areaId,
        title: title.trim(),
        parentTaskId: taskId,
        status: "todo",
        taskType: "subtask",
      });
    },
    onSuccess: () => {
      setTitle("");
      void qc.invalidateQueries({ queryKey: ["task", taskId] });
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
    },
  });

  const toggleSubStatus = useMutation({
    mutationFn: async (sub: TaskRow) => {
      const next = sub.status === "done" ? "todo" : "done";
      return patchTask(sub.id, { status: next });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["task", taskId] });
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
    },
  });

  const saveMeta = useMutation({
    mutationFn: async () => {
      if (!q.data) return;
      let recurrenceRule: string | null;
      if (recurrence === "") recurrenceRule = null;
      else if (recurrence === "__custom") recurrenceRule = q.data.task.recurrenceRule ?? null;
      else recurrenceRule = recurrence;
      return patchTask(taskId, {
        scheduledDate: scheduledDate || null,
        scheduledStartTime: toPgTime(startT),
        scheduledEndTime: toPgTime(endT),
        recurrenceRule,
        areaId: areaId || q.data.task.areaId,
        priority: priority as "urgent" | "high" | "normal" | "low",
        workDepth: workDepth as "shallow" | "normal" | "deep",
        physicalEnergy: physicalEnergy as "low" | "medium" | "high",
      });
    },
    onSuccess: () => {
      toast.success("Saved");
      void qc.invalidateQueries({ queryKey: ["task", taskId] });
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      void qc.invalidateQueries({ queryKey: ["backlog", userId] });
      void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delTask = useMutation({
    mutationFn: () => deleteTask(taskId),
    onSuccess: () => {
      toast.success("Task deleted");
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-lg overflow-auto border-l border-white/10 bg-surface p-5 animate-slideInRight"
        onClick={(e) => e.stopPropagation()}
      >
        {q.isLoading && (
          <div className="space-y-3">
            <div className="animate-shimmer h-6 w-3/4 rounded" />
            <div className="animate-shimmer h-4 w-1/3 rounded" />
            <div className="animate-shimmer h-4 w-1/2 rounded mt-4" />
          </div>
        )}
        {q.data && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl text-foreground">{q.data.task.title}</h2>
                <p className="mt-1 text-xs text-muted">
                  Status: <span className="capitalize">{q.data.task.status.replace("_", " ")}</span>
                  {q.data.task.description && (
                    <span className="ml-2">· {q.data.task.description}</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-muted hover:bg-red-500/15 hover:text-red-300"
                  title="Delete task"
                  disabled={delTask.isPending}
                  onClick={() => {
                    if (!confirm(`Delete “${q.data!.task.title}”?`)) return;
                    delTask.mutate();
                  }}
                >
                  <Trash2 size={16} />
                </button>
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-muted hover:bg-white/10 hover:text-foreground"
                  onClick={onClose}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-background/30 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Schedule &amp; fields</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[11px] text-muted">
                  Priority
                  <select
                    className="mt-1 w-full rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm text-foreground"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                  >
                    {(["urgent", "high", "normal", "low"] as const).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[11px] text-muted">
                  Depth
                  <select
                    className="mt-1 w-full rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm text-foreground"
                    value={workDepth}
                    onChange={(e) => setWorkDepth(e.target.value)}
                  >
                    {(["shallow", "normal", "deep"] as const).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="col-span-2 block text-[11px] text-muted">
                  Physical energy
                  <select
                    className="mt-1 w-full rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm text-foreground"
                    value={physicalEnergy}
                    onChange={(e) => setPhysicalEnergy(e.target.value)}
                  >
                    {(["low", "medium", "high"] as const).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-[11px] text-muted">
                Area
                <select
                  className="mt-1 w-full rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm text-foreground"
                  value={areaId}
                  onChange={(e) => setAreaId(e.target.value)}
                >
                  {(areasQ.data ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[11px] text-muted">
                Day
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm text-foreground"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-muted">
                  Start
                  <input
                    type="time"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm"
                    value={startT}
                    onChange={(e) => setStartT(e.target.value)}
                  />
                </label>
                <label className="text-[11px] text-muted">
                  End
                  <input
                    type="time"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm"
                    value={endT}
                    onChange={(e) => setEndT(e.target.value)}
                  />
                </label>
              </div>
              <label className="block text-[11px] text-muted">
                Recurrence (RRULE)
                <select
                  className="mt-1 w-full rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm text-foreground"
                  value={recurrence}
                  onChange={(e) => setRecurrence(e.target.value)}
                >
                  {RECURRENCE_PRESETS.map((p) => (
                    <option key={p.label} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                  {((q.data.task.recurrenceRule &&
                    !RECURRENCE_PRESETS.some((p) => p.value === (q.data.task.recurrenceRule ?? ""))) ||
                    recurrence === "__custom") && (
                    <option value="__custom">Custom (keep current)</option>
                  )}
                </select>
              </label>
              <button
                type="button"
                disabled={saveMeta.isPending}
                className="w-full rounded-lg bg-primary py-2 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-40"
                onClick={() => saveMeta.mutate()}
              >
                {saveMeta.isPending ? "Saving…" : "Save schedule & details"}
              </button>
            </div>

            {q.data.subtaskProgress && (
              <div className="mt-3">
                <SubtaskBar done={q.data.subtaskProgress.done} total={q.data.subtaskProgress.total} />
              </div>
            )}
            <ul className="mt-4 space-y-1.5 stagger-list">
              {q.data.subtasks.map((s: TaskRow) => (
                <li
                  key={s.id}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border border-white/5 px-3 py-2 text-sm transition-all",
                    s.status === "done" && "opacity-50"
                  )}
                >
                  <button
                    type="button"
                    className={cn(
                      "h-4 w-4 shrink-0 rounded border transition-colors",
                      s.status === "done"
                        ? "bg-primary border-primary"
                        : "border-white/20 hover:border-primary/50"
                    )}
                    onClick={() => toggleSubStatus.mutate(s)}
                  />
                  <span className={cn(s.status === "done" && "line-through")}>
                    {s.title}
                  </span>
                  <span className="ml-auto text-[10px] text-muted">{s.status.replace("_", " ")}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex gap-2">
              <input
                className="flex-1 rounded-lg border border-white/10 bg-background px-3 py-2 text-sm placeholder:text-muted/50"
                placeholder="+ Add step"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && title.trim()) addSub.mutate();
                }}
              />
              <button
                type="button"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover transition-colors"
                onClick={() => addSub.mutate()}
              >
                Add
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
