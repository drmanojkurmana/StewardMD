/* test/voice-no-silent-failure.test.mjs — THE CLASS, not one instance.
 *
 * Every voice/dictation bug reported so far has been the same shape: an error path that returns
 * quietly, so a denied mic, a dead engine, a dropped connection and "it worked but found nothing"
 * all look identical to the doctor — the UI just goes back to idle. Reported twice as "not working".
 *
 * Two guards, both repo-wide, so a NEW call site inherits them instead of repeating the bug:
 *   1. CONTRACT — a caller may only pass callbacks the engine actually fires. (The Rx Dictate bug:
 *      prescription.js passed `onEnd`, which voice.js never calls, so the mic never reset.)
 *   2. VOICE — a doctor-initiated finish must never fail silently. No empty catch blocks on the
 *      dictation paths; every early return on the finish path must report.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

const VOICE = read("voice.js");
const AMBIENT = read("voice-ambient.js");
const OPD = read("opd-emr.js");
const RX = read("prescription.js");

// Options each engine actually reads. Anything a caller passes that is not here is dead on arrival.
const optionsRead = (src) => new Set([...src.matchAll(/\bopts\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
// Callback-ish keys a call site passes: `onFoo:` inside an object literal.
const callbacksPassed = (src, fnName) => {
  const out = new Set();
  const re = new RegExp(fnName.replace(".", "\\.") + "\\(\\{", "g");
  for (const m of src.matchAll(re)) {
    // Walk the object literal from the opening brace, brace-balanced.
    let i = m.index + m[0].length - 1, depth = 0, end = i;
    for (; end < src.length; end++) {
      if (src[end] === "{") depth++;
      else if (src[end] === "}") { depth--; if (!depth) break; }
    }
    for (const k of src.slice(i, end).matchAll(/(?:^|[{,\s])(on[A-Z]\w*)\s*:/g)) out.add(k[1]);
  }
  return out;
};

test("CONTRACT: every callback passed to SMD_VOICE.listen is one voice.js fires", () => {
  const supported = optionsRead(VOICE);
  for (const [file, src] of [["prescription.js", RX], ["opd-emr.js", OPD]]) {
    for (const cb of callbacksPassed(src, "SMD_VOICE.listen")) {
      assert.ok(supported.has(cb), `${file} passes ${cb}, which voice.js never calls (this is the Rx Dictate bug)`);
    }
  }
});

test("CONTRACT: every callback passed to SMD_AMBIENT.start is one voice-ambient.js fires", () => {
  const supported = optionsRead(AMBIENT);
  for (const cb of callbacksPassed(OPD, "SMD_AMBIENT.start")) {
    assert.ok(supported.has(cb), `opd-emr.js passes ${cb}, which voice-ambient.js never calls`);
  }
});

test("VOICE: the scribe's refine path has no empty catch", () => {
  const refine = OPD.slice(OPD.indexOf("function doRefine"), OPD.indexOf("function _applyRefine"));
  assert.ok(refine.length > 0, "found doRefine");
  assert.equal(/\.catch\(\s*function\s*\(\s*\w*\s*\)\s*\{\s*\}\s*\)/.test(refine), false,
    "an empty catch here means a dropped connection looks exactly like a Stop that found nothing");
});

test("VOICE: every failure a doctor-initiated Stop/Pause can hit reports", () => {
  const refine = OPD.slice(OPD.indexOf("function doRefine"), OPD.indexOf("function _applyRefine"));
  assert.match(refine, /Nothing was transcribed/, "empty transcript is explained");
  assert.match(refine, /_finishPending/, "failures are gated on a doctor-initiated finish, not background ticks");
  assert.match(refine, /Could not draft the note/, "an AI error is explained");
  assert.match(refine, /Could not reach MaiK/, "a network failure is explained");
});

test("VOICE: stopping with nothing captured says so instead of returning to idle", () => {
  const stop = OPD.slice(OPD.indexOf("function stopVoice"), OPD.indexOf("function scribeAccept"));
  assert.match(stop, /Nothing was captured/, "the literal 'pressed Stop and nothing showed up' report");
  assert.match(stop, /_finishPending = willProcess/, "covers the flush path, whose refine lands later");
});

test("VOICE: the finish flag always clears, so ticks stay quiet afterwards", () => {
  assert.match(OPD, /function finishProcessing\(\)[^\n]*_finishPending = false/,
    "a stuck flag would make every later background hiccup nag the doctor");
});

test("VOICE: Rx Dictate reports every error code voice.js can emit", () => {
  [...VOICE.matchAll(/onError\(["']([a-z-]+)["']\)/g)].map((m) => m[1])
    .forEach((c) => assert.ok(RX.includes('"' + c + '"'), "prescription.js has no message for: " + c));
});
