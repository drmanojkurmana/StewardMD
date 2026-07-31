/* Smoke test for dialog-motion.js — the app-wide Motion One spring open/close engine.
 * It's a DOM/MutationObserver module (mirrors syndromes-motion.js), so this asserts it LOADS cleanly,
 * wires a class-observing MutationObserver by default, and fully no-ops under the kill-switch. */
import fs from "node:fs";
import assert from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fs.readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "dialog-motion.js"), "utf8");

function load(flag) {
  const observed = [];
  globalThis.window = globalThis;
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.localStorage = { getItem: (k) => (k === "smd_dialog_motion" ? flag : null) };
  globalThis.requestIdleCallback = () => {};                 // don't kick the loader in the test
  globalThis.Motion = undefined;
  globalThis.MutationObserver = class { constructor(cb) { this.cb = cb; } observe(t, o) { observed.push(o); } disconnect() {} };
  globalThis.document = {
    readyState: "complete", getElementById: () => null,
    createElement: () => ({ setAttribute() {}, style: {} }),
    head: { appendChild() {} }, documentElement: {}, addEventListener() {},
  };
  // eslint-disable-next-line no-new-func
  new Function(SRC)();                                        // the IIFE self-invokes; must not throw
  return observed;
}

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("✅ " + m); pass++; };

const obs = load(null);
ok(obs.length >= 1, "module loads and attaches a MutationObserver by default");
ok(obs.some((o) => o.attributes && o.attributeFilter && o.attributeFilter.includes("class") && o.childList), "observes class toggles + inserted dialogs (subtree)");

const offObs = load("0");
ok(offObs.length === 0, "kill-switch (smd_dialog_motion=0) fully no-ops — no observer attached");

// static shape guards so the families/guards can't silently regress
ok(/prefers-reduced-motion/.test(SRC) && /window\.Motion/.test(SRC), "respects reduced-motion + uses window.Motion (enhancement-only)");
ok(/translateY\(100%\)/.test(SRC) && /scale\(0\.94\)/.test(SRC), "bottom-sheet slide + modal scale springs defined");

console.log(`\nALL ${pass} PASS — dialog-motion loads, wires the observer, and fails safe`);
