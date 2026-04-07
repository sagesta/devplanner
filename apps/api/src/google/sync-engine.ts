import type { calendar_v3 } from "googleapis";
import { and, eq, isNotNull } from "drizzle-orm";
import { DEVPLANNER_UID_RE, parseDevplannerCaldavUid } from "../caldav/parse-incoming.js";
import { db } from "../db/client.js";
import { googleCalendarLinks, subtasks, tasks, users } from "../db/schema.js";
import { resolveOrCreateImportAreaId } from "../lib/importArea.js";
import { getCalendarForUser } from "./auth.js";

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

function parseWallTime(t: string | null | undefined): { h: number; m: number } | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  return { h, m: min };
}

function parseGoogleEvent(ev: calendar_v3.Schema$Event): {
  icalUid: string;
  remoteRevision: string | null;
  title: string;
  description: string | null;
  scheduledDate: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  dueDate: string | null;
  recurrenceRule: string | null;
  statusCancelled: boolean;
  statusCompleted: boolean;
  devplannerTaskId: string | null;
} | null {
  if (!ev.id) return null;
  const icalUid = (ev.iCalUID || ev.id).trim();
  if (!icalUid) return null;

  let title =
    typeof ev.summary === "string" && ev.summary.trim() ? ev.summary.trim().slice(0, 500) : "(no title)";
  let statusCompleted = false;
  if (title.startsWith("[Done] ")) {
    statusCompleted = true;
    title = title.slice(7).trim() || "(no title)";
  }
  if (title.startsWith("[Cancelled] ")) {
    title = title.slice(12).trim() || "(no title)";
  }
  if (title.startsWith("[Blocked] ")) {
    title = title.slice(10).trim() || "(no title)";
  }

  const description =
    typeof ev.description === "string" && ev.description.trim() ? ev.description.trim() : null;

  const priv = ev.extendedProperties?.private;
  const devplannerTaskId =
    priv && typeof priv.devplannerTaskId === "string" && priv.devplannerTaskId.trim()
      ? priv.devplannerTaskId.trim()
      : null;

  let scheduledDate: string | null = null;
  let scheduledStartTime: string | null = null;
  let scheduledEndTime: string | null = null;
  let dueDate: string | null = null;

  const s = ev.start;
  const e = ev.end;
  if (s?.date && e?.date) {
    const start = new Date(s.date + "T12:00:00");
    const end = new Date(e.date + "T12:00:00");
    const deltaDays = dayDelta(start, end);
    const midnight =
      s.date.length <= 10 &&
      e.date.length <= 10 &&
      !s.dateTime &&
      !e.dateTime;
    if (midnight && deltaDays === 1) {
      scheduledDate = s.date;
    } else if (midnight && deltaDays > 1) {
      scheduledDate = s.date;
      const endInclusive = new Date(end.getTime() - 86400000);
      dueDate = localYmd(endInclusive);
    } else {
      scheduledDate = s.date;
    }
  } else if (s?.dateTime && e?.dateTime) {
    const start = new Date(s.dateTime);
    const end = new Date(e.dateTime);
    if (isSameLocalDay(start, end)) {
      scheduledDate = localYmd(start);
      scheduledStartTime = localHms(start);
      scheduledEndTime = localHms(end);
    } else {
      scheduledDate = localYmd(start);
      dueDate = localYmd(new Date(end.getTime() - 86400000));
    }
  } else if (s?.dateTime) {
    const start = new Date(s.dateTime);
    scheduledDate = localYmd(start);
    scheduledStartTime = localHms(start);
  } else if (s?.date) {
    scheduledDate = s.date;
  }

  const st = (ev.status || "").toLowerCase();
  const statusCancelled = st === "cancelled";

  let recurrenceRule: string | null = null;
  if (Array.isArray(ev.recurrence) && ev.recurrence[0]) {
    recurrenceRule = ev.recurrence[0].replace(/^RRULE:/i, "");
  }

  const remoteRevision = ev.updated ?? null;

  return {
    icalUid,
    remoteRevision,
    title,
    description,
    scheduledDate,
    scheduledStartTime,
    scheduledEndTime,
    dueDate,
    recurrenceRule,
    statusCancelled,
    statusCompleted,
    devplannerTaskId,
  };
}

export function taskToGoogleEvent(
  task: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    scheduledDate: string | null;
    scheduledStartTime: string | null;
    scheduledEndTime: string | null;
    dueDate: string | null;
    recurrenceRule: string | null;
    caldavUid: string | null;
    icalUid: string | null;
  },
  tz: string
): calendar_v3.Schema$Event | null {
  const sd = task.scheduledDate;
  const due = task.dueDate;
  if (!sd && !due) return null;

  const stableUid = task.caldavUid?.trim() || task.id;

  let summary = task.title;
  if (task.status === "done") summary = `[Done] ${summary}`;
  if (task.status === "cancelled") summary = `[Cancelled] ${summary}`;
  if (task.status === "blocked") summary = `[Blocked] ${summary}`;

  const uid = (task.icalUid?.trim() || `${stableUid}@devplanner`).replace(/[\r\n;]/g, "");

  const ext: calendar_v3.Schema$Event["extendedProperties"] = {
    private: {
      devplannerTaskId: task.id,
      devplannerUid: stableUid,
    },
  };

  let start: calendar_v3.Schema$Event["start"];
  let end: calendar_v3.Schema$Event["end"];

  if (sd) {
    const st = parseWallTime(task.scheduledStartTime);
    const et = parseWallTime(task.scheduledEndTime);
    if (st && et) {
      start = {
        dateTime: `${sd}T${pad(st.h)}:${pad(st.m)}:00`,
        timeZone: tz,
      };
      end = {
        dateTime: `${sd}T${pad(et.h)}:${pad(et.m)}:00`,
        timeZone: tz,
      };
    } else {
      const startDate = sd;
      const d = new Date(sd + "T12:00:00");
      d.setDate(d.getDate() + 1);
      const endDate = d.toISOString().slice(0, 10);
      start = { date: startDate };
      end = { date: endDate };
    }
  } else if (due) {
    const startDate = due;
    const d = new Date(due + "T12:00:00");
    d.setDate(d.getDate() + 1);
    const endDate = d.toISOString().slice(0, 10);
    start = { date: startDate };
    end = { date: endDate };
  } else {
    return null;
  }

  const body: calendar_v3.Schema$Event = {
    summary,
    description: task.description?.trim() || undefined,
    start,
    end,
    extendedProperties: ext,
    iCalUID: uid,
  };

  if (task.recurrenceRule?.trim()) {
    body.recurrence = [`RRULE:${task.recurrenceRule.trim().replace(/^RRULE:/i, "")}`];
  }

  if (task.status === "cancelled") {
    body.status = "cancelled";
  }

  return body;
}

export async function runGooglePushJob(input: {
  userId: string;
  taskId: string;
  googleEventId: string | null | undefined;
  action: "create" | "update" | "delete";
}): Promise<{ ok: boolean; detail?: string; skipped?: boolean }> {
  const bundle = await getCalendarForUser(input.userId);
  if (!bundle) return { ok: true, skipped: true };

  const { calendar, calendarId } = bundle;
  const userRow = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
  const tz = userRow?.timezone?.trim() || "UTC";

  if (input.action === "delete") {
    const eid = input.googleEventId?.trim();
    if (!eid) return { ok: true };
    try {
      await calendar.events.delete({ calendarId, eventId: eid });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("404")) return { ok: true };
      return { ok: false, detail: msg };
    }
  }

  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, input.taskId) });
  if (!task) return { ok: false, detail: "task not found" };

  // Build a synthetic view for Google — use dueDate as the scheduledDate for push
  const body = taskToGoogleEvent({
    ...task,
    scheduledDate: task.dueDate ?? null,
    scheduledStartTime: null,
    scheduledEndTime: null,
  }, tz);
  if (!body) {
    if (task.googleEventId) {
      try {
        await calendar.events.delete({ calendarId, eventId: task.googleEventId });
      } catch {
        /* ignore */
      }
      await db
        .update(tasks)
        .set({ googleEventId: null, googleRemoteUpdated: null, updatedAt: new Date() })
        .where(eq(tasks.id, task.id));
    }
    return { ok: true };
  }

  try {
    if (task.googleEventId) {
      const res = await calendar.events.patch({
        calendarId,
        eventId: task.googleEventId,
        requestBody: body,
      });
      const u = res.data.updated ?? null;
      const ical = res.data.iCalUID ?? task.icalUid;
      await db
        .update(tasks)
        .set({
          googleRemoteUpdated: u,
          icalUid: ical,
          updatedAt: task.updatedAt,
        })
        .where(eq(tasks.id, task.id));
      return { ok: true };
    }

    const res = await calendar.events.insert({
      calendarId,
      requestBody: body,
    });
    const ev = res.data;
    await db
      .update(tasks)
      .set({
        googleEventId: ev.id ?? null,
        googleRemoteUpdated: ev.updated ?? null,
        icalUid: ev.iCalUID ?? task.icalUid,
        updatedAt: task.updatedAt,
      })
      .where(eq(tasks.id, task.id));
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function runGooglePullForUser(userId: string): Promise<{
  imported: number;
  updated: number;
  removed: number;
  skipped: number;
  errors: string[];
}> {
  const stats = { imported: 0, updated: 0, removed: 0, skipped: 0, errors: [] as string[] };
  const bundle = await getCalendarForUser(userId);
  if (!bundle) {
    stats.errors.push("Google Calendar not connected");
    return stats;
  }

  const linkRow = await db.query.googleCalendarLinks.findFirst({
    where: eq(googleCalendarLinks.userId, userId),
  });
  if (!linkRow) {
    stats.errors.push("Google Calendar not connected");
    return stats;
  }

  const { calendar, calendarId } = bundle;
  const areaId = await resolveOrCreateImportAreaId(userId);
  if (!areaId) {
    stats.errors.push("User not found");
    return stats;
  }

  const now = new Date();
  const seenIds = new Set<string>();
  let nextSyncToken: string | undefined;
  let fullSync = !linkRow.syncToken?.trim();

  const listOnce = async (opts: {
    syncToken?: string;
    pageToken?: string;
    timeMin?: string;
    timeMax?: string;
  }) => {
    const res = await calendar.events.list({
      calendarId,
      maxResults: 250,
      singleEvents: true,
      showDeleted: true,
      syncToken: opts.syncToken,
      pageToken: opts.pageToken,
      timeMin: opts.timeMin,
      timeMax: opts.timeMax,
    });
    return res.data;
  };

  try {
    if (!fullSync) {
      try {
        let data = await listOnce({ syncToken: linkRow.syncToken! });
        for (;;) {
          for (const ev of data.items ?? []) {
            if (ev.id) seenIds.add(ev.id);
            await applyOneGoogleEvent(userId, areaId, ev, now, stats);
          }
          if (data.nextPageToken) {
            data = await listOnce({ pageToken: data.nextPageToken });
            continue;
          }
          nextSyncToken = data.nextSyncToken ?? undefined;
          break;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("410") || msg.toLowerCase().includes("gone")) {
          fullSync = true;
        } else {
          stats.errors.push(msg);
          return stats;
        }
      }
    }

    if (fullSync) {
      seenIds.clear();
      // stress-test-fix: expand recurring instances + bounded future window for Google API
      const tMin = new Date(Date.now() - 90 * 86400000).toISOString();
      const tMax = new Date(Date.now() + 28 * 86400000).toISOString();
      let data = await listOnce({ timeMin: tMin, timeMax: tMax });
      for (;;) {
        for (const ev of data.items ?? []) {
          if (ev.id) seenIds.add(ev.id);
          await applyOneGoogleEvent(userId, areaId, ev, now, stats);
        }
        if (data.nextPageToken) {
          data = await listOnce({ pageToken: data.nextPageToken });
          continue;
        }
        nextSyncToken = data.nextSyncToken ?? undefined;
        break;
      }

      const tracked = await db.query.tasks.findMany({
        where: and(eq(tasks.userId, userId), isNotNull(tasks.googleEventId)),
      });
      for (const t of tracked) {
        const gid = t.googleEventId!;
        if (seenIds.has(gid)) continue;
        if (!t.googleLastPullAt) continue;
        const isImported = Boolean(t.icalUid && !DEVPLANNER_UID_RE.test(t.icalUid));
        if (isImported) {
          await db.delete(tasks).where(eq(tasks.id, t.id));
          stats.removed++;
        } else {
          await db
            .update(tasks)
            .set({ status: "cancelled", updatedAt: now, completedAt: null })
            .where(eq(tasks.id, t.id));
          stats.removed++;
        }
      }
    }

    if (nextSyncToken) {
      await db
        .update(googleCalendarLinks)
        .set({ syncToken: nextSyncToken, updatedAt: new Date() })
        .where(eq(googleCalendarLinks.userId, userId));
    }
  } catch (e) {
    stats.errors.push(e instanceof Error ? e.message : String(e));
  }

  return stats;
}

function clampImportedYmd(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const y = Number(s.slice(0, 4));
  if (y > new Date().getFullYear() + 2) return null;
  return s;
}

async function applyOneGoogleEvent(
  userId: string,
  areaId: string,
  raw: calendar_v3.Schema$Event,
  now: Date,
  stats: { imported: number; updated: number; removed: number; skipped: number; errors: string[] }
) {
  const parsed = parseGoogleEvent(raw);
  if (!parsed) {
    stats.skipped++;
    return;
  }
  parsed.scheduledDate = clampImportedYmd(parsed.scheduledDate);
  parsed.dueDate = clampImportedYmd(parsed.dueDate);

  const remoteRev = parsed.remoteRevision ?? "";
  const evId = raw.id!;

  let existing =
    parsed.devplannerTaskId != null
      ? await db.query.tasks.findFirst({
          where: and(eq(tasks.userId, userId), eq(tasks.id, parsed.devplannerTaskId)),
        })
      : await db.query.tasks.findFirst({
          where: and(eq(tasks.userId, userId), eq(tasks.googleEventId, evId)),
        });

  if (!existing && parsed.icalUid) {
    existing = await db.query.tasks.findFirst({
      where: and(eq(tasks.userId, userId), eq(tasks.icalUid, parsed.icalUid)),
    });
  }

  if (!existing) {
    const ourUid = parseDevplannerCaldavUid(parsed.icalUid);
    if (ourUid) {
      existing = await db.query.tasks.findFirst({
        where: and(eq(tasks.userId, userId), eq(tasks.caldavUid, ourUid)),
      });
    }
  }

  if (parsed.statusCancelled) {
    if (existing) {
      const isImported = Boolean(existing.icalUid && !DEVPLANNER_UID_RE.test(existing.icalUid));
      if (isImported) {
        await db.delete(tasks).where(eq(tasks.id, existing.id));
        stats.removed++;
      } else {
        await db
          .update(tasks)
          .set({
            status: "cancelled",
            googleEventId: evId,
            googleRemoteUpdated: remoteRev || null,
            googleLastPullAt: now,
            updatedAt: now,
            completedAt: null,
          })
          .where(eq(tasks.id, existing.id));
        stats.updated++;
      }
    }
    return;
  }

  if (existing) {
    const isOurs = Boolean(parsed.devplannerTaskId || DEVPLANNER_UID_RE.test(parsed.icalUid));
    if (
      isOurs &&
      existing.googleLastPullAt &&
      existing.updatedAt > existing.googleLastPullAt &&
      existing.googleRemoteUpdated === remoteRev
    ) {
      stats.skipped++;
      return;
    }

    let status = existing.status;
    if (parsed.statusCompleted) status = "done";
    else if (existing.status === "done" || existing.status === "cancelled") {
      status = "todo";
    }

    await db
      .update(tasks)
      .set({
        title: parsed.title,
        description: parsed.description,
        status,
        dueDate: parsed.dueDate ?? parsed.scheduledDate,
        recurrenceRule: parsed.recurrenceRule,
        icalUid: parsed.icalUid,
        googleEventId: evId,
        googleRemoteUpdated: remoteRev || null,
        googleLastPullAt: now,
        updatedAt: now,
        completedAt: status === "done" ? (existing.completedAt ?? now) : null,
      })
      .where(eq(tasks.id, existing.id));

    // Upsert a subtask for the scheduled date
    if (parsed.scheduledDate) {
      const existingSub = await db.query.subtasks.findFirst({
        where: and(eq(subtasks.taskId, existing.id), eq(subtasks.scheduledDate, parsed.scheduledDate)),
      });
      if (!existingSub) {
        await db.insert(subtasks).values({
          taskId: existing.id,
          title: parsed.title,
          scheduledDate: parsed.scheduledDate,
          scheduledTime: parsed.scheduledStartTime ?? null,
        });
      }
    }
    stats.updated++;
    return;
  }

  let status: (typeof tasks.$inferInsert)["status"] = "todo";
  if (parsed.statusCompleted) status = "done";

  const insertRow: typeof tasks.$inferInsert = {
    userId,
    areaId,
    title: parsed.title,
    description: parsed.description,
    status,
    priority: "normal",
    energyLevel: "admin",
    workDepth: null,
    physicalEnergy: null,
    taskType: "main",
    dueDate: parsed.dueDate ?? parsed.scheduledDate,
    recurrenceRule: parsed.recurrenceRule,
    icalUid: parsed.icalUid,
    googleEventId: evId,
    googleRemoteUpdated: remoteRev || null,
    googleLastPullAt: now,
    completedAt: status === "done" ? now : null,
  };

  const ourUid = parseDevplannerCaldavUid(parsed.icalUid);
  if (ourUid) {
    insertRow.caldavUid = ourUid;
  }

  try {
    const [inserted] = await db.insert(tasks).values(insertRow).returning();
    // Create a subtask for the scheduled date so it appears in Now/Timeline
    if (inserted && parsed.scheduledDate) {
      await db.insert(subtasks).values({
        taskId: inserted.id,
        title: parsed.title,
        scheduledDate: parsed.scheduledDate,
        scheduledTime: parsed.scheduledStartTime ?? null,
      });
    }
    stats.imported++;
  } catch (e) {
    stats.errors.push(`${evId}: ${String(e)}`);
  }
}
