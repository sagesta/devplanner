import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useTaskSse } from "./use-sse";

const getToken = jest.fn<Promise<string | null>, []>();
let auth = { isLoaded: true, isSignedIn: true, userId: "alice", getToken };
jest.mock("@clerk/nextjs", () => ({ useAuth: () => auth }));
jest.mock("@/lib/env", () => ({
  getApiBase: () => "https://api.example.test",
}));

type Listener = (event: { data?: string }) => void;
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, Listener>();
  close = jest.fn();
  constructor(
    public url: string,
    public options: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, listener);
  }
  emit(type: string, data?: string) {
    this.listeners.get(type)?.({ data });
  }
}

function Probe({ onIdle }: { onIdle: jest.Mock }) {
  const { connected } = useTaskSse(onIdle);
  return <span>{connected ? "connected" : "disconnected"}</span>;
}

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  FakeEventSource.instances = [];
  getToken.mockResolvedValue("first token");
  auth = { isLoaded: true, isSignedIn: true, userId: "alice", getToken };
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    writable: true,
    value: FakeEventSource,
  });
});

afterEach(() => jest.useRealTimers());

test("authenticates the stream, ignores bad events, and uses the latest callback", async () => {
  const first = jest.fn();
  const second = jest.fn();
  const view = render(<Probe onIdle={first} />);
  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
  const stream = FakeEventSource.instances[0];
  expect(stream.url).toBe(
    "https://api.example.test/api/events/user?auth_token=first%20token",
  );
  expect(stream.options).toEqual({ withCredentials: true });
  act(() => stream.emit("open"));
  expect(screen.getByText("connected")).toBeInTheDocument();
  view.rerender(<Probe onIdle={second} />);
  act(() => {
    stream.emit("message", "invalid json");
    stream.emit(
      "message",
      JSON.stringify({ type: "other", taskId: "x", title: "Ignore" }),
    );
    stream.emit(
      "message",
      JSON.stringify({
        type: "idle_task",
        taskId: "task-1",
        title: "Resume work",
      }),
    );
  });
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledWith({
    taskId: "task-1",
    title: "Resume work",
    message: "",
  });
  view.unmount();
  expect(stream.close).toHaveBeenCalledTimes(1);
});

test("reconnects with a fresh token after errors and cancels a scheduled retry on sign-out", async () => {
  getToken.mockResolvedValueOnce("one").mockResolvedValueOnce("two");
  const view = render(<Probe onIdle={jest.fn()} />);
  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
  const first = FakeEventSource.instances[0];
  jest.useFakeTimers();
  act(() => first.emit("open"));
  act(() => first.emit("error"));
  expect(first.close).toHaveBeenCalledTimes(1);
  expect(screen.getByText("disconnected")).toBeInTheDocument();
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(FakeEventSource.instances).toHaveLength(2);
  const second = FakeEventSource.instances[1];
  expect(second.url).toContain("auth_token=two");
  act(() => second.emit("error"));
  auth = { ...auth, isSignedIn: false };
  view.rerender(<Probe onIdle={jest.fn()} />);
  expect(second.close).toHaveBeenCalledTimes(1);
  const count = FakeEventSource.instances.length;
  await act(async () => {
    jest.advanceTimersByTime(2100);
  });
  expect(FakeEventSource.instances).toHaveLength(count);
});

test("does not open a stream if token resolution completes after unmount", async () => {
  let resolveToken!: (token: string) => void;
  getToken.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveToken = resolve;
      }),
  );
  const view = render(<Probe onIdle={jest.fn()} />);
  expect(getToken).toHaveBeenCalledTimes(1);
  view.unmount();
  await act(async () => resolveToken("late"));
  expect(FakeEventSource.instances).toHaveLength(0);
});
