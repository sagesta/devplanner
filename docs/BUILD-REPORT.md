# DevPlanner daily-use implementation report

Date: 2026-09-29. Scope: the local working tree for a personal home-server app. The authoritative daily-use plan is unchanged. The [initial report](evidence/build-report-initial.md) preserves earlier failures. Nothing was committed, pushed, tagged or deployed. Automated gates below pass; owner-account acceptance remains NOT RUN.

## 1. Workstreams

| Workstream | Status | Evidence and limits |
|---|---|---|
| Everyday workflow and UI | DONE | Capture → Today → Done; direct actions, compact onboarding, optional planning, mobile More → Ask AI, light/dark contrast and keyboard checks |
| Persistence and recovery | DONE | Atomic capture/move, stable retry keys, revisions, stored previews, account/week drafts, outbox and real PostgreSQL tests |
| OAuth and calendar reliability | DONE | Owner-bound one-use state, browser bridge, reserved event IDs and deterministic provider failure tests; live owner flow NOT RUN |
| Automated verification | DONE | 358 web tests, 54 API tests, coverage gates and 84.12% core mutation score |
| Dependency and source security | DONE | Zero audit vulnerabilities, zero Semgrep findings/errors, zero source-snapshot secret findings |
| Home-server operations | DONE | API/web image builds, fresh migration startup, Redis outage/recovery, isolated backup restore, operator guide |
| Owner usability and deployed integration acceptance | PARTIAL | Synthetic desktop/mobile checks pass; normal Clerk session, live Google, screen reader and owner timing NOT RUN |
| Full-path performance qualification | PARTIAL | Synthetic persistence benchmark/short soak only; no comparable deployed baseline |

## 2. Requirements

| Requirement | Result | Evidence |
|---|---|---|
| Title-only capture without configured area, goal, sprint or AI | Built | Quick Add and daily integration tests; concurrency-safe General area |
| Today details, next selection, date moves and completion | Built | Today 24-case suite, task detail tests, synthetic browser journeys |
| Child execution units; preserve sibling dates and deadlines | Built | Daily PostgreSQL regressions and Inbox/Timeline suites |
| Explicit running-timer decisions | Built | Today and real timer-hook/button component tests |
| Complete agenda, honest filters and persistent Inbox picker | Built | Today busy-agenda/filter/picker tests and browser check |
| Optional weekly planning and preserved deep links | Built | Plan routing, Sprint, Board, Table and Timeline tests |
| Dismissible/resumable three-step onboarding | Built | Guide and app-shell tests; mobile screenshots |
| Optional review completion and recoverable drafts | Built | Revision, conflict, account/week rollover and completion retry tests |
| R1 owner-bound calendar linking | Built | OAuth state, bridge and real DB one-use consume tests |
| R2 capture/review recovery | Built | Storage, malformed/legacy draft, late response and account-switch tests; recovered Today destination regression fixed |
| R3 atomic retry-safe mutations | Built | Transactions, receipts, stale preview conflicts, outbox and rollback tests |
| R4 correct learning attribution | Built | Completion deduplication, midnight and both DST-direction regressions |
| R5 timezone and truthful save states | Built | Date hook, Insights refresh, failed load/save Retry controls |
| Deployment/owner walkthrough proof | Not built as automated proof | Requires the owner's configured session; synthetic identity is not authenticated E2E |

## 3. Failure scenarios

| Scenario | Result | Scope |
|---|---|---|
| Duplicate/retried capture, reused key, invalid/foreign batch, concurrent first save | PASS | Real PostgreSQL and API boundary tests |
| Stale schedule, changed capacity, atomic rollback, sibling isolation | PASS | Real PostgreSQL integration |
| OAuth expiry, wrong owner, replay and simultaneous consume | PASS | Unit and real PostgreSQL |
| Lost calendar insertion response and retry conflict | PASS | Deterministic fake provider |
| Failed capture/review/detail saves, local storage failure, account/week switches | PASS | Component/hook tests; synthetic capture browser retry |
| Task-detail fetch failure | PASS | Visible error and Retry; destructive control disabled without task data |
| API cache outage and restart | PASS | Real isolated Redis stop/recreate; 503 in 173ms and recovery without API restart |
| AI cache outage | PASS | Returns 503 and Retry-After instead of bypassing the cost/rate guard |
| Desktop/mobile keyboard, dialogs, light/dark axe checks | PASS | Actual UI components with synthetic identity/network |
| Live Clerk/Google callback, worker delivery to a personal calendar | NOT RUN | No owner session; manual steps below |

## 4. Targets

| Target | Measurement and source | Result |
|---|---|---|
| First task within two minutes | Owner timing unavailable | NOT RUN |
| Capture within ten seconds excluding typing | Owner timing unavailable | NOT RUN |
| Direct daily actions without required planning views | Actual component/browser assertions | PASS automated behavior; owner timing NOT RUN |
| No >10% full-path performance regression | No comparable deployed baseline | NOT RUN |
| Synthetic persistence cycle | 100 iterations, zero errors; p50 28.03ms, p95 41.67ms | PASS zero-error check only |
| Synthetic short persistence soak | 1,000 iterations, zero errors; p50 28.09ms, p95 38.06ms; 14.62s total | PASS zero-error check only |

[Benchmark](evidence/daily-benchmark.json) and [soak](evidence/daily-soak.json) cover capture → receipt replay → move at concurrency two. They exclude HTTP, Clerk, browser, Redis, providers and long-term resource use. They do not establish the full-path regression target.

## 5. Quality gates

| Gate | Final measurement | Result |
|---|---|---|
| Web ≥80% all metrics | All files: statements 86.91%, branches 80.59%, functions 85.34%, lines 88.86% | PASS |
| Jest global gate excluding separately gated core files | Statements 86.73%, branches 80.30%, functions 85.18%, lines 88.71% | PASS |
| Listed core ≥90% | Draft storage: 100% all metrics; calendar date: 100% statements/lines/functions, 91.66% branches | PASS |
| API core mutation ≥70% | 84.12%; 737 mutants: 607 killed, 13 timed out, 117 survived | PASS |
| Typecheck, lint, scoped formatting | Final recorded commands exit zero | PASS |
| Production API/web builds | Clean Docker dependency installs and production builds | PASS local images |
| API startup and migrations | Fresh isolated DB/Redis smoke, health and unauthenticated write denial | PASS |
| Dependency audit | Zero vulnerabilities | PASS |
| Source security | Semgrep zero findings/errors; Gitleaks zero source-snapshot findings | PASS scoped scans |
| Browser axe | Zero violations in the tested light/dark Today, Inbox, Review and capture states | PASS scoped browser checks |
| Exhaustive ASVS, screen-reader and full-path resource/performance program | Not established by these checks | NOT RUN |

Evidence: [web run](evidence/web-coverage-final.txt), [coverage summary](evidence/web-coverage-summary.json), [API run](evidence/api-tests-final.txt), [mutation](evidence/mutation-summary.json), [mutation log](evidence/mutation-verified-snapshot.txt), [typecheck](evidence/typecheck-final.txt), [lint](evidence/lint-final.txt), [format](evidence/format-check-final.txt), [audit](evidence/dependency-audit-final.json), [Semgrep](evidence/semgrep-final.json), [secrets](evidence/secret-scan-final.txt), [browser](evidence/ui-browser-final.txt), [container smoke](evidence/container-smoke-final.txt), [backup restore](evidence/backup-restore.txt).

The security scan is a bounded source snapshot, not Git history or an account audit. A temporary snapshot initially included ignored local environment configuration; those temporary copies were removed, and the final scan excludes environment files. Original configuration was not changed, findings were redacted, and no source upload was used. Static checks are not a claim of exhaustive security assurance.

## 6. Decisions and reuse

- Keep the existing application and design system; make daily actions primary and advanced planning optional.
- Use durable revisions, transaction receipts and a calendar outbox rather than client-only retry flags. See [ADR 0001](adr/0001-daily-mutations-and-oauth.md).
- The user's full-completion request superseded the earlier framework-upgrade exclusion: patched Next/React/database/calendar dependencies remove the recorded vulnerability blockers. See [decisions](DECISIONS-LOG.md).
- Synthetic browser adapters are test-only, loopback-bound and excluded from the production application. No second account is required for normal personal use.
- Keep all coverage and mutation thresholds unchanged. Do not reinterpret the original failed runs as passes.
- Reuse and dependencies are recorded in [NOTICE-REUSE](../NOTICE-REUSE.md), [SBOM](evidence/sbom.cdx.json) and [license inventory](evidence/licenses.json).

## 7. External service spend

OpenAI and Google provider interactions in automated tests use fakes: zero paid provider calls were made by this test work. The browser harness uses synthetic routes. No real account billing/usage query was made, so total account spend is NOT RUN rather than an invented measurement. AI write permissions remain explicit opt-in; Redis failure now pauses guarded AI requests.

## 8. Findings and deferred acceptance

Recorded code/security blockers and fixed numerical gates are resolved in the [findings ledger](review/FINDINGS.md). Remaining acceptance work is the owner's live Clerk session, optional Google connection/outbox delivery, screen-reader walkthrough, personal timing, and full-path performance qualification. No live deployment or release approval is claimed.

For LAN/phone use, the browser API address must point to the home server, not the phone's localhost; set NEXT_PUBLIC_API_URL before building and match CORS_ORIGIN. The verified web image used a synthetic Clerk publishable key and must be rebuilt with the normal configuration before use. Do not replace the live stack with the synthetic verification image.

## 9. Owner commands

See [USER-STEPS](USER-STEPS.md) for exact verification commands and [HOME-SERVER](HOME-SERVER.md) for backup/update instructions. Before an update: `node scripts/backup-database.mjs --output backups/before-update.dump`, then `node scripts/backup-database.mjs --verify backups/before-update.dump`. Build with the existing real configuration using `docker compose build api web worker`, then `docker compose up -d` only when ready to apply the update. Preserve database volumes.

Afterward, use the normal signed-in session for capture → Today → Done, timer decisions, draft recovery, phone access and optional Google connection. These checks need the owner; no further account credentials were requested or used.

## 10. Final test counts

| Suite | Passed | Failed | Skipped | Source |
|---|---:|---:|---:|---|
| Web behavior/coverage | 358 | 0 | 0 | 45 suites, synthetic API boundaries |
| API and real PostgreSQL integration | 54 | 0 | 0 | Isolated databases and fake external providers |
| Chromium UI | 17 | 0 | 1 | Desktop/mobile; one intentional desktop skip for the mobile-only case |
| Existing authenticated E2E journeys | 0 | 0 | Not executed | No real test session; not counted as passing or as an automated skip |

No targets were loosened. Source edits and evidence remain local for review.
