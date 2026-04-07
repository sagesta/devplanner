"use client";

import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { useMemo } from "react";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { formatDuration } from "@/hooks/use-active-timer";
import { fetchWeekSummary, type TimeLogSummaryRow } from "@/lib/api";
import { cn } from "@/lib/utils";

type AreaSummary = {
  areaId: string | null;
  areaName: string | null;
  weeklyHourTarget: number | null;
  totalSeconds: number;
};

/**
 * TimeWeekPanel — weekly time summary grouped by area,
 * with progress bars for areas that have a weekly hour target.
 */
export function TimeWeekPanel({
  weekStart,
  className,
}: {
  weekStart: string;
  className?: string;
}) {
  const userId = useAppUserId();

  const q = useQuery({
    queryKey: ["time-logs", "week-summary", weekStart, userId],
    queryFn: () => fetchWeekSummary(weekStart),
    enabled: Boolean(userId) && Boolean(weekStart),
  });

  const areaSummaries = useMemo(() => {
    if (!q.data) return [];
    const map = new Map<string, AreaSummary>();
    for (const row of q.data) {
      const key = row.areaId ?? "__none";
      const existing = map.get(key);
      if (existing) {
        existing.totalSeconds += row.totalSeconds;
      } else {
        map.set(key, {
          areaId: row.areaId,
          areaName: row.areaName,
          weeklyHourTarget: row.weeklyHourTarget ? Number(row.weeklyHourTarget) : null,
          totalSeconds: row.totalSeconds,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalSeconds - a.totalSeconds);
  }, [q.data]);

  const grandTotalSeconds = areaSummaries.reduce((sum, a) => sum + a.totalSeconds, 0);

  return (
    <div className={cn("rounded-xl border border-white/10 bg-surface p-4", className)}>
      <div className="flex items-center gap-2 mb-3">
        <Clock size={14} className="text-primary" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Time this week
        </h3>
        <span className="ml-auto text-sm font-mono font-semibold text-foreground tabular-nums">
          {formatDuration(grandTotalSeconds)}
        </span>
      </div>

      {q.isLoading && (
        <div className="space-y-2">
          <div className="animate-shimmer h-6 rounded" />
          <div className="animate-shimmer h-6 rounded" />
        </div>
      )}

      {!q.isLoading && areaSummaries.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-surface/50 py-10 text-center">
          <Clock size={28} className="mb-3 text-primary/30" />
          <p className="text-sm font-medium text-foreground">No time logged</p>
          <p className="mt-1 text-xs text-muted/80 max-w-[200px]">
            Start a timer on any task to begin tracking your effort.
          </p>
        </div>
      )}

      {areaSummaries.length > 0 && (
        <div className="space-y-3">
          {areaSummaries.map((area) => {
            const targetSeconds = area.weeklyHourTarget
              ? area.weeklyHourTarget * 3600
              : null;
            const pct = targetSeconds
              ? Math.min(100, (area.totalSeconds / targetSeconds) * 100)
              : null;

            return (
              <div key={area.areaId ?? "__none"} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-foreground font-medium">
                    {area.areaName ?? "Unassigned"}
                  </span>
                  <span className="font-mono text-muted tabular-nums">
                    {formatDuration(area.totalSeconds)}
                    {targetSeconds && (
                      <span className="text-muted/60">
                        {" "}/ {area.weeklyHourTarget}h
                      </span>
                    )}
                  </span>
                </div>
                {pct !== null && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        pct >= 100 ? "bg-emerald-500" : pct >= 75 ? "bg-primary" : "bg-primary/60"
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
