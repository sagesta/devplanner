"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase, getDevUserId } from "@/lib/env";

type IdlePayload = { taskId: string; title: string; message: string };

export function useTaskSse(onIdle: (payload: IdlePayload) => void) {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const userId = getDevUserId();
    if (!userId) return;

    let es: EventSource | null = null;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;
      const url = new URL(`${getApiBase()}/api/events/user`);
      url.searchParams.set("userId", userId);
      es = new EventSource(url.toString());

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
          retryTimer = setTimeout(connect, delay);
        }
      });
    }

    connect();

    return () => {
      disposed = true;
      setConnected(false);
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  return { connected };
}

export function useSseConnection() {
  const [connected, setConnected] = useState(false);
  const noop = useCallback(() => {}, []);
  const result = useTaskSse(noop);
  return result;
}
