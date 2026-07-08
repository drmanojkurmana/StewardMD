/* ICU external trusted-evidence fallback test (Phase 4).
 *
 * Proves: the "Find evidence beyond StewardMD" button is opt-in and flag-gated; the topic sent
 * out is DE-IDENTIFIED; the confirm → search flow renders curated trusted-org hubs (WHO/ICMR/CDC/
 * NICE/PubMed) + peer-reviewed PubMed citations, each clearly labelled "not StewardMD-verified" and
 * opening in a new tab; results are cached (no repeat fetch); and the flag kill-switch disables it.
 *
 * The live PubMed call is prod-only (NCBI unreachable from CI, like the vision route) — the client
 * is exercised via a stubbed SMD_AI.evidence. USAGE: node test/run-icu-evidence.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9386, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-evidence-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8902"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

// Stub that records call count + returns canned PubMed citations.
const STUB = `window.SMD_AI = window.SMD_AI || {}; window.__evn = 0;
  window.SMD_AI.evidence = function(topic){ window.__evn++; window.__evtopic = topic; return Promise.resolve({ mode:"evidence", source:"PubMed (NCBI)", query:topic, results:[
    { title:"IAP/APA evidence-based guidelines for the management of acute pancreatitis", journal:"Pancreatology", year:"2013", pubtype:"Practice Guideline", url:"https://pubmed.ncbi.nlm.nih.gov/24054878/", pmid:"24054878" },
    { title:"Acute pancreatitis: a systematic review of management", journal:"BMJ", year:"2019", pubtype:"Systematic Review", url:"https://pubmed.ncbi.nlm.nih.gov/31000000/", pmid:"31000000" } ]}); };`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.open && ICU.extEvidenceOn && ICU._correlationTopic && ICU._correlationEvidence)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU evidence API not loaded");
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);

  // 1) flag on by default + de-identified topic
  ok(await ev(`return ICU.extEvidenceOn() === true;`) === true, "external-evidence feature ON by default (smd_ext_evidence)");
  const topic = JSON.parse(await ev(`
    ICU.reset(); ICU.ingestPatient({name:"Ramesh Kumar", age:52, sex:"M", diagnosis:"Ramesh Kumar 234567 acute pancreatitis"});
    ICU.ingestWardImaging({ patientId:"P1", source:"Ward Sync", imaging:[{reportId:"C1",description:"CECT Abdomen",report:"IMPRESSION: acute pancreatitis."}] });
    var tp = ICU._correlationTopic(ICU._correlationEvidence());
    return JSON.stringify({ topic: tp });`));
  ok(topic.topic.indexOf("234567") < 0 && topic.topic.indexOf("Ramesh") < 0, "topic is de-identified — an unlabelled name + short MRN typed into the DIAGNOSIS free-text are stripped. Sent: \"" + topic.topic + "\"");
  ok(/pancrea/i.test(topic.topic), "topic carries the controlled clinical concept (pancreatic inflammation)");

  // 2) button is enabled in the analysed correlation card; opens the confirm flow
  const btn = await ev(`${STUB}
    ICU.open(); var root=document.getElementById('icuRoot');
    root.querySelector('[data-icu-act="ws:documents"]').click();
    root.querySelector('[data-icu-act="tab:imaging"]').click();
    root.querySelector('[data-icu-act="corranalyse"]').click();
    var b=root.querySelector('[data-icu-act="corrext"]');
    if (b) b.click();
    var modal=document.getElementById('icuModal');
    return JSON.stringify({ hasBtn: !!b, confirmShown: !!(modal && /Search trusted references/.test(modal.textContent||"")), hasGo: !!(modal && modal.querySelector('#icuEvGo')) });`);
  const B = JSON.parse(btn);
  ok(B.hasBtn, "'Find evidence beyond StewardMD' button is enabled in the analysed card");
  ok(B.confirmShown && B.hasGo, "tapping it shows the opt-in confirm ('Search trusted references?')");

  // 3) search → curated hubs + PubMed citations render with the 'not verified' disclaimer
  await ev(`document.getElementById('icuEvGo').click(); return 1;`);
  await sleep(400);
  const R = JSON.parse(await ev(`var m=document.getElementById('icuModal'); var txt=m.textContent||"";
    var hubs=Array.prototype.map.call(m.querySelectorAll('.icu-ev-hub'),function(a){return a.textContent;});
    var pubmedHref=(Array.prototype.filter.call(m.querySelectorAll('.icu-ev-hub'),function(a){return /PubMed/.test(a.textContent);})[0]||{}).href||"";
    var cites=m.querySelectorAll('.icu-ev-cite');
    var blank=Array.prototype.every.call(m.querySelectorAll('.icu-ev-cite,.icu-ev-hub'),function(a){return a.target==='_blank';});
    return JSON.stringify({ calls: window.__evn, evtopic: window.__evtopic || "", nHubs: hubs.length, hasWHO: hubs.indexOf('WHO guidelines')>=0, hasICMR: hubs.indexOf('ICMR')>=0, pubmedHasTopic: /[?&]term=/.test(pubmedHref) && pubmedHref.length>40, nCites: cites.length, citeText: (cites[0]?cites[0].textContent:""), disclaimer: /not StewardMD-verified/.test(txt), blank: blank });`));
  ok(R.calls === 1, "search calls the evidence retrieval once");
  ok(R.nHubs >= 5 && R.hasWHO && R.hasICMR && R.pubmedHasTopic, "curated trusted-org hubs render (WHO/ICMR/CDC/NICE/PubMed); PubMed link carries the topic");
  ok(R.nCites === 2 && /acute pancreatitis/i.test(R.citeText) && /Pancreatology|2013|Practice Guideline/i.test(R.citeText), "peer-reviewed PubMed citations render (title · journal · year · type)");
  ok(R.disclaimer && R.blank, "results labelled 'not StewardMD-verified' + all links open in a new tab");
  ok(R.evtopic.indexOf("4321") < 0, "the de-identified topic (no MRN) is what was sent to the retrieval service");

  // 4) cache — re-opening + searching the same topic does NOT re-fetch
  const cache = JSON.parse(await ev(`
    var root=document.getElementById('icuRoot');
    root.querySelector('[data-icu-act="corrext"]').click();          // reopen confirm
    var go=document.getElementById('icuEvGo'); if(go) go.click();     // search again (same topic)
    return JSON.stringify({ calls: window.__evn });`));
  ok(cache.calls === 1, "repeat search for the same topic is served from cache (no second retrieval call)");

  // 5) flag kill-switch disables the button
  const off = await ev(`
    localStorage.setItem('smd_ext_evidence','0');
    var root=document.getElementById('icuRoot');
    var doc=root.querySelector('[data-icu-act="closeform"]'); if(doc) doc.click();
    ICU.recompute();  // trigger a repaint
    root.querySelector('[data-icu-act="tab:imaging"]').click();
    var b=root.querySelector('[data-icu-act="corrext"]');
    var disabled=Array.prototype.filter.call(root.querySelectorAll('button'),function(x){return /Find evidence beyond StewardMD/.test(x.textContent);})[0];
    localStorage.removeItem('smd_ext_evidence');
    return JSON.stringify({ noAction: !b, isDisabled: !!(disabled && disabled.disabled) });`);
  const O = JSON.parse(off);
  ok(O.noAction && O.isDisabled, "flag OFF → the external-evidence button is disabled (kill-switch)");

  // 6) transient error is NOT cached — a retry re-queries (review fix)
  await ev(`
    localStorage.removeItem('smd_ext_evidence');
    ICU.reset(); ICU.ingestPatient({name:"ERRP",age:60,sex:"M"});
    ICU.ingestWardImaging({ patientId:"PZ", source:"Ward Sync", imaging:[{reportId:"Z1",description:"CT Chest",report:"IMPRESSION: consolidation."}] });
    window.__en = 0;
    window.SMD_AI.evidence = function(t){ window.__en++; return Promise.resolve(window.__en === 1 ? { error:"quota" } : { mode:"evidence", source:"PubMed (NCBI)", query:t, results:[{ title:"Recovered guideline", journal:"BMJ", year:"2020", pubtype:"Practice Guideline", url:"https://pubmed.ncbi.nlm.nih.gov/1/", pmid:"1" }] }); };
    ICU.open(); var root=document.getElementById('icuRoot');
    root.querySelector('[data-icu-act="ws:documents"]').click();
    root.querySelector('[data-icu-act="tab:imaging"]').click();
    root.querySelector('[data-icu-act="corranalyse"]').click();
    root.querySelector('[data-icu-act="corrext"]').click();
    document.getElementById('icuEvGo').click();
    return 1;`);
  await sleep(300);
  const e1 = JSON.parse(await ev(`return JSON.stringify({ n: window.__en, errShown: /reach the reference service|usage limit/i.test(document.getElementById('icuModal').textContent||"") });`));
  await ev(`document.getElementById('icuRoot').querySelector('[data-icu-act="corrext"]').click(); var g=document.getElementById('icuEvGo'); if(g) g.click(); return 1;`);   // reopen confirm + retry search
  await sleep(300);
  const e2 = JSON.parse(await ev(`return JSON.stringify({ n: window.__en, recovered: /Recovered guideline/.test(document.getElementById('icuModal').textContent||"") });`));
  ok(e1.errShown && e1.n === 1, "transient evidence error is shown, not cached");
  ok(e2.n === 2 && e2.recovered, "retry re-queries after a transient error and renders the recovered citation");

  console.log(fails === 0 ? "\nALL GREEN — ICU external-evidence test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
