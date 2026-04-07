import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { tags, taskTags, tasks } from "../db/schema.js";
import type { AppEnv } from "../types.js";

const createTagBody = z.object({
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "color must be a 7-char hex string")
    .optional(),
});

const setTaskTagsBody = z.object({
  tag_ids: z.array(z.number().int().positive()),
});

export const tagRoutes = new Hono<AppEnv>()
  // GET / — all tags
  .get("/", async (c) => {
    const rows = await db.select().from(tags).orderBy(asc(tags.name));
    return c.json({ tags: rows });
  })

  // POST / — create tag
  .post("/", async (c) => {
    const parsed = createTagBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const { name, color } = parsed.data;

    const [row] = await db
      .insert(tags)
      .values({
        name: name.trim(),
        color: color ?? "#6B7280",
      })
      .returning();

    return c.json({ tag: row }, 201);
  })

  // DELETE /:id — delete tag (cascades via FK)
  .delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id) || id <= 0) {
      return c.json({ error: "invalid id" }, 400);
    }

    const [row] = await db.delete(tags).where(eq(tags.id, id)).returning();
    if (!row) {
      return c.json({ error: "not found" }, 404);
    }

    return c.json({ ok: true });
  })

  // POST /tasks/:id/tags — set tags for a task (replace-all)
  .post("/tasks/:id/tags", async (c) => {
    const taskId = c.req.param("id");
    const userId = c.get("userId");

    // Verify the task belongs to user
    const taskRow = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
      .limit(1);
    if (!taskRow.length) {
      return c.json({ error: "task not found" }, 404);
    }

    const parsed = setTaskTagsBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 422);
    }
    const { tag_ids } = parsed.data;

    // Delete existing
    await db.delete(taskTags).where(eq(taskTags.taskId, taskId));

    // Insert new
    if (tag_ids.length > 0) {
      await db
        .insert(taskTags)
        .values(tag_ids.map((tagId) => ({ taskId, tagId })));
    }

    // Return updated tags for this task
    const updatedTags = tag_ids.length > 0
      ? await db
          .select({
            id: tags.id,
            name: tags.name,
            color: tags.color,
          })
          .from(tags)
          .where(inArray(tags.id, tag_ids))
          .orderBy(asc(tags.name))
      : [];

    return c.json({ tags: updatedTags });
  });
