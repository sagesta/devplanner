import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { sprints, weeklyReviews } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import {
  buildSprintGoal,
  normalizeReviewIntentions,
  reviewPeriodFromWeekStart,
  sprintNameFromStart,
} from "../services/reviews.js";
import type { AppEnv } from "../types.js";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const goalKey = z.enum([
  "short:personal",
  "short:professional",
  "short:work",
  "mid:personal",
  "mid:professional",
  "mid:work",
  "long:personal",
  "long:professional",
  "long:work",
]);

const intentionSchema = z.object({
  text: z.string().max(500),
  goalKey: goalKey.optional().nullable(),
  goalLabel: z.string().max(500).optional().nullable(),
});

const reviewBody = z.object({
  weekStart: ymd,
  weekEnd: ymd,
  wins: z.string().max(20_000).default(""),
  carryover: z.string().max(20_000).default(""),
  intentions: z.array(intentionSchema).max(3).default([]),
  sprintNotes: z.string().max(20_000).default(""),
});

function parseBody(body: unknown) {
  const parsed = reviewBody.safeParse(body);
  if (!parsed.success) return { error: parsed.error.flatten() } as const;
  if (parsed.data.weekEnd < parsed.data.weekStart) {
    return { error: { formErrors: ["weekEnd must be on or after weekStart"], fieldErrors: {} } } as const;
  }
  return {
    data: {
      ...parsed.data,
      wins: parsed.data.wins.trim(),
      carryover: parsed.data.carryover.trim(),
      sprintNotes: parsed.data.sprintNotes.trim(),
      intentions: normalizeReviewIntentions(parsed.data.intentions),
    },
  } as const;
}

export const reviewRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const userId = c.get("userId");
    const query = c.req.query("q")?.trim().slice(0, 200) ?? "";
    const requestedLimit = Number(c.req.query("limit") ?? 30);
    const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 30;
    const from = c.req.query("from") ?? "";
    const to = c.req.query("to") ?? "";
    if ((from && !ymd.safeParse(from).success) || (to && !ymd.safeParse(to).success)) {
      return c.json({ error: "review date filters must use YYYY-MM-DD" }, 422);
    }
    const pattern = `%${query}%`;
    const filters: SQL[] = [eq(weeklyReviews.userId, userId)];
    if (from) filters.push(gte(weeklyReviews.weekStart, from));
    if (to) filters.push(lte(weeklyReviews.weekStart, to));
    if (query) {
      const searchFilter = or(
        ilike(weeklyReviews.wins, pattern),
        ilike(weeklyReviews.carryover, pattern),
        ilike(weeklyReviews.sprintNotes, pattern),
        sql`${weeklyReviews.intentions}::text ILIKE ${pattern}`
      );
      if (searchFilter) filters.push(searchFilter);
    }

    const rows = await db
      .select()
      .from(weeklyReviews)
      .where(and(...filters))
      .orderBy(desc(weeklyReviews.weekStart))
      .limit(limit);
    return c.json({ reviews: rows });
  })
  .get("/current", async (c) => {
    const userId = c.get("userId");
    const weekStart = c.req.query("weekStart");
    if (!weekStart || !ymd.safeParse(weekStart).success) {
      return c.json({ error: "weekStart must use YYYY-MM-DD" }, 422);
    }
    const [review] = await db
      .select()
      .from(weeklyReviews)
      .where(and(eq(weeklyReviews.userId, userId), eq(weeklyReviews.weekStart, weekStart)))
      .limit(1);
    return c.json({ review: review ?? null });
  })
  .get("/:id", async (c) => {
    const userId = c.get("userId");
    const [review] = await db
      .select()
      .from(weeklyReviews)
      .where(and(eq(weeklyReviews.id, c.req.param("id")), eq(weeklyReviews.userId, userId)))
      .limit(1);
    if (!review) return c.json({ error: "not found" }, 404);
    return c.json({ review });
  })
  .put("/", async (c) => {
    const parsed = parseBody(await c.req.json());
    if ("error" in parsed) return c.json({ error: parsed.error }, 422);
    const userId = c.get("userId");
    const current = await db
      .select({ id: weeklyReviews.id, status: weeklyReviews.status })
      .from(weeklyReviews)
      .where(and(eq(weeklyReviews.userId, userId), eq(weeklyReviews.weekStart, parsed.data.weekStart)))
      .limit(1);
    if (current[0]?.status === "completed") {
      return c.json({ error: "this weekly review is already completed" }, 409);
    }

    const [review] = await db
      .insert(weeklyReviews)
      .values({ userId, ...parsed.data, status: "draft" })
      .onConflictDoUpdate({
        target: [weeklyReviews.userId, weeklyReviews.weekStart],
        set: { ...parsed.data, updatedAt: new Date() },
      })
      .returning();
    return c.json({ review });
  })
  .post("/complete", async (c) => {
    const parsed = parseBody(await c.req.json());
    if ("error" in parsed) return c.json({ error: parsed.error }, 422);
    const userId = c.get("userId");
    const content = parsed.data;

    try {
      const result = await db.transaction(async (tx) => {
        await tx
          .insert(weeklyReviews)
          .values({ userId, ...content, status: "draft" })
          .onConflictDoNothing({ target: [weeklyReviews.userId, weeklyReviews.weekStart] });

        // Serialize completion attempts for this user/week. A retry sees the
        // completed row and returns its sprint instead of creating another.
        await tx.execute(sql`
          SELECT id
          FROM ${weeklyReviews}
          WHERE ${weeklyReviews.userId} = ${userId}
            AND ${weeklyReviews.weekStart} = ${content.weekStart}
          FOR UPDATE
        `);

        const [current] = await tx
          .select()
          .from(weeklyReviews)
          .where(and(eq(weeklyReviews.userId, userId), eq(weeklyReviews.weekStart, content.weekStart)))
          .limit(1);
        if (!current) throw new Error("review could not be loaded after saving");
        if (current.status === "completed" && current.sprintId) {
          return { review: current, sprintId: current.sprintId, alreadyCompleted: true };
        }

        await tx
          .update(weeklyReviews)
          .set({ ...content, updatedAt: new Date() })
          .where(eq(weeklyReviews.id, current.id));

        const period = reviewPeriodFromWeekStart(content.weekStart);
        const [sprint] = await tx
          .insert(sprints)
          .values({
            userId,
            name: sprintNameFromStart(period.sprintStart),
            startDate: period.sprintStart,
            endDate: period.sprintEnd,
            goal: buildSprintGoal(content.intentions, content.sprintNotes),
            status: "active",
          })
          .returning();

        const [review] = await tx
          .update(weeklyReviews)
          .set({
            ...content,
            sprintId: sprint.id,
            status: "completed",
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(weeklyReviews.id, current.id))
          .returning();
        return { review, sprintId: sprint.id, alreadyCompleted: false };
      });
      return c.json(result);
    } catch (err) {
      logger.error({ err, userId, weekStart: content.weekStart }, "weekly review completion failed");
      throw err;
    }
  });
