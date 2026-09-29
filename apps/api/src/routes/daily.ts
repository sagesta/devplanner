import rrulePkg from "rrule";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types.js";
import {
  capture,
  move,
  getFocus,
  setFocus,
  DailyConflict,
} from "../services/daily.js";
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Invalid calendar date");
const key = z.string().min(8).max(128);
const target = z.object({
  targetType: z.enum(["task", "subtask"]),
  targetId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
});
const captureBody = z.object({
  idempotencyKey: key,
  items: z
    .array(
      z
        .object({
          title: z.string().trim().min(1).max(500),
          areaId: z.string().uuid().optional(),
          scheduledDate: calendarDate.nullable().optional(),
          priority: z.enum(["urgent", "high", "normal", "low"]).optional(),
          energyLevel: z
            .enum(["deep_work", "shallow", "admin", "quick_win"])
            .optional(),
          estimatedMinutes: z
            .number()
            .int()
            .min(1)
            .max(1440)
            .nullable()
            .optional(),
          recurrenceRule: z
            .string()
            .max(2000)
            .refine((value) => {
              try {
                const options = rrulePkg.RRule.parseString(
                  value.replace(/^RRULE:/i, ""),
                );
                return (
                  options.freq !== undefined &&
                  options.freq >= 0 &&
                  options.freq <= 6 &&
                  (options.interval == null || options.interval > 0) &&
                  (options.count == null || options.count > 0)
                );
              } catch {
                return false;
              }
            }, "Invalid recurrence rule")
            .nullable()
            .optional(),
          scheduledStartTime: z
            .string()
            .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
            .nullable()
            .optional(),
          scheduledEndTime: z
            .string()
            .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
            .nullable()
            .optional(),
        })
        .refine(
          (i) =>
            !i.scheduledEndTime ||
            (!!i.scheduledStartTime &&
              i.scheduledEndTime > i.scheduledStartTime),
          "End time must follow start time",
        ),
    )
    .min(1)
    .max(100),
});
const moveBody = z.object({
  idempotencyKey: key,
  scheduledDate: calendarDate,
  targets: z
    .array(target)
    .min(1)
    .max(100)
    .refine(
      (v) => new Set(v.map((t) => t.targetType + t.targetId)).size === v.length,
      "Duplicate targets",
    ),
});
const focusBody = z.object({
  date: calendarDate,
  targetType: z.enum(["task", "subtask"]),
  targetId: z.string().uuid(),
});
export const dailyRoutes = new Hono<AppEnv>();
dailyRoutes.onError((e, c) => {
  if (e instanceof DailyConflict) return c.json({ error: e.message }, 409);
  throw e;
});
dailyRoutes.post("/capture", async (c) => {
  const p = captureBody.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: p.error.flatten() }, 422);
  return c.json(await capture(c.get("userId"), p.data));
});
dailyRoutes.post("/move", async (c) => {
  const p = moveBody.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: p.error.flatten() }, 422);
  return c.json(await move(c.get("userId"), p.data));
});
dailyRoutes.get("/focus", async (c) => {
  const p = calendarDate.safeParse(c.req.query("date"));
  if (!p.success) return c.json({ error: "Invalid date" }, 422);
  return c.json(await getFocus(c.get("userId"), p.data));
});
dailyRoutes.put("/focus", async (c) => {
  const p = focusBody.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: p.error.flatten() }, 422);
  return c.json(await setFocus(c.get("userId"), p.data));
});
dailyRoutes.get("/preferences", async (c) => {
  const { pool } = await import("../db/client.js");
  const row = (
    await pool.query("SELECT timezone FROM users WHERE id=$1", [
      c.get("userId"),
    ])
  ).rows[0];
  return c.json({ timezone: row?.timezone ?? "UTC" });
});
dailyRoutes.patch("/preferences", async (c) => {
  const p = z
    .object({
      timezone: z
        .string()
        .max(64)
        .refine((v) => {
          try {
            new Intl.DateTimeFormat("en", { timeZone: v });
            return true;
          } catch {
            return false;
          }
        }, "Invalid timezone"),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: p.error.flatten() }, 422);
  const { pool } = await import("../db/client.js");
  await pool.query("UPDATE users SET timezone=$1 WHERE id=$2", [
    p.data.timezone,
    c.get("userId"),
  ]);
  return c.json(p.data);
});
