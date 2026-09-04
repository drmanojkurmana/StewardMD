/* wardsynq/adapters/wardsynq-rules-stewardmd.js — rule pack adapter: StewardMD -> WardSynQ.
 *
 * ADAPTER, not core. It exists so wardsynq-safety.js can stay ignorant of where clinical content
 * came from. Everything StewardMD-shaped lives on this side of the line; nothing StewardMD-shaped
 * crosses it. A different hospital swaps this file and keeps the engine.
 *
 * What it maps:
 *   data/interaction-rules.json   310 curated interaction rules and 2620 generic-to-class mappings,
 *                                 derived from ONC HPDDI, openFDA SPL, CredibleMeds and RxNorm.
 *                                 This is StewardMD's existing, tested DDI content; WardSynQ reuses
 *                                 it rather than growing a second, divergent copy.
 *   wardsynq/data/allergy-classes.seed.json
 *                                 allergy class membership and cross-reactivity, which StewardMD
 *                                 did not have in any form. Marked UNAPPROVED; see that file.
 *
 * LICENSING: the interaction data documents CredibleMeds among its sources. Check that licence
 * before shipping this pack in a commercial deployment.
 *
 * The subject shape happens to be identical on both sides ({kind:'class'|'generic', value}), so the
 * interaction mapping is close to a rename. That is luck, not a contract: if either side changes,
 * fix it here, not in the engine.
 */

import { compileRulePack } from "../wardsynq-safety.js";

/* No top-level node:fs import. The EMR loads this same module in a browser, where the pack arrives
 * over fetch rather than off disk, and a top-level node: import would fail at parse time there.
 * `buildRulePack` below is the isomorphic half; `loadStewardMDRulePack` is the Node-only wrapper
 * and pulls fs in dynamically when it is actually called. */

/** StewardMD severities map 1:1 onto WardSynQ's, but state it explicitly so a drift is visible. */
const SEVERITY_MAP = Object.freeze({
  contraindicated: "contraindicated",
  major: "major",
  moderate: "moderate",
  monitor: "monitor",
  minor: "monitor",
});

/**
 * Dose ceilings. StewardMD has no structured max-dose table (surveyed 2026-09-04): the numbers it
 * has live in free-text monograph strings such as "Max 4 g/day (3 g if hepatic risk)", which are
 * not machine-checkable and must not be parsed into a safety control by regex.
 *
 * So this is a hand-authored SEED of the few drugs where an absolute ceiling is both well
 * established and where exceeding it is plausibly lethal. It is deliberately tiny. An empty entry
 * means "no ceiling known", which the engine treats as no finding, so a short honest table is safe
 * where a long guessed one would not be.
 *
 * UNAPPROVED. Requires Head of Clinical Pharmacy sign-off before it can gate a real order.
 */
const DOSE_LIMITS_SEED = Object.freeze({
  paracetamol: {
    maxSingle: { value: 1000, unit: "mg" },
    absoluteCeilingSingle: { value: 1000, unit: "mg" },
    mgPerKgSingle: 15,
    note: "15 mg/kg per dose, adult single dose capped at 1 g. Daily ceilings and hepatic reduction are not modelled here.",
  },
  acetaminophen: {
    maxSingle: { value: 1000, unit: "mg" },
    absoluteCeilingSingle: { value: 1000, unit: "mg" },
    mgPerKgSingle: 15,
  },
  ibuprofen: {
    maxSingle: { value: 800, unit: "mg" },
    absoluteCeilingSingle: { value: 800, unit: "mg" },
    mgPerKgSingle: 10,
  },
  gentamicin: { mgPerKgSingle: 7, note: "Once-daily dosing. Not valid for synergy or endocarditis regimens." },
  digoxin: { maxSingle: { value: 500, unit: "mcg" }, absoluteCeilingSingle: { value: 1500, unit: "mcg" } },
  colchicine: { maxSingle: { value: 1200, unit: "mcg" }, absoluteCeilingSingle: { value: 1800, unit: "mcg" } },
  methotrexate: {
    maxSingle: { value: 25, unit: "mg" },
    absoluteCeilingSingle: { value: 30, unit: "mg" },
    note: "ORAL WEEKLY dosing only. Daily administration of a weekly dose is a recognised fatal error; this ceiling does not detect frequency errors, which need the order's frequency, not its dose.",
  },
});

/**
 * Builds a compiled WardSynQ rule pack from StewardMD's data files.
 *
 * @param {{interactionRulesPath?: string, allergySeedPath?: string, doseLimits?: object,
 *   renalAdjustments?: object, includeUnapprovedSeeds?: boolean}} [opts]
 *   includeUnapprovedSeeds defaults to TRUE in this build because the alternative is an inert
 *   allergy shield, which is worse. Once pharmacy signs off real content, pass false and supply
 *   approved tables, or replace this adapter.
 * @returns {Promise<object>} a compiled pack, ready for `new SafetyEngine({rulePack})`
 */
async function loadStewardMDRulePack(opts) {
  opts = opts || {};
  const includeSeeds = opts.includeUnapprovedSeeds !== false;

  const interactionRulesPath = opts.interactionRulesPath
    || new URL("../../data/interaction-rules.json", import.meta.url);
  const allergySeedPath = opts.allergySeedPath
    || new URL("../data/allergy-classes.seed.json", import.meta.url);

  const { readFile } = await import("node:fs/promises");
  const raw = JSON.parse(await readFile(interactionRulesPath, "utf8"));
  const allergySeed = includeSeeds ? JSON.parse(await readFile(allergySeedPath, "utf8")) : { allergyClasses: {}, crossReactivity: [] };

  return buildRulePack(raw, allergySeed, opts);
}

/**
 * The isomorphic half: raw JSON in, compiled pack out. Works in Node and in the browser, so the
 * EMR and the test suite compile the identical pack from the identical data rather than each
 * having its own subtly different loader.
 *
 * @param {object} raw parsed data/interaction-rules.json
 * @param {object} allergySeed parsed allergy-classes.seed.json, or empty sections to omit it
 */
function buildRulePack(raw, allergySeed, opts) {
  opts = opts || {};
  allergySeed = allergySeed || { allergyClasses: {}, crossReactivity: [] };
  const includeSeeds = opts.includeUnapprovedSeeds !== false;

  return compileRulePack({
    version: `stewardmd-${raw.version || "unknown"}${includeSeeds ? "+seed" : ""}`,
    generatedAt: raw.generated || null,
    generics: raw.generics || [],
    aliases: buildFirstWordAliases(raw),
    drugClasses: raw.drugClasses || {},
    interactions: (raw.rules || []).map(mapInteractionRule),
    allergyClasses: allergySeed.allergyClasses || {},
    crossReactivity: allergySeed.crossReactivity || [],
    doseLimits: opts.doseLimits || (includeSeeds ? DOSE_LIMITS_SEED : {}),
    renalAdjustments: opts.renalAdjustments || {},
  });
}

/**
 * Reconciles the two drug vocabularies in play.
 *
 * StewardMD's interaction data is RxNorm-derived and carries pharmaceutical qualifiers that no
 * clinician types and no allergy list contains: amoxicillin appears only as "amoxicillin
 * anhydrous". Discovered 2026-09-04 by an integration test that expected an amoxicillin order to
 * trip a penicillin allergy and found the shield failing open, which is exactly how a control of
 * this kind dies quietly.
 *
 * The mapping is mechanical and deliberately refuses to guess: the first word of a multi-word
 * generic becomes an alias for it ONLY when exactly one generic in the whole pack starts with that
 * word, and only when the word is not already a generic in its own right. Where a first word is
 * ambiguous ("penicillin" leads to both "penicillin g" and "penicillin v") no alias is created, so
 * the drug stays unresolved and is reported rather than being silently bound to whichever variant
 * happened to sort first.
 *
 * @returns {Record<string,string>} alias -> canonical pack generic
 */
function buildFirstWordAliases(raw) {
  const generics = new Set((raw.generics || []).map((g) => String(g).toLowerCase()));
  for (const g of Object.keys(raw.drugClasses || {})) generics.add(g.toLowerCase());

  const byFirstWord = new Map();
  for (const g of generics) {
    if (!g.includes(" ")) continue;
    const first = g.split(" ")[0];
    if (first.length < 4) continue;
    if (!byFirstWord.has(first)) byFirstWord.set(first, []);
    byFirstWord.get(first).push(g);
  }

  const aliases = {};
  for (const [first, targets] of byFirstWord) {
    if (targets.length !== 1) continue; // ambiguous: refuse to pick
    if (generics.has(first)) continue; // the bare word is already a drug in its own right
    aliases[first] = targets[0];
  }
  return aliases;
}

/** Maps one StewardMD rule record into the engine's interaction shape. */
function mapInteractionRule(rule) {
  return {
    id: rule.id,
    type: rule.type,
    severity: SEVERITY_MAP[rule.severity] || "monitor",
    subjects: rule.subjects || [],
    mechanism: rule.mechanism,
    effect: rule.effect,
    action: rule.action,
    monitoring: rule.monitoring,
  };
}

export { loadStewardMDRulePack, buildRulePack, mapInteractionRule, buildFirstWordAliases, DOSE_LIMITS_SEED, SEVERITY_MAP };
