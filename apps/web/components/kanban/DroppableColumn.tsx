import React from "react";
import { useDroppable } from "@dnd-kit/core";
import { Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function DroppableColumn({
  id,
  title,
  count,
  children,
  onAdd,
  showColumnEmpty,
}: {
  id: string;
  title: string;
  count: number;
  children: React.ReactNode;
  onAdd: () => void;
  showColumnEmpty?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      className={cn(
        "min-h-[260px] rounded-xl border border-white/10 bg-surface p-3 transition-all duration-200",
        isOver && "ring-2 ring-primary/50 border-primary/30 bg-surface/80"
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
          <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-white/5 px-1 text-[10px] text-muted">
            {count}
          </span>
        </div>
        <button
          type="button"
          className="rounded p-0.5 text-muted hover:bg-white/10 hover:text-foreground transition-colors"
          onClick={onAdd}
          title="Add task"
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="flex min-h-[200px] flex-col">
        <div className="flex-1 space-y-2 stagger-list">{children}</div>
        {showColumnEmpty && (
          <div className="mt-2 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-white/12 bg-white/[0.02] px-4 py-10 text-center">
            <Sparkles size={24} className="mb-3 text-primary/30" />
            <p className="text-[11px] text-muted">No tasks here yet</p>
            <button
              type="button"
              className="mt-3 text-xs font-medium text-primary hover:underline hover:text-primary-hover"
              onClick={onAdd}
            >
              + Add task
            </button>
            <p className="mt-2 text-[10px] text-muted/50">Or drop a card from another column</p>
          </div>
        )}
      </div>
    </section>
  );
}
