/* test/run-ref-ui.mjs - ICD Search and Scheme Search in their 2026-11 look (flag smd_ref_ui2, ref-ui.js +
 * ref-ui.css), on the REAL icd.js / govschemes.js in headless Chrome at phone size, against a fake of
 * /api/icd and /api/schemes that filters, pages and fails on demand (test/ref-ui-harness.html).
 *
 * Covers what unit tests cannot: every state of both screens (hint, loading, results, nothing found,
 * service down and its Try again), the clear button, the code-system switch keeping the field focused,
 * picker mode handing the row back, copy, the whole Browse drill-down and its Back steps, Search, Compare,
 * the package detail with its unverified warning, the flag-off fallback to the earlier screens, and
 * layout: nothing past the right edge, 44px targets, a name on every control, at 320 and 390 wide,
 * light and dark.
 *
 *   node test/run-ref-ui.mjs        CHROME=/path/to/chrome  CHROME_FLAGS="--no-sandbox"
 * Screenshots: test-output/ref-*.png
 */
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, "..");
if (!process.env.CHROME) process.env.CHROME = ["/opt/pw-browsers/chromium", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => existsSync(p)) || "";
if (process.env.CHROME_FLAGS == null && process.platform === "linux") process.env.CHROME_FLAGS = "--no-sandbox --disable-dev-shm-usage";
const { launch } = await import("./wardsynq-site-cdp.mjs");

const PORT = Number(process.env.REF_UI_PORT || 8819), BASE = `http://localhost:${PORT}`;
const OUT = join(ROOT, "test-output"); mkdirSync(OUT, { recursive: true });
const server = spawn("node", [join(HERE, "serve.mjs"), ROOT, String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 40; i++) { try { await fetch(BASE + "/ref-ui.css"); break; } catch { await sleep(150); } }

let fails = 0;
const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra == null ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
let b;
const J = (s) => JSON.stringify(s);
const txt = (sel) => b.ev(`var e=document.querySelector(${J(sel)}); return e?e.innerText:null;`);
const has = (sel) => b.ev(`return !!document.querySelector(${J(sel)});`);
const click = (sel) => b.ev(`var e=document.querySelector(${J(sel)}); if(!e) return 'no '+${J(sel)}; e.click(); return 1;`);
const clickText = (sel, re) => b.ev(`var e=[].slice.call(document.querySelectorAll(${J(sel)})).filter(function(x){return ${re}.test(x.innerText);})[0]; if(!e) return 'none'; e.click(); return 1;`);
const type = (sel, v) => b.ev(`var e=document.querySelector(${J(sel)}); if(!e) return 'no input'; e.focus(); e.value=${J(v)}; e.dispatchEvent(new Event('input')); return 1;`);
const setSize = (w, h) => b.call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true });
const shot = async (n) => { await sleep(320); await b.shot(join(OUT, "ref-" + n + ".png")); };  // past the 220ms entrance and 120ms colour changes
/* Layout facts about the open overlay: anything past the right edge, any control under 44px, any control
 * with no name. A checkbox is measured through its label. */
const audit = (id) => b.ev(`
  var W = innerWidth, wide = [], small = [], unnamed = [];
  var root = document.getElementById(${J(id)});
  root.querySelectorAll('*').forEach(function (e) { var r = e.getBoundingClientRect(); if (r.width && r.right > W + 1) wide.push((e.className.baseVal || e.className || e.tagName) + ' ' + Math.round(r.right)); });
  root.querySelectorAll('button, input, select, a').forEach(function (e) {
    var box = e.type === 'checkbox' ? e.closest('label') : e;
    var r = box.getBoundingClientRect(); if (!r.width || !r.height) return;
    var label = (e.id || e.className || e.tagName);
    if (r.height < 43.5 || (r.width < 43.5 && e.tagName !== 'A')) small.push(label + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    var name = e.getAttribute('aria-label') || e.textContent.trim() || e.getAttribute('placeholder') || (box !== e ? box.textContent.trim() : '');
    if (!name) unnamed.push(label);
  });
  return JSON.stringify({ wide: wide.slice(0, 6), small: small.slice(0, 8), unnamed: unnamed, sw: document.documentElement.scrollWidth, w: W });`).then(JSON.parse);
const clean = async (id, label) => { const a = await audit(id); ok(!a.wide.length && a.sw <= a.w, label + ": nothing past the right edge", a.wide); ok(!a.small.length, label + ": every control is at least 44px", a.small); ok(!a.unnamed.length, label + ": every control has a name", a.unnamed); };
const dark = (on) => b.ev(`document.body.classList.toggle('dark', ${on}); return 1;`);

try {
  // ---- 0. the stylesheet keeps its own rule: no raw colour outside the palette block ----
  const css = readFileSync(join(ROOT, "ref-ui.css"), "utf8");
  const after = css.split("end palette")[1] || "";
  ok(after.length > 2000 && !/#[0-9a-fA-F]{3,8}\b/.test(after) && !/rgba?\(/.test(after), "ref-ui.css: tokens only below the palette block");
  ok(!/—/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")) , "ref-ui.css: no em-dash outside comments");

  b = await launch({ port: Number(process.env.CDP_PORT || 9519), mobile: true });
  await setSize(390, 844);
  await b.nav(BASE + "/test/ref-ui-harness.html");
  ok(await b.until("return window.__ready", 10000), "icd.js, govschemes.js and ref-ui.js loaded");
  await b.ev("localStorage.clear(); document.fonts && await document.fonts.ready; return 1;");

  // ================= ICD Search =================
  await b.ev("SMD_ICD.open(); return 1;");
  ok(await has("#icdOverlay.on.r2"), "ICD: opens in the 2026-11 look (.r2)");
  ok((await b.ev(`return document.getElementById('icdBack').getAttribute('aria-label');`)) === "Back", "ICD: Back keeps aria-label Back (swipe-back)");
  ok(/Look up a diagnosis code/.test(await txt("#icdResults")), "ICD: the hint says what to do");
  ok((await b.ev("return document.querySelectorAll('#icdResults .r2-chip').length;")) === 3, "ICD: three example searches");
  ok(await b.ev("return document.querySelector('.r2-clear').hidden;"), "ICD: no clear button on an empty field");
  ok(await b.until("return document.activeElement && document.activeElement.id==='icdSearch'", 2000), "ICD: the field has focus on open");
  await clean("icdOverlay", "ICD hint 390");
  await shot("icd-hint");

  // loading rows, then results
  await b.ev("window.__delay = 400; return 1;");
  await clickText("#icdResults .r2-chip", "/diabetes/");
  ok((await b.ev("return document.getElementById('icdSearch').value;")) === "diabetes", "ICD: an example fills the field");
  ok(await has("#icdResults .r2-sk[aria-busy=true]"), "ICD: loading rows while the search is open");
  ok(await b.until("return document.querySelectorAll('#icdResults .r2-list .icd-card').length===6", 4000), "ICD: six matches for diabetes, in one grouped list");
  await b.ev("window.__delay = 0; return 1;");
  ok(!(await b.ev("return document.querySelector('.r2-clear').hidden;")), "ICD: the clear button shows once there is text");
  const row = await txt("#icdResults .icd-card");
  ok(/Type 2 diabetes mellitus/.test(row) && /E11/.test(row) && /ICD-10/.test(row), "ICD: a row shows name, code and system", row);
  await clean("icdOverlay", "ICD results 390");
  await shot("icd-results");

  // system switch: in place, focus kept
  await clickText(".icd-sys", "/^ICD-11$/");
  ok(await b.until("return document.querySelectorAll('#icdResults .icd-card').length===2", 3000), "ICD: ICD-11 narrows to its two matches");
  ok(await b.ev("return document.activeElement && document.activeElement.id==='icdSearch'"), "ICD: switching system keeps the field focused");
  ok((await b.ev(`return document.querySelector('.icd-sys.on').getAttribute('aria-pressed');`)) === "true" && (await b.ev("return document.querySelectorAll('.icd-sys[aria-pressed=true]').length;")) === 1, "ICD: one system marked pressed");
  ok((await b.ev("return window.__haps.indexOf('selection')>=0;")), "ICD: a selection tick on the switch");

  // nothing found
  await type("#icdSearch", "zzzz");
  ok(await b.until("return /No code matches/.test(document.getElementById('icdResults').innerText)", 3000), "ICD: nothing found says so");
  ok(/ICD-11 only/.test(await txt("#icdResults")), "ICD: and says the search is limited to ICD-11");
  await shot("icd-empty");
  await clickText(".icd-sys", "/^Both$/");

  // service down, then Try again
  await b.ev("window.__down = true; return 1;");
  await type("#icdSearch", "chol");
  ok(await b.until("return !!document.querySelector('#icdResults .icd-err[role=alert]')", 3000), "ICD: a dead network shows an alert");
  await clean("icdOverlay", "ICD error 390");
  await shot("icd-error");
  await b.ev("window.__down = false; return 1;");
  await click('#icdResults [data-r2="retry"]');
  ok(await b.until("return document.querySelectorAll('#icdResults .icd-card').length===1", 3000), "ICD: Try again loads the result");

  // clear
  await click(".r2-clear");
  ok((await b.ev("return document.getElementById('icdSearch').value;")) === "" && /Look up a diagnosis code/.test(await txt("#icdResults")), "ICD: clear empties the field and brings the hint back");

  // detail + copy
  await type("#icdSearch", "E11");
  await b.until("return document.querySelectorAll('#icdResults .icd-card').length===2", 3000);
  await click("#icdResults .icd-card");
  ok(await b.until("return !!document.querySelector('#icdBody .icd-dhead')", 3000), "ICD: a row opens its detail");
  const dt = await txt("#icdBody");
  ok(/E11/.test(dt) && /Type 2 diabetes mellitus/.test(dt) && /WHO ICD-10/.test(dt), "ICD detail: code, name and source", dt);
  await click('#icdBody [data-r2="copy"]');
  ok(await b.until("return window.__copied[0]==='E11 - Type 2 diabetes mellitus'", 2000), "ICD detail: copies CODE - Title");
  ok(/Copied/.test(await txt('#icdBody [data-r2="copy"]')), "ICD detail: the button says Copied");
  await clean("icdOverlay", "ICD detail 390");
  await shot("icd-detail");
  await click("#icdBack");
  ok(await has("#icdSearch") && (await b.ev("return document.getElementById('icdSearch').value;")) === "E11", "ICD: Back returns to the list with the search kept");
  await click("#icdBack");
  ok(!(await has("#icdOverlay.on")), "ICD: Back from the list closes the screen");

  // picker mode
  await b.ev("window.__picked = null; SMD_ICD.pick(function (r) { window.__picked = r; }); return 1;");
  ok(/Pick an ICD code/.test(await txt("#icdTitle")), "ICD picker: the title says pick");
  await b.until("return document.querySelectorAll('#icdResults .icd-card').length===2", 3000);
  ok(await has("#icdResults .icd-card .r2-plus"), "ICD picker: rows carry the add mark, not the open mark");
  await shot("icd-picker");
  await click("#icdResults .icd-card");
  ok((await b.ev("return window.__picked && window.__picked.code;")) === "E11" && !(await has("#icdOverlay.on")), "ICD picker: a tap hands the row back and closes");

  // narrow + dark + long title
  await setSize(320, 640);
  await b.ev("SMD_ICD.open(); return 1;");
  await type("#icdSearch", "pregnancy");
  await b.until("return document.querySelectorAll('#icdResults .icd-card').length===1", 3000);
  await clean("icdOverlay", "ICD long title 320");
  await dark(true);
  await shot("icd-dark-320");
  await clean("icdOverlay", "ICD dark 320");
  await dark(false);
  await b.ev("SMD_ICD.close(); return 1;");
  await setSize(390, 844);

  // ================= Scheme Search =================
  await b.ev("SMD_GOVSCHEMES.open(); return 1;");
  ok(await has("#gsOverlay.on.r2"), "Schemes: opens in the 2026-11 look (.r2)");
  ok(await b.until("return document.querySelectorAll('#gsBrowseList .r2-list .gs-cat').length===4", 3000), "Schemes: Browse lists the four states in one grouped list");
  ok(/Andhra Pradesh/.test(await txt("#gsBrowseList .gs-cat")) && /3,713/.test(await txt("#gsBrowseList .gs-cat")), "Schemes: a state row shows its name and package count");
  await clean("gsOverlay", "Schemes states 390");
  await shot("gs-states");

  await type("#gsBrowseFilter", "bih");
  ok(await b.until("return document.querySelectorAll('#gsBrowseList .gs-cat').length===1", 2000), "Schemes: the filter narrows the states");
  await type("#gsBrowseFilter", "qqq");
  ok(await b.until("return /No state or UT matches/.test(document.getElementById('gsBrowseList').innerText)", 2000), "Schemes: a filter with no match says so");
  await click("#gsBrowse .r2-clear");
  ok(await b.until("return document.querySelectorAll('#gsBrowseList .gs-cat').length===4", 2000), "Schemes: clear brings every state back");

  // AP has two schemes -> scheme level
  await clickText("#gsBrowseList .gs-cat", "/Andhra/");
  ok(await b.until("return document.querySelectorAll('#gsBrowseList .r2-list .gs-schemecard').length===2", 3000), "Schemes: a state with two schemes lists them");
  ok(/Andhra Pradesh\s*›\s*Scheme/.test(await txt(".gs-crumbs")), "Schemes: the trail shows the state and names the level", await txt(".gs-crumbs"));
  await clean("gsOverlay", "Schemes schemes 390");
  await shot("gs-schemes");
  await clickText("#gsBrowseList .gs-schemecard", "/NTR/");
  ok(await b.until("return document.querySelectorAll('#gsBrowseList .gs-cat').length===4", 3000), "Schemes: categories, with All categories first");
  ok(/All categories/.test(await txt("#gsBrowseList .gs-cat")), "Schemes: All categories leads");
  await clean("gsOverlay", "Schemes categories 390");
  ok(await b.ev("var c=document.querySelector('.gs-crumbs').getBoundingClientRect(); return c.height < 50;"), "Schemes: the trail stays on one line");
  await shot("gs-categories");
  await clickText("#gsBrowseList .gs-cat", "/General Surgery/");
  ok(await b.until("return document.querySelectorAll('#gsBrowseList .r2-list .gs-card').length===40", 3000), "Schemes: the first 40 packages");
  ok(/Showing 40 of 85 packages/.test(await txt(".r2-countline")), "Schemes: says how many are shown", await txt(".r2-countline"));
  const prow = await txt("#gsBrowseList .gs-card");
  ok(/Modified radical mastectomy/.test(prow) && /₹25,000/.test(prow) && /Tier 2/.test(prow) && /SG075B/.test(prow), "Schemes: a package row shows name, amount, tier and code", prow);
  ok(/Amount not stated/.test(await b.ev("return document.querySelectorAll('#gsBrowseList .gs-card')[2].innerText;")), "Schemes: a zero amount reads Amount not stated, never 0");
  ok(/tier not stated/.test(await b.ev("return document.querySelectorAll('#gsBrowseList .gs-card')[3].innerText;")), "Schemes: a missing tier is said, not hidden");
  await clean("gsOverlay", "Schemes packages 390");
  await shot("gs-packages");
  await click("#gsMore");
  ok(await b.until("return document.querySelectorAll('#gsBrowseList .gs-card').length===80", 3000), "Schemes: Show more adds the next page");

  // detail
  await click("#gsBrowseList .gs-card");
  ok(await b.until("return !!document.querySelector('#gsBody .gs-dhead')", 3000), "Schemes: a package opens its detail");
  const pd = await txt("#gsBody");
  ok(/Unverified government reference data/.test(pd), "Schemes detail: the unverified warning is shown");
  ok(/₹25,000/.test(pd) && /Tier 2/.test(pd) && /SG075B/.test(pd) && /Required/.test(pd) && /5 days/.test(pd), "Schemes detail: amount, tier, code, pre-authorisation and stay", pd.slice(0, 300));
  ok(await has("#gsBody .gs-kv.long"), "Schemes detail: a long value sits under its label");
  await clean("gsOverlay", "Schemes detail 390");
  await shot("gs-detail");
  await b.ev("document.getElementById('gsBody').scrollTop = 99999; return 1;");
  await shot("gs-detail-end");
  await click("#gsBack");
  ok(await b.until("return document.querySelectorAll('#gsBrowseList .gs-card').length===80", 3000), "Schemes: Back returns to the loaded list");
  await click("#gsBack");
  ok(await b.until("return document.querySelectorAll('#gsBrowseList .gs-schemecard').length===2", 3000), "Schemes: Back again returns to the schemes");
  await click("#gsBack");
  ok(await b.until("return document.querySelectorAll('#gsBrowseList .gs-cat').length===4 && !document.querySelector('.gs-crumbs')", 3000), "Schemes: Back again returns to the states");

  // Search tab
  await clickText(".gs-tab", "/^Search$/");
  ok(/Search every scheme package/.test(await txt("#gsResults")), "Schemes search: the hint says what to type");
  await clean("gsOverlay", "Schemes search hint 390");
  await shot("gs-search-hint");
  await type("#gsSearch", "mastectomy");
  ok(await b.until("return document.querySelectorAll('#gsResults .r2-list .gs-card').length===1", 3000), "Schemes search: one match for mastectomy");
  ok(/Bihar/.test(await txt("#gsResults .gs-card")), "Schemes search: results carry their state");
  await shot("gs-search");
  await type("#gsSearch", "qqqq");
  ok(await b.until("return /No package matches/.test(document.getElementById('gsResults').innerText)", 3000), "Schemes search: nothing found says so");
  await b.ev("window.__down = true; return 1;");
  await type("#gsSearch", "mast");
  ok(await b.until("return !!document.querySelector('#gsResults .gs-err[role=alert]')", 3000), "Schemes search: a dead network shows an alert");
  await shot("gs-error");
  await b.ev("window.__down = false; return 1;");
  await click('#gsResults [data-r2="retry"]');
  ok(await b.until("return document.querySelectorAll('#gsResults .gs-card').length===1", 3000), "Schemes search: Try again loads the result");

  // Compare
  await click("#gsCmp");
  ok(await b.until("return document.querySelectorAll('#gsResults .gs-cmprow').length===2", 3000), "Schemes compare: two states side by side");
  ok(await b.ev("return document.getElementById('gsState').disabled;"), "Schemes compare: the state filter is off while comparing");
  const cmp = await txt("#gsResults");
  ok(/₹31,500/.test(cmp) && /tier not stated/.test(cmp), "Schemes compare: each row keeps its tier next to its amount", cmp);
  await clean("gsOverlay", "Schemes compare 390");
  await shot("gs-compare");
  await click("#gsCmp");

  // narrow + dark
  await setSize(320, 640);
  await type("#gsSearch", "lap");
  ok(await b.until("return /Laparoscopic/.test(document.getElementById('gsResults').innerText)", 3000), "Schemes search: the long-named package is found");
  await clean("gsOverlay", "Schemes long name 320");
  await dark(true);
  await clean("gsOverlay", "Schemes dark 320");
  await shot("gs-dark-320");
  await click("#gsResults .gs-card");
  await b.until("return !!document.querySelector('#gsBody .gs-dhead')", 3000);
  await clean("gsOverlay", "Schemes detail dark 320");
  await shot("gs-detail-dark-320");
  await dark(false);
  await b.ev("SMD_GOVSCHEMES.close(); return 1;");
  await setSize(390, 844);

  // ================= flag off: the earlier screens, untouched =================
  await b.ev("localStorage.setItem('smd_ref_ui2','0'); SMD_ICD.open(); return 1;");
  await type("#icdSearch", "");
  await b.until("return /Type a diagnosis name/.test(document.getElementById('icdResults').innerText)", 2000);
  ok(await has("#icdOverlay.on") && !(await has("#icdOverlay.r2")), "Flag off: ICD opens without .r2");
  ok((await txt("#icdBack")) === "‹ Back" && /Type a diagnosis name or an ICD-10\/ICD-11 code/.test(await txt("#icdResults")) && !(await has("#icdOverlay .r2-clear")), "Flag off: ICD shows the earlier bar, hint and field");
  await type("#icdSearch", "E11");
  ok(await b.until("return document.querySelectorAll('#icdResults > .icd-card').length===2", 3000), "Flag off: ICD results are the earlier cards");
  await shot("icd-flag-off");
  await b.ev("SMD_ICD.close(); SMD_GOVSCHEMES.open(); return 1;");
  ok(await has("#gsOverlay.on") && !(await has("#gsOverlay.r2")) && (await txt("#gsBack")) === "‹ Back", "Flag off: Schemes opens without .r2");
  await clickText(".gs-tab", "/^Browse$/");
  ok(await b.until("return document.querySelectorAll('#gsBrowseList .gs-cat-grid:not(.r2-list) .gs-cat').length===4", 3000) && /3,713 packages/.test(await txt("#gsBrowseList .gs-cat")), "Flag off: Schemes shows the earlier state grid");
  await b.ev("SMD_GOVSCHEMES.close(); localStorage.removeItem('smd_ref_ui2'); return 1;");

  const errs = await b.ev("return JSON.stringify(window.__errs);").then(JSON.parse);
  ok(!errs.length, "no script errors", errs);
  console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
} catch (e) {
  console.log("FAIL harness error: " + (e && e.stack || e)); fails++;
} finally {
  try { b && b.close(); } catch {} try { server.kill(); } catch {}
  process.exit(fails ? 1 : 0);
}
