import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { toast } from "sonner";
import BacklogPage from "./page";
import {
  createSubtask,
  deleteSubtask,
  fetchAreas,
  fetchBacklog,
  fetchSprints,
  patchSubtask,
  patchTask,
  patchTasksBulkSprint,
} from "@/lib/api";
import { moveDaily } from "@/lib/daily-api";

let authStatus = "authenticated";
let appUserId: string | null = "user-one";
jest.mock("@/hooks/use-auth-status", () => ({
  useAuthStatus: () => ({ status: authStatus }),
}));
jest.mock("@/hooks/use-app-user-id", () => ({
  useAppUserId: () => appUserId,
}));
jest.mock("@/hooks/use-calendar-date", () => ({
  useCalendarDate: () => "2026-09-29",
}));
jest.mock("@/components/TimerButton", () => ({ TimerButton: () => null }));
jest.mock("@/components/TaskDetailPanel", () => ({
  TaskDetailPanel: ({
    taskId,
    onClose,
  }: {
    taskId: string;
    onClose: () => void;
  }) => (
    <div role="dialog">
      Editing {taskId}
      <button onClick={onClose}>Close details</button>
    </div>
  ),
}));
jest.mock("@/lib/daily-api", () => ({
  fetchDailyPreferences: () => Promise.resolve({ timezone: "Africa/Lagos" }),
  moveDaily: jest.fn(),
  newIdempotencyKey: () => "move-key",
}));
jest.mock("@/lib/api", () => ({
  fetchAreas: jest.fn(),
  fetchSprints: jest.fn(),
  fetchBacklog: jest.fn(),
  patchTask: jest.fn(),
  patchTasksBulkSprint: jest.fn(),
  createSubtask: jest.fn(),
  patchSubtask: jest.fn(),
  deleteSubtask: jest.fn(),
}));
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const tasks = [
  {
    id: "parent-one",
    areaId: "area-work",
    title: "Write report",
    status: "backlog",
    priority: "normal",
    revision: 2,
    createdAt: "2026-09-29T09:00:00Z",
    dueDate: null,
    sprintId: null,
    _subtasks: [
      {
        id: "child-one",
        taskId: "parent-one",
        title: "Draft outline",
        completed: false,
        scheduledDate: null,
        revision: 4,
      },
    ],
  },
  {
    id: "simple",
    areaId: "area-work",
    title: "Send invoice",
    status: "backlog",
    priority: "high",
    revision: 3,
    createdAt: "2026-09-28T09:00:00Z",
    dueDate: "2026-09-28",
    sprintId: null,
    _subtasks: [],
  },
  {
    id: "growth",
    areaId: "area-growth",
    title: "Read paper",
    status: "backlog",
    priority: "low",
    revision: 5,
    createdAt: "2026-09-29T10:00:00Z",
    dueDate: null,
    sprintId: null,
    _subtasks: [],
  },
];

async function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <BacklogPage />
    </QueryClientProvider>,
  );
  await screen.findByText("Write report");
  return { client, ...view };
}

beforeEach(() => {
  jest.clearAllMocks();
  authStatus = "authenticated";
  appUserId = "user-one";
  jest.mocked(fetchBacklog).mockResolvedValue(tasks as never);
  jest.mocked(fetchAreas).mockResolvedValue([
    { id: "area-work", name: "Work", color: null },
    { id: "area-growth", name: "Growth", color: null },
  ] as never);
  jest.mocked(fetchSprints).mockResolvedValue({
    sprints: [
      { id: "sprint-active", name: "This week", status: "active" },
      { id: "sprint-done", name: "Old sprint", status: "completed" },
    ],
  } as never);
  jest
    .mocked(moveDaily)
    .mockResolvedValue({ updated: 1, targets: [] } as never);
  jest.mocked(patchTask).mockResolvedValue({} as never);
  jest.mocked(patchTasksBulkSprint).mockResolvedValue({ updated: 2 } as never);
  jest.mocked(createSubtask).mockResolvedValue({} as never);
  jest.mocked(patchSubtask).mockResolvedValue({} as never);
  jest.mocked(deleteSubtask).mockResolvedValue({} as never);
});

test("chooses an unfinished child execution item instead of scheduling its parent", async () => {
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Choose steps" }));
  const addButtons = screen.getAllByRole("button", { name: "Add to today" });
  fireEvent.click(addButtons[0]);
  await waitFor(() =>
    expect(moveDaily).toHaveBeenCalledWith(
      [{ targetType: "subtask", targetId: "child-one", expectedRevision: 4 }],
      "2026-09-29",
      "move-key",
    ),
  );
});

test("filters by area and opens a task's detail panel without changing its data", async () => {
  await mount();
  expect(screen.getByText("3 things await triage.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Professional" }));
  expect(screen.getByText("Read paper")).toBeInTheDocument();
  expect(screen.queryByText("Write report")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "All areas" }));
  const row = screen.getByText("Send invoice").closest("li")!;
  expect(row).toHaveTextContent("Overdue");
  fireEvent.click(within(row).getByRole("button", { name: "Details" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Editing simple");
  fireEvent.click(screen.getByRole("button", { name: "Close details" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("direct move failure keeps the task available and retry reuses the receipt key", async () => {
  jest
    .mocked(moveDaily)
    .mockRejectedValueOnce(new Error("Conflict"))
    .mockResolvedValueOnce({ updated: 1, targets: [] } as never);
  await mount();
  const row = screen.getByText("Send invoice").closest("li")!;
  fireEvent.click(within(row).getByRole("button", { name: "Add to today" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Conflict. Refresh and retry if a task changed elsewhere.",
    ),
  );
  expect(screen.getByText("Send invoice")).toBeInTheDocument();
  fireEvent.click(within(row).getByRole("button", { name: "Add to today" }));
  await waitFor(() => expect(moveDaily).toHaveBeenCalledTimes(2));
  expect(jest.mocked(moveDaily).mock.calls).toEqual([
    [
      [{ targetType: "task", targetId: "simple", expectedRevision: 3 }],
      "2026-09-29",
      "move-key",
    ],
    [
      [{ targetType: "task", targetId: "simple", expectedRevision: 3 }],
      "2026-09-29",
      "move-key",
    ],
  ]);
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Added to Today"),
  );
  expect(patchTask).not.toHaveBeenCalled();
});

test("bulk selection blocks moving parents with unfinished steps but allows sprint assignment and retry", async () => {
  jest
    .mocked(patchTasksBulkSprint)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({ updated: 2 } as never);
  await mount();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all in Work" }));
  expect(screen.getByText("2 selected")).toBeInTheDocument();
  expect(
    screen.getAllByRole("button", { name: "Add to today" })[0],
  ).toBeDisabled();
  expect(
    screen.getByText(/Selected parents contain unfinished steps/),
  ).toBeInTheDocument();
  const picker = screen.getByLabelText("Add selected tasks to sprint");
  expect(
    within(picker).queryByRole("option", { name: "Old sprint" }),
  ).not.toBeInTheDocument();
  fireEvent.change(picker, { target: { value: "sprint-active" } });
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Offline"));
  expect(screen.getByText("2 selected")).toBeInTheDocument();
  fireEvent.change(picker, { target: { value: "sprint-active" } });
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Added 2 tasks to This week"),
  );
  expect(patchTasksBulkSprint).toHaveBeenNthCalledWith(
    1,
    ["parent-one", "simple"],
    "sprint-active",
  );
  expect(patchTasksBulkSprint).toHaveBeenNthCalledWith(
    2,
    ["parent-one", "simple"],
    "sprint-active",
  );
  expect(screen.queryByText("2 selected")).not.toBeInTheDocument();
});

test("bulk date move sends selected revisions and clears selection only after success", async () => {
  jest
    .mocked(moveDaily)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({ updated: 2 } as never);
  await mount();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Select Send invoice" }),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Read paper" }));
  const date = screen.getByLabelText("Choose date");
  fireEvent.change(date, { target: { value: "2026-10-02" } });
  fireEvent.click(screen.getByRole("button", { name: "Move selected" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(screen.getByText("2 selected")).toBeInTheDocument();
  expect(date).toHaveValue("2026-10-02");
  fireEvent.click(screen.getByRole("button", { name: "Move selected" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Planned date saved"),
  );
  expect(moveDaily).toHaveBeenNthCalledWith(
    2,
    [
      { targetType: "task", targetId: "simple", expectedRevision: 3 },
      { targetType: "task", targetId: "growth", expectedRevision: 5 },
    ],
    "2026-10-02",
    "move-key",
  );
  expect(screen.queryByText("2 selected")).not.toBeInTheDocument();
  expect(date).not.toBeInTheDocument();
});

test("area filtering and group selection can be reversed without changing tasks", async () => {
  await mount();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all in Work" }));
  expect(screen.getByText("2 selected")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all in Work" }));
  expect(screen.queryByText("2 selected")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Professional" }));
  expect(screen.queryByText("Send invoice")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Read paper" }));
  expect(screen.getByText("1 selected")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
  expect(patchTask).not.toHaveBeenCalled();
  expect(moveDaily).not.toHaveBeenCalled();
});

test("editing metadata and subtasks calls precise mutations", async () => {
  await mount();
  fireEvent.click(
    screen.getByRole("button", { name: "Show details for Write report" }),
  );
  fireEvent.change(screen.getByLabelText("Category / area"), {
    target: { value: "area-growth" },
  });
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith("parent-one", {
      areaId: "area-growth",
    }),
  );
  fireEvent.change(screen.getByLabelText("Priority"), {
    target: { value: "urgent" },
  });
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith("parent-one", {
      priority: "urgent",
    }),
  );
  fireEvent.change(screen.getByPlaceholderText("+ Add subtask..."), {
    target: { value: "  Ask reviewer  " },
  });
  fireEvent.keyDown(screen.getByPlaceholderText("+ Add subtask..."), {
    key: "Enter",
  });
  await waitFor(() =>
    expect(createSubtask).toHaveBeenCalledWith({
      taskId: "parent-one",
      title: "Ask reviewer",
    }),
  );
  fireEvent.change(screen.getByDisplayValue("Draft outline"), {
    target: { value: "Draft structure" },
  });
  fireEvent.blur(screen.getByDisplayValue("Draft structure"));
  await waitFor(() =>
    expect(patchSubtask).toHaveBeenCalledWith("child-one", {
      title: "Draft structure",
    }),
  );
  fireEvent.click(screen.getByTitle("Delete subtask"));
  await waitFor(() => expect(deleteSubtask).toHaveBeenCalledWith("child-one"));
});

test("individual sprint assignment activates a backlog task and reports failed edits", async () => {
  jest
    .mocked(patchTask)
    .mockRejectedValueOnce(new Error("Sprint unavailable"))
    .mockResolvedValueOnce({} as never);
  await mount();
  const row = screen.getByText("Send invoice").closest("li")!;
  const picker = within(row).getByLabelText("Add to sprint");
  fireEvent.change(picker, { target: { value: "sprint-active" } });
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Sprint unavailable"),
  );
  expect(screen.getByText("Send invoice")).toBeInTheDocument();
  fireEvent.change(picker, { target: { value: "sprint-active" } });
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Added to This week"),
  );
  expect(patchTask).toHaveBeenNthCalledWith(1, "simple", {
    sprintId: "sprint-active",
    status: "todo",
  });
  expect(patchTask).toHaveBeenNthCalledWith(2, "simple", {
    sprintId: "sprint-active",
    status: "todo",
  });
});

test("sprint assignment preserves an already active status and can be removed", async () => {
  jest
    .mocked(fetchBacklog)
    .mockResolvedValue([
      { ...tasks[1], status: "in_progress", sprintId: "sprint-active" },
    ] as never);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <BacklogPage />
    </QueryClientProvider>,
  );
  const row = (await screen.findByText("Send invoice")).closest("li")!;
  const picker = within(row).getByLabelText("Add to sprint");
  fireEvent.change(picker, { target: { value: "" } });
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith("simple", { sprintId: null }),
  );
  fireEvent.change(picker, { target: { value: "sprint-active" } });
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith("simple", {
      sprintId: "sprint-active",
      status: "in_progress",
    }),
  );
});

test("due date saves on blur and subtask completion changes only the selected step", async () => {
  await mount();
  fireEvent.click(
    screen.getByRole("button", { name: "Show details for Write report" }),
  );
  const due = screen.getByLabelText("Due date");
  fireEvent.change(due, { target: { value: "2026-10-05" } });
  expect(patchTask).not.toHaveBeenCalled();
  fireEvent.blur(due);
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith("parent-one", {
      dueDate: "2026-10-05",
    }),
  );
  const step = screen.getByDisplayValue("Draft outline").closest("li")!;
  fireEvent.click(within(step).getAllByRole("button")[0]);
  await waitFor(() =>
    expect(patchSubtask).toHaveBeenCalledWith("child-one", { completed: true }),
  );
  expect(moveDaily).not.toHaveBeenCalled();
});

test("custom recurrence stays intact until explicitly replaced, and metadata edits stay scoped", async () => {
  jest
    .mocked(fetchBacklog)
    .mockResolvedValue([
      { ...tasks[2], recurrenceRule: "FREQ=YEARLY" },
    ] as never);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <BacklogPage />
    </QueryClientProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Show details for Read paper" }),
  );
  expect(
    (
      screen.getByRole("option", {
        name: "Custom (unchanged)",
      }) as HTMLOptionElement
    ).selected,
  ).toBe(true);
  expect(patchTask).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Recurrence"), {
    target: { value: "FREQ=DAILY" },
  });
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith("growth", {
      recurrenceRule: "FREQ=DAILY",
    }),
  );
  fireEvent.change(screen.getByLabelText("Physical energy"), {
    target: { value: "high" },
  });
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith("growth", {
      physicalEnergy: "high",
    }),
  );
  fireEvent.change(screen.getByLabelText("Depth"), {
    target: { value: "deep" },
  });
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith("growth", { workDepth: "deep" }),
  );
  expect(moveDaily).not.toHaveBeenCalled();
});

test("unknown area and completed step remain visible without duplicate step scheduling", async () => {
  jest.mocked(fetchBacklog).mockResolvedValue([
    {
      ...tasks[0],
      areaId: "missing-area",
      _subtasks: [{ ...tasks[0]._subtasks[0], completed: true }],
    },
  ] as never);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <BacklogPage />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Unknown area")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Show details for Write report" }),
  );
  expect(screen.getByDisplayValue("Draft outline")).toHaveClass("line-through");
  expect(
    screen.queryByRole("button", { name: "Choose steps" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add to today" }));
  await waitFor(() =>
    expect(moveDaily).toHaveBeenCalledWith(
      [{ targetType: "task", targetId: "parent-one", expectedRevision: 2 }],
      "2026-09-29",
      "move-key",
    ),
  );
});

test("empty Inbox has a useful destination and unauthenticated users see no task data", async () => {
  jest.mocked(fetchBacklog).mockResolvedValue([] as never);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <BacklogPage />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Inbox cleared.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Plan board" })).toHaveAttribute(
    "href",
    "/plan?view=board",
  );
  view.unmount();
  appUserId = null;
  render(
    <QueryClientProvider client={client}>
      <BacklogPage />
    </QueryClientProvider>,
  );
  expect(screen.queryByText("Inbox cleared.")).not.toBeInTheDocument();
});
