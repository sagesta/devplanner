import { authHeaders } from "./auth-token";
import * as api from "./api";
import {
  completeWeeklyReview,
  createTask,
  fetchActiveTimer,
  fetchBacklog,
  fetchCurrentReview,
  fetchDailyPreferences,
  fetchGoalHorizons,
  fetchReviews,
  fetchTasks,
  fetchTimeLogs,
  fetchToday,
  fetchWeekSummary,
  getGoogleOAuthStartUrl,
  patchTask,
  postCaptureBatch,
  postScheduleApply,
  saveDailyTimezone,
  saveGoalHorizons,
  saveReviewDraft,
  startTimer,
  stopTimer,
  transcribeAudio,
  type WeeklyReviewInput,
} from "./api";

jest.mock("./auth-token", () => ({ authHeaders: jest.fn() }));
jest.mock("./env", () => ({ getApiBase: () => "https://api.example.test" }));

const mockAuthHeaders = authHeaders as jest.MockedFunction<typeof authHeaders>;
const originalFetch = global.fetch;
const reply = (body: unknown, status = 200) =>
  ({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  }) as Response;

beforeEach(() => {
  mockAuthHeaders.mockResolvedValue({ Authorization: "Bearer session-token" });
  global.fetch = jest.fn();
});
afterAll(() => {
  global.fetch = originalFetch;
});

test("task list uses the API origin, encodes filters, and unwraps the response", async () => {
  const tasks = [{ id: "task-1", title: "Ship report" }];
  (global.fetch as jest.Mock).mockResolvedValue(reply({ tasks }));
  expect(await fetchTasks("sprint & launch")).toEqual(tasks);
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(new URL(url).origin).toBe("https://api.example.test");
  expect(new URL(url).searchParams.get("sprintId")).toBe("sprint & launch");
  expect(init).toEqual(
    expect.objectContaining({
      credentials: "include",
      cache: "no-store",
      headers: expect.objectContaining({
        Authorization: "Bearer session-token",
      }),
    }),
  );
});

test("Today request sends the requested date and returns capacity context", async () => {
  const today = {
    date: "2026-09-29",
    tasks: [],
    doneTodayCount: 3,
    dailyCapacity: 480,
    usedMinutes: 90,
  };
  (global.fetch as jest.Mock).mockResolvedValue(reply(today));
  expect(await fetchToday("2026-09-29")).toEqual(today);
  expect(
    new URL((global.fetch as jest.Mock).mock.calls[0][0]).searchParams.get(
      "date",
    ),
  ).toBe("2026-09-29");
});

test("task creation, status change, and backlog reads retain server revisions", async () => {
  const task = {
    id: "t1",
    title: "Repair deploy",
    revision: 3,
    status: "todo",
  };
  (global.fetch as jest.Mock)
    .mockResolvedValueOnce(
      reply({ task: { ...task, revision: 1, status: "backlog" } }),
    )
    .mockResolvedValueOnce(reply({ task, spawnedNext: null }))
    .mockResolvedValueOnce(reply({ tasks: [task] }));
  expect(
    (await createTask({ areaId: "a1", title: task.title })).task.revision,
  ).toBe(1);
  expect(
    (await patchTask("t1", { status: "todo", expectedRevision: 1 })).task,
  ).toEqual(task);
  expect(await fetchBacklog()).toEqual([task]);
  const calls = (global.fetch as jest.Mock).mock.calls;
  expect(calls[0][1]).toEqual(
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ areaId: "a1", title: task.title }),
    }),
  );
  expect(calls[1][1]).toEqual(
    expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ status: "todo", expectedRevision: 1 }),
    }),
  );
  expect(calls[2][0]).toBe("https://api.example.test/api/backlog");
});

test("timer calls preserve task identity, active log, and selected week", async () => {
  const log = {
    id: 42,
    taskId: "t1",
    startedAt: "2026-09-29T09:00:00Z",
    endedAt: null,
  };
  const summary = [{ taskId: "t1", totalSeconds: 900 }];
  (global.fetch as jest.Mock)
    .mockResolvedValueOnce(reply({ log }))
    .mockResolvedValueOnce(
      reply({ log: { ...log, endedAt: "2026-09-29T09:15:00Z" } }),
    )
    .mockResolvedValueOnce(reply({ log }))
    .mockResolvedValueOnce(reply({ logs: [log] }))
    .mockResolvedValueOnce(reply({ summary }));
  expect((await startTimer("t1")).log.id).toBe(42);
  expect((await stopTimer(42)).log.endedAt).toBe("2026-09-29T09:15:00Z");
  expect((await fetchActiveTimer())?.taskId).toBe("t1");
  expect(await fetchTimeLogs("t1")).toEqual([log]);
  expect(await fetchWeekSummary("2026-09-28")).toEqual(summary);
  const calls = (global.fetch as jest.Mock).mock.calls;
  expect(calls[0][1]).toEqual(
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ task_id: "t1" }),
    }),
  );
  expect(calls[1][0]).toBe("https://api.example.test/api/time-logs/42/stop");
  expect(new URL(calls[3][0]).searchParams.get("task_id")).toBe("t1");
  expect(new URL(calls[4][0]).searchParams.get("week_start")).toBe(
    "2026-09-28",
  );
});

test("timezone preference saves and reads the configured IANA zone", async () => {
  (global.fetch as jest.Mock).mockResolvedValue(
    reply({ timezone: "Africa/Lagos" }),
  );
  expect(await saveDailyTimezone("Africa/Lagos")).toEqual({
    timezone: "Africa/Lagos",
  });
  expect(await fetchDailyPreferences()).toEqual({ timezone: "Africa/Lagos" });
  const calls = (global.fetch as jest.Mock).mock.calls;
  expect(calls[0][1]).toEqual(
    expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ timezone: "Africa/Lagos" }),
    }),
  );
  expect(calls[1][0]).toBe("https://api.example.test/api/daily/preferences");
});

test("weekly review saves require a revision and completion includes the sprint decision", async () => {
  const input: WeeklyReviewInput = {
    weekStart: "2026-09-28",
    weekEnd: "2026-10-04",
    wins: "Shipped",
    carryover: "",
    intentions: [{ text: "Finish API", goalKey: null, goalLabel: null }],
    sprintNotes: "",
  };
  (global.fetch as jest.Mock).mockResolvedValue(
    reply({ review: { revision: 8 } }),
  );
  await saveReviewDraft(input, 7);
  await completeWeeklyReview(input, 8, false);
  const [draftUrl, draftInit] = (global.fetch as jest.Mock).mock.calls[0];
  const [completeUrl, completeInit] = (global.fetch as jest.Mock).mock.calls[1];
  expect(draftUrl).toBe("https://api.example.test/api/reviews");
  expect(draftInit.method).toBe("PUT");
  expect(JSON.parse(draftInit.body)).toEqual({ ...input, expectedRevision: 7 });
  expect(completeUrl).toBe("https://api.example.test/api/reviews/complete");
  expect(completeInit.method).toBe("POST");
  expect(JSON.parse(completeInit.body)).toEqual({
    ...input,
    expectedRevision: 8,
    createSprint: false,
  });
});

test("review lookup and search preserve query values without creating extra parameters", async () => {
  (global.fetch as jest.Mock).mockResolvedValue(
    reply({ review: null, reviews: [] }),
  );
  await fetchCurrentReview("2026-09-28&admin=true");
  await fetchReviews({
    query: "  work & life  ",
    from: "2026-09-01",
    to: "2026-09-30",
  });
  const current = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
  expect(current.searchParams.get("weekStart")).toBe("2026-09-28&admin=true");
  expect(current.searchParams.has("admin")).toBe(false);
  const search = new URL((global.fetch as jest.Mock).mock.calls[1][0]);
  expect(search.searchParams.get("q")).toBe("work & life");
  expect(search.searchParams.get("from")).toBe("2026-09-01");
  expect(search.searchParams.get("to")).toBe("2026-09-30");
});

test("capture and schedule apply send stable idempotency receipts", async () => {
  (global.fetch as jest.Mock).mockResolvedValue(
    reply({ created: 1, tasks: [] }),
  );
  const capture = {
    items: [{ title: "Call mum" }],
    idempotencyKey: "capture-1",
  };
  await postCaptureBatch(capture);
  await postScheduleApply("preview-1", ["proposal-1"], "apply-1");
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toEqual(
    capture,
  );
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body)).toEqual(
    {
      previewId: "preview-1",
      selectedIds: ["proposal-1"],
      idempotencyKey: "apply-1",
    },
  );
});

test("goals and Google OAuth stay on their web same-origin routes", async () => {
  (global.fetch as jest.Mock).mockResolvedValue(
    reply({ ownerName: null, goals: {}, updatedAt: null }),
  );
  await fetchGoalHorizons();
  await saveGoalHorizons({
    ownerName: "Sam",
    goals: {} as Parameters<typeof saveGoalHorizons>[0]["goals"],
  });
  expect((global.fetch as jest.Mock).mock.calls.map((call) => call[0])).toEqual(
    ["/api/goals", "/api/goals"],
  );
  expect(getGoogleOAuthStartUrl()).toBe("/api/calendar/google/start");
});

test("API error handling preserves useful server messages and raw response context", async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(
    reply({ error: "Review changed" }, 409),
  );
  await expect(fetchCurrentReview("2026-09-28")).rejects.toMatchObject({
    message: "Review changed",
    status: 409,
  });
  (global.fetch as jest.Mock).mockResolvedValueOnce(
    reply("upstream unavailable", 503),
  );
  await expect(fetchTasks()).rejects.toMatchObject({
    message: "API 503: upstream unavailable",
    status: 503,
  });
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    status: 502,
    text: async () => {
      throw new Error("stream ended");
    },
  });
  await expect(fetchToday()).rejects.toThrow("API 502: Unknown error");
});

test("transcription sends multipart audio without a JSON content type", async () => {
  (global.fetch as jest.Mock).mockResolvedValue(
    reply({ text: "Buy milk", model: "whisper" }),
  );
  const audio = new Blob(["audio"], { type: "audio/mp4" });
  expect(await transcribeAudio(audio, { language: "en" })).toEqual({
    text: "Buy milk",
    model: "whisper",
  });
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toBe("https://api.example.test/api/ai/transcribe");
  expect(init.method).toBe("POST");
  expect(init.headers).toEqual({ Authorization: "Bearer session-token" });
  expect(init.body).toBeInstanceOf(FormData);
  expect((init.body as FormData).get("language")).toBe("en");
  expect((init.body as FormData).get("audio")).toBeInstanceOf(Blob);
});

describe("task and subtask endpoint contracts", () => {
  const cases: Array<{
    name: string;
    invoke: () => Promise<unknown>;
    url: string;
    method: string;
    body?: unknown;
    response: unknown;
    result: unknown;
  }> = [
    {
      name: "fetch task detail",
      invoke: () => api.fetchTaskDetail("t1"),
      url: "/api/tasks/t1",
      method: "GET",
      response: {
        task: { id: "t1" },
        subtasks: [],
        subtaskProgress: { done: 0, total: 0 },
      },
      result: {
        task: { id: "t1" },
        subtasks: [],
        subtaskProgress: { done: 0, total: 0 },
      },
    },
    {
      name: "create subtask",
      invoke: () => api.createSubtask({ taskId: "t1", title: "Write test" }),
      url: "/api/subtasks",
      method: "POST",
      body: { taskId: "t1", title: "Write test" },
      response: { subtask: { id: "s1", revision: 1 } },
      result: { subtask: { id: "s1", revision: 1 } },
    },
    {
      name: "patch subtask",
      invoke: () => api.patchSubtask("s1", { completed: true }),
      url: "/api/subtasks/s1",
      method: "PATCH",
      body: { completed: true },
      response: { subtask: { id: "s1", revision: 2, completed: true } },
      result: { subtask: { id: "s1", revision: 2, completed: true } },
    },
    {
      name: "spread subtasks",
      invoke: () =>
        api.postSubtasksSpread("t1", ["A", "B"], "2026-09-29", "2026-10-02", 1),
      url: "/api/subtasks/spread",
      method: "POST",
      body: {
        taskId: "t1",
        subtaskTitles: ["A", "B"],
        startDate: "2026-09-29",
        endDate: "2026-10-02",
        maxPerDay: 1,
      },
      response: { subtasks: [{ id: "s1" }, { id: "s2" }] },
      result: { subtasks: [{ id: "s1" }, { id: "s2" }] },
    },
    {
      name: "bulk schedule",
      invoke: () => api.patchTasksBulkSchedule(["t1", "t2"], null),
      url: "/api/tasks/bulk",
      method: "PATCH",
      body: { ids: ["t1", "t2"], scheduledDate: null },
      response: { updated: 2 },
      result: { updated: 2 },
    },
    {
      name: "bulk sprint",
      invoke: () => api.patchTasksBulkSprint(["t1"], "sprint-1"),
      url: "/api/tasks/bulk-sprint",
      method: "POST",
      body: { taskIds: ["t1"], sprintId: "sprint-1" },
      response: { updated: 1 },
      result: { updated: 1 },
    },
    {
      name: "bulk status",
      invoke: () => api.postBulkStatus(["t1"], "done"),
      url: "/api/tasks/bulk-status",
      method: "POST",
      body: { taskIds: ["t1"], status: "done" },
      response: { updated: 1 },
      result: { updated: 1 },
    },
  ];
  test.each(cases)(
    "$name",
    async ({ invoke, url, method, body, response, result }) => {
      (global.fetch as jest.Mock).mockResolvedValue(reply(response));
      expect(await invoke()).toEqual(result);
      const [calledUrl, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(calledUrl).toBe(`https://api.example.test${url}`);
      expect(init.method ?? "GET").toBe(method);
      if (body !== undefined) expect(JSON.parse(init.body)).toEqual(body);
    },
  );
});

test("calendar and scheduler reads keep date filters and explicit apply selection", async () => {
  const progress = {
    start: "2026-09-28",
    end: "2026-10-04",
    dailyCapacity: 480,
    days: [],
  };
  (global.fetch as jest.Mock)
    .mockResolvedValueOnce(reply(progress))
    .mockResolvedValueOnce(
      reply({ previewId: "p1", proposals: [], learning: {} }),
    )
    .mockResolvedValueOnce(reply({ applied: 1, skipped: 0 }));
  expect(await api.fetchCalendarProgress("2026-09-28", "2026-10-04")).toEqual(
    progress,
  );
  expect(
    (await api.postSchedulePreview("2026-09-29", "2026-10-06")).previewId,
  ).toBe("p1");
  expect(
    await api.postScheduleApply("p1", ["proposal-1"], "receipt-1"),
  ).toEqual({ applied: 1, skipped: 0 });
  const calls = (global.fetch as jest.Mock).mock.calls;
  expect(new URL(calls[0][0]).searchParams.get("start")).toBe("2026-09-28");
  expect(new URL(calls[0][0]).searchParams.get("end")).toBe("2026-10-04");
  expect(JSON.parse(calls[1][1].body)).toEqual({
    fromDate: "2026-09-29",
    horizonEnd: "2026-10-06",
  });
  expect(JSON.parse(calls[2][1].body)).toEqual({
    previewId: "p1",
    selectedIds: ["proposal-1"],
    idempotencyKey: "receipt-1",
  });
});

test("malformed API error payload uses status context and invalid success payload rejects", async () => {
  (global.fetch as jest.Mock)
    .mockResolvedValueOnce(reply({ error: 123, detail: "Invalid" }, 422))
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Invalid JSON");
      },
    });
  await expect(api.fetchAreas()).rejects.toThrow(
    'API 422: {"error":123,"detail":"Invalid"}',
  );
  await expect(api.fetchAreas()).rejects.toThrow("Invalid JSON");
});

describe("planning, organization, and accomplishment contracts", () => {
  const cases: Array<{
    name: string;
    invoke: () => Promise<unknown>;
    url: string;
    method?: string;
    body?: unknown;
    response: unknown;
    result: unknown;
  }> = [
    {
      name: "read priorities",
      invoke: () => api.fetchPriorities(),
      url: "/api/priorities",
      response: {
        period: { week: "2026-09-28", month: "2026-09-01" },
        week_anchors: [{ id: "p1" }],
        month_anchors: [],
      },
      result: {
        period: { week: "2026-09-28", month: "2026-09-01" },
        week_anchors: [{ id: "p1" }],
        month_anchors: [],
      },
    },
    {
      name: "save priority anchors",
      invoke: () =>
        api.savePriorities([
          {
            periodType: "week",
            periodStart: "2026-09-28",
            category: "work",
            statement: "Ship",
          },
        ]),
      url: "/api/priorities",
      method: "PUT",
      body: {
        anchors: [
          {
            periodType: "week",
            periodStart: "2026-09-28",
            category: "work",
            statement: "Ship",
          },
        ],
      },
      response: { ok: true, upserted: 1, deleted: 0 },
      result: { ok: true, upserted: 1, deleted: 0 },
    },
    {
      name: "suggest priority anchors",
      invoke: () => api.suggestPriorities("week", "2026-09-28"),
      url: "/api/priorities/suggest",
      method: "POST",
      body: { periodType: "week", periodStart: "2026-09-28" },
      response: {
        drafts: [{ category: "work", statement: "Ship" }],
        model: "gpt",
      },
      result: {
        drafts: [{ category: "work", statement: "Ship" }],
        model: "gpt",
      },
    },
    {
      name: "read areas",
      invoke: () => api.fetchAreas(),
      url: "/api/areas",
      response: { areas: [{ id: "a1", name: "Work" }] },
      result: [{ id: "a1", name: "Work" }],
    },
    {
      name: "create area",
      invoke: () => api.createArea({ name: "Health", color: "#f00" }),
      url: "/api/areas",
      method: "POST",
      body: { name: "Health", color: "#f00" },
      response: { area: { id: "a2", name: "Health" } },
      result: { area: { id: "a2", name: "Health" } },
    },
    {
      name: "patch area",
      invoke: () => api.patchArea("a1", { weekly_hour_target: 5 }),
      url: "/api/areas/a1",
      method: "PATCH",
      body: { weekly_hour_target: 5 },
      response: { area: { id: "a1", weeklyHourTarget: "5" } },
      result: { area: { id: "a1", weeklyHourTarget: "5" } },
    },
    {
      name: "read sprints",
      invoke: () => api.fetchSprints(),
      url: "/api/sprints",
      response: { sprints: [{ id: "sp1", name: "Launch" }] },
      result: { sprints: [{ id: "sp1", name: "Launch" }] },
    },
    {
      name: "create sprint",
      invoke: () =>
        api.createSprint({
          name: "Launch",
          startDate: "2026-09-28",
          endDate: "2026-10-04",
        }),
      url: "/api/sprints",
      method: "POST",
      body: { name: "Launch", startDate: "2026-09-28", endDate: "2026-10-04" },
      response: { sprint: { id: "sp1" } },
      result: { sprint: { id: "sp1" } },
    },
    {
      name: "read tags",
      invoke: () => api.fetchAllTags(),
      url: "/api/tags",
      response: { tags: [{ id: 1, name: "urgent" }] },
      result: [{ id: 1, name: "urgent" }],
    },
    {
      name: "set task tags",
      invoke: () => api.setTaskTags("t1", [1, 2]),
      url: "/api/tags/tasks/t1/tags",
      method: "POST",
      body: { tag_ids: [1, 2] },
      response: { tags: [{ id: 1, name: "urgent" }] },
      result: { tags: [{ id: 1, name: "urgent" }] },
    },
    {
      name: "read accomplishments",
      invoke: () => api.fetchAccomplishments(),
      url: "/api/accomplishments",
      response: { accomplishments: [{ id: "ac1", title: "Shipped" }] },
      result: [{ id: "ac1", title: "Shipped" }],
    },
    {
      name: "create accomplishment",
      invoke: () =>
        api.createAccomplishment({ date: "2026-09-29", title: "Shipped" }),
      url: "/api/accomplishments",
      method: "POST",
      body: { date: "2026-09-29", title: "Shipped" },
      response: { accomplishment: { id: "ac1" } },
      result: { accomplishment: { id: "ac1" } },
    },
    {
      name: "update accomplishment",
      invoke: () =>
        api.updateAccomplishment("ac1", { impact: "Saved 2 hours" }),
      url: "/api/accomplishments/ac1",
      method: "PATCH",
      body: { impact: "Saved 2 hours" },
      response: { accomplishment: { id: "ac1", impact: "Saved 2 hours" } },
      result: { accomplishment: { id: "ac1", impact: "Saved 2 hours" } },
    },
  ];
  test.each(cases)(
    "$name",
    async ({ invoke, url, method, body, response, result }) => {
      (global.fetch as jest.Mock).mockResolvedValue(reply(response));
      expect(await invoke()).toEqual(result);
      const [calledUrl, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(calledUrl).toBe(`https://api.example.test${url}`);
      expect(init.method ?? "GET").toBe(method ?? "GET");
      if (body !== undefined) expect(JSON.parse(init.body)).toEqual(body);
    },
  );
});

describe("calendar sync and AI endpoint contracts", () => {
  const cases: Array<{
    name: string;
    invoke: () => Promise<unknown>;
    url: string;
    method?: string;
    body?: unknown;
    response: unknown;
  }> = [
    {
      name: "Google connection status",
      invoke: () => api.fetchGoogleCalendarStatus(),
      url: "/api/sync/google/status",
      response: { ok: true, connected: true, oauthConfigured: true },
    },
    {
      name: "Google disconnect",
      invoke: () => api.postGoogleCalendarDisconnect(),
      url: "/api/sync/google/disconnect",
      method: "POST",
      body: {},
      response: { ok: true },
    },
    {
      name: "Google immediate pull",
      invoke: () => api.postGoogleCalendarPullNow(),
      url: "/api/sync/google/pull-now",
      method: "POST",
      body: {},
      response: {
        ok: true,
        stats: { imported: 2, updated: 0, removed: 0, skipped: 0, errors: [] },
      },
    },
    {
      name: "CalDAV queued pull",
      invoke: () => api.postCaldavPullQueued(),
      url: "/api/sync/caldav/pull",
      method: "POST",
      body: {},
      response: { ok: true, queued: true },
    },
    {
      name: "AI configuration",
      invoke: () => api.fetchAiConfig(),
      url: "/api/ai/config",
      response: {
        openaiKeySet: false,
        defaultChatModel: "gpt",
        allowedChatModels: ["gpt"],
      },
    },
    {
      name: "AI parse draft",
      invoke: () => api.parseDump("buy milk"),
      url: "/api/ai/parse-dump",
      method: "POST",
      body: { raw: "buy milk" },
      response: { draft: [{ title: "buy milk" }], model: "gpt" },
    },
  ];
  test.each(cases)("$name", async ({ invoke, url, method, body, response }) => {
    (global.fetch as jest.Mock).mockResolvedValue(reply(response));
    expect(await invoke()).toEqual(response);
    const [calledUrl, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(calledUrl).toBe(`https://api.example.test${url}`);
    expect(init.method ?? "GET").toBe(method ?? "GET");
    if (body !== undefined) expect(JSON.parse(init.body)).toEqual(body);
  });
});
