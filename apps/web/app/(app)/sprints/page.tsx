"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { createSprint, fetchSprints, getDevUserId, type SprintRow } from "@/lib/api";
import { Skeleton } from "@/lib/skeleton";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  planned: "bg-blue-500/20 text-blue-300",
  active: "bg-emerald-500/20 text-emerald-300",
  completed: "bg-zinc-500/20 text-zinc-400",
};

export default function SprintsPage() {
  const userId = getDevUserId();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [goal, setGoal] = useState("");

  const q = useQuery({
    queryKey: ["sprints", userId],
    queryFn: () => fetchSprints(userId),
    enabled: Boolean(userId),
  });

  const createMut = useMutation({
    mutationFn: () =>
      createSprint({
        userId,
        name: name.trim(),
        startDate,
        endDate,
        goal: goal.trim() || null,
        status: "planned",
      }),
    onSuccess: () => {
      toast.success("Sprint created");
      setShowForm(false);
      setName("");
      setStartDate("");
      setEndDate("");
      setGoal("");
      void qc.invalidateQueries({ queryKey: ["sprints", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!userId) return <p className="text-muted">Set NEXT_PUBLIC_DEV_USER_ID</p>;

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
                type="date"
                className="mt-1 w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted">End date</label>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
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
              disabled={!name.trim() || !startDate || !endDate || createMut.isPending}
              onClick={() => createMut.mutate()}
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
              <div>
                <div className="flex items-center gap-2">
                  <CalendarCheck size={14} className={cn(
                    s.status === "active" ? "text-primary" : "text-muted"
                  )} />
                  <h3 className="text-sm font-medium text-foreground">{s.name}</h3>
                  <span className={cn(
                    "rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider",
                    STATUS_COLORS[s.status] ?? STATUS_COLORS.planned
                  )}>
                    {s.status}
                  </span>
                </div>
                {s.goal && (
                  <p className="mt-1 text-xs text-muted">{s.goal}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs text-muted">
                  {s.startDate} → {s.endDate}
                </p>
                <p className="mt-0.5 text-[10px] text-muted/60">
                  {s.taskCount ?? 0} tasks
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
