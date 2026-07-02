import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { accomplishments } from "../db/schema.js";
import type { AppEnv } from "../types.js";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** Normalise a skills payload (array or comma string) into a clean string[]. */
function normaliseSkills(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];
  const cleaned = raw
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 25);
  return Array.from(new Set(cleaned));
}

const createBody = z.object({
  date: ymd,
  title: z.string().trim().min(1).max(500),
  impact: z.string().trim().max(2000).optional().nullable(),
  metric: z.string().trim().max(500).optional().nullable(),
  skills: z.union([z.array(z.string()), z.string()]).optional().nullable(),
  taskId: z.string().uuid().optional().nullable(),
});

const updateBody = z.object({
  date: ymd.optional(),
  title: z.string().trim().min(1).max(500).optional(),
  impact: z.string().trim().max(2000).optional().nullable(),
  metric: z.string().trim().max(500).optional().nullable(),
  skills: z.union([z.array(z.string()), z.string()]).optional().nullable(),
});

export const accomplishmentRoutes = new Hono<AppEnv>()
  /** All accomplishments for the signed-in user, newest first. */
  .get("/", async (c) => {
    const userId = c.get("userId");
    const rows = await db
      .select()
      .from(accomplishments)
      .where(eq(accomplishments.userId, userId))
      .orderBy(desc(accomplishments.date), desc(accomplishments.createdAt));
    return c.json({ accomplishments: rows });
  })
  /** Log a new accomplishment. */
  .post("/", async (c) => {
    const parsed = createBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const userId = c.get("userId");
    const b = parsed.data;
    const [row] = await db
      .insert(accomplishments)
      .values({
        userId,
        taskId: b.taskId ?? null,
        date: b.date,
        title: b.title.trim(),
        impact: b.impact?.trim() || null,
        metric: b.metric?.trim() || null,
        skills: normaliseSkills(b.skills),
      })
      .returning();
    return c.json({ accomplishment: row }, 201);
  })
  /** Edit an accomplishment (ownership-scoped). */
  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    const parsed = updateBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const userId = c.get("userId");
    const b = parsed.data;
    const patch: Partial<typeof accomplishments.$inferInsert> = { updatedAt: new Date() };
    if (b.date !== undefined) patch.date = b.date;
    if (b.title !== undefined) patch.title = b.title.trim();
    if (b.impact !== undefined) patch.impact = b.impact?.trim() || null;
    if (b.metric !== undefined) patch.metric = b.metric?.trim() || null;
    if (b.skills !== undefined) patch.skills = normaliseSkills(b.skills);

    const [row] = await db
      .update(accomplishments)
      .set(patch)
      .where(and(eq(accomplishments.id, id), eq(accomplishments.userId, userId)))
      .returning();
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json({ accomplishment: row });
  })
  /** Remove an accomplishment (ownership-scoped). */
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    const userId = c.get("userId");
    const [row] = await db
      .delete(accomplishments)
      .where(and(eq(accomplishments.id, id), eq(accomplishments.userId, userId)))
      .returning();
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  });
