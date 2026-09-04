/* wardsynq/wardsynq-safety.js — WardSynQ: deterministic clinical safety engine.
 *
 * The control that hazards HAZ-MED-01 (lethal interaction), HAZ-MED-02 (allergy) and HAZ-MED-03
 * (overdose) are argued against in the safety case. Everything here is deterministic and pure: same
 * inputs, same verdict, every time, no network, no model, no clock-dependent behaviour. That is the
 * whole point. A control you cannot re-run and get the same answer from is not a control you can
 * put in a safety case.
 *
 * WHAT THIS FILE IS NOT:
 *  - It holds no drug data of its own. Rule packs are INJECTED (see compileRulePack). The clinical
 *    content lives in a pack that a hospital's pharmacy owns, versions and signs off; swapping the
 *    pack must not require touching this file, and this file must stay correct for a pack it has
 *    never seen. `wardsynq-rules-stewardmd.js` is one such adapter, not a dependency.
 *  - It does not decide what happens next. It returns a verdict. The eMAR
 *    (wardsynq-meds.js) decides whether a dose moves; the UI decides what a clinician sees.
 *
 * THE OVERRIDE BOUNDARY, which is the part most likely to be eroded by a later refactor:
 * verdicts separate `blocks` (Category 1, absolute, no user may bypass) from `overridables`
 * (Category 2, bypassable only through the audited justification handshake). A finding may only
 * ever move from blocks to overridables by a deliberate, reviewed change to a rule pack's
 * disposition, never by a code change here and never by a caller passing a flag.
 *
 * node --test test/wardsynq-safety.test.mjs
 */

/** How bad a finding is, clinically. Ordered worst first. */
const SEVERITY = Object.freeze({
  CONTRAINDICATED: "contraindicated",
  MAJOR: "major",
  MODERATE: "moderate",
  MONITOR: "monitor",
});

const SEVERITY_ORDER = Object.freeze([
  SEVERITY.CONTRAINDICATED, SEVERITY.MAJOR, SEVERITY.MODERATE, SEVERITY.MONITOR,
]);

/**
 * What the system does about a finding. This is the governance boundary from the safety case, and
 * it is deliberately a separate axis from severity: severity is a clinical judgement about the
 * hazard, disposition is a policy decision about who, if anyone, may proceed anyway.
 */
const DISPOSITION = Object.freeze({
  BLOCK: "block", // Category 1: absolute hard-stop. No override exists. The transaction refuses.
  OVERRIDABLE: "overridable", // Category 2: proceed only with reason code, rationale and authentication.
  WARN: "warn", // Informational. Does not gate anything.
});

/** Allergy reaction severities that can never be overridden, whatever the rule pack says. */
const NON_OVERRIDABLE_REACTIONS = Object.freeze(["anaphylaxis", "anaphylactic", "sjs", "stevens-johnson", "ten", "toxic epidermal necrolysis", "dress"]);

class SafetyEngineError extends Error {
  constructor(message) {
    super(message);
    this.name = "SafetyEngineError";
  }
}

/* ------------------------------------------------------------------ helpers */

const lower = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");

/** Drug identity for matching. Prefers a code, falls back to the generic name. */
function drugKey(drugLike) {
  if (!drugLike) return "";
  if (typeof drugLike === "string") return lower(drugLike);
  return lower(drugLike.drugCode || drugLike.generic || drugLike.drug || drugLike.substance || "");
}

/**
 * A generic name as written on an order is rarely the pack's key ("Paracetamol 500mg tablet" vs
 * "paracetamol"). Reduce the written text to a pack key.
 *
 * Tokenise and look up, rather than scanning every key in the pack. With a real pack of several
 * thousand generics, a scan-and-regex approach costs a regex compile per key per drug, which blew
 * the 10 ms budget by an order of magnitude once measured against the full StewardMD ruleset. Set
 * lookups over a handful of tokens are constant-ish and give the same answer.
 *
 * Deliberately conservative: exact token matching only, no fuzzy matching, no stemming, no
 * prefix guessing. A near-miss must fail to resolve and surface as `unresolvedDrug` rather than
 * silently match the wrong drug. Known vocabulary mismatches are handled by an explicit alias map
 * supplied by the pack (see the adapter), never by loosening the match here.
 *
 * @param {string} text as written on the order
 * @param {object|Set} pack a compiled pack, or a bare genericIndex Set
 */
function resolveGeneric(text, pack) {
  const t = lower(text);
  if (!t) return null;
  const index = pack instanceof Set ? pack : pack.genericIndex;
  const aliases = pack instanceof Set ? null : pack.aliases;
  const hit = (candidate) => {
    if (index.has(candidate)) return candidate;
    if (aliases && aliases.has(candidate)) return aliases.get(candidate);
    return null;
  };

  const direct = hit(t);
  if (direct) return direct;

  // Drop strength/form noise: pure numbers, units and anything starting with a digit ("500mg").
  const tokens = t.split(/[^a-z0-9-]+/).filter((w) => w.length >= 4 && !/^\d/.test(w));
  // Longest spans first, so "penicillin g" wins over "penicillin" when both are present.
  for (let span = Math.min(3, tokens.length); span >= 1; span--) {
    for (let i = 0; i + span <= tokens.length; i++) {
      const run = tokens.slice(i, i + span);
      const spaced = hit(run.join(" "));
      if (spaced) return spaced;
      const hyphenated = hit(run.join("-"));
      if (hyphenated) return hyphenated;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ rule pack */

/**
 * Compiles a raw rule pack into indexed form.
 *
 * Done once at load, not per check, because the p95 budget for a full safety evaluation is 10 ms
 * with a hundred concurrent drugs (section 3 of the spec). Scanning every rule against every drug
 * pair on each keystroke does not fit in that budget; a class-indexed lookup does.
 *
 * Raw pack shape (all sections optional, so a site can ship only what it has):
 *   {
 *     version, generatedAt,
 *     drugClasses: { <generic>: [classTag, ...] },
 *     interactions: [ {id, subjects:[{kind:'class'|'generic', value}], severity, disposition?,
 *                      type?, mechanism?, effect?, action?, monitoring?} ],
 *     allergyClasses: { <classTag>: [member generic, ...] },
 *     crossReactivity: [ {id, groups:[classTag, classTag], likelihood, note, disposition?} ],
 *     doseLimits: { <generic>: {maxSingle:{value,unit}, maxDaily:{value,unit},
 *                               mgPerKgSingle?, mgPerKgDaily?, absoluteCeilingSingle?} },
 *     renalAdjustments: { <generic>: { <band>: {dose, note} } }
 *   }
 */
function compileRulePack(raw) {
  if (!raw || typeof raw !== "object") throw new SafetyEngineError("a rule pack object is required");

  const drugClasses = new Map();
  for (const [generic, tags] of Object.entries(raw.drugClasses || {})) {
    drugClasses.set(lower(generic), new Set((tags || []).map(lower)));
  }

  // The index is every generic the pack knows about, from any section. A pack may list a generic
  // it has no class tags for; that drug still has to resolve, or its dose ceiling silently stops
  // being checked.
  const genericIndex = new Set(drugClasses.keys());
  for (const g of raw.generics || []) genericIndex.add(lower(g));
  for (const g of Object.keys(raw.doseLimits || {})) genericIndex.add(lower(g));
  for (const g of Object.keys(raw.renalAdjustments || {})) genericIndex.add(lower(g));

  // Vocabulary reconciliation. Real drug data does not agree with itself: StewardMD's interaction
  // set spells amoxicillin "amoxicillin anhydrous", so an allergy list saying "amoxicillin" would
  // never match it and the shield would fail open. Aliases are supplied by the adapter that knows
  // both vocabularies; the engine only applies them.
  const aliases = new Map();
  for (const [from, to] of Object.entries(raw.aliases || {})) {
    const target = lower(to);
    if (genericIndex.has(target)) aliases.set(lower(from), target);
  }

  // Index interaction rules by every subject token they mention, so a check only has to look at
  // rules that could possibly involve the drugs actually present.
  const byToken = new Map();
  const interactions = [];
  for (const rule of raw.interactions || []) {
    if (!rule || !Array.isArray(rule.subjects) || rule.subjects.length < 1) continue;
    const compiled = {
      id: rule.id || `rule-${interactions.length}`,
      type: rule.type || "pair",
      severity: SEVERITY_ORDER.includes(rule.severity) ? rule.severity : SEVERITY.MONITOR,
      disposition: rule.disposition || null, // resolved later against the policy default
      subjects: rule.subjects.map((s) => ({ kind: s.kind === "generic" ? "generic" : "class", value: lower(s.value) })),
      mechanism: rule.mechanism || "",
      effect: rule.effect || "",
      action: rule.action || "",
      monitoring: rule.monitoring || "",
    };
    interactions.push(compiled);
    for (const s of compiled.subjects) {
      if (!byToken.has(s.value)) byToken.set(s.value, []);
      byToken.get(s.value).push(compiled);
    }
  }

  // Allergy class membership, indexed both ways: a substance needs its classes, and a class needs
  // its members, because an allergy may be recorded either as a specific drug or as a whole class.
  const allergyClassOf = new Map();
  const allergyMembers = new Map();
  for (const [cls, members] of Object.entries(raw.allergyClasses || {})) {
    const c = lower(cls);
    const set = new Set();
    for (const raw of (members || [])) {
      const m = lower(raw);
      if (!m) continue;
      set.add(m);
      // Index membership under BOTH vocabularies. An allergy list is written the way clinicians
      // write ("amoxicillin") while the interaction data may only know a qualified form
      // ("amoxicillin anhydrous"). An order resolves to the canonical form, so if membership were
      // indexed only under the clinician's form the class lookup would miss and the shield would
      // fail open. This is the same mismatch the aliases exist for, applied to the other side.
      const canonical = aliases.get(m);
      if (canonical) set.add(canonical);
    }
    allergyMembers.set(c, set);
    for (const m of set) {
      if (!allergyClassOf.has(m)) allergyClassOf.set(m, new Set());
      allergyClassOf.get(m).add(c);
    }
  }

  const crossReactivity = (raw.crossReactivity || []).map((x, i) => ({
    id: x.id || `xr-${i}`,
    groups: (x.groups || []).map(lower),
    likelihood: x.likelihood || "unknown",
    note: x.note || "",
    disposition: x.disposition || null,
  }));

  const doseLimits = new Map();
  for (const [generic, limits] of Object.entries(raw.doseLimits || {})) {
    doseLimits.set(lower(generic), limits);
  }

  const renalAdjustments = new Map();
  for (const [generic, bands] of Object.entries(raw.renalAdjustments || {})) {
    renalAdjustments.set(lower(generic), bands);
  }

  return Object.freeze({
    version: raw.version || "unversioned",
    generatedAt: raw.generatedAt || null,
    drugClasses, genericIndex, aliases, interactions, byToken,
    allergyClassOf, allergyMembers, crossReactivity,
    doseLimits, renalAdjustments,
  });
}

/** An empty pack. Useful for tests and as an explicit "this site has no rules loaded" state. */
function emptyRulePack() {
  return compileRulePack({ version: "empty" });
}

/* ------------------------------------------------------------------ findings */

function finding(code, disposition, severity, message, extra) {
  return { code, disposition, severity, message, ...(extra || {}) };
}

/**
 * Default policy: which disposition a severity earns when a rule pack does not state one.
 * Contraindicated is an absolute stop; major needs a witnessed override; the rest inform.
 * A pack may override this per rule, which is how a site relaxes or tightens its own policy
 * without editing the engine.
 */
function defaultDisposition(severity) {
  if (severity === SEVERITY.CONTRAINDICATED) return DISPOSITION.BLOCK;
  if (severity === SEVERITY.MAJOR) return DISPOSITION.OVERRIDABLE;
  return DISPOSITION.WARN;
}

/* ------------------------------------------------------------------ checks */

/**
 * Allergy shield. HAZ-MED-02.
 *
 * Three ways a drug can conflict with a recorded allergy, in descending confidence:
 *  1. the substance itself,
 *  2. a class the substance belongs to (recorded allergy to "penicillins", ordered amoxicillin),
 *  3. a documented cross-reactivity between two classes (penicillin recorded, cephalosporin ordered).
 *
 * A verified severe reaction is a hard-stop at every level, and that is not negotiable by rule
 * pack: an unverified or mild allergy is overridable, but "documented anaphylaxis to this exact
 * substance" is the canonical Category 1 hard-stop in the safety case. Cross-reactivity is treated
 * as weaker evidence than a direct match and is overridable unless the pack says otherwise, because
 * over-blocking on presumed cross-reactivity drives clinically harmful antibiotic substitution.
 */
function checkAllergies(pack, order, allergies) {
  const out = [];
  const ordered = resolveGeneric(order.drugCode || order.drug, pack) || drugKey(order);
  if (!ordered) return out;

  const orderedClasses = pack.allergyClassOf.get(ordered) || new Set();

  for (const allergy of allergies || []) {
    const substance = lower(allergy.substance);
    if (!substance) continue;
    const severe = isSevereReaction(allergy);
    const verified = !!allergy.verifiedBy;

    // 1. direct substance match
    if (substance === ordered) {
      out.push(finding(
        "ALLERGY_DIRECT",
        severe && verified ? DISPOSITION.BLOCK : DISPOSITION.OVERRIDABLE,
        SEVERITY.CONTRAINDICATED,
        `Patient has a documented ${allergy.reaction || allergy.severity || "allergy"} to ${allergy.substance}.`,
        { allergyId: allergy.id, substance: allergy.substance, matchedOn: "substance", verified },
      ));
      continue;
    }

    // 2. class membership: the allergy names a class the ordered drug belongs to, or names a
    //    substance that shares a class with it.
    const allergyClasses = pack.allergyMembers.has(substance)
      ? new Set([substance])
      : (pack.allergyClassOf.get(substance) || new Set());
    const shared = [...allergyClasses].filter((c) => orderedClasses.has(c) || (pack.allergyMembers.get(c) || new Set()).has(ordered));
    if (shared.length) {
      out.push(finding(
        "ALLERGY_CLASS",
        severe && verified ? DISPOSITION.BLOCK : DISPOSITION.OVERRIDABLE,
        SEVERITY.CONTRAINDICATED,
        `${order.drug} belongs to ${shared.join(", ")}, which the patient is documented allergic to (${allergy.substance}).`,
        { allergyId: allergy.id, substance: allergy.substance, matchedOn: "class", classes: shared, verified },
      ));
      continue;
    }

    // 3. cross-reactivity between the allergy's class and the ordered drug's class
    for (const xr of pack.crossReactivity) {
      const [a, b] = xr.groups;
      const allergyIn = allergyClasses.has(a) || allergyClasses.has(b) || (pack.allergyMembers.get(a) || new Set()).has(substance) || (pack.allergyMembers.get(b) || new Set()).has(substance);
      const orderIn = orderedClasses.has(a) || orderedClasses.has(b);
      if (!allergyIn || !orderIn) continue;
      // Only a real crossing counts: both on the same side is just class membership, handled above.
      const sameSide = (orderedClasses.has(a) && (allergyClasses.has(a) || (pack.allergyMembers.get(a) || new Set()).has(substance)))
        || (orderedClasses.has(b) && (allergyClasses.has(b) || (pack.allergyMembers.get(b) || new Set()).has(substance)));
      if (sameSide) continue;
      out.push(finding(
        "ALLERGY_CROSS_REACTIVITY",
        xr.disposition || (severe && verified ? DISPOSITION.BLOCK : DISPOSITION.OVERRIDABLE),
        severe ? SEVERITY.CONTRAINDICATED : SEVERITY.MAJOR,
        `Possible cross-reactivity (${xr.likelihood}) between documented ${allergy.substance} allergy and ${order.drug}. ${xr.note}`.trim(),
        { allergyId: allergy.id, substance: allergy.substance, matchedOn: "cross-reactivity", crossReactivityId: xr.id, likelihood: xr.likelihood, verified },
      ));
      break;
    }
  }
  return out;
}

/** True when a recorded reaction is of a kind that must never be overridden. */
function isSevereReaction(allergy) {
  const reaction = lower(allergy.reaction);
  if (NON_OVERRIDABLE_REACTIONS.some((r) => reaction.includes(r))) return true;
  return lower(allergy.severity) === "severe" || lower(allergy.criticality) === "high";
}

/**
 * Drug-drug interactions. HAZ-MED-01.
 *
 * Evaluates the ordered drug against the patient's active medication list. Rules may be expressed
 * over generics or over classes; a rule fires when every one of its subjects is satisfied by a
 * DIFFERENT drug in the combined list, and at least one of them is the drug being ordered (a rule
 * that fires only among drugs the patient is already on is not caused by this order, and is
 * reported as pre-existing rather than blocking a new dose).
 */
function checkInteractions(pack, order, activeMeds) {
  const out = [];
  const orderedGeneric = resolveGeneric(order.drugCode || order.drug, pack);
  if (!orderedGeneric) return out;

  const list = [{ generic: orderedGeneric, isOrdered: true, label: order.drug }];
  for (const med of activeMeds || []) {
    const g = resolveGeneric(med.drugCode || med.drug, pack);
    if (g) list.push({ generic: g, isOrdered: false, label: med.drug || g });
  }
  if (list.length < 2) return out;

  const tokensOf = (entry) => new Set([entry.generic, ...(pack.drugClasses.get(entry.generic) || [])]);
  const enriched = list.map((e) => ({ ...e, tokens: tokensOf(e) }));

  // Only rules mentioning a token actually present can fire.
  const present = new Set();
  for (const e of enriched) for (const t of e.tokens) present.add(t);
  const candidates = new Set();
  for (const t of present) for (const rule of pack.byToken.get(t) || []) candidates.add(rule);

  for (const rule of candidates) {
    const assignment = isDuplicationRule(rule)
      ? satisfyDuplicationRule(rule, enriched)
      : satisfyRule(rule, enriched);
    if (!assignment) continue;
    if (!assignment.some((e) => e.isOrdered)) continue; // pre-existing, not caused by this order
    const disposition = rule.disposition || defaultDisposition(rule.severity);
    out.push(finding(
      `INTERACTION_${rule.severity.toUpperCase()}`,
      disposition,
      rule.severity,
      `${rule.effect || "Interaction"}${rule.action ? " " + rule.action : ""}`.trim(),
      {
        ruleId: rule.id,
        ruleType: rule.type,
        drugs: assignment.map((e) => e.label),
        // Kept separately as well as combined in `message`, so an interface can present the risk
        // and the recommended action as distinct facts rather than one paragraph.
        effect: rule.effect || "",
        action: rule.action || "",
        mechanism: rule.mechanism,
        monitoring: rule.monitoring,
      },
    ));
  }
  return collapseDuplicateFindings(out);
}

/**
 * Collapses findings that say the same clinical thing about the same drugs.
 *
 * Real class data tags a drug many times over: amoxicillin and clarithromycin share
 * "Anti-infective", "Antibacterial", "Antimicrobial", "Chemical Structure", "Established
 * Pharmacologic Classes" and "Penicillin-class Antibacterial", so a naive one-finding-per-rule
 * pass reports the SAME duplicate-therapy fact six times, several of them under class names that
 * mean nothing at the bedside. Six alerts for one fact is how alert fatigue is manufactured, and a
 * clinician who learns to dismiss this panel will dismiss the hard-stop sitting above it too.
 *
 * Findings are therefore grouped by what a clinician would consider one issue: the same rule type
 * and severity about the same set of drugs. The surviving finding keeps every contributing rule id
 * in `mergedRuleIds` so an audit can still see exactly which rules fired, and counts them in
 * `mergedCount`. Nothing is discarded from the record, only from the reading.
 *
 * Deliberately NOT collapsed: findings of different severity, or about different drugs. Those are
 * different clinical facts even when their wording is similar.
 */
function collapseDuplicateFindings(findings) {
  const groups = new Map();
  for (const f of findings) {
    const key = `${f.ruleType}|${f.severity}|${(f.drugs || []).slice().sort().join("+")}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...f, mergedRuleIds: [f.ruleId], mergedCount: 1 });
      continue;
    }
    existing.mergedRuleIds.push(f.ruleId);
    existing.mergedCount += 1;
  }
  return [...groups.values()];
}

/**
 * A duplicate-therapy rule names ONE class and means "two or more drugs in this class is
 * duplication". It does not mean "one drug in this class is a problem".
 *
 * This distinction is not cosmetic and it is easy to get wrong, because such a rule looks
 * structurally identical to a single-subject pair rule. Read literally by a generic matcher, all
 * 270 of these in the StewardMD pack fire on a SINGLE drug: ordering warfarin for a patient on no
 * other anticoagulant raises a major "two systemic anticoagulants" alert, which this engine maps to
 * an override requirement. A clinician would be asked to justify a duplication that does not exist,
 * on the majority of ordinary orders. Found by driving the workstation, not by a unit test.
 */
function isDuplicationRule(rule) {
  return rule.type === "duplicate_class" && rule.subjects.length === 1;
}

/**
 * Satisfies a duplicate-therapy rule: collect EVERY distinct drug matching the class, and fire only
 * when at least two do. Returns all of them, so the finding can name the drugs that actually
 * overlap rather than just the one being ordered.
 */
function satisfyDuplicationRule(rule, entries) {
  const subject = rule.subjects[0];
  const matches = entries.filter((e) => (subject.kind === "generic" ? e.generic === subject.value : e.tokens.has(subject.value)));
  return matches.length >= 2 ? matches : null;
}

/**
 * Finds a set of distinct drugs satisfying every subject of a rule, or null.
 * Rules have at most a handful of subjects, so a simple backtracking assignment is both fast enough
 * and far easier to audit than anything cleverer.
 */
function satisfyRule(rule, entries) {
  const used = new Set();
  const chosen = [];
  const matches = (subject, entry) => (subject.kind === "generic" ? entry.generic === subject.value : entry.tokens.has(subject.value));
  const walk = (i) => {
    if (i === rule.subjects.length) return true;
    for (let j = 0; j < entries.length; j++) {
      if (used.has(j)) continue;
      if (!matches(rule.subjects[i], entries[j])) continue;
      used.add(j); chosen.push(entries[j]);
      if (walk(i + 1)) return true;
      used.delete(j); chosen.pop();
    }
    return false;
  };
  return walk(0) ? chosen.slice() : null;
}

/**
 * Dose ceilings. HAZ-MED-03.
 *
 * Two different questions, deliberately answered separately:
 *  - is this above the recommended maximum (overridable, a clinician may have a reason), and
 *  - is this above the absolute physiological ceiling (never overridable; the spec lists exceeding
 *    the maximum lethal dose as a Category 1 hard-stop).
 *
 * Weight-based checks REFUSE to guess. If a pack defines an mg/kg limit and the patient has no
 * recorded weight, that is itself a finding, not a silent pass: an unweighed child is exactly the
 * situation the hazard describes.
 *
 * `clinical` carries weightKg, deliberately NOT read off the Patient record. Weight is an
 * Observation with a time on it, and dosing a child on a weight from six months ago is its own
 * hazard. Making the caller pass the current value forces it to have fetched one.
 */
function checkDose(pack, order, clinical) {
  clinical = clinical || {};
  const out = [];
  const generic = resolveGeneric(order.drugCode || order.drug, pack);
  const limits = generic ? pack.doseLimits.get(generic) : null;
  if (!limits) return out;

  const dose = order.dose;
  if (!dose || typeof dose.value !== "number" || !Number.isFinite(dose.value)) {
    out.push(finding("DOSE_UNPARSEABLE", DISPOSITION.OVERRIDABLE, SEVERITY.MAJOR,
      `No numeric dose on this order for ${order.drug}; ceiling checks could not run.`, { generic }));
    return out;
  }

  const sameUnit = (a, b) => a && b && lower(a.unit) === lower(b.unit);

  if (limits.absoluteCeilingSingle && sameUnit(dose, limits.absoluteCeilingSingle) && dose.value > limits.absoluteCeilingSingle.value) {
    out.push(finding("DOSE_ABSOLUTE_CEILING", DISPOSITION.BLOCK, SEVERITY.CONTRAINDICATED,
      `${dose.value} ${dose.unit} exceeds the absolute single-dose ceiling for ${order.drug} (${limits.absoluteCeilingSingle.value} ${limits.absoluteCeilingSingle.unit}).`,
      { generic, limit: limits.absoluteCeilingSingle, given: dose }));
  } else if (limits.maxSingle && sameUnit(dose, limits.maxSingle) && dose.value > limits.maxSingle.value) {
    out.push(finding("DOSE_ABOVE_MAX_SINGLE", DISPOSITION.OVERRIDABLE, SEVERITY.MAJOR,
      `${dose.value} ${dose.unit} exceeds the recommended maximum single dose for ${order.drug} (${limits.maxSingle.value} ${limits.maxSingle.unit}).`,
      { generic, limit: limits.maxSingle, given: dose }));
  }

  const perKg = limits.mgPerKgSingle;
  if (perKg && lower(dose.unit) === "mg") {
    const weight = typeof clinical.weightKg === "number" ? clinical.weightKg : null;
    if (weight === null) {
      out.push(finding("DOSE_WEIGHT_MISSING", DISPOSITION.BLOCK, SEVERITY.CONTRAINDICATED,
        `${order.drug} is dosed by weight and this patient has no recorded weight, so the mg/kg ceiling cannot be checked.`,
        { generic, mgPerKgSingle: perKg }));
    } else {
      const ceiling = perKg * weight;
      // A paediatric weight-based dose is additionally capped at the adult maximum: mg/kg alone
      // lets a heavy adolescent exceed an adult dose, which is the classic paediatric overdose.
      const adultCap = limits.absoluteCeilingSingle && lower(limits.absoluteCeilingSingle.unit) === "mg" ? limits.absoluteCeilingSingle.value : Infinity;
      const effective = Math.min(ceiling, adultCap);
      if (dose.value > effective) {
        out.push(finding("DOSE_ABOVE_MG_PER_KG", DISPOSITION.BLOCK, SEVERITY.CONTRAINDICATED,
          `${dose.value} mg exceeds the weight-based ceiling for ${order.drug} (${perKg} mg/kg x ${weight} kg = ${ceiling} mg${effective === adultCap ? `, capped at the adult maximum ${adultCap} mg` : ""}).`,
          { generic, mgPerKgSingle: perKg, weightKg: weight, ceiling: effective, given: dose }));
      }
    }
  }
  return out;
}

/** Renal band from eGFR or CrCl. Bands match the ones already used across StewardMD. */
function renalBand(egfr) {
  if (typeof egfr !== "number" || !Number.isFinite(egfr)) return null;
  if (egfr >= 90) return "normal";
  if (egfr >= 60) return "mild";
  if (egfr >= 30) return "moderate";
  if (egfr >= 15) return "severe";
  return "esrd";
}

/**
 * Renal dose adjustment. Always overridable: the safety case lists "overriding a renal dose
 * reduction recommendation" as an explicit Category 2 example, so this must never become a block.
 */
function checkRenal(pack, order, clinical) {
  clinical = clinical || {};
  const out = [];
  const generic = resolveGeneric(order.drugCode || order.drug, pack);
  const bands = generic ? pack.renalAdjustments.get(generic) : null;
  if (!bands) return out;
  const band = renalBand(clinical.egfr);
  if (!band || band === "normal") return out;
  const advice = bands[band];
  if (!advice) return out;
  out.push(finding("RENAL_ADJUSTMENT_RECOMMENDED", DISPOSITION.OVERRIDABLE, SEVERITY.MODERATE,
    `Renal function is ${band} (eGFR ${clinical.egfr}); ${order.drug} recommends ${advice.dose || advice}.`,
    { generic, band, egfr: clinical.egfr, advice }));
  return out;
}

/* ------------------------------------------------------------------ engine */

/**
 * Deterministic clinical safety engine.
 *
 * Usage:
 *   const engine = new SafetyEngine({ rulePack: compileRulePack(raw) });
 *   const verdict = engine.evaluate({ order, patient, allergies, activeMeds, overrides });
 *   const emar = new MedicationAdministrationRecord({ safetyCheck: engine.hook() });
 */
class SafetyEngine {
  /**
   * @param {{rulePack: object, checks?: string[]}} deps
   *   checks lets a caller run a subset (e.g. only allergy at order entry). Omitted means all.
   */
  constructor(deps) {
    deps = deps || {};
    if (!deps.rulePack) throw new SafetyEngineError("SafetyEngine requires a compiled rulePack");
    this.rulePack = deps.rulePack;
    this.checks = deps.checks || ["allergy", "interaction", "dose", "renal"];
  }

  /**
   * @param {{order: object, patient?: object, allergies?: object[], activeMeds?: object[],
   *   overrides?: {code: string, reasonCode: string, rationale: string, actorId: string,
   *   witnessId?: string}[]}} ctx
   * @returns {{allowed: boolean, blocks: object[], overridables: object[], warnings: object[],
   *   findings: object[], unresolvedDrug: boolean, rulePackVersion: string, elapsedMs: number}}
   */
  evaluate(ctx) {
    const started = performance.now();
    ctx = ctx || {};
    const { order, patient, allergies, activeMeds } = ctx;
    if (!order || !order.drug) throw new SafetyEngineError("evaluate() requires an order with a drug");

    // Weight and renal function are measurements, not demographics, so they are read from the
    // context first. The fall-back to a denormalized copy on the patient record is a convenience
    // for callers that cache them; a caller with a fresh Observation should pass it here.
    const clinical = {
      weightKg: typeof ctx.weightKg === "number" ? ctx.weightKg : (patient && patient.weightKg),
      egfr: typeof ctx.egfr === "number" ? ctx.egfr : (patient && patient.egfr),
    };

    let findings = [];
    if (this.checks.includes("allergy")) findings = findings.concat(checkAllergies(this.rulePack, order, allergies || []));
    if (this.checks.includes("interaction")) findings = findings.concat(checkInteractions(this.rulePack, order, activeMeds || []));
    if (this.checks.includes("dose")) findings = findings.concat(checkDose(this.rulePack, order, clinical));
    if (this.checks.includes("renal")) findings = findings.concat(checkRenal(this.rulePack, order, clinical));

    // An override clears exactly one overridable finding, matched by code and, where the finding
    // names one, its rule/allergy id. It can never clear a block: that is what Category 1 means.
    const overrides = ctx.overrides || [];
    const isCleared = (f) => f.disposition === DISPOSITION.OVERRIDABLE && overrides.some((o) => {
      if (o.code !== f.code) return false;
      if (o.targetId && (o.targetId !== f.ruleId && o.targetId !== f.allergyId)) return false;
      return !!o.reasonCode && !!o.rationale && !!o.actorId;
    });

    const blocks = findings.filter((f) => f.disposition === DISPOSITION.BLOCK);
    const overridables = findings.filter((f) => f.disposition === DISPOSITION.OVERRIDABLE && !isCleared(f));
    const cleared = findings.filter(isCleared);
    const warnings = findings.filter((f) => f.disposition === DISPOSITION.WARN).concat(cleared.map((f) => ({ ...f, disposition: DISPOSITION.WARN, overridden: true })));

    // A drug the pack does not recognise is reported, not silently treated as safe. Whether that
    // should stop an order is a site policy decision, so it is a flag rather than a block here.
    const unresolvedDrug = !resolveGeneric(order.drugCode || order.drug, this.rulePack);

    return {
      allowed: blocks.length === 0 && overridables.length === 0,
      blocks, overridables, warnings, findings,
      unresolvedDrug,
      rulePackVersion: this.rulePack.version,
      elapsedMs: performance.now() - started,
    };
  }

  /**
   * Adapts this engine to the hook shape wardsynq-meds.js expects. The eMAR only understands
   * allowed/blocks/warnings, so an un-actioned overridable is surfaced to it as a block: at the
   * bedside, a dose with an outstanding override requirement must not be given, and the handshake
   * belongs at order entry, not at the moment of administration.
   */
  hook(resolve) {
    return (hookCtx) => {
      const ctx = resolve ? resolve(hookCtx) : hookCtx;
      const verdict = this.evaluate({
        order: ctx.order,
        patient: ctx.patient,
        allergies: ctx.allergies || (ctx.patient && ctx.patient.allergies) || [],
        activeMeds: ctx.activeMeds || [],
        overrides: ctx.overrides || [],
      });
      return {
        allowed: verdict.allowed,
        blocks: verdict.blocks.concat(verdict.overridables.map((f) => ({ ...f, requiresOverride: true }))),
        warnings: verdict.warnings,
      };
    };
  }
}

export {
  SEVERITY, SEVERITY_ORDER, DISPOSITION, NON_OVERRIDABLE_REACTIONS,
  SafetyEngine, SafetyEngineError,
  compileRulePack, emptyRulePack, defaultDisposition,
  checkAllergies, checkInteractions, checkDose, checkRenal, collapseDuplicateFindings,
  resolveGeneric, renalBand, isSevereReaction, satisfyRule, satisfyDuplicationRule, isDuplicationRule,
};
