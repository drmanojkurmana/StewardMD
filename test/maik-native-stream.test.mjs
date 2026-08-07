/* Regression guard: MaiK streaming behaviour (design reversed after native-hang findings).
 *  - WEB live-streams the answer via SSE (explain?stream=1) so it types out like the Gemini app.
 *  - NATIVE deliberately does NOT live-stream: WKWebView BUFFERS SSE (no progressive tokens arrive) AND
 *    CapacitorWebFetch ignores the AbortController, so a stalled stream never fell back and hung to the
 *    90s watchdog ("MaiK took too long"). Native takes the bounded whole-answer path (explainGrounded).
 *  - Safety retained: require a clean {done} completion before using streamed text, else fall back to the
 *    proven whole-answer fetch; cache a native failure per session so it does not re-probe every query.
 *
 * Source-shape assertions (explainGroundedStream is deep provider code, not unit-extractable). */
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rj = fs.readFileSync(join(ROOT, "reasoning.js"), "utf8");
const hj = fs.readFileSync(join(ROOT, "home.js"), "utf8");
let fails = 0;
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

// WEB live-streams a real SSE (explain?stream=1) so the answer types out like Gemini
ok(/explain\?stream=1/.test(rj) && /text\/event-stream/.test(rj), "web live-streams the answer via SSE (explain?stream=1)");

// NATIVE deliberately does NOT live-stream (WKWebView buffers SSE + CapacitorWebFetch ignores the abort
// -> a stalled stream used to hang to the 90s watchdog); it takes the bounded whole-answer path instead.
ok(/if \(isNative\) return fallback\(\);/.test(rj), "native takes the bounded whole-answer path (no live SSE hang)");

// clean-completion safety: native only accepts a stream that signalled {done}
ok(/if \(ev && ev\.done\) \{ gotDone = true/.test(rj), "tracks the {done} completion event");
ok(/acc && \(gotDone \|\| !isNative\)/.test(rj), "native requires clean completion (gotDone) to use streamed text; else falls back");

// per-session failure cache so a broken native stream doesn't re-probe every query
ok(/function nsBad\(/.test(rj) && /smd_maik_nstream_bad/.test(rj), "caches a native stream failure for the session");

// warm-up on MaiK open (client KB + backend), fire-and-forget, no tokens
ok(/StewardRAG\.ready\(\)/.test(hj) && /\/api\/ai\/health/.test(hj), "MaiK-open warm-up primes KB + backend");

console.log(fails === 0 ? "\nALL PASS — native streams with a safe fallback + warm-up" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
