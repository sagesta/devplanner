"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Activity, Brain, CalendarDays, Check, Clock, RefreshCw, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  fetchCalendarProgress,
  fetchInsightsActivity,
  postScheduleApply,
  postSchedulePreview,
  type CalendarProgressDay,
  type ScheduleProposal,
} from "@/lib/api";
import { SkeletonListItem } from "@/lib/skeleton";
import { cn } from "@/lib/utils";

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(ymd: string, days: number) {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toYMD(d);
}

function startOfWeekMonday(d: Date) {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return toYMD(copy);
}

function startOfMonth(d: Date) {
  return toYMD(new Date(d.getFullYear(), d.getMonth(), 1));
}

function endOfMonth(d: Date) {
  return toYMD(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

function formatDayLabel(ymd: string) {
  return new Date(`${ymd}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function ProgressRing({ value, status }: { value: number; status: CalendarProgressDay["status"] }) {
  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * (value / 100);
  const color =
    status === "complete"
      ? "stroke-success"
      : status === "missed"
        ? "stroke-danger"
        : status === "overload"
          ? "stroke-warning"
          : "stroke-primary";

  return (
    <svg viewBox="0 0 44 44" className="h-11 w-11 -rotate-90" aria-hidden="true">
      <circle cx="22" cy="22" r={radius} className="fill-transparent stroke-white/10" strokeWidth="4" />
      <circle
        cx="22"
        cy="22"
        r={radius}
        className={cn("fill-transparent transition-all", color)}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference - dash}`}
      />
    </svg>
  );
}

function DayCell({
  day,
  selected,
  onSelect,
}: {
  day: CalendarProgressDay;
  selected: boolean;
  onSelect: () => void;
}) {
  const date = new Date(`${day.date}T12:00:00`);
  const isToday = day.date === toYMD(new Date());

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex min-h-[104px] flex-col items-center justify-between rounded-lg border bg-surface px-2 py-2 text-center transition-colors",
        selected ? "border-primary/60 bg-primary/10" : "border-white/10 hover:border-white/20 hover:bg-white/5",
        day.status === "missed" && "border-danger/30",
        day.status === "overload" && "border-warning/30"
      )}
      title={`${formatDayLabel(day.date)}: ${day.completedUnits}/${day.plannedUnits} complete`}
    >
      <div className="flex w-full items-center justify-between gap-1 text-[10px] text-muted">
        <span>{date.toLocaleDateString(undefined, { weekday: "short" })}</span>
        {isToday && <span className="rounded bg-primary/15 px-1 text-primary">Today</span>}
      </div>
      <div className="relative grid place-items-center">
        <ProgressRing value={day.percent} status={day.status} />
        <span className="absolute text-sm font-semibold text-foreground">{date.getDate()}</span>
      </div>
      <div className="text-[11px] text-muted">
        {day.plannedUnits === 0 ? "Open" : `${day.completedUnits}/${day.plannedUnits} done`}
      </div>
    </button>
  );
}

function ProposalList({
  proposals,
  selected,
  onToggle,
}: {
  proposals: ScheduleProposal[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (proposals.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-surface px-4 py-5 text-sm text-muted">
        No rollover suggestions right now.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {proposals.map((proposal) => {
        const active = selected.includes(proposal.id);
        return (
          <li
            key={proposal.id}
            className={cn(
              "rounded-lg border bg-surface px-3 py-3",
              active ? "border-primary/50 bg-primary/10" : "border-white/10"
            )}
          >
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={active}
                onChange={() => onToggle(proposal.id)}
                className="mt-1 rounded border-white/20"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium text-foreground">{proposal.title}</p>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] uppercase",
                      proposal.risk === "high"
                        ? "bg-danger/15 text-danger"
                        : proposal.risk === "medium"
                          ? "bg-warning/15 text-warning"
                          : "bg-white/5 text-muted"
                    )}
                  >
                    {proposal.risk}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {proposal.fromDate} to {proposal.toDate} - {proposal.estimatedMinutes}m
                </p>
                <p className="mt-1 text-xs text-muted/80">{proposal.reason}</p>
              </div>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

export default function InsightsPage() {
  const { status } = useSession();
  const qc = useQueryClient();
  const today = useMemo(() => toYMD(new Date()), []);
  const weekStart = useMemo(() => startOfWeekMonday(new Date()), []);
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const monthStart = useMemo(() => startOfMonth(new Date()), []);
  const monthEnd = useMemo(() => endOfMonth(new Date()), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedProposalIds, setSelectedProposalIds] = useState<string[]>([]);

  const activityQuery = useQuery({
    queryKey: ["insights-activity"],
    queryFn: () => fetchInsightsActivity(),
    enabled: status === "authenticated",
  });

  const weekQuery = useQuery({
    queryKey: ["calendar-progress", "week", weekStart, weekEnd],
    queryFn: () => fetchCalendarProgress(weekStart, weekEnd),
    enabled: status === "authenticated",
  });

  const monthQuery = useQuery({
    queryKey: ["calendar-progress", "month", monthStart, monthEnd],
    queryFn: () => fetchCalendarProgress(monthStart, monthEnd),
    enabled: status === "authenticated",
  });

  const previewMut = useMutation({
    mutationFn: () => postSchedulePreview(today, monthEnd),
    onSuccess: (data) => {
      setSelectedProposalIds(data.proposals.map((p) => p.id));
      if (data.proposals.length === 0) toast.success("Nothing needs to roll forward.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const applyMut = useMutation({
    mutationFn: (proposals: ScheduleProposal[]) => postScheduleApply(proposals),
    onSuccess: (result) => {
      toast.success(`Applied ${result.applied} schedule change(s).`);
      setSelectedProposalIds([]);
      previewMut.reset();
      void qc.invalidateQueries({ queryKey: ["calendar-progress"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["tasks-today"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (status === "loading" || activityQuery.isLoading || weekQuery.isLoading || monthQuery.isLoading) {
    return (
      <div className="space-y-4">
        <SkeletonListItem />
        <SkeletonListItem />
      </div>
    );
  }

  const activity = activityQuery.data;
  const monthDays = monthQuery.data?.days ?? [];
  const weekDays = weekQuery.data?.days ?? [];
  const selectedDay = monthDays.find((d) => d.date === selectedDate) ?? weekDays.find((d) => d.date === selectedDate);
  const proposals = previewMut.data?.proposals ?? [];
  const selectedProposals = proposals.filter((p) => selectedProposalIds.includes(p.id));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Review</h1>
          <p className="mt-1 text-sm text-muted">Progress rings, learning signals, and schedule cleanup.</p>
        </div>
        <button
          type="button"
          onClick={() => previewMut.mutate()}
          disabled={previewMut.isPending}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          <RefreshCw size={15} />
          {previewMut.isPending ? "Preparing..." : "Preview rollover"}
        </button>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-white/10 bg-surface p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Clock size={15} className="text-primary" />
            Peak work window
          </div>
          <p className="mt-3 text-2xl font-semibold text-foreground">{activity?.peakHourLabel ?? "--:--"}</p>
          <p className="mt-1 text-xs text-muted">Used when placing deep work in schedule previews.</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-surface p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Brain size={15} className="text-primary" />
            Learned signals
          </div>
          <p className="mt-3 text-2xl font-semibold text-foreground">
            {previewMut.data?.learning.observedCompletionCount ?? "Ready"}
          </p>
          <p className="mt-1 text-xs text-muted">Completions and timers guide the next scheduling pass.</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-surface p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Activity size={15} className="text-primary" />
            Daily capacity
          </div>
          <p className="mt-3 text-2xl font-semibold text-foreground">{monthQuery.data?.dailyCapacity ?? 0}m</p>
          <p className="mt-1 text-xs text-muted">Used as a soft limit for rollover proposals.</p>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <CalendarDays size={16} className="text-primary" />
          <h2 className="text-sm font-semibold text-foreground">This week</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {weekDays.map((day) => (
            <DayCell key={day.date} day={day} selected={selectedDate === day.date} onSelect={() => setSelectedDate(day.date)} />
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">This month</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {monthDays.map((day) => (
              <DayCell key={day.date} day={day} selected={selectedDate === day.date} onSelect={() => setSelectedDate(day.date)} />
            ))}
          </div>
        </div>

        <aside className="h-fit rounded-lg border border-white/10 bg-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{selectedDay ? formatDayLabel(selectedDay.date) : "Select a day"}</h3>
              <p className="mt-1 text-xs text-muted">Daily completion detail</p>
            </div>
            {selectedDay?.status === "complete" && <Check size={16} className="text-success" />}
            {selectedDay?.status === "missed" && <X size={16} className="text-danger" />}
          </div>
          {selectedDay ? (
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted">Progress</span>
                <span className="font-medium text-foreground">{selectedDay.percent}%</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted">Units</span>
                <span className="font-medium text-foreground">
                  {selectedDay.completedUnits}/{selectedDay.plannedUnits}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted">Planned load</span>
                <span className="font-medium text-foreground">{selectedDay.plannedMinutes}m</span>
              </div>
              {selectedDay.overdueUnits > 0 && (
                <p className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">
                  {selectedDay.overdueUnits} unfinished unit(s) from this day can be rolled forward.
                </p>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">Pick a date to inspect completion and load.</p>
          )}
        </aside>
      </section>

      {previewMut.data && (
        <section className="rounded-lg border border-white/10 bg-background/40 p-4">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Schedule proposals</h2>
              <p className="mt-1 text-xs text-muted">Nothing changes until you approve selected moves.</p>
            </div>
            <button
              type="button"
              disabled={selectedProposals.length === 0 || applyMut.isPending}
              onClick={() => applyMut.mutate(selectedProposals)}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-40"
            >
              <Check size={15} />
              {applyMut.isPending ? "Applying..." : `Apply ${selectedProposals.length}`}
            </button>
          </div>
          <ProposalList
            proposals={proposals}
            selected={selectedProposalIds}
            onToggle={(id) =>
              setSelectedProposalIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
            }
          />
        </section>
      )}
    </div>
  );
}
