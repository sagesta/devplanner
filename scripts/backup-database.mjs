import { spawn } from "node:child_process";
import { createWriteStream, createReadStream } from "node:fs";
import { unlink, chmod } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
const args = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
}
const output = option("--output"),
  verify = option("--verify");
const viaWsl = process.platform === "win32";
function docker(parts) {
  return spawn(
    viaWsl ? "wsl.exe" : "docker",
    viaWsl ? ["-e", "docker", ...parts] : parts,
    { stdio: ["pipe", "pipe", "inherit"] },
  );
}
function wait(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Docker operation failed (${code})`)),
    );
  });
}
async function command(parts) {
  const child = docker(parts);
  child.stdin.end();
  child.stdout.resume();
  await wait(child);
}
async function verifyArchive(file) {
  const name = `devplanner-restore-check-${randomUUID().slice(0, 8)}`;
  try {
    await command([
      "run",
      "--rm",
      "-d",
      "--name",
      name,
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "-e",
      "POSTGRES_DB=restore_check",
      "pgvector/pgvector:pg16",
    ]);
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await command([
          "exec",
          name,
          "pg_isready",
          "-h",
          "127.0.0.1",
          "-U",
          "postgres",
          "-d",
          "restore_check",
        ]);
        ready = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!ready) throw new Error("Restore database did not become ready");
    const child = docker([
      "exec",
      "-i",
      name,
      "pg_restore",
      "--exit-on-error",
      "--no-owner",
      "--no-acl",
      "-h",
      "127.0.0.1",
      "-U",
      "postgres",
      "-d",
      "restore_check",
    ]);
    child.stdout.resume();
    await Promise.all([
      pipeline(createReadStream(file), child.stdin),
      wait(child),
    ]);
    await command([
      "exec",
      name,
      "psql",
      "-h",
      "127.0.0.1",
      "-U",
      "postgres",
      "-d",
      "restore_check",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'",
    ]);
    console.log(
      "Backup restored successfully into an isolated disposable database.",
    );
  } finally {
    await command(["rm", "-f", name]).catch(() => {});
  }
}
try {
  if (verify) {
    await verifyArchive(verify);
  } else if (output) {
    const container = option("--container"),
      database = option("--database", "devplanner"),
      user = option("--user", "devplanner");
    const parts = container
      ? ["exec", container]
      : ["compose", "exec", "-T", "devplanner-db"];
    const destination = createWriteStream(output, { flags: "wx", mode: 0o600 });
    await new Promise((resolve, reject) => {
      destination.once("open", resolve);
      destination.once("error", reject);
    });
    try {
      const child = docker([
        ...parts,
        "pg_dump",
        "-U",
        user,
        "-d",
        database,
        "--format=custom",
        "--no-owner",
        "--no-acl",
      ]);
      child.stdin.end();
      await Promise.all([pipeline(child.stdout, destination), wait(child)]);
      await chmod(output, 0o600).catch(() => {});
      console.log(`Backup written to ${output}`);
    } catch (error) {
      destination.destroy();
      await unlink(output).catch(() => {});
      throw error;
    }
  } else
    throw new Error(
      "Usage: node scripts/backup-database.mjs --output <new-file.dump> [--container <id> --database <name> --user <name>] OR --verify <file.dump>. Verification never restores into the live database.",
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
