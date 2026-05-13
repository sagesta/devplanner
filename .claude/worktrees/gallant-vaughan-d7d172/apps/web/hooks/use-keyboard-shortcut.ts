"use client";

import { useEffect } from "react";

export type ShortcutModifier = "ctrl" | "meta" | "shift" | "alt";

export type ShortcutSpec = {
  /** Lowercase key (e.g. "k", " ", "?", "escape"). For " ", the actual event.key is " ". */
  key: string;
  /** Required modifiers. `ctrl` matches ctrl OR meta (cross-platform). */
  modifiers?: ShortcutModifier[];
  /** If true, the shortcut still fires while the user is typing in an input/textarea. Default false. */
  allowInInputs?: boolean;
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

function matches(e: KeyboardEvent, spec: ShortcutSpec): boolean {
  const want = new Set(spec.modifiers ?? []);
  const ctrlOrMeta = e.ctrlKey || e.metaKey;
  if (want.has("ctrl") || want.has("meta")) {
    if (!ctrlOrMeta) return false;
  } else if (ctrlOrMeta) {
    // No ctrl requested → reject ctrl-modified events to avoid swallowing
    // browser shortcuts like Ctrl+R, Ctrl+F.
    return false;
  }
  if (want.has("shift") !== e.shiftKey) return false;
  if (want.has("alt") !== e.altKey) return false;
  return e.key.toLowerCase() === spec.key.toLowerCase();
}

/**
 * Register a global keyboard shortcut. Handler fires once per matched keydown.
 *
 * Skips events that originate inside form fields unless `allowInInputs: true`.
 */
export function useKeyboardShortcut(
  spec: ShortcutSpec | null,
  handler: (e: KeyboardEvent) => void
): void {
  useEffect(() => {
    if (!spec) return;
    const onKey = (e: KeyboardEvent) => {
      if (!matches(e, spec)) return;
      if (!spec.allowInInputs && isTypingTarget(e.target)) return;
      e.preventDefault();
      handler(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spec?.key, spec?.modifiers?.join(","), spec?.allowInInputs, handler]);
}
