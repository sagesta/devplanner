"use client";

import { Play, Square } from "lucide-react";
import { useActiveTimer, formatElapsed } from "@/hooks/use-active-timer";
import { cn } from "@/lib/utils";

/**
 * TimerButton — play/stop per-task timer with pulsing ring animation.
 *
 * Three states:
 *  1. Idle → play icon
 *  2. Active for THIS task → pulsing ring + HH:MM:SS + stop icon
 *  3. Active for ANOTHER task → muted play icon (starts new timer, auto-stops other)
 */
export function TimerButton({
  taskId,
  compact = false,
  className,
}: {
  taskId: string;
  compact?: boolean;
  className?: string;
}) {
  const { activeLog, isRunning, elapsed, startTimer, stopActiveTimer, isStarting, isStopping } =
    useActiveTimer();

  const isThisTask = isRunning && activeLog?.taskId === taskId;
  const isOtherTask = isRunning && activeLog?.taskId !== taskId;

  if (isThisTask) {
    return (
      <button
        type="button"
        className={cn(
          "group relative inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-mono font-medium transition-colors",
          "bg-primary/15 text-primary hover:bg-primary/25",
          className
        )}
        title="Stop timer"
        disabled={isStopping}
        onClick={(e) => {
          e.stopPropagation();
          stopActiveTimer();
        }}
      >
        {/* Pulsing ring */}
        <span className="timer-pulse-ring absolute inset-0 rounded-lg" />
        <Square size={compact ? 10 : 12} className="relative z-10 fill-current" />
        {!compact && (
          <span className="relative z-10 tabular-nums">{formatElapsed(elapsed)}</span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center rounded-lg p-1 transition-colors",
        isOtherTask
          ? "text-muted/50 hover:text-muted hover:bg-white/5"
          : "text-muted hover:text-primary hover:bg-primary/10",
        className
      )}
      title={isOtherTask ? "Start timer (stops current)" : "Start timer"}
      disabled={isStarting}
      onClick={(e) => {
        e.stopPropagation();
        startTimer(taskId);
      }}
    >
      <Play size={compact ? 10 : 14} />
    </button>
  );
}
