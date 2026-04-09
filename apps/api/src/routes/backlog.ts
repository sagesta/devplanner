import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client.js";
import { tags, taskTags, tasks, subtasks } from "../db/schema.js";
import type { AppEnv } from "../types.js";

function withTaskApiFields<T extends { recurrenceRule: string | null; deletedAt?: Date | null }>(t: T) {
  const { deletedAt: _d, ...rest } = t;
  return {
    ...rest,
    recurring: Boolean(t.recurrenceRule?.trim()),
  };
}

const taskActive = isNull(tasks.deletedAt);

export const backlogRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const userId = c.get("userId");
  const rows = await db.query.tasks.findMany({
    where: and(eq(tasks.userId, userId), isNull(tasks.sprintId), taskActive),
    orderBy: (t, { asc: ascFn }) => [ascFn(t.sortOrder), ascFn(t.createdAt)],
  });
  // Batch load tags
  const blIds = rows.map((t) => t.id);
  const blTagMap: Record<string, Array<{ id: number; name: string; color: string | null }>> = {};
  const blSubtaskMap: Record<string, any[]> = {};

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

    const blSubs = await db.query.subtasks.findMany({
      where: inArray(subtasks.taskId, blIds),
      orderBy: (s, { asc: ascFn }) => [ascFn(s.createdAt)]
    });
    for (const s of blSubs) {
      if (!blSubtaskMap[s.taskId]) blSubtaskMap[s.taskId] = [];
      blSubtaskMap[s.taskId].push(s);
    }
  }
  return c.json({
    tasks: rows.map((t) => ({
      ...withTaskApiFields(t),
      _tags: blTagMap[t.id] ?? [],
      _subtasks: blSubtaskMap[t.id] ?? [],
      _subtasksDone: (blSubtaskMap[t.id] ?? []).filter((s: any) => s.completed).length,
      _subtasksTotal: (blSubtaskMap[t.id] ?? []).length
    }))
  });
});
