import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { areas, tags, taskTags, tasks } from "../db/schema.js";
import { enqueueTaskCalendarSync } from "../queues/definitions.js";
import { rollupParentTaskStatus } from "../services/task-rollup.js";
import type { AppEnv } from "../types.js";

const uuidParam = z.string().uuid();

const createBody = z.object({
  title: z.string().min(1).max(500),
  areaId: z.string().uuid(),
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
  workDepth: z.enum(["shallow", "normal", "deep"]).optional().nullable(),
  physicalEnergy: z.enum(["low", "medium", "high"]).optional().nullable(),
});

const patchBody = createBody.partial();

/** stress-test-fix: reject calendar dates absurdly far in the future (bad imports / typos). */
function assertSaneCalendarDate(field: string, value: string | null | undefined): void {
  if (value == null || value === "") return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ${field}`);
  }
  const y = Number(value.slice(0, 4));
  const maxY = new Date().getUTCFullYear() + 2;
  if (y > maxY) {
    throw new Error(`${field} cannot be more than 2 years in the future`);
  }
}

function withTaskApiFields<T extends { recurrenceRule: string | null; deletedAt?: Date | null }>(t: T) {
  const { deletedAt: _d, ...rest } = t;
  return {
    ...rest,
    recurring: Boolean(t.recurrenceRule?.trim()),
  };
}

/** Calendar day in the API server's local timezone (matches typical task date inputs). */
function serverTodayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const taskActive = isNull(tasks.deletedAt);

const brainDumpBody = z.object({
  areaId: z.string().uuid(),
  lines: z.union([z.array(z.string()), z.string()]),
  scheduledDate: z.string().optional().nullable(),
  scheduledStartTime: z.string().optional().nullable(),
  scheduledEndTime: z.string().optional().nullable(),
  recurrenceRule: z.string().optional().nullable(),
});

const bulkStatusBody = z.object({
  taskIds: z.array(z.string().uuid()).min(1),
  status: z.enum(["backlog", "todo", "in_progress", "done", "cancelled", "blocked"]),
});

const bulkScheduleBody = z.object({
  ids: z.array(z.string().uuid()).min(1),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// Allowlist of patchable fields for cleaner update logic
const PATCH_FIELDS = [
  "title", "description", "projectId", "sprintId", "parentTaskId", "areaId",
  "priority", "energyLevel", "workDepth", "physicalEnergy", "taskType", "scheduledDate",
  "scheduledStartTime", "scheduledEndTime", "estimatedMinutes", "dueDate",
  "recurrenceRule", "tags",
] as const;

export const taskRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const userId = c.get("userId");
    const sprintId = c.req.query("sprintId");
    const tagFilter = c.req.query("tag");

    let whereClause =
      sprintId != null && sprintId !== ""
        ? and(eq(tasks.userId, userId), eq(tasks.sprintId, sprintId), taskActive)
        : and(eq(tasks.userId, userId), taskActive);

    // If tag filter, get matching task IDs first
    let tagTaskIds: string[] | null = null;
    if (tagFilter) {
      const tagRows = await db
        .select({ taskId: taskTags.taskId })
        .from(taskTags)
        .innerJoin(tags, eq(tags.id, taskTags.tagId))
        .where(eq(tags.name, tagFilter));
      tagTaskIds = tagRows.map((r) => r.taskId);
      if (tagTaskIds.length === 0) {
        return c.json({ tasks: [] });
      }
      whereClause = and(whereClause, inArray(tasks.id, tagTaskIds));
    }

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
        .where(and(inArray(tasks.parentTaskId, parentIds), taskActive))
        .groupBy(tasks.parentTaskId);
      for (const r of subtaskRows) {
        if (r.parentId) {
          subtaskMap[r.parentId] = { done: r.done, total: r.total };
        }
      }
    }

    // Batch load tags for all tasks
    const allTaskIds = rows.map((t) => t.id);
    let tagMap: Record<string, Array<{ id: number; name: string; color: string | null }>> = {};
    if (allTaskIds.length > 0) {
      const tagRows = await db
        .select({
          taskId: taskTags.taskId,
          tagId: tags.id,
          tagName: tags.name,
          tagColor: tags.color,
        })
        .from(taskTags)
        .innerJoin(tags, eq(tags.id, taskTags.tagId))
        .where(inArray(taskTags.taskId, allTaskIds))
        .orderBy(asc(tags.name));
      for (const r of tagRows) {
        if (!tagMap[r.taskId]) tagMap[r.taskId] = [];
        tagMap[r.taskId].push({ id: r.tagId, name: r.tagName, color: r.tagColor });
      }
    }

    // Attach subtask progress and tags to response
    const enriched = rows.map((t) => {
      const progress = subtaskMap[t.id];
      return {
        ...withTaskApiFields(t),
        _subtasksDone: progress?.done ?? 0,
        _subtasksTotal: progress?.total ?? 0,
        _tags: tagMap[t.id] ?? [],
      };
    });

    return c.json({ tasks: enriched });
  })
  .get("/today", async (c) => {
    const userId = c.get("userId");
    const dateParam = c.req.query("date");
    const hasParam = Boolean(dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam));
    const dateFilter = hasParam
      ? or(eq(tasks.scheduledDate, dateParam!), eq(tasks.dueDate, dateParam!))
      : or(sql`${tasks.scheduledDate} = CURRENT_DATE`, sql`${tasks.dueDate} = CURRENT_DATE`);
    const rows = await db.query.tasks.findMany({
      where: and(eq(tasks.userId, userId), taskActive, dateFilter),
      orderBy: [
        sql`${tasks.scheduledStartTime} ASC NULLS LAST`,
        desc(tasks.priority),
        sql`${tasks.createdAt} ASC`,
      ],
    });
    const [doneTodayRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          taskActive,
          eq(tasks.status, "done"),
          sql`(${tasks.updatedAt})::date = CURRENT_DATE`
        )
      );
    // Batch load tags for today's tasks
    const todayTaskIds = rows.map((t) => t.id);
    const todayTagMap: Record<string, Array<{ id: number; name: string; color: string | null }>> = {};
    if (todayTaskIds.length > 0) {
      const todayTagRows = await db
        .select({ taskId: taskTags.taskId, tagId: tags.id, tagName: tags.name, tagColor: tags.color })
        .from(taskTags)
        .innerJoin(tags, eq(tags.id, taskTags.tagId))
        .where(inArray(taskTags.taskId, todayTaskIds))
        .orderBy(asc(tags.name));
      for (const r of todayTagRows) {
        if (!todayTagMap[r.taskId]) todayTagMap[r.taskId] = [];
        todayTagMap[r.taskId].push({ id: r.tagId, name: r.tagName, color: r.tagColor });
      }
    }

    return c.json({
      tasks: rows.map((t) => ({ ...withTaskApiFields(t), _tags: todayTagMap[t.id] ?? [] })),
      date: hasParam ? dateParam! : serverTodayYmd(),
      doneTodayCount: doneTodayRow?.count ?? 0,
    });
  })
  .get("/backlog", async (c) => {
    const userId = c.get("userId");
    const rows = await db.query.tasks.findMany({
      where: and(eq(tasks.userId, userId), isNull(tasks.sprintId), isNull(tasks.parentTaskId), taskActive),
      orderBy: (t, { asc: ascFn }) => [ascFn(t.sortOrder), ascFn(t.createdAt)],
    });
    // Batch load tags
    const blIds = rows.map((t) => t.id);
    const blTagMap: Record<string, Array<{ id: number; name: string; color: string | null }>> = {};
    if (blIds.length > 0) {
      const blTagRows = await db
        .select({ taskId: taskTags.taskId, tagId: tags.id, tagName: tags.name, tagColor: tags.color })
        .from(taskTags)
        .innerJoin(tags, eq(tags.id, taskTags.tagId))
        .where(inArray(taskTags.taskId, blIds))
        .orderBy(asc(tags.name));
      for (const r of blTagRows) {
        if (!blTagMap[r.taskId]) blTagMap[r.taskId] = [];
        blTagMap[r.taskId].push({ id: r.tagId, name: r.tagName, color: r.tagColor });
      }
    }
    return c.json({ tasks: rows.map((t) => ({ ...withTaskApiFields(t), _tags: blTagMap[t.id] ?? [] })) });
  })
  .post("/brain-dump", async (c) => {
    const parsed = brainDumpBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const userId = c.get("userId");
    const { areaId } = parsed.data;
    try {
      assertSaneCalendarDate("scheduledDate", parsed.data.scheduledDate ?? undefined);
    } catch (e) {
      return c.json({ error: String(e) }, 422);
    }
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
    return c.json(
      { tasks: inserted.map((t) => withTaskApiFields(t)), count: inserted.length },
      201
    );
  })
  .post("/bulk-status", async (c) => {
    const parsed = bulkStatusBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const userId = c.get("userId");
    const { taskIds, status } = parsed.data;
    const completedAt = status === "done" ? new Date() : null;
    const updated = await db
      .update(tasks)
      .set({ status, updatedAt: new Date(), completedAt })
      .where(and(eq(tasks.userId, userId), inArray(tasks.id, taskIds), taskActive))
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
  .post("/restore/:id", async (c) => {
    const idParsed = uuidParam.safeParse(c.req.param("id"));
    if (!idParsed.success) {
      return c.json({ error: "invalid id" }, 400);
    }
    const id = idParsed.data;
    const userId = c.get("userId");
    const now = new Date();
    const [row] = await db
      .update(tasks)
      .set({ deletedAt: null, updatedAt: now })
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId), isNotNull(tasks.deletedAt)))
      .returning();
    if (!row) {
      return c.json({ error: "not found" }, 404);
    }
    await db
      .update(tasks)
      .set({ deletedAt: null, updatedAt: now })
      .where(and(eq(tasks.userId, userId), eq(tasks.parentTaskId, id), isNotNull(tasks.deletedAt)));
    await enqueueTaskCalendarSync({
      userId: row.userId,
      taskId: row.id,
      caldavUid: row.caldavUid,
      resourceFilename: row.caldavResourceFilename,
      googleEventId: row.googleEventId,
      action: "create",
    }).catch(() => {});
    return c.json({ task: withTaskApiFields(row) });
  })
  .patch("/bulk", async (c) => {
    const parsed = bulkScheduleBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const userId = c.get("userId");
    const { ids, scheduledDate } = parsed.data;
    try {
      assertSaneCalendarDate("scheduledDate", scheduledDate);
    } catch (e) {
      return c.json({ error: String(e) }, 422);
    }
    const updated = await db
      .update(tasks)
      .set({ scheduledDate, updatedAt: new Date() })
      .where(and(eq(tasks.userId, userId), inArray(tasks.id, ids), taskActive))
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
    const userId = c.get("userId");
    const task = await db.query.tasks.findFirst({
      where: and(eq(tasks.id, id), eq(tasks.userId, userId), taskActive),
    });
    if (!task) {
      return c.json({ error: "not found" }, 404);
    }
    const subtasks = await db.query.tasks.findMany({
      where: and(eq(tasks.parentTaskId, id), taskActive),
      orderBy: (t, { asc: ascFn }) => [ascFn(t.sortOrder), ascFn(t.createdAt)],
    });
    const subtasksDone = subtasks.filter((s) => s.status === "done").length;

    // Load tags for this task
    const detailTagRows = await db
      .select({ tagId: tags.id, tagName: tags.name, tagColor: tags.color })
      .from(taskTags)
      .innerJoin(tags, eq(tags.id, taskTags.tagId))
      .where(eq(taskTags.taskId, id))
      .orderBy(asc(tags.name));
    const taskTags_ = detailTagRows.map((r) => ({ id: r.tagId, name: r.tagName, color: r.tagColor }));

    return c.json({
      task: { ...withTaskApiFields(task), _tags: taskTags_ },
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
    const userId = c.get("userId");
    try {
      assertSaneCalendarDate("scheduledDate", v.scheduledDate ?? undefined);
      assertSaneCalendarDate("dueDate", v.dueDate ?? undefined);
    } catch (e) {
      return c.json({ error: String(e) }, 422);
    }
    const today = serverTodayYmd();
    const scheduledDate =
      v.parentTaskId != null
        ? v.scheduledDate === undefined
          ? null
          : v.scheduledDate
        : v.scheduledDate === undefined
          ? today
          : v.scheduledDate;
    const dueDate =
      v.parentTaskId != null
        ? v.dueDate === undefined
          ? null
          : v.dueDate
        : v.dueDate === undefined
          ? today
          : v.dueDate;
    const [row] = await db
      .insert(tasks)
      .values({
        userId,
        areaId: v.areaId,
        title: v.title,
        projectId: v.projectId ?? null,
        sprintId: v.sprintId ?? null,
        parentTaskId: v.parentTaskId ?? null,
        status: v.status ?? "todo",
        priority: v.priority ?? "normal",
        energyLevel: v.energyLevel ?? "shallow",
        workDepth: v.workDepth ?? "normal",
        physicalEnergy: v.physicalEnergy ?? "medium",
        taskType: v.parentTaskId ? "subtask" : (v.taskType ?? "main"),
        scheduledDate,
        scheduledStartTime: v.scheduledStartTime ?? null,
        scheduledEndTime: v.scheduledEndTime ?? null,
        estimatedMinutes: v.estimatedMinutes ?? null,
        description: v.description ?? null,
        dueDate,
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
    return c.json({ task: withTaskApiFields(row) }, 201);
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
    try {
      if (v.scheduledDate !== undefined) assertSaneCalendarDate("scheduledDate", v.scheduledDate);
      if (v.dueDate !== undefined) assertSaneCalendarDate("dueDate", v.dueDate);
    } catch (e) {
      return c.json({ error: String(e) }, 422);
    }
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
    const userId = c.get("userId");
    const [row] = await db
      .update(tasks)
      .set(updates)
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId), taskActive))
      .returning();
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
    return c.json({ task: withTaskApiFields(row) });
  })
  .delete("/:id", async (c) => {
    const idParsed = uuidParam.safeParse(c.req.param("id"));
    if (!idParsed.success) {
      return c.json({ error: "invalid id" }, 400);
    }
    const id = idParsed.data;
    const userId = c.get("userId");
    const now = new Date();
    const [row] = await db
      .update(tasks)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId), taskActive))
      .returning();
    if (!row) {
      return c.json({ error: "not found" }, 404);
    }
    await db
      .update(tasks)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(tasks.userId, userId), eq(tasks.parentTaskId, id), taskActive));
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
