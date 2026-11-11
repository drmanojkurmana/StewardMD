// "You are the boss" clip (owner 2026-11-11): gender default, files shipped, hooks in PrepNucleus, gender in the profile.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
const R = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const BC = R("boss-cele.js");

test("gender: Male unless Female was chosen", () => {
  const store = {}; const window = {};
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  new Function("window", "localStorage", "document", "matchMedia", "requestAnimationFrame", BC)(window, localStorage, {}, null, () => 0);
  assert.equal(window.SMD_GENDER.get(), "male");
  window.SMD_GENDER.set("female"); assert.equal(window.SMD_GENDER.get(), "female");
  window.SMD_GENDER.set("anything"); assert.equal(window.SMD_GENDER.get(), "male");
});

test("both clips and their stills ship, and build-www copies them", () => {
  for (const g of ["male", "female"]) {
    assert.ok(statSync(new URL(`../assets/celebrate/boss-${g}.mp4`, import.meta.url)).size < 2_500_000, g + " clip under 2.5 MB");
    for (const s of ["start", "end"]) statSync(new URL(`../assets/celebrate/boss-${g}-${s}.webp`, import.meta.url));
  }
  assert.match(R("scripts/build-www.sh"), /cp assets\/celebrate\/\* "\$WWW\/assets\/celebrate\/"/);
  assert.match(R("index.html"), /<script src="\/boss-cele\.js\?v=[^"]+" defer><\/script>/);
});

test("player: words at the hero pose with confetti and the celebration buzz; still under reduced motion; card fallback", () => {
  assert.match(BC, /SMD_CELEBRATE\.confetti\(\{ count: 200 \}\)/);
  assert.match(BC, /H\.celebrate\(\)/);
  assert.match(BC, /class="bc-still"/);
  assert.match(BC, /v\.addEventListener\("error", fail\)/);
  assert.match(BC, /"smd_boss_video"\) !== "0"/);
  assert.match(BC, /playsinline webkit-playsinline/);
});

test("PrepNucleus: a boss win and 100% on 5+ questions play the clip", () => {
  assert.match(R("prep-play.js"), /SMD_BOSS_CELE\.play\(\{ eyebrow: subjName\(sid\) \+ " boss beaten", title: "You are the boss"/);
  const P = R("prep.js");
  assert.match(P, /renderResult\(\);\n    perfectCele\(r\);/);
  assert.match(P, /if \(n < 5 \|\| r\.perfectDone\) return;/);
});

test("gender is asked at sign-up (Male preselected), editable in Profile, and saved by the server", () => {
  const PS = R("profile-setup.js");
  assert.match(PS, /key: "gender", label: "Gender", kind: "seg"/);
  assert.match(PS, /var gv = v === "female" \? "female" : "male";/);
  assert.match(PS, /gender: draft\.gender === "female" \? "female" : "male"/);
  assert.match(R("home.js"), /row\("Gender", "gender"/);
  assert.match(R("functions/api/auth/[[path]].js"), /if \(body\.gender === "male" \|\| body\.gender === "female"\) patch\.gender = body\.gender;/);
});
