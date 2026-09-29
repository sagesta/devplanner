import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { fetchSprints, fetchWeekSummary, patchTask } from "@/lib/api";
import { PlanHeader } from "./plan-header";
import { TimeWeekPanel } from "./TimeWeekPanel";
import { AddToSprintButton } from "./AddToSprintButton";
jest.mock("@/hooks/use-app-user-id", () => ({ useAppUserId: () => "owner" }));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("@/lib/api", () => ({
  fetchSprints: jest.fn(),
  fetchWeekSummary: jest.fn(),
  patchTask: jest.fn(),
}));
jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));
function setup(child: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      {child}
    </QueryClientProvider>,
  );
}
beforeEach(() => jest.clearAllMocks());
test.each([
  ["2026-10-02", 1, "ends Friday"],
  ["2026-10-20", 2, "ends Oct 20"],
])(
  "planning header exposes active view and sprint scope %s",
  async (endDate, count, ending) => {
    jest.mocked(fetchSprints).mockResolvedValue({
      sprints: [
        {
          id: "one",
          status: "active",
          name: "Week",
          startDate: "2026-09-28",
          endDate,
          goal: "Finish release",
          taskCount: count,
        },
      ],
    } as never);
    setup(<PlanHeader activeView="board" />);
    await screen.findByText("Finish release");
    expect(screen.getByText(new RegExp(ending))).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(`${count} task${count === 1 ? "" : "s"} in scope`),
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Board" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "This week" })).toHaveAttribute(
      "href",
      "/plan?view=sprints",
    );
  },
);
test("planning still has navigation without an active sprint", async () => {
  jest.mocked(fetchSprints).mockResolvedValue({ sprints: [] } as never);
  setup(<PlanHeader activeView="sprints" />);
  await waitFor(() => expect(fetchSprints).toHaveBeenCalled());
  expect(screen.getByRole("link", { name: "This week" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.queryByText(/Week of/)).not.toBeInTheDocument();
});
test("weekly time groups multiple logs, orders totals and caps progress at target", async () => {
  jest.mocked(fetchWeekSummary).mockResolvedValue([
    {
      areaId: "work",
      areaName: "Work",
      totalSeconds: 1800,
      weeklyHourTarget: "1",
    },
    {
      areaId: "work",
      areaName: "Work",
      totalSeconds: 5400,
      weeklyHourTarget: "1",
    },
    { areaId: null, areaName: null, totalSeconds: 900, weeklyHourTarget: null },
    {
      areaId: "home",
      areaName: "Home",
      totalSeconds: 2700,
      weeklyHourTarget: 1,
    },
  ] as never);
  const { container } = setup(<TimeWeekPanel weekStart="2026-09-28" />);
  await screen.findByText("Unassigned");
  expect(fetchWeekSummary).toHaveBeenCalledWith("2026-09-28");
  expect(container.querySelector('[style="width: 100%;"]')).toBeInTheDocument();
  expect(container.querySelector('[style="width: 75%;"]')).toBeInTheDocument();
  expect(screen.queryByText("No time logged")).not.toBeInTheDocument();
});
test("weekly time gives a timer hint when no logs exist", async () => {
  jest.mocked(fetchWeekSummary).mockResolvedValue([]);
  setup(<TimeWeekPanel weekStart="2026-09-28" />);
  await screen.findByText("No time logged");
});
test("adding to a chosen sprint retries a failed save and invalidates board data", async () => {
  jest.mocked(fetchSprints).mockResolvedValue({
    sprints: [
      { id: "one", name: "First", status: "active" },
      { id: "two", name: "Second", status: "active" },
      { id: "old", name: "Finished", status: "completed" },
    ],
  } as never);
  jest
    .mocked(patchTask)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({} as never);
  setup(<AddToSprintButton taskId="task" />);
  fireEvent.change(await screen.findByLabelText("Choose active sprint"), {
    target: { value: "two" },
  });
  expect(
    screen.queryByRole("option", { name: "Finished" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add to Sprint" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Offline"));
  fireEvent.click(screen.getByRole("button", { name: "Add to Sprint" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Added to sprint"),
  );
  expect(patchTask).toHaveBeenLastCalledWith("task", {
    sprintId: "two",
    status: "todo",
  });
});
test("add to sprint is disabled without an active sprint", async () => {
  jest.mocked(fetchSprints).mockResolvedValue({ sprints: [] } as never);
  setup(<AddToSprintButton taskId="task" />);
  await waitFor(() => expect(fetchSprints).toHaveBeenCalled());
  expect(screen.getByRole("button", { name: "Add to Sprint" })).toBeDisabled();
});
