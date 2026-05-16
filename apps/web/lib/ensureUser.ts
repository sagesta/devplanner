import postgres from "postgres";

let sql: ReturnType<typeof postgres> | null = null;

function getSql() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!sql) {
    sql = postgres(url, { max: 1 });
  }
  return sql;
}

/** Upsert app user by Google email; returns internal UUID used as JWT sub and API userId. */
export async function upsertUserByEmail(email: string, name: string | null): Promise<string> {
  const client = getSql();
  const rows = await client`
    INSERT INTO users (email, name, updated_at)
    VALUES (${email}, ${name}, NOW())
    ON CONFLICT (email) DO UPDATE SET
      name = COALESCE(EXCLUDED.name, users.name),
      updated_at = NOW()
    RETURNING id
  `;
  const id = (rows[0] as { id: string } | undefined)?.id;
  if (!id) throw new Error("Failed to upsert user");

  // Auto-bootstrap default areas for users that don't have any yet.
  // Covers two cases:
  //   1) Brand-new Google sign-ins (the seed script never ran for them).
  //   2) Pre-existing users from before this code was deployed.
  // Idempotent — only inserts when the user has zero areas, so re-running
  // on every login is cheap (one indexed SELECT) and never duplicates.
  const existing = await client`SELECT id FROM areas WHERE user_id = ${id} LIMIT 1`;
  if (existing.length === 0) {
    await client`
      INSERT INTO areas (user_id, name, color, sort_order)
      VALUES
        (${id}, 'Work', '#01696f', 0),
        (${id}, 'Personal', '#6b7280', 1)
    `;
  }

  return id;
}
