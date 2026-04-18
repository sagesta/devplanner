"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { CalendarCheck, Plus, ArrowLeft, Pencil, Trash2, Check, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { createSprint, deleteSprint, fetchSprints, patchSprint, fetchTasks, patchTask, type SprintRow } from "@/lib/api";
import { Skeleton } from "@/lib/skeleton";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  planned: "bg-blue-500/20 text-blue-300",
  active: "bg-emerald-500/20 text-emerald-300",
  completed: "bg-zinc-500/20 text-zinc-400",
};

export default function SprintsPage() {
  const { status } = useSession();
  const userId = useAppUserId();
  const qc = useQueryClient();
  const [planningSprintId, setPlanningSprintId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [goal, setGoal] = useState("");
  const [startErr, setStartErr] = useState(false);
  const [endErr, setEndErr] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const startDateRef = useRef<HTMLInputElement>(null);
  const endDateRef = useRef<HTMLInputElement>(null);

  const q = useQuery({
    queryKey: ["sprints", userId],
    queryFn: () => fetchSprints(),
    enabled: Boolean(userId),
  });

  const patchMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { status?: string; name?: string; goal?: string | null } }) =>
      patchSprint(id, body),
    onSuccess: () => {
      setEditingId(null);
      void qc.invalidateQueries({ queryKey: ["sprints", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteSprint(id),
    onSuccess: () => {
      toast.success("Sprint deleted");
      void qc.invalidateQueries({ queryKey: ["sprints", userId] });
      void qc.invalidateQueries({ queryKey: ["backlog", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createMut = useMutation({
    mutationFn: () =>
      createSprint({
        name: name.trim(),
        startDate,
        endDate,
        goal: goal.trim() || null,
        status: (q.data?.sprints && q.data.sprints.some(s => s.status === "active")) ? "planned" : "active",
      }),
    onSuccess: () => {
      toast.success("Sprint created");
      setShowForm(false);
      setName("");
      setStartDate("");
      setEndDate("");
      setGoal("");
      setStartErr(false);
      setEndErr(false);
      void qc.invalidateQueries({ queryKey: ["sprints", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (status === "loading") {
    return <Skeleton className="h-24 w-full rounded-xl" />;
  }
  if (!userId) return null;

  if (planningSprintId) {
    const sprint = q.data?.sprints.find(s => s.id === planningSprintId);
    if (!sprint) {
      setPlanningSprintId(null);
      return null;
    }
    return <SprintPlanning sprint={sprint} onBack={() => setPlanningSprintId(null)} userId={userId} />;
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-foreground">Sprints</h1>
          <p className="mt-1 text-sm text-muted">{q.data?.sprints.length ?? 0} sprints</p>
        </div>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-hover transition-colors"
          onClick={() => setShowForm(!showForm)}
        >
          <Plus size={14} />
          New sprint
        </button>
      </div>

      {showForm && (
        <div className="mt-4 rounded-xl border border-white/10 bg-surface p-4 animate-slideIn">
          <h2 className="text-sm font-semibold text-foreground mb-3">Create sprint</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted">Name</label>
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Week of April 7"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted">Goal</label>
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Ship onboarding v2"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted">Start date</label>
              <input
                ref={startDateRef}
                type="date"
                className={cn(
                  "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm",
                  startErr ? "border-red-500/70" : "border-white/10"
                )}
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setStartErr(false);
                }}
              />
              {startErr && (
                <p className="mt-1 text-xs text-red-400">This field is required.</p>
              )}
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted">End date</label>
              <input
                ref={endDateRef}
                type="date"
                className={cn(
                  "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm",
                  endErr ? "border-red-500/70" : "border-white/10"
                )}
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setEndErr(false);
                }}
              />
              {endErr && <p className="mt-1 text-xs text-red-400">This field is required.</p>}
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-white/5"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-40 hover:bg-primary-hover transition-colors"
              disabled={!name.trim() || createMut.isPending}
              onClick={() => {
                const missStart = !startDate;
                const missEnd = !endDate;
                setStartErr(missStart);
                setEndErr(missEnd);
                if (missStart) {
                  startDateRef.current?.focus();
                  return;
                }
                if (missEnd) {
                  endDateRef.current?.focus();
                  return;
                }
                createMut.mutate();
              }}
            >
              {createMut.isPending ? "Creating…" : "Create sprint"}
            </button>
          </div>
        </div>
      )}

      {q.isLoading && (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      )}

      <div className="mt-4 space-y-3 stagger-list">
        {(q.data?.sprints ?? []).map((s) => (
          <div
            key={s.id}
            className={cn(
              "rounded-xl border bg-surface p-4 card-hover",
              s.status === "active"
                ? "border-primary/30 shadow-sm shadow-primary/5"
                : "border-white/10"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <CalendarCheck size={14} className={cn(
                    s.status === "active" ? "text-primary" : "text-muted"
                  )} />

                  {/* Inline rename */}
                  {editingId === s.id ? (
                    <div className="flex items-center gap-1.5 flex-1">
                      <input
                        autoFocus
                        className="flex-1 min-w-0 rounded-md border border-primary/50 bg-background px-2 py-0.5 text-sm text-foreground focus:outline-none"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && editName.trim()) {
                            patchMut.mutate({ id: s.id, body: { name: editName.trim() } });
                          } else if (e.key === "Escape") {
                            setEditingId(null);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="p-1 text-success hover:bg-success/10 rounded"
                        onClick={() => {
                          if (editName.trim()) patchMut.mutate({ id: s.id, body: { name: editName.trim() } });
                        }}
                      >
                        <Check size={13} />
                      </button>
                      <button
                        type="button"
                        className="p-1 text-muted hover:bg-white/10 rounded"
                        onClick={() => setEditingId(null)}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <h3 className="text-sm font-medium text-foreground">{s.name}</h3>
                      <span className={cn(
                        "rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider",
                        STATUS_COLORS[s.status] ?? STATUS_COLORS.planned
                      )}>
                        {s.status}
                      </span>
                    </>
                  )}
                </div>
                {s.goal && (
                  <p className="mt-1 text-xs text-muted">{s.goal}</p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-muted">
                  {s.startDate} → {s.endDate}
                </p>
                <p className="mt-0.5 text-[10px] text-muted/60">
                  {s.taskCount ?? 0} tasks
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/5 pt-3">
              {s.status !== "completed" && (
                <button
                  type="button"
                  className="rounded-md bg-white/10 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-white/20 transition-colors"
                  onClick={() => setPlanningSprintId(s.id)}
                >
                  View tasks
                </button>
              )}
              {s.status !== "active" && (
                <button
                  type="button"
                  disabled={patchMut.isPending}
                  className="rounded-md bg-primary/80 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-primary disabled:opacity-40 transition-colors"
                  onClick={() => patchMut.mutate({ id: s.id, body: { status: "active" } })}
                >
                  Set active
                </button>
              )}
              {s.status === "active" && (
                <button
                  type="button"
                  disabled={patchMut.isPending}
                  className="rounded-md border border-white/15 px-2.5 py-1 text-[10px] text-foreground hover:bg-white/5 disabled:opacity-40 transition-colors"
                  onClick={() => patchMut.mutate({ id: s.id, body: { status: "planned" } })}
                >
                  Unset active
                </button>
              )}
              {s.status !== "completed" && (
                <button
                  type="button"
                  disabled={patchMut.isPending}
                  className="rounded-md border border-white/15 px-2.5 py-1 text-[10px] text-muted hover:bg-white/5 disabled:opacity-40 transition-colors"
                  onClick={() => patchMut.mutate({ id: s.id, body: { status: "completed" } })}
                >
                  Mark completed
                </button>
              )}
              {s.status === "completed" && (
                <button
                  type="button"
                  disabled={patchMut.isPending}
                  className="rounded-md border border-white/15 px-2.5 py-1 text-[10px] text-muted hover:bg-white/5 disabled:opacity-40 transition-colors"
                  onClick={() => patchMut.mutate({ id: s.id, body: { status: "planned" } })}
                >
                  Reopen
                </button>
              )}

              {/* Rename */}
              {editingId !== s.id && (
                <button
                  type="button"
                  className="rounded-md border border-white/10 px-2.5 py-1 text-[10px] text-muted hover:bg-white/5 hover:text-foreground transition-colors flex items-center gap-1"
                  onClick={() => {
                    setEditingId(s.id);
                    setEditName(s.name);
                  }}
                >
                  <Pencil size={10} />
                  Rename
                </button>
              )}

              {/* Delete */}
              <button
                type="button"
                disabled={deleteMut.isPending}
                className={cn("rounded-md border px-2.5 py-1 text-[10px] disabled:opacity-40 transition-colors flex items-center gap-1 ml-auto",
                  deletingId === s.id ? "border-red-500 text-red-500 bg-red-500/10 font-bold" : "border-red-500/20 text-red-400/70 hover:bg-red-500/10 hover:text-red-300"
                )}
                onClick={() => {
                  if (deletingId !== s.id) {
                    setDeletingId(s.id);
                    setTimeout(() => setDeletingId(null), 3000);
                    return;
                  }
                  setDeletingId(null);
                  deleteMut.mutate(s.id);
                }}
              >
                <Trash2 size={10} />
                {deletingId === s.id ? "Confirm?" : "Delete"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SprintPlanning({ sprint, onBack, userId }: { sprint: SprintRow; onBack: () => void; userId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["tasks", userId],
    queryFn: () => fetchTasks(),
  });

  const patchMut = useMutation({
    mutationFn: ({ taskId, sprintId }: { taskId: string; sprintId: string | null }) =>
      patchTask(taskId, { sprintId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      void qc.invalidateQueries({ queryKey: ["sprints", userId] });
      void qc.invalidateQueries({ queryKey: ["backlog", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;

  const roots = q.data ?? [];
  const sprintTasks = roots.filter(t => t.sprintId === sprint.id);
  const backlogTasks = roots.filter(t => t.sprintId === null);

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] animate-slideIn">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="rounded p-1.5 hover:bg-white/10 text-muted hover:text-foreground transition-colors">
          <ArrowLeft size={16} />
        </button>
        <div>
          <h1 className="font-display text-xl text-foreground">{sprint.name}</h1>
          <p className="text-xs text-muted">{sprint.startDate} → {sprint.endDate}</p>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 gap-4 flex-col md:flex-row">
        {/* Backlog Pane */}
        <div className="flex-1 flex flex-col rounded-xl border border-white/10 bg-surface min-h-[300px]">
          <div className="p-3 border-b border-white/5 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Backlog</h2>
            <span className="text-[10px] text-muted">{backlogTasks.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {backlogTasks.map(t => (
              <div key={t.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-white/5 bg-background text-sm card-hover">
                <span className="truncate flex-1">{t.title}</span>
                <button
                  disabled={patchMut.isPending}
                  onClick={() => patchMut.mutate({ taskId: t.id, sprintId: sprint.id })}
                  className="shrink-0 text-[10px] bg-primary/20 text-primary px-2 py-1 rounded hover:bg-primary/30 transition-colors"
                >
                  Add to sprint
                </button>
              </div>
            ))}
            {backlogTasks.length === 0 && (
              <p className="text-center text-xs text-muted py-8">Backlog is empty</p>
            )}
          </div>
        </div>

        {/* Sprint Pane */}
        <div className="flex-1 flex flex-col rounded-xl border border-primary/30 bg-surface min-h-[300px] shadow-sm shadow-primary/5">
          <div className="p-3 border-b border-white/5 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-primary">Sprint Tasks</h2>
            <span className="text-[10px] text-muted">{sprintTasks.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {sprintTasks.map(t => (
              <div key={t.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-white/5 bg-background text-sm card-hover">
                <span className="truncate flex-1">{t.title}</span>
                <button
                  disabled={patchMut.isPending}
                  onClick={() => patchMut.mutate({ taskId: t.id, sprintId: null })}
                  className="shrink-0 text-[10px] text-muted hover:text-red-400 px-2 py-1 rounded hover:bg-white/5 transition-colors"
                >
                  Remove
                </button>
              </div>
            ))}
            {sprintTasks.length === 0 && (
              <p className="text-center text-xs text-muted py-8">No tasks in this sprint</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
