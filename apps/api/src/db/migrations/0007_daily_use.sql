-- Repair additive prerequisites omitted from the legacy migration journal.

      DO $$ BEGIN
        CREATE TYPE "public"."work_depth" AS ENUM ('shallow', 'normal', 'deep');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    

      DO $$ BEGIN
        CREATE TYPE "public"."physical_energy" AS ENUM ('low', 'medium', 'high');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    

      ALTER TABLE "tasks"
        ADD COLUMN IF NOT EXISTS "work_depth"      "work_depth",
        ADD COLUMN IF NOT EXISTS "physical_energy" "physical_energy";
    

      UPDATE "tasks"
      SET "work_depth" = CASE "energy_level"
        WHEN 'deep_work' THEN 'deep'::work_depth
        WHEN 'shallow'   THEN 'shallow'::work_depth
        ELSE                  'normal'::work_depth
      END
      WHERE "work_depth" IS NULL;
    

      UPDATE "tasks"
      SET "physical_energy" = 'medium'::physical_energy
      WHERE "physical_energy" IS NULL;
    

      ALTER TABLE "tasks"
        ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;
    

      ALTER TABLE "tasks"
        ADD COLUMN IF NOT EXISTS "scheduled_date" DATE;
    

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
    

      CREATE INDEX IF NOT EXISTS task_time_logs_task_idx
        ON task_time_logs (task_id);
    

      CREATE INDEX IF NOT EXISTS task_time_logs_active_idx
        ON task_time_logs (ended_at) WHERE ended_at IS NULL;
    

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
    

      ALTER TABLE "areas"
        ADD COLUMN IF NOT EXISTS "weekly_hour_target" NUMERIC(5,1) DEFAULT NULL;
    

      ALTER TABLE "subtasks"
        ADD COLUMN IF NOT EXISTS "scheduled_date"    DATE,
        ADD COLUMN IF NOT EXISTS "scheduled_time"    VARCHAR(32),
        ADD COLUMN IF NOT EXISTS "estimated_minutes" INTEGER;
    

      CREATE INDEX IF NOT EXISTS subtasks_task_idx ON subtasks (task_id);
    

      DO $$ BEGIN
        CREATE TYPE "public"."scheduling_state" AS ENUM (
          'unscheduled', 'suggested', 'scheduled', 'overflow', 'needs_rescheduling'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    

      ALTER TABLE "tasks"
        ADD COLUMN IF NOT EXISTS "scheduling_state"  "scheduling_state" NOT NULL DEFAULT 'unscheduled',
        ADD COLUMN IF NOT EXISTS "reschedule_count"  INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "is_auto_scheduled" BOOLEAN NOT NULL DEFAULT false;
    

      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "efficiency_factor"      REAL NOT NULL DEFAULT 0.8,
        ADD COLUMN IF NOT EXISTS "buffer_factor"          REAL NOT NULL DEFAULT 0.2,
        ADD COLUMN IF NOT EXISTS "daily_capacity_minutes" INTEGER NOT NULL DEFAULT 240,
        ADD COLUMN IF NOT EXISTS "cognitive_load_baseline" REAL NOT NULL DEFAULT 50.0;
    

      UPDATE "tasks"
      SET "status" = 'todo'
      WHERE "status" = 'backlog'
        AND "sprint_id" IS NOT NULL
        AND "deleted_at" IS NULL;
    

      UPDATE "tasks" t
      SET "due_date" = s."end_date"
      FROM "sprints" s
      WHERE t."sprint_id" = s."id"
        AND t."due_date" IS NULL
        AND t."deleted_at" IS NULL;
    

      DO $$ BEGIN
        CREATE TYPE "public"."priority_period" AS ENUM ('week', 'month');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    

      DO $$ BEGIN
        CREATE TYPE "public"."priority_category" AS ENUM ('work', 'personal', 'growth');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    

      CREATE TABLE IF NOT EXISTS priorities (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        period_type  priority_period NOT NULL,
        period_start DATE NOT NULL,
        category     priority_category NOT NULL,
        statement    TEXT NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    

      CREATE UNIQUE INDEX IF NOT EXISTS priorities_unique_slot
        ON priorities (user_id, period_type, period_start, category);
    

      CREATE INDEX IF NOT EXISTS priorities_user_period_idx
        ON priorities (user_id, period_type, period_start);
    

      UPDATE "areas"
      SET "name" = 'Professional'
      WHERE lower(trim("name")) = 'growth';
    

      CREATE TABLE IF NOT EXISTS goal_horizons (
        user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        owner_name VARCHAR(255),
        goals      JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    

      CREATE TABLE IF NOT EXISTS accomplishments (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id    UUID REFERENCES tasks(id) ON DELETE SET NULL,
        date       DATE NOT NULL,
        title      VARCHAR(500) NOT NULL,
        impact     TEXT,
        metric     VARCHAR(500),
        skills     TEXT[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    

      CREATE INDEX IF NOT EXISTS accomplishments_user_idx
        ON accomplishments (user_id);
    

      CREATE INDEX IF NOT EXISTS accomplishments_user_date_idx
        ON accomplishments (user_id, date);
    

      CREATE TABLE IF NOT EXISTS weekly_reviews (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        week_start   DATE NOT NULL,
        week_end     DATE NOT NULL,
        wins         TEXT NOT NULL DEFAULT '',
        carryover    TEXT NOT NULL DEFAULT '',
        intentions   JSONB NOT NULL DEFAULT '[]'::jsonb,
        sprint_notes TEXT NOT NULL DEFAULT '',
        sprint_id    UUID REFERENCES sprints(id) ON DELETE SET NULL,
        status       VARCHAR(16) NOT NULL DEFAULT 'draft',
        completed_at TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    

      CREATE UNIQUE INDEX IF NOT EXISTS weekly_reviews_user_week_uidx
        ON weekly_reviews (user_id, week_start);
    

      CREATE INDEX IF NOT EXISTS weekly_reviews_user_week_idx
        ON weekly_reviews (user_id, week_start);
    
ALTER TABLE areas ADD COLUMN IF NOT EXISTS system_key varchar(32);
CREATE UNIQUE INDEX IF NOT EXISTS areas_system_key_uidx ON areas(user_id,system_key) WHERE system_key IS NOT NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE weekly_reviews ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS oauth_attempts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,state_hash text NOT NULL UNIQUE,expires_at timestamptz NOT NULL,consumed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS mutation_receipts(user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,operation text NOT NULL,key text NOT NULL,request_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,operation,key));
CREATE TABLE IF NOT EXISTS daily_focus(user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,date date NOT NULL,target_type text NOT NULL CHECK(target_type IN ('task','subtask')),target_id uuid NOT NULL,PRIMARY KEY(user_id,date));
CREATE TABLE IF NOT EXISTS schedule_previews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,proposals jsonb NOT NULL,context jsonb NOT NULL,expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS calendar_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),delivered_at timestamptz);
CREATE INDEX IF NOT EXISTS calendar_outbox_pending_idx ON calendar_outbox(created_at) WHERE delivered_at IS NULL;
CREATE OR REPLACE FUNCTION bump_execution_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.revision=OLD.revision+1; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS tasks_revision ON tasks;
CREATE TRIGGER tasks_revision BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION bump_execution_revision();
DROP TRIGGER IF EXISTS subtasks_revision ON subtasks;
CREATE TRIGGER subtasks_revision BEFORE UPDATE ON subtasks FOR EACH ROW EXECUTE FUNCTION bump_execution_revision();
CREATE OR REPLACE FUNCTION task_calendar_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rowdata tasks; action text;
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND (NEW.title,NEW.description,NEW.status,NEW.priority,NEW.scheduled_date,NEW.due_date,NEW.recurrence_rule,NEW.deleted_at) IS NOT DISTINCT FROM (OLD.title,OLD.description,OLD.status,OLD.priority,OLD.scheduled_date,OLD.due_date,OLD.recurrence_rule,OLD.deleted_at) THEN RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN rowdata=OLD; action='delete'; ELSE rowdata=NEW; action=CASE WHEN NEW.deleted_at IS NOT NULL THEN 'delete' WHEN TG_OP='INSERT' THEN 'create' ELSE 'update' END; END IF;
 INSERT INTO calendar_outbox(user_id,payload) VALUES(rowdata.user_id,jsonb_build_object('userId',rowdata.user_id,'taskId',rowdata.id,'caldavUid',rowdata.caldav_uid,'resourceFilename',rowdata.caldav_resource_filename,'googleEventId',rowdata.google_event_id,'action',action));
 RETURN COALESCE(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS tasks_calendar_outbox ON tasks;
CREATE TRIGGER tasks_calendar_outbox AFTER INSERT OR UPDATE OR DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION task_calendar_outbox();
