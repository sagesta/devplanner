import { and, eq, isNotNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client.js";
import { googleCalendarLinks, tasks } from "../db/schema.js";
import { caldavEnabled } from "../caldav/config.js";
import { runCaldavPullForUser } from "../caldav/pull-sync.js";
import { ensureCalendarCollection } from "../caldav/radicale-client.js";
import {
  buildGoogleAuthorizeUrl,
  disconnectGoogle,
  exchangeCodeForTokens,
  verifyGoogleOAuthState,
  upsertGoogleLinkFromOAuth,
  userHasGoogleLink,
} from "../google/auth.js";
import { googleCalendarConfigured } from "../google/config.js";
import { runGooglePullForUser } from "../google/sync-engine.js";
import {
  enqueueCaldavPull,
  enqueueGoogleCalendarPull,
} from "../queues/definitions.js";
import type { AppEnv } from "../types.js";

function webAppOrigin(): string {
  const u = process.env.WEB_APP_URL?.trim() || process.env.APP_URL?.trim();
  if (u) return u.replace(/\/$/, "");
  const c = process.env.CORS_ORIGIN?.split(",")[0]?.trim();
  if (c) return c.replace(/\/$/, "");
  return "http://localhost:3000";
}

export const syncRoutes = new Hono<AppEnv>()
  .get("/google/start", async (c) => {
    const userId = c.get("userId");
    if (!googleCalendarConfigured()) {
      return c.json(
        {
          error:
            "Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI in API .env",
        },
        503,
      );
    }
    const url = await buildGoogleAuthorizeUrl(userId);
    if (!url) return c.json({ error: "Google OAuth not configured" }, 503);
    c.header("Cache-Control", "no-store");
    return c.req.query("format") === "json"
      ? c.json({ url })
      : c.redirect(url, 302);
  })
  .get("/google/callback", async (c) => {
    c.header("Cache-Control", "no-store");
    const origin = webAppOrigin();
    const gErr = c.req.query("error");
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!(await verifyGoogleOAuthState(state, c.get("userId")))) {
      return c.redirect(
        `${origin}/settings?tab=calendar&google_error=invalid_state`,
        302,
      );
    }
    if (gErr || !code) {
      return c.redirect(
        `${origin}/settings?tab=calendar&google_error=${gErr ? "consent_denied" : "missing_code"}`,
        302,
      );
    }
    try {
      const tokens = await exchangeCodeForTokens(code);
      const r = await upsertGoogleLinkFromOAuth(c.get("userId"), tokens);
      if (!r.ok) {
        return c.redirect(
          `${origin}/settings?tab=calendar&google_error=${encodeURIComponent(r.error)}`,
          302,
        );
      }
    } catch {
      return c.redirect(
        `${origin}/settings?tab=calendar&google_error=${"connection_failed"}`,
        302,
      );
    }
    return c.redirect(`${origin}/settings?tab=calendar&google=connected`, 302);
  })
  .post("/google/complete", async (c) => {
    c.header("Cache-Control", "no-store");
    const body: unknown = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object")
      return c.json({ error: "Invalid callback" }, 422);
    const { state, code, error } = body as {
      state?: unknown;
      code?: unknown;
      error?: unknown;
    };
    if (!(await verifyGoogleOAuthState(state, c.get("userId"))))
      return c.json({ error: "invalid_state" }, 409);
    if (error) return c.json({ error: "consent_denied" }, 400);
    if (typeof code !== "string" || !code || code.length > 4096)
      return c.json({ error: "missing_code" }, 422);
    try {
      const tokens = await exchangeCodeForTokens(code);
      const result = await upsertGoogleLinkFromOAuth(c.get("userId"), tokens);
      if (!result.ok) return c.json({ error: "reconnect_required" }, 400);
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "connection_failed" }, 502);
    }
  })
  .get("/google/status", async (c) => {
    const userId = c.get("userId");
    const connected = await userHasGoogleLink(userId);
    const link = connected
      ? await db.query.googleCalendarLinks.findFirst({
          where: eq(googleCalendarLinks.userId, userId),
          columns: { calendarId: true, updatedAt: true },
        })
      : null;
    const [pullAgg] = await db
      .select({ last: sql<Date | null>`max(${tasks.googleLastPullAt})` })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), isNotNull(tasks.googleLastPullAt)));
    return c.json({
      ok: true,
      connected,
      oauthConfigured: googleCalendarConfigured(),
      calendarId: link?.calendarId ?? null,
      linkUpdatedAt: link?.updatedAt?.toISOString() ?? null,
      lastGooglePullAt: pullAgg?.last
        ? new Date(pullAgg.last).toISOString()
        : null,
    });
  })
  .post("/google/disconnect", async (c) => {
    await disconnectGoogle(c.get("userId"));
    return c.json({ ok: true });
  })
  .post("/google/pull", async (c) => {
    await enqueueGoogleCalendarPull({ userId: c.get("userId") });
    return c.json({ ok: true, queued: true });
  })
  .post("/google/pull-now", async (c) => {
    const stats = await runGooglePullForUser(c.get("userId"));
    return c.json({ ok: true, stats });
  })
  .post("/caldav", (c) => {
    return c.json({
      ok: true,
      message:
        "Push: task writes enqueue caldav-sync; worker PUT/DELETE + MKCOL when CALDAV_* is set. Pull: POST /api/sync/caldav/pull. Run `npm run worker` with Redis.",
    });
  })
  .post("/caldav/mkcol", async (c) => {
    if (!caldavEnabled()) {
      return c.json({ ok: false, error: "CalDAV not configured" }, 400);
    }
    const r = await ensureCalendarCollection();
    if (!r.ok) {
      return c.json({ ok: false, error: r.detail }, 502);
    }
    return c.json({
      ok: true,
      message: "Collection path exists or was created.",
    });
  })
  .post("/caldav/pull", async (c) => {
    if (!caldavEnabled()) {
      return c.json(
        { ok: false, error: "Set CALDAV_CALENDAR_URL and CALDAV_USER" },
        400,
      );
    }
    await enqueueCaldavPull({ userId: c.get("userId") });
    return c.json({ ok: true, queued: true });
  })
  /** Synchronous pull for ops / when Redis is down (can take several seconds). */
  .post("/caldav/pull-now", async (c) => {
    if (!caldavEnabled()) {
      return c.json(
        { ok: false, error: "Set CALDAV_CALENDAR_URL and CALDAV_USER" },
        400,
      );
    }
    const stats = await runCaldavPullForUser(c.get("userId"));
    return c.json({ ok: true, stats });
  });
