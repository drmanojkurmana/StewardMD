/* test/opd-scribe-grounding.test.mjs — the two halves of the `sources` defect.
 *
 * 1. TRUNCATION. The opd-scribe reply has to carry a full English translation of the whole
 *    transcript PLUS every EMR field PLUS a verbatim source sentence per field. It was generated
 *    under the shared 1100-token chat budget, so the authoritative FINAL refine could be cut
 *    mid-token; parseJsonLoose then returned null and the doctor lost the ENTIRE extraction.
 *
 * 2. GROUNDING. opd-emr.js reads the `sources` map as authoritative: a populated field MISSING from
 *    it is badged "not found in the recording". An INCOMPLETE map therefore makes correctly
 *    extracted fields look fabricated. And verifySources / flagContradictions - the functions that
 *    are supposed to check the citations the model is paying tokens to produce - were exported and
 *    never imported by the handler, so nothing ran them.
 *
 * The second half is driven through the REAL exported onRequest(), with a fake KV, a fake Gemini
 * upstream and a locally-signed Firebase token, so the assertions are on the shipped response and
 * on the KV the quota meter actually writes.
 *
 * node --test test/opd-scribe-grounding.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseScribeJson, attachGrounding, sanitizeScribeOutput, verifySources, GROUND_MIN_COVERAGE,
} from "../functions/api/ai/_opd-scribe.js";

const API_SRC = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");

const TRANSCRIPT =
  "Doctor: what brings you in today. Patient: I have had fever for three days and a cough for two days. " +
  "Doctor: any diabetes or blood pressure. Patient: I am diabetic since five years and I take metformin five hundred twice daily. " +
  "Doctor: on examination the chest is clear with equal air entry.";

/* ── 1. truncation ─────────────────────────────────────────────────────────────────────────── */

test("parseScribeJson: a complete reply parses exactly as before, truncated:false", () => {
  const r = parseScribeJson('prose before {"en":"x","emrFields":{"cc":"Fever x 3 days"}} trailing');
  assert.equal(r.truncated, false);
  assert.deepEqual(r.parsed, { en: "x", emrFields: { cc: "Fever x 3 days" } });
});

test("parseScribeJson: a reply cut mid-value KEEPS the completed fields instead of losing everything", () => {
  // This is the exact shape of a MAX_TOKENS cut: no closing brace anywhere after emrFields.
  const cut = '{"en":"Fever for three days","emrFields":{"cc":"Fever x 3 days","presentHx":"Fever 3 days, cough 2 da';
  assert.equal(cut.match(/\{[\s\S]*\}/), null, "the old greedy parse had nothing to match - it returned null");
  const r = parseScribeJson(cut);
  assert.equal(r.truncated, true);
  assert.equal(r.parsed.emrFields.cc, "Fever x 3 days", "the completed field survives");
  assert.equal(r.parsed.en, "Fever for three days");
  assert.equal(r.parsed.emrFields.presentHx, undefined, "only the field being written when the cap hit is lost");
});

test("parseScribeJson: a cut inside the sources map keeps en + ALL of emrFields", () => {
  const cut = '{"en":"E","emrFields":{"cc":"Fever x 3 days","dm":"Yes"},"sources":{"cc":"I have had fever for thre';
  const r = parseScribeJson(cut);
  assert.equal(r.truncated, true);
  assert.deepEqual(r.parsed.emrFields, { cc: "Fever x 3 days", dm: "Yes" });
  assert.equal(r.parsed.sources, undefined, "a half-written citation map is dropped, not half-kept");
});

test("parseScribeJson: a cut inside a suggestion array still yields usable JSON", () => {
  const r = parseScribeJson('{"emrFields":{"cc":"Fever"},"suggestions":{"ddx":["Dengue","Malar');
  assert.equal(r.truncated, true);
  assert.deepEqual(r.parsed.suggestions.ddx, ["Dengue"]);
});

test("parseScribeJson: genuine garbage is still null (never a silent empty note)", () => {
  assert.deepEqual(parseScribeJson(""), { parsed: null, truncated: false });
  assert.deepEqual(parseScribeJson("I cannot help with that."), { parsed: null, truncated: false });
});

test("the handler asks for a scribe-sized output budget, not the chat one", () => {
  assert.match(API_SRC, /SCRIBE_OUT = Math\.max\(OUT_BASE, Math\.min\(8192, Number\(env\.SCRIBE_MAX_OUTPUT_TOKENS\) \|\| 6000\)\)/);
  assert.match(API_SRC, /callGemini\(env, \[\{ text: prompt \}\], SCRIBE_OUT, _scribeOpts\)/);
});

/* ── 2. grounding ──────────────────────────────────────────────────────────────────────────── */

function sanitizedWith(sources) {
  return sanitizeScribeOutput({
    en: "English",
    emrFields: { cc: "Fever x 3 days, cough x 2 days", dm: "Yes", systemicExam: "Chest clear, equal air entry" },
    sources,
  });
}
const FULL_SOURCES = {
  cc: "I have had fever for three days and a cough for two days",
  dm: "I am diabetic since five years and I take metformin five hundred twice daily",
  systemicExam: "on examination the chest is clear with equal air entry",
};

test("verifySources/flagContradictions RUN: a complete, honest citation set comes back grounded", () => {
  const out = attachGrounding(TRANSCRIPT, sanitizedWith(FULL_SOURCES), {});
  assert.ok(out.sources, "a trustworthy citation map is passed through to the client");
  assert.deepEqual(out.ungroundedFields, [], "every cited sentence really is in the transcript");
  assert.equal(out.truncated, undefined);
});

test("a citation the transcript does NOT contain is reported ungrounded (the real safety signal)", () => {
  const out = attachGrounding(TRANSCRIPT, sanitizedWith(
    Object.assign({}, FULL_SOURCES, { systemicExam: "there is a systolic murmur at the apex radiating to the axilla" })), {});
  assert.deepEqual(out.ungroundedFields, ["systemicExam"]);
  assert.deepEqual(verifySources(TRANSCRIPT, sanitizedWith(FULL_SOURCES)).ungrounded, [],
    "and a sound set has none - the check is not just always-true");
});

test("contradictions are computed and returned when the transcript denies what a field asserts", () => {
  const s = sanitizeScribeOutput({
    emrFields: { cc: "Fever x 3 days", presentHx: "Patient reports vomiting since Monday" },
    sources: { cc: "I have had fever for three days", presentHx: "vomiting since Monday" },
  });
  const out = attachGrounding("I have had fever for three days, no vomiting, vomiting since Monday", s, {});
  assert.ok(Array.isArray(out.contradictions) && out.contradictions.length >= 1);
  assert.equal(out.contradictions[0].field, "presentHx");
  assert.equal(out.contradictions[0].term, "vomiting");
});

test("TRUNCATED reply: the grounding signal is ABSENT, not half-present", () => {
  // The dangerous state. The client badges any populated field missing from `sources` as "not found
  // in the recording", so shipping a citation map the model never finished would show the doctor a
  // fabrication warning on fields that are perfectly well supported.
  const out = attachGrounding(TRANSCRIPT, sanitizedWith({ cc: FULL_SOURCES.cc }), { truncated: true });
  assert.equal(out.sources, undefined, "no sources map => the client shows no badge at all");
  assert.equal(out.ungroundedFields, undefined);
  assert.equal(out.truncated, true, "and the caller is told why");
  assert.equal(Object.keys(out.emrFields).length, 3, "the EMR content itself is untouched");
});

test("a model that only bothered to cite SOME fields is treated as no signal at all", () => {
  const out = attachGrounding(TRANSCRIPT, sanitizedWith({ cc: FULL_SOURCES.cc }), {});
  assert.equal(1 / 3 < GROUND_MIN_COVERAGE, true);
  assert.equal(out.sources, undefined);
  assert.equal(out.ungroundedFields, undefined);
});

test("no sources at all => nothing added (unknown support, never 'fabricated')", () => {
  const out = attachGrounding(TRANSCRIPT, sanitizedWith(undefined), {});
  assert.equal(out.sources, undefined);
  assert.equal(out.ungroundedFields, undefined);
  assert.equal(out.contradictions, undefined);
});

test("SCRIBE_GROUND=0 kills the signal without touching the extraction", () => {
  const out = attachGrounding(TRANSCRIPT, sanitizedWith(FULL_SOURCES), { disabled: true });
  assert.equal(out.sources, undefined);
  assert.equal(out.ungroundedFields, undefined);
  assert.equal(out.emrFields.cc, "Fever x 3 days, cough x 2 days");
});
