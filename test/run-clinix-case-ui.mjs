/* test/run-clinix-case-ui.mjs - the case stages and the physiology sandbox, in a real browser.
 *
 * Unit tests cannot catch what was actually broken here. The sandbox's defect was that onInput
 * called repaint(), which replaced the <input type=range> the student had their thumb on, so the
 * drag was cancelled on the first input event and nothing moved. That is a DOM-identity bug: it is
 * invisible to a model test and obvious the moment you check whether the element survives.
 * The same shape of bug would kill the diagnosis search box, so both are checked the same way.
 *
 * Linux: CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
 *        CHROME_FLAGS="--no-sandbox --disable-dev-shm-usage" node test/run-clinix-case-ui.mjs
 */
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || "http://localhost:8995/").replace(/\/?$/, "/");
const PORT = 9391;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/clinix-case-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8995"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
try { rmSync(userDir, { recursive: true, force: true }); } catch {}

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
const ok = (cond, msg) => { console.log((cond ? "PASS" : "FAIL") + "  " + msg); if (!cond) fails++; };
const waitFor = async (expr, tries = 60) => {
  for (let i = 0; i < tries; i++) { if (await ev(expr)) return true; await sleep(200); }
  return false;
};

async function attach(url) {
  const { result } = await call("Target.createTarget", { url: "about:blank" });
  const t = await call("Target.attachToTarget", { targetId: result.targetId, flatten: true });
  sessionId = t.result.sessionId;
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.navigate", { url });
  for (let i = 0; i < 80; i++) {
    if (await ev("!!(window.SMD_CLINIX_FLAGS && window.CLINIX)")) break;
    await sleep(400);
  }
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); }); true`);
  await sleep(300);
}

/* Set a range input the way a finger does: change value, then dispatch a real bubbling input
 * event. The whole point is that the element must still be the SAME node afterwards. */
const dragSlider = (param, value) => ev(`(() => {
  const el = document.querySelector('#clinixRoot .cx-physio-range[data-param="${param}"]');
  if (!el) return "no slider";
  el.value = "${value}";
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return "ok";
})()`);

const typeInto = (id, text) => ev(`(() => {
  const el = document.getElementById(${JSON.stringify(id)});
  if (!el) return "missing";
  el.value = ${JSON.stringify(text)};
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return "ok";
})()`);

try {
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

  await attach(BASE + "?clinix=1&clinixdraft=1");
  await ev("window.CLINIX.open()");
  await waitFor("!!document.querySelector('#clinixRoot .cx-sys')");

  /* ── 1. The physiology sandbox ──────────────────────────────────────────── */
  console.log("\n--- physiology sandbox ---");
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-sandbox\"]').click()");
  ok(await waitFor("!!document.querySelector('#clinixRoot .cx-physio-range')"), "the sandbox opens with sliders");

  const vitals = await ev("document.querySelector('#clinixRoot .cx-vitals-monitor').textContent.replace(/\\s+/g,' ')");
  ok(/120\/80/.test(vitals), "a student who touches nothing sees 120/80: " + vitals);
  ok(/5 L\/min/.test(vitals), "and a cardiac output of 5 L/min");
  ok((await ev("document.querySelector('#clinixRoot .cx-physio-state-t').textContent")) === "Normal haemodynamics",
    "the state banner names the physiology, not just numbers");
  ok((await ev("document.querySelectorAll('#clinixRoot .cx-wave svg').length")) === 3,
    "three waveforms are drawn (ECG, arterial, JVP)");
  ok((await ev("document.querySelector('#clinixRoot .cx-wave-path').getAttribute('d').length > 100")) === true,
    "the ECG path has real geometry in it");

  /* THE BUG. Tag the live element, drag it, and see whether the same node is still there. */
  await ev(`(() => { document.querySelector('#clinixRoot .cx-physio-range[data-param="preload"]').dataset.tag = "kept"; return true; })()`);
  await dragSlider("preload", 170);
  await sleep(120);
  ok((await ev(`document.querySelector('#clinixRoot .cx-physio-range[data-param="preload"]').dataset.tag === "kept"`)) === true,
    "dragging a slider does NOT replace the slider element (the 1/10 defect)");
  ok((await ev(`document.querySelector('#clinixRoot .cx-physio-range[data-param="preload"]').value === "170"`)) === true,
    "and the thumb stays where the student put it");
  ok((await ev("document.getElementById('cxPv-preload').textContent")) === "170%",
    "the readout beside the slider follows it");

  const after = await ev("document.querySelector('#clinixRoot .cx-vitals-monitor').textContent.replace(/\\s+/g,' ')");
  ok(after !== vitals, "the derived panel actually recomputed: " + after);

  await dragSlider("contractility", 35);
  await sleep(120);
  ok((await ev("document.querySelector('#clinixRoot .cx-physio-state-t').textContent")).includes("failure"),
    "a full, weak ventricle is named as cardiac failure");
  ok((await ev("document.querySelectorAll('#clinixRoot .cx-physio-why li').length >= 2")) === true,
    "and the sandbox explains which variable did what");

  /* Presets. */
  await ev("[...document.querySelectorAll('#clinixRoot [data-act=\"cx-physio-preset\"]')].find(b => b.textContent.includes('Septic')).click()");
  await sleep(250);
  ok((await ev("document.querySelector('#clinixRoot .cx-physio-state-t').textContent")).includes("Distributive"),
    "the septic shock preset lands on distributive shock");
  ok((await ev("!!document.querySelector('#clinixRoot .cx-physio-note')")) === true,
    "and brings its teaching note with it");
  ok((await ev(`document.querySelector('#clinixRoot .cx-physio-range[data-param="afterload"]').value === "40"`)) === true,
    "a preset moves the sliders themselves, so the student can take it from there");

  /* The respiratory tab. */
  await ev("[...document.querySelectorAll('#clinixRoot [data-act=\"cx-physio-mode\"]')].find(b => b.textContent.includes('Respiratory')).click()");
  ok(await waitFor(`!!document.querySelector('#clinixRoot .cx-physio-range[data-param="shuntFraction"]')`),
    "the respiratory tab has a shunt slider");
  const abg = await ev("document.querySelector('#clinixRoot .cx-physio-state-t').textContent");
  ok(/pH 7\.3[5-9]|pH 7\.4/.test(abg), "room air, normal lungs: " + abg);

  const roomSpO2 = await ev("document.querySelector('#clinixRoot .cx-vitals-monitor').textContent.match(/SpO2(\\d+)/)[1]");
  await dragSlider("shuntFraction", 0.45);
  await sleep(150);
  const shuntSpO2 = await ev("document.querySelector('#clinixRoot .cx-vitals-monitor').textContent.match(/SpO2(\\d+)/)[1]");
  ok(Number(shuntSpO2) < Number(roomSpO2) - 10, `a 45% shunt drops the saturation: ${roomSpO2}% to ${shuntSpO2}%`);
  await dragSlider("fiO2", 1.0);
  await sleep(150);
  const o2SpO2 = await ev("document.querySelector('#clinixRoot .cx-vitals-monitor').textContent.match(/SpO2(\\d+)/)[1]");
  ok(Number(o2SpO2) - Number(shuntSpO2) < 15,
    `and 100% oxygen barely helps, which is the teaching point: ${shuntSpO2}% to ${o2SpO2}%`);
  ok((await ev("document.querySelector('#clinixRoot .cx-physio-why').textContent")).includes("shunt"),
    "the explanation says why");

  /* ── 2. The simulated patient: lay phrasing, DDx, Dx, plan ──────────────── */
  console.log("\n--- simulated patient ---");
  await attach(BASE + "?clinix=1&clinixdraft=1");
  await ev("window.CLINIX.open()");
  await waitFor("!!document.querySelector('#clinixRoot .cx-sys')");
  await ev("[...document.querySelectorAll('#clinixRoot .cx-sys')].find(b => b.textContent.includes('Respiratory')).click()");
  await sleep(300);
  await ev("document.querySelector('#clinixRoot .cx-row--dz').click()");
  ok(await waitFor("!!document.querySelector('#clinixRoot [data-act=\"cx-case\"]')"), "the case is offered");
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-case\"]').click()");
  ok(await waitFor("!!document.getElementById('cxCaseQ')"), "the history stage opens");

  /* The reported defect: "each student talks english differently how will he ask exact question as
   * we programmed". None of these are cue phrases in the content. */
  for (const [q, expect] of [
    ["kya takleef hai", /cough|breath|sputum|bring/i],
    ["do u smoke", /bidi|cigarette|smok/i],
    ["how many cigarettes per day", /bidi|cigarette|smok/i],
    ["what fuel do u cook with", /wood|chulha|biomass|stove|dung|cook/i]
  ]) {
    await typeInto("cxCaseQ", q);
    await ev("document.querySelector('#clinixRoot [data-act=\"cx-case-ask\"]').click()");
    await sleep(200);
    const last = await ev("[...document.querySelectorAll('#clinixRoot .cx-case-log .cx-case-a')].pop()?.textContent || [...document.querySelectorAll('#clinixRoot .cx-case-log > *')].pop()?.textContent || ''");
    ok(expect.test(String(last)), `"${q}" is understood: ${String(last).slice(0, 90)}`);
  }

  await typeInto("cxCaseQ", "what is the capital of france");
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-case-ask\"]').click()");
  await sleep(200);
  const smallTalk = await ev("[...document.querySelectorAll('#clinixRoot .cx-case-log > *')].pop().textContent");
  ok(!/cough|smok|bidi|sputum/i.test(smallTalk), "small talk never invents clinical content: " + smallTalk.slice(0, 80));

  ok((await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-case-chips\"]')")) === true,
    "the topic list is there for a student who is stuck");

  /* Walk to the differential stage. */
  for (let i = 0; i < 3; i++) {
    await ev("document.querySelector('#clinixRoot [data-act=\"cx-case-next\"]').click()");
    await sleep(350);
  }
  ok(await waitFor("!!document.getElementById('cxDdxQ')", 80), "the differential stage offers a searchable list");
  const listed = await ev("document.querySelectorAll('#clinixRoot .cx-dxrow').length");
  ok(listed > 0, `the box is never empty, it opens on the case's own system (${listed} shown)`);

  await ev(`(() => { document.getElementById('cxDdxQ').dataset.tag = "kept"; return true; })()`);
  await typeInto("cxDdxQ", "asthma");
  await sleep(200);
  ok((await ev(`document.getElementById('cxDdxQ').dataset.tag === "kept"`)) === true,
    "typing in the search box does not replace the box (same defect class)");
  ok((await ev("[...document.querySelectorAll('#clinixRoot .cx-dxrow')].some(r => /asthma/i.test(r.textContent))")) === true,
    "and the search finds the diagnosis");

  await ev("[...document.querySelectorAll('#clinixRoot .cx-dxrow')].find(r => /asthma/i.test(r.textContent)).click()");
  await sleep(200);
  await typeInto("cxDdxQ", "copd");
  await sleep(200);
  await ev("[...document.querySelectorAll('#clinixRoot .cx-dxrow')][0].click()");
  await sleep(200);
  const picked = await ev("document.querySelectorAll('#clinixRoot #cxDdxPicked .cx-chip').length");
  ok(picked >= 2, `picked diagnoses are kept as chips (${picked})`);

  ok((await ev("!!document.querySelector('#clinixRoot [data-act=\"cx-dx-hint\"]')")) === true, "a hint is available");
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-dx-hint\"]').click()");
  await sleep(250);
  ok((await ev("!!document.querySelector('#clinixRoot .cx-hints li, #clinixRoot .cx-hints p, #clinixRoot .cx-hints div')")) === true,
    "and taking it shows a graded clue rather than the answer");

  await ev("document.querySelector('#clinixRoot [data-act=\"cx-case-next\"]').click()");
  await sleep(400);
  ok((await ev("!!document.getElementById('cxDdxQ')")) === true, "the diagnosis stage is a picker too");
  const shortlist = await ev("document.querySelectorAll('#clinixRoot .cx-chip').length");
  ok(shortlist >= 2, "the student's own differential is offered first, so they commit from their list");
  await ev("[...document.querySelectorAll('#clinixRoot .cx-dxrow, #clinixRoot .cx-chip')][0].click()");
  await sleep(200);

  await ev("document.querySelector('#clinixRoot [data-act=\"cx-case-next\"]').click()");
  await sleep(400);
  const opts = await ev("document.querySelectorAll('#clinixRoot .cx-mcq-opt').length");
  ok(opts >= 8 && opts <= 14, `management is now a choice of options, not a blank box (${opts})`);
  await ev("(() => { [...document.querySelectorAll('#clinixRoot .cx-mcq-opt')].slice(0, 4).forEach(b => b.click()); return true; })()");
  await sleep(250);
  ok((await ev("document.querySelectorAll('#clinixRoot .cx-mcq-opt--on').length")) === 4, "selections stick");

  await ev("document.querySelector('#clinixRoot [data-act=\"cx-case-next\"]').click()");
  ok(await waitFor("!!document.querySelector('#clinixRoot [data-act=\"cx-case-retry\"]')", 60), "the case finishes and scores");
  const result = await ev("document.getElementById('clinixScroll').textContent.replace(/\\s+/g,' ')");
  ok(/differential/i.test(result), "the result reports the differential");
  ok(/management plan/i.test(result), "and the management plan");
} catch (e) {
  console.error("HARNESS ERROR", e);
  fails++;
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
  console.log(fails ? `\n${fails} FAILED` : "\nall green");
  process.exit(fails ? 1 : 0);
}
