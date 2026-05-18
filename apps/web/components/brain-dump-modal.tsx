"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Loader2,
  Mic,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createTask,
  fetchAreas,
  parseDump,
  postBrainDumpLines,
  transcribeAudio,
  type ParsedDumpItem,
} from "@/lib/api";
import { useAppUserId } from "@/hooks/use-app-user-id";

type Energy = ParsedDumpItem["energy"];
type Priority = ParsedDumpItem["priority"];

const ENERGY_CYCLE: Energy[] = ["deep_work", "shallow", "admin", "quick_win"];
const PRIORITY_CYCLE: Priority[] = ["urgent", "high", "normal", "low"];

const ENERGY_LABEL: Record<Energy, string> = {
  deep_work: "Deep",
  shallow: "Shallow",
  admin: "Admin",
  quick_win: "Quick win",
};

const ENERGY_STYLE: Record<Energy, string> = {
  deep_work: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  shallow: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  admin: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  quick_win: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

const PRIORITY_STYLE: Record<Priority, string> = {
  urgent: "bg-red-500/15 text-red-300 border-red-500/30",
  high: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  normal: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  low: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
};

function cycle<T extends string>(list: readonly T[], current: T): T {
  const idx = list.indexOf(current);
  return list[(idx + 1) % list.length]!;
}

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
  const [view, setView] = useState<"raw" | "preview">("raw");
  const [parsedItems, setParsedItems] = useState<ParsedDumpItem[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ─── Speech-to-text (Whisper) ───────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const canRecord =
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  async function startRecording() {
    if (!canRecord) {
      toast.error("Voice capture isn't supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      // Pick the best supported MIME. Chromium → webm/opus, Safari → mp4.
      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];
      const mimeType =
        candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? "";
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        // Always release the mic, even if transcription fails.
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });
        audioChunksRef.current = [];
        if (blob.size === 0) {
          toast.error("No audio captured — try again and speak after the mic light turns on.");
          return;
        }
        setIsTranscribing(true);
        try {
          const { text: transcript } = await transcribeAudio(blob);
          const clean = transcript.trim();
          if (!clean) {
            toast.error("Whisper returned an empty transcript.");
            return;
          }
          // Append on a new line if there's already content, otherwise replace.
          setText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")}\n${clean}` : clean));
          toast.success("Transcribed — review the text, then save or AI-organize.");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        } finally {
          setIsTranscribing(false);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSec(0);
      recordingTimerRef.current = setInterval(
        () => setRecordingSec((s) => s + 1),
        1000
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(
        msg.toLowerCase().includes("permission")
          ? "Microphone permission denied. Allow it in your browser, then try again."
          : `Couldn't start recording: ${msg}`
      );
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  // Stop recording if the modal closes mid-capture or unmounts.
  useEffect(() => {
    if (!open && isRecording) stopRecording();
  }, [open, isRecording]);
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, []);

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
    if (!areasQ.data?.length) return;
    const valid = areasQ.data.some((a) => a.id === areaId);
    if (!areaId || !valid) setAreaId(areasQ.data[0]!.id);
  }, [areasQ.data, areaId]);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => textareaRef.current?.focus());
  }, [open]);

  const lineCount = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean).length;

  // Validate schedule fields — used by both Save and AI organize paths.
  function validatedSchedule():
    | {
        scheduledDate: string | null;
        scheduledStartTime: string | null;
        scheduledEndTime: string | null;
        recurrenceRule: string | null;
      }
    | undefined {
    let safeDate: string | null = scheduledDate || null;
    if (safeDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDate)) {
        toast.error("Invalid date — use the date picker.");
        throw new Error("invalid date");
      }
      const y = Number(safeDate.slice(0, 4));
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
    return safeDate || startT || endT || recurrence
      ? {
          scheduledDate: safeDate,
          scheduledStartTime: st,
          scheduledEndTime: et,
          recurrenceRule: recurrence || null,
        }
      : undefined;
  }

  const saveRawMut = useMutation({
    mutationFn: async () => {
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      const schedule = validatedSchedule();
      return postBrainDumpLines(areaId, lines, schedule);
    },
    onSuccess: (data) => {
      toast.success(`Added ${data.count} task(s) to backlog`);
      invalidateTaskQueries();
      resetAndClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const parseMut = useMutation({
    mutationFn: async () => {
      if (!text.trim()) throw new Error("Type at least one line first.");
      // Schedule validation happens later on save — but parse should still work.
      return parseDump(text);
    },
    onSuccess: (data) => {
      if (!data.draft.length) {
        toast.error("AI returned no items. Try editing your text and retry.");
        return;
      }
      if (data.warning) {
        toast.message("AI was unavailable — used fallback parsing.");
      } else {
        toast.success(`AI organized ${data.draft.length} task(s) — review and confirm`);
      }
      setParsedItems(data.draft);
      setView("preview");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createOrganizedMut = useMutation({
    mutationFn: async () => {
      const schedule = validatedSchedule();
      const results = await Promise.all(
        parsedItems.map((item) =>
          createTask({
            areaId,
            title: item.title.slice(0, 500),
            status: "backlog",
            priority: item.priority,
            energyLevel: item.energy,
            estimatedMinutes: item.estimated_minutes,
            recurrenceRule: schedule?.recurrenceRule ?? null,
            scheduledDate: schedule?.scheduledDate ?? null,
            scheduledStartTime: schedule?.scheduledStartTime ?? null,
            scheduledEndTime: schedule?.scheduledEndTime ?? null,
          })
        )
      );
      return results.length;
    },
    onSuccess: (count) => {
      toast.success(`Created ${count} organized task(s)`);
      invalidateTaskQueries();
      resetAndClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function invalidateTaskQueries() {
    void qc.invalidateQueries({ queryKey: ["tasks"] });
    void qc.invalidateQueries({ queryKey: ["backlog"] });
    void qc.invalidateQueries({ queryKey: ["tasks-today"] });
  }

  function resetAndClose() {
    setText("");
    setScheduledDate("");
    setStartT("");
    setEndT("");
    setRecurrence("");
    setAreaId("");
    setParsedItems([]);
    setView("raw");
    onClose();
  }

  function updateItem(idx: number, patch: Partial<ParsedDumpItem>) {
    setParsedItems((items) => items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeItem(idx: number) {
    setParsedItems((items) => items.filter((_, i) => i !== idx));
  }

  if (!open) return null;

  const inPreview = view === "preview";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 animate-fadeIn"
      role="dialog"
      aria-modal
      onClick={resetAndClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-surface p-5 shadow-2xl animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {inPreview ? (
              <button
                type="button"
                className="rounded-lg p-1 text-muted hover:bg-white/10 hover:text-foreground"
                onClick={() => setView("raw")}
                title="Back to text"
              >
                <ArrowLeft size={16} />
              </button>
            ) : (
              <Lightbulb size={18} className="text-primary" />
            )}
            <h2 className="font-display text-xl text-foreground">
              {inPreview ? "Review parsed tasks" : "Brain dump"}
            </h2>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-muted hover:bg-white/10 hover:text-foreground"
            onClick={resetAndClose}
          >
            <X size={16} />
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">
          {inPreview
            ? "Click the badges to change energy or priority. Edit titles inline."
            : "One thought per line — save raw to backlog, or let AI organize first."}
        </p>

        {!inPreview && (
          <>
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
                  <option value="">No areas yet — create one in Settings</option>
                ) : (
                  (areasQ.data ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))
                )}
              </select>
            )}
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[11px] text-muted">
                Type or dictate your list — one thought per line.
              </span>
              {canRecord && (
                <button
                  type="button"
                  onClick={() => (isRecording ? stopRecording() : startRecording())}
                  disabled={isTranscribing}
                  className={
                    isRecording
                      ? "inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/15 px-2.5 py-1 text-[11px] font-medium text-red-300 hover:bg-red-500/25 transition-colors"
                      : "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-background px-2.5 py-1 text-[11px] text-muted hover:text-foreground hover:bg-white/5 transition-colors disabled:opacity-40"
                  }
                  title={isRecording ? "Stop recording" : "Record voice memo"}
                  aria-label={isRecording ? "Stop recording" : "Record voice memo"}
                  aria-pressed={isRecording}
                >
                  {isTranscribing ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      Transcribing…
                    </>
                  ) : isRecording ? (
                    <>
                      <Square size={11} className="fill-red-300 text-red-300 animate-pulse" />
                      Stop · {Math.floor(recordingSec / 60)}:
                      {String(recordingSec % 60).padStart(2, "0")}
                    </>
                  ) : (
                    <>
                      <Mic size={12} />
                      Record
                    </>
                  )}
                </button>
              )}
            </div>
            <textarea
              ref={textareaRef}
              className="mt-2 min-h-[200px] w-full rounded-lg border border-white/10 bg-background p-3 text-sm text-foreground placeholder:text-muted/50 resize-none"
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
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-white/5 transition-colors"
                onClick={resetAndClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
                disabled={!userId || !areaId || parseMut.isPending || lineCount === 0}
                onClick={() => parseMut.mutate()}
                title="Use AI to infer energy, priority, and time estimate per item"
              >
                {parseMut.isPending ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                    Organizing…
                  </span>
                ) : (
                  <>
                    <Sparkles size={14} />
                    AI organize
                  </>
                )}
              </button>
              <button
                type="button"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-40 hover:bg-primary-hover transition-colors"
                disabled={!userId || !areaId || saveRawMut.isPending || lineCount === 0}
                onClick={() => saveRawMut.mutate()}
              >
                {saveRawMut.isPending ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Saving…
                  </span>
                ) : (
                  `Save ${lineCount} to backlog`
                )}
              </button>
            </div>
          </>
        )}

        {inPreview && (
          <>
            <div className="mt-4 max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {parsedItems.length === 0 ? (
                <p className="rounded-lg border border-white/10 bg-background/40 p-3 text-xs text-muted">
                  All items removed. Go back to add more.
                </p>
              ) : (
                parsedItems.map((item, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-white/10 bg-background/40 p-3"
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="text"
                        className="flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-foreground focus:border-white/15 focus:bg-background focus:outline-none"
                        value={item.title}
                        onChange={(e) => updateItem(idx, { title: e.target.value })}
                      />
                      <button
                        type="button"
                        className="rounded-md p-1.5 text-muted hover:bg-red-500/10 hover:text-red-300"
                        onClick={() => removeItem(idx)}
                        title="Remove this item"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                      <button
                        type="button"
                        className={`rounded-full border px-2 py-0.5 transition-colors ${ENERGY_STYLE[item.energy]}`}
                        onClick={() =>
                          updateItem(idx, { energy: cycle(ENERGY_CYCLE, item.energy) })
                        }
                        title="Click to cycle energy"
                      >
                        {ENERGY_LABEL[item.energy]}
                      </button>
                      <button
                        type="button"
                        className={`rounded-full border px-2 py-0.5 capitalize transition-colors ${PRIORITY_STYLE[item.priority]}`}
                        onClick={() =>
                          updateItem(idx, { priority: cycle(PRIORITY_CYCLE, item.priority) })
                        }
                        title="Click to cycle priority"
                      >
                        {item.priority}
                      </button>
                      <label className="flex items-center gap-1 text-muted">
                        <input
                          type="number"
                          min={1}
                          max={600}
                          className="w-14 rounded-md border border-white/10 bg-background px-1.5 py-0.5 text-right text-foreground"
                          value={item.estimated_minutes}
                          onChange={(e) =>
                            updateItem(idx, {
                              estimated_minutes: Math.max(1, Number(e.target.value) || 1),
                            })
                          }
                        />
                        min
                      </label>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-white/5 transition-colors"
                onClick={() => setView("raw")}
              >
                Back
              </button>
              <button
                type="button"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-40 hover:bg-primary-hover transition-colors"
                disabled={
                  !userId ||
                  !areaId ||
                  createOrganizedMut.isPending ||
                  parsedItems.length === 0
                }
                onClick={() => createOrganizedMut.mutate()}
              >
                {createOrganizedMut.isPending ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Creating…
                  </span>
                ) : (
                  `Create ${parsedItems.length} task${parsedItems.length !== 1 ? "s" : ""}`
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
