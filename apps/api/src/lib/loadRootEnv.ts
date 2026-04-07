/**
 * Load monorepo-root `.env` / `.env.local` before any other app code reads `process.env`.
 * Import this module first in each entrypoint (side effects only).
 *
 * `npm run dev` runs the API with cwd `apps/api`; Node does not auto-load `../../.env`.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const envPath = join(root, ".env");
const localPath = join(root, ".env.local");
const webLocalPath = join(root, "apps", "web", ".env.local");

if (existsSync(envPath)) dotenv.config({ path: envPath });
if (existsSync(localPath)) dotenv.config({ path: localPath, override: true });
/** Next.js reads this file; API used to ignore it when running `npm run dev` from the monorepo root. */
if (existsSync(webLocalPath)) dotenv.config({ path: webLocalPath, override: true });
