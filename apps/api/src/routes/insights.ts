import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { calculateDailyCapacity } from "../services/scheduler.js";
import type { AppEnv } from "../types.js";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function addDays(ymdValue: string, days: number): string {
  const d = new Date(`${ymdValue}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  let cursor = start;
  while (cursor <= end && out.length < 370) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

export const insightsRoutes = new Hono<AppEnv>().get("/activity", async (c) => {
  const userId = c.get("userId");

  // A relatively simple query to get sum of duration by hour of day
  // Requires joining with tasks to filter by userId
  const rows = await db.execute<{ hour: number; total_minutes: number }>(sql`
    SELECT 
      EXTRACT(HOUR FROM t.started_at) as hour,
      SUM(t.duration_seconds)/60 as total_minutes
    FROM task_time_logs t
    JOIN tasks tk ON tk.id = t.task_id
    WHERE tk.user_id = ${userId}
    GROUP BY hour
    ORDER BY hour ASC
  `);

  const heatmap = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    label: `${i}:00`,
    minutes: rows.rows.find((r) => Number(r.hour) === i)?.total_minutes || 0,
  }));

  // Identify peak hour
  let peakHour = 9;
  let maxMin = 0;
  for (const h of heatmap) {
    if (h.minutes > maxMin) {
      maxMin = h.minutes;
      peakHour = h.hour;
    }
  }

  // Load basic cognitive load summary 
  // (In a full implementation, we would tie this to daily check-ins)
  
  return c.json({
    activityHeatmap: heatmap,
    peakHourLabel: `${peakHour}:00 - ${peakHour + 1}:00`,
    recommendedDeepWork: [peakHour, peakHour + 1],
  });
}).get("/calendar-progress", async (c) => {
  const userId = c.get("userId");
  const startParsed = ymd.safeParse(c.req.query("start"));
  const endParsed = ymd.safeParse(c.req.query("end"));
  if (!startParsed.success || !endParsed.success) {
    return c.json({ error: "start and end are required YYYY-MM-DD dates" }, 422);
  }
  const start = startParsed.data;
  const end = endParsed.data;
  if (end < start) return c.json({ error: "end must be on or after start" }, 422);

  const days = eachDay(start, end);
  if (days.length > 370) return c.json({ error: "date range too large" }, 422);

  const rows = await db.execute<{
    date: string;
    planned_units: number;
    completed_units: number;
    planned_minutes: number;
    completed_minutes: number;
    overdue_units: number;
  }>(sql`
    WITH planned_subtasks AS (
      SELECT
        st.scheduled_date::date AS day,
        1 AS planned_unit,
        CASE WHEN st.completed THEN 1 ELSE 0 END AS completed_unit,
        COALESCE(st.estimated_minutes, 30) AS planned_minutes,
        CASE WHEN st.completed THEN COALESCE(st.estimated_minutes, 30) ELSE 0 END AS completed_minutes,
        CASE WHEN st.completed = false AND st.scheduled_date::date < CURRENT_DATE THEN 1 ELSE 0 END AS overdue_unit
      FROM subtasks st
      JOIN tasks t ON t.id = st.task_id
      WHERE t.user_id = ${userId}
        AND t.deleted_at IS NULL
        AND st.scheduled_date BETWEEN ${start} AND ${end}
    ),
    standalone_tasks AS (
      SELECT
        t.scheduled_date::date AS day,
        1 AS planned_unit,
        CASE WHEN t.status = 'done' THEN 1 ELSE 0 END AS completed_unit,
        30 AS planned_minutes,
        CASE WHEN t.status = 'done' THEN 30 ELSE 0 END AS completed_minutes,
        CASE WHEN t.status <> 'done' AND t.scheduled_date::date < CURRENT_DATE THEN 1 ELSE 0 END AS overdue_unit
      FROM tasks t
      WHERE t.user_id = ${userId}
        AND t.deleted_at IS NULL
        AND t.scheduled_date BETWEEN ${start} AND ${end}
        AND NOT EXISTS (SELECT 1 FROM subtasks st WHERE st.task_id = t.id)
    ),
    units AS (
      SELECT * FROM planned_subtasks
      UNION ALL
      SELECT * FROM standalone_tasks
    )
    SELECT
      day::text AS date,
      SUM(planned_unit)::int AS planned_units,
      SUM(completed_unit)::int AS completed_units,
      SUM(planned_minutes)::int AS planned_minutes,
      SUM(completed_minutes)::int AS completed_minutes,
      SUM(overdue_unit)::int AS overdue_units
    FROM units
    GROUP BY day
    ORDER BY day ASC
  `);

  const byDate = new Map(rows.rows.map((row) => [row.date, row]));
  const dailyCapacity = await calculateDailyCapacity(db, userId);
  const progress = days.map((date) => {
    const row = byDate.get(date);
    const plannedUnits = Number(row?.planned_units ?? 0);
    const completedUnits = Number(row?.completed_units ?? 0);
    const plannedMinutes = Number(row?.planned_minutes ?? 0);
    const percent = plannedUnits > 0 ? Math.round((completedUnits / plannedUnits) * 100) : 0;
    return {
      date,
      plannedUnits,
      completedUnits,
      plannedMinutes,
      completedMinutes: Number(row?.completed_minutes ?? 0),
      overdueUnits: Number(row?.overdue_units ?? 0),
      percent,
      status:
        plannedUnits === 0
          ? "empty"
          : percent === 100
            ? "complete"
            : Number(row?.overdue_units ?? 0) > 0
              ? "missed"
              : plannedMinutes > dailyCapacity
                ? "overload"
                : "planned",
    };
  });

  return c.json({ start, end, dailyCapacity, days: progress });
});
