import { and, eq, inArray, isNull, sql } from "drizzle-orm";
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
  scheduledDate: z.string().nullable().optional(),
  scheduledTime: z.string().nullable().optional(),
  estimatedMinutes: z.number().int().nullable().optional(),
});

const patchBody = z.object({
  title: z.string().min(1).max(500).optional(),
  completed: z.boolean().optional(),
  scheduledDate: z.string().nullable().optional(),
  scheduledTime: z.string().nullable().optional(),
  estimatedMinutes: z.number().int().nullable().optional(),
});

const bulkBody = z.object({
  taskId: z.string().uuid(),
  subtasks: z.array(
    z.object({
      title: z.string().min(1).max(500),
      scheduledDate: z.string().nullable().optional(),
      estimatedMinutes: z.number().int().nullable().optional(),
    })
  ).min(1)
});

const spreadBody = z.object({
  taskId: z.string().uuid(),
  subtaskTitles: z.array(z.string().min(1).max(500)).min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  maxPerDay: z.number().int().min(1).max(50).optional().default(3),
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
      scheduledDate: v.scheduledDate ?? null,
      scheduledTime: v.scheduledTime ?? null,
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
    if (v.scheduledDate !== undefined) updates.scheduledDate = v.scheduledDate;
    if (v.scheduledTime !== undefined) updates.scheduledTime = v.scheduledTime;
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
        scheduledDate: s.scheduledDate ?? null,
        estimatedMinutes: s.estimatedMinutes ?? null,
      }))
    ).returning();

    await rollupParentTaskStatus(db, v.taskId);

    return c.json({ subtasks: inserted }, 201);
  })
  .post("/spread", async (c) => {
    const parsed = spreadBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 422);
    const v = parsed.data;
    const userId = c.get("userId");

    const task = await db.query.tasks.findFirst({
      where: and(eq(tasks.id, v.taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt))
    });
    if (!task) return c.json({ error: "Task not found" }, 404);

    // Get current subtasks distribution across days
    const allUserTasks = await db.query.tasks.findMany({
      where: and(eq(tasks.userId, userId), isNull(tasks.deletedAt))
    });
    const taskIds = allUserTasks.map(t => t.id);
    
    let distributionRows: { date: string, count: number }[] = [];
    if (taskIds.length > 0) {
       const counts = await db.select({
         date: subtasks.scheduledDate,
         count: sql<number>`count(*)::int`
       }).from(subtasks)
         .where(and(inArray(subtasks.taskId, taskIds), sql`${subtasks.scheduledDate} IS NOT NULL`))
         .groupBy(subtasks.scheduledDate);
       
       distributionRows = counts.filter(r => r.date !== null).map(r => ({ date: r.date as string, count: r.count }));
    }

    const dayLoads = new Map<string, number>();
    for (const r of distributionRows) {
      dayLoads.set(r.date, r.count);
    }

    const dateToIso = (d: Date) => d.toISOString().slice(0, 10);
    const startObj = new Date(v.startDate);
    const endObj = new Date(v.endDate);
    
    // Create an array of candidate dates
    const candidates: string[] = [];
    for (let d = new Date(startObj); d <= endObj; d.setUTCDate(d.getUTCDate() + 1)) {
        candidates.push(dateToIso(d));
    }

    const created = [];
    let dateIdx = 0;
    
    for (const title of v.subtaskTitles) {
      let assignedDate: string | null = null;
      while (dateIdx < candidates.length) {
        const d = candidates[dateIdx];
        const load = dayLoads.get(d) ?? 0;
        if (load < v.maxPerDay) {
          assignedDate = d;
          dayLoads.set(d, load + 1);
          break;
        } else {
          dateIdx++;
        }
      }
      
      const insertData = {
        taskId: v.taskId,
        title,
        scheduledDate: assignedDate, // may be null if we run out of valid dates
      };
      const [row] = await db.insert(subtasks).values(insertData).returning();
      created.push(row);
    }

    await rollupParentTaskStatus(db, v.taskId);

    return c.json({ subtasks: created }, 201);
  });
