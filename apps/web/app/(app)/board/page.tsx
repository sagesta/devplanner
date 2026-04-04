import { KanbanBoard } from "@/components/kanban-board";

export default function BoardPage() {
  return (
    <div>
      <h1 className="font-display text-2xl text-foreground">Sprint board</h1>
      <p className="mt-1 text-sm text-muted">Drag cards between columns. ⌘K command palette · ⌘⇧D brain dump.</p>
      <div className="mt-6">
        <KanbanBoard />
      </div>
    </div>
  );
}
