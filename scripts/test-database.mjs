import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const viaWsl =
  process.platform === "win32" &&
  spawnSync("docker", ["--version"], { stdio: "ignore" }).status !== 0;
function docker(args, options = {}) {
  return spawnSync(
    viaWsl ? "wsl.exe" : "docker",
    viaWsl ? ["-e", "docker", ...args] : args,
    { encoding: "utf8", ...options },
  );
}
function checked(args) {
  const r = docker(args);
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "Docker failed");
  return r.stdout.trim();
}
export async function withTestDatabaseServer(fn) {
  const name = `devplanner-tests-${randomUUID().slice(0, 8)}`;
  try {
    checked([
      "run",
      "--rm",
      "-d",
      "--name",
      name,
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "-e",
      "POSTGRES_DB=daily_test",
      "-p",
      "127.0.0.1::5432",
      "pgvector/pgvector:pg16",
    ]);
    const port = checked(["port", name, "5432/tcp"]).split(":").at(-1);
    let ready = false;
    for (let n = 0; n < 30; n++) {
      if (
        docker(
          ["exec", name, "pg_isready", "-U", "postgres", "-d", "daily_test"],
          { stdio: "ignore" },
        ).status === 0
      ) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) throw new Error("Disposable PostgreSQL did not become ready");
    return await fn(`postgresql://postgres@127.0.0.1:${port}/daily_test`);
  } finally {
    docker(["rm", "-f", name], { stdio: "ignore" });
  }
}
