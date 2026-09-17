/* The laboratory analyser screens: the bench's analyser cards, quality control with its Levey-Jennings charts,
 * rejected-sample counts, the laboratory's reagent stock, and Admin > Integrations > Laboratory analysers.
 * Loading is never an empty list, a failed read never looks like none, and nothing offers Release that the server
 * could not check.
 *
 * node --test test/ward-lab-analysers-view.test.mjs
 */
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
const board = { specimens: [], pending: [], criticals: [], errors: [], failed: {} };
const row = (over) => ({ id: "anr-1", version: 1, state: "pending", analyserId: "an-chem1", analyserName: "Chemistry 1", specimenId: "ACC-123", patientId: "p1", receivedAt: "2026-09-16T08:00:00Z",
  results: [{ instrumentCode: "K", testName: "Potassium", value: "4.1", unit: "mmol/L", referenceRange: "3.5-5.1", flags: "N", status: "final" }], qcBlocked: [], ...over });

test("bench: an analyser result offers Release; an unmapped code is named and never released; unread QC hides Release; a failed read is not none", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "labboard", labBoard: { ...board, analyser: [
    row(), row({ id: "anr-2", results: [{ instrumentCode: "ZZ", testName: null, value: "9", status: "preliminary" }] }),
    row({ id: "anr-3", qcBlocked: null }), row({ id: "anr-4", qcBlocked: [{ test: "Potassium", rules: ["1-3s"] }] }),
    row({ id: "anr-5", state: "unmatched", patientId: null }),
  ] } });
  assert.match(html, /From analysers, waiting to be released &middot; 4/);
  assert.ok(html.includes('data-w-act="analyserrelease:anr-1"'));
  assert.match(html, /not mapped: <span lang="en">ZZ<\/span>|not mapped: ZZ/);
  assert.ok(!html.includes('data-w-act="analyserrelease:anr-2"'), "nothing mapped, nothing to release");
  assert.match(html, /preliminary/);
  assert.ok(!html.includes('data-w-act="analyserrelease:anr-3"'), "a QC state that could not be read hides Release");
  assert.match(html, /could not be read\. Do not release until it loads/);
  assert.ok(html.includes('data-w-act="analyserrelease:anr-4"'), "a QC block keeps Release: the server asks for the override reason");
  assert.match(html, /QC rejected for/);
  assert.match(html, /not matched to a sample &middot; 1/);
  assert.ok(!html.includes('data-w-act="analyserrelease:anr-5"'));
  assert.ok(html.includes('data-w-act="analyserdismiss:anr-5"'));
  for (const act of ["labqc", "labstock", "labrejections"]) assert.ok(html.includes('data-w-act="' + act + '"'), act);

  const failed = W._render({ ...W._st, view: "labboard", labBoard: { ...board, analyser: [], errors: ["analyser results"], failed: { "analyser results": true } } });
  assert.match(failed, /From analysers<\/h3><\/div><p class="w-hint warn">.*Could not be read\. Do not read this as none\./);
  assert.ok(!/No analyser results waiting/.test(failed));
});

test("bench: a collected sample and a received one waiting for a result can be rejected with a coded reason", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "labboard", labBoard: { ...board,
    specimens: [
      { serviceRequestId: "sr1", display: "Renal profile", patientId: "p1", collection: { state: "collected", specimenId: "sp1", at: "2026-09-16T07:00:00Z", by: "n1" } },
      { serviceRequestId: "sr2", display: "FBC", patientId: "p1", collection: { state: "received", specimenId: "sp2" } },
    ],
    pending: [{ serviceRequestId: "sr2", display: "FBC", patientId: "p1" }] } });
  assert.ok(html.includes('data-w-act="specreject:sp1"'));
  assert.ok(html.includes('data-w-act="specreject:sp2"'));
});

test("quality control: loading, a failed read, the chart per level, the rules the server stored, and the held analyser with its action", () => {
  const W = loadWard();
  assert.match(W._render({ ...W._st, view: "labqc", labQc: null }), /Loading quality control/);
  assert.match(W._render({ ...W._st, view: "labqc", labQc: { failed: true } }), /Do not read this as no QC problems/);
  const run = (i, level, z, status, rules) => ({ id: "r" + i, analyserId: "an-chem1", test: "Potassium", level, lot: "L1", value: 4 + z / 10, unit: "mmol/L", z, at: "2026-09-1" + i + "T08:00:00Z", source: i % 2 ? "connector" : "manual", evaluation: { status, rules } });
  const html = W._render({ ...W._st, view: "labqc", labQc: {
    analysers: [{ id: "an-chem1", name: "Chemistry 1", tests: ["Potassium"] }],
    materials: [{ id: "qcm-l1-1", name: "Chem control", lot: "L1", level: "1", expiry: "2099-01-01", sampleId: "QC-L1", targets: [{ test: "Potassium", mean: 4, sd: 0.1 }], active: true }],
    runs: [run(3, "1", 3.4, "rejected", ["1-2s", "1-3s"]), run(2, "2", 0.2, "accepted", []), run(1, "1", 2.2, "warning", ["1-2s"])],
    blocks: [{ analyserId: "an-chem1", test: "Potassium", runId: "r3", recordedAt: "2026-09-13T08:00:00Z", rules: ["1-2s", "1-3s"] }],
    actions: [], overrides: [{ analyserId: "an-chem1", tests: ["Potassium"], reason: "Repeat in range", by: "lab1", at: "2026-09-13T09:00:00Z" }],
  } });
  assert.equal((html.match(/<svg /g) || []).length, 2, "one Levey-Jennings chart per control level");
  assert.match(html, /aria-label="Levey-Jennings chart, Chemistry 1, Potassium, 1"/);
  assert.match(html, /1-2s, 1-3s/);
  assert.ok(html.includes('data-w-act="labqcaction:an-chem1|Potassium"'));
  assert.match(html, /Held by a rejected QC run &middot; 1/);
  assert.match(html, /Repeat in range/);
  assert.ok(html.includes('data-w-act="labqcrun"') && html.includes('data-w-act="labqcmaterial"'));
});

test("rejected samples: loading, a failed read, and the month by reason and ward", () => {
  const W = loadWard();
  assert.match(W._render({ ...W._st, view: "labrejections", labRej: { month: "2026-09", data: null } }), /Loading/);
  assert.match(W._render({ ...W._st, view: "labrejections", labRej: { month: "2026-09", data: { failed: true } } }), /Do not read this as none/);
  const html = W._render({ ...W._st, view: "labrejections", labRej: { month: "2026-09", data: { month: "2026-09", rejected: 3, collected: 40,
    byReason: { haemolysed: 2, clotted: 1 }, byWard: [{ ward: "Medical A", total: 2, byReason: { haemolysed: 2 } }, { ward: null, total: 1, byReason: { clotted: 1 } }] } } });
  assert.match(html, /3 rejected of 40 collected/);
  assert.match(html, /Medical A/); assert.match(html, /Ward not known/); assert.match(html, /Haemolysed/); assert.match(html, /Wrong container/);
});

test("reagent stock: the laboratory's view is the shared ledger at its own location, with no reconciliation and no location box", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "inventory", inventory: { lab: true, stock: { ok: true, levels: [{ code: "Glucose reagent", display: "Glucose reagent", location: "Laboratory", level: 4, unit: "kit" }], expiring: [] } } });
  assert.match(html, /Reagents and consumables/);
  assert.ok(!html.includes('id="wStkLoc"') && !html.includes('id="wRecCode"') && !html.includes('id="wFefoCode"'));
  assert.ok(html.includes('id="wStkBatch"') && html.includes('id="wStkExpiry"'), "lot and expiry are recorded on a receipt");
  const pharm = W._render({ ...W._st, view: "inventory", inventory: { stock: { ok: true, levels: [], expiring: [] } } });
  assert.ok(pharm.includes('id="wStkLoc"') && pharm.includes('id="wRecCode"'), "the pharmacy's inventory is unchanged");
});

test("Admin > Laboratory analysers: loading, a failed read, not connected said plainly, and the key shown once", () => {
  const src = readFileSync(fileURLToPath(new URL("../wardsynq/site/pages/lab-analysers.js", import.meta.url)), "utf8");
  const sb = { WSQ: {}, document: { getElementById: () => null } };
  sb.window = sb; vm.createContext(sb); vm.runInContext(src, sb);
  const html = sb.WSQ._labAnalysersHtml;
  const c = { esc: (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])) };
  assert.match(html(c, null), /Loading the analysers/);
  assert.match(html(c, { failed: true, message: "nope" }), /not the same as there being none/);
  const none = html(c, { ok: true, keyConfigured: true, connector: { issued: false }, analysers: [] });
  assert.match(none, /Not connected: no connector key has been issued/);
  assert.match(none, /Issue the connector key/);
  const listed = html(c, { ok: true, keyConfigured: true, connector: { issued: true, keySetAt: "2026-09-16" }, analysers: [{ id: "an-chem1", ref: "chem1", name: "Chemistry 1", protocol: "hl7", transport: "tcp-client", host: "10.0.0.5", port: 5100, active: true, testMap: [{ instrumentCode: "K", testName: "Potassium" }] }] });
  assert.match(listed, /HL7 v2/); assert.match(listed, /10\.0\.0\.5:5100/); assert.ok(!/Not connected/.test(listed));
});
