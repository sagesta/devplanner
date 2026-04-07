"use client";

import { ChevronRight } from "lucide-react";
import { memo, useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { TagChip } from "./TagChip";
import { TimerButton } from "./TimerButton";

const PRIORITY_OPTIONS = ["low", "normal", "high", "urgent"] as const;

type TaskCardProps = {
  title: string;
  status: string;
  priority: string;
  energyLevel: string;
  areaColor?: string | null;
  areaName?: string;
  dueDate?: string | null;
  subtasksDone?: number;
  subtasksTotal?: number;
  compact?: boolean;
  onStatusCycle?: () => void;
  /** stress-test-fix: keyboard/mobile status advance */
  showStatusAdvance?: boolean;
  /** stress-test-fix: priority dropdown on board */
  onPriorityChange?: (priority: string) => void;
  overdue?: boolean;
  depthLabel?: string;
  energyLabel?: string;
  className?: string;
  /** Board-only: quick status dropdown (fallback when DnD is awkward). */
  boardStatuses?: readonly string[];
  onBoardStatusSelect?: (status: string) => void;
  /** Task ID — enables timer button when provided */
  taskId?: string;
  /** Tags to display on the card */
  tags?: Array<{ id: number; name: string; color: string | null }>;
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



const STATUS_COLORS: Record<string, string> = {
  backlog: "bg-zinc-600",
  todo: "bg-blue-500",
  in_progress: "bg-amber-500",
  done: "bg-emerald-500",
  cancelled: "bg-zinc-700",
  blocked: "bg-red-600",
};

export const StatusDot = memo(function StatusDot({
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
      onPointerDown={(e) => e.stopPropagation()}
      title={`Status: ${status.replace("_", " ")}`}
      className={cn(
        "h-2.5 w-2.5 shrink-0 rounded-full transition-transform hover:scale-125",
        STATUS_COLORS[status] ?? "bg-zinc-500",
        onClick && "cursor-pointer",
        className
      )}
    />
  );
});

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

export const TaskCard = memo(function TaskCard({
  title,
  status,
  priority,
  energyLevel,
  areaColor,
  areaName,
  dueDate,
  subtasksDone,
  subtasksTotal,
  compact = false,
  onStatusCycle,
  showStatusAdvance = true,
  onPriorityChange,
  overdue,
  depthLabel,
  energyLabel,
  className,
  boardStatuses,
  onBoardStatusSelect,
  taskId,
  tags,
}: TaskCardProps) {
  const [priOpen, setPriOpen] = useState(false);
  const priRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!priOpen) return;
    const close = (e: Event) => {
      if (priRef.current && !priRef.current.contains(e.target as Node)) setPriOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [priOpen]);

  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const openPriorityDropdown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (priRef.current) {
      const rect = priRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
    setPriOpen((o) => !o);
  }, []);

  const hasSubtasks = subtasksTotal != null && subtasksTotal > 0;

  const depth = depthLabel ?? "normal";
  const energy = energyLabel ?? "medium";

  const visibleTags = tags?.slice(0, 3) ?? [];
  const extraTagCount = (tags?.length ?? 0) - visibleTags.length;

  return (
    <div
      className={cn(
        "group relative rounded-md border border-white/5 bg-background/90 shadow-sm transition-all duration-200",
        "hover:border-white/15 hover:shadow-md hover:-translate-y-0.5 hover:shadow-black/20",
        compact ? "px-2 py-1.5" : "px-3 py-2.5",
        overdue && "border-red-500/35 ring-1 ring-red-500/15",
        className
      )}
    >
      {/* Priority dot — top-right */}
      <span
        className={cn(
          "absolute top-1.5 right-1.5 h-2 w-2 rounded-full",
          priority === "urgent" && "bg-red-500",
          priority === "high" && "bg-orange-500",
          priority === "normal" && "bg-zinc-400",
          priority === "low" && "bg-zinc-600"
        )}
        title={`${priority} priority`}
      />
      <div className="flex items-start gap-2">
        {areaColor && (
          <span
            className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: areaColor }}
            title={areaName}
          />
        )}
        <div className="mt-1 flex shrink-0 flex-col items-center gap-0.5">
          <StatusDot status={status} onClick={onStatusCycle} />
          {showStatusAdvance && onStatusCycle && (
            <button
              type="button"
              className="rounded p-0.5 text-muted hover:bg-white/10 hover:text-foreground"
              title="Next status"
              aria-label="Cycle status"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onStatusCycle();
                import("sonner").then(({ toast }) => {
                   toast.success("Status updated", { id: "status-cycle" });
                });
              }}
            >
              <ChevronRight size={12} />
            </button>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn(
            "text-foreground leading-snug",
            compact ? "text-xs" : "text-sm",
            status === "done" && "line-through opacity-60"
          )}>
            {title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {overdue && (
              <span className="rounded-full bg-red-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-200">
                Overdue
              </span>
            )}
            {boardStatuses && onBoardStatusSelect && (
              <select
                value={status}
                title="Status"
                aria-label="Change status"
                className="max-w-[104px] shrink-0 rounded border border-white/10 bg-background/80 px-1 py-0.5 text-[9px] capitalize text-foreground"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => onBoardStatusSelect(e.target.value)}
              >
                {boardStatuses.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </select>
            )}
            <div className="relative" ref={priRef}>
              {onPriorityChange ? (
                <>
                  <button
                    type="button"
                    className={cn(
                      "inline-block rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider hover:ring-1 hover:ring-white/20",
                      PRIORITY_COLORS[priority] ?? PRIORITY_COLORS.normal
                    )}
                    onClick={openPriorityDropdown}
                  >
                    {priority} ▾
                  </button>
                  {priOpen && createPortal(
                    <div 
                      className="absolute z-[9999] mt-1 min-w-[120px] rounded-lg border border-white/10 bg-surface py-1 shadow-xl"
                      style={{ top: dropdownPos.top, left: dropdownPos.left }}
                      ref={priRef}
                    >
                      {PRIORITY_OPTIONS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          className="block w-full px-3 py-1.5 text-left text-xs capitalize hover:bg-white/10 text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            onPriorityChange(p);
                            setPriOpen(false);
                          }}
                        >
                          {p}
                        </button>
                      ))}
                    </div>,
                    document.body
                  )}
                </>
              ) : (
                <span
                  className={cn(
                    "inline-block rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider",
                    PRIORITY_COLORS[priority] ?? PRIORITY_COLORS.normal
                  )}
                >
                  {priority}
                </span>
              )}
            </div>
            <span 
              className="text-[10px] text-muted cursor-help border-b border-dashed border-white/20 hover:border-white/50 hover:bg-white/5 transition-colors px-0.5 rounded" 
              title="Work depth (focus load). Click in Table view to edit."
            >
              D:{depth}
            </span>
            <span 
              className="text-[10px] text-muted cursor-help border-b border-dashed border-white/20 hover:border-white/50 hover:bg-white/5 transition-colors px-0.5 rounded" 
              title="Physical energy. Click in Table view to edit."
            >
              E:{energy}
            </span>
            {dueDate && (
              <span className="text-[10px] text-muted tooltip-hover" title="Due Date">Due: {dueDate}</span>
            )}
          </div>
          {hasSubtasks && (
            <div className="mt-1.5">
              <SubtaskBar done={subtasksDone ?? 0} total={subtasksTotal} />
            </div>
          )}
          {visibleTags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {visibleTags.map((tag) => (
                <TagChip key={tag.id} name={tag.name} color={tag.color} size="xs" />
              ))}
              {extraTagCount > 0 && (
                <span className="text-[8px] text-muted">+{extraTagCount}</span>
              )}
            </div>
          )}
        </div>
        {taskId && (
          <div className="ml-1 mt-0.5 shrink-0">
            <TimerButton taskId={taskId} compact={compact} />
          </div>
        )}
      </div>
    </div>
  );
});
