"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { patchTask, deleteTask, restoreTask, type TaskRow } from "@/lib/api";
import { cn, displayPhysicalEnergy, displayWorkDepth, isTaskOverdue } from "@/lib/utils";
import { StatusDot } from "@/components/task-card";
import { TagChip } from "@/components/TagChip";
import { TimerButton } from "@/components/TimerButton";
import { TaskDetailPanel } from "@/components/TaskDetailPanel";
import { normalizeYmd } from "@/lib/timeline-utils";

const STATUS_CYCLE: Record<string, string> = {
  backlog: "todo",
  todo: "in_progress",
  in_progress: "done",
  done: "backlog",
};

const COGNITIVE_LABEL: Record<string, string> = {
  deep_work: "Deep work",
  shallow: "Low focus",
  admin: "Routine",
  quick_win: "Quick win",
};

function cognitiveDisplay(v: string): string {
  return COGNITIVE_LABEL[v] ?? v.replace(/_/g, " ");
}

export function TaskTableRow({
  task,
  index,
  userId,
  todayYmd,
  selected,
  onSelectToggle,
}: {
  task: TaskRow;
  index: number;
  userId: string;
  todayYmd: string;
  selected: boolean;
  onSelectToggle: (checked: boolean) => void;
}) {
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [confirmIndDelete, setConfirmIndDelete] = useState(false);
  const qc = useQueryClient();

  const statusMut = useMutation({
    mutationFn: ({ status }: { status: string }) => patchTask(task.id, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      void qc.invalidateQueries({ queryKey: ["tasks-today"] });
      toast.success(`“${task.title}” deleted`, {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: () => {
            void restoreTask(task.id)
              .then(() => {
                toast.success("Task restored");
                void qc.invalidateQueries({ queryKey: ["tasks", userId] });
                void qc.invalidateQueries({ queryKey: ["tasks-today"] });
              })
              .catch((err: unknown) => toast.error(String(err)));
          },
        },
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA" || document.activeElement?.tagName === "SELECT") {
        return;
      }
      if (e.key === "Escape" && isDetailOpen) {
        setIsDetailOpen(false);
      }
      // If we implemented an explicit focus state for the row, we could open on Enter
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [isDetailOpen]);

  return (
    <>
      <tr
        className={cn(
          "border-b border-white/5 transition-colors hover:bg-white/[0.03] cursor-pointer group",
          index % 2 === 1 && "bg-white/[0.01]"
        )}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest(".action-button")) {
            setIsDetailOpen(true);
          }
        }}
      >
        <td className="p-2">
          <input
            type="checkbox"
            className="rounded action-button cursor-pointer"
            checked={selected}
            onChange={(e) => onSelectToggle(e.target.checked)}
          />
        </td>
        <td className="p-2 action-button">
          <StatusDot
            status={task.status}
            onClick={() => {
              const next = STATUS_CYCLE[task.status] ?? "todo";
              statusMut.mutate({ status: next });
            }}
          />
        </td>
        <td className="p-2 text-foreground">
          <div className="flex flex-wrap items-center gap-1.5">
            {isTaskOverdue(task, todayYmd) && (
              <span className="rounded-full bg-red-500/20 px-1.5 py-0.5 text-[8px] font-semibold uppercase text-red-200">
                Overdue
              </span>
            )}
            <span className={cn(task.status === "done" && "line-through opacity-60")}>
              {task.title}
            </span>
          </div>
        </td>
        <td className="p-2 text-xs capitalize text-muted">
          {task.status.replace("_", " ")}
        </td>
        <td className="p-2 text-xs capitalize text-muted">
          {task.priority}
        </td>
        <td className="p-2 text-xs text-muted">
          {displayPhysicalEnergy(task)}
        </td>
        <td className="p-2 text-xs text-muted capitalize">
          {displayWorkDepth(task)}
        </td>
        <td className="p-2 text-xs text-muted">
          {cognitiveDisplay(task.energyLevel)}
        </td>
        <td className="p-2 text-xs text-muted">
          {normalizeYmd(task.dueDate) ?? "—"}
        </td>
        <td className="p-2 text-xs text-muted">
          {(task._subtasks ?? [])
            .map((s) => s.scheduledDate)
            .filter((d): d is string => Boolean(d))
            .sort()[0] ?? "—"}
        </td>
        <td className="p-2">
          <div className="flex flex-wrap gap-1">
            {(task._tags ?? []).slice(0, 3).map((tag) => (
              <TagChip key={tag.id} name={tag.name} color={tag.color} size="xs" />
            ))}
          </div>
        </td>
        <td className="p-2 action-button">
          <TimerButton taskId={task.id} compact />
        </td>
        <td className="p-2 text-right action-button">
          <button
            type="button"
            className={cn("rounded p-1 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity", confirmIndDelete ? "text-red-500 bg-red-500/10" : "text-muted hover:bg-red-500/15 hover:text-red-300")}
            title={confirmIndDelete ? "Are you sure?" : "Delete task"}
            disabled={del.isPending}
            onClick={() => {
              if (!confirmIndDelete) {
                setConfirmIndDelete(true);
                setTimeout(() => setConfirmIndDelete(false), 3000);
                return;
              }
              setConfirmIndDelete(false);
              del.mutate();
            }}
          >
            <Trash2 size={14} />
          </button>
        </td>
      </tr>

      <TaskDetailPanel
        taskId={task.id}
        userId={userId}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
      />
    </>
  );
}
