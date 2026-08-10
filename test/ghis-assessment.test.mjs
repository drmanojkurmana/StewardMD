/* test/ghis-assessment.test.mjs — GHIS write-back helpers (functions/api/ghis/_assessment.js).
 * Verifies the route is FAIL-CLOSED until configured, builds the correct CSRF form body once a
 * map is supplied (incl. value translation + skipping unmapped fields), and that the discovery
 * parser pulls input names/types/labels/options from GHIS-style HTML.
 * node --test test/ghis-assessment.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAssessmentBody, parseFormInputs } from "../functions/api/ghis/_assessment.js";

test("FAIL-CLOSED: no savePath / empty map → refuses, never posts guessed fields", () => {
  const r1 = buildAssessmentBody({ temp: 101 }, { csrf: "C" });                       // no map, no path
  assert.equal(r1.ok, false);
  assert.equal(r1.error, "ghis_mapping_not_configured");
  const r2 = buildAssessmentBody({ temp: 101 }, { csrf: "C", map: {}, savePath: "/x" }); // path but empty map
  assert.equal(r2.ok, false);
});

test("configured map → correct body: CSRF, patient id, value translation, unmapped skipped", () => {
  const map = {
    __patientId: { name: "PatientId" },
    temp: { name: "txtTemp" },
    tenderness: { name: "rdoTend", map: { Yes: "1", No: "0" } },
    pallor: { name: "chkPallor", map: { "true": "on", "false": "" } }
  };
  const r = buildAssessmentBody(
    { temp: 101, tenderness: "No", pallor: false, spleen: "Palpable" },   // spleen is unmapped
    { csrf: "TOK", patientId: "MR9", map, savePath: "/Doctor/Home/SaveInitialAssessmentnew" }
  );
  assert.equal(r.ok, true);
  const p = new URLSearchParams(r.body);
  assert.equal(p.get("__RequestVerificationToken"), "TOK");
  assert.equal(p.get("PatientId"), "MR9");
  assert.equal(p.get("txtTemp"), "101");
  assert.equal(p.get("rdoTend"), "0", "enum translated to GHIS wire value");
  assert.equal(p.get("chkPallor"), null, "false→'' is dropped, not sent");
  assert.equal(p.has("spleen"), false, "unmapped field never posted");
});

test("discovery parser: extracts inputs / textarea / select+options / labels", () => {
  const html = `
    <label for="cc">Chief complaints</label><textarea name="txtCC" id="cc"></textarea>
    <input name="txtTemp" id="temp" type="text" value="">
    <label for="tendY">Tenderness</label>
    <input type="radio" name="rdoTend" id="tendY" value="1"> Yes
    <input type="radio" name="rdoTend" value="0"> No
    <select name="ddlMarital" id="mar"><option value="">Select</option><option value="1">Married</option></select>`;
  const inputs = parseFormInputs(html);
  const by = (n) => inputs.filter((x) => x.name === n);
  assert.equal(by("txtCC")[0].tag, "textarea");
  assert.equal(by("txtCC")[0].label, "Chief complaints");
  assert.equal(by("txtTemp")[0].type, "text");
  assert.equal(by("rdoTend").length, 2, "both radios captured");
  assert.equal(by("rdoTend")[0].label, "Tenderness");
  const sel = by("ddlMarital")[0];
  assert.equal(sel.tag, "select");
  assert.deepEqual(sel.options.map((o) => o.value), ["", "1"]);
  assert.equal(sel.options[1].label, "Married");
});
