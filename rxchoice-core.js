/* rxchoice-core.js — RxChoice™ deterministic core: normalize -> match -> price -> rank.
 *
 * PURE. No DOM, no network, no AI. The UI (rxchoice-ui.js) fetches products from the ONE product
 * truth - the StewardMD Drug Database (window.MEDAPI, routed to the offline SQLite copy by
 * offline-db.js, identical record shape either way) - and hands them here. This file decides which
 * of those records are VALID matches for the doctor's prescription and how they rank. It never
 * invents a brand, a manufacturer, a pack or a price: every field it returns came out of a database
 * record it was given.
 *
 * Database record shape (worker/src/index.js + offline-db.js mapBrand, the same keys in both):
 *   { id, brand, composition, class, manufacturer, mrp, form, pack, discontinued }
 *
 * ── THE CONSTRAINT THAT SHAPES EVERYTHING HERE ──────────────────────────────────────────────────
 * `composition` carries per-ingredient strengths only SOMETIMES. The live database holds both
 * "Amoxycillin (500mg) + Clavulanic Acid (125mg)" (845 brands) AND a bare "Amoxycillin + Clavulanic
 * Acid" (5795 brands) where the strength lives in the brand NAME instead ("Augmentin 625 Tablet",
 * "Augmentin 1000 Duo Tablet"). So strength can never be assumed. Eligibility is gated on strength
 * CERTAINTY, expressed as a provenance-tagged strengthKey:
 *   comp:amoxycillin=500mg|clavulanic acid=125mg     (parsed from the composition's parentheses)
 *   brand:625mg                                      (parsed from the brand name, when the
 *                                                      composition carries no strengths at all)
 * Two products match only when their keys are IDENTICAL, and a comp: key NEVER matches a brand: key.
 * A product whose strength cannot be established either way is not eligible - it is not shown.
 * That is the spec's "when uncertain, no substitution", enforced in code rather than in a comment.
 *
 * Dual export: window.SMD_RXCHOICE for the app (plain .js, so scripts/build-www.sh picks it up with
 * the other root JS), module.exports for node tests.
 */
(function (root) {
  "use strict";

  /* ======================================================================
   * 1. NORMALIZE
   * ==================================================================== */

  function norm(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9.+()/ -]+/g, " ").replace(/\s+/g, " ").trim();
  }

  // Strength units, normalized to a common base so 1g and 1000mg compare equal. iu/unit are NOT
  // convertible to mass (they are potency, drug-specific), so they keep their own base.
  var UNIT = {
    mcg: { base: "mg", mul: 0.001 }, ug: { base: "mg", mul: 0.001 }, g: { base: "mg", mul: 1000 },
    gm: { base: "mg", mul: 1000 }, mg: { base: "mg", mul: 1 },
    ml: { base: "ml", mul: 1 }, l: { base: "ml", mul: 1000 },
    iu: { base: "iu", mul: 1 }, unit: { base: "iu", mul: 1 }, units: { base: "iu", mul: 1 },
    "%": { base: "%", mul: 1 }
  };
  function canonStrength(value, unit) {
    var u = UNIT[String(unit || "").toLowerCase()];
    if (!u || !isFinite(value)) return null;
    var v = value * u.mul;
    // Trim float noise from the unit conversion (0.001 * 250 = 0.25000000000000006).
    return { value: Math.round(v * 1e6) / 1e6, unit: u.base };
  }
  function strengthText(s) { return s ? (s.value + s.unit) : ""; }

  var STRENGTH_RE = /(\d+(?:\.\d+)?)\s*(mcg|ug|mg|gm|g|ml|l|iu|units?|%)\b/gi;

  /* "Amoxycillin (500mg) + Clavulanic Acid (125mg)" ->
   *   { ingredients: [{name:"amoxycillin", strength:{500,mg}}, {name:"clavulanic acid", strength:{125,mg}}],
   *     strengthsKnown: true }
   * A bare "Amoxycillin + Clavulanic Acid" yields the same ingredients with strength:null and
   * strengthsKnown:false. Ingredient names are the FULL set, always - a combination never matches a
   * single-ingredient product because the name sets differ. */
  function parseComposition(str) {
    var parts = String(str == null ? "" : str).split(/\s*\+\s*/).map(function (p) { return p.trim(); }).filter(Boolean);
    var ingredients = parts.map(function (p) {
      var m = p.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
      var name = norm(m ? m[1] : p).replace(/\(|\)/g, "").trim();
      var strength = null;
      if (m) {
        STRENGTH_RE.lastIndex = 0;
        var sm = STRENGTH_RE.exec(m[2]);
        if (sm) strength = canonStrength(parseFloat(sm[1]), sm[2]);
      }
      return { name: name, strength: strength };
    }).filter(function (i) { return !!i.name; });
    return {
      ingredients: ingredients,
      // Known only when EVERY ingredient carries a strength. A half-specified composition is
      // uncertain, so it is treated as unknown rather than partly trusted.
      strengthsKnown: ingredients.length > 0 && ingredients.every(function (i) { return !!i.strength; })
    };
  }

  /* The set of active ingredient names, order-independent. This is what makes a combination match
   * only products carrying the WHOLE combination. */
  function compositionKey(str) {
    var ing = parseComposition(str).ingredients.map(function (i) { return i.name; });
    return ing.slice().sort().join("+");
  }

  /* Dosage form families. The database `form` column is already lowercase and fairly clean
   * ("tablet", "injection", "syrup"), but a tablet must never match a suspension, so unknown forms
   * map to themselves rather than to a catch-all. */
  var FORM_ALIAS = {
    tablet: "tablet", tablets: "tablet", tab: "tablet", "tablet dt": "tablet", "tablet mr": "tablet",
    capsule: "capsule", capsules: "capsule", cap: "capsule",
    syrup: "liquid", suspension: "liquid", solution: "liquid", liquid: "liquid", oral_solution: "liquid",
    drop: "drops", drops: "drops", "eye drop": "drops", "eye drops": "drops", "ear drops": "drops",
    injection: "injection", infusion: "injection", vial: "injection", ampoule: "injection",
    cream: "topical", ointment: "topical", gel: "topical", lotion: "topical",
    inhaler: "inhaler", rotacap: "inhaler", respules: "inhaler", nebuliser: "inhaler",
    patch: "transdermal", sachet: "sachet", powder: "powder", granules: "powder", suppository: "suppository"
  };
  function normalizeForm(form) {
    var f = norm(form);
    if (!f) return "";
    if (FORM_ALIAS[f]) return FORM_ALIAS[f];
    // "tablet mr", "tablet dt", "powder for injection" - first token decides the family, but only
    // when that token is a form we know. Otherwise keep the whole string (match stays strict).
    var head = f.split(" ")[0];
    return FORM_ALIAS[head] || f;
  }

  /* Modified-release and other release characteristics, read off the brand name and form. Release
   * differences are clinically real (Metformin IR is not Metformin XR), so these are compared as a
   * SET and must be identical on both sides. */
  var RELEASE_RE = /\b(sr|xr|cr|er|mr|xl|la|od|odt|dt|depot|retard|prolonged|sustained|extended|controlled|modified)\b/gi;
  function releaseKey(text) {
    var out = {}, m;
    RELEASE_RE.lastIndex = 0;
    var s = " " + norm(text) + " ";
    while ((m = RELEASE_RE.exec(s))) {
      var t = m[1].toLowerCase();
      // Spelled-out forms collapse onto their abbreviation so "Extended Release" == "ER".
      if (t === "sustained" || t === "prolonged") t = "sr";
      else if (t === "extended") t = "xr";
      else if (t === "controlled") t = "cr";
      else if (t === "modified") t = "mr";
      // "OD" in a brand name is a dosing frequency (once daily), not a release characteristic, and
      // "DT"/"ODT" is dispersibility - but all three still distinguish products, so they are kept.
      out[t] = 1;
    }
    return Object.keys(out).sort().join(",");
  }

  /* Strength tokens in a brand name: "Augmentin 625 Tablet" -> [625mg]. A bare number with no unit
   * is read as mg ONLY when the product is an oral solid, which is the Indian brand-naming
   * convention the database follows; anywhere else a unitless number is ignored as unsafe to guess.
   * Pack descriptors ("strip of 10") never reach here - this reads the brand name only. */
  function brandStrengths(brandName, formFamily) {
    var s = String(brandName == null ? "" : brandName);
    var out = [], m;
    STRENGTH_RE.lastIndex = 0;
    while ((m = STRENGTH_RE.exec(s))) { var c = canonStrength(parseFloat(m[1]), m[2]); if (c) out.push(c); }
    if (!out.length && (formFamily === "tablet" || formFamily === "capsule")) {
      // Strip the unit-bearing matches first so "Augmentin 625 Tablet" is read but "Zifi 200 DT"
      // and "Augmentin 1.2gm Injection" are not double-counted.
      var bare = s.replace(STRENGTH_RE, " ").match(/(?:^|[^a-z0-9.])(\d{1,5}(?:\.\d+)?)(?![a-z0-9.])/gi);
      if (bare) bare.forEach(function (b) {
        var n = parseFloat(String(b).replace(/[^0-9.]/g, ""));
        var c = canonStrength(n, "mg"); if (c) out.push(c);
      });
    }
    return out.sort(function (a, b) { return a.value - b.value || a.unit.localeCompare(b.unit); });
  }

  /* The provenance-tagged strength key. "" means the strength could not be established, which makes
   * the product ineligible as either side of a substitution. */
  function strengthKey(rec) {
    var parsed = parseComposition(rec && rec.composition);
    if (parsed.strengthsKnown) {
      return "comp:" + parsed.ingredients.map(function (i) { return i.name + "=" + strengthText(i.strength); })
        .sort().join("|");
    }
    var bs = brandStrengths(rec && rec.brand, normalizeForm(rec && rec.form));
    if (!bs.length) return "";
    return "brand:" + bs.map(strengthText).join("|");
  }

  /* ======================================================================
   * 2. SAFETY: products that must not be swapped on price
   * ==================================================================== */

  /* Narrow therapeutic index, biologics, insulins and delivery-system products. For these the
   * cheapest equivalent brand is NOT an equivalent: a different manufacturer's product can differ
   * in bioavailability (NTI), immunogenicity (biologics) or device technique (inhalers, patches,
   * pens). RxChoice refuses to substitute them and says so, rather than showing a cheaper card.
   * Matched against the composition's ingredient names. */
  var RESTRICTED = [
    { re: /\b(warfarin|acenocoumarol|nicoumalone)\b/, why: "Narrow therapeutic index (anticoagulant) - brand switches need INR re-checking, not a price comparison" },
    { re: /\b(digoxin|digitoxin)\b/, why: "Narrow therapeutic index - a brand switch needs level monitoring" },
    { re: /\b(lithium)\b/, why: "Narrow therapeutic index - a brand switch needs level monitoring" },
    { re: /\b(phenytoin|fosphenytoin|carbamazepine|valproate|valproic|divalproex|lamotrigine)\b/, why: "Antiepileptic - brand continuity is the standing recommendation; a switch is a clinical decision" },
    { re: /\b(ciclosporin|cyclosporine|tacrolimus|sirolimus|everolimus|mycophenolate)\b/, why: "Immunosuppressant with narrow therapeutic index - a brand switch needs level monitoring" },
    { re: /\b(levothyroxine|liothyronine)\b/, why: "Narrow therapeutic index - a brand switch needs TSH re-checking" },
    { re: /\b(theophylline|aminophylline)\b/, why: "Narrow therapeutic index - a brand switch needs level monitoring" },
    { re: /\b(insulin|glargine|lispro|aspart|degludec|detemir|glulisine)\b/, why: "Insulin - device, concentration and pen compatibility are part of the prescription" },
    { re: /\b(clozapine)\b/, why: "Narrow therapeutic index with mandatory monitoring" },
    { re: /(mab|cept|kinra)\b|\b(epoetin|filgrastim|pegfilgrastim|somatropin|teriparatide|enoxaparin|heparin|dalteparin|insulins?)\b/, why: "Biologic / biosimilar - these are not interchangeable generics" }
  ];
  // Forms whose therapy depends on the device or the delivery system, not only the molecule.
  var RESTRICTED_FORMS = {
    inhaler: "Inhaled device - technique and device type are part of the prescription",
    transdermal: "Transdermal system - release kinetics are product-specific"
  };
  function restricted(rec) {
    var ing = parseComposition(rec && rec.composition).ingredients.map(function (i) { return i.name; }).join(" ");
    for (var i = 0; i < RESTRICTED.length; i++) if (RESTRICTED[i].re.test(ing)) return RESTRICTED[i].why;
    var ff = normalizeForm(rec && rec.form);
    if (RESTRICTED_FORMS[ff]) return RESTRICTED_FORMS[ff];
    return null;
  }

  /* ======================================================================
   * 3. MATCH — eligibility
   * ==================================================================== */

  /* A candidate is eligible ONLY when every one of these holds against the prescribed product:
   *   same active-ingredient set (whole combination, order-independent)
   *   same strength, established with the same provenance and non-empty
   *   same dosage-form family
   *   same release characteristics
   *   on the market (not discontinued)
   * Anything else returns a reason, which the UI can show instead of a product. */
  function eligibility(rx, cand) {
    if (!rx || !cand) return { ok: false, reason: "missing_record" };
    if (cand.discontinued) return { ok: false, reason: "discontinued" };
    if (compositionKey(rx.composition) !== compositionKey(cand.composition)) return { ok: false, reason: "composition_mismatch" };
    // Form and release are checked BEFORE strength: both are cheaper to establish and give the more
    // useful reason (a tablet-vs-suspension mismatch should not be reported as an unknown strength).
    var rf = normalizeForm(rx.form), cf = normalizeForm(cand.form);
    if (!rf || !cf) return { ok: false, reason: "form_unknown" };
    if (rf !== cf) return { ok: false, reason: "form_mismatch" };
    if (releaseKey((rx.brand || "") + " " + (rx.form || "")) !== releaseKey((cand.brand || "") + " " + (cand.form || ""))) {
      return { ok: false, reason: "release_mismatch" };
    }
    var rk = strengthKey(rx), ck = strengthKey(cand);
    if (!rk || !ck) return { ok: false, reason: "strength_unknown" };
    if (rk !== ck) return { ok: false, reason: "strength_mismatch" };
    return { ok: true, reason: "exact" };
  }
  function eligible(rx, cand) { return eligibility(rx, cand).ok; }

  /* ======================================================================
   * 4. PRICE — course cost, not pack MRP
   * ==================================================================== */

  /* "strip of 10 tablets" -> {units:10, unit:"tablet"}; "bottle of 100 ml Oral Suspension" ->
   * {units:100, unit:"ml"}; "vial of 1 Powder for Injection" -> {units:1, unit:"vial"}.
   * null when the pack cannot be read - the caller then reports "Price unavailable" rather than
   * guessing a pack size. */
  function parsePack(packStr) {
    var p = norm(packStr);
    if (!p) return null;
    var m = p.match(/(\d+(?:\.\d+)?)\s*(ml|l|gm|g|mg)\b/);
    if (m) { var c = canonStrength(parseFloat(m[1]), m[2]); return c ? { units: c.value, unit: c.unit } : null; }
    m = p.match(/(\d+)\s*(tablets?|capsules?|caps?|tabs?|vials?|ampoules?|sachets?|suppositor\w*|pieces?|units?)\b/);
    if (m) {
      var u = m[2].replace(/s$/, "");
      if (u === "tab") u = "tablet"; else if (u === "cap") u = "capsule";
      return { units: parseInt(m[1], 10), unit: u };
    }
    // "vial of 1 Powder for Injection" — the count precedes an unrecognised noun.
    m = p.match(/\b(?:strip|bottle|vial|box|packet|tube|jar|pack|ampoule|prefilled syringe)\s+of\s+(\d+)\b/);
    if (m) return { units: parseInt(m[1], 10), unit: "unit" };
    return null;
  }

  var DOSES_PER_DAY = {
    od: 1, hs: 1, "once daily": 1, "once a day": 1, daily: 1, stat: 1,
    bd: 2, bid: 2, "twice daily": 2, "twice a day": 2,
    tds: 3, tid: 3, "thrice daily": 3, "three times": 3,
    qid: 4, qds: 4, "four times": 4,
    q4h: 6, q6h: 4, q8h: 3, q12h: 2, q24h: 1
  };
  /* Units the course needs: unitsPerDose x dosesPerDay x days. Returns null when any of the three is
   * missing or unparseable (SOS/PRN has no countable course) - the UI then prices nothing rather
   * than inventing a quantity. */
  function requiredQuantity(line, formFamily) {
    var freqRaw = norm(line && line.freq);
    if (/\b(sos|prn|as needed)\b/.test(freqRaw)) return null;
    var per = null;
    Object.keys(DOSES_PER_DAY).forEach(function (k) {
      if (per != null) return;
      if (new RegExp("(^|[^a-z0-9])" + k.replace(/ /g, "\\s+") + "([^a-z0-9]|$)").test(freqRaw)) per = DOSES_PER_DAY[k];
    });
    if (per == null) return null;

    var dm = norm(line && line.duration).match(/(\d+(?:\.\d+)?)\s*(day|week|month)/);
    if (!dm) return null;
    var days = parseFloat(dm[1]) * (dm[2] === "week" ? 7 : dm[2] === "month" ? 30 : 1);
    if (!(days > 0)) return null;

    // Dose -> units per dose. A solid's dose is a count of tablets/capsules ("1 tab", "2"); a
    // liquid's is a volume ("5 ml"). A mass dose ("500 mg") describes the STRENGTH, not how many
    // units - for a matching-strength product that is 1 unit per dose.
    var dose = norm(line && line.dose), units = null, unit = null;
    var liq = dose.match(/(\d+(?:\.\d+)?)\s*(ml|l)\b/);
    if (liq) { var c = canonStrength(parseFloat(liq[1]), liq[2]); if (c) { units = c.value; unit = "ml"; } }
    if (units == null) {
      var solid = dose.match(/(\d+(?:\.\d+)?)\s*(tablets?|tabs?|capsules?|caps?|puffs?|drops?|sachets?)\b/);
      if (solid) { units = parseFloat(solid[1]); unit = formFamily === "capsule" ? "capsule" : "tablet"; }
    }
    if (units == null && /^\s*\d+(\.\d+)?\s*$/.test(dose)) { units = parseFloat(dose); unit = formFamily === "capsule" ? "capsule" : "tablet"; }
    if (units == null && /\b(mg|mcg|g|gm|iu|units?)\b/.test(dose) && (formFamily === "tablet" || formFamily === "capsule")) {
      units = 1; unit = formFamily;                       // strength-stated dose of a matching-strength product
    }
    if (units == null) return null;
    return { units: units * per * days, unit: unit, perDose: units, perDay: per, days: days };
  }

  /* Pack-aware course cost, under the dispensing model the pack itself implies.
   *
   * The spec's own worked example (a 20-tablet pack at Rs 150 costing Rs 75 for a 10-tablet course)
   * is UNIT dispensing: an Indian pharmacy cuts a strip and charges for the tablets it hands over,
   * which is why a bigger pack can be the cheaper course. An indivisible pack - a vial, a bottle of
   * suspension, a tube, an inhaler - cannot be split, so there the course costs WHOLE packs and the
   * leftover is real waste. Both numbers are returned either way (`courseCost` under the model that
   * applies, `wholePackCost` always) so the UI never has to assume which one it is looking at.
   */
  var DIVISIBLE = { tablet: 1, capsule: 1 };          // countable oral solids - dispensed loose
  function courseCost(cand, required) {
    if (!cand || !required || !(required.units > 0)) return null;
    var price = cand.mrp;
    if (price == null || price === "" || !isFinite(Number(price)) || Number(price) <= 0) return null;
    var pack = parsePack(cand.pack);
    if (!pack || !(pack.units > 0)) return null;
    price = Number(price);
    var packs = Math.ceil(required.units / pack.units);
    var unitPrice = price / pack.units;
    var divisible = !!DIVISIBLE[pack.unit];
    var cost = divisible ? (required.units * unitPrice) : (packs * price);
    var r2 = function (n) { return Math.round(n * 100) / 100; };
    return {
      unitsPerPack: pack.units, packUnit: pack.unit, packsRequired: packs, packPrice: price,
      unitPrice: Math.round(unitPrice * 10000) / 10000,
      dispensing: divisible ? "unit" : "pack",
      courseCost: r2(cost), wholePackCost: r2(packs * price),
      dispensed: divisible ? required.units : packs * pack.units, requiredUnits: required.units
    };
  }

  /* ======================================================================
   * 5. RANK — transparent, deterministic, configurable
   * ==================================================================== */

  /* Manufacturer tier lists. These MIRROR worker/src/index.js TIERS and offline-db.js TIERS exactly
   * (prefix-anchored, lowercased) so RxChoice's notion of "established manufacturer" is the same one
   * the Drugs Database already sorts by - not a second opinion invented here. Keep the three in step. */
  var TIERS = {
    branded: ["sun pharma", "abbott", "cipla", "dr reddy", "lupin", "torrent", "zydus", "alkem",
      "sanofi", "glaxo", "pfizer", "astrazeneca", "boehringer", "novo nordisk", "eli lilly"],
    generic: ["mankind", "aristo", "intas", "macleods", "micro labs", "emcure", "alembic", "usv",
      "eris", "glenmark", "blue cross", "franco", "wallace", "medley", "akumentis"]
  };
  function tierOf(manufacturer) {
    var m = norm(manufacturer);
    if (!m) return "other";
    for (var i = 0; i < TIERS.branded.length; i++) if (m.indexOf(TIERS.branded[i]) === 0) return "branded";
    for (var j = 0; j < TIERS.generic.length; j++) if (m.indexOf(TIERS.generic[j]) === 0) return "generic";
    return "other";
  }
  var TIER_SIGNAL = { branded: 1, generic: 0.6, other: 0.3 };

  /* Weights are configurable and the score is reported alongside its parts, so BALANCED can always
   * be explained. Note what is deliberately NOT in the score: clinical match (every candidate here
   * is already an exact ingredient/strength/form/release match, so it is constant and would only
   * dilute the weights) and availability (not-on-the-market is a hard filter, not a penalty). */
  var WEIGHTS = { price: 0.55, manufacturer: 0.30, packFit: 0.15 };

  function scoreOne(c, lo, hi, weights) {
    var W = weights || WEIGHTS;
    var priceEff = (hi > lo) ? (1 - (c.cost.courseCost - lo) / (hi - lo)) : 1;
    var packFit = c.cost.dispensed > 0 ? Math.max(0, Math.min(1, c.cost.requiredUnits / c.cost.dispensed)) : 0;
    var mfr = TIER_SIGNAL[c.tier];
    return {
      priceEfficiency: Math.round(priceEff * 1000) / 1000,
      packFit: Math.round(packFit * 1000) / 1000,
      manufacturerSignal: mfr,
      value: Math.round((W.price * priceEff + W.manufacturer * mfr + W.packFit * packFit) * 1000) / 1000
    };
  }

  function option(c, category, sub) {
    return {
      category: category, label: sub,
      id: c.rec.id, brand: c.rec.brand, manufacturer: c.rec.manufacturer || "",
      composition: c.rec.composition, form: c.rec.form || "", pack: c.rec.pack || "",
      mrp: c.cost ? c.cost.packPrice : (c.rec.mrp == null ? null : Number(c.rec.mrp)),
      courseCost: c.cost ? c.cost.courseCost : null,
      packsRequired: c.cost ? c.cost.packsRequired : null,
      unitsPerPack: c.cost ? c.cost.unitsPerPack : null,
      requiredUnits: c.cost ? c.cost.requiredUnits : null,
      tier: c.tier, score: c.score || null, record: c.rec
    };
  }

  /* rx:         the doctor's product as a database-shaped record { brand, composition, form, pack,
   *             mrp, manufacturer, id? } plus the Rx line's { dose, freq, duration }.
   * candidates: database records for the same composition, straight from MEDAPI.
   * returns:    { prescribed, generic, balanced, premium, eligibleCount, required, blocked, reason }
   *             with the four option slots null when nothing valid exists. DOCTOR PRESCRIBED is
   *             ALWAYS returned - it is the doctor's own product and is never filtered or replaced. */
  function choose(rx, candidates, opts) {
    opts = opts || {};
    var formFamily = normalizeForm(rx && rx.form);
    var required = requiredQuantity(rx || {}, formFamily);
    var rxTier = tierOf(rx && rx.manufacturer);
    var rxCost = required ? courseCost(rx, required) : null;
    var prescribed = option({ rec: rx || {}, cost: rxCost, tier: rxTier }, "prescribed", "Original Choice");

    var block = restricted(rx || {});
    if (block) return { prescribed: prescribed, generic: null, balanced: null, premium: null, eligibleCount: 0, required: required, blocked: true, reason: block };
    if (!required) return { prescribed: prescribed, generic: null, balanced: null, premium: null, eligibleCount: 0, required: null, blocked: false, reason: "no_course_quantity" };

    var pool = [];
    (candidates || []).forEach(function (rec) {
      if (!rec || !rec.brand) return;
      if (rx && rx.id != null && rec.id != null && String(rec.id) === String(rx.id)) return;  // the doctor's own product has its own card
      if (!eligible(rx, rec)) return;
      var cost = courseCost(rec, required);
      if (!cost) return;                      // no readable price or pack -> cannot be offered as a cost option
      pool.push({ rec: rec, cost: cost, tier: tierOf(rec.manufacturer) });
    });
    if (!pool.length) return { prescribed: prescribed, generic: null, balanced: null, premium: null, eligibleCount: 0, required: required, blocked: false, reason: "no_validated_alternatives" };

    var costs = pool.map(function (c) { return c.cost.courseCost; });
    var lo = Math.min.apply(null, costs), hi = Math.max.apply(null, costs);
    pool.forEach(function (c) { c.score = scoreOne(c, lo, hi, opts.weights); });

    // Deterministic tie-breaks everywhere: the same inputs always give the same three cards.
    var byCost = pool.slice().sort(function (a, b) {
      return a.cost.courseCost - b.cost.courseCost || String(a.rec.brand).localeCompare(String(b.rec.brand));
    });
    var byValue = pool.slice().sort(function (a, b) {
      return b.score.value - a.score.value || a.cost.courseCost - b.cost.courseCost || String(a.rec.brand).localeCompare(String(b.rec.brand));
    });
    // PREMIUM = top branded option: established manufacturer first, then the higher-priced of that
    // tier (the flagship brand), name last. Price is a tie-break INSIDE the tier, never a claim.
    var byPremium = pool.slice().sort(function (a, b) {
      return TIER_SIGNAL[b.tier] - TIER_SIGNAL[a.tier] || b.cost.courseCost - a.cost.courseCost || String(a.rec.brand).localeCompare(String(b.rec.brand));
    });

    var generic = option(byCost[0], "generic", "Lowest Cost");
    var balanced = option(byValue[0], "balanced", "Recommended Value");
    var premium = option(byPremium[0], "premium", "Top Branded Option");
    /* The best value is sometimes also the cheapest product, or the branded one. That is a real
     * result, not a bug to code around: forcing a different product into BALANCED would mean
     * recommending something the score ranked lower. So the coincidence is REPORTED and the UI says
     * so on the card, rather than being hidden or engineered away. */
    balanced.sameAs = (String(balanced.id) === String(generic.id)) ? "generic"
      : (String(balanced.id) === String(premium.id)) ? "premium" : null;
    return {
      prescribed: prescribed, generic: generic, balanced: balanced, premium: premium,
      eligibleCount: pool.length, required: required, blocked: false, reason: "ok",
      weights: opts.weights || WEIGHTS
    };
  }

  /* Prescription-level totals across several lines' choose() results. A total is null the moment one
   * line cannot be priced - a partial sum presented as a prescription total would be a wrong number,
   * which is worse than no number. Savings are always measured against the doctor's own total. */
  function totals(results) {
    var keys = ["generic", "balanced", "premium", "prescribed"], out = {};
    keys.forEach(function (k) {
      var sum = 0, complete = (results || []).length > 0;
      (results || []).forEach(function (r) {
        var o = r && r[k];
        // An un-substitutable line still costs the doctor's product in every column.
        if (!o || o.courseCost == null) { if (k !== "prescribed" && r && r.prescribed && r.prescribed.courseCost != null) { sum += r.prescribed.courseCost; return; } complete = false; return; }
        sum += o.courseCost;
      });
      out[k] = complete ? Math.round(sum * 100) / 100 : null;
    });
    out.savings = {};
    ["generic", "balanced", "premium"].forEach(function (k) {
      out.savings[k] = (out[k] != null && out.prescribed != null) ? Math.round((out.prescribed - out[k]) * 100) / 100 : null;
    });
    return out;
  }

  /* Audit record for one doctor decision. The original product is a field in its own right, so it is
   * never lost by recording a selection. */
  function auditEntry(o) {
    o = o || {};
    return {
      prescriptionId: o.prescriptionId || null,
      originalProduct: o.original ? { id: o.original.id, brand: o.original.brand, manufacturer: o.original.manufacturer, composition: o.original.composition, mrp: o.original.mrp } : null,
      alternativeProduct: o.alternative ? { id: o.alternative.id, brand: o.alternative.brand, manufacturer: o.alternative.manufacturer, composition: o.alternative.composition, mrp: o.alternative.mrp } : null,
      category: o.category || null,
      reasonShown: o.reasonShown || null,
      priceAtTime: o.alternative ? o.alternative.mrp : null,
      courseCostAtTime: o.alternative ? o.alternative.courseCost : null,
      doctorApproved: !!o.doctorApproved,
      patientSelected: !!o.patientSelected,
      timestamp: o.timestamp || new Date().toISOString()
    };
  }

  var API = {
    norm: norm, canonStrength: canonStrength, parseComposition: parseComposition, compositionKey: compositionKey,
    normalizeForm: normalizeForm, releaseKey: releaseKey, brandStrengths: brandStrengths, strengthKey: strengthKey,
    restricted: restricted, eligibility: eligibility, eligible: eligible,
    parsePack: parsePack, requiredQuantity: requiredQuantity, courseCost: courseCost,
    tierOf: tierOf, choose: choose, totals: totals, auditEntry: auditEntry,
    WEIGHTS: WEIGHTS, _version: 1
  };
  try { root.SMD_RXCHOICE = API; } catch (e) {}
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
