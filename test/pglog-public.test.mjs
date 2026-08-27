/* test/pglog-public.test.mjs — the page a stranger sees when they scan the QR.
 * ===========================================================================
 * This is the ONE surface of the module that answers without a login, so it gets tested for what it
 * REFUSES to say as much as for what it says. Two properties matter more than the layout:
 *
 *   1. It never discloses clinical detail. The live record carries a case reference, a diagnosis,
 *      remarks and a reflection; the page is handed a record with all of them and must show none.
 *   2. It never trusts the record. Every value goes through HTML escaping, because a resident types
 *      some of them and the page is rendered for someone else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const P = await import("../functions/_pglog_public.js");
const V = await import("../functions/_pglog_verify.js");
const PAGE = await import("../functions/pglog/v/[code].js");

const env = { PGLOG_SIGNING_KEY: "test-key-not-a-real-secret" };
const req = { headers: { get: () => "203.0.113.9" } };

const ENTRY = {
  id: "e1", residentId: "r1", orgId: "org1", kind: "opd", occurredAt: "2026-08-14",
  role: "assisted", setting: "OPD", supervisor: "fb:faculty-1",
  status: "verified", verifiedBy: "fb:faculty-1", verifiedAt: 1756000000000,
  verifiedReg: "KMC/2011/44321", verifiedCouncil: "Karnataka Medical Council", verifiedName: "Dr A Rao",
  revisions: [],
  // The things that must NEVER reach an unauthenticated reader:
  caseRef: "MRN-99881", diagnosis: "Carcinoma of the breast, left",
  remarks: "Patient distressed about prognosis", reflection: "I should have paused before answering"
};
const RESIDENT = { id: "r1", name: "Dr B Sharma", smdId: "SMD-004512", trainingYear: 2,
                   programmeId: "p1", uid: "fb:resident-1", guide: "fb:faculty-1" };
const PROGRAMME = { id: "p1", degree: "MD", specialtyId: "general-medicine", name: "MD General Medicine" };

function deps(over) {
  return Object.assign({
    rateLimit: async () => ({ ok: true }),
    getEntry: async () => JSON.parse(JSON.stringify(ENTRY)),
    getResident: async () => RESIDENT,
    getProgramme: async () => PROGRAMME,
    getAssessment: async () => null,
    getAttestation: async () => null
  }, over || {});
}
async function record(over) {
  const payload = { id: ENTRY.id, residentId: ENTRY.residentId, orgId: ENTRY.orgId, kind: ENTRY.kind,
    occurredAt: ENTRY.occurredAt, role: ENTRY.role, verifiedBy: ENTRY.verifiedBy,
    verifiedByReg: ENTRY.verifiedReg, verifiedAt: ENTRY.verifiedAt, revisionCount: 0 };
  return Object.assign({ code: "PGL-7K2M9-XQ4TB", kind: "entry", refId: "e1", residentId: "r1",
    orgId: "org1", digest: await V.digestFor(env, "entry", payload), issuedAt: 1756000001000,
    revoked: false, supersededBy: "" }, over || {});
}
const lookupOf = (rec) => async () => rec;

async function render(code, d) {
  const res = await PAGE.onRequest({ request: req, env, params: { code }, __deps: d });
  return { res, html: await res.text() };
}

/* ── what it says ──────────────────────────────────────────────────────────── */

test("a valid code verifies, and names the registration the signature rests on", async () => {
  const r = await P.resolve(env, req, "PGL-7K2M9-XQ4TB", deps({ lookup: lookupOf(await record()) }));
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "valid");
  assert.equal(r.body.signedBy.registrationNo, "KMC/2011/44321");
  assert.equal(r.body.signedBy.council, "Karnataka Medical Council");
  // MASKED. Enough to match against the document in the examiner's hand, not enough to publish the
  // cross-module identity handle to anyone who comes by a code.
  assert.equal(r.body.resident.smdId, "SMD-\u2022\u2022\u2022512");
  assert.match(r.body.signedBy.role, /5\.2\(vii\)/);        // the clause it is signed under
});

test("the page renders the verdict as words, not only a colour", async () => {
  const { res, html } = await render("PGL-7K2M9-XQ4TB", deps({ lookup: lookupOf(await record()) }));
  assert.equal(res.status, 200);
  assert.match(html, /Signature valid/);
  assert.match(html, /KMC\/2011\/44321/);
  assert.match(html, /MD General Medicine/);
  assert.match(html, /14 Aug 2026/);                        // the date of the activity, readable
});

/* ── what it refuses to say ────────────────────────────────────────────────── */

test("NO CLINICAL DETAIL reaches an unauthenticated reader", async () => {
  const { html } = await render("PGL-7K2M9-XQ4TB", deps({ lookup: lookupOf(await record()) }));
  for (const secret of ["MRN-99881", "Carcinoma", "distressed", "should have paused"]) {
    assert.ok(html.indexOf(secret) === -1, "leaked: " + secret);
  }
});

test("no uid, no entry id, no org id on the public page", async () => {
  const { html } = await render("PGL-7K2M9-XQ4TB", deps({ lookup: lookupOf(await record()) }));
  for (const internal of ["fb:faculty-1", "fb:resident-1", "org1"]) {
    assert.ok(html.indexOf(internal) === -1, "leaked: " + internal);
  }
});

test("a hostile value in the record is escaped, never rendered as markup", async () => {
  const evil = '<img src=x onerror=alert(1)>"';
  const d = deps({
    lookup: lookupOf(await record()),
    getResident: async () => Object.assign({}, RESIDENT, { name: evil }),
    getEntry: async () => Object.assign({}, ENTRY, { verifiedName: evil, verifiedCouncil: evil })
  });
  const { html } = await render("PGL-7K2M9-XQ4TB", d);
  assert.ok(html.indexOf("<img src=x") === -1, "unescaped markup rendered");
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("the code in the URL is escaped too — it is attacker-controlled input", async () => {
  const { html } = await render('<script>alert(1)</script>', deps({ lookup: async () => null }));
  assert.ok(html.indexOf("<script>alert(1)") === -1);
  assert.match(html, /Not a valid code/);
});

/* ── the failure modes ─────────────────────────────────────────────────────── */

test("an EDITED record reads TAMPERED, not valid", async () => {
  const rec = await record();
  const d = deps({ lookup: lookupOf(rec),
    getEntry: async () => Object.assign({}, ENTRY, { occurredAt: "2026-08-01" }) });  // date moved
  const r = await P.resolve(env, req, rec.code, d);
  assert.equal(r.body.status, "tampered");
  const { html } = await render(rec.code, d);
  assert.match(html, /Do not rely on it/);
});

test("an AMENDED record reads superseded, and says the original is retained", async () => {
  const rec = await record({ revoked: true, supersededBy: "PGL-AAAAA-BBBBB" });
  const r = await P.resolve(env, req, rec.code, deps({ lookup: lookupOf(rec) }));
  assert.equal(r.body.status, "superseded");
  assert.match(r.body.message, /audit trail/);
});

test("an unknown code is a 404 and teaches nothing", async () => {
  const { res, html } = await render("PGL-AAAAA-AAAAA", deps({ lookup: async () => null }));
  assert.equal(res.status, 404);
  assert.match(html, /No signed record carries that code/);
  assert.ok(html.indexOf("Signature valid") === -1);
});

test("a record that cannot be read says so, and does NOT imply invalidity", async () => {
  const r = await P.resolve(env, req, "PGL-7K2M9-XQ4TB",
    deps({ lookup: lookupOf(await record()), getEntry: async () => { throw new Error("firestore down"); } }));
  assert.equal(r.body.status, "unavailable");
  assert.match(r.body.message, /Nothing is implied/);
  assert.ok(!/firestore/i.test(JSON.stringify(r.body)), "internal error text leaked");
});

test("rate limiting answers 429 with Retry-After, and renders as a page", async () => {
  const d = deps({ rateLimit: async () => ({ ok: false, retryAfter: 60 }) });
  const r = await P.resolve(env, req, "PGL-7K2M9-XQ4TB", d);
  assert.equal(r.status, 429);
  const { res } = await render("PGL-7K2M9-XQ4TB", d);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "60");
});

/* ── headers ───────────────────────────────────────────────────────────────── */

test("the page is noindex, uncached, unframable and script-free", async () => {
  const { res } = await render("PGL-7K2M9-XQ4TB", deps({ lookup: lookupOf(await record()) }));
  assert.match(res.headers.get("X-Robots-Tag"), /noindex/);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const csp = res.headers.get("Content-Security-Policy");
  assert.match(csp, /script-src 'none'|default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  const { html } = await render("PGL-7K2M9-XQ4TB", deps({ lookup: lookupOf(await record()) }));
  assert.ok(!/<script/i.test(html), "the page must work with no JavaScript at all");
});

test("the disclaimer is on the page, not just in the JSON", async () => {
  const { html } = await render("PGL-7K2M9-XQ4TB", deps({ lookup: lookupOf(await record()) }));
  assert.match(html, /not a determination by the NMC/);
  assert.match(html, /tamper-evident/i);
});
