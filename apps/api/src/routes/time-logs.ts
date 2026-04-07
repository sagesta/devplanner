import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { areas, taskTimeLogs, tasks } from "../db/schema.js";
import type { AppEnv } from "../types.js";

const startBody = z.object({
  task_id: z.string().uuid(),
});

export const timeLogRoutes = new Hono<AppEnv>()
  // POST /start — start a timer (auto-stop any active timer first)
  .post("/start", async (c) => {
    const parsed = startBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const userId = c.get("userId");
    const taskId = parsed.data.task_id;

    // Verify task belongs to user
    const taskRow = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
      .limit(1);
    if (!taskRow.length) {
      return c.json({ error: "task not found" }, 404);
    }

    // Auto-stop any currently running timer
    const activeRows = await db
      .select({ id: taskTimeLogs.id })
      .from(taskTimeLogs)
      .innerJoin(tasks, eq(tasks.id, taskTimeLogs.taskId))
      .where(and(eq(tasks.userId, userId), isNull(taskTimeLogs.endedAt)));

    if (activeRows.length > 0) {
      await db
        .update(taskTimeLogs)
        .set({ endedAt: new Date() })
        .where(
          and(
            eq(taskTimeLogs.id, activeRows[0].id),
            isNull(taskTimeLogs.endedAt)
          )
        );
    }

    // Insert new log
    const [row] = await db
      .insert(taskTimeLogs)
      .values({
        taskId,
        startedAt: new Date(),
        endedAt: null,
      })
      .returning();

    return c.json({ log: row }, 201);
  })

  // PATCH /:id/stop — stop a timer
  .patch("/:id/stop", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id) || id <= 0) {
      return c.json({ error: "invalid id" }, 400);
    }
    const userId = c.get("userId");

    // Verify the log belongs to user's task
    const logRows = await db
      .select({
        logId: taskTimeLogs.id,
        taskUserId: tasks.userId,
      })
      .from(taskTimeLogs)
      .innerJoin(tasks, eq(tasks.id, taskTimeLogs.taskId))
      .where(and(eq(taskTimeLogs.id, id), isNull(taskTimeLogs.endedAt)));

    if (!logRows.length || logRows[0].taskUserId !== userId) {
      return c.json({ error: "not found" }, 404);
    }

    const [row] = await db
      .update(taskTimeLogs)
      .set({ endedAt: new Date() })
      .where(and(eq(taskTimeLogs.id, id), isNull(taskTimeLogs.endedAt)))
      .returning();

    return c.json({ log: row });
  })

  // ── IMPORTANT: /active and /summary/week MUST be before GET / ──

  // GET /active — currently active timer
  .get("/active", async (c) => {
    const userId = c.get("userId");

    const rows = await db
      .select({
        id: taskTimeLogs.id,
        taskId: taskTimeLogs.taskId,
        startedAt: taskTimeLogs.startedAt,
        endedAt: taskTimeLogs.endedAt,
        durationSeconds: taskTimeLogs.durationSeconds,
        note: taskTimeLogs.note,
        createdAt: taskTimeLogs.createdAt,
        taskTitle: tasks.title,
      })
      .from(taskTimeLogs)
      .innerJoin(tasks, eq(tasks.id, taskTimeLogs.taskId))
      .where(and(eq(tasks.userId, userId), isNull(taskTimeLogs.endedAt)))
      .limit(1);

    if (!rows.length) {
      return c.json({ log: null });
    }

    return c.json({ log: rows[0] });
  })

  // GET /summary/week — weekly time summary grouped by area
  .get("/summary/week", async (c) => {
    const weekStart = c.req.query("week_start");
    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return c.json({ error: "week_start (YYYY-MM-DD) query param required" }, 422);
    }
    const userId = c.get("userId");

    const rows = await db
      .select({
        taskId: tasks.id,
        taskTitle: tasks.title,
        areaId: areas.id,
        areaName: areas.name,
        weeklyHourTarget: areas.weeklyHourTarget,
        totalSeconds: sql<number>`COALESCE(SUM(${taskTimeLogs.durationSeconds}), 0)::int`,
      })
      .from(taskTimeLogs)
      .innerJoin(tasks, eq(tasks.id, taskTimeLogs.taskId))
      .leftJoin(areas, eq(areas.id, tasks.areaId))
      .where(
        and(
          eq(tasks.userId, userId),
          sql`${taskTimeLogs.startedAt} >= ${weekStart}::timestamptz`,
          sql`${taskTimeLogs.startedAt} < (${weekStart}::timestamptz + interval '7 days')`,
          sql`${taskTimeLogs.endedAt} IS NOT NULL`
        )
      )
      .groupBy(tasks.id, tasks.title, areas.id, areas.name, areas.weeklyHourTarget)
      .orderBy(areas.name, tasks.title);

    return c.json({ summary: rows });
  })

  // GET / — list logs for a task (must be AFTER /active and /summary/week)
  .get("/", async (c) => {
    const taskId = c.req.query("task_id");
    if (!taskId) {
      return c.json({ error: "task_id query param required" }, 422);
    }
    const userId = c.get("userId");

    // Verify task belongs to user
    const taskRow = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
      .limit(1);
    if (!taskRow.length) {
      return c.json({ error: "task not found" }, 404);
    }

    const rows = await db
      .select()
      .from(taskTimeLogs)
      .where(eq(taskTimeLogs.taskId, taskId))
      .orderBy(desc(taskTimeLogs.startedAt));

    return c.json({ logs: rows });
  })

  // DELETE /:id — delete a log entry
  .delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id) || id <= 0) {
      return c.json({ error: "invalid id" }, 400);
    }
    const userId = c.get("userId");

    // Verify log belongs to user's task
    const logRows = await db
      .select({ logId: taskTimeLogs.id, taskUserId: tasks.userId })
      .from(taskTimeLogs)
      .innerJoin(tasks, eq(tasks.id, taskTimeLogs.taskId))
      .where(eq(taskTimeLogs.id, id));

    if (!logRows.length || logRows[0].taskUserId !== userId) {
      return c.json({ error: "not found" }, 404);
    }

    await db.delete(taskTimeLogs).where(eq(taskTimeLogs.id, id));
    return c.json({ ok: true });
  });
