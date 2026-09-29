import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import confetti from "canvas-confetti";
import { toast } from "sonner";
import {
  createSprint,
  fetchTaskDetail,
  deleteTask,
  restoreTask,
  createSubtask,
  patchSubtask,
  deleteSubtask,
  fetchAreas,
  fetchSprints,
  fetchTasks,
  patchTask,
  patchTasksBulkSchedule,
} from "@/lib/api";
import { KanbanBoard } from "./kanban-board";
let mockDragStart: (event: unknown) => void;
let mockDragCancel: () => void;
let mockTimer = {
  activeLog: null as null | { taskId: string },
  isRunning: false,
  elapsed: 0,
};
let mockDragEnd: (event: unknown) => void;
jest.mock("@dnd-kit/core", () => ({
  DndContext: ({
    children,
    onDragEnd,
    onDragStart,
    onDragCancel,
  }: {
    children: ReactNode;
    onDragEnd: typeof mockDragEnd;
    onDragStart: typeof mockDragStart;
    onDragCancel: typeof mockDragCancel;
  }) => {
    mockDragEnd = onDragEnd;
    mockDragStart = onDragStart;
    mockDragCancel = onDragCancel;
    return <>{children}</>;
  },
  DragOverlay: ({ children }: { children: ReactNode }) => <>{children}</>,
  PointerSensor: jest.fn(),
  pointerWithin: jest.fn(),
  useSensor: jest.fn(),
  useSensors: jest.fn(),
  useDraggable: () => ({
    setNodeRef: jest.fn(),
    listeners: {},
    attributes: {},
    isDragging: false,
  }),
  useDroppable: () => ({ setNodeRef: jest.fn(), isOver: false }),
}));
jest.mock("canvas-confetti", () => jest.fn());
jest.mock("@/hooks/use-auth-status", () => ({
  useAuthStatus: () => ({ status: "authenticated" }),
}));
jest.mock("@/hooks/use-app-user-id", () => ({
  useAppUserId: () => "user-one",
}));
jest.mock("@/hooks/use-active-timer", () => ({
  useActiveTimer: () => mockTimer,
  formatElapsed: () => "0:00",
}));
jest.mock("@/hooks/use-tags", () => ({
  useTags: () => ({
    tags: [
      { id: 1, name: "Recovery", color: "#112233" },
      { id: 2, name: "Unmatched", color: "#334455" },
    ],
  }),
}));
jest.mock("@/lib/api", () => ({
  createSprint: jest.fn(),
  fetchTaskDetail: jest.fn(),
  fetchAllTags: jest.fn().mockResolvedValue([]),
  deleteTask: jest.fn(),
  restoreTask: jest.fn(),
  createSubtask: jest.fn(),
  patchSubtask: jest.fn(),
  deleteSubtask: jest.fn(),
  fetchAreas: jest.fn(),
  fetchSprints: jest.fn(),
  fetchTasks: jest.fn(),
  patchTask: jest.fn(),
  patchTasksBulkSchedule: jest.fn(),
}));
jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));
const tasks = [
  {
    id: "one",
    title: "Recovery work",
    status: "todo",
    priority: "normal",
    energyLevel: "admin",
    areaId: "area",
    _subtasks: [],
    _tags: [{ id: 1, name: "Recovery", color: "#112233" }],
  },
  {
    id: "two",
    title: "Delivery work",
    status: "in_progress",
    priority: "high",
    energyLevel: "deep_work",
    areaId: "area",
    _subtasks: [],
    _tags: [],
  },
];
const sprints = [
  {
    id: "active",
    name: "Current sprint",
    status: "active",
    startDate: "2026-09-20",
    endDate: "2099-10-04",
  },
  {
    id: "other",
    name: "Other sprint",
    status: "active",
    startDate: "2026-09-20",
    endDate: "2099-10-04",
  },
];
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <KanbanBoard />
    </QueryClientProvider>,
  );
  return { client, ...view };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockTimer = { activeLog: null, isRunning: false, elapsed: 0 };
  jest.mocked(fetchTasks).mockResolvedValue(tasks as never);
  jest
    .mocked(fetchAreas)
    .mockResolvedValue([
      { id: "area", name: "Work", color: "#123456" },
    ] as never);
  jest.mocked(fetchSprints).mockResolvedValue({ sprints } as never);
});
test("switches active sprint and tag filters can hide and restore actual cards", async () => {
  setup();
  await screen.findByText("Recovery work");
  expect(fetchTasks).toHaveBeenCalledWith("active");
  fireEvent.change(screen.getByLabelText("Sprint"), {
    target: { value: "other" },
  });
  await waitFor(() => expect(fetchTasks).toHaveBeenCalledWith("other"));
  await screen.findByText("Recovery work");
  fireEvent.click(screen.getByLabelText("Unmatched"));
  expect(screen.queryByText("Recovery work")).not.toBeInTheDocument();
  expect(screen.queryByText("Delivery work")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Unmatched"));
  expect(screen.getByText("Recovery work")).toBeInTheDocument();
});
test("drag optimistically moves the real task and rejected persistence rolls it back", async () => {
  let rejectSave!: (reason: Error) => void;
  jest.mocked(patchTask).mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectSave = reject;
      }),
  );
  const { client } = setup();
  await screen.findByText("Recovery work");
  act(() => mockDragEnd({ active: { id: "one" }, over: { id: "two" } }));
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith("one", { status: "in_progress" }),
  );
  expect(
    client
      .getQueryData<typeof tasks>(["sprintTasks", "active"])
      ?.find((t) => t.id === "one")?.status,
  ).toBe("in_progress");
  act(() => rejectSave(new Error("Move failed")));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Move failed"));
  expect(
    client
      .getQueryData<typeof tasks>(["sprintTasks", "active"])
      ?.find((t) => t.id === "one")?.status,
  ).toBe("todo");
  expect(screen.getByText("Recovery work")).toBeInTheDocument();
  expect(confetti).not.toHaveBeenCalled();
});
test("invalid or same-column drops do nothing; completing celebrates only after save", async () => {
  jest.mocked(patchTask).mockResolvedValue({} as never);
  setup();
  await screen.findByText("Recovery work");
  act(() => mockDragEnd({ active: { id: "one" }, over: null }));
  act(() => mockDragEnd({ active: { id: "one" }, over: { id: "todo" } }));
  expect(patchTask).not.toHaveBeenCalled();
  act(() => mockDragEnd({ active: { id: "two" }, over: { id: "done" } }));
  await waitFor(() => expect(confetti).toHaveBeenCalled());
  expect(patchTask).toHaveBeenCalledWith("two", { status: "done" });
});
test("empty-board sprint creation validates dates and preserves input after failure", async () => {
  jest.mocked(fetchSprints).mockResolvedValue({ sprints: [] } as never);
  jest.mocked(createSprint).mockRejectedValue(new Error("Sprint unavailable"));
  const { container } = setup();
  await screen.findByText("No active sprint");
  const start = container.querySelector('input[name="startDate"]')!;
  const end = container.querySelector('input[name="endDate"]')!;
  fireEvent.change(
    screen.getByPlaceholderText("Sprint name (e.g. Launch Week)"),
    { target: { value: "Recovery sprint" } },
  );
  fireEvent.change(start, { target: { value: "2026-10-10" } });
  fireEvent.change(end, { target: { value: "2026-10-01" } });
  fireEvent.submit(container.querySelector("form")!);
  expect(createSprint).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith(
    "End date must be on or after start date.",
  );
  fireEvent.change(end, { target: { value: "2026-10-24" } });
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Sprint unavailable"),
  );
  expect(
    screen.getByPlaceholderText("Sprint name (e.g. Launch Week)"),
  ).toHaveValue("Recovery sprint");
  expect(createSprint).toHaveBeenCalledWith({
    name: "Recovery sprint",
    startDate: "2026-10-10",
    endDate: "2026-10-24",
    status: "active",
  });
});
test("overdue rescue retries after failure and hides only after success", async () => {
  jest.mocked(fetchTasks).mockResolvedValue(
    [1, 2, 3].map((id) => ({
      ...tasks[0],
      id: String(id),
      title: `Overdue ${id}`,
      dueDate: "2000-01-01",
    })) as never,
  );
  jest
    .mocked(patchTasksBulkSchedule)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({ updated: 3 });
  setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "Reschedule all" }),
  );
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Offline"));
  fireEvent.click(screen.getByRole("button", { name: "Reschedule all" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Reschedule all" }),
    ).not.toBeInTheDocument(),
  );
  expect(patchTasksBulkSchedule).toHaveBeenLastCalledWith(
    ["1", "2", "3"],
    expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  );
});

function detail() {
  return {
    task: {
      ...tasks[0],
      description: "A concrete outcome",
      recurrenceRule: "FREQ=MONTHLY;BYMONTHDAY=5",
      dueDate: "2026-10-10",
    },
    subtasks: [
      {
        id: "step",
        taskId: "one",
        title: "First step",
        completed: false,
        scheduledDate: null,
        scheduledTime: null,
        estimatedMinutes: 15,
      },
    ],
    subtaskProgress: { done: 0, total: 1 },
  };
}
test("drawer edits metadata and preserves custom recurrence through a failed save", async () => {
  jest.mocked(fetchTaskDetail).mockResolvedValue(detail() as never);
  jest
    .mocked(patchTask)
    .mockRejectedValueOnce(new Error("Save offline"))
    .mockResolvedValue({} as never);
  setup();
  fireEvent.click((await screen.findAllByText("Details / subtasks"))[0]);
  await screen.findByText("Fields & Deadline");
  for (const [label, value] of [
    ["Priority", "urgent"],
    ["Depth", "deep"],
    ["Physical energy", "low"],
    ["Cognitive energy", "quick_win"],
    ["Schedule Date", "2026-10-02"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Save details" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Save offline"));
  expect(screen.getByLabelText("Priority")).toHaveValue("urgent");
  fireEvent.click(screen.getByRole("button", { name: "Save details" }));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved"));
  expect(patchTask).toHaveBeenLastCalledWith(
    "one",
    expect.objectContaining({
      priority: "urgent",
      workDepth: "deep",
      physicalEnergy: "low",
      energyLevel: "quick_win",
      scheduledDate: "2026-10-02",
      dueDate: "2026-10-10",
      recurrenceRule: "FREQ=MONTHLY;BYMONTHDAY=5",
    }),
  );
});
test("drawer adds, edits, schedules and deletes an executable step", async () => {
  jest.mocked(fetchTaskDetail).mockResolvedValue(detail() as never);
  jest.mocked(createSubtask).mockResolvedValue({} as never);
  jest.mocked(patchSubtask).mockResolvedValue({} as never);
  jest.mocked(deleteSubtask).mockResolvedValue({} as never);
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  setup();
  fireEvent.click((await screen.findAllByText("Details / subtasks"))[0]);
  const add = await screen.findByPlaceholderText("+ Add executable step");
  fireEvent.change(add, { target: { value: "  Second step  " } });
  fireEvent.keyDown(add, { key: "Enter" });
  await waitFor(() =>
    expect(createSubtask).toHaveBeenCalledWith({
      taskId: "one",
      title: "Second step",
    }),
  );
  await waitFor(() => expect(add).toHaveValue(""));
  const title = screen.getByDisplayValue("First step");
  fireEvent.change(title, { target: { value: "Revised step" } });
  fireEvent.blur(title);
  await waitFor(() =>
    expect(patchSubtask).toHaveBeenCalledWith("step", {
      title: "Revised step",
    }),
  );
  fireEvent.change(screen.getByTitle("Scheduled date"), {
    target: { value: "2026-10-03" },
  });
  fireEvent.change(screen.getByTitle("Scheduled time"), {
    target: { value: "09:30" },
  });
  const estimate = screen.getByTitle("Estimated minutes");
  fireEvent.change(estimate, { target: { value: "25" } });
  fireEvent.blur(estimate);
  await waitFor(() =>
    expect(patchSubtask).toHaveBeenCalledWith("step", { estimatedMinutes: 25 }),
  );
  expect(patchSubtask).toHaveBeenCalledWith("step", {
    scheduledDate: "2026-10-03",
  });
  expect(patchSubtask).toHaveBeenCalledWith("step", { scheduledTime: "09:30" });
  fireEvent.click(screen.getByTitle("Delete subtask"));
  await waitFor(() => expect(deleteSubtask).toHaveBeenCalledWith("step"));
  confirm.mockRestore();
});
test("card deletion supports undo and reports failed restoration", async () => {
  jest.mocked(deleteTask).mockResolvedValue({} as never);
  jest.mocked(restoreTask).mockRejectedValueOnce(new Error("Restore offline"));
  setup();
  await screen.findByText("Recovery work");
  fireEvent.click(screen.getAllByTitle("Delete task")[0]);
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("Recovery work"),
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      }),
    ),
  );
  const call = jest
    .mocked(toast.success)
    .mock.calls.find((c) => String(c[0]).includes("Recovery work"))!;
  act(() => {
    (call[1] as { action: { onClick: () => void } }).action.onClick();
  });
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Error: Restore offline"),
  );
  expect(restoreTask).toHaveBeenCalledWith("one");
});

test("drawer spreads only unfinished unscheduled steps and retains range on failed writes", async () => {
  const data = detail();
  data.subtasks.push({
    ...data.subtasks[0],
    id: "step-two",
    title: "Last step",
  });
  jest.mocked(fetchTaskDetail).mockResolvedValue(data as never);
  jest
    .mocked(patchSubtask)
    .mockRejectedValueOnce(new Error("Spread offline"))
    .mockResolvedValue({} as never);
  const { container } = setup();
  fireEvent.click((await screen.findAllByText("Details / subtasks"))[0]);
  fireEvent.click(
    await screen.findByRole("button", { name: "Spread across days" }),
  );
  const dates = Array.from(
    container.querySelectorAll('input[type="date"]'),
  ).filter((e) => !(e as HTMLInputElement).id && !e.closest("label"));
  expect(dates).toHaveLength(2);
  fireEvent.change(dates[0], { target: { value: "2026-10-02" } });
  fireEvent.change(dates[1], { target: { value: "2026-10-06" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply Spread" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Spread offline"),
  );
  expect(dates[0]).toHaveValue("2026-10-02");
  fireEvent.click(screen.getByRole("button", { name: "Apply Spread" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Apply Spread" }),
    ).not.toBeInTheDocument(),
  );
  expect(patchSubtask).toHaveBeenCalledWith("step", {
    scheduledDate: "2026-10-02",
  });
  expect(patchSubtask).toHaveBeenCalledWith("step-two", {
    scheduledDate: "2026-10-06",
  });
});
test("board status dropdown works without drag and failed deletion reports an error", async () => {
  jest.mocked(patchTask).mockResolvedValue({} as never);
  jest.mocked(deleteTask).mockRejectedValue(new Error("Delete offline"));
  setup();
  await screen.findByText("Recovery work");
  fireEvent.change(screen.getAllByLabelText("Change status")[0], {
    target: { value: "in_progress" },
  });
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith("one", { status: "in_progress" }),
  );
  fireEvent.click(screen.getAllByTitle("Delete task")[0]);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Error: Delete offline"),
  );
});
test("drawer deletion closes after persistence and successful undo restores the task", async () => {
  jest.mocked(fetchTaskDetail).mockResolvedValue(detail() as never);
  jest.mocked(deleteTask).mockResolvedValue({} as never);
  jest.mocked(restoreTask).mockResolvedValue({} as never);
  setup();
  fireEvent.click((await screen.findAllByText("Details / subtasks"))[0]);
  await screen.findByText("Fields & Deadline");
  const buttons = screen.getAllByTitle("Delete task");
  fireEvent.click(buttons[buttons.length - 1]);
  await waitFor(() =>
    expect(screen.queryByText("Fields & Deadline")).not.toBeInTheDocument(),
  );
  const call = jest
    .mocked(toast.success)
    .mock.calls.find((c) => String(c[0]).includes("deleted"))!;
  act(() => {
    (call[1] as { action: { onClick: () => void } }).action.onClick();
  });
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Task restored"),
  );
});
test("open-task event opens details and date/recurrence clearing explicitly saves null", async () => {
  jest.mocked(fetchTaskDetail).mockResolvedValue(detail() as never);
  jest.mocked(patchTask).mockResolvedValue({} as never);
  setup();
  await screen.findByText("Recovery work");
  act(() =>
    window.dispatchEvent(
      new CustomEvent("open-task", { detail: { id: "one" } }),
    ),
  );
  await screen.findByText("Fields & Deadline");
  fireEvent.change(screen.getByLabelText("Due Date"), {
    target: { value: "" },
  });
  fireEvent.change(screen.getByLabelText("Recurrence (RRULE)"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save details" }));
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith(
      "one",
      expect.objectContaining({
        dueDate: null,
        scheduledDate: null,
        recurrenceRule: null,
      }),
    ),
  );
});

test("priority changes roll back on failure and succeed on retry", async () => {
  jest
    .mocked(patchTask)
    .mockRejectedValueOnce(new Error("Priority offline"))
    .mockResolvedValue({} as never);
  const { client } = setup();
  await screen.findByText("Recovery work");
  fireEvent.click(screen.getByRole("button", { name: "normal ▾" }));
  fireEvent.click(screen.getByRole("button", { name: "urgent" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Priority offline"),
  );
  expect(
    client
      .getQueryData<typeof tasks>(["sprintTasks", "active"])
      ?.find((t) => t.id === "one")?.priority,
  ).toBe("normal");
  fireEvent.click(screen.getByRole("button", { name: "normal ▾" }));
  fireEvent.click(screen.getByRole("button", { name: "low" }));
  await waitFor(() =>
    expect(patchTask).toHaveBeenLastCalledWith("one", { priority: "low" }),
  );
});
test("running timer and subtask progress remain visible during drag preview and cancel", async () => {
  mockTimer = { activeLog: { taskId: "one" }, isRunning: true, elapsed: 65 };
  jest.mocked(fetchTasks).mockResolvedValue([
    { ...tasks[0], _subtasksTotal: 2, _subtasksDone: 1 },
    { ...tasks[1], status: "done", _subtasksTotal: 0 },
  ] as never);
  setup();
  await screen.findByText("Recovery work");
  expect(screen.getByText("timer running · 0:00")).toBeInTheDocument();
  expect(screen.getByText("1/2")).toBeInTheDocument();
  act(() => mockDragStart({ active: { id: "one" } }));
  expect(screen.getAllByText("Recovery work")).toHaveLength(2);
  act(() => mockDragCancel());
  expect(screen.getAllByText("Recovery work")).toHaveLength(1);
  act(() => mockDragEnd({ active: { id: "missing" }, over: { id: "done" } }));
  act(() => mockDragEnd({ active: { id: "one" }, over: { id: "missing" } }));
  expect(patchTask).not.toHaveBeenCalled();
});

test("legacy detail defaults remain editable and a completed step can be reopened", async () => {
  const data = {
    task: { id: "one", title: "Legacy task", status: "todo", areaId: "area" },
    subtasks: [
      {
        id: "completed",
        taskId: "one",
        title: "Finished step",
        completed: true,
        scheduledDate: "2026-10-02",
        scheduledTime: "09:30:00",
        estimatedMinutes: 20,
      },
    ],
    subtaskProgress: null,
  };
  jest.mocked(fetchTaskDetail).mockResolvedValue(data as never);
  jest.mocked(patchSubtask).mockResolvedValue({} as never);
  jest.mocked(patchTask).mockResolvedValue({} as never);
  setup();
  fireEvent.click((await screen.findAllByText("Details / subtasks"))[0]);
  await screen.findByText("Fields & Deadline");
  expect(screen.getByLabelText("Priority")).toHaveValue("normal");
  expect(screen.getByLabelText("Recurrence (RRULE)")).toHaveValue("");
  expect(screen.getByDisplayValue("Finished step")).toBeDisabled();
  const row = screen.getByDisplayValue("Finished step").closest("li")!;
  fireEvent.click(row.querySelector("button")!);
  await waitFor(() =>
    expect(patchSubtask).toHaveBeenCalledWith("completed", {
      completed: false,
    }),
  );
  fireEvent.change(screen.getByLabelText("Recurrence (RRULE)"), {
    target: { value: "FREQ=DAILY" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save details" }));
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith(
      "one",
      expect.objectContaining({
        recurrenceRule: "FREQ=DAILY",
        priority: "normal",
        workDepth: "normal",
        physicalEnergy: "medium",
        energyLevel: "shallow",
      }),
    ),
  );
});
test("step date time and estimate can be cleared without overwriting unchanged titles", async () => {
  const data = detail();
  data.subtasks[0] = {
    ...data.subtasks[0],
    scheduledDate: "2026-10-02",
    scheduledTime: "09:30:00",
  } as never;
  jest.mocked(fetchTaskDetail).mockResolvedValue(data as never);
  jest.mocked(patchSubtask).mockResolvedValue({} as never);
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
  setup();
  fireEvent.click((await screen.findAllByText("Details / subtasks"))[0]);
  await screen.findByText("Fields & Deadline");
  fireEvent.blur(screen.getByDisplayValue("First step"));
  expect(patchSubtask).not.toHaveBeenCalled();
  fireEvent.change(screen.getByTitle("Scheduled date"), {
    target: { value: "" },
  });
  fireEvent.change(screen.getByTitle("Scheduled time"), {
    target: { value: "" },
  });
  const estimate = screen.getByTitle("Estimated minutes");
  fireEvent.change(estimate, { target: { value: "" } });
  fireEvent.blur(estimate);
  await waitFor(() =>
    expect(patchSubtask).toHaveBeenCalledWith("step", {
      estimatedMinutes: null,
    }),
  );
  expect(patchSubtask).toHaveBeenCalledWith("step", { scheduledDate: null });
  expect(patchSubtask).toHaveBeenCalledWith("step", { scheduledTime: null });
  fireEvent.click(screen.getByTitle("Delete subtask"));
  expect(deleteSubtask).not.toHaveBeenCalled();
  confirm.mockRestore();
});
