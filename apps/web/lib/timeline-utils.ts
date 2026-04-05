/** Timeline helpers — calendar dates as `YYYY-MM-DD` (same as API task fields). */

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

export type BarLayout = {
  startIdx: number;
  spanDays: number;
  startFrac: number;
  endFrac: number;
};

export function layoutTaskBar(
  scheduledDate: string | null,
  dueDate: string | null,
  scheduledStartTime: string | null,
  scheduledEndTime: string | null,
  estimatedMinutes: number | null,
  rangeStart: string,
  numDays: number
): { inView: true; layout: BarLayout } | { inView: false } {
  const anchor = scheduledDate ?? dueDate;
  if (!anchor) return { inView: false };

  const idx = dayIndexInRange(anchor, rangeStart, numDays);
  if (idx === null) return { inView: false };

  let startFrac = 0;
  let endFrac = 1;
  let spanDays = 1;

  const startM = parseTimeToMinutes(scheduledStartTime);
  const endM = parseTimeToMinutes(scheduledEndTime);

  if (scheduledDate && startM != null && endM != null && endM > startM) {
    startFrac = startM / (24 * 60);
    endFrac = endM / (24 * 60);
    spanDays = 1;
  } else if (estimatedMinutes != null && estimatedMinutes > 0) {
    spanDays = Math.max(1, Math.min(7, Math.ceil(estimatedMinutes / 360)));
    const dayPortion = Math.min(1, estimatedMinutes / (8 * 60));
    endFrac = spanDays === 1 ? Math.max(0.12, dayPortion) : 1;
  }

  spanDays = Math.min(spanDays, Math.max(1, numDays - idx));

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
