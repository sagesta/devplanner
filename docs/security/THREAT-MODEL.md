# Daily-use threat model

Scope: browser → Clerk-authenticated Next/Hono routes → PostgreSQL → outbox/BullMQ → optional calendar providers. Local recovery storage is on the user's device. This is a focused STRIDE review, not a claim of complete ASVS compliance.

| Threat | Mitigation | Evidence / remaining check |
|---|---|---|
| Spoofing / wrong calendar owner | Authenticated initiating user, hashed opaque state, one-use expiry, authenticated callback bridge | Unit and PG CAS tests; live Clerk redirect still owner check |
| Tampering / other user's task | Owner-scoped target lookup, parent ownership, expected revision | PG API ownership tests |
| Repudiation / uncertain retry | User/operation/key receipt with request digest; stable result | Concurrent capture and lost-response retry tests |
| Information disclosure | Account/week scoped drafts; generation checks; error serializer and redaction; generic server errors | Component account-switch and canary tests; full historical log audit not run |
| Denial of service | Bounded batches/horizon, validated inputs; existing AI rate limiter | Parser/boundary property tests; authenticated traffic load/rate protection needs broader review |
| Elevation of privilege | Existing global requireAuth and allowlist; no public account-selecting callback; AI write opt-in preserved | Boundary auth rejection; complete ASVS checklist not run |
| Data loss / duplicate external writes | Transactional batch, CAS, outbox, reserved Google event identity | PG rollback and fake provider lost-response tests |

LocalStorage is recovery convenience, not a secure vault against browser compromise. Do not put credentials in drafts. Existing dependency audit findings remain tracked in docs/evidence/dependency-audit.json; the security release gate is FAIL while high/critical findings remain.
