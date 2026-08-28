/* test/pglog-certificate.test.mjs — THE DOCUMENT THAT LEAVES THE APP.
 * ===========================================================================
 * Everything else in this module is a working record. A certificate is an artefact: printed, filed
 * with a college, possibly produced at an examination years later. Three things therefore have to be
 * true no matter what, and each gets its own test rather than a careful reading:
 *
 *   1. It cannot be issued without the signatures the institution requires, and the same person
 *      cannot supply two of them.
 *   2. It cannot be issued over content that moved, and it stops being valid the moment a record it
 *      covers is corrected.
 *   3. An UNCERTIFIED export can never be mistaken for a certified one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const M = require("../pglog-model.js");
const R = require("../pglog-reports.js");
const Q = require("../pglog-qr.js");

const RES = { id: "r1", uid: "fb:res1", name: "Dr B Sharma", smdId: "SMD-004512",
              guide: "fb:guide1", coGuides: ["fb:coguide1"], programmeId: "p1", orgId: "o1" };
const sig = (by, role, reg) => ({ by, role, reg: reg || "TN/" + by, council: "TNMC", name: "Dr " + by });
const cert = (over) => M.certificate(Object.assign({ id: "c1", residentId: "r1", orgId: "o1" }, over || {}));

/* ── 1. the quorum ─────────────────────────────────────────────────────────── */

test("the DEFAULT rule is 2 faculty + HOD, and the HOD counts as both", () => {
  const q = M.certQuorum(null);
  assert.equal(q.faculty, 2);
  assert.equal(q.hod, 1);
  assert.equal(q.hodCountsAsFaculty, true);
  assert.equal(q.source, "institution", "the faculty COUNT is ours, not the NMC's");

  let c = cert();
  c = M.signCertificate(c, sig("fb:fac1", "faculty"), RES.uid, 10, null, RES);
  assert.equal(c.status, "pending", "one faculty signature is not a certificate");
  c = M.signCertificate(c, sig("fb:hod1", "hod"), RES.uid, 20, null, RES);
  assert.equal(c.status, "issued", "faculty + HOD meets it: the HOD is the second faculty");
  assert.equal(c.issuedAt, 20);
  assert.equal(M.quorumState(c, null, RES).signers, 2, "two DISTINCT people");
});

test("two faculty with no HOD is NOT enough", () => {
  let c = cert();
  c = M.signCertificate(c, sig("fb:fac1", "faculty"), RES.uid, 10, null, RES);
  c = M.signCertificate(c, sig("fb:fac2", "faculty"), RES.uid, 20, null, RES);
  assert.equal(c.status, "pending");
  assert.deepEqual(M.quorumState(c, null, RES).missing, ["1 Head of Department signature"]);
});

test("ONE person cannot be the whole quorum, however many times they press the button", () => {
  let c = cert();
  c = M.signCertificate(c, sig("fb:hod1", "hod"), RES.uid, 10, null, RES);
  assert.equal(c.status, "pending", "the HOD alone is one faculty + one HOD, not two faculty");
  // Same human, different namespace and case — the guard must see through both.
  assert.throws(() => M.signCertificate(c, sig("FB:HOD1", "faculty"), RES.uid, 20, null, RES),
    /pglog_cert_already_signed_by_you/);
  assert.throws(() => M.signCertificate(c, sig("hod1", "faculty"), RES.uid, 20, null, RES),
    /pglog_cert_already_signed_by_you/);
});

test("a resident can never certify their own logbook", () => {
  const c = cert();
  assert.throws(() => M.signCertificate(c, sig("fb:res1", "faculty"), RES.uid, 10, null, RES),
    /pglog_self_certify_forbidden/);
  assert.throws(() => M.signCertificate(c, sig("RES1", "hod"), RES.uid, 10, null, RES),
    /pglog_self_certify_forbidden/);
});

test("a signature with no registration number is refused outright", () => {
  const c = cert();
  assert.throws(() => M.signCertificate(c, { by: "fb:fac1", role: "faculty", reg: "" }, RES.uid, 10, null, RES),
    /pglog_cert_registration_required/);
});

test("an issued, superseded or revoked certificate takes no further signatures", () => {
  let c = cert();
  c = M.signCertificate(c, sig("fb:fac1", "faculty"), RES.uid, 10, null, RES);
  c = M.signCertificate(c, sig("fb:hod1", "hod"), RES.uid, 20, null, RES);
  assert.throws(() => M.signCertificate(c, sig("fb:fac2", "faculty"), RES.uid, 30, null, RES),
    /pglog_cert_already_issued/);
  const sup = M.supersedeCertificate(c, "an entry was amended", 40, "");
  assert.throws(() => M.signCertificate(sup, sig("fb:fac2", "faculty"), RES.uid, 50, null, RES),
    /pglog_cert_superseded/);
  const rev = M.revokeCertificate(c, "fb:hod1", 40, "issued in error");
  assert.throws(() => M.signCertificate(rev, sig("fb:fac2", "faculty"), RES.uid, 50, null, RES),
    /pglog_cert_revoked/);
});

test("revoking needs a reason — a withdrawn document must say why", () => {
  const c = cert({ status: "issued" });
  assert.throws(() => M.revokeCertificate(c, "fb:hod1", 10, "  "), /pglog_cert_revoke_reason_required/);
  const out = M.revokeCertificate(c, "fb:hod1", 10, "Issued against the wrong programme");
  assert.equal(out.status, "revoked");
  assert.match(out.revokeReason, /wrong programme/);
  assert.ok(out.history.some((h) => h.action === "revoke"), "and it is in the audit trail");
});

test("an institution can change the rule — including requiring the named guide", () => {
  const strict = { faculty: 3, hod: 1, hodCountsAsFaculty: false, requireGuide: true };
  let c = cert({ quorum: strict });
  c = M.signCertificate(c, sig("fb:fac1", "faculty"), RES.uid, 10, strict, RES);
  c = M.signCertificate(c, sig("fb:fac2", "faculty"), RES.uid, 20, strict, RES);
  c = M.signCertificate(c, sig("fb:hod1", "hod"), RES.uid, 30, strict, RES);
  const st = M.quorumState(c, strict, RES);
  assert.equal(c.status, "pending", "the HOD no longer counts as faculty here");
  assert.deepEqual(st.missing, ["1 more faculty signature", "the postgraduate guide's signature"]);
  c = M.signCertificate(c, sig("fb:guide1", "guide"), RES.uid, 40, strict, RES);
  assert.equal(c.status, "issued");
  assert.equal(M.quorumState(c, strict, RES).guideSigned, true);
});

test("'the guide signed' means the named guide, not merely someone senior", () => {
  const strict = { faculty: 1, hod: 0, requireGuide: true };
  let c = cert({ quorum: strict });
  c = M.signCertificate(c, sig("fb:hod1", "hod"), RES.uid, 10, strict, RES);
  assert.equal(c.status, "pending", "a head of department is not automatically this trainee's guide");
  const c2 = M.signCertificate(cert({ quorum: strict }), sig("fb:coguide1", "faculty"), RES.uid, 10, strict, RES);
  assert.equal(c2.status, "issued", "a CO-GUIDE named on the record does satisfy it");
});

/* ── 2. what was signed ────────────────────────────────────────────────────── */

const ENT = (id, over) => Object.assign({ id, kind: "clinical", occurredAt: "2026-01-05",
  status: "verified", verifiedAt: 100, verifiedReg: "TN/1", revisions: [] }, over || {});

test("the content string is stable under query order but changes when the work changes", () => {
  const c = cert({ entryIds: ["e2", "e1"] });
  const a = M.certificateContent(c, [ENT("e1"), ENT("e2")]);
  const b = M.certificateContent(c, [ENT("e2"), ENT("e1")]);
  assert.equal(a, b, "Firestore result order must not flip a certificate to tampered");

  for (const [k, v] of [["occurredAt", "2026-02-05"], ["status", "submitted"],
                        ["verifiedAt", 999], ["verifiedReg", "TN/9"]]) {
    const changed = M.certificateContent(c, [ENT("e1", { [k]: v }), ENT("e2")]);
    assert.notEqual(a, changed, "changing " + k + " must change what was signed");
  }
  const amended = M.certificateContent(c, [ENT("e1", { revisions: [{ at: 1 }] }), ENT("e2")]);
  assert.notEqual(a, amended, "an amendment must change it");
});

test("a DELETED covered entry changes the content — it does not quietly shrink out of it", () => {
  const c = cert({ entryIds: ["e1", "e2"] });
  const whole = M.certificateContent(c, [ENT("e1"), ENT("e2")]);
  const gone = M.certificateContent(c, [ENT("e1")]);
  assert.notEqual(whole, gone);
  assert.match(gone, /e2:MISSING/);
});

test("the certificate records what it does NOT cover", () => {
  const c = cert({ excluded: { draft: 4, submitted: 2, returned: 1 }, entryCount: 30 });
  assert.equal(c.excluded.draft, 4);
  assert.equal(c.excluded.submitted, 2);
  assert.equal(c.excluded.returned, 1);
});

/* ── 3. the exported document ──────────────────────────────────────────────── */

const CTX = (over) => Object.assign({
  resident: RES, programme: M.programme({ id: "p1", degree: "MD", name: "MD General Medicine" }),
  entries: [M.entry({ id: "e1", kind: "clinical", residentId: "r1", orgId: "o1",
    occurredAt: "2026-01-05", setting: "ipd", status: "verified", title: "DKA",
    caseRef: "MRN-4482", diagnosis: "Diabetic ketoacidosis" })],
  rotations: [], assessments: [], months: [], attestations: [], today: "2026-08-27"
}, over || {});

function issued() {
  let c = cert({ entryIds: ["e1"], entryCount: 1, contentDigest: "a1b2c3d4e5f60718293a4b5c6d7e8f90" });
  c = M.signCertificate(c, Object.assign(sig("fb:guide1", "guide", "KMC/2011/44321"), { name: "Dr A Rao" }), RES.uid, 100, null, RES);
  c = M.signCertificate(c, Object.assign(sig("fb:hod1", "hod", "KMC/1998/1102"), { name: "Dr H Nair" }), RES.uid, 200, null, RES);
  c.verifyCode = "PGL-7K2M9-XQ4TB";
  return c;
}

test("an UNCERTIFIED export is stamped, and carries no signature block and no QR", () => {
  const rep = R.certifiedLogbook(CTX({ certificate: null }));
  assert.equal(rep.official, false);
  assert.match(rep.subtitle, /UNCERTIFIED DRAFT/);
  assert.match(rep.draftBanner, /NOT CERTIFIED/);
  const html = R.certifiedDocHtml(rep, {});
  assert.match(html, /NOT CERTIFIED/);
  assert.ok(html.indexOf('class="pgl-qrt"') === -1, "no QR on a document nobody signed");
  assert.ok(html.indexOf("Verification code") === -1);
});

test("a PENDING certificate still exports as a draft, and says what is missing", () => {
  let c = cert();
  c = M.signCertificate(c, sig("fb:fac1", "faculty"), RES.uid, 10, null, RES);
  const rep = R.certifiedLogbook(CTX({ certificate: c }));
  assert.equal(rep.official, false);
  assert.match(rep.draftBanner, /AWAITING SIGNATURES/);
  const sec = rep.sections.filter((x) => x.heading === "Certification")[0];
  assert.match(sec.note, /NOT certified/);
  assert.match(sec.note, /1 more faculty signature/);
  assert.match(sec.note, /1 Head of Department signature/);
});

test("a SUPERSEDED certificate cannot be exported as official", () => {
  const rep = R.certifiedLogbook(CTX({ certificate: M.supersedeCertificate(issued(), "a covered entry was amended", 300, "") }));
  assert.equal(rep.official, false);
  assert.match(rep.draftBanner, /SUPERSEDED/);
  assert.ok(R.certifiedDocHtml(rep, {}).indexOf('class="pgl-qrt"') === -1);
});

test("the CERTIFIED document names every signatory with a checkable registration number", () => {
  const c = issued();
  const rep = R.certifiedLogbook(CTX({ certificate: c }));
  assert.equal(rep.official, true);
  const sec = rep.sections.filter((x) => x.heading === "Certification")[0];
  assert.equal(sec.rows.length, 2);
  assert.deepEqual(sec.rows.map((r) => r[1]), ["Postgraduate guide", "Head of Department"]);
  assert.deepEqual(sec.rows.map((r) => r[2]), ["KMC/2011/44321", "KMC/1998/1102"]);

  const html = R.certifiedDocHtml(rep, { verifyUrl: "https://stewardmd.in/pglog/v/PGL-7K2M9-XQ4TB" });
  assert.match(html, /KMC\/2011\/44321/);
  assert.match(html, /PGL-7K2M9-XQ4TB/);
  assert.match(html, /class="pgl-qrt"/);
  assert.match(html, /A1B2-C3D4-E5F6-0718/, "the content fingerprint is printed for comparison");
});

test("the document states its own limits, on the document", () => {
  const html = R.certifiedDocHtml(R.certifiedLogbook(CTX({ certificate: issued() })),
    { verifyUrl: "https://stewardmd.in/pglog/v/PGL-7K2M9-XQ4TB" });
  // Overstating this is the single most damaging thing the module could do.
  assert.match(html, /not a determination by the National Medical\s+Commission/);
  assert.match(html, /Information Technology Act, 2000/);
  assert.match(html, /no Digital Signature Certificate/);
  assert.match(html, /not an NMC requirement/, "the faculty COUNT is ours and must say so");
  assert.match(html, /signed by the Head of the Department/, "the HoD signature IS sourced");
});

test("the printed QR is bit-identical to the encoder, with an intact quiet zone", () => {
  const url = "https://stewardmd.in/pglog/v/PGL-7K2M9-XQ4TB";
  const html = R.certifiedDocHtml(R.certifiedLogbook(CTX({ certificate: issued() })), { verifyUrl: url });
  const table = html.match(/<table class="pgl-qrt"[\s\S]*?<\/table>/)[0];
  const rows = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => {
    const out = [];
    for (const c of m[1].matchAll(/colspan="(\d+)" style="background:(#[0-9a-f]{3,6})"/g)) {
      for (let i = 0; i < Number(c[1]); i++) out.push(c[2] === "#000" ? 1 : 0);
    }
    return out;
  });
  const qr = Q.encode(url), q = 4;
  assert.equal(rows.length, qr.size + q * 2);
  let bad = 0;
  for (let y = 0; y < rows.length; y++) {
    assert.equal(rows[y].length, qr.size + q * 2, "row " + y + " must span the full width");
    for (let x = 0; x < rows[y].length; x++) {
      const inside = y >= q && y < q + qr.size && x >= q && x < q + qr.size;
      if (rows[y][x] !== (inside ? (qr.modules[y - q][x - q] ? 1 : 0) : 0)) bad++;
    }
  }
  assert.equal(bad, 0, "a QR that renders wrong is worse than no QR — it still LOOKS scannable");
});

test("the PDF carries no patient-identifiable case reference", () => {
  const html = R.certifiedDocHtml(R.certifiedLogbook(CTX({ certificate: issued() })), { verifyUrl: "x" });
  assert.ok(html.indexOf("MRN-4482") === -1, "a certificate is filed with a college, not a chart");
});

test("the document is self-contained — no external request of any kind", () => {
  const html = R.certifiedDocHtml(R.certifiedLogbook(CTX({ certificate: issued() })), { verifyUrl: "x" });
  // It has to render years from now, offline, from a folder.
  assert.ok(!/<script/i.test(html), "no script");
  assert.ok(!/<link\s/i.test(html), "no stylesheet link");
  assert.ok(!/https?:\/\/(?!stewardmd\.in)/i.test(html.replace(/xmlns="[^"]*"/g, "")), "no third-party URL");
});
