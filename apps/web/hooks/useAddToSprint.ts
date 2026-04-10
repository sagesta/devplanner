import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { patchTask } from "@/lib/api";

export function useAddToSprint() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, sprintId }: { taskId: string; sprintId: string }) => {
      // Auto-set status to 'todo' since it's going into an active sprint (or keep existing if not backlog)
      return patchTask(taskId, {
        sprintId,
        status: "todo",
      });
    },
    onSuccess: (data, { sprintId }) => {
      toast.success("Added to sprint");
      // Invalidate the active sprint board so it immediately fetches the new task
      void qc.invalidateQueries({ queryKey: ["sprintTasks", sprintId] });
      // Also invalidate backlog and generic tasks
      void qc.invalidateQueries({ queryKey: ["backlog"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });
}
