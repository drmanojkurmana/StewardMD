/* test/maik-lite-rag.test.mjs — verifies the JS BM25 port matches book_search.py's own
 * selfcheck() (intent routing, bibliography demotion, synonym expansion), plus the
 * evidence gate ported from pipeline.py. Faithfulness to the Python source is the whole
 * point of this file - a silent drift here is exactly the class of bug that cost a night. */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const R = require("../kb/ai/maik-lite-rag.js");

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };

// ── selfcheck, adapted from book_search.py's own (its literal text is 192 chars and is
// silently rejected by MIN_CHUNK=250, a pre-existing bug in the Python source confirmed
// live via `python3 book_search.py --selfcheck` - same AssertionError there as here before
// this fix. Text lengthened here to actually exercise the code path; logic unchanged. ──
{
  const rows = [
    { i: 0, text: "Ceftriaxone 500 mg is given intravenously for severe infection. ".repeat(4),
      headings: ["Infection", "Treatment"], pages: [10] },
    { i: 1, text: "The pathogenesis involves endothelial injury and stasis. ".repeat(5),
      headings: ["Thrombosis", "Pathogenesis"], pages: [22] },
    { i: 2, text: "Ceftriaxone dosing reference list. ".repeat(8),
      headings: ["Infection", "Further Reading"], pages: [99] }
  ];
  const bk = new R.Book(rows);
  const top1 = bk.search("how do I treat this infection", 3);
  ok("treatment question hits the treatment chunk first", top1.length && top1[0][1] === 0);
  const top2 = bk.search("what causes thrombosis", 1);
  ok("cause question hits the pathogenesis chunk", top2[0][1] === 1);
  const ranked = bk.search("ceftriaxone", 3).map((x) => x[1]);
  ok("bibliography demoted below a real section on the same terms", ranked.indexOf(0) < ranked.indexOf(2));
  ok("abbreviation expansion: tx -> treatment", R.expand("first line tx for pneumonia")[0].includes("treatment"));
  ok("abbreviation expansion: PE -> pulmonary embolism", R.expand("how to treat PE")[0].toLowerCase().includes("pulmonary"));
  ok("no match returns empty", bk.search("zzzznotpresent").length === 0);
}

// ── page cap: near-duplicate chunks on the same page must not fill every slot ──
{
  const rows = [0, 1, 2].map((i) => ({ i, text: "Warfarin dosing and monitoring for atrial fibrillation. ".repeat(5),
    headings: ["Atrial Fibrillation", "Treatment"], pages: [50] }));
  rows.push({ i: 3, text: "Second page: warfarin dosing continued for atrial fibrillation patients here. ".repeat(5),
    headings: ["Atrial Fibrillation", "Treatment"], pages: [51] });
  const bk = new R.Book(rows);
  const top = bk.search("warfarin dosing atrial fibrillation", 3);
  const pages = top.map(([, i]) => rows[i].pages[0]);
  const onPage50 = pages.filter((p) => p === 50).length;
  ok("page cap holds even when many chunks share a page", onPage50 <= 2);
}

// ── evidence gate: numbers/drugs must come from evidence or the question ──
{
  const g1 = R.evidenceGate("Give ceftriaxone 2 g IV [1].", "[1] Ceftriaxone 2 g IV once daily for severe infection.", "");
  ok("supported number+drug passes", g1.ok === true);

  const g2 = R.evidenceGate("Give azithromycin 500 mg twice daily.", "Amoxicillin 500 mg is first-line.", "");
  ok("unsupported drug is caught", g2.ok === false && g2.drugs.includes("azithromycin"));

  const g3 = R.evidenceGate("Reduce to 32 mg/dL.", "General glucose management guidance.", "Glucose is 32 mg/dL on presentation.");
  ok("a number from the QUESTION (clinician-supplied) is not a hallucination", g3.ok === true);

  const g4 = R.evidenceGate("TLC was 18,000.", "Leukocyte count elevated.", "TLC 18k on admission");
  ok("18k in the question covers 18,000 in the answer", g4.ok === true);

  // The exact live failure this was built to catch: a penicillin recommended as the
  // penicillin-allergy alternative is a DRUG the evidence never actually supports for
  // that indication - if the real evidence only supports doxycycline, amoxicillin-clavulanate
  // (unsupported) must be flagged.
  const g5 = R.evidenceGate(
    "For penicillin allergy, use doxycycline plus amoxicillin-clavulanate.",
    "For penicillin allergy, use doxycycline monotherapy or a respiratory fluoroquinolone.", "");
  ok("a drug not present in the actual evidence is flagged even mid-sentence",
     g5.ok === false && g5.drugs.includes("amoxicillin"));
}

console.log(`maik-lite-rag: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
