import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import { fetchGoalHorizons, saveGoalHorizons } from "@/lib/api";
import { GoalHorizonsMatrix } from "./goal-horizons-matrix";
let mockUser: string | null = "user-one";
let mockAuthLoaded = true;
jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: mockAuthLoaded }),
}));
jest.mock("@/hooks/use-app-user-id", () => ({ useAppUserId: () => mockUser }));
jest.mock("@/lib/api", () => ({
  fetchGoalHorizons: jest.fn(),
  saveGoalHorizons: jest.fn(),
}));
jest.mock("sonner", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}));
const key = "devplanner.goalHorizons.v1";
const initial = {
  ownerName: "My plan",
  goals: { "short:personal": "Server goal" },
  updatedAt: "2026-09-20T12:00:00Z",
};
const personal = () =>
  screen.getAllByPlaceholderText("Health, home, relationships, rhythm.")[0];
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <GoalHorizonsMatrix />
      </QueryClientProvider>,
    ),
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockUser = "user-one";
  mockAuthLoaded = true;
  jest.mocked(fetchGoalHorizons).mockResolvedValue(initial as never);
});
afterEach(() => jest.restoreAllMocks());
test("waits for identity and preserves populated server goals over stale local recovery", async () => {
  localStorage.setItem(
    key,
    JSON.stringify({ "short:personal": "Old local goal" }),
  );
  mockAuthLoaded = false;
  mockUser = null;
  const view = setup();
  expect(personal()).toHaveValue("");
  expect(fetchGoalHorizons).not.toHaveBeenCalled();
  mockAuthLoaded = true;
  mockUser = "user-one";
  view.rerender(
    <QueryClientProvider client={view.client}>
      <GoalHorizonsMatrix />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(personal()).toHaveValue("Server goal"));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 800));
  });
  expect(saveGoalHorizons).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem(key)!)["short:personal"]).toBe(
    "Server goal",
  );
});
test("failed save preserves typing and local recovery; the next edit retries", async () => {
  jest
    .mocked(saveGoalHorizons)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockImplementationOnce(
      async (value) =>
        ({ ...value, updatedAt: "2026-09-29T12:00:00Z" }) as never,
    );
  const { client } = setup();
  await waitFor(() => expect(personal()).toHaveValue("Server goal"));
  fireEvent.change(personal(), { target: { value: "New goal" } });
  act(() =>
    client.setQueryData(["goal-horizons", "user-one"], {
      ...initial,
      goals: { "short:personal": "Remote refresh" },
    }),
  );
  expect(personal()).toHaveValue("New goal");
  await waitFor(
    () =>
      expect(toast.error).toHaveBeenCalledWith(
        "Goals saved locally only: Offline",
      ),
    { timeout: 2000 },
  );
  expect(personal()).toHaveValue("New goal");
  expect(JSON.parse(localStorage.getItem(key)!)["short:personal"]).toBe(
    "New goal",
  );
  expect(screen.getByText(/save unavailable/)).toBeInTheDocument();
  fireEvent.change(personal(), { target: { value: "Recovered goal" } });
  await waitFor(() => expect(saveGoalHorizons).toHaveBeenCalledTimes(2), {
    timeout: 2000,
  });
  expect(jest.mocked(saveGoalHorizons).mock.calls[1][0]).toEqual(
    expect.objectContaining({
      ownerName: "My plan",
      goals: expect.objectContaining({ "short:personal": "Recovered goal" }),
    }),
  );
  await waitFor(() =>
    expect(screen.queryByText(/save unavailable/)).not.toBeInTheDocument(),
  );
});
test("empty server imports and saves a local recovery draft", async () => {
  localStorage.setItem(
    key,
    JSON.stringify({ "short:personal": "Recover my goal" }),
  );
  localStorage.setItem("devplanner.goalHorizons.owner.v1", "Recovery owner");
  jest.mocked(fetchGoalHorizons).mockResolvedValue({
    ownerName: null,
    goals: {},
    updatedAt: null,
  } as never);
  jest
    .mocked(saveGoalHorizons)
    .mockImplementation(
      async (value) =>
        ({ ...value, updatedAt: "2026-09-29T12:00:00Z" }) as never,
    );
  setup();
  await waitFor(() => expect(personal()).toHaveValue("Recover my goal"));
  await waitFor(() => expect(saveGoalHorizons).toHaveBeenCalled(), {
    timeout: 2000,
  });
  expect(jest.mocked(saveGoalHorizons).mock.calls[0][0]).toEqual(
    expect.objectContaining({
      ownerName: "Recovery owner",
      goals: expect.objectContaining({ "short:personal": "Recover my goal" }),
    }),
  );
});
test("signed-out storage failure reports unavailable and keeps editable text", async () => {
  mockUser = null;
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Quota exceeded");
  });
  setup();
  fireEvent.change(personal(), { target: { value: "Keep visible" } });
  await waitFor(() =>
    expect(screen.getByText(/save unavailable/)).toBeInTheDocument(),
  );
  expect(personal()).toHaveValue("Keep visible");
  expect(saveGoalHorizons).not.toHaveBeenCalled();
});
test("clear supports undo without losing previous goals", async () => {
  setup();
  await waitFor(() => expect(personal()).toHaveValue("Server goal"));
  fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
  expect(personal()).toHaveValue("");
  const options = jest.mocked(toast).mock.calls[0][1] as {
    action: { onClick: () => void };
  };
  act(() => options.action.onClick());
  expect(personal()).toHaveValue("Server goal");
});
