"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import {
  fetchActiveTimer,
  startTimer as apiStartTimer,
  stopTimer as apiStopTimer,
  type ActiveTimerRow,
} from "@/lib/api";

/**
 * Global active timer hook. Polls for the active timer every 5s
 * and provides state + formatted elapsed time.
 */
export function useActiveTimer() {
  const userId = useAppUserId();
  const qc = useQueryClient();
  const [elapsed, setElapsed] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const q = useQuery({
    queryKey: ["active-timer", userId],
    queryFn: fetchActiveTimer,
    enabled: Boolean(userId),
    refetchInterval: 5000,
    staleTime: 2000,
  });

  const activeLog = q.data ?? null;
  const isRunning = Boolean(activeLog);

  // Tick elapsed seconds
  useEffect(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (!activeLog) {
      setElapsed(0);
      return;
    }
    const startMs = new Date(activeLog.startedAt).getTime();
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    update();
    tickRef.current = setInterval(update, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [activeLog?.id, activeLog?.startedAt]);

  const startMut = useMutation({
    mutationFn: (taskId: string) => apiStartTimer(taskId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["active-timer"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stopMut = useMutation({
    mutationFn: (logId: number) => apiStopTimer(logId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["active-timer"] });
      void qc.invalidateQueries({ queryKey: ["time-logs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startTimer = useCallback(
    (taskId: string) => startMut.mutate(taskId),
    [startMut]
  );

  const stopActiveTimer = useCallback(() => {
    if (activeLog) stopMut.mutate(activeLog.id);
  }, [activeLog, stopMut]);

  return {
    activeLog,
    isRunning,
    elapsed,
    startTimer,
    stopActiveTimer,
    isStarting: startMut.isPending,
    isStopping: stopMut.isPending,
  };
}

/** Format seconds as HH:MM:SS. */
export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Format seconds as a short human string like "2h 15m". */
export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}
