"use client";

import { useSession } from "next-auth/react";

export function useAppUserId(): string | undefined {
  const { data } = useSession();
  return data?.user?.id;
}
