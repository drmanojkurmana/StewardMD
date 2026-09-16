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

let WHOAMI = { ok: true, kind: "firebase", role: "owner", caps: ["staff.admin"], name: "Test Owner" };
const ORGS = { ok: true, orgs: [
  { id: "org-a", name: "Test General Hospital", code: "SMD-TEST01", mode: "wardsynq", memberRole: "owner" },
  { id: "org-b", name: "Test Clinic North", code: "SMD-TEST02", mode: "clinic", memberRole: "doctor" },
] };
/* BUG-MU2PHANW fixtures: /org/delete refuses once (to prove a refusal is shown and nothing leaves the
 * list), then succeeds and the hospital leaves /orgs. The real authorization is tested in
 * test/queue-orgs-onboard.test.mjs; this proves the screen. */
const DELETES = []; let refuseNext = true;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const j = (o, s) => { res.writeHead(s || 200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
  if (url.pathname === "/api/queue/whoami") return j(WHOAMI);
  if (url.pathname === "/api/queue/orgs") return j(ORGS);
  if (url.pathname === "/api/queue/org" && req.method === "GET") return j({ ok: true, org: { id: "org-a", name: "Test General Hospital", code: "SMD-TEST01", mode: "clinic" }, wards: [], departments: [], rooms: [] });
  if (url.pathname === "/api/queue/org/delete" && req.method === "POST") {
    let raw = ""; for await (const ch of req) raw += ch;
    const body = JSON.parse(raw || "{}"); DELETES.push(body);
    if (refuseNext) { refuseNext = false; return j({ ok: false, error: "owner_only" }, 403); }
    ORGS.orgs = ORGS.orgs.filter((o) => o.id !== body.orgId);
    return j({ ok: true, deleted: { ok: true } });
  }
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

for (const W of [390, 1280]) {
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

    if (W === 1280) {
      // ---- BUG-MU2PHANW: Remove hospital, two steps, owner rows only. ----
      ok(await b.ev(`var items = [].slice.call(document.querySelectorAll('.hosp-item'));
        return !!items[0].querySelector('[data-rmorg="org-a"]') && !items[1].querySelector('[data-rmorg]');`) || "wrong rows offer Remove",
        "Remove is offered on the hospital this account owns, not on one where it is a doctor");
      await b.click('[data-rmorg="org-a"]');
      ok(await b.ev(`var d = document.querySelector('dialog.wsq-dialog[open]'); return !!d && /Remove Test General Hospital\\?/.test(d.textContent) && /No clinical record is deleted/.test(d.textContent) && /retained by law/.test(d.textContent) && !d.querySelector('#rmHospWord');`) || "step one did not explain",
        "step 1 explains what happens: gone from lists, records, documents and audit trail kept by law");
      await b.shot(`${SHOTS}/remove-step1.png`);
      await b.click('dialog.wsq-dialog [data-rm="next"]');
      ok(await b.ev(`return !!document.getElementById('rmHospWord') && document.querySelector('[data-rm="go"]').disabled === true;`) || "no typed-word step",
        "step 2 asks for DELETE, and Remove hospital starts disabled");
      await b.type("rmHospWord", "delete");
      ok(await b.ev(`return document.querySelector('[data-rm="go"]').disabled === true;`) || "lower-case enabled it", "delete in lower case does not enable it");
      await b.type("rmHospWord", "DELETE");
      ok(await b.ev(`return document.querySelector('[data-rm="go"]').disabled === false;`) || "DELETE did not enable it", "DELETE exactly enables it");
      await b.shot(`${SHOTS}/remove-step2.png`);
      await b.click('[data-rm="go"]');
      ok((await b.until(`return /Only the hospital's owner can remove it/.test((document.getElementById('rmHospMsg') || {}).textContent || '') ? 'y' : '';`, 5000)) === "y" || "no refusal shown",
        "a server refusal is shown in the dialog");
      ok(await b.ev(`return !!document.querySelector('[data-org="org-a"]') && !!document.querySelector('dialog.wsq-dialog[open]');`) || "reported removed on a refusal",
        "after a refusal the hospital is still listed and the dialog stays open");
      await b.click('[data-rm="go"]');
      ok((await b.until(`return !document.querySelector('dialog.wsq-dialog') && !document.querySelector('[data-org="org-a"]') && !!document.querySelector('[data-org="org-b"]') ? 'y' : '';`, 5000)) === "y" || "list did not update",
        "on a written removal the dialog closes and the hospital leaves the list");
      ok(DELETES.length === 2 && DELETES.every((d) => d.orgId === "org-a" && d.confirm === "DELETE") || JSON.stringify(DELETES),
        "POST /api/queue/org/delete carried the orgId and confirm DELETE");

      // ---- Admin > Hospital: the owner sees Remove hospital; a non-owner admin does not. ----
      for (const [who, expect] of [[{ orgOwner: true }, true], [{}, false]]) {
        WHOAMI = Object.assign({ ok: true, kind: "firebase", role: "admin", caps: ["staff.admin"], name: "Test Admin", orgId: "org-a" }, who);
        await b.call("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('smd_opd_hospital','org-a');` });
        await b.nav("about:blank"); await b.nav(BASE + "/wardsynq/site/index.html#/admin");
        await b.until(`return document.getElementById('admHospSave') ? 'y' : '';`, 15000);
        ok(await b.ev(`return !!document.getElementById('admHospRemove');`) === expect || "admHospRemove present=" + !expect,
          `Admin > Hospital ${expect ? "offers" : "does not offer"} Remove hospital to ${expect ? "the owner" : "an admin who is not the owner"}`);
        if (expect) {
          await b.click("#admHospRemove");
          ok(await b.ev(`return !!document.querySelector('dialog.wsq-dialog[open] [data-rm="next"]');`) || "no dialog", "and it opens the same two-step dialog");
          await b.shot(`${SHOTS}/admin-remove.png`);
        }
      }
    }
  } finally { try { b.close && b.close(); } catch {} }
}
server.close();
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
