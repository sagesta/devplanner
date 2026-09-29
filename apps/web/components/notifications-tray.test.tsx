import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { NotificationsTray } from "./notifications-tray";

let mockTasks: Array<Record<string, unknown>> = [];

jest.mock("@/hooks/use-app-user-id", () => ({
  useAppUserId: () => "user-one",
}));
jest.mock("@/hooks/use-calendar-date", () => ({
  useCalendarDate: () => "2026-09-29",
}));
jest.mock("@/lib/api", () => ({
  fetchDailyPreferences: () => Promise.resolve({ timezone: "Africa/Lagos" }),
  fetchGoogleCalendarStatus: () => Promise.resolve({ connected: false }),
  fetchTasks: () => Promise.resolve(mockTasks),
}));

beforeEach(() => {
  mockTasks = [
    {
      id: "task-1",
      title: "Write report",
      status: "todo",
      dueDate: null,
      scheduledDate: null,
      _subtasks: [
        {
          id: "step-1",
          title: "Draft outline",
          completed: false,
          scheduledDate: "2026-09-29",
          scheduledTime: "12:30:00",
        },
      ],
    },
  ];
});

afterEach(() => jest.useRealTimers());

test("uses the saved timezone when deciding whether a step starts soon", async () => {
  // At 10:00 UTC it is 11:00 in Lagos. 12:30 is soon only in the saved zone.
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(new Date("2026-09-29T10:00:00Z"));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <NotificationsTray open onClose={jest.fn()} />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText("Write report → Draft outline"),
  ).toBeInTheDocument();
  client.clear();
});

test("shows overdue unfinished work but excludes work due today or already done", async () => {
  mockTasks = [
    {
      id: "late",
      title: "Late task",
      status: "todo",
      dueDate: "2026-09-28",
      scheduledDate: null,
      _subtasks: [],
    },
    {
      id: "today",
      title: "Due today",
      status: "todo",
      dueDate: "2026-09-29",
      scheduledDate: null,
      _subtasks: [],
    },
    {
      id: "done",
      title: "Done task",
      status: "done",
      dueDate: "2026-09-27",
      scheduledDate: null,
      _subtasks: [],
    },
  ];
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <NotificationsTray open onClose={jest.fn()} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Late task")).toBeInTheDocument();
  expect(screen.queryByText("Due today")).not.toBeInTheDocument();
  expect(screen.queryByText("Done task")).not.toBeInTheDocument();
});
