"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox as InboxIcon, Trash2, ArrowRight, CheckCircle2 } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import {
  deleteTask,
  fetchAreas,
  fetchInboxArea,
  fetchTasks,
  patchTask,
  type AreaRow,
  type TaskRow,
} from "@/lib/api";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { SkeletonListItem } from "@/lib/skeleton";

export default function InboxPage() {
  const userId = useAppUserId();
  const qc = useQueryClient();

  const inboxAreaQ = useQuery({
    queryKey: ["inbox-area", userId],
    queryFn: fetchInboxArea,
    enabled: Boolean(userId),
    staleTime: Infinity,
  });

  const areasQ = useQuery({
    queryKey: ["areas", userId],
    queryFn: fetchAreas,
    enabled: Boolean(userId),
  });

  const tasksQ = useQuery({
    queryKey: ["tasks", userId],
    queryFn: () => fetchTasks(),
    enabled: Boolean(userId),
  });

  const inboxArea = inboxAreaQ.data;
  const otherAreas = useMemo(
    () => (areasQ.data ?? []).filter((a) => !a.isInbox),
    [areasQ.data]
  );

  const inboxTasks = useMemo(() => {
    if (!inboxArea || !tasksQ.data) return [] as TaskRow[];
    return tasksQ.data.filter((t) => t.areaId === inboxArea.id);
  }, [inboxArea, tasksQ.data]);

  const moveMutation = useMutation({
    mutationFn: ({ taskId, areaId }: { taskId: string; areaId: string }) =>
      patchTask(taskId, { areaId, status: "todo" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Moved");
    },
  });

  const doneMutation = useMutation({
    mutationFn: (taskId: string) => patchTask(taskId, { status: "done" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => deleteTask(taskId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
          <InboxIcon size={18} className="text-muted" />
          Inbox
        </h1>
        <p className="text-sm text-muted">
          Triage what you captured. Move things to an area, mark them done, or delete.
          Use{" "}
          <kbd className="rounded border border-white/10 bg-white/5 px-1 font-mono text-[10px]">
            Ctrl
          </kbd>{" "}
          <kbd className="rounded border border-white/10 bg-white/5 px-1 font-mono text-[10px]">
            Space
          </kbd>{" "}
          anywhere to capture more.
        </p>
      </header>

      {tasksQ.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonListItem key={i} />
          ))}
        </div>
      ) : inboxTasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-surface/50 p-10 text-center">
          <InboxIcon size={28} className="mx-auto mb-3 text-muted/60" />
          <p className="text-sm text-foreground">Inbox is clear.</p>
          <p className="mt-1 text-xs text-muted">
            Hit{" "}
            <kbd className="rounded border border-white/10 bg-white/5 px-1 font-mono text-[10px]">
              Ctrl
            </kbd>{" "}
            <kbd className="rounded border border-white/10 bg-white/5 px-1 font-mono text-[10px]">
              Space
            </kbd>{" "}
            to capture a thought.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {inboxTasks.map((t) => (
            <InboxRow
              key={t.id}
              task={t}
              areas={otherAreas}
              onMove={(areaId) => moveMutation.mutate({ taskId: t.id, areaId })}
              onDone={() => doneMutation.mutate(t.id)}
              onDelete={() => deleteMutation.mutate(t.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function InboxRow({
  task,
  areas,
  onMove,
  onDone,
  onDelete,
}: {
  task: TaskRow;
  areas: AreaRow[];
  onMove: (areaId: string) => void;
  onDone: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="group flex items-center gap-2 rounded-lg border border-white/5 bg-surface/60 px-3 py-2 transition-colors hover:bg-surface">
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{task.title}</span>
      <select
        className="rounded-md border border-white/10 bg-transparent px-1.5 py-1 text-xs text-muted hover:text-foreground"
        defaultValue=""
        onChange={(e) => {
          const v = e.target.value;
          if (v) onMove(v);
          e.target.selectedIndex = 0;
        }}
        aria-label="Move to area"
      >
        <option value="" disabled>
          Move to…
        </option>
        {areas.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="rounded p-1 text-muted hover:bg-white/5 hover:text-foreground transition-colors"
        title="Mark done"
        onClick={onDone}
      >
        <CheckCircle2 size={14} />
      </button>
      <button
        type="button"
        className="rounded p-1 text-muted hover:bg-red-500/15 hover:text-red-300 transition-colors"
        title="Delete"
        onClick={onDelete}
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}
