import { Redis } from "ioredis";

const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

export function createRedisConnection(): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}
