import { and, asc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { areas, projects, users } from "../db/schema.js";
import type { AppEnv } from "../types.js";

const createBody = z.object({
  userId: z.string().uuid(),
  areaId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  status: z.string().max(32).optional(),
  color: z.string().max(32).optional().nullable(),
});

export const projectRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const userId = c.req.query("userId");
    if (!userId) {
      return c.json({ error: "userId query required" }, 400);
    }
    const areaId = c.req.query("areaId");
    const includeArchived = c.req.query("includeArchived") === "1";

    const conditions = [eq(projects.userId, userId)];
    if (areaId) {
      conditions.push(eq(projects.areaId, areaId));
    }
    if (!includeArchived) {
      conditions.push(isNull(projects.archivedAt));
    }

    const rows = await db
      .select()
      .from(projects)
      .where(and(...conditions))
      .orderBy(asc(projects.name));
    return c.json({ projects: rows });
  })
  .post("/", async (c) => {
    const parsed = createBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const v = parsed.data;
    const owner = await db.select({ id: users.id }).from(users).where(eq(users.id, v.userId)).limit(1);
    if (!owner.length) {
      return c.json({ error: "user not found" }, 404);
    }
    const areaRow = await db
      .select({ id: areas.id })
      .from(areas)
      .where(and(eq(areas.id, v.areaId), eq(areas.userId, v.userId)))
      .limit(1);
    if (!areaRow.length) {
      return c.json({ error: "area not found for this user" }, 404);
    }
    const [row] = await db
      .insert(projects)
      .values({
        userId: v.userId,
        areaId: v.areaId,
        name: v.name.trim(),
        description: v.description ?? null,
        status: v.status ?? "active",
        color: v.color ?? null,
      })
      .returning();
    return c.json({ project: row }, 201);
  });
