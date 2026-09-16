/* test/wardsynq-i18n-unwrapped.test.mjs - no English reaches a staff screen around the catalog.
 *
 * Owner, 2026-09-16: with Telugu picked, screens still showed English, because text that never went through the
 * catalog cannot be translated however complete the catalog is. scripts/wardsynq-i18n-unwrapped.mjs finds string
 * literals a screen would show as words (text between tags, a title/placeholder/aria-label, a sentence) that are not
 * an argument of the translation helpers. Each file's candidates must be exactly its ALLOWLIST below: a new visible
 * English literal fails here until it is wrapped (wT/wTH/wTA/wTD/wTS in ward.js and discharge.js, T/TS on the site)
 * or, deliberately, listed with its reason. A stale entry fails too, so the list stays the true set of exceptions.
 * Also pinned: the quality measures' server codes all have screen text, a server sentence that changed is shown as
 * sent, icon ligature names are never catalog words, and a count is never pluralised by gluing "s" onto a key.
 *
 * node --test test/wardsynq-i18n-unwrapped.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { unwrapped, WARD_HELPERS, SITE_HELPERS } from "../scripts/wardsynq-i18n-unwrapped.mjs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

/* The deliberate exceptions, by file and reason. Values are the literal as the source spells it (after JS decoding). */
const ALLOW = {
  "ward.js": {
    "a class name or an HTML fragment carrying only laterality, which is recorded as given and never translated": [
      " fill",
      "</option><option value=\"left\">Left</option><option value=\"right\">Right</option><option value=\"bilateral\">Bilateral</option></select></label>",
      ">Left</option><option value=\"right\"", ">Right</option><option value=\"bilateral\"", ">Bilateral</option></select></label>",
    ],
    "written INTO a clinical note or order text that is sent and kept as recorded (the record stays in one language)": [
      "[Clinical note and instruction for ", "[Instruction for ", "Nurse", "Resident", "Laboratory", "Pharmacy", "Billing", "Care team",
      "[Urgency: ", " over ", " (IV infusion", "IV infusion",
      "2D echocardiography: LVEF ", "not reported", " | RWMA: ", " | Valves: ", " | PASP: ", " | Pericardium: ",
      "Radial", "Coronary angiogram (", "): LMCA ", " | LAD ", " | LCx ", " | RCA ", " | Intervention: ",
      "Overbooked at the desk's request",
    ],
    "clinical: a fluid, a regimen, a drug, a laboratory test and its reference range, or an example of a dose or finding": [
      "<option value=\"100 mL D25\">100 mL D25 (25% Dextrose)</option>", "<option value=\"100 mL NS\">100 mL 0.9% Normal Saline (NS)</option>",
      "<option value=\"500 mL NS\">500 mL 0.9% Normal Saline (NS)</option>", "<option value=\"500 mL RL\">500 mL Ringer Lactate (RL)</option>",
      "<option value=\"500 mL D5W\">500 mL 5% Dextrose (D5W)</option>", "<option value=\"100 mL D5W\">100 mL 5% Dextrose (D5W)</option>",
      "<option value=\"250 mL NS\">250 mL Normal Saline (NS)</option>",
      "</span><input id=\"wMoDiluentVal\" type=\"text\" placeholder=\"e.g. 100 mL D25\"></label>",
      "</span><input id=\"wCardioPasp\" type=\"text\" placeholder=\"e.g. 28 mmHg\"></label>",
      "<label class=\"w-f\"><span>LMCA</span><input id=\"wCardioLmc\" placeholder=\"e.g. Normal / 50% ostial\"></label>",
      "<label class=\"w-f\"><span>LAD</span><input id=\"wCardioLad\" placeholder=\"e.g. 90% mid stenosis\"></label>",
      "<label class=\"w-f\"><span>RCA</span><input id=\"wCardioRca\" placeholder=\"e.g. 70% proximal\"></label>",
      "<div style=\"position:relative;\"><textarea id=\"wTlNote\" class=\"w-input\" rows=\"5\" placeholder=\"Admitted with community-acquired pneumonia. Started on co-amoxiclav 1.2 g IV TDS. Observations improving, remains on 2 L oxygen.\">",
      ", Vt ", ", PEEP ", ", FiO2 ", ", EDD ",
      "4 mg in 50 mL",
      "</span><textarea id=\"wQcmTargets\" rows=\"4\" placeholder=\"Potassium | 4.0 | 0.1 | mmol/L\"></textarea></label>",
      "AC (Doxorubicin + Cyclophosphamide)", "Doxorubicin", "AC-T (Doxorubicin + Cyclophosphamide -> Paclitaxel)", "Paclitaxel",
      "mFOLFOX6 (Oxaliplatin + Leucovorin + 5-FU)", "Oxaliplatin", "FOLFIRI (Irinotecan + Leucovorin + 5-FU)", "Irinotecan",
      "R-CHOP (Rituximab + CHOP)", "Rituximab", "ABVD (Hodgkin Lymphoma)", "Carboplatin + Paclitaxel", "Carboplatin",
      "CBC / Hemogram", "Hemoglobin", "TLC / Total Leucocyte Count", "Platelet Count", "RBC Count", "Neutrophils", "Lymphocytes", "Eosinophils",
      "Monocytes", "PCV / Packed Cell Volume", "Liver Function Test (LFT)", "Bilirubin (Total)", "Bilirubin (Direct)", "Alkaline Phosphatase (ALP)",
      "Total Protein", "Serum Albumin", "Serum Globulin", "Renal Function Test (RFT / KFT)", "Blood Urea", "Serum Creatinine",
      "Blood Urea Nitrogen (BUN)", "Serum Uric Acid", "Serum Electrolytes", "Sodium (Na+)", "Potassium (K+)", "Chloride (Cl-)", "Bicarbonate (HCO3-)",
      "Total Cholesterol", "Triglycerides", "HDL Cholesterol", "LDL Cholesterol", "VLDL Cholesterol", "Malarial Parasite (Smear/Card)",
      "Widal / Typhidot", "Dengue NS1 Antigen", "Dengue IgM / IgG", "Urine Routine (Pus cells)", "C-Reactive Protein (CRP)",
      "Coagulation Profile (PT/INR)", "Prothrombin Time (PT)", "Control PT", "Arterial Blood Gas (ABG)", "Base Excess", "-2 to +2",
    ],
    "an internal name compared or looked up, shown only through its translation (labPartName, the ward list's no-ward group)": [
      "tests awaiting a result", "results awaiting verification", "cultures in progress", "critical results", "ward roster",
      "imaging worklist", "critical findings", "held messages", "No ward assigned", "analyser results",
    ],
    "a code, an action separator, an element id suffix or a keyboard key name": ["Invoice", "Incident", "~done~", "~cancel~", "Tpl", "Escape", "Esc"],
  },
  "discharge.js": {
    "the PRINTED summary is English whole; its second language is print-lang.js": [
      ", bed ", " <em>clinician edited</em>", "<div class=\"p-sig\"><div class=\"ln\"></div><span>Signed by ", " &middot; version ",
      "<div class=\"p-sig\"><div class=\"ln\"></div><span>Signature</span><p class=\"p-draft\">UNSIGNED DRAFT - not a final discharge summary.</p></div>",
      "<h1>Discharge summary</h1><div class=\"p-head\">", "<section class=\"p-prov\"><h2>Provenance</h2><p>",
    ],
    "a class name; the assembler's absence marker compared against; the English original under a translated refusal": [
      " fill", "Not recorded.", "<span class=\"en-orig\" lang=\"en\">Refused</span>",
    ],
  },
  "patient-register.js": {
    "the default submit label before open() translates it (the phone app has no catalog)": ["Add to queue"],
  },
  "wardsynq/site/bug-reporter.js": {
    "the developer's Markdown copy and the stored report stay English": [
      "- **Severity**: ", "- **Location**: ", "- **URL**: ", "- **Active Patient**: ", " (Bed: ", "- **Target Element**: `",
      "- **Parent Component**: ", "- **Description**: ", "- **Recent Console Errors (", "Error",
    ],
    "a reason stored with the report, shown through reasonText()": ["no hospital is open on this device", "the server did not accept it", "no connection to the server"],
  },
  "wardsynq/site/pages/hr.js": {
    "a suggested council or certificate name, typed into the staff record and kept as entered (a recorded value, never translated)": ["State medical council", "State nursing council", "State pharmacy council"],
  },
  "wardsynq/site/pages/engage.js": {
    "a channel order code saved to the hospital's settings, compared and sent, never shown": ["whatsapp,sms", "sms,whatsapp"],
  },
  "wardsynq/site/pages/admin.js": {
    "a record type or a lookup suffix, not words": ["Invoice", "Incident", "Org", "Bundle"],
  },
  "wardsynq/site/pages/lab-analysers.js": {
    "the mapping format shown as an example: an instrument code, a laboratory test, its unit and a panel, entered as recorded": ["<textarea id=\"labAnMap\" rows=\"8\" class=\"mono\" style=\"width:100%\" placeholder=\"K | Potassium | mmol/L | Renal profile\">"],
  },
  "wardsynq/site/pages/patients.js": {
    "the print stylesheet that prints only the Scan and Share QR sheet (CSS, not words)": [
      "@media print { body > *:not(#pSharePrint) { display: none !important; } #pSharePrint { display: block !important; } } #pSharePrint { display: none; }",
    ],
  },
  "wardsynq/site/pages/registers.js": {
    "the print window's stylesheet, not words": ["</title><style>body{font:12px sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #444;padding:3px;vertical-align:top}</style><h2>"],
  },
};
const WARD_FILES = ["ward.js", "discharge.js", "patient-register.js"];
const SITE_FILES = ["wardsynq/site/shell.js", "wardsynq/site/bug-reporter.js", "wardsynq/ui/wardsynq-app.js",
  ...["abdm", "accounts", "admin", "audit", "engage", "governance", "group", "hr", "lab-analysers", "maik", "patients", "portal-access", "registers", "rota", "security", "stores", "assets", "bloodbank", "support"].map((p) => "wardsynq/site/pages/" + p + ".js")];

for (const file of [...WARD_FILES, ...SITE_FILES]) {
  test("no unwrapped visible English in " + file + " beyond its allowlist", () => {
    const found = unwrapped(read(file), WARD_FILES.includes(file) ? WARD_HELPERS : SITE_HELPERS);
    const allowed = new Set(Object.values(ALLOW[file] || {}).flat());
    const fresh = [...new Set(found.filter((x) => !allowed.has(x.value)).map((x) => file + ":" + x.line + " " + JSON.stringify(x.value)))];
    assert.deepEqual(fresh, [], "visible English that does not go through the catalog: wrap it, or allowlist it here with the reason");
    const seen = new Set(found.map((x) => x.value));
    assert.deepEqual([...allowed].filter((v) => !seen.has(v)), [], "allowlist entries no longer in " + file + ": remove them");
  });
}

test("the scanner itself: a bare sentence, a title and text between tags are found; wrapped, sent and class strings are not", () => {
  const src = [
    'function v(x) { return "<p>Loading the ward</p>" + "<b title=\\"Refresh\\">" + wTH("ward.k", "Done") + "</b>"; }',
    'function w(x) { st.err = "Could not reach the server."; apiPost("/ward/x", { reason: "sent as recorded" }); return x === "compared value" ? " w-btn ghost" : ""; }',
  ].join("\n");
  const vals = unwrapped(src, WARD_HELPERS, { known: new Set() }).map((x) => x.value);
  assert.ok(vals.includes("<p>Loading the ward</p>"));
  assert.ok(vals.includes("<b title=\"Refresh\">"));
  assert.ok(vals.includes("Could not reach the server."));
  assert.ok(!vals.includes("Done") && !vals.includes("compared value") && !vals.includes("sent as recorded"), vals.join(" | "));
});

// ---- keys of the files added to the ward block ------------------------------------------------------------------
const I18N_SRC = read("wardsynq/site/i18n.js");
const EN = (() => { const sb = {}; vm.runInNewContext(I18N_SRC, { window: sb }); return sb.WSQI18n._catalogs.en; })();
const WARD_CALL = /\bwT[HADS]?\(("(?:[^"\\]|\\.)*"), ("(?:[^"\\]|\\.)*")/g;

for (const [file, least] of [["discharge.js", 60], ["patient-register.js", 40]]) {
test(file + ": every key is in the ward.js block of EN with byte-identical English", () => {
  const src = read(file), start = I18N_SRC.indexOf("/* ward.js keys (ui-i18n-ward) */"), end = I18N_SRC.indexOf("/* end ward.js keys */");
  let n = 0;
  for (const m of src.matchAll(WARD_CALL)) {
    const k = JSON.parse(m[1]);
    assert.equal(EN[k], JSON.parse(m[2]), k);
    assert.ok(I18N_SRC.slice(start, end).includes(JSON.stringify(k) + ":"), k + " sits in the ward block");
    n++;
  }
  assert.ok(n > least, "the screen is converted (" + n + ")");
});
}

test("ward.js: wTS keys (server text by code) are in EN with byte-identical English", () => {
  let n = 0;
  for (const m of read("ward.js").matchAll(/\bwTS\(("(?:[^"\\]|\\.)*"), ("(?:[^"\\]|\\.)*")/g)) { assert.equal(EN[JSON.parse(m[1])], JSON.parse(m[2]), m[1]); n++; }
  assert.ok(n >= 30, "the quality measures' texts (" + n + ")");
});

// ---- server codes -> screen ---------------------------------------------------------------------------------------
test("every code the quality reports send beside their English has screen text in ward.js", async () => {
  const { computeMeasures, computeQualitySafety } = await import("../functions/_wardsynq/quality.js");
  const w = read("ward.js");
  const FROM = Date.parse("2026-09-01T00:00:00.000Z"), TO = Date.parse("2026-09-08T00:00:00.000Z");
  const at = (h) => new Date(FROM + h * 3600000).toISOString();
  const rows = [
    // nothing configured: the reasons a measure names instead of a number
    ...computeMeasures({ fromMs: FROM, toMs: TO, ackWindowMinutes: null, administrations: [{ status: "administered", administeredAt: at(1) }] }),
    // one and two cases: the two "too few" notes
    ...computeMeasures({ fromMs: FROM, toMs: TO, ackWindowMinutes: 30, loops: [{ reportedAt: at(1), acknowledgedAt: at(1.1) }] }),
    ...computeMeasures({ fromMs: FROM, toMs: TO, ackWindowMinutes: 30, loops: [{ reportedAt: at(1), acknowledgedAt: at(1.1) }, { reportedAt: at(2) }] }),
    // every record type unreadable
    ...computeQualitySafety({ fromMs: FROM, toMs: TO, antibiotics: ["x"], beds: { A: ["1"] },
      unreadable: { Encounter: "not readable with this role", Patient: "not readable with this role", ResusBundle: "read failed", IncidentReport: "read failed", MedicationAdministration: "read failed", ServiceRequest: "read failed", DiagnosticReport: "read failed", WoundAssessment: "read failed" } }).measures,
    // readable, nothing configured and no bed-days
    ...computeQualitySafety({ fromMs: FROM, toMs: TO, encounters: [], antibiotics: [], beds: {} }).measures,
    // a configured bed list: the note beside bed utilisation
    ...computeQualitySafety({ fromMs: FROM, toMs: TO, encounters: [], antibiotics: [], beds: { A: ["1"] } }).measures,
  ];
  const codes = new Set(), ids = new Set();
  for (const m of rows) {
    ids.add(m.id);
    for (const [c, text] of [[m.reasonCode, m.reason], [m.noteCode, m.note], [m.note2Code, m.note2]]) if (c) { codes.add(c); assert.ok(text, c + " carries no English"); }
  }
  for (const c of ["no-escalation-window", "no-due-times", "no-allergy-status-record", "type-unreadable", "records-unreadable",
    "no-antibiotic-list", "administrations-unreadable", "reports-unreadable", "no-beds-configured", "too-few-cases-one", "too-few-cases",
    "no-bed-days", "below-minimum", "beds-not-subtracted", "deaths-source", "readmissions-all-unplanned"]) assert.ok(codes.has(c), "the report sends " + c);
  for (const c of codes) assert.ok(w.includes('case "' + c + '": return wTS('), "ward.js qmText has " + c);
  for (const id of ["critical-ack-within-window", "dose-on-time", "discharge-summary-signed", "allergy-status-documented", "length-of-stay",
    "falls", "lab-tat", "bed-utilisation", "inpatient-mortality", "sepsis-bundle-compliance"]) assert.ok(ids.has(id), "the report sends " + id);
  for (const id of ids) assert.ok(w.includes('case "' + id + '": return'), "ward.js qmTitle has " + id);
});

function loadWard(lang, extra) {
  const sb = { navigator: { userAgent: "node" }, location: { hash: "", href: "" }, document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [], documentElement: {} },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date };
  sb.window = sb; sb.self = sb;
  vm.createContext(sb);
  if (lang) {
    vm.runInContext(I18N_SRC, sb);
    const te = {}; for (const k of Object.keys(sb.WSQI18n._catalogs.en)) if (k.indexOf("ward.") === 0) te[k] = "TE[" + sb.WSQI18n._catalogs.en[k] + "]";
    sb.WSQI18n.register("te", "Test", Object.assign(te, extra || {}), { reviewed: false });
    sb.WSQ = { state: { navLang: lang } };
  }
  vm.runInContext(read("ward.js"), sb);
  return sb.WARD;
}

test("ward home: quality measures and the ward team counts are translated from the server's codes; a changed server sentence shows as sent", async () => {
  const { computeMeasures } = await import("../functions/_wardsynq/quality.js");
  const measures = computeMeasures({ fromMs: 0, toMs: Date.parse("2026-09-08T00:00:00Z"), ackWindowMinutes: null, graceMinutes: 60,
    loops: [], administrations: [{ status: "administered", administeredAt: "2026-09-03T00:00:00Z" }], encounters: [], summaries: [] });
  const W = loadWard("te");
  const quality = { ok: true, period: { days: 30 }, measures, notComputable: measures.filter((m) => !m.computable).length };
  const html = W._render(JSON.parse(JSON.stringify({ ...W._st, orgId: "org-1", loaded: true, view: "list", patients: [], quality })));
  assert.match(html, /TE\[Critical results acknowledged within the escalation window\]/);
  assert.match(html, /TE\[Admissions with an allergy status documented\]/);
  assert.match(html, /TE\[This hospital has configured no escalation window/);
  assert.match(html, /TE\[None of the <span lang="en">1<\/span> doses given in this period/, "the numbers ride in the translation as values");
  // a sentence the server changed: shown as the server sent it, never as the translation of the old one
  const changed = measures.map((m) => (m.id === "allergy-status-documented" ? { ...m, reason: "A new sentence from the server." } : m));
  const html2 = W._render(JSON.parse(JSON.stringify({ ...W._st, orgId: "org-1", loaded: true, view: "list", patients: [], quality: { ...quality, measures: changed } })));
  assert.match(html2, /A new sentence from the server\./);
  assert.doesNotMatch(html2, /TE\[WardSynQ cannot record/);
  // English picked: exactly the server's English
  const E = loadWard();
  const en = E._render(JSON.parse(JSON.stringify({ ...E._st, orgId: "org-1", loaded: true, view: "list", patients: [], quality })));
  assert.match(en, /This hospital has configured no escalation window, so there is no threshold to measure against\./);
  assert.ok(!en.includes("TE["));
});

test("ward team counts: one phrase per role with its number, singular and plural as the English has them", () => {
  const board = (W) => W._render(JSON.parse(JSON.stringify({ ...W._st, orgId: "org-1", loaded: true, view: "critsboard",
    critsBoard: [{ loopId: "l1", patientId: "p1", encounterId: "e1", name: "A", display: "K", value: "6.9", unit: "mmol/L", state: "open", escalation: {},
      notifications: [{ wardRule: { rule: "all-on-duty-ward-team", ward: "Medical A", counts: { nurse: 0, resident: 1, consultant: 2 } } }] }] })));
  assert.match(board(loadWard()), /0 nurses, 1 resident, 2 consultants/);
  const te = board(loadWard("te"));
  assert.match(te, /TE\[0 nurses\], TE\[1 resident\], TE\[2 consultants\]/);
});

test("icon ligature names are never catalog words, and no count is pluralised by gluing a suffix onto a translation", () => {
  const w = read("ward.js");
  assert.doesNotMatch(w, /\b(card|icuHead)\(wT[HA]?\(/, "an icon argument went through the catalog");
  assert.doesNotMatch(w, /wsBlock\(wT\("[^"]*", "[^"]*"\), wT/, "an icon argument went through the catalog");
  assert.doesNotMatch(w, /\? "s" : ""\)|\? "" : "s"\)|"y" : "ies"/, "a plural glued as a suffix: use a key for one and a key for many");
});

// ---- server status codes rendered untranslated as text (WardSynQ live retest item) --------------------------------
/* A server enum code (o.state, inv.status, r.urgency, ...) reaching esc() directly, with no *Word()/WORDS+wTEn
 * lookup in between, is either a CSS class token (never read as a word: fine, unlisted) or English leaking onto a
 * translated screen exactly as this item describes. A field expression is allowlisted below ONLY when it is not a
 * class token, with the reason it is deliberately left raw. A general parse of "is this inside a class attribute" is
 * not attempted (no HTML-in-JS parser here) - instead, a hit whose nearby text contains `class=` is trusted as a
 * class token, matching every real class-attribute usage in this file (`class="w-st ' + esc(x.state) + '"` and
 * `class="st-' + esc(x.state) + '"` are the only two shapes ward.js uses). Anything else must be in ALLOW or the
 * test fails - so a NEW raw esc(x.status) rendered as text fails here until it is wrapped or allowlisted with why. */
const RAW_STATUS_FIELD = /esc\(([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*\.(?:state|status|kind|priority|urgency|phase|stage|outcome|decision|disposition|category|type|mode|level|severity|result))\)/g;
const RAW_STATUS_ALLOW = {
  "x.mode": "ICU ventilator mode (VENT_MODES in functions/_wardsynq/icu-care.js): fixed clinical abbreviations (VC-AC, PSV, HFNC, ...), not English prose words",
  "l.type": "line type: free text the clinician types (placeholder \"e.g. UVC, PICC\" at wLineType), not a server enum",
  "r.level": "a stock quantity number (inventory/pharmacy stock level), not a status code",
  "m.level": "a QC control material's level as the laboratory named it (1, 2, Low, High), recorded content, not a server enum",
  "hit.result": "antibiotic susceptibility result (SUSCEPTIBILITY_RESULTS in functions/_wardsynq/pathology-report.js): the standard S/I/R/SDD microbiology codes, not English words",
  "b.kind": "BOTTLENECK_WORDS[b.kind] already covers the mapped word; this is its own explicit lang=\"en\" fallback for a kind the map does not know",
  "s.level": "a stock quantity inside a report row already wrapped '<span lang=\"en\">...", // the report intentionally marks its own values English
  "c.stage": "a wound stage (mostly the digits 1-4) interpolated through wTH's own wrap list, which already marks it lang=\"en\" by the file's own convention for values not treated as translatable words",
  "c.bill.state": "BILL_WORDS[c.bill.state] already covers every known code; this is its own explicit fallback for one it does not know",
};
test("ward.js: a raw server state/status/kind code is never rendered as visible text (only as a CSS class, or explicitly allowlisted with why)", () => {
  const w = read("ward.js"), lines = w.split("\n");
  const fresh = [];
  lines.forEach((line, i) => {
    RAW_STATUS_FIELD.lastIndex = 0;
    let m;
    while ((m = RAW_STATUS_FIELD.exec(line))) {
      const before = line.slice(Math.max(0, m.index - 30), m.index);
      if (/class=/.test(before)) continue; // a CSS class token, never read as a word
      if (HAS(RAW_STATUS_ALLOW, m[1])) continue;
      fresh.push("ward.js:" + (i + 1) + " esc(" + m[1] + ")");
    }
  });
  assert.deepEqual(fresh, [], "a server status/kind code rendered as raw text: wrap it in a *Word()/WORDS+wTEn lookup, or allowlist it above with why");
  // a stale allowlist entry (the field no longer appears raw at all) would hide a real fix going forward
  const stillRaw = new Set();
  lines.forEach((line) => {
    RAW_STATUS_FIELD.lastIndex = 0;
    let m;
    while ((m = RAW_STATUS_FIELD.exec(line))) {
      const before = line.slice(Math.max(0, m.index - 30), m.index);
      if (!/class=/.test(before)) stillRaw.add(m[1]);
    }
  });
  for (const field of Object.keys(RAW_STATUS_ALLOW)) assert.ok(stillRaw.has(field), "allowlist entry no longer raw in ward.js, remove it: " + field);
});
function HAS(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
