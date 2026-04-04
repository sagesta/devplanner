"use client";

import { useQuery } from "@tanstack/react-query";
import { Calendar, Download, Settings as SettingsIcon, Cpu, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { fetchAiLogs, fetchFocusExport, getDevUserId, type AiLogRow } from "@/lib/api";
import { Skeleton } from "@/lib/skeleton";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "general", label: "General", icon: SettingsIcon },
  { key: "calendar", label: "Calendar", icon: Calendar },
  { key: "focus", label: "Focus", icon: Zap },
  { key: "ai", label: "AI", icon: Cpu },
] as const;

export default function SettingsPage() {
  const userId = getDevUserId();
  const [tab, setTab] = useState<string>("general");
  const [exporting, setExporting] = useState(false);

  const logsQ = useQuery({
    queryKey: ["ai-logs", userId],
    queryFn: () => fetchAiLogs(userId, 40),
    enabled: Boolean(userId) && tab === "ai",
  });

  async function downloadFocus() {
    if (!userId) return;
    setExporting(true);
    try {
      const data = await fetchFocusExport(userId);
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
            <div className="mt-4 rounded-lg bg-background/50 p-3 text-xs text-muted">
              <p>User ID: <code className="text-foreground">{userId || "not set"}</code></p>
            </div>
          </section>
        )}

        {tab === "calendar" && (
          <section className="rounded-xl border border-white/10 bg-surface p-5">
            <h2 className="text-sm font-semibold text-foreground">Calendar / CalDAV</h2>
            <p className="mt-2 text-sm text-muted leading-relaxed">
              Radicale runs via <code className="rounded bg-background px-1 text-xs">docker compose</code> on port 5232.
              Task changes enqueue a <code className="rounded bg-background px-1 text-xs">caldav-sync</code> job;
              the worker logs rows in <code className="rounded bg-background px-1 text-xs">caldav_sync_log</code> until real iCal write is added.
            </p>
            <div className="mt-4 rounded-lg bg-background/50 p-3 text-xs text-muted font-mono space-y-1">
              <p>CalDAV URL: http://localhost:5232/</p>
              <p>Status: stub (log only)</p>
            </div>
          </section>
        )}

        {tab === "focus" && (
          <section className="rounded-xl border border-white/10 bg-surface p-5">
            <h2 className="text-sm font-semibold text-foreground">Focus app</h2>
            <p className="mt-2 text-sm text-muted">
              Export today&apos;s scheduled tasks as JSON (pomodoro estimates).
            </p>
            <button
              type="button"
              disabled={!userId || exporting}
              className="mt-4 flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-40 hover:bg-primary-hover transition-colors"
              onClick={() => void downloadFocus()}
            >
              <Download size={14} />
              {exporting ? "Exporting…" : "Download export"}
            </button>
            <p className="mt-3 text-xs text-muted">
              Import from Focus is stubbed on POST /api/focus/import.
            </p>
          </section>
        )}

        {tab === "ai" && (
          <section className="rounded-xl border border-white/10 bg-surface p-5">
            <h2 className="text-sm font-semibold text-foreground">AI cost log</h2>
            {!userId && <p className="mt-2 text-sm text-muted">Set user ID to load logs.</p>}
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
        )}
      </div>
    </div>
  );
}
