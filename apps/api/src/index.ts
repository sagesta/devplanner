import "./lib/loadRootEnv.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { pool } from "./db/client.js";
import { validateEnv } from "./lib/validateEnv.js";
import { aiRateLimit } from "./middleware/aiRateLimit.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { aiRoutes } from "./routes/ai.js";
import { areaRoutes } from "./routes/areas.js";
import { eventRoutes } from "./routes/events.js";
import { focusRoutes } from "./routes/focus.js";
import { projectRoutes } from "./routes/projects.js";
import { sprintRoutes } from "./routes/sprints.js";
import { syncRoutes } from "./routes/sync.js";
import { taskRoutes } from "./routes/tasks.js";
import type { AppEnv } from "./types.js";

validateEnv();

const app = new Hono<AppEnv>();

// ─── Middleware ────────────────────────────────────────────────────
app.use("*", logger());

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

// Request timing
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  c.header("X-Response-Time", `${ms}ms`);
});

// Global error handler — catch unhandled exceptions → 500 JSON
app.onError((err, c) => {
  console.error("[API Error]", err);
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

app.get("/health", (c) => c.json({ ok: true, uptime: process.uptime() }));

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

// ─── Routes ───────────────────────────────────────────────────────
app.route("/api/tasks", taskRoutes);
app.route("/api/areas", areaRoutes);
app.route("/api/sprints", sprintRoutes);
app.route("/api/projects", projectRoutes);
app.route("/api/focus", focusRoutes);
app.route("/api/events", eventRoutes);
app.route("/api/ai", aiRoutes);
app.route("/api/sync", syncRoutes);

const port = Number(process.env.PORT) || 3001;
const hostname = process.env.HOST?.trim() || "0.0.0.0";
console.log(`DevPlanner API listening on http://${hostname}:${port}`);
serve({ fetch: app.fetch, port, hostname });
