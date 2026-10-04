import { readFileSync, writeFileSync } from "node:fs";
/* scripts/wardsynq-nfi/gen.mjs - builds wardsynq/adapters/nfi-tables.js from the NFI PDF (see README.md in this folder).
 * Run from NFI_WORK (the folder holding the extracted pages, rows.json, row-pages.json, monographs.json, mons-clean.json). */
import { fileURLToPath } from "node:url";
const W = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
process.chdir(process.env.NFI_WORK || process.cwd());
const { buildRulePack } = await import(W + "/wardsynq/adapters/wardsynq-rules-stewardmd.js");
const raw = JSON.parse(readFileSync(W + "/data/interaction-rules.json", "utf8"));
const allergy = JSON.parse(readFileSync(W + "/wardsynq/data/allergy-classes.seed.json", "utf8"));
const brands = (await import(W + "/brand-generics.js")).default.BRANDS;
const pack = buildRulePack(raw, allergy, { brands });
const SALT = /^(sodium|potassium|calcium|magnesium|disodium|hydrochloride|hcl|sulfate|sulphate|anhydrous|trihydrate|monohydrate|dihydrate|mesylate|mesilate|maleate|citrate|acetate|phosphate|tartrate|fumarate|succinate|bromide|chloride|hyclate|besylate|besilate|decanoate|propionate|dipropionate|valerate|lactate|gluconate|nitrate|hydrobromide|dihydrochloride|sodium succinate|sodium phosphate|disodium phosphate)$/;
const aliasUsed = [];
const exact = (n) => { const t = String(n).toLowerCase().trim(); if (pack.genericIndex.has(t)) return t;
  const a = pack.aliases.get(t); // an alias is accepted only when it is the same name with a qualifier (never a first-word guess like iodine -> iodine bush pollen extract)
  if (a && (SALT.test(a.slice(t.length + 1)) || /^\(.*\)$/.test(a.slice(t.length + 1))) && a.startsWith(t + " ")) { aliasUsed.push(t + " -> " + a); return a; } return null; };
const allGenerics = [...pack.genericIndex];
function expand(base) { // base pack generics plus salt/qualifier forms of the SAME molecule already in the pack
  const out = new Set();
  for (const b of base) {
    out.add(b);
    for (const g of allGenerics) if (g.startsWith(b + " ") && SALT.test(g.slice(b.length + 1))) out.add(g);
    // the pack's own "name (synonym)" spellings, e.g. "glibenclamide (glyburide)"
    for (const g of allGenerics) if (g.startsWith(b + " (") && g.endsWith(")")) out.add(g);
  }
  return [...out].sort();
}
// INN/BAN <-> USAN spellings and NFI headings that carry a bracketed alternative. Identity of the molecule only.
const SYN = {
  "acetylsalicyclic acid": ["aspirin"], "acetaminophen": ["paracetamol", "acetaminophen"], "acetylsalicylic acid": ["aspirin"], "zidovudine (azt)": ["zidovudine"],
  "benzathine benzylpenicillin": ["benzathine penicillin g", "penicillin g benzathine"], "benzyl penicillin": ["penicillin g"],
  "chlormethine": ["mechlorethamine"], "clomifene": ["clomiphene", "clomiphene citrate"], "ethinylestradiol": ["ethinyl estradiol"],
  "5-fluorouracil": ["fluorouracil"], "norethisterone": ["norethindrone"], "phenobarbital": ["phenobarbitone (phenobarbital)"],
  "phenoxy-methyl penicillin": ["penicillin v"], "phenoxymethyl penicillin (penicillinv)": ["penicillin v"], "povidone-iodine": ["povidone-iodine"],
  "glibenclamide": ["glibenclamide (glyburide)", "glyburide"], "salbutamol": ["salbutamol (albuterol sulfate)", "albuterol"],
  "cyclosporine": ["cyclosporine", "ciclosporin"], "amoxycillin": ["amoxycillin", "amoxicillin anhydrous"],
  "paracetamol (acetaminophen)": ["paracetamol"], "hydrocortisone (cortisol)": ["hydrocortisone"], "sodium valproate": ["valproic acid"],
  "desferrioxamine mesylate": ["deferoxamine"], "dimercaprol (bal)": ["dimercaprol"], "d-penicillamine": ["penicillamine"],
  "n-acetylcysteine": ["acetylcysteine"], "pralidoxime (2-pam)": ["pralidoxime"], "diloxanide furoate": ["diloxanide"],
  "procaine benzyl penicillin (procaine penicillin g)": ["procaine penicillin g (penicillin g procaine)"], "sulphadiazine": ["sulfadiazine"],
  "ribavirn": ["ribavirin"], "actinomycin d (dactinomycin)": ["dactinomycin"], "busulphan": ["busulfan"], "cytosine arabinoside (cytarabine)": ["cytarabine"],
  "filgrastim (gcsf)": ["filgrastim"], "folinic acid": ["leucovorin"], "isosorbide-5-mononitrate": ["isosorbide mononitrate"],
  "lidocaine (lignocaine)": ["lidocaine"], "lignocaine": ["lidocaine"], "menadione sodium sulphate": ["menadione"], "furosemide (frusemide)": ["furosemide"],
  "thiopental (thiopentone)": ["thiopental sodium (thiopentone)"], "hyoscine butyl bromide (scopolamine butyl bromide)": ["hyoscine butylbromide (scopolamine butylbromide)"],
  "mesalamine or 5-aminosalicylic acid (5-asa)": ["mesalamine"], "methyl prednisolone": ["methylprednisolone"], "ethacridine lactate": ["ethacridine (ethacridine lactate)"],
  "atracurium besylate": ["atracurium"], "succinylcholine chloride": ["succinylcholine"], "fluphenazine decanoate": ["fluphenazine"],
  "valproic acid and sodium valproate": ["valproic acid"], "ascorbic acid (vitamin c)": ["ascorbic acid"], "ergocalciferol (vitamin d2)": ["ergocalciferol"],
  "dextran-40": ["dextran 40"], "hydroxy ethyl starch": ["hydroxyethyl starch"], "lithium carbonate": ["lithium carbonate"],
};
function generics(name) {
  const k = String(name).toLowerCase().replace(/\s+/g, " ").trim();
  const base = SYN[k] ? SYN[k].map(exact) : [exact(k)];
  if (base.some((b) => !b)) { if (SYN[k]) throw new Error("synonym target missing in pack: " + k); return { list: [], how: "not-in-rulepack" }; }
  return { list: expand(base), how: SYN[k] ? "synonym" : "exact" };
}
const SRC = "NFI 6th ed. draft 2019-20";
// The app writes no em or en dash: the source's dashes become hyphens (a glyph change only; every word and number is kept).
const undash = (x) => (typeof x === "string" ? x.replace(/\s*\u2014\s*/g, " - ").replace(/\u2013/g, "-") : Array.isArray(x) ? x.map(undash) : x);
const rows = JSON.parse(readFileSync("rows.json", "utf8")); rows.R = undash(rows.R); rows.L = undash(rows.L);
const pages = JSON.parse(readFileSync("row-pages.json", "utf8"));

/* ---------- renal ---------- */
const COLS = ["method", "gfrAbove50", "gfr10to50", "gfrBelow10", "capd", "hd"];
const isNormal = (c) => c === "100%" || c === "As normal GFR";
const pct = (c) => { const m = /^(\d+)(?:[–-](\d+))?%$/.exec(c.split(" ")[0]); return m ? Number(m[2] || m[1]) : null; };
const renal = rows.R.map((r, i) => {
  const cells = Object.fromEntries(COLS.map((c, j) => [c, r[j + 1]]));
  const page = pages.renal[i].page; const page2011 = pages.renal[i].page2011;
  const bands = [];
  // GFR >50: an adjustment only when it is a percentage below 100% or "Avoid" (an interval here is the usual interval).
  const p50 = pct(cells.gfrAbove50);
  if (cells.gfrAbove50 === "Avoid" || (p50 !== null && p50 < 100)) bands.push({ band: "GFR >50 ml/min", gt: 50, dose: cells.gfrAbove50 });
  // GFR 10-50 and <10: an adjustment when the cell differs from the GFR >50 cell and is not 100% / As normal GFR.
  if (cells.gfr10to50 !== cells.gfrAbove50 && !isNormal(cells.gfr10to50)) bands.push({ band: "GFR 10-50 ml/min", gte: 10, lte: 50, dose: cells.gfr10to50 });
  if (cells.gfrBelow10 !== cells.gfrAbove50 && !isNormal(cells.gfrBelow10)) bands.push({ band: "GFR <10 ml/min", lt: 10, dose: cells.gfrBelow10, capd: cells.capd, hd: cells.hd });
  const g = generics(r[0]);
  return { id: "renal/" + r[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, ""), drug: r[0], generics: g.list, mapping: g.how, page, page2011,
    quote: r.join(" | "), cells,
    rule: bands.length && g.list.length ? { source: `${SRC}, Appendix 10d, p. ${page}`, method: cells.method, gfrBands: bands } : null,
    status: !g.list.length ? "not-in-rulepack" : bands.length ? "rule" : "no-adjustment" };
});

/* ---------- lactation ---------- */
const lactPolicy = (t) => {
  let m;
  if ((m = /Lactation contraindicated|Discontinue lactation|Stop lactation/i.exec(t))) return ["contraindicated", m[0]];
  if ((m = /\bavoid\b|^Use alternative (drug;|method)/i.exec(t))) return ["major", m[0]];
  if ((m = /use alternative drug if possible|adverse effects possible|caution|risk of|toxicity|inhibit lactation|suppress(es)? lactation|hypoglycaemia|haemolysis|haemolytic|irritability|affect infant|diarrhoea|hypercalcaemia/i.exec(t))) return ["moderate", m[0]];
  if ((m = /\bsafe\b|not known to be harmful|too small to be harmful|no adverse effects reported|risk to infant minimal|Lactation recommended|lactation recommended|Trace amounts in milk/.exec(t))) return [null, m[0]];
  return ["monitor", "(no level word in the text: vague guidance is a caution)"];
};
const byName = new Map(rows.L.map((r, i) => [r[0].toLowerCase(), i]));
const lactation = rows.L.map((r, i) => {
  const [drug, comment] = r; const page = pages.lactation[i].page;
  const see = /^see (.*)$/i.exec(comment);
  let text = comment, quote = `${drug} | ${comment}`, seePage = null;
  if (see) {
    const target = see[1].replace(" with ", " + ").toLowerCase();
    const j = byName.get(target) ?? byName.get(see[1].toLowerCase());
    if (j === undefined) throw new Error("cross-reference target missing: " + see[1]);
    text = rows.L[j][1]; seePage = pages.lactation[j].page; quote += ` || ${rows.L[j][0]} | ${rows.L[j][1]}`;
  }
  const combo = /\+/.test(drug) || /^contraceptives/i.test(drug);
  const g = combo ? { list: [], how: "combination" } : generics(drug);
  const [level, basis] = lactPolicy(text);
  const pageRef = seePage && seePage !== page ? `pp. ${page}, ${seePage}` : `p. ${page}`;
  return { id: "lactation/" + drug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), drug, generics: g.list, mapping: g.how, page, ...(seePage ? { seePage } : {}),
    quote, level, basis,
    rule: level && g.list.length ? { level, text: `${SRC}, Appendix 10b, ${pageRef}: "${text}"` } : null,
    status: combo ? "combination" : !g.list.length ? "not-in-rulepack" : level ? "rule" : "compatible" };
}).map((e, i, all) => {
  if (!/^see /i.test(rows.L[i][1]) || e.status !== "rule") return e;
  const same = all.some((o, j) => j !== i && o.status === "rule" && o.generics.join() === e.generics.join());
  return same ? { ...e, rule: null, status: "see-also" } : e;
});

/* ---------- pregnancy (per monograph) ---------- */
const mons = JSON.parse(readFileSync("mons-clean.json", "utf8"));
for (const m of mons) { m.clean = undash(m.clean); m.name = undash(m.name); for (const f of Object.values(m.fields)) f.text = undash(f.text); }
const parsed = JSON.parse(readFileSync("monographs.json", "utf8"));
const dup = new Map(parsed.map((m) => [m.page + "|" + undash(m.name), m.dupFields || null]));
const pregnancy = [], pregSkipped = [];
for (const m of mons) {
  const fields = ["contraindications", "precautions"].filter((k) => m.fields[k] && /pregnan/i.test(m.fields[k].text));
  if (!fields.length) continue;
  const clean = m.clean.replace(/\s*\(for other indication.*$/i, "").replace(/^\d+\.\s*/, "").replace(/^26\.5\.2 Antioxytocics \(Tocolytics\)\s*/, "").trim();
  const span = Math.max(...Object.values(m.fields).map((f) => f.endPage)) - m.page;
  const why = m.excludedChapter ? "topical/ophthalmic/oral-health/antiseptic chapter (" + m.excludedChapter + "): the engine does not distinguish route"
    : /\+| with /i.test(clean) ? "combination monograph"
    : (dup.get(m.page + "|" + m.name) || []).some(([k]) => ["indications", "contraindications", "precautions"].includes(k)) ? "monograph boundary unclear in the draft's text layer (a second Indications, Contraindications or Precautions follows the heading), not encoded"
    : span > 3 ? "monograph boundary unclear in the draft's text layer (spans " + span + " pages), not encoded" : null;
  const field = fields.includes("contraindications") ? "contraindications" : "precautions";
  const f = m.fields[field];
  // Split the field into its listed items (commas and semicolons outside brackets, and sentence breaks), keep the items that
  // name pregnancy, and drop items that only name a pregnancy-related CONDITION or HISTORY (toxaemia of pregnancy, ectopic
  // pregnancy, jaundice in pregnancy, termination of pregnancy, a pregnancy test): those are not guidance about using the drug in pregnancy.
  const items = []; { let depth = 0, cur = "";
    for (let k = 0; k < f.text.length; k++) { const ch = f.text[k];
      if (ch === "(") depth++; if (ch === ")") depth = Math.max(0, depth - 1);
      if (depth === 0 && (ch === ";" || ch === "," || (ch === "." && /\s[A-Z]/.test(f.text.slice(k + 1, k + 3))))) { items.push(cur); cur = ""; } else cur += ch; }
    items.push(cur);
    // an item that opens with a conjunction continues the one before it ("... under 12 years, or to pregnant ... women")
    for (let k = items.length - 1; k > 0; k--) if (/^\s*(or|and|but|nor)\b/.test(items[k]) && !/[;.]\s*$/.test(items[k - 1])) { items[k - 1] = items[k - 1] + "," + items[k]; items.splice(k, 1); } }
  const CONDITION = /toxa?emia of pregnan|ectopic pregnan|jaundice in pregnan|termination of(?: the)? pregnan|pregnancy tests?/i;
  const clauses = items.map((c) => c.trim()).filter((c) => /pregnan/i.test(c) && !CONDITION.test(c));
  if (!clauses.length) { pregSkipped.push({ id: "pregnancy/" + clean.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-p" + m.page, drug: clean, heading: m.name, generics: [], page: f.page, pageEnd: f.endPage,
    field: field === "contraindications" ? "Contraindications" : "Precautions", quote: f.text, status: "excluded", why: "names pregnancy only as a condition or history (for example toxaemia of pregnancy), not as guidance on using the drug" }); continue; }
  let g = { list: [], how: "not-in-rulepack" };
  if (!why && clean) { try { g = generics(clean); } catch (e) { throw e; } }
  const rec = { id: "pregnancy/" + clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-p" + m.page, drug: clean, heading: m.name, generics: g.list, mapping: g.how,
    page: f.page, pageEnd: f.endPage, field: field === "contraindications" ? "Contraindications" : "Precautions", quote: f.text, clause: clauses.join("; "),
    level: field === "contraindications" ? "contraindicated" : "monitor" };
  if (why || !g.list.length || f.text.length > 1500) { pregSkipped.push({ ...rec, status: why ? "excluded" : f.text.length > 1500 ? "excluded" : "not-in-rulepack", why: why || (f.text.length > 1500 ? "field text too long to trust the boundary" : "not in the rulepack") }); continue; }
  const pp = f.endPage !== f.page ? `pp. ${f.page}-${f.endPage}` : `p. ${f.page}`;
  pregnancy.push({ ...rec, rule: { level: rec.level, text: `${SRC}, ${clean} monograph, ${pp}, ${rec.field}: "${rec.clause}"` }, status: "rule" });
}
console.log("ALIASES", aliasUsed.join(" | "));
writeFileSync("nfi-data.json", JSON.stringify({ renal, lactation, pregnancy, pregSkipped }, null, 1));
const c = (a, s) => a.filter((x) => x.status === s).length;
console.log("renal", renal.length, "rule", c(renal, "rule"), "no-adj", c(renal, "no-adjustment"), "notin", c(renal, "not-in-rulepack"));
console.log("lact", lactation.length, "rule", c(lactation, "rule"), "compat", c(lactation, "compatible"), "combo", c(lactation, "combination"), "notin", c(lactation, "not-in-rulepack"));
console.log("preg", pregnancy.length, "CI", pregnancy.filter((x) => x.level === "contraindicated").length, "skipped", pregSkipped.length, "excluded", c(pregSkipped, "excluded"));

/* ---------- the repo module ---------- */
const SOURCE = {
  id: "nfi-6-draft-2019-20",
  title: "National Formulary of India, 6th Edition 2019-20 (Draft Version)",
  publisher: "Indian Pharmacopoeia Commission, Ministry of Health & Family Welfare, Government of India",
  url: "https://ipc.gov.in/images/Draft_Version_NFI_6th_edition.pdf",
  sha256: "269be2d4f2d8033dab2c40b6c68e72b7b5159b3a69298efe286f7ad3aa33a585",
  bytes: 4061583, lastModified: "2021-05-25", retrieved: "2026-10-04",
  pageNumbering: "PDF page numbers (the draft's printed page numbers restart within chapters)",
  why: "The latest NFI text published free by the IPC. NFI 2021 (6th, final) and NFI 2026 (7th) are sold in print and through the subscription NFI Online portal, not published free.",
  corroboration: "The renal table (Appendix 10d) is identical, row for row, to the final NFI 2011 (4th edition) Appendix 7d, pp. 722-725, hosted by NHSRC: https://qps.nhsrcindia.org/sites/default/files/2022-01/National%20Formulary%20of%20India%20(NFI),%202011.pdf (sha256 e448e2fae4763b66cdbbac99bc7dbbda47005856ef50023a40e9a8fe7fb47237).",
  appendices: { renal: "Appendix 10d Renal Impairment, pp. 873-877", lactation: "Appendix 10b Lactation, pp. 861-870", pregnancy: "Appendix 10c Pregnancy, pp. 871-872, has no per-drug table; pregnancy guidance is read from each monograph's Contraindications and Precautions" },
  encoding: [
    "Every dose cell and every guidance text is the source's own words as the PDF's text layer gives them (its spacing slips included); nothing is paraphrased or computed. The only change is typographic: the source's en and em dashes are written as hyphens, because the app shows no em or en dash.",
    "Renal: the patient's eGFR picks the NFI column (>50, 10-50 inclusive, <10 ml/min). The >50 column is a finding only when it is a percentage below 100% or Avoid (otherwise it is the usual dose or interval); the 10-50 and <10 columns are a finding only when they differ from the >50 cell and are not 100% or As normal GFR. The CAPD and HD cells are shown with the <10 band. An eGFR of 90 or more is normal renal function and raises nothing (the engine's existing rule).",
    "Lactation (Appendix 10b): Lactation contraindicated, Discontinue lactation or Stop lactation is contraindicated; avoid, or Use alternative drug/method, is major; use alternative drug if possible, adverse effects possible, caution, risk of, toxicity, inhibit or suppress lactation, hypoglycaemia, haemolysis, irritability, affect infant, diarrhoea or hypercalcaemia is moderate; text that says safe, not known to be harmful, too small to be harmful, no adverse effects reported, risk to infant minimal, Lactation recommended or Trace amounts in milk, with none of those words, is compatible and raises nothing; anything else is vague and is a caution at level monitor. Combination products and drugs outside the rule pack are listed and not encoded.",
    "Pregnancy (monographs): pregnancy listed under Contraindications is contraindicated; listed only under Precautions is a caution at level monitor. The quoted item is the listed item that names pregnancy; an item that names only a condition or history (toxaemia of pregnancy, ectopic pregnancy, jaundice in pregnancy, termination of pregnancy, a pregnancy test) is not guidance and is left out. Topical, ophthalmic, oral-health and antiseptic monographs, combination monographs and monographs whose boundaries are unclear in the draft's text layer are not encoded.",
    "Every finding is overridable with a reason (the engine's rule for renal, pregnancy and lactation findings); none is a hard stop.",
  ],
};
const keep = (e) => { const o = { ...e }; return o; };
const lines = (arr) => "[\n" + arr.map((e) => "  " + JSON.stringify(keep(e))).join(",\n") + ",\n]";
const mod = `/* wardsynq/adapters/nfi-tables.js - GENERATED from the National Formulary of India (see NFI_SOURCE). Do not hand-edit:
 * every entry is signed off as part of its table (seed-signoff.js, list "nfi-tables"), and ANY edit to a table changes its
 * fingerprint and turns that table off again until it is signed off afresh.
 *
 * Owner decision 2026-10-04: the renal and pregnancy/lactation tables come from the NFI, and take effect only after the owner's
 * clinical sign-off. Each entry carries the source's own text (quote), its PDF page, and the rule the engine is given (rule:
 * null where the source text raises nothing). The transcription and the encoding policy are in NFI_SOURCE; the review document
 * for the owner lists every entry beside its quote.
 */
export const NFI_SOURCE = ${JSON.stringify(SOURCE, null, 2)};

export const NFI_RENAL = ${lines(renal)};

export const NFI_LACTATION = ${lines(lactation)};

export const NFI_PREGNANCY = ${lines(pregnancy)};

const deepFreeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; };
deepFreeze(NFI_SOURCE); deepFreeze(NFI_RENAL); deepFreeze(NFI_LACTATION); deepFreeze(NFI_PREGNANCY);
`;
writeFileSync(W + "/wardsynq/adapters/nfi-tables.js", mod);
writeFileSync("nfi-source.json", JSON.stringify(SOURCE, null, 1));
console.log("module bytes", mod.length);
