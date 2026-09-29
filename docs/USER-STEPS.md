# Owner checks and reproducible commands

DevPlanner is a personal home-server app. Use the existing account and normal configuration for any manual check; a separate real test account is not required. The automated UI harness uses synthetic identity and API responses on loopback and never contacts a personal calendar.

## Local automated checks

From the repository root with Node 22+, npm 10+, and Docker available:

```sh
npm ci
npm run typecheck
npm run format:check
npm run lint -w @devplanner/web
npm run test:integration
npm run test:web
npm run test:coverage
npm run test:mutation
npx playwright install --with-deps chromium
npm run test:ui
npm run build
npm audit --audit-level=high
```

The PostgreSQL integration runner creates and removes a disposable local container. Database tests require a URL naming `daily_test` and never target the personal database. The fixed gates remain 80% global web coverage, 90% listed core web coverage, and 70% API core mutation. A passing assertion count alone does not pass these gates. See [BUILD-REPORT](BUILD-REPORT.md) for the latest evidence.

`npm run test:ui` starts a loopback-only synthetic harness with actual React UI components. Review the generated desktop/mobile light/dark screenshots and axe output. It does not validate Clerk sign-in, deployed API routes, Google consent, or an authenticated end-to-end journey.

## Before a home-server update

Follow [HOME-SERVER](HOME-SERVER.md): create a fresh database backup, verify it by restoring into a disposable container, keep a protected copy on a separate disk, then build and start the existing stack with your normal environment. Keep the database volume and recovery records. After startup, check `docker compose ps`, API/worker logs, and the health endpoint.

In your normal signed-in browser, try title-only capture, move an Inbox item to Today, choose and complete work while a timer runs, and close/reopen an unfinished weekly review. Check mobile and desktop, keyboard access, and a screen reader if available. Record first-task and capture time against the two-minute and ten-second targets. These owner checks remain unverified by synthetic tests.

If you use Google Calendar, verify connect, denied consent, reconnect, and a saved task waiting for outbox delivery against your configured callback origin and a calendar you control. If you use AI, check that task editing remains off until you enable **Can edit**. No live Google/OpenAI account calls were made in the automated checks.

Do not treat local image builds or synthetic browser runs as deployment evidence. Record any user-facing failure and rerun the relevant gate before deciding to update the home server.
