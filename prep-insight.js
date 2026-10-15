/* IQoach insight: what a finished set says about the student, with no AI call. window.PREP_INSIGHT. ES5.
 * Pure and deterministic. Three jobs:
 *   1. aspectOf(item): tag a question as Diagnosis / Investigation / Treatment / Pathogenesis / Screening and
 *      prevention / Clinical features / Complications / Other from the wording of the stem alone (the bank has
 *      only subject and module; there is no stored question type).
 *   2. noteAnswer(store, item, ok, conf, day): small device-only tallies (per question misses, per aspect,
 *      per day confidence reliability) kept in the study store under ky_q, ky_ty and ky_cal.
 *   3. analyzeRun(run, store): the result screen's numbers: confidence x correct grid, weak-by-aspect, a fix list
 *      (misconceptions first, repeats flagged), a remember list, confidence reliability.
 * No scores, ranks or predictions. A claim needs enough answers (MIN_ASPECT) or it is not made. */
(function (G) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);
  var CFG = {
    MIN_ASPECT: 3,        // answers of one aspect in a set before the set screen calls it weak
    MIN_ASPECT_ALL: 6,    // answers of one aspect all-time before the all-time bar shows
    WEAK_ACC: 0.6,        // below this accuracy an aspect is called weak
    TAIL: 220,            // characters from the end of the stem that carry the question
    KEEP_Q: 3000,         // per-question records kept on the device
    KEEP_DAYS: 30,        // days of confidence reliability kept
    FIX_MAX: 12,          // rows in the fix list
    REMEMBER_MAX: 8,      // rows in the remember list
    LINE_MAX: 170         // characters in a remember line
  };
  var ASPECTS = [
    { id: "dx", label: "Diagnosis" },
    { id: "ix", label: "Investigation" },
    { id: "tx", label: "Treatment" },
    { id: "patho", label: "Pathogenesis" },
    { id: "basic", label: "Basic science and anatomy" },
    { id: "screen", label: "Screening and prevention" },
    { id: "feat", label: "Clinical features and facts" },
    { id: "comp", label: "Complications" },
    { id: "other", label: "Other" }
  ];
  function aspectLabel(id) { for (var i = 0; i < ASPECTS.length; i++) if (ASPECTS[i].id === id) return ASPECTS[i].label; return "Other"; }

  /* Order matters: the first rule that matches the question tail wins. */
  var RULES = [
    ["screen", /screening|screen for|prevention|preventive|prophylaxis|prophylactic|vaccin|immuni[sz]ation|chemoprevention|surveillance|primary prevention|secondary prevention|risk[- ]reducing/],
    ["ix", /(?:diagnos|detect|evaluat|assess)\w*[^.?]{0,45}(?:of choice|best|test|investigation|procedure|modality|method)|investigation of choice|investigation[s]? (?:is|are|to)|best investigation|initial investigation|next investigation|test of choice|diagnostic test|gold standard|most sensitive|most specific|imaging (?:of choice|modality)|modality of choice|biopsy|confirm(?:s|ed|ation)? (?:the )?diagnosis|which (?:test|scan|imaging)|best (?:test|scan)|tumou?r marker|histopatholog|immunohistochem|ihc|pet[- ]?ct|\bmri\b|\bct\b scan/],
    ["patho", /mechanism of action|mode of action|\bmoa\b|pathogenesis|pathophysiolog/],
    ["tx", /treatment|drug of choice|\bdoc\b|management|managed|therapy|first[- ]line|second[- ]line|antidote|regimen|dose of|best (?:next )?step|next step|operation of choice|surgery of choice|procedure of choice|should be (?:given|started|done|treated|advised)|indicated|contraindicated|adjuvant|neoadjuvant|palliat|radiotherapy|chemotherapy|resect|\bdrugs?\b|operation|technique|used (?:for|in|to)|indication|surgery|surgical|contracepti/],
    ["dx", /most likely diagnosis|probable diagnosis|diagnosis|diagnosed|most likely (?:cause|condition|disorder|disease)|this (?:patient|child|woman|man) (?:has|is suffering)|suffering from|likely to be|\bdiagnostic\b|differential|pathognomonic|identified as|the (?:patient|child) (?:most likely )?has/],
    ["comp", /complication|prognos|survival|recurrence|metastas|spread|risk of|outcome|sequela|mortality|morbidity|poor prognostic|favou?rable/],
    ["patho", /pathogenesis|pathophysiolog|mechanism|aetiology|etiology|caused by|cause of|causes? (?:of|for)|\bcauses\b|due to|mutation|gene\b|genetic|chromosom|translocation|enzyme|receptor|pathway|antibod|virus|organism|mode of action|moa\b|pharmacolog|inhibit|metaboli/],
    ["basic", /nerve|artery|arterial|\bvein|muscle|ligament|lymphatic|supplied|innervat|attached|attachment|anatom|\blies\b|situated|located|relation|layer|epithelium|hormone|secret|physiolog|embryolog|derived|develop|histolog|microscop|homolog|\bcells?\b/],
    ["feat", /feature|sign\b|signs\b|symptom|presents with|presentation|characteristic|associated with|seen in|found in|classif|criteria|staging|stage\b|grade\b|score|incidence|prevalence|common(?:est)?\b|most frequent|site of|finding|true (?:about|regarding|statement)|statement|characteri[sz]ed|not seen|\bseen\b|increased|decreased|raised|normal\b|\bnot\b/]
  ];

  function plain(s) { return String(s == null ? "" : s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
  function tailOf(q) {
    var t = plain(q).toLowerCase();
    return t.length > CFG.TAIL ? t.slice(-CFG.TAIL) : t;
  }
  /* aspectOf(item) -> aspect id. Question tail first; the whole stem second; "other" when nothing fits. */
  function aspectOf(it) {
    if (!it) return "other";
    var tail = tailOf(it.q), full = plain(it.q).toLowerCase(), i;
    for (i = 0; i < RULES.length; i++) if (RULES[i][1].test(tail)) return RULES[i][0];
    for (i = 0; i < RULES.length; i++) if (RULES[i][0] !== "feat" && RULES[i][1].test(full)) return RULES[i][0];
    return "other";
  }

  /* ---------- device-only tallies ---------- */
  function ensure(s) {
    if (!s.ky_q || typeof s.ky_q !== "object") s.ky_q = {};
    if (!s.ky_ty || typeof s.ky_ty !== "object") s.ky_ty = {};
    if (!s.ky_cal || typeof s.ky_cal !== "object") s.ky_cal = {};
    return s;
  }
  /* ky_q[id]   = [wrong, right, lastWrongTs, lastTs]
   * ky_ty[asp] = [n, ok, confidentWrong, unsure]
   * ky_cal[day]= [confidentN, confidentOk]   (reliability of "I'm confident") */
  function noteAnswer(s, it, ok, conf, day, ts) {
    if (!s || !it || it.id == null) return;
    ensure(s);
    ts = ts || Date.now();
    var id = String(it.id), q = s.ky_q[id] || (s.ky_q[id] = [0, 0, 0, 0]);
    if (ok) q[1]++; else { q[0]++; q[2] = ts; }
    q[3] = ts;
    var a = aspectOf(it), t = s.ky_ty[a] || (s.ky_ty[a] = [0, 0, 0, 0]);
    t[0]++; if (ok) t[1]++;
    if (conf === "confident" && !ok) t[2]++;
    if (conf === "guessing" || conf === "confused") t[3]++;
    if (conf === "confident" && day != null) {
      var c = s.ky_cal[day] || (s.ky_cal[day] = [0, 0]);
      c[0]++; if (ok) c[1]++;
    }
    prune(s);
  }
  function prune(s) {
    var ks = Object.keys(s.ky_q);
    if (ks.length > CFG.KEEP_Q) {
      ks.sort(function (x, y) { return s.ky_q[x][3] - s.ky_q[y][3]; });
      ks.slice(0, ks.length - CFG.KEEP_Q).forEach(function (k) { delete s.ky_q[k]; });
    }
    var ds = Object.keys(s.ky_cal);
    if (ds.length > CFG.KEEP_DAYS) {
      ds.sort(function (x, y) { return Number(x) - Number(y); });
      ds.slice(0, ds.length - CFG.KEEP_DAYS).forEach(function (k) { delete s.ky_cal[k]; });
    }
  }
  function repeatsOf(s, id) {
    var q = s && s.ky_q && s.ky_q[String(id)];
    return q ? { wrong: q[0], right: q[1], lastWrong: q[2] } : { wrong: 0, right: 0, lastWrong: 0 };
  }
  /* Reliability series for the sparkline: [{ day, n, ok }] oldest first, last `days` days present. */
  function calSeries(s, days) {
    var cal = (s && s.ky_cal) || {}, ks = Object.keys(cal).map(Number).sort(function (a, b) { return a - b; });
    ks = ks.slice(-(days || 14));
    return ks.map(function (d) { return { day: d, n: cal[d][0], ok: cal[d][1] }; });
  }

  /* ---------- remember line: one short sentence from the question's own key point or explanation ---------- */
  function firstSentence(t) {
    t = plain(t).replace(/[*_#`>]+/g, "").replace(/^[-•\s]+/, "");
    var m = /^(.{12,}?[.!?])(\s|$)/.exec(t);
    var s = m ? m[1] : t;
    if (s.length > CFG.LINE_MAX) s = s.slice(0, CFG.LINE_MAX - 1).replace(/\s+\S*$/, "") + "…";
    return s;
  }
  function rememberLine(it, pearl) {
    var src = pearl || it.kp || it.exp || "";
    if (!src) return it && it.o && it.a >= 0 && it.o[it.a] != null ? "Answer: " + plain(it.o[it.a]) : "";
    return firstSentence(src);
  }

  /* ---------- run analysis ----------
   * run = { items, ans[], conf[], ms[] }. cf per item may be undefined. */
  function outcomeOf(a, correct, c) {
    if (a < 0) return "blank";
    var ok = a === correct;
    if (c === "confident") return ok ? "mastered" : "misconception";
    if (c === "guessing") return ok ? "lucky" : "guesswrong";
    if (c === "confused") return "confused";
    return ok ? "right" : "wrong";
  }
  var GRID_ORDER = ["mastered", "right", "lucky", "confused", "guesswrong", "wrong", "misconception"];
  var GRID_LABEL = { mastered: "Confident and right", right: "Right (not tagged)", lucky: "Guessed right", confused: "Confused", guesswrong: "Guessed wrong", wrong: "Wrong (not tagged)", misconception: "Confident but wrong" };
  // Fix list priority: a confident error is the most dangerous, then confusion, then plain wrong.
  var FIX_RANK = { misconception: 0, confused: 1, wrong: 2, guesswrong: 3 };

  function analyzeRun(run, s) {
    ensure(s || {});
    var items = (run && run.items) || [], ans = (run && run.ans) || [], conf = (run && run.conf) || [];
    var grid = {}, types = {}, fix = [], remember = [], i;
    GRID_ORDER.forEach(function (k) { grid[k] = 0; });
    ASPECTS.forEach(function (a) { types[a.id] = { n: 0, ok: 0, cw: 0, unsure: 0 }; });
    var confN = 0, confOk = 0, answered = 0;
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || it._gone || ans[i] < 0 || ans[i] == null) continue;
      answered++;
      var ok = ans[i] === it.a, c = conf[i] || null, oc = outcomeOf(ans[i], it.a, c), asp = aspectOf(it);
      if (oc === "confused") { grid.confused++; } else grid[oc]++;
      var ty = types[asp]; ty.n++; if (ok) ty.ok++;
      if (oc === "misconception") ty.cw++;
      if (c === "guessing" || c === "confused") ty.unsure++;
      if (c === "confident") { confN++; if (ok) confOk++; }
      var rep = repeatsOf(s, it.id);
      if (!ok) {
        fix.push({ i: i, asp: asp, oc: oc, chosen: ans[i], correct: it.a, rep: rep.wrong, lastWrong: rep.lastWrong });
      } else if (oc === "lucky" || oc === "confused") {
        remember.push({ i: i, asp: asp, oc: oc });
      }
    }
    fix.sort(function (x, y) { return (FIX_RANK[x.oc] - FIX_RANK[y.oc]) || (y.rep - x.rep) || (x.i - y.i); });
    // A confused-but-right answer is a remember item too; a wrong one is already in the fix list.
    var weak = [];
    ASPECTS.forEach(function (a) {
      var t = types[a.id];
      if (a.id !== "other" && t.n >= CFG.MIN_ASPECT && t.ok / t.n < CFG.WEAK_ACC) weak.push({ id: a.id, label: a.label, n: t.n, ok: t.ok, acc: t.ok / t.n });
    });
    weak.sort(function (x, y) { return x.acc - y.acc || y.n - x.n; });
    var repeats = fix.filter(function (f) { return f.rep >= 2; });
    return {
      answered: answered, grid: grid, gridOrder: GRID_ORDER, gridLabel: GRID_LABEL,
      types: types, weak: weak,
      fix: fix, fixShown: fix.slice(0, CFG.FIX_MAX), remember: remember.slice(0, CFG.REMEMBER_MAX),
      repeats: repeats,
      conf: { n: confN, ok: confOk, rate: confN ? confOk / confN : null },
      misconceptions: fix.filter(function (f) { return f.oc === "misconception"; }).map(function (f) { return f.i; })
    };
  }

  /* All-time per aspect from ky_ty: [{ id, label, n, ok, acc }] for aspects with enough answers. */
  function allTime(s) {
    var ty = (s && s.ky_ty) || {}, out = [];
    ASPECTS.forEach(function (a) {
      var t = ty[a.id];
      if (a.id === "other" || !t || t[0] < CFG.MIN_ASPECT_ALL) return;
      out.push({ id: a.id, label: a.label, n: t[0], ok: t[1], acc: t[1] / t[0], cw: t[2] });
    });
    return out;
  }

  /* Plain-language lead sentence for the screen. Only claims what the numbers carry. */
  function headline(an) {
    if (!an.answered) return "";
    var bits = [];
    if (an.weak.length) bits.push("Weakest in this set: " + an.weak.slice(0, 2).map(function (w) { return w.label.toLowerCase() + " (" + w.ok + " of " + w.n + ")"; }).join(", ") + ".");
    if (an.conf.n >= 3) bits.push("When you were confident you were right " + an.conf.ok + " of " + an.conf.n + ".");
    if (an.grid.misconception) bits.push(an.grid.misconception + " confident error" + (an.grid.misconception === 1 ? "" : "s") + " to fix first.");
    if (an.repeats.length) bits.push(an.repeats.length + " repeated mistake" + (an.repeats.length === 1 ? "" : "s") + ".");
    return bits.join(" ");
  }

  /* Compact text for the optional "Explain my pattern" call: counts and short stems only, no names, no PHI. */
  function patternText(an, items, nameOf, pearlOf) {
    var L = ["IQoach: my last set (" + an.answered + " answered). Explain my pattern and what to remember. Short, plain words."];
    var g = an.grid;
    L.push("Confident right " + g.mastered + ", confident wrong " + g.misconception + ", guessed right " + g.lucky + ", guessed wrong " + g.guesswrong + ", confused " + g.confused + ", untagged wrong " + g.wrong + ".");
    var ty = [];
    ASPECTS.forEach(function (a) { var t = an.types[a.id]; if (t.n && a.id !== "other") ty.push(a.label + " " + t.ok + "/" + t.n); });
    if (ty.length) L.push("By type: " + ty.join(", ") + ".");
    an.fixShown.slice(0, 6).forEach(function (f) {
      var it = items[f.i], q = plain(it.q), snip = q.length > 90 ? "…" + q.slice(-90) : q;
      L.push("- " + (nameOf ? nameOf(it) + ": " : "") + snip + " I chose \"" + plain(it.o[f.chosen]).slice(0, 50) + "\", answer \"" + plain(it.o[f.correct]).slice(0, 50) + "\"" + (f.rep >= 2 ? " (missed " + f.rep + " times)" : "") + ".");
    });
    var s = L.join("\n");
    return s.length > 1500 ? s.slice(0, 1499) + "…" : s;
  }

  var API = { CFG: CFG, ASPECTS: ASPECTS, aspectLabel: aspectLabel, aspectOf: aspectOf, noteAnswer: noteAnswer,
    repeatsOf: repeatsOf, calSeries: calSeries, rememberLine: rememberLine, analyzeRun: analyzeRun, allTime: allTime,
    headline: headline, patternText: patternText, outcomeOf: outcomeOf, GRID_LABEL: GRID_LABEL, GRID_ORDER: GRID_ORDER };
  if (NODE) { module.exports = API; return; }
  if (G) G.PREP_INSIGHT = API;
})(typeof window !== "undefined" ? window : this);
