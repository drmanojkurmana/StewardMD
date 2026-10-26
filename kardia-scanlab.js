/* kardia-scanlab.js - Kardia Scan Lab (Kardia 2.0, round 4).
 *
 * Design contract (anti-ui-slop Operate; impeccable Operate; apple-design
 * springs and interruptible drag; mobile-native safe areas, 44px targets;
 * animate and emil-design-eng: transform and opacity only, interruptible;
 * web-design-guidelines: focus rings, contrast, 390px and 820px):
 * purpose: find the target echo view by moving a real 3D probe on a WebGL
 * body, with live coaching above the monitor, readouts, and a monitor that
 * shows the KARDIA_US simulated cut off target and the real patient clip
 * on target. Layout follows Probe Lab: iPad landscape has the body scene
 * left and the monitor right with the coaching line above it and the view
 * picker by window under the monitor; phone portrait stacks body, monitor,
 * then the picker within thumb reach. Tokens: only Kardia tokens from
 * kardia.css; no new palette, no glow backdrop, no banner. States:
 * loading (real asset progress, ends in the rendered body or a specific
 * error with Retry within 10 s), ready, empty (no clip for a view, said
 * once), error (Retry), offline (cached body and clips keep working),
 * long text (names, coaching and attribution wrap), reduced motion
 * (springs and crossfade instant), low power (merged geometry, no
 * shadows, pixel ratio capped). British spelling; no em or en dashes.
 */
(function (G) {
  "use strict";

  /* ---------------- pure helpers (node tested) ---------------- */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function wrapDeg(d) { var x = d % 360; if (x > 180) x -= 360; if (x < -180) x += 360; return x; }
  function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function mul3(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm3(a) { var l = Math.sqrt(dot3(a, a)) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function rot3(v, axis, deg) {
    var a = norm3(axis), t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), cr = cross3(a, v);
    var d = dot3(a, v);
    return [v[0] * c + cr[0] * s + a[0] * d * (1 - c), v[1] * c + cr[1] * s + a[1] * d * (1 - c), v[2] * c + cr[2] * s + a[2] * d * (1 - c)];
  }
  function poseError(pose, target) {
    if (!pose || !target) return null;
    return {
      rotationDeg: wrapDeg((target.rotationDeg || 0) - (pose.rotationDeg || 0)),
      fanDeg: (target.fanDeg || 0) - (pose.fanDeg || 0),
      rockDeg: (target.rockDeg || 0) - (pose.rockDeg || 0),
      slideMm: Math.sqrt(Math.pow((target.contact[0] || 0) - (pose.contact ? pose.contact[0] : 0), 2) +
        Math.pow((target.contact[2] || 0) - (pose.contact ? pose.contact[2] : 0), 2)),
      depthCm: (target.depthCm || 16) - (pose.depthCm || 16)
    };
  }
  function withinTolerance(err, target) {
    if (!err || !target) return false;
    var t = target.tolerance;
    return Math.abs(err.rotationDeg) <= t.rotationDeg && Math.abs(err.fanDeg) <= t.fanDeg &&
      Math.abs(err.rockDeg) <= t.rockDeg && err.slideMm <= t.slideMm && Math.abs(err.depthCm) <= t.depthCm;
  }
  function coachText(err, target) {
    if (!err || !target) return "Choose a view to begin.";
    var t = target.tolerance;
    if (withinTolerance(err, target)) return "That is the view. Hold still and let the clip settle.";
    if (err.slideMm > t.slideMm) {
      if (err.slideMm > 28) return "Make a smaller grip movement; the contact point is not aligned yet";
      return target.family === "subcostal" ? "Slide under the costal margin toward the midline" :
        target.family === "suprasternal" ? "Settle the probe into the suprasternal notch" :
        "Slide toward the feet and the patient's right";
    }
    if (Math.abs(err.rotationDeg) > t.rotationDeg)
      return err.rotationDeg > 0 ? "Rotate clockwise" : "Rotate anticlockwise";
    if (Math.abs(err.fanDeg) > t.fanDeg)
      return err.fanDeg > 0 ? "Fan the tail away from the feet a little" : "Fan the tail toward the feet a little";
    if (Math.abs(err.rockDeg) > t.rockDeg)
      return err.rockDeg > 0 ? "Rock the probe toward the sternum" : "Rock the probe away from the sternum";
    if (Math.abs(err.depthCm) > t.depthCm)
      return err.depthCm > 0 ? "Increase the depth a little" : "Reduce the depth a little";
    return "Nearly there. Make the smallest movement you can.";
  }
  function createCoach(holdMs) {
    var shown = "", pending = "", pendingSince = 0;
    return {
      update: function (text, nowMs) {
        if (!shown) { shown = text; return shown; }
        if (text === shown) { pending = ""; return shown; }
        if (text !== pending) { pending = text; pendingSince = nowMs; return shown || text; }
        if (nowMs - pendingSince >= (holdMs || 450)) { shown = text; pending = ""; }
        return shown;
      },
      current: function () { return shown; },
      reset: function () { shown = ""; pending = ""; }
    };
  }
  function scoreAttempt(a) {
    a = a || {};
    var timeS = Math.max(0, (a.timeMs || 0) / 1000);
    var timeScore = clamp(100 - Math.max(0, timeS - 8) * 2.2, 35, 100);
    var eff = a.travelMm > 0 ? clamp((a.idealMm || 0) / a.travelMm, 0, 1) : 1;
    var angle = Math.abs(a.finalAngleDeg || 0);
    var angleScore = clamp(100 - angle * 6, 0, 100);
    var total = Math.round(0.35 * timeScore + 0.35 * eff * 100 + 0.30 * angleScore);
    return { total: total, timeScore: Math.round(timeScore), efficiency: Math.round(eff * 100),
      angleScore: Math.round(angleScore), timeS: Math.round(timeS * 10) / 10 };
  }
  function springStep(state, targetPos, dt, stiff, damp) {
    var k = stiff || 170, c = damp || 26, out = { x: 0, v: 0 };
    var f = -k * (state.x - targetPos) - c * state.v;
    out.v = state.v + f * dt; out.x = state.x + out.v * dt; return out;
  }
  var TUTORIAL = [
    { id: "grip", title: "Grip: slide on the skin", body: "Grip: drag the round grip to slide the probe along the skin. The probe stays on the body while you slide. The contact point leads; rotation and tilt follow it." },
    { id: "marker", title: "Marker: turn the probe", body: "Marker: drag the blue dashed ring around the probe to rotate it. The marker dot on the monitor turns with it, so the left of the screen stays matched to the marker side." },
    { id: "tilt", title: "Tail: fan and rock", body: "Tail: keep the grip still and move the tail. Up and down fans the beam through the heart; side to side rocks it. Small tail movements change the cut a lot." },
    { id: "depth", title: "Set the depth", body: "Use the depth control so the structure of interest sits in the middle of the sector, with a little room beyond it." },
    { id: "orbit", title: "Look around the body", body: "Drag empty skin to orbit the body. Use two fingers to zoom. Double tap resets the view. The layer control switches between skin, glass and anatomy." },
    { id: "target", title: "Find the ghost", body: "The pale ghost probe shows the target pose. Match the contact point first, then the rotation, then the fan and rock." },
    { id: "hold", title: "Hold the view", body: "When the readouts sit inside their target ranges, hold still. The real patient clip for that view appears on the monitor." }
  ];
  var BODY_CREDITS = [
    { file: "skin-visible-human-male.glb", title: "Visible Human male skin", author: "HuBMAP Consortium, Human Reference Atlas (Visible Human Project, U.S. National Library of Medicine)", licence: "CC BY 4.0", licenceUrl: "https://creativecommons.org/licenses/by/4.0/", sourceUrl: "https://humanatlas.io/3d-reference-library" },
    { file: "heart-hubmap.glb", title: "Visible Human male heart, valves and chambers", author: "HuBMAP Consortium, Human Reference Atlas (Visible Human Project, U.S. National Library of Medicine)", licence: "CC BY 4.0", licenceUrl: "https://creativecommons.org/licenses/by/4.0/", sourceUrl: "https://humanatlas.io/3d-reference-library" },
    { file: "liver-hubmap.glb", title: "Visible Human male liver", author: "HuBMAP Consortium, Human Reference Atlas (Visible Human Project, U.S. National Library of Medicine)", licence: "CC BY 4.0", licenceUrl: "https://creativecommons.org/licenses/by/4.0/", sourceUrl: "https://humanatlas.io/3d-reference-library" },
    { file: "great-vessels-bodyparts3d.bin.gz", title: "Great vessels and arterial system", author: "BodyParts3D, Database Center for Life Science (DBCLS)", licence: "CC BY-SA 2.1 JP", licenceUrl: "https://creativecommons.org/licenses/by-sa/2.1/jp/", sourceUrl: "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/" },
    { file: "bones-thorax-bodyparts3d.bin.gz", title: "Thorax bones: ribs, sternum, clavicles and spine", author: "BodyParts3D, Database Center for Life Science (DBCLS)", licence: "CC BY-SA 2.1 JP", licenceUrl: "https://creativecommons.org/licenses/by-sa/2.1/jp/", sourceUrl: "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/" }
  ];
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function bodyCreditsHtml() {
    return '<ul class="krdc-credits">' + BODY_CREDITS.map(function (c) {
      return '<li><b>' + esc(c.title) + '</b> <span>' + esc(c.author) + '</span> <a href="' + esc(c.licenceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(c.licence) + '</a> <a href="' + esc(c.sourceUrl) + '" target="_blank" rel="noopener noreferrer">Source</a></li>';
    }).join("") + "</ul>";
  }

  /* -------- asset URLs: local worktree first on the web build, the R2
   * atlas host (the kardia-sim-geom.js asset base) as the device path.
   * Round 1 tried /k2-assets first (404) and never wired completion. */
  function assetCandidates(opts) {
    opts = opts || {};
    if (opts.assetBase) return [opts.assetBase.replace(/\/$/, "") + "/k2-assets/manifest.json"];
    if (opts.manifestUrl) return [opts.manifestUrl];
    if (opts.native) return ["https://models.stewardmd.in/atlas3d/k2-assets/manifest.json", "/work/k2-assets/manifest.json"];
    return ["/work/k2-assets/manifest.json", "/k2-assets/manifest.json", "https://models.stewardmd.in/atlas3d/k2-assets/manifest.json"];
  }
  function assetFileUrl(manifestUrl, file) { return manifestUrl.replace(/manifest\.json.*$/, "") + file; }

  /* Pure JS SHA-256 (WebCrypto is missing on non-secure contexts, which
   * silently killed every round 1 asset). Input: Uint8Array. */
  function sha256Hex(bytes) {
    var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    function rr(x, n) { return (x >>> n) | (x << (32 - n)); }
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var len = bytes.length, total = (((len + 9 + 63) >> 6) << 6), msg = new Uint8Array(total);
    msg.set(bytes); msg[len] = 0x80;
    var dv = new DataView(msg.buffer);
    dv.setUint32(total - 4, (len * 8) >>> 0); dv.setUint32(total - 8, Math.floor(len / 0x20000000));
    var w = new Int32Array(64), i, j, t;
    for (i = 0; i < total; i += 64) {
      for (t = 0; t < 16; t++) w[t] = dv.getInt32(i + t * 4);
      for (t = 16; t < 64; t++) { var s0 = rr(w[t-15],7) ^ rr(w[t-15],18) ^ (w[t-15] >>> 3); var s1 = rr(w[t-2],17) ^ rr(w[t-2],19) ^ (w[t-2] >>> 10); w[t] = (w[t-16] + s0 + w[t-7] + s1) | 0; }
      var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rr(e,6) ^ rr(e,11) ^ rr(e,25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[t] + w[t]) | 0;
        var S0 = rr(a,2) ^ rr(a,13) ^ rr(a,22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) | 0;
        h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
      }
      H = [(H[0]+a)|0,(H[1]+b)|0,(H[2]+c)|0,(H[3]+d)|0,(H[4]+e)|0,(H[5]+f)|0,(H[6]+g)|0,(H[7]+h)|0];
    }
    return H.map(function (x) { return ("0000000" + (x >>> 0).toString(16)).slice(-8); }).join("");
  }

  var HUBMAP_CENTRE = [0.0187, 0.4761, 0.0376];
  function registerPoint(pt, centre) {
    var c = centre || HUBMAP_CENTRE;
    return [(pt[0] - c[0]) * 1000, (pt[2] - c[2]) * 1000, (pt[1] - c[1]) * 1000];
  }
  /* Atlas chunk descriptors for the two .bin.gz k2 assets (layout from
   * atlas/3d/manifest.json: Float32 pos, Int16 nrm, Uint16 pid, Uint32 idx). */
  var ATLAS_ORG = [0.03836, 1.29592, 0.02246];
  var ATLAS_CHUNKS = {
    "bones-thorax-bodyparts3d.bin.gz": { v: 113953, i: 418434, pos: 0, nrm: 1367436, pid: 2051156, idx: 2279064, rawBytes: 3952800 },
    "great-vessels-bodyparts3d.bin.gz": { v: 101732, i: 481926, pos: 0, nrm: 1220784, pid: 1831176, idx: 2034640, rawBytes: 3962344 }
  };
  function parseGlb(buf) {
    var dv = new DataView(buf), len = dv.getUint32(8, true), off = 12, json = null, bin = null;
    while (off + 8 <= len && off + 8 <= buf.byteLength) {
      var clen = dv.getUint32(off, true), ctype = dv.getUint32(off + 4, true); off += 8;
      if (ctype === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off, clen)));
      else if (ctype === 0x004E4942) bin = new Uint8Array(buf, off, clen);
      off += clen;
    }
    if (!json || !bin) throw new Error("bad glb: missing JSON or BIN chunk");
    if (!json.meshes || !json.meshes.length) throw new Error("bad glb: no meshes");
    function accArr(idx) {
      var a = json.accessors[idx], bv = json.bufferViews[a.bufferView];
      var o = (bv.byteOffset || 0) + (a.byteOffset || 0);
      var n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type] || 1;
      var stride = bv.byteStride && bv.byteStride !== n * (a.componentType === 5126 ? 4 : a.componentType === 5125 ? 4 : 2) ? bv.byteStride : 0;
      var out, i, c, base = bin.byteOffset + o;
      if (a.componentType === 5126) { out = new Float32Array(a.count * n); for (i = 0; i < a.count; i++) for (c = 0; c < n; c++) out[i*n+c] = dv.getFloat32(base + (stride ? i*stride + c*4 : (i*n+c)*4), true); }
      else if (a.componentType === 5125) { out = new Uint32Array(a.count * n); for (i = 0; i < a.count; i++) for (c = 0; c < n; c++) out[i*n+c] = dv.getUint32(base + (stride ? i*stride + c*4 : (i*n+c)*4), true); }
      else if (a.componentType === 5123) { out = new Uint16Array(a.count * n); for (i = 0; i < a.count; i++) for (c = 0; c < n; c++) out[i*n+c] = dv.getUint16(base + (stride ? i*stride + c*2 : (i*n+c)*2), true); }
      else throw new Error("bad glb: unsupported componentType " + a.componentType);
      return out;
    }
    var posList = [], nrmList = [], idxList = [], voff = 0;
    json.meshes.forEach(function (m) { (m.primitives || []).forEach(function (pr) {
      var pp = accArr(pr.attributes.POSITION), nn = pr.attributes.NORMAL != null ? accArr(pr.attributes.NORMAL) : null;
      var i;
      for (i = 0; i < pp.length; i += 3) { var rp = registerPoint([pp[i], pp[i+1], pp[i+2]]); posList.push(rp[0], rp[1], rp[2]); if (nn) nrmList.push(nn[i+2], nn[i], nn[i+1]); }
      var count = pp.length / 3;
      if (!nn) for (i = 0; i < count; i++) nrmList.push(0, 1, 0);
      var ii = pr.indices != null ? accArr(pr.indices) : null;
      if (ii) for (i = 0; i < ii.length; i++) idxList.push(ii[i] + voff);
      else for (i = 0; i < count; i++) idxList.push(i + voff);
      voff += count;
    }); });
    /* positions stays an array of [x,y,z] points (the round 1 shape the
     * cut helper and tests use); positionsFlat is for WebGL upload. */
    var pts = [], i2;
    for (i2 = 0; i2 < posList.length; i2 += 3) pts.push([posList[i2], posList[i2+1], posList[i2+2]]);
    return { positions: pts, positionsFlat: new Float32Array(posList), normalsFlat: new Float32Array(nrmList),
      normals: new Float32Array(nrmList), indices: new Uint32Array(idxList), vertexCount: voff };
  }
  function meshPositionsArray(mesh) {
    if (mesh.positions && mesh.positions.length && typeof mesh.positions[0] === "number") {
      var out = [], i; for (i = 0; i < mesh.indices.length; i++) out.push(null);
      var list = [];
      for (i = 0; i < mesh.positions.length; i += 3) list.push([mesh.positions[i], mesh.positions[i+1], mesh.positions[i+2]]);
      return list;
    }
    return mesh.positions || [];
  }
  function parseAtlasChunk(raw, file) {
    var desc = ATLAS_CHUNKS[file];
    if (!desc) throw new Error("no atlas chunk layout for " + file);
    if (raw.byteLength !== desc.rawBytes) throw new Error("atlas chunk " + file + " decompressed to " + raw.byteLength + " bytes, expected " + desc.rawBytes);
    var posF = new Float32Array(raw, desc.pos, desc.v * 3);
    var nrmI = new Int16Array(raw, desc.nrm, desc.v * 3);
    var idxU = new Uint32Array(raw, desc.idx, desc.i);
    var pos = new Float32Array(desc.v * 3), nrm = new Float32Array(desc.v * 3), i;
    for (i = 0; i < desc.v; i++) {
      pos[i*3] = (posF[i*3] - ATLAS_ORG[0]) * 1000;
      pos[i*3+1] = (posF[i*3+2] - ATLAS_ORG[2]) * 1000;
      pos[i*3+2] = (posF[i*3+1] - ATLAS_ORG[1]) * 1000;
      nrm[i*3] = nrmI[i*3] / 32767; nrm[i*3+1] = nrmI[i*3+2] / 32767; nrm[i*3+2] = nrmI[i*3+1] / 32767;
    }
    return { positions: pos, normals: nrm, indices: idxU, vertexCount: desc.v };
  }
  function cutTriangles(mesh, origin, normal, up) {
    var positions = meshPositionsArray(mesh), indices = mesh.indices;
    var nl = Math.sqrt(dot3(normal, normal)) || 1, n = [normal[0]/nl, normal[1]/nl, normal[2]/nl];
    var right = cross3(n, up), rl = Math.sqrt(dot3(right, right)) || 1; right = [right[0]/rl, right[1]/rl, right[2]/rl];
    var up2 = cross3(right, n), segs = [], i, k;
    for (i = 0; i + 2 < indices.length; i += 3) {
      var pts = [positions[indices[i]], positions[indices[i+1]], positions[indices[i+2]]];
      if (!pts[0] || !pts[1] || !pts[2]) continue;
      var d = pts.map(function (pt) { return dot3(sub3(pt, origin), n); }), hits = [];
      for (k = 0; k < 3; k++) {
        var a = pts[k], b = pts[(k+1)%3], da = d[k], db = d[(k+1)%3];
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) { var t = da / (da - db); hits.push([a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]); }
      }
      if (hits.length >= 2) segs.push(hits.slice(0, 2).map(function (pt) { var r = sub3(pt, origin); return [dot3(r, right), dot3(r, up2)]; }));
    }
    return segs;
  }
  /* Probe plane from a Scan Lab pose. At the target pose this returns the
   * target plane exactly (so the cut shows the target view); off target
   * the beam fans and rocks away from it and the origin follows contact. */
  function planeFromPose(pose, target, targetPlane) {
    var beam, marker, origin;
    if (targetPlane && targetPlane.normal && targetPlane.up) {
      beam = mul3(norm3(targetPlane.up), -1);
      marker = norm3(cross3(beam, norm3(targetPlane.normal)));
      var dFan = (pose.fanDeg || 0) - (target.fanDeg || 0), dRock = (pose.rockDeg || 0) - (target.rockDeg || 0);
      var lateral = norm3(cross3(marker, beam));
      beam = norm3(rot3(rot3(beam, marker, dFan), lateral, dRock));
      origin = add3(targetPlane.origin, sub3(pose.contact, target.contact));
    } else {
      var rad = (pose.rotationDeg || 0) * Math.PI / 180;
      marker = [Math.sin(rad), 0, Math.cos(rad)];
      beam = norm3(sub3([0, 40, 10], pose.contact));
      beam = norm3(rot3(rot3(beam, marker, pose.fanDeg || 0), norm3(cross3(marker, beam)), pose.rockDeg || 0));
      origin = pose.contact.slice();
    }
    var normal = norm3(cross3(marker, beam));
    return { origin: origin, normal: normal, up: mul3(beam, -1), beam: beam, marker: marker };
  }
  function ptTriDist(p, a, b, c) {
    var ab = sub3(b, a), ac = sub3(c, a), ap = sub3(p, a);
    var d1 = dot3(ab, ap), d2 = dot3(ac, ap);
    function distTo(q) { var d = sub3(p, q); return Math.sqrt(dot3(d, d)); }
    if (d1 <= 0 && d2 <= 0) return distTo(a);
    var bp = sub3(p, b), d3 = dot3(ab, bp), d4 = dot3(ac, bp);
    if (d3 >= 0 && d4 <= d3) return distTo(b);
    var vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { var v = d1 / (d1 - d3); return distTo(add3(a, mul3(ab, v))); }
    var cp = sub3(p, c), d5 = dot3(ab, cp), d6 = dot3(ac, cp);
    if (d6 >= 0 && d5 <= d6) return distTo(c);
    var vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { var w = d2 / (d2 - d6); return distTo(add3(a, mul3(ac, w))); }
    var va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { var w2 = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return distTo(add3(b, mul3(sub3(c, b), w2))); }
    var den = 1 / (va + vb + vc), vv = vb * den, ww = vc * den;
    return distTo(add3(a, add3(mul3(ab, vv), mul3(ac, ww))));
  }
  function skinDistanceMm(mesh, point) {
    var positions = meshPositionsArray(mesh), indices = mesh.indices, best = Infinity, i;
    for (i = 0; i + 2 < indices.length; i += 3) {
      var a = positions[indices[i]], b = positions[indices[i + 1]], c = positions[indices[i + 2]];
      if (!a || !b || !c) continue;
      var d = ptTriDist(point, a, b, c); if (d < best) best = d;
    }
    return best;
  }
  function inLandmark(contact, family, landmarks) {
    var r = landmarks && landmarks[family]; if (!r || !contact) return false;
    return contact[0] >= r.x[0] && contact[0] <= r.x[1] && contact[2] >= r.z[0] && contact[2] <= r.z[1];
  }
  /* Beat scale from the cardiac cycle: contraction through systole
   * (first 35 percent), then refill. 1 at end diastole. */
  function heartBeatScale(cycle01) {
    var t = ((cycle01 % 1) + 1) % 1;
    if (t < 0.35) return 1 - 0.045 * Math.sin(Math.PI * t / 0.35);
    return 0.985 + 0.015 * Math.sin(Math.PI * (t - 0.35) / 0.65);
  }
  /* Great vessels and coronaries as curved patient-frame paths (mm).
   * No straight vertical tubes: the aorta ascends, arches posteriorly
   * and to the left, then descends behind the heart. */
  var HEART_VESSELS = {
    aorta: [[4, 0, 14], [7, -2, 36], [3, -10, 52], [-13, -19, 50], [-23, -21, 30], [-21, -18, -8], [-18, -15, -44]],
    pulmonaryTrunk: [[20, 20, 8], [12, 10, 30], [-6, 0, 40], [-24, -6, 36]],
    svc: [[-17, -9, 30], [-16, -11, 52], [-14, -12, 78]],
    ivc: [[-15, -5, -30], [-14, -6, -52], [-10, -4, -76]],
    pulmonaryVeins: [[[-4, -34, 24], [-28, -44, 32], [-48, -46, 30]], [[-2, -34, 4], [-26, -46, 0], [-46, -48, -4]], [[8, -32, 22], [30, -42, 30], [48, -44, 26]], [[10, -30, 2], [32, -42, -2], [48, -44, -6]]],
    coronaryLAD: [[13, 24, 24], [12, 30, 4], [10, 28, -16], [7, 20, -36]],
    coronaryRCA: [[24, 16, 20], [34, 8, 2], [30, -8, -20], [16, -16, -32]],
    coronaryCx: [[4, 2, 28], [-18, -4, 20], [-34, -8, 2], [-38, -14, -16]]
  };
  var WINDOWS = [
    { id: "parasternal", label: "Parasternal", views: ["plax", "rv_inflow", "rv_outflow"] },
    { id: "psax", label: "Short axis", views: ["psax_av", "psax_mv", "psax_pm", "psax_apex"] },
    { id: "apical", label: "Apical", views: ["a4c", "a5c", "a2c", "a3c"] },
    { id: "subcostal", label: "Subcostal", views: ["subcostal_4c", "ivc", "abdominal_aorta"] },
    { id: "suprasternal", label: "Suprasternal", views: ["suprasternal_arch"] }
  ];
  function windowForView(id) { for (var i = 0; i < WINDOWS.length; i++) if (WINDOWS[i].views.indexOf(id) >= 0) return WINDOWS[i].id; return "parasternal"; }
  /* Drawn icon per view: a small sector with the structure that names it. */
  function viewIcon(id) {
    var inner = {
      plax: '<path d="M14 6 L30 34 M14 6 L46 34" stroke-width="1.6"/><ellipse cx="30" cy="26" rx="9" ry="6"/>',
      rv_inflow: '<path d="M14 6 L30 34 M14 6 L46 34" stroke-width="1.6"/><ellipse cx="24" cy="24" rx="6" ry="8"/>',
      rv_outflow: '<path d="M14 6 L30 34 M14 6 L46 34" stroke-width="1.6"/><path d="M30 14 q8 6 4 14"/>',
      psax_av: '<circle cx="30" cy="22" r="9"/><path d="M30 13 v18 M21 22 h18"/>',
      psax_mv: '<circle cx="30" cy="22" r="10"/><path d="M20 22 q10 -7 20 0"/>',
      psax_pm: '<circle cx="30" cy="22" r="10"/><circle cx="26" cy="22" r="2.4"/><circle cx="34" cy="22" r="2.4"/>',
      psax_apex: '<circle cx="30" cy="22" r="6"/>',
      a4c: '<path d="M30 6 L14 36 M30 6 L46 36" stroke-width="1.6"/><ellipse cx="24" cy="24" rx="5" ry="8"/><ellipse cx="36" cy="24" rx="5" ry="8"/>',
      a5c: '<path d="M30 6 L14 36 M30 6 L46 36" stroke-width="1.6"/><ellipse cx="30" cy="22" rx="6" ry="9"/><circle cx="30" cy="10" r="3"/>',
      a2c: '<path d="M30 6 L14 36 M30 6 L46 36" stroke-width="1.6"/><ellipse cx="30" cy="24" rx="7" ry="10"/>',
      a3c: '<path d="M30 6 L14 36 M30 6 L46 36" stroke-width="1.6"/><ellipse cx="26" cy="24" rx="6" ry="9"/><path d="M34 12 l6 -4"/>',
      subcostal_4c: '<path d="M10 16 Q30 8 50 16 L44 36 Q30 42 16 36 Z"/><ellipse cx="30" cy="26" rx="7" ry="6"/>',
      ivc: '<path d="M28 38 L28 14 M28 14 q10 -6 14 2"/><ellipse cx="40" cy="24" rx="5" ry="6"/>',
      abdominal_aorta: '<path d="M26 6 L26 38 M34 6 L34 38"/><circle cx="30" cy="22" r="3"/>',
      suprasternal_arch: '<path d="M14 36 Q14 12 30 12 Q46 12 46 36"/><path d="M22 13 l-2 -6 M30 12 V6 M38 13 l2 -6"/>'
    }[id] || '<circle cx="30" cy="22" r="9"/>';
    return '<svg viewBox="0 0 60 44" width="44" height="32" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' + inner + "</svg>";
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([promise, new Promise(function (_, rej) { setTimeout(function () { rej(new Error(label + " timed out after " + ms + " ms")); }, ms); })]);
  }
  function decompressGzip(buf, deps) {
    deps = deps || {};
    if (deps.decompress) return Promise.resolve(deps.decompress(buf));
    if (typeof DecompressionStream !== "undefined" && typeof Blob !== "undefined" && typeof Response !== "undefined") {
      return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    }
    return Promise.reject(new Error("gzip decode is not available on this device"));
  }
  /* Load and verify every manifest asset. Resolves with the meshes even
   * when one asset fails (the error is listed); rejects only when no
   * manifest can be fetched at all. */
  function loadAssets(deps) {
    deps = deps || {};
    var fetchImpl = deps.fetch || (typeof fetch !== "undefined" ? fetch : null);
    if (!fetchImpl) return Promise.reject(new Error("fetch is not available"));
    var urls = deps.manifestUrls || assetCandidates(deps);
    var timeoutMs = deps.timeoutMs || 8000;
    function fetchBuf(url) {
      return withTimeout(Promise.resolve(fetchImpl(url)).then(function (r) {
        if (!r || !r.ok) throw new Error(url + " returned " + (r ? r.status : "no response"));
        return r.arrayBuffer();
      }), timeoutMs, url);
    }
    function tryManifest(i) {
      if (i >= urls.length) throw new Error("manifest not found at " + urls.join(", "));
      return withTimeout(Promise.resolve(fetchImpl(urls[i])).then(function (r) {
        if (!r || !r.ok) throw new Error(urls[i] + " returned " + (r ? r.status : "no response"));
        return r.json();
      }), timeoutMs, urls[i]).then(function (man) { return { manifest: man, manifestUrl: urls[i] }; }, function () { return tryManifest(i + 1); });
    }
    return tryManifest(0).then(function (found) {
      var man = found.manifest, meshes = {}, errors = [], list = man.assets || [], done = 0;
      return list.reduce(function (chain, a) {
        return chain.then(function () {
          return fetchBuf(assetFileUrl(found.manifestUrl, a.file)).then(function (buf) {
            if (buf.byteLength !== a.bytes) throw new Error(a.file + " is " + buf.byteLength + " bytes, manifest says " + a.bytes);
            var hex = sha256Hex(new Uint8Array(buf));
            if (hex !== a.sha256) throw new Error(a.file + " failed its sha256 check");
            if (/\.glb$/.test(a.file)) return parseGlb(buf);
            if (/\.bin\.gz$/.test(a.file)) return decompressGzip(buf, deps).then(function (raw) { return parseAtlasChunk(raw, a.file); });
            throw new Error(a.file + " has an unsupported format");
          }).then(function (mesh) {
            if (!mesh || !(mesh.vertexCount > 0)) throw new Error(a.file + " parsed with no vertices");
            meshes[a.file] = mesh;
          }).catch(function (e) { errors.push(String(e && e.message || e)); })
          .then(function () { done++; if (deps.onProgress) deps.onProgress(done, list.length, a.file); });
        });
      }, Promise.resolve()).then(function () {
        if (deps.onProgress) deps.onProgress(list.length, list.length, "");
        return { manifest: man, manifestUrl: found.manifestUrl, meshes: meshes, errors: errors };
      });
    });
  }

  var PURE = { clamp: clamp, wrapDeg: wrapDeg, poseError: poseError, withinTolerance: withinTolerance,
    coachText: coachText, createCoach: createCoach, scoreAttempt: scoreAttempt, springStep: springStep, TUTORIAL: TUTORIAL,
    BODY_CREDITS: BODY_CREDITS, bodyCreditsHtml: bodyCreditsHtml, assetCandidates: assetCandidates, assetFileUrl: assetFileUrl,
    registerPoint: registerPoint, parseGlb: parseGlb, cutTriangles: cutTriangles, HUBMAP_CENTRE: HUBMAP_CENTRE,
    sha256Hex: sha256Hex, ATLAS_CHUNKS: ATLAS_CHUNKS, ATLAS_ORG: ATLAS_ORG, parseAtlasChunk: parseAtlasChunk,
    planeFromPose: planeFromPose, skinDistanceMm: skinDistanceMm, inLandmark: inLandmark, heartBeatScale: heartBeatScale, HEART_VESSELS: HEART_VESSELS, WINDOWS: WINDOWS, windowForView: windowForView, viewIcon: viewIcon, loadAssets: loadAssets };

  /* ---------------- browser UI ---------------- */
  function haptic(kind) {
    try {
      var H = G.Capacitor && G.Capacitor.Plugins && G.Capacitor.Plugins.Haptics;
      if (H && H.impact) H.impact({ style: kind || "LIGHT" });
      else if (G.SMD_HAPTICS && G.SMD_HAPTICS.tap) G.SMD_HAPTICS.tap();
    } catch (e) {}
  }
  var threePromise = null;
  function loadThree(opts) {
    if (G.THREE) return Promise.resolve(G.THREE);
    if (opts && opts.THREE) return Promise.resolve(opts.THREE);
    if (threePromise) return threePromise;
    threePromise = new Promise(function (res, rej) {
      try {
        var s = G.document.createElement("script");
        s.src = (opts && opts.threeUrl) || "/kardia-vendor-three.min.js";
        s.onload = function () { G.THREE ? res(G.THREE) : rej(new Error("three.js loaded without THREE")); };
        s.onerror = function () { rej(new Error("three.js could not load from " + s.src)); };
        G.document.head.appendChild(s);
      } catch (e) { rej(e); }
    });
    return withTimeout(threePromise, 8000, "three.js");
  }
  /* Patient mm [x left, y anterior, z cranial] to three.js [x, z, -y]. */
  function toScene(p) { return [p[0], p[2], -p[1]]; }
  function skinY(x, z) { return 92 - 0.42 * z - Math.pow(Math.abs(x) / 170, 2) * 18; }

  function create(opts) {
    opts = opts || {};
    var doc = opts.doc || G.document;
    var root = opts.root;
    if (!root || !doc) return null;
    var T = opts.targets || G.KARDIA_SCAN_TARGETS;
    if (!T) { root.innerHTML = '<p class="ksl-note" role="alert">Scan Lab targets did not load. <button type="button" class="ksl-btn" id="kslRetry">Retry</button></p>'; return null; }
    var reduced = !!opts.reducedMotion;
    if (!reduced) try { reduced = G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    var lowPower = !!opts.lowPower;
    if (!lowPower) try { if (G.navigator && G.navigator.hardwareConcurrency && G.navigator.hardwareConcurrency <= 2) lowPower = true; } catch (e) {}
    var fetchImpl = opts.fetch || (G.fetch ? G.fetch.bind(G) : null);
    var rafImpl = opts.raf || (G.requestAnimationFrame ? G.requestAnimationFrame.bind(G) : function (fn) { return setTimeout(function () { fn((G.performance && G.performance.now) ? G.performance.now() : Date.now()); }, 16); });
    var cancelRaf = opts.cancelRaf || (G.cancelAnimationFrame ? G.cancelAnimationFrame.bind(G) : clearTimeout);
    var view = T.VIEWS[0], activeWindow = windowForView(view.id), layer = "skin", showLabels = false;
    var pathology = opts.pathology || null;
    var pose = { contact: [-30, 95, 70], rotationDeg: 40, fanDeg: 0, rockDeg: 0, depthCm: 16 };
    var orbit = { yaw: 2.6, pitch: 0.32, dist: 580 };
    function nowMs() { return (G.performance && G.performance.now) ? G.performance.now() : Date.now(); }
    var coach = createCoach(450), startedAt = nowMs(), travelMm = 0;
    var holdSince = 0, wasIn = false, attemptDone = false, raf = 0, destroyed = false;
    var realCine = null;
    try { if (G.KARDIA_ECHOLAB && G.KARDIA_ECHOLAB._pure && G.KARDIA_ECHOLAB._pure.createRealCine) realCine = G.KARDIA_ECHOLAB._pure.createRealCine({}); } catch (e) {}
    if (!realCine) realCine = { _s: "sim", _since: null, state: function () { return this._s; }, reset: function () { this._s = "sim"; this._since = null; }, update: function (inp, now) { if (this._s === "real") { if (!inp.withinTolerance) this._s = "sim"; return this._s; } if (inp.withinTolerance && inp.score >= 85) { if (this._since == null) this._since = now; if (now - this._since >= 500) this._s = "real"; } else this._since = null; return this._s; } };
    var realClip = null, realSrc = "", realStatus = "idle", realKey = "", offlineNoted = false, clipRequested = 0;
    var tutStep = 0, tutDone = false;
    try { tutDone = G.localStorage.getItem("ksl_tutorial_done") === "1"; } catch (e) {}
    var debug = { loadingState: "loading", manifestUrl: "", meshesRegistered: {}, drawCalls: 0, frames: 0, usCalls: 0, usCutPolys: -1, fps: 0, beatScale: 1, clipRequestedFor: "", realState: "sim", errors: [] };

    root.innerHTML =
      '<div class="ksl-wrap" id="kslWrap">' +
      '<section class="ksl-scene-col" aria-label="Body scene">' +
      '<div class="ksl-stage" id="kslStage">' +
      '<canvas id="kslScene" width="720" height="620" aria-label="3D body with probe on the skin. Drag the grip to slide, the marker dashes to rotate, the tail to fan and rock. Drag empty skin to orbit, pinch to zoom, double tap to reset."></canvas>' +
      '<div class="ksl-viewname"><h3 class="ksl-title" id="kslTargetName">' + esc(view.label) + '</h3>' +
      '<p class="ksl-sub" id="kslFamily">' + esc(view.family) + ' window</p></div>' +
      '<div class="ksl-load" id="kslLoading" role="status"><p class="ksl-note" id="kslLoadText">Loading Scan Lab.</p><div class="ksl-load-track"><span class="ksl-load-fill" id="kslLoadFill"></span></div><button type="button" class="ksl-btn" id="kslRetryLoad" hidden>Retry</button></div>' +
      '<div class="ksl-stage-btns">' +
      '<button type="button" class="ksl-iconbtn" id="kslPractice" aria-label="Practice this view"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg></button>' +
      '<button type="button" class="ksl-iconbtn" id="kslTutorialBtn" aria-label="Open the tutorial"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 5h11a3 3 0 0 1 3 3v11H8a3 3 0 0 1-3-3z"/><path d="M8 9h7M8 13h5"/></svg></button>' +
      '<button type="button" class="ksl-iconbtn" id="kslLayersBtn" aria-label="Body layers" aria-haspopup="true" aria-expanded="false"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/></svg></button>' +
      '<button type="button" class="ksl-iconbtn" id="kslLabels" aria-label="Toggle anatomy labels" aria-pressed="false"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 4h7l9 9-7 7-9-9z"/><circle cx="8" cy="8" r="1.6"/></svg></button>' +
      '<button type="button" class="ksl-iconbtn" id="kslFullscreen" aria-label="Full screen"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button></div>' +
      '<div class="ksl-layers" id="kslLayers" role="group" aria-label="Body layers" hidden>' +
      ["skin", "glass", "anatomy"].map(function (l) { return '<button type="button" class="ksl-chip" data-layer="' + l + '" aria-pressed="' + (l === layer) + '">' + l.charAt(0).toUpperCase() + l.slice(1) + '</button>'; }).join("") + '</div>' +
      '</div>' +
      '<div class="ksl-readouts" id="kslReadouts">' +
      [["Rotation", "kslRot"], ["Fan", "kslFan"], ["Rock", "kslRock"], ["Depth", "kslDepth"]].map(function (r) {
        return '<div class="ksl-read"><span>' + r[0] + '</span><strong id="' + r[1] + '">0 deg</strong><span class="ksl-range" id="' + r[1] + 'Range"></span></div>';
      }).join("") + '</div>' +
      '<label class="ksl-depth">Depth <span id="kslDepthVal">16 cm</span><input type="range" id="kslDepthRange" min="8" max="24" step="1" value="16" aria-label="Depth in centimetres"></label>' +
      '<div class="ksl-result" id="kslResult" hidden></div>' +
      '<div class="ksl-tut" id="kslTutorial" hidden></div>' +
      '</section>' +
      '<section class="ksl-monitor-col" aria-label="Monitor">' +
      '<p class="ksl-coach" id="kslCoach" role="status" aria-live="polite">Place the probe on the chest to begin.</p>' +
      '<div class="ksl-monitor-head"><p class="ksl-mon-label" id="kslMonLabel">Simulated image</p><p class="ksl-hr" id="kslHr" role="status"></p></div>' +
      '<div class="ksl-monitor-wrap" id="kslMonitorWrap">' +
      '<canvas id="kslMonitor" width="640" height="480" aria-label="Ultrasound monitor"></canvas>' +
      '<video id="kslReal" muted loop playsinline hidden aria-label="Real patient clip"></video>' +
      '<span class="ksl-badge" id="kslRealBadge" hidden>Real patient</span>' +
      '</div>' +
      '<p class="ksl-note" id="kslClipNote" role="status" hidden></p>' +
      '<details class="ksl-details" id="kslAttrDetails" hidden><summary>Clip details and credits</summary><p class="ksl-note" id="kslAttribution"></p></details>' +
      '<p class="ksl-fps" id="kslFps" role="status"></p>' +
      '<div class="ksl-pickerbar"><nav class="ksl-windows" id="kslWindows" aria-label="Windows">' +
      WINDOWS.map(function (w) { return '<button type="button" class="ksl-chip" data-window="' + w.id + '" id="kslWindow-' + w.id + '" aria-pressed="' + (w.id === activeWindow) + '">' + w.label + '</button>'; }).join("") + '</nav>' +
      '<div class="ksl-views" id="kslViews" role="group" aria-label="Views">' +
      T.VIEWS.map(function (v) {
        return '<button type="button" class="ksl-view" data-view="' + v.id + '" data-win="' + windowForView(v.id) + '" id="kslView-' + v.id + '" aria-pressed="' + (v.id === view.id) + '"><span class="ksl-icon" aria-hidden="true">' + viewIcon(v.id) + '</span><span>' + esc(v.label) + '</span></button>';
      }).join("") + '</div></div>' +
      '<p class="ksl-credit">Body: HuBMAP Human Reference Atlas (CC BY 4.0) and BodyParts3D (CC BY-SA 2.1 JP), decimated for mobile. Full credits in the Kardia credits list.</p>' +
      '</section></div>';

    function el(id) { return doc.getElementById(id); }
    /* The tutorial sits under the scene as a compact step card, never
     * over it, so it cannot hide the probe on first open. It stays in
     * the scene column flow below the depth control. */
    /* The found view result sits over the monitor, not in the scene
     * column flow, so scoring a view never shrinks the stage. */
    try { var res0 = el("kslResult"), monWrap0 = el("kslMonitorWrap"); if (res0 && monWrap0 && monWrap0.appendChild) monWrap0.appendChild(res0); } catch (e) {}
    /* Same for the offline and empty clip note: over the monitor, so it
     * never takes height from the sector. */
    try { var note0 = el("kslClipNote"), monWrap1 = el("kslMonitorWrap"); if (note0 && monWrap1 && monWrap1.appendChild) monWrap1.appendChild(note0); } catch (e) {}
    function setText(id, txt) { var n = el(id); if (n) n.textContent = txt; }
    var sceneCanvas = el("kslScene"), monCanvas = el("kslMonitor"), video = el("kslReal");

    /* ---- three.js scene ---- */
    var THREE = null, renderer = null, scene3 = null, camera = null;
    var parts = {}; /* skin, bones, heart, liver, vessels, probe, ghost, beam, labels */
    var skinVerts = [];
    var registered = {};
    function skinSurfaceY(x, z) {
      if (!skinVerts.length) return skinY(x, z);
      var best = [], i, dx, dz, d, j;
      for (i = 0; i < skinVerts.length; i++) {
        dx = skinVerts[i][0] - x; dz = skinVerts[i][2] - z; d = dx * dx + dz * dz;
        if (best.length < 4) { best.push([d, skinVerts[i][1]]); }
        else { var mi = 0; for (j = 1; j < 4; j++) if (best[j][0] > best[mi][0]) mi = j; if (d < best[mi][0]) best[mi] = [d, skinVerts[i][1]]; }
      }
      var num = 0, den = 0;
      for (i = 0; i < best.length; i++) { var w = 1 / (best[i][0] + 4); num += w * best[i][1]; den += w; }
      return den ? num / den : skinY(x, z);
    }
    function bufferGeom(mesh, filter) {
      var pos = mesh.positionsFlat || mesh.positions, nrm = mesh.normalsFlat || mesh.normals, idx = mesh.indices;
      if (pos && pos.length && typeof pos[0] !== "number") { /* point list */
        var flat = [], fi; for (fi = 0; fi < pos.length; fi++) flat.push(pos[fi][0], pos[fi][1], pos[fi][2]);
        pos = new Float32Array(flat);
      }
      var keep = null, remap = {}, outPos = [], outNrm = [], outIdx = [], i;
      if (filter) {
        for (i = 0; i + 2 < idx.length; i += 3) {
          var a = idx[i], b = idx[i+1], c = idx[i+2];
          var cx = (pos[a*3]+pos[b*3]+pos[c*3])/3, cy = (pos[a*3+1]+pos[b*3+1]+pos[c*3+1])/3, cz = (pos[a*3+2]+pos[b*3+2]+pos[c*3+2])/3;
          if (!filter(cx, cy, cz)) continue;
          [a, b, c].forEach(function (v) { if (remap[v] == null) { remap[v] = outPos.length / 3; outPos.push(pos[v*3], pos[v*3+1], pos[v*3+2]); outNrm.push(nrm[v*3], nrm[v*3+1], nrm[v*3+2]); } outIdx.push(remap[v]); });
        }
        if (!outIdx.length) return null;
        pos = new Float32Array(outPos); nrm = new Float32Array(outNrm); idx = new Uint32Array(outIdx);
      }
      /* patient to scene mapping per vertex */
      var sp = new Float32Array(pos.length), sn = new Float32Array(pos.length);
      for (i = 0; i < pos.length; i += 3) { sp[i] = pos[i]; sp[i+1] = pos[i+2]; sp[i+2] = -pos[i+1]; sn[i] = nrm[i]; sn[i+1] = nrm[i+2]; sn[i+2] = -nrm[i+1]; }
      var g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(sp, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(sn, 3));
      g.setIndex(new THREE.BufferAttribute(idx.length && idx.BYTES_PER_ELEMENT === 2 ? new Uint16Array(idx) : idx, 1));
      return g;
    }
    function mat(o) { return THREE.MeshStandardMaterial ? new THREE.MeshStandardMaterial(o) : new THREE.MeshBasicMaterial({ color: o.color }); }
    function phys(o) {
      if (THREE.MeshPhysicalMaterial) { try { return new THREE.MeshPhysicalMaterial(o); } catch (e) {} }
      return mat(o);
    }
    function tubeGeom(path, radius) {
      var pts = path.map(function (pt) { var sc = toScene(pt); return new THREE.Vector3(sc[0], sc[1], sc[2]); });
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(12, path.length * 6), radius, lowPower ? 6 : 8);
    }
    function tubeFromPath(path, radius, material, name) {
      var m = new THREE.Mesh(tubeGeom(path, radius), material);
      if (name) m.name = name; return m;
    }
    /* Merge static parts into one mesh (one draw call). Each part is
     * {geom, matrix, color}; colours ride in a vertex colour attribute.
     * Returns null when a geometry has no uploadable attributes (the
     * test double), and the caller falls back to separate meshes. */
    function mergedMesh(list, material, name) {
      try {
        var pos = [], nrm = [], col = [], pi, i;
        for (pi = 0; pi < list.length; pi++) {
          var g = list[pi].geom;
          if (!g || !g.attributes || !g.attributes.position) return null;
          var gg = g.index ? (g.toNonIndexed ? g.toNonIndexed() : null) : g;
          if (!gg || !gg.attributes || !gg.attributes.position) return null;
          if (list[pi].matrix && gg.applyMatrix4) gg.applyMatrix4(list[pi].matrix);
          var p = gg.attributes.position.array, n = gg.attributes.normal ? gg.attributes.normal.array : null;
          var c = new THREE.Color(list[pi].color);
          var cr = typeof c.r === "number" ? c.r : 1, cg = typeof c.g === "number" ? c.g : 1, cb = typeof c.b === "number" ? c.b : 1;
          for (i = 0; i < p.length; i += 3) { pos.push(p[i], p[i + 1], p[i + 2]); nrm.push(n ? n[i] : 0, n ? n[i + 1] : 1, n ? n[i + 2] : 0); col.push(cr, cg, cb); }
        }
        if (!pos.length) return null;
        var out = new THREE.BufferGeometry();
        out.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
        out.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(nrm), 3));
        out.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 3));
        var mesh = new THREE.Mesh(out, material);
        if (name) mesh.name = name;
        debug.mergedStatic = true;
        return mesh;
      } catch (e) { return null; }
    }
    function translation(x, y, z) { var m = new THREE.Matrix4(); if (m.makeTranslation) m.makeTranslation(x, y, z); return m; }
    function buildProbeMesh(ghost) {
      var bodyM = ghost ? new THREE.MeshBasicMaterial({ color: 0x9cc8e8, transparent: true, opacity: 0.35 }) : mat({ color: 0xe8e6df, roughness: 0.45, metalness: 0.05 });
      var darkM = ghost ? bodyM : mat({ color: 0x2b2e30, roughness: 0.6 });
      var pts = [];
      [[0, 0], [16, 0], [19, 5], [15, 16], [13, 34], [14, 58], [11, 78], [7, 88], [0, 90]].forEach(function (p) { pts.push(new THREE.Vector2(p[0], p[1])); });
      var cablePts = [new THREE.Vector3(0, 88, 0), new THREE.Vector3(6, 112, -8), new THREE.Vector3(22, 132, -26), new THREE.Vector3(48, 142, -40)];
      var bodyC = ghost ? 0x9cc8e8 : 0xe8e6df, darkC = ghost ? 0x9cc8e8 : 0x2b2e30;
      try {
        var partsList = [
          { geom: new THREE.LatheGeometry(pts, lowPower ? 20 : 32), color: bodyC },
          { geom: new THREE.CylinderGeometry(8, 9, 26, 20), matrix: translation(0, 62, 0), color: darkC },
          { geom: new THREE.BoxGeometry(4, 8, 3), matrix: translation(14, 10, 0), color: ghost ? 0x9cc8e8 : 0x2ea8e0 },
          { geom: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cablePts), 20, 3.2, 8), color: darkC }
        ];
        for (var di = 0; di < 8; di++) {
          var ang = di / 8 * Math.PI * 2;
          var dm = new THREE.Matrix4(); if (dm.makeRotationY) dm.makeRotationY(-ang); if (dm.setPosition) dm.setPosition(Math.cos(ang) * 17, 22, Math.sin(ang) * 17);
          partsList.push({ geom: new THREE.BoxGeometry(7, 2.2, 2.2), matrix: dm, color: ghost ? 0x9cc8e8 : (di % 2 ? 0x2ea8e0 : 0x17384d) });
        }
        var mergedMat = ghost ? new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35 }) : mat({ vertexColors: true, roughness: 0.45, metalness: 0.05 });
        var merged = mergedMesh(partsList, mergedMat, ghost ? "ghostProbe" : "probe");
        if (merged) { merged.userData.dashes = { rotation: { x: 0, y: 0, z: 0 } }; merged.userData.tail = merged; return merged; }
      } catch (e) {}
      var grp = new THREE.Group();
      var body = new THREE.Mesh(new THREE.LatheGeometry(pts, lowPower ? 20 : 32), bodyM); grp.add(body);
      var grip = new THREE.Mesh(new THREE.CylinderGeometry(8, 9, 26, 20), darkM); grip.position.y = 62; grp.add(grip);
      var notch = new THREE.Mesh(new THREE.BoxGeometry(4, 8, 3), ghost ? bodyM : mat({ color: 0x2ea8e0, roughness: 0.4 }));
      notch.position.set(14, 10, 0); grp.add(notch);
      var cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cablePts), 20, 3.2, 8), darkM); grp.add(cable);
      var dashes = new THREE.Group(); dashes.name = "markerDashes";
      for (var i = 0; i < 8; i++) {
        var d = new THREE.Mesh(new THREE.BoxGeometry(7, 2.2, 2.2), ghost ? bodyM : mat({ color: i % 2 ? 0x2ea8e0 : 0x17384d, roughness: 0.4 }));
        var ang2 = i / 8 * Math.PI * 2;
        d.position.set(Math.cos(ang2) * 17, 22, Math.sin(ang2) * 17); d.rotation.y = -ang2; dashes.add(d);
      }
      grp.add(dashes); grp.userData.dashes = dashes; grp.userData.tail = grip;
      return grp;
    }
    function labelSprite(text, pos) {
      var cv = doc.createElement("canvas"); cv.width = 256; cv.height = 64;
      var ctx = cv.getContext("2d"); if (ctx) { ctx.font = "600 30px system-ui"; ctx.fillStyle = "#eef3f1"; ctx.fillText(text, 8, 40); }
      var tex = new THREE.CanvasTexture(cv);
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      sp.position.set(pos[0], pos[1], pos[2]); sp.scale.set(70, 18, 1); sp.visible = false;
      return sp;
    }
    function buildScene(meshes) {
      THREE = THREE || G.THREE;
      if (!renderer) {
        renderer = new THREE.WebGLRenderer({ canvas: sceneCanvas, antialias: !lowPower, alpha: false, powerPreference: "high-performance" });
        debug.pixelRatio = Math.min((G.devicePixelRatio || 1), 2, lowPower ? 1.5 : 2);
        renderer.setPixelRatio(debug.pixelRatio);
        renderer.setSize(sceneCanvas.clientWidth || 720, sceneCanvas.clientHeight || 620, false);
        if (renderer.outputEncoding !== undefined && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
        if (renderer.toneMapping !== undefined && THREE.ACESFilmicToneMapping) { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; }
        if (renderer.shadowMap) renderer.shadowMap.enabled = !lowPower;
        camera = new THREE.PerspectiveCamera(36, (sceneCanvas.clientWidth || 720) / (sceneCanvas.clientHeight || 620), 1, 3000);
      }
      scene3 = new THREE.Scene();
      parts = {};
      if (THREE.Color) scene3.background = new THREE.Color(0x0b1116);
      if (THREE.Fog) scene3.fog = new THREE.Fog(0x0b1116, 750, 1450);
      if (THREE.HemisphereLight) scene3.add(new THREE.HemisphereLight(0xdfeaf2, 0x1c1712, 0.5));
      scene3.add(new THREE.AmbientLight(0xbfd0da, 0.28));
      var key = new THREE.DirectionalLight(0xfff2e2, 1.35); key.position.set(180, 320, -260); scene3.add(key);
      var fill = new THREE.DirectionalLight(0x9fb8cc, 0.42); fill.position.set(-260, 120, -140); scene3.add(fill);
      var rim = new THREE.DirectionalLight(0xcfe6ff, 0.65); rim.position.set(-80, 200, 300); scene3.add(rim);
      var grp = new THREE.Group(); scene3.add(grp); parts.root = grp;
      function addMesh(name, mesh, material, filter, renderOrder) {
        if (!mesh) return null;
        var g = bufferGeom(mesh, filter); if (!g) return null;
        var m = new THREE.Mesh(g, material); m.name = name; if (renderOrder) m.renderOrder = renderOrder;
        grp.add(m); registered[name] = mesh.vertexCount; debug.meshesRegistered[name] = mesh.vertexCount;
        return m;
      }
      parts.skin = addMesh("skin", meshes["skin-visible-human-male.glb"], phys({ color: 0xc79a7d, roughness: 0.58, metalness: 0, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false, sheen: 0.6, sheenColor: new THREE.Color(0xd98a6a), emissive: 0x1d0b06, emissiveIntensity: 0.35 }), null, 10);
      parts.bones = addMesh("bones", meshes["bones-thorax-bodyparts3d.bin.gz"], phys({ color: 0xe9e2cf, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.42, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.2 }),
        function (x, y, z) { return Math.abs(x) < 230 && y > -120 && y < 180 && z > -120 && z < 260; }, 5);
      parts.heartGroup = new THREE.Group(); parts.heartGroup.name = "heartBeat"; grp.add(parts.heartGroup);
      parts.heart = addMesh("heart", meshes["heart-hubmap.glb"], phys({ color: 0xa8322c, roughness: 0.3, metalness: 0.02, clearcoat: 0.65, clearcoatRoughness: 0.35, sheen: 0.4, sheenColor: new THREE.Color(0xe8a08a), emissive: 0x200604, emissiveIntensity: 0.4 }), null, 2);
      if (parts.heart) { if (grp.remove) grp.remove(parts.heart); parts.heartGroup.add(parts.heart); }
      parts.liver = addMesh("liver", meshes["liver-hubmap.glb"], phys({ color: 0x9c5f4a, roughness: 0.42, clearcoat: 0.4, clearcoatRoughness: 0.4, transparent: true, opacity: 0.92 }), null, 2);
      parts.vessels = addMesh("vessels", meshes["great-vessels-bodyparts3d.bin.gz"], mat({ color: 0xb0503f, roughness: 0.45, transparent: true, opacity: 0.75 }),
        function (x, y, z) { return Math.abs(x) < 130 && y > -90 && y < 150 && z > -50 && z < 170; }, 3);
      /* Procedural fallback and emphasis: ribs, aorta, cavae, so the body
       * reads even before atlas chunks arrive. */
      var fall = new THREE.Group(); fall.name = "fallback"; grp.add(fall); parts.fallback = fall;
      if (!parts.bones) {
        var boneM = mat({ color: 0xe8dbc1, roughness: 0.55, transparent: true, opacity: 0.6 });
        var ribParts = [], ribsMerged = null;
        try {
          for (var ri = 0; ri < (lowPower ? 7 : 11); ri++) {
            var rm = new THREE.Matrix4();
            var eu = new THREE.Euler ? new THREE.Euler(Math.PI / 2, 0, Math.PI * 0.87) : null;
            if (eu && rm.makeRotationFromEuler) rm.makeRotationFromEuler(eu);
            if (rm.setPosition) rm.setPosition(0, 118 - ri * 17, -55);
            ribParts.push({ geom: new THREE.TorusGeometry(88 - ri * 2, 3.2, 8, 40, Math.PI * 1.25), matrix: rm, color: 0xe8dbc1 });
          }
          ribParts.push({ geom: new THREE.BoxGeometry(16, 130, 6), matrix: translation(0, 55, 88), color: 0xe8dbc1 });
          ribsMerged = mergedMesh(ribParts, mat({ vertexColors: true, roughness: 0.55, transparent: true, opacity: 0.6 }), "ribsFallback");
        } catch (e) { ribsMerged = null; }
        if (ribsMerged) fall.add(ribsMerged);
        else {
          for (var rj = 0; rj < (lowPower ? 7 : 11); rj++) {
            var rib = new THREE.Mesh(new THREE.TorusGeometry(88 - rj * 2, 3.2, 8, 40, Math.PI * 1.25), boneM);
            rib.position.set(0, 118 - rj * 17, -55); rib.rotation.set(Math.PI / 2, 0, Math.PI * 0.87); fall.add(rib);
          }
          var stern = new THREE.Mesh(new THREE.BoxGeometry(16, 130, 6), boneM); stern.position.set(0, 55, 88); fall.add(stern);
        }
      }
      if (!parts.heart) {
        var hm = new THREE.Mesh(new THREE.SphereGeometry(52, 24, 18), mat({ color: 0xc0453f, roughness: 0.38 }));
        hm.scale.set(1, 0.85, 1.25); hm.position.set(0, 20, -45); fall.add(hm); registered.heartFallback = 1;
      }
      var artM = phys({ color: 0xc23b30, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.35 });
      var venM = phys({ color: 0x3f6fb5, roughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.4 });
      var corM = phys({ color: 0xd95f4a, roughness: 0.35, clearcoat: 0.5 });
      var vesselParts = [
        { geom: tubeGeom(HEART_VESSELS.aorta, 9), color: 0xc23b30 },
        { geom: tubeGeom(HEART_VESSELS.pulmonaryTrunk, 8), color: 0xc23b30 },
        { geom: tubeGeom(HEART_VESSELS.svc, 6.5), color: 0x3f6fb5 },
        { geom: tubeGeom(HEART_VESSELS.ivc, 7.5), color: 0x3f6fb5 }
      ];
      HEART_VESSELS.pulmonaryVeins.forEach(function (pv) { vesselParts.push({ geom: tubeGeom(pv, 3.4), color: 0x3f6fb5 }); });
      var vesselsMerged = mergedMesh(vesselParts, mat({ vertexColors: true, roughness: 0.38 }), "vesselsFallback");
      if (vesselsMerged) fall.add(vesselsMerged);
      else {
        fall.add(tubeFromPath(HEART_VESSELS.aorta, 9, artM, "aortaArch"));
        fall.add(tubeFromPath(HEART_VESSELS.pulmonaryTrunk, 8, artM, "pulmonaryTrunk"));
        fall.add(tubeFromPath(HEART_VESSELS.svc, 6.5, venM, "svc"));
        fall.add(tubeFromPath(HEART_VESSELS.ivc, 7.5, venM, "ivc"));
        HEART_VESSELS.pulmonaryVeins.forEach(function (pv, i) { fall.add(tubeFromPath(pv, 3.4, venM, "pulmonaryVein" + i)); });
      }
      if (parts.heartGroup) {
        var corParts = [
          { geom: tubeGeom(HEART_VESSELS.coronaryLAD, 1.7), color: 0xd95f4a },
          { geom: tubeGeom(HEART_VESSELS.coronaryRCA, 1.7), color: 0xd95f4a },
          { geom: tubeGeom(HEART_VESSELS.coronaryCx, 1.5), color: 0xd95f4a }
        ];
        var corMerged = mergedMesh(corParts, mat({ vertexColors: true, roughness: 0.35 }), "coronaries");
        if (corMerged) parts.heartGroup.add(corMerged);
        else {
          parts.heartGroup.add(tubeFromPath(HEART_VESSELS.coronaryLAD, 1.7, corM, "coronaryLAD"));
          parts.heartGroup.add(tubeFromPath(HEART_VESSELS.coronaryRCA, 1.7, corM, "coronaryRCA"));
          parts.heartGroup.add(tubeFromPath(HEART_VESSELS.coronaryCx, 1.5, corM, "coronaryCx"));
        }
      }
      if (!parts.skin) {
        var sk = new THREE.Mesh(new THREE.SphereGeometry(150, 24, 18), mat({ color: 0xc9a189, roughness: 0.62, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
        sk.scale.set(1.05, 1.55, 0.62); sk.position.set(0, 10, -90); fall.add(sk); parts.skinFallback = sk;
      }
      if (!parts.liver) {
        var lv = new THREE.Mesh(new THREE.SphereGeometry(80, 20, 14), mat({ color: 0xd9b49c, roughness: 0.6 }));
        lv.scale.set(1.25, 0.45, 0.8); lv.position.set(-25, -62, -55); fall.add(lv);
      }
      parts.probe = buildProbeMesh(false); scene3.add(parts.probe);
      parts.ghost = buildProbeMesh(true); scene3.add(parts.ghost);
      var beamG = new THREE.BufferGeometry();
      beamG.setAttribute("position", new THREE.BufferAttribute(new Float32Array(15), 3));
      beamG.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1]);
      parts.beam = new THREE.Mesh(beamG, new THREE.MeshBasicMaterial({ color: 0x38bed8, transparent: true, opacity: 0.20, side: THREE.DoubleSide, depthWrite: false }));
      parts.beam.name = "beamFan"; scene3.add(parts.beam);
      parts.labels = new THREE.Group();
      [["Heart", [70, 30, -50]], ["Aorta", [42, 108, -10]], ["Vena cava", [-52, 20, -40]], ["Liver", [-90, -70, -60]], ["Ribs", [120, 80, 40]]].forEach(function (l) { parts.labels.add(labelSprite(l[0], l[1])); });
      scene3.add(parts.labels);
      skinVerts = [];
      if (meshes["skin-visible-human-male.glb"]) { var sp2 = meshPositionsArray(meshes["skin-visible-human-male.glb"]); for (var svi = 0; svi < sp2.length; svi++) if (sp2[svi][1] > 0) skinVerts.push(sp2[svi]); }
      applyLayer();
      updateProbeTransforms();
      return true;
    }
    function applyLayer() {
      if (!scene3) return;
      var skinM = parts.skin ? parts.skin.material : (parts.skinFallback ? parts.skinFallback.material : null);
      var boneM = parts.bones ? parts.bones.material : null;
      if (layer === "skin") {
        if (skinM) { skinM.opacity = 0.16; skinM.color.setHex(0x9a7a66); }
        if (boneM) boneM.opacity = 0.7;
        if (parts.heart) parts.heart.material.opacity = 1;
      } else if (layer === "glass") {
        if (skinM) { skinM.opacity = 0.10; skinM.color.setHex(0xaec6d4); }
        if (boneM) boneM.opacity = 0.38;
      } else {
        if (skinM) skinM.opacity = 0.06;
        if (boneM) boneM.opacity = 0.85;
      }
      if (parts.skin) parts.skin.visible = true;
      if (parts.bones) parts.bones.visible = layer !== "skin" || true;
    }
    function currentPlane() {
      var tp = null;
      try { if (probeInst) tp = probeInst.plane ? null : null; } catch (e) {}
      try {
        if (geomInst && viewsData) {
          var vobj = null, vs = viewsData.views || viewsData, i;
          for (i = 0; i < vs.length; i++) if (vs[i].id === view.viewId) vobj = vs[i];
          if (vobj && geomInst.viewPlane) tp = geomInst.viewPlane(vobj);
        }
      } catch (e) {}
      return planeFromPose(pose, view, tp);
    }
    function updateProbeTransforms() {
      if (!scene3 || !parts.probe) return;
      var plane = currentPlane();
      var contact = pose.contact.slice(); contact[1] = skinSurfaceY(contact[0], contact[2]);
      pose.contact[1] = contact[1];
      var cScene = toScene(contact);
      var outward = [0, 1, 0.15]; /* anterior, slightly cranial */
      var outScene = norm3([outward[0], outward[2], -outward[1]]);
      [parts.probe, parts.ghost].forEach(function (grp, gi) {
        var p = gi ? view.contact : contact;
        var yy = skinSurfaceY(p[0], p[2]);
        var s = toScene([p[0], yy, p[2]]);
        grp.position.set(s[0], s[1], s[2]);
        var up = new THREE.Vector3(0, 1, 0);
        var dir = new THREE.Vector3(outScene[0], outScene[1], outScene[2]);
        grp.quaternion.setFromUnitVectors(up, dir);
        var roll = new THREE.Quaternion();
        roll.setFromAxisAngle(dir, ((gi ? view.rotationDeg : pose.rotationDeg) * Math.PI) / 180);
        grp.quaternion.premultiply(roll);
        if (grp.userData.dashes) grp.userData.dashes.rotation.y = ((gi ? view.rotationDeg : pose.rotationDeg) * Math.PI) / 180;
      });
      /* beam fan into the chest */
      if (parts.beam) {
        var beamS = norm3([plane.beam[0], plane.beam[2], -plane.beam[1]]);
        var origin = new THREE.Vector3(cScene[0], cScene[1], cScene[2]);
        var dirV = new THREE.Vector3(beamS[0], beamS[1], beamS[2]);
        var lenMm = pose.depthCm * 7;
        var end = origin.clone().add(dirV.clone().multiplyScalar(lenMm));
        var side = new THREE.Vector3().crossVectors(dirV, new THREE.Vector3(outScene[0], outScene[1], outScene[2])).normalize().multiplyScalar(lenMm * 0.42);
        var up2 = new THREE.Vector3().crossVectors(side, dirV).normalize().multiplyScalar(lenMm * 0.30);
        var arr = parts.beam.geometry.attributes.position.array;
        var corners = [end.clone().add(side).add(up2), end.clone().add(side).sub(up2), end.clone().sub(side).sub(up2), end.clone().sub(side).add(up2)];
        arr[0] = origin.x; arr[1] = origin.y; arr[2] = origin.z;
        corners.forEach(function (cn, i) { arr[(i+1)*3] = cn.x; arr[(i+1)*3+1] = cn.y; arr[(i+1)*3+2] = cn.z; });
        parts.beam.geometry.attributes.position.needsUpdate = true;
        if (parts.beam.geometry.computeVertexNormals) parts.beam.geometry.computeVertexNormals();
      }
      if (parts.labels) parts.labels.children.forEach(function (s) { s.visible = showLabels; });
      return plane;
    }

    /* ---- monitor: KARDIA_US cutting the registered heart ---- */
    var geomInst = opts.geom || null, heartInst = opts.heart || null, probeInst = opts.probe || null, viewsData = opts.views || null;
    var ownHeart = false, ownGeom = false, us = opts.us || null, usFailed = false;
    function ensureMonitor() {
      if (us || usFailed) return us;
      try {
        if (!geomInst && G.KARDIA_GEOM && G.KARDIA_HEART && viewsData) {
          heartInst = heartInst || G.KARDIA_HEART.create(G.KARDIA_HEART.presets.normal);
          ownHeart = !opts.heart; ownGeom = true;
          geomInst = G.KARDIA_GEOM.create({ heart: heartInst, views: viewsData });
        }
        if (!probeInst && G.KARDIA_PROBE && viewsData && geomInst) probeInst = G.KARDIA_PROBE.create({ views: viewsData, geom: geomInst });
        if (geomInst && heartInst && !opts.us && G.KARDIA_US) us = G.KARDIA_US.create(monCanvas, geomInst, heartInst);
        if (opts.us) us = opts.us;
      } catch (e) { usFailed = true; debug.errors.push("monitor: " + String(e && e.message || e)); }
      return us;
    }
    if (!viewsData && fetchImpl && !opts.noViewsFetch) {
      Promise.resolve(fetchImpl(opts.viewsUrl || "/kardia/views.json")).then(function (r) { return r && r.ok ? r.json() : null; }).then(function (v) { if (v) { viewsData = v; ensureMonitor(); } }).catch(function () {});
    }
    var lastUsAt = 0, fpsFrames = 0, fpsLastAt = 0;
    function drawMonitor(now, plane) {
      var rendererUs = ensureMonitor();
      if (!rendererUs) return;
      if (lowPower && now - lastUsAt < 33) return;
      lastUsAt = now;
      try {
        /* The monitor canvas fills its wrap by layout; keep its drawing
         * buffer at that size or the sector is stretched to fit. */
        var mw = monCanvas.clientWidth || 0, mh = monCanvas.clientHeight || 0;
        if (mw > 0 && mh > 0 && (monCanvas.width !== mw || monCanvas.height !== mh)) { monCanvas.width = mw; monCanvas.height = mh; }
        if (ownHeart && heartInst && heartInst.step) heartInst.step(16);
        if (ownGeom && geomInst && heartInst) geomInst.update(heartInst.state());
        rendererUs.setKnobs({ depth: pose.depthCm * 10, showEcg: true, gain: 8, focusMm: 70 });
        /* The sector apex is the skin contact, not the cut plane
         * origin (which sits at heart level): starting the beam at
         * the plane origin left the chambers out of the sector and
         * showed only speckled tissue beyond the heart. */
        rendererUs.setProbe({ origin: pose.contact.slice(), viewOrigin: plane.origin, normal: plane.normal, up: plane.up, viewId: view.viewId });
        rendererUs.frame(now);
        debug.usCalls++;
        if (rendererUs.stats) {
          debug.usCutPolys = (rendererUs.stats.bloodCount || 0) + (rendererUs.stats.myoCount || 0);
          if (debug.usCutPolys === 0 && geomInst && geomInst.cut) {
            var polys = geomInst.cut(plane.origin, plane.normal, plane.up, 200, 200);
            debug.usCutPolys = polys.length;
          }
        }
        var hr = heartInst && heartInst.state ? (heartInst.state().heartRateBpm || 70) : 70;
        setText("kslHr", Math.round(hr) + " bpm");
      } catch (e) { debug.errors.push("us frame: " + String(e && e.message || e)); }
    }

    /* ---- real clip at target ---- */
    function clipsApi() { return opts.clips || G.KARDIA_CLIPS || null; }
    function resolveClip() {
      var q = { view: view.viewId, pathology: pathology ? pathology.id : null, severity: pathology ? pathology.severity : null };
      var key = q.view + "|" + (q.pathology || "") + "|" + (q.severity || "");
      if (key === realKey) return;
      realKey = key; realStatus = "loading"; realClip = null; realSrc = ""; clipRequested++;
      debug.clipRequestedFor = q.view;
      var api = clipsApi();
      if (!api || !api.preloadFor) { realStatus = "empty"; return; }
      api.preloadFor(q).then(function (res) {
        if (realKey !== key) return;
        if (!res || !res.clip) { realStatus = "empty"; return; }
        realClip = res.clip; realSrc = res.src || ""; realStatus = "ready"; offlineNoted = false;
        if (video && realSrc) {
          video.setAttribute("src", realSrc);
          try {
            var poly = G.KARDIA_ECHOLAB._pure.sectorClipPolygon(monCanvas.clientWidth || 640, monCanvas.clientHeight || 480, 80);
            video.style.clipPath = poly; video.style.webkitClipPath = poly;
          } catch (e) {}
        }
        var attr = "";
        try { attr = (api._pure ? api._pure.attributionLine(realClip) : "") || realClip.attribution || ""; } catch (e) {}
        setText("kslAttribution", attr || "");
      }, function () {
        if (realKey !== key) return;
        /* Direct stream fallback: on device the hosted clip may stream
         * even when the byte cache path failed. */
        try {
          var chosen = api.chooseClip ? api.chooseClip(q) : null;
          var direct = chosen && (api.clipUrl ? api.clipUrl(chosen) : (chosen.url || chosen.file));
          if (direct && video) { realClip = chosen; realSrc = direct; realStatus = "ready"; video.setAttribute("src", direct); setText("kslAttribution", (chosen.attribution) || chosen.title || ""); return; }
        } catch (e) {}
        realStatus = "offline";
      });
    }
    if (video && video.addEventListener) video.addEventListener("error", function () {
      if (realStatus === "ready") realStatus = "offline";
    });

    /* ---- loading: ends in a rendered body or a specific error ---- */
    var loadSettled = false, firstFrameDone = false;
    function finishLoadingIfReady() {
      if (loadSettled && firstFrameDone) {
        var box = el("kslLoading"); if (box) box.hidden = true;
        debug.loadingState = "ready";
      }
    }
    function showLoadError(msg) {
      debug.loadingState = "error"; debug.errors.push(msg);
      var box = el("kslLoading"), txt = el("kslLoadText"), btn = el("kslRetryLoad");
      if (box) box.hidden = false;
      if (txt) txt.textContent = msg;
      if (btn) btn.hidden = false;
    }
    function startLoad() {
      var fill = el("kslLoadFill"), txt = el("kslLoadText"), btn = el("kslRetryLoad");
      if (btn) btn.hidden = true;
      if (txt) txt.textContent = "Loading Scan Lab.";
      debug.loadingState = "loading"; loadSettled = false;
      var watchdog = setTimeout(function () {
        if (!loadSettled) showLoadError("Scan Lab assets took too long to load. Check the connection and retry.");
      }, (opts.loadTimeoutMs || 10000));
      loadThree(opts).then(function (T3) {
        THREE = T3;
        try { buildScene({}); } catch (e) { throw new Error("WebGL body could not start: " + String(e && e.message || e)); }
        debug.loadingState = "body-ready";
        return loadAssets({ fetch: fetchImpl, decompress: opts.decompress, manifestUrls: assetCandidates({ native: !!(G.Capacitor && G.Capacitor.isNativePlatform && G.Capacitor.isNativePlatform()), assetBase: opts.assetBase, manifestUrl: opts.manifestUrl }),
          onProgress: function (done, total) { if (fill) fill.style.width = Math.round(15 + 80 * done / Math.max(1, total)) + "%"; if (txt) txt.textContent = "Loading body assets, " + done + " of " + total + "."; } });
      }).then(function (res) {
        clearTimeout(watchdog);
        debug.manifestUrl = res.manifestUrl;
        if (res.errors.length) debug.errors = debug.errors.concat(res.errors);
        /* Rebuild with the verified meshes (merged, one geometry each). */
        try {
          if (scene3 && renderer) { /* dispose old renderer binding */ }
          buildScene(res.meshes);
        } catch (e) { debug.errors.push("mesh build: " + String(e && e.message || e)); }
        loadSettled = true;
        if (fill) fill.style.width = "100%";
        if (res.errors.length && !Object.keys(res.meshes).length) showLoadError("Body assets failed their checks: " + res.errors[0]);
        else finishLoadingIfReady();
        if (txt && res.errors.length && Object.keys(res.meshes).length) txt.textContent = "Body ready. Some assets kept the model fallback.";
        setTimeout(finishLoadingIfReady, 60);
      }).catch(function (e) {
        clearTimeout(watchdog);
        loadSettled = true;
        showLoadError("Scan Lab could not load: " + String(e && e.message || e) + " Tap Retry to try again.");
      });
    }
    var retryBtn = el("kslRetryLoad");
    if (retryBtn) retryBtn.addEventListener("click", function () { startLoad(); });

    /* ---- interaction ---- */
    function refresh(now) {
      now = now || nowMs();
      var err = poseError(pose, view), inTol = withinTolerance(err, view);
      var msg = coach.update(coachText(err, view), now);
      if (msg) setText("kslCoach", msg);
      setText("kslTargetName", view.label);
      setText("kslFamily", view.family + " window");
      debug.view = view.id; debug.viewLabel = view.label;
      setText("kslRot", Math.round(pose.rotationDeg) + " deg"); setText("kslRotRange", "target " + view.rotationDeg + " plus or minus " + view.tolerance.rotationDeg);
      setText("kslFan", Math.round(pose.fanDeg) + " deg"); setText("kslFanRange", "target " + view.fanDeg + " plus or minus " + view.tolerance.fanDeg);
      setText("kslRock", Math.round(pose.rockDeg) + " deg"); setText("kslRockRange", "target " + view.rockDeg + " plus or minus " + view.tolerance.rockDeg);
      setText("kslDepth", pose.depthCm + " cm"); setText("kslDepthRange", "target " + view.depthCm + " plus or minus " + view.tolerance.depthCm);
      var drSync = el("kslDepthRange"); if (drSync && +drSync.value !== pose.depthCm) drSync.value = pose.depthCm;
      setText("kslDepthVal", pose.depthCm + " cm");
      if (inTol && !wasIn) { holdSince = now; haptic("LIGHT"); }
      if (inTol && now - holdSince > 500 && !attemptDone) {
        attemptDone = true;
        var sc = scoreAttempt({ timeMs: now - startedAt, travelMm: travelMm, idealMm: 60, finalAngleDeg: Math.abs(err.rotationDeg) });
        try { var store = JSON.parse(G.localStorage.getItem("ksl_scores") || "{}"); store[view.id] = sc; G.localStorage.setItem("ksl_scores", JSON.stringify(store)); } catch (e) {}
        var r = el("kslResult"); if (r) { r.hidden = false; r.innerHTML = "<strong>View found.</strong> Score " + sc.total + " of 100. Time " + sc.timeS + " seconds. Path efficiency " + sc.efficiency + " percent. Final angle error " + Math.abs(Math.round(err.rotationDeg)) + " degrees."; }
        haptic("MEDIUM");
      }
      if (!inTol) holdSince = 0;
      wasIn = inTol;
      resolveClip();
      var rcState = realCine.update({ score: inTol ? 100 : 0, withinTolerance: inTol }, now);
      debug.realState = rcState;
      var note = el("kslClipNote");
      if (rcState === "real" && realStatus === "ready" && realSrc) {
        setText("kslMonLabel", "Real patient clip");
        var badge = el("kslRealBadge"); if (badge) badge.hidden = false;
        var det = el("kslAttrDetails"); if (det) det.hidden = false;
        if (video) {
          video.hidden = false;
          video.style.transition = reduced ? "none" : "opacity 600ms ease-out";
          video.style.opacity = "1";
          try { var pr = video.play && video.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
        }
        if (note) note.hidden = true;
      } else {
        if (video) { video.hidden = true; video.style.opacity = "0"; try { video.pause && video.pause(); } catch (e) {} }
        var badge2 = el("kslRealBadge"); if (badge2) badge2.hidden = true;
        setText("kslMonLabel", "Simulated image");
        if (rcState === "real" && realStatus === "offline" && !offlineNoted) {
          offlineNoted = true;
          if (note) { note.hidden = false; note.textContent = "You are offline. The real clip for this view is not stored on this device yet, so the simulated image stays on screen."; }
        } else if (rcState === "real" && realStatus === "empty") {
          if (note) { note.hidden = false; note.textContent = "No real patient clip for this view yet. The simulated image stays on screen."; }
        } else if (note && rcState !== "real") note.hidden = true;
      }
      /* heart beats in sync with the monitor cycle (same heart model
       * drives KARDIA_US and its ECG strip) */
      if (parts.heartGroup && heartInst && heartInst.state) {
        try { var hs = heartInst.state(); var cyc = (hs.cycleMs || 857) ? ((hs.cycleTimeMs || 0) / (hs.cycleMs || 857)) : 0; var bs = reduced ? 1 : heartBeatScale(cyc); parts.heartGroup.scale.set(bs, bs, bs); debug.beatScale = bs; debug.beatCycle = cyc; } catch (e) {}
      }
      var plane = scene3 ? updateProbeTransforms() : currentPlane();
      if (renderer && scene3 && camera) {
        /* The canvas is sized by layout (flex basis 0), so its client size
         * is only known after the first layout pass and changes with the
         * viewport. Keep the drawing buffer matched to it, or the scene
         * renders at the size the stage had when the scene was built. */
        var cw = sceneCanvas.clientWidth || 0, ch = sceneCanvas.clientHeight || 0;
        if (cw > 0 && ch > 0 && (debug.canvasW !== cw || debug.canvasH !== ch)) {
          debug.canvasW = cw; debug.canvasH = ch;
          try { renderer.setSize(cw, ch, false); } catch (e) {}
          try { camera.aspect = cw / ch; if (camera.updateProjectionMatrix) camera.updateProjectionMatrix(); } catch (e) {}
        }
        var cx = Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * orbit.dist;
        var cz = Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * orbit.dist;
        var cy = Math.sin(orbit.pitch) * orbit.dist;
        camera.position.set(cx, 40 + cy, cz);
        camera.lookAt(0, 10, -30);
        try { renderer.render(scene3, camera); } catch (e) { debug.errors.push("render: " + String(e && e.message || e)); }
        debug.frames++;
        if (renderer.info && renderer.info.render) debug.drawCalls = renderer.info.render.calls || debug.frames;
        else debug.drawCalls = debug.frames;
        if (!firstFrameDone) { firstFrameDone = true; finishLoadingIfReady(); }
        try { var ps = probeScreen(); if (ps) debug.probeScreen = ps; } catch (e) {}
      }
      drawMonitor(now, plane || currentPlane());
      fpsFrames++; if (now - fpsLastAt >= 500) { var fps = Math.round(fpsFrames * 1000 / Math.max(1, now - fpsLastAt)); debug.fps = fps; fpsFrames = 0; fpsLastAt = now; setText("kslFps", fps + " fps" + (lowPower ? " · low power" : "") + " · " + (debug.drawCalls || 0) + " draw calls"); }
    }
    var hiddenPaused = false;
    function loop(now) { if (destroyed) return; if (hiddenPaused || doc.hidden || (G.document && G.document.hidden)) { hiddenPaused = true; debug.pausedHidden = true; raf = 0; return; } refresh(now != null ? now : nowMs()); raf = rafImpl(loop); }
    try {
      if (doc.addEventListener) doc.addEventListener("visibilitychange", function () {
        var hid = !!(doc.hidden || (G.document && G.document.hidden));
        if (hid) { hiddenPaused = true; if (raf) cancelRaf(raf); raf = 0; debug.pausedHidden = true; }
        else if (hiddenPaused) { hiddenPaused = false; debug.pausedHidden = false; if (!destroyed && !raf) raf = rafImpl(loop); }
      });
    } catch (e) {}
    /* pointer handling: grip slides, marker rotates, tail tilts, pinch zooms */
    var pointers = {}, drag = null, lastTapAt = 0, pinchDist = 0;
    function canvasPoint(ev) {
      var r = sceneCanvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top, w: r.width || 720, h: r.height || 620 };
    }
    function probeScreen() {
      if (!camera || !parts.probe) return null;
      var v = new THREE.Vector3();
      parts.probe.getWorldPosition(v); v.project(camera);
      var r = sceneCanvas.getBoundingClientRect();
      var w = r.width || sceneCanvas.clientWidth || 720, h = r.height || sceneCanvas.clientHeight || 620;
      return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
    }
    if (sceneCanvas && sceneCanvas.addEventListener) {
      sceneCanvas.addEventListener("pointerdown", function (ev) {
        pointers[ev.pointerId] = ev;
        if (Object.keys(pointers).length === 2) {
          var ps = Object.keys(pointers).map(function (k) { return pointers[k]; });
          pinchDist = Math.hypot(ps[0].clientX - ps[1].clientX, ps[0].clientY - ps[1].clientY); drag = { mode: "pinch" }; return;
        }
        var now = Date.now();
        if (now - lastTapAt < 320) { orbit = { yaw: 2.6, pitch: 0.32, dist: 580 }; lastTapAt = 0; return; }
        lastTapAt = now;
        var p = canvasPoint(ev), c = probeScreen();
        var mode = "orbit";
        if (c) {
          var d = Math.hypot(p.x - c.x, p.y - c.y);
          if (d < 36) mode = "grip"; else if (p.y < c.y - 30 && d < 130) mode = "tail"; else if (d < 88) mode = "marker";
        }
        drag = { mode: mode, x: p.x, y: p.y, id: ev.pointerId };
        debug.lastDragMode = mode; debug.lastDragPoint = c ? { x: Math.round(c.x), y: Math.round(c.y), px: Math.round(p.x), py: Math.round(p.y) } : null;
        try { sceneCanvas.setPointerCapture(ev.pointerId); } catch (e) {}
      });
      sceneCanvas.addEventListener("pointermove", function (ev) {
        pointers[ev.pointerId] = ev;
        if (!drag) return;
        if (drag.mode === "pinch" && Object.keys(pointers).length === 2) {
          var ps = Object.keys(pointers).map(function (k) { return pointers[k]; });
          var nd = Math.hypot(ps[0].clientX - ps[1].clientX, ps[0].clientY - ps[1].clientY);
          if (pinchDist > 0) orbit.dist = clamp(orbit.dist * pinchDist / Math.max(20, nd), 240, 760);
          pinchDist = nd; return;
        }
        var p = canvasPoint(ev), dx = p.x - drag.x, dy = p.y - drag.y; drag.x = p.x; drag.y = p.y;
        if (drag.mode === "grip") {
          pose.contact[0] = clamp(pose.contact[0] + dx * 0.45, -120, 120);
          pose.contact[2] = clamp(pose.contact[2] - dy * 0.45, -140, 150);
          travelMm += Math.hypot(dx, dy) * 0.45;
        } else if (drag.mode === "marker") pose.rotationDeg = wrapDeg(pose.rotationDeg + dx * 0.6);
        else if (drag.mode === "tail") { pose.fanDeg = clamp(pose.fanDeg - dy * 0.35, -60, 60); pose.rockDeg = clamp(pose.rockDeg + dx * 0.35, -60, 60); }
        else { orbit.yaw += dx * 0.008; orbit.pitch = clamp(orbit.pitch + dy * 0.005, -0.25, 1.15); }
      });
      function endPointer(ev) { delete pointers[ev.pointerId]; if (!Object.keys(pointers).length) drag = null; }
      sceneCanvas.addEventListener("pointerup", endPointer);
      sceneCanvas.addEventListener("pointercancel", endPointer);
    }
    function bindNudge(id, fn) { var b = el(id); if (b) b.addEventListener("click", fn); }
    bindNudge("kslPractice", function () { startedAt = nowMs(); attemptDone = false; travelMm = 0; setText("kslCoach", "Practice. Find " + view.label + " on the body."); var r = el("kslResult"); if (r) r.hidden = true; });
    bindNudge("kslLabels", function () { showLabels = !showLabels; this.setAttribute("aria-pressed", showLabels ? "true" : "false"); });
    bindNudge("kslFullscreen", function () { var st = el("kslStage"); try { if (st && st.requestFullscreen) st.requestFullscreen(); else if (sceneCanvas && sceneCanvas.requestFullscreen) sceneCanvas.requestFullscreen(); } catch (e) {} });
    var layersBox = el("kslLayers");
    bindNudge("kslLayersBtn", function () { var open = layersBox.hidden; layersBox.hidden = !open; this.setAttribute("aria-expanded", open ? "true" : "false"); });
    var depthRange = el("kslDepthRange");
    if (depthRange) depthRange.addEventListener("input", function (ev) { pose.depthCm = +ev.target.value; setText("kslDepthVal", pose.depthCm + " cm"); });
    var layerBtns = root.querySelectorAll("[data-layer]");
    for (var li = 0; li < layerBtns.length; li++) layerBtns[li].addEventListener("click", function () {
      layer = this.getAttribute("data-layer"); applyLayer();
      for (var j = 0; j < layerBtns.length; j++) layerBtns[j].setAttribute("aria-pressed", layerBtns[j].getAttribute("data-layer") === layer ? "true" : "false");
    });
    function applyWindow() {
      var winBtns = root.querySelectorAll("[data-window]");
      for (var i = 0; i < winBtns.length; i++) winBtns[i].setAttribute("aria-pressed", winBtns[i].getAttribute("data-window") === activeWindow ? "true" : "false");
      var vbs = root.querySelectorAll("[data-view]");
      for (var j = 0; j < vbs.length; j++) vbs[j].hidden = vbs[j].getAttribute("data-win") !== activeWindow;
    }
    var winBtns2 = root.querySelectorAll("[data-window]");
    for (var wi = 0; wi < winBtns2.length; wi++) winBtns2[wi].addEventListener("click", function () { activeWindow = this.getAttribute("data-window"); applyWindow(); });
    /* Switching views must never jump the page: layout changes in the
     * columns (tutorial card, result card) can otherwise pull the
     * window scroll. Remember and restore it around every switch. */
    function preserveScroll(fn) {
      var wx = 0, wy = 0;
      try { wx = G.scrollX || 0; wy = G.scrollY || 0; } catch (e) {}
      var out = fn();
      try { if ((G.scrollX || 0) !== wx || (G.scrollY || 0) !== wy) { G.scrollTo(wx, wy); debug.scrollRestored = (debug.scrollRestored || 0) + 1; } } catch (e) {}
      return out;
    }
    function selectView(id) { return preserveScroll(function () {
      view = T.byId(id) || view; activeWindow = windowForView(view.id);
      startedAt = nowMs(); travelMm = 0; attemptDone = false; coach.reset(); realKey = ""; realCine.reset();
      var vbs = root.querySelectorAll("[data-view]");
      for (var j = 0; j < vbs.length; j++) vbs[j].setAttribute("aria-pressed", vbs[j].getAttribute("data-view") === view.id ? "true" : "false");
      var r = el("kslResult"); if (r) r.hidden = true;
      applyWindow(); refresh(nowMs());
    }); }
    var viewBtns = root.querySelectorAll("[data-view]");
    for (var vi = 0; vi < viewBtns.length; vi++) viewBtns[vi].addEventListener("click", function () { selectView(this.getAttribute("data-view")); });
    applyWindow();
    function applySyncPose(p) {
      if (!p) return;
      if (p.rotationDeg != null) pose.rotationDeg = p.rotationDeg;
      if (p.fanDeg != null) pose.fanDeg = p.fanDeg; if (p.tiltDeg != null) pose.fanDeg = p.tiltDeg;
      if (p.rockDeg != null) pose.rockDeg = p.rockDeg;
      if (p.slideXmm != null) pose.contact[0] = clamp(pose.contact[0] + p.slideXmm * 0.1, -120, 120);
      if (p.slideYmm != null) pose.contact[2] = clamp(pose.contact[2] + p.slideYmm * 0.1, -140, 150);
    }
    try {
      if (G.KARDIA_SYNC && G.KARDIA_SYNC.createDisplay) { var disp = G.KARDIA_SYNC.createDisplay({ onPose: applySyncPose }); if (disp && disp.start) disp.start(); }
    } catch (e) {}
    function renderTut() { return preserveScroll(renderTutStep); }
    function renderTutStep() {
      var box = el("kslTutorial");
      if (!box) return;
      if (tutDone) { box.hidden = true; return; }
      box.hidden = false; var s = TUTORIAL[tutStep];
      box.innerHTML = '<div class="ksl-tut-chips" role="group" aria-label="Tutorial steps">' + TUTORIAL.map(function (st, i) {
          return '<button type="button" class="ksl-tut-chip" data-tut="' + i + '" aria-pressed="' + (i === tutStep) + '" aria-label="Step ' + (i + 1) + ": " + esc(st.title) + '">' + (i + 1) + "</button>";
        }).join("") + "</div>" +
        "<strong>Step " + (tutStep + 1) + " of " + TUTORIAL.length + ": " + esc(s.title) + "</strong><p>" + esc(s.body) + "</p>" +
        '<button type="button" class="ksl-btn" id="kslTutBack" ' + (tutStep === 0 ? "disabled" : "") + ">Back</button> " +
        '<button type="button" class="ksl-btn" id="kslTutNext">' + (tutStep === TUTORIAL.length - 1 ? "Finish" : "Next") + '</button> ' +
        '<button type="button" class="ksl-btn" id="kslTutSkip">Skip</button>';
      Array.prototype.forEach.call(box.querySelectorAll("[data-tut]"), function (chip) {
        chip.addEventListener("click", function () { tutStep = +chip.getAttribute("data-tut"); renderTut(); });
      });
      el("kslTutBack").addEventListener("click", function () { if (tutStep > 0) { tutStep--; renderTut(); } });
      el("kslTutSkip").addEventListener("click", function () { tutDone = true; try { G.localStorage.setItem("ksl_tutorial_done", "1"); } catch (e) {} box.hidden = true; });
      el("kslTutNext").addEventListener("click", function () {
        if (tutStep >= TUTORIAL.length - 1) { tutDone = true; try { G.localStorage.setItem("ksl_tutorial_done", "1"); } catch (e) {} box.hidden = true; }
        else { tutStep++; renderTut(); }
      });
    }
    bindNudge("kslTutorialBtn", function () { tutDone = false; tutStep = 0; renderTut(); });
    if (!tutDone) renderTut();
    startLoad();
    raf = rafImpl(loop);
    var instance = {
      /* debugPose is a test seam: it must never scroll the page. The
       * whole pose change runs inside preserveScroll (as selectView
       * does), so a headless capture stays exactly where it was. */
      debugPose: function (viewId) {
        return preserveScroll(function () {
          var t = T.byId(viewId) || T.byView(viewId); if (!t) return null;
          selectView(t.id);
          pose = { contact: t.contact.slice(), rotationDeg: t.rotationDeg, fanDeg: t.fanDeg, rockDeg: t.rockDeg, depthCm: t.depthCm };
          refresh(nowMs());
          return { view: t.id, pose: pose, within: withinTolerance(poseError(pose, t), t) };
        });
      },
      setPathology: function (p) { pathology = p; realKey = ""; },
      applySyncPose: applySyncPose,
      getState: function () { return { view: view.id, pose: pose, layer: layer, pathology: pathology }; },
      getDebug: function () { return debug; },
      refresh: refresh,
      stop: function () { destroyed = true; if (raf) cancelRaf(raf); if (us && us.destroy) try { us.destroy(); } catch (e) {} }
    };
    return instance;
  }

  var lastInstance = null;
  var API = { create: function (o) { var i = create(o); lastInstance = i; return i; }, _pure: PURE, version: 2, bodyCreditsHtml: bodyCreditsHtml, BODY_CREDITS: BODY_CREDITS,
    debugPose: function (viewId) { return lastInstance ? lastInstance.debugPose(viewId) : null; },
    getLast: function () { return lastInstance; } };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.KARDIA_SCANLAB = API;
})(typeof window !== "undefined" ? window : this);




