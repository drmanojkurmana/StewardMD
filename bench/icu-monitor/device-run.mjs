/* bench/icu-monitor/device-run.mjs — the ICU monitor benchmark's OCR passes, run ON THE iPHONE.
 *
 *   node bench/icu-monitor/device-run.mjs [--only <substr>] [--dir fixtures/owner] [wsUrl]
 *
 * For every <name>.jpg under --dir (scored later by <name>.json), the JPEG is pushed into the StewardMD WebView as a
 * data URL and the app's readImageLocal pipeline (reasoning.js, "Two-scale (2026-09-14)") runs in-page:
 * full-image Vision -> monitorRegion -> canvas crop of the ORIGINAL at region.scale -> Vision ->
 * mapCropObservations + mergeObservations -> confirmationRegion -> crop -> Vision -> applyConfirmation.
 * All three reads go through window.SMD_NATIVE.ocr(url, {languageCorrection:false}) (Apple Vision,
 * on-device). The parser is THIS checkout's icu-monitor-parser.js, injected under a private global.
 *
 * Output: run.mjs cache files next to each case (<case>.obs.json, .crop.json, .confirm.cache.json,
 * engine "ios-device", level "accurate"), so `node bench/icu-monitor/run.mjs` scores the phone's reads
 * without re-running Mac Vision; plus --summary (default out-owner-device/device-run.json): network
 * tripwire, timings, box counts.
 *
 * One deliberate difference, flagged per case as confirmBenchOnly: when monitorRegion returns null the
 * app skips the confirmation read, but run.mjs still does one (`creg && (crop || !region)`). That read is
 * made on the phone too, so the scorer never falls back to Mac Vision; the app result is unaffected.
 *
 * Setup: see test/ios-webkit-cdp.mjs (USB, unlocked, proxy on :9222, relaunch the app first). */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { connect } from "../../test/ios-webkit-cdp.mjs";

const HERE = dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DIR = join(HERE, opt("--dir", "fixtures/owner"));
const ONLY = opt("--only", null);
const wsArg = args.find((a) => a.startsWith("ws://"));
const PARSER_SRC = readFileSync(join(HERE, "..", "..", "icu-monitor-parser.js"), "utf8");
const M = createRequire(import.meta.url)(join(HERE, "..", "..", "icu-monitor-parser.js"));
const keyOf = (r) => [r.x, r.y, r.w, r.h, r.scale].map((v) => (+v).toFixed(4)).join(",");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  if (wsArg) return wsArg;
  const pages = await (await fetch("http://localhost:9222/json")).json();
  const page = pages.find((p) => /stewardmd|localhost|capacitor/i.test(p.url || "")) || pages[0];
  if (!page) throw new Error("no WebView page at :9222 (relaunch the app, unlock the phone)");
  return page.webSocketDebuggerUrl;
}

const SUMMARY = opt("--summary", join(HERE, "out-owner-device", "device-run.json"));
const cases = readdirSync(DIR).filter((f) => f.endsWith(".jpg")).map((f) => join(DIR, f.replace(/\.jpg$/, ".json"))).filter((p) => !ONLY || p.includes(ONLY)).sort();
if (!cases.length) { console.error("no .jpg under " + DIR); process.exit(2); }

const c = connect(await wsUrl(), { timeoutMs: 60000 });
const summary = { generated: new Date().toISOString(), parser: M.VERSION, device: null, idleControl: null, cases: [] };
try {
  if (!(await c.evaluate(`!!(window.SMD_NATIVE && window.SMD_NATIVE.ocr)`))) throw new Error("SMD_NATIVE.ocr missing");
  summary.device = await c.evaluate(`navigator.userAgent`);
  // tripwire + private parser + the app's two canvas helpers (copied from reasoning.js smdPixelSource /
  // smdCropDataUrl, unchanged apart from names)
  const inj = await c.evaluate(`(function(){
    window.__smdNet = [];
    function u(a){ try { return String(a && a.url ? a.url : a); } catch (e) { return "?"; } }
    if (!window.__smdNetWrapped) { window.__smdNetWrapped = 1;
      var of = window.fetch; window.fetch = function(){ window.__smdNet.push(u(arguments[0])); return of.apply(this, arguments); };
      var oo = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(m, url){ window.__smdNet.push(String(url)); return oo.apply(this, arguments); };
      if (navigator.sendBeacon) { var ob = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = function(url){ window.__smdNet.push(String(url)); return ob.apply(null, arguments); }; }
      var OW = window.WebSocket; if (OW) window.WebSocket = function(url, p){ window.__smdNet.push(String(url)); return p === undefined ? new OW(url) : new OW(url, p); };
    }
    window.__smdV2 = (function(){ var module = { exports: {} }; ${PARSER_SRC.replace(/\bself\b/g, "undefined")}; return module.exports; })();
    window.__benchPx = function (dataUrl) { return new Promise(function (res) { try { var img = new Image(); img.onload = function () { try { var MAX = 2400, s = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight)); var w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s)); var cv = document.createElement("canvas"); cv.width = w; cv.height = h; var ctx = cv.getContext("2d", { willReadFrequently: true }); ctx.drawImage(img, 0, 0, w, h); var d = ctx.getImageData(0, 0, w, h).data; res({ w: w, h: h, natW: img.naturalWidth, natH: img.naturalHeight, get: function (x, y) { if (x < 0 || y < 0 || x >= w || y >= h) return null; var i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; } }); } catch (e) { res(null); } }; img.onerror = function () { res(null); }; img.src = dataUrl; } catch (e) { res(null); } }); };
    window.__benchCrop = function (dataUrl, region) { return new Promise(function (res) { try { var img = new Image(); img.onload = function () { try { var sx = region.x * img.naturalWidth, sy = region.y * img.naturalHeight, sw = region.w * img.naturalWidth, sh = region.h * img.naturalHeight; var ow = Math.max(1, Math.round(sw * region.scale)), oh = Math.max(1, Math.round(sh * region.scale)); var cv = document.createElement("canvas"); cv.width = ow; cv.height = oh; var ctx = cv.getContext("2d"); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.drawImage(img, sx, sy, sw, sh, 0, 0, ow, oh); res({ url: cv.toDataURL("image/jpeg", 0.92), w: ow, h: oh }); } catch (e) { res(null); } }; img.onerror = function () { res(null); }; img.src = dataUrl; } catch (e) { res(null); } }); };
    return window.__smdV2.VERSION; })()`);
  if (inj !== M.VERSION) throw new Error("parser injection failed: " + inj);
  await sleep(8000);
  const idle = JSON.parse(await c.evaluate(`JSON.stringify(window.__smdNet.splice(0))`));
  summary.idleControl = { seconds: 8, calls: idle.length, urls: idle.map((x) => x.replace(/\?.*/, "")) };
  console.log(`idle control 8 s: ${idle.length} network call(s)`);

  for (const casePath of cases) {
    const name = casePath.slice(DIR.length + 1).replace(/\.json$/, "");
    const gt = { id: "owner-" + name };
    const img = casePath.replace(/\.json$/, ".jpg");
    const b64 = readFileSync(img).toString("base64");
    const CH = 400000;
    await c.evaluate(`window.__imgParts = []; window.__imgUrl = null; 1`);
    for (let i = 0; i < b64.length; i += CH) {
      const r = await c.evaluate(`window.__imgParts.push(${JSON.stringify(b64.slice(i, i + CH))})`);
      if (typeof r !== "number") throw new Error("chunk push failed: " + r);
    }
    const len = await c.evaluate(`(window.__imgUrl = "data:image/jpeg;base64," + window.__imgParts.join(""), window.__imgParts = null, window.__imgUrl.length)`);
    if (len !== b64.length + 23) throw new Error(`image transfer mismatch for ${gt.id}: ${len} vs ${b64.length + 23}`);

    // the pipeline, in page. Returns JSON with the three raw reads + regions + an app-path parse summary.
    const raw = await c.evaluateAsync(`
      var V2 = window.__smdV2, url = window.__imgUrl, T = {}, t0 = Date.now(); window.__smdNet.splice(0);
      function ocr(u) { var t = Date.now(); return window.SMD_NATIVE.ocr(u, { languageCorrection: false }).then(function (o) { return { ms: Date.now() - t, boxes: (o && o.boxes) || [], keys: o ? Object.keys(o) : [] }; }); }
      var out = { full: null, crop: null, confirm: null };
      ocr(url).then(function (f) {
        out.full = f;
        var fullObs = f.boxes.map(function (b) { return { text: b.text, conf: b.conf, x: b.x, y: b.y, w: b.w, h: b.h, q: b.q }; });
        return window.__benchPx(url).then(function (px) {
          out.natural = px ? { w: px.natW, h: px.natH } : null;
          var imageSize = out.natural, region = null; try { region = imageSize ? V2.monitorRegion(fullObs, imageSize) : null; } catch (e) { out.regionErr = String(e); }
          out.region = region;
          var second = region ? window.__benchCrop(url, region).then(function (cu) {
            if (!cu) return { obs: fullObs, crop: null };
            return ocr(cu.url).then(function (co) {
              out.crop = co; out.cropSize = { w: cu.w, h: cu.h };
              var cb = co.boxes.map(function (b) { return { text: b.text, conf: b.conf, x: b.x, y: b.y, w: b.w, h: b.h, q: b.q }; });
              return { obs: V2.mergeObservations(fullObs, V2.mapCropObservations(cb, region)), crop: { region: region } };
            }).catch(function (e) { out.cropErr = String(e && e.message || e); return { obs: fullObs, crop: { region: region, error: "crop-ocr-failed" } }; });
          }) : Promise.resolve({ obs: fullObs, crop: null });
          return second.then(function (pass) {
            var appRuns = !!(pass.crop && !pass.crop.error), creg = null;
            try { creg = (imageSize && (appRuns || !region)) ? V2.confirmationRegion(pass.obs, imageSize) : null; } catch (e) { out.cregErr = String(e); }
            out.creg = creg; out.confirmBenchOnly = !!creg && !appRuns;
            var done = function (obs, confirmed) {
              out.totalMs = Date.now() - t0;
              var appObs = out.confirmBenchOnly ? pass.obs : obs;
              var r = V2.parseMonitor(appObs, { px: px, imageSize: imageSize, twoScale: { ran: appRuns } });
              out.app = { values: r.values, status: Object.keys(r.fields).reduce(function (a, k) { a[k] = r.fields[k].status; return a; }, {}), merged: appObs.length };
              out.net = window.__smdNet.splice(0);
              window.__smdres = JSON.stringify(out);
            };
            if (!creg) return done(pass.obs);
            return window.__benchCrop(url, creg).then(function (cu) {
              if (!cu) return done(pass.obs);
              return ocr(cu.url).then(function (co) {
                out.confirm = co; out.confirmSize = { w: cu.w, h: cu.h };
                var cb = co.boxes.map(function (b) { return { text: b.text, conf: b.conf, x: b.x, y: b.y, w: b.w, h: b.h }; });
                done(V2.applyConfirmation(pass.obs, V2.mapCropObservations(cb, creg)));
              }).catch(function (e) { out.confirmErr = String(e && e.message || e); done(pass.obs); });
            });
          });
        });
      }).catch(function (e) { window.__smdres = JSON.stringify({ error: String(e && e.message || e) }); });`, 400);
    if (raw === "TIMEOUT" || !raw || raw[0] !== "{") { console.error(gt.id, "pipeline failed:", String(raw).slice(0, 200)); summary.cases.push({ id: gt.id, error: String(raw).slice(0, 200) }); continue; }
    const o = JSON.parse(raw);
    if (o.error) { console.error(gt.id, "ocr error:", o.error); summary.cases.push({ id: gt.id, error: o.error }); continue; }
    await c.evaluate(`window.__imgUrl = null; 1`);

    const box = (b, withQ) => { const r = { text: b.text, conf: b.conf == null ? null : b.conf, x: b.x, y: b.y, w: b.w, h: b.h }; if (withQ && b.q) r.q = b.q; return r; };
    const pack = (read, size, extra) => Object.assign({ engine: "ios-device", level: "accurate", correction: false, ocrMs: read.ms, image: size, n: read.boxes.length, obs: read.boxes.map((b) => box(b, true)) }, extra || {});
    const full = pack(o.full, o.natural);
    writeFileSync(casePath.replace(/\.json$/, ".obs.json"), JSON.stringify(full));
    // recompute the regions in node from the JSON-roundtripped cache exactly as run.mjs will; they must match
    const fullObs = full.obs.map((b) => ({ text: b.text, conf: b.conf, x: b.x, y: b.y, w: b.w, h: b.h, q: b.q }));
    const nodeRegion = M.monitorRegion(fullObs, full.image);
    const regionMatch = (nodeRegion ? keyOf(nodeRegion) : null) === (o.region ? keyOf(o.region) : null);
    if (o.crop) writeFileSync(casePath.replace(/\.json$/, ".crop.json"), JSON.stringify(pack(o.crop, o.cropSize, { key: keyOf(o.region), region: o.region })));
    if (o.confirm) writeFileSync(casePath.replace(/\.json$/, ".confirm.cache.json"), JSON.stringify(pack(o.confirm, o.confirmSize, { key: keyOf(o.creg), region: o.creg })));
    const row = { id: gt.id, natural: o.natural, bytes: Buffer.byteLength(b64, "base64"), totalMs: o.totalMs, ocrMs: { full: o.full.ms, crop: o.crop && o.crop.ms, confirm: o.confirm && o.confirm.ms },
      boxes: { full: o.full.boxes.length, crop: o.crop ? o.crop.boxes.length : null, confirm: o.confirm ? o.confirm.boxes.length : null, merged: o.app.merged },
      region: o.region ? keyOf(o.region) : null, confirmRegion: o.creg ? keyOf(o.creg) : null, confirmBenchOnly: o.confirmBenchOnly, regionMatchesNode: regionMatch,
      pluginFields: o.full.keys, boxHasConf: o.full.boxes.some((b) => b.conf != null), boxHasQ: o.full.boxes.some((b) => !!b.q), errors: [o.regionErr, o.cropErr, o.cregErr, o.confirmErr].filter(Boolean),
      networkCalls: o.net.length, networkUrls: o.net.map((x) => x.replace(/\?.*/, "")), app: o.app };
    summary.cases.push(row);
    console.log(`${gt.id.padEnd(34)} ${o.natural.w}x${o.natural.h} total ${o.totalMs} ms (full ${row.ocrMs.full}/crop ${row.ocrMs.crop ?? "-"}/conf ${row.ocrMs.confirm ?? "-"}) boxes ${row.boxes.full}/${row.boxes.crop ?? "-"}/${row.boxes.confirm ?? "-"} net ${row.networkCalls}${regionMatch ? "" : " REGION MISMATCH"}${o.confirmBenchOnly ? " confirm(bench-only)" : ""} app ${JSON.stringify(o.app.values)}`);
  }
  const after = JSON.parse(await c.evaluate(`JSON.stringify(window.__smdNet.splice(0))`));
  summary.afterRun = { calls: after.length, urls: after.map((x) => x.replace(/\?.*/, "")) };
} finally {
  c.close();
  mkdirSync(dirname(SUMMARY), { recursive: true });
  writeFileSync(SUMMARY, JSON.stringify(summary, null, 2));
}
