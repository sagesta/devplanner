import { authHeaders } from "./auth-token";
import { getApiBase } from "./env";

export type ExecutionTarget = {
  targetType: "task" | "subtask";
  targetId: string;
  expectedRevision: number;
};
export type FocusSelection = {
  date: string;
  targetType: "task" | "subtask";
  targetId: string;
};
export type CaptureItem = {
  title: string;
  areaId?: string;
  scheduledDate?: string | null;
};

async function dailyRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export async function captureDaily(
  items: CaptureItem[],
  idempotencyKey: string,
) {
  return dailyRequest<{
    tasks: Array<{ id: string; revision: number; areaId: string }>;
    created: number;
  }>("/api/daily/capture", {
    method: "POST",
    body: JSON.stringify({ items, idempotencyKey }),
  });
}

export async function moveDaily(
  targets: ExecutionTarget[],
  scheduledDate: string,
  idempotencyKey: string,
) {
  return dailyRequest<{ updated: number; targets: ExecutionTarget[] }>(
    "/api/daily/move",
    {
      method: "POST",
      body: JSON.stringify({ targets, scheduledDate, idempotencyKey }),
    },
  );
}

export async function fetchDailyFocus(date: string) {
  return dailyRequest<{ focus: FocusSelection | null }>(
    `/api/daily/focus?date=${encodeURIComponent(date)}`,
  );
}

export async function putDailyFocus(focus: FocusSelection) {
  return dailyRequest<{ focus: FocusSelection | null }>("/api/daily/focus", {
    method: "PUT",
    body: JSON.stringify(focus),
  });
}

export async function fetchDailyPreferences() {
  return dailyRequest<{ timezone: string }>("/api/daily/preferences");
}
