// End-to-end walk: case-control, from the first question to the DOCX export.
//   node test/run-research-walk-case-control-ui.mjs
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
