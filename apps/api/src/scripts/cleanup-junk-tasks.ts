import { ilike, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { tasks } from "../db/schema.js";

async function main() {
  console.log("Cleaning up AI generated junk tasks...");
  
  const junkPatterns = [
    "Task title:%",
    "Sprint:%",
    "Status:%",
    "Priority:%",
    "Difficulty:%",
    "Effort:%",
    "Due date:%",
    "Subtasks:%",
    "Recurrence:%"
  ];

  const whereClause = or(...junkPatterns.map(p => ilike(tasks.title, p)));

  const result = await db.delete(tasks).where(whereClause).returning({ id: tasks.id, title: tasks.title });

  console.log(`Deleted ${result.length} junk tasks.`);
  for (const r of result) {
    console.log(` - ${r.title}`);
  }

  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
