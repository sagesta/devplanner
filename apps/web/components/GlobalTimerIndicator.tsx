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
        "flex items-center gap-2 rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-1.5 text-xs transition-all",
        className
      )}
    >
      {/* Pulsing dot */}
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
      </span>

      <span className="text-foreground font-medium truncate max-w-[140px]" title={activeLog.taskTitle}>
        {title}
      </span>
      <span className="font-mono tabular-nums text-primary">
        {formatElapsed(elapsed)}
      </span>
      <button
        type="button"
        className="rounded p-0.5 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40"
        title="Stop timer"
        disabled={isStopping}
        onClick={stopActiveTimer}
      >
        <Square size={12} className="fill-current" />
      </button>
    </div>
  );
}
