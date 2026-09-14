// functions/_vaccines.js — the vaccine catalogue behind OPD immunisation capture.
//
// GENERATED, NOT HAND-WRITTEN — run scripts/gen-vaccines.mjs to refresh. Every code below is copied
// verbatim out of the NDHM IG's own value set (ndhm.in ValueSet-ndhm-vaccine-codes,
// 179 SNOMED CT concepts).
//
// WHY IT IS GENERATED. A vaccine code in a patient's national health record is a clinical claim. Typing
// SNOMED from memory is how a wrong one ships, and a wrong vaccine code is worse than no record at all.
// So the catalogue is derived from the IG, and the server REFUSES any code that is not in it. The client
// picker is a view over this list, never the source of truth.
//
// SCHEDULE is India's National Immunization Schedule surfaced first in the picker. It is an ORDERING over
// the same list - not a second catalogue - and the generator asserts every entry exists.

export const VACCINE_SYSTEM = "http://snomed.info/sct";

/** The IG value set, verbatim: code -> display. */
export const VACCINES = Object.freeze({
  "871759008": "Acellular pertussis vaccine",
  "871722007": "Adenovirus antigen only vaccine product",
  "836400005": "Adenovirus antigen-containing vaccine product",
  "2031000221103": "Adult diphtheria and tetanus toxoids vaccine",
  "2051000221107": "Adult diphtheria toxoid and acellular pertussis and tetanus toxoid vaccine",
  "860818003": "Anthrax vaccine",
  "836384003": "Bacillus anthracis antigen-containing vaccine product",
  "863950005": "Bacteria and virus antigens-containing vaccine product",
  "836368004": "Bacteria antigen-containing vaccine product",
  "1861000221106": "BCG (Bacillus Calmette-Guerin) vaccine",
  "319941000221104": "BCG (Bacillus Calmette-Guerin) vaccine in parenteral dose form",
  "601000221108": "Bordetella pertussis antigen-containing vaccine product",
  "840599008": "Borrelia burgdorferi antigen-containing vaccine product",
  "991000221105": "Cholera vaccine",
  "2181000221101": "Cholera vaccine in oral dose form",
  "863911006": "Clostridium tetani antigen-containing vaccine product",
  "836381006": "Corynebacterium diphtheriae antigen-containing vaccine product",
  "1119305005": "COVID-19 antigen vaccine",
  "1119349007": "COVID-19 mRNA vaccine",
  "836397001": "Coxiella burnetii antigen-containing vaccine product",
  "871720004": "Dengue vaccine",
  "840563003": "Dengue virus antigen-containing vaccine product",
  "2101000221107": "Diphtheria and acellular pertussis and Haemophilus influenzae type B and hepatitis B and poliomyelitis and tetanus pediatric vaccine",
  "871893003": "Diphtheria and acellular pertussis and inactivated poliomyelitis and tetanus vaccine",
  "871883005": "Diphtheria and acellular pertussis and poliomyelitis and tetanus paediatric vaccine",
  "871876003": "Diphtheria and acellular pertussis and tetanus vaccine",
  "871888001": "Diphtheria and Haemophilus influenza B and acellular pertussis and inactivated poliomyelitis and tetanus vaccine",
  "2091000221104": "Diphtheria and Haemophilus influenza B and acellular pertussis and poliomyelitis and tetanus pediatric vaccine",
  "871839001": "Diphtheria and Haemophilus influenzae B and pertussis and tetanus vaccine",
  "871895005": "Diphtheria and Haemophilus influenzae type B and hepatitis B and pertussis and poliomyelitis and tetanus",
  "871886002": "Diphtheria and Haemophilus influenzae type B and hepatitis B and pertussis and tetanus vaccine",
  "871887006": "Diphtheria and Haemophilus influenzae type B and pertussis and poliomyelitis and tetanus vaccine",
  "871890000": "Diphtheria and Haemophilus influenzae type B and poliomyelitis and tetanus vaccine",
  "871891001": "Diphtheria and hepatitis B and acellular pertussis and inactivated poliomyelitis and tetanus vaccine",
  "871889009": "Diphtheria and hepatitis B and inactivated poliomyelitis and acellular pertussis vaccine",
  "871929006": "Diphtheria and hepatitis B and tetanus vaccine",
  "871928003": "Diphtheria and measles and pertussis and poliomyelitis and tetanus vaccine",
  "871878002": "Diphtheria and pertussis and poliomyelitis and tetanus vaccine",
  "871875004": "Diphtheria and pertussis and tetanus vaccine",
  "871837004": "Diphtheria and poliomyelitis and tetanus vaccine",
  "871826000": "Diphtheria and tetanus vaccine",
  "318351000221106": "Diphtheria toxoid and acellular pertussis and inactivated poliomyelitis type 1,2, and 3 and tetanus toxoid pediatric vaccine",
  "318341000221109": "Diphtheria toxoid and Haemophilus influenzae type B and acellular pertussis and tetanus toxoid pediatric vaccine",
  "2071000221100": "Diphtheria toxoid and Haemophilus influenzae type B and whole cell pertussis and tetanus toxoid paediatric vaccine",
  "775641005": "Diphtheria toxoid and tetanus toxoid adsorbed vaccine",
  "774618008": "Diphtheria toxoid and whole cell pertussis and tetanus toxoid adsorbed vaccine",
  "2061000221109": "Diphtheria toxoid and whole cell pertussis and tetanus toxoid paediatric vaccine",
  "2081000221102": "Diphtheria toxoid, Haemophilus influenzae B, hepatitis B surface antigen, acellular pertussis and tetanus toxoid paediatric vaccine",
  "871729003": "Diphtheria vaccine",
  "871721000": "Ebolavirus antigen only vaccine product",
  "836421005": "Ebolavirus antigen-containing vaccine product",
  "840551008": "Francisella tularensis antigen-containing vaccine product",
  "871806004": "Haemophilus influenzae type B and Hepatitis B virus antigens only vaccine product",
  "1119351006": "Haemophilus influenzae type B and meningitis C and Y vaccine",
  "836500008": "Haemophilus influenzae type B and meningitis C vaccine",
  "836380007": "Haemophilus influenzae type B antigen-containing vaccine product",
  "2041000221105": "Haemophilus influenzae type B capsular polysaccharide conjugated vaccine",
  "1010689004": "Haemophilus influenzae type B capsular polysaccharide polyribosylribitol phosphate conjugated to Clostridium tetani toxoid vaccine",
  "871764007": "Haemophilus influenzae type B vaccine",
  "865997008": "Hepatitis A adult vaccine",
  "871803007": "Hepatitis A and B vaccine",
  "871804001": "Hepatitis A and typhoid vaccine",
  "871750007": "Hepatitis A pediatric vaccine",
  "871751006": "Hepatitis A vaccine",
  "836375003": "Hepatitis A virus antigen-containing vaccine product",
  "871925000": "Hepatitis B surface antigen vaccine",
  "871822003": "Hepatitis B vaccine",
  "836374004": "Hepatitis B virus antigen-containing vaccine product",
  "1991000221106": "Human papillomavirus 16 and 18 vaccine",
  "2001000221108": "Human papillomavirus 6, 11, 16 and 18 vaccine",
  "871767000": "Human papillomavirus 9 vaccine",
  "836379009": "Human papillomavirus antigen-containing vaccine product",
  "911000221103": "Human papillomavirus vaccine",
  "871739009": "Human poliovirus antigen only vaccine product",
  "1031000221108": "Human poliovirus antigen-containing vaccine product",
  "1001000221103": "Inactivated cholera vaccine in oral dose form",
  "121000221105": "Inactivated hepatitis A and hepatitis B surface antigen vaccine",
  "91000221102": "Inactivated hepatitis A vaccine",
  "871825001": "Inactivated Japanese encephalitis virus adsorbed vaccine",
  "871725009": "Inactivated Japanese encephalitis virus vaccine",
  "871740006": "Inactivated polio vaccine",
  "1131000221109": "Inactivated rabies vaccine",
  "2191000221103": "Inactivated rabies vaccine grown in cellular line",
  "2201000221100": "Inactivated rabies virus vaccine grown in brain tissue",
  "1010318006": "Inactivated whole Hepatitis A GBM strain vaccine",
  "1010308001": "Inactivated whole Hepatitis A HM-175 strain vaccine",
  "1119279002": "Inactivated whole Influenza H5N1 vaccine",
  "2261000221104": "Influenza A virus subtypes H1N1 and H3N2 and Influenza B virus Victoria and Yamagata lineage antigens only vaccine product",
  "2211000221102": "Influenza A virus subtypes H1N1 and H3N2 and influenza B virus Victoria lineage antigens only vaccine product",
  "871772009": "Influenza H1N1 vaccine",
  "1003499009": "Influenza H5N1 vaccine",
  "1181000221105": "Influenza vaccine",
  "871768005": "Influenza vaccine in nasal dose form",
  "836377006": "Influenza virus antigen-containing vaccine product",
  "836378001": "Japanese encephalitis virus antigen-containing vaccine product",
  "871724008": "Japanese encephalitis virus vaccine",
  "860722004": "Junin virus antigen-containing product",
  "840564009": "Leptospira antigen-containing vaccine product",
  "1111000221101": "Live attenuated Argentinian haemorrhagic fever vaccine",
  "1011000221100": "Live attenuated cholera vaccine in oral dose form",
  "1010313002": "Live attenuated influenza vaccine",
  "2251000221101": "Live attenuated measles and mumps and rubella and varicella-zoster vaccine",
  "2231000221105": "Live attenuated measles and rubella vaccine",
  "871766009": "Live attenuated measles vaccine",
  "2241000221103": "Live attenuated measles, mumps, and rubella vaccine",
  "871738001": "Live attenuated mumps vaccine",
  "836402002": "Live attenuated Mycobacterium bovis antigen-containing vaccine product",
  "1010322001": "Live attenuated Oka strain varicella vaccine",
  "1010310004": "Live attenuated Oka-Merck strain varicella vaccine",
  "1051000221104": "Live attenuated poliovirus serotypes 1 and 3 vaccine in oral dose form",
  "1081000221109": "Live attenuated rotavirus vaccine",
  "971000221109": "Live attenuated typhoid vaccine in oral dose form",
  "2221000221107": "Live attenuated Varicella-zoster vaccine",
  "1121000221106": "Live attenuated yellow fever vaccine",
  "871894009": "Low dose diphtheria and acellular pertussis and inactivated poliomyelitis and tetanus vaccine",
  "871838009": "Low dose diphtheria and inactivated poliomyelitis and tetanus vaccine",
  "871827009": "Low dose diphtheria and tetanus vaccine",
  "871730008": "Low dose diphtheria vaccine",
  "871911001": "Lyme disease vaccine",
  "871908002": "Measles and mumps and rubella and varicella virus vaccine",
  "871831003": "Measles and mumps and rubella vaccine",
  "871817003": "Measles and rubella vaccine",
  "836382004": "Measles morbillivirus antigen-containing product",
  "871765008": "Measles vaccine",
  "871871008": "Meningitis A and C vaccine",
  "871873006": "Meningitis A, C, W135 and Y vaccine",
  "871866001": "Meningitis C vaccine",
  "1061000221102": "Meningitis polysaccharide vaccine",
  "871916006": "Meningococcus A, C, W135 and Y capsular oligosaccharide conjugated vaccine",
  "1971000221105": "Meningococcus A, C, W135 and Y capsular polysaccharide conjugated vaccine",
  "951000221102": "Meningococcus group C capsular polysaccharide conjugate vaccine",
  "1981000221108": "Meningococcus serogroup B vaccine",
  "921000221108": "Meningococcus vaccine",
  "836498007": "Mumps orthorubulavirus antigen-containing vaccine product",
  "871737006": "Mumps vaccine",
  "836401009": "Neisseria meningitidis antigen-containing vaccine product",
  "428601009": "Paratyphoid vaccine",
  "409568008": "Pentavalent (ABCDE) botulinum toxoid vaccine",
  "871758000": "Pertussis vaccine",
  "871718002": "Plague vaccine",
  "1052330009": "Pneumococcal 10-valent conjugate vaccine",
  "1119254000": "Pneumococcal 13-valent conjugate vaccine",
  "1119220001": "Pneumococcal 23-valent conjugate vaccine",
  "1052328007": "Pneumococcal 7-valent conjugate vaccine",
  "1801000221105": "Pneumococcal polysaccharide vaccine",
  "981000221107": "Pneumococcal vaccine",
  "871816007": "Poliomyelitis and tetanus vaccine",
  "871723002": "Q fever vaccine",
  "836393002": "Rabies lyssavirus antigen-containing vaccine product",
  "871726005": "Rabies vaccine",
  "871918007": "Rickettsia antigen-containing vaccine product",
  "871897002": "Rocky Mountain spotted fever vaccine",
  "836387005": "Rotavirus antigen-containing vaccine product",
  "871761004": "Rotavirus vaccine",
  "871732000": "Rubella vaccine",
  "836388000": "Rubella virus antigen-containing vaccine product",
  "836390004": "Salmonella enterica subspecies enterica serovar Typhi antigen-containing vaccine product",
  "871921009": "Staphylococcus toxoid vaccine",
  "836398006": "Streptococcus pneumoniae antigen-containing vaccine product",
  "462321000124107": "Tdap - Low dose diphtheria and low dose acellular pertussis and tetanus vaccine",
  "777725002": "Tetanus toxoid adsorbed vaccine",
  "2021000221101": "Tetanus toxoid vaccine",
  "871742003": "Tetanus vaccine",
  "871719005": "Tick-borne encephalitis vaccine",
  "836403007": "Tick-borne encephalitis virus antigen-containing vaccine product",
  "871716003": "Tularemia vaccine",
  "2171000221104": "Typhoid polysaccharide vaccine in parenteral dose form",
  "961000221100": "Typhoid vaccine",
  "871755002": "Typhoid Vi capsular polysaccharide vaccine",
  "37146000": "Typhus vaccine",
  "871727001": "Vaccinia virus antigen only vaccine product",
  "836389008": "Vaccinia virus antigen-containing vaccine product",
  "871919004": "Varicella-zoster vaccine",
  "836495005": "Varicella-zoster virus antigen-containing vaccine product",
  "836383009": "Vibrio cholerae antigen-containing vaccine product",
  "836369007": "Virus antigen-containing vaccine product",
  "871717007": "Yellow fever vaccine",
  "836385002": "Yellow fever virus antigen-containing vaccine product",
  "840549009": "Yersinia pestis antigen-containing vaccine product",
});

/** India's NIS, in schedule order. `label` is the name a clinician actually says. */
export const SCHEDULE = Object.freeze([
  { code: "1861000221106", label: "BCG" },
  { code: "1051000221104", label: "OPV (bivalent, oral)" },
  { code: "871740006", label: "IPV" },
  { code: "871822003", label: "Hepatitis B" },
  { code: "871886002", label: "Pentavalent (DPT-HepB-Hib)" },
  { code: "871761004", label: "Rotavirus" },
  { code: "1119254000", label: "PCV 13" },
  { code: "871817003", label: "Measles-Rubella (MR)" },
  { code: "871724008", label: "Japanese encephalitis" },
  { code: "871875004", label: "DPT booster" },
  { code: "871827009", label: "Td" },
  { code: "2021000221101", label: "Tetanus toxoid (TT)" },
  { code: "911000221103", label: "HPV" },
  { code: "1131000221109", label: "Rabies (inactivated)" },
  { code: "871755002", label: "Typhoid (Vi polysaccharide)" },
  { code: "1181000221105", label: "Influenza" },
]);

/** A vaccine code is valid ONLY if the IG has it. Anything else is refused, never stored as free text. */
export function isVaccineCode(code) { return Object.prototype.hasOwnProperty.call(VACCINES, String(code || "")); }

/** The full coding for a code, or null. The display comes from the IG, NEVER from the caller. */
export function vaccineCoding(code) {
  const c = String(code || "");
  return isVaccineCode(c) ? { system: VACCINE_SYSTEM, code: c, display: VACCINES[c] } : null;
}

/** Picker payload: the schedule first (with clinician labels), then everything else alphabetically. */
export function vaccineCatalogue() {
  const inSchedule = new Set(SCHEDULE.map((s) => s.code));
  return {
    system: VACCINE_SYSTEM,
    schedule: SCHEDULE.map((s) => ({ code: s.code, label: s.label, display: VACCINES[s.code] })),
    others: Object.keys(VACCINES).filter((c) => !inSchedule.has(c))
      .map((c) => ({ code: c, display: VACCINES[c] }))
      .sort((a, b) => a.display.localeCompare(b.display)),
  };
}

// Turns a request body into the structured payload the timeline stores, or an error. The VACCINE CODE is
// the whole point of validating here: a client-supplied code is a claim, and an unrecognised SNOMED
// concept in a patient's PHR is a false clinical statement that ABDM can never take back. So it must be
// in the IG's own value set, and the DISPLAY is read from the IG rather than trusted from the body.
//
// site/route are deliberately NOT captured yet. NRCES makes system+code+display all min=1 once those
// optional elements exist, and the IG enumerates no codes for them (its route value set is a filter with
// no concept list), so a text-only site is worse than no site at all. They belong in the note until there
// is a code list to pick from.
export function buildImmunisation(body) {
  const coding = vaccineCoding(body && body.vaccineCode);
  if (!coding) return { error: "unknown_vaccine_code" };
  // occurrence[x] is min=1 in FHIR. A caller may back-date a dose given earlier today or at another
  // facility, but not to the future - a vaccination that has not happened is not a record.
  const ts = body.occurrenceDateTime ? Date.parse(body.occurrenceDateTime) : Date.now();
  if (!isFinite(ts)) return { error: "bad_date" };
  if (ts > Date.now() + 86400000) return { error: "future_date" };
  const dose = body.doseNumber == null || body.doseNumber === "" ? null : Math.round(Number(body.doseNumber));
  if (dose != null && (!isFinite(dose) || dose < 1 || dose > 20)) return { error: "bad_dose" };
  const note = String(body.note || "").slice(0, 500).trim();
  const data = {
    vaccineCode: coding,
    occurrenceDateTime: new Date(ts).toISOString(),
    status: "completed",              // the record exists because it was given; not-done is a separate flow
    text: [coding.display, dose != null ? "dose " + dose : "", note].filter(Boolean).join(", "),
  };
  if (dose != null) data.doseNumber = dose;
  const lot = String(body.lotNumber || "").slice(0, 40).trim();
  if (lot) data.lotNumber = lot;
  if (note) data.note = note;
  return { data };
}
