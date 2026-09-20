/* test/scribe-speaker.test.mjs — Doctor/Patient speaker labelling (scribe-speaker.js).
 * node --test test/scribe-speaker.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("../scribe-speaker.js");

test("text-only path: question -> doctor, first-person answer -> patient", () => {
  const { turns } = S.label("How long have you had this fever? I have had fever for three days. Any cough? No cough.");
  assert.equal(turns.length, 4);
  assert.equal(turns[0].speaker, "doctor");
  assert.ok(turns[0].confidence >= 0.55);
  assert.match(turns[0].reasons.join(","), /wording/);
  assert.equal(turns[1].speaker, "patient");
  assert.match(turns[1].text, /three days/);
  assert.equal(turns[2].speaker, "doctor");
  assert.equal(turns[3].speaker, "patient");
});

test("acoustic path: two-cluster energy/pitch features label even a wording-ambiguous turn", () => {
  const segments = [
    { text: "How long have you had this cough?", energy: 0.85, pitch: 150 },
    { text: "I have had it for five days.", energy: 0.25, pitch: 210 },
    { text: "Any fever with it?", energy: 0.82, pitch: 145 },
    { text: "It comes and goes.", energy: 0.22, pitch: 205 } // no wording cue -> must rely on acoustic cluster
  ];
  const { turns } = S.label(segments);
  assert.equal(turns[0].speaker, "doctor");
  assert.equal(turns[1].speaker, "patient");
  assert.equal(turns[2].speaker, "doctor");
  assert.equal(turns[3].speaker, "patient"); // acoustic cluster carried it, no wording cue present
  assert.match(turns[3].reasons.join(","), /acoustic_cluster/);
  assert.equal(turns[3].manual, undefined);
});

test("ambiguous wording with no acoustic features stays unknown, low confidence", () => {
  const { turns } = S.label("Blood pressure one forty over ninety.");
  assert.equal(turns[0].speaker, "unknown");
  assert.ok(turns[0].confidence < 0.55);
});

test("acoustic clusters with zero wording cues anywhere cannot be assigned an identity", () => {
  const segments = [
    { text: "Blood pressure one forty over ninety.", energy: 0.9, pitch: 100 },
    { text: "Temperature ninety nine point two.", energy: 0.9, pitch: 100 },
    { text: "Weight sixty two kilograms.", energy: 0.2, pitch: 220 },
    { text: "Height one seventy centimeters.", energy: 0.2, pitch: 220 }
  ];
  const { turns } = S.label(segments);
  turns.forEach((t) => assert.equal(t.speaker, "unknown"));
});

test("relabel marks manual:true, is pure, and survives a later relabel pass on another turn", () => {
  const original = S.label("Any fever? I have fever.").turns;
  const afterFirst = S.relabel(original, 0, "patient");
  assert.equal(afterFirst[0].speaker, "patient");
  assert.equal(afterFirst[0].manual, true);
  assert.equal(afterFirst[0].confidence, 1);
  assert.equal(original[0].manual, undefined, "relabel must not mutate the input array");

  const afterSecond = S.relabel(afterFirst, 1, "doctor");
  assert.equal(afterSecond[0].speaker, "patient");
  assert.equal(afterSecond[0].manual, true, "earlier manual override survives a later relabel pass");
  assert.equal(afterSecond[1].speaker, "doctor");
  assert.equal(afterSecond[1].manual, true);
});

test("summary counts turns by speaker", () => {
  const counts = S.summary([
    { speaker: "doctor" }, { speaker: "doctor" }, { speaker: "patient" }, { speaker: "unknown" }
  ]);
  assert.deepEqual(counts, { doctor: 2, patient: 1, unknown: 1 });
});
