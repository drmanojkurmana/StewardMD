/* Regression guard: MaiK's on-device KB init (StewardRAG.ready) MUST be bounded so a stalled
 * knowledge-base load (seen for LOGGED-IN sessions whose heavy startup starves the lazy KB
 * load — guests were unaffected) can't freeze MaiK to the 90s client watchdog. On stall it must
 * degrade to web research, not hang. See home.js runClinical submit chain. */
import { readFileSync } from "node:fs";
const home = readFileSync(new URL("../home.js", import.meta.url), "utf8");
let fails = 0;
function ok(c, m) { if (!c) { console.error("FAIL: " + m); fails++; } else console.log("ok: " + m); }

// ready() is raced against a timeout that resolves false (no unbounded await)
ok(/Promise\.race\(\[\s*StewardRAG\.ready\(\)\.then\(function \(\) \{ return true; \}, function \(\) \{ return false; \}\),\s*new Promise\(function \(res\) \{ setTimeout\(function \(\) \{ res\(false\); \}, 9000\); \}\)\s*\]\)/.test(home),
  "StewardRAG.ready() is bounded by a Promise.race timeout (resolves false on stall)");
// stalled/unavailable KB (null pkg) degrades to web research instead of calling explainGrounded with null
ok(/if \(!pkg\) \{[\s\S]*?maikRunWeb\(think, question\)[\s\S]*?return;\s*\}/.test(home),
  "null package (KB stalled) falls back to maikRunWeb (web research), not a hang");
console.log(fails === 0 ? "\nALL PASS — KB init is bounded; MaiK degrades instead of hanging" : `\n${fails} FAILED`);
process.exit(fails ? 1 : 0);
