import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const files = JSON.parse(
  readFileSync(new URL("./format-scope.json", import.meta.url), "utf8"),
);
const result = spawnSync(
  process.execPath,
  ["node_modules/prettier/bin/prettier.cjs", "--check", ...files],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
