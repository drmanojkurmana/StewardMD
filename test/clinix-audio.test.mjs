/* CliniX auscultation sounds: the parameters ARE the teaching.
 *
 * These are synthesised, so a wrong number does not crash anything and does not look wrong in
 * review - it simply plays the wrong sound, and the student learns the wrong discriminator. That is
 * how stridor shipped at 420 Hz, BELOW the 520 Hz monophonic wheeze, when the entire clinical point
 * of stridor is that it is higher pitched and harsher than a wheeze (owner report, 2026-08-25).
 *
 * So the relationships a student is being asked to hear are asserted here as numbers:
 *   stridor is higher than every wheeze, and inspiratory
 *   polyphonic wheeze is expiratory and has SEVERAL notes; monophonic has exactly one
 *   coarse crackles are early, few and low; fine crackles are late, many and high
 *   vesicular has a longer inspiration and no gap; bronchial has equal phases and a gap
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "clinix-audio.js"), "utf8");

/* Parse one sound's spec out of the SOUNDS table. Reading the source rather than executing it keeps
 * this test free of Web Audio, which node does not have. */
function spec(name) {
  const m = new RegExp(`\\n    ${name}:\\s*\\{([\\s\\S]*?)\\n    \\}`).exec(SRC);
  assert.ok(m, `sound "${name}" not found`);
  const b = m[1];
  const num = (k) => {
    const r = new RegExp(`\\b${k}:\\s*(-?[\\d.]+)`).exec(b);
    return r ? Number(r[1]) : null;
  };
  const tones = (() => {
    const r = /wheezeHz:\s*\[([^\]]*)\]/.exec(b);
    return r ? r[1].split(",").map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n)) : [];
  })();
  const crackle = (() => {
    const r = /crackle:\s*\{([^}]*)\}/.exec(b);
    if (!r) return null;
    const g = (k) => {
      const q = new RegExp(`\\b${k}:\\s*([\\d.]+)`).exec(r[1]);
      return q ? Number(q[1]) : null;
    };
    return { n: g("n"), from: g("from"), to: g("to"), hz: g("hz"), dur: g("dur"),
             both: /bothPhases:\s*true/.test(r[1]) };
  })();
  const phase = (/wheezePhase:\s*"(\w+)"/.exec(b) || [])[1] || null;
  return { insp: num("insp"), exp: num("exp"), gap: num("gap"), band: num("band"),
           q: num("q"), inspGain: num("inspGain"), expGain: num("expGain"),
           tones, phase, crackle, hint: (/hint:\s*"([^"]*)"/.exec(b) || [])[1] || "" };
}

const ALL = ["vesicular", "bronchial", "reduced", "wheeze", "monophonic", "coarse", "fine", "rub", "stridor"];

test("every sound is defined with a band, an envelope and a hint", () => {
  for (const n of ALL) {
    const s = spec(n);
    assert.ok(s.band > 0, `${n} has no band`);
    assert.ok(s.insp > 0 && s.exp > 0, `${n} has no breath envelope`);
    assert.ok(s.hint.length > 20, `${n} has no teaching hint`);
  }
});

test("STRIDOR is higher pitched than every wheeze, and inspiratory", () => {
  /* The bug: stridor at 420 Hz, below the 520 Hz monophonic wheeze. A student comparing them then
   * learns that stridor is the LOWER sound, which is the opposite of the truth. */
  const st = spec("stridor"), poly = spec("wheeze"), mono = spec("monophonic");
  assert.ok(st.tones.length, "stridor has no tone");
  const stridorLowest = Math.min(...st.tones);
  const wheezeHighest = Math.max(...poly.tones, ...mono.tones);
  assert.ok(stridorLowest > wheezeHighest,
    `stridor's lowest note (${stridorLowest} Hz) must exceed the highest wheeze note (${wheezeHighest} Hz)`);
  assert.equal(st.phase, "insp", "stridor is inspiratory");
  assert.ok(st.band > poly.band && st.band > mono.band,
    "stridor's noise band must sit above the wheezes: it is an upper airway sound");
  assert.match(st.hint, /inspirat/i);
  assert.match(st.hint, /not a wheeze|emergency/i, "the hint must say it is not a wheeze");
});

test("polyphonic wheeze has several notes and is expiratory; monophonic has exactly one", () => {
  const poly = spec("wheeze"), mono = spec("monophonic");
  assert.ok(poly.tones.length >= 3, `polyphonic needs several notes, has ${poly.tones.length}`);
  assert.equal(mono.tones.length, 1, "monophonic means ONE note");
  assert.equal(poly.phase, "exp", "polyphonic wheeze is expiratory");
  assert.ok(poly.exp > poly.insp, "expiration is prolonged in airflow obstruction");
  assert.match(mono.hint, /tumour|tumor|foreign/i, "monophonic must name the sinister causes");
});

test("crackles: coarse are EARLY, few and low; fine are LATE, many and high", () => {
  const c = spec("coarse").crackle, f = spec("fine").crackle;
  assert.ok(c && f, "both crackle types need a crackle spec");
  assert.ok(c.from < 0.25, `coarse crackles must start early (from=${c.from})`);
  assert.ok(f.from > 0.45, `fine crackles must start late (from=${f.from})`);
  assert.ok(f.n > c.n, `fine crackles are more numerous (${f.n} vs ${c.n})`);
  assert.ok(f.hz > c.hz, `fine crackles are higher pitched (${f.hz} vs ${c.hz} Hz)`);
  assert.ok(f.dur < c.dur, `fine crackles are shorter (${f.dur} vs ${c.dur} s)`);
  assert.match(spec("fine").hint, /velcro|late|not.*clear/i);
  assert.match(spec("coarse").hint, /cough/i, "coarse crackles change with coughing; the hint must say so");
});

test("vesicular and bronchial differ in the two ways a student is taught", () => {
  const v = spec("vesicular"), b = spec("bronchial");
  // 1. Vesicular: inspiration longer than expiration, and no gap between them.
  assert.ok(v.insp > v.exp, "vesicular inspiration is longer than expiration");
  assert.ok(!v.gap, "vesicular has no gap between phases");
  // 2. Bronchial: phases equal, a clear gap, and higher pitched (hollow, blowing).
  assert.ok(Math.abs(b.insp - b.exp) < 0.2, "bronchial phases are of similar length");
  assert.ok(b.gap > 0.1, "bronchial has an audible gap between phases");
  assert.ok(b.band > v.band, "bronchial breathing is higher pitched than vesicular");
  assert.ok(b.expGain >= b.inspGain * 0.9, "bronchial expiration is as loud as inspiration");
});

test("reduced breath sounds are quieter than vesicular, not just different", () => {
  const v = spec("vesicular"), r = spec("reduced");
  assert.ok(r.inspGain < v.inspGain, "reduced must actually be quieter");
  assert.ok(r.exp > r.insp, "prolonged expiration, as in COPD");
});

test("a pleural rub sounds in BOTH phases and is low pitched", () => {
  const r = spec("rub");
  assert.ok(r.crackle?.both === true, "a rub is heard in both phases");
  assert.ok(r.band < spec("bronchial").band, "a rub is low pitched, creaking rather than blowing");
  assert.match(r.hint, /both/i);
  // The clinically important trap: it disappearing is not improvement.
  assert.match(r.hint, /not improvement|disappears/i);
});
