import { and, eq, isNotNull } from "drizzle-orm";
import { caldavEnabled } from "./config.js";
import { DEVPLANNER_UID_RE, parseDevplannerCaldavUid, parseIncomingICS } from "./parse-incoming.js";
import { getCalendarResourceByHref, listCalendarIcsHrefs } from "./radicale-client.js";
import { db } from "../db/client.js";
import { resolveOrCreateImportAreaId } from "../lib/importArea.js";
import { tasks, users } from "../db/schema.js";

function basenameFromHref(href: string): string {
  const parts = href.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "event.ics";
}

/**
 * Pull all calendar objects from the configured collection and merge into tasks (no CalDAV enqueue).
 */
export async function runCaldavPullForUser(userId: string): Promise<{
  imported: number;
  updated: number;
  removed: number;
  skipped: number;
  errors: string[];
}> {
  const stats = { imported: 0, updated: 0, removed: 0, skipped: 0, errors: [] as string[] };

  if (!caldavEnabled()) {
    stats.errors.push("CalDAV not configured");
    return stats;
  }

  const list = await listCalendarIcsHrefs();
  if (!list.ok) {
    stats.errors.push(list.detail);
    return stats;
  }

  const serverFiles = new Set(list.hrefs.map((h) => basenameFromHref(h)));
  const areaId = await resolveOrCreateImportAreaId(userId);
  if (!areaId) {
    stats.errors.push("User not found");
    return stats;
  }

  const now = new Date();

  for (const href of list.hrefs) {
    const filename = basenameFromHref(href);
    const got = await getCalendarResourceByHref(href);
    if (!got.ok) {
      stats.errors.push(`${filename}: ${got.detail}`);
      continue;
    }

    let parsed;
    try {
      parsed = parseIncomingICS(got.body);
    } catch (e) {
      stats.errors.push(`${filename}: parse ${String(e)}`);
      continue;
    }

    if (parsed.length === 0) {
      stats.skipped++;
      continue;
    }

    for (const ev of parsed) {
      const ourUid = parseDevplannerCaldavUid(ev.icalUid);
      let existing =
        ourUid != null
          ? await db.query.tasks.findFirst({
              where: and(eq(tasks.userId, userId), eq(tasks.caldavUid, ourUid)),
            })
          : await db.query.tasks.findFirst({
              where: and(eq(tasks.userId, userId), eq(tasks.icalUid, ev.icalUid)),
            });

      const remoteRev = ev.remoteRevision ?? "";

      if (existing) {
        const isOurs = DEVPLANNER_UID_RE.test(ev.icalUid);
        if (
          isOurs &&
          existing.caldavLastPullAt &&
          existing.updatedAt > existing.caldavLastPullAt &&
          existing.caldavRemoteDtstamp === remoteRev
        ) {
          stats.skipped++;
          continue;
        }

        let status = existing.status;
        if (ev.statusCancelled) status = "cancelled";
        else if (ev.statusCompleted) status = "done";
        else if (existing.status === "done" || existing.status === "cancelled") {
          status = "todo";
        }

        await db
          .update(tasks)
          .set({
            title: ev.title,
            description: ev.description,
            status,
            scheduledDate: ev.scheduledDate,
            scheduledStartTime: ev.scheduledStartTime,
            scheduledEndTime: ev.scheduledEndTime,
            dueDate: ev.dueDate,
            recurrenceRule: ev.recurrenceRule,
            icalUid: ev.icalUid,
            caldavResourceFilename: filename,
            caldavRemoteDtstamp: remoteRev || null,
            caldavLastPullAt: now,
            updatedAt: now,
            completedAt: status === "done" ? (existing.completedAt ?? now) : null,
          })
          .where(eq(tasks.id, existing.id));

        stats.updated++;
      } else {
        let status: (typeof tasks.$inferInsert)["status"] = "todo";
        if (ev.statusCancelled) status = "cancelled";
        else if (ev.statusCompleted) status = "done";

        const insertRow: typeof tasks.$inferInsert = {
          userId,
          areaId,
          title: ev.title,
          description: ev.description,
          status,
          priority: "normal",
          energyLevel: "shallow",
          taskType: "main",
          parentTaskId: null,
          scheduledDate: ev.scheduledDate,
          scheduledStartTime: ev.scheduledStartTime,
          scheduledEndTime: ev.scheduledEndTime,
          dueDate: ev.dueDate,
          recurrenceRule: ev.recurrenceRule,
          icalUid: ev.icalUid,
          caldavResourceFilename: filename,
          caldavRemoteDtstamp: remoteRev || null,
          caldavLastPullAt: now,
          completedAt: status === "done" ? now : null,
        };
        if (ourUid) {
          insertRow.caldavUid = ourUid;
        }
        try {
          await db.insert(tasks).values(insertRow);
          stats.imported++;
        } catch (e) {
          stats.errors.push(`${filename} ${ev.icalUid}: insert ${String(e)}`);
        }
      }
    }
  }

  const tracked = await db.query.tasks.findMany({
    where: and(eq(tasks.userId, userId), isNotNull(tasks.caldavResourceFilename)),
  });

  for (const t of tracked) {
    const fn = t.caldavResourceFilename!;
    if (serverFiles.has(fn)) continue;
    if (!t.caldavLastPullAt) continue;

    const isImported = t.icalUid && !DEVPLANNER_UID_RE.test(t.icalUid);
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

  return stats;
}

/** All users (for optional periodic pull). */
export async function listUserIdsForCaldavPull(): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(users);
  return rows.map((r) => r.id);
}
