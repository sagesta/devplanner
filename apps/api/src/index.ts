import "./lib/loadRootEnv.js";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono } from "hono";
import { appCors } from "./middleware/appCors.js";
import { pool } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { validateEnv } from "./lib/validateEnv.js";
import { logger } from "./lib/logger.js";
import {
  registry,
  httpRequestsTotal,
  httpRequestDurationMs,
} from "./lib/metrics.js";
import { aiRateLimit } from "./middleware/aiRateLimit.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { accomplishmentRoutes } from "./routes/accomplishments.js";
import { aiRoutes } from "./routes/ai.js";
import { areaRoutes } from "./routes/areas.js";
import { eventRoutes } from "./routes/events.js";
import { focusRoutes } from "./routes/focus.js";
import { goalRoutes } from "./routes/goals.js";
import { projectRoutes } from "./routes/projects.js";
import { sprintRoutes } from "./routes/sprints.js";
import { syncRoutes } from "./routes/sync.js";
import { tagRoutes } from "./routes/tags.js";
import { taskRoutes } from "./routes/tasks.js";
import { backlogRoutes } from "./routes/backlog.js";
import { subtasksRoutes } from "./routes/subtasks.js";
import { timeLogRoutes } from "./routes/time-logs.js";
import { insightsRoutes } from "./routes/insights.js";
import { priorityRoutes } from "./routes/priorities.js";
import { reviewRoutes } from "./routes/reviews.js";
import { createHealthRoutes } from "./routes/health.js";
import { dailyRoutes } from "./routes/daily.js";
import { scheduleRoutes } from "./routes/schedule.js";
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
  const connectionIp = getConnInfo(c).remote.address;
  const forwardedIp = c.req.header("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const trustProxy = ["1", "true", "yes"].includes(
    (process.env.TRUST_PROXY ?? "").toLowerCase(),
  );
  const sourceIp = trustProxy && forwardedIp ? forwardedIp : connectionIp;
  logger.info(
    {
      method: c.req.method,
      path: c.req.path,
      statusCode: c.res.status,
      durationMs,
      sourceIp,
    },
    "request",
  );
});

app.use("*", appCors());

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
  logger.error({ err, path: c.req.path }, "[API Error]");
  return c.json(
    {
      error:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Internal server error",
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    },
    500,
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
  }),
);

app.route(
  "/health",
  createHealthRoutes({
    database: async () => {
      await pool.query("SELECT 1");
    },
    redis: async () => {
      const client = createRedisConnection();
      try {
        await client.ping();
      } finally {
        client.disconnect();
      }
    },
    vector: async () => {
      const result = await pool.query(
        "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='vector') AS enabled",
      );
      return result.rows[0]?.enabled === true;
    },
  }),
);
app.get("/api/health", (c) => c.json({ ok: true, uptime: process.uptime() }));

// ─── Metrics (public — no auth) ───────────────────────────────────
app.get("/metrics", async (c) => {
  const metrics = await registry.metrics();
  return c.text(metrics, 200, {
    "Content-Type": registry.contentType,
  });
});

// ─── Routes ───────────────────────────────────────────────────────
app.route("/api/daily", dailyRoutes);
app.route("/api/tasks", taskRoutes);
app.route("/api/areas", areaRoutes);
app.route("/api/sprints", sprintRoutes);
app.route("/api/projects", projectRoutes);
app.route("/api/focus", focusRoutes);
app.route("/api/goals", goalRoutes);
app.route("/api/events", eventRoutes);
app.route("/api/ai", aiRoutes);
app.route("/api/sync", syncRoutes);
app.route("/api/time-logs", timeLogRoutes);
app.route("/api/tags", tagRoutes);
app.route("/api/subtasks", subtasksRoutes);
app.route("/api/backlog", backlogRoutes);
app.route("/api/insights", insightsRoutes);
app.route("/api/reviews", reviewRoutes);
app.route("/api/schedule", scheduleRoutes);
app.route("/api/priorities", priorityRoutes);
app.route("/api/accomplishments", accomplishmentRoutes);

// ─── Startup ──────────────────────────────────────────────────────
const port = Number(process.env.PORT) || 3001;
const hostname = process.env.HOST?.trim() || "0.0.0.0";

// Run idempotent schema migrations before accepting traffic.
// Safe to run on every boot — all statements use IF NOT EXISTS.
await runMigrations(pool);

logger.info(
  { port, hostname },
  `DevPlanner API listening on http://${hostname}:${port}`,
);
serve({ fetch: app.fetch, port, hostname });
