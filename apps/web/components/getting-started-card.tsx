"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, CalendarRange, CheckCircle2, Circle, ListTodo, Rocket, Sparkles, Target, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchGoalHorizons, fetchGoogleCalendarStatus, fetchSprints } from "@/lib/api";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { cn } from "@/lib/utils";

const LS_DISMISSED = "devplanner.gettingStartedDismissed";

/** Anyone (the AppShell brain-dump owner) listening can open the capture modal. */
export function requestBrainDump() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("devplanner:open-brain-dump"));
  }
}

function StepRow({
  done,
  title,
  hint,
  action,
}: {
  done: boolean;
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      {done ? (
        <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[var(--success-text)]" />
      ) : (
        <Circle size={18} className="mt-0.5 shrink-0 text-muted/70" />
      )}
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium", done ? "text-muted line-through" : "text-[var(--ink)]")}>
          {title}
        </p>
        {!done && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      {!done && action && <div className="shrink-0">{action}</div>}
    </li>
  );
}

/**
 * First-run checklist shown on Today until the user has a complete planning
 * loop: direction, captured work, a weekly commitment, and a daily plan.
 */
export function GettingStartedCard({
  hasAnyTask,
  hasTodayPlan,
}: {
  hasAnyTask: boolean;
  hasTodayPlan: boolean;
}) {
  const userId = useAppUserId();
  const [dismissed, setDismissed] = useState(true); // assume hidden until we read storage

  useEffect(() => {
    setDismissed(localStorage.getItem(LS_DISMISSED) === "1");
  }, []);

  const goalsQ = useQuery({
    queryKey: ["goal-horizons", userId],
    queryFn: fetchGoalHorizons,
    enabled: Boolean(userId) && !dismissed,
    staleTime: 60_000,
  });
  const sprintsQ = useQuery({
    queryKey: ["sprints", userId],
    queryFn: fetchSprints,
    enabled: Boolean(userId) && !dismissed,
    staleTime: 60_000,
  });
  const hasGoal = Object.values(goalsQ.data?.goals ?? {}).some((goal) => goal.trim());
  const hasSprint = (sprintsQ.data?.sprints ?? []).some((sprint) => sprint.status !== "completed");
  const coreDone = hasGoal && hasAnyTask && hasSprint && hasTodayPlan;

  const googleQ = useQuery({
    queryKey: ["google-status", userId],
    queryFn: fetchGoogleCalendarStatus,
    enabled: Boolean(userId) && !dismissed && !coreDone,
    staleTime: 60_000,
  });
  const calendarConnected = googleQ.data?.connected === true;

  if (dismissed || coreDone) return null;

  function dismiss() {
    localStorage.setItem(LS_DISMISSED, "1");
    setDismissed(true);
  }

  return (
    <section className="rounded-2xl border border-[var(--teal-a30)] bg-[var(--card)] shadow-[var(--card-shadow)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--hairline-soft)] px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Rocket size={16} className="text-[var(--teal)]" />
          <h2 className="font-display text-[19px] italic text-[var(--ink)]">Build your first planning loop</h2>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-full p-1 text-muted transition-colors hover:bg-[var(--teal-a08)] hover:text-[var(--ink)]"
          aria-label="Dismiss getting started checklist"
        >
          <X size={14} />
        </button>
      </div>
      <ul className="divide-y divide-[var(--hairline-soft)]">
        <StepRow
          done={hasGoal}
          title="1. Choose a direction"
          hint="Write one result you want, even if you do not yet know all the steps."
          action={
            <Link
              href="/goals"
              className="inline-flex items-center gap-1 rounded-full border border-[var(--hairline)] px-3.5 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors hover:bg-[var(--teal-a08)]"
            >
              <Target size={12} />
              Goals
            </Link>
          }
        />
        <StepRow
          done={hasAnyTask}
          title="2. Empty your head"
          hint="Type or speak everything on your mind — one task per line. DevPlanner sorts it."
          action={
            <button
              type="button"
              onClick={requestBrainDump}
              className="rounded-full bg-[var(--ink-btn-bg)] px-3.5 py-1.5 text-xs font-semibold text-[var(--ink-btn-fg)] transition-opacity hover:opacity-85"
            >
              Brain Dump
            </button>
          }
        />
        <StepRow
          done={hasSprint}
          title="3. Choose this week's focus"
          hint="Create a sprint for the few outcomes you are willing to commit to this week."
          action={
            <Link
              href="/plan?view=sprints"
              className="inline-flex items-center gap-1 rounded-full border border-[var(--hairline)] px-3.5 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors hover:bg-[var(--teal-a08)]"
            >
              <CalendarRange size={12} />
              Plan week
            </Link>
          }
        />
        <StepRow
          done={hasTodayPlan}
          title="4. Pick today's tasks"
          hint="Choose 3–7 tasks for today. One big, a few medium, a few small."
          action={
            <Link
              href="/backlog"
              className="inline-flex items-center gap-1 rounded-full border border-[var(--hairline)] px-3.5 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors hover:bg-[var(--teal-a08)]"
            >
              <ListTodo size={12} />
              Open Inbox
            </Link>
          }
        />
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--hairline-soft)] px-5 py-2.5 text-xs text-muted">
        <p className="flex items-center gap-1.5">
          <Sparkles size={12} className="text-[var(--teal)]" />
          The AI assistant can propose steps for a goal before creating tasks.
        </p>
        <Link href="/settings?tab=calendar" className="inline-flex items-center gap-1 text-[var(--teal)] hover:underline">
          <CalendarCheck size={12} />
          {calendarConnected ? "Calendar connected" : "Connect calendar (optional)"}
        </Link>
      </div>
    </section>
  );
}
