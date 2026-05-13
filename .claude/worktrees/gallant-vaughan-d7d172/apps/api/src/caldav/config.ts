/** Radicale / CalDAV settings from environment. */

export type CaldavConfig = {
  /** Full collection URL, must end with `/` (e.g. `http://localhost:5232/alice/tasks/`) */
  calendarUrl: string;
  username: string;
  password: string;
};

export function getCaldavConfig(): CaldavConfig | null {
  const calendarUrl = process.env.CALDAV_CALENDAR_URL?.trim();
  const username = process.env.CALDAV_USER?.trim() ?? "";
  const password = process.env.CALDAV_PASSWORD ?? "";

  if (!calendarUrl || !username) {
    return null;
  }

  const normalized = calendarUrl.endsWith("/") ? calendarUrl : `${calendarUrl}/`;
  return { calendarUrl: normalized, username, password };
}

export function caldavEnabled(): boolean {
  return getCaldavConfig() !== null;
}
