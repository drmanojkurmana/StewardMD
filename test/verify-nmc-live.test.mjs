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
function router({ byReg, byName, nmcDown }) {
  const calls = [];
  const f = async (url) => {
    url = String(url); calls.push(url);
    if (url.indexOf("generativelanguage") >= 0) return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(CERT) }] } }] }) };
    if (url.indexOf("nmc.org.in/indian-medical-register/search") >= 0) {
      if (nmcDown) return { ok: false, status: 404, json: async () => { throw new Error("html"); } };
      const u = new URL(url), type = u.searchParams.get("search_type");
      const data = type === "reg_no" ? byReg : byName;
      return { ok: true, status: 200, json: async () => ({ success: true, data, pagination: { total: data.length, count: data.length } }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  f.calls = calls;
  return f;
}
async function upload(store, uid, f) {
  const real = globalThis.fetch; globalThis.fetch = f;
  try {
    const req = new Request("https://x/api/verify-doctor", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" },
      body: JSON.stringify({ idToken: "tok-" + uid, image: "aGVsbG8=", mime: "image/jpeg", role: "doctor" }) });
    const r = await verifyDoctor.onRequest({ request: req, env: env(store) });
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

test("two doctors with her exact name: manual review, not a guess", async () => {
  CLAIMS.clear(); const store = memKV();
  const twin = { ...SRAVANI, registration_no: "DMC/R/55555", state_medical_council: "Delhi Medical Council" };
  const r = await upload(store, "twin", router({ byReg: REG_100286, byName: [SRAVANI, twin] }));
  assert.equal(r.status, "pending_review");
  assert.notEqual((CLAIMS.get("twin") || {}).verified, true);
});

test("the name fallback can be switched off (env VERIFY_NAME_FALLBACK=0)", async () => {
  CLAIMS.clear(); const store = memKV();
  const real = globalThis.fetch; globalThis.fetch = router({ byReg: REG_100286, byName: [SRAVANI] });
  try {
    const req = new Request("https://x/api/verify-doctor", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "tok-off", image: "aGVsbG8=", mime: "image/jpeg", role: "doctor" }) });
    const r = await (await verifyDoctor.onRequest({ request: req, env: { ...env(store), VERIFY_NAME_FALLBACK: "0" } })).json();
    assert.equal(r.status, "pending_review");
  } finally { globalThis.fetch = real; }
});

test("register down and no offline copy: manual review, says why", async () => {
  CLAIMS.clear(); const store = memKV();
  const r = await upload(store, "down", router({ nmcDown: true }));
  assert.equal(r.status, "pending_review"); assert.equal(r.reason, "nmc_unreachable");
});
