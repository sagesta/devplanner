import { and, eq, isNull } from "drizzle-orm";
import rrulePkg from "rrule";
import { tasks } from "../db/schema.js";
import { generateAndStoreEmbedding, buildEmbeddingText } from "../ai/embeddings.js";
import { enqueueTaskCalendarSync } from "../queues/definitions.js";
import { logger } from "../lib/logger.js";

// rrule ships as CJS without named-export detection; destructure from default.
const { RRule } = rrulePkg;

type Db = typeof import("../db/client.js").db;
type TaskRow = typeof tasks.$inferSelect;

function ymdToUtcDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function utcDateToYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Next occurrence strictly after max(anchor, today), as YYYY-MM-DD.
 * Using "after today" (not just "after anchor") means completing an overdue
 * daily task late spawns one instance for tomorrow instead of a backlog of
 * stale past-due copies. Returns null when the rule is exhausted (UNTIL) or
 * unparseable.
 */
export function nextOccurrenceYmd(rule: string, anchorYmd: string, todayYmd: string): string | null {
  try {
    const cleaned = rule.replace(/^RRULE:/i, "").trim();
    if (!cleaned) return null;
    const opts = RRule.parseString(cleaned);
    opts.dtstart = ymdToUtcDate(anchorYmd);
    // COUNT can't be honored without tracking instance numbers across spawns;
    // drop it rather than miscount from a moving dtstart.
    if (opts.count != null) delete opts.count;
    const r = new RRule(opts);
    const floor = anchorYmd >= todayYmd ? ymdToUtcDate(anchorYmd) : ymdToUtcDate(todayYmd);
    const next = r.after(floor, false);
    return next ? utcDateToYmd(next) : null;
  } catch (err) {
    logger.warn({ err, rule }, "recurrence: failed to parse rule, skipping respawn");
    return null;
  }
}

/**
 * Called when a recurring task transitions to done: inserts a fresh copy of
 * the task scheduled at the rule's next occurrence. The completed row keeps
 * its history; the clone gets new calendar identity (synced as a new event).
 * Idempotent-ish: skips if an open clone with the same title/rule/date
 * already exists.
 */
export async function spawnNextRecurrence(db: Db, task: TaskRow, todayYmd: string): Promise<TaskRow | null> {
  const rule = task.recurrenceRule?.trim();
  if (!rule) return null;

  const anchor = task.scheduledDate ?? task.dueDate ?? todayYmd;
  const nextYmd = nextOccurrenceYmd(rule, anchor, todayYmd);
  if (!nextYmd) return null;

  const dup = await db.query.tasks.findFirst({
    where: and(
      eq(tasks.userId, task.userId),
      eq(tasks.title, task.title),
      eq(tasks.recurrenceRule, rule),
      task.scheduledDate != null ? eq(tasks.scheduledDate, nextYmd) : eq(tasks.dueDate, nextYmd),
      isNull(tasks.deletedAt),
      isNull(tasks.completedAt)
    ),
  });
  if (dup) return null;

  const [clone] = await db
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
      recurrenceRule: rule,
      tags: task.tags,
      sortOrder: task.sortOrder,
      scheduledDate: task.scheduledDate != null ? nextYmd : null,
      dueDate: task.dueDate != null ? nextYmd : task.scheduledDate != null ? null : nextYmd,
    })
    .returning();

  await enqueueTaskCalendarSync({
    userId: clone.userId,
    taskId: clone.id,
    caldavUid: clone.caldavUid,
    resourceFilename: clone.caldavResourceFilename,
    googleEventId: clone.googleEventId,
    action: "create",
  }).catch((err) => logger.error({ err, taskId: clone.id }, "recurrence: calendar sync enqueue failed"));
  generateAndStoreEmbedding(clone.id, buildEmbeddingText(clone.title, clone.description)).catch((err) =>
    logger.warn({ err, taskId: clone.id }, "recurrence: embedding generation failed")
  );

  logger.info({ taskId: task.id, cloneId: clone.id, nextYmd }, "recurrence: spawned next instance");
  return clone;
}
