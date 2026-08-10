/* test/opd-voice.test.mjs — voice engine -> opd-emr assessment field mapping (_voiceMerge).
 * Verifies SMD_AMBIENT updates fold into opd-emr's assessVals under the RIGHT GHIS field names,
 * with correct value coercion (check->true/false, yesno->Y/N), that engine findings opd-emr can't
 * save are dropped (never guessed), that a doctor-edited field is never overwritten, and that
 * map-gated updates (applied:false, e.g. patient-reported) are skipped. node --test test/opd-voice.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const OPD = require("../opd-emr.js");
const { _voiceMerge, VOICE_MAP } = OPD;

// shape an SMD_EMRMAP-style update
const u = (field, value, applied = true) => ({ field, value, applied });

test("maps engine field ids to opd-emr GHIS names + coerces values", () => {
  const r = _voiceMerge({}, {}, [
    u("bpSys", 100), u("bpDia", 60), u("pulse", 88), u("temp", 101),
    u("tenderness", "No"), u("pallor", false), u("oedema", true),
    u("cardiacSounds", "S1 S2 heard, normal"), u("provisionalDx", "viral fever")
  ]);
  assert.equal(r.vals.BP_SYS, "100");
  assert.equal(r.vals.BP_dia, "60");
  assert.equal(r.vals.Pulse, "88");
  assert.equal(r.vals.Temp, "101");
  assert.equal(r.vals.tenderness_yesNo, "N", "yesno coerced to N");
  assert.equal(r.vals.pallor, "false", "check coerced to false string");
  assert.equal(r.vals.Oedema, "true", "check coerced to true string");
  assert.equal(r.vals.cardiac_sound, "S1 S2 heard, normal");
  assert.equal(r.vals.provisional_diagnosis, "viral fever");
  assert.ok(r.filled.includes("BP_SYS") && r.filled.includes("tenderness_yesNo"));
});

test("engine findings opd-emr can't save are DROPPED, never guessed", () => {
  // loc/orientation/murmurs/breathSounds/abdoShape are omitted from opd-emr's ASSESS_SCHEMA
  const r = _voiceMerge({}, {}, [u("loc", "Conscious"), u("murmurs", "No"), u("breathSounds", "Vesicular"), u("temp", 99)]);
  assert.deepEqual(r.dropped.sort(), ["breathSounds", "loc", "murmurs"]);
  assert.equal(r.vals.Temp, "99");                 // the one mappable field still lands
  assert.equal(Object.keys(VOICE_MAP).includes("loc"), false, "loc intentionally unmapped");
});

test("doctor-edited field is never overwritten (conflict surfaced)", () => {
  const r = _voiceMerge({ BP_SYS: "130" }, { BP_SYS: true }, [u("bpSys", 100), u("bpDia", 60)]);
  assert.equal(r.vals.BP_SYS, "130", "manual value preserved");
  assert.equal(r.vals.BP_dia, "60", "untouched field still fills");
  assert.deepEqual(r.conflicts, [{ name: "BP_SYS", incoming: 100 }]);
});

test("map-gated updates (applied:false) are skipped", () => {
  const r = _voiceMerge({}, {}, [u("bpSys", 150, false)]);   // e.g. patient-reported, dropped upstream
  assert.equal(r.vals.BP_SYS, undefined);
  assert.equal(r.filled.length, 0);
});

test("assess tab renders the voice bar when the engine is present, with merged values", () => {
  globalThis.SMD_AMBIENT = {};   // opd-emr binds G=globalThis in Node; voiceBar reads it at render time
  try {
    const merged = _voiceMerge({}, {}, [u("temp", 101), u("tenderness", "No")]).vals;
    const html = OPD._render({ tab: "assess", writeOn: true, assessLoaded: true, patient: { mrn: "MR9" }, assessVals: merged });
    assert.match(html, /oe-voicebar/, "voice bar rendered");
    assert.match(html, /data-oe-act="voice-toggle"/, "mic toggle present");
    assert.match(html, /data-oe-act="assess-save"/, "GHIS save bar still present");
    assert.match(html, /value="101"/, "voice-filled temperature shows in the box");
  } finally { delete globalThis.SMD_AMBIENT; }
});
