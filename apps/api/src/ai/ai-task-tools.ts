import { and, asc, eq, ilike, inArray, isNull } from "drizzle-orm";
import type OpenAI from "openai";
import { db } from "../db/client.js";
import { areas, sprints, tasks, subtasks } from "../db/schema.js";
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
        "List the user's tasks. Filter by status and/or scheduled date. Always call this before addSubtask/createSubtasks to find the correct taskId.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: [...STATUS_ENUM] },
          scheduledDate: { type: "string", description: "YYYY-MM-DD — returns tasks that have subtasks scheduled on this date" },
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
        "Create a new task. Can optionally schedule it via an implicit subtask if scheduledDate is provided.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          areaId: { type: "string", description: "UUID" },
          areaKind: {
            type: "string",
            enum: ["work", "personal", "sidequest"],
          },
          status: { type: "string", enum: [...STATUS_ENUM] },
          priority: { type: "string", enum: ["urgent", "high", "normal", "low"] },
          energyLevel: {
            type: "string",
            enum: ["deep_work", "shallow", "admin", "quick_win"],
          },
          workDepth: { type: "string", enum: ["shallow", "normal", "deep"] },
          physicalEnergy: { type: "string", enum: ["low", "medium", "high"] },
          dueDate: { type: "string", description: "YYYY-MM-DD" },
          scheduledDate: { type: "string", description: "YYYY-MM-DD (creates implicit scheduled subtask)" },
          estimatedMinutes: { type: "integer" },
          recurrenceRule: { type: "string" },
          sprintId: { type: "string" },
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
          areaId: { type: "string" },
          areaKind: {
            type: "string",
            enum: ["work", "personal", "sidequest"],
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
          dueDate: { type: "string" },
          recurrenceRule: { type: "string" },
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
      name: "createSubtask",
      description:
        "Add a single step/subtask to an existing task. Use this to break down a task into executable steps. " +
        "Subtasks with scheduledDate appear in the Now view and Timeline. " +
        "You MUST call listTasks first to get the correct taskId.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "UUID of the parent task" },
          title: { type: "string", description: "The step title" },
          scheduledDate: { type: "string", description: "YYYY-MM-DD — which day to do this step" },
          scheduledTime: { type: "string", description: "HH:MM — optional time block" },
          estimatedMinutes: { type: "integer", description: "Estimated minutes for this step" },
          completed: { type: "boolean" }
        },
        required: ["taskId", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getSubtasks",
      description: "List all subtasks for a given task. You should use this to get subtask IDs before trying to update or delete them.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          taskTitle: { type: "string", description: "Use this if taskId is unknown but you know the parent task title" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "updateSubtask",
      description: "Update an existing subtask. You MUST provide the subtaskId.",
      parameters: {
        type: "object",
        properties: {
          subtaskId: { type: "string" },
          title: { type: "string" },
          completed: { type: "boolean" },
          scheduledDate: { type: "string", description: "YYYY-MM-DD" },
          scheduledTime: { type: "string", description: "HH:MM" },
          estimatedMinutes: { type: "integer" }
        },
        required: ["subtaskId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "deleteSubtask",
      description: "Delete a subtask by ID.",
      parameters: {
        type: "object",
        properties: {
          subtaskId: { type: "string" }
        },
        required: ["subtaskId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "createSubtasks",
      description:
        "Break a task into multiple steps at once. Use when user asks to plan, break down, or decompose a task. " +
        "Each subtask can optionally have a scheduledDate to appear in the Now view. " +
        "You MUST call listTasks first to get the correct taskId.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "UUID of the parent task" },
          subtasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "Step title" },
                scheduledDate: { type: "string", description: "YYYY-MM-DD" },
                scheduledTime: { type: "string", description: "HH:MM" },
                estimatedMinutes: { type: "integer" }
              },
              required: ["title"]
            },
            description: "List of steps to create"
          }
        },
        required: ["taskId", "subtasks"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "spreadSubtasksAcrossDays",
      description: "Create AI-distributed subtasks across a date range for a parent task. Good for spreading work out.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          subtaskTitles: { type: "array", items: { type: "string" } },
          startDate: { type: "string", description: "YYYY-MM-DD" },
          endDate: { type: "string", description: "YYYY-MM-DD" },
          maxPerDay: { type: "integer", default: 3, description: "Max subtasks per day" }
        },
        required: ["taskId", "subtaskTitles", "startDate", "endDate"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "scheduleTask",
      description: "Set the scheduledDate on a task that has no subtasks (by creating an implicit identical subtask).",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          scheduledDate: { type: "string", description: "YYYY-MM-DD" },
          estimatedMinutes: { type: "integer" }
        },
        required: ["taskId", "scheduledDate"]
      }
    }
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
  {
    type: "function",
    function: {
      name: "listSprints",
      description: "List the user's sprints to find a sprintId",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createSprint",
      description: "Create a new sprint.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          startDate: { type: "string", description: "YYYY-MM-DD" },
          endDate: { type: "string", description: "YYYY-MM-DD" },
          goal: { type: "string" }
        },
        required: ["name", "startDate", "endDate"]
      }
    }
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
      const conditions = [eq(tasks.userId, userId), isNull(tasks.deletedAt)];
      
      if (typeof obj.status === "string" && STATUS_ENUM.includes(obj.status as (typeof STATUS_ENUM)[number])) {
        conditions.push(eq(tasks.status, obj.status as (typeof STATUS_ENUM)[number]));
      }

      let subScheduledTaskIds: string[] | null = null;
      if (typeof obj.scheduledDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.scheduledDate)) {
        const subs = await db.query.subtasks.findMany({
          where: eq(subtasks.scheduledDate, obj.scheduledDate)
        });
        subScheduledTaskIds = subs.map(s => s.taskId);
        if (subScheduledTaskIds.length === 0) return { count: 0, tasks: [] };
        conditions.push(inArray(tasks.id, subScheduledTaskIds));
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
          dueDate: t.dueDate,
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
          dueDate: liftYmd(obj.dueDate),
          recurrenceRule: typeof obj.recurrenceRule === "string" ? obj.recurrenceRule : null,
          sprintId: typeof obj.sprintId === "string" ? obj.sprintId : null,
          description: typeof obj.description === "string" ? obj.description : null,
        })
        .returning();

      // If scheduledDate is passed, immediately lazily wrap it in a subtask
      const scheduledDate = liftYmd(obj.scheduledDate);
      if (scheduledDate) {
         await db.insert(subtasks).values({
            taskId: row.id,
            title: title,
            scheduledDate,
            estimatedMinutes: typeof obj.estimatedMinutes === "number" ? obj.estimatedMinutes : null
         });
      }

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
      const setDateYmd = (k: "dueDate", v: unknown) => {
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
      setDateYmd("dueDate", obj.dueDate);
      setStr("recurrenceRule", obj.recurrenceRule);
      setStr("description", obj.description);

      const [row] = await db
        .update(tasks)
        .set(updates)
        .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
        .returning();
      if (!row) return { error: "not found" };
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
      
      // Cascading subtasks isn't strictly necessary for soft-deleting tasks since subtasks
      // are filtered out if parent is deleted, but we'll leave it simple.
      
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
    case "scheduleTask": {
      const taskId = typeof obj.taskId === "string" ? obj.taskId : "";
      const scheduledDate = typeof obj.scheduledDate === "string" ? liftYmd(obj.scheduledDate) : null;
      if (!taskId || !scheduledDate) return { error: "taskId and scheduledDate required" };

      const existing = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)),
      });
      if (!existing) return { error: "task not found" };

      const [sub] = await db.insert(subtasks).values({
        taskId,
        title: existing.title,
        scheduledDate,
        estimatedMinutes: typeof obj.estimatedMinutes === "number" ? obj.estimatedMinutes : null
      }).returning();
      
      return { ok: true, subtask: sub };
    }
    case "createSubtask": {
      const taskId = typeof obj.taskId === "string" ? obj.taskId : "";
      const title = typeof obj.title === "string" ? obj.title.trim().slice(0, 500) : "";
      const completed = typeof obj.completed === "boolean" ? obj.completed : false;
      const scheduledDate = typeof obj.scheduledDate === "string" ? liftYmd(obj.scheduledDate) : null;
      const scheduledTime = typeof obj.scheduledTime === "string" ? obj.scheduledTime : null;
      if (!taskId) return { error: "taskId required" };
      if (!title) return { error: "title required" };

      const existing = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)),
      });
      if (!existing) return { error: "parent task not found" };

      const [row] = await db
        .insert(subtasks)
        .values({
          taskId,
          title,
          completed,
          scheduledDate,
          scheduledTime,
          estimatedMinutes: typeof obj.estimatedMinutes === "number" ? obj.estimatedMinutes : null,
          completedAt: completed ? new Date() : null
        })
        .returning();
      if (!row) return { error: "failed to create subtask" };
      await rollupParentTaskStatus(db, taskId);
      return { ok: true, subtask: { id: row.id, title: row.title, completed: row.completed } };
    }
    case "createSubtasks": {
      const taskId = typeof obj.taskId === "string" ? obj.taskId : "";
      if (!taskId) return { error: "taskId required" };
      const subArr = Array.isArray(obj.subtasks) ? obj.subtasks : [];
      if (!subArr.length) return { error: "subtasks array required" };

      const existing = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)),
      });
      if (!existing) return { error: "parent task not found" };

      const inserts = await db.insert(subtasks).values(
         subArr.map((s: any) => ({
           taskId,
           title: typeof s.title === "string" ? s.title : "Untitled",
           scheduledDate: typeof s.scheduledDate === "string" ? liftYmd(s.scheduledDate) : null,
           scheduledTime: typeof s.scheduledTime === "string" ? s.scheduledTime : null,
           estimatedMinutes: typeof s.estimatedMinutes === "number" ? s.estimatedMinutes : null
         }))
      ).returning();

      await rollupParentTaskStatus(db, taskId);
      return { ok: true, count: inserts.length, subtasks: inserts.map(s => ({ id: s.id, title: s.title, scheduledDate: s.scheduledDate })) };
    }
    case "spreadSubtasksAcrossDays": {
      const taskId = typeof obj.taskId === "string" ? obj.taskId : "";
      if (!taskId) return { error: "taskId required" };
      const titles = Array.isArray(obj.subtaskTitles) ? obj.subtaskTitles.map(t => String(t)) : [];
      if (!titles.length) return { error: "subtaskTitles array required" };
      const rawStart = typeof obj.startDate === "string" ? obj.startDate : "";
      const rawEnd = typeof obj.endDate === "string" ? obj.endDate : "";
      if (!rawStart || !rawEnd) return { error: "startDate and endDate required" };
      const maxPerDay = typeof obj.maxPerDay === "number" ? obj.maxPerDay : 3;

      const existing = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)),
      });
      if (!existing) return { error: "parent task not found" };

      // Simplified spread: just assign 1 per day linearly without loading global loads for the AI tool
      // since the AI might just want to schedule them sequentially.
      const assigned = [];
      let currentISO = liftYmd(rawStart) ?? addDaysISO(new Date().toISOString().slice(0, 10), 0);
      let dayCount = 0;
      
      for (const t of titles) {
         assigned.push({
           taskId,
           title: t,
           scheduledDate: currentISO
         });
         dayCount++;
         if (dayCount >= maxPerDay) {
           currentISO = addDaysISO(currentISO, 1);
           dayCount = 0;
         }
      }

      const rows = await db.insert(subtasks).values(assigned).returning();
      await rollupParentTaskStatus(db, taskId);

      return { ok: true, subtasks: rows };
    }
    case "getSubtasks": {
      const parentTaskId = typeof obj.taskId === "string" ? obj.taskId : null;
      const term = typeof obj.taskTitle === "string" ? obj.taskTitle : null;
      
      let tid = parentTaskId;
      if (!tid && term) {
        const matches = await db.query.tasks.findMany({
          where: and(ilike(tasks.title, `%${term}%`), eq(tasks.userId, userId), isNull(tasks.deletedAt)),
          limit: 1
        });
        if (matches.length > 0) tid = matches[0].id;
      }
      
      if (!tid) return { error: "Could not identify parent task. Try calling listTasks first." };
      
      const subs = await db.query.subtasks.findMany({
        where: eq(subtasks.taskId, tid),
        orderBy: (s, { asc }) => [asc(s.createdAt)]
      });
      return { subtasks: subs };
    }
    case "updateSubtask": {
      const subtaskId = typeof obj.subtaskId === "string" ? obj.subtaskId : "";
      if (!subtaskId) return { error: "subtaskId required" };

      const existing = await db.query.subtasks.findFirst({
        where: eq(subtasks.id, subtaskId)
      });
      if (!existing) return { error: "subtask not found" };

      const updates: Record<string, unknown> = {};
      if (typeof obj.title === "string") updates.title = obj.title.trim().slice(0, 500);
      if (typeof obj.completed === "boolean") {
        updates.completed = obj.completed;
        updates.completedAt = obj.completed ? new Date() : null;
      }
      if (typeof obj.scheduledDate === "string") {
        updates.scheduledDate = obj.scheduledDate.trim() === "" ? null : liftYmd(obj.scheduledDate);
      }
      if (typeof obj.scheduledTime === "string") updates.scheduledTime = obj.scheduledTime;
      if (typeof obj.estimatedMinutes === "number") updates.estimatedMinutes = obj.estimatedMinutes;

      const [row] = await db.update(subtasks).set(updates).where(eq(subtasks.id, subtaskId)).returning();
      if (row) await rollupParentTaskStatus(db, row.taskId);
      return { ok: true, subtask: row };
    }
    case "deleteSubtask": {
      const subtaskId = typeof obj.subtaskId === "string" ? obj.subtaskId : "";
      if (!subtaskId) return { error: "subtaskId required" };
      
      const existing = await db.query.subtasks.findFirst({ where: eq(subtasks.id, subtaskId) });
      if (!existing) return { error: "subtask not found" };

      await db.delete(subtasks).where(eq(subtasks.id, subtaskId));
      await rollupParentTaskStatus(db, existing.taskId);
      return { ok: true, deletedId: subtaskId };
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
    case "listSprints": {
      const rows = await db.select().from(sprints).where(eq(sprints.userId, userId));
      return { sprints: rows.map(s => ({ id: s.id, name: s.name, status: s.status, startDate: s.startDate, endDate: s.endDate })) };
    }
    case "createSprint": {
      const name = typeof obj.name === "string" ? obj.name.trim() : "";
      const startDate = typeof obj.startDate === "string" ? obj.startDate.trim() : "";
      const endDate = typeof obj.endDate === "string" ? obj.endDate.trim() : "";
      const goal = typeof obj.goal === "string" ? obj.goal.trim() : null;
      if (!name || !startDate || !endDate) return { error: "name, startDate, endDate required" };

      const existingSprints = await db.query.sprints.findMany({
        where: eq(sprints.userId, userId),
      });
      const hasActive = existingSprints.some(s => s.status === "active");

      const [row] = await db.insert(sprints).values({
        userId,
        name,
        startDate,
        endDate,
        goal,
        status: hasActive ? "planned" : "active",
      }).returning();
      if (!row) return { error: "failed to create sprint" };
      return { ok: true, sprint: { id: row.id, name: row.name, status: row.status } };
    }
    default:
      return { error: `unknown tool ${name}` };

  }
}
