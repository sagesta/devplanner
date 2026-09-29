import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { fetchReviews, type WeeklyReviewRow } from "@/lib/api";
import { ReviewHistoryPanel } from "./review-history-panel";

let mockUserId: string | null = "user-one";
jest.mock("@/hooks/use-app-user-id", () => ({
  useAppUserId: () => mockUserId,
}));
jest.mock("@/lib/api", () => ({ fetchReviews: jest.fn() }));

const mockedFetch = fetchReviews as jest.MockedFunction<typeof fetchReviews>;
const review = (
  id: string,
  weekStart: string,
  carryover: string,
  wins: string,
): WeeklyReviewRow => ({
  id,
  userId: "user-one",
  revision: 2,
  weekStart,
  weekEnd: weekStart === "2026-09-28" ? "2026-10-04" : "2026-09-27",
  wins,
  carryover,
  intentions: [{ text: "Improve tests", goalKey: null, goalLabel: "Quality" }],
  sprintNotes: "Bound work",
  sprintId: null,
  status: "completed",
  completedAt: "2026-09-30T12:00:00Z",
  createdAt: "2026-09-30T12:00:00Z",
  updatedAt: "2026-09-30T12:00:00Z",
});

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ReviewHistoryPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockUserId = "user-one";
  mockedFetch.mockReset();
});

test("shows loading then a useful error when history cannot be fetched", async () => {
  let reject!: (error: Error) => void;
  mockedFetch.mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  mount();
  expect(screen.getByLabelText("Loading review history")).toBeInTheDocument();
  reject(new Error("offline"));
  expect(
    await screen.findByText(/Review history could not be loaded/),
  ).toBeInTheDocument();
});

test("search and date range drive server filters and empty search feedback", async () => {
  mockedFetch.mockResolvedValue({ reviews: [] });
  mount();
  expect(
    await screen.findByText("Your first completed review will appear here."),
  ).toBeInTheDocument();
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search weekly reviews" }),
    { target: { value: "  service recovery  " } },
  );
  fireEvent.change(screen.getByLabelText("From"), {
    target: { value: "2026-09-01" },
  });
  fireEvent.change(screen.getByLabelText("To"), {
    target: { value: "2026-09-30" },
  });
  await waitFor(() =>
    expect(mockedFetch).toHaveBeenCalledWith({
      query: "service recovery",
      from: "2026-09-01",
      to: "2026-09-30",
    }),
  );
  expect(
    await screen.findByText("No reviews match that search."),
  ).toBeInTheDocument();
});

test("expanded review compares repeated carryover with the previous week", async () => {
  mockedFetch.mockResolvedValue({
    reviews: [
      review(
        "new",
        "2026-09-28",
        "- Update staging\n- Finish docs",
        "Shipped CI",
      ),
      review(
        "old",
        "2026-09-21",
        "1. Update staging\n- Review PR",
        "Fixed deploy",
      ),
    ],
  });
  mount();
  const summaries = await screen.findAllByRole("button", { expanded: false });
  fireEvent.click(summaries[0]);
  expect(summaries[0]).toHaveAttribute("aria-expanded", "true");
  expect(
    screen.getByText("Repeated carryover: update staging"),
  ).toBeInTheDocument();
  expect(screen.getByText("Advances: Quality")).toBeInTheDocument();
  fireEvent.click(summaries[0]);
  expect(
    screen.queryByText("Repeated carryover: update staging"),
  ).not.toBeInTheDocument();
});

test("signed-out history does not request another user's reviews", async () => {
  mockUserId = null;
  mount();
  expect(mockedFetch).not.toHaveBeenCalled();
});
