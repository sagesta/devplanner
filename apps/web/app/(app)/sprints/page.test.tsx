import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SprintsPage from "./page";
import * as api from "@/lib/api";
import { toast } from "sonner";
jest.mock("@/hooks/use-app-user-id", () => ({ useAppUserId: () => "owner" }));
jest.mock("@/hooks/use-auth-status", () => ({
  useAuthStatus: () => ({ status: "authenticated" }),
}));
jest.mock("@/components/priority-anchors-card", () => ({
  PriorityAnchorsCard: () => null,
}));
jest.mock("@/lib/api", () => ({
  fetchSprints: jest.fn(),
  createSprint: jest.fn(),
  patchSprint: jest.fn(),
  deleteSprint: jest.fn(),
  fetchTasks: jest.fn(),
  fetchAreas: jest.fn(),
  createTask: jest.fn(),
  patchTask: jest.fn(),
}));
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));
const sprint = {
  id: "week",
  name: "October focus",
  startDate: "2026-10-01",
  endDate: "2026-10-07",
  status: "active",
  goal: null,
};
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SprintsPage />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(api.fetchSprints)
    .mockResolvedValue({ sprints: [sprint] } as Awaited<
      ReturnType<typeof api.fetchSprints>
    >);
  jest.mocked(api.fetchTasks).mockResolvedValue([]);
  jest.mocked(api.fetchAreas).mockResolvedValue([]);
});
test("new sprint validates calendar range and keeps failed input for retry", async () => {
  jest
    .mocked(api.createSprint)
    .mockRejectedValueOnce(new Error("Temporary save failure"))
    .mockResolvedValue({ sprint } as Awaited<
      ReturnType<typeof api.createSprint>
    >);
  setup();
  await screen.findByText("October focus");
  fireEvent.click(screen.getByRole("button", { name: "New sprint" }));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "  Personal week  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create sprint" }));
  expect(api.createSprint).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Start date")).toHaveFocus();
  fireEvent.change(screen.getByLabelText("Start date"), {
    target: { value: "2026-10-05" },
  });
  fireEvent.change(screen.getByLabelText("End date"), {
    target: { value: "2026-10-04" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create sprint" }));
  expect(
    screen.getByText("End date must be on or after start date."),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText("End date"), {
    target: { value: "2026-10-11" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create sprint" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Temporary save failure"),
  );
  expect(screen.getByLabelText("Name")).toHaveValue("  Personal week  ");
  fireEvent.click(screen.getByRole("button", { name: "Create sprint" }));
  await waitFor(() => expect(screen.queryByLabelText("Name")).toBeNull());
  expect(api.createSprint).toHaveBeenLastCalledWith({
    name: "Personal week",
    startDate: "2026-10-05",
    endDate: "2026-10-11",
    goal: null,
    status: "active",
  });
});
test("rename submits explicit Enter, Escape cancels, and deletion requires confirmation", async () => {
  jest
    .mocked(api.patchSprint)
    .mockResolvedValue({ sprint } as Awaited<
      ReturnType<typeof api.patchSprint>
    >);
  jest
    .mocked(api.deleteSprint)
    .mockRejectedValue(new Error("Cannot delete now"));
  setup();
  await screen.findByText("October focus");
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Sprint name" }), {
    target: { value: "Changed" },
  });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Sprint name" }), {
    key: "Escape",
  });
  expect(api.patchSprint).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Sprint name" }), {
    target: { value: "  Revised focus  " },
  });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Sprint name" }), {
    key: "Enter",
  });
  await waitFor(() =>
    expect(api.patchSprint).toHaveBeenCalledWith("week", {
      name: "Revised focus",
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("textbox", { name: "Sprint name" })).toBeNull(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(api.deleteSprint).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(api.deleteSprint).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete sprint" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Cannot delete now"),
  );
  expect(screen.getByText("October focus")).toBeVisible();
});
test("failed list fetch offers retry instead of pretending the account is empty", async () => {
  jest
    .mocked(api.fetchSprints)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ sprints: [sprint] } as Awaited<
      ReturnType<typeof api.fetchSprints>
    >);
  setup();
  await screen.findByRole("alert");
  fireEvent.click(
    screen.getByRole("button", { name: "Retry loading sprints" }),
  );
  await screen.findByText("October focus");
  expect(screen.queryByRole("alert")).toBeNull();
});
test("sprint planning moves existing tasks, retries creation and returns to the list", async () => {
  jest.mocked(api.fetchTasks).mockResolvedValue([
    { id: "inbox", title: "Inbox item", sprintId: null },
    { id: "scheduled", title: "Sprint item", sprintId: "week" },
    { id: "elsewhere", title: "Other sprint item", sprintId: "other" },
  ] as never);
  jest.mocked(api.fetchAreas).mockResolvedValue([{ id: "area" }] as never);
  jest.mocked(api.patchTask).mockResolvedValue({} as never);
  jest
    .mocked(api.createTask)
    .mockRejectedValueOnce(new Error("Create offline"))
    .mockResolvedValue({} as never);
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "View tasks" }));
  await screen.findByText("Inbox item");
  expect(screen.queryByText("Other sprint item")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add to sprint →" }));
  await waitFor(() =>
    expect(api.patchTask).toHaveBeenCalledWith("inbox", { sprintId: "week" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() =>
    expect(api.patchTask).toHaveBeenCalledWith("scheduled", { sprintId: null }),
  );
  const title = screen.getByPlaceholderText("Add task to this sprint…");
  fireEvent.change(title, { target: { value: "  New task  " } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Create offline"),
  );
  expect(title).toHaveValue("  New task  ");
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(title).toHaveValue(""));
  expect(api.createTask).toHaveBeenLastCalledWith({
    areaId: "area",
    title: "New task",
    sprintId: "week",
    status: "todo",
  });
  fireEvent.click(screen.getByRole("button", { name: "Back to sprints" }));
  await screen.findByRole("button", { name: "New sprint" });
});
test("planning errors preserve tasks and explain missing areas", async () => {
  jest
    .mocked(api.fetchTasks)
    .mockResolvedValue([
      { id: "inbox", title: "Inbox item", sprintId: null },
    ] as never);
  jest.mocked(api.patchTask).mockRejectedValue(new Error("Move offline"));
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "View tasks" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Add to sprint →" }),
  );
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Move offline"));
  const title = screen.getByPlaceholderText("Add task to this sprint…");
  fireEvent.change(title, { target: { value: "Keep draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Create an Area in Settings first.",
    ),
  );
  expect(title).toHaveValue("Keep draft");
  expect(api.createTask).not.toHaveBeenCalled();
});
test.each([
  ["active", "Deactivate", "planned"],
  ["active", "Mark completed", "completed"],
  ["planned", "Set active", "active"],
  ["completed", "Reopen", "planned"],
])(
  "sprint lifecycle %s -> %s sends explicit status",
  async (status, label, next) => {
    jest
      .mocked(api.fetchSprints)
      .mockResolvedValue({ sprints: [{ ...sprint, status }] } as never);
    jest.mocked(api.patchSprint).mockResolvedValue({ sprint } as never);
    setup();
    fireEvent.click(await screen.findByRole("button", { name: label }));
    await waitFor(() =>
      expect(api.patchSprint).toHaveBeenCalledWith("week", { status: next }),
    );
  },
);
