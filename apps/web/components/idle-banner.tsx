"use client";

import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";
import { patchTask } from "@/lib/api";
import { useTaskSse } from "@/hooks/use-sse";

export function IdleBanner() {
  const [banner, setBanner] = useState<{ taskId: string; title: string; message: string } | null>(null);

  useTaskSse((p) => setBanner(p));

  if (!banner) return null;

  return (
    <div className="border-b border-amber-900/60 bg-amber-950/40 px-4 py-2.5 text-sm text-amber-100 animate-slideDown">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0 text-amber-400" />
          <span>{banner.message}</span>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            className="rounded-lg bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20 transition-colors"
            onClick={() => setBanner(null)}
          >
            Keep going
          </button>
          <button
            type="button"
            className="rounded-lg bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20 transition-colors"
            onClick={() => setBanner(null)}
          >
            Split task
          </button>
          <button
            type="button"
            className="rounded-lg bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20 transition-colors"
            onClick={async () => {
              await patchTask(banner.taskId, { status: "blocked" });
              setBanner(null);
            }}
          >
            Mark blocked
          </button>
          <button
            type="button"
            className="rounded p-0.5 text-amber-300/60 hover:text-amber-100 transition-colors"
            onClick={() => setBanner(null)}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
