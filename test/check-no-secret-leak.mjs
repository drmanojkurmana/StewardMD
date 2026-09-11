/* test/check-no-secret-leak.mjs — TASK 8.10: prove the API key is nowhere it must not be.
 *
 * This scans for the LITERAL key value across everything git tracks, the working diff, the staged
 * diff, the recent commit messages and the evaluation artifacts, and reports only counts. It never
 * prints the key, never writes it, and exits non-zero if it finds it anywhere.
 *
 * It is a check, not a guarantee: it can only look for the key it was given, in the places named
 * below. A key that leaked into a file this does not scan, or into a process listing at the moment a
 * command ran, is outside what this can see - which is exactly why the adapter puts the credential
 * in a header and the runner redacts before writing anything.
 *
 *   node --env-file=$HOME/.stewardmd-secrets.env test/check-no-secret-leak.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const KEY = process.env.GEMINI_API_KEY || "";
if (!KEY) { console.log("GEMINI_API_KEY absent - nothing to scan for"); process.exit(2); }
if (KEY.length < 12) { console.log("refusing to scan for a suspiciously short key"); process.exit(2); }

const git = (...a) => { try { return execFileSync("git", a, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }); } catch { return ""; } };
let bad = 0;
const check = (label, text) => {
  const hit = String(text || "").includes(KEY);
  console.log(`${hit ? "LEAK  " : "clean "} ${label}`);
  if (hit) bad++;
};

// 1. Every tracked file's contents.
const tracked = git("ls-files").split("\n").filter(Boolean);
let trackedHits = 0;
for (const f of tracked) {
  try { if (readFileSync(f, "utf8").includes(KEY)) { console.log(`LEAK   tracked file: ${f}`); trackedHits++; } } catch { /* binary or unreadable */ }
}
console.log(`${trackedHits ? "LEAK  " : "clean "} ${tracked.length} tracked files`);
bad += trackedHits;

// 2. The diffs a commit or a PR would carry.
check("working-tree diff", git("diff"));
check("staged diff", git("diff", "--cached"));
check("last 20 commit messages", git("log", "-20", "--format=%B"));
check("last 20 commits' patches", git("log", "-20", "-p"));

// 3. The evaluation artifacts, tracked or not - results files are gitignored but still on disk.
const dir = "test/wardsynq-maik-eval";
if (existsSync(dir)) {
  for (const f of readdirSync(dir)) {
    try { check(`artifact ${f}`, readFileSync(join(dir, f), "utf8")); } catch { /* ignore */ }
  }
}

// 4. The key must also not be sitting in the repository's own ignore-listed config by accident.
for (const f of [".gitignore", ".env", ".dev.vars", "wrangler.toml"]) {
  if (existsSync(f)) { try { check(f, readFileSync(f, "utf8")); } catch { /* ignore */ } }
}

console.log(bad ? `\nFAIL: the key appears in ${bad} place(s) above` : "\nPASS: the key appears in nothing scanned");
process.exit(bad ? 1 : 0);
