import { Queue } from "bullmq";
import { createRedisConnection } from "./connection.js";

let caldavSyncQueue: Queue | null = null;
let caldavPullQueue: Queue | null = null;
let googleCalendarSyncQueue: Queue | null = null;
let googleCalendarPullQueue: Queue | null = null;

function getCaldavQueue(): Queue | null {
  if (!caldavSyncQueue) {
    try {
      caldavSyncQueue = new Queue("caldav-sync", { connection: createRedisConnection() });
    } catch (e) {
      console.warn("[caldav queue] Failed to create queue — Redis unavailable:", e);
      return null;
    }
  }
  return caldavSyncQueue;
}

function getCaldavPullQueue(): Queue | null {
  if (!caldavPullQueue) {
    try {
      caldavPullQueue = new Queue("caldav-pull", { connection: createRedisConnection() });
    } catch (e) {
      console.warn("[caldav pull queue] Failed to create queue — Redis unavailable:", e);
      return null;
    }
  }
  return caldavPullQueue;
}

function getGoogleCalendarSyncQueue(): Queue | null {
  if (!googleCalendarSyncQueue) {
    try {
      googleCalendarSyncQueue = new Queue("google-calendar-sync", { connection: createRedisConnection() });
    } catch (e) {
      console.warn("[google-calendar-sync queue] Redis unavailable:", e);
      return null;
    }
  }
  return googleCalendarSyncQueue;
}

function getGoogleCalendarPullQueue(): Queue | null {
  if (!googleCalendarPullQueue) {
    try {
      googleCalendarPullQueue = new Queue("google-calendar-pull", { connection: createRedisConnection() });
    } catch (e) {
      console.warn("[google-calendar-pull queue] Redis unavailable:", e);
      return null;
    }
  }
  return googleCalendarPullQueue;
}

export type CaldavSyncJob = {
  userId: string;
  taskId: string;
  /** Stable iCal UID fragment; required so DELETE can run after the task row is gone */
  caldavUid: string;
  /** When set, DELETE/PUT target this filename inside the collection */
  resourceFilename?: string | null;
  action: "create" | "update" | "delete";
};

export async function enqueueCaldavSync(payload: CaldavSyncJob) {
  try {
    const queue = getCaldavQueue();
    if (!queue) return; // Redis not available — silently skip
    await queue.add("sync", payload, { removeOnComplete: 100, removeOnFail: 50 });
  } catch (e) {
    console.warn("[caldav queue] unavailable:", e);
  }
}

export async function enqueueCaldavPull(payload: { userId: string }) {
  try {
    const queue = getCaldavPullQueue();
    if (!queue) return;
    await queue.add("pull", payload, { removeOnComplete: 50, removeOnFail: 25 });
  } catch (e) {
    console.warn("[caldav pull queue] unavailable:", e);
  }
}

export type GoogleCalendarSyncJob = {
  userId: string;
  /** Kept for logs / SSE even when the task row is already deleted. */
  taskId: string;
  googleEventId?: string | null;
  action: "create" | "update" | "delete";
};

export async function enqueueGoogleCalendarSync(payload: GoogleCalendarSyncJob) {
  try {
    const queue = getGoogleCalendarSyncQueue();
    if (!queue) return;
    await queue.add("sync", payload, { removeOnComplete: 100, removeOnFail: 50 });
  } catch (e) {
    console.warn("[google-calendar-sync queue] unavailable:", e);
  }
}

export async function enqueueGoogleCalendarPull(payload: { userId: string }) {
  try {
    const queue = getGoogleCalendarPullQueue();
    if (!queue) return;
    await queue.add("pull", payload, { removeOnComplete: 50, removeOnFail: 25 });
  } catch (e) {
    console.warn("[google-calendar-pull queue] unavailable:", e);
  }
}

/** CalDAV (Radicale) + Google Calendar — each worker no-ops if that side is not configured. */
export async function enqueueTaskCalendarSync(p: {
  userId: string;
  taskId: string;
  caldavUid: string | null;
  resourceFilename?: string | null;
  googleEventId?: string | null;
  action: "create" | "update" | "delete";
}) {
  const caldavUid = p.caldavUid?.trim() || null;
  if (caldavUid) {
    await enqueueCaldavSync({
      userId: p.userId,
      taskId: p.taskId,
      caldavUid,
      resourceFilename: p.resourceFilename,
      action: p.action,
    }).catch(() => {});
  }
  await enqueueGoogleCalendarSync({
    userId: p.userId,
    taskId: p.taskId,
    googleEventId: p.googleEventId,
    action: p.action,
  }).catch(() => {});
}
