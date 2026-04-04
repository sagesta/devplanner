export function getDevUserId(): string {
  return process.env.NEXT_PUBLIC_DEV_USER_ID ?? "";
}

export function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
}
