# Implementation decisions

## 2026-09-29 — Project card and execution rules
- App: DevPlanner, existing Next.js/React web UI and Hono/Drizzle/Postgres API with Redis workers, Clerk and optional Google/CalDAV/OpenAI integrations.
- Source of truth: docs/devplanner-daily-use-implementation-plan.md, unchanged. Sections 1–4 define behavior; 6–7 define acceptance. Work proceeds continuously; the draft's phases describe dependencies, not approval stops.
- Primary user: an individual balancing professional, study and personal tasks, including low-energy days and mobile capture.
- Data: only synthetic fixtures in the repository; do not copy real planning data or credentials. Runtime secrets remain in the existing environment configuration; no secret values are read for this build.
- Services/spend: no paid external calls authorized for this build; cap zero. Use deterministic fakes. Live owner-account checks are NOT RUN until executed by the owner.
- Git: local working-tree changes only; no push, deployment, tagging or commits assumed. Existing uncommitted edits are preserved. Git status requires --ignore-submodules=all because a nested Windows worktree pointer is invalid under WSL.
- Reuse: existing project code and installed dependencies only; no new third-party source copied.
- Targets: preserve all spec targets and the attached build template's 90% core / 80% overall coverage, 70% core mutation, zero serious/critical axe, 4.5:1 contrast and 10% performance regression gates. Missing measurements are NOT RUN, never inferred passes.
- Scope: implement the daily-use spec against the existing architecture; do not replace the design system or migrate frameworks. Template-wide quality gates remain reportable even where the existing app does not yet meet them.
- Coordination: API persistence owner owns schema/migrations and daily/schedule/task contracts; frontend daily owner owns Today/Inbox/onboarding; draft owner owns capture/review persistence and review routes; lead owns OAuth, integration, quality evidence and docs. Contract edits go through the lead.

## Final implementation decisions
- Use task/subtask revision and outbox database triggers to cover existing writers, rather than trusting every route to increment revisions manually. Clean and upgraded PostgreSQL schema tests exercise the additive migration.
- Use READ COMMITTED plus operation locks for capture/move; use SERIALIZABLE for capacity-sensitive schedule apply. Broad serializable isolation produced synthetic contention failures; retained before/after benchmark evidence records the correction.
- Reserve Google event IDs before remote insertion; retry a lost response against the same ID. Fake-provider tests cover lost responses, conflicts and rate limits.
- Preserve the fixed quality thresholds. Compatible dependency fixes were applied, but the remaining Next.js critical finding requires a framework upgrade excluded by the authoritative scope. This is an open release blocker, not an accepted security exception.
- Store authenticated Playwright state outside the repository; never bypass Clerk to make browser tests pass. Real-account, accessibility and usability checks remain owner verification work.

## Full implementation follow-up
- User requested completion of remaining UI/reliability/security work and clarified this is a personal home-server app with no separate test account. Prioritize personal daily use; do not introduce enterprise workflows or access personal planning data.
- This follow-up authorizes dependency/framework upgrades needed to remove security blockers, superseding the initial no-framework-upgrade boundary. Next16.3.7/React19.3.0 and patched database/calendar dependencies are installed; verify builds and audit before completion. Upgrade reference: https://nextjs.org/docs/app/guides/upgrading/version-16 .
- Test-only browser harness bundles actual UI components with isolated identity adapters and synthetic API responses; binds127.0.0.1 only and is never imported into the production app. Browser evidence proves component layout/interactions, not Clerk, deployed API or live calendar integration.
- New compiler lint diagnostics retain their default severity. Intentional SSR-safe hydration of external local storage/query state may use a narrow inline explanation, while render impurities/nested components are corrected. Existing lint rules and test thresholds remain.

- 2026-09-29 final follow-up: AI rate-limit backing-store failure returns 503/Retry-After rather than allowing unmetered requests. Verified API outage/recovery and 54 integration tests; personal capture remains independent of optional AI. Final fixed gates: web358 tests with all metrics above80%, listedcoreabove90%; coremutation84.12%. Owner session/performance acceptance remains NOT RUN.
