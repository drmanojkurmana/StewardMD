/* ONCQIS KB back-navigation regression tests (node --test test/onco-kb-nav.test.mjs).
 *
 * Covers the three reported defects:
 *  1. KB topics opened from ONCQIS rendered BEHIND it (dx z 850 < ONCQIS 875/865) and the
 *     disease-panel Back button forced SB.openRef("syndromes") instead of returning to ONCQIS.
 *  2. Disease-reader mobile layout (z-index / hidden-layout / safe-area rules in CSS).
 *  3. Header back buttons that dismissed their module instead of stepping back a level
 *     (ONCQIS sub-view -> dashboard; staging site -> list; CTCAE AE -> list; irAE organ -> list).
 *
 * Browser IIFEs run here under a minimal stub DOM (same trick as test/onco-home.test.mjs),
 * driving the REAL onClick handlers and the REAL DX.openRef. CSS assertions read the real
 * stylesheet text. No LLM, no network, no PHI. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/* ---------------- minimal stub DOM ---------------- */
function makeClassList() {
  const s = new Set();
  return {
    add(...a) { a.forEach((x) => s.add(x)); },
    remove(...a) { a.forEach((x) => s.delete(x)); },
    contains(x) { return s.has(x); },
    toggle(x, f) {
      if (f === undefined) { if (s.has(x)) s.delete(x); else s.add(x); }
      else if (f) s.add(x); else s.delete(x);
    },
    _set: s,
  };
}

function FakeElement(tag) {
  this.tagName = String(tag || "div").toUpperCase();
  this.children = [];
  this.classList = makeClassList();
  this.style = {};
  this.dataset = {};
  this._html = "";
  this._listeners = {};
  this._backBtn = null;
  this.id = "";
  this.className = "";
  this.scrollTop = 0;
  this.value = "";
  this.textContent = "";
}
Object.defineProperty(FakeElement.prototype, "innerHTML", {
  get() { return this._html; },
  set(v) {
    this._html = String(v);
    const m = this._html.match(/(?:id="dxMgmtBack"|class="oh-back")[^>]*>([\s\S]*?)<\/button>/);
    if (m) {
      if (!this._backBtn) this._backBtn = new FakeElement("button");
      this._backBtn._html = m[1];
      this._backBtn.textContent = m[1].replace(/&lsaquo;/g, "\u2039").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
    }
  },
});
FakeElement.prototype.appendChild = function (c) {
  this.children.push(c);
  if (c && c.id && typeof docEls !== "undefined") docEls[c.id] = c;
  return c;
};
FakeElement.prototype.addEventListener = function (t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); };
FakeElement.prototype.removeEventListener = function () {};
FakeElement.prototype.querySelector = function (sel) {
  if ((sel === "#dxMgmtBack" || sel === ".oh-back") && this._backBtn) return this._backBtn;
  if (sel === "#dxMgmt") {
    for (const c of this.children) if (c.id === "dxMgmt") return c;
    return null;
  }
  if (sel === ".dx-select[data-sel]") return null;
  return new FakeElement("div");
};
FakeElement.prototype.querySelectorAll = function () { return []; };
FakeElement.prototype.closest = function () { return null; };
FakeElement.prototype.setAttribute = function () {};
FakeElement.prototype.getAttribute = function () { return null; };
FakeElement.prototype.focus = function () {};

const docEls = {};
const docBody = new FakeElement("body");
const docHead = new FakeElement("head");
global.document = {
  readyState: "complete",
  createElement: (t) => new FakeElement(t),
  getElementById: (id) => docEls[id] || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  head: docHead,
  body: docBody,
};
global.window = global;
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.alert = () => {};
global.confirm = () => true;

global.SMD_QUEUE_FLAGS = { bool: function () { return true; } }; // flags on (mirrors the CDP harness stubs)
const DX_MOD = require(join(ROOT, "reasoning.js"));
assert.ok(global.DX && typeof global.DX.openRef === "function", "reasoning.js must export window.DX.openRef");
const OH_MOD = require(join(ROOT, "onco-home.js"));
const STG_MOD = require(join(ROOT, "onco-staging.js"));
const CTC_MOD = require(join(ROOT, "onco-ctcae.js"));
const IOT_MOD = require(join(ROOT, "onco-iotox.js"));
void DX_MOD; void OH_MOD; void STG_MOD; void CTC_MOD; void IOT_MOD;

/* ONCQIS shell stub: mounted + visible, as when a clinician browses ONCQIS. */
const ohEl = new FakeElement("div");
ohEl.id = "smdOncoHome";
ohEl.classList.add("on");
docEls.smdOncoHome = ohEl;
let fgCalls = 0;
global.SMD_ONCOHOME = global.SMD_ONCOHOME || {};
global.SMD_ONCOHOME.foreground = () => { fgCalls++; ohEl.classList.remove("oh-bg"); };
let sbCalls = [];
global.SB = { openRef: (t) => sbCalls.push(t) };
global.SYNDROMES = global.SYNDROMES || {};
global.DDX_NI = global.DDX_NI || [];

function dxRoot() { return docEls.dxOverlay || null; }
function lastBackBtn() {
  const root = dxRoot();
  assert.ok(root, "dxOverlay root must exist after DX.openRef");
  const panel = root.querySelector("#dxMgmt");
  assert.ok(panel, "#dxMgmt panel must exist after DX.openRef");
  const bk = panel.querySelector("#dxMgmtBack");
  assert.ok(bk, "#dxMgmtBack must exist in the disease reference panel");
  return { panel, bk };
}
function clickBack(bk) {
  const hs = bk._listeners.click || [];
  assert.ok(hs.length > 0, "back button must have a click handler");
  hs[hs.length - 1]();
}
function resetDx() {
  const root = dxRoot();
  if (root) root.classList.remove("on", "dx-reference-mode");
  const panel = root && root.querySelector("#dxMgmt");
  if (panel) panel.classList.remove("on");
  sbCalls = [];
  fgCalls = 0;
}
function fakeClick(targetAttr, act) {
  const btn = { getAttribute: (a) => (a === targetAttr ? act : null) };
  return {
    target: { closest: (sel) => (sel === "[data-oh-fav]" ? null : btn) },
    preventDefault: () => {}, stopPropagation: () => {},
  };
}
function clickHandlerOf(el) {
  const hs = el._listeners.click || [];
  assert.ok(hs.length > 0, "overlay must have a delegated click handler (open it first)");
  return hs[hs.length - 1];
}

/* ---------------- 1. DX.openRef from ONCQIS ---------------- */

test("DX.openRef(id, { from:'onco-home' }) labels Back as ONCQIS", () => {
  resetDx();
  let onBackCalls = 0;
  global.DX.openRef("acinic_cell_carcinoma", { from: "onco-home", standalone: true, onBack: () => { onBackCalls++; } });
  const { bk } = lastBackBtn();
  assert.ok(bk.textContent.indexOf("ONCQIS") >= 0, "back label must name ONCQIS, got: " + JSON.stringify(bk.textContent));
  assert.ok(bk.textContent.indexOf("Library") < 0, "must not say Library for an ONCQIS origin");
  void onBackCalls;
});

test("Back from an ONCQIS-opened topic calls onBack and never SB.openRef('syndromes')", () => {
  resetDx();
  let onBackCalls = 0;
  global.DX.openRef("acinic_cell_carcinoma", { from: "onco-home", standalone: true, onBack: () => { onBackCalls++; } });
  const { bk } = lastBackBtn();
  clickBack(bk);
  assert.equal(onBackCalls, 1, "opts.onBack must run so ONCQIS foregrounds");
  assert.deepEqual(sbCalls, [], "must not bounce into the syndrome library: " + JSON.stringify(sbCalls));
  assert.ok(!dxRoot().classList.contains("on"), "reasoning root must close behind the return to ONCQIS");
});

test("Back auto-detects a mounted ONCQIS and foregrounds it (no onBack wired)", () => {
  resetDx();
  ohEl.classList.add("on");
  ohEl.classList.add("oh-bg"); // backgrounded under the reference panel
  global.DX.openRef("acinic_cell_carcinoma", { standalone: true });
  const { bk } = lastBackBtn();
  clickBack(bk);
  assert.equal(fgCalls, 1, "SMD_ONCOHOME.foreground must run when ONCQIS is mounted");
  assert.deepEqual(sbCalls, [], "must not open the syndrome library: " + JSON.stringify(sbCalls));
  assert.ok(!ohEl.classList.contains("oh-bg"), "ONCQIS must be foreground again");
});

test("standalone library opens keep the Library label and only reopen syndromes for a syndromes origin", () => {
  resetDx();
  delete docEls.smdOncoHome; // no ONCQIS mounted: pure library journey
  try {
    global.DX.openRef("acinic_cell_carcinoma", { standalone: true });
    const labelled = lastBackBtn();
    assert.ok(labelled.bk.textContent.indexOf("Library") >= 0, "library label, got: " + JSON.stringify(labelled.bk.textContent));
    clickBack(labelled.bk);
    assert.deepEqual(sbCalls, [], "unknown standalone caller must not force SB.openRef('syndromes')");

    global.DX.openRef("acinic_cell_carcinoma", { from: "syndromes", standalone: true });
    clickBack(lastBackBtn().bk);
    assert.deepEqual(sbCalls, ["syndromes"], "syndrome-library origin must still return there");
  } finally {
    docEls.smdOncoHome = ohEl;
  }
});

test("differential opens keep 'Back to differential' and stay in the workspace", () => {
  resetDx();
  ohEl.classList.remove("on");
  const root = dxRoot();
  root.classList.add("on"); // workspace already open: not standalone
  try {
    global.DX.openRef("acinic_cell_carcinoma");
    const { panel, bk } = lastBackBtn();
    assert.ok(bk.textContent.indexOf("differential") >= 0, "differential label, got: " + JSON.stringify(bk.textContent));
    clickBack(bk);
    assert.ok(!panel.classList.contains("on"), "panel hides");
    assert.ok(root.classList.contains("on"), "workspace stays open");
    assert.deepEqual(sbCalls, [], "no library bounce from the differential");
  } finally {
    ohEl.classList.add("on");
  }
});

/* ---------------- 2. ONCQIS header back steps back before closing ---------------- */

test("SMD_ONCOHOME exports foreground", () => {
  assert.equal(typeof global.SMD_ONCOHOME.foreground, "function", "foreground must be exported for return navigation");
});

test("ONCQIS header shows Back in a sub-view and returns to the dashboard before closing", () => {
  const api = global.SMD_ONCOHOME;
  api.open();
  const el = docEls.smdOncoHome;
  assert.ok(el.classList.contains("on"), "open() mounts the overlay");
  const onClick = clickHandlerOf(el);
  assert.ok(el.querySelector(".oh-back").innerHTML.indexOf("Close") >= 0, "dashboard header says Close");

  api._st.mode = "kb"; // clinician drilled into the knowledge-base sub-view
  onClick(fakeClick("data-oh-act", "protoref-open")); // any render path refreshes the header
  assert.ok(el.querySelector(".oh-back").innerHTML.indexOf("Back") >= 0, "sub-view header says Back, got: " + el.querySelector(".oh-back").innerHTML);
  api._st.mode = "kb";
  onClick(fakeClick("data-oh-act", "close"));
  assert.equal(api._st.mode, null, "first Back leaves the sub-view");
  assert.ok(el.classList.contains("on"), "first Back stays in ONCQIS (dashboard), not Home");
  onClick(fakeClick("data-oh-act", "close"));
  assert.ok(!el.classList.contains("on"), "second Close exits to Home");
});

test("ONCQIS kb handler opens the disease ref with an ONCQIS return (not behind the overlay)", () => {
  const api = global.SMD_ONCOHOME;
  api.open();
  const el = docEls.smdOncoHome;
  const onClick = clickHandlerOf(el);
  let gotId = null, gotOpts = null;
  const realDx = global.DX;
  global.DX = { openRef: (id, opts) => { gotId = id; gotOpts = opts || null; } };
  try {
    onClick(fakeClick("data-oh-act", "kb:acinic_cell_carcinoma"));
  } finally {
    global.DX = realDx;
  }
  assert.equal(gotId, "acinic_cell_carcinoma", "kb tap forwards the disease id");
  assert.ok(gotOpts && gotOpts.from === "onco-home", "must tag the ONCQIS origin");
  assert.equal(typeof (gotOpts && gotOpts.onBack), "function", "must carry an onBack return");
  assert.ok(el.classList.contains("oh-bg"), "ONCQIS backgrounds itself under the reference panel");
  gotOpts.onBack();
  assert.ok(!el.classList.contains("oh-bg"), "onBack foregrounds ONCQIS");
});

/* ---------------- 3. staging / CTCAE / irAE detail -> list before close ---------------- */

test("staging header steps from a site back to the list before closing", () => {
  const api = global.SMD_ONCOSTAGING;
  api.openList();
  const el = docEls.smdOncoStaging;
  assert.ok(el.classList.contains("on"), "staging list opens");
  assert.ok(el.innerHTML.indexOf("Close") >= 0, "list header says Close");
  api.open("breast");
  assert.ok(el.innerHTML.indexOf("All sites") >= 0, "detail header says All sites");
  const onClick = clickHandlerOf(el);
  onClick(fakeClick("data-stg-act", "close"));
  assert.equal(api._st.site, null, "first Back clears the site");
  assert.ok(el.classList.contains("on"), "first Back stays in staging (list), not Home");
  assert.ok(el.innerHTML.indexOf("Close") >= 0, "list header says Close again");
  onClick(fakeClick("data-stg-act", "close"));
  assert.ok(!el.classList.contains("on"), "second Close exits");
});

test("staging close() foregrounds a mounted ONCQIS", () => {
  const api = global.SMD_ONCOSTAGING;
  api.openList();
  ohEl.classList.add("on"); ohEl.classList.add("oh-bg");
  api.close();
  assert.ok(!ohEl.classList.contains("oh-bg"), "ONCQIS foreground on staging dismiss");
});

test("CTCAE header steps from an AE back to the list before closing", () => {
  const api = global.SMD_ONCOCTCAE;
  api.openList();
  const el = docEls.smdOncoCtcae;
  assert.ok(el.classList.contains("on"), "CTCAE list opens");
  api.open("nausea");
  assert.ok(el.innerHTML.indexOf("All terms") >= 0, "detail header says All terms");
  const onClick = clickHandlerOf(el);
  onClick(fakeClick("data-ctc-act", "close"));
  assert.equal(api._cx.ae, null, "first Back clears the AE");
  assert.ok(el.classList.contains("on"), "first Back stays in CTCAE (list)");
  onClick(fakeClick("data-ctc-act", "close"));
  assert.ok(!el.classList.contains("on"), "second Close exits");
});

test("CTCAE close() foregrounds a mounted ONCQIS", () => {
  const api = global.SMD_ONCOCTCAE;
  api.openList();
  ohEl.classList.add("on"); ohEl.classList.add("oh-bg");
  api.close();
  assert.ok(!ohEl.classList.contains("oh-bg"), "ONCQIS foreground on CTCAE dismiss");
});

test("irAE header steps from a toxicity back to the list before closing", () => {
  const api = global.SMD_ONCOIOTOX;
  api.openList();
  const el = docEls.smdOncoIotox;
  assert.ok(el.classList.contains("on"), "irAE list opens");
  api.open("lung");
  assert.ok(el.innerHTML.indexOf("All toxicities") >= 0, "detail header says All toxicities");
  const onClick = clickHandlerOf(el);
  onClick(fakeClick("data-iot-act", "close"));
  assert.equal(api._ix.organ, null, "first Back clears the organ");
  assert.ok(el.classList.contains("on"), "first Back stays in irAE (list)");
  onClick(fakeClick("data-iot-act", "close"));
  assert.ok(!el.classList.contains("on"), "second Close exits");
});

test("irAE close() foregrounds a mounted ONCQIS", () => {
  const api = global.SMD_ONCOIOTOX;
  api.openList();
  ohEl.classList.add("on"); ohEl.classList.add("oh-bg");
  api.close();
  assert.ok(!ohEl.classList.contains("oh-bg"), "ONCQIS foreground on irAE dismiss");
});

/* ---------------- static contracts: stacking, CSS, oncotree ---------------- */

test("reference mode stacks above ONCQIS and collapses the workspace layout", () => {
  const css = readFileSync(join(ROOT, "reasoning-workspace.css"), "utf8");
  const norm = css.replace(/\s+/g, " ");
  assert.ok(norm.indexOf("#dxOverlay.dx-reference-mode { z-index:900 !important; }") >= 0,
    "dx-reference-mode must pin z-index 900 above ONCQIS 875/865");
  assert.ok(css.indexOf("dx-reference-mode:has(.dx-reader.on)") >= 0 &&
    css.indexOf("display:none !important") >= 0,
    "workspace chrome under an open reader must display:none (never visibility:hidden layout ghosts)");
  assert.ok(!/dx-reference-mode:has\(\.dx-reader\.on\)[^}]*visibility\s*:\s*hidden/.test(css),
    "the old visibility:hidden rule must be gone");
});

test("reader keeps safe-area padding and wraps long disease names on mobile", () => {
  const css = readFileSync(join(ROOT, "reasoning-workspace.css"), "utf8");
  assert.ok(css.indexOf("max-width:100vw") >= 0 && css.indexOf("overflow-x:hidden") >= 0,
    ".dx-reader must be viewport-bounded with no x-overflow");
  const mobile = css.slice(css.indexOf("@media(max-width:600px)"));
  assert.ok(mobile.indexOf("env(safe-area-inset-top") >= 0,
    "mobile reader header must keep env(safe-area-inset-top) (never strip it)");
  assert.ok(/\.dx-mgmt-name[^}]*font-size:\s*26px/.test(mobile), "mobile disease name is 26px");
  assert.ok(mobile.indexOf("overflow-wrap:break-word") >= 0 && mobile.indexOf("word-break:break-word") >= 0,
    "disease names must break-word on narrow screens");
  assert.ok(/\.dx-mgmt-body[^}]*width:\s*100%/.test(mobile), "mobile reader body is full-width");
});

test("oncotree close steps back through protocol/modal/pathway before exiting", () => {
  const src = readFileSync(join(ROOT, "oncotree.js"), "utf8");
  const closeAct = src.slice(src.indexOf('if (act === "close")'), src.indexOf('if (act === "close")') + 700);
  assert.ok(closeAct.indexOf("st.openedProtocol") >= 0, "close from a protocol returns to the pathway");
  assert.ok(closeAct.indexOf("st.superpowerModal") >= 0, "close from a modal dismisses the modal");
  assert.ok(closeAct.indexOf("st.graph = null") >= 0 && closeAct.indexOf('st.view = "navigator"') >= 0,
    "close from a pathway returns to the disease picker");
  const closeFn = src.slice(src.indexOf("function close() {"), src.indexOf("function close() {") + 600);
  assert.ok(closeFn.indexOf("SMD_ONCOHOME") >= 0 && closeFn.indexOf("foreground") >= 0,
    "oncotree close() must foreground a mounted ONCQIS");
});

test("reasoning.js keeps the ONCQIS return contract in source", () => {
  const src = readFileSync(join(ROOT, "reasoning.js"), "utf8");
  assert.ok(src.indexOf("openRef: function (id, opts)") >= 0, "openRef accepts opts");
  assert.ok(src.indexOf("Object.assign({ standalone: isStandalone }, opts)") >= 0, "standalone default merges with caller opts");
  assert.ok(src.indexOf('opts.from === "onco-home"') >= 0, "ONCQIS origin is recognised");
  assert.ok(src.indexOf("typeof opts.onBack") >= 0, "onBack return is honoured");
  assert.ok(src.indexOf('opts.from === "syndromes"') >= 0, "syndrome-library return is conditional, not forced");
});

/* ---------------- 4. Knowledge Library -> disease -> Back (never Clinical Reasoning) ---------------- */

function mountLibrary(scroll) {
  let lib = docEls.sbrefOverlay;
  if (!lib) { lib = new FakeElement("div"); lib.id = "sbrefOverlay"; docEls.sbrefOverlay = lib; }
  lib.classList.add("open");
  let body = docEls.sbrefBody;
  if (!body) { body = new FakeElement("div"); body.id = "sbrefBody"; docEls.sbrefBody = body; }
  body.scrollTop = scroll;
  return { lib, body };
}
function unmountLibrary() {
  delete docEls.sbrefOverlay;
  delete docEls.sbrefBody;
}

test("kbOpen from the Knowledge Library tags from:'syndromes' + standalone and keeps the overlay open", () => {
  resetDx();
  mountLibrary(222);
  const realDx = global.DX;
  assert.equal(typeof realDx._kbOpen, "function", "DX must expose the _kbOpen entry point");
  let gotId = null, gotOpts = null, closeRefCalls = 0;
  global.DX = { openRef: (id, opts) => { gotId = id; gotOpts = opts || null; } };
  const realSB = global.SB;
  global.SB = { openRef: (t) => sbCalls.push(t), closeRef: () => { closeRefCalls++; } };
  try {
    realDx._kbOpen("acinic_cell_carcinoma");
  } finally {
    global.DX = realDx;
    global.SB = realSB;
  }
  assert.equal(gotId, "acinic_cell_carcinoma", "disease id forwarded");
  assert.ok(gotOpts && gotOpts.from === "syndromes", "library origin tagged, got: " + JSON.stringify(gotOpts));
  assert.equal(gotOpts && gotOpts.standalone, true, "library opens are standalone");
  assert.equal(closeRefCalls, 0, "library overlay must stay parked underneath, never closed");
  assert.ok(docEls.sbrefOverlay.classList.contains("open"), "#sbrefOverlay still open under the reference panel");
  unmountLibrary();
});

test("kbOpen from global search tags from:'search' and still closes the library chrome", () => {
  resetDx();
  unmountLibrary(); // no library open: a search journey
  const realDx = global.DX;
  let gotOpts = null, closeRefCalls = 0;
  global.DX = { openRef: (id, opts) => { gotOpts = opts || null; } };
  const realSB = global.SB;
  global.SB = { openRef: (t) => sbCalls.push(t), closeRef: () => { closeRefCalls++; } };
  try {
    realDx._kbOpen("acinic_cell_carcinoma");
  } finally {
    global.DX = realDx;
    global.SB = realSB;
  }
  assert.ok(gotOpts && gotOpts.from === "search", "search origin tagged, got: " + JSON.stringify(gotOpts));
  assert.equal(gotOpts && gotOpts.standalone, true, "search opens are standalone");
  assert.equal(closeRefCalls, 1, "non-library opens still dismiss the library chrome");
});

test("Back from a library-opened topic returns to the library at the same scroll, never exposing Clinical Reasoning", () => {
  resetDx();
  mountLibrary(222);
  ohEl.classList.remove("on"); // isolate from the ONCQIS auto-detect return
  try {
    global.DX._kbOpen("acinic_cell_carcinoma"); // real DX.openRef: from syndromes, standalone
    const root = dxRoot();
    assert.ok(root.classList.contains("on"), "reference panel opens above the library");
    assert.ok(root.classList.contains("dx-reference-mode"), "reference mode stacks above the library");
    assert.ok(docEls.sbrefOverlay.classList.contains("open"), "library stays parked underneath");
    const { bk } = lastBackBtn();
    assert.ok(bk.textContent.indexOf("Library") >= 0, "library label, got: " + JSON.stringify(bk.textContent));
    clickBack(bk);
    assert.ok(!root.classList.contains("on"), "Clinical Reasoning workspace (#dxOverlay) must never be exposed");
    assert.ok(!root.classList.contains("dx-reference-mode"), "reference mode torn down");
    assert.ok(!docBody.classList.contains("dx-lock"), "body lock released");
    assert.ok(docEls.sbrefOverlay.classList.contains("open"), "library DOM still there underneath");
    assert.equal(docEls.sbrefBody.scrollTop, 222, "previous scroll position restored");
    assert.deepEqual(sbCalls, [], "existing library DOM reused, no re-render via SB.openRef");
  } finally {
    ohEl.classList.add("on");
    unmountLibrary();
  }
});

test("kbOpen stays standalone even when the reasoning root was already open", () => {
  resetDx();
  mountLibrary(333);
  ohEl.classList.remove("on");
  const root = dxRoot();
  root.classList.add("on"); // stale workspace state from prior navigation
  try {
    global.DX._kbOpen("acinic_cell_carcinoma");
    const { bk } = lastBackBtn();
    assert.ok(bk.textContent.indexOf("Library") >= 0, "still a library journey, got: " + JSON.stringify(bk.textContent));
    clickBack(bk);
    assert.ok(!root.classList.contains("on"), "Back exits cleanly instead of dropping into the workspace");
    assert.ok(!root.classList.contains("dx-reference-mode"), "reference mode torn down");
    assert.ok(docEls.sbrefOverlay.classList.contains("open"), "library still parked underneath");
    assert.equal(docEls.sbrefBody.scrollTop, 333, "scroll restored");
  } finally {
    ohEl.classList.add("on");
    unmountLibrary();
  }
});

test("abx-wizard opens references standalone with an abx-wizard origin", () => {
  const src = readFileSync(join(ROOT, "abx-wizard.js"), "utf8");
  assert.ok(src.indexOf('{ from: "abx-wizard", standalone: true }') >= 0,
    "wizard reference taps must carry their origin and stay standalone");
});
