# DevPlanner — Implementation Context

> Living document. Section 1 captures **what's actually in the repo today**.
> Section 2 is the **planned roadmap** distilled from the unified spec.
> Section 3 is the **patch log** — appended as work lands.

Last surveyed: 2026-05-13.

---

## 1. Current state (what's already built)

### 1.1 Stack
- **API**: Hono on Node, Drizzle ORM, Postgres + pgvector, BullMQ + Redis workers — `apps/api/`
- **Web**: Next.js 14 App Router, TailwindCSS, React Query, dnd-kit, cmdk, lucide-react — `apps/web/`
- **Infra**: Docker Compose (Postgres, Redis, Radicale, web, api, worker, prometheus, loki, promtail, crowdsec)
- **Observability**: pino logger, prom-client `/metrics` endpoint
- **AI**: OpenAI embeddings + chat with pgvector RAG, read-only planner tools

### 1.2 Schema (`apps/api/src/db/schema.ts`)
- **users** — single-user-ish; capacity tuning fields (dailyCapacityMinutes, efficiencyFactor, bufferFactor, cognitiveLoadBaseline)
- **areas** — top-level grouping (Work / Personal); per-user
- **projects** — under an area
- **sprints** — time-boxed iterations
- **tasks** — title, status, priority, energyLevel, workDepth, physicalEnergy, dueDate, scheduledDate, **`recurrenceRule` (text, NOT materialized)**, caldav/google sync metadata, soft-delete via `deletedAt`
- **subtasks** — scheduled atomic units; have own `estimatedMinutes`, `scheduledDate`, `scheduledTime`
- **focusSessions** — pomodoro/work intervals, work/short_break/long_break
- **taskTimeLogs** — start/stop logs with generated `durationSeconds`
- **tags** + **taskTags** — many-to-many, color-coded
- **taskEmbeddings** — 1536-d vectors per task for semantic search
- **aiCallLog**, **aiSuggestions** — AI usage + suggestion history
- **googleCalendarLinks**, **caldavSyncLog** — two-way calendar sync state

### 1.3 API routes (`apps/api/src/routes/`)
- `/api/tasks` — CRUD, brain-dump bulk insert, bulk status, auto-schedule preview, bulk reschedule
- `/api/subtasks` — CRUD, bulk add; parent-task status rollup on completion
- `/api/areas`, `/api/projects`, `/api/sprints` — CRUD
- `/api/tags` — list/create/delete, set tags for a task
- `/api/time-logs` — start/stop timer (auto-stops running ones)
- `/api/focus` — pomodoro session start/stop
- `/api/schedule` — schedule preview/apply
- `/api/insights` — calendar-progress, heatmap, peak hour
- `/api/reviews` — weekly reflection persistence
- `/api/ai` — chat with RAG, read-only tool calls
- `/api/sync` — Google + CalDAV connect/disconnect, manual pull/push triggers
- `/api/events` — server-sent events for live updates (idle banner)
- `/api/backlog` — backlog views

### 1.4 Web pages (`apps/web/app/(app)/`)
- **/now** — daily worklist, active-task timer, capacity bar, auto-scheduler suggestions
- **/backlog** — hierarchical task tree grouped by Area, inline add/delete
- **/board** — kanban; **hardcoded 3 lanes** (todo / in_progress / done); drag to reorder
- **/timeline** — gantt-style scheduled work
- **/table** — bulk-ops table view
- **/sprints** — sprint CRUD + active badge
- **/insights** — calendar progress, hour-of-day heatmap, peak-hour detection
- **/review** — multi-step weekly reflection (completions → carry-overs → top 3 → next sprint)
- **/settings** — General, Areas, Calendar, Focus (pomodoro), AI tabs

### 1.5 Web components already built (`apps/web/components/`)
- **app-shell.tsx** — sidebar nav (collapsible), theme toggle (dark/light), top bar with timer indicator, mobile bottom nav
- **command-menu.tsx** — Ctrl+K palette via cmdk; navigate, search tasks, Brain Dump action (Ctrl+Shift+D)
- **brain-dump-modal.tsx** — bulk capture with area picker, date/time, recurrence preset
- **notifications-tray.tsx** — Alt+T tray
- **idle-banner.tsx** — SSE-driven warning when a task has been in_progress too long (server-side detection)
- **TaskDetailPanel.tsx**, **task-card.tsx**, **kanban-board.tsx** (1053 LOC), **timeline-board.tsx** (774 LOC)
- **TagChip.tsx**, **TagSelector.tsx** — used in TaskDetailPanel, not surfaced elsewhere
- **GlobalTimerIndicator.tsx**, **TimerButton.tsx**, **TimeWeekPanel.tsx**
- **ai-chat-dock.tsx** — floating AI chat
- **MarkdownMessage.tsx**, **AddToSprintButton.tsx**, **ZoomControl.tsx**

### 1.6 Existing keyboard shortcuts
- `Ctrl/Cmd+K` → command palette
- `Ctrl/Cmd+Shift+D` → brain dump
- `Alt+T` → notifications tray
- **No `?` help modal, no T/F/N/E/D/Esc, no Ctrl+Space.**

### 1.7 Scheduler (`apps/api/src/services/scheduler.ts`)
- `calculateDailyCapacity` — `dailyCapacityMinutes × efficiencyFactor × (1 − bufferFactor)` — **static, not learning**
- `runAutoScheduler` — priority-sorted fill of a single day; overflow rolls to tomorrow with `rescheduleCount++`; `>3` → `needs_rescheduling`
- `buildSchedulePreview` — multi-day forward fill, exposed via `POST /api/tasks/auto-schedule`
- **Recurring tasks** — `recurrenceRule` is stored on tasks but **no materialization logic exists**. Marking a recurring task `done` does not create the next instance.

### 1.8 Auth & user model
- NextAuth (Google OAuth); allow-list via `ALLOWED_EMAILS`
- `requireAuth` middleware on all `/api/*`
- For our purposes: single-user, but tables are user-scoped — keep schema; pin a single user.

---

## 2. Roadmap (target features, from the unified spec)

### Phase 1 — UI shell + fluidity (foundation)
- [x] **Keyboard shortcuts infrastructure** + `?` help modal listing all
- [x] **Ctrl+Space** global quick-capture (single-line → Inbox, zero friction; distinct from Brain Dump's bulk modal)
- [ ] **N** → new task in current view; **T** → toggle timer; **F** → focus mode; **D** → done; **E** → edit; **Esc** → close panels *(requires cross-view "selected task" state — punt)*
- [ ] **Status bar** at bottom: active task + timer + est. remaining
- [ ] **Right detail panel** opens on task click without view change (TaskDetailPanel exists but doesn't slide in as a global right panel)

### Phase 2 — Task model & data layer
- [x] **Inbox** as a first-class system area: auto-created per user, target for zero-friction capture; nav-sidebar entry with count badge
- [x] **Recurring tasks actually recur** — on task `done`, materialize next instance from `recurrenceRule`
- [x] **Recurring indicator** on task cards (loop icon)
- [ ] **Task dependencies** (`blockedBy`) + `blockedReason` text
- [ ] **Rich Markdown notes** on tasks (already have `description` text field — surface in detail panel with markdown render)
- [~] **Surface tags throughout** — kanban cards + Now list already wire `_tags`; still missing on Timeline/Table filter chips

### Phase 3 — Daily loop
- [ ] **Focus Mode** — full-screen single-task view with pomodoro ring tied to active timer
- [ ] **Pomodoro ↔ Now-page timer integration** — settings exist (work/short/long), wire them
- [ ] **Client-side idle detection** — listen for kb/mouse inactivity, prompt on return ("discard / log as break / log as work")
- [ ] **Break reminders** — toast + optional Web Push after configurable continuous-work threshold
- [ ] **Daily reflection** — auto-fire EOD modal (separate from /review weekly flow)
- [ ] **Energy check-in** — one-tap on Now page; scheduler already scores by match

### Phase 4 — Planning views
- [ ] **Planner view** — weekly drag-drop columns with capacity bars per day
- [ ] **Schedule/timeline view** polish — time blocks, conflict detection, block height = estimate
- [ ] **Kanban polish** — configurable columns, WIP limits, optional swimlanes by area

### Phase 5 — Learning & coaching
- [ ] **Variance badges** — `+40% over` chips on completed tasks
- [ ] **Adaptive capacity** — feed 14-day rolling actual throughput into capacity calc
- [ ] **Timer-stop reflection** — optional one-line note on stop
- [ ] **Smart estimate suggestion** — pgvector similar past tasks → seed estimate

### Phase 6 — Visibility
- [ ] **Metrics view** — estimation accuracy chart, productivity heatmap, pomodoro count, tag distribution
- [ ] **Worklog** — chronological completed-tasks log with filters; quick-history dropdown in status bar

### Phase 7 — Power
- [ ] **What-if extension** — task dependencies in projection
- [ ] **AI write tools (with approval)** — `executePlannerTool` skeleton exists for write actions
- [ ] **JSON export/import** + undo/redo

### Explicitly dropped / deferred
- Multi-user, mobile apps, switch to SQLite/Electron, task audit history, recurrence one-vs-all-future split UX, streaks/gamification

---

## 3. Patch log

Append a dated entry per landed change. Most recent first.

<!-- PATCH LOG START -->

### 2026-05-13 — Phase 1 + Phase 2 first cut

**Keyboard shortcuts foundation**
- `apps/web/hooks/use-keyboard-shortcut.ts` — reusable `useKeyboardShortcut(spec, handler)` hook; cross-platform Ctrl/Cmd; skips form fields by default; rejects ctrl-modified events unless requested.
- `apps/web/components/shortcuts-help.tsx` — `?` opens a modal listing all shortcuts; Esc closes.
- `apps/web/components/app-shell.tsx` — refactored existing Alt+T handler onto the new hook; added `Ctrl+Space` → quick capture and `?` → help modal; introduced `closeAllOverlays()` to prevent overlay stacking.

**Quick capture → Inbox**
- `apps/web/components/quick-capture-modal.tsx` — single-line input, Enter saves and stays open for rapid capture, shows last 5 captures, Esc closes. Skips the area picker entirely (always lands in Inbox).
- `apps/web/lib/api.ts` — `fetchInboxArea()` client helper; `AreaRow.isInbox?` field added.

**Inbox as a first-class system area**
- `apps/api/src/db/schema.ts` — `areas.isInbox` boolean column.
- `apps/api/src/db/migrate.ts` — additive migration; partial unique index `areas_one_inbox_per_user_uidx WHERE is_inbox = TRUE` guarantees a single Inbox per user.
- `apps/api/src/routes/areas.ts` — `ensureInboxArea(userId)` helper; new `GET /api/areas/inbox` (ensure-and-return); existing `GET /api/areas` now lazily ensures the Inbox before returning.
- `apps/web/app/(app)/inbox/page.tsx` — new triage page: lists Inbox tasks, per-row "move to area" dropdown + done + delete.
- `apps/web/components/app-shell.tsx` — Inbox added to sidebar nav with an open-count badge (and a dot in collapsed mode). Renamed `/backlog` from "Capture" → "Backlog" since Inbox is now the capture target.

**Recurring tasks actually recur**
- `apps/api/src/services/recurrence.ts` — minimal RFC5545 RRULE parser (FREQ + INTERVAL + WEEKLY BYDAY); `materializeNextRecurrence(db, taskId)` creates a fresh instance (resets subtask completion, drops calendar identity, resets `rescheduleCount` and `schedulingState`).
- `apps/api/src/routes/tasks.ts` — both `PATCH /:id` and `POST /bulk-status` now detect the *transition* into `done` (snapshot prior status first) and call the materializer only on that edge — avoiding duplicate instances on repeated PATCHes.

**UI affordances**
- `apps/web/components/task-card.tsx` — new `recurring` prop renders a small `Repeat` icon before the title.
- `apps/web/components/kanban-board.tsx` — passes `recurring={t.recurring}` to both the main TaskCard and the DragOverlay variant.

**Verified**
- `npx tsc --noEmit` clean in both `apps/api` and `apps/web`.

<!-- PATCH LOG END -->
