"use client";

import {
  ClipboardCheck,
  Download,
  RefreshCw,
  Sparkles,
  Target,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "devplanner.goalHorizons.v1";
const OWNER_STORAGE_KEY = "devplanner.goalHorizons.owner.v1";

const HORIZONS = [
  { key: "short", label: "Short-term", range: "< 1 month" },
  { key: "mid", label: "Mid-term", range: "> 1 month and < 3 months" },
  { key: "long", label: "Long-term", range: "> 3 months" },
] as const;

const AREAS = [
  { key: "personal", label: "Personal", prompt: "Health, home, relationships, rhythm." },
  { key: "professional", label: "Professional", prompt: "Skills, reputation, learning, career capital." },
  { key: "work", label: "Work", prompt: "Shipping, clients, revenue, obligations." },
] as const;

type HorizonKey = (typeof HORIZONS)[number]["key"];
type AreaKey = (typeof AREAS)[number]["key"];
type GoalCellKey = `${HorizonKey}:${AreaKey}`;
type GoalMatrix = Record<GoalCellKey, string>;

const EMPTY_GOALS: GoalMatrix = {
  "short:personal": "",
  "short:professional": "",
  "short:work": "",
  "mid:personal": "",
  "mid:professional": "",
  "mid:work": "",
  "long:personal": "",
  "long:professional": "",
  "long:work": "",
};

const STARTER_GOALS: GoalMatrix = {
  "short:personal": "Protect sleep and morning planning rhythm\nClear one home admin item",
  "short:professional": "Choose one skill to sharpen this month\nPublish one proof-of-work update",
  "short:work": "Ship the next highest-value task\nFollow up on active revenue conversations",
  "mid:personal": "Build a reliable weekly reset\nCreate a sustainable exercise cadence",
  "mid:professional": "Complete a focused learning project\nDocument a repeatable workflow",
  "mid:work": "Finish the current sprint outcome\nPackage one offer or delivery system",
  "long:personal": "Design a calmer default week\nReduce recurring friction points",
  "long:professional": "Build a stronger public portfolio\nDeepen domain expertise",
  "long:work": "Grow predictable revenue\nCreate leverage through systems",
};

function cellKey(horizon: HorizonKey, area: AreaKey): GoalCellKey {
  return `${horizon}:${area}`;
}

function goalCount(goals: GoalMatrix): number {
  return Object.values(goals).filter((value) => value.trim()).length;
}

function lineCount(value: string): number {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function safeSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "goals";
}

function goalsToMarkdown(ownerName: string, goals: GoalMatrix): string {
  const lines = [`# Goals - ${ownerName.trim() || "Me"}`, ""];

  for (const horizon of HORIZONS) {
    lines.push(`## ${horizon.label} (${horizon.range})`, "");

    for (const area of AREAS) {
      const value = goals[cellKey(horizon.key, area.key)].trim();
      lines.push(`### ${area.label}`);
      if (!value) {
        lines.push("- _No goals yet._", "");
        continue;
      }
      for (const goal of value.split("\n").map((line) => line.trim()).filter(Boolean)) {
        lines.push(`- ${goal}`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

function goalsAreEmpty(goals: GoalMatrix): boolean {
  return goalCount(goals) === 0;
}

export function GoalHorizonsMatrix({
  className,
  ownerName,
}: {
  className?: string;
  ownerName?: string | null;
}) {
  const defaultOwnerName = ownerName?.trim() || "My Goals";
  const [goals, setGoals] = useState<GoalMatrix>(EMPTY_GOALS);
  const [ownerDraft, setOwnerDraft] = useState(defaultOwnerName);
  const [hydrated, setHydrated] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const filledCount = useMemo(() => goalCount(goals), [goals]);
  const progressPercent = Math.round((filledCount / Object.keys(EMPTY_GOALS).length) * 100);

  useEffect(() => {
    try {
      const rawGoals = localStorage.getItem(STORAGE_KEY);
      if (rawGoals) {
        const parsed = JSON.parse(rawGoals) as Partial<GoalMatrix>;
        setGoals({ ...EMPTY_GOALS, ...parsed });
      }

      const rawOwner = localStorage.getItem(OWNER_STORAGE_KEY);
      setOwnerDraft(rawOwner?.trim() || defaultOwnerName);
    } catch {
      /* ignore invalid saved state */
    } finally {
      setHydrated(true);
    }
  }, [defaultOwnerName]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(goals));
      localStorage.setItem(OWNER_STORAGE_KEY, ownerDraft);
      setLastSavedAt(
        new Date().toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
    } catch {
      /* ignore storage failures */
    }
  }, [goals, hydrated, ownerDraft]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timeout = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  const markdown = useMemo(() => goalsToMarkdown(ownerDraft, goals), [goals, ownerDraft]);

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  function downloadMarkdown() {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeSlug(ownerDraft)}-goals.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function loadStarterGoals() {
    if (!goalsAreEmpty(goals) && !window.confirm("Replace the current goals with starter examples?")) {
      return;
    }
    setGoals(STARTER_GOALS);
  }

  function resetGoals() {
    if (!window.confirm("Clear every goal in the matrix?")) return;
    setGoals(EMPTY_GOALS);
  }

  return (
    <section className={cn("overflow-hidden rounded-lg border border-white/10 bg-surface", className)}>
      <div className="border-b border-white/10 px-4 py-4 md:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <Target size={14} className="text-primary" />
              Goal horizons
            </div>
            <h2 className="mt-2 font-display text-3xl text-foreground sm:text-4xl">
              Goals - {ownerDraft.trim() || "Me"}
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1">
                {filledCount}/9 cells filled
              </span>
              <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1">
                {progressPercent}% mapped
              </span>
              {lastSavedAt && (
                <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1">
                  Autosaved {lastSavedAt}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <label className="min-w-[220px] text-[11px] font-semibold uppercase tracking-wide text-muted">
              Owner
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-white/10 bg-background/40 px-3 py-2">
                <UserRound size={14} className="shrink-0 text-muted" />
                <input
                  value={ownerDraft}
                  onChange={(event) => setOwnerDraft(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-sm font-normal text-foreground placeholder:text-muted/40"
                  placeholder="Name"
                />
              </div>
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadStarterGoals}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-white/10"
                title="Fill the matrix with editable starter examples"
              >
                <Sparkles size={14} />
                Starter
              </button>
              <button
                type="button"
                onClick={() => void copyMarkdown()}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-white/10"
                title="Copy the matrix as markdown"
              >
                <ClipboardCheck size={14} />
                {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy"}
              </button>
              <button
                type="button"
                onClick={downloadMarkdown}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-white/10"
                title="Download the matrix as markdown"
              >
                <Download size={14} />
                Export
              </button>
              <button
                type="button"
                onClick={resetGoals}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-muted transition-colors hover:bg-white/5 hover:text-foreground"
                title="Clear every goal"
              >
                <RefreshCw size={14} />
                Reset
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-black/40">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      <div className="hidden overflow-x-auto p-4 lg:block">
        <div className="min-w-[980px] overflow-hidden rounded-md border border-white/15 bg-background/25">
          <div className="grid grid-cols-[190px_repeat(3,minmax(0,1fr))] border-b border-white/15 text-sm font-semibold text-foreground">
            <div className="border-r border-white/15 bg-white/5 px-4 py-4 text-muted" />
            {AREAS.map((area) => (
              <div key={area.key} className="border-r border-white/15 px-4 py-4 text-center last:border-r-0">
                {area.label}
              </div>
            ))}
          </div>

          {HORIZONS.map((horizon) => (
            <div
              key={horizon.key}
              className="grid min-h-[190px] grid-cols-[190px_repeat(3,minmax(0,1fr))] border-b border-white/15 last:border-b-0"
            >
              <div className="border-r border-white/15 bg-white/5 px-4 py-5 text-center">
                <p className="text-base font-semibold text-foreground">{horizon.label}</p>
                <p className="mt-1 text-sm font-semibold text-muted">({horizon.range})</p>
              </div>
              {AREAS.map((area) => {
                const key = cellKey(horizon.key, area.key);
                return (
                  <label key={key} className="group flex min-h-[190px] flex-col border-r border-white/15 p-4 last:border-r-0">
                    <span className="sr-only">
                      {horizon.label} {area.label} goal
                    </span>
                    <span className="mb-2 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      <span>{lineCount(goals[key]) || "No"} goal(s)</span>
                      <span className="opacity-0 transition-opacity group-focus-within:opacity-100">Editing</span>
                    </span>
                    <textarea
                      value={goals[key]}
                      onChange={(event) => setGoals((current) => ({ ...current, [key]: event.target.value }))}
                      placeholder={area.prompt}
                      rows={7}
                      className="min-h-0 flex-1 resize-none rounded-md border border-transparent bg-transparent px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted/35 transition-colors focus:border-primary/40 focus:bg-background/50"
                    />
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 p-3 lg:hidden">
        {HORIZONS.map((horizon) => (
          <section key={horizon.key} className="overflow-hidden rounded-lg border border-white/10 bg-background/30">
            <div className="border-b border-white/10 px-3 py-3">
              <p className="text-sm font-semibold text-foreground">{horizon.label}</p>
              <p className="text-xs text-muted">({horizon.range})</p>
            </div>
            <div className="divide-y divide-white/10">
              {AREAS.map((area) => {
                const key = cellKey(horizon.key, area.key);
                return (
                  <label key={key} className="block px-3 py-3">
                    <span className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      <span>{area.label}</span>
                      <span>{lineCount(goals[key]) || "No"} goal(s)</span>
                    </span>
                    <textarea
                      value={goals[key]}
                      onChange={(event) => setGoals((current) => ({ ...current, [key]: event.target.value }))}
                      placeholder={area.prompt}
                      rows={4}
                      className="mt-2 w-full resize-none rounded-md border border-white/10 bg-surface px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted/35 focus:border-primary/40"
                    />
                  </label>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
