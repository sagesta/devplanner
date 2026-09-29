# ADR 0001 — Daily mutations and account-bound calendar linking

Date: 2026-09-29. Status: accepted for implementation.

Reuse the current Hono/Postgres/React Query architecture. Expose typed daily operations for capture, execution-item movement and focus selection. A single transaction and a user-scoped idempotency receipt protect retries; database revision triggers cover legacy mutation paths as well as new routes. The tradeoff is conservative preview conflicts when unrelated task records change, preferable to silently applying stale plans. A transactional outbox retains calendar writes while Redis is unavailable.

Google linking uses a random one-use state token whose hash, owner and expiry are stored in Postgres. An authenticated Next route bridges browser redirects to the bearer-authenticated API. The registered callback must be the web origin's `/api/calendar/google/callback`; legacy direct callbacks remain authenticated and use the same state validation. No callback selects an account from decoded client input.

Evidence: existing web API wrapper documents split origins and bearer authentication; prior OAuth state was unsigned base64 user identity. Google requires state validation and an exactly matching registered redirect URI: https://developers.google.com/identity/protocols/oauth2/web-server . Checked 2026-09-29. Alternative signed stateless state was rejected because one-use replay protection still requires storage.

No live account connection or paid service call is part of this build. Manual connection validation is recorded separately.
