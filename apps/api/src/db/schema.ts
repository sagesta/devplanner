import {
  AnyPgColumn,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

const vector1536 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
});

export const taskStatusEnum = pgEnum("task_status", [
  "backlog",
  "todo",
  "in_progress",
  "done",
  "cancelled",
  "blocked",
]);

export const taskPriorityEnum = pgEnum("task_priority", ["urgent", "high", "normal", "low"]);

export const energyLevelEnum = pgEnum("energy_level", ["deep_work", "shallow", "admin", "quick_win"]);

/** Cognitive load / focus depth (separate from physical energy). */
export const workDepthEnum = pgEnum("work_depth", ["shallow", "normal", "deep"]);

/** Physical energy available for the task (separate from work depth). */
export const physicalEnergyEnum = pgEnum("physical_energy", ["low", "medium", "high"]);

export const taskTypeEnum = pgEnum("task_type", ["main", "subtask"]);

export const sprintStatusEnum = pgEnum("sprint_status", ["planned", "active", "completed"]);

export const focusSessionTypeEnum = pgEnum("focus_session_type", ["work", "short_break", "long_break"]);

export const focusSourceEnum = pgEnum("focus_source", ["manual", "focus_import"]);

export const caldavActionEnum = pgEnum("caldav_action", ["create", "update", "delete"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  passwordHash: text("password_hash"),
  workHoursPerDay: real("work_hours_per_day").notNull().default(4),
  personalHoursPerDay: real("personal_hours_per_day").notNull().default(2),
  timezone: varchar("timezone", { length: 64 }).default("UTC"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const areas = pgTable(
  "areas",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    color: varchar("color", { length: 32 }),
    icon: varchar("icon", { length: 64 }),
    sortOrder: integer("sort_order").notNull().default(0),
    weeklyHourTarget: numeric("weekly_hour_target", { precision: 5, scale: 1 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("areas_user_idx").on(t.userId)]
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    areaId: uuid("area_id")
      .notNull()
      .references(() => areas.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 32 }).default("active"),
    color: varchar("color", { length: 32 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("projects_user_idx").on(t.userId), index("projects_area_idx").on(t.areaId)]
);

export const sprints = pgTable(
  "sprints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    goal: text("goal"),
    status: sprintStatusEnum("status").notNull().default("planned"),
    capacityHours: real("capacity_hours"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("sprints_user_idx").on(t.userId)]
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    sprintId: uuid("sprint_id").references(() => sprints.id, { onDelete: "set null" }),
    areaId: uuid("area_id")
      .notNull()
      .references(() => areas.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    status: taskStatusEnum("status").notNull().default("todo"),
    priority: taskPriorityEnum("priority").notNull().default("normal"),
    energyLevel: energyLevelEnum("energy_level").notNull().default("shallow"),
    workDepth: workDepthEnum("work_depth"),
    physicalEnergy: physicalEnergyEnum("physical_energy"),
    taskType: taskTypeEnum("task_type").notNull().default("main"),
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id, { onDelete: "cascade" }),
    estimatedMinutes: integer("estimated_minutes"),
    actualMinutes: integer("actual_minutes"),
    scheduledDate: date("scheduled_date"),
    scheduledStartTime: time("scheduled_start_time"),
    scheduledEndTime: time("scheduled_end_time"),
    dueDate: date("due_date"),
    recurrenceRule: text("recurrence_rule"),
    caldavUid: uuid("caldav_uid").defaultRandom(),
    /** RFC5545 UID from the calendar (imports + stable identity for round-trip). */
    icalUid: varchar("ical_uid", { length: 512 }),
    /** Filename within the CalDAV collection, e.g. `abc.ics` (defaults to `{caldavUid}.ics`). */
    caldavResourceFilename: varchar("caldav_resource_filename", { length: 512 }),
    /** Last DTSTAMP seen from the server (pull merge / conflict hint). */
    caldavRemoteDtstamp: varchar("caldav_remote_dtstamp", { length: 64 }),
    caldavLastPullAt: timestamp("caldav_last_pull_at", { withTimezone: true }),
    /** Google Calendar API event id (opaque); set after first push or pull. */
    googleEventId: varchar("google_event_id", { length: 1024 }),
    /** Last `updated` field from Google (RFC3339) for merge / skip logic. */
    googleRemoteUpdated: varchar("google_remote_updated", { length: 64 }),
    googleLastPullAt: timestamp("google_last_pull_at", { withTimezone: true }),
    tags: text("tags").array(),
    sortOrder: integer("sort_order").notNull().default(0),
    idleFlagged: boolean("idle_flagged").notNull().default(false),
    idleFlaggedAt: timestamp("idle_flagged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Soft-delete: null = active; set when user deletes (restorable within client grace period). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("tasks_user_idx").on(t.userId),
    index("tasks_sprint_idx").on(t.sprintId),
    index("tasks_area_idx").on(t.areaId),
    index("tasks_parent_idx").on(t.parentTaskId),
    index("tasks_scheduled_date_idx").on(t.scheduledDate),
    uniqueIndex("tasks_user_ical_uid_uidx").on(t.userId, t.icalUid),
  ]
);

export const focusSessions = pgTable(
  "focus_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationMinutes: integer("duration_minutes").notNull(),
    sessionType: focusSessionTypeEnum("session_type").notNull().default("work"),
    source: focusSourceEnum("source").notNull().default("manual"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("focus_sessions_user_idx").on(t.userId)]
);

export const aiCallLog = pgTable(
  "ai_call_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    jobType: varchar("job_type", { length: 64 }).notNull(),
    model: varchar("model", { length: 128 }).notNull(),
    provider: varchar("provider", { length: 32 }).notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsdEstimate: real("cost_usd_estimate"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("ai_call_log_user_idx").on(t.userId)]
);

export const aiSuggestions = pgTable(
  "ai_suggestions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    suggestionType: varchar("suggestion_type", { length: 64 }).notNull(),
    inputContext: jsonb("input_context"),
    suggestion: text("suggestion").notNull(),
    accepted: boolean("accepted"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("ai_suggestions_user_idx").on(t.userId)]
);

/** Per-user Google OAuth link (primary calendar by default). */
export const googleCalendarLinks = pgTable(
  "google_calendar_links",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    refreshToken: text("refresh_token").notNull(),
    /** Google calendar id, e.g. `primary` or an email. */
    calendarId: varchar("calendar_id", { length: 512 }).notNull().default("primary"),
    /** Incremental sync token from Calendar API `events.list`. */
    syncToken: text("sync_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  }
);

export const caldavSyncLog = pgTable(
  "caldav_sync_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    eventUid: varchar("event_uid", { length: 512 }),
    action: caldavActionEnum("action").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
    error: text("error"),
  },
  (t) => [index("caldav_sync_log_user_idx").on(t.userId)]
);

export const taskEmbeddings = pgTable(
  "task_embeddings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    embedding: vector1536("embedding").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("task_embeddings_task_uidx").on(t.taskId)]
);

// ─── Time tracking ──────────────────────────────────────────────
export const taskTimeLogs = pgTable(
  "task_time_logs",
  {
    id: serial("id").primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds").generatedAlwaysAs(
      sql`EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER`
    ),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("task_time_logs_task_idx").on(t.taskId),
    index("task_time_logs_active_idx").on(t.endedAt),
  ]
);

// ─── Global tags ────────────────────────────────────────────────
export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 50 }).notNull().unique(),
  color: varchar("color", { length: 7 }).default("#6B7280"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const taskTags = pgTable(
  "task_tags",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.tagId] })]
);

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  parent: one(tasks, {
    fields: [tasks.parentTaskId],
    references: [tasks.id],
    relationName: "taskHierarchy",
  }),
  subtasks: many(tasks, { relationName: "taskHierarchy" }),
  area: one(areas, { fields: [tasks.areaId], references: [areas.id] }),
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  sprint: one(sprints, { fields: [tasks.sprintId], references: [sprints.id] }),
  user: one(users, { fields: [tasks.userId], references: [users.id] }),
  timeLogs: many(taskTimeLogs),
  taskTags: many(taskTags),
}));

export const areasRelations = relations(areas, ({ one, many }) => ({
  user: one(users, { fields: [areas.userId], references: [users.id] }),
  tasks: many(tasks),
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  area: one(areas, { fields: [projects.areaId], references: [areas.id] }),
  tasks: many(tasks),
}));

export const sprintsRelations = relations(sprints, ({ one, many }) => ({
  user: one(users, { fields: [sprints.userId], references: [users.id] }),
  tasks: many(tasks),
}));

export const googleCalendarLinksRelations = relations(googleCalendarLinks, ({ one }) => ({
  user: one(users, { fields: [googleCalendarLinks.userId], references: [users.id] }),
}));

export const usersRelations = relations(users, ({ many, one }) => ({
  areas: many(areas),
  projects: many(projects),
  sprints: many(sprints),
  tasks: many(tasks),
  googleCalendarLink: one(googleCalendarLinks, {
    fields: [users.id],
    references: [googleCalendarLinks.userId],
  }),
}));

export const taskTimeLogsRelations = relations(taskTimeLogs, ({ one }) => ({
  task: one(tasks, { fields: [taskTimeLogs.taskId], references: [tasks.id] }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  taskTags: many(taskTags),
}));

export const taskTagsRelations = relations(taskTags, ({ one }) => ({
  task: one(tasks, { fields: [taskTags.taskId], references: [tasks.id] }),
  tag: one(tags, { fields: [taskTags.tagId], references: [tags.id] }),
}));
