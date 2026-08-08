// test/opd-emr-write.test.mjs — OPD write-back (P2/P3/P4).
// 1) parseSearchRows (PURE server helper) maps the varied GHIS key shapes to {id,name} and drops empties.
// 2) client render (window.OPDEMR._render, PURE) hides SUBMIT buttons when the write flag is off, shows them on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSearchRows } from "../functions/api/ghis/[[path]].js";

// ---- server: parseSearchRows -------------------------------------------------------------
test("parseSearchRows maps varied id/name key shapes to {id,name}", () => {
  assert.deepEqual(parseSearchRows([{ Id: "LAB1", Text: "CBC" }]), [{ id: "LAB1", name: "CBC" }]);
  assert.deepEqual(parseSearchRows([{ id: "D1", label: "Amoxicillin" }]), [{ id: "D1", name: "Amoxicillin" }]);
  assert.deepEqual(parseSearchRows([{ value: "V1", name: "Foo" }]), [{ id: "V1", name: "Foo" }]);
  assert.deepEqual(parseSearchRows([{ ServiceId: "S1", DisplayText: "Bar" }]), [{ id: "S1", name: "Bar" }]);
});

test("parseSearchRows handles the REAL GHIS shape (FilterServices + FilterDrugs, verified 2026-08-07)", () => {
  // service: no basic_material_desc -> {id,name}; drug: basic_material_desc present -> +sub (generic).
  assert.deepEqual(
    parseSearchRows([{ material_service_sp_id: "LAB1118", material_desc: "Complete blood count", basic_material_desc: null }]),
    [{ id: "LAB1118", name: "Complete blood count" }]);
  assert.deepEqual(
    parseSearchRows([{ material_service_sp_id: "P0110", material_desc: "CALPOL 650MG TAB", basic_material_desc: "PARACETAMOL-650MG TABLET" }]),
    [{ id: "P0110", name: "CALPOL 650MG TAB", sub: "PARACETAMOL-650MG TABLET" }]);
});

test("parseSearchRows drops rows missing id or name, and tolerates strings / non-arrays", () => {
  const out = parseSearchRows([{ Id: "", Text: "x" }, { Id: "y", Text: "" }, { Text: "noId" }, null, "str", { Id: "z", Text: "Keep" }]);
  assert.deepEqual(out, [{ id: "z", name: "Keep" }]);
  assert.deepEqual(parseSearchRows('[{"Id":"A","Text":"B"}]'), [{ id: "A", name: "B" }]);   // JSON string
  assert.deepEqual(parseSearchRows({ data: [{ Id: "A", Text: "B" }] }), [{ id: "A", name: "B" }]); // {data:[...]}
  assert.deepEqual(parseSearchRows(null), []);
  assert.deepEqual(parseSearchRows("not json"), []);
});

// ---- client: write-button gating ---------------------------------------------------------
const SRC = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
function load() {
  const win = {};
  const doc = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }), body: { appendChild() {} } };
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "" }, { getItem: () => null, setItem: () => {} });
  return win.OPDEMR;
}
const NO_EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
const base = { patient: { name: "Asha", mrn: "MR1" }, labs: [], radiology: [], medications: [] };
const withTab = (o) => Object.assign({}, base, o);

test("write buttons ABSENT when smd_opd_emr_write is off (note shown instead)", () => {
  const OE = load();
  const inv = OE._render(withTab({ tab: "inv", writeOn: false, invDraft: { service: { id: "LAB1", name: "CBC" } } }));
  assert.doesNotMatch(inv, /data-oe-act="inv-order"/);
  assert.match(inv, /being set up/);
  const meds = OE._render(withTab({ tab: "meds", writeOn: false, medDraft: { drug: { id: "D1", name: "Amoxicillin" } } }));
  assert.doesNotMatch(meds, /data-oe-act="med-rx"/);
  const assess = OE._render(withTab({ tab: "assess", writeOn: false, assessLoaded: true, assessFields: [{ name: "cc", label: "Chief Complaint", value: "", kind: "input" }] }));
  assert.doesNotMatch(assess, /data-oe-act="assess-save"/);
});

test("write buttons PRESENT when smd_opd_emr_write is on", () => {
  const OE = load();
  const inv = OE._render(withTab({ tab: "inv", writeOn: true, invDraft: { service: { id: "LAB1", name: "CBC" }, emergency: true } }));
  assert.match(inv, /data-oe-act="inv-order"/);
  const meds = OE._render(withTab({ tab: "meds", writeOn: true, medDraft: { drug: { id: "D1", name: "Amoxicillin" } } }));
  assert.match(meds, /data-oe-act="med-rx"/);
  const assess = OE._render(withTab({ tab: "assess", writeOn: true, assessLoaded: true, assessFields: [{ name: "cc", label: "Chief Complaint", value: "x", kind: "input" }] }));
  assert.match(assess, /data-oe-act="assess-save"/);
});

// ---- assessment: full GHIS Initial Assessment schema form -------------------------------
test("assessment tab renders the full GHIS schema (sections + Temp + Diabetes yesno, no emoji)", () => {
  const OE = load();
  const html = OE._render(withTab({ tab: "assess", writeOn: true, assessLoaded: true, assessVals: {} }));
  assert.match(html, /Co-morbid/);                       // section titles present
  assert.match(html, /vital parameters/i);
  assert.match(html, /Provisional/);
  assert.match(html, /data-oe-inp="assess:Temp"/);       // a vitals number field
  assert.match(html, /data-oe-inp="assess:Diabetes_yesNo"/);
  assert.match(html, /type="radio"[^>]*value="Y"/);      // yesno renders as radios
  assert.match(html, /data-oe-act="assess-save"/);       // save shown (writeOn)
  assert.ok(!NO_EMOJI.test(html), "assessment form must contain no emoji");
});

test("assessment payload builder emits every schema field (bare + val.*) as strings with defaults", () => {
  const OE = load();
  const p = OE._assessPayload({ Chief_complaints_duration: "fever x3d", Temp: "101", "val.investigation_desc": "CBC", Diabetes_yesNo: "Y", pallor: "true" });
  assert.equal(p.Chief_complaints_duration, "fever x3d");
  assert.equal(p.Temp, "101");
  assert.equal(p["val.investigation_desc"], "CBC");      // val.* prefix preserved (server keeps it)
  assert.equal(p.Diabetes_yesNo, "Y");
  assert.equal(p.pallor, "true");
  assert.equal(p.Hypertension_yesNo, "N");               // untouched yesno -> "N"
  assert.equal(p.icterus, "false");                      // untouched check -> "false"
  assert.equal(p.provisional_diagnosis, "");             // untouched text -> ""
  assert.ok(Object.prototype.hasOwnProperty.call(p, "management_plan"));
  assert.ok(Object.keys(p).length > 100, "full form has 100+ fields, not the old thin list");
});

test("investigation search results render as pickable rows; tabs + drafts contain no emoji", () => {
  const OE = load();
  const inv = OE._render(withTab({ tab: "inv", writeOn: true, invResults: [{ id: "LAB1118", name: "Complete Blood Count" }] }));
  assert.match(inv, /data-oe-act="inv-pick:0"/);
  assert.match(inv, /Complete Blood Count/);
  assert.match(inv, /oe-tabs/);                      // tab bar present
  assert.ok(!NO_EMOJI.test(inv), "render must contain no emoji");
});
