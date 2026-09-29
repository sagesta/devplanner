import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { appCors } from "./appCors.js";
const app = new Hono();
app.use("*", appCors("http://localhost:3000, https://planner.home"));
app.put("/api/reviews", (c) => c.json({ ok: true }));
test("review PUT preflight permits configured split-origin bearer requests", async () => {
  const response = await app.request("/api/reviews", {
    method: "OPTIONS",
    headers: {
      Origin: "https://planner.home",
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://planner.home",
  );
  assert.match(
    response.headers.get("access-control-allow-methods") ?? "",
    /PUT/,
  );
  assert.match(
    response.headers.get("access-control-allow-headers") ?? "",
    /Authorization/i,
  );
  assert.equal(
    response.headers.get("access-control-allow-credentials"),
    "true",
  );
});
test("unconfigured and lookalike origins receive no cross-origin authorization", async () => {
  for (const origin of [
    "https://planner.home.attacker.example",
    "https://attacker.example",
    "null",
  ]) {
    const response = await app.request("/api/reviews", {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "PUT" },
    });
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
});
