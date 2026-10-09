/* test/verify-nmc-live.test.mjs - doctor verification against NMC's NEW register search.
 *
 * Owner, 2026-10-08: Dr S N Sravani Yarrarapu uploaded a Delhi Medical Council certificate (reg 100286,
 * reading confidence 0.95) and was sent to manual review ("no_offline_match"), with no free week shown.
 * Two causes, both covered here through the real /api/verify-doctor route:
 *   1. nmc.org.in was rebuilt. The old POST MCIRest/open/getDataFromService API answers 301 -> 404, so
 *      every live lookup "failed" and fell to the offline mirror. The new API is
 *      GET /indian-medical-register/search?search_type=reg_no|name (functions/api/_nmc.js nmcQuery).
 *   2. Her Delhi number is not on the national register under that number; her NAME is, exactly once
 *      (APMC/FMR/110431). strictNameMatch accepts exactly one row with the same full name.
 * Firebase admin, email and the certificate reader are mocked; the KV is in memory.
 * node --test --experimental-test-module-mocks test/verify-nmc-live.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const CLAIMS = new Map();
const realAdmin = await import("../functions/_fbadmin.js");
const realAuth = await import("../functions/_fbauth.js");
const realEmail = await import("../functions/_email.js");
mock.module("../functions/_fbadmin.js", { namedExports: { ...realAdmin,
  getUserClaims: async (env, uid) => ({ ...(CLAIMS.get(uid) || {}) }),
  mergeUserClaims: async (env, uid, patch) => {
    const c = { ...(CLAIMS.get(uid) || {}) };
    for (const k of Object.keys(patch)) { if (patch[k] === null) delete c[k]; else c[k] = patch[k]; }
    CLAIMS.set(uid, c);
  },
  setUserClaims: async (env, uid, c) => { CLAIMS.set(uid, { ...c }); },
  lookupUidByEmail: async () => null, setUserPassword: async () => {}, serviceAccountToken: async () => "",
  getUserRecord: async () => null, setUserDisabled: async () => {}, deleteUser: async () => {},
  lookupUserByUid: async () => null, summarizeUser: (u) => u,
} });
mock.module("../functions/_fbauth.js", { namedExports: { ...realAuth,
  verifyFirebaseToken: async (tok) => (String(tok).startsWith("tok-") ? String(tok).slice(4) : null),
  verifiedClaimsFor: async () => null,
} });
mock.module("../functions/_email.js", { namedExports: { ...realEmail,
  emailVerified: async () => {}, emailFailed: async () => {}, emailOtp: async () => {}, emailResetCode: async () => {},
  emailTempPassword: async () => {}, emailProConfirmation: async () => {},
} });

const { fromNmcRow, nmcQuery } = await import("../functions/api/_nmc.js");
const { strictNameMatch, nameSame, pickMatch } = await import("../functions/_verify_match.js");
const verifyDoctor = await import("../functions/api/verify-doctor.js");

function memKV() {
  const m = new Map();
  return { _m: m,
    async get(k, t) { const v = m.get(k); if (v == null) return null; return t === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; } };
}
const env = (store) => ({ CASES_KV: store, MAIK_KV: store, GEMINI_API_KEY: "g", FIREBASE_SERVICE_ACCOUNT: "{}", TRIAL_ONCE_ON: "0" });

// Real rows as the new API returned them for reg_no=100286 (2026-10-08): none of them is Dr Sravani.
const REG_100286 = [
  { registration_no: "100286", name: "K.SHONIT NAGUMANTRY", state_medical_council: "Karnataka Medical Council", year_of_info: 2013, removed_status: null },
  { registration_no: "100286", name: "Thamizh Vani, Dhandapani", state_medical_council: "Tamil Nadu Medical Council", year_of_info: 2013, removed_status: null },
  { registration_no: "APMC/FMR/100286", name: "UPPALA KAVYA", state_medical_council: "Andhra Pradesh Medical Council", year_of_info: 2017, removed_status: null },
];
const SRAVANI = { registration_no: "APMC/FMR/110431", name: "SIVA NAGA SRAVANI YARRARAPU", state_medical_council: "Andhra Pradesh Medical Council", year_of_info: 2020, removed_status: null };
const CERT = { registration_number: "100286", full_name: "Dr.SIVA NAGA SRAVANI YARRARAPU", state_medical_council: "Delhi Medical Council", year: "2021", looks_valid: true, confidence: 0.95 };

/* One fetch for everything the route calls: the certificate reader and the register. */
function router({ byReg, byName, nmcDown, cert }) {
  const calls = [], mails = [];
  const f = async (url, opts) => {
    url = String(url); calls.push(url);
    if (url.indexOf("api.resend.com") >= 0) { mails.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({}), text: async () => "" }; }
    if (url.indexOf("generativelanguage") >= 0) return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(cert || CERT) }] } }] }) };
    if (url.indexOf("nmc.org.in/indian-medical-register/search") >= 0) {
      if (nmcDown) return { ok: false, status: 404, json: async () => { throw new Error("html"); } };
      const u = new URL(url), type = u.searchParams.get("search_type");
      const data = type === "reg_no" ? byReg : byName;
      return { ok: true, status: 200, json: async () => ({ success: true, data, pagination: { total: data.length, count: data.length } }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  f.calls = calls; f.mails = mails;
  return f;
}
async function upload(store, uid, f, role, extraEnv) {
  const real = globalThis.fetch; globalThis.fetch = f;
  try {
    const req = new Request("https://x/api/verify-doctor", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" },
      body: JSON.stringify({ idToken: "tok-" + uid, image: "aGVsbG8=", mime: "image/jpeg", role: role || "doctor" }) });
    const r = await verifyDoctor.onRequest({ request: req, env: { ...env(store), RESEND_API_KEY: "re", VERIFY_ADMIN_TOKEN: "adm", ...(extraEnv || {}) } });
    return r.json();
  } finally { globalThis.fetch = real; }
}

test("the new register API is asked with GET search_type=reg_no and its rows are mapped", async () => {
  const f = router({ byReg: REG_100286, byName: [] });
  const rows = await nmcQuery({ regNo: "100286" }, f);
  assert.equal(rows.length, 3);
  assert.deepEqual([rows[0].registrationNo, rows[0].firstName, rows[0].smcName], ["100286", "K.SHONIT NAGUMANTRY", "Karnataka Medical Council"]);
  const u = new URL(f.calls[0]);
  assert.equal(u.origin + u.pathname, "https://nmc.org.in/indian-medical-register/search");
  assert.equal(u.searchParams.get("search_type"), "reg_no"); assert.equal(u.searchParams.get("reg_no"), "100286");
  await assert.rejects(() => nmcQuery({ regNo: "1" }, router({ nmcDown: true })), "a 404 is 'down', not 'empty'");
});

test("a struck-off doctor never matches", () => {
  const r = fromNmcRow({ registration_no: "12345", name: "ASHA RAO", state_medical_council: "KMC", removed_status: "Removed" });
  assert.equal(r.removed, true);
  assert.equal(pickMatch([r], "12345", "ASHA RAO", "KMC"), null);
  assert.equal(strictNameMatch([r], "ASHA RAO KUMARI"), null);
  assert.equal(fromNmcRow({ registration_no: "1", name: "A B", removed_status: null }).removed, false);
});

test("strict name rule: the same full name, exactly one row, enough words", () => {
  const R = [fromNmcRow(SRAVANI)];
  assert.ok(nameSame("Dr.SIVA NAGA SRAVANI YARRARAPU", "SIVA NAGA SRAVANI YARRARAPU"));
  assert.ok(nameSame("YARRARAPU SIVA NAGA SRAVANI", "SIVA NAGA SRAVANI YARRARAPU"), "word order does not matter");
  assert.equal(strictNameMatch(R, "Dr.SIVA NAGA SRAVANI YARRARAPU").registrationNo, "APMC/FMR/110431");
  assert.equal(strictNameMatch(R, "SRAVANI YARRARAPU"), null, "a partial name is not the same name");
  assert.equal(strictNameMatch(R, "S N SRAVANI YARRARAPU"), null, "initials are not enough here");
  assert.equal(strictNameMatch(R.concat(R), "SIVA NAGA SRAVANI YARRARAPU"), null, "two namesakes: a human decides");
  assert.equal(strictNameMatch([fromNmcRow({ registration_no: "9", name: "RAM SHAH" })], "RAM SHAH"), null, "two short words are too common");
});

test("Dr Sravani's certificate is verified automatically through the name on the register", async () => {
  CLAIMS.clear(); const store = memKV();
  const r = await upload(store, "sravani", router({ byReg: REG_100286, byName: [SRAVANI] }));
  assert.equal(r.status, "verified", JSON.stringify(r));
  assert.equal(r.regNo, "APMC/FMR/110431", "the register's number is the one recorded");
  assert.equal(CLAIMS.get("sravani").verified, true);
});

const mailTo = (f) => f.mails.map((m) => m.subject + " | " + (m.html || "")).join("\n");

test("test 1 (number + name on the register): verified, no email to the owner", async () => {
  CLAIMS.clear(); const store = memKV();
  const mine = { registration_no: "100286", name: "SIVA NAGA SRAVANI YARRARAPU", state_medical_council: "Delhi Medical Council" };
  const f = router({ byReg: REG_100286.concat(mine), byName: [] });
  const r = await upload(store, "num", f);
  assert.equal(r.status, "verified"); assert.equal(r.regNo, "100286");
  assert.equal(f.mails.length, 0, "a clean register match needs no check");
});

test("test 2 with namesakes: still verified, and the owner is emailed a Revoke link", async () => {
  CLAIMS.clear(); const store = memKV();
  const twin = { ...SRAVANI, registration_no: "DMC/R/55555", state_medical_council: "Delhi Medical Council" };
  const f = router({ byReg: REG_100286, byName: [SRAVANI, twin] });
  const r = await upload(store, "twin", f);
  assert.equal(r.status, "verified");
  assert.equal(r.regNo, "DMC/R/55555", "the namesake from the council printed on the certificate");
  assert.match(mailTo(f), /Auto-verified, please check/); assert.match(mailTo(f), /2 doctors on the register carry this exact name/);
  assert.match(mailTo(f), /do=reject/, "one-click revoke");
});

test("test 3 (the certificate reading alone, confidence above 0.7): verified, owner emailed", async () => {
  CLAIMS.clear(); const store = memKV();
  const f = router({ byReg: REG_100286, byName: [] });
  const r = await upload(store, "doc", f);
  assert.equal(r.status, "verified"); assert.equal(r.regNo, "100286");
  assert.equal(CLAIMS.get("doc").verified, true);
  assert.match(mailTo(f), /accepted on the certificate reading alone \(confidence 0\.95\)/);
});

test("confidence 0.7 is not above 0.7: manual review", async () => {
  CLAIMS.clear(); const store = memKV();
  const r = await upload(store, "edge", router({ byReg: REG_100286, byName: [], cert: { ...CERT, confidence: 0.7 } }));
  assert.equal(r.status, "pending_review");
});

test("register down: the certificate reading still verifies a clear certificate", async () => {
  CLAIMS.clear(); const store = memKV();
  const r = await upload(store, "down", router({ nmcDown: true }));
  assert.equal(r.status, "verified");
  const low = await upload(memKV(), "down2", router({ nmcDown: true, cert: { ...CERT, confidence: 0.6 } }));
  assert.equal(low.status, "pending_review", "an unclear one still goes to a person");
});

test("one account per registration number on every path", async () => {
  CLAIMS.clear(); const store = memKV();
  assert.equal((await upload(store, "first", router({ byReg: REG_100286, byName: [] }))).status, "verified");
  const second = await upload(store, "second", router({ byReg: REG_100286, byName: [] }));
  assert.equal(second.status, "rejected"); assert.equal(second.reason, "registration_already_claimed");
  assert.notEqual((CLAIMS.get("second") || {}).verified, true);
});

test("revoking a duplicate gives the number back for the real doctor", async () => {
  CLAIMS.clear(); const store = memKV();
  await upload(store, "fake", router({ byReg: REG_100286, byName: [] }));
  const { doReject } = await import("../functions/api/verifications/[[path]].js");
  await doReject(store, env(store), "fake");
  assert.equal(CLAIMS.get("fake").verified, false);
  assert.equal((await upload(store, "real", router({ byReg: REG_100286, byName: [] }))).status, "verified");
});

test("a clearly read student ID is accepted as a reviewed trainee, never a prescriber", async () => {
  CLAIMS.clear(); const store = memKV();
  const f = router({ cert: { full_name: "Asha Rao", institution: "Andhra Medical College", course: "MBBS", looks_valid: true, confidence: 0.9 } });
  const r = await upload(store, "stu", f, "student");
  assert.equal(r.status, "trainee_verified");
  assert.equal(CLAIMS.get("stu").traineeVerified, true); assert.notEqual(CLAIMS.get("stu").verified, true);
  assert.match(mailTo(f), /Auto-verified, please check/);
  const blurry = await upload(memKV(), "stu2", router({ cert: { full_name: "Asha Rao", looks_valid: true, confidence: 0.5 } }), "student");
  assert.equal(blurry.status, "pending_review");
});

test("all three switched off (VERIFY_NAME_FALLBACK=0, VERIFY_DOC_ACCEPT=0): manual review", async () => {
  CLAIMS.clear(); const store = memKV();
  const r = await upload(store, "off", router({ byReg: REG_100286, byName: [SRAVANI] }), "doctor", { VERIFY_NAME_FALLBACK: "0", VERIFY_DOC_ACCEPT: "0" });
  assert.equal(r.status, "pending_review");
});
