# DevPlanner

Monorepo for the **DevPlanner** spec (`../DEVPLANNER_BUILD_FLOW.md`). **Excluded:** native mobile (Expo) from the original prompt — web-only here.

## Stack

- **Web:** Next.js 14 (`apps/web`) — Board (dnd-kit), Now, Table, Backlog, Sprints, Review, Settings, brain dump, ⌘K palette, AI dock, SSE idle banner, light/dark.
- **API:** Hono + Drizzle + Postgres (pgvector) (`apps/api`).
- **Infra:** Docker Compose — Postgres, Redis, Radicale.

## Setup

```bash
cd devplanner
cp .env.example .env
docker compose up -d
npm install
# once: enable vector if needed
npm run db:push
npm run seed
```

Put the printed UUID into `apps/web/.env.local`:

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

## Run

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

**Defaults:** `apps/web` **`npm run dev`** now uses **Turbopack** (`--turbo`) for faster incremental dev. If file watching misses edits on `/mnt/c/`, use **`npm run dev:webpack`** (polling env vars) instead.

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

**Worker** (idle detection → SSE, CalDAV queue consumers — needs Redis):

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
| Sync | `POST /api/sync/caldav` (info; real enqueue on task writes) |

## Deferred (see build flow)

- RAG / embeddings pipeline, AI tool-calling, populate-board diff UI, LangGraph, 2-way CalDAV, PWA, Better Auth UI.

## Legacy

The Python **Personal Workbench** app lives at the repo root (`../app`).
