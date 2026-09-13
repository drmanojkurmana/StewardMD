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
const PAGE = `<!doctype html><html><body>
<input type="hidden" name="__RequestVerificationToken" value="tok-abc">
<table id="wl"><thead><tr><th>MR No</th><th>Visit</th><th>Patient name</th><th>Bed</th></tr></thead><tbody></tbody></table>
<a href="#" id="tc">Treatment chart</a>
<div id="medsBox"></div>
<script>
var selected = null;
function xhr(method, url, body, cb) { var x = new XMLHttpRequest(); x.open(method, url); x.setRequestHeader('X-Requested-With', 'XMLHttpRequest'); if (body) x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8'); x.onload = function () { cb(x.responseText); }; x.send(body || null); }
xhr('GET', '/Doctor/Home/GetIPWL?NursingStationId=&Type=IPWorkList&__RequestVerificationToken=tok-abc', null, function (t) {
  var rows = JSON.parse(t).data, tb = document.querySelector('#wl tbody');
  rows.forEach(function (r) { var tr = document.createElement('tr'); tr.innerHTML = '<td>' + r.MRNo + '</td><td>' + r.VisitNo + '</td><td>' + r.PatientName + '</td><td>' + r.BedName + '</td>'; tr.onclick = function () { selected = r; }; tb.appendChild(tr); });
  document.title = 'ready';
});
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
      if (u.pathname === "/Doctor/Home/GetSignatureBYid") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end('{"Signature":"sig"}'); }
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
    await sleep(300);
    const buf = JSON.parse((await client.evaluate({ expression: "JSON.stringify(window.__SMD_REPLAY__.list)" })).result);
    ok(buf.some((e) => /GetIPWL/.test(e.url) && e.shape.kind === "json" && e.shape.keys.includes("MRNo")), "replay buffer kept the page-load ward list call with its response structure");
    ok(!buf.some((e) => /Login/.test(e.url) || /hunter2/.test(e.body || "")), "a sign-in body is never kept");

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
  } finally {
    try { chrome.kill(); } catch { /* gone */ }
    emr.server.close();
  }
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
