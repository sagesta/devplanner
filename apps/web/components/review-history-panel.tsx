"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronDown, ChevronUp, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { fetchReviews, type WeeklyReviewRow } from "@/lib/api";

function formatDate(ymd: string) {
  return new Date(`${ymd}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function normalizedLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, "").trim().toLowerCase())
    .filter(Boolean);
}

function ReviewDetails({ review, previous }: { review: WeeklyReviewRow; previous?: WeeklyReviewRow }) {
  const previousCarryover = new Set(normalizedLines(previous?.carryover ?? ""));
  const repeatedCarryover = normalizedLines(review.carryover).filter((line) => previousCarryover.has(line));
  return (
    <div className="grid gap-5 border-t border-[var(--hairline-soft)] px-4 py-4 sm:grid-cols-2 sm:px-5">
      <section>
        <h3 className="text-xs font-semibold uppercase text-muted">Wins</h3>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-[var(--ink)]">
          {review.wins || "No wins recorded."}
        </p>
      </section>
      <section>
        <h3 className="text-xs font-semibold uppercase text-muted">Carryover and blockers</h3>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-[var(--ink)]">
          {review.carryover || "No carryover recorded."}
        </p>
      </section>
      <section>
        <h3 className="text-xs font-semibold uppercase text-muted">Next intentions</h3>
        {review.intentions.length ? (
          <ol className="mt-1.5 space-y-2 text-sm text-[var(--ink)]">
            {review.intentions.map((item, index) => (
              <li key={`${item.text}-${index}`}>
                {index + 1}. {item.text}
                {item.goalLabel && (
                  <span className="ml-1.5 text-xs text-[var(--teal)]">Advances: {item.goalLabel}</span>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-1.5 text-sm text-muted">No intentions recorded.</p>
        )}
      </section>
      <section>
        <h3 className="text-xs font-semibold uppercase text-muted">Sprint notes</h3>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-[var(--ink)]">
          {review.sprintNotes || "No sprint notes recorded."}
        </p>
      </section>
      {previous && (
        <section className="sm:col-span-2 border-t border-[var(--hairline-soft)] pt-4">
          <h3 className="text-xs font-semibold uppercase text-muted">Compared with the prior review</h3>
          {repeatedCarryover.length ? (
            <p className="mt-1.5 text-sm text-[var(--ink)]">
              Repeated carryover: {repeatedCarryover.join("; ")}
            </p>
          ) : (
            <p className="mt-1.5 text-sm text-muted">No exact carryover item was repeated from the prior review.</p>
          )}
          {previous.intentions.length > 0 && (
            <p className="mt-1 text-xs text-muted">
              Prior intentions: {previous.intentions.map((item) => item.text).join("; ")}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

export function ReviewHistoryPanel() {
  const userId = useAppUserId();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const reviewsQ = useQuery({
    queryKey: ["weekly-reviews", query, from, to, userId],
    queryFn: () => fetchReviews({ query, from, to }),
    enabled: Boolean(userId),
  });
  const reviews = reviewsQ.data?.reviews ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <h2 className="font-display text-[26px] text-[var(--ink)]">Review history</h2>
          <p className="mt-1 text-sm text-muted">Find old wins, blockers, intentions, and sprint decisions.</p>
        </div>
        <div className="grid w-full gap-2 sm:grid-cols-[minmax(180px,1fr)_140px_140px] lg:w-auto">
          <label className="relative block">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <span className="sr-only">Search weekly reviews</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search reviews"
              className="h-10 w-full rounded-md border border-[var(--hairline)] bg-[var(--card)] pl-9 pr-3 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted-soft)] focus:border-[var(--teal)]"
            />
          </label>
          <label className="text-[11px] font-semibold uppercase text-muted">
            From
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-[var(--hairline)] bg-[var(--card)] px-2 text-xs text-[var(--ink)] outline-none focus:border-[var(--teal)]" />
          </label>
          <label className="text-[11px] font-semibold uppercase text-muted">
            To
            <input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-[var(--hairline)] bg-[var(--card)] px-2 text-xs text-[var(--ink)] outline-none focus:border-[var(--teal)]" />
          </label>
        </div>
      </div>

      {reviewsQ.isLoading ? (
        <div className="space-y-2" aria-label="Loading review history">
          {[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-md bg-[var(--teal-a08)]" />)}
        </div>
      ) : reviewsQ.isError ? (
        <div className="border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          Review history could not be loaded. Please try again.
        </div>
      ) : reviews.length === 0 ? (
        <div className="border border-dashed border-[var(--hairline)] py-14 text-center">
          <CalendarDays size={28} className="mx-auto text-[var(--teal)]" />
          <p className="mt-3 font-display text-[19px] italic text-[var(--ink)]">
            {query ? "No reviews match that search." : "Your first completed review will appear here."}
          </p>
          <p className="mt-1 text-sm text-muted">Reviews are saved to your account and available on every device.</p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--hairline-soft)] border-y border-[var(--hairline)]">
          {reviews.map((review, index) => {
            const isExpanded = expanded === review.id;
            return (
              <article key={review.id}>
                <button
                  type="button"
                  onClick={() => setExpanded(isExpanded ? null : review.id)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-[var(--teal-a08)] sm:px-5"
                  aria-expanded={isExpanded}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-[18px] text-[var(--ink)]">
                        {formatDate(review.weekStart)} - {formatDate(review.weekEnd)}
                      </h3>
                      <span className="text-[11px] font-semibold uppercase text-[var(--teal)]">{review.status}</span>
                    </div>
                    <p className="mt-1 truncate text-sm text-muted">
                      {review.wins || review.intentions[0]?.text || "No summary entered"}
                    </p>
                  </div>
                  {isExpanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
                </button>
                {isExpanded && <ReviewDetails review={review} previous={reviews[index + 1]} />}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
