/* Kardia WP2 geometry: headless WebGL render of the beating heart.
 *
 * Diagnosis (2026-10-25, this sandbox): the installed Google Chrome 155
 * GUI binary aborts on launch (SIGABRT in TransformProcessType /
 * _RegisterApplication, macOS 27 crash reports), and even a working
 * binary cannot bind a loopback socket here (bind: Operation not
 * permitted), so a CDP port and a localhost dev server are both
 * impossible in this environment. The working runtime is
 * chrome-headless-shell (Chrome for Testing), acquired through the
 * normal install path:
 *   npm_config_cache=/tmp/npm-cache PUPPETEER_CACHE_DIR=/tmp/pptr \
 *     npx -y @puppeteer/browsers install chrome-headless-shell@stable
 * It needs --single-process --no-zygote because the sandbox denies
 * the Mach bootstrap rendezvous for child processes, --disable-gpu
 * because the GPU process will not allocate IOSurfaces here (with
 * --enable-unsafe-swiftshader, already passed below, WebGL 1.0 then
 * runs on CPU SwiftShader), and CDP must run over
 * --remote-debugging-pipe (fds 3/4), not a port.
 * Page data (views, manifest, the LOD cardiac chunk) is injected as
 * generated scripts under work/ and only falls back to ingestion when
 * the HTTP loadAtlas path is unreachable (file:// has no server).
 * Screenshots are read from the canvas itself (toDataURL in the same
 * task as the render), because Page.captureScreenshot needs an
 * IOSurface this sandbox will not allocate.
 *
 * Renders 3 frames across the cycle at 390 and 820 widths into
 * work/shots/, checks for WebGL errors, and exercises context loss
 * and restore.
 * USAGE: CHROME=<chrome-headless-shell> \
 *   CHROME_FLAGS="--single-process --no-zygote --no-sandbox --disable-gpu" \
 *   node test/run-kardia-geom-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

process.env.NO_PROXY = [process.env.NO_PROXY, "localhost,127.0.0.1"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SHOTS = join(ROOT, "work", "shots");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(SHOTS, { recursive: true });
mkdirSync(join(ROOT, "work"), { recursive: true });

/* ---- generated data scripts (fallback ingestion, file:// has no server) ---- */
const viewsJson = readFileSync(join(ROOT, "kardia", "views.json"), "utf8");
const manifestJson = readFileSync(join(ROOT, "atlas", "3d", "manifest.json"), "utf8");
const chunkGzB64 = readFileSync(join(ROOT, "atlas", "3d", "cardiac-6.lo.bin.gz")).toString("base64");
writeFileSync(join(ROOT, "work", "kardia-geom-data.js"),
  "window.__KG_VIEWS=" + viewsJson.replace(/<\/script>/g, "<\\/script>") + ";\n" +
  "window.__KG_MANIFEST=" + manifestJson.replace(/<\/script>/g, "<\\/script>") + ";\n" +
  "window.__KG_CHUNK_GZ_B64=" + JSON.stringify(chunkGzB64) + ";\n");

writeFileSync(join(ROOT, "work", "kardia-geom-harness.html"), `<!doctype html><meta charset="utf-8"><title>Kardia geom harness</title>
<body style="margin:0;background:#111"><canvas id="cv"></canvas>
<script src="../atlas3d.js"></script>
<script src="../kardia-sim-heart.js"></script>
<script src="../kardia-sim-geom.js"></script>
<script src="kardia-geom-data.js"></script>
<script>
window.__errors = [];
window.addEventListener("error", function (e) { window.__errors.push(String(e.message || e)); });
window.__boot = (async function () {
  try {
    var heart = KARDIA_HEART.create(KARDIA_HEART.presets.normal);
    for (var t = 0; t < 12000; t += 10) heart.step(10);
    var geom = KARDIA_GEOM.create({ heart: heart, views: window.__KG_VIEWS });
    var load = null;
    try { load = await geom.loadAtlas({ systems: ["cardiac"] }); } catch (e) { load = null; }
    if (!load || !load.parts) {
      geom.ingestManifest(window.__KG_MANIFEST);
      var chunk = null, i;
      for (i = 0; i < window.__KG_MANIFEST.lod.chunks.length; i++) if (window.__KG_MANIFEST.lod.chunks[i].id === "cardiac-6") chunk = window.__KG_MANIFEST.lod.chunks[i];
      var bin = atob(window.__KG_CHUNK_GZ_B64), bytes = new Uint8Array(bin.length);
      for (i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      var raw = await new Response(stream).arrayBuffer();
      var added = geom.ingestChunk(chunk, raw);
      load = { parts: geom.loadedParts().length, added: added, chunks: 1, fallback: true };
    }
    var canvas = document.getElementById("cv");
    var renderer = geom.createRenderer(canvas);
    window.__heart = heart; window.__geom = geom; window.__renderer = renderer; window.__load = load;
    window.__frame = function (stepMs, wantShot) {
      heart.step(stepMs); geom.update();
      var t0 = performance.now();
      var ok = renderer.render({});
      var ms = performance.now() - t0;
      var f = renderer.readFrame();
      var h = 0, lit = 0;
      if (f) for (var i = 0; i < f.px.length; i += 4 * 7) { h = (h * 31 + f.px[i] * 3 + f.px[i + 1] * 5 + f.px[i + 2] * 7) >>> 0; if (f.px[i] + f.px[i + 1] + f.px[i + 2] > 90) lit++; }
      var png = null;
      if (wantShot) { renderer.render({ refresh: false }); png = canvas.toDataURL("image/png").split(",")[1]; }
      return JSON.stringify({ ok: ok, ms: ms, h: h, lit: lit, lv: heart.state().volumes.LV, tris: renderer.triangleCount, errors: renderer.errors, png: png });
    };
    window.__measureFps = function (durationMs) {
      return new Promise(function (resolve) {
        var frames = 0, t0 = performance.now();
        function tick() { heart.step(16); geom.update(); renderer.render({}); frames++; if (performance.now() - t0 < durationMs) requestAnimationFrame(tick); else resolve(JSON.stringify({ frames: frames, ms: performance.now() - t0, fps: frames / ((performance.now() - t0) / 1000) })); }
        requestAnimationFrame(tick);
      });
    };
    window.__ready = true;
    return load;
  } catch (e) { window.__errors.push(String(e && e.stack || e)); window.__ready = "failed"; }
})();
</script></body>`);

/* ---- CDP over pipe (fd 3 in, fd 4 out, NUL-separated JSON) ---- */
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean),
  "--remote-debugging-pipe", `--user-data-dir=${"/tmp/kardia-geom-ui-" + Date.now()}`,
  "--no-first-run", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--mute-audio", "--window-size=820,900"],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
chrome.stderr.on("data", (d) => { if (process.env.KG_DEBUG) process.stderr.write("[chrome] " + d); });
let msgId = 1; const pending = new Map(); let sessionId, buf = Buffer.alloc(0);
chrome.stdio[4].on("data", (d) => {
  buf = Buffer.concat([buf, d]);
  let i;
  while ((i = buf.indexOf(0)) >= 0) {
    let m; try { m = JSON.parse(buf.slice(0, i).toString()); } catch { buf = buf.slice(i + 1); continue; }
    buf = buf.slice(i + 1);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});
const call = (m, p) => { const i = msgId++; return new Promise((r, rej) => { const to = setTimeout(() => { pending.delete(i); rej(new Error("CDP " + m + " timeout")); }, 120000); pending.set(i, (x) => { clearTimeout(to); r(x); }); chrome.stdio[3].write(JSON.stringify({ id: i, method: m, params: p || {}, sessionId }) + "\0"); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const until = async (expr, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr) === true) return true; await sleep(250); } return false; };

try {
  await sleep(800);
  const created = await call("Target.createTarget", { url: "about:blank" });
  const targetId = created.result.targetId;
  const att = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = att.result.sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Page.navigate", { url: pathToFileURL(join(ROOT, "work", "kardia-geom-harness.html")).href });
  ok(await until(`return window.__ready === true || window.__ready === "failed";`), "harness booted (geometry + atlas load)");
  const errs = await ev(`return JSON.stringify(window.__errors);`);
  ok(errs === "[]", "no page errors: " + errs);
  const load = JSON.parse(await ev(`return JSON.stringify(window.__load);`) || "{}");
  ok(load.parts >= 15, `BodyParts3D LOD cardiac parts loaded: ${load.parts} parts, ${load.added} added, fallback=${!!load.fallback}`);

  const frameTimes = [];
  for (const width of [390, 820]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 700, deviceScaleFactor: 1, mobile: false });
    await ev(`var c=document.getElementById('cv'); c.width=${width}; c.height=${Math.round(width * 0.75)}; c.style.width='${width}px'; c.style.height='${Math.round(width * 0.75)}px'; return 1;`);
    const hashes = [];
    for (let f = 0; f < 3; f++) {
      const fr = JSON.parse(await ev(`return window.__frame(${f === 0 ? 0 : 200}, true);`) || "{}");
      frameTimes.push(fr.ms);
      hashes.push(fr.h);
      ok(fr.ok && fr.lit > 100 && fr.errors && fr.errors.length === 0, `width ${width} frame ${f}: lit=${fr.lit} LV=${fr.lv && fr.lv.toFixed(1)}ml tris=${fr.tris} frameMs=${fr.ms && fr.ms.toFixed(1)}`);
      if (fr.png) { writeFileSync(join(SHOTS, `kardia-geom-${width}-frame${f}.png`), Buffer.from(fr.png, "base64")); console.log("   shot: " + join(SHOTS, `kardia-geom-${width}-frame${f}.png`)); }
      else ok(false, `width ${width} frame ${f}: screenshot data present`);
    }
    ok(new Set(hashes).size === 3, `width ${width}: 3 frames across the cycle differ (beating)`);
  }
  // multi-frame responsiveness via awaitPromise evaluate
  const fpsR = await call("Runtime.evaluate", { expression: `window.__measureFps(1200)`, awaitPromise: true, returnByValue: true });
  const fps = JSON.parse(fpsR.result && fpsR.result.result ? fpsR.result.result.value : "{}");
  ok(fps.frames >= 5, `multi-frame responsiveness: ${fps.frames} frames in ${fps.ms && fps.ms.toFixed(0)} ms (${fps.fps && fps.fps.toFixed(1)} fps, SwiftShader)`);
  console.log(`FPS: ${fps.fps && fps.fps.toFixed(2)} (${fps.frames} frames / ${fps.ms && fps.ms.toFixed(0)} ms)`);

  // context loss and restore
  ok(await ev(`return window.__renderer._loseContext();`) === true, "WEBGL_lose_context available");
  ok(await until(`return window.__renderer.isLost() === true;`, 10000), "context loss caught by renderer");
  await ev(`window.__renderer._restoreContext(); return 1;`);
  ok(await until(`return window.__renderer.isLost() === false;`, 10000), "context restored");
  const after = JSON.parse(await ev(`return window.__frame(50, true);`) || "{}");
  ok(after.ok && after.lit > 100 && after.errors.length === 0, `renders after restore: lit=${after.lit}`);
  if (after.png) writeFileSync(join(SHOTS, "kardia-geom-restored.png"), Buffer.from(after.png, "base64"));
  const glErr = await ev(`return JSON.stringify(window.__errors);`);
  ok(glErr === "[]", "no WebGL/page errors at end: " + glErr);
  const sorted = frameTimes.slice().sort((a, b) => a - b);
  console.log(`frame times ms: ${frameTimes.map((x) => x.toFixed(1)).join(", ")} (SwiftShader; median ${sorted[Math.floor(sorted.length / 2)].toFixed(1)}, includes CPU deform + buffer upload + readback render)`);
} catch (e) { console.log("ERROR", e && e.stack || e); fails++; }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
