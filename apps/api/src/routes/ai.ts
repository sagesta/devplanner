import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { streamText } from "hono/streaming";
import OpenAI from "openai";
import { z } from "zod";
import { executePlannerTool, PLANNER_CHAT_TOOLS } from "../ai/ai-task-tools.js";
import { retrieveRagContext, formatRagContext, batchGenerateEmbeddings } from "../ai/embeddings.js";
import { logAiCall } from "../ai/logCall.js";
import { openaiJsonCompletion } from "../ai/openai-json.js";
import { db } from "../db/client.js";
import { aiCallLog, tasks } from "../db/schema.js";
import type { AppEnv } from "../types.js";

const parseDumpBody = z.object({
  raw: z.string().min(1),
});

const breakdownBody = z.object({
  title: z.string().min(1),
  context: z.string().optional(),
});

const chatBody = z.object({
  message: z.string().min(1),
  model: z.string().optional(),
  enableTools: z.boolean().optional(),
  /** User's current physical energy for task suggestions */
  currentPhysicalEnergy: z.enum(["low", "medium", "high"]).optional(),
  /** Which app view the user is currently on */
  current_view: z
    .enum(["Backlog", "Sprints", "Board", "Now", "Timeline", "Table", "Review"])
    .optional(),
  /** Task IDs the user has selected or is focused on */
  selected_task_ids: z.array(z.string()).optional(),
  /** Conversational history (to preserve context across multiple turns) */
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
    .optional(),
});

const ALLOWED_CHAT_MODELS = new Set(["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-4"]);

function resolveChatModel(requested?: string): string {
  const fallback = process.env.OPENAI_SMART_MODEL ?? "gpt-4o";
  if (requested && ALLOWED_CHAT_MODELS.has(requested)) return requested;
  return fallback;
}

async function runPlannerToolLoop(
  client: OpenAI,
  model: string,
  userId: string,
  userMessage: string,
  opts?: {
    currentPhysicalEnergy?: "low" | "medium" | "high";
    current_view?: string;
    selected_task_ids?: string[];
    history?: { role: "user" | "assistant"; content: string }[];
  }
): Promise<{ text: string; approxChars: number }> {
  const todayIso = new Date().toISOString().split("T")[0]!;

  const energyHint = opts?.currentPhysicalEnergy
    ? `\n\nENERGY: The user's current energy level is ${opts.currentPhysicalEnergy}. Match task cognitive load: prefer shallow/admin tasks for Low energy, deep_work tasks for High energy.`
    : "";

  const viewHint = opts?.current_view
    ? `\n\nCURRENT VIEW: The user is on the "${opts.current_view}" view. Tailor your response accordingly:\n` +
      `- Backlog → help clarify, group, assign tasks to sprints, or defer them.\n` +
      `- Sprints/Board → help choose monthly/weekly priorities, assign to sprint.\n` +
      `- Table → bulk operations: normalize, add fields, generate subtasks for many tasks.\n` +
      `- Now → trim to 3–5 items; suggest moving excess out of Now.\n` +
      `- Timeline → sanity-check due dates; spread tasks realistically over days.\n` +
      `- Review → summarize completed/slipped; suggest carry-forward tasks.`
    : "";

  const selectionHint =
    opts?.selected_task_ids?.length
      ? `\n\nSELECTED TASKS: The user is focused on task IDs: ${opts.selected_task_ids.join(", ")}. Prefer operating on these unless they ask for something broader.`
      : "";

  const systemPrompt =
    `You are DevPlanner RAG Agent — an ADHD-friendly planning assistant embedded in DevPlanner. Today is ${todayIso}.` +

    `\n\n═══ ARCHITECTURE (read carefully) ═══` +
    `\n- The system uses 3 levels: Sprint → Task → Subtask.` +
    `\n- TASKS are the parent unit (title, priority, sprintId, dueDate). They do NOT have a scheduledDate.` +
    `\n- SUBTASKS are the atomic execution units (title, completed, estimatedMinutes).` +
    `\n- The Now view shows today's focus. Timeline shows task due dates across the calendar.` +
    `\n- To schedule work for a specific day, CREATE SUBTASKS — do not modify the parent task's dueDate.` +
    `\n- A task with no subtasks is a standalone unit visible in Now/Timeline only via its dueDate.` +

    `\n\n═══ DATA MODEL — tasks + subtasks (Case 2) ═══` +
    `\nDevPlanner uses TWO separate tables. Never confuse them.` +
    `\n\ntasks table key fields:` +
    `\n  id, userId, sprintId, areaId, title,` +
    `\n  status (enum: backlog|todo|in_progress|done|cancelled|blocked),` +
    `\n  priority, energyLevel, workDepth, physicalEnergy,` +
    `\n  dueDate (YYYY-MM-DD), completedAt, deletedAt (soft-delete — always filter isNull(deletedAt))` +
    `\n  → A task is done when status = 'done'.` +

    `\n\nsubtasks table key fields:` +
    `\n  id, taskId (FK → tasks.id), title,` +
    `\n  completed (BOOLEAN — NOT a status enum), estimatedMinutes, completedAt, createdAt` +
    `\n  → A subtask is done when completed = true.` +
    `\n  → Subtasks have NO dueDate, NO scheduledDate, NO status enum.` +

    `\n\nRelationship: tasks.id = subtasks.taskId (one-to-many). No parent_id on tasks.` +

    `\n\nCompletion rules (authoritative):` +
    `\n  • Task HAS subtasks → count each subtask as one unit; task is done only when ALL subtasks.completed = true.` +
    `\n  • Task has NO subtasks → the task is one unit; check tasks.status = 'done'.` +
    `\n  • total_units   = (subtask rows in scope) + (tasks with 0 subtasks in scope)` +
    `\n  • completed_units = (subtasks with completed=true) + (standalone tasks with status='done')` +
    `\n  • completion_percentage = round(completed_units / GREATEST(total_units,1) * 100)` +

    `\n\nspreadSubtasksAcrossDays note:` +
    `\n  Subtasks have NO scheduledDate column. This tool returns a distribution PLAN only —` +
    `\n  narrate it to the user; it does NOT mutate any date field in the DB.` +

    `\n\n═══ PLANNING HORIZONS ═══` +
    `\n• Monthly: tasks in the active sprint are this month's goals. Parent tasks with many subtasks are "projects".` +
    `\n• Weekly: sprint tasks with dueDate in the next 7 days are candidates for this week's focus.` +
    `\n• Daily/Now: keep to 3–5 items. Prefer a mix of energy levels (shallow + deep_work).` +
    `\n• Subtasks: smallest doable unit. Parent progress = done subtasks / total subtasks.` +

    `\n\n═══ COMPLETION LOGIC (for progress circles / donut charts) ═══` +
    `\nSubtasks are the PRIMARY units of work for all completion stats.` +
    `\n- If a task HAS subtasks: it is complete only when ALL its subtasks are completed.` +
    `\n  Count each subtask individually as a unit (not the parent).` +
    `\n- If a task has NO subtasks: the task itself is one unit; use its status.` +
    `\n- total_units = (all subtasks in scope) + (standalone tasks with no subtasks in scope)` +
    `\n- completed_units = (completed subtasks in scope) + (done standalone tasks in scope)` +
    `\n- completion_percentage = round(completed_units / total_units * 100) or 0 if total = 0` +
    `\n- Use getProgressStats tool to compute this. Always return donut data in this shape:` +
    `\n  { "completed": <pct>, "remaining": <100-pct> }` +

    `\n\n═══ WORKFLOW RULES ═══` +
    `\n- Break down a task: call listTasks → createSubtasks with meaningful steps.` +
    `\n- Spread subtasks over days: use spreadSubtasksAcrossDays (divides evenly across numDays).` +
    `\n- Reorganize / Split Tasks: If asked to actually split a large list of subtasks into separate Day/Phase tasks, create those standalone tasks, then use moveSubtasks to assign subtasks to them.` +
    `\n- Bulk delete: listTasks with status filter → deleteTask for each.` +
    `\n- Always call listSprints before assigning tasks to sprints.` +
    `\n- Overdue = dueDate before today AND status != done.` +
    `\n- Use areaKind: work | personal | sidequest to resolve areas automatically.` +

    `\n\n═══ OUTPUT FORMAT ═══` +
    `\nWhen making structural changes, after the tool calls finish, summarise in 1–2 ADHD-friendly sentences.` +
    `\nWhen computing stats, include the JSON in your reply so the UI can render circles:` +
    `\n{ "progress": { "weekly": { "total_units":N, "completed_units":N, "completion_percentage":N, "donut_segments":{"completed":N,"remaining":N} }, "monthly":{...}, "sprint":{...} } }` +

    energyHint +
    viewHint +
    selectionHint;

  // ── RAG: retrieve semantically similar tasks before first LLM call ──
  const ragTasks = await retrieveRagContext(userId, userMessage, 8);
  const ragBlock = formatRagContext(ragTasks);

  const fullPrompt = systemPrompt + ragBlock;

  const priorMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
    (opts?.history ?? []).map((m) => ({
      role: m.role,
      content: m.content || "(No response)",
    }));

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: fullPrompt },
    ...priorMessages,
    { role: "user", content: userMessage.slice(0, 8000) },
  ];

  let approxChars = userMessage.length;

  for (let round = 0; round < 8; round++) {
    const resp = await client.chat.completions.create({
      model,
      messages,
      tools: PLANNER_CHAT_TOOLS,
      tool_choice: "auto",
      max_tokens: 2000,
    });
    const msg = resp.choices[0]?.message;
    if (!msg) break;

    if (msg.tool_calls?.length) {
      messages.push(msg);
      for (const tc of msg.tool_calls) {
        if (tc.type !== "function") continue;
        let args: unknown = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          args = {};
        }
        const result = await executePlannerTool(tc.function.name, args, userId);
        const out = JSON.stringify(result);
        approxChars += out.length;
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: out,
        });
      }
      continue;
    }

    const text = msg.content?.trim() ?? "";
    approxChars += text.length;
    return { text: text || "(No response)", approxChars };
  }

  return { text: "Too many tool steps — try a simpler request.", approxChars };
}

export const aiRoutes = new Hono<AppEnv>()
  .get("/logs", async (c) => {
    const userId = c.get("userId");
    const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? "30")));
    const rows = await db
      .select()
      .from(aiCallLog)
      .where(eq(aiCallLog.userId, userId))
      .orderBy(desc(aiCallLog.createdAt))
      .limit(limit);
    return c.json({ logs: rows });
  })
  .post("/parse-dump", async (c) => {
    const parsed = parseDumpBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const userId = c.get("userId");
    const { raw } = parsed.data;
    const model = process.env.OPENAI_FAST_MODEL ?? "gpt-4o-mini";
    try {
      const { raw: text } = await openaiJsonCompletion({
        userId,
        jobType: "parse_dump",
        model,
        system:
          'Return JSON: {"items":[{"title":string,"energy":"deep_work"|"shallow"|"admin"|"quick_win","priority":"urgent"|"high"|"normal"|"low","estimated_minutes":number}]}. One item per line of input. Do not invent calendar dates; omit any date field unless explicitly present in input.',
        user: raw.slice(0, 12_000),
      });
      const data = JSON.parse(text) as { items?: unknown };
      return c.json({ draft: data.items ?? [], model });
    } catch (e) {
      const lines = raw
        .split("\n")
        .map((l) => l.replace(/^[-*•\d.)]+\s*/, "").trim())
        .filter(Boolean)
        .slice(0, 50);
      return c.json({
        draft: lines.map((title) => ({
          title,
          energy: "shallow",
          priority: "normal",
          estimated_minutes: 30,
        })),
        model: "heuristic",
        warning: String(e),
      });
    }
  })
  .post("/breakdown", async (c) => {
    const parsed = breakdownBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const userId = c.get("userId");
    const { title, context } = parsed.data;
    const model = process.env.OPENAI_SMART_MODEL ?? "gpt-4o-mini";
    try {
      const { raw: text } = await openaiJsonCompletion({
        userId,
        jobType: "breakdown",
        model,
        system:
          'Return JSON: {"subtasks":[{"title":string,"estimated_minutes":number}]}. 3-6 concrete steps.',
        user: `${title}\n${context ?? ""}`.slice(0, 8000),
      });
      const data = JSON.parse(text) as { subtasks?: { title: string; estimated_minutes: number }[] };
      return c.json({ subtasks: data.subtasks ?? [] });
    } catch (e) {
      return c.json({
        subtasks: [
          { title: `Plan: ${title}`, estimated_minutes: 30 },
          { title: "Execute first slice", estimated_minutes: 45 },
        ],
        warning: String(e),
      });
    }
  })
  .post("/briefing", async (c) => {
    const uid = c.get("userId");
    const today = new Date().toISOString().slice(0, 10);
    const openToday = await db.query.tasks.findMany({
      where: and(eq(tasks.userId, uid), isNull(tasks.deletedAt), eq(tasks.dueDate, today))
    });
    return c.json({
      date: today,
      summary: `You have ${openToday.length} task(s) with work scheduled today.`,
      tasks: openToday.map((t) => ({ id: t.id, title: t.title, status: t.status })),
    });
  })
  .get("/config", (c) => {
    return c.json({
      openaiKeySet: Boolean(process.env.OPENAI_API_KEY?.trim()),
      defaultChatModel: process.env.OPENAI_SMART_MODEL ?? "gpt-4o-mini",
      allowedChatModels: [...ALLOWED_CHAT_MODELS],
    });
  })
  .post("/backfill-embeddings", async (c) => {
    const userId = c.get("userId");
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) {
      return c.json({ error: "OPENAI_API_KEY not set" }, 503);
    }

    // Load all non-deleted tasks for this user
    const allTasks = await db
      .select({ id: tasks.id, title: tasks.title, description: tasks.description })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), isNull(tasks.deletedAt)));

    if (!allTasks.length) {
      return c.json({ message: "No tasks to embed", total: 0, skipped: 0, ok: 0, failed: 0 });
    }

    // Find which tasks already have embeddings (skip them)
    const existingRows = await db.execute<{ task_id: string }>(sql`
      SELECT task_id::text FROM task_embeddings
      WHERE task_id = ANY(${allTasks.map((t) => t.id)}::uuid[])
    `);
    const existing = new Set(existingRows.rows.map((r) => r.task_id));

    const toEmbed = allTasks.filter((t) => !existing.has(t.id));

    if (!toEmbed.length) {
      return c.json({
        message: "All tasks already have embeddings",
        total: allTasks.length,
        skipped: existing.size,
        ok: 0,
        failed: 0,
      });
    }

    // Process in background — respond immediately so the HTTP request doesn't time out
    const result = await batchGenerateEmbeddings(toEmbed, { batchSize: 20, delayMs: 500 });

    return c.json({
      message: "Backfill complete",
      total: allTasks.length,
      skipped: existing.size,
      ok: result.ok,
      failed: result.failed,
    });
  })
  .post("/chat", async (c) => {
    // SafeParse instead of .parse() — won't throw unhandled
    const parsed = chatBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const body = parsed.data;
    const userId = c.get("userId");
    const key = process.env.OPENAI_API_KEY?.trim();
    const client = key ? new OpenAI({ apiKey: key }) : null;
    const model = resolveChatModel(body.model);
    const started = Date.now();
    const useTools = body.enableTools !== false;

    return streamText(c, async (stream) => {
      try {
        if (!client) {
          await stream.write("Set OPENAI_API_KEY on the API server to enable chat.");
          return;
        }

        if (useTools) {
          const { text, approxChars } = await runPlannerToolLoop(client, model, userId, body.message, {
            currentPhysicalEnergy: body.currentPhysicalEnergy,
            current_view: body.current_view,
            selected_task_ids: body.selected_task_ids,
            history: body.history,
          });
          const chunkSize = 24;
          for (let i = 0; i < text.length; i += chunkSize) {
            await stream.write(text.slice(i, i + chunkSize));
          }
          const latencyMs = Date.now() - started;
          await logAiCall({
            userId,
            jobType: "chat_tools",
            model,
            provider: "openai",
            latencyMs,
            inputTokens: null,
            outputTokens: Math.ceil(approxChars / 4),
          }).catch(() => {});
          return;
        }

        const todayLine = new Date().toISOString().split("T")[0]!;
        const energyLine = body.currentPhysicalEnergy
          ? ` Energy level: ${body.currentPhysicalEnergy} — prefer shallow/admin tasks for Low, deep_work for High.`
          : "";
        const viewLine = body.current_view
          ? ` User is on the ${body.current_view} view.`
          : "";
        const resp = await client.chat.completions.create({
          model,
          stream: true,
          max_tokens: 1500,
          messages: [
            {
              role: "system",
              content:
                `You are DevPlanner RAG Agent — ADHD-friendly planning assistant. Today is ${todayLine}.` +
                " A task is overdue if its dueDate is before today and status is not done." +
                " Subtasks are primary units; a parent task is done only when all subtasks are done." +
                " Be concise and reply in under 6 sentences." +
                energyLine +
                viewLine,
            },
            { role: "user", content: body.message.slice(0, 8000) },
          ],
        });
        let totalChars = 0;
        for await (const part of resp) {
          const chunk = part.choices[0]?.delta?.content ?? "";
          if (chunk) {
            await stream.write(chunk);
            totalChars += chunk.length;
          }
        }
        const latencyMs = Date.now() - started;
        await logAiCall({
          userId,
          jobType: "chat",
          model,
          provider: "openai",
          latencyMs,
          inputTokens: null,
          outputTokens: Math.ceil(totalChars / 4),
        }).catch(() => {});
      } catch (e) {
        await stream.write(`[Error: ${String(e)}]`);
      }
    });
  });
