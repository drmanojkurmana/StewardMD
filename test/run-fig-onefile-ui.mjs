/* One page per figure in the app bundle (scripts/slim-figures.mjs + fig-viewer.js SMD_FIG_ONEFILE).
 * Light theme: the dark page opens in a frame named "smdfig-light" and turns itself light, and stays light
 * through the in-figure alternate-view link (hemodialysis <-> hemodialysis-simple). Dark theme: unchanged.
 * USAGE: npm run build:www && node test/run-fig-onefile-ui.mjs   (serves www/ itself)
 */
import { createRequire } from "node:module"; const require = createRequire(import.meta.url); const { chromium, devices } = require("playwright");
import { spawn } from "node:child_process";
const port = 8994;
const srv = spawn("node", [new URL("./serve.mjs", import.meta.url).pathname, new URL("../www", import.meta.url).pathname, String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1200));
const browser = await chromium.launch(); const ctx = await browser.newContext({ ...devices["iPhone 13"] }); const page = await ctx.newPage();
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
const notFound = []; page.on("response", (r) => { if (r.status() === 404 && /figures/.test(r.url())) notFound.push(r.url()); });
await page.goto(`http://localhost:${port}/`, { waitUntil: "load" }); await page.waitForTimeout(5000);
ok(await page.evaluate(() => window.SMD_FIG_ONEFILE === 1), "bundle flag SMD_FIG_ONEFILE=1");
await page.evaluate(() => new Promise((res) => { if (window.SMD_FIG) return res(); const s = document.createElement("script"); s.src = "/fig-viewer.js"; s.onload = res; document.head.appendChild(s); }));
async function openFig(dark, src) {
  await page.evaluate(([d, s]) => { if (window.SMD_FIG.close) window.SMD_FIG.close(); document.body.classList.toggle("dark", d); window.SMD_FIG.open({ src: s, title: "t" }); }, [dark, src]);
  await page.waitForTimeout(1500);
  return page.evaluate(() => { const f = document.querySelector(".smdfig-fr"); return { src: f.getAttribute("src"), name: f.name, theme: f.contentDocument && f.contentDocument.body && f.contentDocument.body.getAttribute("data-theme"), alt: !!(f.contentDocument && f.contentDocument.getElementById("altview")) }; });
}
let r = await openFig(false, "prep/figures/vitamin-deficiency-syndromes.html");
ok(!/-light/.test(r.src) && r.name === "smdfig-light", "light theme opens the single page in a smdfig-light frame (" + r.src + ")");
ok(r.theme === "light", "the page renders light (data-theme=" + r.theme + ")");
r = await openFig(true, "prep/figures/vitamin-deficiency-syndromes.html");
ok(r.name === "" && r.theme === "dark", "dark theme unchanged (data-theme=" + r.theme + ")");
r = await openFig(false, "prep/figures/hemodialysis.html");
ok(r.theme === "light" && r.alt, "hemodialysis light with its alternate-view button");
await page.evaluate(() => document.querySelector(".smdfig-fr").contentDocument.getElementById("altview").click());
await page.waitForTimeout(1500);
const after = await page.evaluate(() => { const f = document.querySelector(".smdfig-fr"); return { url: f.contentWindow.location.pathname, theme: f.contentDocument.body.getAttribute("data-theme") }; });
ok(/hemodialysis-simple\.html$/.test(after.url) && after.theme === "light", "alternate view stays light (" + after.url + ", " + after.theme + ")");
ok(notFound.length === 0, "no figure 404s " + notFound.join(" "));
ok(errs.length === 0, "no page errors " + errs.join(" | "));
await browser.close(); srv.kill(); process.exit(fails ? 1 : 0);
