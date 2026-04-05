import { getCaldavConfig } from "./config.js";

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function authHeaders(c: NonNullable<ReturnType<typeof getCaldavConfig>>): HeadersInit {
  return {
    Authorization: basicAuth(c.username, c.password),
  };
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontenttype/></d:prop></d:propfind>`;

/** Ensure each path segment of the collection URL exists (MKCOL). */
export async function ensureCalendarCollection(): Promise<{ ok: true } | { ok: false; detail: string }> {
  const c = getCaldavConfig();
  if (!c) return { ok: false, detail: "CalDAV not configured" };

  const u = new URL(c.calendarUrl);
  const origin = u.origin;
  const segments = u.pathname.split("/").filter(Boolean);

  let path = "";
  for (const seg of segments) {
    path += `/${seg}`;
    const collUrl = `${origin}${path}/`;
    const pr = await fetch(collUrl, {
      method: "PROPFIND",
      headers: {
        ...authHeaders(c),
        Depth: "0",
        "Content-Type": "application/xml; charset=utf-8",
      },
      body: PROPFIND_BODY,
    });

    if (pr.status === 404 || pr.status === 410) {
      const mk = await fetch(collUrl, {
        method: "MKCOL",
        headers: authHeaders(c),
      });
      if (!mk.ok && mk.status !== 405) {
        const t = await mk.text().catch(() => "");
        return { ok: false, detail: `MKCOL ${collUrl} → ${mk.status} ${t.slice(0, 200)}` };
      }
    } else if (!pr.ok && pr.status !== 207) {
      const t = await pr.text().catch(() => "");
      return { ok: false, detail: `PROPFIND ${collUrl} → ${pr.status} ${t.slice(0, 200)}` };
    }
  }

  return { ok: true };
}

/** Return hrefs (path + query) to `.ics` members, relative to server origin. */
export async function listCalendarIcsHrefs(): Promise<
  { ok: true; hrefs: string[] } | { ok: false; detail: string }
> {
  const c = getCaldavConfig();
  if (!c) return { ok: false, detail: "CalDAV not configured" };

  const res = await fetch(c.calendarUrl, {
    method: "PROPFIND",
    headers: {
      ...authHeaders(c),
      Depth: "1",
      "Content-Type": "application/xml; charset=utf-8",
    },
    body: PROPFIND_BODY,
  });

  if (!res.ok && res.status !== 207) {
    const t = await res.text().catch(() => "");
    return { ok: false, detail: `PROPFIND depth 1 → ${res.status} ${t.slice(0, 400)}` };
  }

  const xml = await res.text();
  const hrefs: string[] = [];
  const re = /<(?:[a-zA-Z]+:)?href[^>]*>([^<]+)<\/(?:[a-zA-Z]+:)?href>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const raw = decodeURIComponent(m[1].trim());
    if (!raw.toLowerCase().endsWith(".ics")) continue;
    if (raw.includes("://")) continue;
    hrefs.push(raw.startsWith("/") ? raw : `/${raw}`);
  }

  return { ok: true, hrefs: [...new Set(hrefs)] };
}

export async function getCalendarResourceByHref(
  href: string
): Promise<{ ok: true; body: string; etag: string | null } | { ok: false; detail: string }> {
  const c = getCaldavConfig();
  if (!c) return { ok: false, detail: "CalDAV not configured" };

  const u = new URL(c.calendarUrl);
  const url = href.startsWith("http") ? href : `${u.origin}${href.startsWith("/") ? "" : "/"}${href}`;

  const res = await fetch(url, { headers: authHeaders(c) });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { ok: false, detail: `GET ${url} → ${res.status} ${t.slice(0, 300)}` };
  }
  const body = await res.text();
  const etag = res.headers.get("etag");
  return { ok: true, body, etag };
}

export function resourceUrlForFilename(calendarUrl: string, filename: string): string {
  const safe = filename.replace(/^\/+/, "").replace(/\.\./g, "");
  return `${calendarUrl}${safe}`;
}

export async function putCalendarResourceByFilename(
  filename: string,
  icsBody: string
): Promise<{ ok: true } | { ok: false; status: number; detail: string }> {
  const c = getCaldavConfig();
  if (!c) {
    return { ok: false, status: 0, detail: "CalDAV not configured" };
  }

  const mk = await ensureCalendarCollection();
  if (!mk.ok) {
    return { ok: false, status: 0, detail: mk.detail };
  }

  const url = resourceUrlForFilename(c.calendarUrl, filename);
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      ...authHeaders(c),
      "Content-Type": "text/calendar; charset=utf-8",
    },
    body: icsBody,
  });
  if (res.ok || res.status === 201 || res.status === 204) {
    return { ok: true };
  }
  const text = await res.text().catch(() => "");
  return { ok: false, status: res.status, detail: text.slice(0, 800) || res.statusText };
}

export async function deleteCalendarResourceByFilename(
  filename: string
): Promise<{ ok: true } | { ok: false; status: number; detail: string }> {
  const c = getCaldavConfig();
  if (!c) {
    return { ok: false, status: 0, detail: "CalDAV not configured" };
  }
  const url = resourceUrlForFilename(c.calendarUrl, filename);
  const res = await fetch(url, {
    method: "DELETE",
    headers: authHeaders(c),
  });
  if (res.ok || res.status === 204 || res.status === 404) {
    return { ok: true };
  }
  const text = await res.text().catch(() => "");
  return { ok: false, status: res.status, detail: text.slice(0, 800) || res.statusText };
}

/** @deprecated use putCalendarResourceByFilename + objectFilenameForTask */
export async function putCalendarResource(
  caldavUid: string,
  icsBody: string
): Promise<{ ok: true } | { ok: false; status: number; detail: string }> {
  return putCalendarResourceByFilename(`${caldavUid}.ics`, icsBody);
}

/** @deprecated use deleteCalendarResourceByFilename */
export async function deleteCalendarResource(
  caldavUid: string
): Promise<{ ok: true } | { ok: false; status: number; detail: string }> {
  return deleteCalendarResourceByFilename(`${caldavUid}.ics`);
}

export function objectFilenameForTask(task: {
  id: string;
  caldavUid: string | null;
  caldavResourceFilename: string | null;
}): string {
  const f = task.caldavResourceFilename?.trim();
  if (f) return f.replace(/^\/+/, "");
  const uid = task.caldavUid?.trim() || task.id;
  return `${uid}.ics`;
}
