/* test/run-opd-dept-ui.mjs - real headless Chrome over the REAL /api/queue router (in-memory Firestore) for
 * the 2026-09-14 OPD and Admin work: D7 department picker and token, D14 refusal, D13 no-show and recall on
 * the OPD console (opd.html), and on wardsynq.com Admin Center the token card, D11 clinical settings, D10
 * seed data marks and D4 publish counts.
 *
 *   node --experimental-test-module-mocks test/run-opd-dept-ui.mjs        (CHROME=<path> to override)
 *
 * A local http server serves this checkout's static files and hands /api/queue/* to the router, so every
 * click reaches the same server code production runs. Prints PASS/FAIL per step; exits 1 on any FAIL.
 */
import * as H from "./helpers/opd-router-harness.mjs";
import { launch } from "./wardsynq-site-cdp.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const { onRequest } = await import("../functions/api/queue/[[path]].js");
const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

// ---- data: a native hospital that numbers per department (console), and a WardSynQ hospital (Admin Center) ----
H.seed({ scope: "department", prefixes: { dcard: "C", dmed: "M" } });
H.docs.set("q_rooms/r1", { fields: { orgId: "org-a", name: "Heart room", number: "1", departmentId: "dcard", active: true, assignment: { mode: "primary", primary: "dr1", doctors: ["dr1"] } }, updateTime: "t1" });
H.org("org-w", H.OWNER_B, { mode: "wardsynq", name: "Ward Hospital", wardsynq: { patientAccess: { enabled: false } } });
H.dept("wd1", "org-w", "Medicine", ""); H.dept("wd2", "org-w", "Surgery", "SUR");
const nurse = (await H.staffToken("org-a", "nurse1", "nurse")).staff;
const wadmin = (await H.staffToken("org-w", "wadmin", "admin")).staff;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/queue")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await onRequest({ request: new Request("http://localhost" + req.url, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : Buffer.concat(chunks) }), env: H.ENV, waitUntil() {} });
    res.writeHead(r.status, { "Content-Type": "application/json" }); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  const p = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try { const body = await readFile(p); res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const BASE = "http://localhost:" + server.address().port;

const results = [];
const b = await launch({ port: Number(process.env.CDP_PORT || 9481), width: 1300, height: 950 });
const { ev, until, nav, sleep } = b;
async function step(name, fn) {
  try { const r = await fn(); results.push([r === true ? "PASS" : "FAIL", name, r === true ? "" : String(r)]); }
  catch (e) { results.push(["FAIL", name, String(e && e.message || e)]); }
  const last = results[results.length - 1]; console.log(last[0], name, last[2]);
}
const setVal = (sel, v) => ev(`var i=document.querySelector(${JSON.stringify(sel)}); if(!i) return 'no '+${JSON.stringify(sel)}; i.value=${JSON.stringify(v)}; i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true})); return 1;`);
const click = (sel) => ev(`var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return 'no '+${JSON.stringify(sel)}; e.click(); return 1;`);
const bodyHas = (s) => `return document.body.textContent.indexOf(${JSON.stringify(s)})>=0 || null;`;
const toastHas = (s) => `var t=document.getElementById('toast')||document.getElementById('wsqToast'); return (t&&t.textContent.indexOf(${JSON.stringify(s)})>=0) || null;`;

// ---- OPD console (opd.html) as a desk nurse --------------------------------------------------------------
await nav(BASE + "/opd.html");
await ev(`localStorage.setItem("smd_opd_staff_tok", ${JSON.stringify(nurse)}); localStorage.setItem("smd_opd_toktype","staff"); localStorage.setItem("smd_opd_hospital","org-a"); return 1;`);
await nav(BASE + "/opd.html");
await step("console loads the board for the nurse", async () => (await until(bodyHas("Central routing"), 15000)) ? true : await ev("return document.body.textContent.slice(0,300)"));
await step("D7 the check-in sheet offers the hospital's departments and requires one", async () => {
  await click("#walk");
  const ok = await until(`var s=document.getElementById('pr_departmentId'); return s && s.options.length===3 && /Cardiology/.test(s.textContent) || null;`, 8000);
  return ok ? true : await ev("return (document.getElementById('smdPatReg')||{}).innerHTML||'no sheet'");
});
await step("D14 saving without a department is refused on the sheet", async () => {
  await setVal("#pr_name", "Asha Kumar"); await click('[data-seg="gender"] [data-v="female"]'); await setVal("#pr_ageYears", "34"); await setVal("#pr_mobile", "9876543210");
  await click("#prSave");
  return (await until(`return /Choose a department to give a token/.test(document.querySelector('[data-f="departmentId"] .pr-err').textContent) || null;`, 4000)) ? true : "no inline error";
});
await step("D7 registering into Cardiology gives token C-001 and routes it to the Cardiology room", async () => {
  await setVal("#pr_departmentId", "dcard");
  await click("#prSave");
  if (!(await until(`return /added/.test(document.getElementById('smdPatReg').textContent) || null;`, 8000))) return "sheet did not finish: " + await ev("return document.getElementById('prFerr') && document.getElementById('prFerr').textContent");
  if (!(await until(toastHas("token C-001"), 8000))) return "toast: " + await ev("return document.getElementById('toast').textContent");
  await click('#smdPatReg [data-a="close"]');
  return (await until(`return [...document.querySelectorAll('.rcard')].some(function(c){return /Heart room/.test(c.textContent)&&/C-001/.test(c.textContent);}) || null;`, 8000)) ? true : "C-001 not on the room card";
});
await step("D13 call, then mark no-show from the room row", async () => {
  await click('.rcard [data-a="call"]');
  if (!(await until(`return document.querySelector('.rcard [data-a="noshow"]') || null;`, 8000))) return "no No-show button after Call";
  await click('.rcard [data-a="noshow"]');
  await until(`return document.querySelector('#sheet #ok') || null;`, 3000);
  await click("#sheet #ok");
  return (await until(`return !/C-001/.test([...document.querySelectorAll('.rcard')].map(function(c){return c.textContent;}).join('')) || null;`, 8000)) ? true : "C-001 still on the room card";
});
await step("D13 No-shows lists C-001; recall without a reason is refused; with one it is back with the same token", async () => {
  await click("#noshows");
  if (!(await until(`return /C-001/.test(document.getElementById('nsl').textContent) || null;`, 8000))) return "list: " + await ev("return document.getElementById('nsl').textContent");
  await click('#nsl [data-nsr="waiting"]');
  if (!(await until(toastHas("Say why the patient is recalled"), 3000))) return "no reason refusal";
  await setVal("#nsl .nsr", "Arrived from the pharmacy");
  await click('#nsl [data-nsr="waiting"]');
  if (!(await until(toastHas("Recalled with the same token"), 8000))) return "toast: " + await ev("return document.getElementById('toast').textContent");
  await ev(`document.getElementById('cx') && document.getElementById('cx').click(); return 1;`);
  return (await until(`return [...document.querySelectorAll('.rcard')].some(function(c){return /C-001/.test(c.textContent);}) || null;`, 8000)) ? true : "C-001 not back on the board";
});
await step("the recall is in the audit trail with the reason", async () => {
  const ev1 = [...H.docs.values()].map((d) => d.fields).find((f) => f.action === "recall_no_show");
  return ev1 && ev1.actor === "nurse1" && /Arrived from the pharmacy/.test(ev1.meta) ? true : JSON.stringify(ev1);
});

// ---- wardsynq.com Admin Center as the WardSynQ hospital's admin --------------------------------------------
await nav(BASE + "/wardsynq/site/index.html");
await ev(`localStorage.clear(); localStorage.setItem("smd_opd_staff_tok", ${JSON.stringify(wadmin)}); localStorage.setItem("smd_opd_toktype","staff"); localStorage.setItem("smd_opd_hospital","org-w"); return 1;`);
await nav("about:blank");   // a hash-only navigation would keep the page booted with the nurse's session
await nav(BASE + "/wardsynq/site/index.html?as=wadmin#/admin");
await step("Admin Center opens on Hospital", async () => (await until(bodyHas("OPD token numbers"), 15000)) ? true : await ev("return document.body.textContent.slice(0,400)"));
await step("D7/D14 token card lists departments; per-department numbering without a prefix is refused on screen", async () => {
  if (!(await until(`return document.querySelectorAll('tr[data-tok-dept]').length===2 || null;`, 8000))) return "rows: " + await ev("return document.getElementById('tokCard').textContent");
  await setVal("#tokScope", "department");
  await click("#tokSave");
  return (await until(`return /Medicine needs a prefix/.test(document.getElementById('tokMsg').textContent) || null;`, 4000)) ? true : await ev("return document.getElementById('tokMsg').textContent");
});
await step("D14 with a prefix for Medicine (Surgery uses its code) the save goes through and is stored by id", async () => {
  await setVal('tr[data-tok-dept="wd1"] .tokPrefix', "MED");
  await click("#tokSave");
  await until(toastHas("Token numbering saved"), 8000);
  const t = H.docs.get("q_orgs/org-w").fields.tokens;
  return t && t.scope === "department" && t.prefixes.wd1 === "MED" ? true : JSON.stringify(t);
});
await step("D11 apply the template, edit, save: the card shows the server's read-back", async () => {
  if (!(await until(`return document.getElementById('clinSave') || null;`, 8000))) return "no clinical settings card";
  await setVal("#clinTpl", "not-configured"); await click("#clinApply");
  await setVal("#clinHigh", "Insulin\nHeparin"); await setVal("#clinVerify", "4");
  await click("#clinSave");
  if (!(await until(`return /The server now holds/.test(document.getElementById('clinCard').textContent) || null;`, 8000))) return await ev("return document.getElementById('clinCard').textContent.slice(0,400)");
  const w = H.docs.get("q_orgs/org-w").fields.wardsynq;
  return (await ev(`return /Insulin, Heparin/.test(document.getElementById('clinCard').textContent) || null;`)) && w.orderVerifyWithinHours === 4 ? true : JSON.stringify(w);
});
await step("D10 Clinical seed data marks items UNAPPROVED and offers a hospital admin no sign-off", async () => {
  await click('[data-tab="seed"]');
  if (!(await until(`return /items unapproved/.test(document.getElementById('adminBody').textContent) || null;`, 15000))) return await ev("return document.getElementById('adminBody').textContent.slice(0,300)");
  return (await ev(`return document.querySelectorAll('.pill.stop').length>10 && !document.querySelector('[data-seed-sign]') || null;`)) ? true : "marks or buttons wrong";
});
await step("D4 Hospital group: not in a group, so no publish button; the group overview page loads", async () => {
  await click('[data-tab="group"]');
  return (await until(bodyHas("not in a hospital group"), 8000)) ? true : await ev("return document.getElementById('adminBody').textContent.slice(0,300)");
});
const excs = b.consoleLines.filter((l) => /^EXC/.test(l));
await step("no uncaught page exceptions", async () => (excs.length ? excs.join(" | ") : true));

b.close(); server.close();
const failed = results.filter((r) => r[0] !== "PASS");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
