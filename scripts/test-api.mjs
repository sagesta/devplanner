import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
const root = resolve(import.meta.dirname, "..");
function collect(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? collect(join(dir, e.name))
      : /\.test\.ts$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
}
let admin;
let database;
let status = 1;
try {
  const env = { ...process.env };
  if (process.argv.includes("--integration")) {
    const url = new URL(env.MUTATION_DATABASE_ADMIN_URL ?? "");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      url.pathname !== "/daily_test"
    )
      throw new Error(
        "Mutation runner requires the disposable localhost daily_test server.",
      );
    admin = new pg.Client({ connectionString: url.toString() });
    await admin.connect();
    database = `daily_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE "${database}"`);
    url.pathname = `/${database}`;
    env.DATABASE_URL = url.toString();
    env.DAILY_INTEGRATION_TEST = "1";
    env.MUTATION_TEST = "1";
  }
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", ...collect(join(root, "apps/api/src"))],
    { cwd: root, stdio: "inherit", env },
  );
  status = result.status ?? 1;
} finally {
  if (admin) {
    try {
      if (database)
        await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
}
process.exitCode = status;
