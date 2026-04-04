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
import { Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { createTask, fetchAreas, fetchTaskDetail, fetchTasks, getDevUserId, patchTask, type TaskRow, type AreaRow } from "@/lib/api";
import { getApiBase } from "@/lib/env";
import { SkeletonCard } from "@/lib/skeleton";
import { cn } from "@/lib/utils";
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
}: {
  id: string;
  title: string;
  count: number;
  children: React.ReactNode;
  onAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      className={cn(
        "min-h-[240px] rounded-xl border border-white/10 bg-surface p-3 transition-all duration-200",
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
      <div className="space-y-2 stagger-list">{children}</div>
    </section>
  );
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
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const m = useMutation({
    mutationFn: () => createTask({ userId, areaId, title: title.trim(), status }),
    onSuccess: () => {
      setTitle("");
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      inputRef.current?.focus();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="animate-slideIn flex gap-1.5">
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
  );
}

export function KanbanBoard() {
  const userId = getDevUserId();
  const qc = useQueryClient();
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [addingCol, setAddingCol] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const areasQ = useQuery({
    queryKey: ["areas", userId],
    queryFn: () => fetchAreas(userId),
    enabled: Boolean(userId),
  });

  const q = useQuery({
    queryKey: ["tasks", userId],
    queryFn: () => fetchTasks(userId),
    enabled: Boolean(userId),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const m = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => patchTask(id, { status }),
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

  if (!userId) {
    return <p className="text-muted">Set NEXT_PUBLIC_DEV_USER_ID in .env.local</p>;
  }

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
                          onStatusCycle={() => {
                            const next = STATUS_CYCLE[t.status] ?? "todo";
                            m.mutate({ id: t.id, status: next });
                          }}
                        />
                      </DraggableCard>
                      <button
                        type="button"
                        className="pl-1 text-[10px] text-primary/70 hover:text-primary hover:underline transition-colors"
                        onClick={() => setOpenTaskId(t.id)}
                      >
                        Details / subtasks
                      </button>
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
    queryFn: () => fetchTaskDetail(userId, taskId),
  });

  const [title, setTitle] = useState("");
  const addSub = useMutation({
    mutationFn: async () => {
      if (!title.trim() || !q.data) return null;
      return createTask({
        userId,
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
              <button
                type="button"
                className="rounded-lg p-1.5 text-muted hover:bg-white/10 hover:text-foreground"
                onClick={onClose}
              >
                <X size={16} />
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
