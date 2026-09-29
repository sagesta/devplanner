import test from "node:test";
import assert from "node:assert/strict";
import {
  issueOAuthState,
  consumeOAuthState,
  hashOAuthState,
  OAUTH_TTL_MS,
  type OAuthAttemptStore,
} from "./oauth-state.js";
function fakeStore(): OAuthAttemptStore {
  const rows = new Map<string, { userId: string; expiresAt: Date }>();
  return {
    async insert(key, userId, expiresAt) {
      rows.set(key, { userId, expiresAt });
    },
    async consume(key, userId, now) {
      const row = rows.get(key);
      if (!row || row.userId !== userId || row.expiresAt <= now) return false;
      rows.delete(key);
      return true;
    },
  };
}
test("state is opaque, unique, owned and single use", async () => {
  const store = fakeStore();
  const state = await issueOAuthState(store, "owner");
  assert.equal(state.length, 43);
  assert.notEqual(state, await issueOAuthState(store, "owner"));
  assert.notEqual(hashOAuthState(state), state);
  assert.equal(await consumeOAuthState(store, state, "other"), false);
  assert.equal(await consumeOAuthState(store, state, "owner"), true);
  assert.equal(await consumeOAuthState(store, state, "owner"), false);
});
test("expired, modified, missing and legacy states fail", async () => {
  const store = fakeStore();
  const now = new Date("2026-09-29T00:00:00Z");
  const state = await issueOAuthState(store, "owner", now);
  assert.equal(
    await consumeOAuthState(
      store,
      state,
      "owner",
      new Date(+now + OAUTH_TTL_MS),
    ),
    false,
  );
  for (const invalid of [
    undefined,
    null,
    "",
    Buffer.from('{"u":"owner"}').toString("base64url"),
    state + "a",
  ]) {
    assert.equal(await consumeOAuthState(store, invalid, "owner", now), false);
  }
});
test("concurrent callbacks only consume once", async () => {
  const store = fakeStore();
  const state = await issueOAuthState(store, "owner");
  const results = await Promise.all([
    consumeOAuthState(store, state, "owner"),
    consumeOAuthState(store, state, "owner"),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
});
