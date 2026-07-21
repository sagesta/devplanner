"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AccomplishmentsPanel } from "@/components/accomplishments-panel";
import { ReviewHistoryPanel } from "@/components/review-history-panel";
import { WeeklyReviewPanel } from "@/components/weekly-review-panel";
import { cn } from "@/lib/utils";
import InsightsPage from "../insights/page";

const REVIEW_VIEWS = [
  { key: "weekly", label: "Weekly review", href: "/review?view=weekly", description: "Record wins, carryover, and next-week intentions." },
  { key: "history", label: "History", href: "/review?view=history", description: "Search and reopen previous weekly reviews." },
  { key: "progress", label: "Progress", href: "/review?view=progress", description: "Read capacity signals and rollover proposals." },
  { key: "accomplishments", label: "Accomplishments", href: "/review?view=accomplishments", description: "Log what you did, the impact, and the proof." },
] as const;

type ReviewView = (typeof REVIEW_VIEWS)[number]["key"];

function normalizeReviewView(value: string | null): ReviewView {
  if (value === "history" || value === "progress" || value === "accomplishments") return value;
  return "weekly";
}

export default function ReviewPage() {
  const searchParams = useSearchParams();
  const activeView = normalizeReviewView(searchParams.get("view"));

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-7 pb-16">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--teal)]">Review</p>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className="mt-1.5 font-display text-[32px] font-normal leading-[1.05] text-[var(--ink)] md:text-[52px]">Close the loop on the week.</h1>
          <p className="shrink-0 text-sm text-muted">Count wins, clear carryover, choose what matters next</p>
        </div>
      </header>

      <nav className="flex flex-wrap gap-1.5" aria-label="Review views">
        {REVIEW_VIEWS.map(({ key, href, label, description }) => (
          <Link
            key={key}
            href={href}
            title={description}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm transition-colors",
              activeView === key ? "bg-[var(--ink-btn-bg)] font-semibold text-[var(--ink-btn-fg)]" : "text-muted hover:bg-[var(--teal-a08)] hover:text-[var(--ink)]"
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      <section className="min-w-0">
        {activeView === "weekly" ? <WeeklyReviewPanel /> : activeView === "history" ? <ReviewHistoryPanel /> : activeView === "accomplishments" ? <AccomplishmentsPanel /> : <InsightsPage />}
      </section>
    </div>
  );
}
