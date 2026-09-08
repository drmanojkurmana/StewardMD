/* WardSynQ Surgery/OT/PACU: theatre board -> book a case -> consent -> mark site -> Sign In ->
 * incision LOCKED until Time Out -> Time Out -> incision unlocked -> implant logged -> Sign Out ->
 * disposition to PACU, driven in real headless Chrome over CDP against the REAL ward.js and
 * ward.css (test/ward-surgery-golden-path-harness.html stubs only the network). Proves the CLIENT
 * half of the surgery vertical - real DOM, real ward.css, real delegated click handler - not a mock
 * render. Persistence/server-side correctness for these same contracts is proven separately, for
 * real, in test/wardsynq-surgery.test.mjs.
 *
 *   node test/run-ward-surgery-golden-path.mjs   (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9394, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-surgery-golden-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-surgery-golden-path-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=430,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const lastBody = (frag) => ev(`var c=window.__calls.filter(function(c){return c.method==="POST" && c.url.indexOf(${JSON.stringify(frag)})>=0}); return JSON.stringify(c[c.length-1]&&c[c.length-1].body);`).then((s) => { try { return JSON.parse(s); } catch { return null; } });
const check = (id) => ev(`document.getElementById(${JSON.stringify(id)}).checked = true; return true;`);
const fill = (id, v) => ev(`document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(v)}; return true;`);
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click(); return true;`);
async function waitFor(expr, tries) {
  for (let i = 0; i < (tries || 30); i++) { await sleep(120); if (await ev(expr)) return true; }
  return false;
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: URL });

  ok(await waitFor(`return window.__ready;`), "real ward.js loaded into the surgery harness");

  // ---- 1. Theatre board, empty. -------------------------------------------------------------------
  await ev(`window.WARD.open({ orgId: "org-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('[data-w-act="surgeryboard"]');`), "the Surgery tab is reachable from the ward list");
  await click('[data-w-act="surgeryboard"]');
  ok(await waitFor(`return document.body.textContent.indexOf('No open cases') >= 0;`), "an empty theatre board says so plainly");

  // ---- 2. Book a case: MRN lookup, then the case details. -----------------------------------------
  await click('[data-w-act="surgerybookopen"]');
  await waitFor(`return !!document.getElementById('wSurgMrn');`);
  await fill("wSurgMrn", "SMD-H1-OT01"); await click('[data-w-act="surgmrnlookup"]');
  await waitFor(`return !!document.getElementById('wSurgProcedure');`);
  await fill("wSurgProcedure", "Cholecystectomy"); await fill("wSurgSite", "abdomen"); await fill("wSurgTheatre", "OT-1");
  await click('[data-w-act="surgerybook"]');
  ok(await waitFor(`return !!document.querySelector('.w-bed');`), "booking a case returns to a theatre board that now shows it");
  const bookBody = await lastBody("/ward/surgery-book");
  ok(bookBody && bookBody.booking.mrn === "SMD-H1-OT01" && bookBody.booking.procedure === "Cholecystectomy", "the booking posts exactly what was typed, from a patient looked up first: " + JSON.stringify(bookBody));

  // ---- 3. Open the case: consent, then site marking. -----------------------------------------------
  await click(".w-bed");
  ok(await waitFor(`return !!document.getElementById('wSurgConsentSigned');`), "opening the case shows the consent card first");
  await check("wSurgConsentSigned"); await click('[data-w-act="surgeryconsent"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Recorded: Cholecystectomy') >= 0;`), "consent recorded is shown once matched");
  await waitFor(`return !!document.getElementById('wSurgMarkSite');`);
  await click('[data-w-act="surgerymarksite"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Sign In') >= 0;`), "once marked, the Sign In checklist appears");

  // ---- 4. Sign In. -----------------------------------------------------------------------------
  const signInItems = ["identity-confirmed", "site-confirmed", "procedure-confirmed", "consent-confirmed", "site-marked-confirmed", "anaesthesia-safety-check", "pulse-oximeter-working", "allergies-reviewed", "airway-risk-assessed", "blood-loss-risk-assessed"];
  for (const k of signInItems) await check("wSurgItem-signIn-" + k);
  await fill("wSurgSig-signIn-surgeon", "dr-a"); await fill("wSurgSig-signIn-anaesthetist", "dr-b"); await fill("wSurgSig-signIn-nurse", "nurse-c");
  await click('[data-w-act="surgeryphase:signIn"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Anaesthesia') >= 0;`), "after Sign In, the anaesthesia card appears");
  const signInBody = await lastBody("/ward/surgery-signin");
  ok(signInBody && signInBody.submission.signatures.length === 3, "Sign In posts three real, named signatures: " + JSON.stringify(signInBody.submission.signatures));

  // ---- 5. Anaesthesia. --------------------------------------------------------------------------
  await fill("wSurgAsa", "ASA II"); await click('[data-w-act="anesstart"]');
  await waitFor(`return !!document.getElementById('wSurgAnesDrug');`);
  await fill("wSurgAnesDrug", "Propofol"); await fill("wSurgAnesDose", "150 mg"); await click('[data-w-act="anesevent"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Propofol') >= 0;`), "a drug given is shown on the anaesthesia card");

  // ---- 6. Time Out, then incision unlocked. --------------------------------------------------------
  const timeOutItems = ["team-introduced", "identity-site-procedure-reconfirmed", "critical-events-anticipated", "antibiotic-prophylaxis-addressed", "imaging-displayed"];
  for (const k of timeOutItems) await check("wSurgItem-timeOut-" + k);
  await fill("wSurgSig-timeOut-surgeon", "dr-a"); await fill("wSurgSig-timeOut-anaesthetist", "dr-b"); await fill("wSurgSig-timeOut-nurse", "nurse-c");
  await click('[data-w-act="surgeryphase:timeOut"]');
  ok(await waitFor(`return document.body.textContent.indexOf('unlocked') >= 0;`), "Time Out complete: the screen states incision is now unlocked");
  await click('[data-w-act="surgeryincise"]');
  ok(await waitFor(`return document.body.textContent.indexOf('Implants') >= 0;`), "once incised, the implant card appears");

  // ---- 7. Implant, then Sign Out. -----------------------------------------------------------------
  await fill("wSurgImplantDevice", "Endo-GIA stapler load"); await fill("wSurgImplantLot", "LOT-2291");
  await click('[data-w-act="surgeryimplant"]');
  ok(await waitFor(`return document.body.textContent.indexOf('LOT-2291') >= 0;`), "the logged implant's real lot number is shown");
  const implantBody = await lastBody("/ward/implant");
  ok(implantBody && implantBody.implant.device === "Endo-GIA stapler load" && implantBody.implant.lot === "LOT-2291", "the implant posts exactly what was entered: " + JSON.stringify(implantBody));

  const signOutItems = ["procedure-recorded", "counts-correct", "specimens-labelled", "equipment-problems-addressed", "recovery-concerns-addressed"];
  for (const k of signOutItems) await check("wSurgItem-signOut-" + k);
  await fill("wSurgSig-signOut-surgeon", "dr-a"); await fill("wSurgSig-signOut-anaesthetist", "dr-b"); await fill("wSurgSig-signOut-nurse", "nurse-c");
  await click('[data-w-act="surgeryphase:signOut"]');
  await click('[data-w-act="anesend"]');
  ok(await waitFor(`return document.body.textContent.indexOf('disposition') >= 0 || document.body.textContent.indexOf('Disposition') >= 0;`), "once signed out, the disposition card appears");

  // ---- 8. Disposition to PACU: back to the theatre board, the case is no longer open. -------------
  await click('[data-w-act="surgerydisposition:pacu"]');
  ok(await waitFor(`return document.body.textContent.indexOf('No open cases') >= 0;`), "disposing to PACU closes the theatre stay and returns to the (now empty) board");
  const dispBody = await lastBody("/ward/surgery-disposition");
  ok(dispBody && dispBody.disposition === "pacu", "the disposition posted is the one actually chosen: " + JSON.stringify(dispBody));

} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
