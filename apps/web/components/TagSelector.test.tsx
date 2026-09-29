import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { createTag, fetchAllTags, setTaskTags } from "@/lib/api";
import { TagSelector } from "./TagSelector";
jest.mock("@/hooks/use-app-user-id", () => ({ useAppUserId: () => "owner" }));
jest.mock("@/lib/api", () => ({
  createTag: jest.fn(),
  fetchAllTags: jest.fn(),
  setTaskTags: jest.fn(),
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));
const tags = [
  { id: 1, name: "Home", color: null },
  { id: 2, name: "Work", color: "#06B6D4" },
];
function setup() {
  const onUpdate = jest.fn();
  render(
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
      <TagSelector taskId="task" currentTags={[tags[0]]} onUpdate={onUpdate} />
    </QueryClientProvider>,
  );
  return onUpdate;
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchAllTags).mockResolvedValue(tags as never);
  jest.mocked(setTaskTags).mockResolvedValue({ tags } as never);
});
test("opens with focus, searches existing tags, toggles ownership and closes on Escape/outside click", async () => {
  const onUpdate = setup();
  fireEvent.click(screen.getByRole("button", { name: "Tag" }));
  const search = await screen.findByPlaceholderText("Search or create…");
  expect(search).toHaveFocus();
  fireEvent.click(await screen.findByRole("button", { name: "Home" }));
  await waitFor(() => expect(setTaskTags).toHaveBeenCalledWith("task", []));
  fireEvent.change(search, { target: { value: "work" } });
  expect(
    screen.queryByRole("button", { name: "Home" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/Create/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Work" }));
  await waitFor(() => expect(setTaskTags).toHaveBeenCalledWith("task", [1, 2]));
  expect(onUpdate).toHaveBeenCalledWith(tags);
  fireEvent.keyDown(search, { key: "Escape" });
  expect(
    screen.queryByPlaceholderText("Search or create…"),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tag" }));
  fireEvent.mouseDown(document.body);
  expect(
    screen.queryByPlaceholderText("Search or create…"),
  ).not.toBeInTheDocument();
});
test("failed creation preserves the name, retry creates and attaches the new tag", async () => {
  jest
    .mocked(createTag)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({
      tag: { id: 3, name: "Errands", color: "#EF4444" },
    } as never);
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Tag" }));
  const search = screen.getByPlaceholderText("Search or create…");
  fireEvent.change(search, { target: { value: "  Errands  " } });
  fireEvent.keyDown(search, { key: "Enter" });
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Offline"));
  expect(search).toHaveValue("  Errands  ");
  fireEvent.click(screen.getByRole("button", { name: 'Create "Errands"' }));
  await waitFor(() => expect(setTaskTags).toHaveBeenCalledWith("task", [1, 3]));
  expect(search).toHaveValue("");
  expect(createTag).toHaveBeenLastCalledWith({
    name: "Errands",
    color: "#EF4444",
  });
});
test("tag assignment failures are reported and empty catalogs are explicit", async () => {
  jest.mocked(setTaskTags).mockRejectedValue(new Error("Assignment failed"));
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Tag" }));
  fireEvent.click(await screen.findByRole("button", { name: "Home" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Assignment failed"),
  );
});
