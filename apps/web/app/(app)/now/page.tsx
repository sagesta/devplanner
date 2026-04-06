"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Clock, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { fetchToday, patchTask } from "@/lib/api";
import { LS_PHYSICAL_ENERGY, type PhysicalEnergyLevel } from "@/lib/planner-prefs";
import { SkeletonListItem } from "@/lib/skeleton";
import { cn, displayPhysicalEnergy, isTaskOverdue } from "@/lib/utils";

function localISODate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function NowPage() {
  const { status } = useSession();
  const userId = useAppUserId();
  const qc = useQueryClient();
  const [doneId, setDoneId] = useState<string | null>(null);
  const [energyFilter, setEnergyFilter] = useState<PhysicalEnergyLevel | "">("");
  const todayLocal = useMemo(() => localISODate(), []);

  useEffect(() => {
    const v = localStorage.getItem(LS_PHYSICAL_ENERGY);
    if (v === "low" || v === "medium" || v === "high") setEnergyFilter(v);
  }, []);

  const q = useQuery({
    queryKey: ["tasks-today", userId, todayLocal],
    queryFn: () => fetchToday(todayLocal),
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

  const tasks = useMemo(() => {
    const raw = q.data?.tasks ?? [];
    let list = [...raw];
    if (energyFilter) {
      list = list.filter((t) => displayPhysicalEnergy(t) === energyFilter);
    }
    list.sort((a, b) => {
      const ta = a.scheduledStartTime ?? "";
      const tb = b.scheduledStartTime ?? "";
      if (ta && tb) return ta.localeCompare(tb);
      if (ta) return -1;
      if (tb) return 1;
      return a.title.localeCompare(b.title);
    });
    return list;
  }, [q.data?.tasks, energyFilter]);

  if (status === "loading") {
    return (
      <div className="space-y-2">
        <SkeletonListItem />
        <SkeletonListItem />
      </div>
    );
  }
  if (!userId) return null;

  function persistEnergy(next: PhysicalEnergyLevel | "") {
    setEnergyFilter(next);
    if (typeof window === "undefined") return;
    if (next) localStorage.setItem(LS_PHYSICAL_ENERGY, next);
    else localStorage.removeItem(LS_PHYSICAL_ENERGY);
  }

  const totalMinutes = tasks.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl text-foreground">Now</h1>
          <p className="mt-1 text-sm text-muted">
            <time dateTime={todayLocal}>
              {new Date(todayLocal + "T12:00:00").toLocaleDateString(undefined, {
                weekday: "long",
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </time>
            {tasks.length > 0 && (
              <span className="ml-2">
                · {tasks.length} task{tasks.length !== 1 ? "s" : ""}
                {totalMinutes > 0 && ` · ~${Math.round(totalMinutes / 60 * 10) / 10}h`}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium uppercase tracking-wide text-muted">
            Match my energy
          </label>
          <select
            className="rounded-lg border border-white/10 bg-surface px-2 py-1.5 text-xs text-foreground"
            value={energyFilter}
            onChange={(e) =>
              persistEnergy(
                e.target.value === "" ? "" : (e.target.value as PhysicalEnergyLevel)
              )
            }
          >
            <option value="">All tasks</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
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
                t.status === "done" && "opacity-50",
                isTaskOverdue(t, todayLocal) && "border-red-500/30 ring-1 ring-red-500/10"
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-foreground">{t.title}</span>
                  {isTaskOverdue(t, todayLocal) && (
                    <span className="rounded-full bg-red-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-red-200">
                      Overdue
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                  {timeBlock && (
                    <span className="flex items-center gap-1 font-mono">
                      <Clock size={10} />
                      {timeBlock}
                    </span>
                  )}
                  {t.estimatedMinutes && (
                    <span>{t.estimatedMinutes}min</span>
                  )}
                  <span title="Physical energy">E:{displayPhysicalEnergy(t)}</span>
                  <span title="Cognitive / focus type" className="capitalize">
                    {t.energyLevel.replace("_", " ")}
                  </span>
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
            Use Brain Dump (Ctrl/Cmd+Shift+D) to capture tasks, or schedule them from the Board.
          </p>
        </div>
      )}
    </div>
  );
}
