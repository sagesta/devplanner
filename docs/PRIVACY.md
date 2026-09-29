# Data handling for daily use

Tasks and reviews stay in the configured PostgreSQL database. Recovery drafts remain in browser storage under the account and review period until acknowledged or explicitly discarded. AI and calendar providers receive content only through the existing enabled integrations; this build's automated fixtures are synthetic and its tests do not call paid services.

OAuth state is stored as a hash with a short expiry. Mutation receipts contain operation results and request digests for seven days, not raw task text. Preview snapshots include the user's proposed task changes and expire; cleanup removes expired previews after a day. Delivered calendar outbox entries are removed after seven days; undelivered entries remain for retry. Daily focus history is trimmed after thirty days. Worker operation is required for scheduled cleanup.

Logs should include operation/error categories and timings, not task text or credentials. Browser test traces may contain test-account content; keep authenticated state and production data out of the repository. Follow the existing database backup policy for server data; this change does not automatically erase historical backups.
