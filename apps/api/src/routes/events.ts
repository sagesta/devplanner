import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { userEventBus, type SsePayload } from "../lib/bus.js";
import type { AppEnv } from "../types.js";

export const eventRoutes = new Hono<AppEnv>().get("/user", async (c) => {
  const userId = c.get("userId");

  return streamSSE(c, async (stream) => {
    const handler = (payload: SsePayload) => {
      void stream.writeSSE({
        data: JSON.stringify(payload),
        event: "message",
      });
    };
    userEventBus.on(userId, handler);

    const ping = setInterval(() => {
      void stream.writeSSE({
        data: JSON.stringify({ type: "heartbeat", t: Date.now() }),
        event: "ping",
      });
    }, 30_000);

    await stream.writeSSE({
      data: JSON.stringify({ type: "connected", userId }),
      event: "message",
    });

    await new Promise<void>((resolve) => {
      c.req.raw.signal.addEventListener("abort", () => resolve(), { once: true });
    });

    clearInterval(ping);
    userEventBus.off(userId, handler);
  });
});
