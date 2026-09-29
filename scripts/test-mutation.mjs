import { spawnSync } from "node:child_process";
import { withTestDatabaseServer } from "./test-database.mjs";
try {
  process.exitCode = await withTestDatabaseServer(
    (url) =>
      spawnSync(
        process.execPath,
        [
          "node_modules/@stryker-mutator/core/bin/stryker.js",
          "run",
          ...process.argv.slice(2),
        ],
        {
          stdio: "inherit",
          env: { ...process.env, MUTATION_DATABASE_ADMIN_URL: url },
        },
      ).status ?? 1,
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
