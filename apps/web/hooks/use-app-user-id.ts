"use client";

import { useAuth } from "@clerk/nextjs";

/**
 * Stable per-user id for query keys and signed-in gates.
 *
 * Note: this is the CLERK user id, not the internal users.id UUID — the
 * servers map Clerk identity → internal UUID by email. Client code only ever
 * uses this value for cache keys and Boolean(userId) checks, so the switch
 * is transparent.
 */
export function useAppUserId(): string | undefined {
  const { userId } = useAuth();
  return userId ?? undefined;
}
