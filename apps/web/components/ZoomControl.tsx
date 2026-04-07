"use client";

import { cn } from "@/lib/utils";

const ZOOM_LEVELS = [
  { label: "Day (7d)", key: "day" },
  { label: "Week (14d)", key: "week" },
  { label: "3-Week", key: "3-week" },
  { label: "Month", key: "month" },
] as const;

export type ZoomLevel = (typeof ZOOM_LEVELS)[number]["key"];

/**
 * ZoomControl — segmented pill control for timeline zoom levels.
 */
export function ZoomControl({
  value,
  onChange,
  className,
}: {
  value: ZoomLevel;
  onChange: (level: ZoomLevel) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex rounded-full border border-border bg-muted p-0.5 gap-0.5",
        className
      )}
    >
      {ZOOM_LEVELS.map((z) => (
        <button
          key={z.key}
          type="button"
          className={cn(
            "px-3 py-1 text-xs font-medium rounded-full transition-colors",
            value === z.key
              ? "bg-primary text-white"
              : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => onChange(z.key)}
        >
          {z.label}
        </button>
      ))}
    </div>
  );
}

/** Map zoom level key to number of days for timeline rendering. */
export function zoomToDays(level: ZoomLevel): number {
  if (level === "day") return 7;
  if (level === "week") return 14;
  if (level === "3-week") return 21;
  if (level === "month") return 30;
  return 21;
}
