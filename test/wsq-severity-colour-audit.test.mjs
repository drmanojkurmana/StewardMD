/* test/wsq-severity-colour-audit.test.mjs — P2.16: "Avoid visual decoration that competes with
 * clinical severity. Reserve strong colour for meaningful clinical states."
 *
 * Scans the WardSynQ ward frontend (ward.js, the site shell, the admin/ops pages, and the ward
 * design-system CSS) for raw strong-colour literals in the red / amber / orange families - hex,
 * rgb()/rgba(), and CSS named colours. Any hit must be in ALLOWLIST, naming the file, a snippet of
 * the line it lives on, and the clinical reason the colour is there. A new decorative red/amber/
 * orange literal added to these files fails this test instead of shipping unnoticed.
 *
 * Out of scope: patient-register.css and discharge.css style patient-register.js/discharge.js,
 * which are separate modules from the ward.js frontend this P2.16 pass covers, and were not part
 * of the audit; they keep their own severity-token systems untouched.
 *
 * Green is not scanned here: strong-green is part of the same "reserve for meaningful state"
 * principle, but P2.16's literal-scan was scoped to red/amber/orange, where the ward UI actually
 * had decorative drift (pharmacy stock admin, rota blackout scheduling) to fix.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const PAGES_DIR = join(ROOT, "wardsynq/site/pages");
const FILES = [
  "ward.js",
  "wardsynq/site/shell.js",
  ...readdirSync(PAGES_DIR).filter((f) => f.endsWith(".js")).map((f) => "wardsynq/site/pages/" + f),
  "wardsynq/ui/wardsynq.css",
  "wardsynq/site/shell.css",
  "ward.css",
];

// Every allowlisted red/amber/orange literal: the file it's in, a snippet of the line it appears
// on (so a value that moves to an unreviewed line still fails), and why it's there.
const ALLOWLIST = [
  // --- --sig-stop / --sig-major and their washes: the app's one critical/warning signal, defined
  // once here and consumed everywhere else through var(). Both light and dark palettes, plus the
  // literal fallback each var(--token, #hex) carries so a missing custom property still renders
  // the right colour instead of transparent/black.
  { file: "wardsynq/ui/wardsynq.css", hex: "8c2f22", snippet: "--sig-stop: #8c2f22", reason: "the critical/stop signal token (light) - critical results, refusals, deteriorations key off this." },
  { file: "wardsynq/ui/wardsynq.css", hex: "85570c", snippet: "--sig-major: #85570c", reason: "the warning/major signal token (light) - overdue doses, held/cancelled states key off this." },
  { file: "wardsynq/ui/wardsynq.css", hex: "f7e9e6", snippet: "--sig-stop-wash: #f7e9e6", reason: "pale background wash for the stop signal (light) - same critical meaning, lower-contrast fill." },
  { file: "wardsynq/ui/wardsynq.css", hex: "f8f0df", snippet: "--sig-major-wash: #f8f0df", reason: "pale background wash for the major/warning signal (light)." },
  { file: "wardsynq/ui/wardsynq.css", hex: "e08277", snippet: "--sig-stop: #e08277", reason: "the critical/stop signal token (dark palette)." },
  { file: "wardsynq/ui/wardsynq.css", hex: "dcb45a", snippet: "--sig-major: #dcb45a", reason: "the warning/major signal token (dark palette) - nudged toward yellow so it reads apart from stop-red for colour-vision-deficient users (see the adjacent code comment)." },
  { file: "wardsynq/ui/wardsynq.css", hex: "2b1512", snippet: "--sig-stop-wash: #2b1512", reason: "pale-on-dark background wash for the stop signal (dark palette)." },
  { file: "wardsynq/ui/wardsynq.css", hex: "2a2110", snippet: "--sig-major-wash: #2a2110", reason: "pale-on-dark background wash for the major/warning signal (dark palette)." },

  // --- ward.css: the same tokens, re-declared as var(--x, #hex) fallbacks and as the dark-mode
  // override block (body.dark #smdWard), so #smdWard renders correctly even if wardsynq.css failed
  // to load its custom properties.
  { file: "ward.css", hex: "8c2f22", snippet: "--error: var(--sig-stop, #8c2f22)", reason: "fallback for the critical/stop token; --error backs every held/cancelled/overdue/refused state style." },
  { file: "ward.css", hex: "8c2f22", snippet: "--on-error-container: var(--sig-stop, #8c2f22)", reason: "fallback for the critical/stop token, used as the text/icon colour atop the pale stop wash." },
  { file: "ward.css", hex: "f7e9e6", snippet: "--sig-stop-wash, #f7e9e6", reason: "fallback for the pale stop wash used by --error-container." },
  { file: "ward.css", hex: "85570c", snippet: "--sig-major, #85570c", reason: "fallback for the warning/major token; --on-warn-container backs failed-load and overdue-item styling." },
  { file: "ward.css", hex: "f8f0df", snippet: "--sig-major-wash, #f8f0df", reason: "fallback for the pale warning wash used by --warn-container." },
  { file: "ward.css", hex: "e08277", snippet: "--error: #e08277", reason: "dark-mode override of the critical/stop token for #smdWard." },
  { file: "ward.css", hex: "e08277", snippet: "--on-error-container: #e08277", reason: "dark-mode override of the critical/stop token's text/icon colour for #smdWard." },
  { file: "ward.css", hex: "2b1512", snippet: "--error-container: #2b1512", reason: "dark-mode override of the pale stop wash for #smdWard." },
  { file: "ward.css", hex: "2a2110", snippet: "--warn-container: #2a2110", reason: "dark-mode override of the pale warning wash for #smdWard." },
  { file: "ward.css", hex: "dcb45a", snippet: "--on-warn-container: #dcb45a", reason: "dark-mode override of the warning/major token for #smdWard." },
  { file: "ward.css", hex: "fff4e0", snippet: "--warn-container, #fff4e0", reason: "w-tbl tr.w-diff: highlights a value that differs from what was ordered/expected - a discrepancy worth catching, not decoration." },
  { file: "ward.css", hex: "d93025", snippet: ".w-mic-btn.recording", reason: "dictation mic 'recording' dot - a transient system state, not a clinical severity signal; P2.16 audit flagged this (c) unclear and left it for the owner to decide, so it stays allowlisted rather than silently spreading." },

  // --- shell.css: the hospital-bar DEMO tag, coloured deliberately so a fabricated/demo hospital
  // can never be mistaken for a real one with real patients (see CLAUDE.md "no demo, sample, or
  // fabricated data" and shell.js's isDemo() title text).
  { file: "wardsynq/site/shell.css", hex: "f8f0df", snippet: "--sig-major-wash, #f8f0df", reason: "the DEMO hospital-bar tag - warns clinicians a hospital is fabricated data, never a real patient." },
  { file: "wardsynq/site/shell.css", hex: "85570c", snippet: "--sig-major, #85570c", reason: "the DEMO hospital-bar tag - same reason as above." },

  // --- ward.js lab QC Levey-Jennings chart (gap-lab): Westgard state is a real laboratory safety state.
  { file: "ward.js", hex: "b45309", snippet: 'var COLOR = { accepted: "currentColor", warning: "#b45309"', reason: "a QC run with a Westgard warning (1-2s) point on the Levey-Jennings chart." },
  { file: "ward.js", hex: "b91c1c", snippet: 'var COLOR = { accepted: "currentColor", warning: "#b45309", rejected: "#b91c1c"', reason: "a rejected QC run point: patient results for that test are blocked until corrective action." },
  { file: "ward.js", hex: "b91c1c", snippet: 'stroke = a === 3 ? "#b91c1c"', reason: "the +/-3 SD rejection limit line on the Levey-Jennings chart." },
  { file: "ward.js", hex: "b45309", snippet: 'a === 2 ? "#b45309"', reason: "the +/-2 SD warning limit line on the Levey-Jennings chart." },
  // --- blood unit label colour code (blood centre rules): group A labels are yellow by rule, not a severity signal.
  { file: "wardsynq/site/pages/bloodbank.js", hex: "f3c300", snippet: 'yellow: "#f3c300"', reason: "blood group A unit label colour required by the blood centre labelling rules (O blue, A yellow, B pink, AB white)." },
  // --- not a colour: the HTML entity &#9744; (ballot box) in the package document checklist matches the hex pattern.
  { file: "ward.js", hex: "9744", snippet: "<li>&#9744; ", reason: "HTML entity for an empty checkbox in the package document pack, not a colour." },
];

function hexToHsl(hex) {
  let h = hex.toLowerCase();
  if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  return rgbToHsl(r * 255, g * 255, b * 255);
}

function rgbToHsl(r255, g255, b255) {
  const r = r255 / 255, g = g255 / 255, b = b255 / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

// Red/orange/amber hue band, with a floor on saturation/lightness so near-grey, near-black and
// near-white literals (#000, #fff, #333, #999 - print styles, generic borders) don't count as
// "strong colour".
function isRedOrangeAmber({ h, s, l }) {
  const hueHit = (h >= 0 && h <= 55) || h >= 340;
  return hueHit && s >= 20 && l >= 8 && l <= 95;
}

const NAMED = ["red", "darkred", "firebrick", "crimson", "indianred", "lightcoral", "salmon",
  "darksalmon", "lightsalmon", "orangered", "tomato", "orange", "darkorange", "coral", "chocolate",
  "sienna", "maroon", "brown"];
const NAMED_RE = new RegExp("[:,(]\\s*(" + NAMED.join("|") + ")\\s*(?=[;),]|$)", "i");
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const RGB_RE = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi;

// Historical/documentary hex values inside /* ... */ comments (contrast-ratio notes like "was
// #9a6b12, now #85570c") are not live colour - blank them out (newlines kept, so line numbers in
// any failure message still point at the right place) before scanning.
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

function scanLine(line) {
  const hits = [];
  let m;
  HEX_RE.lastIndex = 0;
  while ((m = HEX_RE.exec(line))) {
    const hex = m[0].slice(1);
    if (hex.length === 3 || hex.length === 4 || hex.length === 6 || hex.length === 8) {
      if (isRedOrangeAmber(hexToHsl(hex))) hits.push({ kind: "hex", value: hex.toLowerCase() });
    }
  }
  RGB_RE.lastIndex = 0;
  while ((m = RGB_RE.exec(line))) {
    if (isRedOrangeAmber(rgbToHsl(+m[1], +m[2], +m[3]))) hits.push({ kind: "rgb", value: m[0] });
  }
  const named = NAMED_RE.exec(line);
  if (named) hits.push({ kind: "named", value: named[1].toLowerCase() });
  return hits;
}

test("no undocumented red/amber/orange literal in the WardSynQ ward frontend", () => {
  const violations = [];
  const usedAllowlist = new Set();

  for (const rel of FILES) {
    const text = stripComments(readFileSync(join(ROOT, rel), "utf8"));
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      for (const hit of scanLine(line)) {
        const allowIdx = ALLOWLIST.findIndex((a, idx) =>
          a.file === rel && !usedAllowlist.has(idx) &&
          (hit.kind === "hex" ? a.hex === hit.value : true) &&
          line.indexOf(a.snippet) !== -1);
        if (allowIdx === -1) {
          violations.push(rel + ":" + (i + 1) + " [" + hit.kind + " " + hit.value + "] " + line.trim());
        } else {
          usedAllowlist.add(allowIdx);
        }
      }
    });
  }

  assert.deepEqual(violations, [], "undocumented strong-colour literal(s) found - either it's a real clinical/safety state (add it to ALLOWLIST with the reason) or it's decoration (switch to the neutral/primary styles the codebase already has):\n" + violations.join("\n"));
});

test("the allowlist has no stale entries (every entry actually matched something)", () => {
  const unmatched = [];
  for (const a of ALLOWLIST) {
    const text = readFileSync(join(ROOT, a.file), "utf8");
    if (text.indexOf(a.snippet) === -1) unmatched.push(a.file + ": " + a.snippet);
  }
  assert.deepEqual(unmatched, [], "allowlist entries that no longer match any line (value moved/removed - update or delete the entry):\n" + unmatched.join("\n"));
});
