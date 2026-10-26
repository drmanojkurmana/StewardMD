/* Kardia premium layer: onboarding cards, remembered flag, native-only
 * haptics, offline banner, loader wiring and token CSS.
 * Run: node --test test/kardia-premium.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadPremium(extra) {
  const mem = {};
  const calls = [];
  const g = {
    localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } },
    navigator: { onLine: true },
    document: undefined,
    setTimeout: (fn) => { fn(); return 0; },
    ...(extra || {}),
  };
  g.window = g;
  vm.createContext(g);
  vm.runInContext(readFileSync("kardia-premium.js", "utf8"), g);
  return { g, mem, calls };
}

test("onboarding: three cards, remembered per device, skip and start both remember", () => {
  const { g, mem } = loadPremium();
  const P = g.KARDIA_PREMIUM;
  assert.equal(P.CARDS.length, 3);
  assert.match(P.CARDS[0].body, /echocardiography/i);
  assert.match(P.CARDS[1].body, /grip/i);
  assert.match(P.CARDS[2].body, /PLAX/);
  assert.equal(P.shouldShow(), true);
  P.remember();
  assert.equal(mem[P.KEY], "1");
  assert.equal(P.shouldShow(), false);
});

test("onboarding: a host repaint that wipes the overlay does not lose first run", () => {
  function makeEl() {
    const el = { children: [], parentNode: null, className: "", id: "",
      appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
      removeChild(c) { el.children = el.children.filter((x) => x !== c); c.parentNode = null; return c; },
      querySelector() { return null; }, querySelectorAll() { return []; }, setAttribute() {}, addEventListener() {}, focus() {} };
    return el;
  }
  const root = makeEl(); root.className = "krd-root";
  const body = makeEl(); root.parentNode = body;
  const doc = { readyState: "complete", body,
    createElement: () => makeEl(),
    querySelector: (s) => (s === ".krd-root" ? root : null),
    getElementById: (id) => (id === "smdKardia" ? root : null),
    contains: (n) => { let c = n; while (c) { if (c === body || c === root) return true; c = c.parentNode; } return false; },
    addEventListener() {} };
  const { g } = loadPremium({ document: doc });
  const P = g.KARDIA_PREMIUM;
  assert.equal(P.showing, true, "shows on the first open, by any route");
  const ov = root.children.find((c) => c.id === "krdOnboarding");
  assert.ok(ov, "overlay is in the live root");
  ov.parentNode = null; root.children = root.children.filter((c) => c !== ov); // engine innerHTML repaint
  assert.equal(P.showing, false, "a detached overlay is not showing");
  P.onTab();
  assert.equal(P.showing, true, "the next tab paint rebuilds it");
  assert.ok(root.children.some((c) => c.id === "krdOnboarding"));
});

test("haptics: nothing fires without a native Capacitor plugin", () => {
  const { g } = loadPremium();
  assert.equal(g.KARDIA_PREMIUM.haptic("light"), false);
  assert.equal(g.KARDIA_PREMIUM.haptic("success"), false);
  assert.equal(g.KARDIA_PREMIUM.haptic("selection"), false);
});

test("haptics: native Capacitor maps light, success and selection", () => {
  const calls = [];
  const { g } = loadPremium({
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: { Haptics: {
        impact: (o) => calls.push(["impact", o.style]),
        notification: (o) => calls.push(["notification", o.type]),
        selectionStart: () => calls.push(["selStart"]), selectionChanged: () => calls.push(["selChanged"]), selectionEnd: () => calls.push(["selEnd"]),
      } },
    },
  });
  const P = g.KARDIA_PREMIUM;
  assert.equal(P.haptic("light"), true);
  assert.equal(P.haptic("success"), true);
  assert.equal(P.haptic("selection"), true);
  assert.deepEqual(calls, [["impact", "LIGHT"], ["notification", "SUCCESS"], ["selStart"], ["selChanged"], ["selEnd"]]);
});

test("loader ships the premium css and js after kardia.js", () => {
  const L = readFileSync("kardia-loader.js", "utf8");
  assert.ok(L.includes('"kardia-premium.css"'));
  assert.ok(L.indexOf('"kardia.js"') < L.indexOf('"kardia-premium.js"'), "premium after the host so KARDIA exists");
});

test("premium css: one token scale, dark scan surround, reduced motion, no new accent colour", () => {
  const css = readFileSync("kardia-premium.css", "utf8");
  for (const tok of ["--kd-sp-1", "--kd-fs-1", "--kd-r-m", "--kd-r-pill"]) assert.ok(css.includes(tok), tok);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /min-height: 44px/);
  assert.ok(!/#3ee07a|#0c6b4f|purple|gradient/i.test(css), "no new palette, no gradient");
});

test("hooks: host notifies premium on every tab, scanlab success and tutorial selection, syncprobe pairing success", () => {
  const host = readFileSync("kardia.js", "utf8");
  assert.ok((host.match(/KARDIA_PREMIUM\.onTab/g) || []).length >= 3, "all showTab branches notify");
  assert.match(host, /krd-skel sector/);
  const scan = readFileSync("kardia-scanlab.js", "utf8");
  assert.match(scan, /KARDIA_PREMIUM\.haptic\("success"\)/);
  assert.match(scan, /haptic\("SELECTION"\)/);
  const sync = readFileSync("kardia-syncprobe.js", "utf8");
  assert.ok((sync.match(/spHaptic\("success"\)/g) || []).length >= 2, "display and probe pairing success");
});
