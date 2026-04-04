"use client";

import { Bot, Send, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { getApiBase, getDevUserId } from "@/lib/env";
import { cn } from "@/lib/utils";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export function AiChatDock() {
  const userId = getDevUserId();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, 50);
  }, []);

  async function send() {
    if (!userId || !msg.trim()) return;
    const userMsg = msg.trim();
    setMsg("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);
    scrollToBottom();

    try {
      const res = await fetch(`${getApiBase()}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, message: userMsg }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "Chat failed");
        throw new Error(text);
      }

      // Stream response
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

        // If empty response, fall back
        if (!accumulated.trim()) {
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: "assistant", content: "(No response)" };
            return copy;
          });
        }
      } else {
        // Fallback for non-streaming
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
        <div className="glass w-[min(100vw-2rem,400px)] rounded-2xl shadow-2xl animate-scaleIn">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <Bot size={16} className="text-primary" />
              <span className="text-sm font-medium text-foreground">AI Assistant</span>
            </div>
            <button
              type="button"
              className="rounded-lg p-1 text-muted hover:bg-white/10 hover:text-foreground"
              onClick={() => setOpen(false)}
            >
              <X size={14} />
            </button>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="max-h-[50vh] min-h-[200px] overflow-auto px-4 py-3 space-y-3"
          >
            {messages.length === 0 && (
              <p className="text-center text-xs text-muted/60 py-8">
                Ask me what to work on, paste a list of tasks, or tell me about schedule changes.
              </p>
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

          {/* Input */}
          <div className="border-t border-white/10 px-3 py-3">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                className="flex-1 resize-none rounded-xl border border-white/10 bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted/50"
                rows={1}
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
                className="shrink-0 rounded-xl bg-primary p-2.5 text-white disabled:opacity-30 hover:bg-primary-hover transition-colors"
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
          "rounded-full px-4 py-2.5 text-sm font-medium text-white shadow-lg transition-all",
          "bg-primary hover:bg-primary-hover hover:shadow-xl hover:scale-105",
          open && "bg-primary-hover scale-95"
        )}
        onClick={() => {
          setOpen((o) => !o);
          setTimeout(() => inputRef.current?.focus(), 100);
        }}
      >
        <Bot size={16} className="inline mr-1" />
        AI
      </button>
    </div>
  );
}
