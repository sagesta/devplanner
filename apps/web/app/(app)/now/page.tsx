"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { fetchToday, getDevUserId, patchTask, type TaskRow } from "@/lib/api";
import { SkeletonListItem } from "@/lib/skeleton";
import { cn } from "@/lib/utils";

export default function NowPage() {
  const userId = getDevUserId();
  const qc = useQueryClient();
  const [doneId, setDoneId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["tasks-today", userId],
    queryFn: () => fetchToday(userId),
    enabled: Boolean(userId),
  });

  const doneMut = useMutation({
    mutationFn: async (taskId: string) => {
      setDoneId(taskId);
      await patchTask(taskId, { status: "done" });
    },
    onSuccess: () => {
      // Wait for flash animation to finish
      setTimeout(() => {
        setDoneId(null);
        void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
        toast.success("Done! ✓");
      }, 400);
    },
    onError: (e: Error) => {
      setDoneId(null);
      toast.error(e.message);
    },
  });

  if (!userId) {
    return <p className="text-muted">Set NEXT_PUBLIC_DEV_USER_ID</p>;
  }

  const tasks = q.data?.tasks ?? [];
  const totalMinutes = tasks.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-foreground">Now</h1>
          <p className="mt-1 text-sm text-muted">
            {q.data?.date ?? "…"}
            {tasks.length > 0 && (
              <span className="ml-2">
                · {tasks.length} task{tasks.length !== 1 ? "s" : ""}
                {totalMinutes > 0 && ` · ~${Math.round(totalMinutes / 60 * 10) / 10}h`}
              </span>
            )}
          </p>
        </div>
      </div>

      {q.isLoading && (
        <div className="mt-4 space-y-2">
          <SkeletonListItem />
          <SkeletonListItem />
          <SkeletonListItem />
        </div>
      )}

      {q.isError && <p className="mt-4 text-red-300">{(q.error as Error).message}</p>}

      <ul className="mt-4 space-y-2 stagger-list">
        {tasks.map((t) => {
          const timeBlock =
            t.scheduledStartTime && t.scheduledEndTime
              ? `${t.scheduledStartTime.slice(0, 5)}–${t.scheduledEndTime.slice(0, 5)}`
              : null;

          return (
            <li
              key={t.id}
              className={cn(
                "flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-surface px-4 py-3 transition-all",
                "hover:border-white/15 hover:shadow-md",
                doneId === t.id && "animate-done-flash",
                t.status === "done" && "opacity-50"
              )}
            >
              <div className="min-w-0 flex-1">
                <span className="text-foreground">{t.title}</span>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                  {timeBlock && (
                    <span className="flex items-center gap-1 font-mono">
                      <Clock size={10} />
                      {timeBlock}
                    </span>
                  )}
                  {t.estimatedMinutes && (
                    <span>{t.estimatedMinutes}min</span>
                  )}
                  <span className="capitalize">{t.energyLevel.replace("_", " ")}</span>
                </div>
              </div>
              <button
                type="button"
                disabled={doneMut.isPending}
                className="shrink-0 rounded-lg bg-success/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-success transition-colors disabled:opacity-50"
                onClick={() => doneMut.mutate(t.id)}
              >
                ✓ Done
              </button>
            </li>
          );
        })}
      </ul>

      {!q.isLoading && tasks.length === 0 && (
        <div className="mt-12 flex flex-col items-center text-center">
          <Sparkles size={32} className="text-primary/40 mb-3" />
          <p className="text-muted text-sm">Nothing scheduled for today.</p>
          <p className="text-muted/60 text-xs mt-1">
            Use Brain Dump (⌘⇧D) to capture tasks, or schedule them from the Board.
          </p>
        </div>
      )}
    </div>
  );
}
