"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import { useState } from "react";
import { Toaster } from "sonner";

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
    <SessionProvider>
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
    </SessionProvider>
  );
}
