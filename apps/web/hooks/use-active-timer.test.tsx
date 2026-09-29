import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  renderHook,
  waitFor,
  render,
  screen,
  fireEvent,
} from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { toast } from "sonner";
import { fetchActiveTimer, stopTimer, startTimer } from "@/lib/api";
import { TimerButton } from "@/components/TimerButton";
import {
  formatElapsed,
  formatDuration,
  useActiveTimer,
} from "./use-active-timer";

jest.mock("@/hooks/use-app-user-id", () => ({
  useAppUserId: () => "user-one",
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));
jest.mock("@/lib/api", () => ({
  fetchActiveTimer: jest.fn(),
  startTimer: jest.fn(),
  stopTimer: jest.fn(),
}));

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client }, children);
  return { ...renderHook(() => useActiveTimer(), { wrapper }), client };
}

beforeEach(() => {
  (fetchActiveTimer as jest.Mock).mockReset();
  (stopTimer as jest.Mock).mockReset();
  jest.clearAllMocks();
});

test("awaits timer stop and reports failure without clearing the running log", async () => {
  (fetchActiveTimer as jest.Mock).mockResolvedValue({
    id: 7,
    taskId: "task-1",
    startedAt: "2026-09-29T09:00:00Z",
  });
  (stopTimer as jest.Mock).mockRejectedValue(new Error("Stop failed"));
  const { result } = setup();
  await waitFor(() => expect(result.current.activeLog?.id).toBe(7));
  await act(async () => {
    await expect(result.current.stopActiveTimer()).rejects.toThrow(
      "Stop failed",
    );
  });
  expect(stopTimer).toHaveBeenCalledWith(7);
  expect(toast.error).toHaveBeenCalledWith("Stop failed");
  expect(result.current.isRunning).toBe(true);
});

test("does not call the stop API when no timer is running", async () => {
  (fetchActiveTimer as jest.Mock).mockResolvedValue(null);
  const { result } = setup();
  await waitFor(() => expect(result.current.isRunning).toBe(false));
  await act(async () => {
    await result.current.stopActiveTimer();
  });
  expect(stopTimer).not.toHaveBeenCalled();
});

test("timer button starts and stops with fresh elapsed display and refreshes logged time", async () => {
  let running = false;
  jest.mocked(fetchActiveTimer).mockImplementation(async () =>
    running
      ? ({
          id: 8,
          taskId: "task",
          startedAt: new Date(Date.now() - 65000).toISOString(),
        } as never)
      : null,
  );
  jest.mocked(startTimer).mockImplementation(async () => {
    running = true;
    return {} as never;
  });
  jest.mocked(stopTimer).mockImplementation(async () => {
    running = false;
    return {} as never;
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = jest.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <TimerButton taskId="task" />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByTitle("Start timer"));
  await screen.findByTitle("Stop timer");
  expect(startTimer).toHaveBeenCalledWith("task");
  expect(screen.getByTitle("Stop timer")).toHaveTextContent(/00:01:/);
  fireEvent.click(screen.getByTitle("Stop timer"));
  await screen.findByTitle("Start timer");
  expect(stopTimer).toHaveBeenCalledWith(8);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["time-logs"] });
});
test("starting another task reports failure while the existing timer remains visible", async () => {
  jest.mocked(fetchActiveTimer).mockResolvedValue({
    id: 8,
    taskId: "other",
    startedAt: new Date().toISOString(),
  } as never);
  jest.mocked(startTimer).mockRejectedValue(new Error("Start failed"));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TimerButton taskId="task" compact />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByTitle("Start timer (stops current)"));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Start failed"));
  expect(screen.getByTitle("Start timer (stops current)")).toBeEnabled();
});
test.each([
  [0, "00:00:00", "0m"],
  [65, "00:01:05", "1m"],
  [3600, "01:00:00", "1h"],
  [8100, "02:15:00", "2h 15m"],
])("timer formats duration %i", (seconds, clock, human) => {
  expect(formatElapsed(seconds)).toBe(clock);
  expect(formatDuration(seconds)).toBe(human);
});
