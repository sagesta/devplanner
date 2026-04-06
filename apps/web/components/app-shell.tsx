"use client";

import {
  BarChart3,
  CalendarCheck,
  ChartGantt,
  Inbox,
  KanbanSquare,
  LayoutList,
  Lightbulb,
  Settings,
  Sun,
  Moon,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AiChatDock } from "@/components/ai-chat-dock";
import { BrainDumpModal } from "@/components/brain-dump-modal";
import { CommandMenu } from "@/components/command-menu";
import { IdleBanner } from "@/components/idle-banner";
import { getDevUserId } from "@/lib/env";
import { cn } from "@/lib/utils";

const NAV = [
  ["/board", "Board", KanbanSquare],
  ["/now", "Now", Zap],
  ["/timeline", "Timeline", ChartGantt],
  ["/table", "Table", LayoutList],
  ["/backlog", "Backlog", Inbox],
  ["/sprints", "Sprints", CalendarCheck],
  ["/review", "Review", BarChart3],
  ["/settings", "Settings", Settings],
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [brainOpen, setBrainOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = localStorage.getItem("devplanner-theme") as "dark" | "light" | null;
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("devplanner-theme", theme);
  }, [theme]);

  const userId = getDevUserId();

  return (
    <div className="min-h-screen">
      <IdleBanner />
      <div className="flex min-h-screen">
        {/* ─── Desktop sidebar ──────────────────────────────────── */}
        <aside className="hidden w-56 shrink-0 border-r border-white/10 bg-surface md:flex md:flex-col">
          <div className="p-5">
            <p className="font-display text-xl text-foreground tracking-tight">DevPlanner</p>
            <p className="mt-0.5 text-[10px] text-muted">ADHD-friendly planner</p>
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 px-3 pb-4">
            {NAV.map(([href, label, Icon]) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all",
                    active
                      ? "bg-primary/10 text-foreground border-l-2 border-primary pl-2.5"
                      : "text-muted hover:bg-white/5 hover:text-foreground"
                  )}
                >
                  <Icon
                    size={16}
                    className={cn(
                      "shrink-0 transition-colors",
                      active ? "text-primary" : "text-muted group-hover:text-foreground"
                    )}
                  />
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-white/10 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px] text-muted hover:bg-white/10 hover:text-foreground transition-colors"
                onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              >
                {theme === "dark" ? <Sun size={12} /> : <Moon size={12} />}
                {theme === "dark" ? "Light" : "Dark"}
              </button>
              <span className="text-[10px] text-muted/60">
                {userId ? "✓ connected" : "⚠ no user"}
              </span>
            </div>
            <button
              type="button"
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary/80 py-2 text-[11px] font-medium text-white hover:bg-primary transition-colors"
              onClick={() => setBrainOpen(true)}
            >
              <Lightbulb size={12} />
              Brain dump
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
                onClick={() => setBrainOpen(true)}
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
                const active = pathname === href;
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
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
      <BrainDumpModal open={brainOpen} onClose={() => setBrainOpen(false)} />
      <CommandMenu onBrainDump={() => setBrainOpen(true)} />
      <AiChatDock />
    </div>
  );
}
