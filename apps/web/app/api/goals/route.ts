import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/authOptions";
import { getAppSql } from "@/lib/ensureUser";

const CELL_KEYS = [
  "short:personal",
  "short:professional",
  "short:work",
  "mid:personal",
  "mid:professional",
  "mid:work",
  "long:personal",
  "long:professional",
  "long:work",
] as const;

type GoalCellKey = (typeof CELL_KEYS)[number];
type GoalMatrix = Record<GoalCellKey, string>;

const EMPTY_GOALS: GoalMatrix = {
  "short:personal": "",
  "short:professional": "",
  "short:work": "",
  "mid:personal": "",
  "mid:professional": "",
  "mid:work": "",
  "long:personal": "",
  "long:professional": "",
  "long:work": "",
};

function normalizeGoals(input: unknown): GoalMatrix {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const next: GoalMatrix = { ...EMPTY_GOALS };
  for (const key of CELL_KEYS) {
    const value = source[key];
    next[key] = typeof value === "string" ? value.slice(0, 2000) : "";
  }
  return next;
}

async function requireUserId(): Promise<string | NextResponse> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return userId;
}

async function ensureGoalTable() {
  const sql = getAppSql();
  await sql`
    CREATE TABLE IF NOT EXISTS goal_horizons (
      user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      owner_name VARCHAR(255),
      goals      JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function GET() {
  const userId = await requireUserId();
  if (typeof userId !== "string") return userId;

  await ensureGoalTable();
  const sql = getAppSql();
  const rows = await sql`
    SELECT owner_name, goals, updated_at
    FROM goal_horizons
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  const row = rows[0] as
    | { owner_name: string | null; goals: unknown; updated_at: Date | string | null }
    | undefined;

  return NextResponse.json({
    ownerName: row?.owner_name ?? null,
    goals: normalizeGoals(row?.goals),
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  });
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (typeof userId !== "string") return userId;

  const body = (await req.json().catch(() => null)) as
    | { ownerName?: unknown; goals?: unknown }
    | null;
  const ownerName =
    typeof body?.ownerName === "string" && body.ownerName.trim()
      ? body.ownerName.trim().slice(0, 255)
      : null;
  const goals = normalizeGoals(body?.goals);

  await ensureGoalTable();
  const sql = getAppSql();
  const rows = await sql`
    INSERT INTO goal_horizons (user_id, owner_name, goals)
    VALUES (${userId}, ${ownerName}, ${sql.json(goals)})
    ON CONFLICT (user_id) DO UPDATE SET
      owner_name = EXCLUDED.owner_name,
      goals = EXCLUDED.goals,
      updated_at = NOW()
    RETURNING owner_name, goals, updated_at
  `;
  const row = rows[0] as { owner_name: string | null; goals: unknown; updated_at: Date | string };

  return NextResponse.json({
    ownerName: row.owner_name,
    goals: normalizeGoals(row.goals),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}
