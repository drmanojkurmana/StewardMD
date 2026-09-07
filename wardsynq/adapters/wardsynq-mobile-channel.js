/* wardsynq/adapters/wardsynq-mobile-channel.js — the StewardMD mobile app as an escalation channel.
 *
 * This is a channel adapter in the shape wardsynq-transport.js already defines, and nothing more. It
 * introduces no notification backend: it posts to the push API StewardMD already runs
 * (`functions/api/push/*`, tokens registered by native-push.js against a Firebase identity) and lets
 * APNs and FCM do what they already do for every other alert in the product.
 *
 * THE ONE THING THIS FILE IS CAREFUL ABOUT. A push accepted by APNs or FCM is SENT. It is not
 * delivered. The device may be off, out of signal, or have the app uninstalled, and the gateway will
 * still cheerfully return success, which is precisely how a hospital comes to believe it has a
 * working escalation path. So `send()` returns `{sent: true, delivered: false}` and the transport
 * ladder CONTINUES to the pager and the ward station, exactly as it does for the webhook.
 *
 * DELIVERED is reached by a different route entirely: the phone itself says so. native-push.js posts
 * a receipt when a WardSynQ alert actually arrives on the handset, and `collectReceipts()` below
 * brings those back so the orchestrator can move the notice forward. Until a real handset says "I
 * have this", nothing here claims it did.
 *
 * WHY THE LADDER DOES NOT STOP HERE. Stopping on SENT would mean one unreachable phone silences the
 * pager and the station screen for a deteriorating patient. Stopping requires CONFIRMED delivery,
 * which this adapter cannot give synchronously and does not pretend to.
 *
 * STATUS: IMPLEMENTED and TESTED against a mock fetch. NOT proven on a real handset. Until a real
 * device has carried a real alert and returned a receipt, this channel is UNVERIFIED, which the
 * transport's channelHealth() will say in those words.
 */

/** Marks a push as a WardSynQ clinical alert so native-push.js can recognise and receipt it. */
const WARDSYNQ_PUSH_TYPE = "wardsynq-alert";

/**
 * A channel that delivers to StewardMD mobile through the existing push API.
 *
 * @param {{fetch?: Function, apiBase?: string, authToken?: () => Promise<string|null>,
 *   uid?: string, timeoutMs?: number}} deps
 */
function stewardmdMobileChannel({ fetch: f, apiBase = "", authToken, timeoutMs = 8000 } = {}) {
  const doFetch = f || (typeof globalThis !== "undefined" ? globalThis.fetch : null);

  return async function sendToMobile(notice) {
    if (!doFetch) return { delivered: false, detail: "no fetch available in this environment" };

    const jwt = authToken ? await authToken().catch(() => null) : null;
    const headers = { "content-type": "application/json" };
    if (jwt) headers.authorization = `Bearer ${jwt}`;

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await doFetch(`${apiBase}/api/push/wardsynq-alert`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: notice.title,
          body: notice.body || "",
          // The identity that has to survive the round trip, or the receipt cannot be matched back
          // to the notice and the acknowledgement cannot name the patient.
          data: {
            type: WARDSYNQ_PUSH_TYPE,
            noticeId: notice.id,
            alertId: (notice.ref && notice.ref.alertId) || null,
            patientId: notice.patientId,
            urgency: notice.urgency || "routine",
            url: `wardsynq-alert:${notice.id}`,
          },
        }),
        signal: controller ? controller.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      if (!res || !res.ok) {
        return { delivered: false, detail: `push API returned ${res ? res.status : "no response"}` };
      }
      const out = await res.json().catch(() => ({}));
      if (!out || !out.sent) {
        // The API answered and reached no registered device. That is a real and common failure -
        // nobody has enabled push on a handset - and it must not read as a successful escalation.
        return { delivered: false, detail: "the push API accepted the request and had no registered device to send to" };
      }
      return {
        // NOT delivered. APNs/FCM accepting a message says nothing about a handset receiving it.
        delivered: false,
        sent: true,
        receipt: `push:${notice.id}`,
        detail: `queued to ${out.sent} of ${out.total} registered device(s). That is SENT: the handset has not confirmed receipt and no person has seen it`,
      };
    } catch (err) {
      if (timer) clearTimeout(timer);
      return { delivered: false, detail: String((err && err.message) || err) };
    }
  };
}

/**
 * Brings back the receipts real handsets have posted, so the orchestrator can move notices forward.
 *
 * Polled rather than pushed because the workstation that raised the alert has no inbound socket.
 * A receipt that never arrives leaves the notice where it was, which is the honest outcome: the
 * alert stays OUTSTANDING and the escalation timer keeps running.
 *
 * @returns {Promise<{noticeId, kind: "delivered"|"viewed"|"acknowledged", by, device, at}[]>}
 */
async function collectReceipts({ fetch: f, apiBase = "", authToken, since } = {}) {
  const doFetch = f || (typeof globalThis !== "undefined" ? globalThis.fetch : null);
  if (!doFetch) return [];
  const jwt = authToken ? await authToken().catch(() => null) : null;
  const headers = {};
  if (jwt) headers.authorization = `Bearer ${jwt}`;
  const qs = since ? `?since=${encodeURIComponent(since)}` : "";
  try {
    const res = await doFetch(`${apiBase}/api/push/wardsynq-receipts${qs}`, { headers });
    if (!res || !res.ok) return [];
    const out = await res.json().catch(() => ({}));
    return Array.isArray(out.receipts) ? out.receipts : [];
  } catch (err) {
    return [];   // a failed poll is not a delivery and not a crash; the notice simply stays put
  }
}

/**
 * Applies collected receipts to the orchestrator. One place, so every channel's receipts land in the
 * same state machine and the patient timeline is written once from the acknowledgement event.
 */
async function applyReceipts(orchestrator, receipts) {
  const applied = [];
  for (const r of receipts || []) {
    if (!r || !r.noticeId) continue;
    try {
      if (r.kind === "acknowledged") {
        const out = await orchestrator.acknowledge(r.noticeId, { by: r.by, device: r.device, action: r.action, at: r.at });
        applied.push({ ...r, duplicate: out.duplicate });
      } else if (r.kind === "viewed") {
        await orchestrator.recordViewed(r.noticeId, { by: r.by, device: r.device, at: r.at });
        applied.push(r);
      } else {
        await orchestrator.recordDelivered(r.noticeId, { channel: "stewardmd-mobile", device: r.device, at: r.at });
        applied.push(r);
      }
    } catch (err) {
      // A receipt for a notice this workstation does not know about is not an error worth stopping
      // for: another workstation raised it. Skip it and keep going.
    }
  }
  return applied;
}

export { stewardmdMobileChannel, collectReceipts, applyReceipts, WARDSYNQ_PUSH_TYPE };
