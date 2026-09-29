import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { createTask } from "@/lib/api";
import { InlineAddTask } from "./InlineAddTask";
jest.mock("@/lib/api", () => ({ createTask: jest.fn() }));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));
function setup() {
  const onDone = jest.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <InlineAddTask
        userId="owner"
        areaId="area"
        sprintId="sprint"
        status="todo"
        onDone={onDone}
      />
    </QueryClientProvider>,
  );
  return onDone;
}
beforeEach(() => jest.clearAllMocks());
test("title-only capture retries without losing text, resets and refocuses after success", async () => {
  jest
    .mocked(createTask)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({} as never);
  setup();
  const title = screen.getByPlaceholderText("Task title…");
  fireEvent.keyDown(title, { key: "Enter" });
  expect(createTask).not.toHaveBeenCalled();
  fireEvent.change(title, { target: { value: "  Call plumber  " } });
  fireEvent.keyDown(title, { key: "Enter" });
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Offline"));
  expect(title).toHaveValue("  Call plumber  ");
  fireEvent.keyDown(title, { key: "Enter" });
  await waitFor(() => expect(title).toHaveValue(""));
  expect(title).toHaveFocus();
  expect(createTask).toHaveBeenLastCalledWith({
    areaId: "area",
    sprintId: "sprint",
    status: "todo",
    title: "Call plumber",
    scheduledStartTime: null,
    scheduledEndTime: null,
    recurrenceRule: null,
  });
});
test("optional scheduling survives inner focus changes and Escape closes without submitting", async () => {
  jest.mocked(createTask).mockResolvedValue({} as never);
  const done = setup();
  const title = screen.getByPlaceholderText("Task title…");
  fireEvent.change(title, { target: { value: "Exercise" } });
  const details = screen.getByRole("button", {
    name: "Date & time (optional)",
  });
  fireEvent.blur(title, { relatedTarget: details });
  expect(createTask).not.toHaveBeenCalled();
  fireEvent.click(details);
  for (const [label, value] of [
    ["Day", "2026-10-03"],
    ["Start", "09:00"],
    ["End", "09:30"],
    ["Recurrence", "FREQ=DAILY"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.keyDown(title, { key: "Enter" });
  await waitFor(() =>
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduledDate: "2026-10-03",
        scheduledStartTime: "09:00:00",
        scheduledEndTime: "09:30:00",
        recurrenceRule: "FREQ=DAILY",
      }),
    ),
  );
  fireEvent.keyDown(title, { key: "Escape" });
  expect(done).toHaveBeenCalledTimes(1);
});
