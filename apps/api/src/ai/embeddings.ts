/**
 * embeddings.ts — pgvector-backed semantic search for DevPlanner RAG.
 *
 * Two public exports:
 *   generateAndStoreEmbedding(taskId, text)   — upserts into taskEmbeddings
 *   retrieveRagContext(userId, queryText, limit) — cosine-similarity search
 */

import { sql } from "drizzle-orm";
import OpenAI from "openai";
import { db } from "../db/client.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Shared lazy client — only instantiated when OPENAI_API_KEY is set. */
function getClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

/**
 * Build the embedding text for a task  (title + description, capped).
 * Called externally so callers can pass the ready-made string.
 */
export function buildEmbeddingText(
  title: string,
  description?: string | null
): string {
  return `${title} ${description ?? ""}`.trim().slice(0, 8_000);
}

// ---------------------------------------------------------------------------
// 1. Generate + upsert embedding for a single task
// ---------------------------------------------------------------------------

/**
 * Generates an OpenAI embedding for the given `text` and upserts it into
 * the `task_embeddings` table.  Fire-and-forget — never throws.
 */
export async function generateAndStoreEmbedding(
  taskId: string,
  text: string
): Promise<void> {
  const client = getClient();
  if (!client || !text.trim()) return;

  const resp = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 8_000),
  });

  const vector = resp.data[0]?.embedding;
  if (!vector?.length) return;

  await db.execute(sql`
    INSERT INTO task_embeddings (task_id, embedding)
    VALUES (
      ${taskId}::uuid,
      ${JSON.stringify(vector)}::vector
    )
    ON CONFLICT (task_id) DO UPDATE
      SET embedding = EXCLUDED.embedding,
          created_at = now()
  `);
}

// ---------------------------------------------------------------------------
// 1b. Batch embedding (rate-limit safe)
// ---------------------------------------------------------------------------

type BatchTask = { id: string; title: string; description?: string | null };

/**
 * Embeds an array of tasks in batches of `batchSize` (default 20) with a
 * configurable inter-batch delay to stay within OpenAI rate limits.
 * Returns counts of successes and failures.
 */
export async function batchGenerateEmbeddings(
  tasks: BatchTask[],
  { batchSize = 20, delayMs = 500 }: { batchSize?: number; delayMs?: number } = {}
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;

  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (t) => {
        try {
          await generateAndStoreEmbedding(
            t.id,
            buildEmbeddingText(t.title, t.description)
          );
          ok++;
        } catch {
          failed++;
        }
      })
    );
    // Pause between batches (skip after last batch)
    if (i + batchSize < tasks.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return { ok, failed };
}

// ---------------------------------------------------------------------------
// 1c. Stale embedding cleanup (call when task is soft/hard deleted)
// ---------------------------------------------------------------------------

/**
 * Removes the embedding row for a given task ID.
 * Call after soft-delete or hard-delete so the vector index stays lean.
 */
export async function deleteStaleEmbedding(taskId: string): Promise<void> {
  try {
    await db.execute(sql`
      DELETE FROM task_embeddings WHERE task_id = ${taskId}::uuid
    `);
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// 2. Semantic retrieval for RAG context
// ---------------------------------------------------------------------------

export type RagTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  subtasks: Array<{ title: string; completed: boolean }>;
};

/**
 * Embeds `queryText`, then finds the top-`limit` semantically similar tasks
 * for `userId` using pgvector cosine distance (`<=>`).
 *
 * Returns an empty array (never throws) when:
 *   - OPENAI_API_KEY is missing
 *   - The task_embeddings table is empty
 *   - Any error occurs
 */
export async function retrieveRagContext(
  userId: string,
  queryText: string,
  limit = 8
): Promise<RagTask[]> {
  try {
    const client = getClient();
    if (!client || !queryText.trim()) return [];

    // 1. Embed the query
    const resp = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: queryText.slice(0, 8_000),
    });
    const queryVec = resp.data[0]?.embedding;
    if (!queryVec?.length) return [];

    // 2. Cosine similarity search via pgvector — join to tasks for ownership filter
    const rows = await db.execute<{
      task_id: string;
      title: string;
      status: string;
      priority: string;
      due_date: string | null;
      distance: number;
    }>(sql`
      SELECT
        t.id          AS task_id,
        t.title,
        t.status,
        t.priority,
        t.due_date,
        (te.embedding <=> ${JSON.stringify(queryVec)}::vector) AS distance
      FROM task_embeddings te
      JOIN tasks t ON t.id = te.task_id
      WHERE t.user_id = ${userId}::uuid
        AND t.deleted_at IS NULL
      ORDER BY te.embedding <=> ${JSON.stringify(queryVec)}::vector
      LIMIT ${limit}
    `);

    if (!rows.rows.length) return [];

    // 3. Load subtasks for all returned task IDs in one query (no N+1)
    const taskIds = rows.rows.map((r) => r.task_id);
    const allSubs = await db.query.subtasks.findMany({
      where: (s, { inArray }) => inArray(s.taskId, taskIds),
      orderBy: (s, { asc }) => [asc(s.createdAt)],
    });

    const subsByTask: Record<string, typeof allSubs> = {};
    for (const s of allSubs) {
      if (!subsByTask[s.taskId]) subsByTask[s.taskId] = [];
      subsByTask[s.taskId].push(s);
    }

    return rows.rows.map((r) => ({
      id: r.task_id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      dueDate: r.due_date ?? null,
      subtasks: (subsByTask[r.task_id] ?? []).map((s) => ({
        title: s.title,
        completed: s.completed,
      })),
    }));
  } catch {
    // Never crash the chat — RAG is best-effort
    return [];
  }
}

// ---------------------------------------------------------------------------
// 3. Format RAG results as a system prompt block
// ---------------------------------------------------------------------------

/**
 * Converts `RagTask[]` into a human-readable block for injection into the
 * system prompt.  Returns an empty string when list is empty.
 */
export function formatRagContext(ragTasks: RagTask[]): string {
  if (!ragTasks.length) return "";

  const lines = ragTasks.map((t, i) => {
    const subLines = t.subtasks
      .map((s) => `      ${s.completed ? "✓" : "○"} ${s.title}`)
      .join("\n");
    const subText = subLines ? `\n${subLines}` : " (no subtasks)";
    return (
      `  [${i + 1}] "${t.title}" — status: ${t.status}, ` +
      `priority: ${t.priority}` +
      (t.dueDate ? `, due: ${t.dueDate}` : "") +
      subText
    );
  });

  return (
    `\n\n═══ RAG CONTEXT — semantically similar tasks retrieved for this query ═══` +
    `\nThese are real tasks from the user's database. Use them as ground truth when relevant.` +
    `\nDo NOT invent tasks not present here or in the tool results.\n` +
    lines.join("\n")
  );
}
