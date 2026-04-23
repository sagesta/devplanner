import "./lib/loadRootEnv.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { pool } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { validateEnv } from "./lib/validateEnv.js";
import { logger } from "./lib/logger.js";
import { registry, httpRequestsTotal, httpRequestDurationMs } from "./lib/metrics.js";
import { aiRateLimit } from "./middleware/aiRateLimit.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { aiRoutes } from "./routes/ai.js";
import { areaRoutes } from "./routes/areas.js";
import { eventRoutes } from "./routes/events.js";
import { focusRoutes } from "./routes/focus.js";
import { projectRoutes } from "./routes/projects.js";
import { sprintRoutes } from "./routes/sprints.js";
import { syncRoutes } from "./routes/sync.js";
import { tagRoutes } from "./routes/tags.js";
import { taskRoutes } from "./routes/tasks.js";
import { backlogRoutes } from "./routes/backlog.js";
import { subtasksRoutes } from "./routes/subtasks.js";
import { timeLogRoutes } from "./routes/time-logs.js";
import { insightsRoutes } from "./routes/insights.js";
import { reviewRoutes } from "./routes/reviews.js";
import { createRedisConnection } from "./queues/connection.js";
import type { AppEnv } from "./types.js";

validateEnv();

const app = new Hono<AppEnv>();

// ─── Middleware ────────────────────────────────────────────────────

// Pino request logger (replaces Hono built-in logger())
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const durationMs = Date.now() - start;
  logger.info({
    method: c.req.method,
    path: c.req.path,
    statusCode: c.res.status,
    durationMs,
  }, "request");
});

app.use(
  "*",
  cors({
    origin: (origin) => {
      const raw = process.env.CORS_ORIGIN ?? "http://localhost:3000";
      const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
      if (!origin) return list[0] ?? "http://localhost:3000";
      return list.includes(origin) ? origin : null;
    },
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Cookie"],
    credentials: true,
  })
);

app.use("*", requireAuth);
app.use("*", aiRateLimit);

// Request timing + Prometheus metrics
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  c.header("X-Response-Time", `${ms}ms`);

  // Normalise path to avoid high-cardinality label explosions (e.g. UUIDs)
  const rawPath = c.req.routePath ?? c.req.path;
  httpRequestsTotal.inc({
    method: c.req.method,
    path: rawPath,
    status: String(c.res.status),
  });
  httpRequestDurationMs.observe({ method: c.req.method, path: rawPath }, ms);
});

// Global error handler — catch unhandled exceptions → 500 JSON
app.onError((err, c) => {
  logger.error({ err, stack: err.stack, path: c.req.path }, "[API Error]");
  return c.json(
    { error: err.message ?? "Internal server error", stack: process.env.NODE_ENV === "development" ? err.stack : undefined },
    500
  );
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not found", path: c.req.path }, 404);
});

// ─── Health ───────────────────────────────────────────────────────
app.get("/", (c) =>
  c.json({
    service: "DevPlanner API",
    health: "/health",
    hint: "The web UI runs on port 3000 (Next.js). Open http://localhost:3000 after npm run dev.",
  })
);

app.get("/health", async (c) => {
  const uptime = process.uptime();
  const mem = process.memoryUsage();

  // DB check
  let dbStatus: "ok" | "error" = "ok";
  let dbError: string | undefined;
  try {
    await pool.query("SELECT 1");
  } catch (e) {
    dbStatus = "error";
    dbError = String(e);
  }

  // Redis check
  let redisStatus: "ok" | "error" = "ok";
  let redisError: string | undefined;
  let redisClient: ReturnType<typeof createRedisConnection> | null = null;
  try {
    redisClient = createRedisConnection();
    await redisClient.ping();
  } catch (e) {
    redisStatus = "error";
    redisError = String(e);
  } finally {
    redisClient?.disconnect();
  }

  const overallStatus = dbStatus === "ok" && redisStatus === "ok" ? "ok" : "degraded";

  return c.json(
    {
      status: overallStatus,
      uptime,
      version: process.env.npm_package_version ?? "0.1.0",
      db: { status: dbStatus, ...(dbError ? { error: dbError } : {}) },
      redis: { status: redisStatus, ...(redisError ? { error: redisError } : {}) },
      memory: {
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
        rssMb: Math.round(mem.rss / 1024 / 1024),
      },
    },
    overallStatus === "ok" ? 200 : 503
  );
});

app.get("/api/health", (c) => c.json({ ok: true, uptime: process.uptime() }));

app.get("/health/db", async (c) => {
  try {
    const { rows } = await pool.query("SELECT NOW() as time");
    return c.json({ ok: true, time: rows[0]?.time });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 503);
  }
});

app.get("/health/vector", async (c) => {
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 503);
  }
});

// ─── Metrics (public — no auth) ───────────────────────────────────
app.get("/metrics", async (c) => {
  const metrics = await registry.metrics();
  return c.text(metrics, 200, {
    "Content-Type": registry.contentType,
  });
});

// ─── Routes ───────────────────────────────────────────────────────
app.route("/api/tasks", taskRoutes);
app.route("/api/areas", areaRoutes);
app.route("/api/sprints", sprintRoutes);
app.route("/api/projects", projectRoutes);
app.route("/api/focus", focusRoutes);
app.route("/api/events", eventRoutes);
app.route("/api/ai", aiRoutes);
app.route("/api/sync", syncRoutes);
app.route("/api/time-logs", timeLogRoutes);
app.route("/api/tags", tagRoutes);
app.route("/api/subtasks", subtasksRoutes);
app.route("/api/backlog", backlogRoutes);
app.route("/api/insights", insightsRoutes);
app.route("/api/reviews", reviewRoutes);

// ─── Startup ──────────────────────────────────────────────────────
const port = Number(process.env.PORT) || 3001;
const hostname = process.env.HOST?.trim() || "0.0.0.0";

// Run idempotent schema migrations before accepting traffic.
// Safe to run on every boot — all statements use IF NOT EXISTS.
await runMigrations(pool);

logger.info({ port, hostname }, `DevPlanner API listening on http://${hostname}:${port}`);
serve({ fetch: app.fetch, port, hostname });
