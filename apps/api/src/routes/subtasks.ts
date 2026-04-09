import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { subtasks, tasks } from "../db/schema.js";
import { rollupParentTaskStatus } from "../services/task-rollup.js";
import type { AppEnv } from "../types.js";

const uuidParam = z.string().uuid();

const createBody = z.object({
  taskId: z.string().uuid(),
  title: z.string().min(1).max(500),
  estimatedMinutes: z.number().int().nullable().optional(),
});

const patchBody = z.object({
  title: z.string().min(1).max(500).optional(),
  completed: z.boolean().optional(),
  estimatedMinutes: z.number().int().nullable().optional(),
});

const bulkBody = z.object({
  taskId: z.string().uuid(),
  subtasks: z.array(
    z.object({
      title: z.string().min(1).max(500),
      estimatedMinutes: z.number().int().nullable().optional(),
    })
  ).min(1)
});



export const subtasksRoutes = new Hono<AppEnv>()
  .post("/", async (c) => {
    const parsed = createBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 422);
    
    const v = parsed.data;
    const userId = c.get("userId");
    
    // Ensure parent task belongs to user
    const task = await db.query.tasks.findFirst({
      where: and(eq(tasks.id, v.taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt))
    });
    if (!task) return c.json({ error: "Task not found" }, 404);

    const [row] = await db.insert(subtasks).values({
      taskId: v.taskId,
      title: v.title,
      estimatedMinutes: v.estimatedMinutes ?? null,
    }).returning();

    await rollupParentTaskStatus(db, v.taskId);

    return c.json({ subtask: row }, 201);
  })
  .patch("/:id", async (c) => {
    const idParsed = uuidParam.safeParse(c.req.param("id"));
    if (!idParsed.success) return c.json({ error: "invalid id" }, 400);
    const id = idParsed.data;

    const parsed = patchBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 422);
    const v = parsed.data;
    const userId = c.get("userId");

    // verify ownership
    const sub = await db.query.subtasks.findFirst({
      where: eq(subtasks.id, id),
      with: { task: true }
    });
    if (!sub || sub.task.userId !== userId) {
      return c.json({ error: "not found" }, 404);
    }

    const updates: Partial<typeof subtasks.$inferInsert> = {};
    if (v.title !== undefined) updates.title = v.title;
    if (v.completed !== undefined) {
      updates.completed = v.completed;
      updates.completedAt = v.completed ? new Date() : null;
    }
    if (v.estimatedMinutes !== undefined) updates.estimatedMinutes = v.estimatedMinutes;

    const [row] = await db.update(subtasks).set(updates).where(eq(subtasks.id, id)).returning();
    
    if (v.completed !== undefined) {
      await rollupParentTaskStatus(db, row.taskId);
    }

    return c.json({ subtask: row });
  })
  .delete("/:id", async (c) => {
    const idParsed = uuidParam.safeParse(c.req.param("id"));
    if (!idParsed.success) return c.json({ error: "invalid id" }, 400);
    const id = idParsed.data;
    const userId = c.get("userId");

    const sub = await db.query.subtasks.findFirst({
      where: eq(subtasks.id, id),
      with: { task: true }
    });
    if (!sub || sub.task.userId !== userId) {
      return c.json({ error: "not found" }, 404);
    }

    await db.delete(subtasks).where(eq(subtasks.id, id));
    await rollupParentTaskStatus(db, sub.taskId);

    return c.json({ ok: true });
  })
  .post("/bulk", async (c) => {
    const parsed = bulkBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 422);
    const v = parsed.data;
    const userId = c.get("userId");

    const task = await db.query.tasks.findFirst({
      where: and(eq(tasks.id, v.taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt))
    });
    if (!task) return c.json({ error: "Task not found" }, 404);

    const inserted = await db.insert(subtasks).values(
      v.subtasks.map(s => ({
        taskId: v.taskId,
        title: s.title,
        estimatedMinutes: s.estimatedMinutes ?? null,
      }))
    ).returning();

    await rollupParentTaskStatus(db, v.taskId);

    return c.json({ subtasks: inserted }, 201);
  });
