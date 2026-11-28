// StewardMD onboarding story (onboard-story.js): number format, the arithmetic shown on screen, the haptic limiter,
// mask sampling and the scene lists of both tracks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("../onboard-story.js");

test("Indian digit grouping", () => {
  assert.equal(S.fmtIN(230114), "2,30,114");
  assert.equal(S.fmtIN(52244), "52,244");
  assert.equal(S.fmtIN(999), "999");
  assert.equal(S.fmtIN(1000), "1,000");
  assert.equal(S.fmtIN(1999895), "19,99,895");
  assert.equal(S.fmtIN(0), "0");
});

test("hours a day to months a year", () => {
  assert.equal(S.monthsFrom(6), 3);
  assert.equal(S.monthsFrom(3), 1.5);
  assert.equal(S.monthsFrom(1), 0.5);
});

test("limiter lets one tick through per window", () => {
  const l = S.limiter(90);
  assert.equal(l(0), true); assert.equal(l(50), false); assert.equal(l(90), true); assert.equal(l(100), false);
});

test("sampleMask picks filled pixels only and repeats when short", () => {
  const w = 10, h = 10, a = new Uint8Array(w * h); a[3 * w + 4] = 255; a[7 * w + 2] = 255;
  const pts = S.sampleMask(a, w, h, 1, 5, 3);
  assert.equal(pts.length, 5);
  for (const [x, y] of pts) assert.ok((x === 4 && y === 3) || (x === 2 && y === 7));
  assert.deepEqual(S.sampleMask(new Uint8Array(4), 2, 2, 1, 3), []);
});

test("clinician track uses the user's own number", () => {
  const a = S.scenes("clinician", { patients: 50 });
  assert.equal(a[0].ask.key, "patients");
  assert.match(a[1].lines[0], /50<\/em> patients/);
  assert.equal(a[2].count, 200);
  assert.match(a[2].lines[0], /200/);
  assert.equal(a[a.length - 1].cta, "Try a renal dose");
  const strip = (s) => s.replace(/<[^>]+>/g, "");
  for (const sc of a) for (const l of sc.lines) assert.ok(!/[—–]/.test(strip(l)), "no em or en dash: " + l);
});

test("prep track shows sourced figures with their source", () => {
  const p = S.scenes("prep", { hours: 6 });
  assert.match(p[0].lines[0], /2,30,114/); assert.match(p[0].src, /NBEMS/);
  assert.match(p[1].lines[0], /52,244/); assert.match(p[1].src, /NMC/);
  assert.equal(p[2].ask.key, "hours");
  assert.match(p[3].lines[0], /6 hours.*3 months/);
  assert.equal(p[3].months, 3);
  assert.equal(p[p.length - 1].cta, "Build my plan");
  // The seat ratio claim ("one for every four or five") must hold for the stated figures.
  const ratio = S.STATS.prepAppeared / S.STATS.prepSeats;
  assert.ok(ratio >= 4 && ratio <= 5, "ratio " + ratio);
});

test("no font shorthand ending in 'inherit' (invalid CSS, the whole declaration is dropped)", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../onboard-story.js", import.meta.url), "utf8");
  assert.deepEqual(src.match(/font:\s*\d{3}\s+[^;"]+?\s+inherit\b/g) || [], []);
});
