/* clinix-content.js — CliniX · content loader. Catalog first, packs on demand.
 *
 * Mirrors atlas.js (RadioAnatome), which fetches a small modules.json and then only the unit the
 * user opened. It deliberately does NOT mirror kardiox-content-pack.js, a 1.9 MB JS array that is
 * parsed on every page load for every user whether or not they ever open Learn.
 *
 * Nothing here loads until CLINIX.open() is called, so a student who never taps the tile pays
 * nothing, and the flag-off case is a total no-op.
 *
 * Two gates are applied HERE, at the seam, so no screen can forget them:
 *   - the review gate drops content that is not clinician-approved
 *   - the licence gate turns uncleared media into a caption plus a "visual pending" note
 */
(function () {
  "use strict";

  var BASE = "/clinix/";
  var G = typeof window !== "undefined" ? window : {};

  function flags() { try { return G.SMD_CLINIX_FLAGS || null; } catch (e) { return null; } }
  function flag(k) { var f = flags(); return !!(f && f.bool(k)); }
  function model() { try { return G.SMD_CLINIX_MODEL || null; } catch (e) { return null; } }

  // Author-mode options, read fresh each call so toggling the flag does not need a reload.
  function gateOpts() {
    return {
      allowDraft: flag("smd_clinix_draft"),
      allowUncleared: flag("smd_clinix_uncleared_media")
    };
  }

  /* Native asset path. Clone of kardiox-screens.js kxImg(): content stores root-relative paths, and
   * on native they are rewritten to the live origin so heavy media is fetched rather than bundled.
   * assets/kardiox-learn/ alone is 177 MB; CliniX must never repeat that inside the app download. */
  function cxMedia(u) {
    try {
      if (u && u.charAt(0) === "/" && u.indexOf("/assets/clinix/") === 0 && G.SMD_IS_NATIVE) {
        return "https://stewardmd.in" + u;
      }
    } catch (e) {}
    return u;
  }

  var cache = { catalog: null, packs: {}, diseases: {}, media: null };

  function getJSON(path) {
    if (!G.fetch) return Promise.resolve(null);
    return G.fetch(BASE + path)
      .then(function (r) { return (r && r.ok) ? r.json() : null; })
      .catch(function () { return null; });
  }

  function loadCatalog() {
    if (cache.catalog) return Promise.resolve(cache.catalog);
    return getJSON("manifest.json").then(function (j) {
      cache.catalog = j || { systems: [], skillPacks: [] };
      return cache.catalog;
    });
  }

  function loadMedia() {
    if (cache.media) return Promise.resolve(cache.media);
    return getJSON("media/manifest.json").then(function (j) {
      cache.media = (j && j.media) || {};
      return cache.media;
    });
  }

  function loadPack(id) {
    if (cache.packs[id]) return Promise.resolve(cache.packs[id]);
    return loadCatalog().then(function (cat) {
      var entry = null, list = cat.skillPacks || [];
      for (var i = 0; i < list.length; i++) if (list[i].id === id) entry = list[i];
      if (!entry) return null;
      return getJSON(entry.file).then(function (j) {
        cache.packs[id] = (j && j.skills) || {};
        return cache.packs[id];
      });
    });
  }

  function systemById(cat, id) {
    var list = (cat && cat.systems) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function diseaseEntry(cat, diseaseId) {
    var systems = (cat && cat.systems) || [];
    for (var i = 0; i < systems.length; i++) {
      var ds = systems[i].diseases || [];
      for (var j = 0; j < ds.length; j++) if (ds[j].id === diseaseId) return { system: systems[i], disease: ds[j] };
    }
    return null;
  }

  /* Load everything one disease needs: its own file, the skill packs of its system, and the media
   * registry. Resolves to a ready-to-render object, or null - never a half-built one, because a
   * pathway that paints before its skills resolve shows empty chapters (the bug atlas.js documents). */
  function loadDisease(diseaseId) {
    if (cache.diseases[diseaseId]) return Promise.resolve(cache.diseases[diseaseId]);

    return loadCatalog().then(function (cat) {
      var found = diseaseEntry(cat, diseaseId);
      if (!found) return null;

      var packIds = found.system.skillPacks || [];
      var jobs = [getJSON(found.disease.file), loadMedia()];
      for (var i = 0; i < packIds.length; i++) jobs.push(loadPack(packIds[i]));

      return Promise.all(jobs).then(function (res) {
        var disease = res[0];
        var media = res[1] || {};
        if (!disease) return null;

        var skills = {};
        for (var k = 2; k < res.length; k++) if (res[k]) copyInto(skills, res[k]);
        // Disease-local skills win, so a disease can specialise a shared skill id if it ever needs to.
        if (disease.skills) copyInto(skills, disease.skills);

        var built = {
          id: disease.id,
          disease: disease,
          system: found.system,
          skills: skills,
          media: media
        };
        cache.diseases[diseaseId] = built;
        return built;
      });
    }).catch(function () { return null; });
  }

  function copyInto(dst, src) {
    for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) dst[k] = src[k];
  }

  /* ── The render-facing API. Gates applied here. ─────────────────────────── */

  function pathwayFor(built) {
    var M = model();
    if (!M || !built) return [];
    return M.buildPathway(built.disease, built.skills, gateOpts());
  }

  function skill(built, id) {
    var M = model();
    if (!built || !built.skills[id]) return null;
    var s = built.skills[id];
    if (M && !M.isRenderable(s, gateOpts())) return null;   // review gate
    return s;
  }

  /* Resolve a media id into something a screen can render WITHOUT having to know the licence rules.
   * An uncleared asset comes back with renderable:false plus its caption, so the UI shows honest
   * "visual pending" text rather than a broken image or a blank space. A UI that degrades by
   * omission lies about the data. */
  function media(built, id) {
    var M = model();
    var m = built && built.media && built.media[id];
    if (!m) return null;
    var opts = gateOpts();
    var ok = M ? M.mediaRenderable(m, opts) : false;
    return {
      id: m.id || id,
      kind: m.kind,
      caption: m.caption || "",
      renderable: ok,
      inline: m.inline === true,
      diagramId: m.diagramId || "",
      src: ok && m.src ? cxMedia(m.src) : null,
      embeddable: M ? M.isEmbeddable(m) : false,
      sourceUrl: m.sourceUrl || "",
      licence: m.licence || "",
      attribution: m.attribution || "",
      pendingNote: ok ? "" : (m.note || "Visual pending: this demonstration has not been sourced and licence-cleared yet.")
    };
  }

  function lessonFor(built, skillId, chapterId) {
    var M = model();
    var s = skill(built, skillId);
    if (!M || !s) return [];
    var emphasis = null;
    var chs = (built.disease && built.disease.chapters) || [];
    for (var i = 0; i < chs.length; i++) {
      if (chs[i].id === chapterId && chs[i].emphasis) { emphasis = chs[i].emphasis[skillId]; break; }
    }
    return M.compileLesson(s, emphasis || null);
  }

  function stationFor(built, stationId) {
    var M = model();
    if (!M || !built) return null;
    var sts = (built.disease.osce && built.disease.osce.stations) || [];
    for (var i = 0; i < sts.length; i++) {
      if (sts[i].id !== stationId) continue;
      var list = [], ids = sts[i].skills || [];
      for (var j = 0; j < ids.length; j++) { var s = skill(built, ids[j]); if (s) list.push(s); }
      return M.compileStation(list, sts[i]);
    }
    return null;
  }

  /* Cases pass the review gate like any other content: an unreviewed simulated patient teaches a
   * pattern, and a wrong pattern is worse than no case at all. */
  function caseFor(built, caseId) {
    var M = model();
    if (!M || !built) return null;
    var list = (built.disease && built.disease.cases) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id !== caseId) continue;
      return M.isRenderable(list[i], gateOpts()) ? list[i] : null;
    }
    return null;
  }

  function casesFor(built) {
    var M = model();
    if (!M || !built) return [];
    var list = (built.disease && built.disease.cases) || [], out = [];
    for (var i = 0; i < list.length; i++) if (M.isRenderable(list[i], gateOpts())) out.push(list[i]);
    return out;
  }

  function vivaFor(built) {
    var M = model();
    if (!M || !built) return null;
    var ids = (built.disease.viva && built.disease.viva.skills) || [];
    var list = [];
    for (var i = 0; i < ids.length; i++) { var s = skill(built, ids[i]); if (s) list.push(s); }
    return M.compileViva(list);
  }

  /* How much of this disease is actually available to this reader. The screens use it to show
   * "12 of 34 skills awaiting clinical sign-off" instead of a mysteriously short pathway. */
  function availability(built) {
    var M = model();
    if (!M || !built) return { total: 0, visible: 0, pending: 0 };
    var total = 0, visible = 0, opts = gateOpts();
    for (var id in built.skills) {
      if (!Object.prototype.hasOwnProperty.call(built.skills, id)) continue;
      total++;
      if (M.isRenderable(built.skills[id], opts)) visible++;
    }
    return { total: total, visible: visible, pending: total - visible };
  }

  function reset() { cache = { catalog: null, packs: {}, diseases: {}, media: null }; }

  var API = {
    loadCatalog: loadCatalog,
    loadDisease: loadDisease,
    loadMedia: loadMedia,
    pathwayFor: pathwayFor,
    lessonFor: lessonFor,
    stationFor: stationFor,
    caseFor: caseFor,
    casesFor: casesFor,
    vivaFor: vivaFor,
    skill: skill,
    media: media,
    availability: availability,
    systemById: systemById,
    diseaseEntry: diseaseEntry,
    cxMedia: cxMedia,
    gateOpts: gateOpts,
    reset: reset,
    _cache: function () { return cache; }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_CLINIX_CONTENT = API;
})();
