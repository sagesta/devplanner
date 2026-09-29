import { callCalendarApi, calendarResult } from "@/lib/google-oauth-bridge";
import { GET as start } from "./start/route";
import { GET as callback } from "./callback/route";

jest.mock("@/lib/google-oauth-bridge", () => ({
  callCalendarApi: jest.fn(),
  calendarResult: jest.fn(),
}));
jest.mock("next/server", () => ({
  NextResponse: {
    redirect: (url: URL, status: number) => {
      const headers = new Map<string, string>();
      return {
        url: url.toString(),
        status,
        headers: {
          set: (name: string, value: string) => headers.set(name, value),
          get: (name: string) => headers.get(name),
        },
      };
    },
  },
}));

const mockApi = callCalendarApi as jest.MockedFunction<typeof callCalendarApi>;
const mockResult = calendarResult as jest.MockedFunction<typeof calendarResult>;
const request = (query = "") =>
  ({
    url: `https://app.example.test/api/calendar/google/callback${query}`,
  }) as Request;
const reply = (body: unknown, ok = true) =>
  ({ ok, json: async () => body }) as Response;

beforeEach(() => {
  jest.clearAllMocks();
  mockResult.mockImplementation((_request, outcome) => ({ outcome }) as never);
});

test("Google start redirects only to Google's account origin with private headers", async () => {
  mockApi.mockResolvedValue(
    reply({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=opaque" }),
  );
  const response = await start(request());
  expect(mockApi).toHaveBeenCalledWith("/api/sync/google/start?format=json");
  expect(response).toMatchObject({
    status: 303,
    url: "https://accounts.google.com/o/oauth2/v2/auth?state=opaque",
  });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
});

test("Google start rejects an attacker-controlled redirect and handles signed-out calls", async () => {
  mockApi
    .mockResolvedValueOnce(
      reply({ url: "https://accounts.google.com.attacker.test/phish" }),
    )
    .mockResolvedValueOnce(null);
  expect(await start(request())).toEqual({ outcome: "invalid_redirect" });
  expect(await start(request())).toEqual({ outcome: "sign_in_required" });
});

test("callback forwards OAuth values to API and marks a successful connection", async () => {
  mockApi.mockResolvedValue(reply({ ok: true }));
  const req = request("?state=opaque&code=private-code");
  expect(await callback(req)).toEqual({ outcome: "connected" });
  expect(mockApi).toHaveBeenCalledWith("/api/sync/google/complete", {
    state: "opaque",
    code: "private-code",
    error: null,
  });
  expect(mockResult).toHaveBeenCalledWith(req, "connected", true);
});

test("callback limits public errors to known outcomes", async () => {
  mockApi
    .mockResolvedValueOnce(reply({ error: "invalid_state" }, false))
    .mockResolvedValueOnce(
      reply({ error: "database_details_should_not_leak" }, false),
    );
  expect(await callback(request("?error=access_denied"))).toEqual({
    outcome: "invalid_state",
  });
  expect(await callback(request())).toEqual({ outcome: "connection_failed" });
});

test("callback handles absent authentication and malformed API responses", async () => {
  mockApi.mockResolvedValueOnce(null).mockResolvedValueOnce({
    ok: false,
    json: async () => {
      throw new SyntaxError("bad JSON");
    },
  } as unknown as Response);
  expect(await callback(request())).toEqual({ outcome: "sign_in_required" });
  expect(await callback(request())).toEqual({ outcome: "connection_failed" });
});
