/* test/queue-notify-sms.test.mjs - the OPD queue's SMS fallback speaks only through approved DLT templates.
 *
 * Before this, every queue SMS went out as the FollowCare check-in template with a blank name, whatever the
 * event. What these defend:
 *   - "registered" -> Appointment Confirmation, "ahead2" -> Check-In Alert, every other event: WhatsApp only,
 *   - the name slot is always "Patient" (owner 2026-09-27: a name is PHI); no name, MRN or phone in any slot,
 *   - no SMS when a slot cannot be filled truthfully (no doctor yet, no estimate).
 *
 * node --test --experimental-test-module-mocks test/queue-notify-sms.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const dlt = [], wa = [];
mock.module("../functions/_followcare_sms.js", { namedExports: { sendDlt: async (_e, to, key, slots) => { dlt.push({ to, key, slots }); return { ok: true }; }, dltConfigured: () => true } });
mock.module("../functions/_followcare_whatsapp.js", { namedExports: { sendWhatsApp: async (_e, p) => { wa.push(p.body); return { ok: false, reason: "not_on_whatsapp" }; }, waConfigured: () => true } });
mock.module("../functions/_queue.js", { namedExports: { decPHI: async (_e, v) => String(v || "").replace(/^enc:/, ""), mintTicketToken: async () => "opaque" } });
mock.module("../functions/_fbfirestore.js", { namedExports: { fsCommit: async () => ({ ok: true }), wCreate: () => ({}), wUpdate: () => ({}) } });
const { notifyTicket, smsSpec, smsTime, smsDate } = await import("../functions/_queue_notify.js");

const ETA = Date.parse("2026-09-25T06:10:00Z");   // 11:40 IST
const S = { hospitalId: "h", department: "Cardiology", doctorName: "Dr Rao" };
const T = (o) => ({ id: "t1", encMobile: "enc:9876543210", encName: "enc:Asha Kumar", mrn: "MR4821", position: 2, lang: "en", etaStart: ETA, ...o });
const LINK = "https://stewardmd.in/queue?t=opaque";

test("the SMS date and time take the shapes the approved samples used", () => {
  assert.equal(smsTime(ETA), "11.40am");
  assert.equal(smsDate(ETA), "25.9.2026");
});

test("registered and ahead2 map to their templates; every other event has none", () => {
  assert.deepEqual(smsSpec("registered", S, T(), LINK, ETA), { key: "appt_confirm", slots: ["Patient", "Rao", "Cardiology", "25.9.2026", "11.40am", LINK] });
  assert.deepEqual(smsSpec("ahead2", S, T(), LINK, ETA), { key: "checkin_alert", slots: ["Patient", "Rao", "Cardiology", "11.40am", LINK] });
  for (const ev of ["ahead5", "next", "delayed", "complete"]) assert.equal(smsSpec(ev, S, T(), LINK, ETA), null, ev);
});

test("the template's own 'Dr.' is not doubled, and a name that only starts with Dr is left alone", () => {
  for (const n of ["Dr Rao", "Dr. Rao", "dr.Rao", "DR  Rao", "Rao"]) assert.equal(smsSpec("ahead2", { ...S, doctorName: n }, T(), LINK, ETA).slots[1], "Rao", n);
  assert.equal(smsSpec("ahead2", { ...S, doctorName: "Drew Smith" }, T(), LINK, ETA).slots[1], "Drew Smith");
});

test("no SMS when a slot cannot be filled truthfully", () => {
  assert.equal(smsSpec("registered", { ...S, doctorName: "" }, T(), LINK, ETA), null, "no doctor");
  assert.equal(smsSpec("registered", { ...S, doctorName: "Unassigned" }, T(), LINK, ETA), null, "a pool ticket has no doctor yet");
  assert.equal(smsSpec("registered", S, T({ etaStart: 0 }), LINK, ETA), null, "no estimate");
});

test("the place is the ticket's department, then the session's, then 'the clinic'", () => {
  assert.equal(smsSpec("ahead2", S, T({ department: "Orthopaedics" }), LINK, ETA).slots[2], "Orthopaedics");
  assert.equal(smsSpec("ahead2", S, T(), LINK, ETA).slots[2], "Cardiology");
  assert.equal(smsSpec("ahead2", { ...S, department: "" }, T(), LINK, ETA).slots[2], "the clinic");
});

test("through notifyTicket: WhatsApp fails, the SMS goes as the template; next goes by WhatsApp only", async () => {
  dlt.length = 0; wa.length = 0;
  const r1 = await notifyTicket({}, S, T({ token: "A-012" }), "registered", {});
  assert.equal(r1.channel, "sms"); assert.equal(r1.waFellBack, true);
  assert.equal(dlt.length, 1);
  assert.equal(dlt[0].key, "appt_confirm"); assert.equal(dlt[0].to, "9876543210");
  assert.deepEqual(dlt[0].slots.slice(0, 3), ["Patient", "Rao", "Cardiology"]);
  const r2 = await notifyTicket({}, S, T({ token: "A-012", position: 1 }), "next", {});
  assert.equal(dlt.length, 1, "no template for next: no SMS");
  assert.equal(r2.channel, "whatsapp"); assert.equal(r2.ok, false);
  assert.equal(wa.length, 2, "WhatsApp was tried both times");
  for (const d of dlt) assert.doesNotMatch(JSON.stringify(d.slots), /Asha|Kumar|4821|9876543210/, "no PHI in any slot");
});
