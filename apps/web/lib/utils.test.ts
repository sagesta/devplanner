import {
  cn,
  displayPhysicalEnergy,
  displayWorkDepth,
  isTaskOverdue,
} from "./utils";

test("only unfinished tasks scheduled or due before the calendar date are overdue", () => {
  const today = "2026-09-29";
  expect(isTaskOverdue({ dueDate: "2026-09-28", status: "todo" }, today)).toBe(
    true,
  );
  expect(
    isTaskOverdue(
      { dueDate: null, scheduledDate: "2026-09-28", status: "todo" },
      today,
    ),
  ).toBe(true);
  expect(isTaskOverdue({ dueDate: "2026-09-29", status: "todo" }, today)).toBe(
    false,
  );
  expect(isTaskOverdue({ dueDate: "2026-09-28", status: "done" }, today)).toBe(
    false,
  );
  expect(
    isTaskOverdue(
      { dueDate: null, scheduledDate: "2026-09-28", status: "cancelled" },
      today,
    ),
  ).toBe(false);
  expect(
    isTaskOverdue({ dueDate: " 2026-09-28 ", status: "blocked" }, today),
  ).toBe(true);
});

test("explicit work and physical energy values override compatibility defaults", () => {
  expect(displayWorkDepth({ workDepth: "focused", energyLevel: "admin" })).toBe(
    "focused",
  );
  expect(displayWorkDepth({ energyLevel: "deep_work" })).toBe("deep");
  expect(displayWorkDepth({ energyLevel: "quick_win" })).toBe("normal");
  expect(displayWorkDepth({ energyLevel: "unknown" })).toBe("normal");
  expect(displayPhysicalEnergy({ physicalEnergy: "high" })).toBe("high");
  expect(displayPhysicalEnergy({})).toBe("medium");
});

test("class composition resolves conflicting Tailwind utilities", () => {
  expect(cn("px-2 text-sm", false && "hidden", "px-4")).toBe("text-sm px-4");
});
