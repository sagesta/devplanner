"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CalendarCheck,
  CheckCircle2,
  Circle,
  ListTodo,
  Rocket,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { fetchGoogleCalendarStatus } from "@/lib/api";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { cn } from "@/lib/utils";

const dismissedKey = (userId: string) =>
  `devplanner.gettingStartedDismissed.${userId}`;
const forceShowKey = (userId: string) =>
  `devplanner.gettingStartedForceShow.${userId}`;
const completedKey = (userId: string) =>
  `devplanner.gettingStartedCompleted.${userId}`;
function subscribeGuide(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("devplanner-guide-change", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("devplanner-guide-change", listener);
  };
}
function guideSnapshot(userId: string | null | undefined): string {
  if (!userId) return "1|0|0";
  const forced = localStorage.getItem(forceShowKey(userId)) === "1";
  return `${!forced && localStorage.getItem(dismissedKey(userId)) === "1" ? 1 : 0}|${forced ? 1 : 0}|${localStorage.getItem(completedKey(userId)) === "1" ? 1 : 0}`;
}

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
        <CheckCircle2
          size={18}
          className="mt-0.5 shrink-0 text-[var(--success-text)]"
        />
      ) : (
        <Circle size={18} className="mt-0.5 shrink-0 text-muted/70" />
      )}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm font-medium",
            done ? "text-muted line-through" : "text-[var(--ink)]",
          )}
        >
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
  hasDoneTask = false,
}: {
  hasAnyTask: boolean;
  hasTodayPlan: boolean;
  hasDoneTask?: boolean;
}) {
  const userId = useAppUserId();
  const snapshot = useSyncExternalStore(
    subscribeGuide,
    () => guideSnapshot(userId),
    () => "1|0|0",
  );
  const [dismissedFlag, forceFlag, completedFlag] = snapshot.split("|");
  const dismissed = dismissedFlag === "1";
  const forceShow = forceFlag === "1";
  const completed = completedFlag === "1";

  useEffect(() => {
    if (!userId) return;
    if (hasDoneTask && localStorage.getItem(completedKey(userId)) !== "1") {
      localStorage.setItem(completedKey(userId), "1");
      window.dispatchEvent(new Event("devplanner-guide-change"));
    }
  }, [userId, hasDoneTask]);

  const coreDone = completed || hasDoneTask;

  const googleQ = useQuery({
    queryKey: ["google-status", userId],
    queryFn: fetchGoogleCalendarStatus,
    enabled: Boolean(userId) && !dismissed && !coreDone,
    staleTime: 60_000,
  });
  const calendarConnected = googleQ.data?.connected === true;

  if (dismissed || (coreDone && !forceShow)) return null;

  function dismiss() {
    if (!userId) return;
    localStorage.setItem(dismissedKey(userId), "1");
    localStorage.removeItem(forceShowKey(userId));
    window.dispatchEvent(new Event("devplanner-guide-change"));
  }

  const nextStep = !hasAnyTask ? 1 : !hasTodayPlan ? 2 : !hasDoneTask ? 3 : 0;
  const completedSteps =
    Number(hasAnyTask) + Number(hasTodayPlan) + Number(hasDoneTask);

  return (
    <section className="rounded-2xl border border-[var(--teal-a30)] bg-[var(--card)] shadow-[var(--card-shadow)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--hairline-soft)] px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Rocket size={16} className="text-[var(--teal)]" />
          <h2 className="font-display text-[19px] italic text-[var(--ink)]">
            {forceShow && coreDone
              ? "Your first-task guide"
              : "Get started with one task"}
          </h2>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-[var(--teal-a08)] hover:text-[var(--ink)]"
          aria-label="Dismiss getting started checklist"
        >
          <X size={14} />
        </button>
      </div>
      <ul className="divide-y divide-[var(--hairline-soft)]">
        {nextStep === 1 && (
          <StepRow
            done={hasAnyTask}
            title="1. Add one task"
            hint="Write down one thing that needs doing. Details can come later."
            action={
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("devplanner:open-quick-add"),
                  )
                }
                className="inline-flex items-center gap-1 rounded-full border border-[var(--hairline)] px-3.5 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors hover:bg-[var(--teal-a08)]"
              >
                <ListTodo size={12} />
                Add task
              </button>
            }
          />
        )}
        {nextStep === 2 && (
          <StepRow
            done={hasTodayPlan}
            title="2. Put it on Today"
            hint="One task is enough to start. Pick it from Inbox or add it directly to Today."
            action={
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("devplanner:open-quick-add"),
                  )
                }
                className="rounded-full bg-[var(--ink-btn-bg)] px-3.5 py-1.5 text-xs font-semibold text-[var(--ink-btn-fg)] transition-opacity hover:opacity-85"
              >
                Add task
              </button>
            }
          />
        )}
        {nextStep === 3 && (
          <StepRow
            done={hasDoneTask}
            title="3. Mark it done"
            hint="Finish your first task from Today."
            action={
              <Link
                href="/now"
                className="inline-flex items-center gap-1 rounded-full border border-[var(--hairline)] px-3.5 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors hover:bg-[var(--teal-a08)]"
              >
                <CheckCircle2 size={12} />
                Today
              </Link>
            }
          />
        )}
      </ul>
      <details className="border-t border-[var(--hairline-soft)] text-xs text-muted">
        <summary className="flex min-h-11 cursor-pointer items-center px-5 py-2.5 text-[var(--teal)]">
          {completedSteps > 0
            ? `${completedSteps} step${completedSteps === 1 ? "" : "s"} complete · `
            : ""}
          Optional setup
        </summary>
        {completedSteps > 0 && (
          <ul className="divide-y divide-[var(--hairline-soft)] border-t border-[var(--hairline-soft)]">
            {hasAnyTask && <StepRow done title="1. Add one task" hint="" />}
            {hasTodayPlan && (
              <StepRow done title="2. Put it on Today" hint="" />
            )}
            {hasDoneTask && <StepRow done title="3. Mark it done" hint="" />}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--hairline-soft)] px-5 py-2.5 text-xs text-muted">
          <p className="flex items-center gap-1.5">
            <Sparkles size={12} className="text-[var(--teal)]" />
            Goals, weekly planning, and AI help are optional when you need them.
          </p>
          <Link
            href="/settings?tab=calendar"
            className="inline-flex items-center gap-1 text-[var(--teal)] hover:underline"
          >
            <CalendarCheck size={12} />
            {calendarConnected
              ? "Calendar connected"
              : "Connect calendar (optional)"}
          </Link>
        </div>
      </details>
    </section>
  );
}
