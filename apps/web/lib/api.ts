import { getApiBase } from "./env";

// ─── Centralized fetch wrapper ────────────────────────────────────
async function fetchJson<T>(url: string | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(url.toString(), {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store" as RequestCache,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

function apiUrl(path: string, params?: Record<string, string>): string {
  const u = new URL(`${getApiBase()}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) u.searchParams.set(k, v);
    }
  }
  return u.toString();
}

// ─── Types ────────────────────────────────────────────────────────
export type TaskRow = {
  id: string;
  userId: string;
  areaId: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  energyLevel: string;
  taskType: string;
  scheduledDate: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  estimatedMinutes: number | null;
  dueDate: string | null;
  sprintId: string | null;
  parentTaskId: string | null;
  icalUid?: string | null;
  caldavResourceFilename?: string | null;
  caldavRemoteDtstamp?: string | null;
  caldavLastPullAt?: string | null;
  googleEventId?: string | null;
  googleRemoteUpdated?: string | null;
  googleLastPullAt?: string | null;
  sortOrder: number;
  idleFlagged: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  recurrenceRule?: string | null;
  tags?: string[] | null;
  workDepth?: string | null;
  physicalEnergy?: string | null;
  recurring?: boolean;
  _subtasksDone?: number;
  _subtasksTotal?: number;
};

export type AreaRow = {
  id: string;
  userId: string;
  name: string;
  color: string | null;
  icon: string | null;
  sortOrder: number;
};

export type SprintRow = {
  id: string;
  userId: string;
  name: string;
  startDate: string;
  endDate: string;
  goal: string | null;
  status: string;
  capacityHours: number | null;
  taskCount?: number;
};

export type AiLogRow = {
  id: string;
  userId: string | null;
  jobType: string;
  model: string;
  provider: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsdEstimate: number | null;
  latencyMs: number | null;
  createdAt: string;
};

// ─── Tasks ────────────────────────────────────────────────────────
export async function fetchTasks(sprintId?: string): Promise<TaskRow[]> {
  const params: Record<string, string> = {};
  if (sprintId) params.sprintId = sprintId;
  const data = await fetchJson<{ tasks: TaskRow[] }>(apiUrl("/api/tasks", params));
  return data.tasks;
}

export async function fetchBacklog(): Promise<TaskRow[]> {
  const data = await fetchJson<{ tasks: TaskRow[] }>(apiUrl("/api/tasks/backlog"));
  return data.tasks;
}

export async function fetchToday(date?: string) {
  const params: Record<string, string> = {};
  if (date) params.date = date;
  return fetchJson<{ tasks: TaskRow[]; date: string }>(apiUrl("/api/tasks/today", params));
}

export async function fetchTaskDetail(taskId: string) {
  return fetchJson<{
    task: TaskRow;
    subtasks: TaskRow[];
    subtaskProgress: { done: number; total: number } | null;
  }>(apiUrl(`/api/tasks/${taskId}`));
}

export async function createTask(body: {
  areaId: string;
  title: string;
  projectId?: string | null;
  sprintId?: string | null;
  parentTaskId?: string | null;
  status?: string;
  priority?: string;
  energyLevel?: string;
  taskType?: string;
  scheduledDate?: string | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  dueDate?: string | null;
  recurrenceRule?: string | null;
  estimatedMinutes?: number | null;
  description?: string | null;
}) {
  return fetchJson<{ task: TaskRow }>(apiUrl("/api/tasks"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function patchTask(taskId: string, body: Record<string, unknown>) {
  return fetchJson<{ task: TaskRow }>(apiUrl(`/api/tasks/${taskId}`), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteTask(taskId: string) {
  return fetchJson<{ ok: boolean }>(apiUrl(`/api/tasks/${taskId}`), {
    method: "DELETE",
  });
}

export async function postBrainDumpLines(
  areaId: string,
  lines: string[],
  schedule?: {
    scheduledDate?: string | null;
    scheduledStartTime?: string | null;
    scheduledEndTime?: string | null;
    recurrenceRule?: string | null;
  }
) {
  return fetchJson<{ tasks: TaskRow[]; count: number }>(apiUrl("/api/tasks/brain-dump"), {
    method: "POST",
    body: JSON.stringify({ areaId, lines, ...schedule }),
  });
}

export async function postBulkStatus(
  taskIds: string[],
  status: "backlog" | "todo" | "in_progress" | "done" | "cancelled" | "blocked"
) {
  return fetchJson<{ updated: number }>(apiUrl("/api/tasks/bulk-status"), {
    method: "POST",
    body: JSON.stringify({ taskIds, status }),
  });
}

// ─── Areas ────────────────────────────────────────────────────────
export async function fetchAreas(): Promise<AreaRow[]> {
  const data = await fetchJson<{ areas: AreaRow[] }>(apiUrl("/api/areas"));
  return data.areas;
}

export async function createArea(body: { name: string; color?: string | null; icon?: string | null }) {
  return fetchJson<{ area: AreaRow }>(apiUrl("/api/areas"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ─── Sprints ──────────────────────────────────────────────────────
export async function fetchSprints() {
  return fetchJson<{ sprints: SprintRow[] }>(apiUrl("/api/sprints"));
}

export async function createSprint(body: {
  name: string;
  startDate: string;
  endDate: string;
  goal?: string | null;
  status?: string;
  capacityHours?: number | null;
}) {
  return fetchJson<{ sprint: SprintRow }>(apiUrl("/api/sprints"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function patchSprint(
  sprintId: string,
  body: Partial<{
    name: string;
    startDate: string;
    endDate: string;
    goal: string | null;
    status: string;
    capacityHours: number | null;
  }>
) {
  return fetchJson<{ sprint: SprintRow }>(apiUrl(`/api/sprints/${sprintId}`), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// ─── AI ───────────────────────────────────────────────────────────
export type AiConfigResponse = {
  openaiKeySet: boolean;
  defaultChatModel: string;
  allowedChatModels: string[];
};

export async function fetchAiConfig(): Promise<AiConfigResponse> {
  return fetchJson<AiConfigResponse>(apiUrl("/api/ai/config"));
}

export async function fetchAiLogs(limit = 30) {
  return fetchJson<{ logs: AiLogRow[] }>(apiUrl("/api/ai/logs", { limit: String(limit) }));
}

// ─── Focus ────────────────────────────────────────────────────────
export async function fetchFocusExport() {
  return fetchJson<{ date: string; tasks: unknown[] }>(apiUrl("/api/focus/export"));
}

// ─── CalDAV sync ───────────────────────────────────────────────────
export type CaldavPullStats = {
  imported: number;
  updated: number;
  removed: number;
  skipped: number;
  errors: string[];
};

export async function postCaldavMkcol() {
  return fetchJson<{ ok: boolean; message?: string; error?: string }>(apiUrl("/api/sync/caldav/mkcol"), {
    method: "POST",
    body: "{}",
  });
}

export async function postCaldavPullQueued() {
  return fetchJson<{ ok: boolean; queued?: boolean; error?: string }>(apiUrl("/api/sync/caldav/pull"), {
    method: "POST",
    body: "{}",
  });
}

export async function postCaldavPullNow() {
  return fetchJson<{ ok: boolean; stats: CaldavPullStats; error?: string }>(apiUrl("/api/sync/caldav/pull-now"), {
    method: "POST",
    body: "{}",
  });
}

// ─── Google Calendar (OAuth + Calendar API) ───────────────────────
export function getGoogleOAuthStartUrl(): string {
  return apiUrl("/api/sync/google/start");
}

export async function fetchGoogleCalendarStatus() {
  return fetchJson<{
    ok: boolean;
    connected: boolean;
    oauthConfigured: boolean;
    calendarId?: string | null;
    linkUpdatedAt?: string | null;
    lastGooglePullAt?: string | null;
  }>(apiUrl("/api/sync/google/status"));
}

export async function postGoogleCalendarDisconnect() {
  return fetchJson<{ ok: boolean }>(apiUrl("/api/sync/google/disconnect"), {
    method: "POST",
    body: "{}",
  });
}

export async function postGoogleCalendarPullQueued() {
  return fetchJson<{ ok: boolean; queued?: boolean }>(apiUrl("/api/sync/google/pull"), {
    method: "POST",
    body: "{}",
  });
}

export async function postGoogleCalendarPullNow() {
  return fetchJson<{ ok: boolean; stats: CaldavPullStats; error?: string }>(apiUrl("/api/sync/google/pull-now"), {
    method: "POST",
    body: "{}",
  });
}
