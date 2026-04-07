"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { deleteTimeLog, fetchTimeLogs } from "@/lib/api";

export function useTimeLogs(taskId: string) {
  const qc = useQueryClient();
  const userId = useAppUserId();

  const logsQuery = useQuery({
    queryKey: ["time-logs", taskId],
    queryFn: () => fetchTimeLogs(taskId),
    enabled: Boolean(taskId) && Boolean(userId),
    staleTime: 5000,
  });

  const deleteMut = useMutation({
    mutationFn: (logId: number) => deleteTimeLog(logId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["time-logs", taskId] });
      // Re-fetch week summary so stats sync
      void qc.invalidateQueries({ queryKey: ["time-logs", "week-summary"] });
      // And the active timer
      void qc.invalidateQueries({ queryKey: ["active-timer"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    logs: logsQuery.data ?? [],
    isLoading: logsQuery.isLoading,
    isError: logsQuery.isError,
    deleteLog: deleteMut.mutate,
    isDeleting: deleteMut.isPending,
  };
}
