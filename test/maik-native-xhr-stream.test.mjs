/* test/maik-native-xhr-stream.test.mjs — native MaiK streams over XHR, and can never cost 26 seconds.
 *
 * WHAT WENT WRONG (measured on an iPhone 15 Pro, 2026-08-24):
 *   Live streaming was enabled and the app got SLOWER: 26.6s for an answer that takes ~11s with no
 *   streaming at all. Cause: the pristine fetch stream does not stream in WKWebView (body arrives
 *   buffered, no delta lands), AND CapacitorWebFetch ignores AbortController — so the 6s first-token
 *   watchdog could not abort it. The request sat until the 25s hard deadline, then refetched the
 *   whole answer. Streaming made the product strictly worse.
 *
 * THE FIX: native uses the PRISTINE XHR. responseText grows across onprogress (WebKit streams it),
 * and xhr.abort() genuinely aborts, so a dead stream costs one short watchdog instead of 25s.
 *
 * The parsing test below extracts the REAL feed() from reasoning.js and drives it, so it exercises
 * the shipped code rather than a copy of it.
 *
 * node --test test/maik-native-xhr-stream.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RJ = readFileSync(new URL("../reasoning.js", import.meta.url), "utf8");

/* Pull the real feed() out of the native block by brace-matching. */
function extractFn(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `could not find ${signature} — the native stream path changed shape`);
  let depth = 0, i = src.indexOf("{", start);
  const open = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error("unbalanced braces extracting " + signature);
}

function harness() {
  const feedSrc = extractFn(RJ, "function feed(chunk) {");
  const deltas = [];
  const make = new Function("record", `
    var nbuf = "", acc = "", sawDone = false;
    var NX_FIRST = 4000, NX_STALL = 8000;
    var onDelta = function (t) { record(t); };
    function armx() {}
    ${feedSrc}
    return { feed: feed, state: function () { return { acc: acc, sawDone: sawDone, nbuf: nbuf }; } };
  `);
  const h = make((t) => deltas.push(t));
  return { ...h, deltas };
}

const frame = (obj) => "data: " + JSON.stringify(obj);
const delta = (t) => frame({ delta: t });

test("real feed(): CRLF-framed deltas are parsed and surfaced progressively", () => {
  const h = harness();
  h.feed(delta("Give ") + "\r\n\r\n" + delta("oxygen.") + "\r\n\r\n" + frame({ done: true }) + "\r\n\r\n");
  assert.equal(h.state().acc, "Give oxygen.");
  assert.equal(h.state().sawDone, true);
  assert.deepEqual(h.deltas, ["Give ", "Give oxygen."], "onDelta receives the ACCUMULATED answer each time");
});

test("real feed(): LF framing works too", () => {
  const h = harness();
  h.feed(delta("A") + "\n\n" + delta("B") + "\n\n" + frame({ done: true }) + "\n\n");
  assert.equal(h.state().acc, "AB");
  assert.equal(h.state().sawDone, true);
});

test("real feed(): a frame split across arbitrary chunk boundaries is never lost or duplicated", () => {
  const wire = delta("Ceftriaxone ") + "\r\n\r\n" + delta("2g OD.") + "\r\n\r\n" + frame({ done: true }) + "\r\n\r\n";
  for (const size of [1, 3, 7, 64]) {
    const h = harness();
    for (let i = 0; i < wire.length; i += size) h.feed(wire.slice(i, i + size));
    assert.equal(h.state().acc, "Ceftriaxone 2g OD.", `chunk size ${size}`);
    assert.equal(h.state().sawDone, true, `chunk size ${size} saw done`);
  }
});

test("real feed(): malformed frames contribute nothing and never throw", () => {
  const h = harness();
  h.feed("data: {not json\r\n\r\n: comment\r\n\r\n" + delta("ok") + "\r\n\r\n");
  assert.equal(h.state().acc, "ok");
});

test("real feed(): a partial trailing frame is buffered, not emitted", () => {
  const h = harness();
  h.feed(delta("full") + "\r\n\r\n" + delta("part"));
  assert.equal(h.state().acc, "full");
  assert.match(h.state().nbuf, /part/, "incomplete tail is carried to the next chunk");
});

/* ---------------------------------------------------------------- transport invariants */

test("native uses the PRISTINE XHR, not fetch and not the patched global", () => {
  assert.match(RJ, /CapacitorWebXMLHttpRequest && window\.CapacitorWebXMLHttpRequest\.fullObject/,
    "CapacitorHttp patches the global XHR to buffer — the pristine one must be preferred");
  assert.match(RJ, /xhr\.onprogress = function \(\) \{ drain\(\); \}/,
    "progressive responseText is the whole point of using XHR here");
});

test("a STALLED stream aborts for real — the 26.6s hang must be impossible", () => {
  const onStall = extractFn(RJ, "function onStall() {");
  assert.match(onStall, /xhr\.abort\(\)/, "XHR abort actually works, unlike CapacitorWebFetch + AbortController");
  assert.match(onStall, /settle\(fallback\(\)\)/, "text-then-silence is a broken stream: take the proven fetch");
});

test("a merely SLOW stream is hedged, never killed — this is what made the app fall back every time", () => {
  // Budget was 4000ms while the real first delta lands at 3.6-5.0s, so the watchdog aborted streams
  // that were about to work and the app showed "answer 9.2s" (fallback) instead of "grounded-stream".
  const onSilent = extractFn(RJ, "function onSilent() {");
  assert.match(onSilent, /startHedge\(\)/, "no first token yet => hedge, do not abort");
  const beforeHardStop = onSilent.split("hardT = setTimeout")[0];
  assert.doesNotMatch(beforeHardStop, /xhr\.abort\(\)/,
    "a stream that has simply not started yet must be left alive — it may still deliver");
  const hedge = extractFn(RJ, "function startHedge() {");
  assert.match(hedge, /if \(!acc\)/,
    "the hedged fetch may only win while the stream has produced NOTHING — never overwrite streamed text");
});

test("the native budgets are explicit and bounded", () => {
  const m = RJ.match(/NX_FIRST = (\d+), NX_STALL = (\d+), NX_HARD = (\d+)/);
  assert.ok(m, "the native budgets must be explicit");
  assert.ok(Number(m[1]) >= 3000, `first budget ${m[1]}ms — below the measured first-delta range it would hedge on every call`);
  assert.ok(Number(m[2]) <= 10000, `stall budget ${m[2]}ms must stay small`);
  assert.ok(Number(m[3]) <= 20000, `hard stop ${m[3]}ms must remain a real floor — nothing may hang`);
});

test("SAFETY: only a cleanly completed stream may surface as the answer", () => {
  assert.match(RJ, /if \(acc && sawDone\) \{ nsBad\(false\); settle\(\{ text: acc, mode: "grounded-stream"/,
    "a truncated clinical answer must never be shown as a whole one");
});

test("a device where XHR does not stream pays the probe once, not once per question", () => {
  assert.match(RJ, /if \(nsBad\(\)\) return fallback\(\);/, "the 3-minute cooldown gates the native attempt");
});
