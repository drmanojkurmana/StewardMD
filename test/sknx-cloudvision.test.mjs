// test/sknx-cloudvision.test.mjs — the cloud Derm Foundation classifier provider (59 SCIN conditions),
// tested with an INJECTED fetch (no network/endpoint needed): flag gate -> POST -> map differential ->
// SknX raw -> real guardrail. Confirms the two SCIN cancers (BCC, SCC/SCCIS) drive referral and a
// benign differential stays Rx-eligible.
import { test } from "node:test";
import assert from "node:assert";
import CV from "../sknx-cloudvision.js";
import ENG from "../sknx-engines.js";

const EP = "https://sknx-derm.example.run.app";

// a fake `window` with the cloud flag on/off + an endpoint
function win(flagOn, ep) {
  return {
    SMD_SKNX_CLOUD_ENDPOINT: ep,
    SMD_SKNX_FLAGS: { bool: (k) => (k === "smd_sknx_cloud" ? !!flagOn : false) }
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
  assert.equal(CV.available(win(true, "")), false, "no endpoint -> not available");
  assert.equal(CV.available(win(true, "__SKNX_CLOUD_ENDPOINT__")), false, "unfilled placeholder -> not available");
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
