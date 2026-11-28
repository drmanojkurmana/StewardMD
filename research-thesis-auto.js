/* StewardMD - ResearchMD one-tap Thesis to Journal Paper engine (ES5 IIFE).
 * Pure orchestration helpers, journal matching, table condensation,
 * PubMed/Crossref reference verification, MeSH keyword checking,
 * declarations/CRediT, prefilled checklist, format check, and
 * submission package (.docx / .ris / .zip) builders.
 * Dual export: window.SMD_RESEARCH_THESIS_AUTO and CommonJS module.exports.
 */
(function (G) {
  "use strict";

  var NAME = "research-thesis-auto";
  var VERSION = "rmd1";
  var MT_PER_INR = 2000;

  var STEP_ORDER = [
    { id: "chapters", label: "Read and split chapters", ai: false },
    { id: "study_type", label: "Suggest study type and checklist", ai: false },
    { id: "journals", label: "Match 3 target journals", ai: false },
    { id: "draft", label: "Draft sections by chapter", ai: true },
    { id: "tables", label: "Condense tables to journal limit", ai: false },
    { id: "references", label: "Build and verify references", ai: false },
    { id: "title_page", label: "Build title page", ai: false },
    { id: "abstract_keywords", label: "Check abstract and MeSH keywords", ai: false },
    { id: "declarations", label: "Prepare declarations and CRediT", ai: false },
    { id: "checklist", label: "Prefill reporting checklist", ai: false },
    { id: "format_check", label: "Run journal format check", ai: false },
    { id: "cover_letter", label: "Draft cover letter", ai: false }
  ];

  var FALLBACK_JOURNALS = [
    { id: "ijmr", name: "Indian Journal of Medical Research (IJMR)", shortName: "IJMR", specialty: "General Medicine", wordLimit: 3000, abstractWordLimit: 250, abstractFormat: "Structured (Background & objectives, Methods, Results, Interpretation & conclusions), up to 250 words", referenceStyle: "vancouver", maxReferences: 35, maxTables: 5, maxFigures: 5, indexedPubMed: true, noFee: true, openAccess: true, lineNumbers: true, articleTypes: ["Original Article", "Review Article", "Short Communication"] },
    { id: "ijccm", name: "Indian Journal of Critical Care Medicine (IJCCM)", shortName: "IJCCM", specialty: "Critical Care", wordLimit: 3000, abstractWordLimit: 350, abstractFormat: "Structured (Background, Methods, Results, Conclusion), up to 350 words", referenceStyle: "vancouver", maxReferences: 30, maxTables: 6, maxFigures: 6, indexedPubMed: true, noFee: true, openAccess: true, lineNumbers: true, articleTypes: ["Original Article", "Review Article", "Case Report"] },
    { id: "japi", name: "Journal of The Association of Physicians of India (JAPI)", shortName: "JAPI", specialty: "Internal Medicine", wordLimit: 2000, abstractWordLimit: 200, abstractFormat: "Structured abstract, up to 200 words", referenceStyle: "vancouver", maxReferences: 20, maxTables: 4, maxFigures: 4, indexedPubMed: true, noFee: true, openAccess: true, lineNumbers: true, articleTypes: ["Original Article", "Review Article", "Case Report"] },
    { id: "nmji", name: "National Medical Journal of India (NMJI)", shortName: "NMJI", specialty: "Internal Medicine", wordLimit: 3000, abstractWordLimit: 300, abstractFormat: "Structured (Background, Methods, Results, Conclusions), up to 300 words", referenceStyle: "vancouver", maxReferences: 30, maxTables: 4, maxFigures: 4, indexedPubMed: true, noFee: true, openAccess: true, lineNumbers: true, articleTypes: ["Original Article", "Review Article", "Case Report"] },
    { id: "bmj_open", name: "BMJ Open", shortName: "BMJ Open", specialty: "General Medicine", wordLimit: 4000, abstractWordLimit: 300, abstractFormat: "Structured (Objectives, Design, Setting, Participants, Primary and secondary outcome measures, Results, Conclusions), up to 300 words", referenceStyle: "vancouver", maxReferences: 45, maxTables: 5, maxFigures: 5, indexedPubMed: true, noFee: false, openAccess: true, lineNumbers: true, articleTypes: ["Original Research", "Systematic Review", "Cohort Study", "Randomized Controlled Trial"] },
    { id: "jama", name: "JAMA (Journal of the American Medical Association)", shortName: "JAMA", specialty: "General Medicine", wordLimit: 3000, abstractWordLimit: 350, abstractFormat: "Structured (Importance, Objective, Design, Setting, Participants, Exposures, Main Outcomes, Results, Conclusions), up to 350 words", referenceStyle: "ama", maxReferences: 40, maxTables: 5, maxFigures: 5, indexedPubMed: true, noFee: true, openAccess: false, lineNumbers: true, articleTypes: ["Original Investigation", "Review"] },
    { id: "thebmj", name: "The BMJ", shortName: "BMJ", specialty: "General Medicine", wordLimit: 4000, abstractWordLimit: 300, abstractFormat: "Structured (Objectives, Design, Setting, Participants, Interventions, Main outcome measures, Results, Conclusions), up to 300 words", referenceStyle: "vancouver", maxReferences: 40, maxTables: 5, maxFigures: 5, indexedPubMed: true, noFee: true, openAccess: false, lineNumbers: true, articleTypes: ["Original Research", "Clinical Review"] },
    { id: "indian_j_orthop", name: "Indian Journal of Orthopaedics", shortName: "IJO", specialty: "Orthopaedics", wordLimit: 4000, abstractWordLimit: 250, abstractFormat: "Structured (Background, Methods, Results, Conclusions), up to 250 words", referenceStyle: "vancouver", maxReferences: 35, maxTables: 6, maxFigures: 6, indexedPubMed: true, noFee: true, openAccess: false, lineNumbers: true, articleTypes: ["Original Article", "Review Article", "Case Report"] },
    { id: "indian_heart_j", name: "Indian Heart Journal", shortName: "IHJ", specialty: "Cardiology", wordLimit: 3500, abstractWordLimit: 250, abstractFormat: "Structured (Background, Methods, Results, Conclusions), up to 250 words", referenceStyle: "vancouver", maxReferences: 35, maxTables: 5, maxFigures: 5, indexedPubMed: true, noFee: true, openAccess: true, lineNumbers: true, articleTypes: ["Original Article", "Review Article", "Case Report"] }
  ];

  var SPECIALTY_CUES = [
    { spec: "Cardiology", re: /\b(heart failure|cardiac|cardiology|myocardial|coronary|echocardiograph|arrhythmia|atrial fibrillation|hypertension|nt-probnp|ejection fraction)\b/i },
    { spec: "Orthopaedics", re: /\b(spinal fusion|lumbar|spine|bone graft|orthopaed|orthoped|arthroplasty|fracture|osteotomy|pedicle|interbody|scoliosis)\b/i },
    { spec: "Critical Care", re: /\b(intensive care|icu|sepsis|septic shock|ventilat|sofa score|lactate|intubation|acute respiratory|critical care)\b/i },
    { spec: "Pulmonology", re: /\b(pulmonary|copd|asthma|tuberculosis|pneumonia|bronch|pleural|spirometry|respiratory)\b/i },
    { spec: "Neurology", re: /\b(stroke|epilepsy|seizure|parkinson|dementia|neurolog|cerebrovascular|migraine|neuropathy)\b/i },
    { spec: "Oncology", re: /\b(cancer|carcinoma|tumour|tumor|chemotherapy|radiotherapy|oncolog|metastat|leukemia|lymphoma)\b/i },
    { spec: "Surgery", re: /\b(surgical|surgery|laparoscop|postoperative|anastomosis|resection|hernia|cholecystectomy)\b/i },
    { spec: "Pediatrics", re: /\b(pediatric|paediatric|neonate|neonatal|infant|childhood|children)\b/i },
    { spec: "Nephrology", re: /\b(renal|kidney|dialysis|nephro|glomerul|creatinine|ckd|aki)\b/i },
    { spec: "Gastroenterology", re: /\b(hepatic|liver|cirrhosis|gastro|endoscop|pancreat|colitis|crohn)\b/i },
    { spec: "Obstetrics & Gynaecology", re: /\b(pregnan|obstetric|gynaec|gynec|caesarean|cesarean|preeclampsia|maternal|fetal)\b/i },
    { spec: "Ophthalmology", re: /\b(retina|retinopathy|cataract|glaucoma|cornea|ophthalm|visual acuity|macular)\b/i },
    { spec: "Psychiatry", re: /\b(depress|anxiety|schizophren|psychiatr|bipolar|cognitive behavior)\b/i },
    { spec: "Infectious Diseases", re: /\b(antibiotic|antimicrobial|bacteremia|hiv|malaria|dengue|infection|viral)\b/i },
    { spec: "Public Health", re: /\b(palliative|epidemiolog|prevalence|public health|community|screening program|vaccine)\b/i }
  ];

  var STOP_WORDS = {
    the: 1, and: 1, for: 1, with: 1, from: 1, that: 1, this: 1, were: 1, was: 1, are: 1,
    study: 1, patients: 1, patient: 1, analysis: 1, results: 1, methods: 1, conclusion: 1,
    conclusions: 1, background: 1, introduction: 1, discussion: 1, clinical: 1, thesis: 1,
    using: 1, between: 1, among: 1, after: 1, before: 1, during: 1, associated: 1,
    trial: 1, cohort: 1, review: 1, effect: 1, effects: 1, outcomes: 1, outcome: 1,
    hospital: 1, admitted: 1, data: 1, table: 1, figure: 1, chapter: 1, university: 1,
    research: 1, investigation: 1, assessment: 1, evaluation: 1, insights: 1, based: 1,
    needs: 1, need: 1, groups: 1, group: 1, score: 1, total: 1, mean: 1, median: 1
  };

  function trim(s) {
    return s == null ? "" : String(s).replace(/^\s+|\s+$/g, "");
  }

  function shallowCopy(obj) {
    var out = {};
    if (!obj || typeof obj !== "object") return out;
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
    }
    return out;
  }

  function cleanNoEmDash(s) {
    return String(s == null ? "" : s)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
      .replace(/\s*\u2014\s*/g, ", ")
      .replace(/\u2013/g, "-")
      .replace(/\s{2,}/g, " ");
  }

  function countWords(t) {
    var m = String(t == null ? "" : t).match(/\S+/g);
    return m ? m.length : 0;
  }

  function xmlEsc(s) {
    return String(s == null ? "" : s)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function utf8Bytes(str) {
    var s = String(str == null ? "" : str);
    if (typeof TextEncoder !== "undefined") {
      return Array.prototype.slice.call(new TextEncoder().encode(s));
    }
    var out = [], i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else if (c < 0xd800 || c >= 0xe000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      else {
        i++;
        c = 0x10000 + (((c & 0x3ff) << 10) | (s.charCodeAt(i) & 0x3ff));
        out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  /* Fallback CRC32 + zipStore when manuscript.js is not loaded (e.g. Node unit tests) */
  var CRC_TABLE = (function () {
    var tbl = [], n, c, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      tbl[n] = c >>> 0;
    }
    return tbl;
  })();

  function crc32(bytes) {
    var c = 0xffffffff, i;
    for (i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function push16(arr, v) { arr.push(v & 255, (v >>> 8) & 255); }
  function push32(arr, v) { arr.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); }

  function localZipStore(files) {
    var out = [], central = [], i, f, nameB, data, crc, headStart;
    for (i = 0; i < files.length; i++) {
      f = files[i];
      nameB = utf8Bytes(f.name);
      data = Array.isArray(f.data) ? f.data : Array.prototype.slice.call(f.data);
      crc = crc32(data);
      headStart = out.length;
      push32(out, 0x04034b50);
      push16(out, 20); push16(out, 0x0800); push16(out, 0);
      push16(out, 0); push16(out, 0x5021);
      push32(out, crc); push32(out, data.length); push32(out, data.length);
      push16(out, nameB.length); push16(out, 0);
      out = out.concat(nameB);
      out = out.concat(data);

      push32(central, 0x02014b50);
      push16(central, 20); push16(central, 20); push16(central, 0x0800); push16(central, 0);
      push16(central, 0); push16(central, 0x5021);
      push32(central, crc); push32(central, data.length); push32(central, data.length);
      push16(central, nameB.length); push16(central, 0); push16(central, 0);
      push16(central, 0); push16(central, 0);
      push32(central, 0); push32(central, headStart);
      central = central.concat(nameB);
    }
    var cdStart = out.length;
    out = out.concat(central);
    push32(out, 0x06054b50);
    push16(out, 0); push16(out, 0);
    push16(out, files.length); push16(out, files.length);
    push32(out, central.length); push32(out, cdStart);
    push16(out, 0);
    return new Uint8Array(out);
  }

  function getZipStore() {
    if (G && G.SMD_RESEARCH && typeof G.SMD_RESEARCH.zipStore === "function") {
      return G.SMD_RESEARCH.zipStore;
    }
    return localZipStore;
  }

  /* ---------- 1. Target journal ranking (top 3 + best) ---------- */

  function inferSpecialty(opts) {
    opts = opts || {};
    var explicit = trim(opts.specialty || "");
    var pages = opts.pages || [];
    var sample = [opts.title || "", explicit];
    for (var i = 0; i < pages.length && i < 10; i++) {
      sample.push(String((pages[i] && pages[i].text) || "").slice(0, 1200));
    }
    var blob = sample.join("\n");
    var counts = {};
    for (var si = 0; si < SPECIALTY_CUES.length; si++) {
      var cue = SPECIALTY_CUES[si];
      var re = new RegExp(cue.re.source, "gi");
      var m, hits = 0;
      while ((m = re.exec(blob)) !== null && hits < 25) hits++;
      if (hits > 0) counts[cue.spec] = hits;
    }
    var bestSpec = explicit || "General Medicine", bestHits = 0;
    for (var sp in counts) {
      if (Object.prototype.hasOwnProperty.call(counts, sp) && counts[sp] > bestHits) {
        bestHits = counts[sp];
        bestSpec = sp;
      }
    }
    return bestSpec;
  }

  function normJournalEntry(j) {
    j = j || {};
    var wl = j.wordLimit != null ? Number(j.wordLimit) : (j.wordLimits && j.wordLimits.main != null ? Number(j.wordLimits.main) : null);
    var al = j.abstractWordLimit != null ? Number(j.abstractWordLimit) : (j.abstractLimit != null ? Number(j.abstractLimit) : (j.wordLimits && j.wordLimits.abstract != null ? Number(j.wordLimits.abstract) : null));
    if (al == null && j.abstractFormat) {
      var am = String(j.abstractFormat).match(/(\d{2,4})\s*words?/i);
      if (am) al = parseInt(am[1], 10);
    }
    var mr = j.maxReferences != null ? Number(j.maxReferences) : (j.limits && j.limits.references != null ? Number(j.limits.references) : null);
    var mt = j.maxTables != null ? Number(j.maxTables) : (j.limits && j.limits.tables != null ? Number(j.limits.tables) : null);
    var mf = j.maxFigures != null ? Number(j.maxFigures) : (j.limits && j.limits.figures != null ? Number(j.limits.figures) : null);
    return {
      id: String(j.id || ""),
      name: String(j.name || "Journal"),
      shortName: String(j.shortName || j.name || ""),
      publisher: String(j.publisher || ""),
      specialty: String(j.specialty || ""),
      region: String(j.region || (j.isIndian ? "indian" : "international")),
      isIndian: typeof j.isIndian === "boolean" ? j.isIndian : null,
      openAccess: typeof j.openAccess === "boolean" ? j.openAccess : null,
      indexedPubMed: typeof j.indexedPubMed === "boolean" ? j.indexedPubMed : null,
      noFee: typeof j.noFee === "boolean" ? j.noFee : null,
      wordLimit: (isFinite(wl) && wl > 0) ? wl : 3000,
      abstractLimit: (isFinite(al) && al > 0) ? al : 250,
      abstractFormat: j.abstractFormat || ("Structured abstract, up to " + ((isFinite(al) && al > 0) ? al : 250) + " words"),
      referenceStyle: String(j.referenceStyle || "vancouver").toLowerCase(),
      maxReferences: (isFinite(mr) && mr > 0) ? mr : 35,
      maxTables: (isFinite(mt) && mt > 0) ? mt : 4,
      maxFigures: (isFinite(mf) && mf > 0) ? mf : 4,
      articleTypes: Array.isArray(j.articleTypes) ? j.articleTypes.slice() : [],
      apcNote: j.apcNote || "",
      url: j.url || j.authorInstructionsUrl || "",
      lineNumbers: typeof j.lineNumbers === "boolean" ? j.lineNumbers : true
    };
  }

  function typeMatchesJournal(paperType, articleTypes, matchesMap, jId) {
    var typesLow = (articleTypes || []).join(" ").toLowerCase();
    var hit = false;
    if (paperType === "case") hit = /case\s*(report|series)/.test(typesLow);
    else if (paperType === "sr") hit = /review|meta|systematic/.test(typesLow);
    else hit = /original|research|investigation|randomized|trial|cohort/.test(typesLow);
    if (!hit && matchesMap && matchesMap[jId]) hit = !!matchesMap[jId].designMatch;
    return hit;
  }

  function rankTargetJournals(catalogue, matches, opts) {
    opts = opts || {};
    var pool = (Array.isArray(catalogue) && catalogue.length) ? catalogue : FALLBACK_JOURNALS;
    var paperType = opts.paperType || "obs";
    var pages = opts.pages || [];
    var pageCount = pages.length || 0;
    var specialty = inferSpecialty({ specialty: opts.specialty, title: opts.title, pages: pages });
    var specLow = specialty.toLowerCase();
    var explicitSpecLow = trim(opts.specialty || "").toLowerCase();

    var matchesMap = {};
    var mList = Array.isArray(matches) ? matches : [];
    for (var mi = 0; mi < mList.length; mi++) {
      var mj = (mList[mi] && (mList[mi].journal || mList[mi])) || {};
      if (mj.id) matchesMap[mj.id] = { score: mList[mi].score || 0, designMatch: !!mList[mi].designMatch };
    }

    var scored = [];
    for (var i = 0; i < pool.length; i++) {
      var j = normJournalEntry(pool[i]);
      if (!j.id) continue;
      var jSpec = j.specialty.toLowerCase();
      var score = 0;
      var reasons = [];

      /* 1. Specialty fit */
      if (explicitSpecLow && (jSpec.indexOf(explicitSpecLow) >= 0 || explicitSpecLow.indexOf(jSpec) >= 0) && jSpec) {
        score += 14;
        reasons.push("Matches specialty (" + j.specialty + ")");
      } else if (specLow && jSpec && (jSpec.indexOf(specLow) >= 0 || specLow.indexOf(jSpec) >= 0)) {
        score += 12;
        reasons.push("Fits thesis topic (" + j.specialty + ")");
      } else if (/internal medicine|general medicine/.test(jSpec)) {
        score += 6;
        reasons.push("Broad clinical scope (" + j.specialty + ")");
      }

      /* 2. Study type fit */
      if (typeMatchesJournal(paperType, j.articleTypes, matchesMap, j.id)) {
        score += 8;
        reasons.push("Accepts this study type");
      }
      if (matchesMap[j.id]) {
        score += Math.min(8, Number(matchesMap[j.id].score || 0));
      }

      /* 3. Length & limits fit */
      var wantLong = pageCount >= 60;
      if (wantLong) {
        if (j.wordLimit >= 3000) { score += 8; reasons.push(j.wordLimit + "-word limit suits full thesis"); }
        else if (j.wordLimit >= 2500) { score += 4; }
        else if (j.wordLimit < 2200) { score -= 5; }
      } else {
        if (j.wordLimit >= 2000 && j.wordLimit <= 4000) score += 5;
      }
      if (j.maxReferences >= 30) score += 2;
      if (j.maxTables >= 4) score += 2;

      /* 4. Indexing and author accessibility */
      if (j.indexedPubMed) score += 3;
      if (j.noFee) score += 2;
      if (j.openAccess) score += 1;

      j.score = score;
      j.inferredSpecialty = specialty;
      j.fitReason = reasons.length ? reasons.slice(0, 2).join("; ") : ("Indexed " + (j.specialty || "medical") + " journal");
      scored.push(j);
    }

    scored.sort(function (a, b) {
      return (b.score - a.score) || (b.wordLimit - a.wordLimit) || (a.name < b.name ? -1 : 1);
    });

    var top3 = scored.slice(0, 3);
    return {
      specialty: specialty,
      top3: top3,
      best: top3[0] || normJournalEntry(FALLBACK_JOURNALS[0])
    };
  }

  /* ---------- 2. Table extraction + condensation + renumbering ---------- */

  function isLikelyHeadingLine(line) {
    var s = trim(line);
    if (!s) return false;
    return /^(?:\d+(?:\.\d+){0,2}\s+[A-Z]|Chapter\s+\d+|Introduction|Materials?\s+and\s+Methods|Observations?\s+and\s+Results|Discussion|Conclusion|References|Bibliography)/i.test(s);
  }

  function extractTableContent(pages, tbl) {
    var list = Array.isArray(pages) ? pages : [];
    var targetPage = tbl && tbl.page;
    var startIdx = -1;
    for (var i = 0; i < list.length; i++) {
      if (Number(list[i].n) === Number(targetPage)) { startIdx = i; break; }
    }
    if (startIdx < 0) return { headers: [], rows: [], rawLines: [], footnotes: [] };
    var tidEsc = String((tbl && tbl.id) || "Table").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var startRe = new RegExp("(?:^|\\n)\\s*" + tidEsc + "\\b", "i");
    var collected = [];
    var footnotes = [];
    for (var pi = startIdx; pi < list.length && pi <= startIdx + 1; pi++) {
      var txt = String((list[pi] && list[pi].text) || "");
      var lines = txt.split(/\n+/);
      var active = (pi > startIdx);
      if (pi > startIdx) {
        var headCheck = txt.slice(0, 260);
        if (!new RegExp(tidEsc + "\\s*[:.\\-]?\\s*\\(continued\\)", "i").test(headCheck) && !/continued/i.test(headCheck)) {
          break;
        }
      }
      for (var li = 0; li < lines.length; li++) {
        var ln = trim(lines[li]);
        if (!ln) continue;
        if (!active) {
          if (startRe.test("\n" + ln)) {
            active = true;
            collected.push(ln);
          }
          continue;
        }
        if (pi === startIdx && collected.length > 3 && /^Table\s+\d+(?:[.\-]\d+)?[A-Za-z]?\b/i.test(ln) && !/\(continued\)/i.test(ln)) {
          active = false;
          break;
        }
        if (collected.length > 3 && isLikelyHeadingLine(ln)) {
          active = false;
          break;
        }
        if (/^(?:Notes?:|Footnotes?:|\*|§|†|CI\s*=|IQR\s*=|SD\s*=|Values\s+are)/i.test(ln)) {
          footnotes.push(cleanNoEmDash(ln));
        } else {
          collected.push(cleanNoEmDash(ln));
        }
        if (collected.length >= 60) break;
      }
    }
    var bodyStart = 1;
    while (bodyStart < collected.length && bodyStart <= 4) {
      var candLine = collected[bodyStart];
      var hasCols = /\s{2,}|\t|\s*\|\s*/.test(candLine);
      var endsLikeSentence = /[.)]\s*$/.test(candLine) && candLine.split(/\s+/).length >= 6 && !hasCols;
      var looksCaptionCont = /^(?:for|of|in|on|with|between|among|by|and|or|after|before|from|to|the|a|an)\b/i.test(candLine) && !hasCols;
      if (endsLikeSentence || looksCaptionCont) bodyStart++;
      else break;
    }
    var rows = [];
    for (var ri = bodyStart; ri < collected.length; ri++) {
      var rowLine = collected[ri];
      var cols = rowLine.split(/\s{2,}|\t|\s*\|\s*/).map(trim).filter(Boolean);
      rows.push(cols.length ? cols : [rowLine]);
    }
    return {
      rawLines: collected,
      headers: rows.length ? rows[0] : [],
      rows: rows.slice(1),
      footnotes: footnotes
    };
  }

  function scoreTableForPaper(tbl, allPagesCount) {
    var base = Number((tbl && tbl.score) || 2);
    var cap = String((tbl && tbl.caption) || "").toLowerCase();
    var id = String((tbl && tbl.id) || "").toLowerCase();
    var pg = Number((tbl && tbl.page) || 0);
    if (/baseline|demographic|characteristic|clinical feature/.test(cap)) base += 6;
    if (/outcome|primary|secondary|result|survival|mortality|regression|multivariate|fusion|efficacy/.test(cap)) base += 7;
    if (/inclusion|exclusion|search\s+term|protocol|classification|abbreviations|appendix/.test(cap)) base -= 4;
    if (/^table\s+1\b/.test(id) && pg > 10) base += 3;
    if (allPagesCount > 20 && pg / allPagesCount < 0.22) base -= 3;
    return base;
  }

  function condenseTables(tables, pages, journal, sections, tableGrids) {
    var list = Array.isArray(tables) ? tables.slice() : [];
    var limit = Math.max(1, Math.min(Number((journal && journal.maxTables) || 3), 6));
    var totalPages = Array.isArray(pages) ? pages.length : 0;

    var enriched = [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i] || {};
      var copy = {
        id: String(t.id || ("Table " + (i + 1))),
        originalId: String(t.id || ("Table " + (i + 1))),
        caption: cleanNoEmDash(t.caption || t.id || ("Table " + (i + 1))),
        page: t.page || 1,
        score: scoreTableForPaper(t, totalPages),
        reason: t.reason || ""
      };
      var grid = tableGridFor(tableGrids, copy);
      copy.content = (grid && grid.rows && grid.rows.length >= 1)
        ? { headers: grid.headers || [], rows: grid.rows, rawLines: [], footnotes: [] }
        : extractTableContent(pages, copy);
      if (copy.content.rows.length >= 3) copy.score += 3;
      enriched.push(copy);
    }

    enriched.sort(function (a, b) {
      return (b.score - a.score) || (Number(a.page || 0) - Number(b.page || 0));
    });
    var kept = enriched.slice(0, limit);
    kept.sort(function (a, b) {
      return (Number(a.page || 0) - Number(b.page || 0));
    });

    var renameMap = {};
    for (var k = 0; k < kept.length; k++) {
      var newId = "Table " + (k + 1);
      renameMap[kept[k].originalId.toLowerCase()] = newId;
      var rawTitle = kept[k].caption.replace(new RegExp("^" + kept[k].originalId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[:.\\-]*\\s*", "i"), "");
      kept[k].newId = newId;
      kept[k].id = newId;
      kept[k].caption = rawTitle ? (newId + ": " + rawTitle) : newId;
    }

    var updatedSections = [];
    var secs = Array.isArray(sections) ? sections : [];
    for (var s = 0; s < secs.length; s++) {
      var sec = secs[s];
      var txt = String((sec && sec.text) || "");
      txt = txt.replace(/\b(Table\s+\d+(?:[.\-]\d+)?[A-Za-z]?)\b/gi, function (m) {
        var mapped = renameMap[m.replace(/\s+/g, " ").toLowerCase()];
        return mapped || m;
      });
      updatedSections.push({ id: sec.id, heading: sec.heading, text: txt });
    }

    return {
      kept: kept,
      droppedCount: Math.max(0, enriched.length - kept.length),
      totalFound: enriched.length,
      limit: limit,
      renameMap: renameMap,
      sections: updatedSections
    };
  }

  /* ---------- 3. References: extract, filter cited, format, verify PubMed/Crossref ---------- */

  function parseStructuredBibEntry(rawLine, numMarker) {
    var body = cleanNoEmDash(String(rawLine || ""))
      .replace(/^\s*\[?\d{1,3}\]?[.)]\s+/, "")
      .replace(/([A-Za-z])-\s+([a-z])/g, "$1$2")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");
    var doiM = body.match(/\b(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)\b/);
    var doi = doiM ? doiM[1].replace(/[.,;)]$/, "") : "";
    var pmidM = body.match(/PMID\s*:?\s*(\d{5,9})/i);
    var pmid = pmidM ? pmidM[1] : "";

    var core = body
      .replace(/\bDOI\s*:?\s*10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+\.?/gi, "")
      .replace(/\bPMID\s*:?\s*\d{5,9}\.?/gi, "")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");

    var vipM = core.match(/\b((?:19|20)\d{2})\s*;\s*([A-Za-z0-9]+)(?:\(([^)]+)\))?\s*:\s*([A-Za-z0-9-]+(?:\s*-\s*[A-Za-z0-9]+)?)/);
    var allYears = core.match(/\b((?:19|20)\d{2})\b/g);
    var year = vipM ? vipM[1] : (allYears && allYears.length ? allYears[allYears.length - 1] : "");
    var volume = vipM ? vipM[2] : "";
    var issue = vipM && vipM[3] ? vipM[3] : "";
    var pages = vipM && vipM[4] ? vipM[4].replace(/\s+/g, "") : "";

    var parts = core.split(/[.?!]\s+/);
    var authors = "";
    var title = "";
    var journal = "";

    if (parts.length >= 4 && /^(?:19|20)\d{2}\b/.test(trim(parts[parts.length - 1]))) {
      authors = trim(parts[0]);
      journal = trim(parts[parts.length - 2]);
      title = trim(parts.slice(1, parts.length - 2).join(". "));
    } else if (parts.length >= 3) {
      authors = trim(parts[0]);
      var lastP = trim(parts[parts.length - 1]);
      if (/^(?:19|20)\d{2}\b/.test(lastP)) {
        journal = trim(parts[parts.length - 2]);
        title = trim(parts.slice(1, parts.length - 2).join(". "));
      } else {
        title = trim(parts.slice(1, parts.length - 1).join(". "));
        journal = trim(lastP.replace(/\b(?:19|20)\d{2}\b.*$/, ""));
      }
    } else if (parts.length === 2) {
      authors = trim(parts[0]);
      var p2 = trim(parts[1]);
      var yIdx = p2.search(/\b(?:19|20)\d{2}\s*[;,]/);
      if (yIdx > 10) {
        var preYear = trim(p2.slice(0, yIdx));
        var lastSep = Math.max(preYear.lastIndexOf("."), preYear.lastIndexOf("?"));
        if (lastSep > 5) {
          title = trim(preYear.slice(0, lastSep));
          journal = trim(preYear.slice(lastSep + 1));
        } else {
          title = preYear;
        }
      } else {
        title = p2;
      }
    } else {
      authors = core.split(/[.(]/)[0] || "";
      title = core;
    }
    if (title && journal && title.toLowerCase() === journal.toLowerCase()) title = "";

    return {
      authors: authors,
      title: title || core,
      journal: journal,
      year: year,
      volume: volume,
      issue: issue,
      pages: pages,
      doi: doi,
      pmid: pmid,
      numMarker: numMarker || "",
      raw: body,
      verified: false,
      verificationSource: ""
    };
  }

  function extractCitationsFromText(text) {
    var src = String(text || "");
    var citedNums = [];
    var seenNums = {};
    function addNum(n) {
      if (n >= 1 && n <= 999 && !seenNums[n]) {
        seenNums[n] = true;
        citedNums.push(n);
      }
    }
    var m;
    function isStatisticalBracket(idx, inner, matchLen) {
      if (inner.indexOf("-") < 0 && inner.indexOf("\u2013") < 0) return false;
      var before = src.slice(Math.max(0, idx - 60), idx);
      var after = src.slice(idx + matchLen, Math.min(src.length, idx + matchLen + 20));
      if (/\b(?:IQR|interquartile\s+range|range|median|CI|scores?|points?|years?|days?|age|mean)\s*:?\s*(?:[^\n.;]{0,28}\d+(?:\.\d+)?\s*)?$/i.test(before)) return true;
      if (/\bvs\.?\s*\d+(?:\.\d+)?\s*$/i.test(before)) return true;
      if (/^\s*(?:days?|months?|years?|weeks?|hours?|mmol|mg|kg|cm|mmHg|%|patients?|points?)\b/i.test(after)) return true;
      return false;
    }
    /* Bracketed or parenthesized numbered citations: [1], [1, 2], [1-3], (1) */
    var grpRe = /[\[\(](\d+(?:\s*[-,\u2013]\s*\d+)*)[\]\)]/g;
    while ((m = grpRe.exec(src)) !== null) {
      if (isStatisticalBracket(m.index, m[1], m[0].length)) continue;
      var parts = m[1].split(/\s*,\s*/);
      for (var i = 0; i < parts.length; i++) {
        var rng = parts[i].match(/^(\d+)\s*[-\u2013]\s*(\d+)$/);
        if (rng) {
          var lo = parseInt(rng[1], 10), hi = parseInt(rng[2], 10);
          if (hi >= lo && hi - lo <= 20 && lo < 1900) {
            for (var k = lo; k <= hi; k++) addNum(k);
          }
        } else {
          var v = parseInt(parts[i], 10);
          if (v < 1900) addNum(v);
        }
      }
    }
    /* Superscript-style trailing citations after sentence punctuation (non-decimal): "outcomes.53,75,229" */
    var supRe = /([A-Za-z)\]"'\u201d])[.;!?](\d{1,3}(?:\s*[,\-\u2013]\s*\d{1,3})*)(?=\s|$)/g;
    while ((m = supRe.exec(src)) !== null) {
      var sparts = m[2].split(/\s*,\s*/);
      for (var si = 0; si < sparts.length; si++) {
        var srng = sparts[si].match(/^(\d+)\s*[-\u2013]\s*(\d+)$/);
        if (srng) {
          var slo = parseInt(srng[1], 10), shi = parseInt(srng[2], 10);
          if (shi >= slo && shi - slo <= 20) {
            for (var sk = slo; sk <= shi; sk++) addNum(sk);
          }
        } else {
          addNum(parseInt(sparts[si], 10));
        }
      }
    }
    return { orderedNums: citedNums, numSet: seenNums };
  }

  function refMatchesInText(ref, sectionsText, citeInfo) {
    var low = String(sectionsText || "").toLowerCase();
    if (ref.doi && low.indexOf(String(ref.doi).toLowerCase()) >= 0) return true;
    if (ref.pmid && low.indexOf(String(ref.pmid).toLowerCase()) >= 0) return true;
    if (ref.numMarker && citeInfo && citeInfo.numSet[parseInt(ref.numMarker, 10)]) return true;
    var authRaw = String(ref.authors || "");
    var surname = (authRaw.match(/^([A-Za-z][A-Za-z\-']{2,30})/) || [])[1] || "";
    var yr = String(ref.year || "");
    if (surname && yr) {
      var sLow = surname.toLowerCase();
      var idx = low.indexOf(sLow);
      while (idx >= 0) {
        var win = low.slice(Math.max(0, idx - 6), Math.min(low.length, idx + sLow.length + 32));
        if (win.indexOf(yr) >= 0) return true;
        idx = low.indexOf(sLow, idx + sLow.length);
      }
    }
    return false;
  }

  function formatJournalReference(ref, style, idx) {
    ref = ref || {};
    var st = String(style || "vancouver").toLowerCase();
    var authors = Array.isArray(ref.authors) ? ref.authors.join(", ") : String(ref.authors || "");
    authors = cleanNoEmDash(authors).replace(/\.+$/, "");
    var journal = cleanNoEmDash(String(ref.journal || "")).replace(/\.+$/, "");
    var title = cleanNoEmDash(String(ref.title || "")).replace(/\.+$/, "");
    if (journal && title) {
      var jEsc = journal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      title = title.replace(new RegExp("(?:[.?!]\\s+|\\s+)" + jEsc + "$", "i"), "");
      if (title.toLowerCase() === journal.toLowerCase()) title = "";
    }
    var year = String(ref.year || "");
    var vol = String(ref.volume || "");
    var issue = String(ref.issue || "");
    var pages = cleanNoEmDash(String(ref.pages || ""));
    var doi = String(ref.doi || "");
    var pmid = String(ref.pmid || "");
    var s = "";

    if (st === "apa") {
      s = (authors ? authors + " " : "") + "(" + (year || "n.d.") + "). " + (title ? title + ". " : "") +
        (journal ? journal : "") + (vol ? (", " + vol + (issue ? "(" + issue + ")" : "")) : "") +
        (pages ? (", " + pages) : "") + ".";
      if (doi) s += " https://doi.org/" + doi;
    } else if (st === "ama") {
      s = (idx != null ? (idx + 1) + ". " : "") + (authors ? authors + ". " : "") + (title ? title + ". " : "") +
        (journal ? journal + ". " : "") + (year ? year : "") +
        (vol ? (";" + vol + (issue ? "(" + issue + ")" : "")) : "") +
        (pages ? (":" + pages) : "") + ".";
      if (doi) s += " doi:" + doi;
    } else {
      /* Vancouver */
      s = (idx != null ? (idx + 1) + ". " : "") + (authors ? authors + ". " : "") + (title ? title + ". " : "") +
        (journal ? journal + ". " : "") + (year ? year : "") +
        (vol ? (";" + vol + (issue ? "(" + issue + ")" : "")) : "") +
        (pages ? (":" + pages) : "") + ".";
      if (doi) s += " doi: " + doi + ".";
      if (pmid) s += " PMID: " + pmid + ".";
    }
    return cleanNoEmDash(s).replace(/\s{2,}/g, " ").replace(/\.\./g, ".").replace(/^\s+|\s+$/g, "");
  }

  function buildJournalReferences(allBibRefs, sections, journal) {
    var secs = Array.isArray(sections) ? sections : [];
    var mainText = [];
    for (var si = 0; si < secs.length; si++) {
      if (secs[si] && secs[si].id !== "references") mainText.push(String(secs[si].text || ""));
    }
    var joined = mainText.join("\n\n");
    var citeInfo = extractCitationsFromText(joined);
    var parsed = [];
    for (var i = 0; i < (allBibRefs || []).length; i++) {
      var r = allBibRefs[i] || {};
      var p = (r.authors && r.journal && !r.raw) ? shallowCopy(r) : parseStructuredBibEntry(r.raw || r.title || "", r.numMarker);
      if (!p.authors && r.authors) p.authors = r.authors;
      if (!p.doi && r.doi) p.doi = r.doi;
      if (!p.pmid && r.pmid) p.pmid = r.pmid;
      if (!p.year && r.year) p.year = r.year;
      if (!p.numMarker && r.numMarker) p.numMarker = r.numMarker;
      parsed.push(p);
    }

    var kept = [];
    var oldToNew = {};
    /* Preserve first-appearance order when numbered citations appear in text */
    var byNum = {};
    for (var pi = 0; pi < parsed.length; pi++) {
      if (parsed[pi].numMarker) byNum[parseInt(parsed[pi].numMarker, 10)] = parsed[pi];
    }
    var seenIdx = {};
    for (var oi = 0; oi < citeInfo.orderedNums.length; oi++) {
      var origNum = citeInfo.orderedNums[oi];
      var hit = byNum[origNum];
      if (hit && !seenIdx[origNum]) {
        seenIdx[origNum] = true;
        kept.push(hit);
        oldToNew[origNum] = kept.length;
      }
    }
    /* Also include any bibliography entry matched by author+year or DOI/PMID */
    for (var ai = 0; ai < parsed.length; ai++) {
      var cand = parsed[ai];
      var nm = cand.numMarker ? parseInt(cand.numMarker, 10) : 0;
      if (nm && seenIdx[nm]) continue;
      if (refMatchesInText(cand, joined, citeInfo)) {
        kept.push(cand);
        if (nm) oldToNew[nm] = kept.length;
      }
    }

    var style = String((journal && journal.referenceStyle) || "vancouver").toLowerCase();
    var maxRefs = Number((journal && journal.maxReferences) || 35);
    if (style === "apa") {
      kept.sort(function (a, b) {
        var aa = String(a.authors || "").toLowerCase();
        var ba = String(b.authors || "").toLowerCase();
        return aa < ba ? -1 : (aa > ba ? 1 : 0);
      });
    }

    /* Renumber in-text [old] -> [new] for numbered styles when remapped */
    var updatedSections = [];
    for (var u = 0; u < secs.length; u++) {
      var sec = secs[u];
      var txt = String((sec && sec.text) || "");
      if (sec.id !== "references" && style !== "apa" && Object.keys(oldToNew).length > 0) {
        txt = txt.replace(/\[(\d+(?:\s*[-,\u2013]\s*\d+)*)\]/g, function (full, inner, off) {
          var before = txt.slice(Math.max(0, off - 32), off);
          var after = txt.slice(off + full.length, Math.min(txt.length, off + full.length + 20));
          if (/\b(?:IQR|interquartile\s+range|range|median|CI|scores?|points?|years?|days?|age|mean)\s*:?\s*(?:\d+(?:\.\d+)?\s*)?$/i.test(before)) return full;
          if (/^\s*(?:days?|months?|years?|weeks?|hours?|mmol|mg|kg|cm|mmHg|%|patients?|points?)\b/i.test(after) && /[-,\u2013]/.test(inner)) return full;
          var parts = inner.split(/\s*,\s*/);
          var mappedNums = [];
          var allMapped = true;
          for (var pIdx = 0; pIdx < parts.length; pIdx++) {
            var rng = parts[pIdx].match(/^(\d+)\s*[-\u2013]\s*(\d+)$/);
            if (rng) {
              var lo = parseInt(rng[1], 10), hi = parseInt(rng[2], 10);
              if (hi >= lo && hi - lo <= 20) {
                for (var n = lo; n <= hi; n++) {
                  if (!oldToNew[n]) { allMapped = false; break; }
                  mappedNums.push(oldToNew[n]);
                }
                if (!allMapped) break;
                continue;
              }
            }
            var single = parseInt(parts[pIdx], 10);
            if (!oldToNew[single]) { allMapped = false; break; }
            mappedNums.push(oldToNew[single]);
          }
          return allMapped && mappedNums.length ? ("[" + mappedNums.join(", ") + "]") : full;
        });
      }
      updatedSections.push({ id: sec.id, heading: sec.heading, text: txt });
    }

    var formatted = [];
    for (var fi = 0; fi < kept.length; fi++) {
      kept[fi].citationIndex = fi + 1;
      kept[fi].formatted = formatJournalReference(kept[fi], style, fi);
      formatted.push(kept[fi]);
    }

    return {
      references: formatted,
      totalBibliography: parsed.length,
      citedCount: formatted.length,
      maxReferences: maxRefs,
      overLimit: formatted.length > maxRefs,
      oldToNew: oldToNew,
      sections: updatedSections
    };
  }

  function titleWordOverlap(a, b) {
    var tok = function (s) {
      var m = String(s || "").toLowerCase().match(/[a-z0-9]{4,}/g) || [];
      var out = {}, list = [];
      for (var i = 0; i < m.length; i++) {
        if (!STOP_WORDS[m[i]] && !out[m[i]]) { out[m[i]] = 1; list.push(m[i]); }
      }
      return list;
    };
    var ta = tok(a), tb = tok(b);
    if (!ta.length || !tb.length) return 0;
    var setB = {}, hits = 0, i;
    for (i = 0; i < tb.length; i++) setB[tb[i]] = 1;
    for (i = 0; i < ta.length; i++) if (setB[ta[i]]) hits++;
    return hits / Math.min(ta.length, tb.length);
  }

  function refMatchesCandidate(ref, cand) {
    if (!cand) return false;
    var refYear = parseInt(ref.year, 10);
    var candYear = parseInt(cand.year, 10);
    if (isFinite(refYear) && isFinite(candYear) && Math.abs(refYear - candYear) > 1) return false;
    var surname = (String(ref.authors || "").match(/^([A-Za-z][A-Za-z\-']{2,30})/) || [])[1] || "";
    var candAuths = (Array.isArray(cand.authors) ? cand.authors.join(" ") : String(cand.authors || "")).toLowerCase();
    var authHit = surname && candAuths.indexOf(surname.toLowerCase()) >= 0;
    var ov = titleWordOverlap(ref.title, cand.title);
    if (ov >= 0.55) return true;
    if (authHit && ov >= 0.35) return true;
    return false;
  }

  function verifySingleReference(ref, fetchFn) {
    if (!fetchFn) {
      var out0 = shallowCopy(ref);
      out0.verified = false;
      out0.needCheck = true;
      out0.verificationSource = "Unverified (offline)";
      return Promise.resolve(out0);
    }
    var copy = shallowCopy(ref);
    function verifyByPmid(pmid) {
      var u = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=" + encodeURIComponent(pmid) + "&retmode=json";
      return fetchFn(u).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        var rec = j && j.result && j.result[pmid];
        if (!rec || !rec.title) return null;
        var doi = "";
        if (Array.isArray(rec.articleids)) {
          for (var i = 0; i < rec.articleids.length; i++) {
            if (rec.articleids[i] && rec.articleids[i].idtype === "doi") { doi = rec.articleids[i].value || ""; break; }
          }
        }
        return {
          source: "PubMed",
          pmid: pmid,
          doi: doi,
          title: String(rec.title || "").replace(/\.+$/, ""),
          authors: (rec.authors || []).map(function (a) { return a.name || ""; }).filter(Boolean).join(", "),
          journal: rec.source || "",
          year: (String(rec.pubdate || "").match(/\b((?:19|20)\d{2})\b/) || [])[1] || "",
          volume: rec.volume || "",
          issue: rec.issue || "",
          pages: rec.pages || ""
        };
      }).catch(function () { return null; });
    }
    function verifyByDoi(doi) {
      var u = "https://api.crossref.org/works/" + encodeURIComponent(doi) + "?mailto=support@stewardmd.in";
      return fetchFn(u).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        var msg = j && j.message;
        if (!msg || !msg.DOI) return null;
        var parts = msg.published && msg.published["date-parts"] && msg.published["date-parts"][0];
        var yr = parts && parts[0] ? String(parts[0]) : "";
        var auths = (msg.author || []).map(function (a) {
          return a.family ? (a.family + (a.given ? " " + a.given.charAt(0) : "")) : (a.name || "");
        }).filter(Boolean).join(", ");
        return {
          source: "Crossref",
          doi: msg.DOI,
          pmid: copy.pmid || "",
          title: (Array.isArray(msg.title) && msg.title[0]) || "",
          authors: auths,
          journal: (Array.isArray(msg["short-container-title"]) && msg["short-container-title"][0]) || (Array.isArray(msg["container-title"]) && msg["container-title"][0]) || "",
          year: yr,
          volume: msg.volume || "",
          issue: msg.issue || "",
          pages: msg.page || ""
        };
      }).catch(function () { return null; });
    }
    function searchCrossrefBib() {
      var q = trim((copy.authors || "").split(",")[0] + " " + (copy.title || "") + " " + (copy.year || "")).slice(0, 220);
      if (!q) return Promise.resolve(null);
      var u = "https://api.crossref.org/works?query.bibliographic=" + encodeURIComponent(q) + "&rows=3&mailto=support@stewardmd.in";
      return fetchFn(u).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        var items = (j && j.message && j.message.items) || [];
        for (var i = 0; i < items.length; i++) {
          var msg = items[i];
          var parts = msg.published && msg.published["date-parts"] && msg.published["date-parts"][0];
          var yr = parts && parts[0] ? String(parts[0]) : "";
          var auths = (msg.author || []).map(function (a) {
            return a.family ? (a.family + (a.given ? " " + a.given.charAt(0) : "")) : (a.name || "");
          }).filter(Boolean);
          var cand = {
            source: "Crossref",
            doi: msg.DOI || "",
            title: (Array.isArray(msg.title) && msg.title[0]) || "",
            authors: auths,
            journal: (Array.isArray(msg["short-container-title"]) && msg["short-container-title"][0]) || (Array.isArray(msg["container-title"]) && msg["container-title"][0]) || "",
            year: yr,
            volume: msg.volume || "",
            issue: msg.issue || "",
            pages: msg.page || ""
          };
          if (refMatchesCandidate(copy, cand)) {
            cand.authors = auths.join(", ");
            return cand;
          }
        }
        return null;
      }).catch(function () { return null; });
    }
    function searchPubMedBib() {
      var q = trim((copy.title || "").slice(0, 120) + (copy.year ? " " + copy.year + "[dp]" : ""));
      if (!q) return Promise.resolve(null);
      var u = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=" + encodeURIComponent(q) + "&retmax=3&retmode=json";
      return fetchFn(u).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        var ids = (j && j.esearchresult && j.esearchresult.idlist) || [];
        if (!ids.length) return null;
        return verifyByPmid(ids[0]).then(function (cand) {
          return cand && refMatchesCandidate(copy, cand) ? cand : null;
        });
      }).catch(function () { return null; });
    }

    var chain;
    if (copy.pmid) {
      chain = verifyByPmid(copy.pmid).then(function (hit) {
        if (hit && (refMatchesCandidate(copy, hit) || !copy.title)) return hit;
        return copy.doi ? verifyByDoi(copy.doi) : null;
      });
    } else if (copy.doi) {
      chain = verifyByDoi(copy.doi).then(function (hit) {
        if (hit) return hit;
        return searchPubMedBib();
      });
    } else {
      chain = searchCrossrefBib().then(function (hit) {
        return hit || searchPubMedBib();
      });
    }

    return chain.then(function (hit) {
      if (hit) {
        copy.verified = true;
        copy.needCheck = false;
        copy.verificationSource = hit.source;
        if (hit.doi) copy.doi = hit.doi;
        if (hit.pmid) copy.pmid = hit.pmid;
        if (hit.title && (!copy.title || copy.title.length > hit.title.length * 1.4)) copy.title = hit.title;
        if (hit.authors && !copy.authors) copy.authors = hit.authors;
        if (hit.journal && !copy.journal) copy.journal = hit.journal;
        if (hit.year && !copy.year) copy.year = hit.year;
        if (hit.volume && !copy.volume) copy.volume = hit.volume;
        if (hit.issue && !copy.issue) copy.issue = hit.issue;
        if (hit.pages && !copy.pages) copy.pages = hit.pages;
      } else {
        copy.verified = false;
        copy.needCheck = true;
        copy.verificationSource = "Unverified";
      }
      return copy;
    });
  }

  function verifyReferencesOnline(refs, fetchFn, opts) {
    var list = Array.isArray(refs) ? refs : [];
    var journal = (opts && opts.journal) || {};
    var style = String(journal.referenceStyle || "vancouver").toLowerCase();
    var cap = Math.min(list.length, 45);
    var out = new Array(list.length);
    var idx = 0;
    function next() {
      if (idx >= cap) return Promise.resolve();
      var i = idx++;
      return verifySingleReference(list[i], fetchFn).then(function (verifiedRef) {
        verifiedRef.citationIndex = i + 1;
        verifiedRef.formatted = formatJournalReference(verifiedRef, style, i);
        out[i] = verifiedRef;
      }).then(next);
    }
    for (var j = cap; j < list.length; j++) {
      var tail = shallowCopy(list[j]);
      tail.verified = !!(tail.doi || tail.pmid);
      tail.needCheck = !tail.verified;
      tail.verificationSource = tail.verified ? "Identifier" : "Unverified";
      tail.citationIndex = j + 1;
      tail.formatted = formatJournalReference(tail, style, j);
      out[j] = tail;
    }
    var workers = [];
    for (var w = 0; w < Math.min(3, cap); w++) workers.push(next());
    return Promise.all(workers).then(function () {
      var verifiedCount = 0, unverifiedIndices = [];
      for (var k = 0; k < out.length; k++) {
        if (out[k].verified) verifiedCount++;
        else unverifiedIndices.push(k + 1);
      }
      return {
        references: out,
        verifiedCount: verifiedCount,
        totalCount: out.length,
        unverifiedIndices: unverifiedIndices
      };
    });
  }

  /* ---------- 4. Title page, Structured Abstract & MeSH Keywords ---------- */

  function extractAuthorFromPages(pages) {
    var list = Array.isArray(pages) ? pages : [];
    for (var i = 0; i < Math.min(5, list.length); i++) {
      var txt = String((list[i] && list[i].text) || "");
      var mAuth = txt.match(/(?:^|\n)\s*Authors?\s*\n+([^\n]{3,80})/i);
      if (mAuth) return trim(mAuth[1]);
      var lines = txt.split(/\n+/);
      for (var li = 0; li < lines.length && li < 12; li++) {
        var ln = trim(lines[li]);
        if (/university|institution|faculty|college|department/i.test(ln)) {
          return { candidateLine: ln, pageIdx: i };
        }
      }
    }
    return "";
  }

  function buildShortTitle(title) {
    var s = cleanNoEmDash(trim(title || "Journal Manuscript"));
    if (s.length <= 50) return s;
    var cut = s.slice(0, 47);
    var sp = cut.lastIndexOf(" ");
    if (sp > 20) cut = cut.slice(0, sp);
    return cut;
  }

  function buildTitlePage(opts) {
    opts = opts || {};
    var pages = opts.pages || [];
    var sections = opts.sections || [];
    var user = opts.user || {};
    var project = opts.project || {};
    var journal = opts.journal || {};

    var title = cleanNoEmDash(trim(opts.title || project.title || ""));
    if (!title && pages.length) {
      var flines = String(pages[0].text || "").split(/\n+/).map(trim).filter(Boolean);
      for (var i = 0; i < flines.length && i < 8; i++) {
        if (flines[i].length >= 12 && flines[i].length <= 160 && !/^(repository|title|authors?|publication|rights|yes|no)$/i.test(flines[i])) {
          title = cleanNoEmDash(flines[i]);
          break;
        }
      }
    }
    if (!title) title = "Journal Manuscript";

    var profName = trim(user.displayName || user.name || "");
    var profEmail = trim(user.email || "");
    var profAffil = trim(user.affiliation || opts.affiliation || "");

    var thesisAuthor = extractAuthorFromPages(pages);
    var thesisInst = "";
    for (var pi = 0; pi < Math.min(5, pages.length); pi++) {
      var pLines = String((pages[pi] && pages[pi].text) || "").split(/\n+/);
      for (var li = 0; li < pLines.length; li++) {
        var ln = trim(pLines[li]);
        if (ln.length < 8 || ln.length > 100) continue;
        if (/\b(?:admitted\s+to|patients?|diagnosed|consent|committee|enrolled|outcomes?|study\s+visits?)\b/i.test(ln)) continue;
        if (/(?:University|Medical\s+College|Institute|Hospital|Infirmary|Centrum|Repository)\b/i.test(ln)) {
          thesisInst = ln;
          break;
        }
      }
      if (thesisInst) break;
    }

    var primaryName = profName || (typeof thesisAuthor === "string" ? thesisAuthor : "") || "[Confirm Author 1 Name]";
    var primaryAffil = profAffil || thesisInst || "[Confirm Department, Institution, City]";
    var hasPlaceholder = !profName || !profAffil || primaryName.indexOf("[Confirm") >= 0 || primaryAffil.indexOf("[Confirm") >= 0;

    var absWords = 0, mainWords = 0;
    for (var s = 0; s < sections.length; s++) {
      var sid = String((sections[s] && sections[s].id) || "");
      var wc = countWords(sections[s] && sections[s].text);
      if (sid === "abstract") absWords += wc;
      else if (sid === "introduction" || sid === "methods" || sid === "results" || sid === "discussion" || sid === "conclusion") mainWords += wc;
    }

    return {
      title: title,
      shortTitle: buildShortTitle(title),
      journalName: journal.name || "",
      authors: [
        { name: primaryName, affiliationNum: 1, orcid: "", isCorresponding: true },
        { name: "[Confirm Co-author / Guide Name]", affiliationNum: 1, orcid: "", isCorresponding: false }
      ],
      affiliations: ["1. " + primaryAffil],
      correspondingAuthor: {
        name: primaryName,
        email: profEmail || "[Confirm corresponding email]",
        affiliation: primaryAffil
      },
      wordCounts: {
        abstract: absWords,
        mainText: mainWords,
        tables: Number(opts.tablesCount || 0),
        figures: Number(opts.figuresCount || 0),
        references: Number(opts.referencesCount || 0)
      },
      confirmed: false,
      hasPlaceholders: hasPlaceholder || !profEmail
    };
  }

  function extractKeywordCandidates(title, abstractText, sections) {
    var src = [title || "", abstractText || ""];
    for (var i = 0; i < (sections || []).length; i++) {
      if (sections[i] && (sections[i].id === "introduction" || sections[i].id === "methods")) {
        src.push(String(sections[i].text || "").slice(0, 600));
      }
    }
    var blob = src.join(" ");
    /* Prefer multi-word medical noun phrases and high-frequency terms */
    var candidates = [];
    var seen = {};
    function add(term) {
      var clean = cleanNoEmDash(trim(term)).replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
      var low = clean.toLowerCase();
      if (clean.length < 4 || STOP_WORDS[low] || seen[low]) return;
      seen[low] = true;
      candidates.push(clean.charAt(0).toUpperCase() + clean.slice(1));
    }

    /* Check known domain bigrams first */
    var bigrams = blob.match(/\b([A-Za-z]{4,}\s+[A-Za-z]{4,})\b/g) || [];
    var bgCounts = {};
    for (var bi = 0; bi < bigrams.length; bi++) {
      var bg = bigrams[bi].toLowerCase();
      var parts = bg.split(/\s+/);
      if (STOP_WORDS[parts[0]] || STOP_WORDS[parts[1]]) continue;
      bgCounts[bg] = (bgCounts[bg] || 0) + 1;
    }
    var bgKeys = Object.keys(bgCounts).sort(function (a, b) { return bgCounts[b] - bgCounts[a]; });
    for (var bk = 0; bk < bgKeys.length && candidates.length < 4; bk++) {
      if (bgCounts[bgKeys[bk]] >= 2 || title.toLowerCase().indexOf(bgKeys[bk]) >= 0) {
        add(bgKeys[bk]);
      }
    }

    var words = blob.toLowerCase().match(/\b[a-z][a-z\-]{3,}\b/g) || [];
    var wCounts = {};
    for (var wi = 0; wi < words.length; wi++) {
      var w = words[wi];
      if (!STOP_WORDS[w]) wCounts[w] = (wCounts[w] || 0) + 1;
    }
    var wKeys = Object.keys(wCounts).sort(function (a, b) { return wCounts[b] - wCounts[a]; });
    for (var wk = 0; wk < wKeys.length && candidates.length < 6; wk++) {
      add(wKeys[wk]);
    }
    return candidates.slice(0, 6);
  }

  function verifyKeywordsMesh(candidates, fetchFn) {
    var list = Array.isArray(candidates) ? candidates.slice(0, 6) : [];
    if (!fetchFn || !list.length) {
      return Promise.resolve(list.map(function (t) {
        return { term: t, meshVerified: false, meshHeading: "", meshId: "" };
      }));
    }
    var jobs = list.map(function (term) {
      var u = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=mesh&term=" +
        encodeURIComponent(term + "[MeSH Terms]") + "&retmax=1&retmode=json";
      return fetchFn(u).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        var ids = (j && j.esearchresult && j.esearchresult.idlist) || [];
        if (!ids.length) {
          var u2 = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=mesh&term=" +
            encodeURIComponent(term) + "&retmax=1&retmode=json";
          return fetchFn(u2).then(function (r2) { return r2.ok ? r2.json() : null; }).then(function (j2) {
            var ids2 = (j2 && j2.esearchresult && j2.esearchresult.idlist) || [];
            return ids2[0] || "";
          });
        }
        return ids[0];
      }).then(function (meshId) {
        if (!meshId) return { term: term, meshVerified: false, meshHeading: "", meshId: "" };
        var su = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=mesh&id=" + encodeURIComponent(meshId) + "&retmode=json";
        return fetchFn(su).then(function (r) { return r.ok ? r.json() : null; }).then(function (sj) {
          var rec = sj && sj.result && sj.result[meshId];
          var heading = (rec && Array.isArray(rec.ds_meshterms) && rec.ds_meshterms[0]) || term;
          return { term: heading, originalTerm: term, meshVerified: true, meshHeading: heading, meshId: String(meshId) };
        });
      }).catch(function () {
        return { term: term, meshVerified: false, meshHeading: "", meshId: "" };
      });
    });
    return Promise.all(jobs).then(function (rows) {
      var out = [], seen = {};
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var key = trim((r && r.term) || "").toLowerCase();
        if (!key) continue;
        if (seen[key]) {
          if (r && r.originalTerm && !seen[r.originalTerm.toLowerCase()]) {
            seen[r.originalTerm.toLowerCase()] = true;
            out.push({ term: r.originalTerm, meshVerified: false, meshHeading: "", meshId: "" });
          }
          continue;
        }
        seen[key] = true;
        out.push(r);
      }
      return out;
    });
  }

  /* ---------- 5. Declarations + CRediT + Reporting Checklist ---------- */

  function extractThesisClues(pages) {
    var txt = "";
    var list = Array.isArray(pages) ? pages : [];
    for (var i = 0; i < list.length; i++) txt += "\n" + String((list[i] && list[i].text) || "");
    var iecM = txt.match(/\b((?:IEC|IRB)[\/-][A-Z0-9\/-]{3,})\b/i) ||
      txt.match(/\b(?:IEC|IRB|Ethics\s+Committee|Ethical\s+Committee)[^.\n]{0,80}?\b(No\.?\s*[A-Z0-9\/-]{3,}|[A-Z]{2,}[\/-][A-Z0-9\/-]{3,})/i);
    var regM = txt.match(/\b(NCT\d{8}|CTRI\/\d{4}\/\d{2}\/\d+|ISRCTN\d{6,})\b/i);
    var fundM = txt.match(/\b(?:funded\s+by|funding\s+(?:from|was\s+provided\s+by)|financial\s+support\s+(?:from|by)|research\s+grant\s+from|grant\s+(?:support\s+)?from|sponsored\s+by)\s+([^\n.]{5,120})/i);
    return {
      iecNumber: iecM ? trim(iecM[1]) : "",
      registration: regM ? trim(regM[1]) : "",
      funding: fundM ? cleanNoEmDash(trim(fundM[1])) : ""
    };
  }

  function buildAiDisclosure(aiProvenance) {
    if (G && G.SMD_RESEARCH && typeof G.SMD_RESEARCH.aiDisclosureText === "function") {
      return G.SMD_RESEARCH.aiDisclosureText(aiProvenance);
    }
    var prov = (aiProvenance && typeof aiProvenance === "object") ? aiProvenance : {};
    var model = trim(prov.model || "");
    var ver = (G && G.SMD_APP_VERSION) || (G && G.SMD_RESEARCH && G.SMD_RESEARCH.version) || "unspecified";
    var today = new Date().toISOString().slice(0, 10);
    var did = prov.draftedSections && prov.draftedSections.length
      ? ("It drafted the sections: " + prov.draftedSections.join(", "))
      : "";
    if (!did) {
      return "AI use disclosure: this document was prepared in StewardMD ResearchMD (app version " + ver +
        "), which offers AI drafting (MaiK AI). Any AI-assisted text in it was reviewed and verified by the named authors, who take responsibility for it. AI is not an author.";
    }
    return "AI use disclosure: parts of this document were drafted or edited with StewardMD ResearchMD (MaiK AI, model " +
      (model || "unspecified") + ", app version " + ver + ") on " + today + ". " + did +
      ". The named authors reviewed and verified all content and take responsibility for it. AI is not an author.";
  }

  function buildDeclarationsAndCredit(opts) {
    opts = opts || {};
    var clues = extractThesisClues(opts.pages || []);
    var authors = (opts.titlePage && opts.titlePage.authors) || [{ name: "[Confirm Author 1 Name]" }];
    var aiText = buildAiDisclosure(opts.aiProvenance);
    var creditList = [];
    for (var i = 0; i < authors.length; i++) {
      var nm = (authors[i] && authors[i].name) || ("Author " + (i + 1));
      creditList.push({
        author: nm,
        roles: i === 0
          ? ["Conceptualization", "Methodology", "Investigation", "Formal analysis", "Writing - original draft"]
          : ["Conceptualization", "Supervision", "Writing - review and editing"]
      });
    }
    return {
      ethics: {
        iecNumber: clues.iecNumber,
        committee: "",
        confirmed: false,
        text: clues.iecNumber
          ? ("Ethical approval was obtained (reference: " + clues.iecNumber + ").")
          : "Ethical approval was obtained from the Institutional Ethics Committee (confirm IEC reference number)."
      },
      consent: {
        confirmed: false,
        text: "Written informed consent was obtained from all participants in accordance with institutional ethical guidelines (confirm details)."
      },
      funding: {
        none: !clues.funding,
        source: clues.funding,
        confirmed: false,
        text: clues.funding
          ? ("Funding: " + clues.funding + ".")
          : "The authors received no specific external funding for this work (confirm funding statement)."
      },
      conflicts: {
        none: true,
        confirmed: false,
        text: "The authors declare no competing interests (confirm conflict statement)."
      },
      dataAvailability: {
        confirmed: false,
        text: "De-identified data supporting the findings of this study are available from the corresponding author upon reasonable request."
      },
      aiDisclosure: {
        confirmed: true,
        text: aiText
      },
      registration: clues.registration || "",
      credit: {
        confirmed: false,
        entries: creditList,
        text: creditList.map(function (c) { return c.author + ": " + c.roles.join(", "); }).join("; ")
      }
    };
  }

  var FALLBACK_CHECKLIST_ITEMS = {
    strobe: [
      { itemNum: "1", topic: "Title and abstract: indicate study design and informative summary", sectionTitle: "Title and Abstract" },
      { itemNum: "2", topic: "Background/rationale: explain scientific background and rationale", sectionTitle: "Introduction" },
      { itemNum: "3", topic: "Objectives: state specific objectives or hypotheses", sectionTitle: "Introduction" },
      { itemNum: "4", topic: "Study design: present key elements of study design", sectionTitle: "Methods" },
      { itemNum: "5", topic: "Setting: describe setting, locations, and relevant dates", sectionTitle: "Methods" },
      { itemNum: "6", topic: "Participants: eligibility criteria and methods of selection/follow-up", sectionTitle: "Methods" },
      { itemNum: "7", topic: "Variables: clearly define outcomes, exposures, and predictors", sectionTitle: "Methods" },
      { itemNum: "10", topic: "Study size: explain how the study size was arrived at", sectionTitle: "Methods" },
      { itemNum: "12", topic: "Statistical methods: describe all statistical methods", sectionTitle: "Methods" },
      { itemNum: "13", topic: "Participants: report numbers at each stage of study", sectionTitle: "Results" },
      { itemNum: "14", topic: "Descriptive data: characteristics of study participants", sectionTitle: "Results" },
      { itemNum: "16", topic: "Main results: unadjusted and confounder-adjusted estimates and precision", sectionTitle: "Results" },
      { itemNum: "18", topic: "Key results: summarize key results with reference to study objectives", sectionTitle: "Discussion" },
      { itemNum: "19", topic: "Limitations: discuss limitations of the study", sectionTitle: "Discussion" },
      { itemNum: "22", topic: "Funding: give source of funding and role of funders", sectionTitle: "Other" }
    ],
    consort2025: [
      { itemNum: "1a", topic: "Identification as a randomized trial in the title", sectionTitle: "Title" },
      { itemNum: "1b", topic: "Structured summary of trial design, methods, results, and conclusions", sectionTitle: "Abstract" },
      { itemNum: "2a", topic: "Scientific background and explanation of rationale", sectionTitle: "Introduction" },
      { itemNum: "2b", topic: "Specific objectives or hypotheses", sectionTitle: "Introduction" },
      { itemNum: "3a", topic: "Description of trial design including allocation ratio", sectionTitle: "Methods" },
      { itemNum: "4a", topic: "Eligibility criteria for participants", sectionTitle: "Methods" },
      { itemNum: "5", topic: "Interventions for each group with sufficient details", sectionTitle: "Methods" },
      { itemNum: "6a", topic: "Completely defined prespecified primary and secondary outcome measures", sectionTitle: "Methods" },
      { itemNum: "7a", topic: "How sample size was determined", sectionTitle: "Methods" },
      { itemNum: "8a", topic: "Method used to generate the random allocation sequence", sectionTitle: "Methods" },
      { itemNum: "11a", topic: "Who was blinded after assignment to interventions", sectionTitle: "Methods" },
      { itemNum: "12a", topic: "Statistical methods used to compare groups", sectionTitle: "Methods" },
      { itemNum: "13a", topic: "Participant flow (numbers randomly assigned, treated, analyzed)", sectionTitle: "Results" },
      { itemNum: "15", topic: "Baseline demographic and clinical characteristics for each group", sectionTitle: "Results" },
      { itemNum: "17a", topic: "Primary and secondary outcomes estimated effect size and precision", sectionTitle: "Results" },
      { itemNum: "20", topic: "Trial limitations addressing potential bias", sectionTitle: "Discussion" },
      { itemNum: "23", topic: "Registration number and name of trial registry", sectionTitle: "Other" },
      { itemNum: "25", topic: "Sources of funding and other support", sectionTitle: "Other" }
    ],
    prisma2020: [
      { itemNum: "1", topic: "Title: identify report as a systematic review", sectionTitle: "Title" },
      { itemNum: "2", topic: "Abstract: structured summary of review", sectionTitle: "Abstract" },
      { itemNum: "3", topic: "Rationale: describe rationale for the review", sectionTitle: "Introduction" },
      { itemNum: "4", topic: "Objectives: explicit statement of review question (PICO)", sectionTitle: "Introduction" },
      { itemNum: "5", topic: "Eligibility criteria: inclusion and exclusion criteria", sectionTitle: "Methods" },
      { itemNum: "6", topic: "Information sources: databases and search dates", sectionTitle: "Methods" },
      { itemNum: "13", topic: "Synthesis methods: statistical pooling and heterogeneity", sectionTitle: "Methods" },
      { itemNum: "16", topic: "Study selection: numbers screened and included", sectionTitle: "Results" },
      { itemNum: "20", topic: "Results of syntheses: summary estimates and confidence intervals", sectionTitle: "Results" },
      { itemNum: "23", topic: "Discussion: limitations of evidence and review process", sectionTitle: "Discussion" },
      { itemNum: "25", topic: "Support: sources of financial or non-financial support", sectionTitle: "Other" }
    ],
    care: [
      { itemNum: "1", topic: "Title: diagnosis or intervention of primary focus plus case report", sectionTitle: "Title" },
      { itemNum: "2", topic: "Keywords: 2 to 5 keywords", sectionTitle: "Keywords" },
      { itemNum: "3", topic: "Abstract: background, case summary, conclusion", sectionTitle: "Abstract" },
      { itemNum: "4", topic: "Introduction: why this case is unique", sectionTitle: "Introduction" },
      { itemNum: "5", topic: "Patient information and clinical findings", sectionTitle: "Methods" },
      { itemNum: "8", topic: "Diagnostic assessment and therapeutic intervention", sectionTitle: "Results" },
      { itemNum: "11", topic: "Discussion: strengths, limitations, medical literature", sectionTitle: "Discussion" },
      { itemNum: "13", topic: "Informed consent from patient for publication", sectionTitle: "Other" }
    ],
    stard2015: [
      { itemNum: "1", topic: "Identification as a study of diagnostic accuracy", sectionTitle: "Title" },
      { itemNum: "2", topic: "Structured summary of study design, methods, results, conclusions", sectionTitle: "Abstract" },
      { itemNum: "3", topic: "Scientific and clinical background", sectionTitle: "Introduction" },
      { itemNum: "4", topic: "Study objectives and hypotheses", sectionTitle: "Introduction" },
      { itemNum: "6", topic: "Eligibility criteria and participant recruitment", sectionTitle: "Methods" },
      { itemNum: "10", topic: "Index test and reference standard details", sectionTitle: "Methods" },
      { itemNum: "14", topic: "Methods for estimating diagnostic accuracy (sensitivity, specificity, AUC)", sectionTitle: "Methods" },
      { itemNum: "21", topic: "Cross tabulation and diagnostic accuracy estimates with 95% CIs", sectionTitle: "Results" },
      { itemNum: "26", topic: "Study limitations and implications for practice", sectionTitle: "Discussion" }
    ]
  };
  FALLBACK_CHECKLIST_ITEMS.consort = FALLBACK_CHECKLIST_ITEMS.consort2025;
  FALLBACK_CHECKLIST_ITEMS.srqr = FALLBACK_CHECKLIST_ITEMS.strobe;

  function checklistIdForPaperType(paperType) {
    if (paperType === "rct") return "consort2025";
    if (paperType === "sr") return "prisma2020";
    if (paperType === "case") return "care";
    if (paperType === "diagnostic") return "stard2015";
    return "strobe";
  }

  function prefillChecklist(checklistDef, paperType, sections, declarations, titlePage) {
    var gid = (checklistDef && checklistDef.id) || checklistIdForPaperType(paperType);
    var rawItems = [];
    if (checklistDef && Array.isArray(checklistDef.sections)) {
      for (var si = 0; si < checklistDef.sections.length; si++) {
        var csec = checklistDef.sections[si];
        var sitems = csec.items || [];
        for (var ii = 0; ii < sitems.length; ii++) {
          rawItems.push({
            itemNum: String(sitems[ii].number || sitems[ii].itemNum || ""),
            topic: String(sitems[ii].topic || sitems[ii].text || ""),
            sectionTitle: String(csec.title || "")
          });
        }
      }
    } else if (checklistDef && Array.isArray(checklistDef.items)) {
      rawItems = checklistDef.items.map(function (it) {
        return { itemNum: String(it.itemNum || it.num || ""), topic: String(it.topic || it.text || ""), sectionTitle: String(it.sectionTitle || "") };
      });
    }
    if (!rawItems.length) {
      rawItems = (FALLBACK_CHECKLIST_ITEMS[gid] || FALLBACK_CHECKLIST_ITEMS.strobe).slice();
    }

    var secMap = {};
    for (var s = 0; s < (sections || []).length; s++) {
      secMap[sections[s].id] = String(sections[s].text || "");
    }
    var declBlob = declarations ? [
      declarations.ethics && declarations.ethics.text,
      declarations.funding && declarations.funding.text,
      declarations.conflicts && declarations.conflicts.text,
      declarations.registration
    ].join(" ") : "";

    var rows = [];
    var coveredCount = 0, partialCount = 0;
    for (var i = 0; i < rawItems.length; i++) {
      var it = rawItems[i];
      var tLow = (it.topic + " " + it.sectionTitle).toLowerCase();
      var targetSec = "Methods";
      var evidence = "";
      var status = "partial";

      if (/title|abstract/.test(tLow)) {
        targetSec = "Title & Abstract";
        if (titlePage && titlePage.title && countWords(secMap.abstract) > 20) {
          status = "covered";
          evidence = "Title page and structured abstract (" + countWords(secMap.abstract) + " words).";
        }
      } else if (/background|rationale|objective|introduction/.test(tLow)) {
        targetSec = "Introduction";
        if (countWords(secMap.introduction) > 30) {
          status = "covered";
          evidence = "Addressed in Introduction (" + countWords(secMap.introduction) + " words).";
        }
      } else if (/result|outcome|participant|characteristic|baseline|flow|data/.test(tLow) && !/methods|eligibility|statistical/.test(tLow)) {
        targetSec = "Results";
        if (countWords(secMap.results) > 30) {
          status = "covered";
          evidence = "Reported in Results (" + countWords(secMap.results) + " words).";
        }
      } else if (/discussion|limitation|generalizability|interpretation/.test(tLow)) {
        targetSec = "Discussion";
        if (countWords(secMap.discussion) > 30) {
          status = "covered";
          evidence = "Addressed in Discussion (" + countWords(secMap.discussion) + " words).";
        }
      } else if (/funding|ethic|registration|conflict|protocol|availability/.test(tLow)) {
        targetSec = "Declarations";
        if (/registration/.test(tLow) && !(declarations && declarations.registration)) {
          status = "missing";
          evidence = "Confirm registry ID if applicable.";
        } else if (declBlob.length > 20) {
          status = "covered";
          evidence = "Included in Declarations section.";
        }
      } else {
        targetSec = "Methods";
        if (countWords(secMap.methods) > 30) {
          status = "covered";
          evidence = "Described in Methods (" + countWords(secMap.methods) + " words).";
        }
      }

      if (status === "covered") coveredCount++;
      else if (status === "partial") partialCount++;
      rows.push({
        itemNum: it.itemNum,
        topic: it.topic,
        section: targetSec,
        status: status,
        text: evidence || ("Check " + targetSec)
      });
    }

    return {
      guidelineId: gid,
      guidelineName: (checklistDef && checklistDef.name) || gid.toUpperCase(),
      items: rows,
      total: rows.length,
      covered: coveredCount,
      partial: partialCount,
      missing: rows.length - coveredCount - partialCount
    };
  }

  /* ---------- 6. Deterministic Journal Format Check ---------- */

  function runFormatCheck(spec) {
    spec = spec || {};
    var jr = spec.journal || {};
    var secs = spec.sections || [];
    var refs = spec.references || [];
    var tables = spec.tables || [];
    var kw = spec.keywords || [];
    var decl = spec.declarations || {};
    var cl = spec.checklistPrefill || {};
    var tp = spec.titlePage || {};

    var secById = {};
    for (var i = 0; i < secs.length; i++) secById[secs[i].id] = String(secs[i].text || "");

    var mainWords = 0;
    var mainIds = ["introduction", "methods", "results", "discussion", "conclusion"];
    for (var mi = 0; mi < mainIds.length; mi++) mainWords += countWords(secById[mainIds[mi]]);
    var mainLimit = jr.wordLimit || 3000;

    var absText = secById.abstract || "";
    var absWords = countWords(absText);
    var absLimit = jr.abstractLimit || 250;
    var absStructOk = /\b(background|objectives?)\s*:/i.test(absText) &&
      /\bmethods?\s*:/i.test(absText) && /\bresults?\s*:/i.test(absText) && /\bconclusions?\s*:/i.test(absText);

    var checks = [];
    checks.push({
      check: "word_count",
      label: "Main text word count",
      status: mainWords > 0 && mainWords <= mainLimit ? "pass" : "fail",
      detail: mainWords + " of " + mainLimit + " words."
    });
    checks.push({
      check: "abstract",
      label: "Structured abstract",
      status: absWords > 0 && absWords <= absLimit && absStructOk ? "pass" : "fail",
      detail: absWords + " of " + absLimit + " words" + (absStructOk ? ", structured headings present." : ", missing structured headings.")
    });
    checks.push({
      check: "section_order",
      label: "IMRaD + Conclusion section order",
      status: (secById.introduction && secById.methods && secById.results && secById.discussion && secById.conclusion) ? "pass" : "fail",
      detail: "Abstract, Introduction, Methods, Results, Discussion, Conclusion."
    });
    var tblLimit = jr.maxTables || 4;
    checks.push({
      check: "tables",
      label: "Tables within journal limit",
      status: tables.length <= tblLimit ? "pass" : "fail",
      detail: tables.length + " table(s) kept (limit " + tblLimit + ")."
    });
    var refLimit = jr.maxReferences || 35;
    var unverifiedRefs = 0;
    for (var ri = 0; ri < refs.length; ri++) if (!refs[ri].verified) unverifiedRefs++;
    checks.push({
      check: "references",
      label: "References (" + (jr.referenceStyle || "vancouver").toUpperCase() + ", PubMed/Crossref)",
      status: refs.length <= refLimit && unverifiedRefs === 0 ? "pass" : (refs.length > refLimit ? "fail" : "warn"),
      detail: refs.length + " reference(s) (limit " + refLimit + "), " + unverifiedRefs + " unverified."
    });
    checks.push({
      check: "keywords",
      label: "MeSH keywords (3 to 6)",
      status: kw.length >= 3 && kw.length <= 6 ? "pass" : "warn",
      detail: kw.length + " keyword(s)."
    });
    var declMissing = [];
    if (!decl.ethics || !decl.ethics.iecNumber) declMissing.push("IEC number");
    if (!tp || tp.hasPlaceholders) declMissing.push("author details");
    checks.push({
      check: "declarations",
      label: "Declarations and title page",
      status: declMissing.length === 0 ? "pass" : "warn",
      detail: declMissing.length ? ("Confirm: " + declMissing.join(", ") + ".") : "All declarations and title page details filled."
    });
    checks.push({
      check: "reporting_checklist",
      label: "Reporting checklist (" + (cl.guidelineName || "Checklist") + ")",
      status: cl.total && cl.missing === 0 ? "pass" : "warn",
      detail: (cl.covered || 0) + " of " + (cl.total || 0) + " items covered."
    });

    var passCount = 0, warnCount = 0, failCount = 0;
    for (var ci = 0; ci < checks.length; ci++) {
      if (checks[ci].status === "pass") passCount++;
      else if (checks[ci].status === "fail") failCount++;
      else warnCount++;
    }
    return {
      journalId: jr.id || "default",
      journalName: jr.name || "Target Journal",
      checks: checks,
      passCount: passCount,
      warnCount: warnCount,
      failCount: failCount
    };
  }

  /* ---------- 7. MaiK token estimate ---------- */
  /* Calibrated from the three live one-tap runs (thesis-auto-1/2/3):
   *   341 p / 18 calls / Rs 2.93 / 5,860 MT  = Rs 0.163 per call, 326 MT
   *   175 p / 20 calls / Rs 3.68 / 7,360 MT  = Rs 0.184 per call, 368 MT
   *    96 p / 10 calls / Rs 0.92 / 1,840 MT  = Rs 0.092 per call, 184 MT
   * A call is one 13,000-char chapter chunk plus the task prompt (about 720
   * input tokens) and a section-budget answer (about 160 tokens of JSON
   * overhead). Rates are the server's T1 model rates (functions/_ai_usage.js)
   * and the credit conversion is functions/_credits.js MT_PER_INR. The old
   * flat Rs 0.06 per call under-quoted a 341-page thesis by 2.9x.
   * The quote is a range: low covers cached/shorter answers, high covers
   * retries and longer answers. The run pauses before spending above high. */
  var CALL_CHARS_PER_TOKEN = 3.6;
  var CALL_PROMPT_TOKENS = 720;
  var CALL_OUT_TOKENS_PER_WORD = 1.35;
  var CALL_OUT_OVERHEAD_TOKENS = 160;
  var CALL_RETRY_FACTOR = 1.12;
  var QUOTE_LOW_FACTOR = 0.55;
  var QUOTE_HIGH_FACTOR = 1.15;
  var DEFAULT_RATE_IN = 0.024;   /* gemini-3.1-flash-lite, INR per 1k input */
  var DEFAULT_RATE_OUT = 0.144;  /* gemini-3.1-flash-lite, INR per 1k output */

  function callRates(opts) {
    var o = opts || {};
    var inR = Number(o.rateIn);
    var outR = Number(o.rateOut);
    return {
      in: isFinite(inR) && inR >= 0 ? inR : DEFAULT_RATE_IN,
      out: isFinite(outR) && outR >= 0 ? outR : DEFAULT_RATE_OUT,
      promptTokens: isFinite(Number(o.promptTokens)) && Number(o.promptTokens) > 0 ? Number(o.promptTokens) : CALL_PROMPT_TOKENS,
      mtPerInr: isFinite(Number(o.mtPerInr)) && Number(o.mtPerInr) > 0 ? Number(o.mtPerInr) : MT_PER_INR
    };
  }

  function estimateCallInr(chars, outWords, opts) {
    var r = callRates(opts);
    var inTok = Math.ceil(Math.max(0, Number(chars) || 0) / CALL_CHARS_PER_TOKEN) + r.promptTokens;
    var outTok = Math.ceil(Math.max(60, Number(outWords) || 0) * CALL_OUT_TOKENS_PER_WORD) + CALL_OUT_OVERHEAD_TOKENS;
    return Math.round(((inTok / 1000) * r.in + (outTok / 1000) * r.out) * 10000) / 10000;
  }

  function sectionBudgets(journal) {
    var limit = Number((journal && journal.wordLimit) || 3000);
    var absLimit = Number((journal && (journal.abstractLimit || journal.abstractWordLimit)) || 250);
    return {
      abstract: absLimit,
      introduction: Math.round(limit * 0.17),
      methods: Math.round(limit * 0.18),
      results: Math.round(limit * 0.31),
      discussion: Math.round(limit * 0.24),
      conclusion: Math.round(limit * 0.08)
    };
  }

  function estimateAutoCost(pages, mapping, journal, opts) {
    var list = Array.isArray(pages) ? pages : [];
    var r = callRates(opts);
    var budgets = sectionBudgets(journal);
    var totalChars = 0;
    for (var i = 0; i < list.length; i++) totalChars += String((list[i] && list[i].text) || "").length;

    function callOutWords(budget, factor, cap, floor) {
      var v = Math.round((Number(budget) || 0) * factor);
      if (v < floor) v = floor;
      if (v > cap) v = cap;
      return v;
    }

    if (totalChars <= 13500) {
      var oneWords = callOutWords(Math.max(budgets.introduction, 600), 0.35, 650, 180);
      var oneInr = estimateCallInr(totalChars, oneWords, opts);
      var oneCalls = Math.max(1, Math.round(CALL_RETRY_FACTOR));
      return finishQuote(oneCalls, oneInr * CALL_RETRY_FACTOR, r);
    }

    var bySec = (mapping && mapping.bySection) || {};
    var keys = ["introduction", "methods", "results", "discussion", "conclusion"];
    var planCalls = 1; /* abstract */
    var baseInr = estimateCallInr(6500, callOutWords(budgets.abstract, 0.8, 420, 120), opts);

    for (var k = 0; k < keys.length; k++) {
      var b = bySec[keys[k]];
      var bPages = (b && b.pages) || [];
      if (!bPages.length && keys[k] !== "conclusion") continue;
      var bChars = 0;
      for (var p = 0; p < bPages.length; p++) bChars += String((bPages[p] && bPages[p].text) || "").length;
      if (!bChars && keys[k] !== "conclusion") continue;
      var chunks = Math.min(4, Math.max(1, Math.ceil((bChars || 1) / 13000)));
      var chunkChars = bChars / chunks;
      var secBudget = budgets[keys[k]] || 500;
      var chunkBudget = chunks > 1 ? Math.max(220, Math.min(700, Math.round(secBudget * 0.9))) : secBudget;
      var chunkOut = callOutWords(chunkBudget, 0.4, 420, 120);
      for (var c = 0; c < chunks; c++) baseInr += estimateCallInr(chunkChars, chunkOut, opts);
      planCalls += chunks;
      if (chunks > 1) {
        /* merge call: the part summaries come back as input */
        baseInr += estimateCallInr(chunks * 900, callOutWords(secBudget, 0.55, 650, 180), opts);
        planCalls += 1;
      }
    }
    var expectedCalls = Math.max(1, Math.round(planCalls * CALL_RETRY_FACTOR));
    return finishQuote(expectedCalls, baseInr * CALL_RETRY_FACTOR, r);
  }

  function finishQuote(calls, baseInr, r) {
    var mid = Math.max(0.01, Math.round(baseInr * 10000) / 10000);
    var low = Math.max(0.01, Math.round(mid * QUOTE_LOW_FACTOR * 10000) / 10000);
    var high = Math.max(low, Math.round(mid * QUOTE_HIGH_FACTOR * 10000) / 10000);
    return {
      aiCalls: calls,
      estimatedCostInr: mid,
      estimatedMaikTokens: Math.round(mid * r.mtPerInr),
      minCostInr: low,
      maxCostInr: high,
      minMaikTokens: Math.round(low * r.mtPerInr),
      maxMaikTokens: Math.round(high * r.mtPerInr),
      mtPerInr: r.mtPerInr,
      rateIn: r.in,
      rateOut: r.out
    };
  }

  /* ---------- 7b. Tables from the Rust reader's word positions ---------- */
  /* The plain page text loses the column grid: headers wrap ("Completed" /
   * "PROMS"), units wrap ("Systolic blood pressure-" / "mmHg"), and columns
   * run together. The Rust reader gives every word's x/y box, so rows can be
   * rebuilt: words are split into cells on horizontal gaps, cells are aligned
   * to column anchors, wrapped header and label lines are merged, and every
   * number stays verbatim. No Rust change is needed. */
  function tableWordsLines(words) {
    var w = (Array.isArray(words) ? words : []).slice();
    w.sort(function (a, b) { return (a.y0 - b.y0) || (a.x0 - b.x0); });
    var lines = [], cur = [], lastY = null;
    for (var i = 0; i < w.length; i++) {
      var x = w[i] || {};
      if (lastY == null || Math.abs(x.y0 - lastY) <= 3) {
        cur.push(x);
        if (lastY == null) lastY = x.y0;
      } else {
        lines.push(cur);
        cur = [x];
        lastY = x.y0;
      }
    }
    if (cur.length) lines.push(cur);
    var out = [];
    for (var j = 0; j < lines.length; j++) {
      var ws = lines[j].slice().sort(function (a, b) { return a.x0 - b.x0; });
      var y1 = ws[0].y1;
      for (var k = 1; k < ws.length; k++) if (ws[k].y1 > y1) y1 = ws[k].y1;
      var txt = [];
      for (var t = 0; t < ws.length; t++) txt.push(String(ws[t].t || ""));
      out.push({ y0: ws[0].y0, y1: y1, ws: ws, text: trim(txt.join(" ")) });
    }
    return out;
  }

  function tableLineCells(line, pageWidth) {
    var gapMin = Math.max(9, (Number(pageWidth) || 595) * 0.018);
    var groups = [], cur = [];
    for (var i = 0; i < line.ws.length; i++) {
      var w = line.ws[i] || {};
      if (!cur.length) { cur.push(w); continue; }
      var prev = cur[cur.length - 1];
      if (w.x0 - prev.x1 > gapMin) {
        groups.push(cur);
        cur = [w];
      } else {
        cur.push(w);
      }
    }
    if (cur.length) groups.push(cur);
    var cells = [];
    for (var g = 0; g < groups.length; g++) {
      var gs = groups[g], x1 = gs[0].x1, parts = [];
      for (var p = 1; p < gs.length; p++) if (gs[p].x1 > x1) x1 = gs[p].x1;
      for (var q = 0; q < gs.length; q++) parts.push(String(gs[q].t || ""));
      cells.push({ x0: gs[0].x0, x1: x1, text: trim(parts.join(" ")) });
    }
    return cells;
  }

  var TABLE_SECTION_LABELS = /^(symptoms|signs|hf symptoms|biochemistry|haematology|coagulation|microbiology|serology|past medical history|nyha functional class)(?:\s*-?\s*n\s*\(%\))?$/i;

  function tableColumnAnchors(rows) {
    var xs = [];
    for (var r = 0; r < rows.length; r++) {
      for (var c = 0; c < rows[r].cells.length; c++) xs.push(rows[r].cells[c].x0);
    }
    xs.sort(function (a, b) { return a - b; });
    var anchors = [];
    for (var i = 0; i < xs.length; i++) {
      var hit = -1;
      for (var a = 0; a < anchors.length; a++) {
        if (Math.abs(anchors[a] - xs[i]) <= 22) { hit = a; break; }
      }
      if (hit < 0) anchors.push(xs[i]);
      else anchors[hit] = (anchors[hit] + xs[i]) / 2;
    }
    anchors.sort(function (a, b) { return a - b; });
    var merged = [];
    for (var m = 0; m < anchors.length; m++) {
      if (merged.length && anchors[m] - merged[merged.length - 1] <= 28) {
        merged[merged.length - 1] = (merged[merged.length - 1] + anchors[m]) / 2;
      } else merged.push(anchors[m]);
    }
    return merged;
  }

  function buildTableGridFromPage(pg, tableId, captionLineIndex) {
    var lines = tableWordsLines(pg && pg.words);
    var ci = typeof captionLineIndex === "number" && captionLineIndex >= 0 ? captionLineIndex : -1;
    var idRe = new RegExp("^Table\\s+" + String(tableId || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:\\b|(?=[A-Z(]))", "i");
    if (ci < 0) {
      for (var l = 0; l < lines.length; l++) {
        if (idRe.test(lines[l].text)) { ci = l; break; }
      }
    }
    if (ci < 0) return null;
    var cap = lines[ci];
    var rows = [];
    for (var i = ci + 1; i < lines.length; i++) {
      var ln = lines[i];
      if (ln.y0 < cap.y0 + 3) continue;
      if (/^(Continuous variables|Values are|Data are|HF\s*=|CI\s*=|IQR\s*=|SD\s*=|Abbreviations|\*|†|‡|NOTE|Notes?)/i.test(ln.text)) break;
      if (/^\d+$/.test(ln.text)) break;
      if (rows.length && /^Table\s+\d/i.test(ln.text)) break;
      if (rows.length && ln.text.split(/\s+/).length > 10 && (ln.ws.length < 4 || /^(These|This|The|In|Our|There)\b/.test(ln.text))) break;
      if (rows.length >= 2) {
        var prevLine = rows[rows.length - 1];
        if (ln.y0 - prevLine.y1 > 18 && !/\d/.test(ln.text) && ln.text.split(/\s+/).length < 5) break;
      }
      var cells = tableLineCells(ln, pg && pg.width);
      if (!cells.length) continue;
      rows.push({ y1: ln.y1, cells: cells });
    }
    if (!rows.length) return null;
    var anchors = tableColumnAnchors(rows);
    if (anchors.length < 2) return null;
    var grid = [];
    for (var r = 0; r < rows.length; r++) {
      var arr = [];
      for (var a = 0; a < anchors.length; a++) arr.push("");
      for (var c = 0; c < rows[r].cells.length; c++) {
        var cell = rows[r].cells[c];
        var best = 0, dist = 1e9;
        for (var q = 0; q < anchors.length; q++) {
          var d = Math.abs(anchors[q] - cell.x0);
          if (d < dist) { dist = d; best = q; }
        }
        arr[best] = arr[best] ? (arr[best] + " " + cell.text) : cell.text;
      }
      grid.push(arr);
    }

    /* Header: the first row of column labels (>= 2 cells, no row label). */
    var headerStart = -1;
    var scanTo = Math.min(4, grid.length);
    for (var hs = 0; hs < scanTo; hs++) {
      var non = 0;
      for (var hc = 0; hc < grid[hs].length; hc++) if (grid[hs][hc]) non++;
      if (non >= 2 && !grid[hs][0]) { headerStart = hs; break; }
    }
    if (headerStart < 0) headerStart = 0;
    var bodyStart = grid.length;
    for (var bs = headerStart; bs < grid.length; bs++) {
      if (grid[bs][0] && /\d/.test(grid[bs].slice(1).join(" "))) { bodyStart = bs; break; }
    }
    var hasHeader = bodyStart > headerStart;
    var headerRows = [], preRows = [], rb;
    for (rb = headerStart; rb < (hasHeader ? bodyStart : headerStart); rb++) {
      var rowNon = [];
      for (var rc = 0; rc < grid[rb].length; rc++) if (grid[rb][rc]) rowNon.push(grid[rb][rc]);
      if (rowNon.length === 1 && TABLE_SECTION_LABELS.test(rowNon[0].replace(/\s+/g, " "))) preRows.push(grid[rb]);
      else headerRows.push(grid[rb]);
    }
    var headers = [];
    for (var ha = 0; ha < anchors.length; ha++) {
      var parts = [];
      for (var hr = 0; hr < headerRows.length; hr++) if (headerRows[hr][ha]) parts.push(headerRows[hr][ha]);
      headers.push(parts.join(" "));
    }
    var body = (hasHeader ? grid.slice(0, headerStart) : []).concat(preRows, grid.slice(hasHeader ? bodyStart : 0));
    var outRows = [];
    for (var br = 0; br < body.length; br++) {
      var g = body[br], count = 0, only = -1;
      for (var gc = 0; gc < g.length; gc++) if (g[gc]) { count++; only = gc; }
      if (count === 1 && outRows.length && !TABLE_SECTION_LABELS.test(g[only].replace(/\s+/g, " ")) && !/-\s*n\s*\(%\)$/i.test(g[only])) {
        outRows[outRows.length - 1][only] = outRows[outRows.length - 1][only] ? (outRows[outRows.length - 1][only] + " " + g[only]) : g[only];
      } else {
        outRows.push(g);
      }
    }
    /* Drop fully empty rows and keep the numbers verbatim. */
    var clean = [];
    for (var cr = 0; cr < outRows.length; cr++) {
      var hasText = false;
      for (var cc = 0; cc < outRows[cr].length; cc++) if (trim(outRows[cr][cc])) hasText = true;
      if (hasText) clean.push(outRows[cr]);
    }
    if (!clean.length) return null;
    return { headers: headers, rows: clean };
  }

  function buildTableGrids(extractPages) {
    var list = Array.isArray(extractPages) ? extractPages : [];
    var byId = {}, out = [], order = [];
    for (var p = 0; p < list.length; p++) {
      var pg = list[p] || {};
      var text = String(pg.text || "");
      var lines = text.split(/\n+/);
      var seenOnPage = {};
      for (var li = 0; li < lines.length; li++) {
        var m = /^\s*Table\s+([0-9]+(?:[.\-][0-9]+)?[A-Za-z]?)(?=[:\-.\s(]|[A-Z]|$)/i.exec(lines[li]);
        if (!m) continue;
        var id = m[1];
        if (seenOnPage[id]) continue;
        seenOnPage[id] = true;
        var cont = /\(continued\)|continued/i.test(lines[li]) || /\(continued\)/i.test(text.slice(0, 300));
        var grid = buildTableGridFromPage(pg, id);
        if (!grid) continue;
        var key = id.toLowerCase();
        if (cont && byId[key]) {
          var base = byId[key];
          for (var rr = 0; rr < grid.rows.length; rr++) base.rows.push(grid.rows[rr]);
        } else if (!byId[key]) {
          var entry = { id: "Table " + id, page: Number(pg.n) || 0, headers: grid.headers, rows: grid.rows };
          byId[key] = entry;
          order.push(key);
        }
      }
    }
    for (var o = 0; o < order.length; o++) out.push(byId[order[o]]);
    return out;
  }

  function tableGridFor(tableGrids, tbl) {
    var list = Array.isArray(tableGrids) ? tableGrids : [];
    var id = String((tbl && (tbl.originalId || tbl.id)) || "").replace(/^Table\s+/i, "").toLowerCase();
    var page = Number(tbl && tbl.page);
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var g = list[i] || {};
      if (Number(g.page) !== page) continue;
      var gid = String(g.id || "").replace(/^Table\s+/i, "").toLowerCase();
      if (gid === id) return g;
      if (!best && gid && id && (gid.indexOf(id) === 0 || id.indexOf(gid) === 0)) best = g;
    }
    return best;
  }

  /* ---------- 8. DOCX, RIS & Submission Package ZIP Builders ---------- */

  function docxPara(text, opts) {
    opts = opts || {};
    var clean = cleanNoEmDash(text);
    if (!clean) return "<w:p/>";
    var ppr = "";
    var pParts = [];
    if (opts.align) pParts.push('<w:jc w:val="' + opts.align + '"/>');
    if (opts.spacing) pParts.push('<w:spacing w:line="' + opts.spacing + '" w:lineRule="auto" w:after="120"/>');
    if (opts.keepNext) pParts.push("<w:keepNext/>");
    if (pParts.length) ppr = "<w:pPr>" + pParts.join("") + "</w:pPr>";

    var rParts = [];
    rParts.push('<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>');
    if (opts.bold) rParts.push("<w:b/>");
    if (opts.italic) rParts.push("<w:i/>");
    if (opts.size) rParts.push('<w:sz w:val="' + opts.size + '"/><w:szCs w:val="' + opts.size + '"/>');
    var rpr = "<w:rPr>" + rParts.join("") + "</w:rPr>";
    return "<w:p>" + ppr + "<w:r>" + rpr + '<w:t xml:space="preserve">' + xmlEsc(clean) + "</w:t></w:r></w:p>";
  }

  function docxTable(headers, rows) {
    var colCount = Math.max(1, headers.length || (rows[0] && rows[0].length) || 1);
    var tblPr = '<w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>' +
      '<w:top w:val="single" w:sz="6" w:space="0" w:color="888888"/>' +
      '<w:bottom w:val="single" w:sz="6" w:space="0" w:color="888888"/>' +
      '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>' +
      '<w:left w:val="none"/><w:right w:val="none"/><w:insideV w:val="none"/>' +
      "</w:tblBorders></w:tblPr>";
    function rowXml(cells, isHead) {
      var cxml = [], ci;
      for (ci = 0; ci < colCount; ci++) {
        var val = cells[ci] != null ? String(cells[ci]) : "";
        var shd = isHead ? '<w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>' : "";
        cxml.push("<w:tc><w:tcPr>" + shd + '</w:tcPr>' + docxPara(val, { bold: isHead, size: 20 }) + "</w:tc>");
      }
      return "<w:tr>" + cxml.join("") + "</w:tr>";
    }
    var body = [];
    if (headers && headers.length) body.push(rowXml(headers, true));
    for (var r = 0; r < (rows || []).length; r++) body.push(rowXml(rows[r], false));
    return "<w:tbl>" + tblPr + body.join("") + "</w:tbl>";
  }

  function wrapDocxXml(bodyXml, opts) {
    opts = opts || {};
    var lnXml = opts.lineNumbers ? '<w:lnNumType w:countBy="1" w:restart="newPage"/>' : "";
    var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      bodyXml +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>' +
      lnXml +
      "</w:sectPr></w:body></w:document>";
    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>";
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>";
    return getZipStore()([
      { name: "[Content_Types].xml", data: utf8Bytes(contentTypes) },
      { name: "_rels/.rels", data: utf8Bytes(rels) },
      { name: "word/document.xml", data: utf8Bytes(doc) }
    ]);
  }

  function buildManuscriptDocxBytes(opts) {
    opts = opts || {};
    var parts = [];
    var jr = opts.journal || {};
    var lineNums = typeof opts.lineNumbers === "boolean" ? opts.lineNumbers : (jr.lineNumbers !== false);
    parts.push(docxPara(opts.title || "Manuscript", { bold: true, size: 30, spacing: 360 }));
    var order = ["abstract", "keywords", "introduction", "methods", "results", "discussion", "conclusion"];
    var byId = {};
    var secs = opts.sections || [];
    for (var i = 0; i < secs.length; i++) byId[secs[i].id] = secs[i];
    for (var oi = 0; oi < order.length; oi++) {
      var sid = order[oi];
      var sec = byId[sid];
      if (!sec || !trim(sec.text)) continue;
      parts.push(docxPara(sec.heading || sid, { bold: true, size: 26, keepNext: true, spacing: 360 }));
      var lines = String(sec.text).split(/\n+/);
      for (var li = 0; li < lines.length; li++) {
        parts.push(docxPara(lines[li], { size: 24, spacing: 480 }));
      }
    }
    if (opts.declarations) {
      var d = opts.declarations;
      parts.push(docxPara("Declarations", { bold: true, size: 26, keepNext: true, spacing: 360 }));
      if (d.ethics && d.ethics.text) parts.push(docxPara("Ethics approval: " + d.ethics.text, { size: 24, spacing: 360 }));
      if (d.consent && d.consent.text) parts.push(docxPara("Consent: " + d.consent.text, { size: 24, spacing: 360 }));
      if (d.funding && d.funding.text) parts.push(docxPara("Funding: " + d.funding.text, { size: 24, spacing: 360 }));
      if (d.conflicts && d.conflicts.text) parts.push(docxPara("Competing interests: " + d.conflicts.text, { size: 24, spacing: 360 }));
      if (d.dataAvailability && d.dataAvailability.text) parts.push(docxPara("Data availability: " + d.dataAvailability.text, { size: 24, spacing: 360 }));
      if (d.credit && d.credit.text) parts.push(docxPara("Author contributions (CRediT): " + d.credit.text, { size: 24, spacing: 360 }));
    }
    var refs = opts.references || [];
    if (refs.length) {
      parts.push(docxPara("References", { bold: true, size: 26, keepNext: true, spacing: 360 }));
      for (var ri = 0; ri < refs.length; ri++) {
        var rTxt = refs[ri].formatted || formatJournalReference(refs[ri], jr.referenceStyle || "vancouver", ri);
        parts.push(docxPara(rTxt, { size: 22, spacing: 360 }));
      }
    }
    parts.push(docxPara((opts.declarations && opts.declarations.aiDisclosure && opts.declarations.aiDisclosure.text) || buildAiDisclosure(opts.aiProvenance), { size: 20, spacing: 300 }));
    return wrapDocxXml(parts.join(""), { lineNumbers: lineNums });
  }

  function buildTitlePageDocxBytes(opts) {
    opts = opts || {};
    var tp = opts.titlePage || {};
    var decl = opts.declarations || {};
    var parts = [];
    parts.push(docxPara("TITLE PAGE", { bold: true, size: 28, spacing: 360 }));
    parts.push(docxPara("Full Title: " + (tp.title || ""), { bold: true, size: 26, spacing: 360 }));
    parts.push(docxPara("Short Running Title: " + (tp.shortTitle || ""), { size: 24, spacing: 360 }));
    if (tp.journalName) parts.push(docxPara("Target Journal: " + tp.journalName, { size: 24, spacing: 360 }));
    parts.push(docxPara("Authors", { bold: true, size: 24, spacing: 300 }));
    var authList = (tp.authors || []).map(function (a) {
      return a.name + (a.affiliationNum ? " (" + a.affiliationNum + ")" : "") + (a.isCorresponding ? "*" : "");
    }).join(", ");
    parts.push(docxPara(authList || "", { size: 24, spacing: 360 }));
    parts.push(docxPara("Affiliations", { bold: true, size: 24, spacing: 300 }));
    var affs = tp.affiliations || [];
    for (var i = 0; i < affs.length; i++) parts.push(docxPara(affs[i], { size: 24, spacing: 320 }));
    if (tp.correspondingAuthor) {
      parts.push(docxPara("Corresponding Author: " + tp.correspondingAuthor.name + ", " + tp.correspondingAuthor.email + ", " + tp.correspondingAuthor.affiliation, { size: 24, spacing: 360 }));
    }
    if (tp.wordCounts) {
      var wc = tp.wordCounts;
      parts.push(docxPara("Counts: Abstract " + wc.abstract + " words; Main text " + wc.mainText + " words; Tables " + wc.tables + "; Figures " + wc.figures + "; References " + wc.references + ".", { size: 24, spacing: 360 }));
    }
    parts.push(docxPara("Declarations & Author Contributions", { bold: true, size: 24, spacing: 300 }));
    if (decl.ethics && decl.ethics.text) parts.push(docxPara("Ethics / IEC: " + decl.ethics.text, { size: 22, spacing: 320 }));
    if (decl.consent && decl.consent.text) parts.push(docxPara("Consent: " + decl.consent.text, { size: 22, spacing: 320 }));
    if (decl.funding && decl.funding.text) parts.push(docxPara("Funding: " + decl.funding.text, { size: 22, spacing: 320 }));
    if (decl.conflicts && decl.conflicts.text) parts.push(docxPara("Conflicts of Interest: " + decl.conflicts.text, { size: 22, spacing: 320 }));
    if (decl.dataAvailability && decl.dataAvailability.text) parts.push(docxPara("Data Availability: " + decl.dataAvailability.text, { size: 22, spacing: 320 }));
    if (decl.credit && decl.credit.text) parts.push(docxPara("CRediT Contributions: " + decl.credit.text, { size: 22, spacing: 320 }));
    parts.push(docxPara((decl.aiDisclosure && decl.aiDisclosure.text) || buildAiDisclosure(opts.aiProvenance), { size: 20, spacing: 300 }));
    return wrapDocxXml(parts.join(""), { lineNumbers: false });
  }

  function buildCoverLetterDocxBytes(opts) {
    opts = opts || {};
    var text = String(opts.coverLetterText || "");
    var lines = text.split(/\n/);
    var parts = [];
    for (var i = 0; i < lines.length; i++) {
      parts.push(docxPara(lines[i], { size: 24, spacing: 300 }));
    }
    return wrapDocxXml(parts.join(""), { lineNumbers: false });
  }

  function buildTablesDocxBytes(opts) {
    opts = opts || {};
    var tables = opts.tables || [];
    var parts = [];
    parts.push(docxPara("TABLES", { bold: true, size: 28, spacing: 360 }));
    if (!tables.length) {
      parts.push(docxPara("No tables included in this manuscript.", { size: 24, spacing: 300 }));
      return wrapDocxXml(parts.join(""), { lineNumbers: false });
    }
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      parts.push(docxPara(t.caption || t.id, { bold: true, size: 24, keepNext: true, spacing: 320 }));
      var content = t.content || {};
      if (content.headers && content.headers.length) {
        parts.push(docxTable(content.headers, content.rows || []));
      } else if (content.rows && content.rows.length) {
        parts.push(docxTable([], content.rows));
      } else if (content.rawLines && content.rawLines.length) {
        for (var r = 1; r < content.rawLines.length; r++) {
          parts.push(docxPara(content.rawLines[r], { size: 20, spacing: 260 }));
        }
      }
      if (content.footnotes && content.footnotes.length) {
        parts.push(docxPara("Footnotes: " + content.footnotes.join(" "), { italic: true, size: 20, spacing: 280 }));
      }
      parts.push(docxPara("Source: thesis " + (t.originalId || t.id) + ", page " + (t.page || "") + ".", { italic: true, size: 18, spacing: 300 }));
    }
    return wrapDocxXml(parts.join(""), { lineNumbers: false });
  }

  function buildChecklistDocxBytes(opts) {
    opts = opts || {};
    var cl = opts.checklistPrefill || {};
    var parts = [];
    parts.push(docxPara("REPORTING CHECKLIST: " + (cl.guidelineName || "Reporting Guideline"), { bold: true, size: 28, spacing: 360 }));
    parts.push(docxPara("Covered: " + (cl.covered || 0) + " of " + (cl.total || 0) + " items.", { size: 24, spacing: 320 }));
    var rows = [];
    var items = cl.items || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      rows.push([it.itemNum || "", it.topic || "", String(it.status || "").toUpperCase(), (it.section || "") + (it.text ? (" - " + it.text) : "")]);
    }
    parts.push(docxTable(["Item", "Checklist Topic", "Status", "Manuscript Location"], rows));
    return wrapDocxXml(parts.join(""), { lineNumbers: false });
  }

  function buildReferencesRis(refs) {
    var list = Array.isArray(refs) ? refs : [];
    var blocks = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i] || {};
      var lines = ["TY  - JOUR"];
      if (r.title) lines.push("TI  - " + cleanNoEmDash(r.title));
      var auths = Array.isArray(r.authors) ? r.authors : String(r.authors || "").split(/,\s*/);
      for (var ai = 0; ai < auths.length; ai++) {
        var au = trim(auths[ai]);
        if (au) lines.push("AU  - " + cleanNoEmDash(au));
      }
      if (r.journal) lines.push("T2  - " + cleanNoEmDash(r.journal));
      if (r.year) lines.push("PY  - " + r.year);
      if (r.volume) lines.push("VL  - " + r.volume);
      if (r.issue) lines.push("IS  - " + r.issue);
      if (r.pages) lines.push("SP  - " + cleanNoEmDash(r.pages));
      if (r.doi) lines.push("DO  - " + r.doi);
      if (r.pmid) lines.push("AN  - PMID:" + r.pmid);
      lines.push("N1  - Verification: " + (r.verified ? ("Verified (" + (r.verificationSource || "PubMed/Crossref") + ")") : "Unverified - check manually"));
      lines.push("ER  - ");
      blocks.push(lines.join("\n"));
    }
    return blocks.join("\n\n") + (blocks.length ? "\n" : "");
  }

  function buildCoverLetter(opts) {
    opts = opts || {};
    var tp = opts.titlePage || {};
    var jr = opts.journal || {};
    var decl = opts.declarations || {};
    var sections = opts.sections || [];
    var title = cleanNoEmDash(tp.title || opts.title || "Journal Manuscript");
    var jrName = cleanNoEmDash(jr.name || "Target Journal");
    var today = opts.date || new Date().toISOString().slice(0, 10);
    var absText = "";
    for (var i = 0; i < sections.length; i++) {
      if (sections[i] && sections[i].id === "abstract") { absText = String(sections[i].text || ""); break; }
    }
    var summary = "This manuscript presents the primary findings of our clinical thesis study.";
    if (absText) {
      var rawSum = cleanNoEmDash(absText).replace(/\s+/g, " ");
      if (rawSum.length <= 420) {
        summary = rawSum;
      } else {
        var cut = rawSum.slice(0, 420);
        var endS = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));
        if (endS > 120) summary = cut.slice(0, endS + 1);
        else {
          var sp = cut.lastIndexOf(" ");
          summary = (sp > 120 ? cut.slice(0, sp) : cut) + ".";
        }
      }
    }
    var authNames = (tp.authors || []).map(function (a) { return a && a.name; }).filter(Boolean).join(", ");
    var corr = tp.correspondingAuthor || {};
    var corrLine = corr.name ? (corr.name + (corr.email ? (", " + corr.email) : "") + (corr.affiliation ? (", " + corr.affiliation) : "")) : "";
    var declParts = [];
    if (decl.ethics && decl.ethics.text) declParts.push(decl.ethics.text);
    if (decl.funding && decl.funding.text) declParts.push(decl.funding.text);
    if (decl.conflicts && decl.conflicts.text) declParts.push(decl.conflicts.text);
    if (decl.aiDisclosure && decl.aiDisclosure.text) declParts.push(decl.aiDisclosure.text);

    var SUB = G && G.SMD_RESEARCH_SUBMISSION;
    if (SUB && typeof SUB.coverLetter === "function") {
      var res = SUB.coverLetter({
        title: title,
        journal: jrName,
        date: today,
        editor: "Editor-in-Chief",
        summary: summary,
        studyType: opts.paperTypeLabel || opts.paperType || "",
        registration: (decl && decl.registration) || "",
        authors: authNames,
        corresponding: corrLine,
        declarations: declParts.join("\n")
      });
      if (res && res.body) return cleanNoEmDash(res.body);
    }

    var lines = [
      today,
      "",
      "Editor-in-Chief",
      jrName,
      "",
      "Dear Editor,",
      "",
      'Please consider the enclosed manuscript, "' + title + '", for publication in ' + jrName + ".",
      "",
      summary,
      "",
      "All authors have reviewed and approved the final manuscript, and it is not under consideration elsewhere.",
      "",
      declParts.join("\n"),
      "",
      "Yours sincerely,",
      authNames,
      corrLine
    ];
    return cleanNoEmDash(lines.join("\n"));
  }

  /* Pure-ES5 valid PDF 1.4 generator for the completed reporting checklist */
  function pdfEsc(s) {
    return String(s == null ? "" : s)
      .replace(/[^\x20-\x7e]/g, " ")
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  }

  function wrapPdfText(str, maxChars) {
    var words = trim(str).split(/\s+/);
    var lines = [], cur = "";
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w) continue;
      if (cur && (cur.length + 1 + w.length) > maxChars) {
        lines.push(cur);
        cur = w;
      } else {
        cur = cur ? (cur + " " + w) : w;
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  }

  function buildChecklistPdfBytes(opts) {
    opts = opts || {};
    var cl = opts.checklistPrefill || {};
    var items = cl.items || [];
    var rawLines = [
      "REPORTING CHECKLIST: " + (cl.guidelineName || "Reporting Guideline"),
      "Covered: " + (cl.covered || 0) + " of " + (cl.total || 0) + " items",
      ""
    ];
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var rowStr = "[" + (it.itemNum || (i + 1)) + "] " + String(it.status || "partial").toUpperCase() +
        " | " + (it.section || "") + " - " + (it.topic || "");
      var wrapped = wrapPdfText(cleanNoEmDash(rowStr), 88);
      for (var wi = 0; wi < wrapped.length; wi++) rawLines.push(wrapped[wi]);
    }
    var linesPerPage = 48;
    var pages = [];
    for (var p = 0; p < rawLines.length; p += linesPerPage) {
      pages.push(rawLines.slice(p, p + linesPerPage));
    }
    if (!pages.length) pages.push(["Reporting checklist"]);

    var objs = [];
    objs.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    var pageRefs = [];
    var nextId = 4;
    var pageObjs = [];
    for (var pi = 0; pi < pages.length; pi++) {
      var pId = nextId++;
      var cId = nextId++;
      pageRefs.push(pId + " 0 R");
      var streamLines = ["BT", "/F1 9 Tf", "14 TL", "48 760 Td"];
      var pl = pages[pi];
      for (var li = 0; li < pl.length; li++) {
        streamLines.push("(" + pdfEsc(pl[li]) + ") Tj");
        if (li + 1 < pl.length) streamLines.push("T*");
      }
      streamLines.push("ET");
      var streamStr = streamLines.join("\n");
      pageObjs.push(pId + " 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents " + cId + " 0 R >>\nendobj\n");
      pageObjs.push(cId + " 0 obj\n<< /Length " + streamStr.length + " >>\nstream\n" + streamStr + "\nendstream\nendobj\n");
    }
    objs.push("2 0 obj\n<< /Type /Pages /Kids [" + pageRefs.join(" ") + "] /Count " + pages.length + " >>\nendobj\n");
    objs.push("3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
    for (var oi = 0; oi < pageObjs.length; oi++) objs.push(pageObjs[oi]);

    var pdf = "%PDF-1.4\n";
    var offsets = [0];
    for (var k = 0; k < objs.length; k++) {
      offsets.push(pdf.length);
      pdf += objs[k];
    }
    var xrefOff = pdf.length;
    pdf += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n";
    for (var x = 1; x < offsets.length; x++) {
      var offStr = String(offsets[x]);
      while (offStr.length < 10) offStr = "0" + offStr;
      pdf += offStr + " 00000 n \n";
    }
    pdf += "trailer\n<< /Size " + (objs.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefOff + "\n%%EOF\n";
    return new Uint8Array(utf8Bytes(pdf));
  }

  function buildSubmissionPackageFiles(state) {
    state = state || {};
    var tp = state.titlePage || {};
    var jr = state.journal || {};
    var decl = state.declarations || {};
    var sections = state.sections || [];
    var refs = state.references || [];
    var tables = state.tables || [];
    var cl = state.checklistPrefill || {};
    var aiProv = state.aiProvenance || {};
    var coverText = state.coverLetterText || buildCoverLetter(state);

    var manuscriptBytes = buildManuscriptDocxBytes({
      title: tp.title || state.title,
      sections: sections,
      references: refs,
      declarations: decl,
      journal: jr,
      aiProvenance: aiProv
    });
    var titlePageBytes = buildTitlePageDocxBytes({
      titlePage: tp,
      declarations: decl,
      aiProvenance: aiProv
    });
    var coverBytes = buildCoverLetterDocxBytes({ coverLetterText: coverText });
    var tablesBytes = buildTablesDocxBytes({ tables: tables });
    var checklistBytes = buildChecklistDocxBytes({ checklistPrefill: cl });
    var checklistPdfBytes = buildChecklistPdfBytes({ checklistPrefill: cl });
    var risText = buildReferencesRis(refs);
    var manifestLines = [
      "StewardMD ResearchMD Submission Package",
      "Title: " + (tp.title || ""),
      "Target Journal: " + (jr.name || ""),
      "Approved: " + (state.approved ? ("Yes (" + (state.approvedAt || "") + ")") : "No"),
      "Files:",
      "1. 01-title-page.docx",
      "2. 02-manuscript.docx",
      "3. 03-tables.docx",
      "4. 04-cover-letter.docx",
      "5. 05-reporting-checklist.docx",
      "6. 05-reporting-checklist.pdf",
      "7. 06-references.ris"
    ];

    var entries = [
      { name: "01-title-page.docx", data: Array.prototype.slice.call(titlePageBytes), mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      { name: "02-manuscript.docx", data: Array.prototype.slice.call(manuscriptBytes), mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      { name: "03-tables.docx", data: Array.prototype.slice.call(tablesBytes), mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      { name: "04-cover-letter.docx", data: Array.prototype.slice.call(coverBytes), mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      { name: "05-reporting-checklist.docx", data: Array.prototype.slice.call(checklistBytes), mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      { name: "05-reporting-checklist.pdf", data: Array.prototype.slice.call(checklistPdfBytes), mime: "application/pdf" },
      { name: "06-references.ris", data: utf8Bytes(risText), mime: "application/x-research-info-systems" },
      { name: "submission-manifest.txt", data: utf8Bytes(manifestLines.join("\n") + "\n"), mime: "text/plain" }
    ];
    var zipBytes = getZipStore()(entries);
    return {
      files: entries,
      zipBytes: zipBytes,
      risText: risText
    };
  }

  var API = {
    name: NAME,
    version: VERSION,
    MT_PER_INR: MT_PER_INR,
    STEP_ORDER: STEP_ORDER,
    FALLBACK_JOURNALS: FALLBACK_JOURNALS,
    inferSpecialty: inferSpecialty,
    normJournalEntry: normJournalEntry,
    rankTargetJournals: rankTargetJournals,
    extractTableContent: extractTableContent,
    buildTableGrids: buildTableGrids,
    tableGridFor: tableGridFor,
    condenseTables: condenseTables,
    parseStructuredBibEntry: parseStructuredBibEntry,
    extractCitationsFromText: extractCitationsFromText,
    formatJournalReference: formatJournalReference,
    buildJournalReferences: buildJournalReferences,
    refMatchesCandidate: refMatchesCandidate,
    verifySingleReference: verifySingleReference,
    verifyReferencesOnline: verifyReferencesOnline,
    buildShortTitle: buildShortTitle,
    buildTitlePage: buildTitlePage,
    extractKeywordCandidates: extractKeywordCandidates,
    verifyKeywordsMesh: verifyKeywordsMesh,
    extractThesisClues: extractThesisClues,
    buildAiDisclosure: buildAiDisclosure,
    buildDeclarationsAndCredit: buildDeclarationsAndCredit,
    checklistIdForPaperType: checklistIdForPaperType,
    prefillChecklist: prefillChecklist,
    runFormatCheck: runFormatCheck,
    buildCoverLetter: buildCoverLetter,
    buildChecklistPdfBytes: buildChecklistPdfBytes,
    estimateAutoCost: estimateAutoCost,
    estimateCallInr: estimateCallInr,
    buildManuscriptDocxBytes: buildManuscriptDocxBytes,
    buildTitlePageDocxBytes: buildTitlePageDocxBytes,
    buildCoverLetterDocxBytes: buildCoverLetterDocxBytes,
    buildTablesDocxBytes: buildTablesDocxBytes,
    buildChecklistDocxBytes: buildChecklistDocxBytes,
    buildReferencesRis: buildReferencesRis,
    buildSubmissionPackageFiles: buildSubmissionPackageFiles,
    zipStore: localZipStore
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.SMD_RESEARCH_THESIS_AUTO = API;
})(typeof window !== "undefined" ? window : globalThis);
