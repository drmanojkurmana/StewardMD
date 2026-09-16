/* functions/_wardsynq/notifiable.js - notifiable diseases: IDSP case definitions, prompts, the register and the weekly
 * IHIP export.
 *
 * THE SOURCES, AS READ. IDSP reporting levels and the reporting week: https://ncdc.mohfw.gov.in/includes/About/CentresAndDivision/IDSP.php
 * - S (suspected, syndromic, health workers), P (presumptive, clinical, medical officers), L (laboratory confirmed);
 * data "on weekly basis (Monday-Sunday)". Case definitions: "IDSP Case Definitions 2024" (NCDC with NCVBDC, CAZD,
 * Centre for One Health, Immunization Division MoHFW, WHO India), P form and L form, read from the state NHM mirror
 * https://nhmmizoram.org/upload/IDSP%20P%20form%20Case%20Definitions%202024.pdf and
 * https://nhmmizoram.org/upload/IDSP%20L%20form%20Case%20Definitions%202024.pdf (idsp.mohfw.gov.in refused connection).
 * The definitions below are shortened from that text; the screen links nobody to anything else.
 *
 * IHIP HAS NO PUBLIC API. https://ihip.mohfw.gov.in/ publishes no API or bulk-upload format, and its P/L case-entry
 * field layout is not published either. So: the register keeps what a person needs to key the case into IHIP, the
 * weekly export is a structured file (Monday to Sunday), and submission is MANUAL, recorded by the person who did it
 * (date and IHIP reference). Nothing here ever says a case was sent.
 *
 * PROMPTS ARE SUGGESTIONS. A diagnosis or a positive laboratory result that looks like a listed condition produces a
 * prompt on the chart; a person decides whether the case definition is met. The ICD-10 mapping is a coding
 * convention used to find candidates, not part of the IDSP text.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { f, defineRegister, listEntries, csvFor, REGISTERS } from "./registers.js";

const str = (v) => (v == null ? "" : String(v).trim());

/* key, name, IDSP form(s), presumptive definition (P form 2024), confirmation (L form 2024), ICD-10 prefixes, lab words. */
const CONDITIONS = Object.freeze([
  ["ili", "Influenza-like illness (ILI)", "P", "Acute respiratory infection (cough and sore throat) with measured fever of 38 C or more, onset within the last 10 days.", "", ["J09", "J10", "J11"], ["influenza"]],
  ["sari", "Severe acute respiratory infection (SARI)", "P", "As ILI, and requires hospitalisation.", "", [], []],
  ["add", "Acute diarrhoeal disease (including acute gastroenteritis)", "P", "Passage of 3 or more loose watery stools in the past 24 hours.", "", ["A08", "A09"], []],
  ["cholera", "Cholera", "L", "Presumptive acute diarrhoeal disease.", "Vibrio cholerae identified by culture, or PCR positive.", ["A00"], ["vibrio cholerae", "cholera"]],
  ["dysentery", "Dysentery / Shigellosis", "P,L", "Any diarrhoeal episode with visible blood in the stool.", "Shigella by culture or nucleic acid test.", ["A03", "A06.0"], ["shigella"]],
  ["enteric", "Enteric fever (Typhoid)", "P,L", "Insidious sustained fever with headache, nausea, loss of appetite, abdominal pain, constipation or diarrhoea, splenomegaly or toxic look; or a significant titre in a single Widal/Typhidot test.", "Positive culture from any clinical specimen, or molecular identification of S. Typhi/Paratyphi.", ["A01"], ["salmonella typhi", "s. typhi", "paratyphi", "typhoid"]],
  ["hepatitis", "Acute viral hepatitis (A / E)", "P,L", "Clinical jaundice with malaise, fever or vomiting, and serum bilirubin above 2.5 mg/dl with a more than 10-fold rise in ALT.", "IgM anti-HAV or IgM anti-HEV positive.", ["B15", "B17.2"], ["anti-hav", "anti hav", "anti-hev", "anti hev", "hepatitis a igm", "hepatitis e igm"]],
  ["meningitis", "Meningitis (meningococcal disease)", "P,L", "Sudden fever with neck stiffness and headache, vomiting, altered consciousness, other meningeal signs or petechial rash; under 2 years, fever with a bulging fontanelle.", "CSF antigen (latex agglutination), blood or CSF culture, or validated PCR.", ["A39", "G00", "G03"], ["neisseria meningitidis", "meningococc"]],
  ["diphtheria", "Diphtheria", "P,L", "Laryngitis, nasopharyngitis, pharyngitis or tonsillitis with adherent membranes of tonsils, pharynx and/or nose.", "Culture or PCR.", ["A36"], ["corynebacterium diphtheriae", "diphtheria"]],
  ["pertussis", "Pertussis", "P,L", "Cough of 2 weeks or more (any duration in an infant or outbreak) with paroxysms, inspiratory whoop, post-tussive vomiting, or apnoea in an infant.", "Culture, PCR, or single IgG serology.", ["A37"], ["bordetella pertussis", "pertussis"]],
  ["measles", "Measles", "P,L", "Fever with maculopapular (non-vesicular) rash, or clinician suspicion.", "Confirmatory serology or virology, or direct epidemiological link.", ["B05"], ["measles igm", "measles"]],
  ["rubella", "Rubella", "P,L", "Fever with maculopapular rash, or clinician suspicion.", "Confirmatory serology or virology, or direct epidemiological link.", ["B06"], ["rubella igm"]],
  ["afp", "Acute flaccid paralysis / Polio", "P,L", "Sudden weakness or floppiness of any part of the body in a child under 15, or paralysis at any age where polio is suspected.", "Wild poliovirus isolated from stool at a WHO-accredited laboratory.", ["A80", "G82.0"], ["poliovirus"]],
  ["mumps", "Mumps", "P", "Acute parotitis or salivary gland swelling for 2 days or more, or unexplained orchitis/oophoritis.", "", ["B26"], []],
  ["chickenpox", "Chickenpox", "P", "Acute generalised maculopapular vesicular rash starting on trunk and face and spreading to the extremities.", "", ["B01"], []],
  ["malaria", "Malaria", "P,L", "Fever in an endemic area in the transmission season, or after recent travel to one, without another obvious cause.", "Parasite detected by microscopy, rapid diagnostic test or molecular test.", ["B50", "B51", "B52", "B53", "B54"], ["plasmodium", "malaria", "p. falciparum", "p. vivax", "malarial parasite"]],
  ["dengue", "Dengue", "P,L", "Acute febrile illness of 2 to 7 days with 2 or more of headache, retro-orbital pain, myalgia, arthralgia, rash or haemorrhagic manifestations; a rapid NS1/IgM test makes it probable only.", "Isolation, IgM-ELISA, NS1-ELISA, IgG seroconversion or PCR.", ["A90", "A91", "A97"], ["dengue", "ns1"]],
  ["chikungunya", "Chikungunya", "P,L", "Acute fever with severe arthralgia or arthritis, with or without rash, in or from an epidemic area within 15 days.", "RT-PCR or IgM/IgG serology.", ["A92.0"], ["chikungunya"]],
  ["aes", "Acute encephalitis syndrome / Japanese encephalitis", "P,L", "Acute fever with a change in mental status and/or new seizures (not simple febrile seizures); every AES is a suspect JE case.", "IgM in serum or CSF, 4-fold titre rise, isolation, antigen or PCR.", ["A83.0", "A86", "G04"], ["japanese encephalitis", "je igm"]],
  ["kala-azar", "Kala-azar", "P", "Resident of or travel to an endemic area, irregular fever over 2 weeks and splenomegaly, malaria ruled out.", "", ["B55.0"], ["rk39", "leishmania"]],
  ["rabies", "Rabies (human)", "P,L", "Acute encephalitis with 2 or more of the listed signs (hydrophobia, aerophobia, spasms of swallowing and others) and exposure to a suspected rabid animal.", "Antigen, antibody, PCR or isolation.", ["A82"], ["rabies"]],
  ["plague", "Plague", "P,L", "Bubonic, pneumonic or septicaemic presentation with an epidemiological link.", "Y. pestis isolate with confirmatory tests, 4-fold antibody rise, or validated PCR.", ["A20"], ["yersinia pestis"]],
  ["leptospirosis", "Leptospirosis", "P,L", "Acute fever with headache, myalgia or prostration after exposure to animal urine, with calf tenderness, conjunctival suffusion, oliguria, jaundice, bleeding or meningism.", "IgM ELISA, 4-fold MAT rise or seroconversion.", ["A27"], ["leptospira", "leptospirosis"]],
  ["scrub-typhus", "Scrub typhus", "P,L", "Undifferentiated fever of 5 days or more (dengue, malaria, typhoid ruled out), with or without eschar.", "IgM ELISA or 4-fold rise.", ["A75.3"], ["scrub typhus", "orientia", "weil-felix oxk", "oxk"]],
  ["brucellosis", "Brucellosis", "P,L", "Acute or insidious fever with occupational or dietary risk (animal work, unpasteurised dairy).", "Serology (SAT 4-fold rise) or culture.", ["A23"], ["brucella"]],
  ["anthrax", "Anthrax", "P,L", "Compatible illness with a link to animal cases or contaminated animal products.", "Specific laboratory confirmation.", ["A22"], ["bacillus anthracis"]],
  ["cchf", "Crimean-Congo haemorrhagic fever", "P,L", "Fever over 38.5 C and tick bite in an endemic area within 14 days, with 2 or more haemorrhagic manifestations.", "PCR or serology.", ["A98.0"], ["cchf"]],
  ["kfd", "Kyasanur forest disease", "P,L", "Acute high fever with tick exposure or travel to an area with confirmed KFD or monkey deaths.", "PCR or serology.", ["A98.2"], ["kfd", "kyasanur"]],
  ["nipah", "Nipah virus disease", "P,L", "Fever with altered mental status, seizure, headache or respiratory symptoms, linked to an outbreak area or case.", "PCR or serology.", ["B33.8"], ["nipah"]],
  ["zika", "Zika virus disease", "P,L", "In a confirmed outbreak community, rash or fever with arthralgia, myalgia, conjunctivitis or headache.", "PCR or serology.", ["A92.5"], ["zika"]],
  ["mpox", "Mpox (monkeypox)", "P,L", "Unexplained acute rash with travel to an affected country within 21 days and an epidemiological link.", "PCR.", ["B04"], ["monkeypox", "mpox"]],
  ["ebola", "Ebola virus disease", "P,L", "Acute fever with 3 or more symptoms (or unexplained death) linked to an outbreak area or case.", "PCR or serology.", ["A98.4"], ["ebola"]],
  ["yellow-fever", "Yellow fever", "P,L", "Travel through an affected area within 6 days, acute fever then jaundice within 2 weeks.", "PCR or serology.", ["A95"], ["yellow fever"]],
  ["mers", "MERS-CoV", "P,L", "Exposure to an infected camel or confirmed case with respiratory or febrile illness.", "PCR.", ["B34.2"], ["mers-cov", "mers cov"]],
  ["marburg", "Marburg virus disease", "P,L", "Acute fever with symptoms and an epidemiological link within 3 weeks.", "PCR or serology.", ["A98.3"], ["marburg"]],
].map(([key, name, forms, presumptive, confirmed, icd, labWords]) => Object.freeze({ key, name, forms: forms.split(","), presumptive, confirmed, icd, labWords })));

const NOTIFICATION = {
  title: "Notifiable disease register (IDSP / IHIP)", authority: "District Surveillance Unit through IHIP (entered manually)",
  citation: "IDSP (NCDC, MoHFW): S/P/L forms, weekly Monday to Sunday; IDSP Case Definitions 2024",
  patient: "required", dateField: "diagnosisDate", confidential: [], submission: "manual",
  definitions: CONDITIONS.map((c) => ({ key: c.key, name: c.name, forms: c.forms, presumptive: c.presumptive, confirmed: c.confirmed })),
  fields: [
    f("condition", "Condition (IDSP)", "enum", { req: true, options: CONDITIONS.map((c) => [c.key, c.name]) }),
    f("classification", "IDSP form", "enum", { req: true, options: [["S", "S: suspected (syndromic)"], ["P", "P: presumptive (clinical, medical officer)"], ["L", "L: laboratory confirmed"]] }),
    f("definitionMet", "The case definition for this form is met", "enum", { req: true, options: [["yes", "Yes"]] }),
    f("onsetDate", "Date of onset", "date"),
    f("diagnosisDate", "Date of diagnosis", "date", { req: true }),
    f("ageYears", "Age (years)", "int", { req: true, min: 0, max: 130 }),
    f("sex", "Sex", "enum", { req: true, options: [["male", "Male"], ["female", "Female"], ["other", "Other"]] }),
    f("village", "Village, town or ward of residence", "text", { req: true }),
    f("district", "District", "text", { req: true }),
    f("hospitalised", "Admitted to hospital", "enum", { options: [["yes", "Yes"], ["no", "No"]] }),
    f("outcome", "Outcome", "enum", { options: [["alive", "Alive"], ["died", "Died"], ["referred", "Referred"], ["unknown", "Not known yet"]] }),
    f("labTest", "Laboratory test (L form)", "text"),
    f("labResult", "Laboratory result (L form)", "text"),
    f("labDate", "Date of the laboratory result", "date"),
    f("ihipEnteredOn", "Date entered on IHIP (manual submission)", "date"),
    f("ihipReference", "IHIP case reference, once entered", "text"),
    f("note", "Note", "longtext"),
  ],
  rules: (v) => {
    const p = [];
    const c = CONDITIONS.find((x) => x.key === v.condition);
    if (c && v.classification && v.classification !== "S" && !c.forms.includes(v.classification)) p.push(`classification: ${c.name} is reported on the ${c.forms.join(" or ")} form`);
    if (v.classification === "L" && (!v.labTest || !v.labResult)) p.push("labTest and labResult: an L form case names the test and its result");
    if (v.onsetDate && v.diagnosisDate && v.onsetDate > v.diagnosisDate) p.push("onsetDate: cannot be after the diagnosis");
    if (v.ihipReference && !v.ihipEnteredOn) p.push("ihipEnteredOn: say when the case was entered on IHIP");
    return p;
  },
  listColumns: ["diagnosisDate", "condition", "classification", "village", "ihipEnteredOn"],
};
if (!REGISTERS.notification) defineRegister("notification", NOTIFICATION);

/* ------------------------------------------------------------------------------------------------ prompts, PURE */

const POSITIVE = /\b(positive|reactive|detected|seen|isolated|present|significant)\b/i;
const NEGATIVE = /\b(not\s+detected|non[- ]?reactive|negative|absent|not\s+seen|no\s+growth|not\s+isolated)\b/i;

/** PURE. The listed conditions a patient's diagnoses and laboratory results look like, not yet notified. */
function promptsFor(conditions, observations, notified) {
  const done = new Set((notified || []).map((n) => n.fields && n.fields.condition).filter(Boolean));
  const hits = new Map();
  const hit = (c, why) => { if (done.has(c.key)) return; const h = hits.get(c.key) || { condition: c.key, name: c.name, forms: c.forms, presumptive: c.presumptive, confirmed: c.confirmed, because: [] }; h.because.push(why); hits.set(c.key, h); };
  for (const cond of conditions || []) {
    if (!cond || cond.clinicalStatus === "resolved" || cond.verificationStatus === "entered-in-error" || cond.verificationStatus === "refuted") continue;
    const code = str(cond.code).toUpperCase(), text = `${str(cond.display)} ${str(cond.code)}`.toLowerCase();
    for (const c of CONDITIONS) {
      if (code && c.icd.some((p) => code.startsWith(p))) hit(c, { kind: "diagnosis", display: str(cond.display) || code, code, id: cond.id });
      else if (text.includes(c.name.toLowerCase().split(" (")[0])) hit(c, { kind: "diagnosis", display: str(cond.display) || code, code, id: cond.id });
    }
  }
  for (const o of observations || []) {
    if (!o || o.category !== "laboratory") continue;
    const text = `${str(o.display)} ${str(o.name)} ${str(o.code)}`.toLowerCase();
    const value = `${str(typeof o.value === "object" ? JSON.stringify(o.value) : o.value)} ${str(o.interpretation)}`;
    if (!POSITIVE.test(value) || NEGATIVE.test(value)) continue;
    for (const c of CONDITIONS) if (c.labWords.some((w) => text.includes(w))) hit(c, { kind: "laboratory", display: str(o.display) || str(o.code), value: str(o.value), id: o.id });
  }
  return [...hits.values()];
}

async function notifiablePrompts(request, env, ctx) {
  const mig = ctx.migration;
  const patientId = str(ctx.patientId);
  if (!mig || mig.mode === "off") return { ok: true, skipped: "off", prompts: [] };
  if (!patientId) return { ok: false, status: 422, error: "patient_required" };
  let svc;
  try {
    const resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:read", ctx.actorDeps);
    svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });
  } catch (e) { return { ok: false, status: e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502, error: "permission" }; }
  let conditions, observations;
  try { [conditions, observations] = await Promise.all([svc.byPatient("Condition", patientId), svc.byPatient("Observation", patientId)]); }
  catch (e) { return { ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", message: "The diagnoses and results could not be read. Do not read this as nothing to notify." }; }
  const notified = await listEntries({ ...ctx, kind: "notification", patientId });
  if (!notified.ok) return notified;
  return { ok: true, patientId, prompts: promptsFor(conditions, observations, notified.entries), notified: notified.entries.map((e) => ({ id: e.id, condition: e.fields.condition, classification: e.fields.classification, ihipEnteredOn: e.fields.ihipEnteredOn || null })),
    note: "Suggestions from the diagnoses and laboratory results. A person decides whether the case definition is met. Nothing is sent: IHIP entry is manual." };
}

/** The Monday to Sunday week starting on `week` (YYYY-MM-DD, a Monday): the cases, per-condition counts, and CSV. */
async function weeklyExport(ctx, week, format) {
  const monday = str(week);
  const d = new Date(monday + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(monday) || Number.isNaN(d.getTime())) return { ok: false, status: 422, error: "bad_week", message: "Give the Monday the week starts on, as YYYY-MM-DD." };
  if (d.getUTCDay() !== 1) return { ok: false, status: 422, error: "not_a_monday", message: "The IDSP week runs Monday to Sunday: give the Monday." };
  const to = new Date(d.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const r = await listEntries({ ...ctx, kind: "notification", from: monday, to });
  if (!r.ok) return r;
  const counts = {};
  for (const e of r.entries) {
    const k = `${e.fields.condition}|${e.fields.classification}`;
    counts[k] = counts[k] || { condition: e.fields.condition, name: (CONDITIONS.find((c) => c.key === e.fields.condition) || {}).name || e.fields.condition, form: e.fields.classification, cases: 0, deaths: 0, notYetOnIhip: 0 };
    counts[k].cases += 1;
    if (e.fields.outcome === "died") counts[k].deaths += 1;
    if (!e.fields.ihipEnteredOn) counts[k].notYetOnIhip += 1;
  }
  return {
    ok: true, week: { from: monday, to: new Date(d.getTime() + 6 * 86400000).toISOString().slice(0, 10) }, entries: r.entries, summary: Object.values(counts),
    notYetOnIhip: r.entries.filter((e) => !e.fields.ihipEnteredOn).length,
    ...(format === "csv" ? { format: "csv", filename: `ihip-week-${monday}.csv`, csv: csvFor("notification", r.entries) } : {}),
    submission: "Manual. IHIP publishes no API, so these cases are keyed into IHIP by a person, who then records the date and IHIP reference on each entry.",
    ...(r.truncated ? { truncated: true, truncatedWarning: r.truncatedWarning } : {}),
  };
}

export { CONDITIONS, NOTIFICATION, promptsFor, notifiablePrompts, weeklyExport };
