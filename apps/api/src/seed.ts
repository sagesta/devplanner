/**
 * One-shot dev seed: default user + area. Run from repo root: npm run seed
 */
import { eq } from "drizzle-orm";
import { db, pool } from "./db/client.js";
import { areas, users } from "./db/schema.js";

const email = process.env.SEED_USER_EMAIL ?? "dev@localhost";

async function main() {
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let userId = existing[0]?.id;
  if (!userId) {
    const [u] = await db
      .insert(users)
      .values({
        email,
        name: "Dev User",
        passwordHash: null,
      })
      .returning({ id: users.id });
    userId = u.id;
    console.log("Created user", email, userId);
  } else {
    console.log("User exists", email, userId);
  }

  const areaRows = await db.select().from(areas).where(eq(areas.userId, userId)).limit(1);
  if (!areaRows.length) {
    await db.insert(areas).values({
      userId,
      name: "Work",
      color: "#01696f",
      sortOrder: 0,
    });
    await db.insert(areas).values({
      userId,
      name: "Personal",
      color: "#6b7280",
      sortOrder: 1,
    });
    console.log("Created default areas");
  } else {
    console.log("Areas already present");
  }

  console.log("\nSet in apps/web .env.local:");
  console.log(`NEXT_PUBLIC_DEV_USER_ID=${userId}`);
  console.log("\nOr pass ?userId=${userId} to API during development.");
}

main()
  .catch(console.error)
  .finally(() => pool.end());
