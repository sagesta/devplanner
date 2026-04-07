"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import {
  createTag,
  fetchAllTags,
  setTaskTags,
  type TagRow,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { TagChip } from "./TagChip";

const COLOR_SWATCHES = [
  "#EF4444", "#F97316", "#F59E0B", "#10B981",
  "#06B6D4", "#3B82F6", "#6366F1", "#8B5CF6",
  "#EC4899", "#6B7280",
];

/**
 * TagSelector — dropdown with search, tag list, and create-new-tag functionality.
 */
export function TagSelector({
  taskId,
  currentTags,
  onUpdate,
  className,
}: {
  taskId: string;
  currentTags: Array<{ id: number; name: string; color: string | null }>;
  onUpdate?: (tags: Array<{ id: number; name: string; color: string | null }>) => void;
  className?: string;
}) {
  const userId = useAppUserId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [newColor, setNewColor] = useState(COLOR_SWATCHES[0]);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const allTagsQ = useQuery({
    queryKey: ["all-tags"],
    queryFn: fetchAllTags,
    enabled: open,
    staleTime: 10_000,
  });

  const createMut = useMutation({
    mutationFn: (body: { name: string; color: string }) => createTag(body),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["all-tags"] });
      // Also toggle this tag on
      const newIds = [...currentTags.map((t) => t.id), data.tag.id];
      setTagsMut.mutate(newIds);
      setSearch("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setTagsMut = useMutation({
    mutationFn: (tagIds: number[]) => setTaskTags(taskId, tagIds),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
      void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
      onUpdate?.(data.tags);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const allTags = allTagsQ.data ?? [];
  const filtered = search
    ? allTags.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    : allTags;
  const currentIds = new Set(currentTags.map((t) => t.id));
  const exactMatch = allTags.find((t) => t.name.toLowerCase() === search.toLowerCase().trim());

  function toggleTag(tagId: number) {
    const next = currentIds.has(tagId)
      ? currentTags.filter((t) => t.id !== tagId).map((t) => t.id)
      : [...currentTags.map((t) => t.id), tagId];
    setTagsMut.mutate(next);
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted hover:bg-white/10 hover:text-foreground transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        <Plus size={10} />
        Tag
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-white/10 bg-surface shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Search */}
          <div className="flex items-center gap-1.5 border-b border-white/10 px-2.5 py-2">
            <Search size={12} className="text-muted" />
            <input
              ref={inputRef}
              className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted/50 outline-none"
              placeholder="Search or create…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter" && search.trim() && !exactMatch) {
                  createMut.mutate({ name: search.trim(), color: newColor });
                }
              }}
            />
            <button
              type="button"
              className="rounded p-0.5 text-muted hover:text-foreground"
              onClick={() => setOpen(false)}
            >
              <X size={12} />
            </button>
          </div>

          {/* Tag list */}
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-white/[0.06] transition-colors"
                onClick={() => toggleTag(tag.id)}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: tag.color ?? "#6B7280" }}
                />
                <span className="flex-1 text-left text-foreground">{tag.name}</span>
                {currentIds.has(tag.id) && (
                  <Check size={12} className="text-primary" />
                )}
              </button>
            ))}
            {filtered.length === 0 && !search.trim() && (
              <p className="px-2.5 py-3 text-center text-[10px] text-muted">No tags yet</p>
            )}
          </div>

          {/* Create new */}
          {search.trim() && !exactMatch && (
            <div className="border-t border-white/10 px-2.5 py-2 space-y-2">
              <div className="flex flex-wrap gap-1">
                {COLOR_SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={cn(
                      "h-4 w-4 rounded-full border-2 transition-transform",
                      newColor === c ? "border-foreground scale-110" : "border-transparent"
                    )}
                    style={{ backgroundColor: c }}
                    onClick={() => setNewColor(c)}
                  />
                ))}
              </div>
              <button
                type="button"
                className="flex w-full items-center justify-center gap-1 rounded-md bg-primary/15 px-2 py-1.5 text-[10px] font-medium text-primary hover:bg-primary/25 transition-colors disabled:opacity-40"
                disabled={createMut.isPending}
                onClick={() => createMut.mutate({ name: search.trim(), color: newColor })}
              >
                <Plus size={10} />
                Create &quot;{search.trim()}&quot;
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
