"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AtSign, Bot, Send, Wrench, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { fetchAiConfig, type AiConfigResponse } from "@/lib/api";
import { getApiBase } from "@/lib/env";
import {
  LS_AI_BUDGET,
  LS_AI_ENERGY_SUGGEST,
  LS_CHAT_MODEL,
  LS_PHYSICAL_ENERGY,
  type PhysicalEnergyLevel,
} from "@/lib/planner-prefs";
import { cn } from "@/lib/utils";
import { MarkdownMessage } from "./MarkdownMessage";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type TaskSuggestion = {
  id: string;
  title: string;
  status: string;
  priority: string;
};

const LS_TOOLS = "devplanner.aiToolsEnabled";

/** Map pathname segments to view names the backend recognises */
const VIEW_NAMES: Record<string, string> = {
  board: "Board",
  now: "Now",
  timeline: "Timeline",
  table: "Table",
  backlog: "Backlog",
  sprints: "Sprints",
  review: "Review",
};

const SUGGESTED_PROMPTS = [
  "Plan my week",
  "What's overdue?",
  "Show my weekly progress",
  "Delete the tasks marked as done",
];

// ─── Task Selector Panel ────────────────────────────────────────────────────

function TaskSelectorPanel({
  onSelect,
  onClose,
  alreadySelected,
}: {
  onSelect: (task: TaskSuggestion) => void;
  onClose: () => void;
  alreadySelected: string[];
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TaskSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const id = setTimeout(async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`${getApiBase()}/api/tasks`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          tasks: Array<{
            id: string;
            title: string;
            status: string;
            priority: string;
          }>;
        };
        const lower = query.toLowerCase();
        setResults(
          data.tasks
            .filter((t) => t.title.toLowerCase().includes(lower))
            .slice(0, 8)
        );
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

  return (
    <div className="absolute bottom-full mb-2 left-0 right-0 z-50 rounded-xl border border-white/10 bg-surface shadow-xl">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <AtSign size={13} className="text-primary shrink-0" />
        <input
          ref={inputRef}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted/60 outline-none"
          placeholder="Search tasks to mention…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
        />
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-muted hover:text-foreground"
          aria-label="Close task selector"
        >
          <X size={13} />
        </button>
      </div>
      <div className="max-h-[220px] overflow-auto py-1">
        {loading && (
          <p className="px-3 py-2 text-xs text-muted">Searching…</p>
        )}
        {!loading && query.trim() && results.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted">No tasks found</p>
        )}
        {!loading && !query.trim() && (
          <p className="px-3 py-2 text-xs text-muted">
            Start typing to search tasks
          </p>
        )}
        {results.map((t) => {
          const selected = alreadySelected.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              disabled={selected}
              onClick={() => {
                onSelect(t);
                onClose();
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                selected
                  ? "opacity-40 cursor-not-allowed"
                  : "hover:bg-white/5 cursor-pointer"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  t.status === "done" && "bg-emerald-500",
                  t.status === "in_progress" && "bg-amber-500",
                  t.status === "todo" && "bg-blue-500",
                  t.status === "backlog" && "bg-zinc-500",
                  t.status === "blocked" && "bg-red-600"
                )}
              />
              <span className="flex-1 truncate text-foreground">{t.title}</span>
              <span className="shrink-0 text-[10px] text-muted capitalize">
                {t.priority}
              </span>
              {selected && (
                <span className="shrink-0 text-[10px] text-primary">
                  added
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function AiChatDock() {
  const pathname = usePathname();
  const userId = useAppUserId();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<AiConfigResponse | null>(null);
  const [model, setModel] = useState("");
  const [toolsEnabled, setToolsEnabled] = useState(true);

  // Task selector
  const [showSelector, setShowSelector] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState<TaskSuggestion[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputAreaRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }, 50);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const m = localStorage.getItem(LS_CHAT_MODEL);
    if (m) setModel(m);
    setToolsEnabled(localStorage.getItem(LS_TOOLS) !== "0");

    // Restore chat history for this session
    try {
      const stored = sessionStorage.getItem("devplanner.aiChatHistory");
      if (stored) {
        setMessages(JSON.parse(stored));
        // Small delay to let rendering happen
        setTimeout(scrollToBottom, 50);
      }
    } catch {
      // silent
    }
  }, [scrollToBottom]);

  // Save chat history to session storage when it changes
  useEffect(() => {
    if (typeof window !== "undefined" && messages.length > 0) {
      sessionStorage.setItem("devplanner.aiChatHistory", JSON.stringify(messages));
    }
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    void fetchAiConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, [open]);

  // Close selector on outside click
  useEffect(() => {
    if (!showSelector) return;
    const handler = (e: MouseEvent) => {
      if (!inputAreaRef.current?.contains(e.target as Node)) {
        setShowSelector(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSelector]);

  const effectiveModel = useMemo(() => {
    const allowed = config?.allowedChatModels?.length
      ? config.allowedChatModels
      : ["gpt-5-nano"];
    const def = config?.defaultChatModel ?? "gpt-5-nano";
    const pick = model || def;
    return allowed.includes(pick) ? pick : def;
  }, [model, config]);

  function persistModel(next: string) {
    setModel(next);
    if (typeof window !== "undefined") localStorage.setItem(LS_CHAT_MODEL, next);
  }

  function persistTools(on: boolean) {
    setToolsEnabled(on);
    if (typeof window !== "undefined")
      localStorage.setItem(LS_TOOLS, on ? "1" : "0");
  }

  function removeSelectedTask(id: string) {
    setSelectedTasks((prev) => prev.filter((t) => t.id !== id));
  }

  async function send() {
    if (!userId || !msg.trim()) return;

    const displayMsg = msg.trim();
    let apiMessage = displayMsg;

    // Prepend selected task context if any were pinned
    if (selectedTasks.length > 0) {
      const taskMentions = selectedTasks
        .map((t) => `  • "${t.title}" (${t.status})`)
        .join("\n");
      apiMessage = `[User is focused on these tasks:\n${taskMentions}]\n\n${displayMsg}`;
    }

    if (
      typeof window !== "undefined" &&
      localStorage.getItem(LS_AI_BUDGET) === "1"
    ) {
      apiMessage =
        "[User preference: respect daily work/personal time budgets when planning.]\n" +
        apiMessage;
    }

    setMsg("");
    setMessages((prev) => [
      ...prev,
      { role: "user", content: displayMsg },
      { role: "assistant", content: "" }
    ]);
    setLoading(true);
    scrollToBottom();

    const energySuggestOn =
      typeof window === "undefined" ||
      localStorage.getItem(LS_AI_ENERGY_SUGGEST) !== "0";
    const physicalEnergy = (() => {
      if (!energySuggestOn) return undefined;
      const v =
        typeof window !== "undefined"
          ? localStorage.getItem(LS_PHYSICAL_ENERGY)
          : null;
      return v === "low" || v === "medium" || v === "high"
        ? (v as PhysicalEnergyLevel)
        : undefined;
    })();

    try {
      const res = await fetch(`${getApiBase()}/api/ai/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: apiMessage,
          model: effectiveModel,
          enableTools: toolsEnabled,
          currentPhysicalEnergy: physicalEnergy,
          current_view:
            VIEW_NAMES[pathname.split("/").filter(Boolean)[0] ?? ""] ??
            undefined,
          selected_task_ids:
            selectedTasks.length > 0
              ? selectedTasks.map((t) => t.id)
              : undefined,
          history: messages.slice(-10),
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "Chat failed");
        throw new Error(text);
      }

      if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          const current = accumulated;
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: "assistant", content: current };
            return copy;
          });
          scrollToBottom();
        }

        if (!accumulated.trim()) {
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = {
              role: "assistant",
              content: "(No response)",
            };
            return copy;
          });
        }

        if (toolsEnabled) {
          void qc.invalidateQueries({ queryKey: ["tasks"] });
          void qc.invalidateQueries({ queryKey: ["backlog"] });
          void qc.invalidateQueries({ queryKey: ["tasks-today"] });
          void qc.invalidateQueries({ queryKey: ["task"] });
          void qc.invalidateQueries({ queryKey: ["sprintTasks"] });
        }
      } else {
        const j = (await res.json()) as { reply?: string };
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            role: "assistant",
            content: j.reply ?? "(No response)",
          };
          return copy;
        });
      }

      // Clear selected tasks after a successful send
      setSelectedTasks([]);
    } catch (e) {
      toast.error(String(e));
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: "assistant",
          content: `Error: ${String(e)}`,
        };
        return copy;
      });
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }

  if (!userId) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {open && (
        <div
          id="ai-chat-panel"
          className={cn(
            "glass w-[min(100vw-2rem,400px)] rounded-2xl shadow-2xl overflow-hidden",
            "animate-aiPanel"
          )}
          role="dialog"
          aria-label="AI Assistant"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <Bot size={16} className="text-primary shrink-0" />
              <span className="text-sm font-medium text-foreground truncate">
                AI Assistant
              </span>
              {selectedTasks.length > 0 && (
                <span className="ml-1 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {selectedTasks.length} task
                  {selectedTasks.length !== 1 ? "s" : ""} pinned
                </span>
              )}
            </div>
            <button
              type="button"
              className="rounded-lg p-1.5 text-muted hover:bg-white/10 hover:text-foreground shrink-0"
              aria-label="Close assistant"
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
          </div>

          {/* No API key warning */}
          {config && !config.openaiKeySet && (
            <div className="mx-3 mt-3 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100/95 leading-snug">
              <strong className="text-amber-50">No API key.</strong> Set{" "}
              <code className="rounded bg-black/25 px-1">OPENAI_API_KEY</code>{" "}
              on the API server, then restart the API.
            </div>
          )}

          {/* Pinned tasks chips */}
          {selectedTasks.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2">
              {selectedTasks.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 pl-2 pr-1 py-0.5 text-[10px] text-primary max-w-[160px]"
                >
                  <span className="truncate">{t.title}</span>
                  <button
                    type="button"
                    onClick={() => removeSelectedTask(t.id)}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-primary/20"
                    aria-label={`Remove ${t.title}`}
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Messages */}
          <div
            ref={scrollRef}
            className="max-h-[50vh] min-h-[180px] overflow-auto px-4 py-3 space-y-3"
          >
            {messages.length === 0 && (
              <div className="space-y-3 py-2">
                <p className="text-center text-xs text-muted leading-relaxed">
                  Ask what to work on, change your schedule, or use task tools
                  to edit your board.{" "}
                  <strong className="text-foreground/70">@</strong> to pin tasks
                  for context.
                </p>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted/70 mb-2">
                    Suggested prompts
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {SUGGESTED_PROMPTS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-foreground/90 hover:bg-white/10 hover:border-white/20 transition-colors"
                        onClick={() => {
                          setMsg(s);
                          setTimeout(() => inputRef.current?.focus(), 0);
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "text-sm leading-relaxed",
                  m.role === "user"
                    ? "ml-6 rounded-xl rounded-br-sm bg-primary/15 px-3 py-2 text-foreground"
                    : "mr-6 text-foreground/90"
                )}
              >
                {m.content ? (
                  m.role === "assistant" ? (
                    <MarkdownMessage content={m.content} />
                  ) : (
                    m.content
                  )
                ) : (
                  loading &&
                  i === messages.length - 1 && (
                    <span className="inline-flex gap-1 text-muted animate-pulse font-medium">
                      ...loading
                    </span>
                  )
                )}
              </div>
            ))}
          </div>

          {/* Controls + input */}
          <div className="border-t border-white/10 px-3 py-2 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[10px] text-muted">
                <Wrench size={11} className="text-primary/80" />
                Model
                <select
                  className="rounded-md border border-white/10 bg-background/80 px-1.5 py-1 text-[11px] text-foreground max-w-[140px]"
                  value={effectiveModel}
                  onChange={(e) => persistModel(e.target.value)}
                >
                  {(
                    config?.allowedChatModels ?? ["gpt-5-nano"]
                  ).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-[10px] text-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded border-white/20"
                  checked={toolsEnabled}
                  onChange={(e) => persistTools(e.target.checked)}
                />
                Task tools
              </label>
            </div>

            {/* Input row with @ button */}
            <div ref={inputAreaRef} className="relative flex gap-2">
              {/* Task selector panel */}
              {showSelector && (
                <TaskSelectorPanel
                  onSelect={(t) =>
                    setSelectedTasks((prev) =>
                      prev.find((x) => x.id === t.id) ? prev : [...prev, t]
                    )
                  }
                  onClose={() => setShowSelector(false)}
                  alreadySelected={selectedTasks.map((t) => t.id)}
                />
              )}

              {/* @ mention button */}
              <button
                type="button"
                title="Pin a task for context (@mention)"
                aria-label="Select task to mention"
                onClick={() => setShowSelector((s) => !s)}
                className={cn(
                  "self-end shrink-0 rounded-xl p-2.5 transition-colors",
                  showSelector
                    ? "bg-primary/20 text-primary"
                    : "text-muted hover:bg-white/10 hover:text-foreground"
                )}
              >
                <AtSign size={14} />
              </button>

              <textarea
                ref={inputRef}
                id="ai-chat-input"
                className="flex-1 resize-none rounded-xl border border-white/10 bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted/50"
                rows={2}
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                placeholder="What should I do now?"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <button
                type="button"
                disabled={loading || !msg.trim()}
                className="self-end shrink-0 rounded-xl bg-primary p-2.5 text-white disabled:opacity-30 hover:bg-primary-hover transition-colors"
                onClick={() => void send()}
                aria-label="Send message"
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FAB toggle */}
      <button
        type="button"
        id="ai-chat-toggle"
        className={cn(
          "rounded-full px-4 py-2.5 text-sm font-medium text-white shadow-lg transition-all duration-300",
          "bg-primary hover:bg-primary-hover hover:shadow-xl hover:scale-105",
          open && "ring-2 ring-primary/40 ring-offset-2 ring-offset-background scale-[0.97]"
        )}
        aria-expanded={open}
        aria-controls="ai-chat-panel"
        onClick={() => {
          setOpen((o) => !o);
          setTimeout(() => inputRef.current?.focus(), 120);
        }}
      >
        <Bot size={16} className="inline mr-1" />
        AI
      </button>
    </div>
  );
}
