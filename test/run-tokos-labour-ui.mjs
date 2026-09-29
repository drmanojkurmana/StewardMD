// test/run-tokos-labour-ui.mjs: headless check of the labour room simulator screen (tokos-sim-labour.js).
// Starts an MBBS labour, advances time, takes actions, opens "See a CTG like this" and comes back, reaches the debrief,
// switches to Hindi (numerals stay ASCII), then a Resident labour: one free trial, then the paywall.
// SHOTS=<dir> also writes EN/HI dark/paper screenshots at 390 x 844.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8993/").replace(/\/?$/, "/");
const PORT = 9393, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/tokos-labour-ui-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.SHOTS || "";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8993"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
// A server another session left on this port may serve a different tree: refuse to test it.
if ((await fetch(BASE + "tokos-sim-labour.js").then((r) => r.status, () => 0)) !== 200) { console.log("FAIL " + BASE + " does not serve this tree (set BASE to a free port)"); process.exit(1); }
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
async function shot(name) {
  if (!SHOTS) return;
  await sleep(250);
  const r = await call("Page.captureScreenshot", { format: "png" });
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64"));
}
const theme = (dark) => ev(`document.body.classList.toggle("dark", ${dark}); return 1;`);
const lang = async (want) => { if ((await ev(`return document.getElementById('smdTokos').getAttribute('lang')||'en';`)) !== want) { await click("[data-act=lang]"); await until(`return (document.getElementById('smdTokos').getAttribute('lang')||'en')==='${want}';`); } };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  await until(`return !!window.TOKOS_LOADER;`, 15000); await ev(`TOKOS_LOADER.load(); return 1;`);
  ok(await until(`return !!(window.TOKOS && TOKOS._internal && window.TOKOS_LABOUR_UI);`, 15000), "engine and the labour screen load on demand");
  // tokos/models.json is filled at integration; load the model the way the loader would, then sync the registries.
  await ev(`var s=document.createElement('script'); s.src='/tokos-models/drill-labour.js?v='+TOKOS_LOADER.V; s.onload=function(){TOKOS._syncModels();window.__m=1;}; document.head.appendChild(s); return 1;`);
  ok(await until(`return window.__m===1 && TOKOS._sims.some(function(x){return x.id==='labour' && !x.pending;});`), "labour sim registered, placeholder replaced");

  await ev(`try{localStorage.removeItem("smd_tokos_v1");}catch(e){} localStorage.setItem("smd_tokos_prefs", JSON.stringify({level:"mbbs",lang:"en",tab:"test"})); window.SMD_PRO_NOTICE={show:function(){window.__paywall=(window.__paywall||0)+1;}}; document.body.innerHTML='<div id="smdTokos"></div>'; TOKOS.open(); return 1;`);
  ok(await until(`return !!document.querySelector('[data-act=sim][data-s=labour]');`), "Test hub lists the labour room");
  ok(await ev(`return !/next update/i.test(document.querySelector('[data-act=sim][data-s=labour]').textContent);`) === true, "hub row no longer says the screen is coming");
  await click("[data-act=sim][data-s=labour]");
  ok(await until(`return document.querySelectorAll('[data-act=labgo]').length===7;`), "picker shows 7 labours");
  ok(await ev(`var r=document.querySelectorAll('[data-act=labgo]'); var res=[].filter.call(r,function(b){return /obstructed|compromise|tachysystole/.test(b.getAttribute('data-s'));}); return res.length===3 && res.every(function(b){return /1 free try/.test(b.textContent);});`) === true, "Resident labours carry the 1 free try badge");
  ok(await ev(`return !document.querySelector('[data-act=labgo][data-s=normal-primi] .sp-pro');`) === true, "MBBS labours are free");
  await theme(true); await shot("picker-en-dark");

  // MBBS run
  await click('[data-act=labgo][data-s="normal-primi"]');
  ok(await until(`return !!document.querySelector('.lb-chart svg') && !!document.querySelector('.lb-fig');`), "run screen draws the chart and the CTG class");
  ok(await ev(`return /0 h 00 min/.test(document.querySelector('.lb-clock b').textContent);`) === true, "clock starts at 0 h 00 min");
  ok(await ev(`return document.querySelector('[data-act=labact][data-k=instrumental]').disabled && !document.querySelector('[data-act=labact][data-k=position]').disabled;`) === true, "actions follow model.actions: vacuum off, positioning on");
  ok(await ev(`return [].every.call(document.querySelectorAll('.lb-act,.lb-waits .sp-btn'),function(b){var r=b.getBoundingClientRect();return r.height>=44;});`) === true, "action and wait targets are at least 44 px tall");
  ok(await ev(`return document.documentElement.scrollWidth<=390 && document.querySelector('.lb-chart').getBoundingClientRect().right<=390;`) === true, "no horizontal overflow at 390 px");
  await click('[data-act=labwait][data-k="60"]');
  ok(await until(`return /1 h 00 min/.test(document.querySelector('.lb-clock b').textContent);`), "waiting 1 hour advances the clock");
  ok(await ev(`return document.querySelectorAll('.lb-dil').length===1 && document.querySelector('.lb-dil').getAttribute('points').split(' ').length===13;`) === true, "chart has a point every 5 minutes");
  await click('[data-act=labact][data-k=position]');
  ok(await until(`return document.querySelector('[data-act=labact][data-k=position]').disabled && /left side/i.test(document.querySelector('.lb-feed li.new').textContent);`), "action gives feedback and disables itself");
  await shot("run-en-dark"); await theme(false); await shot("run-en-paper");

  // See a CTG like this, then back to the same labour
  const clock = await ev(`return document.querySelector('.lb-clock b').textContent;`);
  ok(await ev(`return !!document.querySelector('[data-act=labctg]');`) === true, "'See a CTG like this' is offered");
  await click("[data-act=labctg]");
  ok(await until(`return !!document.getElementById('tokTrace');`), "opens a CTG clinic case of the same FIGO class");
  await ev(`TOKOS.back(); return 1;`);
  ok(await until(`return !!document.querySelector('.lb-clock') && document.querySelector('.lb-clock b').textContent===${JSON.stringify(clock)};`), "Back returns to the same labour at the same time");

  // a birth decision needs a second tap; waiting disarms it
  await click('[data-act=labact][data-k=caesarean]');
  ok(await until(`return /Confirm: Caesarean/.test(document.querySelector('[data-act=labact][data-k=caesarean]').textContent) && !document.querySelector('.lb-verdict');`), "Caesarean asks for a second tap before ending the labour");
  await click('[data-act=labwait][data-k="15"]');
  ok(await until(`return document.querySelector('[data-act=labact][data-k=caesarean]').textContent==='Caesarean';`), "waiting disarms the confirm");
  // run to birth
  for (let i = 0; i < 30; i++) { if (await ev(`return !!document.querySelector('.lb-verdict');`)) break; await click('[data-act=labwait][data-k="60"]'); await sleep(40); }
  ok(await until(`return !!document.querySelector('.lb-verdict');`), "labour reaches the debrief");
  ok(await ev(`return /Spontaneous vaginal birth/.test(document.querySelector('.lb-born').textContent) && document.querySelectorAll('.lb-learn li').length>0 && document.querySelectorAll('.lb-done .tl-refs li').length===4;`) === true, "debrief: mode, teaching points and 4 sources");
  ok(await ev(`var st=JSON.parse(localStorage.getItem('smd_tokos_v1')); return st.sims && st.sims.labour && st.sims.labour.n===1 && Object.keys(st.cards||{}).some(function(k){return /labour/.test(k);});`) === true, "run recorded in store.sims and as an FSRS card");
  await shot("debrief-en-paper");

  // Hindi: numerals ASCII
  await lang("hi");
  ok(await ev(`var r=document.getElementById('smdTokos'); return r.getAttribute('lang')==='hi' && /[\\u0900-\\u097F]/.test(r.textContent) && !/[\\u0966-\\u096F]/.test(r.textContent);`) === true, "debrief in Hindi keeps ASCII numerals");
  await theme(true); await shot("debrief-hi-dark");
  await click("[data-act=labrerun]");
  ok(await until(`return !!document.querySelector('.lb-clock');`), "Run again starts a new labour");
  await click('[data-act=labwait][data-k="30"]');
  ok(await until(`return /0 घंटे 30 मिनट/.test(document.querySelector('.lb-clock b').textContent);`), "Hindi clock reads 0 घंटे 30 मिनट");
  ok(await ev(`return !/[\\u0966-\\u096F]/.test(document.getElementById('smdTokos').textContent) && !/[\\u0966-\\u096F]/.test(document.querySelector('.lb-chart svg').getAttribute('aria-label'));`) === true, "run screen in Hindi keeps ASCII numerals (text and chart label)");
  await shot("run-hi-dark"); await theme(false); await shot("run-hi-paper");
  await lang("en");

  // Resident: locked with one trial, then the paywall
  await ev(`TOKOS.back(); return 1;`);
  ok(await until(`return document.querySelectorAll('[data-act=labgo]').length===7;`), "Back from a run returns to the picker");
  await click('[data-act=labgo][data-s="obstructed"]');
  ok(await until(`return !!document.querySelector('.lb-clock');`), "Resident labour runs on the free trial");
  ok(await ev(`return /Obstructed labour/.test(document.querySelector('.sp-title b').textContent);`) === true, "the obstructed labour is running");
  for (let i = 0; i < 5; i++) { await click('[data-act=labwait][data-k="60"]'); await sleep(40); }
  ok(await until(`return !!document.querySelector('.lb-f.suspicious, .lb-f.pathological') && !!document.querySelector('.lb-fig.suspicious, .lb-fig.pathological');`), "obstruction course turns the CTG strip and chip abnormal");
  await theme(true); await shot("run-resident-en-dark"); await theme(false); await shot("run-resident-en-paper");
  await ev(`TOKOS.back(); return 1;`);
  ok(await until(`return /Trial used/.test(document.querySelector('[data-act=labgo][data-s=obstructed]').textContent);`), "badge now says Trial used");
  await click('[data-act=labgo][data-s="compromise"]');
  await sleep(200);
  ok(await ev(`return window.__paywall===1 && !document.querySelector('.lb-clock');`) === true, "spent trial opens the paywall, no run");
  await shot("picker-trial-used-en-dark");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
} catch (e) {
  console.log("FAIL harness: " + (e && e.stack || e)); fails++;
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill(); if (serveProc) serveProc.kill();
}
console.log(fails ? `\n${fails} FAILED` : "\nALL GREEN");
process.exit(fails ? 1 : 0);
