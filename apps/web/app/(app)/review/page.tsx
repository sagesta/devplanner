"use client";

import { Award, BarChart3, CheckCircle2, Circle, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { TimeWeekPanel } from "@/components/TimeWeekPanel";
import { startOfWeekMonday, addDaysYMD } from "@/lib/timeline-utils";
import { createSprint, saveReview } from "@/lib/api";
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
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="max-w-xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl text-foreground">Weekly review</h1>
            <p className="mt-1 text-sm text-muted">
              Count wins, clear carryover, set the next sprint.
            </p>
          </div>
          {confirmingReset ? (
            <div className="flex items-center gap-2">
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
                className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/20"
              >
                Clear notes
              </button>
              <button
                type="button"
                onClick={() => setConfirmingReset(false)}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-muted transition-colors hover:bg-white/5 hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingReset(true)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-muted hover:bg-white/5 hover:text-foreground transition-colors"
            >
              Reset / Start over
            </button>
          )}
        </div>

        {/* Progress dots */}
        <div className="mt-5 flex items-start gap-0">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-start">
              <div className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => setStep(i)}
                  title={s.title}
                  className={cn(
                    "rounded-full transition-all",
                    i <= step ? "text-primary-text" : "text-muted/50"
                  )}
                >
                  {i < step ? (
                    <CheckCircle2 size={20} />
                  ) : (
                    <Circle size={20} className={cn(i === step && "text-primary-text fill-primary/20")} />
                  )}
                </button>
                <span className={cn(
                  "text-[11px] max-w-[60px] text-center leading-tight",
                  i <= step ? "text-foreground/70" : "text-muted/60"
                )}>
                  {s.title.split(" ").slice(0, 2).join(" ")}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    "mt-2.5 h-0.5 w-8",
                    i < step ? "bg-primary" : "bg-white/10"
                  )}
                />
              )}
            </div>
          ))}
        </div>

        {finished ? (
          <div className="mt-6 rounded-2xl border border-primary/30 bg-primary/5 p-8 text-center animate-fadeIn">
            <CheckCircle2 size={36} className="mx-auto mb-3 text-primary-text" />
            <h2 className="font-display text-xl text-foreground">Review complete!</h2>
            <p className="mt-2 text-sm text-muted">
              Your next sprint has been created. Head to{" "}
              <Link href="/plan?view=sprints" className="text-primary-text hover:underline">Plan</Link>{" "}
              to add tasks.
            </p>
            <button
              onClick={() => {
                setStep(0);
                setNotes(["", "", "", "", ""]);
                setFinished(false);
              }}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-foreground hover:bg-white/20 transition-colors"
            >
              Start New Review
            </button>
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-white/10 bg-surface p-5 animate-fadeIn" key={step}>
            <p className="text-[11px] uppercase tracking-wider text-muted">
              Step {step + 1} of {STEPS.length}
            </p>
            <h2 className="mt-1.5 font-display text-lg text-foreground">{STEPS[step].title}</h2>
            <p className="mt-1 text-xs text-muted/85">{STEPS[step].hint}</p>
            <textarea
              className="mt-4 min-h-[160px] w-full rounded-xl border border-white/10 bg-background p-4 text-sm text-foreground placeholder:text-muted/60 resize-none"
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
                  className="rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5"
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
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover transition-colors"
                  onClick={() => setStep((s) => s + 1)}
                >
                  Next →
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-lg bg-success px-4 py-2 text-sm font-medium text-white hover:bg-success/90 transition-colors disabled:opacity-60"
                  disabled={finishMut.isPending}
                  onClick={() => finishMut.mutate()}
                >
                  {finishMut.isPending ? "Creating sprint…" : "✓ Finish & create sprint"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right column: time vs weekly targets (stacks below the form on mobile) */}
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">This week so far</p>
          <TimeWeekPanel weekStart={thisWeekStart} />
        </div>
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Week under review</p>
          <TimeWeekPanel weekStart={lastWeekStart} />
        </div>
      </div>
    </div>
  );
}

const REVIEW_VIEWS = [
  {
    key: "weekly",
    label: "Weekly review",
    href: "/review?view=weekly",
    Icon: ClipboardCheck,
    description: "Record wins, carryover, and next-week intentions.",
  },
  {
    key: "progress",
    label: "Progress",
    href: "/review?view=progress",
    Icon: BarChart3,
    description: "Read progress rings, capacity signals, and rollover proposals.",
  },
  {
    key: "accomplishments",
    label: "Accomplishments",
    href: "/review?view=accomplishments",
    Icon: Award,
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
    <div className="mx-auto flex max-w-[1440px] flex-col gap-5 pb-10">
      <header className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Review room</p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">Review</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Close the loop with reflection, progress signals, and deliberate rollover.
          </p>
        </div>
      </header>

      <nav className="grid gap-2 md:grid-cols-3" aria-label="Review views">
        {REVIEW_VIEWS.map(({ key, href, label, Icon, description }) => {
          const selected = activeView === key;
          return (
            <Link
              key={key}
              href={href}
              className={cn(
                "rounded-lg border px-3 py-3 transition-colors",
                selected
                  ? "border-primary/50 bg-primary/10 text-foreground"
                  : "border-white/10 bg-surface text-muted hover:bg-white/5 hover:text-foreground"
              )}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Icon size={15} className={selected ? "text-primary-text" : "text-muted"} />
                {label}
              </span>
              <span className="mt-1 block text-xs leading-snug text-muted">{description}</span>
            </Link>
          );
        })}
      </nav>

      <section className="rounded-lg border border-white/10 bg-background/20 p-4">
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
