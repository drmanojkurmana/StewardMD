/* test/fundx.test.mjs — FundX AI Vision Engine + store + flag-gating unit tests.
 * Pure logic, no DOM. Runs under `npm test`. Loads the browser IIFE sources with
 * readFileSync + new Function and injects fake window/localStorage/location. */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log("  ✗ FAIL:", name); } };
const src = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

function fakeLocalStorage() {
  const store = {};
  return { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; }, _store: store };
}

// ---- load Vision Engine -------------------------------------------------
const winV = {};
new Function("window", src("fundx-vision.js"))(winV);
const V = winV.SMD_FUNDX_VISION;
ok("vision: exposed", !!V);
ok("vision: version + schema", V.VERSION === "0.1.0" && V.SCHEMA_VERSION === 1);

// makeFrameAnalysis clamps + defaults
const fa0 = V.makeFrameAnalysis({ eyeConf: 5, focus: -3 });
ok("frameAnalysis: clamps to [0,1]", fa0.eyeConf === 1 && fa0.focus === 0);
ok("frameAnalysis: defaults present", fa0.schemaVersion === 1 && fa0.reflection === 1 && fa0.motion === 1);

// A fully-passing frame
const good = {
  eyePresent: true, eyeConf: 0.95, pupilCentered: true, pupilOffset: 0.05,
  lensPresent: true, lensConf: 0.9, lensCentered: true, distanceState: "ok",
  motion: 0.05, focus: 0.9, exposure: 0.85, brightness: 0.7, contrast: 0.7,
  noise: 0.1, reflection: 0.1, redReflex: 0.8, retinaVisible: true, retinaConf: 0.9,
  discVisible: true, discConf: 0.9, maculaVisible: true, maculaConf: 0.9,
  vesselVisibility: 0.8, fieldOfView: 0.9
};

// Alignment
const al = V.AlignmentEngine.compute(good);
ok("alignment: optical high + acceptable", al.opticalAxisConfidence > 0.9 && al.acceptable === true);
const alBad = V.AlignmentEngine.compute({});
ok("alignment: empty not acceptable", alBad.acceptable === false);

// Readiness
const r = V.ReadinessScore.compute(good);
ok("readiness: all gates pass → ready", r.ready === true && r.overall >= 0.9);
ok("readiness: gate map complete", r.gates.eye && r.gates.pupil && r.gates.retina && r.gates.focus);
const rEmpty = V.ReadinessScore.compute({});
ok("readiness: empty frame not ready", rEmpty.ready === false && rEmpty.gates.eye === false);

// State machine: empty → searching_eye
const sm = V.createStateMachine();
let step = sm.step({});
ok("stateMachine: empty → searching_eye", step.state === V.STATE.SEARCHING_EYE);
// good frame → READY, and shouldCapture after sustain
let last;
for (let i = 0; i < V.CFG.readySustainFrames + 1; i++) last = sm.step(good, i);
ok("stateMachine: good frame → ready", last.state === V.STATE.READY);
ok("stateMachine: sustained ready → shouldCapture", last.shouldCapture === true);
ok("stateMachine: transitions recorded", sm.history.length >= 1);
// regression: lose the eye → back to searching_eye
const back = sm.step({});
ok("stateMachine: regresses when eye lost", back.state === V.STATE.SEARCHING_EYE);
// UI-driven state is not overwritten by frame steps
sm.set(V.STATE.CAPTURING);
const held = sm.step(good);
ok("stateMachine: UI state held during frames", held.state === V.STATE.CAPTURING && held.changed === false);

// QualityEngine
const q = V.QualityEngine.score(good);
ok("quality: good frame accepted", q.accepted === true && q.overall >= 65 && q.reasons.length === 0);
const qBad = V.QualityEngine.score({ focus: 0.1, exposure: 0.1, reflection: 0.9, retinaConf: 0 });
ok("quality: bad frame rejected + reasons", qBad.accepted === false && qBad.reasons.indexOf("poor_focus") >= 0 && qBad.reasons.indexOf("retina_not_visible") >= 0);

// BestFrameSelector
const bfs = V.BestFrameSelector.select([{ metrics: { focus: 0.2 } }, { metrics: good }, { metrics: { focus: 0.5 } }]);
ok("bestFrame: picks the good frame", bfs.best === 1 && bfs.scores.length === 3);
ok("bestFrame: empty → -1", V.BestFrameSelector.select([]).best === -1);

// MockRetinaModel determinism + swap interface
const ctx = { patientRef: "MRN1", eye: "right", ts: 111 };
const m1 = V.MockRetinaModel.analyze({ quality: 90 }, ctx);
const m2 = V.MockRetinaModel.analyze({ quality: 90 }, ctx);
ok("mockModel: deterministic per ctx", JSON.stringify(m1) === JSON.stringify(m2));
const m3 = V.MockRetinaModel.analyze({ quality: 90 }, { patientRef: "MRN2", eye: "left", ts: 222 });
ok("mockModel: varies across ctx", JSON.stringify(m1) !== JSON.stringify(m3));
ok("mockModel: flagged non-diagnostic", m1.is_mock === true && m1.provider === "mock" && /not a diagnosis/i.test(m1.disclaimer));
// registerRetinaModel swaps the provider without touching contracts
const fake = { provider: "vertex", modelVersion: "gemini-x", analyze: () => ({ schemaVersion: 1, provider: "vertex", model_version: "gemini-x", findings: 1 }) };
V.registerRetinaModel(fake);
ok("retinaModel: swap point works", V.getRetinaModel().provider === "vertex");
V.registerRetinaModel(null);
ok("retinaModel: reverts to mock", V.getRetinaModel().provider === "mock");

// Findings builder + validation
const built = V.Findings.build({ ctx, quality: q, now: 999 });
ok("findings: versioned + engine=vision", built.schemaVersion === 1 && built.engine === "vision" && built.generatedAt === 999);
ok("findings: validate ok", V.validate.findings(built).ok === true);
ok("findings: validate catches bad", V.validate.findings({}).ok === false);

// Coach
const cue = V.Coach.cueFor(V.STATE.CENTERING_PUPIL, { pupilDir: { x: 0.8, y: 0.1 } });
ok("coach: centering emits right arrow", cue.arrow === "right" && !!cue.text && !!cue.voice);
const cueReady = V.Coach.cueFor(V.STATE.READY, good);
ok("coach: ready is positive tone + success haptic", cueReady.tone === "good" && cueReady.haptic === "success");

// ScanRecord validation (nine mandated fields)
const goodRec = { id: "s1", originalImage: "x", processedImage: "x", quality: q, acquisition: { eye: "right" }, vision: built, patientContext: { ref: "MRN1" }, timestamp: 1, device: { platform: "ios" }, provider: { provider: "mock" }, audit: { operator: "dr" } };
ok("scanRecord: complete record valid", V.validate.scanRecord(goodRec).ok === true);
ok("scanRecord: missing field flagged", V.validate.scanRecord({ id: "s1" }).ok === false);

// ---- load Store (native path with fake Filesystem) ----------------------
const writes = [];
const fakeFs = {
  writeFile: (o) => { writes.push(o.path); return Promise.resolve(); },
  getUri: (o) => Promise.resolve({ uri: "file:///data/" + o.path }),
  deleteFile: () => Promise.resolve()
};
const winS = { SMD_FUNDX_VISION: V, SMD_IS_NATIVE: true, Capacitor: { isNativePlatform: () => true, Plugins: { Filesystem: fakeFs } } };
const lsS = fakeLocalStorage();
new Function("window", "localStorage", src("fundx-store.js"))(winS, lsS);
const STORE = winS.SMD_FUNDX_STORE;
ok("store: exposed", !!STORE);

await (async () => {
  const meta = await STORE.saveScan(goodRec);
  ok("store: saveScan wrote 2 images (orig+proc)", writes.length === 2);
  ok("store: meta strips heavy image dataURLs", meta.originalImage === undefined && meta.processedImage === undefined);
  ok("store: meta keeps image refs", !!(meta.images && meta.images.original && meta.images.original.uri));
  const list = await STORE.listScans("MRN1");
  ok("store: listScans by patient", list.length === 1 && list[0].id === "s1");
  const none = await STORE.listScans("OTHER");
  ok("store: listScans filters other patients", none.length === 0);
  const uri = await STORE.imageUri("s1", "original");
  ok("store: imageUri returns native uri", /^file:\/\//.test(uri));
  const got = await STORE.getScan("s1");
  ok("store: getScan by id", got && got.id === "s1");
  await STORE.saveScan(goodRec);
  const all = await STORE.listScans();
  ok("store: re-save updates in place (no dupe)", all.filter((m) => m.id === "s1").length === 1);
  await STORE.deleteScan("s1");
  const after = await STORE.listScans();
  ok("store: deleteScan removes record", after.length === 0);
  // invalid record rejected
  let rejected = false;
  try { await STORE.saveScan({ id: "bad" }); } catch (e) { rejected = true; }
  ok("store: saveScan rejects invalid record", rejected === true);
  // learning + operator
  const lp = STORE.learning.completeLevel(1, 5);
  ok("store: learning.completeLevel", lp.levels[1].done === true);
  const op = STORE.operator.record({ quality: 80, captures: 1 }, 5);
  ok("store: operator.record aggregates", op.scans === 1 && op.avgQuality === 80);
})();

// ---- flag gating (fundx.js) ---------------------------------------------
function loadFundx(flagVal) {
  const ls = fakeLocalStorage(); if (flagVal != null) ls.setItem("smd_fundx", flagVal);
  const win = { SMD_FUNDX_VISION: V, SMD_FUNDX_STORE: STORE };
  const loc = { search: "" };
  new Function("window", "localStorage", "location", src("fundx.js"))(win, ls, loc);
  return win.FUNDX;
}
ok("flag: default OFF → stub, enabled=false", loadFundx(null).enabled() === false);
ok("flag: '0' → stub, enabled=false", loadFundx("0").enabled() === false);
ok("flag: '1' → real module, enabled=true", loadFundx("1").enabled() === true);
// URL override on
function loadFundxUrl(searchStr) {
  const ls = fakeLocalStorage();
  const win = { SMD_FUNDX_VISION: V, SMD_FUNDX_STORE: STORE };
  new Function("window", "localStorage", "location", src("fundx.js"))(win, ls, { search: searchStr });
  return win.FUNDX;
}
ok("flag: ?fundx=1 forces on", loadFundxUrl("?fundx=1").enabled() === true);
ok("flag: ?fundx=0 forces off", loadFundxUrl("?fundx=0").enabled() === false);

// ---- M3 capture processing (pure helpers on window.FUNDX) ---------------
const FX = loadFundx("1");
const stats = { startTs: 0, attempts: 1, captures: 1, retries: 0, burstCount: 2, readinessTrace: [10, 50, 90] };
const burst = [
  { dataUrl: "data:image/jpeg;base64,AAAA", metrics: { focus: 0.9, exposure: 0.85, brightness: 0.5, contrast: 0.6, noise: 0.1, reflection: 0.1, retinaConf: 0.9, discConf: 0.9, maculaConf: 0.9, vesselVisibility: 0.7, fieldOfView: 0.9 } },
  { dataUrl: "data:image/jpeg;base64,BBBB", metrics: { focus: 0.2, exposure: 0.3, reflection: 0.6, retinaConf: 0.1 } }
];
const res = FX._buildResult(burst, { ref: "MRN1", name: "Test" }, "right", stats);
ok("capture: buildResult picks the best (sharp) frame", res && res.best === 0);
ok("capture: buildResult quality accepted for good frame", res.quality.accepted === true);
ok("capture: buildResult findings versioned + engine=vision", res.findings.engine === "vision" && res.findings.schemaVersion === 1);
ok("capture: buildResult images set (orig+proc)", res.images.original === "data:image/jpeg;base64,AAAA" && !!res.images.processed);
ok("capture: buildResult null on empty burst", FX._buildResult([], {}, "right", {}) === null);

const rec = FX._buildScanRecord(res, { ref: "MRN1", name: "Test" }, "right", stats, { id: "fx_test", now: 1000 });
ok("record: passes 9-field validation", V.validate.scanRecord(rec).ok === true);
ok("record: all nine categories present", !!(rec.originalImage && rec.processedImage && rec.quality && rec.acquisition && rec.vision && rec.patientContext && rec.timestamp && rec.device && rec.provider && rec.audit));
ok("record: provider carried from findings", rec.provider.provider === "mock");
ok("record: acquisition captures eye + readiness trace", rec.acquisition.eye === "right" && rec.acquisition.readinessTrace.length === 3);
ok("record: device app version + audit action present", !!rec.device.appVersion && rec.audit.actions[0].type === "created");

// ---- M4 integration regression guards (source presence) -----------------
const icu = src("icu.js");
ok("icu: MEMBER.fundx defined", /MEMBER\.fundx\s*=/.test(icu));
ok("icu: Records workspace includes fundx member", /members:\s*\["documents",\s*"imaging",\s*"fundx"/.test(icu));
ok("icu: RENDER.fundx sub-tab present", /fundx:\s*function\s*\(\)/.test(icu) && /FundX AI · Retinal imaging/.test(icu));
ok("icu: launch:fundx opens FUNDX with patient context", /arg === "fundx"/.test(icu) && /FUNDX\.open\(\{\s*ref:/.test(icu));

const fj = src("fundx.js");
ok("fundx: scan detail viewer present", /function openDetail\(/.test(fj) && /screen === "detail"/.test(fj));
ok("fundx: delete-scan wired", /function deleteScan\(/.test(fj) && /data-fx="deletescan"/.test(fj));

console.log(fail === 0 ? ("ALL " + pass + " PASS") : (pass + " pass / " + fail + " FAIL"));
process.exit(fail ? 1 : 0);
