/** Calendar and AI integrations are optional; basic capture only needs these. */
const REQUIRED = [
  "DATABASE_URL",
  "REDIS_URL",
  "CLERK_SECRET_KEY",
  "ALLOWED_EMAILS",
] as const;
export function missingRequiredEnvironment(
  env: Record<string, string | undefined>,
): string[] {
  return REQUIRED.filter((key) => !env[key]?.trim());
}
export function validateEnv(): void {
  const missing = missingRequiredEnvironment(process.env);
  if (!missing.length) return;
  console.error(
    `Missing required environment variables: ${missing.join(", ")}. Configure the runtime environment before starting.`,
  );
  process.exit(1);
}
