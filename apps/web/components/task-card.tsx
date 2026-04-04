"use client";

import { cn } from "@/lib/utils";

type TaskCardProps = {
  title: string;
  status: string;
  priority: string;
  energyLevel: string;
  areaColor?: string | null;
  areaName?: string;
  scheduledDate?: string | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  subtasksDone?: number;
  subtasksTotal?: number;
  compact?: boolean;
  onStatusCycle?: () => void;
  className?: string;
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500/20 text-red-300",
  high: "bg-orange-500/20 text-orange-300",
  normal: "bg-zinc-500/20 text-zinc-300",
  low: "bg-zinc-700/20 text-zinc-500",
};

/** Solid bar fills for timeline / Gantt-style views (pairs with PRIORITY_COLORS badges). */
export const PRIORITY_BAR_CLASS: Record<string, string> = {
  urgent: "bg-red-500/85",
  high: "bg-orange-500/85",
  normal: "bg-zinc-400/80",
  low: "bg-zinc-600/85",
};

const ENERGY_ICONS: Record<string, string> = {
  deep_work: "🔴",
  shallow: "🟡",
  admin: "🟢",
  quick_win: "⚡",
};

const ENERGY_LABELS: Record<string, string> = {
  deep_work: "Deep work",
  shallow: "Shallow",
  admin: "Admin",
  quick_win: "Quick win",
};

const STATUS_COLORS: Record<string, string> = {
  backlog: "bg-zinc-600",
  todo: "bg-blue-500",
  in_progress: "bg-amber-500",
  done: "bg-emerald-500",
  cancelled: "bg-zinc-700",
  blocked: "bg-red-600",
};

export function StatusDot({
  status,
  onClick,
  className,
}: {
  status: string;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Status: ${status.replace("_", " ")}`}
      className={cn(
        "h-2.5 w-2.5 shrink-0 rounded-full transition-transform hover:scale-125",
        STATUS_COLORS[status] ?? "bg-zinc-500",
        onClick && "cursor-pointer",
        className
      )}
    />
  );
}

export function SubtaskBar({
  done,
  total,
}: {
  done: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 w-12 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-muted">
        {done}/{total}
      </span>
    </div>
  );
}

export function TaskCard({
  title,
  status,
  priority,
  energyLevel,
  areaColor,
  areaName,
  scheduledDate,
  scheduledStartTime,
  scheduledEndTime,
  subtasksDone,
  subtasksTotal,
  compact = false,
  onStatusCycle,
  className,
}: TaskCardProps) {
  const hasSubtasks = subtasksTotal != null && subtasksTotal > 0;
  const timeBlock =
    scheduledStartTime && scheduledEndTime
      ? `${scheduledStartTime.slice(0, 5)}–${scheduledEndTime.slice(0, 5)}`
      : null;

  return (
    <div
      className={cn(
        "group rounded-md border border-white/5 bg-background/90 transition-all duration-200",
        "hover:border-white/15 hover:shadow-lg hover:shadow-black/10",
        compact ? "px-2 py-1.5" : "px-3 py-2.5",
        className
      )}
    >
      <div className="flex items-start gap-2">
        {areaColor && (
          <span
            className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: areaColor }}
            title={areaName}
          />
        )}
        <StatusDot status={status} onClick={onStatusCycle} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <p className={cn(
            "text-foreground leading-snug",
            compact ? "text-xs" : "text-sm",
            status === "done" && "line-through opacity-60"
          )}>
            {title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-block rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider",
                PRIORITY_COLORS[priority] ?? PRIORITY_COLORS.normal
              )}
            >
              {priority}
            </span>
            <span className="text-[10px] text-muted">
              {ENERGY_ICONS[energyLevel] ?? "·"} {ENERGY_LABELS[energyLevel] ?? energyLevel}
            </span>
            {timeBlock && (
              <span className="text-[10px] font-mono text-muted">{timeBlock}</span>
            )}
            {scheduledDate && !timeBlock && (
              <span className="text-[10px] text-muted">{scheduledDate}</span>
            )}
          </div>
          {hasSubtasks && (
            <div className="mt-1.5">
              <SubtaskBar done={subtasksDone ?? 0} total={subtasksTotal} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
