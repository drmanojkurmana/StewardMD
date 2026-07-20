/* test/experimental.test.mjs — Experimental Access framework.
 * Pure helpers (code gen / hashing / tokens / decision state machine) + the full activate→verify→
 * revoke lifecycle against an in-memory Firestore mock that honours the same atomic-commit +
 * precondition semantics as the real REST client. */
import * as X from "../functions/_experimental.js";
import * as FS from "../functions/_fbfirestore.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };

const ENV = { FIREBASE_PROJECT_ID: "test", EXPERIMENTAL_CODE_PEPPER: "pep-secret", EXPERIMENTAL_TOKEN_SECRET: "tok-secret" };

// In-memory Firestore honouring exists/updateTime preconditions + atomic multi-write commits.
function mockFs() {
  const store = new Map(); let clk = 0;
  const P = (name) => name.split("/documents/")[1];
  return {
    _store: store,
    async fsGet(env, path) { const d = store.get(path); return d ? { id: path.split("/").pop(), name: "x/documents/" + path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    async fsCommit(env, writes) {
      for (const w of writes) {                                   // check ALL preconditions first (atomic)
        if (w.update) {
          const p = P(w.update.name), cur = store.get(p), cd = w.currentDocument || {};
          if (cd.exists === false && cur) throw Object.assign(new Error("pre"), { code: "precondition" });
          if (cd.exists === true && !cur) throw Object.assign(new Error("pre"), { code: "precondition" });
          if (cd.updateTime && (!cur || cur.updateTime !== cd.updateTime)) throw Object.assign(new Error("pre"), { code: "precondition" });
        }
      }
      for (const w of writes) {                                   // then apply
        if (w.update) { const p = P(w.update.name), cur = store.get(p), inc = FS.decodeFields(w.update.fields); store.set(p, { fields: w.updateMask ? Object.assign({}, cur ? cur.fields : {}, inc) : inc, updateTime: "t" + (++clk) }); }
        else if (w.delete) store.delete(P(w.delete));
      }
      return { ok: true };
    },
    async fsQuery(env, coll, opts) {
      opts = opts || {}; const out = [];
      for (const [p, d] of store) { if (!p.startsWith(coll + "/")) continue; if (opts.where && opts.where.field && d.fields[opts.where.field] !== opts.where.value) continue; out.push({ id: p.split("/").pop(), name: "x/documents/" + p, fields: { ...d.fields }, updateTime: d.updateTime }); }
      return out;
    },
  };
}

async function main() {
  // ---------- pure: code generation ----------
  const c = X.makeCode("FUNDX");
  ok("code format PREFIX-XXXX-XXXX", /^FUNDX-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(c));
  ok("code excludes ambiguous chars I O L 0 1", !/[IOL01]/.test(c.replace("FUNDX", "")));
  const many = new Set(); for (let i = 0; i < 2000; i++) many.add(X.makeCode("FUNDX"));
  ok("codes are unique across 2000 draws", many.size >= 1999);

  // ---------- pure: normalize + hash ----------
  ok("normalize strips case/hyphens/spaces", X.normalizeCode(" fundx-8qk4-xm92 ") === "FUNDX8QK4XM92");
  const h1 = await X.hashCode("FUNDX-8QK4-XM92", "pep"), h2 = await X.hashCode("fundx8qk4xm92", "pep");
  ok("hash is deterministic + case/hyphen-insensitive", h1 === h2 && /^[0-9a-f]{64}$/.test(h1));
  ok("hash depends on the pepper", (await X.hashCode("FUNDX-8QK4-XM92", "other")) !== h1);

  // ---------- pure: tokens ----------
  const tok = await X.signToken({ f: "fundx", u: "u1", d: "dev1", a: "act1", t: 1 }, "sec");
  ok("token round-trips", (await X.verifyToken(tok, "sec")).u === "u1");
  ok("token rejects a wrong secret", (await X.verifyToken(tok, "nope")) === null);
  ok("token rejects a tampered mac", (await X.verifyToken(tok.slice(0, -2) + (tok.slice(-1) === "A" ? "B" : "A"), "sec")) === null);
  ok("token rejects a tampered body", (await X.verifyToken("x" + tok, "sec")) === null);

  // ---------- pure: effectiveStatus ----------
  const now = 1000;
  ok("unused (no expiry) → unused", X.effectiveStatus({ status: "unused" }, now) === "unused");
  ok("unused past expiry → expired", X.effectiveStatus({ status: "unused", expiry: 500 }, now) === "expired");
  ok("unused future expiry → unused", X.effectiveStatus({ status: "unused", expiry: 5000 }, now) === "unused");
  ok("activated → activated", X.effectiveStatus({ status: "activated" }, now) === "activated");
  ok("revoked → revoked", X.effectiveStatus({ status: "revoked" }, now) === "revoked");

  // ---------- pure: decideActivation state machine ----------
  const base = { feature: "fundx", status: "unused" };
  ok("missing code → reject invalid", X.decideActivation(null, { feature: "fundx", uid: "u", deviceId: "d" }, now).error === "invalid");
  ok("feature mismatch → reject invalid", X.decideActivation({ feature: "ecg", status: "unused" }, { feature: "fundx", uid: "u", deviceId: "d" }, now).error === "invalid");
  ok("expired → reject expired", X.decideActivation({ feature: "fundx", status: "unused", expiry: 1 }, { feature: "fundx", uid: "u", deviceId: "d" }, now).error === "expired");
  ok("revoked → reject invalid", X.decideActivation({ feature: "fundx", status: "revoked" }, { feature: "fundx", uid: "u", deviceId: "d" }, now).error === "invalid");
  ok("unused → activate", X.decideActivation(base, { feature: "fundx", uid: "u", deviceId: "d" }, now).action === "activate");
  const act = { feature: "fundx", status: "activated", activatedByUID: "u1", activatedDeviceId: "d1" };
  ok("activated same uid+device → reissue", X.decideActivation(act, { feature: "fundx", uid: "u1", deviceId: "d1" }, now).action === "reissue");
  ok("activated other device → already_used", X.decideActivation(act, { feature: "fundx", uid: "u1", deviceId: "d2" }, now).error === "already_used");
  ok("activated other uid → already_used", X.decideActivation(act, { feature: "fundx", uid: "u2", deviceId: "d1" }, now).error === "already_used");

  // ---------- pure: user messages (exact spec strings) ----------
  ok("message already_used", X.messageFor("already_used") === "This code has already been used.");
  ok("message invalid", X.messageFor("invalid") === "Invalid or expired code.");
  ok("message expired", X.messageFor("expired") === "Invalid or expired code.");

  // ---------- lifecycle: generate → activate → single-use → binding → idempotent ----------
  const fs = mockFs();
  const gen = await X.generateCode(ENV, { feature: "fundx", expiry: null, notes: "tester A" }, fs);
  ok("generate returns plaintext once + hash id", /^FUNDX-/.test(gen.code) && gen.id.length === 12);
  ok("generate stored ONLY the hash (no plaintext in store)", [...fs._store.values()].every((d) => JSON.stringify(d.fields).indexOf(gen.code) === -1));

  const a1 = await X.activate(ENV, { feature: "fundx", code: gen.code, uid: "u1", deviceId: "dev1", deviceModel: "iPhone 17 Pro", platform: "ios" }, fs);
  ok("activate (unused) succeeds + returns a token", a1.ok === true && !!a1.token);

  const other = await X.activate(ENV, { feature: "fundx", code: gen.code, uid: "u2", deviceId: "dev2", platform: "android" }, fs);
  ok("SAME code on another device → already_used", other.ok === false && other.error === "already_used");

  const again = await X.activate(ENV, { feature: "fundx", code: gen.code, uid: "u1", deviceId: "dev1", platform: "ios" }, fs);
  ok("SAME code on the SAME device → idempotent success (reused)", again.ok === true && again.reused === true && !!again.token);

  // ---------- verify + statusFor ----------
  const v1 = await X.verify(ENV, { feature: "fundx", deviceId: "dev1", token: a1.token, uid: "u1" }, fs);
  ok("verify a valid token → active", v1.active === true);
  const vDev = await X.verify(ENV, { feature: "fundx", deviceId: "devX", token: a1.token, uid: "u1" }, fs);
  ok("verify with a different deviceId → inactive", vDev.active === false && vDev.reason === "device_mismatch");
  const st = await X.statusFor(ENV, { feature: "fundx", uid: "u1", deviceId: "dev1" }, fs);
  ok("status restores an active binding + fresh token (reinstall recovery)", st.active === true && !!st.token);
  const stOther = await X.statusFor(ENV, { feature: "fundx", uid: "u1", deviceId: "devZ" }, fs);
  ok("status for a different device → inactive", stOther.active === false);

  // ---------- revoke (deactivate device) — code stays consumed ----------
  const rev = await X.revokeActivation(ENV, { activationId: a1.activationId }, fs);
  ok("revokeActivation ok", rev.ok === true);
  const v2 = await X.verify(ENV, { feature: "fundx", deviceId: "dev1", token: a1.token, uid: "u1" }, fs);
  ok("after revoke → token verifies INACTIVE (device deactivated)", v2.active === false && v2.reason === "revoked");
  const reuse = await X.activate(ENV, { feature: "fundx", code: gen.code, uid: "u1", deviceId: "devNew", platform: "ios" }, fs);
  ok("revoked code can NEVER be reused (stays consumed)", reuse.ok === false && reuse.error === "invalid");

  // ---------- admin lists / analytics / delete-expired ----------
  const codes = await X.listCodes(ENV, { feature: "fundx" }, fs);
  ok("listCodes shows the revoked code + full+short id, no plaintext", codes.length === 1 && codes[0].status === "revoked" && codes[0].id.length === 64 && codes[0].short.length === 12);
  const acts = await X.listActivations(ENV, { feature: "fundx" }, fs);
  ok("listActivations shows the revoked device", acts.length === 1 && acts[0].status === "revoked" && acts[0].deviceModel === "iPhone 17 Pro");

  const gen2 = await X.generateCode(ENV, { feature: "fundx", expiry: 1, notes: "will expire" }, fs);   // expiry in the past
  const an = await X.analytics(ENV, { feature: "fundx" }, fs);
  ok("analytics counts revoked + expired", an.total === 2 && an.byStatus.revoked === 1 && an.byStatus.expired === 1 && an.revokedDevices === 1);
  const del = await X.deleteExpired(ENV, { feature: "fundx" }, fs);
  ok("deleteExpired removes ONLY the expired unused code", del.removed === 1 && (await X.listCodes(ENV, { feature: "fundx" }, fs)).length === 1);

  // ---------- guard: activation requires sign-in + a device ----------
  const noUid = await X.activate(ENV, { feature: "fundx", code: gen2.code, deviceId: "d" }, fs);
  ok("activate without a uid → signin_required", noUid.ok === false && noUid.error === "signin_required");
  const noDev = await X.activate(ENV, { feature: "fundx", code: gen2.code, uid: "u1" }, fs);
  ok("activate without a deviceId → no_device", noDev.ok === false && noDev.error === "no_device");

  // ---- checkActive (the SERVER-SIDE compute gate for /api/fundx) ----
  const g3 = await X.generateCode(ENV, { feature: "fundx", expiry: null, notes: "compute gate" }, fs);
  const a3 = await X.activate(ENV, { feature: "fundx", code: g3.code, uid: "u3", deviceId: "dev3", platform: "ios" }, fs);
  ok("checkActive: valid token → active", (await X.checkActive(ENV, "fundx", a3.token, fs)).active === true);
  ok("checkActive: garbage/forged token → inactive", (await X.checkActive(ENV, "fundx", "abc.def", fs)).active === false && (await X.checkActive(ENV, "fundx", "", fs)).active === false);
  ok("checkActive: token for a different feature → inactive", (await X.checkActive(ENV, "ecg", a3.token, fs)).active === false);
  await X.revokeActivation(ENV, { activationId: a3.activationId }, fs);
  ok("checkActive: after revoke → inactive (compute locked immediately)", (await X.checkActive(ENV, "fundx", a3.token, fs)).active === false);

  console.log(`\nexperimental: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
