// Tokós fetal ultrasound clinics (tokos-clinic-us.js): pure geometry, GA from HC, scoring bands, and deck handling
// against the committed decks. No network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
const U = createRequire(import.meta.url)("../tokos-clinic-us.js");
const read = (f) => JSON.parse(readFileSync(f, "utf8"));
const fp = read("tokos/decks/fetal-planes.json"), hc = read("tokos/decks/hc-biometry.json"), credits = read("tokos/media/credits.json");
const near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`);

test("perimeter: circle is exact, a line is 4a, symmetric in a and b", () => {
  near(U.perimeter(10, 10), 2 * Math.PI * 10, 1e-9, "circle");
  near(U.perimeter(10, 0), 40, 0.02, "degenerate ellipse ~ 4a"); // Ramanujan II error at e=1 is about 0.04%
  assert.equal(U.perimeter(30, 20), U.perimeter(20, 30));
  // Reference value for a=3, b=1: exact perimeter 13.3649 (complete elliptic integral); Ramanujan II agrees to 1e-4.
  near(U.perimeter(3, 1), 13.3649, 1e-3, "a=3 b=1");
});

test("pixel to mm and HC from the stored ellipse reproduce every case's HC", () => {
  assert.equal(U.pxToMm(100, 0.1), 10);
  for (const c of hc.cases) {
    near(U.hcMm(c.ellipse, c.mmPerPx), c.hcFromEllipseMm, 0.011, c.id + " hcFromEllipse");
    near(U.hcMm(c.ellipse, c.mmPerPx), c.hcMm, c.hcMm * 0.005, c.id + " within 0.5% of the dataset HC");
  }
});

test("hit error and scoring bands", () => {
  const e = U.hitError(206, 200);
  near(e.mm, 6, 1e-9, "mm"); near(e.pct, 3, 1e-9, "pct"); near(e.absPct, 3, 1e-9, "abs");
  near(U.hitError(190, 200).pct, -5, 1e-9, "negative");
  assert.equal(U.hcBand(0).id, "on"); assert.equal(U.hcBand(3).id, "on"); assert.equal(U.hcBand(3.01).id, "close");
  assert.equal(U.hcBand(7).id, "close"); assert.equal(U.hcBand(7.5).id, "off");
  assert.deepEqual(U.HC_BANDS.map((b) => b.grade), [3, 2, 1]);
});

test("GA from HC: Hadlock formula from the deck matches every case, tolerance by the table, null out of range", () => {
  const cfg = hc.gaFromHc;
  near(U.gaFromHc(200, cfg), 8.96 + 0.54 * 20 + 0.0003 * 8000, 1e-9, "HC 200 mm");
  for (const c of hc.cases) {
    near(U.gaFromHc(c.hcMm, cfg), c.gaWeeks, 0.051, c.id + " GA");
    assert.equal(U.gaTol(c.hcMm, cfg), c.gaTol2SDWeeks, c.id + " tolerance");
  }
  assert.equal(U.gaTol(147, cfg), 1.48, "a gap between ranges takes the wider next range");
  assert.equal(U.gaTol(144, cfg), 1.19);
  assert.equal(U.gaFromHc(60, cfg), null); assert.equal(U.gaFromHc(361, cfg), null); assert.equal(U.gaTol(400, cfg), null);
});

test("handles, drags and steppers work in image px and stay inside the frame", () => {
  const e = { cx: 100, cy: 80, a: 50, b: 30, angleDeg: 0 };
  const h = U.handles(e);
  assert.deepEqual([h.a.x, h.a.y, h.b.x, h.b.y, h.r.x, h.r.y], [150, 80, 100, 110, 50, 80]);
  const h90 = U.handles({ ...e, angleDeg: 90 });
  near(h90.a.x, 100, 1e-9, "a at 90deg x"); near(h90.a.y, 130, 1e-9, "a at 90deg y (y down)");
  assert.equal(U.dragTo(e, "a", { x: 170, y: 95 }, 640, 432).a, 70, "long axis follows the projection");
  assert.equal(U.dragTo(e, "b", { x: 90, y: 40 }, 640, 432).b, 40, "short axis follows the projection");
  near(U.dragTo(e, "r", { x: 100, y: 30 }, 640, 432).angleDeg, 90, 1e-9, "turn handle above the centre = 90deg");
  assert.deepEqual(U.dragTo(e, "c", { x: 700, y: -5 }, 640, 432), { cx: 640, cy: 0, a: 50, b: 30, angleDeg: 0 }, "centre clamped to the image");
  assert.equal(U.dragTo(e, "a", { x: 100, y: 80 }, 640, 432).a, U.MIN_AXIS, "never collapses");
  let n = U.nudge(e, "move", 1, -1, 0, 640, 432); assert.deepEqual([n.cx, n.cy], [101, 79]);
  n = U.nudge(e, "long", 0, 0, 10, 640, 432); assert.equal(n.a, 60);
  n = U.nudge(e, "short", 0, 0, -1, 640, 432); assert.equal(n.b, 29);
  n = U.nudge({ ...e, angleDeg: 179 }, "turn", 0, 0, 2, 640, 432); assert.equal(n.angleDeg, -179, "angle wraps");
  const s = U.startEllipse(640, 432);
  assert.deepEqual([s.cx, s.cy, s.angleDeg], [320, 216, 0], "neutral start is centred and level");
});

test("plane options and truth per level", () => {
  const mb = U.planeOptions(fp, "mbbs"), rs = U.planeOptions(fp, "resident");
  assert.deepEqual(mb.map((o) => o.id), fp.levels.mbbs.options);
  assert.deepEqual(rs.map((o) => o.id), fp.levels.resident.options);
  for (const o of mb.concat(rs)) assert.ok(o.label.en && o.label.hi, o.id + " labelled in EN and HI");
  for (const c of fp.cases) {
    assert.equal(U.planeTruth(fp, c, "mbbs"), c.group);
    assert.equal(U.planeTruth(fp, c, "resident"), c.label);
    assert.ok(fp.levels.mbbs.options.includes(c.group) && fp.levels.resident.options.includes(c.label), c.id + " answer is an option");
    assert.equal(U.classOf(fp, c.label).group, c.group, c.id + " class sits in its group");
  }
});

test("every plane has cited, bilingual teaching points; every image has a credit and a file", () => {
  for (const cl of fp.classes) {
    const p = U.PLANES[cl.id];
    assert.ok(p && p.points.length >= 2, cl.id + " has teaching points");
    for (const x of p.points) { assert.ok(x.en && x.hi, cl.id + " EN and HI"); assert.ok(!/[\u0966-\u096F]/.test(x.hi), cl.id + " ASCII numerals in Hindi"); }
    for (const s of p.src) assert.ok(U.SOURCES[s] && /^https:\/\/doi\.org\//.test(U.SOURCES[s].url), cl.id + " source " + s);
  }
  const all = JSON.stringify([U.PLANES, U.HC_POINTS, U.SOURCES]);
  assert.ok(!/[\u2013\u2014]/.test(all), "no en or em dash");
  for (const [deck, key] of [[fp, "fetal-planes-db"], [hc, "hc18"]]) {
    assert.equal(deck.source.credit, key);
    for (const c of deck.cases) {
      assert.ok(credits[key].files[c.img], c.id + " credited");
      assert.ok(existsSync("tokos/media/" + c.img), c.id + " image bundled");
      assert.ok(["ai_drafted", "reviewed"].includes(c.review && typeof c.review === "object" ? c.review.status : c.review));
    }
  }
});
