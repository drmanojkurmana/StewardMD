/* test/sms-dlt.test.mjs - SMS goes out only as our approved DLT templates (Vodafone Idea DLT, header MAIK).
 *
 * The operator drops an SMS whose text does not match its registered template, so what these defend:
 *   - each template text is the approved text verbatim, every slot filled in order,
 *   - a wrong slot count or a blank slot sends nothing (never a half-filled message),
 *   - the request is 2Factor's R1 Transactional-SMS API with the content-template id.
 *
 * node --test test/sms-dlt.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DLT, dltText, dltConfigured, sendDlt } from "../functions/_followcare_sms.js";

test("the template texts are the approved DLT texts, verbatim, with their content-template ids", () => {
  // Copied from the DLT portal export (ContentTemplates.csv, 2026-09-27). A change here must be a new approval.
  assert.deepEqual(DLT.otp, { ctid: "1177178791267832947", text: "Your OTP for login to StewardMD is {#num#}. Valid for {#num#} minutes. Do not share this OTP with anyone. -StewardMD" });
  assert.deepEqual(DLT.appt_confirm, { ctid: "1177178791454063563", text: "Dear {#alp#}, your appointment with Dr. {#alp#} at {#alp#} is confirmed for {#alp#} at {#alp#}. View details: {#uro#} -StewardMD" });
  assert.deepEqual(DLT.checkin_alert, { ctid: "1177178791462158338", text: "Dear {#alp#}, reminder: your appointment with Dr. {#alp#} at {#alp#} is today at {#alp#}. Please check-in at reception 10 mins prior. Details: {#uro#} -StewardMD" });
});

test("Care Plan - Detailed: verbatim, and its callback slot is filled like any other", () => {
  assert.deepEqual(DLT.care_plan, { ctid: "1177178791481113659", text: "Dear {#alp#}, please continue your prescribed care plan from Dr. {#alp#} at {#alp#}. For any questions, contact us at {#cbn#}. Details: {#uro#} -StewardMD" });
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

test("sendDlt posts the filled text to 2Factor R1 as TRANS_SMS from MAIK with the template id", () =>
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
    assert.equal(f.get("msg"), "Your OTP for login to StewardMD is 654321. Valid for 10 minutes. Do not share this OTP with anyone. -StewardMD");
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
