"use client";

import {
  Bell,
  Bot,
  CalendarCheck,
  Inbox,
  Lightbulb,
  Settings,
  Sun,
  Moon,
  MoreHorizontal,
  Target,
  Trophy,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useUser } from "@clerk/nextjs";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { AiChatDock } from "@/components/ai-chat-dock";
import { BrainDumpModal } from "@/components/brain-dump-modal";
import { QuickAddTask } from "@/components/quick-add-task";
import { fetchDailyPreferences } from "@/lib/daily-api";
import { useCalendarDate } from "@/hooks/use-calendar-date";
import { CommandMenu } from "@/components/command-menu";
import { GlobalTimerIndicator } from "@/components/GlobalTimerIndicator";
import { NotificationsTray } from "@/components/notifications-tray";
import { IdleBanner } from "@/components/idle-banner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/now", label: "Today", Icon: Zap, matches: ["/now"] },
  { href: "/backlog", label: "Inbox", Icon: Inbox, matches: ["/backlog"] },
  {
    href: "/plan",
    label: "Plan",
    Icon: CalendarCheck,
    matches: ["/plan", "/sprints", "/board", "/timeline", "/table"],
  },
  {
    href: "/review",
    label: "Review",
    Icon: Trophy,
    matches: ["/review", "/insights"],
  },
  { href: "/goals", label: "Goals", Icon: Target, matches: ["/goals"] },
] as const;

const SETTINGS_NAV = {
  href: "/settings",
  label: "Settings",
  Icon: Settings,
  matches: ["/settings"],
} as const;

function isNavActive(pathname: string, matches: readonly string[]) {
  return matches.some(
    (href) => pathname === href || pathname.startsWith(`${href}/`),
  );
}

function readTheme(): "dark" | "light" {
  const saved = localStorage.getItem("devplanner-theme");
  return saved === "dark" ? "dark" : "light";
}
function subscribeTheme(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("devplanner-theme-change", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("devplanner-theme-change", listener);
  };
}

/** 36px circular icon button used in the top bar (bell, theme, settings). */
function IconCircleButton({
  active,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors",
        active
          ? "border-[var(--teal-a30)] bg-[var(--teal-a12)] text-[var(--ink)]"
          : "border-[var(--hairline)] bg-transparent text-muted hover:bg-[var(--teal-a08)] hover:text-[var(--ink)]",
        className,
      )}
      {...props}
    />
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [brainOpen, setBrainOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  // The saved preference is an external store; the server snapshot stays light.
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "light");
  const toggleTheme = () => {
    localStorage.setItem(
      "devplanner-theme",
      theme === "dark" ? "light" : "dark",
    );
    window.dispatchEvent(new Event("devplanner-theme-change"));
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Per-page <title> for browser tabs / history — "Today — DevPlanner" etc.
  useEffect(() => {
    const match = [...NAV, SETTINGS_NAV].find((item) =>
      isNavActive(pathname, item.matches),
    );
    const label = match?.label;
    document.title = label ? `${label} — DevPlanner` : "DevPlanner";
  }, [pathname]);

  // stress-test-fix: Alt+T notifications tray
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        setCommandOpen(false);
        setBrainOpen(false);
        setNotificationsOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Let any page (e.g. the getting-started checklist) open the capture modal.
  useEffect(() => {
    const onOpenBrainDump = () => {
      setCommandOpen(false);
      setNotificationsOpen(false);
      setBrainOpen(true);
    };
    window.addEventListener("devplanner:open-brain-dump", onOpenBrainDump);
    return () =>
      window.removeEventListener("devplanner:open-brain-dump", onOpenBrainDump);
  }, []);

  const { user } = useUser();
  const userId = useAppUserId();
  const preferencesQ = useQuery({
    queryKey: ["daily-preferences", userId],
    queryFn: fetchDailyPreferences,
    enabled: Boolean(userId),
  });
  const todayDate = useCalendarDate(preferencesQ.data?.timezone);
  const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";

  const openBrainDump = () => {
    setCommandOpen(false);
    setNotificationsOpen(false);
    setBrainOpen(true);
  };

  useEffect(() => {
    const openQuick = () => {
      setBrainOpen(false);
      setQuickOpen(true);
    };
    window.addEventListener("devplanner:open-quick-add", openQuick);
    return () =>
      window.removeEventListener("devplanner:open-quick-add", openQuick);
  }, []);

  return (
    <div className="min-h-screen [overflow-x:clip]">
      <IdleBanner />
      <div className="flex min-h-screen flex-col">
        {/* ─── Top nav (desktop) ─────────────────────────────────── */}
        <header className="hidden items-center gap-8 border-b border-[var(--hairline)] px-12 py-[18px] md:flex">
          <Link
            href="/now"
            className="font-display text-[22px] italic leading-none text-[var(--ink)]"
          >
            DevPlanner
          </Link>
          <nav className="flex flex-1 gap-1" aria-label="Main">
            {NAV.map(({ href, label, matches }) => {
              const active = isNavActive(pathname, matches);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-[var(--teal-a12)] font-semibold text-[var(--ink)]"
                      : "text-muted hover:bg-[var(--teal-a08)] hover:text-[var(--ink)]",
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-2.5">
            <GlobalTimerIndicator />
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--ink-btn-bg)] px-[18px] py-[9px] text-[13px] font-semibold text-[var(--ink-btn-fg)] transition-opacity hover:opacity-85"
              onClick={() => setQuickOpen(true)}
            >
              <Lightbulb size={13} />
              Add task
            </button>
            <IconCircleButton
              title="Notifications — press Alt+T"
              aria-label="Notifications"
              aria-keyshortcuts="Alt+T"
              onClick={() => {
                setCommandOpen(false);
                setBrainOpen(false);
                setNotificationsOpen(true);
              }}
            >
              <Bell size={15} />
            </IconCircleButton>
            <IconCircleButton
              title="Switch theme"
              aria-label="Switch theme"
              onClick={toggleTheme}
            >
              {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
            </IconCircleButton>
            <Link
              href={SETTINGS_NAV.href}
              aria-label="Settings"
              title="Settings"
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors",
                isNavActive(pathname, SETTINGS_NAV.matches)
                  ? "border-[var(--teal-a30)] bg-[var(--teal-a12)] text-[var(--ink)]"
                  : "border-[var(--hairline)] text-muted hover:bg-[var(--teal-a08)] hover:text-[var(--ink)]",
              )}
            >
              <Settings size={15} />
            </Link>
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--teal)]"
              title={userEmail || (userId ? "Signed in" : undefined)}
            >
              <UserButton afterSignOutUrl="/login" />
            </div>
          </div>
        </header>

        {/* ─── Mobile top bar ────────────────────────────────────── */}
        <header className="flex items-center gap-2 border-b border-[var(--hairline)] bg-background/90 px-5 py-3 backdrop-blur-md md:hidden">
          <Link
            href="/now"
            className="min-w-0 flex-1 truncate font-display text-[20px] italic text-[var(--ink)]"
          >
            DevPlanner
          </Link>
          <IconCircleButton
            className="h-8 w-8"
            title="Notifications"
            aria-label="Notifications"
            onClick={() => {
              setCommandOpen(false);
              setBrainOpen(false);
              setNotificationsOpen(true);
            }}
          >
            <Bell size={14} />
          </IconCircleButton>
          <IconCircleButton
            className="h-8 w-8"
            title="Switch theme"
            aria-label="Switch theme"
            onClick={toggleTheme}
          >
            {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
          </IconCircleButton>
          <div
            className="relative shrink-0"
            onKeyDown={(event) => {
              if (event.key === "Escape") setMobileMoreOpen(false);
            }}
          >
            <IconCircleButton
              className="h-8 w-8"
              title="More options"
              aria-label="More options"
              aria-haspopup="menu"
              aria-expanded={mobileMoreOpen}
              aria-controls="mobile-more-menu"
              onClick={() => setMobileMoreOpen((value) => !value)}
            >
              <MoreHorizontal size={17} />
            </IconCircleButton>
            {mobileMoreOpen && (
              <div
                id="mobile-more-menu"
                role="menu"
                aria-label="More options"
                className="absolute right-0 top-10 z-50 min-w-40 overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--card)] p-1 shadow-xl"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-[var(--ink)] hover:bg-[var(--teal-a08)]"
                  onClick={() => {
                    setMobileMoreOpen(false);
                    window.dispatchEvent(new Event("devplanner:open-ai"));
                  }}
                >
                  <Bot size={15} />
                  Ask AI
                </button>
                <Link
                  href={SETTINGS_NAV.href}
                  role="menuitem"
                  className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-[var(--ink)] hover:bg-[var(--teal-a08)]"
                  onClick={() => setMobileMoreOpen(false)}
                >
                  <Settings size={15} />
                  Settings
                </Link>
              </div>
            )}
          </div>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--teal)]">
            <UserButton afterSignOutUrl="/login" />
          </div>
        </header>

        {/* ─── Main content ──────────────────────────────────────── */}
        <main className="flex-1 px-5 pb-32 pt-6 md:px-12 md:pb-16 md:pt-10">
          {children}
        </main>

        {/* ─── Mobile: floating capture + bottom tab bar ─────────── */}
        {pathname !== "/now" && (
          <button
            type="button"
            className="fixed bottom-[86px] right-4 z-40 inline-flex items-center gap-2 rounded-full bg-[var(--ink-btn-bg)] px-[18px] py-[11px] text-[13px] font-semibold text-[var(--ink-btn-fg)] shadow-[var(--card-shadow)] transition-opacity hover:opacity-85 md:hidden"
            onClick={() => setQuickOpen(true)}
          >
            <Lightbulb size={13} />
            Add task
          </button>
        )}
        <nav
          className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--hairline)] bg-background/90 px-2 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-3 backdrop-blur-md md:hidden"
          aria-label="Main"
        >
          {NAV.map(({ href, label, Icon, matches }) => {
            const active = isNavActive(pathname, matches);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 text-[11px] transition-colors",
                  active ? "font-semibold text-[var(--teal)]" : "text-muted",
                )}
              >
                <Icon size={20} />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
      <BrainDumpModal open={brainOpen} onClose={() => setBrainOpen(false)} />
      <QuickAddTask
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        initialDate={preferencesQ.data ? todayDate : undefined}
        defaultDestination={pathname === "/now" ? "today" : "inbox"}
      />
      <NotificationsTray
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
      />
      <CommandMenu
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onBrainDump={openBrainDump}
      />
      <AiChatDock />
    </div>
  );
}
