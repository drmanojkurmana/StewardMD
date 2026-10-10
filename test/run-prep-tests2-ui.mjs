/* PrepNucleus Tests 2 (smd_prep_tests2; prep-tests.js, prep-assess.js, the locked-section runner in prep.js) in the REAL
 * app, Playwright Chromium (CHROME=<path>) and WebKit, iPhone-sized with touch, against a generated bank (19 MBBS subjects,
 * 2 modules of 60 questions each, plus 3 NEET-SS subjects). What must hold:
 *  - flag OFF (default): the Tests segment is the old one (NEET-PG "Full mock: 200 questions"), no Tests 2 card;
 *  - flag ON: Daily 10 card, NEET-PG (official, 180 in 5 locked sections of 36 / 42 min, +4/-1) and INI-CET cards, the
 *    previous-format practice link, practice tests; Progress score wording instead of readiness;
 *  - NEET-PG full exam: the pre-test screen shows 180 questions and the 5 sections; the runner shows Section A only
 *    (question 1 of 36, Previous disabled at its start, Submit section on its last question, the grid lists 36);
 *    a question of another section cannot be opened or answered; at 42:00 the section submits by itself and the
 *    summary locks it; Start Section B opens B with its own clock;
 *  - kill and reopen (page reload): Tests shows "Resume your ..." with the section and time left; Resume returns to
 *    Section B on the same question with the answers kept, and Section A stays locked;
 *  - submitting every section marks the test: the result has the NEET-PG marks, By section (5 rows), By subject, the
 *    build record; no rank or percentile;
 *  - Daily 10: exactly 10 questions; finishing counts it once ("Done today"); a second run is practice and the stored
 *    completion does not change;
 *  - FMGE: the pre-test screen says the test is shorter (radiotherapy has no questions) and why;
 *  - controls at least 44 px; no en or em dash on screen; no uncaught PrepNucleus error.
 * SHOTS=<dir>: 390x844 and 820x1180, light and dark. USAGE: node test/run-prep-tests2-ui.mjs (CHROME, ENGINES, SHOTS) */
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
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

const ORIGIN = "https://prep.test", BASE = ORIGIN + "/", ROOT = join(HERE, ".."), FIX = "/t2fix/";
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
function serveFile(route) {
  let p = decodeURIComponent(new URL(route.request().url()).pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = join(ROOT, p.replace(/^\/+/, ""));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: "" });
  const ext = (f.match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase();
  return route.fulfill({ status: 200, contentType: TYPES[ext] || "application/octet-stream", body: fs.readFileSync(f) });
}
/* ---- generated bank ---- */
const MBBS = ["anatomy", "physiology", "biochemistry", "pathology", "pharmacology", "microbiology", "forensic-medicine", "community-medicine", "ophthalmology", "ent", "medicine", "surgery", "obstetrics-gynaecology", "paediatrics", "orthopaedics", "dermatology", "psychiatry", "anaesthesia", "radiology"];
const SS = ["ss-cardiology", "ss-neurology", "ss-nephrology"];
const cap = (s) => s.replace(/^ss-/, "").split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
const subj = (id, ex) => ({ id, code: id.slice(0, 3), name: { en: cap(id) }, ex, sections: [{ id: id + "-s", name: { en: "Core" }, modules: [0, 1].map((k) => ({ id: id + "-m" + k, name: { en: cap(id) + " topic " + (k + 1) }, size: "m" })) }] });
const TAX = { v: 1, branches: [{ id: "mbbs", name: "MBBS", subjects: MBBS.map((s) => subj(s, ["neet-pg", "ini-cet"].concat(["anatomy", "physiology", "pathology", "pharmacology", "medicine"].includes(s) ? ["usmle"] : []))) }, { id: "ss-medicine", name: "SS", subjects: SS.map((s) => subj(s, ["neet-ss"])) }] };
const N = 60;
const index = (sid) => ({ id: sid, topics: [0, 1].map((k) => ({ id: sid + "-m" + k, title: { en: cap(sid) + " topic " + (k + 1) }, group: sid + "-s", count: N, all: N, usmle: 0, file: "mcq/" + sid + "-m" + k + ".json", size: "m" })), counts: { total: 2 * N } });
const modFile = (sid, mid) => { const items = []; for (let i = 0; i < N; i++) items.push({ id: mid + "-q" + i, q: "A patient case in " + cap(sid) + " (" + mid + ", item " + i + "): which is the most likely answer for this presentation?", o: ["Option alpha " + i, "Option beta " + i, "Option gamma " + i, "Option delta " + i], a: i % 4, exp: "Because the first clue points there.", t: mid, d: 1 + (i % 3) }); return { topic: mid, items }; };
function serveFix(route) {
  const p = new URL(route.request().url()).pathname.slice(FIX.length);
  let m;
  if (p === "taxonomy.json") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TAX) });
  if ((m = /^bank\/v1\/([a-z-]+)\/index\.json$/.exec(p))) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(index(m[1])) });
  if ((m = /^api\/v1\/([a-z-]+)\/mcq\/([a-z0-9-]+)\.json$/.exec(p))) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(modFile(m[1], m[2])) });
  if (p === "hidden.json") return route.fulfill({ status: 200, contentType: "application/json", body: '{"ids":[]}' });
  return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
}

let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

async function session(engine, opts) {
  const type = pw[engine];
  const launch = engine === "chromium" && process.env.CHROME ? { executablePath: process.env.CHROME } : {};
  const browser = await type.launch(launch);
  const vp = opts.vp || { width: 390, height: 844 };
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: vp.width < 700, hasTouch: true, serviceWorkers: "block",
    userAgent: engine === "webkit" ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" : undefined });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (/prep|PREP/.test(String(e && (e.stack || e.message)))) errors.push(String(e.message || e)); });
  await page.route(/^https:\/\/prep\.test\//, serveFile);
  await page.route(/^https:\/\/prep\.test\/api\//, (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.route(/^https:\/\/prep\.test\/t2fix\//, serveFix);
  page.statsPosts = [];
  await page.route(/^https:\/\/prep\.test\/api\/prep\/stats$/, (r) => { page.statsPosts.push({ body: r.request().postData(), headers: r.request().headers() }); return r.fulfill({ status: 202, contentType: "application/json", body: '{"accepted":1,"stored":false}' }); });
  await page.addInitScript(`window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.SMD_PREP_OVERLAYS={};
    window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false; window.__off=1000; window.SMD_PREP_NOW=function(){ return window.__off; };
    try{ localStorage.setItem("smd_prep","1"); ${opts.flag ? 'localStorage.setItem("smd_prep_tests2","1");' : 'localStorage.removeItem("smd_prep_tests2");'} if (!sessionStorage.getItem("pnt2")) { sessionStorage.setItem("pnt2","1"); ["smd_prep_v1","smd_prep_setup","smd_prep_tt"].forEach(function(k){ localStorage.removeItem(k); }); } }catch(e){}`);
  await boot(page, opts);
  return { browser, ctx, page, errors };
}
async function boot(page, opts) {
  await page.goto(BASE);
  await page.waitForFunction(() => !!(window.PREP && window.SMD_showHome), null, { timeout: 30000 });
  await page.evaluate((dark) => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); document.body.classList.toggle("dark", !!dark); }, !!opts.dark);
}
const until = async (page, fn, ms = 10000, arg) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
const tap = (page, sel) => page.evaluate((s) => { const b = document.querySelector(s); if (!b) return false; b.click(); return true; }, sel);
const tab = (page, id) => tap(page, '#smdPrep > nav.pnv .pnv-tab[data-tab="' + id + '"]');
const run = (page) => page.evaluate(() => { const r = PREP._st.run; return r ? { i: r.i, n: r.items.length, ans: r.ans.slice(), done: r.done, k: r.sc ? r.sc.k : -1, closed: r.sc ? r.sc.closed.slice() : [], phase: r.phase || "", left: r.sc ? PREP_ASSESS.scLeft(r.sc) : null } : null; });
const txt = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; }, sel);
const small = (page, scope) => page.evaluate((s) => [].filter.call(document.querySelectorAll(s + " button"), (b) => b.offsetParent && b.getBoundingClientRect().height < 44 * 0.95 - 0.5).map((b) => (b.getAttribute("data-act") || b.className) + ":" + Math.round(b.getBoundingClientRect().height)).join(","), scope);
const dashFree = (page) => page.evaluate((re) => !new RegExp(re).test(document.getElementById("smdPrep").innerText), DASH.source);
async function shot(page, name) { if (!SHOTS) return; await sleep(350); await page.screenshot({ path: join(SHOTS, name + ".png") }); }
async function openTests(page) {
  await page.evaluate(() => PREP.open());
  await until(page, () => !!document.querySelector("#pnHome"), 20000);
  await tab(page, "tests");
  return until(page, () => !!document.querySelector("#pnTests"), 10000);
}
async function startFromPre(page) {
  ok(await until(page, () => !!document.querySelector("[data-act=t2-go]"), 20000), "pre-test screen with Start");
  await tap(page, "[data-act=t2-go]");
  return until(page, () => !!(PREP._st.run && document.querySelector(".pn-run")), 10000);
}

async function flagOff(engine) {
  const { browser, page, errors } = await session(engine, { flag: false });
  const E = engine + " (flag off): ";
  try {
    await openTests(page);
    ok(await until(page, () => !!document.querySelector('#pnTests [data-act=mock][data-v="neet-pg"][data-k=full]')), E + "the old mock panels");
    const t = await txt(page, '#pnTests [data-act=mock][data-v="neet-pg"][data-k=full]');
    ok(/200 questions/.test(t), E + "NEET-PG full mock is still 200 questions: " + t);
    ok(!(await page.evaluate(() => !!document.querySelector("#pnTests .pn-t2c, #pnTests .pn-t2d"))), E + "no Tests 2 cards");
    ok(errors.length === 0, E + "no uncaught PrepNucleus error " + errors.join(" | "));
  } finally { await browser.close(); }
}

async function flagOn(engine) {
  const { browser, page, errors } = await session(engine, { flag: true });
  const E = engine + ": ";
  try {
    await openTests(page);
    ok(await until(page, () => !!document.querySelector("#pnTests .pn-t2d") && !!document.querySelector('#pnTests .pn-t2c[data-p="neet-pg"]')), E + "Daily 10 card and the NEET-PG card");
    const card = await txt(page, '#pnTests .pn-t2c[data-p="neet-pg"]');
    ok(/Official format/.test(card) && /180 questions in 5 locked sections of 36 questions and 42 min/.test(card) && /\+4 right, minus 1 wrong/.test(card) && /NEET-PG 2026 Information Bulletin/.test(card), E + "NEET-PG card: official 2026 format and its source: " + card.slice(0, 160));
    ok(/Previous format practice: 200 questions, one timer/.test(card), E + "the old 200-question pattern only as labelled previous-format practice");
    ok(!!(await page.evaluate(() => document.querySelector('#pnTests .pn-t2c[data-p="ini-cet"]'))), E + "INI-CET card");
    ok(await until(page, () => !!document.querySelector("#pnTests [data-act=t2-pick][data-k=subject_mini]")), E + "practice tests");
    ok((await small(page, "#pnTests")) === "", E + "Tests controls at least 44 px: " + (await small(page, "#pnTests")));
    ok(await dashFree(page), E + "no en or em dash on the Tests segment");
    await shot(page, engine + "-tests-390-light");

    // ---- NEET-PG full exam
    await tap(page, '#pnTests [data-act=t2-pre][data-p="neet-pg"][data-k=grand]');
    ok(await until(page, () => !!document.querySelector(".pn-t2pre .pn-t2secs"), 20000), E + "pre-test screen with the sections");
    const pre = await txt(page, ".pn-t2pre");
    ok(/Questions\s*180/.test(pre) && /5 locked sections/.test(pre) && (pre.match(/36 questions · 42:00/g) || []).length === 5, E + "pre-test: 180 questions, 5 x 36 x 42:00: " + pre.slice(0, 140));
    await shot(page, engine + "-pretest-neetpg-390-light");
    ok(await startFromPre(page), E + "the test starts");
    let r = await run(page);
    ok(r.n === 180 && r.k === 0 && r.i === 0, E + "180 questions, Section A open: " + JSON.stringify({ n: r.n, k: r.k, i: r.i }));
    const sub = await txt(page, ".pn-bar");
    ok(/Section A · question 1 of 36/.test(sub), E + "bar: Section A · question 1 of 36: " + sub);
    ok(await page.evaluate(() => document.querySelector("[data-act=prev]").disabled), E + "Previous disabled at the section's start");
    ok(await page.evaluate(() => document.querySelectorAll(".pn-secs li").length === 5 && document.querySelector(".pn-secs li.cur").textContent.indexOf("A") === 0), E + "section strip: 5, A current");
    ok(await page.evaluate(() => !document.querySelector("#smdPrep > nav.pnv:not(.pnv-off)")), E + "glass tab bar hidden in the runner");
    await tap(page, '[data-act=answer][data-k="1"]');
    await tap(page, "[data-act=next]");
    await tap(page, '[data-act=answer][data-k="2"]');
    await shot(page, engine + "-runner-sectionA-390-light");
    // jump to the last question of A
    await page.evaluate(() => { PREP._st.run.i = 35; PREP._host.rerender(); });
    ok(await until(page, () => !!document.querySelector("[data-act=secsubmit]")), E + "Submit section on the section's last question");
    // grid: 36 cells; a question of section B cannot be opened
    await tap(page, "[data-act=qgrid]");
    ok(await until(page, () => document.querySelectorAll(".pn-qgrid .pn-qn").length === 36), E + "the grid lists the 36 questions of Section A only");
    await page.evaluate(() => { const b = document.createElement("button"); b.setAttribute("data-act", "goq"); b.setAttribute("data-i", "40"); document.querySelector(".pn-qgrid").appendChild(b); b.click(); });
    r = await run(page);
    ok(r.i === 35, E + "a question of Section B cannot be opened from A: i=" + r.i);
    await page.evaluate(() => history.length && PREP.back());
    // time runs out: 42 minutes on the monotonic clock
    await page.evaluate(() => { window.__off += 42 * 60 * 1000 + 500; });
    ok(await until(page, () => PREP._st.run && PREP._st.run.phase === "between", 6000), E + "at 42:00 Section A submits by itself");
    ok(await until(page, () => !!document.querySelector(".pn-secsum [data-act=secstart]")), E + "the section summary with Start Section B");
    const sum = await txt(page, ".pn-secsum");
    ok(/Time up: submitted by itself/.test(sum) && /Section A is locked/.test(sum) && /Answered\s*2/.test(sum) && /You cannot return to Section A/.test(sum), E + "summary: locked, 2 answered: " + sum.slice(0, 160));
    await shot(page, engine + "-section-summary-390-light");
    // no answer reaches a closed section
    await page.evaluate(() => { PREP._st.run.i = 3; });
    await page.evaluate(() => { const b = document.createElement("button"); b.setAttribute("data-act", "answer"); b.setAttribute("data-k", "0"); document.querySelector(".pn-body").appendChild(b); b.click(); });
    r = await run(page);
    ok(r.ans[3] === -1, E + "no answer reaches a closed section");
    await tap(page, "[data-act=secstart]");
    r = await run(page);
    ok(r.k === 1 && r.i === 36 && r.closed[0] === true && r.left > 41 * 60e3, E + "Section B open at question 37 with its own 42 minutes: " + JSON.stringify({ k: r.k, i: r.i, left: r.left }));
    await page.evaluate(() => { PREP._st.run.i = 36; PREP._host.rerender(); });
    await tap(page, '[data-act=answer][data-k="3"]');
    await tap(page, "[data-act=next]");
    await page.evaluate(() => { window.__off += 5 * 60e3; });
    await sleep(1300);
    r = await run(page);
    const leftB = r.left;
    ok(leftB < 37.5 * 60e3, E + "B's clock ran 5 minutes: " + Math.round(leftB / 1000) + " s left");
    await sleep(5200);   // let the 5 s save happen

    // ---- kill and reopen
    await boot(page, {});
    await openTests(page);
    ok(await until(page, () => /Resume your/.test((document.querySelector("#pnT2Res") || {}).textContent || ""), 10000), E + "after a reload: the resume card");
    const res = await txt(page, "#pnT2Res");
    ok(/Resume your Full exam: NEET-PG/.test(res) && /Section B · \d+:\d\d left/.test(res), E + "resume card names the test, the section and the time left: " + res);
    await shot(page, engine + "-resume-390-light");
    await tap(page, "[data-act=t2-resume]");
    ok(await until(page, () => !!(PREP._st.run && document.querySelector(".pn-run")), 20000), E + "resumed into the runner");
    r = await run(page);
    ok(r.k === 1 && r.i === 37 && r.ans[36] === 3 && r.ans[0] === 1 && r.ans[1] === 2 && r.closed[0] === true, E + "same section, same question, answers kept, A locked: " + JSON.stringify({ k: r.k, i: r.i, a36: r.ans[36], a0: r.ans[0] }));
    ok(r.left <= leftB, E + "no time gained by the restart: " + Math.round(r.left / 1000) + " <= " + Math.round(leftB / 1000));
    // submit B, C, D, E
    for (let k = 1; k < 5; k++) {
      await page.evaluate(() => { const r0 = PREP._st.run, c = r0.secs[r0.sc.k]; r0.i = c.to - 1; PREP._host.rerender(); });
      await tap(page, "[data-act=secsubmit]");
      if (k < 4) { ok(await until(page, () => !!document.querySelector(".pn-secsum [data-act=secstart]")), E + "section " + "BCDE"[k - 1] + " submitted early"); await tap(page, "[data-act=secstart]"); }
    }
    ok(await until(page, () => !!document.querySelector(".pn-t2r"), 10000), E + "the test is marked");
    const rs = await txt(page, ".pn-body");
    ok(/\d+ \/ 720/.test(rs) && /By section/.test(rs) && /By subject, weakest first/.test(rs) && /How this test was built/.test(rs), E + "result: marks of 720, by section, by subject, the build record");
    ok(await page.evaluate(() => document.querySelectorAll(".pn-t2sec li").length === 5), E + "5 section rows");
    ok(!/percentile|predicted/i.test(rs.replace(/No national rank or percentile is shown[^.]*\./, "")), E + "no percentile or prediction");
    const rec = await page.evaluate(() => PREP._st.run.t2.rec);
    ok(rec.exam === "neet-pg" && rec.profile_version === "2026.1.0" && rec.by_section.length === 5 && rec.score.correct >= 0 && rec.items.length === 180, E + "result record: profile id and version, 5 sections");
    await shot(page, engine + "-result-neetpg-390-light");
    ok(!(await page.evaluate(() => PREP_TESTS._P.sess)), E + "the saved session is cleared after marking");
    await tap(page, "[data-act=donerun]");

    // ---- Daily 10
    await tab(page, "home"); await tab(page, "tests");
    ok(await until(page, () => !!document.querySelector('#pnTests [data-act=t2-pre][data-k=daily10]')), E + "Daily 10 start");
    await tap(page, '#pnTests [data-act=t2-pre][data-k=daily10]');
    ok(await startFromPre(page), E + "Daily 10 starts");
    r = await run(page);
    ok(r.n === 10, E + "Daily 10 has exactly 10 questions: " + r.n);
    const ids1 = await page.evaluate(() => PREP._st.run.items.map((x) => x.id).join());
    for (let i = 0; i < 10; i++) { await tap(page, '[data-act=answer][data-k="0"]'); if (i < 9) await tap(page, "[data-act=next]"); }
    await shot(page, engine + "-daily10-runner-390-light");
    await tap(page, "[data-act=submit]");
    ok(await until(page, () => /Daily 10 done for today/.test(document.querySelector(".pn-body").textContent)), E + "Daily 10 result: done for today");
    await shot(page, engine + "-daily10-result-390-light");
    // opt-in statistics: asked once; nothing sent before the yes; the body carries no identity
    ok(page.statsPosts.length === 0 && !!(await page.evaluate(() => document.querySelector(".pn-t2ask [data-act=t2-stats]"))), E + "statistics asked once on a result, nothing sent before");
    await tap(page, '.pn-t2ask [data-act=t2-stats][data-v="1"]');
    ok(await until(page, () => /statistics are on/.test(document.querySelector(".pn-t2ask").textContent)), E + "statistics: on");
    await sleep(300);
    const sp = page.statsPosts[0] ? JSON.parse(page.statsPosts[0].body) : null;
    ok(!!sp && sp.v === 1 && sp.exam === "neet-pg" && sp.items.length === 10 && Object.keys(sp).sort().join() === "exam,items,type,v" && !page.statsPosts[0].headers.authorization, E + "statistics: 10 rows, no identity: " + (sp ? Object.keys(sp).join() : "none"));
    const d1 = await page.evaluate(() => JSON.stringify(PREP._st.store.t2d));
    await tap(page, "[data-act=donerun]");
    await tab(page, "home"); await tab(page, "tests");
    ok(await until(page, () => /Done today/.test((document.querySelector("#pnTests .pn-t2d") || {}).textContent || "")), E + "the card says Done today");
    await tap(page, '#pnTests [data-act=t2-pre][data-k=daily10]');
    ok(await until(page, () => /already counted/.test((document.querySelector(".pn-t2pre") || {}).textContent || ""), 20000), E + "a second run says it is practice");
    await startFromPre(page);
    const ids2 = await page.evaluate(() => PREP._st.run.items.map((x) => x.id).join());
    ok(ids1 === ids2, E + "the same 10 questions all day");
    for (let i = 0; i < 10; i++) { await tap(page, '[data-act=answer][data-k="1"]'); if (i < 9) await tap(page, "[data-act=next]"); }
    await tap(page, "[data-act=submit]");
    ok(await until(page, () => /already counted/.test(document.querySelector(".pn-body").textContent)), E + "second result: practice");
    const d2 = await page.evaluate(() => JSON.stringify(PREP._st.store.t2d));
    ok(d1 === d2 && Object.keys(JSON.parse(d2)).length === 1, E + "one completion, unchanged by the retry");
    await tap(page, "[data-act=donerun]");

    // ---- FMGE: a shortened test says why
    await page.evaluate(() => PREP._host.setExam("fmge"));
    await tab(page, "home"); await tab(page, "tests");
    ok(await until(page, () => !!document.querySelector('#pnTests .pn-t2c[data-p="fmge"]')), E + "FMGE card");
    const fc = await txt(page, '#pnTests .pn-t2c[data-p="fmge"]');
    ok(/no negative marking/.test(fc) && /Pass mark 150 of 300/.test(fc) && /2 parts of 150/.test(fc) && /official blueprint/.test(fc), E + "FMGE card: 2 parts, no negative marking, pass mark, official blueprint");
    await tap(page, '#pnTests [data-act=t2-pre][data-p="fmge"][data-k=grand]');
    ok(await until(page, () => !!document.querySelector(".pn-t2pre .pn-t2dev"), 30000), E + "FMGE pre-test: deviations up front");
    const fp = await txt(page, ".pn-t2pre");
    ok(/Shorter than the blueprint/.test(fp) && /Radiotherapy: 5 planned by the official blueprint/.test(fp), E + "FMGE: shorter, radiotherapy named: " + fp.slice(0, 200));
    await shot(page, engine + "-pretest-fmge-390-light");
    ok(errors.length === 0, E + "no uncaught PrepNucleus error " + errors.join(" | "));
  } finally { await browser.close(); }
}

// Screens at other sizes and themes (Chromium only): Tests, a section run, the summary, the result.
async function shots(engine, vp, dark) {
  const { browser, page } = await session(engine, { flag: true, vp, dark });
  const tag = engine + "-" + vp.width + "-" + (dark ? "dark" : "light");
  try {
    await openTests(page);
    await until(page, () => !!document.querySelector('#pnTests .pn-t2c[data-p="neet-pg"]'));
    await shot(page, tag + "-tests");
    await tap(page, '#pnTests [data-act=t2-pre][data-p="neet-pg"][data-k=grand]');
    await until(page, () => !!document.querySelector("[data-act=t2-go]"), 20000);
    await shot(page, tag + "-pretest");
    await tap(page, "[data-act=t2-go]");
    await until(page, () => !!document.querySelector(".pn-run"));
    await tap(page, '[data-act=answer][data-k="1"]');
    await page.evaluate(() => { window.__off += 30 * 60e3; });
    await sleep(1300);
    await shot(page, tag + "-runner");
    await page.evaluate(() => { window.__off += 13 * 60e3; });
    await until(page, () => !!document.querySelector(".pn-secsum"), 5000);
    await shot(page, tag + "-summary");
    for (let k = 1; k < 5; k++) { await tap(page, "[data-act=secstart]"); await page.evaluate(() => { const r0 = PREP._st.run, c = r0.secs[r0.sc.k]; for (let i = c.from; i < c.to; i += 3) r0.ans[i] = i % 4; r0.i = c.to - 1; PREP._host.rerender(); }); await tap(page, "[data-act=secsubmit]"); await until(page, () => !!document.querySelector(".pn-secsum, .pn-t2r"), 5000); }
    await until(page, () => !!document.querySelector(".pn-t2r"), 5000);
    await shot(page, tag + "-result");
    await page.evaluate(() => { const b = document.querySelector(".pn-body"); b.scrollTop = 520; });
    await shot(page, tag + "-result-2");
  } finally { await browser.close(); }
}

for (const engine of ENGINES) {
  await flagOff(engine);
  await flagOn(engine);
}
if (SHOTS && ENGINES.includes("chromium")) {
  for (const dark of [false, true]) { await shots("chromium", { width: 390, height: 844 }, dark); await shots("chromium", { width: 820, height: 1180 }, dark); }
}
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
