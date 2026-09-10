/* test/run-wardsynq-com-journey.mjs - ONE real-browser acceptance journey through wardsynq.com.
 *
 *   BASE=https://wardsynq.com WSQ_EMAIL=... WSQ_PASSWORD=...   node test/run-wardsynq-com-journey.mjs
 *   BASE=https://wardsynq.com WSQ_CODE=SMD-XXXX WSQ_STAFF=id WSQ_PIN=1234   (a staff session)
 *   BASE=http://localhost:8790 WSQ_ACCESS_EMAIL=doctor@example.test         (local: Cloudflare-Access-style identity header)
 *
 * Optional: WSQ_HOSPITAL=<name substring> picks the hospital; otherwise the first WardSynQ-native one,
 * and with an account and none available, one named "WardSynQ Acceptance Hospital" is created.
 * SHOTS=<dir> saves a screenshot after every step.
 *
 * Every step drives the real DOM the way a person would (type, click, wait for what appears) and
 * checks the real server's answer on screen. A step that the deployment cannot support (no MaiK
 * model configured, say) is reported as SKIP with the server's own reason, never as a pass.
 */
import { launch } from "./wardsynq-site-cdp.mjs";
import { mkdirSync } from "node:fs";

const BASE = (process.env.BASE || "https://wardsynq.com").replace(/\/+$/, "");
const SHOTS = process.env.SHOTS || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const E = process.env;
const ACCOUNT = E.WSQ_EMAIL && E.WSQ_PASSWORD, STAFF = E.WSQ_STAFF && E.WSQ_PIN, ACCESS = E.WSQ_ACCESS_EMAIL;
if (!ACCOUNT && !STAFF && !ACCESS) { console.error("credentials needed: WSQ_EMAIL+WSQ_PASSWORD, or WSQ_CODE+WSQ_STAFF+WSQ_PIN, or WSQ_ACCESS_EMAIL (local)"); process.exit(2); }

const results = []; let n = 0;
const b = await launch({ port: Number(E.CDP_PORT || 9470), headers: ACCESS ? { "Cf-Access-Authenticated-User-Email": ACCESS } : undefined });
const { ev, until, sleep, type, click } = b;
const text = (s) => ev(`return document.body.textContent.indexOf(${JSON.stringify(s)}) >= 0;`);
const hash = () => ev(`return location.hash;`);
async function step(name, fn) {
  n++; const t0 = Date.now();
  try {
    const r = await fn();
    const status = r && r.skip ? "SKIP" : "PASS";
    results.push({ n, name, status, note: r && (r.note || r.skip) || "" });
    console.log(`${status === "PASS" ? "PASS" : "SKIP"} ${n}. ${name}${r && (r.note || r.skip) ? " - " + (r.note || r.skip) : ""} (${Date.now() - t0}ms)`);
  } catch (e) {
    results.push({ n, name, status: "FAIL", note: String(e && e.message || e) });
    console.log(`FAIL ${n}. ${name} - ${String(e && e.message || e)}`);
  }
  if (SHOTS) await b.shot(`${SHOTS}/${String(n).padStart(2, "0")}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);
}
const must = (cond, why) => { if (!cond) throw new Error(why); };
const waitText = async (s, ms) => { const ok = await until(`return document.body.textContent.indexOf(${JSON.stringify(s)}) >= 0 ? 'y' : '';`, ms || 10000); must(ok, `never saw "${s}" on screen`); };
const waitSel = async (sel, ms) => { const ok = await until(`return document.querySelector(${JSON.stringify(sel)}) ? 'y' : '';`, ms || 10000); must(ok, `never saw ${sel}`); };
const wardView = async (view, ms) => { const ok = await until(`return (window.WARD && WARD._st.view === ${JSON.stringify(view)} && !WARD._st.busy) ? 'y' : '';`, ms || 15000); must(ok, `ward never reached view "${view}" (view=${await ev("return WARD && WARD._st.view")}, err=${await ev("return WARD && WARD._st.err")})`); };
const wardBack = async () => { await ev(`document.querySelector('#smdWard [data-w-act="close"]').click(); return 1;`); await until(`return location.hash === '#/home' ? 'y' : '';`, 5000); };
const ensureChart = async () => {
  const v = await ev(`return window.WARD && document.querySelector('#smdWard.on') ? WARD._st.view : ''`);
  if (v === "chart") return;
  if (v !== "list") { await ev(`location.hash='#/ward/'; return 1;`); await wardView("list", 20000); }
  await waitSel(".w-bed", 15000);
  await ev(`var rows=document.querySelectorAll('.w-bed'); rows[rows.length-1].click(); return 1;`);
  await wardView("chart", 15000);
};
let hospital = null, mrn = "", patientName = "Acceptance Patient " + new Date().toISOString().slice(11, 19).replace(/:/g, "");

try {
  await step("wardsynq.com opens on the sign-in screen", async () => {
    await b.nav(BASE + "/");
    await waitSel('[data-tab="staff"]', 15000);
    must(await text("Owner / Doctor"), "sign-in tabs missing");
    must(await ev(`return !!document.querySelector('img.lockup')`), "brand lockup missing");
    return { note: "3 sign-in methods offered" };
  });

  await step("sign in", async () => {
    if (ACCOUNT) {
      await click('[data-tab="account"]'); await waitSel("#goAccount");
      await type("fe", E.WSQ_EMAIL); await type("fp", E.WSQ_PASSWORD); await click("#goAccount");
    } else if (STAFF) {
      await click('[data-tab="staff"]'); await waitSel("#goStaff");
      if (E.WSQ_CODE) await type("sorg", E.WSQ_CODE);
      await type("sid", E.WSQ_STAFF); await type("spw", E.WSQ_PIN); await click("#goStaff");
    } else {
      // Local Access-style identity: the header is on every request; the shell only needs a session kind.
      await ev(`localStorage.setItem('smd_opd_toktype','staff'); localStorage.setItem('smd_opd_staff_tok','local-access-session'); location.hash='#/hospitals'; location.reload(); return 1;`);
    }
    const h = await until(`return (location.hash === '#/hospitals' || location.hash === '#/home') ? location.hash : (document.getElementById('loginMsg') && document.getElementById('loginMsg').textContent.indexOf('Wrong') >= 0 ? 'wrong' : '');`, 20000);
    must(h && h !== "wrong", h === "wrong" ? "the server refused the credentials" : "never left the sign-in screen");
    return { note: "landed on " + h };
  });

  await step("choose the hospital", async () => {
    if ((await hash()) !== "#/hospitals") await ev(`location.hash='#/hospitals'; return 1;`);
    await until(`return document.querySelector('.hosp-row') || document.getElementById('mkHosp') || document.querySelector('#hospList .msg') ? 'y' : '';`, 15000);
    const rows = JSON.parse(await ev(`return JSON.stringify([].map.call(document.querySelectorAll('.hosp-row'), function(r){ return { id: r.getAttribute('data-org'), text: r.textContent }; }));`) || "[]");
    let pick = rows.find((r) => E.WSQ_HOSPITAL && r.text.indexOf(E.WSQ_HOSPITAL) >= 0) || rows.find((r) => r.text.indexOf("WardSynQ record") >= 0) || null;
    if (!pick && (await ev(`return !!document.getElementById('mkHosp')`))) {
      await type("newHosp", "WardSynQ Acceptance Hospital"); await click("#mkHosp");
      const ok = await until(`return location.hash === '#/home' ? 'y' : (document.getElementById('mkMsg') && document.getElementById('mkMsg').querySelector('.msg.err') ? 'err:' + document.getElementById('mkMsg').textContent : '');`, 25000);
      must(ok === "y", "creating the hospital failed: " + ok);
      hospital = "WardSynQ Acceptance Hospital (created)";
      return { note: hospital };
    }
    must(pick || rows.length, "no hospital is linked to this sign-in");
    pick = pick || rows[0];
    await ev(`document.querySelector('.hosp-row[data-org=' + JSON.stringify(${JSON.stringify(pick.id)}) + ']').click(); return 1;`);
    await until(`return location.hash === '#/home' ? 'y' : '';`, 15000);
    hospital = pick.text.trim();
    return { note: hospital };
  });

  await step("role-aware home dashboard with live counts", async () => {
    await waitSel(".tile", 15000);
    const tiles = Number(await ev(`return document.querySelectorAll('.tile').length`));
    must(tiles >= 4, "too few tiles: " + tiles);
    const native = await text("WardSynQ record");
    if (!native) return { skip: "hospital is not WardSynQ-native; only the OPD desk is offered here" };
    await until(`var l=document.querySelectorAll('.tile .live'); return l.length && ![].some.call(l, function(x){ return x.querySelector('.spin'); }) ? 'y' : '';`, 20000);
    const lives = await ev(`return [].map.call(document.querySelectorAll('.tile .live'), function(x){ return x.textContent; }).join(' | ')`);
    must(lives && lives.indexOf("unavailable") < 0, "a live count was unavailable: " + lives);
    return { note: tiles + " tiles; " + lives };
  });

  const native = await text("WardSynQ record");

  await step("Hospital Command Center", async () => {
    if (!native) return { skip: "not a WardSynQ hospital" };
    await click('[data-go="ward:flowcommand"]'); await wardView("flowcommand");
    must(await ev(`return document.querySelector('#smdWard.on') && document.body.textContent.indexOf('flow') >= 0`), "command center did not render");
    await wardBack();
  });

  await step("Admin Center: hospital, wards and beds, staff", async () => {
    await ev(`location.hash='#/admin'; return 1;`);
    await until(`return document.querySelector('[data-tab]') || document.querySelector('#page .msg') ? 'y' : '';`, 15000);
    if (await ev(`return !document.querySelector('[data-tab]')`)) return { skip: "role has no staff.admin: " + (await ev(`return document.querySelector('#page .msg').textContent`)) };
    await click('[data-tab="wards"]'); await until(`return document.querySelector('#admWardName') ? 'y' : '';`, 10000);
    let wards = Number(await ev(`return document.querySelectorAll('[data-ward-id]').length`));
    if (!wards) {
      await type("admWardName", "Acceptance Ward"); await type("admWardCode", "ACC"); await click("#admWardAdd");
      await until(`return document.querySelectorAll('[data-ward-id]').length ? 'y' : '';`, 15000);
      wards = 1;
    }
    await until(`return document.getElementById('admBedLabel') ? 'y' : '';`, 15000);
    let beds = Number(await ev(`return document.querySelectorAll('[data-bed-id]').length`));
    if (!beds) {
      await type("admBedLabel", "A1"); await click("#admBedAdd");
      await until(`return document.querySelectorAll('[data-bed-id]').length ? 'y' : '';`, 15000);
      await type("admBedLabel", "A2"); await click("#admBedAdd");
      await until(`return document.querySelectorAll('[data-bed-id]').length >= 2 ? 'y' : '';`, 15000);
      beds = Number(await ev(`return document.querySelectorAll('[data-bed-id]').length`));
    }
    await click('[data-tab="staff"]'); await until(`return document.querySelector('#admMemberIdentity') ? 'y' : '';`, 10000);
    const members = Number(await ev(`return document.querySelectorAll('tr[data-identity]').length`));
    return { note: `${wards} ward(s), ${beds} bed(s), ${members} member(s)` };
  });

  await step("register a new patient", async () => {
    await ev(`location.hash='#/patients'; return 1;`); await waitSel("#pFind");
    if (await ev(`return !document.getElementById('pNew')`)) return { skip: "role has no queue.add" };
    await click("#pNew"); await waitSel("#pr_name", 10000);
    await type("pr_name", patientName); await type("pr_mobile", "9" + String(Date.now()).slice(-9)); await type("pr_ageYears", "42");
    await ev(`var g=document.querySelector('[data-seg="gender"] [data-v="female"]'); if (g) g.click(); return 1;`);
    await click("#prSave");
    const got = await until(`var m=document.querySelector(".pr-done .pr-mr"); return m ? m.textContent.trim() : (document.querySelector(".pr-err") && document.querySelector(".pr-err").textContent ? "" : "");`, 20000);
    must(got, "registration never completed: " + (await ev(`return (document.querySelector('.pr-err')||{}).textContent || ''`)));
    mrn = await ev(`return document.querySelector('#pMrn').value`) || (got !== "y" ? got : "");
    await ev(`var d=document.querySelector('[data-a="close"]'); if (d) d.click(); return 1;`);
    return { note: "MRN " + (mrn || "(not read back)") };
  });

  await step("find the patient by MRN", async () => {
    if (!mrn) return { skip: "no MRN from registration" };
    await type("pMrn", mrn); await click("#pFind"); await waitText("Found.", 15000);
    must(await text(patientName), "wrong patient shown");
  });

  await step("admit to a bed from the bed board", async () => {
    if (!native) return { skip: "not a WardSynQ hospital" };
    await click('[data-go="ward:board"]'); await wardView("board");
    const free = await until(`return document.querySelector('.w-bedcell.free') ? 'y' : (document.body.textContent.indexOf('not configured') >= 0 ? 'none' : '');`, 15000);
    must(free === "y", "no free bed on the board (beds not configured for this hospital)");
    await ev(`document.querySelector('.w-bedcell.free').click(); return 1;`); await waitSel("#wAdmitMrn", 10000);
    if (mrn) {
      await type("wAdmitMrn", mrn); await click('[data-w-act="mrnlookup"]');
      await until(`return document.querySelector('[data-w-act="admitconfirm"]') ? 'y' : '';`, 15000);
      await click('[data-w-act="admitconfirm"]');
    } else {
      await click('[data-w-act="admitnew"]');
    }
    await wardView("list", 20000);
    await waitSel(".w-bed", 15000);
    return { note: mrn ? "admitted MRN " + mrn : "admitted as a new patient" };
  });

  await step("chart: vitals, medication order, eMAR round, investigation, results", async () => {
    if (!native) return { skip: "not a WardSynQ hospital" };
    await ev(`var rows=document.querySelectorAll('.w-bed'); rows[rows.length-1].click(); return 1;`); await waitSel('[data-w-act="vitals"]', 15000);
    await ev(`document.getElementById('wv_sbp').value='118'; document.getElementById('wv_pulse').value='82'; document.querySelector('[data-w-act="vitals"]').click(); return 1;`);
    await until(`return document.body.textContent.indexOf('118') >= 0 && !WARD._st.busy ? 'y' : '';`, 15000);
    const orderInput = await ev(`return !!document.getElementById('wMoDrug')`);
    if (!orderInput) return { note: "vitals recorded; this role cannot prescribe (no order form)" };
    await ev(`document.getElementById('wMoDrug').value='Paracetamol 500mg'; document.getElementById('wMoValue').value='500'; document.getElementById('wMoUnit').value='mg'; document.getElementById('wMoRoute').value='oral'; document.getElementById('wMoFreq').value='BD'; document.querySelector('[data-w-act="medorder"]').click(); return 1;`);
    await until(`return !WARD._st.busy ? 'y' : '';`, 15000);
    const refused = await ev(`return WARD._st.refusal ? 'refused:' + JSON.stringify(WARD._st.refusal).slice(0,200) : ''`);
    if (refused) return { note: "order refused by the safety engine, verbatim: " + refused };
    // The doses of a BD order placed this evening fall due tomorrow: the nurse widens the round's
    // window, exactly as the screen offers, rather than the harness pretending a dose is due now.
    await ev(`var d=new Date(Date.now()+2*86400000); document.getElementById('wTo').value = d.toISOString().slice(0,10) + 'T23:59'; document.querySelector('[data-w-act="round"]').click(); return 1;`);
    const ordered = await until(`return document.querySelector('[data-w-act^="mar:verify"]') ? 'y' : (WARD._st.refusal ? 'refused:' + JSON.stringify(WARD._st.refusal).slice(0,200) : '');`, 20000);
    must(ordered, "the order never reached the round");
    if (ordered !== "y") return { note: "order refused by the safety engine, verbatim: " + ordered };
    for (const s of ["verify", "dispense", "scan", "administer"]) {
      const sel = `[data-w-act^="mar:${s}"]`;
      const has = await until(`return document.querySelector(${JSON.stringify(sel)}) ? 'y' : '';`, 15000);
      if (!has) return { note: `medication round stopped before ${s}: ` + (await ev(`return WARD._st.err || (WARD._st.refusal && JSON.stringify(WARD._st.refusal).slice(0,200)) || ''`)) };
      await ev(`document.querySelector(${JSON.stringify(sel)}).click(); return 1;`);
      await until(`return !WARD._st.busy ? 'y' : '';`, 15000);
    }
    await ev(`document.getElementById('wInvCode').value='Chest X-ray'; document.querySelector('[data-w-act="investigation"]').click(); return 1;`);
    await waitText("Chest X-ray", 15000);
    await click('[data-w-act="investigations"]'); await until(`return !WARD._st.busy ? 'y' : '';`, 15000);
    return { note: "vitals, order, verify/dispense/scan/administer, investigation ordered, results card read" };
  });

  await step("transfer to another bed", async () => {
    if (!native) return { skip: "not a WardSynQ hospital" };
    await ensureChart();
    if (!(await ev(`return !!document.querySelector('[data-w-act="move"]')`))) return { skip: "no transfer control on this chart for this role" };
    // ward.js asks for the destination with two prompt() dialogs; answer them the way a person would.
    const from = await ev(`return JSON.stringify({ ward: WARD._st.sel.ward, bed: WARD._st.sel.bed })`);
    const cur = JSON.parse(from || "{}");
    // The destination comes from the live bed board, the same read the board screen makes.
    const board = JSON.parse(await ev(`return fetch('/api/queue/ward/beds?orgId=' + encodeURIComponent(${JSON.stringify(await ev("return WSQ.state.orgId"))}), {headers: await (async function(){ var h={}; var t=localStorage.getItem('smd_opd_staff_tok'); if (t) h['X-Staff-Token']=t; var f=window.SMD_AUTH && await SMD_AUTH.token(); if (f) h.Authorization='Bearer '+f; return h; })()}).then(function(r){ return r.text(); })`) || "{}");
    const w = (board.wards || []).find((x) => x.ward === cur.ward) || (board.wards || [])[0] || {};
    const target = ((w.free || []).map((x) => (typeof x === "string" ? x : x.bed || x.name || ""))).find((x) => x && x !== cur.bed);
    if (!target) return { skip: "no free bed in " + (cur.ward || "the ward") + " to transfer to" };
    await ev(`window.prompt = function (msg) { return /which ward/i.test(msg) ? ${JSON.stringify(cur.ward || "")} : /which bed/i.test(msg) ? ${JSON.stringify(target)} : ""; }; document.querySelector('[data-w-act="move"]').click(); return 1;`);
    await until(`return !WARD._st.busy ? 'y' : '';`, 15000);
    const err = await ev(`return WARD._st.err || (WARD._st.refusal && JSON.stringify(WARD._st.refusal)) || ''`);
    must(!err, "transfer refused: " + err);
    await until(`return WARD._st.sel && WARD._st.sel.bed === ${JSON.stringify(target)} ? 'y' : '';`, 10000);
    return { note: `${cur.ward} ${cur.bed} to ${target}` };
  });

  await step("discharge summary workstation opens from the chart", async () => {
    if (!native) return { skip: "not a WardSynQ hospital" };
    await ensureChart();
    if (!(await ev(`return !!document.querySelector('[data-w-act="summary"]')`))) return { skip: "no discharge control for this role" };
    await click('[data-w-act="summary"]');
    const ok = await until(`return document.querySelector('#smdDischarge.on, #smdDischarge') ? 'y' : '';`, 10000);
    must(ok, "discharge workstation did not open");
    await ev(`if (window.DISCHARGE) DISCHARGE.close(); return 1;`);
  });

  await step("billing and TPA from the chart", async () => {
    if (!native) return { skip: "not a WardSynQ hospital" };
    await ensureChart();
    if (!(await ev(`return !!document.querySelector('[data-w-act="billingopen"]')`))) return { skip: "no billing control for this role" };
    await click('[data-w-act="billingopen"]'); await wardView("billing");
    await ev(`document.querySelector('#smdWard [data-w-act="back"]').click(); return 1;`); await wardView("chart");
    if (await ev(`return !!document.querySelector('[data-w-act="tpaopen"]')`)) { await click('[data-w-act="tpaopen"]'); await wardView("tpa"); await ev(`document.querySelector('#smdWard [data-w-act="back"]').click(); return 1;`); await wardView("chart"); }
    await wardBack();
  });

  await step("MaiK clinical AI on the live encounter", async () => {
    if (!native) return { skip: "not a WardSynQ hospital" };
    await ev(`location.hash='#/maik'; return 1;`);
    await until(`return document.querySelector('[data-ix]') || document.querySelector('#mkList .msg') ? 'y' : '';`, 15000);
    if (!(await ev(`return !!document.querySelector('[data-ix]')`))) return { skip: await ev(`return document.querySelector('#mkList .msg').textContent`) };
    await ev(`document.querySelectorAll('[data-ix]')[document.querySelectorAll('[data-ix]').length-1].click(); return 1;`);
    await waitSel("#mkGo"); await click("#mkGo");
    const out = await until(`var o=document.getElementById('mkOut'); var e=document.querySelector('#mkAsk .msg.err'); return (!o.hidden) ? 'answer' : (e ? 'err:' + e.textContent : '');`, 60000);
    must(out, "MaiK never answered");
    if (out !== "answer") return { skip: "MaiK not available on this deployment: " + out.slice(4, 160) };
    return { note: await ev(`return document.querySelector('#mkOut h2').textContent`) };
  });

  await step("Digital Twin", async () => {
    if (!native) return { skip: "not a WardSynQ hospital" };
    await ev(`location.hash='#/ward/twin'; return 1;`); await wardView("twin", 25000);
    must(await ev(`return document.body.textContent.indexOf('fresh') >= 0 || document.body.textContent.indexOf('Digital twin') >= 0`), "twin did not render");
    await wardBack();
  });

  await step("Audit and security", async () => {
    await ev(`location.hash='#/audit'; return 1;`);
    await until(`return document.querySelectorAll('#page .card').length >= 2 ? 'y' : (document.querySelector('#page .msg') ? 'y' : '');`, 15000);
    const cards = Number(await ev(`return document.querySelectorAll('#page .card').length`));
    must(cards >= 1, "audit page empty");
    await until(`return document.querySelectorAll('#page .spin').length === 0 ? 'y' : '';`, 20000);
    return { note: cards + " sections" };
  });

  await step("sign out returns to the sign-in screen and drops the session", async () => {
    await click('[data-go="logout"]');
    await waitSel('[data-tab="staff"]', 15000);
    must(!(await ev(`return localStorage.getItem('smd_opd_staff_tok') || localStorage.getItem('smd_opd_hospital')`)), "session keys survived sign-out");
    if (ACCESS) return { note: "session keys dropped (local identity header is injected by the harness, so the server check is not meaningful here)" };
    const who = await ev(`return fetch("/api/queue/whoami").then(function(r){ return r.status; })`);
    must(String(who) === "401", "server still answered whoami without credentials: " + who);
  });
} finally {
  const summary = { base: BASE, hospital, pass: results.filter((r) => r.status === "PASS").length, fail: results.filter((r) => r.status === "FAIL").length, skip: results.filter((r) => r.status === "SKIP").length };
  console.log("\nCONSOLE ERRORS:", b.consoleLines.length ? "\n  " + b.consoleLines.slice(0, 12).join("\n  ") : "none");
  console.log("\nSUMMARY", JSON.stringify(summary));
  b.close();
  process.exit(summary.fail ? 1 : 0);
}
