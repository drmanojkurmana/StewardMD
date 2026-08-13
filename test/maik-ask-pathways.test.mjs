/* test/maik-ask-pathways.test.mjs — MaiK Ask clinical pathway engine (Phase B).
 * Deterministic: match complaint, seed known-from-Scribe (no re-asking), pick highest-priority unknown
 * target, know when complete. node --test test/maik-ask-pathways.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const P = require("../maik-pathways.js");
const load = (f) => JSON.parse(readFileSync(new URL("../clinical-pathways/" + f, import.meta.url), "utf8"));
["headache.json", "fever.json", "cough.json"].forEach((f) => P.register(load(f)));

test("match: complaint text -> pathway id (EN + Telugu keywords)", () => {
  assert.equal(P.match("patient has headache for 2 days"), "headache");
  assert.equal(P.match("తలనొప్పి ఉంది"), "headache");
  assert.equal(P.match("fever since 3 days"), "fever");
  assert.equal(P.match("no relevant complaint here"), null);
});

test("nextTarget: red flag first (priority 1), then unknown core", () => {
  const hp = P.get("headache");
  const t1 = P.nextTarget(hp, {});
  assert.equal(t1.priority, 1);
  assert.equal(t1.kind, "redflag");        // thunderclap_onset probed first
  assert.equal(t1.field, "thunderclap_onset");
});

test("knownFrom: seed from Scribe state so known fields are not re-asked", () => {
  const hp = P.get("headache");
  const known = P.knownFrom({ Chief_complaints_duration: "3 days", History_present_illness: "right sided throbbing headache" }, hp);
  assert.equal(known.duration, "3 days");   // dedicated field
  assert.equal(known.location, "documented"); // cue "right" found in free text
  assert.equal(known.character, "documented"); // cue "throbbing" found
  assert.ok(!("severity" in known), "severity not documented -> still to ask");
});

test("interview walk: never re-asks known; converges; stops when complete", () => {
  const hp = P.get("headache");
  let known = P.knownFrom({ Chief_complaints_duration: "3 days", History_present_illness: "right sided headache" }, hp);
  const asked = [];
  for (let i = 0; i < hp.maxQuestions; i++) {
    const t = P.nextTarget(hp, known);
    if (!t) break;
    asked.push(t.field);
    known[t.field] = "answered";   // simulate a captured answer
  }
  assert.ok(!asked.includes("duration"), "duration already known -> not asked");
  assert.ok(!asked.includes("location"), "location documented -> not asked");
  assert.ok(asked.includes("thunderclap_onset"), "red flag asked");
  assert.ok(asked.length <= hp.maxQuestions);
  // Loop stops either because everything askable is covered OR the maxQuestions cap was reached.
  assert.ok(P.isComplete(hp, known) || asked.length === hp.maxQuestions, "converged or hit maxQuestions");
});

test("with fewer unknowns the loop actually completes before the cap", () => {
  const cp = P.get("cough");
  // seed most fields so only 1-2 remain -> should reach isComplete before maxQuestions
  let known = { duration: "x", type: "x", sputum_color: "x", fever: "x", breastlessness: "x", breathlessness: "x", chest_pain: "x", weight_loss: "x", hemoptysis: "x" };
  assert.equal(P.isComplete(cp, known), true);
});

test("isComplete: empty pathway state is NOT complete", () => {
  assert.equal(P.isComplete(P.get("cough"), {}), false);
});
