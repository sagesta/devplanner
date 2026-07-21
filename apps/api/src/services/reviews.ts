import type { WeeklyReviewIntention } from "../db/schema.js";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function addDaysYmd(ymd: string, days: number): string {
  if (!YMD_RE.test(ymd)) throw new Error("date must use YYYY-MM-DD");
  const date = new Date(`${ymd}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("invalid date");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function reviewPeriodFromWeekStart(weekStart: string) {
  return {
    weekStart,
    weekEnd: addDaysYmd(weekStart, 6),
    sprintStart: addDaysYmd(weekStart, 7),
    sprintEnd: addDaysYmd(weekStart, 11),
  };
}

export function normalizeReviewIntentions(
  intentions: Array<{
    text: string;
    goalKey?: string | null;
    goalLabel?: string | null;
  }>
): WeeklyReviewIntention[] {
  return intentions
    .map((item) => ({
      text: item.text.trim(),
      goalKey: item.goalKey?.trim() || null,
      goalLabel: item.goalLabel?.trim() || null,
    }))
    .filter((item) => item.text)
    .slice(0, 3);
}

export function buildSprintGoal(
  intentions: WeeklyReviewIntention[],
  sprintNotes: string
): string | null {
  const cleanIntentions = normalizeReviewIntentions(intentions);
  const intentionLines = cleanIntentions.map((item, index) => {
    const goal = item.goalLabel ? ` [${item.goalLabel}]` : "";
    return `${index + 1}. ${item.text}${goal}`;
  });
  const notes = sprintNotes.trim();
  const sections = [
    intentionLines.length ? `Top intentions:\n${intentionLines.join("\n")}` : "",
    notes ? `Sprint notes:\n${notes}` : "",
  ].filter(Boolean);
  return sections.length ? sections.join("\n\n") : null;
}

export function sprintNameFromStart(startYmd: string): string {
  const date = new Date(`${startYmd}T12:00:00.000Z`);
  const label = date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return `Week of ${label}`;
}
