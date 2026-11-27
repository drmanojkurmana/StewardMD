/* NoteBook (Study Studio) regressions from the 2026-11-27 audit, driven with real mouse and keyboard input in the app
 * bundle (headless Chromium). What must hold:
 *  - the library is a PrepNucleus tab: one pn-bar titled NoteBook, the Documents/Search/Favourites segment, the
 *    PrepNucleus bottom nav visible, no navy/gold chrome;
 *  - typing in library search keeps focus and every letter;
 *  - a notebook opens with the pen on, and a mouse stroke is saved;
 *  - the editor's back pops the stack (no growth per open) and the system back closes the editor, leaving no
 *    editor chrome on the library; a lasso selection is dropped by back before the editor closes;
 *  - the text tool: tapping off a box ends typing without leaving an empty box; the format bar goes away;
 *  - a PDF offers no Add page, Copy, Rotate or Template; one open document shows no tab strip;
 *  - Lock editing refuses the pen; back climbs out of a folder before leaving NoteBook.
 * USAGE: node test/run-notebook-ui.mjs   (BASE=http://localhost:8998/ for a running server)
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { freePort } from "./free-port.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
let serveProc = null;
try { await fetch(BASE); } catch {
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8998"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}
function makePdf(pages = ["Cardiology notes: ventricular systole.", "Ventricular diastole."]) {
  const objs = [], n = pages.length, font = 3 + 2 * n;
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, k) => `${3 + 2 * k} 0 R`).join(" ")}] /Count ${n} >>`;
  objs[font] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((t, k) => { const po = 3 + 2 * k, s = `BT /F1 12 Tf 30 750 Td (${t}) Tj ET`;
    objs[po] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${po + 1} 0 R >>`;
    objs[po + 1] = `<< /Length ${s.length} >>\nstream\n${s}\nendstream`; });
  let out = "%PDF-1.4\n"; const offs = [];
  for (let i = 1; i < objs.length; i++) { offs[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const x = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + offs.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  return Buffer.from(out + `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`, "latin1");
}
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/api/**", (r) => r.fulfill({ status: 404, body: "{}" }));
await page.addInitScript(() => { window.SMD_PREP_SETUP = false; window.SMD_PREP_ONBOARD = false; window.confirm = () => true; window.prompt = () => "Cardiology"; });
await page.goto(BASE + "?prep=1&study=1", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!(window.PREP && window.SMD_showHome), null, { timeout: 30000 });
await page.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); PREP.open(); });
await page.waitForSelector("#smdPrep .pnv-tab", { timeout: 30000 });
await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("study"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));

const stackLen = () => page.evaluate(() => PREP._host.stack().length);
const sysBack = () => page.evaluate(() => PREP._host.back());
const ovBox = () => page.locator(".st-ov").first().boundingBox();
const strokes = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open("study"); r.onsuccess = () => { const q = r.result.transaction("strokes").objectStore("strokes").getAll(); q.onsuccess = () => { r.result.close(); res(q.result); }; }; }));
async function draw(x0, y0) { const b = await ovBox(); await page.mouse.move(b.x + x0, b.y + y0); await page.mouse.down(); for (let i = 1; i <= 16; i++) await page.mouse.move(b.x + x0 + i * 9, b.y + y0 + Math.sin(i / 3) * 14, { steps: 2 }); await page.mouse.up(); await sleep(350); }

/* ---- library is a PrepNucleus tab ---- */
await page.click('#smdPrep .pnv-tab[data-tab="study"]');
await page.waitForSelector("#stLib");
ok(await page.locator('#smdPrep .pnv-tab[data-tab="study"]').innerText() === "NoteBook", "nav: the tab is called NoteBook");
const head = await page.evaluate(() => ({ h1: (document.querySelector("#smdPrep > .pn-bar h1") || {}).textContent, seg: document.querySelectorAll("#smdPrep > .pn-seg .pn-chip").length, old: document.querySelectorAll(".st5a-top, .st5a-bottom").length, nav: !document.querySelector("#smdPrep .pnv").classList.contains("pnv-off") && getComputedStyle(document.querySelector("#smdPrep .pnv")).display !== "none" }));
ok(head.h1 === "NoteBook" && head.seg === 3 && head.old === 0 && head.nav, "library: PrepNucleus bar, segment and bottom nav, no own header or tab bar " + JSON.stringify(head));
ok(await page.evaluate(() => { const c = getComputedStyle(document.querySelector("#smdPrep")).getPropertyValue("--st-gold").trim(); return c === "" || !/c9a227/i.test(c); }), "skin: no gold token left");
const lib0 = await stackLen();

/* ---- search keeps focus and letters ---- */
await page.setInputFiles("#stFile", { name: "Cardio.pdf", mimeType: "application/pdf", buffer: makePdf() });
await page.waitForSelector(".st-doc", { timeout: 20000 });
await page.waitForFunction(() => new Promise((res) => { const r = indexedDB.open("study"); r.onsuccess = () => { const q = r.result.transaction("ptext").objectStore("ptext").getAll(); q.onsuccess = () => { r.result.close(); res(q.result.length >= 2); }; }; }), null, { timeout: 20000 });
await page.click('#smdPrep .pn-seg [data-v="search"]');
await page.click("#st5aSearchQ");
await page.keyboard.type("syst", { delay: 60 }); await sleep(500); await page.keyboard.type("ole", { delay: 60 }); await sleep(500);
const sq = await page.evaluate(() => ({ v: document.getElementById("st5aSearchQ").value, f: document.activeElement && document.activeElement.id }));
ok(sq.v === "systole" && sq.f === "st5aSearchQ", "search: every letter kept and focus stays while results update (" + JSON.stringify(sq) + ")");
ok(await page.locator(".st-hit").count() === 1, "search: one hit for systole");
await page.click(".st-hit"); await page.waitForSelector("#stPages"); await sleep(700);
ok(await stackLen() === lib0 + 1, "editor: opening pushes one screen");
ok(await page.locator("#stDocTabs").count() === 0, "editor: one open document shows no tab strip");
ok(await page.locator('#stP3Top [data-act="st-p3-add"]').count() === 0, "PDF: no Add page button");
await page.click('#stP3Top [data-act="st-p3-more"]'); await sleep(300);
ok(await page.locator('#stP3MoreSheet [data-act="st-p3-copy"], #stP3MoreSheet [data-act="st-p3-rotate"], #stP3MoreSheet [data-act="st-p3-change-tpl"]').count() === 0, "PDF: More has no Copy, Rotate or Template");
await sysBack(); await sleep(300);
ok(await page.locator("#stP3MoreSheet").count() === 0 && await page.locator("#stPages").count() === 1, "system back: closes the sheet first, editor stays");
await sysBack(); await sleep(700);
const back1 = await page.evaluate(() => ({ lib: !!document.querySelector("#smdPrep > #stLib"), top: document.querySelectorAll("#stP3Top, #stP3Pager").length, tab: (document.querySelector("#smdPrep > .pn-seg .pn-chip.on") || {}).textContent, q: (document.getElementById("st5aSearchQ") || {}).value, v: !!STUDY._state() }));
ok(back1.lib && back1.top === 0 && !back1.v, "system back: editor released, no editor bar or pager left on the library " + JSON.stringify(back1));
ok(back1.tab === "Search" && back1.q === "systole", "back from a search hit returns to the results");
ok(await stackLen() === lib0, "system back: the stack is back to the library");

/* ---- notebook: pen on, stroke saved, back button pops ---- */
await page.click('#smdPrep > .pn-bar [data-act="st5a-new"]');
await page.click('[data-act="st5a-new-notebook"]');
await page.fill("#st5aNbT", "Ward");
await page.click('[data-act="st5a-mknb"]');
await page.waitForSelector("#stPages"); await sleep(700);
ok(await page.evaluate(() => STUDY._state().tool) === "pen", "notebook: opens with the pen");
await draw(40, 90); await draw(40, 190);
ok((await strokes()).filter((s) => !s.gone).length === 2, "notebook: two mouse strokes saved");
/* lasso + back */
await page.click('#stTb [data-v="lasso"]');
let b = await ovBox();
await page.mouse.move(b.x + 20, b.y + 160); await page.mouse.down();
for (const [x, y] of [[250, 160], [250, 230], [20, 230], [20, 160]]) await page.mouse.move(b.x + x, b.y + y, { steps: 6 });
await page.mouse.up(); await sleep(500);
ok(await page.evaluate(() => !!STUDY._state().lasso), "lasso: one stroke selected");
await sysBack(); await sleep(300);
ok(await page.evaluate(() => !!STUDY._state() && !STUDY._state().lasso), "system back: drops the lasso selection, editor stays");
/* text tool */
await page.click('#stTb [data-v="text"]'); b = await ovBox();
await page.mouse.click(b.x + 80, b.y + 320); await sleep(400);
await page.keyboard.type("Hello", { delay: 20 });
await page.mouse.click(b.x + 280, b.y + 420); await sleep(500);
await page.mouse.click(b.x + 100, b.y + 450); await sleep(400);
await page.mouse.click(b.x + 250, b.y + 40); await sleep(600);
const its = await page.evaluate(() => STUDY._state().items.filter((i) => !i.gone).map((i) => i.data && i.data.text));
ok(its.length === 1 && its[0] === "Hello", "text: tap-off ends typing; an empty box is not kept (" + JSON.stringify(its) + ")");
ok(await page.locator("#stFormatBar").count() === 0, "text: format bar gone once typing ends");
/* lock */
await page.evaluate(() => { const v = STUDY._state(); v.doc.settings = Object.assign({}, v.doc.settings, { lock: true }); });
await page.click('#stTb [data-v="pen"]'); await sleep(200);
ok(await page.evaluate(() => STUDY._state().tool) !== "pen", "lock: the pen is refused while locked");
await page.evaluate(() => { const v = STUDY._state(); v.doc.settings.lock = false; });
await page.click('#stP3Top [data-act="st-p3-back"]'); await sleep(700);
ok(await page.locator("#smdPrep > #stLib").count() === 1 && await stackLen() === lib0 && await page.locator("#stP3Top").count() === 0, "back button: pops to the library, stack not grown");

/* ---- folder: back climbs out first ---- */
await page.click('#smdPrep > .pn-seg [data-v="documents"]').catch(() => {});
await page.click('#smdPrep > .pn-bar [data-act="st5a-libmore"]'); await page.click('#st5aSheet [data-act="st5a-new-folder"]'); await sleep(500);
await page.locator(".st5a-card", { hasText: "Cardiology" }).locator(".st5a-cover").click(); await sleep(400);
ok(await page.evaluate(() => STUDY_LIB._state().currentFolderId != null), "folder: opened");
await sysBack(); await sleep(400);
ok(await page.locator("#smdPrep > #stLib").count() === 1 && await page.evaluate(() => STUDY_LIB._state().currentFolderId == null), "system back: leaves the folder, stays in NoteBook");

ok(errors.length === 0, "no uncaught page error " + errors.join(" | "));
await browser.close(); if (serveProc) serveProc.kill();
console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
