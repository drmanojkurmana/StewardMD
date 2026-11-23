/* One shared picture bank reused by every module (owner 2026-11-23): the "Pictures and animations" strip from
 * SMD_IMGLIB.strip shows on the Drugs monograph, a Knowledge Library article, a SurgX operation and a CliniX topic,
 * and tapping it opens the full-screen viewer over the module; Back closes the viewer and leaves the module open.
 * USAGE: node test/run-imglib-strip-ui.mjs   (BASE=http://localhost:8997/; SHOTS=<dir> for screenshots) */
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8997/").replace(/\/?$/, "/");
const SHOTS = process.env.SHOTS || "";
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require(join(execSync("npm root -g").toString().trim(), "playwright")); }
let serve = null;
try { await fetch(BASE); } catch {
  serve = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8997"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String((e && e.message) || e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForFunction(() => window.SMD_IMGLIB && window.SMD_IMGLIB.strip && window.MEDDB, null, { timeout: 40000 });
  await page.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash", "verifyGate"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); });
  const titles = (sel) => page.evaluate((s) => [...document.querySelectorAll(s + " .igl-strip-t")].map((x) => x.textContent), sel);
  const waitStrip = async (sel) => { try { await page.waitForSelector(sel + " .igl-strip-it", { timeout: 20000 }); return true; } catch { return false; } };
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, "imglib-strip-" + n + ".png") }); };

  /* Drugs: Tamsulosin shows its animation and the alpha-blocker mechanism picture */
  await page.evaluate(() => MEDDB.openComposition("Tamsulosin"));
  ok(await waitStrip(".db-head ~ .igl-strip, .igl-strip"), "Drugs: Tamsulosin shows the Pictures and animations strip");
  const dt = await titles(".igl-strip");
  ok(dt.includes("Tamsulosin"), "Drugs: the tamsulosin animation is there " + JSON.stringify(dt.slice(0, 4)));
  ok(dt.some((t) => /alpha-adrenergic blocker/i.test(t)), "Drugs: the alpha-blocker mechanism picture is there");
  await shot("drug");
  await page.click(".igl-strip .igl-strip-it");
  ok(await page.waitForSelector("#smdImgLib .igl-vimg", { timeout: 8000 }).then(() => true, () => false), "Drugs: tap opens the full-screen viewer");
  ok(await page.evaluate(() => { const r = document.getElementById("smdImgLib"); return +getComputedStyle(r).zIndex > 100000; }), "viewer sits above the module");
  await page.evaluate(() => SMD_IMGLIB.back());
  ok(await page.evaluate(() => document.getElementById("smdImgLib").hidden && !!document.querySelector(".igl-strip")), "Back closes the viewer and the drug page stays");
  await page.evaluate(() => { try { MEDDB.close && MEDDB.close(); } catch (e) {} });

  /* Knowledge Library article (community-acquired pneumonia) */
  await page.waitForFunction(() => window.DX && DX.openRef, null, { timeout: 30000 });
  await page.evaluate(() => DX.openRef("CAP", { standalone: true }));
  ok(await waitStrip("#dxMgmt"), "Knowledge Library: pneumonia article shows the strip");
  ok((await titles("#dxMgmt")).some((t) => /pneumonia/i.test(t)), "Knowledge Library: pictures are about pneumonia " + JSON.stringify((await titles("#dxMgmt")).slice(0, 3)));
  await shot("kb");

  /* SurgX operation */
  await page.evaluate(() => window.SURGX && SURGX.open());
  await page.waitForFunction(() => window.SMD_SURGX_SCREENS, null, { timeout: 30000 });
  await page.evaluate(() => SMD_SURGX_SCREENS.go("procedures"));
  await page.waitForSelector("#surgxRoot .sgx-row", { timeout: 20000 });
  await page.evaluate(() => { const r = [...document.querySelectorAll("#surgxRoot .sgx-row")].find((x) => /Appendicectomy/.test(x.textContent)); r && r.click(); });
  ok(await waitStrip("#sgxRelated"), "SurgX: appendicectomy shows the strip");
  ok((await titles("#sgxRelated")).some((t) => /append/i.test(t)), "SurgX: pictures are about the appendix " + JSON.stringify((await titles("#sgxRelated")).slice(0, 3)));
  await shot("surgx");

  /* CliniX topic (open topics only; a Pro-locked one shows the lock instead) */
  await page.evaluate(() => { try { SURGX.close && SURGX.close(); } catch (e) {} window.CLINIX && CLINIX.open(); });
  await page.waitForFunction(() => window.SMD_CLINIX_SCREENS, null, { timeout: 30000 });
  // CliniX topics need Pro; this test is about the pictures, so it signs in as Pro for this page only.
  await page.evaluate(() => { if (window.SMD_PRO) { SMD_PRO.isProSync = () => true; SMD_PRO.isPro = () => Promise.resolve(true); } });
  await page.evaluate(() => SMD_CLINIX_SCREENS.openDisease("acute-appendicitis"));
  ok(await waitStrip("#clinixScroll"), "CliniX: acute appendicitis topic shows the strip");
  ok((await titles("#clinixScroll")).some((t) => /append/i.test(t)), "CliniX: pictures are about the appendix " + JSON.stringify((await titles("#clinixScroll")).slice(0, 3)));
  await shot("clinix");

  /* PrepNucleus: the breast cancer lesson's finish screen shows related pictures, not the lesson's own */
  await page.evaluate(() => { localStorage.setItem("smd_prep", "1"); localStorage.removeItem("smd_prep_v1"); });
  await page.goto(BASE + "?prep=1", { waitUntil: "load" });
  await page.waitForFunction(() => window.PREP && window.SMD_IMGLIB, null, { timeout: 40000 });
  await page.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash", "verifyGate"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); PREP.open({ subject: "surgery" }); });
  await page.waitForSelector("#smdPrep .pn-mod[data-m=sur-breast-cancer]", { timeout: 20000 });
  await page.evaluate(() => { const w = document.getElementById("pnSetup"); if (w) w.remove(); document.querySelector("#smdPrep .pn-mod[data-m=sur-breast-cancer]").click(); });
  await page.waitForSelector("#smdPrep [data-act=l-open]", { timeout: 8000 });
  await page.evaluate(() => document.querySelector("#smdPrep [data-act=l-open]").click());
  await page.waitForSelector("#smdPrep .pn-lsn-tx", { timeout: 8000 });
  for (let i = 0; i < 20 && !(await page.$("#smdPrep .pn-lsn-fin")); i++) { await page.evaluate(() => { const b = document.querySelector("#smdPrep [data-act=l-next]"); b && b.click(); }); await sleep(150); }
  ok(!!(await page.$("#smdPrep .pn-lsn-fin")), "PrepNucleus: the lesson reaches its finish screen");
  ok(await waitStrip("#smdPrep"), "PrepNucleus: the finish screen shows the strip");
  const pt = await titles("#smdPrep");
  ok(pt.some((t) => /breast/i.test(t)), "PrepNucleus: pictures are about breast cancer " + JSON.stringify(pt.slice(0, 3)));
  const own = await page.evaluate(() => PREP_LESSONS._pure.lessonImages(PREP_LESSONS._l.les).map((u) => String(u).split("/").pop()));
  const shown = await page.evaluate(() => [...document.querySelectorAll("#smdPrep .igl-strip-it img")].map((i) => (i.getAttribute("src") || "").split("/").pop()));
  ok(!shown.some((s) => own.includes(s)), "PrepNucleus: the lesson's own pictures are left out");
  await shot("prep");

  ok(errs.length === 0, "no uncaught error " + JSON.stringify(errs.slice(0, 3)));
} finally {
  await browser.close();
  if (serve) serve.kill();
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
