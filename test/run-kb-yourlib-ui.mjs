/* Knowledge Library "Your library" (owner mock 2026-11-11): two rows (icon, label, count, chevron) with a hairline,
 * an empty card when both lists are empty, rows open their list in place, a viewed disease shows under Recently viewed
 * and the empty card goes. Light and dark. USAGE: node test/run-kb-yourlib-ui.mjs (Playwright). SHOTS=<dir>. */
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort } from "./free-port.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = "http://localhost:" + (await freePort()) + "/";
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require(join(execSync("npm root -g").toString().trim(), "playwright")); }
const serve = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), BASE.match(/:(\d+)/)[1]], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const browser = await pw.chromium.launch();
try {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: "load" });
    await p.waitForFunction(() => window.SB && SB.openRef && window.DX && DX.openRef, null, { timeout: 30000 });
    const open = () => p.evaluate((t) => { ["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(k=>document.getElementById(k)?.remove()); document.body.classList.toggle("dark", t === "dark"); SB.openRef("syndromes"); }, theme);
    await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (/kb.*(fav|recent)|smd_kb_(fav|recent)/i.test(k)) localStorage.removeItem(k); });
    await open(); await p.waitForSelector(".kblib-personal.kbl", { timeout: 10000 }); await sleep(300);
    const T = theme;
    const rows = await p.evaluate(() => [...document.querySelectorAll(".kbl-item > summary")].map((s) => ({ t: s.querySelector(".kbl-label").textContent, n: s.querySelector(".kbl-n").textContent, ico: !!s.querySelector(".kbl-ico svg"), chev: !!s.querySelector(".kbl-chev"), h: s.getBoundingClientRect().height })));
    ok(rows.length === 2 && rows[0].t === "Favourites" && rows[1].t === "Recently viewed", `${T}: two rows, Favourites then Recently viewed`);
    ok(rows.every((r) => r.ico && r.chev && r.h >= 44), `${T}: each row has icon, chevron, 44 pt or more`);
    ok(await p.evaluate(() => getComputedStyle(document.querySelector(".kbl-recent")).borderTopStyle === "solid"), `${T}: hairline between the rows`);
    const empty = await p.evaluate(() => { const e = document.querySelector(".kbl-empty"); return e && e.textContent; });
    if (rows[0].n === "0" && rows[1].n === "0") ok(/Your library is empty/.test(empty || "") && /Diseases you open will appear here/.test(empty), `${T}: empty card when both are 0`);
    ok(await p.evaluate(() => { let o = 0; document.querySelectorAll(".kblib-personal *").forEach((e) => { if (e.getBoundingClientRect().right > innerWidth + 1) o++; }); return o === 0; }), `${T}: fits 390 px`);
    await p.evaluate(() => document.querySelector(".kblib-personal").scrollIntoView({ block: "center" }));
    if (process.env.SHOTS) await p.screenshot({ path: join(process.env.SHOTS, `yourlib-${T}-empty.png`) });
    await p.click(".kbl-favourites > summary");
    ok(await p.evaluate(() => document.querySelector(".kbl-favourites").open && getComputedStyle(document.querySelector(".kbl-favourites .kbl-chev")).transform !== "none"), `${T}: tapping a row opens it, chevron turns`);
    // view a disease, come back: Recently viewed lists it and the empty card goes
    await p.evaluate(() => DX.openRef("MENINGITIS", { from: "knowledge-library" })); await sleep(1500);
    await p.evaluate(() => { const b = document.getElementById("dxMgmtBack"); if (b) b.click(); }); await sleep(800);
    await open(); await sleep(500);
    const n = await p.evaluate(() => document.querySelector(".kbl-recent .kbl-n").textContent);
    ok(+n >= 1 && !(await p.evaluate(() => !!document.querySelector(".kbl-empty"))), `${T}: after viewing a disease Recently viewed = ${n}, no empty card`);
    await p.click(".kbl-recent > summary");
    ok(await p.evaluate(() => /Meningitis/i.test(document.querySelector(".kbl-recent .kbl-list").textContent)), `${T}: the open row lists the disease`);
    await p.evaluate(() => document.querySelector(".kblib-personal").scrollIntoView({ block: "center" }));
    if (process.env.SHOTS) await p.screenshot({ path: join(process.env.SHOTS, `yourlib-${T}-filled.png`) });
    await ctx.close();
  }
} catch (e) { console.log("FAIL harness: " + (e && e.stack || e)); fails++; }
finally { await browser.close(); serve.kill(); }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
