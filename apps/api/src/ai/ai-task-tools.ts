import { and, asc, eq, isNull } from "drizzle-orm";
import type OpenAI from "openai";
import { db } from "../db/client.js";
import { areas, tasks } from "../db/schema.js";
import { enqueueTaskCalendarSync } from "../queues/definitions.js";
import { rollupParentTaskStatus } from "../services/task-rollup.js";

const STATUS_ENUM = [
  "backlog",
  "todo",
  "in_progress",
  "done",
  "cancelled",
  "blocked",
] as const;

function addDaysISO(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

export const PLANNER_CHAT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "listTasks",
      description:
        "List the user's tasks (main tasks only, not subtasks). Filter by status and/or scheduled date.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: [...STATUS_ENUM] },
          scheduledDate: { type: "string", description: "YYYY-MM-DD" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createTask",
      description: "Create a new task. Use default area if areaId omitted (first area by sort order).",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          areaId: { type: "string", description: "UUID" },
          status: { type: "string", enum: [...STATUS_ENUM] },
          priority: { type: "string", enum: ["urgent", "high", "normal", "low"] },
          energyLevel: {
            type: "string",
            enum: ["deep_work", "shallow", "admin", "quick_win"],
            description: "Cognitive / focus type (legacy field)",
          },
          workDepth: { type: "string", enum: ["shallow", "normal", "deep"] },
          physicalEnergy: { type: "string", enum: ["low", "medium", "high"] },
          scheduledDate: { type: "string" },
          scheduledStartTime: { type: "string", description: "HH:MM or HH:MM:SS" },
          scheduledEndTime: { type: "string" },
          dueDate: { type: "string" },
          recurrenceRule: { type: "string", description: "iCal RRULE e.g. FREQ=DAILY or FREQ=WEEKLY" },
          estimatedMinutes: { type: "integer" },
          description: { type: "string" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "updateTask",
      description: "Update an existing task by id (must belong to the user).",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          title: { type: "string" },
          status: { type: "string", enum: [...STATUS_ENUM] },
          priority: { type: "string", enum: ["urgent", "high", "normal", "low"] },
          energyLevel: {
            type: "string",
            enum: ["deep_work", "shallow", "admin", "quick_win"],
          },
          workDepth: { type: "string", enum: ["shallow", "normal", "deep"] },
          physicalEnergy: { type: "string", enum: ["low", "medium", "high"] },
          scheduledDate: { type: "string", description: "YYYY-MM-DD or empty to clear" },
          scheduledStartTime: { type: "string" },
          scheduledEndTime: { type: "string" },
          dueDate: { type: "string" },
          recurrenceRule: { type: "string" },
          estimatedMinutes: { type: "integer" },
          description: { type: "string" },
        },
        required: ["taskId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "deleteTask",
      description: "Permanently delete a task by id.",
      parameters: {
        type: "object",
        properties: { taskId: { type: "string" } },
        required: ["taskId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rescheduleTasks",
      description:
        "Assign sequential scheduled dates to tasks (e.g. spread across days). stepDays defaults to 1.",
      parameters: {
        type: "object",
        properties: {
          taskIds: { type: "array", items: { type: "string" } },
          startDate: { type: "string", description: "YYYY-MM-DD for the first task" },
          stepDays: { type: "integer", minimum: 1, maximum: 30 },
        },
        required: ["taskIds", "startDate"],
      },
    },
  },
];

export async function executePlannerTool(
  name: string,
  args: unknown,
  userId: string
): Promise<unknown> {
  const obj = args && typeof args === "object" ? (args as Record<string, unknown>) : {};

  switch (name) {
    case "listTasks": {
      const limit = Math.min(Math.max(Number(obj.limit) || 50, 1), 100);
      const conditions = [eq(tasks.userId, userId), isNull(tasks.parentTaskId)];
      if (typeof obj.status === "string" && STATUS_ENUM.includes(obj.status as (typeof STATUS_ENUM)[number])) {
        conditions.push(eq(tasks.status, obj.status as (typeof STATUS_ENUM)[number]));
      }
      if (typeof obj.scheduledDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.scheduledDate)) {
        conditions.push(eq(tasks.scheduledDate, obj.scheduledDate));
      }
      const rows = await db.query.tasks.findMany({
        where: and(...conditions),
        orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.createdAt)],
        limit,
      });
      return {
        count: rows.length,
        tasks: rows.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          energyLevel: t.energyLevel,
          workDepth: t.workDepth,
          physicalEnergy: t.physicalEnergy,
          scheduledDate: t.scheduledDate,
          dueDate: t.dueDate,
          scheduledStartTime: t.scheduledStartTime,
          scheduledEndTime: t.scheduledEndTime,
          recurring: Boolean(t.recurrenceRule?.trim()),
          areaId: t.areaId,
        })),
      };
    }
    case "createTask": {
      const title = typeof obj.title === "string" ? obj.title.trim().slice(0, 500) : "";
      if (!title) return { error: "title required" };
      let areaId = typeof obj.areaId === "string" ? obj.areaId : null;
      if (areaId) {
        const ok = await db
          .select({ id: areas.id })
          .from(areas)
          .where(and(eq(areas.id, areaId), eq(areas.userId, userId)))
          .limit(1);
        if (!ok.length) return { error: "area not found for user" };
      } else {
        const [first] = await db
          .select({ id: areas.id })
          .from(areas)
          .where(eq(areas.userId, userId))
          .orderBy(asc(areas.sortOrder))
          .limit(1);
        if (!first) return { error: "no areas — seed the database" };
        areaId = first.id;
      }
      const status =
        typeof obj.status === "string" && STATUS_ENUM.includes(obj.status as (typeof STATUS_ENUM)[number])
          ? (obj.status as (typeof STATUS_ENUM)[number])
          : "todo";
      const [row] = await db
        .insert(tasks)
        .values({
          userId,
          areaId: areaId!,
          title,
          status,
          priority:
            obj.priority === "urgent" ||
            obj.priority === "high" ||
            obj.priority === "normal" ||
            obj.priority === "low"
              ? obj.priority
              : "normal",
          energyLevel:
            obj.energyLevel === "deep_work" ||
            obj.energyLevel === "shallow" ||
            obj.energyLevel === "admin" ||
            obj.energyLevel === "quick_win"
              ? obj.energyLevel
              : "admin",
          workDepth:
            obj.workDepth === "shallow" || obj.workDepth === "normal" || obj.workDepth === "deep"
              ? obj.workDepth
              : "normal",
          physicalEnergy:
            obj.physicalEnergy === "low" || obj.physicalEnergy === "medium" || obj.physicalEnergy === "high"
              ? obj.physicalEnergy
              : "medium",
          taskType: "main",
          scheduledDate: typeof obj.scheduledDate === "string" ? obj.scheduledDate : null,
          scheduledStartTime: typeof obj.scheduledStartTime === "string" ? obj.scheduledStartTime : null,
          scheduledEndTime: typeof obj.scheduledEndTime === "string" ? obj.scheduledEndTime : null,
          dueDate: typeof obj.dueDate === "string" ? obj.dueDate : null,
          recurrenceRule: typeof obj.recurrenceRule === "string" ? obj.recurrenceRule : null,
          estimatedMinutes: typeof obj.estimatedMinutes === "number" ? obj.estimatedMinutes : null,
          description: typeof obj.description === "string" ? obj.description : null,
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
      return { ok: true, task: { id: row.id, title: row.title, status: row.status } };
    }
    case "updateTask": {
      const taskId = typeof obj.taskId === "string" ? obj.taskId : "";
      if (!taskId) return { error: "taskId required" };
      const existing = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, taskId), eq(tasks.userId, userId)),
      });
      if (!existing) return { error: "not found" };

      const updates: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
      if (typeof obj.title === "string") updates.title = obj.title.trim().slice(0, 500);
      if (
        typeof obj.status === "string" &&
        STATUS_ENUM.includes(obj.status as (typeof STATUS_ENUM)[number])
      ) {
        updates.status = obj.status as (typeof STATUS_ENUM)[number];
        updates.completedAt = obj.status === "done" ? new Date() : null;
      }
      if (
        obj.priority === "urgent" ||
        obj.priority === "high" ||
        obj.priority === "normal" ||
        obj.priority === "low"
      ) {
        updates.priority = obj.priority;
      }
      if (
        obj.energyLevel === "deep_work" ||
        obj.energyLevel === "shallow" ||
        obj.energyLevel === "admin" ||
        obj.energyLevel === "quick_win"
      ) {
        updates.energyLevel = obj.energyLevel;
      }
      if (obj.workDepth === "shallow" || obj.workDepth === "normal" || obj.workDepth === "deep") {
        updates.workDepth = obj.workDepth;
      }
      if (
        obj.physicalEnergy === "low" ||
        obj.physicalEnergy === "medium" ||
        obj.physicalEnergy === "high"
      ) {
        updates.physicalEnergy = obj.physicalEnergy;
      }
      const setStr = (k: keyof typeof tasks.$inferInsert, v: unknown) => {
        if (v === undefined) return;
        if (v === "") {
          (updates as Record<string, unknown>)[k] = null;
          return;
        }
        if (typeof v === "string") (updates as Record<string, unknown>)[k] = v;
      };
      setStr("scheduledDate", obj.scheduledDate);
      setStr("scheduledStartTime", obj.scheduledStartTime);
      setStr("scheduledEndTime", obj.scheduledEndTime);
      setStr("dueDate", obj.dueDate);
      setStr("recurrenceRule", obj.recurrenceRule);
      setStr("description", obj.description);
      if (obj.estimatedMinutes === null) updates.estimatedMinutes = null;
      else if (typeof obj.estimatedMinutes === "number") updates.estimatedMinutes = obj.estimatedMinutes;

      const [row] = await db.update(tasks).set(updates).where(eq(tasks.id, taskId)).returning();
      if (row.parentTaskId) await rollupParentTaskStatus(db, row.parentTaskId);
      await enqueueTaskCalendarSync({
        userId: row.userId,
        taskId: row.id,
        caldavUid: row.caldavUid,
        resourceFilename: row.caldavResourceFilename,
        googleEventId: row.googleEventId,
        action: "update",
      }).catch(() => {});
      return { ok: true, task: { id: row.id, title: row.title, status: row.status } };
    }
    case "deleteTask": {
      const taskId = typeof obj.taskId === "string" ? obj.taskId : "";
      if (!taskId) return { error: "taskId required" };
      const [row] = await db
        .delete(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
        .returning();
      if (!row) return { error: "not found" };
      if (row.parentTaskId) await rollupParentTaskStatus(db, row.parentTaskId);
      await enqueueTaskCalendarSync({
        userId: row.userId,
        taskId: row.id,
        caldavUid: row.caldavUid,
        resourceFilename: row.caldavResourceFilename,
        googleEventId: row.googleEventId,
        action: "delete",
      }).catch(() => {});
      return { ok: true, deletedId: row.id };
    }
    case "rescheduleTasks": {
      const ids = Array.isArray(obj.taskIds) ? obj.taskIds.filter((x): x is string => typeof x === "string") : [];
      const startDate = typeof obj.startDate === "string" ? obj.startDate : "";
      if (!ids.length) return { error: "taskIds required" };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return { error: "startDate must be YYYY-MM-DD" };
      const step = typeof obj.stepDays === "number" ? Math.min(Math.max(obj.stepDays, 1), 30) : 1;
      const assignments: { id: string; scheduledDate: string }[] = [];
      for (let i = 0; i < ids.length; i++) {
        const taskId = ids[i]!;
        const newDate = addDaysISO(startDate, i * step);
        const [row] = await db
          .update(tasks)
          .set({ scheduledDate: newDate, updatedAt: new Date() })
          .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
          .returning();
        if (row) {
          assignments.push({ id: row.id, scheduledDate: newDate });
          await enqueueTaskCalendarSync({
            userId: row.userId,
            taskId: row.id,
            caldavUid: row.caldavUid,
            resourceFilename: row.caldavResourceFilename,
            googleEventId: row.googleEventId,
            action: "update",
          }).catch(() => {});
        }
      }
      return { ok: true, updated: assignments.length, assignments };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}
