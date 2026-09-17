/* test/run-ward-discharge-billing-ui.mjs - real headless Chrome for the live test fixes of 2026-09-15
 * (docs/wardsynq/LIVE_TEST_2026-09-15.md LT-17, LT-19, LT-30, LT-32, LT-33).
 *
 *   node test/run-ward-discharge-billing-ui.mjs        (CHROME=<path> to override; SHOTS=<dir> for screenshots)
 *
 * The real ward.js, discharge.js and their CSS on test/print-lang-harness.html, against fixtures shaped like the
 * server's answers (the routes themselves are pinned in test/wardsynq-discharge-billing-livefix.test.mjs):
 * - the Discharge and Follow-up forms are in-app, keep what is typed through a repaint, and send it;
 * - a refused discharge shows why and keeps the form;
 * - Raise invoice with nothing priced names the charges and links to the Price list;
 * - the discharge summary shows the hospital's clock, real icons, Sign clear of Report Bug, and leaves with the ward;
 * - a Patient copy prints without the page behind the ward.
 * Prints PASS/FAIL per step; exits 1 on any FAIL.
 */
import { launch } from "./wardsynq-site-cdp.mjs";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
const SHOTS = process.env.SHOTS || (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-discharge-billing-shots";
await mkdir(SHOTS, { recursive: true });

const PRINT = { languagesEnabled: false, timeZone: "Asia/Kolkata", utcOffsetMinutes: 330 };
const CHECKLIST = {
  bill: { state: "unbilled", balance: 0, unbilled: [], unpriced: [{ display: "Bed per day, GAS", code: "BED-DAY" }] },
  openOrders: [{ kind: "medication", id: "rx1", drug: "Paracetamol 1 g", status: "active" }],
  pendingResults: [{ kind: "investigation", id: "sr1", display: "Chest X-ray PA view", status: "no result yet" }], unreadable: [],
};
const SUMMARY = {
  ok: true, patientId: "p1", canAuthor: true, pending: [], print: PRINT,
  patient: { name: "Test Patient QA-01", mrn: "SMD-6TEQZM-00027", sex: "female" },
  encounter: { status: "in-progress", ward: "GAS", bed: "3", admittedAt: "2026-09-15T15:23:31.058Z", dischargedAt: null },
  assembled: { admission: "Ward: GAS, bed 3.\nAdmitted: 2026-09-15T15:23:31.058Z.", diagnoses: "Not recorded.", allergies: "None documented on this admission.", vitals: "Not recorded.",
    investigations: "Complete blood count (result, reported 2026-09-15T16:00:00.000Z): Haemoglobin 5.2 g/dL (critical)", medications: "Not recorded.", assessment: "Not recorded.", plan: "Not recorded." },
  stored: null,
};
const posts = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/queue")) {
    let body = ""; for await (const c of req) body += c;
    const json = body ? JSON.parse(body) : null;
    const p = url.pathname.replace("/api/queue", "");
    if (req.method === "POST") posts.push({ path: p, body: json });
    let out = { ok: true };
    if (p === "/ward/discharge-checklist") out = { ok: true, checklist: CHECKLIST, canOverride: true, deceasedRecorded: false, dispositions: ["home", "transferred", "left-against-advice", "died", "other", "ward"] };
    else if (p === "/ward/discharge") out = json && json.billDeferredReason ? { ok: true, written: 1, status: "finished" } : { ok: false, status: 409, error: "discharge_blocked", blockers: ["bill_not_settled"], checklist: CHECKLIST, detail: "This stay has a bill, orders or results that are not settled." };
    else if (p === "/ward/follow-up") out = { ok: true, written: 1 };
    else if (p === "/ward/invoice" && req.method === "POST") out = { ok: true, written: 0, skipped: "nothing_priced", unpriced: [{ display: "Complete blood count" }, { display: "Bed per day, GAS" }] };
    else if (p === "/patient/get") out = { ok: true, patient: { name: "Test Patient QA-01" } };
    else if (p === "/ward/invoices") out = { ok: true, invoices: [], outstandingBalance: 0 };
    else if (p === "/ward/charges") out = { ok: true, priced: [], unpriced: [{ display: "Complete blood count" }] };
    else if (p === "/ward/payment-requests") out = { ok: true, requests: [] };
    else if (p === "/ward/discharge-summary") out = SUMMARY;
    else if (p === "/ward/list") out = { ok: true, patients: [] };
    const status = out.ok === false ? out.status : 200;
    res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(out)); return;
  }
  const f = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try { const b = await readFile(f); res.writeHead(200, { "Content-Type": TYPES[extname(f)] || "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const BASE = "http://localhost:" + server.address().port;

const results = [];
const b = await launch({ port: Number(process.env.CDP_PORT || 9493), width: 1200, height: 900 });
const { ev, until, nav, call } = b;
async function step(name, fn) {
  try { const r = await fn(); results.push([r === true ? "PASS" : "FAIL", name, r === true ? "" : String(r)]); }
  catch (e) { results.push(["FAIL", name, String(e && e.message || e)]); }
  const last = results[results.length - 1]; console.log(last[0], name, last[2]);
}
const setField = (sel, value) => ev(`var i=document.querySelector(${JSON.stringify(sel)}); if(!i) return "no " + ${JSON.stringify(sel)}; i.focus(); i.value=${JSON.stringify(value)};
  i.dispatchEvent(new Event("input",{bubbles:true})); if (i.tagName === "SELECT") i.dispatchEvent(new Event("change",{bubbles:true})); return 1;`);
const valueOf = (sel) => ev(`var i=document.querySelector(${JSON.stringify(sel)}); return i ? i.value : null;`);
const SEL = `WARD._st.sel = { patientId: "p1", encounterId: "e1", name: "Test Patient QA-01", mrn: "SMD-6TEQZM-00027", ward: "GAS", bed: "3" }; WARD._st.view = "chart";`;

try {
  await nav(BASE + "/test/print-lang-harness.html");
  await step("scripts load (i18n, print-lang, ward, discharge)", async () => (await until("return !!(window.WARD && window.DISCHARGE && window.WSQPrint)", 8000)) === true || "not loaded");
  await ev(`window.print = function () { window.__printed = (window.__printed || 0) + 1; };
    var app = document.createElement("div"); app.id = "app"; app.textContent = "MAP TILES AND SIDEBAR"; document.body.insertBefore(app, document.body.firstChild);
    var fab = document.createElement("button"); fab.id = "wsqBugFab"; fab.textContent = "Report Bug";
    fab.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;padding:9px 15px;font-size:13px;"; document.body.appendChild(fab);
    window.prompt = function () { window.__prompted = (window.__prompted || 0) + 1; return null; };
    WARD.open({ orgId: "org-t" }); return 1;`);

  // ---- LT-17 / LT-32: the discharge form -----------------------------------------------------------------
  await ev(SEL + ` WARD._dispatch("wardcloseopen"); return 1;`);
  await step("Discharge opens an in-app form with the server's checklist, no browser prompt", async () =>
    (await until(`var t = document.getElementById("smdWard").innerText; return t.indexOf("Paracetamol 1 g") >= 0 && t.indexOf("Chest X-ray PA view") >= 0 && t.indexOf("Bed per day, GAS") >= 0 && !window.__prompted ? true : null;`, 8000)) === true || "checklist not shown");
  await step("Picking 'Transferred to another hospital' asks for the receiving hospital", async () => {
    await setField('[data-w-dc="disposition"]', "transferred");
    return (await until(`return document.querySelector('[data-w-dc="destination"]') ? true : null;`, 3000)) === true || "no destination field";
  });
  await step("What is typed survives a repaint of the ward (the LT-06 failure mode)", async () => {
    await setField('[data-w-dc="destination"]', "City Cardiac Centre");
    await setField('[data-w-dc="overrideReason"]', "Receiving team continues the paracetamol and chases the X-ray");
    await ev(`WARD._dispatch("dismiss"); return 1;`);
    const d = await valueOf('[data-w-dc="destination"]'), o = await valueOf('[data-w-dc="overrideReason"]'), s = await valueOf('[data-w-dc="disposition"]');
    return d === "City Cardiac Centre" && o.indexOf("chases the X-ray") > 0 && s === "transferred" || JSON.stringify({ d, o, s });
  });
  await step("A refused discharge shows why and keeps the form (nothing reports success)", async () => {
    await ev(`document.querySelector('[data-w-act="dischargesubmit"]').click(); return 1;`);
    const shown = await until(`var t = document.getElementById("smdWard").innerText; return t.indexOf("not settled") >= 0 ? true : null;`, 5000);
    const still = await valueOf('[data-w-dc="destination"]');
    return shown === true && still === "City Cardiac Centre" && !/Stay ended/.test(await ev(`return document.getElementById("smdWard").innerText;`)) || "no refusal shown or form lost";
  });
  await step("With the bill deferred the discharge sends the coded destination and both reasons", async () => {
    await setField('[data-w-dc="billReason"]', "Insurer settles directly");
    await ev(`document.querySelector('[data-w-act="dischargesubmit"]').click(); return 1;`);
    // State, not the list's DOM: the ward list needs fixtures for every board it loads, which this runner does not serve.
    const ok = await until(`return WARD._st.view === "list" && WARD._st.dc === null && /Stay ended/.test(WARD._st.note) ? true : null;`, 5000);
    const sent = posts.filter((x) => x.path === "/ward/discharge").pop();
    const bd = sent && sent.body || {};
    return ok === true && bd.disposition === "transferred" && bd.destination === "City Cardiac Centre" && bd.billDeferredReason === "Insurer settles directly" && /chases/.test(bd.overrideReason || "")
      || JSON.stringify(bd) + " " + (await ev(`return JSON.stringify({ view: WARD._st.view, note: WARD._st.note, err: WARD._st.err });`));
  });
  await b.shot(SHOTS + "/after-discharge.png");

  // ---- LT-17: the follow-up form --------------------------------------------------------------------------
  await ev(SEL + ` WARD._dispatch("followup"); return 1;`);
  await step("Follow-up is an in-app form; reason and date survive a repaint and are sent", async () => {
    if (!(await until(`return document.querySelector('[data-w-fu="reason"]') ? true : null;`, 3000))) return "no form";
    await setField('[data-w-fu="reason"]', "Review haemoglobin after transfusion");
    await setField('[data-w-fu="dueBy"]', "2026-10-01");
    await ev(`WARD._dispatch("dismiss"); return 1;`);
    if ((await valueOf('[data-w-fu="reason"]')) !== "Review haemoglobin after transfusion" || (await valueOf('[data-w-fu="dueBy"]')) !== "2026-10-01") return "lost on repaint";
    await ev(`document.querySelector('[data-w-act="followupsubmit"]').click(); return 1;`);
    await until(`return WARD._st.view === "chart" ? true : null;`, 5000);
    const sent = posts.filter((x) => x.path === "/ward/follow-up").pop();
    return !!sent && sent.body.reason === "Review haemoglobin after transfusion" && sent.body.dueBy === "2026-10-01" && !(await ev("return window.__prompted || 0")) || JSON.stringify(sent);
  });

  // ---- LT-30: the cashier ---------------------------------------------------------------------------------
  await ev(`WARD._st.sel = null; WARD._dispatch("cashier"); return 1;`);
  await step("Raise invoice with nothing priced names the charges and links to the Price list", async () => {
    if (!(await until(`return document.getElementById("wCashMrn") ? true : null;`, 3000))) return "no cashier";
    await setField("#wCashMrn", "SMD-6TEQZM-00027");
    await ev(`document.querySelector('[data-w-act="cashlookup"]').click(); return 1;`);
    if (!(await until(`return document.querySelector('[data-w-act="cashraise"]') ? true : null;`, 5000))) return "lookup failed";
    await ev(`document.querySelector('[data-w-act="cashraise"]').click(); return 1;`);
    return (await until(`var t = document.getElementById("smdWard").innerText, a = document.querySelector('#smdWard a[href="#/admin/tariff"]');
      return t.indexOf("No invoice was raised") >= 0 && t.indexOf("Complete blood count") >= 0 && t.indexOf("Bed per day, GAS") >= 0 && a ? true : null;`, 5000)) === true || "nothing said";
  });
  await b.shot(SHOTS + "/cashier-nothing-priced.png");

  // ---- LT-19: the discharge summary layer -----------------------------------------------------------------
  await ev(`WARD._st.sel = { patientId: "p1", encounterId: "e1" }; WARD._st.view = "chart"; DISCHARGE.open({ orgId: "org-t", encounterId: "e1", patientId: "p1" }); return 1;`);
  await step("Summary: the hospital's clock, not UTC ISO, in the identity band and the section text", async () =>
    (await until(`var t = document.getElementById("smdDischarge").innerText; return t.indexOf("Admitted: 15 Sep 2026, 20:53.") >= 0 && t.indexOf("2026-09-15T15:23") < 0 ? true : null;`, 8000)) === true
      || (await ev(`return document.getElementById("smdDischarge").innerText.slice(0, 600);`)));
  await step("Summary: status card icons use the icon font, not the text font (no ligature names as words)", async () => ev(`
    var icons = document.querySelectorAll("#smdDischarge .d-stat .material-symbols-outlined");
    if (!icons.length) return "no status icons";
    for (var i = 0; i < icons.length; i++) { var f = getComputedStyle(icons[i]).fontFamily; if (f.indexOf("Material Symbols") < 0) return "icon font lost: " + f; }
    return true;`));
  await step("Summary: Report Bug does not cover Sign and finalise", async () => ev(`
    var s = document.querySelector('#smdDischarge [data-d-act="sign"]').getBoundingClientRect(), f = document.getElementById("wsqBugFab").getBoundingClientRect();
    var overlap = !(s.right <= f.left || s.left >= f.right || s.bottom <= f.top || s.top >= f.bottom);
    return overlap ? "overlap " + JSON.stringify([s.left, s.right, f.left, f.right]) : true;`));
  await b.shot(SHOTS + "/summary.png");
  await step("Summary: another ward action closes the layer instead of leaving it on top", async () => {
    await ev(`WARD._dispatch("pcopy"); return 1;`);
    return (await until(`return !document.getElementById("smdDischarge").classList.contains("on") ? true : null;`, 3000)) === true || "layer still on";
  });

  // ---- LT-33: the Patient copy prints alone ---------------------------------------------------------------
  await call("Emulation.setEmulatedMedia", { media: "print" });
  await step("Patient copy print preview: the map, sidebar and Report Bug do not print; the ward does", async () => ev(`
    var vis = function (el) { return !!el && getComputedStyle(el).display !== "none"; };
    if (vis(document.getElementById("app"))) return "the map prints";
    if (vis(document.getElementById("wsqBugFab"))) return "Report Bug prints";
    if (!vis(document.getElementById("smdWard"))) return "the ward does not print";
    return true;`));
  await call("Emulation.setEmulatedMedia", { media: "screen" });
  await step("no script errors on the page", async () => b.consoleLines.filter((l) => l.startsWith("EXC")).length === 0 || b.consoleLines.join(" | "));
} finally {
  b.close(); server.close();
}
const failed = results.filter((r) => r[0] !== "PASS");
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
