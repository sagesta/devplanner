/**
 * Fail fast on missing required env (production / Docker).
 * Call from index.ts before listen.
 */
const REQUIRED = [
  "DATABASE_URL",
  "REDIS_URL",
  "NEXTAUTH_SECRET",
  "ALLOWED_EMAILS",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;

export function validateEnv(): void {
  const missing: string[] = [];
  for (const key of REQUIRED) {
    const v = process.env[key]?.trim();
    if (!v) missing.push(key);
  }
  if (missing.length === 0) return;

  console.error("\n❌ Missing required environment variables:\n");
  for (const k of missing) console.error(`   ${k}`);
  console.error("\n   Copy .env.example → .env and fill in the values.\n");
  process.exit(1);
}
