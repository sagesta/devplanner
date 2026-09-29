"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { captureDaily, newIdempotencyKey } from "@/lib/daily-api";
import { useAppUserId } from "@/hooks/use-app-user-id";

export function QuickAddTask({
  open,
  onClose,
  initialDate,
  defaultDestination = "inbox",
}: {
  open: boolean;
  onClose: () => void;
  initialDate?: string;
  defaultDestination?: "inbox" | "today";
}) {
  const userId = useAppUserId();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const ownerRef = useRef(userId);
  const [title, setTitle] = useState("");
  const titleRef = useRef(title);
  useLayoutEffect(() => {
    ownerRef.current = userId;
  }, [userId]);
  useLayoutEffect(() => {
    titleRef.current = title;
  }, [title]);
  const [destination, setDestination] = useState<"inbox" | "today">(
    initialDate && defaultDestination === "today" ? "today" : "inbox",
  );
  const [retryKey, setRetryKey] = useState<string | null>(null);
  const [retryFingerprint, setRetryFingerprint] = useState<string | null>(null);
  const [draftOwner, setDraftOwner] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const storageKey = userId ? `devplanner.quickAdd.v1.${userId}` : null;

  // The account-scoped draft must be read after hydration and cleared before a new owner can edit.
  /* eslint-disable react-hooks/set-state-in-effect -- account changes require atomic, post-hydration draft reset and restore */
  useEffect(() => {
    setDraftOwner(null);
    titleRef.current = "";
    setTitle("");
    setRetryKey(null);
    setRetryFingerprint(null);
    setRestored(false);
    if (!storageKey) return;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const draft = JSON.parse(stored) as {
          title?: string;
          destination?: "inbox" | "today";
          key?: string | null;
          fingerprint?: string | null;
        };
        // The opening effect must see restored content before the next render,
        // otherwise it can replace the recovered destination with the default.
        titleRef.current = draft.title ?? "";
        setTitle(draft.title ?? "");
        setDestination(draft.destination === "today" ? "today" : "inbox");
        setRetryKey(draft.key ?? null);
        setRetryFingerprint(draft.fingerprint ?? null);
        setRestored(Boolean(draft.title));
      }
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
    setDraftOwner(userId ?? null);
  }, [storageKey, userId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* eslint-disable react-hooks/set-state-in-effect -- report localStorage write failures beside the draft */
  // Storage failures are external state shown next to the draft controls.
  useEffect(() => {
    if (!storageKey || draftOwner !== userId) return;
    try {
      if (title)
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            title,
            destination,
            key: retryKey,
            fingerprint: retryFingerprint,
          }),
        );
      else localStorage.removeItem(storageKey);
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
  }, [
    storageKey,
    draftOwner,
    userId,
    title,
    destination,
    retryKey,
    retryFingerprint,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement;
    if (!titleRef.current)
      setDestination(
        initialDate && defaultDestination === "today" ? "today" : "inbox",
      );
    inputRef.current?.focus();
    return () => openerRef.current?.focus();
  }, [open, initialDate, defaultDestination]);

  const save = useMutation({
    mutationFn: async (owner: string) => {
      const trimmed = title.trim();
      if (!trimmed) throw new Error("Enter a task title.");
      if (destination === "today" && !initialDate)
        throw new Error("Today’s date is still loading. Retry in a moment.");
      const fingerprint = JSON.stringify({
        title: trimmed,
        destination,
        scheduledDate: destination === "today" ? initialDate : null,
      });
      const key =
        retryKey && retryFingerprint === fingerprint
          ? retryKey
          : newIdempotencyKey();
      setRetryKey(key);
      setRetryFingerprint(fingerprint);
      if (storageKey) {
        try {
          localStorage.setItem(
            storageKey,
            JSON.stringify({ title, destination, key, fingerprint }),
          );
        } catch {
          setStorageAvailable(false);
        }
      }
      return captureDaily(
        [
          {
            title: trimmed,
            scheduledDate: destination === "today" ? initialDate : null,
          },
        ],
        key,
      );
    },
    onSuccess: (_result, owner) => {
      if (ownerRef.current !== owner) return;
      setTitle("");
      setRetryKey(null);
      setRetryFingerprint(null);
      try {
        if (storageKey) localStorage.removeItem(storageKey);
      } catch {
        setStorageAvailable(false);
      }
      toast.success(
        destination === "today" ? "Added to Today" : "Added to Inbox",
      );
      void qc.invalidateQueries({ queryKey: ["tasks-today"] });
      void qc.invalidateQueries({ queryKey: ["backlog"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["areas"] });
      onClose();
    },
    onError: (error: Error) =>
      toast.error(
        `${error.message} Your task is still here; retry when ready.`,
      ),
  });

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[65] flex items-start justify-center bg-black/70 p-4 pt-[min(15vh,5rem)]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-add-title"
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-5 shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          if (event.key === "Tab") {
            const controls = Array.from(
              dialogRef.current?.querySelectorAll<HTMLElement>(
                "input:not(:disabled),select:not(:disabled),button:not(:disabled)",
              ) ?? [],
            );
            if (!controls.length) return;
            if (event.shiftKey && document.activeElement === controls[0]) {
              event.preventDefault();
              controls[controls.length - 1]?.focus();
            } else if (
              !event.shiftKey &&
              document.activeElement === controls[controls.length - 1]
            ) {
              event.preventDefault();
              controls[0]?.focus();
            }
          }
        }}
      >
        <h2
          id="quick-add-title"
          className="font-display text-xl text-[var(--ink)]"
        >
          Add task
        </h2>
        <p className="mt-1 text-sm text-muted">
          Capture one task. You can add details later.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!save.isPending && userId) save.mutate(userId);
          }}
        >
          <label
            htmlFor="quick-task-title"
            className="mt-4 block text-sm font-medium text-[var(--ink)]"
          >
            Task
          </label>
          <input
            id="quick-task-title"
            ref={inputRef}
            value={title}
            disabled={save.isPending || draftOwner !== userId}
            onChange={(event) => {
              setTitle(event.target.value);
              setRetryKey(null);
              setRetryFingerprint(null);
              setRestored(false);
            }}
            placeholder="What needs doing?"
            className="mt-1 min-h-11 w-full rounded-lg border border-[var(--hairline)] bg-background px-3 text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--teal)]"
          />
          <label
            htmlFor="quick-task-destination"
            className="mt-4 block text-sm font-medium text-[var(--ink)]"
          >
            Put it in
          </label>
          <select
            id="quick-task-destination"
            value={destination}
            disabled={save.isPending || !initialDate}
            onChange={(event) => {
              setDestination(event.target.value as "inbox" | "today");
              setRetryKey(null);
              setRetryFingerprint(null);
            }}
            className="mt-1 min-h-11 w-full rounded-lg border border-[var(--hairline)] bg-background px-3 text-[var(--ink)]"
          >
            <option value="inbox">Inbox</option>
            <option value="today">
              {initialDate ? "Today" : "Today (loading date…)"}
            </option>
          </select>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              disabled={save.isPending}
              className="min-h-11 rounded-lg px-3 text-sm text-muted hover:text-[var(--ink)] disabled:opacity-40"
              onClick={() => {
                setTitle("");
                setRetryKey(null);
                setRetryFingerprint(null);
                setRestored(false);
                toast.message("Draft discarded");
              }}
            >
              Discard draft
            </button>
            <button
              type="button"
              className="min-h-11 rounded-lg px-3 text-sm text-[var(--teal)] hover:underline"
              onClick={() => {
                onClose();
                window.dispatchEvent(
                  new CustomEvent("devplanner:open-brain-dump"),
                );
              }}
            >
              Add multiple tasks
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                className="min-h-11 rounded-lg px-3 text-sm text-muted hover:text-[var(--ink)]"
                onClick={onClose}
              >
                Close
              </button>
              <button
                type="submit"
                disabled={
                  !title.trim() ||
                  save.isPending ||
                  !userId ||
                  draftOwner !== userId ||
                  (destination === "today" && !initialDate)
                }
                className="min-h-11 rounded-lg bg-[var(--ink-btn-bg)] px-5 text-sm font-semibold text-[var(--ink-btn-fg)] disabled:opacity-40"
              >
                {save.isPending ? "Saving…" : "Add task"}
              </button>
            </div>
          </div>
        </form>
        {title && (
          <p className="mt-2 text-xs text-muted">
            {storageAvailable
              ? restored
                ? "Draft restored from this device."
                : "Draft kept on this device until saved or discarded."
              : "Local draft recovery is unavailable in this browser."}
          </p>
        )}
      </section>
    </div>
  );
}
