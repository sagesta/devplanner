import { and, eq, isNull, ne } from "drizzle-orm";
import { tasks, users } from "../db/schema.js";

/** Calculate capacity in minutes for a given user. */
export async function calculateDailyCapacity(db: any, userId: string): Promise<number> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return 0;
  // capacity = dailyCapacityMinutes * efficiencyFactor * (1 - bufferFactor)
  const baseMinutes = user.dailyCapacityMinutes ?? 240;
  const eff = user.efficiencyFactor ?? 0.8;
  const buffer = user.bufferFactor ?? 0.2;
  return Math.floor(baseMinutes * eff * (1 - buffer));
}

function getPriorityScore(priority: string | null): number {
  if (priority === "urgent") return 4;
  if (priority === "high") return 3;
  if (priority === "normal") return 2;
  return 1;
}

export async function runAutoScheduler(db: any, userId: string, dateIso: string) {
  // Find all active tasks assigned to this date
  const todayTasks = await db.query.tasks.findMany({
    where: and(
      eq(tasks.userId, userId),
      isNull(tasks.deletedAt),
      eq(tasks.scheduledDate, dateIso),
      ne(tasks.status, "done")
    )
  });

  if (todayTasks.length === 0) return { displaced: 0, dailyCapacity: 0 };

  const dailyCapacity = await calculateDailyCapacity(db, userId);
  let usedMinutes = 0;

  // Sort tasks by priority descending (urgent first), then by status (in_progress first)
  const sorted = [...todayTasks].sort((a, b) => {
    if (a.status === "in_progress" && b.status !== "in_progress") return -1;
    if (b.status === "in_progress" && a.status !== "in_progress") return 1;
    
    const pA = getPriorityScore(a.priority);
    const pB = getPriorityScore(b.priority);
    return pB - pA;
  });

  const displacedTaskIds: string[] = [];
  const scheduledTaskIds: string[] = [];

  for (const t of sorted) {
    const mins = (t as any).estimatedMinutes || 30; // Default 30 min assumed
    if (usedMinutes + mins > dailyCapacity) {
      // Cannot fit this task, displacement begins
      if (t.status === "in_progress" || t.priority === "urgent") {
         // Anchor in-progress and urgent absolute Must-Do P0 tasks, force fit even over capacity!
         usedMinutes += mins;
         scheduledTaskIds.push(t.id);
      } else {
         displacedTaskIds.push(t.id);
      }
    } else {
      usedMinutes += mins;
      scheduledTaskIds.push(t.id);
    }
  }

  // Handle displaced tasks: move to tomorrow, increment rescheduleCount.
  // If rescheduleCount > 3, put in needs_rescheduling
  let overflowCount = 0;
  for (const id of displacedTaskIds) {
    const t = todayTasks.find((x: any) => x.id === id)!;
    const nextCount = (t.rescheduleCount || 0) + 1;
    
    const tomorrow = new Date(dateIso);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0]!;

    const state = nextCount > 3 ? "needs_rescheduling" : "overflow";

    await db.update(tasks)
      .set({
        scheduledDate: tomorrowStr,
        rescheduleCount: nextCount,
        schedulingState: state,
        isAutoScheduled: true,
      })
      .where(eq(tasks.id, id));
    
    overflowCount++;
  }

  return { dailyCapacity, scheduled: scheduledTaskIds, displaced: overflowCount, usedMinutes };
}
