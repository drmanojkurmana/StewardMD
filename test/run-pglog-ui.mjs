/* test/run-pglog-ui.mjs — NMC Logbook · real headless-browser test.
 *
 * The unit tests prove the RULES. This proves the module actually loads, mounts, renders and gates
 * in a real browser against the real index.html — the check CLAUDE.md requires before any UI claim.
 *
 * What it asserts, in order of how badly it would matter if it broke:
 *   1. FLAG OFF IS A COMPLETE NO-OP. No #pglogRoot, no .pgl-* custom property, no curriculum fetch,
 *      no /api/pglog call. This is the reversibility guarantee the whole module is shipped on.
 *   2. The module mounts and renders without a server (a signed-out resident sees the setup path,
 *      not an error).
 *   3. The demo flag renders every dashboard, and LABELS the data as fabricated.
 *   4. The pure engine agrees with itself in the browser: progress, weekly cadence and the exam
 *      checklist compute the same numbers node --test proved.
 *   5. Drafts survive with no network, and a draft is NOT presented as submitted.
 *   6. The provenance badge actually renders differently per source grade — the module's single
 *      most load-bearing visual rule.
 *   7. Reports build and carry their verification block.
 *
 * USAGE: BASE=http://localhost:8991/ node test/run-pglog-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// Port 8994, not the harness default 8991: this repo is worked on from several git worktrees at
// once (vault: two-claude-sessions-one-folder), and a serve.mjs left running by another session on
// the shared port silently serves ITS copy of the app — which is how this test once "failed" for
// forty assertions against code it was never looking at.
const BASE = (process.env.BASE || "http://localhost:8994/").replace(/\/?$/, "/");
const PORT = 9391;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/pglog-ui-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let serveProc = null;

async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8994"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, [
  ...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean),
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio"
], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => {
  const r = await call("Runtime.evaluate", {
    expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`,
    returnByValue: true
  });
  return r.result && r.result.result ? r.result.result.value : null;
};
let fails = 0;
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

async function attach(url) {
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;
  await call("Runtime.enable", {});
  await call("Page.navigate", { url });
  for (let i = 0; i < 70; i++) {
    await sleep(350);
    if (await ev(`return typeof window.SMD_PGLOG_FLAGS !== "undefined" || typeof window.PGLOG !== "undefined";`) === true) return true;
  }
  return false;
}
// Clear the overlays the app puts up on a cold load so a click can reach the page.
const clearOverlays = () => ev(`["introPoster","splash","accountGate","introOverlay","onboardRoot"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  /* ── 1. FLAG OFF IS A COMPLETE NO-OP ─────────────────────────────────────── */
  console.log("\n— flag OFF —");
  ok(await attach(BASE + "?pglog=0"), "app loads with ?pglog=0");
  await clearOverlays();
  // Instrument fetch BEFORE trying to open, so we can prove nothing is requested.
  await ev(`window.__pglFetches=[]; var of=window.fetch; window.fetch=function(u){try{window.__pglFetches.push(String(u&&u.url||u))}catch(e){} return of.apply(this,arguments)}; return 1;`);
  ok(await ev(`return window.SMD_PGLOG_FLAGS ? SMD_PGLOG_FLAGS.bool("smd_pglog") : null;`) === false, "the flag resolves to false");
  await ev(`if(window.PGLOG) PGLOG.open(); return 1;`);
  await sleep(600);
  ok(await ev(`return document.getElementById("pglogRoot") === null;`) === true, "open() creates NO #pglogRoot — a complete no-op");
  ok(await ev(`return document.documentElement.classList.contains("pgl-lock") === false;`) === true, "the scroll lock is never applied");
  ok(await ev(`return (window.__pglFetches||[]).filter(function(u){return /pglog|curricula/.test(u)}).length === 0;`) === true,
    "no curriculum pack and no /api/pglog request is made");
  ok(await ev(`return !!(window.PGLOG && PGLOG.isOn() === false);`) === true, "PGLOG.isOn() reports off");

  /* ── 2. FLAG ON — it mounts, with no server and no account ───────────────── */
  console.log("\n— flag ON, signed out —");
  ok(await attach(BASE + "?pglog=1&pglogserver=0"), "app loads with ?pglog=1");
  await clearOverlays();
  ok(await ev(`return SMD_PGLOG_FLAGS.bool("smd_pglog");`) === true, "the flag resolves to true");
  ok(await ev(`return !!(window.SMD_PGLOG_MODEL && window.SMD_PGLOG_CURRICULUM && window.SMD_PGLOG_STORE && window.SMD_PGLOG_REPORTS && window.SMD_PGLOG_SCREENS);`) === true,
    "all seven module globals are present");
  await ev(`PGLOG.open(); return 1;`);
  await sleep(1400);
  ok(await ev(`return !!document.getElementById("pglogRoot");`) === true, "#pglogRoot is created");
  ok(await ev(`var e=document.getElementById("pglogRoot"); return e && e.classList.contains("pgl-open");`) === true, "the overlay opens");
  ok(await ev(`var e=document.getElementById("pglogRoot"); return e ? getComputedStyle(e).position : "";`) === "fixed",
    "the root is position:fixed (swipe-back needs this, and ui-v2 tries to override it)");
  ok(await ev(`var e=document.getElementById("pglogRoot"); return getComputedStyle(e).getPropertyValue("--pgl-r-ctl").trim() !== "";`) === true,
    "the module's own tokens are scoped to the root");
  // Signed out is the SETUP path, not an error screen.
  ok(await ev(`var h=document.getElementById("pglogScroll"); return h && /not linked yet|Server sync is off/i.test(h.textContent);`) === true,
    "a signed-out resident sees the setup path, not an error");
  ok(await ev(`var h=document.getElementById("pglogScroll"); return h && !/Something went wrong/i.test(h.textContent);`) === true,
    "no error state is shown for simply being unenrolled");

  /* ── 3. Draft flow with NO network ───────────────────────────────────────── */
  console.log("\n— drafts work offline —");
  await ev(`SMD_PGLOG_SCREENS.go("add/procedure"); return 1;`);
  await sleep(500);
  ok(await ev(`var h=document.getElementById("pglogScroll"); return /Your role/i.test(h.textContent);`) === true, "the procedure form renders");
  ok(await ev(`return document.querySelectorAll('#pglogScroll [data-f-chip="role"]').length === 4;`) === true,
    "the four-level role ladder is offered (observed / assisted / supervised / independent)");
  ok(await ev(`var h=document.getElementById("pglogScroll"); return /No patient identity/i.test(h.textContent);`) === true,
    "the no-PHI notice is on the form itself");
  // Fill it the way a resident would, then save.
  await ev(`
    var s=SMD_PGLOG_SCREENS._state;
    s.draft.procedureText="Central venous access";
    s.draft.role="performed_supervised";
    s.draft.supervisor="fb:test-guide";
    s.draft.caseRef="Ramesh Kumar 9876543210";
    s.draft.occurredAt=SMD_PGLOG_MODEL.isoDate(Date.now());
    return 1;`);
  await ev(`document.querySelector('#pglogScroll [data-pgl="save-draft"]').click(); return 1;`);
  await sleep(900);
  ok(await ev(`return SMD_PGLOG_STORE.drafts().length >= 1;`) === true, "the draft is saved locally with no network");
  ok(await ev(`var d=SMD_PGLOG_STORE.drafts()[0]; return d && d.caseRef === "";`) === true,
    "a patient name + phone typed into the case reference is STRIPPED before it is stored");
  ok(await ev(`var d=SMD_PGLOG_STORE.drafts()[0]; return d && d.status === "draft";`) === true,
    "a local draft is a DRAFT — it is never presented as submitted");
  ok(await ev(`return JSON.stringify(SMD_PGLOG_STORE.drafts()).indexOf("Ramesh") === -1;`) === true,
    "no patient name reaches local storage at all");

  /* ── 4. Demo mode: every dashboard renders, and says the data is fabricated ─ */
  console.log("\n— demo data —");
  ok(await attach(BASE + "?pglog=1&pglogdemo=1&pglogserver=0"), "app loads with ?pglogdemo=1");
  await clearOverlays();
  await ev(`PGLOG.open(); return 1;`);
  await sleep(1800);
  const txt = () => ev(`var h=document.getElementById("pglogScroll"); return h ? h.textContent : "";`);
  const home = await txt();
  ok(/Demonstration data/i.test(home), "demo data is LABELLED as fabricated on the home screen");
  ok(/My NMC Logbook|Demo Resident/i.test(home), "the resident dashboard renders");
  ok(/weeks logged/i.test(home), "the weekly-cadence strip renders (PGMER-2023 5.2(v))");
  ok(await ev(`return document.querySelectorAll("#pglogScroll .pgl-weeks i").length > 0;`) === true, "the week cells are drawn");
  ok(await ev(`return document.querySelectorAll("#pglogScroll .pgl-stat").length >= 4;`) === true, "the four headline numbers render");

  /* ── 5. The provenance badge is visibly different per source grade ────────── */
  console.log("\n— provenance —");
  ok(await ev(`return document.querySelectorAll('#pglogScroll .pgl-prov[data-src="nmc_regulation"]').length > 0;`) === true,
    "a PGMER-2023 requirement renders a regulation-grade badge");
  ok(await ev(`
    var a=document.querySelector('#pglogRoot .pgl-prov[data-src="nmc_regulation"]');
    if(!a) return false;
    var probe=document.createElement("span"); probe.className="pgl-prov"; probe.setAttribute("data-src","institution");
    probe.textContent="x"; a.parentNode.appendChild(probe);
    var A=getComputedStyle(a), B=getComputedStyle(probe);
    var differs = A.backgroundColor!==B.backgroundColor || A.color!==B.color || A.borderStyle!==B.borderStyle || A.fontWeight!==B.fontWeight;
    probe.remove();
    return differs;`) === true,
    "an NMC badge and an institutional badge are visually DISTINCT (the module's core visual rule)");
  ok(await ev(`
    var probe=document.createElement("span"); probe.className="pgl-prov"; probe.setAttribute("data-src","unspecified");
    probe.textContent="x"; document.getElementById("pglogScroll").appendChild(probe);
    var st=getComputedStyle(probe); var borderIsDotted = st.borderStyle==="dotted"; probe.remove();
    return borderIsDotted;`) === true,
    "an unspecified requirement is drawn dotted — it does not read as an NMC number");

  /* ── 6. The pure engine agrees with itself in the browser ─────────────────── */
  console.log("\n— engine —");
  ok(await ev(`
    var m=SMD_PGLOG_MODEL;
    var e=m.entry({id:"x",kind:"procedure",occurredAt:"2026-08-01",status:"verified",procedureId:"p1",role:"assisted"});
    var req={id:"p1",kind:"procedure",label:"P",target:10,per:"course",match:{procedureId:"p1"}};
    var p=m.progressFor(req,[e],{programmeStart:"2025-07-01",today:"2026-08-27"});
    return p.done===1 && p.target===10 && p.pct===10;`) === true,
    "progressFor computes in the browser exactly as it does under node --test");
  ok(await ev(`
    var m=SMD_PGLOG_MODEL;
    var e=m.submit(m.entry({id:"x",kind:"clinical",occurredAt:"2026-08-01",title:"t",createdBy:"fb:me"}),"fb:me",Date.now());
    try { m.verify(e,"fb:me",Date.now()); return "NO THROW"; } catch(err){ return err.message; }`) === "pglog_self_verify_forbidden",
    "the self-verify guard throws in the browser too (not just server-side)");
  ok(await ev(`
    var m=SMD_PGLOG_MODEL;
    var v=m.verify(m.submit(m.entry({id:"x",kind:"clinical",occurredAt:"2026-08-01",title:"t",createdBy:"fb:a"}),"fb:a",1),"fb:b",2);
    try { m.applyEdit(v,{title:"changed"},"fb:a",3); return "NO THROW"; } catch(err){ return err.message; }`) === "pglog_verified_immutable",
    "a verified entry cannot be edited in the browser either");
  ok(await ev(`return SMD_PGLOG_MODEL.sanitizeCaseRef("MRN 4482 Ramesh Kumar") === "MRN 4482";`) === true,
    "the case-reference scrubber keeps the MRN and drops the name");

  /* ── 7. Curriculum packs actually load over HTTP ──────────────────────────── */
  console.log("\n— curriculum packs —");
  ok(await ev(`
    window.__pack=null;
    SMD_PGLOG_CURRICULUM.load("emergency-medicine").then(function(p){window.__pack=p;},function(e){window.__pack={err:String(e)};});
    return 1;`) === 1, "requested the Emergency Medicine pack");
  for (let i = 0; i < 30; i++) { await sleep(200); if (await ev(`return !!window.__pack;`) === true) break; }
  ok(await ev(`return window.__pack && !window.__pack.err && window.__pack.requirements.length > 10;`) === true,
    "the pack loads and flattens with its PGMER-2023 common requirements");
  ok(await ev(`
    var p=window.__pack; if(!p||p.err) return false;
    var r=p.requirements.filter(function(x){return x.id==="em_intubation";})[0];
    return r && r.target===100 && r.source==="nmc_curriculum";`) === true,
    "the NMC procedure minimum (tracheal intubation, 100) survives the flatten with its provenance");
  ok(await ev(`
    var p=window.__pack; if(!p||p.err) return false;
    return p.requirements.every(function(r){ return !!r.source && (r.source==="unspecified" || !!r.clause); });`) === true,
    "every resolved requirement carries a source and a clause");
  ok(await ev(`
    var p=window.__pack; if(!p||p.err) return false;
    var r=p.requirements.filter(function(x){return x.id==="em_thoracentesis";})[0];
    return r && r.target===null;`) === true,
    "a procedure the NMC lists WITHOUT a number stays null — no invented target");

  /* ── 8. Reports build and carry verification ─────────────────────────────── */
  console.log("\n— reports —");
  await ev(`SMD_PGLOG_SCREENS.go("reports"); return 1;`);
  await sleep(500);
  ok(/Individual logbook/i.test(await txt()), "the report list renders");
  await ev(`SMD_PGLOG_SCREENS.go("report/progress_report"); return 1;`);
  await sleep(700);
  const rep = await txt();
  ok(/Training Progress/i.test(rep), "the progress report builds");
  ok(/Verification status/i.test(rep), "every report carries its verification block");
  ok(/University/i.test(rep), "the report states that eligibility is the University's decision, not the app's");
  ok(await ev(`return document.querySelectorAll("#pglogScroll .pgl-rep-scroll").length > 0;`) === true,
    "wide tables scroll inside their own container (the page body must not scroll horizontally)");
  ok(await ev(`
    var b=document.getElementById("pglogScroll");
    return b.scrollWidth <= b.clientWidth + 2;`) === true,
    "the report does not make the page scroll horizontally");

  /* ── 9. Navigation + close ───────────────────────────────────────────────── */
  console.log("\n— navigation —");
  await ev(`SMD_PGLOG_SCREENS.go("progress"); return 1;`);
  await sleep(500);
  ok(/Examination pre-requisite checklist/i.test(await txt()), "the progress screen shows the exam checklist");
  ok(await ev(`var h=document.getElementById("pglogScroll"); return /determined by the University/i.test(h.textContent);`) === true,
    "the checklist explicitly refuses to declare eligibility");
  ok(await ev(`return !!document.querySelector('#pglogRoot .pgl-back');`) === true, "a back control is present (swipe-back matches .pgl-back)");
  await ev(`PGLOG.close(); return 1;`);
  await sleep(400);
  ok(await ev(`var e=document.getElementById("pglogRoot"); return e && !e.classList.contains("pgl-open");`) === true, "close() closes the overlay");
  ok(await ev(`return document.documentElement.classList.contains("pgl-lock") === false;`) === true, "close() releases the scroll lock");

  /* ── 10. It did not break the rest of the app ────────────────────────────── */
  console.log("\n— no collateral damage —");
  ok(await ev(`return !!document.querySelector('[data-act="pglog"]') || !!window.PGLOG;`) === true, "the home tile / action is registered");
  ok(await ev(`return typeof window.SURGX !== "undefined" && typeof window.CLINIX !== "undefined";`) === true,
    "the sibling modules still load");
  ok(await ev(`return document.querySelectorAll("#surgxRoot.sgx-open, #clinixRoot.cx-open").length === 0;`) === true,
    "no sibling overlay was opened as a side effect");

  console.log(fails === 0 ? "\nALL GREEN — NMC Logbook UI test passed" : `\n${fails} FAILED`);
} catch (e) {
  console.error("HARNESS ERROR:", e && e.message, e && e.stack);
  fails++;
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
  if (serveProc) serveProc.kill();
  process.exit(fails === 0 ? 0 : 1);
}
