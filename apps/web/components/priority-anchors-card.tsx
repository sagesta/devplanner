"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Check, Compass, Heart, Pencil, Sparkles, Sprout, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  fetchPriorities,
  savePriorities,
  suggestPriorities,
  type PriorityCategory,
  type PriorityPeriod,
  type PriorityRow,
} from "@/lib/api";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { cn } from "@/lib/utils";

const CATEGORIES: PriorityCategory[] = ["work", "personal", "growth"];

const CATEGORY_META: Record<
  PriorityCategory,
  { label: string; Icon: typeof Briefcase; accent: string }
> = {
  work: {
    label: "Work",
    Icon: Briefcase,
    accent: "text-sky-300",
  },
  personal: {
    label: "Personal",
    Icon: Heart,
    accent: "text-rose-300",
  },
  growth: {
    label: "Growth",
    Icon: Sprout,
    accent: "text-emerald-300",
  },
};

const PERIOD_LABEL: Record<PriorityPeriod, string> = {
  week: "This week",
  month: "This month",
};

function placeholderFor(category: PriorityCategory): string {
  if (category === "work") return "Ship the thing that matters this week…";
  if (category === "personal") return "What does future-you want to thank you for?";
  return "What are you learning or practicing?";
}

export function PriorityAnchorsCard({
  variant = "full",
  className,
}: {
  /**
   * full   — week + month side by side (Insights "North Star" card)
   * week   — just this week, compact (Today / Sprints)
   */
  variant?: "full" | "week";
  className?: string;
}) {
  const userId = useAppUserId();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["priorities", userId],
    queryFn: () => fetchPriorities(),
    enabled: Boolean(userId),
  });
  const [editing, setEditing] = useState<PriorityPeriod | null>(null);
  const [draft, setDraft] = useState<Record<PriorityCategory, string>>({
    work: "",
    personal: "",
    growth: "",
  });
  // Track which period the draft was opened for so we don't leak edits
  // between week ↔ month when the user toggles.
  useEffect(() => {
    if (!editing || !q.data) return;
    const slot = editing === "week" ? q.data.week_anchors : q.data.month_anchors;
    setDraft({
      work: slot.find((a) => a.category === "work")?.statement ?? "",
      personal: slot.find((a) => a.category === "personal")?.statement ?? "",
      growth: slot.find((a) => a.category === "growth")?.statement ?? "",
    });
  }, [editing, q.data]);

  const saveMut = useMutation({
    mutationFn: async (periodType: PriorityPeriod) => {
      if (!q.data) throw new Error("Anchors not loaded yet");
      const periodStart =
        periodType === "week" ? q.data.period.week : q.data.period.month;
      const payload = CATEGORIES.map((category) => ({
        periodType,
        periodStart,
        category,
        statement: draft[category],
      }));
      return savePriorities(payload);
    },
    onSuccess: () => {
      toast.success("Anchors updated");
      void qc.invalidateQueries({ queryKey: ["priorities", userId] });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const suggestMut = useMutation({
    mutationFn: async (periodType: PriorityPeriod) => {
      if (!q.data) throw new Error("Anchors not loaded yet");
      const periodStart =
        periodType === "week" ? q.data.period.week : q.data.period.month;
      return suggestPriorities(periodType, periodStart);
    },
    onSuccess: (data) => {
      if (!data.drafts.length) {
        toast.error("AI didn't return suggestions — try editing manually.");
        return;
      }
      const next = { ...draft };
      for (const d of data.drafts) {
        next[d.category] = d.statement;
      }
      setDraft(next);
      toast.success("Filled from your recent activity — review and save.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!userId) return null;

  // Loading shimmer.
  if (q.isLoading) {
    return (
      <div
        className={cn(
          "rounded-xl border border-white/10 bg-surface/60 p-4 animate-pulse",
          className
        )}
      >
        <div className="h-4 w-24 rounded bg-white/10" />
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {CATEGORIES.map((c) => (
            <div key={c} className="h-12 rounded bg-white/5" />
          ))}
        </div>
      </div>
    );
  }

  if (q.isError) return null; // fail silently — non-critical surface

  const visiblePeriods: PriorityPeriod[] =
    variant === "full" ? ["week", "month"] : ["week"];

  return (
    <div className={cn("space-y-3", className)}>
      {visiblePeriods.map((period) => {
        const isEditing = editing === period;
        const anchors =
          period === "week" ? q.data!.week_anchors : q.data!.month_anchors;
        const byCategory = (cat: PriorityCategory): PriorityRow | undefined =>
          anchors.find((a) => a.category === cat);
        const periodStart =
          period === "week" ? q.data!.period.week : q.data!.period.month;
        const filledCount = anchors.filter((a) => a.statement.trim()).length;

        return (
          <section
            key={period}
            className="rounded-xl border border-white/10 bg-surface/60 p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Compass size={14} className="text-primary" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  {PERIOD_LABEL[period]}
                </h3>
                <span className="text-[10px] text-muted/70">
                  {periodStart}
                </span>
                {filledCount === 0 && !isEditing && (
                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                    Not set
                  </span>
                )}
              </div>
              {!isEditing ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-muted hover:bg-white/5 hover:text-foreground transition-colors"
                  onClick={() => setEditing(period)}
                  aria-label={`Edit ${PERIOD_LABEL[period]} anchors`}
                >
                  <Pencil size={11} />
                  Edit
                </button>
              ) : (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                    onClick={() => suggestMut.mutate(period)}
                    disabled={suggestMut.isPending}
                    title="AI suggestions from your recent task history"
                  >
                    <Sparkles size={11} />
                    {suggestMut.isPending ? "Thinking…" : "Suggest"}
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-muted hover:bg-white/5 hover:text-foreground transition-colors"
                    onClick={() => setEditing(null)}
                  >
                    <X size={11} />
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-white hover:bg-primary-hover transition-colors disabled:opacity-50"
                    onClick={() => saveMut.mutate(period)}
                    disabled={saveMut.isPending}
                  >
                    <Check size={11} />
                    {saveMut.isPending ? "Saving…" : "Save"}
                  </button>
                </div>
              )}
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {CATEGORIES.map((category) => {
                const meta = CATEGORY_META[category];
                const current = byCategory(category);
                if (isEditing) {
                  return (
                    <label
                      key={category}
                      className="rounded-lg border border-white/10 bg-background/40 p-2.5"
                    >
                      <div className="flex items-center gap-1.5">
                        <meta.Icon size={11} className={meta.accent} />
                        <span className="text-[10px] uppercase tracking-wider text-muted">
                          {meta.label}
                        </span>
                      </div>
                      <textarea
                        rows={2}
                        maxLength={280}
                        value={draft[category]}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [category]: e.target.value }))
                        }
                        placeholder={placeholderFor(category)}
                        className="mt-1 w-full resize-none rounded-md border border-white/5 bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted/50 focus:border-primary/40 focus:outline-none"
                      />
                    </label>
                  );
                }
                const statement = current?.statement.trim();
                return (
                  <div
                    key={category}
                    className={cn(
                      "rounded-lg border p-2.5 transition-colors",
                      statement
                        ? "border-white/10 bg-background/40"
                        : "border-dashed border-white/10 bg-transparent"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <meta.Icon size={11} className={meta.accent} />
                      <span className="text-[10px] uppercase tracking-wider text-muted">
                        {meta.label}
                      </span>
                    </div>
                    {statement ? (
                      <p className="mt-1 text-sm text-foreground leading-snug">
                        {statement}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted/60 italic">
                        {placeholderFor(category)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
