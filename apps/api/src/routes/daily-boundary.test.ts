import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { dailyRoutes } from "./daily.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { pool } from "../db/client.js";
const app = new Hono<AppEnv>();
app.use("*", async (c, next) => {
  c.set("userId", "11111111-1111-4111-8111-111111111111");
  await next();
});
app.route("/api/daily", dailyRoutes);
after(() => pool.end());
const send = (path: string, body: unknown, method = "POST") =>
  app.request(`/api/daily/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test("public clients cannot bypass authentication using claimed ownership", async () => {
  const secured = new Hono<AppEnv>();
  secured.use("*", requireAuth);
  secured.route("/api/daily", dailyRoutes);
  const result = await secured.request("/api/daily/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: "test-auth",
      items: [{ title: "no access" }],
    }),
  });
  assert.equal(result.status, 401);
});
test("capture rejects empty titles, invalid dates and invalid wall times before persistence", async () => {
  for (const item of [
    { title: " " },
    { title: "date", scheduledDate: "2026-02-30" },
    { title: "date", scheduledDate: "2026-13-01" },
    { title: "time", scheduledStartTime: "24:00" },
    { title: "time", scheduledStartTime: "09:61" },
    { title: "end", scheduledEndTime: "10:00" },
    { title: "end", scheduledStartTime: "11:00", scheduledEndTime: "10:00" },
    { title: "estimate", estimatedMinutes: -1 },
  ]) {
    const result = await send("capture", {
      idempotencyKey: "boundary-test",
      items: [item],
    });
    assert.equal(result.status, 422, JSON.stringify(item));
  }
});
test("capture rejects unsupported recurrence instead of storing an inert rule", async () => {
  const result = await send("capture", {
    idempotencyKey: "recurrence-test",
    items: [
      { title: "bad recurrence", recurrenceRule: "FREQ=NOT_A_FREQUENCY" },
    ],
  });
  assert.equal(result.status, 422);
});
test("malformed JSON is a validation response rather than internal failure", async () => {
  const result = await app.request("/api/daily/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal(result.status, 422);
});
test("move rejects duplicate targets, missing revisions and invalid date", async () => {
  const target = {
    targetType: "task",
    targetId: "11111111-1111-4111-8111-111111111111",
    expectedRevision: 1,
  };
  for (const body of [
    { targets: [target, target], scheduledDate: "2026-10-01" },
    {
      targets: [{ ...target, expectedRevision: 0 }],
      scheduledDate: "2026-10-01",
    },
    { targets: [target], scheduledDate: "2026-02-30" },
  ])
    assert.equal(
      (await send("move", { ...body, idempotencyKey: "move-boundary" })).status,
      422,
    );
});
test("focus and preferences reject malformed input before database access", async () => {
  assert.equal(
    (await app.request("/api/daily/focus?date=2026-02-30")).status,
    422,
  );
  assert.equal(
    (
      await send(
        "focus",
        {
          date: "2026-10-01",
          targetType: "area",
          targetId: "11111111-1111-4111-8111-111111111111",
        },
        "PUT",
      )
    ).status,
    422,
  );
  assert.equal(
    (await send("preferences", { timezone: "Mars/Olympus" }, "PATCH")).status,
    422,
  );
});
