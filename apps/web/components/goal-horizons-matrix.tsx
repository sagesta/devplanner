"use client";

import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import {
  fetchGoalHorizons,
  saveGoalHorizons,
  type GoalMatrix,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "devplanner.goalHorizons.v1";
const OWNER_STORAGE_KEY = "devplanner.goalHorizons.owner.v1";

const HORIZONS = [
  { key: "short", label: "Short-term", range: "under a month" },
  { key: "mid", label: "Mid-term", range: "1–3 months" },
  { key: "long", label: "Long-term", range: "beyond 3 months" },
] as const;

const AREAS = [
  {
    key: "personal",
    label: "Personal",
    micro: "Health, home, rhythm",
    prompt: "Health, home, relationships, rhythm.",
    colorClass: "text-[var(--rose)]",
  },
  {
    key: "professional",
    label: "Professional",
    micro: "Skills, career capital",
    prompt: "Skills, reputation, learning, career capital.",
    colorClass: "text-[var(--emerald)]",
  },
  {
    key: "work",
    label: "Work",
    micro: "Shipping, obligations",
    prompt: "Shipping, stakeholders, obligations.",
    colorClass: "text-[var(--sky)]",
  },
] as const;

type HorizonKey = (typeof HORIZONS)[number]["key"];
type AreaKey = (typeof AREAS)[number]["key"];
type GoalCellKey = keyof GoalMatrix & `${HorizonKey}:${AreaKey}`;

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
  "short:work": "Ship the next highest-value task\nFollow up on one important commitment",
  "mid:personal": "Build a reliable weekly reset\nCreate a sustainable exercise cadence",
  "mid:professional": "Complete a focused learning project\nDocument a repeatable workflow",
  "mid:work": "Finish the current sprint outcome\nDocument the delivery system",
  "long:personal": "Design a calmer default week\nReduce recurring friction points",
  "long:professional": "Build a stronger public portfolio\nDeepen domain expertise",
  "long:work": "Build a predictable delivery cadence\nCreate leverage through systems",
};

function cellKey(horizon: HorizonKey, area: AreaKey): GoalCellKey {
  return `${horizon}:${area}`;
}

/** Hand a goal cell to the AI assistant to turn into concrete tasks. */
function breakGoalIntoTasks(horizonLabel: string, areaLabel: string, text: string) {
  const clean = text.trim();
  if (!clean) return;
  const prompt = `Break this goal into concrete weekly and daily tasks I can actually act on.\n\nGoal — ${horizonLabel}, ${areaLabel}:\n${clean}\n\nGive me a short, ordered list of tasks with rough time estimates (and subtasks if useful). If I have "Can edit" turned on, add them to my backlog; otherwise just propose them and I'll switch it on.`;
  window.dispatchEvent(new CustomEvent("devplanner:ai-prompt", { detail: { prompt } }));
  toast.info("Sent to the AI assistant — review it and press send.");
}

function goalCount(goals: GoalMatrix): number {
  return Object.values(goals).filter((value) => value.trim()).length;
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

function readLocalDraft(defaultOwnerName: string): { goals: GoalMatrix; ownerName: string } | null {
  try {
    const rawGoals = localStorage.getItem(STORAGE_KEY);
    const rawOwner = localStorage.getItem(OWNER_STORAGE_KEY);
    if (!rawGoals && !rawOwner) return null;
    const parsed = rawGoals ? (JSON.parse(rawGoals) as Partial<GoalMatrix>) : {};
    return {
      goals: { ...EMPTY_GOALS, ...parsed },
      ownerName: rawOwner?.trim() || defaultOwnerName,
    };
  } catch {
    return null;
  }
}

function writeLocalDraft(ownerName: string, goals: GoalMatrix) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(goals));
    localStorage.setItem(OWNER_STORAGE_KEY, ownerName);
  } catch {
    /* local cache is best-effort only */
  }
}

function formatSavedTime(value?: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function GoalHorizonsMatrix({
  className,
  ownerName,
  standalone = false,
}: {
  className?: string;
  ownerName?: string | null;
  /** True on the Goals room: renders the full Daybook page header (eyebrow + h1). */
  standalone?: boolean;
}) {
  const defaultOwnerName = ownerName?.trim() || "My Goals";
  const userId = useAppUserId();
  const { isLoaded: authLoaded } = useAuth();
  const qc = useQueryClient();
  const [goals, setGoals] = useState<GoalMatrix>(EMPTY_GOALS);
  const [ownerDraft, setOwnerDraft] = useState(defaultOwnerName);
  const [hydrated, setHydrated] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const loadedRef = useRef(false);
  const skipAutosaveRef = useRef(false);
  const filledCount = useMemo(() => goalCount(goals), [goals]);

  const goalsQ = useQuery({
    queryKey: ["goal-horizons", userId],
    queryFn: fetchGoalHorizons,
    enabled: Boolean(userId),
  });

  const saveMut = useMutation({
    mutationFn: saveGoalHorizons,
    onSuccess: (data) => {
      writeLocalDraft(data.ownerName?.trim() || ownerDraft, data.goals);
      setLastSavedAt(formatSavedTime(data.updatedAt) ?? formatSavedTime(new Date().toISOString()));
      setSaveState("saved");
      qc.setQueryData(["goal-horizons", userId], data);
    },
    onError: (error: Error) => {
      setSaveState("error");
      toast.error(`Goals saved locally only: ${error.message}`);
    },
  });

  const saveGoalRef = useRef(saveMut.mutate);
  useEffect(() => {
    saveGoalRef.current = saveMut.mutate;
  }, [saveMut.mutate]);

  useEffect(() => {
    if (loadedRef.current) return;
    // Clerk resolves userId asynchronously — a momentarily-undefined userId right
    // after mount is NOT the same as "signed out". Treating it as signed-out here
    // would permanently skip loading server goals (loadedRef latches) and skip
    // skipAutosaveRef, so the next autosave silently overwrites server data with
    // empty/local state once userId does arrive. Wait for Clerk to finish.
    if (!authLoaded) return;

    if (!userId) {
      const localDraft = readLocalDraft(defaultOwnerName);
      if (localDraft) {
        setGoals(localDraft.goals);
        setOwnerDraft(localDraft.ownerName);
      }
      setHydrated(true);
      loadedRef.current = true;
      return;
    }

    if (goalsQ.data) {
      const serverGoals = { ...EMPTY_GOALS, ...goalsQ.data.goals };
      const serverHasGoals = !goalsAreEmpty(serverGoals);
      const localDraft = readLocalDraft(defaultOwnerName);
      const localHasGoals = localDraft ? !goalsAreEmpty(localDraft.goals) : false;

      if (!serverHasGoals && localDraft && localHasGoals) {
        setGoals(localDraft.goals);
        setOwnerDraft(localDraft.ownerName);
        setSaveState("saving");
      } else {
        skipAutosaveRef.current = true;
        setGoals(serverGoals);
        setOwnerDraft(goalsQ.data.ownerName?.trim() || defaultOwnerName);
        setLastSavedAt(formatSavedTime(goalsQ.data.updatedAt));
        setSaveState(goalsQ.data.updatedAt ? "saved" : "idle");
      }
      setHydrated(true);
      loadedRef.current = true;
      return;
    }

    if (goalsQ.isError) {
      const localDraft = readLocalDraft(defaultOwnerName);
      if (localDraft) {
        setGoals(localDraft.goals);
        setOwnerDraft(localDraft.ownerName);
      }
      skipAutosaveRef.current = true;
      setSaveState("error");
      setHydrated(true);
      loadedRef.current = true;
    }
  }, [authLoaded, defaultOwnerName, goalsQ.data, goalsQ.isError, userId]);

  useEffect(() => {
    if (!hydrated) return;
    writeLocalDraft(ownerDraft, goals);
    if (!userId) {
      setLastSavedAt(formatSavedTime(new Date().toISOString()));
      setSaveState("saved");
      return;
    }
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }

    setSaveState("saving");
    const timeout = window.setTimeout(() => {
      saveGoalRef.current({ ownerName: ownerDraft, goals });
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [goals, hydrated, ownerDraft, userId]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timeout = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  const markdown = useMemo(() => goalsToMarkdown(ownerDraft, goals), [goals, ownerDraft]);
  const statusLabel =
    goalsQ.isLoading && !hydrated
      ? "loading…"
      : saveState === "saving" || saveMut.isPending
        ? "saving…"
        : saveState === "error"
          ? "local draft only"
          : lastSavedAt
            ? `saved ${lastSavedAt}`
            : "not saved yet";

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
    const prev = goals;
    setGoals(STARTER_GOALS);
    if (!goalsAreEmpty(prev)) {
      toast("Loaded template goals", {
        description: "Your previous goals were replaced.",
        action: { label: "Undo", onClick: () => setGoals(prev) },
        duration: 6000,
      });
    }
  }

  function resetGoals() {
    if (goalsAreEmpty(goals)) return;
    const prev = goals;
    setGoals(EMPTY_GOALS);
    toast("Cleared all goals", {
      action: { label: "Undo", onClick: () => setGoals(prev) },
      duration: 6000,
    });
  }

  function renderCellTextarea(key: GoalCellKey, prompt: string, rows: number) {
    return (
      <textarea
        value={goals[key]}
        onChange={(event) => setGoals((current) => ({ ...current, [key]: event.target.value }))}
        placeholder={prompt}
        rows={rows}
        className="w-full flex-1 resize-none border-0 bg-transparent p-0 text-sm leading-[1.45] text-foreground placeholder:text-[var(--muted-soft)] focus:outline-none focus:ring-0"
      />
    );
  }

  function renderBreakLink(horizonLabel: string, areaLabel: string, key: GoalCellKey) {
    if (!goals[key].trim()) return null;
    return (
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          breakGoalIntoTasks(horizonLabel, areaLabel, goals[key]);
        }}
        title="Send this goal to the AI assistant to break into tasks"
        className="mt-3 self-start text-xs text-muted transition-colors hover:text-[var(--teal)]"
      >
        → break into tasks
      </button>
    );
  }

  return (
    <section className={cn("flex flex-col gap-6", className)}>
      {/* ── Daybook header ─────────────────────────────────────────── */}
      {standalone ? (
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--teal)]">
            Direction setting
          </p>
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h1 className="mt-1.5 font-display text-[32px] leading-[1.05] text-foreground md:text-[52px]">
              Where this is all going.
            </h1>
            <p className="shrink-0 text-sm text-muted">
              {filledCount} of 9 set · {statusLabel}
            </p>
          </div>
        </header>
      ) : (
        <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className="font-display text-[22px] text-foreground">Goal horizons</h2>
          <p className="shrink-0 text-sm text-muted">
            {filledCount} of 9 set · {statusLabel}
          </p>
        </header>
      )}

      {/* ── Editorial hairline table (desktop) ─────────────────────── */}
      <div className="hidden border-t border-[var(--hairline)] lg:grid lg:grid-cols-[110px_repeat(3,minmax(0,1fr))]">
        {/* column headers */}
        <div className="py-4" />
        {AREAS.map((area) => (
          <div key={area.key} className="border-l border-[var(--hairline-soft)] py-4 pl-5 pr-4">
            <p
              className={cn(
                "text-[11px] font-semibold uppercase tracking-[0.08em]",
                area.colorClass
              )}
            >
              {area.label}
            </p>
            <p className="mt-0.5 text-xs text-[var(--muted-soft)]">{area.micro}</p>
          </div>
        ))}

        {HORIZONS.map((horizon) => (
          <div key={horizon.key} className="contents">
            <div className="border-t border-[var(--hairline)] py-5 pr-4">
              <p className="font-display text-[19px] italic leading-tight text-foreground">
                {horizon.label}
              </p>
              <p className="mt-0.5 text-xs text-[var(--muted-soft)]">{horizon.range}</p>
            </div>
            {AREAS.map((area) => {
              const key = cellKey(horizon.key, area.key);
              return (
                <label
                  key={key}
                  className="flex min-h-[150px] flex-col border-l border-t border-[var(--hairline)] border-l-[var(--hairline-soft)] p-5"
                >
                  <span className="sr-only">
                    {horizon.label} {area.label} goal
                  </span>
                  {renderCellTextarea(key, area.prompt, 5)}
                  {renderBreakLink(horizon.label, area.label, key)}
                </label>
              );
            })}
          </div>
        ))}
      </div>

      {/* ── Stacked matrix (mobile / tablet) ───────────────────────── */}
      <div className="flex flex-col lg:hidden">
        {HORIZONS.map((horizon) => (
          <section key={horizon.key} className="border-t border-[var(--hairline)] py-4">
            <p className="font-display text-[19px] italic leading-tight text-foreground">
              {horizon.label}
            </p>
            <p className="mt-0.5 text-xs text-[var(--muted-soft)]">{horizon.range}</p>
            <div className="mt-3 flex flex-col">
              {AREAS.map((area, index) => {
                const key = cellKey(horizon.key, area.key);
                return (
                  <label
                    key={key}
                    className={cn(
                      "flex flex-col py-4",
                      index > 0 && "border-t border-[var(--hairline-soft)]"
                    )}
                  >
                    <span
                      className={cn(
                        "text-[11px] font-semibold uppercase tracking-[0.08em]",
                        area.colorClass
                      )}
                    >
                      {area.label}
                    </span>
                    <div className="mt-2 flex flex-col">
                      {renderCellTextarea(key, area.prompt, 3)}
                      {renderBreakLink(horizon.label, area.label, key)}
                    </div>
                  </label>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* ── Quiet actions row ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-[var(--hairline)] pt-4">
        <label className="flex items-center gap-2 text-[13px] text-muted">
          Owner
          <input
            value={ownerDraft}
            onChange={(event) => setOwnerDraft(event.target.value)}
            placeholder="Name"
            className="w-36 border-b border-[var(--hairline)] bg-transparent pb-0.5 text-[13px] text-foreground placeholder:text-[var(--muted-soft)] focus:border-[var(--teal)] focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={loadStarterGoals}
          title="Fill the matrix with editable starter examples"
          className="text-[13px] text-[var(--teal)] hover:underline"
        >
          Load template
        </button>
        <button
          type="button"
          onClick={() => void copyMarkdown()}
          title="Copy the matrix as markdown"
          className="text-[13px] text-[var(--teal)] hover:underline"
        >
          {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy Markdown"}
        </button>
        <button
          type="button"
          onClick={downloadMarkdown}
          title="Download the matrix as markdown"
          className="text-[13px] text-[var(--teal)] hover:underline"
        >
          Export .md
        </button>
        <button
          type="button"
          onClick={resetGoals}
          title="Clears every goal in the matrix (undoable for 6 seconds)"
          className="text-[13px] text-muted hover:underline"
        >
          Clear all
        </button>
      </div>

      <p className="text-[13px] text-muted">
        Weekly win conditions on Today should ladder up to these. Export as Markdown from Settings.
      </p>
    </section>
  );
}
