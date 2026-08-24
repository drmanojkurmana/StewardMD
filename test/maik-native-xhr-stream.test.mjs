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

test("giving up aborts for real, then takes the proven fetch — the 26.6s hang must be impossible", () => {
  const giveUp = extractFn(RJ, "function giveUp() {");
  assert.match(giveUp, /xhr\.abort\(\)/, "XHR abort actually works, unlike CapacitorWebFetch + AbortController");
  assert.match(giveUp, /settle\(fallback\(\)\)/, "one deterministic ending: the proven whole-answer fetch");
});

test("SINGLE FLIGHT: no hedged or competing second request", () => {
  // The hedge started a second request on a slow first token — non-deterministic (two answers racing
  // for one bubble) and double spend on exactly the slow calls. The server now bounds every stream,
  // so the client is strictly one request at a time.
  assert.doesNotMatch(RJ, /function startHedge\(\)/, "the hedge must be gone");
  assert.doesNotMatch(RJ, /hedged = true/, "no hedge state may remain");
});

test("a transport-level total bound exists — no JS timer can catch every dead socket", () => {
  assert.match(RJ, /xhr\.timeout = NX_TOTAL/, "XHR's own timeout is the backstop against a 196s hang");
  assert.match(RJ, /xhr\.ontimeout = function \(\) \{ nsBad\(true\); settle\(fallback\(\)\); \}/,
    "a timed-out request must settle deterministically");
});

test("client budgets sit OUTSIDE the server's, so the server's clean close wins", () => {
  const m = RJ.match(/NX_FIRST = (\d+), NX_STALL = (\d+), NX_TOTAL = (\d+)/);
  assert.ok(m, "the native budgets must be explicit");
  const [, first, stall, total] = m.map(Number);
  assert.ok(first >= 8000, `first-token backstop ${first}ms must clear the measured p95 (5.2s) and the server's 10s connect bound`);
  assert.ok(stall > 12000, `client stall ${stall}ms must exceed the server's 12s idle bound — a clean close keeps the text, a client abort discards it`);
  assert.ok(total <= 35000, `total ${total}ms must stay a real bound for a waiting clinician`);
});

test("SAFETY: a server-stalled stream is never shown as a complete clinical answer", () => {
  // The server now always closes with a done event, including when it hit its own idle/total deadline.
  // Accepting that text because "done arrived" would present a truncated answer as whole.
  assert.match(RJ, /if \(ev\.stalled\) sawStalled = true;/, "the stalled flag must be read");
  assert.match(RJ, /if \(acc && sawDone && !sawStalled\)/, "a stalled stream must fall back, never surface");
});

test("SAFETY: only a cleanly completed stream may surface as the answer", () => {
  // Tightened once the server gained deadlines: a done event can now also mean "the server gave up",
  // so completion requires done AND not-stalled.
  assert.match(RJ, /if \(acc && sawDone && !sawStalled\) \{ nsBad\(false\); settle\(\{ text: acc, mode: "grounded-stream"/,
    "a truncated clinical answer must never be shown as a whole one");
});

test("a device where XHR does not stream pays the probe once, not once per question", () => {
  assert.match(RJ, /if \(nsBad\(\)\) return fallback\(\);/, "the 3-minute cooldown gates the native attempt");
});
