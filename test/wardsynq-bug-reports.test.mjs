/* test/wardsynq-bug-reports.test.mjs - the Report Bug button's reports, kept on the server per hospital, removed only once solved.
 *
 * The real routes through the real router, on the shared in-memory hospital:
 *   POST /api/queue/ward/bug-report          any member reports (idempotent on the client report id)
 *   GET  /api/queue/ward/bug-reports         a manager sees every report, anyone else only their own
 *   POST /api/queue/ward/bug-report-status   admin: open -> in_progress -> solved (note required), solved -> open
 *   POST /api/queue/ward/bug-report-remove   admin: only a solved report; archived, never deleted
 *
 * node --test --experimental-test-module-mocks test/wardsynq-bug-reports.test.mjs
 */
import { as, seed, docs, H, ENV, T, ORG_ID, OTHER, ADMIN, NURSE, HR, CASHIER, OTHER_ADMIN, writesNow } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const { BUG_REPORT_TYPE } = await import("../functions/_wardsynq/bug-reports.js");
const { RecordService } = await import("../functions/_wardsynq/service.js");

const VIEWER = "viewer@example.test", AUTHOR = "author@example.test", OWNER = "owner@platform.test";
ENV.OWNER_EMAILS = OWNER;
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
function hospital() {
  seed();
  for (const [email, role] of [[VIEWER, "viewer"], [AUTHOR, "oncqis_protocol_author"]]) {
    docs.set(`q_members/${ORG_ID}__${idFor(email).replace(/[^A-Za-z0-9_-]/g, "-")}`, { fields: { orgId: ORG_ID, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}
const report = (over) => ({ orgId: ORG_ID, clientReportId: "BUG-C1", description: "The bed board did not refresh after a transfer.", severity: "major",
  location: "ward / beds", context: { url: "https://wardsynq.com/?code=secret#/ward", page: "ward", wardView: "beds", patient: { id: "pat-1", bed: "07", name: "Never Stored" } },
  target: { selector: "button.w-btn", tag: "button", snippet: "Transfer" }, errors: [{ type: "error", time: "2026-09-16T10:00:00.000Z", text: "TypeError: x is undefined" }],
  userAgent: "UA", screen: { width: 1024, height: 768, dpr: 2 }, clientReportedAt: "2026-09-16T10:00:01.000Z", ...(over || {}) });
const submit = (email, over) => as(email, "/ward/bug-report", "POST", report(over));
const list = (email, q) => as(email, "/ward/bug-reports?orgId=" + ORG_ID + (q ? "&status=" + q : ""));
const setStatus = (email, id, status, note, org) => as(email, "/ward/bug-report-status", "POST", { orgId: org || ORG_ID, id, status, note });
const remove = (email, id, org) => as(email, "/ward/bug-report-remove", "POST", { orgId: org || ORG_ID, id });

test("POST /ward/bug-report: no session is 401 and nothing is written", async () => {
  hospital();
  const r = await submit(null);
  assert.equal(r.__status, 401);
  assert.equal(writesNow(), 0);
});

test("POST /ward/bug-report: any member reports, including a role with no clinical actor; stored per hospital, audited, no PHI kept", async () => {
  hospital();
  for (const [email, cid] of [[NURSE, "n1"], [VIEWER, "v1"], [AUTHOR, "a1"], [CASHIER, "c1"]]) {
    const r = await submit(email, { clientReportId: cid });
    assert.equal(r.__status, 200, email + " " + r.__text);
    assert.equal(r.report.status, "open");
  }
  const rows = H.RECORD._rows.filter((x) => x.resourceType === BUG_REPORT_TYPE);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((x) => x.tenantId === T), "kept in this hospital's own tenant");
  const one = rows[0].body;
  assert.deepEqual(one.context.patient, { id: "pat-1", bed: "07" }, "patient id and bed only, never the name");
  assert.equal(one.context.url, "https://wardsynq.com/#/ward", "no query string");
  assert.equal(one.reporter.id, idFor(NURSE));
  const audits = H.RECORD.audit.filter((a) => a.action === "bug.report");
  assert.equal(audits.length, 4);
  assert.ok(!JSON.stringify(audits).includes("bed board"), "the description never reaches the audit row");
});

test("POST /ward/bug-report: resubmitting the same client id returns the saved report and writes nothing", async () => {
  hospital();
  const a = await submit(NURSE);
  const before = writesNow();
  const b = await submit(NURSE, { description: "sent again" });
  assert.equal(b.__status, 200);
  assert.equal(b.replayed, true);
  assert.equal(b.report.id, a.report.id);
  assert.equal(writesNow(), before, "no duplicate");
  // The same client id from someone else is their own report, never the nurse's.
  const c = await submit(VIEWER);
  assert.notEqual(c.report.id, a.report.id);
  assert.equal(c.replayed, false);
});

test("POST /ward/bug-report: another hospital is refused and nothing is written", async () => {
  hospital();
  const r = await as(OTHER_ADMIN, "/ward/bug-report", "POST", report());
  assert.equal(r.__status, 403);
  assert.equal(writesNow(), 0);
  const l = await list(OTHER_ADMIN);
  assert.equal(l.__status, 403);
});

test("GET /ward/bug-reports: the reporter sees only their own, the admin sees all; filters and newest first", async () => {
  hospital();
  await submit(NURSE, { clientReportId: "n1" });
  await submit(VIEWER, { clientReportId: "v1" });
  await submit(NURSE, { clientReportId: "n2" });
  const nurse = await list(NURSE);
  assert.equal(nurse.__status, 200);
  assert.equal(nurse.manager, false);
  assert.deepEqual(nurse.reports.map((x) => x.clientReportId).sort(), ["n1", "n2"]);
  const hr = await list(HR);
  assert.equal(hr.reports.length, 0, "hr holds staff.admin but is not the hospital admin: own reports only");
  const admin = await list(ADMIN);
  assert.equal(admin.manager, true);
  assert.equal(admin.reports.length, 3);
  assert.ok(admin.reports[0].reportedAt >= admin.reports[2].reportedAt, "newest first");
  assert.equal((await list(ADMIN, "bogus")).__status, 422);
});

test("POST /ward/bug-report-status: open -> in_progress -> solved with a required note -> reopened, each a new version", async () => {
  hospital();
  const { report: r } = await submit(NURSE);
  const p = await setStatus(ADMIN, r.id, "in_progress");
  assert.equal(p.__status, 200, p.__text);
  assert.equal(p.report.version, 2);
  const noNote = await setStatus(ADMIN, r.id, "solved", "");
  assert.equal(noNote.__status, 422);
  assert.equal(noNote.error, "solution_note_required");
  const s = await setStatus(ADMIN, r.id, "solved", "Bed board now refreshes after a transfer.");
  assert.equal(s.report.status, "solved");
  assert.equal(s.report.solution.note, "Bed board now refreshes after a transfer.");
  assert.equal(s.report.solution.by, idFor(ADMIN));
  const o = await setStatus(ADMIN, r.id, "open", "Still happens on the tablet.");
  assert.equal(o.report.status, "open");
  assert.equal(o.report.version, 4);
  assert.deepEqual((await H.RECORD.history(T, BUG_REPORT_TYPE, r.id)).map((v) => v.status), ["open", "in_progress", "solved", "open"]);
  assert.deepEqual(H.RECORD.audit.filter((a) => /^bug\./.test(a.action)).map((a) => a.action), ["bug.report", "bug.status", "bug.status", "bug.reopen"]);
  // The reporter sees the status of their own report.
  assert.equal((await list(NURSE)).reports[0].status, "open");
});

test("POST /ward/bug-report-status and /ward/bug-report-remove: a wrong role is refused and nothing is written", async () => {
  hospital();
  const { report: r } = await submit(NURSE);
  const before = writesNow();
  for (const email of [NURSE, CASHIER, VIEWER]) {
    assert.equal((await setStatus(email, r.id, "in_progress")).__status, 403, email);
    assert.equal((await remove(email, r.id)).__status, 403, email);
  }
  const hr = await setStatus(HR, r.id, "in_progress");
  assert.equal(hr.__status, 403);
  assert.equal(hr.error, "bug_manager_only");
  assert.equal((await remove(HR, r.id)).__status, 403);
  // Another hospital's admin, against this hospital and against their own (where the report does not exist).
  assert.equal((await setStatus(OTHER_ADMIN, r.id, "in_progress")).__status, 403);
  assert.equal((await setStatus(OTHER_ADMIN, r.id, "in_progress", "", OTHER)).__status, 404);
  assert.equal((await remove(OTHER_ADMIN, r.id, OTHER)).__status, 404);
  assert.equal(writesNow(), before);
});

test("POST /ward/bug-report-remove: refused with 409 unless solved; a solved report is archived, hidden by default and kept", async () => {
  hospital();
  const { report: r } = await submit(NURSE);
  let before = writesNow();
  const open = await remove(ADMIN, r.id);
  assert.equal(open.__status, 409);
  assert.equal(open.error, "bug_not_solved");
  await setStatus(ADMIN, r.id, "in_progress");
  before = writesNow();
  assert.equal((await remove(ADMIN, r.id)).__status, 409, "in progress is not solved");
  assert.equal(writesNow(), before, "nothing written by a refused removal");
  await setStatus(ADMIN, r.id, "solved", "Fixed in ward.js.");
  const gone = await remove(ADMIN, r.id);
  assert.equal(gone.__status, 200, gone.__text);
  assert.equal(gone.report.status, "removed");
  assert.equal(gone.report.removed.by, idFor(ADMIN));
  assert.equal((await list(ADMIN)).reports.length, 0, "hidden from the default list");
  assert.equal((await list(ADMIN, "removed")).reports.length, 1);
  assert.equal((await list(ADMIN, "all")).reports.length, 1);
  assert.equal((await H.RECORD.history(T, BUG_REPORT_TYPE, r.id)).map((v) => v.status).join(","), "open,in_progress,solved,removed", "every version kept");
  assert.equal((await setStatus(ADMIN, r.id, "open")).__status, 409, "a removed report does not come back through a status change");
});

test("the StewardMD platform owner manages a hospital's reports without being its staff", async () => {
  hospital();
  const { report: r } = await submit(NURSE);
  const l = await list(OWNER);
  assert.equal(l.__status, 200, l.__text);
  assert.equal(l.reports.length, 1);
  assert.equal((await setStatus(OWNER, r.id, "solved", "Owner fixed it.")).__status, 200);
});

test("the raw record door cannot reach a bug report: it is not a clinical resource type", async () => {
  hospital();
  const svc = new RecordService({ repository: H.RECORD, tenant: { id: T }, actor: { id: "x", kind: "human", tier: "execute", scope: { read: null, write: null } } });
  await assert.rejects(() => svc.list(BUG_REPORT_TYPE, 10), /unknown resource type/);
});
