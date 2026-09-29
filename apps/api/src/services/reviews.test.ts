import assert from "node:assert/strict";
import test from "node:test";
import {
  addDaysYmd,
  buildSprintGoal,
  normalizeReviewIntentions,
  reviewPeriodFromWeekStart,
  reviewRevisionMatches,
  sameReviewContent,
  sprintNameFromStart,
} from "./reviews.js";

test("review revision zero only creates a new row and updates require an exact revision", () => {
  assert.equal(reviewRevisionMatches(0, 1, true), true);
  assert.equal(reviewRevisionMatches(0, 1, false), false);
  assert.equal(reviewRevisionMatches(1, 1), true);
  assert.equal(reviewRevisionMatches(1, 2), false);
});

test("a lost completion response can be retried only with the same review content", () => {
  const content = {
    weekStart: "2026-09-28",
    weekEnd: "2026-10-04",
    wins: "Shipped",
    carryover: "",
    intentions: [],
    sprintNotes: "",
  };
  assert.equal(sameReviewContent(content, { ...content }), true);
  assert.equal(
    sameReviewContent(content, { ...content, wins: "Changed" }),
    false,
  );
});

test("review period uses Monday-Sunday and creates a Monday-Friday sprint", () => {
  assert.deepEqual(reviewPeriodFromWeekStart("2026-07-20"), {
    weekStart: "2026-07-20",
    weekEnd: "2026-07-26",
    sprintStart: "2026-07-27",
    sprintEnd: "2026-07-31",
  });
});

test("date arithmetic crosses month boundaries", () => {
  assert.equal(addDaysYmd("2026-07-30", 4), "2026-08-03");
});

test("intentions are trimmed, empty rows removed, and limited to three", () => {
  const rows = normalizeReviewIntentions([
    { text: "  First  ", goalKey: " short:work ", goalLabel: " Ship " },
    { text: "", goalKey: null, goalLabel: null },
    { text: "Second", goalKey: null, goalLabel: null },
    { text: "Third", goalKey: null, goalLabel: null },
    { text: "Fourth", goalKey: null, goalLabel: null },
  ]);
  assert.deepEqual(rows, [
    { text: "First", goalKey: "short:work", goalLabel: "Ship" },
    { text: "Second", goalKey: null, goalLabel: null },
    { text: "Third", goalKey: null, goalLabel: null },
  ]);
});

test("sprint goal keeps intention and linked goal context", () => {
  assert.equal(
    buildSprintGoal(
      [
        {
          text: "Finish mock exam",
          goalKey: "short:professional",
          goalLabel: "Pass exam",
        },
      ],
      "Keep Friday open for corrections",
    ),
    "Top intentions:\n1. Finish mock exam [Pass exam]\n\nSprint notes:\nKeep Friday open for corrections",
  );
  assert.equal(buildSprintGoal([], ""), null);
});

test("sprint names are stable across machine timezones", () => {
  assert.equal(sprintNameFromStart("2026-07-27"), "Week of 27 Jul");
});
