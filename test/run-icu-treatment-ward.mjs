/* ICU Treatment tab + Ward mode test.
 *
 * Treatment (both ICU + Ward): a new Care-Plan sub-tab "Treatment" — an editable Current-Treatment
 * list. Any doctor adds (drug DB or free text) / removes; it lives in ICU_STATE.treatment so it
 * persists + mirrors. This drives the real composer (txadd → type → txsave) and delete (txdel).
 *
 * Ward mode: ICU.openWard() opens the SAME dashboard tuned for ward patients — board titled
 * "My Ward patients", ventilator sub-tab hidden, Treatment sub-tab kept, and a SEPARATE solo
 * patient namespace (a ward patient never shows on the ICU board and vice-versa).
 *
 * Runs SOLO (smd_icu_groups=0) — no Firestore.
 * USAGE: BASE=http://localhost:8916/ node test/run-icu-treatment-ward.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8916/").replace(/\/?$/, "/");
// A FRESH profile per run. A fixed dir kept localStorage between runs, so the ward patient this test
// creates (WARDPT) was still in the ward buffer on the next run and the "ward buffer is empty" check
// passed exactly once, then failed forever - looking like an ICU→ward data leak that was never there.
const PORT = 9377, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-txward-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8916"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const clickAct = async (act) => { await ev(`var b=document.querySelector('[data-icu-act="${act}"]'); if(b) b.click(); return 1;`); await sleep(350); };
const clickWs = async (id) => clickAct(`ws:${id}`);
const subOf = async () => JSON.parse(await ev(`return JSON.stringify(Array.prototype.map.call(document.querySelectorAll('.icu-subnav .icu-seg'), function(x){return x.textContent;}));`));
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.open && ICU.openWard && ICU.ingestPatient)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await ev(`try{localStorage.setItem("smd_icu_groups","0");localStorage.removeItem("smd_icu_v2");}catch(e){} return 1;`);

  // ============================ ICU MODE — Treatment tab ============================
  await ev(`ICU.reset(); ICU.ingestPatient({name:"TXPT",age:60,sex:"M",bed:"4",diagnosis:"Sepsis"}); ICU.open('treatment'); return 1;`);
  await sleep(500);
  ok(await ev(`return /current treatment/i.test(document.body.innerText);`) === true, "Treatment tab renders the 'Current treatment' header");
  ok(await ev(`return !!document.querySelector('[data-icu-act="txadd"]');`) === true, "Treatment tab shows the '+ Add treatment' button");
  ok(await ev(`return ICU.state().treatment.length;`) === 0, "treatment list starts empty");

  // Care Plan sub-nav includes Treatment (first, after Diagnosis)
  await clickWs("careplan");
  const cpSub = await subOf();
  ok(cpSub.indexOf("Treatment") >= 0, "Care Plan sub-nav includes Treatment (" + cpSub.join(",") + ")");

  // Add a treatment via the real composer: open the Treatment sub-tab → type name+dose → pick category → save
  await clickAct("tab:treatment");
  await clickAct("txadd");
  ok(await ev(`return !!document.getElementById('txq');`) === true, "Add-treatment composer opens with a drug search field");
  await ev(`document.getElementById('txq').value='Meropenem'; document.getElementById('txdose').value='1 g'; document.getElementById('txroute').value='IV'; return 1;`);
  await clickAct("txcat:abx");   // set category (re-renders; syncs the typed inputs into the draft)
  await clickAct("txsave");
  ok(await ev(`return ICU.state().treatment.length;`) === 1, "saving adds one item to ICU_STATE.treatment");
  const item0 = JSON.parse(await ev(`var x=ICU.state().treatment[0]||{}; return JSON.stringify({name:x.name,dose:x.dose,route:x.route,cat:x.cat,hasId:!!x.id,hasBy:!!x.by});`));
  ok(item0.name === "Meropenem" && item0.dose === "1 g" && item0.route === "IV" && item0.cat === "abx", "saved item = Meropenem 1 g IV / Antibiotic (" + JSON.stringify(item0) + ")");
  ok(item0.hasId && item0.hasBy, "saved item carries an id + author (by)");
  await ev(`ICU.open('treatment'); return 1;`); await sleep(300);
  ok(await ev(`return /Meropenem/.test(document.body.innerText);`) === true, "the added drug renders in the Treatment tab");

  /* CASESHEET ORDER: the add control on top, the running drugs listed BELOW it. Reported as "added
   * treatment is only added in timeline but not in treatment section below the add treatment button" -
   * the drug was rendered, but ABOVE the button, so looking under the button showed no drugs. */
  const order = JSON.parse(await ev(`
    var btn=document.querySelector('[data-icu-act="txadd"]');
    var all=[].slice.call(document.querySelectorAll('#icuRoot *')).filter(function(e){return /^Meropenem$/.test((e.textContent||"").trim());});
    var drug=all[all.length-1];
    if(!btn||!drug) return JSON.stringify({found:false});
    return JSON.stringify({found:true, below: (btn.compareDocumentPosition(drug) & Node.DOCUMENT_POSITION_FOLLOWING) > 0});`));
  ok(order.found && order.below === true, "the running drug is listed BELOW the '+ Add treatment' button (casesheet order)");
  ok(await ev(`return /running since/i.test(document.body.innerText);`) === true,
    "each running drug shows how long it has been running");

  /* THE REAL DRUG DATABASE. The composer used to search only MEDDRUGS._list - the 72-drug on-device
   * ward formulary - which is why most drugs "were not in the database". It now also queries the
   * server-backed Drug Index (MEDAPI.searchCompositions), the same source the Drugs Database browser
   * uses. MEDAPI is stubbed so this asserts the WIRING, with no network in the test. */
  await ev(`window.__txQ=[]; window.MEDAPI = window.MEDAPI || {};
    window.MEDAPI.searchCompositions = function(q,l){ window.__txQ.push(q);
      return Promise.resolve({results:[{composition:"Zoledronic Acid", "class":"Bisphosphonate", brands:14}]}); };
    return 1;`);
  await clickAct("txadd");
  await ev(`var q=document.getElementById('txq'); q.value='Zoledronic'; q.oninput({target:q}); return 1;`);
  await sleep(900);                                   // 220ms debounce + the stubbed promise
  ok(JSON.parse(await ev(`return JSON.stringify(window.__txQ||[]);`)).length > 0,
    "the composer queries the server-backed Drug Index, not just the on-device formulary");
  ok(await ev(`return /Zoledronic Acid/.test((document.getElementById('txsug')||{}).innerText||"");`) === true,
    "a drug that exists ONLY in the Drug Index is offered as a suggestion");
  ok(await ev(`return /Drug Index/.test((document.getElementById('txsug')||{}).innerText||"");`) === true,
    "Drug-Index hits are labelled so the doctor knows the source");
  await clickAct("closeform"); await sleep(200);

  // Overview 'Current treatment' now reflects the list + links to the Treatment tab
  await clickAct("tab:overview"); await sleep(200);
  ok(await ev(`return /Meropenem/.test(document.body.innerText);`) === true, "Overview 'Current treatment' card reflects the treatment list");
  ok(await ev(`return !!document.querySelector('[data-icu-act="tab:treatment"]');`) === true, "Overview links to the Treatment tab");

  // Delete removes it
  await ev(`ICU.open('treatment'); return 1;`); await sleep(300);
  const delId = await ev(`return ICU.state().treatment[0].id;`);
  await clickAct("txdel:" + encodeURIComponent(delId));
  ok(await ev(`return ICU.state().treatment.length;`) === 0, "delete (txdel) removes the treatment item");

  // ============================ WARD MODE ============================
  await ev(`ICU.close(); return 1;`); await sleep(150);
  await ev(`ICU.openWard(); return 1;`); await sleep(500);
  ok(await ev(`return ICU.isWard()===true;`) === true, "ICU.openWard() puts the dashboard in ward mode (isWard)");
  ok(await ev(`return /My Ward patients/.test((document.querySelector('.icu-v2-utitle')||{}).textContent||"");`) === true, "ward board is titled 'My Ward patients'");
  // Report WHICH half leaked: "ward still holds the ICU patient's name" and "ward still holds the ICU
  // treatment list" are different bugs, and a bare true/false sent me looking at the wrong one.
  const wardBuf = JSON.parse(await ev(`var s=ICU.state(); return JSON.stringify({name:(s.patient||{}).name||"", tx:(s.treatment||[]).length});`));
  ok(wardBuf.tx === 0 && !wardBuf.name,
    "ward buffer is a separate namespace (empty — did not carry the ICU patient) " + JSON.stringify(wardBuf));

  // Admit/enter a ward patient, then check the tab set
  await ev(`ICU.ingestPatient({name:"WARDPT",age:50,sex:"F",bed:"12",diagnosis:"CAP"}); ICU.openWard('overview'); return 1;`);
  await sleep(400);
  await clickWs("careplan");
  const wardCp = await subOf();
  ok(wardCp.indexOf("Treatment") >= 0, "ward Care Plan keeps the Treatment sub-tab (" + wardCp.join(",") + ")");
  await clickWs("monitoring");
  const wardMon = await subOf();
  ok(wardMon.indexOf("Vent") < 0, "ward Monitoring HIDES the ventilator sub-tab (" + wardMon.join(",") + ")");
  ok(wardMon.indexOf("Vitals") >= 0, "ward Monitoring keeps Vitals/labs (" + wardMon.length + " tabs)");

  // Namespace isolation: switching back to ICU shows the ICU patient, not the ward one
  await ev(`ICU.open(); return 1;`); await sleep(400);
  ok(await ev(`return ICU.isWard()===false;`) === true, "ICU.open() returns to ICU mode");
  ok(await ev(`return /My ICU patients/.test((document.querySelector('.icu-v2-utitle')||{}).textContent||"");`) === true, "back on the ICU board ('My ICU patients')");
  /* Scoped to #icuRoot, NOT document.body. The body also contains the HOME screen underneath, whose
   * recent-navigation "resume" card (#rnavResume, home.js) legitimately names the last patient viewed
   * in ANY unit - so a body-wide regex reported "WARDPT is on the ICU board" when the board itself was
   * correct. Verified: the ICU buffer holds TXPT and the ward buffer holds WARDPT, each under its own
   * unit-suffixed key. (The resume card being cross-unit is a separate question, not a board bug.) */
  const board = JSON.parse(await ev(`var t=(document.getElementById("icuRoot")||{}).innerText||""; return JSON.stringify({tx:/TXPT/.test(t), ward:/WARDPT/.test(t)});`));
  ok(board.tx && !board.ward, "ICU board shows the ICU patient (TXPT) and NOT the ward patient (WARDPT) " + JSON.stringify(board));

  console.log(fails === 0 ? "\nALL GREEN — ICU Treatment tab + Ward mode test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
