import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getApiBase } from "./env";

/** Keep Clerk bearer credentials server-side during browser redirects. */
export async function callCalendarApi(
  path: string,
  body?: unknown,
): Promise<Response | null> {
  const { userId, getToken } = await auth();
  if (!userId) return null;
  const token = await getToken();
  if (!token) return null;
  return fetch(`${process.env.API_INTERNAL_URL ?? getApiBase()}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
}
export function calendarResult(
  request: Request,
  result: string,
  success = false,
): NextResponse {
  const url = new URL("/settings", request.url);
  url.searchParams.set("tab", "calendar");
  url.searchParams.set(success ? "google" : "google_error", result);
  const response = NextResponse.redirect(url, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
