/* test/maik-local-gate.test.mjs — the on-device model must actually be USED once installed.
 *
 * REPORTED 2026-08-24: "installed MaiK MxCore but the on-device AI doesn't work in MaiK".
 *
 * Cause: the debug-build probe in maik-local.js was ONE SHOT.
 *     var L = llama(); if (!L || !L.available) return;
 * Capacitor registers plugins asynchronously, so when this module loaded first the plugin was not
 * there yet, the probe gave up for good, and _debugBuild stayed false for the whole session.
 * gateActive() then read false, effective() silently downgraded "local" to "rag", and a clinician who
 * had downloaded 2.5 GB got knowledge-base answers with no explanation.
 *
 * Second defect: with the pack fully installed but the gate shut, kbOnlyNotice() fell through to
 * "only partly downloaded (100%) - select it again to resume" - nonsense advice for a model already
 * on the device.
 *
 * node --test test/maik-local-gate.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const LOCAL = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");
const ENGINE = readFileSync(new URL("../maik-engine.js", import.meta.url), "utf8");

// Load maik-local.js with a Capacitor bridge that appears LATE, as the real one does.
function loadLocal(opts) {
  opts = opts || {};
  const win = {
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout,
    Capacitor: { isNativePlatform: () => true, Plugins: {} }
  };
  win.window = win;
  new Function("window", "document", "setTimeout", "clearTimeout", LOCAL)(
    win, { addEventListener() {} }, win.setTimeout, win.clearTimeout);
  // The plugin registers only AFTER the module has already loaded and probed once.
  if (opts.pluginAfterMs != null) {
    setTimeout(() => {
      win.Capacitor.Plugins.Llama = { available: () => Promise.resolve({ available: true, debugBuild: true, loaded: false }) };
    }, opts.pluginAfterMs);
  }
  return win.SMD_MAIK_LOCAL;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("REGRESSION: a late-registering Capacitor bridge no longer closes the gate forever", async () => {
  const L = loadLocal({ pluginAfterMs: 400 });
  assert.equal(L.isDebugBuild(), false, "nothing known yet - the plugin is not there");
  await wait(1200);                       // the bridge comes up, the probe must retry and catch it
  assert.equal(L.isDebugBuild(), true,
    "once the plugin appears the probe must pick it up; the old one-shot version stayed false forever");
});

test("the probe reports whether it has actually answered yet", async () => {
  const L = loadLocal({ pluginAfterMs: 300 });
  assert.equal(typeof L.debugProbed, "function");
  assert.equal(L.debugProbed(), false, "not yet - so the UI can say 'checking' rather than 'locked'");
  await wait(1200);
  assert.equal(L.debugProbed(), true);
});

test("a plugin that never appears settles as not-a-debug-build, without throwing", async () => {
  const L = loadLocal({});                // no plugin, ever (the web PWA)
  await wait(600);
  assert.equal(L.isDebugBuild(), false);
  assert.equal(L.available(), false, "no runtime on the web build");
});

test("the probe is bounded — it cannot retry forever", () => {
  assert.match(LOCAL, /PROBE_TRIES\s*=\s*\d+/);
  assert.match(LOCAL, /PROBE_DELAY_MS\s*=\s*\d+/);
  assert.equal(/while\s*\(true\)/.test(LOCAL), false);
});

test("REGRESSION: an installed model is never described as partly downloaded", () => {
  const fn = ENGINE.slice(ENGINE.indexOf("function kbOnlyNotice()"), ENGINE.indexOf("function kbOnlyNotice()") + 2600);
  assert.match(fn, /packInstalled\(\) && !gateActive\(\)/,
    "installed-but-locked needs its own branch");
  // and that branch must come BEFORE the frac-based ones, or it never runs
  assert.ok(fn.indexOf("packInstalled() && !gateActive()") < fn.indexOf("st.frac > 0"),
    "the installed-but-locked case must be checked before the partial-download case");
  assert.match(fn, /is downloaded, but on-device answering is not unlocked/);
});

test("the notice distinguishes 'still checking' from 'locked'", () => {
  const fn = ENGINE.slice(ENGINE.indexOf("function kbOnlyNotice()"), ENGINE.indexOf("function kbOnlyNotice()") + 2600);
  assert.match(fn, /debugProbed/, "uses the probe state");
  assert.match(fn, /Still checking with the device/);
});

test("the silent downgrade is still honest about what it did", () => {
  // effective() may fall back to KB-only, but the user must be TOLD - that pairing is the contract.
  assert.match(ENGINE, /if \(p === "local" && !localReady\(\)\) return "rag";/);
  assert.match(ENGINE, /I could not answer on this device/);
});
