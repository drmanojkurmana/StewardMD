/* test/run-wardsynq-hospitals-page.mjs - real headless Chrome, the staff site's #/hospitals page
 * ("Choose a hospital"), at desktop (1280) and phone (390) widths.
 *
 *   node test/run-wardsynq-hospitals-page.mjs        (CHROME=<path> to override; SHOTS=<dir> for screenshots)
 *
 * BUG-MU2PG63U-05BD: the whole page was misaligned. Each .hosp-row is three grid children (the signal
 * bar, the icon, the text) in a two-column grid, so the text fell into the 3 px column one word per
 * line. Serves the real static bundle with /api/queue/* answered by fixtures (the run-wardsynq-staff-
 * nav-i18n.mjs pattern).
 */
import { launch } from "./wardsynq-site-cdp.mjs";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const SHOTS = process.env.SHOTS || (process.env.CLAUDE_JOB_DIR || "/tmp") + "/hospitals-page-shots";
await mkdir(SHOTS, { recursive: true });

const WHOAMI = { ok: true, kind: "firebase", role: "owner", caps: ["staff.admin"], name: "Test Owner" };
const ORGS = { ok: true, orgs: [
  { id: "org-a", name: "Test General Hospital", code: "SMD-TEST01", mode: "wardsynq", memberRole: "owner" },
  { id: "org-b", name: "Test Clinic North", code: "SMD-TEST02", mode: "clinic", memberRole: "doctor" },
] };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const j = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
  if (url.pathname === "/api/queue/whoami") return j(WHOAMI);
  if (url.pathname === "/api/queue/orgs") return j(ORGS);
  if (url.pathname.startsWith("/api/queue")) return j({ ok: true });
  const p = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try { const b = await readFile(p); res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const BASE = "http://localhost:" + server.address().port;

let fails = 0;
const ok = (c, m) => { console.log((c === true ? "PASS " : "FAIL ") + m + (c === true ? "" : " " + String(c))); if (c !== true) fails++; };

for (const W of [1280, 390]) {
  const b = await launch({ port: Number(process.env.CDP_PORT || 9493) + (W === 390 ? 1 : 0), width: W, height: 900 });
  try {
    if (W < 600) await b.call("Emulation.setDeviceMetricsOverride", { width: W, height: 900, deviceScaleFactor: 1, mobile: true });
    await b.call("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('smd_opd_toktype','staff'); localStorage.setItem('smd_opd_staff_tok','tok-1');` });
    await b.nav(BASE + "/wardsynq/site/index.html#/hospitals");
    ok((await b.until(`return document.querySelectorAll('.hosp-row').length === 2 ? 'y' : '';`, 15000)) === "y" || "the two hospitals never rendered", `${W}px: #/hospitals lists both hospitals`);
    const g = JSON.parse(await b.ev(`var rows = [].slice.call(document.querySelectorAll('.hosp-row'));
      return JSON.stringify({ overflow: document.documentElement.scrollWidth - innerWidth, rows: rows.map(function (r) {
        var ic = r.querySelector('.ms').getBoundingClientRect(), name = r.querySelector('b'), nb = name.getBoundingClientRect(), tx = r.querySelector('div').getBoundingClientRect();
        return { textW: Math.round(tx.width), nameLines: Math.round(nb.height / parseFloat(getComputedStyle(name).lineHeight || 20)), iconBesideText: (ic.left + ic.width / 2) < tx.left && ic.bottom > tx.top && ic.top < tx.bottom };
      }), create: (function () { var c = document.getElementById('newHosp'); var l = document.querySelector('.hosp-list'); return c && l ? Math.round(c.closest('.card').getBoundingClientRect().left - l.getBoundingClientRect().left) : null; })() });`));
    ok(g.overflow <= 0 || "scrolls sideways by " + g.overflow, `${W}px: no horizontal scroll`);
    ok(g.rows.every((r) => r.iconBesideText && r.textW > 200) || JSON.stringify(g.rows), `${W}px: each row is icon beside text, the text column wide (not the 3 px signal column)`);
    ok(g.rows.every((r) => r.nameLines <= 1) || JSON.stringify(g.rows), `${W}px: each hospital name sits on one line`);
    ok(g.create === 0 || "create card offset " + g.create, `${W}px: the Create card lines up with the hospital list`);
    await b.shot(`${SHOTS}/hospitals-${W}.png`);
  } finally { try { b.close && b.close(); } catch {} }
}
server.close();
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
