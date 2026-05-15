-- Add scheduling_state enum and scheduling columns to tasks
CREATE TYPE "public"."scheduling_state" AS ENUM(
  'unscheduled', 'suggested', 'scheduled', 'overflow', 'needs_rescheduling'
);

ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "scheduling_state" "scheduling_state" NOT NULL DEFAULT 'unscheduled',
  ADD COLUMN IF NOT EXISTS "reschedule_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "is_auto_scheduled" boolean NOT NULL DEFAULT false;

-- Add capacity/efficiency columns to users
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "efficiency_factor" real NOT NULL DEFAULT 0.8,
  ADD COLUMN IF NOT EXISTS "buffer_factor" real NOT NULL DEFAULT 0.2,
  ADD COLUMN IF NOT EXISTS "daily_capacity_minutes" integer NOT NULL DEFAULT 240,
  ADD COLUMN IF NOT EXISTS "cognitive_load_baseline" real NOT NULL DEFAULT 50.0;
