"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSprints, type SprintRow } from "@/lib/api";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { cn } from "@/lib/utils";

export type PlanViewKey = "sprints" | "board" | "timeline" | "table" | "goals";

/**
 * View pills for the Planning room. "Goals" points at the top-level Goals
 * room (the matrix also stays reachable at /plan?view=goals for old links).
 */
const VIEW_PILLS: Array<{ key: PlanViewKey; label: string; href: string }> = [
  { key: "sprints", label: "Sprint", href: "/plan?view=sprints" },
  { key: "board", label: "Board", href: "/plan?view=board" },
  { key: "timeline", label: "Timeline", href: "/plan?view=timeline" },
  { key: "table", label: "Table", href: "/plan?view=table" },
  { key: "goals", label: "Goals", href: "/goals" },
];

/** Parse YYYY-MM-DD as a LOCAL date (avoid UTC day-shift). */
function localDate(ymd: string): Date | null {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function sprintWeekLine(sprint: SprintRow): string | null {
  const start = localDate(sprint.startDate);
  const end = localDate(sprint.endDate);
  if (!start || !end) return null;
  const weekOf = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const durationDays = Math.round((end.getTime() - start.getTime()) / 86400000);
  // Week-length sprints read "ends Friday"; longer ones get an explicit date.
  const ends =
    durationDays <= 8
      ? end.toLocaleDateString("en-US", { weekday: "long" })
      : end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `Week of ${weekOf} · ends ${ends}`;
}

/** Editorial daybook header + view switcher shared by the Plan room routes. */
export function PlanHeader({ activeView }: { activeView: PlanViewKey }) {
  const userId = useAppUserId();
  const sprintsQ = useQuery({
    queryKey: ["sprints", userId],
    queryFn: () => fetchSprints(),
    enabled: Boolean(userId),
  });

  const activeSprint = useMemo(
    () => sprintsQ.data?.sprints.find((s) => s.status === "active") ?? null,
    [sprintsQ.data?.sprints]
  );
  const weekLine = activeSprint ? sprintWeekLine(activeSprint) : null;

  return (
    <>
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--teal)]">
          Planning room
        </p>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className="mt-1.5 font-display text-[32px] leading-[1.05] text-[var(--ink)] md:text-[52px]">
            One sprint, honestly scoped.
          </h1>
          {weekLine && <p className="shrink-0 text-sm text-muted">{weekLine}</p>}
        </div>
        {activeSprint?.goal && (
          <p className="mt-2.5 text-sm text-muted">
            Sprint goal: <span className="font-medium text-[var(--ink)]">{activeSprint.goal}</span>
            {typeof activeSprint.taskCount === "number" && activeSprint.taskCount > 0 && (
              <>
                {" "}
                · {activeSprint.taskCount} task{activeSprint.taskCount === 1 ? "" : "s"} in scope
              </>
            )}
          </p>
        )}
      </header>

      <nav
        className="flex flex-wrap gap-1.5 border-b border-[var(--hairline-soft)] pb-4"
        aria-label="Plan views"
      >
        {VIEW_PILLS.map(({ key, label, href }) => {
          const selected = key === activeView;
          return (
            <Link
              key={key}
              href={href}
              aria-current={selected ? "page" : undefined}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                selected
                  ? "border border-transparent bg-[var(--ink-btn-bg)] text-[var(--ink-btn-fg)]"
                  : "border border-[var(--hairline)] text-muted hover:bg-[var(--teal-a08)] hover:text-[var(--teal)]"
              )}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
