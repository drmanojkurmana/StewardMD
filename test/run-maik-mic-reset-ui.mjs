/* Ask MaiK composer mic (owner video 2026-11-28). Boots the real bundle in headless Chromium with a mock
 * SMD_VOICE and checks:
 *   1. Clinical that never reaches the mic falls back to Fast after 8 s (was: teal pulse forever, no text)
 *   2. while it prepares, the composer placeholder says so; it is restored when recording ends
 *   3. a late final from the abandoned Clinical session does not end or overwrite the Fast one
 *   4. a Clinical download in progress is NOT cut off by the watchdog
 * USAGE: node test/run-maik-mic-reset-ui.mjs   (BASE=http://localhost:8991/ to reuse a server)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8993/").replace(/\/?$/, "/");
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8993"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 50; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

// clinical: never goes live (or downloads when window.__dl); fast: live + partials. Records every session.
const MOCK = () => {
  window.__s = [];
  window.SMD_VOICE = {
    available: () => ({ whisper: true }),
    listen(opts) {
      const s = { engine: opts.engine || "fast", opts, stopped: 0 }; window.__s.push(s);
      if (s.engine === "clinical") {
        setTimeout(() => opts.onState && opts.onState("preparing"), 5);
        if (window.__dl) setTimeout(() => opts.onDownloadProgress && opts.onDownloadProgress(0.34), 50);
      } else {
        setTimeout(() => { opts.onState && opts.onState("listening"); opts.onPartial && opts.onPartial("wound on the left forearm"); }, 10);
      }
      return { stop() { s.stopped++; } };
    },
    stop() { const s = window.__s[window.__s.length - 1]; if (s) s.stopped++; },
    openDialog() {}
  };
  window.SMD_NATIVE = Object.assign(window.SMD_NATIVE || {}, { cancelWhisper() { window.__cancelled = (window.__cancelled || 0) + 1; } });
};

await ensureServer();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto(BASE);
  await page.waitForFunction(() => typeof window.SMD_askMaik === "function", null, { timeout: 30000 });
  const open = async () => { await page.evaluate(() => { try { localStorage.setItem("smd_maik_inline_mic", "1"); localStorage.setItem("smd_maik_scribe_engine", "clinical"); } catch (e) {} window.SMD_askMaik(""); }); await page.waitForSelector("#maikMic"); await sleep(400); };
  const st = () => page.evaluate(() => { const m = document.getElementById("maikMic"), t = document.querySelector("#maikSheet .maik-ta"); return { live: m.classList.contains("live"), prep: m.classList.contains("prep"), ph: t.getAttribute("placeholder"), val: t.value, n: window.__s.length, eng: window.__s.map((x) => x.engine), cancelled: window.__cancelled || 0 }; });

  // 1-3
  await page.evaluate(MOCK);
  await open();
  const ph0 = await page.evaluate(() => document.querySelector("#maikSheet .maik-ta").getAttribute("placeholder"));
  await page.click("#maikMic"); await sleep(300);
  let s = await st();
  ok(s.prep && !s.live, "clinical tap: mic preparing");
  ok(/Preparing clinical dictation/.test(s.ph), "placeholder explains the wait: " + s.ph);
  await sleep(8200);
  s = await st();
  ok(s.eng.join(",") === "clinical,fast", "after 8 s with no mic, falls back to Fast: " + s.eng.join(","));
  ok(s.cancelled === 1, "abandoned Clinical session was cancelled natively (cannot grab the mic later)");
  ok(s.live, "Fast is recording (red)");
  ok(s.val.indexOf("forearm") >= 0, "Fast text reaches the composer: " + s.val);
  ok(/^Listening/.test(s.ph), "placeholder reads Listening: " + s.ph);
  await page.evaluate(() => { const c = window.__s[0].opts; c.onFinal && c.onFinal("STALE"); c.onError && c.onError("boom"); });
  await sleep(100); s = await st();
  ok(s.live && s.val.indexOf("STALE") < 0, "a late final/error from the Clinical session is ignored");
  await page.evaluate(() => { const c = window.__s[1].opts; c.onFinal("wound on the left forearm sutured"); });
  await sleep(100); s = await st();
  ok(!s.live && !s.prep, "Fast final ends recording");
  ok(s.ph === ph0, "placeholder restored: " + s.ph);
  ok(s.val === "wound on the left forearm sutured", "final kept: " + s.val);

  // 4: download under way is left alone
  await page.evaluate(() => { document.querySelector("#maikSheet .maik-ta").value = ""; window.__dl = true; });
  await page.evaluate(MOCK); await page.evaluate(() => { window.__dl = true; });
  await page.click("#maikMic"); await sleep(300);
  s = await st();
  ok(/Downloading clinical model 34%/.test(s.ph), "download progress shows in the box: " + s.ph);
  await sleep(8200); s = await st();
  ok(s.eng.join(",") === "clinical" && s.prep, "watchdog leaves a real download running");
  await page.click("#maikMic"); await sleep(200);
} catch (e) { fails++; console.log("ERROR", e && e.stack || e); }
finally { await browser.close(); if (serveProc) serveProc.kill(); }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
