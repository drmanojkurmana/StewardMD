/* CliniX cardiac auscultation sounds: unit tests for cardiovascular acoustics.
 * Asserted purely through data parsing, exactly as test/clinix-audio.test.mjs does,
 * keeping tests fast and free of Web Audio DOM requirements.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "clinix-audio.js"), "utf8");

function spec(name) {
  const m = new RegExp(`\\n    ${name}:\\s*\\{([\\s\\S]*?)\\n    \\}`).exec(SRC);
  assert.ok(m, `cardiac sound "${name}" not found in clinix-audio.js`);
  const b = m[1];
  const num = (k) => {
    const r = new RegExp(`\\b${k}:\\s*([\\d.]+)`).exec(b);
    return r ? Number(r[1]) : null;
  };
  const str = (k) => {
    const r = new RegExp(`\\b${k}:\\s*"([^"]*)"`).exec(b);
    return r ? r[1] : null;
  };
  const bool = (k) => new RegExp(`\\b${k}:\\s*true`).test(b);

  return {
    cardiac: bool("cardiac"),
    cycle: num("cycle"),
    sysLen: num("sysLen"),
    s1Hz: num("s1Hz"),
    s1HzEnd: num("s1HzEnd"),
    s1Gain: num("s1Gain"),
    s2Hz: num("s2Hz"),
    s2HzEnd: num("s2HzEnd"),
    s2Gain: num("s2Gain"),
    s2Split: num("s2Split"),
    s3: bool("s3"),
    s4: bool("s4"),
    openingSnap: num("openingSnap"),
    sysMurmur: str("sysMurmur"),
    diaMurmur: str("diaMurmur"),
    murmurBand: num("murmurBand"),
    murmurGain: num("murmurGain"),
    frictionRub: bool("frictionRub"),
    hint: str("hint") || ""
  };
}

const CARDIAC = [
  "s1_s2_normal",
  "s1_s2_split",
  "s3_gallop",
  "s4_gallop",
  "mitral_stenosis",
  "mitral_regurgitation",
  "aortic_stenosis",
  "aortic_regurgitation",
  "pericardial_rub"
];

test("every cardiac sound has cardiac flag, cycle length, S1 and S2 frequencies, and teaching hint", () => {
  for (const n of CARDIAC) {
    const s = spec(n);
    assert.equal(s.cardiac, true, `${n} must be marked as cardiac`);
    assert.ok(s.cycle > 0.5 && s.cycle < 1.5, `${n} cycle must match resting heart rate (~60-90 bpm)`);
    assert.ok(s.s1Hz > 0, `${n} must have an S1 frequency`);
    assert.ok(s.s2Hz > 0, `${n} must have an S2 frequency`);
    assert.ok(s.s2Hz > s.s1Hz, `${n} S2 (${s.s2Hz} Hz) must be higher pitched and crisper than S1 (${s.s1Hz} Hz)`);
    assert.ok(s.hint.length > 25, `${n} must have a rich clinical teaching hint`);
  }
});

test("mitral stenosis has loud S1, opening snap, and mid-diastolic rumbling murmur", () => {
  const ms = spec("mitral_stenosis");
  const norm = spec("s1_s2_normal");
  assert.ok(ms.s1Gain > norm.s1Gain, "mitral stenosis S1 is characteristically loud/accentuated");
  assert.ok(ms.openingSnap > 0.04 && ms.openingSnap < 0.12, "opening snap occurs in early diastole after S2");
  assert.equal(ms.diaMurmur, "mid_rumble", "MS murmur is mid-diastolic rumbling");
  assert.ok(ms.murmurBand < 200, "MS rumble is low-pitched (<200 Hz)");
  assert.match(ms.hint, /opening snap/i);
  assert.match(ms.hint, /presystolic/i);
});

test("mitral regurgitation has pansystolic murmur radiating to axilla", () => {
  const mr = spec("mitral_regurgitation");
  assert.equal(mr.sysMurmur, "pansystolic", "MR is pansystolic / holosystolic");
  assert.ok(mr.murmurBand >= 400, "MR murmur is high-pitched blowing noise");
  assert.match(mr.hint, /axilla/i, "MR hint must mention radiation to the axilla");
});

test("aortic stenosis has ejection systolic crescendo-decrescendo murmur radiating to carotids", () => {
  const as = spec("aortic_stenosis");
  assert.equal(as.sysMurmur, "ejection", "AS is ejection systolic");
  assert.match(as.hint, /carotid/i, "AS hint must mention radiation to carotids");
  assert.match(as.hint, /crescendo-decrescendo|diamond/i);
});

test("aortic regurgitation has early diastolic decrescendo murmur", () => {
  const ar = spec("aortic_regurgitation");
  assert.equal(ar.diaMurmur, "early_decrescendo", "AR is early diastolic decrescendo");
  assert.ok(ar.murmurBand >= 500, "AR is high pitched blowing murmur");
  assert.match(ar.hint, /Erb's point|expiration/i, "AR hint must mention posture / Erb's point");
});

test("S3 and S4 gallops are correctly timed and explained", () => {
  const s3 = spec("s3_gallop");
  const s4 = spec("s4_gallop");
  assert.equal(s3.s3, true, "S3 gallop flagged");
  assert.equal(s4.s4, true, "S4 gallop flagged");
  assert.match(s3.hint, /ventricular filling|Kentucky/i);
  assert.match(s4.hint, /atrial|Tennessee|atrial fibrillation/i);
});
