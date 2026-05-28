import { asc, eq } from "drizzle-orm";
import { areas } from "../db/schema.js";

export const DEFAULT_AREAS = [
  { name: "Work", color: "#01696f", sortOrder: 0 },
  { name: "Personal", color: "#6b7280", sortOrder: 1 },
  { name: "Growth", color: "#f59e0b", sortOrder: 2 },
] as const;

function normalizeAreaName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function ensureDefaultAreas(store: any, userId: string): Promise<void> {
  const existing = await store.query.areas.findMany({
    where: eq(areas.userId, userId),
    orderBy: [asc(areas.sortOrder), asc(areas.name)],
  });
  const existingNames = new Set(
    existing.map((area: { name: string }) => normalizeAreaName(area.name))
  );
  const missing = DEFAULT_AREAS.filter((area) => !existingNames.has(normalizeAreaName(area.name)));

  if (missing.length === 0) return;

  await store.insert(areas).values(
    missing.map((area) => ({
      userId,
      name: area.name,
      color: area.color,
      sortOrder: area.sortOrder,
    }))
  );
}
