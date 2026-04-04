import { db } from "../db/client.js";
import { aiCallLog } from "../db/schema.js";

export async function logAiCall(input: {
  userId?: string | null;
  jobType: string;
  model: string;
  provider: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsdEstimate?: number | null;
  latencyMs: number;
}) {
  await db.insert(aiCallLog).values({
    userId: input.userId ?? null,
    jobType: input.jobType,
    model: input.model,
    provider: input.provider,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    costUsdEstimate: input.costUsdEstimate ?? null,
    latencyMs: input.latencyMs,
  });
}
