import type { Context, Next } from "hono";
import {
  clerkUserIdFromRequest,
  clerkUserIdFromToken,
  NotAllowedError,
  resolveInternalUserId,
} from "../lib/clerkAuth.js";

function isPublicPath(path: string, method: string): boolean {
  if (method === "OPTIONS") return true;
  if (path === "/" || path === "/health" || path === "/health/db" || path === "/health/vector") return true;
  if (path === "/api/health") return true;
  if (path === "/metrics") return true;
  return false;
}

/**
 * Verify the Clerk session and set c.set('userId', <internal users.id UUID>).
 *
 * Accepts the session token from the Authorization header / cookie, or — for
 * EventSource connections only, which cannot set headers — from an
 * `auth_token` query parameter on /api/events/*.
 */
export async function requireAuth(c: Context, next: Next) {
  const path = c.req.path;
  const method = c.req.method;
  if (isPublicPath(path, method)) {
    return next();
  }

  let clerkUserId = await clerkUserIdFromRequest(c.req.raw);

  if (!clerkUserId && method === "GET" && path.startsWith("/api/events")) {
    const token = c.req.query("auth_token");
    if (token) clerkUserId = await clerkUserIdFromToken(token);
  }

  if (!clerkUserId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const userId = await resolveInternalUserId(clerkUserId);
    c.set("userId", userId);
  } catch (err) {
    if (err instanceof NotAllowedError) {
      return c.json({ error: "This account is not allowed on this instance." }, 403);
    }
    throw err;
  }

  return next();
}
