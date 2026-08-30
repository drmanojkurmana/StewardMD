/* ICU Electrolytes screen — the redesign, asserted in a real browser.
 *
 * Asked for as "redesign this whole" and then "do it visual also make it look good". The visual work
 * itself is not testable, but the three things that made the screen hard to READ are:
 *
 *   1. Eight bare numbers with NO units, on the one screen where telling a calcium in mg/dL from an
 *      ionised calcium in mmol/L decides a dose.
 *   2. Eight equally-weighted tiles, so finding the abnormal one meant scanning all of them - and the
 *      correction cards below came in fixed analyte order, so a critical potassium could sit under
 *      three normal results.
 *   3. Inert tiles: seeing a wrong value and being unable to fix it without leaving for the Labs form.
 *
 * USAGE: node test/run-icu-lytes-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8952/").replace(/\/?$/, "/");
// Fresh profile per run - a fixed dir keeps localStorage and a stale patient decides the assertions.
const PORT = 9352, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-lytes-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8952"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const clickAct = async (act) => { await ev(`var b=document.querySelector('[data-icu-act="${act}"]'); if(b) b.click(); return 1;`); await sleep(350); };
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
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.open)`) === true) { ready = true; break; } }
  ok(ready, "app loads with the ICU dashboard");
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await ev(`try{localStorage.setItem("smd_icu_groups","0");}catch(e){} return 1;`);

  // A patient whose potassium is CRITICAL (2.1) and whose sodium is merely abnormal (131).
  await ev(`ICU.reset(); ICU.ingestPatient({name:"LYTEPT",age:58,sex:"M",bed:"3",diagnosis:"Sepsis",weightKg:70});
    ICU.ingestLabs({na:131, k:2.1, cl:99, hco3:24, ca:9.2, ica:1.15, mg:2.0, po4:3.1});
    ICU.open('lytes'); return 1;`);
  await sleep(1000);
  const txt = async () => (await ev(`return (document.getElementById("icuRoot")||{}).innerText||"";`)) || "";

  // ---- 1. units ----
  const body = await txt();
  ok(/mEq\/L/.test(body), "electrolyte tiles show their units (mEq/L)");
  ok(/mg\/dL/.test(body), "and the mg/dL analytes are distinguishable from them");
  const tileUnits = JSON.parse(await ev(`
    var out={}; [].slice.call(document.querySelectorAll('#icuRoot .icu-vc')).forEach(function(c){
      var l=c.querySelector('.vl'), u=c.querySelector('.vu');
      if(l) out[(l.textContent||"").trim()] = u ? (u.textContent||"").trim() : "";
    }); return JSON.stringify(out);`));
  ok(tileUnits["Calcium"] === "mg/dL" && tileUnits["Ionised Ca"] === "mmol/L",
    "calcium (mg/dL) and ionised calcium (mmol/L) are no longer two bare numbers " + JSON.stringify({ ca: tileUnits["Calcium"], ica: tileUnits["Ionised Ca"] }));
  ok(tileUnits["Potassium"] === "mEq/L", "potassium carries mEq/L");

  // ---- 2. what needs attention comes first, and is named, not just coloured ----
  ok(/critical/i.test(body) && /Potassium/.test(body), "the critical analyte is named in a summary, not left to colour alone");
  // DOM order, not text position: the electrolyte ALERTS block is rendered separately above this
  // screen and also says "critical"/"Sodium", so an indexOf on innerText measures that instead.
  const order = await ev(`
    // THE ELECTROLYTE grid - the screen renders other .icu-vitals grids above it, and picking the
    // first one measured the wrong thing entirely.
    var grid=null, gs=[].slice.call(document.querySelectorAll('#icuRoot .icu-vitals'));
    for(var g=0;g<gs.length;g++){ if(gs[g].querySelector('[data-icu-act="editvital:labs:na"]')){ grid=gs[g]; break; } }
    if(!grid) return "no-grid";
    var cards=[].slice.call(document.querySelectorAll('#icuRoot .icu-card'));
    // the summary card: matched by its own wording, and it must sit OUTSIDE and BEFORE that grid
    var sum=null;
    for(var i=0;i<cards.length;i++){
      var c=cards[i];
      if(c.contains(grid)) continue;
      if(!/critical:|abnormal:|within range/.test(c.textContent||"")) continue;
      if(c.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING) sum=c;   // c precedes grid
    }
    return sum ? "above" : "below";`);
  ok(order === "above", "the attention summary appears ABOVE the tile grid (" + order + ")");
  ok(/abnormal/i.test(body), "a merely-abnormal value is reported separately from a critical one");

  // correction cards: most urgent first
  const cardOrder = JSON.parse(await ev(`
    var bs=[].slice.call(document.querySelectorAll('#icuRoot [data-icu-act^="lyte:"]'));
    return JSON.stringify(bs.map(function(b){ return decodeURIComponent((b.getAttribute("data-icu-act")||"").slice(5)); }));`));
  ok(cardOrder.length > 0, "correction cards are rendered (" + cardOrder.join(", ") + ")");
  if (cardOrder.length > 1) {
    const levels = JSON.parse(await ev(`
      var bs=[].slice.call(document.querySelectorAll('#icuRoot [data-icu-act^="lyte:"]'));
      return JSON.stringify(bs.map(function(b){ var ss=b.querySelectorAll('span'); return ((ss[0]&&ss[0].textContent)||"").trim().toLowerCase(); }));`));
    const rank = (s) => (/crit|severe/.test(s) ? 0 : /mod/.test(s) ? 1 : /mild/.test(s) ? 2 : 3);
    const ranks = levels.map(rank);
    ok(ranks.every((r, i) => i === 0 || ranks[i - 1] <= r),
      "correction cards are ordered most-urgent first " + JSON.stringify(levels));
  } else { ok(true, "only one correction card - ordering not applicable"); }

  // ---- 3. a tile can be corrected where it is ----
  ok(await ev(`return !!document.querySelector('#icuRoot [data-icu-act="editvital:labs:na"]');`) === true,
    "every electrolyte tile is tap-to-edit, not just potassium");
  ok(await ev(`return document.querySelectorAll('#icuRoot .icu-vc-tap').length >= 8;`) === true,
    "all eight tiles carry the pressable affordance (press feedback + focus ring)");
  await clickAct("editvital:labs:na");
  const sheet = (await ev(`var m=document.getElementById("icuModal"); return (m&&m.classList.contains("on"))?(m.innerText||""):"";`)) || "";
  ok(/Sodium/i.test(sheet), "tapping a tile opens the single-value editor for THAT analyte");
  ok(/confirm the new value against the current reading/i.test(sheet),
    "and it still routes through the confirm-against-current review, so nothing is written unreviewed");

  console.log(fails === 0 ? "\nALL GREEN — electrolytes: units, urgency first, correct in place" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
