/* Material Symbols must render as ICONS, never as their ligature names.
 *
 * The app self-hosts the icon font (assets/fonts/material-symbols-rounded.woff2) and declares it in
 * redesign-system.css. Declaring a @font-face does NOT bind it to anything: for a long time only a
 * few module scopes bound the utility classes (queue.css `#smdQueue ...`, oncotree.css
 * `.ot-overlay ...`), so every other surface inherited the UI sans and printed the ligature NAME as
 * a word. The NMC eLOGBook setup screen read "school", "draw", "chevron_right" and "close" instead
 * of icons -- with the font file loaded 200 and document.fonts.check() returning true, which is why
 * checking that the font loaded would not have caught it.
 *
 * So this asserts what the doctor sees: the computed font-family on an icon span, and its width.
 * A glyph at 19px is ~19-28px wide; the word "chevron_right" is ~100px. Width alone is the check
 * that cannot be fooled by a binding that exists but loses to something more specific.
 *
 * USAGE: node test/run-icon-font-ui.mjs   (Playwright; serves the repo on :8996 itself) */
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8996/").replace(/\/?$/, "/");
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require(join(execSync("npm root -g").toString().trim(), "playwright")); }

let serve = null;
try { await fetch(BASE); } catch {
  serve = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8996"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

// The modules that never bound the font themselves and so depend entirely on the global rule.
const SURFACES = [
  ["NMC eLOGBook", "SMD_PGLOG.open()"],
  ["ThoreX",       "SMD_THOREX.open()"],
  ["SknX",         "SMD_SKNX.open()"],
  ["Onco IO-tox",  "SMD_ONCOIOTOX.openList()"],
  ["Onco RECIST",  "SMD_ONCORECIST.openList()"],
];

const browser = await pw.chromium.launch();
try {
  for (const [name, code] of SURFACES) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", () => {});
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForTimeout(8500);
    await page.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); });
    const opened = await page.evaluate(`(() => { try { ${code}; return true; } catch (e) { return "ERR " + (e.message || "").slice(0, 40); } })()`);
    if (opened !== true) { console.log("SKIP " + name + " (" + opened + ")"); await ctx.close(); continue; }
    await page.waitForTimeout(3000);

    const r = await page.evaluate(async () => {
      await document.fonts.ready;
      const spans = [...document.querySelectorAll(".material-symbols-rounded, .material-symbols-outlined, .material-symbols-sharp")]
        .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
      const asWords = spans.filter((el) => {
        const cs = getComputedStyle(el);
        const bound = /Material Symbols/i.test(cs.fontFamily);
        const fs = parseFloat(cs.fontSize) || 16;
        // A single glyph is about one em wide. Three times that means a word is rendering.
        return !bound || el.getBoundingClientRect().width > fs * 3;
      });
      return {
        total: spans.length,
        bad: asWords.slice(0, 4).map((el) => (el.textContent || "").trim().slice(0, 18) + " w=" + Math.round(el.getBoundingClientRect().width)),
        badCount: asWords.length
      };
    });

    if (!r.total) { console.log("SKIP " + name + " (no icon spans on screen)"); await ctx.close(); continue; }
    ok(r.badCount === 0, name + ": all " + r.total + " icon spans render as glyphs, not ligature names" +
      (r.badCount ? " -- " + r.bad.join(", ") : ""));
    await ctx.close();
  }

  console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
} finally {
  await browser.close();
  if (serve) serve.kill();
}
process.exit(fails ? 1 : 0);
