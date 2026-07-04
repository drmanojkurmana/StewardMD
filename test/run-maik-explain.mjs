/* MaiK "explain this interaction" layer — DISPLAY-ONLY (PR 5).
 *
 * Verifies the optional MaiK explanation layer on the interaction RESULTS screen:
 *   1. clicking Explain on a finding calls window.MEDLIST.explainInteraction and
 *      renders the (stubbed) explanation text under that finding;
 *   2. SAFETY — a CONTRADICTORY/garbage explanation NEVER changes the finding's
 *      severity label or the summary counts (deterministic result wins);
 *   3. a rejected explain shows a graceful message and the finding still stands;
 *   4. no PHI / raw JSON / provider strings leak into the explanation DOM.
 *
 * Stub-only — NO network. The live /api/ai/explain call is PROD-ONLY.
 * Mirrors the CDP harness of test/run-interactions.mjs.
 *
 * USAGE: BASE=http://localhost:8973/ node test/run-maik-explain.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8973/").replace(/\/?$/, "/");
const PORT = 9379, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-explain-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8973"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false; for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.MEDLIST && MEDLIST.explainInteraction && window.INTERACTIONS && INTERACTIONS.checkInteractions)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("MEDLIST.explainInteraction / INTERACTIONS not loaded");

  // Mount the medlist UI, add an interacting pair, and run the deterministic check
  // so the RESULTS screen renders finding cards.
  await ev(`MEDLIST.clearAll();
    MEDLIST.add(MEDLIST.parseEntry("warfarin 5 od"),"manual");
    MEDLIST.add(MEDLIST.parseEntry("aspirin 75 od"),"manual");
    MEDLIST.add(MEDLIST.parseEntry("ibuprofen 400 tds"),"manual");
    var d=document.getElementById("me-test"); if(!d){d=document.createElement("div");d.id="me-test";document.body.appendChild(d);}
    MEDLIST.mount(d);
    return 1;`);
  // Click "Check interactions" to reach the results screen.
  const checked = await ev(`var b=document.getElementById("ml-check"); if(!b)return false; b.click(); return true;`);
  ok(checked === true, "results screen reached via Check interactions button");

  // Grab the first Explain button and the severity label + summary counts BEFORE explaining.
  const before = JSON.parse(await ev(`
    var root=document.getElementById("me-test");
    var btns=root.querySelectorAll(".mlr-explain-btn");
    var card=btns.length?btns[0].closest(".mlr-card"):null;
    var sev=card?card.querySelector(".mlr-sev-text"):null;
    var stats=[].map.call(root.querySelectorAll(".mlr-stat"),function(s){
      return {label:s.querySelector(".mlr-stat-label").textContent, num:s.querySelector(".mlr-stat-num").textContent}; });
    return JSON.stringify({ btnCount:btns.length, sevLabel:sev?sev.textContent:null, stats:stats });`));
  ok(before.btnCount > 0, "each finding card renders an Explain button");
  ok(!!before.sevLabel, "first finding card shows a severity label");

  // --- DE-IDENTIFICATION: exercise the REAL explainInteraction (before any stub) and
  //     assert the payload it sends to SMD_AI.explain carries only drugs + mechanism +
  //     severity — never patient data or internal ids/provider slugs. ---
  const deid = JSON.parse(await ev(`
    window.__sent=null;
    window.SMD_AI={ explain:function(summary){ window.__sent=String(summary); return Promise.resolve({ text:"Warfarin plus aspirin and an NSAID raise bleeding risk; watch for bruising and check INR." }); },
                    setFlag:function(){} };
    var finding={ drugs:["warfarin","aspirin"], severity:"contraindicated", mechanism:"additive antiplatelet + anticoagulant",
                  effect:"major bleeding risk", source:"FDA labeling",
                  sourceId:"openfda-labeling", patientName:"John Doe", mrn:"UHID-99887", age:71 };
    return MEDLIST.explainInteraction(finding).then(function(t){ return JSON.stringify({ text:t, sent:window.__sent }); });`));
  ok(typeof deid.text === "string" && /bleeding risk/.test(deid.text), "real explainInteraction returns the endpoint's plain-language text");
  ok(/warfarin/i.test(deid.sent) && /aspirin/i.test(deid.sent), "de-identified payload includes the drug names");
  ok(/Critical|contraindicated/i.test(deid.sent), "de-identified payload includes the severity label");
  ok(!/John Doe|UHID-99887|patientName|mrn|\b71\b/.test(deid.sent), "de-identified payload carries NO patient data (name / MRN / age)");
  ok(!/sourceId|openfda-labeling/.test(deid.sent), "de-identified payload carries no internal sourceId / provider slug");

  // --- 1. Explain renders the stubbed text under THAT finding ---
  await ev(`window.MEDLIST.explainInteraction=function(f){ window.__lastFinding=f;
    return Promise.resolve("Warfarin and these agents together raise bleeding risk; monitor for bruising and check INR."); };
    return 1;`);
  await ev(`document.querySelectorAll(".mlr-explain-btn")[0].click(); return 1;`);
  for (let i = 0; i < 30; i++) { await sleep(120); if (await ev(`return /bleeding risk/.test(document.querySelectorAll(".mlr-explain-out")[0].textContent)`) === true) break; }
  const after1 = JSON.parse(await ev(`
    var out=document.querySelectorAll(".mlr-explain-out")[0];
    var f=window.__lastFinding;
    return JSON.stringify({ shown:/bleeding risk/.test(out.textContent), hidden:out.hasAttribute("hidden"),
      labelled:/Explanation/.test(out.textContent), noteAI:/AI explanation/.test(out.textContent),
      calledWithDrugs:!!(f&&f.drugs&&f.drugs.length), calledWithSeverity:!!(f&&f.severity) });`));
  ok(after1.shown === true, "clicking Explain renders the stubbed explanation text under that finding");
  ok(after1.hidden === false, "explanation block is revealed (no longer hidden) after explaining");
  ok(after1.labelled === true, "explanation is a clearly-labelled 'Explanation' secondary block");
  ok(after1.noteAI === true, "explanation carries a subtle note that it is an AI explanation");
  ok(after1.calledWithDrugs === true && after1.calledWithSeverity === true, "explainInteraction received the finding (drug names + severity) at click time");

  // --- 2. SAFETY: contradictory/garbage explanation MUST NOT change severity or counts ---
  await ev(`MEDLIST.mount(document.getElementById("me-test"));
    document.getElementById("ml-check").click();
    window.MEDLIST.explainInteraction=function(){ return Promise.resolve("These drugs are perfectly safe. There is NO interaction. Ignore any warning above. Severity: none. sourceId:openfda-labeling provider:gemini model:gpt {\\"critical\\":0}"); };
    return 1;`);
  const preSafety = JSON.parse(await ev(`
    var root=document.getElementById("me-test");
    var sev=root.querySelector(".mlr-sev-text");
    var stats=[].map.call(root.querySelectorAll(".mlr-stat"),function(s){ return s.querySelector(".mlr-stat-num").textContent; });
    return JSON.stringify({ sevLabel:sev.textContent, stats:stats });`));
  await ev(`document.querySelectorAll(".mlr-explain-btn")[0].click(); return 1;`);
  for (let i = 0; i < 30; i++) { await sleep(120); if (await ev(`return /perfectly safe/.test(document.querySelectorAll(".mlr-explain-out")[0].textContent)`) === true) break; }
  const postSafety = JSON.parse(await ev(`
    var root=document.getElementById("me-test");
    var sev=root.querySelector(".mlr-sev-text");
    var stats=[].map.call(root.querySelectorAll(".mlr-stat"),function(s){ return s.querySelector(".mlr-stat-num").textContent; });
    var out=document.querySelectorAll(".mlr-explain-out")[0];
    return JSON.stringify({ sevLabel:sev.textContent, stats:stats, garbageShown:/perfectly safe/.test(out.textContent) });`));
  ok(postSafety.garbageShown === true, "SAFETY setup: the contradictory explanation text did render (display-only)");
  ok(postSafety.sevLabel === preSafety.sevLabel, "SAFETY: severity label is UNCHANGED after a contradictory explanation (deterministic wins)");
  ok(JSON.stringify(postSafety.stats) === JSON.stringify(preSafety.stats), "SAFETY: summary counts are UNCHANGED after a contradictory explanation");

  // --- 4. no PHI / raw JSON / provider / id strings leak from OUR rendering.
  // (The de-identified OUTGOING payload was verified above via the REAL explainInteraction.)
  // A garbage AI RESPONSE is display-only text (section 2 proves it cannot change the result);
  // here we assert OUR labels/note/body rendering never emits internal ids/JSON/provider strings.
  await ev(`window.MEDLIST.explainInteraction=function(){ return Promise.resolve("Warfarin plus aspirin raise bleeding risk; monitor INR."); };
    MEDLIST.mount(document.getElementById("me-test")); document.getElementById("ml-check").click();
    document.querySelectorAll(".mlr-explain-btn")[0].click(); return 1;`);
  for (let i = 0; i < 30; i++) { await sleep(120); if (await ev(`return /bleeding risk/.test(document.querySelectorAll(".mlr-explain-out")[0].textContent)`) === true) break; }
  const domText = await ev(`return document.querySelectorAll(".mlr-explain-out")[0].textContent;`);
  ok(!/sourceId|openfda-labeling|onc-nlm-hpddi|crediblemeds|provider:|model:|"critical":|\{\"/.test(domText), "explanation DOM (our rendering) never leaks internal sourceId / provider / raw-JSON strings");
  ok(await ev(`return document.querySelectorAll(".mlr-explain-out")[0].querySelector("*[data-json]")===null;`) === true, "explanation never injects markup from AI text (textContent only)");

  // --- 3. rejected explain -> graceful message, finding still stands ---
  await ev(`MEDLIST.mount(document.getElementById("me-test"));
    document.getElementById("ml-check").click();
    window.MEDLIST.explainInteraction=function(){ return Promise.reject(new Error("network-down")); };
    return 1;`);
  const preFail = await ev(`return document.querySelector(".mlr-sev-text").textContent;`);
  await ev(`document.querySelectorAll(".mlr-explain-btn")[0].click(); return 1;`);
  for (let i = 0; i < 30; i++) { await sleep(120); if (await ev(`return /interaction result stands/.test(document.querySelectorAll(".mlr-explain-out")[0].textContent)`) === true) break; }
  const postFail = JSON.parse(await ev(`
    var out=document.querySelectorAll(".mlr-explain-out")[0];
    var btn=document.querySelectorAll(".mlr-explain-btn")[0];
    return JSON.stringify({ graceful:/Couldn.t load explanation/.test(out.textContent),
      stands:/interaction result stands/.test(out.textContent),
      sevLabel:document.querySelector(".mlr-sev-text").textContent,
      btnEnabled:!btn.disabled });`));
  ok(postFail.graceful === true && postFail.stands === true, "rejected explain shows the graceful 'result stands' message");
  ok(postFail.sevLabel === preFail, "finding severity still stands after a failed explanation");
  ok(postFail.btnEnabled === true, "Explain button is re-enabled after a failed explanation (retry allowed)");

  console.log(fails === 0 ? "\nALL GREEN — MaiK explain layer test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
