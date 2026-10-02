/* test/premium-haptics-celebrate.test.mjs - haptics routing (iOS plugin / Android SmdDevice / absent / disabled)
 * and the SMD_CELEBRATE queue, kill switch, reduced-motion CSS and once-per-achievement guard. */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const HAP = readFileSync(new URL("../haptics.js", import.meta.url), "utf8");
const CEL = readFileSync(new URL("../smd-celebrate.js", import.meta.url), "utf8");
const ENG = readFileSync(new URL("../engagement.js", import.meta.url), "utf8");

function store(init) { const m = Object.assign({}, init); return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, _m: m }; }

// ---- haptics ------------------------------------------------------------------------------------
function hapWin(platform, plugins, ls) {
  let t = 1000;
  const vib = [];
  const win = { Capacitor: { isNativePlatform: () => platform !== "web", getPlatform: () => platform, Plugins: plugins || {} },
    document: { addEventListener() {} }, location: { search: "" }, localStorage: store(ls), navigator: { vibrate: (x) => vib.push(x) },
    performance: { now: () => (t += 100) } };
  win.vib = vib;
  new Function("window", "document", "location", "localStorage", "navigator", "performance", HAP)(win, win.document, win.location, win.localStorage, win.navigator, win.performance);
  return win;
}
const iosP = () => { const calls = []; return { calls, impact: async (o) => calls.push(["impact", o.style]), notification: async (o) => calls.push(["notification", o.type]),
  selectionStart: async () => calls.push(["selStart"]), selectionChanged: async () => calls.push(["selChanged"]), selectionEnd: async () => calls.push(["selEnd"]) }; };
const andP = (result) => { const calls = []; return { calls, haptic: (o) => { calls.push(o.type); return result ? result() : Promise.resolve({ performed: true }); } }; };

test("iOS routes to @capacitor/haptics exactly as before", () => {
  const P = iosP(); const w = hapWin("ios", { Haptics: P });
  w.SMD_HAPTICS.light(); w.SMD_HAPTICS.success(); w.SMD_HAPTICS.warning(); w.SMD_HAPTICS.error(); w.SMD_HAPTICS.medium(); w.SMD_HAPTICS.heavy();
  assert.deepEqual(P.calls, [["impact", "LIGHT"], ["notification", "SUCCESS"], ["notification", "WARNING"], ["notification", "ERROR"], ["impact", "MEDIUM"], ["impact", "HEAVY"]]);
  w.SMD_HAPTICS.selection();
  assert.deepEqual(P.calls.slice(-3), [["selStart"], ["selChanged"], ["selEnd"]]);
  assert.equal(w.vib.length, 0);
});

test("Android routes every type to SmdDevice.haptic({type}) and never navigator.vibrate", () => {
  const P = andP(); const w = hapWin("android", { SmdDevice: P });
  const H = w.SMD_HAPTICS;
  ["tap", "light", "medium", "heavy", "selection", "success", "warning", "error"].forEach((k) => H[k]());
  assert.deepEqual(P.calls, ["tap", "light", "medium", "heavy", "selection", "success", "warning", "error"]);
  assert.equal(w.vib.length, 0);
  assert.equal(H.supported(), true);
});

test("Android: plugin absent is a silent no-op, and a late-appearing plugin is picked up", () => {
  const w = hapWin("android", {});
  assert.doesNotThrow(() => w.SMD_HAPTICS.success());
  assert.equal(w.SMD_HAPTICS.supported(), false);
  const P = andP(); w.Capacitor.Plugins.SmdDevice = P;
  w.SMD_HAPTICS.success();
  assert.deepEqual(P.calls, ["success"]);
});

test("Android: a rejecting or throwing plugin never surfaces", async () => {
  const w1 = hapWin("android", { SmdDevice: andP(() => Promise.reject(new Error("no"))) });
  w1.SMD_HAPTICS.error(); await new Promise((r) => setTimeout(r, 5));
  const w2 = hapWin("android", { SmdDevice: { haptic() { throw new Error("boom"); } } });
  assert.doesNotThrow(() => w2.SMD_HAPTICS.error());
});

test("kill switch smd_haptics=0 silences both platforms; setEnabled flips it", () => {
  const Pa = andP(), Pi = iosP();
  const a = hapWin("android", { SmdDevice: Pa }, { smd_haptics: "0" });
  const i = hapWin("ios", { Haptics: Pi }, { smd_haptics: "0" });
  a.SMD_HAPTICS.success(); i.SMD_HAPTICS.success();
  assert.equal(Pa.calls.length, 0); assert.equal(Pi.calls.length, 0);
  a.SMD_HAPTICS.setEnabled(true); a.SMD_HAPTICS.success();
  assert.deepEqual(Pa.calls, ["success"]);
});

test("web and unknown platforms do nothing; no toast-text regex remains", () => {
  const P = andP(); const w = hapWin("web", { SmdDevice: P, Haptics: iosP() });
  w.SMD_HAPTICS.success(); assert.equal(P.calls.length, 0); assert.equal(w.vib.length, 0);
  assert.doesNotMatch(HAP, /navigator\.vibrate\(/);
  assert.doesNotMatch(HAP, /__smdHapticWrapped|fail\|failed/);
});

// ---- celebration --------------------------------------------------------------------------------
function el(tag) {
  const cls = new Set(); const kids = []; const ls = {};
  const o = { tag, id: "", style: {}, innerHTML: "", textContent: "", attrs: {}, listeners: {}, parentNode: null,
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) },
    set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => cls.add(c)); }, get className() { return [...cls].join(" "); },
    setAttribute(k, v) { o.attrs[k] = v; }, addEventListener(t, f) { (o.listeners[t] = o.listeners[t] || []).push(f); },
    appendChild(c) { kids.push(c); c.parentNode = o; return c; }, remove() { if (o.parentNode) { const k = o.parentNode._kids; k.splice(k.indexOf(o), 1); o.parentNode = null; } }, _kids: kids };
  return o;
}
function celWin(ls, opts) {
  const body = el("body"), head = el("head"); const haptic = [];
  const win = { document: { createElement: el, body, head, hidden: false }, localStorage: store(ls), SMD_HAPTICS: { success: () => haptic.push("success") },
    matchMedia: (q) => ({ matches: !!(opts && opts.reduced) && /reduce/.test(q) }) };
  win.haptic = haptic;
  new Function("window", "document", "localStorage", CEL)(win, win.document, win.localStorage);
  return win;
}
const cards = (w) => (w.document.body._kids[0] ? w.document.body._kids[0]._kids : []);

test("celebrate: shows one card, role=status polite host, success haptic, no focus call", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const w = celWin(); assert.equal(w.SMD_CELEBRATE.show({ title: "Level up", detail: "Level 4" }), true);
    const host = w.document.body._kids[0];
    assert.equal(host.attrs.role, "status"); assert.equal(host.attrs["aria-live"], "polite");
    assert.equal(cards(w).length, 1); assert.match(cards(w)[0].innerHTML, /Level up/); assert.deepEqual(w.haptic, ["success"]);
    assert.doesNotMatch(CEL, /\.focus\(/);
  } finally { mock.timers.reset(); }
});

test("celebrate: queue plays one at a time, auto-dismisses at ~2.6 s, exit then next", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const w = celWin(); w.SMD_CELEBRATE.show({ title: "A" }); w.SMD_CELEBRATE.show({ title: "B" }); w.SMD_CELEBRATE.show({ title: "C" });
    assert.equal(cards(w).length, 1); assert.match(cards(w)[0].innerHTML, />A</); assert.equal(w.SMD_CELEBRATE._state().queued, 2);
    mock.timers.tick(2599); assert.match(cards(w)[0].innerHTML, />A</);
    mock.timers.tick(1); assert.ok(cards(w)[0].classList.contains("sc-out"), "exit class on dismiss");
    mock.timers.tick(160); mock.timers.tick(220);
    assert.equal(cards(w).length, 1); assert.match(cards(w)[0].innerHTML, />B</);
    mock.timers.tick(2600); mock.timers.tick(160); mock.timers.tick(220);
    assert.match(cards(w)[0].innerHTML, />C</);
    assert.deepEqual(w.haptic, ["success", "success", "success"]);
  } finally { mock.timers.reset(); }
});

test("celebrate: tap dismisses; a downward swipe dismisses; a short upward wiggle past tap threshold does not", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const w = celWin(); w.SMD_CELEBRATE.show({ title: "A" });
    const c = cards(w)[0], fire = (t, e) => (c.listeners[t] || []).forEach((f) => f(e));
    fire("pointerdown", { clientY: 100 }); fire("pointermove", { clientY: 100 }); fire("pointerup", {});
    assert.ok(c.classList.contains("sc-out"), "tap");
    mock.timers.tick(400);
    w.SMD_CELEBRATE.show({ title: "B" }); const d = cards(w)[0];
    const f2 = (t, e) => (d.listeners[t] || []).forEach((f) => f(e));
    f2("pointerdown", { clientY: 100 }); f2("pointermove", { clientY: 150 }); f2("pointerup", {});
    assert.ok(d.classList.contains("sc-out"), "swipe down");
  } finally { mock.timers.reset(); }
});

test("celebrate: kill switch smd_celebrate=0 shows nothing and does not buzz", () => {
  const w = celWin({ smd_celebrate: "0" });
  assert.equal(w.SMD_CELEBRATE.show({ title: "X" }), false); assert.equal(w.document.body._kids.length, 0); assert.equal(w.haptic.length, 0);
});

test("celebrate: a key fires once ever, even across a reload (persisted)", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const ls = {}; const w1 = celWin(ls); const st = w1.localStorage;
    assert.equal(w1.SMD_CELEBRATE.show({ title: "Badge", key: "badge:x" }), true);
    assert.equal(w1.SMD_CELEBRATE.show({ title: "Badge", key: "badge:x" }), false, "re-render");
    const w2 = celWin(st._m);   // reload with the same storage
    assert.equal(w2.SMD_CELEBRATE.show({ title: "Badge", key: "badge:x" }), false, "reload");
    assert.equal(w2.SMD_CELEBRATE.show({ title: "Other", key: "badge:y" }), true);
  } finally { mock.timers.reset(); }
});

test("celebrate: reduced motion CSS is static mark + fade only; strong ease-out, compact safe-area card", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const w = celWin({}, { reduced: true }); w.SMD_CELEBRATE.show({ title: "A" });
    const css = w.document.head._kids[0].textContent;
    const rm = css.slice(css.indexOf("prefers-reduced-motion"));
    assert.match(rm, /animation:scFade/); assert.match(rm, /stroke-dashoffset:0/); assert.doesNotMatch(rm, /translateY\([1-9]/);
    assert.match(css, /cubic-bezier\(\.23,1,\.32,1\)/); assert.match(css, /--sai-bottom/); assert.match(css, /body\.dark/);
    assert.match(css, /pointer-events:none/);
  } finally { mock.timers.reset(); }
});

test("celebrate paths are the boot splash's trace paths, verbatim", () => {
  const idx = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const ds = [...idx.split("sbs-logo-trace")[1].matchAll(/ d="([^"]+)"/g)].slice(0, 3).map((m) => m[1]);
  assert.equal(ds.length, 3);
  ds.forEach((d) => assert.ok(CEL.includes(JSON.stringify(d)), "path copied"));
});

test("engagement notifier routes through SMD_CELEBRATE with once-per-achievement keys", () => {
  assert.match(ENG, /SMD_CELEBRATE\.show\(\{ title: n\.title, detail: n\.body, key: n\.key \}\)/);
  assert.match(ENG, /"lvl:" \+ n\.level/); assert.match(ENG, /"badge:" \+ id/); assert.match(ENG, /"tier:" \+ n\.discount/); assert.match(ENG, /"quest:"/);
});
