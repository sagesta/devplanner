import OpenAI from "openai";
import { logAiCall } from "./logCall.js";

const maxOut = 1500;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

const COST_PER_1M: Record<string, { input: number; output: number }> = {
  "gpt-5-nano": { input: 0.15, output: 0.60 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number | null {
  const rates = COST_PER_1M[model];
  if (!rates) return null;
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

async function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export async function openaiJsonCompletion(input: {
  userId?: string;
  jobType: string;
  model: string;
  system: string;
  user: string;
}): Promise<{ raw: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY not set");
  }
  const client = new OpenAI({ apiKey: key });

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const started = Date.now();
      const resp = await client.chat.completions.create({
        model: input.model,
        temperature: 0.2,
        max_tokens: maxOut,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      });
      const latencyMs = Date.now() - started;
      const text = resp.choices[0]?.message?.content ?? "";
      const usage = resp.usage;
      const inputTokens = usage?.prompt_tokens ?? 0;
      const outputTokens = usage?.completion_tokens ?? 0;
      await logAiCall({
        userId: input.userId,
        jobType: input.jobType,
        model: input.model,
        provider: "openai",
        inputTokens: inputTokens || null,
        outputTokens: outputTokens || null,
        costUsdEstimate: estimateCost(input.model, inputTokens, outputTokens),
        latencyMs,
      });
      return { raw: text };
    } catch (e: unknown) {
      lastError = e;
      const status = (e as { status?: number })?.status;
      // Only retry on transient errors
      if (status === 429 || status === 500 || status === 503) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(`[openai] Retry ${attempt + 1}/${MAX_RETRIES} after ${delay}ms (status ${status})`);
        await sleep(delay);
        continue;
      }
      throw e; // Non-transient errors fail immediately
    }
  }
  throw lastError;
}
