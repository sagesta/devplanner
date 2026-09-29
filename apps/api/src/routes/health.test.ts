import { test } from "node:test";
import assert from "node:assert/strict";
import { createHealthRoutes } from "./health.js";
test("public health responses never reveal underlying database or Redis secrets", async () => {
  const fail = async () => {
    throw new Error(
      "postgres://private-user:CANARY-secret@internal-host/private-db",
    );
  };
  const app = createHealthRoutes({ database: fail, redis: fail, vector: fail });
  for (const path of ["/", "/db", "/vector"]) {
    const response = await app.request(path);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(
      await response.text(),
      /CANARY|private-user|internal-host/,
    );
  }
});
test("health probes reflect dependency availability without modifying the database", async () => {
  let vectorCalls = 0;
  const app = createHealthRoutes({
    database: async () => {},
    redis: async () => {},
    vector: async () => {
      vectorCalls++;
      return false;
    },
  });
  assert.equal((await app.request("/")).status, 200);
  assert.equal((await app.request("/db")).status, 200);
  assert.equal((await app.request("/vector")).status, 503);
  assert.equal(vectorCalls, 1);
  const ready = createHealthRoutes({
    database: async () => {},
    redis: async () => {},
    vector: async () => true,
  });
  assert.equal((await ready.request("/vector")).status, 200);
});
