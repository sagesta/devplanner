export function getDevUserId(): string {
  const envUserId = process.env.NEXT_PUBLIC_DEV_USER_ID ?? "";
  if (envUserId) return envUserId;

  if (typeof window === "undefined") return "";

  const params = new URLSearchParams(window.location.search);
  const userIdFromUrl = params.get("userId") ?? "";
  if (userIdFromUrl) {
    window.localStorage.setItem("devplanner.userId", userIdFromUrl);
    return userIdFromUrl;
  }

  return window.localStorage.getItem("devplanner.userId") ?? "";
}

export function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
}
