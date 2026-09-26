/* test/antibiogram-rules.test.mjs: the rules that decide whether an antibiogram number may be
 * shown (antibiogram-rules.js). A wrong answer here puts a misleading percentage in front of a
 * prescriber, so each rule is pinned with the case that motivated it.
 *
 * node --test test/antibiogram-rules.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const R = require("../antibiogram-rules.js");

const row = (o) => R.validateRow(Object.assign({ spec: "all", set: "all", n: 200, s: {}, nt: {} }, o));

test("canonical names: laboratory codes, spellings and phenotypes", () => {
  assert.equal(R.canonDrug("TZP"), "piptazo");
  assert.equal(R.canonDrug("Piperacillin-tazobactam"), "piptazo");
  assert.equal(R.canonDrug("AMK"), "amikacin");
  assert.equal(R.canonDrug("CFS"), "cefoperazone_sulbactam");
  assert.equal(R.canonDrug("definitely not a drug"), null);
  assert.deepEqual(R.canonOrg("Klebsiella pneumoniae"), { key: "klebsiella", pheno: null });
  assert.deepEqual(R.canonOrg("MRSA"), { key: "saureus", pheno: "MRSA" });
  assert.deepEqual(R.canonOrg("Pichia kudriavzevii"), { key: "ckrusei", pheno: null });
  assert.equal(R.canonSpecimen("LRT"), "respiratory");
  assert.equal(R.canonSpecimen("DI"), "deep");
  assert.equal(R.canonSpecimen("CSF"), "csf");
  assert.equal(R.canonSetting("IPD"), "ward");
  assert.equal(R.canonSetting("OPD"), "opd");
});

test("every drug has a label and a class; every AWaRe group is A, W, R or none", () => {
  Object.keys(R.DRUGS).forEach((k) => {
    const d = R.DRUGS[k];
    assert.ok(d.label && d.cls, k + " label/class");
    assert.ok([undefined, null, "A", "W", "R"].includes(d.aware), k + " aware " + d.aware);
  });
  assert.equal(R.aware("amikacin"), "A");
  assert.equal(R.aware("meropenem"), "W");
  assert.equal(R.aware("colistin"), "R");
});

test("intrinsic resistance is never shown as a number (CLSI M100 Appendix B)", () => {
  const k = row({ org: "klebsiella", s: { ampicillin: 12, meropenem: 60 } });
  assert.equal(k.cells.ampicillin.act, "intrinsic");
  assert.equal(k.cells.meropenem.act, "keep");
  const e = row({ org: "efaecalis", s: { ceftriaxone: 40, gentamicin: 30, ampicillin: 90 } });
  assert.equal(e.cells.ceftriaxone.act, "intrinsic", "enterococci and cephalosporins");
  assert.equal(e.cells.gentamicin.act, "intrinsic", "standard aminoglycoside");
  assert.equal(e.cells.ampicillin.act, "keep");
  const p = row({ org: "paeruginosa", s: { ertapenem: 20, ceftriaxone: 10, cotrimoxazole: 5, meropenem: 60 } });
  ["ertapenem", "ceftriaxone", "cotrimoxazole"].forEach((d) => assert.equal(p.cells[d].act, "intrinsic", d));
  assert.equal(row({ org: "ecoli", s: { vancomycin: 0 } }).cells.vancomycin.act, "intrinsic");
  assert.equal(row({ org: "saureus", s: { colistin: 0 } }).cells.colistin.act, "intrinsic");
  assert.equal(row({ org: "ckrusei", s: { fluconazole: 20 } }).cells.fluconazole.act, "intrinsic");
  assert.equal(row({ org: "afumigatus", s: { fluconazole: 0, voriconazole: 95 } }).cells.fluconazole.act, "intrinsic");
  assert.equal(row({ org: "calbicans", s: { meropenem: 0 } }).cells.meropenem.act, "intrinsic", "antibacterial vs yeast");
});

test("Salmonella and Shigella: aminoglycosides and early cephalosporins are not reported as susceptible", () => {
  const r = row({ org: "salmonella_typhi", s: { gentamicin: 95, cefuroxime: 90, ceftriaxone: 97 } });
  assert.equal(r.cells.gentamicin.act, "intrinsic");
  assert.equal(r.cells.cefuroxime.act, "intrinsic");
  assert.equal(r.cells.ceftriaxone.act, "keep");
});

test("specimen relevance: nitrofurantoin only for urine, daptomycin never for respiratory", () => {
  assert.equal(row({ org: "ecoli", spec: "blood", s: { nitrofurantoin: 90 } }).cells.nitrofurantoin.act, "hide");
  assert.equal(row({ org: "ecoli", spec: "urine", s: { nitrofurantoin: 90 } }).cells.nitrofurantoin.act, "keep");
  assert.equal(row({ org: "ecoli", spec: "nonurine", s: { nitrofurantoin: 90 } }).cells.nitrofurantoin.act, "hide");
  assert.equal(row({ org: "saureus", spec: "respiratory", s: { daptomycin: 100 } }).cells.daptomycin.act, "hide");
  assert.equal(row({ org: "ecoli", spec: "blood", s: { fosfomycin: 95 } }).cells.fosfomycin.act, "caution");
});

test("staphylococcal phenotypes: MRSA rows cannot be beta-lactam susceptible; MSSA rows cannot be cefoxitin resistant", () => {
  const mr = row({ org: "saureus", pheno: "MRSA", s: { penicillin: 20, amoxiclav: 10, vancomycin: 100, ceftaroline: 95 } });
  assert.equal(mr.cells.penicillin.act, "suppress");
  assert.equal(mr.cells.amoxiclav.act, "suppress");
  assert.equal(mr.cells.vancomycin.act, "keep");
  assert.equal(mr.cells.ceftaroline.act, "keep", "ceftaroline is the exception");
  assert.equal(row({ org: "saureus", pheno: "MRSA", s: { penicillin: 0 } }).cells.penicillin.act, "keep", "0% is consistent");
  assert.equal(row({ org: "saureus", pheno: "MSSA", s: { cefoxitin: 80 } }).cells.cefoxitin.act, "suppress");
  // Mixed S. aureus row: a beta-lactam cannot beat methicillin susceptibility.
  const mix = row({ org: "saureus", s: { cefoxitin: 40, amoxiclav: 70, cefazolin: 42 } });
  assert.equal(mix.cells.amoxiclav.act, "suppress");
  assert.equal(mix.cells.cefazolin.act, "keep", "within 5 points");
});

test("arithmetic: a % no whole number of isolates can give is flagged, not hidden", () => {
  assert.equal(R.achievable(50, 4), true);
  assert.equal(R.achievable(35, 4), false);
  assert.equal(R.achievable(33.3, 3), true);
  assert.equal(R.achievable(26.6, 15), true, "truncated 4/15");
  assert.equal(R.achievable(12.34, 5000), true, "large n short-circuits");
  const r = row({ org: "ecoli", n: 4, s: { amikacin: 35 } });
  assert.equal(r.cells.amikacin.act, "caution");
  assert.ok(/whole number/.test(r.cells.amikacin.why));
  assert.equal(row({ org: "ecoli", n: 4, s: { amikacin: 75 } }).cells.amikacin.act, "keep");
});

test("paired agents must agree: cefotaxime vs ceftriaxone, imipenem vs meropenem", () => {
  const r = row({ org: "ecoli", s: { cefotaxime: 20, ceftriaxone: 70 } });
  assert.equal(r.cells.cefotaxime.act, "caution");
  assert.equal(r.cells.ceftriaxone.act, "caution");
  const k = row({ org: "klebsiella", s: { imipenem: 80, meropenem: 40 } });
  assert.equal(k.cells.imipenem.act, "caution");
  const ok = row({ org: "klebsiella", s: { imipenem: 45, meropenem: 40 } });
  assert.equal(ok.cells.imipenem.act, "keep");
});

test("CLSI M39: fewer than 30 isolates is flagged; approximate chart readings are cautions", () => {
  assert.ok(row({ org: "ecoli", n: 12, s: { amikacin: 75 } }).flags.includes("lowN"));
  assert.ok(row({ org: "ecoli", n: null, s: { amikacin: 75 } }).flags.includes("noN"));
  assert.equal(row({ org: "ecoli", s: { amikacin: 75 }, approx: ["amikacin"] }).cells.amikacin.act, "caution");
});

test("pooling: isolate-weighted, latest edition per institution, only cells and rows that passed", () => {
  const mk = (src, inst, year, n, s, act) => ({ src, inst, year, n, cells: { meropenem: { s, act: act || "keep", nt: null } } });
  const p = R.pool([
    mk("A_2023", "A", 2023, 100, 10),
    mk("A_2024", "A", 2024, 100, 50),          // latest of A
    mk("B_2024", "B", 2024, 300, 90),
    mk("C_2024", "C", 2024, 20, 0),            // under 30: never pooled
    mk("D_2024", "D", 2024, 500, 5, "caution") // failed a check: never pooled
  ]);
  assert.equal(p.meropenem.k, 2);
  assert.equal(p.meropenem.n, 400);
  assert.equal(p.meropenem.s, 80, "(100*50 + 300*90) / 400");
  assert.deepEqual([p.meropenem.min, p.meropenem.max], [50, 90]);
});

test("WISCA: single agent is weighted by organism frequency; two agents give a range; intrinsic counts as 0", () => {
  const parts = [
    { org: "ecoli", n: 60, s: { meropenem: 90, amikacin: 80 }, act: {} },
    { org: "efaecalis", n: 40, s: { ampicillin: 90, meropenem: 50 }, act: {} }
  ];
  const w = R.wisca(parts, ["meropenem"]);
  assert.equal(w.coverage, 74, "(60*90 + 40*50)/100");
  assert.equal(w.knownPct, 100);
  const a = R.wisca(parts, ["amikacin"]);
  assert.equal(a.coverage, 48, "enterococci are intrinsically resistant to amikacin: 60*80/100");
  const two = R.wisca(parts, ["meropenem", "amikacin"]);
  assert.equal(two.low, 74);
  assert.equal(two.high, 80, "min(100, 90+80) for E. coli, 50+0 for E. faecalis");
  const none = R.wisca([{ org: "ecoli", n: 10, s: {}, act: {} }], ["colistin"]);
  assert.equal(none.coverage, null);
});

test("summary CSV import: codes resolve, bad values are refused with a reason", () => {
  const r = R.importSummaryCsv("organism,specimen,setting,n,AMK,TZP,Foo\nE. coli,urine,OPD,120,92,76.5,1\nNobody,urine,opd,10,50,50,\nK. pneumoniae,blood,ICU,40,140,30,\n");
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.some((w) => /Foo/.test(w)));
  assert.ok(r.warnings.some((w) => /Nobody/.test(w)));
  assert.ok(r.warnings.some((w) => /140 is outside/.test(w)));
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0], { org: "ecoli", pheno: null, spec: "urine", set: "opd", n: 120, s: { amikacin: 92, piptazo: 76.5 } });
  assert.equal(R.importSummaryCsv("x\n").errors.length, 1);
  assert.ok(R.importSummaryCsv(R.summaryTemplate()).rows.length >= 2, "the template imports cleanly");
});

test("isolate CSV import: first isolate per patient (CLSI M39), %S = S / tested, IDs never kept", () => {
  const csv = "patient_id,date,specimen,location,organism,MEM,CIP\n" +
    "UHID-001,2026-01-01,urine,opd,E. coli,S,R\n" +
    "UHID-001,2026-01-20,urine,opd,E. coli,R,R\n" +      // repeat isolate: dropped
    "UHID-002,2026-02-01,urine,opd,E. coli,S,S\n" +
    "UHID-003,2026-02-03,blood,icu,E. coli,R,I\n";
  const r = R.importIsolateCsv(csv);
  assert.equal(r.isolates, 4);
  assert.equal(r.firstIsolates, 3);
  const urine = r.rows.find((x) => x.org === "ecoli" && x.spec === "urine" && x.set === "opd");
  assert.equal(urine.n, 2);
  assert.equal(urine.s.meropenem, 100);
  assert.equal(urine.s.ciprofloxacin, 50);
  const all = r.rows.find((x) => x.org === "ecoli" && x.spec === "all" && x.set === "all");
  assert.equal(all.n, 3);
  assert.equal(all.s.ciprofloxacin, 33.3, "intermediate is not susceptible");
  assert.ok(!JSON.stringify(r).includes("UHID"), "patient identifiers are not in the result");
});

test("isolate CSV import: MRSA expert rule and phenotype rows", () => {
  const csv = "patient,organism,FOX,AMC,VAN\nP1,Staphylococcus aureus,R,S,S\nP2,Staphylococcus aureus,S,S,S\nP3,Staphylococcus aureus,R,R,S\n";
  const r = R.importIsolateCsv(csv);
  assert.ok(r.warnings.some((w) => /expert rule/.test(w)));
  const all = r.rows.find((x) => x.org === "saureus" && !x.pheno && x.spec === "all" && x.set === "all");
  assert.equal(all.n, 3);
  assert.equal(all.s.amoxiclav, 33.3, "the MRSA isolate's AMC 'S' was set to R");
  assert.equal(all.s.cefoxitin, 33.3);
  const mrsa = r.rows.find((x) => x.pheno === "MRSA" && x.spec === "all" && x.set === "all");
  assert.equal(mrsa.n, 2);
  assert.equal(mrsa.s.amoxiclav, 0);
  assert.equal(mrsa.s.vancomycin, 100);
  const mssa = r.rows.find((x) => x.pheno === "MSSA" && x.spec === "all" && x.set === "all");
  assert.equal(mssa.n, 1);
  assert.equal(R.validateRow(Object.assign({}, mrsa)).cells.amoxiclav.act, "keep", "consistent after the rule");
});

test("phenotype rates come from the marker drug", () => {
  const p = R.phenoRates({ saureus: { cefoxitin: { s: 45, n: 200 } }, klebsiella: { ceftriaxone: { s: 20, n: 300 }, meropenem: { s: 60, n: 300 } } });
  const mrsa = p.find((x) => x.label === "MRSA");
  assert.equal(mrsa.pct, 55);
  assert.ok(p.find((x) => /Carbapenem-resistant Klebsiella/.test(x.label)).pct === 40);
});

test("a figure the source contradicts is a caution, never a plain number (ICMR 2024 Table 2.14)", () => {
  // Printed 8.6% but the printed counts are 121/154 = 78.6%: 8.6 is achievable for some n, so only
  // the extractor's conflict note can catch it.
  const r = row({ org: "morganella", spec: "urine", n: 154, s: { amikacin: 8.6 }, nt: { amikacin: 154 }, conflict: { amikacin: "printed 8.6% but 121/154 = 78.6%" } });
  assert.equal(r.cells.amikacin.act, "caution");
  assert.match(r.cells.amikacin.why, /contradicts itself/);
  const ir = row({ org: "morganella", s: { ampicillin: 5 }, conflict: { ampicillin: "x" } });
  assert.equal(ir.cells.ampicillin.act, "intrinsic", "intrinsic still wins");
});

test("colistin 0% from a CLSI laboratory is a caution, not 100% resistance", () => {
  const r = row({ org: "paeruginosa", s: { colistin: 0, polymyxin_b: 0, meropenem: 60 } });
  assert.equal(r.cells.colistin.act, "caution");
  assert.match(r.cells.colistin.why, /no susceptible category/);
  assert.equal(r.cells.polymyxin_b.act, "caution");
  assert.equal(row({ org: "acinetobacter", s: { colistin: 95 } }).cells.colistin.act, "keep");
  assert.equal(row({ org: "pmirabilis", s: { colistin: 0 } }).cells.colistin.act, "intrinsic", "Proteus is intrinsically resistant");
});

test("species kept apart where their intrinsic resistance differs", () => {
  assert.equal(R.canonOrg("Klebsiella oxytoca").key, "koxytoca");
  assert.equal(R.canonOrg("Enterobacter aerogenes").key, "kaerogenes");
  assert.equal(R.canonOrg("Enterobacter cloacae").key, "ecloacae");
  assert.equal(R.canonOrg("Enterobacter spp.").key, "enterobacter");
  assert.equal(R.canonOrg("Providencia stuartii").key, "pstuartii");
  assert.equal(row({ org: "pstuartii", s: { gentamicin: 50, amikacin: 80 } }).cells.gentamicin.act, "intrinsic", "P. stuartii aac(2')-Ia");
  assert.equal(row({ org: "prettgeri", s: { gentamicin: 50 } }).cells.gentamicin.act, "keep");
  assert.equal(row({ org: "kaerogenes", s: { cefoxitin: 30 } }).cells.cefoxitin.act, "intrinsic", "chromosomal AmpC");
});

test("WHONET export column names resolve to drugs", () => {
  assert.equal(R.canonDrug("AMK_ND30"), "amikacin");
  assert.equal(R.canonDrug("MEM_NM"), "meropenem");
  assert.equal(R.canonDrug("TZP_ND100/10"), "piptazo");
  assert.equal(R.canonDrug("FOX_ND30"), "cefoxitin");
  assert.equal(R.canonDrug("XYZ_ND30"), null);
  const r = R.importIsolateCsv("PATIENT_ID,SPEC_DATE,SPEC_TYPE,WARD,ORGANISM,AMK_ND30,MEM_NM\nA1,2026-01-02,ur,opd,E. coli,S,S\nA2,2026-01-03,ur,opd,E. coli,R,S\n");
  const all = r.rows.find((x) => x.org === "ecoli" && x.spec === "all" && x.set === "all");
  assert.equal(all.s.amikacin, 50);
  assert.equal(all.s.meropenem, 100);
});

test("hospital import: laboratory specimen and location names are recognised, the rest listed", () => {
  const r = R.importIsolateCsv("PATIENT_ID,SPEC_TYPE,WARD,ORGANISM,AMK_ND30\nA1,ur,MICU-2,E. coli,S\nA2,Blood culture,Medicine Ward 3,E. coli,R\nA3,xx,OT,E. coli,R\n");
  assert.ok(r.rows.some((x) => x.spec === "urine" && x.set === "icu"));
  assert.ok(r.rows.some((x) => x.spec === "blood" && x.set === "ward"));
  assert.ok(r.warnings.some((w) => /Specimen values not recognised.*xx/.test(w)));
  assert.ok(r.warnings.some((w) => /Setting values not recognised.*OT/.test(w)));
});
