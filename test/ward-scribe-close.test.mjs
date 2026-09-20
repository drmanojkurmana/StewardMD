/* Item 16 audit fix: closing the ward screen mid-recording used to leave the mic running -- WARD.close()
 * never called stopWardScribe(), so the SMD_AMBIENT chunk loop kept ticking (mic open, paint() firing)
 * into a screen that no longer exists. discharge.js's close() already does this correctly
 * (`if (st.scribeCapture) stopScribe();`); ward.js now copies that shape. smd_ward_scribe is OFF by
 * default, so this was latent -- still must not ship. Same loadWard() shape as ward-scribe-append.test.mjs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard(opts) {
  opts = opts || {};
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const box = { value: "" };
  const sandbox = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: {
      getElementById: (id) => (id === "wTlNote" ? box : null),
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, body: { appendChild() {} },
      querySelector: () => null, querySelectorAll: () => [],
    },
    localStorage: { getItem: (k) => (opts.store || {})[k] || "", setItem() {}, removeItem() {} },
    fetch: () => { throw new Error("must not hit the network directly"); },
    setTimeout, clearTimeout, console, Promise, Date,
    SMD_AMBIENT: opts.ambient,
    SMD_AI: opts.ai,
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox); vm.runInContext(src, sandbox);
  sandbox.G = sandbox.window.G || sandbox;
  sandbox.G.toast = (m) => {};
  return { W: sandbox.window.WARD };
}

function ambientMock() {
  const sessions = [];
  return {
    calls: sessions,
    start(o) {
      const sess = { opts: o, stopped: 0, stop() { this.stopped++; } };
      sessions.push(sess);
      return sess;
    },
  };
}

test("closing the ward screen while the ward scribe is recording stops the capture", () => {
  const ambient = ambientMock();
  const { W } = loadWard({ store: { smd_ward_scribe: "on" }, ambient });
  W._startWardScribe();
  assert.equal(W._st.wardScribeOn, true);
  const sess = ambient.calls[0];
  assert.equal(sess.stopped, 0);

  W.close();

  assert.equal(sess.stopped, 1, "close() must stop the in-flight capture, not leave the mic open");
  assert.equal(W._st.wardScribeCapture, null);
  assert.equal(W._st.wardScribeOn, false);
});

test("closing the ward screen with the scribe already off/idle is a no-op (does not throw, does not stop a nonexistent session)", () => {
  const ambient = ambientMock();
  const { W } = loadWard({ store: { smd_ward_scribe: "on" }, ambient });
  assert.equal(W._st.wardScribeCapture, null);
  assert.doesNotThrow(() => W.close());
  assert.equal(ambient.calls.length, 0, "nothing was ever started, so nothing to stop");
});

test("closing the ward screen when the ward scribe flag is off (feature never started) still closes cleanly", () => {
  const { W } = loadWard();                            // no store -> smd_ward_scribe OFF
  assert.doesNotThrow(() => W.close());
  assert.equal(W._st.wardScribeCapture, null);
});
