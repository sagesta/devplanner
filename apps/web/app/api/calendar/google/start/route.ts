import { NextResponse } from "next/server";
import { callCalendarApi, calendarResult } from "@/lib/google-oauth-bridge";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const response = await callCalendarApi(
      "/api/sync/google/start?format=json",
    );
    if (!response) return calendarResult(request, "sign_in_required");
    if (!response.ok) return calendarResult(request, "connection_unavailable");
    const data = (await response.json()) as { url?: string };
    const target = new URL(data.url ?? "");
    if (target.origin !== "https://accounts.google.com")
      return calendarResult(request, "invalid_redirect");
    const redirect = NextResponse.redirect(target, 303);
    redirect.headers.set("Cache-Control", "no-store");
    redirect.headers.set("Referrer-Policy", "no-referrer");
    return redirect;
  } catch {
    return calendarResult(request, "connection_unavailable");
  }
}
