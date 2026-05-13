"use client";

import { Keyboard, X } from "lucide-react";
import { useEffect } from "react";

type Row = {
  keys: string[];
  label: string;
};

const SHORTCUTS: { group: string; rows: Row[] }[] = [
  {
    group: "Navigation",
    rows: [
      { keys: ["Ctrl", "K"], label: "Open command palette / search" },
      { keys: ["Alt", "T"], label: "Toggle notifications tray" },
      { keys: ["?"], label: "Show this help" },
      { keys: ["Esc"], label: "Close panels / modals" },
    ],
  },
  {
    group: "Capture",
    rows: [
      { keys: ["Ctrl", "Space"], label: "Quick capture to Inbox (single line)" },
      { keys: ["Ctrl", "Shift", "D"], label: "Brain dump (multi-line)" },
    ],
  },
];

export function ShortcutsHelp({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[75] flex items-start justify-center bg-black/60 p-4 pt-[12vh] animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-surface shadow-2xl animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <Keyboard size={14} className="text-muted" />
            <p className="text-sm font-medium text-foreground">Keyboard shortcuts</p>
          </div>
          <button
            type="button"
            className="rounded p-1 text-muted hover:bg-white/5 hover:text-foreground transition-colors"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-auto p-4 space-y-5">
          {SHORTCUTS.map((g) => (
            <div key={g.group}>
              <p className="mb-2 text-[10px] uppercase tracking-wider text-muted">
                {g.group}
              </p>
              <ul className="space-y-1.5">
                {g.rows.map((r) => (
                  <li
                    key={r.label}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-foreground/90">{r.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {r.keys.map((k, i) => (
                        <kbd
                          key={`${k}-${i}`}
                          className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-foreground"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="border-t border-white/5 pt-3 text-[11px] text-muted/70">
            On macOS, <kbd className="font-mono">Cmd</kbd> stands in for{" "}
            <kbd className="font-mono">Ctrl</kbd>.
          </p>
        </div>
      </div>
    </div>
  );
}
