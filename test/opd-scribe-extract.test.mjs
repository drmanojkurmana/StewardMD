import { test } from "node:test"; import assert from "node:assert/strict";
import { scribeExtractPrompt, sanitizeScribeOutput } from "../functions/api/ai/_opd-scribe.js";
test("whitelist: only emrFields + suggestions{provisionalDx,ddx,investigations}; drops injected keys", () => {
  const o = sanitizeScribeOutput({ emrFields:{ cc:"fever x3d", Temp:"101", vitals:{x:1} },
    suggestions:{ provisionalDx:"viral fever", ddx:["dengue","enteric fever"], investigations:["CBC","NS1"], drug:"metformin" },
    foo:"bar" });
  assert.deepEqual(Object.keys(o).sort(), ["emrFields","suggestions"]);
  assert.equal(o.emrFields.cc, "fever x3d");
  assert.equal("Temp" in o.emrFields, false);             // vital dropped — vitals are on-device only
  assert.equal("vitals" in o.emrFields, false);           // non-string dropped
  assert.equal(o.suggestions.provisionalDx, "viral fever");
  assert.deepEqual(o.suggestions.ddx, ["dengue","enteric fever"]);
  assert.deepEqual(o.suggestions.investigations, ["CBC","NS1"]);
  assert.equal("drug" in o.suggestions, false);
});
test("caps arrays + strings, drops empties, null-safe", () => {
  const o = sanitizeScribeOutput({ suggestions:{ ddx:Array(50).fill("x"), investigations:["", "  ", "CBC"] } });
  assert.ok(o.suggestions.ddx.length <= 12); assert.deepEqual(o.suggestions.investigations, ["CBC"]);
  assert.deepEqual(sanitizeScribeOutput(null), { emrFields:{}, suggestions:{ ddx:[], investigations:[] } });
});
test("prompt carries the hard safety rules", () => {
  const p = scribeExtractPrompt("patient with fever");
  assert.match(p, /never invent/i); assert.match(p, /provisional.*only if.*stated/i);
  assert.match(p, /patient-reported/i); assert.match(p, /=== TRANSCRIPT ===\npatient with fever$/);
});
