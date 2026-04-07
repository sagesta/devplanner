CREATE TYPE "public"."caldav_action" AS ENUM('create', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."energy_level" AS ENUM('deep_work', 'shallow', 'admin', 'quick_win');--> statement-breakpoint
CREATE TYPE "public"."focus_session_type" AS ENUM('work', 'short_break', 'long_break');--> statement-breakpoint
CREATE TYPE "public"."focus_source" AS ENUM('manual', 'focus_import');--> statement-breakpoint
CREATE TYPE "public"."physical_energy" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."sprint_status" AS ENUM('planned', 'active', 'completed');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('urgent', 'high', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('backlog', 'todo', 'in_progress', 'done', 'cancelled', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('main', 'subtask');--> statement-breakpoint
CREATE TYPE "public"."work_depth" AS ENUM('shallow', 'normal', 'deep');--> statement-breakpoint
CREATE TABLE "ai_call_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"job_type" varchar(64) NOT NULL,
	"model" varchar(128) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd_estimate" real,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"suggestion_type" varchar(64) NOT NULL,
	"input_context" jsonb,
	"suggestion" text NOT NULL,
	"accepted" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"color" varchar(32),
	"icon" varchar(64),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"weekly_hour_target" numeric(5, 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caldav_sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid,
	"event_uid" varchar(512),
	"action" "caldav_action" NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "focus_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_minutes" integer NOT NULL,
	"session_type" "focus_session_type" DEFAULT 'work' NOT NULL,
	"source" "focus_source" DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_calendar_links" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"refresh_token" text NOT NULL,
	"calendar_id" varchar(512) DEFAULT 'primary' NOT NULL,
	"sync_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"status" varchar(32) DEFAULT 'active',
	"color" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"goal" text,
	"status" "sprint_status" DEFAULT 'planned' NOT NULL,
	"capacity_hours" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subtasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"scheduled_date" date,
	"scheduled_time" time,
	"estimated_minutes" integer,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"color" varchar(7) DEFAULT '#6B7280',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "task_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_tags" (
	"task_id" uuid NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "task_tags_task_id_tag_id_pk" PRIMARY KEY("task_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "task_time_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer GENERATED ALWAYS AS (EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER) STORED,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"sprint_id" uuid,
	"area_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"energy_level" "energy_level" DEFAULT 'shallow' NOT NULL,
	"work_depth" "work_depth",
	"physical_energy" "physical_energy",
	"task_type" "task_type" DEFAULT 'main' NOT NULL,
	"due_date" date,
	"recurrence_rule" text,
	"caldav_uid" uuid DEFAULT gen_random_uuid(),
	"ical_uid" varchar(512),
	"caldav_resource_filename" varchar(512),
	"caldav_remote_dtstamp" varchar(64),
	"caldav_last_pull_at" timestamp with time zone,
	"google_event_id" varchar(1024),
	"google_remote_updated" varchar(64),
	"google_last_pull_at" timestamp with time zone,
	"tags" text[],
	"sort_order" integer DEFAULT 0 NOT NULL,
	"idle_flagged" boolean DEFAULT false NOT NULL,
	"idle_flagged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" varchar(255),
	"password_hash" text,
	"work_hours_per_day" real DEFAULT 4 NOT NULL,
	"personal_hours_per_day" real DEFAULT 2 NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "ai_call_log" ADD CONSTRAINT "ai_call_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caldav_sync_log" ADD CONSTRAINT "caldav_sync_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caldav_sync_log" ADD CONSTRAINT "caldav_sync_log_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_calendar_links" ADD CONSTRAINT "google_calendar_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtasks" ADD CONSTRAINT "subtasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_embeddings" ADD CONSTRAINT "task_embeddings_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_time_logs" ADD CONSTRAINT "task_time_logs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_call_log_user_idx" ON "ai_call_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_suggestions_user_idx" ON "ai_suggestions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "areas_user_idx" ON "areas" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "caldav_sync_log_user_idx" ON "caldav_sync_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "focus_sessions_user_idx" ON "focus_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_user_idx" ON "projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_area_idx" ON "projects" USING btree ("area_id");--> statement-breakpoint
CREATE INDEX "sprints_user_idx" ON "sprints" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subtasks_task_idx" ON "subtasks" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "subtasks_scheduled_date_idx" ON "subtasks" USING btree ("scheduled_date");--> statement-breakpoint
CREATE UNIQUE INDEX "task_embeddings_task_uidx" ON "task_embeddings" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_time_logs_task_idx" ON "task_time_logs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_time_logs_active_idx" ON "task_time_logs" USING btree ("ended_at");--> statement-breakpoint
CREATE INDEX "tasks_user_idx" ON "tasks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tasks_sprint_idx" ON "tasks" USING btree ("sprint_id");--> statement-breakpoint
CREATE INDEX "tasks_area_idx" ON "tasks" USING btree ("area_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_user_ical_uid_uidx" ON "tasks" USING btree ("user_id","ical_uid");