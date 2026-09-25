/* MaiK companion v2 (maik-companion.js, 2026-09-25): the brain (question -> reaction), greetings,
 * the two-bone IK, copy rules, and the MaiK wiring in home.js. Browser behaviour is in
 * test/run-maik-companion-ui.mjs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const SRC = readFileSync(new URL("../maik-companion.js", import.meta.url), "utf8");
const H = readFileSync(new URL("../home.js", import.meta.url), "utf8");
const IDX = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const w = {}; new Function("window", SRC)(w);
const C = w.MaiKCompanion;

test("three styles, each with a name, a one-line personality and a drawing", () => {
  assert.deepEqual(C.STYLES, ["attending", "oncall", "bot"]);
  for (const s of C.STYLES) {
    assert.ok(C.LABEL[s] && C.BLURB[s], s);
    const svg = C.thumb(s);
    assert.match(svg, /^<svg class="mkc-svg"/); assert.match(svg, /mkc-root/); assert.match(svg, /aria-hidden="true"/);
  }
  assert.match(C.thumb("attending"), /mkc-armFo/);     // coat sleeves have an outline
  assert.match(C.thumb("oncall"), /mkc-armFf/);        // scrubs: short sleeves, bare forearm
  assert.match(C.thumb("bot"), /mkc-face/);            // the bot's screen face
});

test("the brain reads the question on the phone and picks a reaction", () => {
  const cases = {
    "code blue in ward 3": "urgent", "status epilepticus management": "urgent", "anaphylaxis after ceftriaxone": "urgent",
    "chest pain workup in the ED": "cardiac", "new onset atrial fibrillation": "cardiac",
    "asthma exacerbation in an adult": "resp", "COPD with low SpO2": "resp",
    "dose of amoxicillin for sinusitis": "rx", "prescribing regimen for H. pylori": "rx",
    "interpret this CBC report": "lab", "how to read an ABG": "lab",
    "CURB-65 score": "calc", "calculate eGFR": "calc",
    "fever in a 2 year old child": "peds", "neonatal jaundice thresholds": "peds",
    "thanks!": "thanks", "thank you, that helped": "thanks",
    "hi": "greet", "good morning": "greet",
    "that is wrong": "frustrated", "not helpful at all": "frustrated",
    "patient died, how do I break bad news to family": "sad",
    "hip fracture rehab plan": "think", "differential for a painless jaundice": "think", "": "think"
  };
  for (const [q, k] of Object.entries(cases)) assert.equal(C.classify(q), k, JSON.stringify(q));
  // Short-message rules only fire on short messages: a long clinical question starting with "great" is clinical.
  assert.equal(C.classify("great saphenous vein thrombosis management in a patient with recent surgery and obesity"), "think");
});

test("greetings follow the clock; the greeting bubble alternates the time of day and clinical pearls", () => {
  const at = (h) => new Date(2026, 8, 25, h, 0, 0);
  assert.equal(C.greeting(at(8)), "Good morning, Doctor.");
  assert.equal(C.greeting(at(14)), "Good afternoon, Doctor.");
  assert.equal(C.greeting(at(19)), "Good evening, Doctor.");
  assert.match(C.greeting(at(2)), /Night shift/);
  assert.equal(C.isNight(at(23)), true); assert.equal(C.isNight(at(12)), false);
  assert.equal(C.pickLine(at(8), 0.1), "Good morning, Doctor.");
  assert.ok(C.PEARLS.indexOf(C.pickLine(at(8), 0.9)) >= 0);
  assert.match(C.introLine("bot"), /^Hi, I am MaiK Bot/); assert.match(C.introLine("attending"), /^Hi, I am Dr\. MaiK/);
});

test("app copy has no em-dash and no clinical advice dressed up as a pearl", () => {
  const copy = [].concat(C.PEARLS, Object.values(C.LABEL), Object.values(C.BLURB), [C.introLine("bot"), C.introLine("oncall")]);
  for (const line of copy) assert.doesNotMatch(line, /—|–/, line);
  for (const p of C.PEARLS) assert.doesNotMatch(p, /\d+\s*(mg|mcg|ml|units?)\b/i, p);
  assert.doesNotMatch(SRC, /—/);
});

test("two-bone IK: reachable targets are met exactly, elbows hang low, far targets straighten the limb", () => {
  const k = C.ik(0, 0, 5, 6, 6.9, 6.4, false);
  assert.ok(Math.abs(k.hx - 5) < 1e-9 && Math.abs(k.hy - 6) < 1e-9);
  const e1 = Math.hypot(k.ex, k.ey), e2 = Math.hypot(k.hx - k.ex, k.hy - k.ey);
  assert.ok(Math.abs(e1 - 6.9) < 1e-6 && Math.abs(e2 - 6.4) < 1e-6);
  const far = C.ik(0, 0, 0, 40, 6.9, 6.4, false);
  assert.ok(Math.abs(Math.hypot(far.hx, far.hy) - (6.9 + 6.4 - 0.02)) < 1e-6);
  const up = C.ik(0, 0, 3, -2, 6.9, 6.4, false);   // hand near the shoulder: the elbow sits below it
  assert.ok(up.ey > 0);
  const knee = C.ik(0, 0, 8, 3, 8.3, 7.6, true);   // sitting: the knee points up and forward
  assert.ok(knee.ey < 0 && knee.ex > 0);
});

test("MaiK wiring: classic stays the default until the owner picks, and every hook reaches the companion", () => {
  assert.match(H, /function maikDocStyle\(\) \{ try \{ var v = localStorage\.getItem\("smd_maik_doc_style"\); return \(v === "attending" \|\| v === "oncall" \|\| v === "bot"\) \? v : "classic";/);
  assert.match(H, /if \(maikLiveDocOn\(\) && style !== "classic" && window\.MaiKCompanion\) \{ maikCompanionMount\(cmp, style, reduce, greetNow\); return; \}/);
  assert.match(H, /if \(_mkc\) _mkc\.cue\("send", q\); else maikDocCue\(maikDocClassify\(q\)\);/);
  assert.match(H, /try \{ if \(_mkc\) _mkc\.busy\(!!on\); \} catch \(e\) \{\}/);
  for (const k of ["typing", "stream", "error", "offline", "stop"]) assert.match(H, new RegExp('maikBuddyCue\\("' + k + '"\\)'), k);
  assert.match(H, /maikBuddyCue\(kind === "up" \? "rate-yes" : "rate-no"\)/);
  assert.match(H, /greet: !!greetNow \|\| _empty,/);
  assert.match(H, /id="maikSideBuddy"/); assert.match(H, /role="radio" aria-checked="/);
  assert.match(IDX, /<script src="\/maik-companion\.js\?v=[^"]+" defer><\/script>/);
});

test("owner, 2026-09-25: he only jumps, never circles, and the classic doctor stays the default", () => {
  assert.doesNotMatch(H, /setSt\("flip"/);          // the classic pixel doctor: jumps, no backflips
  assert.doesNotMatch(SRC, /"spin"|"flip"/);         // v2: joy is a jump for every style
  assert.match(H, /\["classic", "Classic pixel doctor \(default\)"/);
});

test("energy: the loop parks unless something on him moves; the bot lands when idle and while asleep", () => {
  assert.match(SRC, /function needFrames\(t\) \{/);
  assert.match(SRC, /if \(isBot && !landed && !busyOn && !G && t - lastEvent > 3500\) landed = true;/);
  assert.match(SRC, /if \(isBot\) landed = true;/);
  assert.match(SRC, /if \(document\.hidden \|\| hidden\) return;/);
});
