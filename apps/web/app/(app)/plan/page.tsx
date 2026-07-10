"use client";

import { useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { KanbanBoard } from "@/components/kanban-board";
import { GoalHorizonsMatrix } from "@/components/goal-horizons-matrix";
import { TimelineBoard } from "@/components/timeline-board";
import { PlanHeader, type PlanViewKey } from "@/components/plan-header";
import SprintsPage from "../sprints/page";
import TablePage from "../table/page";

function displayNameFromSession(name?: string | null, email?: string | null) {
  if (name?.trim()) return name.trim();
  if (email?.trim()) return email.split("@")[0];
  return "Me";
}

function normalizePlanView(value: string | null): PlanViewKey {
  if (value === "board" || value === "timeline" || value === "table" || value === "sprints" || value === "goals") {
    return value;
  }
  return "sprints";
}

export default function PlanPage() {
  const searchParams = useSearchParams();
  const activeView = normalizePlanView(searchParams.get("view"));
  const { user } = useUser();
  const ownerName = displayNameFromSession(user?.fullName, user?.primaryEmailAddress?.emailAddress);

  return (
    <div className="mx-auto flex max-w-[1160px] flex-col gap-6 pb-10">
      <PlanHeader activeView={activeView} />

      <section aria-label="Plan view content">
        {activeView === "sprints" && <SprintsPage />}
        {activeView === "board" && <KanbanBoard />}
        {activeView === "timeline" && (
          <div>
            <p className="text-sm text-muted">
              Three-week horizon. Drag bars to reschedule; drop unscheduled tasks on a date.
            </p>
            <div className="mt-5">
              <TimelineBoard />
            </div>
          </div>
        )}
        {activeView === "table" && <TablePage />}
        {/* Old /plan?view=goals links keep working; the pill itself points at /goals. */}
        {activeView === "goals" && <GoalHorizonsMatrix ownerName={ownerName} />}
      </section>
    </div>
  );
}
