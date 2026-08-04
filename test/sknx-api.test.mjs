// test/sknx-api.test.mjs - node tests for the SknX educational-report server CORE. Imports ONLY the
// pure, Workers-dep-free report-core.mjs (+ the seeded evidence corpus). NEVER imports the
// [[path]].js HTTP handler (that file uses Cloudflare-only imports and cannot be node-imported).
//
// Covers the three SAFETY-CRITICAL invariants: no raw image reaches the server (400 + whitelist),
// no hallucinated citations (references/guidelineSummary trace to the passed evidence only), and no
// prescription (server-derived management + LLM-Rx rejection belt).
import { test } from "node:test";
import assert from "node:assert";
import { validateReportRequest, buildScaffold, buildReportServer, looksLikeRx, DISCLAIMER } from "../functions/api/sknx/report-core.mjs";
import EVID from "../sknx-evidence.js";

const psoriasisEvidence = EVID.retrieve(["psoriasis"]);

const benign = {
  differential: [
    { label: "psoriasis", prob: 0.72, band: "high" },
    { label: "eczema", prob: 0.18, band: "low" }
  ],
  referral: false,
  rxEligible: true
};
const malignant = {
  differential: [{ label: "melanoma", prob: 0.4, band: "moderate" }],
  referral: true,
  referralReason: "Red-flag features noted",
  rxEligible: false
};
const benignInput = { analysis: benign, features: { diameterMm: 20, borderIrregular: true }, evidence: psoriasisEvidence, context: {} };

const PAYLOAD_KEYS = ["quality", "visualFindings", "differential", "redFlags", "discussion", "guidelineSummary", "investigations", "management", "followup", "references", "disclaimer"];

// 1. No raw image reaches the server: any image-bearing key -> 400 image_not_allowed.
test("invariant 1: image-bearing keys are rejected with 400", () => {
  const first = validateReportRequest({ image: "AAAA", analysis: {} });
  assert.equal(first.status, 400);
  assert.equal(first.ok, false);
  assert.equal(first.error, "image_not_allowed");
  for (const key of ["imageData", "photo", "base64", "dataUrl", "pixels", "file"]) {
    const r = validateReportRequest({ [key]: "AAAA", analysis: {} });
    assert.equal(r.status, 400, "expected 400 for image key: " + key);
    assert.equal(r.ok, false, "expected ok:false for image key: " + key);
  }
});

// 2. Strict whitelist: only { analysis, features, evidence, context } survive; unknown keys dropped.
test("invariant 1: input is strictly whitelisted (unknown keys dropped)", () => {
  const v = validateReportRequest({ analysis: { a: 1 }, features: {}, evidence: [], context: {}, foo: "x" });
  assert.equal(v.ok, true);
  assert.deepEqual(Object.keys(v.input).sort(), ["analysis", "context", "evidence", "features"]);
  assert.equal(v.input.foo, undefined);
  // evidence is always coerced to an array (default []).
  assert.ok(Array.isArray(validateReportRequest({ analysis: {} }).input.evidence));
});

// 3. Deterministic scaffold: full shape, disclaimer, citations-only-from-evidence, no Rx anywhere.
test("invariant 2 + 3: scaffold shape, citations from evidence only, no prescription/dose", async () => {
  const p = await buildScaffold(benignInput);
  for (const k of PAYLOAD_KEYS) assert.ok(Object.prototype.hasOwnProperty.call(p, k), "missing payload key: " + k);
  assert.equal(p.disclaimer, DISCLAIMER);

  const evidenceUrls = psoriasisEvidence.map((e) => e.url);
  assert.ok(p.references.length >= 1);
  for (const r of p.references) assert.ok(evidenceUrls.indexOf(r.url) !== -1, "reference url not from evidence: " + r.url);
  for (const g of p.guidelineSummary) assert.ok(evidenceUrls.indexOf(g.url) !== -1, "guidelineSummary url not from evidence: " + g.url);

  const pj = JSON.stringify(p);
  assert.ok(!/"rx"/i.test(pj), "payload must not contain an rx key");
  assert.ok(!/prescription|prescribe/i.test(pj), "payload must not contain prescription/prescribe");
  assert.doesNotMatch(p.management.join(" "), /\b\d+\s?mg\b/i);
});

// 4. Offline path: no callLLM -> deterministic report, provider "offline".
test("buildReportServer with no callLLM returns a valid offline report", async () => {
  const off = await buildReportServer({}, benignInput);
  assert.equal(off.provider, "offline");
  assert.equal(typeof off.payload.discussion, "string");
  assert.ok(off.payload.discussion.length > 0);
  for (const k of PAYLOAD_KEYS) assert.ok(Object.prototype.hasOwnProperty.call(off.payload, k), "missing payload key: " + k);
});

// 5. Gemini path: a clean LLM discussion enriches ONLY discussion; citations still from evidence.
test("buildReportServer with a working callLLM enriches discussion, keeps deterministic citations", async () => {
  const text = "Plaque psoriasis classically shows well demarcated erythematous plaques with silvery scale; barrier care and trigger avoidance are educational cornerstones.";
  const on = await buildReportServer({}, benignInput, { callLLM: async () => text });
  assert.equal(on.provider, "gemini");
  assert.equal(on.payload.discussion, text);
  const evidenceUrls = psoriasisEvidence.map((e) => e.url);
  assert.ok(on.payload.references.length >= 1);
  for (const r of on.payload.references) assert.ok(evidenceUrls.indexOf(r.url) !== -1, "reference url not from evidence: " + r.url);
});

// 6. Rx belt: an LLM discussion that looks like a prescription is dropped (falls back to offline).
test("invariant 3: an Rx-shaped LLM discussion is rejected, discussion stays deterministic", async () => {
  const off = await buildReportServer({}, benignInput);
  const rx = await buildReportServer({}, benignInput, { callLLM: async () => "Prescribe clobetasol; apply amoxicillin 500mg twice daily." });
  assert.equal(rx.provider, "offline");
  assert.equal(rx.payload.discussion, off.payload.discussion);
  assert.equal(looksLikeRx("amoxicillin 500 mg"), true);
  assert.equal(looksLikeRx("well demarcated plaques with scale"), false);
});

// 7. Referral case: at least one red flag, management defers to specialist principles (no drug/dose).
test("invariant 3: referral (malignant) case surfaces red flags and drug-free management", async () => {
  const mal = await buildScaffold({ analysis: malignant, features: { asymmetry: true, borderIrregular: true }, evidence: EVID.retrieve(["melanoma"]), context: {} });
  assert.ok(mal.redFlags.length >= 1);
  const mgmt = mal.management.join(" ");
  assert.doesNotMatch(mgmt, /\b\d+\s?mg\b/i);
  assert.ok(mal.management.some((m) => /refer/i.test(m)), "referral management should defer to specialist");
});
