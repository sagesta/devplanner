import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { areas, tags, taskTags, tasks, subtasks } from "../db/schema.js";
import { generateAndStoreEmbedding, buildEmbeddingText, deleteStaleEmbedding } from "../ai/embeddings.js";
import { enqueueTaskCalendarSync } from "../queues/definitions.js";
import type { AppEnv } from "../types.js";

const uuidParam = z.string().uuid();

const createBody = z.object({
  title: z.string().min(1).max(500),
  areaId: z.string().uuid(),
  projectId: z.string().uuid().optional().nullable(),
  sprintId: z.string().uuid().optional().nullable(),
  status: z
    .enum(["backlog", "todo", "in_progress", "done", "cancelled", "blocked"])
    .optional(),
  priority: z.enum(["urgent", "high", "normal", "low"]).optional(),
  energyLevel: z.enum(["deep_work", "shallow", "admin", "quick_win"]).optional(),
  taskType: z.enum(["main", "subtask"]).optional(),
  description: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  recurrenceRule: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().nullable(),
  workDepth: z.enum(["shallow", "normal", "deep"]).optional().nullable(),
  physicalEnergy: z.enum(["low", "medium", "high"]).optional().nullable(),
  scheduledDate: z.string().optional().nullable(),
  scheduledStartTime: z.string().optional().nullable(),
  scheduledEndTime: z.string().optional().nullable(),
  estimatedMinutes: z.number().int().optional().nullable(),
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
  recurrenceRule: z.string().optional().nullable(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  scheduledStartTime: z.string().optional().nullable(),
  scheduledEndTime: z.string().optional().nullable(),
});

const bulkStatusBody = z.object({
  taskIds: z.array(z.string().uuid()).min(1),
  status: z.enum(["backlog", "todo", "in_progress", "done", "cancelled", "blocked"]),
});

const bulkScheduleBody = z.object({
  ids: z.array(z.string().uuid()).min(1),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const PATCH_FIELDS = [
  "title", "description", "projectId", "sprintId", "areaId",
  "priority", "energyLevel", "workDepth", "physicalEnergy",
  "dueDate","recurrenceRule", "tags",
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

    const parentIds = rows.map((t) => t.id);
    let subtaskMap: Record<string, { done: number; total: number; list: any[] }> = {};
    if (parentIds.length > 0) {
      const allSubs = await db.query.subtasks.findMany({
        where: inArray(subtasks.taskId, parentIds),
      });
      for (const s of allSubs) {
        if (!subtaskMap[s.taskId]) subtaskMap[s.taskId] = { done: 0, total: 0, list: [] };
        subtaskMap[s.taskId].list.push(s);
        subtaskMap[s.taskId].total++;
        if (s.completed) subtaskMap[s.taskId].done++;
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
        _subtasks: progress?.list ?? [],
        _tags: tagMap[t.id] ?? [],
      };
    });

    return c.json({ tasks: enriched });
  })
  .get("/today", async (c) => {
    const userId = c.get("userId");
    const dateParam = c.req.query("date");
    const hasParam = Boolean(dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam));
    const dt = hasParam ? dateParam! : serverTodayYmd();

    let baseFilter = eq(tasks.dueDate, dt) as any;

    const rows = await db.query.tasks.findMany({
      where: and(eq(tasks.userId, userId), taskActive, baseFilter),
      orderBy: [
        desc(tasks.priority),
        sql`${tasks.createdAt} ASC`,
      ],
    });

    const [doneTodayRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(subtasks)
      .innerJoin(tasks, eq(tasks.id, subtasks.taskId))
      .where(
        and(
          eq(tasks.userId, userId),
          eq(subtasks.completed, true),
          sql`(${subtasks.completedAt})::date = CURRENT_DATE`
        )
      );

    const todayTaskIds = rows.map((t) => t.id);
    const todayTagMap: Record<string, Array<{ id: number; name: string; color: string | null }>> = {};
    const subtaskMap: Record<string, any[]> = {};

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

      const subs = await db.query.subtasks.findMany({
        where: inArray(subtasks.taskId, todayTaskIds),
      });
      for (const s of subs) {
        if (!subtaskMap[s.taskId]) subtaskMap[s.taskId] = [];
        subtaskMap[s.taskId].push(s);
      }
    }

    return c.json({
      tasks: rows.map((t) => ({ ...withTaskApiFields(t), _tags: todayTagMap[t.id] ?? [], _subtasks: subtaskMap[t.id] ?? [] })),
      date: dt,
      doneTodayCount: doneTodayRow?.count ?? 0,
    });
  })

  .post("/brain-dump", async (c) => {
    const parsed = brainDumpBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const userId = c.get("userId");
    const { areaId } = parsed.data;
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
    
    const junkPrefixes = [/^task title:/i, /^sprint:/i, /^status:/i, /^priority:/i, /^difficulty:/i, /^effort:/i, /^due date:/i, /^subtasks:/i, /^recurrence:/i];
    const titles = lines
      .map((l) => l.trim())
      .filter((l) => l && !junkPrefixes.some(p => p.test(l)))
      .slice(0, 200);

    if (!titles.length) {
      return c.json({ error: "no valid lines to create" }, 422);
    }
    const { recurrenceRule } = parsed.data;
    const inserted = await db
      .insert(tasks)
      .values(
        titles.map((title, i) => ({
          userId,
          areaId,
          title: title.slice(0, 500),
          status: "backlog" as const,
          sprintId: null,
          sortOrder: i,
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
      // Fire-and-forget embedding for RAG
      generateAndStoreEmbedding(t.id, buildEmbeddingText(t.title)).catch(() => {});
    }
    // If scheduledDate provided, create one subtask per inserted task
    if (parsed.data.scheduledDate) {
      const schedDate = parsed.data.scheduledDate;
      const schedTime = parsed.data.scheduledStartTime ?? null;
      await db.insert(subtasks).values(
        inserted.map((t) => ({
          taskId: t.id,
          title: t.title,
          scheduledDate: schedDate,
          scheduledTime: schedTime,
        }))
      );
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

    // Verify all tasks belong to this user
    const validTasks = await db
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), inArray(tasks.id, ids), taskActive));

    if (!validTasks.length) return c.json({ updated: 0 });

    if (validTasks.length > 0) {
      await db.update(tasks).set({ dueDate: scheduledDate })
        .where(inArray(tasks.id, validTasks.map(t => t.id)));
    }

    return c.json({ updated: validTasks.length });
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
    const subtasksList = await db.query.subtasks.findMany({
      where: eq(subtasks.taskId, id),
      orderBy: (s, { asc: ascFn }) => [ascFn(s.createdAt)],
    });
    const subtasksDone = subtasksList.filter((s) => s.completed).length;

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
      subtasks: subtasksList,
      subtaskProgress: subtasksList.length ? { done: subtasksDone, total: subtasksList.length } : null,
    });
  })
  .post("/", async (c) => {
    const parsed = createBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const v = parsed.data;
    
    // Bug 1 Fix: Reject AI generated metadata labels masquerading as task titles
    const junkPrefixes = [/^task title:/i, /^sprint:/i, /^status:/i, /^priority:/i, /^difficulty:/i, /^effort:/i, /^due date:/i, /^subtasks:/i, /^recurrence:/i];
    if (junkPrefixes.some(p => p.test(v.title))) {
      return c.json({ error: "Invalid task title — metadata labels are not valid task names" }, 400);
    }

    const userId = c.get("userId");
    try {
      assertSaneCalendarDate("scheduledDate", v.scheduledDate ?? undefined);
      assertSaneCalendarDate("dueDate", v.dueDate ?? undefined);
    } catch (e) {
      return c.json({ error: String(e) }, 422);
    }
    const [row] = await db
      .insert(tasks)
      .values({
        userId,
        areaId: v.areaId,
        title: v.title,
        projectId: v.projectId ?? null,
        sprintId: v.sprintId ?? null,
        status: v.status ?? "todo",
        priority: v.priority ?? "normal",
        energyLevel: v.energyLevel ?? "shallow",
        workDepth: v.workDepth ?? "normal",
        physicalEnergy: v.physicalEnergy ?? "medium",
        description: v.description ?? null,
        dueDate: v.dueDate ?? null,
        recurrenceRule: v.recurrenceRule ?? null,
        tags: v.tags ?? null,
      })
      .returning();
    await enqueueTaskCalendarSync({
      userId: row.userId,
      taskId: row.id,
      caldavUid: row.caldavUid,
      resourceFilename: row.caldavResourceFilename,
      googleEventId: row.googleEventId,
      action: "create",
    }).catch(() => {});
    // Fire-and-forget embedding for RAG
    generateAndStoreEmbedding(
      row.id,
      buildEmbeddingText(row.title, row.description)
    ).catch(() => {});

    return c.json({
      task: withTaskApiFields(row),
      subtasks: [],
    }, 201);
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
      if (v.dueDate !== undefined) assertSaneCalendarDate("dueDate", v.dueDate);
    } catch (e) {
      return c.json({ error: String(e) }, 422);
    }
    const updates: Partial<typeof tasks.$inferInsert> = {
      updatedAt: new Date(),
    };

    // Clean field mapping via allowlist
    for (const key of PATCH_FIELDS) {
      const k = key as keyof typeof v;
      if (v[k] !== undefined) {
        (updates as Record<string, unknown>)[key] = v[k];
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
    await enqueueTaskCalendarSync({
      userId: row.userId,
      taskId: row.id,
      caldavUid: row.caldavUid,
      resourceFilename: row.caldavResourceFilename,
      googleEventId: row.googleEventId,
      action: "update",
    }).catch(() => {});
    // Re-embed if title or description changed
    if (v.title !== undefined || v.description !== undefined) {
      generateAndStoreEmbedding(
        row.id,
        buildEmbeddingText(row.title, row.description)
      ).catch(() => {});
    }
    return c.json({ task: withTaskApiFields(row) });
  })
  .delete("/:id", async (c) => {
    const idParsed = uuidParam.safeParse(c.req.param("id"));
    if (!idParsed.success) {
      return c.json({ error: "invalid id" }, 400);
    }
    const id = idParsed.data;
    const userId = c.get("userId");
    const [row] = await db
      .delete(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
      .returning();
    if (!row) {
      return c.json({ error: "not found" }, 404);
    }
    await enqueueTaskCalendarSync({
      userId: row.userId,
      taskId: row.id,
      caldavUid: row.caldavUid,
      resourceFilename: row.caldavResourceFilename,
      googleEventId: row.googleEventId,
      action: "delete",
    }).catch(() => {});
    // Cleanup stale embedding
    deleteStaleEmbedding(row.id).catch(() => {});
    return c.json({ ok: true });
  });
