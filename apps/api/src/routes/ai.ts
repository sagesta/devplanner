import { and, desc, eq, or } from "drizzle-orm";
import { Hono } from "hono";
import { streamText } from "hono/streaming";
import OpenAI from "openai";
import { z } from "zod";
import { executePlannerTool, PLANNER_CHAT_TOOLS } from "../ai/ai-task-tools.js";
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
  /** stress-test-fix: user's current physical energy for task suggestions */
  currentPhysicalEnergy: z.enum(["low", "medium", "high"]).optional(),
});

const ALLOWED_CHAT_MODELS = new Set(["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-4"]);

function resolveChatModel(requested?: string): string {
  const fallback = process.env.OPENAI_SMART_MODEL ?? "gpt-4o-mini";
  if (requested && ALLOWED_CHAT_MODELS.has(requested)) return requested;
  return fallback;
}

async function runPlannerToolLoop(
  client: OpenAI,
  model: string,
  userId: string,
  userMessage: string,
  opts?: { currentPhysicalEnergy?: "low" | "medium" | "high" }
): Promise<{ text: string; approxChars: number }> {
  const energyHint = opts?.currentPhysicalEnergy
    ? ` User context: they report physical energy right now as "${opts.currentPhysicalEnergy}"; when listing or suggesting tasks, prefer matching tasks.physicalEnergy when those fields are set.`
    : "";
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "You are DevPlanner assistant with tools that read and modify the user's real task board. " +
        "When asked to list, create, update, delete, or reschedule tasks, call the appropriate tools. " +
        "For bulk deletes (e.g. all done tasks), call listTasks with status filter first, then deleteTask for each id. " +
        "After tools finish, reply in one or two short sentences confirming what changed (counts, titles). " +
        "Be concise and ADHD-friendly." +
        energyHint,
    },
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
      where: and(
        eq(tasks.userId, uid),
        or(eq(tasks.scheduledDate, today), eq(tasks.dueDate, today))
      ),
    });
    return c.json({
      date: today,
      summary: `You have ${openToday.length} task(s) scheduled today.`,
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

        const resp = await client.chat.completions.create({
          model,
          stream: true,
          max_tokens: 1500,
          messages: [
            {
              role: "system",
              content:
                "You are DevPlanner assistant: concise, ADHD-friendly. User message may reference tasks; respond helpfully in under 6 sentences.",
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
