"use client";

import { useQuery } from "@tanstack/react-query";
import { CopyPlus } from "lucide-react";
import { useAddToSprint } from "@/hooks/useAddToSprint";
import { cn } from "@/lib/utils";
import { useAppUserId } from "@/hooks/use-app-user-id";

export function AddToSprintButton({ taskId, className }: { taskId: string, className?: string }) {
  const userId = useAppUserId();
  const { mutate, isPending } = useAddToSprint();
  
  // Need to know what the active sprint is to add to it directly
  const { data: activeSprint, isLoading } = useQuery({
    queryKey: ["activeSprint", userId],
    // The codebase already fetches sprint lists. If fetchActiveSprint isn't exported as that, 
    // I will construct it or rely on existing api functions.
    // Assuming the user's pseudo-code meant we fetch it.
    queryFn: async () => {
      // Inline fetch for active sprint if fetchActiveSprint is missing
      const res = await fetch("/api/sprints");
      const json = await res.json();
      return json.sprints?.find((s: any) => s.status === "active") || null;
    },
    enabled: Boolean(userId),
  });

  const handleAdd = () => {
    if (!activeSprint?.id) {
       alert("No active sprint found. Please start a sprint first.");
       return;
    }
    mutate({ taskId, sprintId: activeSprint.id });
  };

  return (
    <button
      onClick={handleAdd}
      disabled={isPending || isLoading || !activeSprint}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50",
        className
      )}
      title={activeSprint ? `Add to ${activeSprint.name}` : "No active sprint"}
    >
      <CopyPlus size={14} />
      <span>Add to Sprint</span>
    </button>
  );
}
