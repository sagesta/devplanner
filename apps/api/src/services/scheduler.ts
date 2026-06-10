import { and, asc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { subtasks, tasks, users } from "../db/schema.js";

/**
 * Calculate capacity in minutes for a given user.
 *
 * Behavior-aware: the configured capacity (prefs) is blended with what the
 * user actually completes per active day over the last 28 days, so the
 * target tracks reality instead of wishful settings. The observed signal
 * only kicks in after 5+ active days and is clamped to ±50% of the
 * configured value so one outlier week can't whipsaw the schedule.
 */
export async function calculateDailyCapacity(db: any, userId: string): Promise<number> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return 0;
  // configured = dailyCapacityMinutes * efficiencyFactor * (1 - bufferFactor)
  const baseMinutes = user.dailyCapacityMinutes ?? 240;
  const eff = user.efficiencyFactor ?? 0.8;
  const buffer = user.bufferFactor ?? 0.2;
  const configured = Math.floor(baseMinutes * eff * (1 - buffer));

  const observed = await getObservedDailyMinutes(db, userId);
  if (observed == null) return configured;

  const blended = Math.round(configured * 0.6 + observed * 0.4);
  const lower = Math.floor(configured * 0.5);
  const upper = Math.ceil(configured * 1.5);
  return Math.max(lower, Math.min(upper, blended));
}

/**
 * Median completed minutes per active day over the last 28 days
 * (completed subtasks + standalone done tasks, estimates defaulting to 30m).
 * Returns null when there are fewer than 5 active days of history.
 */
export async function getObservedDailyMinutes(db: any, userId: string): Promise<number | null> {
  const result = (await db.execute(sql`
    WITH done_units AS (
      SELECT st.completed_at::date AS day, COALESCE(st.estimated_minutes, 30) AS minutes
      FROM subtasks st
      JOIN tasks tk ON tk.id = st.task_id
      WHERE tk.user_id = ${userId}
        AND tk.deleted_at IS NULL
        AND st.completed_at IS NOT NULL
        AND st.completed_at > NOW() - INTERVAL '28 days'
      UNION ALL
      SELECT tk.completed_at::date AS day, 30 AS minutes
      FROM tasks tk
      LEFT JOIN subtasks st ON st.task_id = tk.id
      WHERE tk.user_id = ${userId}
        AND tk.deleted_at IS NULL
        AND tk.completed_at IS NOT NULL
        AND tk.completed_at > NOW() - INTERVAL '28 days'
        AND st.id IS NULL
    ),
    per_day AS (
      SELECT day, SUM(minutes)::float AS total FROM done_units GROUP BY day
    )
    SELECT
      COUNT(*)::int AS active_days,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total) AS median_minutes
    FROM per_day
  `)) as { rows: Array<{ active_days: number; median_minutes: number | null }> };

  const row = result.rows[0];
  if (!row || Number(row.active_days) < 5 || row.median_minutes == null) return null;
  return Math.round(Number(row.median_minutes));
}

function getPriorityScore(priority: string | null): number {
  if (priority === "urgent") return 4;
  if (priority === "high") return 3;
  if (priority === "normal") return 2;
  return 1;
}

export async function runAutoScheduler(db: any, userId: string, dateIso: string) {
  // Find all active tasks assigned to this date
  const todayTasks = await db.query.tasks.findMany({
    where: and(
      eq(tasks.userId, userId),
      isNull(tasks.deletedAt),
      eq(tasks.scheduledDate, dateIso),
      ne(tasks.status, "done")
    )
  });

  if (todayTasks.length === 0) return { displaced: 0, dailyCapacity: 0 };

  const dailyCapacity = await calculateDailyCapacity(db, userId);
  let usedMinutes = 0;

  // Sort tasks by priority descending (urgent first), then by status (in_progress first)
  const sorted = [...todayTasks].sort((a, b) => {
    if (a.status === "in_progress" && b.status !== "in_progress") return -1;
    if (b.status === "in_progress" && a.status !== "in_progress") return 1;
    
    const pA = getPriorityScore(a.priority);
    const pB = getPriorityScore(b.priority);
    return pB - pA;
  });

  const displacedTaskIds: string[] = [];
  const scheduledTaskIds: string[] = [];

  for (const t of sorted) {
    const mins = (t as any).estimatedMinutes || 30; // Default 30 min assumed
    if (usedMinutes + mins > dailyCapacity) {
      // Cannot fit this task, displacement begins
      if (t.status === "in_progress" || t.priority === "urgent") {
         // Anchor in-progress and urgent absolute Must-Do P0 tasks, force fit even over capacity!
         usedMinutes += mins;
         scheduledTaskIds.push(t.id);
      } else {
         displacedTaskIds.push(t.id);
      }
    } else {
      usedMinutes += mins;
      scheduledTaskIds.push(t.id);
    }
  }

  // Handle displaced tasks: move to tomorrow, increment rescheduleCount.
  // If rescheduleCount > 3, put in needs_rescheduling
  let overflowCount = 0;
  for (const id of displacedTaskIds) {
    const t = todayTasks.find((x: any) => x.id === id)!;
    const nextCount = (t.rescheduleCount || 0) + 1;
    
    const tomorrow = new Date(dateIso);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0]!;

    const state = nextCount > 3 ? "needs_rescheduling" : "overflow";

    await db.update(tasks)
      .set({
        scheduledDate: tomorrowStr,
        rescheduleCount: nextCount,
        schedulingState: state,
        isAutoScheduled: true,
      })
      .where(eq(tasks.id, id));
    
    overflowCount++;
  }

  return { dailyCapacity, scheduled: scheduledTaskIds, displaced: overflowCount, usedMinutes };
}

export type ScheduleProposal = {
  id: string;
  targetType: "task" | "subtask";
  targetId: string;
  title: string;
  fromDate: string;
  toDate: string;
  estimatedMinutes: number;
  priority: string;
  workDepth: string | null;
  physicalEnergy: string | null;
  reason: string;
  risk: "low" | "medium" | "high";
};

export type ScheduleLearningSummary = {
  dailyCapacity: number;
  peakHour: number | null;
  deepWorkHours: number[];
  observedCompletionCount: number;
};

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toYmd(d);
}

function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let cursor = start;
  while (cursor <= end && out.length < 370) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

function estimateMinutes(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 480) : 30;
}

function scheduleScore(item: {
  priority: string;
  workDepth: string | null;
  physicalEnergy: string | null;
  rescheduleCount?: number | null;
}) {
  const depthScore = item.workDepth === "deep" ? 2 : item.workDepth === "normal" ? 1 : 0;
  const physicalScore = item.physicalEnergy === "high" ? 2 : item.physicalEnergy === "medium" ? 1 : 0;
  return (
    getPriorityScore(item.priority) * 100 +
    depthScore * 10 +
    physicalScore * 4 -
    (item.rescheduleCount ?? 0) * 2
  );
}

export async function getScheduleLearningSummary(db: any, userId: string): Promise<ScheduleLearningSummary> {
  const dailyCapacity = await calculateDailyCapacity(db, userId);

  const rows = (await db.execute(sql`
    SELECT
      EXTRACT(HOUR FROM COALESCE(st.completed_at, tl.ended_at, tl.started_at))::int AS hour,
      COALESCE(SUM(tl.duration_seconds) / 60, 0)::float AS total_minutes,
      COUNT(st.id)::int AS completions
    FROM tasks tk
    LEFT JOIN subtasks st ON st.task_id = tk.id AND st.completed_at IS NOT NULL
    LEFT JOIN task_time_logs tl ON tl.task_id = tk.id AND tl.ended_at IS NOT NULL
    WHERE tk.user_id = ${userId}
      AND tk.deleted_at IS NULL
      AND COALESCE(st.completed_at, tl.ended_at, tl.started_at) IS NOT NULL
      AND COALESCE(st.completed_at, tl.ended_at, tl.started_at) > NOW() - INTERVAL '90 days'
    GROUP BY hour
    ORDER BY hour ASC
  `)) as { rows: Array<{ hour: number; total_minutes: number; completions: number }> };

  let peakHour: number | null = null;
  let peakScore = -1;
  for (const row of rows.rows) {
    const score = Number(row.total_minutes ?? 0) + Number(row.completions ?? 0) * 15;
    if (score > peakScore) {
      peakScore = score;
      peakHour = Number(row.hour);
    }
  }

  return {
    dailyCapacity,
    peakHour,
    deepWorkHours: peakHour == null ? [] : [peakHour, Math.min(23, peakHour + 1)],
    observedCompletionCount: rows.rows.reduce(
      (sum: number, row: { completions: number }) => sum + Number(row.completions ?? 0),
      0
    ),
  };
}

export async function buildSchedulePreview(
  db: any,
  userId: string,
  opts: { fromDate: string; horizonEnd: string }
): Promise<{ proposals: ScheduleProposal[]; learning: ScheduleLearningSummary }> {
  const learning = await getScheduleLearningSummary(db, userId);
  const days = daysBetween(opts.fromDate, opts.horizonEnd);
  const dayLoad = new Map(days.map((day) => [day, 0]));

  const futureSubtasks = await db
    .select({
      id: subtasks.id,
      scheduledDate: subtasks.scheduledDate,
      estimatedMinutes: subtasks.estimatedMinutes,
    })
    .from(subtasks)
    .innerJoin(tasks, eq(tasks.id, subtasks.taskId))
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        eq(subtasks.completed, false),
        or(
          eq(subtasks.scheduledDate, opts.fromDate),
          sql`${subtasks.scheduledDate} > ${opts.fromDate} AND ${subtasks.scheduledDate} <= ${opts.horizonEnd}`
        )
      )
    );

  for (const item of futureSubtasks) {
    if (!item.scheduledDate || !dayLoad.has(item.scheduledDate)) continue;
    dayLoad.set(item.scheduledDate, (dayLoad.get(item.scheduledDate) ?? 0) + estimateMinutes(item.estimatedMinutes));
  }

  const futureTasks = await db
    .select({
      id: tasks.id,
      scheduledDate: tasks.scheduledDate,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        ne(tasks.status, "done"),
        or(
          eq(tasks.scheduledDate, opts.fromDate),
          sql`${tasks.scheduledDate} > ${opts.fromDate} AND ${tasks.scheduledDate} <= ${opts.horizonEnd}`
        ),
        sql`NOT EXISTS (SELECT 1 FROM subtasks st WHERE st.task_id = ${tasks.id})`
      )
    );

  for (const item of futureTasks) {
    if (!item.scheduledDate || !dayLoad.has(item.scheduledDate)) continue;
    dayLoad.set(item.scheduledDate, (dayLoad.get(item.scheduledDate) ?? 0) + 30);
  }

  const unfinishedSubtasks = await db
    .select({
      id: subtasks.id,
      taskId: subtasks.taskId,
      title: subtasks.title,
      scheduledDate: subtasks.scheduledDate,
      estimatedMinutes: subtasks.estimatedMinutes,
      parentTitle: tasks.title,
      priority: tasks.priority,
      workDepth: tasks.workDepth,
      physicalEnergy: tasks.physicalEnergy,
      rescheduleCount: tasks.rescheduleCount,
    })
    .from(subtasks)
    .innerJoin(tasks, eq(tasks.id, subtasks.taskId))
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        eq(subtasks.completed, false),
        lt(subtasks.scheduledDate, opts.fromDate)
      )
    )
    .orderBy(asc(subtasks.scheduledDate), asc(subtasks.createdAt));

  const unfinishedTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      scheduledDate: tasks.scheduledDate,
      priority: tasks.priority,
      workDepth: tasks.workDepth,
      physicalEnergy: tasks.physicalEnergy,
      rescheduleCount: tasks.rescheduleCount,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        ne(tasks.status, "done"),
        lt(tasks.scheduledDate, opts.fromDate),
        sql`NOT EXISTS (SELECT 1 FROM subtasks st WHERE st.task_id = ${tasks.id})`
      )
    )
    .orderBy(asc(tasks.scheduledDate), asc(tasks.createdAt));

  const candidates = [
    ...unfinishedSubtasks.map((s: {
      id: string;
      title: string;
      scheduledDate: string | null;
      estimatedMinutes: number | null;
      priority: string;
      workDepth: string | null;
      physicalEnergy: string | null;
      rescheduleCount: number | null;
    }) => ({
      targetType: "subtask" as const,
      targetId: s.id,
      title: s.title,
      fromDate: s.scheduledDate!,
      estimatedMinutes: estimateMinutes(s.estimatedMinutes),
      priority: s.priority,
      workDepth: s.workDepth,
      physicalEnergy: s.physicalEnergy,
      rescheduleCount: s.rescheduleCount,
    })),
    ...unfinishedTasks.map((t: {
      id: string;
      title: string;
      scheduledDate: string | null;
      priority: string;
      workDepth: string | null;
      physicalEnergy: string | null;
      rescheduleCount: number | null;
    }) => ({
      targetType: "task" as const,
      targetId: t.id,
      title: t.title,
      fromDate: t.scheduledDate!,
      estimatedMinutes: 30,
      priority: t.priority,
      workDepth: t.workDepth,
      physicalEnergy: t.physicalEnergy,
      rescheduleCount: t.rescheduleCount,
    })),
  ].sort((a, b) => scheduleScore(b) - scheduleScore(a));

  const proposals: ScheduleProposal[] = [];
  for (const item of candidates) {
    let pickedDay = days[0] ?? opts.fromDate;
    let bestLoad = Number.POSITIVE_INFINITY;
    for (const day of days) {
      const load = dayLoad.get(day) ?? 0;
      if (load + item.estimatedMinutes <= learning.dailyCapacity) {
        pickedDay = day;
        bestLoad = load;
        break;
      }
      if (load < bestLoad) {
        bestLoad = load;
        pickedDay = day;
      }
    }

    dayLoad.set(pickedDay, (dayLoad.get(pickedDay) ?? 0) + item.estimatedMinutes);
    const overCapacity = (dayLoad.get(pickedDay) ?? 0) > learning.dailyCapacity;
    const preferredWindow =
      item.workDepth === "deep" && learning.peakHour != null
        ? ` near your usual deep-work window around ${learning.peakHour}:00`
        : "";

    proposals.push({
      id: `${item.targetType}:${item.targetId}:${item.fromDate}:${pickedDay}`,
      targetType: item.targetType,
      targetId: item.targetId,
      title: item.title,
      fromDate: item.fromDate,
      toDate: pickedDay,
      estimatedMinutes: item.estimatedMinutes,
      priority: item.priority,
      workDepth: item.workDepth,
      physicalEnergy: item.physicalEnergy,
      reason: overCapacity
        ? "No fully open day remains, so this is placed on the least-loaded day for review."
        : `Moved unfinished work into available capacity${preferredWindow}.`,
      risk: item.priority === "urgent" || overCapacity ? "high" : item.priority === "high" ? "medium" : "low",
    });
  }

  return { proposals, learning };
}

export async function applyScheduleProposals(
  db: any,
  userId: string,
  proposals: ScheduleProposal[]
): Promise<{ applied: number; skipped: number }> {
  let applied = 0;
  let skipped = 0;
  const taskIds = proposals.filter((p) => p.targetType === "task").map((p) => p.targetId);
  const subtaskIds = proposals.filter((p) => p.targetType === "subtask").map((p) => p.targetId);

  const ownedTasks = taskIds.length
    ? await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.userId, userId), isNull(tasks.deletedAt), inArray(tasks.id, taskIds)))
    : [];
  const ownedTaskIds = new Set(ownedTasks.map((t: { id: string }) => t.id));

  const ownedSubs = subtaskIds.length
    ? await db
        .select({ id: subtasks.id })
        .from(subtasks)
        .innerJoin(tasks, eq(tasks.id, subtasks.taskId))
        .where(and(eq(tasks.userId, userId), isNull(tasks.deletedAt), inArray(subtasks.id, subtaskIds)))
    : [];
  const ownedSubIds = new Set(ownedSubs.map((s: { id: string }) => s.id));

  for (const proposal of proposals) {
    if (proposal.targetType === "task") {
      if (!ownedTaskIds.has(proposal.targetId)) {
        skipped++;
        continue;
      }
      await db
        .update(tasks)
        .set({
          scheduledDate: proposal.toDate,
          rescheduleCount: sql`${tasks.rescheduleCount} + 1`,
          schedulingState: "scheduled",
          isAutoScheduled: true,
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.id, proposal.targetId), eq(tasks.userId, userId), isNull(tasks.deletedAt)));
      applied++;
      continue;
    }

    if (!ownedSubIds.has(proposal.targetId)) {
      skipped++;
      continue;
    }
    await db.update(subtasks).set({ scheduledDate: proposal.toDate }).where(eq(subtasks.id, proposal.targetId));
    applied++;
  }

  return { applied, skipped };
}
