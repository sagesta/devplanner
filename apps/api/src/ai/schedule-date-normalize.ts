/**
 * AI often emits April dates with the wrong year (e.g. 2024 when the user means this year).
 * If the YMD is strictly before "today" and the year is behind the current calendar year,
 * roll to the same month/day in the current year, or next year if that would still be in the past.
 */
export function liftStaleScheduleYear(ymd: string, ref = new Date()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const today = ref.toISOString().slice(0, 10);
  if (ymd >= today) return ymd;

  const [, m, d] = ymd.split("-");
  const yNum = Number(ymd.slice(0, 4));
  const curY = ref.getUTCFullYear();
  if (yNum >= curY) return ymd;

  const pad = (n: string) => n.padStart(2, "0");
  let candidate = `${curY}-${pad(m!)}-${pad(d!)}`;
  if (candidate < today) {
    candidate = `${curY + 1}-${pad(m!)}-${pad(d!)}`;
  }
  return candidate;
}
