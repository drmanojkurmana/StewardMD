/* functions/_wardsynq/register-settings.js - the hospital-editable settings of the statutory registers, and the clocks
 * the registers show (due, overdue, renewal). PURE: no store, no clock of its own (every function takes `now`).
 *
 * WHY SETTINGS. The legal review of the registers (2026-09-17, a legal-research opinion, not legal advice; the items it
 * lists for a practising lawyer are still open) marks several points unsettled: who receives MTP Form II and by when,
 * whether a state mandates online Form F, which state medico-legal format applies, which RBD model rules a state has
 * notified. For each the safest default is set here and the hospital may change it on the Registers screen (Settings
 * tab, staff.admin). The screen shows the note beside each setting. Nothing here shortens a statutory period.
 *
 * Stored as wardsynq.registers in the org config (functions/_opd_org.js whitelist).
 */

const str = (v) => (v == null ? "" : String(v).trim());
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;
const isDate = (s) => DATE.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
const addDays = (iso, n) => new Date(Date.parse(str(iso).slice(0, 10) + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY);

/* The notes shown beside a setting whose law is unsettled. English legal text, as the registers' labels are. */
const NOTES = Object.freeze({
  onlineFormF: "No central rule requires online Form F; some states do (MoHFW SOP for District Appropriate Authorities, 2016). Which states is not confirmed: ask your District Appropriate Authority. When mandatory, a Form F is not complete without the portal reference, and the signed paper copy is still kept.",
  formGVersion: "MoHFW circulated a draft revised Form G in 2024; whether it was notified is not confirmed, so the 1996 Form G stays until it is.",
  formIIRecipient: "MTP Regulations 2003 reg 4(5) says the Chief Medical Officer \"of the State\", but reg 2(c) defines the Chief Medical Officer as the one \"of a District\". The recipient is unsettled; District is the default. Confirm with your district office.",
  formIIDueDay: "No due date for Form II is prescribed. The 7th of the following month is hospital policy.",
  formIIOver20Annex: "The 2003 Form II has no column for terminations over 20 weeks (lawful since the MTP Amendment Act 2021). With this on they are counted in a separately labelled annex, never as a column of the form.",
  medleapr: "MedLEaPR (NIC) is adopted by many states for government hospitals; whether a private hospital must use it is not confirmed and varies by state.",
  intimationCategories: "Which injuries a state medico-legal manual treats as medico-legal cases varies. By default every category is intimated to the police.",
  rbdFormVersion: "The Model RBD (Amendment) Rules 2024 are an ORGI template each state must notify. Use model-1999 only if your state has not notified the 2024 forms.",
  requireIcd10: "Form No. 4 has no ICD-10 field; the statistical office codes the cause. An ICD-10 code here is the hospital's own coding.",
  requireWitness: "No NDPS rule requires a second-person witness or a shift count (Chapter VB read in full). They are this hospital's policy.",
  rmi: "NDPS Rules r.52-O: recognition (Form 3G) is valid for up to three years; apply for renewal at least sixty days before expiry. r.52Q: tell the Controller of Drugs of a change of designated doctor within seven days. r.52R(2): a change in constitution within thirty days.",
  stateFormat: "No national statutory medico-legal register form exists. A state format adds that state's fields and export; Kerala follows the Kerala DHS Medico-legal Register and Accident Register cum Wound Certificate. Which format your state requires is for your state medico-legal manual.",
  restrictedReaders: "Sexual offence and POCSO cases are opened only by the medical records keepers, the doctors who recorded the case, the doctor the stay is admitted under, and the people named here (BNS s.72, POCSO Act s.23). Every opening is audited.",
  drugRegimes: "Which law a drug's records follow. Default for the controlled-drug list: essential narcotic drug under NDPS Rules Chapter VB (Forms 3E, 3H, 3J, 3-I). State rules for other narcotics were not researched, so those keep the Form 3H and 3E discipline. Schedule X and H1 drugs get the Drugs and Cosmetics Rules r.65 registers.",
  rule65InpatientRegisters: "Whether rule 65 (Schedule X and H1 registers) applies to in-patient supply by a private hospital pharmacy is not confirmed. By default every supply, in-patient included, is on the register.",
  scheduleXLocations: "Drugs and Cosmetics Rules r.65(12): Schedule X stock is kept under lock and key. Name the store locations that are; a Schedule X receipt anywhere else is flagged on the register.",
});

/* NDPS Rules Chapter VB (essential narcotic drugs), a state's NDPS rules for other narcotics, NDPS Rules Chapter VII
 * (psychotropic substances, r.66(3) proper accounts), and the Drugs and Cosmetics Rules r.65 Schedule X and H1 registers. */
const REGIMES = ["end-chapter-vb", "state-ndps", "psychotropic", "schedule-x", "schedule-h1"];

const MLC_CATEGORY_KEYS = ["sexual-assault-adult", "acid-attack", "pocso", "rta", "death-in-custody", "death-woman-married-under-7-years", "bnss33-offence",
  "assault", "burns", "poisoning", "suspected-suicide", "fall-industrial", "animal-bite", "brought-dead", "unknown-unconscious", "other"];

/** PURE. The settings with every default filled in. */
function registerSettings(wardsynqCfg) {
  const r = (wardsynqCfg && typeof wardsynqCfg === "object" && wardsynqCfg.registers && typeof wardsynqCfg.registers === "object") ? wardsynqCfg.registers : {};
  const o = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
  const arr = (x) => (Array.isArray(x) ? x.filter((y) => y && typeof y === "object") : []);
  const p = o(r.pcpndt), portal = o(p.onlinePortal), centre = o(p.centre), m = o(r.mtp), l = o(r.mlc), b = o(r.rbd), c = o(r.mccd), n = o(r.ndps), rmi = o(n.rmi);
  return {
    pcpndt: {
      onlinePortal: { state: str(portal.state), url: str(portal.url), mandatory: portal.mandatory === true },
      formGVersion: str(p.formGVersion) === "2024" ? "2024" : "1996",
      centre: {
        formBNumber: str(centre.formBNumber), formBValidUntil: isDate(str(centre.formBValidUntil)) ? str(centre.formBValidUntil) : "",
        machines: arr(centre.machines).map((x) => ({ make: str(x.make), model: str(x.model), serial: str(x.serial) })),
        r17NoticeDisplayed: centre.r17NoticeDisplayed === true, actAndRulesOnPremises: centre.actAndRulesOnPremises === true,
        plannedChanges: arr(centre.plannedChanges).map((x) => ({ what: str(x.what), effectiveOn: str(x.effectiveOn), intimatedOn: str(x.intimatedOn) })),
      },
    },
    mtp: {
      formIIRecipient: str(m.formIIRecipient) === "state" ? "state" : "district",
      formIIDueDay: Number.isInteger(m.formIIDueDay) && m.formIIDueDay >= 1 && m.formIIDueDay <= 28 ? m.formIIDueDay : 7,
      formIIOver20Annex: m.formIIOver20Annex !== false,
    },
    mlc: {
      medleapr: { enabled: !!(l.medleapr && l.medleapr.enabled === true), state: str(l.medleapr && l.medleapr.state) },
      intimationCategories: Array.isArray(l.intimationCategories) ? l.intimationCategories.map(str).filter((k) => MLC_CATEGORY_KEYS.includes(k)) : MLC_CATEGORY_KEYS.slice(),
      goodSamaritanCharterDisplayed: l.goodSamaritanCharterDisplayed === true,
      stateFormat: str(l.stateFormat) === "kerala" ? "kerala" : "hospital",
      restrictedReaders: Array.isArray(l.restrictedReaders) ? [...new Set(l.restrictedReaders.map((x) => str(x).toLowerCase()).filter(Boolean))].slice(0, 50) : [],
    },
    rbd: {
      formVersion: str(b.formVersion) === "model-1999" ? "model-1999" : "model-2024",
      informantAuthorisations: arr(b.informantAuthorisations).map((x) => ({ name: str(x.name), authorisedBy: str(x.authorisedBy), from: str(x.from) })),
    },
    mccd: { requireIcd10: c.requireIcd10 === true },
    ndps: {
      requireWitness: n.requireWitness !== false,
      drugRegimes: arr(n.drugRegimes).map((x) => ({ drug: str(x.drug), regime: REGIMES.includes(str(x.regime)) ? str(x.regime) : "" })).filter((x) => x.drug),
      rule65InpatientRegisters: n.rule65InpatientRegisters !== false,
      scheduleXLocations: Array.isArray(n.scheduleXLocations) ? [...new Set(n.scheduleXLocations.map(str).filter(Boolean))].slice(0, 50) : [],
      rmi: {
        form3gNumber: str(rmi.form3gNumber), issuedOn: str(rmi.issuedOn), expiresOn: str(rmi.expiresOn), renewalApplicationRef: str(rmi.renewalApplicationRef),
        designatedDoctors: arr(rmi.designatedDoctors).map((x) => ({ name: str(x.name), registrationNo: str(x.registrationNo), overallInCharge: x.overallInCharge === true, from: str(x.from) })),
        changes: arr(rmi.changes).map((x) => ({ kind: str(x.kind) === "constitution" ? "constitution" : "designated-doctor", changedOn: str(x.changedOn), intimatedOn: str(x.intimatedOn) })),
      },
    },
  };
}

/** PURE. Validates a whole settings object from the screen. Returns { value, problems }; any problem means nothing saved. */
function validateRegisterSettings(input) {
  const problems = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { value: null, problems: ["settings: send the register settings as an object"] };
  const v = registerSettings({ registers: input });
  const dates = [["pcpndt.centre.formBValidUntil", input.pcpndt && input.pcpndt.centre && input.pcpndt.centre.formBValidUntil]];
  for (const x of v.pcpndt.centre.plannedChanges) dates.push(["pcpndt.centre.plannedChanges.effectiveOn", x.effectiveOn], ["pcpndt.centre.plannedChanges.intimatedOn", x.intimatedOn]);
  for (const x of v.rbd.informantAuthorisations) dates.push(["rbd.informantAuthorisations.from", x.from]);
  const rmi = v.ndps.rmi;
  dates.push(["ndps.rmi.issuedOn", rmi.issuedOn], ["ndps.rmi.expiresOn", rmi.expiresOn]);
  for (const x of rmi.changes) dates.push(["ndps.rmi.changes.changedOn", x.changedOn], ["ndps.rmi.changes.intimatedOn", x.intimatedOn]);
  for (const [k, d] of dates) if (str(d) && !isDate(str(d))) problems.push(`${k}: a date as YYYY-MM-DD`);
  if (rmi.issuedOn && rmi.expiresOn && isDate(rmi.issuedOn) && isDate(rmi.expiresOn)) {
    if (rmi.expiresOn <= rmi.issuedOn) problems.push("ndps.rmi.expiresOn: after the issue date");
    else if (rmi.expiresOn > addDays(rmi.issuedOn, 3 * 366)) problems.push("ndps.rmi.expiresOn: a Form 3G certificate is valid for not more than three years (NDPS Rules r.52-O)");
  }
  const nd = input.ndps && typeof input.ndps === "object" ? input.ndps : {};
  for (const x of Array.isArray(nd.drugRegimes) ? nd.drugRegimes : []) if (x && str(x.drug) && !REGIMES.includes(str(x.regime))) problems.push(`ndps.drugRegimes: ${str(x.regime) || "(blank)"} is not a regime (${str(x.drug)})`);
  if (input.mlc && str(input.mlc.stateFormat) && !["hospital", "kerala"].includes(str(input.mlc.stateFormat))) problems.push("mlc.stateFormat: hospital or kerala");
  if (rmi.designatedDoctors.filter((d) => d.overallInCharge).length > 1) problems.push("ndps.rmi.designatedDoctors: one over-all in-charge (NDPS Rules r.52Q)");
  if (v.pcpndt.onlinePortal.mandatory && !v.pcpndt.onlinePortal.state) problems.push("pcpndt.onlinePortal.state: name the state whose portal is mandatory");
  const m = input.mtp || {};
  if (m.formIIDueDay !== undefined && !(Number.isInteger(m.formIIDueDay) && m.formIIDueDay >= 1 && m.formIIDueDay <= 28)) problems.push("mtp.formIIDueDay: a day of the month from 1 to 28");
  const l = input.mlc || {};
  if (Array.isArray(l.intimationCategories)) for (const k of l.intimationCategories) if (!MLC_CATEGORY_KEYS.includes(str(k))) problems.push(`mlc.intimationCategories: ${str(k)} is not a category`);
  for (const [k, list] of [["pcpndt.centre.machines", v.pcpndt.centre.machines], ["pcpndt.centre.plannedChanges", v.pcpndt.centre.plannedChanges], ["rbd.informantAuthorisations", v.rbd.informantAuthorisations], ["ndps.rmi.designatedDoctors", rmi.designatedDoctors], ["ndps.rmi.changes", rmi.changes], ["ndps.drugRegimes", v.ndps.drugRegimes]]) {
    if (list.length > 50) problems.push(`${k}: at most 50 rows`);
  }
  return { value: v, problems };
}

/* ------------------------------------------------------------------------------------------------ clocks, PURE */

/** PURE. A monthly return for period YYYY-MM, due on `dueDay` of the following month. submittedOn: YYYY-MM-DD or empty. */
function monthlyReturnClock(period, dueDay, today, submittedOn, escalateDay) {
  const y = Number(period.slice(0, 4)), mo = Number(period.slice(5, 7));
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  const dueBy = `${next}-${String(dueDay).padStart(2, "0")}`;
  if (str(submittedOn)) return { period, dueBy, state: submittedOn > dueBy ? "submitted-late" : "submitted", submittedOn };
  if (today < `${next}-01`) return { period, dueBy, state: "open" };
  if (today > dueBy) return { period, dueBy, state: "overdue", daysOverdue: daysBetween(dueBy, today) };
  if (escalateDay && today >= `${next}-${String(escalateDay).padStart(2, "0")}`) return { period, dueBy, state: "escalate" };
  return { period, dueBy, state: "due" };
}

/** PURE. PCPNDT Rules r.9(8): the monthly report "by 5th day of the following month"; the imaging in-charge is told on the 3rd. */
const formFMonthlyClock = (period, today, submittedOn) => monthlyReturnClock(period, 5, today, submittedOn, 3);

/** PURE. MTP Form II (reg 4(5)): no prescribed date, so the hospital's day (default the 7th). */
const mtpFormIIClock = (period, settings, today, submittedOn) => monthlyReturnClock(period, (settings && settings.mtp && settings.mtp.formIIDueDay) || 7, today, submittedOn, 0);

/** PURE. RBD Rules r.5(3): reported within 21 days. The screen alerts from day 14; after day 30 a late registration needs
 * the District Registrar's permission and a fee (RBD Act s.13, Rules r.9). */
function rbdClock(eventDate, today, submittedOn) {
  const d = str(eventDate).slice(0, 10);
  if (!isDate(d)) return { state: "no-date" };
  const dueBy = addDays(d, 21), age = daysBetween(d, today);
  if (str(submittedOn)) return { dueBy, state: submittedOn > dueBy ? "submitted-late" : "submitted", submittedOn };
  if (age > 30) return { dueBy, state: "late-permission", days: age };
  if (age > 21) return { dueBy, state: "overdue", days: age };
  if (age >= 14) return { dueBy, state: "alert", days: age };
  return { dueBy, state: "due", days: age };
}

/** PURE. NDPS Rules r.52T: Form 3J estimate for calendar year Y by 30 November of Y-1 (revised by 31 August of Y);
 * r.52R(1)(d): Form 3-I return for year Y by 31 March of Y+1. */
function ndpsAnnualClocks(today, filed) {
  const y = Number(today.slice(0, 4));
  const f = filed || {};
  const one = (what, year, dueBy) => (f[`${what}-${year}`] ? { what, year, dueBy, state: f[`${what}-${year}`] > dueBy ? "submitted-late" : "submitted", submittedOn: f[`${what}-${year}`] }
    : { what, year, dueBy, state: today > dueBy ? "overdue" : daysBetween(today, dueBy) <= 30 ? "due-soon" : "open" });
  return [one("form3j", y + 1, `${y}-11-30`), one("form3i", y - 1, `${y}-03-31`)];
}

/** PURE. The NDPS recognised medical institution profile: renewal alert 60 days before expiry (r.52-O), 7-day and
 * 30-day intimations (r.52Q, r.52R(2)), and whether receipts and dispensing of essential narcotic drugs are blocked. */
function rmiStatus(settings, today) {
  const rmi = (settings && settings.ndps && settings.ndps.rmi) || {};
  const alerts = [];
  if (!rmi.form3gNumber || !isDate(rmi.expiresOn)) return { configured: false, blocked: false, alerts: [{ kind: "rmi-not-recorded" }] };
  const left = daysBetween(today, rmi.expiresOn);
  const expired = left < 0;
  if (expired) alerts.push({ kind: "rmi-expired", expiresOn: rmi.expiresOn, renewalApplicationRef: rmi.renewalApplicationRef || null });
  else if (left <= 60) alerts.push({ kind: "rmi-renewal-due", expiresOn: rmi.expiresOn, renewBy: addDays(rmi.expiresOn, -60), days: left });
  for (const ch of rmi.changes || []) {
    if (ch.intimatedOn || !isDate(ch.changedOn)) continue;
    const dueBy = addDays(ch.changedOn, ch.kind === "constitution" ? 30 : 7);
    alerts.push({ kind: ch.kind === "constitution" ? "rmi-constitution-intimation" : "rmi-doctor-intimation", changedOn: ch.changedOn, dueBy, overdue: today > dueBy });
  }
  if (!(rmi.designatedDoctors || []).some((d) => d.overallInCharge)) alerts.push({ kind: "rmi-no-overall-in-charge" });
  return { configured: true, blocked: expired && !rmi.renewalApplicationRef, expiresOn: rmi.expiresOn, alerts };
}

/** PURE. MTP Regulations 2003 reg 5 (legal review C.4.9): the Admission Register is kept five years "from the end of the
 * calendar year it relates to", while Form III's heading says five years "from the date of the last entry". Unsettled, so
 * the later of the two. After it a custodian may destroy the entry only by hand, with a destruction record; WardSynQ
 * deletes nothing. eventDate: the admission date; lastWritten: the ISO time of the entry's latest version. */
function mtpRetentionEnd(eventDate, lastWritten) {
  const y = Number(str(eventDate).slice(0, 4)) || Number(str(lastWritten).slice(0, 4));
  const yearEnd = y ? `${y + 5}-12-31` : "";
  const last = str(lastWritten).slice(0, 10);
  const fromLast = isDate(last) ? `${Number(last.slice(0, 4)) + 5}${last.slice(4)}` : "";
  return [yearEnd, fromLast].filter(Boolean).sort().pop() || null;
}

/** PURE. NDPS Form 3H: "Entries shall be completed for each day before the close of the day". A day closed after the
 * hospital's local midnight is late; the late closure is recorded as it happened, never back-dated. */
function form3hClosureLate(day, closedAtIso, offsetMinutes) {
  const local = new Date(Date.parse(closedAtIso) + (Number.isFinite(offsetMinutes) ? offsetMinutes : 330) * 60000).toISOString().slice(0, 10);
  return local > str(day);
}

/** PURE. PCPNDT centre panel: Form B renewal (Form A 30 days before expiry, r.8(1)), r.13 changes 30 days in advance,
 * and the r.17 notice and copies of the Act and Rules. */
function pcpndtCentreAlerts(settings, today) {
  const c = (settings && settings.pcpndt && settings.pcpndt.centre) || {};
  const alerts = [];
  if (!c.formBNumber || !c.formBValidUntil) alerts.push({ kind: "formb-not-recorded" });
  else {
    const left = daysBetween(today, c.formBValidUntil);
    if (left < 0) alerts.push({ kind: "formb-expired", validUntil: c.formBValidUntil });
    else if (left <= 30) alerts.push({ kind: "formb-renewal-due", validUntil: c.formBValidUntil, renewBy: addDays(c.formBValidUntil, -30), days: left });
  }
  for (const ch of c.plannedChanges || []) {
    if (ch.intimatedOn || !isDate(ch.effectiveOn)) continue;
    const dueBy = addDays(ch.effectiveOn, -30);
    alerts.push({ kind: "r13-change-intimation", what: ch.what, effectiveOn: ch.effectiveOn, dueBy, overdue: today > dueBy });
  }
  if (!c.r17NoticeDisplayed) alerts.push({ kind: "r17-notice" });
  if (!c.actAndRulesOnPremises) alerts.push({ kind: "r17-copies" });
  return alerts;
}

export { NOTES, REGIMES, MLC_CATEGORY_KEYS, registerSettings, validateRegisterSettings, mtpRetentionEnd, form3hClosureLate, monthlyReturnClock, formFMonthlyClock, mtpFormIIClock, rbdClock, ndpsAnnualClocks, rmiStatus, pcpndtCentreAlerts, addDays, daysBetween };
