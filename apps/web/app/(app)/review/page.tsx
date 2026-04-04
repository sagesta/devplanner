"use client";

import { CheckCircle2, Circle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STEPS = [
  { title: "Last week — review completions", hint: "What did you complete? Any wins worth celebrating?" },
  { title: "Carried over — why not done?", hint: "Which tasks rolled over? What blocked you?" },
  { title: "Top 3 intentions (next week)", hint: "What are the 3 most important things to do next week?" },
  { title: "Draft sprint (notes)", hint: "High-level plan: what goes into the sprint, what stays in backlog?" },
  { title: "Approve & close", hint: "Review your notes above and finalize the week." },
] as const;

export default function ReviewPage() {
  const [step, setStep] = useState(0);
  const [notes, setNotes] = useState<string[]>(["", "", "", "", ""]);

  return (
    <div className="max-w-xl">
      <h1 className="font-display text-2xl text-foreground">Weekly review</h1>
      <p className="mt-1 text-sm text-muted">
        Guided ritual — reflect on last week, plan the next.
      </p>

      {/* Progress dots */}
      <div className="mt-5 flex items-center gap-0">
        {STEPS.map((_, i) => (
          <div key={i} className="flex items-center">
            <button
              type="button"
              onClick={() => setStep(i)}
              className={cn(
                "rounded-full transition-all",
                i <= step
                  ? "text-primary"
                  : "text-muted/30"
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
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-white/5 disabled:opacity-30 transition-colors"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            ← Back
          </button>
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
              className="rounded-lg bg-success px-4 py-2 text-sm font-medium text-white hover:bg-success/90 transition-colors"
              onClick={() => toast.success("Review saved — connect API to create sprint")}
            >
              ✓ Finish
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
