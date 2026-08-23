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
  ok((await ev("!!document.querySelector('#clinixRoot .cx-row--dz')")) === true,
    "the respiratory system lists COPD");

  await ev("document.querySelector('#clinixRoot .cx-row--dz').click()");
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
  await ev("document.querySelector('#clinixRoot .cx-row--dz').click()");
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
  // Reveal now comes BEFORE ask in the lesson order (teach, how, why, reveal, ask), so re-open the
  // lesson rather than walking forward from the ask turn, which has already passed it.
  await ev("(function(){ var b=document.querySelector('#clinixRoot [data-act=\"cx-back\"]'); if(b) b.click(); return 1; })()");
  await sleep(400);
  await ev("(function(){ var b=document.querySelector('#clinixRoot [data-act=\"cx-lesson\"]'); if(b) b.click(); return !!b; })()");
  await sleep(500);
  let foundReveal = false;
  for (let i = 0; i < 30; i++) {
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
    const un = C.media(built, 'media.gen.cyanosis.central');        // still unsourced, on purpose
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
  await ev("document.querySelector('#clinixRoot .cx-row--dz').click()");
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

  /* ── 6c. SYSTEM MODULE comes before the diseases ───────────────────────── */
  console.log("\n--- system module ---");
  await attach(BASE + "?clinix=1");
  await ev("window.CLINIX.open()"); await sleep(600);
  await ev("[...document.querySelectorAll('#clinixRoot .cx-sys')].find(b => b.textContent.includes('Respiratory')).click()");
  await sleep(500);
  ok((await ev("!!document.querySelector('#clinixRoot .cx-modcard')")) === true,
    "the system offers 'Examination of the Respiratory System' as the primary action");
  ok((await ev("document.querySelector('#clinixRoot .cx-modcard').textContent")).indexOf("Respiratory System") >= 0,
    "and it is named as the whole-system examination");
  const modFirst = await ev(`(function(){
    var card = document.querySelector('#clinixRoot .cx-modcard');
    var dz = document.querySelector('#clinixRoot .cx-row--dz');
    if (!card || !dz) return 'missing';
    return (card.getBoundingClientRect().top < dz.getBoundingClientRect().top) ? 'module-first' : 'disease-first';
  })()`);
  ok(modFirst === "module-first", "it sits ABOVE the disease list, not below it");

  // and it opens into the full workup pathway
  await ev("document.querySelector('#clinixRoot .cx-modcard').click()");
  for (let i = 0; i < 40; i++) { if (await ev("!!document.querySelector('#clinixRoot .cx-rail-btn')")) break; await sleep(250); }
  const modChapters = await ev("document.querySelectorAll('#clinixRoot .cx-rail-item').length");
  ok(Number(modChapters) >= 8, `the module opens the full workup (${modChapters} chapters)`);
  const railText = await ev("document.querySelector('#clinixRoot .cx-rail').textContent");
  for (const need of ["particulars", "History", "General examination", "Respiratory examination", "pattern", "diagnosis"]) {
    ok(String(railText).toLowerCase().indexOf(need.toLowerCase()) >= 0, `  chapter present: ${need}`);
  }

  /* ── 7a. TEACHING BEFORE ASKING ───────────────────────────────────────── */
  console.log("\n--- teaching layer ---");
  await attach(BASE + "?clinix=1");
  await ev("window.CLINIX.open()"); await sleep(600);
  await ev("(function(){ document.querySelector(\"#clinixRoot [data-act='cx-skills']\").click(); return 1; })()");
  for (let i = 0; i < 40; i++) { if (await ev("document.querySelectorAll('#clinixRoot .cx-row--skill').length > 0")) break; await sleep(250); }
  // Cough and sputum is the skill taught most fully from the book.
  await ev("(function(){ var r=[].slice.call(document.querySelectorAll('#clinixRoot .cx-row--skill')).filter(function(x){return x.textContent.indexOf('Cough')>=0;})[0]; if(r) r.click(); return !!r; })()");
  await sleep(700);
  ok((await ev("!!document.querySelector('#clinixRoot .cx-turn--teach')")) === true,
    "a lesson now OPENS on teaching, not on a question");
  ok((await ev("!document.querySelector('#clinixRoot .cx-turn--ask')")) === true,
    "TEACH BEFORE ASK: no question on the first screen");
  ok((await ev("!!document.querySelector('#clinixRoot .cx-teach-h')")) === true, "the teaching block has a heading");
  ok((await ev("(document.querySelector('#clinixRoot .cx-eyebrow--learn')||{}).textContent||''")).indexOf("Learning") >= 0,
    "and is signposted as Learning");

  // Walk the teaching turns and confirm real substance arrives before any question.
  let teachSeen = 0, sawTable = false, sawList = false;
  for (let i = 0; i < 12; i++) {
    if (await ev("!!document.querySelector('#clinixRoot .cx-turn--teach')")) teachSeen++;
    if (await ev("!!document.querySelector('#clinixRoot .cx-table')")) sawTable = true;
    if (await ev("!!document.querySelector('#clinixRoot .cx-teach-list')")) sawList = true;
    if (await ev("!!document.querySelector('#clinixRoot .cx-turn--ask')")) break;
    if (!(await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-turn-next\"]')"))) break;
    await ev("document.querySelector('#clinixRoot [data-act=\"cx-turn-next\"]').click()");
    await sleep(180);
  }
  ok(teachSeen >= 3, `several teaching screens before any question (${teachSeen})`);
  ok(sawTable, "clinical tables render (duration, sputum, haemoptysis clues)");
  ok(sawList, "structured point lists render");

  /* ── 7a2. SHOW ANSWER: available, but it must not count ────────────────── */
  console.log("\n--- show answer ---");
  await attach(BASE + "?clinix=1");
  await ev("window.CLINIX.open()"); await sleep(600);
  await ev("(function(){ document.querySelector(\"#clinixRoot [data-act='cx-skills']\").click(); return 1; })()");
  for (let i = 0; i < 40; i++) { if (await ev("document.querySelectorAll('#clinixRoot .cx-row--skill').length > 0")) break; await sleep(250); }
  await ev("(function(){ document.querySelector('#clinixRoot .cx-row--skill').click(); return 1; })()");
  await sleep(500);
  // walk to the first question
  let gotAsk = false;
  for (let i = 0; i < 30; i++) {
    if (await ev("!!document.querySelector('#clinixRoot .cx-turn--ask')")) { gotAsk = true; break; }
    if (!(await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-turn-next\"]')"))) break;
    await ev("document.querySelector('#clinixRoot [data-act=\"cx-turn-next\"]').click()");
    await sleep(150);
  }
  ok(gotAsk, "reached a question");
  ok((await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-answer-show\"]')")) === true,
    "a Show-me-the-answer option is offered alongside checking");

  // Measure the DELTA on this specific skill. Reading "the first record" picked up one the OSCE
  // section had already filled, which is why the first version of this check passed nonsense.
  const readRec = `(function(){
    var st = SMD_CLINIX_SCREENS._state();
    var r = SMD_CLINIX_PROGRESS.get(st.skillId) || { seen: 0, correct: 0 };
    return JSON.stringify({ seen: r.seen || 0, correct: r.correct || 0 });
  })()`;
  const recBefore = JSON.parse(await ev(readRec));
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-answer-show\"]').click()");
  await sleep(500);
  const recAfter = JSON.parse(await ev(readRec));

  ok((await ev("!!document.querySelector('#clinixRoot .cx-fb')")) === true, "the model answer appears");
  ok((await ev("document.querySelector('#clinixRoot .cx-fb').textContent")).indexOf("does not count") >= 0,
    "and it says plainly that it does not count");
  ok(recAfter.seen === recBefore.seen + 1,
    `revealing is recorded as an attempt seen (${recBefore.seen} -> ${recAfter.seen})`);
  ok(recAfter.correct === recBefore.correct,
    `SHOWN IS NOT KNOWN: correct did not move (${recBefore.correct} -> ${recAfter.correct})`);
  ok((await ev("SMD_CLINIX_PROGRESS.mastery(SMD_CLINIX_SCREENS._state().skillId).level")) !== "mastered",
    "so a student cannot reveal their way to mastery");

  /* ── 7b. SKILLS LIBRARY: learn a skill with NO disease ─────────────────── */
  console.log("\n--- examination skills library ---");
  await attach(BASE + "?clinix=1");
  await ev("window.CLINIX.open()"); await sleep(700);
  ok((await ev("!!document.querySelector(\"#clinixRoot [data-act='cx-skills']\")")) === true,
    "home offers Examination skills above the disease list");
  await ev("(function(){ document.querySelector(\"#clinixRoot [data-act='cx-skills']\").click(); return 1; })()");
  for (let i = 0; i < 40; i++) { if (await ev("document.querySelectorAll('#clinixRoot .cx-row--skill').length > 0")) break; await sleep(250); }
  const nSkills = await ev("document.querySelectorAll('#clinixRoot .cx-row--skill').length");
  ok(Number(nSkills) >= 15, `the library lists skills (${nSkills})`);
  ok((await ev("document.querySelectorAll('#clinixRoot .cx-sec-h').length >= 4")) === true,
    "grouped by what you are DOING, not by disease");

  // Opening a skill with no disease attached is the case that used to throw and render nothing.
  await ev("(function(){ document.querySelector('#clinixRoot .cx-row--skill').click(); return 1; })()");
  await sleep(700);
  ok((await ev("!!document.querySelector('#clinixRoot .cx-turn')")) === true,
    "NO-DISEASE REGRESSION: a standalone skill actually opens its lesson");
  ok((await ev("!document.querySelector('#clinixRoot .cx-state--error, #clinixRoot .cx-state')")) === true,
    "and does not fall into the error state");
  ok((await ev("(document.querySelector('#clinixRoot .cx-head-sub')||{}).textContent || ''")).indexOf("step") >= 0,
    "the header names the step even without a disease");

  /* ── 8a. OSCE SCROLL: the timer must not yank you to the top ───────────── */
  console.log("\n--- osce scroll ---");
  await attach(BASE + "?clinix=1");
  await ev("window.CLINIX.open()"); await sleep(500);
  await ev("[...document.querySelectorAll('#clinixRoot .cx-sys')].find(b => b.textContent.includes('Respiratory')).click()");
  await sleep(300);
  await ev("document.querySelector('#clinixRoot .cx-row--dz').click()");
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
  await ev("document.querySelector('#clinixRoot .cx-row--dz').click()");
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

  // REGRESSION: tapping to reveal an exam finding used to mint free competency (record(..., true))
  // for every tapped skill on finishCase(), with zero interpretation asked - breaking the "shown is
  // not known" rule Learn/Viva already enforce for a revealed answer. Drive the case through to the
  // end and confirm the tapped skill is recorded as SEEN, never CORRECT.
  const examinedSkillId = await ev("document.querySelector('#clinixRoot [data-act=\"cx-case-exam\"]').getAttribute('data-id')");
  await ev(`(function(){ try { localStorage.removeItem("smd_clinix_skills_v1"); } catch(e) {} return true; })()`);
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-case-next\"]').click()");   // -> investigations
  await sleep(200);
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-case-next\"]').click()");   // -> differential
  await sleep(200);
  await ev(`(function(){ document.getElementById('cxCaseText').value = 'COPD, heart failure, pneumonia'; document.querySelector('#clinixRoot [data-act="cx-case-next"]').click(); return true; })()`);
  await sleep(200);   // -> diagnosis
  await ev(`(function(){ document.getElementById('cxCaseText').value = 'COPD with an infective exacerbation'; document.querySelector('#clinixRoot [data-act="cx-case-next"]').click(); return true; })()`);
  await sleep(200);   // -> management
  await ev(`(function(){ document.getElementById('cxCaseText').value = 'bronchodilators, steroids, antibiotics'; document.querySelector('#clinixRoot [data-act="cx-case-next"]').click(); return true; })()`);
  await sleep(300);   // finishCase() runs here
  const examRecord = await ev(`(function(){
    const S = window.SMD_CLINIX_PROGRESS;
    if (!S || !S.get) return null;
    const r = S.get(${JSON.stringify(examinedSkillId)});
    return r ? { seen: r.seen, correct: r.correct } : null;
  })()`);
  ok(examRecord && examRecord.seen === 1, "the tapped exam skill was recorded as seen");
  ok(examRecord && examRecord.correct === 0,
    "REGRESSION: but never as correct - tapping to reveal a finding is not the same as interpreting it");

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
  await ev("document.querySelector('#clinixRoot .cx-row--dz').click()");
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

  /* ── 9b. Viva examiner: degrades honestly, never fakes a verdict ───────── */
  console.log("\n--- viva examiner ---");
  // reasoning.js IS loaded here (unlike the pure-Node clinix-tutor.test.mjs suite), so the CLIENT
  // transport genuinely exists - vivaAvailable() correctly says true. There is no real /api/ai
  // backend behind this static test server though, so the actual call must still fail cleanly
  // (a real network/parse error), never fabricate a verdict out of a failed request.
  const vivaGuard = await ev(`(async () => {
    const T = window.SMD_CLINIX_TUTOR;
    const avail = T.vivaAvailable();
    const r = await T.judgeVivaAnswer({ q: "Discuss the pathophysiology." }, "something plausible");
    return { avail, error: r && r.error, verdict: r && r.verdict };
  })()`);
  ok(vivaGuard && vivaGuard.avail === true, "the client transport exists here (reasoning.js is loaded) - vivaAvailable() correctly says so");
  ok(vivaGuard && !!vivaGuard.error && !vivaGuard.verdict, "with no real backend behind this test server, judgeVivaAnswer() reports a real failure, never a fabricated verdict");

  // A viva question still completes cleanly with no backend reachable - the offline check answers
  // what it can, and any auto-judge attempt fails cleanly rather than hanging or crashing waiting
  // for a server that isn't there. Same navigation path the OSCE-scroll test above uses, but for
  // the "cx-viva" entry point instead of "cx-station".
  await attach(BASE + "?clinix=1&clinixdraft=1&clinixtutor=1");
  await ev("window.CLINIX.open()"); await sleep(500);
  await ev("[...document.querySelectorAll('#clinixRoot .cx-sys')].find(b => b.textContent.includes('Respiratory')).click()");
  await sleep(300);
  await ev("document.querySelector('#clinixRoot .cx-row--dz').click()");
  for (let i = 0; i < 40; i++) { if (await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-viva\"]')")) break; await sleep(250); }
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-viva\"]').click()");
  await sleep(400);
  const vivaScreen = await ev(`(() => {
    const root = document.getElementById('clinixRoot');
    const ta = root.querySelector('#cxAnswer');
    if (ta) { ta.value = 'a reasonable attempt'; root.querySelector('[data-act="cx-viva-answer"]').click(); }
    return { answered: !!root.querySelector('.cx-fb, .cx-viva-pending') };
  })()`);
  ok(vivaScreen && vivaScreen.answered === true, "the viva still marks the answer with no AI backend reachable");
  await sleep(600);   // let any auto-judge attempt (needsJudge probes) settle before checking it did not get stuck
  ok((await ev("!document.querySelector('#clinixRoot .cx-viva-pending')")) === true,
    "and never gets stuck showing 'MaiK is examining' when the backend cannot be reached");

  /* ── 9c. MBBS/PG tier + voice mode ──────────────────────────────────────── */
  const tierBefore = await ev(`(() => {
    const root = document.getElementById('clinixRoot');
    return { mbbsOn: root.querySelector('[data-act="cx-viva-tier"][data-id="mbbs"]').classList.contains('cx-tier-btn--on'), hasPgBtn: !!root.querySelector('[data-act="cx-viva-tier"][data-id="pg"]') };
  })()`);
  ok(tierBefore && tierBefore.mbbsOn === true, "viva opens on the MBBS tier by default");
  ok(tierBefore && tierBefore.hasPgBtn === true, "the PG tier is always offered as a switch, not a separate mode to hunt for");

  await ev('document.querySelector(\'#clinixRoot [data-act="cx-viva-tier"][data-id="pg"]\').click()');
  await sleep(400);
  const afterPg = await ev(`(() => {
    const root = document.getElementById('clinixRoot');
    return { pgOn: root.querySelector('[data-act="cx-viva-tier"][data-id="pg"]').classList.contains('cx-tier-btn--on'), levelText: root.querySelector('.cx-head-sub')?.textContent || '' };
  })()`);
  ok(afterPg && afterPg.pgOn === true, "switching to PG restarts the viva and marks PG as the active tier");
  ok(afterPg && /level 2/.test(afterPg.levelText), "PG starts one level harder than MBBS (level 2, not 1)");

  // Voice mode: off by default, and turning it on must not crash the screen even though no real
  // STT plugin exists in this headless test - the mic tap must degrade to a toast, never hang.
  const voiceOff = await ev("!document.querySelector('#clinixRoot .cx-voice-btn--on')");
  ok(voiceOff === true, "voice mode is off by default");
  await ev('document.querySelector(\'#clinixRoot [data-act="cx-viva-voice-toggle"]\').click()');
  await sleep(200);
  ok((await ev("!!document.querySelector('#clinixRoot .cx-voice-btn--on')")) === true, "the voice toggle turns on and the UI reflects it");
  ok((await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-viva-mic\"]')")) === true, "a mic control appears once voice mode is on");
  await ev('document.querySelector(\'#clinixRoot [data-act="cx-viva-mic"]\').click()');
  await sleep(300);
  ok((await ev("!!document.getElementById('clinixRoot')")) === true,
    "tapping the mic with no real STT plugin present degrades safely - no real device here, so no crash is the whole test");

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
