# DevPlanner

Monorepo for the **DevPlanner** spec (`../DEVPLANNER_BUILD_FLOW.md`). **Excluded:** native mobile (Expo) from the original prompt — web-only here.

## Stack

- **Web:** Next.js 14 (`apps/web`) — Board (dnd-kit), Now, Table, Backlog, Sprints, Review, Settings, brain dump, Ctrl/Cmd+K palette, AI dock, SSE idle banner, light/dark.
- **API:** Hono + Drizzle + Postgres (pgvector) (`apps/api`).
- **Infra:** Docker Compose — Postgres, Redis, Radicale, and **by default** API + web + worker (`docker/Dockerfile.api`, `docker/Dockerfile.web`). Use **`npm run docker:infra`** when you only want DB/Redis/Radicale and run the app with **`npm run dev`** on the host.

## Setup

```bash
cd devplanner
cp .env.example .env
cp apps/web/.env.local.example apps/web/.env.local
npm run docker:infra          # DB + Redis + Radicale only (not the app images)
npm install
# Once per empty database: Drizzle uses pgvector — extension must exist first or db:push errors with "type vector does not exist"
npm run db:vector             # Docker only: runs CREATE EXTENSION in the compose Postgres
npm run db:push
npm run seed
```

If Postgres is **not** from this Compose file, connect as a superuser and run `CREATE EXTENSION IF NOT EXISTS vector;` on the `devplanner` database, then `npm run db:push`.

**Environment variables** are documented in **`.env.example`** (API + worker + Docker build args). Browser-facing `NEXT_PUBLIC_*` vars also belong in **`apps/web/.env.local`** for local Next dev — see **`apps/web/.env.local.example`**.

Edit `apps/web/.env.local` (from `.env.local.example`) — set the printed UUID:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_DEV_USER_ID=<uuid>
```

Optional AI:

```env
OPENAI_API_KEY=sk-...
OPENAI_FAST_MODEL=gpt-4o-mini
OPENAI_SMART_MODEL=gpt-4o-mini
```

### CalDAV calendar (Radicale) — two-way

- **Push (app → CalDAV):** tasks with a **scheduled** or **due** date become VEVENTs; the worker **PUTs** an `.ics` file (and **MKCOL**s missing folders). Deletes **DELETE** the resource. Stable **UID**; imports keep their original UID.
- **Pull (CalDAV → app):** **Settings → Calendar → Pull from calendar now** (or `POST /api/sync/caldav/pull-now`), or queue **`POST /api/sync/caldav/pull`** with Redis + worker. Optional **`CALDAV_PULL_INTERVAL_MS`** on the worker for scheduled pulls.
- **MKCOL:** automatic before each PUT; **Settings** also has **Ensure calendar folder** (`POST /api/sync/caldav/mkcol`).

1. Start Radicale (included in **`npm run docker:infra`**, or use the full compose stack — port **5232**).
2. Set **`CALDAV_CALENDAR_URL`** (trailing `/`), **`CALDAV_USER`**, **`CALDAV_PASSWORD`** in **`devplanner/.env`**.
3. Run **Redis**, **`npm run worker`**, and **`npm install`** (adds **`node-ical`** for pull). Run **`npm run db:push`** after pulling latest schema (new task columns).
4. Optional **`CALDAV_IMPORT_AREA_ID`** — area for imported events; else first area by name.
5. On your phone, add the same **CalDAV** account to see and edit events.

### Google Calendar — setup checklist

Two-way sync uses the **Google Calendar API** (OAuth2 + refresh token in Postgres), not CalDAV. Same rule as CalDAV: only tasks with a **scheduled** or **due** date become calendar events.

1. **Google Cloud Console** — Create or pick a project → **APIs & Services** → enable **Google Calendar API**.
2. **OAuth consent screen** — Configure (External is fine for personal use); add scope **`…/auth/calendar.events`** (Calendar API scope for events).
3. **Credentials** — **Create credentials** → **OAuth client ID** → **Web application**.
4. **Authorized redirect URI** (must match API `.env` exactly):  
   `http://localhost:3001/api/sync/google/callback`  
   (For production, add your real API origin + `/api/sync/google/callback`.)
5. **API `.env`** (repo root `devplanner/.env`, see `.env.example`):
   - `GOOGLE_CLIENT_ID=…`
   - `GOOGLE_CLIENT_SECRET=…`
   - `GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3001/api/sync/google/callback` (in production, use your public API URL + `/api/sync/google/callback` and register it in Google Cloud).
   - `WEB_APP_URL=http://localhost:3000` — browser lands here after OAuth (Settings → Calendar).
   - `CORS_ORIGIN=http://localhost:3000` — must list the **exact origin(s)** the web app is served from (comma-separated if multiple). Production: your real `https://…` origin.
6. **Database** — `npm run db:push` so `google_calendar_links` and task Google columns exist. **Docker full stack:** the API container runs `drizzle-kit push` on startup (unless `SKIP_SCHEMA_SYNC=1`); you can skip this step when only using Compose.
7. **Worker + Redis** — `npm run worker` processes **Google** push jobs (and CalDAV if configured). Without the worker, use **Pull from Google now** in Settings for pulls only; pushes queue until the worker runs. **Docker full stack:** the **`worker`** service already runs; you do not need `npm run worker` on the host.
8. **App** — **Settings → Calendar → Connect Google Calendar** → sign in; allow access. Then **Pull from Google now** or set **`GOOGLE_CALENDAR_PULL_INTERVAL_MS`** on the worker for periodic pulls.
9. **Re-connect / no refresh token** — If Google skips returning a refresh token, remove DevPlanner under Google Account → **Third-party connections**, then connect again (consent screen should include offline access; the app requests `access_type=offline` + `prompt=consent` on first link).

You can use **Google only**, **CalDAV only**, or both (same task may sync to two backends).

### CalDAV from Docker (API / worker containers)

Use the Compose **service hostname**, not `localhost` — e.g. `http://radicale:5232/youruser/tasks/` for **`CALDAV_CALENDAR_URL`** when `api` and `worker` run in Docker.

## Docker — full stack (default)

| Command | What starts |
|--------|----------------|
| `docker compose up -d --build` or **`npm run docker:up`** | Full stack **and** rebuild images (use after Dockerfile or app code changes, or first run). |
| `docker compose up -d` | Full stack using **existing** images (faster day-to-day). |
| **`npm run docker:infra`** (or `docker compose up -d devplanner-db devplanner-redis radicale`) | **Only** Postgres, Redis, and Radicale — for **`npm run dev`** on the host (no API/web/worker containers). |

**Why `db:push` isn’t a separate step in Docker:** the API container waits for Postgres, ensures **`vector`**, then runs **`drizzle-kit push`** before listening (disable with **`SKIP_SCHEMA_SYNC=1`** if you manage schema elsewhere).

**Start everything** (Postgres, Redis, Radicale, API, web, worker). First time or after code changes, include **`--build`**:

```bash
cp .env.example .env   # then edit .env
docker compose up -d --build
# or: npm run docker:up
```

Plain **`docker compose up -d`** uses existing images; add **`--build`** when Dockerfiles or app code changed.

Set in **`.env`** at least: `CORS_ORIGIN`, `WEB_APP_URL`, **`NEXT_PUBLIC_API_URL`** (browser → API, e.g. `http://YOUR_SERVER:3001`), and optional **`NEXT_PUBLIC_DEV_USER_ID`**. Compose passes the `NEXT_PUBLIC_*` values into the **web** image at **build** time.

**Infra only** (for **`npm run dev`** on the host — no API/web/worker images):

```bash
npm run docker:infra
# same as: docker compose up -d devplanner-db devplanner-redis radicale
```

**Seed** a dev user (optional, after the stack is up):

```bash
docker compose exec api npm run seed:start -w @devplanner/api
```

Then open **http://localhost:3000** (or your host/IP). API: **http://localhost:3001/health**.

**Optional** one-off `db:push` from a mounted repo (usually unnecessary): `npm run docker:migrate`.

**Local Node dev** with **`docker:infra`**: run **`npm run db:vector`** once and **`npm run db:push`** yourself — see **Setup** above.

Production checklist: `NODE_ENV=production` in `.env`, strong `DB_PASSWORD`, HTTPS reverse proxy in front of web + API, Google redirect URIs and `CORS_ORIGIN` / `WEB_APP_URL` matching public URLs. Consider **`SKIP_SCHEMA_SYNC=1`** plus versioned migrations if you do not want `push` on container start.

## Run (local Node dev)

```bash
npm run dev
```

- Web: http://localhost:3000  
- API: http://localhost:3001/health  

### WSL: Next.js exits right after “Starting…” (port 3000 unreachable)

Two common causes:

1. **`npm run dev` at the repo root (concurrently)** — children used to get **no stdin**. Next’s dev server treats **stdin EOF** as “quit”, so it exits with **code 0** immediately. The root script now uses **`concurrently -i`** and starts **web first** so stdin is forwarded to Next. Pull latest and run `npm run dev` again.

2. **`/mnt/c/...` file watching** — webpack **polling** and **`-H 0.0.0.0`** are already set in `apps/web`. If it still fails, run web alone (full logs):

```bash
cd apps/web && npm run dev
```

3. **Browser on Windows, app in WSL** — try `http://127.0.0.1:3000` or the WSL IP from `hostname -I | awk '{print $1}'`.

Best long-term: keep the repo on the Linux filesystem (e.g. `~/code/...`), not only `/mnt/c/`.

### Very slow first compile / page feels frozen or unclickable (WSL + `/mnt/c/`)

Webpack (and to a lesser extent Turbopack) on **DrvFS** (`/mnt/c/Users/...`) can take **minutes** per route and peg CPU. The browser tab often feels **stuck** until compilation finishes — that is mostly **disk + dev bundler load**, not a broken overlay in the app.

**What helps most:** clone or copy `devplanner` to the Linux side, e.g. `~/personal-workbench/devplanner`, then `npm install` and `npm run dev` there.

**Defaults:** `apps/web` **`npm run dev`** uses **Webpack** with polling env vars (better on WSL `/mnt/c/`). For Turbopack, use **`npm run dev:turbo`**.

**Node:** use **Node 20+** when you can (several tooling packages already expect it); avoids engine warnings and matches current LTS.

### Web exits right after “✓ Starting…” (even in its own terminal)

1. **Do not mix Windows and WSL installs.** If you ever ran `npm install` in **PowerShell/CMD** on `C:\\Users\\...` and then run `npm run dev` in **WSL**, `node_modules` can contain **Windows** binaries (`@next/swc-win32-*`, etc.). Next may start then exit immediately. **Fix:** from WSL, at `devplanner/`:

   ```bash
   rm -rf node_modules apps/web/node_modules apps/api/node_modules package-lock.json apps/web/package-lock.json apps/api/package-lock.json
   npm install
   npm run dev -w @devplanner/web
   ```

2. **Try the webpack dev server** (polling; if Turbopack misbehaves on your setup):

   ```bash
   cd apps/web && npm run dev:webpack
   ```

3. **Diagnostics:**

   ```bash
   cd apps/web && npm run dev:diag
   ```

4. **Node 20+** is recommended (`nvm install 20`).

**Worker** (idle detection → SSE, CalDAV + Google Calendar queue consumers — needs Redis):

```bash
npm run worker
```

*(pnpm works too if you install it; root scripts use `npm run -w`.)*

## Main API routes

| Area | Routes |
|------|--------|
| Tasks | `GET/POST /api/tasks`, `GET /today`, `GET /backlog`, `POST /brain-dump`, `POST /bulk-status`, `GET/PATCH/DELETE /api/tasks/:id` |
| Areas / Sprints / Projects | `/api/areas`, `/api/sprints`, `/api/projects` |
| Focus | `GET /api/focus/export`, `POST /api/focus/import` (stub) |
| SSE | `GET /api/events/user?userId=` |
| AI | `GET /api/ai/logs`, `POST /api/ai/parse-dump`, `POST /api/ai/breakdown`, `POST /api/ai/briefing`, `POST /api/ai/chat` |
| Sync | CalDAV: `POST /api/sync/caldav/*`; Google: `GET /api/sync/google/start|callback|status`, `POST …/disconnect`, `…/pull`, `…/pull-now` — see **Google Calendar** checklist above; worker runs push/pull queues when Redis is up |

## Production deploy (Ubuntu / Proxmox / VPS)

- **Step-by-step handoff + Perplexity prompts:** `../DEVPLANNER_BUILD_FLOW.md` (deploy section) and `../devplanner_cursor_prompt_v2.md` **§19** (local) / **§20** (production).
- **Every env var (API `devplanner/.env` vs web `apps/web/.env.local`, worker, compose):** **§20.1** in `devplanner_cursor_prompt_v2.md`.

## Deferred (see build flow)

- RAG / embeddings pipeline, AI tool-calling, populate-board diff UI, LangGraph, PWA, Better Auth UI.
