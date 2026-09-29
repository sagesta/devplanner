import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WeeklyReviewPanel } from "./weekly-review-panel";
import { reviewDraftKey } from "@/lib/draft-storage";
import {
  completeWeeklyReview,
  fetchCurrentReview,
  fetchGoalHorizons,
  saveReviewDraft,
} from "@/lib/api";
import { toast } from "sonner";

let mockUserId = "alice";
let mockDate = "2026-09-29";
jest.mock("@/hooks/use-app-user-id", () => ({
  useAppUserId: () => mockUserId,
}));
jest.mock("@/hooks/use-calendar-date", () => ({
  useCalendarDate: () => mockDate,
}));
jest.mock("sonner", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}));
jest.mock("@/lib/api", () => ({
  fetchCurrentReview: jest.fn(),
  fetchGoalHorizons: jest.fn().mockResolvedValue({ goals: {} }),
  fetchWeekSummary: jest.fn().mockResolvedValue([]),
  fetchAccomplishments: jest.fn().mockResolvedValue([]),
  saveReviewDraft: jest.fn(),
  completeWeeklyReview: jest.fn(),
}));

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <WeeklyReviewPanel />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

beforeEach(() => {
  mockUserId = "alice";
  mockDate = "2026-09-29";
  localStorage.clear();
  jest.clearAllMocks();
});

test("switching accounts removes the previous account's draft from the editor", async () => {
  (fetchCurrentReview as jest.Mock).mockResolvedValue({ review: null });
  (saveReviewDraft as jest.Mock).mockResolvedValue({ review: { revision: 1 } });
  const view = mount();
  const editor = await screen.findByPlaceholderText(
    "What are you glad moved forward?",
  );
  fireEvent.change(editor, { target: { value: "Alice private win" } });
  mockUserId = "bob";
  view.rerender(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <WeeklyReviewPanel />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      (
        screen.getByPlaceholderText(
          "What are you glad moved forward?",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe(""),
  );
  expect(
    localStorage.getItem(reviewDraftKey("bob", "2026-09-28")),
  ).not.toContain("Alice private win");
});

test("a late conflict refresh cannot show the previous account's review", async () => {
  let resolveConflict!: (value: unknown) => void;
  (fetchCurrentReview as jest.Mock)
    .mockResolvedValueOnce({ review: null })
    .mockReturnValueOnce(
      new Promise((resolve) => {
        resolveConflict = resolve;
      }),
    )
    .mockResolvedValue({ review: null });
  (saveReviewDraft as jest.Mock).mockRejectedValue(new Error("review changed"));
  const view = mount();
  const editor = await screen.findByPlaceholderText(
    "What are you glad moved forward?",
  );
  fireEvent.change(editor, { target: { value: "Alice's newer note" } });
  await waitFor(() => expect(fetchCurrentReview).toHaveBeenCalledTimes(2), {
    timeout: 3000,
  });
  mockUserId = "bob";
  view.rerender(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <WeeklyReviewPanel />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      (
        screen.getByPlaceholderText(
          "What are you glad moved forward?",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe(""),
  );
  resolveConflict({
    review: {
      revision: 5,
      status: "draft",
      wins: "Alice private server note",
      carryover: "",
      intentions: [],
      sprintNotes: "",
    },
  });
  await waitFor(() =>
    expect(screen.queryByText(/This review changed elsewhere/)).toBeNull(),
  );
});

test("a delayed server review cannot replace text typed while loading", async () => {
  let resolveFetch!: (value: unknown) => void;
  (fetchCurrentReview as jest.Mock).mockReturnValue(
    new Promise((resolve) => {
      resolveFetch = resolve;
    }),
  );
  (saveReviewDraft as jest.Mock).mockResolvedValue({ review: { revision: 2 } });
  mount();
  const editor = await screen.findByPlaceholderText(
    "What are you glad moved forward?",
  );
  fireEvent.change(editor, { target: { value: "Newest local win" } });
  resolveFetch({
    review: {
      revision: 1,
      status: "draft",
      wins: "Older server win",
      carryover: "",
      intentions: [],
      sprintNotes: "",
    },
  });
  await waitFor(() =>
    expect((editor as HTMLTextAreaElement).value).toBe("Newest local win"),
  );
  expect(localStorage.getItem(reviewDraftKey("alice", "2026-09-28"))).toContain(
    "Newest local win",
  );
});

test("a failed autosave retains the local draft after remount", async () => {
  (fetchCurrentReview as jest.Mock).mockResolvedValue({ review: null });
  (saveReviewDraft as jest.Mock).mockRejectedValue(new Error("offline"));
  const view = mount();
  const editor = await screen.findByPlaceholderText(
    "What are you glad moved forward?",
  );
  fireEvent.change(editor, { target: { value: "Offline win" } });
  await waitFor(() => expect(saveReviewDraft).toHaveBeenCalled(), {
    timeout: 3000,
  });
  view.unmount();
  mount();
  expect(
    (
      (await screen.findByPlaceholderText(
        "What are you glad moved forward?",
      )) as HTMLTextAreaElement
    ).value,
  ).toBe("Offline win");
});

test("a dirty review stays bound to its original week when Monday arrives", async () => {
  (fetchCurrentReview as jest.Mock).mockResolvedValue({ review: null });
  (saveReviewDraft as jest.Mock).mockRejectedValue(new Error("offline"));
  const view = mount();
  const editor = await screen.findByPlaceholderText(
    "What are you glad moved forward?",
  );
  fireEvent.change(editor, { target: { value: "Sunday work to keep" } });
  mockDate = "2026-10-05";
  view.rerender(
    <QueryClientProvider client={view.client}>
      <WeeklyReviewPanel />
    </QueryClientProvider>,
  );
  expect(
    screen.getByText(/This draft belongs to the week of 2026-09-28/),
  ).toBeTruthy();
  expect((editor as HTMLTextAreaElement).value).toBe("Sunday work to keep");
  fireEvent.click(screen.getByRole("button", { name: "switch to this week" }));
  await waitFor(() =>
    expect(
      (
        screen.getByPlaceholderText(
          "What are you glad moved forward?",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe(""),
  );
  expect(localStorage.getItem(reviewDraftKey("alice", "2026-09-28"))).toContain(
    "Sunday work to keep",
  );
});

test("a failed initial fetch can be retried without discarding browser edits", async () => {
  (fetchCurrentReview as jest.Mock)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ review: null });
  (saveReviewDraft as jest.Mock).mockResolvedValue({ review: { revision: 1 } });
  mount();
  const editor = await screen.findByPlaceholderText(
    "What are you glad moved forward?",
  );
  fireEvent.change(editor, { target: { value: "Work recorded offline" } });
  expect(
    await screen.findByText(/Could not load this review from your account/),
  ).toBeTruthy();
  expect(saveReviewDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
  await waitFor(() => expect(saveReviewDraft).toHaveBeenCalled(), {
    timeout: 3000,
  });
  expect((editor as HTMLTextAreaElement).value).toBe("Work recorded offline");
});

test("failed autosave offers retry with the same local text", async () => {
  (fetchCurrentReview as jest.Mock).mockResolvedValue({ review: null });
  (saveReviewDraft as jest.Mock)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ review: { revision: 1 } });
  mount();
  const editor = await screen.findByPlaceholderText(
    "What are you glad moved forward?",
  );
  fireEvent.change(editor, { target: { value: "Retry this win" } });
  expect(
    await screen.findByRole("button", { name: "Retry saving" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry saving" }));
  await waitFor(() => expect(saveReviewDraft).toHaveBeenCalledTimes(2), {
    timeout: 3000,
  });
  expect((editor as HTMLTextAreaElement).value).toBe("Retry this win");
});

test("accepting a completed server review clears stale local recovery and reflects its sprint", async () => {
  const weekStart = "2026-09-28";
  localStorage.setItem(
    reviewDraftKey("alice", weekStart),
    JSON.stringify({
      version: 3,
      userId: "alice",
      weekStart,
      input: {
        weekStart,
        weekEnd: "2026-10-04",
        wins: "Unsynced win",
        carryover: "",
        intentions: [],
        sprintNotes: "",
      },
      step: 0,
      editSequence: 2,
      acknowledgedSequence: 1,
      serverRevision: 1,
    }),
  );
  (fetchCurrentReview as jest.Mock).mockResolvedValue({
    review: {
      revision: 2,
      status: "completed",
      sprintId: "sprint-1",
      wins: "Server win",
      carryover: "",
      intentions: [],
      sprintNotes: "",
    },
  });
  mount();
  expect(await screen.findByText(/This review changed elsewhere/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Use server version" }));
  expect(await screen.findByText("Review complete.")).toBeTruthy();
  expect(screen.getByText(/next sprint is ready/)).toBeTruthy();
  expect(localStorage.getItem(reviewDraftKey("alice", weekStart))).toBeNull();
});

test("completion uses the acknowledged revision and creates a sprint only when chosen", async () => {
  (fetchCurrentReview as jest.Mock).mockResolvedValue({ review: null });
  (saveReviewDraft as jest.Mock).mockResolvedValue({ review: { revision: 1 } });
  (completeWeeklyReview as jest.Mock).mockResolvedValue({
    review: { revision: 2 },
    sprintId: "next-sprint",
    alreadyCompleted: false,
  });
  mount();
  const editor = await screen.findByPlaceholderText(
    "What are you glad moved forward?",
  );
  fireEvent.change(editor, { target: { value: "Shipped a stable build" } });
  await waitFor(() => expect(saveReviewDraft).toHaveBeenCalled(), {
    timeout: 3000,
  });
  await screen.findByText("Saved");
  fireEvent.click(screen.getByTitle("Approve and close"));
  fireEvent.click(screen.getByRole("checkbox", { name: /Create next week/ }));
  fireEvent.click(screen.getByRole("button", { name: "Complete review" }));
  await waitFor(() =>
    expect(completeWeeklyReview).toHaveBeenCalledWith(
      expect.objectContaining({
        wins: "Shipped a stable build",
        weekStart: "2026-09-28",
      }),
      1,
      true,
    ),
  );
  expect(await screen.findByText("Review complete.")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Open next sprint" }),
  ).toBeInTheDocument();
  expect(
    localStorage.getItem(reviewDraftKey("alice", "2026-09-28")),
  ).toBeNull();
});

test("failed completion leaves the review draft and allows a deliberate retry", async () => {
  (fetchCurrentReview as jest.Mock).mockResolvedValue({ review: null });
  (saveReviewDraft as jest.Mock).mockResolvedValue({ review: { revision: 1 } });
  (completeWeeklyReview as jest.Mock)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({
      review: { revision: 2 },
      sprintId: null,
      alreadyCompleted: false,
    });
  mount();
  fireEvent.change(
    await screen.findByPlaceholderText("What are you glad moved forward?"),
    { target: { value: "Preserve my win" } },
  );
  await screen.findByText("Saved", {}, { timeout: 3000 });
  fireEvent.click(screen.getByTitle("Approve and close"));
  fireEvent.click(screen.getByRole("button", { name: "Complete review" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Review was not completed",
      expect.objectContaining({
        description: expect.stringContaining("draft is still here"),
      }),
    ),
  );
  expect(localStorage.getItem(reviewDraftKey("alice", "2026-09-28"))).toContain(
    "Preserve my win",
  );
  expect(screen.getByRole("button", { name: "Complete review" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Complete review" }));
  expect(await screen.findByText("Review complete.")).toBeInTheDocument();
  expect(completeWeeklyReview).toHaveBeenCalledTimes(2);
});

test("keeping a local draft after conflict retries against the latest server revision", async () => {
  localStorage.setItem(
    reviewDraftKey("alice", "2026-09-28"),
    JSON.stringify({
      version: 3,
      userId: "alice",
      weekStart: "2026-09-28",
      input: {
        weekStart: "2026-09-28",
        weekEnd: "2026-10-04",
        wins: "Local win",
        carryover: "",
        intentions: [],
        sprintNotes: "",
      },
      step: 0,
      editSequence: 3,
      acknowledgedSequence: 1,
      serverRevision: 1,
    }),
  );
  (fetchCurrentReview as jest.Mock).mockResolvedValue({
    review: {
      revision: 4,
      status: "draft",
      wins: "Other device win",
      carryover: "",
      intentions: [],
      sprintNotes: "",
    },
  });
  (saveReviewDraft as jest.Mock).mockResolvedValue({ review: { revision: 5 } });
  mount();
  expect(
    await screen.findByText(/This review changed elsewhere/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Keep my draft" }));
  await waitFor(
    () =>
      expect(saveReviewDraft).toHaveBeenCalledWith(
        expect.objectContaining({ wins: "Local win" }),
        4,
      ),
    { timeout: 3000 },
  );
  expect(
    (
      screen.getByPlaceholderText(
        "What are you glad moved forward?",
      ) as HTMLTextAreaElement
    ).value,
  ).toBe("Local win");
});

test("legacy browser notes require explicit review before restoring into this account and week", async () => {
  localStorage.setItem(
    "devplanner.weeklyReview.v1",
    JSON.stringify({
      notes: [
        "Legacy win",
        "Old blocker",
        "Finish launch",
        "Keep Friday light",
      ],
      step: 0,
    }),
  );
  (fetchCurrentReview as jest.Mock).mockResolvedValue({ review: null });
  (saveReviewDraft as jest.Mock).mockResolvedValue({ review: { revision: 1 } });
  mount();
  expect(
    await screen.findByText(
      /An older browser draft has unknown account or week ownership/,
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByPlaceholderText("What are you glad moved forward?"),
  ).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Restore to this week" }));
  expect(
    screen.getByPlaceholderText("What are you glad moved forward?"),
  ).toHaveValue("Legacy win");
  await waitFor(() =>
    expect(
      localStorage.getItem(reviewDraftKey("alice", "2026-09-28")),
    ).toContain("Legacy win"),
  );
  fireEvent.click(screen.getByTitle("Top 3 intentions"));
  expect(screen.getByDisplayValue("Finish launch")).toBeInTheDocument();
});

test("an intention can link a goal and Reset requires a second explicit click", async () => {
  (fetchCurrentReview as jest.Mock).mockResolvedValue({ review: null });
  (fetchGoalHorizons as jest.Mock).mockResolvedValue({
    goals: { "short:work": "Ship API" },
  });
  (saveReviewDraft as jest.Mock).mockResolvedValue({ review: { revision: 1 } });
  mount();
  fireEvent.change(
    await screen.findByPlaceholderText("What are you glad moved forward?"),
    { target: { value: "Proof of progress" } },
  );
  fireEvent.click(screen.getByTitle("Top 3 intentions"));
  fireEvent.change(
    screen.getAllByPlaceholderText("A clear outcome for next week")[0],
    { target: { value: "Finish API" } },
  );
  await waitFor(() =>
    expect(
      screen.getAllByRole("option", { name: "Short-term work: Ship API" }),
    ).toHaveLength(3),
  );
  fireEvent.change(screen.getAllByRole("combobox")[0], {
    target: { value: JSON.stringify(["short:work", "Ship API"]) },
  });
  await waitFor(() =>
    expect(
      localStorage.getItem(reviewDraftKey("alice", "2026-09-28")),
    ).toContain('"goalLabel":"Ship API"'),
  );
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(localStorage.getItem(reviewDraftKey("alice", "2026-09-28"))).toContain(
    "Proof of progress",
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByTitle("Wins"));
  expect(
    screen.getByPlaceholderText("What are you glad moved forward?"),
  ).toHaveValue("Proof of progress");
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(
    screen.getByPlaceholderText("What are you glad moved forward?"),
  ).toHaveValue("");
});

test("a completion response from the previous account cannot finish or erase the new account's review", async () => {
  let resolveComplete!: (value: unknown) => void;
  (fetchCurrentReview as jest.Mock).mockResolvedValue({ review: null });
  (saveReviewDraft as jest.Mock).mockResolvedValue({ review: { revision: 1 } });
  (completeWeeklyReview as jest.Mock).mockReturnValue(
    new Promise((resolve) => {
      resolveComplete = resolve;
    }),
  );
  const view = mount();
  fireEvent.change(
    await screen.findByPlaceholderText("What are you glad moved forward?"),
    { target: { value: "Alice pending win" } },
  );
  await screen.findByText("Saved", {}, { timeout: 3000 });
  fireEvent.click(screen.getByTitle("Approve and close"));
  fireEvent.click(screen.getByRole("button", { name: "Complete review" }));
  await waitFor(() => expect(completeWeeklyReview).toHaveBeenCalledTimes(1));
  mockUserId = "bob";
  view.rerender(
    <QueryClientProvider client={view.client}>
      <WeeklyReviewPanel />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      screen.getByPlaceholderText("What are you glad moved forward?"),
    ).toHaveValue(""),
  );
  await act(async () =>
    resolveComplete({
      review: { revision: 2 },
      sprintId: null,
      alreadyCompleted: false,
    }),
  );
  expect(screen.queryByText("Review complete.")).not.toBeInTheDocument();
  expect(localStorage.getItem(reviewDraftKey("alice", "2026-09-28"))).toContain(
    "Alice pending win",
  );
  expect(
    localStorage.getItem(reviewDraftKey("bob", "2026-09-28")),
  ).not.toContain("Alice pending win");
});
