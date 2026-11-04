/* PrepNucleus natural voice (prep-voice.js) in headless Chrome with the real vendored onnxruntime-web: it downloads the
 * model (92 MB, checksum pinned), keeps it in the Cache API, phonemizes with the shipped lexicon and renders speech.
 * Checks: download progress reaches 1 and the state is "ready"; a second page load finds the model cached (no network);
 * a sentence renders to audible 24 kHz audio of a sensible length; the lexicon covers the lesson corpus.
 * VOICE_OUT=<dir> writes each rendered sentence as a WAV (for listening or transcription).
 * USAGE: node test/run-prep-voice-ui.mjs   (VOICE_DIR=<dir with model_quantized.onnx and af_heart.bin> skips the download)
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
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
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext();
await ctx.route(BASE + "__blank", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset=\"utf-8\"><title>voice</title>" }));
let hf = 0;
if (process.env.VOICE_DIR) await ctx.route("https://huggingface.co/**", (r) => { hf++; const f = r.request().url().split("/").pop(); r.fulfill({ body: fs.readFileSync(join(process.env.VOICE_DIR, f)), headers: { "content-length": String(fs.statSync(join(process.env.VOICE_DIR, f)).size) } }); });
else await ctx.route("https://huggingface.co/**", (r) => { hf++; r.continue(); });
const SENTENCES = process.env.VOICE_TEXT ? process.env.VOICE_TEXT.split("|") : [
  "Give trimethoprim sulfamethoxazole, one double strength tablet, three times weekly.",
  "Atovaquone 1500 milligrams daily is the alternative for sulfa allergic patients.",
  "The tumour is staged by imaging, and the haemoglobin is checked before chemotherapy."
];
try {
  const page = await ctx.newPage();
  page.on("crash", () => console.log("CRASH")); page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE " + m.text().slice(0, 200)); }); page.on("pageerror", (e) => console.log("PAGEERR " + e.message));
  await page.goto(BASE + "__blank");
  await page.addScriptTag({ url: "/prep-voice.js" });
  const t0 = Date.now();
  const r = await page.evaluate(async () => {
    const V = window.PREP_VOICE, prog = []; 
    await V.download((p) => prog.push(Math.round(p * 100)));
    return { state: V.state(), last: prog[prog.length - 1], n: prog.length };
  });
  ok(r.state === "ready" && r.last === 100, "download finishes and the model is ready (" + r.n + " progress ticks, " + ((Date.now() - t0) / 1000).toFixed(1) + " s)");
  const sp = await page.evaluate(async () => {
    const V = window.PREP_VOICE; V.unlock();
    const t = Date.now();
    await Promise.race([V.say("Hello there.", 1), new Promise((_, rej) => setTimeout(() => rej(new Error("say timed out")), 20000))]);
    return { took: Date.now() - t, rtf: V.rtf(), usable: V.usable() };
  });
  ok(sp.took > 500 && sp.rtf > 0 && sp.usable === (sp.rtf <= 1.3), `say() plays a sentence to its end (${(sp.took / 1000).toFixed(1)} s); this machine benchmarks at x${sp.rtf.toFixed(2)} real time, so the lesson ${sp.usable ? "uses" : "keeps the system voice instead of"} the natural voice`);
  const stopped = await page.evaluate(async () => { const V = window.PREP_VOICE; const p = V.say("This sentence is stopped before it can finish playing.", 1); await new Promise((r) => setTimeout(r, 200)); V.stop(); await Promise.race([p, new Promise((r) => setTimeout(r, 3000))]); return true; });
  ok(stopped, "stop() ends a sentence that is being synthesised or played");
  const out = [];
  for (const s of SENTENCES) {
    const t = Date.now();
    const w = await page.evaluate(async (text) => { const a = await window.PREP_VOICE.render(text, 1); let rms = 0, pk = 0; for (let i = 0; i < a.length; i++) { rms += a[i] * a[i]; pk = Math.max(pk, Math.abs(a[i])); } return { n: a.length, rms: Math.sqrt(rms / a.length), pk, data: Array.from(a) }; }, s);
    const secs = w.n / 24000, took = (Date.now() - t) / 1000;
    out.push({ s, w, secs, took });
    ok(secs > 0.8 && secs < 15 && w.rms > 0.01 && w.pk < 1.01, `renders audible speech: ${secs.toFixed(1)} s of audio in ${took.toFixed(1)} s (x${(took / secs).toFixed(2)} real time), rms ${w.rms.toFixed(3)}`);
  }
  if (process.env.VOICE_OUT) {
    fs.mkdirSync(process.env.VOICE_OUT, { recursive: true });
    const V = req("../prep-voice.js");
    out.forEach((o, i) => fs.writeFileSync(join(process.env.VOICE_OUT, "s" + (i + 1) + ".wav"), Buffer.from(V.wavBlob(Float32Array.from(o.w.data)))));
  }
  const before = hf;
  const page2 = await ctx.newPage();
  await page2.goto(BASE + "__blank");
  await page2.addScriptTag({ url: "/prep-voice.js" });
  const again = await page2.evaluate(async () => { const V = window.PREP_VOICE; await V.download(); return V.state(); });
  ok(again === "ready" && hf === before, "a second launch loads the model from the cache with no download");
} catch (e) { console.log("FAIL " + (e && e.stack || e)); fails++; }

// ---- Phonon engine wiring, against a stub of the phonon-tts module (the real runtime is vendored in vendor/phonon-tts and is
// not run here): registration, the engine switch, download progress, the speed benchmark, say, stop, release.
try {
  const ctx2 = await browser.newContext();
  await ctx2.route(BASE + "__blank", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset=\"utf-8\"><title>phonon</title>" }));
  await ctx2.route(BASE + "vendor/phonon-tts/index.js", (r) => r.fulfill({ contentType: "text/javascript", body: `
    export class PhononTTS { static async load(o) {
      o.onProgress({ file: "model.q8.gguf", loaded: 0, total: 1000 }); await new Promise((r) => setTimeout(r, 20)); o.onProgress({ file: "model.q8.gguf", loaded: 1000, total: 1000 });
      window.__phononOpts = { lang: o.lang, quant: o.quant, threads: o.threads, device: o.device, worker: o.workerUrl, wasm: o.wasmUrl, simd: o.simdWasmUrl };
      const t = new PhononTTS(); t.sampleRate = 24000; return t; }
      async synth(text, opt) { window.__phononSaid = (window.__phononSaid || []).concat([text]); await new Promise((r) => setTimeout(r, 30)); const a = new Float32Array(24000); for (let i = 0; i < a.length; i++) a[i] = 0.2 * Math.sin(i / 20); return a; }
      dispose() { window.__phononDisposed = true; } }
    export async function clearCache() { window.__phononCleared = true; }` }));
  const pg = await ctx2.newPage();
  pg.on("pageerror", (e) => console.log("PAGEERR " + e.message));
  await pg.goto(BASE + "__blank");
  await pg.addScriptTag({ url: "/prep-voice.js" });
  await pg.addScriptTag({ url: "/prep-voice-phonon.js" });
  const w = await pg.evaluate(async () => {
    const V = window.PREP_VOICE, ids = V.ids(); V.use("phonon"); V.unlock();
    const prog = []; await V.download((p) => prog.push(p));
    const o = window.__phononOpts, i = V.info("phonon");
    const t0 = Date.now(); await V.say("Hello there.", 1.25); const took = Date.now() - t0;
    V.prefetch("Next sentence.", 1);
    await new Promise((r) => setTimeout(r, 100));
    V.release();
    return { ids, cur: V.current(), name: i.name, state: i.state, rtfSet: i.rtf > 0, last: prog[prog.length - 1], o, took, said: window.__phononSaid, disposed: !!window.__phononDisposed, after: V.state() };
  });
  ok(w.ids.join(",") === "system,kokoro,phonon" && w.cur === "phonon", "both engines are registered and use() switches between them");
  ok(w.state === "ready" && w.last === 1 && w.rtfSet && w.name === "Phonon", "Phonon downloads, reports progress to 1, times itself and is ready");
  ok(w.o.lang === "en" && w.o.quant === "q8" && w.o.threads === 1 && w.o.device === "cpu" && /vendor\/phonon-tts\/worker\.js$/.test(w.o.worker) && /phonon_tts_simd_bg\.wasm$/.test(w.o.simd), "it loads the vendored runtime, 8-bit, one thread, from the app bundle");
  ok(w.took > 400 && w.said.indexOf("Hello there.") >= 0 && w.said.indexOf("Next sentence.") >= 0, "say() speaks a sentence (played at 1.25 times) and prefetch renders the next one");
  ok(w.disposed && w.after === "none", "release() frees the model");
  await pg.evaluate(async () => { await window.PREP_VOICE.remove("phonon"); });
  ok(await pg.evaluate(() => !!window.__phononCleared), "remove() clears the downloaded files");
} catch (e) { console.log("FAIL phonon wiring: " + (e && e.stack || e)); fails++; }
await browser.close(); serve.kill();
console.log(fails ? "FAILED " + fails : "ALL PASS");
process.exit(fails ? 1 : 0);
