/* PrepNucleus share IDs (prep-ids.js + prep-ids.css) in the REAL app, in Playwright Chromium AND WebKit (iPhone-sized,
 * touch), against the fixture bank in test/fixtures/prep and an ID index built here from those fixtures with the real
 * builder (tools/prep-ids.mjs assign + shards), served where the app looks for it (/api/prep/bank/v1/ids/ on the fixture
 * API base).
 * What must hold, in both engines:
 *  - the runner (practice) has a Share button (44 x 44) in its bar before and after the answer, and the question's ID
 *    under it; Share opens a sheet with the ID in large type, Copy ID and Share; the tab bar is not shown under it;
 *    Copy puts "Q-XXX-XXX-XXX" on the clipboard (Chromium reads it back) and the button says Copied; Share hands the
 *    native share the text "Try this PrepNucleus question: <ID> (search this ID in PrepNucleus)" and nothing else;
 *    Escape closes the sheet and focus returns to the Share button;
 *  - review after a set has Share and the ID; a lesson's reader has Share and its L- ID;
 *  - a subject search for an ID typed in lower case without hyphens opens exactly that question, unanswered, in
 *    practice; a pasted share message in the Go to ID screen (Menu > Open a shared ID) offers "Open <ID>";
 *  - the Go to ID screen: a typo says the ID looks wrong (inline, aria-invalid); a well-formed unknown ID says no
 *    question has it; a withdrawn ID (tombstone) and a flagged item say it is no longer available; a lesson ID opens
 *    the lesson at step 1 even when the phone had a later step saved; a PYQ item opens;
 *  - offline (every /api/ request fails): an ID of a module already on the phone still opens (hashed from IndexedDB),
 *    another says "Connect to open this question";
 *  - the free tier: with enforcement on and today's free questions used, an ID in a locked module shows the normal
 *    limit sheet, never the question;
 *  - PREP.open({ id }) (the stewardmd://prep/<ID> deep link) opens the question; no uncaught PrepNucleus error.
 * SHOTS=<dir>: screenshots (Chromium: 390x844, 430x932, 820x1180, light and dark) of the share sheet (question and
 * lesson), Go to ID (empty, error, pasted), search by ID and the error states.
 * USAGE: node test/run-prep-ids-ui.mjs   (CHROME=<path> for Chromium; PLAYWRIGHT_CORE=<path>; ENGINES=chromium,webkit)
 */
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import { assign, shards } from "../tools/prep-ids.mjs";

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, "..");
const ID = createRequire(import.meta.url)(join(ROOT, "prep-ids.js"));
const FIX = "/test/fixtures/prep/";
const SHOTS = process.env.SHOTS || "";
const ENGINES = (process.env.ENGINES || "chromium,webkit").split(",").map((s) => s.trim()).filter(Boolean);

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

const ORIGIN = "https://prep.test", BASE = ORIGIN + "/";
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
function serveFile(route) {
  let p = decodeURIComponent(new URL(route.request().url()).pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = join(ROOT, p.replace(/^\/+/, ""));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: "" });
  const ext = (f.match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase();
  return route.fulfill({ status: 200, contentType: TYPES[ext] || "application/octet-stream", body: fs.readFileSync(f) });
}
const fx = (p) => JSON.parse(fs.readFileSync(join(ROOT, FIX.slice(1), p), "utf8"));
// One real lesson (the shipped sample) stands in for the fixture modules' lessons.
const LESSON = fs.readFileSync(join(ROOT, "prep/lessons/v1/sur-breast-cancer.json"), "utf8");
const LESSONS_IX = { v: 1, modules: { "ana-brachial-plexus": { title: "Brachial plexus in five steps", minutes: 5, steps: 8, gen: "hand" }, "scd-hfref": { title: "Heart failure with reduced ejection fraction", minutes: 6, steps: 8, gen: "hand" } } };

// The ID index for the fixtures, built with the real builder.
const entries = [];
for (const [sid, mid] of [["anatomy", "ana-gametogenesis"], ["anatomy", "ana-brachial-plexus"], ["ss-cardiology", "scd-hfref"]]) for (const it of fx(`api/v1/${sid}/mcq/${mid}.json`).items) entries.push({ type: "Q", key: it.id, loc: `m:${sid}/${mid}` });
for (const it of fx("api/v2/pyq/items-0f0f0f01.json").items) entries.push({ type: "Q", key: it.id, loc: "p" });
for (const k of Object.keys(LESSONS_IX.modules)) entries.push({ type: "L", key: k, loc: "l:" + k });
const A = assign(entries);
const GONE = ID.idFor("Q", "withdrawn-item-1");
const IX = shards(A.ids, [GONE], { gen: "2026-10-10", n: A.ids.size, x: 1, xt: A.xt });
const FILES = Object.fromEntries(IX.files.map((f) => [f.name, f.body]));
const qid = (k) => ID.idOf("Q", k, A.xt), lid = (k) => ID.idOf("L", k, A.xt), show = ID.show;

let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

async function session(engine, opts = {}) {
  const launch = engine === "chromium" && process.env.CHROME ? { executablePath: process.env.CHROME } : {};
  const browser = await pw[engine].launch(launch);
  const vp = opts.vp || { width: 390, height: 844 };
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: opts.dpr || 2, isMobile: vp.width < 700, hasTouch: true, serviceWorkers: "block", colorScheme: opts.dark ? "dark" : "light", reducedMotion: opts.reduced ? "reduce" : "no-preference",
    userAgent: engine === "webkit" ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" : undefined });
  if (engine === "chromium") await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (/prep|PREP/.test(String(e && (e.stack || e.message)))) errors.push(String(e.message || e)); });
  const net = { off: false };
  await page.route(/^https:\/\/prep\.test\//, serveFile);
  await page.route(/^https:\/\/prep\.test\/api\//, (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.route(/\/test\/fixtures\/prep\/api\//, (r) => {
    if (net.off) return r.abort("internetdisconnected");
    const u = new URL(r.request().url()), m = /\/api\/v1\/ids\/(.+)$/.exec(u.pathname);
    if (m) { const name = m[1]; if (name === "index.json") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(IX.pointer) }); return FILES[name] ? r.fulfill({ status: 200, contentType: "application/json", body: FILES[name] }) : r.fulfill({ status: 404, body: "{}" }); }
    return serveFile(r);
  });
  await page.route(/\/prep\/lessons\/v1\/index\.json/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(LESSONS_IX) }));
  await page.route(/\/prep\/lessons\/v1\/(ana-brachial-plexus|scd-hfref)\.json/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: LESSON }));
  await page.addInitScript(`window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.SMD_PREP_LESSONS_BASE="/prep/lessons/"; window.SMD_PREP_PYQ_VER="v2";
    window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false; window.__shared=[];
    try { Object.defineProperty(navigator, "share", { configurable: true, value: function (d) { window.__shared.push(d); return Promise.resolve(); } }); } catch (e) {}
    try{ localStorage.setItem("smd_prep","1"); ${opts.pro ? 'localStorage.setItem("smd_prep_pro_enforce","1");' : ""} if (!sessionStorage.getItem("pnids")) { sessionStorage.setItem("pnids","1"); localStorage.removeItem("smd_prep_v1"); } }catch(e){}`);
  await page.goto(BASE);
  await page.waitForFunction(() => !!(window.PREP && window.SMD_showHome), null, { timeout: 30000 });
  await page.evaluate((dark) => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); document.body.classList.toggle("dark", !!dark); }, !!opts.dark);
  return { browser, ctx, page, errors, net };
}
const until = async (page, fn, ms = 10000, arg) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
const settle = (page) => page.evaluate(() => new Promise((r) => { document.getAnimations().forEach((a) => { try { const t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); setTimeout(r, 500); }));
const click = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) throw new Error("no " + s); e.click(); }, sel);
const openHome = async (page) => { await page.evaluate(() => PREP.open()); return until(page, () => !!document.querySelector("#pnHome"), 20000); };
const runItem = (page) => page.evaluate(() => { const r = PREP._st.run; return r ? { id: r.items[r.i].id, n: r.items.length, ans: r.ans[r.i], mode: r.mode, done: r.done } : null; });
const resText = (page) => page.evaluate(() => { const e = document.querySelector("#smdPrep .pi-res"); return e ? e.textContent.replace(/\s+/g, " ").trim() : ""; });
// Go to ID: Menu > Open a shared ID, type, submit.
async function goType(page, text) {
  if (!(await page.evaluate(() => !!document.querySelector("#piIn")))) {
    await page.evaluate(() => PREP._host.push(() => {}));   // a screen to come back to
    await page.evaluate(() => PREP_IDS.goScreen(PREP._host, "", ""));
    await until(page, () => !!document.querySelector("#piIn"), 5000);
  }
  await page.fill("#piIn", text);
  await page.evaluate(() => document.querySelector("#piForm").requestSubmit());
}
async function home(page) { await page.evaluate(() => { PREP._st.run = null; PREP._st.stack.length = 0; PREP._host.push(PREP._host.home); }); await until(page, () => !!document.querySelector("#pnHome"), 5000); }

async function assertions(engine) {
  const { browser, page, errors, net } = await session(engine);
  const E = engine + ": ";
  try {
    ok(await openHome(page), E + "PrepNucleus opens");
    ok(await page.evaluate(() => !!window.PREP_IDS && !!document.querySelector('link[data-prep="prep-ids.css"]')), E + "prep-ids.js and prep-ids.css load");

    // ---- open by ID (deep link path), the runner's Share and chip
    const g2 = qid("ana-gametogenesis-q2");
    await page.evaluate((id) => PREP.open({ id }), show(g2).toLowerCase());
    ok(await until(page, () => !!(PREP._st.run && document.querySelector("#smdPrep .pn-run .pn-opt")), 10000), E + "PREP.open({ id }) while open opens the question");
    let r = await runItem(page);
    ok(r && r.id === "ana-gametogenesis-q2" && r.n === 1 && r.ans === -1 && r.mode === "study", E + "exactly that question, alone, unanswered, in practice (" + JSON.stringify(r) + ")");
    const bar = await page.evaluate(() => { const b = document.querySelector("#smdPrep > .pn-bar [data-act=id-share]"); const c = document.querySelector("#smdPrep .pn-run .pi-chip"); const rr = b && b.getBoundingClientRect(), cr = c && c.getBoundingClientRect(); return b && c ? { w: rr.width, h: rr.height, label: b.getAttribute("aria-label"), v: b.getAttribute("data-v"), chip: c.textContent.replace(/\s+/g, ""), ch: cr.height } : null; });
    ok(bar && bar.w >= 44 && bar.h >= 44 && bar.label === "Share this question" && bar.v === g2, E + "Share in the bar, 44 x 44, labelled (" + JSON.stringify(bar) + ")");
    ok(bar && bar.chip === "ID" + show(g2) && bar.ch >= 44, E + "the ID shows under the question, 44 px tall (" + (bar && bar.chip) + ")");
    await click(page, "#smdPrep > .pn-bar [data-act=id-share]");
    ok(await until(page, () => !!document.querySelector("#smdPrep > #piSheet .pi-sheet"), 4000), E + "Share opens the sheet");
    const sh = await page.evaluate(() => { const s = document.querySelector("#piSheet"); const code = s.querySelector(".pi-code span"); return { id: code.textContent, size: parseFloat(getComputedStyle(code).fontSize), btns: [].map.call(s.querySelectorAll(".pn-sheet-act .pn-btn"), (b) => b.textContent.trim()), dlg: s.querySelector("[role=dialog]").getAttribute("aria-modal"), focus: document.activeElement && document.activeElement.getAttribute("data-act"), nav: !!document.querySelector("#smdPrep > nav.pnv:not(.pnv-off)") }; });
    ok(sh.id === show(g2) && sh.size >= 28 && sh.dlg === "true", E + "the sheet shows the ID in large type (" + sh.id + ", " + sh.size + " px)");
    ok(sh.btns.join("|") === "Share|Copy ID" && sh.focus === "id-send" && !sh.nav, E + "Share and Copy ID, focus on Share, no tab bar under it (" + sh.btns.join("|") + ")");
    await click(page, "#piSheet [data-act=id-copy]");
    ok(await until(page, () => /Copied/.test(document.querySelector("#piSheet .pi-copy").textContent), 3000), E + "Copy ID says Copied");
    if (engine === "chromium") ok((await page.evaluate(() => navigator.clipboard.readText())) === show(g2), E + "the clipboard holds the ID only");
    await click(page, "#piSheet [data-act=id-send]");
    await sleep(200);
    const shared = await page.evaluate(() => window.__shared);
    ok(shared.length === 1 && shared[0].text === "Try this PrepNucleus question: " + show(g2) + " (search this ID in PrepNucleus)" && !/http/.test(JSON.stringify(shared)), E + "Share sends the ID and how to use it, no link (" + JSON.stringify(shared[0]) + ")");
    await page.keyboard.press("Escape");
    ok(await until(page, () => !document.querySelector("#piSheet") && document.activeElement && document.activeElement.getAttribute("data-act") === "id-share", 3000), E + "Escape closes the sheet, focus back on Share");
    ok(!!(await runItem(page)), E + "the question is still there after the sheet");
    // answer, then the feedback still has Share and the ID
    await click(page, "#smdPrep .pn-opt[data-k='0']");
    ok(await until(page, () => !!document.querySelector("#smdPrep .pn-fb") && !!document.querySelector("#smdPrep > .pn-bar [data-act=id-share]") && !!document.querySelector("#smdPrep .pn-run .pi-chip"), 4000), E + "feedback: Share and the ID stay");
    // the chip copies
    await click(page, "#smdPrep .pn-run .pi-chip");
    ok(await until(page, () => /Copied/.test(document.querySelector("#smdPrep .pi-chip").textContent), 3000), E + "tapping the ID copies it (says Copied)");
    // finish, review
    await click(page, "#smdPrep [data-act=next]");
    ok(await until(page, () => !!(PREP._st.run && PREP._st.run.done) && !!document.querySelector("#smdPrep [data-act=reviewq]"), 6000), E + "the set finishes with a review list");
    await click(page, "#smdPrep [data-act=reviewq]");
    ok(await until(page, () => { const b = document.querySelector("#smdPrep > .pn-bar [data-act=id-share]"); return !!b && b.getAttribute("data-v") === document.querySelector("#smdPrep .pi-chip").getAttribute("data-v"); }, 4000), E + "review: Share and the same ID");

    // ---- search by ID: lower case, no hyphens, O for 0
    await home(page);
    await page.evaluate(() => PREP._host.push(() => {}));
    const b3 = qid("ana-brachial-plexus-q3");
    await page.evaluate(() => { const b = document.createElement("button"); b.setAttribute("data-act", "search"); b.setAttribute("data-s", "anatomy"); document.querySelector("#smdPrep").appendChild(b); b.click(); b.remove(); });
    const hasSearch = await until(page, () => !!document.querySelector("#pnSearch"), 5000);
    ok(hasSearch, E + "subject search opens");
    if (hasSearch) {
      await page.fill("#pnSearch", b3.toLowerCase().replace(/0/g, "o"));
      ok(await until(page, (v) => { const h = document.querySelector("#pnHits [data-act=id-go]"); return !!h && h.getAttribute("data-v") === v; }, 5000, b3), E + "search shows Open <ID> for a typed ID (lower case, no hyphens, O for 0)");
      await click(page, "#pnHits [data-act=id-go]");
      ok(await until(page, () => !!(PREP._st.run && document.querySelector("#smdPrep .pn-run .pn-opt")), 8000), E + "it opens the question");
      r = await runItem(page);
      ok(r && r.id === "ana-brachial-plexus-q3" && r.ans === -1, E + "exactly that question, unanswered (" + (r && r.id) + ")");
      await page.evaluate(() => PREP.back());
      ok(await until(page, () => !!document.querySelector("#pnSearch"), 4000), E + "back from the shared question returns to the search");
      await page.fill("#pnSearch", "q-8k3-m7t-x2d");
      ok(await until(page, () => /looks wrong/.test((document.querySelector("#pnHits") || {}).textContent || ""), 4000), E + "a hyphenated ID with a typo says it looks wrong");
      await page.fill("#pnSearch", "Q fever");
      ok(await until(page, () => !document.querySelector("#pnHits [data-act=id-go]") && !/looks wrong/.test(document.querySelector("#pnHits").textContent), 4000), E + "a word search is still a word search");
    }

    // ---- Go to ID: menu row, errors, unknown, withdrawn, flagged, lesson, PYQ
    await home(page);
    await click(page, "#smdPrep [data-act=menu]");
    ok(await until(page, () => !!document.querySelector("#smdPrep [data-act=id-screen]"), 4000), E + "Menu has Open a shared ID");
    await click(page, "#smdPrep [data-act=id-screen]");
    ok(await until(page, () => !!document.querySelector("#piIn"), 4000), E + "it opens the Go to ID screen");
    const inp = await page.evaluate(() => { const i = document.querySelector("#piIn"); return { fs: parseFloat(getComputedStyle(i).fontSize), cap: i.getAttribute("autocapitalize"), sc: i.getAttribute("spellcheck"), label: !!document.querySelector("label[for=piIn]"), h: i.getBoundingClientRect().height }; });
    ok(inp.fs >= 16 && inp.cap === "characters" && inp.sc === "false" && inp.label && inp.h >= 44, E + "the field: labelled, 16 px+, capitals, no spellcheck, 44 px+ (" + JSON.stringify(inp) + ")");
    const typo = show(b3).slice(0, -1) + ID.ALPHA[(ID.ALPHA.indexOf(b3.slice(-1)) + 1) % 32];
    await goType(page, typo);
    ok(await until(page, () => { const i = document.querySelector("#piIn"), e = document.querySelector("#piErr"); return !!e && /looks wrong/.test(e.textContent) && i.getAttribute("aria-invalid") === "true" && i.getAttribute("aria-describedby") === "piErr"; }, 4000), E + "a typo says the ID looks wrong, inline and tied to the field");
    await goType(page, "Q-8K3-M7T-X26");
    ok(await until(page, () => /No question has this ID/.test((document.querySelector("#smdPrep .pi-res") || {}).textContent || ""), 6000), E + "a well-formed unknown ID: No question has this ID");
    await page.evaluate(() => PREP.back());
    await goType(page, show(GONE));
    ok(await until(page, () => /no longer available/.test((document.querySelector("#smdPrep .pi-res") || {}).textContent || ""), 6000), E + "a withdrawn ID (tombstone): no longer available");
    await page.evaluate(() => PREP.back());
    await goType(page, show(qid("flagged-item-1")));
    ok(await until(page, () => /no longer available/.test((document.querySelector("#smdPrep .pi-res") || {}).textContent || ""), 6000) && !(await runItem(page)), E + "a flagged item: no longer available, never shown");
    await page.evaluate(() => PREP.back());
    // a lesson the phone had at step 3 opens at step 1
    await page.evaluate(() => { const s = PREP._host.store(); s.ls = s.ls || {}; s.ls["ana-brachial-plexus"] = { i: 2 }; PREP._host.save(); });
    await goType(page, show(lid("ana-brachial-plexus")).toLowerCase());
    ok(await until(page, () => !!document.querySelector("#smdPrep .pn-lsn-step") && /Step 1 of/.test(document.querySelector("#smdPrep > .pn-bar").textContent), 8000), E + "a lesson ID opens the lesson at step 1");
    const lb = await page.evaluate(() => { const b = document.querySelector("#smdPrep > .pn-bar [data-act=id-share]"), c = document.querySelector("#smdPrep .pn-lsn .pi-chip"); return { v: b && b.getAttribute("data-v"), label: b && b.getAttribute("aria-label"), chip: c && c.getAttribute("data-v") }; });
    ok(lb.v === lid("ana-brachial-plexus") && lb.label === "Share this lesson" && lb.chip === lb.v, E + "the lesson has Share and its L- ID (" + JSON.stringify(lb) + ")");
    await click(page, "#smdPrep > .pn-bar [data-act=id-share]");
    ok(await until(page, (v) => { const c = document.querySelector("#piSheet .pi-code span"); return !!c && c.textContent === v && /Share this lesson/.test(document.querySelector("#piSheetT").textContent); }, 4000, show(lid("ana-brachial-plexus"))), E + "the lesson share sheet shows the L- ID");
    await page.evaluate(() => PREP.back());
    await home(page);
    await goType(page, show(qid("pyq-fx-2025-r1-1")));
    ok(await until(page, () => !!(PREP._st.run && PREP._st.run.items[0].id === "pyq-fx-2025-r1-1"), 8000), E + "a previous-year question ID opens it");

    // ---- paste a whole share message
    if (engine === "chromium") {
      await home(page);
      await page.evaluate((t) => navigator.clipboard.writeText(t), "Try this PrepNucleus question: " + show(b3).toLowerCase() + " (search this ID in PrepNucleus)");
      await page.evaluate(() => PREP._host.push(() => {}));
      await page.evaluate(() => PREP_IDS.goScreen(PREP._host, "", ""));
      await until(page, () => !!document.querySelector("#piIn"), 4000);
      await click(page, "#smdPrep [data-act=id-paste]");
      ok(await until(page, (v) => { const h = document.querySelector("#smdPrep .pi-hint"); return !!h && h.getAttribute("data-v") === v && document.querySelector("#piIn").value === PREP_IDS._pure.show(v); }, 4000, b3), E + "Paste finds the ID in a pasted message and offers Open <ID>");
    }

    // ---- offline: a module on the phone opens from IndexedDB, another says connect
    await home(page);
    await page.evaluate(() => { PREP_IDS._i.ptr = null; });
    net.off = true;
    await goType(page, show(qid("ana-gametogenesis-q5")));
    ok(await until(page, () => !!(PREP._st.run && PREP._st.run.items[0].id === "ana-gametogenesis-q5"), 8000), E + "offline: an ID of a module already on the phone opens");
    await home(page);
    await goType(page, show(qid("scd-hfref-q1")));
    ok(await until(page, () => /Connect to open this question/.test((document.querySelector("#smdPrep .pi-res") || {}).textContent || ""), 8000), E + "offline: a question not on the phone says Connect to open this question (" + (await resText(page)).slice(0, 80) + ")");
    net.off = false;
    await click(page, "#smdPrep [data-act=id-retry]");
    ok(await until(page, () => !!(PREP._st.run && PREP._st.run.items[0].id === "scd-hfref-q1"), 8000), E + "Try again online opens it");
    ok(errors.length === 0, E + "no uncaught PrepNucleus error " + JSON.stringify(errors.slice(0, 3)));
  } catch (e) { ok(false, E + "harness: " + (e && e.stack || e)); }
  finally { await browser.close(); }
}

async function proCheck(engine) {
  const { browser, page, errors } = await session(engine, { pro: true });
  const E = engine + ": ";
  try {
    await openHome(page);
    await page.evaluate(() => { const d = new Date(), p = (n) => (n < 10 ? "0" : "") + n; localStorage.setItem("smd_prep_pro_day", JSON.stringify({ d: d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()), questions: 50, cards: 10, lessons: { x: 1 } })); });
    await page.evaluate((id) => PREP.open({ id }), show(qid("ana-brachial-plexus-q1")));
    ok(await until(page, () => !!document.querySelector("#smdPrep > #ppSheet"), 8000) && !(await runItem(page)), E + "free tier used up: an ID in a locked module shows the limit sheet, not the question");
    await page.evaluate(() => PREP.back());
    await page.evaluate((id) => PREP.open({ id }), show(lid("ana-brachial-plexus")));
    ok(await until(page, () => !!document.querySelector("#smdPrep > #ppSheet") && !document.querySelector("#smdPrep .pn-lsn-step"), 8000), E + "and a lesson ID shows the limit sheet, not the lesson");
    await page.evaluate(() => PREP.back());
    await page.evaluate((id) => PREP.open({ id }), show(qid("ana-gametogenesis-q1")));
    ok(await until(page, () => !!(PREP._st.run && PREP._st.run.items[0].id === "ana-gametogenesis-q1"), 8000), E + "an ID in an open (free) module still opens");
    ok(errors.length === 0, E + "no uncaught PrepNucleus error (free tier)");
  } catch (e) { ok(false, E + "harness: " + (e && e.stack || e)); }
  finally { await browser.close(); }
}

async function shots(engine) {
  for (const [w, h] of [[390, 844], [430, 932], [820, 1180]]) for (const dark of [false, true]) {
    const { browser, page, net } = await session(engine, { vp: { width: w, height: h }, dark, dpr: w < 700 ? 2 : 1 });
    const tag = w + "x" + h + "-" + (dark ? "dark" : "light"), shot = async (n) => { await settle(page); await page.screenshot({ path: join(SHOTS, tag + "-" + n + ".png") }); };
    try {
      await openHome(page);
      await page.evaluate((id) => PREP.open({ id }), show(qid("ana-gametogenesis-q2")));
      await until(page, () => !!PREP._st.run, 8000); await shot("01-question");
      await click(page, "#smdPrep > .pn-bar [data-act=id-share]"); await until(page, () => !!document.querySelector("#piSheet"), 3000); await shot("02-share-sheet");
      await click(page, "#piSheet [data-act=id-copy]"); await sleep(150); await shot("03-share-copied");
      await page.keyboard.press("Escape");
      await click(page, "#smdPrep .pn-opt[data-k='1']"); await sleep(300); await page.evaluate(() => { const b = document.querySelector("#smdPrep > .pn-body"); b.scrollTop = b.scrollHeight; }); await shot("04-feedback-id");
      await home(page);
      await page.evaluate(() => { const b = document.createElement("button"); b.setAttribute("data-act", "search"); b.setAttribute("data-s", "anatomy"); document.querySelector("#smdPrep").appendChild(b); b.click(); b.remove(); });
      await until(page, () => !!document.querySelector("#pnSearch"), 4000);
      await page.fill("#pnSearch", show(qid("ana-brachial-plexus-q3")).toLowerCase()); await until(page, () => !!document.querySelector("#pnHits [data-act=id-go]"), 4000); await page.evaluate(() => document.activeElement.blur()); await shot("05-search-by-id");
      await home(page); await page.evaluate(() => PREP._host.push(() => {})); await page.evaluate(() => PREP_IDS.goScreen(PREP._host, "", "")); await until(page, () => !!document.querySelector("#piIn"), 3000); await page.evaluate(() => document.activeElement.blur()); await shot("06-go-empty");
      await page.fill("#piIn", "Q-8K3-M7T-X2D"); await page.evaluate(() => document.querySelector("#piForm").requestSubmit()); await until(page, () => !!document.querySelector("#piErr"), 3000); await page.evaluate(() => document.activeElement.blur()); await shot("07-go-typo");
      if (engine === "chromium") { await page.evaluate((t) => navigator.clipboard.writeText(t), "Try this PrepNucleus question: " + show(qid("ana-brachial-plexus-q3")) + " (search this ID in PrepNucleus)"); await page.fill("#piIn", ""); await click(page, "#smdPrep [data-act=id-paste]"); await until(page, () => !!document.querySelector(".pi-hint"), 3000); await page.evaluate(() => document.activeElement.blur()); await shot("08-go-pasted"); }
      await page.fill("#piIn", "Q-8K3-M7T-X26"); await page.evaluate(() => document.querySelector("#piForm").requestSubmit()); await until(page, () => /No question/.test(document.querySelector("#smdPrep").textContent), 5000); await shot("09-unknown");
      await page.evaluate(() => PREP.back()); await page.fill("#piIn", show(GONE)); await page.evaluate(() => document.querySelector("#piForm").requestSubmit()); await until(page, () => /no longer/.test(document.querySelector("#smdPrep").textContent), 5000); await shot("10-withdrawn");
      await page.evaluate(() => PREP.back()); net.off = true; await page.evaluate(() => { PREP_IDS._i.ptr = null; }); await page.fill("#piIn", show(qid("scd-hfref-q1"))); await page.evaluate(() => document.querySelector("#piForm").requestSubmit()); await until(page, () => /Connect to open/.test(document.querySelector("#smdPrep").textContent), 6000); await shot("11-offline"); net.off = false;
      await page.evaluate(() => PREP.back()); await page.fill("#piIn", show(lid("ana-brachial-plexus"))); await page.evaluate(() => document.querySelector("#piForm").requestSubmit()); await until(page, () => !!document.querySelector("#smdPrep .pn-lsn-step"), 6000); await shot("12-lesson");
      await click(page, "#smdPrep > .pn-bar [data-act=id-share]"); await until(page, () => !!document.querySelector("#piSheet"), 3000); await shot("13-lesson-share");
      // the finding screen, held on a slow index
      await page.keyboard.press("Escape"); await home(page);
      await page.route(/\/v1\/ids\/index\.json/, async (r) => { await sleep(4000); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(IX.pointer) }); });
      await page.evaluate(() => { PREP_IDS._i.ptr = null; });
      await page.evaluate((id) => PREP.open({ id }), show(qid("ana-gametogenesis-q4"))); await sleep(400); await page.screenshot({ path: join(SHOTS, tag + "-14-finding.png") });
    } catch (e) { console.log("shots " + tag + ": " + (e && e.message)); }
    finally { await browser.close(); }
  }
}

try {
  for (const e of ENGINES) { await assertions(e); await proCheck(e); }
  if (SHOTS) await shots(ENGINES.includes("chromium") ? "chromium" : ENGINES[0]);
} catch (e) { console.log("FAIL harness: " + (e && e.stack || e)); fails++; }
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
