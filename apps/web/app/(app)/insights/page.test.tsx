import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import {
  fetchCalendarProgress,
  fetchInsightsActivity,
  postScheduleApply,
  postSchedulePreview,
  type CalendarProgressDay,
  type ScheduleProposal,
} from "@/lib/api";
import InsightsPage from "./page";

let mockToday = "2026-09-29";
jest.mock("@/hooks/use-auth-status", () => ({
  useAuthStatus: () => ({ status: "authenticated" }),
}));
jest.mock("@/hooks/use-calendar-date", () => ({
  useCalendarDate: () => mockToday,
}));
jest.mock("@/components/priority-anchors-card", () => ({
  PriorityAnchorsCard: () => null,
}));
jest.mock("@/lib/api", () => ({
  fetchCalendarProgress: jest.fn(),
  fetchInsightsActivity: jest.fn(),
  postScheduleApply: jest.fn(),
  postSchedulePreview: jest.fn(),
}));
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const proposal = (id: string, targetId: string): ScheduleProposal => ({
  id,
  targetType: "task",
  targetId,
  title: `Move ${targetId}`,
  fromDate: "2026-09-28",
  toDate: "2026-09-30",
  estimatedMinutes: 30,
  priority: "normal",
  workDepth: null,
  physicalEnergy: null,
  reason: "Unfinished",
  risk: "low",
});

test("calendar days show configured Today, missed work, and selected-day progress", async () => {
  const day = (
    date: string,
    status: CalendarProgressDay["status"],
    plannedUnits: number,
    completedUnits: number,
    overdueUnits: number,
  ): CalendarProgressDay => ({
    date,
    status,
    plannedUnits,
    completedUnits,
    overdueUnits,
    plannedMinutes: plannedUnits * 30,
    completedMinutes: completedUnits * 30,
    percent: plannedUnits
      ? Math.round((completedUnits / plannedUnits) * 100)
      : 0,
  });
  jest.mocked(fetchCalendarProgress).mockImplementation(async (start, end) => ({
    start,
    end,
    dailyCapacity: 45,
    days:
      start === "2026-09-01"
        ? [
            day("2026-09-27", "empty", 0, 0, 0),
            day("2026-09-28", "missed", 2, 0, 2),
            day("2026-09-29", "complete", 1, 1, 0),
            day("2026-09-30", "overload", 3, 1, 1),
          ]
        : [],
  }));
  mount();
  expect(await screen.findByText("45 min")).toBeInTheDocument();
  expect(screen.getByText("Today")).toBeInTheDocument();
  fireEvent.click(screen.getByTitle(/0\/2 complete/));
  expect(
    screen.getByText(
      "2 unfinished unit(s) from this day can be rolled forward.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByText("0%", { selector: "span" })).toBeInTheDocument();
  fireEvent.click(screen.getByTitle(/0\/0 complete/));
  expect(screen.getByText("No tasks")).toBeInTheDocument();
});

test("an empty preview confirms there are no moves and keeps Apply disabled", async () => {
  jest
    .mocked(postSchedulePreview)
    .mockResolvedValue(preview("empty-preview", []));
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: /Preview rollover/ }),
  );
  expect(
    await screen.findByText("No rollover suggestions right now."),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Apply 0" })).toBeDisabled();
  expect(toast.success).toHaveBeenCalledWith("Nothing needs to roll forward.");
  expect(postScheduleApply).not.toHaveBeenCalled();
});

test("preview request failure reports the problem without claiming any move was applied", async () => {
  jest
    .mocked(postSchedulePreview)
    .mockRejectedValue(new Error("Preview service unavailable"));
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: /Preview rollover/ }),
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Preview service unavailable"),
  );
  expect(screen.queryByText("Schedule proposals")).not.toBeInTheDocument();
  expect(postScheduleApply).not.toHaveBeenCalled();
});
const preview = (id: string, proposals: ScheduleProposal[]) => ({
  previewId: id,
  expiresAt: "2026-09-30T12:00:00Z",
  proposals,
  learning: {
    dailyCapacity: 480,
    peakHour: null,
    deepWorkHours: [],
    observedCompletionCount: 0,
  },
});

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <InsightsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockToday = "2026-09-29";
  jest.mocked(fetchInsightsActivity).mockResolvedValue({
    activityHeatmap: [],
    peakHourLabel: "09:00",
    recommendedDeepWork: [],
  });
  jest.mocked(fetchCalendarProgress).mockImplementation(async (start, end) => ({
    start,
    end,
    dailyCapacity: 480,
    days: [],
  }));
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    value: jest.fn().mockReturnValue("stable-key"),
  });
});

test("planning queries use the configured calendar date and update after a date rollover", async () => {
  const view = mount();
  expect(
    await screen.findByRole("button", { name: /Preview rollover/ }),
  ).toBeInTheDocument();
  expect(fetchCalendarProgress).toHaveBeenCalledWith(
    "2026-09-28",
    "2026-10-04",
  );
  expect(fetchCalendarProgress).toHaveBeenCalledWith(
    "2026-09-01",
    "2026-09-30",
  );
  mockToday = "2026-10-01";
  view.rerender(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <InsightsPage />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(fetchCalendarProgress).toHaveBeenCalledWith(
      "2026-10-01",
      "2026-10-31",
    ),
  );
});

test("failed apply retries keep the same idempotency key and selected proposal", async () => {
  jest
    .mocked(postSchedulePreview)
    .mockResolvedValue(
      preview("preview-1", [proposal("p1", "t1"), proposal("p2", "t2")]),
    );
  jest
    .mocked(postScheduleApply)
    .mockRejectedValueOnce(new Error("Network offline"))
    .mockResolvedValueOnce({ applied: 1, skipped: 0 });
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: /Preview rollover/ }),
  );
  fireEvent.click(await screen.findByRole("checkbox", { name: /Move t2/ }));
  fireEvent.click(screen.getByRole("button", { name: "Apply 1" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Network offline"),
  );
  expect(screen.getByRole("checkbox", { name: /Move t1/ })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Apply 1" }));
  await waitFor(() => expect(postScheduleApply).toHaveBeenCalledTimes(2));
  expect(postScheduleApply).toHaveBeenNthCalledWith(
    1,
    "preview-1",
    ["p1"],
    "stable-key",
  );
  expect(postScheduleApply).toHaveBeenNthCalledWith(
    2,
    "preview-1",
    ["p1"],
    "stable-key",
  );
});

test("expired preview requires manual refresh, recovers available choices, and reports missing moves", async () => {
  jest
    .mocked(postSchedulePreview)
    .mockResolvedValueOnce(
      preview("old-preview", [
        proposal("old-a", "t1"),
        proposal("old-b", "t2"),
      ]),
    )
    .mockResolvedValueOnce(
      preview("new-preview", [
        proposal("new-a", "t1"),
        proposal("new-c", "t3"),
      ]),
    );
  jest
    .mocked(postScheduleApply)
    .mockRejectedValueOnce(
      Object.assign(new Error("Preview expired"), { status: 409 }),
    )
    .mockResolvedValueOnce({ applied: 1, skipped: 0 });
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: /Preview rollover/ }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Apply 2" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("preview expired");
  expect(screen.getByRole("button", { name: "Apply 2" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: /Move t1/ })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: /Preview rollover/ }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "1 previously selected move(s) are no longer available",
  );
  expect(screen.getByRole("checkbox", { name: /Move t1/ })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: /Move t3/ })).not.toBeChecked();
  expect(postScheduleApply).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Apply 1" }));
  await waitFor(() =>
    expect(postScheduleApply).toHaveBeenLastCalledWith(
      "new-preview",
      ["new-a"],
      "stable-key",
    ),
  );
});

test("deselecting every move prevents apply until the user chooses one again", async () => {
  jest
    .mocked(postSchedulePreview)
    .mockResolvedValue(
      preview("choice-preview", [{ ...proposal("p1", "t1"), risk: "high" }]),
    );
  jest.mocked(postScheduleApply).mockResolvedValue({ applied: 1, skipped: 0 });
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: /Preview rollover/ }),
  );
  const move = await screen.findByRole("checkbox", { name: /Move t1/ });
  fireEvent.click(move);
  expect(screen.getByRole("button", { name: "Apply 0" })).toBeDisabled();
  expect(postScheduleApply).not.toHaveBeenCalled();
  fireEvent.click(move);
  fireEvent.click(screen.getByRole("button", { name: "Apply 1" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Applied 1 schedule change(s)."),
  );
  expect(screen.queryByText("Schedule proposals")).not.toBeInTheDocument();
});

test("failed refresh after expiry leaves the preview blocked and allows another refresh", async () => {
  jest
    .mocked(postSchedulePreview)
    .mockResolvedValueOnce(preview("expired", [proposal("old", "t1")]))
    .mockRejectedValueOnce(new Error("Preview unavailable"))
    .mockResolvedValueOnce(preview("fresh", [proposal("new", "t1")]));
  jest
    .mocked(postScheduleApply)
    .mockRejectedValueOnce(
      Object.assign(new Error("Preview expired"), { status: 409 }),
    );
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: /Preview rollover/ }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Apply 1" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("preview expired");
  fireEvent.click(screen.getByRole("button", { name: /Preview rollover/ }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Preview unavailable"),
  );
  expect(
    screen.queryByRole("button", { name: "Apply 1" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Preview rollover/ }));
  expect(
    await screen.findByRole("checkbox", { name: /Move t1/ }),
  ).toBeChecked();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Apply 1" })).toBeEnabled(),
  );
  expect(postScheduleApply).toHaveBeenCalledTimes(1);
});
