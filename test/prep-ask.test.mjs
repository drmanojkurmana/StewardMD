/* PrepNucleus Ask MaiK (prep-ask.js), MaiK lines (prep/maik-lines.json, prep.js pickLine) and milestones (prep.js), and
 * the device table (prep/device-capability.json). Owner decisions 2026-10-09.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-ask.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const req = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const A = req("../prep-ask.js");
const P = req("../prep.js");
const LINES = JSON.parse(readFileSync(join(ROOT, "prep/maik-lines.json"), "utf8"));
const TAB = JSON.parse(readFileSync(join(ROOT, "prep/device-capability.json"), "utf8"));
const TAX = JSON.parse(readFileSync(join(ROOT, "prep/taxonomy.json"), "utf8"));

/* ---------- device verdict ---------- */
test("deviceVerdict: web, iPhone identifiers, the table, the memory proxy, unknown", () => {
  const v = (d) => A.deviceVerdict(d, TAB).v;
  assert.equal(v({ native: false }), "web");
  assert.equal(v({ native: true, platform: "web" }), "web");
  assert.equal(v({ native: true, platform: "ios", model: "iPhone16,1" }), "yes", "15 Pro");
  assert.equal(v({ native: true, platform: "ios", model: "iPhone15,4" }), "no", "15");
  assert.equal(v({ native: true, platform: "ios", model: "iPhone15,2", ramGB: 12 }), "no", "a table hit beats memory");
  assert.equal(v({ native: true, platform: "ios", model: "iPhone19,1" }), "yes", "a future iPhone qualifies without a table row");
  assert.equal(v({ native: true, platform: "ios", model: "iPhone13,2" }), "no");
  assert.equal(v({ native: true, platform: "ios", model: "iPad13,4" }), "yes", "M1 iPad Pro (table)");
  assert.equal(v({ native: true, platform: "ios", model: "iPad13,1" }), "no", "A14 iPad Air (table)");
  assert.equal(v({ native: true, platform: "ios", model: "iPad99,1", ramGB: 8 }), "yes", "unknown iPad: memory proxy");
  assert.equal(v({ native: true, platform: "ios", model: null, ramGB: 7.5 }), "yes");
  assert.equal(v({ native: true, platform: "ios", model: null, ramGB: 5.6 }), "no");
  assert.equal(v({ native: true, platform: "ios" }), "unknown", "unknown never becomes no");
});
test("deviceVerdict: Android needs 8 GB and Android 12", () => {
  const v = (d) => A.deviceVerdict(Object.assign({ native: true, platform: "android" }, d), TAB).v;
  assert.equal(v({ ramGB: 7.4, androidVer: 14 }), "yes");
  assert.equal(v({ ramGB: 11.2, sdk: 31 }), "yes");
  assert.equal(v({ ramGB: 5.5, androidVer: 14 }), "no");
  assert.equal(v({ ramGB: 12, androidVer: 11 }), "no");
  assert.equal(v({ ramGB: 12, sdk: 30 }), "no");
  assert.equal(v({ ramGB: null, androidVer: 14 }), "unknown");
  assert.equal(v({ ramGB: 8 }), "unknown");
  assert.equal(A.androidVerOf("Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit"), 14);
  assert.equal(A.androidVerOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)"), null);
});
test("verdict messages: the owner's wording, no shaming, always the online way forward", () => {
  assert.equal(A.verdictMsg({ v: "no", fam: "apple" }, true), "MaiK on this phone needs an iPhone 15 Pro or newer, or an iPad with an M1 chip or newer. You can ask MaiK online instead.");
  assert.match(A.verdictMsg({ v: "no", fam: "android" }, true), /8 GB of memory or more and Android 12 or newer\. You can ask MaiK online instead\./);
  assert.match(A.verdictMsg({ v: "web" }, false), /works in the StewardMD app/);
  assert.match(A.verdictMsg({ v: "unknown" }, false), /ask MaiK online/);
  assert.match(A.verdictMsg({ v: "yes" }, false), /one-time download/);
  assert.equal(A.verdictMsg({ v: "yes" }, true), "Runs on this phone. About 10 to 40 seconds.");
  Object.values(A.MSG).forEach((m) => {
    assert.doesNotMatch(m, /\bAI\b|old|not good enough|—|–/i, m);
  });
});
test("choice: local only when it can run; the remembered choice; skip only with Don't ask again", () => {
  assert.equal(A.localOk({ v: "yes" }, true), true);
  assert.equal(A.localOk({ v: "yes" }, false), false);
  assert.equal(A.localOk({ v: "no" }, true), false);
  assert.equal(A.localOk({ v: "unknown" }, true), true, "an unknown phone with a pack may try");
  assert.equal(A.firstChoice(null, true), "local");
  assert.equal(A.firstChoice(null, false), "online");
  assert.equal(A.firstChoice({ m: "online" }, true), "online");
  assert.equal(A.firstChoice({ m: "local" }, false), "online");
  assert.equal(A.skipChoice({ m: "online", q: 1 }, false), true);
  assert.equal(A.skipChoice({ m: "online", q: 0 }, true), false);
  assert.equal(A.skipChoice({ m: "local", q: 1 }, false), false, "a remembered phone choice that cannot run asks again");
});
test("online replies map to MaiK wording, never AI", () => {
  assert.equal(A.onlineNote(401).error, "sign-in");
  assert.equal(A.onlineNote(429, { reason: "ai-cost-cap" }).error, "tokens");
  assert.equal(A.onlineNote(429, { reason: "rate" }).error, "rate");
  assert.match(A.onlineNote(429, { reason: "device-cap", message: "Daily AI limit for this device reached." }).note, /busy/, "a server message with AI is replaced");
  assert.equal(A.onlineNote(0).error, "offline");
  assert.equal(A.onlineNote(502).error, "online-error");
  [401, 0, 502, 503].forEach((s) => assert.doesNotMatch(A.onlineNote(s, {}).note, /\bAI\b/));
});

/* ---------- device table ---------- */
test("device table: unique ids, the chip rule, unverified marked, conservative rules", () => {
  const ids = TAB.apple.filter((r) => r.id).map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "unique identifiers");
  assert.match(TAB.note, /Unverified/);
  TAB.apple.forEach((r) => {
    assert.equal(typeof r.idVerified, "boolean"); assert.equal(typeof r.chipVerified, "boolean");
    const qualifies = /^M\d/.test(r.chip) || /^A1[7-9] Pro|^A(1[89]|2\d)\b/.test(r.chip);
    assert.equal(r.ok, qualifies, r.name + " " + r.chip);
    if (r.id && /^iPhone/.test(r.id)) assert.equal(r.ok, +r.id.match(/^iPhone(\d+)/)[1] >= TAB.rules.iphoneMinMajor, r.name + " identifier rule");
  });
  assert.ok(TAB.rules.appleMinRamGB >= 6.5 && TAB.rules.androidMinSdk === 31);
});

/* ---------- MaiK lines ---------- */
const FORBID = /\b(AI|rank|AIR|top|topper|crack|clear the exam|guarantee\w*|selection|seat|percentile|score|pass|you did well|mastered|real strength|competition|rivals?|beat)\b|[!—–]/i;
test("MaiK lines: every taxonomy subject has 3, every line passes the writing rules (108 in all)", () => {
  const subs = []; TAX.branches.forEach((b) => b.subjects.forEach((s) => subs.push(s.id)));
  let n = 0;
  subs.forEach((id) => { assert.equal((LINES.subject[id] || []).length, 3, id); n += 3; });
  Object.keys(LINES.branch).forEach((b) => { assert.equal(LINES.branch[b].length, 3); n += 3; });
  assert.equal(n, 108);
  const all = [].concat(...Object.values(LINES.subject), ...Object.values(LINES.branch));
  all.forEach((l) => {
    const w = l.trim().split(/\s+/).length;
    assert.ok(w >= 4 && w <= 14, l);
    assert.ok(/^[\x20-\x7e]+$/.test(l), "ASCII only: " + l);
    assert.doesNotMatch(l, FORBID, l);
  });
  assert.equal(LINES.subject["ss-cardiology"][0], "You are the next best cardiologist in the making.", "the owner's own line");
});
test("pickLine: module, then subject, then branch; unknown gives nothing; rotation wraps", () => {
  assert.equal(P.pickLine(LINES, { subject: "anatomy", branch: "mbbs" }, 0).text, LINES.subject.anatomy[0]);
  assert.equal(P.pickLine(LINES, { subject: "anatomy", branch: "mbbs" }, 4).text, LINES.subject.anatomy[1]);
  assert.equal(P.pickLine(LINES, { subject: null, branch: "ss-medicine" }, 2).text, LINES.branch["ss-medicine"][2]);
  assert.equal(P.pickLine(LINES, { subject: "no-such", branch: "no-such" }, 0), null);
  assert.equal(P.pickLine({ subject: {}, branch: {}, module: { m1: ["One two three four."] } }, { module: "m1", subject: "anatomy", branch: "mbbs" }, 7).text, "One two three four.");
  assert.equal(P.pickLine(null, { subject: "anatomy" }, 0), null);
  assert.equal(P.setSubject([{ _s: "anatomy" }, { _s: "anatomy" }], (id) => id === "anatomy"), "anatomy");
  assert.equal(P.setSubject([{ _s: "anatomy" }, { _s: "physiology" }]), null, "mixed sets use the branch");
  assert.equal(P.setSubject([{ _s: "deck" }], (id) => id === "anatomy"), null, "a deck is not a subject");
});

/* ---------- milestones ---------- */
const snap = (o) => Object.assign({ lv: 1, rank: "Fresher", streak: 0, q: 0, mocks: 0 }, o);
test("milestones: level, rank (bigger), streak, questions, first mock", () => {
  assert.deepEqual(P.milestone(snap({}), snap({ lv: 2 }), null, 10), { key: "lv2", label: "Level 2", big: 0, lvl: 1 });
  const r = P.milestone(snap({ lv: 2 }), snap({ lv: 3, rank: "Intern" }), null, 10);
  assert.equal(r.key, "rk-Intern"); assert.equal(r.big, 2); assert.equal(r.label, "New rank: Intern");
  assert.equal(P.milestone(snap({ streak: 6 }), snap({ streak: 7 }), null, 10).key, "st7");
  assert.equal(P.milestone(snap({ streak: 199 }), snap({ streak: 200 }), null, 10).key, "st200");
  assert.equal(P.milestone(snap({ q: 95 }), snap({ q: 101 }), null, 10).label, "100 questions answered");
  assert.equal(P.milestone(snap({ q: 2490 }), snap({ q: 2510 }), null, 10).label, "2,500 questions answered");
  assert.equal(P.milestone(snap({ mocks: 0 }), snap({ mocks: 1 }), null, 10).key, "mock1");
  assert.equal(P.milestone(snap({}), snap({}), null, 10), null, "nothing crossed");
});
test("milestones: once each, one a day except a level-up", () => {
  const cel = { day: 10, keys: ["st7"] };
  assert.equal(P.milestone(snap({ streak: 6 }), snap({ streak: 7 }), { day: 9, keys: ["st7"] }, 10), null, "never twice");
  assert.equal(P.milestone(snap({ q: 95 }), snap({ q: 101 }), cel, 10), null, "the day's budget is used");
  assert.equal(P.milestone(snap({ q: 95 }), snap({ q: 101 }), cel, 11).key, "q100", "a new day");
  assert.equal(P.milestone(snap({ lv: 2 }), snap({ lv: 3 }), cel, 10).key, "lv3", "a level-up always");
  const s = {}; P.noteCele(s, { key: "lv3" }, 10); P.noteCele(s, { key: "q100" }, 11);
  assert.deepEqual(s.cel, { day: 11, keys: ["lv3", "q100"] });
});
test("XP and level follow prep-plan.js", () => {
  const PL = req("../prep-plan.js");
  const store = { mod: { a: { t: 60, ok: 40 }, b: { t: 3, ok: 1 } }, ls: { x: { xp: 80 } } };
  assert.equal(P.xpOfStore(store), PL.xpOf(store));
  [0, 99, 100, 299, 300, 999, 1000, 5000].forEach((x) => assert.equal(P.levelN(x), PL.levelOf(x).n, String(x)));
  assert.deepEqual(P.mileSnap({ mod: { a: { t: 60, ok: 40 } }, mh: [1] }, 3), { lv: 2, rank: "Fresher", streak: 3, q: 60, mocks: 1 });
});

/* ---------- copy rules in the shipped files ---------- */
test("no AI label in the Ask MaiK sheet, the old supported-phones text retired, the deck label removed", () => {
  const ask = readFileSync(join(ROOT, "prep-ask.js"), "utf8");
  const strings = ask.match(/"[^"\n]{12,}"/g).filter((s) => / /.test(s));
  strings.forEach((s) => assert.doesNotMatch(s, /\bAI\b|—/, s));
  const mm = readFileSync(join(ROOT, "maik-models.js"), "utf8");
  assert.doesNotMatch(mm, /iPhone 18 Pro, 17 Pro, 16 Pro|AI-enabled phones/);
  assert.match(mm, /iPhone 15 Pro or newer, an iPad with an M1 chip or newer/);
  assert.doesNotMatch(readFileSync(join(ROOT, "prep-decks.js"), "utf8"), /AI-generated educational content/);
  const sync = readFileSync(join(ROOT, "prep-sync.js"), "utf8");
  assert.match(sync, /"ask", "cel", "ml"/, "the choice, celebrations and line rotation sync");
});
