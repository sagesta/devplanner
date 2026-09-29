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
  type WeeklyReviewRow,
} from "@/lib/api";
import { addDaysYMD, startOfWeekMonday } from "@/lib/timeline-utils";
import { cn } from "@/lib/utils";
import {
  hasUnacknowledgedReviewEdits,
  parseReviewDraft,
  reviewDraftKey,
} from "@/lib/draft-storage";
import { useCalendarDate } from "@/hooks/use-calendar-date";

const REVIEW_LS = "devplanner.weeklyReview.v2";
const LEGACY_REVIEW_LS = "devplanner.weeklyReview.v1";

const STEPS = [
  {
    title: "Wins",
    short: "Wins",
    hint: "What shipped, closed, improved, or moved forward?",
  },
  {
    title: "Carryover",
    short: "Carryover",
    hint: "What did not finish, and what got in the way?",
  },
  {
    title: "Top 3 intentions",
    short: "Intentions",
    hint: "What are the most important outcomes for next week?",
  },
  {
    title: "Draft sprint",
    short: "Draft sprint",
    hint: "Add any boundary, sequence, or reminder for the next sprint.",
  },
  {
    title: "Approve and close",
    short: "Approve",
    hint: "Check the plan before saving the review and creating the sprint.",
  },
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
  return Array.from({ length: 3 }, () => ({
    text: "",
    goalKey: null,
    goalLabel: null,
  }));
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
    input.intentions.some((item) => item.text.trim()),
  );
}

export function WeeklyReviewPanel() {
  const userId = useAppUserId();
  const qc = useQueryClient();
  const currentDate = useCalendarDate();
  const [boundWeek, setBoundWeek] = useState(() =>
    startOfWeekMonday(new Date()),
  );
  const currentWeekStart = useMemo(
    () => startOfWeekMonday(new Date(`${currentDate}T12:00:00`)),
    [currentDate],
  );
  const thisWeekStart = boundWeek;
  const thisWeekEnd = useMemo(
    () => addDaysYMD(thisWeekStart, 6),
    [thisWeekStart],
  );
  const lastWeekStart = useMemo(
    () => addDaysYMD(thisWeekStart, -7),
    [thisWeekStart],
  );
  const [step, setStep] = useState(0);
  const [wins, setWins] = useState("");
  const [carryover, setCarryover] = useState("");
  const [intentions, setIntentions] =
    useState<WeeklyReviewIntention[]>(emptyIntentions);
  const [sprintNotes, setSprintNotes] = useState("");
  const [finished, setFinished] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [localHydrated, setLocalHydrated] = useState(false);
  const [hydratedDraftKey, setHydratedDraftKey] = useState("");
  const [serverApplied, setServerApplied] = useState(false);
  const [draftState, setDraftState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [editSequence, setEditSequence] = useState(0);
  const [acknowledgedSequence, setAcknowledgedSequence] = useState(0);
  const [serverRevision, setServerRevision] = useState(0);
  const [serverConflict, setServerConflict] = useState<WeeklyReviewRow | null>(
    null,
  );
  const [legacyDraft, setLegacyDraft] = useState<
    (Partial<WeeklyReviewInput> & { step?: number; notes?: string[] }) | null
  >(null);
  const [storageError, setStorageError] = useState(false);
  const [createSprint, setCreateSprint] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const editSequenceRef = useRef(0);
  const revisionRef = useRef(0);
  const generationRef = useRef(0);
  const completionGenerationRef = useRef(0);
  const hydrationKeyRef = useRef("");
  const serverAppliedKeyRef = useRef("");
  const draftKey = userId ? reviewDraftKey(userId, thisWeekStart) : "";

  function markEdited() {
    editSequenceRef.current += 1;
    setEditSequence(editSequenceRef.current);
    setDraftState("idle");
  }

  function applyInput(input: Partial<WeeklyReviewInput>, nextStep?: number) {
    setWins(String(input.wins ?? ""));
    setCarryover(String(input.carryover ?? ""));
    setIntentions(
      Array.isArray(input.intentions)
        ? [...input.intentions, ...emptyIntentions()].slice(0, 3)
        : emptyIntentions(),
    );
    setSprintNotes(String(input.sprintNotes ?? ""));
    if (nextStep !== undefined) setStep(Math.min(4, Math.max(0, nextStep)));
  }

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
    () => ({
      weekStart: thisWeekStart,
      weekEnd: thisWeekEnd,
      wins,
      carryover,
      intentions,
      sprintNotes,
    }),
    [thisWeekStart, thisWeekEnd, wins, carryover, intentions, sprintNotes],
  );

  useEffect(() => {
    if (
      currentWeekStart !== boundWeek &&
      editSequenceRef.current === 0 &&
      !hasReviewContent(reviewInput) &&
      !finished
    )
      setBoundWeek(currentWeekStart);
  }, [currentWeekStart, boundWeek, reviewInput, finished]);

  const goalOptions = useMemo(() => {
    const goals = goalsQ.data?.goals;
    if (!goals) return [];
    return (Object.entries(goals) as Array<[GoalCellKey, string]>).flatMap(
      ([key, value]) =>
        value
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((label) => ({ key, label, context: GOAL_CELL_LABELS[key] })),
    );
  }, [goalsQ.data]);

  /* eslint-disable react-hooks/set-state-in-effect -- The signed-in account and browser draft key are external inputs; hydration must clear the prior account's draft immediately. */
  useEffect(() => {
    if (!userId) {
      generationRef.current += 1;
      hydrationKeyRef.current = "";
      serverAppliedKeyRef.current = "";
      applyInput({}, 0);
      setLocalHydrated(false);
      setHydratedDraftKey("");
      setServerApplied(false);
      setServerConflict(null);
      saveChainRef.current = Promise.resolve();
      return;
    }
    if (hydrationKeyRef.current === draftKey) return;
    generationRef.current += 1;
    hydrationKeyRef.current = draftKey;
    serverAppliedKeyRef.current = "";
    setLocalHydrated(false);
    setHydratedDraftKey("");
    setServerApplied(false);
    setServerConflict(null);
    saveChainRef.current = Promise.resolve();
    setFinished(false);
    applyInput({}, 0);
    editSequenceRef.current = 0;
    revisionRef.current = 0;
    setEditSequence(0);
    setAcknowledgedSequence(0);
    setServerRevision(0);
    try {
      const saved = parseReviewDraft(
        localStorage.getItem(draftKey),
        userId,
        thisWeekStart,
      );
      if (saved) {
        applyInput(saved.input, saved.step);
        editSequenceRef.current = saved.editSequence;
        revisionRef.current = saved.serverRevision;
        setEditSequence(saved.editSequence);
        setAcknowledgedSequence(saved.acknowledgedSequence);
        setServerRevision(saved.serverRevision);
      } else {
        const raw =
          localStorage.getItem(REVIEW_LS) ??
          localStorage.getItem(LEGACY_REVIEW_LS);
        if (raw) setLegacyDraft(JSON.parse(raw));
      }
    } catch {
      setStorageError(true);
    }
    setLocalHydrated(true);
    setHydratedDraftKey(draftKey);
  }, [userId, draftKey, thisWeekStart]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (
      !localHydrated ||
      hydratedDraftKey !== draftKey ||
      !currentQ.isSuccess ||
      !userId ||
      serverAppliedKeyRef.current === draftKey
    )
      return;
    serverAppliedKeyRef.current = draftKey;
    const review = currentQ.data?.review;
    const saved = (() => {
      try {
        return parseReviewDraft(
          localStorage.getItem(draftKey),
          userId,
          thisWeekStart,
        );
      } catch {
        return null;
      }
    })();
    const locallyDirty =
      editSequenceRef.current > acknowledgedSequence ||
      Boolean(saved && hasUnacknowledgedReviewEdits(saved));
    if (review) {
      if (locallyDirty) {
        if (
          review.revision !== revisionRef.current ||
          review.status === "completed"
        )
          setServerConflict(review);
      } else {
        applyInput(review);
        revisionRef.current = review.revision;
        setServerRevision(review.revision);
        setCreateSprint(Boolean(review.sprintId));
      }
      if (!locallyDirty) setFinished(review.status === "completed");
    }
    setServerApplied(true);
  }, [
    currentQ.data,
    currentQ.isSuccess,
    localHydrated,
    hydratedDraftKey,
    userId,
    draftKey,
    thisWeekStart,
    acknowledgedSequence,
  ]);

  /* eslint-disable react-hooks/set-state-in-effect -- Storage availability is learned only by writing the draft to localStorage. */
  useEffect(() => {
    if (!localHydrated || hydratedDraftKey !== draftKey || !userId || finished)
      return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          version: 3,
          userId,
          weekStart: thisWeekStart,
          input: reviewInput,
          step,
          editSequence,
          acknowledgedSequence,
          serverRevision,
        }),
      );
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [
    finished,
    localHydrated,
    hydratedDraftKey,
    reviewInput,
    step,
    editSequence,
    acknowledgedSequence,
    serverRevision,
    userId,
    draftKey,
    thisWeekStart,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (
      !serverApplied ||
      hydratedDraftKey !== draftKey ||
      !userId ||
      finished ||
      serverConflict ||
      editSequence <= acknowledgedSequence
    )
      return;
    const snapshot = reviewInput;
    const sequence = editSequence;
    const generation = generationRef.current;
    const timeout = window.setTimeout(() => {
      if (generation !== generationRef.current) return;
      setDraftState("saving");
      saveChainRef.current = saveChainRef.current
        .catch(() => undefined)
        .then(async () => {
          if (generation !== generationRef.current) return;
          try {
            const result = await saveReviewDraft(snapshot, revisionRef.current);
            if (generation !== generationRef.current) return;
            revisionRef.current = result.review.revision;
            setServerRevision(result.review.revision);
            setAcknowledgedSequence((previous) => Math.max(previous, sequence));
            if (editSequenceRef.current === sequence) setDraftState("saved");
          } catch (error) {
            if (generation !== generationRef.current) return;
            setDraftState("error");
            if (
              error instanceof Error &&
              (error.message.includes("409") ||
                error.message.includes("review changed"))
            ) {
              const fresh = await fetchCurrentReview(thisWeekStart).catch(
                () => null,
              );
              if (generation === generationRef.current && fresh?.review)
                setServerConflict(fresh.review);
            }
          }
        });
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [
    finished,
    reviewInput,
    serverApplied,
    hydratedDraftKey,
    draftKey,
    userId,
    serverConflict,
    editSequence,
    acknowledgedSequence,
    thisWeekStart,
    retryVersion,
  ]);

  const finishMut = useMutation({
    mutationFn: async () => {
      const generation = generationRef.current;
      completionGenerationRef.current = generation;
      const sequence = editSequenceRef.current;
      const key = draftKey;
      const snapshot = reviewInput;
      await saveChainRef.current;
      if (generation !== generationRef.current)
        throw new Error("Review account or week changed before completion");
      const result = await completeWeeklyReview(
        snapshot,
        revisionRef.current,
        createSprint,
      );
      return { result, generation, sequence, key };
    },
    onSuccess: ({ result: data, generation, sequence, key }) => {
      if (generation !== generationRef.current || key !== draftKey) return;
      if (sequence !== editSequenceRef.current) {
        setServerConflict(data.review);
        toast("Review completed. Newer local edits are still in this draft.");
        return;
      }
      setFinished(true);
      try {
        localStorage.removeItem(key);
      } catch {
        setStorageError(true);
      }
      void qc.invalidateQueries({ queryKey: ["weekly-reviews"] });
      void qc.invalidateQueries({ queryKey: ["weekly-review", thisWeekStart] });
      void qc.invalidateQueries({ queryKey: ["sprints"] });
      toast.success(
        data.alreadyCompleted
          ? "Review was already complete."
          : data.sprintId
            ? "Review saved. Next sprint created."
            : "Review saved.",
      );
    },
    onError: (error: Error) => {
      if (completionGenerationRef.current !== generationRef.current) return;
      setDraftState("error");
      toast.error("Review was not completed", {
        description: `${error.message}. Your draft is still here.`,
      });
    },
  });

  const thisWeekSeconds = (thisWeekQ.data ?? []).reduce(
    (sum, row) => sum + row.totalSeconds,
    0,
  );
  const lastWeekSeconds = (lastWeekQ.data ?? []).reduce(
    (sum, row) => sum + row.totalSeconds,
    0,
  );
  const recentWins = (winsQ.data ?? []).slice(0, 3);

  function updateIntention(
    index: number,
    update: Partial<WeeklyReviewIntention>,
  ) {
    markEdited();
    setIntentions((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...update } : item,
      ),
    );
  }

  function clearDraft() {
    setStep(0);
    setWins("");
    setCarryover("");
    setIntentions(emptyIntentions());
    setSprintNotes("");
    markEdited();
    setConfirmingReset(false);
    setDraftState("idle");
    toast("Review draft cleared");
  }

  function restoreLegacy() {
    if (!legacyDraft) return;
    if ("notes" in legacyDraft && Array.isArray(legacyDraft.notes)) {
      const notes = legacyDraft.notes as string[];
      applyInput(
        {
          wins: notes[0],
          carryover: notes[1],
          sprintNotes: notes[3],
          intentions: String(notes[2] ?? "")
            .split("\n")
            .filter(Boolean)
            .slice(0, 3)
            .map((text) => ({ text, goalKey: null, goalLabel: null })),
        },
        legacyDraft.step,
      );
    } else applyInput(legacyDraft, legacyDraft.step);
    markEdited();
    setLegacyDraft(null);
  }

  function useServerVersion() {
    if (!serverConflict) return;
    applyInput(serverConflict);
    revisionRef.current = serverConflict.revision;
    setServerRevision(serverConflict.revision);
    editSequenceRef.current = 0;
    setEditSequence(0);
    setAcknowledgedSequence(0);
    setServerConflict(null);
    setDraftState("saved");
    setCreateSprint(Boolean(serverConflict.sprintId));
    if (serverConflict.status === "completed") {
      try {
        localStorage.removeItem(draftKey);
      } catch {
        setStorageError(true);
      }
    }
    setFinished(serverConflict.status === "completed");
  }

  function keepLocalVersion() {
    if (!serverConflict) return;
    revisionRef.current = serverConflict.revision;
    setServerRevision(serverConflict.revision);
    markEdited();
    setServerConflict(null);
  }

  if (currentQ.isLoading && !localHydrated) {
    return (
      <div
        className="h-64 animate-pulse rounded-md bg-[var(--teal-a08)]"
        aria-label="Loading weekly review"
      />
    );
  }

  if (finished) {
    return (
      <div className="border border-[var(--success-border)] bg-[var(--success-bg)] p-8 text-center">
        <CheckCircle2
          size={36}
          className="mx-auto mb-3 text-[var(--success-text)]"
        />
        <h2 className="font-display text-[26px] text-[var(--ink)]">
          Review complete.
        </h2>
        <p className="mt-2 text-sm text-muted">
          Your review is saved to your account
          {createSprint ? " and the next sprint is ready" : ""}.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {createSprint && (
            <Link
              href="/plan?view=sprints"
              className="rounded-full bg-[var(--ink-btn-bg)] px-5 py-2 text-[13px] font-semibold text-[var(--ink-btn-fg)]"
            >
              Open next sprint
            </Link>
          )}
          <Link
            href="/review?view=history"
            className="rounded-full border border-[var(--hairline)] px-5 py-2 text-[13px] text-[var(--ink)]"
          >
            View history
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0">
        {currentQ.isError && (
          <div className="mb-4 rounded-md border border-[var(--hairline)] p-3 text-sm text-[var(--ink)]">
            Could not load this review from your account. Your browser draft is
            still here.
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => void currentQ.refetch()}
            >
              Retry loading
            </button>
          </div>
        )}
        {currentWeekStart !== thisWeekStart && (
          <div className="mb-4 rounded-md border border-[var(--hairline)] p-3 text-sm text-[var(--ink)]">
            This draft belongs to the week of {thisWeekStart}. Finish it here,
            or{" "}
            <button
              type="button"
              className="underline"
              onClick={() => setBoundWeek(currentWeekStart)}
            >
              switch to this week
            </button>
            .
          </div>
        )}
        {storageError && (
          <p className="mb-4 text-sm text-danger">
            Browser draft recovery is unavailable. Keep this tab open until your
            account save succeeds.
          </p>
        )}
        {legacyDraft && (
          <div className="mb-4 rounded-md border border-[var(--hairline)] p-3 text-sm text-[var(--ink)]">
            An older browser draft has unknown account or week ownership. Review
            it before restoring to this week.
            <details className="mt-2">
              <summary>Preview older draft</summary>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">
                {JSON.stringify(legacyDraft, null, 2)}
              </pre>
            </details>
            <button
              type="button"
              className="mt-2 underline"
              onClick={restoreLegacy}
            >
              Restore to this week
            </button>
          </div>
        )}
        {serverConflict && (
          <div className="mb-4 rounded-md border border-[var(--high)] p-3 text-sm text-[var(--ink)]">
            This review changed elsewhere. Your local draft is preserved. Choose
            which version to continue with.
            <details className="mt-2">
              <summary>Preview server version</summary>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">
                {JSON.stringify(serverConflict, null, 2)}
              </pre>
            </details>
            <div className="mt-2 flex gap-3">
              {serverConflict.status !== "completed" && (
                <button
                  type="button"
                  className="underline"
                  onClick={keepLocalVersion}
                >
                  Keep my draft
                </button>
              )}
              <button
                type="button"
                className="underline"
                onClick={useServerVersion}
              >
                Use server version
              </button>
            </div>
          </div>
        )}
        <div className="mb-6 flex items-center">
          {STEPS.map((item, index) => {
            const done = index < step;
            const active = index === step;
            return (
              <div
                key={item.short}
                className={cn(
                  "flex items-center",
                  index < STEPS.length - 1 && "flex-1",
                )}
              >
                <button
                  type="button"
                  onClick={() => setStep(index)}
                  title={item.title}
                  className="flex flex-col items-center gap-1.5"
                >
                  <span
                    className={cn(
                      "flex h-[26px] w-[26px] items-center justify-center rounded-full border text-xs font-semibold",
                      done
                        ? "border-[var(--teal)] bg-[var(--teal)] text-white"
                        : active
                          ? "border-[var(--teal)] bg-[var(--teal-a12)] text-[var(--teal)]"
                          : "border-[var(--rule)] text-muted",
                    )}
                  >
                    {done ? "✓" : index + 1}
                  </span>
                  <span
                    className={cn(
                      "whitespace-nowrap text-[11px]",
                      done || active
                        ? "text-[var(--ink)]"
                        : "text-[var(--muted-soft)]",
                    )}
                  >
                    {item.short}
                  </span>
                </button>
                {index < STEPS.length - 1 && (
                  <div
                    className={cn(
                      "mx-2 mb-[18px] h-px flex-1",
                      done ? "bg-[var(--teal)]" : "bg-[var(--hairline)]",
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>

        <section className="border border-[var(--hairline)] bg-[var(--card)] p-5 shadow-[var(--card-shadow)] sm:p-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase text-muted">
                Step {step + 1} of {STEPS.length}
              </p>
              <h2 className="mt-1.5 font-display text-[26px] leading-tight text-[var(--ink)]">
                {STEPS[step].title}
              </h2>
              <p className="mt-1 text-[13px] text-muted">{STEPS[step].hint}</p>
            </div>
            <div className="shrink-0 text-right">
              <p
                className={cn(
                  "text-[11px]",
                  draftState === "error" ? "text-danger" : "text-muted",
                )}
              >
                {draftState === "saving"
                  ? "Saving…"
                  : draftState === "saved"
                    ? "Saved"
                    : draftState === "error"
                      ? "Not saved"
                      : ""}
              </p>
              {draftState === "error" && serverApplied && !serverConflict && (
                <button
                  type="button"
                  className="mt-1 text-xs text-[var(--teal)] underline"
                  onClick={() => setRetryVersion((value) => value + 1)}
                >
                  Retry saving
                </button>
              )}
              {confirmingReset ? (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={clearDraft}
                    className="text-xs font-semibold text-danger"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingReset(false)}
                    className="text-xs text-muted"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingReset(true)}
                  className="mt-2 text-xs text-muted hover:text-[var(--ink)]"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {step === 0 && (
            <textarea
              rows={7}
              value={wins}
              onChange={(event) => {
                markEdited();
                setWins(event.target.value);
              }}
              placeholder="What are you glad moved forward?"
              className="mt-5 w-full resize-y rounded-md border border-[var(--hairline)] bg-background px-4 py-3 text-sm leading-relaxed text-[var(--ink)] outline-none focus:border-[var(--teal)]"
            />
          )}
          {step === 1 && (
            <textarea
              rows={7}
              value={carryover}
              onChange={(event) => {
                markEdited();
                setCarryover(event.target.value);
              }}
              placeholder="What remains unfinished? What blocked it?"
              className="mt-5 w-full resize-y rounded-md border border-[var(--hairline)] bg-background px-4 py-3 text-sm leading-relaxed text-[var(--ink)] outline-none focus:border-[var(--teal)]"
            />
          )}
          {step === 2 && (
            <div className="mt-5 space-y-4">
              {intentions.map((item, index) => (
                <div
                  key={index}
                  className="grid gap-2 border-b border-[var(--hairline-soft)] pb-4 last:border-0 last:pb-0 sm:grid-cols-[28px_minmax(0,1fr)]"
                >
                  <span className="pt-2 text-sm font-semibold text-[var(--teal)]">
                    {index + 1}
                  </span>
                  <div className="space-y-2">
                    <input
                      value={item.text}
                      onChange={(event) =>
                        updateIntention(index, { text: event.target.value })
                      }
                      placeholder="A clear outcome for next week"
                      maxLength={500}
                      className="h-10 w-full rounded-md border border-[var(--hairline)] bg-background px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--teal)]"
                    />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted">
                        <Link2 size={13} />
                        <span className="sr-only">
                          Goal advanced by intention {index + 1}
                        </span>
                        <select
                          value={
                            item.goalKey && item.goalLabel
                              ? JSON.stringify([item.goalKey, item.goalLabel])
                              : ""
                          }
                          onChange={(event) => {
                            if (!event.target.value)
                              return updateIntention(index, {
                                goalKey: null,
                                goalLabel: null,
                              });
                            const [selectedKey, selectedLabel] = JSON.parse(
                              event.target.value,
                            ) as [GoalCellKey, string];
                            updateIntention(index, {
                              goalKey: selectedKey,
                              goalLabel: selectedLabel,
                            });
                          }}
                          className="h-9 min-w-0 flex-1 rounded-md border border-[var(--hairline)] bg-background px-2 text-xs text-[var(--ink)] outline-none focus:border-[var(--teal)]"
                        >
                          <option value="">No goal link (optional)</option>
                          {goalOptions.map((option) => (
                            <option
                              key={`${option.key}-${option.label}`}
                              value={JSON.stringify([option.key, option.label])}
                            >
                              {option.context}: {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {goalOptions.length === 0 && (
                        <Link
                          href="/goals"
                          className="text-xs text-[var(--teal)] hover:underline"
                        >
                          Add a goal
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {step === 3 && (
            <textarea
              rows={7}
              value={sprintNotes}
              onChange={(event) => {
                markEdited();
                setSprintNotes(event.target.value);
              }}
              placeholder="For example: keep Friday light; do the practice test before revising notes."
              className="mt-5 w-full resize-y rounded-md border border-[var(--hairline)] bg-background px-4 py-3 text-sm leading-relaxed text-[var(--ink)] outline-none focus:border-[var(--teal)]"
            />
          )}
          {step === 4 && (
            <div className="mt-5 divide-y divide-[var(--hairline-soft)] border-y border-[var(--hairline)]">
              <SummaryRow label="Wins" value={wins} empty="No wins recorded" />
              <SummaryRow
                label="Carryover"
                value={carryover}
                empty="No carryover recorded"
              />
              <div className="py-4">
                <p className="text-xs font-semibold uppercase text-muted">
                  Next intentions
                </p>
                {intentions.some((item) => item.text.trim()) ? (
                  <ol className="mt-2 space-y-2 text-sm text-[var(--ink)]">
                    {intentions
                      .filter((item) => item.text.trim())
                      .map((item, index) => (
                        <li key={`${item.text}-${index}`}>
                          {index + 1}. {item.text}
                          {item.goalLabel && (
                            <span className="ml-1 text-xs text-[var(--teal)]">
                              Advances: {item.goalLabel}
                            </span>
                          )}
                        </li>
                      ))}
                  </ol>
                ) : (
                  <p className="mt-2 text-sm text-muted">
                    No intentions recorded
                  </p>
                )}
              </div>
              <SummaryRow
                label="Sprint notes"
                value={sprintNotes}
                empty="No sprint notes"
              />
            </div>
          )}

          <div className="mt-5 flex justify-between gap-2">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => setStep((value) => value - 1)}
                className="rounded-full border border-[var(--hairline)] px-[18px] py-[9px] text-[13px] text-muted"
              >
                ← Back
              </button>
            ) : (
              <span />
            )}
            {step < 4 ? (
              <button
                type="button"
                onClick={() => setStep((value) => value + 1)}
                className="rounded-full bg-[var(--ink-btn-bg)] px-5 py-[9px] text-[13px] font-semibold text-[var(--ink-btn-fg)]"
              >
                Next →
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={createSprint}
                    onChange={(event) => setCreateSprint(event.target.checked)}
                    className="mr-2"
                  />
                  Create next week&apos;s plan
                </label>
                <button
                  type="button"
                  disabled={finishMut.isPending || Boolean(serverConflict)}
                  onClick={() => finishMut.mutate()}
                  className="rounded-full bg-[var(--teal)] px-5 py-[9px] text-[13px] font-semibold text-white disabled:opacity-60"
                >
                  {finishMut.isPending ? "Saving review…" : "Complete review"}
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      <aside className="grid grid-cols-2 gap-6 lg:flex lg:flex-col lg:border-l lg:border-[var(--hairline-soft)] lg:pl-7">
        <div>
          <h3 className="font-display text-[19px] italic text-[var(--ink)]">
            This week
          </h3>
          <p className="mt-2 font-display text-[34px] leading-none text-[var(--ink)]">
            {formatHours(thisWeekSeconds)}
            <span className="text-xl text-muted">h</span>
          </p>
          <p className="mt-1 text-[13px] text-muted">tracked so far</p>
          {lastWeekSeconds > 0 && (
            <p className="mt-2 text-[13px] text-muted">
              Last week: {formatHours(lastWeekSeconds)}h
            </p>
          )}
        </div>
        <div>
          <h3 className="font-display text-[19px] italic text-[var(--ink)]">
            Wins logged
          </h3>
          {recentWins.length ? (
            <div className="mt-3 space-y-2">
              {recentWins.map((item) => (
                <p key={item.id} className="text-sm text-[var(--ink)]">
                  {item.title}
                </p>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-muted">Nothing logged yet.</p>
          )}
          <Link
            href="/review?view=accomplishments"
            className="mt-3 inline-block text-[13px] text-[var(--teal)] hover:underline"
          >
            Log a win
          </Link>
        </div>
        <div>
          <h3 className="font-display text-[19px] italic text-[var(--ink)]">
            Rollover
          </h3>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            Review unfinished work before committing it again.
          </p>
          <Link
            href="/review?view=progress"
            className="mt-1 inline-block text-[13px] text-[var(--teal)] hover:underline"
          >
            Preview rollover →
          </Link>
        </div>
      </aside>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  empty,
}: {
  label: string;
  value: string;
  empty: string;
}) {
  return (
    <div className="py-4">
      <p className="text-xs font-semibold uppercase text-muted">{label}</p>
      <p
        className={cn(
          "mt-2 whitespace-pre-wrap text-sm leading-relaxed",
          value.trim() ? "text-[var(--ink)]" : "text-muted",
        )}
      >
        {value.trim() || empty}
      </p>
    </div>
  );
}
