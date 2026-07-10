import React from "react";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";

export function DroppableColumn({
  id,
  title,
  count,
  children,
  onAdd,
  showColumnEmpty,
  className,
}: {
  id: string;
  title: string;
  count: number;
  children: React.ReactNode;
  onAdd: () => void;
  showColumnEmpty?: boolean;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex min-h-[260px] flex-col rounded-xl p-2 -m-2 transition-colors duration-200",
        isOver && "bg-[var(--teal-a08)] ring-1 ring-[var(--teal-a30)]",
        className
      )}
    >
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="font-display text-[19px] font-normal italic text-[var(--ink)]">{title}</h2>
        <span className="text-xs text-[var(--muted-soft)]">{count}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 stagger-list">
        {children}
        {showColumnEmpty && (
          <p className="rounded-xl border border-dashed border-[var(--hairline)] px-4 py-6 text-center text-xs text-[var(--muted-soft)]">
            Nothing here yet — add a task or drop a card from another column.
          </p>
        )}
        <button
          type="button"
          className="rounded-xl border border-dashed border-[var(--rule)] bg-transparent p-2.5 text-[13px] text-muted transition-colors hover:border-[var(--teal)] hover:text-[var(--teal)]"
          onClick={onAdd}
        >
          + Add task
        </button>
      </div>
    </section>
  );
}
