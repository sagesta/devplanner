import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { postAutoSchedule, postScheduleApply } from "@/lib/api";
import NowPage from "./page";

let mockTodayTasks: Array<Record<string, unknown>> = [];
let mockInboxTasks: Array<Record<string, unknown>> = [];
let mockActiveLog: { id: number; taskId: string } | null = null;
let mockFocusSelection: {
  targetType: "task" | "subtask";
  targetId: string;
} | null = null;
const mockStopActiveTimer = jest.fn();
const mockPatchTask = jest.fn();
const mockPatchSubtask = jest.fn();
const mockMoveDaily = jest.fn();
const mockPutDailyFocus = jest.fn();
const mockRouterPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));
jest.mock("@/hooks/use-auth-status", () => ({
  useAuthStatus: () => ({ status: "authenticated" }),
}));
jest.mock("@/hooks/use-app-user-id", () => ({
  useAppUserId: () => "user-one",
}));
jest.mock("@/hooks/use-calendar-date", () => ({
  useCalendarDate: () => "2026-09-29",
}));
jest.mock("@/hooks/use-active-timer", () => ({
  useActiveTimer: () => ({
    activeLog: mockActiveLog,
    isRunning: Boolean(mockActiveLog),
    elapsed: 90,
    startTimer: jest.fn(),
    stopActiveTimer: mockStopActiveTimer,
    isStarting: false,
    isStopping: false,
  }),
}));
jest.mock("@/components/priority-anchors-card", () => ({
  PriorityAnchorsCard: () => null,
}));
jest.mock("@/components/getting-started-card", () => ({
  GettingStartedCard: () => null,
}));
jest.mock("@/components/GlobalTimerIndicator", () => ({
  GlobalTimerIndicator: () => null,
}));
jest.mock("@/components/TaskDetailPanel", () => ({
  TaskDetailPanel: ({ selectedSubtaskId }: { selectedSubtaskId?: string }) => (
    <div role="dialog">Task details {selectedSubtaskId}</div>
  ),
}));
jest.mock("canvas-confetti", () => jest.fn());
jest.mock("sonner", () => {
  const toast = Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
  });
  return { toast };
});
jest.mock("@/lib/api", () => ({
  fetchToday: (date: string) =>
    Promise.resolve({
      tasks: mockTodayTasks,
      date,
      doneTodayCount: 0,
      dailyCapacity: 0,
      usedMinutes: 0,
    }),
  fetchTasks: () => Promise.resolve(mockTodayTasks),
  fetchBacklog: () => Promise.resolve(mockInboxTasks),
  patchTask: (...args: unknown[]) => mockPatchTask(...args),
  patchSubtask: (...args: unknown[]) => mockPatchSubtask(...args),
  postAutoSchedule: jest.fn(),
  postScheduleApply: jest.fn(),
}));
jest.mock("@/lib/daily-api", () => ({
  fetchDailyPreferences: () => Promise.resolve({ timezone: "Africa/Lagos" }),
  fetchDailyFocus: () => Promise.resolve({ focus: mockFocusSelection }),
  putDailyFocus: (...args: unknown[]) => mockPutDailyFocus(...args),
  moveDaily: (...args: unknown[]) => mockMoveDaily(...args),
  newIdempotencyKey: () => "move-key",
}));

const task = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `task-${n}`,
  title: `Task ${n}`,
  areaId: "area-one",
  status: "todo",
  priority: "normal",
  physicalEnergy: "high",
  energyLevel: "shallow",
  scheduledDate: "2026-09-29",
  dueDate: null,
  revision: 1,
  createdAt: "2026-09-29T09:00:00Z",
  _subtasks: [],
  ...extra,
});

function renderNow() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NowPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockTodayTasks = [];
  mockInboxTasks = [];
  mockActiveLog = null;
  mockFocusSelection = null;
  mockStopActiveTimer.mockReset().mockResolvedValue({});
  mockPatchTask.mockReset().mockResolvedValue({ task: {} });
  mockPatchSubtask.mockReset().mockResolvedValue({ subtask: {} });
  mockMoveDaily.mockReset().mockResolvedValue({ updated: 1, targets: [] });
  mockPutDailyFocus.mockReset().mockResolvedValue({ focus: null });
  mockRouterPush.mockReset();
  (postAutoSchedule as jest.Mock).mockReset();
  (postScheduleApply as jest.Mock).mockReset();
  window.matchMedia = jest.fn().mockReturnValue({
    matches: true,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  });
});

test("exposes all unfinished tasks after the compact seven-item agenda", async () => {
  mockTodayTasks = Array.from({ length: 9 }, (_, index) => task(index + 1));
  renderNow();
  expect(
    await screen.findByRole("button", { name: "Show all 9 tasks" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Task 9" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show all 9 tasks" }));
  expect(screen.getByRole("button", { name: "Task 9" })).toBeInTheDocument();
});

test("an empty energy filter does not claim the day is cleared", async () => {
  localStorage.setItem("devplanner.currentPhysicalEnergy", "low");
  mockTodayTasks = [task(1)];
  renderNow();
  expect(
    await screen.findByRole("heading", { name: "No tasks match this filter." }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Day cleared." }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
  expect(
    await screen.findByRole("button", { name: "Open details for Task 1" }),
  ).toBeInTheDocument();
});

test("failed timer stop leaves the task unfinished", async () => {
  mockTodayTasks = [task(1)];
  mockActiveLog = { id: 7, taskId: "task-1" };
  mockStopActiveTimer.mockRejectedValue(new Error("Stop failed"));
  renderNow();
  fireEvent.click(await screen.findByRole("button", { name: "Done" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Stop timer and complete" }),
  );
  await waitFor(() => expect(mockStopActiveTimer).toHaveBeenCalledTimes(1));
  expect(mockPatchTask).not.toHaveBeenCalled();
  expect(
    screen.getByRole("dialog", { name: /Complete Task 1 while timing/ }),
  ).toBeInTheDocument();
});

test("completes one child while keeping its parent timer running", async () => {
  mockTodayTasks = [
    task(1, {
      _subtasks: [
        {
          id: "child-one",
          title: "Draft outline",
          completed: false,
          scheduledDate: "2026-09-29",
          scheduledTime: null,
          estimatedMinutes: 20,
          revision: 3,
        },
        {
          id: "child-two",
          title: "Write report",
          completed: false,
          scheduledDate: "2026-09-29",
          scheduledTime: null,
          estimatedMinutes: 30,
          revision: 4,
        },
      ],
    }),
  ];
  mockActiveLog = { id: 7, taskId: "task-1" };
  renderNow();
  fireEvent.click(await screen.findByRole("button", { name: "Done" }));
  fireEvent.click(
    screen.getByRole("button", {
      name: "Complete step, keep parent timer running",
    }),
  );
  await waitFor(() =>
    expect(mockPatchSubtask).toHaveBeenCalledWith("child-one", {
      completed: true,
    }),
  );
  expect(mockStopActiveTimer).not.toHaveBeenCalled();
  expect(mockPatchTask).not.toHaveBeenCalled();
});

test("Today picker schedules only the chosen child from Inbox", async () => {
  mockInboxTasks = [
    task(1, {
      status: "backlog",
      scheduledDate: null,
      _subtasks: [
        {
          id: "child-one",
          title: "Draft outline",
          completed: false,
          scheduledDate: null,
          revision: 3,
        },
        {
          id: "child-two",
          title: "Write report",
          completed: false,
          scheduledDate: null,
          revision: 4,
        },
      ],
    }),
  ];
  renderNow();
  fireEvent.click(
    await screen.findByRole("button", { name: "Pick from Inbox" }),
  );
  fireEvent.click(screen.getByText("Draft outline"));
  fireEvent.click(screen.getByRole("button", { name: "Add 1 to today" }));
  await waitFor(() =>
    expect(mockMoveDaily).toHaveBeenCalledWith(
      [{ targetType: "subtask", targetId: "child-one", expectedRevision: 3 }],
      "2026-09-29",
      "move-key",
    ),
  );
});

test("moves tomorrow using the configured calendar date and target revision", async () => {
  mockTodayTasks = [task(1, { revision: 8 })];
  renderNow();
  fireEvent.click(
    await screen.findByRole("button", { name: "Move to tomorrow" }),
  );
  await waitFor(() =>
    expect(mockMoveDaily).toHaveBeenCalledWith(
      [{ targetType: "task", targetId: "task-1", expectedRevision: 8 }],
      "2026-09-30",
      "move-key",
    ),
  );
});

test("keeps the date dialog open and the item on Today after a failed move", async () => {
  mockTodayTasks = [task(1)];
  mockMoveDaily.mockRejectedValue(new Error("Conflict"));
  renderNow();
  fireEvent.click(await screen.findByRole("button", { name: "Choose date" }));
  fireEvent.change(screen.getByLabelText("Planned date"), {
    target: { value: "2026-10-01" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Move" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Conflict"),
    ),
  );
  expect(
    screen.getByRole("dialog", { name: "Choose planned date for Task 1" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Open details for Task 1" }),
  ).toBeInTheDocument();
});

test("persists Do next for an agenda row and confirms it was saved", async () => {
  mockTodayTasks = [task(1), task(2)];
  renderNow();
  fireEvent.click(await screen.findByRole("button", { name: "Do next" }));
  await waitFor(() =>
    expect(mockPutDailyFocus).toHaveBeenCalledWith({
      date: "2026-09-29",
      targetType: "task",
      targetId: "task-2",
    }),
  );
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Up next saved"),
  );
});

test("reports a failed Do next selection while leaving the agenda visible", async () => {
  mockTodayTasks = [task(1), task(2)];
  mockPutDailyFocus.mockRejectedValue(new Error("Focus unavailable"));
  renderNow();
  fireEvent.click(await screen.findByRole("button", { name: "Do next" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Focus unavailable"),
  );
  expect(screen.getByRole("button", { name: "Task 2" })).toBeInTheDocument();
});

test("rescues three overdue tasks using each current revision", async () => {
  mockTodayTasks = [1, 2, 3].map((n) =>
    task(n, { scheduledDate: "2026-09-28", revision: n + 4 }),
  );
  renderNow();
  fireEvent.click(
    await screen.findByRole("button", { name: "Reschedule all" }),
  );
  await waitFor(() =>
    expect(mockMoveDaily).toHaveBeenCalledWith(
      [1, 2, 3].map((n) => ({
        targetType: "task",
        targetId: `task-${n}`,
        expectedRevision: n + 4,
      })),
      "2026-09-29",
      "move-key",
    ),
  );
});

test("retains the Inbox picker selection after a failed Add to today", async () => {
  mockInboxTasks = [task(1, { status: "backlog", scheduledDate: null })];
  mockMoveDaily.mockRejectedValue(new Error("Move unavailable"));
  renderNow();
  fireEvent.click(
    await screen.findByRole("button", { name: "Pick from Inbox" }),
  );
  fireEvent.click(screen.getByText("Task 1"));
  fireEvent.click(screen.getByRole("button", { name: "Add 1 to today" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Move unavailable"),
    ),
  );
  expect(
    screen.getByRole("button", { name: "Add 1 to today" }),
  ).toBeInTheDocument();
});

test("reports failed completion and leaves the task unfinished", async () => {
  mockTodayTasks = [task(1)];
  mockPatchTask.mockRejectedValue(new Error("Could not complete"));
  renderNow();
  fireEvent.click(await screen.findByRole("button", { name: "Done" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Could not complete"),
  );
  expect(
    screen.getByRole("button", { name: "Open details for Task 1" }),
  ).toBeInTheDocument();
});

test("previews rollover changes and applies only approved proposals", async () => {
  (postAutoSchedule as jest.Mock).mockResolvedValue({
    previewId: "preview-1",
    proposals: [
      {
        id: "one",
        title: "Write report",
        fromDate: "2026-09-28",
        toDate: "2026-09-30",
        estimatedMinutes: 20,
        reason: "unfinished",
      },
      {
        id: "two",
        title: "Plan backups",
        fromDate: "2026-09-28",
        toDate: "2026-09-30",
        estimatedMinutes: 30,
        reason: "unfinished",
      },
    ],
  });
  (postScheduleApply as jest.Mock).mockResolvedValue({ applied: 1 });
  renderNow();
  fireEvent.click(
    await screen.findByRole("button", { name: "Move unfinished work" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Review schedule changes" }),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByText("Plan backups").closest("label")!.querySelector("input")!,
  );
  fireEvent.click(screen.getByRole("button", { name: "Apply 1" }));
  await waitFor(() =>
    expect(postScheduleApply).toHaveBeenCalledWith(
      "preview-1",
      ["one"],
      "move-key",
    ),
  );
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Applied 1 schedule change(s)."),
  );
  expect(
    screen.queryByRole("heading", { name: "Review schedule changes" }),
  ).not.toBeInTheDocument();
});

test("retains rollover proposals when apply fails", async () => {
  (postAutoSchedule as jest.Mock).mockResolvedValue({
    previewId: "preview-1",
    proposals: [
      {
        id: "one",
        title: "Write report",
        fromDate: "2026-09-28",
        toDate: "2026-09-30",
        estimatedMinutes: 20,
        reason: "unfinished",
      },
    ],
  });
  (postScheduleApply as jest.Mock).mockRejectedValue(
    new Error("Preview expired"),
  );
  renderNow();
  fireEvent.click(
    await screen.findByRole("button", { name: "Move unfinished work" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Apply 1" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Could not apply schedule: Preview expired",
    ),
  );
  expect(
    screen.getByRole("heading", { name: "Review schedule changes" }),
  ).toBeInTheDocument();
});

test("uses a previously saved Do next choice as the hero task", async () => {
  mockTodayTasks = [task(1), task(2)];
  mockFocusSelection = { targetType: "task", targetId: "task-2" };
  renderNow();
  expect(
    await screen.findByRole("heading", { name: "Task 2" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Task 1" })).toBeInTheDocument();
});

test("shows finished work on request without treating it as unfinished", async () => {
  mockTodayTasks = [task(1, { status: "done" })];
  renderNow();
  expect(
    await screen.findByRole("heading", { name: "Day cleared." }),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "1 finished earlier — show" }),
  );
  expect(screen.getByText("Task 1")).toHaveClass("line-through");
});

test("filters the agenda by chosen energy and persists that choice", async () => {
  mockTodayTasks = [
    task(1, { physicalEnergy: "low" }),
    task(2, { physicalEnergy: "high" }),
  ];
  renderNow();
  await screen.findByRole("button", { name: "Open details for Task 1" });
  fireEvent.change(screen.getByLabelText("Filter agenda by energy"), {
    target: { value: "high" },
  });
  expect(localStorage.getItem("devplanner.currentPhysicalEnergy")).toBe("high");
  expect(
    await screen.findByRole("button", { name: "Open details for Task 2" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Open details for Task 1" }),
  ).not.toBeInTheDocument();
});

test("Escape closes the planned-date dialog and restores focus", async () => {
  mockTodayTasks = [task(1)];
  renderNow();
  const openDate = await screen.findByRole("button", { name: "Choose date" });
  openDate.focus();
  fireEvent.click(openDate);
  const date = screen.getByLabelText("Planned date");
  expect(date).toHaveFocus();
  fireEvent.keyDown(date, { key: "Escape" });
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: /Choose planned date/ }),
    ).not.toBeInTheDocument(),
  );
  expect(openDate).toHaveFocus();
});

test("dismisses an overdue rescue suggestion without moving work", async () => {
  mockTodayTasks = [1, 2, 3].map((n) =>
    task(n, { scheduledDate: "2026-09-28" }),
  );
  renderNow();
  fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
  expect(
    screen.queryByRole("button", { name: "Reschedule all" }),
  ).not.toBeInTheDocument();
  expect(mockMoveDaily).not.toHaveBeenCalled();
});

test("reports that rollover needs no changes when preview is empty", async () => {
  (postAutoSchedule as jest.Mock).mockResolvedValue({
    previewId: "empty-preview",
    proposals: [],
  });
  renderNow();
  fireEvent.click(
    await screen.findByRole("button", { name: "Move unfinished work" }),
  );
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      "No unfinished work needs moving.",
    ),
  );
  expect(
    screen.queryByRole("heading", { name: "Review schedule changes" }),
  ).not.toBeInTheDocument();
});

test("opens details from the agenda without changing completion", async () => {
  mockTodayTasks = [task(1)];
  renderNow();
  fireEvent.click(
    await screen.findByRole("button", { name: "Open details for Task 1" }),
  );
  expect(screen.getByRole("dialog")).toHaveTextContent("Task details");
  expect(mockPatchTask).not.toHaveBeenCalled();
});

test("stops an active task timer before completing the task", async () => {
  mockTodayTasks = [task(1)];
  mockActiveLog = { id: 7, taskId: "task-1" };
  renderNow();
  fireEvent.click(await screen.findByRole("button", { name: "Done" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Stop timer and complete" }),
  );
  await waitFor(() =>
    expect(mockPatchTask).toHaveBeenCalledWith("task-1", { status: "done" }),
  );
  expect(mockStopActiveTimer).toHaveBeenCalledTimes(1);
  expect(mockStopActiveTimer.mock.invocationCallOrder[0]).toBeLessThan(
    mockPatchTask.mock.invocationCallOrder[0],
  );
});

test("searches Inbox candidates before choosing work for Today", async () => {
  mockInboxTasks = [task(2, { title: "Renew domain", scheduledDate: null })];
  renderNow();
  fireEvent.click(
    await screen.findByRole("button", { name: "Pick from Inbox" }),
  );
  const search = screen.getByLabelText("Find an Inbox item");
  fireEvent.change(search, { target: { value: "unrelated" } });
  expect(screen.getByText("No matching Inbox items.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add 0 to today" })).toBeDisabled();
  fireEvent.change(search, { target: { value: "domain" } });
  expect(screen.getByText("Renew domain")).toBeInTheDocument();
});

test("offers to log a high-priority recurring task after completion", async () => {
  mockTodayTasks = [task(1, { priority: "high" })];
  mockPatchTask.mockResolvedValue({
    spawnedNext: task(2, { scheduledDate: "2026-09-30" }),
  });
  renderNow();
  fireEvent.click(await screen.findByRole("button", { name: "Done" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      "Recurring task — next one scheduled for 2026-09-30.",
    ),
  );
  const winCall = (toast as unknown as jest.Mock).mock.calls.find(
    ([message]) => message === "Nice work — log this win?",
  );
  expect(winCall).toBeDefined();
  winCall?.[1].action.onClick();
  expect(mockRouterPush).toHaveBeenCalledWith(
    "/review?view=accomplishments&title=Task%201&taskId=task-1",
  );
});
