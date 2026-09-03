/* Government Health Schemes CDP test (real headless Chrome, real app, real API + local D1).
 * Requires (started by this script's caller, not this file):
 *   npx wrangler pages dev . --port 8790 --compatibility-date=2025-01-01 -b SITE_ALLOW_WEB=1
 *   with local D1 stewardmd-govschemes seeded (schema + hbp migration + jurisdictions + one
 *   state's packages, e.g. bihar_hbp2022.sql).
 * Asserts:
 *   (a) window.SMD_GOVSCHEMES_FLAGS.bool("smd_govt_schemes") true with ?gs=1, false without
 *   (b) the "Govt Schemes" entry in the Add Tool sheet is present with ?gs=1, absent without
 *       (defOn:false like "hospital" - it never appears on the main grid until enabled, so
 *       presence is checked in the eligible-tools list, the actual gate homeToolEligible() reads)
 *   (c) fetch("/api/schemes/jurisdictions") returns Bihar with packages>0
 *   (d) fetch("/api/schemes/search?q=mastectomy") returns a row with treatment_code SG075B, rate_tier "Tier 2"
 *   (e) clicking the tile opens the overlay; typing "mastectomy" renders a row showing SG075B + Tier 2
 *   (f) tapping the row opens the detail panel containing "Unverified"
 *   (g) the overlay's Back control has aria-label starting with "Back"
 * USAGE: node test/run-govschemes-ui.mjs   (wrangler pages dev must already be running on :8790)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 8790, DBG = 9393, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/govschemes-ui-chrome";
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=1100,900"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const evA = async (e) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return '__ERR__'+(x&&x.message||x)}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

async function navigate(url) {
  await call("Page.navigate", { url });
  for (let i = 0; i < 60; i++) { await sleep(150); const r = await ev(`return document.readyState;`); if (r === "complete") break; }
  // Give the deferred module scripts (home.js, govschemes-flags.js, govschemes.js) time to run.
  for (let i = 0; i < 40; i++) { await sleep(150); const r = await ev(`return !!(window.SMD_GOVSCHEMES_FLAGS && document.getElementById("homeV2"));`); if (r) break; }
  await sleep(300);
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});

  // ---- (a)/(b) flag OFF, tile absent: plain load, no ?gs=1 ----
  await navigate(BASE);
  ok(await ev(`return !!(window.SMD_GOVSCHEMES_FLAGS);`) === true, "govschemes-flags.js loaded (window.SMD_GOVSCHEMES_FLAGS present)");
  ok(await ev(`return window.SMD_GOVSCHEMES_FLAGS.bool("smd_govt_schemes");`) === false, "(a) flag OFF without ?gs=1");
  ok(await ev(`return typeof window.SMD_GOVSCHEMES;`) === "object", "govschemes.js loaded (window.SMD_GOVSCHEMES present)");
  await ev(`document.querySelector('[data-act="customizetools"]').click(); return 1;`);
  await sleep(200);
  ok(await ev(`return !document.querySelector('#hvSheet [data-tool="govschemes"]');`) === true, "(b) Govt Schemes entry ABSENT from Add Tool sheet without ?gs=1");
  await ev(`document.getElementById("hvScrim").click(); return 1;`);
  await sleep(150);

  // ---- (a)/(b) flag ON, tile present: reload with ?gs=1 ----
  await navigate(BASE + "?gs=1");
  ok(await ev(`return window.SMD_GOVSCHEMES_FLAGS.bool("smd_govt_schemes");`) === true, "(a) flag ON with ?gs=1");
  await ev(`document.querySelector('[data-act="customizetools"]').click(); return 1;`);
  await sleep(200);
  const gsRow = await ev(`var r=document.querySelector('#hvSheet [data-tool="govschemes"]'); return r ? r.textContent : null;`);
  ok(!!gsRow && /Govt Schemes/.test(gsRow), `(b) Govt Schemes entry PRESENT in Add Tool sheet with ?gs=1 (row: ${JSON.stringify(gsRow)})`);
  // Enable it so it renders on the main grid, then close the sheet.
  await ev(`document.querySelector('#hvSheet [data-tool="govschemes"]').click(); return 1;`);
  await sleep(150);
  await ev(`document.getElementById("hvScrim").click(); return 1;`);
  await sleep(200);

  // ---- (c) jurisdictions API ----
  const jurJson = await evA(`var r=await fetch('/api/schemes/jurisdictions'); return JSON.stringify(await r.json());`);
  let jur = null; try { jur = JSON.parse(jurJson); } catch (e) {}
  const bihar = jur && Array.isArray(jur.jurisdictions) && jur.jurisdictions.find(j => j.id === "bihar");
  ok(!!bihar && bihar.packages > 0, `(c) /api/schemes/jurisdictions returns Bihar with packages>0 (got ${bihar && bihar.packages})`);

  // ---- (d) search API ----
  const searchJson = await evA(`var r=await fetch('/api/schemes/search?q=mastectomy'); return JSON.stringify(await r.json());`);
  let search = null; try { search = JSON.parse(searchJson); } catch (e) {}
  const hit = search && Array.isArray(search.results) && search.results.find(r => r.treatment_code === "SG075B");
  ok(!!hit && hit.rate_tier === "Tier 2", `(d) /api/schemes/search?q=mastectomy returns SG075B @ Tier 2 (got ${hit && JSON.stringify({ code: hit.treatment_code, tier: hit.rate_tier })})`);

  // ---- (e) open overlay via the real tile, search UI ----
  const tileClicked = await ev(`var b=document.querySelector('.rnav-tile[data-act="govschemes"]'); if(b){b.click(); return true;} return false;`);
  ok(tileClicked === true, "(e) Govt Schemes tile clicked on the home grid");
  await sleep(200);
  ok(await ev(`return document.getElementById("gsOverlay") && document.getElementById("gsOverlay").classList.contains("on");`) === true, "(e) overlay opened (#gsOverlay.on)");
  await ev(`var i=document.getElementById("gsSearch"); i.value="mastectomy"; i.dispatchEvent(new Event("input")); return 1;`);
  let resultsText = "";
  for (let i = 0; i < 20; i++) { await sleep(150); resultsText = (await ev(`return document.getElementById("gsResults").textContent || "";`)) || ""; if (/SG075B/.test(resultsText)) break; }
  ok(/SG075B/.test(resultsText) && /Tier 2/.test(resultsText), `(e) search results show SG075B and Tier 2 (got: ${resultsText.slice(0, 200).replace(/\s+/g, " ")})`);

  // ---- (f) tap the row -> detail panel ----
  const rowClicked = await ev(`var c=[].slice.call(document.querySelectorAll(".gs-card")).find(function(x){return /SG075B/.test(x.textContent);}); if(c){c.click(); return true;} return false;`);
  ok(rowClicked === true, "(f) SG075B result row clicked");
  let detailText = "";
  for (let i = 0; i < 20; i++) { await sleep(150); detailText = (await ev(`return document.getElementById("gsBody").textContent || "";`)) || ""; if (/Unverified/.test(detailText)) break; }
  ok(/Unverified/.test(detailText), `(f) detail panel contains "Unverified" (got: ${detailText.slice(0, 200).replace(/\s+/g, " ")})`);

  // ---- (g) Back control aria-label ----
  const backLabel = await ev(`var b=document.getElementById("gsBack"); return b ? b.getAttribute("aria-label") : null;`);
  ok(!!backLabel && backLabel.indexOf("Back") === 0, `(g) Back control aria-label starts with "Back" (got ${JSON.stringify(backLabel)})`);

  console.log(fails ? ("\n" + fails + " FAILED") : "\nALL PASS");
} catch (e) {
  console.log("FAIL harness error: " + (e && e.stack || e)); fails++;
} finally {
  try { ws && ws.close(); } catch {} try { chrome.kill(); } catch {}
  process.exit(fails ? 1 : 0);
}
