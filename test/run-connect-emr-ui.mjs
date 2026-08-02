/* Connect EMR onboarding admin page smoke test (headless Chrome via CDP).
 * Verifies: the page loads with ZERO console errors / uncaught exceptions; the Add-connection form renders;
 * the auth-method + type toggles work; the CSV one-shot upload + HL7-feed create + Webhook create + REST/JSON
 * save-and-test flows render (REST: type toggle shows #fRest and hides the rest, POSTs /emr with type
 * rest-json + the entered fields, then /test/:id, renders REST-specific success copy, and degrades to the
 * same flag-off state on a 404); the Part-3 tenant PICKER populates from a MOCKED GET /tenants (multi-tenant
 * shows a placeholder + no auto-select; a single tenant auto-selects); the unified Connections DASHBOARD
 * renders MERGED FHIR + HL7 rows from a MOCKED GET /all (with type badges, status, and per-type actions, and
 * NEVER a secret, and a rest-json row is badged REST/JSON by its real type, not a hardcoded FHIR); Delete/Copy
 * actions call the right endpoints; the no-membership empty state shows when /tenants is empty; and a MOCKED
 * 404 shows the graceful "not enabled yet" flag-off state (not a crash). Also verifies the Connection health
 * panel: a MOCKED GET /health renders per-connector Healthy/Degraded status, counts, failure rate, recent
 * failures with reasons, and a summary line, asserts the mocked payload carries only the documented PHI-free
 * fields, shows the "No connector activity yet." empty state, and degrades to the same flag-off state on 404.
 * Also verifies AI-assisted field mapping (CSV + REST): Suggest mapping POSTs ONLY the column headers (never
 * csv text / row data) to /suggest-mapping, renders an EDITABLE map the admin reviews, and the reviewed map
 * flows back into the next parse (CSV) / save (REST); degrades to the same flag-off state on a 404.
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
  ok(await ev(`var o=[].slice.call(document.querySelectorAll('#aType option')); var en=o.filter(function(x){return !x.disabled;}).map(function(x){return x.value;}); return o.length>=6 && en.indexOf("fhir")>=0 && en.indexOf("csv")>=0 && en.indexOf("hl7")>=0 && en.indexOf("webhook")>=0 && en.indexOf("rest")>=0 && en.indexOf("dicom")>=0;`) === true, "type picker shows FHIR + CSV + HL7 + Webhook + REST + DICOMweb all active (no disabled 'coming soon' option)");
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

  // AI-assisted field mapping (CSV): after a parse, "Suggest mapping" appears; clicking it POSTs the parsed
  // headers (and ONLY the headers -- no row/cell data) to /suggest-mapping, then renders an EDITABLE map the
  // admin can review before applying it back through the normal /csv parse path.
  ok(await ev(`return getComputedStyle(document.getElementById("csvSuggestBtn")).display!=="none";`) === true, "Suggest mapping button appears once a CSV has been parsed");
  await ev(`window.__mapReq=null;
    window.ConnectEMR.__setApi(function(path,opts){
      if(path.indexOf("/suggest-mapping")>=0){ window.__mapReq=JSON.parse(opts.body); return Promise.resolve({s:200,d:{ok:true,source:"heuristic",map:{MRN:"patientId",Test:"testName"}}}); }
      return Promise.resolve({s:200,d:{ok:true,rowsParsed:2,columns:["MRN","Test","Value","Unit"],warnings:[],bundle:{sccmVersion:"1.0",patient:{id:"h1a2"},observations:[],diagnosticReports:[],meta:{warnings:[]}}}});
    });
    window.ConnectEMR.suggestCsvMapping(); return 1;`);
  await sleep(300);
  ok(await ev(`var r=window.__mapReq; return !!r && JSON.stringify(r.headers)===JSON.stringify(["MRN","Test","Value","Unit"]) && !("csv" in r) && !("bundle" in r);`) === true, "Suggest mapping POSTs ONLY the parsed headers (no csv text / row data) to /suggest-mapping");
  ok(await ev(`var w=document.getElementById("csvMapWrap"); return getComputedStyle(w).display!=="none";`) === true, "the suggested-mapping editor is shown after a successful suggestion");
  ok(await ev(`var e=document.getElementById("csvMapEditor"); var inp=e.querySelectorAll("[data-map-header]"); return inp.length===4;`) === true, "the mapping editor renders one editable row per parsed header");
  ok(await ev(`var m=window.ConnectEMR.readMapEditor("csvMapEditor"); return m.MRN==="patientId" && m.Test==="testName" && !("Value" in m) && !("Unit" in m);`) === true, "the editor pre-fills the suggested field for each mapped header and leaves unmapped headers blank");
  ok(await ev(`var m=document.getElementById("csvMapMsg"); return m.textContent.indexOf("heuristic")>=0 && m.textContent.indexOf("\\u2014")<0;`) === true, "the suggestion message reports its source (heuristic here), no em-dash");
  // Edit a field in the mapping editor, then Apply -- re-parses /csv with the reviewed columnMap.
  await ev(`var e=document.getElementById("csvMapEditor"); var inp=e.querySelector('[data-map-header="Value"]'); inp.value="value";
    window.__csvSaved=null;
    window.ConnectEMR.__setApi(function(path,opts){
      if(path.indexOf("/csv")>=0){ window.__csvSaved=JSON.parse(opts.body); return Promise.resolve({s:200,d:{ok:true,rowsParsed:2,columns:["MRN","Test","Value","Unit"],warnings:[],bundle:{sccmVersion:"1.0",patient:{id:"h1a2"},observations:[],diagnosticReports:[],meta:{warnings:[]}}}}); }
      return Promise.resolve({s:200,d:{ok:true}});
    });
    window.ConnectEMR.applyCsvMapping(); return 1;`);
  await sleep(300);
  ok(await ev(`var b=window.__csvSaved; return !!b && b.columnMap && b.columnMap.MRN==="patientId" && b.columnMap.Test==="testName" && b.columnMap.Value==="value" && !("Unit" in b.columnMap);`) === true, "Apply mapping re-parses /csv with the admin-reviewed columnMap");
  // A 404 (flag off) on Suggest mapping degrades through the SAME showFlagOff() path as every other action.
  await ev(`window.ConnectEMR.__setApi(function(){ return Promise.resolve({s:404,d:{error:"not_found"}}); }); window.ConnectEMR.suggestCsvMapping(); return 1;`);
  await sleep(200);
  ok(await ev(`return window.ConnectEMR.flagOffVisible()===true;`) === true, "Suggest mapping on a 404 (flag off) shows the graceful 'not enabled yet' state, not a console error");
  // clear the flag-off state left by the mocked 404 above (a direct DOM reset, so it has no side effect on the
  // tenant/dashboard mocks the remaining sections below rely on) before the remaining tests run
  await ev(`document.getElementById("flagOff").style.display="none"; document.getElementById("work").style.display=""; return 1;`);

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

  // AI-assisted field mapping (REST): the admin types column headers (there is no server-side preview for a
  // REST endpoint), Suggest mapping POSTs ONLY those headers to /suggest-mapping, and the reviewed map is then
  // included as columnMap on the next Save.
  await ev(`document.getElementById("aRestHeaders").value="mrn, test_name, result_value"; window.__restMapReq=null;
    window.ConnectEMR.__setApi(function(path,opts){
      if(path.indexOf("/suggest-mapping")>=0){ window.__restMapReq=JSON.parse(opts.body); return Promise.resolve({s:200,d:{ok:true,source:"ai",map:{mrn:"patientId",test_name:"testName",result_value:"value"}}}); }
      return Promise.resolve({s:200,d:{ok:true,fhir:[],hl7:[],webhook:[],counts:{fhir:0,hl7:0,webhook:0,total:0}}});
    });
    window.ConnectEMR.suggestRestMapping(); return 1;`);
  await sleep(300);
  ok(await ev(`var r=window.__restMapReq; return !!r && JSON.stringify(r.headers)===JSON.stringify(["mrn","test_name","result_value"]);`) === true, "REST Suggest mapping POSTs ONLY the entered headers (split on commas/newlines) to /suggest-mapping");
  ok(await ev(`var w=document.getElementById("restMapWrap"); return getComputedStyle(w).display!=="none";`) === true, "the REST suggested-mapping editor is shown after a successful suggestion");
  ok(await ev(`var m=document.getElementById("restMapMsg"); return m.textContent.indexOf("AI")>=0 && m.textContent.indexOf("\\u2014")<0;`) === true, "the REST suggestion message reports its source (AI here), no em-dash");
  await ev(`document.getElementById("aName").value="Lab REST API 2"; document.getElementById("aRestBase").value="https://labs.example.org/api";
    document.getElementById("aRestToken").value="rest-tok-2";
    window.__restSaved2=null;
    window.ConnectEMR.__setApi(function(path,opts){
      if(opts&&opts.method==="POST"&&path.indexOf("/emr")>=0){ window.__restSaved2=JSON.parse(opts.body); return Promise.resolve({s:200,d:{ok:true,connectionId:"rest-2"}}); }
      return Promise.resolve({s:200,d:{ok:true,fhir:[],hl7:[],webhook:[],counts:{fhir:0,hl7:0,webhook:0,total:0}}});
    });
    window.ConnectEMR.restSave(); return 1;`);
  await sleep(300);
  ok(await ev(`var b=window.__restSaved2; return !!b && b.columnMap && b.columnMap.mrn==="patientId" && b.columnMap.test_name==="testName" && b.columnMap.result_value==="value";`) === true, "the reviewed REST mapping is included as columnMap on Save");
  // A 404 (flag off) on REST Suggest mapping degrades through the SAME showFlagOff() path as every other action.
  // (The prior Save cleared the form, including aRestHeaders -- re-enter a header so this call actually reaches
  // the mocked network call instead of bailing out on the client-side "enter a header first" validation.)
  await ev(`document.getElementById("aRestHeaders").value="mrn";
    window.ConnectEMR.__setApi(function(){ return Promise.resolve({s:404,d:{error:"not_found"}}); }); window.ConnectEMR.suggestRestMapping(); return 1;`);
  await sleep(200);
  ok(await ev(`return window.ConnectEMR.flagOffVisible()===true;`) === true, "REST Suggest mapping on a 404 (flag off) shows the graceful 'not enabled yet' state, not a console error");
  await ev(`document.getElementById("flagOff").style.display="none"; document.getElementById("work").style.display=""; return 1;`);

  // reset back to FHIR
  await ev(`document.getElementById("aType").value="fhir"; document.getElementById("aType").onchange(); return 1;`);

  // DICOMweb / imaging (metadata) type: activates the DICOM subform (hides FHIR/Detect + CSV + HL7 + Webhook +
  // REST); Save-and-test builds {type:"dicomweb", baseUrl, auth:{method:"token",token,headerName?}, studiesPath?,
  // patientTag?} exactly per the backend contract, POSTs /emr then /test/:id (same two-step flow as REST/FHIR),
  // and renders a DICOMweb-specific success message (not a FHIR-version string) through the shared say()/testMsg() path.
  ok(await ev(`document.getElementById("aType").value="dicom"; document.getElementById("aType").onchange(); return getComputedStyle(document.getElementById("fDicom")).display!=="none" && getComputedStyle(document.getElementById("fFhir")).display==="none" && getComputedStyle(document.getElementById("fCsv")).display==="none" && getComputedStyle(document.getElementById("fHl7")).display==="none" && getComputedStyle(document.getElementById("fWebhook")).display==="none" && getComputedStyle(document.getElementById("fRest")).display==="none";`) === true, "DICOMweb type activates the DICOM subform and hides the FHIR (+ Detect) + CSV + HL7 + Webhook + REST fields");
  await ev(`window.ConnectEMR.setTenant("t-dicom"); window.ConnectEMR.setName("Hospital PACS");
    document.getElementById("aDicomBase").value="https://pacs.example.org/dicom-web";
    document.getElementById("aDicomToken").value="dicom-tok-1";
    document.getElementById("aDicomPath").value="/studies";
    window.__dicomSaved=null;
    window.ConnectEMR.__setApi(function(path,opts){
      if(opts&&opts.method==="POST"&&path.indexOf("/emr")>=0){ window.__dicomSaved=JSON.parse(opts.body); return Promise.resolve({s:200,d:{ok:true,connectionId:"dicom-1"}}); }
      if(opts&&opts.method==="POST"&&path.indexOf("/test/dicom-1")>=0){ return Promise.resolve({s:200,d:{ok:true}}); }
      return Promise.resolve({s:200,d:{ok:true,fhir:[],hl7:[],webhook:[],counts:{fhir:0,hl7:0,webhook:0,total:0}}});
    });
    window.ConnectEMR.dicomSaveTest(); return 1;`);
  await sleep(300);
  ok(await ev(`var b=window.__dicomSaved; return !!b && b.type==="dicomweb" && b.baseUrl==="https://pacs.example.org/dicom-web" && b.tenantId==="t-dicom" && b.name==="Hospital PACS" && b.auth&&b.auth.method==="token" && b.auth.token==="dicom-tok-1" && b.studiesPath==="/studies" && !("headerName" in (b.auth||{})) && !("patientTag" in b);`) === true, "DICOMweb Save-and-test POSTs /emr with type dicomweb + baseUrl + token auth + studiesPath (optional fields omitted when blank)");
  ok(await ev(`var m=document.getElementById("dicomMsg"); return m.className.indexOf("ok")>=0 && m.textContent.indexOf("studies endpoint responded correctly")>=0 && m.textContent.indexOf("\\u2014")<0;`) === true, "DICOMweb Save-and-test reports success with DICOMweb-specific copy (not a FHIR version string), no em-dash");
  ok(await ev(`return document.getElementById("aDicomBase").value===""&&document.getElementById("aDicomToken").value==="";`) === true, "DICOMweb form clears after a successful save");
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

  // ---- Row-type badge parity: the /all "fhir" array actually carries BOTH fhir and rest-json connector rows
  // (safeView.type), so a rest-json row must be badged by its REAL type, not the hardcoded "FHIR" of before. ----
  ok(await ev(`window.ConnectEMR.renderDash([{connectionId:"c-2",name:"Lab REST Feed",type:"rest-json",fhirBaseUrl:"https://labs.example.org/api",authMethod:"token"}],[],{fhir:1,hl7:0,total:1});
    var h=document.getElementById("dash").innerHTML; return h.indexOf("Lab REST Feed")>=0 && h.indexOf(">REST/JSON<")>=0 && h.indexOf(">FHIR<")<0;`) === true, "a rest-json row is badged REST/JSON (its real type), not hardcoded FHIR");
  ok(await ev(`window.ConnectEMR.renderDash([{connectionId:"c-3",name:"Hospital PACS Feed",type:"dicomweb",fhirBaseUrl:"https://pacs.example.org/dicom-web",authMethod:"token"}],[],{fhir:1,hl7:0,total:1});
    var h=document.getElementById("dash").innerHTML; return h.indexOf("Hospital PACS Feed")>=0 && h.indexOf(">DICOMweb<")>=0 && h.indexOf(">FHIR<")<0;`) === true, "a dicomweb row is badged DICOMweb (its real type), not hardcoded FHIR");

  // ---- Connection health panel (GET /health, Part 4 PHI-free integration-health analytics) ----
  // Two connectors: one fully healthy, one with failures + a recent-failure entry + warnings. Assert the
  // panel derives and renders status/labels/counts correctly, AND that the mocked health payload itself
  // carries ONLY the documented PHI-free operational fields (defense-in-depth: the fixture matches the real
  // backend contract, and nothing beyond it can leak into the rendered DOM).
  await ev(`window.__healthMock={
    perConnector:[
      {connectorId:"fhir-main",total:40,ok:40,failed:0,failureRate:0,warningCount:0,lastOutcome:"ok",lastTs:"2026-08-01T10:00:00.000Z"},
      {connectorId:"rest-labs",total:10,ok:6,failed:4,failureRate:0.4,warningCount:2,lastOutcome:"unauthorized",lastTs:"2026-08-01T11:00:00.000Z"}
    ],
    perAction:{pull:{total:50,byOutcome:{ok:46,unauthorized:4}}},
    overall:{totalEvents:50,okRate:0.92,failedCount:4,activeConnectors:2},
    recentFailures:[{action:"pull",connectorId:"rest-labs",outcome:"unauthorized",ts:"2026-08-01T11:00:00.000Z",reason:"bad-token"}],
    warnings:{total:2,warnings:2,unmapped:0},
    generatedFromCount:50
  };
  window.ConnectEMR.__setApi(function(path){ if(path.indexOf("/health")>=0) return Promise.resolve({s:200,d:{ok:true,health:window.__healthMock}}); return Promise.resolve({s:200,d:{ok:true,fhir:[],hl7:[],webhook:[],counts:{fhir:0,hl7:0,webhook:0,total:0}}}); });
  window.ConnectEMR.loadHealth(); return 1;`);
  await sleep(300);
  ok(await ev(`var m=window.__healthMock; var SAFE_CONN=["connectorId","total","ok","failed","failureRate","warningCount","lastOutcome","lastTs"]; var SAFE_FAIL=["action","connectorId","outcome","ts","reason"];
    var badConn=(m.perConnector||[]).some(function(c){ return Object.keys(c).some(function(k){ return SAFE_CONN.indexOf(k)<0; }); });
    var badFail=(m.recentFailures||[]).some(function(f){ return Object.keys(f).some(function(k){ return SAFE_FAIL.indexOf(k)<0; }); });
    var phiLike=/patient|mrn|dob|ssn|email|phone|address/i.test(JSON.stringify(m));
    return !badConn && !badFail && !phiLike;`) === true, "the mocked health payload carries only the documented PHI-free operational fields (no patient identifiers)");
  ok(await ev(`var h=document.getElementById("health"); return h.querySelector("table.dash")!=null && h.textContent.indexOf("fhir-main")>=0 && h.textContent.indexOf("Healthy")>=0 && h.textContent.indexOf("rest-labs")>=0 && h.textContent.indexOf("Degraded")>=0 && h.textContent.indexOf("40%")>=0;`) === true, "the health table renders both connectors with derived Healthy/Degraded status and failure rate");
  ok(await ev(`var h=document.getElementById("health").textContent; return h.indexOf("Recent failures")>=0 && h.indexOf("rest-labs")>=0 && h.indexOf("unauthorized")>=0 && h.indexOf("bad-token")>=0;`) === true, "the recent-failures list renders the connector, outcome, and reason with a timestamp");
  ok(await ev(`var s=document.getElementById("healthSummary").textContent; return s.indexOf("50 events")>=0 && s.indexOf("2 connectors")>=0 && s.indexOf("92% ok")>=0 && s.indexOf("2 warnings")>=0;`) === true, "the summary line shows total events, active connectors, ok rate, and warning count");
  ok(await ev(`var t=document.getElementById("health").textContent; return t.indexOf("undefined")<0 && t.indexOf("[object Object]")<0 && t.indexOf("\\u2014")<0;`) === true, "the health panel never renders undefined/stringified-object values, and no em-dash");

  // Empty health object -> the documented empty state (no connector activity yet), not a blank/broken panel.
  await ev(`window.ConnectEMR.__setApi(function(path){ if(path.indexOf("/health")>=0) return Promise.resolve({s:200,d:{ok:true,health:{perConnector:[],perAction:{},overall:{totalEvents:0,okRate:0,failedCount:0,activeConnectors:0},recentFailures:[],warnings:{total:0,warnings:0,unmapped:0},generatedFromCount:0}}}); return Promise.resolve({s:200,d:{ok:true,fhir:[],hl7:[],webhook:[],counts:{fhir:0,hl7:0,webhook:0,total:0}}}); }); window.ConnectEMR.loadHealth(); return 1;`);
  await sleep(300);
  ok(await ev(`return document.getElementById("health").textContent.indexOf("No connector activity yet.")>=0 && document.getElementById("healthSummary").textContent==="";`) === true, "an empty health object shows the 'No connector activity yet.' empty state");

  // ---- Activity log panel (GET /activity, security-center-lite: read-only view of the existing PHI-free
  // audit trail) ----. Two events across two connectors; asserts the panel renders friendly action labels,
  // connector id, outcome and timestamp, AND that the mocked payload itself carries ONLY the documented
  // PHI-free fields (defense-in-depth: nothing beyond action/outcome/connectorId/ts can leak into the DOM).
  await ev(`window.__activityMock={events:[
      {action:"connect.onboard.tested",outcome:"ok",connectorId:"fhir-main",ts:"2026-08-01T11:00:00.000Z"},
      {action:"connect.onboard.saved",outcome:"ok",connectorId:"rest-labs",ts:"2026-08-01T09:00:00.000Z"}
    ],truncated:false};
  window.ConnectEMR.__setApi(function(path){ if(path.indexOf("/activity")>=0) return Promise.resolve({s:200,d:Object.assign({ok:true},window.__activityMock)}); return Promise.resolve({s:200,d:{ok:true,fhir:[],hl7:[],webhook:[],counts:{fhir:0,hl7:0,webhook:0,total:0}}}); });
  window.ConnectEMR.loadActivity(); return 1;`);
  await sleep(300);
  ok(await ev(`var m=window.__activityMock; var SAFE=["action","outcome","connectorId","ts"];
    var bad=(m.events||[]).some(function(e){ return Object.keys(e).some(function(k){ return SAFE.indexOf(k)<0; }); });
    var phiLike=/patient|mrn|dob|ssn|email|phone|address|consent|transaction|hash|actor/i.test(JSON.stringify(m));
    return !bad && !phiLike;`) === true, "the mocked activity payload carries only the documented PHI-free fields (no patient identifiers, no correlation ids, no actor)");
  ok(await ev(`var t=document.getElementById("activity").textContent; return t.indexOf("Tested")>=0 && t.indexOf("fhir-main")>=0 && t.indexOf("Connection saved")>=0 && t.indexOf("rest-labs")>=0;`) === true, "the activity panel renders friendly action labels + connector ids");
  ok(await ev(`var s=document.getElementById("activitySummary").textContent; return s.indexOf("2 event")>=0;`) === true, "the activity summary shows the event count");
  ok(await ev(`var t=document.getElementById("activity").textContent; return t.indexOf("undefined")<0 && t.indexOf("[object Object]")<0 && t.indexOf("\\u2014")<0;`) === true, "the activity panel never renders undefined/stringified-object values, and no em-dash");

  // An unmapped/future action string falls back to itself (no crash, no blank label).
  await ev(`window.ConnectEMR.__setApi(function(path){ if(path.indexOf("/activity")>=0) return Promise.resolve({s:200,d:{ok:true,events:[{action:"connect.onboard.some-future-action",outcome:"ok",connectorId:"c1",ts:"2026-08-01T12:00:00.000Z"}],truncated:false}}); return Promise.resolve({s:200,d:{ok:true,fhir:[],hl7:[],webhook:[],counts:{fhir:0,hl7:0,webhook:0,total:0}}}); }); window.ConnectEMR.loadActivity(); return 1;`);
  await sleep(300);
  ok(await ev(`return document.getElementById("activity").textContent.indexOf("connect.onboard.some-future-action")>=0;`) === true, "an unmapped action falls back to the raw action string (no crash, no blank label)");

  // Empty events -> the documented empty state (not a blank/broken panel).
  await ev(`window.ConnectEMR.__setApi(function(path){ if(path.indexOf("/activity")>=0) return Promise.resolve({s:200,d:{ok:true,events:[],truncated:false}}); return Promise.resolve({s:200,d:{ok:true,fhir:[],hl7:[],webhook:[],counts:{fhir:0,hl7:0,webhook:0,total:0}}}); }); window.ConnectEMR.loadActivity(); return 1;`);
  await sleep(300);
  ok(await ev(`return document.getElementById("activity").textContent.indexOf("No activity yet.")>=0 && document.getElementById("activitySummary").textContent==="";`) === true, "empty events shows the 'No activity yet.' empty state");

  // Activity log degrades through the SAME showFlagOff() path as every other GET on a 404.
  await ev(`window.ConnectEMR.__setApi(function(){ return Promise.resolve({s:404,d:{error:"not_found"}}); }); window.ConnectEMR.loadActivity(); return 1;`);
  await sleep(200);
  ok(await ev(`return window.ConnectEMR.flagOffVisible()===true;`) === true, "GET /activity on a 404 (flag off) also shows the graceful 'not enabled yet' state via the shared showFlagOff() path");
  await ev(`document.getElementById("flagOff").style.display="none"; document.getElementById("work").style.display=""; return 1;`);

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

  // dicomweb degrades through the SAME showFlagOff() path as every other type (no special-casing in doDicomSave).
  await ev(`window.ConnectEMR.setTenant("t-final2"); document.getElementById("aName").value="PACS Final";
    document.getElementById("aDicomBase").value="https://pacs.example.org"; document.getElementById("aDicomToken").value="tok-1";
    window.ConnectEMR.__setApi(function(){ return Promise.resolve({s:404,d:{error:"not_found"}}); });
    window.ConnectEMR.dicomSaveTest(); return 1;`);
  await sleep(200);
  ok(await ev(`return window.ConnectEMR.flagOffVisible()===true;`) === true, "DICOMweb save-and-test on a 404 (flag off) also shows the graceful 'not enabled yet' state, not a console error");

  // Connection health degrades through the SAME showFlagOff() path as every other GET on a 404.
  await ev(`window.ConnectEMR.__setApi(function(){ return Promise.resolve({s:404,d:{error:"not_found"}}); }); window.ConnectEMR.loadHealth(); return 1;`);
  await sleep(200);
  ok(await ev(`return window.ConnectEMR.flagOffVisible()===true;`) === true, "GET /health on a 404 (flag off) also shows the graceful 'not enabled yet' state via the shared showFlagOff() path");

  ok(consoleErrors.length === 0, "zero console errors / uncaught exceptions" + (consoleErrors.length ? " -> " + JSON.stringify(consoleErrors.slice(0, 4)) : ""));

  console.log(fails === 0 ? "\nALL GREEN - Connect EMR admin page smoke test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e && e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
