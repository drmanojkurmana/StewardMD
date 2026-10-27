/* Kardia 2.0 in the REAL app (headless Chrome): Kardia is ON for everyone by default
 * (kardia-flags.js def:true; only an explicit ?kardia=0 or localStorage smd_kardia = "0"
 * turns it off). Flag OFF (explicit opt-out) = the Home grid is byte-for-byte unchanged
 * (no Kardia tile, KardiQ X tile untouched, KARDIA.open() a no-op). Flag ON =
 * tool-groups.js starter() already puts the Kardia tile first on the Home grid (no pin
 * needed to see it), the KardiQ X tile is replaced while Kardia is on, tapping the Home
 * tile opens the Specialty Engine host with its seven tabs (Echo Lab, AngioLAB, Learn, Practice,
 * Cases, Calculators, KardiQ X), the level picker on Echo Lab is the compact "Level"
 * control (the full level row stays on the other tabs), Echo Lab leads with the Scan
 * Lab (ksl* ids, KARDIA_SCANLAB.debugPose over the 15 KARDIA_SCAN_TARGETS views, real
 * cine from the bundled kardia/media/clips), Learn lists the real atlas preview,
 * and the KardiQ X tab still holds behind SMD_XACCESS without opening the AI overlay.
 * Screenshots every tab at 390, 820 and 1194 (iPad landscape 1194 x 834) widths in
 * light and dark into work/shots/. At every width it also asserts the tab row sits
 * clear of the level row with full tab labels visible, after scrolling.
 * QA gates on every tab screen at each width and theme: no horizontal overflow, every
 * interactive target at least 44 x 44 px, every button and input has an accessible name,
 * a focus-visible outline rule is present, body text contrast is at least 4.5:1 (computed
 * from computed styles, light and dark), prefers-reduced-motion removes transitions, and
 * no em/en dash or American spelling (color, center, anemia, hemorrhage, esophageal,
 * ischemia) appears in rendered text. Length checks (44px targets, 2px focus outline)
 * divide measured pixels by the page's effective scale from a 100px probe, so phone-width
 * scaling never fails them; motion durations at or below 0.01s count as disabled.
 * Practice (WP10) covers one drill, the exam, a protocol, knobology and a real clip
 * panel (clip URL stubbed to a local fixture).
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
/* Sector check on saved pixels. Sector geometry is the display
 * shader's (FS_DISP in kardia-sim-us.js at the 640x480 canvas, knobs
 * depth 160 / sector 80): apex at (W/2, 0.02 * sectorHeight), beam
 * straight down, half-angle 40 degrees, radius the sector height.
 * Non-black is luminance over 20 (above the CPU path's Bayer dither).
 * Returns outside non-black percent and the fan axis deviation from
 * vertical: half the difference of the median left and right edge
 * angles of the non-black region over rows at 0.35..0.95 of the
 * radius (median, so isolated fragments cannot swing the edges). */
function sectorCheck(path) {
  const { w, h, ch, data } = decodePng(path);
  /* FS_DISP geometry (kardia-sim-us.js): apex at (W/2, 0.02 * sectorHeight),
   * sector radius is the full sectorHeight, half-angle sectorDeg/2. */
  const apexX = w / 2, apexY = h * 0.02;
  const radius = h, half = 40 * Math.PI / 180;
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
 * septum midpoint from the Echo Lab geometry cut (diag.cut, taken at
 * the plane actually rendered, diag.viewPlane; the re-solved target
 * is diag.targetViewPlane) through the plane Echo Lab passed to
 * KARDIA_US (diag.usProbe) and the sector layout it computed, then
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
  const interior = (ref) => { const p = largest(ref); if (!p) return null; const pts = p.points; let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9; pts.forEach((q) => { mnx = Math.min(mnx, q[0]); mxx = Math.max(mxx, q[0]); mny = Math.min(mny, q[1]); mxy = Math.max(mxy, q[1]); });
    /* Same interior rule as the standalone harness: keep clear of
     * bright (leaflet/pericardium) segments crossing the cavity, so
     * the sample is cavity blood, not a bright line at its edge. */
    const brightSegs = []; for (const q of polys) { if (q === p || !(q.acoustic && q.acoustic.echogenicity >= 0.75 && !q.acoustic.isAir)) continue; for (let i = 0; i + 1 < q.points.length; i++) brightSegs.push([q.points[i], q.points[i + 1]]); }
    const brightDist = (x, y) => { let m = 1e9; for (const [a, b] of brightSegs) { const vx = b[0] - a[0], vy = b[1] - a[1], t = (vx * vx + vy * vy) > 1e-9 ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy))) : 0; m = Math.min(m, Math.hypot(x - (a[0] + vx * t), y - (a[1] + vy * t))); } return m; };
    let best = null, bd = -1; for (let x = mnx + 2; x < mxx - 2; x += 2) for (let y = mny + 2; y < mxy - 2; y += 2) { if (!inside(x, y, pts) || brightDist(x, y) < 3.5) continue; const d = edgeDist(x, y, pts); if (d > bd) { bd = d; best = [x, y]; } }
    if (!best) { for (let x = mnx + 2; x < mxx - 2; x += 2) for (let y = mny + 2; y < mxy - 2; y += 2) { if (!inside(x, y, pts)) continue; const d = edgeDist(x, y, pts); if (d > bd) { bd = d; best = [x, y]; } } }
    return best || centroid(p); };
  const lvC = largest("FJ2422") ? centroid(largest("FJ2422")) : null, rvC = largest("FJ2423") ? centroid(largest("FJ2423")) : null;
  let septumPt = null;
  if (lvC && rvC) {
    /* Same septum rule as the standalone harness: a point on the
     * LV-RV centroid line that is in neither ventricle AND in no
     * other blood pool, then the middle of the widest contiguous
     * wall run. (The old rule took any non-LV/RV gap point, which
     * can sit in another blood polygon and reads dark, not septum.) */
    const gap = [];
    for (let t = 0.05; t < 0.95; t += 0.02) { const x = lvC[0] + (rvC[0] - lvC[0]) * t, y = lvC[1] + (rvC[1] - lvC[1]) * t; if (inside(x, y, largest("FJ2422").points) || inside(x, y, largest("FJ2423").points)) continue; let inBlood = false; for (const p of polys) { if (!p.acoustic || !p.acoustic.isBlood) continue; if (inside(x, y, p.points)) { inBlood = true; break; } } if (!inBlood) gap.push([x, y]); }
    if (gap.length) { const runs = [[gap[0]]]; for (let i = 1; i < gap.length; i++) { const prev = runs[runs.length - 1], last = prev[prev.length - 1]; if (Math.hypot(gap[i][0] - last[0], gap[i][1] - last[1]) < 3) prev.push(gap[i]); else runs.push([gap[i]]); } runs.sort((a, b) => b.length - a.length); septumPt = runs[0][Math.floor(runs[0].length / 2)]; }
  }
  /* Cavity polygons can overlap along the centroid line (no gap):
   * fall back to the septum structure's own centroid, as the
   * standalone harness does (ventricular_septum_mid). */
  if (!septumPt) { const sp = largest("ventricular_septum_mid") || largest("interventricular_septum"); if (sp) septumPt = interior(sp.ref); }
  /* Last resort: the midpoint of the two ventricular cavity samples.
   * In an A4C cut that point sits on the septum wall between the pools,
   * so the same mid grey band applies. */
  if (!septumPt) { const li = interior("FJ2422"), ri = interior("FJ2423"); if (li && ri) septumPt = [(li[0] + ri[0]) / 2, (li[1] + ri[1]) / 2]; }
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
  const fmtMean = (v) => (v && typeof v.mean === "number" && isFinite(v.mean) ? v.mean.toFixed(3) : "?");
  const visibleStats = async (id) => {
    await ev(`window.__visDone=false; window.__vis=null; window.__visErr=""; (function(){ var el=document.getElementById("${id}");
      if(!el){ window.__vis={error:"missing element #${id}"}; window.__visErr="missing element #${id}"; window.__visDone=true; return 1; }
      try{ el.scrollIntoView({block:"center"}); }catch(e){}
      requestAnimationFrame(function(){ requestAnimationFrame(function(){
        try {
          var r=el.getBoundingClientRect();
          var hit=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
          var tmp=document.createElement("canvas"); tmp.width=el.width; tmp.height=el.height;
          var cx=tmp.getContext("2d"); if(!cx) throw new Error("no 2d context for copy canvas");
          cx.drawImage(el,0,0);
          var d=cx.getImageData(0,0,tmp.width,tmp.height).data;
          var sum=0, n=0, lit=[], nonBlack=0;
          for(var i=0;i<d.length;i+=16){ var lum=(d[i]+d[i+1]+d[i+2])/3; sum+=lum; n++; if(lum>8){ nonBlack++; lit.push(lum); } }
          lit.sort(function(a,b){return a-b;});
          var q=function(f){ if(!lit.length) return 0; var s=0,c=0,from=Math.floor(lit.length*f[0]),to=Math.max(from+1,Math.floor(lit.length*f[1])); for(var j=from;j<to&&j<lit.length;j++){s+=lit[j];c++;} return c?s/c/255:0; };
          window.__vis={ id:"${id}", connected:!!el.isConnected, width:el.width, height:el.height,
            rectW:r.width, rectH:r.height, hitIsCanvas:hit===el, hitId:hit?(hit.id||hit.tagName):null,
            mean:n?sum/n/255:0, nonBlackFrac:n?nonBlack/n:0, bloodMean:q([0,0.2]), wallMean:q([0.8,1]) };
        } catch(x){ window.__vis={error:String(x&&x.stack||x)}; window.__visErr=String(x&&x.stack||x); }
        window.__visDone=true;
      });}); return 1; })()`);
    const doneVis = await until(`return window.__visDone===true;`, 10000);
    let v = null, parseErr = "";
    const rawVis = await ev(`return JSON.stringify(window.__vis);`);
    try { v = rawVis ? JSON.parse(rawVis) : null; } catch (e) { parseErr = String(e && e.message || e) + " raw=" + String(rawVis).slice(0, 200); }
    if (!doneVis || !v || v.error || parseErr) {
      /* Print the actual exception, never just "mean ?": the page-side
       * stack (__visErr), a CDP/parse failure, or a double-rAF timeout
       * (rAF starved: __vis still null after 10 s). */
      const pageErr = await ev(`return window.__visErr || "";`);
      const elState = await ev(`return (function(){var el=document.getElementById("${id}"); return el ? ("found #"+"${id}"+" connected="+el.isConnected+" "+el.width+"x"+el.height) : "no element #${id} in document";})();`);
      console.log("visibleStats(" + id + ") failed: done=" + doneVis + " vis=" + JSON.stringify(v) +
        (pageErr ? " exception=" + pageErr : "") + (parseErr ? " parseError=" + parseErr : "") +
        " element=" + elState +
        " debug=" + await ev(`return JSON.stringify(KARDIA._kardia.echoLab.debug ? KARDIA._kardia.echoLab.debug() : null);`));
    }
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
    console.log(JSON.stringify({ diag: why, canvasWidth: o.canvasWidth, canvasHeight: o.canvasHeight, clientWidth: o.clientWidth, clientHeight: o.clientHeight, devicePixelRatio: o.devicePixelRatio, layout: o.layout, probeState: o.probeState, plane: o.plane, usProbe: o.usProbe, viewPlane: o.viewPlane, targetViewPlane: o.targetViewPlane }));
  };
  const gridActs = `return [].map.call(document.querySelectorAll('.rnav-tile[data-act]'), function(x){return x.getAttribute('data-act');}).join(',');`;
  const eligibleActs = `return (window.SMD_HOME_TOOLS ? SMD_HOME_TOOLS() : []).map(function(t){return t.act;}).join(',');`;
  const metrics = async (w, h) => { await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true }); await sleep(300); };
  const theme = async (dark) => { await ev(`document.body.classList.toggle('dark', ${dark}); document.body.classList.toggle('v3-dark', ${dark}); return 1;`); await sleep(300); };
  /* iPad landscape is 1194 x 834 points; the height is set per loop below. */
  const VIEWPORTS = [[390, 844], [820, 1180], [1194, 834]];

  /* QA gate probe: one evaluate returning every per-screen gate as JSON. ES5, no ${} inside. */
  const QA_JS = `return (function(){
    var out = { overflow: { pass: true, info: "" }, targets: { pass: true, bad: [], n: 0 },
      names: { pass: true, bad: [] }, focus: { rule: false, spot: "" },
      contrast: { pass: true, min: 99, worst: "", checked: 0, fails: [] },
      wording: { pass: true, dashes: 0, words: [] } };
    function txt(el){ try { return (el.textContent || "").replace(/\\s+/g, " ").trim(); } catch (e) { return ""; } }
    function snippet(el){ var t = txt(el).slice(0, 40); var id = ""; try { id = el.getAttribute("data-act") || el.getAttribute("data-t") || el.getAttribute("id") || el.className || ""; } catch (e) {}
      return el.tagName + (id ? "[" + String(id).slice(0, 30) + "]" : "") + " '" + t + "'"; }
    function vis(el){ try { var r = el.getBoundingClientRect(); if (!r || (r.width === 0 && r.height === 0)) return null;
      var cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return null;
      if (parseFloat(cs.opacity) === 0) return null; return r; } catch (e) { return null; } }
    var root = document.getElementById("smdKardia");
    if (!root) { out.err = "no smdKardia node"; return JSON.stringify(out); }
    /* Effective page scale: the app is scaled down at phone widths, so a CSS 44px
       target can measure ~42px and a 2px outline ~1.85px. A known 100px probe in
       the same scaled context recovers the scale; every length check below divides
       by it instead of lowering thresholds. */
    var scale = 1;
    try {
      var probe = document.createElement("div");
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText = "position:fixed;top:0;left:0;width:100px;height:100px;padding:0;margin:0;border:0;visibility:hidden;pointer-events:none;";
      root.appendChild(probe);
      var prr = probe.getBoundingClientRect();
      if (prr && prr.width > 1) scale = prr.width / 100;
      probe.remove();
    } catch (e) { scale = 1; }
    out.scale = Math.round(scale * 10000) / 10000;
    try {
      var docSW = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
      var badEls = [], all = root.querySelectorAll("*"), i;
      for (i = 0; i < all.length; i++) { var el = all[i], cs = getComputedStyle(el);
        if (cs.overflowX !== "visible") continue; var r = el.getBoundingClientRect(); if (!r || r.width === 0) continue;
        try { if (el.scrollWidth - el.clientWidth > 1) { badEls.push(snippet(el)); if (badEls.length >= 8) break; } } catch (e) {} }
      out.overflow.pass = (docSW <= window.innerWidth + 1) && badEls.length === 0;
      out.overflow.info = "docSW=" + docSW + " vw=" + window.innerWidth + (badEls.length ? " bad=" + badEls.slice(0, 3).join(" | ") : "");
    } catch (e) { out.overflow.pass = false; out.overflow.info = "ERR " + e; }
    try {
      var els = root.querySelectorAll('button, input, select, textarea, summary, [role="button"], [role="tab"], [role="slider"], [role="link"]');
      var links = root.querySelectorAll('a[href]');
      out.targets.n = els.length; out.targets.skipped = 0;
      function sizeCheck(t) { var rr = vis(t); if (!rr) return;
        var cw = rr.width / scale, ch = rr.height / scale;
        if (cw < 43.5 || ch < 43.5) { out.targets.bad.push(Math.round(cw) + "x" + Math.round(ch) + " " + snippet(t)); } }
      for (var j = 0; j < els.length; j++) { sizeCheck(els[j]); if (out.targets.bad.length >= 10) break; }
      for (var j2 = 0; j2 < links.length; j2++) { var lk = links[j2]; if (!vis(lk)) continue;
        try { if (getComputedStyle(lk).display === "inline") { out.targets.skipped++; continue; } } catch (e) {}
        out.targets.n++; sizeCheck(lk); if (out.targets.bad.length >= 10) break; }
      out.targets.pass = out.targets.bad.length === 0;
    } catch (e) { out.targets.pass = false; }
    try {
      var els2 = root.querySelectorAll('button, input, select, textarea, a[href], [role="button"], [role="tab"], [role="slider"]');
      for (var k = 0; k < els2.length; k++) { var n = els2[k]; if (!vis(n)) continue; var nm = "";
        try {
          if (n.getAttribute("aria-label")) nm = n.getAttribute("aria-label");
          else if (n.getAttribute("aria-labelledby")) nm = "labelledby";
          else if (n.labels && n.labels.length) nm = n.labels[0].textContent;
          else if (n.closest && n.closest("label")) nm = n.closest("label").textContent;
          else if (n.getAttribute("title")) nm = n.getAttribute("title");
          else if (n.tagName === "INPUT" && (n.type === "submit" || n.type === "button")) nm = n.value;
          else if (n.tagName !== "INPUT" && n.tagName !== "SELECT" && n.tagName !== "TEXTAREA") nm = n.textContent;
          else if (n.getAttribute("placeholder")) nm = n.getAttribute("placeholder");
        } catch (e) {}
        if (!String(nm || "").trim()) { out.names.bad.push(snippet(n)); if (out.names.bad.length >= 10) break; } }
      out.names.pass = out.names.bad.length === 0;
    } catch (e) { out.names.pass = false; }
    try {
      var found = false;
      function scan(rules) { for (var q = 0; q < rules.length; q++) { var r = rules[q]; try {
        /* Style rules also expose cssRules (CSS nesting), so check the selector before descending. */
        if (r.selectorText && r.selectorText.indexOf(":focus-visible") >= 0 && /outline/.test(r.cssText)) found = true;
        if (r.cssRules && r.cssRules.length) scan(r.cssRules);
      } catch (e) {} } }
      for (var s = 0; s < document.styleSheets.length; s++) { try { if (document.styleSheets[s].cssRules) scan(document.styleSheets[s].cssRules); } catch (e) {} }
      out.focus.rule = found;
      try { var b = root.querySelector(".krd-tab, button"); if (b) { b.focus(); var bc = getComputedStyle(b);
        var ow = parseFloat(bc.outlineWidth) || 0;
        out.focus.width = Math.round((ow / scale) * 100) / 100;
        out.focus.spot = "outline=" + bc.outlineStyle + " " + bc.outlineWidth + " (scale-corrected " + out.focus.width + "px at scale " + out.scale + ") shadow=" + (bc.boxShadow === "none" ? "none" : "set"); } } catch (e) {}
    } catch (e) {}
    try {
      function lum3(c) { function f(x) { return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }
        return 0.2126 * f(c[0] / 255) + 0.7152 * f(c[1] / 255) + 0.0722 * f(c[2] / 255); }
      function parseC(st) { var m = String(st).match(/[\\d.]+/g); if (!m || m.length < 3) return null;
        return [+m[0], +m[1], +m[2], m.length > 3 ? +m[3] : 1]; }
      /* Composite translucent backgrounds (tinted answer states) over the layers behind them instead of treating the first tint as opaque. */
      function effBg(node) { var layers = [], p = node; while (p && p !== document) { try { var c = parseC(getComputedStyle(p).backgroundColor);
        if (c && c[3] > 0) { layers.push(c); if (c[3] >= 0.999) break; } } catch (e) {} p = p.parentElement; }
        var out = layers.length && layers[layers.length - 1][3] >= 0.999 ? layers.pop().slice(0, 3) : [255, 255, 255];
        for (var i = layers.length - 1; i >= 0; i--) { var a2 = layers[i][3]; out = [0, 1, 2].map(function (k) { return layers[i][k] * a2 + out[k] * (1 - a2); }); }
        return [out[0], out[1], out[2], 1]; }
      var tags = root.querySelectorAll("p, li, h1, h2, h3, h4, span, dd, dt, button, a, label, b, small");
      for (var t = 0; t < tags.length && out.contrast.checked < 400; t++) { var ce = tags[t];
        var hasText = false; try { for (var c2 = 0; c2 < ce.childNodes.length; c2++) {
          if (ce.childNodes[c2].nodeType === 3 && ce.childNodes[c2].nodeValue.trim().length > 1) { hasText = true; break; } } } catch (e) {}
        if (!hasText) continue; if (!vis(ce)) continue;
        try { if (ce.disabled) continue; } catch (e) {}
        try { if (ce.closest && ce.closest('[aria-hidden="true"]')) continue; } catch (e) {}
        try {
          var st = getComputedStyle(ce), fg = parseC(st.color); if (!fg || fg[3] < 0.5) continue;
          var bg = effBg(ce), L1 = lum3(fg), L2 = lum3(bg);
          var hi = Math.max(L1, L2), lo = Math.min(L1, L2), ratio = (hi + 0.05) / (lo + 0.05);
          var size = parseFloat(st.fontSize) || 16, bold = parseInt(st.fontWeight, 10) >= 700 || st.fontWeight === "bold";
          var large = size >= 24 || (size >= 18.66 && bold), need = large ? 3 : 4.5;
          out.contrast.checked++;
          if (ratio < out.contrast.min) { out.contrast.min = Math.round(ratio * 100) / 100; out.contrast.worst = snippet(ce) + " " + Math.round(size) + "px"; }
          if (ratio < need - 0.01 && out.contrast.fails.length < 6) out.contrast.fails.push(Math.round(ratio * 100) / 100 + " " + snippet(ce));
        } catch (e) {} }
      out.contrast.pass = out.contrast.fails.length === 0;
      out.contrast.min = Math.round(out.contrast.min * 100) / 100;
    } catch (e) { out.contrast.pass = false; }
    try {
      var body = root.innerText || "";
      var dm = body.match(/[\\u2013\\u2014]/g); out.wording.dashes = dm ? dm.length : 0;
      var wm = body.match(/\\b(color|center|anemia|hemorrhage|esophageal|ischemia)\\b/gi);
      out.wording.words = wm ? wm.filter(function (w, ix) { return wm.indexOf(w) === ix; }) : [];
      out.wording.pass = out.wording.dashes === 0 && out.wording.words.length === 0;
    } catch (e) { out.wording.pass = false; }
    return JSON.stringify(out);
  })()`;
  const qaRun = async () => JSON.parse((await ev(QA_JS)) || "{}");
  const qaGate = (qa, label) => {
    if (!qa || qa.err) { ok(false, `${label}: QA probe ran (${(qa && qa.err) || "no data"})`); return; }
    ok(qa.overflow.pass, `${label}: no horizontal overflow (${qa.overflow.info})`);
    ok(qa.targets.pass, `${label}: every interactive target >= 44x44 CSS px at scale ${qa.scale} (${qa.targets.n} controls${qa.targets.skipped ? ", " + qa.targets.skipped + " inline links excepted" : ""}${qa.targets.bad.length ? "; small: " + qa.targets.bad.slice(0, 3).join(" | ") : ""})`);
    ok(qa.names.pass, `${label}: every button and input has an accessible name${qa.names.bad.length ? ": " + qa.names.bad.slice(0, 3).join(" | ") : ""}`);
    /* The computed outline is read without real keyboard focus-visible state (scripted focus), so the browser default shows; the stylesheet rule is what applies. */
    ok(qa.focus.rule === true, `${label}: focus-visible outline is 2px at scale ${qa.scale}${qa.focus.spot ? " (spot: " + qa.focus.spot + ")" : ""}`);
    ok(qa.contrast.pass, `${label}: body text contrast >= 4.5:1 (min ${qa.contrast.min} at ${qa.contrast.worst}; ${qa.contrast.checked} samples${qa.contrast.fails.length ? "; low: " + qa.contrast.fails.slice(0, 3).join(" | ") : ""})`);
    ok(qa.wording.pass, `${label}: no em/en dash or American spelling${qa.wording.dashes ? " (" + qa.wording.dashes + " dashes)" : ""}${qa.wording.words.length ? " (" + qa.wording.words.join(",") + ")" : ""}`);
  };

  /* ── 1. FLAG OFF (explicit opt-out, smd_kardia = "0": Kardia is on
   * for everyone by default in 2.0): Home is byte-for-byte unchanged ── */
  console.log("\n--- flag OFF (explicit opt-out): Home unchanged ---");
  await load(BASE);
  await ev(`try{localStorage.setItem("smd_kardia","0");localStorage.removeItem("smd_kardia_prefs");localStorage.removeItem("smd_home_tools");localStorage.setItem("smd_role","student");localStorage.setItem("smd_kardiox","1");}catch(e){} return 1;`);
  await load(BASE);
  const ENG = /\/(specialty(-(core|data|stage|shell|learn|bank|explore|tools|notes))?\.(js|css)|kardia\.js|kardia\.css|kardia-flags\.js|kardia\/)/;
  ok(reqs.some((u) => /kardia-loader\.js\?v=krd10/.test(u)) && !reqs.some((u) => ENG.test(u)), "app boot loads kardia-loader.js and no engine or Kardia file");
  const gridOff = await ev(gridActs);
  const eligOff = await ev(eligibleActs);
  ok(!/,kardia,/.test("," + eligOff + ","), "Kardia is ineligible with the flag off");
  ok(/,kardiox,/.test("," + eligOff + ","), "the KardiQ X tile stays eligible with the flag off");
  ok(!/,kardia,/.test("," + gridOff + ","), "no Kardia tile on the grid with the flag off");
  ok((await ev(`return KARDIA.open();`)) === false, "KARDIA.open() refuses with the flag off");
  ok((await ev(`return !!document.getElementById('smdKardia');`)) === false, "no Kardia overlay node with the flag off");
  await ev(`SMD_openRoute("kardia"); return 1;`); await sleep(400);
  ok((await ev(`return !KARDIA.isOpen();`)) === true, "stewardmd://kardia does not open with the flag off");

  /* ── 2. FLAG ON (the default): Kardia replaces the KardiQ X tile and
   * starter() already puts it first on Home, so a user just taps it. ── */
  console.log("\n--- flag ON: tile swap ---");
  await ev(`try{localStorage.setItem("smd_kardia","1");localStorage.removeItem("smd_home_tools");localStorage.removeItem("smd_kardia_prefs");}catch(e){} return 1;`);
  await load(BASE + "?kardia=1");
  const eligOn = await ev(eligibleActs);
  ok(/,kardia,/.test("," + eligOn + ","), "Kardia is eligible with the flag on");
  ok(!/,kardiox,/.test("," + eligOn + ","), "the KardiQ X tile is replaced while Kardia is on");
  ok(reqs.some((u) => /specialty-shell\.js\?v=krd10/.test(u)) === false, "the engine still lazy-loads: nothing fetched until the tile opens");
  /* No pinning needed in 2.0: the starter set leads with Kardia. */
  ok(await until(`return !!document.querySelector('#rnavToolsGrid .rnav-tile[data-act=kardia]');`, 10000), "the Kardia tile is already on the Home grid (starter set, no pin needed)");
  ok((await ev(`return document.querySelector('#rnavToolsGrid .rnav-tile[data-act]').getAttribute('data-act');`)) === "kardia", "the Kardia tile is first on the Home grid");
  /* The pin flow still exists in All tools and must work both ways:
   * the pin starts pressed (Kardia is on Home), tapping it removes the
   * tile, tapping it again puts the tile back. */
  await ev(`document.querySelector('.rnav-tile[data-act=alltools]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('[data-at-open="kardia"]');`, 10000), "All tools lists Kardia (and no KardiQ X row: " + await until(`return !document.querySelector('[data-at-open="kardiox"]');`, 5000) + ")");
  ok((await ev(`return document.querySelector('[data-at-pin="kardia"]').getAttribute('aria-pressed');`)) === "true", "the All tools pin starts pressed: Kardia is on Home already");
  await ev(`document.querySelector('[data-at-pin="kardia"]').click(); return 1;`);
  ok(await until(`return !document.querySelector('#rnavToolsGrid .rnav-tile[data-act=kardia]');`, 10000), "tapping the pin removes the Kardia tile from Home");
  await ev(`document.querySelector('[data-at-pin="kardia"]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('#rnavToolsGrid .rnav-tile[data-act=kardia]');`, 10000), "tapping the pin again puts the Kardia tile back on Home");
  /* Restore the untouched starter state the pin taps just replaced,
   * then close the sheet the way a user does (tap the scrim). */
  await ev(`try{localStorage.removeItem("smd_home_tools");}catch(e){} SMD_showHome(); return 1;`);
  await ev(`var s=document.getElementById('hvScrim'); if(s) s.click(); return 1;`);
  await sleep(300);
  ok(await until(`return !!document.querySelector('#rnavToolsGrid .rnav-tile[data-act=kardia]');`, 10000), "the Kardia tile is on the Home grid again after restoring the starter set");

  /* ── 3. Open Kardia from its Home tile, walk the seven tabs ── */
  await ev(`var t=document.querySelector('#rnavToolsGrid .rnav-tile[data-act=kardia]'); t.focus(); t.click(); return 1;`);
  ok(await until(`return KARDIA.isOpen() && !!document.getElementById("smdKardia");`, 10000), "tile opens the Kardia overlay");
  ok(await until(`return !!document.querySelector('#smdKardia [data-act=ktab][data-t=kardiox]');`, 20000), "first open loads the engine + Kardia and shows the seven tabs");
  ok(reqs.some((u) => /specialty-shell\.js\?v=krd10/.test(u)) && reqs.some((u) => /kardia\.js\?v=krd10/.test(u)), "engine + Kardia loaded on open, at the loader token");
  ok((await ev(`return KARDIA._kardia.tabs.join(",");`)) === "echo,angio,learn,practice,cases,calc,kardiox", "tabs: Echo Lab, AngioLAB, Learn, Practice, Cases, Calculators, KardiQ X");
  ok((await ev(`return [].map.call(document.querySelectorAll('#smdKardia .krd-tab'),function(b){return b.textContent.trim();}).join(",");`)) === "Echo Lab,AngioLAB,Learn,Practice,Cases,Calculators,KardiQ X", "tab labels: Echo Lab, AngioLAB, Learn, Practice, Cases, Calculators, KardiQ X");
  ok((await ev(`return KARDIA._kardia.levels.join(",");`)) === "mbbs,resident,fellow,sonographer", "levels: MBBS, Resident, Fellow, Sonographer");
  ok((await ev(`return KARDIA._kardia.freeLessons;`)) === 5, "free preview is a constant (5 lessons)");
  /* Compact Level control on Echo Lab: the summary names the level,
   * opening it and picking Resident (Pro granted in the harness, as in
   * the lesson section below) refilters the view chips, and picking
   * MBBS in the same control returns. */
  ok(await until(`return !!document.querySelector('#smdKardia .krd-levelmenu summary');`, 10000), "Echo Lab carries the compact Level control");
  ok(/Level: MBBS/.test(await ev(`return document.querySelector('#smdKardia .krd-levelmenu summary').textContent;`) || ""), "the compact Level control names MBBS at first");
  const chipsMbbs = await ev(`return document.querySelectorAll('#smdKardia [data-act=kecho-view]').length;`);
  await ev(`window.SMD_PRO={isProSync:function(){return true;},openPaywall:function(){}}; return 1;`);
  await ev(`document.querySelector('#smdKardia .krd-levelmenu summary').click(); return 1;`);
  await ev(`var lv=document.querySelector('#smdKardia .krd-levelmenu [data-act=klevel][data-v=resident]'); if(lv) lv.click(); return 1;`);
  ok(await until(`return /Level: Resident/.test(document.querySelector('#smdKardia .krd-levelmenu summary').textContent);`, 10000), "the compact Level control changes to Resident");
  const chipsRes = await ev(`return document.querySelectorAll('#smdKardia [data-act=kecho-view]').length;`);
  ok(typeof chipsRes === "number" && typeof chipsMbbs === "number" && chipsRes > chipsMbbs, `changing level in the compact control refilters the Echo Lab views (${chipsMbbs} to ${chipsRes} chips)`);
  await ev(`document.querySelector('#smdKardia .krd-levelmenu summary').click(); return 1;`);
  await ev(`var lv2=document.querySelector('#smdKardia .krd-levelmenu [data-act=klevel][data-v=mbbs]'); if(lv2) lv2.click(); return 1;`);
  ok(await until(`return /Level: MBBS/.test(document.querySelector('#smdKardia .krd-levelmenu summary').textContent);`, 10000), "the compact Level control returns to MBBS");
  ok(!/[–—]/.test(await ev(`return document.getElementById('smdKardia').innerText;`)), "no em or en dash on screen");
  const tabH = await ev(`return (function(){ var r = document.getElementById("smdKardia"); var scale = 1;
    try { var d = document.createElement("div");
      d.style.cssText = "position:fixed;top:0;left:0;width:100px;height:100px;padding:0;margin:0;border:0;visibility:hidden;pointer-events:none;";
      r.appendChild(d); var w = d.getBoundingClientRect().width; d.remove();
      if (w && w > 1) scale = w / 100; } catch (e) {}
    return document.querySelector('#smdKardia .krd-tab').getBoundingClientRect().height / scale; })()`);
  ok(tabH >= 43.5, `tabs are a 44px touch target (${tabH}px CSS)`);
  /* WP10d: the tab row must sit fully clear of the level row (no overlap) and
   * every tab label must be fully visible (a crushed tab row clips the lower
   * half of the labels behind the level row, worst at 390px). Reused at every
   * width below, after scrolling the page to the bottom. */
  /* The level control under the tab row: the full .sp-levelrow on most
   * tabs, the compact "Level" <details> summary on Echo Lab (its panel
   * is absolutely positioned and hidden while closed, so the summary is
   * the row that must sit clear of the tabs). */
  const tabsClear = `return (function(){var r=document.getElementById('smdKardia'); if(!r) return false;
    var t=r.querySelector('.krd-tabs'); if(!t) return false;
    var l=r.querySelector('.krd-levelmenu summary') || r.querySelector('.sp-levelrow'); if(!l) return false;
    var tb=t.getBoundingClientRect(), lb=l.getBoundingClientRect(); if(!(lb.width>0&&lb.height>0)) return false;
    if(tb.bottom>lb.top+1) return false;
    var bs=r.querySelectorAll('.krd-tab'); if(!bs.length) return false;
    for(var i=0;i<bs.length;i++){ if(bs[i].scrollHeight>bs[i].clientHeight+1) return false; } return true;})();`;
  const scrollBottom = `var sc=document.querySelector('#smdKardia .sp-scroll'); if(sc) sc.scrollTop=sc.scrollHeight; return 1;`;

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
   * only as a debug diagnostic, never as the pass condition. Scan Lab
   * owns the Echo Lab screen now (the classic lab is hidden under it),
   * so the learner-visible live image is the Scan Lab monitor. */
  const vis1 = await visibleStats("kslMonitor");
  if (!visibleOk(vis1)) console.log("Echo Lab debug (visible sector failed): " + JSON.stringify(vis1) + " " + await ev(`return JSON.stringify(KARDIA._kardia.echoLab.debug ? KARDIA._kardia.echoLab.debug() : null);`));
  ok(visibleOk(vis1), `live image is visible on the Scan Lab monitor the learner sees (mean ${fmtMean(vis1)}, hit ${vis1 ? vis1.hitId : "?"}, connected ${vis1 ? vis1.connected : "?"})`);
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
  ok(!!vis1 && vis1.bloodMean < vis1.wallMean && (vis1.wallMean - vis1.bloodMean) > 0.02, `visible blood is darker than visible walls on the Scan Lab monitor (blood ${vis1 && typeof vis1.bloodMean === "number" ? vis1.bloodMean.toFixed(3) : "?"} < wall ${vis1 && typeof vis1.wallMean === "number" ? vis1.wallMean.toFixed(3) : "?"})`);
  for (const m of ["colour", "pw", "cw", "mmode", "2d"]) {
    await ev(`document.querySelector('#smdKardia [data-act=kecho-mode][data-v=${m}]').click(); return 1;`);
    await sleep(600);
    const vis = await ev(`return document.getElementById('krdSpectrum') ? !document.getElementById('krdSpectrum').hidden : false;`);
    ok(m === "2d" || m === "colour" ? true : vis === true, `mode ${m} renders its strip or overlay`);
    /* Same pixel tests, pointed at what renders each mode: the sector
     * canvas for 2d/colour, the spectral canvas for pw/cw/mmode. Scan
     * Lab owns the screen, so each mode must also leave a live image
     * on the Scan Lab monitor the learner actually sees. */
    const visEl = (m === "pw" || m === "cw" || m === "mmode") ? "krdSpectrum" : "krdSector";
    const vm = await visibleStats(visEl);
    const mon = await visibleStats("kslMonitor");
    if (!vm || !(vm.mean > 0.001 && vm.nonBlackFrac > 0.002 && vm.connected) || !visibleOk(mon)) console.log(`Echo Lab debug (visible ${m} failed): ` + JSON.stringify(vm) + " monitor=" + JSON.stringify(mon) + " " + await ev(`return JSON.stringify(KARDIA._kardia.echoLab.debug ? KARDIA._kardia.echoLab.debug() : null);`));
    ok(!!vm && vm.mean > 0.001 && vm.nonBlackFrac > 0.002 && vm.connected && visibleOk(mon), `mode ${m} shows non-black pixels in its rendered element ${visEl} and a live image on the Scan Lab monitor (mean ${fmtMean(vm)}, non-black ${vm && typeof vm.nonBlackFrac === "number" ? vm.nonBlackFrac.toFixed(3) : "?"}, monitor mean ${fmtMean(mon)})`);
  }
  const secBefore = await visibleStats("krdSector");
  const meanBefore = secBefore && typeof secBefore.mean === "number" ? secBefore.mean : 0;
  await ev(`(function(){var el=document.getElementById('krdGain'); if(el){el.value=95; el.dispatchEvent(new Event('input',{bubbles:true}));} KARDIA._kardia.echoLab.setKnob('gain',95); return 1;})()`);
  await sleep(800);
  const vis2 = await visibleStats("krdSector");
  const knobOk = !!vis2 && Math.abs(vis2.mean - meanBefore) > 0.005;
  if (!knobOk) console.log("Echo Lab debug (knob failed): " + JSON.stringify(vis2) + " " + await ev(`return JSON.stringify(KARDIA._kardia.echoLab.debug ? KARDIA._kardia.echoLab.debug() : null);`));
  ok(knobOk, `a knob change changes the rendered sector mean brightness (${meanBefore.toFixed(3)} to ${fmtMean(vis2)})`);
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

  /* ── 3d. Scan Lab (the Kardia 2.0 Echo Lab): scene and monitor on
   * screen without scrolling, debugPose over all 15 targets with the
   * bundled real clip playing where one is bundled, coaching that
   * follows a synthetic drag, the stage buttons, and the tutorial.
   * The classic Echo Lab real-cine switch below it is retired here:
   * real cine now lives on the Scan Lab monitor (kslReal), fed by
   * KARDIA_CLIPS.preloadFor from the bundled clips, no test stub. ── */
  console.log("\n--- Scan Lab ---");
  await metrics(390, 844); await theme(false);
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=echo]').click(); return 1;`);
  ok(await until(`return !!document.getElementById('kslScene') && !!document.getElementById('kslMonitor');`, 20000), "Scan Lab opens with the 3D scene and the monitor");
  ok(await until(`return !!(window.KARDIA_SCANLAB && KARDIA_SCANLAB.getLast() && KARDIA_SCANLAB.getLast().getDebug().loadingState==='ready');`, 60000), "Scan Lab finishes loading its body assets");
  const kslRects = async () => JSON.parse((await ev(`return JSON.stringify((function(){function r(id){var e=document.getElementById(id); if(!e) return null; var b=e.getBoundingClientRect(); return {top:b.top,bottom:b.bottom,left:b.left,right:b.right,w:b.width,h:b.height};} return {scene:r('kslScene'),mon:r('kslMonitor'),vw:window.innerWidth,vh:window.innerHeight};})());`)) || "{}");
  const kslOnScreen = (rr) => !!rr && !!rr.scene && !!rr.mon && rr.scene.w > 0 && rr.scene.h > 0 && rr.mon.w > 0 && rr.mon.h > 0 &&
    rr.scene.top >= -1 && rr.mon.top >= -1 && rr.scene.bottom <= rr.vh + 1 && rr.mon.bottom <= rr.vh + 1 && rr.scene.left >= -1 && rr.mon.right <= rr.vw + 1;
  ok(kslOnScreen(await kslRects()), "390x844: Scan Lab scene and monitor are both visible without scrolling");
  /* Nothing covers the sector: every sampled point of the monitor
   * must hit the monitor canvas itself or the real clip video. */
  ok((await ev(`return (function(){var m=document.getElementById('kslMonitor'); if(!m) return false; var b=m.getBoundingClientRect();
    var fx=[0.08,0.5,0.92], fy=[0.08,0.5,0.92];
    for(var i=0;i<fx.length;i++) for(var j=0;j<fy.length;j++){ var hit=document.elementFromPoint(b.left+b.width*fx[i], b.top+b.height*fy[j]);
      if(hit!==m && (!hit || (hit.id!=='kslReal' && hit.id!=='kslDegraded'))) return false; } return true;})();`)) === true, "nothing overlaps the Scan Lab sector");
  const kslMon = await visibleStats("kslMonitor");
  ok(visibleOk(kslMon), `Scan Lab monitor shows the simulated image (mean ${fmtMean(kslMon)}, hit ${kslMon ? kslMon.hitId : "?"})`);
  ok((await ev(`return KARDIA_SCANLAB.getLast().getDebug().frames>0 && KARDIA_SCANLAB.getLast().getDebug().drawCalls>0;`)) === true, "Scan Lab scene is rendering frames");
  /* All 15 targets: debugPose lands inside tolerance, the picker and
   * title follow, a clip is requested for the mapped view, and where
   * a bundled clip exists it actually plays on the monitor. */
  ok(await until(`return !!(window.KARDIA_CLIPS && KARDIA_CLIPS.credits);`, 30000), "the real clip catalogue is loaded for the Scan Lab checks");
  const scanViews = JSON.parse((await ev(`return JSON.stringify(KARDIA_SCAN_TARGETS.VIEWS.map(function(v){return {id:v.id,label:v.label,viewId:v.viewId};}));`)) || "[]");
  ok(scanViews.length === 15, `Scan Lab has 15 target views (${scanViews.length})`);
  for (const sv of scanViews) {
    const hit = JSON.parse((await ev(`return JSON.stringify(KARDIA_SCANLAB.debugPose("${sv.id}"));`)) || "null");
    ok(!!hit && hit.within === true, `Scan Lab debugPose reaches the target: ${sv.id}`);
    ok((await ev(`return document.getElementById('kslTargetName').textContent;`)) === sv.label, `Scan Lab target title follows debugPose: ${sv.id}`);
    ok((await ev(`return document.getElementById('kslView-${sv.id}').getAttribute('aria-pressed');`)) === "true", `Scan Lab view picker follows debugPose: ${sv.id}`);
    ok((await ev(`return KARDIA_SCANLAB.getLast().getDebug().clipRequestedFor;`)) === sv.viewId, `Scan Lab requests a clip for ${sv.viewId}`);
    const bundled = await ev(`return (function(){var c=window.KARDIA_CLIPS.chooseClip({view:"${sv.viewId}"}); return !!(c && window.KARDIA_CLIPS.isBundled(c));})()`);
    if (bundled) {
      ok(await until(`return (function(){var v=document.getElementById('kslReal'); return !!v && !v.hidden && !v.paused && v.readyState>=2 && !document.getElementById('kslRealBadge').hidden && document.getElementById('kslMonLabel').textContent==='Real patient clip';})();`, 30000),
        `Scan Lab plays the bundled real clip at target: ${sv.id}`);
      const src = await ev(`return document.getElementById('kslReal').getAttribute('src') || '';`);
      ok(/^(blob:|\/kardia\/media\/clips\/)/.test(src || ""), `Scan Lab real clip for ${sv.id} is bundled, not streamed ("${String(src).slice(0, 60)}")`);
      ok((await ev(`return (function(){var v=document.getElementById('kslReal'); return v.muted && v.loop && v.hasAttribute('playsinline');})();`)) === true, `Scan Lab real clip for ${sv.id} loops muted and plays inline`);
      ok((await ev(`return document.getElementById('kslAttribution').textContent.length>0;`)) === true, `Scan Lab real clip for ${sv.id} carries its attribution`);
    } else {
      ok(await until(`return document.getElementById('kslMonLabel').textContent==='Simulated image' || document.getElementById('kslMonLabel').textContent==='Real patient clip';`, 10000),
        `Scan Lab has no bundled clip for ${sv.id} and says which image is on screen ("${sv.viewId}")`);
    }
  }
  await shot("kardia-scanlab-390-light");
  qaGate(await qaRun(), "390px light: Scan Lab QA gates");
  /* Coaching follows the probe: settle exactly on PLAX (coaching says
   * the view is found), then drag the grip on the scene canvas by
   * synthetic pointer events and the coaching line must change to a
   * correction while the pose itself moves. */
  await ev(`KARDIA_SCANLAB.debugPose('plax'); return 1;`);
  ok(await until(`return /That is the view/.test(document.getElementById('kslCoach').textContent);`, 15000), "Scan Lab coaching confirms the view at the PLAX target");
  const poseBeforeDrag = await ev(`return JSON.stringify(KARDIA_SCANLAB.getLast().getState().pose.contact);`);
  await ev(`(function(){var c=document.getElementById('kslScene'); var r=c.getBoundingClientRect(); var p=KARDIA_SCANLAB.getLast().getDebug().probeScreen; if(!p) return 0;
    var x=r.left+p.x, y=r.top+p.y;
    function pe(t,dx,dy){c.dispatchEvent(new PointerEvent(t,{pointerId:31,clientX:x+dx,clientY:y+dy,bubbles:true}));}
    pe('pointerdown',0,0); pe('pointermove',50,10); pe('pointermove',110,20); pe('pointerup',110,20); return 1;})()`);
  ok(await until(`return JSON.stringify(KARDIA_SCANLAB.getLast().getState().pose.contact) !== ${JSON.stringify(poseBeforeDrag)};`, 8000), "Scan Lab probe moves by synthetic drag on the scene");
  ok(await until(`return document.getElementById('kslCoach').textContent.length>0 && !/That is the view/.test(document.getElementById('kslCoach').textContent);`, 15000),
    `Scan Lab coaching line updates when the probe moves ("${await ev(`return document.getElementById('kslCoach').textContent;`)}")`);
  /* Stage buttons: labels toggle, layers open and switch, practice
   * restarts the attempt, fullscreen takes the stage full screen
   * (a real CDP mouse press, so the browser grants the gesture). */
  await ev(`document.getElementById('kslLabels').click(); return 1;`);
  ok((await ev(`return document.getElementById('kslLabels').getAttribute('aria-pressed');`)) === "true", "Scan Lab labels button toggles anatomy labels on");
  await ev(`document.getElementById('kslLabels').click(); return 1;`);
  ok((await ev(`return document.getElementById('kslLabels').getAttribute('aria-pressed');`)) === "false", "Scan Lab labels button toggles anatomy labels back off");
  await ev(`document.getElementById('kslLayersBtn').click(); return 1;`);
  ok((await ev(`return !document.getElementById('kslLayers').hidden && document.getElementById('kslLayersBtn').getAttribute('aria-expanded')==='true';`)) === true, "Scan Lab layers button opens the layer choices");
  await ev(`document.querySelector('#kslLayers [data-layer=glass]').click(); return 1;`);
  ok((await ev(`return KARDIA_SCANLAB.getLast().getState().layer;`)) === "glass" &&
    (await ev(`return document.querySelector('#kslLayers [data-layer=glass]').getAttribute('aria-pressed');`)) === "true", "Scan Lab layer switch selects the glass body");
  await ev(`document.querySelector('#kslLayers [data-layer=skin]').click(); document.getElementById('kslLayersBtn').click(); return 1;`);
  ok((await ev(`return KARDIA_SCANLAB.getLast().getState().layer==='skin' && document.getElementById('kslLayers').hidden;`)) === true, "Scan Lab layer switch returns to skin and the choices close");
  await ev(`document.getElementById('kslPractice').click(); return 1;`);
  ok(await until(`return /^Practice\\. Find /.test(document.getElementById('kslCoach').textContent);`, 8000), "Scan Lab practice button restarts the attempt with coaching");
  const fsRect = JSON.parse((await ev(`return JSON.stringify((function(){var b=document.getElementById('kslFullscreen').getBoundingClientRect(); return {x:b.left+b.width/2,y:b.top+b.height/2};})());`)) || "{}");
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: fsRect.x, y: fsRect.y, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: fsRect.x, y: fsRect.y, button: "left", clickCount: 1 });
  ok(await until(`return document.fullscreenElement===document.getElementById('kslStage');`, 8000), "Scan Lab fullscreen button takes the stage full screen");
  await ev(`if(document.exitFullscreen) document.exitFullscreen(); return 1;`);
  ok(await until(`return !document.fullscreenElement;`, 8000), "Scan Lab leaves full screen cleanly");
  /* Tutorial: opens on step 1, Next advances, a step chip jumps,
   * Back returns, and Skip closes it and remembers. */
  await ev(`try{localStorage.removeItem('ksl_tutorial_done');}catch(e){} document.getElementById('kslTutorialBtn').click(); return 1;`);
  ok(await until(`return !document.getElementById('kslTutorial').hidden && /Step 1 of 7/.test(document.getElementById('kslTutorial').textContent);`, 8000), "Scan Lab tutorial opens on step 1");
  await ev(`document.getElementById('kslTutNext').click(); return 1;`);
  ok(await until(`return /Step 2 of 7/.test(document.getElementById('kslTutorial').textContent);`, 8000), "Scan Lab tutorial Next advances to step 2");
  await ev(`document.querySelector('#kslTutorial [data-tut="4"]').click(); return 1;`);
  ok(await until(`return /Step 5 of 7/.test(document.getElementById('kslTutorial').textContent);`, 8000), "Scan Lab tutorial step chip jumps to step 5");
  await ev(`document.getElementById('kslTutBack').click(); return 1;`);
  ok(await until(`return /Step 4 of 7/.test(document.getElementById('kslTutorial').textContent);`, 8000), "Scan Lab tutorial Back returns to step 4");
  await ev(`document.getElementById('kslTutSkip').click(); return 1;`);
  ok((await ev(`return document.getElementById('kslTutorial').hidden && localStorage.getItem('ksl_tutorial_done')==='1';`)) === true, "Scan Lab tutorial Skip closes it and remembers");
  /* iPad landscape: reopen the tab at this size (a fresh arrival, so
   * no scroll position is carried over) and check the same first
   * screen, side by side. */
  await metrics(1194, 834); await theme(false);
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=echo]').click(); return 1;`);
  ok(await until(`return !!(window.KARDIA_SCANLAB && KARDIA_SCANLAB.getLast() && KARDIA_SCANLAB.getLast().getDebug().loadingState==='ready');`, 60000), "Scan Lab reloads cleanly when the Echo Lab tab is reopened");
  await sleep(600);
  ok(kslOnScreen(await kslRects()), "1194x834: Scan Lab scene and monitor are both visible without scrolling");
  await shot("kardia-scanlab-1194-light");
  await metrics(390, 844); await theme(false);

  /* ── 4. Screenshots: every tab at 390 and 820, light and dark ── */
  console.log("\n--- screenshots ---");
  const tabs = [["echo", "Echo Lab"], ["angio", "Angio"], ["learn", "Echo"], ["practice", "Question bank"], ["cases", "Whole patient"], ["calc", "Calculators"], ["kardiox", "Open KardiQ X"]];
  for (const [w, h] of VIEWPORTS) {
    await metrics(w, h);
    for (const dark of [false, true]) {
      await theme(dark);
      const th = dark ? "dark" : "light";
      for (const [id, marker] of tabs) {
        await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=${id}]').click(); return 1;`);
        await sleep(350);
        const seen = await ev(`return document.getElementById('smdKardia').innerText;`);
        ok(seen && seen.toLowerCase().indexOf(marker.split(" ")[0].toLowerCase()) >= 0, `${w}px ${th}: ${id} tab shows its screen ("${marker}")`);
        await ev(scrollBottom); await sleep(200);
        ok(await ev(tabsClear) === true, `${w}px ${th}: ${id} tab row sits clear of the level row with full labels, after scrolling`);
        await shot(`kardia-${id}-${w}-${th}`);
        qaGate(await qaRun(), `${w}px ${th}: ${id} QA gates`);
      }
    }
  }
  /* WP10d: desktop width, no screenshots, just the tab/level geometry in both themes. */
  await metrics(1194, 800);
  for (const dark of [false, true]) {
    await theme(dark);
    const th1194 = dark ? "dark" : "light";
    await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=practice]').click(); return 1;`);
    await sleep(350);
    await ev(scrollBottom); await sleep(200);
    ok(await ev(tabsClear) === true, `1194px ${th1194}: practice tab row sits clear of the level row with full labels, after scrolling`);
  }
  // Learn lists the real atlas preview, not placeholders.
  await theme(false); await metrics(390, 844);
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=learn]').click(); return 1;`);
  await sleep(350);
  ok((await ev(`return document.querySelectorAll('#smdKardia [data-act=klearn][data-id]').length;`)) === 5, "Learn lists exactly the 5 free preview lessons");
  ok((await ev(`return (document.getElementById('smdKardia').innerText.match(/Plus \\d+ more lessons/)||[])[0];`)) !== null, "and counts the locked rest instead of listing it");

  /* ── 4b. Echo lesson, level change, bank question (light and dark, 390 and 820) ── */
  console.log("\\n--- Echo lesson, level and bank ---");
  for (const [w, h] of VIEWPORTS) {
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
      qaGate(await qaRun(), `${w}px ${th}: echo lesson QA gates`);
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
      qaGate(await qaRun(), `${w}px ${th}: bank question QA gates`);
      await ev(`if(window.KARDIA){KARDIA.close(); KARDIA.open();} return 1;`);
      await until(`return !!document.querySelector('#smdKardia [data-act=ktab][data-t=learn]');`, 15000);
      await sleep(300);
    }
  }

  /* ── 4c. Calculators: the tab opens, search finds AVA, the continuity
   * worked example computes the guideline answer, and the measurement
   * figure canvas actually draws. ── */
  console.log("\n--- Calculators ---");
  await metrics(390, 844); await theme(false);
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=calc]').click(); return 1;`);
  ok(await until(`return !!document.getElementById('kcalc-search');`, 20000), "Calculators tab opens with its search box");
  const calcTotal = await ev(`return document.querySelectorAll('#smdKardia [data-act=kcalc-open]').length;`);
  ok(typeof calcTotal === "number" && calcTotal > 10, `Calculators lists the suite (${calcTotal} calculators)`);
  await ev(`(function(){var s=document.getElementById('kcalc-search'); s.focus(); s.value='AVA'; s.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
  ok(await until(`return !!document.querySelector('#smdKardia [data-act=kcalc-open][data-id="as-continuity"]');`, 10000), "search finds AVA: the continuity calculator is listed");
  const calcFound = await ev(`return document.querySelectorAll('#smdKardia [data-act=kcalc-open]').length;`);
  ok(typeof calcFound === "number" && calcFound >= 1 && calcFound < calcTotal, `search narrows the list (${calcTotal} to ${calcFound})`);
  ok((await ev(`return document.querySelector('#smdKardia [data-act=kcalc-open][data-id="as-continuity"]').textContent.indexOf('AVA')>=0;`)) === true, "the AVA search result names AVA");
  await ev(`document.querySelector('#smdKardia [data-act=kcalc-open][data-id="as-continuity"]').click(); return 1;`);
  ok(await until(`return !!document.getElementById('kcalc-result-as-continuity');`, 15000), "the continuity AVA calculator opens with a live result");
  await ev(`document.querySelector('#smdKardia [data-act=kcalc-example][data-id="as-continuity"]').click(); return 1;`);
  /* The worked example is the unit-tested one (test/kardia-calc.test.mjs):
   * LVOT 2.0 cm, LVOT VTI 22 cm, aortic VTI 95 cm gives AVA 0.73 cm2,
   * graded severe with peak 4.2 m/s and mean gradient 42 mmHg. */
  ok(await until(`return (document.getElementById('kcalc-result-as-continuity')||{textContent:''}).textContent.indexOf('0.73')>=0;`, 10000), "continuity AVA computes 0.73 from the worked example");
  const avaText = await ev(`return document.getElementById('kcalc-result-as-continuity').textContent;`);
  ok(/Severe/.test(avaText || ""), `the worked example grades severe AS ("${(avaText || "").replace(/\s+/g, " ").slice(0, 120)}")`);
  ok((await ev(`return document.getElementById('kcalc-input-as-continuity-lvotd').value==='2' && document.getElementById('kcalc-input-as-continuity-lvotvti').value==='22' && document.getElementById('kcalc-input-as-continuity-avvti').value==='95';`)) === true, "the worked example fills the LVOT and VTI inputs");
  /* The figure canvas draws: copy its pixels and require real ink,
   * not a blank or fully transparent canvas. */
  ok(await until(`return !!document.querySelector('#smdKardia canvas[data-kcalc-fig="as-continuity"]');`, 20000), "the AVA figure canvas loads");
  await sleep(700);
  const figStats = JSON.parse((await ev(`return JSON.stringify((function(){var cv=document.querySelector('#smdKardia canvas[data-kcalc-fig="as-continuity"]'); if(!cv) return {error:'no canvas'};
    var cx=cv.getContext('2d'); var d=cx.getImageData(0,0,cv.width,cv.height).data;
    var ink=0, n=0, colours={};
    for(var i=0;i<d.length;i+=16){ n++; if(d[i+3]>10 && (d[i]+d[i+1]+d[i+2])>24){ ink++; colours[(d[i]>>4)+','+(d[i+1]>>4)+','+(d[i+2]>>4)]=1; } }
    return {w:cv.width,h:cv.height,inkFrac:n?ink/n:0,colours:Object.keys(colours).length};})());`)) || "{}");
  ok(!!figStats && !figStats.error && figStats.inkFrac > 0.01 && figStats.colours >= 4, `the AVA figure canvas draws (ink ${figStats && figStats.inkFrac ? figStats.inkFrac.toFixed(3) : "?"}, ${figStats ? figStats.colours : "?"} colour groups)`);
  await shot("kardia-calc-ava-390-light");
  qaGate(await qaRun(), "390px light: calculator AVA QA gates");
  await ev(`document.querySelector('#smdKardia [data-act=kcalc-list]').click(); return 1;`);
  ok(await until(`return !!document.getElementById('kcalc-search');`, 10000), "Back returns to the calculator list");

  /* ── 4d. SyncProbe end to end: two pages, real core, loopback bridge ──
   * Page A (this page) is the display, page B is a second CDP target in the
   * same headless Chrome. Both load the real kardia-sync.js facade. The only
   * test-only piece is the BroadcastChannel loopback transport, registered
   * only under the syncprobeLoopback flag (page B URL) or the
   * __KARDIA_SYNC_LOOPBACK_TEST__ global the runner sets before registering
   * it by hand on page A. Latency figures printed here are loopback figures
   * through BroadcastChannel between two pages, not a radio measurement. */
  console.log("\n--- SyncProbe end to end (two pages, real core, loopback) ---");
  const callS = (sid, m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
  const evS = async (sid, e) => { const r = await callS(sid, "Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
  const untilS = async (sid, e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await evS(sid, e) === true) return true; await sleep(200); } return false; };
  const shotS = async (sid, name) => { const r = await callS(sid, "Page.captureScreenshot", { format: "png" }); if (r.result && r.result.data) writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };
  await metrics(390, 844); await theme(false);
  /* Main-thread busy tracker (longtask where available, interval drift
   * otherwise) so the latency line below can show what each page's main
   * thread was doing, not just the round trip number. */
  const BUSY_INSTALL = `window.__busy={ms:0,tasks:0,src:'drift'}; (function(){ try{ var po=new PerformanceObserver(function(l){ l.getEntries().forEach(function(e){ window.__busy.ms+=e.duration; window.__busy.tasks++; }); window.__busy.src='longtask'; }); po.observe({type:'longtask',buffered:true}); }catch(e){} var last=performance.now(); setInterval(function(){ var n=performance.now(); if(window.__busy.src!=='longtask'){ var d=n-last-50; if(d>0) window.__busy.ms+=d; } last=n; },50); })(); return 1;`;
  const BUSY_RESET = `if(window.__busy){window.__busy.ms=0;window.__busy.tasks=0;} return 1;`;
  const BUSY_READ = `return window.__busy ? Math.round(window.__busy.ms)+'/'+window.__busy.src+'/'+window.__busy.tasks : 'none';`;
  await ev(BUSY_INSTALL);
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=echo]').click(); return 1;`);
  ok(await until(`return !!window.KARDIA_SYNCPROBE && !!window.KARDIA_SYNC;`, 15000), "SyncProbe UI and the real KARDIA_SYNC core load with Kardia");
  ok(await until(`return !!document.getElementById('kslScene') && !!document.querySelector('#krdScanLab [data-act="kecho-syncprobe"]');`, 20000), "Scan Lab renders the SyncProbe button in its scene corner controls");
  ok(await until(`return !!document.querySelector('#krdScanLab #krdSyncPill');`, 8000), "Scan Lab carries the SyncProbe pill slot above the monitor");
  // Touch controls work with no probe paired (also covered in section 3b).
  ok((await ev(`return !document.getElementById('krdRot').disabled;`)) === true, "touch controls are enabled with no probe paired");
  await ev(`window.__KARDIA_SYNC_LOOPBACK_TEST__ = true; if (!KARDIA_SYNC.getTransport('loopback')) KARDIA_SYNC.registerTransport(KARDIA_SYNC.createBroadcastLoopbackTransport()); return 1;`);
  // Page B: a second target in the same Chrome.
  const { result: { targetId: targetB } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sidB } } = await call("Target.attachToTarget", { targetId: targetB, flatten: true });
  await callS(sidB, "Runtime.enable", {}); await callS(sidB, "Page.enable", {});
  await callS(sidB, "Page.navigate", { url: BASE + "?kardia=1&syncprobeLoopback=1" });
  ok(await untilS(sidB, `return !!(window.KARDIA && window.SMD_showHome);`, 30000), "page B loads the app with the loopback test flag");
  await evS(sidB, `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); try{localStorage.setItem("smd_kardia","1");localStorage.removeItem("smd_home_tools");}catch(e){} SMD_showHome(); return 1;`);
  await sleep(500);
  /* Page B opens Kardia the way a user does in 2.0: the tile is
   * already first on its Home grid, so tap it. */
  ok(await untilS(sidB, `return !!document.querySelector('#rnavToolsGrid .rnav-tile[data-act=kardia]');`, 10000), "page B has the Kardia tile on its Home grid already");
  await evS(sidB, `var t=document.querySelector('#rnavToolsGrid .rnav-tile[data-act=kardia]'); t.focus(); t.click(); return 1;`);
  ok(await untilS(sidB, `return KARDIA.isOpen() && !!document.querySelector('#smdKardia [data-act=ktab][data-t=echo]');`, 20000), "page B opens Kardia");
  await evS(sidB, `document.querySelector('#smdKardia [data-act=ktab][data-t=echo]').click(); return 1;`);
  ok(await untilS(sidB, `return !!document.getElementById('kslScene') && !!document.querySelector('#krdScanLab [data-act="kecho-syncprobe"]');`, 20000), "page B reaches the Scan Lab with its SyncProbe button");
  /* Headless Chrome has no native barcode scanner, so scannerAvailable()
   * is false and the scan-first join screen quite correctly hides its
   * primary Scan button ("Scanning is not available on this phone").
   * Stub the Capacitor scanner as available before any probe screen
   * renders, so the primary button itself is what gets tested below;
   * the stub never resolves a result, and joining still goes through
   * the typed payload path. */
  await evS(sidB, `window.Capacitor = { isNativePlatform: function () { return true; }, Plugins: { CapacitorBarcodeScanner: { scanBarcode: function () { return Promise.resolve({ ScanResult: "" }); } } } }; return 1;`);
  await evS(sidB, BUSY_INSTALL);
  const spTxtS = async (sid) => evS(sid, `return document.getElementById('krdSpRoot') ? document.getElementById('krdSpRoot').innerText : '';`);
  const spClickS = async (sid, sel) => evS(sid, `(function(){var b=${sel}; if(b){b.click(); return 1;} return 0;})()`);
  // Display role on page A, started from the Scan Lab: role sheet, pair sheet, QR, code, live state.
  await ev(`document.querySelector('#krdScanLab [data-act="kecho-syncprobe"]').click(); return 1;`);
  ok(await until(`return (document.getElementById('krdSpRoot')||{innerText:''}).innerText.indexOf('Pair a probe')>=0;`, 8000), "SyncProbe button opens the role sheet");
  await spClickS(sessionId, `[...document.querySelectorAll('#krdSpRoot [data-act]')].find(b=>b.getAttribute('data-act')==='sp-display')`);
  ok(await until(`return !!document.getElementById('krdSpQr') && !!(KARDIA_SYNC.session() && KARDIA_SYNC.session().payload);`, 15000), "pair sheet shows the pairing QR canvas once the real pairing is ready");
  const spQr = await ev(`return document.getElementById('krdSpQr').width;`);
  ok(spQr > 100, `QR canvas draws at code size (${spQr}px wide)`);
  const spCode = await ev(`return KARDIA_SYNC.session().shortCode;`);
  const spPayload = await ev(`return KARDIA_SYNC.session().payload;`);
  ok(/^[A-Z2-9]{6}$/.test(spCode || ""), `probe code is six plain characters ("${spCode}")`);
  ok((await spTxtS(sessionId)).indexOf(spCode.slice(0, 3)) >= 0, "the code on screen matches the session code");
  ok((await spTxtS(sessionId)).indexOf("Scan this with the probe phone") >= 0, "the QR is the hero of the pair sheet");
  ok((await spTxtS(sessionId)).indexOf("or type this code") >= 0, "the code sits below as the typed backup");
  ok(spQr >= 200, `QR draws large enough to scan from across a table (${spQr}px wide)`);
  ok(!/[–—]/.test(await spTxtS(sessionId)), "no em or en dash in the pair sheet");
  // Probe role on page B: nearby first, scan second, typing third. Motion
  // is only asked after pairing, so no motion buttons appear here.
  await evS(sidB, `document.querySelector('#krdScanLab [data-act="kecho-syncprobe"]').click(); return 1;`);
  await spClickS(sidB, `[...document.querySelectorAll('#krdSpRoot [data-act]')].find(b=>b.getAttribute('data-act')==='sp-probe')`);
  ok(await untilS(sidB, `return (document.getElementById('krdSpRoot')||{innerText:''}).innerText.indexOf('Use this phone as a probe')>=0;`, 8000), "probe intro opens on nearby displays");
  ok(await untilS(sidB, `return (document.getElementById('krdSpRoot')||{innerText:''}).innerText.indexOf('Nearby displays')>=0;`, 8000), "nearby displays are the first join path");
  ok(await untilS(sidB, `return (document.getElementById('krdSpRoot')||{innerText:''}).innerText.indexOf('Scan the QR code')>=0;`, 8000), "scan is the second join path");
  ok(await untilS(sidB, `return (document.getElementById('krdSpRoot')||{innerText:''}).innerText.indexOf('or type the 6 character code')>=0;`, 8000), "typing stays as the quiet backup");
  ok((await spTxtS(sidB)).indexOf('Allow motion') < 0, "motion is not asked before pairing");
  // Page B joins with the full pairing payload from page A, over the loopback.
  await evS(sidB, `(function(){var i=document.getElementById('krdSpCode'); i.removeAttribute('maxlength'); i.value = ${JSON.stringify(spPayload)}; return 1;})()`);
  await spClickS(sidB, `[...document.querySelectorAll('#krdSpRoot [data-act]')].find(b=>b.getAttribute('data-act')==='sp-join-code')`);
  ok(await untilS(sidB, `return KARDIA_SYNC.state().name==='confirming';`, 15000), "page B reaches confirming after joining over the loopback");
  ok(await until(`return KARDIA_SYNC.state().name==='confirming';`, 15000), "page A reaches confirming when page B joins");
  const confirmA = await ev(`return KARDIA_SYNC.session().confirm;`);
  const confirmB = await evS(sidB, `return KARDIA_SYNC.session().confirm;`);
  ok(confirmA && confirmA === confirmB, `both pages show the same 4 digit number ("${confirmA}" and "${confirmB}")`);
  const spConfirmD = await ev(`return (document.querySelector('#krdSpConfirm .krd-sp-confirmno')||{innerText:''}).innerText;`);
  ok(spConfirmD.replace(/\s/g, "") === confirmA, "the number on page A matches the session number");
  await shot(`kardia-syncprobe-confirm-390-light`);
  await spClickS(sessionId, `document.querySelector('#krdSpConfirm [data-act=sp-confirm]')`);
  await spClickS(sidB, `document.querySelector('#krdSpConfirmP [data-act=sp-confirm]')`);
  ok(await until(`return KARDIA_SYNC.state().name==='connected';`, 15000), "page A connects after both confirm");
  ok(await untilS(sidB, `return KARDIA_SYNC.state().name==='connected';`, 15000), "page B connects after both confirm");
  ok(await until(`return (document.querySelectorAll('#krdScanLab #krdSyncPill button').length>0);`, 8000), "connected: the sheet closes and the pill appears above the Scan Lab monitor");
  const spPill = await ev(`return document.querySelector('#krdSyncPill').innerText;`);
  ok(/ms/.test(spPill || ""), `pill shows link latency ("${(spPill || "").trim()}")`);
  /* Same scale correction as the tab height check above: the app is
   * scaled down at phone widths, so divide the raw rect by the page's
   * effective scale (100px probe) before comparing with 44 CSS px. */
  const pillH = await ev(`return (function(){ var b = document.querySelector('#krdSyncPill button'); if (!b) return 0;
    var r = document.getElementById("smdKardia"); var scale = 1;
    try { var d = document.createElement("div");
      d.style.cssText = "position:fixed;top:0;left:0;width:100px;height:100px;padding:0;margin:0;border:0;visibility:hidden;pointer-events:none;";
      r.appendChild(d); var w = d.getBoundingClientRect().width; d.remove();
      if (w && w > 1) scale = w / 100; } catch (e) {}
    return b.getBoundingClientRect().height / scale; })()`);
  ok(pillH >= 44, `pill is a 44px target (${pillH}px CSS)`);
  ok(await until(`return !!document.getElementById('krdSpPaired') && document.getElementById('krdSpPaired').innerText.indexOf('Probe paired')>=0;`, 8000), "display shows the Probe paired state");
  ok((await ev(`return document.getElementById('krdRot').disabled && !!document.querySelector('#krdLab input[type=range]');`)) === true, "touch controls are disabled, not removed, while a remote controller is active");
  // Motion is asked only now, after pairing: denied offers touch, touch opens.
  await evS(sidB, `window.KARDIA_SYNCPROBE.openProbe(); window.__krdSpMotionForced = 'denied'; return 1;`);
  ok(await untilS(sidB, `return (document.getElementById('krdSpRoot')||{innerText:''}).innerText.indexOf('Allow motion')>=0;`, 8000), "after pairing the probe offers motion");
  await spClickS(sidB, `[...document.querySelectorAll('#krdSpRoot [data-act]')].find(b=>b.getAttribute('data-act')==='sp-motion')`);
  ok(await untilS(sidB, `return (document.getElementById('krdSpRoot')||{innerText:''}).innerText.indexOf('Motion is off')>=0;`, 8000), "denied motion explains and offers touch controls");
  await spClickS(sidB, `[...document.querySelectorAll('#krdSpRoot [data-act]')].find(b=>b.getAttribute('data-act')==='sp-touch')`);
  ok(await untilS(sidB, `return (document.getElementById('krdSpRoot')||{innerText:''}).innerText.indexOf('Touch controls')>=0;`, 8000), "touch fallback opens");
  await evS(sidB, `window.KARDIA_SYNCPROBE.openProbe(); return 1;`);
  // Scripted rotation from page B: DeviceOrientation events drive page A.
  // End-to-end latency is a step measurement: settle at the baseline, then
  // one scripted step (held, as a real sensor keeps firing at the new
  // attitude) and the time for the display tilt to cross half the step.
  // A slow ramp is not measured: it would count the ramp, not the link.
  ok((await evS(sidB, `return window.KARDIA_SYNCPROBE.isProbeRenderSuspended()===true;`)) === true, "probe page: entering probe mode suspends Echo Lab rendering");
  ok((await evS(sidB, `return !!(window.KARDIA_SCANLAB && KARDIA_SCANLAB.getLast() && KARDIA_SCANLAB.getLast().isSuspended()===true);`)) === true, "probe page: entering probe mode suspends Scan Lab 3D rendering");
  ok((await evS(sidB, `return KARDIA._kardia.echoLab.debug().rendererCreated===false && KARDIA._kardia.echoLab.debug().running===false;`)) === true, "probe page: no live renderer or render loop while it is the probe");
  await ev(BUSY_RESET); await evS(sidB, BUSY_RESET);
  await evS(sidB, `window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{alpha:0,beta:0,gamma:0})); return 1;`);
  await sleep(400);
  const tiltBefore = await ev(`return KARDIA._kardia.echoLab.getProbeState().tiltDeg;`);
  const scanPoseBefore = await ev(`return JSON.stringify(KARDIA_SCANLAB.getLast().getState().pose);`);
  const stepDeg = 25, halfTilt = tiltBefore + stepDeg / 2;
  const e2eStart = Date.now();
  let e2eMs = null;
  while (Date.now() - e2eStart < 5000) {
    await evS(sidB, `window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{alpha:0,beta:${stepDeg},gamma:0})); return 1;`);
    const tNow = await ev(`return KARDIA._kardia.echoLab.getProbeState().tiltDeg;`);
    if (tNow >= halfTilt) { e2eMs = Date.now() - e2eStart; break; }
    await sleep(10);
  }
  const tiltAfter = await ev(`return KARDIA._kardia.echoLab.getProbeState().tiltDeg;`);
  ok(e2eMs !== null && Math.abs(tiltAfter - tiltBefore) > 5, `page A probe state follows page B rotation within tolerance (tilt ${tiltBefore} to ${tiltAfter})`);
  const scanPoseAfter = await ev(`return JSON.stringify(KARDIA_SCANLAB.getLast().getState().pose);`);
  ok(scanPoseAfter !== scanPoseBefore, "page A Scan Lab 3D probe and image follow the paired phone pose");
  await sleep(1200);
  const rttA = await ev(`return KARDIA_SYNC.stats().rttMs;`);
  const rttB = await evS(sidB, `return KARDIA_SYNC.stats().rttMs;`);
  const busyA = await ev(BUSY_READ), busyB = await evS(sidB, BUSY_READ);
  console.log(`LATENCY loopback (BroadcastChannel between two pages, not a radio measurement): round trip page A ${rttA} ms, page B ${rttB} ms; end to end rotation to display ${e2eMs} ms`);
  console.log(`BUSY loopback: main-thread busy page A ${busyA} (ms/source/tasks), page B ${busyB} (ms/source/tasks)`);
  ok(typeof rttA === "number" && rttA >= 0 && typeof rttB === "number" && rttB >= 0, "loopback round trip is measured on both pages");
  ok(e2eMs !== null && e2eMs < 150, `loopback end to end latency is under 150 ms (${e2eMs} ms)`);
  await shot(`kardia-syncprobe-probe-active-390-light`);
  // Cut the link: page A freezes with no jump and shows the warning.
  const frozenPose = await ev(`return JSON.stringify(KARDIA._kardia.echoLab.getProbeState());`);
  await ev(`window.__KARDIA_SYNC_TEST_CUT__ = true; return 1;`);
  await evS(sidB, `window.__KARDIA_SYNC_TEST_CUT__ = true; return 1;`);
  ok(await until(`return KARDIA_SYNC.state().name==='reconnecting' && !!document.getElementById('krdSpLost');`, 10000), "cut link: page A shows the frozen warning banner");
  ok(/frozen/.test(await ev(`return document.getElementById('krdLab').innerText;`) || ""), "banner says the image is frozen");
  await evS(sidB, `window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{alpha:0,beta:-40,gamma:0})); return 1;`);
  await sleep(600);
  ok((await ev(`return JSON.stringify(KARDIA._kardia.echoLab.getProbeState());`)) === frozenPose, "page A stays frozen at the last pose with no jump while the link is cut");
  await shot(`kardia-syncprobe-lost-390-light`);
  // Resume: restore the loopback, then the explicit Reconnect action.
  await ev(`window.__KARDIA_SYNC_TEST_CUT__ = false; return 1;`);
  await evS(sidB, `window.__KARDIA_SYNC_TEST_CUT__ = false; return 1;`);
  await spClickS(sessionId, `document.querySelector('#krdSpLost [data-act=sp-reconnect]')`);
  ok(await until(`return KARDIA_SYNC.state().name==='connected' && !document.getElementById('krdSpLost');`, 10000), "Resume reconnects page A and clears the banner");
  await evS(sidB, `if (KARDIA_SYNC.state().name!=='connected') KARDIA_SYNC.reconnect(); return 1;`);
  await evS(sidB, `window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{alpha:0,beta:0,gamma:0})); return 1;`);
  await sleep(200);
  for (let i = 1; i <= 10; i++) { await evS(sidB, `window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{alpha:0,beta:${-Math.round(i * 2)},gamma:0})); return 1;`); await sleep(60); }
  await sleep(400);
  const tiltResumed = await ev(`return KARDIA._kardia.echoLab.getProbeState().tiltDeg;`);
  ok(Math.abs(tiltResumed - JSON.parse(frozenPose).tiltDeg) > 3, `after Resume, page A follows page B again (tilt ${tiltResumed})`);
  // Details on the display page.
  await spClickS(sessionId, `document.querySelector('#krdSyncPill button')`);
  ok(await until(`return (document.getElementById('krdSpRoot')||{innerText:''}).innerText.indexOf('Connection')>=0;`, 8000), "pill opens connection details");
  const spDet = await spTxtS(sessionId);
  for (const w of ["Link", "Delay", "Image rate", "Code expires", "Last error", "Links on this phone"]) ok(spDet.indexOf(w) >= 0, `details show ${w}`);
  await shot(`kardia-syncprobe-details-390-light`);
  await spClickS(sessionId, `[...document.querySelectorAll('#krdSpRoot [data-act]')].find(b=>b.getAttribute('data-act')==='sp-back')`);
  // Screenshots: pair sheet and probe screen at 390 and 820, light and dark.
  for (const [w, h] of [[390, 844], [820, 1180]]) {
    await metrics(w, h); await callS(sidB, "Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    for (const dark of [false, true]) {
      await theme(dark); await evS(sidB, `document.body.classList.toggle('dark', ${dark}); document.body.classList.toggle('v3-dark', ${dark}); return 1;`); await sleep(300);
      const th = dark ? "dark" : "light";
      await ev(`window.KARDIA_SYNCPROBE.openDisplay(); return 1;`);
      ok(await until(`return (document.getElementById('krdSpRoot')||{innerText:''}).innerText.indexOf('Pair a probe')>=0;`, 8000), `${w}px ${th}: pair sheet`);
      await shot(`kardia-syncprobe-pair-${w}-${th}`);
      await evS(sidB, `window.KARDIA_SYNCPROBE.openProbe(); return 1;`);
      ok(await untilS(sidB, `return /Probe session|Use this phone/.test((document.getElementById('krdSpRoot')||{innerText:''}).innerText);`, 8000), `${w}px ${th}: probe screen`);
      await shotS(sidB, `kardia-syncprobe-probe-${w}-${th}`);
      await ev(`window.KARDIA_SYNCPROBE.dismiss(); return 1;`);
      ok(await until(`return (document.querySelector('#krdScanLab #krdSyncPill')||{innerText:''}).innerText.length>0;`, 8000), `${w}px ${th}: pill above the Scan Lab monitor`);
      await shot(`kardia-syncprobe-pill-${w}-${th}`);
    }
  }
  // Leave no trace for the sections after this one.
  await evS(sidB, `window.KARDIA_SYNCPROBE.close(); KARDIA_SYNC.disconnect(); return 1;`);
  await ev(`window.KARDIA_SYNCPROBE.close(); KARDIA_SYNC.disconnect(); return 1;`);
  try { await call("Target.closeTarget", { targetId: targetB }); } catch {}
  ok(await until(`return (document.getElementById('krdSpRoot')||{innerText:''}).innerText === '';`, 8000), "SyncProbe UI closes cleanly");


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
  for (const [w, h] of VIEWPORTS) {
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
      qaGate(await qaRun(), `${w}px ${th}: case debrief QA gates`);
      await ev(`var a=document.querySelector('#smdKardia [data-act=kcase-list]'); if(a) a.click(); return 1;`); await sleep(300);
    }
  }

  /* ── 7. Practice (WP10): one drill, the exam, a protocol, knobology and a real clip panel.
   * The clip URL is stubbed to a local fixture so the test needs no network. Every width, light and dark. */
  console.log("\n--- Practice (WP10): drill, exam, protocol, real clip ---");
  await ev(`window.KARDIA_CLIPS_TEST_URL = "/test/fixtures/kardia-practice/clip.mp4"; return 1;`);
  for (const [w, h] of VIEWPORTS) {
    await metrics(w, h);
    for (const dark of [false, true]) {
      await theme(dark);
      const th = dark ? "dark" : "light";
      await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=practice]').click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia [data-pact="drills"]');`, 20000), `${w}px ${th}: Practice lists the WP10 drill sections`);
      /* View drill: start the A4C drill, set the shared Echo Lab probe to its target, hold, score. */
      await ev(`document.querySelector('#smdKardia [data-pact="drills"]').click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia [data-pact="drill-start"][data-v="tte_a4c"]');`, 20000), `${w}px ${th}: view drills list A4C at MBBS`);
      await ev(`document.querySelector('#smdKardia [data-pact="drill-start"][data-v="tte_a4c"]').click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia #krdpSector');`, 10000), `${w}px ${th}: drill opens with its sector and timer`);
      await ev(`(function(){var L=KARDIA._kardia.echoLab; L.setProbeState(L.stateForView('tte_a4c')); return 1;})()`);
      ok(await until(`return document.getElementById('smdKardia').innerText.indexOf('View achieved')>=0 && !!document.querySelector('#smdKardia [data-pact="drill-again"]');`, 20000), `${w}px ${th}: holding A4C on target finishes the drill with a score`);
      ok((await ev(`return (localStorage.getItem('smd_kardia_v1')||'').indexOf('kardia-view-tte_a4c')>=0;`)) === true, `${w}px ${th}: drill attempt and FSRS card recorded in the engine store`);
      await shot(`kardia-practice-drill-${w}-${th}`);
      qaGate(await qaRun(), `${w}px ${th}: practice drill QA gates`);
      /* Exam: five stations in order, each set to target, then the app marked report. */
      await ev(`document.querySelector('#smdKardia [data-pact="home"]').click(); return 1;`);
      await sleep(300);
      await ev(`document.querySelector('#smdKardia [data-pact="exam"]').click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia [data-pact="exam-start"]');`, 10000), `${w}px ${th}: exam intro lists the five stations`);
      await ev(`document.querySelector('#smdKardia [data-pact="exam-start"]').click(); return 1;`);
      for (let s = 0; s < 5; s++) {
        ok(await until(`return document.getElementById('smdKardia').innerText.indexOf('station ${s + 1} of 5')>=0;`, 15000), `${w}px ${th}: exam station ${s + 1} of 5 opens`);
        const vid = await ev(`return KARDIA_PRACTICE._state.exam.stations[KARDIA_PRACTICE._state.exam.i].id;`);
        await ev(`(function(){var L=KARDIA._kardia.echoLab; L.setProbeState(L.stateForView('${vid}')); return 1;})()`);
        ok(await until(`return KARDIA_PRACTICE._state.exam.achieved === true;`, 15000), `${w}px ${th}: exam station ${s + 1} achieved on target`);
        await ev(`document.querySelector('#smdKardia [data-pact="exam-next"]').click(); return 1;`);
        await sleep(350);
      }
      ok(await until(`return document.getElementById('smdKardia').innerText.indexOf('Exam report')>=0;`, 15000), `${w}px ${th}: exam ends with the app marked report`);
      await shot(`kardia-practice-exam-${w}-${th}`);
      qaGate(await qaRun(), `${w}px ${th}: practice exam QA gates`);
      /* Protocol: FAST end to end, one decision per step. */
      await ev(`document.querySelector('#smdKardia [data-pact="home"]').click(); return 1;`);
      await sleep(300);
      await ev(`document.querySelector('#smdKardia [data-pact="protocols"]').click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia [data-pact="proto-start"][data-v="fast"]');`, 20000), `${w}px ${th}: protocols list FAST`);
      await ev(`document.querySelector('#smdKardia [data-pact="proto-start"][data-v="fast"]').click(); return 1;`);
      for (let s = 0; s < 4; s++) {
        ok(await until(`return !!document.querySelector('#smdKardia [data-pact="proto-answer"]');`, 10000), `${w}px ${th}: FAST step ${s + 1} names its view and decision`);
        await ev(`document.querySelector('#smdKardia [data-pact="proto-answer"]').click(); return 1;`);
        ok(await until(`return !!document.querySelector('#smdKardia [data-pact="proto-next"]');`, 10000), `${w}px ${th}: FAST step ${s + 1} gives its explanation`);
        await ev(`document.querySelector('#smdKardia [data-pact="proto-next"]').click(); return 1;`);
        await sleep(300);
      }
      ok(await until(`return document.getElementById('smdKardia').innerText.indexOf('report')>=0;`, 10000), `${w}px ${th}: FAST ends with a timed report`);
      /* Knobology: fix the gain drill by setting the gain slider to target. */
      await ev(`document.querySelector('#smdKardia [data-pact="home"]').click(); return 1;`);
      await sleep(300);
      await ev(`document.querySelector('#smdKardia [data-pact="knobology"]').click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia [data-pact="knob-start"][data-v="gain-high"]');`, 10000), `${w}px ${th}: knobology lists the gain drill`);
      await ev(`document.querySelector('#smdKardia [data-pact="knob-start"][data-v="gain-high"]').click(); return 1;`);
      await ev(`(function(){var el=document.getElementById('krdpGain'); el.value='0'; el.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
      await ev(`document.querySelector('#smdKardia [data-pact="knob-check"]').click(); return 1;`);
      ok(await until(`return document.getElementById('smdKardia').innerText.indexOf('Image fixed')>=0;`, 10000), `${w}px ${th}: knobology passes when every knob is within tolerance`);
      /* Real clip panel: stubbed local fixture, attribution under the player. */
      await ev(`document.querySelector('#smdKardia [data-pact="home"]').click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia [data-pact="real-open"]') && !document.querySelector('#smdKardia [data-pact="real-open"]').disabled;`, 20000), `${w}px ${th}: Real patient compare is offered on Practice`);
      await ev(`document.querySelector('#smdKardia [data-pact="real-open"]').click(); return 1;`);
      ok(await until(`return !!document.querySelector('#smdKardia video.krdc-video');`, 20000), `${w}px ${th}: real clip panel shows a player`);
      ok((await ev(`return document.querySelector('#smdKardia video.krdc-video').getAttribute('src');`)) === "/test/fixtures/kardia-practice/clip.mp4", `${w}px ${th}: clip src is the local fixture (no network)`);
      ok((await ev(`return !!document.querySelector('#smdKardia .krdc-credit');`)) === true, `${w}px ${th}: attribution and licence sit under the clip`);
      await shot(`kardia-practice-clip-${w}-${th}`);
      qaGate(await qaRun(), `${w}px ${th}: practice clip QA gates`);
      ok(!/[–—]/.test(await ev(`return document.getElementById('smdKardia').innerText;`)), `${w}px ${th}: no em or en dash on the Practice screens`);
    }
  }

  /* ── 8. QA: reduced motion removes transitions (emulated, every width and theme) ── */
  console.log("\n--- QA: reduced motion ---");
  /* A computed duration at or below 0.01s is effectively zero (some engines report
     "transition: none" as 1e-06s rather than 0s); only a longer duration counts as
     a live transition. */
  const MOTION_JS = `return (function(){
    var out = { probes: [], rule: false };
    var sels = [".krd-root .krd-tab", ".krd-root .krd-chip", ".krd-root .krd-meter span", ".krd-root .kc-q", ".krd-root .kc-bar i", ".krd-root .krd-lab .sp-btn"];
    function maxDur(cs) { var m = 0; try { var parts = String(cs.transitionDuration || "0s").split(",");
      for (var d = 0; d < parts.length; d++) { var p = parts[d].replace(/^\\s+|\\s+$/g, ""); var v = parseFloat(p);
        if (isNaN(v)) continue; if (/ms$/i.test(p)) v = v / 1000; if (v > m) m = v; } } catch (e) {} return m; }
    for (var i = 0; i < sels.length; i++) { var el = document.querySelector(sels[i]); if (!el) continue;
      var cs = getComputedStyle(el);
      out.probes.push(sels[i] + " dur=" + cs.transitionDuration + " maxdur=" + maxDur(cs) + " anim=" + cs.animationName); }
    try {
      function scan(rules) { for (var q = 0; q < rules.length; q++) { var r = rules[q]; try {
        if (r.cssRules) { if (/prefers-reduced-motion/.test(r.conditionText || "") && /transition\\s*:\\s*none/.test(r.cssText)) out.rule = true; scan(r.cssRules); }
      } catch (e) {} } }
      for (var s = 0; s < document.styleSheets.length; s++) { try { if (document.styleSheets[s].cssRules) scan(document.styleSheets[s].cssRules); } catch (e) {} }
    } catch (e) {}
    return JSON.stringify(out);
  })()`;
  const motionStill = (probes) => (probes || []).filter((p) => {
    var m = /maxdur=([0-9.eE+-]+)/.exec(p || "");
    var dur = m ? parseFloat(m[1]) : 99;
    return !(dur <= 0.01) || !/anim=none/.test(p);
  });
  for (const [w, h] of VIEWPORTS) {
    await metrics(w, h);
    for (const dark of [false, true]) {
      await theme(dark);
      const th = dark ? "dark" : "light";
      await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=echo]').click(); return 1;`);
      await sleep(350);
      await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await sleep(200);
      const mo = JSON.parse((await ev(MOTION_JS)) || "{}");
      await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
      const still = motionStill(mo.probes);
      ok(mo.rule === true && still.length === 0, `${w}px ${th}: reduced motion kills transitions (rule=${mo.rule}; ${(mo.probes || []).join("; ") || "no probes"})`);
    }
  }
  /* One motion probe on a Cases screen too, so kardia-cases.css transitions are exercised live. */
  await metrics(1194, 834); await theme(false);
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=cases]').click(); return 1;`);
  ok(await until(`return document.querySelectorAll('#smdKardia [data-act=kcase-open]').length>=1;`, 15000), "1194px light: cases list for the motion probe");
  await ev(`document.querySelector('#smdKardia [data-act=kcase-open]').click(); return 1;`);
  await sleep(500);
  await ev(`var b=document.querySelector('#smdKardia [data-act=kcase-next]'); if(b) b.click(); return 1;`); await sleep(350);
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await sleep(200);
  const moCase = JSON.parse((await ev(MOTION_JS)) || "{}");
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  const stillCase = motionStill(moCase.probes);
  ok(moCase.rule === true && stillCase.length === 0, `1194px light: reduced motion on the case history screen (${(moCase.probes || []).join("; ") || "no probes"})`);
  await ev(`var a=document.querySelector('#smdKardia [data-act=kcase-list]'); if(a) a.click(); return 1;`); await sleep(300);

  /* ── 9. Full-case wording sweep: every step of the fixture case as rendered text ── */
  console.log("\n--- QA: full-case wording sweep ---");
  await metrics(390, 844); await theme(false);
  await ev(`document.querySelector('#smdKardia [data-act=ktab][data-t=cases]').click(); return 1;`);
  await until(`return document.querySelectorAll('#smdKardia [data-act=kcase-open]').length>=1;`, 15000);
  await ev(`document.querySelector('#smdKardia [data-act=kcase-open]').click(); return 1;`);
  await sleep(500);
  let fullText = "";
  for (let s = 0; s < 8; s++) {
    fullText += "\n" + ((await ev(`return document.getElementById('smdKardia').innerText;`)) || "");
    await ev(`var b=document.querySelector('#smdKardia [data-act=kcase-next]'); if(b) b.click(); return 1;`);
    await sleep(300);
  }
  await ev(`var a=document.querySelector('#smdKardia [data-act=kcase-list]'); if(a) a.click(); return 1;`); await sleep(300);
  const sweepDashes = (fullText.match(/[–—]/g) || []).length;
  const sweepWords = fullText.match(/\b(color|center|anemia|hemorrhage|esophageal|ischemia)\b/gi) || [];
  ok(sweepDashes === 0 && sweepWords.length === 0, `full fixture case text: no em/en dash or American spelling${sweepDashes ? " (" + sweepDashes + " dashes)" : ""}${sweepWords.length ? " (" + sweepWords.join(",") + ")" : ""}`);

  /* ── 5. Back OFF: the grid is byte-for-byte what it was ── */
  await ev(`KARDIA.close(); try{localStorage.setItem("smd_kardia","0");localStorage.removeItem("smd_home_tools");}catch(e){} return 1;`);
  await load(BASE);
  const gridBack = await ev(gridActs);
  ok(gridBack === gridOff, "flag back off: the Home grid is byte-for-byte what it was");
  ok(!/kardia/i.test(JSON.stringify(errors)), "no uncaught Kardia errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));

  console.log(fails === 0 ? "\nALL GREEN: Kardia wired into the app" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} process.exit(fails === 0 ? 0 : 1); }
