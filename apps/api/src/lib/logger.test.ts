import test from "node:test";
import assert from "node:assert/strict";
import { safeError } from "./logger.js";
test("error serialization excludes credential and planning-content canaries", () => {
  const error = Object.assign(new Error("CANARY_SECRET task details"), {
    code: "23505",
    response: { access_token: "CANARY_SECRET" },
    query: "private planning data",
  });
  assert.deepEqual(safeError(error), { type: "Error", code: "23505" });
  assert.equal(JSON.stringify(safeError(error)).includes("CANARY"), false);
  assert.deepEqual(
    safeError({ name: "secret-name", code: "sensitive error with spaces" }),
    { type: "Error" },
  );
});
