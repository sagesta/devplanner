/**
 * Minimal iCalendar 2.0 (RFC 5545) for a single VEVENT — no external deps.
 * Line endings CRLF; basic folding for long lines.
 */

function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function foldIcs(content: string): string {
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  const out: string[] = [];
  for (const line of lines) {
    if (line.length <= 75) {
      out.push(line);
      continue;
    }
    let rest = line;
    out.push(rest.slice(0, 75));
    rest = rest.slice(75);
    while (rest.length > 0) {
      const chunk = rest.slice(0, 74);
      out.push(` ${chunk}`);
      rest = rest.slice(74);
    }
  }
  return out.join("\r\n") + "\r\n";
}

function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function ymd(d: string): string {
  return d.replace(/-/g, "");
}

/** Parse "HH:MM:SS" or "HH:MM" → minutes from midnight */
function timeToParts(t: string): { h: number; m: number } | null {
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  return { h, m: min };
}

export type TaskCalendarInput = {
  title: string;
  description: string | null;
  status: string;
  priority: string;
  scheduledDate: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  dueDate: string | null;
  estimatedMinutes: number | null;
  recurrenceRule: string | null;
  caldavUid: string;
  /** When set (imports / round-trip), must match the calendar UID exactly. */
  icalUid?: string | null;
};

/**
 * Returns ICS document or null if the task has nothing to show on a calendar.
 */
export function buildTaskVcalendar(task: TaskCalendarInput): string | null {
  const uid = (task.icalUid?.trim() || `${task.caldavUid}@devplanner`).replace(/[\r\n;]/g, "");
  const dtStamp = utcStamp(new Date());

  let dtStart: string;
  let dtEnd: string;
  let allDay = false;

  const sd = task.scheduledDate;
  const due = task.dueDate;

  if (sd) {
    const st = task.scheduledStartTime ? timeToParts(task.scheduledStartTime) : null;
    const et = task.scheduledEndTime ? timeToParts(task.scheduledEndTime) : null;
    if (st && et) {
      const ds = ymd(sd);
      const pad = (n: number) => String(n).padStart(2, "0");
      dtStart = `${ds}T${pad(st.h)}${pad(st.m)}00`;
      dtEnd = `${ds}T${pad(et.h)}${pad(et.m)}00`;
    } else {
      allDay = true;
      const start = ymd(sd);
      const d = new Date(sd + "T12:00:00");
      d.setDate(d.getDate() + 1);
      const end = ymd(d.toISOString().slice(0, 10));
      dtStart = start;
      dtEnd = end;
    }
  } else if (due) {
    allDay = true;
    const start = ymd(due);
    const d = new Date(due + "T12:00:00");
    d.setDate(d.getDate() + 1);
    const end = ymd(d.toISOString().slice(0, 10));
    dtStart = start;
    dtEnd = end;
  } else {
    return null;
  }

  let summary = task.title;
  if (task.status === "done") summary = `[Done] ${summary}`;
  if (task.status === "cancelled") summary = `[Cancelled] ${summary}`;
  if (task.status === "blocked") summary = `[Blocked] ${summary}`;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DevPlanner//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
  ];

  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${dtStart}`);
    lines.push(`DTEND;VALUE=DATE:${dtEnd}`);
  } else {
    lines.push(`DTSTART:${dtStart}`);
    lines.push(`DTEND:${dtEnd}`);
  }

  lines.push(`SUMMARY:${escapeText(summary)}`);
  if (task.description?.trim()) {
    lines.push(`DESCRIPTION:${escapeText(task.description.trim())}`);
  }

  if (task.status === "cancelled") {
    lines.push("STATUS:CANCELLED");
  } else if (task.status === "done") {
    lines.push("STATUS:CONFIRMED");
    lines.push("TRANSP:TRANSPARENT");
  } else {
    lines.push("STATUS:CONFIRMED");
  }

  const prioMap: Record<string, string> = {
    urgent: "1",
    high: "3",
    normal: "5",
    low: "9",
  };
  lines.push(`PRIORITY:${prioMap[task.priority] ?? "5"}`);

  if (task.recurrenceRule?.trim()) {
    const rr = task.recurrenceRule.trim().replace(/^RRULE:/i, "");
    lines.push(`RRULE:${rr}`);
  }

  lines.push("END:VEVENT", "END:VCALENDAR");

  return foldIcs(lines.join("\r\n"));
}
