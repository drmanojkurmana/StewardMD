/* test/run-ipad-module-shots.mjs: screenshot and measure module screens at iPad sizes against vault/plans/iPad-Standards.md.
 * Owner 2026-11-04: "fix every module page and module UI to meet iPad standards rather than make the iPhone app support iPad".
 *
 * USAGE: node test/run-ipad-module-shots.mjs "<name>=<js that opens the screen>" ["<name2>=<js>" ...]
 *   The JS runs in the page after boot (splash, intro and account gate removed). It may return a Promise. Chain more
 *   steps with " ;; " (each step runs after WAIT ms), e.g. "tokos-learn=TOKOS.open() ;; document.querySelector('.x').click()".
 *   ACT('<data-act>') is available inside the JS: it clicks a Home action the way a tile tap does.
 * ENV: OUT=<dir> (default $CLAUDE_JOB_DIR or /tmp + /ipad-shots), SIZES=820x1180,1180x820,1366x1024,507x1024,390x844
 *      URL=http://127.0.0.1:8994/?tour=0 (static server: node test/serve.mjs . 8994), WAIT=1800, DPR=1, QUERY extra params.
 * Output per screen and size: <name>-<WxH>.png and one line of findings. Findings are hints for a person, not a verdict:
 *   PHONE-COL  the visible content sits in a column 560 px or narrower (or hugs the left 60%) on a regular-width screen
 *   STRETCH    a button (under 60 px tall) wider than 520 px or a text field wider than 900 px on a regular-width screen
 *   CLIP       something sticks past the right edge outside a sideways scroller
 *   HSCROLL    the page itself scrolls sideways
 *   SMALL      visible tap targets under 32 px on their short side (count)
 * Exit code is always 0; read the PNGs. Headless Chromium is not WebKit: confirm on an iPad before calling it done. */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = await import("/opt/node22/lib/node_modules/playwright/index.mjs"); }
const { chromium } = pw;

const OUT = process.env.OUT || ((process.env.CLAUDE_JOB_DIR || "/tmp") + "/ipad-shots");
const URL = process.env.URL || "http://127.0.0.1:8994/?tour=0" + (process.env.QUERY ? "&" + process.env.QUERY : "");
const WAIT = +(process.env.WAIT || 1800), DPR = +(process.env.DPR || 1);
const SIZES = (process.env.SIZES || "820x1180,1180x820,1366x1024,507x1024,390x844").split(",").map((s) => s.split("x").map(Number));
const screens = process.argv.slice(2).map((a) => { const i = a.indexOf("="); return [a.slice(0, i), a.slice(i + 1)]; });
if (!screens.length) { console.error("usage: node test/run-ipad-module-shots.mjs \"<name>=<js>\" ..."); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const MEASURE = () => {
  const W = innerWidth, H = innerHeight, out = { W, H };
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) return null; const s = getComputedStyle(el); if (s.visibility === "hidden" || s.display === "none" || +s.opacity < 0.05) return null;
    // On top? Sample the centre (clamped to the screen); an element under a module overlay does not count.
    const x = Math.min(W - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(H - 1, Math.max(0, r.top + Math.min(r.height / 2, 20)));
    const top = document.elementFromPoint(x, y); if (!top || !(top === el || el.contains(top) || top.contains(el))) return null;
    return r; };
  // Content extent: visible text-bearing leaves and controls, ignoring fixed full-width bars (top bar, tab bar).
  let L = 1e9, R = -1e9, n = 0;
  document.querySelectorAll("body *").forEach((el) => {
    if (el.closest("[aria-hidden=true],[inert]")) return;
    const ctl = el.matches("button,input,select,textarea,a[href],[role=button]");
    const leafText = !ctl && el.childElementCount === 0 && (el.textContent || "").trim().length > 2;
    if (!ctl && !leafText && el.tagName !== "IMG" && el.tagName !== "CANVAS" && el.tagName !== "svg") return;
    const r = vis(el); if (!r) return;
    let p = el, bar = false; while (p && p !== document.body) { const s = getComputedStyle(p); if ((s.position === "fixed" || s.position === "sticky") && p.getBoundingClientRect().height < 140 && p.getBoundingClientRect().width > W * 0.9) { bar = true; break; } p = p.parentElement; }
    if (bar) return;
    L = Math.min(L, r.left); R = Math.max(R, r.right); n++;
  });
  out.extent = n ? [Math.round(L), Math.round(R)] : null;
  const f = [];
  if (W >= 700 && n > 3) { const w = R - L; if (w <= 560 || (L < W * 0.15 && R < W * 0.6)) f.push(`PHONE-COL ${Math.round(L)}..${Math.round(R)} (${Math.round(w)}px of ${W})`); }
  if (W >= 700) {
    const wideBtn = [], wideIn = [];
    document.querySelectorAll("button,[role=button],a[href]").forEach((b) => { const r = vis(b); if (r && r.width > 520 && r.height < 60) wideBtn.push((b.textContent || b.getAttribute("aria-label") || "").trim().slice(0, 24) + "@" + Math.round(r.width)); });
    document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=range]),select,textarea").forEach((b) => { const r = vis(b); if (r && r.width > 900) wideIn.push((b.placeholder || b.name || b.tagName).slice(0, 24) + "@" + Math.round(r.width)); });
    if (wideBtn.length) f.push(`STRETCH buttons ${wideBtn.length}: ${wideBtn.slice(0, 3).join(" | ")}`);
    if (wideIn.length) f.push(`STRETCH fields ${wideIn.length}: ${wideIn.slice(0, 3).join(" | ")}`);
  }
  if (document.documentElement.scrollWidth > W + 1) f.push(`HSCROLL ${document.documentElement.scrollWidth}`);
  const clip = [];
  document.querySelectorAll("body *").forEach((el) => {
    const r = el.getBoundingClientRect(); if (!r.width || r.right <= W + 1 || r.left >= W - 1 || r.bottom < 0 || r.top > H) return;
    const s = getComputedStyle(el); if (s.display === "none" || s.visibility === "hidden") return;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const ps = getComputedStyle(p); if (/auto|scroll|hidden|clip/.test(ps.overflowX) && p.getBoundingClientRect().right <= W + 1) return; if (p.getAttribute("aria-hidden") === "true" || ps.visibility === "hidden") return; }
    clip.push(el.tagName.toLowerCase() + "." + String(el.className.baseVal ?? el.className).split(" ")[0] + "@" + Math.round(r.right));
  });
  if (clip.length) f.push(`CLIP ${clip.length}: ${clip.slice(0, 3).join(" ")}`);
  let small = 0; document.querySelectorAll("button,[role=button],a[href],input[type=checkbox],input[type=radio]").forEach((b) => { const r = vis(b); if (r && Math.min(r.width, r.height) < 32) small++; });
  if (small) f.push(`SMALL ${small}`);
  out.findings = f; return out;
};

const browser = await chromium.launch();
const report = [];
for (const [name, js] of screens) {
  for (const [w, h] of SIZES) {
    const big = w >= 600 || h >= 1000; // a Split View window still sits on an iPad screen
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, screen: big ? { width: Math.max(w, h) === h ? Math.max(w, 820) : Math.max(w, 1180), height: Math.max(h, 820) } : { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: DPR });
    await ctx.addInitScript((tp) => { Object.defineProperty(Navigator.prototype, "maxTouchPoints", { get: () => tp }); try { localStorage.setItem("smd_onboarding_tour", "0"); } catch (e) {} window.confirm = () => true; }, 5);
    const page = await ctx.newPage(); const errs = [];
    page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 120)));
    try {
      await page.goto(URL, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.getElementById("homeV2"), null, { timeout: 30000 });
      await page.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => document.getElementById(k)?.remove()); document.body.classList.remove("dark"); window.ACT = (a) => { const b = document.createElement("button"); b.setAttribute("data-act", a); b.style.cssText = "position:fixed;left:-50px;top:0;width:1px;height:1px"; document.getElementById("homeV2").appendChild(b); b.click(); b.remove(); return 1; }; });
      await page.waitForTimeout(700);
      for (const step of js.split(" ;; ").filter((s) => s.trim())) {
        try { await page.evaluate(`(async()=>{ return (${step}); })()`); } catch (e) { errs.push("step: " + String(e.message).slice(0, 100)); }
        await page.waitForTimeout(WAIT);
      }
      const m = await page.evaluate(MEASURE);
      const file = `${OUT}/${name}-${w}x${h}.png`;
      await page.screenshot({ path: file });
      const tablet = await page.evaluate(() => document.documentElement.classList.contains("smd-tablet"));
      console.log(`${name} @${w}x${h}${tablet ? "" : " (phone)"}: ${m.findings.length ? m.findings.join("; ") : "ok"}${errs.length ? "  ERR " + errs.slice(0, 2).join(" | ") : ""}`);
      report.push({ name, w, h, tablet, ...m, errs, file });
    } catch (e) { console.log(`${name} @${w}x${h}: FAILED ${e.message}`); report.push({ name, w, h, failed: String(e.message) }); }
    await ctx.close();
  }
}
await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log(`screenshots and report.json in ${OUT}`);
