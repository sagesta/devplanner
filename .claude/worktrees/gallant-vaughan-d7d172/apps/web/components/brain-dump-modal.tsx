"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Lightbulb, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { fetchAreas, postBrainDumpLines } from "@/lib/api";
import { useAppUserId } from "@/hooks/use-app-user-id";

export function BrainDumpModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const userId = useAppUserId();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [moreSchedule, setMoreSchedule] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("");
  const [startT, setStartT] = useState("");
  const [endT, setEndT] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const RECURRENCE_PRESETS: { label: string; value: string }[] = [
    { label: "No repeat", value: "" },
    { label: "Daily", value: "FREQ=DAILY" },
    { label: "Weekly", value: "FREQ=WEEKLY" },
    { label: "Weekdays", value: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
  ];

  const toPgTime = (v: string): string | null => {
    if (!v) return null;
    return v.length === 5 ? `${v}:00` : v;
  };

  const areasQ = useQuery({
    queryKey: ["areas", userId],
    queryFn: () => fetchAreas(),
    enabled: open && Boolean(userId),
  });

  const [areaId, setAreaId] = useState<string>("");

  useEffect(() => {
    if (areasQ.data?.length && !areaId) {
      setAreaId(areasQ.data[0]!.id);
    }
  }, [areasQ.data, areaId]);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => textareaRef.current?.focus());
  }, [open]);

  const lineCount = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean).length;

  const m = useMutation({
    mutationFn: async () => {
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      let safeDate: string | null = scheduledDate || null;
      if (safeDate) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDate)) {
          toast.error("Invalid date — use the date picker.");
          throw new Error("invalid date");
        }
        const y = Number(safeDate.slice(0, 4));
        // stress-test-fix: reject absurd future dates (bad parsing / typos)
        if (y > new Date().getFullYear() + 2) {
          toast.error("That year looks wrong — please pick a date within the next 2 years.");
          throw new Error("date too far");
        }
      }
      const st = toPgTime(startT);
      const et = toPgTime(endT);
      if (st && et && et < st) {
        toast.error("End time must be after start time.");
        throw new Error("time order");
      }
      const schedule =
        safeDate || startT || endT || recurrence
          ? {
              scheduledDate: safeDate,
              scheduledStartTime: st,
              scheduledEndTime: et,
              recurrenceRule: recurrence || null,
            }
          : undefined;
      return postBrainDumpLines(areaId, lines, schedule);
    },
    onSuccess: (data) => {
      toast.success(`Added ${data.count} task(s) to backlog`);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["backlog"] });
      void qc.invalidateQueries({ queryKey: ["tasks-today"] });
      setText("");
      setScheduledDate("");
      setStartT("");
      setEndT("");
      setRecurrence("");
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
        {!userId ? (
          <p className="mt-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90">
            Sign in to capture tasks. If this persists, refresh the page.
          </p>
        ) : areasQ.isError ? (
          <p className="mt-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200/90">
            Could not load areas — is the API running and{" "}
            <code className="rounded bg-black/30 px-1">NEXT_PUBLIC_API_URL</code> correct?{" "}
            {areasQ.error instanceof Error ? areasQ.error.message : String(areasQ.error)}
          </p>
        ) : (
          <select
            className="mt-1 w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm text-foreground disabled:opacity-50"
            value={areaId}
            disabled={areasQ.isLoading || areasQ.isFetching}
            onChange={(e) => setAreaId(e.target.value)}
          >
            {areasQ.isLoading || areasQ.isFetching ? (
              <option value="">Loading areas…</option>
            ) : (areasQ.data?.length ?? 0) === 0 ? (
              <option value="">No areas — run npm run seed</option>
            ) : (
              (areasQ.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))
            )}
          </select>
        )}
        <textarea
          ref={textareaRef}
          className="mt-3 min-h-[200px] w-full rounded-lg border border-white/10 bg-background p-3 text-sm text-foreground placeholder:text-muted/50 resize-none"
          placeholder="- Fix login bug&#10;- Call mum&#10;- Write blog post"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          className="mt-2 flex w-full items-center justify-center gap-1 text-[11px] text-muted hover:text-foreground"
          onClick={() => setMoreSchedule((v) => !v)}
        >
          {moreSchedule ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Optional: same schedule for all lines (date, time, repeat)
        </button>
        {moreSchedule && (
          <div className="mt-2 grid gap-2 rounded-lg border border-white/10 bg-background/40 p-3 text-xs">
            <label className="text-muted">
              Date
              <input
                type="date"
                className="mt-1 w-full rounded-md border border-white/10 bg-background px-2 py-1.5 text-foreground"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-muted">
                Start
                <input
                  type="time"
                  className="mt-1 w-full rounded-md border border-white/10 bg-background px-2 py-1.5"
                  value={startT}
                  onChange={(e) => setStartT(e.target.value)}
                />
              </label>
              <label className="text-muted">
                End
                <input
                  type="time"
                  className="mt-1 w-full rounded-md border border-white/10 bg-background px-2 py-1.5"
                  value={endT}
                  onChange={(e) => setEndT(e.target.value)}
                />
              </label>
            </div>
            <label className="text-muted">
              Recurrence
              <select
                className="mt-1 w-full rounded-md border border-white/10 bg-background px-2 py-1.5 text-foreground"
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value)}
              >
                {RECURRENCE_PRESETS.map((p) => (
                  <option key={p.label} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
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
