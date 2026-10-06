/* StewardMD - Clinical review desk (window.SMD_REVIEW).
 *
 * Everything clinical in the app that was compiled with AI assistance (Knowledge Library protocols,
 * specialty kits, consent templates) carries review.status "ai_drafted" and says "pending clinical
 * review" until a named clinician reviews it. This desk is where a reviewer does that: list, read,
 * decide (approve, approve with minor edits, needs changes), comment, then export the decisions as one
 * signed-by-name JSON file through the share sheet. The owner applies an export with
 *   node scripts/apply-reviews.mjs <file.json>
 * which sets review.status "reviewed" and the reviewer on each approved item and writes "needs
 * changes" feedback to vault/handoff/review-feedback.md. Nothing is uploaded from here (wave 2 syncs it).
 * Decisions are kept on this phone (content ids and comments only, never patient data).
 * Flag: smd_review_desk (default ON, reachable from Home > Add Tool > Review content). Buildless ES5.
 * The Tokós tab lists the CTG trainer's pending approvals: one item per case in tokos/decks/ctg.json (the
 * suggested labels a doctor confirms) and one per teaching text block (rationale, checklist wording, caliper
 * verdicts). "Read it" opens a case straight in Tokós (TOKOS.openCase, which loads Tokós first) and shows a text block here.
 * Tokós 2.0 adds one item per Learn unit, question-bank topic (its key flags), drill, the labour simulator, calculator,
 * explorer and ultrasound clinic (teaching points); their state comes from tokos/reviews.json (apply-reviews.mjs writes
 * it). Units holding lessons with review.verify (numbers written without the source open) are listed first.
 * A fifth tab, "Clinical updates", appears only for registered bulletin signers and owners; it is drawn by
 * bulletins-desk.js (SMD_BULLETINS_DESK) and, unlike the tabs above, talks to the server.
 */
(function (root) {
  "use strict";
  var G = root, D = root.document;
  var LS_KEY = "smd_review_decisions";
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function ms(n) { return '<span class="material-symbols-outlined kit-ic" aria-hidden="true">' + n + "</span>"; }
  function toast(m) { try { (G.toast || G.SMD_toast) && (G.toast || G.SMD_toast)(m); } catch (e) {} }
  var DECISIONS = [["approve", "Approve as it is"], ["approve-minor", "Approve after the minor edits I describe"], ["changes", "Needs changes before use"]];
  var KINDS = [["protocol", "Protocols"], ["kit", "Specialty kits"], ["consent", "Consent templates"], ["tokos", "Tokós"], ["narke", "Narkē"]];
  // Specialty-engine hosts with a Review Desk tab: display name, data base, models global, loader global.
  var SPEC = { tokos: { name: "Tokós", base: "SMD_TOKOS_BASE", dir: "/tokos/", models: "TOKOS_MODELS", loader: "TOKOS_LOADER" },
    narke: { name: "Narkē", base: "SMD_NARKE_BASE", dir: "/narke/", models: "NARKE_MODELS", loader: "NARKE_LOADER" } };
  function specBase(h) { return G[SPEC[h].base] || SPEC[h].dir; }

  function loadDecisions() { try { var o = JSON.parse((G.localStorage && G.localStorage.getItem(LS_KEY)) || "{}"); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; } }
  function saveDecisions(o) { try { G.localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch (e) {} }
  /** Pure: the export file for a set of decisions. */
  function buildExport(dec, reviewer, now) {
    var list = Object.keys(dec).sort().map(function (k) { var d = dec[k], p = k.split(":"); return { kind: p[0], id: p.slice(1).join(":"), decision: d.decision, comment: d.comment || "", at: d.at }; });
    return { schema: 1, app: "StewardMD review desk", exportedAt: now || new Date().toISOString(), reviewer: { name: reviewer.name || "", regNo: reviewer.regNo || "", speciality: reviewer.speciality || "", verified: !!reviewer.verified }, decisions: list };
  }

  var S = { deskOn: false, kind: "protocol", sel: "", showText: false, items: { protocol: null, kit: null, consent: null, tokos: null, narke: null }, specBank: { tokos: {}, narke: {} }, specLearn: {}, reviewer: { name: "", regNo: "", speciality: "", verified: false }, q: "" };

  /* ---------- Tokós (CTG trainer) ---------- */
  var TOK_TEXT = [["rationale", "review", "Tokós teaching points", "The Why notes on the answer screen, English and Hindi"],
    ["checklist", "reviewChecklist", "Tokós checklist wording", "Answer options and the three FIGO next steps, English and Hindi"],
    ["calipers", "reviewCalipers", "Tokós caliper verdicts", "What the calipers say about a range or a span, English and Hindi"]];
  /** Pure: one item per CTG case (reviewed when review.complete === true) and per text block (rationale.json review state).
   * With `more` ({learn, bank, models, ledger}): the Tokós 2.0 items too, verify-first units at the top. */
  function tokosItems(deck, rat, more) {
    var cases = ((deck && deck.cases) || []).map(function (c) {
      return { id: "case-" + c.id, title: "Tokós CTG case " + c.id, sub: "Suggested FIGO category: " + c.figo + ((c.features && c.features.decels || []).length ? ", " + c.features.decels.length + " decelerations" : ""), status: c.review && c.review.complete === true ? "reviewed" : "ai_drafted", c: c };
    });
    var ctg = cases.concat(TOK_TEXT.map(function (t) { return { id: t[0], title: t[2], sub: t[3], status: ((rat && rat[t[1]]) || {}).status || "ai_drafted" }; }));
    if (!more) return ctg;
    var rest = tokosMore(more);
    return rest.filter(function (x) { return x.verify; }).concat(ctg, rest.filter(function (x) { return !x.verify; }));
  }
  var LEVEL = { mbbs: "MBBS", resident: "Resident" };
  /** Pure: a specialty host's items (host "tokos" by default, or "narke"). learn = learn/index.json,
   * bank = decks/mcq/index.json, models = the host's models global,
   * ledger = reviews.json items. Order: units (syllabus order), bank topics, drills, labour room, calculators, explorers, clinics. */
  function tokosMore(x, host) {
    host = host || "tokos";
    var L = x.learn || { units: [], lessons: {} }, M = x.models || {}, led = x.ledger || {}, out = [], N = SPEC[host].name;
    function add(id, title, sub, extra) {
      var it = { id: id, title: title, sub: sub, status: (led[id] && led[id].status) || "ai_drafted" };
      for (var k in extra || {}) it[k] = extra[k];
      out.push(it);
    }
    (L.units || []).forEach(function (u) {
      var v = 0;
      u.lessons.forEach(function (l) { v += ((L.lessons[l] || {}).verify || []).length; });
      add("unit-" + u.id, N + " lessons: " + u.title.en, u.lessons.length + " lessons, " + (LEVEL[u.level] || u.level) + (v ? "; " + v + " claim" + (v === 1 ? "" : "s") + " to verify first" : ""), v ? { verify: v } : null);
    });
    ((x.bank && x.bank.topics) || []).forEach(function (t) { add("bank-" + t.id, N + " questions: " + t.title.en, t.count + " questions (MedMCQA); confirm the flagged answer keys"); });
    function kind(k) { return Object.keys(M).map(function (id) { return M[id]; }).filter(function (m) { return m && m.kind === k; }).sort(function (a, b) { return a.id < b.id ? -1 : 1; }); }
    kind("drill").forEach(function (m) {
      if (m.stages) add("drill-" + m.id, N + " drill: " + m.title.en, "Emergency drill, " + m.stages.length + " steps, " + (LEVEL[m.level] || m.level));
      else if (m.init) add("sim-labour", N + " labour room: " + m.title.en, "Simulator settings: progress curves, oxytocin steps, scenarios");
    });
    kind("tool").forEach(function (m) { add("tool-" + m.id, N + " calculator: " + m.title.en, (m.sources || []).length + " source" + ((m.sources || []).length === 1 ? "" : "s") + ", " + (m.examples || []).length + " worked examples"); });
    kind("explorer").forEach(function (m) { add("explorer-" + m.id, N + " explorer: " + m.title.en, (m.sources || []).length + " sources, rules and teaching text"); });
    if (host !== "tokos") return out;
    add("clinic-fetal-planes", "Tokós clinic: fetal ultrasound planes", "Teaching points per plane (ISUOG), English and Hindi");
    add("clinic-hc-biometry", "Tokós clinic: fetal head circumference", "Teaching points, HC scoring bands and GA from HC");
    return out;
  }
  function words(s) { var w = String(s || "").replace(/_/g, " ").replace(/\./g, ": "); return w.charAt(0).toUpperCase() + w.slice(1); }
  function tokosCaseHtml(c) {
    var TD = G.TOKOS_CTG, sug = TD && TD.suggestedReview ? TD.suggestedReview(c) : { figo: c.figo, acidosis: c.acidosis };
    var opts = (TD && TD.L10N && TD.L10N.en.opts) || {}, f = c.features || {}, o = c.outcome || {};
    // "Present, under 3 min" when the checklist label already names the class, else "Normal (110 to 160)"
    function opt(q, v) { var o = opts[q] && opts[q][v], w = words(v); return !o ? w : o.toLowerCase().indexOf(w.toLowerCase()) === 0 ? o : w + " (" + o + ")"; }
    var types = {}, maxD = 0;
    (f.decels || []).forEach(function (d) { types[d.subtypeSuggested] = (types[d.subtypeSuggested] || 0) + 1; if (d.durationSec > maxD) maxD = d.durationSec; });
    var typeLine = Object.keys(types).map(function (k) { return types[k] + " " + k; }).join(", ");
    var rows = [
      ["FIGO category", words(sug.figo)],
      ["Baseline", sug.baselineClass ? opt("baseline", sug.baselineClass) + (f.baseline != null ? ", " + f.baseline + " bpm" : "") : ""],
      ["Variability", sug.variability ? opt("variability", sug.variability) : ""],
      ["Decelerations", sug.decels ? opt("decels", sug.decels) + (maxD ? ", longest " + Math.round(maxD) + " s" : "") : ""],
      ["Deceleration types (suggested)", typeLine ? typeLine + (sug.decelType ? "; Resident graded as " + sug.decelType : "; mixed, so not graded") : "none"],
      ["Contractions", sug.uc ? opt("uc", sug.uc) + (f.contractions && f.contractions.per10 != null ? ", " + f.contractions.per10 + " per 10 min" : "") : ""],
      ["Acidosis class", words(sug.acidosis) + (o.pH != null ? ", pH " + o.pH : "") + (o.BDecf != null ? ", BDecf " + o.BDecf : "")]
    ].filter(function (r) { return r[1]; });
    return '<section class="kit-card rv-tok" aria-label="Labels to confirm"><h3>' + ms("monitor_heart") + "Labels to confirm</h3>" +
      '<dl class="rv-kv">' + rows.map(function (r) { return "<div><dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>"; }).join("") + "</dl>" +
      (c.qualityNote ? '<p class="kit-muted"><b>Signal quality:</b> ' + esc(c.qualityNote) + "</p>" : "") +
      '<p class="kit-muted">Rule-based suggestions. Approve confirms them as this case’s answer key. If any is wrong, choose Needs changes and give the right label.</p></section>';
  }
  function tokosTextHtml(id) {
    var R = S.tokosRat || {}, rows = [];
    if (id === "rationale") Object.keys(R).filter(function (k) { return k !== "v" && !/^review/.test(k); }).forEach(function (k) { rows.push([words(k), R[k].en, R[k].hi]); });
    else if (id === "checklist") { var L = G.TOKOS_CTG && G.TOKOS_CTG.L10N; if (L) Object.keys(L.en.opts).forEach(function (q) { Object.keys(L.en.opts[q]).forEach(function (v) { rows.push([words(q) + ": " + words(v), L.en.opts[q][v], (L.hi.opts[q] || {})[v]]); }); }); }
    else if (id === "calipers") { var W = G.TOKOS_CALIPERS && G.TOKOS_CALIPERS.WORDS; if (W) ["reduced", "normal", "increased", "short", "decel", "prolonged", "over5"].forEach(function (k) { rows.push([words(k), W.en[k], W.hi[k]]); }); }
    else rows = tokosMoreRows(id, S.kind);
    if (rows === null) return '<p class="kit-muted">Loading…</p>';
    if (!rows.length) return '<p class="kit-muted">This text could not be loaded here. Open ' + esc((SPEC[S.kind] || SPEC.tokos).name) + " once, then try again.</p>";
    return '<ol class="rv-text">' + rows.map(function (r) { return '<li><span class="rv-s">' + esc(r[0]) + "</span><p>" + esc(r[1]) + '</p><p lang="hi">' + esc(r[2] || "") + "</p></li>"; }).join("") + "</ol>";
  }
  // Rows [label, English, Hindi] for a Tokós 2.0 item; null while a bank topic file loads (it repaints when done).
  function tokosMoreRows(id, host) {
    host = host || "tokos";
    var M = G[SPEC[host].models] || {}, m, rows = [], L = S.specLearn[host], bank = S.specBank[host];
    function tt(o) { return o && typeof o === "object" ? o : { en: o == null ? "" : String(o), hi: "" }; }
    function srcs(list) { (list || []).forEach(function (x) { rows.push(["Source", x.label || x.url || String(x), ""]); }); }
    if (/^unit-/.test(id) && L) {
      var u = (L.units || []).filter(function (x) { return "unit-" + x.id === id; })[0];
      if (u) u.lessons.forEach(function (lid) {
        var l = L.lessons[lid] || {};
        (l.verify || []).forEach(function (v) { rows.push(["Verify first: " + (l.title || {}).en, v, ""]); });
      });
      if (u) u.lessons.forEach(function (lid) { var l = L.lessons[lid] || {}; rows.push([lid, tt(l.title).en + ". " + tt(l.idea).en, tt(l.title).hi + (tt(l.idea).hi ? "। " + tt(l.idea).hi : "")]); });
    } else if (/^bank-/.test(id)) {
      var tid = id.slice(5), f = bank[tid];
      if (f === undefined) {
        bank[tid] = null;
        G.fetch(specBase(host) + "decks/mcq/" + tid + ".json").then(function (r) { return r.ok ? r.json() : { items: [] }; }).then(function (d) { bank[tid] = d.items || []; render(); }, function () { bank[tid] = []; render(); });
        return null;
      }
      if (f === null) return null;
      f.filter(function (q) { return q.flags && q.flags.length; }).forEach(function (q) { rows.push(["Flags: " + q.flags.join(", "), q.q + " Key: " + (q.o || [])[q.a], q.exp ? "Explanation: " + String(q.exp).slice(0, 300) : ""]); });
      if (!rows.length && f.length) rows.push(["No flagged keys", f.length + " questions; none carries a key flag. Sample a few in " + SPEC[host].name + ".", ""]);
    } else if (/^drill-/.test(id) && (m = M[id.slice(6)]) && m.stages) {
      m.stages.forEach(function (st) {
        var ok = (st.options || []).filter(function (o) { return o.correct; })[0];
        rows.push([st.id, tt(st.prompt).en + (ok ? " Answer: " + tt(ok.text).en + " " + tt(ok.feedback).en : ""), tt(st.prompt).hi + (ok ? " " + tt(ok.text).hi : "")]);
      });
      srcs(m.sources);
    } else if (id === "sim-labour" && (m = M.labour)) {
      Object.keys(m.SCENARIOS || {}).forEach(function (k) { var sc = m.SCENARIOS[k]; rows.push(["Scenario " + k + " (" + sc.level + ")", tt(sc.brief).en, tt(sc.brief).hi]); });
      rows.push(["Oxytocin steps", JSON.stringify(m.OXY_STEPS), ""]);
      rows.push(["Labour progress (Zhang 2010)", JSON.stringify(m.ZHANG), ""]);
      srcs(m.sources);
    } else if (/^(tool|explorer)-/.test(id) && (m = M[id.replace(/^(tool|explorer)-/, "")])) {
      (m.examples || []).forEach(function (e) { rows.push(["Worked example", JSON.stringify(e.values) + " gives " + JSON.stringify(e.expect), ""]); });
      if (m.subtitle) rows.push(["What it shows", tt(m.subtitle).en, tt(m.subtitle).hi]);
      srcs(m.sources);
    } else if (host === "tokos" && /^clinic-/.test(id) && G.TOKOS_US) {
      var U = G.TOKOS_US;
      if (id === "clinic-fetal-planes") Object.keys(U.PLANES).forEach(function (k) { U.PLANES[k].points.forEach(function (pt) { rows.push([words(k), pt.en, pt.hi]); }); });
      else { U.HC_POINTS.points.forEach(function (pt) { rows.push(["Head circumference", pt.en, pt.hi]); }); U.HC_BANDS.forEach(function (b) { rows.push(["Scoring band " + b.id, "Error up to " + b.maxPct + "% of the sonographer's HC (Tokós choice, not a guideline)", ""]); }); }
      Object.keys(U.SOURCES).forEach(function (k) { rows.push(["Source", U.SOURCES[k].label, ""]); });
    }
    return rows;
  }
  // Tokós loads lazily (tokos-loader.js): its code (checklist words, suggested labels, caliper words) loads with the tab.
  function loadTokos() {
    var base = G.SMD_TOKOS_BASE || "/tokos/", L = G.TOKOS_LOADER;
    function j(p) { return G.fetch(base + p).then(function (r) { if (!r.ok) throw new Error(p + " " + r.status); return r.json(); }); }
    // Tokós switched off (smd_tokos "0" / ?tokos=0): list its content from the data files only, never load its code.
    var code = L && L.load && (!L.enabled || L.enabled()) ? L.load().then(null, function () {}) : Promise.resolve();
    function soft(p) { return j(p).then(null, function () { return null; }); } // Tokós 2.0 files: a missing one lists nothing
    return Promise.all([j("decks/ctg.json"), j("rationale.json"), code, soft("learn/index.json"), soft("decks/mcq/index.json"), soft("reviews.json")]).then(function (res) {
      S.tokosRat = res[1]; S.specLearn.tokos = res[3];
      return tokosItems(res[0], res[1], { learn: res[3], bank: res[4], models: G.TOKOS_MODELS, ledger: res[5] && res[5].items });
    });
  }
  // Narkē: learn, bank and reviews from its data files; its code (models) loads only when it is switched on.
  function loadNarke() {
    var base = specBase("narke"), L = G.NARKE_LOADER;
    function soft(p) { return G.fetch(base + p).then(function (r) { return r.ok ? r.json() : null; }).then(null, function () { return null; }); }
    var code = L && L.load && (!L.enabled || L.enabled()) ? L.load().then(null, function () {}) : Promise.resolve();
    return Promise.all([code, soft("learn/index.json"), soft("decks/mcq/index.json"), soft("reviews.json")]).then(function (res) {
      S.specLearn.narke = res[1];
      return tokosMore({ learn: res[1], bank: res[2], models: G.NARKE_MODELS, ledger: res[3] && res[3].items }, "narke");
    });
  }
  function loadItems(kind) {
    if (S.items[kind]) return Promise.resolve(S.items[kind]);
    var p = kind === "protocol" ? (G.SMD_KBPROTO && G.SMD_KBPROTO.loadIndex ? G.SMD_KBPROTO.loadIndex().then(function (idx) { return (idx.protocols || []).map(function (x) { return { id: x.id, title: x.title, sub: (G.SMD_KBPROTO.subjectLabel ? G.SMD_KBPROTO.subjectLabel(x.subject) : x.subject), status: x.status }; }); }) : Promise.resolve([]))
      : kind === "tokos" ? (G.fetch ? loadTokos() : Promise.resolve([]))
      : kind === "narke" ? (G.fetch ? loadNarke() : Promise.resolve([]))
      : kind === "kit" ? (G.SMD_KITS && G.SMD_KITS.loadKits ? G.SMD_KITS.loadKits().then(function (b) { return (b.kits || []).map(function (k) { return { id: k.id, title: k.label, sub: (k.sections || []).length + " sections, " + (k.tools || []).length + " tools", status: (k.review || {}).status }; }); }) : Promise.resolve([]))
      : (G.SMD_DOCS && G.SMD_DOCS.load ? G.SMD_DOCS.load().then(function (b) { return (b.consent || []).map(function (c) { return { id: c.id, title: c.title.en, sub: "English, Telugu, Hindi", status: (c.review || {}).status }; }); }) : Promise.resolve([]));
    return p.then(function (list) { S.items[kind] = list; return list; }, function () { return []; });
  }
  function reviewer() {
    var r = S.reviewer;
    if (!r.name) { try { var p = G.SMD_ACCOUNT && G.SMD_ACCOUNT.profile && G.SMD_ACCOUNT.profile(); r.name = (p && (p.name || p.displayName)) || ""; } catch (e) {} }
    return r;
  }
  function statusPill(st) { return st === "reviewed" || st === "approved" ? '<span class="rv-pill ok">' + (st === "approved" ? "Approved" : "Reviewed") + "</span>" : '<span class="rv-pill">Pending review</span>'; }
  function decPill(d) { if (!d) return ""; var lab = { approve: "You approved", "approve-minor": "You approved with edits", changes: "You asked for changes" }[d.decision]; return '<span class="rv-pill mine">' + esc(lab) + "</span>"; }

  function render() {
    var el = D && D.getElementById("smdReview"); if (!el) return;
    var body = el.querySelector(".kit-sheet-body"), top = body.scrollTop, dec = loadDecisions(), n = Object.keys(dec).length, html;
    var pend = (S.deskOn && G.SMD_BULLETINS_DESK && G.SMD_BULLETINS_DESK.pendingTotal) ? G.SMD_BULLETINS_DESK.pendingTotal() : 0;
    var kinds = KINDS.concat(S.deskOn ? [["bulletin", "Clinical updates" + (pend ? " (" + pend + ")" : "")]] : []);
    var tabs = '<div class="kit-row" role="tablist">' + kinds.map(function (k) { return '<button type="button" role="tab" class="kit-seg' + (S.kind === k[0] ? " on" : "") + '" data-rv-act="kind:' + k[0] + '" aria-selected="' + (S.kind === k[0]) + '">' + k[1] + "</button>"; }).join("") + "</div>";
    if (S.kind === "bulletin") {
      body.innerHTML = '<div class="kit dl">' + (G.SMD_BULLETINS_DESK ? G.SMD_BULLETINS_DESK.html(tabs) : tabs) + "</div>"; body.scrollTop = top;
      return;
    }
    var list = S.items[S.kind];
    if (!list) { loadItems(S.kind).then(render); html = tabs + '<p class="kit-muted">Loading…</p>'; }
    else if (S.sel) {
      var it = list.filter(function (x) { return x.id === S.sel; })[0] || { id: S.sel, title: S.sel }, d = dec[S.kind + ":" + S.sel] || {}, r = reviewer();
      var tokText = (S.kind === "tokos" || S.kind === "narke") && !it.c;
      html = '<button type="button" class="kit-link" data-rv-act="back">' + ms("arrow_back") + "Back to the list</button><h2 class=\"dl-h\">" + esc(it.title) + "</h2>" + statusPill(it.status) +
        (it.c ? tokosCaseHtml(it.c) : "") +
        '<div class="kit-row"><button type="button" class="kit-pill" data-rv-act="read"' + (tokText ? ' aria-expanded="' + S.showText + '"' : "") + ">" + ms("menu_book") + (tokText && S.showText ? "Hide the text" : "Read it") + "</button></div>" +
        (tokText && S.showText ? tokosTextHtml(it.id) : "") +
        '<div class="kit-grid"><label class="kit-field wide" for="rv_dec"><span class="kit-fl">Your decision</span><select id="rv_dec" class="kit-inp"><option value=""></option>' +
        DECISIONS.map(function (x) { return '<option value="' + x[0] + '"' + (d.decision === x[0] ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + "</select></label>" +
        '<label class="kit-field wide" for="rv_comment"><span class="kit-fl">Comments (which section, what to change, with your source)</span><textarea id="rv_comment" rows="5" class="kit-inp">' + esc(d.comment || "") + "</textarea></label>" +
        '<label class="kit-field" for="rv_name"><span class="kit-fl">Reviewer name</span><input id="rv_name" class="kit-inp" value="' + esc(r.name) + '"></label>' +
        '<label class="kit-field" for="rv_reg"><span class="kit-fl">Registration number' + (r.verified ? " (verified)" : "") + '</span><input id="rv_reg" class="kit-inp" value="' + esc(r.regNo) + '"' + (r.verified ? " readonly" : "") + "></label></div>" +
        '<div class="kit-row"><button type="button" class="kit-add" data-rv-act="save">' + ms("task_alt") + "Save decision</button>" + (d.decision ? '<button type="button" class="kit-clear" data-rv-act="undo">Remove my decision</button>' : "") + "</div>";
    } else {
      var q = S.q.toLowerCase(), shown = list.filter(function (x) { return !q || (x.title + " " + x.id).toLowerCase().indexOf(q) >= 0; });
      html = '<p class="kit-muted">Read each item, then approve it or say what needs to change. Your decisions stay on this phone until you export them.</p>' +
        '<div class="kit-row"><button type="button" class="kit-add" data-rv-act="export"' + (n ? "" : " disabled") + ">" + ms("ios_share") + "Export " + n + " decision" + (n === 1 ? "" : "s") + "</button>" +
        (G.SMD_SHARE && G.SMD_SHARE.on && G.SMD_SHARE.on() ? '<button type="button" class="kit-pill" data-rv-act="sync"' + (n ? "" : " disabled") + ">" + ms("cloud_upload") + "Send to StewardMD</button>" : "") + "</div>" + tabs +
        '<label class="kit-field wide" for="rv_q"><span class="kit-fl">Search</span><input id="rv_q" type="search" class="kit-inp" value="' + esc(S.q) + '" autocomplete="off"></label>' +
        '<p class="kit-muted">' + shown.length + " of " + list.length + "</p><div class=\"rv-list\">" + shown.map(function (x) {
          return '<button type="button" class="rv-row" data-rv-act="sel:' + esc(x.id) + '"><span class="rv-t">' + esc(x.title) + '</span><span class="rv-s">' + esc(x.sub || "") + "</span><span>" + statusPill(x.status) + decPill(dec[S.kind + ":" + x.id]) + "</span></button>";
        }).join("") + "</div>";
    }
    body.innerHTML = '<div class="kit dl">' + html + "</div>"; body.scrollTop = top;
  }
  function flagOn() {
    try { var q = (G.location.search.match(/[?&]review=([^&]+)/) || [])[1]; if (q === "1" || q === "true") return true; if (q === "0" || q === "false") return false; return G.localStorage.getItem("smd_review_desk") !== "0"; } catch (e) { return true; }
  }
  function open() {
    if (!D || !flagOn()) return;
    var el = D.getElementById("smdReview");
    if (!el) {
      el = D.createElement("div"); el.id = "smdReview"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Clinical review");
      el.innerHTML = '<div class="kit-sheet"><header class="kit-sheet-top"><button type="button" class="kit-x" data-rv-act="close" aria-label="Close review desk">' + ms("close") + '</button><h1>Clinical review</h1><span></span></header><div class="kit-sheet-body"></div></div>';
      D.body.appendChild(el);
    }
    el.classList.add("on"); D.documentElement.classList.add("kit-lock");
    if (G.SMD_RX && G.SMD_RX.verifiedInfo) G.SMD_RX.verifiedInfo().then(function (v) { if (v && v.verified && v.regNo) { S.reviewer.regNo = v.regNo; S.reviewer.verified = true; } }, function () {});
    if (G.SMD_BULLETINS_DESK && !S.deskOn) G.SMD_BULLETINS_DESK.probe().then(function (on) {
      if (!on) { S.wantBulletin = false; return; }
      S.deskOn = true;
      if (S.wantBulletin) { S.wantBulletin = false; S.kind = "bulletin"; S.sel = ""; G.SMD_BULLETINS_DESK.reset(); }
      render();
    }, function () {});
    else if (S.deskOn && S.wantBulletin) { S.wantBulletin = false; S.kind = "bulletin"; S.sel = ""; G.SMD_BULLETINS_DESK.reset(); }
    render();
  }
  function close() { var el = D && D.getElementById("smdReview"); if (el) el.classList.remove("on"); if (!(D.getElementById("smdKit") || {}).classList || !D.getElementById("smdKit").classList.contains("on")) D.documentElement.classList.remove("kit-lock"); }
  function share(text, name) {
    var C = G.Capacitor, P = (C && C.Plugins) || {}, native = false;
    try { native = !!(C && (C.isNativePlatform ? C.isNativePlatform() : C.isNative)); } catch (e) {}
    if (native && P.Filesystem && P.Share) {
      P.Filesystem.writeFile({ path: name, data: text, directory: "CACHE", encoding: "utf8" }).then(function (r) { return P.Share.share({ title: "StewardMD review", url: r.uri, dialogTitle: "Send your review" }); }).catch(function () { toast("Could not open the share sheet."); });
      return;
    }
    try { G.navigator.clipboard.writeText(text).then(function () { toast("Review copied. Paste it into an email to the StewardMD team."); }, function () { toast("Copy is blocked here."); }); } catch (e) { toast("Copy is blocked here."); }
  }
  function onClick(e) {
    var b = e.target && e.target.closest && e.target.closest("[data-rv-act]"); if (!b || !b.closest("#smdReview")) return;
    var act = b.getAttribute("data-rv-act"), i = act.indexOf(":"), cmd = i < 0 ? act : act.slice(0, i), arg = i < 0 ? "" : act.slice(i + 1);
    if (cmd === "close") { close(); return; }
    if (cmd === "kind") { S.kind = arg; S.sel = ""; if (arg === "bulletin" && G.SMD_BULLETINS_DESK) G.SMD_BULLETINS_DESK.reset(); render(); return; }
    if (cmd === "sel") { S.sel = arg; S.showText = false; render(); D.querySelector("#smdReview .kit-sheet-body").scrollTop = 0; return; }
    if (cmd === "back") { S.sel = ""; render(); return; }
    if (cmd === "read") {
      D.documentElement.classList.add("kit-lock");   // closing a kit drops it; the Library needs it to sit on top
      if (S.kind === "protocol" && G.SMD_KBPROTO) G.SMD_KBPROTO.open({ id: S.sel });
      else if (S.kind === "kit" && G.SMD_KITS) G.SMD_KITS.open({ kit: S.sel });
      else if (S.kind === "consent" && G.SMD_DOCS) G.SMD_DOCS.open({ type: "consent", consentId: S.sel });
      else if (S.kind === "tokos") {
        if (/^case-/.test(S.sel)) { if (G.TOKOS && G.TOKOS.openCase) { if (G.TOKOS.openCase(S.sel.slice(5)) === false) toast("Tokós is switched off on this phone."); } else toast("Tokós is loading. Try again in a moment."); }
        else { S.showText = !S.showText; render(); }
      }
      else if (S.kind === "narke") { S.showText = !S.showText; render(); }
      return;
    }
    if (cmd === "save") {
      var dv = D.getElementById("rv_dec").value, cm = D.getElementById("rv_comment").value.trim();
      S.reviewer.name = D.getElementById("rv_name").value.trim(); if (!S.reviewer.verified) S.reviewer.regNo = D.getElementById("rv_reg").value.trim();
      if (!dv) { toast("Choose a decision."); return; }
      if (dv !== "approve" && !cm) { toast("Say what needs to change."); return; }
      if (!S.reviewer.name) { toast("Add your name as the reviewer."); return; }
      var dec = loadDecisions(); dec[S.kind + ":" + S.sel] = { decision: dv, comment: cm, at: new Date().toISOString() }; saveDecisions(dec);
      toast("Decision saved on this phone."); S.sel = ""; render(); return;
    }
    if (cmd === "undo") { var d2 = loadDecisions(); delete d2[S.kind + ":" + S.sel]; saveDecisions(d2); render(); return; }
    if (cmd === "sync" && G.SMD_SHARE) {
      var sx = buildExport(loadDecisions(), reviewer());
      G.SMD_SHARE.sendReviews(sx.decisions).then(function (r) { toast(r.status === 200 ? "Sent " + r.body.count + " decision" + (r.body.count === 1 ? "" : "s") + " to StewardMD." : G.SMD_SHARE.errText(r.body.error)); });
      return;
    }
    if (cmd === "export") {
      var ex = buildExport(loadDecisions(), reviewer());
      if (!ex.reviewer.name) { toast("Open an item and add your name first."); return; }
      share(JSON.stringify(ex, null, 2), "stewardmd-review-" + ex.exportedAt.slice(0, 10) + ".json");
    }
  }
  function onInput(e) { var el = e.target; if (el && el.id === "rv_q") { S.q = el.value; var pos = el.selectionStart; render(); var q = D.getElementById("rv_q"); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} } } }
  if (D && D.addEventListener && !G.__smdReviewWired) { G.__smdReviewWired = true; D.addEventListener("click", onClick, false); D.addEventListener("input", onInput, false); }

  // Weekly review push (/?rvtab=bulletins) lands here: open the desk on the Clinical updates tab.
  function openBulletins() { S.wantBulletin = true; open(); }
  var API = { open: open, openBulletins: openBulletins, close: close, _render: render, _buildExport: buildExport, _tokosItems: tokosItems, _tokosMore: tokosMore, DECISIONS: DECISIONS };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_REVIEW = API;
})(typeof window !== "undefined" ? window : globalThis);
