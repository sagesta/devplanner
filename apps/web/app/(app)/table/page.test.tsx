import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { toast } from "sonner";
import {
  deleteTask,
  fetchSprints,
  fetchTasks,
  patchTask,
  postBulkStatus,
  restoreTask,
} from "@/lib/api";
import TablePage from "./page";
jest.mock("@/hooks/use-auth-status", () => ({
  useAuthStatus: () => ({ status: "authenticated" }),
}));
jest.mock("@/hooks/use-app-user-id", () => ({
  useAppUserId: () => "user-one",
}));
jest.mock("@/components/TimerButton", () => ({ TimerButton: () => null }));
jest.mock("@/components/TaskDetailPanel", () => ({
  TaskDetailPanel: () => null,
}));
jest.mock("@/lib/api", () => ({
  deleteTask: jest.fn(),
  fetchSprints: jest.fn(),
  fetchTasks: jest.fn(),
  patchTask: jest.fn(),
  postBulkStatus: jest.fn(),
  restoreTask: jest.fn(),
}));
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));
const tasks = [
  {
    id: "task-z",
    title: "Zebra delivery",
    sprintId: "active",
    status: "todo",
    priority: "low",
    energyLevel: "shallow",
    dueDate: "2026-10-02",
    _subtasks: [],
    _tags: [],
  },
  {
    id: "task-a",
    title: "Alpha delivery",
    sprintId: "active",
    status: "in_progress",
    priority: "urgent",
    energyLevel: "deep_work",
    dueDate: null,
    _subtasks: [],
    _tags: [],
  },
  {
    id: "task-inbox",
    title: "Inbox delivery",
    sprintId: null,
    status: "backlog",
    priority: "normal",
    energyLevel: "admin",
    dueDate: "2026-10-01",
    _subtasks: [],
    _tags: [],
  },
];
async function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TablePage />
    </QueryClientProvider>,
  );
  await screen.findByText("Zebra delivery");
  return client;
}
const row = (title: string) => screen.getByText(title).closest("tr")!;
const select = (title: string) =>
  fireEvent.click(within(row(title)).getByRole("checkbox"));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchTasks).mockResolvedValue(tasks as never);
  jest.mocked(fetchSprints).mockResolvedValue({
    sprints: [
      { id: "active", name: "Current sprint", status: "active" },
      { id: "empty", name: "Empty sprint", status: "planned" },
    ],
  } as never);
});
test("active sprint defaults and sorting work in both directions", async () => {
  await setup();
  expect(screen.getByLabelText("Sprint")).toHaveValue("active");
  expect(screen.queryByText("Inbox delivery")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Title", { selector: "th span" }));
  expect(screen.getAllByRole("row")[1]).toHaveTextContent("Alpha delivery");
  fireEvent.click(screen.getByText("Title", { selector: "th span" }));
  expect(screen.getAllByRole("row")[1]).toHaveTextContent("Zebra delivery");
  fireEvent.click(screen.getByText("Priority", { selector: "th span" }));
  expect(screen.getAllByRole("row")[1]).toHaveTextContent("Alpha delivery");
});
test("sprint changes clear selections and removed sprint falls back to all", async () => {
  const client = await setup();
  select("Zebra delivery");
  expect(screen.getByText("1 selected")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Sprint"), {
    target: { value: "none" },
  });
  expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
  expect(screen.getByText("Inbox delivery")).toBeInTheDocument();
  expect(screen.queryByText("Zebra delivery")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Sprint"), {
    target: { value: "empty" },
  });
  expect(screen.queryByText("Inbox delivery")).not.toBeInTheDocument();
  act(() => client.setQueryData(["sprints", "user-one"], { sprints: [] }));
  await waitFor(() =>
    expect(screen.getByLabelText("Sprint")).toHaveValue("all"),
  );
  expect(screen.getByText("Inbox delivery")).toBeInTheDocument();
});
test("bulk status failure retains selected tasks for retry", async () => {
  jest
    .mocked(postBulkStatus)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({ updated: 1 });
  await setup();
  select("Zebra delivery");
  fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Offline"));
  expect(screen.getByText("1 selected")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Mark todo" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Updated 1 tasks"),
  );
  expect(postBulkStatus).toHaveBeenNthCalledWith(1, ["task-z"], "done");
  expect(postBulkStatus).toHaveBeenNthCalledWith(2, ["task-z"], "todo");
  expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
});
test("bulk delete requires confirmation and undo restores exactly selected tasks", async () => {
  jest.mocked(deleteTask).mockResolvedValue({} as never);
  jest.mocked(restoreTask).mockResolvedValue({} as never);
  await setup();
  select("Alpha delivery");
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(deleteTask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    screen.queryByRole("button", { name: "Confirm" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      "Deleted 1 task(s)",
      expect.anything(),
    ),
  );
  expect(deleteTask).toHaveBeenCalledWith("task-a");
  const options = jest.mocked(toast.success).mock.calls[0][1] as {
    action: { onClick: () => void };
  };
  act(() => options.action.onClick());
  await waitFor(() => expect(restoreTask).toHaveBeenCalledWith("task-a"));
});
test("individual status failure keeps original row and reports error", async () => {
  jest.mocked(patchTask).mockRejectedValue(new Error("Status unavailable"));
  await setup();
  fireEvent.click(within(row("Zebra delivery")).getAllByRole("button")[0]);
  await waitFor(() =>
    expect(patchTask).toHaveBeenCalledWith("task-z", { status: "in_progress" }),
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Status unavailable"),
  );
  expect(row("Zebra delivery")).toHaveTextContent("todo");
});
