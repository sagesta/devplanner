import { EventEmitter } from "node:events";

/** In-process fan-out for SSE (single API instance). Replace with Redis pub/sub for horizontal scale. */
export const userEventBus = new EventEmitter();
userEventBus.setMaxListeners(200);

export type IdlePayload = {
  type: "idle_task";
  userId: string;
  taskId: string;
  title: string;
  message: string;
};

export type ConnectedPayload = {
  type: "connected";
  userId: string;
};

export type CaldavPayload = {
  type: "caldav_queued";
  userId: string;
  taskId?: string;
  message?: string;
};

export type HeartbeatPayload = {
  type: "heartbeat";
  t?: number;
};

export type SsePayload = IdlePayload | ConnectedPayload | CaldavPayload | HeartbeatPayload;

export function emitUserEvent(userId: string, payload: SsePayload) {
  userEventBus.emit(userId, payload);
}
