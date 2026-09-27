/* test/followcare-sms-dlt.test.mjs - FollowCare SMS goes out only as our approved DLT templates.
 *
 * FollowCare has no doctor name, clinic or clinic phone of its own, and every FollowCare DLT text needs them:
 * the doctor comes from their profile (or the Action Center's doctor), the clinic and its call-back phone from
 * the OPD clinic the episode's hospital ID names. What these defend:
 *   - check-ins, reminders and doctor nudges go as Post-Visit Check-in, medicine reminders as Care Plan,
 *   - no link sends the approved no-link twin (the voice recap),
 *   - a clinic that cannot be resolved sends NOTHING (no half-filled text) and the delivery log says why,
 *   - a minor's message goes to the guardian, and no patient name is ever in it.
 *
 * node --experimental-test-module-mocks --test test/followcare-sms-dlt.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const ORGS = { org1: { id: "org1", name: "Sunrise Clinic", phone: "04023456789" } };
const deliveries = [];
mock.module("../functions/_opd_org_store.js", { namedExports: {
  resolveOrgId: async (_env, x) => (x === "SMD-ABC123" ? "org1" : String(x || "")),
  getOrg: async (_env, id) => ORGS[id] || null,
  listOrgsForOwner: async (_env, uid) => ({ u1: [ORGS.org1], u2: [ORGS.org1, { id: "org2", name: "Other", phone: "04011112222" }] })[uid] || [],
} });
mock.module("../functions/_pglog_enrol.js", { namedExports: { profileName: async (_env, uid) => (uid === "u1" ? "Dr. Rao" : "") } });
mock.module("../functions/_followcare.js", { namedExports: {
  getEpisode: async () => null, eraseEpisode: async () => {}, audit: async () => {},
  linkFor: async () => "https://stewardmd.in/followcare?t=tok",
  decPHI: async (_env, enc) => ({ P: "919876543210", G: "919812345678" })[enc] || "",
  recordDelivery: async (_env, d) => { deliveries.push(d); },
} });
mock.module("../functions/_fbfirestore.js", { namedExports: { fsQuery: async () => [], wUpdate: () => ({}), fsCommit: async () => {} } });

const { sendPatientMessage, sendCheckinLink } = await import("../functions/_followcare_dispatch.js");
const { DLT, dltText } = await import("../functions/_followcare_sms.js");
// The text the patient receives: 2Factor fills its registered template (same text as DLT) with var1..varN.
function msgOf(f) {
  const key = Object.keys(DLT).find((k) => DLT[k].tpl === f.get("templatename"));
  const vars = []; for (let i = 1; f.get("var" + i) != null; i++) vars.push(f.get("var" + i));
  assert.ok(key, "a registered 2Factor template"); assert.equal(f.get("ctid"), DLT[key].ctid, "name and DLT id agree");
  return dltText(key, vars);
}

const ENV = { FOLLOWCARE_SMS_PROVIDER: "twofactor", TWOFACTOR_API_KEY: "k2f", TWOFACTOR_SENDER: "MAIK" };
const EP = { episodeId: "e1", hospitalId: "SMD-ABC123", doctorUid: "u1", lang: "en", _phi: { phoneEnc: "P", guardianEnc: "G" } };
function withFetch(fn) {
  const real = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, o) => { calls.push({ url: String(url), f: new URLSearchParams(o.body) }); return { ok: true, status: 200, text: async () => '{"Status":"Success","Details":"sid"}' }; };
  deliveries.length = 0;
  return fn(calls).finally(() => { globalThis.fetch = real; });
}

test("a check-in link goes as Post-Visit Check-in - Detailed: profile doctor, OPD clinic and its phone, the link", () =>
  withFetch(async (calls) => {
    const r = await sendCheckinLink(ENV, EP, "send");
    assert.equal(r.ok, true);
    assert.equal(calls.length, 1);
    const f = calls[0].f;
    assert.equal(calls[0].url, "https://2factor.in/API/R1/");
    assert.equal(f.get("ctid"), "1177178791495757255"); assert.equal(f.get("peid"), "1101720950000098192"); assert.equal(f.get("from"), "MAIK");
    assert.equal(f.get("to"), "919876543210");
    assert.equal(msgOf(f), "Dear Patient, we hope you're recovering well after your visit with Dr. Rao at Sunrise Clinic. If symptoms worsen, please contact us at 04023456789. Details: https://stewardmd.in/followcare?t=tok -StewardMD");
    assert.equal(deliveries[0].status, "sent"); assert.equal(deliveries[0].channel, "sms");
  }));

test("a medicine reminder goes as Care Plan; the Action Center's doctor name wins over the profile", () =>
  withFetch(async (calls) => {
    await sendCheckinLink(ENV, EP, "reminder_med");
    assert.equal(calls[0].f.get("ctid"), "1177178791481113659");
    await sendPatientMessage(ENV, EP, "ignored body", { link: "https://stewardmd.in/followcare?t=x", doctorName: "Dr Mehta" });
    assert.match(msgOf(calls[1].f), /visit with Dr\. Mehta at Sunrise Clinic\./);
  }));

test("no link (the voice recap) sends the approved no-link twin", () =>
  withFetch(async (calls) => {
    await sendPatientMessage(ENV, EP, "recap", { dltKey: "care_plan" });
    assert.equal(calls[0].f.get("ctid"), "1177178791389160530");
    assert.equal(msgOf(calls[0].f), "Dear Patient, please continue your prescribed care plan from Dr. Rao at Sunrise Clinic. For any questions, contact us at 04023456789. -StewardMD");
  }));

test("a free-text hospital ID falls back to the one OPD clinic the doctor owns", () =>
  withFetch(async (calls) => {
    await sendPatientMessage(ENV, { ...EP, hospitalId: "GIMSR" }, "body", { link: "L" });
    assert.match(msgOf(calls[0].f), /at Sunrise Clinic\. If symptoms worsen, please contact us at 04023456789\./);
  }));

test("no clinic to name (none, or a doctor with several) sends nothing, and the delivery log says why", () =>
  withFetch(async (calls) => {
    for (const doctorUid of ["nobody", "u2"]) {
      const r = await sendPatientMessage(ENV, { ...EP, hospitalId: "GIMSR", doctorUid }, "body", { link: "L", doctorName: "Rao" });
      assert.deepEqual(r, { ok: false, reason: "template_mismatch" }, doctorUid);
    }
    assert.equal(calls.length, 0);
    assert.equal(deliveries[0].status, "failed"); assert.equal(deliveries[0].error, "template_mismatch");
  }));

test("a minor's message goes to the guardian; no patient name in any text", () =>
  withFetch(async (calls) => {
    await sendPatientMessage(ENV, { ...EP, isMinor: true }, "body", { link: "L" });
    assert.equal(calls[0].f.get("to"), "919812345678");
    assert.match(msgOf(calls[0].f), /^Dear Patient, /);
  }));

test("other SMS providers keep the old path (no DLT request)", () =>
  withFetch(async (calls) => {
    const r = await sendPatientMessage({ FOLLOWCARE_SMS_PROVIDER: "" }, EP, "body", { link: "L" });
    assert.equal(r.skipped, true);
    assert.equal(calls.length, 0);
  }));
