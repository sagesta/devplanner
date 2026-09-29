import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import { fetchPriorities, savePriorities, suggestPriorities } from "@/lib/api";
import { PriorityAnchorsCard } from "./priority-anchors-card";

jest.mock("@/hooks/use-app-user-id", () => ({
  useAppUserId: () => "user-one",
}));
jest.mock("@/lib/api", () => ({
  fetchPriorities: jest.fn(),
  savePriorities: jest.fn(),
  suggestPriorities: jest.fn(),
}));
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));
const initial = {
  period: { week: "2026-09-28", month: "2026-09-01" },
  week_anchors: [{ category: "work", statement: "Weekly delivery" }],
  month_anchors: [{ category: "work", statement: "Monthly delivery" }],
};
const work = () =>
  screen.getByPlaceholderText("Ship the thing that matters this week…");
async function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <PriorityAnchorsCard />
    </QueryClientProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Edit This week anchors" }),
  );
  return client;
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchPriorities).mockResolvedValue(initial as never);
});

test("refresh preserves unsaved text, failure allows retry, and save sends the selected period", async () => {
  jest
    .mocked(savePriorities)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({} as never);
  const client = await setup();
  fireEvent.change(work(), { target: { value: "Ship recovery" } });
  act(() =>
    client.setQueryData(["priorities", "user-one"], {
      ...initial,
      week_anchors: [{ category: "work", statement: "Remote edit" }],
    }),
  );
  expect(work()).toHaveValue("Ship recovery");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Offline"));
  expect(work()).toHaveValue("Ship recovery");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument(),
  );
  expect(savePriorities).toHaveBeenLastCalledWith([
    {
      periodType: "week",
      periodStart: "2026-09-28",
      category: "work",
      statement: "Ship recovery",
    },
    {
      periodType: "week",
      periodStart: "2026-09-28",
      category: "personal",
      statement: "",
    },
    {
      periodType: "week",
      periodStart: "2026-09-28",
      category: "growth",
      statement: "",
    },
  ]);
});

test("cancel discards drafts and opening another period snapshots its own text", async () => {
  await setup();
  fireEvent.change(work(), { target: { value: "Discard me" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Edit This month anchors" }),
  );
  expect(work()).toHaveValue("Monthly delivery");
  expect(savePriorities).not.toHaveBeenCalled();
});

test("suggestions populate only returned categories and require explicit saving", async () => {
  jest.mocked(suggestPriorities).mockResolvedValue({
    drafts: [{ category: "growth", statement: "Practice recovery" }],
  } as never);
  await setup();
  fireEvent.change(work(), { target: { value: "Keep my work" } });
  fireEvent.click(screen.getByRole("button", { name: /Suggest/ }));
  await waitFor(() =>
    expect(
      screen.getByPlaceholderText(
        "Which professional skill or habit are you improving?",
      ),
    ).toHaveValue("Practice recovery"),
  );
  expect(work()).toHaveValue("Keep my work");
  expect(suggestPriorities).toHaveBeenCalledWith("week", "2026-09-28");
  expect(savePriorities).not.toHaveBeenCalled();
});

test("margin anchors edit all categories, retain manual text after empty or failed suggestions, and save", async () => {
  jest
    .mocked(suggestPriorities)
    .mockResolvedValueOnce({ drafts: [] } as never)
    .mockRejectedValueOnce(new Error("AI unavailable"));
  jest.mocked(savePriorities).mockResolvedValue({} as never);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <PriorityAnchorsCard variant="margin" />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Edit anchors" }));
  fireEvent.change(work(), { target: { value: "My work" } });
  fireEvent.change(
    screen.getByPlaceholderText("What does future-you want to thank you for?"),
    { target: { value: "Rest" } },
  );
  fireEvent.change(
    screen.getByPlaceholderText(
      "Which professional skill or habit are you improving?",
    ),
    { target: { value: "Practice" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Suggest" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "AI didn't return suggestions — try editing manually.",
    ),
  );
  expect(work()).toHaveValue("My work");
  fireEvent.click(screen.getByRole("button", { name: "Suggest" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("AI unavailable"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: "Edit anchors" });
  expect(savePriorities).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ category: "personal", statement: "Rest" }),
      expect.objectContaining({ category: "growth", statement: "Practice" }),
    ]),
  );
});
test("monthly anchors save the month period and empty week is explicitly optional", async () => {
  jest.mocked(fetchPriorities).mockResolvedValue({
    ...initial,
    week_anchors: [],
    month_anchors: [
      { category: "personal", statement: "Rest" },
      { category: "growth", statement: "Study" },
    ],
  } as never);
  jest.mocked(savePriorities).mockResolvedValue({} as never);
  const client = await setup();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Not set")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Edit This month anchors" }),
  );
  fireEvent.change(work(), { target: { value: "Month outcome" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(savePriorities).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          periodType: "month",
          periodStart: "2026-09-01",
          statement: "Month outcome",
        }),
      ]),
    ),
  );
  client.clear();
});
test.each(["week", "margin"] as const)(
  "optional %s anchors hide after load failure",
  async (variant) => {
    jest.mocked(fetchPriorities).mockRejectedValue(new Error("Offline"));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { container } = render(
      <QueryClientProvider client={client}>
        <PriorityAnchorsCard variant={variant} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  },
);
