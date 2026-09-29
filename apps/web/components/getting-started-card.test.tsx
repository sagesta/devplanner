import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GettingStartedCard } from "./getting-started-card";

let mockUserId = "user-one";
jest.mock("@/hooks/use-app-user-id", () => ({
  useAppUserId: () => mockUserId,
}));
jest.mock("@/lib/api", () => ({
  fetchGoogleCalendarStatus: () => Promise.resolve({ connected: false }),
}));

function renderGuide(hasDoneTask = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GettingStartedCard
        hasAnyTask={hasDoneTask}
        hasTodayPlan={hasDoneTask}
        hasDoneTask={hasDoneTask}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockUserId = "user-one";
});

test("a resumed guide stays visible after completion until dismissed", async () => {
  localStorage.setItem("devplanner.gettingStartedCompleted.user-one", "1");
  localStorage.setItem("devplanner.gettingStartedForceShow.user-one", "1");
  renderGuide(true);
  expect(
    await screen.findByRole("heading", { name: "Your first-task guide" }),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Dismiss getting started checklist" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Your first-task guide" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    localStorage.getItem("devplanner.gettingStartedForceShow.user-one"),
  ).toBeNull();
  expect(
    localStorage.getItem("devplanner.gettingStartedDismissed.user-one"),
  ).toBe("1");
});

test("dismissal belongs only to the signed-in account", async () => {
  localStorage.setItem("devplanner.gettingStartedDismissed.user-one", "1");
  mockUserId = "user-two";
  renderGuide();
  expect(
    await screen.findByRole("heading", { name: "Get started with one task" }),
  ).toBeInTheDocument();
});

test("shows only the next mobile-friendly step and keeps completed steps expandable", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <GettingStartedCard hasAnyTask hasTodayPlan hasDoneTask={false} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("3. Mark it done")).toBeInTheDocument();
  expect(
    screen.getByText("1. Add one task").closest("details"),
  ).not.toHaveAttribute("open");
  const summary = screen.getByText("2 steps complete · Optional setup");
  fireEvent.click(summary);
  expect(summary.closest("details")).toHaveAttribute("open");
  expect(screen.getByText("2. Put it on Today")).toBeInTheDocument();
});
