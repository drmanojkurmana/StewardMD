/* test/run-clinix-ui.mjs — CliniX real-browser test (CDP), modelled on test/run-abx-ui.mjs.
 *
 * Drives the ACTUAL app: real index.html, real script load order, real content fetched over HTTP.
 * The load-bearing assertions are the two gates and the flag-off no-op, because those are the three
 * things that would do harm if they silently regressed.
 *
 * Linux: CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node test/run-clinix-ui.mjs
 */
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Node 22's built-in WebSocket, same as test/run-abx-ui.mjs. Do not import "ws": it is not a
// dependency of this repo and the harness must run with no install step.

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || "http://localhost:8994/").replace(/\/?$/, "/");
const PORT = 9387;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/clinix-ui-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8994"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, [
  ...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean),
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--no-sandbox"
], { stdio: "ignore" });

let msgId = 1;
const pending = new Map();
let ws, sessionId;
const call = (m, p) => {
  const i = msgId++;
  return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); });
};
const ev = async (expr) => {
  const r = await call("Runtime.evaluate", {
    expression: `(() => { try { return (${expr}); } catch (e) { return { __err: String(e) }; } })()`,
    returnByValue: true, awaitPromise: true
  });
  return r?.result?.result?.value;
};

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "✅" : "❌") + " " + msg); if (!cond) fails++; };

async function attach(url) {
  const { result } = await call("Target.createTarget", { url: "about:blank" });
  const t = await call("Target.attachToTarget", { targetId: result.targetId, flatten: true });
  sessionId = t.result.sessionId;
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.navigate", { url });
  // Wait for the app shell, then dismiss the gates that sit in front of every screen.
  for (let i = 0; i < 80; i++) {
    const ready = await ev("!!(window.SMD_CLINIX_FLAGS && window.CLINIX)");
    if (ready) break;
    await sleep(400);
  }
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); }); true`);
  await sleep(300);
}

try {
  // Connect to the browser.
  let wsUrl = null;
  for (let i = 0; i < 60; i++) {
    try { wsUrl = (await (await fetch(`http://localhost:${PORT}/json/version`)).json()).webSocketDebuggerUrl; break; }
    catch { await sleep(300); }
  }
  if (!wsUrl) throw new Error("Chrome did not expose a debugger. Set CHROME to a chromium binary.");
  ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => {
    const m = JSON.parse(typeof e.data === "string" ? e.data : String(e.data));
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };

  /* ── 1. FLAG OFF: the module must be a complete no-op ──────────────────── */
  console.log("\n--- flag OFF ---");
  await attach(BASE + "?clinix=0");

  ok((await ev("window.CLINIX && CLINIX.isOn()")) === false, "CLINIX.isOn() is false with the flag off");
  await ev("window.CLINIX.open()");
  await sleep(200);
  ok((await ev("!!document.getElementById('clinixRoot')")) === false,
    "open() with the flag off creates NO #clinixRoot (it returns before touching the DOM)");
  ok((await ev("document.documentElement.classList.contains('cx-lock')")) === false,
    "no cx-lock class is applied");

  // The CSS-custom-property check is the clean discriminator used by run-abx-ui.mjs: with the module
  // off, none of its tokens exist anywhere in the document.
  ok((await ev("getComputedStyle(document.body).getPropertyValue('--cx-primary').trim() === ''")) === true,
    "no --cx-* custom property leaks into the page");

  // And nothing was fetched. The content loader must not touch the network until open() succeeds.
  ok((await ev("!(window.SMD_CLINIX_CONTENT && SMD_CLINIX_CONTENT._cache().catalog)")) === true,
    "no content is fetched with the flag off");

  /* ── 2. FLAG ON: the module mounts and the home screen renders ─────────── */
  console.log("\n--- flag ON, review gate CLOSED (student view) ---");
  await attach(BASE + "?clinix=1");

  ok((await ev("window.CLINIX.isOn()")) === true, "CLINIX.isOn() is true with ?clinix=1");
  await ev("window.CLINIX.open()");
  for (let i = 0; i < 40; i++) {
    if (await ev("!!document.querySelector('#clinixRoot .cx-sys')")) break;
    await sleep(250);
  }
  ok((await ev("!!document.getElementById('clinixRoot')")) === true, "#clinixRoot is mounted");
  ok((await ev("document.getElementById('clinixRoot').classList.contains('cx-open')")) === true, "the overlay is open");
  ok((await ev("document.querySelectorAll('#clinixRoot .cx-sys').length >= 4")) === true,
    "the home screen lists the four systems");
  ok((await ev("!!document.querySelector('#clinixRoot .cx-hero-mark')")) === true, "the CliniX hero renders");

  // swipe-back.js finds back/close controls purely by class pattern. If these names drift, the
  // Android hardware back button and the drag-back gesture both silently stop working.
  ok((await ev("!!document.querySelector('#clinixRoot [class*=\"cx-close\"]')")) === true,
    "a close control matching swipe-back.js BACK_SEL exists");

  /* ── 3. THE REVIEW GATE: unreviewed content must not reach a student ───── */
  await ev("[...document.querySelectorAll('#clinixRoot .cx-sys')].find(b => b.textContent.includes('Respiratory')).click()");
  await sleep(400);
  ok((await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-disease\"]')")) === true,
    "the respiratory system lists COPD");

  await ev("document.querySelector('#clinixRoot [data-act=\"cx-disease\"]').click()");
  for (let i = 0; i < 40; i++) {
    if (await ev("!!document.querySelector('#clinixRoot .cx-state, #clinixRoot .cx-rail')")) break;
    await sleep(250);
  }
  ok((await ev("!!document.querySelector('#clinixRoot .cx-state')")) === true,
    "REVIEW GATE: with content still ai_drafted, a student sees the pending-review state");
  ok((await ev("document.querySelector('#clinixRoot .cx-state').textContent.includes('Awaiting clinical review')")) === true,
    "and the reason is stated explicitly rather than showing an empty pathway");
  ok((await ev("!document.querySelector('#clinixRoot .cx-rail-btn:not([disabled])')")) === true,
    "no lesson is reachable");

  /* ── 4. AUTHOR MODE: the same content becomes visible ──────────────────── */
  console.log("\n--- flag ON, author mode (review gate OPEN) ---");
  await attach(BASE + "?clinix=1&clinixdraft=1");
  await ev("window.CLINIX.open()");
  await sleep(400);
  await ev("[...document.querySelectorAll('#clinixRoot .cx-sys')].find(b => b.textContent.includes('Respiratory')).click()");
  await sleep(300);
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-disease\"]').click()");
  for (let i = 0; i < 40; i++) {
    if (await ev("!!document.querySelector('#clinixRoot .cx-rail-btn')")) break;
    await sleep(250);
  }
  const chapters = await ev("document.querySelectorAll('#clinixRoot .cx-rail-item').length");
  ok(chapters >= 13, `the full COPD pathway renders (${chapters} chapters)`);
  ok((await ev("document.querySelectorAll('#clinixRoot .cx-rail-btn[disabled]').length === 0")) === true,
    "no chapter is empty in author mode");
  ok((await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-station\"]')")) === true,
    "OSCE stations are offered on the pathway");

  /* ── 5. THE LESSON RUNNER: ask before tell ─────────────────────────────── */
  console.log("\n--- the lesson runner ---");
  // Open the respiratory examination chapter, then its first skill.
  await ev("[...document.querySelectorAll('#clinixRoot .cx-rail-btn')].find(b => b.textContent.includes('Respiratory examination')).click()");
  await sleep(300);
  ok((await ev("document.querySelectorAll('#clinixRoot [data-act=\"cx-lesson\"]').length >= 7")) === true,
    "the chapter lists its skills");

  await ev("document.querySelector('#clinixRoot [data-act=\"cx-lesson\"]').click()");
  await sleep(300);
  ok((await ev("!!document.querySelector('#clinixRoot .cx-turn')")) === true, "a lesson turn renders");
  ok((await ev("!!document.querySelector('#clinixRoot .cx-prog-fill')")) === true,
    "the student can see where they are in the lesson");

  // Walk to the first question and prove no answer is on screen before the student commits.
  let foundAsk = false;
  for (let i = 0; i < 12; i++) {
    if (await ev("!!document.querySelector('#clinixRoot .cx-turn--ask')")) { foundAsk = true; break; }
    const next = await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-turn-next\"]')");
    if (!next) break;
    await ev("document.querySelector('#clinixRoot [data-act=\"cx-turn-next\"]').click()");
    await sleep(150);
  }
  ok(foundAsk, "the lesson asks the student a question");
  if (foundAsk) {
    ok((await ev("!document.querySelector('#clinixRoot .cx-fb')")) === true,
      "ASK BEFORE TELL: no feedback or model answer is shown before the student answers");

    // Answer it (free text or MCQ) and check that feedback appears and competency is written.
    const isMcq = await ev("!!document.querySelector('#clinixRoot .cx-opt')");
    if (isMcq) {
      await ev("document.querySelector('#clinixRoot .cx-opt').click()");
    } else {
      // ev() wraps its argument in `return (...)`, so this must be a single EXPRESSION.
      await ev("(function(){ var t = document.getElementById('cxAnswer'); t.value = 'inward movement of the costal margin'; document.querySelector('#clinixRoot [data-act=\"cx-answer-text\"]').click(); return true; })()");
    }
    await sleep(250);
    ok((await ev("!!document.querySelector('#clinixRoot .cx-fb')")) === true,
      "feedback with the model answer appears after answering");
    ok((await ev("Object.keys(SMD_CLINIX_PROGRESS.all()).length > 0")) === true,
      "answering writes a per-skill competency record");
  }

  // Tap-to-reveal must actually hide the finding until tapped.
  let foundReveal = false;
  for (let i = 0; i < 12; i++) {
    if (await ev("!!document.querySelector('#clinixRoot .cx-turn--reveal')")) { foundReveal = true; break; }
    const next = await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-turn-next\"]')");
    if (!next) break;
    await ev("document.querySelector('#clinixRoot [data-act=\"cx-turn-next\"]').click()");
    await sleep(150);
  }
  if (foundReveal) {
    ok((await ev("!document.querySelector('#clinixRoot .cx-reveal-b')")) === true,
      "TAP TO REVEAL: the finding is hidden until the student asks for it");
    await ev("document.querySelector('#clinixRoot [data-act=\"cx-reveal\"]').click()");
    await sleep(200);
    ok((await ev("!!document.querySelector('#clinixRoot .cx-reveal-b')")) === true,
      "and it appears once revealed");
  } else {
    ok(false, "expected a reveal turn in this lesson");
  }

  /* ── 6. THE LICENCE GATE ───────────────────────────────────────────────── */
  console.log("\n--- the licence gate ---");
  const media = await ev(`(() => {
    const c = window.SMD_CLINIX_CONTENT;
    const built = c._cache().diseases['copd'];
    const m = c.media(built, 'media.resp.expansion.technique');
    return m ? { renderable: m.renderable, hasSrc: !!m.src, note: m.pendingNote, cap: m.caption } : null;
  })()`);
  ok(media && media.renderable === false, "uncleared media is refused by the gate");
  ok(media && media.hasSrc === false, "no src is handed to the page for an uncleared asset");
  ok(media && media.cap && media.cap.length > 5, "but the caption survives, so the lesson still teaches");
  ok(media && media.note && media.note.length > 10, "and the reason is stated rather than showing a blank space");

  /* ── 7. RESUME ─────────────────────────────────────────────────────────── */
  console.log("\n--- resume ---");
  const pos = await ev("SMD_CLINIX_PROGRESS.position()");
  ok(pos && pos.diseaseId === "copd", "the student's position is saved");
  ok(pos && typeof pos.turnIndex === "number", "including the turn index, so they resume mid-skill");

  /* ── 8. OSCE: a critical miss fails the station ────────────────────────── */
  console.log("\n--- OSCE scoring ---");
  const osce = await ev(`(() => {
    const C = window.SMD_CLINIX_CONTENT, M = window.SMD_CLINIX_MODEL;
    const built = C._cache().diseases['copd'];
    const st = C.stationFor(built, 'osce.copd.resp_exam');
    if (!st) return null;
    const all = st.items.map(i => i.id);
    const noConsent = all.filter(id => id.indexOf('consent') < 0);
    return { total: st.items.length, crit: st.criticalCount,
             perfect: M.scoreStation(st, all).passed,
             withoutConsent: M.scoreStation(st, noConsent) };
  })()`);
  ok(osce && osce.total >= 10, `the station builds a real checklist from the skills (${osce && osce.total} items)`);
  ok(osce && osce.perfect === true, "a complete run passes");
  ok(osce && osce.withoutConsent.failedOnCritical === true,
    "missing consent fails the station on safety, regardless of the total");
  ok(osce && osce.withoutConsent.passed === false, "and is not recorded as a pass");

  /* ── 9. No prescribing surface anywhere in CliniX ──────────────────────── */
  console.log("\n--- safety ---");
  ok((await ev("!document.querySelector('#clinixRoot [class*=\"rx\"], #clinixRoot [data-act*=\"rx\"]')")) === true,
    "CliniX exposes no prescription affordance");

} catch (e) {
  console.error("harness error:", e);
  fails++;
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
  console.log("\n" + (fails === 0 ? "all CliniX UI checks passed" : fails + " CliniX UI check(s) failed"));
  process.exit(fails === 0 ? 0 : 1);
}
