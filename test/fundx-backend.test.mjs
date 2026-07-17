/* test/fundx-backend.test.mjs — FundX backend (provider transport + router).
 * No network, no credentials: pure helpers + orchestration via an injected mock
 * provider, and the router driven with fake Request/env (health / 503 / CORS / auth). */
import * as AI from "../functions/_fundx_ai.js";
import * as Router from "../functions/api/fundx/[[path]].js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };

// ---- pure helpers -------------------------------------------------------
ok("validateVisionBody: rejects empty", AI.validateVisionBody({}).ok === false);
ok("validateVisionBody: accepts data URL", AI.validateVisionBody({ image: "data:image/jpeg;base64,AAAA" }).ok === true);
ok("validateVisionBody: rejects oversized", AI.validateVisionBody({ image: "data:image/jpeg;base64," + "A".repeat(13 * 1024 * 1024) }).ok === false);
ok("validateClinicalBody: needs findings", AI.validateClinicalBody({}).ok === false && AI.validateClinicalBody({ findings: {} }).ok === true);

const vreq = AI.buildVisionRequest({ image: "data:image/jpeg;base64,ZZZ", ctx: { eye: "right" }, metrics: { focus: 0.9 } });
ok("buildVisionRequest: system+user+image", /IMAGE-ANALYSIS/.test(vreq.system) && /right/i.test(vreq.user) && vreq.imageDataUrl.indexOf("data:") === 0);
ok("buildVisionRequest: bare base64 gets data-url prefix", AI.buildVisionRequest({ image: "ZZZ" }).imageDataUrl.indexOf("data:image/jpeg;base64,") === 0);
const creq = AI.buildClinicalRequest({ findings: { microaneurysms: 3 }, patient: { dx: "T2DM" } });
ok("buildClinicalRequest: embeds findings + patient", /microaneurysms/.test(creq.user) && /T2DM/.test(creq.user) && /ADVISORY/.test(creq.system));

ok("extractJSON: plain", JSON.stringify(AI.extractJSON('{"a":1}')) === '{"a":1}');
ok("extractJSON: code-fenced", AI.extractJSON('```json\n{"a":2}\n```').a === 2);
ok("extractJSON: prose-wrapped", AI.extractJSON('Here you go: {"a":3} thanks').a === 3);
ok("extractJSON: invalid → null", AI.extractJSON("not json") === null);

const nf = AI.normalizeFindings({ quality: 150, optic_disc: { cup_disc_ratio: 5, visible: true }, microaneurysms: "7", confidence: 2 }, { provider: "vertex", model: "gemini-2.5-flash" });
ok("normalizeFindings: clamps quality/cdr/confidence", nf.quality === 100 && nf.optic_disc.cup_disc_ratio === 1 && nf.confidence === 1);
ok("normalizeFindings: coerces counts + schema + provider", nf.microaneurysms === 7 && nf.schemaVersion === 1 && nf.provider === "vertex" && nf.model_version === "gemini-2.5-flash");
ok("normalizeFindings: is_mock false + not-a-diagnosis", nf.is_mock === false && /not a diagnosis/i.test(nf.disclaimer));
const na = AI.normalizeAssessment({ severity: "banana", urgency: "emergency", confidence: 9 }, { provider: "cerebras", model: "llama-3.3-70b" });
ok("normalizeAssessment: bad severity → none, urgency kept, advisory", na.severity === "none" && na.urgency === "emergency" && na.advisory === true);
ok("normalizeAssessment: clamps confidence + provider", na.confidence === 1 && na.provider === "cerebras" && na.engine === "clinical");

ok("visionOrder: default vertex→developer", JSON.stringify(AI.visionOrder({})) === JSON.stringify(["vertex", "developer"]));
ok("visionOrder: developer override", JSON.stringify(AI.visionOrder({ FUNDX_VISION_PROVIDER: "developer" })) === JSON.stringify(["developer"]));
ok("clinicalOrder: cerebras first when selected", AI.clinicalOrder({ FUNDX_CLINICAL_PROVIDER: "cerebras" })[0] === "cerebras");
ok("health: no creds → all providers unavailable", AI.health({}).providers.every((p) => p.available === false));
ok("health: GEMINI_API_KEY → developer available", AI.health({ GEMINI_API_KEY: "x" }).providers.find((p) => p.name === "developer").available === true);

// ---- orchestration via injected mock provider (no network) --------------
await (async () => {
  const mockVision = { name: "mockv", modalities: ["vision", "text"], available: () => true, generate: async () => JSON.stringify({ quality: 92, retina_visible: true, optic_disc: { visible: true, cup_disc_ratio: 0.42 }, confidence: 0.9 }) };
  const findings = await AI.runVision({}, { image: "data:image/jpeg;base64,AAAA" }, { providers: { mockv: mockVision }, order: ["mockv"] });
  ok("runVision: mock provider → normalized findings", findings.quality === 92 && findings.provider === "mockv" && findings.schemaVersion === 1);

  const mockClin = { name: "mockc", modalities: ["text"], available: () => true, generate: async () => '```json\n{"severity":"moderate","urgency":"soon","label":"NPDR features","confidence":0.8}\n```' };
  const asmt = await AI.runClinical({}, { findings: { microaneurysms: 4 } }, { providers: { mockc: mockClin }, order: ["mockc"] });
  ok("runClinical: mock provider → normalized assessment", asmt.severity === "moderate" && asmt.urgency === "soon" && asmt.provider === "mockc");

  let threw = null; try { await AI.runVision({}, {}, { providers: {}, order: [] }); } catch (e) { threw = e; }
  ok("runVision: invalid body → 400", threw && threw.status === 400 && threw.code === "invalid_request");

  const un = { name: "x", modalities: ["vision"], available: () => false, generate: async () => "{}" };
  let threw2 = null; try { await AI.runVision({}, { image: "data:image/jpeg;base64,AAAA" }, { providers: { x: un }, order: ["x"] }); } catch (e) { threw2 = e; }
  ok("runVision: no provider available → 503", threw2 && threw2.status === 503);

  const badJson = { name: "bj", modalities: ["vision", "text"], available: () => true, generate: async () => "totally not json" };
  let threw3 = null; try { await AI.runVision({}, { image: "data:image/jpeg;base64,AAAA" }, { providers: { bj: badJson }, order: ["bj"] }); } catch (e) { threw3 = e; }
  ok("runVision: non-JSON provider output → error (no crash)", threw3 && (threw3.status === 502 || threw3.status === 503));
})();

// ---- router (fake Request/env; no creds) --------------------------------
function ctx(method, path, opts) {
  opts = opts || {};
  const headers = {};
  if (opts.origin != null) headers["Origin"] = opts.origin;
  if (opts.token) headers["X-App-Token"] = opts.token;
  if (opts.body) headers["Content-Type"] = "application/json";
  const req = new Request("https://stewardmd.in" + path, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { request: req, env: opts.env || {} };
}
await (async () => {
  let r = await Router.onRequest(ctx("OPTIONS", "/api/fundx/vision", { origin: "capacitor://localhost" }));
  ok("router: OPTIONS preflight → 204 + CORS", r.status === 204 && r.headers.get("Access-Control-Allow-Origin") === "capacitor://localhost");

  r = await Router.onRequest(ctx("GET", "/api/fundx/health", { origin: "https://stewardmd.in" }));
  const hj = await r.json();
  ok("router: GET /health → 200 provider report (no creds → unavailable)", r.status === 200 && hj.ok === true && hj.providers.every((p) => p.available === false));

  r = await Router.onRequest(ctx("GET", "/api/fundx/health", { origin: "https://evil.example" }));
  ok("router: bad Origin + no token → 401", r.status === 401);

  r = await Router.onRequest(ctx("PUT", "/api/fundx/vision", { origin: "" }));
  ok("router: non-POST to vision → 405", r.status === 405);

  r = await Router.onRequest(ctx("POST", "/api/fundx/vision", { origin: "", body: { image: "data:image/jpeg;base64,AAAA" } }));
  ok("router: POST /vision with no provider configured → 503 (graceful)", r.status === 503);

  r = await Router.onRequest(ctx("POST", "/api/fundx/vision", { origin: "", body: { notimage: 1 } }));
  ok("router: POST /vision invalid body → 400", r.status === 400);

  r = await Router.onRequest(ctx("POST", "/api/fundx/clinical", { origin: "", body: { findings: { microaneurysms: 2 } } }));
  ok("router: POST /clinical with no provider → 503 (graceful)", r.status === 503);
})();

console.log(fail === 0 ? ("ALL " + pass + " PASS") : (pass + " pass / " + fail + " FAIL"));
process.exit(fail ? 1 : 0);
