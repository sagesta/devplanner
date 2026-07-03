"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { registerAuthTokenGetter } from "@/lib/auth-token";

/** Expose Clerk's getToken to plain fetch helpers (lib/api.ts) outside React. */
function AuthTokenBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    registerAuthTokenGetter(() => getToken());
  }, [getToken]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000, // 30s — reduce refetch noise
            refetchOnWindowFocus: true, // instant fresh data on tab switch
            retry: 2, // resilience against network blips
            refetchOnReconnect: true,
          },
        },
      })
  );
  return (
    <ClerkProvider>
      <AuthTokenBridge />
      <QueryClientProvider client={client}>
        {children}
        <Toaster
        richColors
        position="top-center"
        toastOptions={{
          style: {
            background: "#1c1b19",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "#f7f6f2",
          },
        }}
        />
      </QueryClientProvider>
    </ClerkProvider>
  );
}
