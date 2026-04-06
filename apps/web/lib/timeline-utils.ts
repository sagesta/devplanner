/** Timeline helpers — calendar dates as `YYYY-MM-DD` (same as API task fields). */

/** stress-test-fix: API may return ISO timestamps; timeline comparisons need plain YMD. */
export function normalizeYmd(d: string | null | undefined): string | null {
  if (d == null || d === "") return null;
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  return s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

export function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseYMDLocal(s: string): Date {
  const [y, mo, d] = s.split("-").map(Number);
  return new Date(y, mo - 1, d);
}

export function addDaysYMD(ymd: string, delta: number): string {
  const d = parseYMDLocal(ymd);
  d.setDate(d.getDate() + delta);
  return toYMD(d);
}

/** Monday as first day of week, in local timezone. */
export function startOfWeekMonday(ymdOrDate: string | Date): string {
  const d = typeof ymdOrDate === "string" ? parseYMDLocal(ymdOrDate) : new Date(ymdOrDate);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toYMD(d);
}

export function eachDayFrom(startYMD: string, count: number): string[] {
  const out: string[] = [];
  let cur = startYMD;
  for (let i = 0; i < count; i++) {
    out.push(cur);
    cur = addDaysYMD(cur, 1);
  }
  return out;
}

/** Index of `ymd` in [rangeStart, rangeStart + numDays), or null if outside. */
export function dayIndexInRange(ymd: string, rangeStart: string, numDays: number): number | null {
  const start = parseYMDLocal(rangeStart).getTime();
  const t = parseYMDLocal(ymd).getTime();
  const idx = Math.round((t - start) / 86400000);
  if (idx < 0 || idx >= numDays) return null;
  return idx;
}

function parseTimeToMinutes(t: string | null): number | null {
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function ymdMax(a: string, b: string): string {
  return a.localeCompare(b) >= 0 ? a : b;
}

function ymdMin(a: string, b: string): string {
  return a.localeCompare(b) <= 0 ? a : b;
}

export type BarLayout = {
  startIdx: number;
  spanDays: number;
  startFrac: number;
  endFrac: number;
};

/**
 * stress-test-fix: bar visible if scheduled/due range overlaps the timeline window
 * (not only when anchor start falls inside the window).
 */
export function layoutTaskBar(
  scheduledDate: string | null,
  dueDate: string | null,
  scheduledStartTime: string | null,
  scheduledEndTime: string | null,
  estimatedMinutes: number | null,
  rangeStart: string,
  numDays: number
): { inView: true; layout: BarLayout } | { inView: false } {
  const sd = normalizeYmd(scheduledDate);
  const dd = normalizeYmd(dueDate);
  const anchorStart = sd ?? dd;
  if (!anchorStart) return { inView: false };

  const rangeEnd = addDaysYMD(rangeStart, numDays - 1);
  const rawEnd = dd && sd ? ymdMax(dd, sd) : (dd ?? sd ?? anchorStart);
  const anchorEnd = rawEnd;

  if (anchorStart.localeCompare(rangeEnd) > 0 || anchorEnd.localeCompare(rangeStart) < 0) {
    return { inView: false };
  }

  const visibleStart = ymdMax(anchorStart, rangeStart);
  const visibleEnd = ymdMin(anchorEnd, rangeEnd);

  const idx = dayIndexInRange(visibleStart, rangeStart, numDays);
  if (idx === null) return { inView: false };

  const endIdx = dayIndexInRange(visibleEnd, rangeStart, numDays);
  if (endIdx === null) return { inView: false };

  let spanDays = Math.max(1, endIdx - idx + 1);
  spanDays = Math.min(spanDays, Math.max(1, numDays - idx));

  let startFrac = 0;
  let endFrac = 1;

  const startM = parseTimeToMinutes(scheduledStartTime);
  const endM = parseTimeToMinutes(scheduledEndTime);
  const sameDayAsScheduled =
    sd &&
    visibleStart === sd &&
    sd.localeCompare(rangeStart) >= 0 &&
    sd.localeCompare(rangeEnd) <= 0;

  if (sameDayAsScheduled && startM != null && endM != null && endM > startM) {
    startFrac = startM / (24 * 60);
    endFrac = endM / (24 * 60);
    spanDays = Math.min(spanDays, 1);
  } else if (estimatedMinutes != null && estimatedMinutes > 0) {
    spanDays = Math.max(1, Math.min(spanDays, Math.ceil(estimatedMinutes / 360)));
    const dayPortion = Math.min(1, estimatedMinutes / (8 * 60));
    endFrac = spanDays === 1 ? Math.max(0.12, dayPortion) : 1;
  }

  return {
    inView: true,
    layout: { startIdx: idx, spanDays, startFrac, endFrac },
  };
}

export function barPixels(
  layout: BarLayout,
  dayWidth: number,
  numDays: number
): { left: number; width: number } {
  const { startIdx, spanDays, startFrac, endFrac } = layout;
  const maxRight = numDays * dayWidth;
  const left = startIdx * dayWidth + startFrac * dayWidth;
  const lastIdx = startIdx + spanDays - 1;
  const right = Math.min(maxRight, lastIdx * dayWidth + endFrac * dayWidth);
  const width = Math.max(10, right - left);
  return { left, width };
}
