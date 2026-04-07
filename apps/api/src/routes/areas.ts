import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { areas, users } from "../db/schema.js";
import type { AppEnv } from "../types.js";

const createBody = z.object({
  name: z.string().min(1).max(255),
  color: z.string().max(32).optional().nullable(),
  icon: z.string().max(64).optional().nullable(),
  sortOrder: z.number().int().optional(),
});

const patchBody = z.object({
  name: z.string().min(1).max(255).optional(),
  color: z.string().max(32).optional().nullable(),
  icon: z.string().max(64).optional().nullable(),
  sortOrder: z.number().int().optional(),
  weekly_hour_target: z.number().min(0).nullable().optional(),
});

export const areaRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const userId = c.get("userId");
    const rows = await db
      .select()
      .from(areas)
      .where(eq(areas.userId, userId))
      .orderBy(asc(areas.sortOrder));
    return c.json({ areas: rows });
  })
  .post("/", async (c) => {
    const parsed = createBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const v = parsed.data;
    const userId = c.get("userId");
    const owner = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!owner.length) {
      return c.json({ error: "user not found" }, 404);
    }
    const [row] = await db
      .insert(areas)
      .values({
        userId,
        name: v.name.trim(),
        color: v.color ?? null,
        icon: v.icon ?? null,
        sortOrder: v.sortOrder ?? 0,
      })
      .returning();
    return c.json({ area: row }, 201);
  })
  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    const parsed = patchBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const v = parsed.data;
    const updates: Partial<typeof areas.$inferInsert> = {};
    if (v.name !== undefined) updates.name = v.name.trim();
    if (v.color !== undefined) updates.color = v.color;
    if (v.icon !== undefined) updates.icon = v.icon;
    if (v.sortOrder !== undefined) updates.sortOrder = v.sortOrder;
    if (v.weekly_hour_target !== undefined)
      updates.weeklyHourTarget = v.weekly_hour_target != null ? String(v.weekly_hour_target) : null;

    if (Object.keys(updates).length === 0) {
      return c.json({ error: "no fields to update" }, 422);
    }
    const userId = c.get("userId");
    const [row] = await db
      .update(areas)
      .set(updates)
      .where(and(eq(areas.id, id), eq(areas.userId, userId)))
      .returning();
    if (!row) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ area: row });
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    const userId = c.get("userId");
    const [row] = await db.delete(areas).where(and(eq(areas.id, id), eq(areas.userId, userId))).returning();
    if (!row) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ ok: true, note: "Cascaded delete of tasks in this area" });
  });
