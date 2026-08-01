/* Connect EMR onboarding admin page smoke test (headless Chrome via CDP).
 * Verifies: the page loads with ZERO console errors / uncaught exceptions, the Add-connection form
 * renders, the auth-method toggle works, a MOCKED api() list call renders a connection row with its
 * test status, and a MOCKED 404 shows the graceful "not enabled yet" flag-off state (not a crash).
 * No Firebase sign-in and no backend are required (api() is stubbed via the window.ConnectEMR test seam).
 * USAGE: node test/run-connect-emr-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8793, DBG = 9384, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/connect-emr-chrome";
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const consoleErrors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

async function attach(url) {
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {}); await call("Page.navigate", { url });
  for (let i = 0; i < 60; i++) { await sleep(300); if (await ev(`return !!(window.ConnectEMR && window.ConnectEMR.loadList)`) === true) return true; }
  return false;
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    // Capture real console.error output + uncaught exceptions from the page.
    if (m.method === "Runtime.consoleAPICalled" && m.params && m.params.type === "error") consoleErrors.push((m.params.args || []).map(a => a.value || a.description || "").join(" "));
    if (m.method === "Runtime.exceptionThrown") consoleErrors.push("EXCEPTION: " + (((m.params || {}).exceptionDetails || {}).text || "thrown"));
  };

  ok(await attach(BASE + "admin/connect-emr.html"), "page loads (window.ConnectEMR ready)");
  await sleep(600); // let any async load settle

  // form renders
  ok(await ev(`return !!(document.getElementById("aName") && document.getElementById("aBase") && document.getElementById("aMethod") && document.getElementById("addSave"));`) === true, "add-connection form renders");
  ok(await ev(`var o=document.querySelectorAll('#aType option'); var en=[].slice.call(o).filter(function(x){return !x.disabled;}).map(function(x){return x.value;}); return o.length>=5 && en.indexOf("fhir")>=0 && en.indexOf("csv")>=0 && [].slice.call(o).filter(function(x){return x.disabled;}).length>=3;`) === true, "type picker shows FHIR + CSV active and the rest disabled 'coming soon'");
  ok(await ev(`return getComputedStyle(document.getElementById("fSmart")).display==="none";`) === true, "SMART fields hidden by default (token method)");
  ok(await ev(`document.getElementById("aMethod").value="smart"; document.getElementById("aMethod").onchange(); return getComputedStyle(document.getElementById("fSmart")).display!=="none" && getComputedStyle(document.getElementById("fToken")).display==="none";`) === true, "auth-method toggle reveals SMART fields, hides token fields");
  await ev(`document.getElementById("aMethod").value="token"; document.getElementById("aMethod").onchange(); return 1;`);

  // CSV type: activates the CSV subform, one-shot upload posts, mocked normalized bundle + warnings render
  ok(await ev(`document.getElementById("aType").value="csv"; document.getElementById("aType").onchange(); return getComputedStyle(document.getElementById("fCsv")).display!=="none" && getComputedStyle(document.getElementById("fFhir")).display==="none";`) === true, "CSV type activates the CSV subform and hides the FHIR fields");
  await ev(`window.ConnectEMR.setTenant("t-csv"); window.ConnectEMR.__setApi(function(path,opts){ return Promise.resolve({s:200,d:{ok:true,rowsParsed:2,columns:["MRN","Test","Value","Unit"],warnings:["unmapped column 'Extra' ignored","ragged row 2 (3 cols vs 4)"],bundle:{sccmVersion:"1.0",patient:{id:"h1a2",gender:"female"},observations:[{id:"row-0",category:"laboratory",code:{text:"Hemoglobin"},value:{value:9.2,unit:"g/dL"}},{id:"row-1",category:"laboratory",code:{text:"Creatinine"}}],diagnosticReports:[],meta:{warnings:[]}}}}); }); return 1;`);
  await ev(`window.ConnectEMR.submitCsv("MRN,Test,Value,Unit\\nP1,Hemoglobin,9.2,g/dL\\nP1,Creatinine,1.1,mg/dL"); return 1;`);
  await sleep(300);
  ok(await ev(`var j=document.getElementById("csvJson"); return getComputedStyle(j).display!=="none" && j.textContent.indexOf('"sccmVersion": "1.0"')>=0 && j.textContent.indexOf("Hemoglobin")>=0;`) === true, "CSV upload posts and renders the normalized SCCM bundle");
  ok(await ev(`var w=document.getElementById("csvWarn"); return getComputedStyle(w).display!=="none" && w.innerHTML.indexOf("unmapped column")>=0 && w.innerHTML.indexOf("ragged row")>=0;`) === true, "CSV warnings list surfaces the structural warnings");
  ok(await ev(`var c=document.getElementById("csvCounts"); return c.textContent.indexOf("2 row")>=0 && c.textContent.indexOf("4 column")>=0 && c.textContent.indexOf("\\u2014")<0;`) === true, "CSV counts show rows x columns (no em-dash)");
  // reset back to FHIR for the remaining list mock
  await ev(`document.getElementById("aType").value="fhir"; document.getElementById("aType").onchange(); return 1;`);

  // MOCKED api() success -> list renders a row + status
  await ev(`window.ConnectEMR.setTenant("t-smoke"); window.ConnectEMR.__setApi(function(path,opts){ return Promise.resolve({s:200,d:{ok:true,connections:[{connectionId:"c-1",name:"Smoke Hospital FHIR",type:"fhir",fhirBaseUrl:"https://r4.smarthealthit.org/fhir",authMethod:"token",status:"active",updatedAt:"2026-08-01T10:00:00Z",lastTest:{ok:true,at:"2026-08-01T10:00:00Z",fhirVersion:"4.0.1",softwareName:"SMART Reference Server"}}]}}); }); window.ConnectEMR.loadList(); return 1;`);
  await sleep(300);
  ok(await ev(`var h=document.getElementById("list").innerHTML; return h.indexOf("Smoke Hospital FHIR")>=0 && h.indexOf("Connected")>=0 && h.indexOf("r4.smarthealthit.org")>=0;`) === true, "mocked list renders the connection row with host + Connected status");
  ok(await ev(`var h=document.getElementById("list").innerHTML; return h.indexOf('data-act="test"')>=0 && h.indexOf('data-act="pull"')>=0 && h.indexOf('data-act="del"')>=0;`) === true, "row has Test / Pull / Delete actions");

  // MOCKED empty list -> empty state copy (no em-dash)
  await ev(`window.ConnectEMR.__setApi(function(){ return Promise.resolve({s:200,d:{ok:true,connections:[]}}); }); window.ConnectEMR.loadList(); return 1;`);
  await sleep(200);
  ok(await ev(`var h=document.getElementById("list").innerHTML; return h.indexOf("No EMRs connected yet")>=0 && h.indexOf("\\u2014")<0;`) === true, "empty state shows 'No EMRs connected yet' with no em-dash");

  // MOCKED 404 -> graceful flag-off state
  await ev(`window.ConnectEMR.__setApi(function(){ return Promise.resolve({s:404,d:{error:"not_found"}}); }); window.ConnectEMR.loadList(); return 1;`);
  await sleep(200);
  ok(await ev(`return window.ConnectEMR.flagOffVisible()===true && getComputedStyle(document.getElementById("work")).display==="none";`) === true, "a 404 shows the graceful 'not enabled yet' state and hides the workspace");

  ok(consoleErrors.length === 0, "zero console errors / uncaught exceptions" + (consoleErrors.length ? " -> " + JSON.stringify(consoleErrors.slice(0, 4)) : ""));

  console.log(fails === 0 ? "\nALL GREEN - Connect EMR admin page smoke test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e && e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
