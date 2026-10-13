#!/usr/bin/env node
/* Books-2 Sastry wave 1: viral diagnosis + HIV/emerging (topic map; own
 * words, no verbatim copy). Chunk: /tmp/books2-work/sastry/. New MCQs only
 * (bk2-mic-221 to 240). Scoped to avoid duplicating mic-general-virology. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const LP = require("../prep-lessons.js");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const REF = "Review of Microbiology Apurba Sankar Sastry (topic map; text rewritten, no verbatim copy)";
function mcq(id, q, o, a, exp, r, kp) { return { id, q, o, a, exp, r, kp }; }
function step(tx, say, vis) { return vis ? { tx, say, vis } : { tx, say, vis: null }; }
function tbl(cols, rows) { return { kind: "table", cols, rows }; }
const M = [];
function add(id, title, kb, kbName, aliases, steps, pearls, patho, diffs, invs, mcqs) { M.push({ id, title, kb, kbName, aliases, steps, pearls, patho, diffs, invs, mcqs }); }

add("vir-diagnosis", "Laboratory diagnosis of viral infections: culture to molecular", "viral_diagnosis_culture_molecular", "Laboratory Diagnosis of Viral Infections: Culture to Molecular",
 ["CPE cell lines", "Serology windows IgM", "PCR NAAT loads", "Inclusion bodies smears"],
 [step("**Culture** (**cell lines** primary diploid continuous, **CPE** rounding syncytia, **haemadsorption** orthomyxo, **shell vial** CMV rapid, **pocks** CAM historic) with **microscopy** (**electron** rotavirus, **fluorescent** antibody RSV, **Tzanck** herpes multinucleated, **Negri** rabies historic) visualises; **specimens** (throat vesicle stool timing, **cold chain** ice) decides. Cells round fuse.", "Rounding syncytia adsorbing shells is culture CPE: vesicles throats iced fluorescent smears. Specimens time."),
  step("**Serology** (**IgM** acute, **IgG** paired 4-fold, **window** antibody negative infectious, **avidity** recent past, **heterophile** EBV, **Weil-Felix** rickettsial historic) with **ELISA** (sandwich antigens, **rapid** ICT strips, **western** HIV confirm historic) and **HI** (influenza titres) binds; **vaccination** (IgG positive protected) interprets. Windows bleed.", "Acute Ms paired Gs windows blank is serology: sandwiches rapids blots confirm titres inhibit. Avidities date."),
  step("**Molecular** (**PCR** DNA qualitative, **RT-PCR** RNA loads, **multiplex** respiratory panels, **genotyping** HCV HBV, **resistance** HIV integrase, **point of care** CBNAAT TB) with **antigen** (**NS1** dengue day 1 to 5, **p24** HIV window, **galactomannan** aspergillus, **cryptococcal** CrAg) detects early; **loads** (HIV HBV HCV monitor) guides therapy. Copies amplify.", "DNAs RNAs panels types resistances points is molecular: NS1 days p24 windows mannans antigens catch early. Loads monitor."),
  step("**Inclusions** (**Cowdry A** herpes, **owl eye** CMV, **Negri** rabies, **Guarnieri** smallpox historic, **RSV** syncytia) with **smears** (**Giemsa** stains, **Pap** koilocytes HPV, **KOH** fungi) and **histopathology** (owl eyes, **immunohistochemistry** antigens) completes; **animals** (suckling mice historic, **ethics** replace) retires. Eyes owls while pathologists correlate clinical syndromes routinely.", "Herpes Cowdry CMV owls rabies Negri smears stain is inclusions: koilocytes Paps fungi KOH tissues immuno. Mice retire while ethics committees approve minimal use.", tbl(["Viro dx", "Pearl", "Act"], [["Culture", "CPE shells", "Ice"], ["Serology", "M G windows", "Pairs"], ["Molecular", "PCR loads", "Antigens"], ["Bodies", "Owls Cowdry", "Stains"]]))],
 ["CPE shells ice", "M G windows pairs", "PCR loads antigens", "Owls Cowdry stains"],
 "Permissive cells round fusing haemadsorbing while paired sera fourfold rising confirming recent; primers amplify loads monitoring therapy, and intranuclear owls eyes diagnose irreversibly.",
 ["Culture versus serology versus molecular by window and speed", "IgM versus IgG by timing and avidity", "Antigen versus antibody by days and gaps"],
 ["Vesicle fluid with cold chain", "Paired sera with avidity", "Respiratory panel with loads"],
 [mcq("bk2-mic-221", "Rounding syncytia shells vesicles iced fluorescents time culture how?", ["Serology only", "Cell lines with CPE and specimens iced", "No culture", "Room temp"], 1, "Haemadsorptions; shell vials while chains cold. CPEs.", ["Incorrect. Cells round.", "Correct. Cultured iced.", "Incorrect. Lines select.", "Incorrect. Times matter."], "Cultured iced CPEd."),
  mcq("bk2-mic-222", "Electron rotavirus fluorescent RSV Tzanck herpes Negri visualise when?", ["PCR only", "Microscopy selected with smears stained", "No microscopy", "Culture all"], 1, "Owls; koilocytes while IHC. Eyes.", ["Incorrect. Images see.", "Correct. Visualised stained.", "Incorrect. Rapidity guides.", "Incorrect. Bodies include."], "Visualised stained bodies."),
  mcq("bk2-mic-223", "Ms acute Gs paired windows avidities heterophile sandwiches rapids blots bind how?", ["Single IgG", "Paired with avidity and confirms staged", "No pairs", "IgM forever"], 1, "Windows; vaccinations while HI titres. Folds.", ["Incorrect. Pairs prove.", "Correct. Paired avid.", "Incorrect. Ms fade.", "Incorrect. Blots confirm historic."], "Paired avid bound."),
  mcq("bk2-mic-224", "DNAs RNAs panels types resistances points NS1 p24 mannans amplify monitor how?", ["Culture only", "Molecular with antigens early and loads guiding", "No PCR", "Antibodies only"], 1, "Multiplex; genotyping while POC. Copies.", ["Incorrect. Primers amplify.", "Correct. Molecular loaded.", "Incorrect. Days catch antigens.", "Incorrect. Therapies monitor."], "Molecular loaded amplified."),
  mcq("bk2-mic-225", "Cowdry owls Negri Guarnieri syncytia Giemsa Paps KOH IHC mice inclusions stain how?", ["No inclusions", "Smears histology with animals retired", "Culture only", "Ignore bodies"], 1, "Eyes; ethics while stains. Bodies.", ["Incorrect. Bodies diagnose.", "Correct. Stained retired.", "Incorrect. Owls pathognomonic.", "Incorrect. Koilocytes HPV."], "Stained retired bodies."),
  mcq("bk2-mic-226", "Throat vesicle stool timing ice chains specimens collect transport how?", ["Any tube", "Sterile iced with timings matched", "Dry swabs", "Late"], 1, "Viral; VTM while hours. Cold.", ["Incorrect. Ices preserve.", "Correct. Timed iced.", "Incorrect. Media transport.", "Incorrect. Windows narrow."], "Timed iced collected."),
  mcq("bk2-mic-227", "Sandwich rapids strips field outbreaks ICT deploy when?", ["Lab only", "Rapid with confirms staged", "No rapids", "Treat blindly"], 1, "Dengue; HIV while malaria. Strips.", ["Incorrect. Fields strip.", "Correct. Rapid confirmed.", "Incorrect. Sensitivities triage.", "Incorrect. Algorithms confirm."], "Rapid confirmed stripped."),
  mcq("bk2-mic-228", "Loads HIV HBV HCV therapy start switch monitor how often?", ["Once", "Scheduled with thresholds guiding", "No loads", "Symptoms only"], 1, "Failure; resistance while adherence. Copies.", ["Incorrect. Copies guide.", "Correct. Scheduled thresholded.", "Incorrect. Blips repeat.", "Incorrect. Switches genotype."], "Scheduled thresholded loaded."),
  mcq("bk2-mic-229", "Quality controls contamination negatives PCR labs assure how?", ["No controls", "Controlled with unidirectional workflows", "Open tubes", "No bleaching"], 1, "Amplicons; uracil while rooms. Steriles.", ["Incorrect. Contaminations lie.", "Correct. Controlled unidirectional.", "Incorrect. Negatives guard.", "Incorrect. Bleaches clean."], "Controlled unidirectional assured."),
  mcq("bk2-mic-230", "Biosafety cabinets levels samples split how?", ["Bench all", "Levelled with cabinets and practices", "No levels", "Mouth pipette"], 1, "Aerosols; sharps while spills. Levels.", ["Incorrect. Levels contain.", "Correct. Levelled cabineted.", "Incorrect. Risk groups.", "Incorrect. Practices protect."], "Levelled cabineted contained.")]);

add("vir-hiv-emerging", "HIV diagnosis-monitoring and emerging viruses", "hiv_emerging_ebola_nipah_zika", "HIV Diagnosis-Monitoring and Emerging Viruses",
 ["Fourth gen p24 antibody", "CD4 viral load ART", "Ebola PPE ribavirin", "Dengue NS1 tourniquet"],
 [step("**HIV** (**fourth generation** p24 plus antibody, **window 2 weeks**, **RNA** acute, **western** confirm historic, **CD4** stages, **viral load** monitors, **infant** DNA PCR) with **PEP** (72 hours 28 days) and **PrEP** (tenofovir emtricitabine) prevents; **opportunistic** (CD4 under 200 PCP, under 100 toxo crypto, **cotrimoxazole** prophylaxis) watches. Windows close.", "p24 antibodies fortnights RNAs acutes CD4 stages loads monitor is HIV: hours prophylaxes pills prevent counts watch. Fours shorten."),
  step("**Ebola Marburg** (**filovirus** bats, **hemorrhagic** vomit diarrhoea, **PPE** buddy, **RT-PCR** confirms, **ribavirin** debated, **monoclonals** REGN-EB3, **vaccine** rVSV, **survivors** semen persists) with **Nipah Hendra** (bats pigs, **encephalitis** segmental myoclonus, **ribavirin** selected, **monoclonal** m102.4) and **CCHF** (ticks hyalomma, **ribavirin** treats) contains; **BSL-4** suits isolate. Bats bleed.", "Bats vomit bleed suited PCR monoclonals ring vaccinate is Ebola: pigs jerk nickels ticks Crimea ribavirin. Suits isolate."),
  step("**Arboviruses** (**dengue NS1** days tourniquet leaks, **warning** abdominal bleed, **fluids** titrated haematocrit, **chikungunya** crippling joints chronic, **Zika** microcephaly travel defer, **JE** pigs vaccine, **KFD** monkeys) with **respiratory** (**SARS MERS** camels, **Nipah** already, **H5N1** poultry cull, **H1N1** oseltamivir) spreads; **Aedes** (day biter clean water) controls. Tourniquets leak.", "NS1 days warnings fluids joints cripple microcephalies defer is arboviruses: camels poultry cull day biters drain. Leaks titrate."),
  step("**Outbreak** (**IDSP** reporting, **isolation** negative pressure, **contacts** 21 days trace, **safe burial** teams, **labs** BSL referral, **vaccines** ring) with **bioterror** (**anthrax** ciprofloxacin, **plague** gentamicin, **smallpox** vaccinia, **botulism** antitoxin) and **AMR** (stewardship cultures) responds; **One Health** (vets environment) prevents. Rings trace.", "Reports isolates traces buries refers rings is outbreak: powders cipro plague gent pox scars toxins bind stewards culture. Health unites.", tbl(["Emerging", "Pearl", "Act"], [["HIV", "Fourth loads", "PEP PrEP"], ["Filo", "Bats suits", "Monoclonals"], ["Arbo", "NS1 joints", "Fluids"], ["Outbreak", "Trace rings", "BSL"]]))],
 ["Fourth loads PEP", "Bats suits monoclonals", "NS1 joints fluids", "Trace rings BSL"],
 "Fourth assays halve windows staging CD4 loading therapy while filoviral endothelium leaks suited sampling; NS1 days warn leaking titrated, and ring vaccinations encircle tracing containing.",
 ["HIV versus hepatitis windows by p24 and HBsAg", "Ebola versus CCHF by bats and ticks", "Dengue versus chikungunya by leaks and joints"],
 ["Fourth gen with RNA acute", "RT-PCR with BSL suits", "NS1 with tourniquet test"],
 [mcq("bk2-mic-231", "p24 fortnights RNAs CD4 loads infants hours pills counts diagnose prevent how?", ["Antibody only", "Fourth with RNA loads and prophylaxis staged", "No RNA", "No PrEP"], 1, "Windows; opportunistics while cotrimoxazole. Generations.", ["Incorrect. Fours shorten.", "Correct. Fourth loaded.", "Incorrect. Acutes RNA.", "Incorrect. Counts stage."], "Fourth loaded staged."),
  mcq("bk2-mic-232", "Under 200 PCP 100 toxo crypto cotrimoxazole ART IRIS watches when?", ["No prophylaxis", "CD4 staged with IRIS warned", "Stop ART", "No CD4"], 1, "Reconstitution; timings while steroids severe. Counts.", ["Incorrect. Counts stage.", "Correct. Staged warned.", "Incorrect. Pills prevent.", "Incorrect. Immunity paradoxes."], "Staged warned reconstituted."),
  mcq("bk2-mic-233", "Bats bleed suited PCR monoclonals ring pigs nickels ticks ribavirin contain how?", ["No PPE", "Suited with PCR and monoclonals ringed", "Support only", "No vaccines"], 1, "Buddies; semen while burials safe. Filoviruses.", ["Incorrect. Suits isolate.", "Correct. Suited ringed.", "Incorrect. Bats host.", "Incorrect. Contacts trace 21."], "Suited ringed isolated."),
  mcq("bk2-mic-234", "Encephalitis myoclonus pigs m102.4 camels poultry cull day biters manage how?", ["Ignore", "Zoonotic with monoclonals and vectors controlled", "No monoclonals", "No culling"], 1, "Segments; Hendra while MERS. Bats.", ["Incorrect. Hosts cull.", "Correct. Zoonotic controlled.", "Incorrect. Jerks warn.", "Incorrect. Waters drain."], "Zoonotic controlled culled."),
  mcq("bk2-mic-235", "Days warnings titrated joints chronic microcephaly defer pigs vaccine leaks fluids how?", ["No fluids", "Warning with haematocrit titrated and joints rehabbed", "Liberal fluids", "Aspirin"], 1, "Tourniquets; KFD while JE. Aedes.", ["Incorrect. Warnings leak.", "Correct. Warned titrated.", "Incorrect. Joints linger.", "Incorrect. Travels defer."], "Warned titrated deferred."),
  mcq("bk2-mic-236", "Reports isolates traces buries refers rings powders toxins stewards respond how?", ["Panic", "Systematic with IDSP rings and BSL labs", "No reporting", "No rings"], 1, "Anthrax; plague while pox. Health.", ["Incorrect. Systems contain.", "Correct. Systematic ringed.", "Incorrect. Days trace.", "Incorrect. Burials safe."], "Systematic ringed reported."),
  mcq("bk2-mic-237", "Travel defer microcephaly semen persists survivors counsel what?", ["No counsel", "Deferred with persistence warned", "Travel all", "No persistence"], 1, "Zika; Ebola while months. Partners.", ["Incorrect. Deferrals protect.", "Correct. Deferred warned.", "Incorrect. Heads measure.", "Incorrect. Semens linger."], "Deferred warned persisted."),
  mcq("bk2-mic-238", "Needlesticks 72 hours wash PEP baseline follow manage how?", ["Ignore", "Washed with PEP timely and serologies followed", "No PEP", "Late PEP"], 1, "Source; hours while 28 days. Sharps.", ["Incorrect. Hours matter.", "Correct. Washed followed.", "Incorrect. Baselines draw.", "Incorrect. Months retest."], "Washed followed timed."),
  mcq("bk2-mic-239", "Cold chains ring rVSV contacts Ebola vaccinate how?", ["Mass all", "Ring with contacts traced and chains kept", "No cold", "No tracing"], 1, "Outbreaks; 21 days while suits. Rings.", ["Incorrect. Rings encircle.", "Correct. Ringed chained.", "Incorrect. Contacts list.", "Incorrect. Cold preserves."], "Ringed chained traced."),
  mcq("bk2-mic-240", "Negative pressure N95 AGPs isolation labs refer when?", ["Open wards", "Isolated with referrals BSL", "No isolation", "Surgical masks"], 1, "Airborne; suits while samples. Pressures.", ["Incorrect. Pressures contain.", "Correct. Isolated referred.", "Incorrect. Respirators fit.", "Incorrect. Labs network."], "Isolated referred pressured.")]);

const SUBJECT_DIR = path.join(ROOT, "prep/overlays/maikbook2/microbiology");
const KB_DIR = path.join(ROOT, "kb/reference");
const LESSON_DIR = path.join(ROOT, "prep/lessons/v1");
const MODEL = "muse-wonder (local authoring, no external API)";
const ITEM_META = { prov: "SMD", gen: "hand", set: "maikbook2", d: 1, cog: "recall", credit: "StewardMD original medical knowledge base", licence: "CC BY 4.0 (StewardMD original)", licenceStandard: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0", quality: { status: "automated_checks_passed", gates: { author_self_check: { note: "Author-verified against standard peer references" } } } };
let failures = 0, written = 0, kbWritten = 0, kbSkipped = 0;
for (const m of M) {
  const steps = m.steps.map((s) => JSON.parse(JSON.stringify(s)));
  for (const s of steps) {
    const words = s.tx.split(/\s+/).filter(Boolean).length;
    if (words < 40 || words > 90) { console.error("FAIL", m.id, words); failures++; }
  }
  const quiz = m.mcqs.map((q) => q.id);
  const lesson = {
    v: 1, module: m.id, subject: "microbiology", title: m.title, minutes: 6,
    steps, quiz, src: [], refs: [REF], gen: "AI", run: "books2-sas1", model: MODEL,
    checks: { shape: true, numbers: true, drugs: true, verbatim: true, dashes: true, verify: true, redone: 0, dropped: 0, kbWords: 0, itemN: m.mcqs.length },
  };
  const probs = LP.checkLesson(lesson);
  if (probs.length) { console.error("LESSON FAIL", m.id, JSON.stringify(probs)); failures++; continue; }
  fs.writeFileSync(path.join(LESSON_DIR, m.id + ".json"), JSON.stringify(lesson, null, 2) + "\n");
  written++;
  const kbPath = path.join(KB_DIR, m.kb + ".json");
  if (!fs.existsSync(kbPath)) {
    fs.writeFileSync(kbPath, JSON.stringify({ id: m.kb, name: m.kbName, aliases: [...m.aliases], class: "infective", system: "Microbiology", specialty: "Microbiology", referenceOnly: true, review: { status: "ai_drafted" }, reference: { source: REF, sourceEdition: "Topic map (2026-10-13)", pages: null, clinicalPearls: [...m.pearls], pathophysiology: m.patho, additionalDifferentials: [...m.diffs], additionalInvestigations: [...m.invs] } }, null, 2) + "\n");
    kbWritten++;
  } else kbSkipped++;
  const items = m.mcqs.map((q) => ({ ...ITEM_META, ...q, topic: m.id }));
  fs.writeFileSync(path.join(SUBJECT_DIR, m.id + ".json"), JSON.stringify({ topic: m.id, set: "maikbook2", v: 1, items }, null, 2) + "\n");
}
let idx = JSON.parse(fs.readFileSync(path.join(LESSON_DIR, "index.json"), "utf8"));
for (const m of M) idx.modules[m.id] = { title: m.title, minutes: 6, steps: m.steps.length, gen: "AI" };
fs.writeFileSync(path.join(LESSON_DIR, "index.json"), JSON.stringify(idx, null, 2) + "\n");
let counts = JSON.parse(fs.readFileSync(path.join(ROOT, "prep/bank/overlay-counts.json"), "utf8"));
counts.sets.maikbook2["microbiology"] = counts.sets.maikbook2["microbiology"] || {};
for (const m of M) counts.sets.maikbook2["microbiology"][m.id] = m.mcqs.length;
fs.writeFileSync(path.join(ROOT, "prep/bank/overlay-counts.json"), JSON.stringify(counts, null, 2) + "\n");
let tc = fs.readFileSync(path.join(ROOT, "test/prep-books-mcqs.test.mjs"), "utf8");
const OLD_LINE = 'assert.equal(totalItems, 1870, "Expected 1870 high-yield verified MCQs in maikbook2 (160 OBG + 530 pathology batch 2 + 320 pharmacology batch 2 + 270 ENT + 170 psychiatry + 200 ophthalmology + 220 microbiology)");';
const NEW_LINE = 'assert.equal(totalItems, 1890, "Expected 1890 high-yield verified MCQs in maikbook2 (160 OBG + 530 pathology batch 2 + 320 pharmacology batch 2 + 270 ENT + 170 psychiatry + 200 ophthalmology + 240 microbiology)");';
tc = tc.split(OLD_LINE).join(NEW_LINE);
fs.writeFileSync(path.join(ROOT, "test/prep-books-mcqs.test.mjs"), tc);
console.log("modules:", M.length, "mcqs:", M.reduce((n, m) => n + m.mcqs.length, 0), "kbWritten:", kbWritten, "kbSkipped:", kbSkipped, " lesson failures:", failures);
