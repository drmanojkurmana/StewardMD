/* Specialty engine shell: one full-screen learning module per host (a specialty). DOM layer, ES5.
   SPECIALTY.createHost(cfg) returns the host: open() hides home, close() restores it, back() unwinds one layer
   (swipe-back.js and Escape call it), openCase(id) opens one clinic case (Review Desk "Read it").
   Registries on the host, filled by feature files and the specialty's own files:
     _clinics  host.registerClinic({id, title, sub, icon, deck, items(deck)?, size?, render(host, item, done)})
     _sims     drills and simulators {id, title, sub, icon, level, open(), startCase()?, line(rec)?}
     _banks    question banks {id, title, sub, icon, open(), start(n)?, topic(t)?, line(), plan()?}
     _tools    calculators {id, title, sub, icon, src, open()}
     _reads    reading {id, title, sub, icon, open(), line(), load()?, find(id)?}
     _explore  explorers with a custom UI, host.registerExplorer({id, title, line, thumb?, icon?, open(host)})
   Features: SPECIALTY.features.<x>(host) (specialty-learn/bank/explore/tools/notes.js). Pure logic lives in
   specialty-core.js (FSRS-6, sessions) and specialty-data.js (levels, access, storage, Learn schema).
   Chrome strings are English and Hindi (clinical numerals stay ASCII); the host overrides them with cfg.strings. */
(function (G) {
  "use strict";
  var C = G.SPECIALTY_CORE, D = G.SPECIALTY_DATA;
  var SP = G.SPECIALTY || (G.SPECIALTY = {});
  if (!SP.features) SP.features = {};

  function T(en, hi) { return { en: en, hi: hi }; }
  /* ---------- chrome, English and Hindi ---------- */
  var STR = {
    close: T("Close", "बंद करें"), back: T("Back", "वापस"), backTo: T("Back to {t}", "{t} पर वापस"),
    loading: T("Loading…", "लोड हो रहा है…"), loadErr: T("{t} did not load. Check your connection and try again.", "{t} लोड नहीं हुआ। अपना कनेक्शन जांचें और फिर कोशिश करें।"),
    retry: T("Try again", "फिर कोशिश करें"), langBtn: T("हिन्दी", "English"), langLabel: T("Language: switch to Hindi", "भाषा: अंग्रेज़ी में बदलें"),
    level: T("Level", "स्तर"), mbbs: T("MBBS", "MBBS"), resident: T("Resident", "Resident"),
    mbbsSub: T("Core course, free", "मुख्य कोर्स, मुफ़्त"), residentSub: T("Full depth, StewardMD Pro", "पूरी गहराई, StewardMD Pro"),
    pro: T("Pro", "Pro"), trial1: T("1 free try", "1 मुफ़्त प्रयास"), trialUsed: T("Trial used", "प्रयास हो चुका"),
    proLine: T("Resident is part of StewardMD Pro. Each clinic, drill, the Resident questions and the timed exam have one free try.", "Resident, StewardMD Pro का हिस्सा है। हर क्लिनिक, ड्रिल, Resident प्रश्न और टाइम्ड परीक्षा का एक मुफ़्त प्रयास है।"),
    seePro: T("See StewardMD Pro", "StewardMD Pro देखें"),
    today: T("Today", "आज"), planDone: T("Plan done", "आज की योजना पूरी"), nOfDone: T("{d} of {n} done", "{n} में से {d} पूरे"),
    streak: T("{n} days in a row", "लगातार {n} दिन"), streak1: T("1 day in a row", "लगातार 1 दिन"),
    startX: T("Start: {t}", "शुरू करें: {t}"), keepGoing: T("Keep going with cases", "केस जारी रखें"),
    pDone: T("done", "पूरा"), pToDo: T("to do", "बाकी"),
    planLesson: T("Lesson", "पाठ"), planRevise: T("Revise", "दोहराएँ"), planCases: T("Cases", "केस"), planQs: T("Questions", "प्रश्न"),
    casesLine: T("{d} waiting · {x} of {n} today", "{d} बाकी · आज {n} में से {x}"), casesNew: T("New cases · {x} of {n} today", "नए केस · आज {n} में से {x}"),
    casesDone: T("{x} read today", "आज {x} पढ़े"), qsLine: T("{x} of {n} today", "आज {n} में से {x}"), qsDue: T("{d} due · ", "{d} बाकी · "),
    qsDone: T("{x} answered today", "आज {x} उत्तर दिए"), drillLine: T("One graded run", "एक ग्रेड वाला अभ्यास"), drillDone: T("Done today", "आज हो गया"),
    lessonToday: T("Done today: {t}", "आज पूरा: {t}"), reviseN: T("{n} to revise", "{n} दोहराने हैं"),
    clinics: T("Clinics", "क्लिनिक"), questions: T("Questions", "प्रश्न"), drills: T("Drills and simulators", "ड्रिल और सिम्युलेटर"),
    tools: T("Calculators", "कैलकुलेटर"), reading: T("Reading", "पढ़ें"),
    seenLine: T("{s} of {n} seen", "{n} में से {s} देखे"), waiting: T("{d} waiting", "{d} बाकी"),
    simNone: T("Not started", "अभी शुरू नहीं"), simLine: T("{ok} of {n} runs right", "{n} में से {ok} सही"),
    nTools: T("{n} tools", "{n} टूल"), toolsNote: T("For learning, not for clinical decisions. Each result shows its rule and source.", "सीखने के लिए, क्लिनिकल निर्णय के लिए नहीं। हर नतीजे के साथ उसका नियम और स्रोत दिखता है।"),
    nothing: T("Nothing waiting here today", "आज यहाँ कुछ बाकी नहीं"),
    sessionDone: T("Session done", "सत्र पूरा"), caughtUp: T("All caught up for today", "आज के सभी केस पूरे"),
    doneLine: T("{n} cases read in this session.", "इस सत्र में {n} केस पढ़े।"), emptyLine: T("No cases are due. New and due cases come back tomorrow.", "अभी कोई केस बाकी नहीं। नए और बाकी केस कल आएंगे।"),
    tomorrow: T("{n} will be waiting tomorrow. Spaced review brings each case back just before you would forget it.", "कल {n} बाकी होंगे। अंतराल पर दोहराना हर केस को ठीक भूलने से पहले वापस लाता है।"),
    progress: T("Your progress", "आपकी प्रगति"), sources: T("Sources and credits", "स्रोत और श्रेय"), sourcesSub: T("Open data, cited rules", "खुला डेटा, उद्धृत नियम"),
    noAnswers: T("No answers yet. Start a lesson or a clinic to see your memory, forecast and activity build up here.", "अभी कोई उत्तर नहीं। यहाँ अपनी याददाश्त, पूर्वानुमान और गतिविधि देखने के लिए कोई पाठ या क्लिनिक शुरू करें।"),
    start: T("Start", "शुरू करें"), answers: T("{n} answers", "{n} उत्तर"), right: T("{p}% right", "{p}% सही"), active: T("{n} days active", "{n} दिन सक्रिय"), active1: T("1 day active", "1 दिन सक्रिय"),
    memory: T("Memory now", "अभी की याददाश्त"), recall: T("{p}% predicted recall", "{p}% याद रहने का अनुमान"), notStarted: T("not started", "शुरू नहीं"),
    recallNote: T("Predicted recall is the memory model's estimate of how much of what you have seen you would get right today.", "याद रहने का अनुमान मेमोरी मॉडल का आकलन है कि आपने जो देखा है उसमें से आज आप कितना सही करेंगे।"),
    next7: T("Next 7 days", "अगले 7 दिन"), dueWeek: T("{n} reviews due, including anything overdue today.", "{n} दोहराने बाकी, आज के छूटे हुए भी मिलाकर।"), nothingWeek: T("Nothing due in the next week.", "अगले हफ़्ते कुछ बाकी नहीं।"),
    weeks12: T("Last 12 weeks", "पिछले 12 हफ़्ते"), less: T("Less", "कम"), more: T("More", "ज़्यादा"),
    hmAria: T("Answers per day over the last 12 weeks: {a} active days of 84.", "पिछले 12 हफ़्तों में प्रतिदिन उत्तर: 84 में से {a} दिन सक्रिय।"),
    fcAria: T("Reviews due, next 7 days: {l}", "अगले 7 दिन दोहराने: {l}"),
    lessonsKey: T("Lessons", "पाठ"), bankKey: T("Question bank", "प्रश्न बैंक"),
    srcData: T("Data and images", "डेटा और तस्वीरें"), srcRules: T("Rules behind the tools and drills", "टूल और ड्रिल के पीछे के नियम"),
    srcMedia: T("Every lesson picture carries its own credit and licence under it.", "हर पाठ की तस्वीर के नीचे उसका श्रेय और लाइसेंस लिखा है।"),
    days: T("days", "दिन"), wd: T("Sun,Mon,Tue,Wed,Thu,Fri,Sat", "रवि,सोम,मंगल,बुध,गुरु,शुक्र,शनि"),
    askMaik: T("Ask MaiK", "MaiK से पूछें"), draft: T("To be verified, draft", "सत्यापन बाकी, ड्राफ़्ट")
  };
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function createHost(cfg) {
    var BASE = cfg.base || "/" + cfg.id + "/";
    var SESSION_SIZE = 12, NEW_CAP = 12, FEW = 5;
    var S = {}, k;
    for (k in STR) if (has(STR, k)) S[k] = STR[k];
    var st = { view: "hub", cfg: null, decks: {}, store: null, prefs: null, loading: null, err: null, session: null,
      again: null, onBack: null, onLeave: null, ret: null, retLabel: null, _prevFocus: null, _shown: null };
    var host = { cfg: cfg, _st: st, _clinics: [], _sims: [], _banks: [], _tools: [], _reads: [], _explore: [] };

    /* ---------- host helpers ---------- */
    function $(id) { return G.document.getElementById(id); }
    function esc(s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }
    function ico(n) {
      try { if (!G.ICONS || !G.ICONS.get || (G.ICONS.has && !G.ICONS.has(n))) return ""; return G.ICONS.get(n); } catch (e) { return ""; }
    }
    function lang() { return st.prefs && st.prefs.lang === "hi" ? "hi" : "en"; }
    function t(obj) { return D.t(obj, lang()); }
    // Chrome string by key, HTML-safe; {x}-style values are escaped. Unknown keys fall back to the key.
    function s(key, v) {
      var o = S[key];
      return esc(o ? D.t(o, lang()) : key).replace(/\{(\w+)\}/g, function (m, x) { return v && v[x] != null ? esc(v[x]) : m; });
    }
    function raw(key, v) { var o = S[key]; return (o ? D.t(o, lang()) : key).replace(/\{(\w+)\}/g, function (m, x) { return v && v[x] != null ? String(v[x]) : m; }); }
    // Content text {en, hi} in the current language, escaped. Missing Hindi falls back to English, marked lang="en".
    function tx(obj) {
      var h = esc(t(obj));
      return lang() === "hi" && obj && typeof obj === "object" && !obj.hi ? '<span lang="en">' + h + "</span>" : h;
    }
    // Numbers: ASCII digits with Indian grouping in both languages.
    var NF = (G.Intl && G.Intl.NumberFormat) ? new G.Intl.NumberFormat("en-IN") : null;
    function fmt(n) { return NF ? NF.format(n) : String(n); }
    function haptic(x) { try { if (G.SMD_HAPTICS && G.SMD_HAPTICS[x]) G.SMD_HAPTICS[x](); } catch (e) {} }
    function isPro() { try { return !!(G.SMD_PRO && G.SMD_PRO.isProSync && G.SMD_PRO.isProSync()); } catch (e) { return false; } }
    function showPro() {
      var f = cfg.proFeature || cfg.id;
      try { if (G.SMD_PRO_NOTICE && G.SMD_PRO_NOTICE.show) return G.SMD_PRO_NOTICE.show(f); } catch (e) {}
      try { if (G.SMD_PRO && G.SMD_PRO.openPaywall) return G.SMD_PRO.openPaywall(f); } catch (e) {}
      try { if (G.toast) G.toast("This level is part of StewardMD Pro"); } catch (e) {}
    }
    function toast(m) { try { if (G.toast) G.toast(m); } catch (e) {} }
    function ls() { try { return G.localStorage; } catch (e) { return null; } }
    function save() { D.saveStore(ls(), st.store, cfg.storeKey); }
    function savePrefs() { D.savePrefs(ls(), st.prefs, cfg.prefKey); }
    function today() { return D.today(Date.now()); }
    // Pictures bundled with the host (clinic images, lesson photos): base URL overridable per host.
    function imgUrl(p) { return (cfg.imgBase || BASE) + p; }
    function getJSON(path) {
      return G.fetch(BASE + path).then(function (r) {
        if (!r.ok) { var e = new Error(path + " " + r.status); e.status = r.status; throw e; }
        return r.json();
      });
    }
    function level() { return st.prefs && st.prefs.level === "resident" ? "resident" : "mbbs"; }
    function levelLocked(lv) { return D.levelLocked(cfg.levels ? cfg : st.cfg, lv || level(), isPro()); }
    function trial(featureId) { return D.trialState(st.store, featureId, !levelLocked("resident")); }
    // Trial gate: checked BEFORE any fetch. A spent trial opens the paywall and never touches the network.
    function gate(featureId, run) {
      var x = trial(featureId);
      if (x === "used") return showPro();
      if (x === "trial") { D.useTrial(st.store, featureId, today()); save(); }
      return run();
    }
    function lockBadge(featureId) {
      var x = trial(featureId);
      return x === "open" ? "" : '<span class="sp-pro' + (x === "used" ? " used" : "") + '">' + ico("lock") + s(x === "trial" ? "trial1" : "trialUsed") + "</span>";
    }
    function enabled() {
      if (!cfg.flag) return true;
      try {
        var q = (G.location.search.match(new RegExp("[?&]" + (cfg.flagParam || cfg.id) + "=([^&]+)")) || [])[1];
        if (q != null) return q === "1" || q === "on" || q === "true";
        return G.localStorage.getItem(cfg.flag) !== "0";
      } catch (e) { return true; }
    }
    // StewardMD's MaiK, when present: the sheet opens above this overlay with the question typed in, and the learner
    // sends it, so MaiK's own engine choice, quota and local-only policy apply.
    function maikBtn(q) {
      if (!G.SMD_askMaik) return "";
      return '<button type="button" class="sp-btn sec sp-maik" data-act="maik" data-q="' + esc(q) + '">' + (typeof window !== "undefined" && window.SMD_MAIK_MARK ? window.SMD_MAIK_MARK.html("mark", { size: 20 }) : ico("ai")) + " " + (typeof window !== "undefined" && window.SMD_MAIK_MARK ? window.SMD_MAIK_MARK.label(s("askMaik")) : s("askMaik")) + "</button>";
    }
    function maikOpen() { try { return G.document.body.classList.contains("maik-open"); } catch (e) { return false; } }

    /* ---------- frame ---------- */
    function root() {
      var el = $(cfg.rootId);
      if (!el) {
        el = G.document.createElement("div");
        el.id = cfg.rootId;
        G.document.body.appendChild(el);
      }
      if (!el._sp) {
        el._sp = 1;
        el.addEventListener("click", onClick);
        el.addEventListener("keydown", onKey);
      }
      el.className = "sp-root " + (cfg.rootClass || "") + (el.classList.contains("on") ? " on" : "");
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      el.setAttribute("aria-label", D.t(cfg.title, "en"));
      return el;
    }
    // A re-render of the same view puts focus back on the control that caused it (language, level, retry);
    // a new view starts at focusSel, else at its back button.
    function focusKey(a) {
      if (!a || !a.getAttribute || !a.getAttribute("data-act")) return null;
      return ["data-act", "data-t", "data-q", "data-o", "data-v", "data-m", "data-l", "data-d", "data-k", "data-s", "data-b"].map(function (x) {
        var v = a.getAttribute(x); return v == null ? "" : "[" + x + '="' + v + '"]';
      }).join("");
    }
    function paint(html, focusSel) {
      var el = root(), a = G.document.activeElement, same = st._shown === st.view, fk = a && el.contains(a) ? focusKey(a) : null;
      el.innerHTML = html;
      var sc = el.querySelector(".sp-scroll");
      if (sc && cfg.draft) sc.insertAdjacentHTML("beforeend", '<p class="sp-draft">' + s("draft") + "</p>");
      if (lang() === "hi") el.setAttribute("lang", "hi"); else el.removeAttribute("lang");
      if (!st.onBack) relabelBack(); // a screen with its own inner back keeps its label
      st._shown = st.view;
      if (typeof focusSel !== "string") focusSel = null;
      var f = (focusSel && el.querySelector(focusSel)) || (same && fk && el.querySelector(fk)) || el.querySelector(".sp-top .sp-back");
      try { if (f) f.focus({ preventScroll: true }); } catch (e) {}
    }
    function top(backLabel, title, sub, right) {
      var chev = ico("chev");
      return '<div class="sp-top"><button type="button" class="sp-back" data-act="back" aria-label="' + esc(backLabel) + '">' +
        (chev ? '<span class="sp-flip">' + chev + "</span>" : "‹") + "</button>" +
        '<div class="sp-title"><b>' + title + "</b>" + (sub ? "<span>" + sub + "</span>" : "") + "</div>" + (right || "") + "</div>";
    }
    function langBtn() {
      var hi = lang() === "hi";
      return '<button type="button" class="sp-lang" data-act="lang" aria-label="' + s("langLabel") + '"><span lang="' + (hi ? "en" : "hi") + '">' + s("langBtn") + "</span></button>";
    }
    function markTop(sub, right, backLabel) {
      return '<div class="sp-top"><button type="button" class="sp-back" data-act="back" aria-label="' + esc(backLabel || raw("close") + " " + D.t(cfg.title, lang())) + '">' +
        (ico("chev") ? '<span class="sp-flip">' + ico("chev") + "</span>" : "‹") + "</button>" +
        '<div class="sp-title sp-hubtitle"><b class="sp-mark" translate="no">' + esc(D.t(cfg.title, lang())) + "</b>" + (sub ? "<span>" + sub + "</span>" : "") + "</div>" +
        (right || "") + langBtn() + "</div>";
    }
    function row(act, attrs, lead, title, sub, line) {
      return '<li><button type="button" class="sp-row" data-act="' + act + '"' + attrs + '><span class="sp-lead" aria-hidden="true">' + lead + "</span>" +
        '<span class="sp-row-b"><b>' + title + "</b>" + (sub ? "<span>" + sub + "</span>" : "") + (line ? '<span class="sp-small">' + line + "</span>" : "") + "</span>" +
        '<span class="sp-chev" aria-hidden="true">' + ico("chev") + "</span></button></li>";
    }
    function tile(n) { return '<span class="sp-tile">' + (ico(n) || ico("book")) + "</span>"; }
    function section(key, rows) { return rows ? '<h2 class="sp-h2">' + s(key) + '</h2><ul class="sp-rows">' + rows + "</ul>" : ""; }

    // The overlay follows the host's light / dark mode (body.dark). Light overlay: dark status-bar icons while open;
    // dark overlay, and on close: the host's own theme. Web and older hosts have no StatusBar plugin.
    function statusBar(onLight) {
      try {
        var b = G.document.body;
        if (onLight && (b.classList.contains("dark") || b.classList.contains("v3-dark"))) onLight = false;
        if (!onLight && G.SMD_THEME_REVEAL && G.SMD_THEME_REVEAL.syncSystemUI) return G.SMD_THEME_REVEAL.syncSystemUI();
        var SB = G.Capacitor && G.Capacitor.Plugins && G.Capacitor.Plugins.StatusBar;
        if (SB && SB.setStyle) SB.setStyle({ style: "LIGHT" });
        if (SB && SB.setBackgroundColor) { try { SB.setBackgroundColor({ color: cfg.statusBg || "#ffffff" }); } catch (e) {} }
      } catch (e) {}
    }

    /* ---------- data ---------- */
    function clinic(id) { for (var i = 0; i < host._clinics.length; i++) if (host._clinics[i].id === id) return host._clinics[i]; return null; }
    function loadAll() {
      if (st.loading) return st.loading;
      st.err = null;
      st.loading = getJSON(cfg.config || "tracks.json").then(function (c) {
        st.cfg = c;
        return Promise.all(host._clinics.map(function (x) { return getJSON(x.deck).then(function (d) { st.decks[x.id] = d; }); })
          .concat(host._reads.concat(host._banks).map(function (r) { return r.load && r.load(); })) // a read's or bank's load() never rejects
          .concat(host._learn ? [host._learn.load()] : [])); // nor does Learn's
      }).catch(function (e) { st.err = e; st.loading = null; throw e; });
      return st.loading;
    }
    function clinicItems(spec) {
      var d = st.decks[spec.id];
      if (!d) return [];
      return spec.items ? spec.items(d) : (d.items || []).map(function (it) { return { id: it.id, a: it.a, c: it }; });
    }
    function clinicCounts(spec, lv) { return C.counts({ id: D.levelKey(spec.id, lv), items: clinicItems(spec) }, st.store, today()); }

    /* ---------- open, close, layered back ---------- */
    function open() {
      if (!enabled()) return false;
      var el = root();
      if (!el.classList.contains("on")) { try { st._prevFocus = G.document.activeElement; } catch (e) { st._prevFocus = null; } }
      try { if (G.SMD_hideHome) G.SMD_hideHome(); } catch (e) {}
      st.store = D.loadStore(ls(), cfg.storeKey);
      st.prefs = D.loadPrefs(ls(), cfg.prefKey);
      el.classList.add("on");
      G.document.body.classList.add("sp-lock");
      statusBar(true);
      leave(); st.session = null; st.view = "hub";
      if (st.cfg && !st.err && st.loading) { renderHub(); return true; }
      renderLoading();
      loadAll().then(function () { if (isOpen() && st.view === "hub") renderHub(); }, function () { if (isOpen()) renderLoadError(); });
      return true;
    }
    // st.onLeave stops a screen's timers when it is left; st.onBack unwinds an inner layer (true when handled);
    // st.ret is where back goes instead of the hub (a lesson's Test yourself returns to the lesson).
    function leave() { var f = st.onLeave; st.onLeave = null; st.onBack = null; st.ret = null; st.retLabel = null; st.again = null; if (f) try { f(); } catch (e) {} }
    function setRet(fn, label) { st.ret = fn; st.retLabel = label ? { t: label, lang: lang() } : null; relabelBack(); }
    function relabelBack() {
      var el = $(cfg.rootId), b = st.ret && st.retLabel && el && el.querySelector(".sp-top .sp-back");
      if (!b) return;
      b.setAttribute("aria-label", st.retLabel.t);
    }
    function close() {
      leave();
      var el = $(cfg.rootId);
      if (el) { el.classList.remove("on"); el.innerHTML = ""; el.removeAttribute("lang"); }
      G.document.body.classList.remove("sp-lock");
      statusBar(false);
      try { if (G.SMD_showHome) G.SMD_showHome(); } catch (e) {}
      try { if (st._prevFocus && st._prevFocus.focus) st._prevFocus.focus(); } catch (e) {}
      st._prevFocus = null; st.session = null; st.view = "hub"; st._shown = null;
    }
    function isOpen() { var el = $(cfg.rootId); return !!(el && el.classList.contains("on")); }
    // Any sub-screen -> its parent (inner layers first) -> the hub -> closed. Answers are saved as they happen.
    function back() {
      if (!isOpen()) return false;
      if (st.onBack && st.onBack()) return true;
      if (st.view === "hub") { close(); return true; }
      var ret = st.ret;
      leave();
      st.session = null; st.view = "hub";
      if (ret) ret(); else renderHub();
      return true;
    }

    function renderLoading() {
      st.view = "hub";
      paint(markTop(tx(cfg.subtitle)) + '<div class="sp-scroll sp-pad"><div class="sp-col"><div class="sp-loading" aria-busy="true">' +
        '<span class="sp-sk sp-sk-a"></span><span class="sp-sk sp-sk-b"></span><span class="sp-sk sp-sk-c"></span><span class="sp-sr" role="status">' + s("loading") + "</span></div></div></div>");
    }
    function renderLoadError() {
      st.view = "hub";
      paint(markTop(tx(cfg.subtitle)) + '<div class="sp-scroll sp-pad"><div class="sp-col"><div class="sp-err" role="alert"><p>' + s("loadErr", { t: D.t(cfg.title, lang()) }) + "</p>" +
        '<button type="button" class="sp-btn pri" data-act="retry">' + ico("refresh") + " " + s("retry") + "</button></div></div></div>", "[data-act=retry]");
    }

    /* ---------- hub: first run, Learn, or Test ---------- */
    // Learn | Test tabs (owner decision): the first open asks which, with the language; afterwards the last tab opens.
    // The first-run screen and both homes are the "hub" view, so back closes.
    function renderHub(focusSel) {
      st.ret = null; st.retLabel = null; st.onBack = null; st.again = null;
      if (host._syncModels) host._syncModels();
      if (host._learn && D.firstRun(st.prefs)) return host._learn.firstRun();
      if (host._learn && st.prefs.tab === "learn") return host._learn.home(focusSel);
      return renderTest(focusSel);
    }
    function renderTest(focusSel) {
      st.view = "hub"; st.again = renderTest;
      var lv = level(), locked = levelLocked(lv), pro = isPro();
      var seg = ["mbbs", "resident"].map(function (l) {
        var lk = D.levelLocked(cfg.levels ? cfg : st.cfg, l, pro);
        return '<button type="button" data-act="level" data-v="' + l + '" aria-pressed="' + (lv === l) + '">' + s(l) +
          (lk ? ' <span class="sp-pro">' + ico("lock") + s("pro") + "</span>" : "") + "</button>";
      }).join("");
      var todayHtml = locked
        ? '<p class="sp-today-line">' + s("proLine") + '</p><button type="button" class="sp-btn sec sp-wide" data-act="pro">' + ico("lock") + " " + s("seePro") + "</button>"
        : planHtml(lv);
      paint(markTop(tx(cfg.subtitle), '<button type="button" class="sp-icon" data-act="stats" aria-label="' + s("progress") + '">' + (ico("trend") || "%") + "</button>") +
        '<div class="sp-scroll sp-pad"><div class="sp-col">' + (host._learn ? host._learn.tabs("test") : "") +
        '<div class="sp-levelrow"><div class="sp-seg" role="group" aria-label="' + s("level") + '">' + seg + "</div>" +
        '<span class="sp-small">' + s(lv === "resident" ? "residentSub" : "mbbsSub") + "</span></div>" +
        featuredHtml() + '<section class="sp-today" aria-label="' + s("today") + '">' + todayHtml + "</section>" +
        section("clinics", clinicRows(lv)) + section("questions", bankRows()) + section("drills", simRows(lv)) +
        (host._learn ? "" : section("reading", readRows()) + section("tools", toolRow())) +
        '<p class="sp-note"><button type="button" class="sp-link" data-act="sources">' + s("sources") + "</button></p>" +
        (cfg.note ? '<p class="sp-note">' + tx(cfg.note) + "</p>" : "") + "</div></div>", focusSel);
    }

    function clinicRows(lv) {
      return host._clinics.map(function (x) {
        var c = clinicCounts(x, lv), line = s("seenLine", { s: fmt(c.seen), n: fmt(c.total) }) +
          (c.due && !levelLocked(lv) ? " · <b>" + s("waiting", { d: fmt(c.due) }) + "</b>" : "") + (lv === "resident" ? " " + lockBadge("clinic." + x.id) : "");
        return row("clinic", ' data-t="' + esc(x.id) + '"', x.thumb ? x.thumb(host) : tile(x.icon || "pulse"), tx(x.title), x.sub ? tx(x.sub) : "", line);
      }).join("");
    }
    function bankRows() {
      return host._banks.map(function (b) { return row("bank", ' data-b="' + esc(b.id) + '"', tile(b.icon || "list"), tx(b.title), tx(b.sub), b.line()); }).join("");
    }
    function simLine(x) {
      var r = (st.store.sims || {})[x.id];
      return (x.line ? x.line(r) : r && r.n ? s("simLine", { ok: fmt(r.ok), n: fmt(r.n) }) : s("simNone")) + (x.level === "resident" ? " " + lockBadge("drill." + x.id) : "");
    }
    // A featured simulator card (Narkē: the Ventilator Lab) on the Test hub and the Learn home.
    function featuredHtml() {
      return host._sims.filter(function (x) { return x.feature && x.open; }).map(function (x) {
        return '<button type="button" class="sp-feat" data-act="sim" data-s="' + esc(x.id) + '"><span class="sp-lead" aria-hidden="true">' + tile(x.icon || "target") + "</span>" +
          '<span class="sp-feat-b"><b>' + tx(x.title) + "</b><span>" + tx(x.feature) + '</span><small>' + simLine(x) + '</small></span><span class="sp-chev" aria-hidden="true">' + ico("chev") + "</span></button>";
      }).join("");
    }
    function simRows() {
      return host._sims.map(function (x) { return row("sim", ' data-s="' + esc(x.id) + '"', tile(x.icon || "target"), tx(x.title), x.sub ? tx(x.sub) : "", simLine(x)); }).join("");
    }
    function readRows() {
      return host._reads.filter(function (r) { return !r.ready || r.ready(); }).map(function (r) { return row("read", ' data-r="' + esc(r.id) + '"', tile(r.icon || "book"), tx(r.title), tx(r.sub), r.line()); }).join("");
    }
    // One row for the calculators; the list is its own screen so the hub stays short.
    function toolRow() {
      var tl = host._tools;
      if (!tl.length) return "";
      return row("tools", "", tile("calc"), s("tools"), tl.map(function (x) { return esc(t(x.title)); }).join(", "), s("nTools", { n: fmt(tl.length) }));
    }
    function renderTools() {
      var tl = host._tools;
      leave();
      st.view = "tools"; st.again = renderTools;
      paint(top(raw("back"), s("tools"), s("nTools", { n: fmt(tl.length) }), langBtn()) +
        '<div class="sp-scroll sp-pad"><div class="sp-col"><p class="sp-small sp-toolsnote">' + s("toolsNote") + "</p>" +
        '<ul class="sp-rows" aria-label="' + s("tools") + '">' + tl.map(function (x) {
          return row("tool", ' data-s="' + esc(x.id) + '"', tile(x.icon || "calc"), tx(x.title), x.sub ? tx(x.sub) : "", esc(x.src || ""));
        }).join("") + "</ul></div></div>");
    }

    /* Today's plan: built each day from what is due. MBBS: the next lesson, then a few cases and a few questions.
       Resident: cases due first (at least 10, at most 20), questions, and one graded drill rotating by day. */
    function reviewedToday(prefixes) {
      var n = 0, d = today(), key, i;
      for (key in st.store.cards) {
        if (st.store.cards[key][2] !== d) continue;
        for (i = 0; i < prefixes.length; i++) if (key.indexOf(prefixes[i]) === 0) { n++; break; }
      }
      return n;
    }
    function planItems(lv) {
      var d = today(), items = [], mb = lv === "mbbs";
      if (host._learn) { var li = host._learn.planItem(); if (li) items.push(li); }
      if (host._clinics.length) {
        var due = 0;
        host._clinics.forEach(function (x) { due += clinicCounts(x, lv).due; });
        var done = reviewedToday(host._clinics.map(function (x) { return D.levelKey(x.id, lv) + ":"; }));
        var target = mb ? FEW : Math.max(10, Math.min(20, due + done));
        items.push({ act: "today", n: mb ? FEW : 0, title: raw("planCases"), done: done >= target,
          line: done >= target ? s("casesDone", { x: fmt(done) }) : due ? s("casesLine", { d: fmt(due), x: fmt(done), n: fmt(target) }) : s("casesNew", { x: fmt(done), n: fmt(target) }) });
      }
      host._banks.forEach(function (b) {
        if (!b.start || (b.ready && !b.ready())) return;
        var bd = 0, key;
        for (key in st.store.cards) if (key.indexOf(b.id + ":") === 0 && st.store.cards[key][3] <= d) bd++;
        var bdone = reviewedToday([b.id + ":"]), bt = mb ? FEW : Math.max(10, Math.min(20, bd + bdone));
        items.push({ act: "planbank", key: b.id, n: mb ? FEW : 0, title: raw("planQs"), done: bdone >= bt,
          line: bdone >= bt ? s("qsDone", { x: fmt(bdone) }) : (bd ? s("qsDue", { d: fmt(bd) }) : "") + s("qsLine", { x: fmt(bdone), n: fmt(bt) }) });
      });
      var sims = mb ? [] : host._sims.filter(function (x) { return x.startCase; });
      if (sims.length) {
        var x = sims[d % sims.length], r = (st.store.sims || {})[x.id], sd = !!(r && r.last === d);
        items.push({ act: "plansim", key: x.id, title: t(x.title), done: sd, line: sd ? s("drillDone") : s("drillLine") });
      }
      return items;
    }
    function planHtml(lv) {
      var items = planItems(lv), left = items.filter(function (x) { return !x.done; }), all = !left.length;
      var streakN = C.streak(st.store, today());
      function attrs(x) { return x ? (x.key ? ' data-k="' + esc(x.key) + '"' : "") + (x.n ? ' data-n="' + x.n + '"' : "") : ""; }
      var rows = items.map(function (x) {
        return '<li><button type="button" class="sp-plan-row" data-act="' + x.act + '"' + attrs(x) + ' data-done="' + x.done + '">' +
          '<span class="sp-plan-ck" aria-hidden="true">' + (x.done ? ico("check") : "") + "</span>" +
          '<span class="sp-plan-b"><b>' + esc(x.title) + "</b><span>" + x.line + "</span></span>" +
          '<span class="sp-chev" aria-hidden="true">' + ico("chev") + '</span><span class="sp-sr">' + s(x.done ? "pDone" : "pToDo") + "</span></button></li>";
      }).join("");
      if (!items.length) return '<p class="sp-today-line">' + s("nothing") + "</p>";
      var nx = left[0];
      return '<div class="sp-plan-h"><b>' + s("today") + '</b><span class="sp-mut">' + (all ? s("planDone") : s("nOfDone", { d: fmt(items.length - left.length), n: fmt(items.length) })) +
        (streakN ? " · " + (streakN === 1 ? s("streak1") : s("streak", { n: fmt(streakN) })) : "") + "</span></div>" +
        '<ol class="sp-day">' + rows + "</ol>" +
        (nx ? '<button type="button" class="sp-btn pri sp-wide" data-act="' + nx.act + '"' + attrs(nx) + ">" + ico("play") + " " + s("startX", { t: nx.title }) + "</button>"
          : host._clinics.length ? '<button type="button" class="sp-btn sec sp-wide" data-act="today">' + ico("play") + " " + s("keepGoing") + "</button>" : "");
    }

    /* ---------- clinics: the engine runs the session, the plugin renders each case ---------- */
    function registerClinic(spec) { if (!clinic(spec.id)) host._clinics.push(spec); return spec; }
    // Resident clinics go through the trial gate once per session, never per case.
    function startClinic(id, opts) {
      var spec = clinic(id);
      opts = opts || {};
      if (!spec) return false;
      var go = function () {
        var lv = level(), items = clinicItems(spec);
        if (opts.only) items = items.filter(function (x) { return opts.only.indexOf(String(x.id)) >= 0; });
        if (opts.classes && opts.classes.length) items = items.filter(function (x) { return opts.classes.indexOf(x.a) >= 0; }); // a lesson's Test yourself
        var size = opts.size || spec.size || SESSION_SIZE;
        var list = C.buildSession({ id: D.levelKey(spec.id, lv), items: items }, st.store, today(), { size: size, newCap: opts.newCap || spec.newCap || Math.min(size, NEW_CAP) });
        return runClinic(spec, list, opts.name);
      };
      if (level() === "resident") return gate("clinic." + id, go);
      return go();
    }
    // "Cases" in Today's plan: every clinic's due cases, interleaved, topped up with new ones.
    function startToday(size) {
      if (levelLocked()) return showPro();
      if (!host._clinics.length) return false;
      var spec = host._clinics[0];
      if (host._clinics.length > 1) {
        var best = null, lv = level();
        host._clinics.forEach(function (x) { var c = clinicCounts(x, lv); if (!best || c.due > best.due) best = { x: x, due: c.due }; });
        spec = best.x;
      }
      return startClinic(spec.id, { size: size > 0 ? size : SESSION_SIZE });
    }
    function runClinic(spec, list, name) {
      if (!list.length) { toast(raw("nothing")); renderHub(); return false; }
      leave();
      st.session = { clinic: spec.id, name: name || t(spec.title), list: list, i: 0, done: 0 };
      showCase();
      return true;
    }
    function showCase() {
      var sess = st.session;
      if (!sess) return;
      var spec = clinic(sess.clinic);
      if (sess.i >= sess.list.length) return renderClinicDone();
      st.view = "clinic"; st.onBack = null; st.again = null;
      spec.render(host, sess.list[sess.i], function () {
        if (st.session !== sess) return;
        sess.done++; sess.i++;
        showCase();
      });
    }
    function renderClinicDone() {
      var sess = st.session, n = sess ? sess.done : 0, spec = sess && clinic(sess.clinic), lv = level();
      var tomorrow = spec ? D.dueOn(st.store, D.levelKey(spec.id, lv) + ":", today() + 1) : 0;
      st.view = "clinic-done"; st.again = renderClinicDone;
      paint(top(raw("backTo", { t: D.t(cfg.title, lang()) }), n ? s("sessionDone") : esc(D.t(cfg.title, lang())), spec ? tx(spec.title) : "", langBtn()) +
        '<div class="sp-scroll sp-pad"><div class="sp-col sp-done"><p class="sp-done-h">' + s(n ? "sessionDone" : "caughtUp") + "</p>" +
        "<p>" + (n ? s("doneLine", { n: fmt(n) }) : s("emptyLine")) + "</p>" +
        (tomorrow ? '<p class="sp-small">' + s("tomorrow", { n: fmt(tomorrow) }) + "</p>" : "") +
        '<button type="button" class="sp-btn pri sp-wide" data-act="hub">' + s("backTo", { t: D.t(cfg.title, lang()) }) + "</button></div></div>", "[data-act=hub]");
    }
    function openCase(caseId, clinicId) {
      if (!enabled()) return false;
      open();
      return loadAll().then(function () {
        var spec = clinic(clinicId || cfg.caseClinic || (host._clinics[0] && host._clinics[0].id));
        if (!spec || !isOpen()) return false;
        var it = clinicItems(spec).filter(function (x) { return String(x.id) === String(caseId); })[0];
        if (!it) { renderHub(); return false; }
        var run = function () { return runClinic(spec, [it], t(spec.title)); };
        return level() === "resident" ? gate("clinic." + spec.id, run) === true : run();
      }, function () { if (isOpen()) renderLoadError(); return false; });
    }

    /* ---------- progress (stats) ---------- */
    function totalAnswers() { var n = 0; Object.keys(st.store.days).forEach(function (d) { n += st.store.days[d]; }); return n; }
    function summaryLine() {
      var total = totalAnswers();
      if (!total) return null;
      var conf = 0, ok = 0;
      Object.keys(st.store.conf).forEach(function (dk) {
        var dd = st.store.conf[dk];
        Object.keys(dd).forEach(function (truth) { var r = dd[truth]; Object.keys(r).forEach(function (ch) { conf += r[ch]; if (ch === truth) ok += r[ch]; }); });
      });
      var sn = C.streak(st.store, today()), bits = [];
      if (sn) bits.push(sn === 1 ? s("streak1") : s("streak", { n: fmt(sn) }));
      bits.push(s("answers", { n: fmt(total) }));
      if (conf) bits.push(s("right", { p: Math.round(ok * 100 / conf) }));
      var da = Object.keys(st.store.days).length;
      bits.push(da === 1 ? s("active1") : s("active", { n: fmt(da) }));
      return bits.join(" · ");
    }
    function memoryHtml(lv) {
      var rows = host._clinics.map(function (x) { return [tx(x.title), D.levelKey(x.id, lv)]; })
        .concat(host._banks.map(function (b) { return [tx(b.title), b.id]; }))
        .concat(host._learn ? [[s("lessonsKey"), "learn"]] : []).map(function (r) {
          var rec = C.recall(st.store, r[1], today()), pct = rec.meanR == null ? null : Math.round(rec.meanR * 100);
          return '<li><div class="sp-srow-h"><span>' + r[0] + "</span><b>" + (pct == null ? '<span class="sp-mut">' + s("notStarted") + "</span>" : s("recall", { p: pct })) + "</b></div></li>";
        }).join("");
      return '<h2 class="sp-h2">' + s("memory") + '</h2><ul class="sp-slist">' + rows + '</ul><p class="sp-small">' + s("recallNote") + "</p>";
    }
    function forecastHtml() {
      var days = C.forecast(st.store, today(), 7), w0 = new Date().getDay(), max = 1, wd = raw("wd").split(",");
      days.forEach(function (n) { if (n > max) max = n; });
      var total = days.reduce(function (a, b) { return a + b; }, 0);
      return '<h2 class="sp-h2">' + s("next7") + '</h2><div class="sp-fc" role="img" aria-label="' + s("fcAria", { l: days.join(", ") }) + '">' + days.map(function (n, i) {
        return '<div class="sp-fc-col"><i style="height:' + (n ? Math.max(8, Math.round(n * 100 / max)) : 3) + '%"></i><span>' + esc(wd[(w0 + i) % 7]) + "</span></div>";
      }).join("") + '</div><p class="sp-small">' + (total ? s("dueWeek", { n: fmt(total) }) : s("nothingWeek")) + "</p>";
    }
    function heatHtml() {
      var N = 84, d0 = today(), counts = [], max = 1, i;
      for (i = N - 1; i >= 0; i--) { var n = st.store.days[d0 - i] || 0; counts.push(n); if (n > max) max = n; }
      var active = counts.filter(function (n) { return n > 0; }).length;
      function lvl(n) { if (!n) return 0; var f = n / max; return f > 0.75 ? 4 : f > 0.5 ? 3 : f > 0.25 ? 2 : 1; }
      return '<h2 class="sp-h2">' + s("weeks12") + '</h2><div class="sp-hm" role="img" aria-label="' + s("hmAria", { a: fmt(active) }) + '">' +
        counts.map(function (n) { return '<i class="sp-hm-' + lvl(n) + '"></i>'; }).join("") + "</div>" +
        '<div class="sp-hm-legend" aria-hidden="true"><span>' + s("less") + '</span><i class="sp-hm-0"></i><i class="sp-hm-1"></i><i class="sp-hm-2"></i><i class="sp-hm-3"></i><i class="sp-hm-4"></i><span>' + s("more") + "</span></div>";
    }
    function simsStatsHtml() {
      var rows = host._sims.map(function (x) {
        var r = (st.store.sims || {})[x.id];
        return r && r.n ? '<li><div class="sp-srow-h"><span>' + tx(x.title) + "</span><b>" + s("simLine", { ok: fmt(r.ok), n: fmt(r.n) }) + "</b></div></li>" : "";
      }).join("");
      return rows ? '<h2 class="sp-h2">' + s("drills") + '</h2><ul class="sp-slist">' + rows + "</ul>" : "";
    }
    function renderStats() {
      leave();
      st.view = "stats"; st.again = renderStats;
      var sum = summaryLine(), lv = level();
      var body = sum ? '<p class="sp-stat-line">' + sum + "</p>" + memoryHtml(lv) + forecastHtml() + heatHtml() + simsStatsHtml()
        : '<div class="sp-today"><p class="sp-today-line">' + s("noAnswers") + '</p><button type="button" class="sp-btn pri sp-wide" data-act="hub">' + ico("play") + " " + s("start") + "</button></div>";
      paint(top(raw("back"), s("progress"), s(lv), langBtn()) + '<div class="sp-scroll sp-pad"><div class="sp-col">' + body + "</div></div>");
    }

    /* ---------- sources and credits ---------- */
    function renderSources() {
      leave();
      st.view = "sources"; st.again = renderSources;
      var src = (st.cfg && st.cfg.sources) || {}, list = Object.keys(src).map(function (k) { return src[k]; });
      host._banks.forEach(function (b) { var x = b.sourceInfo && b.sourceInfo(); if (x) list.push(x); });
      var data = list.map(function (x) {
        return "<li><b>" + tx(x.name) + "</b><span>" + esc(x.license || x.licence || "") + "</span><p>" + tx(x.cite) + "</p>" +
          (x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer">' + esc(x.url) + "</a>" : "") + "</li>";
      }).join("");
      var rules = [];
      (host._models ? host._models() : []).forEach(function (m) {
        (m.sources || []).forEach(function (x) {
          rules.push("<li><b>" + tx(m.title) + "</b><p>" + (x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer">' + esc(x.label || x.url) + "</a>" : esc(x.label)) + "</p></li>");
        });
      });
      paint(top(raw("back"), s("sources"), s("sourcesSub"), langBtn()) +
        '<div class="sp-scroll sp-pad"><div class="sp-col">' +
        (data ? '<h2 class="sp-h2">' + s("srcData") + '</h2><ul class="sp-sources">' + data + "</ul>" : "") +
        (rules.length ? '<h2 class="sp-h2">' + s("srcRules") + '</h2><ul class="sp-sources">' + rules.join("") + "</ul>" : "") +
        (host._learn ? '<p class="sp-note">' + s("srcMedia") + "</p>" : "") +
        (st.cfg && st.cfg.reviewNote ? '<p class="sp-note">' + tx(st.cfg.reviewNote) + "</p>" : "") + "</div></div>");
    }

    /* ---------- events ---------- */
    var ACTIONS = {}, KEYS = {};
    function onClick(e) {
      var b = e.target.closest && e.target.closest("[data-act]"), el = $(cfg.rootId);
      if (!b || !el || !el.contains(b) || b.disabled || b.getAttribute("aria-disabled") === "true" && b.getAttribute("data-act") !== "back") return;
      var a = b.getAttribute("data-act");
      if (ACTIONS[a]) ACTIONS[a](b, e);
    }
    function onKey(e) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (KEYS[st.view]) KEYS[st.view](e);
    }
    function setPref(key, v) { st.prefs[key] = v; savePrefs(); }
    ACTIONS.back = function () { back(); };
    ACTIONS.hub = function () { leave(); st.session = null; renderHub(); };
    ACTIONS.retry = function () { st.loading = null; st.err = null; open(); };
    ACTIONS.maik = function (b) { try { G.SMD_askMaik(b.getAttribute("data-q")); } catch (x) {} };
    ACTIONS.lang = function () { setPref("lang", lang() === "hi" ? "en" : "hi"); if (st.again) st.again("[data-act=lang]"); else renderHub("[data-act=lang]"); };
    ACTIONS.level = function (b) {
      var v = b.getAttribute("data-v") === "resident" ? "resident" : "mbbs";
      if (v === st.prefs.level) return;
      setPref("level", v);
      renderHub('[data-act=level][data-v="' + v + '"]'); // locked Resident content stays visible with its badges
    };
    ACTIONS.pro = function () { showPro(); };
    ACTIONS.stats = renderStats;
    ACTIONS.sources = renderSources;
    ACTIONS.clinic = function (b) { startClinic(b.getAttribute("data-t")); };
    ACTIONS.today = function (b) { startToday(b && b.getAttribute ? +b.getAttribute("data-n") : 0); };
    ACTIONS.bank = function (b) { var id = b.getAttribute("data-b"); host._banks.forEach(function (x) { if (x.id === id) x.open(); }); };
    ACTIONS.planbank = function (b) { var key = b.getAttribute("data-k"), n = +b.getAttribute("data-n") || 0; host._banks.forEach(function (x) { if (x.id === key) x.start(n); }); };
    ACTIONS.plansim = function (b) { var key = b.getAttribute("data-k"); host._sims.forEach(function (x) { if (x.id === key) x.startCase(); }); };
    ACTIONS.sim = function (b) { var id = b.getAttribute("data-s"); host._sims.forEach(function (x) { if (x.id === id) x.open(); }); };
    ACTIONS.read = function (b) { var id = b.getAttribute("data-r"); host._reads.forEach(function (r) { if (r.id === id) r.open(); }); };
    ACTIONS.tools = renderTools;
    // Back from a calculator returns to the list; leave() first so the calculator keeps its last values.
    ACTIONS.tool = function (b) {
      var id = b.getAttribute("data-s");
      host._tools.forEach(function (x) { if (x.id === id) x.open(true); });
    };

    // Escape unwinds one layer like swipe-back; MaiK or CliniX (an OSCE opened from here) above the overlay owns Escape while open.
    if (G.document && G.document.addEventListener)
      G.document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape" || !isOpen() || maikOpen()) return;
        if (G.CLINIX && G.CLINIX.isOpen && G.CLINIX.isOpen()) return;
        e.preventDefault();
        back();
      });

    var I = {
      STR: S, T: T, esc: esc, ico: ico, s: s, raw: raw, tx: tx, t: t, lang: lang, fmt: fmt, haptic: haptic, isPro: isPro, showPro: showPro, toast: toast,
      ls: ls, save: save, savePrefs: savePrefs, setPref: setPref, today: today, imgUrl: imgUrl, getJSON: getJSON, level: level, levelLocked: levelLocked,
      trial: trial, gate: gate, lockBadge: lockBadge, enabled: enabled, maikBtn: maikBtn, root: root, paint: paint, top: top, markTop: markTop,
      langBtn: langBtn, row: row, tile: tile, section: section, leave: leave, setRet: setRet, renderHub: renderHub, renderTest: renderTest,
      renderStats: renderStats, featuredHtml: featuredHtml, renderSources: renderSources, renderTools: renderTools, clinic: clinic, clinicItems: clinicItems, startClinic: startClinic,
      loadAll: loadAll, ACTIONS: ACTIONS, KEYS: KEYS, BASE: BASE, SESSION_SIZE: SESSION_SIZE, NEW_CAP: NEW_CAP, FEW: FEW
    };
    host.open = open; host.close = close; host.back = back; host.isOpen = isOpen; host.openCase = openCase;
    host.registerClinic = registerClinic;
    // A simulator's own UI replaces the placeholder entry the drills feature lists for its model.
    // pin: true lists it first on the Test hub; feature: {en, hi} also gives it a featured card above the plan.
    host.registerSim = function (x) {
      for (var i = 0; i < host._sims.length; i++) if (host._sims[i].id === x.id) { host._sims.splice(i, 1); break; }
      if (x.pin) host._sims.unshift(x); else host._sims.splice(i, 0, x);
      return x;
    };
    host.registerExplorer = function (x) { if (!host._explore.some(function (y) { return y.id === x.id; })) host._explore.push(x); return x; };
    // Repaint the current screen (language, content reload); the hub when a screen has no repaint of its own.
    host._render = function (f) { if (!isOpen()) return; if (st.again) st.again(typeof f === "string" ? f : null); else renderHub(); };
    host._internal = I;
    if (cfg.global) G[cfg.global] = host;
    return host;
  }

  SP.createHost = createHost;
  SP.STR = STR;
})(typeof window !== "undefined" ? window : this);
