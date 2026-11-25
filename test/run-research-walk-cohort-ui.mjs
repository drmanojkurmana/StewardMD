// End-to-end walk: cohort, from the first question to the DOCX export.
//   node test/run-research-walk-cohort-ui.mjs
import { runResearchWalk } from "./research-walk-lib.mjs";

runResearchWalk({
  name: "cohort",
  choice: "cohort",
  studyType: "Cohort study",
  title: "Kidney function after a clinic pathway",
  port: 9134,
  cdp: 9534,
  total: 7,
  steps: [
    ["plan", "Plan"],
    ["protocol", "Protocol"],
    ["iec", "Ethics committee"],
    ["masterchart", "Master chart"],
    ["manuscript", "Manuscript"]
  ]
});
