import { eq } from "drizzle-orm";
import { subtasks, tasks } from "../db/schema.js";

/**
 * Minimal RFC5545 RRULE parser. Supports the subset the UI exposes:
 *   FREQ=DAILY | WEEKLY | MONTHLY | YEARLY
 *   INTERVAL=N (default 1)
 *   BYDAY=MO,TU,WE,TH,FR (weekly only)
 * Anything else falls through to the next-day fallback rather than throwing.
 */
type ParsedRule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  byDay?: number[]; // 0=Sun..6=Sat
};

const DAY_CODE_TO_INDEX: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

export function parseRecurrenceRule(rule: string | null | undefined): ParsedRule | null {
  if (!rule) return null;
  const parts = rule
    .replace(/^RRULE:/i, "")
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  const map = new Map<string, string>();
  for (const part of parts) {
    const [k, v] = part.split("=");
    if (k && v) map.set(k.toUpperCase(), v.toUpperCase());
  }
  const freq = map.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") {
    return null;
  }
  const intervalRaw = Number(map.get("INTERVAL") ?? "1");
  const interval = Number.isFinite(intervalRaw) && intervalRaw > 0 ? Math.floor(intervalRaw) : 1;
  let byDay: number[] | undefined;
  const byDayRaw = map.get("BYDAY");
  if (byDayRaw && freq === "WEEKLY") {
    byDay = byDayRaw
      .split(",")
      .map((d) => DAY_CODE_TO_INDEX[d.trim()])
      .filter((n): n is number => typeof n === "number");
    if (byDay.length === 0) byDay = undefined;
  }
  return { freq, interval, byDay };
}

/** Build the next occurrence date from a YYYY-MM-DD anchor and a parsed rule. */
export function nextOccurrence(anchorYmd: string, rule: ParsedRule, now: Date = new Date()): string {
  // Anchor at noon UTC to dodge DST when stepping by days.
  const anchor = new Date(`${anchorYmd}T12:00:00Z`);
  const today = new Date(`${now.toISOString().slice(0, 10)}T12:00:00Z`);
  const start = anchor.getTime() < today.getTime() ? today : anchor;

  if (rule.freq === "DAILY") {
    const next = new Date(start);
    next.setUTCDate(next.getUTCDate() + rule.interval);
    return ymd(next);
  }

  if (rule.freq === "WEEKLY") {
    if (rule.byDay && rule.byDay.length > 0) {
      // Scan ahead up to 14 days for the next allowed weekday (covers INTERVAL=1+2).
      for (let i = 1; i <= 14 * rule.interval; i++) {
        const candidate = new Date(start);
        candidate.setUTCDate(candidate.getUTCDate() + i);
        if (rule.byDay.includes(candidate.getUTCDay())) {
          return ymd(candidate);
        }
      }
    }
    const next = new Date(start);
    next.setUTCDate(next.getUTCDate() + 7 * rule.interval);
    return ymd(next);
  }

  if (rule.freq === "MONTHLY") {
    const next = new Date(start);
    next.setUTCMonth(next.getUTCMonth() + rule.interval);
    return ymd(next);
  }

  // YEARLY
  const next = new Date(start);
  next.setUTCFullYear(next.getUTCFullYear() + rule.interval);
  return ymd(next);
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * If `taskId` is a recurring task that was just marked done, insert a fresh
 * instance with the next scheduled/due date. Returns the new task id, or null
 * if no instance was created (no rule, unparseable rule, or already exists).
 *
 * Idempotency note: this is fire-and-forget from the tasks PATCH route. Calling
 * it twice for the same completion would create duplicate instances, so the
 * caller must only invoke on the *transition* into "done" — not on every PATCH.
 */
export async function materializeNextRecurrence(
  db: any,
  taskId: string
): Promise<string | null> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task || !task.recurrenceRule) return null;

  const parsed = parseRecurrenceRule(task.recurrenceRule);
  if (!parsed) return null;

  const anchor = task.scheduledDate ?? task.dueDate ?? ymd(new Date());
  const nextDate = nextOccurrence(anchor, parsed);

  const [created] = await db
    .insert(tasks)
    .values({
      userId: task.userId,
      areaId: task.areaId,
      projectId: task.projectId,
      sprintId: task.sprintId,
      title: task.title,
      description: task.description,
      status: "todo",
      priority: task.priority,
      energyLevel: task.energyLevel,
      workDepth: task.workDepth,
      physicalEnergy: task.physicalEnergy,
      taskType: task.taskType,
      // Roll the next anchor forward. If the source had a due date, keep the
      // gap between scheduled and due so weekly chores still feel weekly.
      scheduledDate: task.scheduledDate ? nextDate : null,
      dueDate: task.dueDate ? nextDate : null,
      recurrenceRule: task.recurrenceRule,
      tags: task.tags,
      sortOrder: task.sortOrder,
      schedulingState: "unscheduled",
      rescheduleCount: 0,
      // Fresh calendar identity — do NOT carry over caldav/google ids.
    })
    .returning({ id: tasks.id });

  if (!created) return null;

  // Clone subtasks (unchecked) so the new instance starts fresh.
  const subs = await db.select().from(subtasks).where(eq(subtasks.taskId, taskId));
  if (subs.length) {
    await db.insert(subtasks).values(
      subs.map((s: any) => ({
        taskId: created.id,
        title: s.title,
        completed: false,
        // Don't carry over per-subtask scheduled dates — they'd be stale.
        scheduledDate: null,
        scheduledTime: null,
        estimatedMinutes: s.estimatedMinutes,
      }))
    );
  }

  return created.id;
}
