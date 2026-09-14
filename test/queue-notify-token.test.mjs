/* test/queue-notify-token.test.mjs - queue SMS/WhatsApp carry the OPD token where a patient needs to
 * recognise their turn (registered, next), and still carry no name, MRN or phone.
 * Run: node --experimental-test-module-mocks --test test/queue-notify-token.test.mjs */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const sent = [];
mock.module("../functions/_followcare_sms.js", { namedExports: { sendSms: async (_e, p) => { sent.push(p.body); return { ok: true }; }, smsConfigured: () => true } });
mock.module("../functions/_followcare_whatsapp.js", { namedExports: { sendWhatsApp: async () => ({ ok: false }), waConfigured: () => false } });
mock.module("../functions/_queue.js", { namedExports: { decPHI: async (_e, v) => String(v || "").replace(/^enc:/, ""), mintTicketToken: async () => "opaque" } });
mock.module("../functions/_fbfirestore.js", { namedExports: { fsCommit: async () => ({ ok: true }), wCreate: () => ({}), wUpdate: () => ({}) } });
const { notifyTicket } = await import("../functions/_queue_notify.js");

const S = { hospitalId: "h", department: "Cardiology", doctorName: "Dr Rao" };
const T = (extra) => ({ id: "t1", encMobile: "enc:9876543210", encName: "enc:Asha Kumar", mrnLast4: "4821", position: 1, lang: "en", ...extra });

test("registered and next messages lead with the token; other tiers and old tickets keep today's text", async () => {
  sent.length = 0;
  await notifyTicket({}, S, T({ token: "A-012" }), "registered", {});
  await notifyTicket({}, S, T({ token: "A-012" }), "next", {});
  await notifyTicket({}, S, T({ token: "A-012", position: 3 }), "ahead2", {});
  await notifyTicket({}, S, T({}), "next", {});
  await notifyTicket({}, S, T({ token: "7", lang: "hi" }), "next", {});
  assert.match(sent[0], /^Your token: A-012\. You're in the queue at Cardiology/);
  assert.match(sent[1], /^Your token: A-012\. You're next at Cardiology/);
  assert.doesNotMatch(sent[2], /token/i);
  assert.match(sent[3], /^You're next at Cardiology/, "no token, no token line");
  assert.match(sent[4], /^आपका टोकन: 7।/);
  for (const b of sent) assert.doesNotMatch(b, /Asha|Kumar|4821|9876543210/, "no PHI in a message body");
});
