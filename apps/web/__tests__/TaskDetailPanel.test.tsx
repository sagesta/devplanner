import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TaskDetailPanel } from "../components/TaskDetailPanel";
import * as api from "../lib/api";

jest.mock("../lib/api");

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const mockTaskInfo = {
  task: {
    id: "task-1",
    title: "Test task",
    description: "Task description",
    status: "todo",
    priority: "normal",
    energyLevel: "deep_work",
    workDepth: "deep",
    physicalEnergy: "low",
    areaId: "area-1",
    dueDate: "2024-01-01",
    _tags: [],
  },
  subtasks: [],
  subtaskProgress: { done: 0, total: 0 }
};

describe("TaskDetailPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.fetchTaskDetail as jest.Mock).mockResolvedValue(mockTaskInfo);
    (api.fetchAreas as jest.Mock).mockResolvedValue([]);
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <TaskDetailPanel taskId="task-1" userId="user-1" isOpen={false} onClose={jest.fn()} />
      </QueryClientProvider>
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders task title when open", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <TaskDetailPanel taskId="task-1" userId="user-1" isOpen={true} onClose={jest.fn()} />
      </QueryClientProvider>
    );
    
    // Check loading state then title
    await waitFor(() => {
      expect(screen.getByDisplayValue("Test task")).toBeInTheDocument();
    });
  });

  it("calls onClose when the close button is clicked", async () => {
    const handleClose = jest.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <TaskDetailPanel taskId="task-1" userId="user-1" isOpen={true} onClose={handleClose} />
      </QueryClientProvider>
    );

    const closeButton = await screen.findByText("Close");
    fireEvent.click(closeButton);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
