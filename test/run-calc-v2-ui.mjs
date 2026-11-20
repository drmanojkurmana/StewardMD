/* Calculators v2: full-screen calculator, live score card, auto-fill, Ask MaiK.
 * node test/run-calc-v2-ui.mjs */
import { spawn } from "node:child_process";
import http from "node:http";
import { existsSync, readFile } from "node:fs";
import { extname, join, normalize } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("../", import.meta.url));
const CHROME = process.env.CHROME || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => existsSync(p));
const PORT = 9097, CDP = 9497;
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.startsWith("/api/")) { res.writeHead(404, { "content-type": "application/json" }); res.end('{"error":"not_found"}'); return; }
  const fp = join(repo, normalize(p === "/" ? "/index.html" : p).replace(/^(\.\.[/\\])+/, ""));
  readFile(fp, (err, data) => { if (err) { res.writeHead(404); res.end("404"); return; } res.writeHead(200, { "content-type": TYPES[extname(fp)] || "application/octet-stream" }); res.end(data); });
}).listen(PORT);
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${CDP}`, `--user-data-dir=/tmp/calcv2-chrome-${process.pid}`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let ws, sid, id = 0, failures = 0; const pending = new Map();
const call = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params, sessionId: sid })); });
const ev = async (expression) => { const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result?.result?.value; };
const ok = (pass, label) => { console.log(`${pass ? "PASS" : "FAIL"} ${label}`); if (!pass) failures++; };
const until = async (expr, ms = 10000) => { for (let t = 0; t < ms; t += 100) { try { if (await ev(expr)) return true; } catch { } await sleep(100); } return false; };
try {
  let version; for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(version.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const created = await call("Target.createTarget", { url: "about:blank" });
  sid = (await call("Target.attachToTarget", { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call("Page.navigate", { url: `http://localhost:${PORT}/` });
  ok(await until(`!!(window.MEDCALC&&window.ICONS&&document.querySelector('#homeV2'))`, 30000), "app loaded");
  await ev(`localStorage.removeItem("smd_calc_v2"); window.MEDCALC.openList(); 1`);
  ok(await until(`!!document.querySelector('#mcList .mc-card')`), "v2 list rendered");
  ok(await ev(`document.getElementById('mcOverlay').classList.contains('mc-v2')`), "v2 flag on by default");
  await ev(`window.__maikQ=""; window.SMD_askMaik=function(q){ window.__maikQ=q; }; window.ICU_STATE={ patient:{name:"Test Person",age:72,sex:"M",weightKg:70,heightCm:170}, vitals:[{ts:Date.now(),hr:95,sbp:115,dbp:75,rr:18,spo2:98,temp:37,gcs:15}], labs:{recent:{hb:10}}, src:{} }; 1`);
  await ev(`window.MEDCALC.open("oakland_lgib"); 1`);
  ok(await until(`!!document.getElementById('mcScore_oakland_lgib')`), "calculator opens full-screen with score card");
  ok(/Answer \d+ more/.test(await ev(`document.querySelector('#mcScore_oakland_lgib .mc-score-main').textContent`)), "score card says Answer N more before inputs");
  await ev(`document.getElementById('mcAuto_oakland_lgib').click(); 1`); await sleep(300);
  const filled = await ev(`(['age','hb','hr','sbp'].map(function(k){return document.getElementById('mc_oakland_lgib_'+k).value}).join('|'))`);
  ok(filled === "72|10|95|115", `auto-fill fills mapped inputs and leaves the rest (got ${filled})`);
  ok(/Filled 5 of 7|Filled 4 of 7|Filled 6 of 7/.test(await ev(`document.getElementById('mcAFnote_oakland_lgib').textContent`)), "auto-fill reports how many were filled");
  ok(/verify each value/i.test(await ev(`document.getElementById('mcAFnote_oakland_lgib').textContent`)), "auto-fill asks to verify each value");
  await ev(`var s=document.getElementById('mc_oakland_lgib_sex'); s.value='M'; s.dispatchEvent(new Event('change',{bubbles:true})); 1`); await sleep(300);
  ok(/22/.test(await ev(`document.querySelector('#mcScore_oakland_lgib .mc-score-main').textContent`)), "score card shows the live value 22");
  await ev(`document.getElementById('mcAsk_oakland_lgib').click(); 1`); await sleep(200);
  const q = String(await ev(`window.__maikQ`));
  ok(/Oakland/.test(q) && /22/.test(q), "Ask MaiK question carries the score and result");
  ok(!/Test Person/.test(q), "Ask MaiK question has no patient name (no PHI)");
  await ev(`document.getElementById('mcScoreBar_oakland_lgib').click(); 1`); await sleep(200);
  ok(await ev(`!document.querySelector('#mcScore_oakland_lgib .mc-score-detail').hidden`), "tapping the score card expands it");
  ok(/Source:/.test(await ev(`document.querySelector('#mcScore_oakland_lgib .mc-score-detail').textContent`)), "expanded card shows the source");
  await ev(`document.getElementById('mcCvBack').click(); 1`); await sleep(200);
  ok(await until(`!!document.querySelector('#mcList .mc-card')`), "back returns to the list");
  ok((await ev(`JSON.parse(localStorage.getItem('smd_calc_recent')||'[]').indexOf('oakland_lgib')>=0`)) === true, "opening records Recent");
} catch (e) { console.log("FAIL", e.message); failures++; } finally { try { ws.close(); } catch {} chrome.kill(); server.close(); }
console.log(failures ? failures + " failed" : "all passed"); process.exit(failures ? 1 : 0);
