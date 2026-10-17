/* codeblue-prefs.test.mjs: unit tests for the Code Blue prefs module.
 * No DOM: theme token contrast is verified programmatically (4.5:1 text,
 * 3:1 state pairs), plus defaults, validation, tile order and hidden set,
 * custom buttons, persistence round trip, apply() attributes, and a
 * no-dose scan over every user-visible string.
 * USAGE: node test/codeblue-prefs.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Prefs from "../codeblue-prefs.js";

function rgb(hex) {
  let h = String(hex).replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function lum(hex) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  let x = lum(a), y = lum(b);
  if (x < y) [x, y] = [y, x];
  return (x + 0.05) / (y + 0.05);
}
function hue(hex) {
  const [r, g, b] = rgb(hex).map((c) => c / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return null;
  const d = mx - mn;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
}
function sat(hex) {
  const [r, g, b] = rgb(hex).map((c) => c / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === 0) return 0;
  return (mx - mn) / mx;
}
function hueDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/* Expand the auto theme into its two system resolutions. */
function resolvedThemes() {
  const out = [];
  for (const id of Prefs.THEME_IDS) {
    if (id === "auto") {
      out.push(["auto (dark)", Prefs._themes["night-shift"]]);
      out.push(["auto (light)", Prefs._themes["ward-light"]]);
    } else {
      out.push([id, Prefs._themes[id]]);
    }
  }
  return out;
}

/* ---------- theme set ---------- */

test("seven themes exactly, Night Shift default", () => {
  assert.deepEqual([...Prefs.THEME_IDS].sort(), ["auto", "high-contrast", "mono", "night-shift", "red-room", "sepia-light", "ward-light"].sort());
  assert.equal(Prefs.THEME_IDS.length, 7);
  Prefs.reset();
  assert.equal(Prefs.get().theme, "night-shift");
});

test("every theme defines surfaces, lines, text and the five states", () => {
  const keys = ["bg", "surface", "ink", "muted", "line", "accent", "accentInk",
    "running", "due", "overdue", "rosc", "paused"];
  for (const [name, t] of resolvedThemes()) {
    for (const k of keys) assert.match(t[k] || "", /^#[0-9a-fA-F]{6}$/, `${name}.${k}`);
  }
});

/* ---------- programmatic contrast: fail on any miss ---------- */

test("text contrast at least 4.5:1 on every theme", () => {
  const misses = [];
  for (const [name, t] of resolvedThemes()) {
    const pairs = [
      ["ink", "bg", t.ink, t.bg], ["ink", "surface", t.ink, t.surface],
      ["muted", "bg", t.muted, t.bg], ["muted", "surface", t.muted, t.surface],
      ["accentInk", "accent", t.accentInk, t.accent],
    ];
    for (const [a, b, fa, fb] of pairs) {
      const r = ratio(fa, fb);
      if (r < 4.5) misses.push(`${name} ${a}/${b} = ${r.toFixed(2)}`);
    }
  }
  assert.equal(misses.length, 0, "text contrast misses:\n" + misses.join("\n"));
});

test("state pair contrast at least 3:1 on every theme", () => {
  const misses = [];
  for (const [name, t] of resolvedThemes()) {
    for (const s of ["running", "due", "overdue", "rosc", "paused"]) {
      const r = ratio(t[s], t.surface);
      if (r < 3) misses.push(`${name} ${s}/surface = ${r.toFixed(2)}`);
    }
  }
  assert.equal(misses.length, 0, "state contrast misses:\n" + misses.join("\n"));
});

test("state hues stay recognisable outside Mono", () => {
  const ref = {
    running: [Prefs._themes["night-shift"].running, Prefs._themes["ward-light"].running],
    due: [Prefs._themes["night-shift"].due, Prefs._themes["ward-light"].due],
    overdue: [Prefs._themes["night-shift"].overdue, Prefs._themes["ward-light"].overdue],
    rosc: [Prefs._themes["night-shift"].rosc, Prefs._themes["ward-light"].rosc],
    paused: [Prefs._themes["night-shift"].paused, Prefs._themes["ward-light"].paused],
  };
  const misses = [];
  const chromatic = ["running", "due", "overdue", "rosc"];
  for (const [name, t] of resolvedThemes()) {
    if (name === "mono") continue; /* greyscale by design; words carry state */
    for (const s of chromatic) {
      const h = hue(t[s]);
      if (h === null || sat(t[s]) < 0.15) { misses.push(`${name} ${s} is achromatic`); continue; }
      const ok = ref[s].some((r) => hueDiff(h, hue(r)) <= 45);
      if (!ok) misses.push(`${name} ${s} hue ${h.toFixed(0)} drifts from both references`);
    }
    /* Paused is a neutral by design on every theme; it must stay muted. */
    if (sat(t.paused) >= 0.6) misses.push(`${name} paused is too saturated to read as neutral`);
  }
  assert.equal(misses.length, 0, "state hue misses:\n" + misses.join("\n"));
});

/* ---------- defaults, validation, persistence ---------- */

test("defaults: standard sizes, system motion, full tile order, no customs", () => {
  Prefs.reset();
  const p = Prefs.get();
  assert.equal(p.textScale, 100);
  assert.equal(p.uiSize, "standard");
  assert.equal(p.motion, "system");
  assert.deepEqual(p.tileOrder, Prefs.TILE_IDS);
  assert.deepEqual(p.hidden, {});
  assert.deepEqual(p.custom, []);
});

test("get returns a copy", () => {
  Prefs.reset();
  const a = Prefs.get();
  a.tileOrder.push("bogus");
  assert.equal(Prefs.get().tileOrder.includes("bogus"), false);
});

test("set validates theme, text scale, sizes and motion", () => {
  Prefs.reset();
  Prefs.set({ theme: "red-room" });
  assert.equal(Prefs.get().theme, "red-room");
  Prefs.set({ theme: "nope" });
  assert.equal(Prefs.get().theme, "red-room");
  Prefs.set({ textScale: 200 });
  assert.equal(Prefs.get().textScale, 130);
  Prefs.set({ textScale: 10 });
  assert.equal(Prefs.get().textScale, 90);
  Prefs.set({ textScale: 112 });
  assert.equal(Prefs.get().textScale, 112);
  Prefs.set({ uiSize: "large" });
  assert.equal(Prefs.get().uiSize, "large");
  Prefs.set({ uiSize: "huge" });
  assert.equal(Prefs.get().uiSize, "large");
  Prefs.set({ motion: "reduce" });
  assert.equal(Prefs.get().motion, "reduce");
  Prefs.set({ motion: "sometimes" });
  assert.equal(Prefs.get().motion, "reduce");
});

test("tile order merges unknown ids out and missing tiles back in", () => {
  Prefs.reset();
  Prefs.set({ tileOrder: ["note", "bogus", "shock", "note"] });
  const order = Prefs.get().tileOrder;
  assert.deepEqual(order.slice(0, 2), ["note", "shock"]);
  assert.equal(order.length, 7);
  assert.deepEqual([...order].sort(), [...Prefs.TILE_IDS].sort());
});

test("hidden set drops unknown ids", () => {
  Prefs.reset();
  Prefs.set({ hidden: { shock: true, bogus: true } });
  assert.deepEqual(Prefs.get().hidden, { shock: true });
});

test("tiles() exposes order, hidden and custom for the live screen", () => {
  Prefs.reset();
  Prefs.set({ hidden: { epi: true } });
  const t = Prefs.tiles();
  assert.deepEqual(t.order, Prefs.TILE_IDS);
  assert.deepEqual(t.hidden, { epi: true });
  assert.deepEqual(t.custom, []);
});

test("custom buttons: label cap 14 chars, at most 4, remove works", () => {
  Prefs.reset();
  const r1 = Prefs.addCustom("  Airway help  ");
  assert.equal(r1.ok, true);
  const r2 = Prefs.addCustom("A very long label indeed");
  assert.equal(r2.ok, true);
  assert.equal(Prefs.get().custom[1].label.length <= 14, true);
  assert.equal(Prefs.addCustom("").ok, false);
  Prefs.addCustom("Third");
  Prefs.addCustom("Fourth");
  assert.equal(Prefs.addCustom("Fifth").ok, false);
  assert.equal(Prefs.get().custom.length, 4);
  assert.equal(Prefs.removeCustom("cx-999"), false);
  assert.equal(Prefs.removeCustom(Prefs.get().custom[0].id), true);
  assert.equal(Prefs.get().custom.length, 3);
});

test("preferences persist across get calls and reset restores defaults", () => {
  Prefs.reset();
  Prefs.set({ theme: "sepia-light", textScale: 130, uiSize: "small", hidden: { note: true } });
  const p = Prefs.get();
  assert.equal(p.theme, "sepia-light");
  assert.equal(p.textScale, 130);
  assert.equal(p.hidden.note, true);
  Prefs.reset();
  assert.deepEqual(Prefs.get(), Prefs._defaults());
});

test("corrupt storage falls back to defaults", () => {
  Prefs.reset();
  Prefs.set({ theme: "xyz", tileOrder: "not-an-array", custom: "nope", textScale: NaN });
  const p = Prefs.get();
  assert.equal(p.theme, "night-shift");
  assert.equal(p.tileOrder.length, 7);
});

/* ---------- apply() ---------- */

function stubRoot() {
  return {
    attrs: {}, props: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    style: { setProperty(k, v) { stubProps[k] = String(v); } },
    classList: { add() {}, remove() {} },
  };
}
let stubProps = {};
test("apply sets the data attribute hook and size tokens", () => {
  Prefs.reset();
  Prefs.set({ theme: "high-contrast", textScale: 120, uiSize: "large", motion: "reduce" });
  stubProps = {};
  const root = stubRoot();
  assert.equal(Prefs.apply(root), true);
  assert.equal(root.attrs["data-cb-theme"], "high-contrast");
  assert.equal(root.attrs["data-cb-size"], "large");
  assert.equal(root.attrs["data-cb-motion"], "reduced");
  assert.equal(stubProps["--cbp-ts"], "1.2");
  assert.equal(Prefs.apply(null), false);
});

/* ---------- focus return: a selector, never a stale node ---------- */

/* Minimal element stub: only the surface selectorFor reads. */
function stubEl({ id = "", attrs = {}, rootEl = null, openerEl = null } = {}) {
  const el = {
    id,
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
    closest(sel) {
      if (sel.includes("[data-cbp-settings]")) return openerEl;
      return rootEl;
    },
  };
  return el;
}
function stubRootEl({ id = "", classes = [] } = {}) {
  return { id, classList: { contains(c) { return classes.includes(c); } } };
}

test("focus selector re-finds the Display settings opener on each screen", () => {
  const live = stubEl({ attrs: { "data-cbp-settings": "" }, rootEl: stubRootEl({ id: "cblRoot" }) });
  assert.equal(Prefs._selectorFor(live), "#cblRoot [data-cbp-settings]");
  const trainer = stubEl({ attrs: { "data-cbp-settings": "" }, rootEl: stubRootEl({ id: "cbtRoot" }) });
  assert.equal(Prefs._selectorFor(trainer), "#cbtRoot [data-cbp-settings]");
  const ecg = stubEl({ attrs: { "data-cbp-settings": "" }, rootEl: stubRootEl({ classes: ["cbecg"] }) });
  assert.equal(Prefs._selectorFor(ecg), ".cbecg [data-cbp-settings]");
  /* A tap on the icon inside the button resolves to the button. */
  const icon = stubEl({ openerEl: live });
  icon.closest = (sel) => (sel.includes("[data-cbp-settings]") ? live : stubRootEl({ id: "cblRoot" }));
  live.closest = (sel) => stubRootEl({ id: "cblRoot" });
  assert.equal(Prefs._selectorFor(icon), "#cblRoot [data-cbp-settings]");
  assert.equal(typeof Prefs._selectorFor(live), "string");
});

test("focus selector falls back to id and data-act, else null", () => {
  assert.equal(Prefs._selectorFor(stubEl({ id: "someBtn" })), "#someBtn");
  const start = stubEl({ attrs: { "data-act": "start" }, rootEl: stubRootEl({ id: "cblRoot" }) });
  assert.equal(Prefs._selectorFor(start), "#cblRoot [data-act=\"start\"]");
  assert.equal(Prefs._selectorFor(stubEl({})), null);
  assert.equal(Prefs._selectorFor(null), null);
  assert.equal(Prefs._selectorFor({}), null);
});

test("focus target prefers the re-rendered node over a detached opener", () => {
  const stale = { isConnected: false };
  const fresh = { isConnected: true };
  const doc = { querySelector: (sel) => (sel === "#cblRoot [data-cbp-settings]" ? fresh : null), contains: (n) => n === fresh };
  assert.equal(Prefs._pickFocusTarget(doc, "#cblRoot [data-cbp-settings]", stale), fresh);
  /* Selector matches nothing and the stored node is gone: no target. */
  assert.equal(Prefs._pickFocusTarget(doc, "#gone [data-cbp-settings]", stale), null);
  /* No selector: a still connected opener is used. */
  const liveDoc = { querySelector: () => null, contains: (n) => n === fresh };
  assert.equal(Prefs._pickFocusTarget(liveDoc, null, fresh), fresh);
  assert.equal(Prefs._pickFocusTarget(null, null, null), null);
});

/* ---------- copy scan: no doses, no emojis, no em-dashes ---------- */

test("user-visible copy has no doses, emojis, em-dashes or American color", () => {
  const copy = Prefs._copy().join("\n");
  assert.match(copy, /./);
  assert.doesNotMatch(copy, /\u2014/, "no em-dashes");
  assert.doesNotMatch(copy, /\d+\s?(mg|mcg|g\/kg|mg\/kg|ml\b|units?)\b/i, "no doses");
  assert.doesNotMatch(copy, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, "no emojis");
  assert.doesNotMatch(copy, /customize|color scheme/i, "British spelling");
});
