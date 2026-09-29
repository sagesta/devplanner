/** Synthetic persistence benchmark. Run with node --import tsx (no Clerk/browser/providers).
 * DAILY_BENCHMARK_DATABASE_URL must identify a disposable daily_test/daily_benchmark DB.
 * Example: node --import tsx scripts/daily-benchmark.mjs --iterations=100 --concurrency=2 --output=results.json
 * Apply migrations first. The runner inserts one synthetic user and deletes only that user on exit.
 */
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
const option = (name, fallback) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;
const count = Number(option("iterations", "100"));
const concurrency = Number(option("concurrency", "1"));
if (
  !Number.isInteger(count) ||
  count < 1 ||
  count > 10000 ||
  !Number.isInteger(concurrency) ||
  concurrency < 1 ||
  concurrency > 8
)
  throw new Error("Iterations must be 1–10000; concurrency 1–8.");
const databaseUrl = process.env.DAILY_BENCHMARK_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    "Set DAILY_BENCHMARK_DATABASE_URL explicitly to a disposable database.",
  );
const parsed = new URL(databaseUrl);
if (!["/daily_test", "/daily_benchmark"].includes(parsed.pathname))
  throw new Error(
    "Only disposable daily_test or daily_benchmark databases are allowed.",
  );
process.env.DATABASE_URL = databaseUrl;
const { pool } = await import("../apps/api/src/db/client.ts");
const { capture, move } = await import("../apps/api/src/services/daily.ts");
const runId = randomUUID();
let userId;
const samples = [];
const memoryBefore = process.memoryUsage();
const startedAt = new Date().toISOString();
const start = performance.now();
let next = 0;
async function runOne(iteration) {
  const began = performance.now();
  const stages = {};
  try {
    let mark = performance.now();
    const input = {
      idempotencyKey: `bench-${runId}-${iteration}`,
      items: [{ title: `Synthetic task ${iteration}` }],
    };
    const created = await capture(userId, input);
    stages.captureMs = performance.now() - mark;
    mark = performance.now();
    const replay = await capture(userId, input);
    stages.replayMs = performance.now() - mark;
    if (!isDeepStrictEqual(created, replay))
      throw new Error("Idempotent response mismatch");
    mark = performance.now();
    const moved = await move(userId, {
      idempotencyKey: `move-${runId}-${iteration}`,
      scheduledDate: "2026-10-01",
      targets: [
        {
          targetType: "task",
          targetId: created.tasks[0].id,
          expectedRevision: created.tasks[0].revision,
        },
      ],
    });
    stages.moveMs = performance.now() - mark;
    if (moved.updated !== 1)
      throw new Error("Move did not update exactly one task");
    samples.push({
      iteration,
      ok: true,
      totalMs: performance.now() - began,
      ...stages,
      memory: process.memoryUsage(),
    });
  } catch (error) {
    samples.push({
      iteration,
      ok: false,
      totalMs: performance.now() - began,
      ...stages,
      error: { name: error.name, code: error.code ?? null },
      memory: process.memoryUsage(),
    });
  }
}
let cleanupSucceeded = false;
let cleanupError = null;
try {
  userId = (
    await pool.query(
      "INSERT INTO users(email,timezone) VALUES($1,$2) RETURNING id",
      [`benchmark-${runId}@example.invalid`, "Africa/Lagos"],
    )
  ).rows[0].id;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < count) {
        const index = next++;
        await runOne(index);
      }
    }),
  );
} finally {
  if (userId) {
    try {
      await pool.query("DELETE FROM users WHERE id=$1", [userId]);
      cleanupSucceeded = true;
    } catch (error) {
      cleanupError = { name: error.name, code: error.code ?? null };
    }
  }
  await pool.end();
}
const sorted = samples
  .filter((s) => s.ok)
  .map((s) => s.totalMs)
  .sort((a, b) => a - b);
const percentile = (q) =>
  sorted.length ? sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] : null;
const result = {
  schemaVersion: 1,
  source: "synthetic",
  scope:
    "PostgreSQL persistence services: capture, receipt replay, move; excludes HTTP, Clerk, browser, Redis and calendar providers",
  runId,
  startedAt,
  finishedAt: new Date().toISOString(),
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  configuration: {
    iterations: count,
    concurrency,
    databaseHost: parsed.hostname,
    database: parsed.pathname.slice(1),
  },
  summary: {
    completed: samples.length,
    errors: samples.filter((s) => !s.ok).length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    elapsedMs: performance.now() - start,
    memoryBefore,
    memoryAfter: process.memoryUsage(),
    cleanupSucceeded,
    cleanupError,
  },
  acceptanceTargets:
    "No performance target asserted. Two-minute first-task and ten-second capture usability targets require owner testing.",
  samples: samples.sort((a, b) => a.iteration - b.iteration),
};
const json = JSON.stringify(result, null, 2) + "\n";
const output = option("output", "");
if (output) await writeFile(output, json);
else process.stdout.write(json);
if (result.summary.errors || cleanupError) process.exitCode = 1;
