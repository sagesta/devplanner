"use client";

import {
  Bell,
  CalendarCheck,
  Inbox,
  Lightbulb,
  Settings,
  Sun,
  Moon,
  Target,
  Trophy,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { AiChatDock } from "@/components/ai-chat-dock";
import { BrainDumpModal } from "@/components/brain-dump-modal";
import { CommandMenu } from "@/components/command-menu";
import { GlobalTimerIndicator } from "@/components/GlobalTimerIndicator";
import { NotificationsTray } from "@/components/notifications-tray";
import { IdleBanner } from "@/components/idle-banner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/now", label: "Today", Icon: Zap, matches: ["/now"] },
  { href: "/backlog", label: "Inbox", Icon: Inbox, matches: ["/backlog"] },
  { href: "/plan", label: "Plan", Icon: CalendarCheck, matches: ["/plan", "/sprints", "/board", "/timeline", "/table"] },
  { href: "/review", label: "Review", Icon: Trophy, matches: ["/review", "/insights"] },
  { href: "/goals", label: "Goals", Icon: Target, matches: ["/goals"] },
] as const;

const SETTINGS_NAV = { href: "/settings", label: "Settings", Icon: Settings, matches: ["/settings"] } as const;

function isNavActive(pathname: string, matches: readonly string[]) {
  return matches.some((href) => pathname === href || pathname.startsWith(`${href}/`));
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
        className
      )}
      {...props}
    />
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [brainOpen, setBrainOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  // Daybook is light-first; saved preference still wins.
  const [theme, setTheme] = useState<"dark" | "light">("light");

  useEffect(() => {
    const saved = localStorage.getItem("devplanner-theme") as "dark" | "light" | null;
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("devplanner-theme", theme);
  }, [theme]);

  // Per-page <title> for browser tabs / history — "Today — DevPlanner" etc.
  useEffect(() => {
    const match = [...NAV, SETTINGS_NAV].find((item) => isNavActive(pathname, item.matches));
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
    return () => window.removeEventListener("devplanner:open-brain-dump", onOpenBrainDump);
  }, []);

  const { user } = useUser();
  const userId = useAppUserId();
  const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";

  const openBrainDump = () => {
    setCommandOpen(false);
    setNotificationsOpen(false);
    setBrainOpen(true);
  };

  return (
    <div className="min-h-screen [overflow-x:clip]">
      <IdleBanner />
      <div className="flex min-h-screen flex-col">
        {/* ─── Top nav (desktop) ─────────────────────────────────── */}
        <header className="hidden items-center gap-8 border-b border-[var(--hairline)] px-12 py-[18px] md:flex">
          <Link href="/now" className="font-display text-[22px] italic leading-none text-[var(--ink)]">
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
                      : "text-muted hover:bg-[var(--teal-a08)] hover:text-[var(--ink)]"
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
              onClick={openBrainDump}
            >
              <Lightbulb size={13} />
              Brain dump
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
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
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
                  : "border-[var(--hairline)] text-muted hover:bg-[var(--teal-a08)] hover:text-[var(--ink)]"
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
          <Link href="/now" className="min-w-0 flex-1 truncate font-display text-[20px] italic text-[var(--ink)]">
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
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          >
            {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
          </IconCircleButton>
          <Link
            href={SETTINGS_NAV.href}
            aria-label="Settings"
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors",
              isNavActive(pathname, SETTINGS_NAV.matches)
                ? "border-[var(--teal-a30)] bg-[var(--teal-a12)] text-[var(--ink)]"
                : "border-[var(--hairline)] text-muted hover:bg-[var(--teal-a08)] hover:text-[var(--ink)]"
            )}
          >
            <Settings size={14} />
          </Link>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--teal)]">
            <UserButton afterSignOutUrl="/login" />
          </div>
        </header>

        {/* ─── Main content ──────────────────────────────────────── */}
        <main className="flex-1 px-5 pb-32 pt-6 md:px-12 md:pb-16 md:pt-10">{children}</main>

        {/* ─── Mobile: floating capture + bottom tab bar ─────────── */}
        <button
          type="button"
          className="fixed bottom-[86px] right-4 z-40 inline-flex items-center gap-2 rounded-full bg-[var(--ink-btn-bg)] px-[18px] py-[11px] text-[13px] font-semibold text-[var(--ink-btn-fg)] shadow-[var(--card-shadow)] transition-opacity hover:opacity-85 md:hidden"
          onClick={openBrainDump}
        >
          <Lightbulb size={13} />
          Dump
        </button>
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
                  active ? "font-semibold text-[var(--teal)]" : "text-muted"
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
      <NotificationsTray open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
      <CommandMenu
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onBrainDump={openBrainDump}
      />
      <AiChatDock />
    </div>
  );
}
