/* Kardia WP3 ultrasound renderer: headless WebGL test.
 * Same CDP-over-pipe harness as test/run-kardia-geom-ui.mjs (see its
 * header for why: chrome-headless-shell, --single-process, SwiftShader,
 * screenshots from canvas.toDataURL).
 * USAGE: CHROME=<chrome-headless-shell> CHROME_FLAGS="--single-process --no-zygote --no-sandbox --disable-gpu" node test/run-kardia-us-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SHOTS = join(ROOT, "work", "shots");
const CHROME = process.env.CHROME || "/tmp/pptr/chrome-headless-shell/mac_arm-156.0.8078.47/chrome-headless-shell-mac-arm64/chrome-headless-shell";
mkdirSync(SHOTS, { recursive: true });

const viewsJson = readFileSync(join(ROOT, "kardia", "views.json"), "utf8");
writeFileSync(join(ROOT, "work", "kardia-us-data.js"),
  "window.__KG_VIEWS=" + viewsJson.replace(/<\/script>/g, "<\\/script>") + ";\n");

writeFileSync(join(ROOT, "work", "kardia-us-harness.html"), `<!doctype html><meta charset="utf-8"><title>Kardia US harness</title>
<body style="margin:0;background:#000"><canvas id="cv"></canvas>
<script src="../kardia-sim-heart.js"></script>
<script src="../kardia-sim-geom.js"></script>
<script src="../kardia-sim-us.js"></script>
<script src="kardia-us-data.js"></script>
<script>
window.__errors = [];
window.addEventListener("error", function (e) { window.__errors.push(String(e.message || e)); });
window.__boot = (function () {
  try {
    var heart = KARDIA_HEART.create(KARDIA_HEART.presets.normal);
    for (var t = 0; t < 12000; t += 10) heart.step(10);
    var geom = KARDIA_GEOM.create({ heart: heart, views: window.__KG_VIEWS });
    var canvas = document.getElementById("cv");
    var us = KARDIA_US.create(canvas, geom, heart);
    window.__heart = heart; window.__geom = geom; window.__us = us;
    window.__setView = function (viewId, w, h) {
      canvas.width = w; canvas.height = h; canvas.style.width = w + "px"; canvas.style.height = h + "px";
      us.setProbe({ viewId: viewId });
      heart.step(120); us.frame(performance.now());
      return JSON.stringify(us.snapshot());
    };
    window.__frame = function (stepMs, wantShot) {
      heart.step(stepMs);
      var t0 = performance.now(); var ok = us.frame(performance.now()); var ms = performance.now() - t0;
      var png = null;
      if (wantShot) png = canvas.toDataURL("image/png").split(",")[1];
      return JSON.stringify({ ok: ok, ms: ms, snap: us.snapshot(), png: png, errors: us.errors });
    };
    window.__ready = true;
  } catch (e) { window.__errors.push(String(e && e.stack || e)); window.__ready = "failed"; }
})();
</script></body>`);

const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean),
  "--remote-debugging-pipe", `--user-data-dir=${"/tmp/kardia-us-ui-" + Date.now()}`,
  "--no-first-run", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--mute-audio", "--window-size=900,900"],
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

const VIEWS = [["tte_plax", "PLAX"], ["tte_psax_papillary", "PSAX-papillary"], ["tte_a4c", "A4C"], ["tte_subcostal_4c", "subcostal"]];
try {
  await sleep(800);
  const created = await call("Target.createTarget", { url: "about:blank" });
  const att = await call("Target.attachToTarget", { targetId: created.result.targetId, flatten: true });
  sessionId = att.result.sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Page.navigate", { url: pathToFileURL(join(ROOT, "work", "kardia-us-harness.html")).href });
  ok(await until(`return window.__ready === true || window.__ready === "failed";`), "harness booted");
  ok((await ev(`return JSON.stringify(window.__errors);`)) === "[]", "no page errors at boot");
  console.log("  us errors: " + (await ev(`return JSON.stringify(window.__us ? window.__us.errors : "no us");`)));
  const frameTimes = [];
  for (const width of [390, 820]) {
    for (const [viewId, label] of VIEWS) {
      const snap = JSON.parse(await ev(`return window.__setView(${JSON.stringify(viewId)}, ${width}, ${Math.round(width * 0.8)});`) || "{}");
      const fr = JSON.parse(await ev(`return window.__frame(200, true);`) || "{}");
      frameTimes.push(fr.ms);
      console.log(`  ${label} @${width}: blood=${snap.bloodMean?.toFixed(3)} myo=${snap.myoMean?.toFixed(3)} mean=${fr.snap?.mean?.toFixed(3)} bN=${snap.bloodCount} mN=${snap.myoCount} ms=${fr.ms?.toFixed(1)} mode=${fr.snap?.mode}`);
      ok(fr.ok && fr.errors && fr.errors.length === 0, `${label} @${width} renders without errors`);
      ok(snap.bloodCount > 0 && snap.myoCount > 0, `${label} @${width} samples blood and myocardium`);
      ok(snap.bloodMean < snap.myoMean, `${label} @${width} blood pools darker than myocardium (${snap.bloodMean?.toFixed(3)} < ${snap.myoMean?.toFixed(3)})`);
      // image-quality bands at default gain (geometry-tag masks in snapshot())
      ok(snap.bloodMean >= 0.02 && snap.bloodMean <= 0.10, `${label} @${width} blood in 0.02..0.10 (${snap.bloodMean?.toFixed(3)})`);
      ok(snap.myoMean >= 0.30 && snap.myoMean <= 0.55, `${label} @${width} myocardium in 0.30..0.55 (${snap.myoMean?.toFixed(3)})`);
      if (snap.brightCount > 20) ok(snap.brightMean >= 0.70 && snap.brightMean <= 1.0, `${label} @${width} valves/pericardium in 0.70..1.0 (${snap.brightMean?.toFixed(3)})`);
      if (snap.shadowCount > 20) ok(snap.shadowMean < 0.1, `${label} @${width} lung/rib shadow below 0.1 (${snap.shadowMean?.toFixed(3)})`);
      ok(snap.blockiness && snap.blockiness.maxRunH <= 3 && snap.blockiness.maxRunV <= 3, `${label} @${width} no identical run over 3 px (${JSON.stringify(snap.blockiness)})`);
      ok(snap.autocorrelation && snap.autocorrelation.lateralMm > snap.autocorrelation.axialMm, `${label} @${width} speckle elongated laterally (${JSON.stringify(snap.autocorrelation)})`);
      ok(snap.ecgSectorOverlapPx === 0 && snap.layout && snap.layout.sector.bottom <= snap.layout.ecg.y0, `${label} @${width} ECG strip does not overlap sector`);
      if (fr.png) { const p = join(SHOTS, `kardia-us-${label}-${width}.png`); writeFileSync(p, Buffer.from(fr.png, "base64")); console.log("   shot: " + p); }
      else ok(false, `${label} @${width} screenshot present`);
    }
  }
  // gain raises mean brightness
  await ev(`window.__us.setKnobs({gain: 0}); return 1;`);
  const g0 = JSON.parse(await ev(`return window.__frame(50, false);`) || "{}");
  await ev(`window.__us.setKnobs({gain: 24}); return 1;`);
  const g1 = JSON.parse(await ev(`return window.__frame(50, false);`) || "{}");
  console.log(`  gain 0 mean=${g0.snap?.mean?.toFixed(3)} gain 24 mean=${g1.snap?.mean?.toFixed(3)}`);
  ok(g1.snap.mean > g0.snap.mean + 0.02, "gain raises mean brightness");
  await ev(`window.__us.setKnobs({gain: 0}); return 1;`);
  // depth change changes the scale
  const d0 = JSON.parse(await ev(`return window.__setView("tte_plax", 390, 312);`) || "{}");
  await ev(`window.__us.setKnobs({depth: 100}); window.__us.setProbe({viewId: "tte_plax", depthMm: 100}); return 1;`);
  const d1f = JSON.parse(await ev(`return window.__frame(50, false);`) || "{}");
  console.log(`  depth 160 scale=${d0.depthMm} depth 100 scale=${d1f.snap?.depthMm}`);
  ok(d0.depthMm === 160 && d1f.snap.depthMm === 100, "depth change changes the scale");
  await ev(`window.__us.setKnobs({depth: 160}); return 1;`);
  // frame rate over 60 frames
  const t0 = Date.now(); let lastMs = 0;
  for (let i = 0; i < 30; i++) { const fr = JSON.parse(await ev(`return window.__frame(16, false);`) || "{}"); lastMs = fr.ms; }
  console.log(`  30-frame run wallMs=${Date.now() - t0} lastFrameMs=${lastMs?.toFixed(1)} (SwiftShader CPU; excludes CDP round trip in wall time)`);
  // context loss and restore
  ok(await ev(`return window.__us._loseContext();`) === true, "WEBGL_lose_context available");
  ok(await until(`return window.__us.isContextLost() === true;`, 10000), "context loss caught");
  const lostFrame = JSON.parse(await ev(`return window.__frame(16, false);`) || "{}");
  ok(lostFrame.ok === true, "frame() during context loss does not throw");
  await ev(`window.__us._restoreContext(); return 1;`);
  ok(await until(`return window.__us.isContextLost() === false;`, 10000), "context restored");
  const after = JSON.parse(await ev(`return window.__frame(50, true);`) || "{}");
  ok(after.ok && after.errors.length === 0, "renders after restore");
  if (after.png) writeFileSync(join(SHOTS, "kardia-us-restored.png"), Buffer.from(after.png, "base64"));
  ok((await ev(`return JSON.stringify(window.__errors);`)) === "[]", "no page errors at end");
  const sorted = frameTimes.slice().sort((a, b) => a - b);
  console.log(`frame times ms: ${frameTimes.map((x) => x.toFixed(1)).join(", ")} (median ${sorted[Math.floor(sorted.length / 2)].toFixed(1)}, SwiftShader)`);
} catch (e) { console.log("ERROR", e && e.stack || e); fails++; }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
