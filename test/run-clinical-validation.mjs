/* StewardMD — Clinical Validation Test Suite (audit only; modifies NO app code)
 *
 * Drives the REAL site headlessly (CDP) and audits 18 workflows, collecting
 * JS errors, network/API failures, performance metrics, screenshots and
 * accessibility heuristics into a validation report (markdown + JSON).
 *
 * USAGE:
 *   node test/run-clinical-validation.mjs                    # against https://stewardmd.in
 *   BASE=http://localhost:8799/ node test/run-clinical-validation.mjs
 * Output: <CLAUDE_JOB_DIR|/tmp>/validation/{report.md,report.json,shots/*.png}
 *
 * PRIVACY: hits ONLY non-PHI endpoints (/api/ai/status, /api/ghis/status with no
 * token). NEVER logs into GHIS, NEVER fetches /api/cases or /api/ghis/patients.
 * Gemini is MOCKED in-page (no key, no external call).
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE || "https://stewardmd.in").replace(/\/?$/, "/");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP = Number(process.env.CDP_PORT || 9411);
const OUTDIR = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/validation";
const SHOTS = OUTDIR + "/shots";
mkdirSync(SHOTS, { recursive: true });
const userDir = OUTDIR + "/chrome-prof";

const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--mute-audio", "--window-size=1280,900"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r, j) => { pending.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return '__ERR__'+(x&&x.message||x)}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };

const jsErrors = [], netFailures = [], requests = [];
const results = []; // {area, status, detail}
const perf = {}; const shots = [];
const add = (area, status, detail) => { results.push({ area, status, detail }); console.log(`  ${status === "PASS" ? "✅" : status === "FAIL" ? "❌" : "⚠️ "} [${area}] ${detail}`); };

async function shot(name) {
  try { const r = await call("Page.captureScreenshot", { format: "png" }); if (r.result && r.result.data) { const f = SHOTS + "/" + name + ".png"; writeFileSync(f, Buffer.from(r.result.data, "base64")); shots.push({ name, file: f }); return f; } } catch (e) {} return null;
}
async function waitReady(pred, tries) { for (let i = 0; i < (tries || 50); i++) { await sleep(400); if (await ev(pred) === true) return true; } return false; }

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome devtools endpoint never came up");
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).r(m); pending.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; jsErrors.push((d.exception && (d.exception.description || d.exception.value)) || d.text || "exception"); }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") { jsErrors.push(m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 300)); }
    if (m.method === "Network.responseReceived") { const r = m.params.response; requests.push({ url: r.url, status: r.status }); if (r.status >= 400) netFailures.push({ url: r.url, status: r.status }); }
    if (m.method === "Network.loadingFailed") { netFailures.push({ url: (m.params.request && m.params.request.url) || "?", status: "loadingFailed:" + (m.params.errorText || "") }); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {}); await call("Network.enable", {});
  await call("Performance.enable", {}).catch(() => {});

  console.log(`\nStewardMD Clinical Validation — ${BASE}\n`);
  const t0 = Date.now();
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() });
  const ready = await waitReady(`return !!(window.SMD_REASON && window.KB_ENRICHMENT && document.getElementById('smdSearchInput'));`, 60);
  perf.appReadyMs = Date.now() - t0;

  // ---- performance (navigation timing + paint) ----
  const nav = JSON.parse(await ev(`var n=performance.getEntriesByType('navigation')[0]||{};var p=performance.getEntriesByType('paint')||[];var fcp=(p.find(function(x){return x.name==='first-contentful-paint';})||{}).startTime;return JSON.stringify({dcl:Math.round(n.domContentLoadedEventEnd||0),load:Math.round(n.loadEventEnd||0),fcp:Math.round(fcp||0),transfer:Math.round((n.transferSize||0)/1024),res:performance.getEntriesByType('resource').length});`) || "{}");
  perf.nav = nav; perf.resources = nav.res;
  add("17. Performance", (nav.fcp && nav.fcp < 4000 && nav.dcl < 6000) ? "PASS" : "WARN", `FCP ${nav.fcp}ms · DCL ${nav.dcl}ms · load ${nav.load}ms · app-ready ${perf.appReadyMs}ms · ${nav.res} resources`);
  await shot("01-desktop-home");

  // ---- 1. Authentication ----
  const auth = JSON.parse(await ev(`return JSON.stringify({authApi: typeof window.SMD_AUTH, signIn: typeof window.SMD_firebaseSignIn, boot: typeof window.SMD_bootFirebase, gated: !!document.querySelector('[id*="signin" i],[id*="login" i]'), appVisible: !!document.getElementById('smdSearchInput')});`) || "{}");
  add("1. Authentication", (auth.signIn === "function" || auth.authApi !== "undefined") && auth.appVisible ? "PASS" : "WARN", `SMD_AUTH:${auth.authApi}, signIn:${auth.signIn}, app loads without hard auth-gate:${auth.appVisible}`);

  // ---- 2. Ward Sync (GHIS) — UI + status only, NO login/PHI ----
  const ghisUI = JSON.parse(await ev(`return JSON.stringify({open: typeof window.openGHIS, panel: !!document.getElementById('ghisPanel'), user: !!document.getElementById('ghisUserId'), pass: !!document.getElementById('ghisPassword')});`) || "{}");
  let ghisStatus = await ev(`try{var r=await fetch('/api/ghis/status');var j=await r.json();return JSON.stringify({http:r.status, connected:j.connected});}catch(e){return '__ERR__'+e.message;}`);
  add("2. Ward Sync", (ghisUI.open === "function" && ghisUI.panel) ? "PASS" : "WARN", `openGHIS:${ghisUI.open}, #ghisPanel:${ghisUI.panel}, login inputs:${ghisUI.user && ghisUI.pass}, /api/ghis/status:${ghisStatus}`);

  // ---- 3. Cloud Cases — client roster round-trip (localStorage); endpoint NOT read (PHI) ----
  const cases = await ev(`
    if(!window.ICU||!ICU.listPatients) return '__ERR__no ICU roster API';
    var before=ICU.listPatients().length;
    localStorage.setItem('__vtest','1');
    return JSON.stringify({api: typeof ICU.listPatients, save: typeof ICU.savePatient, load: typeof ICU.loadPatient, del: typeof ICU.deletePatient, count: before});`);
  const cj = (typeof cases === "string" && cases[0] === "{") ? JSON.parse(cases) : null;
  add("3. Cloud Cases", cj && cj.save === "function" && cj.load === "function" ? "PASS" : "WARN", cj ? `roster API present (save/load/list/delete); ${cj.count} local cases; cloud endpoint not read (PHI-safe)` : String(cases));

  // ---- 12. Search (run before Drug Index; drug index is verified via search) ----
  await ev(`var i=document.getElementById('smdSearchInput'); if(i){i.value='malaria'; i.dispatchEvent(new Event('input',{bubbles:true}));} return 1;`); await sleep(1000);
  const search = JSON.parse(await ev(`var b=document.getElementById('spResults'); var txt=b?b.textContent.toLowerCase():''; return JSON.stringify({box:!!b, kids: b?b.children.length:0, hit: txt.indexOf('malaria')>=0});`) || "{}");
  add("12. Search", search.box && search.hit ? "PASS" : "WARN", `#spResults present:${search.box}, 'malaria' in results:${search.hit} (${search.kids} nodes)`);
  await shot("02-search-malaria");

  // ---- 4. Drug Index ----
  await ev(`var i=document.getElementById('smdSearchInput'); if(i){i.value='amoxicillin'; i.dispatchEvent(new Event('input',{bubbles:true}));} return 1;`); await sleep(700);
  const drug = JSON.parse(await ev(`var b=document.getElementById('spResults'); var txt=b?b.textContent.toLowerCase():''; return JSON.stringify({hit: txt.indexOf('amoxicill')>=0, any: b?b.children.length:0});`) || "{}");
  add("4. Drug Index", drug.hit ? "PASS" : (drug.any > 0 ? "WARN" : "WARN"), `search 'amoxicillin' → ${drug.hit ? "drug entry found" : "no direct drug hit (" + drug.any + " results)"}`);
  await ev(`var i=document.getElementById('smdSearchInput'); if(i){i.value=''; i.dispatchEvent(new Event('input',{bubbles:true}));} return 1;`);

  // ---- 5. Clinical Reasoning ----
  const reason = JSON.parse(await ev(`
    if(!window.SMD_REASON||!SMD_REASON.assess) return JSON.stringify({ok:false});
    var a=SMD_REASON.assess({fever:true,cough:true,dyspnea:true,purulentSputum:true});
    var top=[].concat(a.infectious||[],a.nonInfectious||[]).sort(function(x,y){return (y.confidence||0)-(x.confidence||0);})[0];
    return JSON.stringify({ok:true, inf:(a.infectious||[]).length, ni:(a.nonInfectious||[]).length, lead: top?top.name:null, conf: top?top.confidence:null, hasSupport: !!(top&&top.supporting&&top.supporting.length)});`) || "{}");
  add("5. Clinical Reasoning", reason.ok && reason.lead && reason.conf != null ? "PASS" : "FAIL", reason.ok ? `assess() → lead "${reason.lead}" (${reason.conf}/100), ${reason.inf}🔴/${reason.ni}🟢, evidence:${reason.hasSupport}` : "SMD_REASON.assess unavailable");

  // ---- 6. Dx My Patient ----
  const dxmp = JSON.parse(await ev(`return JSON.stringify({dxOpen: typeof (window.DX&&DX.open), myCases: typeof window.SMD_initMyCasesBtn, restore: typeof window.SMD_restoreCase, savePrompt: typeof window.SMD_showSavePrompt});`) || "{}");
  add("6. Dx My Patient", (dxmp.dxOpen === "function") ? "PASS" : "WARN", `DX.open:${dxmp.dxOpen}, My-Cases:${dxmp.myCases}, restoreCase:${dxmp.restore}`);

  // ---- 8. ICU Dashboard ----
  const icu = await ev(`try{ICU.open(); return JSON.stringify({open: !!(document.getElementById('icuRoot')&&document.getElementById('icuRoot').classList.contains('on')), tabs: document.querySelectorAll('#icuRoot .icu-tab').length, addData: !!document.querySelector('.icu-adddata'), roster: !!document.querySelector('[data-icu-act="patients"]')});}catch(e){return '__ERR__'+e.message;}`);
  const icj = (typeof icu === "string" && icu[0] === "{") ? JSON.parse(icu) : null;
  add("8. ICU Dashboard", icj && icj.open && icj.tabs >= 8 ? "PASS" : "FAIL", icj ? `opens, ${icj.tabs} tabs, add-data btn:${icj.addData}, roster:${icj.roster}` : String(icu));
  if (icj && icj.open) await shot("03-icu-dashboard");

  // ---- 9. Electrolyte Engine ----
  const elyte = await ev(`try{ var an = (window.ELYTE&&ELYTE.analyze)?ELYTE.analyze({na:128,k:5.8,ca:1.8},{age:60,sex:'m',weight:70},'si'):null; return JSON.stringify({open: typeof (window.ELYTE&&ELYTE.open), analyze: typeof (window.ELYTE&&ELYTE.analyze), results: an?an.length:0, sample: an&&an[0]?an[0].name+':'+an[0].severity:null});}catch(e){return '__ERR__'+e.message;}`);
  const elj = (typeof elyte === "string" && elyte[0] === "{") ? JSON.parse(elyte) : null;
  add("9. Electrolyte Engine", elj && elj.open === "function" && elj.results > 0 ? "PASS" : "WARN", elj ? `ELYTE.open:${elj.open}, analyze() → ${elj.results} analytes (${elj.sample})` : String(elyte));

  // ---- 10. Infusion Calculator ----
  const inf = await ev(`return JSON.stringify({open: typeof (window.INF&&INF.open), medcalc: typeof (window.MEDCALC&&MEDCALC.open)});`);
  const ifj = JSON.parse(inf || "{}");
  add("10. Infusion Calculator", ifj.open === "function" ? "PASS" : "WARN", `INF.open:${ifj.open}, MEDCALC.open:${ifj.medcalc}`);

  // ---- 11. Stewardship Engine ----
  const stew = await ev(`
    try{ if(window.StewardRAG&&StewardRAG.ready) await StewardRAG.ready();
      var t = (window.KB_RAG&&KB_RAG.treatments)?KB_RAG.treatments['CAP']:null;
      return JSON.stringify({treatments: window.KB_RAG?Object.keys(KB_RAG.treatments).length:0, capStewardship: !!(t&&t.stewardship), precedence: t?t.precedence:null});
    }catch(e){return '__ERR__'+e.message;}`);
  const sj = (typeof stew === "string" && stew[0] === "{") ? JSON.parse(stew) : null;
  add("11. Stewardship Engine", sj && sj.treatments > 0 ? "PASS" : "WARN", sj ? `${sj.treatments} treatments; CAP stewardship:${sj.capStewardship}; precedence ${JSON.stringify(sj.precedence)}` : String(stew));

  // ---- 13. Hospital Policy ----
  const pol = await ev(`try{ return JSON.stringify({policies: window.KB_RAG?Object.keys(KB_RAG.policies):[], gimsr: !!(window.KB_RAG&&KB_RAG.policies&&KB_RAG.policies.GIMSR)});}catch(e){return '__ERR__'+e.message;}`);
  const pj = (typeof pol === "string" && pol[0] === "{") ? JSON.parse(pol) : null;
  add("13. Hospital Policy", pj && pj.gimsr ? "PASS" : "WARN", pj ? `overlays: ${JSON.stringify(pj.policies)} (GIMSR loaded:${pj.gimsr})` : String(pol));

  // ---- 16. Dark mode ----
  const dark = await ev(`
    var body=document.body, htmlEl=document.documentElement, b0=getComputedStyle(body).backgroundColor;
    try{ if(window.SB && SB.toggleTheme) SB.toggleTheme(); else body.classList.toggle('dark'); }catch(e){}
    var applied = body.classList.contains('dark')||htmlEl.classList.contains('dark')||/dark/i.test((htmlEl.getAttribute('data-theme')||''))||/dark/i.test(body.className+' '+htmlEl.className);
    return JSON.stringify({before:b0, after:getComputedStyle(body).backgroundColor, applied:applied});`);
  const dj = JSON.parse(dark || "{}");
  await shot("04-dark-mode");
  add("16. Dark mode", (dj.applied || dj.before !== dj.after) ? "PASS" : "WARN", `theme toggle applied:${dj.applied}, body bg ${dj.before} → ${dj.after}`);
  await ev(`try{ if(window.SB && SB.toggleTheme) SB.toggleTheme(); else document.body.classList.remove('dark'); }catch(e){} return 1;`);

  // ---- 14. Mobile responsiveness ----
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  const mob = JSON.parse(await ev(`return JSON.stringify({sw: document.documentElement.scrollWidth, iw: window.innerWidth, overflow: document.documentElement.scrollWidth - window.innerWidth});`) || "{}");
  await shot("05-mobile-home");
  add("14. Mobile responsiveness", mob.overflow <= 3 ? "PASS" : "WARN", `390px viewport → horizontal overflow ${mob.overflow}px (${mob.overflow <= 3 ? "none" : "has overflow"})`);
  await call("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});

  // ---- 7. MaiK (mock Gemini) — isolated tab with stubbed /api/ai/* ----
  {
    const { result: { targetId: mt } } = await call("Target.createTarget", { url: "about:blank" });
    const { result: { sessionId: ms } } = await call("Target.attachToTarget", { targetId: mt, flatten: true });
    const mcall = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, { r, j: r }); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: ms })); }); };
    const mev = async (e) => { const r = await mcall("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return '__ERR__'+(x&&x.message||x)}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
    await mcall("Runtime.enable", {}); await mcall("Page.enable", {});
    await mcall("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem('smd_ai','1');}catch(e){}(function(){var of=window.fetch;window.fetch=function(u,i){var s=String(u);if(s.indexOf('/api/ai/status')>=0)return Promise.resolve({json:function(){return Promise.resolve({enabled:true});}});if(s.indexOf('/api/ai/explain')>=0)return Promise.resolve({json:function(){return Promise.resolve({mode:'grounded',citations:['Harrison 22e'],text:'### Additional differentials\\n- PE (Harrison 22e)\\n### Missing investigations\\n- Blood cultures\\n### Teaching points\\n- CURB-65\\n### Alternative interpretations\\n- Aspiration'});}});return of.apply(this,arguments);};})();` });
    await mcall("Page.navigate", { url: BASE + "?cb=" + Date.now() });
    let mready = false; for (let i = 0; i < 60; i++) { await sleep(400); const v = await mev(`return !!(window.StewardRAG&&window.SMD_MaiK&&window.SMD_REASON);`); if (v === true) { mready = true; break; } }
    const maik = await mev(`
      if(!window.SMD_MaiK) return '__ERR__MaiK not loaded';
      var aa=SMD_REASON.assess({fever:true,cough:true,dyspnea:true,purulentSputum:true,hypoxia:true});
      var pkg=await StewardRAG.buildPackage(aa,{caseData:{age:70,sex:'M',findings:['Fever','Cough']}});
      if(!pkg) return '__ERR__no package';
      var pcKeys=Object.keys(pkg.patientCase);
      var allowed=['age','sex','findings','abnormalLabs','labTrends','cultures','radiologyImpressions'];
      var r={mode:'grounded',citations:['Harrison 22e'],text:'### Additional differentials\\n- PE\\n### Missing investigations\\n- Cultures\\n### Teaching points\\n- CURB-65\\n### Alternative interpretations\\n- Aspiration'};
      var html=SMD_MaiK.compose(pkg,r);
      return JSON.stringify({
        chunks: pkg.grounding.reduce(function(a,g){return a+g.knowledge.length;},0)+pkg.retrieved.length,
        allowlisted: pcKeys.every(function(k){return allowed.indexOf(k)>=0;}),
        idLeak: /"(patientName|mrn|uhid|patientId|dob|bed)"\\s*:/i.test(JSON.stringify(pkg)),
        twoBlocks: /StewardMD Clinical Assessment/.test(html)&&/Independent Clinical Commentary/.test(html),
        disclaimer: /Clinician confirmation required/.test(html),
        sections: /Additional differentials/.test(html)&&/Missing investigations/.test(html)&&/Teaching points/.test(html)&&/Alternative interpretations/.test(html)
      });`);
    const mj = (typeof maik === "string" && maik[0] === "{") ? JSON.parse(maik) : null;
    add("7. MaiK (mock Gemini)", mj && mj.twoBlocks && mj.disclaimer && mj.allowlisted && !mj.idLeak ? "PASS" : "FAIL", mj ? `grounded pkg (${mj.chunks} chunks), de-identified:${mj.allowlisted}, no-id-leak:${!mj.idLeak}, two-block UI:${mj.twoBlocks}, sections:${mj.sections}, disclaimer:${mj.disclaimer}` : String(maik));
    if (mj && mj.twoBlocks) { sessionId = ms; await shot("06-maik-commentary"); sessionId = sid; }
    await mcall("Target.closeTarget", { targetId: mt }).catch(() => {});
  }

  // ---- 15. Offline mode (service worker) ----
  const swReg = await ev(`return ('serviceWorker' in navigator) && !!(await navigator.serviceWorker.getRegistration());`);
  await call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await call("Page.navigate", { url: BASE + "?cb=off" + Date.now() });
  const offReady = await waitReady(`return !!(window.SMD_REASON && document.getElementById('smdSearchInput'));`, 25);
  const offReason = offReady ? await ev(`try{var a=SMD_REASON.assess({fever:true,cough:true});return !!(a&&(a.infectious||a.nonInfectious));}catch(e){return false;}`) : false;
  await shot("07-offline");
  add("15. Offline mode", swReg && offReady && offReason ? "PASS" : (swReg ? "WARN" : "WARN"), `SW registered:${swReg}, app shell loads offline:${offReady}, engine works offline:${offReason}`);
  await call("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  // ---- 18. Accessibility (heuristics) ----
  const a11y = JSON.parse(await ev(`
    var imgs=[].slice.call(document.images); var imgAlt=imgs.filter(function(i){return i.getAttribute('alt')!=null;}).length;
    var btns=[].slice.call(document.querySelectorAll('button')); var btnNamed=btns.filter(function(b){return (b.textContent||'').trim()||b.getAttribute('aria-label')||b.getAttribute('title');}).length;
    var inputs=[].slice.call(document.querySelectorAll('input,select,textarea')); var labelled=inputs.filter(function(x){return x.getAttribute('aria-label')||x.labels&&x.labels.length||x.getAttribute('placeholder')||x.id&&document.querySelector('label[for=\\''+x.id+'\\']');}).length;
    return JSON.stringify({lang: document.documentElement.getAttribute('lang')||null, title: !!document.title, imgs: imgs.length, imgAlt: imgAlt, btns: btns.length, btnNamed: btnNamed, inputs: inputs.length, labelled: labelled});`) || "{}");
  const imgPct = a11y.imgs ? Math.round(100 * a11y.imgAlt / a11y.imgs) : 100;
  const btnPct = a11y.btns ? Math.round(100 * a11y.btnNamed / a11y.btns) : 100;
  add("18. Accessibility", (a11y.lang && a11y.title && btnPct >= 90 && imgPct >= 90) ? "PASS" : "WARN", `lang:${a11y.lang}, title:${a11y.title}, img-alt ${imgPct}% (${a11y.imgAlt}/${a11y.imgs}), buttons-named ${btnPct}% (${a11y.btnNamed}/${a11y.btns}), inputs-labelled ${a11y.labelled}/${a11y.inputs}`);

  // ---- report ----
  const pass = results.filter((r) => r.status === "PASS").length, fail = results.filter((r) => r.status === "FAIL").length, warn = results.filter((r) => r.status === "WARN").length;
  const apiFailures = netFailures.filter((n) => /\/api\//.test(n.url));
  const broken = netFailures.filter((n) => !/\/api\//.test(n.url));
  const uniq = (a) => [...new Set(a)];

  const md = [];
  md.push(`# StewardMD Clinical Validation Report`);
  md.push(`Target: ${BASE}  ·  Generated headlessly (audit only — no code modified)`);
  md.push(`\n## Summary\n**✅ ${pass} passed · ❌ ${fail} failed · ⚠️ ${warn} warnings** (of ${results.length} workflows)`);
  md.push(`\n## Workflow results\n| # | Workflow | Result | Detail |\n|---|---|---|---|`);
  results.forEach((r) => md.push(`| | ${r.area} | ${r.status === "PASS" ? "✅ PASS" : r.status === "FAIL" ? "❌ FAIL" : "⚠️ WARN"} | ${r.detail.replace(/\|/g, "\\|")} |`));
  md.push(`\n## Performance\n- First contentful paint: **${perf.nav.fcp} ms**\n- DOMContentLoaded: **${perf.nav.dcl} ms**\n- Load: **${perf.nav.load} ms**\n- App-interactive: **${perf.appReadyMs} ms**\n- Resources: **${perf.resources}**, transfer ~${perf.nav.transfer} KB (navigation doc)`);
  md.push(`\n## JavaScript errors (${jsErrors.length})\n` + (jsErrors.length ? uniq(jsErrors).slice(0, 20).map((e) => "- `" + String(e).replace(/`/g, "'").slice(0, 200) + "`").join("\n") : "None detected."));
  md.push(`\n## API failures (${apiFailures.length})\n` + (apiFailures.length ? uniq(apiFailures.map((n) => n.status + " " + n.url)).slice(0, 20).map((s) => "- " + s).join("\n") : "None (only non-PHI /api/*/status probed)."));
  md.push(`\n## Broken links / failed resources (${broken.length})\n` + (broken.length ? uniq(broken.map((n) => n.status + " " + n.url)).slice(0, 30).map((s) => "- " + s).join("\n") : "None detected."));
  md.push(`\n## Screenshots\n` + shots.map((s) => `- **${s.name}** — ${s.file}`).join("\n"));
  const report = { base: BASE, generatedAt: new Date().toISOString(), summary: { pass, fail, warn, total: results.length }, results, performance: perf, jsErrors: uniq(jsErrors), apiFailures, brokenLinks: broken, screenshots: shots };
  writeFileSync(OUTDIR + "/report.json", JSON.stringify(report, null, 2));
  writeFileSync(OUTDIR + "/report.md", md.join("\n") + "\n");

  console.log(`\n${"=".repeat(60)}`);
  console.log(`RESULT: ✅ ${pass} passed · ❌ ${fail} failed · ⚠️ ${warn} warnings`);
  console.log(`JS errors: ${uniq(jsErrors).length} · API failures: ${apiFailures.length} · broken links: ${broken.length} · screenshots: ${shots.length}`);
  console.log(`Report: ${OUTDIR}/report.md  (+ report.json, shots/)`);
  process.exitCode = fail > 0 ? 1 : 0;
} catch (e) {
  console.log("HARNESS ERROR:", e.message); process.exitCode = 2;
} finally {
  try { chrome.kill(); } catch {}
  setTimeout(() => process.exit(process.exitCode || 0), 400);
}
