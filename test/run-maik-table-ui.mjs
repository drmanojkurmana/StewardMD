/* MaiK answer tables scroll sideways instead of breaking words. Real headless browser, real app.
 *
 * Owner screenshot 2026-09-27 (iPhone): a 5-column differential table was squeezed into the bubble
 * with words split mid-word ("Diagno sis", "Neurop athic", "Ecthy ma Gangre nosum"). The polished
 * bubble's overflow-wrap:anywhere let cells shrink below a word. The same table is rendered here by the
 * production markdown renderer (SMD_MaiK.renderMarkdown) inside a real answer bubble and measured.
 *
 * USAGE: BASE=http://localhost:8996/ CHROME=<chrome binary> node test/run-maik-table-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8996/").replace(/\/?$/, "/");
const PORT = 9393, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-table-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

// The table from the owner's screenshot, as the model wrote it.
const WIDE = [
  "| Diagnosis | Distinguishing Features | RBS 450 / Diabetes | Platelets 72K | Next Step / Confirmatory Test |",
  "|---|---|---|---|---|",
  "| Diabetic Foot / Neuropathic Ulcer | Painless, deep, punched-out ulcer on pressure-bearing areas; decreased sensation/monofilament response. | Direct driver (poor wound healing) | Indirect (if complicated by osteomyelitis or deep sepsis) | X-ray of foot/leg (exclude osteomyelitis), probe-to-bone test, HbA1c. |",
  "| Ecthyma Gangrenosum / Pseudomonas Sepsis | Painful, necrotic, ulcerated pustules that rapidly progress to black eschars; highly associated with neutropenia/immunosuppression. | Predisposing factor | Common (due to severe Pseudomonas sepsis/DIC) | Blood and wound cultures; urgent IV antipseudomonal antibiotics. |",
].join("\n");
const NARROW = "| Drug | Dose |\n|---|---|\n| Ceftriaxone | 2 g IV once daily |";

// A sentence before the table, as in a real answer (a bubble holding only a table shrinks to it).
const BUILD = (md, id) => `
  var b = document.getElementById("maikBody"), old = document.getElementById(${JSON.stringify(id)}); if (old) old.remove();
  var d = document.createElement("div"); d.className = "maik-b ai"; d.id = ${JSON.stringify(id)};
  d.innerHTML = SMD_MaiK.renderMarkdown("A non-healing leg ulcer with an RBS of 450 mg/dL and platelets of 72,000 raises several possibilities worth separating early.\\n\\n" + ${JSON.stringify(md)}); b.appendChild(d); return !!d.querySelector(".maik-tblwrap table.maik-tbl");`;
// Every word in every cell must sit on one line: a word split across lines has two client rects.
// Hyphens and slashes are real break points ("probe-to-bone", "foot/leg"), so words are cut there.
const MEASURE = (id) => `
  var d = document.getElementById(${JSON.stringify(id)}), w = d.querySelector(".maik-tblwrap"), t = w.querySelector("table");
  var split = [], cols = [];
  Array.prototype.forEach.call(t.querySelectorAll("th,td"), function (c) {
    var walk = document.createTreeWalker(c, NodeFilter.SHOW_TEXT), n;
    while ((n = walk.nextNode())) {
      var re = /[^\\s\\/-]+/g, m;
      while ((m = re.exec(n.data))) {
        var r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
        if (r.getClientRects().length > 1) split.push(m[0]);
      }
    }
  });
  Array.prototype.forEach.call(t.rows[0].cells, function (c) { cols.push(c.offsetWidth); });
  return JSON.stringify({ wrapW: w.clientWidth, tableW: t.offsetWidth, scrollW: w.scrollWidth,
    overflowX: getComputedStyle(w).overflowX, cellWrap: getComputedStyle(t.querySelector("td")).overflowWrap, split: split, cols: cols,
    bubbleW: d.offsetWidth });`;   // layout widths: the bubble scales in, and a transform would shrink a rect

try {
  let ver, tries = 0; while (tries++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_askMaik && window.SMD_MaiK && SMD_MaiK.renderMarkdown)`) === true) { ready = true; break; } }
  ok(ready, "the app, MaiK and the production markdown renderer load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await ev(`SMD_askMaik(""); return 1;`); await sleep(1200);
  ok(await ev(`return !!document.querySelector("#maikSheet.maik-polished #maikBody");`) === true, "the MaiK sheet opens with the phone's polished skin");

  for (const width of [390, 320]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 3, mobile: true });
    ok(await ev(BUILD(WIDE, "tblwide")) === true, `${width}px: the screenshot's table renders as .maik-tblwrap > table.maik-tbl`);
    await sleep(250);
    const m = JSON.parse(await ev(MEASURE("tblwide")));
    console.log(`   ${width}px: bubble ${m.bubbleW}px, table ${m.tableW}px in a ${m.wrapW}px scroller, columns ${m.cols.join("/")}px, split words: ${m.split.length ? m.split.join(", ") : "none"}`);
    ok(m.split.length === 0, `${width}px: no word is broken across lines (was "Diagno sis", "Neurop athic")`);
    ok(m.scrollW > m.wrapW + 40 && m.overflowX === "auto", `${width}px: the table is wider than the bubble and scrolls sideways`);
    ok(Math.min(...m.cols) >= 100, `${width}px: every column is at least 100px wide (narrowest ${Math.min(...m.cols)}px)`);
    ok(m.cellWrap === "normal", `${width}px: cells wrap only between words`);
  }
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  ok(await ev(BUILD(NARROW, "tblnarrow")) === true, "a two-column table renders");
  await sleep(200);
  const n = JSON.parse(await ev(MEASURE("tblnarrow")));
  console.log(`   narrow: table ${n.tableW}px in a ${n.wrapW}px scroller`);
  ok(n.scrollW <= n.wrapW + 1 && n.tableW >= n.wrapW - 1, "a narrow table still fills the bubble and does not scroll");
} catch (e) {
  console.log("❌ harness error: " + (e && e.stack || e)); fails++;
} finally {
  try { chrome.kill("SIGKILL"); } catch {}
  try { if (serveProc) serveProc.kill("SIGKILL"); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS: MaiK tables scroll sideways and never split a word");
process.exit(fails ? 1 : 0);
