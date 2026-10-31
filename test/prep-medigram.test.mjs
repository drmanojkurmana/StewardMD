/* PrepReels (prep-medigram-data.js + prep-medigram-media.js) pure helpers.
 * Plan section 15: eligibility, ranking, cadence, finite missions, FSRS gate, break timer,
 * review/rights/expiry gates, offline and malformed media, flags and language gates.
 * No network, no real YouTube, no paid call. node --test test/prep-medigram.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const D = require("../prep-medigram-data.js");
const M = require("../prep-medigram-media.js");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const NOW = Date.parse("2026-10-31T00:00:00Z");
const base = (o = {}) => Object.assign({ id: "c1", kind: "mcq", exam: ["neet-pg"], subject: "medicine", module: "m1", topicIds: ["t1"], language: "en", title: "T", questionId: "q1", rightsStatus: "owned", clinicalReview: { status: "approved", reviewedAt: "2026-10-01", reviewerRole: "medicine" }, captions: { en: true }, sourceRefs: [], tags: [], updatedAt: "2026-10-01" }, o);
const lesson = (o = {}) => base({ id: "l1", kind: "micro_lesson", questionId: undefined, lessonId: "les1", media: { provider: "first_party", assetId: "a1" }, ...o });

test("flags: parent OFF by default, requires smd_prep; study only-on default", () => {
  const get = (m) => (k) => m[k] ?? null;
  assert.deepEqual(D.resolveFlags({ prepEnabled: true, get: get({}), search: "" }), { parent: false, study: false, discovery: false, breakMode: false, youtube: false });
  assert.deepEqual(D.resolveFlags({ prepEnabled: false, get: get({ smd_prep_medigram: "1" }), search: "" }).parent, false);
  assert.deepEqual(D.resolveFlags({ prepEnabled: true, get: get({ smd_prep_medigram: "1" }), search: "" }), { parent: true, study: true, discovery: false, breakMode: false, youtube: false });
  const all = D.resolveFlags({ prepEnabled: true, get: get({ smd_prep_medigram: "1", smd_prep_medigram_discovery: "1", smd_prep_medigram_break: "1", smd_prep_medigram_youtube: "1" }), search: "" });
  assert.deepEqual(all, { parent: true, study: true, discovery: true, breakMode: true, youtube: true });
  assert.equal(D.resolveFlags({ prepEnabled: true, get: get({}), search: "?medigram=1&medigram_study=0" }).study, false);
});

test("contract: valid passes; missing key fields and bad YouTube id fail", () => {
  assert.equal(D.validateCandidate(base(), { now: NOW }).ok, true);
  assert.equal(D.validateCandidate(null).ok, false);
  assert.ok(D.validateCandidate(base({ exam: [] }), { now: NOW }).errors.includes("exam"));
  assert.ok(D.validateCandidate(base({ clinicalReview: { status: "pending" } }), { now: NOW }).errors.includes("clinicalReview.status"));
  assert.ok(D.validateCandidate(base({ kind: "video", media: { provider: "youtube", videoId: "bad id!" }, rightsStatus: "youtube_embed", questionId: undefined }), { now: NOW }).errors.includes("media.videoId"));
  assert.equal(D.validateCandidate({ id: "x", kind: "video", media: { provider: "youtube", videoId: "dQw4w9WgXcQ" } }, { now: NOW }).ok, false, "malformed third-party metadata never passes");
});

test("gates: disputed, hidden, expired rights and unreviewed never eligible", () => {
  const ctx = { exam: "neet-pg", mode: "study", now: NOW, today: 100, youtubeEnabled: false, language: "en" };
  assert.equal(D.isEligible(base(), ctx), true);
  assert.equal(D.isEligible(base({ flags: ["disputed"] }), ctx), false);
  assert.equal(D.isEligible(base({ disputed: true }), ctx), false);
  assert.equal(D.isEligible(base(), { ...ctx, hiddenIds: { c1: 1 } }), false);
  assert.equal(D.isEligible(base({ rightsExpiresAt: NOW - 1 }), ctx), false);
  assert.equal(D.isEligible(base({ rightsStatus: "withdrawn" }), ctx), false);
  assert.equal(D.isEligible(base({ clinicalReview: { status: "pending", reviewerRole: "x" } }), ctx), false);
  assert.equal(D.isEligible(base({ exam: ["usmle"] }), ctx), false, "wrong exam out");
});

test("language gate: Hindi/Telugu need own captions and a reviewer", () => {
  const ctx = { exam: "neet-pg", mode: "study", now: NOW, today: 100, language: "hi" };
  assert.equal(D.isEligible(lesson({ id: "h1", language: "hi", captions: { hi: true }, clinicalReview: { status: "approved", reviewerRole: "medicine-hi" } }), ctx), true);
  assert.equal(D.isEligible(lesson({ id: "h2", language: "hi", captions: { en: true }, clinicalReview: { status: "approved", reviewerRole: "medicine-hi" } }), ctx), false);
  assert.equal(D.isEligible(lesson({ id: "h3", language: "hi", captions: { hi: true }, clinicalReview: { status: "approved" } }), ctx), false);
  const te = { ...ctx, language: "te" };
  assert.equal(D.isEligible(lesson({ id: "t9", language: "te", captions: { te: true }, clinicalReview: { status: "approved", reviewerRole: "medicine-te" } }), te), true);
});

test("ranking: due reviews and mistakes first, deterministic", () => {
  const due = base({ id: "b-due", questionId: "q-due" }), fresh = base({ id: "a-fresh", questionId: "q-fresh" }), miss = base({ id: "c-miss", questionId: "q-miss" });
  const ctx = { today: 100, dueMap: { "q-due": 90 }, mistakeIds: { "q-miss": 1 } };
  assert.deepEqual(D.rankCandidates([fresh, miss, due], ctx).map((c) => c.id), ["b-due", "c-miss", "a-fresh"]);
  assert.deepEqual(D.rankCandidates([fresh, due], ctx).map((c) => c.id), D.rankCandidates([due, fresh], ctx).map((c) => c.id), "same inputs, same order");
  assert.match(D.reasonFor(due, ctx), /Due/);
  assert.match(D.reasonFor(miss, ctx), /missed/);
});

test("cadence: 3:1 sequence, retrieval after lesson, finite; 2:1 and 5:1 config", () => {
  const qs = [1, 2, 3, 4, 5, 6].map((n) => base({ id: "q" + n, questionId: "qq" + n }));
  const ls = [lesson({ id: "l1" }), lesson({ id: "l2" })];
  const feed = D.buildFeed([...qs, ...ls], { cadence: "3:1", size: 9 });
  assert.ok(feed.length <= 9);
  assert.equal(feed[3].id, "l1");
  assert.equal(feed[4]._retrievalFor, "l1", "question after a lesson is its retrieval check");
  assert.equal(D.cadenceN("2:1"), 2); assert.equal(D.cadenceN("5:1"), 5); assert.equal(D.cadenceN("bogus"), 3);
  assert.deepEqual(D.dedupe([qs[0], qs[0], qs[1]]).map((c) => c.id), ["q1", "q2"], "duplicate prevention, stable ids");
});

test("missions: finite, video alone never completes", () => {
  const mix = D.missionById("mix");
  assert.equal(D.isMissionComplete(mix, { answered: 3, retrievalAnswered: 0 }), false);
  assert.equal(D.isMissionComplete(mix, { answered: 3, retrievalAnswered: 1 }), true);
  assert.equal(D.isMissionComplete(D.missionById("five"), { answered: 5 }), true);
  assert.equal(D.isMissionComplete(D.missionById("five"), { answered: 4 }), false);
});

test("FSRS gate: only valid answers and grades schedule", () => {
  assert.equal(D.shouldScheduleFsrs({ type: "mcq_answer", correct: true }), true);
  assert.equal(D.shouldScheduleFsrs({ type: "retrieval_answer", correct: false }), true);
  assert.equal(D.shouldScheduleFsrs({ type: "recall_grade", grade: 3 }), true);
  assert.equal(D.shouldScheduleFsrs({ type: "recall_grade", grade: 9 }), false);
  for (const t of ["video_view", "dwell", "like", "item_saved", "item_skipped", "lesson_completed"]) assert.equal(D.shouldScheduleFsrs({ type: t, correct: true }), false, t);
  assert.equal(D.shouldScheduleFsrs(null), false);
});

test("break timer: 3 or 5 minutes, expiry offers return, never locks", () => {
  const b = D.createBreak(5, 1000);
  assert.equal(b.durationMin, 5);
  assert.equal(D.createBreak(9, 1000).durationMin, 3, "only 3 or 5");
  assert.deepEqual(D.breakState(b, 1000), { remainingSec: 300, expired: false, durationMin: 5 });
  assert.equal(D.breakState(b, 1000 + 301e3).expired, true);
  assert.ok(D.extendBreak(b, 3, 2000).endsAt > 2000);
});

test("modes: study hides break items, clinical keeps lessons, break keeps only break", () => {
  const ctx = { exam: "neet-pg", now: NOW, today: 1, language: "en", youtubeEnabled: false };
  const brk = base({ id: "br", kind: "break", questionId: undefined });
  assert.equal(D.isEligible(brk, { ...ctx, mode: "study" }), false);
  assert.equal(D.isEligible(brk, { ...ctx, mode: "break" }), true);
  assert.equal(D.isEligible(lesson(), { ...ctx, mode: "clinical" }), true);
  assert.equal(D.isEligible(base(), { ...ctx, mode: "clinical" }), false);
});

test("media: YouTube behind policy flag, offline and bad metadata degrade", () => {
  const yt = { kind: "video", title: "V", media: { provider: "youtube", videoId: "dQw4w9WgXcQ" } };
  assert.equal(M.describe(yt, { youtubeEnabled: false }).kind, "disabled");
  assert.equal(M.describe(yt, { youtubeEnabled: true, offline: true }).kind, "unavailable");
  assert.equal(M.describe(yt, { youtubeEnabled: true }).kind, "youtube");
  assert.match(M.describe(yt, { youtubeEnabled: true }).url, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  assert.equal(M.describe({ kind: "video", media: { provider: "youtube", videoId: "bad id" } }, { youtubeEnabled: true }).kind, "unavailable");
  assert.equal(M.describe(null, {}).kind, "none");
  assert.equal(M.embedUrl("bad id"), null);
});

test("events: consent-aware, learning outcomes only, sensitive keys dropped", () => {
  assert.equal(D.buildEvent("mcq_answered", { correct: true }, { analytics: false }), null);
  assert.equal(D.buildEvent("video_view", {}, { analytics: true }), null);
  const e = D.buildEvent("mcq_answered", { correct: true, trackTitle: "secret", candidateId: "c1" }, { analytics: true }, 5);
  assert.deepEqual(e, { name: "mcq_answered", at: 5, data: { correct: true, candidateId: "c1" } });
});

test("wiring: loader fetches PrepReels only when on; prep.js hooks stay guarded; CSS contract", () => {
  const loader = read("prep-loader.js"), prep = read("prep.js"), css = read("prep-medigram.css");
  assert.match(loader, /MG_JS = \["prep-medigram-data\.js", "prep-medigram-media\.js", "prep-medigram\.js"\]/);
  assert.match(loader, /if \(mgOn\(\)\)/);
  assert.match(prep, /a\.indexOf\("mg-"\) === 0 && G\.PREP_MEDIGRAM/);
  assert.match(prep, /G\.PREP_MEDIGRAM \? G\.PREP_MEDIGRAM\.homeHtml\(HOST\)/);
  assert.match(css, /\.pn-mg-opt \{[^}]*min-height: 52px/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /#42cdb5/i);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient|backdrop-filter/);
  const ui = read("prep-medigram.js");
  assert.match(ui, /Finish session/);
  assert.match(ui, /I don't understand|I don\\'t understand/);
  assert.doesNotMatch(ui, /api\.youtube\.com|googleapis|fetch\(/, "no paid or YouTube API call in the feed");
});
