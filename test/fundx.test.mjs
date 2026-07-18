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

// A fully-passing frame — driven by observable optical/image cues, NO lens fields.
const good = {
  eyePresent: true, eyeConf: 0.95, pupilCentered: true, pupilOffset: 0.05, distanceState: "ok",
  motion: 0.05, roll: 3, rollState: "level",
  focus: 0.9, exposure: 0.85, brightness: 0.7, contrast: 0.7, noise: 0.1, reflection: 0.1,
  redReflex: 0.8, fundusVisible: true, fundusConf: 0.9, fundusCircularity: 0.8, fundusCenter: { x: 0.02, y: 0.02 }, fundusSize: 0.6,
  vesselScore: 0.7
};

// no lens gate exists anywhere
ok("engine: no lens gate in the readiness gate map", V.ReadinessScore.compute(good).gates.lens === undefined);
ok("engine: no DETECTING_LENS state", V.STATE.DETECTING_LENS === undefined && V.STATE.LOCATING_FUNDUS === "locating_fundus");

// Alignment (eye + pupil + distance + glow; no lens term)
const al = V.AlignmentEngine.compute(good);
ok("alignment: optical high + acceptable", al.opticalAxisConfidence > 0.9 && al.acceptable === true && al.lensAlignment === undefined);
ok("alignment: empty not acceptable", V.AlignmentEngine.compute({}).acceptable === false);

// Readiness — quality-driven gates
const r = V.ReadinessScore.compute(good);
ok("readiness: all gates pass → ready", r.ready === true && r.overall >= 0.9);
ok("readiness: quality-driven gate map", r.gates.eye && r.gates.pupil && r.gates.fundus && r.gates.vessels && r.gates.quality && r.gates.focus);
ok("readiness: diagnostic composite present + high", r.diagnostic >= V.CFG.diagnosticMin);
const rEmpty = V.ReadinessScore.compute({});
ok("readiness: empty frame not ready", rEmpty.ready === false && rEmpty.gates.eye === false && rEmpty.gates.quality === false);

// State machine: empty → searching_eye; good → READY (never blocks on a lens)
const sm = V.createStateMachine();
ok("stateMachine: empty → searching_eye", sm.step({}).state === V.STATE.SEARCHING_EYE);
let last;
for (let i = 0; i < V.CFG.readySustainFrames + 1; i++) last = sm.step(good, i);
ok("stateMachine: good frame → ready (quality-gated)", last.state === V.STATE.READY);
ok("stateMachine: sustained ready → shouldCapture", last.shouldCapture === true);
ok("stateMachine: regresses when eye lost", sm.step({}).state === V.STATE.SEARCHING_EYE);
sm.set(V.STATE.CAPTURING);
ok("stateMachine: UI state held during frames", sm.step(good).state === V.STATE.CAPTURING);

// A frame with good geometry but NO diagnostic image quality must NOT auto-capture,
// and must NOT stall on any lens step — it waits at the quality/fundus stage.
const sm2 = V.createStateMachine();
const geomOnly = { eyePresent: true, eyeConf: 0.9, pupilCentered: true, pupilOffset: 0.05, distanceState: "ok", redReflex: 0.6, motion: 0.05 };
let s2; for (let i = 0; i < 10; i++) s2 = sm2.step(geomOnly, i);
ok("stateMachine: no fundus/quality → not READY, not a lens stall", s2.state !== V.STATE.READY && s2.shouldCapture !== true && [V.STATE.LOCATING_FUNDUS, V.STATE.RED_REFLEX, V.STATE.WORKING_DISTANCE].indexOf(s2.state) >= 0);

// Optional operator-confirm fallback: OFF by default; ON only relaxes SETUP, never quality.
V.CFG.lensConfirmFallback = true;
const sm3 = V.createStateMachine(); sm3.confirmLensPositioned();
let s3; for (let i = 0; i < 6; i++) s3 = sm3.step({ eyePresent: true, eyeConf: 0.9, pupilCentered: true, pupilOffset: 0.05, distanceState: "unknown", redReflex: 0.1 }, i);
ok("fallback: confirm advances past setup proxies (distance/red-reflex)", [V.STATE.LOCATING_FUNDUS, V.STATE.RED_REFLEX].indexOf(s3.state) >= 0 || s3.gates.distance === true);
ok("fallback: still never auto-captures without diagnostic quality", s3.shouldCapture !== true);
V.CFG.lensConfirmFallback = false;

// QualityEngine — image quality (fundus + vessels), not disease structures
const q = V.QualityEngine.score(good);
ok("quality: good frame accepted, no reasons", q.accepted === true && q.overall >= 65 && q.reasons.length === 0 && q.subscores.fundusVisibility >= 0.8);
const qBad = V.QualityEngine.score({ focus: 0.1, exposure: 0.1, reflection: 0.9 });
ok("quality: bad frame rejected + fundus/vessel reasons", qBad.accepted === false && qBad.reasons.indexOf("poor_focus") >= 0 && qBad.reasons.indexOf("fundus_not_visible") >= 0 && qBad.reasons.indexOf("no_vessels_detected") >= 0);

// BestFrameSelector
const bfs = V.BestFrameSelector.select([{ metrics: { focus: 0.2 } }, { metrics: good }, { metrics: { focus: 0.5 } }]);
ok("bestFrame: picks the good frame + fundus/vessel picks", bfs.best === 1 && bfs.scores.length === 3 && bfs.bestFundus === 1 && bfs.bestVessel === 1);
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
// rotate coaching from phone roll
const cueRot = V.Coach.cueFor(V.STATE.OPTIMIZING, { rollState: "cw", roll: 30, focus: 0.9, exposure: 0.9, reflection: 0.1, motion: 0.05 });
ok("coach: phone rolled cw → rotate counter-clockwise cue", cueRot.arrow === "rot_ccw" && /counter-clockwise/i.test(cueRot.voice));
// direction from the observed fundus field offset
const cueFund = V.Coach.cueFor(V.STATE.LOCATING_FUNDUS, { fundusVisible: true, fundusCenter: { x: -0.6, y: 0.1 }, fundusSize: 0.6, distanceState: "ok" });
ok("coach: fundus offset left → move left", cueFund.arrow === "left");
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

// ---- M5 Guided Training Mode --------------------------------------------
const FXt = loadFundx("1");
ok("training: seven levels defined", FXt._levels().length === 7);
ok("training: level names in order", FXt._levels()[0].key === "find_eye" && FXt._levels()[6].key === "diagnostic_capture");
ok("training: L1 needs eye", FXt._levelAchieved(1, { eye: true }, {}) === true && FXt._levelAchieved(1, { eye: false }, {}) === false);
ok("training: L2 needs pupil", FXt._levelAchieved(2, { pupil: true }, {}) === true);
ok("training: L3 needs working distance (not lens)", FXt._levelAchieved(3, { distance: true }, {}) === true && FXt._levelAchieved(3, {}, {}) === false);
ok("training: L4 needs red reflex", FXt._levelAchieved(4, { redReflex: true }, {}) === true && FXt._levelAchieved(4, {}, {}) === false);
ok("training: L5 needs the fundus view (not a lens)", FXt._levelAchieved(5, { fundus: true }, {}) === true && FXt._levelAchieved(5, {}, {}) === false);
ok("training: L7 needs readiness.ready", FXt._levelAchieved(7, {}, { ready: true }) === true && FXt._levelAchieved(7, {}, { ready: false }) === false);
ok("fundx: training screen wired", /function screenTraining\(/.test(fj) && /screen === "training"/.test(fj) && /data-fx="level"/.test(fj));

// ---- M9 Timeline + Compare (pure helpers) -------------------------------
const FXtl = loadFundx("1");
function scan(id, ts, q, cdr) { return { id: id, timestamp: ts, quality: { overall: q }, vision: { findings: { optic_disc: { cup_disc_ratio: cdr } } } }; }
const scans = [scan("a", 300, 90, 0.5), scan("b", 100, 70, 0.4), scan("c", 200, 80, 0.45)];
const qt = FXtl._trend(scans, "quality");
ok("timeline: trend sorted ascending by time", qt.length === 3 && qt[0].t === 100 && qt[2].t === 300);
ok("timeline: quality trend values", qt[0].v === 70 && qt[2].v === 90);
const ct = FXtl._trend(scans, "cdr");
ok("timeline: cdr trend reads optic_disc.cup_disc_ratio", ct[2].v === 0.5);
ok("timeline: trend drops null metrics", FXtl._trend([{ timestamp: 1, quality: {} }], "quality").length === 0);
const d = FXtl._compareDelta(scan("b", 100, 70, 0.4), scan("a", 300, 90, 0.5));
ok("compare: quality delta", d.qualityDelta === 20);
ok("compare: cdr delta rounded", d.cdrDelta === 0.1);
ok("compare: days apart (200ms → 0 days)", d.days === 0);
const dDays = FXtl._compareDelta(scan("x", 0, 70, 0.4), scan("y", 3 * 86400000, 90, 0.5));
ok("compare: days apart (3 days)", dDays.days === 3);
ok("compare: null-safe when metric missing", FXtl._compareDelta({ timestamp: 1 }, { timestamp: 2 }).qualityDelta === null);
ok("fundx: timeline + compare screens wired", /function screenTimeline\(/.test(fj) && /function screenCompare\(/.test(fj) && /screen === "timeline"/.test(fj) && /screen === "compare"/.test(fj));

// ---- M10 Settings + Export ----------------------------------------------
const FXset = loadFundx("1");
const recX = FXset._buildScanRecord(
  FXset._buildResult([{ dataUrl: "data:,x", metrics: { focus: 0.9, exposure: 0.85, reflection: 0.1, retinaConf: 0.9, discConf: 0.9, maculaConf: 0.9, contrast: 0.6, fieldOfView: 0.9 } }], { ref: "MRN1" }, "right", { startTs: 0 }),
  { ref: "MRN1", name: "Test" }, "right", { startTs: 0 }, { id: "fx_x", now: 1000 });
const payload = FXset._exportPayload(recX);
ok("export: payload schema + timestamp", payload.schema === "fundx.scan.export/1" && payload.exportedAt != null);
ok("export: carries findings + metadata, NO image bytes", !!(payload.scan.vision && payload.scan.quality && payload.scan.device && payload.scan.audit) && payload.scan.originalImage === undefined);
ok("export: provider/model version included", !!payload.scan.provider && payload.scan.provider.provider === "mock");
ok("fundx: settings screen + provider/sensitivity/export wired", /function screenSettings\(/.test(fj) && /data-fx="setprovider"/.test(fj) && /data-fx="setsens"/.test(fj) && /function exportScan\(/.test(fj) && /screen === "settings"/.test(fj));

// ---- M11 Clinical Engine integration (nested flag, advisory) ------------
ok("fundx: clinical card wired behind smd_fundx_clinical", /function clinicalOn\(/.test(fj) && /function clinicalCard\(/.test(fj) && /data-fx="setclinical"/.test(fj) && /SMD_FUNDX_CLINICAL/.test(fj));

// ---- cloud auto-activation (health-gated) -------------------------------
const FXc = loadFundx("1");
ok("cloud: parseHealth detects available vertex", FXc._parseHealth({ providers: [{ name: "vertex", available: true }, { name: "cerebras", available: false }] }).vision === true);
ok("cloud: parseHealth detects developer as vision-capable", FXc._parseHealth({ providers: [{ name: "developer", available: true }] }).vision === true);
ok("cloud: parseHealth none available → no vision", FXc._parseHealth({ providers: [{ name: "vertex", available: false }] }).vision === false);
ok("cloud: parseHealth cerebras-only → clinical yes, vision no", (function () { const h = FXc._parseHealth({ providers: [{ name: "cerebras", available: true }] }); return h.vision === false && h.clinical === true; })());
ok("cloud: providerTarget picks vertex-gemini when enabled + backend vision", FXc._providerTarget(true, { vision: true }) === "vertex-gemini");
ok("cloud: providerTarget stays mock when disabled", FXc._providerTarget(false, { vision: true }) === "mock");
ok("cloud: providerTarget stays mock when backend has no vision", FXc._providerTarget(true, { vision: false }) === "mock");
ok("fundx: cloud consent + auto-activation wired", /function applyProviderSelection\(/.test(fj) && /\/api\/fundx\/health/.test(fj) && /data-fx="cloudyes"/.test(fj) && /data-fx="setcloud"/.test(fj));

console.log(fail === 0 ? ("ALL " + pass + " PASS") : (pass + " pass / " + fail + " FAIL"));
process.exit(fail ? 1 : 0);
