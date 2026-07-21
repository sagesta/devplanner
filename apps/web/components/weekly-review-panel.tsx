"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Link2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import {
  completeWeeklyReview,
  fetchAccomplishments,
  fetchCurrentReview,
  fetchGoalHorizons,
  fetchWeekSummary,
  saveReviewDraft,
  type GoalCellKey,
  type WeeklyReviewInput,
  type WeeklyReviewIntention,
} from "@/lib/api";
import { addDaysYMD, startOfWeekMonday } from "@/lib/timeline-utils";
import { cn } from "@/lib/utils";

const REVIEW_LS = "devplanner.weeklyReview.v2";
const LEGACY_REVIEW_LS = "devplanner.weeklyReview.v1";

const STEPS = [
  { title: "Wins", short: "Wins", hint: "What shipped, closed, improved, or moved forward?" },
  { title: "Carryover", short: "Carryover", hint: "What did not finish, and what got in the way?" },
  { title: "Top 3 intentions", short: "Intentions", hint: "What are the most important outcomes for next week?" },
  { title: "Draft sprint", short: "Draft sprint", hint: "Add any boundary, sequence, or reminder for the next sprint." },
  { title: "Approve and close", short: "Approve", hint: "Check the plan before saving the review and creating the sprint." },
] as const;

const GOAL_CELL_LABELS: Record<GoalCellKey, string> = {
  "short:personal": "Short-term personal",
  "short:professional": "Short-term professional",
  "short:work": "Short-term work",
  "mid:personal": "Mid-term personal",
  "mid:professional": "Mid-term professional",
  "mid:work": "Mid-term work",
  "long:personal": "Long-term personal",
  "long:professional": "Long-term professional",
  "long:work": "Long-term work",
};

function emptyIntentions(): WeeklyReviewIntention[] {
  return Array.from({ length: 3 }, () => ({ text: "", goalKey: null, goalLabel: null }));
}

function formatHours(totalSeconds: number): string {
  const rounded = Math.round((totalSeconds / 3600) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function hasReviewContent(input: WeeklyReviewInput) {
  return Boolean(
    input.wins.trim() ||
      input.carryover.trim() ||
      input.sprintNotes.trim() ||
      input.intentions.some((item) => item.text.trim())
  );
}

export function WeeklyReviewPanel() {
  const userId = useAppUserId();
  const qc = useQueryClient();
  const thisWeekStart = useMemo(() => startOfWeekMonday(new Date()), []);
  const thisWeekEnd = useMemo(() => addDaysYMD(thisWeekStart, 6), [thisWeekStart]);
  const lastWeekStart = useMemo(() => addDaysYMD(thisWeekStart, -7), [thisWeekStart]);
  const [step, setStep] = useState(0);
  const [wins, setWins] = useState("");
  const [carryover, setCarryover] = useState("");
  const [intentions, setIntentions] = useState<WeeklyReviewIntention[]>(emptyIntentions);
  const [sprintNotes, setSprintNotes] = useState("");
  const [finished, setFinished] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [localHydrated, setLocalHydrated] = useState(false);
  const [serverApplied, setServerApplied] = useState(false);
  const [draftState, setDraftState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const serverAppliedRef = useRef(false);

  const currentQ = useQuery({
    queryKey: ["weekly-review", thisWeekStart, userId],
    queryFn: () => fetchCurrentReview(thisWeekStart),
    enabled: Boolean(userId),
  });
  const goalsQ = useQuery({
    queryKey: ["goal-horizons", userId],
    queryFn: fetchGoalHorizons,
    enabled: Boolean(userId),
    staleTime: 60_000,
  });
  const thisWeekQ = useQuery({
    queryKey: ["time-logs", "week-summary", thisWeekStart, userId],
    queryFn: () => fetchWeekSummary(thisWeekStart),
    enabled: Boolean(userId),
  });
  const lastWeekQ = useQuery({
    queryKey: ["time-logs", "week-summary", lastWeekStart, userId],
    queryFn: () => fetchWeekSummary(lastWeekStart),
    enabled: Boolean(userId),
  });
  const winsQ = useQuery({
    queryKey: ["accomplishments", userId],
    queryFn: fetchAccomplishments,
    enabled: Boolean(userId),
  });

  const reviewInput = useMemo<WeeklyReviewInput>(
    () => ({ weekStart: thisWeekStart, weekEnd: thisWeekEnd, wins, carryover, intentions, sprintNotes }),
    [thisWeekStart, thisWeekEnd, wins, carryover, intentions, sprintNotes]
  );

  const goalOptions = useMemo(() => {
    const goals = goalsQ.data?.goals;
    if (!goals) return [];
    return (Object.entries(goals) as Array<[GoalCellKey, string]>).flatMap(([key, value]) =>
      value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((label) => ({ key, label, context: GOAL_CELL_LABELS[key] }))
    );
  }, [goalsQ.data]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(REVIEW_LS);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<WeeklyReviewInput> & { step?: number };
        setStep(typeof saved.step === "number" ? Math.min(4, Math.max(0, saved.step)) : 0);
        setWins(String(saved.wins ?? ""));
        setCarryover(String(saved.carryover ?? ""));
        setIntentions(Array.isArray(saved.intentions) ? [...saved.intentions, ...emptyIntentions()].slice(0, 3) : emptyIntentions());
        setSprintNotes(String(saved.sprintNotes ?? ""));
      } else {
        const legacyRaw = localStorage.getItem(LEGACY_REVIEW_LS);
        if (legacyRaw) {
          const legacy = JSON.parse(legacyRaw) as { step?: number; notes?: string[] };
          const notes = Array.isArray(legacy.notes) ? legacy.notes : [];
          setStep(typeof legacy.step === "number" ? Math.min(4, Math.max(0, legacy.step)) : 0);
          setWins(String(notes[0] ?? ""));
          setCarryover(String(notes[1] ?? ""));
          const migrated = String(notes[2] ?? "")
            .split("\n")
            .map((text) => text.replace(/^\s*[-*\d.)]+\s*/, "").trim())
            .filter(Boolean)
            .slice(0, 3)
            .map((text) => ({ text, goalKey: null, goalLabel: null }));
          setIntentions([...migrated, ...emptyIntentions()].slice(0, 3));
          setSprintNotes(String(notes[3] ?? ""));
        }
      }
    } catch {
      // A damaged local draft should not block the server copy.
    }
    setLocalHydrated(true);
  }, []);

  useEffect(() => {
    if (!currentQ.isFetched || serverAppliedRef.current) return;
    serverAppliedRef.current = true;
    const review = currentQ.data?.review;
    if (review) {
      setWins(review.wins);
      setCarryover(review.carryover);
      setIntentions([...review.intentions, ...emptyIntentions()].slice(0, 3));
      setSprintNotes(review.sprintNotes);
      setFinished(review.status === "completed");
    }
    setServerApplied(true);
  }, [currentQ.data, currentQ.isFetched]);

  useEffect(() => {
    if (!localHydrated || finished) return;
    localStorage.setItem(REVIEW_LS, JSON.stringify({ ...reviewInput, step }));
  }, [finished, localHydrated, reviewInput, step]);

  useEffect(() => {
    if (!serverApplied || !userId || finished || !hasReviewContent(reviewInput)) return;
    setDraftState("saving");
    const timeout = window.setTimeout(() => {
      void saveReviewDraft(reviewInput)
        .then(() => setDraftState("saved"))
        .catch(() => setDraftState("error"));
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [finished, reviewInput, serverApplied, userId]);

  const finishMut = useMutation({
    mutationFn: () => completeWeeklyReview(reviewInput),
    onSuccess: (data) => {
      setFinished(true);
      localStorage.removeItem(REVIEW_LS);
      localStorage.removeItem(LEGACY_REVIEW_LS);
      void qc.invalidateQueries({ queryKey: ["weekly-reviews"] });
      void qc.invalidateQueries({ queryKey: ["weekly-review", thisWeekStart] });
      void qc.invalidateQueries({ queryKey: ["sprints"] });
      toast.success(data.alreadyCompleted ? "Review was already complete." : "Review saved. Next sprint created.");
    },
    onError: (error: Error) => toast.error("Review was not completed", { description: `${error.message}. Your draft is still here.` }),
  });

  const thisWeekSeconds = (thisWeekQ.data ?? []).reduce((sum, row) => sum + row.totalSeconds, 0);
  const lastWeekSeconds = (lastWeekQ.data ?? []).reduce((sum, row) => sum + row.totalSeconds, 0);
  const recentWins = (winsQ.data ?? []).slice(0, 3);

  function updateIntention(index: number, update: Partial<WeeklyReviewIntention>) {
    setIntentions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...update } : item));
  }

  function clearDraft() {
    const empty: WeeklyReviewInput = {
      weekStart: thisWeekStart,
      weekEnd: thisWeekEnd,
      wins: "",
      carryover: "",
      intentions: [],
      sprintNotes: "",
    };
    setStep(0);
    setWins("");
    setCarryover("");
    setIntentions(emptyIntentions());
    setSprintNotes("");
    setConfirmingReset(false);
    localStorage.removeItem(REVIEW_LS);
    void saveReviewDraft(empty).then(() => setDraftState("saved")).catch(() => setDraftState("error"));
    toast("Review draft cleared");
  }

  if (currentQ.isLoading && !localHydrated) {
    return <div className="h-64 animate-pulse rounded-md bg-[var(--teal-a08)]" aria-label="Loading weekly review" />;
  }

  if (finished) {
    return (
      <div className="border border-[var(--success-border)] bg-[var(--success-bg)] p-8 text-center">
        <CheckCircle2 size={36} className="mx-auto mb-3 text-[var(--success-text)]" />
        <h2 className="font-display text-[26px] text-[var(--ink)]">Review complete.</h2>
        <p className="mt-2 text-sm text-muted">Your review is saved to your account and the next sprint is ready.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/plan?view=sprints" className="rounded-full bg-[var(--ink-btn-bg)] px-5 py-2 text-[13px] font-semibold text-[var(--ink-btn-fg)]">
            Open next sprint
          </Link>
          <Link href="/review?view=history" className="rounded-full border border-[var(--hairline)] px-5 py-2 text-[13px] text-[var(--ink)]">
            View history
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0">
        <div className="mb-6 flex items-center">
          {STEPS.map((item, index) => {
            const done = index < step;
            const active = index === step;
            return (
              <div key={item.short} className={cn("flex items-center", index < STEPS.length - 1 && "flex-1") }>
                <button type="button" onClick={() => setStep(index)} title={item.title} className="flex flex-col items-center gap-1.5">
                  <span className={cn(
                    "flex h-[26px] w-[26px] items-center justify-center rounded-full border text-xs font-semibold",
                    done ? "border-[var(--teal)] bg-[var(--teal)] text-white" : active ? "border-[var(--teal)] bg-[var(--teal-a12)] text-[var(--teal)]" : "border-[var(--rule)] text-muted"
                  )}>{done ? "✓" : index + 1}</span>
                  <span className={cn("whitespace-nowrap text-[11px]", done || active ? "text-[var(--ink)]" : "text-[var(--muted-soft)]")}>{item.short}</span>
                </button>
                {index < STEPS.length - 1 && <div className={cn("mx-2 mb-[18px] h-px flex-1", done ? "bg-[var(--teal)]" : "bg-[var(--hairline)]")} />}
              </div>
            );
          })}
        </div>

        <section className="border border-[var(--hairline)] bg-[var(--card)] p-5 shadow-[var(--card-shadow)] sm:p-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase text-muted">Step {step + 1} of {STEPS.length}</p>
              <h2 className="mt-1.5 font-display text-[26px] leading-tight text-[var(--ink)]">{STEPS[step].title}</h2>
              <p className="mt-1 text-[13px] text-muted">{STEPS[step].hint}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className={cn("text-[11px]", draftState === "error" ? "text-danger" : "text-muted") }>
                {draftState === "saving" ? "Saving…" : draftState === "saved" ? "Saved" : draftState === "error" ? "Not saved" : ""}
              </p>
              {confirmingReset ? (
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={clearDraft} className="text-xs font-semibold text-danger">Clear</button>
                  <button type="button" onClick={() => setConfirmingReset(false)} className="text-xs text-muted">Cancel</button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmingReset(true)} className="mt-2 text-xs text-muted hover:text-[var(--ink)]">Reset</button>
              )}
            </div>
          </div>

          {step === 0 && (
            <textarea rows={7} value={wins} onChange={(event) => setWins(event.target.value)} placeholder="What are you glad moved forward?" className="mt-5 w-full resize-y rounded-md border border-[var(--hairline)] bg-background px-4 py-3 text-sm leading-relaxed text-[var(--ink)] outline-none focus:border-[var(--teal)]" />
          )}
          {step === 1 && (
            <textarea rows={7} value={carryover} onChange={(event) => setCarryover(event.target.value)} placeholder="What remains unfinished? What blocked it?" className="mt-5 w-full resize-y rounded-md border border-[var(--hairline)] bg-background px-4 py-3 text-sm leading-relaxed text-[var(--ink)] outline-none focus:border-[var(--teal)]" />
          )}
          {step === 2 && (
            <div className="mt-5 space-y-4">
              {intentions.map((item, index) => (
                <div key={index} className="grid gap-2 border-b border-[var(--hairline-soft)] pb-4 last:border-0 last:pb-0 sm:grid-cols-[28px_minmax(0,1fr)]">
                  <span className="pt-2 text-sm font-semibold text-[var(--teal)]">{index + 1}</span>
                  <div className="space-y-2">
                    <input value={item.text} onChange={(event) => updateIntention(index, { text: event.target.value })} placeholder="A clear outcome for next week" maxLength={500} className="h-10 w-full rounded-md border border-[var(--hairline)] bg-background px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--teal)]" />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted">
                        <Link2 size={13} />
                        <span className="sr-only">Goal advanced by intention {index + 1}</span>
                        <select
                          value={item.goalKey && item.goalLabel ? JSON.stringify([item.goalKey, item.goalLabel]) : ""}
                          onChange={(event) => {
                            if (!event.target.value) return updateIntention(index, { goalKey: null, goalLabel: null });
                            const [selectedKey, selectedLabel] = JSON.parse(event.target.value) as [GoalCellKey, string];
                            updateIntention(index, { goalKey: selectedKey, goalLabel: selectedLabel });
                          }}
                          className="h-9 min-w-0 flex-1 rounded-md border border-[var(--hairline)] bg-background px-2 text-xs text-[var(--ink)] outline-none focus:border-[var(--teal)]"
                        >
                          <option value="">No goal link (optional)</option>
                          {goalOptions.map((option) => (
                            <option key={`${option.key}-${option.label}`} value={JSON.stringify([option.key, option.label])}>
                              {option.context}: {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {goalOptions.length === 0 && <Link href="/goals" className="text-xs text-[var(--teal)] hover:underline">Add a goal</Link>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {step === 3 && (
            <textarea rows={7} value={sprintNotes} onChange={(event) => setSprintNotes(event.target.value)} placeholder="For example: keep Friday light; do the practice test before revising notes." className="mt-5 w-full resize-y rounded-md border border-[var(--hairline)] bg-background px-4 py-3 text-sm leading-relaxed text-[var(--ink)] outline-none focus:border-[var(--teal)]" />
          )}
          {step === 4 && (
            <div className="mt-5 divide-y divide-[var(--hairline-soft)] border-y border-[var(--hairline)]">
              <SummaryRow label="Wins" value={wins} empty="No wins recorded" />
              <SummaryRow label="Carryover" value={carryover} empty="No carryover recorded" />
              <div className="py-4">
                <p className="text-xs font-semibold uppercase text-muted">Next intentions</p>
                {intentions.some((item) => item.text.trim()) ? (
                  <ol className="mt-2 space-y-2 text-sm text-[var(--ink)]">
                    {intentions.filter((item) => item.text.trim()).map((item, index) => (
                      <li key={`${item.text}-${index}`}>{index + 1}. {item.text}{item.goalLabel && <span className="ml-1 text-xs text-[var(--teal)]">Advances: {item.goalLabel}</span>}</li>
                    ))}
                  </ol>
                ) : <p className="mt-2 text-sm text-muted">No intentions recorded</p>}
              </div>
              <SummaryRow label="Sprint notes" value={sprintNotes} empty="No sprint notes" />
            </div>
          )}

          <div className="mt-5 flex justify-between gap-2">
            {step > 0 ? <button type="button" onClick={() => setStep((value) => value - 1)} className="rounded-full border border-[var(--hairline)] px-[18px] py-[9px] text-[13px] text-muted">← Back</button> : <span />}
            {step < 4 ? (
              <button type="button" onClick={() => setStep((value) => value + 1)} className="rounded-full bg-[var(--ink-btn-bg)] px-5 py-[9px] text-[13px] font-semibold text-[var(--ink-btn-fg)]">Next →</button>
            ) : (
              <button type="button" disabled={finishMut.isPending} onClick={() => finishMut.mutate()} className="rounded-full bg-[var(--teal)] px-5 py-[9px] text-[13px] font-semibold text-white disabled:opacity-60">
                {finishMut.isPending ? "Saving review…" : "Save review and create sprint"}
              </button>
            )}
          </div>
        </section>
      </div>

      <aside className="grid grid-cols-2 gap-6 lg:flex lg:flex-col lg:border-l lg:border-[var(--hairline-soft)] lg:pl-7">
        <div>
          <h3 className="font-display text-[19px] italic text-[var(--ink)]">This week</h3>
          <p className="mt-2 font-display text-[34px] leading-none text-[var(--ink)]">{formatHours(thisWeekSeconds)}<span className="text-xl text-muted">h</span></p>
          <p className="mt-1 text-[13px] text-muted">tracked so far</p>
          {lastWeekSeconds > 0 && <p className="mt-2 text-[13px] text-muted">Last week: {formatHours(lastWeekSeconds)}h</p>}
        </div>
        <div>
          <h3 className="font-display text-[19px] italic text-[var(--ink)]">Wins logged</h3>
          {recentWins.length ? (
            <div className="mt-3 space-y-2">{recentWins.map((item) => <p key={item.id} className="text-sm text-[var(--ink)]">{item.title}</p>)}</div>
          ) : <p className="mt-3 text-[13px] text-muted">Nothing logged yet.</p>}
          <Link href="/review?view=accomplishments" className="mt-3 inline-block text-[13px] text-[var(--teal)] hover:underline">Log a win</Link>
        </div>
        <div>
          <h3 className="font-display text-[19px] italic text-[var(--ink)]">Rollover</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">Review unfinished work before committing it again.</p>
          <Link href="/review?view=progress" className="mt-1 inline-block text-[13px] text-[var(--teal)] hover:underline">Preview rollover →</Link>
        </div>
      </aside>
    </div>
  );
}

function SummaryRow({ label, value, empty }: { label: string; value: string; empty: string }) {
  return (
    <div className="py-4">
      <p className="text-xs font-semibold uppercase text-muted">{label}</p>
      <p className={cn("mt-2 whitespace-pre-wrap text-sm leading-relaxed", value.trim() ? "text-[var(--ink)]" : "text-muted")}>{value.trim() || empty}</p>
    </div>
  );
}
