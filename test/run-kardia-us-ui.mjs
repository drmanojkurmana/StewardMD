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
const manifestJson = readFileSync(join(ROOT, "atlas", "3d", "manifest.json"), "utf8");
const liveJson = readFileSync(join(ROOT, "atlas", "3d", "live.json"), "utf8");
const chunkB64 = (name) => readFileSync(join(ROOT, "atlas", "3d", name)).toString("base64");
writeFileSync(join(ROOT, "work", "kardia-us-data.js"),
  "window.__KG_VIEWS=" + viewsJson.replace(/<\/script>/g, "<\\/script>") + ";\n" +
  "window.__KG_MANIFEST=" + manifestJson.replace(/<\/script>/g, "<\\/script>") + ";\n" +
  "window.__KG_LIVE=" + liveJson.replace(/<\/script>/g, "<\\/script>") + ";\n" +
  "window.__KG_CHUNKS_GZ_B64=" + JSON.stringify({
    "cardiac-6": chunkB64("cardiac-6.lo.bin.gz"),
    "skeletal-0": chunkB64("skeletal-0.lo.bin.gz"),
    "skeletal-1": chunkB64("skeletal-1.lo.bin.gz"),
    "live-respiratory": chunkB64("live-respiratory-9.7bb04126.bin.gz"),
    "live-digestive": chunkB64("live-digestive-2.58ac6651.bin.gz"),
  }) + ";\n");

writeFileSync(join(ROOT, "work", "kardia-us-harness.html"), `<!doctype html><meta charset="utf-8"><title>Kardia US harness</title>
<body style="margin:0;background:#000"><canvas id="cv"></canvas>
<script src="../atlas3d.js"></script>
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
    window.__gpuLegibility = function (viewId) {
      var snap = us.snapshot({ includeGrid: true });
      if (!snap.gpuGrid) return JSON.stringify({ error: "no gpuGrid (mode=" + snap.mode + ")" });
      var grid = snap.gpuGrid;
      var sub = function (a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; };
      var add = function (a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; };
      var mul = function (a, s) { return [a[0]*s, a[1]*s, a[2]*s]; };
      var dot = function (a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; };
      var cross = function (a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; };
      var norm = function (a) { var l = Math.hypot(a[0],a[1],a[2])||1; return a.map(function(x){return x/l;}); };
      var area = function (pts) { var a=0; for (var i=0;i<pts.length;i++){var j=(i+1)%pts.length; a+=pts[i][0]*pts[j][1]-pts[j][0]*pts[i][1];} return Math.abs(a/2); };
      var vp = geom.viewPlane(viewId);
      var n = norm(vp.normal), right = norm(cross(n, norm(vp.up))), up = norm(cross(right, n));
      var apex = us.getProbe().origin.slice(), beam = mul(up, -1);
      var polys = geom.cut(vp.origin, n, up, 272, 272);
      var lay = KARDIA_US._pure.layoutFor(grid.w, grid.h, us.getKnobs());
      function planeToWorld(cx, cy) { return add(vp.origin, add(mul(right, cx), mul(up, cy))); }
      function toDisplay(world) { var rel = sub(world, apex), depth = dot(rel, beam), lat = dot(rel, right); var ang = Math.atan2(lat, depth); return { x: Math.sin(ang)*depth, y: Math.cos(ang)*depth, depth: depth }; }
      function sampleAt(world, maxMode, radius) {
        var d = toDisplay(world);
        var gx = Math.round(lay.apexX + d.x*lay.scale), gy = Math.round(lay.apexY + d.y*lay.scale);
        var R = radius == null ? 1 : radius, sum=0, cnt=0, mx=0;
        for (var dy=-R; dy<=R; dy++) for (var dx=-R; dx<=R; dx++) { var x=gx+dx, y=gy+dy; if (x<0||y<0||x>=grid.w||y>=grid.h) continue; var v=grid.data[y*grid.w+x]; sum+=v; if (v>mx) mx=v; cnt++; }
        return maxMode ? mx/255 : (cnt ? sum/cnt/255 : 0);
      }
      function largest(ref) { var l = polys.filter(function(p){return p.ref===ref;}); if (!l.length) return null; return l.reduce(function(a,b){return area(b.points)>area(a.points)?b:a;}); }
      function centroidWorld(ref) { var p=largest(ref); if(!p) return null; var a=0,cx=0,cy=0,pts=p.points; for (var i=0;i<pts.length;i++){var j=(i+1)%pts.length; var f=pts[i][0]*pts[j][1]-pts[j][0]*pts[i][1]; a+=f; cx+=(pts[i][0]+pts[j][0])*f; cy+=(pts[i][1]+pts[j][1])*f;} if (Math.abs(a)<1e-6) return planeToWorld(p.centroid[0],p.centroid[1]); return planeToWorld(cx/(3*a), cy/(3*a)); }
      function interiorWorld(ref) {
        var p=largest(ref); if(!p) return null; var pts=p.points;
        var mnx=1e9,mxx=-1e9,mny=1e9,mxy=-1e9; pts.forEach(function(q){mnx=Math.min(mnx,q[0]);mxx=Math.max(mxx,q[0]);mny=Math.min(mny,q[1]);mxy=Math.max(mxy,q[1]);});
        function inside(x,y){var ins=false; for(var i=0,j=pts.length-1;i<pts.length;j=i++){var xi=pts[i][0],yi=pts[i][1],xj=pts[j][0],yj=pts[j][1]; if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi)) ins=!ins;} return ins;}
        function edgeDist(x,y){var m=1e9; for(var i=0;i<pts.length;i++){var a=pts[i],b=pts[(i+1)%pts.length]; var vx=b[0]-a[0],vy=b[1]-a[1]; var t=(vx*vx+vy*vy)>1e-9?Math.max(0,Math.min(1,((x-a[0])*vx+(y-a[1])*vy)/(vx*vx+vy*vy))):0; var dx=x-(a[0]+vx*t),dy=y-(a[1]+vy*t); m=Math.min(m,Math.sqrt(dx*dx+dy*dy));} return m;}
        var brightSegs=[]; for (var qi=0;qi<polys.length;qi++){var q=polys[qi]; if(q===p||!(q.acoustic.echogenicity>=0.75&&!q.acoustic.isAir)) continue; for(var si=0;si+1<q.points.length;si++) brightSegs.push([q.points[si],q.points[si+1]]);}
        function brightDist(x,y){var m=1e9; for(var bi=0;bi<brightSegs.length;bi++){var a=brightSegs[bi][0],b=brightSegs[bi][1]; var vx=b[0]-a[0],vy=b[1]-a[1]; var t=(vx*vx+vy*vy)>1e-9?Math.max(0,Math.min(1,((x-a[0])*vx+(y-a[1])*vy)/(vx*vx+vy*vy))):0; var dx=x-(a[0]+vx*t),dy=y-(a[1]+vy*t); m=Math.min(m,Math.sqrt(dx*dx+dy*dy));} return m;}
        var best=null,bd=-1;
        for (var x=mnx+2;x<mxx-2;x+=2) for (var y=mny+2;y<mxy-2;y+=2){ if(!inside(x,y)||brightDist(x,y)<3.5) continue; var d=edgeDist(x,y); if(d>bd){bd=d;best=[x,y];} }
        if(!best){ for (var x2=mnx+2;x2<mxx-2;x2+=2) for (var y2=mny+2;y2<mxy-2;y2+=2){ if(!inside(x2,y2)) continue; var d2=edgeDist(x2,y2); if(d2>bd){bd=d2;best=[x2,y2];} } }
        return best ? planeToWorld(best[0],best[1]) : centroidWorld(ref);
      }
      function septumWorld() {
        var lvP=largest("FJ2422"), rvP=largest("FJ2423"); if(!lvP||!rvP) return null;
        var a=lvP.centroid, b=rvP.centroid;
        function insideRef(ref,x,y){var p=largest(ref); if(!p) return false; var pts=p.points,ins=false; for(var i=0,j=pts.length-1;i<pts.length;j=i++){var xi=pts[i][0],yi=pts[i][1],xj=pts[j][0],yj=pts[j][1]; if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi)) ins=!ins;} return ins;}
        var gap=[];
        for (var t=0.05;t<0.95;t+=0.02){ var x=a[0]+(b[0]-a[0])*t, y=a[1]+(b[1]-a[1])*t; if(insideRef("FJ2422",x,y)||insideRef("FJ2423",x,y)) continue; var inBlood=false; for(var pi=0;pi<polys.length;pi++){ if(!polys[pi].acoustic.isBlood) continue; var pts2=polys[pi].points,ins2=false; for(var i2=0,j2=pts2.length-1;i2<pts2.length;j2=i2++){var xi2=pts2[i2][0],yi2=pts2[i2][1],xj2=pts2[j2][0],yj2=pts2[j2][1]; if(((yi2>y)!==(yj2>y))&&(x<(xj2-xi2)*(y-yi2)/(yj2-yi2)+xi2)) ins2=!ins2;} if(ins2){inBlood=true;break;} } if(!inBlood) gap.push([x,y]); }
        if(!gap.length) return null;
        var runs=[[gap[0]]]; for(var gi=1;gi<gap.length;gi++){var prev=runs[runs.length-1],last=prev[prev.length-1]; if(Math.hypot(gap[gi][0]-last[0],gap[gi][1]-last[1])<3) prev.push(gap[gi]); else runs.push([gap[gi]]); }
        runs.sort(function(a2,b2){return b2.length-a2.length;}); var mid=runs[0][Math.floor(runs[0].length/2)]; return planeToWorld(mid[0],mid[1]);
      }
      function deepestLoopPoint(ref, toward, pullMm) { var p=largest(ref); if(!p) return null; var best=null,bd=-1e18; for(var i=0;i<p.points.length;i++){var pt=p.points[i]; var d=toDisplay(planeToWorld(pt[0],pt[1])); if(d.y>bd){bd=d.y;best=pt;}} var w0=planeToWorld(best[0],best[1]); var dir=norm(sub(toward,w0)); return add(w0, mul(dir,pullMm)); }
      var out = { mode: snap.mode, gpuBloodMean: snap.gpuBloodMean, gpuMyoMean: snap.gpuMyoMean, gpuBrightMean: snap.gpuBrightMean, cpuBloodMean: snap.bloodMean, cpuMyoMean: snap.myoMean, cpuBrightMean: snap.brightMean, brightCount: snap.brightCount, cavities: {}, septum: null, posteriorWall: null, leaflet: null, pericardium: null, aorticLumen: null, brightDark: [] };
      if (snap.grid) { for (var ci = 0; ci < snap.grid.data.length && out.brightDark.length < 24; ci++) { if (snap.grid.data[ci] > 178 && grid.data[ci] < 76) out.brightDark.push([ci % grid.w, Math.floor(ci / grid.w), snap.grid.data[ci], grid.data[ci]]); } }
      ["FJ2422","FJ2423","FJ2424","FJ2425"].forEach(function(ref){ var w=interiorWorld(ref); if(w) out.cavities[ref]=sampleAt(w); });
      var aoW = centroidWorld("FJ3413") || centroidWorld("aortic_root"); if (aoW) out.aorticLumen = sampleAt(aoW, false, 0);
      var sw = centroidWorld("ventricular_septum_mid") || centroidWorld("interventricular_septum");
      if (viewId === "tte_a4c") sw = septumWorld() || sw;
      if (sw) out.septum = sampleAt(sw);
      var lvW = centroidWorld("FJ2422");
      if (lvW) { var pw = deepestLoopPoint("FJ2428", lvW, 4); if (pw) out.posteriorWall = sampleAt(pw); var peri = deepestLoopPoint("pericardium", lvW, 1); if (peri) out.pericardium = sampleAt(peri, true); }
      var leafPolys = polys.filter(function(p){return p.ref==="FJ2420";});
      if (leafPolys.length) { var ext=function(p){var xs=p.points.map(function(q){return q[0];}),ys=p.points.map(function(q){return q[1];}); return Math.max(Math.max.apply(null,xs)-Math.min.apply(null,xs), Math.max.apply(null,ys)-Math.min.apply(null,ys));}; var leaf=leafPolys.reduce(function(a,b){return ext(b)>ext(a)?b:a;}); out.leaflet = sampleAt(planeToWorld(leaf.centroid[0], leaf.centroid[1]), true); }
      return JSON.stringify(out);
    };
    window.__cellInfo = function (viewId, gx, gy) {
      var sub = function (a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; };
      var add = function (a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; };
      var mul = function (a, s) { return [a[0]*s, a[1]*s, a[2]*s]; };
      var dot = function (a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; };
      var cross = function (a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; };
      var norm = function (a) { var l = Math.hypot(a[0],a[1],a[2])||1; return a.map(function(x){return x/l;}); };
      var vp = geom.viewPlane(viewId);
      var n = norm(vp.normal), right = norm(cross(n, norm(vp.up))), up = norm(cross(right, n));
      var apex = us.getProbe().origin.slice(), beam = mul(up, -1);
      var lay = KARDIA_US._pure.layoutFor(176, 132, us.getKnobs());
      var dx = (gx-lay.apexX)/lay.scale, dy = (gy-lay.apexY)/lay.scale;
      var depth = Math.hypot(dx, dy), ang = Math.atan2(dx, dy);
      var dir = add(mul(beam, Math.cos(ang)), mul(right, Math.sin(ang)));
      var w = add(apex, mul(dir, depth)), rel = sub(w, vp.origin);
      var cx = dot(rel, right), cy = dot(rel, up);
      var polys = geom.cut(vp.origin, n, up, 272, 272);
      function pip(x, y, pts) { var ins=false; for (var i=0,j=pts.length-1;i<pts.length;j=i++){var xi=pts[i][0],yi=pts[i][1],xj=pts[j][0],yj=pts[j][1]; if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi)) ins=!ins;} return ins; }
      function segD(x, y, a, b) { var vx=b[0]-a[0], vy=b[1]-a[1]; var t=(vx*vx+vy*vy)>1e-9?Math.max(0,Math.min(1,((x-a[0])*vx+(y-a[1])*vy)/(vx*vx+vy*vy))):0; var ddx=x-(a[0]+vx*t), ddy=y-(a[1]+vy*t); return Math.sqrt(ddx*ddx+ddy*ddy); }
      var hits = polys.filter(function(p){return pip(cx,cy,p.points);}).map(function(p){ var xs=p.points.map(function(q){return q[0];}), ys=p.points.map(function(q){return q[1];}); var ar=(Math.max.apply(null,xs)-Math.min.apply(null,xs))*(Math.max.apply(null,ys)-Math.min.apply(null,ys)); return p.ref+"|"+p.kind+"|ech"+p.acoustic.echogenicity+"|area"+ar.toFixed(0); });
      var near = [];
      polys.forEach(function(p){ if (!(p.acoustic.echogenicity>=0.75 && !p.acoustic.isAir) && p.kind!=="chordae") return; var m=1e9; for (var i=0;i+1<p.points.length;i++) m=Math.min(m, segD(cx,cy,p.points[i],p.points[i+1])); if (m<4) near.push(p.ref+"|"+p.kind+" d="+m.toFixed(2)); });
      return JSON.stringify({ depth: depth, angDeg: ang*57.3, plane: [cx, cy], hits: hits, nearBright: near });
    };
    window.__loadReal = async function () {
      var load = null;
      try { load = await geom.loadAtlas({ systems: ["cardiac", "skeletal", "respiratory", "digestive"] }); } catch (e) { load = null; }
      if (!load || !load.parts) {
        geom.ingestManifest(window.__KG_MANIFEST);
        var wanted = [];
        window.__KG_MANIFEST.lod.chunks.forEach(function (c) { if (c.id === "cardiac-6" || c.id === "skeletal-0" || c.id === "skeletal-1") wanted.push([c, window.__KG_CHUNKS_GZ_B64[c.id]]); });
        window.__KG_LIVE.chunks.forEach(function (c) { if (c.system === "respiratory") wanted.push([c, window.__KG_CHUNKS_GZ_B64["live-respiratory"]]); if (c.system === "digestive") wanted.push([c, window.__KG_CHUNKS_GZ_B64["live-digestive"]]); });
        var added = 0;
        for (var wi = 0; wi < wanted.length; wi++) {
          var bin = atob(wanted[wi][1]), bytes = new Uint8Array(bin.length);
          for (var bi = 0; bi < bin.length; bi++) bytes[bi] = bin.charCodeAt(bi);
          var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
          var raw = await new Response(stream).arrayBuffer();
          added += geom.ingestChunk(wanted[wi][0], raw);
        }
        load = { parts: geom.loadedParts().length, added: added, fallback: true };
      }
      window.__load = load;
      return JSON.stringify(load);
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
  // real-mesh mode: load the BodyParts3D atlas the same way the
  // geometry runner does, then render every target view from the
  // real anatomy (shots kardia-us-real-*.png)
  const REAL_VIEWS = [["tte_plax", "PLAX"], ["tte_psax_av", "PSAX-AV"], ["tte_psax_papillary", "PSAX-papillary"], ["tte_a4c", "A4C"], ["tte_a2c", "A2C"], ["tte_a3c", "A3C"], ["tte_subcostal_4c", "subcostal-4C"], ["tte_subcostal_ivc", "IVC"]];
  const loadRes = await call("Runtime.evaluate", { expression: `window.__loadReal()`, awaitPromise: true, returnByValue: true });
  const load = JSON.parse(loadRes.result && loadRes.result.result ? loadRes.result.result.value : "{}");
  console.log("  atlas load: " + JSON.stringify(load));
  ok(load.parts >= 15, `real-mesh mode: BodyParts3D parts loaded (${load.parts})`);
  const GPU_CAVITIES = {
    tte_plax: ["FJ2422", "FJ2423", "FJ2425"], tte_psax_av: ["FJ2423", "FJ2424"],
    tte_psax_papillary: ["FJ2422", "FJ2423"], tte_a4c: ["FJ2422", "FJ2423", "FJ2425", "FJ2424"],
    tte_a2c: ["FJ2422"], tte_a3c: ["FJ2422", "FJ2425"],
    tte_subcostal_4c: ["FJ2422", "FJ2423", "FJ2425", "FJ2424"], tte_subcostal_ivc: ["FJ2424"],
  };
  for (const width of [390, 820]) {
    for (const [viewId, label] of REAL_VIEWS) {
      const snap = JSON.parse(await ev(`return window.__setView(${JSON.stringify(viewId)}, ${width}, ${Math.round(width * 0.8)});`) || "{}");
      const fr = JSON.parse(await ev(`return window.__frame(200, true);`) || "{}");
      frameTimes.push(fr.ms);
      console.log(`  real ${label} @${width}: blood=${snap.bloodMean?.toFixed(3)} myo=${snap.myoMean?.toFixed(3)} mean=${fr.snap?.mean?.toFixed(3)} bN=${snap.bloodCount} mN=${snap.myoCount} ms=${fr.ms?.toFixed(1)} mode=${fr.snap?.mode}`);
      ok(fr.ok && fr.errors && fr.errors.length === 0, `real ${label} @${width} renders without errors`);
      ok(snap.bloodCount > 0 && snap.myoCount > 0, `real ${label} @${width} samples blood and myocardium`);
      ok(snap.bloodMean < snap.myoMean, `real ${label} @${width} blood pools darker than myocardium (${snap.bloodMean?.toFixed(3)} < ${snap.myoMean?.toFixed(3)})`);
      ok(snap.bloodMean >= 0.02 && snap.bloodMean <= 0.10, `real ${label} @${width} blood in 0.02..0.10 (${snap.bloodMean?.toFixed(3)})`);
      ok(snap.myoMean >= 0.30 && snap.myoMean <= 0.55, `real ${label} @${width} myocardium in 0.30..0.55 (${snap.myoMean?.toFixed(3)})`);
      if (fr.png) { const p = join(SHOTS, `kardia-us-real-${label}-${width}.png`); writeFileSync(p, Buffer.from(fr.png, "base64")); console.log("   shot: " + p); }
      else ok(false, `real ${label} @${width} screenshot present`);
      // GPU legibility: sample the rendered WebGL canvas (snapshot
      // gpuGrid, readPixels of the display pass) at the projected
      // structure points for every real view, plus GPU/CPU parity.
      if (width === 390) {
        const leg = JSON.parse(await ev(`return window.__gpuLegibility(${JSON.stringify(viewId)});`) || "{}");
        console.log(`  gpu-leg ${label}: ` + JSON.stringify(leg));
        if (process.env.CELL_DEBUG && leg.brightDark) for (const [bx, by] of leg.brightDark.slice(0, 6)) console.log(`  cell ${label} ${bx},${by}: ` + (await ev(`return window.__cellInfo(${JSON.stringify(viewId)}, ${bx}, ${by});`)));
        ok(!leg.error && leg.mode === "webgl", `gpu-leg ${label} GPU grid available (mode=${leg.mode}) ${leg.error || ""}`);
        if (!leg.error) {
          for (const ref of GPU_CAVITIES[viewId] || []) {
            const b = leg.cavities[ref];
            ok(typeof b === "number" && b <= 0.12, `gpu-leg ${label} ${ref} cavity <= 0.12 (${b?.toFixed?.(3)})`);
          }
          if (viewId === "tte_plax" || viewId === "tte_a3c") ok(typeof leg.aorticLumen === "number" && leg.aorticLumen <= 0.12, `gpu-leg ${label} aortic lumen <= 0.12 (${leg.aorticLumen?.toFixed?.(3)})`);
          if (["tte_plax", "tte_a4c", "tte_psax_papillary"].includes(viewId)) ok(typeof leg.septum === "number" && leg.septum >= 0.25 && leg.septum <= 0.65, `gpu-leg ${label} septum in band (${leg.septum?.toFixed?.(3)})`);
          if (["tte_plax", "tte_a4c"].includes(viewId)) ok(typeof leg.posteriorWall === "number" && leg.posteriorWall >= 0.25 && leg.posteriorWall <= 0.6, `gpu-leg ${label} posterior wall in 0.25..0.6 (${leg.posteriorWall?.toFixed?.(3)})`);
          if (["tte_plax", "tte_a4c", "tte_a2c"].includes(viewId)) ok(typeof leg.leaflet === "number" && leg.leaflet >= 0.6, `gpu-leg ${label} mitral leaflet >= 0.6 (${leg.leaflet?.toFixed?.(3)})`);
          if (["tte_plax", "tte_a4c"].includes(viewId)) ok(typeof leg.pericardium === "number" && leg.pericardium >= 0.6, `gpu-leg ${label} pericardium >= 0.6 (${leg.pericardium?.toFixed?.(3)})`);
          ok(Math.abs(leg.gpuBloodMean - leg.cpuBloodMean) <= 0.08, `gpu/cpu ${label} blood means agree within 0.08 (gpu ${leg.gpuBloodMean?.toFixed?.(3)} vs cpu ${leg.cpuBloodMean?.toFixed?.(3)})`);
          ok(Math.abs(leg.gpuMyoMean - leg.cpuMyoMean) <= 0.08, `gpu/cpu ${label} myocardium means agree within 0.08 (gpu ${leg.gpuMyoMean?.toFixed?.(3)} vs cpu ${leg.cpuMyoMean?.toFixed?.(3)})`);
          if (leg.brightCount > 20) ok(Math.abs(leg.gpuBrightMean - leg.cpuBrightMean) <= 0.08, `gpu/cpu ${label} bright means agree within 0.08 (gpu ${leg.gpuBrightMean?.toFixed?.(3)} vs cpu ${leg.cpuBrightMean?.toFixed?.(3)})`);
        }
      }
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
  // multi-frame timing stability (real-mesh mode, A4C @390):
  // 60 consecutive frames, recording render ms and image mean.
  await ev(`return window.__setView("tte_a4c", 390, 312);`);
  const stabMs = [], stabMean = [];
  let stabOk = true;
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    const fr = JSON.parse(await ev(`return window.__frame(16, false);`) || "{}");
    if (!fr.ok || !fr.snap) stabOk = false;
    stabMs.push(fr.ms); stabMean.push(fr.snap ? fr.snap.mean : 0);
  }
  const stabSorted = stabMs.slice().sort((a, b) => a - b);
  const stabMedian = stabSorted[Math.floor(stabSorted.length / 2)];
  const stabP95 = stabSorted[Math.min(stabSorted.length - 1, Math.floor(stabSorted.length * 0.95))];
  const stabMax = stabSorted[stabSorted.length - 1];
  const meanOf = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const stabMeanAvg = meanOf(stabMean);
  const stabMeanMin = Math.min(...stabMean), stabMeanMax = Math.max(...stabMean);
  console.log(`  timing stability 60f A4C real: renderMs median=${stabMedian?.toFixed(2)} p95=${stabP95?.toFixed(2)} max=${stabMax?.toFixed(2)} wallMs=${Date.now() - t0}; imageMean avg=${stabMeanAvg?.toFixed(3)} range=[${stabMeanMin?.toFixed(3)}, ${stabMeanMax?.toFixed(3)}] (SwiftShader; render ms excludes CDP round trip)`);
  ok(stabOk && stabMs.length === 60, "timing stability: all 60 frames render");
  ok(stabMedian > 0 && stabMedian < 40, `timing stability: median frame < 40 ms (${stabMedian?.toFixed(2)})`);
  ok(stabP95 < Math.max(60, stabMedian * 4), `timing stability: p95 bounded (${stabP95?.toFixed(2)} vs median ${stabMedian?.toFixed(2)})`);
  ok(stabMax < 150, `timing stability: no frame over 150 ms (${stabMax?.toFixed(2)})`);
  ok(stabMeanMax - stabMeanMin < 0.08, `timing stability: image mean stable over 60 frames (range ${(stabMeanMax - stabMeanMin)?.toFixed(3)})`);
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
