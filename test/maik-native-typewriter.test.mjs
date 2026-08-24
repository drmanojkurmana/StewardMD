/* Regression guard: native MaiK reveals the answer progressively, and can never hang.
 *
 * HISTORY
 *  #533 tried live SSE streaming on native via CapacitorWebFetch.
 *  #562 disabled native streaming entirely because CapacitorWebFetch ignores AbortController -> 90s
 *       hang, and the answer arrived in one lump.
 *  31 Jul: native routed through explainGroundedStream, which SHORT-CIRCUITED to
 *       fallback() = explainGrounded + replay(), so the answer typed out after the fetch.
 *  24 Aug: that short-circuit was removed. Measured on production, the app waited 6-10s showing
 *       nothing and then animated text it already had - "fake streaming". Native now attempts the
 *       REAL upstream SSE over the pristine CapacitorWebFetch (window.fetch on native is the
 *       CapacitorHttp bridge, which buffers), and the #562 hang is prevented WITHOUT relying on
 *       abort: a hard deadline races the attempt and settles with the proven whole-answer fetch.
 *
 * This file was rewritten that day. It previously asserted `if (isNative) return fallback();` and the
 * exact old one-line fallback() - both of which describe a design that was deliberately replaced. The
 * INVARIANTS it exists to protect are unchanged and asserted below: native is on the onDelta path,
 * the answer is revealed progressively, and native can never hang waiting on a stream.
 *
 * (One assertion here had been failing before that change too: it pinned `onDelta(full.slice(0, i))`,
 * a character-paced replay that had already been replaced by a word-paced one.)
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = readFileSync(join(ROOT, "home.js"), "utf8");
const rj = readFileSync(join(ROOT, "reasoning.js"), "utf8");
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("✅ " + m); pass++; };

// native is not excluded from the streaming (onDelta) path
ok(/var call = \(window\.SMD_AI\.explainGroundedStream && maikStreamOn\(\)\)/.test(home)
  && !/explainGroundedStream && maikStreamOn\(\) && !window\.SMD_IS_NATIVE/.test(home),
  "home.js: native uses the explainGroundedStream (onDelta) path — no !SMD_IS_NATIVE exclusion");

// native now ATTEMPTS the real upstream stream instead of short-circuiting past it
ok(!/^\s*if \(isNative\) return fallback\(\);\s*$/m.test(rj),
  "reasoning.js: the blanket native short-circuit is gone (real streaming is attempted)");
ok(/sfetch = isNative \? pristine/.test(rj) && /CapacitorWebFetch/.test(rj),
  "native streams over the pristine WebView fetch, not the buffering CapacitorHttp bridge");

// ...and the #562 hang is still impossible, by a mechanism that does not trust abort
ok(/Promise\.race\(\[attempt, hardDeadline\]\)/.test(rj),
  "a hard deadline races the attempt — a stalled stream can never hang the answer");
ok(/HARD_MS = isNative \? \d+/.test(rj), "the native deadline is explicit");
ok(/res\(fallback\(\)\)/.test(rj),
  "on deadline it settles with the proven whole-answer fetch, not a partial stream");

// the fallback still types the answer out, so a non-streaming path is never a silent lump
ok(/function fallback\(\)/.test(rj) && /self\.explainGrounded\(pkg, opts\)/.test(rj) && /replay\(res, Date\.now\(\) - t0\)/.test(rj),
  "fallback = bounded explainGrounded + replay, timed so the reveal is budgeted against the wait");
ok(/function replay\(res, waitedMs\)/.test(rj) && /onDelta\(acc\)/.test(rj),
  "replay reveals the text progressively via onDelta");
ok(/frames = w > 6000 \? 30/.test(rj),
  "after a long wait the reveal is near-instant — the answer is already in hand");

// native must only accept a streamed answer that completed cleanly
ok(/if \(acc && \(gotDone \|\| !isNative\)\)/.test(rj),
  "native accepts streamed text only on clean completion — never a truncated clinical answer");

console.log(`\nALL ${pass} PASS — native streams for real, falls back safely, and cannot hang`);
