import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { deleteTask, patchTask, restoreTask } from "@/lib/api";
import { TaskTableRow } from "./TaskTableRow";

jest.mock("@/components/TimerButton", () => ({ TimerButton: () => null }));
jest.mock("@/components/TaskDetailPanel", () => ({
  TaskDetailPanel: ({
    taskId,
    isOpen,
    onClose,
  }: {
    taskId: string;
    isOpen: boolean;
    onClose: () => void;
  }) =>
    isOpen
      ? createPortal(
          <div role="dialog">
            Details for {taskId}
            <button onClick={onClose}>Close task</button>
          </div>,
          document.body,
        )
      : null,
}));
jest.mock("@/lib/api", () => ({
  patchTask: jest.fn(),
  deleteTask: jest.fn(),
  restoreTask: jest.fn(),
}));
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const task = {
  id: "task-one",
  title: "File expenses",
  status: "todo",
  priority: "high",
  energyLevel: "deep_work",
  physicalEnergy: "low",
  workDepth: "deep",
  dueDate: "2026-09-28",
  _subtasks: [
    { id: "later", scheduledDate: "2026-10-04" },
    { id: "earlier", scheduledDate: "2026-09-30" },
  ],
  _tags: [{ id: "tag-1", name: "Finance", color: "#123456" }],
};

function mount(
  overrides: Record<string, unknown> = {},
  onSelectToggle = jest.fn(),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <table>
        <tbody>
          <TaskTableRow
            task={{ ...task, ...overrides } as never}
            index={0}
            userId="user-one"
            todayYmd="2026-09-29"
            selected={false}
            onSelectToggle={onSelectToggle}
          />
        </tbody>
      </table>
    </QueryClientProvider>,
  );
  return {
    ...view,
    client,
    row: screen.getByText("File expenses").closest("tr")!,
    onSelectToggle,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(patchTask).mockResolvedValue({} as never);
  jest.mocked(deleteTask).mockResolvedValue({} as never);
  jest.mocked(restoreTask).mockResolvedValue({} as never);
});

test("shows overdue and next scheduled step, opens detail on row, and selection stays separate", () => {
  const { row, onSelectToggle } = mount();
  expect(row).toHaveTextContent("Overdue");
  expect(row).toHaveTextContent("Deep work");
  expect(row).toHaveTextContent("2026-09-30");
  expect(row).toHaveTextContent("Finance");
  fireEvent.click(within(row).getByRole("checkbox"));
  expect(onSelectToggle).toHaveBeenCalledWith(true);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("File expenses"));
  expect(screen.getByRole("dialog")).toHaveTextContent("Details for task-one");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("Escape leaves task details open while a form field has focus", () => {
  const { row } = mount();
  fireEvent.click(within(row).getByText("File expenses"));
  const field = document.createElement("input");
  document.body.appendChild(field);
  field.focus();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  field.remove();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test.each([
  ["backlog", "todo"],
  ["todo", "in_progress"],
  ["in_progress", "done"],
  ["done", "backlog"],
  ["unknown", "todo"],
])("status button moves %s to %s", async (status, next) => {
  const { row } = mount({ status });
  fireEvent.click(within(row).getAllByRole("button")[0]);
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith("task-one", { status: next }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("failed status change reports the error without replacing the displayed task", async () => {
  jest.mocked(patchTask).mockRejectedValue(new Error("Offline"));
  const { row } = mount();
  fireEvent.click(within(row).getAllByRole("button")[0]);
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Offline"));
  expect(row).toHaveTextContent("todo");
  expect(row).toHaveTextContent("File expenses");
});

test("individual delete needs two clicks and its undo restores exactly that task", async () => {
  const { row } = mount();
  fireEvent.click(within(row).getByTitle("Delete task"));
  expect(deleteTask).not.toHaveBeenCalled();
  fireEvent.click(within(row).getByTitle("Are you sure?"));
  await waitFor(() => expect(deleteTask).toHaveBeenCalledWith("task-one"));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      "“File expenses” deleted",
      expect.anything(),
    ),
  );
  const options = jest.mocked(toast.success).mock.calls[0][1] as {
    action: { onClick: () => void };
  };
  act(() => options.action.onClick());
  await waitFor(() => expect(restoreTask).toHaveBeenCalledWith("task-one"));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Task restored"),
  );
});

test("delete confirmation expires without deleting a task", () => {
  const { row } = mount();
  jest.useFakeTimers();
  try {
    fireEvent.click(within(row).getByTitle("Delete task"));
    expect(within(row).getByTitle("Are you sure?")).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(3000));
    expect(within(row).getByTitle("Delete task")).toBeInTheDocument();
    expect(deleteTask).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test("delete and restore failures are surfaced for recovery", async () => {
  jest
    .mocked(deleteTask)
    .mockRejectedValueOnce(new Error("Delete unavailable"))
    .mockResolvedValueOnce({} as never);
  jest.mocked(restoreTask).mockRejectedValue(new Error("Restore unavailable"));
  const { row } = mount();
  fireEvent.click(within(row).getByTitle("Delete task"));
  fireEvent.click(within(row).getByTitle("Are you sure?"));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Delete unavailable"),
  );
  fireEvent.click(within(row).getByTitle("Delete task"));
  fireEvent.click(within(row).getByTitle("Are you sure?"));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      "“File expenses” deleted",
      expect.anything(),
    ),
  );
  const options = jest.mocked(toast.success).mock.calls[0][1] as {
    action: { onClick: () => void };
  };
  act(() => options.action.onClick());
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Error: Restore unavailable"),
  );
});
