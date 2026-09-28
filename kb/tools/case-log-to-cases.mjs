// Turn an exported StewardMD case log (smd_case_log, DX.caseLogExport()) into an evaluation set the audit can read.
// USAGE: node kb/tools/case-log-to-cases.mjs stewardmd-case-log.json [more.json ...] > test/dx-real-cases.json
// The label is the diagnosis the doctor SELECTED in the app, not a confirmed final diagnosis: review and correct the
// "acceptableIds" (and set "abx") from the final outcome before using the file to judge the engine. Records carry no
// text or identifiers; duplicates (same findings, denials and label) are kept once.
import { readFileSync } from "node:fs";
const seen = new Set(), out = [];
for (const f of process.argv.slice(2)) {
  const j = JSON.parse(readFileSync(f, "utf8"));
  for (const r of (j && j.cases) || []) {
    if (!r || !r.chosen || !Array.isArray(r.findings) || !r.findings.length) continue;
    const key = [r.chosen, r.findings.join(","), (r.denied || []).join(",")].join("|");
    if (seen.has(key)) continue; seen.add(key);
    const findings = {}; r.findings.forEach((k) => { findings[k] = true; });
    out.push({ id: "real_" + String(out.length + 1).padStart(4, "0"), month: r.month, findings, denied: r.denied || [],
      expected: { acceptableIds: [r.chosen], labelSource: "doctor-selected, unconfirmed" }, engineTop5: r.top5 || [] });
  }
}
process.stdout.write(JSON.stringify(out, null, 1) + "\n");
console.error(`${out.length} cases from ${process.argv.length - 2} file(s)`);
