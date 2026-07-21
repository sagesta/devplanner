# DevPlanner Product Requirements Document

**Document status:** Draft for implementation  
**Product:** DevPlanner  
**Last updated:** 20 July 2026  
**Primary audience:** Product, design, engineering, testing, and future contributors

## 1. Executive Summary

DevPlanner is a personal planning and execution system that helps a person turn an unclear goal into work they can complete today. It supports capture, prioritization, weekly planning, daily execution, time tracking, accomplishments, and reflection.

The product already contains many useful planning tools. Its main remaining problem is not lack of capability; it is that the connection between those capabilities is not always obvious. A new user should not need to understand planning terminology before the app becomes useful.

The product should reinforce one understandable loop:

> **Goal -> Weekly intention -> Task -> Today -> Accomplishment -> Weekly review**

This PRD defines the work required to complete that loop without adding unnecessary screens or planning layers. It includes first-run guidance, consistent terminology, complete review persistence and history, goal linkage, lightweight focus check-ins, accomplishments, AI-assisted breakdown, exports, and automated testing.

## 2. Product Vision

DevPlanner should help a user answer six questions:

1. What matters to me?
2. What should move forward this week?
3. What do I need to do today?
4. What should I work on now?
5. What did I actually accomplish?
6. What should change next week?

The user should be able to answer these questions even when they begin with a vague goal, no syllabus, no project plan, or no idea how to divide the work.

## 3. Problem Statement

DevPlanner has capable surfaces for goals, capture, sprint planning, daily work, scheduling, insights, and review. However:

- first-time users are not fully guided through setup and their first useful plan;
- both **Inbox** and **Backlog** appear as terms for the same planning stage;
- weekly review data is only partially submitted and is saved as local Markdown files;
- review history is not visible or searchable in the app;
- weekly intentions are not clearly connected to long-term goals;
- task completion time is treated as evidence of productivity but not necessarily focus quality or learning quality;
- planning support for vague goals needs a clearer, review-before-create workflow;
- critical workflows do not yet have automated test coverage.

These gaps make the app feel more complex than it needs to be and weaken cross-device continuity.

## 4. Product Principles

### 4.1 One planning loop

Every major screen should have a clear role in the same loop. Features that do not strengthen that loop should not become top-level navigation.

### 4.2 Plain language

Labels and guidance should use words a first-time planner can understand. The app should explain the next decision, not the planning theory behind it.

### 4.3 Progressive detail

Only the fields needed for the current decision should be prominent. Optional details remain available but should not block task creation or completion.

### 4.4 Review before automation

AI may propose goals, tasks, dates, estimates, and schedules. The user reviews and approves a proposal before the app writes or reorganizes work.

### 4.5 Evidence over guilt

Reviews should help the user learn from capacity, focus, completion, and carryover. They should not punish unfinished work or require every task to belong to a goal.

### 4.6 Cross-device by default

Important planning data belongs in the server database. Browser-only storage is acceptable only for temporary drafts and device-specific preferences.

## 5. Target Users and Scenarios

### 5.1 Beginner planner

A user who has responsibilities and ambitions but does not know how to turn them into a structured plan.

**Need:** guided setup, examples, simple prompts, and a clear next action.

### 5.2 Student or exam candidate

A user preparing for an exam without a complete reading guideline.

**Need:** define the result, inventory available material, identify unknowns, create weekly learning outcomes, schedule study tasks, and review confidence and focus.

### 5.3 Professional or project worker

A user managing projects, recurring responsibilities, meetings, and evidence for reviews or promotion.

**Need:** connect work to goals, plan weekly outcomes, track focused time, record impact and proof, and export accomplishments.

### 5.4 Personal and household planner

A user balancing health, errands, appointments, family, learning, and personal goals.

**Need:** capture quickly, separate commitments from ideas, plan realistic days, and avoid forcing ordinary tasks into formal projects.

## 6. Canonical Terminology and Navigation

The user-facing navigation consists of six rooms:

| Room | Purpose | Key question |
| --- | --- | --- |
| Today | Execute the daily plan | What should I do now? |
| Inbox | Capture and clarify loose work | What is this, and is it worth doing? |
| Plan | Commit, arrange, and repair work | What will I do and when? |
| Review | Reflect, learn, and record results | What happened and what changes next? |
| Goals | Set longer-term direction | What am I trying to achieve? |
| Settings | Configure behavior and integrations | How should the app work for me? |

**Terminology decision:** Use **Inbox** in all user-facing text. Existing internal routes, API names, or database names may continue using `backlog` where changing them would add risk without user benefit.

Plan may contain the existing Sprint, Board, Timeline, and Table views. Review may contain Weekly Review, Progress, and Accomplishments. These are views within a room, not separate top-level jobs.

## 7. Core Product Model

DevPlanner should not add a separate Action Plan screen. An action plan is represented by linked weekly intentions and tasks.

| Planning concept | DevPlanner representation |
| --- | --- |
| Goal | A desired outcome with a reason and target period |
| Action plan | Weekly intentions and tasks linked to the goal |
| Daily plan | Scheduled or selected tasks on Today |
| Work record | Completed tasks, time logs, and optional focus check-ins |
| Accomplishment | A meaningful result with impact and proof |
| Reflection | A saved weekly review |

This keeps the hierarchy understandable:

```text
Goal
  -> Weekly intention
      -> Sprint task
          -> Today's work
              -> Completion and time log
                  -> Optional accomplishment
                      -> Weekly review and next decision
```

## 8. Current Baseline

The following capabilities already exist and should be preserved:

- [x] Server-synced goal horizon matrix.
- [x] Brain dump and AI-assisted task organization.
- [x] Inbox/backlog task triage.
- [x] Sprint planning, board, timeline, and table views.
- [x] Today view, task completion, timer, and rollover preview.
- [x] Recurring task generation after completion.
- [x] Soft-delete and restore support for tasks.
- [x] AI tools with a user-controlled write permission.
- [x] Adaptive capacity based partly on completion history.
- [x] Google Calendar and CalDAV integration foundations.
- [x] Lightweight first-run checklist on Today.
- [x] Accomplishment records with date, result, impact, metric, skills, and optional task link.
- [x] Weekly review interface with wins, carryover, intentions, sprint notes, and approval steps.
- [x] Beginner planning guide PDF.

The baseline is not the same as completion. Several capabilities need the changes described below before the overall workflow is reliable.

## 9. Functional Requirements

### FR-1: First-Run Setup and Coaching

The app shall guide a new user from an empty account to a usable first day and first week.

The guided flow shall:

1. ask the user to choose or create a small number of life/work areas;
2. let the user set optional weekly hour targets;
3. help the user write one goal and why it matters;
4. open Brain Dump for capturing unfinished thoughts;
5. help the user choose up to three weekly intentions;
6. create or select the first sprint;
7. help the user choose the first task for Today.

Requirements:

- The user can skip any optional step.
- Progress syncs across devices when it represents completed setup, not just dismissed UI.
- The existing small Today checklist may remain as a condensed entry point.
- Every major empty state explains what belongs on the page and offers one primary action.
- Example content must be editable and clearly identified as an example.

Acceptance criteria:

- A new user can reach a non-empty Today plan without navigating outside the guide.
- Closing and reopening the app on another device does not restart completed setup.
- Skipping calendar connection does not prevent setup completion.
- The flow works on phone and desktop widths.

### FR-2: Consistent Inbox Terminology

The app shall use **Inbox** for the capture-and-triage area in all visible labels, help text, empty states, commands, notifications, and onboarding.

Acceptance criteria:

- No user-facing interface uses **Backlog** to name the room.
- Contextual wording such as “leave this task for later” may be used where clearer.
- Existing `/backlog` links continue to work.

### FR-3: Goal Definition

Each goal should help the user understand the desired outcome and why it deserves attention.

Minimum goal information:

- title or outcome;
- area: personal, professional, work, or a configured area;
- horizon or target period;
- optional target date;
- optional “Why this matters” statement;
- status: active, paused, achieved, or archived.

Requirements:

- Existing horizon-matrix content must remain readable during any data-model evolution.
- A goal can exist without tasks while the user is still exploring it.
- The user can ask AI to propose a breakdown.
- AI output appears as an editable draft before tasks are created.

Acceptance criteria:

- A user can identify what success looks like and why the goal matters from the goal view.
- Goals remain synchronized for the same signed-in account across devices.
- Archiving a goal does not delete its linked history.

### FR-4: Goal Breakdown and Action Planning

The app shall help a user turn a vague goal into manageable work without creating a separate Action Plan module.

The breakdown experience shall support:

- a target result;
- known constraints and deadlines;
- what the user already knows;
- what must be researched or clarified;
- monthly or phase milestones when the goal is long enough;
- weekly outcomes;
- concrete tasks with estimates;
- optional frequency for recurring practice;
- optional skill or subject tags;
- a plain-language reason for each proposed phase.

For goals without a syllabus or guideline, the proposal should begin with discovery tasks such as collecting source material, identifying the exam or project scope, finding an authoritative outline, and testing current knowledge.

Acceptance criteria:

- The user may edit, remove, reorder, or reject every proposed item.
- No task is created until the user approves the draft.
- Approved tasks retain a link to the originating goal.
- The app does not invent hard deadlines unless the user provided one.

### FR-5: Weekly Intentions and Goal Linkage

Each weekly intention may optionally link to one active goal.

Requirements:

- Goal linking is optional because errands and routine maintenance may not advance a formal goal.
- The weekly review shows which goals received progress.
- The review identifies active goals with no linked work during the period.
- Repeated significant work with no linked goal is surfaced as a neutral observation, not an error.
- A linked intention passed into a sprint retains its goal relationship.

Acceptance criteria:

- A user can select a goal while writing a weekly intention.
- A task created from that intention displays the goal in task details.
- Goal progress views can count linked completed work without depending on text matching.

### FR-6: Daily Planning

Today shall remain the execution surface, not a second Inbox.

The user shall be able to:

- select or schedule tasks for today;
- see estimated workload against available capacity;
- optionally group work into Morning, Afternoon, and Evening;
- use simple category presets such as Work, Study, Health, Errand, Communication, and Personal;
- start or stop time tracking;
- complete, defer, or reschedule work;
- see the next occurrence when a recurring task is completed.

Time-of-day groups and category presets are optional helpers. They must not become required task fields.

Acceptance criteria:

- A user can create and complete a basic task without opening advanced fields.
- Moving a task between time-of-day groups does not change its due date unexpectedly.
- The page stays usable when the user has more work than daily capacity.

### FR-7: Focus and Energy Check-Ins

The app shall collect optional signals that distinguish time spent from quality of attention.

Before a focus session, the user may record:

- current energy: low, medium, or high;
- expected difficulty: easy, moderate, or difficult.

After the session, the user may record:

- focus quality: poor, fair, good, or excellent;
- actual difficulty: easier than expected, as expected, or harder than expected;
- optional note.

Requirements:

- Check-ins are skippable and should take no more than a few seconds.
- The app must not infer learning quality solely from completion time.
- Insights may compare estimates, actual duration, energy, and reported focus after enough data exists.
- Early insights must say when the sample is too small.

Acceptance criteria:

- Skipping a check-in never blocks starting or stopping a timer.
- Check-in data is private to the account.
- Insights do not recommend a “best focus time” from an insufficient sample.

### FR-8: Complete Weekly Review Persistence

Weekly reviews shall be stored as structured, user-owned database records rather than relying on local filesystem Markdown files.

Each review record shall include:

- user ID;
- week start and week end;
- wins;
- carryover and blockers;
- next-week intentions;
- draft sprint notes;
- goal links for intentions where selected;
- linked sprint ID when a sprint is created;
- completion timestamp;
- created and updated timestamps.

The fifth step shall be a confirmation summary rather than another free-text note.

Requirements:

- Saving the review and creating its sprint should be one reliable operation or expose partial failure clearly with a retry path.
- The UI must not report success if review persistence failed.
- A user may save a draft and continue on another device.
- Existing local drafts may be imported once where practical.
- Markdown may remain an export format, but not the only source of truth.

Acceptance criteria:

- All meaningful information entered in steps one through four is preserved.
- A completed review can be reopened after signing in on another device.
- Repeated submission does not create duplicate reviews or duplicate sprints.
- A failed save leaves the user’s draft intact and offers retry.

### FR-9: Review History

Review shall include a History view for finding and comparing previous weeks.

The history experience shall support:

- newest-first review list;
- date range filtering;
- text search across wins, blockers, intentions, and sprint notes;
- opening a complete review;
- comparison with the previous review;
- recurring carryover and blocker indicators;
- linked goals and sprint.

Acceptance criteria:

- A user can locate a review by date or remembered phrase.
- Empty history explains that the first weekly review will appear there.
- Deleting or archiving a review requires confirmation and does not delete tasks or accomplishments.

### FR-10: Accomplishments

The existing accomplishment log shall remain the durable record of meaningful outcomes.

The user shall be able to record:

- date;
- project or initiative;
- role or contribution context;
- what was done;
- impact;
- metric or proof;
- skills used;
- notes;
- whether the work was inside or outside the user’s normal responsibility, when useful.

To keep entry simple, only date and “what was done” are required. Additional tracker-inspired fields may live behind an optional details section.

Requirements:

- Completing an important task may offer “Save as accomplishment?”
- The app should prefill known information from the task.
- The user decides whether the completion is meaningful enough to save.
- Weekly Review can show recent accomplishments as possible wins.

Acceptance criteria:

- Declining the prompt does not affect task completion.
- Editing or deleting an accomplishment does not alter the original task.
- Accomplishments remain available after a linked task is soft-deleted.

### FR-11: Accomplishment Export and STAR Support

The user shall be able to export accomplishments for reporting, performance reviews, CV preparation, or personal records.

Formats:

- CSV for analysis;
- PDF for reading or sharing;
- optional Markdown.

The app may help transform an accomplishment into STAR format:

- Situation;
- Task;
- Action;
- Result.

Acceptance criteria:

- Exports respect the selected date range and filters.
- Exported files clearly identify missing optional fields without inventing content.
- AI-generated STAR wording is presented for review before export.

### FR-12: Review Summary and Goal Progress

The Review area shall summarize:

- completed tasks;
- important accomplishments;
- planned versus tracked time;
- carryover;
- goal-linked progress;
- active goals with no recent movement;
- estimate accuracy;
- optional focus and energy patterns when enough data exists.

Goal progress should use understandable evidence. It must not display a false precise percentage when the goal has no measurable plan.

Acceptance criteria:

- The app distinguishes “no activity recorded” from “goal is failing.”
- Every progress claim can be traced to tasks, accomplishments, time logs, or a user-entered measure.

### FR-13: Cross-Device Behavior

The following data shall synchronize for the same signed-in account:

- goals and goal links;
- tasks, subtasks, schedules, and sprint membership;
- weekly intentions and reviews, including drafts;
- accomplishments;
- focus and energy check-ins;
- onboarding completion state that changes product behavior.

The following may remain device-specific:

- temporary unsaved form text;
- visual preferences that intentionally apply only to one browser;
- AI “Can edit” permission, unless the product later defines it as an account security setting.

Acceptance criteria:

- Refreshing or changing devices does not lose saved planning data.
- Last-write behavior is documented and avoids silently replacing newer content where feasible.

### FR-14: Empty States and Help

Every major room shall have a useful empty state containing:

- one sentence explaining what belongs there;
- one primary action;
- one short example when the concept is unfamiliar;
- a link to the beginner planning guide where relevant.

The app shall not fill empty pages with feature descriptions or long instructions. Guidance should disappear naturally after the user has real content.

## 10. Required User Flows

### 10.1 Vague exam goal

1. User enters “Pass the certification exam in October.”
2. User adds why it matters and the known exam date.
3. AI asks for or proposes discovery steps: official syllabus, topic list, practice test, available study hours.
4. User reviews phases and weekly outcomes.
5. Approved tasks are created and linked to the goal.
6. User selects this week’s intentions and today’s study task.
7. After study, the user optionally records focus quality and actual difficulty.
8. Weekly Review compares intention, completion, confidence evidence, and carryover.

### 10.2 Work project

1. User creates a goal describing the desired business or delivery outcome.
2. User captures project work and clarifies it in Inbox.
3. User links the week’s most important outcome to the goal.
4. Tasks enter the sprint and Today plan.
5. A meaningful completion is saved as an accomplishment with impact and proof.
6. Weekly Review records blockers and creates the next sprint.
7. Accomplishments are later exported for a performance review.

### 10.3 Daily life

1. User captures errands, appointments, health tasks, and household work.
2. Routine items may remain unlinked to goals.
3. User selects a realistic set for Today and groups it by time of day if helpful.
4. Unfinished items are deliberately rescheduled, returned to Inbox, or removed.
5. Weekly Review focuses only on meaningful patterns, not every small chore.

## 11. Data Requirements

The implementation may adapt names to existing conventions, but it should provide the following concepts.

### 11.1 Weekly review

Suggested fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key |
| `user_id` | UUID | Required owner |
| `week_start` | Date | Unique with user |
| `week_end` | Date | Required |
| `wins` | Text | Step one |
| `carryover` | Text | Step two |
| `intentions` | JSON or related rows | Supports goal links |
| `sprint_notes` | Text | Step four |
| `sprint_id` | UUID nullable | Created sprint |
| `status` | Enum | Draft or completed |
| `completed_at` | Timestamp nullable | Completion time |
| `created_at` | Timestamp | Audit field |
| `updated_at` | Timestamp | Audit field |

Use a related `weekly_intentions` table if intention-level goal links and status will be queried frequently. Otherwise, begin with validated JSON and migrate only when needed.

### 11.2 Goal links

Tasks and weekly intentions need an optional stable goal reference. Goal history must survive task completion and goal archiving.

### 11.3 Focus check-ins

Focus check-ins should link to the user and, where available, the time log and task. Store the user’s explicit answer separately from any derived insight.

### 11.4 Accomplishment extensions

Existing accomplishments already contain date, task link, title, impact, metric, and skills. Optional project, role, notes, and responsibility-scope fields can be added without making them required.

## 12. API Requirements

At minimum, the product needs authenticated, owner-scoped operations for:

- create or update a weekly review draft;
- complete a review and create/link the sprint safely;
- list reviews with pagination and filters;
- fetch one review;
- archive or delete a review without deleting linked work;
- link goals to intentions and tasks;
- create focus check-ins;
- export accomplishments.

API requirements:

- validate all payloads;
- enforce ownership on every read and write;
- use idempotency or unique constraints for one review per user per week;
- return explicit partial-failure information when an operation cannot be atomic;
- never return filesystem paths to the browser as the review identifier;
- log operational failures without exposing private review content unnecessarily.

## 13. Non-Functional Requirements

### 13.1 Accessibility

- All flows shall be keyboard operable.
- Controls shall have visible focus states and meaningful accessible names.
- Status shall not depend on color alone.
- Form errors shall be associated with their fields.
- Mobile layouts shall avoid clipped controls, overlapping text, and horizontal scrolling.

### 13.2 Performance

- Today, Inbox, and Plan should become interactive quickly on ordinary connections.
- Review history shall use pagination or incremental loading.
- Search should debounce input and avoid loading every review into the browser.

### 13.3 Reliability

- User-entered review text shall remain available after failed requests.
- Repeated button presses shall not duplicate reviews, sprints, recurring tasks, or accomplishments.
- Background integration failures shall not prevent local planning actions.

### 13.4 Privacy and Security

- All records are private to the authenticated user unless sharing is explicitly introduced later.
- AI write access remains opt-in and clearly visible.
- Sensitive review text should not be included in routine logs.
- Exports are created only after an explicit user request.

## 14. Success Measures

The following indicators should be measured after implementation:

- percentage of new users who create a first task;
- percentage who create a first Today plan;
- percentage who complete first-run setup;
- weekly review completion rate;
- percentage of completed reviews successfully reopened later;
- percentage of active goals with at least one linked weekly intention;
- rate of recurring carryover across three or more reviews;
- accomplishment logging and export usage;
- review save failure and duplicate sprint rates;
- task estimate error over time;
- optional focus check-in participation.

Metrics should be used to understand friction, not to rank or shame users.

## 15. Delivery Plan and Task Checklist

### Phase 0: Product and Data Decisions

- [x] Confirm **Inbox** as the only user-facing term.
- [x] Confirm the canonical loop and six-room navigation.
- [ ] Decide whether structured goals replace or extend the current horizon matrix.
- [ ] Decide whether weekly intentions use related rows or validated JSON.
- [ ] Define migration and rollback plans for filesystem reviews.
- [ ] Define retention behavior for archived goals and reviews.

### Phase 1: Reliable Weekly Review (P0)

- [x] Add weekly review and optional weekly intention database tables.
- [x] Add database migration, indexes, ownership constraints, and uniqueness by user/week.
- [x] Replace filesystem-only review persistence with database persistence.
- [x] Save wins, carryover, intentions, and sprint notes.
- [x] Replace step-five textarea with a confirmation summary.
- [x] Preserve drafts on the server so they continue across devices.
- [x] Make completion and sprint creation atomic or safely retryable.
- [x] Stop swallowing review-save errors in the web interface.
- [x] Prevent duplicate review and sprint creation.
- [x] Add Review History list, detail view, search, and date filtering.
- [x] Add previous-week comparison and recurring carryover indicators.
- [ ] Provide a one-time migration/import path for useful existing Markdown reviews.
- [ ] Add review API and interface tests.

### Phase 2: Goal-to-Week Connection (P0)

- [ ] Add optional “Why this matters” and target date to goals.
- [ ] Add goal status without deleting historical links.
- [x] Add optional goal link to each weekly intention.
- [ ] Add optional goal link to tasks created from intentions or AI breakdowns.
- [ ] Display the linked goal in task details and sprint views.
- [ ] Show goal-linked progress in Weekly Review.
- [ ] Surface active goals with no recent linked work as neutral guidance.
- [ ] Surface repeated important work with no goal as an optional reflection prompt.
- [ ] Add ownership and cross-device synchronization tests.

### Phase 3: First-Run Clarity (P0)

- [ ] Expand onboarding to areas, hour targets, one goal, Brain Dump, intentions, sprint, and first Today task.
- [ ] Store meaningful onboarding progress on the server.
- [ ] Make every optional setup step skippable.
- [ ] Add empty-state coaching to Today, Inbox, Plan, Review, Goals, and Settings where appropriate.
- [x] Replace visible **Backlog** terminology with **Inbox**.
- [x] Keep legacy routes and deep links working.
- [ ] Add responsive and keyboard-flow tests for onboarding.

### Phase 4: Goal Breakdown Assistance (P1)

- [ ] Add “Break this goal down” from the goal view.
- [ ] Collect target, deadline, constraints, available time, and known source material.
- [ ] Support discovery-first plans when no syllabus or guideline exists.
- [ ] Generate editable phases, weekly outcomes, tasks, estimates, and frequencies.
- [ ] Require user approval before creating tasks.
- [ ] Preserve goal links on approved work.
- [ ] Add exam, work-project, and personal-goal proposal fixtures and tests.

### Phase 5: Daily Planning Improvements (P1)

- [ ] Add optional Morning, Afternoon, and Evening groupings.
- [ ] Add simple category presets: Work, Study, Health, Errand, Communication, Personal.
- [ ] Keep category and time-of-day fields optional.
- [ ] Ensure capacity warnings do not block deliberate overbooking.
- [ ] Verify recurrence, rescheduling, timer, and calendar behavior with new fields.

### Phase 6: Focus and Energy Learning (P1)

- [ ] Add optional pre-session energy and expected-difficulty check-in.
- [ ] Add optional post-session focus-quality and actual-difficulty check-in.
- [ ] Link check-ins to time logs and tasks where available.
- [ ] Add minimum-sample rules before showing patterns.
- [ ] Compare estimate, duration, energy, and reported focus in Insights.
- [ ] Clearly separate user reports from algorithmic inferences.

### Phase 7: Accomplishment Depth and Export (P1)

- [ ] Add optional project/initiative, role, notes, and responsibility-scope fields.
- [ ] Keep the quick accomplishment form limited to essential fields.
- [ ] Offer “Save as accomplishment?” after meaningful task completion.
- [ ] Prefill accomplishment details from the completed task.
- [ ] Include recent accomplishments as suggested Weekly Review wins.
- [ ] Add CSV export with date and filter support.
- [ ] Add readable PDF export.
- [ ] Add editable AI-assisted STAR formatting.
- [ ] Add export and ownership tests.

### Phase 8: Automated Quality Coverage (P0 across phases)

- [x] Add a working root unit-test script and review-domain test suite.
- [ ] Add integration and browser test scripts.
- [ ] Add API test database setup and teardown.
- [ ] Test recurring task spawning and idempotency.
- [ ] Test task ownership and soft-delete restoration.
- [ ] Test review drafts, completion, history, search, and duplicate prevention.
- [ ] Test goal ownership, linking, and cross-device persistence.
- [ ] Test AI read-only mode and explicit write permission.
- [ ] Test calendar push/pull mappings and failure handling.
- [ ] Test scheduler capacity and estimate calculations.
- [ ] Test accomplishment creation, task prefill, and export.
- [ ] Add one browser journey: capture -> Inbox -> sprint -> Today -> complete -> review.
- [ ] Add one browser journey for new-user onboarding.
- [ ] Run accessibility checks on the six main rooms.
- [ ] Make tests part of continuous integration.

### Phase 9: Documentation and Release (P0)

- [ ] Update the beginner planning guide with the final goal and review screens.
- [ ] Add short contextual help links from Goals and empty states.
- [ ] Document synchronized versus device-specific settings.
- [ ] Document review migration and recovery procedures.
- [ ] Add release notes describing terminology changes.
- [ ] Verify desktop and mobile layouts with screenshots before release.
- [ ] Perform a fresh-account acceptance test using exam, work, and personal scenarios.

## 16. Recommended Release Slices

To avoid an oversized release, deliver the work in three usable slices.

### Release A: Trust the Review

- structured review persistence;
- all meaningful review fields saved;
- confirmation summary;
- server drafts;
- review history and search;
- core tests.

### Release B: See Why the Week Matters

- consistent Inbox wording;
- improved onboarding and empty states;
- goal reason and target;
- weekly intention and task goal links;
- goal-aware review summary.

### Release C: Learn and Report

- lightweight focus check-ins;
- deeper accomplishment fields;
- CSV/PDF export and STAR assistance;
- broader automated and browser coverage.

Goal breakdown assistance may ship with Release B or immediately afterward, depending on how much the goal data model changes.

## 17. Out of Scope for This PRD

The following should not be added as part of this work unless a separate product decision is made:

- team workspaces, managers, approvals, or shared project boards;
- social feeds, leaderboards, streak punishment, or public productivity scores;
- a separate top-level Action Plan page;
- mandatory goal links for every task;
- automatic AI changes without explicit permission and review;
- complex project accounting or enterprise timesheets;
- false percentage progress for goals that have no measurable definition.

## 18. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| More goal fields make Goals harder to use | Require only an outcome; progressively disclose the rest |
| Review migration loses old content | Keep original files, make import idempotent, and report skipped files |
| Review completion creates duplicate sprints | Unique review/week constraint plus idempotent completion operation |
| Goal linking creates guilt or busywork | Keep links optional and use neutral language |
| Focus prompts interrupt work | Make them skippable, one-click, and remember dismissal for the session |
| AI invents structure or deadlines | Show a draft, distinguish assumptions, and require approval |
| History search becomes slow | Store structured records, index owner/date, paginate, and use server search |
| Added fields clutter Today | Keep advanced metadata in task details, not the primary task row |

## 19. Definition of Done

A requirement is complete only when:

- the user-facing behavior meets its acceptance criteria;
- data is authenticated, owner-scoped, and synchronized as specified;
- loading, empty, success, error, and retry states are implemented;
- keyboard and responsive behavior are verified;
- automated tests cover the primary behavior and failure cases;
- migrations and rollback considerations are documented;
- relevant user and developer documentation is updated;
- no existing capture, recurrence, timer, calendar, or task-restore workflow regresses.

## 20. Final Product Test

Before release, a person unfamiliar with DevPlanner should be able to complete the following without outside explanation:

1. Create “Pass my exam” or “Deliver the reporting project” as a goal.
2. Explain why it matters and add a date if known.
3. Get a useful proposed breakdown despite having no initial structure.
4. Approve selected tasks and see their goal connection.
5. Choose three intentions for the week.
6. Put one task on Today and complete it.
7. Record a meaningful outcome as an accomplishment.
8. Complete and save a weekly review.
9. Reopen that review on another device.
10. Understand what to do next without learning new planning terminology.

If this journey is clear, reliable, and calm, the product requirements in this document have achieved their purpose.
