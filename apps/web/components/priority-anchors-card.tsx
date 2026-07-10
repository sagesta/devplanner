"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Check, Compass, GraduationCap, Heart, Pencil, Sparkles, X } from "lucide-react";
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
    label: "Professional",
    Icon: GraduationCap,
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
  return "Which professional skill or habit are you improving?";
}

export function PriorityAnchorsCard({
  variant = "full",
  className,
}: {
  /**
   * full   — week + month side by side (Insights "North Star" card)
   * week   — just this week, compact (Sprints)
   * margin — quiet "margin notes" rendering, no card chrome (Daybook Today rail)
   */
  variant?: "full" | "week" | "margin";
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

  // Quiet margin-notes rendering (Daybook Today rail) — no card chrome.
  if (variant === "margin") {
    if (q.isLoading) {
      return (
        <div className={cn("space-y-3 animate-pulse", className)}>
          {CATEGORIES.map((c) => (
            <div key={c} className="h-9 rounded bg-[var(--hairline-soft)]" />
          ))}
        </div>
      );
    }
    if (q.isError || !q.data) return null;
    const anchors = q.data.week_anchors;
    const isEditing = editing === "week";
    return (
      <div className={className}>
        <div className="flex flex-col gap-3.5">
          {CATEGORIES.map((category) => {
            const meta = CATEGORY_META[category];
            const statement = anchors.find((a) => a.category === category)?.statement.trim();
            return (
              <div key={category}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  {meta.label}
                </p>
                {isEditing ? (
                  <textarea
                    rows={2}
                    maxLength={280}
                    value={draft[category]}
                    onChange={(e) => setDraft((d) => ({ ...d, [category]: e.target.value }))}
                    placeholder={placeholderFor(category)}
                    className="mt-1 w-full resize-none rounded-lg border border-[var(--hairline)] bg-background px-2.5 py-1.5 text-sm leading-[1.45] text-[var(--ink)] placeholder:text-[var(--muted-soft)] focus:border-[var(--teal-a30)] focus:outline-none"
                  />
                ) : statement ? (
                  <p className="mt-1 text-sm leading-[1.45] text-[var(--ink)]">{statement}</p>
                ) : (
                  <p className="mt-1 text-[13px] italic leading-[1.45] text-[var(--muted-soft)]">
                    {placeholderFor(category)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        {isEditing ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
            <button
              type="button"
              className="font-medium text-[var(--teal)] hover:underline disabled:opacity-50"
              onClick={() => saveMut.mutate("week")}
              disabled={saveMut.isPending}
            >
              {saveMut.isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="text-[var(--teal)] hover:underline disabled:opacity-50"
              onClick={() => suggestMut.mutate("week")}
              disabled={suggestMut.isPending}
              title="AI suggestions from your recent task history"
            >
              {suggestMut.isPending ? "Thinking…" : "Suggest"}
            </button>
            <button
              type="button"
              className="text-muted hover:text-[var(--ink)]"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="mt-3 inline-block text-[13px] text-[var(--teal)] hover:underline"
            onClick={() => setEditing("week")}
          >
            Edit anchors
          </button>
        )}
      </div>
    );
  }

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
                <Compass size={14} className="text-primary-text" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  {PERIOD_LABEL[period]}
                </h3>
                <span className="text-[11px] text-muted/85">
                  {new Date(periodStart + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                </span>
                {filledCount === 0 && !isEditing && (
                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
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
                    className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary-text hover:bg-primary/20 transition-colors disabled:opacity-50"
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
                        <span className="text-[11px] uppercase tracking-wider text-muted">
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
                        className="mt-1 w-full resize-none rounded-md border border-white/5 bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted/60 focus:border-primary/40 focus:outline-none"
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
                      <span className="text-[11px] uppercase tracking-wider text-muted">
                        {meta.label}
                      </span>
                    </div>
                    {statement ? (
                      <p className="mt-1 text-sm text-foreground leading-snug">
                        {statement}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted/85 italic">
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
