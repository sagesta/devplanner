import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrainDumpModal } from "./brain-dump-modal";
import { captureDraftKey } from "@/lib/draft-storage";
import {
  fetchAreas,
  parseDump,
  postCaptureBatch,
  transcribeAudio,
} from "@/lib/api";
import { toast } from "sonner";

let mockUserId = "alice";
jest.mock("@/hooks/use-app-user-id", () => ({
  useAppUserId: () => mockUserId,
}));
jest.mock("@/hooks/use-calendar-date", () => ({
  useCalendarDate: () => "2026-09-29",
}));
jest.mock("sonner", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    message: jest.fn(),
  }),
}));
jest.mock("@/lib/api", () => ({
  fetchAreas: jest.fn().mockResolvedValue([]),
  parseDump: jest.fn(),
  postCaptureBatch: jest.fn(),
  transcribeAudio: jest.fn(),
}));

function mount(onClose = jest.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BrainDumpModal open onClose={onClose} />
    </QueryClientProvider>,
  );
}

const originalRandomUUID = Object.getOwnPropertyDescriptor(
  globalThis.crypto,
  "randomUUID",
);
beforeEach(() => {
  localStorage.clear();
  mockUserId = "alice";
  jest.clearAllMocks();
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    configurable: true,
    value: jest.fn().mockReturnValue("generated-capture-key"),
  });
});
afterAll(() => {
  if (originalRandomUUID)
    Object.defineProperty(globalThis.crypto, "randomUUID", originalRandomUUID);
  else Reflect.deleteProperty(globalThis.crypto, "randomUUID");
});

test("closing capture preserves raw text for reopening and reload", async () => {
  const onClose = jest.fn();
  const view = mount(onClose);
  const editor = screen.getByPlaceholderText(
    /Fix login bug/,
  ) as HTMLTextAreaElement;
  fireEvent.change(editor, { target: { value: "Write project note" } });
  await waitFor(() =>
    expect(localStorage.getItem(captureDraftKey("alice"))).toContain(
      "Write project note",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(captureDraftKey("alice"))).toContain(
    "Write project note",
  );
  view.unmount();
  mount();
  expect(
    (
      (await screen.findByPlaceholderText(
        /Fix login bug/,
      )) as HTMLTextAreaElement
    ).value,
  ).toBe("Write project note");
});

test("discard requires an explicit confirmation", async () => {
  mount();
  fireEvent.change(screen.getByPlaceholderText(/Fix login bug/), {
    target: { value: "Keep this" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(localStorage.getItem(captureDraftKey("alice"))).toContain("Keep this");
  fireEvent.click(screen.getByRole("button", { name: "Keep" }));
  expect(
    (screen.getByPlaceholderText(/Fix login bug/) as HTMLTextAreaElement).value,
  ).toBe("Keep this");
});

test("storage failure keeps the editor usable and reports recovery unavailable", async () => {
  const write = jest
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("quota");
    });
  try {
    mount();
    fireEvent.change(screen.getByPlaceholderText(/Fix login bug/), {
      target: { value: "Unsaved browser note" },
    });
    expect(
      (screen.getByPlaceholderText(/Fix login bug/) as HTMLTextAreaElement)
        .value,
    ).toBe("Unsaved browser note");
    await waitFor(() =>
      expect(
        screen.getByText(/Browser draft recovery is unavailable/),
      ).toBeTruthy(),
    );
  } finally {
    write.mockRestore();
  }
});

test("edited AI preview survives close and reload", async () => {
  (parseDump as jest.Mock).mockResolvedValue({
    draft: [
      {
        title: "AI first title",
        bucket: "today",
        priority: "normal",
        energy: "shallow",
        estimated_minutes: 20,
      },
    ],
  });
  const view = mount();
  fireEvent.change(screen.getByPlaceholderText(/Fix login bug/), {
    target: { value: "One thought" },
  });
  fireEvent.click(screen.getByRole("button", { name: "AI organize" }));
  const item = (await screen.findByDisplayValue(
    "AI first title",
  )) as HTMLInputElement;
  fireEvent.change(item, { target: { value: "My corrected title" } });
  await waitFor(() =>
    expect(localStorage.getItem(captureDraftKey("alice"))).toContain(
      "My corrected title",
    ),
  );
  view.unmount();
  mount();
  expect(
    (
      (await screen.findByDisplayValue(
        "My corrected title",
      )) as HTMLInputElement
    ).value,
  ).toBe("My corrected title");
});

test("batch retry after a lost response reuses the persisted request key", async () => {
  const original = Object.getOwnPropertyDescriptor(
    globalThis.crypto,
    "randomUUID",
  );
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    configurable: true,
    value: jest.fn().mockReturnValue("capture-key"),
  });
  try {
    (postCaptureBatch as jest.Mock)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ created: 1, tasks: [] });
    const view = mount();
    fireEvent.change(screen.getByPlaceholderText(/Fix login bug/), {
      target: { value: "Retry this task" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save 1 to backlog/ }));
    await waitFor(() => expect(postCaptureBatch).toHaveBeenCalledTimes(1));
    const firstKey = (postCaptureBatch as jest.Mock).mock.calls[0][0]
      .idempotencyKey;
    view.unmount();
    mount();
    expect(
      (
        (await screen.findByPlaceholderText(
          /Fix login bug/,
        )) as HTMLTextAreaElement
      ).value,
    ).toBe("Retry this task");
    fireEvent.click(screen.getByRole("button", { name: /Save 1 to backlog/ }));
    await waitFor(() => expect(postCaptureBatch).toHaveBeenCalledTimes(2));
    expect(
      (postCaptureBatch as jest.Mock).mock.calls[1][0].idempotencyKey,
    ).toBe(firstKey);
  } finally {
    if (original)
      Object.defineProperty(globalThis.crypto, "randomUUID", original);
    else Reflect.deleteProperty(globalThis.crypto, "randomUUID");
  }
});

test("capture clears the previous account's draft from memory on account switch", async () => {
  const view = mount();
  fireEvent.change(screen.getByPlaceholderText(/Fix login bug/), {
    target: { value: "Alice secret task" },
  });
  mockUserId = "bob";
  view.rerender(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <BrainDumpModal open onClose={jest.fn()} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      (screen.getByPlaceholderText(/Fix login bug/) as HTMLTextAreaElement)
        .value,
    ).toBe(""),
  );
  expect(localStorage.getItem(captureDraftKey("bob"))).not.toContain(
    "Alice secret task",
  );
});

test("organized capture schedules selected buckets and skips noise in one batch", async () => {
  (parseDump as jest.Mock).mockResolvedValue({
    draft: [
      {
        title: "Today task",
        bucket: "today",
        priority: "high",
        energy: "deep_work",
        estimated_minutes: 60,
      },
      {
        title: "Week task",
        bucket: "this_week",
        priority: "normal",
        energy: "shallow",
        estimated_minutes: 30,
      },
      {
        title: "Inbox task",
        bucket: "backlog",
        priority: "low",
        energy: "admin",
        estimated_minutes: 15,
      },
      {
        title: "Ignore idea",
        bucket: "noise",
        priority: "normal",
        energy: "quick_win",
        estimated_minutes: 5,
      },
    ],
  });
  (postCaptureBatch as jest.Mock).mockResolvedValue({ created: 3, tasks: [] });
  const onClose = jest.fn();
  mount(onClose);
  fireEvent.change(screen.getByPlaceholderText(/Fix login bug/), {
    target: { value: "Four thoughts" },
  });
  fireEvent.click(screen.getByRole("button", { name: "AI organize" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Create 4 tasks" }),
  );
  await waitFor(() => expect(postCaptureBatch).toHaveBeenCalledTimes(1));
  const request = (postCaptureBatch as jest.Mock).mock.calls[0][0];
  expect(
    request.items.map(
      (item: { title: string; scheduledDate: string | null }) => [
        item.title,
        item.scheduledDate,
      ],
    ),
  ).toEqual([
    ["Today task", "2026-09-29"],
    ["Week task", "2026-10-04"],
    ["Inbox task", null],
  ]);
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      "Created 3 organized task(s) (skipped 1 noise)",
    ),
  );
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("a delayed successful save does not erase text added while the request was pending", async () => {
  let resolveSave!: (value: unknown) => void;
  (postCaptureBatch as jest.Mock).mockReturnValue(
    new Promise((resolve) => {
      resolveSave = resolve;
    }),
  );
  const onClose = jest.fn();
  mount(onClose);
  const editor = screen.getByPlaceholderText(/Fix login bug/);
  fireEvent.change(editor, { target: { value: "First task" } });
  fireEvent.click(screen.getByRole("button", { name: /Save 1 to backlog/ }));
  await waitFor(() => expect(postCaptureBatch).toHaveBeenCalledTimes(1));
  fireEvent.change(editor, { target: { value: "First task\nNew thought" } });
  resolveSave({ created: 1, tasks: [] });
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Added 1 task(s)"),
  );
  expect(onClose).not.toHaveBeenCalled();
  expect(editor).toHaveValue("First task\nNew thought");
  expect(localStorage.getItem(captureDraftKey("alice"))).toContain(
    "New thought",
  );
});

test("invalid shared schedule blocks batch submission while retaining the typed list", async () => {
  mount();
  const editor = screen.getByPlaceholderText(/Fix login bug/);
  fireEvent.change(editor, { target: { value: "Follow up" } });
  fireEvent.click(
    screen.getByRole("button", { name: /Optional: same schedule/ }),
  );
  fireEvent.change(screen.getByLabelText("Start"), {
    target: { value: "15:00" },
  });
  fireEvent.change(screen.getByLabelText("End"), {
    target: { value: "14:00" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Save 1 to backlog/ }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "End time must be after start time.",
    ),
  );
  expect(postCaptureBatch).not.toHaveBeenCalled();
  expect(editor).toHaveValue("Follow up");
});

test("AI preview lets the user correct buckets and estimates and remove unwanted items", async () => {
  (parseDump as jest.Mock).mockResolvedValue({
    draft: [
      {
        title: "Keep this",
        bucket: "unexpected",
        priority: "urgent",
        energy: "deep_work",
        estimated_minutes: 30,
      },
      {
        title: "Remove this",
        bucket: "backlog",
        priority: "normal",
        energy: "admin",
        estimated_minutes: 20,
      },
    ],
  });
  (postCaptureBatch as jest.Mock).mockResolvedValue({ created: 1, tasks: [] });
  mount();
  fireEvent.change(screen.getByPlaceholderText(/Fix login bug/), {
    target: { value: "Two ideas" },
  });
  fireEvent.click(screen.getByRole("button", { name: "AI organize" }));
  expect(
    await screen.findByRole("button", { name: "Create 2 tasks" }),
  ).toBeInTheDocument();
  // Unknown model bucket safely defaults to Inbox, then remains editable.
  fireEvent.click(screen.getAllByRole("button", { name: "Inbox" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Noise" }));
  fireEvent.click(screen.getByRole("button", { name: "Deep" }));
  fireEvent.click(screen.getByRole("button", { name: "urgent" }));
  const estimate = screen.getAllByRole("spinbutton")[0];
  fireEvent.change(estimate, { target: { value: "0" } });
  const removed = screen
    .getByDisplayValue("Remove this")
    .closest("div.rounded-lg")!;
  fireEvent.click(removed.querySelector('button[title="Remove this item"]')!);
  fireEvent.click(screen.getByRole("button", { name: "Create 1 task" }));
  await waitFor(() => expect(postCaptureBatch).toHaveBeenCalledTimes(1));
  expect((postCaptureBatch as jest.Mock).mock.calls[0][0].items).toEqual([
    expect.objectContaining({
      title: "Keep this",
      scheduledDate: "2026-09-29",
      priority: "high",
      energyLevel: "shallow",
      estimatedMinutes: 1,
    }),
  ]);
});

test("voice capture releases the microphone and appends recognized speech to the draft", async () => {
  const originalRecorder = Object.getOwnPropertyDescriptor(
    window,
    "MediaRecorder",
  );
  const originalDevices = Object.getOwnPropertyDescriptor(
    navigator,
    "mediaDevices",
  );
  const stopTrack = jest.fn();
  class Recorder {
    static isTypeSupported = () => true;
    state = "inactive";
    mimeType = "audio/webm";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({
        data: new Blob(["audio"], { type: "audio/webm" }),
      });
      this.onstop?.();
    }
  }
  Object.defineProperty(window, "MediaRecorder", {
    configurable: true,
    value: Recorder,
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: jest
        .fn()
        .mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }),
    },
  });
  (transcribeAudio as jest.Mock).mockResolvedValue({ text: "Call the team" });
  try {
    mount();
    fireEvent.change(screen.getByPlaceholderText(/Fix login bug/), {
      target: { value: "Existing thought" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record voice memo" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Stop recording" }),
    );
    await waitFor(() =>
      expect(transcribeAudio).toHaveBeenCalledWith(expect.any(Blob)),
    );
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Fix login bug/)).toHaveValue(
        "Existing thought\nCall the team",
      ),
    );
    expect(stopTrack).toHaveBeenCalledTimes(1);
  } finally {
    if (originalRecorder)
      Object.defineProperty(window, "MediaRecorder", originalRecorder);
    else Reflect.deleteProperty(window, "MediaRecorder");
    if (originalDevices)
      Object.defineProperty(navigator, "mediaDevices", originalDevices);
    else Reflect.deleteProperty(navigator, "mediaDevices");
  }
});

test("an explicit shared schedule and area override AI bucket dates for the whole batch", async () => {
  (fetchAreas as jest.Mock).mockResolvedValue([{ id: "work", name: "Work" }]);
  (parseDump as jest.Mock).mockResolvedValue({
    draft: [
      {
        title: "Today idea",
        bucket: "today",
        priority: "normal",
        energy: "shallow",
        estimated_minutes: 15,
      },
      {
        title: "Later idea",
        bucket: "backlog",
        priority: "normal",
        energy: "admin",
        estimated_minutes: 20,
      },
    ],
  });
  (postCaptureBatch as jest.Mock).mockResolvedValue({ created: 2, tasks: [] });
  mount();
  await screen.findByRole("option", { name: "Work" });
  fireEvent.change(screen.getByLabelText("Area"), {
    target: { value: "work" },
  });
  fireEvent.change(screen.getByPlaceholderText(/Fix login bug/), {
    target: { value: "Two thoughts" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: /Optional: same schedule/ }),
  );
  fireEvent.change(screen.getByLabelText("Date"), {
    target: { value: "2026-10-10" },
  });
  fireEvent.change(screen.getByLabelText("Start"), {
    target: { value: "09:00" },
  });
  fireEvent.change(screen.getByLabelText("End"), {
    target: { value: "10:00" },
  });
  fireEvent.change(screen.getByLabelText("Recurrence"), {
    target: { value: "FREQ=WEEKLY" },
  });
  fireEvent.click(screen.getByRole("button", { name: "AI organize" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Create 2 tasks" }),
  );
  await waitFor(() => expect(postCaptureBatch).toHaveBeenCalledTimes(1));
  expect((postCaptureBatch as jest.Mock).mock.calls[0][0].items).toEqual([
    expect.objectContaining({
      areaId: "work",
      title: "Today idea",
      scheduledDate: "2026-10-10",
      scheduledStartTime: "09:00:00",
      scheduledEndTime: "10:00:00",
      recurrenceRule: "FREQ=WEEKLY",
    }),
    expect.objectContaining({
      areaId: "work",
      title: "Later idea",
      scheduledDate: "2026-10-10",
      scheduledStartTime: "09:00:00",
      scheduledEndTime: "10:00:00",
      recurrenceRule: "FREQ=WEEKLY",
    }),
  ]);
});

test("microphone permission failure is reported without losing typed text", async () => {
  const originalRecorder = Object.getOwnPropertyDescriptor(
    window,
    "MediaRecorder",
  );
  const originalDevices = Object.getOwnPropertyDescriptor(
    navigator,
    "mediaDevices",
  );
  Object.defineProperty(window, "MediaRecorder", {
    configurable: true,
    value: class Recorder {},
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: jest.fn().mockRejectedValue(new Error("Permission denied")),
    },
  });
  try {
    mount();
    fireEvent.change(screen.getByPlaceholderText(/Fix login bug/), {
      target: { value: "Typed thought" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record voice memo" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Microphone permission denied. Allow it in your browser, then try again.",
      ),
    );
    expect(screen.getByPlaceholderText(/Fix login bug/)).toHaveValue(
      "Typed thought",
    );
  } finally {
    if (originalRecorder)
      Object.defineProperty(window, "MediaRecorder", originalRecorder);
    else Reflect.deleteProperty(window, "MediaRecorder");
    if (originalDevices)
      Object.defineProperty(navigator, "mediaDevices", originalDevices);
    else Reflect.deleteProperty(navigator, "mediaDevices");
  }
});

test("AI parsing failures retain raw text and a later fallback result can still be reviewed", async () => {
  (parseDump as jest.Mock)
    .mockRejectedValueOnce(new Error("AI unavailable"))
    .mockResolvedValueOnce({ draft: [], model: "fallback" })
    .mockResolvedValueOnce({
      draft: [
        {
          title: "Keep note",
          bucket: "backlog",
          priority: "normal",
          energy: "admin",
          estimated_minutes: 10,
        },
      ],
      model: "fallback",
      warning: "Used local parser",
    });
  mount();
  const editor = screen.getByPlaceholderText(/Fix login bug/);
  fireEvent.change(editor, { target: { value: "Keep note" } });
  fireEvent.click(screen.getByRole("button", { name: "AI organize" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("AI unavailable"),
  );
  expect(parseDump).toHaveBeenCalledTimes(1);
  expect(editor).toHaveValue("Keep note");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "AI organize" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "AI organize" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "AI returned no items. Try editing your text and retry.",
    ),
  );
  expect(parseDump).toHaveBeenCalledTimes(2);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "AI organize" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "AI organize" }));
  await waitFor(() => expect(parseDump).toHaveBeenCalledTimes(3));
  expect(
    await screen.findByRole("heading", { name: "Review parsed tasks" }),
  ).toBeInTheDocument();
  expect(screen.getByDisplayValue("Keep note")).toBeInTheDocument();
  expect(toast.message).toHaveBeenCalledWith(
    "AI was unavailable — used fallback parsing.",
  );
});

test("all-noise preview cannot silently discard every item", async () => {
  (parseDump as jest.Mock).mockResolvedValue({
    draft: [
      {
        title: "Unneeded idea",
        bucket: "noise",
        priority: "low",
        energy: "quick_win",
        estimated_minutes: 5,
      },
    ],
  });
  mount();
  fireEvent.change(screen.getByPlaceholderText(/Fix login bug/), {
    target: { value: "Unneeded idea" },
  });
  fireEvent.click(screen.getByRole("button", { name: "AI organize" }));
  fireEvent.click(await screen.findByRole("button", { name: "Create 1 task" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "All items are tagged 'noise' — change at least one bucket to save.",
    ),
  );
  expect(postCaptureBatch).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue("Unneeded idea")).toBeInTheDocument();
});
