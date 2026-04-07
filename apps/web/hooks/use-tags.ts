"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { createTag, deleteTag, fetchAllTags, setTaskTags } from "@/lib/api";

export function useTags() {
  const qc = useQueryClient();
  const userId = useAppUserId();

  const tagsQuery = useQuery({
    queryKey: ["all-tags"],
    queryFn: fetchAllTags,
    staleTime: 10_000,
    enabled: Boolean(userId),
  });

  const createMut = useMutation({
    mutationFn: (body: { name: string; color: string }) => createTag(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["all-tags"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteTag(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["all-tags"] });
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setTaskTagsMut = useMutation({
    mutationFn: ({ taskId, tagIds }: { taskId: string; tagIds: number[] }) =>
      setTaskTags(taskId, tagIds),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    tags: tagsQuery.data ?? [],
    isLoading: tagsQuery.isLoading,
    isError: tagsQuery.isError,
    createTag: createMut.mutate,
    isCreating: createMut.isPending,
    deleteTag: deleteMut.mutate,
    isDeleting: deleteMut.isPending,
    setTaskTags: setTaskTagsMut.mutate,
    isSettingTags: setTaskTagsMut.isPending,
  };
}
