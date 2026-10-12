// Isometric equipment figures: the runtime (iso-figures.js), the generated figures (iso-fig-*.js, built by
// tools/iso/build.mjs with the vendored Anatomy kit) and their wiring into Narke, Neonatal, CliniX, SURGX,
// Ophthalmos and the product page. Each driver's numbers are checked against the module model it mirrors.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const ISO = require("../iso-figures.js");
const IDS = ["circle-system", "vaporizer", "capno-line", "syringe-pump", "bp-cuff", "chest-drain", "retinoscope"];
const fig = (id) => require("../iso-fig-" + id + ".js");
const es5 = (src) => !/\b(let|const|class)\s/.test(src) && !/=>/.test(src) && !/`/.test(src) && !/\.includes\(/.test(src) && !/\.\.\.\w/.test(src);

test("generated files are up to date with tools/iso (build --check)", () => {
  execFileSync(process.execPath, [join(ROOT, "tools/iso/build.mjs"), "--check"], { stdio: "pipe" });
});

test("runtime and every figure file: ES5, no en or em dash, one file per figure", () => {
  assert.ok(es5(read("iso-figures.js")), "iso-figures.js ES5");
  const files = readdirSync(ROOT).filter((f) => /^iso-fig-[a-z0-9-]+\.js$/.test(f)).map((f) => f.slice(8, -3)).sort();
  assert.deepEqual(files, [...IDS].sort());
  for (const id of IDS) {
    const src = read("iso-fig-" + id + ".js");
    assert.ok(es5(src), id + " ES5");
    assert.ok(!/[–—]/.test(src), id + " has a dash");
    assert.ok(!/[–—]/.test(read("tools/iso/figures/" + id + ".driver.js")), id + " driver has a dash");
    const F = fig(id);
    assert.equal(F.id, id);
    assert.equal(F.review, "ai_drafted");
    assert.ok(F.svg.startsWith("<svg") && F.svg.includes('aria-label="'), id + " svg with a label");
    assert.ok(F.sources.length >= 1 && F.model && F.caption, id + " sources, model, caption");
    assert.ok(F.svg.length < 260000, id + " stays small: " + F.svg.length);
  }
  assert.ok(!/[–—]/.test(read("iso-figures.css")));
});

test("pure helpers: projection, along, morph blending and snapping", () => {
  const B = { o: [10, 20], x: [1, 0.5], y: [-1, 0.5], z: [0, -1] };
  assert.deepEqual(ISO.proj(B, [2, 0, 3]), [12, 18]);
  assert.equal(ISO.pathOf(B, [[0, 0, 0], [1, 0, 0]]), "M10 20L11 20.5");
  assert.deepEqual(ISO.along([[0, 0, 0], [10, 0, 0], [10, 10, 0]], 0.75), [10, 5, 0]);
  const m = { f: [0, 1], t: [["M", " ", ""]], k: [{ t: 0, n: ["0", "10"] }, { t: 0, n: ["10", "10"] }] };
  assert.equal(ISO.morphAt(m, 0.5), "M5 10");
  const snap = { f: [0, 1], t: [["A", ""], ["B", ""]], k: [{ t: 0, n: ["1"] }, { t: 1, n: ["2"] }] };
  assert.equal(ISO.morphAt(snap, 0.4), "A1");
  assert.equal(ISO.morphAt(snap, 0.6), "B2");
});

// A stub of the runtime's api that records every part a driver touches.
function stub(F) {
  const touched = new Set();
  const rec = (name) => touched.add(name);
  const api = {
    B: F.basis, data: F.data, along: ISO.along, clamp: ISO.clamp,
    proj: (p) => ISO.proj(F.basis, p), path: (pts, c) => ISO.pathOf(F.basis, pts, c),
    move: rec, morph: (n, f) => { rec(n); assert.ok(F.morphs[n], F.id + " morph " + n); assert.ok(f === f, "morph fraction is a number"); },
    d: (n, d) => { rec(n); assert.ok(!/NaN/.test(d), F.id + " " + n + " NaN path"); },
    attr: (n, a, v) => { rec(n); assert.ok(!/NaN/.test(String(v)), F.id + " " + n + " " + a + " NaN"); },
    show: rec, opacity: rec, text: rec,
    at: (n, p) => { rec(n); assert.ok(p.every((v) => v === v), F.id + " " + n + " NaN point"); },
  };
  return { api, touched };
}

test("every driver runs a full cycle at every control setting, and every part it touches is in the drawing", () => {
  for (const id of IDS) {
    const F = fig(id), R = F.driver, { api, touched } = stub(F);
    const states = [{ ...R.defaults }];
    for (const c of R.controls) {
      const vals = c.type === "seg" ? c.options.map((o) => o[0]) : [c.min, c.max];
      for (const v of vals) states.push({ ...R.defaults, [c.key]: c.type === "seg" && /^-?\d+(\.\d+)?$/.test(v) ? +v : v });
    }
    for (const st of states) {
      const d = R.model(st);
      for (let t = 0; t < 40; t += 0.37) assert.equal(typeof R.frame(api, st, d, t, 0.016, false), "string");
      assert.equal(typeof R.frame(api, st, d, 0, 0, true), "string");
      const say = R.say(d, st);
      assert.ok(typeof say === "string" && say.length > 10 && !/NaN|undefined/.test(say), id + " say: " + say);
    }
    for (const name of touched) assert.ok(F.svg.includes('data-iso-part="' + name + '"'), id + " touches a part not in the svg: " + name);
  }
});

test("circle system: the driver's local equations match the Narke circuit model", () => {
  const N = require("../narke-models/explorer-circuit.js"), R = fig("circle-system").driver;
  for (const fgf of R.FGF) for (const ve of [3, 6, 9, 15]) for (const ab of ["fresh", "partial", "exhausted"]) {
    const a = N.state({ fgf, ve, absorber: ab }), b = R.LOCAL(fgf, ve, 200, ab);
    assert.equal(b.inspiredCO2, a.inspiredCO2, `PICO2 fgf ${fgf} ve ${ve} ${ab}`);
    assert.equal(b.endTidalCO2, a.endTidalCO2);
    assert.equal(b.rebreathedFraction, a.rebreathedFraction);
    assert.equal(b.runaway, a.runaway);
  }
});

test("retinoscope: the driver's local relation matches the Ophthalmos retinoscopy model (sphere)", () => {
  const M = require("../ophthalmos-retino-model.js"), R = fig("retinoscope").driver;
  for (let rx = -6; rx <= 6; rx += 0.5) for (let lens = -6; lens <= 8; lens += 0.25) for (const w of [1.5, 2, 1]) {
    const x = M.reflex(M.effective({ s: rx, c: 0, ax: 180 }, { s: lens, c: 0, ax: 180 }, w), 90), y = R.LOCAL(rx, lens, w);
    assert.equal(y.motion, x.motion, `rx ${rx} lens ${lens} wd ${w}`);
    assert.ok(Math.abs(y.mag - x.mag) < 1e-9 && Math.abs(y.bright - x.bright) < 1e-9 && Math.abs(y.fill - x.fill) < 1e-9);
  }
  // neutral at the gross lens: refraction + working distance
  assert.equal(R.model({ rx: 2, lens: 3.5, wd: 67 }).motion, "neutral");
  assert.equal(R.model({ rx: -3, lens: 0, wd: 67 }).motion, "against");
  assert.equal(R.model({ rx: 0, lens: 0, wd: 67 }).motion, "with");
});

test("vaporizer: textbook splitting ratios at 1% (isoflurane about 1:44, sevoflurane about 1:25)", () => {
  const R = fig("vaporizer").driver;
  assert.equal(Math.round(R.split("iso", 1, 1).ratio), 44);
  assert.equal(Math.round(R.split("sevo", 1, 1).ratio), 25);
  const s = R.split("sevo", 2, 2);
  assert.equal(Math.round(s.chamber * 1000), 157);
  assert.ok(Math.abs(s.bypass + s.chamber - 2) < 1e-9);
  assert.ok(s.liquidMlH > 10 && s.liquidMlH < 16, "about 3 x FGF x % mL an hour: " + s.liquidMlH);
});

test("syringe pump: plunger speed is rate / barrel area; slack delays the start", () => {
  const R = fig("syringe-pump").driver;
  const d = R.model({ rate: 0.5, size: "50", slack: 1 });
  assert.ok(Math.abs(d.mmh - 0.5 * 1000 / (Math.PI * 13.3 * 13.3)) < 1e-3);
  assert.ok(d.delayMin > 60 && d.delayMin < 75, "1 mm at 0.9 mm/h is over an hour: " + d.delayMin);
  assert.equal(d.hours, 100);
  assert.ok(R.model({ rate: 0.5, size: "10", slack: 1 }).delayMin < d.delayMin / 3, "a small syringe takes up slack sooner");
  assert.equal(R.model({ rateI: 3, size: "50", slack: 0 }).rate, 0.5, "slider when the host passes no rate");
});

test("blood pressure: readings fall at most one beat's let-down below the truth", () => {
  const R = fig("bp-cuff").driver;
  for (const rate of [2, 3, 5, 10]) for (const hr of [40, 60, 72, 100, 140]) for (const sbp of [100, 120, 160]) {
    const r = R.reading(sbp, 70, hr, rate), step = rate * 60 / hr;
    assert.ok(r.sys <= sbp && r.sys > sbp - step - 1, `sys ${r.sys} for ${sbp} at ${rate}/${hr}`);
    assert.ok(r.dia > 70 - 1 && r.dia < 70 + step + 1, `dia ${r.dia} at ${rate}/${hr}`);
  }
  assert.ok(120 - R.reading(120, 80, 60, 10).sys > 120 - R.reading(120, 80, 60, 2).sys, "a fast let-down misses systolic by more than a slow one");
});

test("chest drain: swing, bubbling on expiration with a small leak, all the time with a large one, suction bottle bubbles", () => {
  const R = fig("chest-drain").driver;
  const quiet = R.model({ leak: "none", suction: "0" });
  assert.equal(quiet.swing, 6); assert.equal(quiet.when, "none"); assert.equal(quiet.suctionBubbles, false);
  assert.equal(R.model({ leak: "small", suction: "0" }).when, "on expiration");
  assert.equal(R.model({ leak: "large", suction: "0" }).when, "all the time");
  const suct = R.model({ leak: "none", suction: "1" });
  assert.ok(suct.suctionBubbles && suct.swing < quiet.swing && suct.pb === -20);
});

test("capnography: transit time = line volume / sampling flow", () => {
  const R = fig("capno-line").driver, d = R.transit(3, 150);
  assert.ok(Math.abs(d.volume - Math.PI * 0.06 * 0.06 * 300) < 1e-9);
  assert.ok(Math.abs(d.delay - d.volume / 150 * 60) < 1e-9 && d.delay > 1.3 && d.delay < 1.4);
  assert.ok(R.transit(6, 50).delay > R.transit(2, 200).delay * 8);
});

test("wiring: index.html, product page and the five host modules", () => {
  const index = read("index.html");
  assert.match(index, /<script src="\/iso-figures\.js\?v=iso2" defer><\/script>/);
  assert.ok(!/src="\/iso-fig-/.test(index), "no figure in the core bundle");
  assert.match(read("iso-figures.js"), /var V = "iso2"/);
  assert.match(read("product/index.html"), /data-smd-iso="circle-system"[\s\S]*\/iso-figures\.js\?v=iso2/);
  const nk = read("narke-explore-ui.js");
  assert.match(nk, /SMD_ISO\.slot\("circle-system", \{ controls: false/);
  assert.match(nk, /SMD_ISO\.set\("circle-system"/);
  assert.match(nk, /SMD_ISO\.slot\("vaporizer"\)/);
  assert.match(nk, /SMD_ISO\.slot\("capno-line"\)/);
  assert.match(read("neo-infusions.js"), /SMD_ISO\.slot\("syringe-pump", \{ state: \{ rate: mlh \}, hide: \["rateI"\] \}\)/);
  assert.match(read("ophthalmos-explore.js"), /I\.slot\("retinoscope"/);
  assert.equal(JSON.parse(read("surgx/protocols/chest-trauma.json")).isoFigure, "chest-drain");
  assert.match(read("surgx-screens.js"), /SMD_ISO\.slot\(p\.isoFigure\)/);
  const SM = require("../surgx-model.js");
  assert.equal(SM.compileProtocol(JSON.parse(read("surgx/protocols/chest-trauma.json")), { allowDraft: true }).isoFigure, "chest-drain", "compileProtocol keeps isoFigure");
  const D = require("../clinix-diagrams.js");
  assert.equal(D.DIAGRAMS["diagram.bpiso"].iso, "bp-cuff");
  const media = JSON.parse(read("clinix/media/manifest.json")).media["media.cvs.bp.iso"];
  assert.equal(media.diagramId, "diagram.bpiso");
  assert.ok(read("clinix/skills/cardiovascular.json").includes('"media.cvs.bp.iso"'));
});

test("CliniX BP diagram renders the slot when the runtime is on and nothing when it is off", () => {
  const D = require("../clinix-diagrams.js");
  const prev = globalThis.window;
  try {
    globalThis.window = { SMD_ISO: { enabled: () => true, slot: (id) => '<div data-smd-iso="' + id + '"></div>' } };
    assert.match(D.render("diagram.bpiso", {}), /data-smd-iso="bp-cuff"/);
    globalThis.window = { SMD_ISO: { enabled: () => false, slot: () => "x" } };
    assert.equal(D.render("diagram.bpiso", {}), "");
  } finally { globalThis.window = prev; }
});
