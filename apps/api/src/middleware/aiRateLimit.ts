import type { Context, Next } from "hono";
import { createRedisConnection } from "../queues/connection.js";

const WINDOW_SEC = 60;

function limitPerMinute(): number {
  const n = Number(process.env.AI_RATE_LIMIT_RPM ?? "20");
  if (Number.isNaN(n) || n < 1) return 20;
  return Math.min(n, 10_000);
}

let redis: ReturnType<typeof createRedisConnection> | null = null;

function getRedis() {
  if (!redis) redis = createRedisConnection();
  return redis;
}

/** Per-user RPM for /api/ai/* (after requireAuth). */
export async function aiRateLimit(c: Context, next: Next) {
  if (!c.req.path.startsWith("/api/ai")) {
    return next();
  }

  const userId = c.get("userId");
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const key = `ai:ratelimit:${userId}`;
  const limit = limitPerMinute();

  try {
    const r = getRedis();
    const count = await r.incr(key);
    if (count === 1) {
      await r.expire(key, WINDOW_SEC);
    }
    if (count > limit) {
      return c.json({ error: "Rate limit exceeded", retryAfter: WINDOW_SEC }, 429);
    }
  } catch (e) {
    console.error("[aiRateLimit] Redis error:", e);
    // fail open if Redis down so AI still works in degraded mode
  }

  return next();
}
