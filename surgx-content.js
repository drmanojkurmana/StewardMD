/* surgx-content.js — SURGX · content loader. Catalog first, packs on demand.
 * ===========================================================================
 * Mirrors clinix-content.js, which mirrors atlas.js: fetch a small manifest, then only the unit
 * the clinician actually opened. It deliberately does NOT mirror kardiox-content-pack.js, a 1.9 MB
 * JS array parsed on every page load for every user whether or not they open the module.
 *
 * Nothing here loads until SURGX.open() is called, so the flag-off case is a total no-op and a
 * clinician who never taps the tile pays nothing.
 *
 * THE GATES ARE APPLIED HERE, AT THE SEAM, so no screen can forget them:
 *   - review gate  -> content that is not clinician-approved does not come back
 *   - licence gate -> uncleared media comes back as caption + "visual pending", never a blank
 *
 * PROTOCOLS COME FROM TWO PLACES AND LOOK IDENTICAL DOWNSTREAM:
 *   - "engine"   -> window.SMD_WS_ENGINES.surgery (ws-surgery.js). The clinical logic has ONE
 *                   home; SURGX projects its output onto the seven-band spine. No duplication,
 *                   and parity is structural rather than something a test has to chase.
 *   - "authored" -> surgx/protocols/*.json, for the emergencies the engine does not model.
 *
 * Content JSON is fetched with the catalog's contentVersion appended as ?v=, because sw.js caches
 * static assets keyed on the FULL URL including the query string. Without it a content update can
 * never reach a device that has already cached the old file.
 */
(function () {
  "use strict";

  var BASE = "/surgx/";
  var G = typeof window !== "undefined" ? window : {};

  function flags() { try { return G.SMD_SURGX_FLAGS || null; } catch (e) { return null; } }
  function flag(k) { var f = flags(); return !!(f && f.bool(k)); }
  function model() { try { return G.SMD_SURGX_MODEL || null; } catch (e) { return null; } }

  // Read fresh each call so toggling a flag does not need a reload.
  function gateOpts() {
    return {
      allowDraft: flag("smd_surgx_draft"),
      allowUncleared: flag("smd_surgx_uncleared_media")
    };
  }

  /* Native asset path. Clone of clinix-content.js cxMedia() / kardiox-screens.js kxImg(): content
   * stores root-relative paths, and on native /assets/surgx/* is rewritten to the live origin so
   * heavy media is FETCHED rather than bundled into the app download. assets/kardiox-learn/ alone
   * is 176 MB; SURGX must never repeat that inside the install. Small owner-produced files at the
   * repo root are bundled by build-www.sh's globs and correctly skip this rewrite. */
  function sgxMedia(u) {
    try {
      if (u && u.charAt(0) === "/" && u.indexOf("/assets/surgx/") === 0 && G.SMD_IS_NATIVE) {
        return "https://stewardmd.in" + u;
      }
    } catch (e) {}
    return u;
  }

  var cache = { catalog: null, protocols: {}, procedures: {}, cases: {}, packs: {}, media: null, overlay: null };

  function ver() { return (cache.catalog && cache.catalog.contentVersion) || ""; }

  function getJSON(path, opts) {
    if (!G.fetch) return Promise.resolve(null);
    var v = (opts && opts.noVersion) ? "" : ver();
    var url = BASE + path + (v ? ((path.indexOf("?") >= 0 ? "&" : "?") + "v=" + encodeURIComponent(v)) : "");
    var init = (opts && opts.fresh) ? { cache: "no-store" } : undefined;
    return G.fetch(url, init)
      .then(function (r) { return (r && r.ok) ? r.json() : null; })
      .catch(function () { return null; });
  }

  /* The manifest itself is fetched no-store: it is the thing that carries the version everything
   * else is keyed on, so it must never be the stale one. It is a few KB. */
  function loadCatalog() {
    if (cache.catalog) return Promise.resolve(cache.catalog);
    return getJSON("manifest.json", { noVersion: true, fresh: true }).then(function (j) {
      cache.catalog = j || { contentVersion: "", protocols: [], procedures: [], cases: [], stepPacks: [] };
      return cache.catalog;
    });
  }

  function loadMedia() {
    if (cache.media) return Promise.resolve(cache.media);
    return loadCatalog().then(function () {
      return getJSON("media/manifest.json").then(function (j) {
        cache.media = (j && j.media) || {};
        return cache.media;
      });
    });
  }

  /* The authored provenance + investigations overlay for the ws-surgery engine syndromes. It adds
   * sources, an INVESTIGATE band and calculator links WITHOUT touching the engine's clinical
   * logic, and it is reviewed on its own. */
  function loadOverlay() {
    if (cache.overlay) return Promise.resolve(cache.overlay);
    return loadCatalog().then(function () {
      return getJSON("protocols/engine-overlay.json").then(function (j) {
        cache.overlay = (j && j.syndromes) || {};
        return cache.overlay;
      });
    });
  }

  /* ── the ws-surgery engine seam ──────────────────────────────────────────── */

  function engine() {
    try { return (G.SMD_WS_ENGINES && G.SMD_WS_ENGINES.surgery) || null; } catch (e) { return null; }
  }
  function engineSyndrome(id) {
    var e = engine(); if (!e) return null;
    var list = e.syndromes || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function engineAvailable() { return !!engine(); }

  /* ── catalog projections ─────────────────────────────────────────────────── */

  /* The unified protocol index: engine syndromes plus authored protocols, in the manifest's own
   * category order. An engine syndrome missing from ws-surgery.js (someone edited that file) is
   * DROPPED with a flag rather than rendering a dead row. */
  function protocolIndex() {
    return Promise.all([loadCatalog(), loadOverlay()]).then(function (r) {
      var cat = r[0] || {}, ov = r[1] || {};
      var out = [], opts = gateOpts(), M = model();
      (cat.protocols || []).forEach(function (entry) {
        if (entry.kind === "engine") {
          var syn = engineSyndrome(entry.id);
          if (!syn) return;                                   // engine file changed; do not fake it
          var o = ov[entry.id] || {};
          out.push({
            id: entry.id, kind: "engine", title: syn.name,
            subtitle: entry.subtitle || o.subtitle || "",
            category: entry.category || o.category || "surgical_emergency",
            shared: !!syn.shared,
            review: o.review ? M.reviewStatus(o) : "published",
            sourced: !!(o.sources && o.sources.length)
          });
        } else {
          out.push({
            id: entry.id, kind: "authored", title: entry.title,
            subtitle: entry.subtitle || "", category: entry.category || "surgical_emergency",
            review: entry.review || "draft",
            sourced: true,
            // The review gate applies to the INDEX too, so a draft protocol is not advertised to
            // a reader who could not open it anyway.
            hidden: !M.isRenderable({ review: { status: entry.review } }, opts)
          });
        }
      });
      return out.filter(function (p) { return !p.hidden; });
    });
  }

  /* Load and compile one protocol, from whichever source owns it. Resolves to the SAME shape
   * either way, so every screen downstream is source-agnostic. */
  function loadProtocol(id, selected) {
    return Promise.all([loadCatalog(), loadOverlay()]).then(function (r) {
      var cat = r[0] || {}, ov = r[1] || {}, M = model();
      if (!M) return null;
      var entry = null;
      (cat.protocols || []).forEach(function (e) { if (e.id === id) entry = e; });
      if (!entry) return null;

      if (entry.kind === "engine") {
        var syn = engineSyndrome(id);
        if (!syn) return null;
        return M.compileEngineProtocol(syn, selected || null, ov[id] || null, gateOpts());
      }
      if (cache.protocols[id]) return M.compileProtocol(cache.protocols[id], gateOpts());
      return getJSON(entry.file).then(function (j) {
        if (!j) return null;
        cache.protocols[id] = j;
        return M.compileProtocol(j, gateOpts());
      });
    }).catch(function () { return null; });
  }

  /* Re-run an engine protocol against a new selection. Synchronous once loaded, because ticking a
   * finding must repaint immediately - a 3am protocol that waits on a promise for every tap is a
   * protocol nobody uses. */
  function recompileProtocol(id, selected) {
    var M = model(); if (!M) return null;
    var syn = engineSyndrome(id);
    if (!syn) return null;
    return M.compileEngineProtocol(syn, selected || null, (cache.overlay || {})[id] || null, gateOpts());
  }

  /* ── procedures ──────────────────────────────────────────────────────────── */

  function loadPack(id) {
    if (cache.packs[id]) return Promise.resolve(cache.packs[id]);
    return loadCatalog().then(function (cat) {
      var entry = null;
      (cat.stepPacks || []).forEach(function (p) { if (p.id === id) entry = p; });
      if (!entry) return null;
      return getJSON(entry.file).then(function (j) {
        cache.packs[id] = (j && j.steps) || {};
        return cache.packs[id];
      });
    });
  }

  function copyInto(dst, src) {
    for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) dst[k] = src[k];
  }

  /* Resolve everything a procedure needs: its own file, its step packs, and the media registry.
   * Resolves whole or null - never half-built, because a procedure that paints before its steps
   * resolve shows empty chapters (the bug atlas.js and clinix-content.js both document). */
  function loadProcedure(id) {
    if (cache.procedures[id]) return Promise.resolve(cache.procedures[id]);
    return loadCatalog().then(function (cat) {
      var entry = null;
      (cat.procedures || []).forEach(function (p) { if (p.id === id) entry = p; });
      if (!entry) return null;
      var packIds = entry.stepPacks || [];
      var jobs = [getJSON(entry.file), loadMedia()];
      for (var i = 0; i < packIds.length; i++) jobs.push(loadPack(packIds[i]));
      return Promise.all(jobs).then(function (res) {
        var pr = res[0], media = res[1] || {};
        if (!pr) return null;
        var steps = {};
        for (var k = 2; k < res.length; k++) if (res[k]) copyInto(steps, res[k]);
        // Procedure-local steps win, so a procedure can specialise a shared step if it must.
        if (pr.steps_local) copyInto(steps, pr.steps_local);
        var built = { id: pr.id, procedure: pr, steps: steps, media: media };
        cache.procedures[id] = built;
        return built;
      });
    }).catch(function () { return null; });
  }

  function compiledProcedure(built) {
    var M = model();
    if (!M || !built) return null;
    return M.compileProcedure(built.procedure, built.steps, gateOpts());
  }

  /* Every step in every pack, with no procedure attached. A step is the atom, so it was always
   * learnable standalone; this is the door to it. */
  var _allSteps = null;
  function loadAllSteps() {
    if (_allSteps) return Promise.resolve(_allSteps);
    return loadCatalog().then(function (cat) {
      var packs = (cat.stepPacks || []).map(function (p) { return p.id; });
      var jobs = [loadMedia()];
      for (var i = 0; i < packs.length; i++) jobs.push(loadPack(packs[i]));
      return Promise.all(jobs).then(function (res) {
        var steps = {};
        for (var k = 1; k < res.length; k++) if (res[k]) copyInto(steps, res[k]);
        _allSteps = { steps: steps, media: res[0] || {} };
        return _allSteps;
      });
    }).catch(function () { return null; });
  }

  /* ── cases ───────────────────────────────────────────────────────────────── */

  function caseIndex() {
    return loadCatalog().then(function (cat) {
      var M = model(), opts = gateOpts();
      return (cat.cases || []).filter(function (c) {
        return M.isRenderable({ review: { status: c.review } }, opts);
      });
    });
  }

  function loadCase(id, level) {
    return loadCatalog().then(function (cat) {
      var M = model(); if (!M) return null;
      var entry = null;
      (cat.cases || []).forEach(function (c) { if (c.id === id) entry = c; });
      if (!entry) return null;
      if (cache.cases[id]) return M.compileCase(cache.cases[id], level, gateOpts());
      return getJSON(entry.file).then(function (j) {
        if (!j) return null;
        cache.cases[id] = j;
        return M.compileCase(j, level, gateOpts());
      });
    }).catch(function () { return null; });
  }

  /* ── media resolution (licence gate) ─────────────────────────────────────── */

  /* Resolve a media id into something a screen can render WITHOUT knowing the licence rules. An
   * uncleared asset comes back renderable:false WITH its caption, so the UI shows honest "visual
   * pending" text rather than a broken image. A UI that degrades by omission lies about the data. */
  function media(registry, id) {
    var M = model();
    var m = registry && registry[id];
    if (!m) return null;
    var opts = gateOpts();
    var ok = M ? M.mediaRenderable(m, opts) : false;
    return {
      id: m.id || id,
      kind: m.kind,
      caption: m.caption || "",
      title: m.title || "",
      renderable: ok,
      inline: m.inline === true,
      diagramId: m.diagramId || "",
      videoId: m.videoId || "",
      src: ok && m.src ? sgxMedia(m.src) : null,
      embeddable: M ? M.isEmbeddable(m) : false,
      sourceUrl: m.sourceUrl || "",
      licence: m.licence || "",
      attribution: m.attribution || "",
      pendingNote: ok ? "" : (m.note || "Visual pending: this asset has not been sourced and licence-cleared yet.")
    };
  }

  /* ── availability (honest partial states) ────────────────────────────────── */

  /* How much of this procedure is actually available to this reader. Screens use it to say
   * "4 of 22 steps awaiting clinical sign-off" instead of rendering a mysteriously short
   * operation, which is the difference between a gap and a lie. */
  function availability(built) {
    var M = model();
    if (!M || !built) return { total: 0, visible: 0, pending: 0 };
    var total = 0, visible = 0, opts = gateOpts();
    var refs = (built.procedure && built.procedure.steps) || [];
    refs.forEach(function (ref) {
      var id = (ref && ref.ref) || ref;
      var s = built.steps[id];
      if (!s) return;
      total++;
      if (M.isRenderable(s, opts)) visible++;
    });
    return { total: total, visible: visible, pending: total - visible };
  }

  function reset() {
    cache = { catalog: null, protocols: {}, procedures: {}, cases: {}, packs: {}, media: null, overlay: null };
    _allSteps = null;
  }

  var API = {
    loadCatalog: loadCatalog, loadMedia: loadMedia, loadOverlay: loadOverlay,
    engineAvailable: engineAvailable, engineSyndrome: engineSyndrome,
    protocolIndex: protocolIndex, loadProtocol: loadProtocol, recompileProtocol: recompileProtocol,
    loadProcedure: loadProcedure, compiledProcedure: compiledProcedure, loadAllSteps: loadAllSteps, loadPack: loadPack,
    caseIndex: caseIndex, loadCase: loadCase,
    media: media, availability: availability,
    sgxMedia: sgxMedia, gateOpts: gateOpts, reset: reset,
    _cache: function () { return cache; }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SURGX_CONTENT = API;
})();
