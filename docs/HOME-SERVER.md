# Personal home-server operation

DevPlanner remains a personal planning app. Goals, weekly commitments, timers, AI and calendar connections are optional; capture and daily completion do not depend on them.

## Update safely

Use Node 22+ for local tools. The Dockerfiles use Node 22. Keep the existing Clerk account and allowed-email configuration; the synthetic UI test harness is never part of the production app. Do not expose the test harness on your LAN.

For phone or LAN access, set `NEXT_PUBLIC_API_URL` to the API address reachable from that device before building the web image (for example, your home-server hostname and API port). `localhost:3001` works only when the browser runs on the server itself. Keep the configured web origin in `CORS_ORIGIN` and use your existing Clerk/domain configuration.

Before applying an update, create a backup from the running stack:

```sh
mkdir -p backups
node scripts/backup-database.mjs --output backups/before-update.dump
node scripts/backup-database.mjs --verify backups/before-update.dump
```

The backup command refuses to overwrite an existing file. Verification restores the archive into a new disposable local container, removes that container afterward, and never writes to the live database. Backups contain personal task data and may contain calendar credentials. Keep a protected copy on a separate disk; `backups/` and `.dump` files are ignored by Git. Verification proves an archive can restore, not that your independent backup copy is current.

After a successful backup, build and start the existing stack with your normal `.env` configuration:

```sh
docker compose build api web worker
docker compose up -d
docker compose ps
docker compose logs --tail=100 api worker
```

Database changes are additive. Preserve the database volume and recovery records when rolling back a UI image; never downgrade to the old unsafe OAuth/scheduling endpoints. Do not run `docker compose down -v` as an update or recovery step.

Database and Redis host ports bind to 127.0.0.1 by default. The containers still communicate on Docker's internal network. If you deliberately need direct LAN database access, configure `INFRA_BIND_ADDRESS` to a chosen interface and restrict access at the host firewall. This does not change the app's web/API listening addresses.

## Check a problem

- A task saved but not yet in Google Calendar remains saved in DevPlanner. Check worker logs and the calendar outbox before retrying or reconnecting.
- If Redis is unavailable, AI requests pause with a retry message so the rate limit is not bypassed. Ordinary task capture does not require AI.
- `/health` reports database and Redis availability without exposing backend exception text. `/health/vector` reads extension availability and does not modify the schema.
- A stale edit returns a conflict; reload or use the review's explicit local/server recovery choice instead of repeatedly submitting stale data.
- Browser draft recovery is device-local. Another device will see only acknowledged server content.

## Local checks without a second account

```sh
npm run test:integration
npm run test:web
npm run test:ui
npm run typecheck
npm run lint -w @devplanner/web
npm run build
npm audit --audit-level=high
```

`test:ui` uses actual React components in Chromium with synthetic requests and a test-only identity adapter, on 127.0.0.1:4173. It covers layout, keyboard interaction, draft recovery and axe checks. It does not verify your Clerk login, live API deployment, real Google consent or personal calendar. You can verify those through your normal home-server session after updating. No test account is required for everyday use.
