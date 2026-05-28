import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { areas } from "../db/schema.js";
import { ensureDefaultAreas } from "./defaultAreas.js";

/**
 * Area for calendar imports (Google + CalDAV). Uses CALDAV_IMPORT_AREA_ID when set and valid,
 * else the user's first area by sort order. If the user has missing default areas (common after
 * Google-only sign-up without `npm run seed`), creates the same defaults as seed.
 */
export async function resolveOrCreateImportAreaId(userId: string): Promise<string | null> {
  return db.transaction(async (tx) => {
    const userRow = await tx.execute(sql`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`);
    if (userRow.rowCount === 0) return null;

    const envArea = process.env.CALDAV_IMPORT_AREA_ID?.trim();
    if (envArea) {
      const row = await tx.query.areas.findFirst({
        where: and(eq(areas.id, envArea), eq(areas.userId, userId)),
      });
      if (row) return row.id;
    }

    const first = await tx.query.areas.findFirst({
      where: eq(areas.userId, userId),
      orderBy: (a, { asc }) => [asc(a.sortOrder), asc(a.name)],
    });
    if (first) return first.id;

    await ensureDefaultAreas(tx, userId);
    const createdFirst = await tx.query.areas.findFirst({
      where: eq(areas.userId, userId),
      orderBy: (a, { asc }) => [asc(a.sortOrder), asc(a.name)],
    });
    return createdFirst?.id ?? null;
  });
}
