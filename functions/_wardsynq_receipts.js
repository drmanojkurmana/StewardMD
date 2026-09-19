/* functions/_wardsynq_receipts.js — the smallest seam that makes "delivered" mean something.
 *
 * The push API can tell you APNs accepted a message. It cannot tell you a handset received it, and
 * for a deterioration escalation that difference is the whole control: a phone that is off looks
 * exactly like a phone that buzzed. So the handset says so itself. native-push.js posts here when a
 * WardSynQ alert actually arrives, again when a clinician opens it, and again when they acknowledge
 * it, and the workstation that raised the alert polls these back.
 *
 * DELIBERATELY SMALL. No new datastore, no new auth: the same KV the push tokens live in, and the
 * same Firebase identity check every other push route uses. A receipt is a fact about a device and a
 * user, so it is written under the caller's own uid and cannot be forged for somebody else.
 *
 * RETENTION. Receipts expire. They are transport evidence, not the clinical record - the clinical
 * record is the timeline entry the acknowledgement event produces on the workstation.
 */

import { pushKv } from "./_webpush.js";

const KIND = ["delivered", "viewed", "acknowledged"];

/** The same KV resolver the push tokens already use, rather than a second binding to configure. */
const kv = pushKv;

/** 14 days. Long enough for an incident review to pull the transport evidence, not a second record. */
const TTL_SECONDS = 14 * 24 * 60 * 60;

const key = (noticeId, kind, uid) => `wsq:receipt:${noticeId}:${kind}:${uid}`;

/**
 * Records one receipt. Idempotent per (notice, kind, user): a handset that retries does not create
 * a second delivery, and a clinician double-tapping acknowledge does not acknowledge twice.
 */
export async function saveReceipt(env, uid, body) {
  const store = kv(env);
  if (!store) return { ok: false, error: "no-kv" };
  const noticeId = body && body.noticeId;
  const kind = body && body.kind;
  if (!noticeId || typeof noticeId !== "string" || noticeId.length > 200) return { ok: false, error: "bad-notice" };
  if (KIND.indexOf(kind) < 0) return { ok: false, error: "bad-kind" };
  // An acknowledgement must name a person. The uid does that, and it comes from the verified token
  // rather than the request body, so a device cannot acknowledge on somebody else's behalf.
  const rec = {
    noticeId,
    kind,
    by: uid,
    device: (body.device && String(body.device).slice(0, 120)) || null,
    action: (body.action && String(body.action).slice(0, 120)) || null,
    patientId: (body.patientId && String(body.patientId).slice(0, 120)) || null,
    alertId: (body.alertId && String(body.alertId).slice(0, 120)) || null,
    at: new Date().toISOString(),
  };
  const existing = await store.get(key(noticeId, kind, uid));
  if (existing) return { ok: true, duplicate: true };
  await store.put(key(noticeId, kind, uid), JSON.stringify(rec), { expirationTtl: TTL_SECONDS });
  return { ok: true, duplicate: false };
}

/**
 * Lists receipts for the calling account.
 *
 * Scoped to the caller's own uid: this returns evidence about that clinician's devices, not a
 * hospital-wide feed. A workstation logged in as the same account gets its receipts back.
 */
export async function listReceipts(env, uid, since) {
  const store = kv(env);
  if (!store) return [];
  const out = [];
  let cursor;
  do {
    const page = await store.list({ prefix: "wsq:receipt:", cursor, limit: 1000 });
    for (const k of page.keys || []) {
      if (!k.name.endsWith(`:${uid}`)) continue;
      const raw = await store.get(k.name);
      if (!raw) continue;
      try {
        const rec = JSON.parse(raw);
        if (since && rec.at <= since) continue;
        out.push(rec);
      } catch (e) { /* a corrupt row is skipped, never thrown */ }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out.sort((a, b) => (a.at < b.at ? -1 : 1));
}
