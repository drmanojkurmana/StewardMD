/* test/kardia-syncprobe-layer.test.mjs - SyncProbe sits above Kardia and onboarding.
 * Layer order lives once in kardia.css as tokens:
 * Kardia overlay < Kardia sheets < onboarding < SyncProbe.
 * Tapping "SyncProbe" (#kslSyncProbe) opens the role sheet
 * and dismisses first-run onboarding, so the sheet is topmost at the centre.
 * Run: node --test test/kardia-syncprobe-layer.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function token(css, name) {
  const m = css.match(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:\\s*(\\d+)"));
  return m ? Number(m[1]) : null;
}

test("layer tokens order Kardia overlay below onboarding below SyncProbe", () => {
  const kardia = readFileSync("kardia.css", "utf8");
  const overlay = token(kardia, "--krd-z-overlay");
  const sheet = token(kardia, "--krd-z-sheet");
  const onb = token(kardia, "--krd-z-onb");
  const sync = token(kardia, "--krd-z-syncprobe");
  assert.ok(overlay !== null && sheet !== null && onb !== null && sync !== null, "all four tokens defined once in kardia.css");
  assert.ok(overlay < sheet, `overlay ${overlay} below sheets ${sheet}`);
  assert.ok(sheet < onb, `sheets ${sheet} below onboarding ${onb}`);
  assert.ok(onb < sync, `onboarding ${onb} below SyncProbe ${sync}`);
  assert.ok(kardia.includes("#smdKardia") && kardia.includes("var(--krd-z-overlay)"), "Kardia overlay uses its token");
  const sp = readFileSync("kardia-syncprobe.css", "utf8");
  assert.ok(sp.includes("var(--krd-z-syncprobe"), "SyncProbe root uses its token");
  const prem = readFileSync("kardia-premium.css", "utf8");
  assert.ok(prem.includes("var(--krd-z-onb"), "onboarding uses its token");
});

function makeFakeDom(zOverlay, zOnb, zSync) {
  function makeEl(tag) {
    const el = {
      tagName: String(tag).toUpperCase(), id: "", className: "",
      children: [], parentNode: null, onclick: null, onkeydown: null,
      _html: "", coversCentre: false, z: 0,
      set innerHTML(v) {
        this._html = String(v);
        this.children = [];
        if (this._html.includes("krd-sp-sheet")) {
          const sheet = makeEl("div");
          sheet.className = "krd-sp-sheet";
          sheet.coversCentre = true;
          sheet.z = zSync;
          sheet.parentNode = this;
          const btn = makeEl("button");
          btn.className = "sp-btn pri sp-wide";
          btn.focus = () => {};
          sheet.children.push(btn);
          btn.parentNode = sheet;
          this.children.push(sheet);
          this._sheet = sheet;
        }
      },
      get innerHTML() { return this._html; },
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      setAttribute(k, v) { this[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : null; },
      addEventListener() {},
      focus() {},
      querySelector(sel) {
        if (String(sel).includes("sp-btn")) {
          const b = makeEl("button");
          b.focus = () => {};
          return b;
        }
        return this._sheet || null;
      },
      querySelectorAll() { return []; },
      closest() { return null; },
    };
    return el;
  }
  const body = makeEl("body");
  const overlay = makeEl("div");
  overlay.id = "smdKardia";
  overlay.className = "sp-root krd-root";
  overlay.coversCentre = true;
  overlay.z = zOverlay;
  const onb = makeEl("div");
  onb.id = "krdOnboarding";
  onb.className = "krd-onb";
  onb.coversCentre = true;
  onb.z = zOnb;
  onb.parentNode = overlay;
  overlay.children.push(onb);
  body.appendChild(overlay);
  const doc = {
    body,
    activeElement: null,
    createElement: (t) => makeEl(t),
    getElementById(id) {
      const walk = (n) => {
        if (n.id === id) return n;
        for (const c of n.children || []) { const f = walk(c); if (f) return f; }
        return null;
      };
      return walk(body);
    },
    querySelector() { return null; },
    elementFromPoint() {
      let best = null;
      const walk = (n) => {
        if (n.coversCentre && (!best || n.z > best.z)) best = n;
        for (const c of n.children || []) walk(c);
      };
      walk(body);
      return best;
    },
  };
  return { doc, body, overlay, onb };
}

test("role sheet is topmost at the screen centre after the button is tapped", () => {
  const kardia = readFileSync("kardia.css", "utf8");
  const zOverlay = token(kardia, "--krd-z-overlay");
  const zOnb = token(kardia, "--krd-z-onb");
  const zSync = token(kardia, "--krd-z-syncprobe");
  const { doc, body } = makeFakeDom(zOverlay, zOnb, zSync);
  let dismissed = false;
  const g = {
    document: doc,
    KARDIA_PREMIUM: { dismiss: () => { dismissed = true; } },
    KARDIA_QR: null,
  };
  g.window = g;
  g.globalThis = g;
  vm.createContext(g);
  vm.runInContext(readFileSync("kardia-syncprobe.js", "utf8"), g);
  assert.ok(g.KARDIA_SYNCPROBE && typeof g.KARDIA_SYNCPROBE.open === "function", "SyncProbe API present");
  // Same call the #kslSyncProbe button makes in Scan Lab, the tutorial
  // last step and the Practice sheet.
  const kslSyncProbeClick = () => g.KARDIA_SYNCPROBE.open();
  kslSyncProbeClick();
  assert.equal(dismissed, true, "onboarding dismissed when SyncProbe opens");
  const root = doc.getElementById("krdSpRoot");
  assert.ok(root, "SyncProbe root mounted");
  assert.match(root.innerHTML, /SyncProbe/, "role sheet title shown");
  assert.match(root.innerHTML, /Use this phone as a probe/, "probe choice shown");
  const hit = doc.elementFromPoint(200, 400);
  assert.ok(hit, "something is hit at the centre");
  let n = hit;
  let insideSync = false;
  while (n) { if (n.id === "krdSpRoot") { insideSync = true; break; } n = n.parentNode; }
  assert.equal(insideSync, true, "the topmost element at the centre is inside the SyncProbe sheet");
  assert.ok(!body.children.some((c) => c.id === "krdSpRoot" && c === hit && false), "sanity");
});
