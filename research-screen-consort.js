/* StewardMD - ResearchMD consort screen stub.
 * ES5 IIFE. Registers SMD.screens.consort. Item 0 placeholder.
 * No em or en dashes.
 */
(function (G) {
  "use strict";
  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};
  var KEY = "consort";

  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function labelFor(name) {
    var C = G.SMD_RESEARCH_CONTRACTS;
    var labels = {
      plan: "Plan",
      protocol: "Protocol",
      masterchart: "Master chart",
      manuscript: "Manuscript",
      checklist: "Checklist",
      ready: "Submit",
      casefile: "Case file",
      novelty: "Novelty",
      iec: "Ethics committee",
      pubconsent: "Consent for publication",
      images: "Images",
      ctri: "CTRI",
      randomise: "Randomise",
      consort: "CONSORT flow",
      backup: "Backup"
    };
    if (C && C.STEP_LABELS && C.STEP_LABELS[name]) return C.STEP_LABELS[name];
    return labels[name] || name;
  }

  function render(container) {
    var proj, journey, i, idx, nextName, stepNo, stepCount, h, nextLabel;
    if (!container) return;
    proj = SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
    journey = SMD.journeyFor ? SMD.journeyFor(proj) : [];
    idx = -1;
    for (i = 0; i < journey.length; i++) if (journey[i] === KEY) idx = i;
    nextName = (idx >= 0 && idx + 1 < journey.length) ? journey[idx + 1] : "";
    stepNo = idx >= 0 ? (idx + 1) : 1;
    stepCount = journey.length || 1;
    nextLabel = nextName ? labelFor(nextName) : "continue when this step is ready";
    h = [];
    h.push('<div class="rmd-p2-screen rmd-' + KEY + '-screen">');
    h.push('<div class="rmd-card">');
    h.push('<div class="rmd-step-banner" role="status">');
    h.push('<div class="rmd-step-line"><span class="rmd-step-text"><strong>Step ' + stepNo + ' of ' + stepCount + '</strong> ' + esc(labelFor(KEY)) + '</span></div>');
    h.push('</div>');
    h.push('<p class="rmd-next-line">Next: ' + esc(nextLabel) + '</p>');
    h.push('<p>Coming soon</p>');
    h.push('</div></div>');
    container.innerHTML = h.join("");
  }

  SMD.screens[KEY] = { render: render };
  if (typeof module !== "undefined" && module.exports) module.exports = { render: render };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
