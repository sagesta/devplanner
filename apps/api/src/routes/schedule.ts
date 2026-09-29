import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import { DailyConflict } from "../services/daily.js";
import { calendarDate } from "./daily.js";
import {
  applyScheduleProposals,
  buildSchedulePreview,
} from "../services/scheduler.js";
import type { AppEnv } from "../types.js";

const ymd = calendarDate;

const previewBody = z.object({
  fromDate: ymd,
  horizonEnd: ymd,
});

const applyBody = z.object({
  previewId: z.string().uuid(),
  selectedIds: z.array(z.string()).min(1).max(200),
  idempotencyKey: z.string().min(8).max(128),
});

function assertDateOrder(fromDate: string, horizonEnd: string) {
  if (horizonEnd < fromDate) {
    throw new Error("horizonEnd must be on or after fromDate");
  }
  const days =
    (Date.parse(`${horizonEnd}T12:00:00`) -
      Date.parse(`${fromDate}T12:00:00`)) /
    86_400_000;
  if (days > 90) {
    throw new Error("schedule previews are limited to 90 days");
  }
}

export const scheduleRoutes = new Hono<AppEnv>()
  .onError((e, c) => {
    if (e instanceof DailyConflict) return c.json({ error: e.message }, 409);
    throw e;
  })
  .post("/preview", async (c) => {
    const parsed = previewBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 422);
    const { fromDate, horizonEnd } = parsed.data;
    try {
      assertDateOrder(fromDate, horizonEnd);
    } catch (e) {
      return c.json({ error: String(e) }, 422);
    }

    const userId = c.get("userId");
    const result = await buildSchedulePreview(db, userId, {
      fromDate,
      horizonEnd,
    });
    return c.json(result);
  })
  .post("/apply", async (c) => {
    const parsed = applyBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 422);

    const userId = c.get("userId");
    const result = await applyScheduleProposals(db, userId, parsed.data);
    return c.json(result);
  });
