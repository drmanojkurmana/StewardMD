import { readFileSync, writeFileSync } from "node:fs";
const t = JSON.parse(readFileSync("pglog/assessment-templates.json", "utf8"));
const rows = t.templates.map((x) =>
  "  " + x.id + ": { id: " + JSON.stringify(x.id) + ", scaleMin: " + x.scaleMin + ", scaleMax: " + x.scaleMax +
  ", logbookMax: " + x.logbookMax + ", requireDiscussed: " + (!!x.requireDiscussed) + ", noTotal: " + (!!x.noTotal) +
  ", appliesTo: " + JSON.stringify(x.appliesTo) + ", source: " + JSON.stringify(x.source) + ",\n" +
  "            criteria: [" + x.criteria.map((c) => "{ key: " + JSON.stringify(c.key) + " }").join(", ") + "] }"
).join(",\n");
const out = `/* functions/_pglog_templates.js — NMC Logbook · the SCORING CONTRACT of each assessment template.
 *
 * WHY THIS FILE EXISTS: pglog/assessment-templates.json holds the full templates (labels, hints,
 * anchor wording, NMC source citations) for the UI, but a Cloudflare Pages Function cannot read a
 * file off disk. The server still has to score an assessment ITSELF — if it accepted the client's
 * template object, a forged one could inflate maxTotal or drop a criterion, and the resulting mark
 * would be a false record (PGMER-2023 9.2(c) puts a penalty on exactly that).
 *
 * So the scoring-relevant shape lives here, server-side. test/pglog-server.test.mjs asserts it
 * matches the JSON exactly, so the two cannot drift: edit the JSON, run the test, and it tells you.
 *
 * GENERATED — do not hand-edit. Regenerate with:
 *   node scripts/build-pglog-templates.mjs
 */
export const TEMPLATES = {
${rows}
};
export function templateFor(id) { return TEMPLATES[String(id || "")] || null; }
export function templateIds() { return Object.keys(TEMPLATES); }
`;
writeFileSync("functions/_pglog_templates.js", out);
console.log("wrote functions/_pglog_templates.js with " + t.templates.length + " templates");
