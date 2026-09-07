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

  // Same curated brand map the Worker uses (functions/_wardsynq/rulepack.js), so the test suite and
  // the EMR compile the identical pack rather than each having a subtly different one. Dynamic, for
  // the same reason node:fs is: this module is also parsed in a browser.
  let brands = opts.brands;
  if (!brands) {
    try { brands = (await import("../../brand-generics.js")).default.BRANDS; } catch { brands = null; }
  }

  return buildRulePack(raw, allergySeed, { ...opts, brands });
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

  const firstWord = buildFirstWordAliases(raw);
  // raw.brands travels with the interaction data and is always used. The curated antibiotic map
  // (brand-generics.js) is passed in by the caller so this file stays isomorphic; the browser build
  // falls back to the global that file's IIFE already publishes.
  const brandMap = opts.brands || (typeof globalThis !== "undefined" && globalThis.SMD_BRANDS && globalThis.SMD_BRANDS.BRANDS) || null;
  const brandAliases = buildBrandAliases(raw, brandMap, firstWord);

  return compileRulePack({
    version: `stewardmd-${raw.version || "unknown"}${includeSeeds ? "+seed" : ""}${Object.keys(brandAliases).length ? "+brands" : ""}`,
    generatedAt: raw.generated || null,
    generics: raw.generics || [],
    // First-word aliases first, so a curated brand key can never quietly displace the RxNorm
    // reconciliation the engine already depends on.
    aliases: { ...brandAliases, ...firstWord },
    combinations: buildCombinations(raw, brandMap, firstWord),
    drugClasses: raw.drugClasses || {},
    interactions: (raw.rules || []).map(mapInteractionRule),
    allergyClasses: withSpellingVariants(allergySeed.allergyClasses || {}, raw),
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

/**
 * Brand name -> pack generic, from the app's OWN curated map (brand-generics.js).
 *
 * WHY. The interaction pack is RxNorm-derived and contains molecules, not brands. Indian OPD
 * prescribing is overwhelmingly by brand: "Augmentin 625", "Monocef 1g", "Amoxiclav". None of those
 * resolved, so NO allergy and NO interaction check ran for them - a penicillin-allergic patient
 * could be prescribed Augmentin with the engine reporting nothing at all. This is not new clinical
 * content: brand-generics.js is the single curated map the app already trusts for rx-validity's
 * antibiotic / habit-forming / scheduled classification.
 *
 * THE SAME REFUSAL TO GUESS as buildFirstWordAliases above, applied to combinations. A brand is
 * aliased ONLY when exactly ONE of its molecules is known to this pack:
 *
 *   - one known    "augmentin" -> [amoxicillin, clavulanate], and only amoxicillin is in the pack.
 *                  Aliasing to it loses nothing: clavulanate has no rules to check against here.
 *                  This is the common case - 170 of 206 brands, including every amoxicillin brand.
 *   - two+ known   "bactrim" -> [trimethoprim, sulfamethoxazole], BOTH in the pack. Aliasing to
 *                  either one would silently drop a real, checkable component, so no alias is made
 *                  and the drug stays unresolved - which the engine now REPORTS as unchecked rather
 *                  than passing off as clean. 24 of 206 brands. Checking every component of a
 *                  combination needs the engine to resolve a drug to a LIST, which it does not yet
 *                  do; that is the honest gap this leaves, visible instead of silent.
 *   - none known   nothing to check either way.
 *
 * @returns {Record<string,string>} brand -> canonical pack generic
 */
function buildBrandAliases(raw, brandMap, firstWordAliases) {
  const generics = new Set((raw.generics || []).map((g) => String(g).toLowerCase()));
  for (const g of Object.keys(raw.drugClasses || {})) generics.add(g.toLowerCase());

  /* A CLASS IS NOT A BRAND. Both maps were built for SEARCH, where typing "nsaid" and being shown
   * diclofenac is a feature. As a safety alias it is a fabrication: "the patient is on an NSAID" is
   * not "the patient is on diclofenac", and resolving it that way would check the wrong drug's
   * interactions and miss the right one's. The pack already knows which tokens name classes, so the
   * refusal is mechanical rather than a judgement call - it removes exactly arb, doac, insulin,
   * lmwh, nsaid, ppi and statin, and keeps all 285 real brands.
   *
   * Sub-4-character keys go too ("asa", "bb", "h2", "ntg"): resolveGeneric only considers tokens of
   * 4+ characters anyway, so they could only ever match a drug field that is EXACTLY the
   * abbreviation, and buildFirstWordAliases above already uses the same threshold. */
  const classTokens = new Set();
  for (const g of Object.keys(raw.drugClasses || {})) {
    for (const c of raw.drugClasses[g] || []) classTokens.add(String(c).toLowerCase());
  }
  const rejected = (key) => key.length < 4 || classTokens.has(key) || generics.has(key);

  const resolve = (m) => {
    const k = String(m || "").toLowerCase().trim();
    if (!k) return null;
    if (generics.has(k)) return k;
    return (firstWordAliases && firstWordAliases[k]) || null;
  };

  const out = {};

  /* Source 1: `raw.brands` - 292 pairs that have been sitting inside data/interaction-rules.json all
   * along. This adapter already received them (they are on the same object as `generics` and
   * `drugClasses`) and simply never read them. Flat alias -> one generic, so no combination question
   * arises. Covers the everyday non-antibiotic brands: Crocin, Dolo, Calpol, Brufen, Combiflam,
   * Voveran, Atorva, Amlokind. */
  for (const brand of Object.keys(raw.brands || {})) {
    const key = String(brand).toLowerCase().trim();
    if (!key || rejected(key)) continue;
    const target = resolve(raw.brands[brand]);
    if (target) out[key] = target;
  }

  /* Source 2: brand-generics.js - the curated antibiotic map, whose values are ARRAYS because a
   * combination is an antibiotic if any component is. Same refusal to guess as above. */
  for (const brand of Object.keys(brandMap || {})) {
    const key = String(brand).toLowerCase().trim();
    if (!key || rejected(key)) continue;
    const molecules = brandMap[brand];
    if (!Array.isArray(molecules)) continue;
    const known = [...new Set(molecules.map(resolve).filter(Boolean))];
    if (known.length !== 1) continue;                 // 0: nothing checkable. 2+: refuse to drop one.
    out[key] = known[0];
  }
  return out;
}

/**
 * Combination brands -> every molecule in them that this pack can actually check.
 *
 * The counterpart to buildBrandAliases' second refusal. An alias is 1:1, so it cannot say Bactrim is
 * BOTH trimethoprim and sulfamethoxazole, and collapsing it to either silently drops the other -
 * for a sulfa-allergic patient, the half that mattered. These go into the pack's `combinations` map
 * instead, which resolveComponents() reads, so every component is checked.
 *
 * @returns {Record<string,string[]>} brand -> pack generics
 */
function buildCombinations(raw, brandMap, firstWordAliases) {
  const generics = new Set((raw.generics || []).map((g) => String(g).toLowerCase()));
  for (const g of Object.keys(raw.drugClasses || {})) generics.add(g.toLowerCase());
  const resolve = (m) => {
    const k = String(m || "").toLowerCase().trim();
    if (!k) return null;
    if (generics.has(k)) return k;
    return (firstWordAliases && firstWordAliases[k]) || null;
  };

  const out = {};
  for (const brand of Object.keys(brandMap || {})) {
    const key = String(brand).toLowerCase().trim();
    if (!key || key.length < 4 || generics.has(key)) continue;
    const molecules = brandMap[brand];
    if (!Array.isArray(molecules) || molecules.length < 2) continue;
    const known = [...new Set(molecules.map(resolve).filter(Boolean))];
    if (known.length > 1) out[key] = known;   // one known component is already a plain alias
  }
  return out;
}

/**
 * Adds spelling variants that are ALREADY generics in this pack to the allergy class they belong to.
 *
 * Found 2026-09-07 against the real data: the pack carries both "amoxicillin anhydrous" and the
 * British "amoxycillin" as separate generics, but the allergy seed lists only the former. So an
 * order the drug database reports as "Amoxycillin (500mg)" resolved perfectly and then belonged to
 * NO allergy class, and the penicillin shield stayed silent. This is not a clinical judgement -
 * amoxycillin IS amoxicillin - so it is derived mechanically from the pack rather than authored, and
 * only for variants the pack already contains. Two entries today, both amoxycillin.
 */
function withSpellingVariants(allergyClasses, raw) {
  const generics = new Set((raw.generics || []).map((g) => String(g).toLowerCase()));
  for (const g of Object.keys(raw.drugClasses || {})) generics.add(g.toLowerCase());
  // The BAN/USAN differences that actually occur in drug names, applied both ways.
  const variantsOf = (m) => {
    const v = new Set([
      m.replace(/oxy/g, "oxi"), m.replace(/oxi/g, "oxy"),
      m.replace(/^sulph/, "sulf"), m.replace(/^sulf/, "sulph"),
      m.replace(/^ceph/, "cef"), m.replace(/^cef/, "ceph"),
    ]);
    v.delete(m);
    return [...v];
  };

  const out = {};
  for (const [cls, members] of Object.entries(allergyClasses)) {
    const list = (members || []).map((x) => String(x).toLowerCase());
    const seen = new Set(list);
    for (const m of list) {
      for (const v of variantsOf(m)) {
        if (generics.has(v) && !seen.has(v)) { seen.add(v); list.push(v); }
      }
    }
    /* And the SAME molecule carrying a pharmaceutical qualifier. The pack lists the plain molecule
     * and its salt/ester/hydrate form as separate generics - "cefpodoxime" AND "cefpodoxime
     * proxetil", "cefixime" AND "cefixime anhydrous", "flucloxacillin" AND "flucloxacillin sodium" -
     * and the seed can only reasonably name one of each. Measured 2026-09-07: the drug database
     * reports Cepodem as "Cefpodoxime Proxetil", which resolved cleanly and then belonged to NO
     * allergy class, so a penicillin-allergic patient got no cross-reactivity warning for it.
     *
     * A generic that is a class member followed by further words is that member in a different
     * physical form, not a different drug, so it inherits the membership. Mechanical, and bounded:
     * it can only ever add a generic the pack already has, and only one that STARTS with a name
     * pharmacy already put in this class. */
    for (const m of [...seen]) {
      for (const g of generics) {
        if (!seen.has(g) && g.startsWith(m + " ")) { seen.add(g); list.push(g); }
      }
    }
    out[cls] = list;
  }
  return out;
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

export { loadStewardMDRulePack, buildRulePack, mapInteractionRule, buildFirstWordAliases, buildBrandAliases, DOSE_LIMITS_SEED, SEVERITY_MAP };
