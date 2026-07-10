"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Download, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import {
  createAccomplishment,
  deleteAccomplishment,
  fetchAccomplishments,
  updateAccomplishment,
  type AccomplishmentRow,
} from "@/lib/api";

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function monthKey(ymd: string): string {
  return ymd.slice(0, 7);
}

function formatMonth(key: string): string {
  const d = new Date(`${key}-01T12:00:00`);
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function parseSkills(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
}

type FormState = {
  id: string | null;
  taskId: string | null;
  date: string;
  title: string;
  impact: string;
  metric: string;
  skills: string;
};

const EMPTY_FORM: FormState = {
  id: null,
  taskId: null,
  date: todayYmd(),
  title: "",
  impact: "",
  metric: "",
  skills: "",
};

function toCsv(rows: AccomplishmentRow[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = ["Date", "What you did", "Impact", "Metric", "Skills"].map(esc).join(",");
  const lines = rows.map((r) =>
    [
      r.date,
      r.title,
      r.impact ?? "",
      r.metric ?? "",
      (r.skills ?? []).join("; "),
    ]
      .map((v) => esc(String(v)))
      .join(",")
  );
  return [header, ...lines].join("\r\n");
}

function toMarkdown(rows: AccomplishmentRow[]): string {
  const out: string[] = ["# Accomplishments", ""];
  const groups = new Map<string, AccomplishmentRow[]>();
  for (const r of rows) {
    const k = monthKey(r.date);
    const bucket = groups.get(k);
    if (bucket) bucket.push(r);
    else groups.set(k, [r]);
  }
  for (const [k, items] of groups) {
    out.push(`## ${formatMonth(k)}`, "");
    for (const r of items) {
      out.push(`- **${r.title}** _(${formatDate(r.date)})_`);
      if (r.impact) out.push(`  - Impact: ${r.impact}`);
      if (r.metric) out.push(`  - Proof: ${r.metric}`);
      if (r.skills?.length) out.push(`  - Skills: ${r.skills.join(", ")}`);
    }
    out.push("");
  }
  return `${out.join("\n").trim()}\n`;
}

function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function AccomplishmentsPanel() {
  const userId = useAppUserId();
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const consumedPrefill = useRef(false);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const titleRef = useRef<HTMLInputElement>(null);

  const listQ = useQuery({
    queryKey: ["accomplishments", userId],
    queryFn: fetchAccomplishments,
    enabled: Boolean(userId),
  });
  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);

  // Prefill from a "Log win" nudge: /review?view=accomplishments&title=…&taskId=…
  useEffect(() => {
    if (consumedPrefill.current) return;
    const title = searchParams.get("title");
    const taskId = searchParams.get("taskId");
    if (!title && !taskId) return;
    consumedPrefill.current = true;
    setForm({ ...EMPTY_FORM, date: todayYmd(), title: title ?? "", taskId: taskId || null });
    setFormOpen(true);
    // Drop the prefill params so a refresh doesn't re-open the form.
    router.replace("/review?view=accomplishments");
    setTimeout(() => titleRef.current?.focus(), 80);
  }, [searchParams, router]);

  const saveMut = useMutation({
    mutationFn: async (state: FormState) => {
      const payload = {
        date: state.date,
        title: state.title.trim(),
        impact: state.impact.trim() || null,
        metric: state.metric.trim() || null,
        skills: parseSkills(state.skills),
      };
      if (state.id) return updateAccomplishment(state.id, payload);
      return createAccomplishment({ ...payload, taskId: state.taskId || null });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accomplishments", userId] });
      setForm(EMPTY_FORM);
      setFormOpen(false);
      toast.success("Accomplishment saved.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAccomplishment(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accomplishments", userId] });
      toast.success("Accomplishment removed.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const grouped = useMemo(() => {
    const map = new Map<string, AccomplishmentRow[]>();
    for (const r of rows) {
      const k = monthKey(r.date);
      const bucket = map.get(k);
      if (bucket) bucket.push(r);
      else map.set(k, [r]);
    }
    return Array.from(map.entries());
  }, [rows]);

  function openNew() {
    setForm({ ...EMPTY_FORM, date: todayYmd() });
    setFormOpen(true);
    setTimeout(() => titleRef.current?.focus(), 60);
  }

  function openEdit(r: AccomplishmentRow) {
    setForm({
      id: r.id,
      taskId: r.taskId,
      date: r.date,
      title: r.title,
      impact: r.impact ?? "",
      metric: r.metric ?? "",
      skills: (r.skills ?? []).join(", "),
    });
    setFormOpen(true);
    setTimeout(() => titleRef.current?.focus(), 60);
  }

  function submit() {
    if (!form.title.trim()) {
      toast.error("Add a short line for what you did.");
      titleRef.current?.focus();
      return;
    }
    saveMut.mutate(form);
  }

  return (
    <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[minmax(0,1fr)_300px]">
      {/* Left: log form + list */}
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-[26px] font-normal leading-tight text-[var(--ink)]">Accomplishments</h1>
            <p className="mt-1 text-sm text-muted">
              What you did, the impact, and the proof. Your record for reviews, CVs, and promotions.
            </p>
          </div>
          {!formOpen && (
            <button
              type="button"
              onClick={openNew}
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[var(--ink-btn-bg)] px-[18px] py-[9px] text-[13px] font-semibold text-[var(--ink-btn-fg)] transition-opacity hover:opacity-85"
            >
              <Plus size={15} />
              Log
            </button>
          )}
        </div>

        {formOpen && (
          <div className="mt-4 rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-5 shadow-[var(--card-shadow)] animate-fadeIn">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-[var(--ink)]">
                {form.id ? "Edit accomplishment" : "Log an accomplishment"}
              </p>
              <button
                type="button"
                onClick={() => {
                  setForm(EMPTY_FORM);
                  setFormOpen(false);
                }}
                className="rounded-full p-1 text-muted hover:bg-[var(--teal-a08)] hover:text-[var(--ink)]"
                aria-label="Close form"
              >
                <X size={15} />
              </button>
            </div>

            <div className="mt-3 grid gap-3">
              <div className="grid gap-3 sm:grid-cols-[130px_1fr]">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Date
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-[var(--hairline)] bg-background px-3 py-2 text-sm font-normal text-[var(--ink)]"
                  />
                </label>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  What you did
                  <input
                    ref={titleRef}
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="Led the Q3 planning meeting"
                    className="mt-1 w-full rounded-xl border border-[var(--hairline)] bg-background px-3 py-2 text-sm font-normal text-[var(--ink)] placeholder:text-[var(--muted-soft)]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        submit();
                      }
                    }}
                  />
                </label>
              </div>

              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Impact <span className="font-normal normal-case text-muted/85">— what changed because of it</span>
                <textarea
                  value={form.impact}
                  onChange={(e) => setForm((f) => ({ ...f, impact: e.target.value }))}
                  placeholder="Team had clear priorities before the quarter started"
                  rows={2}
                  className="mt-1 w-full resize-none rounded-xl border border-[var(--hairline)] bg-background px-3 py-2 text-sm font-normal text-[var(--ink)] placeholder:text-[var(--muted-soft)]"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Proof / metric
                  <input
                    value={form.metric}
                    onChange={(e) => setForm((f) => ({ ...f, metric: e.target.value }))}
                    placeholder="Roadmap approved on time"
                    className="mt-1 w-full rounded-xl border border-[var(--hairline)] bg-background px-3 py-2 text-sm font-normal text-[var(--ink)] placeholder:text-[var(--muted-soft)]"
                  />
                </label>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Skills <span className="font-normal normal-case text-muted/85">— comma separated</span>
                  <input
                    value={form.skills}
                    onChange={(e) => setForm((f) => ({ ...f, skills: e.target.value }))}
                    placeholder="Project management, Communication"
                    className="mt-1 w-full rounded-xl border border-[var(--hairline)] bg-background px-3 py-2 text-sm font-normal text-[var(--ink)] placeholder:text-[var(--muted-soft)]"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setForm(EMPTY_FORM);
                    setFormOpen(false);
                  }}
                  className="rounded-full border border-[var(--hairline)] px-[18px] py-[9px] text-[13px] text-muted transition-colors hover:text-[var(--ink)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={saveMut.isPending}
                  className="rounded-full bg-[var(--ink-btn-bg)] px-5 py-[9px] text-[13px] font-semibold text-[var(--ink-btn-fg)] transition-opacity hover:opacity-85 disabled:opacity-60"
                >
                  {saveMut.isPending ? "Saving…" : form.id ? "Save changes" : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* List */}
        <div className="mt-6">
          {listQ.isLoading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--hairline)] p-8 text-center">
              <Award size={28} className="mx-auto mb-3 text-[var(--teal)]" />
              <p className="text-sm font-medium text-[var(--ink)]">No accomplishments yet</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-muted">
                Every time you finish something that mattered, log it here. In a few weeks
                you&apos;ll have proof of your progress ready for any review or application.
              </p>
              {!formOpen && (
                <button
                  type="button"
                  onClick={openNew}
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-[var(--ink-btn-bg)] px-[18px] py-[9px] text-[13px] font-semibold text-[var(--ink-btn-fg)] transition-opacity hover:opacity-85"
                >
                  <Plus size={15} />
                  Log your first one
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {grouped.map(([month, items]) => (
                <section key={month}>
                  <h2 className="mb-2.5 font-display text-[19px] font-normal italic text-[var(--ink)]">
                    {formatMonth(month)}
                  </h2>
                  <div className="space-y-2">
                    {items.map((r) => (
                      <article
                        key={r.id}
                        className="group rounded-xl border border-[var(--hairline)] bg-[var(--card)] p-4 shadow-[var(--card-shadow)]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[var(--ink)]">{r.title}</p>
                            <p className="mt-0.5 text-[11px] text-muted">{formatDate(r.date)}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1 hover-actions opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            <button
                              type="button"
                              onClick={() => openEdit(r)}
                              className="rounded-full p-1.5 text-muted hover:bg-[var(--teal-a08)] hover:text-[var(--ink)]"
                              aria-label="Edit"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteMut.mutate(r.id)}
                              className="rounded-full p-1.5 text-muted hover:bg-danger/10 hover:text-danger"
                              aria-label="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                        {r.impact && (
                          <p className="mt-2 text-xs leading-relaxed text-[var(--ink)]">
                            <span className="text-muted">Impact — </span>
                            {r.impact}
                          </p>
                        )}
                        {r.metric && (
                          <p className="mt-1 text-xs leading-relaxed text-[var(--ink)]">
                            <span className="text-muted">Proof — </span>
                            {r.metric}
                          </p>
                        )}
                        {r.skills && r.skills.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {r.skills.map((s) => (
                              <span
                                key={s}
                                className="rounded-full border border-[var(--hairline)] bg-[var(--teal-a08)] px-2 py-0.5 text-[11px] text-muted"
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: margin notes — summary + export + tip */}
      <aside className="flex flex-col gap-7 lg:border-l lg:border-[var(--hairline-soft)] lg:pl-8">
        <div>
          <h3 className="font-display text-[19px] font-normal italic text-[var(--ink)]">This record</h3>
          <p className="mt-2.5 font-display text-[34px] leading-none text-[var(--ink)]">
            {rows.length}
            <span className="text-xl text-muted"> {rows.length === 1 ? "win" : "wins"}</span>
          </p>
          <p className="mt-1 text-[13px] text-muted">logged so far</p>
          <div className="mt-4 flex flex-col items-start gap-2">
            <button
              type="button"
              disabled={rows.length === 0}
              onClick={() => downloadFile("accomplishments.md", toMarkdown(rows), "text/markdown;charset=utf-8")}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--hairline)] px-[18px] py-[9px] text-[13px] font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--teal-a08)] disabled:opacity-40"
            >
              <Download size={14} />
              Export Markdown
            </button>
            <button
              type="button"
              disabled={rows.length === 0}
              onClick={() => downloadFile("accomplishments.csv", toCsv(rows), "text/csv;charset=utf-8")}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--hairline)] px-[18px] py-[9px] text-[13px] font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--teal-a08)] disabled:opacity-40"
            >
              <Download size={14} />
              Export CSV
            </button>
          </div>
        </div>

        <div>
          <h3 className="font-display text-[19px] font-normal italic text-[var(--ink)]">Tip</h3>
          <p className="mt-2.5 text-[13px] leading-relaxed text-muted">
            Finish a high-priority task on{" "}
            <span className="text-[var(--ink)]">Today</span> and you&apos;ll be offered a
            one-tap way to log it here — so proof builds itself as you work.
          </p>
        </div>
      </aside>
    </div>
  );
}
