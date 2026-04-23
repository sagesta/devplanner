# DevPlanner API — Observability Context

## Overview

The API ships with three observability pillars: **Prometheus metrics**, **structured JSON logging**, and an **enhanced health check endpoint**. All instrumentation is purely additive — no business logic was modified.

---

## Structured Logging (`src/lib/logger.ts`)

| Field | Value |
|---|---|
| Library | `pino` v9 |
| Format | JSON (stdout) |
| Log level | `LOG_LEVEL` env (default: `info`) |
| Fixed fields | `service: "devplanner-api"`, ISO timestamp |

Every HTTP request emits: `{ method, path, statusCode, durationMs, service, time }`.

Errors emitted via `logger.error({ err, stack, path }, message)`.

---

## Prometheus Metrics (`src/lib/metrics.ts`)

Endpoint: **`GET /metrics`** — public (no auth required), returns Prometheus text format.

| Metric | Type | Labels | Description |
|---|---|---|---|
| `http_requests_total` | Counter | `method`, `path`, `status` | Total HTTP requests handled |
| `http_request_duration_ms` | Histogram | `method`, `path` | Request latency in ms |
| `active_db_connections` | Gauge | — | Active PG pool connections (future use) |
| `task_created_total` | Counter | — | Tasks created via POST /api/tasks and brain-dump |
| `bullmq_jobs_total` | Counter | `queue`, `status` | Jobs enqueued per BullMQ queue |

Path labels use Hono's `routePath` (e.g. `/api/tasks/:id`) to prevent high-cardinality label explosions from UUIDs.

---

## Health Check (`GET /health`)

Returns HTTP `200` when healthy, `503` when degraded.

```json
{
  "status": "ok | degraded",
  "uptime": 1234.5,
  "version": "0.1.0",
  "db": { "status": "ok | error" },
  "redis": { "status": "ok | error" },
  "memory": { "heapUsedMb": 42, "heapTotalMb": 64, "rssMb": 90 }
}
```

Checks performed on every request:
- PostgreSQL: `SELECT 1` via `pg` pool
- Redis: `PING` via a short-lived `ioredis` connection (disconnected immediately after)

---

## Public Paths (no auth)

The following paths bypass `requireAuth`:
- `/`
- `/health`, `/health/db`, `/health/vector`
- `/api/health`
- `/metrics` ← **added for Prometheus scraping**
