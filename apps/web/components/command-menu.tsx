"use client";

import { Command } from "cmdk";
import {
  BarChart3,
  Bot,
  CalendarCheck,
  ChartGantt,
  Inbox,
  KanbanSquare,
  LayoutList,
  Lightbulb,
  Plus,
  Settings,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function CommandMenu({
  onBrainDump,
}: {
  onBrainDump: () => void;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        onBrainDump();
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [onBrainDump]);

  function go(path: string) {
    router.push(path);
    setOpen(false);
  }

  if (!open) return null;

  const NAV_ITEMS = [
    { href: "/board", label: "Board", icon: KanbanSquare },
    { href: "/now", label: "Now", icon: Zap },
    { href: "/timeline", label: "Timeline", icon: ChartGantt },
    { href: "/table", label: "Table", icon: LayoutList },
    { href: "/backlog", label: "Backlog", icon: Inbox },
    { href: "/sprints", label: "Sprints", icon: CalendarCheck },
    { href: "/review", label: "Weekly review", icon: BarChart3 },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 p-4 pt-[15vh] animate-fadeIn"
      onClick={() => setOpen(false)}
    >
      <Command
        className="mx-auto max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-surface shadow-2xl animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        <Command.Input
          placeholder="Jump to…"
          className="w-full border-b border-white/10 bg-transparent px-4 py-3.5 text-sm text-foreground outline-none placeholder:text-muted/50"
        />
        <Command.List className="max-h-72 overflow-auto p-2 text-sm">
          <Command.Empty className="px-3 py-6 text-center text-muted">
            No results found.
          </Command.Empty>
          <Command.Group heading="Navigate" className="text-[10px] uppercase tracking-wider text-muted mb-1">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
              <Command.Item
                key={href}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-foreground aria-selected:bg-white/10"
                onSelect={() => go(href)}
              >
                <Icon size={14} className="text-muted" />
                {label}
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Separator className="my-1 border-t border-white/5" />
          <Command.Group heading="Actions" className="text-[10px] uppercase tracking-wider text-muted mb-1">
            <Command.Item
              className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-foreground aria-selected:bg-white/10"
              onSelect={() => {
                onBrainDump();
                setOpen(false);
              }}
            >
              <Lightbulb size={14} className="text-muted" />
              Brain dump
              <span className="ml-auto text-[10px] text-muted/60">Ctrl/Cmd+Shift+D</span>
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
