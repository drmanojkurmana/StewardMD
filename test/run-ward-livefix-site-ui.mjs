/* test/run-ward-livefix-site-ui.mjs - live test LT-02 / LT-05 / LT-04 in a real headless Chrome, REAL ward.js and ward.css.
 *
 *   LT-02  clicking a free bed brings the admit form to the nurse: in view, MRN box focused
 *   LT-05  after admitting, the ward list opens ON the admitted patient, the "Admitted" note is shown, the address is #/ward
 *   LT-04  the ward home tells an admin the rota has no shifts, and the button goes to Staff rota
 *
 * test/ward-livefix-site-harness.html stubs only the network (16 wards, a 70-patient ward list).
 *   node test/run-ward-livefix-site-ui.mjs   (CHROME=<path> to override)
 */
import { launch } from "./wardsynq-site-cdp.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
  const p = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://localhost").pathname)));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try { const body = await readFile(p); res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const URL_ = "http://localhost:" + server.address().port + "/test/ward-livefix-site-harness.html#/ward/board";

let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const b = await launch({ port: Number(process.env.CDP_PORT || 9484), width: 1200, height: 760 });
const { ev, until, nav } = b;
const inView = (sel) => `var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; var r=e.getBoundingClientRect(); return (r.top >= 0 && r.top < innerHeight - 40) || null;`;
try {
  await nav(URL_);
  ok(await until(`return window.__ready || null;`, 10000), "real ward.js loaded");
  await ev(`window.WARD.open({ orgId: "org-harness", act: "board" }); return 1;`);
  ok(await until(`return document.querySelectorAll('.w-bedcell.free').length > 100 || null;`, 8000), "the bed board shows 16 wards of free beds");

  // Scroll the board a little (the nurse found her ward), then pick a free bed in the 3rd ward.
  await ev(`var c=document.getElementById('wCanvas'); var cell=document.querySelector('[data-w-act="pickbed:W03|W03-05"]'); cell.scrollIntoView({block:"center"}); return c ? c.scrollTop : -1;`);
  await ev(`document.querySelector('[data-w-act="pickbed:W03|W03-05"]').click(); return 1;`);
  ok(await until(`return document.getElementById('wAdmitPanel') || null;`, 4000), "picking the bed opens the admit panel");
  ok(await until(inView("#wAdmitPanel"), 3000), "LT-02: the admit panel is on screen, not 2000 px below: top " + await ev(`var e=document.getElementById('wAdmitPanel'); return e && Math.round(e.getBoundingClientRect().top)`));
  ok(await ev(`return document.activeElement && document.activeElement.id === "wAdmitMrn" || null;`), "LT-02: the MRN box has the cursor");
  const below = await ev(`var p=document.getElementById('wAdmitPanel'), w=document.querySelector('[data-w-act="pickbed:W04|W04-01"]'); return p.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : 0;`);
  ok(below === 1, "LT-02: the panel sits above the next ward");

  await ev(`document.getElementById('wAdmitMrn').value = 'SMD-QA-01'; document.querySelector('[data-w-act="mrnlookup"]').click(); return 1;`);
  ok(await until(`return document.querySelector('[data-w-act="admitconfirm"]') || null;`, 4000), "the MRN lookup names the patient");
  ok(await until(inView('[data-w-act="admitconfirm"]'), 3000), "the confirm button is still where the nurse is");
  // The type is chosen AFTER Find: it must still be sent.
  await ev(`var s=document.getElementById('wAdmitClass'); s.value='ICU'; s.dispatchEvent(new Event('change',{bubbles:true})); return 1;`);
  await ev(`document.querySelector('[data-w-act="admitconfirm"]').click(); return 1;`);
  ok(await until(`return document.querySelector('[data-w-act="open:enc-qa-01"]') || null;`, 6000), "after admitting, the ward list holds the admitted patient");
  const admit = await ev(`var c=window.__calls.filter(function(x){return x.url.indexOf('/ward/admit')>=0}); return JSON.stringify(c[c.length-1].body);`);
  ok(/"class":"ICU"/.test(admit) && /"bed":"W03-05"/.test(admit), "LT-05: the admission type picked after Find is sent: " + admit);
  ok(await until(inView('[data-w-act="open:enc-qa-01"]'), 3000), "LT-05: the list opens on the admitted patient's row, not mid-page: top " + await ev(`var e=document.querySelector('[data-w-act="open:enc-qa-01"]'); return e && Math.round(e.getBoundingClientRect().top)`));
  ok(await ev(`return /Admitted to W03, bed W03-05\\./.test(document.getElementById('smdWard').textContent) || null;`), "LT-05: the Admitted note is on screen");
  ok(await ev(`return location.hash === "#/ward" || null;`), "LT-05: the address says #/ward, got " + await ev(`return location.hash`));
  await new Promise((r) => setTimeout(r, 600));
  ok(await ev(inView('[data-w-act="open:enc-qa-01"]')), "LT-05: still on the admitted row after the ward home's late loads");

  // LT-04: this harness's rota has no shifts; the shell says this viewer can change it.
  ok(await until(`return document.getElementById('wCoverSetup') || null;`, 4000), "LT-04: the ward home tells the admin what to set up");
  ok(await ev(`return /The staff rota has no shifts/.test(document.getElementById('wCoverSetup').textContent) || null;`), "LT-04: in words: define shifts");
  await ev(`document.querySelector('[data-w-act="openrota"]').click(); return 1;`);
  ok(await until(`return window.__went === "rota" || null;`, 2000), "LT-04: the button opens Staff rota");
  const excs = b.consoleLines.filter((l) => /^EXC/.test(l));
  ok(!excs.length, "no uncaught page exceptions " + excs.join(" | "));
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { b.close(); server.close(); }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
