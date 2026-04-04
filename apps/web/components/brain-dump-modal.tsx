"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lightbulb, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { fetchAreas, postBrainDumpLines } from "@/lib/api";
import { getDevUserId } from "@/lib/env";

export function BrainDumpModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const userId = getDevUserId();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const areasQ = useQuery({
    queryKey: ["areas", userId],
    queryFn: () => fetchAreas(userId),
    enabled: open && Boolean(userId),
  });

  const [areaId, setAreaId] = useState<string>("");

  useEffect(() => {
    if (areasQ.data?.length && !areaId) {
      setAreaId(areasQ.data[0]!.id);
    }
  }, [areasQ.data, areaId]);

  // Auto-focus textarea on open
  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [open]);

  const lineCount = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean).length;

  const m = useMutation({
    mutationFn: async () => {
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      return postBrainDumpLines(userId, areaId, lines);
    },
    onSuccess: (data) => {
      toast.success(`Added ${data.count} task(s) to backlog`);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["backlog"] });
      setText("");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 animate-fadeIn"
      role="dialog"
      aria-modal
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-surface p-5 shadow-2xl animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb size={18} className="text-primary" />
            <h2 className="font-display text-xl text-foreground">Brain dump</h2>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-muted hover:bg-white/10 hover:text-foreground"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">
          One thought per line — saved to backlog (no AI required).
        </p>
        <label className="mt-4 block text-xs font-medium text-muted">Area</label>
        <select
          className="mt-1 w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm text-foreground"
          value={areaId}
          onChange={(e) => setAreaId(e.target.value)}
        >
          {(areasQ.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <textarea
          ref={textareaRef}
          className="mt-3 min-h-[200px] w-full rounded-lg border border-white/10 bg-background p-3 text-sm text-foreground placeholder:text-muted/50 resize-none"
          placeholder="- Fix login bug&#10;- Call mum&#10;- Write blog post"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="mt-1 text-[10px] text-muted">
          {lineCount > 0 ? `${lineCount} task${lineCount !== 1 ? "s" : ""}` : "Start typing…"}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-white/5 transition-colors"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-40 hover:bg-primary-hover transition-colors"
            disabled={!userId || !areaId || m.isPending || lineCount === 0}
            onClick={() => m.mutate()}
          >
            {m.isPending ? (
              <span className="inline-flex items-center gap-1">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Saving…
              </span>
            ) : (
              `Save ${lineCount} to backlog`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
