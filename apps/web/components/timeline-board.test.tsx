import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import {
  fetchAreas,
  fetchSprints,
  fetchTasks,
  patchTask,
  patchSubtask,
} from "@/lib/api";
import { addDaysYMD, toYMD } from "@/lib/timeline-utils";
import { TimelineBoard } from "./timeline-board";
let mockDragEnd: (event: unknown) => void;
let mockDragStart: (event: unknown) => void;
let mockDragCancel: () => void;
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
jest.mock("@/hooks/use-auth-status", () => ({
  useAuthStatus: () => ({ status: "authenticated" }),
}));
jest.mock("@/hooks/use-app-user-id", () => ({
  useAppUserId: () => "user-one",
}));
jest.mock("@/lib/api", () => ({
  fetchAreas: jest.fn(),
  fetchSprints: jest.fn(),
  fetchTasks: jest.fn(),
  patchTask: jest.fn(),
  patchSubtask: jest.fn(),
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));
const today = toYMD(new Date());
const tasks = [
  {
    id: "unscheduled",
    title: "Unscheduled delivery",
    status: "todo",
    priority: "normal",
    areaId: "area",
    _subtasks: [],
  },
  {
    id: "scheduled",
    title: "Scheduled delivery",
    status: "todo",
    priority: "high",
    areaId: "area",
    scheduledDate: today,
    _subtasks: [
      {
        id: "sub-one",
        title: "Verify backup",
        scheduledDate: today,
        scheduledTime: "10:00",
        estimatedMinutes: 20,
        completed: false,
      },
    ],
  },
  {
    id: "done",
    title: "Finished delivery",
    status: "done",
    priority: "normal",
    areaId: "area",
    _subtasks: [],
  },
];
async function setup(expected: string | RegExp = "Unscheduled delivery") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <TimelineBoard />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getAllByText(expected).length).toBeGreaterThan(0),
  );
  return { client, ...view };
}
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(globalThis, "PointerEvent", {
    configurable: true,
    value: MouseEvent,
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: jest.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: jest.fn(),
  });
  jest.mocked(fetchTasks).mockResolvedValue(tasks as never);
  jest
    .mocked(fetchAreas)
    .mockResolvedValue([
      { id: "area", name: "Work", color: "#123456" },
    ] as never);
  jest.mocked(fetchSprints).mockResolvedValue({
    sprints: [{ id: "active", name: "Current sprint", status: "active" }],
  } as never);
});
test("active sprint defaults and explicit all-tasks survives a query refresh", async () => {
  const { client } = await setup();
  expect(fetchTasks).toHaveBeenCalledWith("active");
  expect(screen.queryByText("Finished delivery")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Sprint"), { target: { value: "" } });
  await waitFor(() => expect(fetchTasks).toHaveBeenCalledWith(undefined));
  act(() =>
    client.setQueryData(["sprints", "user-one"], {
      sprints: [{ id: "next", name: "Next sprint", status: "active" }],
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("option", { name: "Next sprint" }),
    ).toBeInTheDocument(),
  );
  expect(screen.getByLabelText("Sprint")).toHaveValue("");
});
test("zoom and period navigation change real calendar date cells", async () => {
  const { container } = await setup();
  const dates = () =>
    [...container.querySelectorAll("[data-date]")].map((x) =>
      x.getAttribute("data-date"),
    );
  const original = dates();
  expect(original).toHaveLength(21);
  fireEvent.click(screen.getByRole("button", { name: "Day (7d)" }));
  expect(dates()).toHaveLength(7);
  fireEvent.click(screen.getByTitle("Next period"));
  const next = dates()[0];
  fireEvent.click(screen.getByTitle("Previous period"));
  expect(dates()[0]).not.toBe(next);
  fireEvent.click(screen.getByRole("button", { name: "Month" }));
  expect(dates()).toHaveLength(30);
  fireEvent.click(screen.getByRole("button", { name: "Today" }));
  expect(dates()[0]).toBe(today);
});
test("valid drop schedules task, invalid drop does nothing, failure leaves task available", async () => {
  jest.mocked(patchTask).mockRejectedValue(new Error("Schedule unavailable"));
  await setup("Scheduled delivery");
  act(() => mockDragEnd({ active: { id: "task-unscheduled" }, over: null }));
  expect(patchTask).not.toHaveBeenCalled();
  act(() =>
    mockDragEnd({
      active: { id: "task-unscheduled" },
      over: { id: `timeline-day-${today}` },
    }),
  );
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith("unscheduled", {
      scheduledDate: today,
    }),
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Schedule unavailable"),
  );
  expect(screen.getByText("Unscheduled delivery")).toBeInTheDocument();
});
test("subtask completion errors retain its incomplete state and allow retry", async () => {
  jest
    .mocked(patchSubtask)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({} as never);
  await setup();
  fireEvent.click(screen.getByTitle("Verify backup · 10:00 · 20m"));
  fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Offline"));
  expect(patchSubtask).toHaveBeenCalledWith("sub-one", { completed: true });
  fireEvent.click(screen.getByTitle("Verify backup · 10:00 · 20m"));
  fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
  await waitFor(() => expect(patchSubtask).toHaveBeenCalledTimes(2));
});

test("dragging a dated task span and its step moves each by the chosen calendar day", async () => {
  jest.mocked(patchTask).mockResolvedValue({} as never);
  jest.mocked(patchSubtask).mockResolvedValue({} as never);
  await setup();
  const next = addDaysYMD(today, 1);
  const bar = screen.getByTitle("Scheduled delivery — drag to shift");
  fireEvent.pointerDown(bar, { button: 0, pointerId: 1, clientX: 20 });
  fireEvent.pointerUp(bar, { button: 0, pointerId: 1, clientX: 64 });
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith("scheduled", {
      scheduledDate: next,
    }),
  );
  const dot = screen.getByTitle("Verify backup · 10:00 · 20m");
  fireEvent.pointerDown(dot, { button: 0, pointerId: 2, clientX: 20 });
  fireEvent.pointerUp(dot, { button: 0, pointerId: 2, clientX: 64 });
  await waitFor(() =>
    expect(patchSubtask).toHaveBeenCalledWith("sub-one", {
      scheduledDate: next,
    }),
  );
});

test("a completed step can be reopened without changing its scheduled date", async () => {
  jest.mocked(patchSubtask).mockResolvedValue({} as never);
  jest.mocked(fetchTasks).mockResolvedValue([
    {
      ...tasks[1],
      _subtasks: [{ ...tasks[1]._subtasks[0], completed: true }],
    },
  ] as never);
  await setup("Scheduled delivery");
  fireEvent.click(screen.getByTitle("Verify backup · 10:00 · 20m · ✓ done"));
  expect(
    screen.getByRole("button", { name: "Mark incomplete" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Mark incomplete" }));
  await waitFor(() =>
    expect(patchSubtask).toHaveBeenCalledWith("sub-one", { completed: false }),
  );
  expect(patchTask).not.toHaveBeenCalled();
});

test("empty and out-of-range work show distinct guidance without including finished tasks", async () => {
  jest.mocked(fetchTasks).mockResolvedValue([] as never);
  const empty = await setup(/No scheduled tasks in this window/);
  expect(
    screen.getByText(/No scheduled tasks in this window/),
  ).toBeInTheDocument();
  empty.unmount();

  const future = addDaysYMD(today, 60);
  jest.mocked(fetchTasks).mockResolvedValue([
    { ...tasks[0], id: "future", title: "Future deadline", dueDate: future },
    { ...tasks[2], id: "finished", title: "Finished delivery" },
  ] as never);
  await setup("Future deadline");
  expect(screen.getByText(/Nothing dated in this range/)).toBeInTheDocument();
  expect(screen.getByText("Future deadline")).toBeInTheDocument();
  expect(screen.getByText(`Due: ${future}`)).toBeInTheDocument();
  expect(screen.queryByText("Finished delivery")).not.toBeInTheDocument();
});

test("drag overlay appears only during an unscheduled task drag and cancel does not schedule", async () => {
  await setup();
  expect(screen.getAllByText("Unscheduled delivery")).toHaveLength(1);
  act(() => mockDragStart({ active: { id: "task-unscheduled" } }));
  expect(screen.getAllByText("Unscheduled delivery")).toHaveLength(2);
  act(() => mockDragCancel());
  expect(screen.getAllByText("Unscheduled delivery")).toHaveLength(1);
  expect(patchTask).not.toHaveBeenCalled();
});

test("an undated unfinished step remains findable when its sibling lies outside the window", async () => {
  const distant = addDaysYMD(today, 60);
  jest.mocked(fetchTasks).mockResolvedValue([
    {
      ...tasks[1],
      id: "mixed",
      title: "Mixed schedule",
      scheduledDate: undefined,
      _subtasks: [
        {
          id: "far",
          title: "Later step",
          scheduledDate: distant,
          completed: false,
        },
        {
          id: "undated",
          title: "Next step",
          scheduledDate: null,
          completed: false,
        },
      ],
    },
  ] as never);
  await setup("Mixed schedule");
  expect(screen.getByText(`Earliest: ${distant}`)).toBeInTheDocument();
  expect(screen.getByText(/Nothing dated in this range/)).toBeInTheDocument();
  expect(screen.queryByTitle(/Later step/)).not.toBeInTheDocument();
});

test("cancelled and secondary-button drags leave dated work where it was", async () => {
  await setup();
  const bar = screen.getByTitle("Scheduled delivery — drag to shift");
  fireEvent.pointerDown(bar, { button: 0, pointerId: 3, clientX: 20 });
  fireEvent.pointerMove(bar, { button: 0, pointerId: 3, clientX: 64 });
  fireEvent.pointerCancel(bar, { pointerId: 3 });
  fireEvent.pointerUp(bar, { button: 0, pointerId: 3, clientX: 64 });
  const dot = screen.getByTitle("Verify backup · 10:00 · 20m");
  fireEvent.pointerDown(dot, { button: 2, pointerId: 4, clientX: 20 });
  fireEvent.pointerUp(dot, { button: 2, pointerId: 4, clientX: 64 });
  expect(patchTask).not.toHaveBeenCalled();
  expect(patchSubtask).not.toHaveBeenCalled();
});

test("dragging a step suppresses its accidental release click but keeps the detail action usable", async () => {
  jest.mocked(patchSubtask).mockResolvedValue({} as never);
  await setup();
  const dot = screen.getByTitle("Verify backup · 10:00 · 20m");
  fireEvent.pointerDown(dot, { button: 0, pointerId: 5, clientX: 20 });
  fireEvent.pointerUp(dot, { button: 0, pointerId: 5, clientX: 64 });
  await waitFor(() =>
    expect(patchSubtask).toHaveBeenCalledWith("sub-one", {
      scheduledDate: addDaysYMD(today, 1),
    }),
  );
  fireEvent.click(dot);
  expect(
    screen.queryByRole("button", { name: "Mark done" }),
  ).not.toBeInTheDocument();
  fireEvent.click(dot);
  expect(screen.getByRole("button", { name: "Mark done" })).toBeInTheDocument();
});

test("without an active sprint, undated child work appears in the tray", async () => {
  jest.mocked(fetchSprints).mockResolvedValue({ sprints: [] } as never);
  jest.mocked(fetchTasks).mockResolvedValue([
    {
      ...tasks[1],
      id: "unplanned",
      title: "Unplanned steps",
      scheduledDate: null,
      _subtasks: [
        {
          id: "child",
          title: "Start draft",
          scheduledDate: null,
          completed: false,
        },
      ],
    },
  ] as never);
  await setup("Unplanned steps");
  expect(fetchTasks).toHaveBeenCalledWith(undefined);
  expect(screen.getByText("No subtask dates")).toBeInTheDocument();
  expect(screen.getByText(/Nothing dated in this range/)).toBeInTheDocument();
});
