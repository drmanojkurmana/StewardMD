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

test("flags: parent ON by default (owner 2026-11-17), requires smd_prep; study and youtube on by default", () => {
  const get = (m) => (k) => m[k] ?? null;
  assert.deepEqual(D.resolveFlags({ prepEnabled: true, get: get({}), search: "" }), { parent: true, study: true, discovery: false, breakMode: false, youtube: true });
  assert.deepEqual(D.resolveFlags({ prepEnabled: false, get: get({ smd_prep_medigram: "1" }), search: "" }).parent, false);
  assert.deepEqual(D.resolveFlags({ prepEnabled: true, get: get({ smd_prep_medigram: "1" }), search: "" }), { parent: true, study: true, discovery: false, breakMode: false, youtube: true });
  assert.equal(D.resolveFlags({ prepEnabled: true, get: get({ smd_prep_medigram: "1", smd_prep_medigram_youtube: "0" }), search: "" }).youtube, false);
  assert.deepEqual(D.resolveFlags({ prepEnabled: true, get: get({ smd_prep_medigram: "0" }), search: "" }).parent, false, "0 turns it off");
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
  assert.equal(D.cadenceN("2"), 2); assert.equal(D.cadenceN("3"), 3); assert.equal(D.cadenceN("5"), 5);
  assert.equal(D.resolveCadence("2"), "2:1"); assert.equal(D.resolveCadence("5"), "5:1"); assert.equal(D.resolveCadence(null), "3:1");
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

test("media: videos come from cleared CliniX manifest entries and play through the https shim", () => {
  assert.equal(M.shimUrl("gRWSyqatWQQ"), "https://stewardmd.in/_site/yt?v=gRWSyqatWQQ&autoplay=1");
  assert.equal(M.shimUrl("bad id"), null);
  const shimHtml = read("_site/yt.html"), media = read("prep-medigram-media.js"), feed = read("prep-medigram.js");
  assert.match(shimHtml, /auto \? "&autoplay=1"/, "the shim forwards autoplay to the official player");
  assert.match(shimHtml, /onAutoplayBlocked: muteAndPlay/, "a blocked autoplay retries muted instead of sitting paused");
  assert.match(media, /"autoplay; /, "the app frame delegates autoplay");
  assert.match(shimHtml, /e\.source !== window\.parent/, "the shim takes commands only from the app frame that embeds it");
  for (const c of ["play", "pause", "seek", "mute", "unmute"]) assert.match(shimHtml, new RegExp('d\\.smdCmd === "' + c + '"'), "shim handles " + c);
  assert.match(media, /postMessage\(\{ smdCmd: cmd, by: by \|\| 0 \}, "https:\/\/stewardmd\.in"\)/, "commands are posted to the shim origin only");
  assert.doesNotMatch(media, /youtube\.com\/watch|Browser\.open|Play on YouTube/, "the player never hands a video off to the YouTube app or site");
  assert.doesNotMatch(feed, /youtube\.com\/watch|Play on YouTube/, "the reel never hands a video off either (Browser.open there is for sharing to WhatsApp only)");
  const vids = M.videosFrom({ media: {
    a: { kind: "embed", embeddable: true, cleared: true, videoId: "gRWSyqatWQQ", title: "Resp exam", attribution: "Geeky Medics" },
    b: { kind: "embed", embeddable: false, cleared: true, videoId: "XU_xeUMJ3Zc" },
    c: { kind: "embed", embeddable: true, cleared: false, videoId: "XU_xeUMJ3Zc" },
    d: { kind: "embed", embeddable: true, cleared: true, videoId: "bad" },
    e: { kind: "embed", embeddable: true, cleared: true, videoId: "gRWSyqatWQQ" },
    f: { kind: "image", embeddable: true, cleared: true, videoId: "XU_xeUMJ3Zc" } } });
  assert.deepEqual(vids.map((v) => v.videoId), ["gRWSyqatWQQ"]);
  assert.equal(vids[0].by, "Geeky Medics");
  assert.deepEqual(M.videosFrom(null), []);
  // Every video PrepReels can show must be on the shim's allow-list, or the shim refuses it.
  const real = M.videosFrom(JSON.parse(read("clinix/media/manifest.json")));
  const shim = read("_site/yt.html");
  assert.ok(real.length >= 20, "the cleared video set is there");
  for (const v of real) assert.match(shim, new RegExp('"' + v.videoId.replace(/[-]/g, "\\-") + '": 1'), v.videoId + " on the shim allow-list");
});

test("official-channel videos: 100+, unique 11-char ids, all on the shim allow-list; placeholder gone", () => {
  const V = require("../prep-medigram-videos.js"), shim = read("_site/yt.html");
  assert.ok(V.length >= 100, "at least 100 videos, got " + V.length);
  const ids = new Set();
  for (const [id, title, by, subject] of V) {
    assert.match(id, /^[A-Za-z0-9_-]{11}$/);
    assert.ok(!ids.has(id), "unique " + id); ids.add(id);
    assert.ok(title && by && subject, "title, channel and subject for " + id);
    assert.ok(shim.includes('"' + id + '": 1'), id + " on the shim allow-list");
  }
  assert.doesNotMatch(read("prep-medigram.js") + read("prep-medigram-videos.js"), /dQw4w9WgXcQ/, "placeholder gone");
});

test("image systems: NEET-SS gets its specialty systems, every other exam any system", () => {
  assert.equal(D.imgSystemsFor("neet-pg", ["anatomy"]), null);
  assert.equal(D.imgSystemsFor("mrcp-part1", []), null);
  assert.equal(D.imgSystemsFor("usmle", []), null);
  assert.deepEqual(D.imgSystemsFor("neet-ss", ["ss-cardiology"]), ["cardiology"]);
  assert.deepEqual(D.imgSystemsFor("neet-ss", ["ss-paediatric-nephrology"]), ["paediatrics", "renal-and-urology"]);
  assert.deepEqual(D.imgSystemsFor("neet-ss", ["ss-surgical-gastroenterology"]), ["surgery", "gastroenterology"]);
  assert.deepEqual(D.imgSystemsFor("neet-ss", ["ss-ctvs", "ss-neurosurgery"]), ["surgery", "cardiology", "neurology"]);
  assert.ok(D.imgSystemsFor("neet-ss", ["ss-mixed"]).includes("medicine"), "unrecognised specialty falls back to the medical systems");
  const slugs = JSON.parse(read("kb/dist/imglib/index.json")).systems.map((x) => x.slug);
  const all = new Set();
  for (const id of ["ss-cardiology", "ss-neurology", "ss-nephrology", "ss-gastroenterology", "ss-endocrinology", "ss-haematology", "ss-medical-oncology", "ss-pulmonology", "ss-infectious-diseases", "ss-rheumatology-immunology", "ss-critical-care", "ss-neonatology", "ss-obg", "ss-radiology", "ss-head-neck-surgery", "ss-plastic-surgery", "ss-urology", "ss-onco-pathology", "ss-cardiac-anaesthesia", "ss-geriatric-mental-health", "ss-clinical-pharmacology", "ss-general-medicine"]) D.imgSystemsFor("neet-ss", [id]).forEach((x) => all.add(x));
  for (const x of all) assert.ok(slugs.includes(x), x + " is a real Image Library system");
});

test("mixFeed: every n questions one other card, pearls and extras alternate, pearls never come early", () => {
  const q = (id, kp) => ({ id, q: "Q" + id, o: ["a", "b"], a: 0, kp, _s: "s" });
  const items = [q(1, "P1"), q(2), q(3, "P3"), q(4), q(5), q(6)];
  const ex = [{ kind: "video", videoId: "v" }, { kind: "lesson", mid: "m" }];
  const out = D.mixFeed(items, ex, 3);
  assert.deepEqual(out.map((c) => c.kind), ["q", "q", "q", "pearl", "q", "q", "q", "video"]);
  assert.equal(out[3].text, "P1");
  assert.deepEqual(D.mixFeed(items, ex, 2).map((c) => c.kind), ["q", "q", "pearl", "q", "q", "video", "q", "q", "lesson"], "one pearl in three slots");
  assert.deepEqual(D.mixFeed([], ex, 3), []);
  assert.deepEqual(D.mixFeed(items, [], "5").map((c) => c.kind), ["q", "q", "q", "q", "q", "pearl", "q"]);
});

test("events: consent-aware, learning outcomes only, sensitive keys dropped", () => {
  assert.equal(D.buildEvent("mcq_answered", { correct: true }, { analytics: false }), null);
  assert.equal(D.buildEvent("video_view", {}, { analytics: true }), null);
  const e = D.buildEvent("mcq_answered", { correct: true, trackTitle: "secret", candidateId: "c1" }, { analytics: true }, 5);
  assert.deepEqual(e, { name: "mcq_answered", at: 5, data: { correct: true, candidateId: "c1" } });
});

test("wiring: loader fetches PrepReels only when on; prep.js hooks stay guarded; CSS contract", () => {
  const loader = read("prep-loader.js"), prep = read("prep.js"), css = read("prep-medigram.css");
  assert.match(loader, /MG_JS = \["prep-medigram-data\.js", "prep-medigram-media\.js", "prep-medigram-videos\.js", "prep-medigram\.js"\]/);
  assert.match(loader, /if \(mgOn\(\)\)/);
  assert.match(prep, /a\.indexOf\("mg-"\) === 0 && G\.PREP_MEDIGRAM/);
  assert.match(prep, /G\.PREP_MEDIGRAM \? G\.PREP_MEDIGRAM\.homeHtml\(HOST\)/);
  assert.match(css, /\.pn-mg-btn \{[^}]*min-height: 52px/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /#42cdb5/i);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient/);
  assert.equal((css.match(/(^|[^-])backdrop-filter:/g) || []).length, 1, "the only blur is the glass video controls");
  const ui = read("prep-medigram.js");
  assert.match(ui, /data-act="mg-done">Finish/);
  assert.doesNotMatch(ui, /data-act="mg-cadence"/);
  assert.match(ui, /host\.row\("mg-open", icon, "PrepReels", "Questions, videos and pearls, one swipe each"\)/);
  assert.match(ui, /class="pn-ri"/);
  assert.match(ui, /class="pn-rb"/);
  assert.match(ui, /ico\("play"\)/);
  assert.doesNotMatch(ui, /api\.youtube\.com|googleapis|youtube-nocookie/, "no YouTube API call and no direct embed from the app origin");
  assert.match(ui, /G\.fetch\("\/clinix\/media\/manifest\.json"\)/, "the only fetch is the bundled CliniX manifest");
});

test("home row: matches sibling rows with leading icon tile and trailing chevron", () => {
  const mockG = {
    PREP_MG_DATA: D,
    PREP_MG_MEDIA: M,
    localStorage: { getItem: () => null, setItem: () => {} },
    location: { search: "?medigram=1" }
  };
  const code = read("prep-medigram.js");
  new Function("window", code)(mockG);
  const mg = mockG.PREP_MEDIGRAM;
  assert.ok(mg, "PREP_MEDIGRAM registered");

  const mockHost = {
    row: (act, icon, title, sub, attrs) => `<button type="button" class="pn-row" data-act="${act}"${attrs || ""}><span class="pn-ri" aria-hidden="true">${icon}</span><span class="pn-rb"><b>${title}</b><small>${sub}</small></span><chev/></button>`,
    ico: (n) => `<ico-${n}/>`,
    esc: (s) => s
  };

  const html = mg.homeHtml(mockHost);
  assert.match(html, /class="pn-row"/);
  assert.match(html, /data-act="mg-open"/);
  assert.match(html, /class="pn-ri"[^>]*><ico-play\/>/);
  assert.match(html, /class="pn-rb"[^>]*><b>PrepReels<\/b><small>Questions, videos and pearls, one swipe each<\/small><\/span>/);
  assert.match(html, /<chev\/>/);

  // Standalone fallback without host also provides pn-ri, pn-rb, play icon and chevron
  const fallbackHtml = mg.homeHtml({});
  assert.match(fallbackHtml, /class="pn-row"/);
  assert.match(fallbackHtml, /data-act="mg-open"/);
  assert.match(fallbackHtml, /class="pn-ri"/);
  assert.match(fallbackHtml, /d="M7 5l12 7-12 7z"/, "play icon path");
  assert.match(fallbackHtml, /d="M9 6l6 6-6 6"/, "chevron icon path");
});
