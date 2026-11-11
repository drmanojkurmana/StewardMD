/* Knowledge Library header variants (kb-head.css, reasoning.js kbHeadApply; localStorage smd_kb_head = a | b | c).
 * Each variant: brand in the bar (old title only for screen readers), no banner in the page, search placeholder names
 * the count, no label; a/c drop the hero, b keeps a smaller title; c puts the search in the bar and hides it on other
 * tabs; no variant = today's layout. USAGE: node test/run-kb-head-ui.mjs  (Playwright). SHOTS=<dir> saves screenshots. */
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
const vis = (sel) => `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;const r=e.getBoundingClientRect();return r.width>2&&r.height>2&&getComputedStyle(e).visibility!=="hidden"})()`;
try {
  for (const v of ["0", "", "a", "b", "c"]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.addInitScript(`try{localStorage.setItem("smd_kb_head", ${JSON.stringify(v)});}catch(e){}`);
    const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: "load" });
    await p.waitForFunction(() => window.SB && SB.openRef && window.SMD_kbHeadApply, null, { timeout: 30000 });
    await p.evaluate(() => { ["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(k=>document.getElementById(k)?.remove()); SB.openRef("syndromes"); });
    await p.waitForSelector("#kblibQ", { timeout: 10000 });
    await sleep(300);
    const L = v === "0" ? "old" : v || "d (default)";
    const W = await p.evaluate(() => { let o = 0; document.querySelectorAll("#sbrefOverlay *").forEach(e => { const r = e.getBoundingClientRect(); if (r.width && r.right > innerWidth + 1 && !e.closest(".sbref-tabs") && !e.closest(".kblib-try")) o++; }); return o; });
    ok(W === 0, `${L}: nothing wider than 390 px (the Try row scrolls inside itself)`);
    if (!v) ok(await p.evaluate(() => { const r = document.getElementById("kblibTry").getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1; }), `${L}: the Try row itself spans the screen exactly`);
    if (v === "0") {
      ok(await p.evaluate(vis("#sbrefTitle")) && !(await p.evaluate(vis(".kbh-brand"))), "old: the bar title, no bar brand");
      ok(await p.evaluate(vis(".kblib-discover .kblib-intro h1")) && await p.evaluate(vis(".kblib-search-label")), "old: hero and search label as before");
    } else if (!v) {
      ok(await p.evaluate(vis(".sbref-top .kbh-brand")) && !(await p.evaluate(vis("#sbrefTitle"))), `${L}: brand is the bar title`);
      ok(await p.evaluate(vis(".kblib-search-label")) && await p.evaluate(() => document.querySelector(".kblib-search-label").textContent === "Search the library"), `${L}: "Search the library" heading shown`);
      const order = await p.evaluate(() => { const y = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().top : -1; }; return [y("#kblibQ"), y("#kblibTry"), y(".kblib-intro h1"), y(".kblib-personal"), y("#kblibGrid"), y("#kblibDiscovery")]; });
      ok(order.every((t, i) => t >= 0 && (i === 0 || t > order[i - 1])), `${L}: search, Try, Find any disease, Your library, all diseases, then branches (${order.map(Math.round).join(",")})`);
      ok(await p.evaluate(() => { const t = document.getElementById("kblibTry"), b = [...t.querySelectorAll("button")]; return getComputedStyle(t).flexWrap === "nowrap" && new Set(b.map((x) => Math.round(x.getBoundingClientRect().top))).size === 1 && t.scrollWidth > t.clientWidth; }), `${L}: Try chips on one swipeable line`);
      ok(await p.evaluate(() => document.getElementById("kblibResultsTitle").textContent === "All diseases" && document.querySelectorAll("#kblibGrid > *").length >= 20), `${L}: "All diseases" list right under Your library`);
      ok(!(await p.evaluate(vis("#sbrefBody .kblib-intro .smd-kb-banner"))), `${L}: no banner inside the page`);
      await p.fill("#kblibQ", "mening"); await sleep(300);
      ok(/mening/i.test(await p.evaluate(() => (document.getElementById("kblibGrid") || {}).textContent || "")), `${L}: typing still filters the index`);
      ok(await p.evaluate(() => ["#kblibTry", ".kblib-intro", ".kblib-personal"].every((s) => getComputedStyle(document.querySelector(s)).display === "none")), `${L}: while searching only the results show`);
      await p.fill("#kblibQ", ""); await sleep(300);
      ok(await p.evaluate(() => [".kblib-intro", ".kblib-personal"].every((s) => getComputedStyle(document.querySelector(s)).display !== "none")), `${L}: clearing the search brings the page back`);
    } else {
      ok(await p.evaluate(vis(".sbref-top .kbh-brand")) && /StewardMD\s*Knowledge Base/.test(await p.evaluate(() => document.querySelector(".kbh-brand").textContent)), `${L}: brand is the bar title`);
      ok(!(await p.evaluate(vis("#sbrefTitle"))) && await p.evaluate(() => document.getElementById("sbrefTitle").textContent === "Knowledge Library"), `${L}: old title kept for screen readers only`);
      ok(!(await p.evaluate(vis("#sbrefBody .kblib-intro .smd-kb-banner"))), `${L}: no banner inside the page`);
      ok(/^Search [\d,+]+ diseases$/.test(await p.evaluate(() => document.getElementById("kblibQ").placeholder)), `${L}: placeholder names the count`);
      ok(!(await p.evaluate(vis(".kblib-search-label"))), `${L}: no "Search the library" heading`);
      ok((await p.evaluate(vis(".kblib-discover .kblib-intro h1"))) === (v === "b"), `${L}: hero ${v === "b" ? "kept small" : "removed"}`);
      if (v === "b") ok(await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".kblib-intro h1")).fontSize) <= 28), "b: title at most 28 px");
      ok(await p.evaluate(() => { const q = document.getElementById("kblibQ").getBoundingClientRect(); return q.top < 260; }), `${L}: search is in the top 260 px`);
      if (v === "c") ok(await p.evaluate(() => !!document.querySelector(".sbref-top #kblibQ")), "c: search sits in the bar");
      await p.fill("#kblibQ", "mening");
      await sleep(300);
      ok(/mening/i.test(await p.evaluate(() => (document.getElementById("kblibGrid") || {}).textContent || "")), `${L}: typing still filters the index`);
      await p.evaluate(() => SB.openRef("aware")); await sleep(500);
      ok(await p.evaluate(vis(".sbref-top .kbh-brand")) && !(await p.evaluate(vis(".sbref-top .kblib-searchbox"))), `${L}: AWaRe keeps the bar brand, no Discover search in the bar`);
      await p.evaluate(() => SB.openRef("syndromes")); await sleep(500);
      ok(await p.evaluate(() => document.querySelectorAll("#kblibQ").length === 1), `${L}: back on Syndromes, one search field`);
    }
    if (process.env.SHOTS) await p.screenshot({ path: join(process.env.SHOTS, `kbhead-${L}.png`) });
    await ctx.close();
  }
} catch (e) { console.log("FAIL harness: " + (e && e.stack || e)); fails++; }
finally { await browser.close(); serve.kill(); }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
