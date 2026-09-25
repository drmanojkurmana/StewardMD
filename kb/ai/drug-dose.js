/* StewardMD — Drug-dose router  ->  window.SMD_DOSE   (UMD: browser + node-testable)
 *
 * "dose of ondansetron" is a DATABASE lookup, not a question for a language model. This module
 * catches dose-intent questions before MaiK spends a model call (cloud or on-device) and answers
 * them from the app's own drug database (window.MEDAPI — every molecule, structured from the
 * official label: adult_dose / ped_dose / renal_adjust / hepatic_adjust / pregnancy, or the
 * curated `gold` monograph). No model in the loop for the numbers, so a dose can never be invented.
 *
 * Spelling: "dose of parecetmal" resolves through the database's own composition names, then
 * through DrugFuzzy (kb/ai/drug-fuzzy.js) as a last resort. A corrected name is always STATED in
 * the answer ("you typed …"), never silently substituted — same rule as Scan-Meds.
 *
 * Fails OPEN: no dose intent, no confident molecule, or no dose text in the record -> returns null
 * and the normal grounded MaiK answer runs. Online-only (the offline drug DB carries brands and
 * compositions, not the structured label), so offline this returns null and the on-device model
 * answers from the Knowledge Base as before.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;   // node / tests
  if (root) root.SMD_DOSE = api;                                               // browser
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, ""); }

  // Strip strength / form / parentheticals so "Paracetamol (500mg)" and "Paracetamol 500 mg"
  // both reduce to the molecule the clinical record is keyed by. Mirrors api.js clinicalKey().
  function base(name) {
    return String(name || "")
      .replace(/\s*\([^)]*\)/g, " ")
      .replace(/\s+\d+(?:\.\d+)?\s*(?:mg|mcg|µg|ug|g|ml|l|%|iu|units?|meq|mmol)\b/gi, " ")
      .replace(/\s*\+\s*/g, " + ").replace(/\s{2,}/g, " ").trim();
  }

  /* ── intent ──────────────────────────────────────────────────────────────────────────────── */
  // Which part of the record the clinician asked for. Order matters: the most specific wins.
  var SECTIONS = [
    { key: "ped", re: /\b(?:p(?:a)?ediatric|paeds?|peads?|child(?:ren)?|infant|neonat|kids?)\b/i },
    { key: "renal", re: /\b(?:renal|kidney|ckd|dialysis|crcl|egfr|nephro)\b/i },
    { key: "hepatic", re: /\b(?:hepatic|liver|cirrho)\b/i },
    { key: "pregnancy", re: /\b(?:pregnan\w*|lactat\w*|breast\s?feed\w*)\b/i }
  ];
  // A dose question, in the shapes clinicians actually type. Each captures the drug name.
  var ASKS = [
    /\bdos(?:e|es|ing|age)\s+(?:of|for)\s+(.+)$/i,
    /\bhow\s+much\s+(.+?)(?:\s+(?:should|do|to|is|can|shall)\b.*)?$/i,
    /^\s*(.+?)\s+dos(?:e|es|ing|age)\b/i
  ];
  // Qualifiers that follow the molecule ("… in renal failure", "… for a child") are not its name.
  var TAIL = /\s+(?:in|for|during|with|when|to|at|under|over|per|by)\b[\s\S]*$/i;
  // Words that qualify a dose but are not part of the molecule's name.
  var MODIFIER = /\b(?:max|maximum|min|minimum|usual|normal|standard|starting|initial|loading|maintenance|recommended|correct|right|exact|safe|typical|daily|adult|p(?:a)?ediatric|paeds?|child(?:ren)?|infant|neonatal|renal|hepatic|oral|iv|im|sc)\b/gi;
  // If any of these survive, the captured text is a sentence, not a drug ("tell me doses").
  var NOT_A_DRUG = /^(?:tell|me|my|us|you|your|him|her|his|their|patient|pt|drug|drugs|med|meds|medicine|medication|it|this|that|these|those|what|whats|which|who|please|pls|and|or|give|giving|take|taking|need|want|know|is|are|the|a|an|of|dose|doses|dosing|dosage)$/i;

  function sectionOf(q) {
    for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i].re.test(q)) return SECTIONS[i].key;
    return "adult";
  }
  // Abbreviations clinicians type for a molecule (owner transcript, 2026-09-19: "Dose of Pcm?").
  var ABBR = { pcm: "paracetamol", pct: "paracetamol", apap: "paracetamol", asa: "aspirin", mtx: "methotrexate", hcq: "hydroxychloroquine", inh: "isoniazid", rif: "rifampicin", pza: "pyrazinamide", emb: "ethambutol", ldn: "naltrexone" };
  // home.js rewrites a bare "<drug> dose" follow-up into "<Population> dosing of <drug> for <topic> - dose,
  // route, titration and renal-adjustment principles. Verify locally." That frame named "renal", so the
  // renal section was shown instead of the adult dose (owner transcript, 2026-09-19). The leading
  // population word is authoritative; the frame after the dash is not part of the ask.
  var REWRITE = /^\s*(adult|paediatric|pediatric|renal-adjusted|hepatic-adjusted|pregnancy)\s+(?:first-line\s+drug\s+and\s+)?dos(?:e|ing)\s+(?:of\s+)?(.+?)(?:\s+for\s+.+)?$/i;
  var POP = { adult: "adult", paediatric: "ped", pediatric: "ped", "renal-adjusted": "renal", "hepatic-adjusted": "hepatic", pregnancy: "pregnancy" };

  // -> { name, section } for a dose question, else null.
  function intent(q) {
    var s = String(q || "").trim();
    s = s.split(/\s+[—–-]\s+/)[0].trim();            // drop a " - dose, route, ..." frame
    if (!s || s.length > 160) return null;
    // A regimen question names no single molecule: it is answered from the regimen, not a label.
    if (/\bregimen\b/i.test(s)) return null;
    var rw = REWRITE.exec(s);
    if (rw) {
      var rname = base(rw[2].replace(/[?.!,;:]+/g, " ").trim()).split(/\s+/).slice(0, 3).join(" ");
      // "dose for <condition>" captured "for community acquired" as a drug (audit T45).
      if (rname && !/^for\b/i.test(rname) && !NOT_A_DRUG.test(rname.split(/\s+/)[0])) return { name: ABBR[rname.toLowerCase()] || rname, section: POP[rw[1].toLowerCase()] || "adult" };
      return null;
    }
    if (!/\bdos(?:e|es|ing|age)\b|\bhow\s+much\b/i.test(s)) return null;
    for (var i = 0; i < ASKS.length; i++) {
      var m = ASKS[i].exec(s);
      if (!m) continue;
      var name = String(m[1] || "")
        .replace(TAIL, " ")
        .replace(/\b(?:the|a|an|tab|tabs|tablet|tablets|syrup|injection|inj|po)\b/gi, " ")
        .replace(MODIFIER, " ")
        .replace(/[?.!,;:]+/g, " ").replace(/\s{2,}/g, " ").trim();
      name = base(name);
      // A molecule is one or two words; anything longer is a clinical question that merely
      // contains the word "dose" ("dose of steroids in septic shock with vasopressors").
      if (!name || name.length < 3 || name.split(/\s+/).length > 3) continue;
      if (!/[a-z]/i.test(name)) continue;
      // Leading request words are stripped ("Tell me Ondansetron dose" -> "Ondansetron"); one left in
      // the middle means the capture is a sentence, not a drug.
      var toks = name.split(/\s+/);
      while (toks.length && NOT_A_DRUG.test(toks[0])) toks.shift();
      for (var k = 0; k < toks.length; k++) if (NOT_A_DRUG.test(toks[k])) { toks = []; break; }
      name = toks.join(" ");
      if (!name || name.length < 3) continue;
      name = ABBR[name.toLowerCase()] || name;
      return { name: name, section: sectionOf(s) };
    }
    return null;
  }

  /* ── resolve the molecule against the drug database ──────────────────────────────────────── */
  // Composition names from a search result list, deduped by their molecule base.
  function bases(results) {
    var out = [], seen = {};
    for (var i = 0; i < (results || []).length; i++) {
      var c = base((results[i] || {}).composition || "");
      if (c && !seen[norm(c)]) { seen[norm(c)] = 1; out.push(c); }
    }
    return out;
  }
  // The fuzzy matcher's Scan-Meds defaults are tuned for OCR of a printed strip. A TYPED dose
  // question is explicitly about one drug and the correction is stated back to the clinician, so
  // one more edit is allowed here ("parecetmal" -> Paracetamol is distance 3); still strictly
  // best-vs-second, so a tie stays unresolved and the model answers instead.
  var FUZZ = { maxDist: 3, ratio: 0.34 };

  function pick(name, cands, fuzzy) {
    var q = norm(name), i;
    for (i = 0; i < cands.length; i++) if (norm(cands[i]) === q) return { name: cands[i], corrected: false };
    // A single-molecule result whose name STARTS with what was typed ("paracet" -> "Paracetamol").
    var pre = [];
    for (i = 0; i < cands.length; i++) if (norm(cands[i]).indexOf(q) === 0 && cands[i].indexOf("+") < 0) pre.push(cands[i]);
    if (pre.length === 1) return { name: pre[0], corrected: false };
    var f = fuzzy && fuzzy.bestGenericMatch ? fuzzy.bestGenericMatch(name, cands, FUZZ) : null;
    if (f && f.generic) return { name: f.generic, corrected: f.distance > 0 };
    return null;
  }
  // -> Promise<{ name, corrected, viaBrand } | null>. Compositions first (generic names), then
  // brands ("pantocid" -> Pantoprazole), so a brand a clinician types still lands on its molecule.
  //
  // A misspelling finds NOTHING in a full-text search ("parecetmal" matches no row), so when the
  // whole word comes back empty we re-search on its first letters - the typo is almost never in
  // them - and fuzzy-match the molecule inside that much smaller candidate list.
  function searchComps(M, name) {
    var tries = [name], q = String(name || "");
    if (q.length > 4) tries.push(q.slice(0, 4));
    if (q.length > 3) tries.push(q.slice(0, 3));
    function step(i, acc) {
      if (i >= tries.length) return Promise.resolve(acc);
      return Promise.resolve(M.searchCompositions(tries[i], 30)).then(function (r) {
        var rows = (r && r.results) || [];
        if (rows.length) return (i === 0) ? rows : acc.concat(rows);   // exact-name hits win outright
        return step(i + 1, acc);
      }, function () { return step(i + 1, acc); });
    }
    return step(0, []);
  }
  function resolve(name, deps) {
    var M = deps.MEDAPI, fuzzy = deps.DrugFuzzy;
    if (!M || !M.searchCompositions) return Promise.resolve(null);
    return searchComps(M, name).then(function (rows) {
      var hit = pick(name, bases(rows), fuzzy);
      if (hit) { hit.viaBrand = false; return hit; }
      if (!M.searchBrands) return null;
      return Promise.resolve(M.searchBrands(name, 12)).then(function (b) {
        var rows = (b && b.results) || [];
        // A brand match is authoritative for its own molecule: take the composition of the brand
        // whose NAME matches what was typed, exactly or (last resort) fuzzily.
        var names = [], i;
        for (i = 0; i < rows.length; i++) if (rows[i] && rows[i].brand) names.push(rows[i].brand);
        var bhit = pick(name, names, fuzzy);
        if (!bhit) return null;
        for (i = 0; i < rows.length; i++) {
          if (norm(rows[i].brand) === norm(bhit.name)) {
            var comp = base(rows[i].composition || "");
            if (comp) return { name: comp, corrected: true, viaBrand: rows[i].brand };
          }
        }
        return null;
      }, function () { return null; });
    }, function () { return null; });
  }

  /* ── format ──────────────────────────────────────────────────────────────────────────────── */
  var SEC_LABEL = { adult: "Adult dose", ped: "Paediatric dose", renal: "Renal adjustment",
                    hepatic: "Hepatic adjustment", pregnancy: "Pregnancy & lactation" };
  var PLAIN = { adult: ["adult_dose"], ped: ["ped_dose", "adult_dose"], renal: ["renal_adjust"],
                hepatic: ["hepatic_adjust"], pregnancy: ["pregnancy", "lactation"] };

  function row(r) {
    var bits = [];
    if (r.r) bits.push(r.r);
    if (r.t) bits.push(r.t);
    var tail = bits.length ? " (" + bits.join(", ") + ")" : "";
    return "- **" + (r.c || "Dose") + "** — " + (r.d || "") + tail + (r.n ? ". " + r.n : "");
  }
  // gold = the curated monograph object (api.js goldHTML keys); s = the plain structured record.
  function body(section, gold, s) {
    var out = [], i;
    if (gold) {
      var rows = gold.dosage || [];
      if (section === "ped") {
        var kid = [];
        for (i = 0; i < rows.length; i++) if (/child|p(a)?ediatric|infant|neonat|kg/i.test((rows[i].c || "") + " " + (rows[i].d || ""))) kid.push(rows[i]);
        rows = kid.length ? kid : rows;
      }
      if (section === "renal") return gold.renal ? [String(gold.renal)] : [];
      if (section === "hepatic") return gold.hepatic ? [String(gold.hepatic)] : [];
      if (section === "pregnancy") {
        if (gold.preg) out.push("**Pregnancy:** " + gold.preg);
        if (gold.lact) out.push("**Lactation:** " + gold.lact);
        return out;
      }
      for (i = 0; i < rows.length; i++) out.push(row(rows[i]));
      return out;
    }
    if (!s) return [];
    var keys = PLAIN[section] || PLAIN.adult;
    for (i = 0; i < keys.length; i++) if (s[keys[i]]) { out.push(String(s[keys[i]])); break; }
    return out;
  }

  var FOOT = "Source: StewardMD Drugs Database - structured from the official label. " +
             "Verify against your local formulary before prescribing.";

  function render(hit, section, resp, typed) {
    var data = (resp && resp.data) || null;
    var gold = null;
    try { if (data && data.gold) gold = JSON.parse(data.gold); } catch (e) { gold = null; }
    var lines = body(section, gold, data);
    if (!lines.length) return null;                       // no dose text -> let the model answer

    var head = "**" + hit.name + "** - " + (SEC_LABEL[section] || SEC_LABEL.adult);
    var md = [head, ""];
    if (hit.viaBrand) md.push("_" + hit.viaBrand + " is " + hit.name + "._", "");
    else if (hit.corrected && norm(typed) !== norm(hit.name)) md.push('_You typed "' + typed + '" - showing ' + hit.name + "._", "");
    md = md.concat(lines);

    // A dose question is rarely only about the adult dose: add the adjustments that change it.
    if (section === "adult") {
      var renal = (gold && gold.renal) || (data && data.renal_adjust) || "";
      var hep = (gold && gold.hepatic) || (data && data.hepatic_adjust) || "";
      if (renal) md.push("", "**Renal:** " + renal);
      if (hep) md.push("**Hepatic:** " + hep);
    }
    md.push("", FOOT);
    return md.join("\n");
  }

  /* ── entry point ─────────────────────────────────────────────────────────────────────────── */
  // -> Promise<{ text, drug, section } | null>. null means "not a dose question I can answer from
  // the database" and the caller must run its normal grounded answer.
  function answer(q, deps) {
    deps = deps || {};
    var W = (typeof window !== "undefined") ? window : {};
    var M = deps.MEDAPI || W.MEDAPI, fuzzy = deps.DrugFuzzy || W.DrugFuzzy;
    var it = intent(q);
    if (!it || !M || !M.structured) return Promise.resolve(null);
    return resolve(it.name, { MEDAPI: M, DrugFuzzy: fuzzy }).then(function (hit) {
      if (!hit) return null;
      return Promise.resolve(M.structured(hit.name)).then(function (resp) {
        if (!resp || !resp.found) return null;
        var text = render(hit, it.section, resp, it.name);
        return text ? { text: text, drug: hit.name, section: it.section, engine: "drugdb" } : null;
      }, function () { return null; });
    }, function () { return null; });
  }

  return { intent: intent, answer: answer, resolve: resolve, base: base, _render: render };
});
