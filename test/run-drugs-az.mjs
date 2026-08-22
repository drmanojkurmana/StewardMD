/* Drugs Database → A-to-Z molecule browse (api.js / window.MEDDB).
 *
 * The Drugs Database opened to a bare search box ("Type at least 3 letters…") and read as empty.
 * It now lands on an A-Z browse of MOLECULE names — composition only, no brand names — served by
 * the worker's /compositions endpoint, degrading to the on-device formulary when that endpoint
 * isn't reachable. Proves: the A-Z strip renders and the default letter loads; rows show
 * composition names and never brand names; switching a letter refetches; "Show more" pages;
 * searching replaces the browse and clearing the query returns to it; and an API failure falls
 * back to the offline list rather than an empty screen.
 *
 * The API is stubbed at fetch level (the live D1 endpoint is prod-only).
 * USAGE: BASE=http://localhost:8902/ node test/run-drugs-az.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9396, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/drugs-az-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8902"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

// Stub the drug API: /compositions pages A (2 pages) and B, /search returns one molecule.
const STUB = `
  window.__api = [];
  window.__apiFail = false;
  var realFetch = window.fetch.bind(window);
  window.fetch = function (u, o) {
    var s = String(u);
    if (s.indexOf("api.stewardmd.in") < 0) return realFetch(u, o);
    window.__api.push(s);
    if (window.__apiFail) return Promise.reject(new Error("offline"));
    var J = function (obj) { return Promise.resolve({ ok: true, json: function () { return Promise.resolve(obj); } }); };
    if (s.indexOf("/compositions") >= 0) {
      var L = (s.match(/letter=([A-Z])/) || [,"A"])[1], off = +((s.match(/offset=(\\d+)/) || [,0])[1]);
      if (L === "A" && off === 0) return J({ letter:"A", count:2, more:true, results:[
        { composition:"Amoxycillin", brands:1517, class:"antibiotic" },
        { composition:"Atorvastatin", brands:1598, class:"statin" }] });
      if (L === "A") return J({ letter:"A", count:1, more:false, results:[{ composition:"Azithromycin", brands:900, class:"antibiotic" }] });
      if (L === "B") return J({ letter:"B", count:1, more:false, results:[{ composition:"Budesonide", brands:120, class:"steroid" }] });
      return J({ letter:L, count:0, more:false, results:[] });
    }
    if (s.indexOf("/search") >= 0) return J({ query:"pan", count:1, results:[{ composition:"Pantoprazole", class:"ppi", brands:900 }] });
    if (s.indexOf("/brand-search") >= 0) return J({ query:"pan", count:1, results:[{ brand:"Pantocid 40 Tablet", composition:"Pantoprazole", manufacturer:"Sun", form:"Tablet", mrp:120 }] });
    if (s.indexOf("/health") >= 0) return J({ ok:true, rows:412224 });
    return J({});
  };
`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Page.addScriptToEvaluateOnNewDocument", { source: STUB });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.MEDDB && MEDDB.openList)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("MEDDB not loaded");
  await ev(`["smdBootSplash","introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);

  // 1) the landing view is the A-Z browse, not an empty search box
  await ev(`MEDDB.openList(); return 1;`); await sleep(600);
  const L = JSON.parse(await ev(`
    var r=document.getElementById('dbResults');
    return JSON.stringify({ strip: r.querySelectorAll('[data-az]').length,
      onLetter: (r.querySelector('.db-azb.on')||{}).textContent || "",
      names: Array.prototype.map.call(r.querySelectorAll('.db-comp-name'), function(n){return n.textContent;}),
      typeHint: /Type at least 3 letters/.test(r.textContent),
      called: window.__api.filter(function(u){return u.indexOf('/compositions')>=0;}).length });`));
  ok(L.strip === 26, "an A-Z strip of all 26 letters renders on the landing view");
  ok(L.typeHint === false, "the old \"Type at least 3 letters…\" empty state is gone");
  ok(L.onLetter === "A" && L.called >= 1, "the default letter (A) loads from the drug database");
  ok(L.names.join("|") === "Amoxycillin|Atorvastatin", "rows list molecule/composition names A-Z");

  // 2) composition names only — no brand names anywhere in the browse list
  const NB = await ev(`
    var r=document.getElementById('dbResults').textContent;
    return JSON.stringify({ brandy: /Pantocid|Augmentin|Novamox|Mox\\b|Atorlip/i.test(r), cls: /antibiotic|statin/i.test(r) });`);
  ok(JSON.parse(NB).brandy === false, "the A-Z list shows NO brand names (composition only, as asked)");
  ok(JSON.parse(NB).cls === true, "each molecule still shows its drug class as a subtitle");

  // 3) "Show more" pages within the letter
  await ev(`var b=document.getElementById('dbAzMore'); if(b) b.click(); return 1;`); await sleep(500);
  const M = JSON.parse(await ev(`
    var r=document.getElementById('dbResults');
    return JSON.stringify({ names: Array.prototype.map.call(r.querySelectorAll('.db-comp-name'), function(n){return n.textContent;}),
      more: !!r.querySelector('#dbAzMore') });`));
  ok(M.names.join("|") === "Amoxycillin|Atorvastatin|Azithromycin", "Show more appends the next page for that letter");
  ok(M.more === false, "Show more disappears when the letter has no further pages");

  // 4) switching a letter loads that letter
  await ev(`document.querySelector('[data-az="B"]').click(); return 1;`); await sleep(500);
  const B = JSON.parse(await ev(`
    var r=document.getElementById('dbResults');
    return JSON.stringify({ on:(r.querySelector('.db-azb.on')||{}).textContent, names: Array.prototype.map.call(r.querySelectorAll('.db-comp-name'), function(n){return n.textContent;}) });`));
  ok(B.on === "B" && B.names.join("|") === "Budesonide", "tapping a letter loads that letter's molecules");

  // 5) searching replaces the browse; clearing the query brings it back
  await ev(`var i=document.getElementById('dbSearch'); i.value="pan"; i.dispatchEvent(new Event('input')); return 1;`); await sleep(700);
  ok(await ev(`return /Pantoprazole/.test(document.getElementById('dbResults').textContent) && !document.querySelector('#dbResults [data-az]');`) === true, "typing a query shows search results instead of the A-Z browse");
  await ev(`var i=document.getElementById('dbSearch'); i.value=""; i.dispatchEvent(new Event('input')); return 1;`); await sleep(700);
  ok(await ev(`return document.querySelectorAll('#dbResults [data-az]').length === 26;`) === true, "clearing the query returns to the A-Z browse");

  // 6) API unreachable → on-device formulary, never an empty screen
  await ev(`window.__apiFail = true; document.querySelector('[data-az="P"]').click(); return 1;`); await sleep(700);
  const OFF = JSON.parse(await ev(`
    var r=document.getElementById('dbResults');
    return JSON.stringify({ n: r.querySelectorAll('.db-comp-name').length, offline: /offline list/i.test(r.textContent),
      names: Array.prototype.map.call(r.querySelectorAll('.db-comp-name'), function(n){return n.textContent;}).slice(0,3) });`));
  ok(OFF.n > 0 && OFF.offline === true, "when the drug API is unreachable it falls back to the on-device formulary (" + OFF.names.join(", ") + ")");

  console.log(fails === 0 ? "\nALL GREEN — Drugs Database A-Z browse test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
