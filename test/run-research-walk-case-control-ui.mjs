// End-to-end walk: case-control, from the first question to the DOCX export.
//   node test/run-research-walk-case-control-ui.mjs
// Both viewport sweeps (390x844 and 1024x1366) and the document-level overflow
// assertions (documentElement.scrollWidth <= clientWidth) run in research-walk-lib.mjs (docFits).
import { runResearchWalk } from "./research-walk-lib.mjs";

runResearchWalk({
  name: "case-control",
  choice: "case-control",
  studyType: "Case-control study",
  title: "Diet and myocardial infarction",
  port: 9133,
  cdp: 9533,
  total: 7,
  steps: [
    ["plan", "Plan"],
    ["protocol", "Protocol"],
    ["iec", "Ethics committee"],
    ["masterchart", "Master chart"],
    ["manuscript", "Manuscript"]
  ]
});
