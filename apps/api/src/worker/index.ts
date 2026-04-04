/**
 * Run: npm run worker (from devplanner root) or npm run worker -w @devplanner/api
 * Requires Redis. CalDAV jobs + periodic idle scan (15m).
 */
import { Worker } from "bullmq";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { caldavSyncLog, tasks } from "../db/schema.js";
import { emitUserEvent } from "../lib/bus.js";
import { createRedisConnection } from "../queues/connection.js";

const connection = createRedisConnection();

async function runIdleScan() {
  try {
    const rows = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.status, "in_progress"),
          isNotNull(tasks.estimatedMinutes),
          sql`${tasks.updatedAt} < NOW() - (${tasks.estimatedMinutes} * 2) * INTERVAL '1 minute'`,
          eq(tasks.idleFlagged, false)
        )
      );

    if (rows.length > 0) {
      console.log(`[idle-scan] Found ${rows.length} idle task(s)`);
    }

    for (const t of rows) {
      await db
        .update(tasks)
        .set({ idleFlagged: true, idleFlaggedAt: new Date(), updatedAt: new Date() })
        .where(eq(tasks.id, t.id));
      emitUserEvent(t.userId, {
        type: "idle_task",
        userId: t.userId,
        taskId: t.id,
        title: t.title,
        message: `You've been on "${t.title}" for a while. Still going?`,
      });
      console.log(`[idle-scan] Flagged: "${t.title}"`);
    }
  } catch (e) {
    console.error("[idle-scan] Error:", e);
  }
}

const intervalMs = 15 * 60 * 1000;
setInterval(() => {
  void runIdleScan();
}, intervalMs);
void runIdleScan();

const worker = new Worker(
  "caldav-sync",
  async (job) => {
    const { userId, taskId, action } = job.data as {
      userId: string;
      taskId: string;
      action: "create" | "update" | "delete";
    };
    console.log(`[caldav-sync] Processing ${action} for task ${taskId}`);
    await db.insert(caldavSyncLog).values({
      userId,
      taskId,
      eventUid: taskId,
      action,
      error: "stub: Radicale HTTP sync not wired; log row created",
    });
  },
  { connection }
);

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`\n[worker] Received ${signal}, shutting down…`);
  worker
    .close()
    .then(() => {
      console.log("[worker] Closed cleanly");
      process.exit(0);
    })
    .catch(() => process.exit(1));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log("DevPlanner worker: idle scan every 15m + caldav-sync queue");
