/* StewardMD - ResearchMD checklist auto-fill (window.SMD_RESEARCH_CHECKLIST).
 * Phase 5B.1 and 5B.2. Pure ES5 IIFE: no DOM, no clock, no random source, no I/O.
 * Dual export: browser global SMD_RESEARCH_CHECKLIST and CommonJS module.exports.
 *
 * fill(checklist, snapshot) walks sections[].items[] (num or number, topic,
 * text, projectField) and returns one row per item:
 *   status   auto | partial | manual | missing
 *   filled   text taken only from the snapshot (never invented)
 *   evidence short factual lines
 *   pointer  { section, paragraph } into the manuscript, paragraph 0-based,
 *            or null when no paragraph matches
 *
 * projectField is one of: protocol, search, screening, prisma, extraction,
 * rob, analysis, grade, manuscript, manual.
 *
 * manual items stay manual. A researcher entry in snapshot.manual[num]
 * (or snapshot.checklistManual[checklistId][num]) is copied into filled.
 *
 * PRISMA 2020 (checklist.id prisma2020, or a name containing both "PRISMA"
 * and "2020") uses a per-item filler. Every other guideline uses the coarser
 * projectField filler on the same snapshot.
 *
 * Snapshot (all keys optional; unknown shapes are ignored, not guessed):
 *   protocol: question, objectives, rationale, title,
 *     eligibility { include, exclude, grouping } or strings,
 *     outcomes[{ name, measure, timepoint }], otherVariables[],
 *     registration { name, number } or { notRegistered: true },
 *     access (url string or { url } or { none: true }),
 *     amendments (string, list, or { none: true })
 *   searches[{ database|source, query|strategy, lastSearchDate|dateTo,
 *     resultCount, filters }]
 *   screening { reviewers, independent, automation, recordsScreened }
 *   prisma: PRISMA 2020 counts (camelCase or snake_case) and excludedByReason
 *   excludedStudies[{ citation, reason }]
 *   extractions[{ citation, verified, characteristics, effect }]
 *   extractionProcess { reviewers, independent, automation }
 *   rob[{ citation, tool, overall }]
 *   robProcess { reviewers, independent, tool }
 *   runs[{ measure, model, software, effect, ciLower, ciUpper, i2, tau2, q,
 *     preparation, display, subgroup, sensitivity, reportingBias }]
 *   grade[{ outcome, certainty, method }]
 *   declarations { funding, conflicts, dataAvailability }
 *   manuscript.sections[{ heading, paragraphs[] | text }]
 *   manual { "<item num>": "researcher text" }
 *
 * Counts are joined with commas and the word "to". This file never writes
 * an em-dash or an en-dash.
 */
(function (G) {
  "use strict";

  var VERSION = "rmd1";
  var NAME = "research-checklist";
  var FIELDS = {
    protocol: 1, search: 1, screening: 1, prisma: 1, extraction: 1,
    rob: 1, analysis: 1, grade: 1, manuscript: 1, manual: 1
  };
  var STOP = {
    the: 1, and: 1, for: 1, with: 1, that: 1, this: 1, from: 1, into: 1,
    were: 1, was: 1, are: 1, not: 1, have: 1, has: 1, been: 1,
    study: 1, studies: 1, review: 1, using: 1, used: 1, each: 1, than: 1,
    when: 1, what: 1, which: 1, their: 1, there: 1, about: 1, after: 1
  };
  var FIELD_HINTS = {
    protocol: ["eligibility", "objective", "protocol", "registration"],
    search: ["search strategy", "information source", "database"],
    screening: ["study selection", "screening"],
    prisma: ["flow diagram", "prisma", "study selection"],
    extraction: ["characteristic", "data collection"],
    rob: ["risk of bias"],
    analysis: ["meta-analysis", "heterogeneity", "forest plot"],
    grade: ["certainty of evidence", "summary of findings", "grade"],
    manuscript: [],
    manual: []
  };
  var CORE_COUNTS = [
    ["recordsIdentified", "Records identified"],
    ["recordsScreened", "Records screened"],
    ["recordsExcluded", "Records excluded"],
    ["reportsSought", "Reports sought"],
    ["reportsAssessed", "Reports assessed"],
    ["reportsExcluded", "Reports excluded"],
    ["studiesIncluded", "Studies included"]
  ];
  var EXTRA_COUNTS = [
    ["recordsFromDatabases", "Records from databases"],
    ["recordsFromOtherSources", "Records from other sources"],
    ["recordsDuplicatesRemoved", "Duplicates removed"],
    ["reportsNotRetrieved", "Reports not retrieved"]
  ];

  function isNum(n) { return typeof n === "number" && isFinite(n); }

  function isArr(v) { return Object.prototype.toString.call(v) === "[object Array]"; }

  function own(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  }

  function trim(s) {
    return s == null ? "" : String(s).replace(/^\s+|\s+$/g, "");
  }

  function low(s) { return trim(s).toLowerCase(); }

  function numText(n) {
    if (!isNum(n)) return "";
    if (n === Math.round(n)) return String(Math.round(n));
    return String(Math.round(n * 1000) / 1000);
  }

  function textOf(v) {
    var i, parts, piece;
    if (v == null || typeof v === "boolean") return "";
    if (isNum(v)) return numText(v);
    if (isArr(v)) {
      parts = [];
      for (i = 0; i < v.length; i++) {
        piece = textOf(v[i]);
        if (piece) parts.push(piece);
      }
      return parts.join("; ");
    }
    if (typeof v === "object") return "";
    return trim(v);
  }

  function firstText() {
    var i, t;
    for (i = 0; i < arguments.length; i++) {
      t = textOf(arguments[i]);
      if (t) return t;
    }
    return "";
  }

  function joinParts(parts) {
    var out = [], i;
    for (i = 0; i < parts.length; i++) if (parts[i]) out.push(parts[i]);
    return out.join(" ");
  }

  function pack(status, filled, evidence, pointer) {
    return {
      status: status,
      filled: filled || "",
      evidence: evidence || [],
      /* 3-arg pack means "pointer not decided yet". An explicit null stays null. */
      pointer: arguments.length < 4 ? undefined : pointer
    };
  }

  function fromBits(bits) {
    var ok = 0, lines = [], gaps = [], i;
    for (i = 0; i < bits.length; i++) {
      if (bits[i].ok) {
        ok++;
        if (bits[i].line) lines.push(bits[i].line);
      } else if (bits[i].gap) gaps.push(bits[i].gap);
    }
    return pack(ok === 0 ? "missing" : (ok === bits.length ? "auto" : "partial"), joinParts(lines), lines.concat(gaps));
  }

  function pick(obj, keys) {
    var i;
    if (!obj) return undefined;
    for (i = 0; i < keys.length; i++) {
      if (obj[keys[i]] != null && obj[keys[i]] !== "") return obj[keys[i]];
    }
    return undefined;
  }

  function asArray(v) {
    if (!v) return [];
    if (isArr(v)) return v;
    if (isArr(v.runs)) return v.runs;
    if (isArr(v.items)) return v.items;
    if (isArr(v.searches)) return v.searches;
    if (isArr(v.rows)) return v.rows;
    return [];
  }

  function boolBit(v) { return typeof v === "boolean"; }

  function yesNo(v) { return v ? "yes" : "no"; }

  function normKey(s) { return low(s).replace(/[^a-z0-9]+/g, " ").replace(/^\s+|\s+$/g, ""); }

  function paragraphsOf(section) {
    var raw, chunks, out, i, t;
    if (!section) return [];
    if (isArr(section.paragraphs)) raw = section.paragraphs;
    else if (section.text != null) raw = String(section.text).split(/\n\s*\n/);
    else if (section.body != null) raw = String(section.body).split(/\n\s*\n/);
    else raw = [];
    out = [];
    for (i = 0; i < raw.length; i++) {
      t = trim(raw[i]);
      if (t) out.push(t);
    }
    chunks = out;
    return chunks;
  }

  function unwrapProtocol(snapshot) {
    var raw = snapshot.protocol || snapshot.protocolContent || null;
    var content, elig, reg, access, amendments, present;
    present = !!raw;
    if (raw && raw.content && typeof raw.content === "object") content = raw.content;
    else content = raw || {};
    elig = content.eligibility || content.eligibilityCriteria || {};
    if (typeof elig === "string") elig = { include: elig };
    reg = content.registration || {};
    if (typeof reg === "string") reg = { name: reg };
    access = content.access != null ? content.access : (content.protocolUrl || content.protocolURL || "");
    amendments = own(content, "amendments") ? content.amendments : (raw && own(raw, "amendments") ? raw.amendments : undefined);
    return {
      present: present,
      title: firstText(content.title, raw && raw.title, snapshot.title, snapshot.project && snapshot.project.title),
      question: firstText(content.question, content.researchQuestion, content.objectives && content.objectives.question),
      objectives: firstText(content.objectives, content.objective, content.aim),
      rationale: firstText(content.rationale, content.background),
      eligibilityInclude: firstText(elig.include, elig.inclusion, elig.inclusionCriteria, content.inclusion),
      eligibilityExclude: firstText(elig.exclude, elig.exclusion, elig.exclusionCriteria, content.exclusion),
      grouping: firstText(elig.grouping, elig.groups, content.grouping, content.synthesisGroups, content.groups),
      outcomes: asArray(content.outcomes || content.outcomeList),
      otherVariables: asArray(content.otherVariables || content.variables || content.extractedVariables),
      registrationName: firstText(reg.name, reg.registry),
      registrationNumber: firstText(reg.number, reg.id, reg.registrationNumber),
      notRegistered: reg.notRegistered === true || content.notRegistered === true,
      registrationSeen: content.registration != null || content.notRegistered != null,
      protocolAccess: (access && typeof access === "object") ? firstText(access.url, access.href) : textOf(access),
      noProtocol: !!(access && typeof access === "object" && access.none === true) || content.noProtocol === true,
      accessSeen: content.access != null || content.protocolUrl != null || content.noProtocol === true,
      amendments: amendments,
      amendmentKnown: amendments !== undefined
    };
  }

  function oneSearch(row) {
    row = row || {};
    return {
      database: firstText(row.database, row.source, row.name, row.db),
      query: firstText(row.query, row.strategy, row.searchStrategy),
      lastSearchDate: firstText(row.lastSearchDate, row.searchedAt, row.dateTo, row.date),
      resultCount: isNum(row.resultCount) ? row.resultCount : (isNum(row.count) ? row.count : (isNum(row.records) ? row.records : null)),
      filters: firstText(row.filters, row.limits)
    };
  }

  function oneOutcome(row) {
    if (typeof row === "string") return { name: trim(row), measure: "", timepoint: "" };
    row = row || {};
    return {
      name: firstText(row.name, row.outcome, row.label),
      measure: firstText(row.measure, row.effectMeasure),
      timepoint: firstText(row.timepoint, row.timePoint, row.time)
    };
  }

  function oneEffect(row) {
    var effect = row && row.effect;
    if (isNum(effect)) return { estimate: effect, ciLower: row.ciLower, ciUpper: row.ciUpper };
    effect = effect || {};
    return {
      estimate: isNum(effect.estimate) ? effect.estimate : (isNum(effect.effect) ? effect.effect : null),
      ciLower: isNum(effect.ciLower) ? effect.ciLower : (isNum(effect.lower) ? effect.lower : null),
      ciUpper: isNum(effect.ciUpper) ? effect.ciUpper : (isNum(effect.upper) ? effect.upper : null)
    };
  }

  function oneRun(row) {
    row = row || {};
    return {
      measure: firstText(row.measure),
      model: firstText(row.model, row.method),
      software: firstText(row.software, row.engine, row.package),
      effect: isNum(row.effect) ? row.effect : (row.pooled && isNum(row.pooled.effect) ? row.pooled.effect : null),
      ciLower: isNum(row.ciLower) ? row.ciLower : (row.pooled && isNum(row.pooled.ciLower) ? row.pooled.ciLower : null),
      ciUpper: isNum(row.ciUpper) ? row.ciUpper : (row.pooled && isNum(row.pooled.ciUpper) ? row.pooled.ciUpper : null),
      i2: isNum(row.i2) ? row.i2 : (isNum(row.I2) ? row.I2 : null),
      tau2: isNum(row.tau2) ? row.tau2 : null,
      q: isNum(row.q) ? row.q : (isNum(row.Q) ? row.Q : null),
      preparation: firstText(row.preparation, row.conversions),
      display: firstText(row.display, row.tabulation, row.plot),
      subgroup: row.subgroup || null,
      sensitivity: row.sensitivity || null,
      reportingBias: row.reportingBias || row.publicationBias || null,
      studies: asArray(row.studies)
    };
  }

  function blockText(block, which) {
    if (!block) return "";
    if (typeof block === "string") return which === "method" ? "" : trim(block);
    if (which === "method") return firstText(block.method, block.approach);
    return firstText(block.result, block.results, block.summary);
  }

  function normalize(snapshot, checklist) {
    var s = snapshot || {};
    var proto = unwrapProtocol(s);
    var prisma = s.prisma || {};
    var screening = s.screening || s.screeningCounts || {};
    var searches = asArray(s.searches || s.searchRuns || s.search);
    var extractions = asArray(s.extractions);
    var rob = asArray(s.rob || s.robAssessments);
    var runs = asArray(s.runs || s.analyses);
    var grade = asArray(s.grade || s.grades);
    var ms = s.manuscript;
    var sections = [];
    var rawSections, i, sec, paras, heading;
    var decl = s.declarations || {};
    var manual = {};
    var bag, key, nested;
    if (isArr(ms)) rawSections = ms;
    else rawSections = (ms && (ms.sections || ms.headings)) || [];
    for (i = 0; i < rawSections.length; i++) {
      sec = rawSections[i] || {};
      heading = firstText(sec.heading, sec.title, sec.name) || ("Section " + (i + 1));
      paras = paragraphsOf(sec);
      if (paras.length) sections.push({ heading: heading, paragraphs: paras });
    }
    if (s.manual && typeof s.manual === "object") {
      for (key in s.manual) if (own(s.manual, key) && textOf(s.manual[key])) manual[key] = textOf(s.manual[key]);
    }
    nested = s.checklistManual && checklist && s.checklistManual[checklist.id];
    if (nested && typeof nested === "object") {
      for (key in nested) if (own(nested, key) && textOf(nested[key])) manual[key] = textOf(nested[key]);
    }
    bag = {
      projectTitle: proto.title,
      protocolPresent: proto.present,
      question: proto.question,
      objectives: typeof proto.objectives === "string" ? proto.objectives : textOf(proto.objectives),
      rationale: proto.rationale,
      eligibilityInclude: proto.eligibilityInclude,
      eligibilityExclude: proto.eligibilityExclude,
      grouping: proto.grouping,
      outcomes: [],
      otherVariables: [],
      registrationName: proto.registrationName,
      registrationNumber: proto.registrationNumber,
      notRegistered: proto.notRegistered,
      registrationSeen: proto.registrationSeen,
      protocolAccess: proto.protocolAccess,
      noProtocol: proto.noProtocol,
      accessSeen: proto.accessSeen,
      amendmentKnown: proto.amendmentKnown,
      noAmendments: false,
      amendmentText: "",
      searches: [],
      reviewers: isNum(screening.reviewers) ? screening.reviewers : (isNum(screening.reviewerCount) ? screening.reviewerCount : null),
      independent: boolBit(screening.independent) ? screening.independent : null,
      automation: firstText(screening.automation, screening.tools),
      recordsScreened: isNum(screening.recordsScreened) ? screening.recordsScreened : null,
      prisma: {},
      prismaPresent: !!s.prisma,
      excludedByReason: asArray(prisma.excludedByReason || prisma.excluded_by_reason),
      excludedStudies: asArray(s.excludedStudies || screening.excludedStudies || prisma.excludedStudies),
      extractions: [],
      extractionReviewers: null,
      extractionIndependent: null,
      extractionAutomation: "",
      rob: [],
      robReviewers: null,
      robIndependent: null,
      robTool: "",
      runs: [],
      grade: [],
      declarations: {
        funding: textOf(decl.funding || decl.support),
        conflicts: textOf(decl.conflicts || decl.competingInterests || decl.competing),
        dataAvailability: textOf(decl.dataAvailability || decl.data || decl.availability)
      },
      manuscript: sections,
      manual: manual
    };
    if (proto.objectives && typeof proto.objectives !== "string") bag.objectives = textOf(proto.objectives);
    for (i = 0; i < proto.outcomes.length; i++) bag.outcomes.push(oneOutcome(proto.outcomes[i]));
    for (i = 0; i < proto.otherVariables.length; i++) {
      key = textOf(proto.otherVariables[i]);
      if (!key && proto.otherVariables[i] && proto.otherVariables[i].name) key = textOf(proto.otherVariables[i].name);
      if (key) bag.otherVariables.push(key);
    }
    if (proto.noAmendments || (proto.amendments && typeof proto.amendments === "object" && !isArr(proto.amendments) && proto.amendments.none === true)) {
      bag.noAmendments = true;
    } else {
      bag.amendmentText = textOf(proto.amendments);
    }
    for (i = 0; i < searches.length; i++) bag.searches.push(oneSearch(searches[i]));
    for (i = 0; i < CORE_COUNTS.length; i++) bag.prisma[CORE_COUNTS[i][0]] = countOf(prisma, CORE_COUNTS[i][0]);
    for (i = 0; i < EXTRA_COUNTS.length; i++) bag.prisma[EXTRA_COUNTS[i][0]] = countOf(prisma, EXTRA_COUNTS[i][0]);
    if (bag.recordsScreened == null && isNum(bag.prisma.recordsScreened)) bag.recordsScreened = bag.prisma.recordsScreened;
    for (i = 0; i < extractions.length; i++) bag.extractions.push(oneExtraction(extractions[i]));
    if (s.extractionProcess) {
      bag.extractionReviewers = isNum(s.extractionProcess.reviewers) ? s.extractionProcess.reviewers : null;
      bag.extractionIndependent = boolBit(s.extractionProcess.independent) ? s.extractionProcess.independent : null;
      bag.extractionAutomation = firstText(s.extractionProcess.automation);
    }
    for (i = 0; i < rob.length; i++) bag.rob.push(oneRob(rob[i]));
    if (s.robProcess) {
      bag.robReviewers = isNum(s.robProcess.reviewers) ? s.robProcess.reviewers : null;
      bag.robIndependent = boolBit(s.robProcess.independent) ? s.robProcess.independent : null;
      bag.robTool = firstText(s.robProcess.tool);
    }
    for (i = 0; i < runs.length; i++) bag.runs.push(oneRun(runs[i]));
    for (i = 0; i < grade.length; i++) {
      bag.grade.push({
        outcome: firstText(grade[i].outcome, grade[i].name),
        certainty: firstText(grade[i].certainty, grade[i].level),
        method: firstText(grade[i].method, s.gradeMethod)
      });
    }
    if (!bag.robTool && bag.rob.length) bag.robTool = bag.rob[0].tool;
    return bag;
  }

  function countOf(prisma, camel) {
    var snake = camel.replace(/[A-Z]/g, function (ch) { return "_" + ch.toLowerCase(); });
    var v = pick(prisma, [camel, snake]);
    return isNum(v) ? v : null;
  }

  function oneExtraction(row) {
    var chars = row && row.characteristics;
    var keys = [], k;
    if (chars && typeof chars === "object" && !isArr(chars)) {
      for (k in chars) if (own(chars, k)) keys.push(k);
    }
    return {
      citation: firstText(row && (row.citation || row.label || row.study || row.id)),
      verified: !!(row && (row.verified === true || row.status === "verified")),
      characteristics: keys,
      effect: oneEffect(row || {})
    };
  }

  function oneRob(row) {
    row = row || {};
    return {
      citation: firstText(row.citation, row.study, row.studyId, row.id),
      tool: firstText(row.tool),
      overall: firstText(row.overall, row.judgment)
    };
  }

  function isPrismaChecklist(checklist) {
    var id = low(checklist && checklist.id);
    var name = low(checklist && checklist.name);
    if (id === "prisma2020" || id === "prisma-2020" || id === "prisma_2020") return true;
    return name.indexOf("prisma") !== -1 && name.indexOf("2020") !== -1;
  }

  function findHeading(view, needles) {
    var i, j, h;
    for (i = 0; i < view.manuscript.length; i++) {
      h = low(view.manuscript[i].heading);
      for (j = 0; j < needles.length; j++) {
        if (h.indexOf(needles[j]) !== -1) return { section: view.manuscript[i], index: i };
      }
    }
    return null;
  }

  function findPara(section, needles) {
    var i, j, text;
    if (!section) return -1;
    for (i = 0; i < section.paragraphs.length; i++) {
      text = low(section.paragraphs[i]);
      for (j = 0; j < needles.length; j++) {
        if (text.indexOf(needles[j]) !== -1) return i;
      }
    }
    return -1;
  }

  function ptr(found, paragraph) {
    if (!found) return null;
    return { section: found.section.heading, paragraph: paragraph };
  }

  function paragraphAt(view, pointer) {
    var i, sec;
    if (!pointer) return "";
    for (i = 0; i < view.manuscript.length; i++) {
      sec = view.manuscript[i];
      if (sec.heading === pointer.section && sec.paragraphs[pointer.paragraph]) return sec.paragraphs[pointer.paragraph];
    }
    return "";
  }

  function tokensOf(text) {
    var parts = low(text).split(/[^a-z0-9]+/);
    var out = [], seen = {}, i;
    for (i = 0; i < parts.length; i++) {
      if (parts[i].length >= 6 && !STOP[parts[i]] && !seen[parts[i]]) {
        seen[parts[i]] = 1;
        out.push(parts[i]);
        if (out.length >= 24) break;
      }
    }
    return out;
  }

  function scorePointer(view, item, packed) {
    var hints = FIELD_HINTS[item.projectField] || [];
    var topic = normKey(item.topic);
    var topicWords = topic.split(" ");
    var evidence = tokensOf((packed.filled || "") + " " + (packed.evidence || []).join(" "));
    var best = null, bestScore = 0;
    var si, pi, sec, para, score, h, i, blob, hits;
    for (si = 0; si < view.manuscript.length; si++) {
      sec = view.manuscript[si];
      h = normKey(sec.heading);
      for (pi = 0; pi < sec.paragraphs.length; pi++) {
        para = low(sec.paragraphs[pi]);
        score = 0;
        if (topic && h === topic) score += 10;
        for (i = 0; i < hints.length; i++) {
          if (h.indexOf(hints[i]) !== -1) score += 4;
          if (para.indexOf(hints[i]) !== -1) score += 5;
        }
        for (i = 0; i < topicWords.length; i++) {
          if (topicWords[i].length >= 5 && h.indexOf(topicWords[i]) !== -1) score += 3;
        }
        if (item.num && (para.indexOf("item " + low(item.num)) !== -1 || para.indexOf("checklist " + low(item.num)) !== -1)) score += 12;
        hits = 0;
        for (i = 0; i < evidence.length; i++) {
          if (para.indexOf(evidence[i]) !== -1) hits += 2;
        }
        if (hits > 6) hits = 6;
        score += hits;
        blob = score;
        if (blob > bestScore) {
          bestScore = blob;
          best = { section: sec.heading, paragraph: pi };
        }
      }
    }
    return bestScore >= 8 ? best : null;
  }

  function manualText(view, num) {
    if (own(view.manual, num)) return view.manual[num];
    return "";
  }

  /* ---- PRISMA 2020 item fillers ---------------------------------------- */

  function fillTitle(view) {
    var found = findHeading(view, ["title"]);
    var phrase = "systematic review";
    if (found) {
      var hit = findPara(found.section, [phrase]);
      if (hit >= 0) return pack("auto", found.section.paragraphs[hit], ["Title states systematic review."], ptr(found, hit));
      if (found.section.paragraphs.length) {
        return pack("partial", found.section.paragraphs[0], ["The title does not say systematic review."], ptr(found, 0));
      }
    }
    if (view.projectTitle && low(view.projectTitle).indexOf(phrase) !== -1) {
      return pack("partial", "", ["Project title: " + view.projectTitle + ". The manuscript title was not found."]);
    }
    return pack("missing", "", ["No manuscript title was found."]);
  }

  function fillAbstract(view) {
    var found = findHeading(view, ["abstract"]);
    var joined, lowJoined;
    if (!found) return pack("missing", "", ["No abstract section was found."]);
    joined = found.section.paragraphs.join(" ");
    lowJoined = low(joined);
    if (lowJoined.indexOf("method") !== -1 && lowJoined.indexOf("result") !== -1) {
      return pack("auto", joined, ["Abstract reports methods and results."], ptr(found, 0));
    }
    if (found.section.paragraphs.length) {
      return pack("partial", found.section.paragraphs[0], ["Abstract is present but methods and results are not both named."], ptr(found, 0));
    }
    return pack("missing", "", ["The abstract section is empty."]);
  }

  function fillRationale(view) {
    var found = findHeading(view, ["rationale", "introduction", "background"]);
    if (found && found.section.paragraphs.length) {
      return pack("auto", found.section.paragraphs[0], ["Introduction text is in the manuscript."], ptr(found, 0));
    }
    if (view.rationale) return pack("partial", view.rationale, ["Protocol rationale is stored. No introduction paragraph was found."]);
    return pack("missing", "", ["No rationale is stored."]);
  }

  function fillObjectives(view) {
    return fromBits([
      { ok: !!view.question, line: view.question ? ("Question: " + view.question) : "", gap: "The review question is not stored." },
      { ok: !!view.objectives, line: view.objectives ? ("Objectives: " + view.objectives) : "", gap: "The objectives are not stored." }
    ]);
  }

  function fillEligibility(view) {
    return fromBits([
      { ok: !!view.eligibilityInclude, line: view.eligibilityInclude ? ("Inclusion: " + view.eligibilityInclude + ".") : "", gap: "Inclusion criteria are not stored." },
      { ok: !!view.eligibilityExclude, line: view.eligibilityExclude ? ("Exclusion: " + view.eligibilityExclude + ".") : "", gap: "Exclusion criteria are not stored." },
      { ok: !!view.grouping, line: view.grouping ? ("Grouping for synthesis: " + view.grouping + ".") : "", gap: "Grouping for synthesis is not stored." }
    ]);
  }

  function fillSources(view) {
    var rows = view.searches, known = [], gaps = [], i, row, bits = 0, line;
    if (!rows.length) return pack("missing", "", ["No saved searches."]);
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      if (row.database && row.lastSearchDate) {
        bits++;
        line = row.database + ", last searched " + row.lastSearchDate;
        if (row.resultCount != null) line += ", " + numText(row.resultCount) + " records";
        known.push(line + ".");
      } else if (!row.database) gaps.push("Search " + (i + 1) + " has no database name.");
      else gaps.push(row.database + ": last search date not recorded.");
    }
    return pack(bits === rows.length ? "auto" : "partial", joinParts(known), known.concat(gaps));
  }

  function fillQueries(view) {
    var rows = view.searches, known = [], gaps = [], i, row, bits = 0, line;
    if (!rows.length) return pack("missing", "", ["No saved searches."]);
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      if (row.query) {
        bits++;
        line = (row.database || ("Search " + (i + 1))) + ": " + row.query;
        if (row.filters) line += " Filters: " + row.filters;
        known.push(line + ".");
      } else gaps.push((row.database || ("Search " + (i + 1))) + ": query not recorded.");
    }
    return pack(bits === rows.length ? "auto" : "partial", joinParts(known), known.concat(gaps));
  }

  function fillSelection(view) {
    var screened = view.recordsScreened;
    return fromBits([
      { ok: isNum(view.reviewers), line: isNum(view.reviewers) ? ("Reviewers: " + numText(view.reviewers) + ".") : "", gap: "Reviewer count is not stored." },
      { ok: view.independent !== null, line: view.independent === null ? "" : ("Independent screening: " + yesNo(view.independent) + "."), gap: "Independence of screening is not stored." },
      { ok: isNum(screened), line: isNum(screened) ? ("Records screened: " + numText(screened) + ".") : "", gap: "The screened-record count is not stored." }
    ]);
  }

  function fillExtractionProcess(view) {
    if (!view.extractions.length && view.extractionReviewers == null && view.extractionIndependent === null) {
      return pack("missing", "", ["No extraction record is stored."]);
    }
    return fromBits([
      { ok: isNum(view.extractionReviewers), line: isNum(view.extractionReviewers) ? ("Extractors: " + numText(view.extractionReviewers) + ".") : "", gap: "Extractor count is not stored." },
      { ok: view.extractionIndependent !== null, line: view.extractionIndependent === null ? "" : ("Independent extraction: " + yesNo(view.extractionIndependent) + "."), gap: "Independence of extraction is not stored." },
      { ok: view.extractions.length > 0, line: view.extractions.length ? (view.extractions.length + " extraction " + (view.extractions.length === 1 ? "record" : "records") + " stored.") : "", gap: "No extraction rows are stored." }
    ]);
  }

  function fillOutcomes(view) {
    var rows = view.outcomes, full = 0, lines = [], gaps = [], i, row;
    if (!rows.length) return pack("missing", "", ["No outcomes are stored on the protocol."]);
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      if (row.name && (row.measure || row.timepoint)) {
        full++;
        lines.push(row.name + (row.measure ? (", measure " + row.measure) : "") + (row.timepoint ? (", time " + row.timepoint) : "") + ".");
      } else if (row.name) gaps.push(row.name + ": measure or time point not stored.");
      else gaps.push("An outcome has no name.");
    }
    return pack(full === rows.length ? "auto" : (full ? "partial" : "partial"), joinParts(lines), lines.concat(gaps));
  }

  function fillOtherVariables(view) {
    var keys = [], i, seen = {}, k;
    if (view.otherVariables.length) {
      return pack("auto", "Other variables: " + view.otherVariables.join(", ") + ".", ["Other extracted variables are listed."]);
    }
    for (i = 0; i < view.extractions.length; i++) {
      for (k = 0; k < view.extractions[i].characteristics.length; k++) {
        if (!seen[view.extractions[i].characteristics[k]]) {
          seen[view.extractions[i].characteristics[k]] = 1;
          keys.push(view.extractions[i].characteristics[k]);
        }
      }
    }
    if (keys.length) return pack("partial", "", ["Characteristic fields seen: " + keys.join(", ") + ". A defined variable list was not stored."]);
    return pack("missing", "", ["No other extracted variables are stored."]);
  }

  function fillRobMethods(view) {
    if (!view.rob.length && !view.robTool && view.robReviewers == null) return pack("missing", "", ["No risk-of-bias method is stored."]);
    return fromBits([
      { ok: !!view.robTool, line: view.robTool ? ("Tool: " + view.robTool + ".") : "", gap: "The risk-of-bias tool is not stored." },
      { ok: isNum(view.robReviewers), line: isNum(view.robReviewers) ? ("Assessors: " + numText(view.robReviewers) + ".") : "", gap: "Assessor count is not stored." },
      { ok: view.robIndependent !== null, line: view.robIndependent === null ? "" : ("Independent assessment: " + yesNo(view.robIndependent) + "."), gap: "Independence of risk-of-bias assessment is not stored." }
    ]);
  }

  function fillMeasures(view) {
    var names = [], seen = {}, i, m;
    for (i = 0; i < view.outcomes.length; i++) {
      m = view.outcomes[i].measure;
      if (m && !seen[m]) { seen[m] = 1; names.push(m); }
    }
    for (i = 0; i < view.runs.length; i++) {
      m = view.runs[i].measure;
      if (m && !seen[m]) { seen[m] = 1; names.push(m); }
    }
    if (names.length) return pack("auto", "Effect measures: " + names.join(", ") + ".", ["Effect measures are stored."]);
    if (view.runs.length || view.outcomes.length) return pack("partial", "", ["Outcomes or runs are stored, but no effect measure is named."]);
    return pack("missing", "", ["No effect measure is stored."]);
  }

  function fillGrouping(view) {
    if (view.grouping) return pack("auto", "Grouping for synthesis: " + view.grouping + ".", ["Synthesis grouping is stored."]);
    if (view.eligibilityInclude || view.eligibilityExclude) return pack("partial", "", ["Eligibility is stored. Grouping for synthesis is not."]);
    return pack("missing", "", ["Grouping for synthesis is not stored."]);
  }

  function fillRunNote(view, key, label) {
    var lines = [], i, text;
    if (!view.runs.length) return pack("missing", "", ["No analysis run is stored."]);
    for (i = 0; i < view.runs.length; i++) {
      text = view.runs[i][key];
      if (text) lines.push(label + ": " + text);
    }
    if (lines.length === view.runs.length) return pack("auto", joinParts(lines), lines);
    if (lines.length) return pack("partial", joinParts(lines), lines.concat(["Some runs do not record " + label.toLowerCase() + "."]));
    return pack("partial", "", [label + " is not recorded on the saved runs."]);
  }

  function fillModel(view) {
    var lines = [], gaps = [], full = 0, i, r, line;
    if (!view.runs.length) return pack("missing", "", ["No analysis run is stored."]);
    for (i = 0; i < view.runs.length; i++) {
      r = view.runs[i];
      if (r.measure && r.model && r.software && (isNum(r.i2) || isNum(r.tau2) || isNum(r.q))) {
        full++;
        line = r.measure + ", model " + r.model + ", software " + r.software;
        if (isNum(r.i2)) line += ", I2 " + numText(r.i2);
        if (isNum(r.tau2)) line += ", tau2 " + numText(r.tau2);
        lines.push(line + ".");
      } else gaps.push("Run " + (i + 1) + " is missing the model, the software, or the heterogeneity figure.");
    }
    return pack(full === view.runs.length ? "auto" : "partial", joinParts(lines), lines.concat(gaps));
  }

  function fillPair(view, key, label, want) {
    var methods = [], results = [], i, block, method, result;
    for (i = 0; i < view.runs.length; i++) {
      block = view.runs[i][key];
      method = blockText(block, "method");
      result = blockText(block, "result");
      if (method) methods.push(label + " method: " + method + ".");
      if (result) results.push(label + " result: " + result);
    }
    if (want === "method") {
      if (methods.length) return pack("auto", joinParts(methods), methods);
      if (results.length) return pack("partial", "", [label + " results are stored, but the method is not."]);
      return pack("missing", "", ["No " + label.toLowerCase() + " method is stored."]);
    }
    if (results.length) return pack("auto", joinParts(results), results);
    if (methods.length) return pack("partial", "", [label + " method is stored, but the result is not."]);
    return pack("missing", "", ["No " + label.toLowerCase() + " result is stored."]);
  }

  function fillGradeMethod(view) {
    var i, lines = [];
    for (i = 0; i < view.grade.length; i++) if (view.grade[i].method) lines.push(view.grade[i].outcome ? (view.grade[i].outcome + ": " + view.grade[i].method + ".") : (view.grade[i].method + "."));
    if (lines.length) return pack("auto", joinParts(lines), ["Certainty method is stored."]);
    if (view.grade.length) return pack("partial", "", ["GRADE rows are stored, but the method is not named."]);
    return pack("missing", "", ["No certainty method is stored."]);
  }

  function fillPrismaCounts(view) {
    var lines = [], have = 0, miss = 0, i, key, label, val;
    if (!view.prismaPresent) return pack("missing", "", ["PRISMA counts are not stored."]);
    for (i = 0; i < CORE_COUNTS.length; i++) {
      key = CORE_COUNTS[i][0];
      label = CORE_COUNTS[i][1];
      val = view.prisma[key];
      if (isNum(val)) { have++; lines.push(label + ": " + numText(val) + "."); }
      else miss++;
    }
    for (i = 0; i < EXTRA_COUNTS.length; i++) {
      val = view.prisma[EXTRA_COUNTS[i][0]];
      if (isNum(val)) lines.push(EXTRA_COUNTS[i][1] + ": " + numText(val) + ".");
    }
    if (!have) return pack("missing", "", ["PRISMA counts are empty."]);
    return pack(miss === 0 ? "auto" : "partial", joinParts(lines), lines.concat(miss ? ["Some PRISMA boxes have no count."] : []));
  }

  function fillExcluded(view) {
    var rows = view.excludedStudies, cited = [], gaps = [], i, row, bits = [];
    for (i = 0; i < rows.length; i++) {
      row = rows[i] || {};
      if (textOf(row.citation) && textOf(row.reason)) cited.push(textOf(row.citation) + ": " + textOf(row.reason) + ".");
      else gaps.push("An excluded study is missing a citation or a reason.");
    }
    if (rows.length && cited.length === rows.length) return pack("auto", joinParts(cited), cited);
    if (cited.length) return pack("partial", joinParts(cited), cited.concat(gaps));
    for (i = 0; i < view.excludedByReason.length; i++) {
      row = view.excludedByReason[i] || {};
      bits.push((textOf(row.label) || textOf(row.reasonCode) || "Reason") + ": " + (isNum(row.count) ? numText(row.count) : "a count") + ".");
    }
    if (bits.length) return pack("partial", "", ["Exclusion reasons are counted, but the excluded studies are not cited."].concat(bits));
    return pack("missing", "", ["No full-text exclusions are recorded."]);
  }

  function fillCharacteristics(view) {
    var rows = view.extractions, ok = 0, lines = [], gaps = [], i, row;
    if (!rows.length) return pack("missing", "", ["No extractions are stored."]);
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      if (row.verified && row.citation && row.characteristics.length) {
        ok++;
        lines.push(row.citation + ": " + row.characteristics.join(", ") + ".");
      } else if (!row.verified) gaps.push((row.citation || ("Row " + (i + 1))) + " is not verified.");
      else gaps.push((row.citation || ("Row " + (i + 1))) + " has no characteristics.");
    }
    if (ok && ok === rows.length) return pack("auto", joinParts(lines), lines);
    if (ok) return pack("partial", joinParts(lines), lines.concat(gaps));
    return pack("partial", "", gaps);
  }

  function fillRobResults(view) {
    var need = [], have = {}, i, row, lines = [], gaps = [], covered = 0;
    for (i = 0; i < view.rob.length; i++) {
      row = view.rob[i];
      if (row.overall) {
        have[low(row.citation)] = 1;
        lines.push((row.citation || "Study") + ": " + row.overall + (row.tool ? (" (" + row.tool + ")") : "") + ".");
      }
    }
    for (i = 0; i < view.extractions.length; i++) {
      if (view.extractions[i].verified && view.extractions[i].citation) need.push(view.extractions[i].citation);
    }
    if (!lines.length && !need.length) return pack("missing", "", ["No risk-of-bias judgments are stored."]);
    if (!need.length && lines.length) return pack("auto", joinParts(lines), lines);
    for (i = 0; i < need.length; i++) {
      if (have[low(need[i])]) covered++;
      else gaps.push(need[i] + ": no risk-of-bias judgment.");
    }
    if (covered === need.length && lines.length) return pack("auto", joinParts(lines), lines);
    if (lines.length) return pack("partial", joinParts(lines), lines.concat(gaps));
    return pack("partial", "", gaps.length ? gaps : ["Risk-of-bias judgments are incomplete."]);
  }

  function effectLine(label, effect) {
    if (!effect || !isNum(effect.estimate) || !isNum(effect.ciLower) || !isNum(effect.ciUpper)) return "";
    return label + " estimate " + numText(effect.estimate) + ", CI " + numText(effect.ciLower) + " to " + numText(effect.ciUpper) + ".";
  }

  function fillStudyEffects(view) {
    var lines = [], gaps = [], i, row, line, seen = 0;
    for (i = 0; i < view.extractions.length; i++) {
      row = view.extractions[i];
      line = effectLine(row.citation || ("Study " + (i + 1)), row.effect);
      if (line && row.verified) { seen++; lines.push(line); }
      else if (row.verified) gaps.push((row.citation || ("Study " + (i + 1))) + ": study estimate or interval not stored.");
    }
    for (i = 0; i < view.runs.length && !lines.length; i++) {
      var studies = view.runs[i].studies, j, eff;
      for (j = 0; j < studies.length; j++) {
        eff = oneEffect(studies[j]);
        line = effectLine(firstText(studies[j].id, studies[j].citation) || ("Study " + (j + 1)), eff);
        if (line) lines.push(line);
      }
    }
    if (lines.length && !gaps.length) return pack("auto", joinParts(lines), lines);
    if (lines.length) return pack("partial", joinParts(lines), lines.concat(gaps));
    if (view.extractions.length || view.runs.length) return pack("partial", "", gaps.length ? gaps : ["Study-level estimates are not stored."]);
    return pack("missing", "", ["No study-level results are stored."]);
  }

  function fillSynthesisContext(view) {
    var hasChar = false, hasRob = false, i;
    for (i = 0; i < view.extractions.length; i++) if (view.extractions[i].characteristics.length) hasChar = true;
    for (i = 0; i < view.rob.length; i++) if (view.rob[i].overall) hasRob = true;
    if (hasChar && hasRob) return pack("auto", "Verified characteristics and risk-of-bias judgments are both stored.", ["Characteristics and risk of bias are both stored."]);
    if (hasChar || hasRob) return pack("partial", "", [hasChar ? "Characteristics are stored. Risk of bias across the synthesis is not." : "Risk of bias is stored. Study characteristics are not."]);
    return pack("missing", "", ["Neither characteristics nor risk of bias is stored."]);
  }

  function fillPooled(view) {
    var lines = [], gaps = [], full = 0, i, r, line;
    if (!view.runs.length) return pack("missing", "", ["No analysis run is stored."]);
    for (i = 0; i < view.runs.length; i++) {
      r = view.runs[i];
      if (isNum(r.effect) && isNum(r.ciLower) && isNum(r.ciUpper)) {
        line = (r.measure || "Effect") + " estimate " + numText(r.effect) + ", CI " + numText(r.ciLower) + " to " + numText(r.ciUpper);
        if (isNum(r.i2) || isNum(r.tau2) || isNum(r.q)) {
          full++;
          if (isNum(r.i2)) line += ", I2 " + numText(r.i2);
          if (isNum(r.tau2)) line += ", tau2 " + numText(r.tau2);
          if (isNum(r.q)) line += ", Q " + numText(r.q);
          lines.push(line + ".");
        } else gaps.push(line + ". Heterogeneity was not stored.");
      } else gaps.push("Run " + (i + 1) + " has no estimate with a confidence interval.");
    }
    if (full === view.runs.length) return pack("auto", joinParts(lines), lines);
    if (full || lines.length) return pack("partial", joinParts(lines), lines.concat(gaps));
    return pack(view.runs.length ? "partial" : "missing", "", gaps.length ? gaps : ["No pooled estimate is stored."]);
  }

  function fillGradeResults(view) {
    var full = 0, lines = [], gaps = [], i, g;
    if (!view.grade.length) return pack("missing", "", ["No GRADE assessment is stored."]);
    for (i = 0; i < view.grade.length; i++) {
      g = view.grade[i];
      if (g.outcome && g.certainty) { full++; lines.push(g.outcome + ": " + g.certainty + "."); }
      else gaps.push("A GRADE row is missing the outcome or the certainty.");
    }
    if (full === view.grade.length) return pack("auto", joinParts(lines), lines);
    if (full) return pack("partial", joinParts(lines), lines.concat(gaps));
    return pack("partial", "", gaps);
  }

  function fillDiscussion(view, needles, gap) {
    var found = findHeading(view, ["discussion"]);
    var hit;
    if (!found) return pack("missing", "", ["No discussion section was found."]);
    hit = findPara(found.section, needles);
    if (hit >= 0) return pack("auto", found.section.paragraphs[hit], ["Matched a discussion paragraph."], ptr(found, hit));
    return pack("partial", "", [gap], null);
  }

  function fillRegistration(view) {
    if (view.notRegistered) return pack("auto", "The review was not registered.", ["The snapshot says the review was not registered."]);
    if (view.registrationName && view.registrationNumber) {
      return pack("auto", view.registrationName + " " + view.registrationNumber + ".", ["Registration name and number are stored."]);
    }
    if (view.registrationName || view.registrationNumber) {
      return pack("partial", trim((view.registrationName || "") + " " + (view.registrationNumber || "")) + ".", ["Registration is incomplete."]);
    }
    return pack("missing", "", ["No registration is stored."]);
  }

  function fillAccess(view) {
    if (view.noProtocol) return pack("auto", "No protocol was prepared.", ["The snapshot says no protocol was prepared."]);
    if (view.protocolAccess) return pack("auto", "Protocol: " + view.protocolAccess + ".", ["A protocol location is stored."]);
    if (view.protocolPresent) return pack("partial", "", ["A protocol is stored, but where to read it is not."]);
    return pack("missing", "", ["No protocol location is stored."]);
  }

  function fillAmendments(view) {
    if (view.noAmendments) return pack("auto", "No amendments were made.", ["The snapshot says there were no amendments."]);
    if (view.amendmentText) return pack("auto", "Amendments: " + view.amendmentText + ".", ["Amendments are described."]);
    if (view.amendmentKnown) return pack("partial", "", ["The amendments field is present but empty."]);
    return pack("missing", "", ["Amendments are not described."]);
  }

  function fillDeclare(view, key, headings, label) {
    var text = view.declarations[key] || "";
    var found = findHeading(view, headings);
    if (text) return pack("auto", text, [label + " is stated."], found && found.section.paragraphs.length ? ptr(found, 0) : null);
    if (found && found.section.paragraphs.length) {
      return pack("auto", found.section.paragraphs[0], [label + " is in the manuscript."], ptr(found, 0));
    }
    return pack("missing", "", [label + " is not stated."]);
  }

  var PRISMA = {
    "1": function (v) { return fillTitle(v); },
    "2": function (v) { return fillAbstract(v); },
    "3": function (v) { return fillRationale(v); },
    "4": function (v) { return fillObjectives(v); },
    "5": function (v) { return fillEligibility(v); },
    "6": function (v) { return fillSources(v); },
    "7": function (v) { return fillQueries(v); },
    "8": function (v) { return fillSelection(v); },
    "9": function (v) { return fillExtractionProcess(v); },
    "10a": function (v) { return fillOutcomes(v); },
    "10b": function (v) { return fillOtherVariables(v); },
    "11": function (v) { return fillRobMethods(v); },
    "12": function (v) { return fillMeasures(v); },
    "13a": function (v) { return fillGrouping(v); },
    "13b": function (v) { return fillRunNote(v, "preparation", "Data preparation"); },
    "13c": function (v) { return fillRunNote(v, "display", "Display"); },
    "13d": function (v) { return fillModel(v); },
    "13e": function (v) { return fillPair(v, "subgroup", "Heterogeneity", "method"); },
    "13f": function (v) { return fillPair(v, "sensitivity", "Sensitivity", "method"); },
    "14": function (v) { return fillPair(v, "reportingBias", "Reporting bias", "method"); },
    "15": function (v) { return fillGradeMethod(v); },
    "16a": function (v) { return fillPrismaCounts(v); },
    "16b": function (v) { return fillExcluded(v); },
    "17": function (v) { return fillCharacteristics(v); },
    "18": function (v) { return fillRobResults(v); },
    "19": function (v) { return fillStudyEffects(v); },
    "20a": function (v) { return fillSynthesisContext(v); },
    "20b": function (v) { return fillPooled(v); },
    "20c": function (v) { return fillPair(v, "subgroup", "Heterogeneity", "result"); },
    "20d": function (v) { return fillPair(v, "sensitivity", "Sensitivity", "result"); },
    "21": function (v) { return fillPair(v, "reportingBias", "Reporting bias", "result"); },
    "22": function (v) { return fillGradeResults(v); },
    "23a": function (v) { return fillDiscussion(v, ["other evidence", "in the light of"], "Discussion is present. The comparison with other evidence was not located."); },
    "23b": function (v) { return fillDiscussion(v, ["limitations of the included", "limitations of the evidence"], "Discussion is present. Limitations of the included evidence were not located."); },
    "23c": function (v) { return fillDiscussion(v, ["limitations of the review", "limitations of our methods"], "Discussion is present. Limitations of the review methods were not located."); },
    "23d": function (v) { return fillDiscussion(v, ["future research", "implications for practice"], "Discussion is present. Implications were not located."); },
    "24a": function (v) { return fillRegistration(v); },
    "24b": function (v) { return fillAccess(v); },
    "24c": function (v) { return fillAmendments(v); },
    "25": function (v) { return fillDeclare(v, "funding", ["support", "funding"], "Support"); },
    "26": function (v) { return fillDeclare(v, "conflicts", ["competing", "conflict"], "Competing interests"); },
    "27": function (v) { return fillDeclare(v, "dataAvailability", ["availability", "data and code", "data availability"], "Data availability"); }
  };

  /* ---- coarser filler for every other guideline ------------------------ */

  function genericProtocol(view) {
    var lines = [];
    if (view.question) lines.push(view.question);
    if (view.objectives) lines.push(view.objectives);
    if (view.eligibilityInclude) lines.push("Inclusion: " + view.eligibilityInclude + ".");
    if (view.eligibilityExclude) lines.push("Exclusion: " + view.eligibilityExclude + ".");
    if (view.outcomes.length) lines.push("Outcomes listed: " + view.outcomes.length + ".");
    if (!view.protocolPresent && !lines.length) return pack("missing", "", ["No protocol is stored."]);
    if (!lines.length) return pack("partial", "", ["The protocol has no question, objectives, eligibility, or outcomes."]);
    return pack("auto", joinParts(lines), lines);
  }

  function genericSearch(view) {
    var lines = [], full = 0, i, row;
    if (!view.searches.length) return pack("missing", "", ["No saved searches."]);
    for (i = 0; i < view.searches.length; i++) {
      row = view.searches[i];
      if (row.database && row.query) {
        full++;
        lines.push(row.database + ": " + row.query + ".");
      }
    }
    if (full === view.searches.length) return pack("auto", joinParts(lines), lines);
    if (full) return pack("partial", joinParts(lines), lines.concat(["One or more searches are missing a database or a query."]));
    return pack("partial", "", ["Searches are stored without a database and a query."]);
  }

  function genericScreening(view) {
    if (isNum(view.reviewers) && isNum(view.recordsScreened)) {
      return pack("auto", "Reviewers: " + numText(view.reviewers) + ". Records screened: " + numText(view.recordsScreened) + ".", ["Screening counts are stored."]);
    }
    if (isNum(view.reviewers) || isNum(view.recordsScreened) || view.independent !== null) {
      return pack("partial", "", ["Screening is only partly recorded."]);
    }
    return pack("missing", "", ["No screening counts are stored."]);
  }

  function genericPrisma(view) {
    return fillPrismaCounts(view);
  }

  function genericExtraction(view) {
    var verified = 0, i;
    if (!view.extractions.length) return pack("missing", "", ["No extractions are stored."]);
    for (i = 0; i < view.extractions.length; i++) if (view.extractions[i].verified) verified++;
    if (verified) return pack("auto", verified + " verified extraction " + (verified === 1 ? "record." : "records."), ["Verified extractions are stored."]);
    return pack("partial", "", ["Extractions are stored, but none is verified."]);
  }

  function genericRob(view) {
    var n = 0, i;
    for (i = 0; i < view.rob.length; i++) if (view.rob[i].overall) n++;
    if (n) return pack("auto", n + " risk-of-bias " + (n === 1 ? "judgment" : "judgments") + " with an overall call.", ["Risk-of-bias judgments are stored."]);
    if (view.rob.length) return pack("partial", "", ["Risk-of-bias rows have no overall judgment."]);
    return pack("missing", "", ["No risk-of-bias judgment is stored."]);
  }

  function genericAnalysis(view) {
    var full = 0, i, r;
    if (!view.runs.length) return pack("missing", "", ["No analysis run is stored."]);
    for (i = 0; i < view.runs.length; i++) {
      r = view.runs[i];
      if (r.measure && isNum(r.effect)) full++;
    }
    if (full) return pack("auto", full + " run " + (full === 1 ? "record has" : "records have") + " a measure and an estimate.", ["Analysis runs are stored."]);
    return pack("partial", "", ["Analysis runs are stored without a measure and an estimate."]);
  }

  function genericGrade(view) {
    var full = 0, i;
    if (!view.grade.length) return pack("missing", "", ["No GRADE assessment is stored."]);
    for (i = 0; i < view.grade.length; i++) if (view.grade[i].outcome && view.grade[i].certainty) full++;
    if (full) return pack("auto", full + " GRADE " + (full === 1 ? "outcome is" : "outcomes are") + " rated.", ["GRADE ratings are stored."]);
    return pack("partial", "", ["GRADE rows are missing an outcome or a certainty."]);
  }

  function genericManuscript(view, item) {
    var pointer = scorePointer(view, item, pack("missing", "", []));
    var text;
    if (pointer) {
      text = paragraphAt(view, pointer);
      if (text) return pack("auto", text, ["Matched a manuscript paragraph."], pointer);
    }
    if (view.manuscript.length) return pack("partial", "", ["The manuscript has sections, but none matched this item."]);
    return pack("missing", "", ["No manuscript is stored."]);
  }

  var GENERIC = {
    protocol: genericProtocol,
    search: genericSearch,
    screening: genericScreening,
    prisma: genericPrisma,
    extraction: genericExtraction,
    rob: genericRob,
    analysis: genericAnalysis,
    grade: genericGrade,
    manuscript: genericManuscript
  };

  function eachItem(checklist, fn) {
    var sections = checklist.sections || [], si, items, ii, item, num;
    for (si = 0; si < sections.length; si++) {
      items = (sections[si] && sections[si].items) || [];
      for (ii = 0; ii < items.length; ii++) {
        item = items[ii] || {};
        num = item.num != null ? item.num : item.number;
        fn({
          num: num == null ? "" : String(num),
          topic: item.topic == null ? "" : String(item.topic),
          text: item.text == null ? "" : String(item.text),
          section: sections[si].title || sections[si].heading || "",
          projectField: item.projectField == null ? "" : String(item.projectField)
        });
      }
    }
  }

  function finish(view, item, packed) {
    var pointer = packed.pointer === undefined ? scorePointer(view, item, packed) : packed.pointer;
    var evidence = [], i;
    for (i = 0; i < (packed.evidence || []).length; i++) evidence.push(packed.evidence[i]);
    return {
      num: item.num,
      topic: item.topic,
      text: item.text,
      section: item.section,
      projectField: item.projectField,
      status: packed.status,
      filled: packed.filled || "",
      evidence: evidence,
      pointer: pointer
    };
  }

  function fillItem(view, checklist, item) {
    var entered, packed;
    if (item.projectField === "manual") {
      entered = manualText(view, item.num);
      return finish(view, item, pack("manual", entered, entered ? ["Researcher entry."] : ["Researcher entry is still open."]));
    }
    if (!FIELDS[item.projectField]) {
      return finish(view, item, pack("missing", "", ["This item is not mapped to a project field."]));
    }
    if (isPrismaChecklist(checklist) && PRISMA[item.num]) packed = PRISMA[item.num](view, item);
    else if (item.projectField === "manuscript") packed = genericManuscript(view, item);
    else packed = GENERIC[item.projectField](view);
    return finish(view, item, packed);
  }

  function fill(checklist, snapshot) {
    var view, items, counts;
    if (!checklist || typeof checklist !== "object") throw new Error("research: checklist is required");
    if (!isArr(checklist.sections)) throw new Error("research: checklist requires sections");
    if (snapshot != null && typeof snapshot !== "object") throw new Error("research: snapshot must be an object");
    view = normalize(snapshot || {}, checklist);
    items = [];
    counts = { auto: 0, partial: 0, manual: 0, missing: 0, total: 0 };
    eachItem(checklist, function (item) {
      var row = fillItem(view, checklist, item);
      items.push(row);
      counts[row.status] += 1;
      counts.total += 1;
    });
    return {
      checklistId: checklist.id || "",
      checklistName: checklist.name || "",
      version: checklist.version || "",
      source: checklist.source || "",
      licence: checklist.licence || "",
      items: items,
      counts: counts
    };
  }

  function csvCell(value) {
    var t = value == null ? "" : String(value);
    if (/[",\n\r]/.test(t)) return '"' + t.replace(/"/g, '""') + '"';
    return t;
  }

  function toCsv(filled) {
    var items = (filled && filled.items) || [];
    var lines = ["section,number,topic,status,item,filled,evidence,manuscript_section,paragraph,source,licence"];
    var i, it, ev, paragraph;
    for (i = 0; i < items.length; i++) {
      it = items[i];
      ev = (it.evidence || []).join(" | ");
      paragraph = it.pointer && it.pointer.paragraph != null ? it.pointer.paragraph : "";
      lines.push([
        csvCell(it.section),
        csvCell(it.num),
        csvCell(it.topic),
        csvCell(it.status),
        csvCell(it.text),
        csvCell(it.filled),
        csvCell(ev),
        csvCell(it.pointer ? it.pointer.section : ""),
        csvCell(paragraph),
        csvCell(filled.source),
        csvCell(filled.licence)
      ].join(","));
    }
    return lines.join("\n");
  }

  var API = {
    name: NAME,
    version: VERSION,
    fill: fill,
    toCsv: toCsv
  };

  if (typeof module !== "undefined" && module.exports) { module.exports = API; }
  if (G) { G.SMD_RESEARCH_CHECKLIST = API; }

})(typeof window !== "undefined" ? window : undefined);
