"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createTask, fetchInboxArea } from "@/lib/api";
import { useAppUserId } from "@/hooks/use-app-user-id";

/**
 * Zero-friction capture: one line in, dropped into the user's Inbox area.
 * Enter saves and clears (stays open for rapid capture). Esc closes.
 * Distinct from BrainDump, which is the bulk/markup variant.
 */
export function QuickCaptureModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const userId = useAppUserId();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [recentlySaved, setRecentlySaved] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Resolve the Inbox once on first open. Cached forever for this user.
  const inboxQ = useQuery({
    queryKey: ["inbox-area", userId],
    queryFn: fetchInboxArea,
    enabled: open && Boolean(userId),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!open) {
      setText("");
      setRecentlySaved([]);
      return;
    }
    const t = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const m = useMutation({
    mutationFn: async (title: string) => {
      if (!inboxQ.data) throw new Error("Inbox not ready");
      return createTask({
        areaId: inboxQ.data.id,
        title,
        status: "backlog",
      });
    },
    onSuccess: (_data, title) => {
      setText("");
      setRecentlySaved((prev) => [title, ...prev].slice(0, 5));
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["backlog"] });
      // Keep focus for the next item — that's the whole point of quick capture.
      inputRef.current?.focus();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not save");
    },
  });

  if (!open) return null;

  const trimmed = text.trim();
  const busy = m.isPending;
  const ready = Boolean(inboxQ.data) && !busy;

  function submit() {
    if (!trimmed || !ready) return;
    m.mutate(trimmed);
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 p-4 pt-[18vh] animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-surface shadow-2xl animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5 text-xs text-muted">
          <Inbox size={12} />
          Quick capture to Inbox
          <span className="ml-auto font-mono text-[10px] text-muted/60">
            <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5">Enter</kbd>{" "}
            save ·{" "}
            <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5">Esc</kbd>{" "}
            close
          </span>
        </div>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={inboxQ.isLoading ? "Loading…" : "What's on your mind?"}
          className="w-full bg-transparent px-4 py-3.5 text-sm text-foreground outline-none placeholder:text-muted/50"
          disabled={!ready && !inboxQ.data}
        />
        {(recentlySaved.length > 0 || busy) && (
          <div className="border-t border-white/5 px-4 py-2 text-[11px] text-muted">
            {busy && (
              <span className="flex items-center gap-1.5">
                <Loader2 size={10} className="animate-spin" />
                Saving…
              </span>
            )}
            {!busy && recentlySaved.length > 0 && (
              <>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-muted/60">
                  Just captured
                </p>
                <ul className="space-y-0.5">
                  {recentlySaved.map((t, i) => (
                    <li key={i} className="truncate text-foreground/70">
                      ✓ {t}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
