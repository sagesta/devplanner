import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { areas, tasks } from "../db/schema.js";
import { enqueueTaskCalendarSync } from "../queues/definitions.js";
import { rollupParentTaskStatus } from "../services/task-rollup.js";
import type { AppEnv } from "../types.js";

const uuidParam = z.string().uuid();

const createBody = z.object({
  title: z.string().min(1).max(500),
  areaId: z.string().uuid(),
  userId: z.string().uuid(),
  projectId: z.string().uuid().optional().nullable(),
  sprintId: z.string().uuid().optional().nullable(),
  parentTaskId: z.string().uuid().optional().nullable(),
  status: z
    .enum(["backlog", "todo", "in_progress", "done", "cancelled", "blocked"])
    .optional(),
  priority: z.enum(["urgent", "high", "normal", "low"]).optional(),
  energyLevel: z.enum(["deep_work", "shallow", "admin", "quick_win"]).optional(),
  taskType: z.enum(["main", "subtask"]).optional(),
  scheduledDate: z.string().optional().nullable(),
  scheduledStartTime: z.string().optional().nullable(),
  scheduledEndTime: z.string().optional().nullable(),
  estimatedMinutes: z.number().int().optional().nullable(),
  description: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  recurrenceRule: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().nullable(),
});

const patchBody = createBody.partial().omit({ userId: true });

const brainDumpBody = z.object({
  userId: z.string().uuid(),
  areaId: z.string().uuid(),
  lines: z.union([z.array(z.string()), z.string()]),
  scheduledDate: z.string().optional().nullable(),
  scheduledStartTime: z.string().optional().nullable(),
  scheduledEndTime: z.string().optional().nullable(),
  recurrenceRule: z.string().optional().nullable(),
});

const bulkStatusBody = z.object({
  userId: z.string().uuid(),
  taskIds: z.array(z.string().uuid()).min(1),
  status: z.enum(["backlog", "todo", "in_progress", "done", "cancelled", "blocked"]),
});

// Allowlist of patchable fields for cleaner update logic
const PATCH_FIELDS = [
  "title", "description", "projectId", "sprintId", "parentTaskId", "areaId",
  "priority", "energyLevel", "taskType", "scheduledDate",
  "scheduledStartTime", "scheduledEndTime", "estimatedMinutes", "dueDate",
  "recurrenceRule", "tags",
] as const;

export const taskRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const userId = c.req.query("userId");
    if (!userId) {
      return c.json({ error: "userId query required" }, 400);
    }
    const sprintId = c.req.query("sprintId");
    const whereClause =
      sprintId != null && sprintId !== ""
        ? and(eq(tasks.userId, userId), eq(tasks.sprintId, sprintId))
        : eq(tasks.userId, userId);

    // Fetch tasks with batch-loaded subtask counts to avoid N+1
    const rows = await db.query.tasks.findMany({
      where: whereClause,
      orderBy: (t, { asc: ascFn }) => [ascFn(t.sortOrder), ascFn(t.createdAt)],
    });

    // Batch load subtask progress for all parent tasks
    const parentIds = rows.filter((t) => !t.parentTaskId).map((t) => t.id);
    let subtaskMap: Record<string, { done: number; total: number }> = {};
    if (parentIds.length > 0) {
      const subtaskRows = await db
        .select({
          parentId: tasks.parentTaskId,
          total: sql<number>`count(*)::int`,
          done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int`,
        })
        .from(tasks)
        .where(inArray(tasks.parentTaskId, parentIds))
        .groupBy(tasks.parentTaskId);
      for (const r of subtaskRows) {
        if (r.parentId) {
          subtaskMap[r.parentId] = { done: r.done, total: r.total };
        }
      }
    }

    // Attach subtask progress to response
    const enriched = rows.map((t) => {
      const progress = subtaskMap[t.id];
      return {
        ...t,
        _subtasksDone: progress?.done ?? 0,
        _subtasksTotal: progress?.total ?? 0,
      };
    });

    return c.json({ tasks: enriched });
  })
  .get("/today", async (c) => {
    const userId = c.req.query("userId");
    if (!userId) {
      return c.json({ error: "userId query required" }, 400);
    }
    const dateParam = c.req.query("date");
    const today =
      dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
        ? dateParam
        : new Date().toISOString().slice(0, 10);
    const rows = await db.query.tasks.findMany({
      where: and(eq(tasks.userId, userId), eq(tasks.scheduledDate, today)),
      orderBy: (t, { desc: descFn, asc: ascFn }) => [descFn(t.priority), ascFn(t.scheduledStartTime)],
    });
    return c.json({ tasks: rows, date: today });
  })
  .get("/backlog", async (c) => {
    const userId = c.req.query("userId");
    if (!userId) {
      return c.json({ error: "userId query required" }, 400);
    }
    const rows = await db.query.tasks.findMany({
      where: and(eq(tasks.userId, userId), isNull(tasks.sprintId), isNull(tasks.parentTaskId)),
      orderBy: (t, { asc: ascFn }) => [ascFn(t.sortOrder), ascFn(t.createdAt)],
    });
    return c.json({ tasks: rows });
  })
  .post("/brain-dump", async (c) => {
    const parsed = brainDumpBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const { userId, areaId } = parsed.data;
    const areaOk = await db
      .select({ id: areas.id })
      .from(areas)
      .where(and(eq(areas.id, areaId), eq(areas.userId, userId)))
      .limit(1);
    if (!areaOk.length) {
      return c.json({ error: "area not found for user" }, 404);
    }
    const rawLines = parsed.data.lines;
    const lines = Array.isArray(rawLines)
      ? rawLines
      : rawLines.split("\n").map((l) => l.replace(/^[-*•\d.)]+\s*/, "").trim());
    const titles = lines.map((l) => l.trim()).filter(Boolean).slice(0, 200);
    if (!titles.length) {
      return c.json({ error: "no lines" }, 422);
    }
    const { scheduledDate, scheduledStartTime, scheduledEndTime, recurrenceRule } = parsed.data;
    const inserted = await db
      .insert(tasks)
      .values(
        titles.map((title, i) => ({
          userId,
          areaId,
          title: title.slice(0, 500),
          status: "backlog" as const,
          sprintId: null,
          parentTaskId: null,
          taskType: "main" as const,
          sortOrder: i,
          scheduledDate: scheduledDate ?? null,
          scheduledStartTime: scheduledStartTime ?? null,
          scheduledEndTime: scheduledEndTime ?? null,
          recurrenceRule: recurrenceRule ?? null,
        }))
      )
      .returning();
    for (const t of inserted) {
      await enqueueTaskCalendarSync({
        userId: t.userId,
        taskId: t.id,
        caldavUid: t.caldavUid,
        resourceFilename: t.caldavResourceFilename,
        googleEventId: t.googleEventId,
        action: "create",
      }).catch(() => {});
    }
    return c.json({ tasks: inserted, count: inserted.length }, 201);
  })
  .post("/bulk-status", async (c) => {
    const parsed = bulkStatusBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const { userId, taskIds, status } = parsed.data;
    const completedAt = status === "done" ? new Date() : null;
    const updated = await db
      .update(tasks)
      .set({ status, updatedAt: new Date(), completedAt })
      .where(and(eq(tasks.userId, userId), inArray(tasks.id, taskIds)))
      .returning({
        id: tasks.id,
        caldavUid: tasks.caldavUid,
        caldavResourceFilename: tasks.caldavResourceFilename,
        googleEventId: tasks.googleEventId,
      });
    for (const row of updated) {
      await enqueueTaskCalendarSync({
        userId,
        taskId: row.id,
        caldavUid: row.caldavUid,
        resourceFilename: row.caldavResourceFilename,
        googleEventId: row.googleEventId,
        action: "update",
      }).catch(() => {});
    }
    return c.json({ updated: updated.length });
  })
  .get("/:id", async (c) => {
    const idParsed = uuidParam.safeParse(c.req.param("id"));
    if (!idParsed.success) {
      return c.json({ error: "invalid id" }, 400);
    }
    const id = idParsed.data;
    const userId = c.req.query("userId");
    if (!userId) {
      return c.json({ error: "userId query required" }, 400);
    }
    const task = await db.query.tasks.findFirst({
      where: and(eq(tasks.id, id), eq(tasks.userId, userId)),
    });
    if (!task) {
      return c.json({ error: "not found" }, 404);
    }
    const subtasks = await db.query.tasks.findMany({
      where: eq(tasks.parentTaskId, id),
      orderBy: (t, { asc: ascFn }) => [ascFn(t.sortOrder), ascFn(t.createdAt)],
    });
    const subtasksDone = subtasks.filter((s) => s.status === "done").length;
    return c.json({
      task,
      subtasks,
      subtaskProgress: subtasks.length ? { done: subtasksDone, total: subtasks.length } : null,
    });
  })
  .post("/", async (c) => {
    const parsed = createBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const v = parsed.data;
    const [row] = await db
      .insert(tasks)
      .values({
        userId: v.userId,
        areaId: v.areaId,
        title: v.title,
        projectId: v.projectId ?? null,
        sprintId: v.sprintId ?? null,
        parentTaskId: v.parentTaskId ?? null,
        status: v.status ?? "todo",
        priority: v.priority ?? "normal",
        energyLevel: v.energyLevel ?? "shallow",
        taskType: v.parentTaskId ? "subtask" : (v.taskType ?? "main"),
        scheduledDate: v.scheduledDate ?? null,
        scheduledStartTime: v.scheduledStartTime ?? null,
        scheduledEndTime: v.scheduledEndTime ?? null,
        estimatedMinutes: v.estimatedMinutes ?? null,
        description: v.description ?? null,
        dueDate: v.dueDate ?? null,
        recurrenceRule: v.recurrenceRule ?? null,
        tags: v.tags ?? null,
      })
      .returning();
    if (row.parentTaskId) {
      await rollupParentTaskStatus(db, row.parentTaskId);
    }
    await enqueueTaskCalendarSync({
      userId: row.userId,
      taskId: row.id,
      caldavUid: row.caldavUid,
      resourceFilename: row.caldavResourceFilename,
      googleEventId: row.googleEventId,
      action: "create",
    }).catch(() => {});
    return c.json({ task: row }, 201);
  })
  .patch("/:id", async (c) => {
    const idParsed = uuidParam.safeParse(c.req.param("id"));
    if (!idParsed.success) {
      return c.json({ error: "invalid id" }, 400);
    }
    const id = idParsed.data;
    const parsed = patchBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const v = parsed.data;
    const updates: Partial<typeof tasks.$inferInsert> = {
      updatedAt: new Date(),
    };

    // Clean field mapping via allowlist
    for (const key of PATCH_FIELDS) {
      if (v[key] !== undefined) {
        (updates as Record<string, unknown>)[key] = v[key];
      }
    }

    if (v.status !== undefined) {
      updates.status = v.status;
      updates.completedAt = v.status === "done" ? new Date() : null;
      if (v.status !== "in_progress") {
        updates.idleFlagged = false;
        updates.idleFlaggedAt = null;
      }
    }
    const [row] = await db.update(tasks).set(updates).where(eq(tasks.id, id)).returning();
    if (!row) {
      return c.json({ error: "not found" }, 404);
    }
    if (row.parentTaskId) {
      await rollupParentTaskStatus(db, row.parentTaskId);
    }
    await enqueueTaskCalendarSync({
      userId: row.userId,
      taskId: row.id,
      caldavUid: row.caldavUid,
      resourceFilename: row.caldavResourceFilename,
      googleEventId: row.googleEventId,
      action: "update",
    }).catch(() => {});
    return c.json({ task: row });
  })
  .delete("/:id", async (c) => {
    const idParsed = uuidParam.safeParse(c.req.param("id"));
    if (!idParsed.success) {
      return c.json({ error: "invalid id" }, 400);
    }
    const id = idParsed.data;
    const userId = c.req.query("userId");
    // Security: scope delete to the requesting user if userId is provided
    const whereClause = userId
      ? and(eq(tasks.id, id), eq(tasks.userId, userId))
      : eq(tasks.id, id);

    const [row] = await db.delete(tasks).where(whereClause).returning();
    if (!row) {
      return c.json({ error: "not found" }, 404);
    }
    if (row.parentTaskId) {
      await rollupParentTaskStatus(db, row.parentTaskId);
    }
    await enqueueTaskCalendarSync({
      userId: row.userId,
      taskId: row.id,
      caldavUid: row.caldavUid,
      resourceFilename: row.caldavResourceFilename,
      googleEventId: row.googleEventId,
      action: "delete",
    }).catch(() => {});
    return c.json({ ok: true });
  });
