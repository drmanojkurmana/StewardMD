/* PrepNucleus Tests tab, mode sheet and per-question timer line (owner 2026-10-10) in the REAL app, in Playwright
 * Chromium (CHROME=<path> for Google Chrome) AND WebKit, iPhone-sized with touch, against the fixture bank.
 * What must hold, in both engines:
 *  - the Tests tab shows one screen with a Tests | QBank segmented control; Tests = the mock exams (and PYQ row on
 *    NEET-PG); QBank = every subject of the exam as the same tiles as Home (same count as Home's grid), with Custom
 *    module, Bookmarks and My mistakes; the last section is remembered; Home's Mock exam row always opens Tests;
 *  - opening a module from the QBank, from a Home subject, from Solve next and from a deep link (PREP.open({ query }))
 *    shows the mode sheet at once ("How do you want to practise?"): two mode cards (radio), the timer box (switch on,
 *    60 s), Start; closing it leaves the module screen; the module's Practise button opens it again; bookmarks too;
 *  - the timer box: 60 s by default, up to 100 s (the + stops there), the choice and the last mode are remembered;
 *  - Learning Mode: the line (role progressbar, aria-valuemax = seconds) drains; an answer shows the explanation and
 *    stops the clock; Next starts the next question's own full time; at 0 the question locks as Time up with the right
 *    answer and the explanation and waits for Next (no auto-advance);
 *  - the line is green, then amber, then red strictly under 20% (computed colour = the danger token), with a polite
 *    live line; a sheet over the runner (share) and a frozen page stop the clock and nothing is lost;
 *  - Test Mode: no feedback after an answer, no Share or ID chip; a question that runs out moves on by itself; the last
 *    one running out marks the test; the result shows the average time and the timed-out count;
 *  - every sheet control is at least 44 px; no em or en dash on screen; no uncaught PrepNucleus error.
 * A fake monotonic clock (SMD_PREP_NOW, still between steps) moves time in 2 s steps (under the 3 s frozen-page gap).
 * SHOTS=<dir>: 390x844, 430x932, 820x1180, light and dark: Tests, QBank, the mode sheet, the line green/amber/red,
 * learning feedback, a test mid-run, the result.
 * USAGE: node test/run-prep-testtab-ui.mjs   (CHROME=<path>; PLAYWRIGHT_CORE=<path>; ENGINES=chromium,webkit; SHOTS)
 */
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = "/test/fixtures/prep/";
const SHOTS = process.env.SHOTS || "";
const ENGINES = (process.env.ENGINES || "chromium,webkit").split(",").map((s) => s.trim()).filter(Boolean);
const DASH = new RegExp("[" + String.fromCharCode(8211, 8212) + "]");

async function loadPW() {
  const tries = [];
  if (process.env.PLAYWRIGHT_CORE) tries.push(process.env.PLAYWRIGHT_CORE);
  tries.push(join(HERE, "..", "node_modules", "playwright-core"));
  const npx = join(os.homedir(), ".npm", "_npx");
  try { for (const d of fs.readdirSync(npx)) tries.push(join(npx, d, "node_modules", "playwright-core")); } catch {}
  for (const p of tries) {
    if (!fs.existsSync(join(p, "index.mjs"))) continue;
    const pw = await import(pathToFileURL(join(p, "index.mjs")).href);
    try { const exe = pw.webkit.executablePath(); if (exe && fs.existsSync(exe)) return pw; } catch {}
  }
  return null;
}
const pw = await loadPW();
if (!pw) { console.log("SKIP no playwright-core with an installed WebKit (set PLAYWRIGHT_CORE)"); process.exit(0); }

const ORIGIN = "https://prep.test", BASE = ORIGIN + "/", ROOT = join(HERE, "..");
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".gz": "application/gzip", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
function serveFile(route) {
  let p = decodeURIComponent(new URL(route.request().url()).pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = join(ROOT, p.replace(/^\/+/, ""));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: "" });
  const ext = (f.match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase();
  return route.fulfill({ status: 200, contentType: TYPES[ext] || "application/octet-stream", body: fs.readFileSync(f) });
}
// 12 questions with an explanation and a reason per option (the full Learning Mode feedback).
function moduleFile() {
  const items = [];
  for (let i = 0; i < 12; i++) items.push({ id: "tt-" + i, q: "A " + (20 + i) + "-year-old man cannot abduct his arm after a shoulder dislocation. Which nerve is injured?", o: ["Axillary", "Radial", "Ulnar", "Median"], a: 0,
    exp: "The axillary nerve winds round the surgical neck and supplies the deltoid.", r: ["Supplies the deltoid", "Wrist drop, not loss of abduction", "Claw hand", "Ape thumb"], t: "ana-brachial-plexus", d: (i % 3) + 1, prov: "LIC" });
  return { topic: "ana-brachial-plexus", items };
}

let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

async function session(engine, opts) {
  const type = pw[engine];
  const launch = engine === "chromium" && process.env.CHROME ? { executablePath: process.env.CHROME } : {};
  const browser = await type.launch(launch);
  const vp = opts.vp || { width: 390, height: 844 };
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: vp.width < 700, hasTouch: true, serviceWorkers: "block", reducedMotion: opts.reduced ? "reduce" : "no-preference",
    userAgent: engine === "webkit" ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" : undefined });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (/prep|PREP/.test(String(e && (e.stack || e.message)))) errors.push(String(e.message || e)); });
  await page.route(/^https:\/\/prep\.test\//, serveFile);
  await page.route(/^https:\/\/prep\.test\/api\//, (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.route(/ana-brachial-plexus\.json/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(moduleFile()) }));
  await page.addInitScript(`window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")};
    window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false; window.__off=1000; window.SMD_PREP_NOW=function(){ return window.__off; };
    try{ localStorage.setItem("smd_prep","1"); if (!sessionStorage.getItem("pntt")) { sessionStorage.setItem("pntt","1"); ["smd_prep_v1","smd_prep_setup","smd_prep_tt"].forEach(function(k){ localStorage.removeItem(k); }); } }catch(e){}`);
  await page.goto(BASE);
  await page.waitForFunction(() => !!(window.PREP && window.SMD_showHome), null, { timeout: 30000 });
  await page.evaluate((dark) => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); document.body.classList.toggle("dark", !!dark); }, !!opts.dark);
  return { browser, ctx, page, errors };
}
const until = async (page, fn, ms = 10000, arg) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
const tap = (page, sel) => page.evaluate((s) => { const b = document.querySelector(s); if (!b) return false; b.click(); return true; }, sel);
const tab = (page, id) => tap(page, '#smdPrep > nav.pnv .pnv-tab[data-tab="' + id + '"]');
const sheetUp = (page) => until(page, () => !!document.querySelector("#pnSetup .su-modes") && !!document.querySelector("#pnSetup .su-tbox"), 8000);
const sheetReady = (page) => until(page, () => !!document.querySelector("#pnSetup #suGo:not([disabled])"), 8000);
// Move the test clock in 2 s steps, letting the 250 ms tick run after each.
async function adv(page, ms) { for (let d = 0; d < ms; d += 2000) { await page.evaluate((x) => { window.__off += x; }, Math.min(2000, ms - d)); await sleep(330); } }
const run = (page) => page.evaluate(() => { const r = PREP._st.run; return r ? { i: r.i, n: r.items.length, mode: r.mode, qsec: r.qsec, on: r.qc ? r.qc.on : null, out: r.qc ? r.qc.out.slice() : [], ans: r.ans.slice(), done: r.done } : null; });
const line = (page) => page.evaluate(() => { const l = document.querySelector("#pnTl"); if (!l) return null; const f = l.firstElementChild; return { lvl: l.getAttribute("data-lvl"), now: +l.getAttribute("aria-valuenow"), max: +l.getAttribute("aria-valuemax"), role: l.getAttribute("role"), bg: getComputedStyle(f).backgroundColor, live: (document.querySelector("#pnTlLive") || {}).textContent || "", w: l.getBoundingClientRect().width, vw: innerWidth }; });
const tokenColor = (page, name) => page.evaluate((n) => { const p = document.createElement("i"); p.style.color = "var(" + n + ")"; document.getElementById("smdPrep").appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; }, name);
const small = (page, scope) => page.evaluate((s) => [].filter.call(document.querySelectorAll(s + " button"), (b) => b.offsetParent && b.getBoundingClientRect().height < 44 * 0.95 - 0.5).map((b) => (b.getAttribute("data-act") || b.className) + ":" + Math.round(b.getBoundingClientRect().height)).join(","), scope);

async function assertions(engine) {
  const { browser, page, errors } = await session(engine, {});
  const E = engine + ": ";
  try {
    await page.evaluate(() => PREP.open());
    ok(await until(page, () => !!document.querySelector("#pnHome") && !!document.querySelector("#smdPrep > nav.pnv:not(.pnv-off)"), 20000), E + "home opens");
    const homeTiles = await until(page, () => document.querySelectorAll("#pnHome #pnGrid .pn-tile").length > 0, 8000) && await page.evaluate(() => document.querySelectorAll("#pnHome #pnGrid .pn-tile").length);

    // ---- 1. Tests tab: both sections
    await tab(page, "tests");
    ok(await until(page, () => !!document.querySelector("#smdPrep .pn-ttseg") && !!document.querySelector("#pnTests [data-act=mock]")), E + "Tests tab: the segmented control and the mock exams");
    let t = await page.evaluate(() => ({ seg: [].map.call(document.querySelectorAll("#smdPrep .pn-ttseg .pn-chip"), (b) => b.textContent + ":" + b.getAttribute("aria-pressed")).join(","), cur: document.querySelector('#smdPrep nav.pnv [aria-current="page"]').getAttribute("data-tab"), title: document.querySelector("#smdPrep .pn-bar h1").textContent }));
    ok(t.seg === "Tests:true,QBank:false" && t.cur === "tests" && t.title === "Tests", E + "Tests first, Tests tab current: " + JSON.stringify(t));
    await tap(page, '#smdPrep .pn-ttseg [data-v="qbank"]');
    ok(await until(page, () => !!document.querySelector("#pnTests.pn-qbank #pnGrid .pn-tile[data-s]") && !document.querySelector("#pnTests [data-act=mock]")), E + "QBank: subject tiles, no mock panels");
    t = await page.evaluate(() => ({ tiles: [].map.call(document.querySelectorAll("#pnTests #pnGrid .pn-tile"), (b) => b.getAttribute("data-s")), want: PREP._host.subjectsOf(PREP._st.store.exam).map((s) => s.id), rows: ["custom", "bookmarks", "mistakes"].every((a) => !!document.querySelector('#pnTests [data-act="' + a + '"]')), ring: !!document.querySelector("#pnTests .pn-tile .pn-disc"), sum: document.getElementById("pnQbS").textContent, tt: localStorage.getItem("smd_prep_tt") }));
    ok(t.tiles.join() === t.want.join() && t.tiles.length === homeTiles, E + "QBank lists every subject of the exam, as many as Home: " + t.tiles.join());
    ok(t.rows && t.ring && /MCQs/.test(t.sum) && t.tt === "qbank", E + "Custom module, Bookmarks, My mistakes; the same ringed tiles; a summary; remembered: " + t.sum);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, engine + "-qbank-probe.png") });
    await tab(page, "home"); await until(page, () => !!document.querySelector("#pnHome"));
    await tab(page, "tests");
    ok(await until(page, () => !!document.querySelector("#pnTests.pn-qbank")), E + "back on the Tests tab: QBank is still chosen");
    await tab(page, "home"); await until(page, () => !!document.querySelector("#pnHome"));
    await tap(page, "#pnHome [data-act=mocks]");
    ok(await until(page, () => !!document.querySelector("#pnTests [data-act=mock]")), E + "Home's Mock exam row opens the Tests section");
    // NEET-SS: QBank follows the exam
    await page.evaluate(() => { PREP._host.setExam("neet-ss"); });
    await tap(page, '#smdPrep .pn-ttseg [data-v="qbank"]');
    ok(await until(page, () => [].map.call(document.querySelectorAll("#pnTests #pnGrid .pn-tile"), (b) => b.getAttribute("data-s")).join() === "ss-cardiology"), E + "NEET-SS: QBank lists the NEET-SS subjects");
    await page.evaluate(() => { PREP._host.setExam("neet-pg"); });

    // ---- 2. entry points open the mode sheet
    await until(page, () => !!document.querySelector('#pnTests .pn-tile[data-s="anatomy"]'));
    await tap(page, '#pnTests .pn-tile[data-s="anatomy"]');
    ok(await until(page, () => !!document.querySelector('#smdPrep .pn-mod[data-m="ana-brachial-plexus"]')), E + "QBank: a subject opens its modules");
    ok(await page.evaluate(() => document.querySelector('#smdPrep nav.pnv [aria-current="page"]').getAttribute("data-tab")) === "tests", E + "the Tests tab stays current under it");
    await tap(page, '#smdPrep .pn-mod[data-m="ana-brachial-plexus"]');
    ok(await sheetUp(page), E + "QBank > subject > module: the mode sheet opens at once");
    let sh = await page.evaluate(() => ({ h: document.getElementById("suT").textContent, cards: [].map.call(document.querySelectorAll("#pnSetup .su-mc"), (b) => b.querySelector("b").textContent + ":" + b.getAttribute("aria-checked") + ":" + b.getAttribute("role")).join(","),
      sw: document.querySelector("#pnSetup .su-sw").getAttribute("aria-checked"), qs: document.querySelector('#pnSetup .su-qsrow .su-sv').textContent, go: document.getElementById("suGo").textContent, nav: document.querySelector("#smdPrep > nav.pnv").classList.contains("pnv-off"), group: document.querySelector("#pnSetup .su-modes").getAttribute("role") }));
    ok(sh.h === "How do you want to practise?" && sh.cards === "Learning Mode:true:radio,Test Mode:false:radio" && sh.group === "radiogroup", E + "two mode cards, Learning Mode first and chosen: " + sh.cards);
    ok(sh.sw === "true" && sh.qs === "60 s" && /Start learning/.test(sh.go) && sh.nav, E + "timer on, 60 s, Start learning, the tab bar steps aside: " + JSON.stringify(sh));
    await sheetReady(page);
    ok(await small(page, "#pnSetup") === "", E + "every sheet button at least 44 px: " + await small(page, "#pnSetup"));
    ok(!DASH.test(await page.evaluate(() => document.getElementById("smdPrep").innerText)), E + "no em or en dash");
    await tap(page, "#pnSetup .su-x");
    ok(await until(page, () => !document.getElementById("pnSetup") && !!document.querySelector("#pnModPanel [data-act=start][data-k=study]")), E + "closing it leaves the module screen with Practise");
    await tap(page, "#pnModPanel [data-act=start][data-k=study]");
    ok(await sheetUp(page), E + "Practise opens the sheet again");
    await page.evaluate(() => PREP.back());
    // Home subject tile
    await tab(page, "home"); await until(page, () => !!document.querySelector('#pnHome .pn-tile[data-s="anatomy"]'));
    await tap(page, '#pnHome .pn-tile[data-s="anatomy"]');
    await until(page, () => !!document.querySelector('#smdPrep .pn-mod[data-m="ana-gametogenesis"]'));
    await tap(page, '#smdPrep .pn-mod[data-m="ana-gametogenesis"]');
    ok(await sheetUp(page), E + "Home > subject > module: the mode sheet");
    await page.evaluate(() => PREP.back()); await page.evaluate(() => PREP.back());
    // Solve next
    await tab(page, "home");
    if (await until(page, () => !!document.querySelector("#pnHome #pnNext:not([hidden])"), 6000)) { await tap(page, "#pnHome #pnNext"); ok(await sheetUp(page), E + "Solve next: the mode sheet"); await page.evaluate(() => PREP.back()); }
    else ok(false, E + "Solve next shows on home");
    // deep link (Edge start_mcq): module + sheet with the asked count
    await page.evaluate(() => { PREP.close(); PREP.open({ query: "brachial plexus", n: 5 }); });
    ok(await sheetUp(page) && await sheetReady(page), E + "deep link opens the module and the sheet");
    ok(await page.evaluate(() => document.getElementById("suN").textContent) === "5", E + "with the asked count (5)");
    await page.evaluate(() => PREP.back());

    // ---- 3. timer box: up to 100, remembered with the mode
    await tap(page, "#pnModPanel [data-act=start][data-k=study]"); await sheetReady(page);
    for (let k = 0; k < 6; k++) await tap(page, "#pnSetup [data-act=su-qinc]");
    sh = await page.evaluate(() => ({ qs: document.querySelector("#pnSetup .su-qsrow .su-sv").textContent, dis: document.querySelector("#pnSetup [data-act=su-qinc]").disabled, note: document.querySelector("#pnSetup .su-tnote").textContent, st: document.getElementById("suStatus").textContent }));
    ok(sh.qs === "100 s" && sh.dis && /last 20 s/.test(sh.note) && /100 s each/.test(sh.st), E + "seconds go up to 100 and stop; red in the last 20 s: " + JSON.stringify(sh));
    await tap(page, '#pnSetup .su-mc[data-v="exam"]');
    ok(await page.evaluate(() => /Start test/.test(document.getElementById("suGo").textContent) && /test moves on/.test(document.querySelector("#pnSetup .su-tnote").textContent)), E + "Test Mode: Start test; the note says what happens at 0");
    await tap(page, "#pnSetup .su-sw");
    ok(await page.evaluate(() => document.querySelector("#pnSetup .su-sw").getAttribute("aria-checked") === "false" && !document.querySelector("#pnSetup .su-qsrow") && /no timer/.test(document.getElementById("suStatus").textContent)), E + "timer off: no seconds row, no timer");
    await tap(page, "#pnSetup .su-sw");
    ok(await page.evaluate(() => document.querySelector("#pnSetup .su-qsrow .su-sv").textContent) === "100 s", E + "on again keeps 100 s");
    // back to the defaults for the runs below: Learning, 60 s; Start remembers
    await tap(page, '#pnSetup .su-mc[data-v="study"]');
    for (let k = 0; k < 4; k++) await tap(page, "#pnSetup [data-act=su-qdec]");
    ok(await page.evaluate(() => document.querySelector("#pnSetup .su-qsrow .su-sv").textContent) === "60 s", E + "back to 60 s");
    await tap(page, '#pnSetup [data-act=su-n][data-v="10"]');
    if (SHOTS) await shotsAll(engine, "sheet", async (p) => { await p.evaluate(() => PREP.open({ query: "brachial plexus" })); await sheetReady(p); });

    // ---- 4. Learning Mode
    await tap(page, "#suGo");
    ok(await until(page, () => !!document.querySelector("#smdPrep .pn-q") && !document.getElementById("pnSetup")), E + "Start learning: the runner");
    let r = await run(page), l = await line(page);
    ok(r.mode === "study" && r.qsec === 60 && r.n === 10 && r.on === 0, E + "Learning Mode, 60 s, 10 questions, the clock runs: " + JSON.stringify(r));
    ok(l && l.role === "progressbar" && l.max === 60 && l.now === 60 && l.lvl === "ok" && Math.abs(l.w - l.vw) < 1.5, E + "the line: progressbar, 60 s, full width, green: " + JSON.stringify(l));
    ok(await page.evaluate(() => !!document.querySelector("#smdPrep > nav.pnv.pnv-off")), E + "the glass bar is hidden in the runner");
    await adv(page, 10000);
    l = await line(page);
    ok(l.now === 50 && /0:50/.test(await page.evaluate(() => document.getElementById("pnClock").textContent)), E + "10 s later: about 50 s left, said as text too: " + l.now);
    await tap(page, '#smdPrep .pn-opt[data-k="1"]');
    ok(await until(page, () => !!document.querySelector("#smdPrep .pn-fb.no") && /Why the others are wrong/.test(document.querySelector("#smdPrep .pn-fb").textContent) && !!document.querySelector("#smdPrep [data-act=next]")), E + "an answer: verdict, the explanation for every option, Next");
    r = await run(page);
    const kept = (await line(page)).now;
    await adv(page, 6000);
    ok(r.on === -1 && (await line(page)).now === kept, E + "answered: the clock stops and holds");
    if (SHOTS) await page.screenshot({ path: join(SHOTS, engine + "-learning-feedback-390-light.png") });
    await tap(page, "#smdPrep [data-act=next]");
    ok(await until(page, () => PREP._st.run.i === 1), E + "Next: question 2");
    l = await line(page);
    ok(l.now === 60 && l.lvl === "ok", E + "question 2 starts on its own full 60 s");
    // levels: amber from half, red strictly under 20%
    await adv(page, 30000); await sleep(400);
    l = await line(page);
    ok(l.lvl === "mid" && l.bg === await tokenColor(page, "--pn-warn"), E + "half gone: amber: " + JSON.stringify(l));
    await adv(page, 17000);
    l = await line(page);
    ok(l.now === 13 && l.lvl === "mid", E + "13 s left: still amber (20% is 12 s): " + l.now);
    await adv(page, 1000);
    l = await line(page);
    ok(l.now === 12 && l.lvl === "mid", E + "exactly 12 s (20%) left: not red yet: " + JSON.stringify(l));
    await adv(page, 1); await sleep(400);   // the colour change is a 240 ms transition
    l = await line(page);
    ok(l.lvl === "low" && l.bg === await tokenColor(page, "--pn-bad") && /seconds left/.test(l.live), E + "under 20%: red (the danger token), and said: " + JSON.stringify(l));
    if (SHOTS) await page.screenshot({ path: join(SHOTS, engine + "-line-red-390-light.png") });
    // a sheet over the runner stops the clock (share), and so does a frozen page
    const before = (await line(page)).now;
    await tap(page, "#smdPrep [data-act=id-share]");
    ok(await until(page, () => !!document.querySelector("#smdPrep > .pn-sheet-wrap")), E + "the share sheet opens over the question");
    await adv(page, 8000);
    ok((await run(page)).on === -1 && (await line(page)).now === before, E + "with a sheet open the clock stops: nothing lost");
    await page.evaluate(() => PREP.back());
    await until(page, () => !document.querySelector("#smdPrep > .pn-sheet-wrap"));
    ok(await until(page, () => PREP._st.run.qc.on === 1), E + "closed: it runs again");
    await page.evaluate(() => document.dispatchEvent(new Event("freeze")));
    await adv(page, 8000);
    ok((await line(page)).now >= before - 1, E + "a frozen page (screen locked) costs nothing");
    await page.evaluate(() => document.dispatchEvent(new Event("resume")));
    // Learning Mode at 0: locks, shows the answer and the explanation, waits
    await adv(page, 14000);
    ok(await until(page, () => !!document.querySelector("#smdPrep .pn-verdict.pn-vtu")), E + "at 0: Time up");
    r = await run(page); l = await line(page);
    ok(r.i === 1 && r.out[1] && r.ans[1] === -1 && l.lvl === "out", E + "it stays on the question (no auto-advance), recorded unanswered: " + JSON.stringify(r));
    ok(await page.evaluate(() => /Right answer/.test(document.querySelector("#smdPrep .pn-fb").textContent) && !!document.querySelector("#smdPrep .pn-xnotes, #smdPrep .pn-exp, #smdPrep .pn-why") && [].every.call(document.querySelectorAll("#smdPrep .pn-opt"), (b) => b.disabled) && !!document.querySelector("#smdPrep [data-act=next]")), E + "the right answer and the explanation show, options locked, Next waits");
    await adv(page, 4000);
    ok((await run(page)).i === 1, E + "still on it 4 s later");
    if (SHOTS) await page.screenshot({ path: join(SHOTS, engine + "-learning-timeup-390-light.png") });
    await page.evaluate(() => { PREP._st.run.done || PREP.back(); });
    await until(page, () => !!document.querySelector("#pnModPanel"));

    // ---- 5. Test Mode: no feedback, auto-advance, the last one marks the test
    await tap(page, "#pnModPanel [data-act=start][data-k=study]"); await sheetReady(page);
    ok(await page.evaluate(() => document.querySelector('#pnSetup .su-mc[data-v="study"]').getAttribute("aria-checked") === "true" && document.querySelector("#pnSetup .su-qsrow .su-sv").textContent === "60 s"), E + "remembered: Learning Mode and 60 s preselected");
    await tap(page, '#pnSetup .su-mc[data-v="exam"]');
    for (let k = 0; k < 2; k++) await tap(page, "#pnSetup [data-act=su-qdec]");   // 60 -> 45 -> 30
    for (let k = 0; k < 12 && await page.evaluate(() => document.getElementById("suN").textContent) !== "3"; k++) await tap(page, "#pnSetup [data-act=su-dec]");   // count down to 3
    ok(await page.evaluate(() => document.getElementById("suN").textContent === "3" && document.querySelector("#pnSetup .su-qsrow .su-sv").textContent === "30 s"), E + "3 questions, 30 s (the earlier strict-timer step)");
    await tap(page, "#suGo");
    ok(await until(page, () => !!document.querySelector("#smdPrep .pn-q") && PREP._st.run.mode === "exam"), E + "Start test");
    ok(await page.evaluate(() => !document.querySelector("#smdPrep .pn-run [data-act^=id-], #smdPrep .pn-bar [data-act^=id-]")), E + "Test Mode: no Share button and no ID chip");
    await tap(page, '#smdPrep .pn-opt[data-k="2"]');
    ok(await page.evaluate(() => !document.querySelector("#smdPrep .pn-fb") && PREP._st.run.ans[0] === 2 && !!document.querySelector('#smdPrep .pn-opt.sel[data-k="2"]')), E + "an answer is only selected: no verdict, no explanation");
    if (SHOTS) await page.screenshot({ path: join(SHOTS, engine + "-test-midrun-390-light.png") });
    await tap(page, "#smdPrep [data-act=next]");
    await until(page, () => PREP._st.run.i === 1);
    await adv(page, 32000);
    r = await run(page);
    ok(r.i === 2 && r.out[1] && r.ans[1] === -1, E + "question 2 ran out: unanswered, the test moved to question 3: " + JSON.stringify(r));
    await adv(page, 32000);
    ok(await until(page, () => PREP._st.run && PREP._st.run.done && /Test marked/.test(document.querySelector("#smdPrep .pn-bar h1").textContent)), E + "the last question ran out: the test is marked, the Result screen");
    const res = await page.evaluate(() => ({ stat: (document.querySelector("#smdPrep .pn-tstat") || {}).textContent || "", review: !!document.querySelector("#smdPrep .pn-rvf"), split: !!document.querySelector("#smdPrep .pn-split"), big: document.querySelector("#smdPrep .pn-score .pn-big").textContent }));
    ok(/average a question/.test(res.stat) && /2\s*timed out/.test(res.stat) && res.review && res.split, E + "result: score, split, review, average time and 2 timed out: " + JSON.stringify(res));
    if (SHOTS) await page.screenshot({ path: join(SHOTS, engine + "-result-390-light.png"), fullPage: false });

    // ---- 6. bookmarks open the same sheet
    await page.evaluate(() => { const s = PREP._st.store; s.bm["tt-3"] = ["anatomy", "ana-brachial-plexus", Date.now()]; localStorage.setItem("smd_prep_v1", JSON.stringify(s)); });
    await page.evaluate(() => { PREP.close(); PREP.open(); });
    await until(page, () => !!document.querySelector("#pnHome"));
    await tap(page, "#pnHome [data-act=bookmarks]");
    await until(page, () => !!document.querySelector("#smdPrep [data-act=practicebm]"));
    await tap(page, "#smdPrep [data-act=practicebm]");
    ok(await sheetUp(page), E + "Bookmarks: the same mode sheet");
    ok(errors.length === 0, E + "no uncaught PrepNucleus error " + errors.join(" | "));
  } finally { await browser.close(); }
}

// Screenshots of one state at the three sizes, light and dark. prep(page) brings the page to the state.
async function shotsAll(engine, name, prep) {
  for (const vp of [{ width: 390, height: 844 }, { width: 430, height: 932 }, { width: 820, height: 1180 }]) for (const dark of [false, true]) {
    const s = await session(engine, { vp, dark });
    try {
      await s.page.evaluate(() => PREP.open());
      await until(s.page, () => !!document.querySelector("#pnHome"), 20000);
      await prep(s.page);
      await s.page.evaluate(() => new Promise((r) => { document.getAnimations().forEach((a) => { try { const t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity && !(a.effect.target && a.effect.target.classList && a.effect.target.classList.contains("pn-tl-f"))) a.finish(); } catch (e) {} }); setTimeout(r, 500); }));
      await s.page.screenshot({ path: join(SHOTS, engine + "-" + name + "-" + vp.width + "-" + (dark ? "dark" : "light") + ".png") });
    } finally { await s.browser.close(); }
  }
}
async function startSet(p, mode, qs) {
  await p.evaluate(() => PREP.open({ query: "brachial plexus" })); await sheetReady(p);
  if (mode === "exam") await tap(p, '#pnSetup .su-mc[data-v="exam"]');
  await tap(p, "#suGo"); await until(p, () => !!document.querySelector("#smdPrep .pn-q"));
}
async function screenshots(engine) {
  await shotsAll(engine, "tests", async (p) => { await tab(p, "tests"); await until(p, () => !!document.querySelector("#pnTests [data-act=mock]")); });
  await shotsAll(engine, "qbank", async (p) => { await tab(p, "tests"); await tap(p, '#smdPrep .pn-ttseg [data-v="qbank"]'); await until(p, () => !!document.querySelector("#pnTests.pn-qbank #pnGrid .pn-tile small")); await sleep(400); });
  await shotsAll(engine, "line-green", async (p) => { await startSet(p, "study"); await adv(p, 6000); });
  await shotsAll(engine, "line-amber", async (p) => { await startSet(p, "study"); await adv(p, 36000); });
  await shotsAll(engine, "line-red", async (p) => { await startSet(p, "study"); await adv(p, 52000); });
  await shotsAll(engine, "learning-feedback", async (p) => { await startSet(p, "study"); await tap(p, '#smdPrep .pn-opt[data-k="1"]'); await until(p, () => !!document.querySelector("#smdPrep .pn-fb")); await sleep(600); });
  await shotsAll(engine, "test-midrun", async (p) => { await startSet(p, "exam"); await tap(p, '#smdPrep .pn-opt[data-k="2"]'); await tap(p, "#smdPrep [data-act=next]"); await adv(p, 20000); });
  await shotsAll(engine, "result", async (p) => { await startSet(p, "exam"); await tap(p, '#smdPrep .pn-opt[data-k="0"]'); await p.evaluate(() => { const r = PREP._st.run; r.ans = r.ans.map((a, i) => (i % 3 ? 1 : 0)); }); await p.evaluate(() => document.querySelector("#smdPrep [data-act=qgrid]").click()); await until(p, () => !!document.querySelector("#smdPrep [data-act=submit]")); await tap(p, "#smdPrep [data-act=submit]"); await until(p, () => !!document.querySelector("#smdPrep .pn-score")); });
}

for (const engine of ENGINES) {
  await assertions(engine);
  // Reduced motion: the line steps (no drain animation on it).
  const s = await session(engine, { reduced: true });
  try {
    await s.page.evaluate(() => PREP.open({ query: "brachial plexus" }));
    await sheetReady(s.page); await tap(s.page, "#suGo"); await until(s.page, () => !!document.querySelector("#pnTl"));
    await adv(s.page, 4000);
    const m = await s.page.evaluate(() => { const f = document.querySelector("#pnTl .pn-tl-f"); return { anims: f.getAnimations().length, tf: f.style.transform, now: +document.querySelector("#pnTl").getAttribute("aria-valuenow") }; });
    const want = (m.now / 60).toFixed(4);
    ok(m.anims === 0 && m.tf === "scaleX(" + want + ")", engine + ": reduced motion: no drain animation, the line steps with the whole seconds: " + JSON.stringify(m));
  } finally { await s.browser.close(); }
  if (SHOTS) await screenshots(engine);
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
