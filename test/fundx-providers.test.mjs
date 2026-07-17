/* test/fundx-providers.test.mjs — FundX retinal-inference provider abstraction (AI Router). */
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const src = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

const win = {};
new Function("window", src("fundx-vision.js"))(win);
new Function("window", src("fundx-providers.js"))(win);
const P = win.SMD_FUNDX_PROVIDERS, V = win.SMD_FUNDX_VISION;
ok("providers: exposed", !!P);

// registry seeds all required providers
const list = P.list();
["mock", "vertex-gemini", "cerebras", "onnx", "tflite"].forEach((id) => ok("providers: registered '" + id + "'", list.indexOf(id) >= 0));
ok("providers: mock active by default", P.getActive().id === "mock");

// health reports availability — mock available, cloud/local unconfigured unavailable
const h = P.health();
const byId = Object.fromEntries(h.map((x) => [x.id, x]));
ok("providers: mock available", byId.mock.available === true);
ok("providers: vertex-gemini unavailable until configured", byId["vertex-gemini"].available === false);
ok("providers: onnx unavailable until configured", byId.onnx.available === false);

await (async () => {
  const ctx = { patientRef: "MRN1", eye: "right", ts: 100 };
  // default → mock → valid versioned findings
  const f = await P.analyzeFindings({ quality: 90 }, ctx);
  ok("router: default mock returns versioned findings", f.engine === "vision" && f.schemaVersion === 1 && f.provider === "mock");
  ok("router: no fallback flag when mock is active", f.fallback == null);

  // configure a cloud provider → available, but set active to it with NO fetch → falls back to mock
  P.configure("vertex-gemini", { endpoint: "http://127.0.0.1:59999/never", model: "gemini-2.5" });
  ok("providers: configuring endpoint makes it available", P.get("vertex-gemini").available() === true);
  P.setActive("vertex-gemini");
  ok("router: active provider switched", P.getActive().id === "vertex-gemini");
  const f2 = await P.analyzeFindings({ quality: 88, imageDataUrl: "data:," }, ctx);
  ok("router: cloud failure falls back to mock (still valid)", f2.provider === "mock" && f2.findings != null);
  ok("router: fallback info recorded", f2.fallback && f2.fallback.from === "vertex-gemini");

  // register a fake real provider returning VALID findings → used directly
  P.register({ id: "fakegood", provider: "fakegood", modelVersion: "fg-1", kind: "cloud", available: () => true, analyze: () => Promise.resolve({ provider: "fakegood", model_version: "fg-1", confidence: 0.9, optic_disc: { visible: true, cup_disc_ratio: 0.4 }, quality: 88 }) });
  P.setActive("fakegood");
  const f3 = await P.analyzeFindings({ quality: 88 }, ctx);
  ok("router: valid real provider used directly", f3.provider === "fakegood" && f3.modelVersion === "fg-1" && f3.fallback == null);

  // register a fake provider returning INVALID findings → validated + fell back to mock
  P.register({ id: "fakebad", provider: "fakebad", modelVersion: "fb-1", available: () => true, analyze: () => Promise.resolve({ nonsense: true }) });
  P.setActive("fakebad");
  const f4 = await P.analyzeFindings({ quality: 88 }, ctx);
  ok("router: invalid response rejected → mock fallback", f4.provider === "mock" && f4.fallback && f4.fallback.reason === "invalid_response");

  // back to mock
  P.setActive("mock");
  ok("router: can return to mock", P.getActive().id === "mock");
})();

console.log(fail === 0 ? ("ALL " + pass + " PASS") : (pass + " pass / " + fail + " FAIL"));
process.exit(fail ? 1 : 0);
