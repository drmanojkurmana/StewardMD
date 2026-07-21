/* Regression guard: native MaiK must ATTEMPT real streaming (feels like Gemini) via the pristine
 * WebView fetch, with a safe fallback — not unconditionally fetch the whole answer.
 *
 * Context (21 Jul 2026): native felt far slower than the Gemini app because it never streamed — the
 * app's window.fetch is the CapacitorHttp bridge, which BUFFERS SSE, so explainGroundedStream did
 * `if (SMD_IS_NATIVE) return fallback()` and waited for the entire answer before rendering anything.
 * Fix: stream via window.CapacitorWebFetch (the pristine WebView fetch, which CAN stream a cross-origin
 * SSE); require a CLEAN {done} completion on native so a dropped stream never surfaces a truncated
 * clinical answer (falls back to the proven whole-answer fetch); cache a native failure per session.
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

// the streaming fn no longer bails out unconditionally on native
ok(!/if \(window\.SMD_IS_NATIVE \|\| typeof ReadableStream/.test(rj), "native no longer unconditionally skips streaming");

// it streams through the pristine WebView fetch on native
ok(/window\.CapacitorWebFetch/.test(rj) && /var sfetch = isNative/.test(rj), "native streams via pristine window.CapacitorWebFetch");

// clean-completion safety: native only accepts a stream that signalled {done}
ok(/if \(ev && ev\.done\) \{ gotDone = true/.test(rj), "tracks the {done} completion event");
ok(/acc && \(gotDone \|\| !isNative\)/.test(rj), "native requires clean completion (gotDone) to use streamed text; else falls back");

// per-session failure cache so a broken native stream doesn't re-probe every query
ok(/function nsBad\(/.test(rj) && /smd_maik_nstream_bad/.test(rj), "caches a native stream failure for the session");

// warm-up on MaiK open (client KB + backend), fire-and-forget, no tokens
ok(/StewardRAG\.ready\(\)/.test(hj) && /\/api\/ai\/health/.test(hj), "MaiK-open warm-up primes KB + backend");

console.log(fails === 0 ? "\nALL PASS — native streams with a safe fallback + warm-up" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
