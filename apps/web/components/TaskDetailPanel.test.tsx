import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import {
  createSubtask,
  deleteSubtask,
  deleteTask,
  fetchAreas,
  fetchTaskDetail,
  patchSubtask,
  patchTask,
  restoreTask,
} from "@/lib/api";
import { TaskDetailPanel } from "./TaskDetailPanel";

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));
jest.mock("@/lib/api", () => ({
  fetchTaskDetail: jest.fn(),
  fetchAreas: jest.fn().mockResolvedValue([]),
  patchTask: jest.fn(),
  deleteTask: jest.fn(),
  restoreTask: jest.fn(),
  createSubtask: jest.fn(),
  patchSubtask: jest.fn(),
  deleteSubtask: jest.fn(),
}));
jest.mock("./task-card", () => ({ SubtaskBar: () => null }));
jest.mock("./TagChip", () => ({ TagChip: () => null }));
jest.mock("./TagSelector", () => ({ TagSelector: () => null }));

const detail = (title = "Write report") => ({
  task: {
    id: "task-1",
    title,
    description: "Original notes",
    dueDate: null,
    scheduledDate: null,
    recurrenceRule: null,
    areaId: "area-1",
    priority: "normal",
    workDepth: "normal",
    physicalEnergy: "medium",
    energyLevel: "shallow",
    status: "todo",
    _tags: [],
  },
  subtasks: [],
  subtaskProgress: { done: 0, total: 0 },
});

function setup(onClose = jest.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <TaskDetailPanel
        taskId="task-1"
        userId="user-one"
        isOpen
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

beforeEach(() => {
  (fetchTaskDetail as jest.Mock).mockReset().mockResolvedValue(detail());
  (patchTask as jest.Mock)
    .mockReset()
    .mockResolvedValue({ task: detail().task });
  jest.clearAllMocks();
});

test("confirms a title save after the API succeeds", async () => {
  setup();
  const title = await screen.findByPlaceholderText("Task title");
  fireEvent.change(title, { target: { value: "Finish report" } });
  fireEvent.blur(title);
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith("task-1", {
      title: "Finish report",
    }),
  );
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved"));
  expect(title).toHaveValue("Finish report");
});

test("retains an unsaved description through a same-task refetch", async () => {
  const { client } = setup();
  const description = await screen.findByPlaceholderText("Add description...");
  fireEvent.change(description, { target: { value: "My unfinished draft" } });
  (fetchTaskDetail as jest.Mock).mockResolvedValue(detail("Remote title"));
  await client.invalidateQueries({ queryKey: ["task", "task-1"] });
  expect(description).toHaveValue("My unfinished draft");
  expect(patchTask).not.toHaveBeenCalled();
});

test("reports a failed save and keeps the edited value", async () => {
  (patchTask as jest.Mock).mockRejectedValue(new Error("Offline"));
  setup();
  const title = await screen.findByPlaceholderText("Task title");
  fireEvent.change(title, { target: { value: "Keep this title" } });
  fireEvent.blur(title);
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Offline"));
  expect(title).toHaveValue("Keep this title");
});

test("subtask add trims input and completion targets the selected subtask", async () => {
  (fetchTaskDetail as jest.Mock).mockResolvedValue({
    ...detail(),
    subtasks: [
      {
        id: "sub-1",
        taskId: "task-1",
        title: "Write outline",
        completed: false,
      },
    ],
    subtaskProgress: { done: 0, total: 1 },
  });
  (createSubtask as jest.Mock).mockResolvedValue({ subtask: { id: "sub-2" } });
  (patchSubtask as jest.Mock).mockResolvedValue({
    subtask: { id: "sub-1", completed: true },
  });
  setup();
  fireEvent.change(
    await screen.findByPlaceholderText("+ Add executable step"),
    { target: { value: "  Review evidence  " } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Add subtask" }));
  await waitFor(() =>
    expect(createSubtask).toHaveBeenCalledWith({
      taskId: "task-1",
      title: "Review evidence",
    }),
  );
  expect(screen.getByPlaceholderText("+ Add executable step")).toHaveValue("");
  fireEvent.click(
    screen.getByRole("button", { name: "Complete Write outline" }),
  );
  await waitFor(() =>
    expect(patchSubtask).toHaveBeenCalledWith("sub-1", { completed: true }),
  );
});

test("subtask deletion requires confirmation and task deletion offers working undo", async () => {
  (fetchTaskDetail as jest.Mock).mockResolvedValue({
    ...detail(),
    subtasks: [
      {
        id: "sub-1",
        taskId: "task-1",
        title: "Write outline",
        completed: false,
      },
    ],
    subtaskProgress: { done: 0, total: 1 },
  });
  (deleteSubtask as jest.Mock).mockResolvedValue({ ok: true });
  (deleteTask as jest.Mock).mockResolvedValue({ ok: true });
  (restoreTask as jest.Mock).mockResolvedValue({ task: detail().task });
  const confirmSpy = jest
    .spyOn(window, "confirm")
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true);
  const onClose = jest.fn();
  try {
    setup(onClose);
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete Write outline" }),
    );
    expect(deleteSubtask).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Delete Write outline" }),
    );
    await waitFor(() => expect(deleteSubtask).toHaveBeenCalledWith("sub-1"));
    fireEvent.click(
      screen.getByRole("button", { name: "Delete task (undo available)" }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const deletedCall = (toast.success as jest.Mock).mock.calls.find(
      ([message]) => String(message).includes("deleted"),
    );
    expect(deletedCall?.[1]?.action?.label).toBe("Undo");
    deletedCall[1].action.onClick();
    await waitFor(() => expect(restoreTask).toHaveBeenCalledWith("task-1"));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Task restored"),
    );
  } finally {
    confirmSpy.mockRestore();
  }
});

test("schedule detail save sends both dates together and a failed call keeps the chosen values", async () => {
  (patchTask as jest.Mock).mockRejectedValueOnce(new Error("Could not save"));
  setup();
  fireEvent.change(await screen.findByLabelText("Schedule Date"), {
    target: { value: "2026-10-01" },
  });
  fireEvent.change(screen.getByLabelText("Due Date"), {
    target: { value: "2026-10-03" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save details" }));
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith("task-1", {
      scheduledDate: "2026-10-01",
      dueDate: "2026-10-03",
    }),
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Could not save"),
  );
  expect(screen.getByLabelText("Schedule Date")).toHaveValue("2026-10-01");
  expect(screen.getByLabelText("Due Date")).toHaveValue("2026-10-03");
});

test("metadata controls send the selected area, priority, energy, and recurrence", async () => {
  (fetchAreas as jest.Mock).mockResolvedValue([
    { id: "area-1", name: "Work" },
    { id: "area-2", name: "Health" },
  ]);
  setup();
  await screen.findByPlaceholderText("Task title");
  fireEvent.change(screen.getByLabelText("Priority"), {
    target: { value: "urgent" },
  });
  fireEvent.change(screen.getByLabelText("Depth"), {
    target: { value: "deep" },
  });
  fireEvent.change(screen.getByLabelText("Physical energy"), {
    target: { value: "high" },
  });
  fireEvent.change(screen.getByLabelText("Cognitive energy"), {
    target: { value: "deep_work" },
  });
  fireEvent.change(screen.getByLabelText("Area"), {
    target: { value: "area-2" },
  });
  fireEvent.change(screen.getByLabelText("Repeat"), {
    target: { value: "FREQ=WEEKLY" },
  });
  await waitFor(() => {
    expect(patchTask).toHaveBeenCalledWith("task-1", { priority: "urgent" });
    expect(patchTask).toHaveBeenCalledWith("task-1", { workDepth: "deep" });
    expect(patchTask).toHaveBeenCalledWith("task-1", {
      physicalEnergy: "high",
    });
    expect(patchTask).toHaveBeenCalledWith("task-1", {
      energyLevel: "deep_work",
    });
    expect(patchTask).toHaveBeenCalledWith("task-1", { areaId: "area-2" });
    expect(patchTask).toHaveBeenCalledWith("task-1", {
      recurrenceRule: "FREQ=WEEKLY",
    });
  });
});

test("Escape closes task details and focus returns to the opener on unmount", async () => {
  const opener = document.createElement("button");
  opener.textContent = "Open task";
  document.body.appendChild(opener);
  opener.focus();
  const onClose = jest.fn();
  const view = setup(onClose);
  expect(
    await screen.findByRole("button", { name: "Close task details" }),
  ).toHaveFocus();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(opener).toHaveFocus();
  opener.remove();
});

test("undo failure reports the error after deleting a task", async () => {
  (deleteTask as jest.Mock).mockResolvedValue({ ok: true });
  (restoreTask as jest.Mock).mockRejectedValue(new Error("Restore denied"));
  setup();
  await screen.findByPlaceholderText("Task title");
  fireEvent.click(
    await screen.findByRole("button", { name: "Delete task (undo available)" }),
  );
  const deletedCall = await waitFor(() => {
    const call = (toast.success as jest.Mock).mock.calls.find(([message]) =>
      String(message).includes("deleted"),
    );
    expect(call).toBeDefined();
    return call;
  });
  deletedCall[1].action.onClick();
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Error: Restore denied"),
  );
});

test("failed task load shows retry instead of an empty editable task", async () => {
  (fetchTaskDetail as jest.Mock)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(detail("Recovered task"));
  setup();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Task details could not be loaded",
  );
  expect(screen.queryByPlaceholderText("Task title")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Delete task (undo available)" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
  expect(await screen.findByPlaceholderText("Task title")).toHaveValue(
    "Recovered task",
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("failed subtask rename reports the error and leaves the edited text available", async () => {
  (fetchTaskDetail as jest.Mock).mockResolvedValue({
    ...detail(),
    subtasks: [
      { id: "sub-1", taskId: "task-1", title: "Old step", completed: false },
    ],
    subtaskProgress: { done: 0, total: 1 },
  });
  (patchSubtask as jest.Mock).mockRejectedValue(new Error("Rename failed"));
  setup();
  const input = await screen.findByDisplayValue("Old step");
  fireEvent.change(input, { target: { value: "New step" } });
  fireEvent.blur(input);
  await waitFor(() =>
    expect(patchSubtask).toHaveBeenCalledWith("sub-1", { title: "New step" }),
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Rename failed"),
  );
  expect(input).toHaveValue("New step");
});

test("Tab navigation wraps within the task dialog", async () => {
  setup();
  const close = await screen.findByRole("button", {
    name: "Close task details",
  });
  await screen.findByPlaceholderText("Task title");
  const dialog = screen.getByRole("dialog", { name: "Task details" });
  // The title is the first focusable control; shift-tab wraps to the footer.
  const first = screen.getByPlaceholderText("Task title");
  first.focus();
  fireEvent.keyDown(dialog.firstElementChild!, { key: "Tab", shiftKey: true });
  expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  fireEvent.keyDown(dialog.firstElementChild!, { key: "Tab" });
  expect(first).toHaveFocus();
  expect(close).toBeInTheDocument();
});

test("custom recurrence can be retained after trying a preset", async () => {
  (fetchTaskDetail as jest.Mock).mockResolvedValue({
    ...detail(),
    task: { ...detail().task, recurrenceRule: "FREQ=MONTHLY;BYDAY=TU" },
  });
  setup();
  const repeat = await screen.findByLabelText("Repeat");
  expect(repeat).toHaveValue("__custom");
  expect(
    screen.getByRole("option", { name: "Custom (keep current)" }),
  ).toBeInTheDocument();
  fireEvent.change(repeat, { target: { value: "FREQ=DAILY" } });
  fireEvent.change(repeat, { target: { value: "__custom" } });
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith("task-1", {
      recurrenceRule: "FREQ=MONTHLY;BYDAY=TU",
    }),
  );
});

test("failed task deletion leaves the panel open and reports the error", async () => {
  (deleteTask as jest.Mock).mockRejectedValue(new Error("Delete unavailable"));
  const onClose = jest.fn();
  setup(onClose);
  await screen.findByPlaceholderText("Task title");
  fireEvent.click(
    screen.getByRole("button", { name: "Delete task (undo available)" }),
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Delete unavailable"),
  );
  expect(onClose).not.toHaveBeenCalled();
  expect(
    screen.getByRole("dialog", { name: "Task details" }),
  ).toBeInTheDocument();
});

test("clearing a description saves null and an unchanged blur makes no request", async () => {
  setup();
  const description = await screen.findByPlaceholderText("Add description...");
  fireEvent.blur(description);
  expect(patchTask).not.toHaveBeenCalled();
  fireEvent.change(description, { target: { value: "" } });
  fireEvent.blur(description);
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith("task-1", { description: null }),
  );
});

test("Enter adds a trimmed step and a completed step can be reopened", async () => {
  (fetchTaskDetail as jest.Mock).mockResolvedValue({
    ...detail(),
    subtasks: [
      {
        id: "sub-done",
        taskId: "task-1",
        title: "Completed step",
        completed: true,
      },
    ],
    subtaskProgress: { done: 1, total: 1 },
  });
  (createSubtask as jest.Mock).mockResolvedValue({
    subtask: { id: "sub-new" },
  });
  (patchSubtask as jest.Mock).mockResolvedValue({
    subtask: { id: "sub-done", completed: false },
  });
  setup();
  const input = await screen.findByPlaceholderText("+ Add executable step");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(createSubtask).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "  Next step  " } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() =>
    expect(createSubtask).toHaveBeenCalledWith({
      taskId: "task-1",
      title: "Next step",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Reopen Completed step" }),
  );
  await waitFor(() =>
    expect(patchSubtask).toHaveBeenCalledWith("sub-done", { completed: false }),
  );
});
