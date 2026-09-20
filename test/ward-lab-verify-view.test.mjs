/* Laboratory board: the verification queue and the entry form's range and correction fields. */
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
const empty = { specimens: [], pending: [], criticals: [], errors: [] };

test("verification queue: reasons shown, own entries cannot be verified, unread values block Verify, and loading is not an empty board", () => {
  const W = loadWard();
  const loading = W._render({ ...W._st, view: "labboard", labBoard: null });
  assert.match(loading, /Loading the laboratory board/);
  assert.ok(!/No specimens awaiting collection/.test(loading));
  const html = W._render({ ...W._st, view: "labboard", labBoard: { ...empty, toVerify: [
    { reportId: "dr1", patientId: "p1", panel: "Renal profile", releasedBy: "lab1", observations: [{ display: "Potassium", value: 7.4, unit: "mmol/L", autoVerified: false, deltaBreach: { state: "breach" }, critical: false, referenceRange: { text: "3.5-5.1" } }] },
    { reportId: "dr2", patientId: "p1", panel: "Sodium", releasedBy: "me", mine: true, observations: [{ display: "Sodium", value: 138, autoVerified: false }] },
    { reportId: "dr3", patientId: "p1", panel: "LFT", releasedBy: "lab1", unreadObservations: 1, observations: [] },
  ] } });
  assert.match(html, /Awaiting verification/);
  assert.match(html, /changed more than expected since the last result/);
  assert.match(html, /range 3\.5-5\.1/);
  assert.ok(html.includes('data-w-act="labverify:dr1"'));
  assert.ok(!html.includes('data-w-act="labverify:dr2"'), "your own entry cannot be verified by you");
  assert.ok(!html.includes('data-w-act="labverify:dr3"'), "a result with unread values cannot be verified");
  assert.match(html, /Do not verify until they load/);
});

test("the entry form offers a reference range per row and a Corrected status", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "labboard", labBoard: empty, labResultFor: { serviceRequestId: "sr1", display: "Renal profile" } });
  assert.ok(html.includes('id="wLrRange0"'));
  assert.match(html, /value="corrected"/);
});
