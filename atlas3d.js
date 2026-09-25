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

  // Opacity of everything that is NOT selected. null = the untouched default: today's 16% ghost
  // when something is selected, fully opaque otherwise. The X-ray slider sets a number.
  function ghostAlpha(hasSel, xray) {
    if (xray == null) return hasSel ? 0.16 : 1;
    return Math.max(0.04, Math.min(1, +xray || 0));
  }
  // Free cut plane across the active body's bounds b ([minx,miny,minz,maxx,maxy,maxz]). Returns
  // [nx,ny,nz,w]; the shader discards a fragment when dot(p, n) > w. Unflipped it removes the
  // +axis side: above (axial, y), in front (coronal, z), the patient's left (sagittal, x).
  function freeClip(axis, t, flip, b) {
    if (!b) return null;
    var k = axis === "x" ? 0 : axis === "z" ? 2 : 1;
    var pos = b[k] + (b[k + 3] - b[k]) * Math.max(0, Math.min(1, +t || 0));
    var n = [0, 0, 0]; n[k] = flip ? -1 : 1;
    return [n[0], n[1], n[2], flip ? -pos : pos];
  }
  // Undo history for hide / fade / isolate / show all: snapshots, oldest dropped past max.
  function layerSnap(s) { return { hidden: Object.assign({}, s.hidden), faded: Object.assign({}, s.faded), isolate: !!s.isolate, bowel: !!s.bowel }; }
  function pushHist(stack, snap, max) { stack.push(snap); while (stack.length > (max || 30)) stack.shift(); return stack; }
  function progressLabel(done, total) {
    var pct = total > 0 ? Math.max(0, Math.min(100, Math.floor(done / total * 100))) : 0;
    function mb(b) { return (b / 1048576).toFixed(1); }
    return { pct: pct, text: "Loading 3D anatomy " + pct + "%" + (total > 0 ? " (" + mb(done) + " of " + mb(total) + " MB)" : "") };
  }
  // Saved views store part IDS, not indices, so a view survives a manifest that re-orders parts.
  function serializeView(s, d, name) {
    function ids(set) { return Object.keys(set || {}).filter(function (k) { return set[k] && d.parts[+k]; }).map(function (k) { return d.parts[+k].id; }); }
    var sub = s.subject, subj = null;
    if (sub && sub.kind === "part" && d.parts[sub.i]) subj = { kind: "part", id: d.parts[sub.i].id };
    else if (sub && sub.kind === "canon") subj = { kind: "canon", cid: sub.cid };
    else if (sub && sub.kind === "concept") subj = { kind: "concept", id: sub.id };
    var c = s.cam;
    return {
      v: 1, name: String(name || "").trim().slice(0, 40) || "View", src: s.src,
      cam: { target: c.target.slice(), yaw: c.yaw, pitch: c.pitch, dist: c.dist },
      sel: s.sel.filter(function (i) { return d.parts[i]; }).map(function (i) { return d.parts[i].id; }), subject: subj,
      hidden: ids(s.hidden), faded: ids(s.faded), isolate: !!s.isolate,
      clip: s.clip ? { axis: s.clip.axis, t: s.clip.t, flip: !!s.clip.flip } : null,
      xray: s.xray == null ? null : s.xray, region: s.region || "", explode: s.explodeTarget || 0,
      bowel: !!s.bowel, shell: s.shell !== false, plane: s.plane ? { m: s.plane.m, i: s.plane.i } : null
    };
  }
  // Validates a stored view against the loaded manifest; unknown parts are dropped, bad input -> null.
  function restoreView(v, d) {
    if (!v || v.v !== 1 || !v.cam || !Array.isArray(v.cam.target)) return null;
    function fin(x, dflt) { x = +x; return isFinite(x) ? x : dflt; }
    function idx(list) { var o = []; (Array.isArray(list) ? list : []).forEach(function (id) { var i = d.byId[id]; if (i != null) o.push(i); }); return o; }
    function set(list) { var o = {}; idx(list).forEach(function (i) { o[i] = 1; }); return o; }
    var src = d.sources.some(function (x) { return x.id === v.src; }) ? v.src : "bp3d";
    var sel = idx(v.sel), sj = v.subject, subject = null;
    if (sj && sj.kind === "part" && d.byId[sj.id] != null) subject = { kind: "part", i: d.byId[sj.id] };
    else if (sj && sj.kind === "canon" && d.canon[sj.cid]) subject = { kind: "canon", cid: sj.cid };
    else if (sj && sj.kind === "concept" && d.conceptById[sj.id]) subject = { kind: "concept", id: sj.id };
    var cl = v.clip && /^[xyz]$/.test(v.clip.axis) ? { axis: v.clip.axis, t: Math.max(0, Math.min(1, fin(v.clip.t, 0.5))), flip: !!v.clip.flip } : null;
    var pl = v.plane && d.planes[v.plane.m] && d.planes[v.plane.m][String(v.plane.i)] ? { m: v.plane.m, i: +v.plane.i } : null;
    return {
      src: src, cam: { target: [0, 1, 2].map(function (k) { return fin(v.cam.target[k], 0); }), yaw: fin(v.cam.yaw, 0.45), pitch: Math.max(-1.45, Math.min(1.45, fin(v.cam.pitch, 0.12))), dist: Math.max(0.05, Math.min(12, fin(v.cam.dist, 2.7))) },
      sel: sel, subject: sel.length ? subject : null, hidden: set(v.hidden), faded: set(v.faded), isolate: !!v.isolate && sel.length > 0,
      clip: cl, xray: v.xray == null ? null : Math.max(0.04, Math.min(1, fin(v.xray, 1))), region: d.regions.indexOf(v.region) >= 0 ? v.region : "",
      explode: Math.max(0, Math.min(1, fin(v.explode, 0))), bowel: !!v.bowel, shell: v.shell !== false, plane: pl
    };
  }
  // "Find it" quiz: canonical structures a student can be asked to tap. Only names that are
  // unique across the ontology, only whole structures (a partial reference mesh, a region or a
  // "related" stand-in would make a correct tap ambiguous), and only if every mesh is on screen.
  function quizPool(d, want, isVis) {
    var byName = {};
    Object.keys(d.canon).forEach(function (cid) { var n = String(d.canon[cid].name || "").toLowerCase(); byName[n] = (byName[n] || 0) + 1; });
    return Object.keys(d.canon).filter(function (cid) {
      var e = d.canon[cid];
      if (e.kind !== "concept" && e.kind !== "composite") return false;
      if (!e.name || byName[e.name.toLowerCase()] !== 1 || /[()]/.test(e.name)) return false;
      var idxs = quizParts(e, want);
      return idxs.length > 0 && idxs.every(isVis);
    }).sort();
  }
  function quizParts(e, want) { return want === 1 ? (e.live || []) : (e.coverage === "full" ? (e.parts || []) : []); }
  function fileSlug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "view"; }
  // CC BY 4.0 credit burned into an exported image (a redistribution), per body. Reference: the
  // licence-mandated string, verbatim. Living CT: built from the source fields the pipeline wrote
  // into live.json (dataset, licence, doi), never a hand-written paraphrase.
  var BP3D_ATTRIBUTION = "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International";
  function creditLine(d, src) {
    if (src === "live") {
      var s = (d && d.live && d.live.source) || {};
      return [s.dataset, s.licence, s.doi ? "doi:" + s.doi : ""].filter(Boolean).join(", ");
    }
    return (d && d.source && d.source.attribution) || BP3D_ATTRIBUTION;
  }
  // Greedy word wrap with an injected width measure (canvas measureText in the app).
  function wrapLines(text, maxW, measure) {
    var out = [], cur = "";
    String(text || "").split(" ").forEach(function (w) {
      var t = cur ? cur + " " + w : w;
      if (cur && measure(t) > maxW) { out.push(cur); cur = w; } else cur = t;
    });
    if (cur) out.push(cur);
    return out;
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
    subject: null, dirty: true, raf: 0, err: "", progress: 0, _tab: "about", _prevFocus: null, from: null,
    // premium controls; each null/empty value leaves the default view exactly as before
    faded: {}, xray: null, clip: null, hist: [], quiz: null, failed: {}, lost: false,
    bytesDone: 0, bytesTotal: 0, counted: {}, _ghostA: 0.16, _othersOpaque: 1, _bounds: {}
  };
  var HINT_KEY = "smd_atlas3d_hint", VIEWS_KEY = "smd_atlas3d_views", MAX_VIEWS = 20;

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
  // Chunk filenames carry their content hash (pack3d.mjs / bp3d_import.py), so a re-mesh lands
  // under a new URL and never overwrites the R2 object an installed app's manifest points at.
  function dataUrl(u, base) { return base ? base + u.replace(/^\/atlas\/3d/, "") : u; }
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
    if (typeof G.DecompressionStream === "undefined" || typeof G.Blob === "undefined") {
      var no = new Error("This browser cannot decompress the 3D data."); no.fatal = true;
      return Promise.reject(no);
    }
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
      return G.fetch(dataUrl(c.url, base)).then(function (r) {
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
      var base = bases[i++], url = dataUrl(c.url, base), cacheable = base === R2_BASE;
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
      delete st.loading[key];
      // A chunk that lands while the GL context is lost is dropped; the restore re-uploads it
      // (from the on-device cache) into the new context.
      if (!st.gl || st.lost) return;
      uploadChunk(c, raw);
      delete st.failed[key];
      st.bytesDone += c.gz || c.bytes;
      // invalidate(), not a bare dirty flag: a chunk that lands after the camera has settled
      // must schedule its own frame, or the organs never appear (seen on the iPhone, where
      // the network is slower than the camera animation).
      st.loaded++; settleFrames(); paintProgress();
    }).catch(function (e) {
      delete st.loading[key];
      // One bad chunk must not blank the whole layer: it is recorded and offered for Retry,
      // everything that loaded stays usable. Only a browser that cannot decompress at all is fatal.
      if (e && e.fatal) st.err = e.message; else st.failed[key] = 1;
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
    // failed chunks wait for the Retry button instead of being re-fetched on every tap
    chunkSet().forEach(function (c) { if ((c.src || 0) === want && sysNeeded[c.system] && !st.chunks[c.id] && !st.failed[c.id]) need.push(c); });
    return need;
  }
  function ensureChunks() {
    var need = neededChunks();
    if (!need.length) return Promise.resolve();
    // progress is in bytes: every chunk of this batch counts its gz size once
    need.forEach(function (c) { if (!st.counted[c.id]) { st.counted[c.id] = 1; st.bytesTotal += c.gz || c.bytes; } });
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
    "varying vec3 vN; varying vec3 vP; varying vec3 vState; varying vec3 vPick; varying float vFade;",
    "void main(){",
    " vec2 uv = vec2((mod(aPid, " + STATE_W + ".0) + 0.5) / " + STATE_W + ".0, (floor(aPid / " + STATE_W + ".0) + 0.5) / " + STATE_W + ".0);",
    " vec4 st4 = texture2D(uState, uv); vState = st4.rgb; vFade = st4.a < 0.5 ? 1.0 : 0.0;",   // alpha 0 = user-faded part
    " float id = aPid + 1.0; float g = floor(id / 256.0); float b = id - g * 256.0;",
    " vPick = vec3(0.0, g / 255.0, b / 255.0);",
    " vec3 p = aPos + uOffset; vP = p; vN = aNrm;",
    " gl_Position = uVP * vec4(p, 1.0);",
    "}"].join("\n");
  var FS = [
    "precision mediump float;",
    "varying vec3 vN; varying vec3 vP; varying vec3 vState; varying float vFade;",
    "uniform vec3 uColor; uniform vec3 uEye; uniform vec3 uBg; uniform vec3 uSel; uniform float uPass; uniform float uGhost; uniform vec4 uClip; uniform float uClipOn;",
    "uniform float uClipSel; uniform float uOthers;",
    "void main(){",
    " if (vState.r < 0.5) discard;",
    " bool sel = vState.g > 0.5; bool fade = vFade > 0.5 && !sel;",
    // the registered CT cut spares the selection (uClipSel); the free cut plane cuts everything
    " if (uClipOn > 0.5 && dot(vP, uClip.xyz) > uClip.w && !(uClipSel > 0.5 && sel)) discard;",
    " float shell = (vState.b > 0.4 && vState.b < 0.75) ? 1.0 : 0.0;", // body outline (living CT skin)
    " if (uPass < 3.5 && shell > 0.5) discard;",                     // shell renders only in pass 4
    " if (uPass > 3.5 && shell < 0.5) discard;",
    // pass 1: opaque = the selection, plus everything else unless it is x-rayed (uOthers 0); never a faded part
    " if (uPass > 0.5 && uPass < 1.5 && !sel && (fade || uOthers < 0.5)) discard;",
    // pass 2: translucent = the x-rayed rest and the faded parts
    " if (uPass > 1.5 && uPass < 2.5 && (sel || (!fade && uOthers > 0.5))) discard;",
    " if (uPass > 2.5 && uPass < 3.5 && !sel) discard;",   // pass 3: selection as a see-through ghost (over the slice)
    " vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;",
    " vec3 L = normalize(vec3(-0.45, 0.8, 0.55)); vec3 V = normalize(uEye - vP);",
    " float diff = max(dot(n, L), 0.0); float hemi = 0.5 + 0.5 * n.y;",
    " vec3 H = normalize(L + V); float spec = pow(max(dot(n, H), 0.0), 40.0) * 0.22;",
    " vec3 c = uColor * (0.32 + 0.22 * hemi + 0.58 * diff) + spec;",
    " c = mix(c, uSel * (0.55 + 0.6 * diff) + spec, vState.g * 0.72);",
    " float dim = shell > 0.5 ? 0.0 : vState.b;",                   // the membrane is never the dim-unselected grey
    " c = mix(c, uBg, dim * 0.35);",
    " float a = uPass > 1.5 ? (fade ? min(uGhost, 0.14) : uGhost) : 1.0;",
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
    "varying vec3 vState; varying vec3 vPick; varying vec3 vP; varying float vFade; uniform vec4 uClip; uniform float uClipOn;",
    // faded parts are see-through, so a tap passes through them to what is behind
    "void main(){ if (vState.r < 0.5) discard; if (vState.b > 0.4 && vState.b < 0.75) discard; if (vFade > 0.5 && vState.g < 0.5) discard; if (uClipOn > 0.5 && dot(vP, uClip.xyz) > uClip.w) discard; gl_FragColor = vec4(vPick, 1.0); }"].join("\n");
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
    ["uVP", "uOffset", "uState", "uColor", "uEye", "uBg", "uSel", "uPass", "uGhost", "uClip", "uClipOn", "uClipSel", "uOthers", "uTex", "uAlpha"].forEach(function (n) { u[n] = gl.getUniformLocation(p, n); });
    return { p: p, u: u };
  }

  function initGL(canvas) {
    var gl = canvas.getContext("webgl", { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("This device could not start the 3D viewer (WebGL unavailable).");
    canvas.addEventListener("webglcontextlost", onContextLost, false);
    canvas.addEventListener("webglcontextrestored", onContextRestored, false);
    return buildGL(gl);
  }
  // Everything that lives inside a GL context. Called once per context: at open, and again on
  // the SAME context object after webglcontextrestored (every program/buffer/texture is gone then).
  function buildGL(gl) {
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
    return R;
  }
  // iOS drops the GL context when the app is backgrounded or memory runs short. preventDefault
  // asks the browser to hand it back; on restore the scene is rebuilt in place and the geometry
  // re-read (from the on-device model cache where it came from R2), so nobody closes/reopens.
  function onContextLost(e) {
    e.preventDefault();
    if (e.target !== st.canvas) return;      // close() -> disposeGL() loses its own context on purpose
    st.lost = true; st.chunks = {}; st.loaded = 0;
    if (st.raf && G.cancelAnimationFrame) G.cancelAnimationFrame(st.raf); st.raf = 0;
    clearTimeout(st._lostTimer);
    // A browser that never restores gets a fresh canvas instead.
    st._lostTimer = setTimeout(replaceCanvas, 5000);
    paintProgress();
  }
  function onContextRestored(e) {
    if (e.target !== st.canvas || !st.gl) return;
    clearTimeout(st._lostTimer);
    try { st.gl = buildGL(st.gl.gl); } catch (x) { st.err = x.message; paintProgress(); return; }
    afterRestore();
  }
  // ponytail: last resort for a context that is never restored; a new canvas means a new context.
  function replaceCanvas() {
    var old = st.canvas; if (!st.lost || !old || !old.parentNode || !isOpen()) return;
    var cv = old.cloneNode(false);
    old.parentNode.replaceChild(cv, old); st.canvas = cv;
    try { st.gl = initGL(cv); } catch (x) { st.err = x.message; paintProgress(); return; }
    bindInput(cv); resizeCanvas();
    afterRestore();
  }
  function afterRestore() {
    // st.loading is kept: a fetch still in flight uploads into the new context when it lands
    st.lost = false; st.chunks = {}; st.loaded = 0; st.counted = {}; st.bytesDone = st.bytesTotal = 0;
    applyState();
    if (st.plane) loadSliceTexture();
    ensureChunks().then(function () { paintProgress(); settleFrames(); });
    paintProgress(); settleFrames();
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
      buf[o + 3] = st.faded[i] && !shell ? 0 : 255;          // alpha 0 = faded by the user
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
  function hasKeys(o) { for (var k in o) if (o[k]) return true; return false; }

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
    gl.uniform1f(prog.u.uClipOn, clip ? 1 : 0);
    if (!pick) {
      // The CT cut removes the near half of the BODY, never of the structure the user asked
      // about: selected fragments ignore it, so moving the slice away from a kidney leaves the
      // kidney standing above the cut instead of a label over an empty slice.
      gl.uniform1f(prog.u.uClipSel, planeInfo() ? 1 : 0);
      gl.uniform1f(prog.u.uOthers, st._othersOpaque ? 1 : 0);
      gl.uniform3fv(prog.u.uEye, new Float32Array(eye));
      gl.uniform3f(prog.u.uBg, 0.07, 0.08, 0.09);
      gl.uniform3fv(prog.u.uSel, new Float32Array(SEL_TINT));
      gl.uniform1f(prog.u.uPass, pass || 0);
      gl.uniform1f(prog.u.uGhost, pass === 3 ? 0.42 : pass === 4 ? 0.26 : st._ghostA);
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
    var hasSel = st.sel.length > 0 && !st.isolate, ga = ghostAlpha(hasSel, st.xray);
    st._ghostA = ga; st._othersOpaque = ga >= 0.999;
    if (hasSel || !st._othersOpaque || (!st.isolate && hasKeys(st.faded))) {
      // Selection opaque first, then the rest as a translucent ghost with depth writes off,
      // so a kidney behind the colon is still visible when the CT side highlights it. The
      // X-ray slider sets the ghost's opacity; faded parts always draw in the ghost pass.
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
    var gl = pickPass(), h = st.canvas.height;
    var px = new Uint8Array(4);
    gl.readPixels(Math.round(x), Math.round(h - y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    invalidate();
    return decodePick(px[0], px[1], px[2]);
  }
  // Pixels per part in the current view's pick buffer: what a finger can actually reach.
  function pickCounts() {
    var R = st.gl; if (!R || !st.canvas) return {};
    var gl = pickPass(), w = st.canvas.width, h = st.canvas.height, px = new Uint8Array(w * h * 4), out = {};
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    invalidate();
    for (var i = 0; i < px.length; i += 4) { var id = decodePick(px[i], px[i + 1], px[i + 2]); if (id >= 0) out[id] = (out[id] || 0) + 1; }
    return out;
  }
  function pickPass() {
    var R = st.gl, gl = R.gl, w = st.canvas.width, h = st.canvas.height;
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
    return gl;
  }
  // Draw a frame and read it back in the same task: the drawing buffer is still intact until the
  // browser composites, so no preserveDrawingBuffer (which costs every frame on mobile) is needed.
  function readFrame() {
    var R = st.gl; if (!R || !st.canvas || st.lost) return null;
    render();
    var gl = R.gl, w = st.canvas.width, h = st.canvas.height, px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { w: w, h: h, px: px };
  }

  /* ---------- cut plane (registered CT slice) ---------- */
  function planeInfo() {
    var pl = st.plane; if (!pl || !st.data) return null;
    var byMod = st.data.planes[pl.m]; if (!byMod) return null;
    return byMod[String(pl.i)] || null;
  }
  // Keep the half of the body on the far side of the plane from the camera, so the cut face
  // (and the slice drawn on it) faces the viewer whichever way the body is turned.
  // A registered CT slice wins; with none showing, the user's free cut plane (if any) applies.
  function clipPlane(eye) {
    var p = planeInfo();
    if (!p) return st.clip ? freeClip(st.clip.axis, st.clip.t, st.clip.flip, srcBounds()) : null;
    var n = p.axis === "x" ? [1, 0, 0] : p.axis === "z" ? [0, 0, 1] : [0, 1, 0];
    var side = dot(eye, n) - p.pos;
    if (side < 0) { n = [-n[0], -n[1], -n[2]]; }
    return [n[0], n[1], n[2], dot(n, p.axis === "x" ? [p.pos, 0, 0] : p.axis === "z" ? [0, 0, p.pos] : [0, p.pos, 0])];
  }
  function srcBounds() {
    var want = srcIndex();
    if (!st._bounds[want]) st._bounds[want] = unionBounds(st.data, st.data.parts.filter(function (p) { return p.src === want; }).map(function (p) { return p.i; }));
    return st._bounds[want];
  }
  function loadSliceTexture() {
    var R = st.gl, pl = st.plane; if (!R || !pl) return;
    var d = st.data, mod = (G.ATLAS && G.ATLAS._state && G.ATLAS._state.catalog) || null;
    // A plane names its own image (densified stacks live under v2/ at new indices); an installed
    // app's bundled manifest has no img, and its old paths are never rewritten, so the pattern
    // stays as the fallback.
    var entry = d.planes[pl.m] && d.planes[pl.m][String(pl.i)];
    var url = (entry && entry.img) || "/atlas/" + pl.m + "/" + ("00" + pl.i).slice(-3) + ".webp";
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
        if (st.quiz) { quizTap(hit); return; }      // quiz mode: a tap is an answer, not a selection
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
  function remember() { pushHist(st.hist, layerSnap(st), 30); }
  function toggleIsolate() { if (!st.sel.length) return; remember(); st.isolate = !st.isolate; applyState(); paintBar(); if (st.isolate) focusOn(st.sel, { pad: 1.2 }); invalidate(); }
  function hideSelected() { if (!st.sel.length) return; remember(); st.sel.forEach(function (i) { st.hidden[i] = true; }); select([], null); }
  function allFaded() { return st.sel.length > 0 && st.sel.every(function (i) { return st.faded[i]; }); }
  // Fade = see-through but still there. A faded selection is deselected so the fade shows;
  // tapping Fade on an already faded structure (re-selected) restores it.
  function toggleFade() {
    if (!st.sel.length) return;
    remember();
    if (allFaded()) { st.sel.forEach(function (i) { delete st.faded[i]; }); applyState(); if (st.subject) openSheet(); paintBar(); return; }
    st.sel.forEach(function (i) { st.faded[i] = 1; });
    select([], null);
  }
  // "Show all": every user hide, fade and isolate undone at once (itself undoable).
  function unhideAll() { remember(); st.hidden = {}; st.faded = {}; st.isolate = false; st.bowel = true; applyState(); paintBar(); if (st.subject) openSheet(); invalidate(); }
  function undo() {
    var s = st.hist.pop(); if (!s) return;
    st.hidden = s.hidden; st.faded = s.faded; st.bowel = s.bowel; st.isolate = s.isolate && st.sel.length > 0;
    applyState(); ensureChunks(); paintBar(); if (st.subject) openSheet(); invalidate();
  }
  function fadedCount() { var n = 0, want = srcIndex(); for (var k in st.faded) if (st.faded[k] && st.data.parts[+k] && st.data.parts[+k].src === want) n++; return n; }
  // parts hidden by the user (the living body's default-hidden bowel is a Layers switch, not a hide)
  // Counts only the body on screen: after Reset on the reference body the living bowel defaults
  // sit in st.hidden too, and must not show up as "Show all 3".
  function userHiddenCount() {
    var d = st.data, n = 0, dflt = {}, want = srcIndex();
    if (d && !st.bowel) LIVE_BOWEL.forEach(function (id) { if (d.byId[id] != null) dflt[d.byId[id]] = 1; });
    Object.keys(st.hidden).forEach(function (k) { if (st.hidden[k] && !dflt[k] && d && d.parts[+k] && d.parts[+k].src === want) n++; });
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
        '<div class="a3d-quiz" id="a3dQuiz" role="region" aria-label="Find it quiz" hidden></div>' +
        '<div class="a3d-progress" id="a3dProgress"></div></div>' +
      '<div class="a3d-bar" id="a3dBar"></div>' +
      '<div class="atlas-foot">Educational reference only, not for diagnosis.</div>';
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
    var hidden = userHiddenCount(), faded = fadedCount();
    var pl = st.plane, on = function (b) { return b ? " on" : ""; }, pr = function (b) { return ' aria-pressed="' + (b ? "true" : "false") + '"'; };
    var sliceRow = pl ? '<div class="a3d-slice"><span>Slice ' + pl.i + "/" + pl.n + '</span><input type="range" min="1" max="' + pl.n + '" value="' + pl.i + '" data-a3d-act="slice" aria-label="CT slice level">' +
      '<button class="a3d-btn sm" data-a3d-act="ct" data-m="' + esc(pl.m) + '" data-s="" data-i="' + pl.i + '">Open CT</button>' +
      '<button class="a3d-btn sm" data-a3d-act="planeoff" aria-label="Hide slice">×</button></div>' : "";
    var xr = Math.round((1 - ghostAlpha(st.sel.length > 0 && !st.isolate, st.xray)) * 100);
    el.innerHTML = sliceRow + clipRowHtml() +
      '<div class="a3d-tools">' +
        (st.hist.length ? '<button class="a3d-btn accent" data-a3d-act="undo" aria-label="Undo the last hide, fade or isolate">Undo</button>' : "") +
        (hidden || faded ? '<button class="a3d-btn" data-a3d-act="unhide" aria-label="Show all hidden and faded structures">Show all ' + (hidden + faded) + "</button>" : "") +
        '<button class="a3d-btn" data-a3d-act="systems" aria-label="Layers and saved views">' + (ico("layers") || "") + "Layers</button>" +
        '<button class="a3d-btn" data-a3d-act="view" aria-label="Cycle view">' + esc({ "3q": "3/4", front: "Front", side: "Side", back: "Back", top: "Top" }[(VIEWS[st.view] || VIEWS[0]).id]) + "</button>" +
        '<button class="a3d-btn' + on(st.isolate) + '" data-a3d-act="isolate"' + (st.sel.length ? "" : " disabled") + pr(st.isolate) + ">Isolate</button>" +
        '<button class="a3d-btn' + on(st.clip) + '" data-a3d-act="clip"' + pr(!!st.clip) + ' aria-label="Cut plane">Cut</button>' +
        '<button class="a3d-btn' + on(st.quiz) + '" data-a3d-act="quiz"' + pr(!!st.quiz) + ' aria-label="Find it quiz">' + ico("target") + "Quiz</button>" +
        '<button class="a3d-btn icon" data-a3d-act="snap" aria-label="Save or share an image of this view">' + (ico("camera") || "Image") + "</button>" +
        '<button class="a3d-btn" data-a3d-act="reset">Reset</button>' +
      "</div>" +
      '<div class="a3d-sliders">' +
        '<label class="a3d-explode"><span>Explode</span><input type="range" min="0" max="100" value="' + Math.round(st.explodeTarget * 100) + '" data-a3d-act="explode" aria-label="Explode systems"></label>' +
        '<label class="a3d-explode"><span>X-ray</span><input type="range" min="0" max="96" value="' + xr + '" data-a3d-act="xray" aria-label="X-ray: see through everything that is not selected" aria-valuetext="' + xr + ' percent"></label>' +
      "</div>";
  }
  function clipRowHtml() {
    var c = st.clip; if (!c) return "";
    return '<div class="a3d-cliprow" role="group" aria-label="Cut plane">' +
      '<div class="a3d-seg" role="radiogroup" aria-label="Cut direction">' + [["y", "Axial"], ["z", "Coronal"], ["x", "Sagittal"]].map(function (a) {
        return '<button class="a3d-segbtn' + (c.axis === a[0] ? " on" : "") + '" role="radio" aria-checked="' + (c.axis === a[0] ? "true" : "false") + '" data-a3d-act="clipaxis" data-ax="' + a[0] + '">' + a[1] + "</button>";
      }).join("") + "</div>" +
      '<button class="a3d-btn sm' + (c.flip ? " on" : "") + '" data-a3d-act="clipflip" aria-pressed="' + (c.flip ? "true" : "false") + '" aria-label="Flip which side is cut away">Flip</button>' +
      '<button class="a3d-btn sm" data-a3d-act="clipoff" aria-label="Remove the cut plane">×</button>' +
      '<label class="a3d-cutpos"><span>Position</span><input type="range" min="0" max="100" value="' + Math.round(c.t * 100) + '" data-a3d-act="clippos" aria-label="Cut position"' + (st.plane ? " disabled" : "") + "></label>" +
      (st.plane ? '<small class="a3d-note">Paused while the CT slice is shown</small>' : "") + "</div>";
  }
  function paintProgress() {
    var el = G.document.getElementById("a3dProgress"); if (!el) return;
    el.removeAttribute("role"); el.removeAttribute("aria-valuenow"); el.removeAttribute("aria-valuemin"); el.removeAttribute("aria-valuemax"); el.removeAttribute("aria-label");
    if (st.err) { el.hidden = false; el.className = "a3d-progress err"; el.setAttribute("role", "alert"); el.textContent = st.err; return; }
    if (st.lost) { el.hidden = false; el.className = "a3d-progress"; el.setAttribute("role", "status"); el.textContent = "Restoring the 3D view"; return; }
    var d = st.data, inflight = Object.keys(st.loading).length;
    if (!d || inflight || neededChunks().length) {
      var p = progressLabel(st.bytesDone, st.bytesTotal);
      el.hidden = false; el.className = "a3d-progress";
      el.setAttribute("role", "progressbar"); el.setAttribute("aria-label", "Loading 3D anatomy");
      el.setAttribute("aria-valuemin", "0"); el.setAttribute("aria-valuemax", "100"); el.setAttribute("aria-valuenow", String(p.pct));
      el.innerHTML = "<span>" + esc(d ? p.text : "Loading 3D anatomy") + '</span><i class="a3d-pbar" aria-hidden="true"><b style="width:' + p.pct + '%"></b></i>';
      return;
    }
    st.bytesDone = st.bytesTotal = 0; st.counted = {};
    if (hasKeys(st.failed)) {
      el.hidden = false; el.className = "a3d-progress warn"; el.setAttribute("role", "status");
      el.innerHTML = "<span>Some anatomy failed to load</span>" + '<button class="a3d-retry" data-a3d-act="retry" aria-label="Retry loading the missing anatomy">' + ico("refresh") + "Retry</button>";
      return;
    }
    el.hidden = true;
  }
  function retryFailed() {
    st.failed = {}; st.base = null;          // try every host again, not just the one that failed
    ensureChunks().then(paintProgress);
    paintProgress();
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
      '<div class="atlas-scroll">' + viewsHtml() + '<h3 class="a3d-h">Layers</h3><ul class="a3d-sys">' + lodRow + d.systems.filter(function (s) { return counts[s.id]; }).map(function (s) {
        return '<li><label><input type="checkbox" data-a3d-act="sys" data-id="' + esc(s.id) + '"' + (st.visible[s.id] ? " checked" : "") + ">" +
          '<i style="background:' + esc(s.color) + '"></i><span>' + esc(s.name) + "</span><small>" + (counts[s.id] || 0) + "</small></label></li>";
      }).join("") + "</ul></div></div>";
  }
  /* ---------- saved views (localStorage, per device) ---------- */
  function loadViews() {
    try { var a = JSON.parse(G.localStorage.getItem(VIEWS_KEY) || "[]"); return Array.isArray(a) ? a.filter(function (v) { return v && v.v === 1; }) : []; } catch (e) { return []; }
  }
  function storeViews(a) {
    try { G.localStorage.setItem(VIEWS_KEY, JSON.stringify(a.slice(-MAX_VIEWS))); return true; } catch (e) { return false; }
  }
  function viewsHtml() {
    var vs = loadViews(), srcShort = {};
    st.data.sources.forEach(function (s) { srcShort[s.id] = s.short || s.name; });
    return '<section class="a3d-views" aria-label="Saved views"><h3 class="a3d-h">Saved views</h3>' +
      '<div class="a3d-vsave"><input id="a3dViewName" type="text" maxlength="40" placeholder="Name this view" aria-label="Name for this view" autocomplete="off">' +
      '<button class="a3d-btn accent" data-a3d-act="vsave" aria-label="Save the current view">' + ico("save") + "Save</button></div>" +
      (vs.length ? '<ul class="a3d-vlist">' + vs.map(function (v, k) {
        var meta = [srcShort[v.src] || ""].concat(v.sel && v.sel.length ? ["selection"] : [], v.hidden && v.hidden.length ? [v.hidden.length + " hidden"] : [], v.clip ? ["cut"] : []).filter(Boolean).join(", ");
        return '<li><button class="a3d-vload" data-a3d-act="vload" data-k="' + k + '" aria-label="Restore view ' + esc(v.name) + '"><span>' + esc(v.name) + "</span><small>" + esc(meta) + "</small></button>" +
          '<button class="a3d-vdel" data-a3d-act="vdel" data-k="' + k + '" aria-label="Delete view ' + esc(v.name) + '">' + (ico("trash") || "×") + "</button></li>";
      }).join("") + "</ul>" : '<p class="a3d-empty">Save the camera, selection, hidden parts and cut to come back to them.</p>') +
      "</section>";
  }
  function repaintPanel() {
    var p = G.document.getElementById("a3dSystems"); if (!p) return;
    var sc = p.querySelector(".atlas-scroll"), top = sc ? sc.scrollTop : 0;
    dropPanel("a3dSystems"); p = pushPanel(systemsHtml());
    sc = p && p.querySelector(".atlas-scroll"); if (sc) sc.scrollTop = top;
  }
  function saveView() {
    var inp = G.document.getElementById("a3dViewName"), vs = loadViews();
    var name = (inp && inp.value.trim()) || ("View " + (vs.length + 1));
    vs.push(serializeView(st, st.data, name));
    if (!storeViews(vs)) { toast("Could not save the view on this device"); return; }
    repaintPanel(); toast("View saved");
  }
  function applyView(v) {
    var r = restoreView(v, st.data); if (!r) { toast("This view could not be restored"); return false; }
    quizEnd();
    if (r.src !== st.src) setSource(r.src, { keepCam: true });
    st.bowel = r.bowel; st.shell = r.shell; st.hidden = r.hidden; st.faded = r.faded; st.clip = r.clip; st.xray = r.xray;
    st.region = r.region; st.explodeTarget = r.explode; st.hist = [];
    if (r.plane) setPlane(r.plane.m, r.plane.i, { noFocus: true }); else st.plane = null;
    select(r.sel, r.subject, { noFocus: true });
    st.isolate = r.isolate && st.sel.length > 0;
    applyState(); ensureChunks();
    st.camTo = r.cam; schedule();
    paintChips(); paintBar(); invalidate();
    return true;
  }
  function toast(msg) { try { if (G.SMD_toast) G.SMD_toast(msg); } catch (e) {} }

  /* ---------- image snapshot + share ---------- */
  // GL rows come back bottom-up; flip into a 2D canvas, caption with the selected structure.
  function snapshot() {
    var f = readFrame(); if (!f) return Promise.reject(new Error("The 3D view is not ready."));
    var k = f.w / Math.max(1, st.canvas.clientWidth), FONT = "px -apple-system, system-ui, sans-serif";
    // The credit is a band ADDED below the frame (the view is not covered). It lives only in the
    // exported pixels, never in the DOM, so the in-app attribution still renders once (About).
    var credit = creditLine(st.data, st.src), cfs = Math.max(10, Math.round(11 * k)), cpad = Math.round(7 * k), lh = Math.round(cfs * 1.35);
    var cv = G.document.createElement("canvas"), ctx = cv.getContext("2d");
    ctx.font = "500 " + cfs + FONT;
    var lines = wrapLines(credit, f.w - cpad * 2, function (s) { return ctx.measureText(s).width; });
    var bandH = lines.length ? lines.length * lh + cpad * 2 : 0;
    cv.width = f.w; cv.height = f.h + bandH;   // resizing resets the context state
    var img = ctx.createImageData(f.w, f.h), row = f.w * 4;
    for (var y = 0; y < f.h; y++) img.data.set(f.px.subarray((f.h - 1 - y) * row, (f.h - y) * row), y * row);
    ctx.putImageData(img, 0, 0);
    if (bandH) {
      ctx.fillStyle = "#0d0f11"; ctx.fillRect(0, f.h, f.w, bandH);
      ctx.fillStyle = "#e6e6e6"; ctx.font = "500 " + cfs + FONT; ctx.textBaseline = "top";
      lines.forEach(function (ln, j) { ctx.fillText(ln, cpad, f.h + cpad + j * lh); });
    }
    var name = st.subject && st.data ? subjectTitle(st.data, st.subject) : "";
    if (name) {
      var fs = Math.round(15 * k), pad = Math.round(10 * k);
      ctx.font = "600 " + fs + FONT;
      var tw = ctx.measureText(name).width;
      ctx.fillStyle = "rgba(6,102,90,0.9)"; ctx.fillRect(pad, f.h - pad * 2 - fs * 1.6, tw + pad * 2, fs * 1.6 + pad);
      ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(name, pad * 2, f.h - pad * 1.5 - fs * 0.8);
    }
    var d = new Date(), stamp = d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2) + "-" + ("0" + d.getHours()).slice(-2) + ("0" + d.getMinutes()).slice(-2);
    var fname = "radioanatome-3d-" + fileSlug(name || (st.src === "live" ? "living-ct" : "reference-body")) + "-" + stamp + ".png";
    return new Promise(function (res, rej) {
      cv.toBlob(function (b) { if (b) res({ blob: b, name: fname, title: name || "3D Anatomy", credit: credit, lines: lines.length, bandH: bandH }); else rej(new Error("The image could not be encoded.")); }, "image/png");
    });
  }
  // Same share ladder as share-card.js: Capacitor Share on a file (native), Web Share with a
  // File, else a download link.
  function shareSnapshot() {
    return snapshot().then(function (r) {
      var C = G.Capacitor, P = C && C.Plugins;
      if (G.SMD_IS_NATIVE && P && P.Filesystem && P.Filesystem.writeFile && P.Share && P.Share.share) {
        return blobB64(r.blob).then(function (b64) {
          return P.Filesystem.writeFile({ path: r.name, data: b64, directory: "CACHE" });
        }).then(function (w) { return P.Share.share({ title: r.title, url: w.uri, dialogTitle: "Share image" }); });
      }
      var file = null; try { file = new G.File([r.blob], r.name, { type: "image/png" }); } catch (e) {}
      var nav = G.navigator;
      if (file && nav && nav.canShare && nav.share && nav.canShare({ files: [file] })) {
        return nav.share({ files: [file], title: r.title }).catch(function (e) { if (!e || e.name !== "AbortError") downloadBlob(r.blob, r.name); });
      }
      downloadBlob(r.blob, r.name); toast("Image saved");
    }).catch(function (e) { if (!e || e.name !== "AbortError") toast((e && e.message) || "Could not create the image"); });
  }
  function blobB64(b) { return new Promise(function (res, rej) { var fr = new G.FileReader(); fr.onload = function () { res(String(fr.result).split(",")[1] || ""); }; fr.onerror = rej; fr.readAsDataURL(b); }); }
  function downloadBlob(b, name) {
    var u = G.URL.createObjectURL(b), a = G.document.createElement("a");
    a.href = u; a.download = name; G.document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { G.URL.revokeObjectURL(u); }, 4000);
  }

  /* ---------- "Find it" quiz ---------- */
  function partOnScreen() {
    // a part counts when its state says visible, it is not faded, and every chunk of its
    // system in the active set has arrived (LOD chunks do not map 1:1 to part rows)
    var d = st.data, R = st.gl, want = srcIndex(), sysLoaded = {};
    chunkSet().forEach(function (c) { if ((c.src || 0) !== want) return; if (sysLoaded[c.system] == null) sysLoaded[c.system] = true; if (!st.chunks[c.id]) sysLoaded[c.system] = false; });
    return function (i) {
      var p = d.parts[i];
      return !!p && !!R && R.stateData[i * 4] === 255 && !st.faded[i] && sysLoaded[d.systems[p.sys].id] === true;
    };
  }
  function quizStart() {
    hideResults(); dropPanel("a3dSystems"); dropPanel("a3dInfo");
    st.quiz = { score: 0, n: 0, target: null, state: "ask", msg: "", recent: [] };
    select([], null); quizNext();
  }
  function quizNext() {
    var q = st.quiz; if (!q) return;
    select([], null);
    // Loaded and switched on is not enough: a lateral ventricle inside the skull is "visible"
    // but cannot be tapped. Ask only for structures with some pixels in this view's pick buffer.
    var want = srcIndex(), px = pickCounts(), reach = {};
    var pool = quizPool(st.data, want, partOnScreen()).filter(function (cid) {
      var n = 0; quizParts(st.data.canon[cid], want).forEach(function (i) { n += px[i] || 0; });
      reach[cid] = n; return n >= 30;
    });
    var fresh = pool.filter(function (c) { return q.recent.indexOf(c) < 0; });
    if (!fresh.length) { q.recent = []; fresh = pool; }
    q.state = "ask"; q.msg = ""; q.target = fresh.length ? fresh[Math.floor(Math.random() * fresh.length)] : null;
    q.px = q.target ? reach[q.target] : 0;
    if (q.target) { q.recent.push(q.target); if (q.recent.length > 6) q.recent.shift(); }
    paintQuiz(); paintBar();
  }
  function quizTap(hit) {
    var q = st.quiz, d = st.data; if (!q || !q.target || q.state !== "ask" || hit < 0) return;
    var idxs = quizParts(d.canon[q.target], srcIndex());
    if (idxs.indexOf(hit) >= 0) {
      q.score++; q.n++; q.state = "right"; q.msg = "Correct";
      select(idxs, null, { noFocus: true });
    } else {
      q.msg = "Not quite, that is the " + d.parts[hit].name.toLowerCase() + ". Try again.";
    }
    paintQuiz();
  }
  function quizSkip() {
    var q = st.quiz; if (!q || !q.target || q.state !== "ask") return;
    q.n++; q.state = "shown"; q.msg = "Here it is.";
    var idxs = quizParts(st.data.canon[q.target], srcIndex());
    select(idxs, null, { noFocus: true });
    paintQuiz();
  }
  function quizEnd() {
    if (!st.quiz) return;
    st.quiz = null; select([], null);
    var el = G.document && G.document.getElementById("a3dQuiz"); if (el) { el.hidden = true; el.innerHTML = ""; }
    paintBar();
  }
  function paintQuiz() {
    var el = G.document.getElementById("a3dQuiz"), q = st.quiz; if (!el) return;
    if (!q) { el.hidden = true; el.innerHTML = ""; return; }
    var name = q.target ? st.data.canon[q.target].name : "";
    el.hidden = false;
    el.innerHTML = '<div class="a3d-qhd"><span class="a3d-qttl">Find it</span><span class="a3d-qscore" aria-label="Score ' + q.score + " of " + q.n + '">' + q.score + " / " + q.n + "</span>" +
        '<button class="a3d-qx" data-a3d-act="quizend" aria-label="Exit quiz">' + (ico("close") || "×") + "</button></div>" +
      '<div class="a3d-qask" aria-live="polite">' + (q.target ? "Tap the <b>" + esc(name) + "</b>" : "Nothing to find in this view yet. Zoom out, turn on more layers, or wait for the anatomy to load.") + "</div>" +
      (q.msg ? '<div class="a3d-qmsg ' + (q.state === "right" ? "ok" : q.state === "shown" ? "info" : "bad") + '" role="status">' + esc(q.msg) + "</div>" : "") +
      '<div class="a3d-qbtns">' + (q.state === "ask" && q.target
        ? '<button class="a3d-btn sm" data-a3d-act="quizskip" aria-label="Skip and show the answer">Show me</button>'
        : '<button class="a3d-btn sm accent" data-a3d-act="quiznext" aria-label="Next structure">Next</button>') + "</div>";
  }

  /* ---------- first-open gesture hint ---------- */
  function showHint() {
    var seen = st._hintDone; try { seen = seen || G.localStorage.getItem(HINT_KEY) === "1"; } catch (e) {}
    var stage = G.document.getElementById("a3dStage"); if (seen || !stage || G.document.getElementById("a3dHint")) return;
    var touch = isTouch(), rows = [["refresh", "Drag", "to rotate"], ["search", touch ? "Pinch" : "Scroll", "to zoom"], ["target", "Tap", "to select a structure"], ["eye", "Double-tap", "to focus on it"]];
    var el = G.document.createElement("div");
    el.id = "a3dHint"; el.className = "a3d-hint"; el.setAttribute("data-a3d-act", "hintok");
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "false"); el.setAttribute("aria-labelledby", "a3dHintT");
    el.innerHTML = '<div class="a3d-hint-card"><h3 id="a3dHintT">Explore in 3D</h3><ul>' + rows.map(function (r) {
      return '<li><i aria-hidden="true">' + ico(r[0]) + "</i><span><b>" + r[1] + "</b> " + r[2] + "</span></li>";
    }).join("") + '</ul><button class="a3d-btn accent" data-a3d-act="hintok">Got it</button></div>';
    stage.appendChild(el);
    try { el.querySelector("button").focus({ preventScroll: true }); } catch (e2) {}
  }
  function dismissHint() {
    st._hintDone = true;
    try { G.localStorage.setItem(HINT_KEY, "1"); } catch (e) {}
    var el = G.document.getElementById("a3dHint"); if (el && el.parentNode) el.parentNode.removeChild(el);
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
      '<p class="atlas-prose atlas-credit">' + esc(s.attribution || BP3D_ATTRIBUTION) + "<br>" +
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
        '<button class="atlas-pill" data-a3d-act="hide" aria-label="Hide this structure">Hide</button>' +
        '<button class="atlas-pill' + (allFaded() ? " on" : "") + '" data-a3d-act="fade" aria-pressed="' + (allFaded() ? "true" : "false") + '" aria-label="' + (allFaded() ? "Restore this structure" : "Fade this structure so you can see through it") + '">' + (allFaded() ? "Unfade" : "Fade") + "</button>" +
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
    if (act === "hintok") { dismissHint(); return; }
    if (act === "reset") {
      quizEnd();
      st.region = ""; st.isolate = false; st.hidden = {}; st.faded = {}; st.xray = null; st.clip = null; st.hist = []; st.explodeTarget = 0;
      liveDefaults(); select([], null); applyState(); paintChips(); paintBar(); if (st.src === "live") focusSource(); else resetCamera(); return;
    }
    if (act === "tab") { st._tab = t.getAttribute("data-tab"); openSheet(); return; }
    if (act === "view") { cycleView(); return; }
    if (act === "planeoff") { clearPlane(); return; }
    if (!d) return;
    if (act === "retry") { retryFailed(); return; }
    if (act === "fade") { toggleFade(); return; }
    if (act === "undo") { undo(); return; }
    if (act === "clip") { st.clip = st.clip ? null : { axis: "y", t: 0.5, flip: false }; paintBar(); invalidate(); return; }
    if (act === "clipaxis" && st.clip) { st.clip.axis = t.getAttribute("data-ax"); paintBar(); invalidate(); return; }
    if (act === "clipflip" && st.clip) { st.clip.flip = !st.clip.flip; paintBar(); invalidate(); return; }
    if (act === "clipoff") { st.clip = null; paintBar(); invalidate(); return; }
    if (act === "quiz") { if (st.quiz) quizEnd(); else quizStart(); return; }
    if (act === "quizend") { quizEnd(); return; }
    if (act === "quizskip") { quizSkip(); return; }
    if (act === "quiznext") { quizNext(); return; }
    if (act === "snap") { shareSnapshot(); return; }
    if (act === "vsave") { saveView(); return; }
    if (act === "vload") { var v = loadViews()[+t.getAttribute("data-k")]; if (v && applyView(v)) dropPanel("a3dSystems"); return; }
    if (act === "vdel") { var vs = loadViews(); vs.splice(+t.getAttribute("data-k"), 1); storeViews(vs); repaintPanel(); return; }
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
    if (act === "xray" || act === "clippos") onInput(e);
  }
  function onInput(e) {
    var t = e.target; if (!t) return;
    if (t.id === "a3dQ") { paintResults(t.value); return; }
    var act = t.getAttribute && t.getAttribute("data-a3d-act");
    // both sliders redraw live while dragging, so the effect is visible under the finger
    if (act === "xray") { st.xray = 1 - (+t.value || 0) / 100; t.setAttribute("aria-valuetext", t.value + " percent"); invalidate(); }
    if (act === "clippos" && st.clip) { st.clip.t = (+t.value || 0) / 100; invalidate(); }
  }
  function onKey(e) { if (e.key === "Enter" && e.target && e.target.id === "a3dViewName") { e.preventDefault(); saveView(); } }
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
    el.removeEventListener("keydown", onKey); el.addEventListener("keydown", onKey);
    el.innerHTML = shellHtml();
    el.classList.add("on");
    st.err = ""; st.base = null; st.sel = []; st.subject = null; st.isolate = false; st.hidden = {}; st.region = ""; st.explodeTarget = 0; st.explode = 0;
    st.faded = {}; st.xray = null; st.clip = null; st.hist = []; st.quiz = null; st.failed = {}; st.lost = false; st.bytesDone = st.bytesTotal = 0; st.counted = {};
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
      showHint();
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
    st.quiz = null; clearTimeout(st._lostTimer); st.lost = false;
    disposeGL();
    if (el) el.innerHTML = "";
    try { if (st._prevFocus && st._prevFocus.focus) st._prevFocus.focus(); } catch (e) {}
    st._prevFocus = null;
  }
  function isOpen() { var el = G.document && G.document.getElementById("smdAtlas3d"); return !!(el && el.classList.contains("on")); }
  function back() {
    if (!isOpen()) return false;
    if (G.document.getElementById("a3dHint")) { dismissHint(); return true; }
    if (G.document.getElementById("a3dInfo")) { dropPanel("a3dInfo"); return true; }
    if (G.document.getElementById("a3dSystems")) { dropPanel("a3dSystems"); return true; }
    var box = G.document.getElementById("a3dResults");
    if (box && !box.hidden) { hideResults(); return true; }
    var sh = G.document.getElementById("a3dSheet");
    if (sh && sh.classList.contains("on")) { select([], null); return true; }
    if (st.quiz) { quizEnd(); return true; }
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
  G.ATLAS3D._readFrame = readFrame;
  G.ATLAS3D._snapshot = snapshot;
  G.ATLAS3D._applyView = applyView;
  G.ATLAS3D._quizTap = quizTap;
  G.ATLAS3D._pure = {
    canonicalOf: canonicalOf, parseManifest: parseManifest, search: search, unionBounds: unionBounds,
    fitDistance: fitDistance, encodePick: encodePick, decodePick: decodePick, canonOfPart: canonOfPart,
    linksFor: linksFor, regionParts: regionParts, perspective: perspective, lookAt: lookAt, mul: mul, eyeFrom: eyeFrom,
    looksLikeChunk: looksLikeChunk, dataBases: dataBases, dataUrl: dataUrl,
    ghostAlpha: ghostAlpha, freeClip: freeClip, layerSnap: layerSnap, pushHist: pushHist, progressLabel: progressLabel,
    serializeView: serializeView, restoreView: restoreView, quizPool: quizPool, fileSlug: fileSlug, creditLine: creditLine, wrapLines: wrapLines
  };
  G.ATLAS3D._version = "1.0";

  if (typeof module !== "undefined" && module.exports) module.exports = G.ATLAS3D._pure;
})(typeof window !== "undefined" ? window : this);
