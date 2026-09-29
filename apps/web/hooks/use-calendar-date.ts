"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppUserId } from "@/hooks/use-app-user-id";
import { fetchDailyPreferences } from "@/lib/daily-api";

export function calendarDate(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (kind: string) =>
    parts.find((part) => part.type === kind)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** Refresh on the next calendar boundary, after sleep/tab return, and on timezone changes. */
export function useCalendarDate(timeZone?: string): string {
  const userId = useAppUserId();
  const preferencesQ = useQuery({
    queryKey: ["daily-preferences", userId],
    queryFn: fetchDailyPreferences,
    enabled: Boolean(userId) && !timeZone,
  });
  const zone =
    timeZone ||
    preferencesQ.data?.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";
  const [date, setDate] = useState(() => calendarDate(zone));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      setDate(calendarDate(zone));
      // A short poll around the boundary avoids assuming every day has 24 hours.
      const current = calendarDate(zone);
      let lo = 1,
        hi = 27 * 60 * 60 * 1000;
      const start = Date.now();
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (calendarDate(zone, new Date(start + mid)) === current) lo = mid + 1;
        else hi = mid;
      }
      timer = setTimeout(refresh, Math.max(1_000, lo + 100));
    };
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [zone]);
  return date;
}
