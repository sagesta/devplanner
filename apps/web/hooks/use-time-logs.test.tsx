import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { deleteTimeLog, fetchTimeLogs } from "@/lib/api";
import { useTimeLogs } from "./use-time-logs";
jest.mock("@/hooks/use-app-user-id", () => ({ useAppUserId: () => "owner" }));
jest.mock("@/lib/api", () => ({
  deleteTimeLog: jest.fn(),
  fetchTimeLogs: jest.fn(),
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));
function setup(task = "task") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => useTimeLogs(task), { wrapper }), client };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchTimeLogs).mockResolvedValue([{ id: 1 }] as never);
});
test("deleting a log refreshes task time, weekly summaries and active timer", async () => {
  jest.mocked(deleteTimeLog).mockResolvedValue({} as never);
  const { result, client } = setup();
  const invalidate = jest.spyOn(client, "invalidateQueries");
  await waitFor(() => expect(result.current.logs).toHaveLength(1));
  act(() => result.current.deleteLog(1));
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["time-logs", "week-summary"],
    }),
  );
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["time-logs", "task"] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["active-timer"] });
});
test("deletion failure retains visible logs and shows an error", async () => {
  jest.mocked(deleteTimeLog).mockRejectedValue(new Error("Delete offline"));
  const { result } = setup();
  await waitFor(() => expect(result.current.logs).toHaveLength(1));
  act(() => result.current.deleteLog(1));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Delete offline"),
  );
  expect(result.current.logs).toHaveLength(1);
});
test("empty task selection does not fetch unrelated logs", () => {
  const { result } = setup("");
  expect(fetchTimeLogs).not.toHaveBeenCalled();
  expect(result.current.logs).toEqual([]);
});
