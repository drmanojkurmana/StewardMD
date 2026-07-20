/* test/kardiox-providers.test.mjs — models normalizer + mock providers + SM-2. */
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const near = (a, b, e) => Math.abs(a - b) <= e;
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

// Load models then providers into a shared fake window (providers reads window.SMD_KARDIOX_MODELS).
const win = {};
new Function("window", "module", read("kardiox-models.js"))(win, undefined);
new Function("window", "module", "setTimeout", "Promise", "Date", read("kardiox-providers.js"))(win, undefined, setTimeout, Promise, Date);
const MOD = win.SMD_KARDIOX_MODELS, P = win.SMD_KARDIOX_PROVIDERS;

// ── models ──
ok("models exposed", !!MOD && typeof MOD.makeAnalysis === "function");
const a = MOD.makeAnalysis(MOD.samples.afWithRvr);
ok("AF verdict", a.verdict === "Atrial fibrillation" && a.severity === "urgent");
ok("AF confidence + band", a.confidence === 0.91 && a.confidenceBand === "high");
ok("AF measurements", a.measurements.ventRateBpm === 128 && a.measurements.qtcMs === 468 && a.measurements.prMs === null && a.measurements.qrsMs === 92);
ok("AF findings normalized", a.findings.length === 3 && a.findings[0].weight === 0.34 && a.findings[0].evidence[0].lead === "II");
ok("AF differentials", a.differentials.length === 3 && a.differentials[0].probability === 0.91);
ok("AF redFlag + verify + eduRef", !!a.redFlag && a.redFlag.title === "Anticoagulation check" && !!a.whatToVerify && a.educationalRef === "atrial-fibrillation-01");
ok("forward-compat: unknown fields ignored, defaults filled", (() => { const x = MOD.makeAnalysis({ verdict: "X", bogusField: 1, confidence: 2 }); return x.confidence === 1 && x.severity === "info" && Array.isArray(x.findings) && x.findings.length === 0; })());
ok("band helper", MOD.band(0.9) === "high" && MOD.band(0.7) === "medium" && MOD.band(0.4) === "low");
ok("13 analysis stages", MOD.ANALYSIS_STAGES.length === 13 && MOD.ANALYSIS_STAGES[0] === "upload" && MOD.ANALYSIS_STAGES[12] === "report");

// ── SM-2 fresh-card intervals (design: Again <1m · Hard 6m · Good 1d · Easy 4d) ──
const fresh = { id: "c1", front: "f", back: "b", easeFactor: 2.5, intervalDays: 0, repetitions: 0 };
const now = 1_000_000_000_000;
const gAgain = P.sm2(fresh, "again", now), gHard = P.sm2(fresh, "hard", now), gGood = P.sm2(fresh, "good", now), gEasy = P.sm2(fresh, "easy", now);
ok("SM-2 again <1m", near(gAgain.intervalDays * 1440, 1, 0.1) && gAgain.repetitions === 0);
ok("SM-2 hard 6m", near(gHard.intervalDays * 1440, 6, 0.1));
ok("SM-2 good 1d", gGood.intervalDays === 1 && gGood.repetitions === 1);
ok("SM-2 easy 4d + ef up", gEasy.intervalDays === 4 && gEasy.easeFactor > 2.5);
ok("SM-2 dueDate advances", Date.parse(gGood.dueDate) === now + 86400000);
ok("SM-2 review-card grows by ef", (() => { const rev = { id: "c2", easeFactor: 2.5, intervalDays: 10, repetitions: 2 }; return P.sm2(rev, "good", now).intervalDays === 25; })());
ok("SM-2 again lowers ef (floor 1.3)", P.sm2({ easeFactor: 1.35, repetitions: 3, intervalDays: 9 }, "again", now).easeFactor === 1.3);

// ── mock providers assembly ──
const prov = P.mockProviders({ content: [{ id: "e1", title: "AF", category: "Rhythms", status: "mastered", bookmarked: false, ecgFindingTags: ["Irregular R-R"] }, { id: "e2", title: "STEMI", category: "Ischemia", status: "new" }] });
ok("assembly shape", prov.kind === "mock" && prov.analyzer && prov.ecgStore && prov.library && prov.learning && prov.imageProcessor);

// analyzer streams all 13 stages then resolves AF
const seen = [];
const result = await prov.analyzer.analyze({ id: "img1" }, (stage) => seen.push(stage));
ok("analyzer streamed 13 stages in order", seen.length === 13 && seen[0] === "upload" && seen[12] === "report");
ok("analyzer resolved AF analysis w/ image", result.verdict === "Atrial fibrillation" && result.image && result.image.id === "img1");

// store CRUD + deleteAll + search
await prov.ecgStore.save(result);
ok("store save+all", (await prov.ecgStore.all()).length === 1);
ok("store search hit", (await prov.ecgStore.search("atrial")).length === 1 && (await prov.ecgStore.search("zzz")).length === 0);
await prov.ecgStore.deleteAll();
ok("store deleteAll wipes", (await prov.ecgStore.all()).length === 0);

// library + learning
ok("library categories", (await prov.library.categories()).length === 2);
ok("library search tags", (await prov.library.search("irregular")).length === 1);
await prov.library.toggleBookmark("e2");
ok("library bookmark toggle", (await prov.library.bookmarks()).indexOf("e2") >= 0);
const daily1 = await prov.learning.dailyChallenge("2026-07-20"), daily2 = await prov.learning.dailyChallenge("2026-07-20");
ok("daily challenge deterministic per day", daily1 && daily1.id === daily2.id);
ok("progress shape", (await prov.learning.progress()).total === 100);

console.log(`\nkardiox-providers: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
