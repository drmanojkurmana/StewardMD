/* StewardMD - ResearchMD shared manuscript document editor
 * (window.SMD_RESEARCH_DOC). ES5 only, buildless, dual export.
 *
 * The editor turns a reporting checklist into a document outline and keeps
 * the outline headings in sync with the checklist items. It is used by the
 * Checklist step so the manuscript (or the thesis draft) can be edited in
 * place. Formatting is limited to the tags the toolbar can produce:
 * bold, italic, underline, heading 2, heading 3, bulleted list, numbered
 * list, superscript and subscript.
 *
 * Save writes the same manuscript sections the manuscript screen reads:
 *   - rich editor state: localStorage smd_rmd_doc_v1[project][guideline]
 *   - plain manuscript state: localStorage smd_rmd_manuscript_local_v1
 *   - server: PUT /v1/projects/{id}/manuscript/sections/{sectionId}
 * The server is updated only for sections that already exist there. A save
 * that cannot reach the server still keeps the local copies.
 *
 * No em-dash or en-dash is used in any user-facing string.
 */
(function (G) {
  "use strict";

  var NAME = "research-doc-editor";
  var VERSION = "rmd1";
  var DOC_KEY = "smd_rmd_doc_v1";
  var MAN_KEY = "smd_rmd_manuscript_local_v1";
  var THESIS_KEY = "smd_rmd_thesis_v1";
  var DEFAULT_LIMIT = 3000;
  var MIN_FILLED_WORDS = 8;
  var MAX_HTML = 200000;

  var D = G && G.document;
  var SMD = G && (G.SMD_RESEARCH = G.SMD_RESEARCH || {});

  var ALLOWED = {
    B: 1, STRONG: 1, I: 1, EM: 1, U: 1, H2: 1, H3: 1,
    UL: 1, OL: 1, LI: 1, SUP: 1, SUB: 1, P: 1, DIV: 1, BR: 1
  };
  var DROP = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, IFRAME: 1, OBJECT: 1,
    EMBED: 1, SVG: 1, MATH: 1, TEMPLATE: 1, FORM: 1, INPUT: 1,
    TEXTAREA: 1, SELECT: 1, OPTION: 1, BUTTON: 1
  };
  var STOP = {
    the: 1, and: 1, for: 1, with: 1, that: 1, this: 1, from: 1, into: 1,
    were: 1, was: 1, are: 1, not: 1, have: 1, has: 1, been: 1,
    study: 1, studies: 1, report: 1, paper: 1, article: 1, section: 1,
    data: 1, method: 1, methods: 1, result: 1, results: 1,
    using: 1, used: 1, each: 1, than: 1, when: 1, what: 1, which: 1,
    their: 1, there: 1, about: 1, after: 1, also: 1, such: 1, these: 1,
    those: 1, they: 1, them: 1, then: 1, can: 1, may: 1, will: 1,
    our: 1, we: 1, it: 1, its: 1, in: 1, on: 1, by: 1, as: 1, at: 1,
    or: 1, of: 1, to: 1, is: 1, be: 1, an: 1, a: 1
  };
  var SYN_RAW = {
    "background/rationale": ["background", "rationale", "why", "burden", "context", "known"],
    "objectives": ["objective", "aim", "hypothesis", "goal", "question"],
    "study design": ["design", "cohort", "cohort study", "case control", "case control study", "casecontrol", "cross sectional", "cross sectional study", "crosssectional", "trial", "randomised trial", "randomized trial", "observational", "retrospective", "prospective", "longitudinal"],
    "setting": ["setting", "location", "site", "hospital", "clinic", "recruit", "recruitment", "date", "period"],
    "participants": ["participant", "patient", "eligib", "inclusion", "exclusion", "sample", "enrol", "enroll", "selection"],
    "variables": ["variable", "outcome", "exposure", "predictor", "confounder", "effect modifier", "diagnostic criteria"],
    "data sources/measurement": ["source", "measure", "measurement", "collect", "record", "instrument", "questionnaire", "assay", "chart review"],
    "bias": ["bias", "confound", "mitigat", "control"],
    "study size": ["size", "power", "sample size", "calculation", "precision"],
    "quantitative variables": ["quantitative", "continuous", "categor", "grouping", "cut off", "cutoff", "scale"],
    "statistical methods": ["statistic", "analysis", "analyses", "regression", "model", "test", "estimate", "confidence", "software"],
    "descriptive data": ["descriptive", "baseline", "characteristic", "demographic"],
    "outcome data": ["outcome", "event", "incidence", "count", "number"],
    "main results": ["main result", "estimate", "effect", "risk", "hazard", "odds", "confidence interval", "p value"],
    "other analyses": ["subgroup", "sensitivity", "additional", "secondary", "exploratory", "ancillary"],
    "key results": ["key result", "main finding", "principal", "summary", "finding"],
    "limitations": ["limitation", "weakness", "bias", "caution"],
    "interpretation": ["interpret", "compare", "literature", "mechanism", "meaning", "explain"],
    "generalisability": ["general", "generalis", "generaliz", "external validity", "applicab", "applic"],
    "funding": ["fund", "funding", "grant", "sponsor", "support"],
    "registration": ["register", "registration", "protocol", "registry", "trial number"],
    "registration and protocol": ["register", "registration", "protocol", "registry", "trial number"],
    "competing interests": ["competing", "conflict", "interest", "declaration"],
    "availability of data": ["availability", "data sharing", "code", "material", "request"],
    "data sharing": ["sharing", "availability", "request", "deposit"],
    "patient consent": ["consent", "assent", "permission"],
    "informed consent": ["consent", "documentation", "obtained"],
    "ethical approval": ["ethic", "approval", "committee", "board"],
    "clinical findings": ["clinical", "examination", "finding", "sign", "symptom"],
    "diagnostic assessment": ["diagnos", "investigation", "test", "imag", "laboratory", "lab"],
    "therapeutic intervention": ["treatment", "therap", "intervention", "dose", "drug", "surgery"],
    "follow-up and outcomes": ["follow up", "followup", "outcome", "adherence", "adverse", "tolerability"],
    "clinical timeline": ["timeline", "chronolog", "day", "week", "month"],
    "patient perspective": ["patient perspective", "patient view", "experience"],
    "patient information": ["patient", "case presentation", "presented", "demographics", "history", "symptom"],
    "title and keywords": ["title", "keyword"],
    "title": ["title", "title page"],
    "trial design": ["design", "trial", "random", "allocation", "parallel", "crossover"],
    "randomisation": ["random", "allocation", "sequence", "concealment", "implementation"],
    "blinding": ["blind", "mask", "open label"],
    "sample size": ["sample size", "power", "calculation"],
    "participant flow": ["flow", "enrol", "allocat", "lost", "follow up"],
    "recruitment": ["recruit", "date", "period"],
    "baseline data": ["baseline", "characteristic", "demographic"],
    "numbers analysed": ["analys", "number", "include"],
    "outcomes and estimation": ["outcome", "estimate", "effect", "confidence"],
    "ancillary analyses": ["subgroup", "sensitivity", "additional", "ancillary"],
    "harms": ["harm", "adverse", "side effect", "event"],
    "interpretation and limitations": ["interpret", "limitation"],
    "generalisation": ["general", "applicab", "external"],
    "study selection": ["select", "screen", "flow", "record", "included", "excluded"],
    "study characteristics": ["characteristic", "study", "population", "setting"],
    "risk of bias": ["bias", "risk", "assessment"],
    "results of individual studies": ["individual", "study", "estimate", "effect"],
    "results of syntheses": ["synthesis", "pooled", "effect", "heterogeneity"],
    "reporting biases": ["reporting", "bias", "funnel"],
    "certainty of evidence": ["certainty", "grade", "confidence in evidence"],
    "search strategy": ["search", "strategy", "query", "database"],
    "information sources": ["information", "source", "database", "search date"],
    "eligibility criteria": ["eligib", "inclusion", "exclusion"],
    "selection process": ["select", "screen", "reviewer"],
    "data collection process": ["collect", "extract", "reviewer"],
    "data items": ["item", "variable", "outcome", "extract"],
    "study risk of bias assessment": ["bias", "assessment", "tool"],
    "effect measures": ["effect", "measure", "risk ratio", "odds ratio", "mean difference"],
    "synthesis methods": ["synthesis", "pool", "model", "heterogeneity", "subgroup"],
    "reporting bias assessment": ["reporting", "bias", "funnel"],
    "certainty assessment": ["certainty", "grade"],
    "registration and protocol": ["registration", "protocol", "register", "number"],
    "support": ["support", "fund", "grant", "sponsor"],
    "competing interests": ["competing", "conflict", "interest"],
    "availability of data, code and other materials": ["availability", "data", "code", "material"]
  };
  var SYN = {};

  function own(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  }

  function isArr(v) {
    return Object.prototype.toString.call(v) === "[object Array]";
  }

  function trim(s) {
    return s == null ? "" : String(s).replace(/^\s+|\s+$/g, "");
  }

  function low(s) {
    return trim(s).toLowerCase();
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function slug(s) {
    return low(s)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-");
  }

  function normalizeText(s) {
    return low(s)
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function uniq(base, seen) {
    var id = base || "section";
    var n = 2;
    while (seen[id]) {
      id = base + "-" + n;
      n++;
    }
    seen[id] = 1;
    return id;
  }

  function initSyn() {
    var k;
    for (k in SYN_RAW) {
      if (own(SYN_RAW, k)) SYN[normalizeText(k)] = SYN_RAW[k];
    }
  }
  initSyn();

  function decodeEntities(s) {
    return String(s == null ? "" : s)
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, function (m, n) {
        return String.fromCharCode(parseInt(n, 10));
      })
      .replace(/&amp;/gi, "&");
  }

  /* ---------- Outline and draft mapping ---------- */

  function outlineFor(checklist) {
    var out = { id: "", name: "", sections: [], itemSub: {} };
    if (!checklist) return out;
    out.id = checklist.id || "";
    out.name = checklist.name || checklist.id || "Checklist";
    var secs = checklist.sections || [];
    var secSeen = {};
    var subSeen = {};
    var i, j, sec, node, items, topicMap, it, num, topic, tkey, sub;
    for (i = 0; i < secs.length; i++) {
      sec = secs[i] || {};
      var title = trim(sec.title || sec.heading || ("Section " + (i + 1)));
      if (!title) title = "Section " + (i + 1);
      var sid = uniq(slug(title) || ("section-" + (i + 1)), secSeen);
      node = { id: sid, title: title, items: [], subheadings: [] };
      items = sec.items || [];
      topicMap = {};
      for (j = 0; j < items.length; j++) {
        it = items[j] || {};
        num = String(it.num != null ? it.num : (it.number != null ? it.number : ""));
        topic = trim(it.topic || it.text || num || "Item");
        if (!num) num = String(j + 1);
        tkey = low(topic);
        sub = topicMap[tkey];
        if (!sub) {
          sub = {
            id: uniq(sid + "--" + (slug(topic) || ("item-" + j)), subSeen),
            title: topic,
            items: [],
            overview: false
          };
          topicMap[tkey] = sub;
          node.subheadings.push(sub);
        }
        sub.items.push(num);
        node.items.push(num);
        out.itemSub[num] = sub.id;
      }
      if (!node.subheadings.length) {
        node.subheadings.push({
          id: uniq(sid + "--" + (slug(title) || "section"), subSeen),
          title: title,
          items: [],
          overview: false
        });
      }
      out.sections.push(node);
    }
    return out;
  }

  function emptyDoc(outline) {
    var doc = { guidelineId: outline ? outline.id : "", name: outline ? outline.name : "", sections: [] };
    var secs = outline ? outline.sections : [];
    var i, j, sec, node;
    for (i = 0; i < secs.length; i++) {
      sec = secs[i];
      node = { id: sec.id, title: sec.title, subheadings: [] };
      for (j = 0; j < sec.subheadings.length; j++) {
        node.subheadings.push({
          id: sec.subheadings[j].id,
          title: sec.subheadings[j].title,
          html: "",
          overview: false
        });
      }
      doc.sections.push(node);
    }
    return doc;
  }

  function cloneDoc(doc) {
    if (!doc || !isArr(doc.sections)) return null;
    var out = { guidelineId: doc.guidelineId || "", name: doc.name || "", sections: [] };
    var i, j, sec, node, sub;
    for (i = 0; i < doc.sections.length; i++) {
      sec = doc.sections[i] || {};
      node = { id: sec.id || ("section-" + (i + 1)), title: sec.title || sec.id || "Section", subheadings: [] };
      var subs = sec.subheadings || [];
      for (j = 0; j < subs.length; j++) {
        sub = subs[j] || {};
        node.subheadings.push({
          id: sub.id || (node.id + "--" + (j + 1)),
          title: sub.title || "",
          html: typeof sub.html === "string" ? sub.html : "",
          overview: !!sub.overview
        });
      }
      out.sections.push(node);
    }
    return out;
  }

  function syncDoc(doc, outline) {
    var src = cloneDoc(doc);
    if (!src || !outline) return src || emptyDoc(outline || { sections: [] });
    var byId = {};
    var byTitle = {};
    var i, j, sec, node;
    for (i = 0; i < src.sections.length; i++) {
      sec = src.sections[i];
      byId[sec.id] = sec;
      byTitle[normalizeText(sec.title)] = sec;
    }
    var out = { guidelineId: outline.id, name: outline.name, sections: [] };
    for (i = 0; i < outline.sections.length; i++) {
      sec = outline.sections[i];
      var old = byId[sec.id] || byTitle[normalizeText(sec.title)];
      var oldSubs = old ? old.subheadings : [];
      var oldById = {};
      for (j = 0; j < oldSubs.length; j++) oldById[oldSubs[j].id] = oldSubs[j];
      node = { id: sec.id, title: sec.title, subheadings: [] };
      var overview = null;
      for (j = 0; j < oldSubs.length; j++) {
        if (oldSubs[j].overview) overview = oldSubs[j];
      }
      if (overview) {
        node.subheadings.push({
          id: overview.id || (sec.id + "--overview"),
          title: "",
          html: overview.html || "",
          overview: true
        });
      }
      for (j = 0; j < sec.subheadings.length; j++) {
        var os = oldById[sec.subheadings[j].id];
        if (!os) {
          for (var k = 0; k < oldSubs.length; k++) {
            if (!oldSubs[k].overview && low(oldSubs[k].title) === low(sec.subheadings[j].title)) {
              os = oldSubs[k];
              break;
            }
          }
        }
        node.subheadings.push({
          id: sec.subheadings[j].id,
          title: sec.subheadings[j].title,
          html: os ? (os.html || "") : "",
          overview: false
        });
      }
      out.sections.push(node);
    }
    return out;
  }

  function sourceSections(src) {
    if (!src) return [];
    var raw = isArr(src) ? src : (src.sections || []);
    var out = [];
    var i, s, heading, text, paras, p;
    for (i = 0; i < raw.length; i++) {
      s = raw[i];
      if (!s || typeof s !== "object") continue;
      heading = trim(s.heading || s.title || s.id || "");
      text = "";
      paras = isArr(s.paragraphs) ? s.paragraphs : null;
      if (paras) {
        for (p = 0; p < paras.length; p++) {
          if (paras[p] != null && trim(paras[p])) {
            if (text) text += "\n\n";
            text += trim(paras[p]);
          }
        }
      } else if (typeof s.text === "string") {
        text = s.text;
      }
      text = trim(String(text || "").replace(/\r\n?/g, "\n"));
      if (text) out.push({ id: s.id || "", heading: heading, text: text });
    }
    return out;
  }

  function splitParas(text) {
    var raw = String(text || "").replace(/\r\n?/g, "\n").split(/\n+/);
    var out = [];
    var i, t;
    for (i = 0; i < raw.length; i++) {
      t = trim(raw[i]);
      if (t) out.push(t);
    }
    return out;
  }

  function textToHtml(text) {
    var paras = splitParas(text);
    var out = [];
    var i;
    for (i = 0; i < paras.length; i++) out.push("<p>" + esc(paras[i]) + "</p>");
    return out.join("");
  }

  function scoreText(text, topic) {
    var hay = " " + normalizeText(text) + " ";
    var key = normalizeText(topic);
    if (!key) return 0;
    var score = 0;
    if (hay.indexOf(" " + key + " ") !== -1) score += 6;
    var words = key.split(" ");
    var extras = SYN[key] || [];
    var i, w;
    for (i = 0; i < words.length; i++) {
      w = words[i];
      if (!w || STOP[w] || w.length < 3) continue;
      if (hay.indexOf(w) !== -1) score += (w.length >= 7 ? 2 : 1);
    }
    for (i = 0; i < extras.length; i++) {
      w = normalizeText(extras[i]);
      if (!w) continue;
      if (hay.indexOf(w) !== -1) score += (w.indexOf(" ") !== -1 ? 3 : (w.length >= 7 ? 2 : 1));
    }
    return score;
  }

  function directAlias(h) {
    if (h === "title page") return "title";
    if (h === "case presentation") return "patient information";
    if (h === "conclusion") return "take home message";
    return h;
  }

  function findDirectSub(outline, heading) {
    var h = normalizeText(heading);
    var alias = directAlias(h);
    if (!h) return null;
    var i, j, sec, sub, st;
    for (i = 0; i < outline.sections.length; i++) {
      sec = outline.sections[i];
      for (j = 0; j < sec.subheadings.length; j++) {
        sub = sec.subheadings[j];
        if (sub.overview) continue;
        st = normalizeText(sub.title);
        if (st && (st === h || st === alias)) return { section: sec, sub: sub };
      }
    }
    for (i = 0; i < outline.sections.length; i++) {
      sec = outline.sections[i];
      for (j = 0; j < sec.subheadings.length; j++) {
        sub = sec.subheadings[j];
        if (sub.overview) continue;
        st = normalizeText(sub.title);
        if (st.length >= 5 && h.length >= 5 &&
            st.split(" ").length > 1 && h.split(" ").length > 1 &&
            (st.indexOf(h) === 0 || h.indexOf(st) === 0)) {
          return { section: sec, sub: sub };
        }
      }
    }
    return null;
  }

  function mainAliases(heading) {
    var h = normalizeText(heading);
    var out = [h];
    if (h.indexOf("title and abstract") !== -1) {
      out.push("title and abstract", "title", "abstract");
    } else if (h.indexOf("abstract") !== -1) {
      out.push("title and abstract", "abstract");
    } else if (h.indexOf("title") !== -1) {
      out.push("title and abstract", "title");
    }
    if (h.indexOf("introduction") !== -1 || h.indexOf("background") !== -1) out.push("introduction");
    if (h.indexOf("case presentation") !== -1 || h.indexOf("patient") !== -1) out.push("patient information");
    if (h.indexOf("method") !== -1) out.push("methods");
    if (h.indexOf("result") !== -1 || h.indexOf("finding") !== -1) out.push("results");
    if (h.indexOf("discussion") !== -1 || h.indexOf("conclusion") !== -1) out.push("discussion");
    if (h.indexOf("other") !== -1) out.push("other information", "other");
    return out;
  }

  function matchMain(outline, heading) {
    var aliases = mainAliases(heading);
    var i, j, sec, st;
    for (i = 0; i < aliases.length; i++) {
      if (!aliases[i]) continue;
      for (j = 0; j < outline.sections.length; j++) {
        sec = outline.sections[j];
        st = normalizeText(sec.title);
        if (st === aliases[i]) return sec;
      }
    }
    for (i = 0; i < aliases.length; i++) {
      if (!aliases[i] || aliases[i].length < 4) continue;
      for (j = 0; j < outline.sections.length; j++) {
        sec = outline.sections[j];
        st = normalizeText(sec.title);
        if (st && (st.indexOf(aliases[i]) !== -1 || aliases[i].indexOf(st) !== -1)) return sec;
      }
    }
    var best = null;
    var bestScore = 0;
    for (j = 0; j < outline.sections.length; j++) {
      sec = outline.sections[j];
      st = scoreText(heading, sec.title);
      if (st > bestScore) {
        bestScore = st;
        best = sec;
      }
    }
    return bestScore > 0 ? best : null;
  }

  function bestSubInSection(section, para) {
    var best = null;
    var bestScore = 0;
    var i, sub, s;
    for (i = 0; i < section.subheadings.length; i++) {
      sub = section.subheadings[i];
      if (sub.overview) continue;
      s = scoreText(para, sub.title);
      if (s > bestScore) {
        bestScore = s;
        best = sub;
      }
    }
    return bestScore > 0 ? { sub: best, score: bestScore } : null;
  }

  function bestSubAnywhere(outline, para) {
    var best = null;
    var bestScore = 0;
    var i, j, sec, sub, s;
    for (i = 0; i < outline.sections.length; i++) {
      sec = outline.sections[i];
      for (j = 0; j < sec.subheadings.length; j++) {
        sub = sec.subheadings[j];
        if (sub.overview) continue;
        s = scoreText(para, sub.title);
        if (s > bestScore) {
          bestScore = s;
          best = { section: sec, sub: sub };
        }
      }
    }
    return bestScore > 0 ? best : null;
  }

  function findDocSub(doc, sectionId, subId) {
    var i, j, sec;
    for (i = 0; i < doc.sections.length; i++) {
      sec = doc.sections[i];
      if (sec.id !== sectionId) continue;
      for (j = 0; j < sec.subheadings.length; j++) {
        if (sec.subheadings[j].id === subId) return sec.subheadings[j];
      }
    }
    return null;
  }

  function hasText(html) {
    return !!trim(htmlToText(html));
  }

  function addToSub(doc, sectionId, subId, text, onlyEmpty) {
    var sub = findDocSub(doc, sectionId, subId);
    if (!sub) return false;
    if (onlyEmpty && hasText(sub.html)) return false;
    var add = textToHtml(text);
    if (!add) return false;
    sub.html = sub.html ? sub.html + add : add;
    return true;
  }

  function ensureOverview(doc, section) {
    var i;
    for (i = 0; i < section.subheadings.length; i++) {
      if (section.subheadings[i].overview) return section.subheadings[i];
    }
    var sub = { id: section.id + "--overview", title: "", html: "", overview: true };
    section.subheadings.unshift(sub);
    return sub;
  }

  function addOverview(doc, sectionId, text, onlyEmpty) {
    if (onlyEmpty) return false;
    var section = null;
    var i;
    for (i = 0; i < doc.sections.length; i++) {
      if (doc.sections[i].id === sectionId) {
        section = doc.sections[i];
        break;
      }
    }
    if (!section) return false;
    var sub = ensureOverview(doc, section);
    var add = textToHtml(text);
    if (!add) return false;
    sub.html = sub.html ? sub.html + add : add;
    return true;
  }

  function applySources(doc, outline, src, onlyEmpty) {
    var filled = [];
    var sections = sourceSections(src);
    var i, j, k, item, direct, target, paras, sub, best, one, opened;
    if (!doc || !outline || !sections.length) return filled;
    for (i = 0; i < sections.length; i++) {
      item = sections[i];
      direct = findDirectSub(outline, item.heading);
      if (direct) {
        if (addToSub(doc, direct.section.id, direct.sub.id, item.text, onlyEmpty)) {
          filled.push(direct.sub.id);
        }
        continue;
      }
      target = matchMain(outline, item.heading);
      if (!target) {
        paras = splitParas(item.text);
        for (j = 0; j < paras.length; j++) {
          best = bestSubAnywhere(outline, paras[j]);
          if (!best) continue;
          if (addToSub(doc, best.section.id, best.sub.id, paras[j], onlyEmpty)) {
            filled.push(best.sub.id);
          }
        }
        continue;
      }
      paras = splitParas(item.text);
      one = null;
      for (j = 0; j < target.subheadings.length; j++) {
        if (!target.subheadings[j].overview) {
          if (one) {
            one = null;
            break;
          }
          one = target.subheadings[j];
        }
      }
      for (j = 0; j < paras.length; j++) {
        if (one) {
          if (addToSub(doc, target.id, one.id, paras[j], onlyEmpty)) filled.push(one.id);
          continue;
        }
        best = bestSubInSection(target, paras[j]);
        if (best) {
          if (addToSub(doc, target.id, best.sub.id, paras[j], onlyEmpty)) {
            filled.push(best.sub.id);
            continue;
          }
          if (onlyEmpty) continue;
        }
        opened = addOverview(doc, target.id, paras[j], onlyEmpty);
        if (opened) filled.push(target.id + "--overview");
      }
    }
    var seen = {};
    var out = [];
    for (k = 0; k < filled.length; k++) {
      if (!seen[filled[k]]) {
        seen[filled[k]] = 1;
        out.push(filled[k]);
      }
    }
    return out;
  }

  /* ---------- HTML helpers ---------- */

  function htmlToText(html) {
    if (!html) return "";
    var s = String(html).replace(/\r\n?/g, "\n");
    var out = "";
    var stack = [];
    var counts = [];
    var re = /<(\/?)([a-zA-Z0-9]+)(?:\s[^>]*)?>|([^<]+)/g;
    var m, close, tag, t, isOl;
    while ((m = re.exec(s)) !== null) {
      if (m[3] != null) {
        out += decodeEntities(m[3]);
        continue;
      }
      close = m[1] === "/";
      tag = m[2].toUpperCase();
      if (tag === "BR") {
        out += "\n";
        continue;
      }
      if (tag === "UL" || tag === "OL") {
        if (close) {
          stack.pop();
          counts.pop();
          out += "\n";
        } else {
          stack.push(tag);
          counts.push(0);
          out += "\n";
        }
        continue;
      }
      if (tag === "LI") {
        if (close) {
          out += "\n";
          continue;
        }
        out += "\n";
        isOl = stack.length && stack[stack.length - 1] === "OL";
        if (isOl) {
          counts[counts.length - 1] = (counts[counts.length - 1] || 0) + 1;
          out += counts[counts.length - 1] + ". ";
        } else {
          out += "• ";
        }
        continue;
      }
      if (tag === "P" || tag === "DIV" || tag === "H2" || tag === "H3") {
        if (close) {
          out += "\n";
        } else if (out && out.charAt(out.length - 1) !== "\n") {
          out += "\n";
        }
        continue;
      }
    }
    out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    return trim(out);
  }

  function countWords(text) {
    var t = String(text || "")
      .replace(/^[ \t]*[•][ \t]*/gm, "")
      .replace(/^[ \t]*\d+\.[ \t]*/gm, "")
      .replace(/^\s+|\s+$/g, "");
    return t ? t.split(/\s+/).length : 0;
  }

  function statusForWords(words) {
    if (!words) return "missing";
    if (words < MIN_FILLED_WORDS) return "partial";
    return "filled";
  }

  function regexSanitize(html) {
    var s = String(html || "").slice(0, MAX_HTML);
    s = s.replace(/<!--[\s\S]*?-->/g, "");
    s = s.replace(/<(script|style|noscript|iframe|object|embed|svg|math|template|form)\b[\s\S]*?<\/\1\s*>/gi, "");
    s = s.replace(/<(script|style|noscript|iframe|object|embed|svg|math|template|form)\b[^>]*\/?>/gi, "");
    s = s.replace(/<([a-zA-Z0-9]+)(?:\s[^>]*)?\/?>/g, function (m, tag) {
      var t = tag.toUpperCase();
      if (t === "BR") return "<br>";
      return ALLOWED[t] ? "<" + tag.toLowerCase() + ">" : "";
    });
    s = s.replace(/<\/([a-zA-Z0-9]+)\s*>/g, function (m, tag) {
      var t = tag.toUpperCase();
      return ALLOWED[t] ? "</" + tag.toLowerCase() + ">" : "";
    });
    return s;
  }

  function sanitizeHtml(html) {
    var raw = String(html == null ? "" : html);
    if (!raw) return "";
    if (raw.length > MAX_HTML) raw = raw.slice(0, MAX_HTML);
    if (!G || !G.DOMParser) return regexSanitize(raw);
    var doc;
    try {
      doc = new G.DOMParser().parseFromString(raw, "text/html");
    } catch (e) {
      return regexSanitize(raw);
    }
    if (!doc || !doc.body) return regexSanitize(raw);
    var out = [];
    function walk(node) {
      var kids = node.childNodes || [];
      var i, c, tag;
      for (i = 0; i < kids.length; i++) {
        c = kids[i];
        if (c.nodeType === 3) {
          out.push(esc(c.nodeValue));
        } else if (c.nodeType === 1) {
          tag = String(c.tagName || "").toUpperCase();
          if (DROP[tag]) continue;
          if (tag === "BR") {
            out.push("<br>");
          } else if (tag === "SPAN") {
            var style = low(c.getAttribute && c.getAttribute("style"));
            var wraps = [];
            if (/font-weight\s*:\s*(bold|[6-9]00)/.test(style)) wraps.push("b");
            if (/font-style\s*:\s*italic/.test(style)) wraps.push("i");
            if (/text-decoration[^;]*underline/.test(style)) wraps.push("u");
            if (/vertical-align\s*:\s*super/.test(style)) wraps.push("sup");
            else if (/vertical-align\s*:\s*sub/.test(style)) wraps.push("sub");
            for (var w = 0; w < wraps.length; w++) out.push("<" + wraps[w] + ">");
            walk(c);
            for (var w2 = wraps.length - 1; w2 >= 0; w2--) out.push("</" + wraps[w2] + ">");
          } else if (ALLOWED[tag]) {
            out.push("<" + tag.toLowerCase() + ">");
            walk(c);
            out.push("</" + tag.toLowerCase() + ">");
          } else {
            walk(c);
          }
        }
      }
    }
    walk(doc.body);
    return out.join("");
  }

  /* ---------- Local stores ---------- */

  function readJson(key) {
    try {
      if (typeof localStorage === "undefined") return {};
      return JSON.parse(localStorage.getItem(key) || "{}") || {};
    } catch (e) {
      return {};
    }
  }

  function writeJson(key, value) {
    try {
      if (typeof localStorage === "undefined") return false;
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function readLocalDoc(pid, guidelineId) {
    var all = readJson(DOC_KEY);
    var one = all[pid];
    var doc = one && one[guidelineId];
    if (!doc || doc.guidelineId !== guidelineId || !isArr(doc.sections)) return null;
    return cloneDoc(doc);
  }

  function writeLocalDoc(pid, doc) {
    var all = readJson(DOC_KEY);
    if (!all[pid]) all[pid] = {};
    all[pid][doc.guidelineId] = {
      guidelineId: doc.guidelineId,
      name: doc.name || "",
      sections: doc.sections,
      updatedAt: Date.now()
    };
    return writeJson(DOC_KEY, all);
  }

  function localManuscriptSources(pid) {
    var all = readJson(MAN_KEY);
    var d = all[pid];
    if (!d || !d.sections) return [];
    var order = isArr(d.order) && d.order.length ? d.order : Object.keys(d.sections);
    var out = [];
    var i, id, text, heading;
    for (i = 0; i < order.length; i++) {
      id = order[i];
      text = d.sections[id];
      if (text == null || !trim(text)) continue;
      heading = (d.headings && d.headings[id]) || id;
      out.push({ id: id, heading: heading, text: text });
    }
    return out;
  }

  function mergeLocalManuscript(pid, sections) {
    var all = readJson(MAN_KEY);
    var d = all[pid] || { sections: {}, headings: {}, order: [] };
    if (!d.sections) d.sections = {};
    if (!d.headings) d.headings = {};
    if (!isArr(d.order)) d.order = [];
    var i, sec, seen = {};
    for (i = 0; i < d.order.length; i++) seen[d.order[i]] = 1;
    for (i = 0; i < sections.length; i++) {
      sec = sections[i];
      if (!sec || !sec.id || !trim(sec.text)) continue;
      d.sections[sec.id] = sec.text;
      d.headings[sec.id] = sec.heading || sec.id;
      if (!seen[sec.id]) {
        seen[sec.id] = 1;
        d.order.push(sec.id);
      }
    }
    all[pid] = d;
    return writeJson(MAN_KEY, all);
  }

  function thesisState(pid) {
    var all = readJson(THESIS_KEY);
    return all[pid] || {};
  }

  function thesisSources(pid) {
    var t = thesisState(pid);
    var d = t && t.draft;
    if (!d || !isArr(d.sections)) return [];
    return sourceSections(d);
  }

  function thesisLimit(pid) {
    var t = thesisState(pid);
    var n = t && t.journal && t.journal.wordLimit;
    return typeof n === "number" && n > 0 ? n : DEFAULT_LIMIT;
  }

  function activeProject() {
    try {
      if (SMD.store && SMD.store.getActiveProject) return SMD.store.getActiveProject();
    } catch (e) {}
    return null;
  }

  /* ---------- Manuscript section mapping ---------- */

  function manuscriptIdFor(section) {
    var t = low(section.title);
    if (t.indexOf("title and abstract") !== -1) return "abstract";
    if (t.indexOf("abstract") !== -1) return "abstract";
    if (t.indexOf("title") !== -1) return "title";
    if (t.indexOf("introduction") !== -1 || t.indexOf("background") !== -1) return "introduction";
    if (t.indexOf("method") !== -1) return "methods";
    if (t.indexOf("result") !== -1 || t.indexOf("finding") !== -1) return "results";
    if (t.indexOf("discussion") !== -1 || t.indexOf("conclusion") !== -1) return "discussion";
    if (t.indexOf("patient information") !== -1 || t.indexOf("clinical finding") !== -1 ||
        t.indexOf("diagnostic") !== -1 || t.indexOf("therapeutic") !== -1 ||
        t.indexOf("follow-up") !== -1 || t.indexOf("follow up") !== -1) return "casePresentation";
    if (t.indexOf("timeline") !== -1) return "timeline";
    if (t.indexOf("perspective") !== -1) return "patientPerspective";
    if (t.indexOf("other") !== -1) return "other";
    return slug(section.title) || section.id;
  }

  function manuscriptHeadingFor(id, fallback) {
    if (id === "abstract") return "Abstract";
    if (id === "title") return "Title";
    if (id === "introduction") return "Introduction";
    if (id === "methods") return "Methods";
    if (id === "results") return "Results";
    if (id === "discussion") return "Discussion";
    if (id === "casePresentation") return "Case Presentation";
    if (id === "timeline") return "Timeline";
    if (id === "patientPerspective") return "Patient Perspective";
    return fallback;
  }

  function docToSections(doc) {
    var out = [];
    if (!doc || !isArr(doc.sections)) return out;
    var i, j, sec, sub, lines, text, subTitle, mainTitle, sid;
    for (i = 0; i < doc.sections.length; i++) {
      sec = doc.sections[i];
      mainTitle = sec.title || sec.id || "Section";
      lines = [];
      for (j = 0; j < sec.subheadings.length; j++) {
        sub = sec.subheadings[j];
        text = htmlToText(sub.html);
        if (!text) continue;
        if (sub.overview) {
          lines.push(text);
          continue;
        }
        subTitle = sub.title || "";
        if (subTitle && low(subTitle) !== low(mainTitle)) lines.push(subTitle);
        lines.push(text);
      }
      text = trim(lines.join("\n\n"));
      if (text) {
        sid = manuscriptIdFor(sec);
        out.push({ id: sid, heading: manuscriptHeadingFor(sid, mainTitle), text: text });
      }
    }
    return out;
  }

  function docxSections(doc) {
    var out = [];
    if (!doc || !isArr(doc.sections)) return out;
    var i, j, sec, sub, text, overview, mainTitle, subsOut, subOut, any;
    for (i = 0; i < doc.sections.length; i++) {
      sec = doc.sections[i];
      mainTitle = sec.title || sec.id || "Section";
      overview = "";
      subsOut = [];
      any = false;
      for (j = 0; j < sec.subheadings.length; j++) {
        sub = sec.subheadings[j];
        text = htmlToText(sub.html);
        if (!text) continue;
        any = true;
        if (sub.overview) {
          overview = text;
          continue;
        }
        subsOut.push({ heading: sub.title || mainTitle, text: text });
      }
      if (!any) continue;
      if (subsOut.length === 1 && low(subsOut[0].heading) === low(mainTitle)) {
        out.push({
          heading: mainTitle,
          text: overview ? overview + "\n\n" + subsOut[0].text : subsOut[0].text
        });
        continue;
      }
      out.push({ heading: mainTitle, text: overview });
      for (j = 0; j < subsOut.length; j++) {
        subOut = subsOut[j];
        out.push(subOut);
      }
    }
    return out;
  }

  /* ---------- CSS ---------- */

  function injectCss() {
    if (!D || D.getElementById("rmdDocEditorCss")) return;
    var s = D.createElement("style");
    s.id = "rmdDocEditorCss";
    s.textContent = [
      "#researchMD .rmd-doc { display: flex; flex-direction: column; gap: 10px; width: 100%; min-width: 0; border: 1px solid var(--rmd-line, #e5ddce); background: var(--rmd-panel, #fffdf9); border-radius: 12px; padding: 12px; color: var(--rmd-ink, #111c44); font: 14px/1.45 var(--rmd-f, system-ui, sans-serif); }",
      "#researchMD .rmd-doc * { box-sizing: border-box; }",
      "#researchMD .rmd-doc-head { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: flex-start; justify-content: space-between; min-width: 0; }",
      "#researchMD .rmd-doc-title { margin: 0; font: 700 16px/1.3 var(--rmd-f, system-ui, sans-serif); color: var(--rmd-ink, #111c44); }",
      "#researchMD .rmd-doc-subtitle { margin: 2px 0 0; font: 400 12.5px/1.4 var(--rmd-f, system-ui, sans-serif); color: var(--rmd-mut, #5b607a); overflow-wrap: anywhere; }",
      "#researchMD .rmd-doc-actions { display: flex; flex-wrap: wrap; gap: 8px; }",
      "#researchMD .rmd-doc-btn { appearance: none; min-height: 44px; min-width: 44px; padding: 8px 12px; border: 1px solid var(--rmd-line, #e5ddce); border-radius: 8px; background: var(--rmd-panel, #fffdf9); color: var(--rmd-ink, #111c44); font: 600 13px/1.2 var(--rmd-f, system-ui, sans-serif); display: inline-flex; align-items: center; justify-content: center; gap: 4px; touch-action: manipulation; cursor: pointer; transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1), background-color 150ms ease-out; }",
      "#researchMD .rmd-doc-btn:active { transform: scale(0.97); }",
      "#researchMD .rmd-doc-btn[aria-pressed=\"true\"] { background: var(--rmd-acc-soft, #e4e9f8); color: var(--rmd-acc, #1b41bf); border-color: var(--rmd-acc, #1b41bf); }",
      "#researchMD .rmd-doc-btn-primary { background: var(--rmd-acc, #1b41bf); border-color: transparent; color: #fff; }",
      "#researchMD .rmd-doc-btn[disabled] { opacity: 0.45; cursor: default; transform: none; }",
      "#researchMD .rmd-doc-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 0; border-top: 1px solid var(--rmd-line, #e5ddce); border-bottom: 1px solid var(--rmd-line, #e5ddce); background: var(--rmd-panel, #fffdf9); position: sticky; top: 0; z-index: 5; }",
      "#researchMD .rmd-doc-group { display: flex; flex-wrap: wrap; gap: 6px; padding-right: 6px; border-right: 1px solid var(--rmd-line, #e5ddce); }",
      "#researchMD .rmd-doc-group:last-of-type { border-right: 0; padding-right: 0; }",
      "#researchMD .rmd-doc-lbl-compact { display: none; align-items: center; justify-content: center; }",
      "#researchMD .rmd-doc-lbl-wide { display: inline-flex; align-items: center; }",
      "#researchMD .rmd-doc-more-wrap { display: none; position: relative; flex: 1 1 0; }",
      "#researchMD .rmd-doc-more-btn { width: 100%; }",
      "#researchMD .rmd-doc-more-menu { position: absolute; top: calc(100% + 4px); right: 0; min-width: 176px; max-width: calc(100vw - 24px); padding: 6px; border: 1px solid var(--rmd-line, #e5ddce); border-radius: 10px; background: var(--rmd-panel, #fffdf9); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18); display: flex; flex-direction: column; gap: 4px; z-index: 20; transform-origin: top right; }",
      "#researchMD .rmd-doc-more-menu[hidden] { display: none; }",
      "#researchMD .rmd-doc-menu-item { appearance: none; width: 100%; min-height: 44px; padding: 8px 12px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--rmd-ink, #111c44); font: 600 13.5px/1.2 var(--rmd-f, system-ui, sans-serif); text-align: left; display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: pointer; touch-action: manipulation; }",
      "#researchMD .rmd-doc-menu-item:active { transform: scale(0.97); }",
      "#researchMD .rmd-doc-menu-item:focus-visible { outline: 2px solid var(--rmd-acc, #1b41bf); outline-offset: -2px; }",
      "@media (hover: hover) and (pointer: fine) {",
      "  #researchMD .rmd-doc-menu-item:hover { background: var(--rmd-acc-soft, #e4e9f8); color: var(--rmd-acc, #1b41bf); }",
      "}",
      "#researchMD .rmd-doc-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; font: 500 12.5px/1.4 var(--rmd-f, system-ui, sans-serif); color: var(--rmd-mut, #5b607a); min-width: 0; }",
      "#researchMD .rmd-doc-over { color: var(--rmd-warn, #a34e1c); font-weight: 700; }",
      "#researchMD .rmd-doc-notice { color: var(--rmd-acc, #1b41bf); font-weight: 600; }",
      "#researchMD .rmd-doc-notice-error { color: var(--rmd-bad, #b42318); }",
      "#researchMD .rmd-doc-scroll { display: flex; flex-direction: column; gap: 16px; min-width: 0; }",
      "#researchMD .rmd-doc-section { min-width: 0; }",
      "#researchMD .rmd-doc-h2 { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline; justify-content: space-between; margin: 0 0 8px; padding-bottom: 6px; border-bottom: 1px solid var(--rmd-line, #e5ddce); font: 700 16px/1.3 var(--rmd-f, system-ui, sans-serif); color: var(--rmd-ink, #111c44); }",
      "#researchMD .rmd-doc-words { font: 500 11.5px/1.2 var(--rmd-mono, ui-monospace, monospace); color: var(--rmd-mut, #5b607a); }",
      "#researchMD .rmd-doc-sub { min-width: 0; margin: 0 0 12px; }",
      "#researchMD .rmd-doc-h3 { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; justify-content: space-between; margin: 0 0 4px; font: 600 13.5px/1.35 var(--rmd-f, system-ui, sans-serif); color: var(--rmd-mut, #5b607a); }",
      "#researchMD .rmd-doc-body { min-height: 92px; padding: 10px 12px; border: 1px solid var(--rmd-line, #e5ddce); border-radius: 10px; background: var(--rmd-bg, #f8f1e4); color: var(--rmd-ink, #111c44); font: 400 16px/1.6 var(--rmd-f, system-ui, sans-serif); outline: none; overflow-wrap: anywhere; -webkit-user-select: text; user-select: text; }",
      "#researchMD .rmd-doc-body:focus { border-color: var(--rmd-acc, #1b41bf); box-shadow: 0 0 0 3px var(--rmd-acc-soft, #e4e9f8); }",
      "#researchMD .rmd-doc-body:empty:before { content: attr(data-placeholder); color: var(--rmd-mut, #5b607a); }",
      "#researchMD .rmd-doc-body h2, #researchMD .rmd-doc-body h3 { margin: 8px 0 4px; font: 700 16px/1.3 var(--rmd-f, system-ui, sans-serif); color: var(--rmd-ink, #111c44); }",
      "#researchMD .rmd-doc-body ul, #researchMD .rmd-doc-body ol { margin: 6px 0; padding-left: 22px; }",
      "#researchMD .rmd-doc-body li { margin: 2px 0; }",
      "#researchMD .rmd-doc-body p { margin: 0 0 8px; }",
      "#researchMD .rmd-doc-body sup, #researchMD .rmd-doc-body sub { font-size: 75%; line-height: 0; }",
      "#researchMD .rmd-doc-target { animation: rmdDocPulse 1.1s ease-out; }",
      "@keyframes rmdDocPulse { 0% { background-color: var(--rmd-acc-soft, #e4e9f8); } 100% { background-color: transparent; } }",
      "#researchMD .rmd-doc-empty { margin: 0; color: var(--rmd-mut, #5b607a); }",
      "#researchMD .rmd-doc .rmd-ai-bar { margin: 0; }",
      "@media (max-width: 767px) {",
      "  #researchMD .rmd-doc { padding: 10px; border-radius: 10px; }",
      "  #researchMD .rmd-doc-h2 { font-size: 15px; }",
      "  #researchMD .rmd-doc-body { min-height: 84px; }",
      "  #researchMD .rmd-doc-toolbar { flex-wrap: nowrap; gap: 3px; justify-content: space-between; }",
      "  #researchMD .rmd-doc-group { display: contents; border-right: 0; padding-right: 0; }",
      "  #researchMD .rmd-doc-toolbar .rmd-doc-btn { flex: 1 1 0; min-width: 47px; min-height: 47px; padding: 0 4px; }",
      "  #researchMD .rmd-doc-toolbar [data-doc-tier=\"extra\"] { display: none; }",
      "  #researchMD .rmd-doc-lbl-wide { display: none; }",
      "  #researchMD .rmd-doc-lbl-compact { display: inline-flex; }",
      "  #researchMD .rmd-doc-more-wrap { display: block; flex: 1 1 0; min-width: 47px; }",
      "}",
      "@media (prefers-reduced-motion: reduce) {",
      "  #researchMD .rmd-doc *, #researchMD .rmd-doc *:before, #researchMD .rmd-doc *:after { animation: none !important; transition: none !important; }",
      "}"
    ].join("\n");
    D.head.appendChild(s);
  }

  /* ---------- Editor render ---------- */

  function render(host, opts) {
    if (!host) return null;
    injectCss();
    var options = opts || {};
    var outline = options.outline || { id: "", name: "", sections: [], itemSub: {} };
    var pid = options.pid || options.apiPid || "project";
    var apiPid = options.apiPid || pid;
    var thesisPid = options.thesisPid || apiPid || pid;
    var proj = options.project || activeProject();
    var projectTitle = options.projectTitle || (proj && proj.title) || "Manuscript";
    var limit = options.journalLimit || thesisLimit(thesisPid) || DEFAULT_LIMIT;
    var state = {
      doc: null,
      outline: outline,
      savedRange: null,
      activeBody: null,
      selectionBound: false,
      autosaveTimer: null,
      changeTimer: null,
      saveNotice: "",
      saveKind: "info",
      manuscript: null,
      manuscriptPromise: null,
      totalWords: 0,
      moreOpen: false,
      menuBound: false,
      ai: (SMD.ai && SMD.ai.state) ? SMD.ai.state() : { busy: false, error: null, drafted: {} }
    };

    function applyTitleFallback(doc) {
      var titleText = trim(options.manuscriptTitle || (proj && proj.title ? String(proj.title).replace(/^\[Tutorial\]\s*/i, "") : ""));
      var direct;
      if (!titleText || !doc) return;
      direct = findDirectSub(outline, "Title");
      if (direct) addToSub(doc, direct.section.id, direct.sub.id, titleText, true);
    }

    function currentDoc() {
      if (state.doc) return state.doc;
      var doc = null;
      var sources = sourceSections(options.sources);
      if (options.saved && options.saved.sections) {
        doc = syncDoc(options.saved, outline);
      } else {
        var local = readLocalDoc(pid, outline.id);
        if (local) doc = syncDoc(local, outline);
      }
      if (doc) {
        if (sources.length) applySources(doc, outline, sources, true);
        else {
          var lms = localManuscriptSources(pid);
          if (lms.length) applySources(doc, outline, lms, true);
        }
        applyTitleFallback(doc);
        return doc;
      }
      doc = emptyDoc(outline);
      if (sources.length) {
        applySources(doc, outline, sources, false);
        applyTitleFallback(doc);
        return doc;
      }
      sources = localManuscriptSources(pid);
      if (sources.length) {
        applySources(doc, outline, sources, false);
        applyTitleFallback(doc);
        return doc;
      }
      sources = thesisSources(thesisPid);
      if (sources.length) applySources(doc, outline, sources, false);
      applyTitleFallback(doc);
      return doc;
    }

    state.doc = currentDoc();

    function readDocFromDom() {
      if (!state.doc) return state.doc;
      var bodies = host.querySelectorAll("[data-doc-body]");
      var i, el, sid, secId, sub;
      var next = cloneDoc(state.doc) || emptyDoc(outline);
      for (i = 0; i < bodies.length; i++) {
        el = bodies[i];
        sid = el.getAttribute("data-doc-body");
        secId = el.getAttribute("data-doc-section");
        sub = findDocSub(next, secId, sid);
        if (sub) sub.html = sanitizeHtml(el.innerHTML || "");
      }
      state.doc = next;
      return state.doc;
    }

    function refreshCounts() {
      var total = 0;
      var i, j, sec, sub, words, el;
      for (i = 0; i < state.doc.sections.length; i++) {
        sec = state.doc.sections[i];
        var secWords = 0;
        for (j = 0; j < sec.subheadings.length; j++) {
          sub = sec.subheadings[j];
          words = countWords(htmlToText(sub.html));
          secWords += words;
          el = host.querySelector('[data-doc-words="' + sub.id + '"]');
          if (el) el.textContent = words + (words === 1 ? " word" : " words");
        }
        total += secWords;
        el = host.querySelector('[data-doc-sec-words="' + sec.id + '"]');
        if (el) el.textContent = secWords + (secWords === 1 ? " word" : " words");
      }
      state.totalWords = total;
      el = host.querySelector("[data-doc-total]");
      if (el) {
        el.textContent = total + " of " + limit + " words";
        if (total > limit) el.className = "rmd-doc-total rmd-doc-over";
        else el.className = "rmd-doc-total";
      }
      el = host.querySelector("[data-doc-over]");
      if (el) {
        var over = total - limit;
        el.textContent = over > 0 ? "Over by " + over + " words" : "";
      }
    }

    function setNotice(text, kind) {
      state.saveNotice = text || "";
      state.saveKind = kind || "info";
      var el = host.querySelector("[data-doc-notice]");
      if (!el) return;
      el.textContent = state.saveNotice;
      el.className = "rmd-doc-notice" + (state.saveKind === "error" ? " rmd-doc-notice-error" : "");
    }

    function scheduleChange() {
      if (state.changeTimer) clearTimeout(state.changeTimer);
      state.changeTimer = setTimeout(function () {
        state.changeTimer = null;
        if (options.onChange) options.onChange(state.doc, { totalWords: state.totalWords });
      }, 180);
    }

    function autosave() {
      writeLocalDoc(pid, state.doc);
    }

    function scheduleAutosave() {
      if (state.autosaveTimer) clearTimeout(state.autosaveTimer);
      state.autosaveTimer = setTimeout(function () {
        state.autosaveTimer = null;
        autosave();
      }, 600);
    }

    function clearDraftNote(sid) {
      if (state.ai && state.ai.drafted) delete state.ai.drafted[sid];
      var el = host.querySelector('[data-rmd-ai-note="' + sid + '"]');
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    function syncBody(body) {
      if (!body || !state.doc) return;
      var sid = body.getAttribute("data-doc-body");
      var secId = body.getAttribute("data-doc-section");
      var sub = findDocSub(state.doc, secId, sid);
      if (sub) sub.html = sanitizeHtml(body.innerHTML || "");
    }

    function afterEdit(body) {
      state.activeBody = body || state.activeBody;
      if (body) syncBody(body);
      else readDocFromDom();
      refreshCounts();
      if (body) {
        var sid = body.getAttribute("data-doc-body");
        if (sid) clearDraftNote(sid);
      }
      scheduleChange();
      scheduleAutosave();
    }

    function saveSelection() {
      var sel;
      try {
        sel = G.getSelection ? G.getSelection() : null;
      } catch (e) {
        sel = null;
      }
      if (!sel || !sel.rangeCount) return;
      var node = sel.anchorNode;
      if (!node) return;
      var root = node.nodeType === 1 ? node : node.parentNode;
      if (root && host.contains(root)) {
        try {
          state.savedRange = sel.getRangeAt(0).cloneRange();
        } catch (e) {}
      }
    }

    function restoreSelection() {
      var body = state.activeBody;
      if (state.savedRange && state.doc) {
        try {
          var sel = G.getSelection ? G.getSelection() : null;
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(state.savedRange);
            return true;
          }
        } catch (e) {}
      }
      if (body && body.focus) {
        try {
          body.focus();
          var range = D.createRange();
          range.selectNodeContents(body);
          range.collapse(false);
          var sel2 = G.getSelection ? G.getSelection() : null;
          if (sel2) {
            sel2.removeAllRanges();
            sel2.addRange(range);
          }
          return true;
        } catch (e2) {}
      }
      return false;
    }

    function command(cmd) {
      restoreSelection();
      if (!D.execCommand) {
        setNotice("Formatting is not available on this device.", "error");
        return;
      }
      try {
        D.execCommand("styleWithCSS", false, false);
      } catch (e) {}
      try {
        if (cmd === "h2" || cmd === "h3") {
          var current = "";
          try {
            current = String(D.queryCommandValue("formatBlock") || "").toLowerCase();
          } catch (e1) {}
          if (current.indexOf(cmd) !== -1) D.execCommand("formatBlock", false, "<p>");
          else D.execCommand("formatBlock", false, "<" + cmd + ">");
        } else {
          D.execCommand(cmd, false, null);
        }
      } catch (e2) {
        setNotice("That formatting command did not run.", "error");
        return;
      }
      afterEdit(state.activeBody);
    }

    function pasteInto(body, ev) {
      var clip = ev.clipboardData || G.clipboardData;
      var html = clip && clip.getData ? clip.getData("text/html") : "";
      var text = clip && clip.getData ? clip.getData("text/plain") : "";
      if (ev.preventDefault) ev.preventDefault();
      var safe = html ? sanitizeHtml(html) : esc(text).replace(/\n/g, "<br>");
      try {
        D.execCommand("insertHTML", false, safe);
      } catch (e) {
        try {
          D.execCommand("insertText", false, text || htmlToText(html));
        } catch (e2) {
          return;
        }
      }
      afterEdit(body);
    }

    function iconSvg(kind) {
      if (kind === "bullets") {
        return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="7" r="1.2" fill="currentColor"/><circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="5" cy="17" r="1.2" fill="currentColor"/><line x1="9" y1="7" x2="20" y2="7"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="17" x2="20" y2="17"/></svg>';
      }
      if (kind === "numbers") {
        return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h2v4"/><path d="M4 10h4"/><path d="M4 15h3l-3 4h4"/><line x1="10" y1="7" x2="20" y2="7"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="17" x2="20" y2="17"/></svg>';
      }
      if (kind === "undo") {
        return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>';
      }
      if (kind === "more") {
        return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="6" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18" cy="12" r="1.4" fill="currentColor"/></svg>';
      }
      return "";
    }

    function toolbarBtnContent(b) {
      var svg = b.icon ? iconSvg(b.icon) : "";
      if (!svg) return esc(b.label);
      return '<span class="rmd-doc-lbl-wide">' + esc(b.label) + '</span><span class="rmd-doc-lbl-compact" aria-hidden="true">' + svg + '</span>';
    }

    function toolbarHtml() {
      var groups = [
        [
          { cmd: "bold", label: "B", aria: "Bold", tier: "main" },
          { cmd: "italic", label: "I", aria: "Italic", tier: "main" },
          { cmd: "underline", label: "U", aria: "Underline", tier: "main" }
        ],
        [
          { cmd: "h2", label: "H2", aria: "Heading 2", tier: "extra" },
          { cmd: "h3", label: "H3", aria: "Heading 3", tier: "extra" }
        ],
        [
          { cmd: "insertUnorderedList", label: "Bullets", aria: "Bulleted list", tier: "main", icon: "bullets" },
          { cmd: "insertOrderedList", label: "Numbers", aria: "Numbered list", tier: "main", icon: "numbers" }
        ],
        [
          { cmd: "superscript", label: "Sup", aria: "Superscript (small raised text)", tier: "extra" },
          { cmd: "subscript", label: "Sub", aria: "Subscript (small lowered text)", tier: "extra" }
        ],
        [
          { cmd: "undo", label: "Undo", aria: "Undo", tier: "main", icon: "undo" },
          { cmd: "redo", label: "Redo", aria: "Redo", tier: "extra" }
        ]
      ];
      var extraItems = [
        { cmd: "h2", label: "H2", full: "Heading 2" },
        { cmd: "h3", label: "H3", full: "Heading 3" },
        { cmd: "superscript", label: "Sup", full: "Superscript" },
        { cmd: "subscript", label: "Sub", full: "Subscript" },
        { cmd: "redo", label: "Redo", full: "Redo" }
      ];
      var h = [];
      var i, j, g, b;
      var menuId = "rmdDocMoreMenu_" + slug(pid);
      h.push('<div class="rmd-doc-toolbar" role="group" aria-label="Document formatting">');
      for (i = 0; i < groups.length; i++) {
        g = groups[i];
        h.push('<div class="rmd-doc-group">');
        for (j = 0; j < g.length; j++) {
          b = g[j];
          h.push('<button type="button" class="rmd-doc-btn" data-doc-cmd="' + esc(b.cmd) + '" data-doc-tier="' + esc(b.tier) + '" aria-label="' + esc(b.aria) + '" title="' + esc(b.aria) + '">' + toolbarBtnContent(b) + '</button>');
        }
        h.push('</div>');
      }
      h.push('<div class="rmd-doc-more-wrap">');
      h.push('<button type="button" class="rmd-doc-btn rmd-doc-more-btn" data-doc-more="1" aria-haspopup="menu" aria-expanded="' + (state.moreOpen ? 'true' : 'false') + '" aria-controls="' + esc(menuId) + '" aria-label="More formatting options" title="More formatting">' + toolbarBtnContent({ label: "More", icon: "more" }) + '</button>');
      h.push('<div class="rmd-doc-more-menu" id="' + esc(menuId) + '" data-doc-more-menu="1" role="menu" aria-label="More formatting"' + (state.moreOpen ? '' : ' hidden') + '>');
      for (i = 0; i < extraItems.length; i++) {
        h.push('<button type="button" class="rmd-doc-menu-item" role="menuitem" data-doc-cmd="' + esc(extraItems[i].cmd) + '" aria-label="' + esc(extraItems[i].full) + '"><span>' + esc(extraItems[i].full) + '</span><span>' + esc(extraItems[i].label) + '</span></button>');
      }
      h.push('</div></div>');
      h.push('</div>');
      return h.join("");
    }

    function aiBarHtml() {
      if (SMD.ai && SMD.ai.barHtml) {
        return SMD.ai.barHtml(state.ai, { task: "manuscript_draft", label: "manuscript", cost: 2 });
      }
      return '<div class="rmd-ai-bar"><div class="rmd-ai-actions"><button type="button" class="rmd-doc-btn rmd-doc-btn-primary" data-doc-ai="ask">Ask MaiK to draft it</button></div><p class="rmd-ai-cost">Costs about 2 MaiK tokens</p></div>';
    }

    function bodyHtml(section, sub) {
      var h = [];
      h.push('<div class="rmd-doc-sub" data-doc-sub="' + esc(sub.id) + '">');
      if (!sub.overview && low(sub.title) !== low(section.title)) {
        h.push('<h5 class="rmd-doc-h3"><span>' + esc(sub.title) + '</span><span class="rmd-doc-words" data-doc-words="' + esc(sub.id) + '">0 words</span></h5>');
      } else if (sub.overview) {
        h.push('<h5 class="rmd-doc-h3"><span>Section text</span><span class="rmd-doc-words" data-doc-words="' + esc(sub.id) + '">0 words</span></h5>');
      }
      var subHasText = !!String(sub.html || "").replace(/<[^>]+>/g, " ").trim();
      if (state.ai && state.ai.drafted && state.ai.drafted[sub.id] && subHasText) {
        h.push('<span class="rmd-ai-note" data-rmd-ai-note="' + esc(sub.id) + '">Drafted by MaiK, check it</span>');
      }
      h.push('<div class="rmd-doc-body" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="true" data-doc-body="' + esc(sub.id) + '" data-doc-section="' + esc(section.id) + '" data-placeholder="Type here, or ask MaiK to draft it." aria-label="' + esc((sub.title || section.title) + " text") + '">' + sanitizeHtml(sub.html || "") + '</div>');
      h.push('</div>');
      return h.join("");
    }

    function allHtml() {
      var h = [];
      var i, j, sec, subs, hasAny;
      h.push('<div class="rmd-doc">');
      h.push('<div class="rmd-doc-head">');
      h.push('<div><h3 class="rmd-doc-title">Manuscript</h3><p class="rmd-doc-subtitle">' + esc(outline.name || "Reporting checklist") + '. Write each part here. The checklist marks an item filled when its part has text.</p></div>');
      h.push('<div class="rmd-doc-actions">');
      h.push('<button type="button" class="rmd-doc-btn rmd-doc-btn-primary" data-doc-save>Save</button>');
      h.push('<button type="button" class="rmd-doc-btn" data-doc-export>Download Word file</button>');
      h.push('</div></div>');
      h.push(aiBarHtml());
      h.push(toolbarHtml());
      h.push('<div class="rmd-doc-meta"><span data-doc-total>0 of ' + esc(limit) + ' words</span><span data-doc-over></span><span data-doc-notice role="status">' + esc(state.saveNotice) + '</span></div>');
      h.push('<div class="rmd-doc-scroll">');
      if (!outline.sections.length) {
        h.push('<p class="rmd-doc-empty">No checklist headings are available. Pick a guideline and try again.</p>');
      }
      for (i = 0; i < outline.sections.length; i++) {
        sec = outline.sections[i];
        var ds = null;
        for (j = 0; j < state.doc.sections.length; j++) {
          if (state.doc.sections[j].id === sec.id) { ds = state.doc.sections[j]; break; }
        }
        if (!ds) continue;
        h.push('<section class="rmd-doc-section" data-doc-section-wrap="' + esc(sec.id) + '">');
        h.push('<h4 class="rmd-doc-h2"><span>' + esc(sec.title) + '</span><span class="rmd-doc-words" data-doc-sec-words="' + esc(sec.id) + '">0 words</span></h4>');
        subs = ds.subheadings || [];
        hasAny = false;
        for (j = 0; j < subs.length; j++) {
          if (subs[j].overview && !hasText(subs[j].html)) continue;
          hasAny = true;
          h.push(bodyHtml(ds, subs[j]));
        }
        if (!hasAny) {
          for (j = 0; j < subs.length; j++) {
            if (!subs[j].overview) h.push(bodyHtml(ds, subs[j]));
          }
        }
        h.push('</section>');
      }
      h.push('</div></div>');
      return h.join("");
    }

    function setMoreOpen(open, restoreFocus) {
      var btn = host.querySelector("[data-doc-more]");
      var menu = host.querySelector("[data-doc-more-menu]");
      state.moreOpen = !!open;
      if (btn) btn.setAttribute("aria-expanded", state.moreOpen ? "true" : "false");
      if (menu) menu.hidden = !state.moreOpen;
      if (!state.moreOpen && restoreFocus && btn && btn.focus) {
        try { btn.focus(); } catch (e) {}
      }
    }

    function onDocKeyDown(ev) {
      if (!state.moreOpen) return;
      var k = ev.key || "";
      if (k === "Escape" || ev.keyCode === 27) {
        if (ev.stopPropagation) ev.stopPropagation();
        if (ev.preventDefault) ev.preventDefault();
        setMoreOpen(false, true);
        return;
      }
      var menu = host.querySelector("[data-doc-more-menu]");
      if (!menu) return;
      var items = menu.querySelectorAll("[role=\"menuitem\"]");
      if (!items.length) return;
      var idx = -1;
      for (var m = 0; m < items.length; m++) {
        if (items[m] === D.activeElement) { idx = m; break; }
      }
      if (k === "ArrowDown" || k === "ArrowUp" || k === "Home" || k === "End") {
        if (idx < 0 && D.activeElement !== host.querySelector("[data-doc-more]")) return;
        if (ev.preventDefault) ev.preventDefault();
        var next = 0;
        if (k === "End") next = items.length - 1;
        else if (k === "ArrowDown") next = idx < 0 ? 0 : (idx + 1) % items.length;
        else if (k === "ArrowUp") next = idx < 0 ? items.length - 1 : (idx - 1 + items.length) % items.length;
        if (items[next] && items[next].focus) items[next].focus();
      } else if (k === "Tab") {
        setMoreOpen(false, false);
      }
    }

    function onDocPointerDown(ev) {
      if (!state.moreOpen) return;
      var t = ev && ev.target;
      var wrap = host.querySelector(".rmd-doc-more-wrap");
      if (wrap && t && wrap.contains(t)) return;
      setMoreOpen(false, false);
    }

    function bindEvents() {
      var cmds = host.querySelectorAll("[data-doc-cmd]");
      var i;
      for (i = 0; i < cmds.length; i++) {
        cmds[i].onmousedown = function (e) {
          if (e.preventDefault) e.preventDefault();
        };
        cmds[i].onclick = function () {
          var inMenu = !!(this.closest && this.closest("[data-doc-more-menu]"));
          command(this.getAttribute("data-doc-cmd"));
          if (inMenu) setMoreOpen(false, false);
        };
      }
      var moreBtn = host.querySelector("[data-doc-more]");
      if (moreBtn) {
        moreBtn.onmousedown = function (e) {
          if (e.preventDefault) e.preventDefault();
        };
        moreBtn.onclick = function (e) {
          if (e && e.stopPropagation) e.stopPropagation();
          setMoreOpen(!state.moreOpen, false);
        };
      }
      if (D.addEventListener && !state.menuBound) {
        state.menuBound = true;
        D.addEventListener("keydown", onDocKeyDown, true);
        D.addEventListener("click", onDocPointerDown, true);
      }
      var saveBtn = host.querySelector("[data-doc-save]");
      if (saveBtn) saveBtn.onclick = function () { saveNow(); };
      var expBtn = host.querySelector("[data-doc-export]");
      if (expBtn) expBtn.onclick = function () { exportDocx(); };
      var bodies = host.querySelectorAll("[data-doc-body]");
      for (i = 0; i < bodies.length; i++) {
        bodies[i].onfocus = function () {
          state.activeBody = this;
          saveSelection();
        };
        bodies[i].oninput = function () {
          afterEdit(this);
        };
        bodies[i].onkeyup = function () { saveSelection(); };
        bodies[i].onmouseup = function () { saveSelection(); };
        bodies[i].onblur = function () { saveSelection(); };
        bodies[i].onpaste = function (ev) {
          pasteInto(this, ev);
        };
      }
      if (SMD.ai && SMD.ai.bind) {
        SMD.ai.bind(host, state.ai, {
          pid: apiPid,
          task: "manuscript_draft",
          label: "manuscript",
          cost: 2,
          request: requestDraft,
          apply: applyDraft,
          render: function () { renderAll(); }
        });
      } else {
        var ask = host.querySelector("[data-doc-ai=\"ask\"]");
        if (ask) {
          ask.onclick = function () {
            if (state.ai.busy) return;
            state.ai.busy = true;
            renderAll();
            requestDraft().then(function (res) {
              state.ai.busy = false;
              applyDraft(res && res.draft !== undefined ? res.draft : res);
              renderAll();
            }, function (err) {
              state.ai.busy = false;
              state.ai.error = err || { message: "MaiK could not draft the manuscript." };
              renderAll();
            });
          };
        }
      }
      var manualBtn = host.querySelector("[data-rmd-ai=\"manual\"]");
      if (manualBtn) {
        manualBtn.onclick = function () {
          var bodies = host.querySelectorAll("[data-doc-body]");
          var pick = bodies.length ? bodies[0] : null;
          var m;
          for (m = 0; m < bodies.length; m++) {
            if (!trim(bodies[m].textContent)) {
              pick = bodies[m];
              break;
            }
          }
          if (pick && pick.focus) {
            pick.focus();
            try {
              var reduce = !!(G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches);
              pick.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
            } catch (e4) {}
          }
        };
      }
      if (D.addEventListener && !state.selectionBound) {
        state.selectionBound = true;
        D.addEventListener("selectionchange", saveSelection);
      }
    }

    function renderAll() {
      host.innerHTML = allHtml();
      bindEvents();
      refreshCounts();
    }

    function ensureManuscript() {
      if (state.manuscript) return Promise.resolve(state.manuscript);
      if (state.manuscriptPromise) return state.manuscriptPromise;
      if (!SMD.api || !SMD.api.request) {
        state.manuscript = null;
        return Promise.resolve(null);
      }
      state.manuscriptPromise = SMD.api.request("GET", "/v1/projects/" + encodeURIComponent(apiPid) + "/manuscript").then(function (res) {
        state.manuscript = (res && res.manuscript) || null;
        state.manuscriptPromise = null;
        return state.manuscript;
      }, function () {
        state.manuscript = null;
        state.manuscriptPromise = null;
        return null;
      });
      return state.manuscriptPromise;
    }

    function serverSection(man, target) {
      if (!man || !isArr(man.sections)) return null;
      var i, s, sh;
      for (i = 0; i < man.sections.length; i++) {
        s = man.sections[i];
        if (!s) continue;
        if (s.id === target.id) return s;
      }
      for (i = 0; i < man.sections.length; i++) {
        s = man.sections[i];
        if (!s) continue;
        sh = normalizeText(s.heading || s.title || s.id || "");
        if (sh && (sh === normalizeText(target.heading) || sh.indexOf(normalizeText(target.heading)) !== -1)) return s;
      }
      return null;
    }

    function saveNow() {
      readDocFromDom();
      autosave();
      if (state.changeTimer) {
        clearTimeout(state.changeTimer);
        state.changeTimer = null;
      }
      if (options.onChange) options.onChange(state.doc, { totalWords: state.totalWords });
      mergeLocalManuscript(pid, docToSections(state.doc));
      setNotice("Saving...", "info");
      if (!SMD.api || !SMD.api.request) {
        setNotice("Saved on this device.", "info");
        if (options.onSave) options.onSave({ local: true });
        return;
      }
      ensureManuscript().then(function (man) {
        if (!man || !isArr(man.sections) || typeof man.version !== "number") {
          setNotice("Saved on this device.", "info");
          if (options.onSave) options.onSave({ local: true });
          return;
        }
        var targets = docToSections(state.doc);
        var work = [];
        var i, target, server;
        for (i = 0; i < targets.length; i++) {
          target = targets[i];
          server = serverSection(man, target);
          if (!server || !server.id) continue;
          work.push(SMD.api.request("PUT", "/v1/projects/" + encodeURIComponent(apiPid) + "/manuscript/sections/" + encodeURIComponent(server.id), {
            version: man.version,
            heading: target.heading,
            text: target.text
          }));
        }
        if (!work.length) {
          setNotice("Saved on this device.", "info");
          if (options.onSave) options.onSave({ local: true });
          return;
        }
        Promise.all(work).then(function () {
          setNotice("Saved.", "info");
          if (options.onSave) options.onSave({ local: false });
        }, function () {
          setNotice("Saved on this device.", "info");
          if (options.onSave) options.onSave({ local: true });
        });
      });
    }

    function requestDraft() {
      if (!SMD.api || !SMD.api.request) {
        return Promise.reject({ message: "The research API is not available." });
      }
      var input = {
        title: projectTitle,
        studyType: (proj && (proj.studyType || proj.study_type)) || "",
        researchQuestion: (proj && proj.researchQuestion) || ""
      };
      var journal = proj && (proj.targetJournal || proj.journal);
      if (journal) input.journalId = journal;
      return SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(apiPid) + "/ai-draft", {
        task: "manuscript_draft",
        input: input
      }, { timeout: 90000 }).catch(function (err) {
        throw err || { message: "MaiK could not draft the manuscript." };
      });
    }

    function applyDraft(draft) {
      readDocFromDom();
      var d = draft || {};
      var secs = d.sections;
      var srcs = sourceSections(secs);
      var hasAnySourceText = false;
      var i;
      for (i = 0; i < srcs.length; i++) {
        if (String(srcs[i].text || "").trim()) { hasAnySourceText = true; break; }
      }
      if (!hasAnySourceText) {
        return [];
      }
      var filled = applySources(state.doc, outline, secs, true);
      for (i = 0; i < filled.length; i++) state.ai.drafted[filled[i]] = 1;
      autosave();
      refreshCounts();
      if (filled.length) {
        setNotice("Drafted by MaiK. Check each marked section.", "info");
      } else {
        d._alreadyFilled = true;
        setNotice("Every section already has text.", "info");
      }
      scheduleChange();
      return filled;
    }

    function exportDocx() {
      readDocFromDom();
      if (!SMD.docxFromSections || !SMD.p2 || !SMD.p2.downloadBytes) {
        setNotice("The Word export is not available. Update the app and reopen ResearchMD.", "error");
        return;
      }
      var sections = docxSections(state.doc);
      var any = false;
      var i;
      for (i = 0; i < sections.length; i++) {
        if (trim(sections[i].text)) { any = true; break; }
      }
      if (!any) {
        setNotice("Write something first.", "error");
        return;
      }
      var bytes = SMD.docxFromSections(projectTitle, sections);
      var name = (SMD.p2.fileSlug ? SMD.p2.fileSlug(projectTitle, "manuscript") : "manuscript") + "-manuscript.docx";
      SMD.p2.downloadBytes(name, bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", projectTitle).then(function () {
        setNotice("Your file is ready to save or share.", "info");
      }, function (err) {
        setNotice((SMD.p2.friendlyError && SMD.p2.friendlyError(err).message) || "The file could not be saved.", "error");
      });
    }

    function scrollToSub(sid) {
      var el = host.querySelector('[data-doc-sub="' + sid + '"]');
      if (!el) return false;
      try {
        var reduce = false;
        try {
          reduce = !!(G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches);
        } catch (e) {}
        el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
        el.className = (el.className || "") + " rmd-doc-target";
        setTimeout(function () {
          el.className = String(el.className || "").replace(/\s*rmd-doc-target/g, "");
        }, 1400);
        return true;
      } catch (e2) {
        try {
          el.scrollIntoView();
          return true;
        } catch (e3) {}
      }
      return false;
    }

    function getDoc() {
      readDocFromDom();
      return state.doc;
    }

    function destroy() {
      if (state.autosaveTimer) clearTimeout(state.autosaveTimer);
      if (state.changeTimer) clearTimeout(state.changeTimer);
      if (D && D.removeEventListener) {
        D.removeEventListener("selectionchange", saveSelection);
        if (state.menuBound) {
          D.removeEventListener("keydown", onDocKeyDown, true);
          D.removeEventListener("click", onDocPointerDown, true);
          state.menuBound = false;
        }
      }
    }

    renderAll();
    return {
      getDoc: getDoc,
      scrollToSub: scrollToSub,
      save: saveNow,
      exportDocx: exportDocx,
      destroy: destroy
    };
  }

  var API = {
    name: NAME,
    version: VERSION,
    DOC_KEY: DOC_KEY,
    MAN_KEY: MAN_KEY,
    THESIS_KEY: THESIS_KEY,
    outlineFor: outlineFor,
    emptyDoc: emptyDoc,
    syncDoc: syncDoc,
    sourceSections: sourceSections,
    applySources: applySources,
    docToSections: docToSections,
    docxSections: docxSections,
    sanitizeHtml: sanitizeHtml,
    htmlToText: htmlToText,
    textToHtml: textToHtml,
    countWords: countWords,
    statusForWords: statusForWords,
    manuscriptIdFor: manuscriptIdFor,
    render: render
  };

  if (typeof module !== "undefined" && module.exports) { module.exports = API; }
  if (G) G.SMD_RESEARCH_DOC = API;

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));