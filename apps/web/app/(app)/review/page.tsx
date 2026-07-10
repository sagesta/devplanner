"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { startOfWeekMonday, addDaysYMD } from "@/lib/timeline-utils";
import { createSprint, fetchAccomplishments, fetchWeekSummary, saveReview } from "@/lib/api";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { AccomplishmentsPanel } from "@/components/accomplishments-panel";
import InsightsPage from "../insights/page";

const REVIEW_LS = "devplanner.weeklyReview.v1";

const STEPS = [
  { title: "Wins", hint: "What shipped, closed, sold, or moved forward?" },
  { title: "Carryover", hint: "What did not finish, and what blocked it?" },
  { title: "Top 3 intentions (next week)", hint: "What are the 3 most important things to do next week?" },
  { title: "Draft sprint (notes)", hint: "High-level plan: what goes into the sprint, what stays in backlog?" },
  { title: "Approve & close", hint: "Review your notes above and finalize the week." },
] as const;

/** Display-only short labels for the step rail (Daybook design). */
const STEP_SHORT_LABELS = ["Wins", "Carryover", "Intentions", "Draft sprint", "Approve"] as const;

function nextMonday(d = new Date()) {
  const day = d.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  const next = new Date(d);
  next.setDate(d.getDate() + diff);
  return next;
}

function toYmd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function formatHours(totalSeconds: number): string {
  const hours = totalSeconds / 3600;
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function WeeklyReviewContent() {
  const [step, setStep] = useState(0);
  const [notes, setNotes] = useState<string[]>(["", "", "", "", ""]);
  const [hydrated, setHydrated] = useState(false);
  const [finished, setFinished] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const _userId = useAppUserId();
  const qc = useQueryClient();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(REVIEW_LS);
      if (raw) {
        const j = JSON.parse(raw) as { step?: number; notes?: string[]; finished?: boolean };
        if (typeof j.step === "number" && j.step >= 0 && j.step < 5) setStep(j.step);
        if (Array.isArray(j.notes) && j.notes.length === 5) setNotes(j.notes.map((x) => String(x ?? "")));
        if (j.finished) setFinished(true);
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (finished) {
        localStorage.removeItem(REVIEW_LS);
      } else {
        localStorage.setItem(REVIEW_LS, JSON.stringify({ step, notes }));
      }
    } catch {
      /* ignore */
    }
  }, [step, notes, hydrated, finished]);

  const thisWeekStart = useMemo(() => startOfWeekMonday(new Date()), []);
  const lastWeekStart = useMemo(() => addDaysYMD(thisWeekStart, -7), [thisWeekStart]);

  // Margin-note data: time tracked this week / last week + recent wins.
  const thisWeekQ = useQuery({
    queryKey: ["time-logs", "week-summary", thisWeekStart, _userId],
    queryFn: () => fetchWeekSummary(thisWeekStart),
    enabled: Boolean(_userId),
  });
  const lastWeekQ = useQuery({
    queryKey: ["time-logs", "week-summary", lastWeekStart, _userId],
    queryFn: () => fetchWeekSummary(lastWeekStart),
    enabled: Boolean(_userId),
  });
  const winsQ = useQuery({
    queryKey: ["accomplishments", _userId],
    queryFn: fetchAccomplishments,
    enabled: Boolean(_userId),
  });

  const thisWeekSeconds = useMemo(
    () => (thisWeekQ.data ?? []).reduce((sum, r) => sum + r.totalSeconds, 0),
    [thisWeekQ.data]
  );
  const lastWeekSeconds = useMemo(
    () => (lastWeekQ.data ?? []).reduce((sum, r) => sum + r.totalSeconds, 0),
    [lastWeekQ.data]
  );
  const areaLines = useMemo(() => {
    const map = new Map<string, { name: string; target: number | null; seconds: number }>();
    for (const row of thisWeekQ.data ?? []) {
      const key = row.areaId ?? "__none";
      const existing = map.get(key);
      if (existing) {
        existing.seconds += row.totalSeconds;
      } else {
        map.set(key, {
          name: row.areaName ?? "Unassigned",
          target: row.weeklyHourTarget ? Number(row.weeklyHourTarget) : null,
          seconds: row.totalSeconds,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.seconds - a.seconds);
  }, [thisWeekQ.data]);
  const recentWins = useMemo(() => (winsQ.data ?? []).slice(0, 3), [winsQ.data]);

  const finishMut = useMutation({
    mutationFn: async () => {
      const nextMon = nextMonday();
      const nextFri = new Date(nextMon);
      nextFri.setDate(nextMon.getDate() + 4);
      const goal = notes[3]?.trim() || notes[2]?.trim() || null;
      const weekLabel = nextMon.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

      // Persist the review notes to the backend filesystem
      await saveReview({
        step1: notes[0],
        step2: notes[1],
        step3: notes[2],
      }).catch(err => {
        console.error("Failed to save review markdown file context", err);
      });

      return createSprint({
        name: `Week of ${weekLabel}`,
        startDate: toYmd(nextMon),
        endDate: toYmd(nextFri),
        goal,
        status: "active",
      });
    },
    onSuccess: () => {
      setFinished(true);
      void qc.invalidateQueries({ queryKey: ["sprints"] });
      toast.success("Review saved. Next sprint created.");
    },
    onError: (e: Error) => toast.error(`Failed to create sprint: ${e.message}`),
  });

  return (
    <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        {/* Step rail */}
        <div className="mb-6 flex items-center">
          {STEPS.map((s, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <div key={i} className={cn("flex items-center", i < STEPS.length - 1 && "flex-1")}>
                <button
                  type="button"
                  onClick={() => setStep(i)}
                  title={s.title}
                  className="flex flex-col items-center gap-1.5"
                >
                  <span
                    className={cn(
                      "flex h-[26px] w-[26px] items-center justify-center rounded-full border-[1.5px] text-xs font-semibold transition-colors",
                      done
                        ? "border-[var(--teal)] bg-[var(--teal)] text-white"
                        : active
                          ? "border-[var(--teal)] bg-[var(--teal-a12)] text-[var(--teal)]"
                          : "border-[var(--rule)] text-muted"
                    )}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <span
                    className={cn(
                      "whitespace-nowrap text-[11px] leading-tight",
                      done || active ? "text-[var(--ink)]" : "text-[var(--muted-soft)]"
                    )}
                  >
                    {STEP_SHORT_LABELS[i] ?? s.title}
                  </span>
                </button>
                {i < STEPS.length - 1 && (
                  <div
                    className={cn(
                      "mx-2 mb-[18px] h-[1.5px] flex-1 sm:mx-2.5",
                      done ? "bg-[var(--teal)]" : "bg-[var(--hairline)]"
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>

        {finished ? (
          <div className="rounded-2xl border border-[var(--success-border)] bg-[var(--success-bg)] p-8 text-center shadow-[var(--card-shadow)] animate-fadeIn">
            <CheckCircle2 size={36} className="mx-auto mb-3 text-[var(--success-text)]" />
            <h2 className="font-display text-[26px] font-normal text-[var(--ink)]">Review complete.</h2>
            <p className="mt-2 text-sm text-muted">
              Your next sprint has been created. Head to{" "}
              <Link href="/plan?view=sprints" className="text-[var(--teal)] hover:underline">Plan</Link>{" "}
              to add tasks.
            </p>
            <button
              onClick={() => {
                setStep(0);
                setNotes(["", "", "", "", ""]);
                setFinished(false);
              }}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--ink-btn-bg)] px-5 py-[9px] text-[13px] font-semibold text-[var(--ink-btn-fg)] transition-opacity hover:opacity-85"
            >
              Start new review
            </button>
          </div>
        ) : (
          <div
            className="rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-5 shadow-[var(--card-shadow)] sm:p-7 animate-fadeIn"
            key={step}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Step {step + 1} of {STEPS.length}
              </p>
              {confirmingReset ? (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const prev = notes;
                      setStep(0);
                      setNotes(["", "", "", "", ""]);
                      setFinished(false);
                      setConfirmingReset(false);
                      localStorage.removeItem(REVIEW_LS);
                      toast("Review notes cleared", {
                        action: { label: "Undo", onClick: () => setNotes(prev) },
                        duration: 6000,
                      });
                    }}
                    className="rounded-full border border-danger/40 bg-danger/10 px-3 py-1 text-xs font-semibold text-danger transition-colors hover:bg-danger/20"
                  >
                    Clear notes
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingReset(false)}
                    className="rounded-full border border-[var(--hairline)] px-3 py-1 text-xs text-muted transition-colors hover:bg-[var(--teal-a08)] hover:text-[var(--ink)]"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingReset(true)}
                  className="shrink-0 rounded-full border border-[var(--hairline)] px-3 py-1 text-xs text-muted transition-colors hover:bg-[var(--teal-a08)] hover:text-[var(--ink)]"
                >
                  Reset / Start over
                </button>
              )}
            </div>
            <h2 className="mt-1.5 font-display text-[26px] font-normal leading-tight text-[var(--ink)]">
              {STEPS[step].title}
            </h2>
            <p className="mt-1 text-[13px] text-muted">{STEPS[step].hint}</p>
            <textarea
              rows={6}
              className="mt-4 w-full resize-none rounded-xl border border-[var(--hairline)] bg-background px-4 py-3.5 text-sm leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--muted-soft)] focus:border-[var(--teal)]"
              value={notes[step] ?? ""}
              onChange={(e) => {
                const v = [...notes];
                v[step] = e.target.value;
                setNotes(v);
              }}
              placeholder="Jot notes…"
            />
            <div className="mt-4 flex justify-between gap-2">
              {step > 0 ? (
                <button
                  type="button"
                  className="rounded-full border border-[var(--hairline)] px-[18px] py-[9px] text-[13px] text-muted transition-colors hover:text-[var(--ink)]"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                >
                  ← Back
                </button>
              ) : (
                <span />
              )}
              {step < STEPS.length - 1 ? (
                <button
                  type="button"
                  className="rounded-full bg-[var(--ink-btn-bg)] px-5 py-[9px] text-[13px] font-semibold text-[var(--ink-btn-fg)] transition-opacity hover:opacity-85"
                  onClick={() => setStep((s) => s + 1)}
                >
                  Next →
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-full bg-[var(--teal)] px-5 py-[9px] text-[13px] font-semibold text-white transition-opacity hover:opacity-85 disabled:opacity-60"
                  disabled={finishMut.isPending}
                  onClick={() => finishMut.mutate()}
                >
                  {finishMut.isPending ? "Creating sprint…" : "Approve & create next sprint"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Margin notes: 2-up grid below the card on mobile, quiet right rail on desktop */}
      <aside className="grid grid-cols-2 gap-x-6 gap-y-7 lg:flex lg:flex-col lg:gap-7 lg:border-l lg:border-[var(--hairline-soft)] lg:pl-8">
        <div>
          <h3 className="font-display text-[19px] font-normal italic text-[var(--ink)]">This week</h3>
          <p className="mt-2.5 font-display text-[34px] leading-none text-[var(--ink)]">
            {formatHours(thisWeekSeconds)}
            <span className="text-xl text-muted">h</span>
          </p>
          <p className="mt-1 text-[13px] text-muted">tracked so far</p>
          {areaLines.length > 0 && (
            <div className="mt-2 flex flex-col gap-0.5">
              {areaLines.map((a) => (
                <p key={a.name} className="text-[13px] text-[var(--muted-soft)]">
                  {a.name} · {formatHours(a.seconds)}h
                  {a.target ? ` / ${a.target}h` : ""}
                </p>
              ))}
            </div>
          )}
          {lastWeekSeconds > 0 && (
            <p className="mt-2 text-[13px] text-muted">
              Last week: {formatHours(lastWeekSeconds)}h tracked
            </p>
          )}
        </div>
        <div>
          <h3 className="font-display text-[19px] font-normal italic text-[var(--ink)]">Wins logged</h3>
          {recentWins.length > 0 ? (
            <div className="mt-3 flex flex-col gap-3">
              {recentWins.map((w) => (
                <p key={w.id} className="text-sm leading-[1.45] text-[var(--ink)]">{w.title}</p>
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
          <h3 className="font-display text-[19px] font-normal italic text-[var(--ink)]">Rollover</h3>
          <p className="mt-2.5 text-[13px] leading-relaxed text-muted">
            Slipped tasks roll into next week.
            <br />
            <Link href="/review?view=progress" className="text-[var(--teal)] hover:underline">
              Preview rollover →
            </Link>
          </p>
        </div>
      </aside>
    </div>
  );
}

const REVIEW_VIEWS = [
  {
    key: "weekly",
    label: "Weekly review",
    href: "/review?view=weekly",
    description: "Record wins, carryover, and next-week intentions.",
  },
  {
    key: "progress",
    label: "Progress",
    href: "/review?view=progress",
    description: "Read progress rings, capacity signals, and rollover proposals.",
  },
  {
    key: "accomplishments",
    label: "Accomplishments",
    href: "/review?view=accomplishments",
    description: "Log what you did, the impact, and the proof — for reviews and CVs.",
  },
] as const;

type ReviewView = (typeof REVIEW_VIEWS)[number]["key"];

function normalizeReviewView(value: string | null): ReviewView {
  if (value === "progress") return "progress";
  if (value === "accomplishments") return "accomplishments";
  return "weekly";
}

export default function ReviewPage() {
  const searchParams = useSearchParams();
  const activeView = normalizeReviewView(searchParams.get("view"));

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-7 pb-16">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--teal)]">
          Weekly review
        </p>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className="mt-1.5 font-display text-[32px] font-normal leading-[1.05] text-[var(--ink)] md:text-[52px]">
            Close the loop on the week.
          </h1>
          <p className="shrink-0 text-sm text-muted">
            Count wins, clear carryover, set the next sprint
          </p>
        </div>
      </header>

      <nav className="flex flex-wrap gap-1.5" aria-label="Review views">
        {REVIEW_VIEWS.map(({ key, href, label, description }) => {
          const selected = activeView === key;
          return (
            <Link
              key={key}
              href={href}
              title={description}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-sm transition-colors",
                selected
                  ? "bg-[var(--ink-btn-bg)] font-semibold text-[var(--ink-btn-fg)]"
                  : "text-muted hover:bg-[var(--teal-a08)] hover:text-[var(--ink)]"
              )}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      <section className="min-w-0">
        {activeView === "weekly" ? (
          <WeeklyReviewContent />
        ) : activeView === "accomplishments" ? (
          <AccomplishmentsPanel />
        ) : (
          <InsightsPage />
        )}
      </section>
    </div>
  );
}
