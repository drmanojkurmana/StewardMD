/* test/sms-dlt.test.mjs - SMS goes out only as our approved DLT templates (Vodafone Idea DLT, header MAIK).
 *
 * The operator drops an SMS whose text does not match its registered template, so what these defend:
 *   - each template text is the approved text verbatim, every slot filled in order,
 *   - a wrong slot count or a blank slot sends nothing (never a half-filled message),
 *   - the request is 2Factor's R1 Transactional-SMS API with our DLT entity id and the content-template id
 *     (without peid the operator rejects it: DLT-CNT-REJECT, live test 2026-09-27).
 *
 * node --test test/sms-dlt.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DLT, DLT_PEID, dltText, dltConfigured, sendDlt } from "../functions/_followcare_sms.js";

// All 11 approved templates, from the DLT portal export (ContentTemplates.csv, 2026-09-27). A change here must be
// a new approval on Vilpower: the operator matches the text byte for byte.
const APPROVED = {
  "1177178791267832947": "Your OTP for login to StewardMD is {#num#}. Valid for {#num#} minutes. Do not share this OTP with anyone. -StewardMD",
  "1177178791454063563": "Dear {#alp#}, your appointment with Dr. {#alp#} at {#alp#} is confirmed for {#alp#} at {#alp#}. View details: {#uro#} -StewardMD",
  "1177178791273967656": "Dear {#alp#}, your appointment with Dr. {#alp#} at {#alp#} is confirmed for {#alp#} at {#alp#}. Please arrive 10 mins early. -StewardMD",
  "1177178791462158338": "Dear {#alp#}, reminder: your appointment with Dr. {#alp#} at {#alp#} is today at {#alp#}. Please check-in at reception 10 mins prior. Details: {#uro#} -StewardMD",
  "1177178791369851422": "Dear {#alp#}, reminder: your appointment with Dr. {#alp#} at {#alp#} is today at {#alp#}. Please check-in at reception 10 mins prior. -StewardMD",
  "1177178791481113659": "Dear {#alp#}, please continue your prescribed care plan from Dr. {#alp#} at {#alp#}. For any questions, contact us at {#cbn#}. Details: {#uro#} -StewardMD",
  "1177178791389160530": "Dear {#alp#}, please continue your prescribed care plan from Dr. {#alp#} at {#alp#}. For any questions, contact us at {#cbn#}. -StewardMD",
  "1177178791495757255": "Dear {#alp#}, we hope you're recovering well after your visit with Dr. {#alp#} at {#alp#}. If symptoms worsen, please contact us at {#cbn#}. Details: {#uro#} -StewardMD",
  "1177178791396071579": "Dear {#alp#}, we hope you're recovering well after your visit with Dr. {#alp#} at {#alp#}. If symptoms worsen, please contact us at {#cbn#}. -StewardMD",
  "1177178791470273641": "Dear {#alp#}, this is a reminder for your follow-up visit with Dr. {#alp#} at {#alp#} scheduled on {#alp#}. Please carry previous prescriptions and reports. Details: {#uro#} -StewardMD",
  "1177178791346053803": "Dear {#alp#}, this is a reminder for your follow-up visit with Dr. {#alp#} at {#alp#} scheduled on {#alp#}. Please carry previous prescriptions and reports. -StewardMD",
};

test("all 11 approved DLT templates are here, verbatim, each under its own content-template id", () => {
  const byId = {};
  for (const k of Object.keys(DLT)) { assert.ok(!byId[DLT[k].ctid], "ctid used twice: " + k); byId[DLT[k].ctid] = DLT[k].text; }
  assert.deepEqual(byId, APPROVED);
  // Each is registered on 2Factor under this name with the same text (#VARn# for the slots), 2026-09-27.
  const tpls = Object.keys(DLT).map((k) => DLT[k].tpl);
  assert.equal(new Set(tpls).size, 11); for (const t of tpls) assert.match(t, /^[A-Z_]+$/);
});

test("every Detailed template ends in its link and points at an approved no-link twin with the same slots before it", () => {
  for (const k of Object.keys(DLT)) {
    if (!DLT[k].plain) continue;
    const tw = DLT[DLT[k].plain];
    assert.ok(tw && !tw.plain, k + " -> " + DLT[k].plain);
    assert.match(DLT[k].text, /\{#uro#\} -StewardMD$/, k + " ends in its link");
    const slots = (t) => t.match(/\{#\w+#\}/g);
    assert.deepEqual(slots(tw.text), slots(DLT[k].text).slice(0, -1), k + " twin has the same slots minus the link");
  }
  assert.deepEqual(Object.keys(DLT).filter((k) => DLT[k].plain).sort(), ["appt_confirm", "care_plan", "checkin_alert", "post_visit", "visit_reminder"]);
});

test("Care Plan - Detailed: its callback slot is filled like any other", () => {
  assert.equal(dltText("care_plan", ["Patient", "Rao", "Cardiology", "04023456789", "L"]),
    "Dear Patient, please continue your prescribed care plan from Dr. Rao at Cardiology. For any questions, contact us at 04023456789. Details: L -StewardMD");
  assert.equal(dltText("care_plan", ["Patient", "Rao", "Cardiology", "", "L"]), "", "no clinic number: no message");
});

test("dltText fills every slot in order", () => {
  assert.equal(dltText("otp", ["123456", "10"]), "Your OTP for login to StewardMD is 123456. Valid for 10 minutes. Do not share this OTP with anyone. -StewardMD");
  assert.equal(dltText("appt_confirm", ["Patient", "Rao", "Cardiology", "27.9.2026", "11.40am", "https://stewardmd.in/queue?t=x"]),
    "Dear Patient, your appointment with Dr. Rao at Cardiology is confirmed for 27.9.2026 at 11.40am. View details: https://stewardmd.in/queue?t=x -StewardMD");
  assert.equal(dltText("checkin_alert", ["Patient", "Rao", "Cardiology", "11.40am", "L"]),
    "Dear Patient, reminder: your appointment with Dr. Rao at Cardiology is today at 11.40am. Please check-in at reception 10 mins prior. Details: L -StewardMD");
  assert.equal(dltText("otp", ["123456", " 10\n"]), dltText("otp", ["123456", "10"]), "whitespace in a value is tidied, the fixed text is not");
});

test("dltText refuses anything that cannot match the registered text", () => {
  assert.equal(dltText("otp", ["123456"]), "", "too few slots");
  assert.equal(dltText("otp", ["1", "2", "3"]), "", "too many slots");
  assert.equal(dltText("otp", ["123456", ""]), "", "a blank slot");
  assert.equal(dltText("otp", ["123456", null]), "", "a missing slot");
  assert.equal(dltText("nope", ["a"]), "", "an unknown template");
  assert.equal(dltText("otp", "123456"), "", "slots must be a list");
});

const ENV = { FOLLOWCARE_SMS_PROVIDER: "twofactor", TWOFACTOR_API_KEY: "k2f", TWOFACTOR_SENDER: "MAIK" };
function withFetch(handler, fn) {
  const real = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, o) => { calls.push({ url: String(url), o }); return handler(); };
  return fn(calls).finally(() => { globalThis.fetch = real; });
}
const res = (ok, body) => ({ ok, status: ok ? 200 : 400, text: async () => body });

test("sendDlt posts the filled text to 2Factor R1 as TRANS_SMS from MAIK with our entity id and the template id", () =>
  withFetch(() => res(true, '{"Status":"Success","Details":"sid-1"}'), async (calls) => {
    const r = await sendDlt(ENV, "9876543210", "otp", ["654321", "10"]);
    assert.deepEqual(r, { ok: true, providerId: "sid-1", status: 200, detail: null });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://2factor.in/API/R1/");
    assert.equal(calls[0].o.method, "POST");
    const f = new URLSearchParams(calls[0].o.body);
    assert.equal(f.get("module"), "TRANS_SMS"); assert.equal(f.get("apikey"), "k2f");
    assert.equal(f.get("to"), "919876543210", "country code added to a bare 10-digit number");
    assert.equal(f.get("from"), "MAIK"); assert.equal(f.get("ctid"), "1177178791267832947");
    assert.equal(DLT_PEID, "1101720950000098192", "MAIKNOWLEDGE LLP on Vilpower");
    assert.equal(f.get("peid"), DLT_PEID, "no entity id: the operator rejects the message");
    assert.equal(f.get("templatename"), "STEWARDMD_OTP");
    assert.deepEqual([f.get("var1"), f.get("var2"), f.get("var3")], ["654321", "10", null]);
    assert.equal(f.get("msg"), null, "2Factor fills its registered text; its own text matching refused a valid one");
  }));

test("sendDlt with no link sends the approved no-link twin; a missing clinic phone still sends nothing", () =>
  withFetch(() => res(true, '{"Status":"Success","Details":"sid-2"}'), async (calls) => {
    await sendDlt(ENV, "9876543210", "post_visit", ["Patient", "Rao", "Cardiology", "04023456789", ""]);
    const f = new URLSearchParams(calls[0].o.body);
    assert.equal(f.get("ctid"), "1177178791396071579"); assert.equal(f.get("templatename"), "POST_VISIT_PLAIN");
    assert.deepEqual([1, 2, 3, 4, 5].map((i) => f.get("var" + i)), ["Patient", "Rao", "Cardiology", "04023456789", null]);
    assert.deepEqual(await sendDlt(ENV, "9876543210", "post_visit", ["Patient", "Rao", "Cardiology", "", ""]), { ok: false, reason: "template_mismatch" });
    assert.deepEqual(await sendDlt(ENV, "9876543210", "otp", ["1", ""]), { ok: false, reason: "template_mismatch" }, "no twin: nothing");
    assert.equal(calls.length, 1);
  }));

test("sendDlt reports 2Factor's refusal, and never throws on a network failure", async () => {
  await withFetch(() => res(true, '{"Status":"Error","Details":"Invalid Template"}'), async () => {
    const r = await sendDlt(ENV, "9876543210", "otp", ["1", "10"]);
    assert.equal(r.ok, false); assert.match(r.detail, /Invalid Template/);
  });
  await withFetch(() => { throw new Error("down"); }, async () => {
    assert.deepEqual(await sendDlt(ENV, "9876543210", "otp", ["1", "10"]), { ok: false, reason: "exception" });
  });
});

test("sendDlt sends nothing when unconfigured, mis-filled or to a bad number", () =>
  withFetch(() => { throw new Error("must not be called"); }, async (calls) => {
    assert.equal(dltConfigured({ FOLLOWCARE_SMS_PROVIDER: "twofactor", TWOFACTOR_API_KEY: "k" }), false, "no sender header");
    assert.equal(dltConfigured({ FOLLOWCARE_SMS_PROVIDER: "msg91", TWOFACTOR_API_KEY: "k", TWOFACTOR_SENDER: "MAIK" }), false, "2Factor only");
    assert.equal(dltConfigured(ENV), true);
    assert.deepEqual(await sendDlt({}, "9876543210", "otp", ["1", "10"]), { ok: false, skipped: true, reason: "not_configured" });
    assert.deepEqual(await sendDlt(ENV, "9876543210", "otp", ["1"]), { ok: false, reason: "template_mismatch" });
    assert.deepEqual(await sendDlt(ENV, "12", "otp", ["1", "10"]), { ok: false, reason: "bad_number" });
    assert.equal(calls.length, 0);
  }));
