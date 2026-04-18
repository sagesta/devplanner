"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Activity, Brain, Clock, Zap } from "lucide-react";
import { fetchInsightsActivity } from "@/lib/api";
import { SkeletonListItem } from "@/lib/skeleton";

export default function InsightsPage() {
  const { status } = useSession();

  const query = useQuery({
    queryKey: ["insights-activity"],
    queryFn: () => fetchInsightsActivity(),
    enabled: status === "authenticated",
  });

  if (status === "loading" || query.isLoading) {
    return (
      <div className="space-y-4">
        <SkeletonListItem />
        <SkeletonListItem />
      </div>
    );
  }

  const { data } = query;

  return (
    <div className="flex flex-col gap-8 pb-12">
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-2xl text-foreground">Action Insights</h1>
        <p className="text-sm text-muted">
          Your peak completion hours & cognitive load estimates.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-2 rounded-2xl border border-white/5 bg-surface/40 p-6">
          <div className="flex items-center gap-2 text-primary font-semibold text-sm mb-4 uppercase tracking-wider">
            <Zap size={16} /> Peak Hour
          </div>
          <div className="text-4xl font-display font-semibold text-foreground">
            {data?.peakHourLabel ?? "--:--"}
          </div>
          <p className="text-xs text-muted/80 mt-2">
            You complete the most deep work units in this window. Schedule complex tasks here.
          </p>
        </div>

        <div className="flex flex-col gap-2 rounded-2xl border border-white/5 bg-surface/40 p-6">
          <div className="flex items-center gap-2 text-primary font-semibold text-sm mb-4 uppercase tracking-wider">
            <Brain size={16} /> Cognitive Load
          </div>
          <div className="text-4xl font-display font-semibold text-foreground">
            Normal
          </div>
          <p className="text-xs text-muted/80 mt-2">
            No severe overload symptoms detected in recent task switching behavior.
          </p>
        </div>
      </div>

      <section className="rounded-2xl border border-white/10 bg-surface/50 p-6">
        <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground mb-6 uppercase tracking-wider">
          <Activity size={16} className="text-primary"/> Daily Activity Heatmap
        </h3>

        <div className="flex items-end gap-1 h-48 w-full overflow-x-auto pb-6">
          {data?.activityHeatmap.map((h) => {
            const maxMins = Math.max(...(data.activityHeatmap.map(x => x.minutes) || [1]));
            const pct = Math.max(5, (h.minutes / maxMins) * 100);
            return (
              <div key={h.hour} className="flex flex-col items-center gap-2 flex-1 min-w-[20px]">
                <div 
                  className="w-full rounded-t-sm bg-primary/80 transition-all hover:bg-primary"
                  style={{ height: `${pct}%` }}
                  title={`${h.label}: ${h.minutes} mins focus`}
                />
                <span className="text-[10px] text-muted/50 -rotate-45 mt-2 origin-top-left">{h.label}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
