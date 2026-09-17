/* test/run-icu-ocr-device.mjs — push a real monitor photo through the iPhone's Private Device OCR
 * (Apple Vision via the VisionOcr plugin) and the ICU monitor parser v2 (icu-monitor-parser.js), and
 * print what came back. Nothing leaves the phone: the photo is injected into the WebView, the plugin
 * runs on-device, colour is sampled from the same image on an in-page canvas, and a fetch/XHR tripwire
 * (with an idle control window) proves no network call happened during the read.
 *
 * Setup (see test/ios-webkit-cdp.mjs for why each line matters):
 *   1. iPhone on USB (`idevice_id -l` lists it), unlocked, Auto-Lock off, StewardMD in the foreground.
 *   2. ios_webkit_debug_proxy -c null:9221,:9222-9250        (leave running)
 *   3. Relaunch the app so a fresh page target exists, then within a few seconds:
 *      node test/run-icu-ocr-device.mjs ~/Downloads/<photo>.JPG [wsUrl]
 *
 * The parser is taken from THIS checkout's icu-monitor-parser.js and injected, so the run is meaningful
 * even when the installed bundle predates it; the installed bundle's own SMD_ICU_MONITOR (if any) is
 * reported too. Both policies are printed: strict (no label → NEEDS_REVIEW) and relaxed (unlabeledAuto). */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { connect } from "./ios-webkit-cdp.mjs";

const [photo, wsArg] = process.argv.slice(2);
if (!photo) { console.error("usage: node test/run-icu-ocr-device.mjs <photo> [wsUrl]"); process.exit(2); }
const mime = /\.png$/i.test(extname(photo)) ? "image/png" : "image/jpeg";
const dataUrl = `data:${mime};base64,` + readFileSync(photo).toString("base64");
const PARSER_SRC = readFileSync(new URL("../icu-monitor-parser.js", import.meta.url), "utf8");

async function wsUrl() {
  if (wsArg) return wsArg;
  const pages = await (await fetch("http://localhost:9222/json")).json();
  const page = pages.find((p) => /stewardmd|localhost|capacitor/i.test(p.url || "")) || pages[0];
  if (!page) throw new Error("no WebView page listed at :9222 (app not foregrounded / not relaunched?)");
  console.log("page:", page.url);
  return page.webSocketDebuggerUrl;
}
const GROUND = { hr: 105, spo2: 100, sbp: 149, dbp: 66, map: 98, rr: 22 };

const c = connect(await wsUrl(), { timeoutMs: 30000 });
try {
  const ver = await c.evaluate(`(function(){ var s=document.querySelector('script[src*="reasoning.js"]'); return (s&&s.src)||"?"; })()`);
  console.log("installed bundle:", ver, "| installed SMD_ICU_MONITOR:", await c.evaluate(`window.SMD_ICU_MONITOR ? window.SMD_ICU_MONITOR.VERSION : "none"`));
  if (!(await c.evaluate(`!!(window.SMD_NATIVE && window.SMD_NATIVE.ocr)`))) throw new Error("SMD_NATIVE.ocr missing: not the native app, or the plugin failed to load");
  // network tripwire + inject parser v2 under a private name (never touching the installed one)
  await c.evaluate(`(function(){
    window.__smdNet = [];
    function u(a){ try { return String(a && a.url ? a.url : a); } catch (e) { return "?"; } }
    var of = window.fetch; window.fetch = function(){ window.__smdNet.push(u(arguments[0])); return of.apply(this, arguments); };
    var oo = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(m, url){ window.__smdNet.push(String(url)); return oo.apply(this, arguments); };
    window.__smdV2 = (function(){ var module = { exports: {} }; ${PARSER_SRC.replace(/\bself\b/g, "undefined")}; return module.exports; })();
    return 1; })()`);
  console.log("injected parser:", await c.evaluate(`window.__smdV2 && window.__smdV2.VERSION`));
  await new Promise((r) => setTimeout(r, 3000));
  const idle = JSON.parse(await c.evaluate(`JSON.stringify(window.__smdNet.splice(0))`));
  console.log(`app background traffic over 3 s idle (control): ${idle.length} call(s)`, idle.length ? idle.map((x) => x.replace(/\?.*/, "")).join(" ") : "");

  // pixel source in-page (same construction as reasoning.js smdPixelSource), kept for the parser call
  await c.evaluateAsync(`var im = new Image(); im.onload = function(){ try { var MAX=2400, s=Math.min(1, MAX/Math.max(im.naturalWidth, im.naturalHeight)); var w=Math.round(im.naturalWidth*s), h=Math.round(im.naturalHeight*s); var cv=document.createElement("canvas"); cv.width=w; cv.height=h; var ctx=cv.getContext("2d",{willReadFrequently:true}); ctx.drawImage(im,0,0,w,h); var d=ctx.getImageData(0,0,w,h).data; window.__smdPx={w:w,h:h,get:function(x,y){ if(x<0||y<0||x>=w||y>=h) return null; var i=(y*w+x)*4; return [d[i],d[i+1],d[i+2]]; }}; window.__smdres = im.naturalWidth+"x"+im.naturalHeight+" canvas "+w+"x"+h; } catch(e){ window.__smdres="pxfail:"+e; } }; im.onerror=function(){ window.__smdres="0x0"; }; im.src=${JSON.stringify(dataUrl)};`, 60);
  const dims = await c.evaluate(`String(window.__smdres)`);
  console.log("photo:", photo, dims);
  const H = Number((dims.match(/^(\d+)x(\d+)/) || [])[2]) || 0;

  const t0 = Date.now();
  await c.evaluateAsync(`window.SMD_NATIVE.ocr(${JSON.stringify(dataUrl)}, { languageCorrection: false })
      .then(function(o){ window.__smdres = JSON.stringify(o); })
      .catch(function(e){ window.__smdres = JSON.stringify({ error: String(e && e.message || e) }); });`, 200);
  const raw = JSON.parse(await c.evaluate(`String(window.__smdres)`));
  const ocrMs = Date.now() - t0;
  if (raw.error) throw new Error("ocr failed: " + raw.error);
  const boxes = (raw.boxes || []).map((b) => ({ text: b.text, conf: b.conf == null ? null : b.conf, x: b.x, y: b.y, w: b.w, h: b.h }));
  console.log(`\nRAW APPLE VISION OBSERVATIONS (${boxes.length} boxes, ${ocrMs} ms incl. bridge, on-device)`);
  console.log("text".padEnd(28), "conf ", "x     y     w     h       hpx");
  for (const b of [...boxes].sort((a, b2) => a.y - b2.y)) console.log(JSON.stringify(b.text).padEnd(28), b.conf == null ? "  -  " : Number(b.conf).toFixed(2).padEnd(5), b.x.toFixed(3), b.y.toFixed(3), b.w.toFixed(3), b.h.toFixed(4), (b.h * H).toFixed(1));

  const run = async (opts) => JSON.parse(await c.evaluate(`(function(){ var t=Date.now(); var r = window.__smdV2.parseMonitor(${JSON.stringify(boxes)}, Object.assign({ px: window.__smdPx }, ${JSON.stringify(opts)})); r.__ms = Date.now()-t; return JSON.stringify(r); })()`));
  const strict = await run({}), relaxed = await run({ unlabeledAuto: true });
  const netUrls = JSON.parse(await c.evaluate(`JSON.stringify(window.__smdNet.splice(0))`));
  const aiCalls = netUrls.filter((x) => /\/api\/ai|vision|generativelanguage|aiplatform|gemini/i.test(x));
  console.log(`\nnetwork calls during OCR + parse window: ${netUrls.length}` + (netUrls.length ? "  " + netUrls.map((x) => x.replace(/\?.*/, "")).join(" ") : ""));
  console.log(`AI / vision endpoint calls: ${aiCalls.length}  (must be 0)`);

  for (const [name, r] of [["STRICT (default)", strict], ["RELAXED (unlabeledAuto)", relaxed]]) {
    console.log(`\n=== ${name} · layout ${r.layout.profile} · parse ${r.__ms} ms on device · colour ${r.stats.colorSampled ? "sampled" : "none"}`);
    console.log("field  status         value  conf  suggested  reason");
    let ok = 0, guesses = 0;
    for (const k of Object.keys(GROUND)) {
      const f = r.fields[k]; const v = f.value == null ? "-" : f.value;
      const correct = f.status === "AUTO_ACCEPTED" && f.value === GROUND[k]; if (correct) ok++; if (f.status === "AUTO_ACCEPTED" && f.value !== GROUND[k]) guesses++;
      console.log(k.padEnd(6), f.status.padEnd(14), String(v).padEnd(6), String(f.confidence).padEnd(5), String(f.suggested == null ? "-" : f.suggested).padEnd(10), (f.reason || "") + (correct ? "  ✓" : f.status === "AUTO_ACCEPTED" ? "  ✗ WRONG" : f.suggested === GROUND[k] ? "  (suggestion correct)" : ""));
    }
    console.log(`auto-filled correct ${ok}/6 · wrong auto-fills ${guesses} · pulse ${r.fields.pulse.status} (${r.fields.pulse.value == null ? "null" : r.fields.pulse.value})`);
  }
  console.log("\nEVIDENCE (strict):\n" + await c.evaluate(`window.__smdV2.explain(JSON.parse(${JSON.stringify(JSON.stringify(strict))}), ${JSON.stringify(boxes)})`));
} finally { c.close(); }
