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
import { ChevronDown, ChevronUp, Plus, Trash2, X, Filter, Sparkles } from "lucide-react";
import confetti from "canvas-confetti";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { useTags } from "@/hooks/use-tags";
import {
  fetchSprints,
  createSprint,
  createTask,
  deleteTask,
  fetchAreas,
  fetchTaskDetail,
  fetchTasks,
  patchTask,
  patchTasksBulkSchedule,
  restoreTask,
  createSubtask,
  patchSubtask,
  deleteSubtask,
  type AreaRow,
  type TaskRow,
  type SubtaskRow,
} from "@/lib/api";
import Link from "next/link";
import { SkeletonCard } from "@/lib/skeleton";
import { cn, displayPhysicalEnergy, displayWorkDepth, isTaskOverdue } from "@/lib/utils";
import { StatusDot, SubtaskBar, TaskCard } from "./task-card";
import { TagChip } from "./TagChip";
import { TagSelector } from "./TagSelector";

const COLS = [
  ["todo", "Todo"],
  ["in_progress", "In progress"],
  ["done", "Done"],
] as const;

const STATUS_CYCLE: Record<string, string> = {
  todo: "in_progress",
  in_progress: "done",
  done: "todo",
};

const COL_KEYS: Set<string> = new Set(COLS.map(([k]) => k));

function resolveDropStatus(overId: string | undefined, rootsList: TaskRow[]): string | null {
  if (!overId) return null;
  if (COL_KEYS.has(overId)) return overId;
  const hit = rootsList.find((t) => t.id === overId);
  return hit ? hit.status : null;
}

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
            <Sparkles size={24} className="mb-3 text-primary/30" />
            <p className="text-[11px] text-muted">No tasks here yet</p>
            <button
              type="button"
              className="mt-3 text-xs font-medium text-primary hover:underline hover:text-primary-hover"
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
  sprintId,
  status,
  onDone,
}: {
  userId: string;
  areaId: string;
  sprintId: string;
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
        sprintId,
        title: title.trim(),
        status,
        ...(scheduledDate ? { scheduledDate } : {}),
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
      void qc.invalidateQueries({ queryKey: ["sprintTasks"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
      inputRef.current?.focus();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="inline-add-container animate-slideIn space-y-2 rounded-md border border-white/10 bg-background/40 p-2">
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
          onBlur={(e) => {
             // Let close button or other inner actions fire first before blindly closing/mutating
             if (e.relatedTarget && e.relatedTarget.closest('.inline-add-container')) return;
             if (title.trim() && !m.isPending) m.mutate();
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
        onClick={() =>
          setMore((v) => {
            const next = !v;
            if (next) setScheduledDate((d) => d || localISODate());
            return next;
          })
        }
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
              defaultValue={scheduledDate}
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
  const [rescueDismissed, setRescueDismissed] = useState(false);
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const { tags: allTags } = useTags();
  const todayYmd = useMemo(() => localISODate(), []);

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

  const activeSprint = useMemo(() => {
    if (!sprintsQ.data?.sprints) return null;
    // Removed strict date limits so any 'active' sprint displays its tasks
    return sprintsQ.data.sprints.find(s => s.status === 'active');
  }, [sprintsQ.data?.sprints]);

  const q = useQuery({
    queryKey: ["sprintTasks", activeSprint?.id],
    queryFn: () => fetchTasks(activeSprint!.id),
    enabled: Boolean(activeSprint?.id),
  });

  useEffect(() => {
    const handleOpenTask = (e: Event) => {
      const customEvent = e as CustomEvent<{ id: string }>;
      if (customEvent.detail?.id) {
        setOpenTaskId(customEvent.detail.id);
      }
    };
    window.addEventListener("open-task", handleOpenTask);
    return () => window.removeEventListener("open-task", handleOpenTask);
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const m = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => patchTask(id, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["sprintTasks"] });
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const prev = qc.getQueryData<TaskRow[]>(["sprintTasks", activeSprint?.id]);
      if (prev) {
        qc.setQueryData(
          ["sprintTasks", activeSprint?.id],
          prev.map((t) => (t.id === id ? { ...t, status } : t))
        );
      }
      return { prev };
    },
    onSuccess: (_data, variables) => {
      if (variables.status === "done") {
        confetti({
          particleCount: 40,
          spread: 55,
          startVelocity: 22,
          ticks: 50,
          origin: { y: 0.72 },
        });
      }
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["sprintTasks", activeSprint?.id], ctx.prev);
      toast.error(e.message);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["sprintTasks"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
    },
  });

  const priMut = useMutation({
    mutationFn: ({ id, priority }: { id: string; priority: string }) => patchTask(id, { priority }),
    onMutate: async ({ id, priority }) => {
      await qc.cancelQueries({ queryKey: ["sprintTasks"] });
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const prev = qc.getQueryData<TaskRow[]>(["sprintTasks", activeSprint?.id]);
      if (prev) {
        qc.setQueryData(
          ["sprintTasks", activeSprint?.id],
          prev.map((t) => (t.id === id ? { ...t, priority } : t))
        );
      }
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["sprintTasks", activeSprint?.id], ctx.prev);
      toast.error(e.message);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["sprintTasks"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const createSprintM = useMutation({
    mutationFn: (body: Parameters<typeof createSprint>[0]) => createSprint(body),
    onSuccess: () => {
       toast.success("Sprint created!");
       void qc.invalidateQueries({ queryKey: ["sprints", userId] });
    },
    onError: (e: Error) => toast.error(e.message)
  });

  const rescueMut = useMutation({
    mutationFn: (ids: string[]) => patchTasksBulkSchedule(ids, todayYmd),
    onSuccess: (r) => {
      toast.success(`Rescheduled ${r.updated} task(s) to today`);
      setRescueDismissed(true);
      void qc.invalidateQueries({ queryKey: ["sprintTasks"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setDragId(null);
      const overId = e.over?.id as string | undefined;
      const activeId = e.active.id as string;
      if (!activeId) return;
      const list = q.data ?? [];
      const targetStatus = resolveDropStatus(overId, list);
      if (!targetStatus) return;
      const activeTask = list.find((t) => t.id === activeId);
      if (!activeTask || activeTask.status === targetStatus) return;
      m.mutate({ id: activeId, status: targetStatus });
    },
    [q.data, m]
  );

  const roots = q.data ?? [];

  const areaMap = new Map<string, AreaRow>();
  for (const a of areasQ.data ?? []) {
    areaMap.set(a.id, a);
  }
  const defaultAreaId = areasQ.data?.[0]?.id ?? "";
  const draggedTask = dragId ? (q.data ?? []).find((t) => t.id === dragId) : null;
  const overdueRoots = useMemo(
    () => roots.filter((t) => isTaskOverdue(t, todayYmd)),
    [roots, todayYmd]
  );
  
  const filteredRoots = useMemo(() => {
    if (selectedTags.length === 0) return roots;
    return roots.filter((task) =>
      task._tags?.some((tag) => selectedTags.includes(tag.id))
    );
  }, [roots, selectedTags]);

  const boardStatusValues = COLS.map(([k]) => k);

  if (status === "loading" || sprintsQ.isLoading) {
    return <p className="text-muted">Loading…</p>;
  }
  if (!userId) return null;

  if (!activeSprint) {
    return (
      <div className="mt-12 flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-surface/50 py-16 px-6 text-center">
        <Sparkles size={32} className="mb-4 text-primary/40" />
        <p className="text-foreground font-medium text-lg">No active sprint</p>
        <p className="mt-1 text-sm text-muted max-w-md">
          Create a new sprint to start adding tasks from your backlog and tracking your progress!
        </p>
        
        <form 
          className="mt-8 flex flex-col items-center gap-3 w-full max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const name = fd.get("name") as string;
            const startDate = fd.get("startDate") as string;
            const endDate = fd.get("endDate") as string;
            if (!name || !startDate || !endDate) {
               toast.error("Please fill in all sprint fields.");
               return;
            }
            createSprintM.mutate({ name, startDate, endDate, status: "active" });
          }}
        >
          <input 
             name="name" 
             placeholder="Sprint name (e.g. Launch Week)" 
             className="w-full rounded-lg border border-white/10 bg-background px-4 py-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50" 
             required
             defaultValue="Sprint 1"
          />
          <div className="flex gap-3 w-full">
             <div className="flex-1">
               <label className="block text-left text-[10px] uppercase font-semibold text-muted mb-1 px-1">Start date</label>
               <input 
                 type="date" 
                 name="startDate" 
                 className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" 
                 required
                 defaultValue={localISODate()}
               />
             </div>
             <div className="flex-1">
               <label className="block text-left text-[10px] uppercase font-semibold text-muted mb-1 px-1">End date</label>
               <input 
                 type="date" 
                 name="endDate" 
                 className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" 
                 required
                 defaultValue={localISODate(new Date(Date.now() + 14 * 86400000))}
               />
             </div>
          </div>
          <button 
             type="submit" 
             disabled={createSprintM.isPending}
             className="w-full mt-2 flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
             <Plus size={16} /> Create & Start Sprint
          </button>
        </form>

        <div className="mt-6 border-t border-white/5 pt-4">
          <Link href="/sprints" className="text-xs text-muted hover:text-white hover:underline transition-colors">
            Or manage sprints in the Sprints page →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {overdueRoots.length >= 3 && !rescueDismissed && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            You have {overdueRoots.length} overdue tasks. Reschedule all to today?
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-40"
              disabled={rescueMut.isPending}
              onClick={() => rescueMut.mutate(overdueRoots.map((t) => t.id))}
            >
              Reschedule all
            </button>
            <button
              type="button"
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-muted hover:bg-white/5"
              onClick={() => setRescueDismissed(true)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {/* Tag Filter Toolbar */}
      <div className="mb-4 flex items-center justify-end">
        <div className="relative group/filter">
          <button
            type="button"
            className={cn(
              "flex items-center gap-1.5 rounded-lg border bg-surface px-3 py-1.5 text-sm transition-colors",
              selectedTags.length > 0
                ? "border-primary text-primary bg-primary/10"
                : "border-white/10 text-muted hover:bg-white/5 hover:text-foreground"
            )}
          >
            <Filter size={14} />
            <span>Tags {selectedTags.length > 0 ? `(${selectedTags.length})` : ""}</span>
          </button>
          
          <div className="absolute right-0 top-full mt-1 hidden w-56 flex-col overflow-hidden rounded-xl border border-white/10 bg-surface shadow-xl group-hover/filter:flex z-[40]">
            <div className="border-b border-white/5 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Filter by Tag
            </div>
            <div className="max-h-60 overflow-y-auto p-1">
              {allTags.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No tags created yet.
                </div>
              ) : (
                allTags.map((tag) => {
                  const active = selectedTags.includes(tag.id);
                  return (
                    <label
                      key={tag.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-white/5",
                        active && "bg-primary/5"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        className="rounded border-white/20 bg-background text-primary focus:ring-primary/50"
                        onChange={(e) => {
                          if (e.target.checked) setSelectedTags((prev) => [...prev, tag.id]);
                          else setSelectedTags((prev) => prev.filter((id) => id !== tag.id));
                        }}
                      />
                      <span
                        className="h-2 w-2 rounded-full ring-1 ring-inset ring-white/20"
                        style={{ backgroundColor: tag.color ?? "#6B7280" }}
                      />
                      <span className="flex-1 text-foreground">{tag.name}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={(e) => setDragId(e.active.id as string)}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragId(null)}
      >
        <div className="grid gap-3 md:grid-cols-4">
          {COLS.map(([key, label]) => {
            const colTasks = filteredRoots.filter((t) => t.status === key);
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
                          dueDate={t.dueDate}
                          subtasksDone={t._subtasksDone}
                          subtasksTotal={t._subtasksTotal}
                          overdue={isTaskOverdue(t, todayYmd)}
                          depthLabel={displayWorkDepth(t)}
                          energyLabel={displayPhysicalEnergy(t)}
                          boardStatuses={boardStatusValues}
                          onBoardStatusSelect={(next) => m.mutate({ id: t.id, status: next })}
                          onPriorityChange={(priority) => priMut.mutate({ id: t.id, priority })}
                          onStatusCycle={() => {
                            const next = STATUS_CYCLE[t.status] ?? "todo";
                            m.mutate({ id: t.id, status: next });
                          }}
                          taskId={t.id}
                          tags={t._tags}
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
                                void qc.invalidateQueries({ queryKey: ["sprintTasks"] });
                                void qc.invalidateQueries({ queryKey: ["tasks"] });
                                void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
                                toast.success(`“${t.title}” deleted`);
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
                {addingCol === key && activeSprint && (
                  <InlineAddTask
                    userId={userId}
                    areaId={defaultAreaId}
                    sprintId={activeSprint.id}
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

  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const [areaId, setAreaId] = useState("");
  const [priority, setPriority] = useState("normal");
  const [workDepth, setWorkDepth] = useState<string>("normal");
  const [physicalEnergy, setPhysicalEnergy] = useState<string>("medium");
  const [energyLevel, setEnergyLevel] = useState<string>("shallow");
  const [showSpread, setShowSpread] = useState(false);
  const [spreadStart, setSpreadStart] = useState("");
  const [spreadEnd, setSpreadEnd] = useState("");

  useEffect(() => {
    const t = q.data?.task;
    if (!t) return;
    setDueDate(t.dueDate ?? "");
    setScheduledDate(t.scheduledDate ?? "");
    const rr = t.recurrenceRule ?? "";
    if (!rr) setRecurrence("");
    else if (RECURRENCE_PRESETS.some((p) => p.value === rr)) setRecurrence(rr);
    else setRecurrence("__custom");
    setAreaId(t.areaId);
    setPriority(t.priority ?? "normal");
    setWorkDepth(t.workDepth ?? "normal");
    setPhysicalEnergy(t.physicalEnergy ?? "medium");
    setEnergyLevel(t.energyLevel ?? "shallow");
  }, [q.data?.task]);

  const addSub = useMutation({
    mutationFn: async () => {
      if (!newSubtaskTitle.trim() || !q.data) return null;
      return createSubtask({
        taskId: taskId,
        title: newSubtaskTitle.trim(),
      });
    },
    onSuccess: () => {
      setNewSubtaskTitle("");
      void qc.invalidateQueries({ queryKey: ["task", taskId] });
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
    },
  });

  const toggleSubStatus = useMutation({
    mutationFn: async (sub: SubtaskRow) => {
      const next = !sub.completed;
      return patchSubtask(sub.id, { completed: next });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["task", taskId] });
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      // Invalidate now/timeline queries as subtask completion affects their display
      void qc.invalidateQueries({ queryKey: ["tasks-today"] });
    },
  });

  const deleteSub = useMutation({
    mutationFn: async (subId: string) => deleteSubtask(subId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["task", taskId] });
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
    }
  });

  const spreadSubs = useMutation({
     mutationFn: async () => {
       if (!q.data) return null;
       const unscheduled = q.data.subtasks.filter((s: SubtaskRow) => !s.scheduledDate && !s.completed);
       if (unscheduled.length === 0 || !spreadStart || !spreadEnd) {
         toast.error("Invalid range or no unscheduled subtasks");
         return null;
       }
       const start = new Date(spreadStart);
       const end = new Date(spreadEnd);
       const diff = end.getTime() - start.getTime();
       const inc = unscheduled.length > 1 ? diff / (unscheduled.length - 1) : 0;
       
       await Promise.all(unscheduled.map((s: SubtaskRow, i: number) => {
         const date = new Date(start.getTime() + inc * i);
         const y = date.getFullYear();
         const mo = String(date.getMonth() + 1).padStart(2, "0");
         const d = String(date.getDate()).padStart(2, "0");
         const dateStr = `${y}-${mo}-${d}`;
         return patchSubtask(s.id, { scheduledDate: dateStr });
       }));
        return true;
     },
     onSuccess: () => {
        setShowSpread(false);
        setSpreadStart("");
        setSpreadEnd("");
        void qc.invalidateQueries({ queryKey: ["task", taskId] });
        void qc.invalidateQueries({ queryKey: ["tasks", userId] });
     },
     onError: (e: Error) => toast.error(e.message)
  });

  const saveMeta = useMutation({
    mutationFn: async () => {
      if (!q.data) return;
      let recurrenceRule: string | null;
      if (recurrence === "") recurrenceRule = null;
      else if (recurrence === "__custom") recurrenceRule = q.data.task.recurrenceRule ?? null;
      else recurrenceRule = recurrence;
      return patchTask(taskId, {
        dueDate: dueDate || null,
        scheduledDate: scheduledDate || null,
        recurrenceRule,
        areaId: areaId || q.data.task.areaId,
        priority: priority as "urgent" | "high" | "normal" | "low",
        workDepth: workDepth as "shallow" | "normal" | "deep",
        physicalEnergy: physicalEnergy as "low" | "medium" | "high",
        energyLevel: energyLevel as "deep_work" | "shallow" | "admin" | "quick_win",
      });
    },
    onSuccess: () => {
      toast.success("Saved");
      void qc.invalidateQueries({ queryKey: ["task", taskId] });
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      void qc.invalidateQueries({ queryKey: ["backlog", userId] });
      void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  const delTask = useMutation({
    mutationFn: () => deleteTask(taskId),
    onSuccess: () => {
      const name = q.data?.task.title ?? "Task";
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
      onClose();
      toast.success(`“${name}” deleted`, {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: () => {
            void restoreTask(taskId)
              .then(() => {
                toast.success("Task restored");
                void qc.invalidateQueries({ queryKey: ["tasks", userId] });
                void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
                void qc.invalidateQueries({ queryKey: ["task", taskId] });
              })
              .catch((err: unknown) => toast.error(String(err)));
          },
        },
      });
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

            {/* Tags */}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {(q.data.task._tags ?? []).map((tag: { id: number; name: string; color: string | null }) => (
                <TagChip key={tag.id} name={tag.name} color={tag.color} size="sm" />
              ))}
              <TagSelector
                taskId={taskId}
                currentTags={q.data.task._tags ?? []}
                onUpdate={() => {
                  void qc.invalidateQueries({ queryKey: ["task", taskId] });
                  void qc.invalidateQueries({ queryKey: ["tasks", userId] });
                }}
              />
            </div>

            <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-background/30 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Fields &amp; Deadline</p>
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
                <label className="col-span-2 block text-[11px] text-muted">
                  Cognitive energy
                  <select
                    className="mt-1 w-full rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm text-foreground"
                    value={energyLevel}
                    onChange={(e) => setEnergyLevel(e.target.value)}
                  >
                    {[
                      { value: "deep_work", label: "Deep work" },
                      { value: "shallow", label: "Low focus" },
                      { value: "admin", label: "Routine" },
                      { value: "quick_win", label: "Quick win" },
                    ].map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
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
                Schedule Date
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm text-foreground"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                />
              </label>
              <label className="block text-[11px] text-muted">
                Due Date
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm text-foreground"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </label>
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
                {saveMeta.isPending ? "Saving…" : "Save details"}
              </button>
            </div>

            <div className="mt-6 flex items-center justify-between">
              <h3 className="font-display text-sm tracking-wide text-foreground">Subtasks</h3>
              <button onClick={() => setShowSpread(!showSpread)} className="text-xs text-primary hover:text-primary-hover flex items-center gap-1">
                <Sparkles size={12}/> Spread across days
              </button>
            </div>

            {showSpread && (
               <div className="mt-2 rounded-xl border border-primary/30 bg-primary/5 p-3 flex flex-col gap-2">
                 <p className="text-xs text-muted">Distribute unscheduled subtasks across a date range.</p>
                 <div className="flex gap-2">
                   <div className="flex-1">
                     <label className="block text-[10px] uppercase tracking-wider text-muted mb-1">Start</label>
                     <input type="date" defaultValue={spreadStart} onChange={e => setSpreadStart(e.target.value)} className="w-full rounded-md bg-background px-2 py-1 text-xs border border-white/10" />
                   </div>
                   <div className="flex-1">
                     <label className="block text-[10px] uppercase tracking-wider text-muted mb-1">End</label>
                     <input type="date" defaultValue={spreadEnd} onChange={e => setSpreadEnd(e.target.value)} className="w-full rounded-md bg-background px-2 py-1 text-xs border border-white/10" />
                   </div>
                 </div>
                 <button onClick={() => spreadSubs.mutate()} disabled={!spreadStart || !spreadEnd || spreadSubs.isPending || !q.data.subtasks.some((s: SubtaskRow) => !s.scheduledDate)} className="w-full mt-2 rounded bg-primary py-1.5 text-xs text-white hover:bg-primary-hover disabled:opacity-50">
                    Apply Spread
                 </button>
               </div>
            )}

            {q.data.subtaskProgress && (
              <div className="mt-3">
                <SubtaskBar done={q.data.subtaskProgress.done} total={q.data.subtaskProgress.total} />
              </div>
            )}
            <ul className="mt-4 space-y-1.5 stagger-list">
              {q.data.subtasks.map((s: SubtaskRow) => (
                <li
                  key={s.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-lg border border-white/5 bg-background/50 px-2 py-2 transition-all hover:border-white/10",
                    s.completed && "opacity-50"
                  )}
                >
                  {/* Checkbox */}
                  <button
                    type="button"
                    className={cn(
                      "h-4 w-4 shrink-0 rounded border transition-colors",
                      s.completed
                        ? "bg-primary border-primary"
                        : "border-white/20 hover:border-primary/50"
                    )}
                    onClick={() => toggleSubStatus.mutate(s)}
                  />
                  {/* Title */}
                  <input
                    key={s.title || "title"}
                    id={`subtask-${s.id}-name`}
                    name={`subtask-${s.id}-name`}
                    className={cn(
                      "flex-1 bg-transparent px-1 min-w-0 text-sm outline-none placeholder:text-muted/50",
                      s.completed && "line-through text-muted"
                    )}
                    defaultValue={s.title}
                    disabled={s.completed}
                    onBlur={(e) => {
                      if (e.target.value !== s.title) {
                        patchSubtask(s.id, { title: e.target.value })
                          .then(() => qc.invalidateQueries({ queryKey: ["task", taskId] }));
                      }
                    }}
                  />
                  {/* Date */}
                  <input
                    key={s.scheduledDate || "date"}
                    id={`subtask-${s.id}-date`}
                    name={`subtask-${s.id}-date`}
                    type="date"
                    className="w-28 bg-transparent text-[11px] text-muted outline-none hover:text-foreground cursor-pointer"
                    defaultValue={s.scheduledDate ?? ""}
                    disabled={s.completed}
                    title="Scheduled date"
                    onChange={(e) => {
                      patchSubtask(s.id, { scheduledDate: e.target.value || null })
                        .then(() => qc.invalidateQueries({ queryKey: ["task", taskId] }));
                    }}
                  />
                  {/* Time */}
                  <input
                    type="time"
                    className="w-[4.5rem] bg-transparent text-[11px] text-muted outline-none hover:text-foreground"
                    defaultValue={s.scheduledTime?.slice(0, 5) ?? ""}
                    disabled={s.completed}
                    title="Scheduled time"
                    onChange={(e) => {
                      patchSubtask(s.id, { scheduledTime: e.target.value || null })
                        .then(() => qc.invalidateQueries({ queryKey: ["task", taskId] }));
                    }}
                  />
                  {/* Est. minutes */}
                  <input
                    type="number"
                    min={0}
                    step={5}
                    className="w-12 bg-transparent text-[11px] text-muted outline-none hover:text-foreground text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    defaultValue={s.estimatedMinutes ?? ""}
                    disabled={s.completed}
                    placeholder="min"
                    title="Estimated minutes"
                    onBlur={(e) => {
                      const val = e.target.value ? parseInt(e.target.value, 10) : null;
                      if (val !== s.estimatedMinutes) {
                        patchSubtask(s.id, { estimatedMinutes: val })
                          .then(() => qc.invalidateQueries({ queryKey: ["task", taskId] }));
                      }
                    }}
                  />
                  {/* Delete */}
                  <button
                    type="button"
                    onClick={() => { if (confirm("Delete subtask?")) deleteSub.mutate(s.id); }}
                    className="shrink-0 p-1 rounded text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-400 hover:bg-white/5 transition-all"
                    title="Delete subtask"
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex gap-2">
              <input
                className="flex-1 rounded-lg border border-white/10 bg-background px-3 py-2 text-sm placeholder:text-muted/50 focus:border-primary focus:ring-1 focus:ring-primary"
                placeholder="+ Add executable step"
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newSubtaskTitle.trim()) addSub.mutate();
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
