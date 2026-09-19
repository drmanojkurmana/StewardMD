/* test/opd-emr-scribe-offline.test.mjs — Item 13: offline structuring (worktree scribe-18).
 *
 * (a) doRefine's fallback decision: a cloud extract() failure that clearly means the network is
 *     unreachable (fetch/network/dns/timeout/...) retries once on-device; a deliberate refusal
 *     (quota / LOCAL_CAPABILITY_REQUIRED / kb-only / busy / low-memory / draft-unparsed / the LOCAL
 *     engine's OWN "...timed out" message) must never trigger it.
 * (b) the offline label: a draft produced on-device is visibly marked "Drafted on this phone"
 *     wherever the note itself renders, plain English, no jargon/em dash/emoji.
 * (c) the flag: smd_scribe_offline_draft, DEFAULT ON; "0" restores today's behaviour.
 *
 * Pure/source-level checks only — no DOM/network/timers, matching the style of
 * test/opd-emr-scribe-ux.test.mjs and test/voice-no-silent-failure.test.mjs (which already asserts
 * doRefine's other failure-reporting invariants by slicing the function's source).
 * node --test test/opd-emr-scribe-offline.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
function load(lsOverrides) {
  const win = {};
  const doc = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }), body: { appendChild() {} } };
  const ls = Object.assign({ getItem: () => null, setItem: () => {} }, lsOverrides || {});
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "" }, ls);
  win.localStorage = ls;   // the code reads G.localStorage (G === window), not the bare injected param
  win.SMD_AMBIENT = { start() {}, reduce() { return { updates: [] }; } };
  return win.OPDEMR;
}

// ---- (a) _isUnreachableError: which errors fall back, which must not ------------------------------
test("_isUnreachableError: true for messages that clearly mean the network is unreachable", () => {
  const OE = load();
  ["Failed to fetch", "TypeError: NetworkError when attempting to fetch resource.",
   "timeout", "The Internet connection appears to be offline.", "getaddrinfo ENOTFOUND stewardmd.in",
   "connect ECONNREFUSED", "ECONNRESET", "could not resolve host: stewardmd.in", "DNS lookup failed"
  ].forEach((msg) => assert.equal(OE._isUnreachableError(msg), true, msg));
});

test("_isUnreachableError: false for every deliberate refusal — never touch those branches", () => {
  const OE = load();
  ["quota", "LOCAL_CAPABILITY_REQUIRED", "kb-only", "busy", "already running",
   "not-enough-memory:100MB free, 2.5GB needed", "low-memory", "draft-unparsed", "server", ""
  ].forEach((msg) => assert.equal(OE._isUnreachableError(msg), false, msg));
});

test("_isUnreachableError: false for the LOCAL engine's own timeout — not a connectivity failure", () => {
  const OE = load();
  // Only reachable once the policy already routed to local; retrying local with more local work
  // (and mislabelling a slow model as 'no internet') would be wrong.
  assert.equal(OE._isUnreachableError("on-device generation timed out"), false);
});

test("_isUnreachableError: falsy/undefined input is not unreachable (no throw)", () => {
  const OE = load();
  assert.equal(OE._isUnreachableError(undefined), false);
  assert.equal(OE._isUnreachableError(null), false);
});

// ---- (c) smd_scribe_offline_draft: DEFAULT ON, "0" restores today's behaviour ---------------------
test("_scribeOfflineDraftOn: default ON with no localStorage key set", () => {
  const OE = load();
  assert.equal(OE._scribeOfflineDraftOn(), true);
});

test("_scribeOfflineDraftOn: '0' turns it off; any other value leaves it on", () => {
  const off = load({ getItem: (k) => (k === "smd_scribe_offline_draft" ? "0" : null) });
  assert.equal(off._scribeOfflineDraftOn(), false);
  const on1 = load({ getItem: (k) => (k === "smd_scribe_offline_draft" ? "1" : null) });
  assert.equal(on1._scribeOfflineDraftOn(), true);
});

// ---- (a) wiring: doRefine only falls back on a connectivity failure, gated on the flag -------------
test("doRefine: the resolved-error branch checks the flag AND the narrowed fallback rule (see opd-emr-scribe-refine.test.mjs)", () => {
  const refine = SRC.slice(SRC.indexOf("function doRefine"), SRC.indexOf("function applyScribeResult"));
  assert.match(refine, /_shouldOfflineFallback\(r && r\.error, \{ flagOn: scribeOfflineDraftOn\(\), isFinal: isFinal, offline: isOfflineNow\(\) \}\)/);
  assert.match(refine, /return offlineScribeFallback\(transcript, ticket, isFinal\);/);
});

test("doRefine: the promise-REJECTION handler is attached to the network call only, and still falls back", () => {
  const refine = SRC.slice(SRC.indexOf("function doRefine"), SRC.indexOf("function applyScribeResult"));
  // Second argument of .then(onResult, onNetworkFailure) - NOT a .catch chained after the success
  // handler, which would also swallow a throw out of applyScribeResult (see FIX 3).
  assert.ok(!/\)\.catch\(function/.test(refine), "no .catch after the success handler");
  const onReject = refine.slice(refine.indexOf("}, function (e) {"));
  assert.match(onReject, /_shouldOfflineFallback\(String\(\(e && e\.message\) \|\| "network"\)/);
  assert.match(onReject, /offlineScribeFallback\(transcript, ticket, isFinal\)/);
});

test("doRefine: the deliberate-refusal branches (quota / LOCAL_CAPABILITY_REQUIRED / kb-only) return before the fallback check ever runs", () => {
  const refine = SRC.slice(SRC.indexOf("function doRefine"), SRC.indexOf("function applyScribeResult"));
  const quotaIdx = refine.indexOf('r.error === "quota"');
  const capIdx = refine.indexOf('LOCAL_CAPABILITY_REQUIRED');
  const fallbackIdx = refine.indexOf("_shouldOfflineFallback(r && r.error");
  assert.ok(quotaIdx > -1 && capIdx > -1 && fallbackIdx > -1);
  assert.ok(quotaIdx < fallbackIdx && capIdx < fallbackIdx, "quota/LOCAL_CAPABILITY_REQUIRED are handled (and return) before the network check");
});

test("offlineScribeFallback: refuses cleanly (no throw) when no on-device model is available, and reports it", () => {
  const src = SRC.slice(SRC.indexOf("function offlineScribeFallback"), SRC.indexOf("function doRefine"));
  assert.match(src, /G\.SMD_MAIK_LOCAL && G\.SMD_MAIK_LOCAL\.available && G\.SMD_MAIK_LOCAL\.available\(\)/);
  assert.match(src, /No internet connection, and no on-device model is ready to draft here/);
});

test("offlineScribeFallback: a successful on-device draft is applied with offline:true (item 13b wiring)", () => {
  const src = SRC.slice(SRC.indexOf("function offlineScribeFallback"), SRC.indexOf("function doRefine"));
  // applyIfFresh is applyScribeResult behind the stale-result guard (FIX 1); offline = true.
  assert.match(src, /applyIfFresh\(ticket, r, transcript, true\)/);
  assert.match(SRC, /function applyIfFresh\(ticket, r, transcript, offline\) \{[\s\S]{0,200}applyScribeResult\(r, transcript, offline\);/);
});

test("applyScribeResult: passes the offline flag straight into _applyRefine's offlineDraft", () => {
  const fn = SRC.slice(SRC.indexOf("function applyScribeResult"), SRC.indexOf("  function startVoice"));
  assert.match(fn, /offlineDraft:\s*!!offline/);
});

test("_applyRefine: sets st.scribeOfflineDraft from result.offlineDraft on every refine (so it clears once cloud succeeds again)", () => {
  const fn = SRC.slice(SRC.indexOf("function _applyRefine"), SRC.indexOf("// ---- Item 14 review-panel actions"));
  assert.match(fn, /st\.scribeOfflineDraft = !!result\.offlineDraft;/);
});

// ---- (b) the offline label: visible wherever the note renders, plain English -----------------------
const NO_EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
const NO_EMDASH = /—/;
const base = {
  patient: { name: "Asha", mrn: "M1" }, tab: "assess", assessLoaded: true, assessLoading: false,
  assessVals: {}, assessTouched: {}, writeOn: true, source: "ghis", labs: [], radiology: [], medications: [],
  voiceOn: false, voicePaused: false, voiceProcessing: false,
  voiceTranscript: "fever three days", dictatedInv: []
};

test("offline draft: 'Drafted on this phone' is shown next to the note when scribeOfflineDraft is true", () => {
  const OE = load();
  const html = OE._render(Object.assign({}, base, { scribeOfflineDraft: true }));
  assert.match(html, /Drafted on this phone/);
  assert.equal(NO_EMOJI.test(html.match(/Drafted on this phone[^<]*/)[0]), false);
  assert.equal(NO_EMDASH.test(html.match(/<span class="oe-tag oe-review"[^>]*>Drafted on this phone<\/span>/)[0]), false);
});

test("offline draft: no label at all when scribeOfflineDraft is false/unset — a cloud draft is never mislabelled", () => {
  const OE = load();
  assert.equal(/Drafted on this phone/.test(OE._render(base)), false);
  assert.equal(/Drafted on this phone/.test(OE._render(Object.assign({}, base, { scribeOfflineDraft: false }))), false);
});

test("offline draft: the label also appears while still listening (live view), not only after Stop", () => {
  const OE = load();
  const html = OE._render(Object.assign({}, base, { scribeOfflineDraft: true, voiceOn: true, voiceStartedAt: 0, _now: 1000 }));
  assert.match(html, /Drafted on this phone/);
});

test("offline draft: freshState() starts with scribeOfflineDraft false (never mislabelled on a new consult)", () => {
  assert.match(SRC, /scribeOfflineDraft:\s*false/);
});
