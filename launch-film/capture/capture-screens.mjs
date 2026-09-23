/* Capture the real StewardMD screens used in the launch film.
 *
 * Every product frame in the film comes from here (or from a committed repo asset, see README).
 * It boots the actual app (repo root, served by test/serve.mjs) in headless Chromium at iPhone /
 * iPad sizes, drives it through its own public JS APIs with SYNTHETIC data only, and screenshots.
 * No UI is drawn here. Nothing is mocked.
 *
 *   node test/serve.mjs . 8991 &            # from the repo root
 *   node launch-film/capture/capture-screens.mjs
 *
 * Env: BASE (default http://localhost:8991/), CHROME (optional executable path).
 * Fonts: the app's stack falls back to -apple-system on iOS. Headless Linux has no SF Pro, so map
 * -apple-system / system-ui / sans-serif to Inter (bundled at assets/fonts/inter-variable.woff2)
 * via fontconfig before capturing, or the captures fall back to DejaVu. See README.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "assets", "screens", "raw");
const BASE = (process.env.BASE || "http://localhost:8991/").replace(/\/?$/, "/");
mkdirSync(OUT, { recursive: true });

const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

async function boot({ w = 390, h = 844, path = "", mobile = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: mobile, hasTouch: mobile, colorScheme: "light", userAgent: mobile ? IOS_UA : undefined });
  const p = await ctx.newPage();
  await p.goto(BASE + path, { waitUntil: "load" });
  await p.waitForTimeout(3500);
  // First-run overlays (intro poster, splash, sign-in gate). The film shows the signed-in app.
  await p.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "modeSelect", "verifyGate", "harrisonQuotePopup", "smdBootSplash"].forEach((k) => document.getElementById(k)?.remove()); });
  await p.waitForTimeout(600);
  return { ctx, p };
}
const shot = (p, name) => p.screenshot({ path: join(OUT, name + ".png") });
// Rectangles of real UI elements, in app CSS px, recorded next to the captures so the film's
// lifted crops always frame exactly the element named (written to film/rects.js).
const RECTS = {};
async function rect(p, shotName, key, sel, must) {
  const r = await p.evaluate(([sel, must]) => {
    let e;
    if (sel.startsWith("text:")) {
      const re = new RegExp(sel.slice(5), "i"), mu = must ? new RegExp(must, "i") : null;
      e = [...document.querySelectorAll("body *")].filter((x) => x.offsetParent !== null && re.test(x.textContent.trim()) && (!mu || mu.test(x.textContent)))
        .sort((a, b) => a.textContent.length - b.textContent.length)[0];
    } else e = document.querySelector(sel);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return [Math.round(b.left), Math.round(b.top + window.scrollY), Math.round(b.width), Math.round(b.height)];
  }, [sel, must]);
  if (!r) throw new Error(`rect not found: ${shotName}.${key} (${sel})`);
  (RECTS[shotName] = RECTS[shotName] || {})[key] = r;
}
const top = (p) => p.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll("*").forEach((e) => { if (e.scrollTop > 0) e.scrollTop = 0; }); });

const MENINGITIS = ["fever", "headache", "neckStiffness", "photophobia", "alteredSensorium"];

// 1. Home (phone)
{ const { ctx, p } = await boot(); await shot(p, "home"); await rect(p, "home", "dxTile", '[data-act="reasoning"]'); await ctx.close(); }

// 2-3. Dx My Patient. Four findings are entered, the guided consult asks about the fifth
// ("Is this finding present? Altered sensorium"), and the clinician taps "Present · add". The
// engine then reports what that finding changed. Phone-height captures first, then a tall run of
// the same flow for the differential and the stewardship page (panned in the film).
async function dxFlow(p) {
  await p.evaluate((f) => { DX.openWorkspace(); DX.reset(); document.activeElement?.blur(); DX.addFindings(f.slice(0, 4)); }, MENINGITIS);
  await p.waitForTimeout(800);
}
async function dxConfirm(p) {
  const q = await p.evaluate(() => document.querySelector("#dxSuggest")?.innerText || "");
  if (!/Altered sensorium/i.test(q)) throw new Error("guided question is not Altered sensorium: " + q.slice(0, 120));
  await p.evaluate(() => document.querySelector("#dxSuggest [data-confirm]").click());
  await p.waitForTimeout(800);
}
{
  const { ctx, p } = await boot();
  await dxFlow(p);
  await shot(p, "dx-findings-4");
  await rect(p, "dx4", "confirm", "#dxSuggest [data-confirm]");
  await dxConfirm(p);
  await shot(p, "dx-findings-5");
  await rect(p, "dx5", "review", '[data-dx-jump="dxReview"]'); await rect(p, "dx5", "chips", "#dxSel");
  await ctx.close();
}
{
  const { ctx, p } = await boot({ h: 2000 });
  await dxFlow(p); await dxConfirm(p);
  await p.evaluate(() => document.querySelector('[data-dx-jump="dxReview"]').click()); await p.waitForTimeout(800);
  if (!(await p.evaluate(() => getComputedStyle(document.querySelector("#dxChanged")).display !== "none"))) throw new Error("#dxChanged not shown");
  await shot(p, "dx-differential-tall");
  await rect(p, "dxr", "changed", "#dxChanged");
  await rect(p, "dxr", "stewBtn", "text:^Open full stewardship page");
  await rect(p, "dxr", "top1", "#dxCols .dx-card");
  await p.evaluate(() => [...document.querySelectorAll("button,a")].find((x) => /Open full stewardship page/.test(x.textContent)).click());
  await p.waitForTimeout(1500); await top(p); await p.waitForTimeout(400);
  await shot(p, "stewardship-tall");
  await rect(p, "stew", "quick", "text:^QUICK DECISION", "Ceftriaxone");
  await ctx.close();
}

// 4. Antibiogram: resistance rates (phone) and coverage grid (iPad landscape)
{
  const { ctx, p } = await boot({ h: 1400 });
  await p.evaluate(() => document.querySelector('[data-act="antibiogram"]').click()); await p.waitForTimeout(1500);
  await p.evaluate(() => [...document.querySelectorAll("button")].find((e) => e.offsetParent && /Resistance rates/i.test(e.textContent)).click());
  // Let the one-time "Rotate for a wider view" hint time out before the capture.
  await p.waitForTimeout(5000); await shot(p, "antibiogram-resistance-tall");
  await ctx.close();
}
{
  const { ctx, p } = await boot({ w: 1180, h: 1600 });
  await p.evaluate(() => document.querySelector('[data-act="antibiogram"]').click()); await p.waitForTimeout(1800);
  await shot(p, "antibiogram-grid-ipad-tall");
  await ctx.close();
}

// 5. ICU workstation, synthetic septic-shock patient (tall phone)
{
  const { ctx, p } = await boot({ h: 2600 });
  await p.evaluate(() => {
    try { localStorage.setItem("smd_icu_groups", "0"); } catch (e) {}
    ICU.reset(); ICU.ingestPatient({ name: "Demo Patient", age: 64, sex: "M", bed: "4", diagnosis: "Septic shock" });
    const t0 = Date.now() - 6 * 3600e3;
    // hr, sbp, dbp, rr, spo2, temp, urine mL/h, lactate, gcs: four synthetic readings, 2 h apart
    [[118, 88, 52, 28, 91, 38.9, 22, 4.8, 11], [112, 92, 55, 26, 93, 38.6, 30, 4.1, 11], [104, 98, 58, 24, 94, 38.2, 35, 3.4, 12], [98, 104, 62, 22, 95, 37.9, 40, 2.6, 13]]
      .forEach((r, i) => ICU.ingestMonitor({ hr: r[0], sbp: r[1], dbp: r[2], rr: r[3], spo2: r[4], temp: r[5], uop: r[6], lactate: r[7], gcs: r[8], ts: t0 + i * 2 * 3600e3 }));
    ICU.ingestLabs({ na: 131, k: 5.6, cl: 99, hco3: 17, creat: 2.1, urea: 68, glu: 212, wbc: 18.4, hb: 10.2, plt: 96, bili: 2.4, inr: 1.6, lactate: 2.6, alb: 2.8, ts: t0 + 5 * 3600e3 });
    ICU.ingestFlowsheet({ intake24h: 3800, output24h: 1650, urine24h: 1100 });
    ICU.ingestVentilator({ mode: "VC-AC", fio2: 0.5, peep: 8, tv: 420, rr: 22, plateau: 26, pf: 180 });
    ICU.open("overview");
  });
  await p.waitForTimeout(1500);
  await p.evaluate(() => [...document.querySelectorAll("button")].find((e) => e.offsetParent && /^Not now$/.test(e.textContent.trim()))?.click());
  await p.waitForTimeout(500); await top(p);
  await shot(p, "icu-overview-tall");
  await rect(p, "icu", "vitals", "text:^MAP", "LACT");
  await rect(p, "icu", "status", "text:^current status", "NEWS2");
  await rect(p, "icu", "qsofa", "text:^qSOFA 2/3", "Meets");
  await ctx.close();
}

// 6. Public site hero (desktop), the stewardmd.in home page served from _site/
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(BASE + "_site/index.html", { waitUntil: "load" }); await p.waitForTimeout(3000);
  await shot(p, "site-desktop");
  await ctx.close();
}

await browser.close();
writeFileSync(join(HERE, "..", "film", "rects.js"), "/* Generated by capture/capture-screens.mjs: element rectangles (app CSS px: x, y, w, h). */\nFILM.RECTS = " + JSON.stringify(RECTS, null, 1) + ";\n");
console.log("captured to", OUT, RECTS);
