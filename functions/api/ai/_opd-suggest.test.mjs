// functions/api/ai/_opd-suggest.test.mjs — OPD Ask MaiK Pro-tier LLM output whitelisting.
// The sanitizer is the safety boundary: whatever the model returns, only bounded plain-text
// strings in the fixed shape may reach the app. node --test functions/api/ai/_opd-suggest.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { opdSuggestPrompt, sanitizeOpdSuggest } from "./_opd-suggest.js";

test("prompt embeds the assessment and forbids invention", () => {
  const p = opdSuggestPrompt("Chief complaint: chest pain");
  assert.match(p, /Chief complaint: chest pain/);
  assert.match(p, /NEVER invent/i);
  assert.match(p, /ONLY the JSON/i);
});

test("sanitize: keeps the fixed shape, coerces string ddx, caps counts + lengths", () => {
  const out = sanitizeOpdSuggest({
    provisionalDx: "Acute coronary syndrome",
    ddx: [{ dx: "Aortic dissection", why: "tearing pain to back" }, "Pulmonary embolism", { name: "GERD" }, ...Array(10).fill({ dx: "x" })],
    investigations: ["ECG", "Troponin", ...Array(20).fill("filler")],
    treatment: ["Aspirin 300 mg PO stat"],
    redFlags: ["STEMI needs reperfusion"]
  });
  assert.equal(out.provisionalDx, "Acute coronary syndrome");
  assert.ok(out.ddx.length <= 6, "ddx capped at 6");
  assert.deepEqual(out.ddx[0], { dx: "Aortic dissection", why: "tearing pain to back" });
  assert.deepEqual(out.ddx[1], { dx: "Pulmonary embolism", why: "" }, "string ddx coerced to {dx,why}");
  assert.equal(out.ddx[2].dx, "GERD", "name -> dx");
  assert.ok(out.investigations.length <= 10, "investigations capped at 10");
  assert.ok(out.investigations.includes("ECG"));
  assert.deepEqual(out.treatment, ["Aspirin 300 mg PO stat"]);
  assert.deepEqual(out.redFlags, ["STEMI needs reperfusion"]);
});

test("sanitize: junk / non-object / extra keys -> safe empty shape, no leakage", () => {
  assert.deepEqual(sanitizeOpdSuggest(null), { provisionalDx: "", ddx: [], investigations: [], treatment: [], redFlags: [] });
  assert.deepEqual(sanitizeOpdSuggest("a string"), { provisionalDx: "", ddx: [], investigations: [], treatment: [], redFlags: [] });
  // extra/injected keys are dropped; only the whitelisted fields survive
  const out = sanitizeOpdSuggest({ provisionalDx: "X", evilScript: "<script>", orders: [{ auto: true }], ddx: null });
  assert.deepEqual(Object.keys(out).sort(), ["ddx", "investigations", "provisionalDx", "redFlags", "treatment"]);
  assert.equal(out.provisionalDx, "X");
  assert.deepEqual(out.ddx, []);
  assert.equal(out.evilScript, undefined);
  assert.equal(out.orders, undefined);
});

test("sanitize: a very long field is truncated (bounded)", () => {
  const out = sanitizeOpdSuggest({ provisionalDx: "d".repeat(5000), treatment: ["t".repeat(5000)] });
  assert.ok(out.provisionalDx.length <= 300);
  assert.ok(out.treatment[0].length <= 240);
});
