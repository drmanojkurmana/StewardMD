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
  await attach(BASE + "?clinix=1&clinixdraft=0");

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
  ok((await ev("!document.querySelector('#clinixRoot [data-act=\"cx-case\"]')")) === true,
    "REVIEW GATE: an unreviewed simulated patient is not offered either");

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

  /* ── 6. THE LICENCE GATE, both directions ─────────────────────────────── */
  console.log("\n--- the licence gate ---");
  const gate = await ev(`(() => {
    const C = window.SMD_CLINIX_CONTENT, M = window.SMD_CLINIX_MODEL;
    const built = C._cache().diseases['copd'];
    const un = C.media(built, 'media.resp.inspection.barrel');      // still unsourced, on purpose
    const dia = C.media(built, 'media.dia.percussion');             // self-authored
    const snd = C.media(built, 'media.snd.wheeze');                 // synthesized
    const emb = C.media(built, 'media.vid.respexam');               // verified embed
    return {
      unRenderable: un && un.renderable, unSrc: !!(un && un.src), unCap: !!(un && un.caption), unNote: !!(un && un.pendingNote),
      diaOk: !!(dia && dia.renderable && dia.inline),
      sndOk: !!(snd && snd.renderable && snd.synth && snd.audioKind),
      embOk: !!(emb && emb.embeddable && emb.videoId), embSrc: !!(emb && emb.src),
      embAttr: emb && emb.attribution
    };
  })()`);
  ok(gate && gate.unRenderable === false, "an unsourced asset is still refused");
  ok(gate && gate.unSrc === false, "and no src is handed to the page for it");
  ok(gate && gate.unCap && gate.unNote, "but its caption and sourcing note survive, so the lesson still teaches");
  ok(gate && gate.diaOk === true, "a self-authored diagram passes");
  ok(gate && gate.sndOk === true, "synthesized audio passes and names a sound model");
  ok(gate && gate.embOk === true, "a verified YouTube embed passes");
  ok(gate && gate.embSrc === false, "and the embed carries NO src, so nothing is re-hosted");
  ok(gate && gate.embAttr === "Geeky Medics", `and it credits the real creator (${gate && gate.embAttr})`);

  /* ── 6b. SELF-AUTHORED DIAGRAMS: the gate OPENING ──────────────────────── */
  console.log("\n--- diagrams ---");
  const dia = await ev(`(() => {
    const C = window.SMD_CLINIX_CONTENT, D = window.SMD_CLINIX_DIAGRAMS;
    const built = C._cache().diseases['copd'];
    const m = C.media(built, 'media.dia.percussion');
    return {
      renderable: m && m.renderable, inline: m && m.inline, id: m && m.diagramId,
      attribution: m && m.attribution,
      registered: !!(D && D.has('diagram.percussion')),
      svg: D ? D.render('diagram.percussion', {}).indexOf('<svg') === 0 : false,
      zones: D ? D.ZONES.length : 0
    };
  })()`);
  ok(dia && dia.renderable === true, "a SELF-AUTHORED diagram passes the licence gate");
  ok(dia && dia.inline === true && dia.id === "diagram.percussion", "and resolves to an inline diagram");
  ok(dia && dia.attribution === "StewardMD", "attributed to us, which is why it can be cleared at all");
  ok(dia && dia.registered && dia.svg, "the diagram registry renders real SVG");
  ok(dia && dia.zones === 8, "the percussion map has all eight comparative zones");

  // The percussion diagram must actually render inside a lesson, and be interactive. Navigate from
  // a clean load: at this point the previous section left us deep inside a different lesson, where
  // there are no rail buttons to click.
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
  await ev("(function(){ var b = [...document.querySelectorAll('#clinixRoot .cx-rail-btn')].find(x => x.textContent.indexOf('Respiratory examination') >= 0); if (b) b.click(); return !!b; })()");
  await sleep(300);
  await ev("(function(){ var b = [...document.querySelectorAll('#clinixRoot [data-act=\"cx-lesson\"]')].find(x => x.textContent.indexOf('Percussion') >= 0); if (b) b.click(); return !!b; })()");
  await sleep(350);
  ok((await ev("!!document.querySelector('#clinixRoot .cx-dia')")) === true,
    "the percussion lesson opens on its diagram");
  ok((await ev("document.querySelectorAll('#clinixRoot .cx-dia-zone').length === 8")) === true,
    "all eight zones render");
  ok((await ev("!document.querySelector('#clinixRoot .cx-dia-zone--on')")) === true,
    "no zone is selected initially");
  // SVG elements have no .click() method (it lives on HTMLElement), so dispatch the real bubbling
  // event a tap produces. This also proves the delegated listener on #clinixRoot handles SVG targets.
  await ev("(function(){ var z = document.querySelector('#clinixRoot [data-act=\"cx-dia-zone\"]'); z.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()");
  await sleep(250);
  ok((await ev("!!document.querySelector('#clinixRoot .cx-dia-zone--on')")) === true,
    "INTERACTIVE: tapping a zone selects it");
  ok((await ev("document.querySelector('#clinixRoot .cx-dia-note').textContent.indexOf('apex') >= 0")) === true,
    "and shows what you would expect to find there");

  // Percussion now carries BOTH the map and the technique animation, and both are ours.
  ok((await ev(`(() => {
    const C = window.SMD_CLINIX_CONTENT;
    const b = C._cache().diseases['copd'];
    const a = C.media(b, 'media.dia.percussion'), t = C.media(b, 'media.dia.percussiontech');
    return !!(a && a.renderable && t && t.renderable && t.diagramId === 'diagram.percussion.technique');
  })()`)) === true, "percussion teaches WHERE and HOW, both self-authored");

  /* ── 8a. OSCE SCROLL: the timer must not yank you to the top ───────────── */
  console.log("\n--- osce scroll ---");
  await attach(BASE + "?clinix=1");
  await ev("window.CLINIX.open()"); await sleep(500);
  await ev("[...document.querySelectorAll('#clinixRoot .cx-sys')].find(b => b.textContent.includes('Respiratory')).click()");
  await sleep(300);
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-disease\"]').click()");
  for (let i = 0; i < 40; i++) { if (await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-station\"]')")) break; await sleep(250); }
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-station\"]').click()");
  await sleep(600);
  ok((await ev("!!document.querySelector('#clinixRoot .cx-timer')")) === true, "station opens with a running clock");

  // Scroll down, then wait out MORE than one timer tick.
  await ev("(function(){ var h = document.getElementById('clinixScroll'); h.scrollTop = 400; return h.scrollTop; })()");
  const before = await ev("document.getElementById('clinixScroll').scrollTop");
  await sleep(2600);
  const after = await ev("document.getElementById('clinixScroll').scrollTop");
  ok(Number(before) > 100, `scrolled down first (${before})`);
  ok(Number(after) === Number(before),
    `SCROLL REGRESSION: position survives the timer tick (was ${before}, now ${after})`);
  ok((await ev("document.querySelector('#clinixRoot .cx-timer span').textContent")) !== "",
    "and the clock is still ticking");

  // Ticking a checklist item must also not jump to the top.
  await ev("(function(){ var b = document.querySelectorAll('#clinixRoot [data-act=\"cx-station-check\"]'); b[b.length-1].click(); return true; })()");
  await sleep(400);
  const afterTick = await ev("document.getElementById('clinixScroll').scrollTop");
  ok(Number(afterTick) === Number(before),
    `ticking a checkbox keeps your place (was ${before}, now ${afterTick})`);

  /* ── 8b. CASE MODE: the simulated patient ──────────────────────────────── */
  console.log("\n--- clinical case ---");
  // Back to the disease page (we are currently deep in a lesson).
  await attach(BASE + "?clinix=1&clinixdraft=1");
  await ev("window.CLINIX.open()");
  await sleep(400);
  await ev("[...document.querySelectorAll('#clinixRoot .cx-sys')].find(b => b.textContent.includes('Respiratory')).click()");
  await sleep(300);
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-disease\"]').click()");
  for (let i = 0; i < 40; i++) {
    if (await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-case\"]')")) break;
    await sleep(250);
  }
  ok((await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-case\"]')")) === true,
    "the disease page offers a clinical case");

  await ev("document.querySelector('#clinixRoot [data-act=\"cx-case\"]').click()");
  await sleep(300);
  ok((await ev("!!document.querySelector('#clinixRoot .cx-case-open')")) === true, "the case opens with the presentation");
  ok((await ev("document.querySelectorAll('#clinixRoot .cx-phase').length === 6")) === true,
    "the encounter shows all six phases, so the student knows where they are going");

  // The patient answers from the script.
  await ev("(function(){ document.getElementById('cxCaseQ').value = 'do you smoke?'; document.querySelector('#clinixRoot [data-act=\"cx-case-ask\"]').click(); return true; })()");
  await sleep(250);
  ok((await ev("document.querySelector('#clinixRoot .cx-pt').textContent.indexOf('bidis') >= 0")) === true,
    "a scripted question gets the scripted reply");

  // And does NOT improvise when asked something unscripted.
  await ev("(function(){ document.getElementById('cxCaseQ').value = 'what is your favourite colour'; document.querySelector('#clinixRoot [data-act=\"cx-case-ask\"]').click(); return true; })()");
  await sleep(250);
  ok((await ev("!!document.querySelector('#clinixRoot .cx-pt--unmatched')")) === true,
    "an unscripted question gets the fallback, never an invented symptom");

  // Examination phase: a finding appears only for a step actually performed.
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-case-next\"]').click()");
  await sleep(250);
  ok((await ev("!document.querySelector('#clinixRoot .cx-finding')")) === true,
    "no finding is visible before the student examines anything");
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-case-exam\"]').click()");
  await sleep(250);
  ok((await ev("!!document.querySelector('#clinixRoot .cx-finding')")) === true,
    "performing an examination reveals its finding");

  // Scoring: the guessing case is the one that matters.
  const caseScore = await ev(`(() => {
    const C = window.SMD_CLINIX_CONTENT, M = window.SMD_CLINIX_MODEL;
    const built = C._cache().diseases['copd'];
    const cd = C.caseFor(built, 'case.copd.ramesh');
    if (!cd) return null;
    const thin = M.scoreCase(cd, { asked: ['presenting'], examined: [], investigated: [], diagnosis: 'COPD' });
    const full = M.scoreCase(cd, {
      asked: Object.keys(cd.history), examined: Object.keys(cd.exam),
      investigated: cd.essentialInvestigations, diagnosis: 'COPD with infective exacerbation'
    });
    return { thin: thin.verdict, thinCorrect: thin.diagnosis.correct, full: full.verdict };
  })()`);
  ok(caseScore && caseScore.thinCorrect === true, "guessing COPD after one question does give the right answer");
  ok(caseScore && caseScore.thin === "right-answer-thin-workup",
    "but the encounter is graded as a thin workup, not a pass");
  ok(caseScore && caseScore.full === "good", "while a full workup with the right answer reads as good");

  /* ── 9. The tutor: affordance appears only behind its own flag ─────────── */
  console.log("\n--- tutor ---");
  ok((await ev("!document.querySelector('#clinixRoot [data-act=\"cx-ask\"]')")) === true,
    "with smd_clinix_tutor off, a lesson shows NO Ask-MaiK affordance");

  await attach(BASE + "?clinix=1&clinixdraft=1&clinixtutor=1");
  await ev("window.CLINIX.open()");
  await sleep(400);
  await ev("[...document.querySelectorAll('#clinixRoot .cx-sys')].find(b => b.textContent.includes('Respiratory')).click()");
  await sleep(300);
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-disease\"]').click()");
  for (let i = 0; i < 40; i++) {
    if (await ev("!!document.querySelector('#clinixRoot .cx-rail-btn')")) break;
    await sleep(250);
  }
  await ev("[...document.querySelectorAll('#clinixRoot .cx-rail-btn')].find(b => b.textContent.includes('Respiratory examination')).click()");
  await sleep(300);
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-lesson\"]').click()");
  await sleep(300);
  ok((await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-ask\"]')")) === true,
    "with the tutor flag on, the lesson offers Ask MaiK");

  // The dose guard must be live in the browser, not only in node.
  const guard = await ev(`(() => {
    const T = window.SMD_CLINIX_TUTOR;
    const bad = T.sanitize("Give prednisolone 40 mg daily for five days.");
    const good = T.sanitize("You percuss side to side so you are always comparing like with like.");
    return { blocked: bad.blocked, leaks: bad.text.indexOf("40 mg") >= 0, goodPassed: !good.blocked };
  })()`);
  ok(guard && guard.blocked === true, "DOSE GUARD is live in the browser");
  ok(guard && guard.leaks === false, "and no dose survives into the displayed text");
  ok(guard && guard.goodPassed === true, "while normal teaching passes through");

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
