import { spawnSync } from "node:child_process";
import { withTestDatabaseServer } from "./test-database.mjs";
try {
  process.exitCode = await withTestDatabaseServer(
    (url) =>
      spawnSync(process.execPath, ["scripts/test-api.mjs"], {
        stdio: "inherit",
        env: { ...process.env, DATABASE_URL: url, DAILY_INTEGRATION_TEST: "1" },
      }).status ?? 1,
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
