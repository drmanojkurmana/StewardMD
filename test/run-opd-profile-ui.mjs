/* test/run-opd-profile-ui.mjs - the OPD profile sheet on a phone, in a real browser.
 *
 * Owner screenshot, 2026-09-21: "How should I close or scroll not working opd staff management".
 * The sheet is rendered by the real queue.js _render() with nine staff into the real #smdQueue root
 * with the real queue.css, at 390x844, and the harness checks the one thing that matters: the card
 * fits, it scrolls, and the X stays reachable all the way down.
 *
 * Linux: CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
 *        CHROME_FLAGS="--no-sandbox --disable-dev-shm-usage" node test/run-opd-profile-ui.mjs
 */
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || "http://localhost:8993/").replace(/\/?$/, "/");
const PORT = 9411, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/opd-profile-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8993"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.QUEUE && QUEUE._render);`) === true) { ready = true; break; } }
  ok(ready, "queue.js is loaded with the app");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);

  // Render the real sheet with nine staff into the real root, with the real stylesheet.
  const built = await ev(`
    var members=["front1","admin","cash","did","doc1","hr","pharm","stage","test"].map(function(id,i){return {identity:id, role:["reception","supervisor","cashier","nurse","doctor","hr","pharmacy","doctor","nurse"][i], hasPin:id!=="admin", active:i<6?false:true};});
    var state=Object.assign({}, QUEUE._st, {view:"dashboard", session:{id:"s1", status:"active"}, tickets:[], profileOpen:true, orgId:"org1", ghisToken:null, clinicAdmin:{code:"SMD-E6HDTF", members:members}});
    var root=document.getElementById("smdQueue"); if(!root){root=document.createElement("div"); root.id="smdQueue"; document.body.appendChild(root);}
    root.className="on"; root.style.display="block"; root.innerHTML=QUEUE._render(state);
    return !!root.querySelector(".q-profile");`);
  ok(built === true, "the profile sheet renders with nine staff rows");
  await sleep(500);
  const g = JSON.parse(await ev(`var c=document.querySelector("#smdQueue .q-profile"); var r=c.getBoundingClientRect(); var x=c.querySelector(".q-profile-x").getBoundingClientRect(); var close=c.querySelector('.q-pbtn.ghost[data-q-act="profile-close"]').getBoundingClientRect(); return JSON.stringify({top:r.top,bottom:r.bottom,ih:window.innerHeight,scrollable:c.scrollHeight>c.clientHeight+20, sh:c.scrollHeight, ch:c.clientHeight, x:{top:x.top,bottom:x.bottom,w:x.width}, closeBelow: close.top>r.bottom, overflowY:getComputedStyle(c).overflowY});`));
  ok(g.top >= 0 && g.bottom <= g.ih + 1, "the card fits inside the phone screen " + JSON.stringify([g.top, g.bottom, g.ih]));
  ok(g.scrollable && g.overflowY === "auto", "the card scrolls inside itself (" + g.sh + " of content in " + g.ch + "px)");
  ok(g.x.top >= g.top && g.x.bottom <= g.ih && g.x.w >= 36, "the X is on screen at the top of the card");
  ok(g.closeBelow, "the bottom Close button starts below the fold, which is exactly why the X exists");
  // scroll to the bottom: the X must still be there (sticky), and the bottom Close reachable
  const b = JSON.parse(await ev(`var c=document.querySelector("#smdQueue .q-profile"); c.scrollTop=c.scrollHeight; return new Promise(function(res){setTimeout(function(){var r=c.getBoundingClientRect(); var x=c.querySelector(".q-profile-x").getBoundingClientRect(); var close=c.querySelector('.q-pbtn.ghost[data-q-act="profile-close"]').getBoundingClientRect(); var hit=document.elementFromPoint(x.left+x.width/2, x.top+x.height/2); res(JSON.stringify({xTop:x.top, cardTop:r.top, xHit: !!(hit && hit.closest && hit.closest(".q-profile-x")), closeOn: close.top>=r.top && close.bottom<=r.bottom+1, st:c.scrollTop}));},150);});`));
  ok(b.st > 100, "the card actually scrolled (" + b.st + "px)");
  ok(Math.abs(b.xTop - b.cardTop) < 12 && b.xHit, "after scrolling to the bottom the X is still at the top of the card and tappable");
  ok(b.closeOn, "and the bottom Close button is now on screen");
  // The click handler is delegated from open() (a live session), which this injected render does not
  // have; the X carries exactly the action the bottom Close button already closes the sheet with.
  const same = await ev(`var x=document.querySelector("#smdQueue .q-profile-x"), c=document.querySelector('#smdQueue .q-pbtn.ghost[data-q-act="profile-close"]'); return x.getAttribute("data-q-act")===c.getAttribute("data-q-act") && x.getAttribute("aria-label")==="Close";`);
  ok(same === true, "the X fires the same profile-close action as the bottom Close, and is a Close control for the back gesture");
  console.log(fails === 0 ? "\nALL GREEN - the OPD profile sheet fits the phone, scrolls, and can always be closed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
