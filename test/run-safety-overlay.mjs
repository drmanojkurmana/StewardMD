/* StewardMD — patient-specific safety overlay regression test.
 * Loads the app headless, exercises the pure SMD_SAFETY checks with synthetic
 * findings, and (Task 7) drives the injector against a stubbed #outputArea.
 * USAGE: BASE=http://localhost:5173/ node test/run-safety-overlay.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const BASE = (process.env.BASE || "http://localhost:5173/").replace(/\/?$/, "/");
const PORT = Number(process.env.CDP_PORT || 9492);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${(process.env.CLAUDE_JOB_DIR||"/tmp")}/tmp/safety-chrome`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let id = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = id++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const chk = (n, ok, d) => { console.log(`  ${ok?"✅":"❌"} ${n}${d?" — "+d:""}`); if (!ok) fails++; };
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }); sid = sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await ev(`if(navigator.serviceWorker)navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});});return 1;`);
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() });
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.SMD_SAFETY && window.ASP_DRUGS)`) === true) break; }

  // ---- Task 2: flag ----
  chk("SMD_SAFETY exposed", await ev(`return !!window.SMD_SAFETY`) === true);
  chk("flag defaults ON", await ev(`return String(SMD_SAFETY.flag())`) === "true");
  await ev(`SMD_SAFETY.setFlag(false); return 1;`);
  chk("setFlag(false) turns it off", await ev(`return String(SMD_SAFETY.flag())`) === "false");
  await ev(`SMD_SAFETY.setFlag(true); return 1;`);
  chk("setFlag(true) turns it on", await ev(`return String(SMD_SAFETY.flag())`) === "true");

  // ---- Task 3: detectRecommendedDrugs ----
  await ev(`
    var oa = document.getElementById("outputArea") || (function(){var d=document.createElement("div");d.id="outputArea";document.body.appendChild(d);return d;})();
    oa.innerHTML = '<div class="qa-regimen"><div class="qa-regimen-row">Azithromycin 500 mg PO once daily</div><div class="qa-regimen-row">Amoxicillin-clavulanate 625 mg PO q8h</div></div>';
    return 1;`);
  const det = JSON.parse(await ev(`return JSON.stringify(SMD_SAFETY.detectRecommendedDrugs())`));
  chk("detect finds azithromycin", det.indexOf("azithromycin") >= 0, JSON.stringify(det));
  chk("detect finds amoxiclav (generic-name match)", det.indexOf("amoxiclav") >= 0 || det.indexOf("amoxicillin") >= 0, JSON.stringify(det));
  chk("detect does NOT find levofloxacin (absent)", det.indexOf("levofloxacin") < 0);

  await ev(`
    var oa = document.getElementById("outputArea");
    oa.innerHTML = '<div class="qa-regimen"><div class="qa-regimen-row">Levofloxacin 750 mg PO once daily</div></div>';
    return 1;`);
  const detLevo = JSON.parse(await ev(`return JSON.stringify(SMD_SAFETY.detectRecommendedDrugs())`));
  chk("word-boundary: levofloxacin-only regimen detects levofloxacin", detLevo.indexOf("levofloxacin") >= 0, JSON.stringify(detLevo));
  chk("word-boundary: levofloxacin-only regimen does NOT spuriously flag ofloxacin", detLevo.indexOf("ofloxacin") < 0, JSON.stringify(detLevo));

  // ---- Task 4: renalCheck ----
  const rc = JSON.parse(await ev(`return JSON.stringify(SMD_SAFETY.renalCheck({age:80,weight:60,sex:"m",creatinine:2.5}))`));
  chk("renalCheck computes low CrCl", rc && rc.crcl > 0 && rc.crcl < 30, JSON.stringify(rc));
  chk("renalCheck tier is severe (~20)", rc && /severe/.test(rc.tier), rc && rc.tier);
  chk("renalCheck text mentions CrCl", rc && /CrCl/.test(rc.text));
  chk("renalCheck null when CrCl normal", await ev(`return String(SMD_SAFETY.renalCheck({age:30,weight:70,sex:"m",creatinine:0.8})===null)`) === "true");
  chk("renalCheck null when inputs missing", await ev(`return String(SMD_SAFETY.renalCheck({age:80})===null)`) === "true");
  const rcF = JSON.parse(await ev(`return JSON.stringify(SMD_SAFETY.renalCheck({age:70,weight:60,sex:"f",creatinine:2.0}))`));
  const rcM = JSON.parse(await ev(`return JSON.stringify(SMD_SAFETY.renalCheck({age:70,weight:60,sex:"m",creatinine:2.0}))`));
  chk("renalCheck applies female factor (0.85x lower CrCl than male)", rcF && rcM && rcF.crcl < rcM.crcl, JSON.stringify({ f: rcF, m: rcM }));
  chk("renalCheck null exactly at CrCl=50 boundary", await ev(`return String(SMD_SAFETY.renalCheck({age:40,weight:36,sex:"m",creatinine:1})===null)`) === "true");
  chk("renalCheck non-null just below CrCl=50 (~49)", await ev(`var r=SMD_SAFETY.renalCheck({age:40,weight:35,sex:"m",creatinine:1});return String(r!==null && r.crcl===49);`) === "true");

  // ---- Task 5: hepaticCheck ----
  const hc = JSON.parse(await ev(`return JSON.stringify(SMD_SAFETY.hepaticCheck({liverDisease:true}, ["azithromycin","amoxiclav"]))`));
  chk("hepaticCheck fires on liverDisease", hc && /Hepatic impairment/.test(hc.text), JSON.stringify(hc));
  chk("hepaticCheck surfaces azithromycin hepatic text (Caution)", hc && hc.perDrug.some(function(d){return /azithromycin/i.test(d.label);}), JSON.stringify(hc.perDrug));
  chk("hepaticCheck fires on bilirubin>2", await ev(`return String(SMD_SAFETY.hepaticCheck({bilirubin:3},[])!==null)`) === "true");
  chk("hepaticCheck null when no hepatic trigger", await ev(`return String(SMD_SAFETY.hepaticCheck({bilirubin:0.9},["azithromycin"])===null)`) === "true");

  // ---- Task 6: cardioCheck ----
  const cc = JSON.parse(await ev(`return JSON.stringify(SMD_SAFETY.cardioCheck({age:78,knownCAD:true}, ["azithromycin"]))`));
  chk("cardioCheck fires (elderly+cardiac+azithro)", cc && cc.drug === "azithromycin", JSON.stringify(cc));
  chk("cardioCheck text names QT + alternatives", cc && /QT/.test(cc.text) && /doxycycline/.test(cc.text));
  chk("cardioCheck null when young non-cardiac", await ev(`return String(SMD_SAFETY.cardioCheck({age:30}, ["azithromycin"])===null)`) === "true");
  chk("cardioCheck null when no QT drug", await ev(`return String(SMD_SAFETY.cardioCheck({age:80,knownCAD:true}, ["amoxiclav"])===null)`) === "true");
  chk("cardioCheck fires on age>=65 alone", await ev(`return String(SMD_SAFETY.cardioCheck({age:70}, ["levofloxacin"])!==null)`) === "true");

  // ---- Task 7: injector ----
  await ev(`
    var oa = document.getElementById("outputArea");
    oa.innerHTML = '<div class="qa-regimen"><div class="qa-regimen-row">Azithromycin 500 mg PO once daily</div></div>';
    window.__sret = SMD_SAFETY.render({age:80,knownCAD:true,creatinine:2.5,weight:60,sex:"m",liverDisease:true});
    return 1;`);
  chk("render returns true when triggers fire", await ev(`return String(window.__sret)`) === "true");
  chk("safety card injected", await ev(`return !!document.getElementById("smdSafetyCard")`) === true);
  chk("card has inline inputs", await ev(`return !!(document.getElementById("smdSafetyInputs") && document.querySelector('#smdSafetyInputs [data-sfx="creatinine"]'))`) === true);
  const lineTxt = () => ev(`var l=document.getElementById("smdSafetyLines");return l?l.innerText:""`);
  const cardTxt = await lineTxt();
  chk("lines show Renal (prefilled from findings)", /Renal/.test(cardTxt));
  chk("lines show Hepatic", /Hepatic/.test(cardTxt));
  chk("lines show Cardiac + QT", /Cardiac/.test(cardTxt) && /QT/.test(cardTxt));
  await ev(`SMD_SAFETY.render({age:80,knownCAD:true,creatinine:2.5,weight:60,sex:"m",liverDisease:true}); return 1;`);
  chk("idempotent — single card", await ev(`return document.querySelectorAll("#smdSafetyCard").length`) === 1);
  await ev(`SMD_SAFETY.setFlag(false); var r=SMD_SAFETY.render({age:80,knownCAD:true,creatinine:2.5,weight:60,sex:"m",liverDisease:true}); SMD_SAFETY.setFlag(true); window.__off=r; return 1;`);
  chk("flag OFF → no card, returns false", await ev(`return String(window.__off)`) === "false" && await ev(`return !document.getElementById("smdSafetyCard")`) === true);
  // a recommendation with no risk yet → card + inputs SHOW (discoverable), but no risk lines
  await ev(`document.getElementById("outputArea").innerHTML='<div class="qa-regimen"><div class="qa-regimen-row">Amoxicillin 500 mg</div></div>'; window.__r=SMD_SAFETY.render({age:30,weight:70,sex:"m",creatinine:0.8}); return 1;`);
  chk("recommendation + no triggers → card shown with inputs, no risk lines", await ev(`return String(window.__r)`) === "true" && await ev(`return !!document.getElementById("smdSafetyInputs")`) === true && !/Renal|Hepatic|Cardiac/.test(await lineTxt()));
  chk("no recommendation + no labs → no card", await ev(`document.getElementById("outputArea").innerHTML='<div>Antibiotics not indicated.</div>'; var r=SMD_SAFETY.render({age:30}); return String(r)+"|"+!!document.getElementById("smdSafetyCard");`) === "false|false");

  // ---- Inline inputs drive the checks LIVE (the discoverability fix) ----
  await ev(`document.getElementById("outputArea").innerHTML='<div class="qa-regimen"><div class="qa-regimen-row">Azithromycin 500 mg</div></div>'; SMD_SAFETY.setFlag(true); window.__ir=SMD_SAFETY.render({sex:"m"}); return 1;`);
  chk("inline: card + inputs appear with no patient data entered", await ev(`return String(window.__ir)`) === "true" && await ev(`return !!document.getElementById("smdSafetyInputs")`) === true);
  chk("inline: no risk lines before any value entered", !/Renal|Hepatic|Cardiac/.test(await lineTxt()));
  await ev(`function setv(k,v){var el=document.querySelector('#smdSafetyInputs [data-sfx="'+k+'"]');el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}));} setv("age","80");setv("weight","60");setv("creatinine","3"); return 1;`);
  chk("inline: renal line appears LIVE after typing age/weight/creatinine", /Renal/.test(await lineTxt()) && /CrCl/.test(await lineTxt()));
  await ev(`var c=document.querySelector('#smdSafetyInputs [data-sfx="cardiac"]');c.checked=true;c.dispatchEvent(new Event("change",{bubbles:true})); return 1;`);
  chk("inline: cardiac QT line appears LIVE after ticking Cardiac", /Cardiac/.test(await lineTxt()) && /QT/.test(await lineTxt()));
  await ev(`var c=document.querySelector('#smdSafetyInputs [data-sfx="liverDisease"]');c.checked=true;c.dispatchEvent(new Event("change",{bubbles:true})); return 1;`);
  chk("inline: hepatic line appears LIVE after ticking Liver disease", /Hepatic/.test(await lineTxt()));

  // ---- Fast-follow: real-render E2E — drives the ACTUAL renderOutput seam (not a stubbed #outputArea) ----
  await ev(`SMD_SAFETY.setFlag(true); return 1;`);
  // wait for the engine + the reasoning.js renderOutput wrapper to be installed
  for (let i = 0; i < 50; i++) { if (await ev(`return !!(window.renderOutput && window.__smdEngineExpanded && window.SYNDROMES && window.SYNDROMES.COMPLICATED_UTI)`) === true) break; await sleep(200); }
  // (a) antibiotic path: COMPLICATED_UTI's real regimen contains ciprofloxacin (a QT-prolonger);
  //     elderly + cardiac + low CrCl patient → renal + cardio lines should fire against REAL markup.
  await ev(`window.renderOutput({age:80,knownCAD:true,creatinine:2.5,weight:60,sex:"m",fever:true,cough:true,hypotension:true,severeCriteria:true}, "COMPLICATED_UTI"); return 1;`);
  chk("E2E: card injected on a real antibiotic render", await ev(`return !!document.getElementById("smdSafetyCard")`) === true);
  const e2eTxt = await ev(`var l=document.getElementById("smdSafetyLines");return l?l.innerText:""`);
  chk("E2E: cardio QT line fired from REAL regimen (ciprofloxacin)", /Cardiac/.test(e2eTxt) && /QT/.test(e2eTxt) && /Ciprofloxacin/i.test(e2eTxt), (e2eTxt||"").slice(0, 90));
  chk("E2E: renal line fired (low CrCl)", /Renal/.test(e2eTxt) && /CrCl/.test(e2eTxt));
  const posv = await ev(`
    var oa=document.getElementById("outputArea"); var scp=oa.querySelector("#saveCasePrompt"); var card=document.getElementById("smdSafetyCard");
    if(!card) return "nocard";
    if(!scp) return "nosavebox";
    return String(!!(scp.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING));`);
  chk("E2E: card sits AFTER the Save-case box (not above it)", posv === "true" || posv === "nosavebox", "pos=" + posv);
  // (b) isNI gate: rendering a NON-infective diagnosis must NOT inject the safety card
  await ev(`window.renderOutput({age:80,knownCAD:true,creatinine:2.5,weight:60,sex:"m"}, "acs"); return 1;`);
  chk("E2E: NO safety card on the non-infective (isNI) page", await ev(`return !document.getElementById("smdSafetyCard")`) === true);

  console.log(`\n${fails ? "❌ " + fails + " FAILED" : "✅ ALL GREEN"}`);
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
process.exitCode = fails ? 1 : 0;
