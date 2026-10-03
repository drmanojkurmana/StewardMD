// capture-guard.js: the lesson-image screen-capture guard, run in a vm with a small fake DOM and
// a mocked Capacitor CaptureGuard plugin. Covers: Android FLAG_SECURE follows image presence,
// iOS overlay class follows captureChange, the iOS screenshot notice (on any screenshot in the app,
// English/Hindi, throttled), and the silent no-op on web.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../capture-guard.js", import.meta.url), "utf8");
const REAL = "tokos/learn/media/real/gy1-uterus.webp";

function makeEnv({ native = true, platform = "android", pluginAvailable = true, withToast = true, pageLang = null } = {}) {
  const timers = [];
  const observers = [];
  const listeners = {};
  const calls = { setSecure: [], toast: [] };
  const classes = new Set();

  function el(tag, attrs = {}, parent = null) {
    const a = Object.assign({}, attrs);
    const e = {
      tagName: tag.toUpperCase(), parentElement: parent, rect: { top: 10, left: 10, bottom: 210, right: 310, width: 300, height: 200 },
      position: "static", currentSrc: "",
      getAttribute: (k) => (k in a ? a[k] : null),
      setAttribute: (k, v) => { a[k] = String(v); },
      hasAttribute: (k) => k in a,
      removeAttribute: (k) => { delete a[k]; },
      getBoundingClientRect: () => e.rect,
      closest: (sel) => { const m = /^\[(\w+)\]$/.exec(sel); let n = e; while (n) { if (m && n.hasAttribute(m[1])) return n; n = n.parentElement; } return null; },
      attrs: a,
    };
    return e;
  }
  const imgs = [];
  const head = { children: [], appendChild(c) { this.children.push(c); } };
  const documentElement = {
    clientWidth: 390, clientHeight: 844, getAttribute: (k) => (k === "lang" ? pageLang : null),
    classList: { toggle: (c, on) => { on ? classes.add(c) : classes.delete(c); }, contains: (c) => classes.has(c) },
  };
  const document = {
    readyState: "complete", head, documentElement,
    getElementsByTagName: (t) => (t === "img" ? imgs : []),
    createElement: (t) => ({ tagName: t, textContent: "" }),
    addEventListener() {},
  };
  const plugin = {
    addListener: (name, fn) => { listeners[name] = fn; return Promise.resolve({ remove() {} }); },
    getState: () => Promise.resolve({ captured: false, platform }),
    setSecure: (o) => { calls.setSecure.push(o.secure); return Promise.resolve({ applied: platform === "android" }); },
  };
  const window = {
    innerWidth: 390, innerHeight: 844,
    addEventListener() {},
    getComputedStyle: (e) => ({ position: e.position }),
    MutationObserver: class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} },
    Capacitor: native === null ? undefined : {
      isNativePlatform: () => native,
      getPlatform: () => (native ? platform : "web"),
      isPluginAvailable: (n) => pluginAvailable && n === "CaptureGuard",
      Plugins: pluginAvailable ? { CaptureGuard: plugin } : {},
    },
  };
  if (withToast) window.toast = (m) => calls.toast.push(m);
  const ctx = {
    window, document, Date,
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout() {},
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const flush = () => { while (timers.length) timers.shift()(); };
  function addImg(src, { lang, rect, parentPosition } = {}) {
    const root = el("div", lang ? { lang } : {});
    const parent = el("button", {}, root);
    if (parentPosition) parent.position = parentPosition;
    const img = el("img", { src }, parent);
    if (rect) img.rect = rect;
    imgs.push(img);
    return img;
  }
  function removeImg(img) { imgs.splice(imgs.indexOf(img), 1); }
  const mutate = () => { observers.forEach((o) => o.cb([])); flush(); };
  return { window, document, calls, listeners, classes, head, flush, addImg, removeImg, mutate, guard: window.SMD_CaptureGuard, observers };
}

test("android: FLAG_SECURE turns on while a real image is on screen and off when it leaves", () => {
  const env = makeEnv({ platform: "android" });
  assert.deepEqual(env.calls.setSecure, [false], "initial scan reports no image");
  const img = env.addImg("/" + REAL);
  env.mutate();
  assert.deepEqual(env.calls.setSecure, [false, true]);
  env.mutate();
  assert.deepEqual(env.calls.setSecure, [false, true], "no repeat call while state is unchanged");
  env.removeImg(img);
  env.mutate();
  assert.deepEqual(env.calls.setSecure, [false, true, false]);
});

test("android: an off-screen or zero-size real image does not set FLAG_SECURE", () => {
  const env = makeEnv({ platform: "android" });
  env.addImg(REAL, { rect: { top: 2000, left: 0, bottom: 2200, right: 300, width: 300, height: 200 } });
  env.addImg(REAL, { rect: { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 } });
  env.mutate();
  assert.deepEqual(env.calls.setSecure, [false]);
});

test("only /learn/media/real/ images count, for any module", () => {
  const env = makeEnv({ platform: "android" });
  env.addImg("tokos/learn/media/gy1-uterus.svg");
  env.addImg("https://cdn.example/ophthalmos/learn/diagram.webp");
  env.mutate();
  assert.deepEqual(env.calls.setSecure, [false]);
  env.addImg("https://img.stewardmd.in/ophthalmos/learn/media/real/oct-1.webp");
  env.mutate();
  assert.deepEqual(env.calls.setSecure, [false, true]);
});

test("containers are marked; static ones get the 's' marker so the overlay can position", () => {
  const env = makeEnv({ platform: "ios" });
  const a = env.addImg(REAL);
  const b = env.addImg(REAL, { parentPosition: "relative" });
  const c = env.addImg("other/learn/media/x.webp");
  env.mutate();
  assert.equal(a.parentElement.getAttribute("data-smd-cg"), "s");
  assert.equal(b.parentElement.getAttribute("data-smd-cg"), "p");
  assert.equal(c.parentElement.getAttribute("data-smd-cg"), null);
  const css = env.head.children[0].textContent;
  assert.match(css, /html\.smd-cg-on \[data-smd-cg\]::after\{/);
  assert.match(css, /pointer-events:none/);
  assert.match(css, /html\.smd-cg-on \[data-smd-cg="s"\]\{position:relative\}/);
});

test("ios: captureChange toggles the overlay class on <html>, and setSecure is never sent", () => {
  const env = makeEnv({ platform: "ios" });
  env.addImg(REAL);
  env.mutate();
  assert.equal(env.classes.has("smd-cg-on"), false, "clean by default");
  env.listeners.captureChange({ captured: true });
  assert.equal(env.classes.has("smd-cg-on"), true);
  env.listeners.captureChange({ captured: false });
  assert.equal(env.classes.has("smd-cg-on"), false);
  assert.deepEqual(env.calls.setSecure, [], "iOS does not call setSecure");
});

test("screenshot shows the notice on any screenshot in the app (owner 2026-10-01), throttled", () => {
  const env = makeEnv({ platform: "ios" });
  env.listeners.screenshot({});
  assert.deepEqual(env.calls.toast, ["Images are \u00a9\u00a0StewardMD. Please do not share."], "no image on screen: notice still shown");
  env.addImg(REAL);
  env.listeners.screenshot({});
  env.listeners.screenshot({});
  assert.equal(env.calls.toast.length, 1, "one notice per burst");
  assert.doesNotMatch(env.calls.toast[0], /—/, "no em-dash");
});

test("screenshot with no image follows the page language", () => {
  const env = makeEnv({ platform: "ios", pageLang: "hi" });
  env.listeners.screenshot({});
  assert.equal(env.calls.toast.length, 1);
  assert.match(env.calls.toast[0], /[ऀ-ॿ]/, "Devanagari");
});

test("screenshot notice is in Hindi when the lesson is in Hindi", () => {
  const env = makeEnv({ platform: "ios" });
  env.addImg(REAL, { lang: "hi" });
  env.listeners.screenshot({});
  assert.equal(env.calls.toast.length, 1);
  assert.match(env.calls.toast[0], /StewardMD/);
  assert.match(env.calls.toast[0], /[ऀ-ॿ]/, "Devanagari");
  assert.doesNotMatch(env.calls.toast[0], /—/);
});

test("missing toast helper: screenshot is silent, no throw", () => {
  const env = makeEnv({ platform: "ios", withToast: false });
  env.addImg(REAL);
  assert.doesNotThrow(() => env.listeners.screenshot({}));
});

for (const [name, opts] of [
  ["web (not native)", { native: false }],
  ["no Capacitor at all", { native: null }],
  ["native build without the plugin", { native: true, pluginAvailable: false }],
]) {
  test(`silent no-op: ${name}`, () => {
    const env = makeEnv(opts);
    env.addImg(REAL);
    env.mutate();
    assert.equal(env.guard.state().active, false);
    assert.equal(env.head.children.length, 0, "no stylesheet injected");
    assert.equal(env.observers.length, 0, "no observer installed");
    assert.deepEqual(env.calls.setSecure, []);
    assert.equal(env.classes.has("smd-cg-on"), false);
  });
}

test("wired into the app: index.html loads it with a cache token, the tile has the logo", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<script src="\/capture-guard\.js\?v=[\w-]+" defer><\/script>/);
  const m = /var TILE = "data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)"/.exec(SRC);
  assert.ok(m, "tile present");
  const svg = Buffer.from(m[1], "base64").toString("utf8");
  assert.match(svg, /StewardMD<\/text>/);
  assert.match(svg, /rotate\(-28/);
  assert.match(svg, /data:image\/png;base64,/);
});
