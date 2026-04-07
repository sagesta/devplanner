import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Overdue = scheduled or due date is before today and task is not finished. */
export function isTaskOverdue(
  task: { scheduledDate: string | null; dueDate: string | null; status: string },
  todayYmd: string
): boolean {
  if (task.status === "done" || task.status === "cancelled") return false;
  const sched = task.scheduledDate?.trim();
  const due = task.dueDate?.trim();
  if (sched && sched.localeCompare(todayYmd) < 0) return true;
  if (due && due.localeCompare(todayYmd) < 0) return true;
  return false;
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
