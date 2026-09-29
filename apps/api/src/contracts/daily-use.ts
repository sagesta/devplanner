/** Version 1 daily-use contracts. Dates are calendar dates in the user's timezone. */
export type ExecutionTarget = {
  targetType: "task" | "subtask";
  targetId: string;
  expectedRevision: number;
};
export type CaptureItem = {
  title: string;
  areaId?: string;
  scheduledDate?: string | null;
  priority?: string;
  energyLevel?: string;
  estimatedMinutes?: number | null;
  recurrenceRule?: string | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
};
export type CaptureRequest = { items: CaptureItem[]; idempotencyKey: string };
export type CaptureResult = {
  tasks: Array<{ id: string; revision: number; areaId: string }>;
  created: number;
};
export type MoveRequest = {
  targets: ExecutionTarget[];
  scheduledDate: string;
  idempotencyKey: string;
};
export type FocusSelection = {
  date: string;
  targetType: "task" | "subtask";
  targetId: string;
};
export type ApplyPreviewRequest = {
  previewId: string;
  selectedIds: string[];
  idempotencyKey: string;
};
export const DAILY_API = {
  capture: "/api/daily/capture",
  move: "/api/daily/move",
  focus: "/api/daily/focus",
} as const;
/** Deterministic fake used by consumers before the persistence implementation lands. */
export function fakeCaptureResult(request: CaptureRequest): CaptureResult {
  return {
    created: request.items.length,
    tasks: request.items.map((item, index) => ({
      id: `fake-${index}`,
      revision: 1,
      areaId: item.areaId ?? "fake-general",
    })),
  };
}
export type FocusResult = { focus: FocusSelection | null };
export type MoveResult = { updated: number; targets: ExecutionTarget[] };
