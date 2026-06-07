import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { openaiJsonCompletion } from "../ai/openai-json.js";
import { db } from "../db/client.js";
import { priorities, tasks } from "../db/schema.js";
import type { AppEnv } from "../types.js";

const CATEGORIES = ["work", "personal", "growth"] as const;
const PERIODS = ["week", "month"] as const;

type Category = (typeof CATEGORIES)[number];
type Period = (typeof PERIODS)[number];

const putBody = z.object({
  /** Array of slot upserts. Empty / whitespace-only `statement` deletes the slot. */
  anchors: z.array(
    z.object({
      periodType: z.enum(PERIODS),
      periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      category: z.enum(CATEGORIES),
      statement: z.string().max(280),
    })
  ),
});

const suggestBody = z.object({
  periodType: z.enum(PERIODS),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Monday of the ISO week containing `d`, formatted YYYY-MM-DD. */
function weekStart(d: Date): string {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = copy.getUTCDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  copy.setUTCDate(copy.getUTCDate() + diff);
  return copy.toISOString().slice(0, 10);
}

/** 1st of the month containing `d`, formatted YYYY-MM-DD. */
function monthStart(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function parsePeriodStart(periodType: Period, raw: string): string {
  const d = new Date(`${raw}T12:00:00Z`);
  return periodType === "week" ? weekStart(d) : monthStart(d);
}

export const priorityRoutes = new Hono<AppEnv>()
  /** Current week + month anchors for the signed-in user. */
  .get("/", async (c) => {
    const userId = c.get("userId");
    const now = new Date();
    const week = weekStart(now);
    const month = monthStart(now);
    const rows = await db
      .select()
      .from(priorities)
      .where(eq(priorities.userId, userId));
    const week_anchors = rows.filter(
      (r) => r.periodType === "week" && r.periodStart === week
    );
    const month_anchors = rows.filter(
      (r) => r.periodType === "month" && r.periodStart === month
    );
    return c.json({
      period: { week, month },
      week_anchors,
      month_anchors,
    });
  })
  /** Upsert a batch of anchor slots. Empty `statement` deletes the slot. */
  .put("/", async (c) => {
    const parsed = putBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const userId = c.get("userId");
    const upserts: typeof priorities.$inferInsert[] = [];
    const deletes: { periodType: Period; periodStart: string; category: Category }[] = [];
    for (const a of parsed.data.anchors) {
      const normalised = parsePeriodStart(a.periodType, a.periodStart);
      const clean = a.statement.trim();
      if (!clean) {
        deletes.push({
          periodType: a.periodType,
          periodStart: normalised,
          category: a.category,
        });
        continue;
      }
      upserts.push({
        userId,
        periodType: a.periodType,
        periodStart: normalised,
        category: a.category,
        statement: clean,
      });
    }

    if (upserts.length) {
      await db
        .insert(priorities)
        .values(upserts)
        .onConflictDoUpdate({
          target: [
            priorities.userId,
            priorities.periodType,
            priorities.periodStart,
            priorities.category,
          ],
          set: {
            statement: sql`EXCLUDED.statement`,
            updatedAt: new Date(),
          },
        });
    }
    for (const d of deletes) {
      await db
        .delete(priorities)
        .where(
          and(
            eq(priorities.userId, userId),
            eq(priorities.periodType, d.periodType),
            eq(priorities.periodStart, d.periodStart),
            eq(priorities.category, d.category)
          )
        );
    }
    return c.json({ ok: true, upserted: upserts.length, deleted: deletes.length });
  })
  /**
   * Suggest 3 anchors (Work / Personal / Professional) for the given period
   * based on the user's recent task history. Returns drafts — never writes.
   */
  .post("/suggest", async (c) => {
    const parsed = suggestBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) {
      return c.json({ error: "OPENAI_API_KEY not set" }, 503);
    }
    const userId = c.get("userId");
    const periodType = parsed.data.periodType;
    const lookbackDays = periodType === "week" ? 14 : 60;
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - lookbackDays);

    const recent = await db
      .select({
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        completedAt: tasks.completedAt,
        createdAt: tasks.createdAt,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
          gte(tasks.createdAt, cutoff)
        )
      )
      .orderBy(desc(tasks.createdAt))
      .limit(120);

    const summary = recent
      .map(
        (t) =>
          `- [${t.status}] (${t.priority}) ${t.title}${
            t.completedAt ? " ✓" : ""
          }`
      )
      .join("\n");

    const model = process.env.OPENAI_SMART_MODEL ?? "gpt-5-nano";
    const periodLabel = periodType === "week" ? "coming week" : "coming month";
    const { raw } = await openaiJsonCompletion({
      userId,
      jobType: "suggest_priorities",
      model,
      system: `Return JSON: {"anchors":[{"category":"work"|"personal"|"growth","statement":string}]}. Exactly three items: work, personal, and professional development. Use category "growth" for the professional-development item because that is the stored enum. Each statement is one sentence, outcome-focused (not a to-do), tied to a theme you observed in the user's recent task history. Do not invent commitments the user hasn't already started. If the user's history shows little personal or professional activity, write an aspirational but realistic statement for those categories rather than leaving them blank. Period: the ${periodLabel}.`,
      user: summary || "No recent task history yet.",
    });
    let drafts: { category: Category; statement: string }[] = [];
    try {
      const data = JSON.parse(raw) as {
        anchors?: { category: string; statement: string }[];
      };
      drafts =
        data.anchors
          ?.filter((a) =>
            CATEGORIES.includes(a.category as Category)
          )
          .map((a) => ({
            category: a.category as Category,
            statement: a.statement.trim(),
          })) ?? [];
    } catch {
      // fall through to empty
    }
    return c.json({ drafts, model });
  });
