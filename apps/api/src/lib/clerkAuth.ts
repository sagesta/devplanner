import { createClerkClient, verifyToken } from "@clerk/backend";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { areas, users } from "../db/schema.js";
import { logger } from "./logger.js";

/**
 * Clerk-backed identity for the Hono API.
 *
 * The browser sends a short-lived Clerk session token as `Authorization:
 * Bearer …` (cookies don't cross the api.* origin in prod). We verify it,
 * then map the Clerk user to the INTERNAL users.id UUID by email — the same
 * UUID minted under NextAuth — so every FK'd row (tasks, goals,
 * accomplishments) survives the migration untouched.
 */

const secretKey = process.env.CLERK_SECRET_KEY?.trim();
const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();

const clerk = createClerkClient({
  secretKey: secretKey ?? "",
  publishableKey: publishableKey ?? "",
});

function authorizedParties(): string[] {
  const parties = new Set<string>(["http://localhost:3000"]);
  // WEB_APP_URL / APP_URL is the codebase's real convention (see routes/sync.ts,
  // .env.example) — matched here for consistency, not "WEBAPP_URL".
  for (const raw of [process.env.WEB_APP_URL, process.env.APP_URL, process.env.CORS_ORIGIN]) {
    for (const origin of (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
      parties.add(origin);
    }
  }
  return [...parties];
}

function allowedEmailSet(): Set<string> {
  return new Set(
    (process.env.ALLOWED_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** Verify the request's Clerk session (Bearer header or cookie). Returns the Clerk user id or null. */
export async function clerkUserIdFromRequest(request: Request): Promise<string | null> {
  if (!secretKey) return null;
  try {
    const state = await clerk.authenticateRequest(request, {
      authorizedParties: authorizedParties(),
    });
    const auth = state.toAuth();
    return auth?.userId ?? null;
  } catch (err) {
    logger.warn({ err }, "clerk authenticateRequest failed");
    return null;
  }
}

/** Verify a raw session token (EventSource can't send headers, so SSE passes ?auth_token=). */
export async function clerkUserIdFromToken(token: string): Promise<string | null> {
  if (!secretKey) return null;
  try {
    const payload = await verifyToken(token, { secretKey });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

type InternalUser = { id: string; email: string };

/** Clerk user id → internal UUID. Stable for a process lifetime, so cache hard. */
const userCache = new Map<string, InternalUser>();

export class NotAllowedError extends Error {}

/**
 * Resolve (and if needed create) the internal user row for a Clerk user.
 * Enforces the ALLOWED_EMAILS gate — throws NotAllowedError for outsiders.
 */
export async function resolveInternalUserId(clerkUserId: string): Promise<string> {
  const cached = userCache.get(clerkUserId);
  if (cached) return cached.id;

  const clerkUser = await clerk.users.getUser(clerkUserId);
  const email = (
    clerkUser.primaryEmailAddress?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress ??
    ""
  )
    .trim()
    .toLowerCase();
  if (!email) throw new NotAllowedError("Account has no email address");

  const allowed = allowedEmailSet();
  if (!allowed.has(email)) throw new NotAllowedError(`Email not on the allowlist`);

  const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;

  // Same upsert semantics the NextAuth sign-in callback used — existing rows
  // (matched by email) keep their UUID and therefore all of their data.
  const [row] = await db
    .insert(users)
    .values({ email, name, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: users.email,
      set: { name, updatedAt: new Date() },
    })
    .returning({ id: users.id });
  if (!row) throw new Error("Failed to upsert user");

  // First sign-in bootstrap: default areas (idempotent — only when none exist).
  const existingArea = await db
    .select({ id: areas.id })
    .from(areas)
    .where(eq(areas.userId, row.id))
    .limit(1);
  if (existingArea.length === 0) {
    await db.insert(areas).values([
      { userId: row.id, name: "Work", color: "#01696f", sortOrder: 0 },
      { userId: row.id, name: "Personal", color: "#6b7280", sortOrder: 1 },
      { userId: row.id, name: "Professional", color: "#f59e0b", sortOrder: 2 },
    ]);
  }

  userCache.set(clerkUserId, { id: row.id, email });
  return row.id;
}
