# DevPlanner daily-use build report

Date: 2026-09-29. **Local implementation delivered; release Definition of Done not met.** The authoritative daily-use implementation plan is unchanged. Existing unrelated working-tree edits were retained. Nothing was committed, pushed or deployed.

## 1. Workstreams

| Workstream | Status | Evidence / remaining work |
|---|---|---|
| Daily workflow and onboarding | DONE | Quick capture, Today actions, child-aware Inbox picker, optional planning, resumable first-task guide |
| Persistence and synchronization | DONE | Transactional capture/move, stored previews, revisions, receipts, outbox; real PostgreSQL tests |
| Review and capture recovery | DONE | Account/week drafts, revision conflicts, explicit recovery; component tests |
| OAuth security | DONE | Hashed expiring one-use owner-bound state and authenticated web bridge; unit/DB tests; live flow unverified |
| Architecture and integration review | PARTIAL | Independent cross-agent source reviews and shared contracts; outstanding verification gaps in findings ledger |
| QA and code quality | PARTIAL | Tests/type/lint/build; coverage below fixed gate, mutation score fails |
| UX/accessibility acceptance | PARTIAL | Touch/focus behavior implemented; real browser, axe, visual and screen-reader verification NOT RUN |
| Performance | PARTIAL | Synthetic persistence benchmark/short soak only; full-path and resource budgets unmeasured |
| Security | PARTIAL | Source secret scan clean; dependency audit fails; exhaustive fuzzing/static security/ASVS verification incomplete |
| Release engineering | PARTIAL | Local API image, lockfile, SBOM, license inventory and CI; clean-machine/tagged reproducibility unverified |
| Observability | PARTIAL | Redacted logging, canary test, outbox; no complete diagnostics UI, spend meter or metrics for every target |
| Documentation | PARTIAL | Guide/runbook/privacy/architecture/ADR/contributor/owner steps; authenticated screenshots and clean-install walkthrough outstanding |

## 2. Requirement traceability

“Built” means source implementation exists, not that all acceptance checks passed.

| Requirement | Result | Evidence |
|---|---|---|
| Title-only capture, Inbox/Today destination, optional metadata/AI | Built | quick-add-task.test.tsx; daily.integration.test.ts |
| General area with system identity and concurrency safety | Built | daily.integration.test.ts; migration 0007 |
| Today details, next selection, move and completion | Built | now/page.tsx, TaskDetailPanel.tsx, daily.ts; full browser journey NOT RUN |
| Distinct child execution items and unchanged deadlines/siblings | Built | daily.integration.test.ts; backlog/page.test.tsx |
| Explicit running-timer decisions | Built | Today and timer hook source review; real timer interaction NOT RUN |
| Deadline notices, show all, honest energy-filter state | Built | Today source review; browser acceptance NOT RUN |
| Inbox direct/bulk actions; optional week; existing Plan links | Built | backlog/page.test.tsx; plan-header.tsx |
| Three-step dismissible/resumable first-task guide | Built | getting-started-card.test.tsx |
| Optional review completion without sprint | Built | reviews.test.ts and weekly-review-panel.test.tsx |
| R1: owner-bound OAuth and browser bridge | Built | oauth-state.test.ts; PostgreSQL consume tests; live origins NOT RUN |
| R2: drafts, exact acknowledgement, conflict and account isolation | Built | draft-storage.test.ts; weekly-review-panel.test.tsx; quick-add-task.test.tsx; brain-dump-modal.test.tsx |
| R3: atomic retry-safe capture/scheduling, revision coverage/outbox | Built | daily.integration.test.ts; daily-boundary.test.ts; event-write.test.ts |
| R4: separate learning signals, duration/hour attribution | Built | scheduler.ts; PostgreSQL count regression; exhaustive DST fixtures missing |
| R5: timezone/day refresh and accurate save feedback | Built | use-calendar-date.test.ts; component tests; full Monday review rollover NOT RUN |
| Additive clean/upgrade/startup migration consistency | Built | six real PostgreSQL integration cases including clean and legacy schema |
| Complete production acceptance/metrics | Not built | Browser, exhaustive coverage/security, diagnostics and release gaps below |

## 3. Required failure scenarios

| Scenario | Result | Scope |
|---|---|---|
| Invalid/foreign capture, partial batch, replay and reused key | PASS | API boundary/property and real DB tests |
| Stale schedule, changed destination context, rollback | PASS | Real DB transaction tests |
| Sibling/date/deadline isolation | PASS | Real DB tests |
| OAuth wrong owner, expiry, replay and simultaneous consume | PASS | Unit and real DB tests |
| Failed/late saves and capture recovery | PASS | Existing component assertions; not exhaustive browser coverage |
| Midnight, DST and timezone preference changes | PASS | Date-hook tests; learning DST and dirty-review Monday cases remain NOT RUN |
| Lost Google insert response and retry conflict | PASS | Deterministic fake-provider tests |
| Queue outage through real Redis restart/recovery | NOT RUN | Durable outbox DB behavior covered, operational restart not exercised |
| Complete timer lifecycle, >7 items, empty filter, mobile/desktop journeys | NOT RUN | Source implemented; authenticated journeys required |
| Live Google denial, split-origin owner round-trip | NOT RUN | Owner configuration required |

## 4. Targets

| Target | Measurement / source | Result |
|---|---|---|
| First task within 2 minutes | No owner timing | NOT RUN |
| Capture within 10 seconds excluding typing | No owner timing | NOT RUN |
| Row actions directly or one labelled menu | Implemented; source inspection only | NOT RUN usability acceptance |
| No >10% full-path performance regression | No comparable baseline/full-path measurement | NOT RUN |
| Synthetic persistence cycle | 100 iterations, 0 errors; p50 28.03ms, p95 41.67ms, daily-benchmark.json | PASS zero-error check only |
| Bounded persistence soak | 1,000 iterations, 0 errors; p50 28.09ms, p95 38.06ms, total 14.62s, daily-soak.json | PASS zero-error check only |

The persistence cycle is capture → replay → move at concurrency two. It excludes HTTP, Clerk, browser, Redis and providers, and is not a long-duration/resource soak. The pre-fix failing benchmark is retained.

## 5. Quality gates

| Gate | Evidence | Result |
|---|---|---|
| API + web type check, web lint | evidence/typecheck.txt, lint-final.txt | PASS |
| Scoped formatting | evidence/format-check.txt | PASS |
| Production build | evidence/build-final.txt | PASS |
| API tests including actual PostgreSQL | 32 passed, 0 failed, 0 skipped; api-tests-final.txt | PASS |
| Web component/hook tests | 24 passed, 0 failed, 7 suites; web-tests.txt | PASS |
| Web coverage ≥80% all metrics | All files: statements 12.53%, branches 12.21%, lines 13.18%, functions 7.98%. Jest global gate excludes separately gated core files: 11.27% / 10.75% / 11.95% / 6.91% | FAIL |
| Listed core web coverage ≥90% | Draft envelope 100% all four metrics; date hook 100% statements/lines/functions but 75% branches | FAIL |
| API core mutation ≥70% | 17.50%; 737 generated mutants, evidence/mutation-final.txt and mutation-summary.json | FAIL |
| Complexity ≤10 | New daily functions meet; existing scheduler algorithm 23 has documented legacy exception | PARTIAL |
| Dependency vulnerability gate | 15 remaining: 7 moderate, 7 high, 1 critical; dependency-audit.json | FAIL |
| Source secret scan | Gitleaks v8.24.2: no leaks in focused source snapshot; not Git history | PASS scoped scan |
| Exhaustive parser fuzz / security static analysis / ASVS | Some fast-check boundary tests; exhaustive program not completed | NOT RUN full gate |
| Browser/axe/visual/accessibility | Four Playwright cases discovered; no authenticated execution or approved snapshots | NOT RUN |
| Clean-machine/reproducible release | Local API image built, not installed on clean machine | NOT RUN |
| Supply chain inventory | CycloneDX 942 components; license inventory 1,129 records, not legal clearance | PASS inventory only |

The mutation command ran deterministic API tests with database integration disabled; the separate real-PostgreSQL suite passed. This leaves substantial daily/scheduler mutations undetected and is not evidence of adequate database mutation coverage.

No thresholds or security findings were waived. CI exposes failing gates rather than converting them into successful checks. Local API image: `devplanner-daily:local`, SHA256 `cca3097e409388b5ac2929fa8cf4712f0a17ab97fd713778f6fb29fc870185cb`.

## 6. Decisions

See [decision log](DECISIONS-LOG.md) and [daily mutations/OAuth ADR](adr/0001-daily-mutations-and-oauth.md). Key choices are database-enforced revision/outbox coverage, atomic receipts, serializable capacity-sensitive apply, account-scoped draft recovery and authenticated same-origin OAuth bridging. No framework migration was mixed into the daily-use work.

## 7. External spend

No paid OpenAI, Google API, or other billable service requests were initiated by this implementation's tests; provider behavior used fakes. Billing accounts were not queried, so an actual invoiced amount is not verified. Public dependency/image downloads were used. A runtime per-service spend counter is not implemented.

## 8. Open findings and deferrals

See [findings](review/FINDINGS.md). Coverage and dependency security remain open major findings. Dedicated conflict-fetch race, CORS and learning DST tests also remain incomplete. Mutation score is also an open major finding. Browser/accessibility/owner acceptance, full-path performance, complete security verification, screenshots and clean-machine installation remain release prerequisites. Therefore no merge/release approval is claimed.

The remaining critical Next.js dependency requires a framework upgrade outside the authoritative spec's scope. Full offline editing, general recurrence undo and new AI features remain intentionally outside scope.

## 9. Owner steps

Exact commands and session/configuration instructions are in [USER-STEPS](USER-STEPS.md): run `npm ci`, `npm run test:integration`, the listed checks, create an external authenticated Playwright session, run `npm run test:e2e`, perform the five-task desktop/mobile script, verify a dedicated Google calendar connection, and test a clean installation/backup restore. These steps do not cure the automated coverage/security failures; those need engineering follow-up first.

## 10. Final test counts

API: **32 passed / 0 failed / 0 skipped**, including six real PostgreSQL integration tests. Web: **24 passed / 0 failed / 0 skipped**, seven suites. Combined test cases reported by runners: **56 passed / 0 failed / 0 skipped**. Coverage command exits nonzero because thresholds fail despite passing assertions. Browser cases are **4 discovered, NOT RUN**; they are not included in the passing count. Mutation score: **17.50%, FAIL** against 70%; separate from the test-case counts.
