/**
 * Runs before the API server in Docker: wait for Postgres, ensure pgvector, then drizzle-kit push.
 * Set SKIP_SCHEMA_SYNC=1 to skip push (e.g. strict prod where you run migrations separately).
 */
import { spawnSync } from "node:child_process";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[entrypoint] DATABASE_URL is required");
  process.exit(1);
}

async function waitAndEnsureVector() {
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");
      await client.end();
      console.log("[entrypoint] Postgres ready; vector extension ensured");
      return;
    } catch (e) {
      await client.end().catch(() => {});
      if (i === maxAttempts - 1) {
        console.error("[entrypoint] Database unavailable:", e);
        process.exit(1);
      }
      console.log(`[entrypoint] Waiting for database (${i + 1}/${maxAttempts})...`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

await waitAndEnsureVector();

if (process.env.SKIP_SCHEMA_SYNC === "1") {
  console.log("[entrypoint] SKIP_SCHEMA_SYNC=1 — skipping drizzle-kit push");
  process.exit(0);
}

console.log("[entrypoint] Running drizzle-kit push...");
const r = spawnSync("npm", ["run", "db:push", "-w", "@devplanner/api"], {
  cwd: "/app",
  stdio: "inherit",
  env: process.env,
  shell: false,
});
if (r.status !== 0) {
  console.error("[entrypoint] db:push failed");
  process.exit(r.status ?? 1);
}
console.log("[entrypoint] Schema sync complete");
process.exit(0);
