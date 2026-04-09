DROP INDEX "subtasks_scheduled_date_idx";--> statement-breakpoint
ALTER TABLE "subtasks" DROP COLUMN "scheduled_date";--> statement-breakpoint
ALTER TABLE "subtasks" DROP COLUMN "scheduled_time";