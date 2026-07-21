"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStatus } from "@/hooks/use-auth-status";
import { CalendarCheck, Plus, ArrowLeft, Pencil, Trash2, Check, X, Target } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { createSprint, createTask, deleteSprint, fetchAreas, fetchSprints, patchSprint, fetchTasks, patchTask, type SprintRow } from "@/lib/api";
import { PriorityAnchorsCard } from "@/components/priority-anchors-card";
import { Skeleton } from "@/lib/skeleton";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  planned: "border border-[var(--hairline)] text-muted",
  active: "border border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)]",
  completed: "border border-[var(--hairline-soft)] text-[var(--muted-soft)]",
};

export default function SprintsPage() {
  const { status } = useAuthStatus();
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
  const [rangeErr, setRangeErr] = useState(false);
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
        status: "active",
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
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--teal)]">
          <Target size={14} className="text-[var(--teal)]" />
          Weekly focus
        </div>
        <p className="mb-2 text-xs text-muted">Your north-star anchor — linked to your active sprint.</p>
        <PriorityAnchorsCard variant="week" />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h1 className="font-display text-[26px] italic text-[var(--ink)]">Sprints</h1>
          <p className="text-xs text-[var(--muted-soft)]">{q.data?.sprints.length ?? 0}</p>
        </div>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full bg-[var(--ink-btn-bg)] px-4 py-2 text-[13px] font-semibold text-[var(--ink-btn-fg)] transition-opacity hover:opacity-85"
          onClick={() => setShowForm(!showForm)}
        >
          <Plus size={14} />
          New sprint
        </button>
      </div>

      {showForm && (
        <div className="mt-4 rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-4 shadow-[var(--card-shadow)] animate-slideIn">
          <h2 className="text-sm font-semibold text-[var(--ink)] mb-3">Create sprint</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[11px] uppercase tracking-[0.08em] text-muted">Name</label>
              <input
                className="mt-1 w-full rounded-lg border border-[var(--hairline)] bg-background px-3 py-2 text-sm focus:border-[var(--teal)]"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Week of April 7"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-[0.08em] text-muted">Goal</label>
              <input
                className="mt-1 w-full rounded-lg border border-[var(--hairline)] bg-background px-3 py-2 text-sm focus:border-[var(--teal)]"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Ship onboarding v2"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-[0.08em] text-muted">Start date</label>
              <input
                ref={startDateRef}
                type="date"
                className={cn(
                  "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:border-[var(--teal)]",
                  startErr ? "border-red-500/70" : "border-[var(--hairline)]"
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
              <label className="text-[11px] uppercase tracking-[0.08em] text-muted">End date</label>
              <input
                ref={endDateRef}
                type="date"
                min={startDate || undefined}
                className={cn(
                  "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:border-[var(--teal)]",
                  endErr || rangeErr ? "border-red-500/70" : "border-[var(--hairline)]"
                )}
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setEndErr(false);
                  setRangeErr(false);
                }}
              />
              {endErr && <p className="mt-1 text-xs text-red-400">This field is required.</p>}
              {!endErr && rangeErr && (
                <p className="mt-1 text-xs text-red-400">End date must be on or after start date.</p>
              )}
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-full border border-[var(--hairline)] px-3.5 py-2 text-[13px] text-muted transition-colors hover:bg-[var(--teal-a08)]"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-full bg-[var(--ink-btn-bg)] px-4 py-2 text-[13px] font-semibold text-[var(--ink-btn-fg)] disabled:opacity-40 transition-opacity hover:opacity-85"
              disabled={!name.trim() || createMut.isPending}
              onClick={() => {
                const missStart = !startDate;
                const missEnd = !endDate;
                setStartErr(missStart);
                setEndErr(missEnd);
                setRangeErr(false);
                if (missStart) {
                  startDateRef.current?.focus();
                  return;
                }
                if (missEnd) {
                  endDateRef.current?.focus();
                  return;
                }
                if (endDate < startDate) {
                  setRangeErr(true);
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
              "rounded-2xl border bg-[var(--card)] p-4 shadow-[var(--card-shadow)] card-hover",
              s.status === "active" ? "border-[var(--teal-a30)]" : "border-[var(--hairline)]"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <CalendarCheck size={14} className={cn(
                    s.status === "active" ? "text-[var(--teal)]" : "text-muted"
                  )} />

                  {/* Inline rename */}
                  {editingId === s.id ? (
                    <div className="flex items-center gap-1.5 flex-1">
                      <input
                        autoFocus
                        className="flex-1 min-w-0 rounded-md border border-[var(--teal-a30)] bg-background px-2 py-0.5 text-sm text-foreground focus:border-[var(--teal)] focus:outline-none"
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
                        className="p-1 text-[var(--success-text)] hover:bg-[var(--success-bg)] rounded"
                        onClick={() => {
                          if (editName.trim()) patchMut.mutate({ id: s.id, body: { name: editName.trim() } });
                        }}
                      >
                        <Check size={13} />
                      </button>
                      <button
                        type="button"
                        className="p-1 text-muted hover:bg-[var(--teal-a08)] rounded"
                        onClick={() => setEditingId(null)}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <h3 className="text-sm font-medium text-[var(--ink)]">{s.name}</h3>
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.05em]",
                        s.status === "active" && s.endDate && s.endDate < new Date().toISOString().slice(0, 10)
                          ? "border border-[var(--high)] text-[var(--high)]"
                          : STATUS_COLORS[s.status] ?? STATUS_COLORS.planned
                      )}>
                        {s.status === "active" && s.endDate && s.endDate < new Date().toISOString().slice(0, 10)
                          ? "expired"
                          : s.status}
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
                <p className="mt-0.5 text-[11px] text-muted/85">
                  {s.taskCount ?? 0} tasks
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--hairline-soft)] pt-3">
              {s.status !== "completed" && (
                <button
                  type="button"
                  className="rounded-full bg-[var(--ink-btn-bg)] px-3 py-1 text-[11px] font-semibold text-[var(--ink-btn-fg)] transition-opacity hover:opacity-85"
                  onClick={() => setPlanningSprintId(s.id)}
                >
                  View tasks
                </button>
              )}
              {s.status !== "active" && (
                <button
                  type="button"
                  disabled={patchMut.isPending}
                  className="rounded-full border border-[var(--teal)] px-3 py-1 text-[11px] font-semibold text-[var(--teal)] hover:bg-[var(--teal-a08)] disabled:opacity-40 transition-colors"
                  onClick={() => patchMut.mutate({ id: s.id, body: { status: "active" } })}
                >
                  Set active
                </button>
              )}
              {s.status === "active" && (
                <button
                  type="button"
                  disabled={patchMut.isPending}
                  className="rounded-full border border-[var(--hairline)] px-3 py-1 text-[11px] text-muted hover:bg-[var(--teal-a08)] hover:text-[var(--teal)] disabled:opacity-40 transition-colors"
                  onClick={() => patchMut.mutate({ id: s.id, body: { status: "planned" } })}
                >
                  Deactivate
                </button>
              )}
              {s.status !== "completed" && (
                <button
                  type="button"
                  disabled={patchMut.isPending}
                  className="rounded-full border border-[var(--hairline)] px-3 py-1 text-[11px] text-muted hover:bg-[var(--teal-a08)] hover:text-[var(--teal)] disabled:opacity-40 transition-colors"
                  onClick={() => patchMut.mutate({ id: s.id, body: { status: "completed" } })}
                >
                  Mark completed
                </button>
              )}
              {s.status === "completed" && (
                <button
                  type="button"
                  disabled={patchMut.isPending}
                  className="rounded-full border border-[var(--hairline)] px-3 py-1 text-[11px] text-muted hover:bg-[var(--teal-a08)] hover:text-[var(--teal)] disabled:opacity-40 transition-colors"
                  onClick={() => patchMut.mutate({ id: s.id, body: { status: "planned" } })}
                >
                  Reopen
                </button>
              )}

              {/* Rename */}
              {editingId !== s.id && (
                <button
                  type="button"
                  className="rounded-full border border-[var(--hairline)] px-3 py-1 text-[11px] text-muted hover:bg-[var(--teal-a08)] hover:text-[var(--teal)] transition-colors flex items-center gap-1"
                  onClick={() => {
                    setEditingId(s.id);
                    setEditName(s.name);
                  }}
                >
                  <Pencil size={10} />
                  Rename
                </button>
              )}

              {/* Delete — explicit confirm + cancel, no auto-reset misfires */}
              {deletingId === s.id ? (
                <span className="ml-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={deleteMut.isPending}
                    className="rounded-full bg-danger px-3 py-1 text-[11px] font-bold text-white hover:opacity-85 disabled:opacity-40 transition-opacity flex items-center gap-1"
                    onClick={() => {
                      setDeletingId(null);
                      deleteMut.mutate(s.id);
                    }}
                  >
                    <Trash2 size={10} />
                    Delete sprint
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-[var(--hairline)] px-3 py-1 text-[11px] text-muted hover:bg-[var(--teal-a08)] transition-colors"
                    onClick={() => setDeletingId(null)}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={deleteMut.isPending}
                  className="rounded-full border border-[var(--hairline)] px-3 py-1 text-[11px] text-[var(--rose)] hover:border-[var(--rose)] disabled:opacity-40 transition-colors flex items-center gap-1 ml-auto"
                  onClick={() => setDeletingId(s.id)}
                >
                  <Trash2 size={10} />
                  Delete
                </button>
              )}
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
  const areasQ = useQuery({
    queryKey: ["areas", userId],
    queryFn: () => fetchAreas(),
  });
  const [newTitle, setNewTitle] = useState("");

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

  const createMut = useMutation({
    mutationFn: (title: string) => {
      const areaId = areasQ.data?.[0]?.id;
      if (!areaId) throw new Error("Create an Area in Settings first.");
      return createTask({ areaId, title, sprintId: sprint.id, status: "todo" });
    },
    onSuccess: () => {
      setNewTitle("");
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
        <button onClick={onBack} className="rounded-full p-1.5 hover:bg-[var(--teal-a08)] text-muted hover:text-[var(--teal)] transition-colors">
          <ArrowLeft size={16} />
        </button>
        <div>
          <h1 className="font-display text-[22px] text-[var(--ink)]">{sprint.name}</h1>
          <p className="text-xs text-muted">{sprint.startDate} → {sprint.endDate}</p>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 gap-4 flex-col md:flex-row">
        {/* Backlog Pane */}
        <div className="flex-1 flex flex-col rounded-2xl border border-[var(--hairline)] bg-[var(--card)] shadow-[var(--card-shadow)] min-h-[300px]">
          <div className="p-3 border-b border-[var(--hairline-soft)] flex items-baseline justify-between">
            <h2 className="font-display text-[19px] italic text-[var(--ink)]">Inbox</h2>
            <span className="text-xs text-[var(--muted-soft)]">{backlogTasks.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {backlogTasks.map(t => (
              <div key={t.id} className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-[var(--hairline-soft)] bg-background text-sm card-hover">
                <span className="truncate flex-1">{t.title}</span>
                <button
                  disabled={patchMut.isPending}
                  onClick={() => patchMut.mutate({ taskId: t.id, sprintId: sprint.id })}
                  className="shrink-0 text-[13px] text-[var(--teal)] px-1 py-1 hover:underline transition-colors"
                >
                  Add to sprint →
                </button>
              </div>
            ))}
            {backlogTasks.length === 0 && (
              <p className="text-center text-xs text-muted py-8">Inbox is empty</p>
            )}
          </div>
        </div>

        {/* Sprint Pane */}
        <div className="flex-1 flex flex-col rounded-2xl border border-[var(--teal-a30)] bg-[var(--card)] shadow-[var(--card-shadow)] min-h-[300px]">
          <div className="p-3 border-b border-[var(--hairline-soft)] flex items-baseline justify-between">
            <h2 className="font-display text-[19px] italic text-[var(--ink)]">Sprint tasks</h2>
            <span className="text-xs text-[var(--muted-soft)]">{sprintTasks.length}</span>
          </div>
          <form
            className="px-3 pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = newTitle.trim();
              if (!trimmed) return;
              createMut.mutate(trimmed);
            }}
          >
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Add task to this sprint…"
                className="flex-1 rounded-lg border border-[var(--hairline)] bg-background px-3 py-2 text-sm text-foreground placeholder:text-[var(--muted-soft)] focus:border-[var(--teal)] focus:outline-none"
                disabled={createMut.isPending}
              />
              <button
                type="submit"
                disabled={createMut.isPending || !newTitle.trim()}
                className="inline-flex items-center gap-1 rounded-full bg-[var(--ink-btn-bg)] px-3.5 py-2 text-xs font-semibold text-[var(--ink-btn-fg)] transition-opacity hover:opacity-85 disabled:opacity-40"
              >
                <Plus size={14} />
                {createMut.isPending ? "Adding…" : "Add"}
              </button>
            </div>
          </form>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {sprintTasks.map(t => (
              <div key={t.id} className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-[var(--hairline-soft)] bg-background text-sm card-hover">
                <span className="truncate flex-1">{t.title}</span>
                <button
                  disabled={patchMut.isPending}
                  onClick={() => patchMut.mutate({ taskId: t.id, sprintId: null })}
                  className="shrink-0 text-[11px] text-muted hover:text-[var(--rose)] px-2 py-1 rounded transition-colors"
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
