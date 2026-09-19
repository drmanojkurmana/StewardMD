/* The beta label on the four clinically unvalidated imaging AI modules is a SAFETY control, not
 * decoration: ThoreX / KardiQ X / SknX / FundX are unvalidated (docs/fundx/VALIDATION-PROGRAM.md)
 * and a paying Physician Pro now reaches them with no access code. These assertions are the thing
 * that stops a later refactor from quietly deleting the warning, so they are source-level and
 * deliberately blunt: the label must be UNCONDITIONAL (same string on the tier path and the
 * access-code path) and must never become permanently dismissible. */
import assert from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

const MODULES = [
  { name: "ThoreX", file: "thorex-screens.js", global: "THOREX", tile: "smd_thorex" },
  { name: "KardiQ X", file: "kardiox-screens.js", global: "KARDIOX", tile: "smd_kardiox" },
  { name: "SknX", file: "sknx-screens.js", global: "SKNX", tile: "smd_sknx" },
  { name: "FundX", file: "fundx.js", global: "FUNDX", tile: "smd_fundx" }
];

test("every module's RESULT disclaimer says beta and in active development", () => {
  MODULES.forEach((m) => {
    const src = read(m.file);
    assert.match(src, /Beta, in active development\./i, m.name + " result label missing");
    assert.match(src, /may not perform to the mark/i, m.name + " performance caveat missing");
  });
});

test("the result label is not wrapped in an entitlement / access-code condition", () => {
  // The label must read identically for a tester holding a code and for a paying Physician Pro.
  MODULES.forEach((m) => {
    const src = read(m.file);
    src.split("\n").forEach((line, i) => {
      if (!/Beta, in active development/i.test(line)) return;
      assert.ok(!/SMD_XACCESS|xaToken|isActiveCached|tierFor\(|v2beta|physicianpro/.test(line),
        m.name + ":" + (i + 1) + " beta label is gated by entitlement: " + line.trim());
    });
  });
});

test("the on-open notice covers all four modules and is session-only", () => {
  const src = read("experimental-beta-notice.js");
  MODULES.forEach((m) => {
    assert.ok(src.includes(m.global + ":"), m.global + " missing from the notice copy map");
    assert.match(src, new RegExp(m.name.replace(" ", "\\s") + " is in beta"), m.name + " notice wording missing");
  });
  assert.match(src, /decision support; the clinician decides/i, "clinician-decides framing missing");
  // No persistence: nothing here may write a "never show again" bit. Comments are stripped first —
  // the header explains WHY there is no localStorage, and must not trip its own assertion.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(code), "the notice must not persist a dismissal");
  assert.ok(!/do not show|dont show|never show again/i.test(code), "no permanent-dismiss affordance");
  // It wraps open(), which is the choke point every entry path uses.
  assert.match(src, /typeof obj\.open !== "function"/, "notice no longer wraps module open()");
});

test("the notice script is loaded by index.html after the four modules", () => {
  const html = read("index.html");
  const at = html.indexOf("experimental-beta-notice.js");
  assert.ok(at > 0, "experimental-beta-notice.js is not loaded by index.html");
  ["fundx.js", "thorex.js", "sknx.js", "kardiox-screens.js"].forEach((f) => {
    const m = html.indexOf('src="/' + f);
    assert.ok(m > 0 && m < at, f + " must load before the beta notice");
  });
});

test("the home tile carries a persistent BETA badge on every path", () => {
  const home = read("home.js");
  assert.match(home, /rnav-tile-beta/, "tile BETA chip missing from the tile renderer");
  MODULES.forEach((m) => {
    // Each of the four registry entries opts in via beta: true.
    const line = home.split("\n").find((l) => l.includes('"' + m.tile.replace("smd_", "") + '"') && l.includes("beta: true"))
      || home.split("\n").find((l) => l.includes(m.name.split(" ")[0]) && l.includes("beta: true"));
    assert.ok(line, m.name + " home tile is missing beta: true");
  });
  // The chip is rendered from the tile data with no entitlement check on the line.
  const chip = home.split("\n").find((l) => l.includes("rnav-tile-beta"));
  assert.ok(!/SMD_XACCESS|tierSync|physicianpro/.test(chip), "BETA chip is entitlement-gated: " + chip);
});

test("Physician Pro paywall copy still says the imaging AI is in beta", () => {
  const pw = read("pro-paywall.js");
  // #1138 rebuilt the sheet, so several maps now carry a physicianpro: key (benefit, spend,
  // per-day note, blurb). The beta status belongs to the FEATURE blurb - find that map, not the
  // first physicianpro: line in the file.
  const blurb = pw.slice(pw.indexOf("var TIER_BLURB"));
  const line = blurb.split("\n").find((l) => l.trim().startsWith("physicianpro:"));
  assert.ok(line, "physicianpro paywall blurb not found");
  assert.match(line, /in beta/i, "paywall sells early access without saying beta: " + line.trim());
});
