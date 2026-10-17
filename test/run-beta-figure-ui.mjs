/* Beta-blocker interactive figure (fig-viewer.js, prep/figures/beta-blockers*.html) in the real app: the Drugs page shows the
 * card for beta-blockers only, preset to the drug's class; it opens full screen in the app's theme (dark and light builds);
 * the figure's controls work; Close and Escape return; the lesson step uses the same viewer. USAGE: node test/run-beta-figure-ui.mjs */
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8998/").replace(/\/?$/, "/");
const SHOTS = process.env.SHOTS || "";
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require(join(execSync("npm root -g").toString().trim(), "playwright")); }
let serve = null;
try { await fetch(BASE); } catch {
  serve = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8998"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e && e.message || e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForFunction(() => window.MEDDB && window.SMD_FIG, null, { timeout: 30000 });
  await page.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash", "verifyGate"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); });
  const card = async (name) => {
    await page.evaluate((n) => MEDDB.openComposition(n), name);
    await page.waitForTimeout(2500);
    return page.evaluate(() => { const b = document.querySelector(".db-fig"); return b ? { d: (/d=(\d)/.exec(b.getAttribute("data-q")) || [])[1] || "0", n: b.getAttribute("data-f") } : null; });
  };
  const m = await card("Metoprolol"); ok(m && m.d === "2", "metoprolol: card, preset beta-1 selective " + JSON.stringify(m));
  const p = await card("Propranolol"); ok(p && p.d === "1", "propranolol: card, preset non-selective");
  const c = await card("Carvedilol"); ok(c && c.d === "1", "carvedilol: card");
  const a = await card("Paracetamol"); ok(a === null, "paracetamol: no card");

  // the same figure from a question's explanation (study mode shows the verdict and the explanation at once)
  await page.evaluate(() => { const o = document.getElementById("dbOverlay"); if (o) o.classList.remove("on"); document.body.classList.remove("db-lock"); });
  await page.evaluate(() => { localStorage.setItem("smd_prep", "1"); localStorage.setItem("smd_prep_v1", JSON.stringify({ v: 1, pl: { ob: 1, exam: "neet-pg", date: "2027-05-01", min: 60, rem: 0 } })); });
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.PREP_LOADER && window.SMD_FIG, null, { timeout: 30000 });
  await page.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash", "verifyGate"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); });
  await page.evaluate(async () => {
    const P = await PREP_LOADER.load();
    const mk = (id, q, o, exp) => ({ id, q, o, a: 1, exp, d: 2, t: "x", _s: "pharmacology", _m: "phm-x" });
    P.open();
    await new Promise((r) => setTimeout(r, 1500));
    (window.PREP && window.PREP._host ? window.PREP._host : P._host).run([mk("t1", "A man with heart failure on metoprolol develops asthma. What should be changed?", ["Add salbutamol", "Switch to a non-beta-blocker", "Increase the dose", "Add digoxin"], "Selective drugs can lose selectivity."), mk("t2", "Which drug blocks calcium channels?", ["Amlodipine", "Verapamil", "Atenolol only", "Digoxin"], "Verapamil.")], "study", "Figures test");
  });
  await page.waitForTimeout(500);
  await page.waitForSelector('#smdPrep [data-act="answer"]', { timeout: 15000 });
  await page.evaluate(() => document.querySelector('#smdPrep [data-act="answer"][data-k="0"]').click());
  await page.waitForSelector(".pn-fb", { timeout: 15000 });
  const q1 = await page.evaluate(() => { const c = document.querySelector(".pn-figchip"); return c ? { f: c.getAttribute("data-f"), q: c.getAttribute("data-q") } : null; });
  ok(q1 && q1.f === "beta-blockers" && /d=2/.test(q1.q), "MCQ explanation: the figure chip shows for a metoprolol question " + JSON.stringify(q1));
  await page.evaluate(() => document.querySelector(".pn-figchip").click());
  await page.waitForSelector(".smdfig iframe", { timeout: 5000 });
  ok(true, "the chip opens the figure over the question");
  await page.keyboard.press("Escape");
  const q2 = await page.evaluate(() => { const nx = document.querySelector("[data-act=next]"); if (nx) nx.click(); return true; });
  await page.waitForTimeout(800);
  await page.waitForSelector('#smdPrep [data-act="answer"]', { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => { const b = document.querySelector('#smdPrep [data-act="answer"][data-k="0"]'); if (b) b.click(); });
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => { const c = document.querySelector(".pn-figchip"); return !!c && c.getAttribute("data-f") === "calcium-channel-blockers"; }), "the next question (verapamil) shows the calcium channel blocker figure, not the beta-blocker one");
  await page.evaluate(() => { const c = document.querySelector("[data-act=back]"); });

  // a Knowledge Library article whose treatment text names beta-blockers
  await page.evaluate(() => { const b = document.querySelector('#smdPrep [data-act="back"]'); });
  await page.evaluate(() => { try { SMD_REASON.openRef("heart_failure_management", { from: "prep" }); } catch (e) { window.__kbErr = String(e); } });
  await page.waitForTimeout(2500);
  const kb = await page.evaluate(() => { const c = document.querySelector("#dxMgmt .kbr-figchip"); return c ? { f: c.getAttribute("data-f"), vis: c.offsetWidth > 0 } : (window.__kbErr || "none"); });
  ok(kb && (kb.f === "beta-blockers" || kb.f === "heart-failure-drugs") && kb.vis, "Knowledge Library article (heart failure): the figure row shows " + JSON.stringify(kb));
  if (kb && kb.f) { await page.evaluate(() => document.querySelector("#dxMgmt .kbr-figchip").click()); await page.waitForSelector(".smdfig iframe", { timeout: 5000 }); ok(true, "the KB chip opens the figure"); await page.keyboard.press("Escape"); }

  for (const dark of [true, false]) {
    await page.evaluate((dk) => { document.body.classList.toggle("dark", dk); }, dark);
    await card("Metoprolol");
    await page.evaluate(() => document.querySelector(".db-fig").click());
    await page.waitForSelector(".smdfig iframe", { timeout: 5000 });
    const src = await page.evaluate(() => document.querySelector(".smdfig iframe").getAttribute("src"));
    ok(dark ? !/-light/.test(src) : /-light\.html/.test(src), (dark ? "dark" : "light") + " build opens: " + src);
    const fr = page.frames().find((f) => /beta-blockers/.test(f.url()));
    await fr.waitForFunction(() => document.querySelector("[data-readout]") && document.getElementById("drug"), null, { timeout: 10000 });
    const st = await fr.evaluate(() => ({ drug: document.getElementById("drug").value, ro: document.querySelector("[data-readout]").textContent, theme: document.body.getAttribute("data-theme") || document.documentElement.getAttribute("data-theme"), name: /Metoprolol/.test(document.body.innerText) }));
    ok(st.drug === "2" && st.name, "figure is preset to beta-1 selective and names the drug " + JSON.stringify(st));
    ok(/heart .* airway /.test(st.ro), "readout shows heart and airway: " + st.ro);
    await fr.evaluate(() => { const d = document.getElementById("drug"); d.value = "1"; d.dispatchEvent(new Event("change")); const l = document.getElementById("level"); l.value = "1"; l.dispatchEvent(new Event("input")); });
    ok(await fr.evaluate(() => document.querySelector("[data-readout]").textContent) === "heart baseline · airway baseline", "non-selective at stress: both baseline");
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".smdfig")).backgroundColor);
    ok(dark ? /17, 17, 17/.test(bg) : /246, 247, 245/.test(bg), "sheet background matches the theme: " + bg);
    if (SHOTS) await page.screenshot({ path: SHOTS + "/beta-" + (dark ? "dark" : "light") + ".png" });
    await page.keyboard.press("Escape");
    ok(await page.evaluate(() => !document.querySelector(".smdfig") && !SMD_FIG.isOpen()), "Escape closes it");
    await page.evaluate(() => document.querySelector(".db-fig").click());
    await page.waitForSelector(".smdfig-x"); await page.click(".smdfig-x");
    ok(await page.evaluate(() => !document.querySelector(".smdfig")), "Close button closes it");
  }
  ok(errs.length === 0, "no uncaught errors" + (errs.length ? ": " + errs.slice(0, 2).join(" | ") : ""));
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { await browser.close(); if (serve) serve.kill(); process.exit(fails ? 1 : 0); }
