import { KanbanBoard } from "@/components/kanban-board";
import { PlanHeader } from "@/components/plan-header";
import { HelpCircle } from "lucide-react";

export default function BoardPage() {
  return (
    <div className="mx-auto flex max-w-[1160px] flex-col gap-6 pb-10">
      <PlanHeader activeView="board" />
      <div className="-mt-3 flex justify-end">
        <span
          className="cursor-help rounded-full border border-[var(--hairline)] p-1 text-muted transition-colors hover:bg-[var(--teal-a08)] hover:text-[var(--teal)]"
          title="Ctrl/Cmd+K command palette · Ctrl/Cmd+Shift+D brain dump"
        >
          <HelpCircle size={14} />
        </span>
      </div>
      <KanbanBoard />
    </div>
  );
}
