/* test/run-opd-clinic-billing-ui.mjs - personal-clinic OPD -> clinic-billing end-to-end, all 4 roles.
 *
 * Real headless Chrome, the REAL opd.html + clinic-billing.html over the REAL /api/queue router
 * (in-memory Firestore via test/helpers/opd-router-harness.mjs). Seeds a NATIVE personal clinic
 * (mode "native", like SMD-6TEQZM) and walks one patient through every desk:
 *   1. doctor: OPD board, rooms, patient tickets, toolbar Billing + Pharmacy, ticket Bill button.
 *      Regression: with smd_opd_workplace "wardsynq:<org>" set (the wardsynq.com visit), a personal
 *      clinic must STILL route Billing / Bill to /clinic-billing, never the inpatient ward cashier.
 *   2. nurse: board, + Walk-in (full check-in sheet submit, token issued), vitals entry.
 *   3. cashier (biller / PIN 1234): opd auto-lands on /clinic-billing; station PIN sign-in works;
 *      unbilled queue reviewed; invoice generated; Cash collected; orders marked paid.
 *   4. pharmacy: pharmacy station lists the paid medication (never investigations); 1-click Dispense.
 *
 *   node --experimental-test-module-mocks test/run-opd-clinic-billing-ui.mjs   (CHROME=<path> to override)
 */
import * as H from "./helpers/opd-router-harness.mjs";
import { launch } from "./wardsynq-site-cdp.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const { onRequest } = await import("../functions/api/queue/[[path]].js");
const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon", ".svg": "image/svg+xml" };

// ---- seed: a native personal clinic (mode "native"), billing switched on ----
H.seed();
H.ENV.CLINIC_BILLING_ENABLED = "1";
const ORG = "org-a", OWNER = H.OWNER_A;
const istDay = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const results = [];
const step = async (name, fn) => {
  try { const r = await fn(); results.push([r === true ? "PASS" : "FAIL", name, r === true ? "" : String(r)]); }
  catch (e) { results.push(["FAIL", name, String((e && e.message) || e)]); }
  const l = results[results.length - 1]; console.log(l[0], name, l[2]);
};

const orgInfo = await H.api("/org?orgId=" + ORG, "GET", null, OWNER);
const CLINIC_CODE = (orgInfo && orgInfo.org && orgInfo.org.code) || "";
await step("seed: native personal clinic with a code", async () =>
  orgInfo && orgInfo.ok && orgInfo.org && orgInfo.org.mode === "native" && CLINIC_CODE ? true : JSON.stringify(orgInfo).slice(0, 200));

const room = await H.api("/room", "POST", { orgId: ORG, name: "Consulting Room", number: "1",
  assignment: { mode: "primary", primary: "doc1", doctors: ["doc1"] } }, OWNER);
await step("seed: consultation room assigned to doc1", async () =>
  room && room.ok && room.room && room.room.id ? true : JSON.stringify(room).slice(0, 200));
const ROOM_ID = room.room.id;

const doc = await H.staffToken(ORG, "doc1", "doctor");
const nurse = await H.staffToken(ORG, "nurse1", "nurse");
const pharm = await H.staffToken(ORG, "pharm1", "pharmacy");
await H.ORG.setMembership(H.ENV, ORG, "biller", { role: "cashier" }, "seed");
const pinSet = await H.ORG.setMemberPin(H.ENV, ORG, "biller", "1234", "seed");
await step("seed: biller holds PIN 1234", async () => (pinSet && pinSet.ok ? true : JSON.stringify(pinSet)));
const billerLogin = await H.api("/auth/pin", "POST", { orgId: ORG, identity: "biller", pin: "1234" });
const BILLER_TOK = billerLogin && billerLogin.token;
await step("seed: biller PIN signs in", async () => (BILLER_TOK ? true : JSON.stringify(billerLogin).slice(0, 200)));

const D = (tok) => ({ staff: tok.staff || tok });
const trfC = await H.api("/bill/tariff", "POST", { orgId: ORG, name: "Consultation", price: 20000, kind: "service" }, OWNER);
const trfM = await H.api("/bill/tariff", "POST", { orgId: ORG, name: "Amoxicillin 500mg", price: 400, kind: "medication" }, OWNER);
await step("seed: tariff (consultation + medication)", async () =>
  trfC.ok && trfM.ok ? true : JSON.stringify([trfC, trfM]).slice(0, 300));
const pat = await H.api("/bill/patient", "POST", { orgId: ORG, name: "Ravi Kumar", mobile: "9876543210", sex: "M", ageYears: 40 }, D(doc));
await step("seed: billing patient registered", async () => (pat && pat.ok && pat.id ? true : JSON.stringify(pat).slice(0, 200)));
const o1 = await H.api("/bill/order", "POST", { orgId: ORG, patientId: pat.id, tariffId: trfC.id, qty: 1 }, D(doc));
const o2 = await H.api("/bill/order", "POST", { orgId: ORG, patientId: pat.id, tariffId: trfM.id, qty: 15 }, D(doc));
await step("seed: doctor raised investigation + medication orders", async () =>
  o1.ok && o2.ok ? true : JSON.stringify([o1, o2]).slice(0, 300));

const p1 = await H.api("/pool", "POST", { orgId: ORG, name: "Ravi Kumar", mobile: "9876543210", visitType: "new", date: istDay() }, D(nurse));
await step("seed: nurse queued a walk-in with a token", async () =>
  p1 && p1.ok && p1.ticket && p1.ticket.token ? true : JSON.stringify(p1).slice(0, 300));
const asg = await H.api("/assign-room", "POST", { orgId: ORG, ticketId: p1.ticket.id, roomId: ROOM_ID, date: istDay(), reason: "seed" }, D(nurse));
await step("seed: nurse routed the patient to the room", async () =>
  asg && asg.ok ? true : JSON.stringify(asg).slice(0, 300));

// ---- server: real router for /api/queue/*, static files with .html fallback ----
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/queue")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const r = await onRequest({ request: new Request("http://localhost" + req.url,
      { method: req.method, headers, body: req.method === "GET" ? undefined : Buffer.concat(chunks) }), env: H.ENV, waitUntil() {} });
    res.writeHead(r.status, { "Content-Type": "application/json" }); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let p = join(ROOT, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ""));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try { const body = await readFile(p); res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream", "Cache-Control": "no-store" }); res.end(body); }
  catch {
    try { const body = await readFile(p + ".html"); res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  }
});
await new Promise((r) => server.listen(0, r));
const BASE = "http://localhost:" + server.address().port;

// ---- browser ----
const b = await launch({ port: Number(process.env.CDP_PORT || 9487), width: 1200, height: 900 });
const { ev, until, nav, call, type, click } = b;
await call("Network.setBlockedURLs", { urls: ["*gstatic.com*"] });   // no Firebase SDK here; staff sessions only
await call("Page.addScriptToEvaluateOnNewDocument", { source: "window.confirm = function(){ return true; };" });
const setStorage = (o) => ev(`localStorage.clear(); ${Object.entries(o).map(([k, v]) =>
  `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join(" ")} return 1;`);
const asSession = async (tok, url, extra) => {
  await nav(BASE + "/opd.html");
  await setStorage({ smd_opd_staff_tok: tok.staff || tok, smd_opd_toktype: "staff", smd_opd_hospital: ORG, ...(extra || {}) });
  await nav("about:blank"); await nav(url || (BASE + "/opd.html"));
};
const chip = `return (document.querySelector('header .role .chip')||{}).textContent||'';`;

try {
  // ================= 1. DOCTOR =================
  await asSession(doc);
  await step("doctor: sees the OPD board with role chip", async () => {
    await until(chip, 12000);
    const c = await ev(chip);
    return c === "doctor" ? true : "chip: " + c;
  });
  await step("doctor: room wall + patient tickets render", async () =>
    (await ev(`return document.querySelectorAll('.rcard').length + '/' + document.querySelectorAll('.rcard .row, .opd-lane .row').length;`)) === "1/1"
      ? true : await ev(`return document.querySelectorAll('.rcard').length + '/' + document.querySelectorAll('.rcard .row, .opd-lane .row').length;`));
  await step("doctor: toolbar has Billing and Pharmacy", async () =>
    (await ev(`return !!document.getElementById('billing') && !!document.getElementById('pharmacy');`)) === true
      ? true : "toolbar buttons missing");
  await step("doctor: every ticket carries a Bill button with the patient id", async () =>
    (await ev(`var l=[].slice.call(document.querySelectorAll('.acts [data-a="bill"]')).filter(function(x){return (x.getAttribute('data-mrn')||'').length>0;}); return document.querySelectorAll('.acts [data-a="bill"]').length + '/' + l.length;`)) === "1/1"
      ? true : "Bill buttons without patient id");

  // Regression: a wardsynq.com visit leaves smd_opd_workplace behind; a NATIVE clinic must still bill clinical.
  await nav(BASE + "/opd.html");
  await setStorage({ smd_opd_staff_tok: doc.staff, smd_opd_toktype: "staff", smd_opd_hospital: ORG, smd_opd_workplace: "wardsynq:" + ORG });
  await nav("about:blank"); await nav(BASE + "/opd.html");
  await step("regression: workplace set, still the OPD board (no hospital cashier)", async () => {
    await until(chip, 12000);
    return (await ev(`return !!document.getElementById('billing');`)) === true ? true : "no toolbar";
  });
  await step("regression: toolbar Billing routes a personal clinic to /clinic-billing", async () => {
    await click("#billing");
    const href = await until(`return location.href.indexOf('/clinic-billing')>-1 && location.href.indexOf('station')===-1 ? location.href : null;`, 8000);
    return href && href.indexOf("/clinic-billing") > -1 ? true : "landed: " + await ev(`return location.href;`);
  });
  await step("regression: billing station lists the unbilled queue (not ward stays)", async () => {
    const t = await until(`return document.body.textContent.indexOf('Waiting to be billed')>-1 ? 'y' : null;`, 10000);
    return t === "y" ? true : await ev(`return document.body.textContent.slice(0,200);`);
  });

  // Ticket Bill button -> checkout with the patient's id prefilled.
  await asSession(doc);
  await until(chip, 12000);
  await step("doctor: ticket Bill opens clinic-billing with patientId prefilled", async () => {
    await ev(`document.querySelector('.acts [data-a="bill"]').click(); return 1;`);
    const href = await until(`return location.href.indexOf('/clinic-billing?patientId=')>-1 ? location.href : null;`, 8000);
    if (!href) return "landed: " + await ev(`return location.href;`);
    const pid = decodeURIComponent(href.split("patientId=")[1] || "");
    return pid ? true : "empty patientId in " + href;
  });

  // ================= 2. NURSE =================
  await asSession(nurse);
  await until(chip, 12000);
  await step("nurse: board, + Walk-in and vitals action", async () => {
    const w = await ev(`return !!document.getElementById('walk');`);
    const v = await ev(`return document.querySelectorAll('.acts [data-a="vitals"]').length;`);
    const rows = await ev(`return document.querySelectorAll('.rcard .row, .opd-lane .row').length;`);
    return w && v >= 1 && rows >= 1 ? true : `walk=${w} vitals=${v} rows=${rows}`;
  });
  await step("nurse: + Walk-in opens the check-in sheet and registers with a token", async () => {
    await click("#walk");
    const sheet = await until(`return !!document.getElementById('prTitle') || null;`, 8000);
    if (!sheet) return "check-in sheet never opened";
    await type("pr_name", "Meena Walkin");
    await ev(`document.querySelector('[data-seg="gender"] .pr-segb[data-v="female"]').click(); return 1;`);
    await type("pr_ageYears", "29");
    await type("pr_mobile", "9876543211");
    await click("#prSave");
    const toast = await until(`return /token/i.test(document.getElementById('toast').textContent||'') ? document.getElementById('toast').textContent : null;`, 12000);
    if (!toast) return "no token toast: " + await ev(`return (document.getElementById('prFerr')||{}).textContent||document.body.textContent.slice(0,200);`);
    const seen = await until(`return document.body.textContent.indexOf('Meena Walkin')>-1 ? 'y' : null;`, 10000);
    return seen === "y" ? true : "walk-in not on the board after " + toast;
  });
  const board0 = await H.api("/opd-board?orgId=" + ORG + "&date=" + istDay(), "GET", null, D(nurse));
  const room0 = board0 && board0.rooms && board0.rooms.filter((r) => (r.tickets || []).length)[0];
  const vtT = room0 && room0.tickets[0];
  await step("nurse: vitals entry saves onto the encounter timeline", async () => {
    if (!vtT) return "no room ticket to record vitals on: " + JSON.stringify(board0).slice(0, 200);
    await ev(`document.querySelector('.acts [data-a="vitals"]').click(); return 1;`);
    const form = await until(`return !!document.getElementById('vpr') || null;`, 8000);
    if (!form) return "vitals sheet never opened";
    await type("vpr", "78");
    await ev(`var ok=document.querySelector('#sheet #ok'); ok.click(); return 1;`);
    await until(`return !document.getElementById('scrim').classList.contains('on') ? 'y' : null;`, 8000);
    const tl = await H.api(`/timeline?sessionId=${encodeURIComponent(room0.sessionId)}&ticketId=${encodeURIComponent(vtT.id)}`, "GET", null, D(nurse));
    const hit = tl && tl.ok && (tl.timeline.entries || []).some((e) => e.kind === "vitals" && String(e.text || "").indexOf("78") > -1);
    return hit ? true : "no vitals entry on the timeline: " + JSON.stringify(tl).slice(0, 300);
  });

  // ================= doctor contd: call -> checkout =================
  await asSession(doc);
  await until(chip, 12000);
  await step("doctor: Start calls the patient into consultation", async () => {
    await ev(`document.querySelector('.acts [data-a="start"]').click(); return 1;`);
    const s = await until(`return document.body.textContent.indexOf('in consultation')>-1 ? 'y' : null;`, 8000);
    return s === "y" ? true : "no in-consultation ticket";
  });
  await step("doctor: Checkout completes the visit and releases the patient", async () => {
    const before = await ev(`return document.querySelectorAll('.rcard .row, .opd-lane .row').length;`);
    await ev(`document.querySelector('.acts [data-a="checkout"]').click(); return 1;`);
    const after = await until(`return (function(n){ var m=document.querySelectorAll('.rcard .row, .opd-lane .row').length; return m<n ? String(m) : null; })(${before});`, 10000);
    return after !== null ? true : `queue did not advance (still ${before})`;
  });

  // ================= 3. CASHIER =================
  await nav(BASE + "/opd.html");
  await setStorage({ smd_opd_staff_tok: BILLER_TOK, smd_opd_toktype: "staff", smd_opd_hospital: ORG });
  await nav("about:blank"); await nav(BASE + "/opd.html");
  await step("cashier: lands on the common OPD dashboard with cashier chip and logout button", async () => {
    const chip = await until(`return (function(){ var c=document.querySelector('.role .chip'); return c && c.textContent.trim()==='cashier' ? 'y' : null; })();`, 12000);
    if (chip !== 'y') return "role chip not cashier: " + await ev(`return document.body.textContent.slice(0,200);`);
    const lo = await ev(`return !!document.getElementById('lo');`);
    if (!lo) return "no logout button on OPD dashboard";
    const billBtn = await ev(`return !!document.getElementById('billing');`);
    if (!billBtn) return "no billing button in toolbar";
    return true;
  });
  await step("cashier: toolbar Billing navigates from common dashboard to /clinic-billing", async () => {
    await click("#billing");
    const href = await until(`return location.href.indexOf('/clinic-billing')>-1 ? location.href : null;`, 10000);
    if (!href) return "failed to open billing: " + await ev(`return location.href;`);
    const hasLogout = await until(`return !!document.getElementById('loBtn') || null;`, 8000);
    if (!hasLogout) return "no logout button on clinic-billing header";
    return true;
  });
  await step("cashier: sign out from clinic-billing header clears session and returns to /opd", async () => {
    await click("#loBtn");
    const backToOpd = await until(`return location.pathname.indexOf('/opd')>-1 ? 'y' : null;`, 10000);
    if (backToOpd !== 'y') return "did not navigate back to /opd: " + await ev(`return location.href;`);
    const tokCleared = await ev(`return localStorage.getItem('smd_opd_staff_tok') || '';`);
    if (tokCleared) return "token not cleared from localStorage: " + tokCleared;
    return true;
  });
  // Re-enter billing station to test PIN sign-in and invoice collection
  await nav(BASE + "/clinic-billing");
  await setStorage({});
  await nav("about:blank"); await nav(BASE + "/clinic-billing");
  await step("cashier: station PIN sign-in (biller / 1234) unlocks billing", async () => {
    const form = await until(`return !!document.getElementById('bGo') || null;`, 10000);
    if (!form) return "station sign-in form missing";
    await type("bCode", CLINIC_CODE); await type("bId", "biller"); await type("bPin", "1234");
    await click("#bGo");
    // Rows, not the heading: the heading renders before the queue fetch resolves.
    const row = await until(`return document.querySelectorAll('[data-bill]').length>0 ? 'y' : null;`, 15000);
    return row === "y" ? true : "unlock failed: " + await ev(`return (document.getElementById('bErr')||{}).textContent||document.body.textContent.slice(0,200);`);
  });
  await step("cashier: unbilled queue shows the patient with both orders", async () => {
    const t = await until(`return document.body.textContent.indexOf(${JSON.stringify(pat.id)})>-1 ? document.body.textContent : null;`, 10000);
    if (!t) return "patient missing from queue: " + await ev(`return document.body.textContent.slice(0,300);`);
    return t.indexOf("2 items") > -1 ? true : "item count wrong: " + t.slice(0, 300);
  });
  await step("cashier: review totals both orders, back-to-OPD link present", async () => {
    await click("[data-bill]");
    const tot = await until(`return document.body.textContent.indexOf('260.00')>-1 ? 'y' : null;`, 8000);
    if (tot !== "y") return "total wrong: " + await ev(`return document.body.textContent.slice(0,300);`);
    return (await ev(`return !!document.querySelector('a[href="/opd"]');`)) === true ? true : "no back-to-OPD link";
  });
  await step("cashier: invoice + Cash marks the orders paid", async () => {
    const invClicked = await click("#inv");
    if (invClicked !== 1) return "no invoice button: " + invClicked;
    const pays = await until(`return document.querySelectorAll('.pays button').length===3 ? 'y' : null;`, 15000);
    if (pays !== "y") return "Cash/UPI/Card missing: " + await ev(`return (document.getElementById('err')||{}).textContent||document.body.textContent.slice(0,250);`);
    await ev(`document.querySelector('.pays button[data-m="cash"]').click(); return 1;`);
    const done = await until(`return document.body.textContent.indexOf('Payment recorded')>-1 ? 'y' : null;`, 10000);
    return done === "y" ? true : "payment not recorded: " + await ev(`return (document.getElementById('err')||{}).textContent||'';`);
  });

  // ================= 4. PHARMACY =================
  await nav(BASE + "/opd.html");
  await setStorage({ smd_opd_staff_tok: pharm.staff, smd_opd_toktype: "staff", smd_opd_hospital: ORG });
  await nav("about:blank"); await nav(BASE + "/opd.html");
  await step("pharmacy: lands on common dashboard and navigates via Pharmacy button", async () => {
    const chip = await until(`return (function(){ var c=document.querySelector('.role .chip'); return c && c.textContent.trim()==='pharmacy' ? 'y' : null; })();`, 12000);
    if (chip !== 'y') return "role chip not pharmacy: " + await ev(`return document.body.textContent.slice(0,200);`);
    const lo = await ev(`return !!document.getElementById('lo');`);
    if (!lo) return "no logout button on OPD dashboard for pharmacy";
    await click("#pharmacy");
    const href = await until(`return location.href.indexOf('station=pharmacy')>-1 ? location.href : null;`, 10000);
    return href ? true : "did not navigate to pharmacy station: " + await ev(`return location.href;`);
  });
  await step("pharmacy: dispense station lists the paid medication only", async () => {
    const list = await until(`return document.querySelectorAll('[data-disp]').length>0 ? 'y' : null;`, 10000);
    if (list !== "y") return "dispense list empty: " + await ev(`return document.body.textContent.slice(0,200);`);
    const t = await ev(`return document.body.textContent;`);
    const tag = await ev(`return (document.getElementById('stnTag')||{}).textContent||'';`);
    return t.indexOf("Amoxicillin") > -1 && t.indexOf("Consultation") === -1 && tag === "Dispense"
      ? true : `med-only violated (tag=${tag}): ` + t.slice(0, 200);
  });
  await step("pharmacy: 1-click Dispense clears the medication", async () => {
    await click("[data-disp]");
    const done = await until(`return document.body.textContent.indexOf('Nothing to dispense')>-1 ? 'y' : null;`, 8000);
    return done === "y" ? true : "dispense did not clear: " + await ev(`return document.body.textContent.slice(0,200);`);
  });

  const excs = b.consoleLines.filter((l) => /^EXC/.test(l));
  await step("no uncaught page exceptions", async () => (excs.length ? excs.join(" | ").slice(0, 500) : true));
} finally { try { b.close(); } catch {} server.close(); }
const failed = results.filter((r) => r[0] !== "PASS");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
