"use client";

import { CalendarCheck, ChartGantt, KanbanSquare, LayoutList, Target } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { KanbanBoard } from "@/components/kanban-board";
import { GoalHorizonsMatrix } from "@/components/goal-horizons-matrix";
import { TimelineBoard } from "@/components/timeline-board";
import { cn } from "@/lib/utils";
import SprintsPage from "../sprints/page";
import TablePage from "../table/page";

function displayNameFromSession(name?: string | null, email?: string | null) {
  if (name?.trim()) return name.trim();
  if (email?.trim()) return email.split("@")[0];
  return "Me";
}

const PLAN_VIEWS = [
  {
    key: "sprints",
    label: "Sprint",
    href: "/plan?view=sprints",
    Icon: CalendarCheck,
    description: "Create the weekly container, set the goal, and choose what belongs in scope.",
  },
  {
    key: "board",
    label: "Board",
    href: "/plan?view=board",
    Icon: KanbanSquare,
    description: "Move active sprint tasks through Todo, In progress, and Done.",
  },
  {
    key: "timeline",
    label: "Timeline",
    href: "/plan?view=timeline",
    Icon: ChartGantt,
    description: "Repair dates across a three-week horizon when reality shifts.",
  },
  {
    key: "table",
    label: "Table",
    href: "/plan?view=table",
    Icon: LayoutList,
    description: "Sort, select, and bulk-clean task metadata.",
  },
  {
    key: "goals",
    label: "Goals",
    href: "/plan?view=goals",
    Icon: Target,
    description: "Keep the big picture visible across short, mid, and long-term horizons.",
  },
] as const;

type PlanView = (typeof PLAN_VIEWS)[number]["key"];

function normalizePlanView(value: string | null): PlanView {
  if (value === "board" || value === "timeline" || value === "table" || value === "sprints" || value === "goals") {
    return value;
  }
  return "sprints";
}

export default function PlanPage() {
  const searchParams = useSearchParams();
  const activeView = normalizePlanView(searchParams.get("view"));
  const active = PLAN_VIEWS.find((view) => view.key === activeView) ?? PLAN_VIEWS[0];
  const { user } = useUser();
  const ownerName = displayNameFromSession(user?.fullName, user?.primaryEmailAddress?.emailAddress);

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-5 pb-10">
      <header className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Planning room</p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">Plan</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Sprint commitment, status movement, schedule repair, bulk cleanup, and long-term direction — all in one place.
          </p>
        </div>
      </header>

      <nav className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" aria-label="Plan views">
        {PLAN_VIEWS.map(({ key, href, label, Icon, description }) => {
          const selected = key === activeView;
          return (
            <Link
              key={key}
              href={href}
              className={cn(
                "rounded-lg border px-3 py-3 transition-colors",
                selected
                  ? "border-primary/50 bg-primary/10 text-foreground"
                  : "border-white/10 bg-surface text-muted hover:bg-white/5 hover:text-foreground"
              )}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Icon size={15} className={selected ? "text-primary-text" : "text-muted"} />
                {label}
              </span>
              <span className="mt-1 block text-xs leading-snug text-muted">{description}</span>
            </Link>
          );
        })}
      </nav>

      <section className="rounded-lg border border-white/10 bg-background/20 p-4">
        {active.key === "sprints" && <SprintsPage />}
        {active.key === "board" && (
          <div>
            <h2 className="font-display text-2xl text-foreground">Sprint board</h2>
            <p className="mt-1 text-sm text-muted">
              Drag cards between columns to update status. Use this as a planning/status view; execute from Today.
            </p>
            <div className="mt-6">
              <KanbanBoard />
            </div>
          </div>
        )}
        {active.key === "timeline" && (
          <div>
            <h2 className="font-display text-2xl text-foreground">Timeline</h2>
            <p className="mt-1 text-sm text-muted">
              Three-week horizon. Drag bars to reschedule; drop unscheduled tasks on a date.
            </p>
            <div className="mt-6">
              <TimelineBoard />
            </div>
          </div>
        )}
        {active.key === "table" && <TablePage />}
        {active.key === "goals" && <GoalHorizonsMatrix ownerName={ownerName} />}
      </section>
    </div>
  );
}
