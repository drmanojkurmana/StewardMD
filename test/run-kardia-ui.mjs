/* Kardia in the REAL app (headless Chrome): flag OFF = the Home grid is byte-for-byte unchanged
 * (no Kardia tile, KardiQ X tile untouched, KARDIA.open() a no-op); flag ON (?kardia=1 or
 * localStorage smd_kardia = 1, no early-access tier) = the Kardia tile replaces the KardiQ X tile,
 * the tile opens the Specialty Engine host with its five tabs, Learn lists the real atlas preview,
 * and the KardiQ X tab still holds behind SMD_XACCESS without opening the AI overlay.
 * Screenshots every tab at 390 and 820 widths in light and dark into work/shots/.
 * USAGE: node test/run-kardia-ui.mjs   (BASE=http://localhost:8996/ to use a running server;
 *   SHOTS=/tmp/shots to override the output dir)
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import zlib from "node:zlib";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || 8995) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || 9399), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/kardia-app-chrome-" + PORT;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.SHOTS || join(HERE, "..", "work", "shots");
mkdirSync(SHOTS, { recursive: true });

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8995"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
try { rmSync(userDir, { recursive: true, force: true }); } catch {}
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(200); } return false; };
const reqs = []; let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

/* Minimal PNG decoder (8-bit RGB/RGBA, no interlace: what canvas
 * toDataURL produces) so the sector assertions below run on the saved
 * canvas pixels themselves, not on renderer-internal state. */
function decodePng(path) {
  const buf = readFileSync(path);
  let off = 8, w = 0, h = 0, colour = 6;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString("ascii", off + 4, off + 8), data = buf.slice(off + 8, off + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colour = data[9]; }
    if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const ch = colour === 2 ? 3 : 4, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch;
  const out = Buffer.alloc(w * h * ch);
  let p = 0;
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
/* Sector check on saved pixels. Sector geometry is the renderer's
 * (KARDIA_US layoutFor at the 640x480 live canvas, Echo Lab knobs
 * depth 160 / sector 80): apex centred at the top, beam straight
 * down, half-angle 40 degrees, radius filling the canvas height.
 * Non-black is luminance over 20 (above the CPU path's Bayer dither).
 * Returns outside non-black percent and the fan axis deviation from
 * vertical: half the difference of the median left and right edge
 * angles of the non-black region over rows at 0.35..0.95 of the
 * radius (median, so isolated fragments cannot swing the edges). */
function sectorCheck(path) {
  const { w, h, ch, data } = decodePng(path);
  const apexX = w / 2, apexY = Math.min(h - 8, Math.round(h * 0.02) + 4);
  const radius = h - apexY, half = 40 * Math.PI / 180;
  let outside = 0, outsideLit = 0;
  const leftAngles = [], rightAngles = [];
  for (let y = 0; y < h; y++) {
    let mn = Infinity, mx = -Infinity;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * ch;
      const lum = (data[o] + data[o + 1] + data[o + 2]) / 3, lit = lum > 20;
      const dx = x - apexX, dy = y - apexY, r = Math.hypot(dx, dy), ang = Math.atan2(dx, dy);
      const inside = dy >= -2 && r <= radius + 4 && Math.abs(ang) <= half + 0.02;
      if (!inside) { outside++; if (lit) outsideLit++; }
      if (lit) { if (x < mn) mn = x; if (x > mx) mx = x; }
    }
    const dy = y - apexY;
    if (mx >= 0 && dy > radius * 0.35 && dy < radius * 0.95) {
      if (mn < apexX) leftAngles.push(Math.atan2(apexX - mn, dy) * 180 / Math.PI);
      if (mx > apexX) rightAngles.push(Math.atan2(mx - apexX, dy) * 180 / Math.PI);
    }
  }
  const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const leftDeg = median(leftAngles), rightDeg = median(rightAngles);
  return { outsidePct: outside ? 100 * outsideLit / outside : 0,
    leftDeg, rightDeg, axisDeg: Math.abs(rightDeg - leftDeg) / 2 };
}

/* A4C anatomy parity with the standalone renderer (run-kardia-us-ui
 * gpu-leg bands): project the LV/RV/LA/RA cavity centroids and the
 * septum midpoint from the Echo Lab geometry cut (diag.cut at
 * KARDIA_GEOM.viewPlane('tte_a4c')) through the plane Echo Lab passed
 * to KARDIA_US (diag.usProbe) and the sector layout it computed, then
 * average the saved canvas pixels in a small disc at each point.
 * Cavities must read dark, the septum mid grey. */
function anatomyCheck(path, diag) {
  if (!diag || !diag.viewPlane || !diag.cut || !diag.usProbe || !diag.layout) return { error: "no diagnostics bundle" };
  const { w, h, ch, data } = decodePng(path);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return a.map((x) => x / l); };
  const vp = diag.viewPlane, n = norm(vp.normal), right = norm(cross(n, norm(vp.up))), up = norm(cross(right, n));
  const polys = diag.cut;
  const area = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; } return Math.abs(a / 2); };
  const largest = (ref) => { const l = polys.filter((p) => p.ref === ref); return l.length ? l.reduce((a, b) => (area(b.points) > area(a.points) ? b : a)) : null; };
  const centroid = (p) => { let a = 0, cx = 0, cy = 0; const pts = p.points; for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length, f = pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; a += f; cx += (pts[i][0] + pts[j][0]) * f; cy += (pts[i][1] + pts[j][1]) * f; } return Math.abs(a) < 1e-6 ? p.centroid : [cx / (3 * a), cy / (3 * a)]; };
  const inside = (x, y, pts) => { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins; } return ins; };
  const edgeDist = (x, y, pts) => { let m = 1e9; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], vx = b[0] - a[0], vy = b[1] - a[1], t = (vx * vx + vy * vy) > 1e-9 ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy))) : 0, dx = x - (a[0] + vx * t), dy = y - (a[1] + vy * t); m = Math.min(m, Math.hypot(dx, dy)); } return m; };
  const interior = (ref) => { const p = largest(ref); if (!p) return null; const pts = p.points; let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9; pts.forEach((q) => { mnx = Math.min(mnx, q[0]); mxx = Math.max(mxx, q[0]); mny = Math.min(mny, q[1]); mxy = Math.max(mxy, q[1]); }); let best = null, bd = -1; for (let x = mnx + 2; x < mxx - 2; x += 2) for (let y = mny + 2; y < mxy - 2; y += 2) { if (!inside(x, y, pts)) continue; const d = edgeDist(x, y, pts); if (d > bd) { bd = d; best = [x, y]; } } return best || centroid(p); };
  const lvC = largest("FJ2422") ? centroid(largest("FJ2422")) : null, rvC = largest("FJ2423") ? centroid(largest("FJ2423")) : null;
  let septumPt = null;
  if (lvC && rvC) {
    const gap = [];
    for (let t = 0.05; t < 0.95; t += 0.02) { const x = lvC[0] + (rvC[0] - lvC[0]) * t, y = lvC[1] + (rvC[1] - lvC[1]) * t; if (inside(x, y, largest("FJ2422").points) || inside(x, y, largest("FJ2423").points)) continue; gap.push([x, y]); }
    if (gap.length) septumPt = gap[Math.floor(gap.length / 2)];
  }
  /* Cavity polygons can overlap along the centroid line (no gap):
   * fall back to the septum structure's own centroid, as the
   * standalone harness does (ventricular_septum_mid). */
  if (!septumPt) { const sp = largest("ventricular_septum_mid") || largest("interventricular_septum"); if (sp) septumPt = interior(sp.ref); }
  const usP = diag.usProbe, n2 = norm(usP.normal), r2 = norm(cross(n2, norm(usP.up))), u2 = norm(cross(r2, n2)), beam = mul(u2, -1), apex = usP.origin;
  const lay = diag.layout, sectorH = lay.sectorHeight || h, depthMm = (diag.knobs && diag.knobs.depth) || 160;
  const gpu = diag.rendererMode === "webgl";
  const apexX = gpu ? w / 2 : lay.apexX, apexY = gpu ? 0.02 * sectorH : lay.apexY, scale = gpu ? sectorH / depthMm : lay.scale;
  const project = (pc) => { const world = add(vp.origin, add(mul(right, pc[0]), mul(up, pc[1]))), rel = sub(world, apex), depth = dot(rel, beam), lat = dot(rel, r2), ang = Math.atan2(lat, depth); return [apexX + Math.sin(ang) * depth * scale, apexY + Math.cos(ang) * depth * scale]; };
  const R = Math.max(3, Math.round(w * 0.01));
  const meanAt = (pt) => { if (!pt) return null; const [px, py] = project(pt); let s = 0, c = 0; for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) { if (x * x + y * y > R * R) continue; const gx = Math.round(px) + x, gy = Math.round(py) + y; if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue; const o = (gy * w + gx) * ch; s += (data[o] + data[o + 1] + data[o + 2]) / 3 / 255; c++; } return c ? s / c : null; };
  const out = { points: {}, LV: meanAt(interior("FJ2422")), RV: meanAt(interior("FJ2423")), LA: meanAt(interior("FJ2425")), RA: meanAt(interior("FJ2424")), septum: meanAt(septumPt) };
  for (const [k, ref] of [["LV", "FJ2422"], ["RV", "FJ2423"], ["LA", "FJ2425"], ["RA", "FJ2424"]]) { const pt = interior(ref); if (pt) out.points[k] = project(pt).map((v) => Math.round(v)); }
  if (septumPt) out.points.septum = project(septumPt).map((v) => Math.round(v));
  return out;
}

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Network.requestWillBeSent") reqs.push(m.params.request.url);
    if (m.method === "Runtime.exceptionThrown") { const d = JSON.stringify(m.params.exceptionDetails); if (/kardia/i.test(d)) errors.push(d.slice(0, 300)); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {});
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  const load = async (url) => { await call("Page.navigate", { url }); await until(`return !!(window.KARDIA && window.SMD_showHome);`, 30000); await ev(clean); await ev(`SMD_showHome(); return 1;`); await sleep(700); };
  const shot = async (name) => { const r = await call("Page.captureScreenshot", { format: "png" }); if (r.result && r.result.data) writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };
  /* Measure the VISIBLE canvas, not renderer-internal state: find the
   * on-screen element, prove elementFromPoint at its centre returns that
   * very canvas (nothing covers it, it is connected and non-zero), then
   * after two animation frames copy it with drawImage into a 2D canvas
   * (valid because the WebGL renderer uses preserveDrawingBuffer:true,
   * and the CPU fallback is a plain 2D canvas) and compute the mean plus
   * dark-vs-bright (blood-vs-wall) contrast from those copied pixels.
   * ev() does not await promises, so completion is stashed on window
   * and polled with until(), like the AS pathology check below. */
  const visibleStats = async (id) => {
    await ev(`window.__visDone=false; window.__vis=null; (function(){ var el=document.getElementById("${id}");
      if(!el){ window.__vis={error:"missing ${id}"}; window.__visDone=true; return 1; }
      try{ el.scrollIntoView({block:"center"}); }catch(e){}
      requestAnimationFrame(function(){ requestAnimationFrame(function(){
        try {
          var r=el.getBoundingClientRect();
          var hit=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
          var tmp=document.createElement("canvas"); tmp.width=el.width; tmp.height=el.height;
          var cx=tmp.getContext("2d"); cx.drawImage(el,0,0);
          var d=cx.getImageData(0,0,tmp.width,tmp.height).data;
          var sum=0, n=0, lit=[], nonBlack=0;
          for(var i=0;i<d.length;i+=16){ var lum=(d[i]+d[i+1]+d[i+2])/3; sum+=lum; n++; if(lum>8){ nonBlack++; lit.push(lum); } }
          lit.sort(function(a,b){return a-b;});
          var q=function(f){ if(!lit.length) return 0; var s=0,c=0,from=Math.floor(lit.length*f[0]),to=Math.max(from+1,Math.floor(lit.length*f[1])); for(var j=from;j<to&&j<lit.length;j++){s+=lit[j];c++;} return c?s/c/255:0; };
          window.__vis={ id:"${id}", connected:!!el.isConnected, width:el.width, height:el.height,
            rectW:r.width, rectH:r.height, hitIsCanvas:hit===el, hitId:hit?(hit.id||hit.tagName):null,
            mean:n?sum/n/255:0, nonBlackFrac:n?nonBlack/n:0, bloodMean:q([0,0.2]), wallMean:q([0.8,1]) };
        } catch(x){ window.__vis={error:String(x&&x.message||x)}; }
        window.__visDone=true;
      });}); return 1; })()`);
    const doneVis = await until(`return window.__visDone===true;`, 10000);
    let v = null; try { v = JSON.parse(await ev(`return JSON.stringify(window.__vis);`)); } catch {}
    if (!doneVis || !v || v.error) console.log("visibleStats(" + id + ") failed: " + JSON.stringify(v) + " debug=" + await ev(`return JSON.stringify(KARDIA._kardia.echoLab.debug ? KARDIA._kardia.echoLab.debug() : null);`));
    return v;
  };
  const visibleOk = (v, label) => !!v && !v.error && v.connected && v.width > 0 && v.height > 0 && v.rectW > 0 && v.rectH > 0 && v.hitIsCanvas && v.mean > 0.02 && v.nonBlackFrac > 0.05;
  /* On a fan or anatomy failure, one JSON line (no pretty printing):
   * canvas backing, CSS box, DPR, the sector layout Echo Lab
   * computed, the probe state, the plane passed to KARDIA_US and
   * KARDIA_GEOM.viewPlane('tte_a4c') for comparison. */
  const fetchDiag = async () => { try { const s = await ev(`return JSON.stringify(KARDIA._kardia.echoLab.diagnostics ? KARDIA._kardia.echoLab.diagnostics('tte_a4c') : null);`); return s ? JSON.parse(s) : null; } catch { return null; } };
  const printFanDiag = async (why) => {
    const o = await fetchDiag();
    if (!o) { console.log(JSON.stringify({ diag: why, error: "diagnostics unavailable" })); return; }
    console.log(JSON.stringify({ diag: why, canvasWidth: o.canvasWidth, canvasHeight: o.canvasHeight, clientWidth: o.clientWidth, clientHeight: o.clientHeight, devicePixelRatio: o.devicePixelRatio, layout: o.layout, probeState: o.probeState, plane: o.plane, usProbe: o.usProbe, viewPlane: o.viewPlane }));
  };
  const gridActs = `return [].map.call(document.querySelectorAll('.rnav-tile[data-act]'), function(x){return x.getAttribute('data-act');}).join(',');`;
  const eligibleActs = `return (window.SMD_HOME_TOOLS ? SMD_HOME_TOOLS() : []).map(function(t){return t.act;}).join(',');`;
  const metrics = async (w, h) => { await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true }); await sleep(300); };
  const theme = async (dark) => { await ev(`document.body.classList.toggle('dark', ${dark}); document.body.classList.toggle('v3-dark', ${dark}); return 1;`); await sleep(300); };

  /* ── 1. FLAG OFF: Home is byte-for-byte unchanged ── */
  console.log("\n--- flag OFF: Home unchanged ---");
  await load(BASE);
  await ev(`try{localStorage.removeItem("smd_kardia");localStorage.removeItem("smd_kardia_prefs");localStorage.removeItem("smd_home_tools");localStorage.setItem("smd_role","student");localStorage.setItem("smd_kardiox","1");}catch(e){} return 1;`);
  await load(BASE);
  const ENG = /\/(specialty(-(core|data|stage|shell|learn|bank|explore|tools|notes))?\.(js|css)|kardia\.js|kardia\.css|kardia-flags\.js|kardia\/)/;
  ok(reqs.some((u) => /kardia-loader\.js\?v=krd3/.test(u)) && !reqs.some((u) => ENG.test(u)), "app boot loads kardia-loader.js and no engine or Kardia file");
  const gridOff = await ev(gridActs);
  const eligOff = await ev(eligibleActs);
  ok(!/,kardia,/.test("," + eligOff + ","), "Kardia is ineligible with the flag off");
  ok(/,kardiox,/.test("," + eligOff + ","), "the KardiQ X tile stays eligible with the flag off");
  ok(!/,kardia,/.test("," + gridOff + ","), "no Kardia tile on the grid with the flag off");
  ok((await ev(`return KARDIA.open();`)) === false, "KARDIA.open() refuses with the flag off");
  ok((await ev(`return !!document.getElementById('smdKardia');`)) === false, "no Kardia overlay node with the flag off");
  await ev(`SMD_openRoute("kardia"); return 1;`); await sleep(400);
  ok((await ev(`return !KARDIA.isOpen();`)) === true, "stewardmd://kardia does not open with the flag off");

  /* ── 2. FLAG ON: Kardia replaces the KardiQ X tile ── */
  console.log("\n--- flag ON: tile swap ---");
  await ev(`try{localStorage.setItem("smd_kardia","1");}catch(e){} return 1;`);
  await load(BASE + "?kardia=1");
  const eligOn = await ev(eligibleActs);
  ok(/,kardia,/.test("," + eligOn + ","), "Kardia is eligible with the flag on");
  ok(!/,kardiox,/.test("," + eligOn + ","), "the KardiQ X tile is replaced while Kardia is on");
  ok(reqs.some((u) => /specialty-shell\.js\?v=krd3/.test(u)) === false, "the engine still lazy-loads: nothing fetched until the tile opens");
  // Open from All tools and pin it: the real Home tile UI, like a tester would.
  await ev(`document.querySelector('.rnav-tile[data-act=alltools]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('[data-at-open="kardia"]');`, 10000), "All tools lists Kardia (and no KardiQ X row: " + await until(`return !document.querySelector('[data-at-open="kardiox"]');`, 5000) + ")");
  await ev(`document.querySelector('[data-at-pin="kardia"]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('.rnav-tile[data-act=kardia]');`, 10000), "pinning puts the Kardia tile on the Home grid");

  /* ── 3. Open Kardia, walk the five tabs ── */
  await ev(`var t=document.querySelector('.rnav-tile[data-act=kardia]'); t.focus(); t.click(); return 1;`);
  ok(await until(`return KARDIA.isOpen() && !!document.getElementById("smdKardia");`, 10000), "tile opens the Kardia overlay");
  ok(await until(`return !!document.querySelector('#smdKardia [data-act=ktab][data-t=kardiox]');`, 20000), "first open loads the engine + Kardia and shows the five tabs");
  ok(reqs.some((u) => /specialty-shell\.js\?v=krd3/.test(u)) && reqs.some((u) => /kardia\.js\?v=krd3/.test(u)), "engine + Kardia loaded on open, at the loader token");
  ok((await ev(`return KARDIA._kardia.tabs.join(",");`)) === "echo,learn,practice,cases,kardiox", "tabs: Echo Lab, Learn, Practice, Cases, KardiQ X");
  ok((await ev(`return KARDIA._kardia.levels.join(",");`)) === "mbbs,resident,fellow,sonographer", "levels: MBBS, Resident, Fellow, Sonographer");
  ok((await ev(`return KARDIA._kardia.freeLessons;`)) === 5, "free preview is a constant (5 lessons)");
  ok(!/[–—]/.test(await ev(`return document.getElementById('smdKardia').innerText;`)), "no em or en dash on screen");
  const tabH = await ev(`return document.querySelector('#smdKardia .krd-tab').getBoundingClientRect().height;`);
  ok(tabH >= 44, `tabs are a 44px touch target (${tabH}px)`);

  // The KardiQ X gate is still armed: opening the tab must NOT open the AI overlay by itself.
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=kardiox]').click(); return 1;`);
  await sleep(400);
  ok((await ev(`return !document.getElementById('kardioxRoot') || !document.getElementById('kardioxRoot').classList.contains('kx-open');`)) === true,
    "the KardiQ X tab does not open the AI overlay on its own");

  /* Fixture cases are swapped in before the first Cases tab visit (the case index is cached once loaded). */
  await ev(`(function(){var orig=window.fetch; if(window.__kcFixture) return 1; window.__kcFixture=1; window.fetch=function(u,o){var s=String(u); if(s.indexOf("kardia/cases/")>=0){ s="/test/fixtures/kardia-cases/"+s.split("kardia/cases/")[1]; } return orig.call(window,s,o);}; return 1;})()`);
  /* ── 3b. Echo Lab: opens, probe moves by synthetic touch, A4C achieved ── */
  console.log("\n--- Echo Lab ---");
  await metrics(390, 844); await theme(false);
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=echo]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('#smdKardia #krdSector') && !!document.querySelector('#smdKardia [data-act=kecho-view][data-v=tte_a4c]');`, 20000), "Echo Lab opens with the sector and the A4C target");
  ok((await ev(`return KARDIA._kardia.freeEchoViews.join(",");`)) === "tte_plax,tte_psax_papillary,tte_a4c", "free preview views are PLAX, PSAX papillary and A4C");
  ok(await until(`return document.querySelectorAll('#smdKardia #krdHints li').length > 0;`, 10000), "quality hint text appears for the starting probe position");
  const hintText = await ev(`return document.getElementById('krdHints').innerText;`);
  ok(/slide|rotate|tilt|rock/i.test(hintText || ""), `hint names a correction ("${(hintText || "").split("\n")[0]}")`);
  const beforeTouch = await ev(`return JSON.stringify(KARDIA._kardia.echoLab.getProbeState());`);
  await ev(`(function(){var el=document.getElementById('krdChest'); var r=el.getBoundingClientRect();
    function pe(type,x,y,id){el.dispatchEvent(new PointerEvent(type,{pointerId:id,clientX:x,clientY:y,bubbles:true}));}
    pe('pointerdown',r.left+40,r.top+40,7); pe('pointermove',r.left+90,r.top+55,7); pe('pointermove',r.left+120,r.top+60,7); pe('pointerup',r.left+120,r.top+60,7); return 1;})()`);
  await sleep(300);
  const afterTouch = await ev(`return JSON.stringify(KARDIA._kardia.echoLab.getProbeState());`);
  ok(beforeTouch !== afterTouch && JSON.parse(afterTouch).position.x !== JSON.parse(beforeTouch).position.x, "the probe moves by synthetic touch on the chest map");
  await ev(`KARDIA._kardia.echoLab.setView('tte_a4c'); return 1;`);
  await sleep(300);
  await ev(`(function(){var L=KARDIA._kardia.echoLab; L.setProbeState(L.stateForView('tte_a4c')); return 1;})()`);
  ok(await until(`return document.getElementById('krdScore') && document.getElementById('krdScore').innerText === '100';`, 10000), "A4C scores 100 when the probe state is set to its target");
  ok(await until(`return !!document.getElementById('krdAchieved') && !document.getElementById('krdAchieved').hidden;`, 8000), "view achieved shows after holding A4C for a second");
  await ev(`(function(){var L=KARDIA._kardia.echoLab; var s=L.getProbeState(); s.rotationDeg+=25; L.setProbeState(s); return 1;})()`);
  ok(await until(`return /rotate/i.test(document.getElementById('krdHints').innerText);`, 8000), "rotating off target brings back a rotate hint");

  /* ── 3c. Echo Lab WP10a: live image, modes, knobs, pathology, measure ── */
  console.log("\n--- Echo Lab WP10a ---");
  await ev(`KARDIA._kardia.echoLab.setView('tte_a4c'); return 1;`);
  await sleep(1200);
  const posText = await ev(`return document.getElementById('krdTargetPos') ? document.getElementById('krdTargetPos').innerText : '';`);
  ok(posText === "Apex, fifth intercostal space at the midclavicular line. Marker Toward the left, about three o clock.", `probe position joins as "<position>. Marker <direction>." ("${posText}")`);
  /* Visible pixels only: snapshot() reads renderer-internal/CPU state
   * and passed while the on-screen canvas was black, so it is kept
   * only as a debug diagnostic, never as the pass condition. */
  const vis1 = await visibleStats("krdSector");
  if (!visibleOk(vis1)) console.log("Echo Lab debug (visible sector failed): " + JSON.stringify(vis1) + " " + await ev(`return JSON.stringify(KARDIA._kardia.echoLab.debug ? KARDIA._kardia.echoLab.debug() : null);`));
  ok(visibleOk(vis1), `live image is visible on the sector canvas the learner sees (mean ${vis1 ? vis1.mean.toFixed(3) : "none"}, hit ${vis1 ? vis1.hitId : "?"}, connected ${vis1 ? vis1.connected : "?"})`);
  /* The standalone A4C render is real-mesh: wait for Echo Lab's real
   * anatomy to settle (or fall back), then re-solve the A4C target
   * against the loaded geometry before saving the canvas, exactly
   * as the standalone harness loads first and sets the view after. */
  await until(`return ['real','fallback'].includes(KARDIA._kardia.echoLab.debug().anatomyState);`, 60000);
  await ev(`(function(){var L=KARDIA._kardia.echoLab; L.setProbeState(L.stateForView('tte_a4c')); return 1;})()`);
  await sleep(800);
  await shot("kardia-echolab-live-2d");
  /* Page screenshots do not capture this WebGL canvas headless; save its pixels directly so the image can be reviewed. */
  { const d = await ev("var c=document.getElementById('krdSector'); if(!c) return ''; var o=document.createElement('canvas'); o.width=c.width; o.height=c.height; o.getContext('2d').drawImage(c,0,0); return o.toDataURL('image/png');"); if (d) writeFileSync(join(SHOTS, "kardia-echolab-canvas-2d.png"), Buffer.from(d.split(",")[1], "base64")); }
  /* Saved-pixel sector assertions: nothing bright outside the fan,
   * and the fan axis vertical (left/right edge angles balanced). */
  {
    const p = join(SHOTS, "kardia-echolab-canvas-2d.png");
    let sc = null, scErr = "";
    try { if (existsSync(p)) sc = sectorCheck(p); } catch (e) { scErr = String(e && e.message || e); }
    if (!sc) console.log("Echo Lab debug (sector check failed): " + scErr + " " + await ev(`return JSON.stringify(KARDIA._kardia.echoLab.debug ? KARDIA._kardia.echoLab.debug() : null);`));
    ok(!!sc && sc.outsidePct <= 1, `saved canvas pixels outside the sector are black (non-black ${sc ? sc.outsidePct.toFixed(2) : "?"}% of outside pixels, at most 1%)`);
    ok(!!sc && sc.axisDeg <= 3, `saved canvas fan axis is vertical within 3 degrees (left edge ${sc ? sc.leftDeg.toFixed(1) : "?"} deg, right edge ${sc ? sc.rightDeg.toFixed(1) : "?"} deg, axis deviation ${sc ? sc.axisDeg.toFixed(2) : "?"} deg)`);
    if (!sc || sc.outsidePct > 1 || sc.axisDeg > 3) await printFanDiag("fan");
    /* Anatomy parity with the standalone A4C render: region means at
     * the projected cavity centroids (dark) and septum (mid grey),
     * same bands as run-kardia-us-ui gpu-leg. */
    let an = null, anErr = "";
    try { const dg = await fetchDiag(); if (dg && existsSync(p)) an = anatomyCheck(p, dg); } catch (e) { anErr = String(e && e.message || e); }
    if (!an || an.error) await printFanDiag("anatomy");
    const cav = an && !an.error ? [an.LV, an.RV, an.LA, an.RA] : [];
    ok(!!an && !an.error && cav.every((v) => typeof v === "number" && v <= 0.12),
      `Echo Lab A4C matches standalone: LV/RV/LA/RA cavity centroids are dark (${cav.map((v) => typeof v === "number" ? v.toFixed(3) : "?").join("/")}, at most 0.12)${anErr ? " err=" + anErr : ""}${an && an.error ? " " + an.error : ""}`);
    ok(!!an && !an.error && typeof an.septum === "number" && an.septum >= 0.25 && an.septum <= 0.65,
      `Echo Lab A4C matches standalone: septum is mid grey (${an && typeof an.septum === "number" ? an.septum.toFixed(3) : "?"}, 0.25 to 0.65)`);
    if (!!an && !an.error && !(cav.every((v) => typeof v === "number" && v <= 0.12) && typeof an.septum === "number" && an.septum >= 0.25 && an.septum <= 0.65)) await printFanDiag("anatomy");
  }
  ok(!!vis1 && vis1.bloodMean < vis1.wallMean && (vis1.wallMean - vis1.bloodMean) > 0.02, `visible blood is darker than visible walls at A4C (blood ${vis1 ? vis1.bloodMean.toFixed(3) : "?"} < wall ${vis1 ? vis1.wallMean.toFixed(3) : "?"})`);
  for (const m of ["colour", "pw", "cw", "mmode", "2d"]) {
    await ev(`document.querySelector('#smdKardia [data-act=kecho-mode][data-v=${m}]').click(); return 1;`);
    await sleep(600);
    const vis = await ev(`return document.getElementById('krdSpectrum') ? !document.getElementById('krdSpectrum').hidden : false;`);
    ok(m === "2d" || m === "colour" ? true : vis === true, `mode ${m} renders its strip or overlay`);
    const visEl = (m === "pw" || m === "cw" || m === "mmode") ? "krdSpectrum" : "krdSector";
    const vm = await visibleStats(visEl);
    if (!vm || !(vm.mean > 0.001 && vm.nonBlackFrac > 0.002 && vm.hitIsCanvas && vm.connected)) console.log(`Echo Lab debug (visible ${m} failed): ` + JSON.stringify(vm) + " " + await ev(`return JSON.stringify(KARDIA._kardia.echoLab.debug ? KARDIA._kardia.echoLab.debug() : null);`));
    ok(!!vm && vm.mean > 0.001 && vm.nonBlackFrac > 0.002 && vm.hitIsCanvas && vm.connected, `mode ${m} shows non-black pixels in its visible element ${visEl} (mean ${vm ? vm.mean.toFixed(3) : "?"}, non-black ${vm ? vm.nonBlackFrac.toFixed(3) : "?"})`);
  }
  const meanBefore = vis1 ? vis1.mean : 0;
  await ev(`(function(){var el=document.getElementById('krdGain'); if(el){el.value=95; el.dispatchEvent(new Event('input',{bubbles:true}));} KARDIA._kardia.echoLab.setKnob('gain',95); return 1;})()`);
  await sleep(800);
  const vis2 = await visibleStats("krdSector");
  const knobOk = !!vis2 && vis2.hitIsCanvas && Math.abs(vis2.mean - meanBefore) > 0.005;
  if (!knobOk) console.log("Echo Lab debug (knob failed): " + JSON.stringify(vis2) + " " + await ev(`return JSON.stringify(KARDIA._kardia.echoLab.debug ? KARDIA._kardia.echoLab.debug() : null);`));
  ok(knobOk, `a knob change changes the visible mean brightness (${meanBefore.toFixed(3)} to ${vis2 ? vis2.mean.toFixed(3) : "?"})`);
  await ev(`KARDIA._kardia.echoLab.setKnob('gain',55); return 1;`);
  /* Severe AS: CW peak must exceed 4 m/s. Uses the real pathology file.
   * ev() does not await promises (Runtime.evaluate without awaitPromise),
   * so stash completion on window and poll with until() instead of a
   * fixed sleep: under the live CPU/WebGL render loop the fetch and
   * apply can land well after 900 ms, and reading lastPeakMs early
   * returns the previous (normal) spectrum peak. */
  await ev(`window.__asDone=false; window.__asErr=""; fetch('/kardia/pathology/aortic_stenosis.json').then(function(r){return r.json();}).then(function(d){ window.__asCond=d; KARDIA._kardia.echoLab.applyPathology(d,'severe'); KARDIA._kardia.echoLab.setMode('cw'); window.__asDone=true; },function(e){ window.__asErr=String(e&&e.message||e); window.__asDone=true; }); return 1;`);
  const asApplied = await until(`return window.__asDone===true;`, 30000);
  if (!asApplied || await ev(`return window.__asErr||"";`)) console.log("Echo Lab debug (AS apply failed): err=" + await ev(`return window.__asErr||"";`) + " " + await ev(`return JSON.stringify(KARDIA._kardia.echoLab.debug ? KARDIA._kardia.echoLab.debug() : null);`));
  ok(asApplied && !(await ev(`return window.__asErr||"";`)), "severe AS pathology fetched and applied before reading the CW peak");
  const peak = await ev(`return KARDIA._kardia.echoLab.echolab ? KARDIA._kardia.echoLab.echolab.lastPeakMs : 0;`);
  if (!(typeof peak === "number" && peak > 4)) console.log("Echo Lab debug (CW peak failed): " + await ev(`return JSON.stringify(KARDIA._kardia.echoLab.debug ? KARDIA._kardia.echoLab.debug() : null);`));
  ok(typeof peak === "number" && peak > 4, `severe AS CW peak exceeds 4 m/s (${peak})`);
  /* Freeze, cine and a Simpson measurement that can be completed and graded. */
  await ev(`document.querySelector('#smdKardia [data-act=kecho-freeze]').click(); return 1;`);
  await sleep(300);
  ok((await ev(`return !document.getElementById('krdCine').disabled;`)) === true, "freeze enables the cine bar");
  await ev(`document.querySelector('#smdKardia [data-act=kecho-measure]').click(); return 1;`);
  await sleep(500);
  ok((await ev(`return !!document.querySelector('#krdMeasure .krdm-stage');`)) === true, "Measure opens the Simpson tool on the frozen image");
  /* Complete Simpson biplane: trace one closed LV outline on each of the
   * four steps (end diastole and end systole, four chamber then two
   * chamber), pressing Done after each trace. Diastole traces are drawn
   * larger than systole traces so the computed ejection fraction is
   * positive. The final Done must produce a graded result against the
   * model ground truth, pass or fail. */
  for (const [fx, fy] of [[0.30, 0.36], [0.20, 0.24], [0.28, 0.34], [0.19, 0.22]]) {
    await ev("(function(){var ov=document.querySelector('#krdMeasure .krdm-ov'); if(!ov) return 0;" +
      "var r=ov.getBoundingClientRect(), cx=r.left+r.width/2, cy=r.top+r.height/2, rx=r.width*" + fx + ", ry=r.height*" + fy + ";" +
      "function pe(type,x,y){ov.dispatchEvent(new PointerEvent(type,{pointerId:11,clientX:x,clientY:y,bubbles:true}));}" +
      "var n=28, i, a; pe('pointerdown',cx+rx,cy);" +
      "for(i=1;i<=n;i++){ a=2*Math.PI*i/n; pe('pointermove',cx+rx*Math.cos(a),cy+ry*Math.sin(a)); }" +
      "pe('pointerup',cx+rx,cy); return 1;})()");
    await sleep(200);
    const doneEnabled = await ev(`return (function(){var bs=document.querySelectorAll('#krdMeasure .krdm-btn'); for(var i=0;i<bs.length;i++) if(bs[i].textContent==='Done') return !bs[i].disabled; return false;})();`);
    ok(doneEnabled === true, `Simpson trace enables Done (step radii ${fx}/${fy})`);
    await ev(`(function(){var bs=document.querySelectorAll('#krdMeasure .krdm-btn'); for(var i=0;i<bs.length;i++){ if(bs[i].textContent==='Done'){ bs[i].click(); return 1; } } return 0;})()`);
    await sleep(350);
  }
  ok(await until(`return !!document.querySelector('#krdMeasure .krdm-fb.show');`, 8000), "Simpson measurement completes: the grading card appears after the fourth Done");
  const gradeText = await ev(`return document.querySelector('#krdMeasure .krdm-fb') ? document.querySelector('#krdMeasure .krdm-fb').innerText : '';`);
  ok(/Within tolerance|Outside tolerance/.test(gradeText || ""), `Simpson result is graded against ground truth ("${(gradeText || "").split("\n")[0]}")`);
  ok(/True value/.test(gradeText || ""), "graded Simpson card shows the true value");
  console.log("Simpson grade: " + (gradeText || "").replace(/\n/g, " "));
  const frameMs = await ev(`return KARDIA._kardia.echoLab.echolab.frameMs();`);
  ok(typeof frameMs === "number" && frameMs > 0, `frame time logged (${typeof frameMs === "number" ? frameMs.toFixed(1) : frameMs} ms)`);
  console.log("Echo Lab frame time: " + frameMs + " ms");
  await shot("kardia-echolab-390-light");
  await metrics(820, 1180); await theme(true); await sleep(500); await shot("kardia-echolab-820-dark");
  await metrics(390, 844); await theme(false);

  /* ── 4. Screenshots: every tab at 390 and 820, light and dark ── */
  console.log("\n--- screenshots ---");
  const tabs = [["echo", "Echo Lab"], ["learn", "Echo"], ["practice", "Question bank"], ["cases", "Whole patient"], ["kardiox", "Open KardiQ X"]];
  for (const [w, h] of [[390, 844], [820, 1180]]) {
    await metrics(w, h);
    for (const dark of [false, true]) {
      await theme(dark);
      const th = dark ? "dark" : "light";
      for (const [id, marker] of tabs) {
        await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=${id}]').click(); return 1;`);
        await sleep(350);
        const seen = await ev(`return document.getElementById('smdKardia').innerText;`);
        ok(seen && seen.toLowerCase().indexOf(marker.split(" ")[0].toLowerCase()) >= 0, `${w}px ${th}: ${id} tab shows its screen ("${marker}")`);
        await shot(`kardia-${id}-${w}-${th}`);
      }
    }
  }
  // Learn lists the real atlas preview, not placeholders.
  await theme(false); await metrics(390, 844);
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=learn]').click(); return 1;`);
  await sleep(350);
  ok((await ev(`return document.querySelectorAll('#smdKardia [data-act=klearn][data-id]').length;`)) === 5, "Learn lists exactly the 5 free preview lessons");
  ok((await ev(`return (document.getElementById('smdKardia').innerText.match(/Plus \\d+ more lessons/)||[])[0];`)) !== null, "and counts the locked rest instead of listing it");

  /* ── 4b. Echo lesson, level change, bank question (light and dark, 390 and 820) ── */
  console.log("\\n--- Echo lesson, level and bank ---");
  for (const [w, h] of [[390, 844], [820, 1180]]) {
    await metrics(w, h);
    for (const dark of [false, true]) {
      await theme(dark);
      const th = dark ? "dark" : "light";
      await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=learn]').click(); return 1;`);
      await sleep(400);
      ok((await ev(`return document.querySelectorAll('#smdKardia [data-act=lesson][data-l]').length;`)) > 0, `${w}px ${th}: Learn lists echo lessons for the chosen level`);
      await ev(`var b=document.querySelector('#smdKardia [data-act=lesson][data-l]'); if(b) b.click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia .ln-art');`, 15000), `${w}px ${th}: an echo lesson opens in the engine player`);
      await shot(`kardia-echo-lesson-${w}-${th}`);
      await ev(`var n=document.getElementById('lnNext'); if(n) n.click(); return 1;`);
      await sleep(300);
      ok((await ev(`return !!document.querySelector('#smdKardia .ln-art');`)) === true, `${w}px ${th}: the lesson moves to its next step`);
      await ev(`var x=document.querySelector('#smdKardia [data-act=lnexit]'); if(x) x.click(); return 1;`);
      await sleep(400);
      // Change level: a locked level holds at the paywall for a free user, so grant Pro in the harness, then switch.
      await ev(`window.SMD_PRO={isProSync:function(){return true;},openPaywall:function(){}}; return 1;`);
      await ev(`var lv=document.querySelector('#smdKardia [data-act=klevel][data-v=resident]'); if(lv) lv.click(); return 1;`);
      await sleep(400);
      ok((await ev(`return document.querySelector('#smdKardia [data-act=klevel][data-v=resident]').getAttribute('aria-pressed');`)) === "true", `${w}px ${th}: level changes to Resident and the echo list refilters`);
      await ev(`var lv2=document.querySelector('#smdKardia [data-act=klevel][data-v=mbbs]'); if(lv2) lv2.click(); return 1;`);
      await sleep(300);
      await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=practice]').click(); return 1;`);
      await sleep(400);
      ok((await ev(`return document.getElementById('smdKardia').innerText.indexOf('Question bank')>=0;`)) === true, `${w}px ${th}: Practice shows the question bank, not coming soon`);
      await ev(`var qb=document.querySelector('#smdKardia [data-act=kbank]'); if(qb) qb.click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia [data-act=mcqstart]');`, 15000), `${w}px ${th}: the bank home opens through the engine bank`);
      await ev(`document.querySelector('#smdKardia [data-act=mcqstart]').click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia [data-act=mcqans]');`, 20000), `${w}px ${th}: a bank question loads`);
      await ev(`var a=document.querySelector('#smdKardia [data-act=mcqans]'); if(a) a.click(); return 1;`);
      await sleep(400);
      ok((await ev(`return document.getElementById('mcqNote') && document.getElementById('mcqNote').innerText.length>0;`)) === true, `${w}px ${th}: answering a bank question shows its explanation`);
      await shot(`kardia-bank-q-${w}-${th}`);
      await ev(`if(window.KARDIA){KARDIA.close(); KARDIA.open();} return 1;`);
      await until(`return !!document.querySelector('#smdKardia [data-act=ktab][data-t=learn]');`, 15000);
      await sleep(300);
    }
  }

  // Pressing Open KardiQ X without a code must hold at the gate: no AI overlay opens.
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=kardiox]').click(); return 1;`);
  await sleep(300);
  await ev(`(function(){var b=[...document.querySelectorAll('#smdKardia [data-act=kx]')][0]; if(b) b.click(); return 1;})()`);
  await sleep(600);
  ok((await ev(`return !document.getElementById('kardioxRoot') || !document.getElementById('kardioxRoot').classList.contains('kx-open');`)) === true,
    "Open KardiQ X without a code holds at SMD_XACCESS: no AI overlay opens");
  // Close the access sign-in sheet the gate opened, so later screenshots are not covered by it.
  await ev(`var n=[...document.querySelectorAll('button')].filter(function(b){return b.offsetParent && /^\\s*Not now\\s*$/.test(b.textContent);})[0]; if(n) n.click(); return 1;`);
  await sleep(400);

  /* ── 6. Cases: fixture case end to end (390 and 820, light and dark) ── */
  console.log("\n--- Cases: fixture case end to end ---");
  for (const [w, h] of [[390, 844], [820, 1180]]) {
    await metrics(w, h);
    for (const dark of [false, true]) {
      await theme(dark);
      const th = dark ? "dark" : "light";
      /* The theme and size switches reload the page, so the fixture fetch swap is installed before each visit. */
      await ev(`(function(){var orig=window.fetch; if(window.__kcFixture) return 1; window.__kcFixture=1; window.fetch=function(u,o){var s=String(u); if(s.indexOf("kardia/cases/")>=0){ s="/test/fixtures/kardia-cases/"+s.split("kardia/cases/")[1]; } return orig.call(window,s,o);}; return 1;})()`);
      await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=cases]').click(); return 1;`);
      ok(await until(`return document.querySelectorAll('#smdKardia [data-act=kcase-open]').length>=1;`, 15000), `${w}px ${th}: Cases lists fixture cases`);
      await shot(`kardia-cases-list-${w}-${th}`);
      await ev(`document.querySelector('#smdKardia [data-act=kcase-open]').click(); return 1;`);
      ok(await until(`return document.getElementById('smdKardia').innerText.indexOf('racing pulse')>=0 || document.querySelector('#smdKardia .kc-vitals')!==null;`, 15000), `${w}px ${th}: case opens on the stem`);
      ok((await ev(`return !!document.querySelector('#smdKardia .kc-vitals');`)) === true, `${w}px ${th}: stem shows vitals`);
      const step = async (marker) => { await ev(`var b=document.querySelector('#smdKardia [data-act=kcase-next]'); if(b) b.click(); return 1;`); await sleep(350); return await ev(`return document.getElementById('smdKardia').innerText;`); };
      let txt = await step();
      ok(txt.indexOf("Tap each question") >= 0, `${w}px ${th}: history step`);
      await ev(`var q=document.querySelector('#smdKardia [data-act=kcase-q]'); if(q) q.click(); return 1;`); await sleep(300);
      ok((await ev(`return !!document.querySelector('#smdKardia .kc-a');`)) === true, `${w}px ${th}: tapping a history question reveals its answer`);
      txt = await step();
      ok(txt.indexOf("Examination") >= 0 && txt.indexOf("Listen") >= 0, `${w}px ${th}: examination shows a Listen control`);
      await ev(`var l=document.querySelector('#smdKardia [data-act=kcase-listen]'); if(l) l.click(); return 1;`); await sleep(300);
      txt = await step();
      ok((await ev(`return !!document.querySelector('#smdKardia .kc-ecg polyline');`)) === true, `${w}px ${th}: ECG strip is drawn by the ECG wave code`);
      ok(txt.indexOf("Atrial fibrillation") >= 0, `${w}px ${th}: ECG names the case rhythm`);
      txt = await step();
      ok((await ev(`return !!document.querySelector('#smdKardia .kc-diagram');`)) === true, `${w}px ${th}: echo task shows the lesson diagram for its view`);
      await ev(`var i=document.querySelector('#smdKardia [data-echo="0"]'); if(i){i.value='0.9';} var c=document.querySelector('#smdKardia [data-act=kcase-echo-check]'); if(c) c.click(); return 1;`); await sleep(300);
      ok((await ev(`return document.getElementById('smdKardia').innerText.indexOf('Correct.')>=0;`)) === true, `${w}px ${th}: echo measurement is graded against truth with tolerance`);
      txt = await step();
      await ev(`(function(){var vals={'Left atrium':'large left atrium','Mitral valve':'rheumatic mitral stenosis','Mitral valve area':'0.9 severe','Rhythm during study':'AF'}; document.querySelectorAll('#smdKardia [data-field]').forEach(function(el){ el.value=vals[el.getAttribute('data-field')]||''; }); var b=document.querySelector('#smdKardia [data-act=kcase-report-check]'); if(b) b.click(); return 1;})()`); await sleep(300);
      ok((await ev(`return document.getElementById('smdKardia').innerText.indexOf('4 of 4')>=0;`)) === true, `${w}px ${th}: structured report is app marked against the accept lists`);
      txt = await step();
      await ev(`var d=document.querySelector('#smdKardia [data-diag]'); if(d) d.value='severe rheumatic mitral stenosis with atrial fibrillation'; var b2=document.querySelector('#smdKardia [data-act=kcase-diag-check]'); if(b2) b2.click(); return 1;`); await sleep(300);
      ok((await ev(`return document.getElementById('smdKardia').innerText.indexOf('Model management')>=0;`)) === true, `${w}px ${th}: diagnosis check reveals the model management`);
      await ev(`var f=document.querySelector('#smdKardia [data-act=kcase-finish]'); if(f) f.click(); return 1;`); await sleep(400);
      ok((await ev(`return document.getElementById('smdKardia').innerText.indexOf('Debrief')>=0;`)) === true, `${w}px ${th}: debrief shows scores per section`);
      ok((await ev(`return (localStorage.getItem('smd_kardia_v1')||'').indexOf('fixture-ms-af')>=0;`)) === true, `${w}px ${th}: attempt and FSRS card are recorded in the engine store`);
      await shot(`kardia-case-debrief-${w}-${th}`);
      await ev(`var a=document.querySelector('#smdKardia [data-act=kcase-list]'); if(a) a.click(); return 1;`); await sleep(300);
    }
  }

  /* ── 5. Back OFF: the grid is byte-for-byte what it was ── */
  await ev(`KARDIA.close(); try{localStorage.removeItem("smd_kardia");}catch(e){} return 1;`);
  await load(BASE);
  const gridBack = await ev(gridActs);
  ok(gridBack === gridOff, "flag back off: the Home grid is byte-for-byte what it was");
  ok(!/kardia/i.test(JSON.stringify(errors)), "no uncaught Kardia errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));

  console.log(fails === 0 ? "\nALL GREEN: Kardia wired into the app" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} process.exit(fails === 0 ? 0 : 1); }
