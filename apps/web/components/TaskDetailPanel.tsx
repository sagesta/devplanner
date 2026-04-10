"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, X, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  fetchAreas,
  fetchTaskDetail,
  patchTask,
  deleteTask,
  restoreTask,
  createSubtask,
  patchSubtask,
  deleteSubtask,
  postSubtasksSpread,
  type SubtaskRow,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { SubtaskBar } from "./task-card";
import { TagChip } from "./TagChip";
import { TagSelector } from "./TagSelector";

const RECURRENCE_PRESETS: { label: string; value: string }[] = [
  { label: "No repeat", value: "" },
  { label: "Daily", value: "FREQ=DAILY" },
  { label: "Weekly", value: "FREQ=WEEKLY" },
  { label: "Weekdays", value: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
];

export function TaskDetailPanel({
  taskId,
  userId,
  isOpen,
  onClose,
}: {
  taskId: string;
  userId: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => fetchTaskDetail(taskId),
    enabled: isOpen && Boolean(taskId),
  });

  const areasQ = useQuery({
    queryKey: ["areas", userId],
    queryFn: () => fetchAreas(),
    enabled: isOpen && Boolean(userId),
  });

  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const [areaId, setAreaId] = useState("");
  const [priority, setPriority] = useState("normal");
  const [workDepth, setWorkDepth] = useState<string>("normal");
  const [physicalEnergy, setPhysicalEnergy] = useState<string>("medium");
  const [status, setStatus] = useState<string>("todo");

  useEffect(() => {
    const t = q.data?.task;
    if (!t) return;
    setTitle(t.title);
    setDescription(t.description ?? "");
    setDueDate(t.dueDate ?? "");
    const rr = t.recurrenceRule ?? "";
    if (!rr) setRecurrence("");
    else if (RECURRENCE_PRESETS.some((p) => p.value === rr)) setRecurrence(rr);
    else setRecurrence("__custom");
    setAreaId(t.areaId);
    setPriority(t.priority ?? "normal");
    setWorkDepth(t.workDepth ?? "normal");
    setPhysicalEnergy(t.physicalEnergy ?? "medium");
    setStatus(t.status);
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

  const updateTaskDetails = useMutation({
    mutationFn: async (updates: Partial<Record<string, any>>) => {
      return patchTask(taskId, updates);
    },
    onSuccess: () => {
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

  // Handle ESC key globally when open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-white/10 bg-surface shadow-2xl animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header section fixed */}
        <div className="flex shrink-0 items-start justify-between border-b border-white/5 p-5">
          <div className="flex-1 mr-4">
            {q.isLoading ? (
              <div className="animate-shimmer h-8 w-3/4 rounded bg-white/5" />
            ) : (
              <input
                className="w-full bg-transparent font-display text-2xl font-bold text-foreground outline-none focus:ring-1 focus:ring-primary/50"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => {
                  if (title !== q.data?.task.title) {
                    updateTaskDetails.mutate({ title });
                  }
                }}
                placeholder="Task title"
              />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="rounded-lg p-1.5 text-muted hover:bg-red-500/15 hover:text-red-300"
              title="Delete task"
              disabled={delTask.isPending}
              onClick={() => {
                if (!confirm(`Delete “${title}”?`)) return;
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

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {q.isLoading ? (
            <div className="space-y-4">
              <div className="animate-shimmer h-24 w-full rounded bg-white/5" />
              <div className="animate-shimmer h-32 w-full rounded bg-white/5" />
              <div className="animate-shimmer h-40 w-full rounded bg-white/5" />
            </div>
          ) : q.data && (
            <>
              {/* Description */}
              <div>
                <textarea
                  placeholder="Add description..."
                  className="w-full min-h-[80px] rounded-lg border border-white/10 bg-background/50 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={() => {
                    if (description !== (q.data?.task.description ?? "")) {
                      updateTaskDetails.mutate({ description: description || null });
                    }
                  }}
                />
              </div>

              {/* Tags */}
              <div className="flex items-center gap-2 flex-wrap">
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

              {/* Subtasks */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-base tracking-wide text-foreground">
                    Subtasks ({q.data.subtaskProgress?.done || 0}/{q.data.subtasks.length || 0})
                  </h3>
                </div>

                {q.data.subtaskProgress && (
                  <SubtaskBar done={q.data.subtaskProgress.done} total={q.data.subtaskProgress.total} />
                )}

                <ul className="space-y-1.5 stagger-list">
                  {q.data.subtasks.map((s: SubtaskRow) => (
                    <li
                      key={s.id}
                      className={cn(
                        "group flex items-center gap-2 rounded-lg border border-white/5 bg-background/50 px-2 py-2 transition-all hover:border-white/10",
                        s.completed && "opacity-50"
                      )}
                    >
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
                      <input
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

                <div className="mt-2 flex gap-2">
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
                    Add subtask
                  </button>
                </div>
              </div>

              {/* Metadata Grid */}
              <div className="grid grid-cols-2 gap-4 rounded-xl border border-white/10 bg-background/30 p-4">
                <label className="block text-xs text-muted">
                  Status
                  <select
                    className="mt-1 w-full rounded-lg border border-white/10 bg-background px-2 py-2 text-sm text-foreground capitalize"
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value);
                      updateTaskDetails.mutate({ status: e.target.value });
                    }}
                  >
                    {(["backlog", "todo", "in_progress", "done", "blocked", "cancelled"] as const).map((s) => (
                      <option key={s} value={s}>
                        {s.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-muted">
                  Priority
                  <select
                    className="mt-1 w-full rounded-lg border border-white/10 bg-background px-2 py-2 text-sm text-foreground capitalize"
                    value={priority}
                    onChange={(e) => {
                      setPriority(e.target.value);
                      updateTaskDetails.mutate({ priority: e.target.value });
                    }}
                  >
                    {(["urgent", "high", "normal", "low"] as const).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-muted">
                  Depth
                  <select
                    className="mt-1 w-full rounded-lg border border-white/10 bg-background px-2 py-2 text-sm text-foreground capitalize"
                    value={workDepth}
                    onChange={(e) => {
                      setWorkDepth(e.target.value);
                      updateTaskDetails.mutate({ workDepth: e.target.value });
                    }}
                  >
                    {(["shallow", "normal", "deep"] as const).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-muted">
                  Physical energy
                  <select
                    className="mt-1 w-full rounded-lg border border-white/10 bg-background px-2 py-2 text-sm text-foreground capitalize"
                    value={physicalEnergy}
                    onChange={(e) => {
                      setPhysicalEnergy(e.target.value);
                      updateTaskDetails.mutate({ physicalEnergy: e.target.value });
                    }}
                  >
                    {(["low", "medium", "high"] as const).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-muted">
                  Area
                  <select
                    className="mt-1 w-full rounded-lg border border-white/10 bg-background px-2 py-2 text-sm text-foreground"
                    value={areaId}
                    onChange={(e) => {
                      setAreaId(e.target.value);
                      updateTaskDetails.mutate({ areaId: e.target.value });
                    }}
                  >
                    {(areasQ.data ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-muted">
                  Due Date
                  <input
                    type="date"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-background px-2 py-2 text-sm text-foreground"
                    value={dueDate}
                    onChange={(e) => {
                      setDueDate(e.target.value);
                      updateTaskDetails.mutate({ dueDate: e.target.value || null });
                    }}
                  />
                </label>
              </div>

            </>
          )}
        </div>
        <div className="flex shrink-0 justify-end border-t border-white/5 p-4 bg-surface/50">
           <button onClick={onClose} className="rounded bg-white/10 px-4 py-2 text-sm hover:bg-white/20 transition text-white font-medium">Close</button>
        </div>
      </div>
    </div>
  );
}
