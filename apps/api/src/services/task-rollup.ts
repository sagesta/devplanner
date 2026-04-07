import { eq } from "drizzle-orm";
import { tasks, subtasks } from "../db/schema.js";

type Db = typeof import("../db/client.js").db;

export async function rollupParentTaskStatus(db: Db, parentId: string): Promise<void> {
  const children = await db
    .select()
    .from(subtasks)
    .where(eq(subtasks.taskId, parentId));
    
  if (children.length === 0) {
    // Note: if a task has NO subtasks, the prompt implies "status is managed manually".
    // Therefore, if there are no subtasks, we do not auto-derive or reset the status!
    return;
  }
  const allDone = children.every((c) => c.completed);
  const anyDone = children.some((c) => c.completed);
  let next: (typeof tasks.$inferSelect)["status"];
  
  if (allDone) {
    next = "done";
  } else if (anyDone) {
    next = "in_progress";
  } else {
    next = "todo";
  }
  
  await db
    .update(tasks)
    .set({
      status: next,
      updatedAt: new Date(),
      completedAt: next === "done" ? new Date() : null,
    })
    .where(eq(tasks.id, parentId));
}
