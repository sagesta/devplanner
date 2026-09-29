import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AiChatDock } from "./ai-chat-dock";
import { fetchAiConfig } from "@/lib/api";
import { toast } from "sonner";
import { TextDecoder, TextEncoder } from "util";

jest.mock("next/navigation", () => ({ usePathname: () => "/board" }));
jest.mock("@/hooks/use-app-user-id", () => ({ useAppUserId: () => "alice" }));
jest.mock("@/lib/env", () => ({
  getApiBase: () => "https://api.example.test",
}));
jest.mock("@/lib/auth-token", () => ({
  authHeaders: () => Promise.resolve({ Authorization: "Bearer test" }),
}));
jest.mock("@/lib/api", () => ({ fetchAiConfig: jest.fn() }));
jest.mock("sonner", () => ({ toast: { info: jest.fn(), error: jest.fn() } }));
jest.mock("./MarkdownMessage", () => ({
  MarkdownMessage: ({ content }: { content: string }) => <span>{content}</span>,
}));

const config = {
  openaiKeySet: true,
  allowedChatModels: ["gpt-5-nano", "gpt-5-mini"],
  defaultChatModel: "gpt-5-nano",
};
const fetchMock = jest.fn();

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = jest.spyOn(client, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={client}>
      <AiChatDock />
    </QueryClientProvider>,
  );
  return { ...view, invalidate };
}

function sendMessage(message: string) {
  fireEvent.change(screen.getByPlaceholderText("What should I do now?"), {
    target: { value: message },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: jest.fn(),
  });
  Object.defineProperty(globalThis, "TextDecoder", {
    configurable: true,
    value: TextDecoder,
  });
  localStorage.clear();
  sessionStorage.clear();
  jest.clearAllMocks();
  (fetchAiConfig as jest.Mock).mockResolvedValue(config);
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: fetchMock,
  });
  fetchMock.mockResolvedValue({
    ok: true,
    body: null,
    json: async () => ({ reply: "Done" }),
  });
});

test("prefilled prompts open the dock without sending and edits require explicit opt-in", async () => {
  mount();
  fireEvent(
    window,
    new CustomEvent("devplanner:ai-prompt", {
      detail: { prompt: "Plan this goal" },
    }),
  );
  const input = (await screen.findByPlaceholderText(
    "What should I do now?",
  )) as HTMLTextAreaElement;
  expect(input.value).toBe("Plan this goal");
  expect(fetchMock).not.toHaveBeenCalled();
  await waitFor(() => expect(fetchAiConfig).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText("Tools")).toBeChecked();
  expect(screen.getByLabelText(/Can edit/)).not.toBeChecked();

  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const first = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(first).toMatchObject({
    message: "Plan this goal",
    enableTools: true,
    allowWrites: false,
    current_view: "Board",
    model: "gpt-5-nano",
  });
  await screen.findByText("Done");

  fireEvent.click(screen.getByLabelText(/Can edit/));
  expect(localStorage.getItem("devplanner.aiWritesEnabled")).toBe("1");
  expect(toast.info).toHaveBeenCalledTimes(1);
  sendMessage("Make a task");
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).allowWrites).toBe(true);

  await screen.findAllByText("Done");
  fireEvent.click(screen.getByLabelText("Tools"));
  expect(screen.getByLabelText(/Can edit/)).toBeDisabled();
  sendMessage("Just explain");
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({
    enableTools: false,
    allowWrites: false,
  });
});

test("streams assistant text, saves history, and invalidates task data after a tool-enabled response", async () => {
  const encoder = new TextEncoder();
  let chunk = 0;
  fetchMock.mockResolvedValue({
    ok: true,
    body: {
      getReader: () => ({
        read: async () =>
          ++chunk === 1
            ? { done: false, value: encoder.encode("First ") }
            : chunk === 2
              ? { done: false, value: encoder.encode("reply") }
              : { done: true, value: undefined },
      }),
    },
  });
  const { invalidate } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
  sendMessage("Summarize my tasks");
  expect(await screen.findByText("First reply")).toBeInTheDocument();
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tasks"] }),
  );
  expect(
    JSON.parse(sessionStorage.getItem("devplanner.aiChatHistory") ?? "[]"),
  ).toEqual([
    { role: "user", content: "Summarize my tasks" },
    { role: "assistant", content: "First reply" },
  ]);
});

test("failed requests show an error in the conversation and allow a new send", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    text: async () => "rate limited",
  });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
  sendMessage("Try once");
  expect(
    await screen.findByText(/Error: Error: rate limited/),
  ).toBeInTheDocument();
  expect(toast.error).toHaveBeenCalledWith("Error: rate limited");
  sendMessage("Try again");
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Done")).toBeInTheDocument();
});

test("pins a searched task and includes planning preferences in the request", async () => {
  localStorage.setItem("devplanner.aiEnforceDailyBudget", "1");
  localStorage.setItem("devplanner.aiEnergyAwareSuggestions", "1");
  localStorage.setItem("devplanner.currentPhysicalEnergy", "low");
  fetchMock.mockImplementation(async (url: string) =>
    url.endsWith("/api/tasks")
      ? {
          ok: true,
          json: async () => ({
            tasks: [
              {
                id: "task-1",
                title: "Draft proposal",
                status: "todo",
                priority: "high",
              },
            ],
          }),
        }
      : { ok: true, body: null, json: async () => ({ reply: "Done" }) },
  );
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Select task to mention" }),
  );
  fireEvent.change(screen.getByPlaceholderText("Search tasks to mention…"), {
    target: { value: "proposal" },
  });
  fireEvent.click(
    await screen.findByRole("button", { name: /Draft proposal high/ }),
  );
  expect(screen.getByText("1 task pinned")).toBeInTheDocument();
  sendMessage("What next?");
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const body = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(body.selected_task_ids).toEqual(["task-1"]);
  expect(body.message).toContain('"Draft proposal" (todo)');
  expect(body.message).toContain("What next?");
  expect(body.message).toContain("respect daily work/personal time budgets");
  expect(body.currentPhysicalEnergy).toBe("low");
  expect(await screen.findByText("Done")).toBeInTheDocument();
  expect(screen.queryByText("1 task pinned")).not.toBeInTheDocument();
});
