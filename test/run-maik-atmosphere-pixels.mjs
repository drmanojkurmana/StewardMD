/* MaiK atmosphere energy pass: the glyph canvas must match origin/main.
 *
 * Software raster (default): the canvas must be bit-identical, every frame.
 * GPU raster (--gpu, what phones use): the canvas may differ by rounding only. GPU raster keeps
 * globalAlpha as a float, and the diff redraw skips a cell whose 8-bit alpha is unchanged, so a skipped
 * cell can sit 1-2 LSB (premultiplied) from what a full redraw would paint. No skip rule can be exact
 * against a float reference (an exact-float key repaints every cell). What matters is the screen: the
 * layer is composited at the stylesheet's opacity (.28 light, .46 dark while thinking), so the harness
 * bounds the on-screen change of each pixel over any backdrop, alpha * max(|dC|, |dC - dA|) in
 * premultiplied 8-bit units, and requires it to be <= 1/255 (a sub-LSB difference: at most one 8-bit
 * step on screen, invisible). The veil on top is ignored and the .5 s opacity fade after a theme flip is
 * modelled at the fastest frame rate (see layerOpacity), both of which only overstate the delta.
 *
 * Loads the origin/main maik-atmosphere.js (full redraw every frame) and the working-tree one (redraws
 * only changed cells) into the same minimal page, with Math.random seeded, rAF and performance.now
 * driven by hand, and compares the glyph canvas (getImageData) frame by frame, across DPRs, light and
 * dark, a palette change and a resize. Then measures Performance.getMetrics over 10 s of the busy
 * (answer pending) state for each version.
 *
 * USAGE: node test/run-maik-atmosphere-pixels.mjs [--gpu] [--ref <git-ref>] [--frames N]
 *   default is software raster (--disable-gpu), the deterministic reference.
 */
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, "..");
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const GPU = process.argv.includes("--gpu"), REF = arg("--ref", "origin/main"), FRAMES = Number(arg("--frames", 60));
const BASE = (process.env.BASE || "http://localhost:8982/").replace(/\/?$/, "/");
const PORT = 9400, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-atmo-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SRC = { old: execFileSync("git", ["show", REF + ":maik-atmosphere.js"], { cwd: ROOT, encoding: "utf8" }), new: readFileSync(join(ROOT, "maik-atmosphere.js"), "utf8") };
const CSS = readFileSync(join(ROOT, "maik-atmosphere.css"), "utf8");
const cssOpacity = (sel) => { const m = CSS.match(new RegExp(sel.replace(/\./g, "\\.") + " \\{ opacity:([.\\d]+); \\}")); if (!m) throw new Error("no opacity for " + sel); return Number(m[1]); };
// Opacity of the glyph layer when frame f is painted. The CSS has `transition: opacity .5s ease`, so after
// a dark -> light flip the layer is still fading down from .46. Frames are at least 24 ms apart (the
// module's frame gate), so modelling 24 ms per frame gives the highest opacity the fade can still have.
// Never below the class's own value: that covers light -> dark (and the fade-in, which starts from 0).
const ease = (t) => { let lo = 0, hi = 1; const bz = (u, p1, p2) => 3 * u * (1 - u) * (1 - u) * p1 + 3 * u * u * (1 - u) * p2 + u * u * u;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (bz(m, .25, .25) < t) lo = m; else hi = m; } return bz(lo, .1, 1); };   // cubic-bezier(.25,.1,.25,1)
const layerOpacity = (raw, f) => { const o = (g) => raw[g].dark ? OPACITY.dark : OPACITY.light; let g = f; while (raw[g - 1] && raw[g - 1].dark === raw[f].dark) g--;
  const t = (f - g) * 24 / 500; return !raw[g - 1] || t >= 1 ? o(f) : Math.max(o(f), o(g - 1) + (o(f) - o(g - 1)) * ease(t)); };
const OPACITY = { light: cssOpacity("#maikSheet .mk-atmo-thinking .mk-atmo-code"), dark: cssOpacity("#maikSheet .mk-atmo-dark.mk-atmo-thinking .mk-atmo-code") };

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, (BASE.match(/:(\d+)/) || [, "8982"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE + "googlefee613d97f77b414.html"); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--mute-audio", ...(GPU ? [] : ["--disable-gpu"])], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.stack||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

// Seeded Math.random, hand-driven rAF + performance.now. Installed before the module runs.
const SEED = `localStorage.clear(); var s = 0x9e3779b9; Math.random = function () { s |= 0; s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };`;
const CLOCK = `window.__now = 1000; performance.now = function () { return window.__now; };
  var q = [], id = 0; window.requestAnimationFrame = function (cb) { q.push({ id: ++id, cb: cb }); return id; };
  window.cancelAnimationFrame = function (h) { q = q.filter(function (e) { return e.id !== h; }); };
  window.__step = function (dt) { window.__now += dt; var run = q; q = []; run.forEach(function (e) { e.cb(window.__now); }); return run.length; };
  window.__queued = function () { return q.length; };`;
const DOM = `var st = document.createElement("style"); st.textContent = ${JSON.stringify(CSS)}; document.head.appendChild(st);
  document.body.innerHTML = '<div id="maikSheet" class="on" style="position:fixed;left:0;top:0;width:390px;height:700px;overflow:hidden"></div>';
  return 1;`;
const RAW = `var c = document.querySelector("#maikSheet .mk-atmo-code"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data, s = "";
  for (var i = 0; i < d.length; i += 8192) s += String.fromCharCode.apply(null, d.subarray(i, i + 8192)); return btoa(s);`;
const HASH = `var c = document.querySelector("#maikSheet .mk-atmo-code"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data, h = 2166136261, nz = 0;
  for (var i = 0; i < d.length; i++) { h = Math.imul(h ^ d[i], 16777619); if (d[i]) nz++; } return (h >>> 0).toString(16) + ":" + nz + ":" + c.width + "x" + c.height;`;

let nav = 0;
async function page(version, dpr, real) {
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: dpr, mobile: true });
  await call("Page.navigate", { url: BASE + "googlefee613d97f77b414.html?atmo=" + (++nav) }); await sleep(400);   // unique URL: a fresh document every time
  if (await ev(`return typeof window.SMD_MAIK_ATMOSPHERE`) !== "undefined") throw new Error("the page was not reloaded");
  const setup = await ev(SEED + (real ? "" : CLOCK) + DOM);
  if (setup !== 1) throw new Error("setup: " + setup);
  const r = await ev(SRC[version] + `; window.__inst = SMD_MAIK_ATMOSPHERE.mount(document.getElementById("maikSheet")); return 1;`);
  if (r !== 1) throw new Error(version + " mount: " + r);
  await sleep(300);   // the ResizeObserver's first callback (it re-seeds the letters) lands before the run
}

// Scripted run: busy on, then frames with a theme flip, a palette change, a resize and busy off/on.
async function run(version, dpr) {
  await page(version, dpr, false);
  const hashes = [], raw = {};
  await ev(`window.__inst.setBusy(true); return 1;`); hashes.push(await ev(HASH));
  for (let f = 1; f <= FRAMES; f++) {
    if (f === 15) await ev(`document.body.classList.add("dark"); return 1;`);
    if (f === 25) await ev(`document.body.classList.remove("dark"); return 1;`);
    if (f === 32) await ev(`SMD_MAIK_ATMOSPHERE.setConfig({ light: { color1: "#4f46e5", color2: "#06b6d4", color3: "#f43f5e" } }); return 1;`);
    if (f === 40) { await ev(`document.getElementById("maikSheet").style.width = "361px"; return 1;`); await sleep(250); }
    if (f === 48) await ev(`window.__inst.setBusy(false); window.__step(30); window.__inst.setBusy(true); return 1;`);
    await sleep(0);
    await ev(`window.__step(30); return 1;`);   // 30 ms > the 24 ms frame gate: every step paints
    hashes.push(await ev(HASH));
    if (GPU || f === 12 || f === FRAMES) raw[f] = { px: Buffer.from(await ev(RAW), "base64"), dark: await ev(`return document.querySelector("#maikSheet .mk-atmo").classList.contains("mk-atmo-dark")`) };
  }
  await ev(`SMD_MAIK_ATMOSPHERE.resetConfig(); return 1;`);
  hashes.raw = raw; return hashes;
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Performance.enable", {});
  console.log(`raster: ${GPU ? "GPU" : "software (--disable-gpu)"}; reference: ${REF} (${createHash("sha1").update(SRC.old).digest("hex").slice(0, 8)}); ${FRAMES} frames per run`);
  ok(SRC.old !== SRC.new, "the working tree differs from the reference (otherwise this proves nothing)");

  // 1. Pixel identity. DPR 2 and 3 clamp to 1.5 inside the module; 1.25 exercises fractional cell edges.
  const w1 = await run("old", 1), w2 = await run("old", 1);
  ok(w1.join() === w2.join(), "control: two runs of the reference give the same frames (the harness is deterministic)");
  for (const dpr of [1, 1.25, 2, 3]) {
    const a = await run("old", dpr), b = await run("new", dpr);
    const diff = a.map((h, i) => (h === b[i] ? -1 : i)).filter(i => i >= 0);
    // Per differing frame: max premultiplied channel delta, and its on-screen bound after layer opacity.
    // getImageData un-premultiplies, which blows a 1-step change in a nearly transparent pixel up to a
    // huge RGB jump; compare what is composited instead: premultiplied RGB and alpha, in 8-bit steps.
    let worst = 0;
    const dstat = Object.keys(a.raw).map(Number).filter(f => GPU ? diff.includes(f) : true).map((f) => {
      const op = layerOpacity(a.raw, f);
      const x = a.raw[f].px, y = b.raw[f].px; let mx = 0, scr = 0, n = 0;
      for (let i = 0; i < x.length; i += 4) {
        const da = (y[i + 3] - x[i + 3]) / 1; let px = 0;
        if (Math.abs(da) > .5) px = 1; if (Math.abs(da) > mx) mx = Math.abs(da);
        for (let k = 0; k < 3; k++) { const dc = (y[i + k] * y[i + 3] - x[i + k] * x[i + 3]) / 255, ad = Math.abs(dc);
          if (ad > .5) px = 1; if (ad > mx) mx = ad; const s2 = op * Math.max(ad, Math.abs(dc - da)); if (s2 > scr) scr = s2; }
        n += px; }
      if (scr > worst) worst = scr;
      return `frame ${f} (${a.raw[f].dark ? "dark" : "light"}): max premultiplied ${mx.toFixed(2)}/255 on ${(400 * n / x.length).toFixed(3)}% of pixels, on screen <= ${scr.toFixed(2)}/255`; });
    const inked = a.filter(h => Number(h.split(":")[1]) > 0).length, label = `DPR ${dpr}: ${a.length} glyph frames compared with ${REF} (${inked} with ink, canvas ${a[0].split(":")[2]})`;
    if (!GPU) { if (diff.length) console.log("  " + dstat.join("; "));
      ok(diff.length === 0 && inked > FRAMES / 2, label + ", bit-identical" + (diff.length ? ` - differ at frames ${diff.slice(0, 10).join(",")}` : "")); }
    else { if (diff.length) console.log("  worst frames: " + dstat.sort((p, q) => parseFloat(q.split("<= ")[1]) - parseFloat(p.split("<= ")[1])).slice(0, 3).join("; "));
      const unmeasured = diff.filter(f => !a.raw[f]);   // e.g. frame 0, which has no pixel capture
      ok(worst <= 1 && !unmeasured.length && inked > FRAMES / 2, label + `, ${diff.length} frames differ, max on-screen delta ${worst.toFixed(2)}/255 (limit 1)` + (unmeasured.length ? ` - frames ${unmeasured} differ unmeasured` : "")); }
  }

  // 2. The new version really skips work: count fillText calls per frame in steady state.
  await page("new", 2, false);
  const counts = JSON.parse(await ev(`var ctx = document.querySelector("#maikSheet .mk-atmo-code").getContext("2d"), n = 0, f = ctx.fillText;
    ctx.fillText = function () { n++; return f.apply(this, arguments); };
    window.__inst.setBusy(true); var out = [n]; for (var i = 0; i < 40; i++) { n = 0; window.__step(30); out.push(n); } return JSON.stringify(out);`));
  const cells = await ev(`var s = document.getElementById("maikSheet"); return Math.ceil(s.clientWidth / 11) * Math.ceil(s.clientHeight / 20);`);
  const steady = counts.slice(10), avg = steady.reduce((x, y) => x + y, 0) / steady.length;
  ok(counts[0] === cells && avg < cells * .75, `busy on paints all ${cells} cells once, then ~${Math.round(avg)} per frame (${Math.round(100 * avg / cells)}%)`);

  // 3. Cost in the busy state, real rAF, 10 s each.
  // Total CPU of every process of this Chrome (renderer + GPU + browser): raster work happens off the
  // renderer main thread, which Performance.getMetrics does not see.
  const cpu = () => execFileSync("ps", ["-A", "-o", "time=,command="], { encoding: "utf8" }).split("\n").filter(l => l.includes(userDir))
    .reduce((t, l) => { const m = l.trim().split(/\s+/)[0].split(":").map(Number); return t + (m.length === 3 ? m[0] * 3600 + m[1] * 60 + m[2] : m[0] * 60 + m[1]); }, 0);
  const perf = { old: [], new: [] }, med = (xs) => xs.slice().sort((x, y) => x - y)[xs.length >> 1];
  for (let round = 0; round < 3; round++) for (const v of ["old", "new"]) {
    await page(v, 2, true); await call("Page.bringToFront", {});
    await ev(`window.__inst.setBusy(true); window.__fr = 0; (function tick() { window.__fr++; requestAnimationFrame(tick); })(); return 1;`); await sleep(500);
    const f0 = await ev(`return window.__fr`), get = async () => Object.fromEntries((await call("Performance.getMetrics", {})).result.metrics.map(m => [m.name, m.value]));
    const m0 = await get(), c0 = cpu(); await sleep(10000); const m1 = await get(), c1 = cpu();
    perf[v].push({ script: (m1.ScriptDuration - m0.ScriptDuration) * 1000, task: (m1.TaskDuration - m0.TaskDuration) * 1000, cpu: (c1 - c0) * 1000, frames: (await ev(`return window.__fr`)) - f0 });
  }
  for (const v of ["old", "new"]) {
    perf[v].script = med(perf[v].map(r => r.script)); perf[v].task = med(perf[v].map(r => r.task)); perf[v].cpu = med(perf[v].map(r => r.cpu));
    console.log(`  ${v === "old" ? REF : "working tree"}: median of 3 x 10 s busy: ScriptDuration ${perf[v].script.toFixed(0)} ms, TaskDuration ${perf[v].task.toFixed(0)} ms, all-process CPU ${perf[v].cpu.toFixed(0)} ms (runs task/cpu: ${perf[v].map(r => r.task.toFixed(0) + "/" + r.cpu.toFixed(0)).join(", ")}; ${perf[v][0].frames} rAF frames)`);
  }
  ok(perf.new.task <= perf.old.task * 1.05, `busy-state TaskDuration not worse (${perf.old.task.toFixed(0)} -> ${perf.new.task.toFixed(0)} ms)`);

  console.log(fails === 0 ? `\nALL GREEN: glyph canvas ${GPU ? "within 1/255 on screen" : "bit-identical"}, fewer draws` : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); await sleep(500); try { rmSync(userDir, { recursive: true, force: true }); } catch {} process.exit(fails === 0 ? 0 : 1); }
