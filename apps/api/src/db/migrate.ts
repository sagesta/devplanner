import type pg from "pg";

/**
 * Idempotent startup migration.
 *
 * All statements use IF NOT EXISTS / DO $$ … EXCEPTION … END $$ so it is safe
 * to run on every boot — including against a fresh database that already has
 * these columns, or against a database that is missing them.
 *
 * This covers the migration files that were created locally but never applied
 * to the production database via drizzle-kit:
 *   0001_work_depth_physical_energy.sql
 *   0002_tasks_deleted_at.sql
 *   0003_time_tracking_tags.sql
 *   0004_add_tasks_scheduled_date.sql
 *   + re-adds subtasks.scheduled_date / scheduled_time / estimated_minutes
 *     which 0001_add_subtasks_table.sql mistakenly dropped.
 */
export async function runMigrations(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── work_depth enum ────────────────────────────────────────────
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."work_depth" AS ENUM ('shallow', 'normal', 'deep');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // ── physical_energy enum ───────────────────────────────────────
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."physical_energy" AS ENUM ('low', 'medium', 'high');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // ── tasks: work_depth + physical_energy columns ────────────────
    await client.query(`
      ALTER TABLE "tasks"
        ADD COLUMN IF NOT EXISTS "work_depth"      "work_depth",
        ADD COLUMN IF NOT EXISTS "physical_energy" "physical_energy";
    `);

    await client.query(`
      UPDATE "tasks"
      SET "work_depth" = CASE "energy_level"
        WHEN 'deep_work' THEN 'deep'::work_depth
        WHEN 'shallow'   THEN 'shallow'::work_depth
        ELSE                  'normal'::work_depth
      END
      WHERE "work_depth" IS NULL;
    `);

    await client.query(`
      UPDATE "tasks"
      SET "physical_energy" = 'medium'::physical_energy
      WHERE "physical_energy" IS NULL;
    `);

    // ── tasks: deleted_at ──────────────────────────────────────────
    await client.query(`
      ALTER TABLE "tasks"
        ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;
    `);

    // ── tasks: scheduled_date ──────────────────────────────────────
    await client.query(`
      ALTER TABLE "tasks"
        ADD COLUMN IF NOT EXISTS "scheduled_date" DATE;
    `);

    // ── time tracking table ────────────────────────────────────────
    await client.query(`
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
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS task_time_logs_task_idx
        ON task_time_logs (task_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS task_time_logs_active_idx
        ON task_time_logs (ended_at) WHERE ended_at IS NULL;
    `);

    // ── global tags tables ─────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS tags (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(50) UNIQUE NOT NULL,
        color      VARCHAR(7) DEFAULT '#6B7280',
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS task_tags (
        task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
        tag_id  INT  REFERENCES tags(id)  ON DELETE CASCADE,
        PRIMARY KEY (task_id, tag_id)
      );
    `);

    // ── areas: weekly_hour_target ──────────────────────────────────
    await client.query(`
      ALTER TABLE "areas"
        ADD COLUMN IF NOT EXISTS "weekly_hour_target" NUMERIC(5,1) DEFAULT NULL;
    `);

    // ── subtasks: restore scheduling columns that were dropped ─────
    await client.query(`
      ALTER TABLE "subtasks"
        ADD COLUMN IF NOT EXISTS "scheduled_date"    DATE,
        ADD COLUMN IF NOT EXISTS "scheduled_time"    VARCHAR(32),
        ADD COLUMN IF NOT EXISTS "estimated_minutes" INTEGER;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS subtasks_task_idx ON subtasks (task_id);
    `);

    await client.query("COMMIT");
    console.log("[migrate] Schema up-to-date ✓");
  } catch (err) {
    await client.query("ROLLBACK");
    // Log but don't crash — a partial schema is better than no server.
    console.error("[migrate] Migration failed, rolled back:", err);
    throw err;
  } finally {
    client.release();
  }
}
