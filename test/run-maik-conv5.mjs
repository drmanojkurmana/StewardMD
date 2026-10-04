/* The owner's MaiK conversation of 2026-10-04 (3:05 pm, phone), replayed line by line through the real
 * MaiK send path and the Edge router in headless Chrome. Each line asserts what the owner should have got:
 *   1 "Pneumoniacns"            -> Pneumonia pages, saying it searched "pneumonia"
 *   2 "Open antibiogram"        -> Antibiogram OPENS (not a card); "Open Drugs" opens the Drugs sheet
 *   3 "Hello"                   -> a greeting
 *   4 "Icd code for dental absccess" -> ICD list for dental abscess with K04.7
 *   5/6 "What is the arogyasri code for pancreatitis" (twice) -> AP + Telangana Aarogyasri packages, no
 *       Nagaland, no ICD, a garbage or zero rate shown as "price not listed"
 *   7 "Ars codes for Malaria", 8 "What is the arogyasri code for malaria" -> Aarogyasri malaria packages
 * The scheme API is stubbed with rows copied from https://stewardmd.in/api/schemes/search on 2026-10-04
 * (the local static server has no D1). Every /api/ai call is refused and counted: none of these lines
 * needs a model. The engine mock declines every pick, so only the rules (Layer 0) answer.
 * USAGE: BASE=http://localhost:8996/ CHROME=<chrome binary> node test/run-maik-conv5.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8996/").replace(/\/?$/, "/");
const PORT = 9419, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-conv5-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

// Real rows (trimmed), 2026-10-04. Telangana's amount is the import's parse defect, kept on purpose.
const ROWS = [
  ["andhra-pradesh", "ap-ntr-vaidya-seva", "Dr. NTR Vaidya Seva", "MG0104A", "Acute necrotizing severe pancreatitis", 153930],
  ["andhra-pradesh", "ap-ntr-vaidya-seva", "Dr. NTR Vaidya Seva", "M12.10", "Medical management of Acute Pancreatitis -Mild", 51310],
  ["telangana", "telangana-aarogyasri", "Rajiv Aarogyasri Health Care Trust", "M12.10", "Medical management of Acute Pancreatitis (Mild)", 23003800880010350],
  ["telangana", "telangana-aarogyasri", "Rajiv Aarogyasri Health Care Trust", "M12.12", "Conservative management of Acute Pancreatitis With Pseudocyst", 40000],
  ["nagaland", "nagaland-cmhis-pmjay", "CMHIS / AB PM-JAY (Nagaland)", "MG033A", "Acute pancreatitis", 0],
  ["himachal-pradesh", "himachal-hpsbys", "Himachal Pradesh Swasthya Bima Yojana / HIMCARE", "MG033A", "Acute pancreatitis", 0],
  ["andhra-pradesh", "ap-ntr-vaidya-seva", "Dr. NTR Vaidya Seva", "MG003A", "Malaria", 10000],
  ["andhra-pradesh", "ap-ntr-vaidya-seva", "Dr. NTR Vaidya Seva", "M2.4", "Medical Management of Cerebral Malaria", 25655],
  ["telangana", "telangana-aarogyasri", "Rajiv Aarogyasri Health Care Trust", "M3.4A", "Malaria", 23003800880010350],
  ["nagaland", "nagaland-cmhis-pmjay", "CMHIS / AB PM-JAY (Nagaland)", "MG003A", "Malaria", 0]
].map(([state_id, scheme_id, scheme, treatment_code, treatment_name, package_amount]) => ({ state_id, state: state_id, scheme_id, scheme, treatment_code, treatment_name, package_amount }));

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
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_askMaik && window.SMD_EDGE && window.SMD_EDGE.schemeAsk && window.SMD_MAIK_ENGINE && SMD_MAIK_ENGINE.schemeLookup && window.MaiKKB && window.KB_ENRICHMENT && window.SMD_ICD)`) === true) { ready = true; break; } }
  ok(ready, "the app, MaiK, the Edge router, the KB and the ICD index load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await ev(`window.__aiCalls = 0; window.__schemeQ = []; var ROWS = ${JSON.stringify(ROWS)}; var _f = window.fetch;
    window.fetch = function (u, o) {
      var s = String(u);
      if (/\\/api\\/ai\\/(explain|refine|route|extract|research|summary|maik)/.test(s)) { window.__aiCalls++; (window.__aiU = window.__aiU || []).push(s); return Promise.reject(new Error("offline in test")); }
      if (/\\/api\\/schemes\\/search/.test(s)) {
        var p = new URL(s, location.href).searchParams, q = (p.get("q") || "").toLowerCase(), st = p.get("state") || "";
        window.__schemeQ.push(q + "|" + st);
        var rows = ROWS.filter(function (r) { return (!st || r.state_id === st) && q.split(/\\s+/).every(function (w) { return r.treatment_name.toLowerCase().indexOf(w) >= 0; }); });
        return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ results: rows }); } });
      }
      return _f.apply(this, arguments);
    }; localStorage.setItem("smd_edge", "1"); return 1;`);
  await ev(`SMD_EDGE.setEngine({ available: function(){return true;}, load: function(){return Promise.resolve();}, reset: function(){return Promise.resolve();}, release: function(){return Promise.resolve();},
    complete: function () { return Promise.resolve({ type: "call", function_calls: [{ name: "choose_option", arguments: { option: 0 } }], confidence: 0.9 }); } }); return 1;`);
  // Openers are recorded instead of drawn, so "opened" is an observable fact.
  await ev(`window.__abg = 0; if (window.ABG) { window.__abgReal = ABG.open; ABG.open = function () { window.__abg++; }; } return 1;`);

  const openMaik = async () => { await ev(`SMD_askMaik(""); return 1;`); await sleep(900); };
  const sheetOn = () => ev(`var s=document.getElementById("maikSheet"); return !!(s && s.classList.contains("on") && s.offsetParent !== null);`);
  // The owner's thread: no topic reset between lines (a real conversation), except where a tool closed MaiK.
  const send = async (q, wait) => { await ev(`var q=document.getElementById("maikQ"); q.value=${JSON.stringify(q)}; q.dispatchEvent(new Event("input",{bubbles:true})); document.getElementById("maikSend").click(); return 1;`); await sleep(wait || 1500); };
  const lastAi = () => ev(`var b=[].slice.call(document.querySelectorAll("#maikBody .maik-b.ai")).pop(); return b ? b.innerText : "";`);
  const lastAiHTML = () => ev(`var b=[].slice.call(document.querySelectorAll("#maikBody .maik-b.ai")).pop(); return b ? b.innerHTML : "";`);

  await openMaik();
  // 1
  await send("Pneumoniacns");
  let txt = String(await lastAi()), html = String(await lastAiHTML());
  ok(/Pneumonia/.test(txt) && /data-kb-more=/.test(html) && /Showing results for pneumonia/i.test(txt), "1 Pneumoniacns: Pneumonia Knowledge pages, with 'Showing results for pneumonia' (" + txt.split("\n")[0] + ")");
  // 2
  await send("Open antibiogram", 1200);
  ok(await ev(`return window.__abg;`) === 1 && !(await sheetOn()), "2 Open antibiogram: Antibiogram opened straight away and MaiK stepped aside");
  await openMaik();
  txt = String(await lastAi());
  ok(/Opened Antibiogram/.test(txt) && /data-maik-tool="antibiogram"/.test(String(await lastAiHTML())), "2 the chat keeps 'Opened Antibiogram' with a button to open it again");
  await send("Open Drugs", 1200);
  ok(!(await sheetOn()) && /Drugs/.test(String(await ev(`var s=document.querySelector(".hv-sh-t"); return s ? s.textContent : "";`))), "2b Open Drugs: the Drugs sheet opened");
  await ev(`try { var c=document.querySelector(".hv-sheet.on, .hv-sh-bg.on"); if (c) c.click(); } catch (e) {} return 1;`);
  await openMaik();
  // 3
  await send("Hello");
  ok(/^(Hello|Hi)/i.test(String(await lastAi())), "3 Hello: a greeting");
  // 4
  await send("Icd code for dental absccess", 2500);
  txt = String(await lastAi());
  ok(/ICD-10 codes for dental abscess/i.test(txt) && /K04\.7/.test(txt) && /Showing results for dental abscess/i.test(txt), "4 ICD for dental abscess with K04.7, corrected spelling said (" + txt.replace(/\n/g, " | ").slice(0, 160) + ")");
  // 5, 6
  for (const n of ["5", "6"]) {
    await send("What is the arogyasri code for pancreatitis", 2000);
    txt = String(await lastAi());
    ok(/Aarogyasri packages for pancreatitis/.test(txt) && /M12\.10/.test(txt) && /Andhra Pradesh/.test(txt) && /Telangana/.test(txt), n + " arogyasri pancreatitis: AP and Telangana Aarogyasri packages, labelled");
    ok(!/Nagaland|Himachal|ICD-10|K85/.test(txt), n + " no Nagaland, no Himachal, no ICD");
    ok(/Rs 51,310/.test(txt) && /price not listed/.test(txt) && !/Rs 0\b|23003800880010350/.test(txt), n + " real rates in rupees, the zero/garbage rate shown as 'price not listed'");
  }
  // 7, 8
  for (const [n, q] of [["7", "Ars codes for Malaria"], ["8", "What is the arogyasri code for malaria"]]) {
    await send(q, 2000);
    txt = String(await lastAi());
    ok(/Aarogyasri packages for malaria/i.test(txt) && /MG003A/.test(txt) && /M3\.4A/.test(txt) && !/Nagaland|ICD-10|B54/.test(txt), n + " " + q + ": Aarogyasri malaria packages (AP MG003A, Telangana M3.4A), never ICD");
  }
  ok(await ev(`return window.__aiCalls;`) === 0, "no line reached a cloud model (" + (await ev(`return JSON.stringify(window.__aiU||[]);`)) + ")");
  ok(String(await ev(`return window.__schemeQ.join(",");`)).split(",").every((x) => /\|(andhra-pradesh|telangana)$/.test(x)), "every scheme query was filtered to the Aarogyasri states (" + (await ev(`return window.__schemeQ.join(",");`)) + ")");
  // Line 7's garbled "Ma c au d a ca.": the streaming patch and the final markdown render keep every character.
  const para = "Malaria is caused by Plasmodium species and spread by the bite of an infected female Anopheles mosquito.";
  const stream = await ev(`var h=document.createElement("div"); document.body.appendChild(h); var P=__MAIK_TEST.patchStream, md=SMD_MaiK.renderMarkdown, s=${JSON.stringify("**Malaria**\n\n" + para)}, out=[];
    for (var i=1;i<=s.length;i+=3) P(h, md(s.slice(0,i))); P(h, md(s)); out.push(h.innerText.replace(/\\s+/g," ").trim()); h.remove(); return out[0];`);
  ok(String(stream) === "Malaria " + para, "the streaming patch + markdown render keep every character (" + stream + ")");
  console.log(fails === 0 ? "\nALL GREEN: the 4 Oct conversation replays correctly" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
