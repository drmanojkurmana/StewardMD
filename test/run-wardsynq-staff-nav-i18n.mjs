/* test/run-wardsynq-staff-nav-i18n.mjs - real headless Chrome, desktop width, the staff shell's
 * navigation-language picker (owner decision 2026-09-15: NAVIGATION LABELS ONLY - shell nav items and
 * Admin Center tab names; every clinical/admin screen stays English).
 *
 *   node test/run-wardsynq-staff-nav-i18n.mjs        (CHROME=<path> to override; SHOTS=<dir> for screenshots)
 *
 * Serves the real wardsynq.com static bundle (index.html, shell.js, i18n.js, the real
 * wardsynq/site/i18n/te.js...) from this repo, with /api/queue/* answered by a fixture server - no
 * backend, no wrangler, no Firebase needed: the session is a staff token dropped into localStorage
 * before shell.js's own boot() reads it, exactly the way a returning staff device would have one.
 */
import { launch } from "./wardsynq-site-cdp.mjs";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };
const SHOTS = process.env.SHOTS || (process.env.CLAUDE_JOB_DIR || "/tmp") + "/staff-nav-i18n-shots";
await mkdir(SHOTS, { recursive: true });

const WHOAMI = { ok: true, role: "admin", orgId: "org-t", caps: ["queue.view", "staff.admin", "emr.view", "billing.view"], name: "Test Admin" };
const ORG = { ok: true, org: { id: "org-t", name: "Test Hospital", code: "SMD-TEST01", mode: "wardsynq", connectTenantId: "none" }, wards: [], departments: [], rooms: [] };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/queue/whoami") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(WHOAMI)); return; }
  if (url.pathname === "/api/queue/org") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(ORG)); return; }
  // Every other /api/queue/* route (the home map's live badge counts) - shape doesn't matter here.
  if (url.pathname.startsWith("/api/queue")) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, patients: [], wards: [], loops: [] })); return; }
  const p = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try { const b = await readFile(p); res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const BASE = "http://localhost:" + server.address().port;

const results = [];
// 1280x900: desktop width, well past the 860px breakpoint that hides .rail.
const b = await launch({ port: Number(process.env.CDP_PORT || 9492), width: 1280, height: 900 });
const { ev, until, nav, call } = b;
async function step(name, fn) {
  try { const r = await fn(); results.push([r === true ? "PASS" : "FAIL", name, r === true ? "" : String(r)]); }
  catch (e) { results.push(["FAIL", name, String(e && e.message || e)]); }
  const last = results[results.length - 1]; console.log(last[0], name, last[2]);
}
// A staff session, as if this device had signed in before - shell.js's boot() reads it on load.
const PRELOAD = `localStorage.setItem('smd_opd_toktype','staff'); localStorage.setItem('smd_opd_staff_tok','tok-1'); localStorage.setItem('smd_opd_hospital','org-t');`;

try {
  await call("Page.addScriptToEvaluateOnNewDocument", { source: PRELOAD });
  await nav(BASE + "/wardsynq/site/index.html");

  await step("the shell lands on the map with the rail and the language picker, all English by default", async () =>
    (await until(`return (document.querySelector('.rail a[href="#/audit"]') && document.getElementById('navLangPick')) ? 'y' : '';`, 15000)) === "y" || "never reached the map");

  await step("English by default: the rail link and the Admin tile both read the same English text", async () => ev(`
    var rail = document.querySelector('.rail a[href="#/audit"]');
    var tile = document.querySelector('[data-go="audit"] b');
    if (!rail || rail.textContent !== 'Audit and security') return 'rail link is not plain English';
    if (!tile || tile.textContent !== 'Audit and security') return 'tile heading is not plain English';
    return true;`));

  await step("the picker offers all nine languages by native name, English selected", async () => ev(`
    var s = document.getElementById('navLangPick');
    var names = Array.prototype.map.call(s.options, function (o) { return o.value; });
    var want = ['en','es','te','hi','bn','kn','ta','ml','mr'];
    for (var i = 0; i < want.length; i++) if (names.indexOf(want[i]) < 0) return 'missing ' + want[i];
    return s.value === 'en' ? true : 'not English by default: ' + s.value;`));

  await step("picking Telugu loads the real i18n/te.js and translates the rail link, live", async () => {
    await ev(`var s = document.getElementById('navLangPick'); s.value = 'te'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1;`);
    const ok = await until(`
      var rail = document.querySelector('.rail a[href="#/audit"]');
      return (rail && rail.textContent === 'ఆడిట్ మరియు భద్రత' && document.querySelector('script[src*="/wardsynq/site/i18n/te.js"]')) ? 'y' : '';`, 8000);
    return ok === "y" || "rail never switched to Telugu";
  });

  await step("the clinical tile heading beside it, and the page's own lang, are untouched", async () => ev(`
    var tile = document.querySelector('[data-go="audit"] b');
    if (!tile || tile.textContent !== 'Audit and security') return 'the tile heading changed - it must stay English';
    if (document.documentElement.lang !== 'en') return 'document.documentElement.lang must stay en: ' + document.documentElement.lang;
    var rail = document.querySelector('.rail');
    if (rail.getAttribute('lang') !== 'te') return 'the rail container should carry lang=te, the translated chrome only';
    return true;`));

  await step("Admin Center: the tab strip is in Telugu (catalogs are complete), never a raw key", async () => {
    await ev(`location.hash = '#/admin'; return 1;`);
    const ok = await until(`return document.querySelector('.tabs [data-tab="hospital"]') ? 'y' : '';`, 8000);
    if (ok !== "y") return "admin page never rendered";
    return ev(`
      var b = document.querySelector('.tabs [data-tab="hospital"]');
      if (b.textContent === 'Hospital' || !/[\\u0C00-\\u0C7F]/.test(b.textContent)) return 'expected the Telugu tab label, got: ' + b.textContent;
      if (/nav\\.admin/.test(b.textContent)) return 'a raw key leaked onto the screen';
      return true;`);
  });

  await b.shot(SHOTS + "/admin-telugu-nav.png");
  await step("no script errors on the page", async () => b.consoleLines.filter((l) => l.startsWith("EXC")).length === 0 || b.consoleLines.join(" | "));
} finally {
  b.close(); server.close();
}
const failed = results.filter((r) => r[0] !== "PASS");
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
