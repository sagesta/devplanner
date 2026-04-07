import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type OpenAI from "openai";
import { db } from "../db/client.js";
import { areas, tasks } from "../db/schema.js";
import { enqueueTaskCalendarSync } from "../queues/definitions.js";
import { rollupParentTaskStatus } from "../services/task-rollup.js";
import { liftStaleScheduleYear } from "./schedule-date-normalize.js";

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

function normYmd(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function liftYmd(v: unknown): string | null {
  const s = normYmd(v);
  return s ? liftStaleScheduleYear(s) : null;
}

async function resolveAreaForUser(
  userId: string,
  areaId: unknown,
  areaKind: unknown
): Promise<{ id: string } | { error: string }> {
  if (typeof areaId === "string" && areaId.trim()) {
    const ok = await db
      .select({ id: areas.id })
      .from(areas)
      .where(and(eq(areas.id, areaId.trim()), eq(areas.userId, userId)))
      .limit(1);
    if (!ok.length) return { error: "area not found for user" };
    return { id: areaId.trim() };
  }

  const kind = typeof areaKind === "string" ? areaKind.trim().toLowerCase() : "";
  const aliases: Record<string, string[]> = {
    work: ["work"],
    personal: ["personal"],
    sidequest: ["sidequest", "side quest"],
  };

  if (kind && aliases[kind]) {
    const names = aliases[kind]!;
    const rows = await db.query.areas.findMany({
      where: eq(areas.userId, userId),
      orderBy: (a, { asc: aAsc }) => [aAsc(a.sortOrder), aAsc(a.name)],
    });
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    for (const n of names) {
      const hit = rows.find((r) => norm(r.name) === norm(n));
      if (hit) return { id: hit.id };
    }
    if (kind === "sidequest") {
      const maxSort = rows.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), -1);
      const [ins] = await db
        .insert(areas)
        .values({
          userId,
          name: "Sidequest",
          color: "#9333ea",
          sortOrder: maxSort + 1,
        })
        .returning({ id: areas.id });
      if (!ins) return { error: "could not create Sidequest area" };
      return { id: ins.id };
    }
    return { error: `no "${names[0]}" area — create it or pass areaId` };
  }

  const [first] = await db
    .select({ id: areas.id })
    .from(areas)
    .where(eq(areas.userId, userId))
    .orderBy(asc(areas.sortOrder))
    .limit(1);
  if (!first) return { error: "no areas — seed the database" };
  return { id: first.id };
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
      description:
        "Create a new task. Prefer areaKind work|personal|sidequest for life buckets (matches area name; creates Sidequest if missing). Otherwise areaId or first area by sort.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          areaId: { type: "string", description: "UUID" },
          areaKind: {
            type: "string",
            enum: ["work", "personal", "sidequest"],
            description: "Maps to user's area by name (case-insensitive)",
          },
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
          areaId: { type: "string", description: "UUID — move task to this area" },
          areaKind: {
            type: "string",
            enum: ["work", "personal", "sidequest"],
            description: "Move task to area by name (creates Sidequest if missing)",
          },
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
  {
    type: "function",
    function: {
      name: "addSubtask",
      description: "Add a subtask to an existing task",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          title: { type: "string" },
          completed: { type: "boolean" }
        },
        required: ["taskId", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "assignTaskToSprint",
      description: "Assign an existing task to a sprint by ID",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          sprintId: { type: "string" }
        },
        required: ["taskId", "sprintId"],
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
      const conditions = [eq(tasks.userId, userId), isNull(tasks.parentTaskId), isNull(tasks.deletedAt)];
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
      const areaIds = [...new Set(rows.map((r) => r.areaId))];
      const areaRows =
        areaIds.length > 0
          ? await db.query.areas.findMany({
              where: and(eq(areas.userId, userId), inArray(areas.id, areaIds)),
            })
          : [];
      const areaNameById = new Map(areaRows.map((a) => [a.id, a.name]));
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
          areaName: areaNameById.get(t.areaId) ?? null,
        })),
      };
    }
    case "createTask": {
      const title = typeof obj.title === "string" ? obj.title.trim().slice(0, 500) : "";
      if (!title) return { error: "title required" };
      const areaRes = await resolveAreaForUser(userId, obj.areaId, obj.areaKind);
      if ("error" in areaRes) return { error: areaRes.error };
      const areaId = areaRes.id;
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
          scheduledDate: liftYmd(obj.scheduledDate),
          scheduledStartTime: typeof obj.scheduledStartTime === "string" ? obj.scheduledStartTime : null,
          scheduledEndTime: typeof obj.scheduledEndTime === "string" ? obj.scheduledEndTime : null,
          dueDate: liftYmd(obj.dueDate),
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
        where: and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)),
      });
      if (!existing) return { error: "not found" };

      const updates: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
      if (obj.areaId !== undefined || obj.areaKind !== undefined) {
        const hasId = typeof obj.areaId === "string" && obj.areaId.trim().length > 0;
        const hasKind = typeof obj.areaKind === "string" && obj.areaKind.trim().length > 0;
        if (hasId || hasKind) {
          const ar = await resolveAreaForUser(userId, hasId ? obj.areaId : undefined, hasKind ? obj.areaKind : undefined);
          if ("error" in ar) return { error: ar.error };
          updates.areaId = ar.id;
        }
      }
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
      const setDateYmd = (k: "scheduledDate" | "dueDate", v: unknown) => {
        if (v === undefined) return;
        if (v === "") {
          (updates as Record<string, unknown>)[k] = null;
          return;
        }
        if (typeof v !== "string") return;
        const t = v.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return;
        (updates as Record<string, unknown>)[k] = liftStaleScheduleYear(t);
      };
      setDateYmd("scheduledDate", obj.scheduledDate);
      setDateYmd("dueDate", obj.dueDate);
      setStr("scheduledStartTime", obj.scheduledStartTime);
      setStr("scheduledEndTime", obj.scheduledEndTime);
      setStr("recurrenceRule", obj.recurrenceRule);
      setStr("description", obj.description);
      if (obj.estimatedMinutes === null) updates.estimatedMinutes = null;
      else if (typeof obj.estimatedMinutes === "number") updates.estimatedMinutes = obj.estimatedMinutes;

      const [row] = await db
        .update(tasks)
        .set(updates)
        .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
        .returning();
      if (!row) return { error: "not found" };
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
      const now = new Date();
      const [row] = await db
        .update(tasks)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
        .returning();
      if (!row) return { error: "not found" };
      await db
        .update(tasks)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(tasks.userId, userId), eq(tasks.parentTaskId, taskId), isNull(tasks.deletedAt)));
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
      const rawStart = typeof obj.startDate === "string" ? obj.startDate.trim() : "";
      if (!ids.length) return { error: "taskIds required" };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawStart)) return { error: "startDate must be YYYY-MM-DD" };
      const startDate = liftStaleScheduleYear(rawStart);
      const step = typeof obj.stepDays === "number" ? Math.min(Math.max(obj.stepDays, 1), 30) : 1;
      const assignments: { id: string; scheduledDate: string }[] = [];
      for (let i = 0; i < ids.length; i++) {
        const taskId = ids[i]!;
        const newDate = addDaysISO(startDate, i * step);
        const [row] = await db
          .update(tasks)
          .set({ scheduledDate: newDate, updatedAt: new Date() })
          .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
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
    case "addSubtask": {
      const taskId = typeof obj.taskId === "string" ? obj.taskId : "";
      const title = typeof obj.title === "string" ? obj.title.trim().slice(0, 500) : "";
      const completed = typeof obj.completed === "boolean" ? obj.completed : false;
      if (!taskId) return { error: "taskId required" };
      if (!title) return { error: "title required" };

      const existing = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)),
      });
      if (!existing) return { error: "parent task not found" };

      const status = completed ? "done" : "todo";

      const [row] = await db
        .insert(tasks)
        .values({
          userId,
          areaId: existing.areaId,
          parentTaskId: taskId,
          taskType: "subtask",
          title,
          status,
          priority: existing.priority,
        })
        .returning();
      if (!row) return { error: "failed to create subtask" };
      await rollupParentTaskStatus(db, taskId);
      return { ok: true, task: { id: row.id, title: row.title, status: row.status } };
    }
    case "assignTaskToSprint": {
      const taskId = typeof obj.taskId === "string" ? obj.taskId : "";
      const sprintId = typeof obj.sprintId === "string" ? obj.sprintId : "";
      if (!taskId) return { error: "taskId required" };
      if (!sprintId) return { error: "sprintId required" };

      const existing = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)),
      });
      if (!existing) return { error: "task not found" };

      const [row] = await db
        .update(tasks)
        .set({ sprintId, updatedAt: new Date() })
        .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
        .returning();
      if (!row) return { error: "not found" };
      return { ok: true, task: { id: row.id, title: row.title, sprintId: row.sprintId } };
    }
    default:
      return { error: `unknown tool ${name}` };

  }
}
