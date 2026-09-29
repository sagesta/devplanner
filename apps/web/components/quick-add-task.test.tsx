import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QuickAddTask } from "./quick-add-task";
import { captureDaily, newIdempotencyKey } from "@/lib/daily-api";

let mockUserId: string | undefined = "user-one";
jest.mock("@/hooks/use-app-user-id", () => ({
  useAppUserId: () => mockUserId,
}));
jest.mock("@/lib/daily-api", () => ({
  captureDaily: jest.fn(),
  newIdempotencyKey: jest.fn(() => "retry-key-one"),
}));
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() },
}));

const captureMock = captureDaily as jest.Mock;
const newKeyMock = newIdempotencyKey as jest.Mock;
function setup(open = true, onClose = jest.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <QuickAddTask open={open} onClose={onClose} initialDate="2026-09-29" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockUserId = "user-one";
  localStorage.clear();
  captureMock.mockReset();
  newKeyMock.mockReset().mockReturnValue("retry-key-one");
});

test("restores a user-scoped draft and keeps it when the dialog closes", async () => {
  localStorage.setItem(
    "devplanner.quickAdd.v1.user-one",
    JSON.stringify({ title: "Study Python", destination: "inbox", key: null }),
  );
  const onClose = jest.fn();
  setup(true, onClose);
  expect(await screen.findByDisplayValue("Study Python")).toBeInTheDocument();
  expect(
    screen.getByText(/Draft restored from this device/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalled();
  expect(
    JSON.parse(localStorage.getItem("devplanner.quickAdd.v1.user-one") ?? "{}")
      .title,
  ).toBe("Study Python");
});

test("keeps the same idempotency key after a failed save and clears draft after confirmation", async () => {
  captureMock
    .mockRejectedValueOnce(new Error("Network lost"))
    .mockResolvedValueOnce({
      created: 1,
      tasks: [{ id: "task-1", revision: 1, areaId: "general" }],
    });
  setup();
  const input = await screen.findByPlaceholderText("What needs doing?");
  fireEvent.change(input, { target: { value: "Pay rent" } });
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
  await waitFor(() => expect(captureMock).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Add task" })).toBeEnabled(),
  );
  expect((input as HTMLInputElement).value).toBe("Pay rent");
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
  await waitFor(() => expect(captureMock).toHaveBeenCalledTimes(2));
  expect(captureMock.mock.calls[0][1]).toBe("retry-key-one");
  expect(captureMock.mock.calls[1][1]).toBe("retry-key-one");
  await waitFor(() =>
    expect(localStorage.getItem("devplanner.quickAdd.v1.user-one")).toBeNull(),
  );
});

test("uses a new key when Today changes after a failed request", async () => {
  newKeyMock
    .mockReturnValueOnce("day-one-key")
    .mockReturnValueOnce("day-two-key");
  captureMock.mockRejectedValue(new Error("Network lost"));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const dialog = (date: string) => (
    <QueryClientProvider client={client}>
      <QuickAddTask
        open
        onClose={jest.fn()}
        initialDate={date}
        defaultDestination="today"
      />
    </QueryClientProvider>
  );
  const view = render(dialog("2026-09-29"));
  fireEvent.change(await screen.findByPlaceholderText("What needs doing?"), {
    target: { value: "Write report" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
  await waitFor(() => expect(captureMock).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Add task" })).toBeEnabled(),
  );
  view.rerender(dialog("2026-09-30"));
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
  await waitFor(() => expect(captureMock).toHaveBeenCalledTimes(2));
  expect(captureMock.mock.calls[0][0][0].scheduledDate).toBe("2026-09-29");
  expect(captureMock.mock.calls[1][0][0].scheduledDate).toBe("2026-09-30");
  expect(captureMock.mock.calls[0][1]).toBe("day-one-key");
  expect(captureMock.mock.calls[1][1]).toBe("day-two-key");
});

test("destination changes, discard and multiline action remain explicit", async () => {
  const close = jest.fn(),
    multiple = jest.fn();
  window.addEventListener("devplanner:open-brain-dump", multiple);
  setup(true, close);
  const input = await screen.findByLabelText("Task");
  fireEvent.change(input, { target: { value: "Draft" } });
  fireEvent.change(screen.getByLabelText("Put it in"), {
    target: { value: "today" },
  });
  expect(screen.getByLabelText("Put it in")).toHaveValue("today");
  fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
  expect(input).toHaveValue("");
  expect(localStorage.getItem("devplanner.quickAdd.v1.user-one")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add multiple tasks" }));
  expect(close).toHaveBeenCalled();
  expect(multiple).toHaveBeenCalledTimes(1);
  window.removeEventListener("devplanner:open-brain-dump", multiple);
});
test("dialog traps both tab boundaries and dismisses only background clicks or Escape", async () => {
  const close = jest.fn();
  setup(true, close);
  const input = await screen.findByLabelText("Task");
  fireEvent.change(input, { target: { value: "Keep me" } });
  input.focus();
  fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
  expect(screen.getByRole("button", { name: "Add task" })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "Tab" });
  expect(input).toHaveFocus();
  fireEvent.mouseDown(screen.getByRole("dialog"));
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(1);
  fireEvent.mouseDown(screen.getByRole("presentation"));
  expect(close).toHaveBeenCalledTimes(2);
});
test("storage failure warns but does not prevent acknowledged server capture", async () => {
  const get = jest
    .spyOn(Storage.prototype, "getItem")
    .mockImplementation(() => {
      throw new Error("Blocked");
    });
  const set = jest
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("Full");
    });
  const remove = jest
    .spyOn(Storage.prototype, "removeItem")
    .mockImplementation(() => {
      throw new Error("Blocked");
    });
  captureMock.mockResolvedValue({ created: 1, tasks: [] });
  const close = jest.fn();
  setup(true, close);
  fireEvent.change(await screen.findByLabelText("Task"), {
    target: { value: "Still save" },
  });
  expect(
    screen.getByText(/Local draft recovery is unavailable/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  get.mockRestore();
  set.mockRestore();
  remove.mockRestore();
});
test("account switch preserves both recovery records and ignores an old save acknowledgement", async () => {
  let resolve!: (value: unknown) => void;
  captureMock.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  localStorage.setItem(
    "devplanner.quickAdd.v1.user-two",
    JSON.stringify({ title: "Second account draft", destination: "inbox" }),
  );
  const close = jest.fn();
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const tree = () => (
    <QueryClientProvider client={client}>
      <QuickAddTask open onClose={close} initialDate="2026-09-29" />
    </QueryClientProvider>
  );
  const view = render(tree());
  fireEvent.change(await screen.findByLabelText("Task"), {
    target: { value: "First account draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
  await waitFor(() => expect(captureMock).toHaveBeenCalled());
  mockUserId = "user-two";
  view.rerender(tree());
  await screen.findByDisplayValue("Second account draft");
  await act(async () => {
    resolve({ created: 1, tasks: [] });
  });
  expect(screen.getByLabelText("Task")).toHaveValue("Second account draft");
  expect(close).not.toHaveBeenCalled();
  expect(
    JSON.parse(localStorage.getItem("devplanner.quickAdd.v1.user-one")!).title,
  ).toBe("First account draft");
});
test("restored Today draft waits for its date and signed-out capture cannot submit", async () => {
  localStorage.setItem(
    "devplanner.quickAdd.v1.user-one",
    JSON.stringify({ title: "Later today", destination: "today" }),
  );
  const client = new QueryClient();
  const tree = () => (
    <QueryClientProvider client={client}>
      <QuickAddTask open onClose={jest.fn()} />
    </QueryClientProvider>
  );
  const view = render(tree());
  await screen.findByDisplayValue("Later today");
  expect(screen.getByRole("button", { name: "Add task" })).toBeDisabled();
  expect(screen.getByLabelText("Put it in")).toBeDisabled();
  mockUserId = undefined;
  view.rerender(tree());
  expect(screen.getByLabelText("Task")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Add task" })).toBeDisabled();
  expect(captureMock).not.toHaveBeenCalled();
});
test("closed capture dialog renders nothing and incomplete old envelopes restore safely", async () => {
  const view = setup(false);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  view.unmount();
  localStorage.setItem("devplanner.quickAdd.v1.user-one", "{}");
  setup();
  expect(await screen.findByLabelText("Task")).toHaveValue("");
  expect(screen.getByLabelText("Put it in")).toHaveValue("inbox");
});
