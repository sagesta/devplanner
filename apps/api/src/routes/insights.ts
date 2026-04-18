import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client.js";
import type { AppEnv } from "../types.js";

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
});
