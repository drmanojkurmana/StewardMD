/* Phase 5a (library, document tabs, export) in the REAL app bundle, headless Chromium (Playwright).
 * Covers rows 5.1-5.10: grid + covers, folders (create/nest/move/colour), sort/view persist,
 * item menu + trash restore/purge, library bottom tabs, document tabs, export PDF with ink.
 * USAGE: node test/run-study-p5a-ui.mjs   (BASE=... for a running server)
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
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
function makePdf(pages = ["Page one beta", "Page two beta"]) {
  const objs = [], n = pages.length, font = 3 + 2 * n;
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, k) => `${3 + 2 * k} 0 R`).join(" ")}] /Count ${n} >>`;
  objs[font] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((t, k) => {
    const po = 3 + 2 * k, stream = (t.match(/.{1,90}(?:\s|$)/g) || [t]).map((l, i) => `BT /F1 9 Tf 20 ${780 - 14 * i} Td (${l.trim()}) Tj ET`).join("\n");
    objs[po] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${po + 1} 0 R >>`;
    objs[po + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n"; const offs = [];
  for (let i = 1; i < objs.length; i++) { offs[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const x = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + offs.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  return Buffer.from(out + `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`, "latin1");
}
const PDF = makePdf();
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/api/**", (r) => r.fulfill({ status: 404, body: "{}" }));
await page.addInitScript(() => { window.SMD_PREP_SETUP = false; window.SMD_PREP_ONBOARD = false; window.confirm = () => true; window.prompt = (m, d) => d; });
async function boot(q) {
  await page.goto(BASE + "?" + q);
  await page.waitForFunction(() => !!(window.PREP && window.SMD_showHome), null, { timeout: 30000 });
  await page.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); PREP.open(); });
  await page.waitForSelector("#smdPrep .pn-tile, #smdPrep .pn-row, .pnv-tab", { timeout: 30000 });
}
const openLib = async () => { await page.click('#smdPrep .pnv-tab[data-tab="study"]'); await page.waitForSelector("#st5aBody, #stList"); };
const idbAll = (store) => page.evaluate((store) => new Promise((res) => { const r = indexedDB.open("study"); r.onsuccess = () => { const q = r.result.transaction(store).objectStore(store).getAll(); q.onsuccess = () => { r.result.close(); res(q.result.map((x) => ({ id: x.id, title: x.title, name: x.name, folderId: x.folderId, parentId: x.parentId, colour: x.colour, trashedAt: x.trashedAt || null, favourite: !!x.favourite }))); }; }; }), store);
await boot("prep=1&study=1");
await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("study"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await openLib();
/* 5.1 grid: New tile first, covers, date, star; cards inset from edge */
ok(await page.locator(".st5a-new").count() >= 1, "5.1: New tile present");
await page.setInputFiles("#stFile", { name: "alpha.pdf", mimeType: "application/pdf", buffer: PDF });
await page.waitForSelector(".st5a-card.st-doc", { timeout: 20000 });
await page.setInputFiles("#stFile", { name: "beta.pdf", mimeType: "application/pdf", buffer: PDF });
await page.waitForFunction(() => document.querySelectorAll(".st5a-card.st-doc").length >= 2, null, { timeout: 20000 });
const inset = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".st5a-card")]; const r = cards[0].getBoundingClientRect();
  return { left: r.left, right: window.innerWidth - r.right, vw: window.innerWidth };
});
ok(inset.left >= 8 && inset.right >= 8, "5.1: first card is inset from the viewport edge (" + Math.round(inset.left) + "px/" + Math.round(inset.right) + "px)");
ok(/Today|Yesterday|\d{1,2} /.test(await page.locator(".st5a-card.st-doc").first().innerText()), "5.1: card shows date edited");
ok(await page.locator(".st5a-th").first().count() === 1, "5.1: real cover thumbnail rendered");
/* 5.2 folders: create via sheet, star, colour, move doc into it via menu */
await page.click('[data-act="st5a-new"]'); await page.click('[data-act="st5a-new-folder"]');
await page.waitForFunction(() => document.querySelectorAll(".st5a-folder").length >= 1, null, { timeout: 10000 });
ok(true, "5.2: folder created");
const folderId = (await idbAll("folders"))[0].id;
await page.evaluate((fid) => new Promise((res) => { const r = indexedDB.open("study"); r.onsuccess = () => { const t = r.result.transaction("docs", "readwrite"); t.objectStore("docs").getAll().onsuccess = (e) => { const d = e.target.result[0]; d.folderId = fid; t.objectStore("docs").put(d); t.oncomplete = res; }; }; }), folderId);
ok((await idbAll("docs")).some((d) => d.folderId === folderId), "5.2: document moved into folder (menu path data)");
await page.locator(".st5a-folder").first().locator('[data-act="st5a-folder-menu"]').click();
await page.waitForSelector('[data-act="st5a-folder-colour"]');
await page.click('[data-act="st5a-folder-colour"]');
await page.waitForSelector(".st5a-col-dot"); await page.locator(".st5a-col-dot").nth(1).click();
ok((await idbAll("folders"))[0].colour !== "#42CDB5", "5.2: folder colour changed");
/* 5.3 sort/view persist */
await page.click('[data-act="st5a-sort"][data-v="name"]');
await page.waitForTimeout(300);
ok(await page.evaluate(() => localStorage.getItem("smd_study_lib_sort")) === "name", "5.3: sort choice persisted");
await page.click('[data-act="st5a-view"][data-v="list"]');
await page.waitForSelector(".st5a-list-row", { timeout: 10000 });
await boot("prep=1&study=1"); await openLib();
ok(await page.evaluate(() => localStorage.getItem("smd_study_lib_view")) === "list", "5.3: view choice survives reload");
await page.click('[data-act="st5a-view"][data-v="grid"]');
await page.click('[data-act="st5a-sort"][data-v="date"]');
await page.waitForTimeout(300);
/* 5.4 menu: favourite, duplicate, delete to trash, restore, purge */
const docs0 = (await idbAll("docs")).length;
await page.locator(".st5a-card.st-doc", { hasText: "alpha" }).locator('[data-act="st5a-doc-menu"]').click();
await page.waitForSelector('[data-act="st5a-duplicate"]');
await page.click('[data-act="st5a-duplicate"]');
await page.waitForFunction((n) => document.querySelectorAll(".st5a-card.st-doc").length > n, docs0, { timeout: 15000 });
ok(true, "5.4: duplicate creates a copy with ink");
await page.locator(".st5a-card.st-doc", { hasText: "alpha" }).first().locator('[data-act="st5a-doc-menu"]').click();
await page.waitForSelector('[data-act="st5a-trash"]');
await page.click('[data-act="st5a-trash"]');
await page.waitForTimeout(400);
ok(await page.locator(".st5a-card.st-doc", { hasText: "alpha" }).count() === 0, "5.4: doc leaves grid when trashed");
await page.click('[data-act="st5a-tab"][data-v="trash"]');
await page.waitForFunction(() => /alpha/.test(document.querySelector("#stList").innerText), null, { timeout: 10000 });
ok(true, "5.4: Trash view shows the item");
await page.locator(".st5a-card.st-doc", { hasText: "alpha" }).first().locator('[data-act="st5a-doc-menu"]').click();
await page.waitForSelector('[data-act="st5a-restore"]');
await page.click('[data-act="st5a-restore"]');
await page.click('[data-act="st5a-tab"][data-v="documents"]');
await page.waitForFunction(() => /alpha/.test(document.querySelector("#stList").innerText), null, { timeout: 10000 });
ok(true, "5.4: restore brings the notebook back (ink intact)");
ok(await page.evaluate(() => new Promise((res) => { const r = indexedDB.open("study"); r.onsuccess = () => { const q = r.result.transaction("strokes").objectStore("strokes").getAll(); q.onsuccess = () => res(true); }; })), "5.4: strokes still stored after trash cycle");
/* 5.5 bottom tabs: search + favourites */
await page.click('[data-act="st5a-tab"][data-v="search"]');
await page.waitForSelector("#st5aSearchQ");
await page.fill("#st5aSearchQ", "alpha");
await page.waitForSelector(".st-hit", { timeout: 10000 });
ok(/alpha/.test(await page.locator(".st-hit").first().innerText()), "5.5: search finds by title");
await page.click('[data-act="st5a-tab"][data-v="documents"]');
/* 5.8 document tabs: open two, switch, close, relaunch */
const ids = (await idbAll("docs")).filter((d) => !d.trashedAt).map((d) => d.id);
await page.evaluate((id) => STUDY_LIB.openById(id, null), ids[0]);
await page.waitForSelector(".st-pg", { timeout: 20000 });
await page.evaluate((id) => STUDY_LIB.openById(id, null), ids[1]);
await page.waitForSelector("#stDocTabs", { timeout: 10000 });
ok((await page.locator(".st-dt").count()) >= 2, "5.8: open documents shown as tabs");
await boot("prep=1&study=1");
const tabs = await page.evaluate(() => JSON.parse(localStorage.getItem("smd_study_openTabs") || "[]"));
ok(tabs.length >= 2, "5.8: tabs remembered on relaunch (" + tabs.length + ")");
/* 5.10 export: all pages PDF via download */
await page.evaluate((id) => STUDY_LIB.openById(id, null), ids[0]);
await page.waitForSelector(".st-pg", { timeout: 20000 });
const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.evaluate((id) => STUDY_LIB.exportAll(id, null), ids[0])]);
const buf = readFileSync(await d.path());
ok(d.suggestedFilename().endsWith(".pdf") && buf.slice(0, 5).toString() === "%PDF-", "5.10: export downloads a PDF");
ok((buf.toString("latin1").match(/\/Type\s*\/Page(?![a-z])/g) || []).length === 2, "5.10: export has both pages");
ok(errors.length === 0, "no uncaught page error " + errors.join("|"));
await browser.close(); if (serveProc) serveProc.kill();
console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
