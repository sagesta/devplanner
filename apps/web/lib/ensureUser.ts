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
  const rows = await getSql()`
    INSERT INTO users (email, name, updated_at)
    VALUES (${email}, ${name}, NOW())
    ON CONFLICT (email) DO UPDATE SET
      name = COALESCE(EXCLUDED.name, users.name),
      updated_at = NOW()
    RETURNING id
  `;
  const id = (rows[0] as { id: string } | undefined)?.id;
  if (!id) throw new Error("Failed to upsert user");
  return id;
}
