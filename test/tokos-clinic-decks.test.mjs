// Tokós clinic datasets: fetal-planes, hc-biometry and the extended CTG deck. Reads committed files only, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { detectSinusoidalLike, SINUS, STRIP_MAX_FHR_LOSS, STRIP_MIN_UC_PRESENT } from "../tools/tokos-ctg-prep.mjs";
import { gaFromHcMm, gaTolerance, ellipsePerimeter, ellipseFromAnnotation, HADLOCK_HC, GA_HC_RANGE_MM } from "../tools/tokos-build-hc18.mjs";
import { CLASSES, GROUPS } from "../tools/tokos-build-fetal-planes.mjs";

const read = (f) => readFileSync(f, "utf8");
const credits = JSON.parse(read("tokos/media/credits.json"));
const fetal = JSON.parse(read("tokos/decks/fetal-planes.json"));
const hc = JSON.parse(read("tokos/decks/hc-biometry.json"));
const ctg = JSON.parse(read("tokos/decks/ctg.json"));
const PERMITTED = ["CC0", "CC BY 4.0", "CC BY-SA 4.0", "ODC-BY 1.0", "Public domain"];
const MAX_BYTES = 40 * 1024, MAX_IMAGES = 150;
const isWebp = (f) => { const b = readFileSync(f); return b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP"; };

for (const [name, deck, dir] of [["fetal-planes", fetal, "fetal-planes"], ["hc-biometry", hc, "hc-biometry"]]) {
  test(name + ": deck shape, unique ids, at most " + MAX_IMAGES + " images", () => {
    assert.equal(deck.v, 1);
    assert.equal(deck.id, name);
    assert.equal(deck.review, "ai_drafted");
    assert.ok(deck.title.en && deck.title.hi);
    assert.ok(deck.cases.length >= 50 && deck.cases.length <= MAX_IMAGES, "case count " + deck.cases.length);
    assert.equal(new Set(deck.cases.map((c) => c.id)).size, deck.cases.length);
    deck.cases.forEach((c) => {
      assert.equal(c.review, "ai_drafted");
      assert.ok(c.w > 0 && c.h > 0);
      assert.equal(c.img, dir + "/" + c.id + ".webp");
    });
  });

  test(name + ": every image exists, is WebP, is at most 40 KB, and is credited with a permitted licence", () => {
    const listed = new Set();
    deck.cases.forEach((c) => {
      const f = "tokos/media/" + c.img;
      assert.ok(existsSync(f), f + " missing");
      assert.ok(statSync(f).size <= MAX_BYTES, f + " is " + statSync(f).size + " bytes");
      assert.ok(isWebp(f), f + " is not WebP");
      const entry = credits[deck.source.credit];
      assert.ok(entry, "no credits entry " + deck.source.credit);
      assert.ok(entry.files[c.img], "no credit for " + c.img);
      listed.add(c.img);
    });
    const entry = credits[deck.source.credit];
    assert.ok(PERMITTED.includes(entry.licence), entry.licence + " is not a permitted licence");
    assert.match(entry.licenceUrl, /^https:\/\/creativecommons\.org\//);
    assert.ok(entry.source && entry.citation && entry.author && entry.changes);
    // no orphan files, and the credit map lists exactly the shipped images
    const onDisk = readdirSync("tokos/media/" + dir).map((n) => dir + "/" + n);
    assert.deepEqual(onDisk.sort(), [...listed].sort());
    assert.deepEqual(Object.keys(entry.files).sort(), [...listed].sort());
  });

  test(name + ": no em-dash in the deck or its credits", () => {
    assert.ok(!read("tokos/decks/" + name + ".json").includes("\u2014"));
    assert.ok(!JSON.stringify(credits[deck.source.credit]).includes("\u2014"));
  });
}

test("fetal-planes: labels are valid, groups follow the labels, both levels cover every case", () => {
  const labelIds = CLASSES.map((c) => c.id), groupIds = GROUPS.map((g) => g.id);
  assert.deepEqual(fetal.classes.map((c) => c.id), labelIds);
  assert.deepEqual(fetal.groups.map((g) => g.id), groupIds);
  const groupOf = Object.fromEntries(CLASSES.map((c) => [c.id, c.group]));
  fetal.cases.forEach((c) => {
    assert.ok(labelIds.includes(c.label), c.id + " label " + c.label);
    assert.equal(c.group, groupOf[c.label], c.id + " group");
  });
  // MBBS groups the three brain planes (and brain-other) into one answer; Resident keeps the fine label.
  assert.deepEqual(fetal.classes.filter((c) => c.group === "brain").map((c) => c.id), ["brain-transthalamic", "brain-transcerebellar", "brain-transventricular", "brain-other"]);
  assert.deepEqual(fetal.levels.mbbs.options, groupIds);
  assert.deepEqual(fetal.levels.resident.options, labelIds);
  assert.ok(fetal.levels.mbbs.options.length < fetal.levels.resident.options.length);
  fetal.classes.forEach((c) => {
    assert.ok(/[ऀ-ॿ]/.test(c.label.hi) && c.label.en, c.id + " label text");
    assert.equal(c.count, fetal.cases.filter((k) => k.label === c.id).length);
    assert.ok(c.count >= 6, c.id + " has " + c.count);
  });
  fetal.groups.forEach((g) => assert.ok(/[ऀ-ॿ]/.test(g.label.hi) && g.label.en));
  // ids do not leak the answer: no case id or file name contains a class name
  fetal.cases.forEach((c) => assert.ok(/^fp-\d{3}$/.test(c.id)));
  assert.equal(fetal.source.licence, "CC BY 4.0");
  assert.equal(fetal.source.doi, "10.5281/zenodo.3904280");
});

test("hc-biometry: Hadlock 1984 HC formula reproduces the values tabulated in the cited reference, tolerance bands and range", () => {
  assert.deepEqual(HADLOCK_HC, { c0: 8.96, c1: 0.54, c3: 0.0003 });
  // Rows of the Hologic SuperSonic MACH Obstetrical References table "GA by HC - Hadlock1984" (HC cm, GA weeks).
  [[6.8, 12.7263], [15.1, 18.1469], [22.4, 24.4278], [30.1, 33.3953], [36, 42.3968]].forEach(([cm, ga]) =>
    assert.ok(Math.abs(gaFromHcMm(cm * 10) - ga) < 0.0006, cm + " cm -> " + gaFromHcMm(cm * 10)));
  assert.equal(gaTolerance(68), 1.19);
  assert.equal(gaTolerance(144), 1.19);
  assert.equal(gaTolerance(147), 1.48); // in the gap between two tabulated ranges: the wider one
  assert.equal(gaTolerance(300), 2.98);
  assert.equal(gaTolerance(340), 3.2);
  assert.equal(gaTolerance(67), null);
  assert.equal(gaTolerance(361), null);
  assert.deepEqual(hc.gaFromHc.validHcMm, GA_HC_RANGE_MM);
  assert.equal(hc.gaFromHc.coefficients.c1, 0.54);
  assert.match(hc.gaFromHc.source.primary, /Radiology\. 1984;152\(2\):497-501/);
});

test("hc-biometry: perimeter of an ellipse (Ramanujan II) is exact for a circle and close to the exact value for a skull-like ellipse", () => {
  assert.ok(Math.abs(ellipsePerimeter(50, 50) - 100 * Math.PI) < 1e-9);
  // a = 5, b = 3: exact perimeter 25.5269980 (elliptic integral); Ramanujan II is within 1e-4.
  assert.ok(Math.abs(ellipsePerimeter(5, 3) - 25.526998) < 1e-3);
});

test("hc-biometry: the ellipse is recovered from a drawn ring to sub-pixel accuracy", () => {
  const w = 400, h = 300, cx = 210.5, cy = 148, a = 120, b = 90, deg = 20, th = (deg * Math.PI) / 180;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - cx, dy = y - cy, u = dx * Math.cos(th) + dy * Math.sin(th), v = -dx * Math.sin(th) + dy * Math.cos(th);
    const r = Math.hypot(u / a, v / b); // 1 on the ellipse
    if (Math.abs(r - 1) * Math.min(a, b) < 1.5) data[y * w + x] = 255; // ring about 3 px thick
  }
  const e = ellipseFromAnnotation({ w, h, data });
  assert.ok(Math.abs(e.cx - cx) < 0.5 && Math.abs(e.cy - cy) < 0.5, "centre " + e.cx + "," + e.cy);
  assert.ok(Math.abs(e.a - a) < 1.5 && Math.abs(e.b - b) < 1.5, "axes " + e.a + "," + e.b);
  assert.ok(Math.abs(e.angleDeg - deg) < 1.5, "angle " + e.angleDeg);
  assert.equal(ellipseFromAnnotation({ w, h, data: new Uint8Array(w * h) }), null); // nothing drawn
});

test("hc-biometry: stored ellipse, pixel size and HC agree on every case", () => {
  assert.ok(hc.cases.length <= 100);
  const hcs = hc.cases.map((c) => c.hcMm);
  assert.ok(Math.min(...hcs) < 100 && Math.max(...hcs) > 250, "HC should span the pregnancy");
  hc.cases.forEach((c) => {
    const e = c.ellipse;
    assert.ok(e.a >= e.b && e.b > 0 && e.angleDeg > -90 && e.angleDeg <= 90, c.id + " ellipse");
    assert.ok(e.cx > 0 && e.cx < c.w && e.cy > 0 && e.cy < c.h, c.id + " centre inside the image");
    assert.ok(e.cx - e.a > -0.1 * c.w && e.cx + e.a < 1.1 * c.w, c.id + " ellipse fits the frame");
    const fit = ellipsePerimeter(e.a, e.b) * c.mmPerPx;
    assert.ok(Math.abs(fit - c.hcFromEllipseMm) < 0.01, c.id + " hcFromEllipseMm");
    assert.ok(Math.abs(c.hcFromEllipseMm - c.hcMm) / c.hcMm <= 0.005, c.id + " ellipse HC " + c.hcFromEllipseMm + " vs dataset " + c.hcMm);
    assert.equal(c.gaWeeks, Math.round(gaFromHcMm(c.hcMm) * 10) / 10);
    assert.equal(c.gaTol2SDWeeks, gaTolerance(c.hcMm));
    assert.ok(c.hcMm >= GA_HC_RANGE_MM[0] && c.hcMm <= GA_HC_RANGE_MM[1]);
  });
  assert.equal(hc.source.licence, "CC BY 4.0");
  assert.equal(hc.source.doi, "10.5281/zenodo.1322001");
});

test("ctg: the original 12 cases are unchanged, new cases are gated and carry a suggested archetype", () => {
  assert.equal(ctg.v, 2);
  const first = createHash("sha256").update(JSON.stringify(ctg.cases.slice(0, 12), null, 1)).digest("hex");
  assert.equal(first, "fec36daf25080c13598f4f89de3f2e1f2147a9ae01f0f908cc5e2ba94c67cc5e");
  const extra = ctg.cases.slice(12);
  assert.ok(extra.length <= 8);
  assert.equal(new Set(ctg.cases.map((c) => c.id)).size, ctg.cases.length);
  extra.forEach((c) => {
    assert.ok(["tachysystole", "reduced_variability", "sinusoidal_like"].includes(c.archetypeSuggested), c.id);
    assert.ok(existsSync("tokos/media/" + c.svg), c.svg);
    assert.equal(c.review, null);
    assert.ok(c.qualityNote.length > 20);
    assert.ok(c.stripQuality.fhrLossPct <= STRIP_MAX_FHR_LOSS && c.stripQuality.ucPresentPct >= STRIP_MIN_UC_PRESENT);
    assert.equal(c.features.quality.suboptimal, false);
    if (c.archetypeSuggested === "tachysystole") assert.ok(c.features.contractions.tachysystole);
    if (c.archetypeSuggested === "reduced_variability") assert.equal(c.features.variability.band, "reduced");
  });
  assert.ok(!read("tokos/decks/ctg.json").includes("\u2014"));
});

test("ctg: the sinusoidal screen accepts a 60 min 4 cycles per minute wave and rejects flat, fast, big and short ones", () => {
  const fs = 4, n = 60 * 60 * fs;
  const mk = (f) => Float64Array.from({ length: n }, (_, i) => f(i / fs));
  const sine = (cpm, amp, until = 1e9) => mk((t) => (t < until ? 140 + amp * Math.sin((2 * Math.PI * cpm * t) / 60) : 140 + 3 * Math.sin((2 * Math.PI * 10 * t) / 60)));
  assert.equal(detectSinusoidalLike(sine(4, 4.5), fs, 140).found, true);
  assert.equal(detectSinusoidalLike(sine(4, 4.5), fs, 140).minutes, 60);
  assert.equal(detectSinusoidalLike(mk((t) => 140 + 0.5 * Math.sin(t)), fs, 140).found, false); // flat
  assert.equal(detectSinusoidalLike(sine(1, 4.5), fs, 140).found, false); // 1 cycle per minute
  assert.equal(detectSinusoidalLike(sine(4, 12), fs, 140).found, false); // 24 bpm peak to trough
  const short = detectSinusoidalLike(sine(4, 4.5, 1500), fs, 140); // 25 min only
  assert.equal(short.found, false);
  assert.equal(short.near, true);
  assert.equal(SINUS.MIN_BLOCKS * SINUS.BLOCK_MIN > 30, true); // FIGO: lasting more than 30 min
});
