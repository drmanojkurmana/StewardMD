/* test/run-wardsynq-gst-cutover-ui.mjs - real headless Chrome, the staff site at phone (390) and desktop (1280) widths, for the
 * owner decisions of 2026-10-04: Stores > Returns to suppliers (each return's debit note, the purchase terms asked only for a
 * receipt with no price, the debit note register) and Admin > Import > Opening balances (the file kind and the one-stay form).
 *
 *   node test/run-wardsynq-gst-cutover-ui.mjs        (CHROME=<path> to override; SHOTS=<dir> for screenshots)
 *
 * Serves the real static bundle with /api/queue/* answered by fixtures shaped like the server's (the routes themselves are
 * pinned in test/wardsynq-supplier-debit-note.test.mjs and test/wardsynq-opening-balance.test.mjs). Prints PASS/FAIL.
 */
import { launch } from "./wardsynq-site-cdp.mjs";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };
const SHOTS = process.env.SHOTS || (process.env.CLAUDE_JOB_DIR || "/tmp") + "/gst-cutover-shots";
await mkdir(SHOTS, { recursive: true });

const WHOAMI = { ok: true, role: "admin", orgId: "org-t", name: "Test Admin",
  caps: ["queue.view", "queue.add", "staff.admin", "billing.view", "billing.charge", "stores.manage", "order.dispense", "order.read", "dept.request", "stores.indent.approve"] };
const ORG = { ok: true, org: { id: "org-t", name: "Test Hospital", code: "SMD-TEST01", mode: "wardsynq", connectTenantId: "none" }, wards: [], departments: [], rooms: [] };
const NOTE = { number: "SDN/2627/000001", taxablePaise: 9990, gstRate: 12, interState: false, cgstPaise: 599, sgstPaise: 599, igstPaise: 0, taxPaise: 1198, totalPaise: 11188 };
const NOTE2 = { number: "SDN/2627/000002", taxablePaise: 500100, gstRate: 5, interState: true, cgstPaise: 0, sgstPaise: 0, igstPaise: 25006, taxPaise: 25006, totalPaise: 525106 };
const SC = { ok: true, vendors: [],
  receipts: [{ receiptId: "r1", display: "Ibuprofen 400mg", at: "2026-10-02T10:00:00Z", supplier: "Acme Pharma", unit: "tablet", remaining: 95, priced: false },
    { receiptId: "r2", display: "Paracetamol 500mg", at: "2026-10-01T10:00:00Z", supplier: "Acme Pharma", unit: "tablet", remaining: 70, priced: true }],
  returns: [{ display: "Paracetamol 500mg", quantity: 30, unit: "tablet", supplier: "Acme Pharma", reason: "Damaged strips", debitNoteNo: "ACME-CN-9", at: "2026-10-03T10:00:00Z", debitNote: NOTE },
    { display: "Examination gloves, medium", quantity: 1, unit: "carton", supplier: "MedSupply Distributors Private Limited", reason: "Wrong size delivered", at: "2026-10-03T11:00:00Z", debitNote: NOTE2 },
    { display: "Syringe 10ml", quantity: 5, unit: "syringe", supplier: "MedSupply", reason: "Recalled batch", at: "2026-09-20T11:00:00Z" }] };
const REG = { ok: true, rows: [
  { date: "2026-10-03", at: "2026-10-03T10:00:00Z", supplier: "Acme Pharma", supplierGstin: "36AABCU9603R1ZO", display: "Paracetamol 500mg", quantity: 30, unit: "tablet", originalInvoiceNo: "INV-1", ...NOTE },
  { date: "2026-10-03", at: "2026-10-03T11:00:00Z", supplier: "MedSupply Distributors Private Limited", display: "Examination gloves, medium", quantity: 1, unit: "carton", originalInvoiceNo: "MS/2026/7781", ...NOTE2 }],
  totals: { count: 2, taxablePaise: 510090, cgstPaise: 599, sgstPaise: 599, igstPaise: 25006, taxPaise: 26204, totalPaise: 536294 } };
const posted = [];

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const send = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
  let body = null;
  if (req.method === "POST") { let raw = ""; for await (const ch of req) raw += ch; body = JSON.parse(raw || "{}"); posted.push({ path: url.pathname, body }); }
  if (url.pathname === "/api/queue/whoami") return send(WHOAMI);
  if (url.pathname === "/api/queue/org") return send(ORG);
  if (url.pathname === "/api/queue/ward/supply-chain") return send(SC);
  if (url.pathname === "/api/queue/ward/supplier-debit-notes") return send(REG);
  if (url.pathname === "/api/queue/ward/stores") return send({ ok: true, categories: ["consumables", "other"], items: [{ code: "SYR-10", name: "Syringe 10ml", category: "consumables", unit: "syringe", reorderLevel: null, packs: null, active: true }], locations: [{ code: "CS", name: "Central store", kind: "central", active: true }], indents: [], levels: [], belowReorder: [], negative: [], expiring: [], problems: [] });
  if (url.pathname === "/api/queue/ward/purchase-orders") return send({ ok: true, orders: [] });
  if (url.pathname === "/api/queue/org/reorder-policy") return send({ ok: true, policy: null });
  if (url.pathname === "/api/queue/ward/opening-balance") return send({ ok: true, written: 1, openingBalance: { amountPaise: 4500050, legacyBillRef: body.legacyBillRef, asOf: body.asOf } });
  if (url.pathname.startsWith("/api/queue")) return send({ ok: true, patients: [], wards: [], loops: [], members: [], items: [] });
  const p = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try { const b = await readFile(p); res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const BASE = "http://localhost:" + server.address().port;

let fails = 0;
const ok = (c, m) => { console.log((c === true ? "PASS " : "FAIL ") + m + (c === true ? "" : " " + String(c))); if (c !== true) fails++; };
const noSideScroll = `return document.documentElement.scrollWidth - innerWidth <= 0 || 'scrolls sideways by ' + (document.documentElement.scrollWidth - innerWidth);`;

for (const W of [390, 1280]) {
  const b = await launch({ port: Number(process.env.CDP_PORT || 9510) + (W === 390 ? 1 : 0), width: W, height: 900 });
  try {
    if (W < 600) await b.call("Emulation.setDeviceMetricsOverride", { width: W, height: 900, deviceScaleFactor: 1, mobile: true });
    await b.call("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('smd_opd_toktype','staff'); localStorage.setItem('smd_opd_staff_tok','tok-1'); localStorage.setItem('smd_opd_hospital','org-t');` });

    await b.nav(BASE + "/wardsynq/site/index.html#/stores");
    ok((await b.until(`return document.querySelector('#stReturns [data-st="dnRegister"]') ? 'y' : '';`, 15000)) === "y" || "the returns card never loaded", `${W}px: Stores opens with the returns card loaded`);
    ok(await b.ev(`var t = document.getElementById('stReturns').innerText;
      if (t.indexOf('SDN/2627/000001') < 0 || t.indexOf('111.88') < 0) return 'first note missing';
      if (t.indexOf('IGST 250.06') < 0) return 'IGST note missing';
      if (t.indexOf('Returned before debit notes') < 0) return 'old return not said';
      var terms = document.getElementById('stRtTerms'); if (!terms || terms.hidden) return 'terms hidden for an unpriced receipt';
      return true;`), `${W}px: each return shows its debit note; terms are asked for the unpriced receipt`);
    await b.ev(`var s = document.getElementById('stRtReceipt'); s.value = 'r2'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1;`);
    ok(await b.ev(`return document.getElementById('stRtTerms').hidden === true || 'terms still shown for a priced receipt';`), `${W}px: choosing a priced receipt hides the terms`);
    await b.ev(`var s = document.getElementById('stRtReceipt'); s.value = 'r1'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1;`);
    await b.click('#stReturns [data-st="dnRegister"]');
    ok((await b.until(`return document.querySelector('#stDnReg tfoot') ? 'y' : '';`, 8000)) === "y" || "the register never rendered", `${W}px: the debit note register renders with totals`);
    ok(await b.ev(noSideScroll), `${W}px: stores page has no horizontal scroll`);
    await b.ev(`document.getElementById('stReturns').scrollIntoView(); return 1;`);
    await b.sleep(150);
    await b.shot(`${SHOTS}/stores-returns-${W}.png`);
    await b.ev(`document.getElementById('stDnReg').scrollIntoView(); return 1;`);
    await b.sleep(150);
    await b.shot(`${SHOTS}/stores-register-${W}.png`);

    await b.nav(BASE + "/wardsynq/site/index.html#/admin/legacyImport");
    ok((await b.until(`return document.getElementById('admImpKind') ? 'y' : '';`, 15000)) === "y" || "the import tab never loaded", `${W}px: Admin > Import opens`);
    await b.ev(`var s = document.getElementById('admImpKind'); s.value = 'openingBalances'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1;`);
    ok((await b.until(`return document.querySelector('[data-imp="obSave"]') ? 'y' : '';`, 4000)) === "y" || "no one-stay form", `${W}px: choosing opening balances shows the one-stay form`);
    await b.type("admObMrn", "SMD-TEST01-00042"); await b.type("admObAmount", "45,000.50"); await b.type("admObRef", "OLD/IP/7781");
    await b.ev(`document.getElementById('admObAsOf').value = '2026-10-01'; return 1;`);
    await b.click('[data-imp="obSave"]');
    ok((await b.until(`var m = document.querySelector('#admObMsg .msg.ok'); return m ? m.innerText : '';`, 6000) || "").indexOf("OLD/IP/7781") >= 0 || "no saved message", `${W}px: saving says what goes on the bill`);
    const sent = posted.filter((x) => x.path === "/api/queue/ward/opening-balance").at(-1);
    ok(!!(sent && sent.body.mrn === "SMD-TEST01-00042" && sent.body.amount === "45,000.50" && sent.body.asOf === "2026-10-01") || JSON.stringify(sent), `${W}px: the form sends the MR number, amount, old bill and date as typed`);
    ok(await b.ev(noSideScroll), `${W}px: import tab has no horizontal scroll`);
    await b.ev(`document.querySelector('[data-imp="obSave"]').closest('.card').scrollIntoView(); return 1;`);
    await b.sleep(150);
    await b.shot(`${SHOTS}/admin-opening-balance-${W}.png`);
    const errs = b.consoleLines.filter((l) => l.startsWith("EXC"));
    ok(!errs.length || errs.join(" | "), `${W}px: no page exceptions`);
  } finally { b.close(); }
}
server.close();
console.log(fails ? `\n${fails} FAILED. Screenshots: ${SHOTS}` : `\nALL PASS. Screenshots: ${SHOTS}`);
process.exit(fails ? 1 : 0);
