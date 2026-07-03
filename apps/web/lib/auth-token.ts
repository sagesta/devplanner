/**
 * Bridge between Clerk's React context and plain fetch helpers.
 *
 * The Hono API lives on another origin (api.* in prod), where Clerk's
 * __session cookie never travels — so every API call carries a short-lived
 * Bearer token instead. Components can't be imported into lib/api.ts, so
 * providers.tsx registers the session's getToken here once at mount.
 */
type TokenGetter = () => Promise<string | null>;

let getter: TokenGetter | null = null;

export function registerAuthTokenGetter(fn: TokenGetter) {
  getter = fn;
}

export async function getAuthToken(): Promise<string | null> {
  if (!getter) return null;
  try {
    return await getter();
  } catch {
    return null;
  }
}

/** `Authorization: Bearer …` headers for API fetches (empty when signed out). */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
