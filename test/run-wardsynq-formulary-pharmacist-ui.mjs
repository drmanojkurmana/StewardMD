/* test/run-wardsynq-formulary-pharmacist-ui.mjs - real headless Chrome, the staff site as a PHARMACIST (O19), at phone (390)
 * and desktop (1280) widths.
 *
 *   node test/run-wardsynq-formulary-pharmacist-ui.mjs        (CHROME=<path> to override; SHOTS=<dir> for screenshots)
 *
 * The pharmacy role holds formulary.manage and not staff.admin. The home map offers a Formulary tile it can open (Admin Center
 * stays locked), and the admin page is the formulary card alone: no tab strip, no hospital, staff, billing or integration
 * sections. The card loads, an entry is retired in the draft, and the dry run offers Save with the server's count. Serves the real
 * static bundle with /api/queue/* answered by fixtures (the run-wardsynq-staff-nav-i18n.mjs pattern).
 */
import { launch } from "./wardsynq-site-cdp.mjs";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };
const SHOTS = process.env.SHOTS || (process.env.CLAUDE_JOB_DIR || "/tmp") + "/formulary-pharmacist-shots";
await mkdir(SHOTS, { recursive: true });

const WHOAMI = { ok: true, role: "pharmacy", orgId: "org-t", caps: ["queue.view", "order.read", "order.dispense", "order.verify", "register.ndps", "dept.request", "formulary.manage"], name: "Test Pharmacist" };
const ORG = { ok: true, org: { id: "org-t", name: "Test Hospital", code: "SMD-TEST01", mode: "wardsynq", connectTenantId: "none" }, wards: [], departments: [], rooms: [] };
const ENTRIES = [{ drug: "Meropenem", code: "MER-1", restricted: true, requiresApproval: true, approvedBy: "Microbiology" }, { drug: "Paracetamol 500mg", code: "PCM-500" }];
const posted = [];

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const send = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
  if (url.pathname === "/api/queue/whoami") return send(WHOAMI);
  if (url.pathname === "/api/queue/org") return send(ORG);
  if (url.pathname === "/api/queue/org/formulary" && req.method === "GET") return send({ ok: true, entries: ENTRIES, requireReasonOffFormulary: false, problems: [], maxEntries: 3000 });
  if (url.pathname === "/api/queue/org/formulary" && req.method === "POST") {
    let raw = ""; for await (const ch of req) raw += ch;
    posted.push(JSON.parse(raw || "{}"));
    return send({ ok: true, step: "preview", planId: "abcd1234abcd1234", changeCount: 1, counts: { add: 0, change: 1, remove: 0, invalid: 0, setting: 0 }, rows: [{ index: 1, label: "Paracetamol 500mg", status: "change" }], removed: [] });
  }
  // Anything else an admin section would call is a failure for a pharmacist: record it.
  if (url.pathname.startsWith("/api/queue/org/") || url.pathname === "/api/queue/members" || url.pathname.startsWith("/api/queue/member")) { posted.push({ unexpected: url.pathname }); return send({ ok: false, error: "forbidden" }); }
  if (url.pathname.startsWith("/api/queue")) return send({ ok: true, patients: [], wards: [], loops: [] });
  const p = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try { const b = await readFile(p); res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const BASE = "http://localhost:" + server.address().port;

let fails = 0;
const ok = (c, m) => { console.log((c === true ? "PASS " : "FAIL ") + m + (c === true ? "" : " " + String(c))); if (c !== true) fails++; };

for (const W of [390, 1280]) {
  const b = await launch({ port: Number(process.env.CDP_PORT || 9496) + (W === 390 ? 1 : 0), width: W, height: 900 });
  try {
    if (W < 600) await b.call("Emulation.setDeviceMetricsOverride", { width: W, height: 900, deviceScaleFactor: 1, mobile: true });
    await b.call("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('smd_opd_toktype','staff'); localStorage.setItem('smd_opd_staff_tok','tok-1'); localStorage.setItem('smd_opd_hospital','org-t');` });
    await b.nav(BASE + "/wardsynq/site/index.html");
    ok((await b.until(`return document.querySelector('.tile[data-go="admin"]') ? 'y' : '';`, 15000)) === "y" || "the map never rendered", `${W}px: the home map renders for the pharmacist`);
    ok(await b.ev(`var t = [].slice.call(document.querySelectorAll('.tile[data-go="admin"]'));
      var fml = t.filter(function (x) { return x.textContent.indexOf('Formulary') >= 0; })[0], adm = t.filter(function (x) { return x.textContent.indexOf('Admin Center') >= 0; })[0];
      if (!fml) return 'no Formulary tile'; if (fml.disabled) return 'Formulary tile is locked';
      if (!adm || !adm.disabled) return 'Admin Center tile should stay locked'; return true;`), `${W}px: Formulary tile opens, Admin Center tile stays locked`);
    await b.ev(`[].slice.call(document.querySelectorAll('.tile[data-go="admin"]')).filter(function (x) { return !x.disabled; })[0].click(); return 1;`);
    ok((await b.until(`return document.querySelector('#fmlCard [data-fml="dry"]') ? 'y' : '';`, 8000)) === "y" || "the formulary card never loaded", `${W}px: the tile opens the formulary card, loaded`);
    ok(await b.ev(`var p = document.getElementById('page');
      if (!p.querySelector('h1') || p.querySelector('h1').textContent !== 'Formulary') return 'heading: ' + (p.querySelector('h1') || {}).textContent;
      if (p.querySelector('[role="tablist"], [data-tab], #adminBody')) return 'admin tabs or sections shown';
      if (p.textContent.indexOf('Meropenem') < 0 || p.textContent.indexOf('Paracetamol 500mg') < 0) return 'entries missing';
      return true;`), `${W}px: heading Formulary, the hospital's entries, no admin tabs or sections`);
    ok(await b.ev(`return document.documentElement.scrollWidth - innerWidth <= 0 || 'scrolls sideways by ' + (document.documentElement.scrollWidth - innerWidth);`), `${W}px: no horizontal scroll`);
    await b.shot(`${SHOTS}/pharmacist-formulary-${W}.png`);
    if (W === 1280) {
      await b.click('#fmlCard [data-fml="retire"][data-i="1"]');
      await b.click('#fmlCard [data-fml="dry"]');
      ok((await b.until(`return document.querySelector('#fmlCard [data-fml="ed-commit"]') ? 'y' : '';`, 8000)) === "y" || "no Save after the dry run", "retire then dry run offers Save with the server's plan");
      const sent = posted.filter((x) => x.entries)[0];
      ok(!!(sent && sent.entries[1].retired === true && sent.orgId === "org-t") || JSON.stringify(sent), "the dry run sent the draft with the entry retired");
      await b.shot(`${SHOTS}/pharmacist-formulary-dryrun-${W}.png`);
    }
    ok(!posted.some((x) => x.unexpected) || JSON.stringify(posted.filter((x) => x.unexpected)), `${W}px: no admin-only route was called`);
    const errs = b.consoleLines.filter((l) => l.startsWith("EXC"));
    ok(errs.length === 0 || errs.join(" | "), `${W}px: no script errors`);
  } finally { b.close(); }
}
server.close();
console.log(fails ? `\n${fails} failed. Screenshots: ${SHOTS}` : `\nall passed. Screenshots: ${SHOTS}`);
process.exit(fails ? 1 : 0);
