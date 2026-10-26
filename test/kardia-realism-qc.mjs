/* test/kardia-realism-qc.mjs - Kardia realism QC (K3).
 *
 * Drives the real app headless and opens the Scan Lab, then for every
 * one of the 15 views captures the monitor at target, at a small pose
 * error and at a large pose error. Captures land in
 * work/review/k3-<view>-<pose>.png.
 *
 * Transport: CDP over --remote-debugging-pipe (no debug port and no
 * local HTTP server needed; both are refused in sandboxed CI). The app
 * is served by answering http://kardia-qc.local/ requests from the
 * repository on disk through Fetch interception, with HTTP range
 * support so the bundled mp4 clips stream exactly as they would over
 * HTTP. Everything else (clip hosting fallbacks, asset CDN) goes to
 * the real network untouched.
 *
 * A capture fails when it is mostly flat (low local variance), mostly
 * black, or matches the old ring-and-blob shape (bright thin ring
 * around a dark blob, measured by the ring score). The image metrics
 * here mirror KARDIA_SCANLAB._pure.imageMetrics so the QC and the unit
 * tests agree on what a cartoon is.
 *
 * USAGE: node test/kardia-realism-qc.mjs
 *   CHROME=/path/to/chrome       override the Chrome binary
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import zlib from "node:zlib";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const ORIGIN = "https://kardia-qc.local";
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/kardia-realism-chrome-pipe";
const OUT = join(HERE, "..", "work", "review");
mkdirSync(OUT, { recursive: true });

function chromeBinary() {
  if (process.env.CHROME) return process.env.CHROME;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    join(homedir(), ".cache/kardia-chrome/chrome-headless-shell/mac_arm-156.0.8078.47/chrome-headless-shell-mac-arm64"),
    "/tmp/chs/chrome-headless-shell",
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[0];
}
const CHROME = chromeBinary();
const isShell = /headless-shell/.test(CHROME);
try { rmSync(userDir, { recursive: true, force: true }); } catch {}
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean),
  ...(isShell ? [] : ["--headless=new"]),
  "--no-sandbox", "--single-process", "--remote-debugging-pipe", `--user-data-dir=${userDir}`,
  "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--mute-audio",
  "--autoplay-policy=no-user-gesture-required"],
  { stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"] });
let chromeErr = "";
chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let sessionId = null;
let pipeBuf = Buffer.alloc(0);
chrome.stdio[4].on("data", (d) => {
  pipeBuf = Buffer.concat([pipeBuf, d]);
  let i;
  while ((i = pipeBuf.indexOf(0)) >= 0) {
    const raw = pipeBuf.slice(0, i).toString(); pipeBuf = pipeBuf.slice(i + 1);
    if (!raw.trim()) continue;
    let msg; try { msg = JSON.parse(raw); } catch { continue; }
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method === "Fetch.requestPaused") { void fulfill(msg.params); }
  }
});
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); chrome.stdio[3].write(JSON.stringify({ id: i, method: m, params: p || {}, ...(sessionId ? { sessionId } : {}) }) + "\0"); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(250); } return false; };

/* ---- static file fulfilment (the serve.mjs mapping, over CDP) ---- */
const TYPES = { ".gz": "application/gzip", ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".json": "application/json", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".mp4": "video/mp4", ".bin": "application/octet-stream", ".glb": "model/gltf-binary" };
async function fulfill(params) {
  const reqId = params.requestId;
  try {
    const url = new URL(params.request.url);
    let p = decodeURIComponent(url.pathname);
    if (p === "/") p = "/index.html";
    if (p.startsWith("/api/")) {
      await call("Fetch.fulfillRequest", { requestId: reqId, responseCode: 502, responseHeaders: [{ name: "content-type", value: "application/json" }, { name: "access-control-allow-origin", value: "*" }], body: Buffer.from(JSON.stringify({ ok: false, error: "proxy_error" })).toString("base64") });
      return;
    }
    let fp = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ""));
    if (!existsSync(fp) && extname(p) && existsSync(join(ROOT, "data", p.replace(/^\//, "")))) fp = join(ROOT, "data", p.replace(/^\//, ""));
    if (!existsSync(fp)) {
      await call("Fetch.fulfillRequest", { requestId: reqId, responseCode: 404, responseHeaders: [{ name: "content-type", value: "text/plain" }, { name: "access-control-allow-origin", value: "*" }], body: Buffer.from("not found: " + p).toString("base64") });
      return;
    }
    const buf = readFileSync(fp);
    const headers = params.request.headers || {};
    const rangeKey = Object.keys(headers).find((k) => k.toLowerCase() === "range");
    const type = TYPES[extname(fp).toLowerCase()] || "application/octet-stream";
    if (rangeKey) {
      const m = /bytes=(\d*)-(\d*)/.exec(headers[rangeKey] || "");
      if (m) {
        const start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], buf.length - 1) : buf.length - 1;
        const slice = buf.slice(start, end + 1);
        await call("Fetch.fulfillRequest", { requestId: reqId, responseCode: 206, responseHeaders: [
          { name: "content-type", value: type }, { name: "content-length", value: String(slice.length) },
          { name: "content-range", value: `bytes ${start}-${end}/${buf.length}` }, { name: "accept-ranges", value: "bytes" }, { name: "access-control-allow-origin", value: "*" }], body: slice.toString("base64") });
        return;
      }
    }
    await call("Fetch.fulfillRequest", { requestId: reqId, responseCode: 200, responseHeaders: [
      { name: "content-type", value: type }, { name: "content-length", value: String(buf.length) }, { name: "accept-ranges", value: "bytes" }, { name: "access-control-allow-origin", value: "*" }], body: buf.toString("base64") });
  } catch (e) {
    try { await call("Fetch.continueRequest", { requestId: reqId }); } catch {}
  }
}

let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

/* Minimal PNG decoder (8-bit RGB/RGBA, no interlace), as in run-kardia-ui.mjs. */
function decodePng(buf) {
  let off = 8, w = 0, h = 0, colour = 6; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString("ascii", off + 4, off + 8), data = buf.slice(off + 8, off + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colour = data[9]; }
    if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const ch = colour === 2 ? 3 : colour === 0 ? 1 : 4, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch;
  const out = Buffer.alloc(w * h * ch); let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++], row = raw.slice(p, p + stride); p += stride;
    const cur = out.slice(y * stride, (y + 1) * stride), prev = y ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = row[i];
      if (f === 1) v = (v + a) & 255; else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
      cur[i] = v;
    }
  }
  return { w, h, ch, data: out };
}
/* Minimal PNG encoder (filter 0 rows) for cropping a full page
 * screenshot down to the monitor when a clipped capture is refused. */
const CRC_TABLE = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function pngChunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "ascii"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function cropPng(img, x0, y0, cw, chh) {
  const { w, h, ch, data } = img;
  x0 = Math.max(0, Math.min(w - 1, Math.round(x0))); y0 = Math.max(0, Math.min(h - 1, Math.round(y0)));
  cw = Math.max(1, Math.min(w - x0, Math.round(cw))); chh = Math.max(1, Math.min(h - y0, Math.round(chh)));
  const raw = Buffer.alloc(chh * (1 + cw * 4));
  for (let y = 0; y < chh; y++) {
    const rowOff = y * (1 + cw * 4); raw[rowOff] = 0;
    for (let x = 0; x < cw; x++) {
      const si = ((y0 + y) * w + (x0 + x)) * ch, di = rowOff + 1 + x * 4;
      if (ch === 1) { raw[di] = raw[di + 1] = raw[di + 2] = data[si]; raw[di + 3] = 255; }
      else { raw[di] = data[si]; raw[di + 1] = data[si + 1]; raw[di + 2] = data[si + 2]; raw[di + 3] = ch === 4 ? data[si + 3] : 255; }
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(cw, 0); ihdr.writeUInt32BE(chh, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), pngChunk("IDAT", zlib.deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

/* Mirror of KARDIA_SCANLAB._pure.imageMetrics on decoded pixels,
 * judged inside the sector wedge only: the black scanner surround
 * around the fan is not image content, so flatness and blackness are
 * measured where the echo actually is. Sector geometry matches the
 * KARDIA_US display layout (apex top centre, half angle 40 degrees). */
function sectorGeom(w, h) {
  const sectorH = Math.round(h * 0.87);
  return { sectorH, apexX: w / 2, apexY: Math.round(sectorH * 0.02) + 4, radius: sectorH - (Math.round(sectorH * 0.02) + 4), half: 40 * Math.PI / 180 };
}
function lumArray(img) {
  const { w, h, ch, data } = img, n = w * h, lum = new Float32Array(n);
  for (let i = 0; i < n; i++) { const o = i * ch; lum[i] = ch === 1 ? data[o] : (data[o] + data[o + 1] + data[o + 2]) / 3; }
  return lum;
}
/* Outermost lit radius per beam angle, normalised by sector radius.
 * The sector outline is where the image ends, so two captures of the
 * same fixed fan must agree on this profile whatever the content. */
function outerRadii(img) {
  const { w, h } = img, lum = lumArray(img), g = sectorGeom(w, h), out = [];
  for (let aDeg = -38; aDeg <= 38; aDeg += 2) {
    const a = aDeg * Math.PI / 180; let found = 0;
    for (let r = g.radius; r > 4; r -= 2) {
      const x = Math.round(g.apexX + Math.sin(a) * r), y = Math.round(g.apexY + Math.cos(a) * r);
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      if (lum[y * w + x] > 24) { found = r / g.radius; break; }
    }
    out.push(found);
  }
  return out;
}
function outlineDiff(imgA, imgB) {
  const a = outerRadii(imgA), b = outerRadii(imgB), diffs = [];
  for (let i = 0; i < a.length; i++) if (a[i] > 0 && b[i] > 0) diffs.push(Math.abs(a[i] - b[i]));
  if (!diffs.length) return { median: 1, wideFrac: 1, n: 0 };
  const sorted = [...diffs].sort((x, y) => x - y);
  return { median: sorted[Math.floor(sorted.length / 2)], wideFrac: diffs.filter((d) => d > 0.09).length / diffs.length, n: diffs.length };
}
function imageMetrics(img) {
  const { w, h, ch, data } = img, n = w * h, lum = new Float32Array(n);
  const { apexX, apexY, radius, half } = sectorGeom(w, h);
  const inSector = (x, y) => { const dx = x - apexX, dy = y - apexY, r = Math.hypot(dx, dy); return dy >= -2 && r <= radius + 4 && Math.abs(Math.atan2(dx, Math.max(dy, 0.001))) <= half + 0.02; };
  let sum = 0;
  for (let i = 0; i < n; i++) { const o = i * ch; lum[i] = ch === 1 ? data[o] : (data[o] + data[o + 1] + data[o + 2]) / 3; sum += lum[i]; }
  let black = 0, blackN = 0, varSum = 0, cnt = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (!inSector(x, y)) continue; blackN++; if (lum[y * w + x] < 12) black++; }
  for (let y = 2; y < h - 2; y += 3) for (let x = 2; x < w - 2; x += 3) {
    if (!inSector(x, y)) continue;
    const c = lum[y * w + x];
    varSum += (Math.abs(c - lum[y * w + x + 2]) + Math.abs(c - lum[(y + 2) * w + x])) / 2; cnt++;
  }
  const cx = w / 2, cy = h * 0.52, R = Math.min(w, h) * 0.30;
  let ring = 0, ringN = 0, inside = 0, insideN = 0;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    const rr = Math.hypot(x - cx, y - cy);
    if (Math.abs(rr - R) < 5) { ring += lum[y * w + x]; ringN++; }
    else if (rr < R - 12) { inside += lum[y * w + x]; insideN++; }
  }
  /* Flat region: 10 px blocks inside the sector whose luminance
   * range is at most 7 count as uniform (no speckle). Real echo,
   * shadow and dropout all keep grain, so flat blocks stay rare. */
  let flatPx = 0, sectorPx = 0;
  const BS = 10;
  for (let by = 0; by < h; by += BS) for (let bx = 0; bx < w; bx += BS) {
    let mn = 255, mx = 0, c2 = 0;
    for (let y = by; y < Math.min(h, by + BS); y++) for (let x = bx; x < Math.min(w, bx + BS); x++) {
      if (!inSector(x, y)) continue;
      const v = lum[y * w + x]; if (v < mn) mn = v; if (v > mx) mx = v; c2++;
    }
    sectorPx += c2;
    if (c2 >= 20 && mx - mn <= 7) flatPx += c2;
  }
  return { localVariance: cnt ? varSum / cnt : 0, mean: sum / n, blackFrac: blackN ? black / blackN : 1,
    flatFrac: sectorPx ? flatPx / sectorPx : 1,
    ringScore: ringN && insideN ? ((ring / ringN) - (inside / insideN)) / 255 : 0 };
}

const POSES = [
  ["target", {}],
  ["small", { rotationDeg: 12, fanDeg: 8, rockDeg: 5, slideDxMm: 8, slideDzMm: 6 }],
  ["large", { rotationDeg: 55, fanDeg: 30, rockDeg: 20, slideDxMm: 45, slideDzMm: 35, depthCm: 4 }]
];
const captures = [];
const byView = {};

try {
  await sleep(1200);
  if (chrome.exitCode !== null) throw new Error("Chrome exited early (" + chrome.exitCode + "): " + chromeErr.slice(-500));
  const created = await call("Target.createTarget", { url: "about:blank" });
  if (!created.result) throw new Error("Target.createTarget failed: " + JSON.stringify(created).slice(0, 300) + chromeErr.slice(-300));
  const attached = await call("Target.attachToTarget", { targetId: created.result.targetId, flatten: true });
  sessionId = attached.result.sessionId;
  await call("Fetch.enable", { patterns: [{ urlPattern: "*kardia-qc.local/*", requestStage: "Request" }] });
  await call("Page.enable"); await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call("Page.navigate", { url: ORIGIN + "/" });
  await until(`return !!(window.KARDIA && window.SMD_showHome);`, 30000);
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); try{localStorage.setItem("smd_kardia","1"); SMD_showHome();}catch(e){} return 1;`);
  await sleep(500);
  ok(await until(`return !!(window.KARDIA && KARDIA.open());`, 30000), "Kardia opens");
  await ev(`var t=document.querySelector('#smdKardia [data-act=ktab][data-t=echo]'); if(t) t.click(); return 1;`);
  ok(await until(`return !!document.getElementById('kslMonitor') && !!(window.KARDIA_SCANLAB && KARDIA_SCANLAB.getLast());`, 30000), "Scan Lab opens");
  ok(await until(`return KARDIA_SCANLAB.getLast().getDebug().loadingState==='ready';`, 60000), "Scan Lab body assets load");
  ok(await until(`return !!(window.KARDIA_CLIPS && KARDIA_CLIPS.credits);`, 30000), "real clip catalogue loads");

  const views = JSON.parse((await ev(`return JSON.stringify(KARDIA_SCAN_TARGETS.VIEWS.map(function(v){return v.id;}));`)) || "[]");
  ok(views.length === 15, `15 views (${views.length})`);

  for (const id of views) {
    for (const [poseName, offsets] of POSES) {
      await ev(`return JSON.stringify(KARDIA_SCANLAB.debugSetPose("${id}", ${JSON.stringify(offsets)}));`);
      if (poseName === "target") {
        await until(`return (function(){var v=document.getElementById('kslReal'); return !!v && !v.hidden && v.readyState>=2;})();`, 20000);
      } else {
        await until(`return KARDIA_SCANLAB.getLast().getDebug().degradedActive===true;`, 20000);
      }
      await sleep(450);
      const rect = JSON.parse((await ev(`return JSON.stringify((function(){var e=document.getElementById('kslMonitorWrap')||document.getElementById('kslMonitor'); var b=e.getBoundingClientRect(); return {x:b.left,y:b.top,width:b.width,height:b.height};})());`)) || "null");
      if (!rect || !rect.width) { ok(false, `${id}/${poseName}: monitor rect`); continue; }
      await ev(`var e=document.getElementById('kslMonitorWrap'); if(e && e.scrollIntoView) e.scrollIntoView({block:'center'}); return 1;`);
      await sleep(200);
      const rect2 = JSON.parse((await ev(`return JSON.stringify((function(){var e=document.getElementById('kslMonitorWrap')||document.getElementById('kslMonitor'); var b=e.getBoundingClientRect(); return {x:b.left,y:b.top,width:b.width,height:b.height};})());`)) || "null");
      const shot = await Promise.race([
        call("Page.captureScreenshot", { format: "png", clip: { x: rect2.x, y: rect2.y, width: rect2.width, height: rect2.height, scale: 1 }, captureBeyondViewport: true }),
        sleep(25000).then(() => null)
      ]);
      const file = `k3-${id}-${poseName}.png`;
      let buf = shot && shot.result && shot.result.data ? Buffer.from(shot.result.data, "base64") : null;
      if (!buf) {
        const full = await Promise.race([call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }), sleep(25000).then(() => null)]);
        if (!full || !full.result || !full.result.data) { ok(false, `${id}/${poseName}: screenshot timed out`); continue; }
        const pageImg = decodePng(Buffer.from(full.result.data, "base64"));
        const sy = await ev(`return window.scrollY || 0;`);
        buf = cropPng(pageImg, rect2.x, rect2.y + (sy || 0), rect2.width, rect2.height);
      }
      writeFileSync(join(OUT, file), buf);
      captures.push(file);
      const decoded = decodePng(buf);
      byView[id] = byView[id] || {}; byView[id][poseName] = decoded;
      const m = imageMetrics(decoded);
      const flat = m.localVariance < 1.5, dark = m.blackFrac > 0.92, ring = m.ringScore > 0.45;
      /* Flat slab check applies to the degraded renders: a real
       * clip at target may legitimately hold dark, quiet anatomy,
       * but degradation must never paint uniform grey. */
      const slab = poseName !== "target" && m.flatFrac > 0.15;
      ok(!flat && !dark && !ring && !slab,
        `${id}/${poseName}: localVariance=${m.localVariance.toFixed(2)} blackFrac=${m.blackFrac.toFixed(3)} ringScore=${m.ringScore.toFixed(3)} flatFrac=${m.flatFrac.toFixed(3)} mean=${m.mean.toFixed(1)} -> ${file}`);
    }
    /* The sector is fixed hardware geometry: its outline (apex,
     * angle, depth) must not change with pose error. Only the
     * content inside the fan may move. Small and large error go
     * through the same fixed fan, so their outlines must match
     * closely; against target, the comparison uses the beam angles
     * where the target clip itself reaches the far arc (clip
     * framing crops some views before the arc). */
    if (byView[id] && byView[id].small && byView[id].large) {
      const d = outlineDiff(byView[id].small, byView[id].large);
      ok(d.median <= 0.03 && d.wideFrac <= 0.15,
        `${id}: sector outline small vs large medianDiff=${d.median.toFixed(3)} wideFrac=${d.wideFrac.toFixed(2)} (n=${d.n})`);
    }
    if (byView[id] && byView[id].target) {
      const tR = outerRadii(byView[id].target);
      for (const poseName of ["small", "large"]) {
        if (!byView[id][poseName]) continue;
        const pR = outerRadii(byView[id][poseName]), diffs = [];
        for (let i = 0; i < tR.length; i++) if (tR[i] >= 0.9 && pR[i] > 0) diffs.push(Math.abs(tR[i] - pR[i]));
        if (diffs.length < 6) { ok(true, `${id}/${poseName}: sector outline vs target (target clip cropped before far arc on ${tR.length - diffs.length} of ${tR.length} beams, skipped)`); continue; }
        const sorted = [...diffs].sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
        ok(med <= 0.08, `${id}/${poseName}: sector outline vs target medianDiff=${med.toFixed(3)} on far arc beams (n=${diffs.length})`);
      }
    }
  }

  /* Crossfade: midway between PLAX and RV outflow the image is shared
   * between the two views, and the pose error there degrades it. */
  const blendInfo = JSON.parse((await ev(`return JSON.stringify((function(){try{
    var T=window.KARDIA_SCAN_TARGETS, a=T.byId("plax"), b=T.byId("rv_outflow");
    KARDIA_SCANLAB.debugSetPose("plax", { rotationDeg:(b.rotationDeg-a.rotationDeg)/2, fanDeg:(b.fanDeg-a.fanDeg)/2, rockDeg:(b.rockDeg-a.rockDeg)/2, slideDxMm:(b.contact[0]-a.contact[0])/2, slideDzMm:(b.contact[2]-a.contact[2])/2 });
    var d=KARDIA_SCANLAB.getLast().debugDegradation();
    return { blend: d.blend.map(function(x){return {id:x.id, weight:Math.round(x.weight*100)/100};}), quality: Math.round(d.degradation.quality*100)/100, active: d.active };
  }catch(e){ return { error: String(e) }; }})());`)) || "null");
  ok(!!blendInfo && Array.isArray(blendInfo.blend) && blendInfo.blend.length === 2 && blendInfo.blend[1].weight > 0.1,
    `crossfade midway PLAX to RV outflow (${JSON.stringify(blendInfo)})`);

  /* Playback responsiveness: over about a second the monitor frame
   * changes (the clip is playing, not a still) and the render loop
   * reports a live frame rate. */
  await ev(`return JSON.stringify(KARDIA_SCANLAB.debugSetPose("plax", ${JSON.stringify(POSES[1][1])}));`);
  await until(`return KARDIA_SCANLAB.getLast().getDebug().degradedActive===true;`, 20000);
  const frameProbe = async () => JSON.parse((await ev(`return JSON.stringify((function(){var c=document.getElementById('kslDegraded'); var v=document.getElementById('kslReal');
    var sum=-1; try{ var t=document.createElement('canvas'); t.width=32; t.height=24; var x=t.getContext('2d'); x.drawImage(c,0,0,32,24); var d=x.getImageData(0,0,32,24).data; sum=0; for(var i=0;i<d.length;i+=4) sum+=d[i]; }catch(e){}
    return { sum: sum, vt: v ? v.currentTime : -1, fps: KARDIA_SCANLAB.getLast().getDebug().fps };})());`)) || "null");
  const fp1 = await frameProbe(); await sleep(1100); const fp2 = await frameProbe();
  ok(!!fp1 && !!fp2 && (fp2.sum !== fp1.sum || fp2.vt > fp1.vt) && fp2.fps > 0,
    `playback moves and the loop is live (frame sum ${fp1 && fp1.sum} -> ${fp2 && fp2.sum}, video time ${fp1 && fp1.vt} -> ${fp2 && fp2.vt}, fps ${fp2 && fp2.fps})`);

  /* Coaching line at 390 px: fully visible, wraps to at most two lines. */
  await ev(`return JSON.stringify(KARDIA_SCANLAB.debugSetPose("rv_outflow", ${JSON.stringify(POSES[2][1])}));`);
  await sleep(300);
  const coach = JSON.parse((await ev(`return JSON.stringify((function(){var e=document.getElementById('kslCoach'); if(!e) return null; var cs=getComputedStyle(e); var lh=parseFloat(cs.lineHeight)||23; return {text:e.textContent, h:e.getBoundingClientRect().height, lh:lh, sw:e.scrollWidth, cw:e.clientWidth, overflow:cs.overflow, ws:cs.whiteSpace};})());`)) || "null");
  ok(!!coach && coach.sw <= coach.cw + 1 && coach.h <= coach.lh * 2.6,
    `coaching wraps at 390px (${coach ? JSON.stringify(coach).slice(0, 220) : "missing"})`);
} catch (e) {
  ok(false, "QC run completed: " + String(e && e.message || e));
} finally {
  console.log("\nCaptures (" + captures.length + "):");
  for (const c of captures) console.log("  work/review/" + c);
  try { chrome.kill("SIGKILL"); } catch {}
}
console.log(fails ? `\n${fails} FAILURES` : "\nALL REALISM CHECKS PASSED");
process.exit(fails ? 1 : 0);
