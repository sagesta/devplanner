import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KanbanBoard } from "../components/kanban-board";
import * as api from "../lib/api";

jest.mock("../lib/api");

jest.mock("next-auth/react", () => ({
  useSession: () => ({ status: "authenticated" }),
}));

jest.mock("../hooks/use-app-user-id", () => ({
  useAppUserId: () => "user-1",
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

describe("KanbanBoard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.fetchAreas as jest.Mock).mockResolvedValue([]);
    (api.fetchSprints as jest.Mock).mockResolvedValue({
      sprints: [{ id: "s1", status: "active", name: "Sprint 1", startDate: "2024-01-01", endDate: "2024-01-14" }],
    });
    // This mocks the fetchTasks which relies on activeSprint id
    (api.fetchTasks as jest.Mock).mockImplementation((sprintId: string) => {
      if (sprintId === "s1") {
        return Promise.resolve([
          { id: "t1", title: "Active task", status: "todo", sprintId: "s1" }
        ]);
      }
      return Promise.resolve([]);
    });
  });

  it("fetches tasks for the active sprint and renders them", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <KanbanBoard />
      </QueryClientProvider>
    );

    // It should load and display Sprint 1 task
    const taskEl = await screen.findByText("Active task");
    expect(taskEl).toBeInTheDocument();
  });
});
