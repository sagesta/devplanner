-- ============================================================
-- DevPlanner: Comprehensive Idempotent Schema Fix
-- Safe to run multiple times (all ops use IF NOT EXISTS).
-- Covers migrations 0001_work_depth..0004 that were never
-- recorded in the Drizzle journal for production.
-- ============================================================

-- ── Migration 0001: work_depth & physical_energy enums ──────

DO $$ BEGIN
  CREATE TYPE "public"."work_depth" AS ENUM ('shallow', 'normal', 'deep');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."physical_energy" AS ENUM ('low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "work_depth" "work_depth";
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "physical_energy" "physical_energy";

UPDATE "tasks" SET "work_depth" = CASE "energy_level"
  WHEN 'deep_work' THEN 'deep'::work_depth
  WHEN 'shallow'   THEN 'shallow'::work_depth
  ELSE 'normal'::work_depth
END WHERE "work_depth" IS NULL;

UPDATE "tasks" SET "physical_energy" = 'medium'::physical_energy
WHERE "physical_energy" IS NULL;

-- ── Migration 0002: tasks.deleted_at ────────────────────────

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;

-- ── Migration 0003: time tracking + global tags ──────────────

CREATE TABLE IF NOT EXISTS task_time_logs (
  id               SERIAL PRIMARY KEY,
  task_id          UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  started_at       TIMESTAMPTZ NOT NULL,
  ended_at         TIMESTAMPTZ,
  duration_seconds INTEGER GENERATED ALWAYS AS (
                     EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER
                   ) STORED,
  note             TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_time_logs_task_idx   ON task_time_logs (task_id);
CREATE INDEX IF NOT EXISTS task_time_logs_active_idx ON task_time_logs (ended_at) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS tags (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(50) UNIQUE NOT NULL,
  color      VARCHAR(7) DEFAULT '#6B7280',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  INT  REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

ALTER TABLE areas ADD COLUMN IF NOT EXISTS weekly_hour_target NUMERIC(5,1) DEFAULT NULL;

-- ── Migration 0004: tasks.scheduled_date ────────────────────

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "scheduled_date" DATE;

-- ── Re-add subtask scheduling columns ───────────────────────
-- Migration 0001_add_subtasks_table mistakenly DROPPED these.
-- Re-add them so patchSubtask(id, {scheduledDate}) works.

ALTER TABLE "subtasks" ADD COLUMN IF NOT EXISTS "scheduled_date" DATE;
ALTER TABLE "subtasks" ADD COLUMN IF NOT EXISTS "scheduled_time" VARCHAR(32);
ALTER TABLE "subtasks" ADD COLUMN IF NOT EXISTS "estimated_minutes" INTEGER;

CREATE INDEX IF NOT EXISTS subtasks_task_idx ON subtasks (task_id);

-- ── Verify (informational) ───────────────────────────────────
SELECT
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name IN ('tasks', 'subtasks')
  AND column_name IN (
    'scheduled_date', 'scheduled_time', 'estimated_minutes',
    'work_depth', 'physical_energy', 'deleted_at'
  )
ORDER BY table_name, column_name;
