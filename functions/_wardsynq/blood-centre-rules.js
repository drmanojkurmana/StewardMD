/* functions/_wardsynq/blood-centre-rules.js - what a licensed blood centre in India must do with a unit after the
 * donor has given it: component shelf lives and storage temperatures, the mandatory tests and their methods, the label's
 * group colour, how long pilot and recipient samples are kept, how long the records are kept, and the per-hospital
 * settings that may only make those stricter. PURE, no I/O. blood-bank.js enforces it; Admin > Hospital edits the
 * settings; the Blood bank screen shows each value with its source.
 *
 * SOURCE: legal opinion of 2026-09-17, section G (G.1 tables, G.5 software requirements 3 to 8), which read the Drugs and
 * Cosmetics Rules 1945, Schedule F Part XII-B as substituted by G.S.R. 166(E) of 11 March 2020 (gazette mirror
 * https://drugscontrol.py.gov.in/sites/default/files/GSR-166-E.pdf) and the CDSCO consolidated text
 * (https://cdsco.gov.in/opencms/export/sites/CDSCO_WEB/Pdf-documents/acts_rules/2016DrugsandCosmeticsAct1940Rules1945.pdf).
 * Confidence high for the tests, the five-year records and the shelf lives (G.3). Where the opinion gives an item or
 * heading it is cited on the value; where it gives none the value is cited to the opinion's table, never to a guessed item.
 * UNCONFIRMED in the opinion, and said so on screen: a longer FFP shelf life at -40 C (not found in the Rules, so one
 * year is kept); NAT (not required by the Rules; a secondary report says the government declined to mandate it in
 * March 2026), so NAT is a hospital setting. A later change to the law is a code release citing the notification.
 *
 * node --test --experimental-test-module-mocks --test-concurrency=1 test/wardsynq-blood-centre.test.mjs
 */

import { CLASSES, classesOf } from "./retention.js";
import { citeOf } from "./legal-requirements.js";

const DAY_H = 24;
const str = (v) => (v == null ? "" : String(v).trim());
const RULES = citeOf("IN-DCR-SCHP-COMPONENTS");
const TABLE = "legal opinion 2026-09-17, G.1 component shelf life and storage";

/* THE COMPONENTS. hours: the longest shelf life, counted from collection (a pooled open-system unit from pooling).
 * byAnticoagulant / byAdditive: where the Rules distinguish. storage: the range in C (null end = no bound on that side),
 * agitation where required. prepareWithinHours: separated (platelets from whole blood) or frozen (FFP) within this long
 * after collection. */
const ANTICOAGULANTS = Object.freeze(["cpda", "acd"]);
const ADDITIVES = Object.freeze(["sagm", "adsol", "nutricel", "none"]);
const COMPONENT_RULES = Object.freeze({
  "whole-blood": { code: "WB", byAnticoagulant: { acd: 21 * DAY_H, cpda: 35 * DAY_H }, storage: { minC: 4, maxC: 6 },
    ref: "Schedule P item 7(a) ACD 21 days, item 7(b) CPDA 35 days, 4 to 6 C" },
  /* "Red cells in SAGM, ADSOL or NUTRICEL: up to 42 days"; packed red cells 2 to 6 C. The opinion reads no separate shelf
   * life for red cells without an additive, so they never outlive the whole blood limit of the bag's anticoagulant. */
  prbc: { code: "PRBC", byAdditive: { sagm: 42 * DAY_H, adsol: 42 * DAY_H, nutricel: 42 * DAY_H }, storage: { minC: 2, maxC: 6 },
    ref: `${TABLE}: red cells in SAGM, ADSOL or NUTRICEL up to 42 days; packed red cells 2 to 6 C`, noAdditiveCappedAtWholeBlood: true },
  /* "Not more than one year", "Not warmer than -30 C", "Frozen within 6 hours of collection". */
  ffp: { code: "FFP", hours: 365 * DAY_H, storage: { minC: null, maxC: -30 }, prepareWithinHours: 6, ref: `${TABLE}: FFP` },
  /* Random donor: "Not more than 5 days", "20 to 24 C with continuous gentle agitation", "Separated within 6 hours of
   * collection". Apheresis platelets: "Up to 5 days", 20 to 24 C with agitation (collected directly, no separation). */
  platelets: { code: "PLT", hours: 5 * DAY_H, storage: { minC: 20, maxC: 24, agitation: true }, prepareWithinHours: 6, ref: `${TABLE}: platelets` },
  /* "Not more than one year from collection", "Not higher than -30 C". */
  cryo: { code: "CRYO", hours: 365 * DAY_H, storage: { minC: null, maxC: -30 }, ref: `${TABLE}: cryoprecipitate` },
  /* "Within 24 hours", 20 to 24 C. */
  granulocytes: { code: "GRAN", hours: 24, storage: { minC: 20, maxC: 24 }, ref: `${TABLE}: granulocytes` },
});
/* "Pooled platelets or cryo, open system: 6 hours". A closed-system pool keeps the soonest expiry of its units. */
const POOLABLE = Object.freeze(["platelets", "cryo"]);
const POOLED_OPEN_HOURS = 6;
/* "Transport to wards: 2 to 10 C"; blood for transfusion "shall not be frozen at any stage". Printed on red cell labels. */
const TRANSPORT = Object.freeze({ minC: 2, maxC: 10 });

/** PURE. "2 to 6 C", "-30 C or colder", with agitation. Recorded on the unit as the range, not typed. */
function storageText(s) {
  const range = s.minC == null ? `${s.maxC} C or colder` : `${s.minC} to ${s.maxC} C`;
  return s.agitation ? `${range} with continuous gentle agitation` : range;
}

/** PURE. The longest shelf life in hours for one unit, and why. o: { anticoagulant, additive, pooledOpen }; shelfHours: the
 * hospital's shorter settings (bloodCentreSettings). Returns { hours, basis, hospital } or null for an unknown component. */
function shelfFor(component, o, shelfHours) {
  const r = COMPONENT_RULES[component];
  if (!r) return null;
  const opt = o || {};
  /* A bag recorded without its anticoagulant is held to the shorter (ACD). */
  const anticoagulant = ANTICOAGULANTS.includes(opt.anticoagulant) ? opt.anticoagulant : "acd";
  let hours, basis;
  if (opt.pooledOpen) { hours = POOLED_OPEN_HOURS; basis = "pooled-open"; }
  else if (r.byAnticoagulant) { hours = r.byAnticoagulant[anticoagulant]; basis = `anticoagulant-${anticoagulant}`; }
  else if (r.byAdditive) {
    const add = ADDITIVES.includes(opt.additive) ? opt.additive : "none";
    hours = r.byAdditive[add] || COMPONENT_RULES["whole-blood"].byAnticoagulant[anticoagulant];
    basis = r.byAdditive[add] ? `additive-${add}` : `no-additive-${anticoagulant}`;
  } else { hours = r.hours; basis = "rule"; }
  const mine = shelfHours && Number(shelfHours[component]);
  const hospital = Number.isInteger(mine) && mine > 0 && mine < hours;
  return { hours: hospital ? mine : hours, legalHours: hours, basis, hospital };
}

/** PURE. The longest shelf life the Rules allow a component in any form: the ceiling of a hospital's setting. */
function longestShelfHours(component) {
  const r = COMPONENT_RULES[component];
  if (!r) return null;
  return r.hours || Math.max(...Object.values(r.byAnticoagulant || r.byAdditive));
}

/* THE MANDATORY TESTS (Part XII-B heading K). K(2): every unit tested "before use" for HIV I and II antibodies. K(3):
 * "Hepatitis B surface antigen and Hepatitis C Virus antibody", VDRL, and malarial parasite, the results "recorded on the
 * label". Syphilis by VDRL "or equivalent" (G.5.3). The method is recorded with every result. */
const TEST_METHODS = Object.freeze({
  hiv: ["elisa", "clia", "rapid", "other-validated"],
  hbv: ["elisa", "clia", "rapid", "other-validated"],
  hcv: ["elisa", "clia", "rapid", "other-validated"],
  syphilis: ["vdrl", "rpr", "tpha", "elisa", "clia", "rapid", "other-validated"],
  malaria: ["smear", "rapid-antigen", "other-validated"],
  /* Not required by the Rules; a hospital setting. Reactive discards the unit like any other test. */
  nat: ["id-nat", "minipool-nat"],
});
const TEST_REFS = Object.freeze({ hiv: "heading K(2)", hbv: "heading K(3)", hcv: "heading K(3)", syphilis: "heading K(3)", malaria: "heading K(3)" });
/* Heading L: ABO and Rh grouping and "irregular antibodies (if any)" are entries in the master record. The opinion names
 * the field, not a rule that holds the unit, so a positive screen is recorded, printed on the label and shown, and the
 * crossmatch decides compatibility as it does now. */
const ANTIBODY_SCREEN = Object.freeze(["negative", "positive"]);
/* "Colour coding by group: O blue, A yellow, B pink, AB white." */
const GROUP_COLOURS = Object.freeze({ O: "blue", A: "yellow", B: "pink", AB: "white" });

/* HOW LONG THINGS ARE KEPT. K Note (a): pilot and recipient samples "preserved for 7 days after issue". Heading L NOTE:
 * "The above records shall be kept by the licensee for a period of five years"; r.122-P(i)(c) likewise.
 * The record period is retention.js's "blood-centre" class, not a setting of its own: its floor is the five years, and
 * the hospital's longer period is that class's wardsynq.retention.years["blood-centre"] (classesOf never goes below the
 * floor). The Admin blood centre card still edits it as recordRetentionYears; the route saves it into the class. */
const SAMPLE_RETENTION = Object.freeze({ days: 7, ref: citeOf("IN-DCR-XIIB-K-NOTE-A") });
const RETENTION_CLASS = "blood-centre";
const RECORD_RETENTION = Object.freeze({ years: CLASSES[RETENTION_CLASS].floorYears, retentionClass: RETENTION_CLASS, ref: citeOf("IN-DCR-XIIB-L") });

/**
 * PURE. The settings in force: wsqCfg.bloodCentre, each value used only where it is stricter than the Rules, and the
 * record period from wsqCfg.retention's blood-centre class. A recordRetentionYears left inside bloodCentre is ignored.
 * Returns { natRequired, shelfHours, sampleRetentionDays, recordRetentionYears, saved }.
 */
function bloodCentreSettings(wsqCfg) {
  const { recordRetentionYears: ignored, ...s } = (wsqCfg && wsqCfg.bloodCentre) || {};
  const { value } = validateBloodCentreSettings(s);
  const cls = classesOf(wsqCfg && wsqCfg.retention).classes[RETENTION_CLASS];
  return {
    natRequired: value.natRequired === true,
    shelfHours: value.shelfHours || {},
    sampleRetentionDays: value.sampleRetentionDays || SAMPLE_RETENTION.days,
    recordRetentionYears: cls.years,
    saved: cls.years > cls.floorYears ? { ...value, recordRetentionYears: cls.years } : value,
  };
}

/** PURE. wardsynq.retention with the blood-centre class at `years` (null: back to the floor). Every other class kept. */
function retentionWithRecordYears(retention, years) {
  const r = retention && typeof retention === "object" && !Array.isArray(retention) ? retention : {};
  const { [RETENTION_CLASS]: old, ...others } = r.years && typeof r.years === "object" ? r.years : {};
  return { ...r, years: years ? { ...others, [RETENTION_CLASS]: years } : others };
}

/** PURE. A hospital's settings from Admin: { value, errors }. Blank means the Rules' value and is not stored.
 * value.recordRetentionYears is not stored in bloodCentre: the route writes it with retentionWithRecordYears. */
function validateBloodCentreSettings(input) {
  const errors = {}, value = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return { value, errors: { settings: "Send the settings as an object." } };
  const blank = (v) => v == null || v === "";
  if (!blank(input.natRequired)) {
    if (typeof input.natRequired !== "boolean") errors.natRequired = "natRequired is true or false.";
    else if (input.natRequired) value.natRequired = true;
  }
  const whole = (v) => Number.isInteger(Number(v)) && String(v).trim() !== "" ? Number(v) : NaN;
  if (!blank(input.sampleRetentionDays)) {
    const n = whole(input.sampleRetentionDays);
    if (!(n >= SAMPLE_RETENTION.days && n <= 365)) errors.sampleRetentionDays = `sampleRetentionDays can only be longer than the Rules: a whole number from ${SAMPLE_RETENTION.days} to 365.`;
    else if (n > SAMPLE_RETENTION.days) value.sampleRetentionDays = n;
  }
  if (!blank(input.recordRetentionYears)) {
    const n = whole(input.recordRetentionYears);
    if (!(n >= RECORD_RETENTION.years && n <= 100)) errors.recordRetentionYears = `recordRetentionYears can only be longer than the Rules: a whole number from ${RECORD_RETENTION.years} to 100.`;
    else if (n > RECORD_RETENTION.years) value.recordRetentionYears = n;
  }
  const sh = input.shelfHours;
  if (sh != null && (typeof sh !== "object" || Array.isArray(sh))) errors.shelfHours = "shelfHours is an object of component to hours.";
  else if (sh) {
    for (const [k, raw] of Object.entries(sh)) {
      if (blank(raw)) { if (!COMPONENT_RULES[k]) errors[`shelfHours.${k}`] = `${k} is not a component.`; continue; }
      const max = longestShelfHours(k), n = whole(raw);
      if (max == null) errors[`shelfHours.${k}`] = `${k} is not a component.`;
      else if (!(n >= 1 && n <= max)) errors[`shelfHours.${k}`] = `shelfHours.${k} can only be shorter than the Rules: a whole number of hours from 1 to ${max}.`;
      else if (n < max) (value.shelfHours = value.shelfHours || {})[k] = n;
    }
  }
  return { value, errors };
}

/** PURE. The rules and settings in force, as the Blood bank and Admin screens show them. */
function bloodCentreView(wsqCfg) {
  const set = bloodCentreSettings(wsqCfg);
  return {
    rules: RULES,
    components: Object.keys(COMPONENT_RULES).map((c) => {
      const r = COMPONENT_RULES[c];
      const variants = r.byAnticoagulant ? Object.keys(r.byAnticoagulant).map((a) => ({ anticoagulant: a, ...shelfFor(c, { anticoagulant: a }, set.shelfHours) }))
        : r.byAdditive ? ADDITIVES.flatMap((a) => (a === "none" ? ANTICOAGULANTS.map((ac) => ({ additive: a, anticoagulant: ac, ...shelfFor(c, { additive: a, anticoagulant: ac }, set.shelfHours) })) : [{ additive: a, ...shelfFor(c, { additive: a }, set.shelfHours) }]))
          : [shelfFor(c, {}, set.shelfHours)];
      return { component: c, code: r.code, storage: r.storage, storageText: storageText(r.storage), ref: r.ref, longestHours: longestShelfHours(c),
        hospitalHours: set.shelfHours[c] || null, prepareWithinHours: r.prepareWithinHours || null, variants,
        /* The screens' old shape: the longest shelf in days and the storage words. */
        shelfDays: Math.round(Math.max(...variants.map((v) => v.hours)) / DAY_H * 100) / 100, confirmed: true };
    }),
    pooledOpenHours: POOLED_OPEN_HOURS, poolable: POOLABLE, transport: TRANSPORT,
    anticoagulants: ANTICOAGULANTS, additives: ADDITIVES,
    tests: Object.keys(TEST_REFS), testMethods: TEST_METHODS, testRefs: TEST_REFS, antibodyScreen: ANTIBODY_SCREEN, groupColours: GROUP_COLOURS,
    natRequired: set.natRequired, sampleRetentionDays: set.sampleRetentionDays, recordRetentionYears: set.recordRetentionYears,
    sampleRetention: SAMPLE_RETENTION, recordRetention: RECORD_RETENTION, saved: set.saved,
  };
}

/**
 * PURE. Until when a sample must be kept: `days` after the last of the times its units left the shelf (issue, discard,
 * expiry), or null while any unit it covers is still in the blood centre (so it must be kept). endTimes: ISO times, one
 * per unit, null for a unit still on the shelf.
 */
function sampleRetainUntil(endTimes, days) {
  const list = endTimes || [];
  if (!list.length || list.some((t) => !t || !Number.isFinite(Date.parse(t)))) return null;
  return new Date(Math.max(...list.map((t) => Date.parse(t))) + days * DAY_H * 3600000).toISOString();
}

export {
  RULES, ANTICOAGULANTS, ADDITIVES, COMPONENT_RULES, POOLABLE, POOLED_OPEN_HOURS, TRANSPORT, TEST_METHODS, TEST_REFS,
  ANTIBODY_SCREEN, GROUP_COLOURS, SAMPLE_RETENTION, RECORD_RETENTION,
  storageText, shelfFor, longestShelfHours, bloodCentreSettings, retentionWithRecordYears, validateBloodCentreSettings, bloodCentreView, sampleRetainUntil,
};
