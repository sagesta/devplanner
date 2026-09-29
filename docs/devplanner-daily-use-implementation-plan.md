# DevPlanner daily-use implementation plan

Status: implementation draft; no application changes delivered by this document.  
Date: 29 September 2026.  
Scope: reduce daily workflow overhead and address the reliability findings from the source review.

## 1. Outcome and product decisions

The default daily loop becomes **Capture → Today → Done**. Goals, weekly commitments, time tracking, AI organization, and reviews remain available without becoming prerequisites for recording or completing work.

A user should be able to add a task, choose what to do next, read its details, postpone it, and complete it from Today. Planning views remain useful for deliberate weekly planning and bulk changes.

Keep the existing top-level navigation: Today, Inbox, Plan, Review, Goals, with Settings separate. Do not repeat the navigation consolidation already implemented. Keep legacy routes and existing task, subtask, sprint, and goal relationships.

Terminology:

- **Add task**: the universal capture action, including mobile.
- **Inbox**: captured work not yet scheduled; replace user-facing “backlog.” Internal route names may remain unchanged.
- **Add multiple tasks**: opens the existing multiline capture experience.
- **This week**: the default planning view; explain existing sprint functionality as an optional weekly commitment. Preserve non-weekly sprint dates and names rather than silently converting them.
- **Move unfinished work**: the action that opens a scheduling preview; applying still requires an explicit user action.

This plan refines the workflow guidance in `devplanner-product-requirements.md` and `devplanner-everyday-use-review.md`. Their historical statements are not a current implementation inventory: structured server reviews and grouped navigation already exist.

## 2. Target daily experience

### Capture

From any main screen, Add task opens a compact input with title and destination: Inbox by default, Today as an explicit choice. Enter saves; Escape closes while retaining the draft. A successful save clears only the submitted draft. Show a visible “Draft kept on this device” or “Draft restored” cue when appropriate, and expose Discard separately; never imply server sync for a local-only draft. The entry point on Today may preselect Today, with that destination visibly stated.

Area, goal, sprint, priority, energy, date/time, recurrence, and estimates live under optional details. AI is an optional action after capture and never a requirement for saving. Multiline capture retains its preview-before-create behavior.

A missing Area must not prevent capture. Retain the database's non-null area relationship: provision a user-owned General area on first uncategorized save. Identify this system default by a dedicated key, not its display name. Add a unique constraint for `(user_id, system_key)` where the key is non-null, and use an upsert to handle simultaneous first saves. Existing custom areas are untouched. Return the resolved area with capture results and invalidate area queries so General tasks are visible immediately, even before a background area refresh completes. Area filters must include General and custom areas; do not hide uncategorized tasks behind the current fixed category choices. Prevent deletion of the system area while referenced, or require reassignment.

### Today

The screen contains a neutral date-aware heading, an always-visible Add task action, Pick from Inbox, one current task, and the remaining agenda. Capacity, energy filters, and progress are secondary. The heading must not claim it is a deep-work day regardless of the actual plan.

Every task or subtask row supports:

- Open details by selecting its title; reuse TaskDetailPanel for the parent and expose the selected subtask when applicable.
- Do next: selects the next execution item without changing priority, deadline, or scheduled time.
- Move to tomorrow or choose another day: changes the selected execution item's planned date, leaving its due date unchanged.
- Done: marks the selected execution item complete and reflects the confirmed result.

Do next does not start a timer. If a timer is already running, show “Next after current”; do not silently stop, replace, or start timers. Offer an explicit stop-and-switch interaction. When completing an item with a running parent-task timer, explicitly resolve whether to stop it; completing one subtask must not silently end timing for remaining sibling work.

Persist the chosen next item per user and date in a small `daily_focus` record, using target type and target ID so siblings are distinguishable. Validate ownership through the parent for subtasks. Discard the selection when the item is deleted, completed, or moved off that date; use the existing ordering as fallback. A running timer remains the current task. This preference must never rewrite calendar times.

Pick from Inbox remains available after the first task is scheduled. Show a searchable picker with multi-select and Add to today. If a parent contains unfinished subtasks, let the user choose those execution units rather than silently scheduling every sibling or only moving the parent.

Define Today membership consistently in the API and UI: an explicit scheduled date controls the execution agenda; only unscheduled items fall back to a due-today reminder. The current today query includes both due date and scheduled date, so postponing a task due today could otherwise leave it in the agenda. Keep its deadline visible in a separate due/overdue notice with a link to the item; moving planned work must neither silently remove deadline warnings nor change the deadline. Apply equivalent execution-unit rules when a parent has subtasks.

Keep the initial agenda compact, but expose “Show all N tasks” when more than seven remain. If an energy filter hides unfinished work, say “No tasks match this filter” with Clear filter; never claim the day is complete on that basis.

### Inbox and Plan

Inbox rows expose Add to today next to details. Selected rows offer Add to today, Choose date, and optional Add to week. Preserve advanced triage under Details. Clearly distinguish scheduling from deadlines and weekly membership.

Plan initially opens This week. Board, Timeline, and Table remain alternative views under a compact view selector. Preserve direct links and existing view query parameters. Do not duplicate Goals as another apparent planning requirement.

### First use and review

Replace the four-part required planning checklist with Add one task → Put it on Today → Mark it done. Allow dismissal and resumption. Offer goals, weekly planning, and calendar connection afterward as optional next steps. No requirement to select 3–7 tasks; one is a valid day.

Weekly reviews remain optional and recoverable. Completing a review must not require creating a sprint: expose “Create next week's plan” as an explicit option and keep reflection-only completion valid. Check the existing completion endpoint and transaction before changing this behavior.

## 3. Reliability work required alongside the UX

### R1. Bind Google Calendar linking to the initiating account — highest priority

Evidence: `apps/api/src/google/auth.ts` encodes a plain user ID in OAuth state; `routes/sync.ts` uses that ID to store the connection without comparing it to the authenticated account.

Replace the payload with a cryptographically random opaque state token. Store only its hash with initiating user, expiry, and consumed status in a durable OAuth attempt record. Use a short expiry, for example ten minutes. The callback must atomically consume the matching unused record, verify the authenticated user, and derive the target account only from the stored attempt. Reject missing, expired, replayed, and mismatched attempts without modifying any calendar link. On exchange failure, require a fresh connection attempt.

Trace both browser redirects through the actual Clerk and API origin configuration. The current start/callback routes require authentication; navigation cannot attach the bearer header used by fetch. Use a same-origin authenticated bridge if the deployment cannot supply the appropriate session cookie. Do not solve this by simply making an account-selecting callback public. Never log authorization codes, tokens, or state contents.

Acceptance: owner connection succeeds; a second account cannot replace the owner's link; modified/expired/replayed state fails; denied consent gives a useful message; same-origin and configured split-origin flows are tested.

### R2. Preserve review and capture drafts

Review drafts use a versioned storage envelope scoped to authenticated user and week: payload, local edit sequence, server revision, and sync status. Restore only after user identity and period are known. A late fetch must never overwrite dirty local text. If both server and local changed, retain both and offer Restore local or Use server, with a preview of the differences.

Add a monotonically increasing review revision. Save with an expected revision; return a conflict on mismatch instead of last-write-wins. Serialize/debounce saves, and ignore stale responses for the visible save indicator. A response for an older edit cannot mark newer text saved. Clear local recovery data only when the exact content is acknowledged, or the matching completion succeeds. On account switch, cancel outstanding work and remove the previous user's text from memory without deleting that user's recovery record.

Legacy unscoped browser drafts have unknown ownership. Do not automatically upload them to the currently signed-in account. Offer explicit recovery with a preview and period selection. Storage failure must show that local recovery is unavailable without crashing the editor or pretending persistence succeeded.

Capture drafts retain raw text, edited AI preview, destination, and optional fields across close/reopen and reload. Backdrop clicks and Escape close without discarding. Provide a separate Discard draft action. Never clear on parse failure or failed save. If text changes while saving, clear only the acknowledged snapshot.

Acceptance: failed save → reload retains newer text; delayed fetch cannot erase typing; two devices cause a recoverable conflict; account/week isolation holds; closing capture preserves raw and parsed drafts; storage errors are handled.

### R3. Make task creation and schedule application retry-safe

Organized capture currently uses independent `Promise.all(createTask(...))` calls. A partial failure can leave tasks created even though the UI reports failure; a retry can duplicate them.

Introduce one transactional batch-create operation for raw and organized capture; single-task quick capture uses this same operation with one item, with an idempotency key scoped to user and operation. Persist the request hash and result in the same transaction as task creation. A retry with the same key/payload returns the prior result; a reused key with different content returns a conflict. Preserve keys through uncertain network outcomes and reloads. Validate every item before committing; return per-item validation errors without creating a partial batch. Cap batch size and define idempotency retention, such as seven days, in the API contract.

For scheduling, return server-issued preview IDs and store immutable proposed changes with expiry and each target's expected revision. Apply accepts the preview ID, selected proposal IDs, and an idempotency key—not client-authored titles, dates, or ownership claims as authority. Check ownership, deletion, completion, current scheduled date, and revision inside one transaction. Lock selected targets in a stable order. A stale selected item returns a conflict and applies none of the selected batch; the UI retains choices and offers a refreshed preview. Concurrent changes to other items on destination days must also trigger capacity revalidation before commit.

Deduplicate target IDs; repeated requests must not increment reschedule counters twice. Increment the counter only for an actual date change. Use real calendar-date validation, with horizon and batch bounds. Reject impossible dates. Completed/deleted items cannot be rescheduled through old previews.

Introduce task/subtask revisions and ensure every mutation path increments them, including AI tools, calendar imports, recurrence handlers, and bulk routes. Shared domain operations should own these mutations so a route cannot bypass safeguards. Inventory writers before enabling the new conflict checks.

Calendar synchronization must follow committed changes. Persist sync events in a transactional outbox, then enqueue them through the existing worker. Retry delivery with stable event IDs; a queue outage must not turn a committed save into a false “nothing saved” response. Consolidate normal edits, bulk scheduling, preview apply, and the new daily actions onto this path. State clearly whether subtask date changes update a corresponding external event or remain local; reuse existing mappings and do not silently move an unrelated parent calendar event.

Acceptance: stale preview changes nothing; mid-batch database failure rolls back everything; retries after a lost response return the original result; no duplicate capture tasks/counter increments; other users' targets are rejected; a Redis outage retains pending sync for later delivery.

### R4. Correct learning statistics

In `services/scheduler.ts`, completed subtasks and task time logs are joined before aggregation, multiplying rows. Aggregate the two sources independently into hourly buckets and combine aggregates. Assign log durations to log times and completions to completion times; do not assign every log to a subtask's completion hour. Document whether log duration is attributed to its start hour or split across hours; use splitting across hours for the hourly recommendation so long sessions do not distort one bucket.

Use the user's configured IANA timezone for daily/hourly grouping. Keep estimated completed minutes distinct from measured tracked minutes; label the metric used. Do not present a peak hour as certain with little history. Keep recommendations informational until enough independent activity exists; define a visible minimum of five active days as an initial product rule.

Acceptance: two completed subtasks and three time logs produce exactly two completions and the original total logged minutes; standalone tasks are covered; cross-midnight sessions, DST, and insufficient history have fixtures.

### R5. Date boundaries, save feedback, and touch controls

Create one shared date hook using the user's configured timezone. Refresh at the next calendar-day boundary and on focus/visibility return; recompute after timezone changes. Never use a fixed 24-hour interval. Update Today queries, headings, overdue logic, and new review period selection together. Keep an open dirty review bound to its original week and offer to switch; never relabel old text as the new week's draft.

Show Saved only after the matching mutation succeeds. Disable duplicate submissions or coalesce them, retain failed input, and provide Retry. Apply this to TaskDetailPanel and the new daily actions. Update Today, Inbox, details, planning, and progress caches consistently after confirmed writes; optimistic changes must roll back on error.

Use at least 44 × 44 CSS pixel touch hit areas for common task controls, retaining smaller visual icons if desired. Provide visible keyboard focus, accessible names, focus restoration for dialogs, and keyboard equivalents for all daily actions. Neutral headings should respect reduced motion and both existing themes.

## 4. Proposed contracts and data changes

Names below are proposed, not existing endpoints. Final route naming should follow the repository's conventions.

| Contract | Request | Result / rule |
|---|---|---|
| Capture batch | items with optional area; explicit destination; idempotency key | Created task IDs and revisions; all-or-none writes |
| Move execution items | task/subtask IDs, expected revisions, destination date, idempotency key | Updated revisions; due dates unchanged; ownership checked |
| Select next item | date, target type, target ID | User-owned daily preference; no timer/calendar side effect |
| Schedule preview | from date and horizon | Preview ID, expiry, immutable proposals and learning summary |
| Apply preview | preview ID, selected IDs, idempotency key | Confirmed result or conflict; no partial write |
| Save review | period, content, expected revision | New revision or recoverable conflict |
| Start Google link | authenticated request | Authorization redirect bound to stored one-use attempt |

Schema additions: system default-area key, task/subtask/review revisions, daily focus, OAuth attempts, schedule preview snapshots, mutation receipts, and calendar outbox. Apply bounded retention to expired attempts/previews/receipts and delivered outbox events. Store no OAuth credentials in previews, receipts, or logs.

The codebase uses both Drizzle schema/migration artifacts and startup migrations in `apps/api/src/db/migrate.ts`. Keep them consistent. Test both a clean database and an upgraded copy; do not assume schema generation alone updates the deployed startup path. Existing records start with a valid initial revision. Add constraints only after checking existing data. Avoid destructive backfills or rewriting existing task dates.

Return structured validation, authentication, conflict, and server errors. Use 422 for invalid data and 409 for stale state/idempotency conflicts. Unauthorized IDs must not disclose another user's data. A successful save with delayed calendar sync is saved locally and pending synchronization, not failed.

## 5. Delivery sequence and file ownership

Each phase should be independently reviewable. Shared schema and mutation contracts land before dependent UI work.

| Phase | Deliverable | Main files / areas | Exit gate |
|---|---|---|---|
| 0 | Regression fixtures and current writer/API inventory | API test setup; web test scripts; Playwright configuration | Reproduce draft overwrite, join inflation, stale preview, and batch retry failures |
| 1 | Account binding and persistence safety | `google/auth.ts`, `routes/sync.ts`, review routes/service/panel including review revision and compare-and-set saves, capture modal, schema/migrations | OAuth misuse rejected; drafts survive failure and reload |
| 2 | Task/subtask mutation contracts and sync delivery | Task/subtask routes, scheduler, new capture/mutation services, queues/worker, API client | Transactions, revisions, idempotency, and sync retry tests pass |
| 3 | Fast capture and simpler onboarding | AppShell, capture components, GettingStartedCard, area defaults/filtering | New user saves a title-only task without setup or AI |
| 4 | Complete Today workflow and direct Inbox actions | Now page, TaskDetailPanel, Inbox page, daily focus routes, shared date/actions hooks | Capture, select, edit, postpone, complete without leaving Today |
| 5 | Planning labels, review choice, correct insights | PlanHeader, Plan/Review pages, scheduler learning query, terminology | Optional planning preserved; accurate timezone-aware statistics |
| 6 | End-to-end acceptance and documentation alignment | Browser journeys, README, existing product/use documents | All release gates below pass |

Within phases, bounded frontend work may run alongside independent API work after contracts are agreed. Assign a single owner for schema/migrations and one for shared API types; do not have parallel agents edit the same page or contract. Review integrations centrally.

Do not combine unrelated architecture changes, a new design system, framework upgrades, or new AI features with this work. Full offline task editing and general undo of recurrence/completion are follow-up scope; draft recovery is required here. Preserve existing AI write opt-in and preview approval boundaries.

## 6. Verification and release gates

The earlier review ran the existing API test command: five review-helper tests passed. That is historical baseline evidence, not coverage of this proposal. Add runnable API, web, and browser test scripts to the root package; the current root test command alone is insufficient. Keep OAuth tests mocked/deterministic, with a separate manual connection check on a dedicated test account.

Required scenarios:

1. Fresh account: create a task with title only, put it on Today, finish it without creating a goal/sprint or connecting a calendar.
2. Existing agenda: add another Inbox item, open details, change it, select it next, postpone one item, and complete another on Today.
3. Parent with multiple subtasks: move/select/complete the intended child; sibling dates and due dates remain unchanged.
4. Running timer: Do next does not start a second timer; stop/switch is explicit; completion resolves timing visibly.
5. More than seven items and an empty energy-filter result: all work remains discoverable; no false Day cleared state.
6. Failed/slow saves: draft/input remains; no premature success; lost responses and retries produce no duplicates.
7. Midnight, Monday, timezone change, and DST: date-derived views refresh while old review drafts retain their original period.
8. Two tabs/devices: stale review/schedule mutations conflict safely and offer recovery.
9. Calendar connection state misuse and owner isolation: reject tampering, replay, expiry, and wrong-account callbacks.
10. Database/queue failure: all-or-none mutation, durable pending sync, and safe replay after recovery.
11. Learning fixtures: no join multiplication, correct totals/hours, and explicit insufficient-data state.
12. Mobile at 360px and desktop: no horizontal overflow in the primary loop; usable touch targets; keyboard-only completion; modal focus management; both themes.

Product acceptance targets are proposed targets, not measured results: a new user can complete the first-task journey within two minutes without instruction; a returning user can capture one task within ten seconds excluding typing; each row action is reachable directly or through one clearly labelled menu. Validate these with the owner using realistic work/study/personal tasks and a short session on a phone. Record friction rather than claiming usability from passing code tests alone.

Before release, run type checking/builds, targeted API and component tests, database integration tests, and the critical browser journeys. Verify migration repeatability and an upgrade against a disposable database copy. Use additive migrations and a coordinated API/web rollout; retire unsafe old apply/batch paths so older clients cannot bypass the new rules. Old clients should receive a refresh-required response where compatibility cannot preserve safety.

Take a database backup before deployment. Roll back UI independently where compatible, but do not roll back to the unsafe OAuth or scheduling endpoints. Retain additive data/recovery records during rollback. Monitor conflict rates, duplicate-write protection, save failures, OAuth rejection categories, and outbox backlog without recording task text or credentials.

## 7. Definition of done

- A title-only task works for an account with no configured area, goal, sprint, or AI key.
- Today supports the normal daily loop, including changing the plan, without mandatory view switching.
- Existing weekly/advanced planning remains available and existing links resolve.
- User drafts survive failure, reload, and accidental close without crossing accounts or weeks.
- Calendar links are bound to the initiating account; stale/retried mutations cannot silently corrupt the plan.
- Learning statistics count each event once and use the intended timezone.
- Required automated checks and a real desktop/mobile owner walkthrough pass.
- Existing documentation is updated to describe optional planning accurately; release notes distinguish completed implementation from any remaining limitations.
