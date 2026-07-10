"use client";

import { Square } from "lucide-react";
import { useActiveTimer, formatElapsed } from "@/hooks/use-active-timer";
import { cn } from "@/lib/utils";

/**
 * GlobalTimerIndicator — shows in the app header when a timer is running.
 * Displays: pulsing dot + task title (truncated) + HH:MM:SS + stop button.
 */
export function GlobalTimerIndicator({ className }: { className?: string }) {
  const { activeLog, isRunning, elapsed, stopActiveTimer, isStopping } =
    useActiveTimer();

  if (!isRunning || !activeLog) return null;

  const title =
    activeLog.taskTitle.length > 22
      ? activeLog.taskTitle.slice(0, 20) + "…"
      : activeLog.taskTitle;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border border-[var(--teal-a20)] bg-[var(--teal-a08)] px-3 py-1.5 text-xs transition-all",
        className
      )}
    >
      {/* Pulsing dot */}
      <span className="relative flex h-[7px] w-[7px]">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--teal)] opacity-75" />
        <span className="relative inline-flex h-[7px] w-[7px] rounded-full bg-[var(--teal)]" />
      </span>

      <span className="max-w-[130px] truncate text-muted" title={activeLog.taskTitle}>
        {title}
      </span>
      <span className="font-mono font-semibold tabular-nums text-[var(--teal)]">
        {formatElapsed(elapsed)}
      </span>
      <button
        type="button"
        className="rounded-full p-0.5 text-[var(--teal)] transition-colors hover:bg-[var(--teal-a12)] disabled:opacity-40"
        title="Stop timer"
        disabled={isStopping}
        onClick={stopActiveTimer}
      >
        <Square size={11} className="fill-current" />
      </button>
    </div>
  );
}
