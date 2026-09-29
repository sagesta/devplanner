import { test } from "node:test";
import assert from "node:assert/strict";
import { createRedisConnection } from "./connection.js";
test("request connections reject unavailable Redis instead of queuing forever", async () => {
  const connection = createRedisConnection("request", "redis://127.0.0.1:1");
  connection.on("error", () => {});
  try {
    const started = Date.now();
    await assert.rejects(connection.ping());
    assert.ok(
      Date.now() - started < 2000,
      "request should fail promptly without a live server",
    );
  } finally {
    connection.disconnect();
  }
});
test("worker consumers retain the reconnect contract required by BullMQ", () => {
  const connection = createRedisConnection("worker", "redis://127.0.0.1:1");
  connection.on("error", () => {});
  try {
    assert.equal(connection.options.maxRetriesPerRequest, null);
    assert.equal(connection.options.enableOfflineQueue, true);
  } finally {
    connection.disconnect();
  }
});
