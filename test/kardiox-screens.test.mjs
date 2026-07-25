/* test/kardiox-screens.test.mjs — M2 headless smoke: screens render + router pipeline works.
 * Uses a tolerant fake DOM (visual fidelity is verified on-device, like FundX). */
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ── tolerant fake DOM ──
function node(tag) {
  const n = {
    tagName: tag || "DIV", _html: "", textContent: "", scrollTop: 0, dataset: {},
    style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return ""; } },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, appendChild() {}, insertBefore() {}, removeChild() {},
    querySelector() { return node(); }, querySelectorAll() { return []; }, closest() { return null; },
    scrollIntoView() {}, focus() {}, getBoundingClientRect() { return { width: 320, height: 480, top: 0, left: 0 }; }
  };
  Object.defineProperty(n, "innerHTML", { get() { return n._html; }, set(v) { n._html = String(v); } });
  return n;
}
const host = node(); host.id = "kxScroll";
const rootEl = node(); rootEl.id = "kardioxRoot";
const doc = {
  getElementById(id) { return id === "kxScroll" ? host : id === "kardioxRoot" ? rootEl : node(); },
  createElement(t) { return node(t); }, querySelector() { return node(); }, querySelectorAll() { return []; },
  addEventListener() {}, body: node(), documentElement: node(), readyState: "complete"
};
// Load the module files into the real global scope so cross-file globals (window.SMD_KARDIOX_*) and
// bare global references resolve exactly like a browser (window.X === globalThis.X).
globalThis.window = globalThis;
globalThis.document = doc;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
const loadInto = (file) => new Function(read(file))();

loadInto("kardiox-models.js");
loadInto("kardiox-signal.js");
loadInto("kardiox-providers.js");
loadInto("kardiox-screens.js");
globalThis.KARDIOX = { close() {} };   // minimal for closeMod()

const R = globalThis.SMD_KARDIOX_ROUTER;
ok("router exposed", !!R && typeof R.mountLanding === "function" && typeof R.nav === "function" && typeof R.runPipeline === "function");

function rendered(minLen) { return host._html && host._html.length > (minLen || 200) && host._html.indexOf("kx-") >= 0; }

R.mountLanding(host);
ok("landing renders", rendered(300) && /Analyze an ECG/i.test(host._html));

for (const key of ["source", "permission", "processing", "analysis", "history", "comparison", "privacy", "settings", "empty", "states", "library", "lesson", "quiz", "flashcards", "daily"]) {
  host._html = "";
  R.nav(key);
  await delay(40);   // async screens (library/quiz) render a placeholder then hydrate from mock providers
  ok("screen renders: " + key, rendered(120));
}

// REGRESSION — "AFib for all": the report must NEVER fabricate a diagnosis when there is no real
// analysis. With state.analysis still null (no pipeline has run yet), the report must show the honest
// empty state — not a demo AF-with-RVR sample. render06 + openStored previously fell back to
// samples.afWithRvr, so every verdict-less / unloadable report read as "Atrial fibrillation".
host._html = "";
R.nav("report");
ok("report with no analysis shows empty state (not fabricated AFib)",
   /No analysis to show/i.test(host._html) && !/Atrial fibrillation/i.test(host._html));

// full pipeline UI smoke: source card tap → processing → analysis → report. Uses the EXPLICIT mock
// analyzer (a demo sample) to exercise the report rendering — real inference (backend / bundled on-device
// ONNX) is unavailable headless, and Analyze is now wired to the real pipeline by default (proven in
// kardiox-backend.test.mjs), with the mock reserved for explicit demo mode.
globalThis.SMD_KARDIOX_PROVIDERS.use(globalThis.SMD_KARDIOX_PROVIDERS.mockProviders({}));
host._html = "";
R.runPipeline({ id: "smoke", source: "photoLibrary" });
await delay(400);   // mock analyzer streams 13 stages @ ~8ms then resolves + mounts report
ok("pipeline → report shows AF verdict", /Atrial fibrillation/i.test(host._html) && host._html.indexOf("kx-") >= 0);
ok("report shows confidence 91%", /91/.test(host._html));
ok("report now lists differentials", /Differentials considered/i.test(host._html) && /Atrial flutter/i.test(host._html));

// why screen (needs analysis in state — set by the pipeline above)
host._html = "";
R.nav("why");
ok("why screen renders", rendered(150));
ok("why page: Criteria/Differentials tabs, diff hidden by default, no 'Which leads?'",
   /data-view="criteria"/.test(host._html) && /data-view="diff" hidden/.test(host._html) && !/Which leads/.test(host._html));

// on-device AI settings row (native only): appears when Capacitor + the model manager are present
globalThis.Capacitor = { isNativePlatform: () => true, Plugins: {} };
loadInto("kardiox-model-manager.js");   // sets window.SMD_KARDIOX_MODELMGR
host._html = "";
R.nav("settings");
ok("settings shows the on-device AI row on native", /kx-ondevice-ai/.test(host._html) && /On-device AI/.test(host._html));
ok("settings shows the on-device toggle on native", /kx-toggle-ondevice/.test(host._html) && /Analyse on-device/.test(host._html) && /role="switch"/.test(host._html));
delete globalThis.Capacitor;

// ── REGRESSION — "all source buttons open the gallery": each tile must route to its OWN picker. The
// handler read the wrong attribute (data-src vs data-source), so every tile fell back to the photo
// library. Stub the native pickers, capture the delegated click handler, and tap each source tile.
let kxClick = null;
rootEl._kxWired = false;                                    // force init() to re-register the click listener
rootEl.addEventListener = (ev, fn) => { if (ev === "click") kxClick = fn; };
const picked = { cameraSource: null, fileTypes: null };
globalThis.Capacitor = {
  isNativePlatform: () => true, convertFileSrc: (p) => p,
  Plugins: {
    Camera: { getPhoto: (o) => { picked.cameraSource = o.source; return Promise.reject({ cancelled: true }); } },
    FilePicker: { pickFiles: (o) => { picked.fileTypes = (o.types || []).join(","); return Promise.reject({ cancelled: true }); } }
  }
};
R.mountLanding(host);
function tap(source) {
  const tile = { getAttribute: (k) => k === "data-act" ? "kx-source" : k === "data-source" ? source : null };
  if (kxClick) kxClick({ target: { closest: () => tile } });
}
picked.cameraSource = null; tap("camera");  await delay(5); ok("Camera tile opens the CAMERA (not gallery)", picked.cameraSource === "CAMERA");
picked.cameraSource = null; tap("library"); await delay(5); ok("Photo Library tile opens the PHOTOS gallery", picked.cameraSource === "PHOTOS");
picked.fileTypes = null;    tap("files");   await delay(5); ok("Files tile opens the file picker (not gallery)", /image/.test(picked.fileTypes || ""));
picked.fileTypes = null;    tap("pdf");     await delay(5); ok("Scan PDF tile opens a PDF picker (not gallery)", /pdf/.test(picked.fileTypes || ""));
delete globalThis.Capacitor;

// ── REGRESSION — "Why this diagnosis" back button force-closed the flow: it was wired to data-act
// "report" → openStored(null) → nulled the analysis → empty report. It must return to the SAME report
// with the analysis intact. (state.analysis is still the AF mock from the pipeline smoke above.)
R.nav("report"); R.nav("why");
host._html = "";
if (kxClick) kxClick({ target: { closest: () => ({ getAttribute: (k) => k === "data-act" ? "kardiox-back" : null }) } });
ok("Why-screen back returns to the report (analysis intact, not emptied)",
   /Atrial fibrillation/i.test(host._html) && !/No analysis to show/i.test(host._html));

// ── REGRESSION — the processing screen fired ctx.nav('05'), a stale numeric mockup id (not a router
// SCREENS key), so it fell through to deferred() → "That arrives in a later KardiQ X update." No screen
// may navigate to a bare numeric id; every nav target must be a semantic SCREENS key.
ok("no navigation to a stale numeric screen id (must use semantic SCREENS keys)",
   !/\.nav\(\s*['"][0-9]/.test(read("kardiox-screens.js")));

console.log(`\nkardiox-screens: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
