"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, Download, RefreshCw, Settings as SettingsIcon, Cpu, FolderPlus, LogOut, Zap } from "lucide-react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useState } from "react";
import { toast } from "sonner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import {
  fetchAiConfig,
  fetchAiLogs,
  fetchFocusExport,
  fetchGoogleCalendarStatus,
  getGoogleOAuthStartUrl,
  postCaldavMkcol,
  postCaldavPullNow,
  postCaldavPullQueued,
  postGoogleCalendarDisconnect,
  postGoogleCalendarPullNow,
  postGoogleCalendarPullQueued,
  type AiLogRow,
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
  { key: "general", label: "General", icon: SettingsIcon },
  { key: "calendar", label: "Calendar", icon: Calendar },
  { key: "focus", label: "Focus", icon: Zap },
  { key: "ai", label: "AI", icon: Cpu },
] as const;

export default function SettingsPage() {
  const { data: session } = useSession();
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
  const [calPrimaryOnly, setCalPrimaryOnly] = useState(true);

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "general" || t === "calendar" || t === "focus" || t === "ai") setTab(t);
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
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl text-foreground">Settings</h1>
      <p className="mt-1 text-sm text-muted">Self-hosted DevPlanner configuration.</p>

      {/* Tabs */}
      <div className="mt-5 flex gap-1 border-b border-white/10 pb-0">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors",
              tab === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            )}
            onClick={() => setTab(key)}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-5 animate-fadeIn" key={tab}>
        {tab === "general" && (
          <section className="rounded-xl border border-white/10 bg-surface p-5">
            <h2 className="text-sm font-semibold text-foreground">General</h2>
            <p className="mt-2 text-sm text-muted leading-relaxed">
              Daily budgets (<strong>4h work / 2h personal</strong>) are enforced in AI prompts when
              OPENAI_API_KEY is set. User profile fields live on the <code className="rounded bg-background px-1 text-xs">users</code> row (seeded dev user).
            </p>
            <p className="mt-3 text-sm text-muted leading-relaxed">
              <strong className="text-foreground">Theme:</strong> use the Sun / Moon control in the sidebar (bottom) to switch light and dark mode.
            </p>
            <div className="mt-4 rounded-lg bg-background/50 p-3 text-xs text-muted space-y-1">
              <p>
                Signed in as{" "}
                <span className="text-foreground">{session?.user?.email ?? "—"}</span>
              </p>
              {userId && (
                <p>
                  Account ID: <code className="text-foreground">{userId}</code>
                </p>
              )}
            </div>
          </section>
        )}

        {tab === "calendar" && (
          <section className="space-y-6">
            <div className="rounded-xl border border-white/10 bg-surface p-5">
              <h2 className="text-sm font-semibold text-foreground">Google Calendar</h2>
              <p className="mt-2 text-sm text-muted leading-relaxed">
                Connect your Google account to sync tasks that have a <strong>scheduled date</strong> or{" "}
                <strong>due date</strong> with your primary Google calendar (two-way: edits in DevPlanner push via the
                worker; pull imports changes from Google). Set{" "}
                <code className="rounded bg-background px-1 text-xs">GOOGLE_*</code> and{" "}
                <code className="rounded bg-background px-1 text-xs">WEB_APP_URL</code> in the API{" "}
                <code className="rounded bg-background px-1 text-xs">.env</code> — see{" "}
                <code className="rounded bg-background px-1 text-xs">.env.example</code>.
              </p>
              {googleQ.isLoading && (
                <p className="mt-3 text-xs text-muted">Loading connection status…</p>
              )}
              {googleQ.data && (
                <div className="mt-3 rounded-lg bg-background/50 p-3 text-xs text-muted space-y-2">
                  <p>
                    API OAuth:{" "}
                    <span className="text-foreground">
                      {googleQ.data.oauthConfigured ? "configured" : "not configured"}
                    </span>
                    {" · "}
                    Account:{" "}
                    <span className="text-foreground">{googleQ.data.connected ? "connected" : "not connected"}</span>
                  </p>
                  {googleQ.data.connected && (
                    <>
                      <p>
                        Calendar ID:{" "}
                        <code className="text-foreground">{googleQ.data.calendarId ?? "primary"}</code>
                      </p>
                      <p>
                        Last import:{" "}
                        <span className="text-foreground">
                          {googleQ.data.lastGooglePullAt
                            ? new Date(googleQ.data.lastGooglePullAt).toLocaleString()
                            : "— (run Pull from Google)"}
                        </span>
                      </p>
                      <p className="text-[10px] text-muted/80">
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
                      <code className="text-foreground">…/api/sync/google/callback</code> in Google Cloud Console.
                    </p>
                  )}
                  <label className="flex cursor-pointer items-center gap-2 pt-1 text-[11px] text-foreground">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={calPrimaryOnly}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setCalPrimaryOnly(on);
                        localStorage.setItem("devplanner.googleImportPrimaryOnly", on ? "1" : "0");
                      }}
                    />
                    Import primary calendar only (preference — multi-calendar picker coming later)
                  </label>
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={
                    !userId ||
                    googleBusy !== null ||
                    googleQ.isLoading ||
                    (googleQ.isFetched && !googleQ.data?.oauthConfigured)
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-40"
                  onClick={() => connectGoogle()}
                >
                  Connect Google Calendar
                </button>
                <button
                  type="button"
                  disabled={!userId || !googleQ.data?.connected || googleBusy !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-foreground hover:bg-white/10 disabled:opacity-40"
                  onClick={() => void disconnectGoogle()}
                >
                  <LogOut size={14} />
                  {googleBusy === "disconnect" ? "…" : "Disconnect"}
                </button>
                <button
                  type="button"
                  disabled={!userId || !googleQ.data?.connected || googleBusy !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-foreground hover:bg-white/10 disabled:opacity-40"
                  onClick={() => void googlePullNow()}
                >
                  <RefreshCw size={14} className={googleBusy === "pull" ? "animate-spin" : ""} />
                  {googleBusy === "pull" ? "Pulling…" : "Pull from Google now"}
                </button>
                <button
                  type="button"
                  disabled={!userId || !googleQ.data?.connected || googleBusy !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-foreground hover:bg-white/10 disabled:opacity-40"
                  onClick={() => void googleQueuePull()}
                >
                  {googleBusy === "queue" ? "Queuing…" : "Queue Google pull (worker)"}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-surface p-5">
            <h2 className="text-sm font-semibold text-foreground">CalDAV (optional)</h2>
            <p className="mt-2 text-sm text-muted leading-relaxed">
              Tasks with a <strong>scheduled date</strong> or <strong>due date</strong> sync as VEVENT <code className="rounded bg-background px-1 text-xs">.ics</code> files
              to a CalDAV collection (e.g. Radicale from <code className="rounded bg-background px-1 text-xs">docker compose</code> on port 5232).
              Run <code className="rounded bg-background px-1 text-xs">npm run worker</code> with Redis so jobs run.
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
              <li>
                In API <code className="rounded bg-background px-1 text-xs">.env</code>: set{" "}
                <code className="rounded bg-background px-1 text-xs">CALDAV_CALENDAR_URL</code> to your collection (must end with{" "}
                <code className="rounded bg-background px-1 text-xs">/</code>, e.g.{" "}
                <code className="rounded bg-background px-1 text-xs">http://localhost:5232/alice/tasks/</code>
                ), plus <code className="rounded bg-background px-1 text-xs">CALDAV_USER</code> and{" "}
                <code className="rounded bg-background px-1 text-xs">CALDAV_PASSWORD</code>.
              </li>
              <li>
                Optional: <code className="rounded bg-background px-1 text-xs">CALDAV_IMPORT_AREA_ID</code> (UUID) for new events from
                the calendar; otherwise the first area (by name) is used.
              </li>
              <li>
                Optional: <code className="rounded bg-background px-1 text-xs">CALDAV_PULL_INTERVAL_MS</code> on the{" "}
                <strong>worker</strong> for automatic pull (e.g. <code className="text-foreground">3600000</code> hourly).
              </li>
              <li>
                <strong>Two-way:</strong> edits in DevPlanner push to CalDAV; use <strong>Pull from calendar</strong> to import/merge
                external events and reconcile deletions.
              </li>
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!userId || calBusy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-foreground hover:bg-white/10 disabled:opacity-40"
                onClick={() => void runMkcol()}
              >
                <FolderPlus size={14} />
                {calBusy === "mkcol" ? "Working…" : "Ensure calendar folder (MKCOL)"}
              </button>
              <button
                type="button"
                disabled={!userId || calBusy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-40"
                onClick={() => void runPullNow()}
              >
                <RefreshCw size={14} className={calBusy === "pull" ? "animate-spin" : ""} />
                {calBusy === "pull" ? "Pulling…" : "Pull from calendar now"}
              </button>
              <button
                type="button"
                disabled={!userId || calBusy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-foreground hover:bg-white/10 disabled:opacity-40"
                onClick={() => void queuePull()}
              >
                {calBusy === "queue" ? "Queuing…" : "Queue pull (worker)"}
              </button>
            </div>
            <div className="mt-4 rounded-lg bg-background/50 p-3 text-xs text-muted font-mono space-y-1">
              <p>Server root: http://localhost:5232/</p>
              <p>Push errors: <code className="text-foreground">caldav_sync_log</code> after task edits.</p>
            </div>
            </div>
          </section>
        )}

        {tab === "focus" && (
          <section className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-surface p-5">
              <h2 className="text-sm font-semibold text-foreground">Pomodoro &amp; focus</h2>
              <p className="mt-2 text-xs text-muted leading-relaxed">
                Stored in this browser only. Use these values in your focus routine or a future in-app timer.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <label className="text-[11px] text-muted">
                  Work (minutes)
                  <input
                    type="number"
                    min={5}
                    max={120}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm text-foreground"
                    value={pomoWork}
                    onChange={(e) => setPomoWork(e.target.value)}
                    onBlur={() => localStorage.setItem(LS_POMO_WORK, pomoWork)}
                  />
                </label>
                <label className="text-[11px] text-muted">
                  Short break
                  <input
                    type="number"
                    min={1}
                    max={60}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm text-foreground"
                    value={pomoShort}
                    onChange={(e) => setPomoShort(e.target.value)}
                    onBlur={() => localStorage.setItem(LS_POMO_SHORT, pomoShort)}
                  />
                </label>
                <label className="text-[11px] text-muted">
                  Long break
                  <input
                    type="number"
                    min={1}
                    max={60}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm text-foreground"
                    value={pomoLong}
                    onChange={(e) => setPomoLong(e.target.value)}
                    onBlur={() => localStorage.setItem(LS_POMO_LONG, pomoLong)}
                  />
                </label>
              </div>
              <label className="mt-4 flex cursor-pointer items-center gap-2 text-[11px] text-foreground">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={focusModeDef}
                  onChange={(e) => {
                    setFocusModeDef(e.target.checked);
                    localStorage.setItem(LS_FOCUS_MODE, e.target.checked ? "1" : "0");
                  }}
                />
                Prefer focus mode (fewer distractions) by default
              </label>
            </div>
            <div className="rounded-xl border border-white/10 bg-surface p-5">
              <h2 className="text-sm font-semibold text-foreground">Focus export</h2>
              <p className="mt-2 text-sm text-muted">
                Export today&apos;s scheduled tasks as JSON (pomodoro estimates).
              </p>
              <button
                type="button"
                disabled={!userId || exporting}
                className="mt-4 flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
                onClick={() => void downloadFocus()}
              >
                <Download size={14} />
                {exporting ? "Exporting…" : "Download export"}
              </button>
              <p className="mt-3 text-xs text-muted">
                Import from Focus is stubbed on POST /api/focus/import.
              </p>
            </div>
          </section>
        )}

        {tab === "ai" && (
          <div className="space-y-6">
          <div className="rounded-xl border border-white/10 bg-surface p-5">
            <h2 className="text-sm font-semibold text-foreground">AI assistant</h2>
            <p className="mt-2 text-xs text-muted leading-relaxed">
              The chat dock calls <code className="rounded bg-background px-1">POST /api/ai/chat</code>. Set{" "}
              <code className="rounded bg-background px-1">OPENAI_API_KEY</code> in the API{" "}
              <code className="rounded bg-background px-1">.env</code> (never in the browser). Optional:{" "}
              <code className="rounded bg-background px-1">OPENAI_SMART_MODEL</code> (default{" "}
              <code className="text-foreground">gpt-4o-mini</code>).
            </p>
            {aiConfigQ.isPending && (
              <div className="mt-3 space-y-2">
                <Skeleton className="h-10 w-full max-w-md rounded-lg" />
                <Skeleton className="h-9 w-full max-w-xs rounded-lg" />
              </div>
            )}
            {aiConfigQ.isError && (
              <p className="mt-3 text-xs text-red-300">
                Could not load AI config. Is the API running?{" "}
                {aiConfigQ.error instanceof Error ? aiConfigQ.error.message : String(aiConfigQ.error)}
              </p>
            )}
            {aiConfigQ.data && (
              <div
                className={cn(
                  "mt-3 rounded-lg border px-3 py-2 text-xs",
                  aiConfigQ.data.openaiKeySet
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-100/90"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-100/90"
                )}
              >
                {aiConfigQ.data.openaiKeySet
                  ? "OpenAI API key is configured on the server."
                  : "OpenAI API key is not set — chat will show a stub message until OPENAI_API_KEY is set."}
              </div>
            )}
            <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-[11px] text-amber-100/90">
              Never paste <code className="rounded bg-black/20 px-1">OPENAI_API_KEY</code> into the browser or
              client-side settings — it would be exposed to anyone with access to this device. Configure keys only
              in the API server <code className="rounded bg-black/20 px-1">.env</code>.
            </div>
            <div className="mt-4 space-y-3">
              <label className="block text-[11px] text-muted">
                Chat model (synced with AI dock)
                {aiConfigQ.isPending ? (
                  <Skeleton className="mt-1 h-9 w-full max-w-xs rounded-lg" />
                ) : (
                  <select
                    className="mt-1 w-full max-w-xs rounded-lg border border-white/10 bg-background px-2 py-1.5 text-sm text-foreground"
                    value={
                      aiModel ||
                      aiConfigQ.data?.defaultChatModel ||
                      "gpt-4o-mini"
                    }
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
              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-foreground">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={aiBudget}
                  onChange={(e) => {
                    setAiBudget(e.target.checked);
                    localStorage.setItem(LS_AI_BUDGET, e.target.checked ? "1" : "0");
                  }}
                />
                Add daily budget reminder to AI messages (work/personal caps in prompts)
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-foreground">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={aiEnergySuggest}
                  onChange={(e) => {
                    setAiEnergySuggest(e.target.checked);
                    localStorage.setItem(LS_AI_ENERGY_SUGGEST, e.target.checked ? "1" : "0");
                  }}
                />
                Send current physical energy to AI (from Now page / shared preference)
              </label>
            </div>
            <p className="mt-3 text-xs text-muted">
              <strong className="text-foreground">Task tools</strong> live in the floating AI panel. They let the
              assistant list, create, update, delete, and reschedule tasks.
            </p>
          </div>
          <section className="rounded-xl border border-white/10 bg-surface p-5">
            <h2 className="text-sm font-semibold text-foreground">AI cost log</h2>
            {logsQ.isLoading && (
              <div className="mt-3 space-y-2">
                <Skeleton className="h-8 w-full rounded" />
                <Skeleton className="h-8 w-full rounded" />
                <Skeleton className="h-8 w-full rounded" />
              </div>
            )}
            {logsQ.data && logsQ.data.logs.length > 0 && (
              <div className="mt-3 overflow-x-auto rounded-lg border border-white/5">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/10 bg-background/50 text-[9px] uppercase tracking-wider text-muted">
                    <tr>
                      <th className="p-2">Time</th>
                      <th className="p-2">Job</th>
                      <th className="p-2">Model</th>
                      <th className="p-2 text-right">Tokens</th>
                      <th className="p-2 text-right">Cost</th>
                      <th className="p-2 text-right">Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logsQ.data.logs.map((l) => (
                      <tr key={l.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="p-2 text-muted">
                          {new Date(l.createdAt).toLocaleDateString()}
                        </td>
                        <td className="p-2 text-foreground">{l.jobType}</td>
                        <td className="p-2 text-muted font-mono">{l.model}</td>
                        <td className="p-2 text-right text-muted">
                          {l.inputTokens ?? "—"}/{l.outputTokens ?? "—"}
                        </td>
                        <td className="p-2 text-right text-muted">
                          {l.costUsdEstimate != null ? `$${l.costUsdEstimate.toFixed(4)}` : "—"}
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
              <p className="mt-3 text-sm text-muted">No AI calls logged yet.</p>
            )}
          </section>
          </div>
        )}
      </div>
    </div>
  );
}
