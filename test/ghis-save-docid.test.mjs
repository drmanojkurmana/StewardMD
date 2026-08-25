/* test/ghis-save-docid.test.mjs — "Save to GHIS" must survive a visit that drifts out of activation.
 *
 * Reported: Save to GHIS, which used to work, now fails with
 *   "GHIS: no_active_assessment: form doc_id is 0 (visit not activated) — refusing to write a blank/d…"
 *
 * That refusal is CORRECT and must stay: a doc_id-0 form means GHIS handed back a blank record, and
 * posting it creates an orphan while the app cheerfully says "Saved". The bug is that the client had
 * the real record id all along — the prefill GET returns Initial_Assessment_doc_id — and threw it
 * away, so the save had no fallback when the server-side re-activation did not stick. The server has
 * always accepted body.docId for exactly this; nothing was sending it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const OPD = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
const GHIS = readFileSync(new URL("../functions/api/ghis/[[path]].js", import.meta.url), "utf8");

// Lift the two pure client helpers out of the IIFE and run them for real.
function helpers() {
  const grab = (name) => {
    const at = OPD.indexOf("function " + name + "(");
    assert.ok(at > 0, "found " + name);
    let i = OPD.indexOf("{", at), depth = 0, end = i;
    for (; end < OPD.length; end++) {
      if (OPD[end] === "{") depth++;
      else if (OPD[end] === "}") { depth--; if (!depth) break; }
    }
    return OPD.slice(at, end + 1);
  };
  return new Function("st", "emrLabel",
    grab("oeFieldValue") + grab("oeDocId") + grab("ghisSay") +
    "return { oeFieldValue: oeFieldValue, oeDocId: oeDocId, ghisSay: ghisSay };");
}

test("the prefill's record id is read out of the form payload", () => {
  const h = helpers()({}, () => "GHIS");
  const fields = [{ name: "patient_id", value: "MR26097363" }, { name: "Initial_Assessment_doc_id", value: "884211" }];
  assert.equal(h.oeFieldValue(fields, "Initial_Assessment_doc_id"), "884211");
  assert.equal(h.oeFieldValue(fields, "not_there"), "");
  assert.equal(h.oeFieldValue(null, "anything"), "", "a failed prefill must not throw");
});

test("a blank/0 record id is NEVER sent — the server's refusal must still fire", () => {
  const label = () => "GHIS";
  assert.equal(helpers()({ assessDocId: "0" }, label).oeDocId(), "", "0 means 'no real record', not an id");
  assert.equal(helpers()({ assessDocId: "" }, label).oeDocId(), "");
  assert.equal(helpers()({}, label).oeDocId(), "", "never loaded a form → no id to offer");
  assert.equal(helpers()({ assessDocId: "884211" }, label).oeDocId(), "884211", "a real id is offered as the fallback");
});

test("every assessment-save call sends the record id", () => {
  const calls = OPD.match(/postWrite\("\/assessment-save",[^)]*/g) || [];
  assert.ok(calls.length >= 3, "found the save call sites (" + calls.length + ")");
  // NB: the capture stops at the first ")" — which is oeDocId's own — so match the call, not "()".
  calls.forEach((c) => assert.match(c, /docId: oeDocId\(/, "a save without the id has no fallback: " + c.slice(0, 90)));
});

test("SERVER: the doc_id-0 refusal is still in force, and still honours a client id", () => {
  assert.match(GHIS, /no_active_assessment: form doc_id is 0/, "the orphan-write guard stays");
  assert.match(GHIS, /const clientDoc = \(body\.docId != null/, "…with the client fallback it was built to accept");
  assert.match(GHIS, /patient_mismatch: loaded form for/, "and the wrong-patient guard is untouched");
});

test("the doctor is told what to DO, not handed a machine code", () => {
  const h = helpers()({}, () => "GHIS");
  const msg = h.ghisSay("no_active_assessment: form doc_id is 0 (visit not activated) — refusing to write a blank/duplicate");
  assert.match(msg, /Reopen the patient/, "actionable");
  assert.match(msg, /nothing you typed is lost/, "and reassuring — the note is still on screen");
  assert.ok(!/doc_id/.test(msg), "no internal jargon");
  assert.match(h.ghisSay("patient_mismatch: loaded form for MR1, expected MR2"), /different patient/);
  assert.match(h.ghisSay("something novel"), /GHIS: something novel/, "unknown codes still surface for diagnosis");
  assert.match(h.ghisSay(""), /Could not complete/);
});
