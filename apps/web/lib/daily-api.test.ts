import { authHeaders } from "./auth-token";
import {
  captureDaily,
  fetchDailyFocus,
  fetchDailyPreferences,
  moveDaily,
  newIdempotencyKey,
  putDailyFocus,
} from "./daily-api";

jest.mock("./auth-token", () => ({ authHeaders: jest.fn() }));
jest.mock("./env", () => ({ getApiBase: () => "https://api.example.test" }));

const mockAuthHeaders = authHeaders as jest.MockedFunction<typeof authHeaders>;
const originalFetch = global.fetch;
const reply = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

beforeEach(() => {
  mockAuthHeaders.mockResolvedValue({ Authorization: "Bearer session-token" });
  global.fetch = jest.fn();
});

afterAll(() => {
  global.fetch = originalFetch;
});

test("batch capture sends one authenticated idempotent request and returns created tasks", async () => {
  const result = {
    created: 1,
    tasks: [{ id: "t1", revision: 1, areaId: "general" }],
  };
  (global.fetch as jest.Mock).mockResolvedValue(reply(result));
  expect(await captureDaily([{ title: "Fix sign-in" }], "capture-1")).toEqual(
    result,
  );
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledWith(
    "https://api.example.test/api/daily/capture",
    expect.objectContaining({
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: expect.objectContaining({
        "Content-Type": "application/json",
        Authorization: "Bearer session-token",
      }),
      body: JSON.stringify({
        items: [{ title: "Fix sign-in" }],
        idempotencyKey: "capture-1",
      }),
    }),
  );
});

test("move preserves each target revision and the destination date", async () => {
  const targets = [
    { targetType: "subtask" as const, targetId: "s1", expectedRevision: 7 },
  ];
  (global.fetch as jest.Mock).mockResolvedValue(reply({ updated: 1, targets }));
  expect(await moveDaily(targets, "2026-09-30", "move-1")).toEqual({
    updated: 1,
    targets,
  });
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toEqual(
    { targets, scheduledDate: "2026-09-30", idempotencyKey: "move-1" },
  );
});

test("focus query encodes user input and the PUT sends its target", async () => {
  const focus = {
    date: "2026-09-29",
    targetType: "task" as const,
    targetId: "t1",
  };
  (global.fetch as jest.Mock).mockResolvedValue(reply({ focus }));
  await fetchDailyFocus("2026-09-29&other=1");
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
    "https://api.example.test/api/daily/focus?date=2026-09-29%26other%3D1",
  );
  expect(await putDailyFocus(focus)).toEqual({ focus });
  expect((global.fetch as jest.Mock).mock.calls[1][1]).toEqual(
    expect.objectContaining({ method: "PUT", body: JSON.stringify(focus) }),
  );
});

test("preferences return the configured timezone", async () => {
  (global.fetch as jest.Mock).mockResolvedValue(
    reply({ timezone: "Africa/Lagos" }),
  );
  expect(await fetchDailyPreferences()).toEqual({ timezone: "Africa/Lagos" });
});

test("API errors surface server messages and handle malformed responses", async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(
    reply({ error: "Revision changed" }, 409),
  );
  await expect(moveDaily([], "2026-09-30", "move-1")).rejects.toThrow(
    "Revision changed",
  );
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    status: 503,
    json: async () => {
      throw new SyntaxError("bad JSON");
    },
  });
  await expect(fetchDailyPreferences()).rejects.toThrow("Request failed (503)");
});

test("idempotency keys come from the browser UUID generator", () => {
  const original = crypto.randomUUID;
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    value: jest.fn().mockReturnValue("uuid-1"),
  });
  try {
    expect(newIdempotencyKey()).toBe("uuid-1");
  } finally {
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: original,
    });
  }
});
