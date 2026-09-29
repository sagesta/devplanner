import {
  addDaysYMD,
  barPixels,
  dayIndexInRange,
  eachDayFrom,
  layoutTaskBar,
  normalizeYmd,
  parseYMDLocal,
  startOfWeekMonday,
  toYMD,
} from "./timeline-utils";
test("normalizes API timestamps and rejects non-date labels", () => {
  expect(normalizeYmd(null)).toBeNull();
  expect(normalizeYmd("")).toBeNull();
  expect(normalizeYmd("tomorrow")).toBeNull();
  expect(normalizeYmd("2026-09-29T10:00:00Z")).toBe("2026-09-29");
  expect(normalizeYmd("2026-09-29 10:00:00")).toBe("2026-09-29");
  expect(normalizeYmd("2026-09-29")).toBe("2026-09-29");
});
test("calendar navigation crosses month/leap/year boundaries and uses Monday weeks", () => {
  expect(addDaysYMD("2024-02-28", 1)).toBe("2024-02-29");
  expect(addDaysYMD("2026-01-01", -1)).toBe("2025-12-31");
  expect(startOfWeekMonday("2026-10-04")).toBe("2026-09-28");
  expect(startOfWeekMonday(new Date(2026, 8, 29))).toBe("2026-09-28");
  expect(toYMD(parseYMDLocal("2026-09-29"))).toBe("2026-09-29");
  expect(eachDayFrom("2026-12-31", 2)).toEqual(["2026-12-31", "2027-01-01"]);
  expect(eachDayFrom("2026-09-29", 0)).toEqual([]);
});
test("window boundaries exclude dates before or after the visible range", () => {
  expect(dayIndexInRange("2026-09-28", "2026-09-29", 7)).toBeNull();
  expect(dayIndexInRange("2026-10-06", "2026-09-29", 7)).toBeNull();
  expect(dayIndexInRange("2026-10-05", "2026-09-29", 7)).toBe(6);
  for (const date of [null, "2026-09-20", "2026-10-10"])
    expect(
      layoutTaskBar(date, null, null, null, null, "2026-09-29", 7),
    ).toEqual({ inView: false });
});
test("overlapping bars clip to the window and scheduled time controls fractional width", () => {
  expect(
    layoutTaskBar(
      "2026-09-27",
      "2026-10-10",
      null,
      null,
      null,
      "2026-09-29",
      7,
    ),
  ).toEqual({
    inView: true,
    layout: { startIdx: 0, spanDays: 7, startFrac: 0, endFrac: 1 },
  });
  expect(
    layoutTaskBar("2026-09-30", null, "09:00", "12:00", null, "2026-09-29", 7),
  ).toEqual({
    inView: true,
    layout: { startIdx: 1, spanDays: 1, startFrac: 9 / 24, endFrac: 12 / 24 },
  });
  expect(
    layoutTaskBar(null, "2026-09-30", null, null, 30, "2026-09-29", 7),
  ).toEqual({
    inView: true,
    layout: { startIdx: 1, spanDays: 1, startFrac: 0, endFrac: 0.12 },
  });
  const estimated = layoutTaskBar(
    "2026-09-29",
    "2026-10-04",
    "bad",
    "xx:yy",
    720,
    "2026-09-29",
    7,
  );
  expect(estimated).toEqual({
    inView: true,
    layout: { startIdx: 0, spanDays: 2, startFrac: 0, endFrac: 1 },
  });
  expect(
    barPixels({ startIdx: 1, spanDays: 1, startFrac: 0, endFrac: 0.5 }, 100, 7),
  ).toEqual({ left: 100, width: 50 });
  expect(
    barPixels({ startIdx: 6, spanDays: 2, startFrac: 0, endFrac: 1 }, 100, 7),
  ).toEqual({ left: 600, width: 100 });
});
