/* Phase 8 P1 CDP test (real headless Chrome): the four P1 sub-features rendered end to end, with all
 * onco flags stubbed ON. Loads the REAL onco-staging.js / onco-tallman.js / onco-evidence.js /
 * onco-home.js and the REAL kb/onco/staging/*.json + kb/protocols/index.json (served from repo root).
 * Asserts:
 *   - the Staging grid card is now an ACTIVE card (P0 placeholder replaced) and opens the staging overlay
 *   - a scaffold site renders the flagged TNM framework (R1-verify flag + T/N/M tables + stage groups)
 *   - the version toggle switches to an un-seeded edition and shows the HONEST content-gap placeholder
 *   - a gap-only site renders the honest content-gap placeholder (never a fabricated table)
 *   - the onco drug view renders ISMP tall-man names (DOXOrubicin) + supportive care from MEDDRUGS
 *   - the protocol reference view renders the "DRAFT - not activated" badge (read-only)
 * USAGE: node test/run-onco-p1-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8797, DBG = 9388, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/onco-p1-ui-chrome";
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "test/onco-p1-ui-harness.html" });

  let ready = null;
  for (let i = 0; i < 60; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, "real onco-staging.js + onco-tallman.js + onco-home.js loaded into the harness");

  await ev(`window.SMD_ONCOHOME.open(); return 1;`);
  await sleep(400);   // let loadProtocols() fetch kb/protocols/index.json

  // ---- Staging: the P0 placeholder is now an ACTIVE card that opens the staging overlay ----
  const stagingCard = await ev(`return !!document.querySelector('[data-oh-act="staging-open"]');`);
  ok(stagingCard === true, "the TNM Staging card is now an active card (P0 placeholder replaced)");
  await ev(`document.querySelector('[data-oh-act="staging-open"]').click(); return 1;`);
  await sleep(400);
  ok(await ev(`return !!(document.getElementById("smdOncoStaging") && document.getElementById("smdOncoStaging").classList.contains("on"));`) === true, "clicking Staging opens the staging overlay (#smdOncoStaging)");

  const siteText = (await ev(`return document.getElementById("stgResults").textContent || "";`)) || "";
  ok(/TNM/.test(siteText) && /Gap/.test(siteText), "the site list shows both seeded TNM sites and Gap sites");
  ok(/International TNM-based cancer staging/i.test(siteText), "the intro presents neutral TNM-based staging (licensed content)");

  // ---- Open a scaffold site (breast): flagged TNM framework ----
  await ev(`document.querySelector('[data-stg-act="site:breast"]').click(); return 1;`);
  await sleep(400);
  const seeded = (await ev(`return document.getElementById("stgResults").textContent || "";`)) || "";
  ok(/licensed content/i.test(seeded), "a seeded site shows its licensed-content provenance (R1 gate removed)");
  ok(/T . primary tumour|primary tumour/i.test(seeded) && /Stage grouping/i.test(seeded), "the seeded site renders T/N/M categories and stage grouping");
  ok(/Stage II|Stage III/i.test(seeded), "the seeded site renders full site-specific stage groups (II/III present, auditor relaxed per owner directive)");
  const vbtns = await ev(`return document.querySelectorAll('.stg-vbtn').length;`);
  ok(Number(vbtns) >= 2, `a version toggle with multiple editions renders (${vbtns})`);

  // ---- Version toggle -> an un-seeded edition shows the HONEST gap ----
  await ev(`var b=Array.prototype.filter.call(document.querySelectorAll('.stg-vbtn'),function(x){return /gap/i.test(x.textContent);})[0]; if(b) b.click(); return 1;`);
  await sleep(250);
  const gapVer = (await ev(`return document.getElementById("stgResults").textContent || "";`)) || "";
  ok(/Staging for this cancer site is being added/.test(gapVer), "switching to an un-seeded edition shows the honest content-gap placeholder");

  // ---- A gap-only site shows the honest gap, never a fabricated table ----
  await ev(`document.querySelector('[data-stg-act="list"]').click(); return 1;`); await sleep(200);
  await ev(`document.querySelector('[data-stg-act="site:anus"]').click(); return 1;`); await sleep(300);
  const gapSite = (await ev(`return document.getElementById("stgResults").textContent || "";`)) || "";
  ok(/Staging for this cancer site is being added/.test(gapSite), "a gap-only site (anus, still on the crawl list) shows the honest content-gap placeholder");
  ok(!/\d\s?cm\b/.test(gapSite), "the gap card contains no fabricated measurement content");
  await ev(`document.querySelector('[data-stg-act="close"]').click(); return 1;`); await sleep(200);

  // ---- Onco drug view: tall-man antineoplastic names + supportive care from MEDDRUGS ----
  await ev(`document.querySelector('[data-oh-act="drug-browse"]').click(); return 1;`);
  await sleep(200);
  const drugView = (await ev(`return document.getElementById("ohResults").textContent || "";`)) || "";
  ok(/DOXOrubicin/.test(drugView), "the onco drug view renders the ISMP tall-man form DOXOrubicin (tall-man flag on)");
  ok(/vinCRIStine/.test(drugView) && /CISplatin/.test(drugView), "other cited ISMP tall-man forms render (vinCRIStine, CISplatin)");
  ok(/Ondansetron/.test(drugView) && /Enoxaparin/.test(drugView), "oncology supportive care is filtered in from the real MEDDRUGS formulary");
  ok(!/Amlodipine/.test(drugView), "a non-oncology formulary drug (Amlodipine) is filtered out");
  await ev(`document.querySelector('[data-oh-act="drug-interactions"]').click(); return 1;`); await sleep(80);
  ok(await ev(`return window.__medDrugsInteractionsCalls;`) === 1, "the Interaction check reuses the real MEDDRUGS.openInteractions()");
  await ev(`document.querySelector('[data-oh-act="home-dash"]').click(); return 1;`); await sleep(120);

  // ---- Protocol reference view: read-only DRAFT badge ----
  ok(await ev(`return !!document.querySelector('[data-oh-act="protoref-open"]');`) === true, "the Protocol Reference card appears (flag on)");
  await ev(`document.querySelector('[data-oh-act="protoref-open"]').click(); return 1;`);
  await sleep(200);
  const proto = (await ev(`return document.getElementById("ohResults").textContent || "";`)) || "";
  ok(/DRAFT - not activated/.test(proto), "the protocol reference shows the honest 'DRAFT - not activated' badge");
  ok(/Not for ordering or administration/i.test(proto), "the protocol reference is explicitly read-only (no ordering)");
  ok(/R-CHOP/.test(proto), "the reference lists the real protocol from kb/protocols/index.json (R-CHOP)");

  console.log(fails ? `\n${fails} check(s) failed` : "\nAll Onco P1 checks passed");
} catch (x) { console.error(x); fails++; }
finally { try { ws && ws.close(); } catch {} try { chrome.kill("SIGKILL"); } catch {} try { serveProc.kill("SIGKILL"); } catch {} if (fails) process.exitCode = 1; }
