import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.js";
import type { ScheduleProposal } from "../services/scheduler.js";
import { applyScheduleProposals, buildSchedulePreview } from "../services/scheduler.js";
import type { AppEnv } from "../types.js";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const previewBody = z.object({
  fromDate: ymd,
  horizonEnd: ymd,
});

const proposalBody = z.object({
  id: z.string(),
  targetType: z.enum(["task", "subtask"]),
  targetId: z.string().uuid(),
  title: z.string(),
  fromDate: ymd,
  toDate: ymd,
  estimatedMinutes: z.number().int().min(0).max(480),
  priority: z.string(),
  workDepth: z.string().nullable(),
  physicalEnergy: z.string().nullable(),
  reason: z.string(),
  risk: z.enum(["low", "medium", "high"]),
});

const applyBody = z.object({
  proposals: z.array(proposalBody).min(1).max(200),
});

function assertDateOrder(fromDate: string, horizonEnd: string) {
  if (horizonEnd < fromDate) {
    throw new Error("horizonEnd must be on or after fromDate");
  }
  const days = (Date.parse(`${horizonEnd}T12:00:00`) - Date.parse(`${fromDate}T12:00:00`)) / 86_400_000;
  if (days > 90) {
    throw new Error("schedule previews are limited to 90 days");
  }
}

export const scheduleRoutes = new Hono<AppEnv>()
  .post("/preview", async (c) => {
    const parsed = previewBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 422);
    const { fromDate, horizonEnd } = parsed.data;
    try {
      assertDateOrder(fromDate, horizonEnd);
    } catch (e) {
      return c.json({ error: String(e) }, 422);
    }

    const userId = c.get("userId");
    const result = await buildSchedulePreview(db, userId, { fromDate, horizonEnd });
    return c.json(result);
  })
  .post("/apply", async (c) => {
    const parsed = applyBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 422);

    const userId = c.get("userId");
    const result = await applyScheduleProposals(db, userId, parsed.data.proposals as ScheduleProposal[]);
    return c.json(result);
  });
