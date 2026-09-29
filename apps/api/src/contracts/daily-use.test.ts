import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { calendarDate } from "../routes/daily.js";
import { requestHash } from "../services/daily.js";
import {
  consumeOAuthState,
  type OAuthAttemptStore,
} from "../google/oauth-state.js";

test("calendar parser accepts real UTC calendar days across years", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 73048 }), (days) => {
      const date = new Date(Date.UTC(1900, 0, 1) + days * 86400000)
        .toISOString()
        .slice(0, 10);
      assert.equal(calendarDate.safeParse(date).success, true);
    }),
    { seed: 290926, numRuns: 500 },
  );
});
test("invalid calendar text never throws and normalized impossible dates fail", () => {
  fc.assert(
    fc.property(fc.string(), (value) => {
      const parsed = calendarDate.safeParse(value);
      if (parsed.success)
        assert.equal(
          new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10),
          value,
        );
    }),
    { seed: 290926, numRuns: 1000 },
  );
  for (const date of [
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-00-01",
    "2026-01-00",
  ])
    assert.equal(calendarDate.safeParse(date).success, false);
});
test("idempotency digest is independent of object property insertion order", () => {
  fc.assert(
    fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (value) => {
      const reversed = Object.fromEntries(Object.entries(value).reverse());
      assert.equal(requestHash(value), requestHash(reversed));
    }),
    { seed: 290926, numRuns: 300 },
  );
});
test("arbitrary OAuth state cannot authorize without an owned stored attempt", async () => {
  const store: OAuthAttemptStore = {
    async insert() {},
    async consume() {
      return false;
    },
  };
  await fc.assert(
    fc.asyncProperty(fc.anything(), async (state) =>
      assert.equal(
        await consumeOAuthState(store, state, "synthetic-owner"),
        false,
      ),
    ),
    { seed: 290926, numRuns: 500 },
  );
});
