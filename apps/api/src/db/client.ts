import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://devplanner:devplanner@localhost:5433/devplanner";

export const pool = new pg.Pool({ connectionString });

export const db = drizzle(pool, { schema });
