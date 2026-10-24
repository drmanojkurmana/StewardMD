/* Kardia WP5 Doppler: headless render of PW mitral inflow, CW aortic in
 * severe AS and a colour flow MR jet frame.
 *
 * Same Chromium constraints as test/run-kardia-geom-ui.mjs: use
 * chrome-headless-shell over --remote-debugging-pipe with
 * --single-process --no-zygote; screenshots come from canvas.toDataURL.
 * The images land in work/shots/ for visual review by the lead.
 * USAGE: CHROME=<chrome-headless-shell> \
 *   CHROME_FLAGS="--single-process --no-zygote --no-sandbox --disable-gpu" \
 *   node test/run-kardia-doppler-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SHOTS = join(ROOT, "work", "shots");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(SHOTS, { recursive: true });
mkdirSync(join(ROOT, "work"), { recursive: true });

writeFileSync(join(ROOT, "work", "kardia-doppler-harness.html"), `<!doctype html><meta charset="utf-8"><title>Kardia doppler harness</title>
<body style="margin:0;background:#111">
<canvas id="pw" width="820" height="320"></canvas>
<canvas id="cw" width="820" height="320"></canvas>
<canvas id="cf" width="820" height="520"></canvas>
<script src="../kardia-sim-heart.js"></script>
<script src="../kardia-sim-doppler.js"></script>
<script>
window.__errors = [];
window.addEventListener("error", function (e) { window.__errors.push(String(e.message || e)); });
window.__boot = (function () {
  try {
    function settledHeart(params) {
      var h = KARDIA_HEART.create(params);
      for (var t = 0; t < 10000; t += 10) h.step(10);
      return h;
    }
    var out = {};
    /* PW mitral inflow, normal heart */
    var h1 = settledHeart({});
    var d1 = KARDIA_DOPPLER.create(h1);
    var pwSpec = d1.spectrum({ flow: "mitralInflow", mode: "PW", durationMs: 1800, dtMs: 3 });
    d1.drawSpectrum(document.getElementById("pw"), pwSpec);
    out.pw = d1.measure(pwSpec);
    out.pwDisplay = { nyquistMs: pwSpec.nyquistMs, peakBeamMs: Math.max.apply(null, pwSpec.beamVelocityMs),
      envelopeMaxMs: Math.max.apply(null, pwSpec.envelopeMs), envelopeMinMs: Math.min.apply(null, pwSpec.envelopeMs),
      ecgMax: Math.max.apply(null, pwSpec.ecg) };
    /* CW aortic jet, severe AS */
    var h2 = settledHeart({ preset: "severeAS" });
    var d2 = KARDIA_DOPPLER.create(h2);
    var cwSpec = d2.spectrum({ flow: "aorticJet", mode: "CW", durationMs: 1800, dtMs: 3 });
    d2.drawSpectrum(document.getElementById("cw"), cwSpec);
    out.cw = d2.measure(cwSpec);
    out.cwDisplay = { envelopeMaxMs: Math.max.apply(null, cwSpec.envelopeMs),
      envelopeMinMs: Math.min.apply(null, cwSpec.envelopeMs), scaleMs: cwSpec.scaleMs,
      peakFracOfHalfScale: Math.abs(Math.min.apply(null, cwSpec.envelopeMs)) / (cwSpec.scaleMs / 2) };
    out.pisaNote = "n/a";
    /* Colour MR jet frame, systolic instant */
    var h3 = settledHeart({ mitralRegurgAreaCm2: 0.4 });
    var d3 = KARDIA_DOPPLER.create(h3);
    for (var t3 = 0; t3 < 3000 && h3.state().flows.mitral > -150; t3 += 2) h3.step(2);
    var cf = d3.colourField({ nx: 96, ny: 96, widthMm: 170, depthMm: 170 });
    var cv = document.getElementById("cf");
    d3.drawColour(cv, cf);
    var jetPts = cf.points.filter(function (p) { return p.flow === "mrJet"; }).length;
    var widthAt = function (lo, hi) {
      var pts = cf.points.filter(function (p) { return p.flow === "mrJet" && !p.pisa && p.axialMm >= lo && p.axialMm < hi; });
      return pts.length ? 2 * Math.max.apply(null, pts.map(function (p) { return p.jetRadiusMm; })) : 0;
    };
    out.colourWidths = { venaContractaMm: widthAt(0, 8), midLAMm: widthAt(35, 50),
      pisaPoints: cf.points.filter(function (p) { return p.flow === "mrJet" && p.pisa; }).length };
    out.colourJetPoints = jetPts;
    out.colourAliased = cf.points.filter(function (p) { return p.aliased; }).length;
    window.__result = out;
    window.__ready = true;
    return out;
  } catch (e) { window.__errors.push(String(e && e.stack || e)); window.__ready = "failed"; }
})();
</script></body>`);

/* ---- CDP over pipe (fd 3 in, fd 4 out, NUL-separated JSON) ---- */
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean),
  "--remote-debugging-pipe", `--user-data-dir=${"/tmp/kardia-doppler-ui-" + Date.now()}`,
  "--no-first-run", "--mute-audio", "--window-size=860,1240"],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
chrome.stderr.on("data", (d) => { if (process.env.KD_DEBUG) process.stderr.write("[chrome] " + d); });
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
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const until = async (expr, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr) === true) return true; await sleep(250); } return false; };
const shot = async (id, name) => {
  const b64 = await ev(`return document.getElementById("${id}").toDataURL("image/png").split(",")[1];`);
  if (b64 && !String(b64).startsWith("ERR")) { writeFileSync(join(SHOTS, name), Buffer.from(b64, "base64")); console.log("   shot: " + join(SHOTS, name)); return true; }
  return false;
};

try {
  await sleep(800);
  const created = await call("Target.createTarget", { url: "about:blank" });
  const att = await call("Target.attachToTarget", { targetId: created.result.targetId, flatten: true });
  sessionId = att.result.sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Page.navigate", { url: pathToFileURL(join(ROOT, "work", "kardia-doppler-harness.html")).href });
  ok(await until(`return window.__ready === true || window.__ready === "failed";`), "harness booted (heart + doppler)");
  const errs = await ev(`return JSON.stringify(window.__errors);`);
  ok(errs === "[]", "no page errors: " + errs);
  const res = JSON.parse(await ev(`return JSON.stringify(window.__result);`) || "{}");
  console.log("PW mitral:", JSON.stringify(res.pw));
  console.log("CW aortic severe AS:", JSON.stringify(res.cw));
  console.log("colour:", JSON.stringify({ jetPoints: res.colourJetPoints, aliased: res.colourAliased }));
  ok(res.pw && res.pw.eVelocityMs > 0.6 && res.pw.eVelocityMs < 1.0, "PW mitral E in the normal band");
  ok(res.cw && res.cw.peakVelocityMs > 4 && res.cw.meanGradientMmHg > 40, "CW severe AS above both severity thresholds");
  ok(res.colourJetPoints >= 3 && res.colourAliased > 0, "colour MR jet frame has aliased jet points");
  ok(res.cwDisplay && res.cwDisplay.envelopeMaxMs <= 0 && res.cwDisplay.peakFracOfHalfScale >= 0.7 && res.cwDisplay.peakFracOfHalfScale <= 0.9,
    "CW severe AS below baseline, peak at 70-90% of scale: " + JSON.stringify(res.cwDisplay));
  ok(res.pwDisplay && res.pwDisplay.nyquistMs >= 1.2 * res.pwDisplay.peakBeamMs && res.pwDisplay.envelopeMinMs >= 0 && res.pwDisplay.ecgMax > 0.8,
    "PW mitral above baseline, default Nyquist >=1.2x peak, real ECG: " + JSON.stringify(res.pwDisplay));
  ok(res.colourWidths && res.colourWidths.venaContractaMm > 0 && res.colourWidths.venaContractaMm < res.colourWidths.midLAMm && res.colourWidths.pisaPoints >= 1,
    "colour jet VC < mid-LA width with PISA convergence: " + JSON.stringify(res.colourWidths));
  ok(await shot("pw", "kardia-doppler-pw-mitral.png"), "PW screenshot saved");
  ok(await shot("cw", "kardia-doppler-cw-severe-as.png"), "CW screenshot saved");
  ok(await shot("cf", "kardia-doppler-colour-mr.png"), "colour screenshot saved");
} catch (e) { console.log("ERROR", e && e.stack || e); fails++; }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
