/* StewardMD - differentiating questions (smd_dx_ask) real-browser test.
 *   1. flag OFF: "Select this diagnosis" goes straight to the diagnosis page, as before.
 *   2. flag ON (with smd_kb_v2): SMD_REASON.differentiate names the closest rivals of a chosen
 *      diagnosis and the findings that separate them, each saying which way a yes points; it is pure;
 *      it never asks the mislabelled feverGU, and a yes only "favours" a diagnosis it raises.
 *   3. the panel: Select opens it; Yes adds the finding, No records a pertinent negative, Not known
 *      undoes; the verdict follows (a rival that overtakes is named, with a Switch button); Back keeps
 *      the case; Continue opens the chosen diagnosis; no rival -> no panel. Fits a 390px phone.
 * USAGE: node test/serve.mjs . 8804 & BASE=http://localhost:8804/ CHROME=/path/to/chrome node test/run-dx-ask.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.BASE || "http://localhost:8804/").replace(/\/?$/, "/");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9491);
const JOB = process.env.CLAUDE_JOB_DIR || "/tmp";

let serveProc = null;
try { await fetch(BASE); } catch {
  const m = BASE.match(/^http:\/\/localhost:(\d+)\//);
  if (m) { serveProc = spawn("node", [join(ROOT, "test", "serve.mjs"), ROOT, m[1]], { stdio: "ignore" }); for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } } }
}
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${JOB}/dx-ask-prof-${process.pid}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
async function load(url) {
  await call("Page.navigate", { url });
  for (let i = 0; i < 150; i++) {
    await sleep(300);
    const r = await ev(`if(window.SMD_KB_READY&&!window.__t){window.__t=1;SMD_KB_READY.then(function(){window.__t=2;});}
      return window.__t===2&&!!(window.SMD_REASON&&window.DX&&window.KB_CORE);`);
    if (r === true) return true;
  }
  return false;
}
const HEP = ["fever", "jaundice", "nauseaVomiting"];
const diff = async (t, f) => JSON.parse(await ev(`var f={}; ${JSON.stringify(f)}.forEach(function(k){f[k]=true;}); return JSON.stringify(SMD_REASON.differentiate(${JSON.stringify(t)}, f));`));
// open the workspace on a finding set, expand a card and press its Select button
const selectIn = async (f, id) => ev(`try{DX.openWorkspace();}catch(e){} DX.reset(); DX.addFindings(${JSON.stringify(f)});
  var h=document.querySelector('.dx-row-head[data-id="${id}"]'); if(!h) return 'no card'; h.click();
  var b=document.querySelector('.dx-card .dx-select[data-sel="${id}"]'); if(!b) return 'no select'; b.click(); return 'ok';`);
const panel = async () => JSON.parse(await ev(`var el=document.querySelector('#dxAsk'), ov=document.querySelector('#dxOverlay');
  return JSON.stringify({on:!!(el&&el.classList.contains('on')), text:el?el.innerText:'', nq:el?el.querySelectorAll('.dx-ask-q').length:0,
    warn:!!(el&&el.querySelector('.dx-ask-v.warn')), sw:!!(el&&[].some.call(el.querySelectorAll('[data-askgo]'),function(b){return /Switch/.test(b.textContent);})),
    ws:!!(ov&&ov.classList.contains('on')), f:Object.keys(DX._state.f).sort(), neg:Object.keys(DX._state.neg||{}).filter(function(k){return DX._state.neg[k];})});`));
const answer = async (k, v) => ev(`var b=document.querySelector('#dxAsk [data-ask="${k}"][data-v="${v}"]'); if(!b) return 'missing'; b.click(); return 'ok';`);

try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  // ---- 1. OFF --------------------------------------------------------------------------------
  ok(await load(BASE + "?dxask=0&kbv2=1"), "app + KB load with ?dxask=0");
  ok((await selectIn(HEP, "VIRAL_HEPATITIS")) === "ok", "off · viral hepatitis card has a Select button");
  const p0 = await panel();
  ok(!p0.on && !p0.ws, "off · Select goes straight to the diagnosis page (no questions, workspace closed)");
  // the gate card's "Open full stewardship page" is not a diagnosis card: never asks, flag on or off
  const gateBtn = `try{DX.openWorkspace();}catch(e){} DX.reset(); DX.addFindings(["fever","headache","neckStiffness"]); var b=document.querySelector('#dxPolicy .dx-select'); if(!b) return 'none'; b.click(); return 'ok';`;

  // ---- 2. ON: engine -------------------------------------------------------------------------
  ok(await load(BASE + "?dxask=1&kbv2=1"), "app + KB load with ?dxask=1&kbv2=1");
  const before = await ev(`return JSON.stringify(SMD_REASON.assess({fever:true,jaundice:true,nauseaVomiting:true}))`);
  const d = await diff("VIRAL_HEPATITIS", HEP);
  const after = await ev(`return JSON.stringify(SMD_REASON.assess({fever:true,jaundice:true,nauseaVomiting:true}))`);
  ok(before === after, "on  · differentiate is pure (assess identical before and after)");
  ok(d && d.rivals.some((r) => r.id === "CHOLANGITIS"), `on  · viral hepatitis: rivals ${d && d.rivals.map((r) => r.name).join(", ")}`);
  const q = Object.fromEntries((d ? d.questions : []).map((x) => [x.key, x]));
  ok(q.dilatedCBD && q.dilatedCBD.favours === "CHOLANGITIS", `on  · asks dilated CBD: yes favours ${q.dilatedCBD && q.dilatedCBD.favoursName}`);
  ok(q.transaminasesVeryHigh && q.transaminasesVeryHigh.favours === "VIRAL_HEPATITIS", `on  · asks ALT/AST > 1000: yes favours ${q.transaminasesVeryHigh && q.transaminasesVeryHigh.favoursName}`);
  ok(d.questions.every((x) => x.key !== "feverGU"), "on  · never asks the mislabelled 'fever with urinary symptoms'");
  const dg = await diff("DENGUE", ["fever", "rash", "myalgiaArthralgia"]);
  ok(dg && !dg.questions.some((x) => x.key === "neckStiffness"), "on  · dengue: neck stiffness is not offered as 'favours chikungunya' (a yes must raise the diagnosis it favours)");
  ok(dg && dg.questions.some((x) => x.key === "thrombocytopenia" && x.favours === "DENGUE"), "on  · dengue: thrombocytopenia favours dengue");
  const ch = await diff("CHOLANGITIS", ["fever", "jaundice", "rightUpperQuadrantPain"]);
  ok(ch && ch.questions.some((x) => x.key === "transaminasesVeryHigh" && x.favours === "VIRAL_HEPATITIS"), "on  · starting from cholangitis, ALT/AST > 1000 is asked the other way round");

  // ---- 3. ON: the panel ----------------------------------------------------------------------
  const gb = await ev(gateBtn), pg = await panel();
  ok(gb === "ok" && !pg.on && !pg.ws, `panel · meningitis: the policy card's "Open full stewardship page" opens the page directly, no questions (${gb})`);
  await load(BASE + "?dxask=1&kbv2=1");
  await selectIn(HEP, "VIRAL_HEPATITIS");
  let p = await panel();
  ok(p.on && p.ws && /Is it Acute Viral Hepatitis\?/.test(p.text) && p.nq >= 3, `panel · Select opens "Is it Acute Viral Hepatitis?" with ${p.nq} questions, workspace kept`);
  ok(/Cholangitis/.test(p.text) && !/—/.test(p.text), "panel · names cholangitis as a rival; no em-dash");
  const wide = await ev(`var el=document.querySelector('#dxAsk .dx-mgmt-body'); return el.scrollWidth<=el.clientWidth+1;`);
  ok(wide === true, "panel · no horizontal overflow at 390px");
  await answer("rightUpperQuadrantPain", "yes"); p = await panel();
  ok(p.f.includes("rightUpperQuadrantPain") && p.warn && p.sw && /now ranks above/.test(p.text), `panel · Yes to RUQ pain adds it; a rival overtakes and Switch is offered`);
  await answer("transaminasesVeryHigh", "yes"); p = await panel();
  ok(p.f.includes("transaminasesVeryHigh") && !p.warn && /still leads/.test(p.text), "panel · Yes to ALT/AST > 1000: viral hepatitis leads again");
  await answer("dilatedCBD", "no"); p = await panel();
  ok(p.neg.includes("dilatedCBD") && !p.f.includes("dilatedCBD") && /Recorded as absent: Dilated CBD/.test(p.text), "panel · No records a pertinent negative, not a finding");
  await answer("rightUpperQuadrantPain", "unk"); p = await panel();
  ok(!p.f.includes("rightUpperQuadrantPain"), "panel · changing Yes to Not known takes the finding back out");
  await ev(`document.querySelector('#dxAskBack').click(); return 1`); p = await panel();
  ok(!p.on && p.ws && p.f.includes("transaminasesVeryHigh"), "panel · Back returns to the differential with the answers kept");
  await selectIn(HEP, "VIRAL_HEPATITIS");
  await ev(`var b=document.querySelector('#dxAsk [data-askgo="VIRAL_HEPATITIS"]'); b.click(); return 1`); p = await panel();
  ok(!p.on && !p.ws, "panel · Continue opens the chosen diagnosis page");
  ok((await selectIn(["fever", "cough", "crepitations"], "CAP")) === "ok" && !(await panel()).on, "panel · no close rival (CAP with crackles): straight through, no panel");

  console.log(fails === 0 ? "\nALL GREEN: differentiating questions" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); setTimeout(() => process.exit(fails === 0 ? 0 : 1), 300); }
