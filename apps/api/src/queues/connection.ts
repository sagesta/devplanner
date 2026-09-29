import { Redis } from "ioredis";

/** Worker consumers wait for Redis; request/producer paths must fail promptly. */
export function createRedisConnection(
  mode: "request" | "worker" = "request",
  url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
): Redis {
  return new Redis(url, mode === "worker"
    ? {maxRetriesPerRequest: null}
    : {maxRetriesPerRequest: 1, connectTimeout: 3000, commandTimeout: 5000});
}
