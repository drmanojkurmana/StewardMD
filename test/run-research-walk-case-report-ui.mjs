// End-to-end walk: case report, from the first question to the DOCX export.
//   node test/run-research-walk-case-report-ui.mjs
// Both viewport sweeps (390x844 and 1024x1366) and the document-level overflow
// assertions (documentElement.scrollWidth <= clientWidth) run in research-walk-lib.mjs (docFits).
import { runResearchWalk } from "./research-walk-lib.mjs";

runResearchWalk({
  name: "case-report",
  choice: "case",
  studyType: "Case Report",
  title: "Zinc phosphide myocardial injury",
  port: 9131,
  cdp: 9531,
  total: 8,
  steps: [
    ["casefile", "Case file"],
    ["novelty", "Novelty"],
    ["iec", "Ethics committee"],
    ["pubconsent", "Consent for publication"],
    ["images", "Images"],
    ["manuscript", "Manuscript"]
  ]
});
