/* Cultures and histopathology on the laboratory board and the chart (P1.9). */
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
const empty = { specimens: [], pending: [], criticals: [], errors: [], cultures: [], histopathology: [] };

test("lab board: cultures in progress, culture and histopathology entry, and addendum on a signed report", () => {
  const W = loadWard();
  const none = W._render({ ...W._st, view: "labboard", labBoard: empty });
  assert.match(none, /No cultures in progress/);
  const html = W._render({ ...W._st, view: "labboard", labBoard: { ...empty,
    pending: [{ serviceRequestId: "sr9", display: "Tissue", patientId: "p1" }],
    cultures: [{ reportId: "wsq-micro-sr1", serviceRequestId: "sr1", patientId: "p1", panel: "Blood culture", stage: "growth-detected", status: "preliminary", critical: true, specimen: { type: "Blood" } }],
    histopathology: [{ reportId: "wsq-histo-sr2", patientId: "p1", panel: "Appendix", status: "final", diagnosis: "Acute appendicitis" }],
  }, cultureFor: { serviceRequestId: "sr1", display: "Blood culture", existing: null }, histoFor: { serviceRequestId: "sr9", display: "Tissue" } });
  assert.match(html, /Cultures in progress &middot; 1/);
  assert.match(html, /Growth detected/);
  assert.ok(html.includes('data-w-act="cultureopen:sr1"'));
  assert.ok(html.includes('data-w-act="cultureopen:sr9"') && html.includes('data-w-act="histoopen:sr9"'));
  assert.ok(html.includes('data-w-act="histoaddendum:wsq-histo-sr2"'));
  assert.match(html, /<option value="" selected>Not tested<\/option>/, "an antibiotic starts as not tested, never S");
  assert.ok(html.includes('id="wHpDx"') && html.includes('value="final">Sign (final)'));
});

test("chart: loading, failed and empty are different sentences; untested is 'not tested'; preliminary is marked; resistant antibiotic flagged", () => {
  const W = loadWard();
  const loading = W._pathologyCard({ pathology: null });
  const failed = W._pathologyCard({ pathology: false });
  const nothing = W._pathologyCard({ pathology: { ok: true, cultures: [], histopathology: [], antibioticOrders: [] } });
  assert.match(loading, /Loading cultures and histopathology/);
  assert.match(failed, /could not be loaded\. Do not read this as none/);
  assert.match(nothing, /No cultures or histopathology reports for this patient/);
  assert.notEqual(loading, failed); assert.notEqual(failed, nothing);

  const html = W._pathologyCard({ pathology: { ok: true,
    cultures: [{ reportId: "c1", panel: "Blood culture", status: "preliminary", stage: "identification", specimen: { type: "Blood", site: "Left arm" }, critical: true,
      organisms: [
        { name: "E. coli", breakpointStandard: "EUCAST v14", susceptibilities: [{ antibiotic: "Amoxicillin", result: "R", mic: ">=32", micUnit: "mg/L" }, { antibiotic: "Meropenem", result: "S" }] },
        { name: "K. pneumoniae", breakpointStandard: null, susceptibilities: [{ antibiotic: "Amoxicillin", result: "R" }] },
      ] }],
    histopathology: [{ reportId: "h1", panel: "Appendix", status: "final", diagnosis: "Acute appendicitis", addenda: [{ text: "Pinworm seen", by: "lab2", at: "2026-09-07T10:00:00Z" }] }],
    antibioticOrders: [{ orderId: "m1", drug: "Amoxicillin 500mg", antibiotic: "Amoxicillin", flag: "reported resistant - review", resistant: [{ organism: "E. coli", preliminary: true }] }],
  } });
  assert.match(html, /PRELIMINARY/);
  assert.match(html, /<td><i>not tested<\/i><\/td>/, "K. pneumoniae was not tested against meropenem");
  assert.equal((html.match(/<td><b>S<\/b>/g) || []).length, 1, "only the one reported S is shown as S");
  assert.match(html, /Breakpoints: EUCAST v14/);
  assert.match(html, /breakpoint standard not reported/);
  assert.match(html, /reported resistant - review/);
  assert.match(html, /Addendum/);
  assert.match(W._pathologyCard({ pathology: { ok: true, cultures: [{ reportId: "c2", panel: "Urine", status: "final", stage: "final", organisms: [] }], histopathology: [], antibioticOrders: null } }),
    /could not be read, so no antibiotic review was done/);
});
