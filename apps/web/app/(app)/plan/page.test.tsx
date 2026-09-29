import { render, screen } from "@testing-library/react";
import PlanPage from "./page";
let mockView: string | null = null;
let mockUser: unknown = { fullName: "  Owner Name  " };
jest.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(mockView === null ? "" : `view=${mockView}`),
}));
jest.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: mockUser }) }));
jest.mock("@/components/kanban-board", () => ({
  KanbanBoard: () => <div>Board content</div>,
}));
jest.mock("@/components/timeline-board", () => ({
  TimelineBoard: () => <div>Timeline content</div>,
}));
jest.mock("@/components/goal-horizons-matrix", () => ({
  GoalHorizonsMatrix: ({ ownerName }: { ownerName: string }) => (
    <div>Goals for {ownerName}</div>
  ),
}));
jest.mock("@/components/plan-header", () => ({
  PlanHeader: ({ activeView }: { activeView: string }) => (
    <div>View {activeView}</div>
  ),
}));
jest.mock("../sprints/page", () => ({
  __esModule: true,
  default: () => <div>Weekly planning</div>,
}));
jest.mock("../table/page", () => ({
  __esModule: true,
  default: () => <div>Table content</div>,
}));
test.each([
  [null, "Weekly planning"],
  ["unknown", "Weekly planning"],
  ["sprints", "Weekly planning"],
  ["board", "Board content"],
  ["timeline", "Timeline content"],
  ["table", "Table content"],
])("view link %s opens its matching surface", (view, content) => {
  mockView = view;
  render(<PlanPage />);
  expect(screen.getByText(content)).toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "Plan view content" }),
  ).toContainElement(screen.getByText(content));
});
test.each([
  [{ fullName: " Owner Name " }, "Owner Name"],
  [{ primaryEmailAddress: { emailAddress: "owner@example.test" } }, "owner"],
  [null, "Me"],
])("legacy goals link resolves a readable owner name", (user, name) => {
  mockView = "goals";
  mockUser = user;
  render(<PlanPage />);
  expect(screen.getByText(`Goals for ${name}`)).toBeInTheDocument();
});
