/* Specialty engine tools and drills: generic screens for the specialty's models. ES5.
   Models are plain objects registered on a host global (createHost cfg.models, e.g. window.<HOST>_MODELS[id]):
     tool  {id, kind:"tool", title, group, level, sources, review, inputs:[{id, label, type: number|select|date|bool,
            unit?, min?, max?, step?, options?, required?}], compute(values) -> {ok, value, unit?, label, band?, lines, rule}
            | {ok:false, error}, examples:[{values, expect}]}
     drill {id, kind:"drill", title, level, sources, review, scenario, timeLimitSec?, stages:[{id, prompt, vitals?, timeSec?,
            options:[{id, text, correct, critical?, feedback, next?}]}], score(attempt) -> {pct, criticalMisses, lines}}
   A drill's stages may live in <base>drill/<id>.json and load when it opens. option.next names the next stage; with
   no next the following stage comes; "end" (or the last stage) finishes. A model with its own UI (a time-stepped
   simulator, an explorer) is listed only when its UI registers (host.registerSim / host.registerExplorer).
   SPECIALTY.features.tools(host) renders calculators; SPECIALTY.features.drills(host) runs drills. Pure checks load
   under node for tests. */
(function (G) {
  "use strict";
  var C = (typeof module !== "undefined" && module.exports) ? require("./specialty-core.js") : G.SPECIALTY_CORE;
  function T(en, hi) { return { en: en, hi: hi }; }

  /* ================= pure ================= */
  // Numbers as typed on a phone: a true minus, a decimal comma, spaces. Anything else is NaN.
  function parseNum(v) {
    if (typeof v === "number") return v;
    var s = String(v == null ? "" : v).replace(/−/g, "-").replace(/\s+/g, "");
    // "1,500" or "1,25,000" (thousands, Indian or Western grouping) drops the commas; a lone "12,5" is a decimal comma.
    s = /^[-+]?[1-9]\d{0,2}(,\d{2,3})*,\d{3}$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    return parseFloat(s);
  }
  function lower(obj, lang) { var x = (obj && (obj[lang] || obj.en)) || ""; return lang === "en" ? x.charAt(0).toLowerCase() + x.slice(1) : x; }
  function realDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  // One input's raw value -> {v} or {err: {en, hi}}. An empty optional input is {v: null}.
  function checkInput(inp, raw) {
    var empty = raw == null || String(raw).replace(/\s/g, "") === "";
    if (inp.type === "bool") return { v: raw === true || raw === "true" || raw === "on" };
    if (empty) return inp.required ? { err: T("Enter " + lower(inp.label, "en") + ".", lower(inp.label, "hi") + " भरें।") } : { v: null };
    if (inp.type === "select") {
      var hit = null;
      (inp.options || []).forEach(function (o) { if (String(o.value) === String(raw)) hit = o; });
      return hit ? { v: hit.value } : { err: T("Choose one of the options.", "विकल्पों में से एक चुनें।") };
    }
    if (inp.type === "date") return realDate(raw) ? { v: String(raw) } : { err: T("Enter a real date.", "सही तारीख भरें।") };
    var v = parseNum(raw);
    if (isNaN(v)) return { err: T("Enter a number.", "एक संख्या भरें।") };
    if ((inp.min != null && v < inp.min) || (inp.max != null && v > inp.max)) {
      var u = inp.unit ? " " + inp.unit : "";
      return { err: T("Use " + inp.min + " to " + inp.max + u + ".", inp.min + " से " + inp.max + u + " तक भरें।") };
    }
    return { v: v };
  }
  function bi(v) { return v && typeof v === "object" && typeof v.en === "string" && !!v.en.trim(); }
  function common(m, kind) {
    var e = [];
    if (!m || typeof m !== "object") return [kind + ": not an object"];
    if (typeof m.id !== "string" || !/^[a-z0-9-]+$/.test(m.id)) e.push("id: lowercase letters, digits and hyphens");
    if (m.kind !== kind) e.push("kind: " + kind);
    if (!bi(m.title)) e.push("title: needs {en, hi}");
    if (m.level !== "mbbs" && m.level !== "resident") e.push("level: mbbs or resident");
    if (m.review !== "ai_drafted" && m.review !== "reviewed") e.push("review: ai_drafted until approved");
    if (!Array.isArray(m.sources) || !m.sources.length) e.push("sources: at least one");
    else m.sources.forEach(function (x, i) { if (!x || typeof x.label !== "string" || !x.label) e.push("sources[" + i + "]: {label, url}"); });
    return e;
  }
  var TYPES = ["number", "select", "date", "bool"];
  function validateTool(m) {
    var e = common(m, "tool"), ids = {};
    if (!m || typeof m !== "object") return e;
    if (m.group !== "obstetrics" && m.group !== "gynaecology" && typeof m.group !== "string") e.push("group: a string");
    if (!Array.isArray(m.inputs) || !m.inputs.length) e.push("inputs: at least one");
    else m.inputs.forEach(function (inp, i) {
      var w = "inputs[" + i + "]";
      if (!inp || typeof inp.id !== "string" || !inp.id) { e.push(w + ".id: missing"); return; }
      if (ids[inp.id]) e.push(w + ".id: duplicate " + inp.id);
      ids[inp.id] = 1;
      if (TYPES.indexOf(inp.type) < 0) e.push(w + ".type: number, select, date or bool");
      if (!bi(inp.label)) e.push(w + ".label: needs {en, hi}");
      if (inp.type === "select" && !(Array.isArray(inp.options) && inp.options.length && inp.options.every(function (o) { return o && o.value != null && bi(o.label); }))) e.push(w + ".options: [{value, label}]");
    });
    if (typeof m.compute !== "function") e.push("compute: a function");
    if (!Array.isArray(m.examples) || !m.examples.length) e.push("examples: at least one pinned from the source");
    return e;
  }
  // A number within tol; a bilingual {en, hi} result against a pinned English string; otherwise equal as JSON.
  function same(a, b, tol) {
    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= (tol > 0 ? tol : 1e-9);
    if (a && typeof a === "object" && typeof a.en === "string" && typeof b === "string") return a.en === b;
    return JSON.stringify(a) === JSON.stringify(b);
  }
  // Every pinned example against compute: [{i, ok, got, expect}]. expect is the result's value (a number, within the
  // example's tol when it has one, or a string such as a date), or an object whose keys must match the result's.
  function runExamples(m) {
    return (m.examples || []).map(function (x, i) {
      var r;
      try { r = m.compute(x.values); } catch (err) { return { i: i, ok: false, got: String(err), expect: x.expect }; }
      var ok = !!r && r.ok !== false;
      if (ok && x.expect && typeof x.expect === "object") Object.keys(x.expect).forEach(function (k) { if (!same(r[k], x.expect[k], x.tol)) ok = false; });
      else if (ok) ok = same(r.value, x.expect, x.tol);
      return { i: i, ok: ok, got: r && (r.ok === false ? r.error : r.value), expect: x.expect };
    });
  }
  function validateDrill(m) {
    var e = common(m, "drill"), ids = {};
    if (!m || typeof m !== "object") return e;
    if (!bi(m.scenario)) e.push("scenario: needs {en, hi}");
    if (!Array.isArray(m.stages) || !m.stages.length) { e.push("stages: at least one"); return e; }
    m.stages.forEach(function (x, i) { if (x && x.id != null) { if (ids[x.id]) e.push("stages[" + i + "].id: duplicate " + x.id); ids[x.id] = 1; } });
    m.stages.forEach(function (x, i) {
      var w = "stages[" + i + "]", oids = {};
      if (!x || typeof x.id !== "string") { e.push(w + ".id: missing"); return; }
      if (!bi(x.prompt)) e.push(w + ".prompt: needs {en, hi}");
      if (!Array.isArray(x.options) || !x.options.length) { e.push(w + ".options: at least one"); return; }
      if (!x.options.some(function (o) { return o && o.correct; })) e.push(w + ": needs a correct option");
      x.options.forEach(function (o, j) {
        var ow = w + ".options[" + j + "]";
        if (!o || typeof o.id !== "string") { e.push(ow + ".id: missing"); return; }
        if (oids[o.id]) e.push(ow + ".id: duplicate " + o.id);
        oids[o.id] = 1;
        if (!bi(o.text)) e.push(ow + ".text: needs {en, hi}");
        if (!bi(o.feedback)) e.push(ow + ".feedback: needs {en, hi}");
        if (o.next != null && o.next !== "end" && !ids[o.next]) e.push(ow + ".next: unknown stage " + o.next);
      });
    });
    // every stage reachable from the first
    var seen = {}, todo = [m.stages[0].id];
    while (todo.length) {
      var id = todo.pop(), st = null;
      if (seen[id]) continue;
      seen[id] = 1;
      m.stages.forEach(function (x) { if (!st && x.id === id) st = x; });
      if (!st || !st.options) continue;
      st.options.forEach(function (o) { var n = nextStage(m, id, o); if (n && !seen[n]) todo.push(n); });
    }
    m.stages.forEach(function (x, i) { if (x && x.id && !seen[x.id]) e.push("stages[" + i + "]: never reached"); });
    if (typeof m.score !== "function") e.push("score: a function");
    return e;
  }
  function nextStage(m, stageId, option) {
    if (option && option.next === "end") return null;
    if (option && option.next) return option.next;
    for (var i = 0; i < m.stages.length; i++) if (m.stages[i].id === stageId) return m.stages[i + 1] ? m.stages[i + 1].id : null;
    return null;
  }
  // A drill result as an FSRS grade: a critical miss or under half right is Again.
  function drillGrade(res) {
    if (!res || (res.criticalMisses && res.criticalMisses.length) || res.pct < 50) return C.AGAIN;
    if (res.pct < 80) return C.HARD;
    return res.pct < 100 ? C.GOOD : C.EASY;
  }
  function timeLeft(limitSec, t0, now) {
    if (!(limitSec > 0)) return null;
    return Math.max(0, limitSec - Math.floor((now - t0) / 1000));
  }

  var PURE = { parseNum: parseNum, checkInput: checkInput, validateTool: validateTool, runExamples: runExamples, validateDrill: validateDrill,
    nextStage: nextStage, drillGrade: drillGrade, timeLeft: timeLeft };
  if (typeof module !== "undefined" && module.exports) { module.exports = PURE; return; }
  var SP = G.SPECIALTY || (G.SPECIALTY = {});
  if (!SP.features) SP.features = {};
  SP.TOOLS = PURE;

  /* ================= shared UI helpers ================= */
  var STR = {
    rule: T("Rule", "नियम"), sources: T("Sources", "स्रोत"), learnOnly: T("For learning, not for clinical decisions.", "सीखने के लिए, क्लिनिकल निर्णय के लिए नहीं।"),
    drafted: T("Rule-based, pending specialist review.", "नियम-आधारित, विशेषज्ञ समीक्षा बाकी।"),
    result: T("Result", "नतीजा"), example: T("Worked example {n}", "हल किया उदाहरण {n}"), examples: T("Worked examples from the source", "स्रोत से हल किए उदाहरण"),
    fill: T("Fill in the inputs", "इनपुट भरें"), check: T("Check {x}", "{x} जाँचें"), backTools: T("Back to calculators", "कैलकुलेटर पर वापस"),
    up: T("{x} up {s}", "{x} {s} बढ़ाएँ"), down: T("{x} down {s}", "{x} {s} घटाएँ"),
    normal: T("Normal", "सामान्य"), caution: T("Caution", "सावधानी"), danger: T("Urgent", "तुरंत ध्यान दें"),
    backTest: T("Back to Test", "टेस्ट पर वापस"), start: T("Start the drill", "ड्रिल शुरू करें"), scenario: T("Scenario", "स्थिति"),
    limit: T("{m} min to finish", "पूरा करने के लिए {m} मिनट"), stepOf: T("Step {i}", "चरण {i}"), left: T("{t} left", "{t} बाकी"),
    stageLeft: T("{t} for this step", "इस चरण के लिए {t}"), cont: T("Continue", "आगे"), see: T("See my result", "मेरा नतीजा देखें"),
    right: T("Right call", "सही निर्णय"), wrong: T("Not the best call", "सबसे सही निर्णय नहीं"), timeout: T("Time ran out for this step.", "इस चरण का समय खत्म हो गया।"),
    timeUp: T("Time is up.", "समय पूरा हुआ।"), done: T("Drill done", "ड्रिल पूरी"), pct: T("{p}% right", "{p}% सही"),
    critical: T("Critical steps missed", "छूटे हुए ज़रूरी कदम"), noCritical: T("No critical step missed.", "कोई ज़रूरी कदम नहीं छूटा।"),
    again: T("Try again", "फिर करें"), your: T("Your choices", "आपके निर्णय"), noChoice: T("No choice made", "कोई निर्णय नहीं"),
    loadErr: T("This drill did not load. Check the connection and try again.", "यह ड्रिल लोड नहीं हुई। कनेक्शन जांचें और फिर कोशिश करें।"),
    loading: T("Loading the drill…", "ड्रिल लोड हो रही है…"), retry: T("Try again", "फिर कोशिश करें"),
    obstetrics: T("Obstetrics", "प्रसूति"), gynaecology: T("Gynaecology", "स्त्री रोग"), drill: T("Drill", "ड्रिल"), sim: T("Simulator", "सिम्युलेटर"),
    simSoon: T("Screen coming in the next update", "स्क्रीन अगले अपडेट में"),
    simSoonLong: T("This simulator's model is built and tested; its screen arrives in the next update.", "इस सिम्युलेटर का मॉडल बन चुका है और जाँचा गया है; इसकी स्क्रीन अगले अपडेट में आएगी।")
  };
  function kit(host) {
    var I = host._internal, D = G.SPECIALTY_DATA, cfg = host.cfg, own = (cfg.strings && cfg.strings.tools) || {}, S = {}, k;
    for (k in STR) S[k] = STR[k];
    for (k in own) if (Object.prototype.hasOwnProperty.call(own, k)) S[k] = own[k];
    function L() { return I.lang(); }
    function s(key, v) { return I.esc(D.t(S[key], L())).replace(/\{(\w)\}/g, function (m, x) { return v && v[x] != null ? I.esc(v[x]) : m; }); }
    function raw(key) { return D.t(S[key], L()); }
    function models(kind) {
      var all = G[cfg.models] || {}, out = [], id;
      for (id in all) if (Object.prototype.hasOwnProperty.call(all, id) && all[id] && (!kind || all[id].kind === kind)) out.push(all[id]);
      return out;
    }
    function srcList(m) {
      return '<ol class="tl-refs">' + (m.sources || []).map(function (x) {
        return "<li>" + (x.url ? '<a href="' + I.esc(x.url) + '" target="_blank" rel="noopener noreferrer">' + I.esc(x.label || x.url) + "</a>" : I.esc(x.label)) + "</li>";
      }).join("") + "</ol>";
    }
    return { I: I, D: D, s: s, raw: raw, models: models, srcList: srcList, L: L };
  }
  // The registries follow the models loaded so far (the manifest loads them after the features).
  function sync(host) {
    if (host._syncModels) return;
    var K = kit(host);
    host._models = function () { return K.models(); };
    host._syncModels = function () { (host._syncers || []).forEach(function (f) { f(); }); };
    host._syncers = [];
    return K;
  }

  /* ================= calculators ================= */
  SP.features.tools = function (host) {
    sync(host);
    var K = kit(host), I = K.I, D = K.D, s = K.s, st = host._st, A = I.ACTIONS, esc = I.esc, ico = I.ico, NB = " ";
    var cur = null, mem = {}, sayT = 0;
    function $(id) { return G.document.getElementById(id); }
    host._syncers.push(function () {
      K.models("tool").forEach(function (m) {
        if (host._tools.some(function (x) { return x.id === m.id; })) return;
        host._tools.push({ id: m.id, title: m.title, sub: m.sub || STR[m.group] || null, icon: m.icon || "calc",
          src: (m.sources && m.sources[0] && m.sources[0].label) || "", open: function (fromList) { open(m, fromList === true); } });
      });
    });
    host._syncModels();

    function initial(m) {
      var v = {};
      m.inputs.forEach(function (inp) { v[inp.id] = inp.type === "bool" ? false : inp.type === "select" && inp.options && inp.options.length ? inp.options[0].value : null; });
      return v;
    }
    function fmtVal(inp, v) { return v == null ? "" : inp.type === "number" ? String(v).replace("-", "−") : String(v); }
    function numHtml(inp, v) {
      var id = "tl-" + inp.id, e = id + "-e", lab = I.tx(inp.label);
      var stp = function (d) {
        return '<button type="button" class="tl-st" data-act="tstep" data-k="' + esc(inp.id) + '" data-d="' + d + '" aria-label="' +
          s(d > 0 ? "up" : "down", { x: D.t(inp.label, K.L()), s: inp.step + (inp.unit ? " " + inp.unit : "") }) + '">' + (d > 0 ? "+" : "−") + "</button>";
      };
      return '<div class="tl-f" id="tlf-' + esc(inp.id) + '"><label class="tl-l" for="' + id + '">' + lab + "</label>" +
        '<div class="tl-in">' + (inp.step ? stp(-1) : "") + '<div class="tl-box">' +
        '<input id="' + id + '" name="' + esc(inp.id) + '" data-k="' + esc(inp.id) + '" type="text" inputmode="decimal" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done" value="' + esc(fmtVal(inp, v)) + '" aria-describedby="' + e + '">' +
        (inp.unit ? '<span class="tl-u" aria-hidden="true">' + esc(inp.unit) + "</span>" : "") + "</div>" + (inp.step ? stp(1) : "") +
        '</div><p class="tl-e" id="' + e + '" aria-live="polite"></p></div>';
    }
    function selHtml(inp, v) {
      var id = "tll-" + inp.id, stack = inp.options.length > 3 || inp.options.some(function (o) { return D.t(o.label, "en").length > 14; });
      return '<div class="tl-f"><span class="tl-l" id="' + id + '">' + I.tx(inp.label) + "</span>" +
        '<div class="' + (stack ? "tl-stack" : "sp-seg tl-seg") + '" role="group" aria-labelledby="' + id + '">' +
        inp.options.map(function (o) {
          return '<button type="button" data-act="tset" data-k="' + esc(inp.id) + '" data-v="' + esc(String(o.value)) + '" aria-pressed="' + (String(v) === String(o.value)) + '">' +
            (stack ? '<i class="tl-dot" aria-hidden="true"></i>' : "") + I.tx(o.label) + "</button>";
        }).join("") + "</div></div>";
    }
    function boolHtml(inp, v) {
      return '<div class="tl-f"><label class="tl-chk"><input type="checkbox" data-k="' + esc(inp.id) + '"' + (v ? " checked" : "") + "><span>" + I.tx(inp.label) + "</span></label></div>";
    }
    function dateHtml(inp, v) {
      var id = "tl-" + inp.id;
      return '<div class="tl-f" id="tlf-' + esc(inp.id) + '"><label class="tl-l" for="' + id + '">' + I.tx(inp.label) + '</label><div class="tl-box tl-datebox">' +
        '<input id="' + id + '" name="' + esc(inp.id) + '" data-k="' + esc(inp.id) + '" type="date" value="' + esc(v || "") + '" aria-describedby="' + id + '-e"></div><p class="tl-e" id="' + id + '-e" aria-live="polite"></p></div>';
    }
    function formHtml() {
      return cur.m.inputs.map(function (inp) {
        var v = cur.v[inp.id];
        return inp.type === "select" ? selHtml(inp, v) : inp.type === "bool" ? boolHtml(inp, v) : inp.type === "date" ? dateHtml(inp, v) : numHtml(inp, v);
      }).join("");
    }
    function inputOf(id) { var r = null; cur.m.inputs.forEach(function (x) { if (x.id === id) r = x; }); return r; }
    function showErr(id, msg) {
      var box = $("tlf-" + id), e = $("tl-" + id + "-e"), inp = $("tl-" + id);
      if (!box || !e) return;
      e.textContent = msg ? D.t(msg, K.L()) : "";
      if (msg) { box.setAttribute("data-bad", ""); inp.setAttribute("aria-invalid", "true"); } else { box.removeAttribute("data-bad"); inp.removeAttribute("aria-invalid"); }
    }

    // fromList: opened from the calculator list, so back returns there (from a lesson, back returns to the lesson).
    function open(m, fromList) {
      I.leave();
      cur = { m: m, v: mem[m.id] || initial(m), bad: {}, shown: {} };
      st.view = "tool"; st.again = function () { open(m, fromList); };
      st.onBack = fromList ? function () { I.leave(); I.renderTools(); return true; } : null;
      var ex = (m.examples || []).map(function (x, i) { return '<button type="button" class="sp-btn sec tl-ex" data-act="tex" data-i="' + i + '">' + s("example", { n: i + 1 }) + "</button>"; }).join("");
      I.paint(I.top(K.raw("backTools"), I.tx(m.title), m.group ? s(m.group) : "", I.langBtn()) +
        '<div class="sp-scroll" id="tlScroll"><div class="tl-wrap">' +
        '<div class="tl-sumwrap"><section class="tl-sum" id="tlSum" aria-label="' + s("result") + '"></section></div>' +
        '<div class="tl-form" id="tlForm">' + formHtml() + "</div>" +
        (ex ? '<h2 class="sp-h2">' + s("examples") + '</h2><div class="tl-exs">' + ex + "</div>" : "") +
        '<footer class="tl-src"><h2 class="sp-h2">' + s("rule") + '</h2><p class="tl-rule" id="tlRule"></p>' +
        '<h2 class="sp-h2">' + s("sources") + "</h2>" + K.srcList(m) +
        "<p>" + s("learnOnly") + (m.review === "ai_drafted" ? " " + s("drafted") : "") + "</p></footer>" +
        '</div></div><p class="sp-sr" id="tlSay" role="status" aria-live="polite" aria-atomic="true"></p>');
      st.onLeave = function () { if (cur) mem[cur.m.id] = cur.v; G.clearTimeout(sayT); cur = null; };
      var f = $("tlForm");
      f.addEventListener("input", onInput);
      f.addEventListener("change", onChange);
      f.addEventListener("focusout", onBlur);
      f.addEventListener("keydown", onKey);
      update();
    }
    function update() {
      var m = cur.m, first = null, x, r = null;
      for (x in cur.bad) if (cur.bad.hasOwnProperty(x) && !first) first = x;
      if (!first) { try { r = m.compute(cur.v); } catch (e) { r = { ok: false, error: { en: "This result could not be worked out.", hi: "यह नतीजा नहीं निकल सका।" } }; } }
      var sum = $("tlSum"), L = K.L();
      if (r && r.ok !== false) {
        var band = r.band && STR[r.band] ? '<span class="tl-band" data-band="' + esc(r.band) + '">' + s(r.band) + "</span>" : "";
        sum.innerHTML = '<p class="tl-big"' + (r.band ? ' data-band="' + esc(r.band) + '"' : "") + "><span>" + I.tx(r.label) + "</span><b>" + esc(r.value) +
          (r.unit ? "<small>" + NB + esc(r.unit) + "</small>" : "") + "</b>" + band + "</p>" +
          ((r.lines || []).length ? '<ul class="tl-lines">' + r.lines.map(function (l) { return "<li>" + I.tx(l) + "</li>"; }).join("") + "</ul>" : "");
      } else {
        var msg = first ? D.t(S_check(), L).replace("{x}", D.t(inputOf(first).label, L)) + ": " + D.t(cur.bad[first], L) : r ? D.t(r.error, L) : "";
        sum.innerHTML = '<p class="tl-wait">' + (ico("info") || "") + "<span>" + esc(msg || D.t(STR.fill, L)) + "</span></p>";
      }
      $("tlRule").textContent = r && r.rule ? D.t(r.rule, L) : m.rule ? D.t(m.rule, L) : "";
      var said = r && r.ok !== false ? D.t(r.label, L) + " " + r.value + (r.unit ? " " + r.unit : "") : "";
      G.clearTimeout(sayT);
      sayT = G.setTimeout(function () { var el = $("tlSay"); if (el && said) el.textContent = said; }, 700);
    }
    function S_check() { return STR.check; }
    function setVal(inp, v) {
      cur.v[inp.id] = v; delete cur.bad[inp.id]; cur.shown[inp.id] = false;
      var el = $("tl-" + inp.id); if (el) el.value = fmtVal(inp, v);
      showErr(inp.id, null);
      update();
    }
    function onInput(e) {
      var el = e.target, id = el.getAttribute && el.getAttribute("data-k"), inp = id && inputOf(id);
      if (!inp || (el.type !== "text" && el.type !== "date")) return;
      var c = checkInput(inp, el.value);
      if (c.err) { cur.bad[id] = c.err; if (cur.shown[id]) showErr(id, c.err); }
      else { cur.v[id] = c.v; delete cur.bad[id]; showErr(id, null); cur.shown[id] = false; }
      update();
    }
    function onBlur(e) {
      var el = e.target, id = el.getAttribute && el.getAttribute("data-k"), inp = id && inputOf(id);
      if (!inp || !cur || el.type !== "text") return;
      if (cur.bad[id]) { cur.shown[id] = true; showErr(id, cur.bad[id]); } else el.value = fmtVal(inp, cur.v[id]);
    }
    function onChange(e) {
      var el = e.target, id = el.getAttribute && el.getAttribute("data-k");
      if (!id || !cur) return;
      if (el.type === "checkbox") { cur.v[id] = el.checked; update(); }
      else if (el.type === "date") onInput(e);
    }
    function onKey(e) {
      var el = e.target, id = el.getAttribute && el.getAttribute("data-k"), inp = id && inputOf(id);
      if (!inp || el.type !== "text") return;
      if (e.key === "Enter") { e.preventDefault(); el.blur(); return; }
      if (inp.step && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); step(inp, e.key === "ArrowUp" ? 1 : -1); }
    }
    function step(inp, d) {
      var base = cur.v[inp.id] == null || cur.bad[inp.id] ? (inp.min != null && inp.min > 0 ? inp.min : 0) : cur.v[inp.id];
      var dp = String(inp.step).indexOf(".") >= 0 ? String(inp.step).split(".")[1].length : 0;
      var v = +((base + d * inp.step).toFixed(dp));
      if (inp.min != null && v < inp.min) v = inp.min;
      if (inp.max != null && v > inp.max) v = inp.max;
      setVal(inp, v);
    }
    I.ACTIONS.tstep = function (b) { if (!cur) return; step(inputOf(b.getAttribute("data-k")), +b.getAttribute("data-d")); I.haptic("tap"); };
    I.ACTIONS.tset = function (b) {
      if (!cur) return;
      var inp = inputOf(b.getAttribute("data-k")), raw = b.getAttribute("data-v"), val = null;
      inp.options.forEach(function (o) { if (String(o.value) === raw) val = o.value; });
      cur.v[inp.id] = val;
      Array.prototype.forEach.call(b.parentNode.querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      update();
    };
    I.ACTIONS.tex = function (b) {
      if (!cur) return;
      var x = cur.m.examples[+b.getAttribute("data-i")], v = initial(cur.m), id;
      for (id in x.values) if (x.values.hasOwnProperty(id)) v[id] = x.values[id];
      cur.v = v; cur.bad = {}; cur.shown = {};
      $("tlForm").innerHTML = formHtml();
      update();
      try { $("tlSum").scrollIntoView({ block: "nearest" }); } catch (e) {}
    };
    return { open: open };
  };

  /* ================= drills: branching, timed, scored ================= */
  SP.features.drills = function (host) {
    sync(host);
    var K = kit(host), I = K.I, D = K.D, s = K.s, st = host._st, A = I.ACTIONS, esc = I.esc, ico = I.ico;
    var R = null, tick = 0, loaded = {};
    function $(id) { return G.document.getElementById(id); }
    host._syncers.push(function () {
      K.models("drill").forEach(function (m) {
        if (host._sims.some(function (x) { return x.id === m.id; })) return;
        // A time-stepped simulator has its own UI, which replaces this entry when it registers (host.registerSim).
        if (typeof m.init === "function" && !m.stages) {
          host._sims.push({ id: m.id, title: m.title, sub: m.sub || STR.sim, icon: m.icon || "pulse", level: m.level, pending: true,
            line: function () { return s("simSoon"); }, open: function () { soon(m); } });
          return;
        }
        host._sims.push({ id: m.id, title: m.title, sub: m.sub || STR.drill, icon: m.icon || "target", level: m.level, open: function () { open(m); }, startCase: function () { open(m); } });
      });
    });
    host._syncModels();

    // A listed simulator whose screen has not shipped yet: say so plainly, with its sources.
    function soon(m) {
      I.leave();
      st.view = "drill"; st.again = function () { soon(m); };
      I.paint(I.top(K.raw("backTest"), I.tx(m.title), s(m.level), I.langBtn()) +
        '<div class="sp-scroll sp-pad"><div class="sp-col"><section class="sp-today"><p class="sp-today-line">' + s("simSoonLong") + "</p></section>" +
        '<h2 class="sp-h2">' + s("sources") + "</h2>" + K.srcList(m) + "</div></div>");
    }
    function stage(id) { var r = null; R.m.stages.forEach(function (x) { if (!r && x.id === id) r = x; }); return r; }
    // Vital signs by their usual keys, labelled in both languages with units; any other key shows as written.
    var VITALS = { pulse: [T("Pulse", "नाड़ी"), "/min"], hr: [T("Heart rate", "हृदय गति"), "/min"], bp: [T("BP", "BP"), "mmHg"], rr: [T("Resp. rate", "श्वसन दर"), "/min"],
      spo2: [T("SpO2", "SpO2"), "%"], temp: [T("Temp", "तापमान"), "\u00b0C"], lossMl: [T("Blood loss", "रक्तस्राव"), "mL"], fhr: [T("Fetal heart", "भ्रूण हृदय गति"), "bpm"],
      gcs: [T("GCS", "GCS"), ""], urineMl: [T("Urine", "मूत्र"), "mL/h"], hb: [T("Hb", "Hb"), "g/dL"] };
    function stop() { if (tick) { G.clearInterval(tick); tick = 0; } }
    function clockText(sec) { return Math.floor(sec / 60) + ":" + ("0" + (sec % 60)).slice(-2); }
    // Resident drills are Pro with one trial (drill.<id>), checked before the drill's data is fetched.
    function open(m) {
      var go = function () {
        if (m.stages || loaded[m.id]) return intro(m);
        I.leave();
        st.view = "drill"; st.again = null;
        I.paint(I.top(K.raw("backTest"), I.tx(m.title), "", I.langBtn()) + '<div class="sp-scroll sp-pad"><div class="sp-col"><p class="sp-mut" role="status">' + s("loading") + "</p></div></div>");
        I.getJSON("drill/" + m.id + ".json").then(function (d) {
          ["scenario", "stages", "timeLimitSec"].forEach(function (x) { if (d[x] != null && m[x] == null) m[x] = d[x]; });
          loaded[m.id] = 1;
          if (st.view === "drill") intro(m);
        }, function () {
          if (st.view !== "drill") return;
          I.paint(I.top(K.raw("backTest"), I.tx(m.title), "", I.langBtn()) + '<div class="sp-scroll sp-pad"><div class="sp-col"><p role="alert">' + s("loadErr") + "</p>" +
            '<button type="button" class="sp-btn pri" data-act="drillopen" data-s="' + esc(m.id) + '">' + (ico("refresh") || "") + " " + s("retry") + "</button></div></div>", ".sp-btn");
        });
      };
      return m.level === "resident" ? I.gate("drill." + m.id, go) : go();
    }
    function intro(m) {
      I.leave();
      stop();
      st.view = "drill"; st.again = function () { intro(m); };
      I.paint(I.top(K.raw("backTest"), I.tx(m.title), s(m.level), I.langBtn()) +
        '<div class="sp-scroll sp-pad"><div class="sp-col dr-intro"><h2 class="sp-h2">' + s("scenario") + '</h2><p class="dr-scn">' + I.tx(m.scenario) + "</p>" +
        (m.timeLimitSec ? '<p class="sp-small">' + (ico("clock") || "") + " " + s("limit", { m: Math.round(m.timeLimitSec / 60) }) + "</p>" : "") +
        '<button type="button" class="sp-btn pri sp-wide" data-act="drillgo">' + (ico("play") || "") + " " + s("start") + "</button>" +
        '<h2 class="sp-h2">' + s("sources") + "</h2>" + K.srcList(m) +
        '<p class="sp-note">' + s("learnOnly") + (m.review === "ai_drafted" ? " " + s("drafted") : "") + "</p></div></div>", "[data-act=drillgo]");
      R = { m: m };
    }
    function begin() {
      var m = R.m;
      R = { m: m, t0: Date.now(), choices: [], cur: m.stages[0].id, i: 0, picked: null, st0: Date.now(), over: false };
      st.onLeave = stop;
      renderStage();
      stop();
      tick = G.setInterval(onTick, 1000);
    }
    function onTick() {
      if (!R || R.over || st.view !== "drill-stage") return stop();
      var left = timeLeft(R.m.timeLimitSec, R.t0, Date.now()), x = stage(R.cur), sl = x && R.picked == null ? timeLeft(x.timeSec, R.st0, Date.now()) : null;
      var c = $("drClock"); if (c && left != null) c.textContent = D.t(STR.left, K.L()).replace("{t}", clockText(left));
      var c2 = $("drStage"); if (c2 && sl != null) c2.textContent = D.t(STR.stageLeft, K.L()).replace("{t}", clockText(sl));
      if (left === 0) { R.timeUp = true; return finish(); }
      if (sl === 0) choose(null);
    }
    function renderStage(focusSel) {
      var m = R.m, x = stage(R.cur), picked = R.picked, L = K.L();
      st.view = "drill-stage"; st.again = function (f) { renderStage(f); };
      st.onBack = null;
      var vit = x.vitals ? '<dl class="dr-vitals">' + Object.keys(x.vitals).map(function (k) {
        var v = x.vitals[k], known = VITALS[k];
        var label = typeof v === "object" && v && v.label ? D.t(v.label, L) : known ? D.t(known[0], L) : k;
        var val = typeof v === "object" && v ? (v.value != null ? v.value : D.t(v, L)) : v;
        return "<div><dt>" + esc(label) + "</dt><dd>" + esc(val) + (known && known[1] && typeof v !== "object" ? "<small>" + esc(known[1]) + "</small>" : "") + "</dd></div>";
      }).join("") + "</dl>" : "";
      var opts = x.options.map(function (o, j) {
        var stt = picked === undefined || picked === null ? "" : o.correct ? "right" : o.id === picked ? "wrong" : "dim";
        return '<button type="button" class="sp-ans" data-act="drillpick" data-o="' + esc(o.id) + '"' + (R.answered ? ' aria-disabled="true"' : "") + (stt ? ' data-state="' + stt + '"' : "") +
          '><span class="k" aria-hidden="true">' + (stt === "right" ? ico("check") || "✓" : stt === "wrong" ? ico("close") || "x" : j + 1) + "</span>" + I.tx(o.text) + "</button>";
      }).join("");
      var left = timeLeft(m.timeLimitSec, R.t0, Date.now()), sl = x.timeSec && !R.answered ? timeLeft(x.timeSec, R.st0, Date.now()) : null;
      I.paint(I.top(K.raw("backTest"), I.tx(m.title), s("stepOf", { i: R.i + 1 }),
          left != null ? '<span class="dr-clock" id="drClock" role="timer" aria-live="off">' + s("left", { t: clockText(left) }) + "</span>" : "") +
        '<div class="sp-scroll sp-pad" id="drScroll"><div class="sp-col"><p class="dr-prompt" id="drQ">' + I.tx(x.prompt) + "</p>" + vit +
        (sl != null ? '<p class="sp-small dr-stageclock" id="drStage">' + s("stageLeft", { t: clockText(sl) }) + "</p>" : "") +
        '<div class="sp-answers' + (R.answered ? " done" : "") + '" role="group" aria-labelledby="drQ">' + opts + "</div>" +
        '<div id="drFb" aria-live="polite">' + (R.answered ? fbHtml(x) : "") + "</div></div></div>" +
        '<div class="sp-foot"><button type="button" class="sp-btn pri sp-wide" data-act="drillnext" id="drNext"' + (R.answered ? "" : " hidden") + ">" +
        (R.answered && nextStage(m, x.id, pickedOpt(x)) ? s("cont") : s("see")) + "</button></div>", focusSel || (R.answered ? "#drNext" : ".sp-ans"));
    }
    function pickedOpt(x) { var r = null; x.options.forEach(function (o) { if (o.id === R.picked) r = o; }); return r; }
    function fbHtml(x) {
      var o = pickedOpt(x);
      if (!o) return '<div class="dr-fb sp-reveal"><p class="sp-verdict bad">' + (ico("clock") || "") + "<span>" + s("timeout") + "</span></p></div>";
      return '<div class="dr-fb sp-reveal"><p class="sp-verdict ' + (o.correct ? "ok" : "bad") + '">' + (ico(o.correct ? "check" : "close") || "") + "<span>" + s(o.correct ? "right" : "wrong") + "</span></p>" +
        '<p class="dr-fbt">' + I.tx(o.feedback) + "</p></div>";
    }
    function choose(optId) {
      var x = stage(R.cur);
      if (R.answered) return;
      R.answered = true; R.picked = optId;
      R.choices.push({ stage: x.id, option: optId, atSec: Math.round((Date.now() - R.t0) / 1000), spentSec: Math.round((Date.now() - R.st0) / 1000) });
      var o = pickedOpt(x);
      I.haptic(o && o.correct ? "success" : "error");
      renderStage("#drNext");
    }
    function advance() {
      var x = stage(R.cur), n = nextStage(R.m, x.id, pickedOpt(x) || {});
      if (!n) return finish();
      R.cur = n; R.i++; R.picked = null; R.answered = false; R.st0 = Date.now();
      renderStage();
    }
    function finish() {
      stop();
      if (!R || R.over) return;
      R.over = true;
      var m = R.m, res;
      try { res = m.score({ choices: R.choices }); } catch (e) { res = { pct: 0, criticalMisses: [], lines: [] }; }
      var crit = res.criticalMisses || [], ok = !crit.length && res.pct >= 80, today = I.today();
      C.recordSim(st.store, m.id, ok, ok ? null : crit.length ? "critical" : "score", today);
      C.review(st.store, "drill", m.id, drillGrade(res), today);
      I.save();
      R.res = res;
      result();
    }
    function optText(id) {
      var r = null;
      R.m.stages.forEach(function (x) { x.options.forEach(function (o) { if (o.id === id) r = o; }); });
      return r ? I.tx(r.text) : esc(id);
    }
    function result() {
      var m = R.m, res = R.res, crit = res.criticalMisses || [];
      st.view = "drill-done"; st.again = result; st.onBack = null;
      var path = R.choices.map(function (c) {
        var x = stage(c.stage), o = null;
        x.options.forEach(function (y) { if (y.id === c.option) o = y; });
        return '<li class="' + (o && o.correct ? "ok" : "no") + '"><span>' + I.tx(x.prompt) + "</span><b>" + (o ? I.tx(o.text) : s("noChoice")) + "</b></li>";
      }).join("");
      I.paint(I.top(K.raw("backTest"), s("done"), I.tx(m.title), I.langBtn()) +
        '<div class="sp-scroll sp-pad"><div class="sp-col"><p class="dr-score" tabindex="-1">' + s("pct", { p: res.pct }) + "</p>" +
        (R.timeUp ? '<p class="sp-small">' + s("timeUp") + "</p>" : "") +
        (crit.length ? '<h2 class="sp-h2 dr-crit">' + s("critical") + '</h2><ul class="dr-critl">' + crit.map(function (id) { return "<li>" + optText(id) + "</li>"; }).join("") + "</ul>" : '<p class="sp-verdict ok">' + (ico("check") || "") + "<span>" + s("noCritical") + "</span></p>") +
        ((res.lines || []).length ? '<ul class="dr-lines">' + res.lines.map(function (l) { return "<li>" + I.tx(l) + "</li>"; }).join("") + "</ul>" : "") +
        '<h2 class="sp-h2">' + s("your") + '</h2><ol class="dr-path">' + path + "</ol>" +
        I.maikBtn("I just ran a teaching drill: " + D.t(m.title, "en") + ". Scenario: " + D.t(m.scenario, "en") + " I scored " + res.pct + "%" +
          (crit.length ? " and missed these critical steps: " + crit.map(function (id) { var t = optText(id); return t.replace(/<[^>]+>/g, ""); }).join("; ") : "") + ". Walk me through the correct sequence and why.") +
        '<h2 class="sp-h2">' + s("sources") + "</h2>" + K.srcList(m) + "</div></div>" +
        '<div class="sp-foot"><div class="mcq-foot2"><button type="button" class="sp-btn sec" data-act="drillagain">' + s("again") + '</button><button type="button" class="sp-btn pri" data-act="hub">' + s("backTest") + "</button></div></div>", ".dr-score");
    }
    A.drillgo = function () { if (R && R.m) begin(); };
    A.drillpick = function (b) { if (R && !R.answered) choose(b.getAttribute("data-o")); };
    A.drillnext = function () { if (R && R.answered) advance(); };
    A.drillagain = function () { if (R && R.m) open(R.m); };
    A.drillopen = function (b) { var id = b.getAttribute("data-s"), m = (G[host.cfg.models] || {})[id]; if (m) open(m); };
    I.KEYS["drill-stage"] = function (e) {
      if (!R || R.answered || !/^[1-9]$/.test(e.key)) return;
      var x = stage(R.cur), o = x.options[+e.key - 1];
      if (o) { e.preventDefault(); choose(o.id); }
    };
    return { open: open };
  };
})(typeof window !== "undefined" ? window : this);
