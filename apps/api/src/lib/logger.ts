import pino from "pino";

/** Structured JSON logger — singleton for the entire API process. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "devplanner-api" },
  timestamp: pino.stdTimeFunctions.isoTime,
});
