import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../db/client.js";
import type {
  CaptureRequest,
  CaptureResult,
  MoveResult,
  FocusResult,
  ExecutionTarget,
  FocusSelection,
  MoveRequest,
} from "../contracts/daily-use.js";
export class DailyConflict extends Error {}
export function requestHash(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export async function transaction<T>(
  fn: (c: PoolClient) => Promise<T>,
  isolation: "read committed" | "serializable" = "read committed",
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query(
      isolation === "serializable"
        ? "BEGIN ISOLATION LEVEL SERIALIZABLE"
        : "BEGIN",
    );
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function receipt<T>(
  userId: string,
  operation: string,
  key: string,
  payload: unknown,
  fn: (c: PoolClient) => Promise<T>,
  isolation: "read committed" | "serializable" = "read committed",
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await transaction(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `${userId}:${operation}:${key}`,
        ]);
        const hash = requestHash(payload);
        const prior = await c.query(
          "SELECT * FROM mutation_receipts WHERE user_id=$1 AND operation=$2 AND key=$3",
          [userId, operation, key],
        );
        if (prior.rows[0]) {
          if (prior.rows[0].request_hash !== hash)
            throw new DailyConflict(
              "This retry key belongs to different changes.",
            );
          return prior.rows[0].result;
        }
        const result = await fn(c);
        await c.query(
          "INSERT INTO mutation_receipts(user_id,operation,key,request_hash,result) VALUES($1,$2,$3,$4,$5)",
          [userId, operation, key, hash, JSON.stringify(result)],
        );
        return result;
      }, isolation);
    } catch (e) {
      if (
        attempt < 2 &&
        ["40001", "40P01"].includes((e as { code?: string }).code ?? "")
      )
        continue;
      throw e;
    }
  }
}
type CaptureItem = CaptureRequest["items"][number];
async function resolveCaptureArea(
  c: PoolClient,
  userId: string,
  requested?: string,
) {
  let areaId = requested;
  if (!areaId) {
    const existing = await c.query(
      "SELECT id FROM areas WHERE user_id=$1 AND system_key='general'",
      [userId],
    );
    areaId = existing.rows[0]?.id;
    if (!areaId) {
      const area = await c.query(
        "INSERT INTO areas(user_id,name,system_key) VALUES($1,'General','general') ON CONFLICT(user_id,system_key) WHERE system_key IS NOT NULL DO UPDATE SET system_key=EXCLUDED.system_key RETURNING id",
        [userId],
      );
      areaId = area.rows[0].id;
    }
  }
  const owned = await c.query(
    "SELECT id FROM areas WHERE id=$1 AND user_id=$2 FOR SHARE",
    [areaId, userId],
  );
  if (!owned.rowCount) throw new DailyConflict("Area is unavailable.");
  return areaId;
}
function captureTaskValues(
  userId: string,
  areaId: string | undefined,
  item: CaptureItem,
) {
  return [
    userId,
    areaId,
    item.title,
    item.scheduledDate ? "todo" : "backlog",
    item.scheduledDate ?? null,
    item.scheduledDate ? "scheduled" : "unscheduled",
    item.priority ?? "normal",
    item.energyLevel ?? "shallow",
    item.recurrenceRule ?? null,
  ];
}
function captureDuration(item: CaptureItem) {
  if (item.estimatedMinutes != null) return item.estimatedMinutes;
  if (!item.scheduledStartTime || !item.scheduledEndTime) return null;
  const minutes = (time: string) =>
    Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return minutes(item.scheduledEndTime) - minutes(item.scheduledStartTime);
}
async function captureExecutionUnit(
  c: PoolClient,
  taskId: string,
  item: CaptureItem,
) {
  if (item.estimatedMinutes == null && !item.scheduledStartTime) return;
  await c.query(
    "INSERT INTO subtasks(task_id,title,estimated_minutes,scheduled_date,scheduled_time) VALUES($1,$2,$3,$4,$5)",
    [
      taskId,
      item.title,
      captureDuration(item),
      item.scheduledDate ?? null,
      item.scheduledStartTime ?? null,
    ],
  );
}
export async function capture(
  userId: string,
  input: CaptureRequest,
): Promise<CaptureResult> {
  return receipt(
    userId,
    "capture",
    input.idempotencyKey,
    input.items,
    async (c) => {
      const results = [];
      for (const item of input.items) {
        const areaId = await resolveCaptureArea(c, userId, item.areaId);
        const task = await c.query(
          `INSERT INTO tasks(user_id,area_id,title,status,scheduled_date,scheduling_state,priority,energy_level,recurrence_rule) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,revision,area_id AS "areaId"`,
          captureTaskValues(userId, areaId, item),
        );
        await captureExecutionUnit(c, task.rows[0].id, item);
        results.push(task.rows[0]);
      }
      return { tasks: results, created: results.length };
    },
  );
}
function databaseCalendarDate(value: unknown) {
  if (!(value instanceof Date)) return String(value);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
function assertTargetUnchanged(
  row:
    | {
        completed?: boolean;
        revision: number;
        scheduled_date: Date | string | null;
      }
    | undefined,
  expectedRevision: number,
  fromDate?: string,
) {
  if (!row || row.completed || row.revision !== expectedRevision)
    throw new DailyConflict("An item changed. Refresh your plan.");
  if (
    fromDate !== undefined &&
    databaseCalendarDate(row.scheduled_date) !== fromDate
  )
    throw new DailyConflict("An item changed. Refresh your plan.");
}
export async function lockTarget(
  c: PoolClient,
  userId: string,
  target: ExecutionTarget,
  fromDate?: string,
) {
  // Parent-first locking keeps subtask ownership stable and matches execution rollups.
  const parent =
    target.targetType === "task"
      ? target.targetId
      : (
          await c.query("SELECT task_id FROM subtasks WHERE id=$1", [
            target.targetId,
          ])
        ).rows[0]?.task_id;
  const task = (
    await c.query("SELECT * FROM tasks WHERE id=$1 AND user_id=$2 FOR UPDATE", [
      parent,
      userId,
    ])
  ).rows[0];
  if (!task || task.deleted_at || ["done", "cancelled"].includes(task.status))
    throw new DailyConflict(
      "An item is no longer available. Refresh your plan.",
    );
  const row =
    target.targetType === "task"
      ? task
      : (
          await c.query(
            "SELECT * FROM subtasks WHERE id=$1 AND task_id=$2 FOR UPDATE",
            [target.targetId, parent],
          )
        ).rows[0];
  assertTargetUnchanged(row, target.expectedRevision, fromDate);
  if (
    target.targetType === "task" &&
    (await c.query("SELECT 1 FROM subtasks WHERE task_id=$1 LIMIT 1", [parent]))
      .rowCount
  )
    throw new DailyConflict("Choose the individual steps to move.");
  return row;
}
export async function move(
  userId: string,
  input: MoveRequest,
): Promise<MoveResult> {
  return receipt(
    userId,
    "move",
    input.idempotencyKey,
    input.targets.map((t) => ({ ...t, date: input.scheduledDate })),
    async (c) => {
      const targets = [...input.targets].sort((a, b) =>
        a.targetId.localeCompare(b.targetId),
      );
      for (const t of targets) await lockTarget(c, userId, t);
      const result = [];
      for (const t of targets) {
        const table = t.targetType === "task" ? "tasks" : "subtasks";
        const suffix =
          t.targetType === "task"
            ? ",scheduling_state='scheduled',status=CASE WHEN status='backlog' THEN 'todo'::task_status ELSE status END,updated_at=now()"
            : "";
        const row = await c.query(
          `UPDATE ${table} SET scheduled_date=$1${suffix} WHERE id=$2 RETURNING revision`,
          [input.scheduledDate, t.targetId],
        );
        result.push({ ...t, expectedRevision: row.rows[0].revision });
      }
      return { updated: result.length, targets: result };
    },
  );
}
export async function getFocus(
  userId: string,
  date: string,
): Promise<FocusResult> {
  const row = (
    await pool.query(
      `SELECT f.date::text,f.target_type AS "targetType",f.target_id AS "targetId" FROM daily_focus f WHERE f.user_id=$1 AND f.date=$2 AND ((f.target_type='task' AND EXISTS(SELECT 1 FROM tasks t WHERE t.id=f.target_id AND t.user_id=f.user_id AND t.deleted_at IS NULL AND t.status NOT IN ('done','cancelled') AND t.scheduled_date=f.date AND NOT EXISTS(SELECT 1 FROM subtasks s WHERE s.task_id=t.id))) OR (f.target_type='subtask' AND EXISTS(SELECT 1 FROM subtasks s JOIN tasks t ON t.id=s.task_id WHERE s.id=f.target_id AND t.user_id=f.user_id AND t.deleted_at IS NULL AND t.status NOT IN ('done','cancelled') AND NOT s.completed AND s.scheduled_date=f.date)))`,
      [userId, date],
    )
  ).rows[0];
  return { focus: row ?? null };
}
export async function setFocus(
  userId: string,
  input: FocusSelection,
): Promise<FocusResult> {
  return transaction(async (c) => {
    const row = await c.query(
      input.targetType === "task"
        ? `SELECT revision FROM tasks WHERE id=$1 AND user_id=$2`
        : `SELECT s.revision FROM subtasks s JOIN tasks t ON t.id=s.task_id WHERE s.id=$1 AND t.user_id=$2`,
      [input.targetId, userId],
    );
    await lockTarget(
      c,
      userId,
      { ...input, expectedRevision: row.rows[0]?.revision },
      input.date,
    );
    await c.query(
      "INSERT INTO daily_focus(user_id,date,target_type,target_id) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,date) DO UPDATE SET target_type=EXCLUDED.target_type,target_id=EXCLUDED.target_id",
      [userId, input.date, input.targetType, input.targetId],
    );
    return { focus: input };
  });
}
