/* kardiox-providers.js — KardioX AI · provider seam + deterministic mock (SMD_KARDIOX_PROVIDERS).
 *
 * Mirrors FundX's injectable-global pattern. Screens/controllers talk ONLY to providers; providers are
 * the only layer touching network/disk/image processing. Two assemblies:
 *   mockProviders()   — deterministic, offline; drives previews + the whole test suite + M2 build.
 *   liveProviders(s)  — wraps StewardMD networking + secure storage + real backend (built in M3/M5).
 * Default active assembly is the mock (real backend does not exist yet — see README M5).
 *
 * SM-2 flashcard scheduling uses the design's exact fresh-card intervals: Again <1m · Hard 6m · Good
 * 1d · Easy 4d. Pure enough to test (grade() takes an optional `nowMs`). node + browser.
 */
(function () {
  "use strict";

  function M() { return (typeof window !== "undefined" && window.SMD_KARDIOX_MODELS) || (typeof require !== "undefined" ? require("./kardiox-models.js") : null); }
  var DAY = 86400000, MIN = 1 / 1440;

  // ── Mock analyzer: stream the 13 stages, then resolve the canonical AF-with-RVR analysis. ──
  function mockAnalyzer() {
    var models = M();
    return {
      analyze: function (image, onStage) {
        var stages = (models && models.ANALYSIS_STAGES) || [];
        return new Promise(function (resolve) {
          var i = 0;
          function step() {
            if (i < stages.length) {
              var pct = Math.round(((i + 1) / stages.length) * 100);
              try { if (typeof onStage === "function") onStage(stages[i], pct); } catch (e) {}
              i++;
              // Fast but visible staging; deterministic order. setTimeout keeps the UI responsive.
              (typeof setTimeout === "function" ? setTimeout(step, 8) : step());
            } else {
              var a = models.makeAnalysis(models.samples.afWithRvr);
              if (image && image.id) a.image = image;
              resolve(a);
            }
          }
          step();
        });
      }
    };
  }

  // ── Mock image processor: no-op enhance/digitize (real work is backend; client is preview/fallback). ──
  function mockImageProcessor() {
    return {
      enhance: function (img) { return Promise.resolve(img); },
      digitize: function (img) { return Promise.resolve({ leads: 12, calibration: { mmPerS: 25, mmPerMv: 10 }, traces: [] }); }
    };
  }

  // ── Mock ECG store: in-memory (the ENCRYPTED on-device store is M3). CRUD + search + timeline. ──
  function mockEcgStore(seed) {
    var mem = {};
    (seed || []).forEach(function (a) { if (a && a.id) mem[a.id] = a; });
    function list() { return Object.keys(mem).map(function (k) { return mem[k]; }); }
    return {
      save: function (a) { if (a && a.id) mem[a.id] = a; return Promise.resolve(); },
      all: function () { return Promise.resolve(list()); },
      timeline: function () { return Promise.resolve(list().slice().sort(function (x, y) { return String(x.createdAt).localeCompare(String(y.createdAt)); })); },
      get: function (id) { return Promise.resolve(mem[id] || null); },
      delete: function (id) { delete mem[id]; return Promise.resolve(); },
      deleteAll: function () { mem = {}; return Promise.resolve(); },
      search: function (q) { q = String(q || "").toLowerCase(); return Promise.resolve(list().filter(function (a) { return (a.verdict || "").toLowerCase().indexOf(q) >= 0 || String(a.createdAt || "").toLowerCase().indexOf(q) >= 0; })); }
    };
  }

  // ── Mock library: categories + sample lessons (the full 100 ECGs are authored in M4). ──
  function mockLibrary(content) {
    var ecgs = content || [];
    var byId = {}; ecgs.forEach(function (e) { byId[e.id] = e; });
    function cats() { var m = {}; ecgs.forEach(function (e) { m[e.category] = (m[e.category] || 0) + 1; }); return Object.keys(m).map(function (c) { return { name: c, count: m[c] }; }); }
    return {
      categories: function () { return Promise.resolve(cats()); },
      ecgs: function (cat) { return Promise.resolve(ecgs.filter(function (e) { return !cat || e.category === (cat && cat.name || cat); })); },
      ecg: function (id) { return Promise.resolve(byId[id] || null); },
      search: function (q) { q = String(q || "").toLowerCase(); return Promise.resolve(ecgs.filter(function (e) { return (e.title || "").toLowerCase().indexOf(q) >= 0 || (e.category || "").toLowerCase().indexOf(q) >= 0 || (e.ecgFindingTags || []).join(" ").toLowerCase().indexOf(q) >= 0; })); },
      bookmarks: function () { return Promise.resolve(ecgs.filter(function (e) { return e.bookmarked; }).map(function (e) { return e.id; })); },
      toggleBookmark: function (id) { if (byId[id]) byId[id].bookmarked = !byId[id].bookmarked; return Promise.resolve(); }
    };
  }

  // ── SM-2 scheduling (pure). Fresh-card intervals match the design. ──
  function sm2(card, grade, nowMs) {
    card = card || {}; nowMs = nowMs || (typeof Date !== "undefined" ? Date.now() : 0);
    var ef = card.easeFactor || 2.5, reps = card.repetitions || 0, ivl = card.intervalDays || 0;
    if (grade === "again") { reps = 0; ivl = MIN; ef = Math.max(1.3, ef - 0.2); }
    else if (grade === "hard") { reps += 1; ivl = reps <= 1 ? MIN * 6 : Math.max(ivl * 1.2, 1); ef = Math.max(1.3, ef - 0.15); }
    else if (grade === "good") { reps += 1; ivl = reps <= 1 ? 1 : Math.round(ivl * ef); }
    else if (grade === "easy") { reps += 1; ivl = reps <= 1 ? 4 : Math.round(ivl * ef * 1.3); ef = ef + 0.15; }
    else { return card; }
    return { id: card.id, front: card.front, back: card.back, easeFactor: Math.round(ef * 100) / 100, intervalDays: ivl, repetitions: reps, dueDate: new Date(nowMs + ivl * DAY).toISOString() };
  }

  // ── Mock learning engine: SM-2 + daily challenge + progress + achievements. ──
  function mockLearning(deps) {
    deps = deps || {}; var cards = deps.cards || [], lib = deps.library || [];
    return {
      dueFlashcards: function (nowMs) { nowMs = nowMs || Date.now(); return Promise.resolve(cards.filter(function (c) { return !c.dueDate || Date.parse(c.dueDate) <= nowMs; })); },
      grade: function (cardId, grade, nowMs) { var c = cards.filter(function (x) { return x.id === cardId; })[0]; if (c) { var u = sm2(c, grade, nowMs); Object.keys(u).forEach(function (k) { c[k] = u[k]; }); } return Promise.resolve(); },
      dailyChallenge: function (date) { if (!lib.length) return Promise.resolve(null); var d = date ? new Date(date) : new Date(); var key = d.getUTCFullYear() * 372 + (d.getUTCMonth() + 1) * 31 + d.getUTCDate(); return Promise.resolve(lib[key % lib.length]); },
      progress: function () { var mastered = lib.filter(function (e) { return e.status === "mastered"; }).length; return Promise.resolve({ mastered: mastered, total: 100, streakDays: 12, weeklyDone: [true, true, true, false, false, false, false], weakestTopic: { name: "AV blocks", accuracyPct: 40, recommendedCards: 6 } }); },
      achievements: function () { return Promise.resolve([{ id: "first10", title: "First 10", icon: "trophy", unlocked: true }, { id: "streak10", title: "10-day streak", icon: "local_fire_department", unlocked: true }, { id: "stemi20", title: "STEMI x20", icon: "bolt", unlocked: false }]); }
    };
  }

  function mockProviders(opts) {
    opts = opts || {};
    return {
      kind: "mock",
      analyzer: mockAnalyzer(),
      imageProcessor: mockImageProcessor(),
      ecgStore: mockEcgStore(opts.seedAnalyses),
      library: mockLibrary(opts.content),
      learning: mockLearning({ cards: opts.cards, library: opts.content })
    };
  }

  // Live assembly: the ENCRYPTED on-device store (M3) is real; analyzer stays mock until the backend
  // lands (M5), and library/learning use bundled content once M4 authors it. Always fully functional.
  function liveProviders(opts) {
    opts = opts || {};
    var C = (typeof window !== "undefined") ? window.SMD_KARDIOX_CONTENT : null;
    var content = opts.content || (C && C.ecgs) || [];
    var cards = opts.cards || (C && C.flashcards ? C.flashcards() : []);
    var store = (typeof window !== "undefined" && window.SMD_KARDIOX_STORE && window.SMD_KARDIOX_STORE.create)
      ? window.SMD_KARDIOX_STORE.create() : mockEcgStore(opts.seedAnalyses);
    return {
      kind: "live",
      analyzer: mockAnalyzer(),                 // → RemoteAnalyzer (SMD_KARDIOX_NET) once a backend is configured
      imageProcessor: mockImageProcessor(),
      ecgStore: store,                          // encrypted, on-device
      library: mockLibrary(content),            // bundled 100-ECG content (M4)
      learning: mockLearning({ cards: cards, library: content })
    };
  }

  var _active = null;
  function current() { if (!_active) _active = liveProviders(); return _active; }
  function use(assembly) { _active = assembly; return _active; }

  var API = { mockProviders: mockProviders, liveProviders: liveProviders, current: current, use: use, sm2: sm2 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_KARDIOX_PROVIDERS = API;
})();
