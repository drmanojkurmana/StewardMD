/* test/wardsynq-print-lang.test.mjs - owner decision 2026-09-15: the patient's prescription (ward.js Patient
 * copy) and discharge summary (discharge.js printable) print in English, whole, with an optional second
 * language beside it (wardsynq/site/print-lang.js). Pure renders in a vm sandbox, no DOM or network.
 *
 * Golden rules pinned here: the English part is byte-identical with and without the option; every frequency
 * the codebase knows (mar-schedule.js ALIASES), PRN, STAT, once weekly, decimals and leading zeros survive
 * verbatim in it; the translated part carries catalog words only (never a dose, frequency, diagnosis or
 * result) and falls back to English, never blank; setting off means no picker; dates are unambiguous in the
 * hospital's clock and a non-ISO date is never parsed. Negation in the catalogs: test/wardsynq-i18n.test.mjs.
 * Server side: test/wardsynq-print-lang-routes.test.mjs. Headless print preview: test/run-print-lang-ui.mjs.
 *
 * node --test test/wardsynq-print-lang.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { ALIASES } from "../functions/_wardsynq/mar-schedule.js";
import { PATIENT_INSTRUCTIONS } from "../functions/_wardsynq/migrate-inpatient.js";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

function sandbox(opts) {
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "", search: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, head: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [], documentElement: { lang: "en" } },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb);
  vm.runInContext(read("wardsynq/site/i18n.js"), sb);
  if (!(opts && opts.noPrint)) vm.runInContext(read("wardsynq/site/print-lang.js"), sb);
  vm.runInContext(read("wardsynq/site/portal.js"), sb);
  vm.runInContext(read("ward.js"), sb);
  vm.runInContext(read("discharge.js"), sb);
  return sb;
}
/* A stand-in second language: every print key and instruction as "TE[<english>]", so a test can see exactly
 * which words were translated. Real catalogs are checked in test/wardsynq-i18n.test.mjs. */
function withFakeTelugu(sb, only) {
  const en = sb.WSQI18n._catalogs.en, cat = {};
  for (const k of Object.keys(en)) if (!only || only(k)) cat[k] = "TE[" + en[k] + "]";
  sb.WSQI18n.register("te", "తెలుగు", cat, { reviewed: false });
  return sb;
}
const strip = (html) => html.replace(/<aside class="p-tr"[\s\S]*?<\/aside>/g, "");
const asides = (html) => html.match(/<aside class="p-tr"[\s\S]*?<\/aside>/g) || [];
const docPart = (html) => html.slice(html.indexOf('<header class="w-dt-h">'));

// Every frequency the MAR parser accepts, plus the shapes it reads but has no alias for, plus ones it cannot read.
const FREQS = [...Object.keys(ALIASES), "PRN", "STAT", "SOS", "once weekly", "1-0-1", "0-0-1", "1-0-0-1", "Q8H", "Q12H", "every 8 hours", "alternate days after dialysis"];
const DOSES = [{ value: 0.125, unit: "mg", print: "0.125 mg" }, { value: "0.125", unit: "mg", print: "0.125 mg" }, { value: 7.5, unit: "mg", print: "7.5 mg" },
  { value: "0.50", unit: "mg", print: "0.50 mg" }, { value: "05", unit: "mL", print: "05 mL" }];
const medicines = FREQS.map((f, i) => {
  const d = DOSES[i % DOSES.length];
  return { drug: "Drug" + i, dose: { value: d.value, unit: d.unit }, route: "oral", frequency: f, _print: d.print,
    ...(i === 0 ? { patientInstructions: ["after-food", "do-not-crush"] } : {}) };
});
medicines.push({ drug: "Methotrexate", dose: { value: 7.5, unit: "mg" }, route: "oral", frequency: "once weekly", _print: "7.5 mg", patientInstructions: ["do-not-drink-alcohol"] });

function copyState(sb, over) {
  const W = sb.WARD;
  return { ...W._st, view: "pcopy", sel: { patientId: "p1" }, pcopyScope: "patient-copy", ...over, pcopy: {
    ok: true, patientId: "p1", statements: ["This is a summary your care team has given you."], clinicianWarnings: [],
    portalPreview: { checked: true, scopes: { "patient-copy": [], full: [] } },
    print: { languagesEnabled: true, timeZone: null, utcOffsetMinutes: 330 },
    document: {
      patient: { name: "Deepa", mrn: "MRN-0042", dob: "1970-01-01" },
      diagnoses: [{ display: "Rheumatoid arthritis [M06.9]" }], allergies: [],
      medicines: medicines.map(({ _print, ...m }) => m),
      results: [{ name: "Serum creatinine", conclusion: "1.4 mg/dL", reportedAt: "2026-09-14T20:00:00.000Z" }],
      withheldResults: [{ say: "Your care team will discuss this result with you.", reportedAt: "2026-09-14T20:00:00.000Z" }],
      appointments: [{ at: "2026-09-20T04:30:00.000Z", with: "Dr Rao" }],
    },
    ...((over && over.pcopyOver) || {}),
  } };
}

test("PRESCRIPTION: the English part is byte-identical with the option on, off, and with no language picked", () => {
  const sb = withFakeTelugu(sandbox());
  const W = sb.WARD;
  const on = W._render(copyState(sb, { pcopyLang: "te" }));
  const noLang = W._render(copyState(sb, { pcopyLang: "" }));
  const off = W._render(copyState(sb, { pcopyLang: "te", pcopyOver: { print: { languagesEnabled: false, utcOffsetMinutes: 330 } } }));
  assert.ok(asides(on).length >= 6, "the translated part is there");
  assert.equal(asides(noLang).length, 0);
  assert.equal(asides(off).length, 0, "a hospital with the option off prints English only, whatever was picked");
  assert.equal(docPart(strip(on)), docPart(noLang));
  assert.equal(docPart(strip(on)), docPart(off));
});

test("PRESCRIPTION: every frequency, PRN, STAT, once weekly, decimals and leading zeros print verbatim in English with the option on", () => {
  const sb = withFakeTelugu(sandbox());
  const en = strip(sb.WARD._render(copyState(sb, { pcopyLang: "te" })));
  for (const m of medicines) {
    const line = "<li><b>" + m.drug + "</b> " + m._print + " &middot; oral" + '<div class="w-dt-times">' + m.frequency + "</div>";
    assert.ok(en.includes(line), "verbatim: " + line);
  }
  assert.match(en, /<b>Drug0<\/b> 0\.125 mg &middot; oral<div class="w-dt-times">OD<\/div><div class="w-dt-times">After food; Do not crush or chew<\/div>/, "picked instructions in the catalog's English");
  for (const f of ["PRN", "SOS", "STAT"]) {
    assert.equal((en.match(new RegExp(">" + f + "</div>", "g")) || []).length, FREQS.filter((x) => x === f).length, f + " is never rewritten (PRN as SOS, STAT as once)");
  }
  assert.ok(en.includes(">TDS</div>") && en.includes(">TID</div>"), "TDS and TID each stay as written");
  assert.ok(en.includes("Rheumatoid arthritis [M06.9]") && en.includes("1.4 mg/dL"), "diagnoses and results as recorded");
});

test("PRESCRIPTION: the translated part holds catalog words only, the authority line in both languages, drug names in English", () => {
  const sb = withFakeTelugu(sandbox());
  const html = sb.WARD._render(copyState(sb, { pcopyLang: "te" }));
  const tr = asides(html);
  const first = tr[0];
  assert.match(first, /data-print-lang="te"/);
  assert.match(first, /Translation \/ TE\[Translation\] \(తెలుగు\)/, "clearly marked, in both languages");
  assert.ok(first.includes('<p class="p-tr-auth" lang="en">The English prescription is the authoritative one.'), "authority line in English");
  assert.ok(first.includes('<p class="p-tr-auth">TE[The English prescription is the authoritative one.'), "and in the second language");
  assert.ok(html.indexOf(first) < html.indexOf("<h3>Allergies</h3>"), "at the top of the translated part");
  const all = tr.join("\n");
  for (const m of medicines) {
    assert.ok(!all.includes(">" + m.frequency + "<") && !all.includes(" " + m.frequency + "<"), "no frequency in the translation: " + m.frequency);
  }
  for (const clinical of ["0.125", "7.5", "0.50", "05 mL", "once weekly", "Rheumatoid", "M06.9", "creatinine", "1.4 mg/dL", "Dr Rao", "MRN-0042"]) {
    assert.ok(!all.includes(clinical), "never translated or repeated in the translation: " + clinical);
  }
  assert.match(all, /<li><b lang="en">Drug0<\/b>: TE\[After food\]; TE\[Do not crush or chew\]<\/li>/);
  assert.match(all, /<li><b lang="en">Methotrexate<\/b>: TE\[Do not drink alcohol\]<\/li>/);
  assert.match(all, /TE\[Your medicines\]/);
  assert.match(all, /TE\[No allergies are recorded for you\. Tell your care team if you know of any\.\]/, "an empty list is said in the second language too");
  const drugsInTr = all.match(/<b[^>]*>[^<]*<\/b>/g) || [];
  assert.ok(drugsInTr.every((b) => b.startsWith('<b lang="en">')), "every name in the translation is marked English");
});

test("PRESCRIPTION: a translation not yet written falls back to English, never a blank or a key", () => {
  const sb = sandbox();
  vm.runInContext(read("wardsynq/site/i18n/te.js"), sb);   // the real file, which has none of the print keys yet
  const tr = asides(sb.WARD._render(copyState(sb, { pcopyLang: "te" }))).join("\n");
  assert.ok(tr.length > 0);
  assert.ok(tr.includes("The English prescription is the authoritative one."));
  assert.doesNotMatch(tr, /print\.|rx\.instr\.|pcopy\.|<h4><\/h4>|<p><\/p>/, "no raw key, no empty heading");
  assert.match(tr, /<b lang="en">Drug0<\/b>: After food; Do not crush or chew/);
});

test("SETTING OFF MEANS NO LANGUAGE PICKER, on either print; on, the picker lists the portal's eight other languages", () => {
  const sb = withFakeTelugu(sandbox());
  const off = sb.WARD._render(copyState(sb, { pcopyOver: { print: { languagesEnabled: false } } }));
  assert.ok(!off.includes("wPcopyLang") && !off.includes("Second language on the print"));
  assert.ok(!sb.WARD._render(copyState(sb, { pcopyOver: { print: undefined } })).includes("wPcopyLang"), "no settings from the server is off");
  const on = sb.WARD._render(copyState(sb, {}));
  const select = /<select id="wPcopyLang">([\s\S]*?)<\/select>/.exec(on);
  assert.ok(select, "the picker is offered");
  assert.deepEqual([...select[1].matchAll(/value="(\w*)"/g)].map((x) => x[1]), ["", "es", "te", "hi", "bn", "kn", "ta", "ml", "mr"]);
  assert.match(select[1], /<option value="">English only<\/option>/);
  assert.ok(sb.WARD._render(copyState(sb, {})).includes('<div class="w-dt-bar w-noprint">'), "the picker sits in the bar that never prints");

  const D = sb.DISCHARGE;
  assert.ok(!D._render(dcState({ print: { languagesEnabled: false } })).includes("dPrintLang"));
  assert.ok(D._render(dcState({})).includes('<select id="dPrintLang">'));
  assert.ok(!D._render(dcState({ signed: true, print: null })).includes("dPrintLang"));
});

const ASSEMBLED = {
  admission: "Ward: Medical A, bed 12.", diagnoses: "Active:\nPneumonia [J18.9] - confirmed", allergies: "Penicillin - severity high",
  vitals: "On admission: Heart rate 96 /min", investigations: "Chest X-ray (completed)",
  medications: "Digoxin - 0.125 mg, oral, OD (active)\nMethotrexate - 7.5 mg, oral, once weekly (active)\nParacetamol - 500 mg, oral, PRN (active)\nCeftriaxone - 1 g, IV, STAT (completed)",
  assessment: "Do not restart NSAIDs.", plan: "Review in 2 weeks.", provenance: "Assembled automatically from this admission's clinical record.",
};
function dcState(over) {
  return { orgId: "o", encounterId: "e1", patientId: "p1", patient: { name: "Asha Rao", mrn: "SMD-1", sex: "female" },
    encounter: { status: "finished", ward: "Medical A", bed: "12", admittedAt: "2026-09-07T20:00:00.000Z", dischargedAt: "2026-09-10T06:00:00.000Z" },
    assembled: ASSEMBLED, sections: { ...ASSEMBLED }, edited: ["plan"], pending: [], signed: false, signedBy: null, version: 2, recordedAt: null,
    canAuthor: true, hasDraft: true, editing: "", compare: {}, busy: false, loaded: true, err: "", note: "", refusal: null,
    print: { languagesEnabled: true, timeZone: "Asia/Kolkata", utcOffsetMinutes: 330 }, printLang: "", ...over };
}

test("DISCHARGE SUMMARY: English is byte-identical with and without the option; the medication text keeps every dose and frequency verbatim", () => {
  const sb = withFakeTelugu(sandbox());
  const P = sb.DISCHARGE._printable;
  for (const extra of [{}, { signed: true, signedBy: "Dr Rao", recordedAt: "2026-09-10T07:15:00.000Z" }]) {
    const on = P(dcState({ printLang: "te", ...extra }));
    const off = P(dcState({ printLang: "te", print: { languagesEnabled: false, timeZone: "Asia/Kolkata" }, ...extra }));
    const none = P(dcState({ ...extra }));
    assert.ok(asides(on).length >= 10);
    assert.equal(strip(on), off);
    assert.equal(strip(on), none);
    assert.ok(off.includes("Digoxin - 0.125 mg, oral, OD (active)\nMethotrexate - 7.5 mg, oral, once weekly (active)\nParacetamol - 500 mg, oral, PRN (active)\nCeftriaxone - 1 g, IV, STAT (completed)"));
    assert.ok(off.includes("Do not restart NSAIDs."), "free text as recorded");
  }
  const on = P(dcState({ printLang: "te" }));
  const tr = asides(on).join("\n");
  assert.ok(tr.includes("The English discharge summary is the authoritative one.") && tr.includes("TE[The English discharge summary is the authoritative one."));
  assert.match(tr, /<h2>6\. TE\[Medications\]<\/h2><p>TE\[This part is printed in English only, exactly as your care team recorded it\.\]<\/p>/);
  assert.match(tr, /Admitted: TE\[Admitted\]/);
  assert.match(tr, /TE\[Unsigned draft\. This is not a final discharge summary\.\]/);
  for (const clinical of ["0.125", "7.5", "once weekly", "PRN", "STAT", "Pneumonia", "J18.9", "NSAIDs", "Asha Rao", "Medical A", "Sep 2026"]) {
    assert.ok(!tr.includes(clinical), "never in the translation: " + clinical);
  }
  // Each print.dc.section key is the discharge.js heading, word for word.
  const en = sb.WSQI18n._catalogs.en;
  for (const s of sb.DISCHARGE._sections) assert.equal(en["print.dc.section." + s.k], s.n, s.k);
});

test("DATES: '15 Sep 2026' in the hospital's clock, never the browser's and never a US parse", () => {
  const P = sandbox().WSQPrint;
  assert.equal(P.date("2026-09-14T20:00:00.000Z", { utcOffsetMinutes: 330 }), "15 Sep 2026, 01:30", "an early-morning IST time is not the previous day");
  assert.equal(P.date("2026-09-14T20:00:00.000Z", { timeZone: "Asia/Kolkata" }), "15 Sep 2026, 01:30");
  assert.equal(P.date("2026-03-09T03:30:00.000Z", { timeZone: "America/New_York", utcOffsetMinutes: -300 }), "08 Mar 2026, 23:30", "the zone's own rules, daylight saving included");
  assert.equal(P.date("2026-09-14T20:00:00.000Z", { timeZone: "Not/AZone", utcOffsetMinutes: 330 }), "15 Sep 2026, 01:30", "an unknown zone falls back to the offset");
  assert.equal(P.date("2026-09-14T20:00:00.000Z", null), "14 Sep 2026, 20:00 UTC", "no clock at all says UTC rather than pretending");
  assert.equal(P.date("2026-09-14T20:00:00.000Z", { utcOffsetMinutes: 330 }, false), "15 Sep 2026");
  assert.equal(P.date("1970-01-01", { utcOffsetMinutes: -300 }), "01 Jan 1970", "a date of birth is not moved by a clock");
  assert.equal(P.date("03/04/2026", { utcOffsetMinutes: 330 }), "03/04/2026", "not ISO: printed as stored, never guessed");
  assert.equal(P.date("", {}), "");

  const sb = withFakeTelugu(sandbox());
  const en = strip(sb.WARD._render(copyState(sb, { pcopyLang: "te" })));
  assert.ok(en.includes("Deepa</b> &middot; MRN-0042 &middot; 01 Jan 1970"));
  assert.ok(en.includes('<div class="w-dt-times">15 Sep 2026, 01:30</div>'), "result time in the hospital's clock");
  assert.ok(en.includes("<li>20 Sep 2026, 10:00 &middot; Dr Rao</li>"));
  const dc = sb.DISCHARGE._printable(dcState({ signed: true, signedBy: "Dr Rao", recordedAt: "2026-09-10T07:15:00.000Z" }));
  assert.ok(dc.includes("<span>Admitted</span><b>08 Sep 2026, 01:30</b>") && dc.includes("Signed by Dr Rao on 10 Sep 2026, 12:45"));
});

test("THE CLOSED LIST: the server's codes are exactly the catalog's rx.instr keys, in order; negated ones say 'Do not'; both order forms offer it", () => {
  const sb = sandbox();
  assert.deepEqual([...sb.WSQPrint.instructionCodes()], [...PATIENT_INSTRUCTIONS]);
  const en = sb.WSQI18n._catalogs.en;
  for (const c of PATIENT_INSTRUCTIONS) {
    const v = en["rx.instr." + c];
    if (/\b(not|no|never|avoid)\b/i.test(v)) assert.match(v, /^Do not /, c + ": a negated instruction is worded 'Do not', so its negation is checkable in every language");
  }
  assert.equal(sb.WSQPrint.instruction("retired-code", "te"), "retired-code", "a code the catalog lost prints as itself, never blank");
  const W = sb.WARD;
  const chartSel = { encounterId: "e1", patientId: "p1", ward: "A", bed: "1", admittedAt: "2026-09-07T04:00:00.000Z" };
  const consult = W._render({ ...W._st, view: "consultation", sel: chartSel });
  for (const c of PATIENT_INSTRUCTIONS) assert.ok(consult.includes('class="wcInstr" value="' + c + '"'), "consultation offers " + c);
  assert.ok(/Instructions for the patient/.test(consult));
  const bare = sandbox({ noPrint: true });
  assert.ok(!bare.WARD._render({ ...bare.WARD._st, view: "consultation", sel: chartSel }).includes("wcInstr"), "without the catalog helper there is no list to pick from, rather than free text");
  assert.ok(!bare.WARD._render(copyState(bare, { pcopyLang: "te" })).includes("p-tr"), "and without it the copy prints English only");
  assert.match(read("ward.js"), /instructionPicker\("wMoInstr", \[\]\)/, "the chart's own prescribing card offers it too");
});

test("the language file loader uses portal.js's cache token, and is wired to the pickers", () => {
  const sb = sandbox();
  assert.equal(String(sb.WSQPrint.LANG_FILES_V), /var LANG_FILES_V = (\d+);/.exec(read("wardsynq/site/portal.js"))[1]);
  assert.equal(sb.WSQPrint.valid("en"), false, "English is never the second language");
  assert.equal(sb.WSQPrint.valid("../x"), false);
  assert.equal(sb.WSQPrint.valid("gu"), false, "only the portal's languages");
  assert.match(read("ward.js"), /t\.id === "wPcopyLang"/);
  assert.match(read("discharge.js"), /e\.target\.id !== "dPrintLang"/);
  for (const page of ["wardsynq/site/index.html", "index.html"]) {
    const html = read(page);
    assert.ok(html.indexOf("/wardsynq/site/i18n.js?v=") < html.indexOf("/wardsynq/site/print-lang.js?v=") && html.indexOf("/wardsynq/site/print-lang.js?v=") < html.indexOf("/ward.js?v="), page + ": i18n, then print-lang, then ward.js");
  }
});
