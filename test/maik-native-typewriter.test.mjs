/* Regression guard: native MaiK reveals the answer word-by-word (ChatGPT-style typewriter).
 *
 * History: #533 tried live SSE streaming on native via CapacitorWebFetch; #562 disabled native
 * streaming entirely (`!window.SMD_IS_NATIVE`) because CapacitorWebFetch ignores AbortController → 90s
 * hang, and WKWebView buffers SSE so no tokens arrive during generation anyway. That left native
 * dumping the whole answer at once. Fix (31 Jul): native routes through explainGroundedStream, which on
 * native skips the (hanging) live SSE and returns fallback() = bounded explainGrounded + replay(), so
 * the answer TYPES OUT via onDelta. Web keeps true token streaming. */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = readFileSync(join(ROOT, "home.js"), "utf8");
const rj = readFileSync(join(ROOT, "reasoning.js"), "utf8");
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("✅ " + m); pass++; };

// native is no longer excluded from the streaming (onDelta) path
ok(/var call = \(window\.SMD_AI\.explainGroundedStream && maikStreamOn\(\)\)/.test(home)
  && !/explainGroundedStream && maikStreamOn\(\) && !window\.SMD_IS_NATIVE/.test(home),
  "home.js: native uses the explainGroundedStream (onDelta) path — no !SMD_IS_NATIVE exclusion");

// on native, explainGroundedStream skips the live SSE (hang) and uses the bounded whole-fetch + typewriter
ok(/if \(isNative\) return fallback\(\);/.test(rj), "reasoning.js: native short-circuits to fallback() (no live SSE = no hang)");
ok(/function fallback\(\) \{ return Promise\.resolve\(self\.explainGrounded\(pkg, opts\)\)\.then\(replay\); \}/.test(rj),
  "fallback = bounded explainGrounded + replay (types the answer out)");
ok(/function replay\(res\)/.test(rj) && /onDelta\(full\.slice\(0, i\)\)/.test(rj), "replay reveals the text progressively via onDelta");

console.log(`\nALL ${pass} PASS — native types the answer out (ChatGPT-style), web still token-streams`);
