import { transaction } from "./daily.js";
import { deliverCalendarOutbox } from "../queues/definitions.js";
/** Delivery is at least once; stable queue IDs make crash-after-enqueue retries safe. */
export async function drainCalendarOutbox(
  deliver: typeof deliverCalendarOutbox = deliverCalendarOutbox,
) {
  await transaction(async (c) => {
    const rows = await c.query(
      "SELECT id,payload FROM calendar_outbox WHERE delivered_at IS NULL ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED",
    );
    for (const row of rows.rows) {
      await deliver(row.id, row.payload);
      await c.query(
        "UPDATE calendar_outbox SET delivered_at=now() WHERE id=$1",
        [row.id],
      );
    }
    await c.query(
      "DELETE FROM calendar_outbox WHERE delivered_at<now()-interval '7 days'",
    );
    await c.query(
      "DELETE FROM mutation_receipts WHERE created_at<now()-interval '7 days'",
    );
    await c.query(
      "DELETE FROM schedule_previews WHERE expires_at<now()-interval '1 day'",
    );
    await c.query(
      "DELETE FROM oauth_attempts WHERE expires_at<now()-interval '1 day'",
    );
    await c.query("DELETE FROM daily_focus WHERE date<current_date-30");
  });
}
