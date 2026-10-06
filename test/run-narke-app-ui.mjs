/* Narkē (Anaesthesia) in the REAL app (headless Chrome): only the loader at boot; stewardmd://narke opens Narkē, which
 * loads the engine on first open and asks Learn or Test; back() returns home; the Review Desk has a Narkē tab;
 * smd_narke="0" and ?narke=0 block every entry; no uncaught Narkē errors. Content phases extend the counts here.
 * USAGE: node test/run-narke-app-ui.mjs   (PORT=<free port> so it serves this checkout)
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
// BASE (a running server) or PORT (the server this harness starts) and CHROME_PORT override the defaults, so parallel sessions do not collide.
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || 8986) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || 9388), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/narke-app-chrome-" + PORT;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8986"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
// Like ev, for a promise-returning body.
const evp = async (e) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(200); } return false; };
const reqs = []; let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }   // up to 60 s: a cold CI Chrome can take over 12
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Network.requestWillBeSent") reqs.push(m.params.request.url);
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/narke|NARKE/i.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  const tile = `return !!document.querySelector('.rnav-tile[data-act=narke]');`;
  const load = async (url) => { await call("Page.navigate", { url }); await until(`return !!(window.NARKE && window.SMD_showHome);`, 30000); await ev(clean); await ev(`SMD_showHome(); return 1;`); await sleep(600); };


  await call("Page.navigate", { url: BASE }); await until(`return !!(window.NARKE && window.SMD_showHome);`, 30000);
  await ev(`try{localStorage.removeItem("smd_narke"); localStorage.removeItem("smd_narke_prefs"); localStorage.removeItem("smd_narke_v1");}catch(e){} return 1;`);
  reqs.length = 0;
  await load(BASE);
  const ENG = /\/(specialty(-(core|data|stage|shell|learn|bank|explore|tools|notes))?\.(js|css)|narke\.(js|css)|narke-models\/)/;
  ok(reqs.some((u) => /narke-loader\.js\?v=nrk1/.test(u)) && !reqs.some((u) => ENG.test(u)), "app boot loads narke-loader.js and no engine or Narkē file" + (reqs.filter((u) => ENG.test(u)).length ? ": " + reqs.filter((u) => ENG.test(u)).join(", ") : ""));
  ok(await ev(tile) === false, "while it is built, Narkē is off Home by default (available in Add Tool)");
  await ev(`SMD_openRoute("narke"); return 1;`);
  ok(await until(`return NARKE.isOpen() && !!document.getElementById("smdNarke");`, 20000), "stewardmd://narke opens the Narkē overlay");
  ok(await until(`return !!document.querySelector('#smdNarke [data-act=pick][data-t=learn]');`, 20000), "first open loads Narkē and asks Learn or Test");
  ok(await ev(`return !!window.SPECIALTY_CORE && document.getElementById("smdNarke").classList.contains("nrk-root");`) === true && reqs.some((u) => /narke\.js\?v=nrk1/.test(u)), "the engine and narke.js loaded on open, at the loader's token, under .nrk-root");
  ok(/Narkē/.test(await ev(`return document.getElementById("smdNarke").textContent;`)), "the overlay names Narkē");
  await ev(`document.querySelector('#smdNarke [data-act=pick][data-t=test]').click(); return 1;`);
  await sleep(600);
  ok(await ev(`return NARKE.isOpen() && !!document.querySelector('#smdNarke');`) === true, "the Test tab opens");
  ok(await until(`return NARKE._tools && NARKE._tools.length === 12 && NARKE._sims.length >= 12;`, 20000), "12 calculators and 12 drills are listed: " + await ev(`return [NARKE._tools && NARKE._tools.length, NARKE._sims && NARKE._sims.length].join(",");`));
  ok(await evp(`var r = await fetch("/narke/learn/index.json"); var j = await r.json(); return j.units.length === 19 && Object.keys(j.lessons).length === 93;`) === true, "Learn index lists 19 units and 93 lessons");
  ok(!/[\u2013\u2014]/.test(await ev(`return document.getElementById("smdNarke").innerText;`)), "no em or en dash on the Narkē screens");
  await ev(`NARKE.back(); NARKE.back(); NARKE.back(); return 1;`);
  ok(await until(`return !NARKE.isOpen();`, 5000), "back() closes Narkē and returns to home");

  await ev(`SMD_REVIEW.open(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdReview [data-rv-act="kind:narke"]');`, 10000), "the Review Desk has a Narkē tab");
  await ev(`document.querySelector('#smdReview [data-rv-act="kind:narke"]').click(); return 1;`);
  ok(await until(`return !/Loading/.test(document.querySelector('#smdReview .kit-sheet-body').textContent);`, 20000), "the Narkē tab loads");
  await ev(`SMD_REVIEW.close(); return 1;`);

  await ev(`localStorage.setItem("smd_narke","0"); return 1;`);
  await load(BASE);
  await ev(`SMD_openRoute("narke"); return 1;`); await sleep(500);
  ok(await ev(`return !NARKE.isOpen();`) === true, "smd_narke=0: stewardmd://narke does not open Narkē");
  await ev(`localStorage.removeItem("smd_narke"); return 1;`);
  await load(BASE + "?narke=0");
  await ev(`SMD_openRoute("narke"); return 1;`); await sleep(500);
  ok(await ev(`return !NARKE.isOpen();`) === true, "?narke=0: the route is blocked");

  ok(errors.length === 0, "no uncaught Narkē errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN: Narkē wired into the app" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
