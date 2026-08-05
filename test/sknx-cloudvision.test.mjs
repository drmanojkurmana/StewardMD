// test/sknx-cloudvision.test.mjs — the cloud Derm Foundation classifier provider (59 SCIN conditions),
// tested with an INJECTED fetch (no network/endpoint needed): flag gate -> POST -> map differential ->
// SknX raw -> real guardrail. Confirms the two SCIN cancers (BCC, SCC/SCCIS) drive referral and a
// benign differential stays Rx-eligible.
import { test } from "node:test";
import assert from "node:assert";
import CV from "../sknx-cloudvision.js";
import ENG from "../sknx-engines.js";

const EP = "https://sknx-derm.example.run.app";

// a fake `window` with the cloud flag on/off + an endpoint + a native (Capacitor) platform. native
// defaults true; pass false to simulate a web build.
function win(flagOn, ep, native) {
  return {
    SMD_SKNX_CLOUD_ENDPOINT: ep,
    SMD_SKNX_FLAGS: { bool: (k) => (k === "smd_sknx_cloud" ? !!flagOn : false) },
    Capacitor: { isNativePlatform: () => (native === undefined ? true : !!native) }
  };
}
// a fetch stub that returns a fixed differential for /classify
function fetchStub(differential) {
  return function (url, init) {
    fetchStub.lastUrl = url; fetchStub.lastBody = init && init.body;
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ differential, engine: "derm-foundation-experimental" }) });
  };
}
const BENIGN = [{ label: "Psoriasis", prob: 0.91 }, { label: "Eczema", prob: 0.4 }, { label: "Tinea", prob: 0.2 }];
const BCC = [{ label: "Basal Cell Carcinoma", prob: 0.62 }, { label: "Actinic Keratosis", prob: 0.3 }];
const SCC = [{ label: "SCC/SCCIS", prob: 0.55 }, { label: "Seborrheic Dermatitis", prob: 0.2 }];

test("available(): needs BOTH the cloud flag ON and a real (non-placeholder) endpoint", () => {
  assert.equal(CV.available(win(true, EP)), true, "flag on + endpoint -> available");
  assert.equal(CV.available(win(false, EP)), false, "flag OFF -> not available (opt-in only)");
  assert.equal(CV.available(win(true, "__SKNX_CLOUD_ENDPOINT__")), false, "unfilled placeholder -> not available");
});

test("available(): APP-ONLY - not available on a web build (no native Capacitor platform)", () => {
  assert.equal(CV.available(win(true, EP, false)), false, "web (isNativePlatform false) -> not available");
  const noCapacitor = { SMD_SKNX_CLOUD_ENDPOINT: EP, SMD_SKNX_FLAGS: { bool: () => true } };
  assert.equal(CV.available(noCapacitor), false, "no Capacitor object (plain web) -> not available");
  assert.equal(CV.available(win(true, EP, true)), true, "native app -> available");
});

test("mapDiffToRaw: generalProbs = full differential; lesionProbs = only mapped malignancies", () => {
  const raw = CV.mapDiffToRaw(BCC);
  assert.equal(raw.engine, "derm-foundation-cloud");
  assert.equal(raw.generalProbs.length, 2, "all conditions in the differential");
  assert.equal(raw.lesionProbs.length, 1, "only the malignancy goes to lesionProbs");
  assert.equal(raw.lesionProbs[0].label, "basal cell carcinoma", "mapped to a guardrail-recognized label");
  assert.equal(raw.lesionProbs[0].prob, 0.62);
  // Actinic Keratosis is pre-malignant + primary-care treatable -> NOT force-referred here
  assert.ok(!raw.lesionProbs.some(x => /keratosis/i.test(x.label)), "AK is not in lesionProbs");
});

test("analyze() BCC -> SknX REFERS, no Rx (full path, injected fetch)", async () => {
  const raw = await CV.analyze("data:image/jpeg;base64,ZZZ", { endpoint: EP, fetchImpl: fetchStub(BCC) });
  assert.match(fetchStub.lastUrl, /\/classify$/);
  const a = ENG.makeAnalysis(raw, "v2beta");
  assert.equal(a.referral, true);
  assert.equal(a.rxEligible, false);
  assert.match(a.referralReason, /basal cell carcinoma/i);
});

test("R1 C1 regression: cloud BCC at v1 tier STILL refers (guardrail is not entitlement-gated)", async () => {
  // The cloud provider is selectable at v1 (available() is tier-independent), so a v1 clinician can
  // reach a named carcinoma. The guardrail must fire regardless of tier - not just at v2beta.
  const raw = await CV.analyze("data:image/jpeg;base64,ZZZ", { endpoint: EP, fetchImpl: fetchStub(BCC) });
  const a = ENG.makeAnalysis(raw, "v1");
  assert.equal(a.referral, true, "v1 + cloud BCC must refer");
  assert.equal(a.rxEligible, false, "v1 + cloud BCC must NOT be Rx-eligible");
  assert.match(a.referralReason, /basal cell carcinoma/i);
});

test("analyze() SCC/SCCIS -> refers via the SCC guardrail", async () => {
  const raw = await CV.analyze("data:image/jpeg;base64,ZZZ", { endpoint: EP, fetchImpl: fetchStub(SCC) });
  const a = ENG.makeAnalysis(raw, "v2beta");
  assert.equal(a.referral, true);
  assert.match(a.referralReason, /squamous cell carcinoma/i);
});

test("analyze() benign differential -> no referral, Rx-eligible, top dx surfaced", async () => {
  const raw = await CV.analyze("data:image/jpeg;base64,ZZZ", { endpoint: EP, fetchImpl: fetchStub(BENIGN) });
  const a = ENG.makeAnalysis(raw, "v2beta");
  assert.equal(a.referral, false);
  assert.equal(a.rxEligible, true);
  assert.equal(a.differential[0].label, "Psoriasis");
});

test("analyze() OOD response -> raw.ood carried through, engine refuses a confident read", async () => {
  const oodStub = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ differential: [], ood: true, caveat: "off-domain image" }) });
  const raw = await CV.analyze("data:image/jpeg;base64,ZZZ", { endpoint: EP, fetchImpl: oodStub, skipConsent: true });
  assert.equal(raw.ood, true);
  assert.match(raw.oodReason, /off-domain/);
  const a = ENG.makeAnalysis(raw, "v2beta");
  assert.equal(a.ood, true);
  assert.equal(a.rxEligible, false);
});

test("analyze() rejects (never masks) when the endpoint is unset", async () => {
  await assert.rejects(() => CV.analyze("data:image/jpeg;base64,ZZZ", { endpoint: "__SKNX_CLOUD_ENDPOINT__" }), /cloud_endpoint_unset/);
});

test("analyze() rejects on a non-OK HTTP response", async () => {
  const bad = () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
  await assert.rejects(() => CV.analyze("data:...", { endpoint: EP, fetchImpl: bad }), /cloud_http_503/);
});

test("toDataURL passes a dataURL string through unchanged", async () => {
  const s = "data:image/png;base64,AAAA";
  assert.equal(await CV.toDataURL(s), s);
});

test("consent gate: analyze rejects (no image sent) when the user declines consent", async () => {
  const store = {};
  globalThis.window = { localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } }, confirm: () => false };
  let called = false;
  try {
    await assert.rejects(
      () => CV.analyze("data:image/jpeg;base64,ZZZ", { endpoint: EP, fetchImpl: () => { called = true; return Promise.resolve({ ok: true, json: () => ({}) }); } }),
      /cloud_consent_declined/
    );
    assert.equal(called, false, "the fetch (image egress) must NOT happen without consent");
  } finally { delete globalThis.window; }
});

test("consent gate: skipConsent bypasses (already consented upstream)", async () => {
  const raw = await CV.analyze("data:image/jpeg;base64,ZZZ", { endpoint: EP, fetchImpl: fetchStub(BENIGN), skipConsent: true });
  assert.equal(raw.engine, "derm-foundation-cloud");
});

test("consent withdrawal: revokeConsent clears it so analyze re-prompts (DPDP right to withdraw)", async () => {
  const store = { sknx_cloud_consent: "1" };
  globalThis.window = { localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } }, confirm: () => false };
  try {
    assert.equal(CV.hasConsent(), true);
    CV.revokeConsent();
    assert.equal(CV.hasConsent(), false, "consent cleared");
    await assert.rejects(() => CV.analyze("data:image/jpeg;base64,ZZZ", { endpoint: EP, fetchImpl: () => Promise.resolve({ ok: true, json: () => ({}) }) }), /cloud_consent_declined/);
  } finally { delete globalThis.window; }
});
