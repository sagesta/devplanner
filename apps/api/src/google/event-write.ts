import type { calendar_v3 } from "googleapis";
export function providerStatus(error: unknown): number | undefined {
  const e = error as { code?: unknown; response?: { status?: number } };
  return (
    e?.response?.status ?? (typeof e?.code === "number" ? e.code : undefined)
  );
}
export interface EventWriter {
  patch(input: {
    calendarId: string;
    eventId: string;
    requestBody: calendar_v3.Schema$Event;
  }): Promise<{ data: calendar_v3.Schema$Event }>;
  insert(input: {
    calendarId: string;
    requestBody: calendar_v3.Schema$Event;
  }): Promise<{ data: calendar_v3.Schema$Event }>;
}
/** eventId must already be reserved in the task row before calling this function. */
export async function writeReservedEvent(
  client: EventWriter,
  calendarId: string,
  eventId: string,
  body: calendar_v3.Schema$Event,
) {
  const { iCalUID: _uid, id: _id, ...content } = body;
  try {
    return (await client.patch({ calendarId, eventId, requestBody: content }))
      .data;
  } catch (error) {
    if (providerStatus(error) !== 404) throw error;
  }
  try {
    return (
      await client.insert({
        calendarId,
        requestBody: { ...content, id: eventId },
      })
    ).data;
  } catch (error) {
    if (providerStatus(error) !== 409) throw error;
    // Another retry created this reserved ID. Converge to current content.
    return (await client.patch({ calendarId, eventId, requestBody: content }))
      .data;
  }
}
