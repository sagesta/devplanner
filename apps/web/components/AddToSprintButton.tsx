"use client";

import { useQuery } from "@tanstack/react-query";
import { CopyPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAddToSprint } from "@/hooks/useAddToSprint";
import { fetchSprints } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAppUserId } from "@/hooks/use-app-user-id";

export function AddToSprintButton({ taskId, className }: { taskId: string; className?: string }) {
  const userId = useAppUserId();
  const router = useRouter();
  const { mutate, isPending } = useAddToSprint();
  const [selectedSprintId, setSelectedSprintId] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["sprints", userId],
    queryFn: fetchSprints,
    enabled: Boolean(userId),
  });

  const activeSprints = useMemo(() => {
    return (data?.sprints ?? []).filter((s) => s.status === "active");
  }, [data?.sprints]);

  const selectedSprint =
    activeSprints.find((s) => s.id === selectedSprintId) ?? activeSprints[0] ?? null;

  const handleAdd = () => {
    if (!selectedSprint?.id) {
      toast.error("No active sprint found.", {
        description: "Start a sprint first, then add tasks to it.",
        action: {
          label: "Open Sprints",
          onClick: () => router.push("/sprints"),
        },
      });
      return;
    }
    mutate({ taskId, sprintId: selectedSprint.id });
  };

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {activeSprints.length > 1 && (
        <select
          className="max-w-[160px] rounded-lg border border-white/10 bg-background px-2 py-1.5 text-xs text-foreground"
          value={selectedSprint?.id ?? ""}
          onChange={(e) => setSelectedSprintId(e.target.value)}
          aria-label="Choose active sprint"
        >
          {activeSprints.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      <button
        onClick={handleAdd}
        disabled={isPending || isLoading || !selectedSprint}
        className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
        title={selectedSprint ? `Add to ${selectedSprint.name}` : "No active sprint"}
      >
        <CopyPlus size={14} />
        <span>Add to Sprint</span>
      </button>
    </div>
  );
}
