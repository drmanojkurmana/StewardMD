/* test/pglog-model.test.mjs — NMC Logbook · the pure core.
 *
 * The tests that matter here are the ones asserting a THROW. A PG logbook entry is a document whose
 * falsification carries a statutory penalty on a named person (PGMER-2023 9.2(c)), so "the button is
 * disabled" is not a guarantee. Each invariant is asserted at the model layer, which is what the UI
 * and the API both call.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const M = require("../pglog-model.js");

const NOW = Date.UTC(2026, 7, 27);                 // 2026-08-27
const T = (d) => Date.parse(d + "T00:00:00Z");

function mkEntry(over = {}) {
  return M.entry(Object.assign({
    id: "e1", kind: "procedure", residentId: "r1", programmeId: "p1", orgId: "o1",
    occurredAt: "2026-08-20", procedureText: "Tracheal intubation", role: "performed_supervised",
    supervisor: "dr.guide", createdBy: "fb:resident-uid", createdAt: T("2026-08-20"), status: "draft"
  }, over));
}

/* ── dates ─────────────────────────────────────────────────────────────────── */

test("dates are UTC day arithmetic, not local", () => {
  assert.equal(M.isoDate("2026-08-27"), "2026-08-27");
  assert.equal(M.isoDate(T("2026-08-27")), "2026-08-27");
  assert.equal(M.daysBetween("2026-08-20", "2026-08-27"), 7);
  assert.equal(M.daysBetween("2026-08-27", "2026-08-20"), -7);
  assert.equal(M.addDays("2026-02-28", 1), "2026-03-01");
});

test("addMonths clamps to the target month's last day", () => {
  assert.equal(M.addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(M.addMonths("2024-01-31", 1), "2024-02-29");   // leap
  assert.equal(M.addMonths("2026-08-27", 12), "2027-08-27");
});

test("weekKey is ISO-8601 (Mon-Sun) so a 'week' means the same thing for everyone", () => {
  // 2026-08-27 is a Thursday; the Monday and the Sunday of that week share its key.
  const k = M.weekKey("2026-08-27");
  assert.equal(M.weekKey("2026-08-24"), k);          // Monday
  assert.equal(M.weekKey("2026-08-30"), k);          // Sunday
  assert.notEqual(M.weekKey("2026-08-31"), k);       // next Monday
  assert.match(k, /^\d{4}-W\d{2}$/);
});

/* ── the state machine: the five throws ───────────────────────────────────── */

test("INVARIANT 1 — nobody verifies their own record", () => {
  const e = M.submit(mkEntry(), "fb:resident-uid", NOW);
  assert.throws(() => M.verify(e, "fb:resident-uid", NOW), /pglog_self_verify_forbidden/);
  // and it survives the app's identity namespacing, which is how this guard would silently die
  assert.throws(() => M.verify(e, "resident-uid", NOW), /pglog_self_verify_forbidden/);
  assert.throws(() => M.verify(e, "FB:Resident-UID", NOW), /pglog_self_verify_forbidden/);
  const ok = M.verify(e, "fb:faculty-uid", NOW);
  assert.equal(ok.status, "verified");
  assert.equal(ok.verifiedBy, "fb:faculty-uid");
});

test("INVARIANT 2 — a return must carry a reason", () => {
  const e = M.submit(mkEntry(), "fb:resident-uid", NOW);
  assert.throws(() => M.returnEntry(e, "fb:faculty-uid", NOW, ""), /pglog_return_reason_required/);
  assert.throws(() => M.returnEntry(e, "fb:faculty-uid", NOW, "   "), /pglog_return_reason_required/);
  const r = M.returnEntry(e, "fb:faculty-uid", NOW, "Role looks wrong - you assisted, not performed.");
  assert.equal(r.status, "returned");
  assert.match(r.returnReason, /Role looks wrong/);
});

test("INVARIANT 3 — a verified entry is never edited in place", () => {
  const v = M.verify(M.submit(mkEntry(), "fb:resident-uid", NOW), "fb:faculty-uid", NOW);
  assert.throws(() => M.applyEdit(v, { role: "performed_independent" }, "fb:resident-uid", NOW), /pglog_verified_immutable/);
  assert.throws(() => M.softDelete(v, "fb:resident-uid", NOW, "mistake"), /pglog_verified_immutable/);
});

test("INVARIANT 4 — amend preserves the verified original in full and re-opens verification", () => {
  const v = M.verify(M.submit(mkEntry(), "fb:resident-uid", NOW), "fb:faculty-uid", T("2026-08-21"));
  assert.throws(() => M.amend(v, { role: "assisted" }, "fb:resident-uid", NOW, ""), /pglog_amend_reason_required/);
  const a = M.amend(v, { role: "assisted" }, "fb:resident-uid", NOW, "Consultant corrected my role.");
  assert.equal(a.role, "assisted");
  assert.equal(a.status, "submitted");
  assert.equal(a.verifiedBy, "");                    // must be re-verified
  assert.equal(a.revisions.length, 1);
  assert.equal(a.revisions[0].doc.role, "performed_supervised");   // the ORIGINAL value survives
  assert.equal(a.revisions[0].wasVerifiedBy, "fb:faculty-uid");
  assert.equal(a.revisions[0].reason, "Consultant corrected my role.");
  // the amend is in the audit trail too, not only in revisions
  assert.ok(a.history.some((h) => h.action === "amend" && h.from === "verified"));
});

test("INVARIANT 5 — delete is soft, needs a reason, and keeps the record", () => {
  const e = mkEntry();
  assert.throws(() => M.softDelete(e, "fb:resident-uid", NOW, ""), /pglog_delete_reason_required/);
  const d = M.softDelete(e, "fb:resident-uid", NOW, "Duplicate of e2");
  assert.equal(d.deleted, true);
  assert.equal(d.procedureText, "Tracheal intubation");    // still there, just flagged
  assert.ok(d.history.some((h) => h.action === "delete"));
});

test("history is append-only across the whole lifecycle", () => {
  let e = mkEntry();
  e = M.submit(e, "fb:resident-uid", T("2026-08-20"));
  e = M.returnEntry(e, "fb:faculty-uid", T("2026-08-21"), "Add the supervisor.");
  e = M.applyEdit(e, { supervisor: "dr.consultant" }, "fb:resident-uid", T("2026-08-22"));
  e = M.submit(e, "fb:resident-uid", T("2026-08-22"));
  e = M.verify(e, "fb:faculty-uid", T("2026-08-23"));
  const actions = e.history.map((h) => h.action);
  assert.deepEqual(actions, ["submit", "return", "edit", "submit", "verify"]);
  // the return reason is gone from the ACTIVE field but preserved forever in history
  assert.equal(e.returnReason, "");
  assert.ok(e.history.some((h) => h.action === "return" && /Add the supervisor/.test(h.reason)));
});

test("applyEdit cannot smuggle in a status, an author or a verification", () => {
  const e = mkEntry();
  const out = M.applyEdit(e, {
    status: "verified", verifiedBy: "fb:me", verifiedAt: NOW, createdBy: "fb:someone-else", id: "other"
  }, "fb:resident-uid", NOW);
  assert.equal(out.status, "draft");
  assert.equal(out.verifiedBy, "");
  assert.equal(out.createdBy, "fb:resident-uid");
  assert.equal(out.id, "e1");
});

/* ── privacy ───────────────────────────────────────────────────────────────── */

test("case references are scrubbed of patient identity", () => {
  assert.equal(M.sanitizeCaseRef("MRN 44821"), "MRN 44821");
  assert.equal(M.sanitizeCaseRef("IP-99213"), "IP-99213");
  assert.equal(M.sanitizeCaseRef("Ramesh Kumar Sharma"), "");
  assert.equal(M.sanitizeCaseRef("9876543210"), "");
  assert.equal(M.sanitizeCaseRef("+91 9876543210"), "");
  assert.equal(M.sanitizeCaseRef("1234 5678 9012"), "");            // Aadhaar-shaped
  assert.equal(M.sanitizeCaseRef("patient@example.com"), "");
  assert.match(M.sanitizeCaseRef("MRN 44821 Ramesh Kumar"), /^MRN 44821/);
  assert.ok(!/Ramesh/.test(M.sanitizeCaseRef("MRN 44821 Ramesh Kumar")));
});

test("the entry schema has no field for patient identity at all", () => {
  const e = M.entry({ id: "x", kind: "clinical", occurredAt: "2026-08-20", title: "CAP",
    patientName: "Ramesh", phone: "9876543210", address: "12 MG Road", aadhaar: "123456789012" });
  assert.equal(e.patientName, undefined);
  assert.equal(e.phone, undefined);
  assert.equal(e.address, undefined);
  assert.equal(e.aadhaar, undefined);
});

test("age is banded, never a date of birth", () => {
  assert.equal(M.ageBand(34), "30-45");
  assert.equal(M.ageBand(0.5), "0-1");
  assert.equal(M.ageBand(90), "75+");
  assert.equal(M.ageBand("30-45"), "30-45");
  assert.equal(M.ageBand("1994-03-02"), "");        // a DOB is not an age band
});

/* ── validation ────────────────────────────────────────────────────────────── */

test("occurredAt is bounded by today and by the start of training", () => {
  const ctx = { today: "2026-08-27", programmeStart: "2025-07-01" };
  assert.equal(M.validateEntry(mkEntry({ occurredAt: "2026-09-05" }), ctx).ok, false);
  assert.equal(M.validateEntry(mkEntry({ occurredAt: "2025-01-01" }), ctx).ok, false);
  assert.equal(M.validateEntry(mkEntry({ occurredAt: "2026-08-20" }), ctx).ok, true);
});

test("PGMER-2023 5.2(v) — an MS/M.Ch procedure entry must name its supervisor", () => {
  assert.equal(M.requiresProcedureLog("MS"), true);
  assert.equal(M.requiresProcedureLog("MCh"), true);
  assert.equal(M.requiresProcedureLog("MD"), false);
  const ctx = { today: "2026-08-27", programmeStart: "2025-07-01", degree: "MS" };
  const bad = M.validateEntry(mkEntry({ supervisor: "" }), ctx);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.field === "supervisor" && /5\.2\(v\)/.test(e.message)));
  assert.equal(M.validateEntry(mkEntry({ supervisor: "" }), Object.assign({}, ctx, { degree: "MD" })).ok, true);
});

test("an ethics-approval milestone without the approval letter is refused", () => {
  const ctx = { today: "2026-08-27", programmeStart: "2025-07-01" };
  const e = M.entry({ id: "r", kind: "research", residentId: "r1", occurredAt: "2026-08-01",
    subtype: "thesis_milestone", milestone: "ethics_approval" });
  const v = M.validateEntry(e, ctx);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((x) => x.field === "attachments"));
});

test("PGMER-2023 5.2(xi) — a certification needs its certificate or its number", () => {
  const ctx = { today: "2026-08-27", programmeStart: "2025-07-01" };
  const bare = M.entry({ id: "c", kind: "certification", residentId: "r1", occurredAt: "2026-01-10", subtype: "bcls_acls" });
  assert.equal(M.validateEntry(bare, ctx).ok, false);
  const withNo = M.entry({ id: "c", kind: "certification", residentId: "r1", occurredAt: "2026-01-10",
    subtype: "bcls_acls", certificateNo: "ACLS/2026/8812" });
  assert.equal(M.validateEntry(withNo, ctx).ok, true);
});

/* ── progress ──────────────────────────────────────────────────────────────── */

const REQ_ABS = { id: "em_intubation", kind: "procedure", label: "Tracheal intubation", target: 100,
  per: "course", match: { procedureId: "em_intubation" }, source: "nmc_curriculum", clause: "Procedural skills" };
const REQ_CAD = { id: "gm_journal_club", kind: "academic", label: "Journal club", target: 1, per: "fortnight",
  match: { academicType: "journal_club" }, source: "nmc_curriculum", clause: "B. Journal club" };
const REQ_NONE = { id: "gs_procedures", kind: "procedure", label: "Procedures performed", target: null,
  per: "course", match: { roles: M.ROLES }, source: "nmc_curriculum", clause: "3. Log book" };

function verified(n, over) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(M.entry(Object.assign({ id: "v" + i, residentId: "r1", occurredAt: "2026-0" + (1 + (i % 8)) + "-10",
      status: "verified", createdBy: "fb:r" }, over)));
  }
  return out;
}

test("ONLY VERIFIED ENTRIES COUNT — a resident cannot advance their own progress bar", () => {
  const entries = [
    M.entry({ id: "a", kind: "procedure", procedureId: "em_intubation", occurredAt: "2026-08-01", status: "verified", role: "assisted" }),
    M.entry({ id: "b", kind: "procedure", procedureId: "em_intubation", occurredAt: "2026-08-02", status: "submitted", role: "assisted" }),
    M.entry({ id: "c", kind: "procedure", procedureId: "em_intubation", occurredAt: "2026-08-03", status: "draft", role: "assisted" })
  ];
  const p = M.progressFor(REQ_ABS, entries, { programmeStart: "2025-07-01", today: "2026-08-27" });
  assert.equal(p.done, 1);
  assert.equal(p.pending, 1);           // shown separately so the resident knows it is not lost
});

test("a deleted entry never counts", () => {
  const e = M.entry({ id: "a", kind: "procedure", procedureId: "em_intubation", occurredAt: "2026-08-01",
    status: "verified", deleted: true });
  assert.equal(M.progressFor(REQ_ABS, [e], { programmeStart: "2025-07-01", today: "2026-08-27" }).done, 0);
});

test("an UNSPECIFIED requirement counts and never invents a denominator", () => {
  const p = M.progressFor(REQ_NONE, verified(7, { kind: "procedure", role: "assisted" }),
    { programmeStart: "2025-07-01", today: "2026-08-27" });
  assert.equal(p.done, 7);
  assert.equal(p.target, null);
  assert.equal(p.pct, null);
  assert.equal(p.state, "counted");
});

test("a cadence requirement is measured against what is expected BY NOW, not the whole course", () => {
  const ctx = { programmeStart: "2026-07-01", today: "2026-08-27" };   // 57 days ~ 4 fortnights
  assert.equal(M.expectedToDate(REQ_CAD, 57), 4);
  const p = M.progressFor(REQ_CAD, verified(4, { kind: "academic", academicType: "journal_club" }), ctx);
  assert.equal(p.expected, 4);
  assert.equal(p.state, "on_track");
  const behind = M.progressFor(REQ_CAD, verified(1, { kind: "academic", academicType: "journal_club" }), ctx);
  assert.equal(behind.state, "behind");
});

test("a matcher with no discriminator matches nothing — a 'target 100' cannot silently self-complete", () => {
  const loose = { id: "loose", kind: "procedure", label: "Anything", target: 100, per: "course", match: {} };
  const p = M.progressFor(loose, verified(50, { kind: "procedure", role: "assisted" }), { programmeStart: "2025-07-01", today: "2026-08-27" });
  assert.equal(p.done, 0);
});

test("an explicit requirementIds link always counts, whatever the matcher says", () => {
  const e = M.entry({ id: "x", kind: "procedure", occurredAt: "2026-08-01", status: "verified",
    procedureText: "something else", requirementIds: ["em_intubation"] });
  assert.equal(M.progressFor(REQ_ABS, [e], { programmeStart: "2025-07-01", today: "2026-08-27" }).done, 1);
});

/* ── weekly cadence: PGMER-2023 5.2(v) ─────────────────────────────────────── */

test("weeklyCadence measures the regulation's own unit and names the missed weeks", () => {
  const entries = [
    M.entry({ id: "a", kind: "clinical", occurredAt: "2026-08-03", status: "verified", title: "x" }),
    M.entry({ id: "b", kind: "clinical", occurredAt: "2026-08-24", status: "draft", title: "y" })
  ];
  const wk = M.weeklyCadence(entries, "2026-08-01", "2026-08-27");
  assert.equal(wk.source, "nmc_regulation");
  assert.equal(wk.clause, "5.2(v)");
  assert.ok(wk.weeks >= 4);
  assert.ok(wk.missed.length >= 2);
  assert.ok(wk.pct < 100);
  // a DRAFT still counts as "the logbook was updated that week" - 5.2(v) is about updating, and
  // verification is a separate clause (5.2(vi)). Conflating them would punish the resident twice.
  assert.ok(!wk.missed.includes(M.weekKey("2026-08-24")));
});

test("latencyDays makes late logging visible without blocking it", () => {
  const e = M.entry({ id: "a", kind: "clinical", occurredAt: "2026-08-20", title: "x", createdAt: T("2026-08-25") });
  assert.equal(M.latencyDays(e), 5);
});

/* ── attendance: PGMER-2023 5.6 ────────────────────────────────────────────── */

test("attendance expands ranges, de-duplicates days, and reports both readings", () => {
  const entries = [
    M.entry({ id: "a", kind: "attendance", occurredAt: "2026-08-01", endDate: "2026-08-10", state: "present" }),
    M.entry({ id: "b", kind: "attendance", occurredAt: "2026-08-05", state: "leave_paid" })   // corrects one day
  ];
  const rows = M.expandAttendance(entries);
  assert.equal(rows.length, 10);
  assert.equal(rows.filter((r) => r.state === "leave_paid").length, 1);
  const sum = M.attendanceSummary(entries, { programmeStart: "2026-08-01", today: "2026-08-10", attendancePct: 80 });
  assert.equal(sum.recordedDays, 10);
  assert.equal(sum.attendedDays, 9);
  assert.equal(sum.pctOfRecorded, 90);
  assert.equal(sum.meetsPct, true);
  assert.equal(sum.thresholdPctSource, "nmc_regulation");
  assert.equal(sum.thresholdDaysSource, "nmc_faq_secondary");
});

test("academic leave counts as duty, paid leave does not", () => {
  const acad = M.attendanceSummary([M.entry({ id: "a", kind: "attendance", occurredAt: "2026-08-01", state: "leave_academic" })], {});
  const paid = M.attendanceSummary([M.entry({ id: "b", kind: "attendance", occurredAt: "2026-08-01", state: "leave_paid" })], {});
  assert.equal(acad.attendedDays, 1);
  assert.equal(paid.attendedDays, 0);
});

test("with nothing recorded, attendance is UNKNOWN rather than zero", () => {
  const sum = M.attendanceSummary([], { programmeStart: "2026-08-01", today: "2026-08-27" });
  assert.equal(sum.pctOfRecorded, null);
  assert.equal(sum.meetsPct, null);
});

/* ── exam eligibility ──────────────────────────────────────────────────────── */

test("PGMER-2023 5.2(x) dissemination is ONE row evaluated as a real OR", () => {
  const base = { programme: M.programme({ id: "p", degree: "MD" }), rotations: [], entries: [] };
  const none = M.examEligibility(base).rows.find((r) => r.key === "dissemination");
  assert.equal(none.met, false);
  const withPoster = M.examEligibility(Object.assign({}, base, {
    entries: [M.entry({ id: "a", kind: "research", subtype: "poster", occurredAt: "2026-05-01", status: "verified" })]
  })).rows.find((r) => r.key === "dissemination");
  assert.equal(withPoster.met, true);
  assert.equal(withPoster.via, "poster");
  // a NON-first-author publication does not satisfy it - the clause says "as the first author"
  const notFirst = M.examEligibility(Object.assign({}, base, {
    entries: [M.entry({ id: "b", kind: "research", subtype: "publication", firstAuthor: false, journal: "J", occurredAt: "2026-05-01", status: "verified" })]
  })).rows.find((r) => r.key === "dissemination");
  assert.equal(notFirst.met, false);
});

test("the three 5.2(xi) certifications each appear as their own checklist row", () => {
  const rows = M.examEligibility({ programme: M.programme({ id: "p", degree: "MD" }), entries: [], rotations: [] }).rows;
  M.CERTIFICATIONS.forEach((c) => {
    const row = rows.find((r) => r.key === "cert_" + c);
    assert.ok(row, "missing row for " + c);
    assert.equal(row.source, "nmc_regulation");
    assert.equal(row.clause, "5.2(xi)");
  });
});

test("eligibility is a CHECKLIST and says so — it never declares anyone eligible", () => {
  const out = M.examEligibility({ programme: M.programme({ id: "p", degree: "MD" }), entries: [], rotations: [] });
  assert.equal(out.eligible, undefined);
  assert.match(out.disclaimer, /determined by the University/);
});

test("attendance appears as ADVISORY and is excluded from the blocking count", () => {
  const out = M.examEligibility({
    programme: M.programme({ id: "p", degree: "MD" }), entries: [], rotations: [],
    attendance: M.attendanceSummary([], {})
  });
  const row = out.rows.find((r) => r.key === "attendance");
  assert.equal(row.advisory, true);
  assert.ok(!out.rows.filter((r) => !r.advisory).some((r) => r.key === "attendance"));
});

/* ── DRP: PGMER-2023 5.2(xii) ──────────────────────────────────────────────── */

test("the DRP semester window is a warning, not a block", () => {
  const res = M.resident({ id: "r1", startDate: "2025-07-01" });
  const inWindow = M.rotation({ id: "x", kind: "drp", startDate: "2026-08-01", endDate: "2026-11-01" });   // semester 3
  assert.equal(M.drpWindowOk(inWindow, res).ok, true);
  const early = M.rotation({ id: "y", kind: "drp", startDate: "2025-08-01", endDate: "2025-11-01" });      // semester 1
  const w = M.drpWindowOk(early, res);
  assert.equal(w.ok, false);
  assert.match(w.warning, /5\.2\(xii\)V/);
  assert.equal(w.source, "nmc_regulation");
  // a non-DRP rotation is never warned about
  assert.equal(M.drpWindowOk(M.rotation({ id: "z", kind: "department", startDate: "2025-08-01" }), res).ok, true);
});

test("DRP counts toward eligibility only when it is completed and long enough", () => {
  const prog = M.programme({ id: "p", degree: "MD" });
  const short = [M.rotation({ id: "d", kind: "drp", status: "completed", startDate: "2026-08-01", endDate: "2026-08-20" })];
  const full = [M.rotation({ id: "d", kind: "drp", status: "completed", startDate: "2026-05-01", endDate: "2026-08-01" })];
  assert.equal(M.examEligibility({ programme: prog, rotations: short, entries: [] }).rows.find((r) => r.key === "drp").met, false);
  assert.equal(M.examEligibility({ programme: prog, rotations: full, entries: [] }).rows.find((r) => r.key === "drp").met, true);
});

/* ── attestation: PGMER-2023 5.2(vi) ───────────────────────────────────────── */

test("a month with entries and no guide authentication goes overdue after the grace period", () => {
  const res = M.resident({ id: "r1", startDate: "2026-06-01" });
  const entries = [
    M.entry({ id: "a", kind: "clinical", occurredAt: "2026-06-10", title: "x", status: "verified" }),
    M.entry({ id: "b", kind: "clinical", occurredAt: "2026-07-10", title: "y", status: "verified" })
  ];
  const atts = [M.attestation({ residentId: "r1", kind: "monthly", period: "2026-06", attestedBy: "fb:guide", attestedAt: T("2026-07-03") })];
  const rows = M.attestationStatus(res, entries, atts, { today: "2026-08-27", attestationGraceDays: 7 });
  const jun = rows.find((r) => r.period === "2026-06");
  const jul = rows.find((r) => r.period === "2026-07");
  const aug = rows.find((r) => r.period === "2026-08");
  assert.equal(jun.attested, true);
  assert.equal(jun.overdue, false);
  assert.equal(jul.attested, false);
  assert.equal(jul.overdue, true);
  assert.equal(aug.overdue, false);      // August has not closed, and has no entries
});

test("a month with NO entries is never overdue — there is nothing to authenticate", () => {
  const res = M.resident({ id: "r1", startDate: "2026-06-01" });
  const rows = M.attestationStatus(res, [], [], { today: "2026-08-27" });
  assert.ok(rows.every((r) => r.overdue === false));
});

test("attestation ids are deterministic per resident + kind + period (so a month cannot be signed twice)", () => {
  assert.equal(M.attestationId("r1", "monthly", "2026-07"), "r1__monthly__2026-07");
  assert.equal(M.attestation({ residentId: "r1", kind: "monthly", period: "2026-07" }).id, "r1__monthly__2026-07");
});

/* ── assessments ───────────────────────────────────────────────────────────── */

const DOPS = {
  id: "dops", scaleMin: 0, scaleMax: 5, logbookMax: 10, requireDiscussed: false,
  criteria: [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }, { key: "e" }, { key: "f" }, { key: "g" }, { key: "h" }]
};

test("DOPS totals match the NMC form: 8 x 5 = 40 + logbook 10 = 50", () => {
  const a = M.assessment({ id: "as1", residentId: "r1", templateId: "dops",
    scores: { a: 5, b: 5, c: 5, d: 5, e: 5, f: 5, g: 5, h: 5 }, logbookScore: 10 });
  const sc = M.scoreAssessment(a, DOPS);
  assert.equal(sc.criteriaMax, 40);
  assert.equal(sc.logbookMax, 10);
  assert.equal(sc.maxTotal, 50);
  assert.equal(sc.total, 50);
});

test("a partially-scored assessment cannot be completed — blanks are not zeros", () => {
  const a = M.assessment({ id: "as1", residentId: "r1", templateId: "dops", scores: { a: 4, b: 3 }, logbookScore: 8 });
  assert.equal(M.scoreAssessment(a, DOPS).missing.length, 6);
  assert.throws(() => M.assess(a, "fb:faculty", NOW, DOPS), /pglog_assessment_incomplete/);
});

test("INVARIANT 6 — an assessor cannot assess themselves", () => {
  const a = M.assessment({ id: "as1", residentId: "r1", templateId: "dops",
    scores: { a: 4, b: 4, c: 4, d: 4, e: 4, f: 4, g: 4, h: 4 }, logbookScore: 8 });
  a.residentUid = "fb:resident-uid";
  assert.throws(() => M.assess(a, "fb:resident-uid", NOW, DOPS), /pglog_self_assess_forbidden/);
});

test("the appraisal form's 'discussed with the trainee?' is required when the form asks it", () => {
  const tpl = Object.assign({}, DOPS, { requireDiscussed: true });
  const a = M.assessment({ id: "as1", residentId: "r1", templateId: "appraisal",
    scores: { a: 4, b: 4, c: 4, d: 4, e: 4, f: 4, g: 4, h: 4 }, logbookScore: 8 });
  assert.throws(() => M.assess(a, "fb:faculty", NOW, tpl), /pglog_discussed_required/);
  a.discussedWithTrainee = true;
  assert.equal(M.assess(a, "fb:faculty", NOW, tpl).status, "completed");
});

test("a remediation outcome opens a remediation plan and demands one", () => {
  const scores = { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1, h: 1 };
  const a = M.assessment({ id: "as1", residentId: "r1", templateId: "dops", scores, logbookScore: 2, outcome: "remediation" });
  assert.throws(() => M.assess(a, "fb:faculty", NOW, DOPS), /pglog_action_plan_required/);
  a.actionPlan = "Repeat 10 supervised intubations with Dr X, reassess in 6 weeks.";
  const done = M.assess(a, "fb:faculty", NOW, DOPS);
  assert.equal(done.status, "remediation_plan");
  const signed = M.signAssessment(done, "fb:hod", NOW);
  assert.equal(signed.status, "signed");
  assert.throws(() => M.signAssessment(signed, "fb:hod", NOW), /pglog_already_signed/);
});

/* ── dashboards ────────────────────────────────────────────────────────────── */

test("overdueVerifications uses the institutional SLA and is sorted worst-first", () => {
  const entries = [
    M.entry({ id: "a", kind: "clinical", occurredAt: "2026-08-01", title: "x", status: "submitted", submittedAt: T("2026-08-01") }),
    M.entry({ id: "b", kind: "clinical", occurredAt: "2026-08-24", title: "y", status: "submitted", submittedAt: T("2026-08-24") }),
    M.entry({ id: "c", kind: "clinical", occurredAt: "2026-08-01", title: "z", status: "verified", submittedAt: T("2026-08-01") })
  ];
  const out = M.overdueVerifications(entries, { today: "2026-08-27", verifySlaDays: 7 });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "a");
  assert.equal(out[0].days, 26);
});

test("summarise counts by status and by kind, ignoring deleted", () => {
  const entries = [
    M.entry({ id: "a", kind: "clinical", occurredAt: "2026-08-01", title: "x", status: "verified" }),
    M.entry({ id: "b", kind: "procedure", occurredAt: "2026-08-01", procedureText: "p", status: "submitted" }),
    M.entry({ id: "c", kind: "procedure", occurredAt: "2026-08-01", procedureText: "q", status: "verified", deleted: true })
  ];
  const s = M.summarise(entries);
  assert.equal(s.total, 2);
  assert.equal(s.verified, 1);
  assert.equal(s.byKind.procedure.total, 1);
});

test("trainingYearOn is derived and capped at the programme duration", () => {
  const res = M.resident({ id: "r", startDate: "2024-07-01" });
  const prog = M.programme({ id: "p", degree: "MD", durationMonths: 36 });
  assert.equal(M.trainingYearOn(res, prog, "2024-08-01"), 1);
  assert.equal(M.trainingYearOn(res, prog, "2025-08-01"), 2);
  assert.equal(M.trainingYearOn(res, prog, "2026-08-01"), 3);
  assert.equal(M.trainingYearOn(res, prog, "2028-08-01"), 3);   // term extended: still final year
});

test("progressScore is null when there is nothing to score", () => {
  assert.equal(M.progressScore({}), null);
  assert.equal(M.progressScore({ weekly: { pct: 80 } }), 80);
});

test("a DEVICE-LOCAL draft may have no resident id; the server path still requires one", () => {
  const e = M.entry({ id: "d", kind: "clinical", occurredAt: "2026-08-20", title: "Ward round", role: "assisted" });
  // client, unlinked resident: allowed
  assert.equal(M.validateEntry(e, { today: "2026-08-27", requireResident: false }).ok, true);
  // server (never passes the flag): refused
  const v = M.validateEntry(e, { today: "2026-08-27" });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((x) => x.field === "residentId"));
});
