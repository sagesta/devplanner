import { cors } from "hono/cors";
/** Browser origins must be explicitly configured; never reflect arbitrary origins. */
export function appCors(
  configuredOrigins = process.env.CORS_ORIGIN ?? "http://localhost:3000",
) {
  const allowed = configuredOrigins
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  });
}
