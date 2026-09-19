/* test/run-connect-prove-browser.mjs - the proven-endpoint loop in a REAL browser.
 *
 * A small GHIS-shaped EMR (made-up patients): a session cookie gates every call, the ward list fills
 * itself by XHR on load, "Treatment chart" fires a visit activation POST, a decoy signature lookup and
 * the medicines fragment, and the medicines call answers for whichever visit was ACTIVATED last (as
 * GHIS's server-side session does). Headless Chrome runs the page observer at document start (the
 * phone's initScript), the proof loop re-issues requests from inside the page, and the proven adapter
 * is then replayed for the OTHER patient. Proves: the replay buffer (and that it never keeps a sign-in
 * body), OBSERVE -> brain order -> EXECUTE -> VERIFY against the DOM, the learned field sources, and
 * that the proven chain returns the right patient's data.
 *
 * Usage: node test/run-connect-prove-browser.mjs
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
import { verifyViews } from "../connect-agent/phone/verify.mjs";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DBG = 9391;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/connect-prove-chrome";
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

const WARD = [
  { MRNo: "MR900001", VisitNo: "IP5550001", PatientName: "TEST ALPHA", BedName: "B-12" },
  { MRNo: "MR900002", VisitNo: "IP5550002", PatientName: "TEST BRAVO", BedName: "B-14" },
];
const MEDS = {
  "MR900001-IP5550001": [["Tab Paracetamol 650 mg", "Oral", "TDS"], ["Inj Ceftriaxone 1 g", "IV", "BD"]],
  "MR900002-IP5550002": [["Tab Metformin 500 mg", "Oral", "BD"], ["Inj Insulin Regular 6 units", "SC", "TDS"]],
};
/* Lab RESULTS keyed by MR. The JSON labels its columns to fool a name guess: `Value` is a code, and the
 * number the doctor sees lives in `ValueType`; the reference range is two fields (`LowValue`/`HighValue`).
 * The screen shows Test / Result / Units / Range. Only value-based column learning binds these right. */
const LABS = {
  MR900001: [
    { Analyte: "Haemoglobin", Value: "HB_CODE", ValueType: "11.2", UOM: "g/dL", LowValue: "13", HighValue: "17", Section: "Haematology" },
    { Analyte: "Creatinine", Value: "CR_CODE", ValueType: "1.4", UOM: "mg/dL", LowValue: "0.6", HighValue: "1.2", Section: "Biochemistry" },
  ],
  MR900002: [
    { Analyte: "Potassium", Value: "K_CODE", ValueType: "5.6", UOM: "mmol/L", LowValue: "3.5", HighValue: "5.1", Section: "Biochemistry" },
  ],
};
/* GHIS "Lab reports": the doctor searches a patient (autocomplete fills a hidden id), the search posts
 * GetSearchPatientId (orders), and opening an order posts GetPrintLabResultDetailsAuth (tests). A print
 * shell (OTLabPrintsSecretary) loads with the form and carries only the patient header block. */
const LAB_ORDERS = {
  MR900001: [
    { parameter_long_desc: "Complete blood count", OrderDate: "17-Sep-2026", Department_desc: "Haematology", pstatus: "Authorization", ServiceRenderId: "770001", episode_id: "IP5550001" },
    { parameter_long_desc: "Renal function test", OrderDate: "16-Sep-2026", Department_desc: "Biochemistry", pstatus: "Authorization", ServiceRenderId: "770002", episode_id: "IP5550001" },
  ],
  MR900002: [
    { parameter_long_desc: "Serum electrolytes", OrderDate: "15-Sep-2026", Department_desc: "Biochemistry", pstatus: "Pending", ServiceRenderId: "770003", episode_id: "IP5550002" },
  ],
};
const LAB_TESTS = {
  770001: [{ TestName: "Haemoglobin", Result: "11.2", Units: "g/dL", LowValue: "13", HighValue: "17" }, { TestName: "Platelet count", Result: "210", Units: "10^3/uL", LowValue: "150", HighValue: "400" }],
  770002: [{ TestName: "Creatinine", Result: "1.4", Units: "mg/dL", LowValue: "0.6", HighValue: "1.2" }],
  770003: [{ TestName: "Potassium", Result: "5.6", Units: "mmol/L", LowValue: "3.5", HighValue: "5.1" }],
};
const LAB_SHELL = (mr) => '<div id="labhdr"><table><tr><th>TEST NAME (METHOD)</th><th>TEST NAME</th><th>RESULTS</th><th>BIOLOGICAL REFERENCE INTERVAL</th><th>UNITS</th></tr><tr><td><table><tr><td>Patient ID</td><td>:</td><td>' + mr + '</td></tr><tr><td>Patient name</td><td>:</td><td>' + (WARD.find((w) => w.MRNo === mr) || {}).PatientName + '</td></tr><tr><td>Visit ID</td><td>:</td><td>' + (WARD.find((w) => w.MRNo === mr) || {}).VisitNo + '</td></tr></table></td></tr></table></div>';
const PAGE = `<!doctype html><html><body>
<input type="hidden" name="__RequestVerificationToken" value="tok-abc">
<table id="wl"><thead><tr><th>MR No</th><th>Visit</th><th>Patient name</th><th>Bed</th></tr></thead><tbody></tbody></table>
<a href="#" id="tc">Treatment chart</a>
<a href="#" id="lb">Labs</a>
<a href="#" id="lr">Lab reports</a>
<div id="medsBox"></div>
<div id="labsBox"></div>
<div id="labForm" style="display:none"><select id="dselect"><option value="PatientID">PatientID</option></select> <input id="txtAuto" type="text"> <input type="hidden" id="hfAutoID"><input type="hidden" id="hfsearchpatientId"> <a href="#" id="btnLabSearch" onclick="SearchPatientId(); return false;"><i class="fa fa-search"></i></a>
<div id="tblSearchBox"></div><div id="divLabSaveResult"></div></div>
<script>
var selected = null;
function xhr(method, url, body, cb) { var x = new XMLHttpRequest(); x.open(method, url); x.setRequestHeader('X-Requested-With', 'XMLHttpRequest'); if (body) x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8'); x.onload = function () { cb(x.responseText); }; x.send(body || null); }
xhr('GET', '/Doctor/Home/GetIPWL?NursingStationId=&Type=IPWorkList&__RequestVerificationToken=tok-abc', null, function (t) {
  var rows = JSON.parse(t).data, tb = document.querySelector('#wl tbody');
  rows.forEach(function (r) { var tr = document.createElement('tr'); tr.innerHTML = '<td>' + r.MRNo + '</td><td>' + r.VisitNo + '</td><td>' + r.PatientName + '</td><td>' + r.BedName + '</td>'; tr.onclick = function () { selected = r; }; tb.appendChild(tr); });
  document.title = 'ready';
});
setInterval(function () { xhr('GET', '/Doctor/Home/DashboardUnit?type=docopdlist', null, function () {}); }, 100);
document.getElementById('lb').onclick = function (e) {
  e.preventDefault();
  document.querySelector('#wl').style.display = 'none';
  xhr('GET', '/Lab/Home/GetResults?id=' + selected.MRNo, null, function (t) {
    var rows = JSON.parse(t), h = '<table id="labsTbl"><thead><tr><th>Test</th><th>Result</th><th>Units</th><th>Range</th></tr></thead><tbody>';
    rows.forEach(function (r) { h += '<tr><td>' + r.Analyte + '</td><td>' + r.ValueType + '</td><td>' + r.UOM + '</td><td>' + r.LowValue + ' - ' + r.HighValue + '</td></tr>'; });
    document.getElementById('labsBox').innerHTML = h + '</tbody></table>'; document.title = 'labs';
  });
};
document.getElementById('lr').onclick = function (e) {
  e.preventDefault();
  document.querySelector('#wl').style.display = 'none';
  document.getElementById('labForm').style.display = '';
  xhr('GET', '/Doctor/Home/OTLabPrintsSecretary/?id=' + (selected ? selected.MRNo : ''), null, function (html) { document.getElementById('divLabSaveResult').innerHTML = html; document.title = 'labform'; });
};
document.getElementById('txtAuto').addEventListener('input', function () {
  var tok = document.querySelector('input[name=__RequestVerificationToken]').value, box = this;
  xhr('POST', '/Lab/Home/GetSearchAutocompletePatient', '__RequestVerificationToken=' + tok + '&SearchName=' + encodeURIComponent(box.value), function (t) {
    var data = JSON.parse(JSON.parse(t)); var ul = document.getElementById('sug') || document.body.appendChild(Object.assign(document.createElement('ul'), { id: 'sug' }));
    ul.innerHTML = data.map(function (d) { return '<li class="ui-menu-item">' + d.PatientID + ' => ' + d.Patientname + '</li>'; }).join('');
    [].forEach.call(ul.children, function (li) { li.onclick = function () { document.getElementById('hfAutoID').value = li.textContent.split('=>')[0].trim(); ul.remove(); }; });
  });
});
function SearchPatientId() {
  var tok = document.querySelector('input[name=__RequestVerificationToken]').value, id = document.getElementById('hfAutoID').value;
  if (!id) return;
  xhr('POST', '/Lab/Home/GetSearchPatientId', '__RequestVerificationToken=' + tok + '&patient_id=' + id + '&DeptID=&FDate=&EDate=', function (t) {
    var rows = JSON.parse(JSON.parse(t)), h = '<table id="tblSearch"><thead><tr><th>Test</th><th>Order date</th><th>Department</th><th>Status</th></tr></thead><tbody>';
    rows.forEach(function (r) { h += '<tr data-rid="' + r.ServiceRenderId + '" data-epi="' + r.episode_id + '"><td>' + r.parameter_long_desc + '</td><td>' + r.OrderDate + '</td><td>' + r.Department_desc + '</td><td>' + r.pstatus + '</td></tr>'; });
    document.getElementById('tblSearchBox').innerHTML = h + '</tbody></table>';
    [].forEach.call(document.querySelectorAll('#tblSearch tbody tr'), function (tr) { tr.onclick = function () { PrintResult(tr.getAttribute('data-rid'), tr.getAttribute('data-epi')); }; });
    document.title = 'laborders';
  });
}
function PrintResult(rid, epi) {
  var tok = document.querySelector('input[name=__RequestVerificationToken]').value;
  xhr('POST', '/Lab/Home/GetPrintLabResultDetailsAuth', '__RequestVerificationToken=' + tok + '&Render_ID=' + rid + '&Episode_Id=' + epi + '&Result_Type=a', function (t) {
    var rows = JSON.parse(t), h = '<table><thead><tr><th>TEST NAME (METHOD)</th><th>TEST NAME</th><th>RESULTS</th><th>BIOLOGICAL REFERENCE INTERVAL</th><th>UNITS</th></tr></thead><tbody>';
    rows.forEach(function (r) { h += '<tr><td></td><td>' + r.TestName + '</td><td>' + r.Result + '</td><td>' + r.LowValue + ' - ' + r.HighValue + '</td><td>' + r.Units + '</td></tr>'; });
    document.getElementById('divLabSaveResult').innerHTML = h + '</tbody></table>'; document.title = 'labresult';
  });
}
document.getElementById('tc').onclick = function (e) {
  e.preventDefault();
  var tok = document.querySelector('input[name=__RequestVerificationToken]').value;
  document.querySelector('#wl').style.display = 'none';
  xhr('POST', '/Doctor/Home/Searchnew', '__RequestVerificationToken=' + tok + '&recordNo=' + selected.MRNo + '-' + selected.VisitNo, function () {
    xhr('GET', '/Doctor/Home/GetSignatureBYid?id=' + selected.MRNo, null, function () {
      xhr('GET', '/Doctor/Home/GetMedicines/?id=' + selected.MRNo, null, function (html) { document.getElementById('medsBox').innerHTML = html; document.title = 'meds'; });
    });
  });
};
</script></body></html>`;

function startEmr() {
  const active = {};
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const sid = /sid=([\w-]+)/.exec(req.headers.cookie || "");
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      if (u.pathname === "/signin") { res.writeHead(302, { "Set-Cookie": "sid=s1; Path=/", Location: "/Doctor/Home" }); return res.end(); }
      if (!sid) { res.writeHead(200, { "Content-Type": "text/html" }); return res.end('<form><input type="password" name="pwd"></form>'); }
      if (u.pathname === "/Doctor/Home") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(PAGE); }
      if (u.pathname === "/Account/Login") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end("{}"); }
      if (u.pathname === "/Doctor/Home/GetIPWL") {
        if (u.searchParams.get("Type") !== "IPWorkList") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end('{"data":[]}'); }
        res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ data: WARD }));
      }
      if (u.pathname === "/Doctor/Home/Searchnew") {
        const p = new URLSearchParams(body);
        if (p.get("__RequestVerificationToken") === "tok-abc") active[sid[1]] = p.get("recordNo");
        res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<html><body><table><tr><th>Chief complaint</th></tr><tr><td><textarea></textarea></td></tr></table></body></html>");
      }
      if (u.pathname === "/Doctor/Home/DashboardUnit") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<table><tr><td>5</td></tr></table>"); }
      if (u.pathname === "/Doctor/Home/GetSignatureBYid") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end('{"Signature":"sig"}'); }
      if (u.pathname === "/Doctor/Home/OTLabPrintsSecretary/") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(LAB_SHELL(u.searchParams.get("id") || "")); }
      if (u.pathname === "/Lab/Home/GetSearchAutocompletePatient") {
        const q = new URLSearchParams(body).get("SearchName") || "";
        res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(JSON.stringify(WARD.filter((w) => w.MRNo.indexOf(q) === 0).map((w) => ({ PatientID: w.MRNo, Patientname: w.PatientName })))));
      }
      if (u.pathname === "/Lab/Home/GetSearchPatientId") {
        const p = new URLSearchParams(body);
        if (p.get("__RequestVerificationToken") !== "tok-abc") { res.writeHead(400); return res.end(); }
        res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(JSON.stringify(LAB_ORDERS[p.get("patient_id")] || [])));
      }
      if (u.pathname === "/Lab/Home/GetPrintLabResultDetailsAuth") {
        const p = new URLSearchParams(body);
        res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(LAB_TESTS[p.get("Render_ID")] || []));
      }
      if (u.pathname === "/Lab/Home/GetResults") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(LABS[u.searchParams.get("id")] || [])); }
      if (u.pathname === "/Doctor/Home/GetMedicines/") {
        const rec = active[sid[1]] || "";
        const rows = rec.split("-")[0] === u.searchParams.get("id") ? MEDS[rec] || [] : [];
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end("<table><thead><tr><th>Drug</th><th>Route</th><th>Frequency</th></tr></thead><tbody>" + rows.map((r) => "<tr><td>" + r.join("</td><td>") + "</td></tr>").join("") + "</tbody></table>");
      }
      res.writeHead(404); res.end();
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, origin: "http://127.0.0.1:" + server.address().port })));
}

/* The runtime parses a response in the APP WebView, which has DOMParser; this Node harness does not.
 * Just enough DOM for rowsFromHtml's table reading (table, th, tr, td, a[href]). Test-only. */
function tinyDom(html) {
  const findAll = (src, sel) => {
    const t = (/^([a-z]+)(\[href\])?$/.exec(sel) || [])[1];
    if (!t) return [];
    return [...src.matchAll(new RegExp("<" + t + "\\b([^>]*)>([\\s\\S]*?)</" + t + ">", "gi"))].map((m) => node(t, m[2], m[1]));
  };
  const node = (tag, inner, attrs) => ({
    tagName: tag.toUpperCase(), textContent: inner.replace(/<[^>]+>/g, ""),
    getAttribute: (n) => (new RegExp(n + '="([^"]*)"').exec(attrs) || [])[1] || null,
    querySelectorAll: (sel) => sel.split(",").flatMap((s) => findAll(inner, s.trim())),
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
  });
  return node("html", html, "");
}

let msgId = 1;
const pending = new Map();
let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
async function waitFor(expr, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await call("Runtime.evaluate", { expression: expr, returnByValue: true });
    if (r.result && r.result.result && r.result.result.value) return true;
    await sleep(100);
  }
  return false;
}

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
      async evaluate({ expression }) {
        const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
        return { result: r.result && r.result.result ? r.result.result.value ?? null : null };
      },
      async currentUrl() { const r = await call("Runtime.evaluate", { expression: "location.href", returnByValue: true }); return { url: r.result.result.value }; },
      async setMode() { return {}; }, async drainRequests() { return { requests: [] }; }, async close() { return {}; },
    };
    const client = createPluginClient({ plugin: raw, storeId: "s", origins: [emr.origin], title: "EMR" });
    // Sign in (cookie), land on the ward list: the observer is installed at document start by initScript.
    await client.createTab({ url: emr.origin + "/signin" });
    ok(await waitFor("document.title==='ready'"), "ward list filled itself by XHR after sign-in");
    await client.evaluate({ expression: "fetch('/Account/Login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'user=doc&pwd=hunter2'})" });
    await sleep(2500); // the poll fires ~25 times meanwhile
    const buf = JSON.parse((await client.evaluate({ expression: "JSON.stringify(window.__SMD_REPLAY__.list)" })).result);
    ok(buf.some((e) => /GetIPWL/.test(e.url) && e.shape.kind === "json" && e.shape.keys.includes("MRNo")), "replay buffer kept the page-load ward list call with its response structure");
    ok(!buf.some((e) => /Login/.test(e.url) || /hunter2/.test(e.body || "")), "a sign-in body is never kept");
    ok(buf.filter((e) => /DashboardUnit/.test(e.url)).length === 1, "a poll is one entry, not a flood that pushes the page-load call out");

    const asked = [];
    const brain = { async pickEndpoint(p) { asked.push(p); const i = p.candidates.length; return { ranked: p.candidates.map((c, k) => ({ index: i - 1 - k, role: "data" })).reverse(), model: "gemini-3.8-flash" }; } };
    const book = createProofBook({ brain });
    const wl = { resourceHint: "worklist", pathTemplate: emr.origin + "/Doctor/Home", rowsSelector: "#wl tbody tr", headers: ["MR No", "Visit", "Patient name", "Bed"] };
    await book.prove({ client, view: wl, label: "open the patient list", since: 0 });
    ok(wl.proof.status === "proven" && wl.endpoints.at(-1).path.startsWith("/Doctor/Home/GetIPWL"), "ward list call proven against the rows on screen: " + JSON.stringify(wl.proof));
    ok(JSON.stringify(wl.endpoints.at(-1).params) === JSON.stringify({ NursingStationId: { empty: true }, Type: { constant: "IPWorkList" }, __RequestVerificationToken: { token: true } }), "ward list fields learned: " + JSON.stringify(wl.endpoints.at(-1).params));

    // The doctor's action: open patient one, tap Treatment chart.
    await client.evaluate({ expression: GUIDE_SOURCES.arm });
    await client.evaluate({ expression: "document.querySelectorAll('#wl tbody tr')[0].click(); document.getElementById('tc').click(); 'ok'" });
    ok(await waitFor("document.title==='meds'"), "the medicines panel rendered");
    const meds = { resourceHint: "medications", pathTemplate: emr.origin + "/Doctor/Home", rowsSelector: "#medsBox tbody tr", headers: ["Drug", "Route", "Frequency"] };
    await book.prove({ client, view: meds, label: "tap Treatment chart" });
    ok(asked.length === 2 && !/MR9000|TEST ALPHA|Paracetamol|tok-abc/.test(JSON.stringify(asked)), "the brain was asked twice with structure only");
    ok(meds.proof.status === "proven" && meds.proof.model === "gemini-3.8-flash" && meds.proof.tried >= 2, "medicines proven after rejecting the calls ranked above it: " + JSON.stringify(book.trace.at(-1).attempts));
    ok(JSON.stringify(meds.endpoints.map((e) => [e.role, e.method, e.path])) === JSON.stringify([["prerequisite", "POST", "/Doctor/Home/Searchnew"], ["data", "GET", "/Doctor/Home/GetMedicines/?id"]]), "saved endpoints: activation then medicines " + JSON.stringify(meds.endpoints.map((e) => e.path)));
    ok(JSON.stringify(meds.endpoints[0].params.recordNo) === JSON.stringify({ from: "worklist", fields: ["MRNo", "VisitNo"], join: "-" }), "activation's record number traced to the ward list MR and visit columns");
    ok(!/MR9000|tok-abc|TEST|Paracetamol/.test(JSON.stringify([wl, meds])), "nothing identifying is in the saved views");

    // The adapter, replayed for the OTHER patient exactly as Ward Sync would.
    const patients = mapRows(rowsFromJson({ data: WARD }).map((r) => Object.assign({ "Patient ID": r.MRNo, "Patient name": r.PatientName }, r)));
    const calls = [];
    const out = await executeView({ plugin: client, origin: emr.origin, view: meds, patient: patients[1], parseHtml: tinyDom, onCall: (c) => calls.push(c.method + " " + c.url.replace(emr.origin, "") + (c.body ? " " + c.body : "")) });
    console.log("  replayed: " + JSON.stringify(calls) + " kind=" + out.kind);
    ok(out.proven && out.rows.length === 2 && /Metformin/.test(JSON.stringify(out.rows)) && !/Paracetamol/.test(JSON.stringify(out.rows)), "proven adapter returned patient two's medicines, not patient one's: " + out.rows.length + " rows");

    // LAB RESULTS with a misleading payload: prove the columns are learned by value in a real browser,
    // then read them back through the shim and check they equal what the doctor saw on the screen.
    await client.navigate({ url: emr.origin + "/Doctor/Home" });
    ok(await waitFor("document.title==='ready'"), "back on the ward list for the labs read");
    await client.evaluate({ expression: GUIDE_SOURCES.arm });
    await client.evaluate({ expression: "document.querySelectorAll('#wl tbody tr')[0].click(); document.getElementById('lb').click(); 'ok'" });
    ok(await waitFor("document.title==='labs'"), "the labs results table rendered");
    const labs = { resourceHint: "labs", pathTemplate: emr.origin + "/Doctor/Home", rowsSelector: "#labsTbl tbody tr", headers: ["Test", "Result", "Units", "Range"] };
    await book.prove({ client, view: labs, label: "open Labs" });
    ok(labs.proof.status === "proven" && labs.endpoints.at(-1).path.startsWith("/Lab/Home/GetResults"), "labs results call proven: " + JSON.stringify(labs.proof));
    ok(labs.columns && labs.columns.Result && labs.columns.Result.key === "ValueType", "Result column learned to ValueType (the on-screen number), not the Value code: " + JSON.stringify(labs.columns));
    ok(labs.columns.Range && Array.isArray(labs.columns.Range.keys) && labs.columns.Range.keys.join(",") === "LowValue,HighValue", "Range column learned as two joined fields: " + JSON.stringify(labs.columns.Range));
    ok(!/HB_CODE|11\.2|Haemoglobin/.test(JSON.stringify({ p: labs.proof, c: labs.columns, e: labs.endpoints })), "no cell value is in the saved labs view");

    const labCalls = [];
    const labOut = await executeView({ plugin: client, origin: emr.origin, view: labs, patient: patients[0], parseHtml: tinyDom, onCall: (c) => labCalls.push(c.method + " " + c.url.replace(emr.origin, "")) });
    const labsSection = [{ resource: "labs", rows: labOut.rows }];
    const orders = serveGhisProxy({ path: "/lab?patientId=MR900001", sections: labsSection, patient: patients[0] }).body.orders;
    const det = serveGhisProxy({ path: "/lab-detail?renderId=" + orders[0].renderId, sections: labsSection, patient: patients[0] }).body;
    const hb = det.tests.find((t) => /Haemoglobin/.test(t.test));
    ok(hb && hb.result === "11.2" && hb.units === "g/dL" && hb.range === "13 - 17", "shim reads the result the doctor saw, not the code: " + JSON.stringify(hb && { r: hb.result, u: hb.units, rng: hb.range }));

    // LAB REPORTS AS A SEARCH FORM (the live GHIS shape, 2026-09-17). The doctor opens "Lab reports" and
    // taps Done on the empty form: the print shell behind it must NOT be proven as labs; verification
    // must then search for a real patient there, prove the search call, and open one order for the chain.
    await client.navigate({ url: emr.origin + "/Doctor/Home" });
    ok(await waitFor("document.title==='ready'"), "back on the ward list for the lab reports screen");
    await client.evaluate({ expression: GUIDE_SOURCES.arm });
    await client.evaluate({ expression: GUIDE_SOURCES.armGuide });
    await client.evaluate({ expression: "document.querySelectorAll('#wl tbody tr')[0].click(); document.getElementById('lr').click(); 'ok'" });
    ok(await waitFor("document.title==='labform'"), "the lab reports form and its print shell rendered");
    const guidedPath = JSON.parse((await client.evaluate({ expression: GUIDE_SOURCES.guidePath })).result || "[]");
    const labForm = { resourceHint: "labs", pathTemplate: emr.origin + "/Doctor/Home", rowsSelector: "#divLabSaveResult table tbody tr", headers: ["TEST NAME (METHOD)", "TEST NAME", "RESULTS", "BIOLOGICAL REFERENCE INTERVAL", "UNITS"], guidedPath: guidedPath.filter((g) => !/^(tr|td|th)/.test(g)) };
    await book.prove({ client, view: labForm, label: "open Lab reports" });
    ok(labForm.proof.status !== "proven", "the print shell (patient header block, no results) is NOT proven as labs: " + JSON.stringify(labForm.proof));
    const views = [wl, labForm];
    console.log("  guidedPath: " + JSON.stringify(labForm.guidedPath));
    const vres = await verifyViews({ plugin: client, origin: emr.origin, views, book, parseHtml: tinyDom, waitMs: 1500, notify: (ph, x) => console.log("  verify " + ph + " " + JSON.stringify(x)) });
    console.log("  after verify: " + JSON.stringify((await client.evaluate({ expression: "JSON.stringify({title:document.title,form:document.getElementById('labForm').style.display,inputs:[].slice.call(document.querySelectorAll('input[type=text]')).map(function(i){return i.id+':'+(i.getClientRects().length?'vis':'hid')}),orders:document.querySelectorAll('#tblSearch tbody tr').length,url:location.pathname})" })).result));
    console.log("  labForm proof: " + JSON.stringify(labForm.proof) + " searched=" + JSON.stringify(labForm.searched) + " sel=" + labForm.rowsSelector + " chain=" + JSON.stringify(labForm.chain));
    console.log("  book trace tail: " + JSON.stringify(book.trace.slice(-2)).slice(0, 1500));
    const chk = Object.fromEntries(vres.checks.map((c) => [c.resource, c]));
    ok(labForm.proof.status === "proven" && labForm.endpoints.some((e) => e.role === "data" && e.method === "POST" && e.path === "/Lab/Home/GetSearchPatientId"), "verification searched for the patient on the form and proved the order-list call: " + JSON.stringify(labForm.endpoints && labForm.endpoints.map((e) => e.method + " " + e.path)) + " searched=" + JSON.stringify(labForm.searched));
    ok(labForm.endpoints && labForm.endpoints.some((e) => e.role === "data" && e.params && e.params.patient_id && e.params.patient_id.from === "worklist"), "patient_id traced to the ward list: " + JSON.stringify((labForm.endpoints || []).map((e) => e.params)));
    ok(chk.labs && chk.labs.ok && chk.labs.rows === 2, "labs verified with the two orders of the first patient: " + JSON.stringify(chk.labs));
    const labDetail = views.find((v) => v.resourceHint === "labs-detail");
    ok(labDetail && labDetail.proof.status === "proven" && labDetail.endpoints.some((e) => e.role === "data" && e.path === "/Lab/Home/GetPrintLabResultDetailsAuth"), "one order was opened and the result print call proven as the chain: " + JSON.stringify(labDetail && labDetail.endpoints && labDetail.endpoints.map((e) => e.method + " " + e.path + " " + JSON.stringify(e.params))));
    // Replayed for the OTHER patient: her order, then its tests.
    const ord2 = await executeView({ plugin: client, origin: emr.origin, view: labForm, patient: patients[1], parseHtml: tinyDom });
    ok(ord2 && ord2.rows.length === 1 && /Serum electrolytes/.test(JSON.stringify(ord2.rows)), "the order list replayed for patient two: " + JSON.stringify(ord2 && ord2.rows.map((r) => r.parameter_long_desc)));
    const det2 = labDetail && await executeView({ plugin: client, origin: emr.origin, view: labDetail, patient: patients[1], parentRow: ord2.rows[0], parseHtml: tinyDom });
    ok(det2 && det2.rows.length === 1 && /Potassium/.test(JSON.stringify(det2.rows)) && /5\.6/.test(JSON.stringify(det2.rows)), "her result print replayed through the chain: " + JSON.stringify(det2 && det2.rows));
    ok(!/MR9000|TEST ALPHA|TEST BRAVO|Haemoglobin|Potassium|tok-abc/.test(JSON.stringify([labForm, labDetail])), "nothing identifying is in the saved lab views");
  } finally {
    try { chrome.kill(); } catch { /* gone */ }
    emr.server.close();
  }
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
