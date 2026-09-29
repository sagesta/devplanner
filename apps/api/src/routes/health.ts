import { Hono } from "hono";
export type HealthChecks = {
  database: () => Promise<void>;
  redis: () => Promise<void>;
  vector: () => Promise<boolean>;
};
/** Public probes expose availability, never provider errors or credentials. */
export function createHealthRoutes(checks: HealthChecks): Hono {
  const routes = new Hono();
  const probe = async (check: () => Promise<void>) => {
    try {
      await check();
      return "ok" as const;
    } catch {
      return "error" as const;
    }
  };
  routes.get("/", async (c) => {
    const [database, redis] = await Promise.all([
      probe(checks.database),
      probe(checks.redis),
    ]);
    const healthy = database === "ok" && redis === "ok";
    c.header("Cache-Control", "no-store");
    return c.json(
      {
        status: healthy ? "ok" : "degraded",
        uptime: process.uptime(),
        db: { status: database },
        redis: { status: redis },
      },
      healthy ? 200 : 503,
    );
  });
  routes.get("/db", async (c) => {
    const ok = (await probe(checks.database)) === "ok";
    c.header("Cache-Control", "no-store");
    return c.json({ ok }, ok ? 200 : 503);
  });
  routes.get("/vector", async (c) => {
    let ok = false;
    try {
      ok = await checks.vector();
    } catch {
      /* Availability only. */
    }
    c.header("Cache-Control", "no-store");
    return c.json({ ok }, ok ? 200 : 503);
  });
  return routes;
}
