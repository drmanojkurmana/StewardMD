/* prep-voice.js pure helpers: the dictionary phonemes, spelling rules, numbers, token ids, and the shipped lexicon.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-voice.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const V = req("../prep-voice.js");
const lex = V.parseLex(fs.readFileSync(new URL("../prep/tts/lex-v1.txt", import.meta.url), "utf8"));

test("voice: ARPAbet becomes Kokoro phonemes with stress before the vowel", () => {
  assert.equal(V.arpaToPhones("HH AH0 L OW1"), "həlˈO");
  assert.equal(V.arpaToPhones("K AH0 M P Y UW1 T ER0"), "kəmpjˈutɚ");
  assert.equal(V.arpaToPhones("S IH2 N D ER1 EH2 L AH0"), "sˌɪndˈɜɹˌɛlə");
});

test("voice: numbers are read as words", () => {
  assert.deepEqual(V.numberWords("1500"), ["one", "thousand", "five", "hundred"]);
  assert.deepEqual(V.numberWords("1.5"), ["one", "point", "five"]);
  assert.deepEqual(V.numberWords("200"), ["two", "hundred"]);
  assert.deepEqual(V.numberWords("0.25"), ["zero", "point", "two", "five"]);
});

test("voice: British spellings reach their American dictionary words", () => {
  for (const [b, a] of [["tumours", "tumors"], ["anaemia", "anemia"], ["haemoglobin", "hemoglobin"], ["oedema", "edema"], ["leukaemia", "leukemia"], ["oesophageal", "esophageal"]]) assert.equal(V.americanize(b), a, b);
});

test("voice: acronyms are spelled, roman stage numbers are read as numbers, and a word the dictionary lacks is sounded out", () => {
  assert.equal(V.wordPhones("TMP", lex), "tˈi ˈɛm pˈi");
  assert.equal(V.wordPhones("III", lex), lex.three);
  assert.ok(V.wordPhones("atovaquone", lex).length > 6, "an unknown drug gets a pronunciation");
  assert.ok(/ˈ/.test(V.ruleG2P("pentamidine")), "and a stress mark");
});

test("voice: every phoneme the lexicon and the rules can produce is one Kokoro has an id for", () => {
  const bad = new Set();
  for (const w of Object.keys(lex)) for (const ch of lex[w]) if (V.VOCAB[ch] === undefined) bad.add(ch);
  for (const w of ["atovaquone", "pentamidine", "glomerulonephritis", "pathognomonic", "cytochrome", "immunosuppression", "xylophone", "knowledge", "wrist", "jaundice", "queue"]) for (const ch of V.ruleG2P(w)) if (V.VOCAB[ch] === undefined) bad.add(ch);
  assert.deepEqual([...bad], []);
});

test("voice: a sentence becomes padded token ids within the model's limit", () => {
  const ph = V.phonemize("Give one tablet by mouth every morning, then 200 milligrams.", lex);
  const ids = V.tokenIds(ph);
  assert.equal(ids[0], 0); assert.equal(ids[ids.length - 1], 0);
  assert.ok(ids.length > 20 && ids.length <= 402);
  assert.ok(!/\s{2,}/.test(ph) && !/^\s|\s$/.test(ph));
  assert.ok(V.tokenIds("a".repeat(900)).length <= 402, "a long run is cut, never over the limit");
});

test("voice: the lexicon covers the words the lessons narrate and stays small", () => {
  const size = fs.statSync(new URL("../prep/tts/lex-v1.txt", import.meta.url)).size;
  assert.ok(size < 600000, "lexicon " + size + " bytes");
  for (const w of ["the", "patient", "tumor", "tablet", "weekly", "one", "hundred", "thousand", "point", "doctor", "percent", "creatinine".slice(0, 0) || "kidney"]) assert.ok(lex[w], w + " is in the lexicon");
});

test("voice: pinned downloads name a revision, a size and a checksum", () => {
  assert.match(V.FILES.model.url, /\/resolve\/[0-9a-f]{40}\//);
  assert.equal(V.FILES.model.sha256.length, 64); assert.equal(V.FILES.voice.sha256.length, 64);
  assert.ok(V.FILES.model.bytes > 9e7 && V.FILES.model.bytes < 1e8);
});

test("voice: a rendered clip is a valid 16-bit mono WAV at 24 kHz", () => {
  const b = Buffer.from(V.wavBlob(Float32Array.from([0, 0.5, -0.5, 1, -1])));
  assert.equal(b.toString("ascii", 0, 4), "RIFF"); assert.equal(b.toString("ascii", 8, 12), "WAVE");
  assert.equal(b.readUInt32LE(24), 24000); assert.equal(b.readUInt16LE(34), 16); assert.equal(b.readUInt32LE(40), 10);
  assert.equal(b.readInt16LE(44 + 6), 32767); assert.equal(b.readInt16LE(44 + 8), -32768);
});
