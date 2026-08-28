/* Calculator search: results appear immediately below the search box (2026-08-23, WhatsApp
 * feature request, with a reference screenshot of a flat "RESULTS: N" list).
 *
 * The search box already filtered live on every keystroke (an "input" listener existed) - the
 * actual gap was presentation: the category-chip row and per-category group headers stayed on
 * screen while searching, so a match could sit well below the fold instead of appearing right
 * under the search box. Active search now hides the chip row and flattens the grouping into a
 * single "Results N" list; clearing the search restores the normal browse view unchanged.
 * USAGE: node test/run-calc-search-results.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8926/").replace(/\/?$/, "/");
const PORT = 9462, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/calc-search-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8926"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.MEDCALC && MEDCALC.openList);`) === true) { ready = true; break; } }
  ok(ready, "app boots (calculators.js loaded, MEDCALC.openList present)");

  await ev(`MEDCALC.openList(); return 1;`);
  await sleep(300);
  const browse = await J(`
    var cats = document.getElementById("mcCats");
    return JSON.stringify({ catsVisible: cats.style.display !== "none", hasGroups: document.querySelectorAll("#mcList .mc-grp-h").length > 1 });
  `);
  ok(browse.catsVisible === true, "browsing (no query): category chips are visible");
  ok(browse.hasGroups === true, "browsing (no query): results are grouped by category, unchanged from before");

  // Type a query that matches several calculators across different categories (MELD-family).
  const searched = await J(`
    var si = document.getElementById("mcSearch");
    si.value = "meld"; si.dispatchEvent(new Event("input", { bubbles: true }));
    return JSON.stringify({
      catsVisible: document.getElementById("mcCats").style.display !== "none",
      groupHeaders: document.querySelectorAll("#mcList .mc-grp-h").length,
      headerText: (document.querySelector("#mcList .mc-grp-h") || {}).textContent || "",
      cardCount: document.querySelectorAll("#mcList .mc-card").length
    });
  `);
  ok(searched.catsVisible === false, "typing a query hides the category chips — results aren't buried below them");
  ok(searched.groupHeaders === 1, `exactly ONE header ("Results"), not one per matched category (${searched.groupHeaders})`);
  ok(/Results/i.test(searched.headerText) && /\d/.test(searched.headerText), `the single header names the result count (got "${searched.headerText}")`);
  ok(searched.cardCount >= 2, `multiple MELD-family calculators appear as a flat list right under the search box (${searched.cardCount})`);
  ok(searched.headerText.replace(/\D/g, "") === String(searched.cardCount), `the stated count matches the actual number of cards shown (header "${searched.headerText}" vs ${searched.cardCount} cards)`);

  // Clearing the search restores the normal browse view — this isn't a one-way mode switch.
  const cleared = await J(`
    var si = document.getElementById("mcSearch");
    si.value = ""; si.dispatchEvent(new Event("input", { bubbles: true }));
    return JSON.stringify({
      catsVisible: document.getElementById("mcCats").style.display !== "none",
      hasGroups: document.querySelectorAll("#mcList .mc-grp-h").length > 1
    });
  `);
  ok(cleared.catsVisible === true, "clearing the search brings the category chips back");
  ok(cleared.hasGroups === true, "...and restores category grouping");

  // A no-match query still shows the (existing) empty state, not a broken/empty results header.
  const noMatch = await J(`
    var si = document.getElementById("mcSearch");
    si.value = "zzzznotarealcalculator"; si.dispatchEvent(new Event("input", { bubbles: true }));
    return JSON.stringify({ empty: !!document.querySelector("#mcList .mc-empty"), groupHeaders: document.querySelectorAll("#mcList .mc-grp-h").length });
  `);
  ok(noMatch.empty === true && noMatch.groupHeaders === 0, `a no-match query shows the empty state, not an empty "Results 0" header (${JSON.stringify(noMatch)})`);

  console.log(fails === 0 ? "\nALL GREEN — calculator search results now appear as a flat, immediate list under the search box" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
