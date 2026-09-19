/* test/wardsynq-formulary-settings.test.mjs - the hospital's formulary through its own routes (R3-2): GET/POST
 * /api/queue/org/formulary and POST /api/queue/org/formulary-import through the real router. Dry run first, row by row;
 * any problem refuses the whole save; a commit writes only the dry run's result, needs a reason and is audited;
 * /api/queue/org/update refuses the key. Negative authorization on every route. The drug names are this test's, not content.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-formulary-settings.test.mjs
 */
import { as, seedHospital, patchOrgConfig, docsWhere, U, ORG, ORG2 } from "./wardsynq-ops-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFormulary, planFormulary, auditMeta, readFormularyCsv } from "../functions/_wardsynq/formulary-settings.js";
import { resolveFormulary, formularyStatus } from "../functions/_wardsynq/formulary.js";

const orgCfg = () => docsWhere((f, p) => p === `q_orgs/${ORG}`)[0].fields.wardsynq;
const audits = () => docsWhere((f) => f.action === "org:formulary");
const LIST = [
  { drug: "Paracetamol 500mg", code: "PCM-500" },
  { drug: "Meropenem", restricted: true, requiresApproval: true, approvedBy: "Microbiology" },
];

test("PURE: a restriction nobody can clear, a name used twice and an unreadable value are problems; retired entries match nothing", async () => {
  const chk = checkFormulary([{ drug: "Colistin", restricted: true }, { drug: "Amoxicillin" }, { drug: "Amox", aliases: ["amoxicillin"] }, { drug: "X", restricted: "yes" }, { drug: "Old", retired: true, restricted: true }]);
  assert.deepEqual(chk.problems.map((p) => [p.index, p.reason]).sort(), [[0, "restriction_has_no_route"], [2, "duplicate"], [3, "bad_value"]]);
  assert.equal(chk.problems.find((p) => p.reason === "duplicate").clash, "Amoxicillin");
  assert.equal(formularyStatus({ formulary: resolveFormulary([{ drug: "Old", retired: true }, { drug: "New" }]), drug: "Old" }).state, "non-formulary");

  const plan = await planFormulary(LIST, [LIST[0], { ...LIST[1], note: "Stewardship" }, { drug: "Vancomycin", restrictedTo: ["ICU"], restricted: true }], false, true);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.counts, { add: 1, change: 1, unchanged: 1, invalid: 0, remove: 0, setting: 1 });
  assert.equal(plan.changeCount, 3);
  const meta = auditMeta(plan, "P and T committee", "editor");
  assert.match(meta, /\+Vancomycin/); assert.match(meta, /~Meropenem/);
  const big = await planFormulary([], Array.from({ length: 50 }, (_, i) => ({ drug: "Drug number " + i })), false, false);
  const m2 = auditMeta(big, "load", "csv-replace");
  assert.ok(m2.length <= 215, m2); assert.match(m2, /\+\d+ more$/);

  const read = readFormularyCsv("Name,Code,Restricted,Specialties\nMeropenem,,yes,ICU;Microbiology\nZinc,Z1,maybe,\n", { drug: 0, code: 1, restricted: 2, restrictedTo: 3 }, "merge", LIST);
  assert.equal(read.step, "plan");
  assert.equal(read.list.length, 3, "Meropenem replaced the matching entry, Zinc added");
  assert.deepEqual(read.list[1], { drug: "Meropenem", code: "", restrictedTo: ["ICU", "Microbiology"], restricted: true });
  assert.equal(read.rowProblems.get(3)[0].reason, "bad_yes_no");
  assert.equal(readFormularyCsv("a\nb", { drug: 0 }, undefined, []).error, "mode_required", "merge or replace is chosen, never assumed");
});

test("GET/POST /api/queue/org/formulary and POST /api/queue/org/formulary-import: 401 without a session; 403 for pharmacy, hr (staff.admin alone) and another hospital, nothing written", async () => {
  seedHospital();
  const body = { orgId: ORG, entries: LIST, reason: "x" };
  for (const [path, method, b] of [[`/org/formulary?orgId=${ORG}`, "GET"], ["/org/formulary", "POST", body], ["/org/formulary-import", "POST", { orgId: ORG, csv: "Name\nX\n" }]]) {
    assert.equal((await as(null, path, method, b)).__status, 401, path);
    assert.equal((await as(U.PHARMACY, path, method, b)).__status, 403, path);
    assert.equal((await as(U.NURSE, path, method, b)).__status, 403, path);
    const hr = await as(U.HR, path, method, b);
    assert.equal(hr.__status, 403, path + " " + JSON.stringify(hr));
    assert.equal((await as(U.ADMIN, path.replace(ORG, ORG2), method, b && { ...b, orgId: ORG2 })).__status, 403, path);
  }
  assert.equal(orgCfg().formulary, undefined);
  assert.equal(audits().length, 0);
  const ok = await as(U.ADMIN, `/org/formulary?orgId=${ORG}`);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.deepEqual(ok.entries, []);
});

test("POST /api/queue/org/formulary: dry run writes nothing; a restricted entry with no route is refused in dry run and commit; wrong confirmCount or no reason writes nothing; commit is audited", async () => {
  seedHospital();
  const bad = await as(U.ADMIN, "/org/formulary", "POST", { orgId: ORG, entries: [...LIST, { drug: "Colistin", restricted: true }] });
  assert.equal(bad.__status, 422);
  assert.equal(bad.error, "invalid_formulary");
  assert.equal(bad.rows.find((r) => r.label === "Colistin").problems[0].reason, "restriction_has_no_route");
  const badCommit = await as(U.ADMIN, "/org/formulary", "POST", { orgId: ORG, entries: [...LIST, { drug: "Colistin", restricted: true }], commit: true, reason: "x", confirmCount: bad.changeCount, planId: bad.planId });
  assert.equal(badCommit.__status, 422);

  const dry = await as(U.ADMIN, "/org/formulary", "POST", { orgId: ORG, entries: LIST, requireReasonOffFormulary: true });
  assert.equal(dry.__status, 200, JSON.stringify(dry));
  assert.equal(dry.step, "preview");
  assert.equal(dry.changeCount, 3);
  assert.deepEqual(dry.rows.map((r) => r.status), ["add", "add"]);
  assert.equal(orgCfg().formulary, undefined, "a dry run writes nothing");

  const send = (extra) => as(U.ADMIN, "/org/formulary", "POST", { orgId: ORG, entries: LIST, requireReasonOffFormulary: true, commit: true, confirmCount: dry.changeCount, planId: dry.planId, reason: "P and T committee 2026-09", ...extra });
  assert.equal((await send({ reason: "" })).error, "reason_required");
  assert.equal((await send({ confirmCount: 2 })).error, "preview_changed");
  assert.equal((await send({ planId: "0000000000000000" })).__status, 409);
  assert.equal(orgCfg().formulary, undefined, "no refused commit wrote anything");
  assert.equal(audits().length, 0);

  const done = await send();
  assert.equal(done.__status, 200, JSON.stringify(done));
  assert.equal(done.written, 3);
  assert.deepEqual(orgCfg().formulary, LIST);
  assert.equal(orgCfg().requireReasonOffFormulary, true);
  const a = audits();
  assert.equal(a.length, 1);
  assert.match(a[0].fields.meta, /\+Paracetamol 500mg \+Meropenem/);
  assert.match(a[0].fields.meta, /P and T committee/);

  // Replaying the same commit changes nothing and writes no second audit row.
  const again = await send();
  assert.equal(again.written, 0);
  assert.equal(audits().length, 1, "a replayed commit writes nothing");
  // A different change sent with the old plan id is refused: the list it was planned against has moved on.
  assert.equal((await send({ entries: [LIST[0]] })).error, "preview_changed");
  assert.deepEqual(orgCfg().formulary, LIST);

  /* An order for a drug saved here is judged exactly as one configured by hand: the ordering route reads
   * wardsynq.formulary as stored (router medication-order), and the stored list is the one sent. */
  const byHand = formularyStatus({ formulary: resolveFormulary(LIST), drug: "Meropenem" });
  const saved = formularyStatus({ formulary: resolveFormulary(orgCfg().formulary), drug: "Meropenem" });
  assert.deepEqual(saved, byHand);
  assert.equal(saved.blocked, true);
});

test("POST /api/queue/org/formulary-import: map, dry run row by row, merge vs replace chosen explicitly, commit only the dry run's result", async () => {
  seedHospital();
  patchOrgConfig(ORG, { formulary: LIST });
  const csv = "Drug,Code,Restricted,Approval,By\nMeropenem,,yes,yes,Microbiology\nCeftriaxone,CEF-1,,,\nColistin,,yes,,\n";
  const map = await as(U.ADMIN, "/org/formulary-import", "POST", { orgId: ORG, csv });
  assert.equal(map.step, "map");
  assert.deepEqual(map.headers, ["Drug", "Code", "Restricted", "Approval", "By"]);
  const mapping = { drug: 0, code: 1, restricted: 2, requiresApproval: 3, approvedBy: 4 };
  assert.equal((await as(U.ADMIN, "/org/formulary-import", "POST", { orgId: ORG, csv, mapping })).error, "mode_required");

  const bad = await as(U.ADMIN, "/org/formulary-import", "POST", { orgId: ORG, csv, mapping, mode: "merge" });
  assert.equal(bad.__status, 422);
  assert.deepEqual(bad.rows.map((r) => [r.row, r.status]), [[2, "unchanged"], [3, "add"], [4, "invalid"]]);

  const good = csv.replace("Colistin,,yes,,\n", "");
  const dry = await as(U.ADMIN, "/org/formulary-import", "POST", { orgId: ORG, csv: good, mapping, mode: "replace" });
  assert.equal(dry.__status, 200, JSON.stringify(dry));
  assert.deepEqual(dry.removed, ["Paracetamol 500mg"], "replace names what leaves the formulary");
  assert.equal(dry.changeCount, 2);
  assert.deepEqual(orgCfg().formulary, LIST, "dry run wrote nothing");
  assert.equal((await as(U.ADMIN, "/org/formulary-import", "POST", { orgId: ORG, csv: good, mapping, mode: "replace", commit: true, reason: "load", confirmCount: 1, planId: dry.planId })).__status, 409);
  const done = await as(U.ADMIN, "/org/formulary-import", "POST", { orgId: ORG, csv: good, mapping, mode: "replace", commit: true, reason: "Initial load from HIS", confirmCount: dry.changeCount, planId: dry.planId });
  assert.equal(done.__status, 200, JSON.stringify(done));
  assert.deepEqual(orgCfg().formulary.map((e) => e.drug), ["Meropenem", "Ceftriaxone"]);
  assert.match(audits()[0].fields.meta, /csv-replace/);
  assert.match(audits()[0].fields.meta, /-Paracetamol 500mg/);
});

test("POST /api/queue/org/update refuses wardsynq.formulary and requireReasonOffFormulary with 422 and saves nothing else in that call", async () => {
  seedHospital();
  const r = await as(U.ADMIN, "/org/update", "POST", { orgId: ORG, name: "Renamed", wardsynq: { formulary: LIST } });
  assert.equal(r.__status, 422);
  assert.equal(r.error, "use_formulary_route");
  assert.equal((await as(U.ADMIN, "/org/update", "POST", { orgId: ORG, wardsynq: { requireReasonOffFormulary: true } })).__status, 422);
  assert.equal(orgCfg().formulary, undefined);
  assert.equal(docsWhere((f, p) => p === `q_orgs/${ORG}`)[0].fields.name, "WSQ Ward Hospital");
});
