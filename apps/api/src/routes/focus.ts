import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client.js";
import { tasks } from "../db/schema.js";
import type { AppEnv } from "../types.js";

export const focusRoutes = new Hono<AppEnv>()
  .get("/export", async (c) => {
    const userId = c.req.query("userId");
    if (!userId) {
      return c.json({ error: "userId query required" }, 400);
    }
    const today = new Date().toISOString().slice(0, 10);
    const rows = await db
      .select({
        title: tasks.title,
        estimatedMinutes: tasks.estimatedMinutes,
        areaId: tasks.areaId,
        priority: tasks.priority,
        id: tasks.id,
      })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.scheduledDate, today)));
    const tasksOut = rows.map((t) => ({
      id: t.id,
      title: t.title,
      estimatedPomodoros: Math.max(1, Math.ceil((t.estimatedMinutes ?? 25) / 25)),
      area: t.areaId,
      priority: t.priority,
    }));
    return c.json({ date: today, tasks: tasksOut });
  })
  .post("/import", async (c) => {
    return c.json({
      ok: true,
      imported: 0,
      message: "Stub: upload Focus CSV/JSON in a later iteration; sessions not applied yet.",
    });
  });
