import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import * as api from "@/lib/api";
import { useTags } from "./use-tags";
jest.mock("@/hooks/use-app-user-id", () => ({ useAppUserId: () => "owner" }));
jest.mock("@/lib/api", () => ({
  createTag: jest.fn(),
  deleteTag: jest.fn(),
  fetchAllTags: jest.fn(),
  setTaskTags: jest.fn(),
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => useTags(), { wrapper }), client };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(api.fetchAllTags)
    .mockResolvedValue([{ id: 1, name: "Home", color: null }] as never);
});
test("tag edits refresh the catalog and assigned task queries", async () => {
  jest.mocked(api.createTag).mockResolvedValue({} as never);
  jest.mocked(api.deleteTag).mockResolvedValue({} as never);
  jest.mocked(api.setTaskTags).mockResolvedValue({ tags: [] } as never);
  const { result, client } = setup();
  const invalidate = jest.spyOn(client, "invalidateQueries");
  await waitFor(() => expect(result.current.tags).toHaveLength(1));
  act(() => result.current.createTag({ name: "Work", color: "#06B6D4" }));
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["all-tags"] }),
  );
  act(() => result.current.setTaskTags({ taskId: "task", tagIds: [1] }));
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["tasks-today", "owner"],
    }),
  );
  invalidate.mockClear();
  act(() => result.current.deleteTag(1));
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["all-tags"] }),
  );
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tasks", "owner"] });
});
test("all failed tag mutations expose a recoverable error", async () => {
  jest.mocked(api.createTag).mockRejectedValue(new Error("Create failed"));
  jest.mocked(api.deleteTag).mockRejectedValue(new Error("Delete failed"));
  jest.mocked(api.setTaskTags).mockRejectedValue(new Error("Assign failed"));
  const { result } = setup();
  await waitFor(() => expect(result.current.tags).toHaveLength(1));
  act(() => result.current.createTag({ name: "Work", color: "#000000" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Create failed"),
  );
  act(() => result.current.deleteTag(1));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Delete failed"),
  );
  act(() => result.current.setTaskTags({ taskId: "task", tagIds: [] }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Assign failed"),
  );
});
