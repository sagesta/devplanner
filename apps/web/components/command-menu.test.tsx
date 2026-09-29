import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { fetchTasks } from "@/lib/api";
import { CommandMenu } from "./command-menu";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/hooks/use-app-user-id", () => ({
  useAppUserId: () => "user-one",
}));
jest.mock("@/lib/api", () => ({ fetchTasks: jest.fn() }));

beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = jest.fn();
});

function setup(open = true) {
  const onOpenChange = jest.fn();
  const onBrainDump = jest.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CommandMenu
        open={open}
        onOpenChange={onOpenChange}
        onBrainDump={onBrainDump}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange, onBrainDump };
}

beforeEach(() => {
  mockPush.mockClear();
  (fetchTasks as jest.Mock)
    .mockReset()
    .mockResolvedValue([{ id: "task-1", title: "Write report" }]);
});

test("filters navigation and opens the selected planning view", async () => {
  const { onOpenChange } = setup();
  fireEvent.change(screen.getByPlaceholderText("Search…"), {
    target: { value: "Plan: Table" },
  });
  fireEvent.click(await screen.findByText("Plan: Table"));
  expect(mockPush).toHaveBeenCalledWith("/plan?view=table");
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("opens full capture with the keyboard shortcut", () => {
  const { onOpenChange, onBrainDump } = setup(false);
  fireEvent.keyDown(window, { key: "d", ctrlKey: true, shiftKey: true });
  expect(onBrainDump).toHaveBeenCalledTimes(1);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("dispatches a matching task for detail view", async () => {
  const opened = jest.fn();
  window.addEventListener("open-task", opened);
  const { onOpenChange } = setup();
  fireEvent.change(screen.getByPlaceholderText("Search…"), {
    target: { value: "Write report" },
  });
  fireEvent.click(await screen.findByText("Write report"));
  await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
  expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({
    id: "task-1",
  });
  expect(onOpenChange).toHaveBeenCalledWith(false);
  window.removeEventListener("open-task", opened);
});
