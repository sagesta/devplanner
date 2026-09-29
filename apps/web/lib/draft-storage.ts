import type { ParsedDumpItem, WeeklyReviewInput } from "./api";

export type ReviewDraftEnvelope = {
  version: 3;
  userId: string;
  weekStart: string;
  input: WeeklyReviewInput;
  step: number;
  editSequence: number;
  acknowledgedSequence: number;
  serverRevision: number;
};

export type CaptureDraftEnvelope = {
  version: 1;
  userId: string;
  text: string;
  areaId: string;
  scheduledDate: string;
  startT: string;
  endT: string;
  recurrence: string;
  parsedItems: ParsedDumpItem[];
  view: "raw" | "preview";
  idempotencyKey: string;
  requestSignature: string;
};

export const reviewDraftKey = (userId: string, weekStart: string) =>
  `devplanner.weeklyReview.v3.${encodeURIComponent(userId)}.${weekStart}`;
export const captureDraftKey = (userId: string) =>
  `devplanner.capture.v1.${encodeURIComponent(userId)}`;

export function parseReviewDraft(
  raw: string | null,
  userId: string,
  weekStart: string,
): ReviewDraftEnvelope | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as ReviewDraftEnvelope;
    if (
      value.version !== 3 ||
      value.userId !== userId ||
      value.weekStart !== weekStart ||
      value.input?.weekStart !== weekStart ||
      !Number.isInteger(value.editSequence) ||
      !Number.isInteger(value.acknowledgedSequence) ||
      !Number.isInteger(value.serverRevision) ||
      value.editSequence < 0 ||
      value.acknowledgedSequence < 0 ||
      value.acknowledgedSequence > value.editSequence ||
      value.serverRevision < 0 ||
      typeof value.input.wins !== "string" ||
      typeof value.input.carryover !== "string" ||
      typeof value.input.sprintNotes !== "string" ||
      typeof value.input.weekEnd !== "string" ||
      !Array.isArray(value.input.intentions) ||
      value.input.intentions.some(
        (item) => !item || typeof item.text !== "string",
      )
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

export function parseCaptureDraft(
  raw: string | null,
  userId: string,
): CaptureDraftEnvelope | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as CaptureDraftEnvelope;
    if (
      value.version !== 1 ||
      value.userId !== userId ||
      typeof value.text !== "string" ||
      !Array.isArray(value.parsedItems) ||
      typeof value.idempotencyKey !== "string" ||
      typeof value.requestSignature !== "string" ||
      value.parsedItems.some(
        (item) =>
          !item ||
          typeof item.title !== "string" ||
          typeof item.bucket !== "string" ||
          typeof item.priority !== "string" ||
          typeof item.energy !== "string" ||
          typeof item.estimated_minutes !== "number",
      )
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

export function hasUnacknowledgedReviewEdits(draft: ReviewDraftEnvelope) {
  return draft.editSequence > draft.acknowledgedSequence;
}

export function newDraftIdempotencyKey() {
  return crypto.randomUUID();
}
