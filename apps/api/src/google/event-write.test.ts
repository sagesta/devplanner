import test from "node:test";
import assert from "node:assert/strict";
import { writeReservedEvent, type EventWriter } from "./event-write.js";
test("reserved event retries converge after a lost insert response", async () => {
  const events = new Map<string, unknown>();
  let insertions = 0;
  const client: EventWriter = {
    async patch({ eventId, requestBody }) {
      if (!events.has(eventId)) throw { code: 404 };
      events.set(eventId, requestBody);
      return { data: { id: eventId } };
    },
    async insert({ requestBody }) {
      insertions++;
      events.set(requestBody.id!, requestBody);
      throw { code: 503 };
    },
  };
  await assert.rejects(
    writeReservedEvent(client, "synthetic", "abc123", {
      summary: "synthetic",
      iCalUID: "legacy",
    }),
  );
  assert.equal(
    (
      await writeReservedEvent(client, "synthetic", "abc123", {
        summary: "synthetic",
      })
    ).id,
    "abc123",
  );
  assert.equal(insertions, 1);
  assert.equal(events.size, 1);
});
test("transient patch failure never creates another event", async () => {
  let inserts = 0;
  const client: EventWriter = {
    async patch() {
      throw { code: 429 };
    },
    async insert() {
      inserts++;
      return { data: {} };
    },
  };
  await assert.rejects(writeReservedEvent(client, "synthetic", "abc123", {}));
  assert.equal(inserts, 0);
});
test("concurrent insert conflict retries the same reserved event", async () => {
  let patches = 0;
  const client: EventWriter = {
    async patch() {
      if (++patches === 1) throw { code: 404 };
      return { data: { id: "abc123" } };
    },
    async insert() {
      throw { code: 409 };
    },
  };
  assert.equal(
    (await writeReservedEvent(client, "synthetic", "abc123", {})).id,
    "abc123",
  );
  assert.equal(patches, 2);
});
