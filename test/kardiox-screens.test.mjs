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

for (const key of ["source", "permission", "processing", "analysis"]) {
  host._html = "";
  R.nav(key);
  ok("screen renders: " + key, rendered(150));
}

// full mock pipeline: source card tap → processing → analysis → report (AF verdict)
host._html = "";
R.runPipeline({ id: "smoke", source: "photoLibrary" });
await delay(400);   // mock analyzer streams 13 stages @ ~8ms then resolves + mounts report
ok("pipeline → report shows AF verdict", /Atrial fibrillation/i.test(host._html) && host._html.indexOf("kx-") >= 0);
ok("report shows confidence 91%", /91/.test(host._html));

// why screen (needs analysis in state — set by the pipeline above)
host._html = "";
R.nav("why");
ok("why screen renders", rendered(150));

console.log(`\nkardiox-screens: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
