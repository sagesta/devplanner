import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { streamText } from "hono/streaming";
import OpenAI from "openai";
import { z } from "zod";
import { logAiCall } from "../ai/logCall.js";
import { openaiJsonCompletion } from "../ai/openai-json.js";
import { db } from "../db/client.js";
import { aiCallLog, tasks } from "../db/schema.js";
import type { AppEnv } from "../types.js";

const parseDumpBody = z.object({
  userId: z.string().uuid(),
  raw: z.string().min(1),
});

const breakdownBody = z.object({
  userId: z.string().uuid(),
  title: z.string().min(1),
  context: z.string().optional(),
});

const chatBody = z.object({
  userId: z.string().uuid(),
  message: z.string().min(1),
});

export const aiRoutes = new Hono<AppEnv>()
  .get("/logs", async (c) => {
    const userId = c.req.query("userId");
    const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? "30")));
    const rows = userId
      ? await db
          .select()
          .from(aiCallLog)
          .where(eq(aiCallLog.userId, userId))
          .orderBy(desc(aiCallLog.createdAt))
          .limit(limit)
      : await db.select().from(aiCallLog).orderBy(desc(aiCallLog.createdAt)).limit(limit);
    return c.json({ logs: rows });
  })
  .post("/parse-dump", async (c) => {
    const parsed = parseDumpBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const { userId, raw } = parsed.data;
    const model = process.env.OPENAI_FAST_MODEL ?? "gpt-4o-mini";
    try {
      const { raw: text } = await openaiJsonCompletion({
        userId,
        jobType: "parse_dump",
        model,
        system:
          'Return JSON: {"items":[{"title":string,"energy":"deep_work"|"shallow"|"admin"|"quick_win","priority":"urgent"|"high"|"normal"|"low","estimated_minutes":number}]}. One item per line of input.',
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
    const { userId, title, context } = parsed.data;
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
    let userId: string | undefined;
    const ct = c.req.header("content-type") ?? "";
    if (ct.includes("application/json")) {
      const j = (await c.req.json().catch(() => null)) as { userId?: string } | null;
      userId = j?.userId;
    }
    userId = userId ?? c.req.query("userId") ?? undefined;
    const parsed = z.string().uuid().safeParse(userId);
    if (!parsed.success) {
      return c.json({ error: "userId required" }, 400);
    }
    const uid = parsed.data;
    const today = new Date().toISOString().slice(0, 10);
    const openToday = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, uid), eq(tasks.scheduledDate, today)));
    return c.json({
      date: today,
      summary: `You have ${openToday.length} task(s) scheduled today.`,
      tasks: openToday.map((t) => ({ id: t.id, title: t.title, status: t.status })),
    });
  })
  .post("/chat", async (c) => {
    // SafeParse instead of .parse() — won't throw unhandled
    const parsed = chatBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const body = parsed.data;
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      return c.json({ reply: "Set OPENAI_API_KEY for chat. (DevPlanner AI stub.)" });
    }
    const client = new OpenAI({ apiKey: key });
    const model = process.env.OPENAI_SMART_MODEL ?? "gpt-4o-mini";
    const started = Date.now();

    // Stream tokens to client via text/event-stream for snappy UX
    return streamText(c, async (stream) => {
      try {
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
          userId: body.userId,
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
