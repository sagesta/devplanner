import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TaskCard, SubtaskBar, StatusDot } from "./task-card";
import { toast } from "sonner";
jest.mock("sonner", () => ({ toast: { success: jest.fn() } }));
jest.mock("./TimerButton", () => ({
  TimerButton: ({ taskId }: { taskId: string }) => (
    <button>Timer {taskId}</button>
  ),
}));
const base = {
  title: "Concrete task",
  status: "todo",
  priority: "normal",
  energyLevel: "shallow",
};
test("priority menu selects a value and closes on outside click or scroll", () => {
  const onPriorityChange = jest.fn();
  render(<TaskCard {...base} onPriorityChange={onPriorityChange} />);
  fireEvent.click(screen.getByRole("button", { name: "normal ▾" }));
  fireEvent.click(screen.getByRole("button", { name: "urgent" }));
  expect(onPriorityChange).toHaveBeenCalledWith("urgent");
  expect(
    screen.queryByRole("button", { name: "urgent" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "normal ▾" }));
  fireEvent.mouseDown(document.body);
  expect(
    screen.queryByRole("button", { name: "urgent" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "normal ▾" }));
  fireEvent.scroll(document);
  expect(
    screen.queryByRole("button", { name: "urgent" }),
  ).not.toBeInTheDocument();
});
test("keyboard-friendly status advance and select dispatch explicit actions without card clicks", async () => {
  const cycle = jest.fn(),
    select = jest.fn(),
    parent = jest.fn();
  render(
    <div onClick={parent}>
      <TaskCard
        {...base}
        onStatusCycle={cycle}
        boardStatuses={["todo", "done"]}
        onBoardStatusSelect={select}
      />
    </div>,
  );
  fireEvent.pointerDown(screen.getByTitle("Status: todo"));
  fireEvent.pointerDown(screen.getByLabelText("Cycle status"));
  fireEvent.click(screen.getByLabelText("Cycle status"));
  expect(cycle).toHaveBeenCalledTimes(1);
  expect(parent).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Status updated", {
      id: "status-cycle",
    }),
  );
  const dropdown = screen.getByLabelText("Change status");
  fireEvent.pointerDown(dropdown);
  fireEvent.click(dropdown);
  fireEvent.change(dropdown, { target: { value: "done" } });
  expect(select).toHaveBeenCalledWith("done");
  expect(parent).not.toHaveBeenCalled();
});
test("completed compact cards retain deadline, subtask progress, tags and timer context", () => {
  render(
    <TaskCard
      {...base}
      status="done"
      priority="high"
      compact
      overdue
      dueDate="2026-09-20"
      areaColor="#06B6D4"
      areaName="Work"
      depthLabel="deep"
      energyLabel="low"
      subtasksTotal={4}
      subtasksDone={3}
      taskId="task"
      tags={[1, 2, 3, 4].map((id) => ({ id, name: `Tag ${id}`, color: null }))}
    />,
  );
  expect(screen.getByText("Concrete task")).toHaveClass("line-through");
  expect(screen.getByText("Overdue")).toBeInTheDocument();
  expect(screen.getByText("3/4")).toBeInTheDocument();
  expect(screen.getByText("+1")).toBeInTheDocument();
  expect(screen.queryByText("Tag 4")).not.toBeInTheDocument();
  expect(screen.getByTitle("Due Date")).toHaveTextContent("2026-09-20");
  expect(
    screen.getByRole("button", { name: "Timer task" }),
  ).toBeInTheDocument();
});
test("fallback task values and empty progress remain readable", () => {
  render(
    <>
      <TaskCard {...base} priority="legacy" status="legacy" subtasksTotal={2} />
      <SubtaskBar done={0} total={0} />
      <StatusDot status="blocked" />
    </>,
  );
  expect(screen.getByText("D:normal")).toBeInTheDocument();
  expect(screen.getByText("E:medium")).toBeInTheDocument();
  expect(screen.getByText("0/2")).toBeInTheDocument();
  expect(screen.getByText("0/0")).toBeInTheDocument();
  expect(screen.queryByLabelText("Cycle status")).not.toBeInTheDocument();
});
