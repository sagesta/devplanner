import ical from "node-ical";

export type ParsedIncomingEvent = {
  icalUid: string;
  /** ISO-ish stamp for merge (from lastmodified / created). */
  remoteRevision: string | null;
  title: string;
  description: string | null;
  scheduledDate: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  dueDate: string | null;
  allDay: boolean;
  recurrenceRule: string | null;
  statusCancelled: boolean;
  statusCompleted: boolean;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localHms(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return localYmd(a) === localYmd(b);
}

function dayDelta(a: Date, b: Date): number {
  const t = 86400000;
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / t);
}

/**
 * Extract VEVENTs from a raw calendar document (may contain multiple).
 */
export function parseIncomingICS(ics: string): ParsedIncomingEvent[] {
  const data = ical.parseICS(ics);
  const out: ParsedIncomingEvent[] = [];

  for (const key of Object.keys(data)) {
    const raw = data[key];
    if (!raw || (raw as { type?: string }).type !== "VEVENT") continue;
    const ev = raw as Record<string, unknown>;

    const icalUid = typeof ev.uid === "string" ? ev.uid.trim() : "";
    if (!icalUid) continue;

    const title =
      typeof ev.summary === "string" && ev.summary.trim()
        ? ev.summary.trim().slice(0, 500)
        : "(no title)";

    const description =
      typeof ev.description === "string" && ev.description.trim() ? ev.description.trim() : null;

    const start = ev.start instanceof Date ? ev.start : null;
    const end = ev.end instanceof Date ? ev.end : null;

    let allDay = false;
    let scheduledDate: string | null = null;
    let scheduledStartTime: string | null = null;
    let scheduledEndTime: string | null = null;
    let dueDate: string | null = null;

    if (start && end) {
      const deltaDays = dayDelta(start, end);
      const midnight =
        start.getHours() === 0 &&
        start.getMinutes() === 0 &&
        end.getHours() === 0 &&
        end.getMinutes() === 0;
      if (deltaDays === 1 && midnight) {
        allDay = true;
        scheduledDate = localYmd(start);
      } else if (deltaDays > 1 && midnight) {
        allDay = true;
        scheduledDate = localYmd(start);
        dueDate = localYmd(new Date(end.getTime() - 86400000));
      } else if (isSameLocalDay(start, end)) {
        scheduledDate = localYmd(start);
        scheduledStartTime = localHms(start);
        scheduledEndTime = localHms(end);
      } else {
        allDay = true;
        scheduledDate = localYmd(start);
        dueDate = localYmd(new Date(end.getTime() - 86400000));
      }
    } else if (start) {
      scheduledDate = localYmd(start);
      allDay = true;
    }

    const st = typeof ev.status === "string" ? (ev.status as string).toUpperCase() : "";
    const statusCancelled = st === "CANCELLED";
    const statusCompleted = st === "COMPLETED";

    let recurrenceRule: string | null = null;
    if (ev.rrule) {
      const r = ev.rrule as { toString?: () => string };
      recurrenceRule =
        typeof r?.toString === "function"
          ? r.toString().replace(/^RRULE:/i, "")
          : String(ev.rrule);
    }

    const lm = ev.lastmodified instanceof Date ? (ev.lastmodified as Date).toISOString() : null;
    const cr = ev.created instanceof Date ? (ev.created as Date).toISOString() : null;
    const remoteRevision = lm ?? cr ?? null;

    out.push({
      icalUid,
      remoteRevision,
      title,
      description,
      scheduledDate,
      scheduledStartTime,
      scheduledEndTime,
      dueDate,
      allDay,
      recurrenceRule,
      statusCancelled,
      statusCompleted,
    });
  }

  return out;
}

export const DEVPLANNER_UID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})@devplanner$/i;

export function parseDevplannerCaldavUid(icalUid: string): string | null {
  const m = icalUid.trim().match(DEVPLANNER_UID_RE);
  return m ? m[1]!.toLowerCase() : null;
}
