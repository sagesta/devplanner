/** Google Calendar OAuth + API (Calendar API v3). */

export function googleCalendarConfigured(): boolean {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirect = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  return Boolean(id && secret && redirect);
}

export function getGoogleRedirectUri(): string {
  return process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ?? "";
}

export function getGoogleClientId(): string {
  return process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
}

export function getGoogleClientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
}
