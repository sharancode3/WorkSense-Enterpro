// Shared helper: after an authoritative domain transition, schedule the
// idempotent notification generator (notify-scan). Non-blocking by design —
// the response is returned immediately while the scan completes in the
// background. Failures are swallowed: notifications are derived from durable
// canonical state and the next scan would catch up; the transition itself is
// never rolled back because a notification could not be sent.
//
// NOTE: this module must stay free of `Deno` references so the plain shared
// typecheck (tsconfig.functions.json, node types) stays green. Callers pass
// their own runtime env values.
export async function notifyScanAfter(
  orgId: string,
  supabaseUrl: string,
  serviceKey: string
): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/functions/v1/notify-scan`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ org_id: orgId }),
    });
  } catch {
    /* non-fatal */
  }
}
