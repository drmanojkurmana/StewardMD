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
 * DATA: geometry is NOT bundled into the native app and NOT in git: the chunks live on R2 at
 * https://models.stewardmd.in/atlas3d/ (dataBases()), cached on-device through the Cache API
 * / IndexedDB helper in thorex-model-cache.js so the second open is instant and offline.
 * manifest.json + index.json ARE bundled (build-www.sh allowlist).
 *
 * SOURCES: two bodies share one ontology. "bp3d" is the BodyParts3D reference body; "live"
 * is the SAME living-patient CT the torso slice modules are cut from (TotalSegmentator
 * s0108, meshed by atlas-pipeline/live3d.py). Live parts carry registered slice planes, so a
 * CT slice can be drawn as a textured cut through the meshes at exactly its level.
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
  var R2_BASE = "https://models.stewardmd.in/atlas3d";
  var CACHE_NAME = "atlas3d-v1";
  var VIEWS = [{ id: "3q", yaw: 0.45, pitch: 0.12 }, { id: "front", yaw: 0, pitch: 0.02 }, { id: "side", yaw: Math.PI / 2, pitch: 0.02 }, { id: "back", yaw: Math.PI, pitch: 0.02 }, { id: "top", yaw: 0, pitch: 1.35 }];
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
      return { i: i, id: a[0], name: a[1], fma: a[2], sys: a[3], reg: a[4], chunk: a[5], iStart: a[6], iCount: a[7], b: a[8], canon: a[9] || null, src: a[10] || 0, side: a[11] || null };
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
      source: m.source || {}, sources: m.sources || [{ id: "bp3d", name: "Reference body", short: "Reference" }],
      planes: m.planes || {}, lod: m.lod || null, live: m.live || null
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
      if (s) out.push({ type: "part", i: p.i, name: p.name, sys: p.sys, src: p.src, s: s });
    });
    // Unified search: a RadioAnatome structure with CT/MRI slices is a hit too, ranked above
    // the meshes so "liver" leads with the atlas entry and its modules.
    Object.keys(d.canon).forEach(function (cid) {
      var e = d.canon[cid], n = (d.links[cid] || []).length;
      if (!n) return;
      var s = score(q, e.name || cid);
      if (s) out.push({ type: "canon", cid: cid, name: e.name || cid, n: n, s: s + 1 });
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
    src: "bp3d", lod: false, plane: null, view: 0, shell: true, bowel: false, _lastTap: 0, _lastTapIdx: -1,
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
  // Geometry hosts, tried in order per chunk. Natively the bundle has no .bin.gz, so the live
  // origin comes first (mirrors atlas.js imgUrl()). The Pages PREVIEW host is a fallback so a
  // device build can be tested BEFORE the branch is merged: an unmerged branch makes
  // stewardmd.in answer /atlas/3d/* with its index.html (HTTP 200, text/html), which WebKit
  // then reports as "Failed to Decode Data." - the check in loadChunk() catches that and moves
  // on. localStorage smd_atlas3d_base (e.g. a models.stewardmd.in path) wins over both.
  function dataBases() {
    var out = [];
    try { var o = G.localStorage && G.localStorage.getItem("smd_atlas3d_base"); if (o) out.push(String(o).replace(/\/$/, "")); } catch (e) {}
    var native = false; try { native = !!G.SMD_IS_NATIVE; } catch (e2) {}
    if (!native) out.push("");          // a dev checkout that ran the pipeline serves its own chunks
    out.push(R2_BASE);
    return out;
  }
  // Chunk URLs are "/atlas/3d/<file>"; R2 keys are "atlas3d/<file>", so a non-empty base
  // replaces the path prefix rather than prepending to it.
  // A per-chunk version tag (its content sha, short) so a re-meshed chunk lands under a fresh
  // URL: the models.stewardmd.in edge caches each geometry URL, and same filename + new bytes
  // otherwise serves the stale chunk until its TTL, which the length check then rejects.
  function dataUrl(u, base, ver) { var p = base ? base + u.replace(/^\/atlas\/3d/, "") : u; return ver ? p + (p.indexOf("?") < 0 ? "?" : "&") + "v=" + ver : p; }
  function chunkVer(c) { return c && c.sha256 ? c.sha256.slice(0, 8) : ""; }
  function imgUrl(u) {
    try { if (G.SMD_IS_NATIVE && u.indexOf("/atlas/") === 0) return "https://stewardmd.in" + u; } catch (e) {}
    return u;
  }
  function isTouch() { try { return !!G.SMD_IS_NATIVE || (G.navigator && G.navigator.maxTouchPoints > 0); } catch (e) { return false; } }
  // A real chunk is either gzip (1f 8b) or, if the host already decoded it, exactly rawBytes.
  function looksLikeChunk(buf, rawBytes) {
    if (!buf || buf.byteLength < 2) return false;
    if (buf.byteLength === rawBytes) return true;
    var h = new Uint8Array(buf, 0, 2);
    return h[0] === 0x1f && h[1] === 0x8b;
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
  function fetchChunk(c) {
    var bases = st.base != null ? [st.base] : dataBases(), i = 0;
    function attempt() {
      if (i >= bases.length) return Promise.reject(new Error("The 3D geometry is not published on this server yet."));
      var base = bases[i++];
      return G.fetch(dataUrl(c.url, base, chunkVer(c))).then(function (r) {
        if (!r || !r.ok) throw new Error("http " + (r && r.status));
        return r.arrayBuffer();
      }).then(function (buf) {
        if (!looksLikeChunk(buf, c.bytes)) throw new Error("not a chunk");
        st.base = base;
        return buf;
      }).catch(function () { return attempt(); });
    }
    return attempt();
  }
  // The active chunk set: LOD chunks stand in for the reference body's full chunks on phones;
  // living-CT chunks (src 1) have one level only. Chunks are keyed by id so sets can coexist.
  function chunkSet() {
    var d = st.data;
    var full = d.chunks.filter(function (c) { return !c.src; }), live = d.chunks.filter(function (c) { return c.src === 1; });
    var ref = (st.lod && d.lod && d.lod.chunks && d.lod.chunks.length) ? d.lod.chunks.map(function (c) { return Object.assign({}, c, { lod: true }); }) : full;
    return ref.concat(live.map(function (c) { return Object.assign({}, c, { src: 1 }); }));
  }
  // Fetch through the shared on-device model cache when it is present (Cache API, else
  // IndexedDB): the second open of the 3D layer costs no network and works offline. Bytes are
  // validated BEFORE they are trusted; a bad cached entry is purged rather than retried forever.
  function fetchBytes(url, useCache) {
    var mc = G.SMD_THOREX_MODEL_CACHE;
    if (useCache && mc && mc.loadModelBytes) {
      return mc.loadModelBytes(url, { cacheName: CACHE_NAME }).then(function (b) {
        return b instanceof ArrayBuffer ? b : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      });
    }
    return G.fetch(url).then(function (r) { if (!r || !r.ok) throw new Error("http " + (r && r.status)); return r.arrayBuffer(); });
  }
  function fetchChunk(c) {
    var bases = st.base != null ? [st.base] : dataBases(), i = 0;
    function attempt() {
      if (i >= bases.length) return Promise.reject(new Error("The 3D geometry is not published on this server yet."));
      var base = bases[i++], url = dataUrl(c.url, base, chunkVer(c)), cacheable = base === R2_BASE;
      return fetchBytes(url, cacheable).then(function (buf) {
        if (!looksLikeChunk(buf, c.bytes)) {
          if (cacheable && G.SMD_THOREX_MODEL_CACHE && G.SMD_THOREX_MODEL_CACHE.clearModels) { try { G.SMD_THOREX_MODEL_CACHE.clearModels({ cacheName: CACHE_NAME }); } catch (e) {} }
          throw new Error("not a chunk");
        }
        st.base = base;
        return buf;
      }).catch(function () { return attempt(); });
    }
    return attempt();
  }
  function loadChunk(c) {
    var key = c.id;
    if (st.chunks[key] || st.loading[key]) return st.loading[key] || Promise.resolve();
    st.loading[key] = fetchChunk(c).then(function (buf) { return inflate(buf, c.bytes); }).then(function (raw) {
      if (st.gl) uploadChunk(c, raw);
      delete st.loading[key];
      // invalidate(), not a bare dirty flag: a chunk that lands after the camera has settled
      // must schedule its own frame, or the organs never appear (seen on the iPhone, where
      // the network is slower than the camera animation).
      st.loaded++; settleFrames(); paintProgress();
    }).catch(function (e) {
      delete st.loading[key];
      st.err = e && e.message || "Could not load the 3D anatomy.";
      paintProgress();
    });
    return st.loading[key];
  }
  function srcIndex() { return st.src === "live" ? 1 : 0; }
  function neededChunks() {
    var d = st.data, need = [];
    var sysNeeded = {};
    d.systems.forEach(function (s) { if (st.visible[s.id]) sysNeeded[s.id] = 1; });
    st.sel.forEach(function (i) { sysNeeded[d.systems[d.parts[i].sys].id] = 1; });
    var want = srcIndex();
    if (want === 1 && st.shell) sysNeeded.integumentary = 1;
    chunkSet().forEach(function (c) { if ((c.src || 0) === want && sysNeeded[c.system] && !st.chunks[c.id]) need.push(c); });
    return need;
  }
  function ensureChunks() {
    var need = neededChunks();
    if (!need.length) return Promise.resolve();
    // Three in flight, like a browser's per-host budget; the rest queue.
    var cursor = 0;
    function worker() {
      if (cursor >= need.length) return Promise.resolve();
      var c = need[cursor++];
      return loadChunk(c).then(worker);
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
    "uniform vec3 uColor; uniform vec3 uEye; uniform vec3 uBg; uniform vec3 uSel; uniform float uPass; uniform float uGhost; uniform vec4 uClip; uniform float uClipOn;",
    "void main(){",
    " if (vState.r < 0.5) discard;",
    " if (uClipOn > 0.5 && dot(vP, uClip.xyz) > uClip.w) discard;",
    " float shell = (vState.b > 0.4 && vState.b < 0.75) ? 1.0 : 0.0;", // body outline (living CT skin)
    " if (uPass < 3.5 && shell > 0.5) discard;",                     // shell renders only in pass 4
    " if (uPass > 3.5 && shell < 0.5) discard;",
    " if (uPass > 0.5 && uPass < 1.5 && vState.g < 0.5) discard;",   // pass 1: selection only
    " if (uPass > 1.5 && uPass < 2.5 && vState.g > 0.5) discard;", // pass 2: ghosts only
    " if (uPass > 2.5 && uPass < 3.5 && vState.g < 0.5) discard;",   // pass 3: selection as a see-through ghost (over the slice)
    " vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;",
    " vec3 L = normalize(vec3(-0.45, 0.8, 0.55)); vec3 V = normalize(uEye - vP);",
    " float diff = max(dot(n, L), 0.0); float hemi = 0.5 + 0.5 * n.y;",
    " vec3 H = normalize(L + V); float spec = pow(max(dot(n, H), 0.0), 40.0) * 0.22;",
    " vec3 c = uColor * (0.32 + 0.22 * hemi + 0.58 * diff) + spec;",
    " c = mix(c, uSel * (0.55 + 0.6 * diff) + spec, vState.g * 0.72);",
    " float dim = shell > 0.5 ? 0.0 : vState.b;",                   // the membrane is never the dim-unselected grey
    " c = mix(c, uBg, dim * 0.35);",
    " float a = uPass > 1.5 ? uGhost : 1.0;",
    // The skin is a translucent envelope, not a solid coat: a fresnel term makes it clear where
    // you look straight through (so the organs read) and bright at the silhouette (so the body
    // reads). Warm skin tone, independent of the dim logic.
    " if (shell > 0.5) {",
    "   float fres = pow(1.0 - max(dot(n, V), 0.0), 1.8);",
    "   c = mix(vec3(0.93, 0.76, 0.66), vec3(1.0, 0.95, 0.90), fres) * (0.72 + 0.5 * hemi);",
    "   a = uGhost * (0.42 + 1.7 * fres);",
    // the outline fades out over the last ~4 cm at the scan's cut top/bottom (y 0.62 .. 1.058 m
    // in live.json's frame), so the shell reads as a body and not a sawn-off tube.
    "   a *= smoothstep(0.62, 0.665, vP.y) * (1.0 - smoothstep(1.01, 1.058, vP.y));",
    " }",
    " gl_FragColor = vec4(c, a);",
    "}"].join("\n");
  var FS_PICK = [
    "precision mediump float;",
    "varying vec3 vState; varying vec3 vPick; varying vec3 vP; uniform vec4 uClip; uniform float uClipOn;",
    "void main(){ if (vState.r < 0.5) discard; if (vState.b > 0.4 && vState.b < 0.75) discard; if (uClipOn > 0.5 && dot(vP, uClip.xyz) > uClip.w) discard; gl_FragColor = vec4(vPick, 1.0); }"].join("\n");
  // The CT slice itself, drawn as a textured quad on the cut plane.
  var QVS = "attribute vec3 aPos; attribute vec2 aUv; uniform mat4 uVP; varying vec2 vUv; void main(){ vUv = aUv; gl_Position = uVP * vec4(aPos, 1.0); }";
  var QFS = "precision mediump float; varying vec2 vUv; uniform sampler2D uTex; uniform float uAlpha; void main(){ vec4 t = texture2D(uTex, vUv); gl_FragColor = vec4(t.rgb, uAlpha); }";

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
    ["uVP", "uOffset", "uState", "uColor", "uEye", "uBg", "uSel", "uPass", "uGhost", "uClip", "uClipOn", "uTex", "uAlpha"].forEach(function (n) { u[n] = gl.getUniformLocation(p, n); });
    return { p: p, u: u };
  }

  function initGL(canvas) {
    var gl = canvas.getContext("webgl", { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("This device could not start the 3D viewer (WebGL unavailable).");
    if (!gl.getExtension("OES_element_index_uint")) throw new Error("32-bit mesh indices are not supported here.");
    if (gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < 1) throw new Error("This GPU cannot read part state in the vertex stage.");
    var R = { gl: gl, main: program(gl, VS, FS), pick: program(gl, VS, FS_PICK) };
    // slice quad program: its own attribute layout (0 = aPos, 1 = aUv)
    var qp = gl.createProgram();
    gl.attachShader(qp, compile(gl, gl.VERTEX_SHADER, QVS)); gl.attachShader(qp, compile(gl, gl.FRAGMENT_SHADER, QFS));
    gl.bindAttribLocation(qp, 0, "aPos"); gl.bindAttribLocation(qp, 1, "aUv"); gl.linkProgram(qp);
    if (!gl.getProgramParameter(qp, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(qp));
    R.quad = { p: qp, u: { uVP: gl.getUniformLocation(qp, "uVP"), uTex: gl.getUniformLocation(qp, "uTex"), uAlpha: gl.getUniformLocation(qp, "uAlpha") } };
    R.quadVb = gl.createBuffer(); R.quadTex = null;
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
  function uploadChunk(c, raw) {
    var gl = st.gl.gl;
    var vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(raw, c.pos, c.v * 3), gl.STATIC_DRAW);
    var nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, new Int16Array(raw, c.nrm, c.v * 3), gl.STATIC_DRAW);
    var pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Uint16Array(raw, c.pid, c.v), gl.STATIC_DRAW);
    var ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(raw, c.idx, c.i), gl.STATIC_DRAW);
    st.chunks[c.id] = { vb: vb, nb: nb, pb: pb, ib: ib, n: c.i, system: c.system, src: c.src || 0, lod: !!c.lod };
  }
  function disposeGL() {
    var R = st.gl; if (!R) return;
    var gl = R.gl;
    Object.keys(st.chunks).forEach(function (k) { var c = st.chunks[k]; gl.deleteBuffer(c.vb); gl.deleteBuffer(c.nb); gl.deleteBuffer(c.pb); gl.deleteBuffer(c.ib); });
    st.chunks = {}; st.loaded = 0; st.loading = {};
    try { if (R.quadTex) gl.deleteTexture(R.quadTex); gl.deleteBuffer(R.quadVb); gl.deleteProgram(R.quad.p); } catch (e0) {}
    try { gl.deleteTexture(R.stateTex); gl.deleteTexture(R.fboTex); gl.deleteRenderbuffer(R.fboDepth); gl.deleteFramebuffer(R.fbo); gl.deleteProgram(R.main.p); gl.deleteProgram(R.pick.p); } catch (e) {}
    try { var lose = gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext(); } catch (e2) {}
    st.gl = null; st.canvas = null;
  }

  function dropChunks(pred) {
    var R = st.gl; if (!R) return;
    var gl = R.gl;
    Object.keys(st.chunks).forEach(function (k) {
      var c = st.chunks[k]; if (!pred(c)) return;
      gl.deleteBuffer(c.vb); gl.deleteBuffer(c.nb); gl.deleteBuffer(c.pb); gl.deleteBuffer(c.ib);
      delete st.chunks[k]; st.loaded = Math.max(0, st.loaded - 1);
    });
  }

  // Part state -> texture. r=visible, g=selected, b=dimmed.
  function applyState() {
    var d = st.data, R = st.gl; if (!d || !R) return;
    var buf = R.stateData, selSet = {}, hasSel = st.sel.length > 0;
    st.sel.forEach(function (i) { selSet[i] = 1; });
    var ri = st.region ? d.regions.indexOf(st.region) : -1, want = srcIndex();
    for (var i = 0; i < d.parts.length; i++) {
      var p = d.parts[i], o = i * 4;
      var sysId = d.systems[p.sys].id, shell = p.src === 1 && sysId === "integumentary";
      var vis = st.visible[sysId] && !st.hidden[i] && p.src === want;
      if (ri >= 0 && p.reg !== ri) vis = false;
      if (selSet[i] && p.src === want) vis = true;
      if (st.isolate) vis = !!selSet[i] && p.src === want;
      // The living body's skin is a faint outline drawn in its own pass, never a solid layer:
      // it is what makes the organs read as a patient. Shown whenever the source is live
      // and the outline switch is on, regardless of region or isolate.
      if (shell) vis = want === 1 && st.shell && !st.hidden[i];
      buf[o] = vis ? 255 : 0;
      buf[o + 1] = selSet[i] && !shell ? 255 : 0;
      buf[o + 2] = shell ? 128 : (hasSel && !selSet[i] && !st.isolate ? 255 : 0);
      buf[o + 3] = 255;
    }
    var gl = R.gl;
    gl.bindTexture(gl.TEXTURE_2D, R.stateTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, STATE_W, STATE_W, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    invalidate();
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
    var clip = clipPlane(eye);
    gl.uniform4fv(prog.u.uClip, new Float32Array(clip ? clip : [0, 1, 0, 0]));
    // The cut removes the near half of the BODY, never of the structure the user asked about:
    // passes 1 and 3 (the selection) ignore the clip, so moving the slice away from a kidney
    // leaves the kidney standing above the cut instead of a label over an empty slice.
    gl.uniform1f(prog.u.uClipOn, clip && pass !== 1 && pass !== 3 ? 1 : 0);
    if (!pick) {
      gl.uniform3fv(prog.u.uEye, new Float32Array(eye));
      gl.uniform3f(prog.u.uBg, 0.07, 0.08, 0.09);
      gl.uniform3fv(prog.u.uSel, new Float32Array(SEL_TINT));
      gl.uniform1f(prog.u.uPass, pass || 0);
      gl.uniform1f(prog.u.uGhost, pass === 3 ? 0.42 : pass === 4 ? 0.26 : 0.16);
    }
    var sysIdx = {}; d.systems.forEach(function (s, i) { sysIdx[s.id] = i; });
    var want = srcIndex();
    Object.keys(st.chunks).forEach(function (k) {
      var c = st.chunks[k], si = sysIdx[c.system];
      if (c.src !== want) return;
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
    drawSliceQuad();
    if (st.plane && st.sel.length) {
      // The selected structure must stay readable THROUGH the slice: the cut removes the near
      // half and the slice hides the far half, so redraw the selection as a ghost, no depth test.
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.DEPTH_TEST);
      drawScene(R.main, false, 3);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
    }
    if (st.src === "live" && st.shell) {
      // pass 4: the body outline, translucent, depth-tested (the far skin stays behind organs)
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      drawScene(R.main, false, 4);
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    positionLabel();
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
    invalidate();
    return decodePick(px[0], px[1], px[2]);
  }

  /* ---------- cut plane (registered CT slice) ---------- */
  function planeInfo() {
    var pl = st.plane; if (!pl || !st.data) return null;
    var byMod = st.data.planes[pl.m]; if (!byMod) return null;
    return byMod[String(pl.i)] || null;
  }
  // Keep the half of the body on the far side of the plane from the camera, so the cut face
  // (and the slice drawn on it) faces the viewer whichever way the body is turned.
  function clipPlane(eye) {
    var p = planeInfo(); if (!p) return null;
    var n = p.axis === "x" ? [1, 0, 0] : p.axis === "z" ? [0, 0, 1] : [0, 1, 0];
    var side = dot(eye, n) - p.pos;
    if (side < 0) { n = [-n[0], -n[1], -n[2]]; }
    return [n[0], n[1], n[2], dot(n, p.axis === "x" ? [p.pos, 0, 0] : p.axis === "z" ? [0, 0, p.pos] : [0, p.pos, 0])];
  }
  function loadSliceTexture() {
    var R = st.gl, pl = st.plane; if (!R || !pl) return;
    var d = st.data, mod = (G.ATLAS && G.ATLAS._state && G.ATLAS._state.catalog) || null;
    var url = "/atlas/" + pl.m + "/" + ("00" + pl.i).slice(-3) + ".webp";
    var img = new G.Image();
    img.crossOrigin = "anonymous";
    pl.ready = false;
    img.onload = function () {
      if (st.plane !== pl || !st.gl) return;
      var gl = st.gl.gl;
      if (!st.gl.quadTex) st.gl.quadTex = gl.createTexture();
      // Upload on unit 1 (the quad's unit) and hand unit 0 back to the state texture. Binding
      // on whichever unit happened to be active left the slice image on unit 0, and on iOS
      // the next frame's vertex texture fetch then read it as the part state: every mesh was
      // discarded and the user saw a bare slice until something else redrew.
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, st.gl.quadTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, st.gl.stateTex);
      pl.ready = true; settleFrames();
    };
    img.onerror = function () { pl.ready = false; invalidate(); };
    img.src = imgUrl(url);
  }
  function drawSliceQuad() {
    var R = st.gl, p = planeInfo(); if (!R || !p) return;
    var gl = R.gl, pl = st.plane;
    var tl = p.tl, u = p.u, v = p.v;
    var c = [tl, [tl[0] + u[0], tl[1] + u[1], tl[2] + u[2]], [tl[0] + u[0] + v[0], tl[1] + u[1] + v[1], tl[2] + u[2] + v[2]], [tl[0] + v[0], tl[1] + v[1], tl[2] + v[2]]];
    var data = new Float32Array([
      c[0][0], c[0][1], c[0][2], 0, 0,  c[1][0], c[1][1], c[1][2], 1, 0,  c[2][0], c[2][1], c[2][2], 1, 1,
      c[0][0], c[0][1], c[0][2], 0, 0,  c[2][0], c[2][1], c[2][2], 1, 1,  c[3][0], c[3][1], c[3][2], 0, 1]);
    var cam = st.cam, w = st.canvas.width, h = st.canvas.height, aspect = w / Math.max(1, h), eye = eyeFrom(cam);
    var near = Math.max(0.005, cam.dist * 0.02), far = cam.dist * 20 + 10;
    var vp = mul(perspective(34, aspect, near, far), lookAt(eye, cam.target, [0, 1, 0]));
    gl.useProgram(R.quad.p);
    gl.uniformMatrix4fv(R.quad.u.uVP, false, new Float32Array(vp));
    gl.bindBuffer(gl.ARRAY_BUFFER, R.quadVb); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.disableVertexAttribArray(2);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (pl.ready && R.quadTex) {
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, R.quadTex); gl.uniform1i(R.quad.u.uTex, 1);
      gl.uniform1f(R.quad.u.uAlpha, 0.88);
    } else {
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, R.stateTex); gl.uniform1i(R.quad.u.uTex, 1);
      gl.uniform1f(R.quad.u.uAlpha, 0.15);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
  }
  function setPlane(m, i, opts) {
    var d = st.data;
    if (!m || !d.planes[m] || !d.planes[m][String(i)]) { st.plane = null; paintBar(); invalidate(); return false; }
    st.plane = { m: m, i: +i, n: Object.keys(d.planes[m]).length, ready: false };
    if (st.src !== "live") setSource("live", { keepSel: true });
    loadSliceTexture();
    paintBar();
    if (!(opts && opts.noFocus)) {
      var p = d.planes[m][String(i)], tl = p.tl, u = p.u, v = p.v;
      var b = [Math.min(tl[0], tl[0] + u[0] + v[0]), Math.min(tl[1], tl[1] + u[1] + v[1]), Math.min(tl[2], tl[2] + u[2] + v[2]),
               Math.max(tl[0], tl[0] + u[0] + v[0]), Math.max(tl[1], tl[1] + u[1] + v[1]), Math.max(tl[2], tl[2] + u[2] + v[2])];
      var c = center(b), aspect = st.canvas ? st.canvas.width / Math.max(1, st.canvas.height) : 1;
      var dist = fitDistance(b, 34, aspect) * 0.9;
      // look at the cut from the side the viewer expects: above for axial, in front for
      // coronal, from the patient's left for sagittal
      var yaw = p.axis === "x" ? Math.PI / 2 : 0.35, pitch = p.axis === "y" ? 0.95 : 0.15;
      if (st.subject) c[1] -= 0.22 * 2 * dist * Math.tan(17 * Math.PI / 180);
      st.camTo = { target: c, yaw: yaw, pitch: pitch, dist: dist };
    }
    invalidate();
    return true;
  }
  function clearPlane() { st.plane = null; paintBar(); invalidate(); }

  /* ---------- sources ---------- */
  function setSource(id, opts) {
    var d = st.data; if (!d) return;
    if (!d.sources.some(function (s) { return s.id === id; })) return;
    if (st.src === id) return;
    st.src = id;
    if (!(opts && opts.keepSel)) { st.sel = []; st.subject = null; closeSheet(); }
    if (id !== "live") st.plane = null;
    st.region = "";
    liveDefaults();
    applyState(); paintChips(); paintBar(); ensureChunks();
    if (!(opts && opts.keepCam)) focusSource();
    invalidate();
  }
  // On the living body the small bowel and colon wrap every other organ from any anterior
  // angle (they are real, and huge); hide them until asked, the way the reference body hides
  // muscles and skin. Selecting COLON or SMALL_BOWEL still shows them (selection wins).
  var LIVE_BOWEL = ["LIVE_small_bowel", "LIVE_colon", "LIVE_duodenum"];
  function liveDefaults() {
    var d = st.data; if (!d) return;
    LIVE_BOWEL.forEach(function (id) {
      var i = d.byId[id]; if (i == null) return;
      if (st.bowel) delete st.hidden[i]; else st.hidden[i] = 1;
    });
  }
  function focusSource() {
    var want = srcIndex(), idxs = st.data.parts.filter(function (p) { return p.src === want; }).map(function (p) { return p.i; });
    var b = unionBounds(st.data, idxs); if (!b) return;
    var aspect = st.canvas ? st.canvas.width / Math.max(1, st.canvas.height) : 1;
    var v = VIEWS[st.view] || VIEWS[0];
    // The living torso is nearly square; on a tall phone canvas the width-fit leaves it small,
    // so it may fill the width (the bottom bar never covers the body's centre).
    st.camTo = { target: center(b), yaw: v.yaw, pitch: v.pitch, dist: fitDistance(b, 34, aspect) * (want ? 0.86 : 1.02) };
    schedule();
  }
  function setLod(on) {
    if (!!on === st.lod) return;
    st.lod = !!on;
    dropChunks(function (c) { return !c.src; });
    ensureChunks(); invalidate();
  }
  function cycleView() {
    st.view = (st.view + 1) % VIEWS.length;
    var v = VIEWS[st.view];
    st.camTo = { target: st.cam.target.slice(), yaw: v.yaw, pitch: v.pitch, dist: st.cam.dist };
    paintBar(); schedule();
  }

  /* ---------- callout label ---------- */
  function positionLabel() {
    var el = G.document.getElementById("a3dLabel"); if (!el) return;
    if (!st.subject || !st.sel.length || !st.canvas) { el.hidden = true; return; }
    var d = st.data, b = unionBounds(d, st.sel); if (!b) { el.hidden = true; return; }
    var c = center(b), cam = st.cam, w = st.canvas.width, h = st.canvas.height, aspect = w / Math.max(1, h), eye = eyeFrom(cam);
    var vp = mul(perspective(34, aspect, Math.max(0.005, cam.dist * 0.02), cam.dist * 20 + 10), lookAt(eye, cam.target, [0, 1, 0]));
    var x = vp[0] * c[0] + vp[4] * c[1] + vp[8] * c[2] + vp[12], y = vp[1] * c[0] + vp[5] * c[1] + vp[9] * c[2] + vp[13], wv = vp[3] * c[0] + vp[7] * c[1] + vp[11] * c[2] + vp[15];
    if (wv <= 0) { el.hidden = true; return; }
    var cw = st.canvas.clientWidth, ch = st.canvas.clientHeight;
    var sx = (x / wv + 1) / 2 * cw, sy = (1 - y / wv) / 2 * ch;
    el.hidden = false;
    if (el._t !== st.subject) { el.textContent = subjectTitle(d, st.subject); el._t = st.subject; }
    // Position with a compositor transform, not left/top: the canvas is GPU-composited, so a
    // main-thread layout property lands a frame behind it under motion and the label visibly
    // trails the mesh. translate3d promotes the label to its own layer, locked to the canvas.
    var lx = Math.round(Math.max(8, Math.min(cw - 8, sx))), ly = Math.round(Math.max(8, Math.min(ch - 8, sy)));
    el.style.transform = "translate3d(" + lx + "px," + ly + "px,0) translate(-50%,-140%)";
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
  // Draw now AND once more on the following frame. Resources that land asynchronously
  // (a chunk, the slice image) have shown a wrong first frame on iOS; the second is right.
  var settleTimers = [];
  function settleFrames() {
    invalidate();
    // iOS WebKit: the first frame after an asynchronous upload (chunk buffers, the slice
    // image) has rendered with every mesh missing, and a frame a moment later was right.
    // Redraw at a few staggered delays; the cost is four cheap frames.
    // Measured on an iPhone 15 Pro (iOS 27): a frame drawn from a timer callback presented
    // correctly, the same frame drawn from requestAnimationFrame kept presenting the stale
    // slice-only image. So these follow-ups render directly, not through schedule().
    settleTimers.forEach(clearTimeout); settleTimers = [];
    [60, 250, 700, 1500].forEach(function (ms) { settleTimers.push(setTimeout(function () { if (st.gl) { st.dirty = true; tick(); } }, ms)); });
  }
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
        var now = Date.now(), dbl = hit >= 0 && hit === st._lastTapIdx && now - st._lastTap < 350;
        st._lastTap = now; st._lastTapIdx = hit;
        if (dbl) { select([hit], { kind: "part", i: hit }); focusOn([hit], { pad: 1.1 }); }
        else onTap(hit);
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
  function partsForCanon(e, prefer) {
    // "live" wins when it exists and the caller (a living-torso module) asked for it, or when
    // the viewer is already on the living body; otherwise the reference meshes.
    var live = e.live || [], ref = e.parts || e.related || [];
    if (prefer === "live" && live.length) return { src: "live", idxs: live };
    // A structure the reference body only has "related" pieces for (liver, lungs, lobes) IS
    // a real surface on the living body: that is the whole reason the second source exists.
    if (e.kind === "related" && live.length && prefer !== "bp3d") return { src: "live", idxs: live };
    if (prefer === "bp3d" && ref.length) return { src: "bp3d", idxs: ref };
    if (st.src === "live" && live.length) return { src: "live", idxs: live };
    if (ref.length) return { src: "bp3d", idxs: ref };
    if (live.length) return { src: "live", idxs: live };
    return { src: st.src, idxs: [] };
  }
  function selectCanon(cid, opts) {
    var d = st.data, e = d.canon[cid]; if (!e) return false;
    opts = opts || {};
    if (e.kind === "region") { setRegion(e.region3d); st.subject = { kind: "canon", cid: cid }; openSheet(); return true; }
    if (e.kind === "system") { var only = {}; d.systems.forEach(function (s) { only[s.id] = s.id === e.system3d; }); st.visible = only; st.subject = { kind: "canon", cid: cid }; applyState(); ensureChunks(); openSheet(); paintBar(); return true; }
    var pick = partsForCanon(e, opts.prefer);
    if (pick.src !== st.src) setSource(pick.src, { keepSel: true, keepCam: true });
    if (!pick.idxs.length) { st.subject = { kind: "canon", cid: cid }; openSheet(); return true; }
    select(pick.idxs, { kind: "canon", cid: cid }, opts);
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
  function unhideAll() { st.hidden = {}; st.isolate = false; st.bowel = true; applyState(); paintBar(); invalidate(); }
  // parts hidden by the user (the living body's default-hidden bowel is a Layers switch, not a hide)
  function userHiddenCount() {
    var d = st.data, n = 0, dflt = {};
    if (d && st.src === "live" && !st.bowel) LIVE_BOWEL.forEach(function (id) { if (d.byId[id] != null) dflt[d.byId[id]] = 1; });
    Object.keys(st.hidden).forEach(function (k) { if (!dflt[k]) n++; });
    return n;
  }
  function setSystem(id, on) { st.visible[id] = !!on; applyState(); ensureChunks(); paintBar(); invalidate(); }

  /* ---------- UI ---------- */
  function shellHtml() {
    return '<div class="atlas-top">' +
        '<button class="atlas-back" data-a3d-act="close" aria-label="Back">‹</button>' +
        '<span class="atlas-hd"><span class="atlas-ttl">3D Anatomy</span><span class="atlas-sub" id="a3dSub">BodyParts3D reference body</span></span>' +
        '<button class="atlas-info" data-a3d-act="info" aria-label="About the 3D anatomy">' + (ico("info") || "i") + "</button></div>" +
      '<div class="a3d-search"><input id="a3dQ" type="search" placeholder="Search 3,432 structures" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Search structures">' +
        '<div class="a3d-results" id="a3dResults" hidden></div></div>' +
      '<div class="a3d-src" id="a3dSrc" role="tablist"></div>' +
      '<div class="a3d-chips" id="a3dChips"></div>' +
      '<div class="a3d-stage" id="a3dStage"><canvas id="a3dCanvas" aria-label="3D anatomy. Drag to orbit, pinch to zoom, tap a structure, double-tap to focus."></canvas>' +
        '<div class="a3d-label" id="a3dLabel" hidden></div>' +
        '<div class="a3d-progress" id="a3dProgress"></div></div>' +
      '<div class="a3d-bar" id="a3dBar"></div>' +
      '<div class="atlas-foot">Educational reference only — not for diagnosis.</div>';
  }
  function regionLabel(r) { return { HEAD: "Head", BRAIN: "Brain", NECK: "Neck", CHEST: "Chest", ABDOMEN: "Abdomen", PELVIS: "Pelvis", SPINE: "Spine", UPPER_LIMB: "Upper limb", LOWER_LIMB: "Lower limb", BODY: "Body" }[r] || r; }
  function paintSources() {
    var el = G.document.getElementById("a3dSrc"); if (!el || !st.data) return;
    if (st.data.sources.length < 2) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = st.data.sources.map(function (s) {
      return '<button class="a3d-srcbtn' + (st.src === s.id ? " on" : "") + '" role="tab" aria-selected="' + (st.src === s.id ? "true" : "false") + '" data-a3d-act="src" data-id="' + esc(s.id) + '">' + esc(s.short || s.name) + "</button>";
    }).join("");
  }
  function paintChips() {
    paintSources();
    var el = G.document.getElementById("a3dChips"); if (!el || !st.data) return;
    var want = srcIndex(), present = {};
    st.data.parts.forEach(function (p) { if (p.src === want) present[st.data.regions[p.reg]] = 1; });
    var rs = [""].concat(st.data.regions.filter(function (r) { return r !== "BODY" && present[r]; }));
    el.innerHTML = rs.map(function (r) {
      return '<button class="atlas-chip' + (st.region === r ? " on" : "") + '" data-a3d-act="region" data-r="' + esc(r) + '">' + esc(r ? regionLabel(r) : "Whole body") + "</button>";
    }).join("");
    var sub = G.document.getElementById("a3dSub");
    var srcName = (st.data.sources.filter(function (s) { return s.id === st.src; })[0] || {}).name || "";
    if (sub) sub.textContent = (st.region ? regionLabel(st.region) + " · " : "") + (st.src === "live" ? "Living-patient CT" : "BodyParts3D reference body");
  }
  function paintBar() {
    var el = G.document.getElementById("a3dBar"); if (!el || !st.data) return;
    var hidden = userHiddenCount();
    var pl = st.plane;
    var sliceRow = pl ? '<div class="a3d-slice"><span>Slice ' + pl.i + "/" + pl.n + '</span><input type="range" min="1" max="' + pl.n + '" value="' + pl.i + '" data-a3d-act="slice" aria-label="CT slice level">' +
      '<button class="a3d-btn sm" data-a3d-act="ct" data-m="' + esc(pl.m) + '" data-s="" data-i="' + pl.i + '">Open CT</button>' +
      '<button class="a3d-btn sm" data-a3d-act="planeoff" aria-label="Hide slice">×</button></div>' : "";
    el.innerHTML = sliceRow +
      '<button class="a3d-btn" data-a3d-act="systems">' + (ico("layers") || "") + "Layers</button>" +
      '<button class="a3d-btn" data-a3d-act="view" aria-label="Cycle view">' + esc({ "3q": "3/4", front: "Front", side: "Side", back: "Back", top: "Top" }[(VIEWS[st.view] || VIEWS[0]).id]) + "</button>" +
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
    var want = srcIndex();
    counts = {};
    d.parts.forEach(function (p) { if (p.src !== want) return; var id = d.systems[p.sys].id; counts[id] = (counts[id] || 0) + 1; });
    var lodRow = (d.lod && want === 0)
      ? '<li><label><input type="checkbox" data-a3d-act="lod" ' + (st.lod ? "" : "checked") + '><i style="background:#43d9c6"></i><span>Full detail</span><small>' + (st.lod ? "mobile LOD" : "2.3M triangles") + "</small></label></li>"
      : (want === 1
        ? '<li><label><input type="checkbox" data-a3d-act="shell" ' + (st.shell ? "checked" : "") + '><i style="background:#c9a58a"></i><span>Body outline</span><small>skin from the CT</small></label></li>' +
          '<li><label><input type="checkbox" data-a3d-act="bowel" ' + (st.bowel ? "checked" : "") + '><i style="background:#d9a066"></i><span>Bowel</span><small>small bowel, colon, duodenum</small></label></li>'
        : "");
    if (want === 1) delete counts.integumentary;   // the skin is the outline row, not a layer
    return '<div class="a3d-panel" id="a3dSystems"><div class="atlas-top">' +
      '<button class="atlas-back" data-a3d-act="panelclose" aria-label="Close">‹</button>' +
      '<span class="atlas-hd"><span class="atlas-ttl">Layers</span><span class="atlas-sub">' + d.systems.length + " systems</span></span></div>" +
      '<div class="atlas-scroll"><ul class="a3d-sys">' + lodRow + d.systems.filter(function (s) { return counts[s.id]; }).map(function (s) {
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
      (st.data && st.data.live ? '<p class="atlas-prose atlas-credit">Living CT: CT images and expert segmentations from the TotalSegmentator dataset (Wasserthal et al.), CC BY 4.0 - doi:10.5281/zenodo.10047292. Surfaces are meshed from the dataset\'s masks of one subject; one living patient, not a certified normal. The scan spans the lower chest to the upper thighs, so structures at its top and bottom edges (lungs, liver dome, femurs) are cut flat where the scan ends. The body outline is the patient\'s own skin, thresholded from the CT.</p>' : "") +
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
        return '<div class="a3d-linkrow"><button class="a3d-link" data-a3d-act="ct" data-m="' + esc(l.m) + '" data-s="' + esc(l.s) + '" data-i="' + l.i + '">' +
          '<b>' + esc(l.mod) + "</b><span>" + esc(l.t) + "</span><small>slice " + l.i + "</small></button>" +
          (l.plane ? '<button class="a3d-link a3d-plane" data-a3d-act="plane" data-m="' + esc(l.m) + '" data-i="' + l.i + '" aria-label="Show this slice in 3D">Show in 3D</button>' : "") + "</div>";
      }).join("");
      var note = "";
      if (ce && ce.kind === "related") note = '<p class="atlas-prose atlas-notice">' + esc(ce.note || "") + "</p>";
      else if (ce && ce.coverage === "partial" && ce.note) note = '<p class="atlas-prose atlas-notice">' + esc(ce.note) + "</p>";
      var srcNote = "";
      if (ce && ce.live && ce.live.length)
        srcNote = '<p class="atlas-prose a3d-srcnote">' + (st.src === "live"
          ? "Living-patient surface: meshed from the same CT the torso slices are cut from."
          : "Also available as a living-patient surface: switch to Living CT or tap Show in 3D on a torso row.") + "</p>";
      var rel = "";
      if (ce && ce.related && ce.related.length && !(s.kind === "part") && st.src !== "live")
        rel = '<button class="a3d-link" data-a3d-act="related" data-c="' + esc(cid) + '"><b>3D</b><span>Show related structures</span><small>' + ce.related.length + " meshes</small></button>";
      var lat = "";
      if (ce && (ce.left || ce.right))
        lat = '<div class="a3d-lat">' + (ce.left ? '<button class="atlas-pill" data-a3d-act="side" data-c="' + esc(cid) + '" data-side="left">Left</button>' : "") +
          (ce.right ? '<button class="atlas-pill" data-a3d-act="side" data-c="' + esc(cid) + '" data-side="right">Right</button>' : "") +
          '<button class="atlas-pill" data-a3d-act="side" data-c="' + esc(cid) + '" data-side="both">Both</button></div>';
      body = (cid ? '<div class="a3d-canon">RadioAnatome structure: <b>' + esc((ce && ce.name) || cid) + "</b></div>" : "") +
        (rows ? '<div class="a3d-links">' + rows + "</div>" : '<div class="atlas-empty">' + (cid ? "Not labelled in any CT or MRI module yet." : "No matching RadioAnatome structure. Search the CT and MRI modules by name instead.") + "</div>") +
        srcNote + (st.src === "live" && ce && ce.kind === "related" ? "" : note) + rel + lat;
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
        (st.src === "live" ? '<span class="atlas-pill live">Living CT</span>' : "") +
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
    try { if (G.ATLAS && G.ATLAS._bindSheetDrag) G.ATLAS._bindSheetDrag(el, 330, function () { select([], null); }); } catch (e) {}
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
      if (h.type === "canon") return '<button class="a3d-hit canon" data-a3d-act="canon" data-c="' + esc(h.cid) + '"><span>' + esc(h.name) + "</span><small>CT / MRI · " + h.n + " modules</small></button>";
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
    if (act === "reset") { st.region = ""; st.isolate = false; st.hidden = {}; st.explodeTarget = 0; liveDefaults(); select([], null); applyState(); paintChips(); if (st.src === "live") focusSource(); else resetCamera(); return; }
    if (act === "tab") { st._tab = t.getAttribute("data-tab"); openSheet(); return; }
    if (act === "view") { cycleView(); return; }
    if (act === "planeoff") { clearPlane(); return; }
    if (!d) return;
    if (act === "src") { hideResults(); setSource(t.getAttribute("data-id")); return; }
    if (act === "canon") { hideResults(); st._tab = "correlate"; selectCanon(t.getAttribute("data-c")); return; }
    if (act === "plane") { setPlane(t.getAttribute("data-m"), +t.getAttribute("data-i")); if (st.subject) openSheet(); return; }
    if (act === "part") { hideResults(); select([+t.getAttribute("data-i")], { kind: "part", i: +t.getAttribute("data-i") }); return; }
    if (act === "concept") { hideResults(); dropPanel("a3dSystems"); selectConcept(t.getAttribute("data-id")); return; }
    if (act === "related") { var ce = d.canon[t.getAttribute("data-c")]; if (ce && ce.related) select(ce.related, { kind: "canon", cid: t.getAttribute("data-c") }); return; }
    if (act === "side") {
      var cid = t.getAttribute("data-c"), side = t.getAttribute("data-side"), en = d.canon[cid]; if (!en) return;
      var live = st.src === "live";
      var idxs = side === "both" ? (live ? (en.live || []) : (en.parts || en.related || [])) : ((en[side] && (live ? en[side].live : en[side].parts)) || []);
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
    if (act === "shell") { st.shell = !!t.checked; applyState(); ensureChunks(); invalidate(); }
    if (act === "bowel") { st.bowel = !!t.checked; liveDefaults(); applyState(); invalidate(); }
    if (act === "lod") { setLod(!t.checked); var sm = t.parentNode && t.parentNode.querySelector("small"); if (sm) sm.textContent = st.lod ? "mobile LOD" : "2.3M triangles"; }
    if (act === "explode") { st.explodeTarget = (+t.value || 0) / 100; schedule(); }
    if (act === "slice" && st.plane) { setPlane(st.plane.m, +t.value, { noFocus: true }); if (st.subject) openSheet(); }
  }
  function onInput(e) {
    var t = e.target; if (!t || t.id !== "a3dQ") return;
    paintResults(t.value);
  }
  function onSliceInput(e) {
    var t = e.target; if (!t || t.getAttribute("data-a3d-act") !== "slice" || !st.plane) return;
    var lbl = t.parentNode && t.parentNode.querySelector("span"); if (lbl) lbl.textContent = "Slice " + t.value + "/" + st.plane.n;
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
    el.removeEventListener("input", onSliceInput); el.addEventListener("input", onSliceInput);
    el.innerHTML = shellHtml();
    el.classList.add("on");
    st.err = ""; st.base = null; st.sel = []; st.subject = null; st.isolate = false; st.hidden = {}; st.region = ""; st.explodeTarget = 0; st.explode = 0;
    st.plane = null; st.src = "bp3d"; st.view = 0;
    try { var lodPref = G.localStorage && G.localStorage.getItem("smd_atlas3d_lod"); st.lod = lodPref == null ? isTouch() : lodPref === "1"; } catch (e3) { st.lod = isTouch(); }
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
      // Opened from a living-torso slice: land on the living body with THAT slice as the cut.
      var fromLive = opts.from && d.planes[opts.from.m] && d.planes[opts.from.m][String(opts.from.i)];
      if (opts.src === "live" || fromLive) setSource("live", { keepCam: true });
      if (opts.canon && d.canon[opts.canon]) selectCanon(opts.canon, { noFocus: !!fromLive, prefer: fromLive ? "live" : opts.src });
      else if (opts.region) setRegion(opts.region);
      if (fromLive) setPlane(opts.from.m, opts.from.i);
      else if (!opts.canon && st.src === "live") focusSource();
      if (opts.partId != null && d.byId[opts.partId] != null) select([d.byId[opts.partId]], { kind: "part", i: d.byId[opts.partId] });
      ensureChunks().then(function () { paintProgress(); if (st.sel.length && !st.plane) focusOn(st.sel, { pad: 1.25 }); invalidate(); });
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
  G.ATLAS3D.setSource = setSource;
  G.ATLAS3D.setPlane = setPlane;
  G.ATLAS3D.setLod = setLod;
  G.ATLAS3D._state = st;
  G.ATLAS3D._select = select;
  G.ATLAS3D._sheetHtml = sheetHtml;
  G.ATLAS3D._pickAt = pickAt;
  G.ATLAS3D._tick = tick;
  G.ATLAS3D._pure = {
    canonicalOf: canonicalOf, parseManifest: parseManifest, search: search, unionBounds: unionBounds,
    fitDistance: fitDistance, encodePick: encodePick, decodePick: decodePick, canonOfPart: canonOfPart,
    linksFor: linksFor, regionParts: regionParts, perspective: perspective, lookAt: lookAt, mul: mul, eyeFrom: eyeFrom,
    looksLikeChunk: looksLikeChunk, dataBases: dataBases, dataUrl: dataUrl
  };
  G.ATLAS3D._version = "1.0";

  if (typeof module !== "undefined" && module.exports) module.exports = G.ATLAS3D._pure;
})(typeof window !== "undefined" ? window : this);
