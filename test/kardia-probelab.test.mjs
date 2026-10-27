/* Echo Lab Probe Lab (owner 2026-10-26): EchoSuite Probe Lab in a frame as
 * the default Echo Lab pane, the existing Scan Lab behind a persisted
 * switch, nav hiding injected from Kardia, build and credits wiring.
 * Run: node --test --experimental-test-module-mocks --experimental-sqlite test/kardia-probelab.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);

test("build-www.sh copies kardia/probelab into www with all files", () => {
  const b = readFileSync("scripts/build-www.sh", "utf8");
  assert.ok(/cp -R kardia\/probelab\/\./.test(b), "explicit probelab copy");
  assert.ok(b.includes('"$WWW/kardia/probelab/"'), "target is www/kardia/probelab");
});

test("credits: only the resource attributions render (no author or permission statement)", () => {
  const P = require("../kardia-practice.js");
  const data = JSON.parse(readFileSync("kardia/probelab/assets/credits.json", "utf8"));
  const html = P.probeLabCreditsHtml(data, (s) => String(s));
  assert.ok(!/Kamareddine|permission/.test(html), "no author name or permission statement");
  assert.ok(html.includes("HuBMAP Human Reference Atlas"), "figures credit");
  assert.ok(html.includes("PLAX normal"), "video credit");
  const src = readFileSync("kardia-practice.js", "utf8");
  assert.ok(src.includes('probelab/assets/credits.json'), "credits screen fetches EchoSuite credits");
  assert.ok(readFileSync("vault/decisions/Decisions.md", "utf8").includes("2026-10-26 - EchoSuite Probe Lab inside Kardia"), "decision logged with date");
});

test("source: iframe pane, switch actions, nav hiding; Probe Lab bundles untouched shape", () => {
  const src = readFileSync("kardia.js", "utf8");
  assert.ok(src.includes('echoBase() + "probelab/index.html"'), "frame src is the local Probe Lab");
  assert.ok(src.includes('id="krdProbeFrame"'), "frame element");
  assert.ok(src.includes('data-act="kecho-lab"'), "switch action");
  assert.ok(src.includes('I.setPref("klab", v)'), "choice persisted in host prefs");
  assert.ok(src.includes("calculators"), "calculators nav hidden");
  assert.ok(!/[—–]/.test(src), "no em or en dashes");
  assert.ok(!/web app|browser/i.test(src), "no web or browser wording");
});

/* Behaviour: real specialty engine + kardia.js in a sandbox (same shape as kardia-host.test.mjs). */
function sandbox() {
  const store = {};
  const classes = new Set();
  const root = {
    className: "", innerHTML: "",
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    setAttribute() {}, removeAttribute() {}, addEventListener() {}, appendChild() {}, contains: () => false,
    querySelector: (sel) => (sel === ".sp-scroll" ? { insertAdjacentHTML: (pos, h) => { root.innerHTML += h; } } : null),
    focus() {}
  };
  const doc = {
    activeElement: null,
    body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {} },
    documentElement: { classList: { add() {}, remove() {}, contains: () => false } },
    createElement: () => ({ rel: "", href: "", async: false, setAttribute() {}, onload: null, onerror: null }),
    getElementById: (id) => (id === "smdKardia" ? root : null),
    querySelector: () => null, addEventListener() {}
  };
  const G = {
    document: doc, location: { search: "" },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ v: 1, tracks: [], access: { freeLevels: ["mbbs"] }, sources: {} }) }),
    SMD_PRO: { isProSync: () => false, openPaywall: () => {} },
    SMD_XACCESS: { gate: () => {} }, KARDIOX: { openLearn: () => {}, open: () => {} },
    ICONS: { get: () => "", has: () => false }
  };
  const ctx = vm.createContext(G);
  for (const f of ["specialty-core.js", "specialty-data.js", "specialty-stage.js", "specialty-shell.js", "kardia.js"])
    vm.runInContext(readFileSync(f, "utf8"), ctx, { filename: f });
  return { G, store, painted: () => root.innerHTML };
}
function btn(v) { return { getAttribute: (a) => (a === "data-v" ? v : null) }; }

test("nav injection hides leaving links and guards clicks, keeping the document otherwise", () => {
  const s = sandbox();
  const kids = [];
  const byId = {};
  const fakeDoc = {
    head: { appendChild: (el) => { kids.push(el); if (el.id) byId[el.id] = el; } },
    getElementById: (id) => byId[id] || null,
    createElement: () => ({})
  };
  const frame = { contentDocument: fakeDoc };
  assert.equal(s.G.KARDIA._kardia.probeLab.injectNav(frame), true);
  assert.equal(kids.length, 2, "one style and one guard script");
  assert.ok(byId.krdProbeHide.textContent.includes("calculators"), "style hides Calculators");
  assert.ok(byId.krdProbeHide.textContent.includes("echo-simulator"), "style hides About sheet page links");
  assert.ok(byId.krdProbeGuard.textContent.includes("preventDefault"), "guard makes page links open nothing");
  assert.equal(s.G.KARDIA._kardia.probeLab.injectNav(frame), true);
  assert.equal(kids.length, 2, "injection is idempotent");
  assert.equal(s.G.KARDIA._kardia.probeLab.injectNav(null), false, "missing frame is a plain false");
});
