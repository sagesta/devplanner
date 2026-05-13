-- stress-test-fix: depth vs energy split (run via drizzle-kit push, or apply manually if you manage SQL)
CREATE TYPE "public"."work_depth" AS ENUM('shallow', 'normal', 'deep');
CREATE TYPE "public"."physical_energy" AS ENUM('low', 'medium', 'high');
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "work_depth" "work_depth";
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "physical_energy" "physical_energy";
UPDATE "tasks" SET "work_depth" = CASE "energy_level"
  WHEN 'deep_work' THEN 'deep'::work_depth
  WHEN 'shallow' THEN 'shallow'::work_depth
  ELSE 'normal'::work_depth
END WHERE "work_depth" IS NULL;
UPDATE "tasks" SET "physical_energy" = 'medium'::physical_energy WHERE "physical_energy" IS NULL;
