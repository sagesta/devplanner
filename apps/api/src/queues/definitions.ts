import { Queue } from "bullmq";
import { createRedisConnection } from "./connection.js";

let caldavSyncQueue: Queue | null = null;

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

export async function enqueueCaldavSync(payload: {
  userId: string;
  taskId: string;
  action: "create" | "update" | "delete";
}) {
  try {
    const queue = getCaldavQueue();
    if (!queue) return; // Redis not available — silently skip
    await queue.add("sync", payload, { removeOnComplete: 100, removeOnFail: 50 });
  } catch (e) {
    console.warn("[caldav queue] unavailable:", e);
  }
}
