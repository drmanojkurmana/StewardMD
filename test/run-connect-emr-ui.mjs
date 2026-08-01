/* Connect EMR onboarding admin page smoke test (headless Chrome via CDP).
 * Verifies: the page loads with ZERO console errors / uncaught exceptions; the Add-connection form renders;
 * the auth-method + type toggles work; the CSV one-shot upload + HL7-feed create + Webhook create + REST/JSON
 * save-and-test flows render (REST: type toggle shows #fRest and hides the rest, POSTs /emr with type
 * rest-json + the entered fields, then /test/:id, renders REST-specific success copy, and degrades to the
 * same flag-off state on a 404); the Part-3 tenant PICKER populates from a MOCKED GET /tenants (multi-tenant
 * shows a placeholder + no auto-select; a single tenant auto-selects); the unified Connections DASHBOARD
 * renders MERGED FHIR + HL7 rows from a MOCKED GET /all (with type badges, status, and per-type actions, and
 * NEVER a secret); Delete/Copy actions call the right endpoints; the no-membership empty state shows when
 * /tenants is empty; and a MOCKED 404 shows the graceful "not enabled yet" flag-off state (not a crash).
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
  for (let i = 0; i < 60; i++) { await sleep(300); if (await ev(`return !!(window.ConnectEMR && window.ConnectEMR.loadDashboard)`) === true) return true; }
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
  ok(await ev(`var o=[].slice.call(document.querySelectorAll('#aType option')); var en=o.filter(function(x){return !x.disabled;}).map(function(x){return x.value;}); var dis=o.filter(function(x){return x.disabled;}); return o.length>=6 && en.indexOf("fhir")>=0 && en.indexOf("csv")>=0 && en.indexOf("hl7")>=0 && en.indexOf("webhook")>=0 && en.indexOf("rest")>=0 && dis.length>=1 && dis.every(function(x){return x.value==="dicom";});`) === true, "type picker shows FHIR + CSV + HL7 + Webhook + REST active and DICOM disabled 'coming soon'");
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

  // HL7 v2 feed type: activates the HL7 subform; create returns the ingest URL + a one-time signing secret +
  // the signed-POST config hint. (The created feed then surfaces in the unified dashboard, tested below.)
  ok(await ev(`document.getElementById("aType").value="hl7"; document.getElementById("aType").onchange(); return getComputedStyle(document.getElementById("fHl7")).display!=="none" && getComputedStyle(document.getElementById("fFhir")).display==="none" && getComputedStyle(document.getElementById("fCsv")).display==="none";`) === true, "HL7 type activates the HL7 feed subform and hides the FHIR + CSV fields");
  await ev(`window.ConnectEMR.setTenant("t-hl7"); window.ConnectEMR.setName("GIMSR Lab Feed"); window.ConnectEMR.setHl7Types("ORU^R01");
    window.ConnectEMR.__setApi(function(path,opts){
      if(opts&&opts.method==="POST"){ return Promise.resolve({s:200,d:{ok:true,feedId:"feed-abc123",ingestUrl:"https://stewardmd.in/api/connect/ingress/hl7",secret:"S3CR3T-HMAC-KEY-0001",headers:{feed:"X-SMD-Feed",timestamp:"X-SMD-Timestamp",signature:"X-SMD-Signature"},allowedMessageTypes:["ORU^R01"]}}); }
      return Promise.resolve({s:200,d:{ok:true,fhir:[],hl7:[],counts:{fhir:0,hl7:0,total:0}}});
    }); window.ConnectEMR.hl7Create(); return 1;`);
  await sleep(300);
  ok(await ev(`var r=document.getElementById("hl7Result"); return getComputedStyle(r).display!=="none" && document.getElementById("hl7Url").textContent.indexOf("/api/connect/ingress/hl7")>=0 && document.getElementById("hl7Secret").value==="S3CR3T-HMAC-KEY-0001";`) === true, "HL7 create shows the real ingest URL and the one-time signing secret");
  ok(await ev(`var h=document.getElementById("hl7Hint").innerHTML; return h.indexOf("HMAC-SHA256")>=0 && h.indexOf("X-SMD-Signature")>=0 && h.indexOf("feed-abc123")>=0 && h.indexOf("\\u2014")<0;`) === true, "HL7 config hint explains the signed-POST contract (no em-dash)");
  // reset back to FHIR
  await ev(`document.getElementById("aType").value="fhir"; document.getElementById("aType").onchange(); return 1;`);

  // Webhook / FHIR push type: activates the webhook subform; create returns the ingest URL (/ingress/fhir) +
  // a one-time signing secret + the signed-POST config hint (POST a FHIR Bundle/resource).
  ok(await ev(`document.getElementById("aType").value="webhook"; document.getElementById("aType").onchange(); return getComputedStyle(document.getElementById("fWebhook")).display!=="none" && getComputedStyle(document.getElementById("fFhir")).display==="none" && getComputedStyle(document.getElementById("fHl7")).display==="none";`) === true, "Webhook type activates the webhook subform and hides the FHIR + HL7 fields");
  await ev(`window.ConnectEMR.setTenant("t-wh"); window.ConnectEMR.setName("EMR Push");
    window.ConnectEMR.__setApi(function(path,opts){
      if(opts&&opts.method==="POST"){ return Promise.resolve({s:200,d:{ok:true,feedId:"wh-abc123",ingestUrl:"https://stewardmd.in/api/connect/ingress/fhir",secret:"WH-HMAC-KEY-0001",headers:{feed:"X-SMD-Feed",timestamp:"X-SMD-Timestamp",signature:"X-SMD-Signature"}}}); }
      return Promise.resolve({s:200,d:{ok:true,fhir:[],hl7:[],webhook:[],counts:{fhir:0,hl7:0,webhook:0,total:0}}});
    }); window.ConnectEMR.webhookCreate(); return 1;`);
  await sleep(300);
  ok(await ev(`var r=document.getElementById("whResult"); return getComputedStyle(r).display!=="none" && document.getElementById("whUrl").textContent.indexOf("/api/connect/ingress/fhir")>=0 && document.getElementById("whSecret").value==="WH-HMAC-KEY-0001";`) === true, "Webhook create shows the real FHIR-push ingest URL and the one-time signing secret");
  ok(await ev(`var h=document.getElementById("whHint").innerHTML; return h.indexOf("HMAC-SHA256")>=0 && h.indexOf("X-SMD-Signature")>=0 && h.indexOf("wh-abc123")>=0 && h.indexOf("FHIR")>=0 && h.indexOf("\\u2014")<0;`) === true, "Webhook config hint explains the signed FHIR-push contract (no em-dash)");
  // reset back to FHIR
  await ev(`document.getElementById("aType").value="fhir"; document.getElementById("aType").onchange(); return 1;`);

  // REST / JSON lab API type: activates the REST subform (hides FHIR/Detect + CSV + HL7 + Webhook); Save-and-test
  // builds {type:"rest-json", baseUrl, auth:{method:"token",token,headerName?}, resultsPath?, patientParam?} exactly
  // per the backend contract, POSTs /emr then /test/:id (same two-step flow as the FHIR add/save-and-test), and
  // renders a REST-specific success message (not a FHIR-version string) through the shared say()/testMsg() path.
  ok(await ev(`document.getElementById("aType").value="rest"; document.getElementById("aType").onchange(); return getComputedStyle(document.getElementById("fRest")).display!=="none" && getComputedStyle(document.getElementById("fFhir")).display==="none" && getComputedStyle(document.getElementById("fCsv")).display==="none" && getComputedStyle(document.getElementById("fHl7")).display==="none" && getComputedStyle(document.getElementById("fWebhook")).display==="none";`) === true, "REST type activates the REST subform and hides the FHIR (+ Detect) + CSV + HL7 + Webhook fields");
  await ev(`window.ConnectEMR.setTenant("t-rest"); window.ConnectEMR.setName("Lab REST API");
    document.getElementById("aRestBase").value="https://labs.example.org/api";
    document.getElementById("aRestToken").value="rest-tok-1";
    document.getElementById("aRestPath").value="/lab-results";
    window.__restSaved=null;
    window.ConnectEMR.__setApi(function(path,opts){
      if(opts&&opts.method==="POST"&&path.indexOf("/emr")>=0){ window.__restSaved=JSON.parse(opts.body); return Promise.resolve({s:200,d:{ok:true,connectionId:"rest-1"}}); }
      if(opts&&opts.method==="POST"&&path.indexOf("/test/rest-1")>=0){ return Promise.resolve({s:200,d:{ok:true}}); }
      return Promise.resolve({s:200,d:{ok:true,fhir:[],hl7:[],webhook:[],counts:{fhir:0,hl7:0,webhook:0,total:0}}});
    });
    window.ConnectEMR.restSaveTest(); return 1;`);
  await sleep(300);
  ok(await ev(`var b=window.__restSaved; return !!b && b.type==="rest-json" && b.baseUrl==="https://labs.example.org/api" && b.tenantId==="t-rest" && b.name==="Lab REST API" && b.auth&&b.auth.method==="token" && b.auth.token==="rest-tok-1" && b.resultsPath==="/lab-results" && !("headerName" in (b.auth||{})) && !("patientParam" in b);`) === true, "REST Save-and-test POSTs /emr with type rest-json + baseUrl + token auth + resultsPath (optional fields omitted when blank)");
  ok(await ev(`var m=document.getElementById("restMsg"); return m.className.indexOf("ok")>=0 && m.textContent.indexOf("results endpoint responded correctly")>=0 && m.textContent.indexOf("\\u2014")<0;`) === true, "REST Save-and-test reports success with REST-specific copy (not a FHIR version string), no em-dash");
  ok(await ev(`return document.getElementById("aRestBase").value===""&&document.getElementById("aRestToken").value==="";`) === true, "REST form clears after a successful save");
  // reset back to FHIR
  await ev(`document.getElementById("aType").value="fhir"; document.getElementById("aType").onchange(); return 1;`);

  // ---- Part 3: tenant PICKER (GET /tenants -> the caller's own memberships) ----
  // Multi-tenant: the dropdown lists every membership (name + role), keeps a placeholder, and does NOT auto-select.
  await ev(`window.ConnectEMR.__setApi(function(path){ if(path.indexOf("/tenants")>=0) return Promise.resolve({s:200,d:{ok:true,tenants:[{tenantId:"t-a",name:"GIMSR Hospital",role:"admin"},{tenantId:"t-b",role:"owner"}]}}); return Promise.resolve({s:200,d:{ok:true,fhir:[],hl7:[],counts:{fhir:0,hl7:0,total:0}}}); }); window.ConnectEMR.loadTenants(); return 1;`);
  await sleep(300);
  ok(await ev(`var o=[].slice.call(document.querySelectorAll('#tenantSel option')); var vals=o.map(function(x){return x.value;}); var txt=o.map(function(x){return x.textContent;}).join("|"); return o.length===3 && vals.indexOf("t-a")>=0 && vals.indexOf("t-b")>=0 && txt.indexOf("GIMSR Hospital (admin)")>=0 && txt.indexOf("t-b (owner)")>=0 && document.getElementById("tenantSel").value==="";`) === true, "multi-tenant /tenants populates the dropdown (name + role) with a placeholder and NO auto-select");
  ok(await ev(`return getComputedStyle(document.getElementById("noTenant")).display==="none" && getComputedStyle(document.getElementById("opsArea")).display!=="none";`) === true, "with memberships, the ops area is shown and the no-membership state is hidden");

  // Single-tenant: auto-selects and loads its dashboard.
  await ev(`window.ConnectEMR.__setApi(function(path){ if(path.indexOf("/tenants")>=0) return Promise.resolve({s:200,d:{ok:true,tenants:[{tenantId:"solo-hosp",name:"Solo Hospital",role:"owner"}]}}); return Promise.resolve({s:200,d:{ok:true,fhir:[],hl7:[],counts:{fhir:0,hl7:0,total:0}}}); }); window.ConnectEMR.loadTenants(); return 1;`);
  await sleep(300);
  ok(await ev(`var o=document.querySelectorAll('#tenantSel option'); return o.length===1 && document.getElementById("tenantSel").value==="solo-hosp";`) === true, "a single tenant AUTO-selects (no placeholder; dropdown value = the tenant id)");
  ok(await ev(`return document.getElementById("dash").innerHTML.indexOf("No connections yet")>=0;`) === true, "auto-select triggers the dashboard load (empty state for a tenant with no connections)");

  // ---- Part 3: unified DASHBOARD (GET /all) MERGES FHIR connections + HL7 feeds into one table ----
  await ev(`window.ConnectEMR.__setApi(function(path){ if(path.indexOf("/all")>=0) return Promise.resolve({s:200,d:{ok:true,counts:{fhir:1,hl7:1,webhook:1,total:3},fhir:[{connectionId:"c-1",name:"Smoke Hospital FHIR",type:"fhir",fhirBaseUrl:"https://r4.smarthealthit.org/fhir",authMethod:"token",status:"active",lastTest:{ok:true,fhirVersion:"4.0.1",softwareName:"SMART Reference Server"}}],hl7:[{feedId:"feed-xyz",name:"GIMSR Lab Feed",status:"active",allowedMessageTypes:["ORU^R01"]}],webhook:[{feedId:"wh-xyz",name:"EMR Push Feed",status:"active",connector:"fhir-push"}]}}); return Promise.resolve({s:200,d:{ok:true,tenants:[{tenantId:"solo-hosp",name:"Solo Hospital",role:"owner"}]}}); }); window.ConnectEMR.loadDashboard(); return 1;`);
  await sleep(300);
  ok(await ev(`return !!document.querySelector('#dash table.dash');`) === true, "the dashboard renders a single table");
  ok(await ev(`var h=document.getElementById("dash").innerHTML; return h.indexOf("Smoke Hospital FHIR")>=0 && h.indexOf(">FHIR<")>=0 && h.indexOf("r4.smarthealthit.org")>=0 && h.indexOf("Connected")>=0 && h.indexOf('data-act="test"')>=0 && h.indexOf('data-act="pull"')>=0 && h.indexOf('data-act="del"')>=0;`) === true, "the FHIR row renders with a FHIR badge, host, Connected status, and Test/Pull/Delete");
  ok(await ev(`var h=document.getElementById("dash").innerHTML; return h.indexOf("GIMSR Lab Feed")>=0 && h.indexOf("HL7 v2")>=0 && h.indexOf("feed-xyz")>=0 && h.indexOf('data-fact="copy"')>=0 && h.indexOf('data-fact="del"')>=0;`) === true, "the HL7 feed row renders in the SAME table with an HL7 badge, feed id, and Copy URL / Delete");
  ok(await ev(`var h=document.getElementById("dash").innerHTML; return h.indexOf("EMR Push Feed")>=0 && h.indexOf("FHIR push")>=0 && h.indexOf("wh-xyz")>=0 && h.indexOf('data-wact="copy"')>=0 && h.indexOf('data-wact="del"')>=0;`) === true, "the webhook feed row renders in the SAME table with a FHIR push badge, feed id, and Copy URL / Delete");
  ok(await ev(`var c=document.getElementById("dashCounts").textContent; return c.indexOf("3 connection")>=0 && c.indexOf("1 FHIR")>=0 && c.indexOf("1 HL7")>=0 && c.indexOf("1 Webhook")>=0;`) === true, "the dashboard shows merged counts (3 total = 1 FHIR + 1 HL7 + 1 Webhook)");
  ok(await ev(`var h=document.getElementById("dash").innerHTML; return h.indexOf("S3CR3T")<0 && h.indexOf("sealed")<0 && h.indexOf("\\u2014")<0;`) === true, "NO secret material in the dashboard DOM, and no em-dash");

  // Copy URL (HL7) surfaces the constant webhook URL; Delete actions call the right endpoints and reload.
  await ev(`document.querySelector('#dash [data-fact="copy"]').click(); window.__msgs=document.getElementById("tenantMsg").textContent; return 1;`);
  ok(await ev(`return window.__msgs.indexOf("/api/connect/ingress/hl7")>=0;`) === true, "HL7 Copy URL surfaces the constant ingest webhook URL");
  await ev(`window.__del=[]; window.confirm=function(){return true;};
    window.ConnectEMR.__setApi(function(path,opts){ if(opts&&opts.method==="DELETE"){ window.__del.push(path); return Promise.resolve({s:200,d:{ok:true}}); } return Promise.resolve({s:200,d:{ok:true,fhir:[],hl7:[],counts:{fhir:0,hl7:0,total:0}}}); });
    document.querySelector('#dash [data-act="del"]').click(); return 1;`);
  await sleep(300);
  ok(await ev(`return window.__del.length===1 && window.__del[0].indexOf("/onboard/c-1")>=0 && document.getElementById("dash").innerHTML.indexOf("No connections yet")>=0;`) === true, "FHIR Delete calls DELETE /onboard/<id> and the dashboard reloads empty");
  // re-render both rows locally, then delete the HL7 feed
  await ev(`window.ConnectEMR.renderDash([{connectionId:"c-1",name:"X",type:"fhir",fhirBaseUrl:"https://h/fhir",authMethod:"token"}],[{feedId:"feed-xyz",name:"F",status:"active",allowedMessageTypes:[]}],{fhir:1,hl7:1,total:2}); window.__del=[]; document.querySelector('#dash [data-fact="del"]').click(); return 1;`);
  await sleep(300);
  ok(await ev(`return window.__del.length===1 && window.__del[0].indexOf("/hl7-feed/feed-xyz")>=0;`) === true, "HL7 Delete calls DELETE /hl7-feed/<id>");
  // re-render with a webhook row, then delete the webhook feed
  await ev(`window.ConnectEMR.renderDash([],[],{fhir:0,hl7:0,webhook:1,total:1},[{feedId:"wh-xyz",name:"W",status:"active"}]); window.__del=[]; document.querySelector('#dash [data-wact="del"]').click(); return 1;`);
  await sleep(300);
  ok(await ev(`return window.__del.length===1 && window.__del[0].indexOf("/webhook-feed/wh-xyz")>=0;`) === true, "Webhook Delete calls DELETE /webhook-feed/<id>");

  // ---- Part 3: no-membership empty state (GET /tenants -> []) ----
  await ev(`window.ConnectEMR.__setApi(function(){ return Promise.resolve({s:200,d:{ok:true,tenants:[]}}); }); window.ConnectEMR.loadTenants(); return 1;`);
  await sleep(200);
  ok(await ev(`return getComputedStyle(document.getElementById("noTenant")).display!=="none" && getComputedStyle(document.getElementById("opsArea")).display==="none" && document.getElementById("noTenant").textContent.indexOf("not a member of any hospital tenant")>=0;`) === true, "an empty /tenants shows the 'not a member of any hospital tenant' state and hides the ops area");

  // MOCKED 404 -> graceful flag-off state (the picker route only exists when the flag is on)
  await ev(`window.ConnectEMR.__setApi(function(){ return Promise.resolve({s:404,d:{error:"not_found"}}); }); window.ConnectEMR.loadTenants(); return 1;`);
  await sleep(200);
  ok(await ev(`return window.ConnectEMR.flagOffVisible()===true && getComputedStyle(document.getElementById("work")).display==="none";`) === true, "a 404 shows the graceful 'not enabled yet' state and hides the workspace");

  // rest-json degrades through the SAME showFlagOff() path as every other type (no special-casing in doRestSave).
  await ev(`window.ConnectEMR.setTenant("t-final"); document.getElementById("aName").value="Lab Final";
    document.getElementById("aRestBase").value="https://labs.example.org"; document.getElementById("aRestToken").value="tok-1";
    window.ConnectEMR.__setApi(function(){ return Promise.resolve({s:404,d:{error:"not_found"}}); });
    window.ConnectEMR.restSaveTest(); return 1;`);
  await sleep(200);
  ok(await ev(`return window.ConnectEMR.flagOffVisible()===true;`) === true, "REST save-and-test on a 404 (flag off) also shows the graceful 'not enabled yet' state, not a console error");

  ok(consoleErrors.length === 0, "zero console errors / uncaught exceptions" + (consoleErrors.length ? " -> " + JSON.stringify(consoleErrors.slice(0, 4)) : ""));

  console.log(fails === 0 ? "\nALL GREEN - Connect EMR admin page smoke test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e && e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
