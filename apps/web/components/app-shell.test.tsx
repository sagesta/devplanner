import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppShell } from "./app-shell";

jest.mock("next/navigation", () => ({ usePathname: () => "/now" }));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
jest.mock("@clerk/nextjs", () => ({
  UserButton: () => null,
  useUser: () => ({ user: null }),
}));
jest.mock("@/hooks/use-app-user-id", () => ({
  useAppUserId: () => "user-one",
}));
jest.mock("@/hooks/use-calendar-date", () => ({
  useCalendarDate: () => "2026-09-29",
}));
jest.mock("@/lib/daily-api", () => ({
  fetchDailyPreferences: () => Promise.resolve({ timezone: "Africa/Lagos" }),
}));
jest.mock("@/components/ai-chat-dock", () => ({ AiChatDock: () => null }));
jest.mock("@/components/brain-dump-modal", () => ({
  BrainDumpModal: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Full capture" /> : null,
}));
jest.mock("@/components/quick-add-task", () => ({
  QuickAddTask: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Quick add" /> : null,
}));
jest.mock("@/components/command-menu", () => ({ CommandMenu: () => null }));
jest.mock("@/components/GlobalTimerIndicator", () => ({
  GlobalTimerIndicator: () => null,
}));
jest.mock("@/components/notifications-tray", () => ({
  NotificationsTray: () => null,
}));
jest.mock("@/components/idle-banner", () => ({ IdleBanner: () => null }));

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AppShell>
        <h1>Daily page</h1>
      </AppShell>
    </QueryClientProvider>,
  );
}

beforeEach(() => localStorage.clear());

test("keeps Today in navigation and opens quick capture from Add task", async () => {
  setup();
  expect(
    screen
      .getAllByRole("link", { name: "Today" })
      .every((link) => link.getAttribute("href") === "/now"),
  ).toBe(true);
  fireEvent.click(screen.getAllByRole("button", { name: "Add task" })[0]);
  expect(screen.getByRole("dialog", { name: "Quick add" })).toBeInTheDocument();
  expect(document.title).toBe("Today — DevPlanner");
});

test("reads a saved theme and persists theme changes", async () => {
  localStorage.setItem("devplanner-theme", "dark");
  setup();
  await waitFor(() =>
    expect(document.documentElement.dataset.theme).toBe("dark"),
  );
  fireEvent.click(screen.getAllByRole("button", { name: "Switch theme" })[0]);
  await waitFor(() =>
    expect(localStorage.getItem("devplanner-theme")).toBe("light"),
  );
  expect(document.documentElement.dataset.theme).toBe("light");
});

test("opens full capture from the first-task guide event", () => {
  setup();
  fireEvent(window, new CustomEvent("devplanner:open-brain-dump"));
  expect(
    screen.getByRole("dialog", { name: "Full capture" }),
  ).toBeInTheDocument();
});

test("offers the assistant and Settings from the mobile More menu", () => {
  const opened = jest.fn();
  window.addEventListener("devplanner:open-ai", opened);
  setup();
  fireEvent.click(screen.getByRole("button", { name: "More options" }));
  expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveAttribute(
    "href",
    "/settings",
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Ask AI" }));
  expect(opened).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("menu", { name: "More options" }),
  ).not.toBeInTheDocument();
  window.removeEventListener("devplanner:open-ai", opened);
});
