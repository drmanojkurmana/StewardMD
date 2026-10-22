/* native-ota-progress.test.mjs - the OTA download card must never sit at a bare 0% with
 * "measuring your connection": probe transport, probe timeout/retry, and the 4 s
 * no-sample state (elapsed + indeterminate bar + size), plus the estimated state once
 * a probe sample exists. Loads the real ES5 IIFE in a vm with a stub fetch.
 * Run: node --test --experimental-test-module-mocks test/native-ota-progress.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(ROOT, "native-ota.js"), "utf8");
const MB = 1048576;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeNode() {
  const n = {
    textContent: "", innerHTML: "", hidden: false, style: {}, attrs: {},
    _classes: {},
    classList: {
      toggle: (c, on) => { n._classes[c] = !!on; },
      add: (c) => { n._classes[c] = true; },
      remove: (c) => { n._classes[c] = false; },
      contains: (c) => !!n._classes[c],
    },
    setAttribute: (k, v) => { n.attrs[k] = String(v); },
    removeAttribute: (k) => { delete n.attrs[k]; },
    getAttribute: (k) => n.attrs[k],
  };
  return n;
}
function fakeHost() {
  const host = fakeNode();
  const bySel = {};
  host.querySelector = (sel) => {
    if (!bySel[sel]) {
      bySel[sel] = fakeNode();
      if (sel === ".otp-bar") bySel[sel].firstChild = fakeNode();
    }
    return bySel[sel];
  };
  host.firstChild = fakeNode();
  host._bySel = bySel;
  return host;
}

function load(fetchImpl) {
  const store = {};
  const g = {
    console, Date, Promise, AbortController, Math, JSON, String, Number, parseInt, isNaN,
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: fetchImpl || (() => Promise.reject(new Error("no fetch stub"))),
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    document: {
      getElementById: () => ({}),
      createElement: () => fakeNode(),
      head: fakeNode(),
      documentElement: fakeNode(),
      body: fakeNode(),
    },
    SMD_IS_NATIVE: false,
  };
  g.window = g; g.self = g;
  vm.createContext(g);
  vm.runInContext(SRC, g, { filename: "native-ota.js" });
  return g;
}

test("meter: a probe sample gives speed and an estimated, rising byte count", () => {
  const { SMD_OTA } = load();
  const m = SMD_OTA._meter(100 * MB);
  m.sample(1 * MB, 1000);
  const a = m.read(Date.now() + 1000, "download");
  const b = m.read(Date.now() + 3000, "download");
  assert.ok(a.speed > 900000, "speed from sample: " + a.speed);
  assert.equal(a.est, true);
  assert.ok(b.bytes > a.bytes && b.pct > 0, "estimated bytes rise");
});

test("meter: no sample is not 'waiting', and the failure reason is kept", () => {
  const { SMD_OTA } = load();
  const m = SMD_OTA._meter(100 * MB);
  m.fail("HTTP 403");
  const r = m.read(Date.now() + 30000, "download");
  assert.equal(r.phase, "download");
  assert.equal(r.samples, 0);
  assert.equal(r.err, "HTTP 403");
  assert.ok(r.elapsed >= 29000, "elapsed is exposed for the card: " + r.elapsed);
});

test("card: no sample never shows a bare 0%, and after 4 s shows elapsed, size and a moving bar", () => {
  const { SMD_OTA } = load();
  const host = fakeHost();
  const pu = SMD_OTA.progressUI(host);
  const m = SMD_OTA._meter(Math.round(132.6 * MB));
  pu.update(0, "", m.read(Date.now() + 1000, "download"));
  const pc1 = host.querySelector(".otp-pc").textContent;
  assert.notEqual(pc1, "0%", "early no-sample state must not be a bare 0%");
  assert.equal(host.querySelector(".otp-bar")._classes.ind, true, "bar is indeterminate before any sample");
  m.fail("Load failed");
  pu.update(0, "", m.read(Date.now() + 9000, "download"));
  assert.notEqual(host.querySelector(".otp-pc").textContent, "0%");
  assert.match(host.querySelector(".otp-mb").textContent, /132\.6 MB/, "size is shown");
  assert.match(host.querySelector(".otp-sp").textContent, /\d+ s/, "elapsed seconds are shown after 4 s: " + host.querySelector(".otp-sp").textContent);
  assert.match(host.querySelector(".otp-sp").textContent, /Load failed/, "probe failure reason is shown");
  assert.equal(host.querySelector(".otp-bar")._classes.ind, true, "bar stays indeterminate without a sample");
  assert.equal(host.querySelector(".otp-bar").attrs["aria-valuenow"], undefined, "indeterminate bar has no aria-valuenow");
  assert.match(host.querySelector(".otp-bar").attrs["aria-valuetext"] || "", /speed not available/, "indeterminate bar names its state for screen readers");
});

test("card: once a sample exists it shows speed and a percent labelled as an estimate", () => {
  const { SMD_OTA } = load();
  const host = fakeHost();
  const pu = SMD_OTA.progressUI(host);
  const m = SMD_OTA._meter(100 * MB);
  m.sample(4 * MB, 1000);
  pu.update(0, "", m.read(Date.now() + 2000, "download"));
  assert.match(host.querySelector(".otp-sp").textContent, /MB\/s/, "speed shown: " + host.querySelector(".otp-sp").textContent);
  assert.match(host.querySelector(".otp-mb").textContent, /^about /, "MB labelled as estimate");
  assert.match(host.querySelector(".otp-pc").textContent, /^\d+%$/, "estimated percent shown once sampled: " + host.querySelector(".otp-pc").textContent);
  assert.notEqual(host.querySelector(".otp-bar")._classes.ind, true, "bar is determinate once sampled");
  assert.ok(host.querySelector(".otp-bar").attrs["aria-valuenow"] !== undefined, "determinate bar exposes aria-valuenow");
  assert.match(host.querySelector(".otp-bar").attrs["aria-valuetext"] || "", /estimated/, "estimated percent is named as an estimate for screen readers");
});

test("probe: on native it fetches the relative /api/ota/probe path and samples from text", async () => {
  const calls = [];
  const g = load((url, opts) => {
    calls.push({ url: String(url), opts });
    return new Promise((res) => setTimeout(() => res({ ok: true, status: 200, text: () => Promise.resolve("a".repeat(393216)) }), 5));
  });
  g.SMD_IS_NATIVE = true;
  const m = g.SMD_OTA._meter(100 * MB);
  assert.equal(typeof g.SMD_OTA._startProbe, "function", "startProbe is exposed for tests");
  const stop = g.SMD_OTA._startProbe("https://stewardmd.in/api/ota/file/" + "a".repeat(64), 100 * MB, m, 2000);
  for (let i = 0; i < 100 && m.read(Date.now(), "download").samples === 0; i++) { try { vm.runInContext("0", g); } catch (e) {} await sleep(10); }
  stop();
  assert.ok(calls.length >= 1, "probe ran");
  assert.match(calls[0].url, /^\/api\/ota\/probe\?n=393216/, "native probe uses the relative /api path native-bridge routes explicitly: " + calls[0].url);
  const pr = m.read(Date.now(), "download");
  assert.equal(pr.samples, 1, "one text sample recorded (err=" + JSON.stringify(pr.err) + ", calls=" + calls.length + ")");
});

test("probe: a hung fetch times out, records the failure and retries with a fresh signal", async () => {
  const signals = [];
  const g = load((url, opts) => { const s = opts && opts.signal; signals.push({ s, abortedAtCall: !!(s && s.aborted) }); return new Promise(() => {}); });
  g.SMD_IS_NATIVE = true;
  const m = g.SMD_OTA._meter(100 * MB);
  const stop = g.SMD_OTA._startProbe("https://stewardmd.in/api/ota/file/" + "b".repeat(64), 100 * MB, m, 60);
  await sleep(1750);
  stop();
  const r = m.read(Date.now(), "download");
  assert.equal(r.samples, 0);
  assert.match(r.err, /timed out/, "hung probe reports a timeout, not silence: " + JSON.stringify(r.err));
  assert.ok(signals.length >= 2, "probe retried after timeout (" + signals.length + " attempts)");
  assert.notEqual(signals[0].s, signals[1].s, "each attempt gets a fresh AbortSignal");
  assert.equal(signals[1].abortedAtCall, false, "the retry signal is not the aborted one");
});

test("probe: a rejected fetch records its message instead of being swallowed", async () => {
  const g = load(() => Promise.reject(new Error("Load failed")));
  const m = g.SMD_OTA._meter(100 * MB);
  const stop = g.SMD_OTA._startProbe("https://stewardmd.in/api/ota/file/" + "c".repeat(64), 100 * MB, m, 2000);
  for (let i = 0; i < 100 && !m.read(Date.now(), "download").err; i++) { try { vm.runInContext("0", g); } catch (e) {} await sleep(10); }
  stop();
  assert.equal(m.read(Date.now(), "download").err, "Load failed");
});
