import {
  captureDraftKey,
  hasUnacknowledgedReviewEdits,
  newDraftIdempotencyKey,
  parseCaptureDraft,
  parseReviewDraft,
  reviewDraftKey,
} from "./draft-storage";

const input = {
  weekStart: "2026-09-28",
  weekEnd: "2026-10-04",
  wins: "Draft win",
  carryover: "",
  intentions: [],
  sprintNotes: "",
};

test("review recovery is bound to the account and week and identifies unsynced edits", () => {
  const envelope = {
    version: 3,
    userId: "alice",
    weekStart: input.weekStart,
    input,
    step: 2,
    editSequence: 4,
    acknowledgedSequence: 3,
    serverRevision: 2,
  };
  const raw = JSON.stringify(envelope);
  expect(parseReviewDraft(raw, "alice", input.weekStart)).toEqual(envelope);
  expect(parseReviewDraft(raw, "bob", input.weekStart)).toBeNull();
  expect(parseReviewDraft(raw, "alice", "2026-10-05")).toBeNull();
  expect(hasUnacknowledgedReviewEdits(envelope as never)).toBe(true);
  expect(
    hasUnacknowledgedReviewEdits({
      ...envelope,
      acknowledgedSequence: 4,
    } as never),
  ).toBe(false);
  expect(parseReviewDraft(null, "alice", input.weekStart)).toBeNull();
  expect(parseReviewDraft("null", "alice", input.weekStart)).toBeNull();
  expect(
    parseReviewDraft(
      JSON.stringify({ ...envelope, version: 2 }),
      "alice",
      input.weekStart,
    ),
  ).toBeNull();
  expect(
    parseReviewDraft(
      JSON.stringify({ ...envelope, editSequence: "4" }),
      "alice",
      input.weekStart,
    ),
  ).toBeNull();
  expect(reviewDraftKey("alice", input.weekStart)).not.toBe(
    reviewDraftKey("bob", input.weekStart),
  );
  expect(
    parseReviewDraft(
      JSON.stringify({ ...envelope, input: { ...input, wins: null } }),
      "alice",
      input.weekStart,
    ),
  ).toBeNull();
  expect(
    parseReviewDraft(
      JSON.stringify({ ...envelope, input: { ...input, intentions: [null] } }),
      "alice",
      input.weekStart,
    ),
  ).toBeNull();
});

test("capture recovery requires matching account and keeps the retry key", () => {
  const envelope = {
    version: 1,
    userId: "alice",
    text: "Task",
    areaId: "",
    scheduledDate: "",
    startT: "",
    endT: "",
    recurrence: "",
    parsedItems: [],
    view: "raw",
    idempotencyKey: "retry-123",
    requestSignature: "payload",
  };
  expect(
    parseCaptureDraft(JSON.stringify(envelope), "alice")?.idempotencyKey,
  ).toBe("retry-123");
  expect(parseCaptureDraft(JSON.stringify(envelope), "bob")).toBeNull();
  expect(parseCaptureDraft("broken", "alice")).toBeNull();
  expect(parseCaptureDraft(null, "alice")).toBeNull();
  expect(
    parseCaptureDraft(JSON.stringify({ ...envelope, version: 2 }), "alice"),
  ).toBeNull();
  expect(
    parseCaptureDraft(
      JSON.stringify({ ...envelope, requestSignature: null }),
      "alice",
    ),
  ).toBeNull();
  expect(
    parseCaptureDraft(
      JSON.stringify({ ...envelope, parsedItems: [{ title: null }] }),
      "alice",
    ),
  ).toBeNull();
  expect(captureDraftKey("alice")).not.toBe(captureDraftKey("bob"));
});

test("capture retry IDs come from the browser random UUID source", () => {
  const original = Object.getOwnPropertyDescriptor(
    globalThis.crypto,
    "randomUUID",
  );
  const randomUUID = jest
    .fn()
    .mockReturnValueOnce("first-id")
    .mockReturnValueOnce("second-id");
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    configurable: true,
    value: randomUUID,
  });
  try {
    expect(newDraftIdempotencyKey()).toBe("first-id");
    expect(newDraftIdempotencyKey()).toBe("second-id");
    expect(randomUUID).toHaveBeenCalledTimes(2);
  } finally {
    if (original)
      Object.defineProperty(globalThis.crypto, "randomUUID", original);
    else Reflect.deleteProperty(globalThis.crypto, "randomUUID");
  }
});

test("malformed draft fields are rejected before they reach the editors", () => {
  const review = {
    version: 3,
    userId: "alice",
    weekStart: input.weekStart,
    input,
    step: 0,
    editSequence: 2,
    acknowledgedSequence: 1,
    serverRevision: 1,
  };
  for (const field of ["carryover", "sprintNotes", "weekEnd"] as const) {
    const bad = { ...review, input: { ...input, [field]: null } };
    expect(
      parseReviewDraft(JSON.stringify(bad), "alice", input.weekStart),
    ).toBeNull();
  }
  for (const field of ["acknowledgedSequence", "serverRevision"] as const) {
    expect(
      parseReviewDraft(
        JSON.stringify({ ...review, [field]: "bad" }),
        "alice",
        input.weekStart,
      ),
    ).toBeNull();
  }
  for (const counters of [
    { editSequence: -1 },
    { acknowledgedSequence: -1 },
    { acknowledgedSequence: 3 },
    { serverRevision: -1 },
  ]) {
    expect(
      parseReviewDraft(
        JSON.stringify({ ...review, ...counters }),
        "alice",
        input.weekStart,
      ),
    ).toBeNull();
  }
  const item = {
    title: "Task",
    bucket: "today",
    priority: "normal",
    energy: "shallow",
    estimated_minutes: 20,
  };
  const capture = {
    version: 1,
    userId: "alice",
    text: "Task",
    areaId: "",
    scheduledDate: "",
    startT: "",
    endT: "",
    recurrence: "",
    parsedItems: [item],
    view: "preview",
    idempotencyKey: "retry-123",
    requestSignature: "payload",
  };
  for (const field of [
    "title",
    "bucket",
    "priority",
    "energy",
    "estimated_minutes",
  ] as const) {
    const bad = { ...capture, parsedItems: [{ ...item, [field]: null }] };
    expect(parseCaptureDraft(JSON.stringify(bad), "alice")).toBeNull();
  }
  for (const field of ["text", "idempotencyKey"] as const) {
    expect(
      parseCaptureDraft(JSON.stringify({ ...capture, [field]: null }), "alice"),
    ).toBeNull();
  }
  expect(
    parseCaptureDraft(
      JSON.stringify({ ...capture, parsedItems: null }),
      "alice",
    ),
  ).toBeNull();
});
