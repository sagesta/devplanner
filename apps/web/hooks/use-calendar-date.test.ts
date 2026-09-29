import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { calendarDate } from "./use-calendar-date";
import { useCalendarDate } from "./use-calendar-date";
import { fetchDailyPreferences } from "@/lib/daily-api";

let mockUserId: string | undefined = "user-one";
jest.mock("@/hooks/use-app-user-id", () => ({
  useAppUserId: () => mockUserId,
}));
jest.mock("@/lib/daily-api", () => ({ fetchDailyPreferences: jest.fn() }));

function setup(
  timeZone?: string,
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  }),
) {
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client }, children);
  return {
    ...renderHook(() => useCalendarDate(timeZone), { wrapper }),
    client,
  };
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

beforeEach(() => {
  mockUserId = "user-one";
  (fetchDailyPreferences as jest.Mock).mockReset().mockResolvedValue({
    timezone: "Africa/Lagos",
  });
});

test("falls back to UTC when the browser reports no timezone and preferences are pending", () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-09-29T00:30:00Z"));
  (fetchDailyPreferences as jest.Mock).mockImplementation(
    () => new Promise(() => {}),
  );
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  jest
    .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
    .mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...original.call(this), timeZone: "" };
    });
  const { result, unmount } = setup();
  expect(result.current).toBe("2026-09-29");
  unmount();
});

test("replaces the provisional browser date after saved preferences load", async () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-09-29T00:30:00Z"));
  let resolvePreferences!: (value: { timezone: string }) => void;
  (fetchDailyPreferences as jest.Mock).mockReturnValue(
    new Promise((resolve) => {
      resolvePreferences = resolve;
    }),
  );
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  jest
    .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
    .mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...original.call(this), timeZone: "America/Los_Angeles" };
    });
  const { result, unmount } = setup();
  expect(result.current).toBe("2026-09-28");
  await act(async () => resolvePreferences({ timezone: "Africa/Lagos" }));
  await waitFor(() => expect(result.current).toBe("2026-09-29"));
  unmount();
});

test("does not request account preferences without an authenticated user", () => {
  mockUserId = undefined;
  const { unmount } = setup();
  expect(fetchDailyPreferences).not.toHaveBeenCalled();
  unmount();
});

test("uses the configured timezone on both sides of a day boundary", () => {
  const instant = new Date("2026-09-29T00:30:00Z");
  expect(calendarDate("Africa/Lagos", instant)).toBe("2026-09-29");
  expect(calendarDate("America/Los_Angeles", instant)).toBe("2026-09-28");
});

test("does not assume a 24-hour day at a daylight-saving transition", () => {
  expect(
    calendarDate("America/New_York", new Date("2026-03-08T04:59:00Z")),
  ).toBe("2026-03-07");
  expect(
    calendarDate("America/New_York", new Date("2026-03-08T05:01:00Z")),
  ).toBe("2026-03-08");
});

test("refreshes at the next midnight in the selected timezone", () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-09-28T22:59:59.900Z"));
  const { result, unmount } = setup("Africa/Lagos");
  expect(result.current).toBe("2026-09-28");
  act(() => jest.advanceTimersByTime(2_000));
  expect(result.current).toBe("2026-09-29");
  unmount();
});

test("schedules the next boundary across a 23-hour daylight-saving day", () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-03-08T05:00:00Z"));
  const { result, unmount } = setup("America/New_York");
  expect(result.current).toBe("2026-03-08");
  act(() => jest.advanceTimersByTime(23 * 60 * 60 * 1000 + 250));
  expect(result.current).toBe("2026-03-09");
  unmount();
});

test("refreshes after a sleeping tab returns by focus and visibility events", () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-09-28T22:30:00Z"));
  const { result, unmount } = setup("Africa/Lagos");
  expect(result.current).toBe("2026-09-28");
  act(() => {
    jest.setSystemTime(new Date("2026-09-29T00:30:00Z"));
    fireEvent.focus(window);
  });
  expect(result.current).toBe("2026-09-29");
  act(() => {
    jest.setSystemTime(new Date("2026-09-30T00:30:00Z"));
    fireEvent(document, new Event("visibilitychange"));
  });
  expect(result.current).toBe("2026-09-30");
  unmount();
});

test("ignores a hidden visibility event until the tab becomes visible", () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-09-28T22:30:00Z"));
  const visibilitySpy = jest.spyOn(document, "visibilityState", "get");
  visibilitySpy.mockReturnValue("hidden");
  const { result, unmount } = setup("Africa/Lagos");
  expect(result.current).toBe("2026-09-28");
  act(() => {
    jest.setSystemTime(new Date("2026-09-29T00:30:00Z"));
    fireEvent(document, new Event("visibilitychange"));
  });
  expect(result.current).toBe("2026-09-28");
  visibilitySpy.mockReturnValue("visible");
  act(() => fireEvent(document, new Event("visibilitychange")));
  expect(result.current).toBe("2026-09-29");
  unmount();
});

test("uses the browser timezone while server preferences are unresolved", () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-09-28T12:30:00Z"));
  (fetchDailyPreferences as jest.Mock).mockImplementation(
    () => new Promise(() => {}),
  );
  const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
  jest
    .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
    .mockImplementation(function (this: Intl.DateTimeFormat) {
      return {
        ...originalResolvedOptions.call(this),
        timeZone: "Pacific/Auckland",
      };
    });
  const { result, unmount } = setup();
  expect(result.current).toBe("2026-09-29");
  unmount();
});

test("recomputes immediately when configured timezone changes", async () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-09-29T00:30:00Z"));
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  client.setQueryData(["daily-preferences", "user-one"], {
    timezone: "Africa/Lagos",
  });
  const { result, unmount } = setup(undefined, client);
  expect(result.current).toBe("2026-09-29");
  await act(async () => {
    client.setQueryData(["daily-preferences", "user-one"], {
      timezone: "America/Los_Angeles",
    });
    jest.advanceTimersByTime(1);
  });
  expect(result.current).toBe("2026-09-28");
  unmount();
});

test("clears its midnight timer and event listeners on unmount", () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-09-28T22:00:00Z"));
  const scheduledSpy = jest.spyOn(globalThis, "setTimeout");
  const clearSpy = jest.spyOn(globalThis, "clearTimeout");
  const removeWindowSpy = jest.spyOn(window, "removeEventListener");
  const removeDocumentSpy = jest.spyOn(document, "removeEventListener");
  const { unmount } = setup("Africa/Lagos");
  const midnightTimer = scheduledSpy.mock.results.find((result, index) => {
    const delay = Number(scheduledSpy.mock.calls[index]?.[1]);
    return result.type === "return" && delay >= 3_600_000 && delay <= 3_601_000;
  })?.value;
  expect(midnightTimer).toBeDefined();
  unmount();
  expect(clearSpy).toHaveBeenCalledWith(midnightTimer);
  expect(removeWindowSpy).toHaveBeenCalledWith("focus", expect.any(Function));
  expect(removeDocumentSpy).toHaveBeenCalledWith(
    "visibilitychange",
    expect.any(Function),
  );
});
