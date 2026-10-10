/* PrepNucleus Tests & Assessment Engine M1 (prep-assess.js, prep-profiles.js, prep/assess/profiles/*.json).
 * What must hold:
 *  - every profile is valid, carries provenance for each format/navigation/scoring rule, and the official numbers checked
 *    against the stored bulletins (NEET-PG 2026: 180 Q, 5 x 36 x 42 min, +4/-1; INI-CET Jan 2026: 200, 4 x 50 x 45, +1/-1/3;
 *    FMGE Oct 2026: 2 parts x 150, no negative marking, pass 150/300, official subject blueprint; NEET-SS 2025: 150,
 *    3 x 50 x 50, +4/-1; USMLE Step 1 blocks of 20 in 30 min from 2026-05-14, provisional; INI-SS provisional);
 *  - client and server read one source: prep.js MOCKS equals the pre-flag literal, functions/_prep-arena.js SCHEMES and
 *    functions/_prep-core.js EXAM_PROFILES equal what they were, and prep-profiles.js is the up-to-date compile;
 *  - assemble(): eligible items only, no duplicate id or stem, official quotas never filled from other subjects (shrink,
 *    with the reason), deviations recorded, refusal below the minimum, seeded determinism, daily 10 = exactly 10;
 *  - scoring per exam; locked section clock (no reopen, auto close at 0, never gains time, resume charges the gap, clock
 *    moved back ends the section); daily completion idempotent; session pack/unpack; rank shown only from N >= 100.
 * node --test test/prep-assess.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const A = require("../prep-assess.js");
const PP = require("../prep-profiles.js");
const P = require("../prep.js");
const ROOT = new URL("../", import.meta.url);

test("prep-profiles.js is the up-to-date compile of prep/assess/profiles/*.json", () => {
  const out = execFileSync(process.execPath, [new URL("../tools/prep-profiles-build.mjs", import.meta.url).pathname, "--check"], { encoding: "utf8" });
  assert.match(out, /up to date/);
  const files = fs.readdirSync(new URL("prep/assess/profiles/", ROOT)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
  assert.deepEqual(PP.ids.slice().sort(), files);
  for (const id of files) assert.deepEqual(PP.profiles[id], JSON.parse(fs.readFileSync(new URL("prep/assess/profiles/" + id + ".json", ROOT), "utf8")), id);
});

test("every profile validates; official rules have a source; no dashes", () => {
  assert.deepEqual(A.profileIds(), ["neet-pg", "ini-cet", "fmge", "neet-ss", "ini-ss", "usmle-step1"]);
  for (const id of A.profileIds()) assert.deepEqual(A.validateProfile(A.profile(id)), [], id);
  // the validator catches drift
  const bad = JSON.parse(JSON.stringify(A.profile("neet-pg"))); bad.format.sections[0].questions = 40;
  assert.ok(A.validateProfile(bad).some((e) => /sections add up/.test(e)));
  const nos = JSON.parse(JSON.stringify(A.profile("neet-pg"))); nos.provenance = nos.provenance.filter((r) => r.field !== "/scoring/incorrect");
  assert.ok(A.validateProfile(nos).some((e) => /no provenance for \/scoring\/incorrect/.test(e)));
  const unsrc = JSON.parse(JSON.stringify(A.profile("fmge"))); unsrc.provenance[0].src = "NOPE";
  assert.ok(A.validateProfile(unsrc).some((e) => /without a source/.test(e)));
});

test("official numbers as checked in the stored bulletins (2026-10-10)", () => {
  const pg = A.profile("neet-pg");
  assert.equal(pg.status, "official"); assert.equal(pg.format.questions, 180); assert.equal(pg.format.duration_min, 210);
  assert.deepEqual(pg.format.sections.map((s) => [s.id, s.questions, s.minutes]), [["A", 36, 42], ["B", 36, 42], ["C", 36, 42], ["D", 36, 42], ["E", 36, 42]]);
  assert.deepEqual([pg.scoring.correct, pg.scoring.incorrect, pg.scoring.unanswered], [4, -1, 0]);
  assert.equal(pg.navigation.return_to_closed_section, false); assert.equal(pg.navigation.early_section_submit, false);
  assert.equal(pg.blueprint.kind, "none");
  const ini = A.profile("ini-cet");
  assert.deepEqual([ini.format.questions, ini.format.duration_min, ini.format.sections.length, ini.format.sections[0].questions, ini.format.sections[0].minutes], [200, 180, 4, 50, 45]);
  assert.equal(ini.scoring.correct, 1); assert.ok(Math.abs(ini.scoring.incorrect + 1 / 3) < 1e-12);
  assert.ok(ini.format.item_types.includes("multiple_correct"));
  assert.equal(ini.item_styles[0].style, "statement_combination"); assert.equal(ini.item_styles[0].share, null, "share not in the prospectus: no invented quota");
  const fm = A.profile("fmge");
  assert.equal(fm.scoring.incorrect, 0, "FMGE: no negative marking"); assert.deepEqual(fm.scoring.pass, { marks: 150, of: 300 });
  assert.equal(fm.format.parts, 2); assert.equal(fm.format.sections.length, 6); assert.equal(fm.blueprint.kind, "official_counts");
  assert.equal(A.provOf(fm, "/scoring/correct").official, false, "FMGE +1 is inferred, and says so");
  assert.equal(fm.blueprint.subjects.medicine, 33); assert.equal(fm.blueprint.subjects.surgery, 32); assert.equal(fm.blueprint.unmapped.radiotherapy, 5);
  const ss = A.profile("neet-ss");
  assert.deepEqual([ss.format.questions, ss.format.sections.length, ss.scoring.correct, ss.scoring.incorrect], [150, 3, 4, -1]);
  const us = A.profile("usmle-step1");
  assert.equal(us.status, "provisional", "guessing penalty and block return rule not verified");
  assert.equal(us.format.block_max_items, 20); assert.equal(us.format.sections[0].minutes, 30); assert.equal(us.format.sections.length, 14);
  const is = A.profile("ini-ss");
  assert.equal(is.status, "provisional"); assert.ok(is.provenance.every((r) => r.official === false), "INI-SS: nothing claimed official");
});

test("client and server read the same profiles: MOCKS, SCHEMES, EXAM_PROFILES unchanged", async () => {
  // The literals as they were in prep.js, functions/_prep-arena.js and functions/_prep-core.js before the move.
  const OLD_MOCKS = {
    "neet-pg": [{ id: "neet-pg", label: "NEET-PG pattern", n: 200, min: 210, plus: 4, minus: 1 }, { id: "ini-cet", label: "INI-CET pattern", n: 200, min: 180, plus: 1, minus: 1 / 3 }],
    "neet-ss": [{ id: "neet-ss", label: "NEET-SS pattern", n: 150, min: 150, plus: 4, minus: 1 }],
    "usmle": [{ id: "usmle-block", label: "USMLE block", n: 40, min: 60, plus: 1, minus: 0 }],
    "fmge": [{ id: "fmge", label: "FMGE pattern", n: 300, min: 300, plus: 1, minus: 0, parts: 2, pass: 150 }]
  };
  assert.deepEqual(P.MOCKS, OLD_MOCKS);
  assert.equal(JSON.stringify(P.MOCKS), JSON.stringify(OLD_MOCKS), "same key order");
  const OLD_SCHEMES = { "neet-pg": { plus: 4, minus: 1 }, "ini-cet": { plus: 1, minus: 1 / 3 }, "neet-ss": { plus: 4, minus: 1 }, "usmle": { plus: 1, minus: 0 } };
  const AR = await import("../functions/_prep-arena.js");
  assert.deepEqual(AR.SCHEMES, OLD_SCHEMES);
  const OLD_EP = {
    "neet-pg": { id: "neet-pg", name: "NEET-PG", style: "high-yield facts, clinical application, common traps, rapid recall", stem: "short vignette or direct", cog: { recall: 0.4, application: 0.4, reasoning: 0.2 }, d: { 1: 0.3, 2: 0.5, 3: 0.2 } },
    "ini-cet": { id: "ini-cet", name: "INI-CET", style: "conceptual depth, clinical application, recent guideline points, image-free one-liners and short vignettes", stem: "short vignette or direct", cog: { recall: 0.3, application: 0.45, reasoning: 0.25 }, d: { 1: 0.2, 2: 0.5, 3: 0.3 } },
    "neet-ss": { id: "neet-ss", name: "NEET-SS", style: "superspecialty depth, management decisions, recent trials and guidelines, clinical vignettes", stem: "clinical vignette", cog: { recall: 0.25, application: 0.45, reasoning: 0.3 }, d: { 1: 0.15, 2: 0.5, 3: 0.35 } },
    "usmle": { id: "usmle", name: "USMLE", style: "clinical vignette, mechanism, diagnosis, next best step; 2 to 5 sentence stem with age, sex, setting and findings", stem: "vignette", cog: { recall: 0.15, application: 0.4, reasoning: 0.45 }, d: { 1: 0.2, 2: 0.5, 3: 0.3 } },
  };
  const CORE = await import("../functions/_prep-core.js");
  assert.deepEqual(CORE.EXAM_PROFILES, OLD_EP);
  // the three readers agree on marking for every legacy pattern
  for (const tab of Object.keys(P.MOCKS)) for (const m of P.MOCKS[tab]) {
    const id = m.id === "usmle-block" ? "usmle-step1" : m.id, prof = A.profile(id);
    assert.equal(prof.scoring.correct, m.plus, id); assert.equal(-prof.scoring.incorrect || 0, m.minus, id);
    const sid = m.id === "usmle-block" ? "usmle" : m.id;
    if (AR.SCHEMES[sid]) { assert.equal(AR.SCHEMES[sid].plus, m.plus); assert.equal(AR.SCHEMES[sid].minus, m.minus); }
  }
});

/* ---------- a synthetic bank ---------- */
function mkBank(spec, opts = {}) {
  const bank = [];
  for (const [s, mods] of Object.entries(spec)) mods.forEach((n, mi) => {
    const m = s + "-m" + mi, items = [];
    for (let i = 0; i < n; i++) items.push({ id: s + "." + mi + "." + i, q: "Question about " + s + " module " + mi + " number " + i + " with enough words", o: ["w", "x", "y", "z"], a: i % 4, d: 1 + (i % 3), _s: s, _m: m });
    bank.push({ s, m, items });
  });
  return bank;
}
const FM = A.profile("fmge"), PG = A.profile("neet-pg"), INI = A.profile("ini-cet");
const fullFmge = () => { const sp = {}; for (const [s, n] of Object.entries(FM.blueprint.subjects)) sp[s] = [n + 10, 10]; return sp; };

test("assemble: official FMGE quotas, radiotherapy shortfall shrinks the test and says why", () => {
  const r = A.assemble(FM, "grand", { seed: "s1" }, mkBank(fullFmge()));
  assert.equal(r.ok, true); assert.equal(r.requested, 300); assert.equal(r.count, 295); assert.equal(r.reduced, true);
  for (const [s, n] of Object.entries(FM.blueprint.subjects)) assert.equal(r.actual[s], n, s);
  assert.ok(r.deviations.some((d) => /Radiotherapy: 5 planned/.test(d)));
  assert.ok(/^Reduced to 295 of 300/.test(r.deviations[0]));
  assert.equal(r.sections.reduce((a, s) => a + s.n, 0), 295);
  assert.deepEqual(r.sections.map((s) => s.from), [0, 50, 99, 148, 197, 246]);
  // one subject short: its quota shrinks, nobody else fills it
  const sp = fullFmge(); sp.medicine = [20];
  const r2 = A.assemble(FM, "grand", { seed: "s1" }, mkBank(sp));
  assert.equal(r2.actual.medicine, 20); assert.equal(r2.actual.surgery, 32); assert.equal(r2.count, 282);
  assert.ok(r2.deviations.some((d) => /medicine: 33 planned by the official blueprint, 20 eligible/.test(d)));
});

test("assemble: eligibility, duplicates, sidecar, exclusions", () => {
  const bank = mkBank({ anatomy: [30], physiology: [30] });
  const it = bank[0].items;
  it[0].flags = ["disputed"]; it[1].q = it[2].q; bank[1].items.push(Object.assign({}, it[3]));   // flagged; same stem; same id twice
  const quality = A.readQuality({ v: 1, records: [{ item_id: it[4].id, status: "requires_review" }, { item_id: it[5].id, status: "approved", key: { value: 0, confidence: "disputed" } }, { item_id: it[6].id, status: "approved" }, { item_id: "x", status: "bogus" }] });
  assert.equal(Object.keys(quality).length, 3);
  const r = A.assemble(PG, "subject_mini", { seed: 7, count: 60, hidden: { [it[7].id]: 1 }, exclude: { [it[8].id]: 1 }, quality }, bank);
  const ids = r.items.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate id");
  const stems = r.items.map((x) => A.normStem(x.q)); assert.equal(new Set(stems).size, stems.length, "no duplicate stem");
  for (const bad of [0, 4, 5, 7, 8]) assert.ok(!ids.includes(it[bad].id), "excluded " + bad);
  assert.ok(ids.includes(it[6].id), "approved stays");
  assert.ok(r.deviations.some((d) => /duplicate/.test(d)));
  // decision 5: three-way agreement without a rubric blocker is eligible before approval; a rubric fail is not
  assert.equal(A.eligible(it[9], { quality: A.readQuality([{ item_id: it[9].id, status: "automated_checks_passed", key: { value: 0, confidence: "agreed_independent" }, rubric: { "OBJ-02": "pass", "STM-05": "flag" } }]) }), "");
  assert.equal(A.eligible(it[9], { quality: A.readQuality([{ item_id: it[9].id, status: "automated_checks_passed", rubric: { "OPT-03": "fail" } }]) }), "rubric-blocker");
  // a record whose content hash no longer matches is ignored (default eligibility)
  const q2 = A.readQuality([{ item_id: it[4].id, status: "rejected", content_hash: "old" }]);
  assert.equal(A.eligible(it[4], { quality: q2, hashOf: () => "new" }), "");
  assert.equal(A.eligible(it[4], { quality: q2, hashOf: () => "old" }), "status:rejected");
});

test("assemble: seeded determinism, refusal, daily 10 is exactly 10", () => {
  const bank = mkBank({ anatomy: [40, 40], pathology: [40], medicine: [50] });
  const a = A.assemble(PG, "grand", { seed: "x" }, bank), b = A.assemble(PG, "grand", { seed: "x" }, bank), c = A.assemble(PG, "grand", { seed: "y" }, bank);
  assert.deepEqual(a.items.map((i) => i.id), b.items.map((i) => i.id));
  assert.notDeepEqual(a.items.map((i) => i.id), c.items.map((i) => i.id));
  assert.equal(a.count, 170); assert.equal(a.reduced, true); assert.equal(a.ok, true, "170 of 180 is above the minimum");
  assert.deepEqual(a.sections.map((s) => s.n), [34, 34, 34, 34, 34]);
  assert.ok(a.sections.every((s) => s.sec === Math.round(42 * 60 * 34 / 36)), "pace kept");
  const small = A.assemble(PG, "grand", { seed: "x" }, mkBank({ anatomy: [30] }));
  assert.equal(small.ok, false); assert.match(small.refused, /needs at least 90/);
  const d1 = A.assemble(PG, "daily10", { seed: A.dailyKey("neet-pg", Date.UTC(2026, 9, 10, 3)) }, bank);
  const d2 = A.assemble(PG, "daily10", { seed: A.dailyKey("neet-pg", Date.UTC(2026, 9, 10, 17)) }, bank);
  assert.equal(d1.count, 10); assert.equal(d1.items.length, 10); assert.equal(d1.ok, true);
  assert.deepEqual(d1.items.map((i) => i.id), d2.items.map((i) => i.id), "same IST day, same 10");
  assert.equal(d1.duration_sec, 12 * 60, "NEET-PG: 10 x 70 s, about 12 min");
  assert.equal(A.blueprint(FM, "daily10").duration_sec, 600);
  const d3 = A.assemble(PG, "daily10", { seed: "z" }, mkBank({ anatomy: [9] }));
  assert.equal(d3.ok, false, "daily 10 never runs short");
  assert.equal(A.istDate(Date.UTC(2026, 9, 10, 18, 29)), "2026-10-10"); assert.equal(A.istDate(Date.UTC(2026, 9, 10, 18, 31)), "2026-10-11");
});

test("statement-combination (INI-CET multiple correct) items are recognised and counted", () => {
  const combo = { id: "c1", q: "Consider: 1. A is true 2. B is true 3. C is true 4. D is true. Which are correct?", o: ["1 and 2 only", "1, 2 and 3", "2 and 4", "All of the above"], a: 1 };
  const plain = { id: "p1", q: "Drug of choice for X?", o: ["A drug", "B drug", "C drug", "D drug"], a: 0 };
  assert.equal(A.isCombination(combo), true); assert.equal(A.isCombination(plain), false);
  assert.equal(A.itemStyle(combo), "statement_combination");
  const bank = mkBank({ anatomy: [60], medicine: [60] });
  bank[0].items[0] = Object.assign({}, combo, { _s: "anatomy", _m: "anatomy-m0" });
  const r = A.assemble(INI, "mini", { seed: 3 }, bank);
  assert.ok(r.deviations.some((d) => /Statement-combination .*no quota/.test(d)));
  // a known share is enforced as a recorded shortfall
  const withShare = JSON.parse(JSON.stringify(INI)); withShare.item_styles[0].share = 0.2;
  const r2 = A.assemble(withShare, "mini", { seed: 3 }, bank);
  assert.ok(r2.deviations.some((d) => /planned \(20%\)/.test(d)));
});

test("adaptive diagnostic: least practised subjects first, no prediction", () => {
  const bank = mkBank({ anatomy: [20], physiology: [20], pathology: [20], medicine: [20], surgery: [20] });
  const hist = { anatomy: { t: 50, ok: 45 }, physiology: { t: 50, ok: 10 }, pathology: { t: 0, ok: 0 }, medicine: { t: 2, ok: 1 }, surgery: { t: 40, ok: 30 } };
  const r = A.assemble(PG, "diagnostic", { seed: 1, count: 6, history: hist }, bank);
  assert.equal(r.count, 6);
  assert.deepEqual(Object.keys(r.actual).sort(), ["medicine", "pathology", "physiology"], "never-answered and the weakest first");
  assert.ok(!("predicted" in r) && !("percentile" in r));
});

test("scoring by each exam's profile", () => {
  const items = [0, 1, 2, 3, 0].map((a, i) => ({ id: "i" + i, a, _s: i < 3 ? "anatomy" : "medicine", _m: "m" + (i % 2), d: 2 }));
  const ans = [0, 2, -1, 3, 1];   // right, wrong, blank, right, wrong
  const pg = A.score(items, ans, PG.scoring, { sections: [{ id: "A", label: "A", from: 0, to: 3 }, { id: "B", label: "B", from: 3, to: 5 }] });
  assert.deepEqual([pg.raw, pg.max, pg.correct, pg.incorrect, pg.unanswered], [6, 20, 2, 2, 1]);
  assert.equal(pg.accuracy, 0.5);
  assert.deepEqual(pg.by_section.map((b) => [b.key, b.raw]), [["A", 3], ["B", 3]]);
  assert.equal(A.score(items, ans, FM.scoring).raw, 2, "FMGE: no negative marking");
  assert.equal(A.score(items, ans, INI.scoring).raw, 1.33, "INI-CET: +1, minus 1/3");
  // same as prep.js scoreMock for the legacy patterns
  for (const m of [].concat(...Object.values(P.MOCKS))) assert.equal(A.score(items, ans, { correct: m.plus, incorrect: -m.minus, unanswered: 0 }).raw, P.scoreMock(items, ans, m).marks);
  const rec = A.result({ attempt_id: "a1", test_type: "grand", started: 0, finished: 1000, items, ans, ms: [1000, 2000, 0, 3000, 4000], sections: [{ id: "A", label: "A", from: 0, to: 3 }, { id: "B", label: "B", from: 3, to: 5 }], asm: { planned: { anatomy: 3 }, actual: { anatomy: 3, medicine: 2 }, deviations: ["x"] } }, PG);
  for (const k of ["attempt_id", "exam", "profile_version", "test_type", "started_at", "items", "score"]) assert.ok(k in rec, k);
  assert.equal(rec.exam, "neet-pg"); assert.equal(rec.profile_version, "2026.1.0"); assert.equal(rec.score.avg_ms, 2500);
  assert.equal(rec.cohort, null);
  const forbidden = JSON.stringify(rec); for (const w of ["percentile", "predict", "probability", "readiness", "rank"]) assert.ok(!forbidden.includes(w), w);
  assert.deepEqual(rec.items.map((x) => x.section), ["A", "A", "A", "B", "B"]);
});

test("locked section clock: never gains time, cannot reopen, resumes with the gap charged", () => {
  const c = A.scNew([{ sec: 60 }, { sec: 60 }]);
  A.scStart(c, 0, 1000, 1e9);
  A.scCharge(c, 11000, 1e9 + 10000); assert.equal(A.scLeft(c), 50000);
  A.scCharge(c, 12000, 1e9 + 20000); assert.equal(A.scLeft(c), 40000, "suspended page: the wall clock counts");
  A.scCharge(c, 22000, 1e9 + 15000); assert.equal(A.scLeft(c), 30000, "wall clock back a little: the monotonic clock counts");
  A.scCharge(c, 25000, 1e9 + 18000); assert.equal(A.scLeft(c), 27000, "no double count after a small step back");
  // killed; reopened 20 s after the last save: the gap is charged
  const saved = JSON.parse(JSON.stringify(c));
  A.scResume(saved, saved.wall + 20000); assert.equal(A.scLeft(saved), 7000);
  // reopened after the section's time: it is over (submitted on resume)
  const late = JSON.parse(JSON.stringify(c)); assert.equal(A.scResume(late, late.wall + 3600e3), 0);
  // a device clock set back by more than 2 minutes ends the section
  const back = JSON.parse(JSON.stringify(c)); assert.equal(A.scResume(back, back.wall - 5 * 60e3), 0); assert.equal(back.why[0], "clock");
  // closing locks; a closed section cannot start again; the next starts uncharged
  A.scClose(c, 0, "submitted"); assert.equal(c.run, false);
  assert.equal(A.scStart(c, 0, 0, 0), false);
  assert.equal(A.scLeft(c, 1), 60000, "a section not yet started is never charged");
  A.scStart(c, 1, 0, 2e9); A.scCharge(c, 70000, 2e9 + 70000); assert.equal(A.scLeft(c), 0);
});

test("daily 10 completion is idempotent; session pack and unpack", () => {
  const map = {}, key = A.dailyKey("fmge", Date.UTC(2026, 9, 10, 6));
  assert.equal(key, "daily10:fmge:2026-10-10");
  const a = A.dailyComplete(map, key, { raw: 7 }); assert.equal(a.fresh, true);
  const b = A.dailyComplete(map, key, { raw: 10 }); assert.equal(b.fresh, false); assert.equal(map[key].raw, 7, "a retry never overwrites");
  map["daily10:fmge:2026-01-01"] = {}; A.dailyPrune(map, Date.UTC(2026, 9, 10), 60); assert.ok(!map["daily10:fmge:2026-01-01"]); assert.ok(map[key]);
  const items = [{ id: 1, _s: "anatomy", _m: "m1" }, { id: "b", _s: "anatomy", _m: "m2" }, { id: "c", _s: "x", _m: "y" }];
  const run = { t2: { exam: "neet-pg" }, title: "T", mode: "exam", i: 1, ans: [0, -1, 2], mark: { 1: true }, items, sc: A.scNew([{ sec: 10 }]), t0: 5, limit: 0, phase: "between" };
  const pk = JSON.parse(JSON.stringify(A.sessPack(run, 99)));
  assert.equal(pk.saved, 99); assert.deepEqual(pk.q, [["anatomy", "m1", "1"], ["anatomy", "m2", "b"], ["x", "y", "c"]]); assert.equal(pk.phase, "between");
  const u = A.sessUnpack(pk, { "anatomy|m1": [{ id: 1, q: "a" }], "anatomy|m2": [{ id: "b", q: "b" }] });
  assert.equal(u.items.length, 3); assert.equal(u.missing, 1); assert.equal(u.items[2]._gone, true);
});

test("cohort rank only from a minimum N", () => {
  assert.equal(A.RANK_MIN_N, 100);
  assert.equal(A.rankShown(99), false); assert.equal(A.rankShown(100), true); assert.equal(A.rankShown(undefined), false);
});

test("the bank route serves only the versioned quality sidecar paths", async () => {
  const B = await import("../functions/api/prep/bank/[[path]].js");
  assert.equal(B.bankPath({ path: ["quality", "index.json"] }), "quality/index.json");
  assert.equal(B.bankPath({ path: ["quality", "v1", "medicine.json"] }), "quality/v1/medicine.json");
  assert.equal(B.bankPath({ path: ["quality", "medicine.json"] }), null);
  assert.equal(B.bankPath({ path: ["quality", "v1", "..", "x.json"] }), null);
});

test("flag smd_prep_tests2 is off by default", () => {
  const ls = {}, G = { location: { search: "" }, localStorage: { getItem: (k) => (k in ls ? ls[k] : null) }, PREP_ASSESS: A };
  const src = fs.readFileSync(new URL("prep-tests.js", ROOT), "utf8");
  new Function("window", src)(G);
  assert.equal(G.PREP_TESTS.on(), false);
  ls.smd_prep_tests2 = "1"; assert.equal(G.PREP_TESTS.on(), true);
  G.location.search = "?tests2=0"; assert.equal(G.PREP_TESTS.on(), false);
  ls.smd_prep_tests2 = "0"; G.location.search = "?tests2=1"; assert.equal(G.PREP_TESTS.on(), true);
});

test("opt-in statistics endpoint: de-identified rows only, stub without a binding, aggregate upsert with one", async () => {
  const S = await import("../functions/api/prep/stats.js");
  assert.equal(S.clean({ v: 1, exam: "neet-pg", items: [] }).rows.length, 0);
  assert.equal(S.clean({ v: 2, exam: "neet-pg", items: [] }), null);
  assert.equal(S.clean({ v: 1, exam: "nope", items: [] }), null);
  const c = S.clean({ v: 1, exam: "fmge", uid: "me", items: [["a-1", 1, 30, 2], ["a-1", 0, 3, 1], ["b 2", 1, 3, 1], ["c-3", null, 5, -1], ["d-4", null, 5, 2], ["e-5", 0, 99999, 1]] });
  assert.deepEqual(c, { exam: "fmge", rows: [["a-1", 1, 30, 2], ["c-3", null, 5, -1]] });
  const req = (b) => ({ request: { json: async () => b }, env: {} });
  const r1 = await S.onRequestPost(req({ v: 1, exam: "fmge", items: [["a-1", 1, 30, 2]] }));
  assert.equal(r1.status, 202); assert.deepEqual(await r1.json(), { accepted: 1, stored: false });
  const calls = [];
  const db = { prepare: (sql) => ({ bind: (...a) => { calls.push([sql, a]); return a; } }), batch: async (l) => l };
  const r2 = await S.onRequestPost({ request: { json: async () => ({ v: 1, exam: "fmge", items: [["a-1", 1, 30, 2]] }) }, env: { PREP_STATS_DB: db } });
  assert.deepEqual(await r2.json(), { accepted: 1, stored: true });
  assert.match(calls[0][0], /ON CONFLICT\(item_id\) DO UPDATE SET n = n \+ 1/);
  assert.deepEqual(calls[0][1].slice(0, 9), ["a-1", "fmge", 1, 0, 30, 0, 0, 1, 0]);
  assert.equal((await S.onRequestPost(req("x"))).status, 400);
});
