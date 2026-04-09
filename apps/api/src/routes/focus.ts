import { and, eq, isNull, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client.js";
import { subtasks, tasks } from "../db/schema.js";
import type { AppEnv } from "../types.js";

export const focusRoutes = new Hono<AppEnv>()
  .get("/export", async (c) => {
    const userId = c.get("userId");
    const today = new Date().toISOString().slice(0, 10);

    // Get subtasks scheduled today for this user's tasks
    const userTasks = await db.query.tasks.findMany({
      where: and(eq(tasks.userId, userId), isNull(tasks.deletedAt)),
      columns: { id: true, title: true, priority: true, areaId: true },
    });
    const taskIds = userTasks.map((t) => t.id);
    const taskMap = new Map(userTasks.map((t) => [t.id, t]));

    const filtered = taskIds.length > 0
      ? await db.query.subtasks.findMany({
          where: inArray(subtasks.taskId, taskIds),
        })
      : [];

    const tasksOut = filtered.map((s) => {
      const parent = taskMap.get(s.taskId)!;
      return {
        id: s.id,
        title: `${parent.title} → ${s.title}`,
        estimatedPomodoros: Math.max(1, Math.ceil((s.estimatedMinutes ?? 25) / 25)),
        area: parent.areaId,
        priority: parent.priority,
      };
    });

    return c.json({ date: today, tasks: tasksOut });
  })
  .post("/import", async (c) => {
    return c.json({
      ok: true,
      imported: 0,
      message: "Stub: upload Focus CSV/JSON in a later iteration; sessions not applied yet.",
    });
  });
