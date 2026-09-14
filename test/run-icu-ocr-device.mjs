/* test/run-icu-ocr-device.mjs — push a real monitor photo through the iPhone's Private Device OCR
 * (Apple Vision via the VisionOcr plugin) and the ICU monitor parser, and print what came back.
 * Nothing leaves the phone: the photo is injected into the WebView, the plugin runs on-device, and a
 * fetch/XHR counter proves no network call happened during the read.
 *
 * Setup (see test/ios-webkit-cdp.mjs for why each line matters):
 *   1. iPhone on USB (`idevice_id -l` lists it), unlocked, Auto-Lock off, StewardMD in the foreground.
 *   2. ios_webkit_debug_proxy -c null:9221,:9222-9250        (leave running)
 *   3. Relaunch the app so a fresh page target exists, then within a few seconds:
 *      node test/run-icu-ocr-device.mjs ~/Downloads/<photo>.JPG [kind=monitor] [wsUrl]
 *
 * The parser is taken from THIS checkout's reasoning.js and injected, so the run is meaningful even
 * when the installed bundle predates the box-aware parser; the installed bundle's own parser output is
 * printed alongside for comparison. */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { connect } from "./ios-webkit-cdp.mjs";

const [photo, kind = "monitor", wsArg] = process.argv.slice(2);
if (!photo) { console.error("usage: node test/run-icu-ocr-device.mjs <photo> [kind] [wsUrl]"); process.exit(2); }
const mime = /\.png$/i.test(extname(photo)) ? "image/png" : "image/jpeg";
const dataUrl = `data:${mime};base64,` + readFileSync(photo).toString("base64");

const SRC = readFileSync(new URL("../reasoning.js", import.meta.url), "utf8");
const ps = SRC.indexOf("  function parseMonitorBoxes(boxes) {"), pe = SRC.indexOf("  window.SMD_parseFields = parseFieldsOnDevice;");
if (ps < 0 || pe < 0) throw new Error("parser not found in reasoning.js");
const PARSER = SRC.slice(ps, pe);

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
  console.log("installed bundle:", ver);
  const hasOcr = await c.evaluate(`!!(window.SMD_NATIVE && window.SMD_NATIVE.ocr)`);
  if (!hasOcr) throw new Error("SMD_NATIVE.ocr missing: not the native app, or the plugin failed to load");
  // network tripwire + inject the parser under test
  await c.evaluate(`(function(){
    window.__smdNet = [];
    function u(a){ try { return String(a && a.url ? a.url : a); } catch (e) { return "?"; } }
    var of = window.fetch; window.fetch = function(){ window.__smdNet.push(u(arguments[0])); return of.apply(this, arguments); };
    var oo = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(m, url){ window.__smdNet.push(String(url)); return oo.apply(this, arguments); };
    window.__smdParse = (function(){ ${PARSER} return parseFieldsOnDevice; })();
    return 1; })()`);
  // control: the app's own background traffic over an idle window of the same order as the OCR
  await new Promise((r) => setTimeout(r, 3000));
  const idle = JSON.parse(await c.evaluate(`JSON.stringify(window.__smdNet.splice(0))`));
  console.log(`app background traffic over 3 s idle (control): ${idle.length} call(s)`, idle.length ? JSON.stringify(idle) : "");
  // image height, for pixel text heights
  await c.evaluateAsync(`var im = new Image(); im.onload = function(){ window.__smdres = im.naturalWidth + "x" + im.naturalHeight; }; im.onerror = function(){ window.__smdres = "0x0"; }; im.src = ${JSON.stringify(dataUrl)};`, 60);
  const dims = await c.evaluate(`String(window.__smdres)`);
  const H = Number(dims.split("x")[1]) || 0;
  console.log("photo:", photo, dims);

  const t0 = Date.now();
  await c.evaluateAsync(`window.SMD_NATIVE.ocr(${JSON.stringify(dataUrl)}, { languageCorrection: false })
      .then(function(o){ window.__smdres = JSON.stringify(o); })
      .catch(function(e){ window.__smdres = JSON.stringify({ error: String(e && e.message || e) }); });`, 200);
  const raw = JSON.parse(await c.evaluate(`String(window.__smdres)`));
  const ms = Date.now() - t0;
  if (raw.error) throw new Error("ocr failed: " + raw.error);
  const boxes = raw.boxes || [];
  console.log(`\nRAW APPLE VISION OBSERVATIONS (${boxes.length} boxes, ${ms} ms, on-device)`);
  console.log("text".padEnd(28), "conf ", "x     y     w     h       hpx");
  for (const b of [...boxes].sort((a, b2) => a.y - b2.y)) {
    const conf = b.conf == null ? "  -  " : Number(b.conf).toFixed(2).padEnd(5);
    console.log(JSON.stringify(b.text).padEnd(28), conf, b.x.toFixed(3), b.y.toFixed(3), b.w.toFixed(3), b.h.toFixed(4), (b.h * H).toFixed(1));
  }
  const netUrls = JSON.parse(await c.evaluate(`JSON.stringify(window.__smdNet.splice(0))`));
  const aiCalls = netUrls.filter((x) => /\/api\/ai|vision|generativelanguage|aiplatform|gemini/i.test(x));
  const net = netUrls.length;
  console.log(`\nnetwork calls during OCR window: ${net}` + (net ? "  " + JSON.stringify(netUrls) : ""));
  console.log(`AI / vision endpoint calls during OCR: ${aiCalls.length}  (must be 0)`);

  const text = raw.text || (raw.lines || []).join("\n");
  const mine = JSON.parse(await c.evaluate(`JSON.stringify(window.__smdParse(${JSON.stringify(text)}, ${JSON.stringify(kind)}, ${JSON.stringify(boxes)}))`));
  const shipped = JSON.parse(await c.evaluate(`JSON.stringify(window.SMD_parseFields ? window.SMD_parseFields(${JSON.stringify(text)}, ${JSON.stringify(kind)}, ${JSON.stringify(boxes)}) : null)`));
  console.log("\nPARSER OUTPUT (this checkout, box-aware):", JSON.stringify(mine));
  console.log("PARSER OUTPUT (installed bundle):        ", JSON.stringify(shipped));
  const got = kind === "all" ? (mine.vitals || {}) : mine;
  console.log("\nvs ground truth:");
  let ok = 0, n = 0;
  for (const k of Object.keys(GROUND)) { n++; const pass = got[k] === GROUND[k]; ok += pass ? 1 : 0; console.log(`  ${k.padEnd(5)} expected ${String(GROUND[k]).padEnd(4)} got ${String(got[k]).padEnd(9)} ${pass ? "OK" : "MISS"}`); }
  console.log(`\n${ok}/${n} correct; network calls: ${net}`);
} finally { c.close(); }
