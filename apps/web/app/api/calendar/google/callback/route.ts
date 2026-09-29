import { callCalendarApi, calendarResult } from "@/lib/google-oauth-bridge";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  try {
    const response = await callCalendarApi("/api/sync/google/complete", {
      state: query.get("state"),
      code: query.get("code"),
      error: query.get("error"),
    });
    if (!response) return calendarResult(request, "sign_in_required");
    if (response.ok) return calendarResult(request, "connected", true);
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    const allowed = [
      "invalid_state",
      "consent_denied",
      "missing_code",
      "reconnect_required",
    ];
    return calendarResult(
      request,
      allowed.includes(body.error ?? "") ? body.error! : "connection_failed",
    );
  } catch {
    return calendarResult(request, "connection_failed");
  }
}
