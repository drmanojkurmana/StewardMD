/* test/run-clinix-heart-ui.mjs - the case stages and the physiology sandbox, in a real browser.
 *
 * Unit tests cannot catch what was actually broken here. The sandbox's defect was that onInput
 * called repaint(), which replaced the <input type=range> the student had their thumb on, so the
 * drag was cancelled on the first input event and nothing moved. That is a DOM-identity bug: it is
 * invisible to a model test and obvious the moment you check whether the element survives.
 * The same shape of bug would kill the diagnosis search box, so both are checked the same way.
 *
 * Linux: CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
 *        CHROME_FLAGS="--no-sandbox --disable-dev-shm-usage" node test/run-clinix-heart-ui.mjs
 */
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || "http://localhost:8993/").replace(/\/?$/, "/");
const PORT = 9393;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/clinix-heart-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8993"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
try { rmSync(userDir, { recursive: true, force: true }); } catch {}

const chrome = spawn(CHROME, [
  ...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean),
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--no-sandbox", "--autoplay-policy=no-user-gesture-required"
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

  console.log("\n--- Sound Lab: recorded heart sounds ---");
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-soundlab\"]').click()");
  ok(await waitFor("!!document.querySelector('#clinixRoot [data-act=\"cx-sound-filter\"][data-id=\"rec\"]')"), "the Sound Lab has a Heart recordings filter");
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-sound-filter\"][data-id=\"rec\"]').click()");
  await sleep(300);
  const n = await ev("document.querySelectorAll('#clinixRoot [data-act=\"cx-audio\"]').length");
  ok(n === 8, "the filter lists the 8 recorded sounds (" + n + ")");
  const labels = await ev("[...document.querySelectorAll('#clinixRoot [data-act=\"cx-audio\"]')].map(b => b.textContent.trim()).join('|')");
  ok(/Recording/.test(labels) && !/Synthesized/.test(labels), "buttons say Recording, not Synthesized: " + labels);
  ok((await ev("/Real recording with phonocardiogram/.test(document.getElementById('clinixScroll').textContent)")) === true, "each card says it is a real recording with a PCG");
  ok((await ev("/source to be confirmed|Owner-supplied/.test(document.getElementById('clinixScroll').textContent)")) === true, "and carries its credit line");

  // The clip decodes and plays: play S3 (needs a user gesture in real life; headless allows it with --autoplay-policy flag).
  await ev("(() => { SMD_CLINIX_AUDIO.unlock(); window.__plays = []; const o = SMD_CLINIX_AUDIO.play; SMD_CLINIX_AUDIO.play = function (k, op) { window.__plays.push(k + '@' + Date.now() % 100000); return o.call(SMD_CLINIX_AUDIO, k, op); }; return true; })()");
  await ev("document.querySelector('#clinixRoot [data-act=\"cx-audio\"][data-id=\"rec_s3\"]').click()");
  const started = await waitFor("(() => { const h = SMD_CLINIX_AUDIO.current(); return !!(h && h.kind === 'rec_s3' && h.startsAt); })()", 80);
  ok(started, "S3 recording decodes and starts (AAC decodes in this engine)");
  const marks = await ev("(() => { const h = SMD_CLINIX_AUDIO.current(); return h ? h.spec.marksAbs.map(m => m.l).join(',') : ''; })()");
  ok(marks === "S1,S2,S3", "the PCG carries the S1, S2 and S3 markers: " + marks);
  const dur = await ev("(() => { const h = SMD_CLINIX_AUDIO.current(); return h ? +(h.endsAt - h.startsAt).toFixed(2) : 0; })()");
  ok(Math.abs(dur - 8.75) < 0.01, "the segment is 8.75 s long: " + dur);
  ok(await waitFor("!!document.querySelector('#clinixRoot canvas.cx-wave[data-wave=\"rec_s3\"]')", 40), "the live PCG canvas is on screen");
  await sleep(1200);
  if (process.env.SHOTS) { await ev(`document.querySelectorAll("[id*=splash],[id*=Splash],#introPoster,#accountGate,#introOverlay").forEach(e => e.remove()); true`); await sleep(2500); await ev(`document.getElementById("clinixScroll").scrollTop = 520; true`); await sleep(500); const r = await call("Page.captureScreenshot", { format: "png" }); (await import("node:fs")).writeFileSync(process.env.SHOTS + "/heart-soundlab.png", Buffer.from(r.result.data, "base64")); }
  const pcgInk = await ev("(() => { const c = document.querySelector('#clinixRoot canvas.cx-wave'); if (!c) return -1; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n; })()");
  ok(pcgInk > 200, "the PCG trace is actually drawn from the audio (" + pcgInk + " inked pixels)");
  const dbg = await ev("(() => { const A = SMD_CLINIX_AUDIO; const before = A.current() && A.current().kind; A.stopAll(); const h = A.current(); return before + '>' + (h ? h.kind + ':' + h.ended() : 'none'); })()");
  console.log("  stopAll debug: " + dbg);
  await sleep(300);
  const cur = await ev("(() => { const h = SMD_CLINIX_AUDIO.current(); return h ? h.kind + ':ended=' + h.ended() : 'none'; })()");
  ok(cur === "none", "Stop ends it (" + cur + ") plays=" + (await ev("window.__plays.join(',')")));
  console.log("\n" + (fails ? fails + " FAILED" : "ALL GREEN"));
} catch (e) { console.log("RUNNER ERROR", e); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); try { serveProc && serveProc.kill(); } catch {} process.exit(fails ? 1 : 0); }
