# Changelog

## [Unreleased] — 2026-09-29

### Added
- Title-only Today/Inbox capture, direct daily actions, child-aware work selection, account-scoped draft recovery, and optional weekly planning.
- Atomic retry-safe capture and scheduling with revisions, receipts, stored previews, and a transactional calendar outbox.
- Owner-bound one-use Google OAuth state, authenticated callback bridge, and reserved event IDs for safe insert retries.
- Local synthetic Chromium UI checks for desktop/mobile layout, keyboard interaction, draft recovery, and axe; personal home-server backup, restore, and update guidance.

### Improved
- Weekly review conflict/recovery behavior, save feedback, timezone/day refresh, learning signals across DST, and default read-only AI chat with explicit task-edit opt-in.
- Task-detail load Retry, recovered capture destination preservation, mobile AI access, and fail-closed AI rate limiting during Redis outages.
- Patched dependency/framework versions and container startup/health behavior. The recorded follow-up audit reports zero vulnerabilities.

### Verification
- Local API/web tests, PostgreSQL integration, Docker smoke, local API/web image builds, isolated backup restore, and 17 synthetic browser checks passed. The desktop project intentionally skipped one mobile-only case. Final results: 358 web tests, 54 API tests, all fixed coverage gates passed, and 84.12% core mutation score. See [the build report](docs/BUILD-REPORT.md).
- No commit, tag, push, or deployment is claimed. Synthetic UI checks are not authenticated end-to-end tests.
