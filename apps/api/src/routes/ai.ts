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
import { buildPlannerSystemPrompt } from "../ai/prompts.js";

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

const ALLOWED_CHAT_MODELS = new Set(["gpt-5-nano"]);
const READ_ONLY_TOOL_NAMES = new Set([
  "listTasks",
  "getSubtasks",
  "listSprints",
  "getProgressStats",
  "spreadSubtasksAcrossDays",
]);

function resolveChatModel(requested?: string): string {
  const fallback = process.env.OPENAI_SMART_MODEL ?? "gpt-5-nano";
  if (requested && ALLOWED_CHAT_MODELS.has(requested)) return requested;
  return fallback;
}

function looksLikePlanImportRequest(message: string): boolean {
  return /\b(create|import|add)\b/i.test(message) &&
    /\b(tasks?|subtasks?|sprint|deadline|stage|project)\b/i.test(message) &&
    message.length > 500;
}

function hasPrioritySignal(message: string): boolean {
  return /\b(priority|urgent|highest|high|normal|low|p0|p1|p2|p3)\b/i.test(message);
}

function hasEnergySignal(message: string): boolean {
  return /\b(energy|deep[_ -]?work|shallow|admin|quick[_ -]?win|low energy|medium energy|high energy|focus|cognitive)\b/i.test(message);
}

function buildPlanMetadataHint(message: string): string {
  if (!looksLikePlanImportRequest(message)) return "";

  const missingPriority = !hasPrioritySignal(message);
  const missingEnergy = !hasEnergySignal(message);
  if (!missingPriority && !missingEnergy) return "";

  const missing = [
    missingPriority ? "priority" : null,
    missingEnergy ? "energy/work-depth" : null,
  ].filter(Boolean).join(" and ");

  return `\n\nPLAN IMPORT METADATA HANDLING:
- This looks like a structured plan import, and it is missing explicit ${missing}.
- Do not fail, go silent, or return "(No response)" because metadata is missing.
- If the missing metadata is not essential, proceed with visible assumptions and say they can be changed before approval.
- Default missing priority to "normal", except phrases like "deadline", "highest", "critical", "production", or "urgent" should be treated as "urgent" or "high".
- Infer missing energy/work type from wording: deployment, migrations, infrastructure, provisioning, workflow, server, database, and security are deep_work; documentation, handoff, governance, review, and runbooks are admin; small setup/checklist tasks are shallow; short contained fixes are quick_win.
- Ask one concise follow-up only if the missing metadata would materially change the schedule or risk level.`;
}

function buildNoContentFallback(message: string): string {
  if (looksLikePlanImportRequest(message)) {
    const missing: string[] = [];
    if (!hasPrioritySignal(message)) missing.push("priority");
    if (!hasEnergySignal(message)) missing.push("energy/work-depth");
    return [
      "I could not safely create those tasks directly from chat yet, so I did not change your planner.",
      "",
      missing.length
        ? `The plan is missing ${missing.join(" and ")}, so I would handle that with defaults in the draft: normal priority unless the plan says urgent/highest/production, and inferred energy from each task type.`
        : "The plan has enough metadata to draft a task tree.",
      "",
      "I can still help with this plan as a reviewable import: paste it into Capture/Brain dump, or ask me to turn it into a task tree first. The app should create the sprint, tasks, subtasks, dates, estimates, priority, and energy only after you approve the draft.",
    ].join("\n");
  }
  return "I could not produce a useful response for that request. Try rephrasing it, or paste the plan into Capture so it can be reviewed before anything is created.";
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
  },
  onChunk?: (chunk: string) => Promise<void>
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

  const systemPrompt = buildPlannerSystemPrompt({
    todayIso,
    energyHint,
    viewHint,
    selectionHint,
  });

  // ── RAG: retrieve semantically similar tasks before first LLM call ──
  const isSimpleQuery = userMessage.trim().length <= 15 && userMessage.split(/\\s+/).length <= 3 && !/\\b(task|bug|sprint|board|timeline|review|plan)\\b/i.test(userMessage);

  let ragBlock = "";
  if (!isSimpleQuery) {
    const ragTasks = await retrieveRagContext(userId, userMessage, 8);
    ragBlock = formatRagContext(ragTasks);
  }

  const fullPrompt = systemPrompt + buildPlanMetadataHint(userMessage) + ragBlock;

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
    try {
      const streamResp = await client.chat.completions.create({
        model,
        messages,
        tools: PLANNER_CHAT_TOOLS.filter((tool) => READ_ONLY_TOOL_NAMES.has(tool.function.name)),
        tool_choice: "auto",
        max_completion_tokens: 2000,
        stream: true,
      });

      let content = "";
      const toolCallsMap = new Map<number, { id: string, type: "function", function: { name: string, arguments: string } }>();

      for await (const chunk of streamResp) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          content += delta.content;
          if (onChunk) await onChunk(delta.content);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const index = tc.index;
            if (!toolCallsMap.has(index)) {
              toolCallsMap.set(index, { id: tc.id!, type: "function", function: { name: tc.function?.name ?? "", arguments: "" } });
            }
            if (tc.function?.arguments) {
              toolCallsMap.get(index)!.function.arguments += tc.function.arguments;
            }
          }
        }
      }

      if (toolCallsMap.size > 0) {
        const tool_calls = Array.from(toolCallsMap.values());
        const asstMsg: OpenAI.Chat.Completions.ChatCompletionMessageParam = { role: "assistant", tool_calls };
        if (content) asstMsg.content = content;
        messages.push(asstMsg);

        for (const tc of tool_calls) {
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

      if (!content.trim() && messages.some(m => m.role === "tool")) {
        messages.push({ role: "user", content: "Briefly summarize what you found in 1-2 conversational sentences. Do not claim any changes were made." });
        const summaryStream = await client.chat.completions.create({
          model,
          messages,
          max_completion_tokens: 300,
          stream: true,
        });
        for await (const sChunk of summaryStream) {
          const sDelta = sChunk.choices[0]?.delta?.content ?? "";
          if (sDelta) {
            content += sDelta;
            if (onChunk) await onChunk(sDelta);
          }
        }
      }
      approxChars += content.length;
      return { text: content || buildNoContentFallback(userMessage), approxChars };
    } catch (e) {
      if (onChunk) await onChunk(`\n\n[Inner API Error in Tool Loop: ${String(e)}]`);
      return { text: `[Inner API Error in Tool Loop: ${String(e)}]`, approxChars };
    }
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
    const model = process.env.OPENAI_FAST_MODEL ?? "gpt-5-nano";
    try {
      const { raw: text } = await openaiJsonCompletion({
        userId,
        jobType: "parse_dump",
        model,
        system:
          'Return JSON: {"items":[{"title":string,"energy":"deep_work"|"shallow"|"admin"|"quick_win","priority":"urgent"|"high"|"normal"|"low","estimated_minutes":number}]}. One item per line of input. Do not invent calendar dates; omit any date field unless explicitly present in input. If priority is missing, use "normal" unless the text says urgent/highest/critical/production, then use "urgent" or "high". If energy is missing, infer it: deployment/migration/infrastructure/server/database/security = "deep_work"; documentation/governance/review/runbook/handoff = "admin"; small setup/checklist = "shallow"; short contained fix = "quick_win". Never fail solely because priority or energy is absent.',
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
    const model = process.env.OPENAI_SMART_MODEL ?? "gpt-5-nano";
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
      defaultChatModel: process.env.OPENAI_SMART_MODEL ?? "gpt-5-nano",
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
          let streamedChars = 0;
          const { text, approxChars } = await runPlannerToolLoop(client, model, userId, body.message, {
            currentPhysicalEnergy: body.currentPhysicalEnergy,
            current_view: body.current_view,
            selected_task_ids: body.selected_task_ids,
            history: body.history,
          }, async (chunk) => {
            streamedChars += chunk.length;
            await stream.write(chunk);
          });
          if (streamedChars === 0) {
            await stream.write(text);
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
          max_completion_tokens: 1500,
          messages: [
            {
              role: "system",
              content:
                `You are DevPlanner RAG Agent — ADHD-friendly planning assistant. Today is ${todayLine}.` +
                " A task is overdue if its dueDate is before today and status is not done." +
                " Subtasks are primary units; a parent task is done only when all subtasks are done." +
                " If a plan is missing priority or energy, either ask one concise follow-up if it materially affects scheduling, or proceed with clear defaults: normal priority and inferred energy from task wording." +
                " Be concise and reply in under 6 sentences." +
                energyLine +
                viewLine +
                buildPlanMetadataHint(body.message),
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
        if (totalChars === 0) {
          const fallback = buildNoContentFallback(body.message);
          await stream.write(fallback);
          totalChars = fallback.length;
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
