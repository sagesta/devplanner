"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Bot, Send, Wrench, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type Message = {
  role: "user" | "assistant";
  content: string;
};

const LS_TOOLS = "devplanner.aiToolsEnabled";

const SUGGESTED_PROMPTS = [
  "Plan my week",
  "What's overdue?",
  "Delete the tasks marked as done",
  "List my tasks in progress",
];

export function AiChatDock() {
  const userId = useAppUserId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<AiConfigResponse | null>(null);
  const [model, setModel] = useState("");
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const m = localStorage.getItem(LS_CHAT_MODEL);
    if (m) setModel(m);
    setToolsEnabled(localStorage.getItem(LS_TOOLS) !== "0");
  }, []);

  useEffect(() => {
    if (!open) return;
    void fetchAiConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, [open]);

  const effectiveModel = useMemo(() => {
    const allowed = config?.allowedChatModels?.length ? config.allowedChatModels : ["gpt-4o-mini"];
    const def = config?.defaultChatModel ?? "gpt-4o-mini";
    const pick = model || def;
    return allowed.includes(pick) ? pick : def;
  }, [model, config]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, 50);
  }, []);

  function persistModel(next: string) {
    setModel(next);
    if (typeof window !== "undefined") localStorage.setItem(LS_CHAT_MODEL, next);
  }

  function persistTools(on: boolean) {
    setToolsEnabled(on);
    if (typeof window !== "undefined") localStorage.setItem(LS_TOOLS, on ? "1" : "0");
  }

  async function send() {
    if (!userId || !msg.trim()) return;
    const displayMsg = msg.trim();
    let apiMessage = displayMsg;
    if (typeof window !== "undefined" && localStorage.getItem(LS_AI_BUDGET) === "1") {
      apiMessage =
        "[User preference: respect daily work/personal time budgets when planning.]\n" + apiMessage;
    }
    setMsg("");
    setMessages((prev) => [...prev, { role: "user", content: displayMsg }]);
    setLoading(true);
    scrollToBottom();

    const energySuggestOn =
      typeof window === "undefined" || localStorage.getItem(LS_AI_ENERGY_SUGGEST) !== "0";
    const physicalEnergy = (() => {
      if (!energySuggestOn) return undefined;
      const v = typeof window !== "undefined" ? localStorage.getItem(LS_PHYSICAL_ENERGY) : null;
      return v === "low" || v === "medium" || v === "high" ? (v as PhysicalEnergyLevel) : undefined;
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
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

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
            copy[copy.length - 1] = { role: "assistant", content: "(No response)" };
            return copy;
          });
        }

        if (toolsEnabled) {
          void qc.invalidateQueries({ queryKey: ["tasks"] });
          void qc.invalidateQueries({ queryKey: ["backlog"] });
          void qc.invalidateQueries({ queryKey: ["tasks-today"] });
          void qc.invalidateQueries({ queryKey: ["task"] });
        }
      } else {
        const j = (await res.json()) as { reply?: string };
        setMessages((prev) => [...prev, { role: "assistant", content: j.reply ?? "(No response)" }]);
      }
    } catch (e) {
      toast.error(String(e));
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${String(e)}` }]);
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
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <Bot size={16} className="text-primary shrink-0" />
              <span className="text-sm font-medium text-foreground truncate">AI Assistant</span>
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

          {config && !config.openaiKeySet && (
            <div className="mx-3 mt-3 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100/95 leading-snug">
              <strong className="text-amber-50">No API key.</strong> Set{" "}
              <code className="rounded bg-black/25 px-1">OPENAI_API_KEY</code> on the API server, then restart the
              API. Chat will stay in stub mode until then.
            </div>
          )}

          <div
            ref={scrollRef}
            className="max-h-[50vh] min-h-[180px] overflow-auto px-4 py-3 space-y-3"
          >
            {messages.length === 0 && (
              <div className="space-y-3 py-2">
                <p className="text-center text-xs text-muted leading-relaxed">
                  Ask what to work on, change your schedule, or use task tools to edit your board.
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
                {m.content || (loading && i === messages.length - 1 && (
                  <span className="inline-flex gap-1 text-muted">
                    <span className="animate-pulse">●</span>
                    <span className="animate-pulse" style={{ animationDelay: "150ms" }}>●</span>
                    <span className="animate-pulse" style={{ animationDelay: "300ms" }}>●</span>
                  </span>
                ))}
              </div>
            ))}
          </div>

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
                  {(config?.allowedChatModels ?? ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"]).map((m) => (
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
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
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
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
      <button
        type="button"
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
