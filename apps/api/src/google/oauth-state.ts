import { createHash, randomBytes } from "node:crypto";

export interface OAuthAttemptStore {
  insert(stateHash: string, userId: string, expiresAt: Date): Promise<void>;
  consume(stateHash: string, userId: string, now: Date): Promise<boolean>;
}
export const OAUTH_TTL_MS = 10 * 60 * 1000;
export const hashOAuthState = (state: string): string =>
  createHash("sha256").update(state).digest("hex");
/** Raw state goes only to the authorization redirect. Persist its hash. */
export async function issueOAuthState(
  store: OAuthAttemptStore,
  userId: string,
  now = new Date(),
): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  await store.insert(
    hashOAuthState(state),
    userId,
    new Date(now.getTime() + OAUTH_TTL_MS),
  );
  return state;
}
/** Store must consume atomically and match both owner and expiry. */
export async function consumeOAuthState(
  store: OAuthAttemptStore,
  state: unknown,
  userId: string,
  now = new Date(),
): Promise<boolean> {
  if (typeof state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state))
    return false;
  return store.consume(hashOAuthState(state), userId, now);
}
