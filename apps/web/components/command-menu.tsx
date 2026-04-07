"use client";

import { Command } from "cmdk";
import {
  BarChart3,
  CalendarCheck,
  ChartGantt,
  Inbox,
  KanbanSquare,
  LayoutList,
  Lightbulb,
  Settings,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

const NAV_ITEMS = [
  { href: "/board", label: "Board", icon: KanbanSquare },
  { href: "/now", label: "Now", icon: Zap },
  { href: "/timeline", label: "Timeline", icon: ChartGantt },
  { href: "/table", label: "Table", icon: LayoutList },
  { href: "/backlog", label: "Backlog", icon: Inbox },
  { href: "/sprints", label: "Sprints", icon: CalendarCheck },
  { href: "/review", label: "Weekly review", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function CommandMenu({
  open,
  onOpenChange,
  onBrainDump,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBrainDump: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const t = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [open]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        onOpenChange(false);
        onBrainDump();
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [open, onOpenChange, onBrainDump]);

  const q = query.trim().toLowerCase();
  const navFiltered = useMemo(() => {
    if (!q) return [...NAV_ITEMS];
    return NAV_ITEMS.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.href.toLowerCase().includes(q) ||
        item.href.replace("/", "").includes(q)
    );
  }, [q]);

  const brainMatches =
    !q ||
    "brain dump".includes(q) ||
    ["brain", "dump", "lightbulb"].some((k) => k.includes(q) || q.includes(k));

  function go(path: string) {
    router.push(path);
    onOpenChange(false);
  }

  if (!open) return null;

  const nothingMatches = navFiltered.length === 0 && !brainMatches;

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 p-4 pt-[15vh] animate-fadeIn"
      onClick={() => onOpenChange(false)}
    >
      <Command
        shouldFilter={false}
        className="mx-auto max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-surface shadow-2xl animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        <Command.Input
          ref={inputRef}
          value={query}
          onValueChange={setQuery}
          placeholder="Search…"
          className="w-full border-b border-white/10 bg-transparent px-4 py-3.5 text-sm text-foreground outline-none placeholder:text-muted/50"
        />
        <Command.List className="max-h-72 overflow-auto p-2 text-sm">
          {nothingMatches ? (
            <p className="px-3 py-6 text-center text-muted">No commands found.</p>
          ) : (
            <>
              <Command.Empty className="hidden" />
              {navFiltered.length > 0 && (
                <Command.Group
                  heading="Navigate"
                  className="text-[10px] uppercase tracking-wider text-muted mb-1"
                >
                  {navFiltered.map(({ href, label, icon: Icon }) => (
                    <Command.Item
                      key={href}
                      value={`${label} ${href}`}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-foreground aria-selected:bg-white/10"
                      onSelect={() => go(href)}
                    >
                      <Icon size={14} className="text-muted" />
                      {label}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {navFiltered.length > 0 && brainMatches && (
                <Command.Separator className="my-1 border-t border-white/5" />
              )}
              {brainMatches && (
                <Command.Group
                  heading="Actions"
                  className="text-[10px] uppercase tracking-wider text-muted mb-1"
                >
                  <Command.Item
                    value="brain dump"
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-foreground aria-selected:bg-white/10"
                    onSelect={() => {
                      onBrainDump();
                      onOpenChange(false);
                    }}
                  >
                    <Lightbulb size={14} className="text-muted" />
                    Brain dump
                    <span className="ml-auto text-[10px] text-muted/60">Ctrl/Cmd+Shift+D</span>
                  </Command.Item>
                </Command.Group>
              )}
            </>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
