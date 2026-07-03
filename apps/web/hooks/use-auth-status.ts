"use client";

import { useAuth } from "@clerk/nextjs";

/**
 * NextAuth-vocabulary compatibility shim over Clerk.
 * Pages gate rendering on `status === "loading" | "authenticated" |
 * "unauthenticated"`; keeping that contract made the migration a one-line
 * import swap per page.
 */
export function useAuthStatus(): { status: "loading" | "authenticated" | "unauthenticated" } {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return { status: "loading" };
  return { status: isSignedIn ? "authenticated" : "unauthenticated" };
}
