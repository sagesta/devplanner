import { Hono } from "hono";
import type { AppEnv } from "../types.js";

/** Manual trigger placeholder — task writes already enqueue caldav-sync jobs. */
export const syncRoutes = new Hono<AppEnv>().post("/caldav", (c) => {
  return c.json({
    ok: true,
    message: "CalDAV sync jobs are enqueued on task create/update/delete. Run `npm run worker` with Redis.",
  });
});
