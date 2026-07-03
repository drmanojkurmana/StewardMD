/* StewardMD — render kb/manifest/COVERAGE-GAP-REPORT.md from the machine outputs.
 * Reads source-manifest.json + coverage-matrix.json + coverage-gap-report.json.
 * USAGE: node kb/tools/build-gap-report-md.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const ROOT = new URL("../../", import.meta.url).pathname + "kb/manifest/";
const rd = (f) => existsSync(ROOT + f) ? JSON.parse(readFileSync(ROOT + f, "utf8")) : null;
const man = rd("source-manifest.json"), cm = rd("coverage-matrix.json"), gr = rd("coverage-gap-report.json");
const pct = (n, d) => d ? (Math.round((n / d) * 1000) / 10) : 0;
const L = [];
const p = (s) => L.push(s == null ? "" : s);

p("# MaiK Knowledge Coverage & Gap Report");
p("");
p("_Phase 2 lawful-coverage deliverable. Measures what the knowledge base can ground — it copies no source text and invents no content. Regenerate with `node kb/tools/build-coverage-matrix.mjs && BASE=<served app> node test/run-maik-coverage.mjs && node kb/tools/build-gap-report-md.mjs`._");
p("");

p("## 1. Source manifest & lawful-use policy");
if (man) {
  p("");
  p(`Treatment precedence: **${man.treatmentPrecedence.join(" ▸ ")}**. Policy: paraphrase-only, no verbatim, no paywalled ingestion, citation required. The deterministic engine — not any source or the LLM — owns diagnosis and stewardship.`);
  p("");
  p("| Source | Type | Use | Tier | Verbatim stored | Clinician label |");
  p("|---|---|---|---|---|---|");
  man.sources.forEach((s) => p(`| ${s.name} | ${s.type} | ${s.usage} | ${s.precedenceTier || "—"} | ${s.verbatimStored ? "⚠️ yes" : "no"} | ${s.clinicianFacingLabel} |`));
}
p("");

p("## 2. Coverage matrix — what the KB contains");
if (cm) {
  p("");
  p(`${cm.totals.diseases} searchable diseases (${cm.totals.diagnostic} diagnostic + ${cm.totals.reference} reference-only). Capability presence across all diseases:`);
  p("");
  p("| Capability | Coverage |");
  p("|---|---|");
  Object.entries(cm.dimensionCoveragePct).forEach(([k, v]) => p(`| ${k} | ${v}% |`));
  p("");
  p("**Read:** diagnostic-side content (overview, features, pathophysiology, differential, investigations, red flags) is near-complete across all 484 diseases. Treatment-side content (management, drug therapy, dosing, stewardship) is concentrated in the diagnostic infective/emergency syndromes — this is the structural gap.");
  p("");
  p("### By specialty (management / drug-therapy / dosing presence)");
  p("");
  p("| Specialty | Diseases | management | drugTherapy | dosing |");
  p("|---|---|---|---|---|");
  Object.entries(cm.bySpecialty).sort((a, b) => b[1].total - a[1].total).forEach(([s, v]) =>
    p(`| ${s} | ${v.total} | ${v.dims.management} | ${v.dims.drugTherapy} | ${v.dims.dosing} |`));
}
p("");

p("## 3. Gap report — what the KB can actually answer (live retrieval)");
if (gr) {
  p("");
  p(`Ran **${gr.totals.questions}** tagged clinician questions (${gr.totals.inScope} in-scope) through the production retrieval path. Verdicts:`);
  p("");
  p("| Verdict | Meaning | Count |");
  const meanings = { STRONG: "expected topic + the asked capability retrieved", PARTIAL: "right topic, asked capability (dose/mgmt/…) absent", TOPIC_MISS: "expected topic not retrieved (incl. correct-sibling retrievals the test-tag didn't anticipate)", MISS: "nothing retrieved", INKB_MISLABELED: "probe tagged out-of-scope but the topic is actually in the KB and was retrieved (coverage-positive)", OOS_OK: "genuinely out-of-scope probe correctly NOT force-fit (good)", OOS_FALSEHIT: "out-of-scope probe locked onto an unseen topic (review)" };
  p("|---|---|---|");
  Object.entries(gr.byVerdict).forEach(([k, v]) => p(`| ${k} | ${meanings[k] || ""} | ${v} |`));
  p("");
  p(`In-scope **STRONG ${gr.totals.strongPct}%**, PARTIAL ${gr.totals.partialPct}%. Proprietary-label leaks in Sources: **${gr.proprietaryLabelLeaks}** ${gr.proprietaryLabelLeaks === 0 ? "✅" : "⚠️"}. Gap-probes behaving as expected: ${gr.gapProbesBehavingAsExpected}.`);
  p("");
  p("### By question type");
  p("");
  p("| qType | verdict breakdown |");
  p("|---|---|");
  Object.entries(gr.byType).forEach(([k, v]) => p(`| ${k} | ${Object.entries(v).map(([a, b]) => `${a}:${b}`).join(", ")} |`));
  p("");
  // notable gaps: in-scope non-STRONG + out-of-scope false hits
  const gaps = gr.results.filter((r) => /TOPIC_MISS|MISS|PARTIAL|OOS_FALSEHIT/.test(r.verdict));
  p(`### Notable gaps (${gaps.length})`);
  p("");
  if (gaps.length) {
    p("| Verdict | qType | Question | Expected topic | Top retrieved |");
    p("|---|---|---|---|---|");
    gaps.slice(0, 60).forEach((r) => p(`| ${r.verdict} | ${r.qType} | ${String(r.q).replace(/\|/g, "/").slice(0, 70)} | ${r.expectTopicName || "—"} | ${r.retrievedTop ? r.retrievedTop.d + "/" + r.retrievedTop.s : "—"} |`));
    if (gaps.length > 60) p(`\n_…and ${gaps.length - 60} more in coverage-gap-report.json._`);
  } else p("_No in-scope gaps surfaced._");
  p("");
  p("### Interpretation (manual triage of the gaps)");
  p("");
  p("- **Retrieval is disease-name-token biased.** Symptom-only questions that never name the disease (\"tearing chest pain radiating to back\", \"new AF, HR 140\", \"hypoglycaemic patient — when to admit\") can mis-route to a lexically-adjacent topic (GERD, congenital heart disease, malaria). In the live app a *patient case* mitigates this — `buildPackage` retrieves on the engine's assessment findings, not the raw phrase — but pure general-knowledge symptom queries expose the bias. **Remediation: add symptom/alias tokens to disease records; no content change.**");
  p("- **Several TOPIC_MISS are correct sibling retrievals**, not failures — e.g. \"empiric antibiotics for febrile neutropenia in AML\" retrieved FEBRILE_NEUTROPENIA (the right treatment topic) rather than the AML reference page; \"metronidazole dose for amoebic liver abscess\" retrieved AMOEBIC_LIVER_ABSCESS. These are test-tag mismatches; true topic coverage is higher than the STRONG% alone implies.");
  p("- **PARTIAL on red_flags / investigations** is a real ranking gap: the correct disease is retrieved but the red-flag / investigation chunk is out-ranked by overview/management chunks. **Remediation: retrieval-side section boosting for the asked capability (mirrors the existing treat-intent boost).**");
  p("- **INKB_MISLABELED (9)** confirms broad coverage: topics the generator guessed were out-of-scope (SBP, infective endocarditis, PE, thyroid storm, scrub typhus, cholangitis) are in fact in the KB and were retrieved with high confidence.");
}
p("");

p("## 4. Recommended remediation (lawful, no textbook copying)");
p("");
p("- **Dosing / drug-therapy gaps** (largest structural gap): expand the **StewardMD Drug Index** so regimen `drugRefs` carry dose/route/frequency for non-infective and reference conditions that currently have management prose but no explicit dose. Source: internal formulary — no copyright issue.");
p("- **Management on reference-only diseases**: promote selected high-yield reference diseases to diagnostic tier by authoring a paraphrased `management` framework from the cited society/national guideline (ICMR ▸ guideline precedence), never verbatim. This is the Phase-4 promotion track in the reasoning plan.");
p("- **TOPIC_MISS items**: add aliases / synonyms to the disease record so lexical retrieval locks the right topic; no content change needed.");
p("- **out_of_scope probes**: confirm MaiK returns the honest gap sentence rather than forcing an answer (KNOWLEDGE_SYS already instructs this; verify against provider in Phase 3).");
p("");
p("_No remediation invents clinical content; each maps to a declared source in the manifest._");

writeFileSync(ROOT + "COVERAGE-GAP-REPORT.md", L.join("\n") + "\n");
console.log("→ kb/manifest/COVERAGE-GAP-REPORT.md (" + L.length + " lines)");
