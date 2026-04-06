"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell, Sparkles, X } from "lucide-react";
import { useMemo } from "react";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { fetchGoogleCalendarStatus, fetchTasks } from "@/lib/api";
import { normalizeYmd } from "@/lib/timeline-utils";
import { cn, isTaskOverdue } from "@/lib/utils";

function localISODate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseTimeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const parts = t.slice(0, 5).split(":");
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

type TrayItem = { kind: string; title: string; detail?: string };

export function NotificationsTray({ open, onClose }: { open: boolean; onClose: () => void }) {
  const userId = useAppUserId();
  const today = useMemo(() => localISODate(), []);

  const tasksQ = useQuery({
    queryKey: ["tasks", userId, "notifications"],
    queryFn: () => fetchTasks(),
    enabled: open && Boolean(userId),
  });

  const googleQ = useQuery({
    queryKey: ["google-cal", userId, "notifications"],
    queryFn: () => fetchGoogleCalendarStatus(),
    enabled: open && Boolean(userId),
  });

  const { actionable, googleDetail } = useMemo(() => {
    const out: TrayItem[] = [];
    const roots = (tasksQ.data ?? []).filter((t) => !t.parentTaskId);
    const overdue = roots.filter((t) => isTaskOverdue(t, today));
    for (const t of overdue.slice(0, 12)) {
      out.push({
        kind: "overdue",
        title: t.title,
        detail: `Scheduled ${t.scheduledDate ?? t.dueDate ?? "—"}`,
      });
    }

    const nowM = new Date().getHours() * 60 + new Date().getMinutes();
    const soon = roots.filter((t) => {
      if (t.status === "done" || t.status === "cancelled") return false;
      if (normalizeYmd(t.scheduledDate) !== today) return false;
      const sm = parseTimeToMinutes(t.scheduledStartTime);
      if (sm == null) return false;
      return sm >= nowM && sm <= nowM + 120;
    });
    for (const t of soon.slice(0, 8)) {
      const block =
        t.scheduledStartTime && t.scheduledEndTime
          ? `${t.scheduledStartTime.slice(0, 5)}–${t.scheduledEndTime.slice(0, 5)}`
          : t.scheduledStartTime?.slice(0, 5);
      out.push({ kind: "soon", title: t.title, detail: block ? `Starts ${block}` : "Starting soon" });
    }

    let g: string | null = null;
    if (googleQ.data?.connected) {
      const lp = googleQ.data.lastGooglePullAt;
      g = lp ? `Last Google import: ${new Date(lp).toLocaleString()}` : "Google Calendar connected — sync from Settings.";
    }

    return { actionable: out, googleDetail: g };
  }, [tasksQ.data, today, googleQ.data]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[65] bg-black/40 md:bg-black/20"
        aria-label="Close notifications"
        onClick={onClose}
      />
      <aside
        className={cn(
          "fixed right-0 top-0 z-[70] flex h-full w-full max-w-sm flex-col border-l border-white/10 bg-surface shadow-2xl",
          "animate-slideInRight"
        )}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Bell size={16} className="text-primary" />
            Notifications
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-muted hover:bg-white/10 hover:text-foreground"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {tasksQ.isLoading && <p className="text-xs text-muted">Loading…</p>}
          {!tasksQ.isLoading && actionable.length === 0 && (
            <div className="mt-8 flex flex-col items-center text-center text-sm text-muted">
              <Sparkles className="mb-2 h-8 w-8 text-primary/40" />
              <p>You&apos;re all caught up ✓</p>
              <p className="mt-3 max-w-[240px] text-[11px] text-muted/70">
                Open the AI dock for suggestions. Use Brain Dump (Ctrl/Cmd+Shift+D) for quick capture.
              </p>
            </div>
          )}
          {!tasksQ.isLoading && actionable.length > 0 && (
            <ul className="space-y-2">
              {actionable.map((it, i) => (
                <li
                  key={`${it.kind}-${i}`}
                  className="rounded-lg border border-white/10 bg-background/40 px-3 py-2 text-xs"
                >
                  <span
                    className={cn(
                      "mr-1.5 inline-block rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide",
                      it.kind === "overdue" && "bg-red-500/20 text-red-200",
                      it.kind === "soon" && "bg-amber-500/20 text-amber-100"
                    )}
                  >
                    {it.kind}
                  </span>
                  <span className="font-medium text-foreground">{it.title}</span>
                  {it.detail && <p className="mt-0.5 text-muted">{it.detail}</p>}
                </li>
              ))}
            </ul>
          )}
          {googleDetail && (
            <p className="mt-4 border-t border-white/10 pt-3 text-[10px] text-muted">{googleDetail}</p>
          )}
        </div>
      </aside>
    </>
  );
}
