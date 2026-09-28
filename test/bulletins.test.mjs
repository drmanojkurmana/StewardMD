/* Clinical Bulletins: physician-signed practice updates on the disease reader.
 *
 * Proves the safety rules in docs/CLINICAL_AUTO_UPDATE_ENGINEERING_SPEC.md against a real SQLite behind a
 * D1-shaped shim, through the real route (functions/api/updates/[[path]].js). What must hold: only a
 * registered signer with a live verified-doctor claim can sign; the admin token can never sign; identity
 * comes from the registry, not the request; a signature covers one exact text against one exact source;
 * any edit, source change, due review, deletion or kill switch takes the bulletin off the bedside.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/bulletins.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) {}
const SKIP = DatabaseSync ? false : "node:sqlite unavailable";

const OWNER = "drmanojkurmana@gmail.com";
const CLAIMS = {
  "tok-owner-doc": { sub: "u-owner", email: OWNER, email_verified: true, verified: true, regNo: "APMC-1" },
  "tok-owner-nodoc": { sub: "u-owner2", email: "kdiwakar45@gmail.com", email_verified: true },
  "tok-doc2": { sub: "u-doc2", email: "doc2@example.com", email_verified: true, verified: true },
  "tok-doc3": { sub: "u-doc3", email: "doc3@example.com", email_verified: true, verified: true },
  "tok-unverified": { sub: "u-unv", email: "unv@example.com", email_verified: true },
  "tok-trainee": { sub: "u-tr", email: "tr@example.com", email_verified: true, traineeVerified: true },
};
const ADMIN_CLAIMS = { "u-owner": { verified: true }, "u-doc2": { verified: true }, "u-doc3": { verified: true }, "u-unv": {} };
const UID_BY_EMAIL = { "doc2@example.com": "u-doc2", "unv@example.com": "u-unv" };

const realAuth = await import("../functions/_fbauth.js");
const realAdmin = await import("../functions/_fbadmin.js");
mock.module("../functions/_fbauth.js", {
  namedExports: {
    ...realAuth,
    verifiedClaimsFor: async (request) => {
      const tok = ((request.headers && request.headers.get("Authorization")) || "").replace(/^Bearer\s+/i, "");
      return CLAIMS[tok] || null;
    },
  },
});
mock.module("../functions/_fbadmin.js", {
  namedExports: {
    ...realAdmin,
    getUserClaims: async (_e, uid) => ADMIN_CLAIMS[uid] || {},
    // Same shape as the real helper: an object, not a bare uid (test/tenant-provision.test.mjs guards callers).
    lookupUidByEmail: async (_e, email) => (UID_BY_EMAIL[email] ? { uid: UID_BY_EMAIL[email], email, name: "" } : null),
  },
});

const { onRequest } = await import("../functions/api/updates/[[path]].js");
const rules = await import("../functions/_bulletin_rules.js");
const updatesRepo = await import("../functions/_updates_repo.js");
const { KB_DISEASE_IDS } = await import("../functions/_kb_disease_ids.js");
const { loadDiseaseIds } = await import("../kb/tools/build-disease-ids.mjs");
const { BULLETIN_DDL } = await import("../functions/_bulletins_schema.js");

const SCHEMA = readFileSync(new URL("../functions/db/updates_schema.sql", import.meta.url), "utf8");
const MIGRATION = readFileSync(new URL("../functions/db/migrate_bulletins.sql", import.meta.url), "utf8");

function d1(sqlite) {
  const db = sqlite || new DatabaseSync(":memory:");
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } }; },
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    _exec: () => db.prepare(sql).run(...args),
  });
  return {
    _db: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => { db.exec("BEGIN"); try { list.forEach((s) => s._exec()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; },
  };
}

function kvWith(entries) {
  const m = new Map(Object.entries(entries || {}).map(([k, v]) => [k, JSON.stringify(v)]));
  return { get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); } };
}

async function fresh(opts) {
  const D = d1();
  D._db.exec(SCHEMA);
  const env = Object.assign({
    UPDATES_DB: D, UPDATES_ADMIN_TOKEN: "admintok-123456",
    CASES_KV: kvWith({
      "icu:doctor:u-owner": { status: "pending", extractedName: "Manoj Kurmana", extractedRegNo: "APMC-1", council: "Andhra Pradesh Medical Council" },
      "icu:doctor:u-doc2": { status: "verified", name: "Second Doctor", regNo: "TSMC-2", council: "Telangana State Medical Council" },
    }),
  }, opts || {});
  await updatesRepo.insertUpdate(env, { id: "u1", doc_key: "https://example.org/a", type: "drug_approval", title: "Source A", content_hash: "h1" });
  await updatesRepo.insertUpdate(env, { id: "u2", doc_key: "https://example.org/b", type: "safety_alert", title: "Source B", content_hash: "h2" });
  return env;
}

async function call(env, method, path, { tok, admin, body, headers } = {}) {
  const h = Object.assign({ "Content-Type": "application/json" }, headers || {});
  if (tok) h.Authorization = "Bearer " + tok;
  if (admin) h["X-Admin-Token"] = admin;
  const req = new Request("https://stewardmd.in/api/updates/" + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const parts = path.split("?")[0].split("/").filter(Boolean);
  const res = await onRequest({ request: req, env, params: { path: parts }, waitUntil: () => {} });
  let data = null; try { data = await res.clone().json(); } catch (e) {}
  return { status: res.status, data, res };
}

const DIS = KB_DISEASE_IDS.includes("ACUTE_BRONCHITIS") ? "ACUTE_BRONCHITIS" : KB_DISEASE_IDS[0];
const DIS2 = KB_DISEASE_IDS.find((d) => d !== DIS);
function draft(over) {
  return Object.assign({
    update_id: "u1", kind: "approval", headline: "New agent approved for adults with the condition",
    what_changed: "Regulator approved the agent as add-on therapy after a phase 3 trial showed fewer exacerbations.",
    applies_to: "Adults with moderate disease", evidence_type: "regulatory_approval", evidence_note: "",
    regulator: "FDA", india_status: "not_approved_india", source_label: "FDA approval letter",
    source_url: "https://www.fda.gov/example", source_date: "2026-09-01", doi: "", pmid: "",
    review_months: 12, disease_ids: [DIS],
  }, over || {});
}
const CHECK = { source_read: true, numbers_match: true, india_checked: true, own_words: true };

async function addSigner(env, uid, name, reg, council) {
  const r = await call(env, "POST", "bulletins/signers", { tok: "tok-owner-doc", body: { uid, name, reg_no: reg, council } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
}
async function signedBulletin(env, over) {
  const c = await call(env, "POST", "bulletins", { tok: "tok-owner-doc", body: draft(over) });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const s = await call(env, "POST", "bulletins/" + c.data.item.id + "/sign", { tok: "tok-owner-doc", body: { body_hash: c.data.item.body_hash, checklist: CHECK } });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  return s.data.item;
}
async function publicIds(env) {
  const r = await call(env, "GET", "bulletins");
  assert.equal(r.status, 200);
  return (r.data.items || []).map((i) => i.id);
}
function auditRows(env, action) {
  return env.UPDATES_DB._db.prepare("SELECT * FROM bulletin_audit WHERE action = ?").all(action);
}
async function ownerSigner(env) { await addSigner(env, "u-owner", "Manoj Kurmana", "APMC-1", "Andhra Pradesh Medical Council"); }

/* ---------------- schema ---------------- */

test("schema: base schema and base-without-bulletins + migration give identical bulletin tables; migration re-runs", { skip: SKIP }, () => {
  const a = new DatabaseSync(":memory:"); a.exec(SCHEMA);
  const baseOnly = SCHEMA.replace(/-- BEGIN bulletins[\s\S]*?-- END bulletins/, "");
  assert.notEqual(baseOnly, SCHEMA, "updates_schema.sql carries the bulletins block");
  const b = new DatabaseSync(":memory:"); b.exec(baseOnly); b.exec(MIGRATION); b.exec(MIGRATION);
  const shape = (db) => db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name LIKE '%bulletin%' OR name LIKE 'idx_bd_%' OR name LIKE 'idx_audit_%' ORDER BY name").all();
  assert.deepEqual(shape(a), shape(b));
  assert.ok(shape(a).length >= 8);
  const block = (s) => s.match(/-- BEGIN bulletins[\s\S]*?-- END bulletins/)[0];
  assert.equal(block(SCHEMA), block(MIGRATION), "the two DDL copies are byte-identical");
});

test("schema: no clinical column has a default (kind, evidence_type, india_status, review_months)", () => {
  for (const col of ["kind", "evidence_type", "india_status", "review_months", "headline", "what_changed", "source_url", "source_date"]) {
    const line = MIGRATION.split("\n").find((l) => new RegExp("^\\s+" + col + "\\s").test(l));
    assert.ok(line, col);
    assert.ok(!/DEFAULT/.test(line), col + " must have no default: " + line);
  }
});

test("disease ids: the checked-in list matches kb/dist exactly", () => {
  assert.deepEqual(Array.from(KB_DISEASE_IDS), loadDiseaseIds());
  assert.ok(KB_DISEASE_IDS.length > 4000);
});

/* ---------------- validation ---------------- */

test("validation: a complete draft passes and is normalised", () => {
  const r = rules.validateDraft(draft({ headline: "  New   agent approved\tfor adults  ", disease_ids: [DIS, DIS] }));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.headline, "New agent approved for adults");
  assert.deepEqual(r.value.disease_ids, [DIS]);
});

test("validation: each clinical rule rejects", () => {
  const codes = (over) => rules.validateDraft(draft(over), { now: Date.parse("2026-09-28T00:00:00Z") }).errors.map((e) => e.field + ":" + e.code);
  assert.ok(codes({ india_status: "" }).includes("india_status:invalid"));
  assert.ok(codes({ india_status: "approved" }).includes("india_status:invalid"));
  assert.ok(codes({ kind: "news" }).includes("kind:invalid"));
  assert.ok(codes({ evidence_type: "GRADE 1B" }).includes("evidence_type:invalid"));
  assert.ok(codes({ regulator: "XYZ" }).includes("regulator:invalid"));
  assert.ok(codes({ review_months: 3 }).includes("review_months:invalid"));
  assert.ok(codes({ source_url: "http://www.fda.gov/x" }).includes("source_url:not-https"));
  assert.ok(codes({ source_url: "javascript:alert(1)//abcdef" }).includes("source_url:not-https"));
  assert.ok(codes({ source_date: "2026-02-30" }).includes("source_date:invalid"));
  assert.ok(codes({ source_date: "2027-01-01" }).includes("source_date:future"));
  assert.ok(codes({ headline: "x".repeat(121) }).includes("headline:too-long"));
  assert.ok(codes({ headline: "" }).includes("headline:required"));
  assert.ok(codes({ what_changed: "short" }).includes("what_changed:too-short"));
  assert.ok(codes({ what_changed: "Fewer exacerbations \u2014 a clear benefit over placebo." }).includes("what_changed:em-dash"));
  assert.ok(codes({ disease_ids: [] }).includes("disease_ids:required"));
  assert.ok(codes({ disease_ids: ["NOT_A_DISEASE"] }).includes("disease_ids:unknown"));
  assert.ok(codes({ disease_ids: KB_DISEASE_IDS.slice(0, 6) }).includes("disease_ids:too-many"));
  assert.ok(codes({ doi: "not-a-doi" }).includes("doi:invalid"));
  assert.ok(codes({ pmid: "12ab" }).includes("pmid:invalid"));
  assert.ok(codes({ update_id: "" }).includes("update_id:required"));
});

test("hash: covers the disease mapping and review interval, ignores key order", async () => {
  const v = rules.validateDraft(draft()).value;
  const h = await rules.bodyHash(v);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(await rules.bodyHash(Object.assign({}, v)), h);
  assert.notEqual(await rules.bodyHash(Object.assign({}, v, { disease_ids: [DIS, DIS2] })), h, "remapping is a clinical change");
  assert.notEqual(await rules.bodyHash(Object.assign({}, v, { review_months: 24 })), h);
  assert.notEqual(await rules.bodyHash(Object.assign({}, v, { india_status: "unknown" })), h);
});

/* ---------------- auth ---------------- */

test("auth: the admin token can never draft, sign, manage signers or flip the kill switch", { skip: SKIP }, async () => {
  const env = await fresh();
  await ownerSigner(env);
  const c = await call(env, "POST", "bulletins", { tok: "tok-owner-doc", body: draft() });
  const id = c.data.item.id;
  const A = "admintok-123456";
  assert.equal((await call(env, "POST", "bulletins", { admin: A, body: draft() })).status, 401);
  assert.equal((await call(env, "POST", "bulletins/" + id + "/sign", { admin: A, body: { body_hash: c.data.item.body_hash, checklist: CHECK } })).status, 401);
  assert.equal((await call(env, "POST", "bulletins/signers", { admin: A, body: { uid: "u-doc2", name: "Second Doctor", reg_no: "T2", council: "TSMC" } })).status, 401);
  assert.equal((await call(env, "POST", "bulletins/kill", { admin: A, body: { killed: true, reason: "testing the switch" } })).status, 401);
  assert.equal((await call(env, "GET", "bulletins/queue", { admin: A })).status, 401);
  assert.equal(auditRows(env, "sign").length, 0);
});

test("auth: unverified, trainee, and verified-but-unregistered doctors cannot sign; a registered one can", { skip: SKIP }, async () => {
  const env = await fresh();
  await ownerSigner(env);
  const reason = async (tok) => { const r = await call(env, "POST", "bulletins", { tok, body: draft() }); return r.status + ":" + (r.data && r.data.reason); };
  assert.equal(await reason("tok-unverified"), "403:not-verified");
  assert.equal(await reason("tok-trainee"), "403:trainee");
  assert.equal(await reason("tok-doc2"), "403:not-a-signer");
  assert.equal(await reason("tok-owner-nodoc"), "403:not-verified", "being an owner is not enough to sign");
  assert.equal((await call(env, "POST", "bulletins", { tok: "tok-owner-doc", body: draft() })).status, 200);
  assert.equal((await call(env, "POST", "bulletins", { body: draft() })).status, 401);
});

test("signers: only an owner adds them, only verified doctors can be added, deactivation revokes signing", { skip: SKIP }, async () => {
  const env = await fresh();
  await ownerSigner(env);
  await addSigner(env, "u-doc2", "Second Doctor", "TSMC-2", "Telangana State Medical Council");
  // a signer who is not an owner cannot add signers or kill
  assert.equal((await call(env, "POST", "bulletins/signers", { tok: "tok-doc2", body: { uid: "u-doc3", name: "Third Doctor", reg_no: "X3", council: "Some Council" } })).status, 403);
  assert.equal((await call(env, "POST", "bulletins/kill", { tok: "tok-doc2", body: { killed: true, reason: "not allowed to do this" } })).status, 403);
  // an owner who is not a doctor can still manage signers
  const bad = await call(env, "POST", "bulletins/signers", { tok: "tok-owner-nodoc", body: { uid: "u-unv", name: "Not Verified", reg_no: "X", council: "Some Council" } });
  assert.equal(bad.status, 400); assert.equal(bad.data.error, "not-verified-doctor");
  assert.equal((await call(env, "POST", "bulletins", { tok: "tok-doc2", body: draft() })).status, 200);
  assert.equal((await call(env, "POST", "bulletins/signers/u-doc2/deactivate", { tok: "tok-owner-doc" })).status, 200);
  const r = await call(env, "POST", "bulletins", { tok: "tok-doc2", body: draft() });
  assert.equal(r.status, 403); assert.equal(r.data.reason, "not-a-signer");
  assert.equal(auditRows(env, "signer_add").length, 2);
  assert.equal(auditRows(env, "signer_remove").length, 1);
});

test("signers: lookup pre-fills from either shape of the verified-doctor record", { skip: SKIP }, async () => {
  const env = await fresh();
  const a = await call(env, "GET", "bulletins/signers/lookup?email=doc2@example.com", { tok: "tok-owner-doc" });
  assert.equal(a.status, 200);
  assert.deepEqual([a.data.uid, a.data.verified, a.data.prefill.name, a.data.prefill.reg_no], ["u-doc2", true, "Second Doctor", "TSMC-2"]);
  const me = await call(env, "GET", "bulletins/me", { tok: "tok-owner-doc" });
  assert.equal(me.data.isOwner, true); assert.equal(me.data.canSign, false);
  assert.equal(me.data.self.name, "Manoj Kurmana", "manual-review record shape (extractedName)");
  assert.equal(me.data.self.reg_no, "APMC-1");
  assert.equal((await call(env, "GET", "bulletins/signers/lookup?email=doc2@example.com", { tok: "tok-doc2" })).status, 403);
});

/* ---------------- signing ---------------- */

test("identity: signed name and registration come from the registry, never the request", { skip: SKIP }, async () => {
  const env = await fresh();
  await ownerSigner(env);
  const c = await call(env, "POST", "bulletins", { tok: "tok-owner-doc", body: Object.assign(draft(), { signed_name: "Dr Impostor", signed_reg: "FAKE" }) });
  const s = await call(env, "POST", "bulletins/" + c.data.item.id + "/sign", {
    tok: "tok-owner-doc", body: { body_hash: c.data.item.body_hash, checklist: CHECK, verified_by: "Dr Impostor", signed_reg: "FAKE" },
  });
  assert.equal(s.status, 200);
  assert.equal(s.data.item.signed_name, "Manoj Kurmana");
  assert.equal(s.data.item.signed_reg, "APMC-1");
  assert.equal(s.data.item.signed_council, "Andhra Pradesh Medical Council");
});

test("sign what you see: stale hash, changed source, missing checklist are all refused without an audit row", { skip: SKIP }, async () => {
  const env = await fresh();
  await ownerSigner(env);
  const c = await call(env, "POST", "bulletins", { tok: "tok-owner-doc", body: draft() });
  const id = c.data.item.id, h = c.data.item.body_hash;
  const miss = await call(env, "POST", "bulletins/" + id + "/sign", { tok: "tok-owner-doc", body: { body_hash: h, checklist: Object.assign({}, CHECK, { own_words: false }) } });
  assert.equal(miss.status, 400); assert.deepEqual(miss.data.missing, ["own_words"]);
  const stale = await call(env, "POST", "bulletins/" + id + "/sign", { tok: "tok-owner-doc", body: { body_hash: "0".repeat(64), checklist: CHECK } });
  assert.equal(stale.status, 409); assert.equal(stale.data.error, "changed");
  env.UPDATES_DB._db.prepare("UPDATE updates SET content_hash = 'h1-new' WHERE id = 'u1'").run();
  const moved = await call(env, "POST", "bulletins/" + id + "/sign", { tok: "tok-owner-doc", body: { body_hash: h, checklist: CHECK } });
  assert.equal(moved.status, 409); assert.equal(moved.data.error, "source-changed");
  assert.equal(auditRows(env, "sign").length, 0);
  assert.deepEqual(await publicIds(env), []);
});

test("race: a sign that lost to an edit fails, and exactly one sign audit row exists", { skip: SKIP }, async () => {
  const env = await fresh();
  await ownerSigner(env);
  const c = await call(env, "POST", "bulletins", { tok: "tok-owner-doc", body: draft() });
  const it = c.data.item;
  const first = await call(env, "POST", "bulletins/" + it.id + "/sign", { tok: "tok-owner-doc", body: { body_hash: it.body_hash, checklist: CHECK } });
  assert.equal(first.status, 200);
  const e = await call(env, "POST", "bulletins", { tok: "tok-owner-doc", body: Object.assign(draft({ headline: "Edited headline after signing it" }), { id: it.id, updated_ts: first.data.item.updated_ts }) });
  assert.equal(e.status, 200);
  const second = await call(env, "POST", "bulletins/" + it.id + "/sign", { tok: "tok-owner-doc", body: { body_hash: it.body_hash, checklist: CHECK } });
  assert.equal(second.status, 409); assert.equal(second.data.error, "changed");
  assert.equal(auditRows(env, "sign").length, 1);
  const stale = await call(env, "POST", "bulletins", { tok: "tok-owner-doc", body: Object.assign(draft(), { id: it.id, updated_ts: first.data.item.updated_ts }) });
  assert.equal(stale.status, 409, "an edit from an out-of-date copy is refused"); assert.equal(stale.data.error, "stale");
});

test("review due is set at signing from review_months", { skip: SKIP }, async () => {
  const env = await fresh();
  await ownerSigner(env);
  const t0 = Date.now();
  const it = await signedBulletin(env, { review_months: 6 });
  assert.ok(it.review_due_ts >= t0 + 6 * rules.MONTH_MS && it.review_due_ts <= Date.now() + 6 * rules.MONTH_MS);
  assert.equal(it.state, "live");
});

/* ---------------- visibility ---------------- */

test("visibility: signed shows; edit, source change, due review, retraction each take it off the bedside", { skip: SKIP }, async () => {
  const env = await fresh();
  await ownerSigner(env);
  const db = env.UPDATES_DB._db;
  const a = await signedBulletin(env);
  const b = await signedBulletin(env, { update_id: "u2", kind: "safety", evidence_type: "regulatory_safety", headline: "Boxed warning added for liver injury" });
  const c = await signedBulletin(env, { headline: "Third bulletin for the review-due check" });
  const d = await signedBulletin(env, { headline: "Fourth bulletin for the retraction check" });
  assert.deepEqual((await publicIds(env)).sort(), [a.id, b.id, c.id, d.id].sort());

  // edit: back to draft
  const e = await call(env, "POST", "bulletins", { tok: "tok-owner-doc", body: Object.assign(draft({ headline: "Edited after signing, needs a new signature" }), { id: a.id, updated_ts: a.updated_ts }) });
  assert.equal(e.data.item.state, "draft");
  // source change by the pipeline
  db.prepare("UPDATE updates SET content_hash = 'h2-new' WHERE id = 'u2'").run();
  // review due
  db.prepare("UPDATE bulletins SET review_due_ts = ? WHERE id = ?").run(Date.now() - 1000, c.id);
  // retract
  const r = await call(env, "POST", "bulletins/" + d.id + "/retract", { tok: "tok-owner-doc", body: { reason: "Wrong population stated" } });
  assert.equal(r.status, 200);
  assert.deepEqual(await publicIds(env), []);

  const q = await call(env, "GET", "bulletins/queue", { tok: "tok-owner-doc" });
  const st = Object.fromEntries(q.data.items.map((i) => [i.id, i.state]));
  assert.equal(st[a.id], "draft");
  assert.equal(st[b.id], "source_changed");
  assert.equal(st[c.id], "review_due");
  assert.equal(st[d.id], undefined, "retracted leaves the queue");

  // saving an unchanged source-changed bulletin refreshes its source but does NOT re-publish it
  const bRow = q.data.items.find((i) => i.id === b.id);
  const resave = await call(env, "POST", "bulletins", { tok: "tok-owner-doc", body: Object.assign(draft({ update_id: "u2", kind: "safety", evidence_type: "regulatory_safety", headline: "Boxed warning added for liver injury" }), { id: b.id, updated_ts: bRow.updated_ts }) });
  assert.equal(resave.data.item.body_hash, b.body_hash, "same text, same hash");
  assert.equal(resave.data.item.state, "draft");
  assert.deepEqual(await publicIds(env), [], "a re-save alone never restores the old signature");
  const re = await call(env, "POST", "bulletins/" + b.id + "/sign", { tok: "tok-owner-doc", body: { body_hash: b.body_hash, checklist: CHECK } });
  assert.equal(re.status, 200);
  assert.deepEqual(await publicIds(env), [b.id]);
});

test("visibility predicate: a row still marked signed but whose text no longer matches the signature is hidden", { skip: SKIP }, async () => {
  // Defence in depth: every write path resets status on edit, but the predicate must not rely on that.
  const env = await fresh();
  await ownerSigner(env);
  const a = await signedBulletin(env);
  assert.deepEqual(await publicIds(env), [a.id]);
  env.UPDATES_DB._db.prepare("UPDATE bulletins SET headline = 'Tampered', body_hash = ? WHERE id = ?").run("f".repeat(64), a.id);
  assert.deepEqual(await publicIds(env), []);
  const q = await call(env, "GET", "bulletins/queue", { tok: "tok-owner-doc" });
  assert.equal(q.data.items.find((i) => i.id === a.id).state, "edited");
});

test("visibility: deleting the source update retracts its bulletins and says why", { skip: SKIP }, async () => {
  const env = await fresh();
  await ownerSigner(env);
  const a = await signedBulletin(env);
  const del = await call(env, "DELETE", "u1", { admin: "admintok-123456" });
  assert.equal(del.status, 200);
  assert.deepEqual(await publicIds(env), []);
  const row = env.UPDATES_DB._db.prepare("SELECT status, retract_reason FROM bulletins WHERE id = ?").get(a.id);
  assert.deepEqual([row.status, row.retract_reason], ["retracted", "source deleted"]);
  assert.equal(auditRows(env, "source_deleted").length, 1);
});

test("manual re-publish of the same URL with new text changes content_hash (so it un-signs)", { skip: SKIP }, async () => {
  const env = await fresh();
  const pub = (b) => call(env, "POST", "", { admin: "admintok-123456", body: { title: "Manual item", body: b, url: "https://example.org/manual" } });
  const one = await pub("First text of the item.");
  assert.equal(one.status, 200, JSON.stringify(one.data));
  const h1 = env.UPDATES_DB._db.prepare("SELECT content_hash FROM updates WHERE id = ?").get(one.data.item.id).content_hash;
  const two = await pub("Changed text of the item.");
  assert.equal(two.data.updated, true);
  const h2 = env.UPDATES_DB._db.prepare("SELECT content_hash FROM updates WHERE id = ?").get(one.data.item.id).content_hash;
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.notEqual(h1, h2);
});

/* ---------------- public read ---------------- */

test("public list: display fields only, no uids or drafts; ETag gives 304", { skip: SKIP }, async () => {
  const env = await fresh();
  await ownerSigner(env);
  const a = await signedBulletin(env);
  await call(env, "POST", "bulletins", { tok: "tok-owner-doc", body: draft({ headline: "A draft that must never be public" }) });
  const r = await call(env, "GET", "bulletins");
  assert.equal(r.data.enabled, true);
  assert.equal(r.data.items.length, 1);
  const it = r.data.items[0];
  assert.equal(it.id, a.id);
  for (const k of ["signed_uid", "created_uid", "body_hash", "signed_hash", "source_hash", "update_id", "status"]) assert.ok(!(k in it), k + " must not be public");
  assert.deepEqual(it.disease_ids, [DIS]);
  assert.equal(it.signed_name, "Manoj Kurmana");
  const etag = r.res.headers.get("ETag");
  assert.ok(etag);
  const again = await call(env, "GET", "bulletins", { headers: { "If-None-Match": "W/" + etag } });
  assert.equal(again.status, 304);
});

test("kill switch: D1 setting empties the list on the next request and is audited; env layer too", { skip: SKIP }, async () => {
  const env = await fresh();
  await ownerSigner(env);
  await signedBulletin(env);
  const short = await call(env, "POST", "bulletins/kill", { tok: "tok-owner-doc", body: { killed: true, reason: "short" } });
  assert.equal(short.status, 400);
  const k = await call(env, "POST", "bulletins/kill", { tok: "tok-owner-doc", body: { killed: true, reason: "Checking a reported wording error" } });
  assert.equal(k.status, 200);
  const off = await call(env, "GET", "bulletins");
  assert.deepEqual([off.data.enabled, off.data.items.length], [false, 0]);
  assert.equal(auditRows(env, "kill_on").length, 1);
  await call(env, "POST", "bulletins/kill", { tok: "tok-owner-doc", body: { killed: false, reason: "Wording error checked and fixed" } });
  assert.equal((await publicIds(env)).length, 1);
  env.BULLETINS_OFF = "1";
  const envOff = await call(env, "GET", "bulletins");
  assert.deepEqual([envOff.data.enabled, envOff.data.items.length], [false, 0]);
});

test("schema on first use: the runtime DDL builds exactly the tables and indexes of migrate_bulletins.sql", { skip: SKIP }, () => {
  const a = new DatabaseSync(":memory:"); a.exec(MIGRATION);
  const b = new DatabaseSync(":memory:"); for (const s of BULLETIN_DDL) b.exec(s); for (const s of BULLETIN_DDL) b.exec(s);
  const shape = (db) => {
    const objs = db.prepare("SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
    return objs.map((o) => ({ o, cols: o.type === "table" ? db.prepare("PRAGMA table_xinfo(" + o.name + ")").all() : db.prepare("PRAGMA index_xinfo(" + o.name + ")").all() }));
  };
  assert.deepEqual(JSON.parse(JSON.stringify(shape(b))), JSON.parse(JSON.stringify(shape(a))));
  assert.equal(shape(a).length, 9);
});

test("schema on first use: a database without the bulletin tables gets them on the first request", { skip: SKIP }, async () => {
  const D = d1();
  D._db.exec(SCHEMA.replace(/-- BEGIN bulletins[\s\S]*?-- END bulletins/, ""));
  const r = await call({ UPDATES_DB: D }, "GET", "bulletins");
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.enabled, r.data.items.length], [true, 0]);
  assert.equal(D._db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'bulletin_signers'").get().n, 1);
  const none = await call({}, "GET", "bulletins");
  assert.deepEqual([none.status, none.data.enabled], [200, false]);
});

test("fail closed: if D1 refuses, the public list is enabled:false, never an error", { skip: SKIP }, async () => {
  const broken = { prepare: () => { throw new Error("d1 down"); }, batch: async () => { throw new Error("d1 down"); } };
  const r = await call({ UPDATES_DB: broken }, "GET", "bulletins");
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.enabled, r.data.items.length], [false, 0]);
});

/* ---------------- retraction + audit ---------------- */

test("retraction: needs a reason; an owner who is not a signer may retract; each write audits once", { skip: SKIP }, async () => {
  const env = await fresh();
  await ownerSigner(env);
  const a = await signedBulletin(env);
  assert.equal((await call(env, "POST", "bulletins/" + a.id + "/retract", { tok: "tok-owner-doc", body: { reason: "no" } })).status, 400);
  assert.equal((await call(env, "POST", "bulletins/" + a.id + "/retract", { tok: "tok-unverified", body: { reason: "Not allowed to retract this" } })).status, 403);
  assert.equal((await call(env, "POST", "bulletins/" + a.id + "/retract", { tok: "tok-owner-nodoc", body: { reason: "Owner pulling unsafe wording" } })).status, 200);
  assert.equal((await call(env, "POST", "bulletins/" + a.id + "/retract", { tok: "tok-owner-nodoc", body: { reason: "Owner pulling it a second time" } })).status, 409);
  assert.equal((await call(env, "POST", "bulletins", { tok: "tok-owner-doc", body: Object.assign(draft(), { id: a.id, updated_ts: a.updated_ts }) })).status, 409, "a retracted bulletin cannot be edited back");
  const byAction = (act) => env.UPDATES_DB._db.prepare("SELECT count(*) AS n FROM bulletin_audit WHERE bulletin_id = ? AND action = ?").get(a.id, act).n;
  assert.deepEqual([byAction("draft"), byAction("sign"), byAction("retract")], [1, 1, 1]);
  const audit = await call(env, "GET", "bulletins/" + a.id + "/audit", { tok: "tok-owner-doc" });
  assert.equal(audit.data.audit.length, 3);
});

test("queue: lists candidates without a bulletin and flags orphaned disease ids", { skip: SKIP }, async () => {
  const env = await fresh();
  await ownerSigner(env);
  const a = await signedBulletin(env);
  env.UPDATES_DB._db.prepare("INSERT INTO bulletin_diseases (bulletin_id, disease_id) VALUES (?, 'REMOVED_FROM_KB')").run(a.id);
  const q = await call(env, "GET", "bulletins/queue", { tok: "tok-owner-doc" });
  assert.deepEqual(q.data.candidates.map((c) => c.id), ["u2"]);
  assert.deepEqual(q.data.items.find((i) => i.id === a.id).orphaned, ["REMOVED_FROM_KB"]);
  const pub = await call(env, "GET", "bulletins");
  assert.ok(pub.data.items[0].disease_ids.includes("REMOVED_FROM_KB"), "server passes it through; the client drops unknown ids");
});

test("fail closed: signer routes answer a clean 500 when D1 refuses, never an unhandled throw", { skip: SKIP }, async () => {
  const broken = { prepare: () => { throw new Error("d1 down"); }, batch: async () => { throw new Error("d1 down"); } };
  const r = await call({ UPDATES_DB: broken }, "GET", "bulletins/queue", { tok: "tok-owner-doc" });
  assert.equal(r.status, 500);
  assert.deepEqual(r.data, { error: "server_error" });
});
