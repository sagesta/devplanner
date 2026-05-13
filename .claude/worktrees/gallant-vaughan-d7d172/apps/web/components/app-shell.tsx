"use client";

import {
  BarChart3,
  Bell,
  CalendarCheck,
  ChartGantt,
  Inbox,
  KanbanSquare,
  LayoutList,
  Lightbulb,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
  Moon,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchInboxArea, fetchTasks } from "@/lib/api";
import { AiChatDock } from "@/components/ai-chat-dock";
import { BrainDumpModal } from "@/components/brain-dump-modal";
import { CommandMenu } from "@/components/command-menu";
import { GlobalTimerIndicator } from "@/components/GlobalTimerIndicator";
import { NotificationsTray } from "@/components/notifications-tray";
import { IdleBanner } from "@/components/idle-banner";
import { QuickCaptureModal } from "@/components/quick-capture-modal";
import { ShortcutsHelp } from "@/components/shortcuts-help";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { cn } from "@/lib/utils";

const NAV = [
  ["/now", "Today", Zap],
  ["/inbox", "Inbox", Inbox],
  ["/backlog", "Backlog", LayoutList],
  ["/board", "Plan", KanbanSquare],
  ["/timeline", "Timeline", ChartGantt],
  ["/table", "Table", LayoutList],
  ["/sprints", "Sprints", CalendarCheck],
  ["/insights", "Review", BarChart3],
  ["/settings", "Settings", Settings],
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [brainOpen, setBrainOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [collapsed, setCollapsed] = useState(false);

  const closeAllOverlays = () => {
    setCommandOpen(false);
    setBrainOpen(false);
    setNotificationsOpen(false);
    setQuickOpen(false);
    setHelpOpen(false);
  };

  useEffect(() => {
    const saved = localStorage.getItem("devplanner-theme") as "dark" | "light" | null;
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("devplanner-theme", theme);
  }, [theme]);

  // Alt+T notifications tray
  useKeyboardShortcut({ key: "t", modifiers: ["alt"] }, () => {
    setCommandOpen(false);
    setBrainOpen(false);
    setQuickOpen(false);
    setHelpOpen(false);
    setNotificationsOpen((o) => !o);
  });

  // Ctrl/Cmd+Space → quick capture (single-line → Inbox)
  useKeyboardShortcut({ key: " ", modifiers: ["ctrl"], allowInInputs: true }, () => {
    closeAllOverlays();
    setQuickOpen(true);
  });

  // ? → keyboard shortcuts help
  useKeyboardShortcut({ key: "?", modifiers: ["shift"] }, () => {
    setHelpOpen((o) => !o);
  });

  const { data: session } = useSession();
  const userId = useAppUserId();

  // Inbox count for sidebar badge. Cheap: piggybacks on the same task list
  // other pages already fetch via React Query.
  const inboxAreaQ = useQuery({
    queryKey: ["inbox-area", userId],
    queryFn: fetchInboxArea,
    enabled: Boolean(userId),
    staleTime: Infinity,
  });
  const tasksQ = useQuery({
    queryKey: ["tasks", userId],
    queryFn: () => fetchTasks(),
    enabled: Boolean(userId),
  });
  const inboxCount = useMemo(() => {
    const inboxId = inboxAreaQ.data?.id;
    if (!inboxId || !tasksQ.data) return 0;
    return tasksQ.data.filter(
      (t) => t.areaId === inboxId && t.status !== "done" && t.status !== "cancelled"
    ).length;
  }, [inboxAreaQ.data?.id, tasksQ.data]);

  return (
    <div className="min-h-screen">
      <IdleBanner />
      <div className="flex min-h-screen">
        {/* ─── Desktop sidebar ──────────────────────────────────── */}
        <aside
          className={cn(
            "hidden shrink-0 border-r border-white/10 bg-surface md:flex md:flex-col transition-all duration-300 overflow-hidden",
            collapsed ? "w-14" : "w-56"
          )}
        >
          <div className={cn("p-5", collapsed && "px-2 py-4")}>
            {collapsed ? (
              <p className="font-display text-lg text-foreground text-center">D</p>
            ) : (
              <>
                <p className="text-lg font-semibold text-foreground">DevPlanner</p>
                <p className="mt-0.5 text-[11px] text-muted">Today. Capture. Plan. Review.</p>
              </>
            )}
          </div>
          <nav className={cn("flex flex-1 flex-col gap-0.5 pb-4", collapsed ? "px-1" : "px-3")}>
            {NAV.map(([href, label, Icon]) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              const badge = href === "/inbox" && inboxCount > 0 ? inboxCount : null;
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all",
                    active
                      ? "bg-primary/10 text-foreground border-l-2 border-primary pl-2.5"
                      : "text-muted hover:bg-white/5 hover:text-foreground",
                    collapsed && "justify-center px-0 gap-0"
                  )}
                  title={collapsed ? `${label}${badge ? ` (${badge})` : ""}` : undefined}
                >
                  <Icon
                    size={16}
                    className={cn(
                      "shrink-0 transition-colors",
                      active ? "text-primary" : "text-muted group-hover:text-foreground"
                    )}
                  />
                  {!collapsed && (
                    <>
                      <span className="flex-1">{label}</span>
                      {badge != null && (
                        <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          {badge}
                        </span>
                      )}
                    </>
                  )}
                  {collapsed && badge != null && (
                    <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary" />
                  )}
                </Link>
              );
            })}
          </nav>
          <div className={cn("border-t border-white/10 p-3 space-y-2", collapsed && "px-1")}>
            {!collapsed && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px] text-muted hover:bg-white/10 hover:text-foreground transition-colors"
                  onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                >
                  {theme === "dark" ? <Sun size={12} /> : <Moon size={12} />}
                  {theme === "dark" ? "Light" : "Dark"}
                </button>
                <span className="text-[10px] text-muted/60 truncate max-w-[120px]" title={session?.user?.email ?? ""}>
                  {session?.user?.email ?? (userId ? "✓ signed in" : "…")}
                </span>
              </div>
            )}
            {collapsed && (
              <button
                type="button"
                className="flex w-full justify-center rounded-lg bg-white/5 p-1.5 text-muted hover:bg-white/10 hover:text-foreground transition-colors"
                onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                title={theme === "dark" ? "Switch to light" : "Switch to dark"}
              >
                {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
              </button>
            )}
            {!collapsed && (
              <>
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2 text-[11px] text-muted hover:bg-white/5 hover:text-foreground transition-colors"
                  onClick={() => void signOut({ callbackUrl: "/login" })}
                >
                  Sign out
                </button>
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary/80 py-2 text-[11px] font-medium text-white hover:bg-primary transition-colors"
                  onClick={() => {
                    setCommandOpen(false);
                    setNotificationsOpen(false);
                    setBrainOpen(true);
                  }}
                >
                  <Lightbulb size={12} />
                  Brain dump
                </button>
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2 text-[11px] text-muted hover:bg-white/5 hover:text-foreground transition-colors"
                  onClick={() => {
                    setCommandOpen(false);
                    setBrainOpen(false);
                    setNotificationsOpen(true);
                  }}
                  title="Notifications (Alt+T)"
                >
                  <Bell size={12} />
                  Alerts
                </button>
              </>
            )}
            <button
              type="button"
              className="flex w-full items-center justify-center rounded-lg p-1.5 text-muted hover:bg-white/5 hover:text-foreground transition-colors"
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
            </button>
          </div>
        </aside>

        {/* ─── Main content area ────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile header */}
          <header className="border-b border-white/10 bg-surface/80 backdrop-blur-sm md:hidden">
            <div className="flex items-center gap-2 px-4 py-2.5">
              <span className="min-w-0 flex-1 truncate font-display text-lg text-foreground">DevPlanner</span>
              <button
                type="button"
                className="flex shrink-0 items-center gap-1 rounded-lg bg-primary/80 px-2.5 py-1.5 text-xs text-white"
                onClick={() => {
                  setCommandOpen(false);
                  setBrainOpen(true);
                }}
              >
                <Lightbulb size={12} />
                Dump
              </button>
            </div>
            <nav
              className="flex gap-0.5 overflow-x-auto border-t border-white/5 px-2 py-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              aria-label="Main"
            >
              {NAV.map(([href, label, Icon]) => {
                const active = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors",
                      active
                        ? "bg-primary/15 text-foreground"
                        : "text-muted hover:bg-white/5 hover:text-foreground"
                    )}
                  >
                    <Icon size={12} />
                    {label}
                  </Link>
                );
              })}
            </nav>
          </header>
          {/* Desktop top bar with timer indicator */}
          <header className="hidden md:flex items-center justify-end gap-3 border-b border-white/10 bg-surface/40 backdrop-blur-sm px-4 py-2">
            <GlobalTimerIndicator />
          </header>
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
      <BrainDumpModal open={brainOpen} onClose={() => setBrainOpen(false)} />
      <NotificationsTray open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
      <QuickCaptureModal open={quickOpen} onClose={() => setQuickOpen(false)} />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <CommandMenu
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onBrainDump={() => {
          setCommandOpen(false);
          setBrainOpen(true);
        }}
      />
      <AiChatDock />
    </div>
  );
}
