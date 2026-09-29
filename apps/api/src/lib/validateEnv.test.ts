import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { missingRequiredEnvironment } from "./validateEnv.js";
test("basic planning does not require Google or AI credentials", () => {
  assert.deepEqual(
    missingRequiredEnvironment({
      DATABASE_URL: "synthetic-database",
      REDIS_URL: "synthetic-redis",
      CLERK_SECRET_KEY: `fake_${randomUUID()}`,
      ALLOWED_EMAILS: "synthetic@example.invalid",
    }),
    [],
  );
});
test("missing required configuration reports names only", () => {
  assert.deepEqual(missingRequiredEnvironment({ DATABASE_URL: " " }), [
    "DATABASE_URL",
    "REDIS_URL",
    "CLERK_SECRET_KEY",
    "ALLOWED_EMAILS",
  ]);
});
