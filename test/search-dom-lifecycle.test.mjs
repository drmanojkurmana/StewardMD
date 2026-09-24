/* test/search-dom-lifecycle.test.mjs — Universal search panel DOM lifecycle & touch safety:
 * Asserts:
 * 1. search.css declares [hidden] { display: none !important } on both .us-panel and .us-backdrop.
 * 2. search.css declares pointer-events: none !important on :not(.on) for panel and backdrop.
 * 3. Opening search initializes DOM with input enabled, panel display: flex, body.us-open.
 * 4. Closing search immediately sets pointer-events: none, disables the input (to drop iOS touch bar/keyboard),
 *    removes body.us-open, and on transition/timer sets display: none and hidden: true.
 * 5. Input can never be focused while closed because input.disabled is true.
 *
 * node --test test/search-dom-lifecycle.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("search.css: [hidden] override and pointer-events: none are declared", () => {
  const css = fs.readFileSync(path.join(ROOT, "search.css"), "utf8");
  assert.match(css, /\.us-backdrop\[hidden\].*?display:\s*none\s*!important/s, "us-backdrop[hidden] must have display: none !important");
  assert.match(css, /\.us-panel\[hidden\].*?display:\s*none\s*!important/s, "us-panel[hidden] must have display: none !important");
  assert.match(css, /\.us-panel:not\(\.on\)\s*\{[^}]*pointer-events:\s*none\s*!important/s, ".us-panel:not(.on) must have pointer-events: none !important");
  assert.match(css, /\.us-backdrop:not\(\.on\)\s*\{[^}]*pointer-events:\s*none\s*!important/s, ".us-backdrop:not(.on) must have pointer-events: none !important");
});

test("search.js: open and close lifecycle manages pointer-events, input disabled state, and display", async () => {
  function makeClassList() {
    const set = new Set();
    return {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
      contains: (c) => set.has(c),
      get size() { return set.size; }
    };
  }

  function makeElement(tag) {
    const listeners = {};
    const attrs = {};
    const el = {
      tagName: tag.toUpperCase(),
      style: {},
      classList: makeClassList(),
      hidden: false,
      disabled: false,
      value: "",
      innerHTML: "",
      addEventListener: (evt, fn) => {
        (listeners[evt] = listeners[evt] || []).push(fn);
      },
      removeEventListener: (evt, fn) => {
        if (listeners[evt]) listeners[evt] = listeners[evt].filter(f => f !== fn);
      },
      dispatchEvent: (e) => {
        (listeners[e.type] || []).forEach(fn => fn(e));
      },
      setAttribute: (k, v) => { attrs[k] = String(v); },
      getAttribute: (k) => attrs[k] || null,
      querySelector: (sel) => {
        if (sel === "#usInput") return el._input;
        if (sel === "#usBody") return el._body;
        if (sel === "#usChips") return el._chips;
        if (sel === "#usClear") return el._clear;
        if (sel === "#usCancel") return el._cancel;
        return null;
      },
      querySelectorAll: () => [],
      focus: () => { el._focused = true; },
      blur: () => { el._focused = false; }
    };
    return el;
  }

  const createdElements = [];
  const bodyClassList = makeClassList();
  const appendedToBody = [];

  const g = {
    document: {
      readyState: "complete",
      createElement: (tag) => {
        const el = makeElement(tag);
        createdElements.push(el);
        if (tag === "section") {
          el._input = makeElement("input");
          el._body = makeElement("div");
          el._chips = makeElement("div");
          el._clear = makeElement("button");
          el._cancel = makeElement("button");
        }
        return el;
      },
      body: {
        classList: bodyClassList,
        appendChild: (child) => { appendedToBody.push(child); }
      },
      getElementById: (id) => null,
      addEventListener: () => {}
    },
    localStorage: { getItem: () => "[]", setItem: () => {}, removeItem: () => {} },
    location: { search: "" },
    navigator: {},
    requestAnimationFrame: (fn) => setTimeout(fn, 1),
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
  };
  g.window = g; g.self = g;

  vm.createContext(g);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "search.js"), "utf8"), g, { filename: "search.js" });

  // wait for wrap() to attach globals
  await new Promise(r => setTimeout(r, 10));

  // 1. Initial state before open: panel does not leak into body yet
  assert.equal(appendedToBody.length, 0, "No panel in DOM before open");

  // 2. Open search
  g.openSearch();
  assert.equal(appendedToBody.length, 2, "Backdrop and Panel appended to body");
  const [backdrop, panel] = appendedToBody;

  assert.equal(panel.hidden, false, "Panel hidden is false on open");
  assert.equal(panel.style.display, "flex", "Panel display is flex on open");
  assert.equal(panel.style.pointerEvents, "", "Panel pointerEvents reset on open");
  assert.equal(backdrop.hidden, false, "Backdrop hidden is false on open");
  assert.equal(backdrop.style.display, "block", "Backdrop display is block on open");
  assert.equal(backdrop.style.pointerEvents, "", "Backdrop pointerEvents reset on open");
  assert.equal(bodyClassList.contains("us-open"), true, "body.us-open added");
  assert.equal(panel._input.disabled, false, "Input is enabled on open");

  // 3. Close search
  g.closeSearch();
  // Immediate checks: pointer-events shut off, input disabled, body scroll unlocked
  assert.equal(panel.style.pointerEvents, "none", "Panel pointerEvents immediately none");
  assert.equal(backdrop.style.pointerEvents, "none", "Backdrop pointerEvents immediately none");
  assert.equal(panel._input.disabled, true, "Input immediately disabled to dismiss touch bar");
  assert.equal(bodyClassList.contains("us-open"), false, "body.us-open immediately removed");

  // 4. Wait for transition timer to finish hiding the elements completely
  await new Promise(r => setTimeout(r, 260));
  assert.equal(panel.hidden, true, "Panel hidden is true after timer");
  assert.equal(panel.style.display, "none", "Panel display is none after timer");
  assert.equal(backdrop.hidden, true, "Backdrop hidden is true after timer");
  assert.equal(backdrop.style.display, "none", "Backdrop display is none after timer");

  // 5. Re-open and verify clean re-activation
  g.openSearch();
  assert.equal(panel.hidden, false, "Panel hidden false on reopen");
  assert.equal(panel.style.display, "flex", "Panel display flex on reopen");
  assert.equal(panel._input.disabled, false, "Input re-enabled on reopen");
  assert.equal(bodyClassList.contains("us-open"), true, "body.us-open added on reopen");

  // 6. Cancel button click closes search
  panel._cancel.dispatchEvent({ type: "click" });
  assert.equal(panel.style.pointerEvents, "none", "Cancel click disables pointer-events immediately");
  assert.equal(panel._input.disabled, true, "Cancel click disables input immediately");

  // 7. Backdrop touch/click closes search
  g.openSearch();
  assert.equal(panel._input.disabled, false, "Input enabled on reopen");
  backdrop.dispatchEvent({ type: "touchend", preventDefault: () => {} });
  assert.equal(panel.style.pointerEvents, "none", "Backdrop touchend disables pointer-events immediately");
  assert.equal(panel._input.disabled, true, "Backdrop touchend disables input immediately");
});
