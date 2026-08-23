/* test/maik-error-notice.test.mjs — when the on-device model cannot answer, SAY WHY.
 *
 * REPORTED 2026-08-24 (screenshot): MaiK MxCore selected, banner reading "On-device", and every
 * question answered in 0.1s with "MaiK is unavailable right now — the deterministic StewardMD engine,
 * calculators and reference tools remain available." No indication of what was wrong.
 *
 * The app KNEW. maik-engine.js localAnswer() maps any rejection to { error: <real message> }:
 *     .catch(function (err) { return { error: String((err && err.message) || err || "local-failed") }; });
 * and home.js discarded it with a catch-all `if (r && r.error)` that printed one opaque line - so an
 * actionable failure ("not enough memory, close some apps") was indistinguishable from any other.
 *
 * node --test test/maik-error-notice.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const HOME = readFileSync(new URL("../home.js", import.meta.url), "utf8");
const ENGINE = readFileSync(new URL("../maik-engine.js", import.meta.url), "utf8");

// Pull maikErrorNotice out of home.js (the file needs a browser to load in full).
function notice() {
  const i = HOME.indexOf("function maikErrorNotice(r)");
  assert.ok(i > -1, "maikErrorNotice must exist");
  const body = HOME.slice(i, HOME.indexOf("\n  }\n", i) + 4);
  const esc = 'function maikEscH(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}';
  return new Function(esc + "\n" + body + "\nreturn maikErrorNotice;")();
}
const N = notice();

test("the engine still preserves the real reason (the contract this depends on)", () => {
  assert.match(ENGINE, /catch\(function \(err\) \{ return \{ error: String\(\(err && err\.message\)/,
    "localAnswer must keep the message, not flatten it to a boolean");
});

test("REGRESSION: home.js no longer discards the reason", () => {
  assert.match(HOME, /if \(r && r\.error\) \{ think\.innerHTML = '<div class="maik-welcome">' \+ maikErrorNotice\(r\)/,
    "the catch-all must route through the explainer");
});

test("out of memory is named, with something the doctor can actually do", () => {
  const h = N({ error: "not-enough-memory:1204MB free, 2.5GB needed" });
  assert.match(h, /not enough free memory/i);
  assert.match(h, /1204MB free, 2\.5GB needed/, "the measured numbers are shown, not hidden");
  assert.match(h, /Close other apps/i, "actionable");
  assert.match(h, /MaiK Cloud/, "and an immediate way to get an answer anyway");
});

test("a missing runtime and a missing model give different advice", () => {
  const noRuntime = N({ error: "on-device inference needs the native app" });
  assert.match(noRuntime, /not available in this build/i);
  assert.match(noRuntime, /MaiK Cloud/);

  const noModel = N({ error: "unknown model pack" });
  assert.match(noModel, /not fully installed/i);
  assert.match(noModel, /finish installing/i);
  assert.notEqual(noRuntime, noModel, "different causes must not print the same line");
});

test("a cancelled answer is not reported as a failure", () => {
  assert.match(N({ error: "cancelled by user" }), /cancelled/i);
});

test("an unrecognised error still shows the reason instead of swallowing it", () => {
  const h = N({ error: "llama_decode returned -3" });
  assert.match(h, /MaiK is unavailable right now/, "the familiar line stays for the unknown case");
  assert.match(h, /Reason:/, "but the cause is no longer thrown away");
  assert.match(h, /llama_decode returned -3/);
});

test("the reason is escaped — an error string is never injected as markup", () => {
  const h = N({ error: '<img src=x onerror="alert(1)">' });
  assert.equal(/<img/.test(h), false, "must not emit a raw tag");
  assert.match(h, /&lt;img/);
});

test("no error means no notice text is fabricated", () => {
  const h = N({ error: "" });
  assert.match(h, /MaiK is unavailable right now/);
  assert.equal(/Reason:/.test(h), false, "nothing to report, so report nothing");
});
