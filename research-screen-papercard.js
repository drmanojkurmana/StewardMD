/* StewardMD - ResearchMD Study Card (window.SMD_RESEARCH.paperCard).
 * ES5 only, buildless, mobile-first.
 * Renders study card from POST /api/research/v1/projects/{pid}/paper-card.
 * No em or en dashes anywhere.
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  var D = G.document;
  var currentCard = null;

  var esc = (SMD.esc) || function (s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  /* Highlight only the numbers this result uses (not the 95 of "95% CI"); with no list, every number. */
  function highlightNumbers(quote, nums) {
    return esc(quote || "").replace(/(\d+(?:\.\d+)?)/g, function (m) {
      if (nums && nums.length) {
        var v = Number(m), hit = false;
        for (var i = 0; i < nums.length; i++) if (nums[i] != null && Math.abs(Number(nums[i])) === v) hit = true;
        if (!hit) return m;
      }
      return '<mark class="rmd-find-num">' + m + '</mark>';
    });
  }

  function injectCSS() {
    if (!D || D.getElementById("rmdPaperCardCss")) return;
    var s = D.createElement("style");
    s.id = "rmdPaperCardCss";
    s.textContent = [
      "/* ResearchMD Study Card & Paste Box */",
      ".rmd-paste-card-box { margin-bottom: 16px; padding: 14px; background: var(--rmd-panel); border: 1px solid var(--rmd-line); border-radius: 12px; font-family: var(--rmd-f); }",
      ".rmd-paste-row { display: flex; flex-direction: column; gap: 6px; }",
      ".rmd-paste-title-lbl { font: 600 13px var(--rmd-f); color: var(--rmd-ink); margin: 0; }",
      ".rmd-paste-input-row { display: flex; gap: 8px; align-items: center; }",
      ".rmd-paste-input { flex: 1; min-height: 44px; box-sizing: border-box; padding: 10px 14px; font: 14.5px var(--rmd-f); border: 1px solid var(--rmd-line); border-radius: 10px; background: var(--rmd-bg); color: var(--rmd-ink); }",
      ".rmd-paste-input:focus { outline: none; border-color: var(--rmd-acc); box-shadow: 0 0 0 2px var(--rmd-acc-soft); }",
      ".rmd-btn-read { flex-shrink: 0; min-height: 44px; padding: 0 16px; font-weight: 600; cursor: pointer; }",
      ".rmd-paste-hint { font-size: 12px; color: var(--rmd-mut); line-height: 1.4; margin-top: 2px; }",
      ".rmd-papercard-status-target { margin-top: 10px; }",
      ".rmd-papercard-calm-loading { display: flex; align-items: center; gap: 10px; padding: 12px 14px; font: 500 13.5px var(--rmd-f); color: var(--rmd-mut); background: var(--rmd-bg); border: 1px dashed var(--rmd-line); border-radius: 8px; }",
      ".rmd-calm-spinner { animation: rmdSpin 1s linear infinite; flex-shrink: 0; }",
      "@keyframes rmdSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }",
      ".rmd-papercard { max-width: 880px; margin: 12px auto 0; background: var(--rmd-panel); border: 1px solid var(--rmd-line); border-radius: 12px; padding: 18px 20px; box-sizing: border-box; color: var(--rmd-ink); font-family: var(--rmd-f); text-align: left; }",
      ".rmd-papercard-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 8px; }",
      ".rmd-papercard-title { margin: 0; font: 700 17px/1.35 var(--rmd-f); color: var(--rmd-ink); word-break: break-word; }",
      ".rmd-papercard-close { border: none; background: transparent; color: var(--rmd-mut); padding: 6px; cursor: pointer; min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; }",
      ".rmd-papercard-close:active { background: var(--rmd-bg); }",
      ".rmd-papercard-meta { font-size: 13px; color: var(--rmd-mut); margin-bottom: 12px; line-height: 1.4; }",
      ".rmd-papercard-badges { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 16px; }",
      ".rmd-badge-design { background: var(--rmd-acc-soft); color: var(--rmd-acc-dark); font-weight: 600; font-size: 11.5px; padding: 3px 9px; border-radius: 999px; }",
      ".rmd-badge-sample { background: var(--rmd-fill, rgba(0,0,0,0.05)); color: var(--rmd-ink); font-size: 11.5px; padding: 3px 9px; border-radius: 999px; }",
      ".rmd-badge-free { background: rgba(66, 205, 181, 0.15); color: #086b5c; font-weight: 600; font-size: 11.5px; padding: 3px 9px; border-radius: 999px; }",
      ".rmd-token-chip { font-size: 11.5px; padding: 3px 9px; border-radius: 999px; background: var(--rmd-fill, rgba(0,0,0,0.05)); color: var(--rmd-mut); }",
      ".rmd-token-chip-instant { background: rgba(66, 205, 181, 0.12); color: #086b5c; font-weight: 600; }",
      ".rmd-papercard-columns { display: flex; flex-direction: column; gap: 16px; margin: 16px 0; }",
      "@media (min-width: 768px) {",
      "  .rmd-papercard-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; }",
      "}",
      ".rmd-papercard-col { display: flex; flex-direction: column; gap: 10px; min-width: 0; }",
      ".rmd-papercard-subheading { margin: 0 0 6px 0; font: 700 13px var(--rmd-f); text-transform: uppercase; letter-spacing: 0.04em; color: var(--rmd-mut); }",
      ".rmd-papercard-finding { padding: 10px 12px; background: var(--rmd-bg); border: 1px solid var(--rmd-line); border-radius: 8px; margin-bottom: 8px; }",
      ".rmd-finding-stat { font: 600 13.5px var(--rmd-f); color: var(--rmd-ink); line-height: 1.45; word-break: break-word; }",
      ".rmd-finding-p { font-size: 12.5px; color: var(--rmd-mut); margin-top: 4px; }",
      ".rmd-finding-quote { font-size: 12px; color: var(--rmd-mut); font-style: italic; margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--rmd-line); line-height: 1.45; word-break: break-word; }",
      ".rmd-find-num { background: var(--rmd-acc-soft, rgba(27,65,191,0.12)); color: var(--rmd-acc-dark, #122a7f); border-radius: 3px; padding: 0 3px; font-style: normal; font-weight: 600; }",
      ".rmd-papercard-sections { display: flex; flex-direction: column; gap: 8px; }",
      ".rmd-papercard-section-item { padding: 8px 10px; background: var(--rmd-bg); border-radius: 8px; }",
      ".rmd-section-label { display: block; font: 700 12.5px var(--rmd-f); color: var(--rmd-ink); margin-bottom: 2px; }",
      ".rmd-collapsed-text { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; font-size: 13px; line-height: 1.45; color: var(--rmd-ink); }",
      ".rmd-expanded-text { display: block; font-size: 13px; line-height: 1.45; color: var(--rmd-ink); }",
      ".rmd-more-btn { background: none; border: none; padding: 4px 0; color: var(--rmd-acc); font: 600 12px var(--rmd-f); cursor: pointer; min-height: 44px; display: inline-flex; align-items: center; }",
      ".rmd-papercard-conclusion { padding: 12px 14px; background: var(--rmd-bg); border: 1px solid var(--rmd-line); border-radius: 8px; margin: 12px 0 16px; }",
      ".rmd-papercard-conclusion-text { margin: 4px 0 0 0; font-size: 13.5px; line-height: 1.5; color: var(--rmd-ink); }",
      ".rmd-papercard-explain-box { margin: 14px 0; padding: 12px 14px; background: var(--rmd-bg); border: 1px dashed var(--rmd-line); border-radius: 8px; }",
      ".rmd-ai-pico-box { display: flex; flex-direction: column; gap: 6px; }",
      ".rmd-pico-line { font-size: 13px; line-height: 1.45; color: var(--rmd-ink); }",
      ".rmd-pico-line strong { color: var(--rmd-ink); font-weight: 700; }",
      ".rmd-papercard-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding-top: 14px; border-top: 1px solid var(--rmd-line); margin-top: 14px; }",
      ".rmd-papercard-actions button { min-height: 44px; padding: 0 16px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; font-weight: 600; cursor: pointer; }",
      ".rmd-papercard-actions button:active { transform: scale(0.98); }",
      ".rmd-papercard-outcome-prompt { margin-top: 12px; padding: 12px; background: var(--rmd-bg); border: 1px solid var(--rmd-line); border-radius: 8px; display: flex; flex-direction: column; gap: 6px; }",
      ".rmd-papercard-muted { font-size: 13px; color: var(--rmd-mut); margin: 0; font-style: italic; }"
    ].join("\n");
    D.head.appendChild(s);
  }

  function formatCitationLine(card) {
    var authors = Array.isArray(card.authors) ? card.authors : [];
    var authorStr = "";
    if (authors.length > 3) {
      authorStr = authors.slice(0, 3).join(", ") + ", et al.";
    } else if (authors.length > 0) {
      authorStr = authors.join(", ");
    }
    var parts = [];
    if (authorStr) parts.push(authorStr);
    if (card.year) parts.push("(" + card.year + ")");
    if (card.title) parts.push(card.title);
    if (card.journal) parts.push(card.journal);
    if (card.doi) parts.push("doi:" + card.doi);
    else if (card.url) parts.push(card.url);
    return parts.join(". ");
  }

  function buildPlainTextSummary(card) {
    var lines = [];
    var cit = formatCitationLine(card);
    if (cit) lines.push(cit);
    if (card.design && card.design.label) lines.push("Design: " + card.design.label);
    if (card.sampleSize && card.sampleSize.n != null) {
      lines.push("Sample size: n = " + Number(card.sampleSize.n).toLocaleString() + " (people studied)");
    }
    if (card.findings && card.findings.length > 0) {
      lines.push("Key results:");
      for (var i = 0; i < card.findings.length; i++) {
        var f = card.findings[i];
        if (f.format === "estimate") {
          var stat = "";
          if (G.SMD_RESEARCH_EXPLAIN && G.SMD_RESEARCH_EXPLAIN.effect) {
            try {
              stat = G.SMD_RESEARCH_EXPLAIN.effect({
                measure: f.measure,
                estimate: f.estimate,
                ciLower: f.ciLower,
                ciUpper: f.ciUpper,
                p: f.p
              });
            } catch (e) {}
          }
          if (!stat) stat = f.measure + " " + f.estimate + " (95% CI " + f.ciLower + " to " + f.ciUpper + ")";
          lines.push("- " + stat);
        } else if (f.format === "counts") {
          var m = f.measure || "RR";
          var mName = (m === "RR") ? "Risk ratio (RR)" : (m === "OR" ? "Odds ratio (OR)" : m);
          var cLine = mName + " from counts: " + f.events1 + "/" + f.total1 + " vs " + f.events2 + "/" + f.total2;
          if (G.SMD_RESEARCH_ENGINE && G.SMD_RESEARCH_ENGINE.effectFromRaw) {
            try {
              var r = G.SMD_RESEARCH_ENGINE.effectFromRaw({
                events1: f.events1,
                n1: f.total1,
                events2: f.events2,
                n2: f.total2
              }, m);
              if (r && !r.excluded && G.SMD_RESEARCH_EXPLAIN && G.SMD_RESEARCH_EXPLAIN.effect) {
                var cEff = G.SMD_RESEARCH_EXPLAIN.effect({
                  measure: m,
                  estimate: r.effect,
                  ciLower: r.ciLower,
                  ciUpper: r.ciUpper
                });
                cLine += " (" + cEff + ")";
              }
            } catch (err) {}
          }
          lines.push("- " + cLine);
        }
      }
    }
    if (card.conclusion) lines.push("Conclusion: " + card.conclusion);
    return lines.join("\n\n");
  }

  function copyTextToClipboard(text, cb) {
    if (G.navigator && G.navigator.clipboard && G.navigator.clipboard.writeText) {
      G.navigator.clipboard.writeText(text).then(function () {
        cb(true);
      }).catch(function () {
        fallbackCopy(text, cb);
      });
    } else {
      fallbackCopy(text, cb);
    }
  }

  function fallbackCopy(text, cb) {
    try {
      var ta = D.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      D.body.appendChild(ta);
      ta.select();
      var ok = D.execCommand("copy");
      D.body.removeChild(ta);
      cb(ok);
    } catch (e) {
      cb(false);
    }
  }

  function renderPicoHtml(ai) {
    if (!ai) return "";
    var h = [];
    h.push('<div class="rmd-ai-pico-box">');
    h.push('  <h4 class="rmd-papercard-subheading">Structured PICO breakdown</h4>');
    if (ai.population) {
      h.push('  <div class="rmd-pico-line"><strong>Population (who was studied):</strong> <span>' + esc(ai.population) + '</span></div>');
    }
    if (ai.intervention) {
      h.push('  <div class="rmd-pico-line"><strong>Intervention (what was tested):</strong> <span>' + esc(ai.intervention) + '</span></div>');
    }
    if (ai.comparison) {
      h.push('  <div class="rmd-pico-line"><strong>Comparison (what it was compared to):</strong> <span>' + esc(ai.comparison) + '</span></div>');
    }
    if (ai.outcome) {
      h.push('  <div class="rmd-pico-line"><strong>Outcome (what was measured):</strong> <span>' + esc(ai.outcome) + '</span></div>');
    }
    if (ai.design) {
      h.push('  <div class="rmd-pico-line"><strong>Study design:</strong> <span>' + esc(ai.design) + '</span></div>');
    }
    if (ai.mainResult) {
      h.push('  <div class="rmd-pico-line"><strong>Main result:</strong> <span>' + esc(ai.mainResult) + '</span></div>');
    }
    if (ai.conclusion) {
      h.push('  <div class="rmd-pico-line"><strong>Conclusion:</strong> <span>' + esc(ai.conclusion) + '</span></div>');
    }
    h.push('</div>');
    return h.join("\n");
  }

  /* Renders the Study Card into target container */
  function renderCard(container, card, opts) {
    if (!container || !card) return;
    injectCSS();
    currentCard = card;
    opts = opts || {};
    var project = opts.project || (SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null);
    var pid = opts.pid || (project ? (project.serverId || project.id) : "");
    var role = opts.role || (project && project.role) || "owner";
    var isViewer = (role === "viewer");

    var authors = Array.isArray(card.authors) ? card.authors : [];
    var authorStr = "";
    if (authors.length > 3) {
      authorStr = authors.slice(0, 3).join(", ") + ", et al.";
    } else if (authors.length > 0) {
      authorStr = authors.join(", ");
    }

    var metaItems = [];
    if (authorStr) metaItems.push(esc(authorStr));
    if (card.journal) metaItems.push('<em>' + esc(card.journal) + '</em>');
    if (card.year) metaItems.push('(' + esc(card.year) + ')');

    var h = [];
    h.push('<div class="rmd-papercard" data-rmd-papercard="true">');

    // Header: title + close
    h.push('  <div class="rmd-papercard-header">');
    h.push('    <h3 class="rmd-papercard-title">' + esc(card.title || "Untitled paper") + '</h3>');
    h.push('    <button type="button" class="rmd-papercard-close" data-rmd="close-papercard" aria-label="Close study card" title="Close">');
    h.push('      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>');
    h.push('    </button>');
    h.push('  </div>');

    // Meta line
    if (metaItems.length) {
      h.push('  <div class="rmd-papercard-meta">' + metaItems.join(" &middot; ") + '</div>');
    }

    // Badges row
    h.push('  <div class="rmd-papercard-badges">');
    if (card.design && card.design.label) {
      h.push('    <span class="rmd-badge rmd-badge-pill rmd-badge-design">' + esc(card.design.label) + '</span>');
    }
    if (card.sampleSize && card.sampleSize.n != null) {
      var nStr = "n = " + Number(card.sampleSize.n).toLocaleString() + " (people studied)";
      h.push('    <span class="rmd-badge rmd-badge-pill rmd-badge-sample">' + esc(nStr) + '</span>');
    }
    if (card.freeFullText) {
      h.push('    <span class="rmd-badge rmd-badge-pill rmd-badge-free">Free full text</span>');
    }
    if (card.method === "cache") {
      h.push('    <span class="rmd-badge rmd-badge-pill rmd-token-chip rmd-token-chip-instant">Already read by someone, instant</span>');
      h.push('    <span class="rmd-badge rmd-badge-pill rmd-token-chip">0 MaiK tokens</span>');
    } else {
      h.push('    <span class="rmd-badge rmd-badge-pill rmd-token-chip">0 MaiK tokens</span>');
    }
    h.push('  </div>');

    // iPad 2-col / Phone 1-col container
    h.push('  <div class="rmd-papercard-columns">');

    // Left Column: Key results
    h.push('    <div class="rmd-papercard-col rmd-papercard-results">');
    h.push('      <h4 class="rmd-papercard-subheading">Key results</h4>');
    var findings = Array.isArray(card.findings) ? card.findings : [];
    if (findings.length > 0) {
      for (var fIdx = 0; fIdx < findings.length; fIdx++) {
        var finding = findings[fIdx];
        h.push('      <div class="rmd-papercard-finding">');
        if (finding.format === "estimate") {
          var effText = "";
          if (G.SMD_RESEARCH_EXPLAIN && G.SMD_RESEARCH_EXPLAIN.effect) {
            try {
              effText = G.SMD_RESEARCH_EXPLAIN.effect({
                measure: finding.measure,
                estimate: finding.estimate,
                ciLower: finding.ciLower,
                ciUpper: finding.ciUpper,
                p: finding.p
              });
            } catch (e) {
              effText = finding.measure + " " + finding.estimate + " (95% CI " + finding.ciLower + " to " + finding.ciUpper + ")";
            }
          } else {
            effText = finding.measure + " " + finding.estimate + " (95% CI " + finding.ciLower + " to " + finding.ciUpper + ")";
          }
          h.push('        <div class="rmd-finding-stat">' + esc(effText) + '</div>');
          if (finding.p != null && G.SMD_RESEARCH_EXPLAIN && G.SMD_RESEARCH_EXPLAIN.pValue) {
            try {
              var pValStr = G.SMD_RESEARCH_EXPLAIN.pValue(finding.p);
              h.push('        <div class="rmd-finding-p">' + esc(pValStr) + '</div>');
            } catch (pe) {}
          }
        } else if (finding.format === "counts") {
          var ms = finding.measure || "RR";
          var mLab = (ms === "RR") ? "Risk ratio (RR)" : (ms === "OR" ? "Odds ratio (OR)" : ms);
          var countsText = mLab + " from counts: " + finding.events1 + "/" + finding.total1 + " vs " + finding.events2 + "/" + finding.total2;
          var calcEff = "";
          if (G.SMD_RESEARCH_ENGINE && G.SMD_RESEARCH_ENGINE.effectFromRaw) {
            try {
              var rawRes = G.SMD_RESEARCH_ENGINE.effectFromRaw({
                events1: finding.events1,
                n1: finding.total1,
                events2: finding.events2,
                n2: finding.total2
              }, ms);
              if (rawRes && !rawRes.excluded && G.SMD_RESEARCH_EXPLAIN && G.SMD_RESEARCH_EXPLAIN.effect) {
                calcEff = G.SMD_RESEARCH_EXPLAIN.effect({
                  measure: ms,
                  estimate: rawRes.effect,
                  ciLower: rawRes.ciLower,
                  ciUpper: rawRes.ciUpper
                });
              }
            } catch (err) {}
          }
          h.push('        <div class="rmd-finding-stat">' + esc(countsText) + (calcEff ? ' &middot; ' + esc(calcEff) : '') + '</div>');
          if (finding.p != null && G.SMD_RESEARCH_EXPLAIN && G.SMD_RESEARCH_EXPLAIN.pValue) {
            try {
              var pValCount = G.SMD_RESEARCH_EXPLAIN.pValue(finding.p);
              h.push('        <div class="rmd-finding-p">' + esc(pValCount) + '</div>');
            } catch (pec) {}
          }
        }
        if (finding.quote) {
          h.push('        <div class="rmd-finding-quote smd-books-keep">' + highlightNumbers(finding.quote, [finding.estimate, finding.ciLower, finding.ciUpper, finding.events1, finding.total1, finding.events2, finding.total2]) + '</div>');
        }
        h.push('      </div>');
      }
    } else {
      h.push('      <p class="rmd-papercard-muted">No key quantitative findings extracted directly from abstract.</p>');
    }
    h.push('    </div>');

    // Right Column: Summary
    h.push('    <div class="rmd-papercard-col rmd-papercard-summary">');
    h.push('      <h4 class="rmd-papercard-subheading">Summary</h4>');
    var sections = Array.isArray(card.sections) ? card.sections : [];
    if (sections.length > 0) {
      h.push('      <div class="rmd-papercard-sections">');
      for (var sIdx = 0; sIdx < sections.length; sIdx++) {
        var sec = sections[sIdx];
        h.push('        <div class="rmd-papercard-section-item">');
        h.push('          <strong class="rmd-section-label">' + esc(sec.label) + '</strong>');
        h.push('          <div class="rmd-collapsed-text" data-rmd-sec-text="' + sIdx + '">' + esc(sec.text) + '</div>');
        h.push('          <button type="button" class="rmd-more-btn" data-rmd-sec-toggle="' + sIdx + '">More</button>');
        h.push('        </div>');
      }
      h.push('      </div>');
    } else {
      h.push('      <p class="rmd-papercard-muted">No structured summary sections available.</p>');
    }
    h.push('    </div>');

    h.push('  </div>'); // .rmd-papercard-columns

    // Conclusion
    if (card.conclusion) {
      h.push('  <div class="rmd-papercard-conclusion">');
      h.push('    <h4 class="rmd-papercard-subheading">Conclusion (what the authors concluded)</h4>');
      h.push('    <p class="rmd-papercard-conclusion-text">' + esc(card.conclusion) + '</p>');
      h.push('  </div>');
    }

    // Explain with MaiK affordance
    var needsExplain = (!card.structured || !findings.length);
    if (needsExplain && !isViewer) {
      h.push('  <div class="rmd-papercard-explain-box" id="rmdPaperCardExplainBox">');
      if (card.ai) {
        h.push(renderPicoHtml(card.ai));
      } else {
        h.push('    <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="explain-study">');
        h.push('      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>');
        h.push('      <span>Explain with MaiK (about 1 MaiK token)</span>');
        h.push('    </button>');
      }
      h.push('  </div>');
    }

    // Inline outcome prompt (hidden until needed)
    h.push('  <div class="rmd-papercard-outcome-prompt" style="display:none;" id="rmdCardOutcomePrompt">');
    h.push('    <label class="rmd-paste-title-lbl" for="rmd_card_outcome_field">What result are you combining?</label>');
    h.push('    <input type="text" id="rmd_card_outcome_field" class="rmd-paste-input" placeholder="e.g. confirmed tuberculosis at any follow-up" />');
    h.push('    <div class="rmd-paste-hint">The outcome you want to pool across studies. We use it to find the right numbers.</div>');
    h.push('    <div style="display:flex;gap:8px;margin-top:6px;">');
    h.push('      <button type="button" class="rmd-btn rmd-btn-primary" data-rmd="confirm-outcome-add">Confirm and add</button>');
    h.push('      <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="cancel-outcome-add">Cancel</button>');
    h.push('    </div>');
    h.push('  </div>');

    // Buttons
    h.push('  <div class="rmd-papercard-actions">');
    if (card._added) {
      h.push('    <button type="button" class="rmd-btn rmd-btn-primary" data-rmd="card-add-study" disabled="disabled">');
      h.push('      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"></polyline></svg>');
      h.push('      <span>Added to studies</span>');
      h.push('    </button>');
    } else {
      h.push('    <button type="button" class="rmd-btn rmd-btn-primary" data-rmd="card-add-study">');
      h.push('      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>');
      h.push('      <span>Add to my studies</span>');
      h.push('    </button>');
    }
    h.push('    <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="card-open-paper">');
    h.push('      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>');
    h.push('      <span>Open paper</span>');
    h.push('    </button>');
    h.push('    <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="card-copy-summary">');
    h.push('      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>');
    h.push('      <span>Copy summary</span>');
    h.push('    </button>');
    h.push('  </div>');

    h.push('</div>'); // .rmd-papercard

    container.innerHTML = h.join("\n");

    // Bind card events
    var cardEl = container.querySelector('[data-rmd-papercard="true"]');
    if (!cardEl) return;

    // Close button
    var closeBtn = cardEl.querySelector('[data-rmd="close-papercard"]');
    if (closeBtn) {
      closeBtn.onclick = function () {
        currentCard = null;
        container.innerHTML = "";
        if (opts.onClose) opts.onClose();
      };
    }

    // More / Less toggles on sections
    var moreBtns = cardEl.querySelectorAll('[data-rmd-sec-toggle]');
    for (var mb = 0; mb < moreBtns.length; mb++) {
      (function (btn) {
        btn.onclick = function () {
          var idx = btn.getAttribute("data-rmd-sec-toggle");
          var textEl = cardEl.querySelector('[data-rmd-sec-text="' + idx + '"]');
          if (!textEl) return;
          if (textEl.className === "rmd-collapsed-text") {
            textEl.className = "rmd-expanded-text";
            btn.textContent = "Less";
          } else {
            textEl.className = "rmd-collapsed-text";
            btn.textContent = "More";
          }
        };
      })(moreBtns[mb]);
    }

    // Open Paper button
    var openBtn = cardEl.querySelector('[data-rmd="card-open-paper"]');
    if (openBtn) {
      openBtn.onclick = function () {
        var openUrl = card.url || (card.doi ? "https://doi.org/" + encodeURIComponent(card.doi) : (card.pmid ? "https://pubmed.ncbi.nlm.nih.gov/" + encodeURIComponent(card.pmid) + "/" : ""));
        if (openUrl) G.open(openUrl, "_blank", "noopener,noreferrer");
      };
    }

    // Copy Summary button
    var copyBtn = cardEl.querySelector('[data-rmd="card-copy-summary"]');
    if (copyBtn) {
      copyBtn.onclick = function () {
        var summaryText = buildPlainTextSummary(card);
        copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"></polyline></svg> <span>Copied</span>';
        copyTextToClipboard(summaryText, function () {});
        setTimeout(function () {
          copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> <span>Copy summary</span>';
        }, 2000);
      };
    }

    // Explain with MaiK
    var explainBtn = cardEl.querySelector('[data-rmd="explain-study"]');
    if (explainBtn) {
      explainBtn.onclick = function () {
        var explainBox = cardEl.querySelector("#rmdPaperCardExplainBox");
        if (!explainBox) return;
        explainBox.innerHTML = '<div class="rmd-papercard-calm-loading" role="status"><svg class="rmd-calm-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg> <span>Explaining with MaiK</span></div>';

        var body = {};
        if (card.pmid) body.pmid = card.pmid;
        if (card.doi) body.doi = card.doi;

        SMD.api.request("POST", "/v1/projects/" + pid + "/paper-card/explain", body)
          .then(function (data) {
            var ai = (data && data.card && data.card.ai) || (data && data.ai);
            card.ai = ai;
            explainBox.innerHTML = renderPicoHtml(ai);
          })
          .catch(function (err) {
            if (err && (err.status === 402 || err.code === "insufficient_credits")) {
              explainBox.innerHTML = '<div class="rmd-banner rmd-banner-error" role="alert"><strong>You need more MaiK tokens for this step.</strong><button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd-action="credits">Add tokens</button></div>';
            } else if (err && (err.status === 400 || err.code === "not_needed")) {
              explainBox.innerHTML = '<div class="rmd-banner rmd-banner-warn" role="status"><span>' + esc(err.message || "An explanation is not needed for this study.") + '</span></div>';
            } else {
              var f = (SMD.p2 && SMD.p2.friendlyError) ? SMD.p2.friendlyError(err) : { message: err.message || "Explanation failed." };
              explainBox.innerHTML = '<div class="rmd-banner rmd-banner-error" role="alert"><span>' + esc(f.message) + '</span></div>';
            }
          });
      };
    }

    // Add to my studies
    var addBtn = cardEl.querySelector('[data-rmd="card-add-study"]');
    var outcomePrompt = cardEl.querySelector("#rmdCardOutcomePrompt");
    var outcomeField = cardEl.querySelector("#rmd_card_outcome_field");
    var confirmAddBtn = cardEl.querySelector('[data-rmd="confirm-outcome-add"]');
    var cancelAddBtn = cardEl.querySelector('[data-rmd="cancel-outcome-add"]');

    function performAutoAdd(outcomeVal) {
      if (!addBtn) return;
      addBtn.setAttribute("disabled", "disabled");
      addBtn.innerHTML = '<svg class="rmd-calm-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg> <span>Adding...</span>';

      var item = {};
      if (card.pmid) item.pmid = card.pmid;
      if (card.doi) item.doi = card.doi;

      var reqBody = { items: [item], outcome: outcomeVal };
      SMD.api.request("POST", "/v1/projects/" + pid + "/studies/auto-add", reqBody)
        .then(function (data) {
          var res = (data && data.results && data.results[0]) || {};
          card._added = true;
          if (res.study && SMD.store && SMD.store.adoptServerStudy) {
            SMD.store.adoptServerStudy(pid, res.study);
          }
          addBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"></polyline></svg> <span>Added to studies</span>';
          addBtn.setAttribute("disabled", "disabled");
          if (outcomePrompt) outcomePrompt.style.display = "none";
          if (opts.onAdded) opts.onAdded(res);
        })
        .catch(function (err) {
          addBtn.removeAttribute("disabled");
          addBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> <span>Add to my studies</span>';
          if (err && (err.status === 402 || err.code === "insufficient_credits")) {
            if (outcomePrompt) {
              outcomePrompt.style.display = "block";
              outcomePrompt.innerHTML = '<div class="rmd-banner rmd-banner-error" role="alert"><strong>You need more MaiK tokens for this step.</strong><button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd-action="credits">Add tokens</button></div>';
            }
          } else {
            var f = (SMD.p2 && SMD.p2.friendlyError) ? SMD.p2.friendlyError(err) : { message: err.message || "Could not add study." };
            if (outcomePrompt) {
              outcomePrompt.style.display = "block";
              outcomePrompt.innerHTML = '<div class="rmd-banner rmd-banner-error" role="alert"><span>' + esc(f.message) + '</span></div>';
            }
          }
        });
    }

    if (addBtn) {
      addBtn.onclick = function () {
        var existingOutcome = (project && (project.outcome || project.primaryOutcome || (project.outcomes && project.outcomes.primary))) || "";
        if (existingOutcome) {
          performAutoAdd(existingOutcome);
        } else {
          if (outcomePrompt) outcomePrompt.style.display = "block";
          if (outcomeField) outcomeField.focus();
        }
      };
    }

    if (confirmAddBtn) {
      confirmAddBtn.onclick = function () {
        var typed = outcomeField ? outcomeField.value.trim() : "";
        if (!typed) {
          if (outcomeField) outcomeField.focus();
          return;
        }
        if (project) project.outcome = typed;
        performAutoAdd(typed);
      };
    }

    if (cancelAddBtn) {
      cancelAddBtn.onclick = function () {
        if (outcomePrompt) outcomePrompt.style.display = "none";
      };
    }
  }

  /* Mounts the Paste a study link box into container */
  function mountPasteBox(container, opts) {
    if (!container) return;
    injectCSS();
    opts = opts || {};

    var h = [];
    h.push('<div class="rmd-paste-card-box">');
    h.push('  <div class="rmd-paste-row">');
    h.push('    <label class="rmd-paste-title-lbl" for="rmd_paste_link_input">Paste a study link</label>');
    h.push('    <div class="rmd-paste-input-row">');
    h.push('      <input type="text" id="rmd_paste_link_input" class="rmd-paste-input" data-rmd="paste-link-input" placeholder="Paste a PubMed, DOI, PMC or journal link" autocomplete="off" />');
    h.push('      <button type="button" class="rmd-btn rmd-btn-primary rmd-btn-read" data-rmd="read-study">Read study</button>');
    h.push('    </div>');
    h.push('    <div class="rmd-paste-hint">Works with PubMed, doi.org, PMC, Europe PMC and most journal pages. Free: no MaiK tokens.</div>');
    h.push('  </div>');
    h.push('  <div class="rmd-papercard-status-target"></div>');
    h.push('  <div class="rmd-papercard-render-target"></div>');
    h.push('</div>');

    container.innerHTML = h.join("\n");

    var input = container.querySelector('[data-rmd="paste-link-input"]');
    var btn = container.querySelector('[data-rmd="read-study"]');
    var statusTarget = container.querySelector(".rmd-papercard-status-target");
    var renderTarget = container.querySelector(".rmd-papercard-render-target");

    if (currentCard) {
      renderCard(renderTarget, currentCard, opts);
    }

    function doRead(rawLink) {
      var link = String(rawLink || "").trim();
      if (!link) return;
      statusTarget.innerHTML = '<div class="rmd-papercard-calm-loading" role="status"><svg class="rmd-calm-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg> <span>Reading the study</span></div>';
      renderTarget.innerHTML = "";

      var project = opts.project || (SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null);
      var pid = opts.pid || (project ? (project.serverId || project.id) : "");

      SMD.api.request("POST", "/v1/projects/" + pid + "/paper-card", { link: link })
        .then(function (data) {
          statusTarget.innerHTML = "";
          var card = (data && data.card) || data;
          renderCard(renderTarget, card, {
            project: project,
            pid: pid,
            role: opts.role,
            onAdded: function (res) {
              if (opts.onAdded) opts.onAdded(res);
            },
            onClose: function () {
              if (opts.onClose) opts.onClose();
            }
          });
          if (opts.onCardRendered) opts.onCardRendered(card);
        })
        .catch(function (err) {
          statusTarget.innerHTML = "";
          var e = err || {};
          var code = e.code || "";
          var status = e.status || 0;
          if (code === "link_unrecognised" || status === 400) {
            var msg = e.message || (e.body && e.body.error && e.body.error.message) || "We could not recognise this study link. Check the link and try again.";
            statusTarget.innerHTML = '<div class="rmd-banner rmd-banner-error" role="alert"><span>' + esc(msg) + '</span></div>';
          } else if (code === "paper_not_found" || status === 404) {
            statusTarget.innerHTML = '<div class="rmd-banner rmd-banner-error" role="alert"><span>We could not find this study. Check the link.</span></div>';
          } else {
            var f = (SMD.p2 && SMD.p2.friendlyError) ? SMD.p2.friendlyError(err) : { message: e.message || "Something went wrong on our side." };
            statusTarget.innerHTML = '<div class="rmd-banner rmd-banner-error" role="alert"><span>' + esc(f.message) + '</span></div>';
          }
        });
    }

    if (input) {
      input.addEventListener("paste", function (ev) {
        var pastedText = "";
        if (ev && ev.clipboardData && ev.clipboardData.getData) {
          try { pastedText = ev.clipboardData.getData("text"); } catch (e) {}
        }
        var val = (pastedText || input.value || "").trim();
        if (val) {
          input.value = val;
          doRead(val);
        } else {
          setTimeout(function () {
            var laterVal = (input.value || "").trim();
            if (laterVal) doRead(laterVal);
          }, 50);
        }
      });

      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.keyCode === 13) {
          ev.preventDefault();
          doRead(input.value);
        }
      });
    }

    if (btn) {
      btn.onclick = function () {
        if (input) doRead(input.value);
      };
    }
  }

  SMD.paperCard = {
    render: renderCard,
    mountPasteBox: mountPasteBox,
    injectCSS: injectCSS
  };

})(typeof window !== "undefined" ? window : globalThis);
