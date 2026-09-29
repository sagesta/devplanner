import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { toast } from "sonner";
import {
  fetchAiConfig,
  fetchAiLogs,
  fetchAreas,
  fetchDailyPreferences,
  fetchFocusExport,
  fetchGoogleCalendarStatus,
  patchArea,
  postCaldavMkcol,
  postCaldavPullNow,
  postCaldavPullQueued,
  postGoogleCalendarDisconnect,
  postGoogleCalendarPullNow,
  postGoogleCalendarPullQueued,
  saveDailyTimezone,
} from "@/lib/api";
import SettingsPage from "./page";

const mockPush = jest.fn();
let mockSearch = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearch,
}));
jest.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    user: { primaryEmailAddress: { emailAddress: "me@example.test" } },
  }),
}));
jest.mock("@/hooks/use-app-user-id", () => ({
  useAppUserId: () => "user-one",
}));
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));
jest.mock("@/lib/api", () => ({
  fetchDailyPreferences: jest.fn(),
  saveDailyTimezone: jest.fn(),
  fetchGoogleCalendarStatus: jest.fn(),
  fetchAiConfig: jest.fn(),
  fetchAiLogs: jest.fn(),
  fetchAreas: jest.fn(),
  patchArea: jest.fn(),
  fetchFocusExport: jest.fn(),
  getGoogleOAuthStartUrl: jest.fn(),
  postCaldavMkcol: jest.fn(),
  postCaldavPullNow: jest.fn(),
  postCaldavPullQueued: jest.fn(),
  postGoogleCalendarDisconnect: jest.fn(),
  postGoogleCalendarPullNow: jest.fn(),
  postGoogleCalendarPullQueued: jest.fn(),
}));

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockPush.mockClear();
  mockSearch = new URLSearchParams();
  (fetchDailyPreferences as jest.Mock)
    .mockReset()
    .mockResolvedValue({ timezone: "Africa/Lagos" });
  (saveDailyTimezone as jest.Mock)
    .mockReset()
    .mockResolvedValue({ timezone: "America/New_York" });
  (fetchGoogleCalendarStatus as jest.Mock)
    .mockReset()
    .mockResolvedValue({ connected: false, oauthConfigured: false });
  (postGoogleCalendarDisconnect as jest.Mock)
    .mockReset()
    .mockResolvedValue({ ok: true });
  (postGoogleCalendarPullQueued as jest.Mock)
    .mockReset()
    .mockResolvedValue({ ok: true, queued: true });
  (postGoogleCalendarPullNow as jest.Mock).mockReset();
  (fetchFocusExport as jest.Mock).mockReset();
  (fetchAiConfig as jest.Mock).mockReset().mockResolvedValue({
    openaiKeySet: false,
    defaultChatModel: "gpt-4o-mini",
    allowedChatModels: ["gpt-4o-mini", "gpt-4o"],
  });
  (fetchAiLogs as jest.Mock).mockReset().mockResolvedValue({ logs: [] });
  (fetchAreas as jest.Mock)
    .mockReset()
    .mockResolvedValue([
      { id: "area-one", name: "Work", color: "#136e68", weeklyHourTarget: 4 },
    ]);
  (patchArea as jest.Mock).mockReset().mockResolvedValue({});
  (postCaldavMkcol as jest.Mock)
    .mockReset()
    .mockResolvedValue({ ok: true, message: "Collection ready" });
  (postCaldavPullNow as jest.Mock).mockReset().mockResolvedValue({
    ok: true,
    stats: { imported: 1, updated: 2, removed: 0, skipped: 3, errors: [] },
  });
  (postCaldavPullQueued as jest.Mock)
    .mockReset()
    .mockResolvedValue({ ok: true, queued: true });
  jest.clearAllMocks();
});

test("saves a changed planning timezone and confirms the server response", async () => {
  setup();
  const input = await screen.findByLabelText(
    "Timezone (for example Africa/Lagos)",
  );
  await waitFor(() => expect(input).toHaveValue("Africa/Lagos"));
  fireEvent.change(input, { target: { value: "America/New_York" } });
  fireEvent.click(screen.getByRole("button", { name: "Save timezone" }));
  await waitFor(() =>
    expect(saveDailyTimezone).toHaveBeenCalledWith(
      "America/New_York",
      expect.anything(),
    ),
  );
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Timezone saved"),
  );
});

test("keeps the timezone draft visible when saving fails", async () => {
  (saveDailyTimezone as jest.Mock).mockRejectedValue(new Error("Offline"));
  setup();
  const input = await screen.findByLabelText(
    "Timezone (for example Africa/Lagos)",
  );
  fireEvent.change(input, { target: { value: "Europe/London" } });
  fireEvent.click(screen.getByRole("button", { name: "Save timezone" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Offline"));
  expect(input).toHaveValue("Europe/London");
});

test("resumes the first-task guide for this user and navigates to Today", () => {
  localStorage.setItem("devplanner.gettingStartedDismissed.user-one", "1");
  setup();
  fireEvent.click(
    screen.getByRole("button", { name: "Show first-task guide" }),
  );
  expect(
    localStorage.getItem("devplanner.gettingStartedForceShow.user-one"),
  ).toBe("1");
  expect(
    localStorage.getItem("devplanner.gettingStartedDismissed.user-one"),
  ).toBeNull();
  expect(mockPush).toHaveBeenCalledWith("/now");
});

test("reports a calendar redirect error and disables connection without OAuth configuration", async () => {
  mockSearch = new URLSearchParams("tab=calendar&google_error=invalid_state");
  setup();
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("expired"),
    ),
  );
  expect(await screen.findByText("Not connected")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Connect Google Calendar" }),
  ).toBeDisabled();
});

test("loads and saves browser focus preferences", async () => {
  localStorage.setItem("devplanner.pomodoroWorkMin", "40");
  setup();
  fireEvent.click(
    screen.getByRole("button", { name: /Focus Pomodoro timers/ }),
  );
  const work = screen.getByLabelText("Work (minutes)");
  expect(work).toHaveValue(40);
  fireEvent.change(work, { target: { value: "35" } });
  fireEvent.blur(work);
  expect(localStorage.getItem("devplanner.pomodoroWorkMin")).toBe("35");
});

test("disconnects an existing Google Calendar connection with feedback", async () => {
  (fetchGoogleCalendarStatus as jest.Mock).mockResolvedValue({
    connected: true,
    oauthConfigured: true,
    calendarId: "primary",
  });
  setup();
  fireEvent.click(screen.getByRole("button", { name: /Calendar Sync tasks/ }));
  const disconnect = await screen.findByRole("button", { name: "Disconnect" });
  await waitFor(() => expect(disconnect).toBeEnabled());
  fireEvent.click(disconnect);
  await waitFor(() =>
    expect(postGoogleCalendarDisconnect).toHaveBeenCalledTimes(1),
  );
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Disconnected Google Calendar"),
  );
});

test("reports a failed calendar disconnect and keeps connection controls", async () => {
  (fetchGoogleCalendarStatus as jest.Mock).mockResolvedValue({
    connected: true,
    oauthConfigured: true,
  });
  (postGoogleCalendarDisconnect as jest.Mock).mockRejectedValue(
    new Error("Connection failed"),
  );
  setup();
  fireEvent.click(screen.getByRole("button", { name: /Calendar Sync tasks/ }));
  const disconnect = await screen.findByRole("button", { name: "Disconnect" });
  await waitFor(() => expect(disconnect).toBeEnabled());
  fireEvent.click(disconnect);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Connection failed"),
    ),
  );
  expect(screen.getByRole("button", { name: "Disconnect" })).toBeEnabled();
});

test("queues a calendar sync and reports completion", async () => {
  (fetchGoogleCalendarStatus as jest.Mock).mockResolvedValue({
    connected: true,
    oauthConfigured: true,
  });
  setup();
  fireEvent.click(screen.getByRole("button", { name: /Calendar Sync tasks/ }));
  const queue = await screen.findByRole("button", {
    name: "Queue background sync",
  });
  await waitFor(() => expect(queue).toBeEnabled());
  fireEvent.click(queue);
  await waitFor(() =>
    expect(postGoogleCalendarPullQueued).toHaveBeenCalledTimes(1),
  );
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("Google pull queued"),
    ),
  );
});

test("reports a failed focus export and re-enables its button", async () => {
  (fetchFocusExport as jest.Mock).mockRejectedValue(
    new Error("Export unavailable"),
  );
  setup();
  fireEvent.click(
    screen.getByRole("button", { name: /Focus Pomodoro timers/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Download export" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Export unavailable"),
    ),
  );
  expect(screen.getByRole("button", { name: "Download export" })).toBeEnabled();
});

test("shows server AI key status while saving browser-only model and edit preferences", async () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: /AI Chat model/ }));
  expect(
    await screen.findByText(/OpenAI API key is not set/),
  ).toBeInTheDocument();
  const model = screen.getByLabelText("Chat model (synced with AI dock)");
  fireEvent.change(model, { target: { value: "gpt-4o" } });
  expect(localStorage.getItem("devplanner.chatModel")).toBe("gpt-4o");
  fireEvent.click(screen.getByLabelText(/Can edit — let the assistant/));
  expect(localStorage.getItem("devplanner.aiWritesEnabled")).toBe("1");
  expect(toast.info).toHaveBeenCalledWith(
    expect.stringContaining("create and edit tasks"),
  );
});

test("reports an unavailable AI config while keeping the model chooser usable", async () => {
  (fetchAiConfig as jest.Mock).mockRejectedValue(new Error("API offline"));
  setup();
  fireEvent.click(screen.getByRole("button", { name: /AI Chat model/ }));
  expect(await screen.findByText(/Could not load AI config/)).toHaveTextContent(
    "API offline",
  );
  expect(screen.getByLabelText("Chat model (synced with AI dock)")).toHaveValue(
    "gpt-4o-mini",
  );
});

test("saves an area weekly target and confirms it", async () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: /Areas Life areas/ }));
  const area = await screen.findByText("Work");
  const hours = within(area.parentElement as HTMLElement).getByRole(
    "spinbutton",
  );
  fireEvent.change(hours, { target: { value: "6.5" } });
  fireEvent.blur(hours);
  await waitFor(() =>
    expect(patchArea).toHaveBeenCalledWith("area-one", {
      weekly_hour_target: 6.5,
    }),
  );
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved"));
});

test("reports a failed area target save without hiding its input", async () => {
  (patchArea as jest.Mock).mockRejectedValue(new Error("Target unavailable"));
  setup();
  fireEvent.click(screen.getByRole("button", { name: /Areas Life areas/ }));
  const area = await screen.findByText("Work");
  const hours = within(area.parentElement as HTMLElement).getByRole(
    "spinbutton",
  );
  fireEvent.change(hours, { target: { value: "7" } });
  fireEvent.blur(hours);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Target unavailable"),
  );
  expect(hours).toHaveValue(7);
});

test("creates a CalDAV collection and reports server confirmation", async () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: /Calendar Sync tasks/ }));
  fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
  await waitFor(() => expect(postCaldavMkcol).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Collection ready"),
  );
});

test("reports CalDAV import counts and event errors after Pull now", async () => {
  (postCaldavPullNow as jest.Mock).mockResolvedValue({
    ok: true,
    stats: {
      imported: 1,
      updated: 2,
      removed: 0,
      skipped: 3,
      errors: ["Bad event"],
    },
  });
  setup();
  fireEvent.click(screen.getByRole("button", { name: /Calendar Sync tasks/ }));
  fireEvent.click(screen.getAllByRole("button", { name: "Pull now" }).at(-1)!);
  await waitFor(() => expect(postCaldavPullNow).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      "Imported 1, updated 2, removed/cancelled 0, skipped 3",
    ),
  );
  expect(toast.error).toHaveBeenCalledWith("Bad event");
});

test("reports a failed CalDAV queue request and re-enables retry", async () => {
  (postCaldavPullQueued as jest.Mock).mockResolvedValue({
    ok: false,
    queued: false,
    error: "Worker offline",
  });
  setup();
  fireEvent.click(screen.getByRole("button", { name: /Calendar Sync tasks/ }));
  const queue = screen.getByRole("button", { name: "Queue pull (worker)" });
  fireEvent.click(queue);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Worker offline"),
  );
  expect(queue).toBeEnabled();
});

test("downloads Focus export JSON and confirms the file", async () => {
  (fetchFocusExport as jest.Mock).mockResolvedValue({
    date: "2026-09-29",
    tasks: [{ title: "Write report" }],
  });
  const createUrl = jest.fn().mockReturnValue("blob:focus-export");
  const revokeUrl = jest.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createUrl,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeUrl,
  });
  const click = jest
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  setup();
  fireEvent.click(
    screen.getByRole("button", { name: /Focus Pomodoro timers/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Download export" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Downloaded Focus export JSON"),
  );
  expect(click).toHaveBeenCalledTimes(1);
  expect(createUrl).toHaveBeenCalledWith(expect.any(Blob));
  expect(revokeUrl).toHaveBeenCalledWith("blob:focus-export");
  click.mockRestore();
});

test("reports Google import counts and partial event errors", async () => {
  (fetchGoogleCalendarStatus as jest.Mock).mockResolvedValue({
    connected: true,
    oauthConfigured: true,
  });
  (postGoogleCalendarPullNow as jest.Mock).mockResolvedValue({
    ok: true,
    stats: {
      imported: 2,
      updated: 1,
      removed: 0,
      skipped: 4,
      errors: ["Bad event"],
    },
  });
  setup();
  fireEvent.click(screen.getByRole("button", { name: /Calendar Sync tasks/ }));
  const pull = screen.getAllByRole("button", { name: "Pull now" })[0];
  await waitFor(() => expect(pull).toBeEnabled());
  fireEvent.click(pull);
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      "Google: imported 2, updated 1, removed 0, skipped 4",
    ),
  );
  expect(toast.error).toHaveBeenCalledWith("Bad event");
});

test("shows AI usage details and the empty Areas guidance when appropriate", async () => {
  (fetchAiLogs as jest.Mock).mockResolvedValue({
    logs: [
      {
        id: "log-1",
        createdAt: "2026-09-29T09:00:00Z",
        jobType: "chat",
        model: "gpt-4o-mini",
        inputTokens: 12,
        outputTokens: 4,
        latencyMs: 80,
      },
    ],
  });
  (fetchAreas as jest.Mock).mockResolvedValue([]);
  setup();
  fireEvent.click(screen.getByRole("button", { name: /AI Chat model/ }));
  expect(await screen.findByText("chat")).toBeInTheDocument();
  expect(screen.getByText("12/4")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Areas Life areas/ }));
  expect(await screen.findByText(/No areas found/)).toBeInTheDocument();
});

test("confirms a successful calendar callback when returning to Settings", async () => {
  mockSearch = new URLSearchParams("tab=calendar&google=connected");
  setup();
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Google Calendar connected"),
  );
});

test("reports a CalDAV collection rejection and a queue network failure", async () => {
  (postCaldavMkcol as jest.Mock).mockResolvedValue({
    ok: false,
    error: "Collection denied",
  });
  (postCaldavPullQueued as jest.Mock).mockRejectedValue(
    new Error("Worker unreachable"),
  );
  setup();
  fireEvent.click(screen.getByRole("button", { name: /Calendar Sync tasks/ }));
  fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Collection denied"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Queue pull (worker)" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Worker unreachable"),
    ),
  );
});

test("reports unsuccessful calendar pulls and queue requests", async () => {
  (fetchGoogleCalendarStatus as jest.Mock).mockResolvedValue({
    connected: true,
    oauthConfigured: true,
  });
  (postGoogleCalendarPullNow as jest.Mock).mockResolvedValue({ ok: false });
  (postGoogleCalendarPullQueued as jest.Mock).mockResolvedValue({
    ok: false,
    queued: false,
  });
  (postCaldavPullNow as jest.Mock).mockResolvedValue({ ok: false });
  setup();
  fireEvent.click(screen.getByRole("button", { name: /Calendar Sync tasks/ }));
  const pulls = screen.getAllByRole("button", { name: "Pull now" });
  await waitFor(() => expect(pulls[0]).toBeEnabled());
  fireEvent.click(pulls[0]);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Google pull failed"),
  );
  fireEvent.click(pulls[1]);
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Pull failed"));
  fireEvent.click(
    screen.getByRole("button", { name: "Queue background sync" }),
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Could not queue Google pull"),
  );
});

test("persists break lengths, focus default, and AI budget preferences", async () => {
  setup();
  fireEvent.click(
    screen.getByRole("button", { name: /Focus Pomodoro timers/ }),
  );
  const short = screen.getByLabelText("Short break");
  fireEvent.change(short, { target: { value: "7" } });
  fireEvent.blur(short);
  const long = screen.getByLabelText("Long break");
  fireEvent.change(long, { target: { value: "20" } });
  fireEvent.blur(long);
  fireEvent.click(screen.getByLabelText(/Prefer focus mode/));
  expect(localStorage.getItem("devplanner.pomodoroShortMin")).toBe("7");
  expect(localStorage.getItem("devplanner.pomodoroLongMin")).toBe("20");
  expect(localStorage.getItem("devplanner.focusModeDefault")).toBe("1");
  fireEvent.click(screen.getByRole("button", { name: /AI Chat model/ }));
  fireEvent.click(screen.getByLabelText(/Add daily budget reminder/));
  fireEvent.click(screen.getByLabelText(/Send current physical energy/));
  expect(localStorage.getItem("devplanner.aiEnforceDailyBudget")).toBe("1");
  expect(localStorage.getItem("devplanner.aiEnergyAwareSuggestions")).toBe("0");
});

test("keeps Google sync controls usable after a queue network error", async () => {
  (fetchGoogleCalendarStatus as jest.Mock).mockResolvedValue({
    connected: true,
    oauthConfigured: true,
  });
  (postGoogleCalendarPullQueued as jest.Mock).mockRejectedValue(
    new Error("Queue unreachable"),
  );
  setup();
  fireEvent.click(screen.getByRole("button", { name: /Calendar Sync tasks/ }));
  const queue = screen.getByRole("button", { name: "Queue background sync" });
  await waitFor(() => expect(queue).toBeEnabled());
  fireEvent.click(queue);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Queue unreachable"),
    ),
  );
  expect(queue).toBeEnabled();
});

test("turns saved AI preferences off and clears an area weekly target", async () => {
  localStorage.setItem("devplanner.aiWritesEnabled", "1");
  localStorage.setItem("devplanner.aiEnforceDailyBudget", "1");
  setup();
  fireEvent.click(screen.getByRole("button", { name: /AI Chat model/ }));
  fireEvent.click(screen.getByLabelText(/Can edit — let the assistant/));
  fireEvent.click(screen.getByLabelText(/Add daily budget reminder/));
  expect(localStorage.getItem("devplanner.aiWritesEnabled")).toBe("0");
  expect(localStorage.getItem("devplanner.aiEnforceDailyBudget")).toBe("0");
  fireEvent.click(screen.getByRole("button", { name: /Areas Life areas/ }));
  const area = await screen.findByText("Work");
  const hours = within(area.parentElement as HTMLElement).getByRole(
    "spinbutton",
  );
  fireEvent.change(hours, { target: { value: "" } });
  fireEvent.blur(hours);
  await waitFor(() =>
    expect(patchArea).toHaveBeenCalledWith("area-one", {
      weekly_hour_target: null,
    }),
  );
});
