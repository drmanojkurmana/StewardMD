/* test/opd-emr-scribe-refine.test.mjs — the six audit fixes on the OPD scribe refine path.
 *
 * These are BEHAVIOURAL: the module is loaded into a stub window/document and doRefine is actually
 * driven with a fake SMD_AI.extract, so the assertions are about what the code does, not how it reads.
 *
 *  FIX 1 - overlapping refines: a result older than the newest one already applied is DISCARDED.
 *  FIX 2 - a bare "timeout" on a working-but-slow connection never starts an on-device generation,
 *          and no background tick ever does; airplane mode on a doctor-initiated finish still does.
 *  FIX 3 - a throw out of applyScribeResult is reported as a bug, never routed to the local engine.
 *  FIX 4 - the consent store is capped; a patient with no ids gets one stable per-session key.
 *  FIX 5 - smd_scribe_review / smd_scribe_banner, DEFAULT ON, OFF restores the previous screen.
 *  FIX 6 - smd_scribe_live is read once per session (not every second); smd_scribe_feedback OFF also
 *          stops the st.scribeReview write.
 *
 * node --test test/opd-emr-scribe-refine.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");

// A DOM stub complete enough for paint() (root() -> createElement -> innerHTML = _render(st)).
function makeDoc() {
  const el = () => ({ id: "", classList: { add() {}, remove() {} }, querySelector: () => null,
    appendChild() {}, set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ""; },
    textContent: "", style: {} });
  return { getElementById: () => null, createElement: el, body: { appendChild() {} }, activeElement: null };
}

function load(opts) {
  opts = opts || {};
  const win = {};
  const store = Object.assign({}, opts.ls);
  const reads = [];
  const writes = [];
  const ls = {
    getItem(k) { reads.push(k); return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { writes.push([k, v]); store[k] = String(v); }
  };
  new Function("window", "document", "location", "localStorage", SRC)(win, makeDoc(), { search: "" }, ls);
  win.localStorage = ls;
  win.navigator = { onLine: opts.onLine !== false };
  win.SMD_AMBIENT = { start() {}, reduce() { return { updates: [] }; } };
  const toasts = [];
  win.toast = (m) => toasts.push(String(m));
  const logged = [];
  win.SMD_logError = (m, s) => logged.push(String(m));
  const localCalls = [];
  win.SMD_MAIK_LOCAL = {
    available: () => opts.localAvailable !== false,
    scribeFill(t) { localCalls.push(t); return Promise.resolve(opts.localResult || { emrFields: { cc: "on-device draft" } }); }
  };
  return { OE: win.OPDEMR, win, ls, store, reads, writes, toasts, logged, localCalls };
}

// extract() that resolves the queued results in call order; a result may be a promise.
function fakeExtract(results) {
  const calls = [];
  const fn = (text) => { calls.push(text); const r = results[calls.length - 1]; return Promise.resolve(r); };
  fn.calls = calls;
  return fn;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// ============ FIX 1: overlapping refines ==========================================================
test("FIX 1 (pure): _refineStale discards a ticket older than the newest applied, keeps the newest", () => {
  const { OE } = load();
  assert.equal(OE._refineStale(1, 2), true, "an older refine landing last is stale");
  assert.equal(OE._refineStale(2, 2), false, "re-applying the same ticket is not stale");
  assert.equal(OE._refineStale(3, 2), false, "a newer refine always applies");
  assert.equal(OE._refineStale(1, 0), false, "the very first refine applies");
});

test("FIX 1: the SLOW earlier refine cannot overwrite the newer one that already landed", async () => {
  const h = load();
  let releaseFirst;
  const first = new Promise((res) => { releaseFirst = res; });
  h.win.SMD_AI = { extract: fakeExtract([first, { emrFields: { cc: "NEWER" } }]) };

  const pA = h.OE._doRefine("fever", false);            // slow, still in flight
  const pB = h.OE._doRefine("fever and cough", false);  // fast, lands first
  await pB;
  assert.equal(h.OE._state().assessVals.Chief_complaints_duration, "NEWER");

  releaseFirst({ emrFields: { cc: "STALE" } });         // the older extract finally resolves
  await pA;
  assert.equal(h.OE._state().assessVals.Chief_complaints_duration, "NEWER",
    "a refine started EARLIER must never overwrite the draft a later one already applied");
});

test("FIX 1: a stale result cannot flip st.scribeOfflineDraft either", async () => {
  const h = load({ onLine: false });
  let releaseFirst;
  const first = new Promise((res) => { releaseFirst = res; });
  // The slow one fails with no network on a doctor-initiated finish -> it would draft on-device and
  // badge the note; by the time it lands, a newer cloud refine has already succeeded.
  h.win.SMD_AI = { extract: fakeExtract([first, { emrFields: { cc: "CLOUD" } }]) };
  const pA = h.OE._doRefine("fever", true);
  const pB = h.OE._doRefine("fever and cough", false);
  await pB;
  assert.equal(h.OE._state().scribeOfflineDraft, false);
  releaseFirst({ error: "Failed to fetch" });
  await pA;
  await tick();
  assert.equal(h.OE._state().scribeOfflineDraft, false, "a stale on-device draft must not badge the newer cloud note");
  assert.equal(h.OE._state().assessVals.Chief_complaints_duration, "CLOUD");
});

test("FIX 1: a doctor-initiated finish is NEVER dropped - it carries the newest ticket and applies", async () => {
  const h = load();
  let releaseBg;
  const bg = new Promise((res) => { releaseBg = res; });
  h.win.SMD_AI = { extract: fakeExtract([bg, { emrFields: { cc: "FINAL (Stop)" } }]) };
  const pBg = h.OE._doRefine("fever", false);
  releaseBg({ emrFields: { cc: "background" } });
  await pBg;
  assert.equal(h.OE._state().assessVals.Chief_complaints_duration, "background");
  await h.OE._doRefine("fever and cough", true);        // the doctor tapped Stop
  assert.equal(h.OE._state().assessVals.Chief_complaints_duration, "FINAL (Stop)");
});

// ============ FIX 2: a slow network must not start an on-device generation ========================
test("FIX 2 (pure): _shouldOfflineFallback - a bare timeout only falls back when the device is offline", () => {
  const { OE } = load();
  const on = (msg, o) => OE._shouldOfflineFallback(msg, Object.assign({ flagOn: true, isFinal: true, offline: false }, o));
  assert.equal(on("timeout"), false, "slow but working connection: never burn a local generation");
  assert.equal(on("timeout", { offline: true }), true, "airplane mode: a timeout IS no network");
  assert.equal(on("Failed to fetch"), true, "a named network error stands on its own");
  assert.equal(on("Failed to fetch", { isFinal: false }), false, "a background tick never falls back");
  assert.equal(on("Failed to fetch", { flagOn: false }), false, "flag off restores the old behaviour");
  assert.equal(on("on-device generation timed out"), false, "the LOCAL engine's own timeout is not connectivity");
  assert.equal(on("busy"), false);
  assert.equal(on("quota"), false);
  assert.equal(on(""), false);
});

test("FIX 2: a 45s timeout on a BACKGROUND tick does not touch the on-device engine", async () => {
  const h = load();                                   // navigator.onLine true
  h.win.SMD_AI = { extract: fakeExtract([{ error: "timeout" }]) };
  await h.OE._doRefine("fever", false);
  await tick();
  assert.deepEqual(h.localCalls, [], "a working-but-slow connection must not run llama.cpp every refine");
  assert.deepEqual(h.toasts, [], "and a background tick stays silent");
});

test("FIX 2: a 45s timeout on a doctor-initiated finish, still online, also does not run the local engine", async () => {
  const h = load();
  h.win.SMD_AI = { extract: fakeExtract([{ error: "timeout" }]) };
  await h.OE._doRefine("fever", true);
  await tick();
  assert.deepEqual(h.localCalls, []);
  assert.ok(h.toasts.length === 1 && /timeout/i.test(h.toasts[0]), "but the doctor is told why: " + h.toasts.join("|"));
});

test("FIX 2: a named network failure on a BACKGROUND tick does not run the local engine either", async () => {
  const h = load({ onLine: false });
  h.win.SMD_AI = { extract: fakeExtract([{ error: "Failed to fetch" }]) };
  await h.OE._doRefine("fever", false);
  await tick();
  assert.deepEqual(h.localCalls, [], "at most on a doctor-initiated finish, never on every tick");
});

test("FIX 2: airplane mode on Stop still drafts on-device AND badges it (the real offline case)", async () => {
  const h = load({ onLine: false });
  h.win.SMD_AI = { extract: fakeExtract([{ error: "Failed to fetch" }]) };
  await h.OE._doRefine("fever", true);
  await tick();
  assert.deepEqual(h.localCalls, ["fever"], "the on-device engine drafted the note");
  assert.equal(h.OE._state().assessVals.Chief_complaints_duration, "on-device draft");
  assert.equal(h.OE._state().scribeOfflineDraft, true, "and it is badged 'Drafted on this phone'");
  assert.ok(h.toasts.some((t) => /drafted on your phone/i.test(t)), h.toasts.join("|"));
});

test("FIX 2: airplane mode reported as a bare timeout (onLine false) still drafts on-device", async () => {
  const h = load({ onLine: false });
  h.win.SMD_AI = { extract: fakeExtract([{ error: "timeout" }]) };
  await h.OE._doRefine("fever", true);
  await tick();
  assert.deepEqual(h.localCalls, ["fever"]);
});

test("FIX 2: smd_scribe_offline_draft = '0' keeps the old behaviour (toast only, no local run)", async () => {
  const h = load({ onLine: false, ls: { smd_scribe_offline_draft: "0" } });
  h.win.SMD_AI = { extract: fakeExtract([{ error: "Failed to fetch" }]) };
  await h.OE._doRefine("fever", true);
  await tick();
  assert.deepEqual(h.localCalls, []);
  assert.ok(h.toasts.some((t) => /Could not draft the note/.test(t)), h.toasts.join("|"));
});

// ============ FIX 3: a client bug must not be laundered into "no internet" =======================
test("FIX 3: a throw inside applyScribeResult is REPORTED, and never starts an on-device generation", async () => {
  const h = load({ onLine: false });                   // offline too, to prove it is not the network path
  h.win.SMD_SCRIBEGROUND = { ground() { throw new Error("rx wiring bug"); } };
  h.win.SMD_AI = { extract: fakeExtract([{ emrFields: { cc: "fever" } }]) };
  await h.OE._doRefine("fever", true);
  await tick();
  assert.deepEqual(h.localCalls, [], "a code error is not a dropped connection");
  assert.equal(h.logged.length, 1, "the bug is logged where the owner can see it");
  assert.match(h.logged[0], /rx wiring bug/);
  assert.ok(h.toasts.some((t) => /Something went wrong while drafting the note/.test(t)), h.toasts.join("|"));
});

test("FIX 3: a throw on a BACKGROUND tick is still logged (silently - no mid-consult nag)", async () => {
  const h = load();
  h.win.SMD_SCRIBEGROUND = { ground() { throw new Error("boom"); } };
  h.win.SMD_AI = { extract: fakeExtract([{ emrFields: { cc: "fever" } }]) };
  await h.OE._doRefine("fever", false);
  await tick();
  assert.equal(h.logged.length, 1);
  assert.deepEqual(h.toasts, []);
  assert.deepEqual(h.localCalls, []);
});

test("FIX 3: the network REJECTION path still falls back (the catch did not stop covering it)", async () => {
  const h = load({ onLine: false });
  h.win.SMD_AI = { extract: () => Promise.reject(new Error("Failed to fetch")) };
  await h.OE._doRefine("fever", true);
  await tick();
  assert.deepEqual(h.localCalls, ["fever"]);
});

// ============ FIX 4: consent store cap + a key for a patient with no ids =========================
test("FIX 4 (pure): _consentReducer caps the store, keeping the NEWEST keys", () => {
  const { OE } = load();
  let s = {};
  for (let i = 0; i < 250; i++) s = OE._consentReducer(s, "v" + i, "grant");
  const keys = Object.keys(s);
  assert.equal(keys.length, OE._consentCap);
  assert.equal(OE._consentCap, 200);
  assert.equal(keys[keys.length - 1], "v249", "newest kept");
  assert.equal(OE._consentStatus(s, "v0"), "unknown", "oldest evicted");
  assert.equal(OE._consentStatus(s, "v249"), "granted");
});

test("FIX 4 (pure): the cap is explicit and re-deciding an existing visit does not grow the store", () => {
  const { OE } = load();
  let s = {};
  for (let i = 0; i < 5; i++) s = OE._consentReducer(s, "v" + i, "grant", 3);
  assert.deepEqual(Object.keys(s), ["v2", "v3", "v4"]);
  s = OE._consentReducer(s, "v3", "decline", 3);
  assert.deepEqual(Object.keys(s), ["v2", "v3", "v4"], "a re-decision is not a new key");
  assert.equal(OE._consentStatus(s, "v3"), "declined");
});

test("FIX 4: a patient with no episode/visit/ticket/mrn gets ONE stable key, and nothing identifying", () => {
  const { OE } = load();
  const st = OE._state();
  st.episodeId = ""; st.visitId = ""; st.ticketId = ""; st.patient = { name: "Asha Rao", mrn: "" };
  const k = OE._visitConsentKey();
  assert.ok(k, "no longer the empty string that made setConsent a no-op");
  assert.equal(OE._visitConsentKey(), k, "stable for the whole session");
  assert.ok(!/asha|rao/i.test(k), "no patient identifier is invented: " + k);
});

test("FIX 4: a clinic patient is asked for consent ONCE, not on every start", () => {
  const h = load();
  const st = h.OE._state();
  st.episodeId = ""; st.visitId = ""; st.ticketId = ""; st.patient = { name: "Asha", mrn: "" };
  let asks = 0;
  h.win.confirm = () => { asks++; return true; };
  let started = 0;
  h.OE._askScribeConsent(() => started++);
  h.OE._askScribeConsent(() => started++);
  h.OE._askScribeConsent(() => started++);
  assert.equal(asks, 1, "asked once for this session");
  assert.equal(started, 3, "and recording starts every time after that");
  const written = h.writes.filter((w) => w[0] === "smd_scribe_consent_visits");
  assert.equal(written.length, 1);
  assert.ok(!/asha/i.test(written[0][1]), "nothing identifying is written: " + written[0][1]);
});

test("FIX 4: a GHIS visit still keys on the visit, not the session key", () => {
  const { OE } = load();
  const st = OE._state();
  st.episodeId = "EP-42"; st.visitId = ""; st.ticketId = ""; st.patient = {};
  assert.equal(OE._visitConsentKey(), "EP-42");
});

// ============ FIX 5: the two new surfaces can be turned off =======================================
const renderBase = { patient: { name: "A", mrn: "1" }, labs: [], radiology: [], medications: [] };

test("FIX 5: smd_scribe_banner - DEFAULT ON, 'off' removes the recording banner entirely", () => {
  const on = load().OE;
  assert.equal(on._scribeBannerOn(), true);
  const stRec = Object.assign({}, renderBase, { tab: "profile", voiceOn: true, voicePaused: false, voiceStartedAt: 0, _now: 1000 });
  assert.match(on._render(stRec), /oe-rec-banner/);

  const off = load({ ls: { smd_scribe_banner: "off" } }).OE;
  assert.equal(off._scribeBannerOn(), false);
  const html = off._render(stRec);
  assert.ok(!/oe-rec-banner/.test(html));
  assert.ok(!/Recording this consultation/.test(html));
  assert.ok(!/oeRecTimer/.test(html), "and its timer node is gone with it");
});

test("FIX 5: smd_scribe_review - DEFAULT ON, 'off' removes the review panel entirely", () => {
  const stDone = Object.assign({}, renderBase, { tab: "assess", assessLoaded: true, writeOn: true, source: "ghis",
    assessVals: { Chief_complaints_duration: "fever" }, assessTouched: {}, scribeFilledFields: ["Chief_complaints_duration"],
    voiceOn: false, voiceProcessing: false, dictatedInv: [] });
  const on = load().OE;
  assert.equal(on._scribeReviewOn(), true);
  assert.match(on._render(stDone), /Review MaiK/);

  const off = load({ ls: { smd_scribe_review: "off" } }).OE;
  assert.equal(off._scribeReviewOn(), false);
  const html = off._render(stDone);
  assert.ok(!/Review MaiK/.test(html));
  assert.ok(!/scribe-review-accept/.test(html), "no review actions at all - the previous screen exactly");
});

test("FIX 5: the consent prompt is NOT weakened - smd_scribe_consent still gates it on its own", () => {
  const h = load();
  const st = h.OE._state();
  st.episodeId = "EP-9"; st.patient = {};
  let asks = 0;
  h.win.confirm = () => { asks++; return true; };
  h.OE._askScribeConsent(() => {});
  assert.equal(asks, 1, "review/banner flags do not touch consent");
  // ... and the consent flag itself still works as before
  const off = load({ ls: { smd_scribe_consent: "off" } });
  off.OE._state().episodeId = "EP-9";
  let asks2 = 0, started = 0;
  off.win.confirm = () => { asks2++; return true; };
  off.OE._askScribeConsent(() => started++);
  assert.equal(asks2, 0);
  assert.equal(started, 1);
});

// ============ FIX 6a: smd_scribe_live is read once per session, not every second ==================
test("FIX 6a: maybeIdleRefine reads a cached flag - tickElapsed calls it EVERY SECOND", () => {
  const fn = SRC.slice(SRC.indexOf("function maybeIdleRefine"), SRC.indexOf("function openIcdSearchForField"));
  assert.ok(fn.length > 0);
  assert.match(fn, /_liveOnSession/);
  assert.ok(!/scribeLiveOn\(\)/.test(fn), "a localStorage read per second for a whole consult is the bug");
});

test("FIX 6a: the flag is resolved once, in startVoice", () => {
  const start = SRC.slice(SRC.indexOf("function startVoice"), SRC.indexOf("function togglePauseVoice"));
  assert.match(start, /_liveOnSession = scribeLiveOn\(\)/);
  const tickFn = SRC.slice(SRC.indexOf("function tickElapsed"), SRC.indexOf("function maybeIdleRefine"));
  assert.match(tickFn, /maybeIdleRefine\(\)/, "tickElapsed still drives it - the cadence is unchanged");
});

// ============ FIX 6b: smd_scribe_feedback OFF also stops the review-state write ===================
test("FIX 6b: with smd_scribe_feedback off, editing a scribe-filled field writes NOTHING", () => {
  const h = load({ ls: { smd_scribe_feedback: "off" } });
  const st = h.OE._state();
  st.assessVals = {}; st.assessTouched = {}; st.scribeReview = {};
  st.scribeFilledFields = ["Chief_complaints_duration"];
  h.OE._setField("assess:Chief_complaints_duration", "fever, edited");
  assert.deepEqual(st.scribeReview, {}, "off means off: no st.scribeReview state change either");
  assert.deepEqual(h.writes.filter((w) => w[0] === "smd_scribe_feedback_log"), []);
  assert.equal(st.assessVals.Chief_complaints_duration, "fever, edited", "the edit itself still lands");
  assert.equal(st.assessTouched.Chief_complaints_duration, true);
});

test("FIX 6b: with the flag ON (default) the edited marker and the log entry still happen", () => {
  const h = load();
  const st = h.OE._state();
  st.assessVals = {}; st.assessTouched = {}; st.scribeReview = {};
  st.scribeFilledFields = ["Chief_complaints_duration"];
  h.OE._setField("assess:Chief_complaints_duration", "fever, edited");
  assert.equal(st.scribeReview.Chief_complaints_duration, "edited");
  assert.equal(h.writes.filter((w) => w[0] === "smd_scribe_feedback_log").length, 1);
});

test("FIX 6b: a field the scribe never filled costs no localStorage read at all", () => {
  const h = load();
  const st = h.OE._state();
  st.assessVals = {}; st.assessTouched = {}; st.scribeFilledFields = [];
  h.reads.length = 0;
  h.OE._setField("assess:History_present_illness", "typing");
  assert.deepEqual(h.reads, [], "the flag check is last in the chain, so typing never reads localStorage");
});
