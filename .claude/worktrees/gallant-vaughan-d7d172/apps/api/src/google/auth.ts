import { google } from "googleapis";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { googleCalendarLinks } from "../db/schema.js";
import { getGoogleClientId, getGoogleClientSecret, getGoogleRedirectUri, googleCalendarConfigured } from "./config.js";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

import type { Auth } from 'googleapis';

export function createOAuth2Client(): Auth.OAuth2Client {
  return new google.auth.OAuth2(getGoogleClientId(), getGoogleClientSecret(), getGoogleRedirectUri());
}

export function buildGoogleAuthorizeUrl(userId: string): string | null {
  if (!googleCalendarConfigured()) return null;
  const oauth2 = createOAuth2Client();
  const state = Buffer.from(JSON.stringify({ u: userId }), "utf8").toString("base64url");
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [CALENDAR_SCOPE],
    state,
  });
}

export function parseOAuthState(state: string): { userId: string } | null {
  try {
    const raw = Buffer.from(state, "base64url").toString("utf8");
    const j = JSON.parse(raw) as { u?: string };
    if (!j.u || typeof j.u !== "string") return null;
    return { userId: j.u };
  } catch {
    return null;
  }
}

export async function exchangeCodeForTokens(code: string): Promise<{ access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null; token_type?: string | null; id_token?: string | null; scope?: string }> {
  const oauth2 = createOAuth2Client();
  const { tokens } = await oauth2.getToken(code);
  return tokens;
}

export type CalendarClientBundle = {
  calendar: ReturnType<typeof google.calendar>;
  calendarId: string;
};

export async function getCalendarForUser(userId: string): Promise<CalendarClientBundle | null> {
  const link = await db.query.googleCalendarLinks.findFirst({
    where: eq(googleCalendarLinks.userId, userId),
  });
  if (!link) return null;
  const oauth2 = createOAuth2Client();
  oauth2.setCredentials({ refresh_token: link.refreshToken });
  const calendar = google.calendar({ version: "v3", auth: oauth2 });
  return { calendar, calendarId: link.calendarId || "primary" };
}

export async function listGoogleLinkedUserIds(): Promise<string[]> {
  const rows = await db.select({ userId: googleCalendarLinks.userId }).from(googleCalendarLinks);
  return rows.map((r) => r.userId);
}

export async function userHasGoogleLink(userId: string): Promise<boolean> {
  const row = await db.query.googleCalendarLinks.findFirst({
    where: eq(googleCalendarLinks.userId, userId),
    columns: { userId: true },
  });
  return Boolean(row);
}

export async function saveGoogleLink(input: {
  userId: string;
  refreshToken: string;
  calendarId?: string;
  /** When false, keep existing incremental sync token on reconnect. */
  resetSync?: boolean;
}) {
  const now = new Date();
  const calId = input.calendarId?.trim() || "primary";
  const resetSync = input.resetSync !== false;
  await db
    .insert(googleCalendarLinks)
    .values({
      userId: input.userId,
      refreshToken: input.refreshToken,
      calendarId: calId,
      syncToken: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: googleCalendarLinks.userId,
      set: {
        refreshToken: input.refreshToken,
        calendarId: calId,
        ...(resetSync ? { syncToken: null } : {}),
        updatedAt: now,
      },
    });
}

/**
 * After OAuth: persist refresh token. Clears Calendar sync token only when Google returns a new refresh_token.
 */
export async function upsertGoogleLinkFromOAuth(
  userId: string,
  tokens: { refresh_token?: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await db.query.googleCalendarLinks.findFirst({
    where: eq(googleCalendarLinks.userId, userId),
  });
  const newRt = tokens.refresh_token?.trim();
  if (!newRt && !existing?.refreshToken) {
    return {
      ok: false,
      error:
        "No refresh token from Google. Open Google Account → Third-party access, remove DevPlanner, then connect again.",
    };
  }
  if (!newRt && existing) {
    return { ok: true };
  }
  await saveGoogleLink({
    userId,
    refreshToken: newRt!,
    resetSync: true,
  });
  return { ok: true };
}

export async function mergeGoogleRefreshToken(userId: string, newRefreshToken: string | null | undefined) {
  if (!newRefreshToken?.trim()) return;
  await db
    .update(googleCalendarLinks)
    .set({ refreshToken: newRefreshToken.trim(), updatedAt: new Date() })
    .where(eq(googleCalendarLinks.userId, userId));
}

export async function disconnectGoogle(userId: string) {
  await db.delete(googleCalendarLinks).where(eq(googleCalendarLinks.userId, userId));
}
