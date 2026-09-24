/* drug-link.js in the real app: MaiK send path, the monograph-first card, highlighting, and the tap
 * that opens the Drugs Database monograph. USAGE: node test/run-druglink-ui.mjs  (Playwright; serves
 * the repo on :8991 itself). SHOTS=<dir> also saves screenshots. */
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8991/").replace(/\/?$/, "/");
const SHOTS = process.env.SHOTS || "";
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require(join(execSync("npm root -g").toString().trim(), "playwright")); }
let serve = null;
try { await fetch(BASE); } catch {
  serve = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8991"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const browser = await pw.chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const aiCalls = []; page.on("request", (r) => { if (/\/api\/ai/.test(r.url()) && !/\/health/.test(r.url())) aiCalls.push(r.url()); });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForFunction(() => window.SMD_askMaik && window.SMD_DRUGLINK && window.MEDDB, null, { timeout: 30000 });
  await page.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); });
  await page.waitForTimeout(9000);   // let the boot splash / intro finish
  await page.evaluate(() => { SMD_askMaik(""); });
  await page.waitForSelector("#maikBody", { timeout: 10000 });
  await page.waitForTimeout(800);

  await page.fill("#maikQ", "dose of paracetomol");
  await page.click("#maikSend");
  await page.waitForSelector("#maikBody .maik-drugask", { timeout: 5000 });
  await page.waitForTimeout(600);
  const card = await page.evaluate(() => { const c = document.querySelector("#maikBody .maik-drugask"); return c ? c.innerText : ""; });
  ok(/Paracetamol/.test(card) && /monograph first/.test(card), "the card names Paracetamol and asks about the monograph first");
  ok(/Read "paracetomol" as Paracetamol/.test(card), "it says how the misspelling was read");
  ok(aiCalls.length === 0, "no answer requested yet (the question waits for the doctor): " + aiCalls.join(" "));
  const state = () => page.evaluate(() => { const m = document.querySelector("#maikBody .maik-b.you .smd-drug"); if (!m) return null; const cs = getComputedStyle(m); return { t: m.textContent, glow: m.classList.contains("smd-glow"), bg: cs.backgroundColor, fw: cs.fontWeight }; });
  const g1 = await state();
  ok(g1 && g1.t === "paracetomol" && +g1.fw >= 700 && g1.glow, "the typed drug is bold and GLOWING as it comes into view: " + JSON.stringify(g1));
  if (SHOTS) await page.screenshot({ path: SHOTS + "/druglink-glow.png" });
  await page.waitForTimeout(5600);
  const g2 = await state();
  ok(g2 && !g2.glow && +g2.fw >= 700 && g2.bg === "rgba(0, 0, 0, 0)", "after 5 s the glow is gone: plain bold, no highlight: " + JSON.stringify(g2));
  if (SHOTS) await page.screenshot({ path: SHOTS + "/druglink-card.png" });
  // scroll it out of view and back: it glows again
  await page.evaluate(() => { const b = document.getElementById("maikBody"); const pad = document.createElement("div"); pad.id = "t_pad"; pad.style.minHeight = "3000px"; b.appendChild(pad); b.scrollTop = 99999; });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector("#maikBody .maik-b.you .smd-drug").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(500);
  ok((await state()).glow, "scrolled away and back: it glows again");
  await page.evaluate(() => document.getElementById("t_pad").remove());

  await page.click('#maikBody .maik-drugask [data-maik-drugidx="Paracetamol"]');
  await page.waitForTimeout(1500);
  const db = await page.evaluate(() => { const r = document.querySelector(".db-overlay.on, #dbRoot.on, [id^=db].on"); const t = document.querySelector("#dbTitle, .db-title"); return { open: !!r, title: t ? t.textContent : "" }; });
  ok(db.open && /Paracetamol/i.test(db.title), "Open monograph shows the Drugs Database on Paracetamol: " + JSON.stringify(db));
  if (SHOTS) await page.screenshot({ path: SHOTS + "/druglink-monograph.png" });

  // back to MaiK, answer anyway
  await page.evaluate(() => { try { MEDDB.close(); } catch (e) {} SMD_askMaik(""); });
  await page.waitForTimeout(900);
  const hasCont = await page.$('#maikBody [data-maik-drugcont]');
  ok(!!hasCont, "the card is still there after visiting the monograph");
  await page.click('#maikBody [data-maik-drugcont]');
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({ acts: !!document.querySelector("#maikBody .maik-drugask .maik-dose-acts"), bubbles: document.querySelectorAll("#maikBody .maik-b").length, you: document.querySelectorAll("#maikBody .maik-b.you").length }));
  ok(!after.acts && after.you === 1 && after.bubbles >= 3, "Just answer resumes the same question without re-posting it: " + JSON.stringify(after));

  // highlighting inside an answer bubble + tap
  await page.evaluate(() => { const b = document.createElement("div"); b.className = "maik-b ai"; b.id = "t_ans"; b.innerHTML = "<p>First line: ceftriaxone 2 g IV daily plus azithromycin 500 mg. Potassium 3.2 is low.</p>"; document.getElementById("maikBody").appendChild(b); });
  await page.waitForTimeout(700);
  const marks = await page.evaluate(() => Array.from(document.querySelectorAll("#t_ans .smd-drug")).map((m) => m.textContent));
  ok(JSON.stringify(marks) === JSON.stringify(["ceftriaxone", "azithromycin"]), "answer text: drugs highlighted, lab analyte not: " + marks.join(","));
  if (SHOTS) await page.screenshot({ path: SHOTS + "/druglink-answer.png" });
  await page.click("#t_ans .smd-drug");
  await page.waitForTimeout(1500);
  const db2 = await page.evaluate(() => { const t = document.querySelector("#dbTitle, .db-title"); return t ? t.textContent : ""; });
  ok(/Ceftriaxone/i.test(db2), "tapping a highlighted drug in an answer opens its monograph: " + db2);

  // ── Knowledge Library, disease reader, protocol sheet ─────────────────────────────────────────────
  const topIsDb = () => page.evaluate(() => { const e = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return !!(e && e.closest("#dbOverlay")); });
  await page.evaluate(() => { try { MEDDB.close(); } catch (e) {} });
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => { const c = document.querySelector("#maikSheet .maik-x, [data-maik-close], #maikClose"); if (c) c.click(); });
  await page.waitForTimeout(500);
  for (const tab of ["antibiogram", "aware", "guidelines"]) {
    await page.evaluate((t) => SB.openRef(t), tab);
    await page.waitForTimeout(900);
    const n = await page.evaluate(() => document.querySelectorAll("#sbrefBody .smd-drug").length);
    if (tab === "guidelines") ok(n === 0, "Knowledge Library / guidelines (a list of guideline sources, no drugs): nothing highlighted");
    else ok(n > 0, "Knowledge Library / " + tab + ": " + n + " drug names highlighted");
    if (SHOTS && tab === "aware") await page.screenshot({ path: SHOTS + "/druglink-aware.png" });
  }
  await page.evaluate(() => { SB.openRef("syndromes"); const c = document.querySelector("#kblibClear"); if (c) c.click(); const q = document.querySelector("#kblibQ"); q.value = "tuberculosis"; q.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelector("#kblibGrid .kblib-row").click());
  await page.waitForTimeout(1800);
  const rd = await page.evaluate(() => { const m = Array.from(document.querySelectorAll("#dxOverlay .smd-drug")); return { n: m.length, first: m.slice(0, 6).map((x) => x.textContent) }; });
  ok(rd.n > 0, "Knowledge Library disease reader: " + rd.n + " drug names highlighted " + JSON.stringify(rd.first));
  if (SHOTS) await page.screenshot({ path: SHOTS + "/druglink-reader.png" });
  if (rd.n) {
    await page.evaluate(() => { const m = document.querySelector("#dxOverlay .smd-drug"); m.scrollIntoView({ block: "center" }); m.click(); });
    await page.waitForTimeout(1500);
    ok(await topIsDb(), "tapping it in the reader opens the monograph ON TOP of the reader");
    if (SHOTS) await page.screenshot({ path: SHOTS + "/druglink-reader-mono.png" });
    await page.evaluate(() => MEDDB.close());
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => { const d = document.getElementById("dbOverlay"); return !d.getAttribute("data-druglink-lift") && d.style.zIndex === ""; }), "the database z-index is restored when it closes");
  }
  const ps = await page.evaluate(async () => {
    const idx = await (await fetch("/kb/protocols/index.json")).json();
    const list = idx.protocols || idx.items || idx;
    const id = (Array.isArray(list) ? list : Object.values(list))[0].id;
    const p = await (await fetch("/kb/protocols/" + id + ".json")).json();
    SMD_PROTOSHEET.open({ protocol: p, patient: { name: "", heightCm: 165, weightKg: 60 }, today: "2026-09-23" });
    await new Promise((r) => setTimeout(r, 1200));
    const m = Array.from(document.querySelectorAll("#smdProtoSheet .smd-drug"));
    return { id, n: m.length, first: m.slice(0, 5).map((x) => x.textContent) };
  });
  ok(ps.n > 0, "chemotherapy protocol sheet (" + ps.id + "): " + ps.n + " drug names highlighted " + JSON.stringify(ps.first));
  if (SHOTS) await page.screenshot({ path: SHOTS + "/druglink-protocol.png" });
  const printBg = await page.evaluate(() => { const r = document.getElementById("smd-druglink-css").textContent; return /@media print\{\.smd-drug\{background:none/.test(r); });
  ok(printBg, "print CSS strips the highlight from printed sheets");

  // flag off
  const off = await page.evaluate(() => { localStorage.setItem("smd_druglink", "0"); const d = document.createElement("div"); d.innerHTML = "warfarin"; const n = SMD_DRUGLINK.highlight(d); localStorage.removeItem("smd_druglink"); return n; });
  ok(off === 0, "smd_druglink=0 turns highlighting off");
} finally { await browser.close(); if (serve) serve.kill(); }
console.log(fails ? `${fails} FAILED` : "ALL PASS"); process.exit(fails ? 1 : 0);
