/**
 * Run: npm run worker (from devplanner root) or npm run worker -w @devplanner/api
 * Requires Redis. CalDAV push/pull + idle scan (15m).
 */
import { Worker } from "bullmq";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { caldavEnabled } from "../caldav/config.js";
import { buildTaskVcalendar } from "../caldav/ical.js";
import { runCaldavPullForUser, listUserIdsForCaldavPull } from "../caldav/pull-sync.js";
import {
  deleteCalendarResourceByFilename,
  objectFilenameForTask,
  putCalendarResourceByFilename,
} from "../caldav/radicale-client.js";
import { db } from "../db/client.js";
import { caldavSyncLog, tasks } from "../db/schema.js";
import { emitUserEvent } from "../lib/bus.js";
import { createRedisConnection } from "../queues/connection.js";
import {
  enqueueCaldavPull,
  enqueueGoogleCalendarPull,
  type CaldavSyncJob,
  type GoogleCalendarSyncJob,
} from "../queues/definitions.js";
import { listGoogleLinkedUserIds } from "../google/auth.js";
import { runGooglePushJob, runGooglePullForUser } from "../google/sync-engine.js";

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

async function logCaldavRow(input: {
  userId: string;
  taskId: string | null;
  eventUid: string;
  action: "create" | "update" | "delete";
  error: string | null;
}) {
  await db.insert(caldavSyncLog).values({
    userId: input.userId,
    taskId: input.taskId,
    eventUid: input.eventUid,
    action: input.action,
    error: input.error,
  });
}

const syncWorker = new Worker(
  "caldav-sync",
  async (job) => {
    const data = job.data as Partial<CaldavSyncJob>;
    if (!data.userId || !data.taskId || !data.caldavUid || !data.action) {
      console.warn("[caldav-sync] Invalid job payload. Flush Redis if upgrading.");
      return;
    }
    const { userId, taskId, caldavUid, action, resourceFilename } = data;

    if (!caldavEnabled()) {
      console.log("[caldav-sync] Skipped — set CALDAV_CALENDAR_URL and CALDAV_USER in API .env");
      return;
    }

    const filename = resourceFilename?.trim() || `${caldavUid}.ics`;

    if (action === "delete") {
      const result = await deleteCalendarResourceByFilename(filename);
      await logCaldavRow({
        userId,
        taskId: null,
        eventUid: caldavUid,
        action: "delete",
        error: result.ok ? null : `DELETE ${result.status}: ${result.detail}`,
      });
      if (result.ok) {
        emitUserEvent(userId, { type: "caldav_queued", userId, taskId, message: "Calendar event removed" });
      }
      return;
    }

    const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
    if (!task) {
      await logCaldavRow({
        userId,
        taskId,
        eventUid: caldavUid,
        action,
        error: "task not found (skipped PUT)",
      });
      return;
    }

    const effectiveCaldavUid = task.caldavUid?.trim() || caldavUid;

    const ics = buildTaskVcalendar({
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      scheduledDate: task.scheduledDate,
      scheduledStartTime: task.scheduledStartTime,
      scheduledEndTime: task.scheduledEndTime,
      dueDate: task.dueDate,
      estimatedMinutes: task.estimatedMinutes,
      recurrenceRule: task.recurrenceRule,
      caldavUid: effectiveCaldavUid,
      icalUid: task.icalUid,
    });

    const fn = objectFilenameForTask(task);

    if (!ics) {
      await deleteCalendarResourceByFilename(fn).catch(() => {});
      await logCaldavRow({
        userId,
        taskId,
        eventUid: caldavUid,
        action,
        error: null,
      });
      return;
    }

    const put = await putCalendarResourceByFilename(fn, ics);
    await logCaldavRow({
      userId,
      taskId,
      eventUid: caldavUid,
      action,
      error: put.ok ? null : `PUT ${put.status}: ${put.detail}`,
    });
    if (put.ok) {
      if (!task.icalUid?.trim()) {
        await db
          .update(tasks)
          .set({ icalUid: `${effectiveCaldavUid}@devplanner`, updatedAt: task.updatedAt })
          .where(eq(tasks.id, task.id));
      }
      emitUserEvent(userId, {
        type: "caldav_queued",
        userId,
        taskId,
        message: "Synced to calendar",
      });
    }
  },
  { connection }
);

const pullWorker = new Worker(
  "caldav-pull",
  async (job) => {
    const { userId } = job.data as { userId?: string };
    if (!userId) return;
    const stats = await runCaldavPullForUser(userId);
    console.log(`[caldav-pull] user=${userId}`, stats);
    const msg = `Calendar pull: +${stats.imported} updated ${stats.updated} removed ${stats.removed} skipped ${stats.skipped}`;
    if (stats.errors.length) {
      console.warn("[caldav-pull] errors:", stats.errors.slice(0, 5));
    }
    emitUserEvent(userId, { type: "caldav_queued", userId, message: msg });
  },
  { connection }
);

const googleSyncWorker = new Worker(
  "google-calendar-sync",
  async (job) => {
    const data = job.data as Partial<GoogleCalendarSyncJob>;
    if (!data.userId || !data.taskId || !data.action) {
      console.warn("[google-calendar-sync] Invalid job payload.");
      return;
    }
    const r = await runGooglePushJob({
      userId: data.userId,
      taskId: data.taskId,
      googleEventId: data.googleEventId,
      action: data.action,
    });
    if (r.skipped) return;
    const eventUid = data.googleEventId?.trim() || data.taskId;
    await logCaldavRow({
      userId: data.userId,
      taskId: data.action === "delete" ? null : data.taskId,
      eventUid,
      action: data.action,
      error: r.ok ? null : r.detail ?? "Google Calendar sync failed",
    });
    if (r.ok) {
      emitUserEvent(data.userId, {
        type: "caldav_queued",
        userId: data.userId,
        taskId: data.taskId,
        message:
          data.action === "delete"
            ? "Removed from Google Calendar"
            : "Synced to Google Calendar",
      });
    }
  },
  { connection }
);

const googlePullWorker = new Worker(
  "google-calendar-pull",
  async (job) => {
    const { userId } = job.data as { userId?: string };
    if (!userId) return;
    const stats = await runGooglePullForUser(userId);
    console.log(`[google-calendar-pull] user=${userId}`, stats);
    const msg = `Google Calendar: +${stats.imported} updated ${stats.updated} removed ${stats.removed} skipped ${stats.skipped}`;
    if (stats.errors.length) {
      console.warn("[google-calendar-pull] errors:", stats.errors.slice(0, 5));
    }
    emitUserEvent(userId, { type: "caldav_queued", userId, message: msg });
  },
  { connection }
);

const pullIntervalMs = Math.max(0, Number(process.env.CALDAV_PULL_INTERVAL_MS ?? "0"));
const googlePullIntervalMs = Math.max(0, Number(process.env.GOOGLE_CALENDAR_PULL_INTERVAL_MS ?? "0"));
let pullTimer: ReturnType<typeof setInterval> | null = null;
if (pullIntervalMs > 0) {
  pullTimer = setInterval(() => {
    void (async () => {
      try {
        if (!caldavEnabled()) return;
        const ids = await listUserIdsForCaldavPull();
        for (const uid of ids) {
          await enqueueCaldavPull({ userId: uid });
        }
      } catch (e) {
        console.error("[caldav-pull] schedule error:", e);
      }
    })();
  }, pullIntervalMs);
  console.log(`[worker] CalDAV periodic pull every ${pullIntervalMs}ms (when CALDAV_* set)`);
}

let googlePullTimer: ReturnType<typeof setInterval> | null = null;
if (googlePullIntervalMs > 0) {
  googlePullTimer = setInterval(() => {
    void (async () => {
      try {
        const ids = await listGoogleLinkedUserIds();
        for (const uid of ids) {
          await enqueueGoogleCalendarPull({ userId: uid });
        }
      } catch (e) {
        console.error("[google-calendar-pull] schedule error:", e);
      }
    })();
  }, googlePullIntervalMs);
  console.log(`[worker] Google Calendar periodic pull every ${googlePullIntervalMs}ms`);
}

function shutdown(signal: string) {
  console.log(`\n[worker] Received ${signal}, shutting down…`);
  if (pullTimer) clearInterval(pullTimer);
  if (googlePullTimer) clearInterval(googlePullTimer);
  Promise.all([
    syncWorker.close(),
    pullWorker.close(),
    googleSyncWorker.close(),
    googlePullWorker.close(),
  ])
    .then(() => {
      console.log("[worker] Closed cleanly");
      process.exit(0);
    })
    .catch(() => process.exit(1));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log(
  "DevPlanner worker: idle scan + CalDAV + Google Calendar push/pull (when configured; Redis + npm run worker)"
);
