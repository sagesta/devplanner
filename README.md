# DevPlanner

![1-Minute Guide](URL) <!-- Placeholder for your video guide -->

DevPlanner is an intelligent, behavior-aware task planner designed specifically for developers. Built with a calm, modern aesthetic, it helps you seamlessly balance deep work and shallow tasks based on your energy levels and available capacity. DevPlanner automatically adapts to your workflow, learns your peak productivity windows, and shields you from scheduling churn.

> **New to planning?** Read the [Beginner's Planning Guide (PDF)](docs/DevPlanner-Beginners-Planning-Guide.pdf) — how to turn any goal (exams, work, daily life) into months → weeks → days, even with no structure to start from.

> **Product roadmap:** See the [DevPlanner Product Requirements Document](docs/devplanner-product-requirements.md) for the complete requirements, delivery phases, acceptance criteria, and implementation checklist.

## Why DevPlanner?
- **Intelligent Scheduling (3-Level Hierarchy)**: Organizes your work neatly into Sprints → Tasks → Subtasks. (Subtasks are the atomic units of execution).
- **Behavior-Aware Load Balancing**: Adapts your daily/weekly goals to your historical completion behavior instead of setting rigid, punitive deadlines.
- **Cognitive Load Modeling**: Matches tasks to your physical energy and work depth. (e.g. Deep Work vs Admin, High vs Low Energy).
- **Rich Calendar Sync**: Deep two-way integration with both Google Calendar and CalDAV (Apple Calendar, Radicale, etc).
- **Privacy & Ownership**: Easily self-hostable with Docker, enabling complete control over your productivity data.

## Full Tech Stack
- **Web**: Next.js 14, TailwindCSS, dnd-kit (Kanban Board), Lucide Icons.
- **API**: Hono, Drizzle ORM, Postgres (with pgvector for Semantic AI).
- **Infra**: Docker Compose, Redis (for Worker Queues), Radicale (CalDAV server).

---

## 🚀 Quick Start (Self-Hosting using Docker)

### Prerequisites
- Docker + Docker Compose v2
- A domain pointed at your server (or localhost for dev)
- Google Cloud project with a Web OAuth 2.0 client

### 1. Clone & Configure
```bash
git clone https://github.com/sagesta/devplanner.git
cd devplanner
./setup.sh          # creates .env from .env.example
```
**Required `.env` values:**
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: From Google Cloud Console
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY`: From Clerk
- `ALLOWED_EMAILS`: Your comma-separated login emails
- `OPENAI_API_KEY`: For AI functionality (optional)

### 2. Start the Stack

Create the private Docker network shared with InfraGuard once on the VPS:

```bash
docker network create infraguard-observability
```

Then start DevPlanner:

```bash
docker compose up -d --build
```
*Wait a few moments for the database to spin up. The API container will automatically run the schema migrations.*

### 3. Seed Initial Data (Optional)
```bash
docker compose exec api npm run seed:start -w @devplanner/api
```

### 4. Verify Observability

The Docker stack includes Prometheus, Node Exporter, Loki, Grafana Alloy, and CrowdSec. Alloy
collects the API, web, and worker container logs; CrowdSec watches the API's
structured request logs for repeated 401/403 responses.

```bash
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/metrics
curl http://127.0.0.1:3100/ready
curl http://127.0.0.1:9090/-/ready
docker compose exec crowdsec cscli metrics
```

Local endpoints:

| Service | Address | Purpose |
|---|---|---|
| DevPlanner API | `http://127.0.0.1:3001` | Health, application traffic, and `/metrics` |
| Loki | `http://127.0.0.1:3100` | Log query API |
| Prometheus | `http://127.0.0.1:9090` | Metrics query API |
| CrowdSec LAPI | `http://127.0.0.1:8081` | Security decisions |
| Alloy UI | `http://127.0.0.1:12345` | Local collector diagnostics |

The observability APIs bind to loopback by default. On the same VPS, InfraGuard
joins the `infraguard-observability` Docker network and uses these private
aliases: `devplanner-api`, `devplanner-web`, `devplanner-loki`,
`devplanner-prometheus`, and `devplanner-crowdsec`. Do not bind Loki,
Prometheus, or CrowdSec directly to a public interface.

To let InfraGuard create CrowdSec decisions, set the same
`CROWDSEC_MACHINE_ID` and `CROWDSEC_MACHINE_PASSWORD` in both projects and
register the machine once from the DevPlanner directory:

```bash
docker compose exec crowdsec sh -lc 'cscli machines add "$CROWDSEC_MACHINE_ID" --password "$CROWDSEC_MACHINE_PASSWORD" --force'
```

CrowdSec decisions require a compatible bouncer or firewall integration before
they are enforced on network traffic.

Prometheus scrapes `api:3001/metrics` and the internal Node Exporter inside the
Compose network. InfraGuard can query `{job="devplanner"}` in Loki, the standard
`http_requests_total` series, and host CPU, memory, and disk metrics.
DevPlanner is now running at **[http://localhost:3000](http://localhost:3000)**!

---

## 🛠️ Local Node Development

If you prefer to run the Node tools directly on your host rather than inside Docker:

```bash
cd devplanner
./setup.sh
cp apps/web/.env.local.example apps/web/.env.local

# 1. Start only the background infrastructure (DB, Redis, Radicale)
npm run docker:infra          

# 2. Install dependencies
npm install

# 3. Apply schema & extensions
npm run db:vector             
npm run db:push
npm run seed                  

# 4. Start the dev server!
npm run dev                   
```
*Note for WSL Users: Webpack polling on DrvFS (`/mnt/c/`) can be quite slow. For best performance, keep the repo natively inside your WSL Linux filesystem (e.g. `~/code/devplanner`).*

---

## 📅 Calendar Sync

### Google Calendar Setup
1. In the **Google Cloud Console**, enable the **Google Calendar API**.
2. Add your Authorized redirect URI: `http://localhost:3001/api/sync/google/callback` (or your production API URL).
3. Update `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `WEB_APP_URL`, and `CORS_ORIGIN` in `.env`.
4. In DevPlanner: **Settings → Calendar → Connect Google Calendar**.

### CalDAV (Apple, Radicale)
1. In `.env`, configure `CALDAV_CALENDAR_URL`, `CALDAV_USER`, and `CALDAV_PASSWORD`. (For docker, use `http://radicale:5232/youruser/tasks/`).
2. Run the worker `npm run worker` (if running locally natively) to handle background sync queues.
3. In DevPlanner: **Settings → Calendar → Connect CalDAV**.

---

## License
MIT License. See the [LICENSE](LICENSE) file for more information.
