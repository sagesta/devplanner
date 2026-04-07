import { and, eq, isNull } from "drizzle-orm";
import { tasks } from "../db/schema.js";

type Db = typeof import("../db/client.js").db;

export async function rollupParentTaskStatus(db: Db, parentId: string): Promise<void> {
  const children = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.parentTaskId, parentId), isNull(tasks.deletedAt)));
  if (children.length === 0) {
    return;
  }
  const allDone = children.every((c) => c.status === "done");
  const anyInProgress = children.some((c) => c.status === "in_progress");
  let next: (typeof tasks.$inferSelect)["status"];
  if (allDone) {
    next = "done";
  } else if (anyInProgress) {
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
