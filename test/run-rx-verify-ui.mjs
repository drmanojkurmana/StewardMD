/* The Prescription tile really has two buttons, and Verify really works (real headless browser).
 *
 * "create verify prescription button in app and website stewardmd.in for app inside Prescription
 * tile (create and another button verify)".
 *
 * The source-level wiring is checked in test/rx-verify-entrypoints.test.mjs. What that CANNOT catch
 * is the thing most likely to go wrong here: the two-action tile is a <div> containing two
 * <button>s living inside a grid of plain <button> tiles. If the markup or the click delegation is
 * wrong, the tile renders but one control does nothing - which looks fine in a diff and is broken
 * on the phone. So this drives the actual DOM.
 *
 * The verification endpoint is stubbed, so no network, no Firestore, and no real prescription.
 *
 * USAGE: node test/run-rx-verify-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8961/").replace(/\/?$/, "/");
const PORT = 9361, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/rx-verify-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8961"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_showHome && window.SMD_RX)`) === true) { ready = true; break; } }
  ok(ready, "app loads with home and the prescription module");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await ev(`SMD_showHome(); return 1;`); await sleep(700);

  // ---- the tile ----
  await ev(`var b=document.querySelector('[data-act="hospital"]'); if(b) b.click(); return 1;`);
  await sleep(900);
  ok(await ev(`return /Prescription/.test(document.body.innerText);`) === true, "the Hospital sheet lists Prescription");

  const tile = JSON.parse(await ev(`
    var t=document.querySelector('.hv-tile2'); if(!t) return JSON.stringify({found:false});
    var bs=[].slice.call(t.querySelectorAll('button'));
    return JSON.stringify({found:true, tag:t.tagName, n:bs.length,
      labels:bs.map(function(b){return (b.textContent||"").trim();}),
      acts:bs.map(function(b){return b.getAttribute("data-mi");}),
      h:bs.map(function(b){return Math.round(b.getBoundingClientRect().height);})});`));
  ok(tile.found, "the Prescription tile renders as a two-action tile");
  ok(tile.tag === "DIV", "its container is a DIV - a button cannot legally nest buttons (" + tile.tag + ")");
  ok(tile.n === 2 && tile.labels.join(",") === "Create,Verify", "it shows exactly Create and Verify " + JSON.stringify(tile.labels));
  ok(tile.acts.join(",") === "rx,rxverify", "each button carries its own action " + JSON.stringify(tile.acts));
  ok(tile.h.every((h) => h >= 40), "both controls are a real tap target " + JSON.stringify(tile.h) + "px");

  // ---- Verify opens the checker, with the endpoint stubbed ----
  await ev(`window.__rxvAsked=[];
    var _f = window.fetch;
    window.fetch = function(u, o){
      if (String(u).indexOf("/api/rx/v/") === 0) {
        window.__rxvAsked.push(String(u));
        return Promise.resolve({ ok:true, json:function(){ return Promise.resolve({
          ok:true, status:"ACTIVE", code:"1234-5678-90AB-CDEF",
          doctor:{name:"Dr Test", regNo:"TSMC/12345", verified:true},
          drugs:[{name:"Alprazolam", dose:"0.25 mg", freq:"HS", duration:"7 days"}],
          issuedAt: Date.now(), validUntil: Date.now()+30*86400000, schedule:"H1", refillsAllowed:0
        }); } });
      }
      return _f.apply(this, arguments);
    }; return 1;`);

  await ev(`var b=document.querySelector('[data-mi="rxverify"]'); if(b) b.click(); return 1;`);
  await sleep(900);
  ok(await ev(`return !!document.getElementById("rxvCode");`) === true, "tapping Verify opens the in-app checker");

  await ev(`var i=document.getElementById("rxvCode"); i.value="1234-5678-90AB-CDEF"; return 1;`);
  await ev(`var g=document.getElementById("rxvGo"); if(g) g.click(); return 1;`);
  await sleep(900);
  const asked = JSON.parse(await ev(`return JSON.stringify(window.__rxvAsked||[]);`));
  ok(asked.length === 1, "it calls the public verification endpoint once " + JSON.stringify(asked));
  ok(/\/api\/rx\/v\/1234567890ABCDEF/.test(asked[0] || ""), "the typed code is normalised before lookup");

  const shown = (await ev(`var o=document.getElementById("rxvOut"); return o ? (o.innerText||"") : "";`)) || "";
  ok(/Valid prescription/i.test(shown), "a valid prescription is stated in words");
  ok(/Dr Test/.test(shown) && /TSMC\/12345/.test(shown), "the prescriber and registration number are shown");
  ok(/Verified by StewardMD/.test(shown), "and whether that registration was verified");
  ok(/Alprazolam/.test(shown) && /0\.25 mg/.test(shown), "the drugs are listed so they can be compared with the paper");

  // ---- a bad code is refused without pretending to be a lookup ----
  await ev(`var i=document.getElementById("rxvCode"); i.value="nope"; var g=document.getElementById("rxvGo"); g.click(); return 1;`);
  await sleep(500);
  const bad = (await ev(`var o=document.getElementById("rxvOut"); return o ? (o.innerText||"") : "";`)) || "";
  ok(/not a valid code/i.test(bad), "a malformed code is rejected in the app");
  ok(JSON.parse(await ev(`return JSON.stringify(window.__rxvAsked||[]);`)).length === 1,
    "and it never reaches the server");

  console.log(fails === 0 ? "\nALL GREEN — Create + Verify on the tile, and Verify actually verifies" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
