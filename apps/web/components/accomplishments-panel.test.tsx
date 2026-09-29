import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import {
  createAccomplishment,
  deleteAccomplishment,
  fetchAccomplishments,
  updateAccomplishment,
} from "@/lib/api";
import { AccomplishmentsPanel } from "./accomplishments-panel";

const mockReplace = jest.fn();
let mockParams = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockParams,
}));
jest.mock("@/hooks/use-app-user-id", () => ({
  useAppUserId: () => "user-one",
}));
jest.mock("@/lib/api", () => ({
  createAccomplishment: jest.fn(),
  deleteAccomplishment: jest.fn(),
  fetchAccomplishments: jest.fn(),
  updateAccomplishment: jest.fn(),
}));
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AccomplishmentsPanel />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = new URLSearchParams();
  jest.mocked(fetchAccomplishments).mockResolvedValue([]);
});

test("failed history load is not shown as an empty account and can be retried", async () => {
  jest
    .mocked(fetchAccomplishments)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce([
      {
        id: "win-one",
        taskId: null,
        date: "2026-09-20",
        title: "Restored service",
        impact: null,
        metric: null,
        skills: null,
      },
    ] as never);
  setup();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Accomplishments could not be loaded",
  );
  expect(screen.queryByText("No accomplishments yet")).not.toBeInTheDocument();
  expect(
    screen.getByText("Count unavailable until records load"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
  expect(await screen.findByText("Restored service")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("logged so far")).toBeInTheDocument();
});

test("blank title is rejected and a failed creation preserves normalized fields for retry", async () => {
  jest
    .mocked(createAccomplishment)
    .mockRejectedValueOnce(new Error("Connection lost"))
    .mockResolvedValueOnce({} as never);
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Log" }));
  fireEvent.click(screen.getByRole("button", { name: /Save/ }));
  expect(createAccomplishment).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith(
    "Add a short line for what you did.",
  );
  fireEvent.change(screen.getByLabelText("What you did"), {
    target: { value: "  Restored service  " },
  });
  fireEvent.change(screen.getByLabelText("Date"), {
    target: { value: "2026-09-20" },
  });
  fireEvent.change(screen.getByLabelText(/Skills/), {
    target: { value: " Linux, Recovery, Linux, , " },
  });
  fireEvent.click(screen.getByRole("button", { name: /Save/ }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Connection lost"),
  );
  expect(screen.getByLabelText("What you did")).toHaveValue(
    "  Restored service  ",
  );
  expect(createAccomplishment).toHaveBeenCalledWith({
    date: "2026-09-20",
    title: "Restored service",
    impact: null,
    metric: null,
    skills: ["Linux", "Recovery"],
    taskId: null,
  });
  fireEvent.click(screen.getByRole("button", { name: /Save/ }));
  await waitFor(() =>
    expect(screen.queryByLabelText("What you did")).not.toBeInTheDocument(),
  );
});

test("task prefill is consumed once and retains its task association on save", async () => {
  mockParams = new URLSearchParams("title=Shipped+fix&taskId=task-one");
  jest.mocked(createAccomplishment).mockResolvedValue({} as never);
  const view = setup();
  expect(await screen.findByLabelText("What you did")).toHaveValue(
    "Shipped fix",
  );
  expect(mockReplace).toHaveBeenCalledWith("/review?view=accomplishments");
  fireEvent.change(screen.getByLabelText("What you did"), {
    target: { value: "Refined win" },
  });
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <AccomplishmentsPanel />
    </QueryClientProvider>,
  );
  expect(screen.getByLabelText("What you did")).toHaveValue("Refined win");
  fireEvent.click(screen.getByRole("button", { name: /Save/ }));
  await waitFor(() =>
    expect(createAccomplishment).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Refined win", taskId: "task-one" }),
    ),
  );
  expect(mockReplace).toHaveBeenCalledTimes(1);
});

test("editing updates the selected record and delete failures leave the record visible", async () => {
  const row = {
    id: "win-one",
    taskId: "task-one",
    date: "2026-09-20",
    title: "Original win",
    impact: "Reduced downtime",
    metric: "10 minutes",
    skills: ["Recovery"],
  };
  jest.mocked(fetchAccomplishments).mockResolvedValue([row] as never);
  jest.mocked(updateAccomplishment).mockResolvedValue({} as never);
  jest
    .mocked(deleteAccomplishment)
    .mockRejectedValue(new Error("Delete failed"));
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  expect(screen.getByLabelText(/Impact/)).toHaveValue("Reduced downtime");
  fireEvent.change(screen.getByLabelText("What you did"), {
    target: { value: "Better win" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
  await waitFor(() =>
    expect(updateAccomplishment).toHaveBeenCalledWith("win-one", {
      date: "2026-09-20",
      title: "Better win",
      impact: "Reduced downtime",
      metric: "10 minutes",
      skills: ["Recovery"],
    }),
  );
  expect(createAccomplishment).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Delete failed"),
  );
  expect(screen.getByText("Original win")).toBeInTheDocument();
});
