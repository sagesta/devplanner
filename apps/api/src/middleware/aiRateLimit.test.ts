import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { createAiRateLimit } from "./aiRateLimit.js";
function app(
  redis: {
    incr: (key: string) => Promise<number>;
    expire: (key: string, seconds: number) => Promise<unknown>;
  },
  owner = true,
) {
  const a = new Hono();
  a.use("*", async (c, next) => {
    if (owner) c.set("userId" as never, "owner" as never);
    await next();
  });
  a.use(
    "*",
    createAiRateLimit(() => redis as never),
  );
  a.get("*", (c) => c.json({ called: true }));
  return a;
}
test("AI guard fails closed on Redis outage without leaking connection details", async () => {
  const a = app({
    incr: async () => {
      throw new Error("redis://private-secret");
    },
    expire: async () => 1,
  });
  const r = await a.request("/api/ai/models");
  assert.equal(r.status, 503);
  assert.equal(r.headers.get("Retry-After"), "60");
  assert.deepEqual(await r.json(), {
    error: "AI is temporarily unavailable. Please retry shortly.",
  });
  const normal = await a.request("/api/tasks");
  assert.equal(normal.status, 200);
});
test("AI guard rejects missing owner and enforces the configured count window", async () => {
  let key = "";
  let expiry = 0;
  const redis = {
    incr: async (k: string) => {
      key = k;
      return 1;
    },
    expire: async (_k: string, seconds: number) => {
      expiry = seconds;
      return 1;
    },
  };
  assert.equal((await app(redis, false).request("/api/ai/models")).status, 401);
  assert.equal((await app(redis).request("/api/ai/models")).status, 200);
  assert.equal(key, "ai:ratelimit:owner");
  assert.equal(expiry, 60);
  assert.equal(
    (await app({ ...redis, incr: async () => 10001 }).request("/api/ai/models"))
      .status,
    429,
  );
});
