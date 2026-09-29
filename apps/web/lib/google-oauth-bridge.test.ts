import { auth } from "@clerk/nextjs/server";
import { callCalendarApi, calendarResult } from "./google-oauth-bridge";

jest.mock("@clerk/nextjs/server", () => ({ auth: jest.fn() }));
jest.mock("./env", () => ({ getApiBase: () => "https://api.example.test" }));
jest.mock("next/server", () => ({
  NextResponse: {
    redirect: (url: URL, status: number) => {
      const values = new Map<string, string>([["location", url.toString()]]);
      return {
        status,
        headers: {
          set: (name: string, value: string) =>
            values.set(name.toLowerCase(), value),
          get: (name: string) => values.get(name.toLowerCase()) ?? null,
        },
      };
    },
  },
}));

const mockedAuth = auth as unknown as jest.Mock;
const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.API_INTERNAL_URL;
  global.fetch = jest.fn();
  if (!AbortSignal.timeout)
    Object.defineProperty(AbortSignal, "timeout", {
      configurable: true,
      value: () => new AbortController().signal,
    });
});

afterAll(() => {
  global.fetch = originalFetch;
});

test("the bridge never calls the API without an authenticated user and bearer token", async () => {
  mockedAuth.mockResolvedValueOnce({ userId: null, getToken: jest.fn() });
  expect(await callCalendarApi("/api/sync/google/start")).toBeNull();
  mockedAuth.mockResolvedValueOnce({
    userId: "alice",
    getToken: jest.fn().mockResolvedValue(null),
  });
  expect(await callCalendarApi("/api/sync/google/start")).toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
});

test("the bridge sends credentials only to the configured API and never follows redirects", async () => {
  const response = { ok: true } as Response;
  mockedAuth.mockResolvedValue({
    userId: "alice",
    getToken: jest.fn().mockResolvedValue("private-token"),
  });
  (global.fetch as jest.Mock).mockResolvedValue(response);
  process.env.API_INTERNAL_URL = "https://internal.example.test";
  expect(
    await callCalendarApi("/api/sync/google/complete", {
      state: "opaque",
      code: "code",
    }),
  ).toBe(response);
  expect(global.fetch).toHaveBeenCalledWith(
    "https://internal.example.test/api/sync/google/complete",
    expect.objectContaining({
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: expect.objectContaining({
        Authorization: "Bearer private-token",
      }),
      body: JSON.stringify({ state: "opaque", code: "code" }),
      signal: expect.any(AbortSignal),
    }),
  );
});

test("calendar result redirects to settings with a bounded outcome and no credential parameters", () => {
  const request = {
    url: "https://app.example.test/api/calendar/google/callback?state=secret-state&code=secret-code",
  } as Request;
  const response = calendarResult(request, "connected", true);
  const location = new URL(response.headers.get("location")!);
  expect(response.status).toBe(303);
  expect(location.pathname).toBe("/settings");
  expect(location.searchParams.get("tab")).toBe("calendar");
  expect(location.searchParams.get("google")).toBe("connected");
  expect(location.search).not.toContain("secret-state");
  expect(location.search).not.toContain("secret-code");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});
