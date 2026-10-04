/* wardsynq/adapters/nfi-rules.js - the National Formulary of India tables (nfi-tables.js) as engine rule-pack sections, and
 * only for the tables the owner has signed off.
 *
 * Owner decision 2026-10-04: the renal and pregnancy/lactation tables are built from the NFI and take effect only after the
 * owner's clinical sign-off. The sign-off is the existing fingerprinted one (functions/_wardsynq/seed-signoff.js, list
 * "nfi-tables", one item per table): a table whose content changes after it was signed is unsigned again by construction,
 * and an unsigned table adds NOTHING to the pack. Which tables are signed is decided by the caller (rulepack.js reads the
 * sign-off records); this file only turns signed tables into rules.
 *
 * Kept apart from wardsynq-rules-stewardmd.js on purpose: that adapter is also loaded in a browser, and these tables are
 * large. Only the Worker imports this file.
 */
import { compileRulePack, SEVERITY_ORDER } from "../wardsynq-safety.js";
import { NFI_SOURCE, NFI_RENAL, NFI_LACTATION, NFI_PREGNANCY } from "./nfi-tables.js";

/** The three tables, in the order the sign-off list shows them. */
export const NFI_TABLE_IDS = Object.freeze(["renal", "pregnancy", "lactation"]);
const ENTRIES = Object.freeze({ renal: NFI_RENAL, pregnancy: NFI_PREGNANCY, lactation: NFI_LACTATION });
export const NFI_TABLE_LABELS = Object.freeze({
  renal: "NFI renal dose table (Appendix 10d)",
  pregnancy: "NFI pregnancy table (monograph Contraindications and Precautions)",
  lactation: "NFI lactation table (Appendix 10b)",
});
/** Short name used in coverage messages. */
export const NFI_SHORT = "NFI 6th ed. draft 2019-20";

/** What is signed for a table: the source, its encoding policy and every entry with its quote and rule. */
export function nfiTableContent(id) {
  if (!ENTRIES[id]) throw new Error("unknown NFI table " + id);
  return { source: NFI_SOURCE, table: id, entries: ENTRIES[id] };
}

/** Every pack generic a table has an entry for, whether or not the entry raises anything (an NFI "safe" is still covered). */
export function nfiCovered(id) {
  const out = new Set();
  for (const e of ENTRIES[id] || []) if (e.status !== "not-in-rulepack" && e.status !== "combination") for (const g of e.generics) out.add(g);
  return out;
}

/** renalAdjustments section: generic -> { source, method, gfrBands }. */
export function nfiRenalAdjustments() {
  const out = {};
  for (const e of NFI_RENAL) if (e.rule) for (const g of e.generics) if (!out[g]) out[g] = e.rule;
  return out;
}

/* Several monographs may name the same generic (a drug in two chapters). The side keeps the most severe level and every
 * monograph's own words, so nothing a source said is dropped. */
function mergeSide(list) {
  if (!list.length) return undefined;
  const level = list.map((r) => r.level).sort((a, b) => SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b))[0];
  return { level, text: [...new Set(list.map((r) => r.text))].join(" ") };
}

/** pregnancyLactation section for the signed sides only: generic -> { pregnancy?, lactation? }. */
export function nfiPregnancyLactation(signed) {
  const sides = {};
  const add = (side, entries) => {
    for (const e of entries) if (e.rule) for (const g of e.generics) {
      sides[g] = sides[g] || { pregnancy: [], lactation: [] };
      sides[g][side].push(e.rule);
    }
  };
  if (signed && signed.pregnancy) add("pregnancy", NFI_PREGNANCY);
  if (signed && signed.lactation) add("lactation", NFI_LACTATION);
  const out = {};
  for (const [g, s] of Object.entries(sides)) {
    const rule = {};
    const p = mergeSide(s.pregnancy), l = mergeSide(s.lactation);
    if (p) rule.pregnancy = p;
    if (l) rule.lactation = l;
    out[g] = rule;
  }
  return out;
}

/**
 * The compiled pack with the SIGNED NFI tables added, and what the order check must say about the others.
 *
 * @param {object} pack a compiled pack (rulepack.js getRulePack())
 * @param {{renal: string, pregnancy: string, lactation: string}} state each "signed", "awaiting-signoff" or
 *   "signoffs-unreadable" (seed-signoff.js nfiSignoffState)
 * @returns {object} a frozen pack: the same pack, plus `clinicalTables` describing each table, and its renal and
 *   pregnancy/lactation sections extended only by the tables whose state is "signed"
 */
export function withNfiTables(pack, state) {
  const signed = { renal: state.renal === "signed", pregnancy: state.pregnancy === "signed", lactation: state.lactation === "signed" };
  const sections = compileRulePack({
    renalAdjustments: signed.renal ? nfiRenalAdjustments() : {},
    pregnancyLactation: nfiPregnancyLactation(signed),
  });
  const clinicalTables = Object.freeze({
    source: NFI_SHORT,
    ...Object.fromEntries(NFI_TABLE_IDS.map((id) => [id, Object.freeze({ table: "nfi-" + id, state: state[id], covered: nfiCovered(id) })])),
  });
  const tag = NFI_TABLE_IDS.filter((id) => signed[id]).map((id) => "+nfi-" + id).join("");
  return Object.freeze({
    ...pack,
    version: pack.version + tag,
    renalAdjustments: new Map([...pack.renalAdjustments, ...sections.renalAdjustments]),
    pregnancyLactation: new Map([...pack.pregnancyLactation, ...sections.pregnancyLactation]),
    clinicalTables,
  });
}
