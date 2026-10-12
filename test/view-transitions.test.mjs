import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Regression test: view-transitions.js must never hold (swallow + async-replay) a tap that
// starts inside a modal dialog. Module overlays (Tokos #smdTokos, PrepNucleus #smdPrep, Narke
// #smdNarke: all role=dialog) apply taps synchronously, and the Tokos harness asserts the
// caliper steppers are already in the DOM in the same tick as the clinic tap. Holding that
// tap for a view transition leaves the first markup empty (browser job: "caliper steppers
// carry text and an aria-label in the first markup").
//
// No browser here: stub the globals the module touches and drive its document-level capture
// listener directly. Without the overlay guard the dialog tap is held (startViewTransition
// called, original click swallowed); with it the tap passes through untouched, while a plain
// home-screen row is still held for its morph.

const vtCalls = [];
const clickListeners = [];
globalThis.innerWidth = 390;
globalThis.innerHeight = 844;
globalThis.getComputedStyle = () => ({ fontWeight: "700", fontSize: "15px", visibility: "visible" });
globalThis.window = {};
globalThis.document = {
  startViewTransition(cb) { vtCalls.push(cb); return { finished: Promise.resolve() }; },
  createElement() { return {}; },
  head: { appendChild() {} },
  documentElement: {},
  addEventListener(type, fn) { (clickListeners[type] = clickListeners[type] || []).push(fn); },
};

const require = createRequire(import.meta.url);
const VT = require("../view-transitions.js");
const onClick = (clickListeners.click || [])[0];

function makeRow(inDialog) {
  const leaf = { children: [], textContent: "CTG reading", style: {} };
  const row = {
    disabled: false, tagName: "BUTTON", style: {},
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 360, height: 70, top: 100, bottom: 170, left: 0, right: 360 }),
    querySelectorAll: () => [leaf],
    closest(sel) {
      if (/dialog|aria-modal/.test(sel)) return inDialog ? {} : null;
      return sel.indexOf("button") >= 0 ? row : null;
    },
  };
  return row;
}
function clickOn(row) {
  const target = { closest: (sel) => row.closest(sel) };
  const ev = {
    target, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    defaultPrevented: false, stopped: false,
    clientX: 1, clientY: 1, screenX: 1, screenY: 1, detail: 1,
    stopImmediatePropagation() { this.stopped = true; },
    preventDefault() { this.defaultPrevented = true; },
  };
  onClick(ev);
  return ev;
}

test("seam: inOverlay detects modal dialogs", () => {
  assert.equal(typeof VT.inOverlay, "function");
  assert.equal(VT.inOverlay(null), false);
  assert.equal(VT.inOverlay({}), false);
  assert.equal(VT.inOverlay({ closest: () => null }), false);
  assert.equal(VT.inOverlay({ closest: (s) => (/dialog|aria-modal/.test(s) ? {} : null) }), true);
});

test("a row inside role=dialog is not held: the tap stays synchronous", () => {
  assert.ok(onClick, "the capture-phase click listener is registered");
  const before = vtCalls.length;
  const ev = clickOn(makeRow(true));
  assert.equal(vtCalls.length, before, "no view transition starts for a dialog tap");
  assert.equal(ev.stopped, false, "the original click is not swallowed");
  assert.equal(ev.defaultPrevented, false, "the original click is not cancelled");
});

test("a home-screen row is still held for its morph (no over-correction)", () => {
  const before = vtCalls.length;
  const ev = clickOn(makeRow(false));
  assert.equal(vtCalls.length, before + 1, "a plain row still runs a view transition");
  assert.equal(ev.stopped, true);
  assert.equal(ev.defaultPrevented, true);
});
