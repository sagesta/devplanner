import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { sprints, tasks, users } from "../db/schema.js";
import type { AppEnv } from "../types.js";

const createBody = z.object({
  name: z.string().min(1).max(255),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  goal: z.string().optional().nullable(),
  status: z.enum(["planned", "active", "completed"]).optional(),
  capacityHours: z.number().nonnegative().optional().nullable(),
});

const patchBody = z.object({
  name: z.string().min(1).max(255).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  goal: z.string().optional().nullable(),
  status: z.enum(["planned", "active", "completed"]).optional(),
  capacityHours: z.number().nonnegative().optional().nullable(),
});

export const sprintRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const userId = c.get("userId");
    // Fetch sprints with task counts
    const rows = await db
      .select()
      .from(sprints)
      .where(eq(sprints.userId, userId))
      .orderBy(desc(sprints.startDate));

    const sprintIds = rows.map((s) => s.id);
    let taskCounts: Record<string, number> = {};
    if (sprintIds.length > 0) {
      const counts = await db
        .select({
          sprintId: tasks.sprintId,
          count: sql<number>`count(*)::int`,
        })
        .from(tasks)
        .where(and(inArray(tasks.sprintId, sprintIds), isNull(tasks.deletedAt)))
        .groupBy(tasks.sprintId);
      for (const r of counts) {
        if (r.sprintId) taskCounts[r.sprintId] = r.count;
      }
    }

    return c.json({
      sprints: rows.map((s) => ({
        ...s,
        taskCount: taskCounts[s.id] ?? 0,
      })),
    });
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const userId = c.get("userId");
    const row = await db.query.sprints.findFirst({
      where: and(eq(sprints.id, id), eq(sprints.userId, userId)),
    });
    if (!row) {
      return c.json({ error: "not found" }, 404);
    }
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.sprintId, id), isNull(tasks.deletedAt)));
    return c.json({
      sprint: { ...row, taskCount: countRow?.count ?? 0 },
    });
  })
  .post("/", async (c) => {
    const parsed = createBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const v = parsed.data;
    const userId = c.get("userId");
    const owner = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!owner.length) {
      return c.json({ error: "user not found" }, 404);
    }
    if (v.endDate < v.startDate) {
      return c.json({ error: "endDate must be on or after startDate" }, 422);
    }
    const [row] = await db
      .insert(sprints)
      .values({
        userId,
        name: v.name.trim(),
        startDate: v.startDate,
        endDate: v.endDate,
        goal: v.goal ?? null,
        status: v.status ?? "planned",
        capacityHours: v.capacityHours ?? null,
      })
      .returning();
    return c.json({ sprint: row }, 201);
  })
  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    const parsed = patchBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const v = parsed.data;
    const updates: Partial<typeof sprints.$inferInsert> = {};
    if (v.name !== undefined) updates.name = v.name.trim();
    if (v.startDate !== undefined) updates.startDate = v.startDate;
    if (v.endDate !== undefined) updates.endDate = v.endDate;
    if (v.goal !== undefined) updates.goal = v.goal;
    if (v.status !== undefined) updates.status = v.status;
    if (v.capacityHours !== undefined) updates.capacityHours = v.capacityHours;

    if (Object.keys(updates).length === 0) {
      return c.json({ error: "no fields to update" }, 422);
    }
    const userId = c.get("userId");
    const [row] = await db
      .update(sprints)
      .set(updates)
      .where(and(eq(sprints.id, id), eq(sprints.userId, userId)))
      .returning();
    if (!row) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ sprint: row });
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    const userId = c.get("userId");

    // Safety check: prevent deletion if tasks are still assigned
    const [assignedCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.sprintId, id), isNull(tasks.deletedAt)));

    if ((assignedCount?.count ?? 0) > 0) {
      return c.json(
        { error: `Cannot delete sprint — ${assignedCount.count} task(s) are still assigned. Move them to backlog first.` },
        409
      );
    }

    const [row] = await db
      .delete(sprints)
      .where(and(eq(sprints.id, id), eq(sprints.userId, userId)))
      .returning();

    if (!row) {
      return c.json({ error: "not found" }, 404);
    }

    return c.json({ ok: true });
  });
