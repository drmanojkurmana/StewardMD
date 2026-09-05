/* atlas3d.js — RadioAnatome 3D Anatomy layer.
 *
 * WHAT: a 3D reference body (BodyParts3D 4.0, CC BY 4.0, as packaged by Human Atlas) that
 * sits INSIDE RadioAnatome as a second layer next to the CT/MRI slice modules. It is keyed
 * on the same canonical ontology (atlas-pipeline/ontology.json): every mesh that maps to a
 * canonical structure carries its id, and atlas/3d/manifest.json carries, per canonical id,
 * the CT/MRI modules that pin it. That is what makes "3D structure -> CT slice" and
 * "CT structure -> 3D mesh" one lookup each.
 *
 * WHY no three.js: the app is buildless ES5 (see CLAUDE.md); three.js is ESM-only since
 * r160 and ~650 KB. The scene here is one kind of thing — static opaque triangle meshes with
 * per-part state — so a ~600-line WebGL1 renderer with GPU colour picking covers it and
 * adds no dependency, no licence, no version churn.
 *
 * DATA: geometry is NOT bundled into the native app (31 MB); dataUrl() rewrites
 * /atlas/3d/*.bin.gz to the live origin exactly like atlas.js imgUrl() does for slices.
 * manifest.json + index.json ARE bundled (build-www.sh allowlist).
 *
 * FLAG: smd_atlas3d (default ON; ?atlas3d=0 or localStorage smd_atlas3d=0 closes it on one
 * device). When off, atlas.js renders no 3D entry point and this file is inert.
 *
 * Attribution: the ONLY place a source credit renders is the 3D info screen (infoHtml),
 * mirroring the atlas.js rule. The CC BY 4.0 attribution string is mandated verbatim by
 * https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html — do not paraphrase it.
 */
(function (G) {
  "use strict";

  var FLAG_KEY = "smd_atlas3d", QUERY = "atlas3d";
  var MANIFEST_URL = "/atlas/3d/manifest.json", INDEX_URL = "/atlas/3d/index.json";
  var STATE_W = 64;                       // 64x64 state texture = 4096 part slots
  var DEFAULT_OFF = { muscular: 1, integumentary: 1 };   // heavy / occluding: opt-in layers
  var SEL_TINT = [0.26, 0.85, 0.78];

  // Default ON for every device, per the owner's 2026-09-04 order (vault/decisions/Decisions.md,
  // Scheme Search entry): no per-device gate on a new module. ?atlas3d=0 or
  // localStorage smd_atlas3d=0 still turns it off on one device; set DEFAULT_ON=false to close it.
  var DEFAULT_ON = true;
  function enabled() {
    try {
      var m = (G.location && G.location.search || "").match(new RegExp("[?&]" + QUERY + "=([^&]+)"));
      if (m) return m[1] === "1" || m[1] === "on" || m[1] === "true";
      var v = G.localStorage && G.localStorage.getItem(FLAG_KEY);
      if (v == null || v === "") return DEFAULT_ON;
      return v === "1" || v === "on" || v === "true";
    } catch (e) { return DEFAULT_ON; }
  }

  /* ---------- pure helpers (exported for tests) ---------- */

  function canonicalOf(sid) { return String(sid == null ? "" : sid).replace(/-/g, "_").toUpperCase(); }

  function parseManifest(m) {
    var parts = (m.parts || []).map(function (a, i) {
      return { i: i, id: a[0], name: a[1], fma: a[2], sys: a[3], reg: a[4], chunk: a[5], iStart: a[6], iCount: a[7], b: a[8], canon: a[9] || null };
    });
    var concepts = (m.concepts || []).map(function (c) { return { id: c[0], name: c[1], parts: c[2] }; });
    var ofPart = {}, byId = {}, fmaToCanon = {}, conceptById = {};
    concepts.forEach(function (c) {
      conceptById[c.id] = c;
      c.parts.forEach(function (p) { (ofPart[p] = ofPart[p] || []).push(c); });
    });
    parts.forEach(function (p) { byId[p.id] = p.i; });
    var canon = m.canon || {};
    Object.keys(canon).forEach(function (cid) {
      var e = canon[cid];
      if (e.fma) fmaToCanon[e.fma] = fmaToCanon[e.fma] || cid;
      if (e.left && e.left.fma) fmaToCanon[e.left.fma] = fmaToCanon[e.left.fma] || cid;
      if (e.right && e.right.fma) fmaToCanon[e.right.fma] = fmaToCanon[e.right.fma] || cid;
    });
    return {
      raw: m, parts: parts, concepts: concepts, conceptsOfPart: ofPart, conceptById: conceptById,
      systems: m.systems || [], regions: m.regions || [], canon: canon, fmaToCanon: fmaToCanon,
      links: m.links || {}, explain: m.explain || {}, chunks: m.chunks || [], byId: byId,
      source: m.source || {}
    };
  }

  // Rank: exact > prefix > word-start > substring. Parts and concepts both searchable, so a
  // query like "kidney" returns the concept (both kidneys) first and each mesh after it.
  function score(q, name) {
    var n = name.toLowerCase();
    if (n === q) return 4;
    if (n.indexOf(q) === 0) return 3;
    if (n.indexOf(" " + q) >= 0) return 2;
    if (n.indexOf(q) >= 0) return 1;
    return 0;
  }
  function search(query, d, limit) {
    var q = String(query || "").trim().toLowerCase();
    if (q.length < 2) return [];
    var out = [];
    d.concepts.forEach(function (c) {
      var s = score(q, c.name);
      if (s) out.push({ type: "concept", id: c.id, name: c.name, n: c.parts.length, s: s + 0.5 });
    });
    d.parts.forEach(function (p) {
      var s = score(q, p.name);
      if (s) out.push({ type: "part", i: p.i, name: p.name, sys: p.sys, s: s });
    });
    out.sort(function (a, b) { return b.s - a.s || a.name.length - b.name.length || a.name.localeCompare(b.name); });
    return out.slice(0, limit || 30);
  }

  function unionBounds(d, idxs) {
    var b = null;
    (idxs || []).forEach(function (i) {
      var p = d.parts[i]; if (!p) return;
      var q = p.b;
      if (!b) b = q.slice();
      else for (var k = 0; k < 3; k++) { if (q[k] < b[k]) b[k] = q[k]; if (q[k + 3] > b[k + 3]) b[k + 3] = q[k + 3]; }
    });
    return b;
  }
  function center(b) { return [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]; }
  function fitDistance(b, fovDeg, aspect) {
    var dx = b[3] - b[0], dy = b[4] - b[1], dz = b[5] - b[2];
    var r = Math.sqrt(dx * dx + dy * dy + dz * dz) / 2 || 0.02;
    var vf = fovDeg * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * (aspect || 1));
    return r / Math.sin(Math.min(vf, hf) / 2) * 1.15;
  }

  function encodePick(i) { var v = i + 1; return [0, (v >> 8) & 255, v & 255]; }
  function decodePick(r, g, b) { var v = (g << 8) | b; return v > 0 && r === 0 ? v - 1 : -1; }

  function canonOfPart(d, i) {
    var p = d.parts[i]; if (!p) return null;
    if (p.canon) return p.canon;
    var cs = d.conceptsOfPart[i] || [];
    for (var k = 0; k < cs.length; k++) if (d.fmaToCanon[cs[k].id]) return d.fmaToCanon[cs[k].id];
    if (d.fmaToCanon[p.fma]) return d.fmaToCanon[p.fma];
    return null;
  }
  function linksFor(d, cid) { return (cid && d.links[cid]) || []; }

  function regionParts(d, region) {
    if (!region) return null;
    var ri = d.regions.indexOf(region);
    if (ri < 0) return null;
    return d.parts.filter(function (p) { return p.reg === ri; }).map(function (p) { return p.i; });
  }

  /* ---------- tiny mat4 (column-major, WebGL order) ---------- */
  function perspective(fovDeg, aspect, near, far) {
    var f = 1 / Math.tan(fovDeg * Math.PI / 360), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function norm(a) { var l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function lookAt(eye, target, up) {
    var z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  }
  function mul(a, b) {
    var o = new Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }
  function eyeFrom(cam) {
    var cp = Math.cos(cam.pitch);
    return [cam.target[0] + cam.dist * cp * Math.sin(cam.yaw), cam.target[1] + cam.dist * Math.sin(cam.pitch), cam.target[2] + cam.dist * cp * Math.cos(cam.yaw)];
  }

  /* ---------- state ---------- */
  var st = {
    data: null, index: null, gl: null, canvas: null, chunks: {}, loading: {}, loaded: 0,
    visible: {}, hidden: {}, sel: [], isolate: false, region: "", explode: 0, explodeTarget: 0,
    cam: { target: [0, 0.92, 0], yaw: 0.45, pitch: 0.12, dist: 2.7 },
    subject: null, dirty: true, raf: 0, err: "", progress: 0, _tab: "about", _prevFocus: null, from: null
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function ico(n, c) {
    try {
      if (!G.ICONS || !G.ICONS.get) return "";
      if (G.ICONS.has && !G.ICONS.has(n)) return "";
      return G.ICONS.get(n, c);
    } catch (e) { return ""; }
  }
  function dataUrl(u) {
    try { if (G.SMD_IS_NATIVE && u.indexOf("/atlas/3d/") === 0 && /\.bin\.gz$/.test(u)) return "https://stewardmd.in" + u; } catch (e) {}
    return u;
  }
  function rootEl() {
    if (!G.document) return null;
    var el = G.document.getElementById("smdAtlas3d");
    if (!el) {
      el = G.document.createElement("div");
      el.id = "smdAtlas3d"; el.className = "atlas-overlay a3d-overlay";
      G.document.body.appendChild(el);
    }
    return el;
  }

  /* ---------- data ---------- */
  var _manifestP = null, _indexP = null;
  function loadIndex() {
    if (st.index) return Promise.resolve(st.index);
    if (_indexP) return _indexP;
    if (!G.fetch) return Promise.resolve({});
    _indexP = G.fetch(INDEX_URL).then(function (r) { return r && r.ok ? r.json() : {}; })
      .then(function (j) { st.index = j || {}; return st.index; })
      .catch(function () { st.index = {}; return st.index; });
    return _indexP;
  }
  function loadManifest() {
    if (st.data) return Promise.resolve(st.data);
    if (_manifestP) return _manifestP;
    if (!G.fetch) return Promise.reject(new Error("no fetch"));
    _manifestP = G.fetch(MANIFEST_URL).then(function (r) {
      if (!r || !r.ok) throw new Error("manifest " + (r && r.status));
      return r.json();
    }).then(function (m) {
      st.data = parseManifest(m);
      st.data.systems.forEach(function (s) { st.visible[s.id] = !DEFAULT_OFF[s.id]; });
      return st.data;
    }).catch(function (e) { _manifestP = null; throw e; });
    return _manifestP;
  }
  // Pages may serve .gz already decoded (Content-Encoding) or raw; accept both by length.
  function inflate(buf, rawBytes) {
    if (buf.byteLength === rawBytes) return Promise.resolve(buf);
    if (typeof G.DecompressionStream === "undefined" || typeof G.Blob === "undefined")
      return Promise.reject(new Error("This browser cannot decompress the 3D data."));
    var stream = new G.Blob([buf]).stream().pipeThrough(new G.DecompressionStream("gzip"));
    return new G.Response(stream).arrayBuffer().then(function (out) {
      if (out.byteLength !== rawBytes) throw new Error("3D chunk size mismatch");
      return out;
    });
  }
  function loadChunk(ci) {
    var d = st.data, c = d.chunks[ci];
    if (st.chunks[ci] || st.loading[ci]) return st.loading[ci] || Promise.resolve();
    st.loading[ci] = G.fetch(dataUrl(c.url)).then(function (r) {
      if (!r || !r.ok) throw new Error("chunk " + c.id + " " + (r && r.status));
      return r.arrayBuffer();
    }).then(function (buf) { return inflate(buf, c.bytes); }).then(function (raw) {
      if (st.gl) uploadChunk(ci, raw);
      delete st.loading[ci];
      st.loaded++; st.dirty = true; paintProgress();
    }).catch(function (e) {
      delete st.loading[ci];
      st.err = e && e.message || "Could not load the 3D anatomy.";
      paintProgress();
    });
    return st.loading[ci];
  }
  function neededChunks() {
    var d = st.data, need = [];
    var sysNeeded = {};
    d.systems.forEach(function (s) { if (st.visible[s.id]) sysNeeded[s.id] = 1; });
    st.sel.forEach(function (i) { sysNeeded[d.systems[d.parts[i].sys].id] = 1; });
    d.chunks.forEach(function (c, ci) { if (sysNeeded[c.system] && !st.chunks[ci]) need.push(ci); });
    return need;
  }
  function ensureChunks() {
    var need = neededChunks();
    if (!need.length) return Promise.resolve();
    // Three in flight, like a browser's per-host budget; the rest queue.
    var cursor = 0;
    function worker() {
      if (cursor >= need.length) return Promise.resolve();
      var ci = need[cursor++];
      return loadChunk(ci).then(worker);
    }
    paintProgress();
    return Promise.all([worker(), worker(), worker()]);
  }

  /* ---------- WebGL ---------- */
  var VS = [
    "attribute vec3 aPos; attribute vec3 aNrm; attribute float aPid;",
    "uniform mat4 uVP; uniform vec3 uOffset; uniform sampler2D uState;",
    "varying vec3 vN; varying vec3 vP; varying vec3 vState; varying vec3 vPick;",
    "void main(){",
    " vec2 uv = vec2((mod(aPid, " + STATE_W + ".0) + 0.5) / " + STATE_W + ".0, (floor(aPid / " + STATE_W + ".0) + 0.5) / " + STATE_W + ".0);",
    " vState = texture2D(uState, uv).rgb;",
    " float id = aPid + 1.0; float g = floor(id / 256.0); float b = id - g * 256.0;",
    " vPick = vec3(0.0, g / 255.0, b / 255.0);",
    " vec3 p = aPos + uOffset; vP = p; vN = aNrm;",
    " gl_Position = uVP * vec4(p, 1.0);",
    "}"].join("\n");
  var FS = [
    "precision mediump float;",
    "varying vec3 vN; varying vec3 vP; varying vec3 vState;",
    "uniform vec3 uColor; uniform vec3 uEye; uniform vec3 uBg; uniform vec3 uSel; uniform float uPass; uniform float uGhost;",
    "void main(){",
    " if (vState.r < 0.5) discard;",
    " if (uPass > 0.5 && uPass < 1.5 && vState.g < 0.5) discard;",   // pass 1: selection only
    " if (uPass > 1.5 && vState.g > 0.5) discard;",                  // pass 2: ghosts only
    " vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;",
    " vec3 L = normalize(vec3(-0.45, 0.8, 0.55)); vec3 V = normalize(uEye - vP);",
    " float diff = max(dot(n, L), 0.0); float hemi = 0.5 + 0.5 * n.y;",
    " vec3 H = normalize(L + V); float spec = pow(max(dot(n, H), 0.0), 40.0) * 0.22;",
    " vec3 c = uColor * (0.32 + 0.22 * hemi + 0.58 * diff) + spec;",
    " c = mix(c, uSel * (0.55 + 0.6 * diff) + spec, vState.g * 0.85);",
    " c = mix(c, uBg, vState.b * 0.35);",
    " gl_FragColor = vec4(c, uPass > 1.5 ? uGhost : 1.0);",
    "}"].join("\n");
  var FS_PICK = [
    "precision mediump float;",
    "varying vec3 vState; varying vec3 vPick;",
    "void main(){ if (vState.r < 0.5) discard; gl_FragColor = vec4(vPick, 1.0); }"].join("\n");

  function compile(gl, type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(s));
    return s;
  }
  function program(gl, vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, "aPos"); gl.bindAttribLocation(p, 1, "aNrm"); gl.bindAttribLocation(p, 2, "aPid");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(p));
    var u = {};
    ["uVP", "uOffset", "uState", "uColor", "uEye", "uBg", "uSel", "uPass", "uGhost"].forEach(function (n) { u[n] = gl.getUniformLocation(p, n); });
    return { p: p, u: u };
  }

  function initGL(canvas) {
    var gl = canvas.getContext("webgl", { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("This device could not start the 3D viewer (WebGL unavailable).");
    if (!gl.getExtension("OES_element_index_uint")) throw new Error("32-bit mesh indices are not supported here.");
    if (gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < 1) throw new Error("This GPU cannot read part state in the vertex stage.");
    var R = { gl: gl, main: program(gl, VS, FS), pick: program(gl, VS, FS_PICK) };
    R.stateData = new Uint8Array(STATE_W * STATE_W * 4);
    R.stateTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, R.stateTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, STATE_W, STATE_W, 0, gl.RGBA, gl.UNSIGNED_BYTE, R.stateData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Pick framebuffer (RGBA8 + depth), resized with the canvas.
    R.fbo = gl.createFramebuffer(); R.fboTex = gl.createTexture(); R.fboDepth = gl.createRenderbuffer(); R.fboW = 0; R.fboH = 0;
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);   // meshes are open shells: draw both faces
    canvas.addEventListener("webglcontextlost", function (e) { e.preventDefault(); st.err = "The 3D view was paused by the device. Close and reopen it."; paintProgress(); });
    return R;
  }
  function uploadChunk(ci, raw) {
    var gl = st.gl.gl, c = st.data.chunks[ci];
    var vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(raw, c.pos, c.v * 3), gl.STATIC_DRAW);
    var nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, new Int16Array(raw, c.nrm, c.v * 3), gl.STATIC_DRAW);
    var pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Uint16Array(raw, c.pid, c.v), gl.STATIC_DRAW);
    var ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(raw, c.idx, c.i), gl.STATIC_DRAW);
    st.chunks[ci] = { vb: vb, nb: nb, pb: pb, ib: ib, n: c.i, system: c.system };
  }
  function disposeGL() {
    var R = st.gl; if (!R) return;
    var gl = R.gl;
    Object.keys(st.chunks).forEach(function (k) { var c = st.chunks[k]; gl.deleteBuffer(c.vb); gl.deleteBuffer(c.nb); gl.deleteBuffer(c.pb); gl.deleteBuffer(c.ib); });
    st.chunks = {}; st.loaded = 0; st.loading = {};
    try { gl.deleteTexture(R.stateTex); gl.deleteTexture(R.fboTex); gl.deleteRenderbuffer(R.fboDepth); gl.deleteFramebuffer(R.fbo); gl.deleteProgram(R.main.p); gl.deleteProgram(R.pick.p); } catch (e) {}
    try { var lose = gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext(); } catch (e2) {}
    st.gl = null; st.canvas = null;
  }

  // Part state -> texture. r=visible, g=selected, b=dimmed.
  function applyState() {
    var d = st.data, R = st.gl; if (!d || !R) return;
    var buf = R.stateData, selSet = {}, hasSel = st.sel.length > 0;
    st.sel.forEach(function (i) { selSet[i] = 1; });
    var ri = st.region ? d.regions.indexOf(st.region) : -1;
    for (var i = 0; i < d.parts.length; i++) {
      var p = d.parts[i], o = i * 4;
      var vis = st.visible[d.systems[p.sys].id] && !st.hidden[i];
      if (ri >= 0 && p.reg !== ri) vis = false;
      if (selSet[i]) vis = true;
      if (st.isolate) vis = !!selSet[i];
      buf[o] = vis ? 255 : 0;
      buf[o + 1] = selSet[i] ? 255 : 0;
      buf[o + 2] = hasSel && !selSet[i] && !st.isolate ? 255 : 0;
      buf[o + 3] = 255;
    }
    var gl = R.gl;
    gl.bindTexture(gl.TEXTURE_2D, R.stateTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, STATE_W, STATE_W, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    st.dirty = true;
  }

  function sysOffset(sysIdx, t) {
    if (t <= 0) return [0, 0, 0];
    var n = st.data.systems.length, a = sysIdx / n * Math.PI * 2;
    return [Math.sin(a) * 0.5 * t, 0, Math.cos(a) * 0.5 * t];
  }
  function hexRgb(h) { var v = parseInt(h.slice(1), 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; }

  function drawScene(prog, pick, pass) {
    var R = st.gl, gl = R.gl, d = st.data, cam = st.cam;
    var w = st.canvas.width, h = st.canvas.height, aspect = w / Math.max(1, h);
    var eye = eyeFrom(cam);
    var near = Math.max(0.005, cam.dist * 0.02), far = cam.dist * 20 + 10;
    var vp = mul(perspective(34, aspect, near, far), lookAt(eye, cam.target, [0, 1, 0]));
    gl.useProgram(prog.p);
    gl.uniformMatrix4fv(prog.u.uVP, false, new Float32Array(vp));
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.stateTex); gl.uniform1i(prog.u.uState, 0);
    if (!pick) {
      gl.uniform3fv(prog.u.uEye, new Float32Array(eye));
      gl.uniform3f(prog.u.uBg, 0.07, 0.08, 0.09);
      gl.uniform3fv(prog.u.uSel, new Float32Array(SEL_TINT));
      gl.uniform1f(prog.u.uPass, pass || 0);
      gl.uniform1f(prog.u.uGhost, 0.16);
    }
    var sysIdx = {}; d.systems.forEach(function (s, i) { sysIdx[s.id] = i; });
    Object.keys(st.chunks).forEach(function (k) {
      var c = st.chunks[k], si = sysIdx[c.system];
      var off = sysOffset(si, st.explode);
      gl.uniform3f(prog.u.uOffset, off[0], off[1], off[2]);
      if (!pick) gl.uniform3fv(prog.u.uColor, new Float32Array(hexRgb(d.systems[si].color)));
      gl.bindBuffer(gl.ARRAY_BUFFER, c.vb); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, c.nb); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.SHORT, true, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, c.pb); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.UNSIGNED_SHORT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.ib);
      gl.drawElements(gl.TRIANGLES, c.n, gl.UNSIGNED_INT, 0);
    });
  }
  function render() {
    var R = st.gl; if (!R || !st.canvas) return;
    var gl = R.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, st.canvas.width, st.canvas.height);
    gl.clearColor(0.07, 0.08, 0.09, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (st.sel.length && !st.isolate) {
      // Selection opaque first, then the rest as a translucent ghost with depth writes off,
      // so a kidney behind the colon is still visible when the CT side highlights it.
      drawScene(R.main, false, 1);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      drawScene(R.main, false, 2);
      gl.disable(gl.BLEND); gl.depthMask(true);
    } else drawScene(R.main, false, 0);
    st.dirty = false;
  }
  function pickAt(x, y) {
    var R = st.gl; if (!R || !st.canvas) return -1;
    var gl = R.gl, w = st.canvas.width, h = st.canvas.height;
    if (R.fboW !== w || R.fboH !== h) {
      gl.bindTexture(gl.TEXTURE_2D, R.fboTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindRenderbuffer(gl.RENDERBUFFER, R.fboDepth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, R.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, R.fboTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, R.fboDepth);
      R.fboW = w; R.fboH = h;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, R.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawScene(R.pick, true);
    var px = new Uint8Array(4);
    gl.readPixels(Math.round(x), Math.round(h - y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    st.dirty = true;
    return decodePick(px[0], px[1], px[2]);
  }

  function tick() {
    st.raf = 0;
    if (!st.gl) return;
    var moving = false;
    if (Math.abs(st.explode - st.explodeTarget) > 0.002) { st.explode += (st.explodeTarget - st.explode) * 0.18; moving = true; st.dirty = true; }
    else if (st.explode !== st.explodeTarget) { st.explode = st.explodeTarget; st.dirty = true; }
    if (st.camTo) {
      var c = st.cam, t = st.camTo, k = 0.2, done = true;
      ["yaw", "pitch", "dist"].forEach(function (key) { var dv = t[key] - c[key]; if (Math.abs(dv) > 1e-3) { c[key] += dv * k; done = false; } else c[key] = t[key]; });
      for (var i = 0; i < 3; i++) { var dd = t.target[i] - c.target[i]; if (Math.abs(dd) > 1e-4) { c.target[i] += dd * k; done = false; } else c.target[i] = t.target[i]; }
      if (done) st.camTo = null; else moving = true;
      st.dirty = true;
    }
    if (st.dirty) render();
    if (moving) schedule();
  }
  function schedule() { if (!st.raf && G.requestAnimationFrame) st.raf = G.requestAnimationFrame(tick); }
  function invalidate() { st.dirty = true; schedule(); }

  function resizeCanvas() {
    var cv = st.canvas; if (!cv) return;
    var dpr = Math.min(G.devicePixelRatio || 1, 2), w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; invalidate(); }
  }

  /* ---------- camera + input ---------- */
  function focusOn(idxs, opts) {
    var d = st.data, b = unionBounds(d, idxs); if (!b) return;
    var aspect = st.canvas ? st.canvas.width / Math.max(1, st.canvas.height) : 1;
    var c = center(b);
    var dist = Math.max(0.05, fitDistance(b, 34, aspect) * ((opts && opts.pad) || 1));
    // The detail sheet covers the lower ~40% of the stage: drop the look-at point so the
    // structure sits in the visible upper part rather than under the sheet.
    if (st.subject) c[1] -= 0.28 * 2 * dist * Math.tan(17 * Math.PI / 180);
    st.camTo = { target: c, yaw: st.cam.yaw, pitch: st.cam.pitch, dist: dist };
    schedule();
  }
  function resetCamera() {
    st.camTo = { target: [0, 0.92, 0], yaw: 0.45, pitch: 0.12, dist: 2.7 };
    schedule();
  }
  function bindInput(cv) {
    var ptrs = {}, n = 0, last = null, t0 = 0, moved = 0, pinch0 = 0, dist0 = 0, mid0 = null;
    function pos(e) { var r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    cv.addEventListener("pointerdown", function (e) {
      ptrs[e.pointerId] = pos(e); n = Object.keys(ptrs).length;
      try { cv.setPointerCapture(e.pointerId); } catch (x) {}
      if (n === 1) { last = ptrs[e.pointerId]; t0 = Date.now(); moved = 0; st.camTo = null; }
      if (n === 2) { var k = Object.keys(ptrs), a = ptrs[k[0]], b = ptrs[k[1]]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); dist0 = st.cam.dist; mid0 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
      e.preventDefault();
    });
    cv.addEventListener("pointermove", function (e) {
      if (!ptrs[e.pointerId]) return;
      var p = pos(e); ptrs[e.pointerId] = p;
      if (n === 1 && last) {
        var dx = p[0] - last[0], dy = p[1] - last[1]; moved += Math.abs(dx) + Math.abs(dy);
        st.cam.yaw -= dx * 0.008; st.cam.pitch = Math.max(-1.45, Math.min(1.45, st.cam.pitch + dy * 0.006)); last = p; invalidate();
      } else if (n === 2) {
        var k = Object.keys(ptrs), a = ptrs[k[0]], b = ptrs[k[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch0 > 0) st.cam.dist = Math.max(0.05, Math.min(12, dist0 * pinch0 / Math.max(1, d)));
        var mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (mid0) { panBy(mid[0] - mid0[0], mid[1] - mid0[1]); mid0 = mid; }
        moved += 10; invalidate();
      }
    });
    function up(e) {
      if (!ptrs[e.pointerId]) return;
      var p = ptrs[e.pointerId]; delete ptrs[e.pointerId]; var was = n; n = Object.keys(ptrs).length;
      if (was === 1 && moved < 10 && Date.now() - t0 < 500 && e.type === "pointerup") {
        var dpr = cv.width / Math.max(1, cv.clientWidth);
        var hit = pickAt(p[0] * dpr, p[1] * dpr);
        onTap(hit);
      }
      if (n === 1) { var k = Object.keys(ptrs); last = ptrs[k[0]]; moved = 10; }
    }
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", function (e) { e.preventDefault(); st.cam.dist = Math.max(0.05, Math.min(12, st.cam.dist * (e.deltaY > 0 ? 1.1 : 0.9))); st.camTo = null; invalidate(); }, { passive: false });
  }
  function panBy(dx, dy) {
    var cam = st.cam, eye = eyeFrom(cam), z = norm(sub(eye, cam.target)), x = norm(cross([0, 1, 0], z)), y = cross(z, x);
    var k = cam.dist * 0.0022 * (st.canvas ? 600 / Math.max(300, st.canvas.clientHeight) : 1);
    for (var i = 0; i < 3; i++) cam.target[i] += -x[i] * dx * k + y[i] * dy * k;
  }

  /* ---------- selection ---------- */
  function onTap(i) {
    if (i < 0) { if (st.subject && st.subject.kind === "part") { select([], null); } return; }
    select([i], { kind: "part", i: i });
  }
  function select(idxs, subject, opts) {
    st.sel = idxs.slice(); st.subject = subject || null;
    if (!st.sel.length) st.isolate = false;
    applyState();
    var missing = neededChunks();
    if (missing.length) ensureChunks();
    if (st.subject) { openSheet(); if (!(opts && opts.noFocus)) focusOn(st.sel, { pad: 1.25 }); }
    else closeSheet();
    paintBar();
    invalidate();
  }
  function selectCanon(cid, opts) {
    var d = st.data, e = d.canon[cid]; if (!e) return false;
    if (e.kind === "region") { setRegion(e.region3d); st.subject = { kind: "canon", cid: cid }; openSheet(); return true; }
    if (e.kind === "system") { var only = {}; d.systems.forEach(function (s) { only[s.id] = s.id === e.system3d; }); st.visible = only; st.subject = { kind: "canon", cid: cid }; applyState(); ensureChunks(); openSheet(); paintBar(); return true; }
    var idxs = e.parts || e.related || [];
    if (!idxs.length) { st.subject = { kind: "canon", cid: cid }; openSheet(); return true; }
    select(idxs, { kind: "canon", cid: cid }, opts);
    return true;
  }
  function selectConcept(id) {
    var c = st.data.conceptById[id]; if (!c) return;
    select(c.parts, { kind: "concept", id: id });
  }
  function setRegion(r) {
    st.region = r || "";
    applyState();
    var idxs = regionParts(st.data, st.region);
    if (idxs && idxs.length) focusOn(idxs, { pad: 1.05 }); else resetCamera();
    paintChips(); invalidate();
  }
  function toggleIsolate() { if (!st.sel.length) return; st.isolate = !st.isolate; applyState(); paintBar(); if (st.isolate) focusOn(st.sel, { pad: 1.2 }); invalidate(); }
  function hideSelected() { st.sel.forEach(function (i) { st.hidden[i] = true; }); select([], null); }
  function unhideAll() { st.hidden = {}; st.isolate = false; applyState(); paintBar(); invalidate(); }
  function setSystem(id, on) { st.visible[id] = !!on; applyState(); ensureChunks(); paintBar(); invalidate(); }

  /* ---------- UI ---------- */
  function shellHtml() {
    return '<div class="atlas-top">' +
        '<button class="atlas-back" data-a3d-act="close" aria-label="Back">‹</button>' +
        '<span class="atlas-hd"><span class="atlas-ttl">3D Anatomy</span><span class="atlas-sub" id="a3dSub">BodyParts3D reference body</span></span>' +
        '<button class="atlas-info" data-a3d-act="info" aria-label="About the 3D anatomy">' + (ico("info") || "i") + "</button></div>" +
      '<div class="a3d-search"><input id="a3dQ" type="search" placeholder="Search 3,432 structures" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Search structures">' +
        '<div class="a3d-results" id="a3dResults" hidden></div></div>' +
      '<div class="a3d-chips" id="a3dChips"></div>' +
      '<div class="a3d-stage" id="a3dStage"><canvas id="a3dCanvas" aria-label="3D anatomy. Drag to orbit, pinch to zoom, tap a structure."></canvas>' +
        '<div class="a3d-progress" id="a3dProgress"></div></div>' +
      '<div class="a3d-bar" id="a3dBar"></div>' +
      '<div class="atlas-foot">Educational reference only — not for diagnosis.</div>';
  }
  function regionLabel(r) { return { HEAD: "Head", BRAIN: "Brain", NECK: "Neck", CHEST: "Chest", ABDOMEN: "Abdomen", PELVIS: "Pelvis", SPINE: "Spine", UPPER_LIMB: "Upper limb", LOWER_LIMB: "Lower limb", BODY: "Body" }[r] || r; }
  function paintChips() {
    var el = G.document.getElementById("a3dChips"); if (!el || !st.data) return;
    var rs = [""].concat(st.data.regions.filter(function (r) { return r !== "BODY"; }));
    el.innerHTML = rs.map(function (r) {
      return '<button class="atlas-chip' + (st.region === r ? " on" : "") + '" data-a3d-act="region" data-r="' + esc(r) + '">' + esc(r ? regionLabel(r) : "Whole body") + "</button>";
    }).join("");
    var sub = G.document.getElementById("a3dSub");
    if (sub) sub.textContent = st.region ? regionLabel(st.region) : "BodyParts3D reference body";
  }
  function paintBar() {
    var el = G.document.getElementById("a3dBar"); if (!el || !st.data) return;
    var hidden = Object.keys(st.hidden).length;
    el.innerHTML =
      '<button class="a3d-btn" data-a3d-act="systems">' + (ico("layers") || "") + "Layers</button>" +
      '<label class="a3d-explode"><span>Explode</span><input type="range" min="0" max="100" value="' + Math.round(st.explodeTarget * 100) + '" data-a3d-act="explode" aria-label="Explode systems"></label>' +
      '<button class="a3d-btn' + (st.isolate ? " on" : "") + '" data-a3d-act="isolate"' + (st.sel.length ? "" : " disabled") + ' aria-pressed="' + (st.isolate ? "true" : "false") + '">Isolate</button>' +
      '<button class="a3d-btn" data-a3d-act="reset">Reset</button>' +
      (hidden ? '<button class="a3d-btn" data-a3d-act="unhide">Unhide ' + hidden + "</button>" : "");
  }
  function paintProgress() {
    var el = G.document.getElementById("a3dProgress"); if (!el) return;
    if (st.err) { el.hidden = false; el.className = "a3d-progress err"; el.textContent = st.err; return; }
    var d = st.data, total = d ? neededChunks().length + st.loaded : 0;
    var inflight = Object.keys(st.loading).length;
    if (!d || inflight || neededChunks().length) {
      el.hidden = false; el.className = "a3d-progress";
      el.textContent = d ? "Loading 3D anatomy… " + st.loaded + "/" + Math.max(total, 1) : "Loading 3D anatomy…";
    } else el.hidden = true;
  }
  function systemsHtml() {
    var d = st.data, counts = {};
    d.parts.forEach(function (p) { var id = d.systems[p.sys].id; counts[id] = (counts[id] || 0) + 1; });
    return '<div class="a3d-panel" id="a3dSystems"><div class="atlas-top">' +
      '<button class="atlas-back" data-a3d-act="panelclose" aria-label="Close">‹</button>' +
      '<span class="atlas-hd"><span class="atlas-ttl">Layers</span><span class="atlas-sub">' + d.systems.length + " systems</span></span></div>" +
      '<div class="atlas-scroll"><ul class="a3d-sys">' + d.systems.map(function (s) {
        return '<li><label><input type="checkbox" data-a3d-act="sys" data-id="' + esc(s.id) + '"' + (st.visible[s.id] ? " checked" : "") + ">" +
          '<i style="background:' + esc(s.color) + '"></i><span>' + esc(s.name) + "</span><small>" + (counts[s.id] || 0) + "</small></label></li>";
      }).join("") + "</ul></div></div>";
  }
  // The ONE place a source credit renders (same rule as atlas.js infoHtml). CC BY 4.0 asks
  // for: the attribution string, the licence, a link, and a note that changes were made.
  function infoHtml() {
    var s = (st.data && st.data.source) || {};
    return '<div class="a3d-panel" id="a3dInfo"><div class="atlas-top">' +
      '<button class="atlas-back" data-a3d-act="panelclose" aria-label="Close">‹</button>' +
      '<span class="atlas-hd"><span class="atlas-ttl">About 3D Anatomy</span></span></div>' +
      '<div class="atlas-scroll">' +
      '<p class="atlas-prose">A 3D reference body linked to the RadioAnatome CT and MRI modules through one shared anatomy ontology. It is an adult male reference model, not a patient, and it is educational only.</p>' +
      '<p class="atlas-prose atlas-credit">' + esc(s.attribution || "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International") + "<br>" +
        "Licence: " + esc(s.licenceUrl || "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html") + "<br>" +
        "Dataset: " + esc(s.dataset || "BodyParts3D 4.0") + " · " + esc(s.datasetUrl || "") + "<br>" +
        "Changes: geometry simplified and repacked for mobile; duplicate meshes removed; display-system labels corrected. Packaging derived from Human Atlas (" + esc((s.via && s.via.repo) || "github.com/ashemag/human-atlas") + ", MIT).</p>" +
      "</div></div>";
  }

  function eduText(d, subject) {
    if (subject.kind === "canon") {
      var e = d.canon[subject.cid];
      return e.definition || d.explain[(e.name || "").toLowerCase()] || "";
    }
    if (subject.kind === "part") {
      var p = d.parts[subject.i], cid = canonOfPart(d, subject.i);
      if (cid && d.canon[cid] && d.canon[cid].definition) return d.canon[cid].definition;
      return d.explain[p.name.toLowerCase()] || d.systems[p.sys].desc || "";
    }
    if (subject.kind === "concept") {
      var c = d.conceptById[subject.id], cid2 = d.fmaToCanon[subject.id];
      if (cid2 && d.canon[cid2] && d.canon[cid2].definition) return d.canon[cid2].definition;
      return d.explain[c.name.toLowerCase()] || "";
    }
    return "";
  }
  function subjectTitle(d, s) {
    if (s.kind === "part") return d.parts[s.i].name;
    if (s.kind === "concept") return d.conceptById[s.id].name;
    return (d.canon[s.cid] || {}).name || s.cid;
  }
  function subjectCanon(d, s) {
    if (s.kind === "canon") return s.cid;
    if (s.kind === "part") return canonOfPart(d, s.i);
    return d.fmaToCanon[s.id] || null;
  }
  function sheetHtml(tab) {
    var d = st.data, s = st.subject; if (!d || !s) return "";
    var title = subjectTitle(d, s), cid = subjectCanon(d, s), ce = cid ? d.canon[cid] : null;
    var sysId = s.kind === "part" ? d.systems[d.parts[s.i].sys] : (st.sel.length ? d.systems[d.parts[st.sel[0]].sys] : null);
    var region = s.kind === "part" ? d.regions[d.parts[s.i].reg] : (ce ? ce.region : (st.sel.length ? d.regions[d.parts[st.sel[0]].reg] : ""));
    var fma = s.kind === "part" ? d.parts[s.i].fma : s.kind === "concept" ? s.id : (ce && ce.fma);
    function tb(k, label) { return '<button class="atlas-tab' + (tab === k ? " on" : "") + '" data-a3d-act="tab" data-tab="' + k + '">' + esc(label) + "</button>"; }
    var body;
    if (tab === "correlate") {
      var links = linksFor(d, cid);
      var rows = links.map(function (l) {
        return '<button class="a3d-link" data-a3d-act="ct" data-m="' + esc(l.m) + '" data-s="' + esc(l.s) + '" data-i="' + l.i + '">' +
          '<b>' + esc(l.mod) + "</b><span>" + esc(l.t) + "</span><small>slice " + l.i + "</small></button>";
      }).join("");
      var note = "";
      if (ce && ce.kind === "related") note = '<p class="atlas-prose atlas-notice">' + esc(ce.note || "") + "</p>";
      else if (ce && ce.coverage === "partial" && ce.note) note = '<p class="atlas-prose atlas-notice">' + esc(ce.note) + "</p>";
      var rel = "";
      if (ce && ce.related && ce.related.length && !(s.kind === "part"))
        rel = '<button class="a3d-link" data-a3d-act="related" data-c="' + esc(cid) + '"><b>3D</b><span>Show related structures</span><small>' + ce.related.length + " meshes</small></button>";
      var lat = "";
      if (ce && (ce.left || ce.right))
        lat = '<div class="a3d-lat">' + (ce.left ? '<button class="atlas-pill" data-a3d-act="side" data-c="' + esc(cid) + '" data-side="left">Left</button>' : "") +
          (ce.right ? '<button class="atlas-pill" data-a3d-act="side" data-c="' + esc(cid) + '" data-side="right">Right</button>' : "") +
          '<button class="atlas-pill" data-a3d-act="side" data-c="' + esc(cid) + '" data-side="both">Both</button></div>';
      body = (cid ? '<div class="a3d-canon">RadioAnatome structure: <b>' + esc((ce && ce.name) || cid) + "</b></div>" : "") +
        (rows ? '<div class="a3d-links">' + rows + "</div>" : '<div class="atlas-empty">' + (cid ? "Not labelled in any CT or MRI module yet." : "No matching RadioAnatome structure. Search the CT and MRI modules by name instead.") + "</div>") +
        note + rel + lat;
    } else if (tab === "hierarchy") {
      var cs = s.kind === "part" ? (d.conceptsOfPart[s.i] || []) : s.kind === "concept" ? [d.conceptById[s.id]] : [];
      cs = cs.slice().sort(function (a, b) { return a.parts.length - b.parts.length; });
      body = cs.length ? '<ul class="atlas-tree">' + cs.map(function (c) {
        return '<li><button class="a3d-tree" data-a3d-act="concept" data-id="' + esc(c.id) + '">' + esc(c.name) + " <small>" + c.parts.length + "</small></button></li>";
      }).join("") + "</ul>" : '<div class="atlas-empty">No parent concepts.</div>';
    } else {
      var txt = eduText(d, s);
      body = '<p class="atlas-def">' + (txt ? esc(txt) : "No description available for this structure.") + "</p>" +
        (s.kind === "concept" ? '<p class="atlas-prose">' + d.conceptById[s.id].parts.length + " meshes in this concept.</p>" : "");
    }
    return '<div class="atlas-grab"></div>' +
      '<div class="atlas-sheet-hd"><button class="atlas-sheet-x" data-a3d-act="sheetclose" aria-label="Close">' + (ico("close") || "×") + "</button></div>" +
      '<h2 class="atlas-sheet-ttl">' + esc(title) + "</h2>" +
      '<div class="atlas-pills">' +
        (sysId ? '<span class="atlas-pill cat"><i style="background:' + esc(sysId.color) + '"></i>' + esc(sysId.name) + "</span>" : "") +
        (region ? '<span class="atlas-pill">' + esc(regionLabel(region)) + "</span>" : "") +
        (fma ? '<span class="atlas-pill mono">' + esc(fma) + "</span>" : "") +
        '<button class="atlas-pill' + (st.isolate ? " on" : "") + '" data-a3d-act="isolate" aria-pressed="' + (st.isolate ? "true" : "false") + '">Isolate</button>' +
        '<button class="atlas-pill" data-a3d-act="hide">Hide</button>' +
      "</div>" +
      '<div class="atlas-tabs">' + tb("about", "About") + tb("correlate", "CT / MRI") + tb("hierarchy", "Hierarchy") + "</div>" +
      '<div class="atlas-sheet-body">' + body + "</div>";
  }
  function sheetEl() {
    var el = G.document.getElementById("a3dSheet");
    if (el) return el;
    el = G.document.createElement("div");
    el.id = "a3dSheet"; el.className = "atlas-sheet sheet a3d-sheet";
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "false");
    rootEl().appendChild(el);
    return el;
  }
  function openSheet() { var el = sheetEl(); el.innerHTML = sheetHtml(st._tab); el.classList.remove("full"); el.classList.add("on"); }
  function closeSheet() { var el = G.document && G.document.getElementById("a3dSheet"); if (el) el.classList.remove("on", "full"); }
  function pushPanel(html) { var host = G.document.createElement("div"); host.innerHTML = html; var n = host.firstChild; if (n) rootEl().appendChild(n); return n; }
  function dropPanel(id) { var el = G.document.getElementById(id); if (el && el.parentNode) el.parentNode.removeChild(el); }

  function paintResults(q) {
    var box = G.document.getElementById("a3dResults"); if (!box || !st.data) return;
    var hits = search(q, st.data, 30);
    if (!hits.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = hits.map(function (h) {
      return h.type === "concept"
        ? '<button class="a3d-hit" data-a3d-act="concept" data-id="' + esc(h.id) + '"><span>' + esc(h.name) + "</span><small>" + h.n + " meshes</small></button>"
        : '<button class="a3d-hit" data-a3d-act="part" data-i="' + h.i + '"><span>' + esc(h.name) + "</span><small>" + esc(st.data.systems[h.sys].name) + "</small></button>";
    }).join("");
  }

  function onClick(e) {
    var grab = e.target && e.target.closest ? e.target.closest(".a3d-sheet .atlas-grab, .a3d-sheet .atlas-sheet-ttl") : null;
    if (grab) { var sh = G.document.getElementById("a3dSheet"); if (sh) sh.classList.toggle("full"); return; }
    var t = e.target && e.target.closest ? e.target.closest("[data-a3d-act]") : null;
    if (!t || t.tagName === "INPUT") return;
    var act = t.getAttribute("data-a3d-act"), d = st.data;
    if (act === "close") { close(); return; }
    if (act === "info") { pushPanel(infoHtml()); return; }
    if (act === "systems") { pushPanel(systemsHtml()); return; }
    if (act === "panelclose") { dropPanel("a3dInfo"); dropPanel("a3dSystems"); return; }
    if (act === "sheetclose") { select([], null); return; }
    if (act === "region") { setRegion(t.getAttribute("data-r")); return; }
    if (act === "isolate") { toggleIsolate(); if (st.subject) openSheet(); return; }
    if (act === "hide") { hideSelected(); return; }
    if (act === "unhide") { unhideAll(); return; }
    if (act === "reset") { st.region = ""; st.isolate = false; st.hidden = {}; st.explodeTarget = 0; select([], null); applyState(); paintChips(); resetCamera(); return; }
    if (act === "tab") { st._tab = t.getAttribute("data-tab"); openSheet(); return; }
    if (!d) return;
    if (act === "part") { hideResults(); select([+t.getAttribute("data-i")], { kind: "part", i: +t.getAttribute("data-i") }); return; }
    if (act === "concept") { hideResults(); dropPanel("a3dSystems"); selectConcept(t.getAttribute("data-id")); return; }
    if (act === "related") { var ce = d.canon[t.getAttribute("data-c")]; if (ce && ce.related) select(ce.related, { kind: "canon", cid: t.getAttribute("data-c") }); return; }
    if (act === "side") {
      var cid = t.getAttribute("data-c"), side = t.getAttribute("data-side"), en = d.canon[cid]; if (!en) return;
      var idxs = side === "both" ? (en.parts || en.related || []) : ((en[side] && en[side].parts) || []);
      if (idxs.length) select(idxs, { kind: "canon", cid: cid });
      return;
    }
    if (act === "ct") {
      var m = t.getAttribute("data-m"), sid = t.getAttribute("data-s"), i = +t.getAttribute("data-i") || 1;
      if (G.ATLAS && G.ATLAS.openAt) { close(); G.ATLAS.openAt(m, sid, i); }
      return;
    }
  }
  function onChange(e) {
    var t = e.target; if (!t || !t.getAttribute) return;
    var act = t.getAttribute("data-a3d-act");
    if (act === "sys") setSystem(t.getAttribute("data-id"), t.checked);
    if (act === "explode") { st.explodeTarget = (+t.value || 0) / 100; schedule(); }
  }
  function onInput(e) {
    var t = e.target; if (!t || t.id !== "a3dQ") return;
    paintResults(t.value);
  }
  function hideResults() { var q = G.document.getElementById("a3dQ"); if (q) q.value = ""; var box = G.document.getElementById("a3dResults"); if (box) { box.hidden = true; box.innerHTML = ""; } }

  /* ---------- lifecycle ---------- */
  function open(opts) {
    opts = opts || {};
    var el = rootEl(); if (!el) return;
    try { st._prevFocus = G.document.activeElement; } catch (e) { st._prevFocus = null; }
    // The 3D layer lives INSIDE RadioAnatome: if it is opened from Home, bring the atlas up
    // underneath so Back and the swipe gesture land in the catalog, not on a blank page.
    try { if (G.ATLAS && G.ATLAS.isOpen && !G.ATLAS.isOpen() && G.ATLAS.open) G.ATLAS.open(); } catch (e2) {}
    el.removeEventListener("click", onClick); el.addEventListener("click", onClick);
    el.removeEventListener("change", onChange); el.addEventListener("change", onChange);
    el.removeEventListener("input", onInput); el.addEventListener("input", onInput);
    el.innerHTML = shellHtml();
    el.classList.add("on");
    st.err = ""; st.sel = []; st.subject = null; st.isolate = false; st.hidden = {}; st.region = ""; st.explodeTarget = 0; st.explode = 0;
    st.cam = { target: [0, 0.92, 0], yaw: 0.45, pitch: 0.12, dist: 2.7 }; st.camTo = null;
    paintProgress();
    loadManifest().then(function (d) {
      if (!isOpen()) return;
      var cv = G.document.getElementById("a3dCanvas");
      st.canvas = cv;
      try { st.gl = initGL(cv); } catch (e) { st.err = e.message; paintProgress(); return; }
      bindInput(cv);
      resizeCanvas();
      paintChips(); paintBar();
      applyState();
      if (opts.canon && d.canon[opts.canon]) selectCanon(opts.canon, { noFocus: false });
      else if (opts.region) setRegion(opts.region);
      if (opts.partId != null && d.byId[opts.partId] != null) select([d.byId[opts.partId]], { kind: "part", i: d.byId[opts.partId] });
      ensureChunks().then(function () { paintProgress(); if (st.sel.length) focusOn(st.sel, { pad: 1.25 }); invalidate(); });
      invalidate();
    }).catch(function (e) { st.err = "Could not load the 3D anatomy manifest."; paintProgress(); });
  }
  function close() {
    var el = G.document && G.document.getElementById("smdAtlas3d");
    if (el) el.classList.remove("on");
    closeSheet(); dropPanel("a3dInfo"); dropPanel("a3dSystems");
    disposeGL();
    if (el) el.innerHTML = "";
    try { if (st._prevFocus && st._prevFocus.focus) st._prevFocus.focus(); } catch (e) {}
    st._prevFocus = null;
  }
  function isOpen() { var el = G.document && G.document.getElementById("smdAtlas3d"); return !!(el && el.classList.contains("on")); }
  function back() {
    if (!isOpen()) return false;
    if (G.document.getElementById("a3dInfo")) { dropPanel("a3dInfo"); return true; }
    if (G.document.getElementById("a3dSystems")) { dropPanel("a3dSystems"); return true; }
    var box = G.document.getElementById("a3dResults");
    if (box && !box.hidden) { hideResults(); return true; }
    var sh = G.document.getElementById("a3dSheet");
    if (sh && sh.classList.contains("on")) { select([], null); return true; }
    close();
    return true;
  }
  function hasCanon(cid) {
    var k = st.index && st.index[cid];
    return !!k && k !== "none";
  }
  if (G.addEventListener) G.addEventListener("resize", function () { if (isOpen()) resizeCanvas(); });

  /* ---------- exports ---------- */
  G.ATLAS3D = G.ATLAS3D || {};
  G.ATLAS3D.enabled = enabled;
  G.ATLAS3D.open = open;
  G.ATLAS3D.close = close;
  G.ATLAS3D.isOpen = isOpen;
  G.ATLAS3D.back = back;
  G.ATLAS3D.prime = loadIndex;
  G.ATLAS3D.hasCanon = hasCanon;
  G.ATLAS3D.kindOf = function (cid) { return (st.index && st.index[cid]) || null; };
  G.ATLAS3D.selectCanon = selectCanon;
  G.ATLAS3D._state = st;
  G.ATLAS3D._select = select;
  G.ATLAS3D._sheetHtml = sheetHtml;
  G.ATLAS3D._pickAt = pickAt;
  G.ATLAS3D._pure = {
    canonicalOf: canonicalOf, parseManifest: parseManifest, search: search, unionBounds: unionBounds,
    fitDistance: fitDistance, encodePick: encodePick, decodePick: decodePick, canonOfPart: canonOfPart,
    linksFor: linksFor, regionParts: regionParts, perspective: perspective, lookAt: lookAt, mul: mul, eyeFrom: eyeFrom
  };
  G.ATLAS3D._version = "1.0";

  if (typeof module !== "undefined" && module.exports) module.exports = G.ATLAS3D._pure;
})(typeof window !== "undefined" ? window : this);
