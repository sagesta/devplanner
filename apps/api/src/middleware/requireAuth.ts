import type { Context, Next } from "hono";
import { getToken } from "next-auth/jwt";

function isPublicPath(path: string, method: string): boolean {
  if (method === "OPTIONS") return true;
  if (path === "/" || path === "/health" || path === "/health/db" || path === "/health/vector") return true;
  if (path === "/api/health") return true;
  return false;
}

/** Verify NextAuth JWT from session cookie; set c.set('userId', sub). */
export async function requireAuth(c: Context, next: Next) {
  const path = c.req.path;
  const method = c.req.method;
  if (isPublicPath(path, method)) {
    return next();
  }

  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) {
    return c.json({ error: "Server misconfiguration" }, 500);
  }

  const cookie = c.req.header("cookie") ?? "";
  const token = await getToken({
    req: {
      headers: { cookie },
    } as Parameters<typeof getToken>[0]["req"],
    secret,
  });

  if (!token?.sub) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("userId", token.sub);
  return next();
}
