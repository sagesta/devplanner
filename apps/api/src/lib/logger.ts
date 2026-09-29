import pino from "pino";

/** Never serialize provider/DB error payloads, request credentials or task text. */
export const safeError = (error: unknown): { type: string; code?: string } => {
  const value = error as { name?: unknown; code?: unknown } | null;
  return {
    type:
      typeof value?.name === "string" && /^[A-Za-z]+Error$/.test(value.name)
        ? value.name
        : "Error",
    ...(typeof value?.code === "string" && /^[A-Z0-9_]{1,24}$/.test(value.code)
      ? { code: value.code }
      : {}),
  };
};
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "devplanner-api" },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: { err: safeError },
  redact: {
    paths: [
      "authorization",
      "cookie",
      "password",
      "token",
      "access_token",
      "refresh_token",
      "code",
      "state",
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.access_token",
      "*.refresh_token",
    ],
    censor: "[REDACTED]",
  },
});
