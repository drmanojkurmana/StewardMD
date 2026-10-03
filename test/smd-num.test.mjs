/* test/smd-num.test.mjs — SMD_NUM (counter vs clinical, never-intermediate, reduced motion, first render,
 * retarget, kill switch) and the SMD_SKEL 300ms delay helper. No DOM library in the repo, so a tiny fake. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const SRC = readFileSync(new URL("../smd-num.js", import.meta.url), "utf8");

class Node_ {
  constructor(tag) { this.tag = tag; this.children = []; this.parentNode = null; this.className = ""; this.attrs = {}; this.style = {}; this._text = ""; this.anims = []; }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  set textContent(v) { this.children.forEach((c) => (c.parentNode = null)); this.children = []; this._text = String(v); }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
  set innerHTML(v) { this.textContent = ""; this._html = v; }
  get innerHTML() { return this._html || ""; }
  animate(frames, opts) { const a = { frames, opts, cancelled: false, onfinish: null, cancel() { this.cancelled = true; }, finish() { if (this.onfinish) this.onfinish(); } }; this.anims.push(a); return a; }
}
function load({ reduced = false, kill = false, noWaapi = false } = {}) {
  const timers = [];
  const doc = { createElement: (t) => { const n = new Node_(t); if (noWaapi) n.animate = undefined; return n; }, createTextNode: (t) => { const n = new Node_("#text"); n._text = t; return n; }, addEventListener() {} };
  const win = { matchMedia: () => ({ matches: reduced }), localStorage: { getItem: (k) => (kill && k === "smd_num_motion" ? "0" : null) },
    setTimeout: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length - 1; }, clearTimeout: (i) => { if (timers[i]) timers[i].live = false; } };
  new Function("window", "document", SRC)(win, doc);
  return { win, doc, timers, NUM: win.SMD_NUM, SKEL: win.SMD_SKEL };
}
const allAnims = (el) => { const out = []; (function w(n) { n.anims.forEach((a) => out.push(a)); n.children.forEach(w); })(el); return out; };
const finishAll = (el) => allAnims(el).filter((a) => !a.cancelled).forEach((a) => a.finish());
const vis = (el) => el.__smdNum.vis;
const sr = (el) => el.__smdNum.sr.textContent;

test("first render: instant, no animation, sr text carries the value, tabular numerals", () => {
  const { doc, NUM } = load(); const el = doc.createElement("span");
  NUM.set(el, 42, { kind: "counter" });
  assert.equal(allAnims(el).length, 0);
  assert.equal(vis(el).textContent, "42"); assert.equal(sr(el), "42");
  assert.equal(vis(el).attrs["aria-hidden"], "true");
  assert.equal(el.style.fontVariantNumeric, "tabular-nums"); assert.match(el.className, /smd-num/);
});

test("same value is a no-op", () => {
  const { doc, NUM } = load(); const el = doc.createElement("span");
  NUM.set(el, 5); NUM.set(el, 5);
  assert.equal(allAnims(el).length, 0);
});

test("counter: only the digits that changed roll (199 -> 209: tens and none else)", () => {
  const { doc, NUM } = load(); const el = doc.createElement("span");
  NUM.set(el, 199); NUM.set(el, 209, { kind: "counter" });
  const slots = vis(el).children.filter((c) => /smd-num-slot/.test(c.className));
  assert.equal(slots.length, 2, "tens 9->0 and hundreds 1->2 change; units 9 stays");
  assert.equal(vis(el).children[2].textContent, "9");
  const a = allAnims(el)[0];
  assert.equal(a.opts.duration, 200); assert.match(a.opts.easing, /0\.23, 1, 0\.32, 1/);
  assert.equal(sr(el), "209", "assistive tech gets the final value immediately");
  finishAll(el);
  assert.equal(vis(el).textContent, "209"); assert.equal(vis(el).children.length, 1, "collapsed to plain text");
});

test("counter: longer value gets a new leading digit", () => {
  const { doc, NUM } = load(); const el = doc.createElement("span");
  NUM.set(el, 99); NUM.set(el, 100, { kind: "counter" });
  finishAll(el); assert.equal(vis(el).textContent, "100");
});

test("clinical: out 120ms then in 180ms; only old and new values are ever rendered", () => {
  const { doc, NUM } = load(); const el = doc.createElement("span");
  NUM.set(el, 6); const seen = [vis(el).textContent];
  NUM.set(el, 9, { kind: "clinical" });
  seen.push(vis(el).textContent);
  const out = allAnims(el).find((a) => !a.cancelled);
  assert.equal(out.opts.duration, 120); assert.equal(out.frames[1].transform, "translateY(-4px)"); assert.equal(out.frames[1].opacity, 0);
  assert.equal(sr(el), "9", "final value readable at once");
  out.finish(); seen.push(vis(el).textContent);
  const inn = allAnims(el).filter((a) => !a.cancelled).pop();
  assert.equal(inn.opts.duration, 180); assert.equal(inn.frames[0].transform, "translateY(4px)");
  inn.finish(); seen.push(vis(el).textContent);
  assert.deepEqual([...new Set(seen)].sort(), ["6", "9"], "never an intermediate number");
});

test("clinical: 6 -> 19 never shows 7..18 or a partial digit swap", () => {
  const { doc, NUM } = load(); const el = doc.createElement("span");
  NUM.set(el, 6); NUM.set(el, 19, { kind: "clinical" });
  const seen = new Set();
  for (let i = 0; i < 4; i++) { seen.add(vis(el).textContent); finishAll(el); }
  seen.add(vis(el).textContent);
  assert.deepEqual([...seen].sort(), ["19", "6"]);
});

test("retarget: a new set mid-animation cancels the old one and lands on the latest value (clinical)", () => {
  const { doc, NUM } = load(); const el = doc.createElement("span");
  NUM.set(el, 1); NUM.set(el, 2, { kind: "clinical" });
  const first = allAnims(el)[0];
  NUM.set(el, 3, { kind: "clinical" });
  assert.ok(first.cancelled, "old animation cancelled");
  assert.equal(vis(el).textContent, "1", "still shows the value that was on screen, not the skipped 2");
  for (let i = 0; i < 4; i++) finishAll(el);
  assert.equal(vis(el).textContent, "3"); assert.equal(sr(el), "3");
  assert.equal(vis(el).children.length, 1);
});

test("retarget: counter mid-roll lands cleanly with no leftover slots", () => {
  const { doc, NUM } = load(); const el = doc.createElement("span");
  NUM.set(el, 10); NUM.set(el, 20); NUM.set(el, 35);
  finishAll(el);
  assert.equal(vis(el).textContent, "35"); assert.equal(vis(el).children.length, 1);
});

test("stale finish callbacks from a cancelled run do nothing", () => {
  const { doc, NUM } = load(); const el = doc.createElement("span");
  NUM.set(el, 1); NUM.set(el, 2, { kind: "clinical" });
  const stale = allAnims(el)[0]; const oldFinish = stale.onfinish;
  NUM.set(el, 3, { kind: "clinical" });
  if (oldFinish) oldFinish();
  assert.equal(vis(el).textContent, "1");
});

test("reduced motion and the localStorage kill switch swap instantly", () => {
  for (const opt of [{ reduced: true }, { kill: true }, { noWaapi: true }]) {
    const { doc, NUM } = load(opt); const el = doc.createElement("span");
    NUM.set(el, 6, { kind: "clinical" }); NUM.set(el, 9, { kind: "clinical" });
    assert.equal(allAnims(el).length, 0, JSON.stringify(opt)); assert.equal(vis(el).textContent, "9"); assert.equal(sr(el), "9");
  }
});

test("format option and live region", () => {
  const { doc, NUM } = load(); const el = doc.createElement("span");
  NUM.set(el, 1234.5, { format: (v) => v.toFixed(1) + " U", live: true });
  assert.equal(sr(el), "1234.5 U"); assert.equal(el.attrs["aria-live"], "polite");
  const el2 = doc.createElement("span"); NUM.set(el2, 3);
  assert.equal(el2.attrs["aria-live"], undefined, "polite live region only when asked");
});

test("host re-render of the children resets cleanly (no stale layers)", () => {
  const { doc, NUM } = load(); const el = doc.createElement("span");
  NUM.set(el, 1); el.textContent = "";            // host wiped our layers
  NUM.set(el, 2);
  assert.equal(vis(el).textContent, "2"); assert.equal(vis(el).parentNode, el);
});

test("SMD_SKEL.start: nothing under 300ms, skeleton after, aria-busy throughout, clean stop", () => {
  const { doc, SKEL, timers } = load(); const box = doc.createElement("div");
  const stop = SKEL.start(box, SKEL.html("list"));
  assert.equal(box.attrs["aria-busy"], "true"); assert.equal(box.children.length, 0);
  assert.equal(timers[0].ms, 300);
  timers[0].fn(); assert.equal(box.children.length, 1, "shown after the delay");
  stop(); assert.equal(box.children.length, 0); assert.equal(box.attrs["aria-busy"], undefined);
});

test("SMD_SKEL.start: a load that finishes inside 300ms never renders a skeleton", () => {
  const { doc, SKEL, timers } = load(); const box = doc.createElement("div");
  const stop = SKEL.start(box, "<i></i>");
  stop(); assert.equal(timers[0].live, false);
  if (timers[0].live) timers[0].fn(); assert.equal(box.children.length, 0); assert.equal(box.attrs["aria-busy"], undefined);
});

test("SMD_SKEL.html: busy wrapper, CSS-delayed, decorative shapes hidden from AT, label for AT", () => {
  const { SKEL } = load();
  const h = SKEL.html("lines", { rows: 3, label: "Loading list" });
  assert.match(h, /aria-busy="true"/); assert.match(h, /smd-skel-late/); assert.match(h, /aria-hidden="true"/); assert.match(h, /Loading list/);
  assert.equal((h.match(/smd-skel smd-skel-line/g) || []).length, 3);
});

test("motion.css ships the tokens, the zero-specificity press rule and reduced-motion skeleton stillness", () => {
  const css = readFileSync(new URL("../motion.css", import.meta.url), "utf8");
  for (const t of ["--smd-dur-press: 120ms", "--smd-dur-routine: 200ms", "--smd-dur-sheet: 320ms", "--smd-dur-moment: 700ms", "cubic-bezier(0.23, 1, 0.32, 1)", "cubic-bezier(0.32, 0.72, 0, 1)"]) assert.ok(css.includes(t), t);
  assert.match(css, /:where\(button[^)]*\)[^{]*:active \{\s*transform: scale\(\.97\)/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{[\s\S]*\.smd-skel \{ animation: none/);
  assert.match(css, /animation: smdSkelPulse 1\.2s/);
});
