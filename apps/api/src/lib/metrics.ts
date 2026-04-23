import { Registry, Counter, Histogram, Gauge } from "prom-client";

/** Dedicated registry — does not pollute the prom-client default registry. */
export const registry = new Registry();

registry.setDefaultLabels({ app: "devplanner-api" });

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests handled",
  labelNames: ["method", "path", "status"] as const,
  registers: [registry],
});

export const httpRequestDurationMs = new Histogram({
  name: "http_request_duration_ms",
  help: "HTTP request duration in milliseconds",
  labelNames: ["method", "path"] as const,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [registry],
});

export const activeDbConnections = new Gauge({
  name: "active_db_connections",
  help: "Number of active PostgreSQL pool connections",
  registers: [registry],
});

export const taskCreatedTotal = new Counter({
  name: "task_created_total",
  help: "Total number of tasks created",
  registers: [registry],
});

export const bullmqJobsTotal = new Counter({
  name: "bullmq_jobs_total",
  help: "Total BullMQ jobs enqueued",
  labelNames: ["queue", "status"] as const,
  registers: [registry],
});
