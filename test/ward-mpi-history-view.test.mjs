/* Merge history on the duplicate-records screen (GET /ward/identity). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard() {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb); vm.runInContext(src, sb);
  return sb.window.WARD;
}

const SEL = { patientId: "p1", name: "Ramesh Kumar" };
const view = (W, idn) => W._render({ ...W._st, view: "mpi", mpi: null, sel: SEL, mpiIdentity: idn });
const LIVE = { linkId: "l1", survivorId: "p1", mergedId: "p2", state: "merged", reason: "Same phone and address", mergedBy: "dr.a", mergedAt: "2026-09-10T10:00:00.000Z" };
const UNDONE = { linkId: "l2", survivorId: "p1", mergedId: "p3", state: "unmerged", reason: "Looked alike", mergedBy: "dr.a", mergedAt: "2026-09-01T10:00:00.000Z", unmergedBy: "dr.b", unmergedAt: "2026-09-02T10:00:00.000Z", unmergeReason: "Different fathers' names" };

test("not loaded, failed and never merged are three different sentences", () => {
  const W = loadWard();
  assert.match(view(W, null), /Loading the merge history/);
  const failed = view(W, { failed: true });
  assert.match(failed, /Could not load the merge history. Do not read this as never merged/);
  assert.ok(!failed.includes("never been merged"));
  assert.match(view(W, { ok: true, identity: { patientId: "p1", links: [], isMerged: false } }), /never been merged with another/);
});

test("undo is offered only on a live merge, and an undone one shows who undid it and why", () => {
  const W = loadWard();
  const html = view(W, { ok: true, identity: { patientId: "p1", links: [LIVE, UNDONE], absorbed: ["p2"], isMerged: false } });
  assert.ok(html.includes('data-w-act="mpiunmerge:p1~p2"'));
  assert.ok(!html.includes('data-w-act="mpiunmerge:p1~p3"'), "an undone merge cannot be undone again");
  assert.match(html, /Same phone and address/);
  assert.match(html, /Undone by dr\.b/);
  assert.match(html, /Different fathers/);
});

test("a record merged into another says where the full chart is", () => {
  const W = loadWard();
  const html = view(W, { ok: true, identity: { patientId: "p1", links: [{ ...LIVE, survivorId: "p9", mergedId: "p1" }], isMerged: true, mergedInto: "p9" } });
  assert.match(html, /merged into p9. The complete chart is under that record/);
  assert.ok(html.includes('data-w-act="mpiunmerge:p9~p1"'));
});

test("the merge preview shows both records, marks what differs, and asks for a reason before joining", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "mpi", mpi: null, sel: SEL, mpiIdentity: { ok: true, identity: { links: [] } },
    mpiPreview: { ok: true, dryRun: true, survivor: { patientId: "p1", name: "Ramesh Kumar", mrn: "M1", dob: "1970-01-01", sex: "male" }, merged: { patientId: "p2", name: "Ramesh Kumaar", mrn: "M2", dob: "1970-01-01", sex: "male" } } });
  assert.match(html, /Check before joining these records/);
  assert.equal((html.match(/class="w-diff"/g) || []).length, 2, "name and MRN differ; date of birth and sex do not");
  assert.ok(html.includes('id="wMpiReason"'));
  assert.ok(html.includes('data-w-act="mpimergeconfirm"'));
  assert.ok(html.includes('data-w-act="mpimergecancel"'));
  assert.match(html, /No clinical data is moved or deleted/);
});

test("a partial history is stated, and an empty partial history is not 'never merged'", () => {
  const W = loadWard();
  const html = view(W, { ok: true, partial: true, partialWarning: "Only the first 500 merge records were checked. This history may be incomplete.", identity: { patientId: "p1", links: [], isMerged: false } });
  assert.match(html, /may be incomplete/);
  assert.ok(!html.includes("never been merged"));
});
