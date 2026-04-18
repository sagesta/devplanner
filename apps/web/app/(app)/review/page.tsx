"use client";

import { CheckCircle2, Circle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { TimeWeekPanel } from "@/components/TimeWeekPanel";
import { startOfWeekMonday, addDaysYMD } from "@/lib/timeline-utils";
import { createSprint } from "@/lib/api";
import { useAppUserId } from "@/hooks/use-app-user-id";

const REVIEW_LS = "devplanner.weeklyReview.v1";

const STEPS = [
  { title: "Last week — review completions", hint: "What did you complete? Any wins worth celebrating?" },
  { title: "Carried over — why not done?", hint: "Which tasks rolled over? What blocked you?" },
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

export default function ReviewPage() {
  const [step, setStep] = useState(0);
  const [notes, setNotes] = useState<string[]>(["", "", "", "", ""]);
  const [hydrated, setHydrated] = useState(false);
  const [finished, setFinished] = useState(false);
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
      localStorage.setItem(REVIEW_LS, JSON.stringify({ step, notes, finished }));
    } catch {
      /* ignore */
    }
  }, [step, notes, hydrated, finished]);

  const lastWeekStart = useMemo(() => {
    const thisWeek = startOfWeekMonday(new Date());
    return addDaysYMD(thisWeek, -7);
  }, []);

  const finishMut = useMutation({
    mutationFn: async () => {
      const nextMon = nextMonday();
      const nextFri = new Date(nextMon);
      nextFri.setDate(nextMon.getDate() + 4);
      const goal = notes[3]?.trim() || notes[2]?.trim() || null;
      const weekLabel = nextMon.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
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
      toast.success("Review saved — next sprint created! 🚀");
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
              Guided ritual — reflect on last week, plan the next.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!confirm("Start over? This will clear all your notes for the current review.")) return;
              setStep(0);
              setNotes(["", "", "", "", ""]);
              setFinished(false);
              localStorage.removeItem(REVIEW_LS);
            }}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-muted hover:bg-white/5 hover:text-foreground transition-colors"
          >
            Reset / Start over
          </button>
        </div>

        {/* Progress dots */}
        <div className="mt-5 flex items-center gap-0">
          {STEPS.map((_, i) => (
            <div key={i} className="flex items-center">
              <button
                type="button"
                onClick={() => setStep(i)}
                className={cn(
                  "rounded-full transition-all",
                  i <= step ? "text-primary" : "text-muted/30"
                )}
              >
                {i < step ? (
                  <CheckCircle2 size={20} />
                ) : (
                  <Circle size={20} className={cn(i === step && "text-primary fill-primary/20")} />
                )}
              </button>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    "h-0.5 w-8 transition-colors",
                    i < step ? "bg-primary" : "bg-white/10"
                  )}
                />
              )}
            </div>
          ))}
        </div>

        {finished ? (
          <div className="mt-6 rounded-2xl border border-primary/30 bg-primary/5 p-8 text-center animate-fadeIn">
            <CheckCircle2 size={36} className="mx-auto mb-3 text-primary" />
            <h2 className="font-display text-xl text-foreground">Review complete!</h2>
            <p className="mt-2 text-sm text-muted">
              Your next sprint has been created. Head to{" "}
              <a href="/sprints" className="text-primary hover:underline">Sprints</a>{" "}
              to add tasks.
            </p>
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-white/10 bg-surface p-5 animate-fadeIn" key={step}>
            <p className="text-[10px] uppercase tracking-wider text-muted">
              Step {step + 1} of {STEPS.length}
            </p>
            <h2 className="mt-1.5 font-display text-lg text-foreground">{STEPS[step].title}</h2>
            <p className="mt-1 text-xs text-muted/60">{STEPS[step].hint}</p>
            <textarea
              className="mt-4 min-h-[160px] w-full rounded-xl border border-white/10 bg-background p-4 text-sm text-foreground placeholder:text-muted/40 resize-none"
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

      {/* Right column: time panel */}
      <div className="hidden lg:block space-y-4">
        <TimeWeekPanel weekStart={lastWeekStart} />
      </div>
    </div>
  );
}
