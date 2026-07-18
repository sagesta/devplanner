import { authHeaders } from "./auth-token";
import { getApiBase } from "./env";

// ─── Centralized fetch wrapper ────────────────────────────────────
// The Hono API is a separate origin in prod, so Clerk's session cookie never
// reaches it — every call carries a short-lived Bearer token instead.
async function fetchJson<T>(url: string | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(url.toString(), {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
      ...(init?.headers ?? {}),
    },
    cache: "no-store" as RequestCache,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    let parsedError: string | null = null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.error === "string") {
        parsedError = parsed.error;
      }
    } catch {
      // Response was not JSON; keep the raw text fallback below.
    }
    if (parsedError) {
      throw new Error(parsedError);
    }
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
  dueDate: string | null;
  scheduledDate?: string | null;
  sprintId: string | null;
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
  _subtasks?: SubtaskRow[];
  _tags?: Array<{ id: number; name: string; color: string | null }>;
};

export type SubtaskRow = {
  id: string;
  taskId: string;
  title: string;
  completed: boolean;
  scheduledDate: string | null;
  scheduledTime: string | null;
  estimatedMinutes: number | null;
  completedAt: string | null;
  createdAt: string;
};

export type AreaRow = {
  id: string;
  userId: string;
  name: string;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  weeklyHourTarget?: string | null;
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

export type CalendarProgressDay = {
  date: string;
  plannedUnits: number;
  completedUnits: number;
  plannedMinutes: number;
  completedMinutes: number;
  overdueUnits: number;
  percent: number;
  status: "empty" | "complete" | "missed" | "overload" | "planned";
};

export type ScheduleProposal = {
  id: string;
  targetType: "task" | "subtask";
  targetId: string;
  title: string;
  fromDate: string;
  toDate: string;
  estimatedMinutes: number;
  priority: string;
  workDepth: string | null;
  physicalEnergy: string | null;
  reason: string;
  risk: "low" | "medium" | "high";
};

export type SchedulePreviewResponse = {
  proposals: ScheduleProposal[];
  learning: {
    dailyCapacity: number;
    peakHour: number | null;
    deepWorkHours: number[];
    observedCompletionCount: number;
  };
};

// ─── Tasks ────────────────────────────────────────────────────────
export async function fetchTasks(sprintId?: string): Promise<TaskRow[]> {
  const params: Record<string, string> = {};
  if (sprintId) params.sprintId = sprintId;
  const data = await fetchJson<{ tasks: TaskRow[] }>(apiUrl("/api/tasks", params));
  return data.tasks;
}

export async function fetchBacklog(): Promise<TaskRow[]> {
  const data = await fetchJson<{ tasks: TaskRow[] }>(apiUrl("/api/backlog"));
  return data.tasks;
}

export async function fetchToday(date?: string) {
  const params: Record<string, string> = {};
  if (date) params.date = date;
  return fetchJson<{ tasks: TaskRow[]; date: string; doneTodayCount: number; dailyCapacity: number; usedMinutes: number }>(
    apiUrl("/api/tasks/today", params)
  );
}

export async function fetchTaskDetail(taskId: string) {
  return fetchJson<{
    task: TaskRow;
    subtasks: SubtaskRow[];
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
  return fetchJson<{ task: TaskRow; spawnedNext?: TaskRow | null }>(apiUrl(`/api/tasks/${taskId}`), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteTask(taskId: string) {
  return fetchJson<{ ok: boolean }>(apiUrl(`/api/tasks/${taskId}`), {
    method: "DELETE",
  });
}

export async function restoreTask(taskId: string) {
  return fetchJson<{ task: TaskRow }>(apiUrl(`/api/tasks/restore/${taskId}`), {
    method: "POST",
  });
}

// ─── Subtasks ─────────────────────────────────────────────────────
export async function createSubtask(body: {
  taskId: string;
  title: string;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  estimatedMinutes?: number | null;
}) {
  return fetchJson<{ subtask: SubtaskRow }>(apiUrl("/api/subtasks"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function patchSubtask(id: string, body: Partial<{
  title: string;
  completed: boolean;
  scheduledDate: string | null;
  scheduledTime: string | null;
  estimatedMinutes: number | null;
}>) {
  return fetchJson<{ subtask: SubtaskRow }>(apiUrl(`/api/subtasks/${id}`), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteSubtask(id: string) {
  return fetchJson<{ ok: boolean }>(apiUrl(`/api/subtasks/${id}`), {
    method: "DELETE",
  });
}

export async function postSubtasksBulk(taskId: string, subtasks: { title: string; scheduledDate?: string | null; estimatedMinutes?: number | null }[]) {
  return fetchJson<{ subtasks: SubtaskRow[] }>(apiUrl("/api/subtasks/bulk"), {
    method: "POST",
    body: JSON.stringify({ taskId, subtasks }),
  });
}

export async function postSubtasksSpread(taskId: string, subtaskTitles: string[], startDate: string, endDate: string, maxPerDay?: number) {
  return fetchJson<{ subtasks: SubtaskRow[] }>(apiUrl("/api/subtasks/spread"), {
    method: "POST",
    body: JSON.stringify({ taskId, subtaskTitles, startDate, endDate, maxPerDay }),
  });
}

export async function patchTasksBulkSchedule(ids: string[], scheduledDate: string | null) {
  return fetchJson<{ updated: number }>(apiUrl("/api/tasks/bulk"), {
    method: "PATCH",
    body: JSON.stringify({ ids, scheduledDate }),
  });
}

export async function patchTasksBulkSprint(taskIds: string[], sprintId: string | null) {
  return fetchJson<{ updated: number }>(apiUrl("/api/tasks/bulk-sprint"), {
    method: "POST",
    body: JSON.stringify({ taskIds, sprintId }),
  });
}

export async function postAutoSchedule(date: string) {
  return fetchJson<SchedulePreviewResponse & { mode?: string; message?: string; error?: string }>(apiUrl("/api/tasks/auto-schedule"), {
    method: "POST",
    body: JSON.stringify({ date }),
  });
}

export async function fetchInsightsActivity() {
  return fetchJson<{
    activityHeatmap: { hour: number; label: string; minutes: number }[];
    peakHourLabel: string;
    recommendedDeepWork: number[];
  }>(apiUrl("/api/insights/activity"));
}

export async function fetchCalendarProgress(start: string, end: string) {
  return fetchJson<{ start: string; end: string; dailyCapacity: number; days: CalendarProgressDay[] }>(
    apiUrl("/api/insights/calendar-progress", { start, end })
  );
}

export async function postSchedulePreview(fromDate: string, horizonEnd: string) {
  return fetchJson<SchedulePreviewResponse>(apiUrl("/api/schedule/preview"), {
    method: "POST",
    body: JSON.stringify({ fromDate, horizonEnd }),
  });
}

export async function postScheduleApply(proposals: ScheduleProposal[]) {
  return fetchJson<{ applied: number; skipped: number }>(apiUrl("/api/schedule/apply"), {
    method: "POST",
    body: JSON.stringify({ proposals }),
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

// ─── AI brain-dump parser ─────────────────────────────────────────
export type DumpBucket = "today" | "this_week" | "backlog" | "noise";
export type ParsedDumpItem = {
  title: string;
  energy: "deep_work" | "shallow" | "admin" | "quick_win";
  priority: "urgent" | "high" | "normal" | "low";
  estimated_minutes: number;
  /** Triage hint from the model: where this item should live. */
  bucket: DumpBucket;
};

export async function parseDump(raw: string) {
  return fetchJson<{ draft: ParsedDumpItem[]; model: string; warning?: string }>(
    apiUrl("/api/ai/parse-dump"),
    {
      method: "POST",
      body: JSON.stringify({ raw }),
    }
  );
}

// ─── Priority anchors ─────────────────────────────────────────────
export type PriorityCategory = "work" | "personal" | "growth";
export type PriorityPeriod = "week" | "month";

export type PriorityRow = {
  id: string;
  userId: string;
  periodType: PriorityPeriod;
  periodStart: string; // YYYY-MM-DD
  category: PriorityCategory;
  statement: string;
  createdAt: string;
  updatedAt: string;
};

export type GoalCellKey =
  | "short:personal"
  | "short:professional"
  | "short:work"
  | "mid:personal"
  | "mid:professional"
  | "mid:work"
  | "long:personal"
  | "long:professional"
  | "long:work";

export type GoalMatrix = Record<GoalCellKey, string>;

export type GoalHorizonsResponse = {
  ownerName: string | null;
  goals: GoalMatrix;
  updatedAt: string | null;
};

export type PrioritiesResponse = {
  period: { week: string; month: string };
  week_anchors: PriorityRow[];
  month_anchors: PriorityRow[];
};

export async function fetchPriorities() {
  return fetchJson<PrioritiesResponse>(apiUrl("/api/priorities"));
}

export async function savePriorities(
  anchors: Array<{
    periodType: PriorityPeriod;
    periodStart: string;
    category: PriorityCategory;
    statement: string;
  }>
) {
  return fetchJson<{ ok: true; upserted: number; deleted: number }>(
    apiUrl("/api/priorities"),
    {
      method: "PUT",
      body: JSON.stringify({ anchors }),
    }
  );
}

export async function suggestPriorities(periodType: PriorityPeriod, periodStart: string) {
  return fetchJson<{
    drafts: Array<{ category: PriorityCategory; statement: string }>;
    model: string;
  }>(apiUrl("/api/priorities/suggest"), {
    method: "POST",
    body: JSON.stringify({ periodType, periodStart }),
  });
}

// ─── Goal horizons ────────────────────────────────────────────────
export async function fetchGoalHorizons() {
  return fetchJson<GoalHorizonsResponse>("/api/goals");
}

export async function saveGoalHorizons(body: { ownerName: string; goals: GoalMatrix }) {
  return fetchJson<GoalHorizonsResponse>("/api/goals", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/**
 * Send a recorded audio blob to Whisper for transcription.
 * Returns the recognized text. We deliberately don't reuse fetchJson because
 * the body is multipart/form-data, not JSON.
 */
export async function transcribeAudio(audio: Blob, opts?: { language?: string }) {
  const form = new FormData();
  // Whisper sniffs format from the filename extension — give it a hint.
  const ext = audio.type.includes("ogg")
    ? "ogg"
    : audio.type.includes("mp4")
      ? "m4a"
      : audio.type.includes("wav")
        ? "wav"
        : "webm";
  form.append("audio", audio, `recording.${ext}`);
  if (opts?.language) form.append("language", opts.language);
  const res = await fetch(apiUrl("/api/ai/transcribe"), {
    method: "POST",
    credentials: "include",
    headers: await authHeaders(),
    body: form,
    cache: "no-store" as RequestCache,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`Transcribe ${res.status}: ${text}`);
  }
  return res.json() as Promise<{ text: string; model: string }>;
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

export async function deleteSprint(sprintId: string) {
  return fetchJson<{ ok: boolean }>(apiUrl(`/api/sprints/${sprintId}`), {
    method: "DELETE",
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

// ─── Time Logs ────────────────────────────────────────────────────
export type TimeLogRow = {
  id: number;
  taskId: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  note: string | null;
  createdAt: string;
};

export type ActiveTimerRow = TimeLogRow & {
  taskTitle: string;
};

export type TimeLogSummaryRow = {
  taskId: string;
  taskTitle: string;
  areaId: string | null;
  areaName: string | null;
  weeklyHourTarget: string | null;
  totalSeconds: number;
};

export async function startTimer(taskId: string) {
  return fetchJson<{ log: TimeLogRow }>(apiUrl("/api/time-logs/start"), {
    method: "POST",
    body: JSON.stringify({ task_id: taskId }),
  });
}

export async function stopTimer(logId: number) {
  return fetchJson<{ log: TimeLogRow }>(apiUrl(`/api/time-logs/${logId}/stop`), {
    method: "PATCH",
  });
}

export async function fetchTimeLogs(taskId: string): Promise<TimeLogRow[]> {
  const data = await fetchJson<{ logs: TimeLogRow[] }>(apiUrl("/api/time-logs", { task_id: taskId }));
  return data.logs;
}

export async function fetchActiveTimer(): Promise<ActiveTimerRow | null> {
  const data = await fetchJson<{ log: ActiveTimerRow | null }>(apiUrl("/api/time-logs/active"));
  return data.log;
}

export async function deleteTimeLog(id: number) {
  return fetchJson<{ ok: boolean }>(apiUrl(`/api/time-logs/${id}`), {
    method: "DELETE",
  });
}

export async function fetchWeekSummary(weekStart: string): Promise<TimeLogSummaryRow[]> {
  const data = await fetchJson<{ summary: TimeLogSummaryRow[] }>(apiUrl("/api/time-logs/summary/week", { week_start: weekStart }));
  return data.summary;
}

// ─── Tags ─────────────────────────────────────────────────────────
export type TagRow = {
  id: number;
  name: string;
  color: string | null;
  createdAt: string;
};

export async function fetchAllTags(): Promise<TagRow[]> {
  const data = await fetchJson<{ tags: TagRow[] }>(apiUrl("/api/tags"));
  return data.tags;
}

export async function createTag(body: { name: string; color?: string }) {
  return fetchJson<{ tag: TagRow }>(apiUrl("/api/tags"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteTag(id: number) {
  return fetchJson<{ ok: boolean }>(apiUrl(`/api/tags/${id}`), {
    method: "DELETE",
  });
}

export async function setTaskTags(taskId: string, tagIds: number[]) {
  return fetchJson<{ tags: Array<{ id: number; name: string; color: string | null }> }>(
    apiUrl(`/api/tags/tasks/${taskId}/tags`),
    {
      method: "POST",
      body: JSON.stringify({ tag_ids: tagIds }),
    }
  );
}

// ─── Areas (extended) ─────────────────────────────────────────────
export async function patchArea(
  areaId: string,
  body: Partial<{ name: string; color: string | null; icon: string | null; sortOrder: number; weekly_hour_target: number | null }>
) {
  return fetchJson<{ area: AreaRow }>(apiUrl(`/api/areas/${areaId}`), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// ─── Reviews ──────────────────────────────────────────────────────
export async function saveReview(body: {
  step1?: string;
  step2?: string;
  step3?: string;
}) {
  return fetchJson<{ success: boolean; file: string }>(apiUrl("/api/reviews"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ─── Accomplishments ──────────────────────────────────────────────
export type AccomplishmentRow = {
  id: string;
  userId: string;
  taskId: string | null;
  date: string; // YYYY-MM-DD
  title: string;
  impact: string | null;
  metric: string | null;
  skills: string[] | null;
  createdAt: string;
  updatedAt: string;
};

export type AccomplishmentInput = {
  date: string;
  title: string;
  impact?: string | null;
  metric?: string | null;
  skills?: string[] | string | null;
  taskId?: string | null;
};

export async function fetchAccomplishments(): Promise<AccomplishmentRow[]> {
  const data = await fetchJson<{ accomplishments: AccomplishmentRow[] }>(
    apiUrl("/api/accomplishments")
  );
  return data.accomplishments;
}

export async function createAccomplishment(body: AccomplishmentInput) {
  return fetchJson<{ accomplishment: AccomplishmentRow }>(apiUrl("/api/accomplishments"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateAccomplishment(
  id: string,
  body: Partial<Omit<AccomplishmentInput, "taskId">>
) {
  return fetchJson<{ accomplishment: AccomplishmentRow }>(apiUrl(`/api/accomplishments/${id}`), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteAccomplishment(id: string) {
  return fetchJson<{ ok: boolean }>(apiUrl(`/api/accomplishments/${id}`), {
    method: "DELETE",
  });
}

