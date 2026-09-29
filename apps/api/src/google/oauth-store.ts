import { pool } from "../db/client.js";
import type { OAuthAttemptStore } from "./oauth-state.js";
export const pgOAuthAttemptStore: OAuthAttemptStore = {
  async insert(stateHash, userId, expiresAt) {
    await pool.query("DELETE FROM oauth_attempts WHERE expires_at < NOW()");
    await pool.query(
      "INSERT INTO oauth_attempts(state_hash,user_id,expires_at) VALUES($1,$2,$3)",
      [stateHash, userId, expiresAt],
    );
  },
  async consume(stateHash, userId, now) {
    const result = await pool.query(
      "UPDATE oauth_attempts SET consumed_at=$3 WHERE state_hash=$1 AND user_id=$2 AND consumed_at IS NULL AND expires_at>$3 RETURNING id",
      [stateHash, userId, now],
    );
    return result.rowCount === 1;
  },
};
