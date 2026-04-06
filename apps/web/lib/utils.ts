import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** stress-test-fix: overdue when scheduled (or due-only anchor) is before today and task not terminal. */
export function isTaskOverdue(
  task: { scheduledDate: string | null; dueDate: string | null; status: string },
  todayYmd: string
): boolean {
  if (task.status === "done" || task.status === "cancelled") return false;
  const anchor = task.scheduledDate ?? task.dueDate;
  if (!anchor) return false;
  return anchor.localeCompare(todayYmd) < 0;
}

export function displayWorkDepth(task: {
  workDepth?: string | null;
  energyLevel: string;
}): string {
  if (task.workDepth) return task.workDepth;
  const m: Record<string, string> = {
    deep_work: "deep",
    shallow: "shallow",
    admin: "normal",
    quick_win: "normal",
  };
  return m[task.energyLevel] ?? "normal";
}

export function displayPhysicalEnergy(task: { physicalEnergy?: string | null }): string {
  return task.physicalEnergy ?? "medium";
}
