import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { goalHorizons } from "../db/schema.js";
import type { AppEnv } from "../types.js";

const CELL_KEYS = [
  "short:personal",
  "short:professional",
  "short:work",
  "mid:personal",
  "mid:professional",
  "mid:work",
  "long:personal",
  "long:professional",
  "long:work",
] as const;

type GoalCellKey = (typeof CELL_KEYS)[number];
type GoalMatrix = Record<GoalCellKey, string>;

const EMPTY_GOALS: GoalMatrix = {
  "short:personal": "",
  "short:professional": "",
  "short:work": "",
  "mid:personal": "",
  "mid:professional": "",
  "mid:work": "",
  "long:personal": "",
  "long:professional": "",
  "long:work": "",
};

const putBody = z.object({
  ownerName: z.string().max(255).optional().nullable(),
  goals: z.record(z.string().max(2000)),
});

function normalizeGoals(input: Record<string, string>): GoalMatrix {
  const next: GoalMatrix = { ...EMPTY_GOALS };
  for (const key of CELL_KEYS) {
    next[key] = typeof input[key] === "string" ? input[key].slice(0, 2000) : "";
  }
  return next;
}

export const goalRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const userId = c.get("userId");
    const row = await db.query.goalHorizons.findFirst({
      where: eq(goalHorizons.userId, userId),
    });

    return c.json({
      ownerName: row?.ownerName ?? null,
      goals: normalizeGoals(row?.goals ?? {}),
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    });
  })
  .put("/", async (c) => {
    const parsed = putBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }

    const userId = c.get("userId");
    const ownerName = parsed.data.ownerName?.trim() || null;
    const goals = normalizeGoals(parsed.data.goals);
    const [row] = await db
      .insert(goalHorizons)
      .values({ userId, ownerName, goals })
      .onConflictDoUpdate({
        target: goalHorizons.userId,
        set: {
          ownerName,
          goals,
          updatedAt: sql`NOW()`,
        },
      })
      .returning({
        ownerName: goalHorizons.ownerName,
        goals: goalHorizons.goals,
        updatedAt: goalHorizons.updatedAt,
      });

    return c.json({
      ownerName: row.ownerName,
      goals: normalizeGoals(row.goals),
      updatedAt: row.updatedAt.toISOString(),
    });
  });
