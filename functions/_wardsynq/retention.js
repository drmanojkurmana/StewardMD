/* functions/_wardsynq/retention.js - how long a hospital must keep a patient's records, and the legal hold that keeps
 * them past that.
 *
 * SOURCE. The legal opinion of 17 September 2026, section H (research for implementation, pending a practising
 * lawyer's sign-off), and the owner's legal guidance of 17 September 2026 (item 4). Each class carries its layers:
 * what the law requires and what is the hospital's retention policy. A hospital may LENGTHEN any class
 * (wardsynq.retention.years), which is a RETENTION_POLICY layer, and never shorten it below the minimum here (H.4.3).
 *
 * NOTHING IS PURGED AUTOMATICALLY. This file answers "until when" and "is anything holding it"; destroying a stored
 * file is a person's act (documents.js purgeDocument), refused before the date and under a hold, and it writes who,
 * when and why (H.4.2).
 *
 * WHAT DPDP ERASURE CANNOT TOUCH. Act s.8(7) and s.12(3) keep what "compliance with any law" requires, SPDI Rules
 * 2011 r.5(4) the same today, and s.17(1)(a) and (c) take a legal claim or an offence's investigation outside the
 * erasure duty. So an erasure answer names each class the patient has records in, the rule that keeps it and the
 * date it ends (H.4.5), and a legal hold refuses the erasure outright (A.4.9, H.4.4).
 *
 * A LEGAL HOLD IS SET BY A PERSON OR BY A MEDICO-LEGAL CASE. Every medico-legal case register entry that is not
 * marked in error holds the patient's record automatically (H.4.4: "An MLC ... sets the hold automatically"). A
 * hold, automatic or placed, is lifted only by the medical records officer with a reference to the disposal of the
 * matter. A POCSO report and a notice of a complaint have no record type in WardSynQ yet: they are placed by hand.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { ageAt, MAJORITY_YEARS, DPDP_START, DAY, dayMs, lawOn } from "./privacy-law.js";

const str = (v) => (v == null ? "" : String(v).trim());
const HOLD = "LegalHold";
const REGISTER_PREFIX = "_wardsynq_register_"; // registers.js PREFIX: register entries are read straight from the repository, as registers.js does

/* THE BASIS OF EACH PERIOD (owner's guidance of 17 Sep 2026, item 4). A period is "required by law" only when it comes
 * from an identified statutory provision: an Act, a Rule, a Regulation made under an Act, or a statutory direction or
 * notification. That is a LEGAL_OBLIGATION layer. An office memorandum or guideline with no statutory provision
 * identified (the DGHS OM of 2014 is one), WardSynQ's safest default and the hospital's own longer setting are
 * RETENTION_POLICY layers. A class can have both: a statutory floor and a longer policy period.
 * Before DPDP commencement erasure behaves as it did, with the basis labelled. From commencement a LEGAL_OBLIGATION
 * layer refuses erasure for its period and names the law; a RETENTION_POLICY layer alone goes to the DPO for a
 * documented decision (dpdp.js). A legal hold refuses either way.
 *
 * The layer shape follows the owner's legal requirement record (id, source type, instrument, provision, jurisdiction,
 * effective date, status, evidence, notes), so these rows can move into a legal requirement registry unchanged. */
const LEGAL = "LEGAL_OBLIGATION", POLICY = "RETENTION_POLICY";
const layer = (type, o) => Object.freeze({ type, jurisdiction: "IN", status: "IN_FORCE", effectiveFrom: null, years: null, days: null, note: null, ...o, evidence: Object.freeze(o.evidence || []) });
const OM_2014 = "DGHS Office Memorandum F. No. A.12034/3/2014-MH-II/MH-I, 28 Oct 2014 (Retention period of Medical Records)";
const OM_URL = "https://www.nrces.in/sites/default/files/resources/retention_pr.pdf";
const OM_NOTE = "An executive instruction to State and UT health secretaries and central institutions. No statutory provision identified, so it is not a period required by law until one is.";
const DC_RULES = "Drugs and Cosmetics Rules 1945", DC_URL = "https://cdsco.gov.in/opencms/export/sites/CDSCO_WEB/Pdf-documents/acts_rules/2016DrugsandCosmeticsAct1940Rules1945.pdf";
const BASES = Object.freeze({
  "clinical-ipd": Object.freeze([
    layer(LEGAL, { id: "retention.clinical-ipd.imc-2002-reg-1.3.1", sourceType: "Regulation", instrument: "Indian Medical Council (Professional Conduct, Etiquette and Ethics) Regulations 2002", provision: "reg 1.3.1",
      years: 3, from: "start-of-treatment", evidence: ["https://indiankanoon.org/doc/100527417/"],
      note: "Indoor patients, three years from the commencement of treatment. The duty is the physician's; the hospital keeps the record for its doctors. The 2002 Regulations govern since the NMC 2023 Regulations were put in abeyance on 23 Aug 2023." }),
    layer(POLICY, { id: "retention.clinical-ipd.dghs-om-2014", sourceType: "Office memorandum", instrument: OM_2014, provision: "in-patient records kept digitised for at least ten years",
      years: 10, from: "last-encounter", evidence: [OM_URL], note: OM_NOTE }),
  ]),
  "clinical-opd": Object.freeze([
    layer(POLICY, { id: "retention.clinical-opd.dghs-om-2014", sourceType: "Office memorandum", instrument: OM_2014, provision: "OPD records (hard copy) three years", years: 3, from: "last-encounter", evidence: [OM_URL], note: OM_NOTE }),
    layer(POLICY, { id: "retention.clinical-opd.wardsynq-default", sourceType: "Hospital policy", instrument: "WardSynQ safest default (legal opinion of 17 Sep 2026, H.4.2)", provision: "electronic OPD records ten years after the last encounter",
      years: 10, from: "last-encounter", replacedBySetting: true,
      note: "No statutory period for out-patient records identified: IMC reg 1.3.1 covers indoor patients, the Clinical Establishments (Central Government) Rules 2012 r.9(iv) set no period, and State clinical establishment Acts were not researched." }),
  ]),
  mlc: Object.freeze([
    layer(POLICY, { id: "retention.mlc.dghs-om-2014", sourceType: "Office memorandum", instrument: OM_2014, provision: "Medico Legal Registers and case sheets ten years or till the disposal of ongoing cases in any of the courts",
      years: 10, from: "event", evidence: [OM_URL],
      note: OM_NOTE + " No national statutory MLC form or period was found; a State medico-legal manual may set one (not researched). An open matter is kept by the automatic legal hold (DPDP Act s.17(1)(a), (c))." }),
  ]),
  pcpndt: Object.freeze([
    layer(LEGAL, { id: "retention.pcpndt.rules-1996-r9-6", sourceType: "Rule", instrument: "Pre-Conception and Pre-Natal Diagnostic Techniques (Prohibition of Sex Selection) Rules 1996", provision: "r.9(6); Act 1994 s.29",
      years: 2, from: "event", evidence: ["https://indiankanoon.org/doc/195755613/"],
      note: "Two years from completion of the procedure, or till the final disposal of legal proceedings, whichever is later: case records, consent forms, laboratory results, sonographic plates or slides, recommendations and letters." }),
  ]),
  mtp: Object.freeze([
    layer(LEGAL, { id: "retention.mtp.regulations-2003-reg-5", sourceType: "Regulation", instrument: "Medical Termination of Pregnancy Regulations 2003 (G.S.R. 486(E))", provision: "reg 5 (Admission Register, Form III)",
      years: 5, from: "year-end-or-last-entry", evidence: ["https://indiankanoon.org/doc/8267811/"],
      note: "Five years from the end of the calendar year the entry relates to; the Form III heading says from the last entry. The later date is used." }),
  ]),
  ndps: Object.freeze([
    layer(LEGAL, { id: "retention.ndps.rules-1985-r52x", sourceType: "Rule", instrument: "Narcotic Drugs and Psychotropic Substances Rules 1985", provision: "r.52X; r.52R(1)(b), (c)",
      years: 2, from: "event", evidence: ["https://indiankanoon.org/doc/184182041/"], note: "Two years from the date of the last entry (Forms 3E, 3H, 3-I)." }),
  ]),
  h1: Object.freeze([
    layer(LEGAL, { id: "retention.h1.dc-rules-r65-3-1-h", sourceType: "Rule", instrument: DC_RULES, provision: "r.65(3)(1)(h), as substituted by G.S.R. 588(E), 30 Aug 2013", years: 3, from: "event", evidence: [DC_URL] }),
  ]),
  "schedule-x": Object.freeze([
    layer(LEGAL, { id: "retention.schedule-x.dc-rules-r65-7", sourceType: "Rule", instrument: DC_RULES, provision: "r.65(7); r.65(9)(a)", years: 2, from: "event", evidence: [DC_URL], note: "Two years from the last entry; duplicate prescriptions two years." }),
  ]),
  "blood-centre": Object.freeze([
    layer(LEGAL, { id: "retention.blood-centre.dc-rules-sch-f-xii-b-l", sourceType: "Rule", instrument: DC_RULES, provision: "Schedule F Part XII-B heading L NOTE; r.122-P(i)(c)", years: 5, from: "event", evidence: [DC_URL] }),
  ]),
  art: Object.freeze([
    layer(LEGAL, { id: "retention.art.act-2021-s23", sourceType: "Act", instrument: "Assisted Reproductive Technology (Regulation) Act 2021", provision: "s.23(c), (d)", years: 10, from: "event",
      evidence: ["https://prsindia.org/files/bills_acts/acts_parliament/2021/The%20Assisted%20Reproductive%20Technology%20(Regulation)%20Act,%202021.pdf"], note: "At least ten years, then transferred to the National Registry; kept until proceedings end." }),
  ]),
  surrogacy: Object.freeze([
    layer(LEGAL, { id: "retention.surrogacy.act-2021-s46-1", sourceType: "Act", instrument: "Surrogacy (Regulation) Act 2021", provision: "s.46(1)", years: 25, from: "event",
      evidence: ["https://prsindia.org/files/bills_acts/acts_parliament/2021/The%20Surrogacy%20(Regulation)%20Act,%202021.pdf"], note: "Twenty-five years; kept until proceedings end." }),
  ]),
  "audit-log": Object.freeze([
    layer(LEGAL, { id: "retention.audit-log.cert-in-2022-iv", sourceType: "Direction under an Act", instrument: "CERT-In Directions No. 20(3)/2022-CERT-In, 28 Apr 2022 (IT Act 2000 s.70B)", provision: "direction (iv)",
      days: 180, from: "event", evidence: ["https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf"],
      note: "Logs of all ICT systems for a rolling 180 days, within India. The enabling section is taken from the Directions' own title; the opinion did not re-read the Act." }),
    layer(LEGAL, { id: "retention.audit-log.dpdp-rules-2025-r6-r8", sourceType: "Rule", instrument: "Digital Personal Data Protection Rules 2025 (G.S.R. 846(E))", provision: "r.6(1)(e); r.8(3)",
      years: 1, from: "event", effectiveFrom: DPDP_START, evidence: ["https://egazette.gov.in/WriteReadData/2025/267650.pdf"], note: "Logs of processing kept at least one year, from DPDP commencement." }),
  ]),
  "consent-artefacts": Object.freeze([
    layer(POLICY, { id: "retention.consent-artefacts.life-of-record", sourceType: "Guideline", instrument: "Legal opinion of 17 Sep 2026, H.4.1", provision: "kept for the life of the record it relates to", from: "related-record",
      note: "No period of its own identified: SPDI Rules 2011 r.5(1) requires written consent but sets no retention period. A consent form inside a statutory record (PCPNDT r.9(6)) is kept under that record's class." }),
  ]),
});
const basisText = (l) => `${l.instrument}, ${l.provision}`;

/* H.4.1. floorYears is the shortest a hospital setting may make a class. It is never below the class's
 * LEGAL_OBLIGATION floor (legalFloorYears), and a policy default is not shortened through settings either (unchanged
 * by the basis work). defaultYears is used with no setting (H.4.2). `from` is what the period counts from.
 * untilProceedingsEnd: kept past the date while a case is open, which is what a legal hold does. policyOnly: no
 * statutory provision identified for the class. rule: every layer in words, for the screens and the stored answer. */
const CLASSES = Object.freeze(Object.fromEntries(Object.entries({
  "clinical-ipd": { floorYears: 10, defaultYears: 10, from: "last-encounter", minorRule: true },
  "clinical-opd": { floorYears: 3, defaultYears: 10, from: "last-encounter", minorRule: true },
  mlc: { floorYears: 10, defaultYears: 10, from: "event", untilProceedingsEnd: true, register: "mlc" },
  pcpndt: { floorYears: 2, defaultYears: 2, from: "event", untilProceedingsEnd: true, register: "formf" },
  mtp: { floorYears: 5, defaultYears: 5, from: "year-end-or-last-entry", register: "mtp" },
  ndps: { floorYears: 2, defaultYears: 2, from: "event" },
  h1: { floorYears: 3, defaultYears: 3, from: "event" },
  "schedule-x": { floorYears: 2, defaultYears: 2, from: "event" },
  "blood-centre": { floorYears: 5, defaultYears: 5, from: "event" },
  art: { floorYears: 10, defaultYears: 10, from: "event", untilProceedingsEnd: true },
  surrogacy: { floorYears: 25, defaultYears: 25, from: "event", untilProceedingsEnd: true },
  "audit-log": { floorYears: 1, defaultYears: 1, from: "event" },
  "consent-artefacts": { floorYears: null, defaultYears: null, from: "related-record" },
}).map(([k, c]) => {
  const legal = BASES[k].filter((l) => l.type === LEGAL && l.years != null);
  return [k, Object.freeze({ ...c, bases: BASES[k], legalFloorYears: legal.length ? Math.max(...legal.map((l) => l.years)) : null,
    policyOnly: !BASES[k].some((l) => l.type === LEGAL), rule: BASES[k].map((l) => `${basisText(l)} (${l.type})`).join("; ") })];
})));
/* H.4.2: a minor's clinical record is kept until the later of the class period and three years after turning 18.
 * The limitation basis (Limitation Act 1963 s.6) is UNCONFIRMED in the opinion, so the hospital may change it. */
const MINOR_YEARS_AFTER_18 = 3;
const HOLD_REASONS = Object.freeze(["mlc", "court-case", "consumer-complaint", "pocso", "pcpndt-proceedings", "mtp-proceedings", "police-request"]);
const OPD_CLASSES = new Set(["OPD", "VIRTUAL"]);

/** PURE. A class's layers in use. The hospital's own setting is a RETENTION_POLICY layer; it replaces WardSynQ's
 * default where that default is only a setting, and sits beside a statutory or guideline layer otherwise. */
function layersOf(key, c, years, source) {
  if (source !== "hospital") return c.bases;
  return [...c.bases.filter((l) => !l.replacedBySetting), layer(POLICY, { id: `retention.${key}.hospital-setting`, sourceType: "Hospital policy",
    instrument: "This hospital's retention setting (wardsynq.retention.years)", provision: `${years} years`, years, from: c.from })];
}

/** PURE. The periods in use: the hospital's longer years where set, never below the setting minimum (and so never below
 * a LEGAL_OBLIGATION floor). */
function classesOf(cfg) {
  const set = (cfg && cfg.years) || {};
  const out = {};
  for (const [k, c] of Object.entries(CLASSES)) {
    const n = Number(set[k]);
    const valid = c.floorYears != null && Number.isInteger(n) && n > 0 && n <= 100;
    const years = c.defaultYears == null ? null : valid ? Math.max(n, c.floorYears) : c.defaultYears;
    const source = valid && n >= c.floorYears ? "hospital" : valid ? "floor" : "default";
    out[k] = { key: k, ...c, years, source, layers: layersOf(k, c, years, source) };
  }
  const m = Number(cfg && cfg.minorYearsAfter18);
  return { classes: out, minorYearsAfter18: Number.isInteger(m) && m >= MINOR_YEARS_AFTER_18 && m <= 30 ? m : MINOR_YEARS_AFTER_18 };
}

const addYears = (ms, y) => { const d = new Date(ms); d.setUTCFullYear(d.getUTCFullYear() + y); return d.getTime(); };
const msOf = (v) => { const t = Date.parse(str(v)); return Number.isFinite(t) ? t : null; };
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

/** PURE. Each layer with the date it ends for this patient (anchorOf(from) gives the start), and the latest end of the
 * LEGAL_OBLIGATION layers in force and of the RETENTION_POLICY layers. A layer not yet in force (DPDP Rules logs before
 * commencement) keeps nothing. basisType: what keeps the class today; null when no period is running. */
function dated(layers, anchorOf, keepUntil, nowMs) {
  const bases = layers.map((l) => {
    const a = anchorOf(l.from);
    const until = a == null ? null : l.days != null ? a + l.days * DAY : l.years != null ? addYears(a, l.years) : null;
    return { ...l, until: iso(until), inForce: !l.effectiveFrom || nowMs >= dayMs(l.effectiveFrom) };
  });
  const latest = (type) => { const t = bases.filter((b) => b.type === type && b.inForce && b.until).map((b) => Date.parse(b.until)); return t.length ? Math.max(...t) : null; };
  const legalUntil = latest(LEGAL), policyUntil = latest(POLICY), keep = msOf(keepUntil);
  const basisType = legalUntil != null && legalUntil > nowMs ? LEGAL : keep == null || keep > nowMs ? POLICY : null;
  return { bases, legalUntil: iso(legalUntil), policyUntil: iso(policyUntil), basisType, policyOnly: !bases.some((b) => b.type === LEGAL) };
}

/**
 * PURE. Every class this patient has records in, the rule, the layers and the date it ends.
 * facts: { patient, encounters, registers: { mlc, formf, mtp }, documents, consents }  cfg: wardsynq.retention
 */
function retentionMap(facts, cfg, nowMs) {
  const { classes, minorYearsAfter18 } = classesOf(cfg);
  const out = [];
  const dob = facts.patient && facts.patient.dob;
  const minorEnd = (() => { const b = msOf(dob); return b == null ? null : addYears(b, MAJORITY_YEARS + minorYearsAfter18); })();
  const clinical = (key, list) => {
    if (!list.length) return;
    const c = classes[key];
    const open = list.some((e) => !msOf(e.periodEnd) && e.status !== "cancelled" && e.status !== "finished");
    const last = Math.max(...list.map((e) => msOf(e.periodEnd) || msOf(e.periodStart) || 0));
    /* IMC reg 1.3.1 counts from the commencement of treatment: the latest stay's start. A stay still open counts from
     * today, as the policy period does. */
    const started = Math.max(...list.map((e) => msOf(e.periodStart) || msOf(e.periodEnd) || 0));
    let until = addYears(open ? nowMs : last, c.years);
    const minor = ageAt(dob, last) != null && ageAt(dob, last) < MAJORITY_YEARS;
    if (minor && minorEnd != null && minorEnd > until) until = minorEnd;
    /* H.4.2: the child rule rests on a limitation basis the opinion marks UNCONFIRMED, so it is policy, not law. */
    const layers = minor ? [...c.layers, layer(POLICY, { id: "retention.minor.after-18", sourceType: "Hospital policy", instrument: "Legal opinion of 17 Sep 2026, H.4.2 (Limitation Act 1963 s.6 basis unconfirmed)",
      provision: `a child's record until ${minorYearsAfter18} years after turning 18`, years: minorYearsAfter18, from: "age-18" })] : c.layers;
    const anchorOf = (from) => (from === "start-of-treatment" ? (open ? nowMs : started) : from === "age-18" ? (msOf(dob) == null ? null : addYears(msOf(dob), MAJORITY_YEARS)) : open ? nowMs : last);
    out.push({ class: key, rule: c.rule, years: c.years, source: c.source, records: list.length, lastAt: iso(last), keepUntil: iso(until), stillOpen: open, minorRule: minor ? minorYearsAfter18 : null,
      ...dated(layers, anchorOf, iso(until), nowMs) });
  };
  const enc = (facts.encounters || []).filter((e) => e && e.status !== "cancelled" && e.status !== "entered-in-error");
  clinical("clinical-ipd", enc.filter((e) => !OPD_CLASSES.has(e.class)));
  clinical("clinical-opd", enc.filter((e) => OPD_CLASSES.has(e.class)));
  for (const key of ["mlc", "pcpndt", "mtp"]) {
    const c = classes[key], rows = ((facts.registers || {})[c.register] || []).filter((e) => e && !(e.fields && e.fields.status === "withdrawn"));
    if (!rows.length) continue;
    const last = Math.max(...rows.map((e) => msOf(e.eventDate) || msOf(e.recordedAt) || 0));
    const start = c.from === "year-end-or-last-entry" ? Math.max(last, Date.UTC(new Date(last).getUTCFullYear() + 1, 0, 1)) : last;
    const keepUntil = iso(addYears(start, c.years));
    out.push({ class: key, rule: c.rule, years: c.years, source: c.source, records: rows.length, lastAt: iso(last), keepUntil, untilProceedingsEnd: !!c.untilProceedingsEnd,
      ...dated(c.layers, () => start, keepUntil, nowMs) });
  }
  const docs = (facts.documents || []).filter((d) => d && d.status !== "purged");
  if (docs.length || (facts.consents || []).length) {
    const clin = out.filter((x) => x.class === "clinical-ipd" || x.class === "clinical-opd").map((x) => msOf(x.keepUntil));
    const docUntil = Math.max(0, ...docs.map((d) => msOf(d.retainUntil) || 0), ...clin);
    const c = classes["consent-artefacts"], keepUntil = docUntil ? iso(docUntil) : null;
    out.push({ class: "consent-artefacts", rule: c.rule, years: null, source: "default", records: docs.length + (facts.consents || []).length, keepUntil,
      ...dated(c.layers, () => null, keepUntil, nowMs) });
  }
  return out;
}

/** PURE. The erasure answer for one retained class, in words, never calling a policy a legal requirement. */
function retentionAnswer(x) {
  const day = (v) => (v ? String(v).slice(0, 10) : "the life of the record it belongs to");
  const legal = (x.bases || []).filter((b) => b.type === LEGAL && b.inForce && b.until && b.until === x.legalUntil);
  const policy = (x.bases || []).filter((b) => b.type === POLICY);
  if (x.basisType === LEGAL) return `Kept until ${day(x.legalUntil)} because the law requires it: ${legal.map(basisText).join("; ")}.` +
    (x.keepUntil && x.keepUntil > x.legalUntil ? ` After that, kept until ${day(x.keepUntil)} under the hospital's retention policy (${policy.map(basisText).join("; ")}), which is not a legal requirement.` : "");
  if (x.basisType === POLICY) return `Kept until ${day(x.keepUntil)} under the hospital's retention policy (${policy.map(basisText).join("; ")}). This is not a legal requirement.`;
  return "No retention period is running for this record.";
}

/** PURE. Holds in force: the placed ones not lifted, and one per medico-legal case entry unless a lift is recorded. */
function activeHolds(placed, mlcEntries) {
  const rows = (placed || []).filter(Boolean);
  const byId = new Map(rows.map((h) => [h.id, h]));
  const holds = rows.filter((h) => h.state === "active").map((h) => ({ id: h.id, reason: h.reason, reference: h.reference, placedBy: h.placedBy, placedAt: h.placedAt, auto: false }));
  for (const e of mlcEntries || []) {
    if (!e || (e.fields && e.fields.status === "withdrawn")) continue;
    const id = autoHoldId(e.id), lifted = byId.get(id);
    if (lifted && lifted.state === "lifted") continue;
    holds.push({ id, reason: "mlc", reference: e.serial || e.id, placedBy: "medico-legal case register", placedAt: e.recordedAt || null, auto: true, entryId: e.id });
  }
  return holds;
}
const autoHoldId = (entryId) => `wsq-hold-auto-mlc-${str(entryId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/**
 * Reads what retention and holds are worked out from. Any read that fails throws: a caller refuses rather than erase
 * or destroy on a picture it could not complete.
 */
async function retentionFacts(svc, repo, tenantId, patientId) {
  const [patient, encounters, placed, documents, consents, mlc, formf, mtp] = await Promise.all([
    svc.get("Patient", patientId), svc.byPatient("Encounter", patientId), svc.byPatient(HOLD, patientId),
    svc.byPatient("DocumentReference", patientId), svc.byPatient("PatientConsent", patientId),
    repo.byPatient(tenantId, REGISTER_PREFIX + "mlc", patientId), repo.byPatient(tenantId, REGISTER_PREFIX + "formf", patientId), repo.byPatient(tenantId, REGISTER_PREFIX + "mtp", patientId),
  ]);
  return { patient, encounters: encounters || [], placed: placed || [], documents: documents || [], consents: consents || [], registers: { mlc: mlc || [], formf: formf || [], mtp: mtp || [] } };
}

/** PURE. The whole answer for one patient. A deceased patient's record is marked inactive three years after death and never
 * destroyed for that reason (MoHFW EHR Standards for India 2016, p.40; opinion H.4.8); the class rules still apply. */
function retentionView(facts, cfg, nowMs) {
  const died = msOf(facts.patient && facts.patient.deceased && facts.patient.deceased.at);
  return {
    retained: retentionMap(facts, cfg, nowMs), holds: activeHolds(facts.placed, facts.registers.mlc), classes: Object.values(classesOf(cfg).classes),
    deceased: died == null ? null : { at: iso(died), inactiveFrom: iso(addYears(died, 3)), inactive: nowMs >= addYears(died, 3), rule: "EHR Standards for India 2016: records inactive three years after death, never destroyed for that reason" },
  };
}

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    return { resolved, svc: new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source }) };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}
const baseOf = (ctx) => ({ mode: ctx.migration && ctx.migration.mode, tenantId: (ctx.migration && ctx.migration.tenantId) || null });
const off = (ctx) => !ctx.migration || ctx.migration.mode === "off";
function failure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: (e.reasons || []).map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}

/** ctx: { migration, patientId, retention, actorDeps, recordDeps } - GET /ward/retention */
async function patientRetention(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", retained: [], holds: [] };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", retained: null, holds: null };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, retained: null, holds: null };
  try {
    const facts = await retentionFacts(svc, ctx.recordDeps.repository, ctx.migration.tenantId, patientId);
    if (!facts.patient) return { ...base, ok: false, status: 404, error: "patient_not_found", retained: null, holds: null };
    return { ...base, ok: true, patientId, ...retentionView(facts, ctx.retention, Date.now()), minorYearsAfter18: classesOf(ctx.retention).minorYearsAfter18 };
  } catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", retained: null, holds: null }; }
}

/** ctx: { migration, retention, dpdp, actorDeps, recordDeps } - GET /ward/retention-classes: every class with its layers,
 * whatever patient is looked up, and whether DPDP applies today (which decides what a policy layer does to erasure). */
async function retentionClassList(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", classes: [] };
  const { error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, classes: null };
  const { classes, minorYearsAfter18 } = classesOf(ctx.retention);
  return { ...base, ok: true, classes: Object.values(classes).map(({ bases, ...c }) => c), minorYearsAfter18, law: lawOn(ctx.dpdp, Date.now()) };
}

/** ctx: { migration, patientId, reason, reference, actorDeps, recordDeps } - POST /ward/legal-hold */
async function placeLegalHold(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const patientId = str(ctx.patientId), reason = str(ctx.reason), reference = str(ctx.reference).slice(0, 300);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };
  if (!HOLD_REASONS.includes(reason)) return { ...base, ok: false, status: 422, error: "reason_invalid", detail: `reason must be one of ${HOLD_REASONS.join(", ")}`, written: 0 };
  if (reference.length < 3) return { ...base, ok: false, status: 422, error: "reference_required", detail: "the case, complaint or request reference", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const at = new Date().toISOString();
  const rec = { resourceType: HOLD, id: `wsq-hold-${patientId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${at.replace(/[^0-9]/g, "").slice(0, 17)}`, patientId, reason, reference,
    state: "active", placedBy: resolved.actor.id, placedAt: at, source: { system: "wardsynq-native", sourceId: `legal-hold:${patientId}` } };
  try {
    if (!(await svc.get("Patient", patientId))) return { ...base, ok: false, status: 404, error: "patient_not_found", written: 0 };
    const out = await svc.put(rec, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, hold: { ...rec, version: out.record.version } };
  } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
}

/** ctx: { migration, holdId, patientId, liftReference, actorDeps, recordDeps } - POST /ward/legal-hold-lift (records officer) */
async function liftLegalHold(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const holdId = str(ctx.holdId), patientId = str(ctx.patientId), liftReference = str(ctx.liftReference).slice(0, 300);
  if (liftReference.length < 5) return { ...base, ok: false, status: 422, error: "disposal_reference_required", detail: "the reference to the disposal of the matter (judgment, closure order, withdrawal letter)", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const at = new Date().toISOString(), by = resolved.actor.id;
  try {
    const current = await svc.get(HOLD, holdId);
    if (current) {
      if (current.state !== "active") return { ...base, ok: false, status: 409, error: "already_lifted", written: 0 };
      const { meta, version, ...rest } = current;
      const out = await svc.put({ ...rest, state: "lifted", liftedBy: by, liftedAt: at, liftReference }, { expectedVersion: version });
      return { ...base, ok: true, written: 1, hold: { ...rest, state: "lifted", liftedBy: by, liftedAt: at, liftReference, version: out.record.version } };
    }
    /* An automatic hold is a medico-legal case entry for this patient; lifting it is recorded as its own LegalHold. */
    if (!patientId) return { ...base, ok: false, status: 404, error: "hold_not_found", written: 0 };
    const mlc = await ctx.recordDeps.repository.byPatient(ctx.migration.tenantId, REGISTER_PREFIX + "mlc", patientId);
    const entry = (mlc || []).find((e) => e && autoHoldId(e.id) === holdId && !(e.fields && e.fields.status === "withdrawn"));
    if (!entry) return { ...base, ok: false, status: 404, error: "hold_not_found", written: 0 };
    const rec = { resourceType: HOLD, id: holdId, patientId, reason: "mlc", reference: entry.serial || entry.id, auto: true, state: "lifted",
      placedBy: "medico-legal case register", placedAt: entry.recordedAt || null, liftedBy: by, liftedAt: at, liftReference, source: { system: "wardsynq-native", sourceId: `legal-hold:${patientId}` } };
    const out = await svc.put(rec, {});
    return { ...base, ok: true, written: 1, hold: { ...rec, version: out.record.version } };
  } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
}

export {
  HOLD, CLASSES, BASES, LEGAL, POLICY, HOLD_REASONS, MINOR_YEARS_AFTER_18, classesOf, retentionMap, retentionAnswer, activeHolds, autoHoldId, retentionFacts, retentionView,
  patientRetention, retentionClassList, placeLegalHold, liftLegalHold,
};
