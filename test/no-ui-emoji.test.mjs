/* Guard for the app-wide "replace UI emoji with custom line-icons" sweep
 * (spec: docs/superpowers/specs/2026-07-19-emoji-to-icons-design.md).
 *
 * P0 (foundation): assert the shared window.ICONS catalog in home.js contains every icon the
 * sweep will reference (specialty + UI), and that each entry is real SVG markup (no emoji leaked
 * into the catalog). Later phases append their cleaned files to COVERED, and the emoji scanner
 * below fails if any UI-chrome emoji remains in — or is newly introduced into — a covered file.
 *
 * USAGE: node test/no-ui-emoji.test.mjs (also under `npm test`). */
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0;
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

// ---- parse the ICON map out of home.js ----
const home = fs.readFileSync(join(ROOT, "home.js"), "utf8");
const a = home.indexOf("var ICON = {");
const b = home.indexOf("\n  };", a);
ok(a >= 0 && b > a, "found the ICON map in home.js");
const ICON = Function("return " + home.slice(a + "var ICON = ".length, b + 4))();

// ---- catalog completeness: every icon the sweep needs must exist ----
const REQUIRED = [
  // specialty (calculators / knowledge-library categories)
  "heart", "siren", "microbe", "kidney", "liver", "brain", "lungs", "endocrine", "stomach",
  "droplet", "ribbon", "joint", "bone", "skin", "psych", "baby", "pregnant", "eye", "skull", "scales",
  // UI chrome
  "search", "folder", "clock", "book", "camera", "hospital", "edit", "trash", "check", "close",
  "plus", "list", "warn", "share", "save", "upload", "mic", "cloud", "note", "aware",
  "syndromes", "antibiogram", "pills", "flask", "calc", "user", "bell", "settings", "info",
  "home", "arrow", "chev",
];
const missing = REQUIRED.filter((n) => !ICON[n]);
ok(missing.length === 0, "catalog has every required icon" + (missing.length ? " — MISSING: " + missing.join(", ") : ""));

// ---- each catalog entry is real SVG markup, no emoji leaked in ----
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE0F}\u{20E3}]/u;
let badSvg = 0, emojiInCatalog = 0;
for (const [name, v] of Object.entries(ICON)) {
  if (!/<(path|circle|rect|line|polyline|polygon|ellipse)/.test(String(v))) badSvg++;
  if (EMOJI.test(String(v))) emojiInCatalog++;
}
ok(badSvg === 0, "every ICON entry is SVG markup (" + Object.keys(ICON).length + " icons)");
ok(emojiInCatalog === 0, "no emoji leaked into the ICON catalog");

// ---- emoji scanner for covered files (grows each phase) ----
// A curated UI-chrome emoji blocklist. Lines with `console.`, comment lines, and regions wrapped in
// /* @emoji-data-ok */ … /* @end-emoji-data-ok */ (legitimate clinical-data/content) are skipped.
// True emoji / pictographs. Deliberately EXCLUDES ordinary typography still used as UI:
// geometric shapes (▸ ▾ U+25xx chevrons), angle quotes (‹ U+2039), arrows (← → ↗ U+2190-21FF),
// General Punctuation (— … ' "). Covers Misc-Symbols+Dingbats (2600-27BF: ❤ ✅ ✍ ☠ ⚖ ⚡ ✔),
// Misc-Technical (2300-23FF: ⏱ ⌚), Supplemental symbols (2B00-2BFF), and pictographs (1F300-1FAFF).
const BLOCKLIST = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}\u{200D}]/u;
function scanFile(rel) {
  const src = fs.readFileSync(join(ROOT, rel), "utf8");
  const lines = src.split("\n");
  const hits = [];
  let dataOk = false;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/@emoji-ok\b/.test(ln)) continue;                                        // single-line exception (clinical content)
    if (/@emoji-data-ok/.test(ln)) dataOk = true;
    if (/@end-emoji-data-ok/.test(ln)) { dataOk = false; continue; }
    if (dataOk) continue;
    const t = ln.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue; // comment
    if (/console\./.test(ln)) continue;                                          // debug log
    if (BLOCKLIST.test(ln)) hits.push((i + 1) + ": " + t.slice(0, 80));
  }
  return hits;
}

// COVERED grows as each phase cleans a file.
const COVERED = ["calculators.js", "medlist.js", "drugs.js", "prescription.js", "abx-wizard.js", "recent.js"];
for (const rel of COVERED) {
  const hits = scanFile(rel);
  ok(hits.length === 0, "no UI emoji in " + rel + (hits.length ? "\n   " + hits.join("\n   ") : ""));
}

console.log(fails === 0 ? "\nALL PASS — icon catalog ready for the sweep" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
