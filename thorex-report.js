/* thorex-report.js — ThoreX AI · deterministic structured report/impression generator (SMD_THOREX_REPORT).
 *
 * buildReport(analysis, opts) -> { sections, order, text, html } — a PURE, deterministic function.
 * No LLM, no network, no randomness, no wall-clock dependence in the content itself. This is the base
 * layer described in the ThoreX report spec: an LLM may later polish the narrative, but this module
 * must always be able to produce a valid, safe, structured report entirely on its own.
 *
 * Source of truth: the CLINICAL (non-educational) engine only — `analysis.engines[]` entries with
 * `educational === false` (mirrors thorex-models.js `clinicalEngine()`). The educational (X-Raydar)
 * engine, if present, is surfaced ONLY in a clearly-labelled "Educational (not for clinical use)"
 * appendix — it never drives Impression, Recommendations, or Urgency (per the ThoreX §3.4 "Learning
 * engine drives no clinical action" rule already enforced in thorex-screens.js's buildPanelModels()).
 *
 * Sections (see SECTION_ORDER below): Clinical information, Technique, Image quality, Findings,
 * Impression, Recommendations, Urgency, Follow-up. Each is deterministic and derived only from the
 * `analysis` object (+ opts.context for the first section) — never invented.
 *
 * Dual export: `window.SMD_THOREX_REPORT` in the browser, `module.exports` in node (test-only; the
 * generator itself never touches the DOM).
 */
(function () {
  "use strict";

  function str(v) { return typeof v === "string" ? v : ""; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function clamp01(n) { n = +n; return n < 0 ? 0 : n > 1 ? 1 : (isFinite(n) ? n : 0); }
  function pctOf(prob) { return (prob == null || !isFinite(+prob)) ? null : Math.round(clamp01(prob) * 100); }

  // Sign-vs-diagnosis relabel — kept in sync with thorex-models.js LABEL_DISPLAY (duplicated here on
  // purpose so this generator stays dependency-free/pure; test pins both so they can't drift).
  var LABEL_DISPLAY = { "Emphysema": "Hyperinflation (possible emphysema)" };
  function displayLabel(l) { l = str(l); return LABEL_DISPLAY.hasOwnProperty(l) ? LABEL_DISPLAY[l] : l; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // Mandatory safety disclaimer — verbatim copy of the string in thorex-screens.js's
  // MANDATORY_DISCLAIMER (kept as an independent literal here so this module has zero dependency on
  // thorex-screens.js and stays purely a function of `analysis`; test/thorex-report.test.js and
  // test/thorex-screens-helpers.test.js both pin this exact string so the two can never drift apart
  // unnoticed).
  var MANDATORY_DISCLAIMER =
    "AI-generated findings are intended to assist qualified healthcare professionals and must always be interpreted in conjunction with clinical assessment, radiologist review where appropriate, laboratory findings and other investigations.";

  // ── Severity presentation (label only — mirrors thorex-screens.js SEV, duplicated intentionally so
  // this module never requires thorex-screens.js). ──
  var SEV_LABEL = { critical: "Critical", urgent: "Urgent", warn: "Caution", stable: "Stable", info: "Info" };
  function severityLabel(sev) { return SEV_LABEL.hasOwnProperty(sev) ? SEV_LABEL[sev] : SEV_LABEL.info; }

  // Worst-first severity ranking (lower = more severe) — mirrors thorex-screens.js SEV_RANK.
  var SEV_RANK = { critical: 0, urgent: 1, warn: 2, info: 3, stable: 4 };
  function severityRank(sev) { return SEV_RANK.hasOwnProperty(sev) ? SEV_RANK[sev] : 98; }

  // Confidence-band ordering: High -> Medium -> Low -> unbanded (findings with no band at all, e.g.
  // a plain screening/negative statement, sort last and are never treated as "high confidence").
  function bandRank(b) { return b === "High" ? 0 : b === "Medium" ? 1 : b === "Low" ? 2 : 3; }

  // ── Pull the clinical (non-educational) and learning (educational) engines straight off the
  // analysis, matching thorex-models.js clinicalEngine()/learningEngine() predicates exactly, without
  // requiring that module (keeps this generator dependency-free/pure). ──
  function clinicalEngineOf(a) {
    var engines = arr(a && a.engines);
    for (var i = 0; i < engines.length; i++) if (engines[i] && engines[i].educational === false) return engines[i];
    return null;
  }
  function learningEngineOf(a) {
    var engines = arr(a && a.engines);
    for (var i = 0; i < engines.length; i++) if (engines[i] && engines[i].educational === true) return engines[i];
    return null;
  }

  function sortedByBand(findings) {
    // Array.prototype.sort is stable per spec (ES2019+/Node current) — findings sharing a band keep
    // their original (engine-reported) relative order.
    return findings.slice().sort(function (x, y) { return bandRank(x.band) - bandRank(y.band); });
  }

  function labelsOf(findings) { return findings.map(function (f) { return f.label; }).join(", "); }

  /* ══════════════════════════════ Clinical information ══════════════════════════════════════════ */
  function buildClinicalInformation(opts) {
    var ctx = opts && typeof opts.context === "string" ? opts.context.trim() : "";
    return ctx || "Not provided";
  }

  /* ══════════════════════════════════════ Technique ═════════════════════════════════════════════ */
  function buildTechnique(clinical) {
    // Brand-neutral: the unified report is presented as "ThoreX AI" (per-version engine names live in
    // the collapsible version panels on the result screen, not in the radiology report itself).
    return "AI-assisted interpretation of a single frontal chest radiograph by ThoreX AI. Findings are screening-level and require radiologist confirmation.";
  }

  /* ═══════════════════════════════════ Image quality ════════════════════════════════════════════ */
  function issueText(it) {
    if (typeof it === "string") return it;
    if (it && typeof it === "object") return str(it.detail) || str(it.label) || "";
    return "";
  }
  function buildImageQuality(a) {
    var q = a && a.quality;
    if (!q) return "Image quality was not assessed for this analysis.";
    var view = str(q.view) || "Unspecified view";
    var issues = arr(q.issues).map(issueText).filter(Boolean);
    var lead;
    if (q.adequate === false) lead = "View: " + view + ". Image quality flagged as NOT adequate for reliable interpretation.";
    else if (q.adequate === true) lead = "View: " + view + ". Adequate for interpretation.";
    else lead = "View: " + view + ". Adequacy not explicitly reported.";
    return issues.length ? (lead + " Issues noted: " + issues.join("; ") + ".") : lead;
  }

  /* ═══════════════════════════════════════ Findings ═════════════════════════════════════════════ */
  function buildFindingsItems(findings, keepOrder) {
    return (keepOrder ? arr(findings) : sortedByBand(findings)).map(function (f) {
      return {
        label: displayLabel(f.label),
        band: f.band == null ? null : str(f.band),
        severity: str(f.severity) || "info",
        severityLabel: severityLabel(f.severity),
        relevance: str(f.relevance),
        prob: (f.prob == null || !isFinite(+f.prob)) ? null : +f.prob,
        confPct: pctOf(f.prob)
      };
    });
  }

  /* ═══════════════════════════════════ Differential diagnosis ════════════════════════════════════
   * The ranked findings re-presented as diagnostic considerations, each with the AI confidence % (raw
   * model confidence, NOT a calibrated posterior). "Clinical correlation advised" is appended verbatim
   * — a single frontal film is screening-level; every consideration needs correlation. */
  // Radiographic finding → candidate DISEASES (a real differential, not a re-listing of the sign).
  // Infectious causes are called out because a sign like a cavity is most urgently an infection until
  // proven otherwise. Deterministic, screening-level; every item still needs clinical correlation.
  var DDX_RULES = [
    { re: /cavity|cavit/i, dx: "Lung abscess, pulmonary tuberculosis, cavitating bronchogenic carcinoma, fungal infection (aspergilloma/mucormycosis), septic pulmonary emboli, necrotizing pneumonia (Klebsiella/Staph/anaerobes), granulomatosis with polyangiitis" },
    { re: /\bmass\b/i, dx: "Bronchogenic carcinoma, metastasis, lung abscess, granuloma (TB/fungal), hamartoma, hydatid cyst, round pneumonia" },
    { re: /nodule/i, dx: "Granuloma (TB/histoplasmosis), primary or metastatic malignancy, hamartoma, rheumatoid nodule, arteriovenous malformation, early abscess" },
    { re: /consolidation|airspace|air ?bronchogram/i, dx: "Bacterial pneumonia, tuberculosis, aspiration pneumonia, organizing pneumonia, pulmonary infarction, alveolar haemorrhage, lymphoma" },
    { re: /pneumonia/i, dx: "Bacterial (S. pneumoniae, Klebsiella, Staph), atypical (Mycoplasma, Legionella, Chlamydia), viral (influenza/COVID), tuberculosis, fungal, PJP if immunocompromised" },
    { re: /infiltrat|lung opacity|opacit/i, dx: "Pneumonia (bacterial/viral/atypical), pulmonary oedema, tuberculosis, aspiration, interstitial lung disease, pulmonary haemorrhage" },
    { re: /effusion/i, dx: "Parapneumonic effusion / empyema, tuberculous pleuritis, malignant effusion, heart failure, pulmonary embolism, hepatic hydrothorax" },
    { re: /pneumothorax/i, dx: "Spontaneous (tall/thin, ruptured bleb), secondary (COPD, TB, PCP, cavitating infection), traumatic, iatrogenic" },
    { re: /edema|oedema/i, dx: "Cardiogenic pulmonary oedema (heart failure), ARDS, fluid overload / renal failure, neurogenic oedema" },
    { re: /cardiomegaly/i, dx: "Heart failure, dilated cardiomyopathy, pericardial effusion, valvular heart disease" },
    { re: /atelectasis/i, dx: "Mucus plugging, obstructing tumour or foreign body, compressive (effusion/mass), post-operative hypoventilation" },
    { re: /fibrosis|interstitial|reticular/i, dx: "Idiopathic pulmonary fibrosis, connective-tissue-disease ILD, chronic hypersensitivity pneumonitis, post-TB fibrosis, pneumoconiosis, drug-induced" },
    { re: /emphysema|hyperinflat/i, dx: "COPD / emphysema, asthma, bronchiolitis, α1-antitrypsin deficiency" },
    { re: /hilar|adenopathy|lymph/i, dx: "Sarcoidosis, tuberculosis, lymphoma, metastatic nodal disease, fungal infection" },
    { re: /fracture/i, dx: "Traumatic fracture; if atraumatic consider pathological fracture (metastasis, myeloma)" },
    { re: /pleural thickening/i, dx: "Sequela of prior infection / empyema, tuberculosis, asbestos exposure, mesothelioma" }
  ];
  function ddxFor(label) {
    label = str(label);
    for (var i = 0; i < DDX_RULES.length; i++) if (DDX_RULES[i].re.test(label)) return DDX_RULES[i].dx;
    return null;
  }
  function buildDifferential(findingItems) {
    return findingItems.map(function (it) {
      return { label: it.label, confPct: it.confPct, band: it.band, severityLabel: it.severityLabel, dx: ddxFor(it.label) };
    });
  }

  /* ══════════════════════════════════════ Impression ════════════════════════════════════════════ */
  // Confidence tiers for the IMPRESSION (main line), by AI confidence %:
  //   >75%  -> may be read as a working diagnosis (pending radiologist confirmation)
  //   50-75% -> differential consideration, correlate clinically
  //   <=50% -> below the level suggesting acute abnormality; the study MAY BE NORMAL
  // Findings with no per-finding % (legacy records) fall back to the band word.
  function tierOfItem(f) {
    var p = f.confPct;
    if (p == null) return f.band === "High" ? "diagnosis" : (f.band === "Medium" ? "consider" : "low");
    if (p > 75) return "diagnosis";
    if (p > 50) return "consider";
    return "low";
  }
  function buildImpression(findings) {
    var diag = findings.filter(function (f) { return tierOfItem(f) === "diagnosis"; });
    var consider = findings.filter(function (f) { return tierOfItem(f) === "consider"; });
    var low = findings.filter(function (f) { return tierOfItem(f) === "low"; });
    var parts = [];
    if (diag.length) parts.push("Findings support " + labelsOf(diag) + " (>75% AI confidence) — may be read as a working diagnosis pending radiologist confirmation.");
    if (consider.length) parts.push("Differential consideration" + (consider.length > 1 ? "s" : "") + ": " + labelsOf(consider) + " (50–75% AI confidence) — correlate clinically.");
    if (!diag.length && !consider.length) {
      // Nothing above 50% → say plainly the study may be normal (a hyperinflated-but-borderline film reads clean).
      var normal = "No finding reached a confidence level suggesting an acute abnormality — the study may be normal.";
      if (low.length) normal += " Low-confidence (≤50%): " + labelsOf(low) + " — likely incidental/borderline; correlate only if clinically relevant.";
      parts.push(normal);
    } else if (low.length) {
      parts.push("Low-confidence (≤50%): " + labelsOf(low) + ".");
    }
    return parts.join(" ");
  }

  /* ═══════════════════════════════════ Recommendations ══════════════════════════════════════════
   * A deterministic rule map keyed on the shared finding labels (see backend/thorex RELEVANCE labels
   * and the mock/live engine label vocabulary in thorex-providers.js). Only applied to findings with
   * an actual confidence band (High/Medium) — a null-band screening statement (e.g. "No acute
   * cardiopulmonary abnormality") never triggers a recommendation. */
  var RECOMMENDATION_RULES = [
    { re: /pneumonia|consolidation|infiltrate|airspace opacity|lung opacity|air bronchogram/i,
      rec: "Correlate with WBC/CRP/procalcitonin; consider antibiotics per local antimicrobial-stewardship guidance if clinically indicated." },
    { re: /effusion/i,
      rec: "Assess effusion size and laterality; consider bedside ultrasound and clinical correlation." },
    { re: /pneumothorax/i,
      rec: "Urgent clinical correlation; evaluate for tension physiology and need for immediate decompression." },
    { re: /nodule|mass/i,
      rec: "Compare with prior imaging if available; consider dedicated follow-up imaging (e.g. CT) per incidental-pulmonary-nodule guidelines." },
    { re: /edema/i,
      rec: "Correlate with BNP, echocardiogram/ejection fraction, and volume status." },
    { re: /cardiomegaly/i,
      rec: "Correlate clinically; consider echocardiogram if not already performed." },
    { re: /atelectasis/i,
      rec: "Consider incentive spirometry/repositioning; correlate clinically to exclude mucus plugging." },
    { re: /fibrosis|interstitial/i,
      rec: "Consider pulmonary function tests and comparison with prior imaging to assess chronicity." },
    { re: /fracture/i,
      rec: "Correlate clinically; consider dedicated rib/skeletal imaging if trauma is suspected." },
    { re: /cavity/i,
      rec: "Consider TB workup, sputum culture, and comparison with prior imaging." }
  ];
  function buildRecommendations(findings) {
    var actionable = findings.filter(function (f) { return f.band === "High" || f.band === "Medium"; });
    var recs = [];
    actionable.forEach(function (f) {
      RECOMMENDATION_RULES.forEach(function (r) {
        if (r.re.test(f.label) && recs.indexOf(r.rec) < 0) recs.push(r.rec);
      });
    });
    if (!recs.length) recs.push("Clinical correlation recommended; no finding-specific recommendation was triggered by this result.");
    return recs;
  }

  /* ═══════════════════════════════════════ Urgency ═══════════════════════════════════════════════ */
  function worstSeverityOf(findings) {
    var worst = null, rank = 99;
    findings.forEach(function (f) {
      var r = severityRank(f.severity);
      if (r < rank) { rank = r; worst = f.severity; }
    });
    return worst;
  }
  function urgencyBucket(worst) {
    if (worst === "critical" || worst === "urgent") return "urgent";
    if (worst === "warn") return "timely";
    return "routine";
  }
  var URGENCY_TEXT = { urgent: "Urgent — correlate immediately.", timely: "Timely correlation.", routine: "Routine." };

  /* ══════════════════════════════════════ Follow-up ══════════════════════════════════════════════ */
  function buildFollowUp(findings, bucket) {
    if (bucket === "urgent") return "Urgent clinical correlation and radiologist review without delay.";
    var hasNoduleOrMass = findings.some(function (f) {
      return /nodule|mass/i.test(f.label) && (f.band === "High" || f.band === "Medium");
    });
    if (hasNoduleOrMass) return "Follow-up imaging and/or prior-study comparison as clinically indicated; radiologist review.";
    return "Clinical correlation and radiologist review.";
  }

  /* ══════════════════════════════════ Educational appendix ══════════════════════════════════════ */
  function buildEducational(learning) {
    var findings = arr(learning && learning.findings);
    if (!learning || !findings.length) return null;
    return {
      title: "Educational (not for clinical use)",
      items: sortedByBand(findings).map(function (f) { return { label: displayLabel(f.label), band: f.band == null ? null : str(f.band) }; })
    };
  }

  var SECTION_ORDER = ["clinicalInformation", "technique", "imageQuality", "findings", "impression", "differential", "recommendations", "urgency", "followUp"];
  var SECTION_TITLES = {
    clinicalInformation: "Clinical information",
    technique: "Technique",
    imageQuality: "Image quality",
    findings: "Findings",
    impression: "Impression",
    differential: "Differential diagnosis",
    recommendations: "Recommendations",
    urgency: "Urgency",
    followUp: "Follow-up"
  };

  /* ══════════════════════════════════════ buildReport ═══════════════════════════════════════════ */
  // opts.engineScope: "clinical" (default, Engine 1 only) | "educational" (Engine 2 only) | "both".
  function buildReport(analysis, opts) {
    analysis = analysis || {};
    opts = opts || {};
    var scope = (opts.engineScope === "educational" || opts.engineScope === "both") ? opts.engineScope : "clinical";
    var clinical = clinicalEngineOf(analysis);
    var learning = learningEngineOf(analysis);
    // Engine 2 (educational) is the PRIMARY read whenever it's in scope. For "both", ALL Engine 2
    // findings lead (band-sorted), then Engine 1's extra findings — so Engine 2 is always the main Dx
    // (its top finding drives the Impression); Engine 1 only supplements what Engine 2 didn't flag.
    var rawFindings, keepOrder = false;
    if (scope === "educational") {
      rawFindings = sortedByBand(arr(learning && learning.findings)); keepOrder = true;
    } else if (scope === "both") {
      var eduF = sortedByBand(arr(learning && learning.findings));
      var seen = {}; eduF.forEach(function (f) { seen[str(f.label).toLowerCase()] = 1; });
      var clinUnique = sortedByBand(arr(clinical && clinical.findings)).filter(function (f) { return !seen[str(f.label).toLowerCase()]; });
      rawFindings = eduF.concat(clinUnique); keepOrder = true;
    } else {
      rawFindings = arr(clinical && clinical.findings);
    }
    var findingItems = buildFindingsItems(rawFindings, keepOrder);
    var bucket = urgencyBucket(worstSeverityOf(findingItems));
    var recs = buildRecommendations(findingItems);
    var differential = buildDifferential(findingItems);
    // The educational appendix only makes sense when the body is clinical-only; for educational/both the
    // Engine 2 findings already drive the main report.
    var educational = scope === "clinical" ? buildEducational(learning) : null;

    var engineLabel = scope === "educational" ? "ThoreX Clinical Engine 2 (educational)"
      : scope === "both" ? "ThoreX Clinical Engine 2 (primary, educational) + Engine 1"
      : "ThoreX Clinical Engine 1";
    var sections = {
      clinicalInformation: { title: SECTION_TITLES.clinicalInformation, text: buildClinicalInformation(opts) },
      technique: { title: SECTION_TITLES.technique, text: buildTechnique(clinical) + " Source: " + engineLabel + "." },
      imageQuality: { title: SECTION_TITLES.imageQuality, text: buildImageQuality(analysis) },
      findings: { title: SECTION_TITLES.findings, items: findingItems },
      impression: { title: SECTION_TITLES.impression, text: buildImpression(findingItems) },
      differential: { title: SECTION_TITLES.differential, items: differential },
      recommendations: { title: SECTION_TITLES.recommendations, items: recs },
      urgency: { title: SECTION_TITLES.urgency, text: URGENCY_TEXT[bucket], bucket: bucket },
      followUp: { title: SECTION_TITLES.followUp, text: buildFollowUp(findingItems, bucket) }
    };
    if (educational) sections.educational = educational;

    return {
      sections: sections,
      order: SECTION_ORDER,
      disclaimer: MANDATORY_DISCLAIMER,
      text: renderText(sections, educational),
      html: renderHtml(sections, educational)
    };
  }

  /* ══════════════════════════════════════ Plain-text render ═════════════════════════════════════ */
  function renderText(sections, educational) {
    var lines = ["THOREX AI — STRUCTURED CHEST RADIOGRAPH REPORT", ""];
    SECTION_ORDER.forEach(function (key) {
      var s = sections[key];
      lines.push(s.title.toUpperCase());
      if (key === "findings") {
        if (!s.items.length) {
          lines.push("No findings reported by the AI for this analysis.");
        } else {
          var lastBand;
          s.items.forEach(function (it) {
            if (it.band !== lastBand) { lines.push("[" + (it.band || "Not banded") + " confidence]"); lastBand = it.band; }
            lines.push("- " + it.label + " (" + it.severityLabel + ")" + (it.relevance ? " — " + it.relevance : ""));
          });
        }
      } else if (key === "differential") {
        if (!s.items.length) {
          lines.push("No differential considerations crossed the AI operating threshold.");
        } else {
          s.items.forEach(function (d) {
            lines.push("- " + d.label + (d.confPct != null ? " — " + d.confPct + "% AI confidence" : "") + (d.band ? " (" + d.band + ")" : ""));
            if (d.dx) lines.push("    Consider: " + d.dx + ".");
          });
        }
        lines.push("Clinical correlation advised.");
      } else if (key === "recommendations") {
        s.items.forEach(function (r) { lines.push("- " + r); });
      } else {
        lines.push(s.text);
      }
      lines.push("");
    });
    if (educational) {
      lines.push(educational.title.toUpperCase());
      educational.items.forEach(function (it) { lines.push("- " + it.label + (it.band ? " (" + it.band + ")" : "")); });
      lines.push("");
    }
    lines.push(MANDATORY_DISCLAIMER);
    return lines.join("\n") + "\n";
  }

  /* ═══════════════════════════════════════ HTML render ═══════════════════════════════════════════
   * Styled `.tx-report` block, meant to be dropped straight into the ThoreX result screen (see
   * thorex-screens.css for the .tx-report* rules) — inert markup only, no inline event handlers, safe
   * to set via innerHTML. */
  function renderHtml(sections, educational) {
    function textSection(key) {
      var s = sections[key];
      return '<section class="tx-report-sec"><h4 class="tx-report-h">' + esc(s.title) + '</h4>' +
        '<p class="tx-report-p">' + esc(s.text) + '</p></section>';
    }
    function findingsSection() {
      var s = sections.findings;
      var body;
      if (!s.items.length) {
        body = '<p class="tx-report-p">No findings reported by the AI for this analysis.</p>';
      } else {
        var lastBand, out = "";
        s.items.forEach(function (it) {
          if (it.band !== lastBand) {
            if (lastBand !== undefined) out += "</ul>";
            out += '<div class="tx-report-band">' + esc(it.band || "Not banded") + " confidence</div><ul class=\"tx-report-list\">";
            lastBand = it.band;
          }
          out += '<li><b>' + esc(it.label) + '</b> <span class="tx-report-sevtag">' + esc(it.severityLabel) + '</span>' +
            (it.relevance ? ' — ' + esc(it.relevance) : '') + '</li>';
        });
        out += "</ul>";
        body = out;
      }
      return '<section class="tx-report-sec"><h4 class="tx-report-h">' + esc(s.title) + '</h4>' + body + '</section>';
    }
    function recsSection() {
      var s = sections.recommendations;
      return '<section class="tx-report-sec"><h4 class="tx-report-h">' + esc(s.title) + '</h4>' +
        '<ul class="tx-report-list">' + s.items.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join("") + '</ul></section>';
    }
    function differentialSection() {
      var s = sections.differential;
      var body;
      if (!s.items.length) {
        body = '<p class="tx-report-p">No differential considerations crossed the AI operating threshold.</p>';
      } else {
        body = '<ul class="tx-report-list tx-report-ddx">' + s.items.map(function (d) {
          var conf = (d.confPct != null) ? '<span class="tx-report-conf">' + d.confPct + '%</span>' : '';
          var band = d.band ? ' <span class="tx-report-sevtag">' + esc(d.band) + '</span>' : '';
          var dxLine = d.dx ? '<div class="tx-report-ddx-dx">Consider: ' + esc(d.dx) + '.</div>' : '';
          return '<li><div class="tx-report-ddx-top"><span class="tx-report-ddx-name"><b>' + esc(d.label) + '</b>' + band + '</span>' + conf + '</div>' + dxLine + '</li>';
        }).join("") + '</ul>';
      }
      return '<section class="tx-report-sec"><h4 class="tx-report-h">' + esc(s.title) + '</h4>' + body +
        '<p class="tx-report-p tx-report-corr">Clinical correlation advised.</p></section>';
    }
    function impressionSection() {
      var s = sections.impression;
      return '<section class="tx-report-sec"><h4 class="tx-report-h">' + esc(s.title) + '</h4>' +
        '<p class="tx-report-p tx-report-impression">' + esc(s.text) + '</p></section>';
    }
    var body = SECTION_ORDER.map(function (key) {
      if (key === "findings") return findingsSection();
      if (key === "impression") return impressionSection();
      if (key === "differential") return differentialSection();
      if (key === "recommendations") return recsSection();
      return textSection(key);
    }).join("");
    var eduHtml = educational ?
      '<section class="tx-report-sec tx-report-edu"><h4 class="tx-report-h">' + esc(educational.title) + '</h4>' +
        '<ul class="tx-report-list">' + educational.items.map(function (it) {
          return '<li>' + esc(it.label) + (it.band ? ' <span class="tx-report-sevtag">' + esc(it.band) + '</span>' : '') + '</li>';
        }).join("") + '</ul></section>' : "";
    // NB: no in-report disclaimer here — the result screen shows the mandatory disclaimer ONCE at its
    // footer (avoids the disclaimer repeating in every sub-section). The plain-text report + the
    // professional export document each still carry it (standalone artifacts).
    return '<div class="tx-report">' +
      '<h3 class="tx-report-title">ThoreX AI — Radiology report</h3>' +
      body + eduHtml +
    '</div>';
  }

  /* ═══════════════════════════ Professional print/PDF document ═══════════════════════════════════
   * A self-contained, print-ready branded report (StewardMD letterhead, teal borders, embedded X-ray,
   * mandatory warning, signature block) — the document the Export/Share action produces. Pure: given the
   * analysis + opts (context, logoDataUrl, xrayDataUrl, createdAt) it returns a full HTML string that
   * renders identically on device, in an iframe (web print), or as a shared file (iOS Print → Save PDF). */
  var PRO_CSS =
    "*{box-sizing:border-box}" +
    "body{margin:0;background:#eef2f4;color:#0f172a;font:400 13px/1.55 -apple-system,'Segoe UI',Roboto,system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
    ".page{max-width:820px;margin:14px auto;background:#fff;border:2px solid #0f766e;border-radius:6px;overflow:hidden}" +
    ".hdr{display:flex;align-items:center;gap:14px;padding:16px 22px;background:linear-gradient(90deg,#0f766e,#0d9488)}" +
    ".hdr .logo{width:46px;height:46px;border-radius:10px;background:#fff;padding:4px;object-fit:contain}" +
    ".hdr-txt{flex:1;color:#fff}.brand{font-weight:800;font-size:22px;letter-spacing:-.01em}.tag{font-size:12px;font-weight:600;opacity:.92}" +
    ".hdr-right{text-align:right;color:#fff}.hr-l{font-weight:800;font-size:12px;letter-spacing:.06em}.hr-s{font-size:11px;opacity:.9}" +
    ".rule{height:5px;background:repeating-linear-gradient(90deg,#0f766e 0 18px,#5eead4 18px 26px)}" +
    ".meta{padding:12px 22px;border-bottom:1px solid #e2e8f0}.meta>div{margin-bottom:5px}" +
    ".meta .ml{display:inline-block;min-width:118px;font-weight:800;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#0f766e;vertical-align:top}" +
    ".meta .mv{font-size:12.5px;color:#334155}" +
    "h1{font-size:17px;text-align:center;margin:16px 22px 2px;letter-spacing:.02em}.h1sub{text-align:center;font-size:11.5px;color:#64748b;margin:0 22px 6px}" +
    ".xray{margin:12px 22px;text-align:center}.xray img{max-width:100%;max-height:360px;border:1px solid #0f766e;border-radius:6px;background:#000}" +
    ".xcap{font-size:10.5px;color:#64748b;margin-top:4px}" +
    "h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#0f766e;border-bottom:1.5px solid #0f766e;padding-bottom:3px;margin:16px 22px 8px}" +
    "ul{margin:0 22px 8px;padding-left:20px}li{margin-bottom:4px}" +
    ".impression{margin:0 22px 8px;font-weight:800}" +
    ".aibox{margin:0 22px 6px;padding:11px 13px;border:1.5px solid #0f766e;border-radius:8px;background:#f0fbf9;font-size:12.5px;line-height:1.6;color:#0f172a;font-weight:600}.aibrand{font-size:10px;color:#0f766e;font-weight:800;letter-spacing:.05em;margin:4px 22px 8px;text-transform:uppercase}" +
    ".ddx li{margin-bottom:6px}.ddx .conf{font-weight:800;color:#0f766e}.ddx .band{font-size:11px;color:#64748b}.ddx .ddxdx{font-size:11.5px;line-height:1.5;color:#475569;margin-top:2px}" +
    ".warn{margin:14px 22px;padding:12px 14px;border:1.5px solid #b45309;background:#fffbeb;border-radius:8px;font-size:11.5px;line-height:1.5;color:#7c2d12;display:flex;flex-direction:column;gap:4px}.warn b{color:#b45309}" +
    ".sign{display:flex;gap:30px;margin:24px 22px 6px}.sig{flex:1;font-size:11px;color:#64748b}.sig-line{border-top:1.5px solid #94a3b8;margin-bottom:5px;height:24px}" +
    ".foot{display:flex;justify-content:space-between;gap:8px;padding:12px 22px;margin-top:10px;border-top:3px solid #0f766e;font-size:10.5px;color:#64748b;background:#f8fafc}" +
    "@page{margin:10mm}@media print{body{background:#fff}.page{margin:0;border:2px solid #0f766e}}";

  function buildProDocument(analysis, opts) {
    opts = opts || {};
    var rep = buildReport(analysis, opts);
    var S = rep.sections;
    var logo = str(opts.logoDataUrl);
    var xray = str(opts.xrayDataUrl);
    var created = str(opts.createdAt);
    var aiDdx = str(opts.aiDdx);

    var findItems = arr(S.findings.items);
    var findingsList = findItems.length
      ? findItems.map(function (f) {
          return '<li><b>' + esc(f.label) + '</b>' + (f.confPct != null ? ' — ' + f.confPct + '% AI confidence' : '') +
            (f.band ? ' (' + esc(f.band) + ')' : '') + (f.relevance ? '. ' + esc(f.relevance) : '') + '</li>';
        }).join("")
      : '<li>No significant abnormality detected above the AI operating threshold. This does not exclude disease.</li>';
    var ddxItems = arr(S.differential.items);
    var ddxList = ddxItems.length
      ? ddxItems.map(function (d) {
          return '<li><b>' + esc(d.label) + '</b>' + (d.confPct != null ? ' — <span class="conf">' + d.confPct + '%</span>' : '') +
            (d.band ? ' <span class="band">' + esc(d.band) + '</span>' : '') +
            (d.dx ? '<div class="ddxdx">Consider: ' + esc(d.dx) + '.</div>' : '') + '</li>';
        }).join("")
      : '<li>No differential considerations crossed the AI operating threshold.</li>';
    var advice = arr(S.recommendations.items).map(function (r) { return '<li>' + esc(r) + '</li>'; }).join("") +
      '<li><b>Clinical correlation advised.</b> ' + esc(S.followUp.text) + '</li>';

    return '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>StewardMD — AI Chest X-ray Report</title><style>' + PRO_CSS + '</style></head><body>' +
      '<div class="page">' +
        '<div class="hdr">' +
          (logo ? '<img class="logo" src="' + esc(logo) + '" alt="StewardMD logo" />' : '') +
          '<div class="hdr-txt"><div class="brand">StewardMD</div><div class="tag">AI Radiology &middot; Chest X-ray Screening</div></div>' +
          '<div class="hdr-right"><div class="hr-l">AI SCREENING REPORT</div>' + (created ? '<div class="hr-s">Generated ' + esc(created) + '</div>' : '') + '</div>' +
        '</div>' +
        '<div class="rule"></div>' +
        '<div class="meta">' +
          '<div><span class="ml">Clinical details</span><span class="mv">' + esc(S.clinicalInformation.text) + '</span></div>' +
          '<div><span class="ml">Technique</span><span class="mv">' + esc(S.technique.text) + '</span></div>' +
          '<div><span class="ml">Image quality</span><span class="mv">' + esc(S.imageQuality.text) + '</span></div>' +
        '</div>' +
        '<h1>AI CHEST X-RAY SCREENING REPORT</h1>' +
        '<div class="h1sub">Single frontal chest radiograph &middot; AI-assisted screening (ThoreX AI)</div>' +
        (xray ? '<div class="xray"><img src="' + esc(xray) + '" alt="Analyzed chest radiograph" /><div class="xcap">' + (opts.heatmap ? 'Analyzed image with AI heatmap overlay' : 'Analyzed image') + ' &middot; burnt-in identifiers masked where detected</div></div>' : '') +
        '<h2>Findings</h2><ul class="findings">' + findingsList + '</ul>' +
        '<h2>Impression</h2><p class="impression">' + esc(S.impression.text) + '</p>' +
        (aiDdx ? '<h2>AI best-fit diagnosis (correlated with history)</h2><div class="aibox">' + esc(aiDdx).replace(/\n/g, '<br>') + '</div><div class="aibrand">MaiK AI &middot; decision support &middot; correlate clinically</div>' : '') +
        '<h2>Differential diagnosis</h2><ul class="ddx">' + ddxList + '</ul>' +
        '<h2>Advice</h2><ul class="advice">' + advice + '</ul>' +
        '<div class="warn"><b>&#9888; IMPORTANT — AI-generated screening, not a diagnosis.</b>' +
          '<span>' + esc(MANDATORY_DISCLAIMER) + ' Confidence percentages are the model&rsquo;s raw scores, not calibrated probabilities of disease. This automated report is for clinical decision support and research/education and must be confirmed by a qualified radiologist / physician before any clinical decision.</span></div>' +
        '<div class="sign"><div class="sig"><div class="sig-line"></div>AI-generated &middot; no physician signature</div>' +
          '<div class="sig"><div class="sig-line"></div>Reviewing radiologist / physician</div></div>' +
        '<div class="foot"><span>StewardMD &middot; AI Clinical Decision Support</span><span>ThoreX AI</span>' + (created ? '<span>' + esc(created) + '</span>' : '') + '</div>' +
      '</div></body></html>';
  }

  var API = {
    buildReport: buildReport,
    buildProDocument: buildProDocument,
    MANDATORY_DISCLAIMER: MANDATORY_DISCLAIMER,
    SECTION_ORDER: SECTION_ORDER,
    SECTION_TITLES: SECTION_TITLES
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_THOREX_REPORT = API;
})();
