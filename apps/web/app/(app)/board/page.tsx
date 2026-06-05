import { KanbanBoard } from "@/components/kanban-board";
import { HelpCircle } from "lucide-react";

export default function BoardPage() {
  return (
    <div>
      <div className="flex items-center gap-2">
        <h1 className="font-display text-2xl text-foreground">Sprint board</h1>
        <span
          className="rounded-full border border-white/10 p-1 text-muted hover:bg-white/5 hover:text-foreground transition-colors cursor-help"
          title="Ctrl/Cmd+K command palette · Ctrl/Cmd+Shift+D brain dump"
        >
          <HelpCircle size={14} />
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">Visualize sprint progress. Drag cards between columns to update status.</p>
      <div className="mt-6">
        <KanbanBoard />
      </div>
    </div>
  );
}
