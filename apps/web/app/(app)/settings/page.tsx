"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, Download, Layers, Settings as SettingsIcon, Cpu, Zap } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useState } from "react";
import { toast } from "sonner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import {
  fetchAiConfig,
  fetchAiLogs,
  fetchAreas,
  patchArea,
  fetchFocusExport,
  fetchGoogleCalendarStatus,
  getGoogleOAuthStartUrl,
  postCaldavMkcol,
  postCaldavPullNow,
  postCaldavPullQueued,
  postGoogleCalendarDisconnect,
  postGoogleCalendarPullNow,
  postGoogleCalendarPullQueued,
} from "@/lib/api";
import { Skeleton } from "@/lib/skeleton";
import {
  LS_AI_BUDGET,
  LS_AI_ENERGY_SUGGEST,
  LS_CHAT_MODEL,
  LS_FOCUS_MODE,
  LS_POMO_LONG,
  LS_POMO_SHORT,
  LS_POMO_WORK,
} from "@/lib/planner-prefs";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "general", label: "General", icon: SettingsIcon, hint: "Account info and app defaults" },
  { key: "areas", label: "Areas", icon: Layers, hint: "Life areas and weekly time budgets" },
  { key: "calendar", label: "Calendar", icon: Calendar, hint: "Sync tasks with Google Calendar or CalDAV" },
  { key: "focus", label: "Focus", icon: Zap, hint: "Pomodoro timers and distraction settings" },
  { key: "ai", label: "AI", icon: Cpu, hint: "Chat model and assistant behavior" },
] as const;

/** Same key the AI chat dock reads for its "Can edit" writes toggle. */
const LS_AI_WRITES = "devplanner.aiWritesEnabled";

/* Daybook building blocks */
const CARD = "rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-6 shadow-[var(--card-shadow)]";
const CARD_TITLE = "font-display text-[22px] text-foreground";
const LINK = "text-[13px] text-[var(--teal)] transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline";
const LINK_MUTED = "text-[13px] text-muted transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline";
const INK_BTN = "inline-flex items-center gap-1.5 rounded-full bg-[var(--ink-btn-bg)] px-5 py-2.5 text-[13px] font-semibold text-[var(--ink-btn-fg)] transition-opacity hover:opacity-85 disabled:opacity-40";
const BADGE_SUCCESS = "rounded-full border border-[var(--success-border)] bg-[var(--success-bg)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--success-text)]";
const BADGE_MUTED = "rounded-full border border-[var(--hairline)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted";
const MONO_FIELD = "rounded-lg border border-[var(--hairline)] bg-background px-3 py-2.5 font-mono text-[13px] text-foreground";
const INPUT = "rounded-lg border border-[var(--hairline)] bg-background px-3 py-2 text-sm text-foreground focus:border-[var(--teal)] focus:outline-none";
const CODE_CHIP = "rounded bg-background px-1 font-mono text-xs";

export default function SettingsPage() {
  const { user } = useUser();
  const userId = useAppUserId();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<string>(() => searchParams.get("tab") ?? "general");
  const [exporting, setExporting] = useState(false);
  const [calBusy, setCalBusy] = useState<"mkcol" | "pull" | "queue" | null>(null);
  const [googleBusy, setGoogleBusy] = useState<"pull" | "queue" | "disconnect" | null>(null);
  const [pomoWork, setPomoWork] = useState("25");
  const [pomoShort, setPomoShort] = useState("5");
  const [pomoLong, setPomoLong] = useState("15");
  const [focusModeDef, setFocusModeDef] = useState(false);
  const [aiModel, setAiModel] = useState("");
  const [aiBudget, setAiBudget] = useState(false);
  const [aiEnergySuggest, setAiEnergySuggest] = useState(true);
  const [aiWrites, setAiWrites] = useState(false);
  const [calPrimaryOnly, setCalPrimaryOnly] = useState(true);

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "general" || t === "areas" || t === "calendar" || t === "focus" || t === "ai") setTab(t);
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.get("google") === "connected") {
      toast.success("Google Calendar connected");
      void qc.invalidateQueries({ queryKey: ["google-cal", userId] });
    }
    const ge = searchParams.get("google_error");
    if (ge) toast.error(decodeURIComponent(ge));
  }, [searchParams, qc, userId]);

  // AI tab: read localStorage before paint so the model select does not flash the server default first.
  useLayoutEffect(() => {
    if (typeof window === "undefined" || tab !== "ai") return;
    setAiModel(localStorage.getItem(LS_CHAT_MODEL) ?? "");
    setAiBudget(localStorage.getItem(LS_AI_BUDGET) === "1");
    setAiEnergySuggest(localStorage.getItem(LS_AI_ENERGY_SUGGEST) !== "0");
    setAiWrites(localStorage.getItem(LS_AI_WRITES) === "1");
  }, [tab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (tab === "focus") {
      setPomoWork(localStorage.getItem(LS_POMO_WORK) ?? "25");
      setPomoShort(localStorage.getItem(LS_POMO_SHORT) ?? "5");
      setPomoLong(localStorage.getItem(LS_POMO_LONG) ?? "15");
      setFocusModeDef(localStorage.getItem(LS_FOCUS_MODE) === "1");
    }
    if (tab === "calendar") {
      setCalPrimaryOnly(localStorage.getItem("devplanner.googleImportPrimaryOnly") !== "0");
    }
  }, [tab]);

  const logsQ = useQuery({
    queryKey: ["ai-logs", userId],
    queryFn: () => fetchAiLogs(40),
    enabled: Boolean(userId) && tab === "ai",
  });

  const aiConfigQ = useQuery({
    queryKey: ["ai-config"],
    queryFn: () => fetchAiConfig(),
    enabled: tab === "ai",
    // Override Providers staleTime (30s): server key / model list must not look fresh while outdated.
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: "always",
  });

  const googleQ = useQuery({
    queryKey: ["google-cal", userId],
    queryFn: () => fetchGoogleCalendarStatus(),
    enabled: Boolean(userId),
  });

  async function downloadFocus() {
    if (!userId) return;
    setExporting(true);
    try {
      const data = await fetchFocusExport();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `focus-export-${data.date ?? "today"}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Downloaded Focus export JSON");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setExporting(false);
    }
  }

  async function runMkcol() {
    setCalBusy("mkcol");
    try {
      const r = await postCaldavMkcol();
      if (r.ok) toast.success(r.message ?? "Calendar folder ready");
      else toast.error(r.error ?? "MKCOL failed");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCalBusy(null);
    }
  }

  async function runPullNow() {
    if (!userId) return;
    setCalBusy("pull");
    try {
      const r = await postCaldavPullNow();
      if (!r.ok) {
        toast.error("Pull failed");
        return;
      }
      const { stats } = r;
      toast.success(
        `Imported ${stats.imported}, updated ${stats.updated}, removed/cancelled ${stats.removed}, skipped ${stats.skipped}`
      );
      if (stats.errors.length) {
        toast.error(stats.errors.slice(0, 2).join(" · "));
      }
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCalBusy(null);
    }
  }

  async function queuePull() {
    if (!userId) return;
    setCalBusy("queue");
    try {
      const r = await postCaldavPullQueued();
      if (r.ok && r.queued) toast.success("Pull queued — ensure the worker is running");
      else toast.error(r.error ?? "Could not queue pull");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCalBusy(null);
    }
  }

  function connectGoogle() {
    if (!userId) return;
    window.location.href = getGoogleOAuthStartUrl();
  }

  async function disconnectGoogle() {
    if (!userId) return;
    setGoogleBusy("disconnect");
    try {
      await postGoogleCalendarDisconnect();
      toast.success("Disconnected Google Calendar");
      void qc.invalidateQueries({ queryKey: ["google-cal", userId] });
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
    } catch (e) {
      toast.error(String(e));
    } finally {
      setGoogleBusy(null);
    }
  }

  async function googlePullNow() {
    if (!userId) return;
    setGoogleBusy("pull");
    try {
      const r = await postGoogleCalendarPullNow();
      if (!r.ok) {
        toast.error("Google pull failed");
        return;
      }
      const { stats } = r;
      toast.success(
        `Google: imported ${stats.imported}, updated ${stats.updated}, removed ${stats.removed}, skipped ${stats.skipped}`
      );
      if (stats.errors.length) toast.error(stats.errors.slice(0, 2).join(" · "));
      void qc.invalidateQueries({ queryKey: ["tasks", userId] });
    } catch (e) {
      toast.error(String(e));
    } finally {
      setGoogleBusy(null);
    }
  }

  async function googleQueuePull() {
    if (!userId) return;
    setGoogleBusy("queue");
    try {
      const r = await postGoogleCalendarPullQueued();
      if (r.ok && r.queued) toast.success("Google pull queued — ensure the worker is running");
      else toast.error("Could not queue Google pull");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setGoogleBusy(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-6 pb-16">
      {/* ── Daybook header ─────────────────────────────────────────── */}
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--teal)]">
          Configuration
        </p>
        <h1 className="mt-1.5 font-display text-[32px] leading-[1.05] text-foreground md:text-[52px]">
          Settings
        </h1>
      </header>

      <div className="grid items-start gap-8 md:grid-cols-[220px_minmax(0,1fr)] md:gap-12">
        {/* ── Tab list ───────────────────────────────────────────── */}
        <nav className="flex flex-col gap-0.5">
          {TABS.map(({ key, label, hint }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "rounded-[10px] px-3.5 py-2.5 text-left transition-colors",
                tab === key ? "bg-[var(--teal-a12)]" : "hover:bg-[var(--teal-a08)]"
              )}
            >
              <p
                className={cn(
                  "text-sm",
                  tab === key ? "font-semibold text-[var(--ink)]" : "text-muted"
                )}
              >
                {label}
              </p>
              <p className="mt-px text-xs text-[var(--muted-soft)]">{hint}</p>
            </button>
          ))}
        </nav>

        {/* ── Panels ─────────────────────────────────────────────── */}
        <div className="animate-fadeIn flex min-w-0 flex-col gap-5" key={tab}>
          {tab === "general" && (
            <section className={CARD}>
              <h2 className={CARD_TITLE}>General</h2>
              <p className="mt-3 text-[13px] leading-relaxed text-muted">
                Your daily capacity is derived from the weekly hour targets you set in{" "}
                <button
                  type="button"
                  className="font-medium text-[var(--teal)] hover:underline"
                  onClick={() => setTab("areas")}
                >
                  Settings → Areas
                </button>
                . The AI assistant uses these limits when suggesting a schedule.
              </p>
              <p className="mt-3 text-[13px] leading-relaxed text-muted">
                <strong className="text-foreground">Theme:</strong> use the Sun / Moon control in the top bar to switch
                light and dark mode.
              </p>
              <div className="mt-4 rounded-lg border border-[var(--hairline-soft)] bg-background p-3 text-xs text-muted">
                <p>
                  Signed in as{" "}
                  <span className="text-foreground">{user?.primaryEmailAddress?.emailAddress ?? "—"}</span>
                </p>
              </div>
            </section>
          )}

          {tab === "areas" && <AreasSection userId={userId} />}

          {tab === "calendar" && (
            <>
              <section className={CARD}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className={CARD_TITLE}>Google Calendar</h2>
                    <p className="mt-1 text-[13px] text-muted">
                      {googleQ.data?.connected
                        ? `Connected · calendar ${googleQ.data.calendarId ?? "primary"}`
                        : "Two-way sync for tasks with a scheduled or due date"}
                    </p>
                  </div>
                  {googleQ.data &&
                    (googleQ.data.connected ? (
                      <span className={BADGE_SUCCESS}>Connected</span>
                    ) : (
                      <span className={BADGE_MUTED}>Not connected</span>
                    ))}
                </div>
                <p className="mt-4 text-[13px] leading-relaxed text-muted">
                  Connect your Google account to sync tasks that have a <strong>scheduled date</strong> or{" "}
                  <strong>due date</strong> with your primary Google calendar (two-way: edits in DevPlanner push via
                  the worker; pull imports changes from Google). Set <code className={CODE_CHIP}>GOOGLE_*</code> and{" "}
                  <code className={CODE_CHIP}>WEB_APP_URL</code> in the API <code className={CODE_CHIP}>.env</code> —
                  see <code className={CODE_CHIP}>.env.example</code>.
                </p>
                {googleQ.isLoading && <p className="mt-3 text-xs text-muted">Loading connection status…</p>}
                {googleQ.data && (
                  <div className="mt-4 space-y-1.5 text-[13px] text-muted">
                    <p>
                      API OAuth:{" "}
                      <span className="text-foreground">
                        {googleQ.data.oauthConfigured ? "configured" : "not configured"}
                      </span>
                      {" · "}
                      Account:{" "}
                      <span className="text-foreground">
                        {googleQ.data.connected ? "connected" : "not connected"}
                      </span>
                    </p>
                    {googleQ.data.connected && (
                      <>
                        <p>
                          Last import:{" "}
                          <span className="text-foreground">
                            {googleQ.data.lastGooglePullAt
                              ? new Date(googleQ.data.lastGooglePullAt).toLocaleString()
                              : "— (run Pull now)"}
                          </span>
                        </p>
                        <p className="text-xs text-[var(--muted-soft)]">
                          Link updated:{" "}
                          {googleQ.data.linkUpdatedAt
                            ? new Date(googleQ.data.linkUpdatedAt).toLocaleString()
                            : "—"}
                        </p>
                      </>
                    )}
                    {!googleQ.data.oauthConfigured && (
                      <p>
                        Add Google OAuth credentials and redirect URI{" "}
                        <code className={cn(CODE_CHIP, "text-foreground")}>…/api/sync/google/callback</code> in Google
                        Cloud Console.
                      </p>
                    )}
                  </div>
                )}
                {!googleQ.data?.connected && (
                  <div className="mt-5">
                    <button
                      type="button"
                      disabled={
                        !userId ||
                        googleBusy !== null ||
                        googleQ.isLoading ||
                        (googleQ.isFetched && !googleQ.data?.oauthConfigured)
                      }
                      className={INK_BTN}
                      onClick={() => connectGoogle()}
                    >
                      Connect Google Calendar
                    </button>
                  </div>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <button
                    type="button"
                    disabled={!userId || !googleQ.data?.connected || googleBusy !== null}
                    className={LINK}
                    onClick={() => void googlePullNow()}
                  >
                    {googleBusy === "pull" ? "Pulling…" : "Pull now"}
                  </button>
                  <button
                    type="button"
                    disabled={!userId || !googleQ.data?.connected || googleBusy !== null}
                    className={LINK}
                    onClick={() => void googleQueuePull()}
                  >
                    {googleBusy === "queue" ? "Queuing…" : "Queue background sync"}
                  </button>
                  <button
                    type="button"
                    disabled={!userId || !googleQ.data?.connected || googleBusy !== null}
                    className={LINK_MUTED}
                    onClick={() => void disconnectGoogle()}
                  >
                    {googleBusy === "disconnect" ? "Disconnecting…" : "Disconnect"}
                  </button>
                </div>
                {googleQ.data && (
                  <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-[13px] text-muted">
                    <input
                      type="checkbox"
                      className="rounded accent-[var(--teal)]"
                      checked={calPrimaryOnly}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setCalPrimaryOnly(on);
                        localStorage.setItem("devplanner.googleImportPrimaryOnly", on ? "1" : "0");
                      }}
                    />
                    Only sync the primary calendar (multi-calendar picker coming later)
                  </label>
                )}
              </section>

              <section className={CARD}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className={CARD_TITLE}>CalDAV</h2>
                    <p className="mt-1 text-[13px] text-muted">Apple Calendar, Radicale, and friends</p>
                  </div>
                  <span className={BADGE_MUTED}>Optional</span>
                </div>
                <p className="mt-4 text-[13px] leading-relaxed text-muted">
                  Tasks with a <strong>scheduled date</strong> or <strong>due date</strong> sync as VEVENT{" "}
                  <code className={CODE_CHIP}>.ics</code> files to a CalDAV collection (e.g. Radicale from{" "}
                  <code className={CODE_CHIP}>docker compose</code> on port 5232). Run{" "}
                  <code className={CODE_CHIP}>npm run worker</code> with Redis so jobs run.
                </p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-muted">
                  <li>
                    In API <code className={CODE_CHIP}>.env</code>: set{" "}
                    <code className={CODE_CHIP}>CALDAV_CALENDAR_URL</code> to your collection (must end with{" "}
                    <code className={CODE_CHIP}>/</code>, e.g.{" "}
                    <code className={CODE_CHIP}>http://localhost:5232/alice/tasks/</code>
                    ), plus <code className={CODE_CHIP}>CALDAV_USER</code> and{" "}
                    <code className={CODE_CHIP}>CALDAV_PASSWORD</code>.
                  </li>
                  <li>
                    Optional: <code className={CODE_CHIP}>CALDAV_IMPORT_AREA_ID</code> (UUID) for new events from the
                    calendar; otherwise the first area (by name) is used.
                  </li>
                  <li>
                    Optional: <code className={CODE_CHIP}>CALDAV_PULL_INTERVAL_MS</code> on the <strong>worker</strong>{" "}
                    for automatic pull (e.g. <code className={cn(CODE_CHIP, "text-foreground")}>3600000</code> hourly).
                  </li>
                  <li>
                    <strong>Two-way:</strong> edits in DevPlanner push to CalDAV; use <strong>Pull now</strong> to
                    import/merge external events and reconcile deletions.
                  </li>
                </ul>
                <p className="mt-4 text-[13px] text-muted">Server root</p>
                <p className={cn(MONO_FIELD, "mt-1.5")}>http://localhost:5232/</p>
                <p className="mt-2 text-xs text-[var(--muted-soft)]">
                  Push errors land in <code className="font-mono">caldav_sync_log</code> after task edits.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <button
                    type="button"
                    disabled={!userId || calBusy !== null}
                    className={LINK}
                    onClick={() => void runMkcol()}
                  >
                    {calBusy === "mkcol" ? "Working…" : "Create collection"}
                  </button>
                  <button
                    type="button"
                    disabled={!userId || calBusy !== null}
                    className={LINK}
                    onClick={() => void runPullNow()}
                  >
                    {calBusy === "pull" ? "Pulling…" : "Pull now"}
                  </button>
                  <button
                    type="button"
                    disabled={!userId || calBusy !== null}
                    className={LINK}
                    onClick={() => void queuePull()}
                  >
                    {calBusy === "queue" ? "Queuing…" : "Queue pull (worker)"}
                  </button>
                </div>
              </section>
            </>
          )}

          {tab === "focus" && (
            <>
              <section className={CARD}>
                <h2 className={CARD_TITLE}>Pomodoro &amp; focus</h2>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">
                  Stored in this browser only. Use these values in your focus routine or a future in-app timer.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <label className="text-xs text-muted">
                    Work (minutes)
                    <input
                      type="number"
                      min={5}
                      max={120}
                      className={cn(INPUT, "mt-1.5 w-full")}
                      value={pomoWork}
                      onChange={(e) => setPomoWork(e.target.value)}
                      onBlur={() => localStorage.setItem(LS_POMO_WORK, pomoWork)}
                    />
                  </label>
                  <label className="text-xs text-muted">
                    Short break
                    <input
                      type="number"
                      min={1}
                      max={60}
                      className={cn(INPUT, "mt-1.5 w-full")}
                      value={pomoShort}
                      onChange={(e) => setPomoShort(e.target.value)}
                      onBlur={() => localStorage.setItem(LS_POMO_SHORT, pomoShort)}
                    />
                  </label>
                  <label className="text-xs text-muted">
                    Long break
                    <input
                      type="number"
                      min={1}
                      max={60}
                      className={cn(INPUT, "mt-1.5 w-full")}
                      value={pomoLong}
                      onChange={(e) => setPomoLong(e.target.value)}
                      onBlur={() => localStorage.setItem(LS_POMO_LONG, pomoLong)}
                    />
                  </label>
                </div>
                <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-[13px] text-muted">
                  <input
                    type="checkbox"
                    className="rounded accent-[var(--teal)]"
                    checked={focusModeDef}
                    onChange={(e) => {
                      setFocusModeDef(e.target.checked);
                      localStorage.setItem(LS_FOCUS_MODE, e.target.checked ? "1" : "0");
                    }}
                  />
                  Prefer focus mode (fewer distractions) by default
                </label>
              </section>
              <section className={CARD}>
                <h2 className={CARD_TITLE}>Focus export</h2>
                <p className="mt-2 text-[13px] text-muted">
                  Export today&apos;s scheduled tasks as JSON (pomodoro estimates).
                </p>
                <button
                  type="button"
                  disabled={!userId || exporting}
                  className={cn(INK_BTN, "mt-4")}
                  onClick={() => void downloadFocus()}
                >
                  <Download size={14} />
                  {exporting ? "Exporting…" : "Download export"}
                </button>
              </section>
            </>
          )}

          {tab === "ai" && (
            <>
              <section className={CARD}>
                <div className="flex items-start justify-between gap-4">
                  <h2 className={CARD_TITLE}>AI assistant</h2>
                  {aiConfigQ.data &&
                    (aiConfigQ.data.openaiKeySet ? (
                      <span className={BADGE_SUCCESS}>Key set</span>
                    ) : (
                      <span className={BADGE_MUTED}>No key</span>
                    ))}
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-muted">
                  The chat dock calls <code className={CODE_CHIP}>POST /api/ai/chat</code>. Set{" "}
                  <code className={CODE_CHIP}>OPENAI_API_KEY</code> in the API <code className={CODE_CHIP}>.env</code>{" "}
                  (never in the browser). Optional: <code className={CODE_CHIP}>OPENAI_SMART_MODEL</code> (default{" "}
                  <code className={cn(CODE_CHIP, "text-foreground")}>gpt-4o-mini</code>).
                </p>
                {aiConfigQ.isPending && (
                  <div className="mt-3 space-y-2">
                    <Skeleton className="h-10 w-full max-w-md rounded-lg" />
                    <Skeleton className="h-9 w-full max-w-xs rounded-lg" />
                  </div>
                )}
                {aiConfigQ.isError && (
                  <p className="mt-3 text-xs text-[var(--high)]">
                    Could not load AI config. Is the API running?{" "}
                    {aiConfigQ.error instanceof Error ? aiConfigQ.error.message : String(aiConfigQ.error)}
                  </p>
                )}
                {aiConfigQ.data && (
                  <div
                    className={cn(
                      "mt-3 rounded-lg border px-3 py-2 text-xs",
                      aiConfigQ.data.openaiKeySet
                        ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)]"
                        : "border-[var(--hairline)] bg-background text-[var(--high)]"
                    )}
                  >
                    {aiConfigQ.data.openaiKeySet
                      ? "OpenAI API key is configured on the server."
                      : "OpenAI API key is not set — chat will show a stub message until OPENAI_API_KEY is set."}
                  </div>
                )}
                <div className="mt-4 rounded-lg border border-[var(--hairline)] bg-background p-3 text-xs leading-relaxed text-[var(--high)]">
                  Never paste <code className="rounded bg-[var(--track)] px-1 font-mono">OPENAI_API_KEY</code> into the
                  browser or client-side settings — it would be exposed to anyone with access to this device. Configure
                  keys only in the API server <code className="rounded bg-[var(--track)] px-1 font-mono">.env</code>.
                </div>
                <div className="mt-5 space-y-3.5">
                  <label className="block text-xs text-muted">
                    Chat model (synced with AI dock)
                    {aiConfigQ.isPending ? (
                      <Skeleton className="mt-1.5 h-9 w-full max-w-xs rounded-lg" />
                    ) : (
                      <select
                        className={cn(INPUT, "mt-1.5 w-full max-w-xs")}
                        value={aiModel || aiConfigQ.data?.defaultChatModel || "gpt-4o-mini"}
                        onChange={(e) => {
                          const v = e.target.value;
                          setAiModel(v);
                          localStorage.setItem(LS_CHAT_MODEL, v);
                        }}
                      >
                        {(aiConfigQ.data?.allowedChatModels ?? ["gpt-4o-mini", "gpt-4o"]).map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    )}
                  </label>
                  <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-muted">
                    <input
                      type="checkbox"
                      className="rounded accent-[var(--teal)]"
                      checked={aiWrites}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setAiWrites(on);
                        localStorage.setItem(LS_AI_WRITES, on ? "1" : "0");
                        if (on) {
                          toast.info(
                            "The assistant can now create and edit tasks for you. It will say exactly what it changed."
                          );
                        }
                      }}
                    />
                    Can edit — let the assistant create and change tasks (synced with AI dock)
                  </label>
                  <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-muted">
                    <input
                      type="checkbox"
                      className="rounded accent-[var(--teal)]"
                      checked={aiBudget}
                      onChange={(e) => {
                        setAiBudget(e.target.checked);
                        localStorage.setItem(LS_AI_BUDGET, e.target.checked ? "1" : "0");
                      }}
                    />
                    Add daily budget reminder to AI messages (work/personal caps in prompts)
                  </label>
                  <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-muted">
                    <input
                      type="checkbox"
                      className="rounded accent-[var(--teal)]"
                      checked={aiEnergySuggest}
                      onChange={(e) => {
                        setAiEnergySuggest(e.target.checked);
                        localStorage.setItem(LS_AI_ENERGY_SUGGEST, e.target.checked ? "1" : "0");
                      }}
                    />
                    Send current physical energy to AI (from Now page / shared preference)
                  </label>
                </div>
                <p className="mt-4 text-xs text-muted">
                  <strong className="text-foreground">Task tools</strong> live in the floating AI panel. They let the
                  assistant list, create, update, delete, and reschedule tasks.
                </p>
              </section>
              <section className={CARD}>
                <h2 className={CARD_TITLE}>AI usage log</h2>
                {logsQ.isLoading && (
                  <div className="mt-3 space-y-2">
                    <Skeleton className="h-8 w-full rounded" />
                    <Skeleton className="h-8 w-full rounded" />
                    <Skeleton className="h-8 w-full rounded" />
                  </div>
                )}
                {logsQ.data && logsQ.data.logs.length > 0 && (
                  <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--hairline-soft)]">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-[var(--hairline)] bg-background text-[11px] uppercase tracking-[0.08em] text-muted">
                        <tr>
                          <th className="p-2 font-semibold">Time</th>
                          <th className="p-2 font-semibold">Job</th>
                          <th className="p-2 font-semibold">Model</th>
                          <th className="p-2 text-right font-semibold">Tokens</th>
                          <th className="p-2 text-right font-semibold">Latency</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logsQ.data.logs.map((l) => (
                          <tr
                            key={l.id}
                            className="border-b border-[var(--hairline-soft)] transition-colors last:border-b-0 hover:bg-[var(--teal-a08)]"
                          >
                            <td className="p-2 text-muted">{new Date(l.createdAt).toLocaleDateString()}</td>
                            <td className="p-2 text-foreground">{l.jobType}</td>
                            <td className="p-2 font-mono text-muted">{l.model}</td>
                            <td className="p-2 text-right text-muted">
                              {l.inputTokens ?? "—"}/{l.outputTokens ?? "—"}
                            </td>
                            <td className="p-2 text-right text-muted">
                              {l.latencyMs ? `${l.latencyMs}ms` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {logsQ.data && logsQ.data.logs.length === 0 && (
                  <p className="mt-3 text-[13px] text-muted">No AI calls logged yet.</p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AreasSection({ userId }: { userId: string | undefined }) {
  const qc = useQueryClient();

  const areasQ = useQuery({
    queryKey: ["areas", userId],
    queryFn: () => fetchAreas(),
    enabled: Boolean(userId),
  });

  const updateTarget = useMutation({
    mutationFn: ({ areaId, value }: { areaId: string; value: number | null }) =>
      patchArea(areaId, { weekly_hour_target: value }),
    onSuccess: () => {
      toast.success("Saved");
      void qc.invalidateQueries({ queryKey: ["areas", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className={CARD}>
      <h2 className={CARD_TITLE}>Areas &amp; weekly hour targets</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        Set a weekly hour target for each area. This is shown in the Review time panel as a progress bar.
      </p>

      {areasQ.isLoading && (
        <div className="mt-4 space-y-2">
          <div className="animate-shimmer h-10 rounded" />
          <div className="animate-shimmer h-10 rounded" />
        </div>
      )}

      {areasQ.data && (
        <div className="mt-4 flex flex-col">
          {areasQ.data.map((area, index) => (
            <div
              key={area.id}
              className={cn(
                "flex items-center gap-3 py-3",
                index > 0 && "border-t border-[var(--hairline-soft)]"
              )}
            >
              {area.color && (
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: area.color }} />
              )}
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{area.name}</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={168}
                  step={0.5}
                  className={cn(INPUT, "w-20 text-right")}
                  defaultValue={area.weeklyHourTarget ?? ""}
                  placeholder="—"
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    const val = raw === "" ? null : Number(raw);
                    const prev = area.weeklyHourTarget ? Number(area.weeklyHourTarget) : null;
                    if (val !== prev) {
                      updateTarget.mutate({ areaId: area.id, value: val });
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                />
                <span className="text-xs text-muted">h/wk</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {areasQ.data && areasQ.data.length === 0 && (
        <p className="mt-4 text-[13px] text-muted">No areas found. Create areas from the Board view.</p>
      )}
    </section>
  );
}
