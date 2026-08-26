/* KardiQ X Learn-progress UI test (real headless browser, real localStorage, real DOM).
 *
 * The 2026-08-26 sweep unfroze KardiQ's Learn state, but until now it rested on unit tests plus a
 * one-string UI edit. This drives the ACTUAL library screen (render08) in Chrome and pins the four
 * things that were broken, each of which fails on the pre-sweep build:
 *
 *   1. progress ring denominator was a hardcoded 100 against a 1,141-lesson library  -> "of N"
 *   2. status/masteryPct came from the READ-ONLY shipped record, so every row said "new · 0%" forever
 *   3. bookmarks were written into that same in-memory record, so they died on reload
 *   4. the pack is all tier:"atlas" and no Atlas chip shipped, so every tier filter hid all of it
 *
 * Providers are swapped for a deterministic 5-lesson fixture via SMD_KARDIOX_PROVIDERS.use(), so the
 * assertions are exact numbers rather than "whatever the 1.9 MB pack currently holds". Everything
 * under test - the overlay, the store, the screen - is the real shipped code.
 *
 * USAGE: node test/run-kardiox-progress-ui.mjs        (BASE=http://localhost:8993/ to reuse a server)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8993/").replace(/\/?$/, "/");
const PORT = 9387, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/kx-progress-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/* Deterministic fixture. Mirrors the shipped pack's shape EXACTLY: status:"new" / masteryPct:0 are
 * baked into the record, which is the whole reason the rows used to freeze. 5 lessons -> the ring
 * must read "of 5"; the 2 tier:"atlas" ones are what the Atlas chip has to surface. */
const CONTENT = [
  { id: "l1", title: "Atrial fibrillation", category: "Rhythms", tier: "core", status: "new", masteryPct: 0, ecgFindingTags: ["Irregular R-R"] },
  { id: "l2", title: "Sinus bradycardia", category: "Rhythms", tier: "core", status: "new", masteryPct: 0, ecgFindingTags: ["Slow rate"] },
  { id: "e1", title: "Anterior STEMI", category: "Ischemia", tier: "emergency", status: "new", masteryPct: 0, ecgFindingTags: ["ST elevation"] },
  { id: "a1", title: "Atlas case 001", category: "Atlas", tier: "atlas", status: "new", masteryPct: 0, ecgFindingTags: ["Atlas"] },
  { id: "a2", title: "Atlas case 002", category: "Atlas", tier: "atlas", status: "new", masteryPct: 0, ecgFindingTags: ["Atlas"] },
];
const PKEY = "smd_kardiox_progress_v1";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8993"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

/* Fresh target each time — a new target is a genuinely fresh page load, but the browser profile (and
 * therefore localStorage for this origin) is shared, which is exactly what the reload test needs. */
async function attach(url) {
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url });
  for (let i = 0; i < 75; i++) {
    await sleep(400);
    if (await ev(`return !!(window.KARDIOX && window.SMD_KARDIOX_PROVIDERS && window.SMD_KARDIOX_ROUTER)`) === true) return true;
  }
  return false;
}

/* Inject the fixture providers, open the module, and land on the library screen. `seedProgress`
 * false leaves whatever localStorage already holds (the reload leg depends on that). */
async function openLibrary(seedProgress) {
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  if (seedProgress) {
    // l1 mastered, nothing else. The overlay must lift this onto the row; the record still says "new".
    await ev(`localStorage.setItem(${JSON.stringify(PKEY)}, JSON.stringify({mastered:{l1:1},masteredOn:{l1:{"2020-01-01":1,"2020-01-02":1}},bookmarks:{},topics:{},dailyDone:{},seen:2,correct:2,quizzes:1,maxStreak:0})); return 1;`);
  }
  /* open() FIRST. It fires checkBackend()/checkModelLab(), and checkBackend nulls the active
   * assembly when its health probe settles ("force rebuild with the chosen analyzer") — injecting
   * before open() gets silently discarded a beat later. ?kardioxbackend=0 makes it early-return,
   * and injecting afterwards is belt-and-braces. */
  await ev(`KARDIOX.open(); return 1;`);
  await sleep(400);
  // Keep the exact array we handed in, so we can prove afterwards that nothing mutated it.
  await ev(`window.__kxContent = ${JSON.stringify(CONTENT)}; SMD_KARDIOX_PROVIDERS.use(SMD_KARDIOX_PROVIDERS.mockProviders({ content: window.__kxContent })); return 1;`);
  await ev(`SMD_KARDIOX_ROUTER.nav("library"); return 1;`);
  for (let i = 0; i < 40; i++) { await sleep(200); if (await ev(`return !!document.querySelector("#kxLibChips");`) === true) break; }
  await sleep(300);
}

const rowSub = (id) => `var r=document.querySelector('.kx-lib-row[data-id="${id}"]'); return r ? r.querySelector('.kx-lib-row-s').textContent.trim() : null;`;
const shownIds = `return [...document.querySelectorAll('.kx-lib-row')].map(function(r){return r.getAttribute('data-id');}).join(",");`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  ok(await attach(BASE + "?kardiox=1&kardioxbackend=0&mlab=0"), "app loads with KardiQ enabled (?kardiox=1)");
  // Start from a clean slate so a previous run's bookmarks/mastery cannot fake a pass.
  await ev(`localStorage.removeItem(${JSON.stringify(PKEY)}); return 1;`);
  await openLibrary(true);
  ok(await ev(`return !!document.querySelector("#kxLibSections .kx-lib-row");`) === true, "library screen renders lesson rows");

  // ── 1. the ring counts against the REAL library size, not a hardcoded 100 ──
  ok(await ev(`var e=document.querySelector(".kx-lib-ring-of"); return e ? e.textContent.trim() : "";`) === "of 5",
    'progress ring denominator is the library size ("of 5"), not the frozen 100');
  ok(await ev(`var e=document.querySelector(".kx-lib-ring-num"); return e ? e.textContent.trim() : "";`) === "1",
    "ring numerator reflects the one lesson mastered in the store");

  // ── 2. per-lesson state is overlaid from the store, and the shipped record is left alone ──
  ok((await ev(rowSub("l1")) || "").indexOf("mastered") >= 0,
    'a lesson mastered in localStorage renders as "mastered" (was frozen at "new")');
  ok(await ev(`return !!document.querySelector('.kx-lib-row[data-id="l1"] .kx-lib-check');`) === true,
    "the mastered row gets its check_circle affordance");
  ok((await ev(rowSub("l2")) || "").indexOf("mastered") === -1,
    "a lesson with no stored mastery is left untouched");
  ok(await ev(`return window.__kxContent.filter(function(e){return e.id==="l1";})[0].status;`) === "new",
    "the overlay never mutates the shipped content record (still status:new)");

  // ── 4. the Atlas chip exists and actually surfaces the tier:"atlas" lessons ──
  ok(await ev(`return !!document.querySelector('.kx-lib-chip[data-tier="atlas"]');`) === true,
    "the Atlas tier chip is present");
  ok(await ev(`return document.querySelectorAll('.kx-lib-row').length;`) === 5, "All chip shows every lesson");
  await ev(`document.querySelector('.kx-lib-chip[data-tier="atlas"]').click(); return 1;`); await sleep(300);
  ok(await ev(shownIds) === "a1,a2", "Atlas chip filters to exactly the tier:atlas lessons (was: hid all of them)");
  await ev(`document.querySelector('.kx-lib-chip[data-tier="core"]').click(); return 1;`); await sleep(300);
  ok(await ev(shownIds) === "l1,l2", "Core chip still filters correctly (the new chip did not break the others)");

  // ── 3. a bookmark set on the lesson screen SURVIVES a full page reload ──
  await ev(`document.querySelector('.kx-lib-chip[data-tier="all"]').click(); return 1;`); await sleep(200);
  /* Click the ROW, never nav("lesson") directly: the row carries data-id, and the router's
   * kxnav:lesson case is what sets state.lessonId. Navigating first opens render09's AF fallback
   * ('rhythms-af'), which is a different lesson with bookmarked:true baked in. */
  await ev(`var r=document.querySelector('.kx-lib-row[data-id="a1"]'); if(r) r.click(); return 1;`);
  await sleep(800);
  ok(await ev(`return !!document.querySelector('[data-act="kx-bookmark"]');`) === true, "lesson screen opens for a1");
  ok(await ev(`return document.querySelector('[data-act="kx-bookmark"]').getAttribute("aria-pressed");`) === "false",
    "a1 starts un-bookmarked (the overlay supplies the real false, not the AF default's true)");
  const bmA1 = `return JSON.parse(localStorage.getItem(${JSON.stringify(PKEY)})||"{}").bookmarks;`;
  /* ONE tap must be ONE toggle. The lesson screen's host.onclick sits on #kxScroll and the click
   * bubbles to the router's delegated listener on #kardioxRoot, so a duplicate router-side
   * "kx-bookmark" case toggled the store a second time and netted zero — a tap that appeared to do
   * nothing. Unit tests cannot see this; it only exists once both listeners are live in a real DOM. */
  await ev(`document.querySelector('[data-act="kx-bookmark"]').click(); return 1;`); await sleep(400);
  ok(((await ev(`${bmA1}`)) || {}).a1 === 1,
    "ONE tap bookmarks the lesson exactly once (two live click handlers must not cancel out)");
  await ev(`document.querySelector('[data-act="kx-bookmark"]').click(); return 1;`); await sleep(400);
  ok(!(await ev(`${bmA1}`) || {}).a1, "a second tap removes it (the toggle is not stuck on)");
  await ev(`document.querySelector('[data-act="kx-bookmark"]').click(); return 1;`); await sleep(400);
  ok(((await ev(`${bmA1}`)) || {}).a1 === 1, "bookmarked again, ready for the reload leg");

  ok(await attach(BASE + "?kardiox=1&kardioxbackend=0&mlab=0"), "reloads the app in a brand-new page");
  await openLibrary(false);      // fresh providers, fresh content array — only localStorage carries over
  ok(await ev(`return !!document.querySelector('.kx-lib-row[data-id="a1"]');`) === true, "library re-renders after reload");
  ok((await ev(rowSub("l1")) || "").indexOf("mastered") >= 0, "mastery also survives the reload");
  await ev(`document.querySelector(".kx-lib-bm").click(); return 1;`); await sleep(400);
  ok(await ev(shownIds) === "a1", "the bookmark SURVIVED the reload (bookmarks-only filter still finds a1)");

  console.log(fails === 0 ? "\nALL GREEN — KardiQ Learn progress persists and renders in a real browser" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
