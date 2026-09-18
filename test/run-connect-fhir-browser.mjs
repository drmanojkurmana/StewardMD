/* test/run-connect-fhir-browser.mjs - the SAME proven-endpoint pipeline against a GENUINELY DIFFERENT EMR.
 *
 * Not GHIS: a FHIR REST server. No login page, no anti-forgery token, no HTML fragments - a SPA that
 * loads a patient list and a patient's labs as FHIR Bundle JSON (deeply nested: the result lives in
 * resource.valueQuantity.value, the range in resource.referenceRange[0].low/high, the test name in
 * resource.code.text). The endpoint paths, the response shape and every key name differ from GHIS.
 * Nothing in discovery, prove.mjs or the shim knows the word "FHIR". If the same
 * discover -> reason -> execute -> verify -> LEARN loop maps this correctly, the agent is general, not
 * GHIS-tuned (owner: "it should work on ANY EMR").
 *
 * Usage: node test/run-connect-fhir-browser.mjs
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createPluginClient } from "../connect-agent/phone/plugin-client.mjs";
import { createProofBook } from "../connect-agent/phone/prove.mjs";
import { GUIDE_SOURCES } from "../connect-agent/phone/deep-crawl.mjs";
import { executeView, rowsFromJson } from "../connect-agent/phone/adapter-runtime.mjs";
import { mapRows } from "../connect-agent/phone/runtime.mjs";
import { serveGhisProxy } from "../connect-agent/phone/ghis-shim.mjs";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DBG = 9392;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/connect-fhir-chrome";
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

// FHIR Patient bundle (nested name/identifier), and per-patient lab Observations (nested valueQuantity).
const PATIENTS = [
  { id: "pat-7001", uhid: "UHID-7001", name: "ZARA QURESHI", bed: "W3-05" },
  { id: "pat-7002", uhid: "UHID-7002", name: "IMRAN SAYED", bed: "W3-08" },
];
const OBS = {
  "pat-7001": [
    { code: "Haemoglobin", value: 9.4, unit: "g/dL", low: 13, high: 17 },
    { code: "Creatinine", value: 2.1, unit: "mg/dL", low: 0.6, high: 1.2 },
  ],
  "pat-7002": [
    { code: "Potassium", value: 5.9, unit: "mmol/L", low: 3.5, high: 5.1 },
  ],
};
const patientBundle = () => ({ resourceType: "Bundle", type: "searchset", entry: PATIENTS.map((p) => ({
  resource: { resourceType: "Patient", id: p.id, identifier: [{ system: "uhid", value: p.uhid }], name: [{ text: p.name }], extension: [{ url: "bed", valueString: p.bed }] },
})) });
const obsBundle = (pid) => ({ resourceType: "Bundle", type: "searchset", entry: (OBS[pid] || []).map((o) => ({
  resource: { resourceType: "Observation", status: "final", code: { text: o.code }, valueQuantity: { value: o.value, unit: o.unit }, referenceRange: [{ low: { value: o.low }, high: { value: o.high } }] },
})) });

// A SPA. Loads the patient list by XHR on open; clicking a row loads that patient's labs by XHR and
// renders Test / Result / Units / Range - the numbers a doctor sees, pulled from the nested JSON.
const PAGE = `<!doctype html><html><body>
<table id="wl"><thead><tr><th>UHID</th><th>Patient</th><th>Bed</th></tr></thead><tbody></tbody></table>
<div id="labsBox"></div>
<script>
var sel = null;
function xhr(url, cb){ var x=new XMLHttpRequest(); x.open('GET', url); x.setRequestHeader('Accept','application/fhir+json'); x.onload=function(){ cb(x.responseText); }; x.send(); }
xhr('/fhir/Patient?_count=20', function(t){
  var b=JSON.parse(t), tb=document.querySelector('#wl tbody');
  b.entry.forEach(function(e){ var r=e.resource; var tr=document.createElement('tr');
    var uhid=r.identifier[0].value, name=r.name[0].text, bed=(r.extension[0]||{}).valueString||'';
    tr.innerHTML='<td>'+uhid+'</td><td>'+name+'</td><td>'+bed+'</td>';
    tr.onclick=function(){ sel=r.id; };
    tb.appendChild(tr); });
  document.title='ready';
});
window.openLabs=function(){
  xhr('/fhir/Observation?patient='+sel+'&category=laboratory', function(t){
    var b=JSON.parse(t), h='<table id="labsTbl"><thead><tr><th>Test</th><th>Result</th><th>Units</th><th>Range</th></tr></thead><tbody>';
    b.entry.forEach(function(e){ var o=e.resource, v=o.valueQuantity, rr=o.referenceRange[0];
      h+='<tr><td>'+o.code.text+'</td><td>'+v.value+'</td><td>'+v.unit+'</td><td>'+rr.low.value+' - '+rr.high.value+'</td></tr>'; });
    document.getElementById('labsBox').innerHTML=h+'</tbody></table>'; document.title='labs';
  });
};
</script></body></html>`;

function startEmr() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/app") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(PAGE); }
    if (u.pathname === "/fhir/Patient") { res.writeHead(200, { "Content-Type": "application/fhir+json" }); return res.end(JSON.stringify(patientBundle())); }
    if (u.pathname === "/fhir/Observation") {
      const pid = u.searchParams.get("patient") || "";
      res.writeHead(200, { "Content-Type": "application/fhir+json" }); return res.end(JSON.stringify(obsBundle(pid)));
    }
    res.writeHead(404); res.end();
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, origin: "http://127.0.0.1:" + server.address().port })));
}

function tinyDom(html) {
  const findAll = (src, sel) => { const t = (/^([a-z]+)(\[href\])?$/.exec(sel) || [])[1]; if (!t) return []; return [...src.matchAll(new RegExp("<" + t + "\\b([^>]*)>([\\s\\S]*?)</" + t + ">", "gi"))].map((m) => node(t, m[2], m[1])); };
  const node = (tag, inner, attrs) => ({ tagName: tag.toUpperCase(), textContent: inner.replace(/<[^>]+>/g, ""), getAttribute: (n) => (new RegExp(n + '="([^"]*)"').exec(attrs) || [])[1] || null, querySelectorAll: (sel) => sel.split(",").flatMap((s) => findAll(inner, s.trim())), querySelector(sel) { return this.querySelectorAll(sel)[0] || null; } });
  return node("html", html, "");
}

let msgId = 1;
const pending = new Map();
let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
async function waitFor(expr, ms = 8000) { const end = Date.now() + ms; while (Date.now() < end) { const r = await call("Runtime.evaluate", { expression: expr, returnByValue: true }); if (r.result && r.result.result && r.result.result.value) return true; await sleep(100); } return false; }

async function main() {
  const emr = await startEmr();
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
  try {
    let ver; for (let t = 0; t < 60 && !ver; t++) { try { ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json(); } catch { await sleep(200); } }
    ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
    sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
    await call("Runtime.enable"); await call("Page.enable");

    const raw = {
      platform: "android",
      async open({ url, initScript }) { if (initScript) await call("Page.addScriptToEvaluateOnNewDocument", { source: initScript }); await call("Page.navigate", { url }); await waitFor("document.readyState==='complete'"); return { ok: true }; },
      async navigate({ url }) { await call("Page.navigate", { url }); await waitFor("document.readyState==='complete'"); return { ok: true }; },
      async evaluate({ expression }) { const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return { result: r.result && r.result.result ? r.result.result.value ?? null : null }; },
      async currentUrl() { const r = await call("Runtime.evaluate", { expression: "location.href", returnByValue: true }); return { url: r.result.result.value }; },
      async setMode() { return {}; }, async drainRequests() { return { requests: [] }; }, async close() { return {}; },
    };
    const client = createPluginClient({ plugin: raw, storeId: "s", origins: [emr.origin], title: "FHIR EMR" });
    const brain = { async pickEndpoint(p) { const i = p.candidates.length; return { ranked: p.candidates.map((c, k) => ({ index: i - 1 - k, role: "data" })).reverse(), model: "gemini-3.8-flash" }; } };
    const book = createProofBook({ brain });

    await client.createTab({ url: emr.origin + "/app" });
    ok(await waitFor("document.title==='ready'"), "FHIR patient list loaded by XHR (Bundle JSON)");

    // Prove the worklist against the rows on screen (FHIR Bundle, nested name/identifier).
    const wl = { resourceHint: "worklist", pathTemplate: emr.origin + "/app", rowsSelector: "#wl tbody tr", headers: ["UHID", "Patient", "Bed"] };
    await book.prove({ client, view: wl, label: "open the patient list", since: 0 });
    ok(wl.proof.status === "proven" && wl.endpoints.at(-1).path.startsWith("/fhir/Patient"), "FHIR patient list call proven: " + JSON.stringify(wl.proof));

    // Open patient one's labs; prove the labs view against the numbers on screen.
    await client.evaluate({ expression: GUIDE_SOURCES.arm });
    await client.evaluate({ expression: "document.querySelectorAll('#wl tbody tr')[0].click(); window.openLabs(); 'ok'" });
    ok(await waitFor("document.title==='labs'"), "the FHIR labs table rendered");
    const labs = { resourceHint: "labs", pathTemplate: emr.origin + "/app", rowsSelector: "#labsTbl tbody tr", headers: ["Test", "Result", "Units", "Range"] };
    await book.prove({ client, view: labs, label: "open Labs" });
    ok(labs.proof.status === "proven" && labs.endpoints.at(-1).path.startsWith("/fhir/Observation"), "FHIR Observation call proven: " + JSON.stringify(labs.proof));
    ok(labs.columns && labs.columns.Result && /value/i.test(labs.columns.Result.key), "Result column learned to the nested valueQuantity value by VALUE, whatever it is named: " + JSON.stringify(labs.columns.Result));
    ok(labs.columns.Range && Array.isArray(labs.columns.Range.keys), "Range learned as two nested fields (low/high): " + JSON.stringify(labs.columns.Range));
    ok(!/9\.4|Haemoglobin|QURESHI/.test(JSON.stringify({ p: labs.proof, c: labs.columns, e: labs.endpoints })), "no cell value or name is in the saved FHIR views");

    // Replay the proven adapter for patient TWO (different FHIR id) and read it back through the shim.
    const patients = mapRows(rowsFromJson(patientBundle()).map((r) => ({ "Patient ID": r["resource.identifier.0.value"] || r["resource.identifier_0_value"] || "", "Patient name": r["resource.name.0.text"] || r["resource.name_0_text"] || "", episodeId: r["resource.id"] || "" })));
    // Patient objects for the executor: the FHIR patient id drives the Observation query.
    const p2 = { patientId: PATIENTS[1].id, episodeId: PATIENTS[1].id };
    const labOut = await executeView({ plugin: client, origin: emr.origin, view: labs, patient: p2, parseHtml: tinyDom });
    const section = [{ resource: "labs", rows: labOut.rows }];
    const det = serveGhisProxy({ path: "/lab-detail?renderId=a0", sections: section, patient: p2 }).body;
    const k = det.tests.find((t) => /Potassium/.test(t.test));
    console.log("  patient-two labs read back: " + JSON.stringify((det.tests || []).map((t) => [t.test, t.result, t.units, t.range])));
    ok(k && k.result === "5.9" && k.units === "mmol/L" && k.range === "3.5 - 5.1", "shim reads patient two's FHIR result the doctor would see: " + JSON.stringify(k && { r: k.result, u: k.units, rng: k.range }));
  } finally {
    try { chrome.kill(); } catch { /* gone */ }
    emr.server.close();
  }
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
