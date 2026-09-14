/* test/wsq-no-emdash.test.mjs - the project forbids the em dash in app-facing text
 * (anything a user can see on screen, in print or export, or in an API error shown
 * to a user). Code comments are not app-facing and stay untouched; MaiK model output
 * is exempt.
 *
 * This test scans the WardSynQ client files for the four forms (the literal character,
 * &mdash;, the \u2014 escape, and &#8212;) after stripping comments, and scans the
 * functions files only inside string literals passed as message:, detail: or
 * diagnostics: values. A new em dash in any of those places fails here instead of
 * shipping unnoticed.
 *
 * Out of scope on purpose: timeline `label:` strings built in functions/_wardsynq
 * (migrate-inpatient.js timelineFromChart) keep their own wording and are covered by
 * test/wardsynq-timeline-story.test.mjs; CSS files other than ward.css are not part
 * of the WardSynQ surface this pass covers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The literal em dash below is written as an escape so this file's own source
// stays plain ASCII; at runtime it is the same character the scan looks for.
const FORMS = [
  { name: "literal", needle: "\u2014" },
  { name: "entity", needle: "&mdash;" },
  { name: "escape", needle: "\\u2014" },
  { name: "numeric", needle: "&#8212;" },
];

const SITE_DIR = join(ROOT, "wardsynq/site");
const PAGES_DIR = join(SITE_DIR, "pages");
const UI_DIR = join(ROOT, "wardsynq/ui");

function jsIn(dir, prefix) {
  return readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => prefix + f);
}

const CLIENT_FILES = [
  "ward.js",
  "ward.css",
  "portal.html",
  "clinic-billing.html",
  ...jsIn(SITE_DIR, "wardsynq/site/"),
  ...jsIn(PAGES_DIR, "wardsynq/site/pages/"),
  ...readdirSync(SITE_DIR).filter((f) => f.endsWith(".html")).map((f) => "wardsynq/site/" + f),
  ...jsIn(UI_DIR, "wardsynq/ui/"),
  ...readdirSync(UI_DIR).filter((f) => f.endsWith(".html")).map((f) => "wardsynq/ui/" + f),
];

const FUNCTIONS_DIR = join(ROOT, "functions/_wardsynq");
const FUNCTIONS_FILES = [
  ...readdirSync(FUNCTIONS_DIR).filter((f) => f.endsWith(".js")).map((f) => "functions/_wardsynq/" + f),
  "functions/api/queue/[[path]].js",
];

// Blank out /* ... */ and // ... comments (newlines kept, so line numbers in any
// failure message still point at the right place). A // is only a comment when it
// is not inside a '...' / "..." / `...` string and not part of a scheme:// URL.
// Known limits, documented so a future reader does not trust this blindly: a //
// inside a regex literal or inside a `...${...}` interpolation blanks the rest of
// the line (a missed hit, never a false hit), and stripping // in .html text can
// hide a dash that follows // on the same line.
function stripJsComments(text) {
  let out = "", i = 0;
  const n = text.length;
  let quote = null;
  while (i < n) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === "\\" && i + 1 < n) { out += text[i + 1]; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { quote = c; out += c; i++; continue; }
    if (c === "/" && text[i + 1] === "/") {
      if (text[i - 1] === ":") { out += c; i++; continue; } // scheme:// URL, not a comment
      while (i < n && text[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        out += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function stripForScan(text, isHtml) {
  let out = text;
  if (isHtml) {
    // HTML comments first: they can contain <script>-looking text that the JS
    // stripper must never see, and JS-looking text it must never scan.
    out = out.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
  }
  return stripJsComments(out);
}

function hitsInLine(line) {
  const found = [];
  for (const f of FORMS) {
    if (line.indexOf(f.needle) !== -1) found.push(f.name + " " + f.needle);
  }
  return found;
}

// Collect the raw source of every string literal in the value passed as
// message:/detail:/diagnostics:, tracking strings and bracket depth so a value
// that spans lines or wraps literals in calls/concatenation is still covered.
// A value with no literal (a constant, a function call on prebuilt text) has
// nothing to check here.
function keyedLiterals(text) {
  // Line-start offsets, computed once: lineOf() below is a binary search, so
  // collecting thousands of literals from a large router file stays linear.
  const starts = [0];
  for (let s = text.indexOf("\n"); s !== -1; s = text.indexOf("\n", s + 1)) starts.push(s + 1);
  const lineOf = (idx) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const found = [];
  const re = /(message|detail|diagnostics)\s*:/g;
  let m;
  while ((m = re.exec(text))) {
    let depth = 0, quote = null, lit = "", litLine = 0, i = re.lastIndex;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (quote) {
        lit += c;
        if (c === "\\" && j + 1 < text.length) { lit += text[j + 1]; j++; continue; }
        if (quote === "`" && c === "$" && text[j + 1] === "{") {
          // Skip the interpolation as balanced code; a dash hidden in there is
          // code or a nested literal the outer scan cannot judge, and nested
          // string literals inside are collected by their own pass below.
          lit += "{";
          let d = 1, sq = null;
          j += 2;
          for (; j < text.length && d > 0; j++) {
            const k = text[j];
            lit += k;
            if (sq) {
              if (k === "\\" && j + 1 < text.length) { lit += text[j + 1]; j++; continue; }
              if (k === sq) sq = null;
              continue;
            }
            if (k === "'" || k === '"' || k === "`") sq = k;
            else if (k === "{") d++;
            else if (k === "}") d--;
          }
          j--;
          continue;
        }
        if (c === quote) {
          found.push({ line: litLine, raw: lit });
          lit = "";
          quote = null;
        }
        continue;
      }
      if (c === "'" || c === '"' || c === "`") { quote = c; lit = c; litLine = lineOf(j); continue; }
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        if (depth === 0) break;
        depth--;
      } else if ((c === "," || c === ";") && depth === 0) break;
    }
  }
  return found;
}

test("no em dash in WardSynQ app-facing client text", () => {
  const violations = [];
  for (const rel of CLIENT_FILES) {
    if (!existsSync(join(ROOT, rel))) continue; // e.g. clinic-billing.html, "if present"
    const text = stripForScan(readFileSync(join(ROOT, rel), "utf8"), rel.endsWith(".html"));
    text.split("\n").forEach((line, i) => {
      for (const hit of hitsInLine(line)) {
        violations.push(rel + ":" + (i + 1) + " [" + hit + "] " + line.trim().slice(0, 160));
      }
    });
  }
  assert.deepEqual(violations, [], "em dash form(s) in app-facing client text - " +
    "rephrase with . / , / - per the plain-English rule, or move the dash into a comment:\n" +
    violations.join("\n"));
});

test("no em dash in functions message/detail/diagnostics strings", () => {
  const violations = [];
  for (const rel of FUNCTIONS_FILES) {
    const text = stripJsComments(readFileSync(join(ROOT, rel), "utf8"));
    for (const lit of keyedLiterals(text)) {
      for (const hit of hitsInLine(lit.raw)) {
        violations.push(rel + ":" + lit.line + " [" + hit + "] " + lit.raw.slice(0, 160));
      }
    }
  }
  assert.deepEqual(violations, [], "em dash form(s) in a user-visible message/detail/diagnostics " +
    "string - rephrase with . / , / - per the plain-English rule:\n" + violations.join("\n"));
});

test("the guard actually covers the in-scope files (no stale list)", () => {
  const missing = CLIENT_FILES.filter((rel) => !existsSync(join(ROOT, rel)) && rel !== "clinic-billing.html");
  assert.deepEqual(missing, [], "client files the guard expects but cannot find:\n" + missing.join("\n"));
  for (const rel of FUNCTIONS_FILES) {
    assert.ok(existsSync(join(ROOT, rel)), "functions file the guard expects but cannot find: " + rel);
  }
  assert.ok(CLIENT_FILES.indexOf("ward.js") !== -1, "ward.js must stay in the scanned set");
  assert.ok(FUNCTIONS_FILES.indexOf("functions/api/queue/[[path]].js") !== -1,
    "the queue router must stay in the scanned set");
});
