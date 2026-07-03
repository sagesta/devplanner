"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase } from "@/lib/env";

type IdlePayload = { taskId: string; title: string; message: string };

export function useTaskSse(onIdle: (payload: IdlePayload) => void) {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;
  const [connected, setConnected] = useState(false);
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) return;

    let es: EventSource | null = null;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    async function connect() {
      if (disposed) return;
      // EventSource can't send headers, and the API is a different origin in
      // prod (Clerk's cookie won't travel) — pass a fresh short-lived session
      // token in the query string instead. Each reconnect mints a new one.
      let token: string | null = null;
      try {
        token = await getToken();
      } catch {
        token = null;
      }
      if (disposed) return;
      const url = `${getApiBase()}/api/events/user${token ? `?auth_token=${encodeURIComponent(token)}` : ""}`;
      es = new EventSource(url, { withCredentials: true });

      es.addEventListener("open", () => {
        retryCount = 0;
        setConnected(true);
      });

      es.addEventListener("message", (ev) => {
        try {
          const data = JSON.parse(ev.data) as {
            type?: string;
            taskId?: string;
            title?: string;
            message?: string;
          };
          if (data.type === "idle_task" && data.taskId && data.title) {
            onIdleRef.current({
              taskId: data.taskId,
              title: data.title,
              message: data.message ?? "",
            });
          }
        } catch {
          /* ignore parse errors */
        }
      });

      es.addEventListener("error", () => {
        setConnected(false);
        es?.close();
        es = null;
        if (!disposed) {
          // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
          const delay = Math.min(1000 * Math.pow(2, retryCount), 30_000);
          retryCount++;
          retryTimer = setTimeout(() => void connect(), delay);
        }
      });
    }

    void connect();

    return () => {
      disposed = true;
      setConnected(false);
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [isLoaded, isSignedIn, userId, getToken]);

  return { connected };
}

export function useSseConnection() {
  const [connected, setConnected] = useState(false);
  const noop = useCallback(() => {}, []);
  const result = useTaskSse(noop);
  return result;
}
