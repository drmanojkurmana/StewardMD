/* test/research-web-fallback.test.mjs — the "Research on the web" endpoint, source-level.
 *
 * Owner (2026-09-04): "remove gemini fallback" and let the on-device model do the free snippet
 * conversion for anything but MaiK Cloud. Two things must hold in functions/api/ai/[[path]].js:
 *   1. A TinyFish miss is now an honest "no results" - NOT a second, slower, costlier call to
 *      Gemini's own google_search grounding (the removed `webSearch: true` fallback).
 *   2. A `snippetsOnly` request returns TinyFish's raw sources and makes NO Gemini call at all, so
 *      the on-device model can write the answer for free (maik-local.js webAnswer).
 * The server is a Cloudflare Pages function with runtime-only imports (KV, secrets), so - same
 * convention as maik-cloud-scope.test.mjs - this is a source-level regression test: the bug this
 * guards against is "somebody re-adds the fallback" or "the free path starts calling callGemini",
 * both of which are regressions in the SOURCE, not something that needs a live request to see.
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const SRC = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");

// Isolate the research handler body: from `if (seg === "research")` to the matching `if (seg ===
// "summary")` that follows it, so assertions can't accidentally match an unrelated branch.
const m = SRC.match(/if \(seg === "research"\) \{[\s\S]*?\n    if \(seg === "summary"\) \{/);
ok("the research handler was found in source", !!m);
const body = m ? m[0] : "";

ok("the Gemini-grounded fallback (webSearch: true) is gone", !/webSearch:\s*true/.test(body));
ok("the fallback's mode label is gone too", !/web-grounded/.test(body));
ok("a TinyFish miss returns an honest no-results, not a second AI call", /if \(!results\.length\) return json\(\{ text: null, mode: "web", sources: \[\] \}\);/.test(body));

// This handler ALSO contains Evidence Review, a separate, always-cloud sub-branch with its own
// checkQuota/callGemini calls - so the plain-web section is isolated by slicing from snippetsOnly
// (only in the plain-web branch) onward, and every ordering/count check below is scoped to that.
const snipIdx = body.indexOf("body.snippetsOnly");
ok("snippetsOnly is present in the plain-web branch", snipIdx >= 0);
const plainWeb = body.slice(snipIdx);
const quotaIdx = plainWeb.indexOf('checkQuota(env, request, "general")');
ok("snippetsOnly is handled BEFORE the quota gate (it must cost nothing)", quotaIdx > 0);
{
  const snip = plainWeb.slice(0, quotaIdx);
  ok("the snippetsOnly branch never calls Gemini", !/callGemini/.test(snip));
  ok("the snippetsOnly branch returns tinyfishSearch's own fields (including the raw snippet)", /snippet: r\.snippet/.test(snip));
}
ok("the plain-web (cloud) path calls Gemini exactly once, Evidence Review's own call is untouched",
   (plainWeb.match(/callGemini/g) || []).length === 1 && (body.match(/callGemini/g) || []).length === 2);
ok("RESEARCH_SYS_SNIPPETS is still the writer prompt for the cloud path", /RESEARCH_SYS_SNIPPETS \+ "\\n\\nQuestion: "/.test(body));
ok("the dead RESEARCH_SYS constant (only the removed fallback used it) is gone", !/const RESEARCH_SYS =/.test(SRC));

console.log(`research-web-fallback: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
