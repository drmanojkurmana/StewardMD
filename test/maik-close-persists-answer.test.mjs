/* Regression guard: closing MaiK mid-generation must NOT lose the answer.
 *
 * Bug (31 Jul 2026): the in-flight answer was tied to the SHEET instance, not the conversation.
 *   - runClinical() rendered the answer into `think` (the "Searching…" bubble it captured at send).
 *   - close() then DELETED any bubble containing .maik-thinking before persisting the thread.
 * So if the user closed MaiK (or it was minimised) while the request was still running, the pending
 * bubble was stripped, the still-running generation rendered into a detached node nobody could see,
 * and on reopen the restored thread had no answer — it looked stuck on "Searching…" forever.
 * (User: "TO GET ANSWER I HAVE TO KEEP MAIK OPEN, MINIMIZING OR CLOSING MAIK NEVER GIVES ME ANSWER.")
 *
 * Fix: tag the pending bubble with a stable data-mg id and re-find it via _live() at completion time,
 * so the generation renders into whatever LIVE #maikBody is on screen (open, or restored after reopen)
 * and re-persists. close() now KEEPS the pending bubble (it carries data-mg) instead of deleting it. */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = readFileSync(join(ROOT, "home.js"), "utf8");
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("✅ " + m); pass++; };

// 1) the pending "Searching…" bubble is tagged with a per-request id
ok(/var think = bubble\("ai"/.test(home) && /think\.setAttribute\("data-mg", _gid\)/.test(home),
  "runClinical tags the pending bubble with a stable data-mg id");

// 2) _live() re-finds that tagged bubble in the CURRENT #maikBody (falls back to the captured node)
ok(/function _live\(\)\s*\{[^}]*getElementById\("maikBody"\)[^}]*querySelector\('\[data-mg="' \+ _gid \+ '"\]'\)[^}]*\|\| think/.test(home),
  "_live() resolves the tagged bubble in the on-screen #maikBody (open OR restored after reopen)");

// 3) both answer renders target the live bubble, never the captured `think`
//    (the only `maikRenderAnswer(think` allowed is the function DEFINITION, whose param is named think)
ok((home.match(/maikRenderAnswer\(think,/g) || []).length === (home.match(/function maikRenderAnswer\(think,/g) || []).length,
  "no maikRenderAnswer(think, …) CALL survives — answer always renders into _live()/_h");
ok((home.match(/maikRenderAnswer\(_live\(\)|maikRenderAnswer\(_h,/g) || []).length >= 2,
  "answer renders go through _live()/_h (the live host), not the sheet-captured bubble");

// 4) live streaming (onDelta) also paints the live bubble, so the typewriter continues after reopen
ok(/_live\(\)\.innerHTML = '<div class="maik-streaming">/.test(home),
  "onDelta streams into _live() so the reopened sheet keeps typing");

// 5) close() KEEPS the in-flight bubble (no more .maik-thinking strip) but still persists the thread
ok(!/querySelector\("\.maik-thinking"\)\) n\.remove\(\)/.test(home),
  "close() no longer deletes the in-flight thinking bubble (that discarded the answer)");
ok(/if \(body && body\.innerHTML\.trim\(\)\) \{[\s\S]*maikSaveThread\(_maikBodyHTML\);/.test(home),
  "close() still persists the current thread (bubble included) so it restores on reopen");

// 6) the completion persist reads the LIVE #maikBody and clears the pending tag
ok(/removeAttribute\("data-mg"\);\s*var _lb = document\.getElementById\("maikBody"\) \|\| body; _maikBodyHTML = _lb\.innerHTML; maikSaveThread/.test(home),
  "maikRenderAnswer persists from the live #maikBody and drops data-mg once the answer is in");

// 7) the 90s watchdog also targets the live bubble + persists (retry link survives a reopen)
ok(/var _tw = _live\(\);[\s\S]*_persist\(\);/.test(home),
  "the took-too-long watchdog renders into _live() and persists");

console.log(`\nALL ${pass} PASS — closing/minimising MaiK mid-request no longer loses the answer`);
