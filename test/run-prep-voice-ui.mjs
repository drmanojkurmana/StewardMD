/* PrepNucleus natural voice (prep-voice.js: Phonon 31M through the vendored phonon-tts runtime) in headless Chrome, against a
 * STUB of the phonon-tts module (the real runtime is vendored in vendor/phonon-tts and is not run here). Checks: available(),
 * download progress reaches 1 and the state is ready, the runtime is loaded 8-bit on one thread from the app bundle, the
 * one-time speed timing decides usable() (a fast phone uses the voice, a slow one keeps the system voice), say() plays a
 * sentence to its end at the lesson's speed, prefetch renders ahead, stop() ends playback, release() frees the model,
 * remove() clears the download, and window.SMD_PREP_VOICE = false switches it off.
 * USAGE: node test/run-prep-voice-ui.mjs
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { freePort } from "./free-port.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const { chromium } = req("playwright");
const PORT = await freePort(), BASE = `http://localhost:${PORT}/`;
const serve = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const STUB = `
  export class PhononTTS { static async load(o) {
    o.onProgress({ file: "model.q8.gguf", loaded: 0, total: 1000 }); await new Promise((r) => setTimeout(r, 20)); o.onProgress({ file: "model.q8.gguf", loaded: 1000, total: 1000 });
    window.__opts = { lang: o.lang, quant: o.quant, threads: o.threads, device: o.device, worker: o.workerUrl, wasm: o.wasmUrl, simd: o.simdWasmUrl, voices: o.voices };
    const t = new PhononTTS(); t.sampleRate = 24000; return t; }
    async synth(text, opt) { window.__said = (window.__said || []).concat([text]); await new Promise((r) => setTimeout(r, window.__slow || 30)); const a = new Float32Array(24000); for (let i = 0; i < a.length; i++) a[i] = 0.2 * Math.sin(i / 20); return a; }
    dispose() { window.__disposed = true; } }
  export async function clearCache() { window.__cleared = true; }`;
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"] });
async function page(init) {
  const ctx = await browser.newContext();
  await ctx.route(BASE + "__blank", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset=\"utf-8\"><title>voice</title>" }));
  await ctx.route(BASE + "vendor/phonon-tts/index.js", (r) => r.fulfill({ contentType: "text/javascript", body: STUB }));
  const pg = await ctx.newPage();
  pg.on("pageerror", (e) => console.log("PAGEERR " + e.message));
  if (init) await pg.addInitScript(init);
  await pg.goto(BASE + "__blank");
  await pg.addScriptTag({ url: "/prep-voice.js" });
  return pg;
}
try {
  // a phone that keeps up
  let pg = await page();
  const w = await pg.evaluate(async () => {
    const V = window.PREP_VOICE, avail = V.available(), before = V.state(); V.unlock();
    const prog = []; await V.download((p) => prog.push(p));
    const o = window.__opts;
    const t0 = Date.now(); await V.say("Hello there.", 1.25); const took = Date.now() - t0;
    V.prefetch("Next sentence.");
    await new Promise((r) => setTimeout(r, 100));
    const p = V.say("This sentence is stopped before it can finish playing."); await new Promise((r) => setTimeout(r, 200)); V.stop(); await Promise.race([p, new Promise((r) => setTimeout(r, 3000))]);
    const usable = V.usable(), rtf = V.rtf();
    V.release();
    return { avail, before, state: "ready", last: prog[prog.length - 1], o, took, said: window.__said, usable, rtf, disposed: !!window.__disposed, after: V.state() };
  });
  ok(w.avail && w.before === "none", "the voice is available in this browser and starts empty");
  ok(w.last === 1 && w.rtf > 0 && w.usable, "it downloads, reports progress to 1, times itself and is usable on a fast phone (x" + w.rtf.toFixed(2) + ")");
  ok(w.o.lang === "en" && w.o.quant === "q8" && w.o.threads === 1 && w.o.device === "cpu" && w.o.voices === undefined && /vendor\/phonon-tts\/worker\.js$/.test(w.o.worker) && /phonon_tts_simd_bg\.wasm$/.test(w.o.simd), "it loads the vendored runtime, 8-bit, one thread, the one default voice, from the app bundle");
  ok(w.took > 400 && w.said.indexOf("Hello there.") >= 0 && w.said.indexOf("Next sentence.") >= 0, "say() speaks a sentence (at 1.25 times) and prefetch renders the next one");
  ok(w.disposed && w.after === "none", "stop() ends playback and release() frees the model");
  await pg.evaluate(async () => { await window.PREP_VOICE.remove(); });
  ok(await pg.evaluate(() => !!window.__cleared), "remove() clears the downloaded files");
  // a phone too slow for it
  pg = await page(() => { window.__slow = 4000; });
  const slow = await pg.evaluate(async () => { const V = window.PREP_VOICE; await V.download(); return { usable: V.usable(), ready: V.ready(), rtf: V.rtf() }; });
  ok(slow.ready && !slow.usable && slow.rtf > 1.3, "on a phone that renders slower than 1.3 times real time the voice is ready but not usable (x" + slow.rtf.toFixed(1) + "), so the lesson keeps the system voice");
  // switched off
  pg = await page(() => { window.SMD_PREP_VOICE = false; });
  ok(await pg.evaluate(() => !window.PREP_VOICE.available()), "window.SMD_PREP_VOICE = false switches the voice off");
} catch (e) { console.log("FAIL " + (e && e.stack || e)); fails++; }
await browser.close(); serve.kill();
console.log(fails ? "FAILED " + fails : "ALL PASS");
process.exit(fails ? 1 : 0);
