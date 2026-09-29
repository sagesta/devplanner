# Contributing to daily-use work

Read the immutable daily-use implementation plan and apps/api/src/contracts/daily-use.ts first. Update all contract consumers together. Do not introduce a second task-creation path that bypasses batch idempotency, and do not write task dates without revision/ownership checks.

Use synthetic fixtures. Keep secrets and authenticated browser state outside the repository. Never lower coverage, mutation, accessibility or performance gates to get a passing run. Record an unrun check with its reason and exact runner.

Run npm run typecheck, npm test, npm run test:web and npm run test:integration before review. Run coverage, mutation, browser and audit gates separately and retain their outputs. Avoid concurrent Next production builds in the same checkout: they share .next output. CI must remain red for failed release gates even when targeted feature tests pass.

The repository may contain pre-existing local changes. Preserve them; do not reset or automatically stage unrelated files. Keep schema.ts, migration0007, its startup SQL constant and migration journal consistent. A new author must run clean and upgrade database tests, not only type checks.
