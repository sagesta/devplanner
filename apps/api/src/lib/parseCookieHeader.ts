/**
 * next-auth/jwt `getToken` only reads `req.cookies` (Next.js shape), not `Cookie` headers.
 * Hono gives a header string — convert so SessionStore can find chunked session cookies.
 */
export function cookiesRecordFromHeader(cookieHeader: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader?.trim()) return out;
  for (const segment of cookieHeader.split(";")) {
    const eq = segment.indexOf("=");
    if (eq === -1) continue;
    const name = segment.slice(0, eq).trim();
    const value = segment.slice(eq + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}
