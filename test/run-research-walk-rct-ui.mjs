// End-to-end walk: randomised trial, from the first question to the DOCX export.
//   node test/run-research-walk-rct-ui.mjs
// Both viewport sweeps (390x844 and 1024x1366) and the document-level overflow
// assertions (documentElement.scrollWidth <= clientWidth) run in research-walk-lib.mjs (docFits).
import { runResearchWalk } from "./research-walk-lib.mjs";

runResearchWalk({
  name: "rct",
  choice: "trial",
  studyType: "Randomized Controlled Trial",
  title: "A new dressing for burns",
  port: 9135,
  cdp: 9535,
  total: 9,
  steps: [
    ["plan", "Plan"],
    ["protocol", "Protocol"],
    ["iec", "Ethics committee"],
    ["ctri", "CTRI"],
    ["randomise", "Randomise"],
    ["masterchart", "Master chart"],
    ["manuscript", "Manuscript"]
  ]
});
