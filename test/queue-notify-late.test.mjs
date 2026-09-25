/* Plan item 14: the waiting hall hears when the doctor is running late, with the new estimate.
 *
 * The template (queue.msg.delayed) existed in three languages and nothing sent it. What these defend:
 *   - it goes when the doctor is away (break, emergency, procedure, meeting, paused) or the estimate slipped
 *     20 minutes past the one the patient was given,
 *   - never to the next patient (their own message says come in), at most one per 30 minutes and 3 a visit,
 *   - the estimate is a clock time, and the body names nobody.
 *
 * node --test --experimental-test-module-mocks test/queue-notify-late.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sent = [], writes = [];
mock.module("../functions/_followcare_sms.js", { namedExports: { sendSms: async (_e, p) => { sent.push(p.body); return { ok: true }; }, smsConfigured: () => true } });
mock.module("../functions/_followcare_whatsapp.js", { namedExports: { sendWhatsApp: async () => ({ ok: false }), waConfigured: () => false } });
mock.module("../functions/_queue.js", { namedExports: { decPHI: async (_e, v) => String(v || "").replace(/^enc:/, ""), mintTicketToken: async () => "opaque" } });
mock.module("../functions/_fbfirestore.js", { namedExports: { fsCommit: async (_e, w) => { writes.push(...w); return { ok: true }; }, wCreate: () => ({}), wUpdate: (_e, path, f) => ({ path, f }) } });
const N = await import("../functions/_queue_notify.js");
const { delayDue, doctorAway, clockTime, runQueueNotifications, DELAY } = N;

const NOW = Date.parse("2026-09-25T05:00:00Z"), MIN = 60000;
const T = (o) => ({ id: "t1", status: "waiting", position: 4, encMobile: "enc:9876543210", encName: "enc:Asha Kumar", lang: "en", n_stage: 3, n_reg: true, ...o });

test("sent when the doctor is away or the estimate slipped 20 minutes; not to the next patient; throttled and capped", () => {
  assert.equal(delayDue(T({ n_etaTold: NOW, etaStart: NOW + 19 * MIN }), NOW, false), false, "19 minutes is a normal morning");
  assert.equal(delayDue(T({ n_etaTold: NOW, etaStart: NOW + 20 * MIN }), NOW, false), true);
  assert.equal(delayDue(T({ n_etaTold: NOW }), NOW, true), true, "the doctor away is news even before the estimate moves");
  assert.equal(delayDue(T({ position: 1 }), NOW, true), false, "the next patient is told to come in, not to wait");
  assert.equal(delayDue(T({ status: "in_consultation" }), NOW, true), false);
  assert.equal(delayDue(T({ n_delayAt: NOW - 29 * MIN }), NOW, true), false, "at most one per 30 minutes");
  assert.equal(delayDue(T({ n_delayAt: NOW - 30 * MIN }), NOW, true), true);
  assert.equal(delayDue(T({ n_delays: DELAY.max }), NOW, true), false, "and three a visit");
  assert.equal(delayDue(T({ etaStart: NOW + 90 * MIN }), NOW, false), false, "no baseline yet: nothing to have slipped from");
  for (const s of ["break", "emergency", "procedure", "meeting"]) assert.equal(doctorAway({ doctorStatus: s }), true, s);
  assert.equal(doctorAway({ doctorStatus: "consulting" }), false);
  assert.equal(doctorAway({ doctorStatus: "consulting", status: "paused" }), true);
  assert.equal(clockTime(Date.parse("2026-09-25T06:10:00Z")), "11:40 am", "a clock time in the hospital's day");
});

test("through the queue pass: first a baseline, then the message with the new time, and the counters move", async () => {
  sent.length = 0; writes.length = 0;
  const S = { hospitalId: "h", department: "Cardiology", doctorName: "Dr Rao", doctorStatus: "consulting" };
  const t = T({ etaStart: Date.now() + 40 * MIN });
  await runQueueNotifications({}, S, [t], {});
  assert.equal(sent.length, 0, "the first estimate is only remembered");
  assert.ok(writes.some((w) => w.f && w.f.n_etaTold === t.etaStart));
  t.etaStart += 25 * MIN;
  await runQueueNotifications({}, S, [t], {});
  assert.equal(sent.length, 1);
  assert.match(sent[0], /^The doctor is running a little behind at Cardiology\. Updated estimate: \d{1,2}:\d{2} (am|pm)\./);
  assert.doesNotMatch(sent[0], /Asha|Kumar|9876543210/, "no PHI in the body");
  assert.equal(t.n_delays, 1); assert.equal(t.n_etaTold, t.etaStart, "the new estimate is the new baseline");
  await runQueueNotifications({}, S, [t], {});
  assert.equal(sent.length, 1, "not again on the next pass");
});

test("a doctor going on break recomputes at once, so the hall hears it now, not at the next patient", () => {
  const r = readFileSync(new URL("../functions/api/queue/[[path]].js", import.meta.url), "utf8");
  assert.match(r, /const sess = await Q\.setSessionStatus\(env, s, body, actor\.id\);\s+try \{ await Q\.recompute\(env, sess\); \}/);
});
