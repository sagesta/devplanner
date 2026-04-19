"use client";

import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { toast } from "sonner";
import { createTask } from "@/lib/api";
import { toYMD, RECURRENCE_PRESETS } from "@/lib/timeline-utils";

function toPgTime(v: string): string | null {
  if (!v) return null;
  return v.length === 5 ? `${v}:00` : v;
}

export function InlineAddTask({
  userId,
  areaId,
  sprintId,
  status,
  onDone,
}: {
  userId: string;
  areaId: string;
  sprintId: string;
  status: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [more, setMore] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("");
  const [startT, setStartT] = useState("");
  const [endT, setEndT] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const m = useMutation({
    mutationFn: () =>
      createTask({
        areaId,
        sprintId,
        title: title.trim(),
        status,
        ...(scheduledDate ? { scheduledDate } : {}),
        scheduledStartTime: toPgTime(startT),
        scheduledEndTime: toPgTime(endT),
        recurrenceRule: recurrence || null,
      }),
    onSuccess: () => {
      setTitle("");
      setScheduledDate("");
      setStartT("");
      setEndT("");
      setRecurrence("");
      void qc.invalidateQueries({ queryKey: ["sprintTasks"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["tasks-today", userId] });
      inputRef.current?.focus();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="inline-add-container animate-slideIn space-y-2 rounded-md border border-white/10 bg-background/40 p-2">
      <div className="flex gap-1.5">
        <input
          ref={inputRef}
          autoFocus
          className="flex-1 rounded-md border border-white/10 bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted/50"
          placeholder="Task title…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim()) m.mutate();
            if (e.key === "Escape") onDone();
          }}
          onBlur={(e) => {
             // Let close button or other inner actions fire first before blindly closing/mutating
             if (e.relatedTarget && (e.relatedTarget as HTMLElement).closest('.inline-add-container')) return;
             if (title.trim() && !m.isPending) m.mutate();
          }}
        />
        <button
          type="button"
          onClick={() => onDone()}
          className="rounded p-1 text-muted hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>
      <button
        type="button"
        className="flex w-full items-center justify-center gap-1 text-[10px] text-muted hover:text-foreground"
        onClick={() =>
          setMore((v) => {
            const next = !v;
            if (next) setScheduledDate((d) => d || toYMD(new Date()));
            return next;
          })
        }
      >
        {more ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        Date &amp; time (optional)
      </button>
      {more && (
        <div className="grid gap-2 text-[10px]">
          <label className="text-muted">
            Day
            <input
              type="date"
              className="mt-0.5 w-full rounded border border-white/10 bg-background px-1.5 py-1 text-foreground"
              defaultValue={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
            />
          </label>
          <div className="grid grid-cols-2 gap-1">
            <label className="text-muted">
              Start
              <input
                type="time"
                className="mt-0.5 w-full rounded border border-white/10 bg-background px-1.5 py-1 text-foreground"
                value={startT}
                onChange={(e) => setStartT(e.target.value)}
              />
            </label>
            <label className="text-muted">
              End
              <input
                type="time"
                className="mt-0.5 w-full rounded border border-white/10 bg-background px-1.5 py-1 text-foreground"
                value={endT}
                onChange={(e) => setEndT(e.target.value)}
              />
            </label>
          </div>
          <label className="text-muted">
            Recurrence
            <select
              className="mt-0.5 w-full rounded border border-white/10 bg-background px-1.5 py-1 text-foreground"
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
    </div>
  );
}
