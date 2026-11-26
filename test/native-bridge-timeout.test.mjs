/* test/native-bridge-timeout.test.mjs
 * REGRESSION: Android SocketTimeoutException on AI drafts > 30 s
 *
 * Bug G: nativeApiFetch had readTimeout hard-coded to 30000 ms. Any AI draft
 * that takes longer than 30 s on Android dies with java.net.SocketTimeoutException.
 * Fix: honour init.readTimeout or init.timeout (capped at 180000, min 1 ms);
 * fall back to 30000 when neither is supplied.
 *
 * node --test test/native-bridge-timeout.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "native-bridge.js"), "utf8");

/**
 * Build a minimal Capacitor environment with enough browser shims for
 * native-bridge.js to reach its fetch-patch block, then call the patched
 * window.fetch on an api.stewardmd.in URL so it routes through nativeApiFetch
 * -> CapacitorHttp.request. Returns the reqOpts captured from that call.
 *
 * @param {object} initOverrides - merged into the fetch init (may include readTimeout / timeout)
 * @returns {Promise<{readTimeout:number, connectTimeout:number}>}
 */
function captureReqOpts(initOverrides) {
  return new Promise(function (resolve, reject) {
    var captured = null;
    var httpStub = {
      request: function (opts) {
        captured = opts;
        return Promise.resolve({
          status: 200,
          headers: { "content-type": "application/json" },
          data: "{}"
        });
      }
    };

    var win = {
      document: {
        addEventListener: function () {},
        querySelector: function () { return null; },
        documentElement: {},
        readyState: "complete"
      },
      addEventListener: function () {},
      location: { search: "" },
      navigator: { userAgent: "Android" },
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      setInterval: setInterval,
      clearInterval: clearInterval,
      // native-bridge.js calls requestAnimationFrame; without it the VM throws
      // before reaching the fetch-patch block
      requestAnimationFrame: function (fn) { return setTimeout(fn, 16); },
      cancelAnimationFrame: clearTimeout,
      Promise: Promise,
      // Expose the stub BOTH on Plugins.CapacitorHttp AND as window.CapacitorHttp
      // (the Http() helper checks both paths)
      CapacitorHttp: httpStub,
      Capacitor: {
        getPlatform: function () { return "android"; },
        isNativePlatform: function () { return true; },
        Plugins: {
          CapacitorHttp: httpStub
        }
      }
    };
    win.window = win;
    win.self = win;
    win.globalThis = win;
    // A minimal fetch the bridge can wrap and patch
    win.fetch = function () {
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve("{}"); } });
    };
    win.Response = Response;
    win.Headers = Headers;
    win.Request = Request;

    try {
      vm.runInContext(src, vm.createContext(win));
    } catch (e) {
      // Bridge may throw on later shims it doesn't need for the fetch patch — ignore
    }

    // The bridge's patched window.fetch routes https://api.stewardmd.in/* through
    // nativeApiFetch which calls Http().request with the full reqOpts.
    var init = Object.assign({ method: "POST", headers: {}, body: "{}" }, initOverrides);
    win.fetch("https://api.stewardmd.in/v1/projects/x/ai-draft", init)
      .then(function () {
        if (!captured) return reject(new Error("CapacitorHttp.request was never called"));
        resolve({ readTimeout: captured.readTimeout, connectTimeout: captured.connectTimeout });
      })
      .catch(function (e) {
        if (!captured) return reject(new Error("fetch rejected AND CapacitorHttp was not called: " + (e && e.message)));
        resolve({ readTimeout: captured.readTimeout, connectTimeout: captured.connectTimeout });
      });
  });
}

// --- static source-level checks (synchronous) --------------------------------

test("REGRESSION: readTimeout is no longer hard-coded — dynamic expression present", function () {
  // The old code had: connectTimeout: 30000, readTimeout: 30000  (literal pair)
  assert.doesNotMatch(
    src,
    /connectTimeout:\s*30000,\s*readTimeout:\s*30000/,
    "hard-coded readTimeout: 30000 must be removed from reqOpts"
  );
  assert.match(src, /readTimeout:/, "readTimeout must still appear in reqOpts");
  assert.match(src, /180000/, "cap of 180000 ms must be present in native-bridge.js");
  assert.match(src, /connectTimeout:\s*30000/, "connectTimeout must stay at 30000 ms");
});

// --- runtime behaviour checks (async, via VM) --------------------------------

test("default readTimeout is 30000 when no timeout supplied in init", async function () {
  var opts = await captureReqOpts({});
  assert.equal(opts.readTimeout, 30000, "default must be 30000 ms");
  assert.equal(opts.connectTimeout, 30000, "connectTimeout must remain 30000 ms");
});

test("init.readTimeout is forwarded (AI draft scenario: 90000 ms)", async function () {
  var opts = await captureReqOpts({ readTimeout: 90000 });
  assert.equal(opts.readTimeout, 90000);
  assert.equal(opts.connectTimeout, 30000);
});

test("init.timeout is used when readTimeout is absent (research.js compat)", async function () {
  var opts = await captureReqOpts({ timeout: 90000 });
  assert.equal(opts.readTimeout, 90000);
  assert.equal(opts.connectTimeout, 30000);
});

test("readTimeout is capped at 180000 ms", async function () {
  var opts = await captureReqOpts({ readTimeout: 999999 });
  assert.equal(opts.readTimeout, 180000, "must be capped at 180 s");
});

test("init.timeout is also capped at 180000 ms", async function () {
  var opts = await captureReqOpts({ timeout: 500000 });
  assert.equal(opts.readTimeout, 180000);
});

test("zero readTimeout falls back to 30000 (not a valid timeout)", async function () {
  var opts = await captureReqOpts({ readTimeout: 0 });
  assert.equal(opts.readTimeout, 30000);
});

test("negative readTimeout falls back to 30000", async function () {
  var opts = await captureReqOpts({ readTimeout: -1 });
  assert.equal(opts.readTimeout, 30000);
});

test("init.readTimeout takes precedence over init.timeout", async function () {
  var opts = await captureReqOpts({ readTimeout: 60000, timeout: 90000 });
  assert.equal(opts.readTimeout, 60000, "readTimeout must win over timeout");
});
