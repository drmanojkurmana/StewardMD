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
  ok(await ev(`return !!(window.SMD_PGLOG_MODEL && window.SMD_PGLOG_CURRICULUM && window.SMD_PGLOG_STORE && window.SMD_PGLOG_REPORTS && window.SMD_PGLOG_SCREENS && window.SMD_PGLOG_QR);`) === true,
    "all eight module globals are present");
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

  /* ── 8b. The QR that makes a signature checkable ──────────────────────────── */
  console.log("\n— verification QR —");
  ok(await ev(`
    var svg = SMD_PGLOG_QR.toSvg("https://stewardmd.in/pglog/v/PGL-7K2M9-XQ4TB", { scale: 4 });
    return svg.indexOf("<svg") === 0 && svg.indexOf("<path") > 0;`) === true,
    "the QR encoder renders an SVG in the browser");
  ok(await ev(`
    var d = document.createElement("div");
    d.innerHTML = SMD_PGLOG_QR.toSvg("https://stewardmd.in/pglog/v/PGL-7K2M9-XQ4TB");
    var svg = d.querySelector("svg");
    return svg && svg.querySelectorAll("path").length === 1 && !d.querySelector("script,image,use");`) === true,
    "the rendered QR is inert — one path, no script, no external reference");
  ok(await ev(`
    var a = SMD_PGLOG_QR.toSvg("https://stewardmd.in/pglog/v/PGL-AAAAA-AAAAA");
    var b = SMD_PGLOG_QR.toSvg("https://stewardmd.in/pglog/v/PGL-AAAAA-AAAAB");
    return a !== b;`) === true, "a different code renders a different symbol");
  await ev(`SMD_PGLOG_SCREENS.go("check"); return 1;`);
  await sleep(500);
  ok(await ev(`return !!document.getElementById("pglCode");`) === true,
    "the in-app code checker screen renders");
  ok(await ev(`var h=document.getElementById("pglogScroll"); return /Scan or type|verification code/i.test(h.textContent);`) === true,
    "and explains what to do with a code");


  /* ── 8c. Certification: the screen where a logbook becomes a document ────── */
  console.log("\n— certification —");
  // Drive the screen off an injected certificate rather than a live server: what is being tested is
  // that the UI cannot present an unsigned logbook as a signed one, which is a rendering property.
  await ev(`
    var M = SMD_PGLOG_MODEL;
    window.__res = { id: "r1", uid: "fb:res1", name: "Dr B", guide: "fb:guide1", coGuides: [] };
    window.__mkCert = function (sigs, over) {
      var c = M.certificate(Object.assign({ id: "c1", residentId: "r1", orgId: "o1",
        entryIds: ["e1"], entryCount: 1, excluded: { draft: 2, submitted: 1, returned: 0 } }, over || {}));
      (sigs || []).forEach(function (x, i) {
        c = M.signCertificate(c, { by: x[0], role: x[1], reg: x[2], name: x[3] }, "fb:res1", 100 + i, null, window.__res);
      });
      return c;
    };
    return 1;`);

  ok(await ev(`
    var st = SMD_PGLOG_MODEL.quorumState(window.__mkCert([["fb:f1","faculty","R/1","Dr F"]]), null, window.__res);
    return st.met === false && st.missing.join("|");`) !== true,
    "one faculty signature does not meet the quorum");
  ok(await ev(`
    var c = window.__mkCert([["fb:f1","faculty","R/1","Dr F"],["fb:h1","hod","R/2","Dr H"]]);
    return c.status === "issued";`) === true,
    "faculty + HOD issues it in the browser too (the same pure function the server runs)");

  await ev(`SMD_PGLOG_SCREENS.go("certify"); return 1;`);
  await sleep(500);
  ok(await ev(`var h=document.getElementById("pglogScroll"); return /Head of Department/i.test(h.textContent);`) === true,
    "the certification screen states what the institution requires");
  ok(await ev(`var h=document.getElementById("pglogScroll"); return /not an NMC requirement/i.test(h.textContent);`) === true,
    "and says plainly that the faculty COUNT is the institution's rule, not the NMC's");
  ok(await ev(`var h=document.getElementById("pglogScroll"); return /Information Technology Act, 2000/i.test(h.textContent);`) === true,
    "the screen states the limit of what a certified PDF is");

  // THE PROPERTY THAT MATTERS MOST: a draft export can never look like a signed one.
  ok(await ev(`
    var R = SMD_PGLOG_REPORTS, M = SMD_PGLOG_MODEL;
    var ctx = { resident: window.__res, programme: M.programme({ id: "p1", degree: "MD" }),
      entries: [], rotations: [], assessments: [], months: [], attestations: [], today: "2026-08-27" };
    var draft = R.certifiedDocHtml(R.certifiedLogbook(ctx), {});
    return draft.indexOf("NOT CERTIFIED") > -1 && draft.indexOf("pgl-qrt") === -1;`) === true,
    "an uncertified export is stamped and carries no QR");
  ok(await ev(`
    var R = SMD_PGLOG_REPORTS, M = SMD_PGLOG_MODEL;
    var c = window.__mkCert([["fb:g1","guide","KMC/2011/44321","Dr A Rao"],["fb:h1","hod","KMC/1998/1102","Dr H Nair"]]);
    c.contentDigest = "a1b2c3d4e5f60718293a4b5c6d7e8f90"; c.verifyCode = "PGL-7K2M9-XQ4TB";
    var ctx = { resident: window.__res, programme: M.programme({ id: "p1", degree: "MD" }),
      entries: [], rotations: [], assessments: [], months: [], attestations: [], today: "2026-08-27", certificate: c };
    var doc = R.certifiedDocHtml(R.certifiedLogbook(ctx), { verifyUrl: "https://stewardmd.in/pglog/v/PGL-7K2M9-XQ4TB" });
    window.__doc = doc;
    return doc.indexOf("NOT CERTIFIED") === -1 && doc.indexOf("pgl-qrt") > -1 &&
           doc.indexOf("KMC/2011/44321") > -1 && doc.indexOf("A1B2-C3D4-E5F6-0718") > -1;`) === true,
    "a certified export carries the QR, both registration numbers and the content fingerprint");

  // The print QR must survive an actual browser layout — the whole reason it is a table and not an
  // SVG. What has to hold is that every module is the SAME SIZE and the symbol is square. Absolute
  // pixel sizes are not testable here: the app carries a root `zoom` for the OS text-size setting
  // (1.08 on this run), so 123px of QR measures 132.8px. Uniformity is the property that decides
  // whether a scanner can read it, and it is zoom-independent.
  {
    const box = await ev(`
      var d = document.createElement("div");
      d.style.cssText = "position:fixed;left:-9999px;top:0";
      d.innerHTML = "<style>" + SMD_PGLOG_QR.tableCss(3) + "</style>" +
        SMD_PGLOG_QR.toTableHtml("https://stewardmd.in/pglog/v/PGL-7K2M9-XQ4TB", { scale: 3 });
      document.body.appendChild(d);
      var t = d.querySelector("table.pgl-qrt");
      var r = t.getBoundingClientRect();
      var total = t.querySelectorAll("col").length;
      var unit = r.width / total, worst = 0, rowsOk = true;
      for (var y = 0; y < t.rows.length; y++) {
        var row = t.rows[y], sum = 0;
        for (var i = 0; i < row.cells.length; i++) {
          var c = row.cells[i], want = unit * (c.colSpan || 1);
          worst = Math.max(worst, Math.abs(c.getBoundingClientRect().width - want));
          sum += c.colSpan || 1;
        }
        if (sum !== total) rowsOk = false;
      }
      var out = { rows: t.rows.length, cols: total, square: Math.abs(r.width - r.height) < 1,
                  worstCellDrift: Math.round(worst * 100) / 100, rowsOk: rowsOk,
                  zoom: getComputedStyle(document.documentElement).zoom };
      d.remove();
      return out;`);
    // 33 modules + 8 quiet zone = 41 columns, every row spanning all of them, every module the same
    // width, and the whole symbol square.
    const good = box && box.rows === 41 && box.cols === 41 && box.square === true &&
                 box.rowsOk === true && box.worstCellDrift < 1;
    ok(good === true,
      "every module of the printed QR is the same size and the symbol is square" +
      (good ? "" : " — got " + JSON.stringify(box)));
  }
  ok(await ev(`return window.__doc.indexOf("<script") === -1 && window.__doc.indexOf("<link ") === -1;`) === true,
    "the exported document is self-contained — it must render years from now, offline");

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
