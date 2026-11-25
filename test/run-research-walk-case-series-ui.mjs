// End-to-end walk: case series, from the first question to the DOCX export.
//   node test/run-research-walk-case-series-ui.mjs
import { runResearchWalk } from "./research-walk-lib.mjs";

runResearchWalk({
  name: "case-series",
  choice: "case-series",
  studyType: "Case series",
  title: "Five zinc phosphide presentations",
  port: 9132,
  cdp: 9532,
  total: 9,
  steps: [
    ["casefile", "Case file"],
    ["novelty", "Novelty"],
    ["iec", "Ethics committee"],
    ["pubconsent", "Consent for publication"],
    ["images", "Images"],
    ["masterchart", "Master chart"],
    ["manuscript", "Manuscript"]
  ]
});
