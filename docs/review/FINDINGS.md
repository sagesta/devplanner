# Continuous build review findings

Date: 2026-09-29. Historical observations and original wording remain in the [initial build report](../evidence/build-report-initial.md). Status here reflects available follow-up evidence; final automated quality runs are complete.

| ID | Severity | Finding and resolution | Current status |
|---|---|---|---|
| R001 | Blocker | User-supplied OAuth owner identity was replaced by opaque, owner-bound, expiring, single-use state. | Fixed; unit and real PostgreSQL consume tests pass. Live account round-trip pending. |
| R002 | Major | Split-origin review PUT preflight was omitted. | Fixed; [CORS tests](../evidence/cors-tests.txt) pass. |
| R003–R005 | Blocker/Major | Review and capture drafts could be overwritten, lost on failure, or attributed to the wrong account/week. | Fixed; scoped recovery, revision checks, dirty-state handling, and component regressions. |
| R006–R007 | Blocker/Major | Stale schedules or partial capture could duplicate or overwrite work. | Fixed; transactional receipts, stored previews, stable retry keys, and real PostgreSQL regressions. |
| R008–R009 | Major | Learning could multiply completions or misattribute hours; uncertain Google inserts could duplicate events. | Fixed; DST/count tests and reserved event ID fake-provider tests. |
| R010 | Major | Dependency audit previously reported high/critical findings. | Resolved in [final audit](../evidence/dependency-audit-final.json): zero vulnerabilities. |
| R011 | Major | Web coverage previously missed fixed 80% global and 90% listed-core gates. | **Resolved:** 358 tests pass; all global metrics exceed 80% and listed core metrics exceed 90%. See [coverage run](../evidence/web-coverage-final.txt). Thresholds unchanged. |
| R012 | Major | API core mutation score was below fixed 70% gate. | **Resolved: 84.12%** in the final [mutation run](../evidence/mutation-verified-snapshot.txt), above the unchanged 70% gate. |

The test-only browser harness checks real UI components with synthetic identity and API responses. Its [run](../evidence/ui-browser-final.txt) has 17 passes and one intentional desktop skip; it cannot establish authenticated end-to-end behavior. Live Clerk and Google flows, owner timing, screen-reader walkthrough, full-path performance, and clean-machine installation also remain acceptance work. Local API/web image builds, container startup, and isolated backup restore have recorded passes. No deployment or release approval is claimed.

Additional follow-up fixes: task-detail load Retry, preserved recovered capture destination, truthful empty/error states, mobile AI access, bounded Redis failure/recovery and fail-closed AI rate guard. Personal home-server LAN API/CORS configuration is documented in HOME-SERVER.md. No recorded blocker/major code findings remain; owner acceptance limits above remain NOT RUN.
