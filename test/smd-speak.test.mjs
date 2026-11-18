/* smd-speak.js: the app's one voice. Phonon 31M (PREP_VOICE) when ready, the system voice until then, never waiting.
 * node --test test/smd-speak.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const P = createRequire(import.meta.url)("../smd-speak.js");

test("chunks: sentences, markdown stripped, long ones split at a space", () => {
  assert.deepEqual(P.chunks("**pH** first. Then PaCO2!"), ["pH first.", "Then PaCO2!"]);
  assert.deepEqual(P.chunks(""), []);
  const long = P.chunks("word ".repeat(120), 100);
  assert.ok(long.length > 1 && long.every((c) => c.length <= 100));
});

function boot(voice) {
  const said = [], sys = [];
  const G = {
    document: { querySelector: () => ({}), createElement: () => ({}), head: { appendChild() {} } },
    PREP_VOICE: voice,
    speechSynthesis: { speak(u) { sys.push(u.text); setTimeout(() => u.onend && u.onend(), 0); }, cancel() {} },
    SpeechSynthesisUtterance: function (t) { this.text = t; }
  };
  new Function("window", read("smd-speak.js"))(G);
  return { S: G.SMD_SPEAK, said, sys };
}
const phonon = (ready, said, opts = {}) => ({ available: () => true, usable: () => ready, saved: () => true, init: () => Promise.resolve(ready), download: () => Promise.resolve(), unlock() {}, stop() {}, prefetch() {},
  say: (t) => { if (opts.fail) return Promise.reject(new Error("audio")); said.push(t); return Promise.resolve(); } });

test("Phonon speaks when it is ready", async () => {
  const said = [];
  const { S, sys } = boot(phonon(true, said));
  await S.say("One. Two.");
  assert.deepEqual(said, ["One.", "Two."]);
  assert.deepEqual(sys, []);
  assert.equal(S.engine(), "phonon");
});

test("until Phonon is ready the system voice speaks at once (no waiting)", async () => {
  const said = [];
  const { S, sys } = boot(phonon(false, said));
  await S.say("Hello there.");
  assert.deepEqual(said, []);
  assert.deepEqual(sys, ["Hello there."]);
  assert.equal(S.engine(), "system");
});

test("a sentence Phonon fails on is read by the system voice", async () => {
  const { S, sys } = boot(phonon(true, [], { fail: true }));
  await S.say("Fallback please.");
  assert.deepEqual(sys, ["Fallback please."]);
});

test("stop ends speech: speaking() is false and later sentences are dropped", async () => {
  const said = [];
  const { S } = boot(phonon(true, said));
  const p = S.say("A. B. C.");
  S.stop();
  await p;
  assert.equal(S.speaking(), false);
  assert.ok(said.length <= 1);
});

test("wiring: PrepReels, CliniX and FundX speak through SMD_SPEAK; Code Blue keeps its instant system voice", () => {
  assert.match(read("index.html"), /<script src="\/smd-speak\.js\?v=[^"]+" defer><\/script>/);
  assert.match(read("prep-medigram.js"), /G\.SMD_SPEAK\.say\(/);
  assert.doesNotMatch(read("prep-medigram.js"), /speechSynthesis/);
  assert.match(read("clinix-screens.js"), /SP\.say\(fullTxt/);
  assert.match(read("fundx.js"), /window\.SMD_SPEAK\.say\(text/);
  assert.match(read("prep-voice.js"), /if \(G\.PREP_VOICE\) return;/, "a second copy of prep-voice.js never replaces the loaded model");
  assert.doesNotMatch(read("codeblue-audio.js"), /SMD_SPEAK/);
});
