#!/usr/bin/env node
// Tokós question bank builder. Dev-only, never shipped.
//
// Builds tokos/decks/mcq/index.json + tokos/decks/mcq/<subtopic>.json from MedMCQA, subject "Gynaecology & Obstetrics" (port of the Ophthalmós
// pipeline/build_mcq.py + pipeline/tag_difficulty.mjs to Node, with Tokós subtopics and doubtful-key flags).
//
// SOURCE (pinned, see SOURCE below)
//   Hugging Face openlifescienceai/medmcqa @ 91c6572c454088bf71b679ad90aa8dffcd0d5868 (files data/train + data/validation,
//   the test split has no answers and is not used). Licence: MIT, repo medmcqa/medmcqa LICENSE.md (text embedded below).
//   The HF card says apache-2.0; both are permissive, the stricter attribution (MIT notice) is carried in the deck.
//
// GET THE DATA (one time; python + pyarrow only used here, output is JSON lines with the original schema, cop 0-3):
//   SHA=91c6572c454088bf71b679ad90aa8dffcd0d5868; D=<dir>; mkdir -p $D && cd $D
//   for f in train validation; do curl -sL -o $f.parquet https://huggingface.co/datasets/openlifescienceai/medmcqa/resolve/$SHA/data/$f-00000-of-00001.parquet; done
//   shasum -a 256 *.parquet   # train b119434b...c493c5, validation b768a1ea...591021
//   python3 -c "import pyarrow.parquet as pq,json;[open(f+'.jsonl','w').writelines(json.dumps(r,ensure_ascii=False)+'\n' for r in pq.read_table(f+'.parquet').to_pylist() if r['subject_name']=='Gynaecology & Obstetrics') for f in ('train','validation')]"
// RUN
//   MEDMCQA_DIR=$D node tools/tokos-build-mcq.mjs
//   (also accepts the official train.json/dev.json line files, whose cop is 1-4: set MEDMCQA_COP_BASE=1)
//
// Pipeline: keep subject -> strip HTML and whitespace -> repair the dataset's dropped "rt" letters ("aboion" -> "abortion")
// -> drop broken/no-key/figure-dependent items -> exact + same-key de-duplicate -> map to the 17 subtopics -> difficulty ->
// doubtful-key flags -> tokos/decks/mcq/ (index + 17 topic files). Deterministic, no network.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeSearch } from "./tokos-build-mcq-search.mjs";
import { NARKE } from "./narke-mcq-taxonomy.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// Split deck: index.json (metadata, counts, topic list) + one small file per subtopic, so a phone parses only what it opens.
export let OUT_DIR = path.join(ROOT, "tokos", "decks", "mcq");
let SUBJECT = "Gynaecology & Obstetrics";
let HOST = null; // null = Tokós; set by useHost() for --host narke (tools/narke-mcq-taxonomy.mjs)

export const SOURCE = {
  source: "medmcqa",
  sourceRepo: "https://github.com/medmcqa/medmcqa",
  sourceDataset: "https://huggingface.co/datasets/openlifescienceai/medmcqa",
  sourceCommit: "91c6572c454088bf71b679ad90aa8dffcd0d5868",
  sourceCommitNote: "Hugging Face dataset revision of 2024-01-04 (train.parquet sha256 b119434ba551517a6ec0ba1f7e0b4c029165ed284a4704f262ce37c791c493c5, validation.parquet sha256 b768a1ea34afc9f80d3106d9b21f80fa8a00ec450a1f6cd641af72ca9e591021); licence checked against github.com/medmcqa/medmcqa main c59ef14ca1990266c4107c7864b45a20fd93e5e0 (LICENSE.md blob 526fc69d82dbfee74595de6d5a50e50b60d8152b) on 2026-09-29; the Hugging Face card lists apache-2.0",
  licence: "MIT",
  licenceFile: "LICENSE.md in github.com/medmcqa/medmcqa",
  licenceText: [
    "MIT License", "",
    "Copyright (c) 2022 MedMCQA", "",
    "Permission is hereby granted, free of charge, to any person obtaining a copy",
    "of this software and associated documentation files (the \"Software\"), to deal",
    "in the Software without restriction, including without limitation the rights",
    "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell",
    "copies of the Software, and to permit persons to whom the Software is",
    "furnished to do so, subject to the following conditions:", "",
    "The above copyright notice and this permission notice shall be included in all",
    "copies or substantial portions of the Software.", "",
    "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR",
    "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,",
    "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE",
    "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER",
    "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,",
    "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE",
    "SOFTWARE.",
  ].join("\n"),
  citation: "Pal A, Umapathi LK, Sankarasubbu M. MedMCQA: A Large-scale Multi-Subject Multi-Choice Dataset for Medical domain Question Answering. Proceedings of the Conference on Health, Inference, and Learning, PMLR 174:248-260, 2022. https://proceedings.mlr.press/v174/pal22a.html",
  modifications: "Filtered to Gynaecology & Obstetrics; HTML and whitespace cleaned; the source's dropped 'rt' letters restored; duplicates, keyless and figure-dependent items removed; mapped to Tokós subtopics; difficulty and doubtful-key flags added. Answer keys and explanations are the source's and are not clinically reviewed.",
};

// ---------------------------------------------------------------------------------------------------------------------
// The 17 subtopics (ids fixed by the Tokós 2.0 contract). Titles are learner-facing, English and Hindi.
export let SUBTOPICS = [
  { id: "ob-antenatal", group: "obstetrics", title: { en: "Antenatal care and physiology of pregnancy", hi: "प्रसवपूर्व देखभाल और गर्भावस्था की शरीरक्रिया" } },
  { id: "ob-labour", group: "obstetrics", title: { en: "Labour and its complications", hi: "प्रसव और उसकी जटिलताएँ" } },
  { id: "ob-medical", group: "obstetrics", title: { en: "Medical disorders in pregnancy", hi: "गर्भावस्था में चिकित्सीय रोग" } },
  { id: "ob-haemorrhage", group: "obstetrics", title: { en: "Obstetric haemorrhage", hi: "प्रसूति रक्तस्राव" } },
  { id: "ob-hypertension", group: "obstetrics", title: { en: "Hypertensive disorders of pregnancy", hi: "गर्भावस्था में उच्च रक्तचाप के विकार" } },
  { id: "ob-fetal", group: "obstetrics", title: { en: "Fetal medicine and the newborn", hi: "भ्रूण चिकित्सा और नवजात शिशु" } },
  { id: "ob-puerperium", group: "obstetrics", title: { en: "Puerperium and lactation", hi: "प्रसवोत्तर काल और स्तनपान" } },
  { id: "ob-early", group: "obstetrics", title: { en: "Early pregnancy: abortion, ectopic, molar pregnancy", hi: "प्रारंभिक गर्भावस्था: गर्भपात, अस्थानिक और मोलर गर्भ" } },
  { id: "ob-operative", group: "obstetrics", title: { en: "Operative obstetrics", hi: "प्रसूति शल्यक्रिया और प्रक्रियाएँ" } },
  { id: "gy-menstrual", group: "gynaecology", title: { en: "Menstrual disorders and menopause", hi: "मासिक धर्म के विकार और रजोनिवृत्ति" } },
  { id: "gy-infection", group: "gynaecology", title: { en: "Genital tract infections", hi: "जननांग संक्रमण" } },
  { id: "gy-benign", group: "gynaecology", title: { en: "Benign gynaecological conditions", hi: "स्त्री रोग की सौम्य स्थितियाँ" } },
  { id: "gy-oncology", group: "gynaecology", title: { en: "Gynaecological oncology", hi: "स्त्री रोग कैंसर विज्ञान" } },
  { id: "gy-fertility", group: "gynaecology", title: { en: "Infertility and reproductive endocrinology", hi: "बांझपन और प्रजनन अंतःस्रावी विज्ञान" } },
  { id: "gy-contraception", group: "gynaecology", title: { en: "Contraception and family planning", hi: "गर्भनिरोधन और परिवार नियोजन" } },
  { id: "gy-urogyn", group: "gynaecology", title: { en: "Urogynaecology and pelvic floor", hi: "यूरोगायनेकोलॉजी और श्रोणि तल" } },
  { id: "gy-anatomy", group: "gynaecology", title: { en: "Genital anatomy and congenital anomalies", hi: "जननांग शरीररचना और जन्मजात विकृतियाँ" } },
];
let SUB_IDS = SUBTOPICS.map((s) => s.id);
let SIDE = Object.fromEntries(SUBTOPICS.map((s) => [s.id, s.group === "obstetrics" ? "ob" : "gy"]));

export const FLAG_LEGEND = {
  "exp-letter": { en: "The explanation names a different option letter than the key", hi: "व्याख्या में बताया गया विकल्प-अक्षर उत्तर-कुंजी से अलग है" },
  "exp-text": { en: "The explanation restates a different option than the key", hi: "व्याख्या उत्तर-कुंजी से अलग विकल्प का उल्लेख करती है" },
  "dup-key": { en: "The source holds this question twice with different keys", hi: "स्रोत में यह प्रश्न दो बार है और उत्तर-कुंजी अलग-अलग हैं" },
  "dup-stem": { en: "The same question stem appears elsewhere with a different key", hi: "यही प्रश्न-वाक्य कहीं और अलग उत्तर-कुंजी के साथ मिलता है" },
};

// ---------------------------------------------------------------------------------------------------------------------
// Topic-name table. MedMCQA topic_name is present for about half the items and is messy (exam labels, textbook chapter
// headings, generic words). First match wins on the lower-cased, repaired topic_name. A name not matched here, or matched
// by nothing, falls through to the keyword rules below (topic_name text is fed to them as a hint too).
// ponytail: regex table by hand, revisit with a classifier only if per-subtopic accuracy needs auditing.
export let TOPIC_TABLE = [
  [null, /sour grapes|hey,whats the hurry/], // mixed textbook chapters: keyword rules decide
  ["ob-hypertension", /pregnancy induced hyper|hypertensive disorders? in pregnancy|pre-?eclampsia|eclampsia/],
  ["ob-haemorrhage", /antepartum h|post ?partum h|placenta previa|placental abruption|causes of obstetrical h|complication of 3rd stage/],
  ["ob-early", /ectopic|ecotopic|tubal pregnancy|ovarian pregnancy|pathology of conception|abortion|miscarriage|cervical insufficiency|first-trimester|midtrimester|vomiting in pregnancy|hydatidiform|molar pregnancy|^gestational trophoblastic disease/],
  ["gy-oncology", /carcinoma|cancer|choriocarcinoma|trophoblastic neoplasia|endometrial carcinoma|tumor markers|ovarian tumors|radiotherapy & chemotherapy|staging, investigation|cervical intraepithelial|vulvar/],
  ["ob-fetal", /rh incompatibility|rh-negative|prenatal diagnosis|antenatal screening|fetal (assessment|imaging|disorders|circulation)|^fetus( & new born.*)?$|intra ?uterine growth|hydramnios|amniotic fluid dynamics|twin pregnancy$|^multiple pregnancy|growth of the fetus/],
  ["ob-operative", /operative obs|caesarean|cesarean|instrumental delivery|^version$|episiotomy/],
  ["ob-puerperium", /puerperium|breasts and lactation/],
  ["ob-labour", /labou?r|malpresentation|breech|obstructed|contracted pelvis|fetal skull|brow presentation|transverse lies|injury to the birth canal|induction|augmentation|second stage/],
  ["ob-medical", /illness complicating|illness complication|gestational diabetes|^diabetes mellitus$|anaemia in pregnancy|infections in pregnancy|^infectious diseases$|cardiovascular disorders|renal and urinary tract disorders|hepatic, biliary|hematological disorders|neurological disorders|thromboembolic|drugs? in pregnancy|diet in pregnancy/],
  ["ob-antenatal", /physiological changes|maternal anatomy|obstetrical anatomy|antenatal care|care of the pregnant|placenta and chorion|amnion and umbilical|fetus placenta/],
  ["gy-contraception", /contracepti|sterili[sz]ation|family planning|non-hormonal|methods - /],
  ["gy-infection", /infections? of the genital|genital tract infections|sexually transmitted|std management|tuberculosis of the genital|pelvic inflammatory|genital infections|specific infections|symptoms associated with genital/],
  ["gy-benign", /fibroid|fibromyoma|endometriosis|adenomyosis/],
  ["gy-fertility", /infertility|infeility|pcod|polycystic|pcos|endocrinology in relation|reproductive physiology and hormones|sexuality and intersex|sex intersex|^intersex|classification of dsd|genital differentiation|sex differentiation|ovulation|ovarian hyperstimulation|hirsutism/],
  ["gy-menstrual", /reproductive physiology and hormones|menstru|menopause|amenorrh|dysmenorrh|heavy menstrual|post menopausal|ovarian cycle|uterine cycle|pubertal changes|endocrine control|tests of ovulation/],
  ["gy-urogyn", /urinary fistula|genitourinary fistula|urogyn|prolapse|incontinence/],
  ["gy-anatomy", /anatomy of the female|gynaecological anatomy|malformation of the female|mullerian|external genitalia|internal generative|uterine tubes|^uterus$|^vagina$|^vigina$|^valva$|^vulva$|general anatomy/],
];

// ---------------------------------------------------------------------------------------------------------------------
// Keyword rules for everything the table leaves. Score per subtopic = sum over patterns of
//   3 if the pattern hits the stem, 2 if it hits the key option text, 2 if it hits topic_name, plus 1 per explanation hit (at most 3),
// times 2 for "strong" patterns and 0.5 for "weak" ones; plus 2 if the subtopic is on the item's detected side (obstetric or gynaecological).
// The best score wins, ties go to the earlier subtopic in SUBTOPICS. Nothing scored -> side default (reported as "fallback").
const KW = {
  "ob-antenatal": {
    strong: ["antenatal", "prenatal care", "booking visit", "fundal height", "symphysio", "quickening", "naegele", "expected date of deliver", "gestational age", "chadwick", "hegar", "goodell", "jacquemier", "osiander", "braxton", "linea nigra", "striae gravid", "physiological (change|anaemia|anemia)", "cardiac output", "plasma volume", "blood volume", "tetanus toxoid", "iron and folic", "folic acid", "dating scan", "placental (hormone|function|barrier|transfer|lactogen)", "human placental lactogen", "\\bhpl\\b", "umbilical cord", "decidua", "implantation", "morula", "blastocyst", "teratogen", "safe in pregnancy", "contraindicated in pregnancy", "pregnancy test", "urine pregnancy", "immuni[sz]ation in pregnancy", "zygote", "cleavage", "blastomere", "fertili[sz]ation", "vaccine", "weight gain in pregnancy", "nutrition in pregnancy", "amnion", "chorion", "placenta (is|forms|develops|weighs|circulation)", "fetal membrane", "\\banc\\b", "pregnancy (dating|diagnosis)", "sign of pregnancy", "quadrigravida|primigravida|multigravida"],
    weak: ["pregnan", "placenta", "gestation", "trimester"],
  },
  "ob-labour": {
    strong: ["labou?r", "partogra", "cervical dilat", "engagement", "station", "internal rotation", "crowning", "third stage", "second stage", "first stage", "bishop", "induction of", "augmentation", "oxytocin", "breech", "occipito", "face presentation", "brow presentation", "shoulder presentation", "transverse lie", "cephalopelvic", "pelvic (inlet|outlet|brim|diameter|type|cavity)", "pelvis", "conjugate", "caput", "moulding", "malpresentation", "malposition", "obstructed", "prolonged", "rupture of membranes", "\\bprom\\b", "pprom", "preterm", "post-?term", "post-?date", "tocoly", "atosiban", "betamethasone", "shoulder dystocia", "cord prolapse", "rupture of (the )?uterus", "uterine rupture", "precipitate", "contractions", "dystocia", "cervical ripening", "pge2", "dinoprostone", "labour room", "mechanism of", "delivery of (the )?(head|shoulder|placenta)", "fetal (skull|head) ", "vertex", "presenting part", "lie of the fetus", "engaged", "descent of"],
    weak: ["delivery", "delivered", "vaginal delivery", "presentation"],
  },
  "ob-medical": {
    strong: ["anaemia in pregnan", "anemia in pregnan", "diabetes in pregnan", "gestational diabet", "\\bgdm\\b", "pregestational", "heart disease", "cardiac disease", "mitral", "eisenmenger", "peripartum cardiomyopathy", "hypothyroid", "hyperthyroid", "thyroid", "epilep", "antiepileptic", "phenytoin", "jaundice in pregnan", "hepatitis", "cholestasis", "acute fatty liver", "urinary tract infection", "pyelonephritis", "bacteriuria", "asthma", "tuberculosis", "malaria", "\\bhiv\\b", "syphilis", "toxoplasm", "rubella", "cytomegalo", "\\bcmv\\b", "varicella", "thromboembol", "\\bdvt\\b", "antiphospholipid", "lupus", "thrombocytopeni", "sickle", "thalassemia", "renal disease", "obesity", "warfarin", "heparin", "anticoagulant", "cardiac (lesion|surgery)", "hemoglobin", "haemoglobin", "iron deficiency"],
    weak: ["in pregnancy", "during pregnancy", "pregnant"],
  },
  "ob-haemorrhage": {
    strong: ["antepartum h", "\\baph\\b", "placenta previa", "placenta praevia", "abruption", "abruptio", "couvelaire", "vasa previa", "postpartum h", "post-?partum h", "\\bpph\\b", "atonic", "uterine atony", "retained placenta", "placenta accreta", "accreta", "increta", "percreta", "morbidly adherent", "invers(ion of|ed) (the )?uterus", "uterine inversion", "amniotic fluid embolism", "\\bdic\\b", "disseminated intravascular", "sheehan", "carboprost", "hemabate", "methylergometrine", "ergometrine", "b-?lynch", "tamponade", "bakri", "obstetric h(a)?emorrhage", "blood loss", "massive transfusion", "placenta pr(ae|e)\\b", "fibrinogen", "coagulation failure", "concealed", "tranexamic", "manual removal", "hematoma", "haematoma", "bleeding per vaginum in (late|third)", "bleeding in (late|third)"],
    weak: ["hemorrhage", "haemorrhage", "bleeding"],
  },
  "ob-hypertension": {
    strong: ["pre-?eclampsia", "eclampsia", "\\bhellp\\b", "gestational hypertension", "chronic hypertension", "pregnancy.?induced hypertension", "\\bpih\\b", "hypertensive disorder", "magnesium sulph", "mgso4", "pritchard", "zuspan", "labetalol", "hydralazine", "methyldopa", "antihypertensive", "proteinuria", "convulsion", "severe features", "seizure prophylaxis", "calcium gluconate"],
    weak: ["hypertension", "blood pressure"],
  },
  "ob-fetal": {
    strong: ["\\biugr\\b", "\\bfgr\\b", "growth restriction", "intrauterine growth", "growth retardation", "small for gestational", "\\bsga\\b", "macrosomia", "polyhydramnios", "hydramnios", "oligohydramnios", "amniotic fluid index", "\\bafi\\b", "amniocentesis", "chorionic villus", "\\bcvs\\b", "cordocentesis", "triple test", "quadruple test", "down.?s syndrome", "trisomy", "edward", "patau", "aneuploid", "nuchal", "\\bnt scan", "anomaly scan", "banana sign", "lemon sign", "fetoprotein", "monster", "conjoined", "crown.rump", "physiological jaundice", "intra.?uterine life", "poly ?hy ?dramnios", "neural tube", "anencephaly", "spina bifida", "hydrocephalus", "hydrops", "rh (negative|positive|isoimmun|incompat|alloimmun)", "anti-?d\\b", "isoimmuni[sz]ation", "kleihauer", "coombs", "erythroblastosis", "liley", "doppler", "middle cerebral", "umbilical artery", "\\bnst\\b", "non-?stress", "biophysical profile", "\\bbpp\\b", "kick count", "\\bctg\\b", "cardiotocograph", "deceleration", "fetal heart", "fetal (well|distress|monitoring|surveillance|growth|weight|lung|anomal|circulation|hemoglobin|haemoglobin)", "twin", "multiple pregnancy", "multifetal", "monochorionic", "dichorionic", "lambda sign", "conjoined", "newborn", "neonat", "apgar", "birth asphyxia", "meconium", "respiratory distress", "surfactant", "kernicterus", "ductus", "foramen ovale", "congenital (anomal|malformation)"],
    weak: ["fetal", "fetus", "foetal", "foetus"],
  },
  "ob-puerperium": {
    strong: ["puerper", "postpartum (?!h)", "post-?natal", "lochia", "involution", "breast ?feeding", "lactation", "mastitis", "breast (engorgement|abscess|milk)", "colostrum", "suckling", "let-?down", "puerperal", "postpartum (blues|depression|psychosis|thyroiditis|sepsis|pyrexia|contracept)", "subinvolution", "after delivery", "\\blam\\b"],
    weak: ["postpartum", "breast"],
  },
  "ob-early": {
    strong: ["abortion", "miscarriage", "missed abortion", "threatened abortion", "inevitable abortion", "incomplete abortion", "septic abortion", "recurrent (pregnancy loss|miscarriage|abortion)", "cervical (incompetence|insufficiency)", "cerclage", "shirodkar", "\\bmtp\\b", "medical termination", "termination of pregnancy", "mifepristone", "ectopic", "tubal pregnancy", "salpingectomy", "methotrexate", "molar", "hydatidi?form", "hydatid mole", "ovarian pregnancy", "cervical pregnancy", "abdominal pregnancy", "vesicular mole", "trophoblastic", "\\bgtd\\b", "snowstorm", "hyperemesis", "vomiting in pregnancy", "first trimester", "early pregnancy", "pregnancy of unknown location", "blighted ovum", "anembryonic", "discriminatory", "cesarean scar pregnancy", "interstitial pregnancy", "cornual", "heterotopic", "arias-stella", "curettage", "evacuation"],
    weak: ["abort", "ovum", "conception"],
  },
  "ob-operative": {
    strong: ["caesarean", "cesarean", "c-section", "\\blscs\\b", "classical (cs|section|incision)", "forceps", "vacuum", "ventouse", "episiotomy", "perineal (tear|laceration)", "third.degree", "fourth.degree", "anal sphincter", "\\bversion\\b", "\\becv\\b", "external cephalic", "internal podalic", "destructive", "craniotomy", "embryotomy", "decapitation", "cleidotomy", "symphysiotomy", "hysterotomy", "obstetric hysterectomy", "peripartum hysterectomy", "uterine (compression )?suture", "\\bvbac\\b", "trial of labou?r after", "lower segment", "scar (dehiscence|rupture)", "instrumental", "outlet forceps", "kielland", "piper", "simpson", "wrigley", "mauriceau", "burns-marshall", "lovset", "zavanelli", "mcroberts", "suprapubic pressure", "wood.?screw", "pfannenstiel", "uterine exteriori"],
    weak: ["obstetric operation", "obstetric surgery"],
  },
  "gy-menstrual": {
    strong: ["menstru", "menorrh", "amenorrh", "oligomenorrh", "polymenorrh", "dysmenorrh", "metrorrhagia", "menometrorrh", "\\baub\\b", "abnormal uterine bleeding", "dysfunctional uterine", "\\bdub\\b", "palm-?coein", "premenstrual", "\\bpms\\b", "pmdd", "menopaus", "climacteric", "\\bhrt\\b", "hormone replacement", "hot flush", "postmenopausal", "post-menopausal", "perimenopaus", "menarche", "thelarche", "pubarche", "adrenarche", "puberty", "precocious", "tanner", "ovarian cycle", "endometrial cycle", "proliferative phase", "secretory phase", "luteal phase", "follicular phase", "corpus luteum", "ovulation", "lh surge", "hypothalam", "asherman", "cryptomenorrh", "bleeding per vaginum", "abnormal bleeding", "endometrial (thickness|shedding|biopsy)", "\\bnsaid", "mefenamic", "tranexamic acid", "norethisterone"],
    weak: ["estrogen", "oestrogen", "estradiol", "progesterone", "gnrh", "\\bfsh\\b", "\\blh\\b", "bleeding"],
  },
  "gy-infection": {
    strong: ["pelvic inflammatory", "\\bpid\\b", "vaginitis", "vaginosis", "candid", "trichomon", "gardnerella", "clue cell", "whiff", "leucorrh", "vaginal discharge", "cervicitis", "chlamydi", "gonorrh", "neisseria", "syphilis", "chancre", "lymphogranuloma", "donovanosis", "chancroid", "genital herpes", "\\bhsv\\b", "genital wart", "condyloma", "molluscum", "scabies", "pediculosis", "\\bstds?\\b", "\\bstis?\\b", "sexually transmitted", "genital tuberculosis", "tubercul", "toxic shock", "bartholin abscess", "salpingitis", "tubo-?ovarian abscess", "endometritis", "pyometra", "syndromic", "fitz-hugh", "actinomyc", "metronidazole", "fluconazole", "azithromycin", "doxycycline", "ceftriaxone", "genital ulcer", "vulvovaginitis", "\\bhiv\\b"],
    weak: ["infection", "abscess", "discharge"],
  },
  "gy-benign": {
    strong: ["fibroid", "leiomyoma", "myoma", "myomectomy", "adenomyosis", "endometriosis", "endometrioma", "chocolate cyst", "ovarian cyst", "functional cyst", "follicular cyst", "corpus luteum cyst", "theca lutein", "dermoid", "mature (cystic )?teratoma", "cystadenoma", "fibroma", "brenner", "meigs", "thecoma", "benign", "meig", "polyp", "endometrial hyperplasia", "bartholin cyst", "nabothian", "lichen sclerosus", "lichen planus", "hysterectomy", "torsion", "red degeneration", "hyaline degeneration", "hysteroscop", "pelvic mass", "adnexal mass", "vulval dystroph", "\\bgnrh (analogue|agonist)", "danazol", "ulipristal", "mifepristone.*fibroid", "uterine artery embolization"],
    weak: ["ovarian tumou?r", "cyst", "uterus"],
  },
  "gy-oncology": {
    strong: ["carcinoma", "cancer", "malignan", "neoplas", "\\bcin\\b", "cervical intraepithelial", "\\bvin\\b", "pap smear", "cytology", "\\bvia\\b", "\\bvili\\b", "colposcop", "\\bleep\\b", "conization", "cone biopsy", "cervical screening", "hpv (dna|vaccine|infection|type)", "bethesda", "figo (stag|classif)", "staging", "wertheim", "radical hysterectomy", "debulking", "cytoreduct", "lymphadenectomy", "sentinel", "brachytherapy", "radiotherapy", "chemotherapy", "cisplatin", "paclitaxel", "carboplatin", "bleomycin", "etoposide", "tumou?r marker", "ca[ -]*125", "krukenberg", "dysgerminoma", "yolk sac", "endodermal sinus", "granulosa", "sertoli", "struma ovarii", "choriocarcinoma", "\\bgtn\\b", "invasive mole", "placental site trophoblastic", "tamoxifen", "lynch", "\\bbrca", "\\brmi\\b", "risk of malignancy", "paget", "sarcoma", "vulvar (cancer|carcinoma)", "verrucous", "botryoides", "clear cell", "adenocarcinoma", "squamous", "germ cell", "ovarian tumou?r", "ovarian neoplasm"],
    weak: ["tumou?r", "biopsy", "metasta", "teratoma", "\\bafp\\b", "\\bldh\\b", "inhibin"],
  },
  "gy-fertility": {
    strong: ["infertil", "subfertil", "insemination", "sterility", "semen", "sperm", "azoosperm", "oligosperm", "varicocele", "hysterosalpingograph", "\\bhsg\\b", "tubal (patency|block|factor)", "ovulation induction", "clomiphene", "letrozole", "gonadotropin", "\\bhmg\\b", "\\bivf\\b", "\\bicsi\\b", "\\biui\\b", "assisted reproduc", "embryo transfer", "oocyte", "\\bohss\\b", "hyperstimulation", "luteal support", "\\bpcos\\b", "\\bpcod\\b", "polycystic", "hirsut", "hyperandrogen", "androgen", "testosterone", "\\bdhea", "hyperprolactin", "prolactinoma", "bromocriptine", "cabergoline", "galactorrh", "\\bamh\\b", "antral follicle", "ovarian reserve", "premature ovarian", "ovarian failure", "intersex", "\\bdsd\\b", "disorders? of sex", "sex differentiation", "ambiguous genitalia", "androgen insensitivity", "testicular feminization", "swyer", "gonadal dysgenesis", "turner", "klinefelter", "karyotype", "cushing", "\\bcah\\b", "congenital adrenal", "21.hydroxylase", "kallmann", "endocrin"],
    weak: ["hormone", "prolactin", "thyroid"],
  },
  "gy-contraception": {
    strong: ["contracepti", "sponge", "nonoxynol", "\\biucd\\b", "\\biud\\b", "copper.?t\\b", "\\bcu.?t\\b", "\\blng.?ius", "mirena", "levonorgestrel", "\\bocps?\\b", "combined (oral )?pill", "\\bcoc\\b", "mini-?pill", "progestin-only", "\\bpop\\b", "\\bdmpa\\b", "depot", "injectable", "implant(?!ation)", "nexplanon", "norplant", "implanon", "condom", "diaphragm", "spermicid", "natural family", "rhythm method", "calendar method", "billings", "basal body temp", "lactational amenorrh", "emergency contracep", "ulipristal", "morning.after", "sterili[sz]ation", "tubectomy", "tubal ligation", "pomeroy", "vasectomy", "falope", "hulka", "filshie", "pearl index", "family planning", "total fertility", "couple protection", "\\bnsv\\b", "no.scalpel", "yuzpe"],
    weak: ["pill", "pregnancy prevention"],
  },
  "gy-urogyn": {
    strong: ["prolapse", "cystocele", "rectocele", "enterocele", "urethrocele", "uterovaginal", "pop-?q", "pelvic organ", "pelvic floor", "urethro.?vesical", "vesical", "stress (urinary )?incontinence", "urge incontinence", "incontinence", "overactive bladder", "urodynamic", "bonney", "marshall.marchetti", "\\bburch\\b", "\\bsling", "\\btvt\\b", "\\btot\\b", "colposuspension", "fistula", "\\bvvf\\b", "vesicovaginal", "\\brvf\\b", "ureterovaginal", "manchester", "fothergill", "sacrocolpopexy", "pessary", "colporrhaphy", "sacrospinous", "le fort", "colpocleisis", "urethral (syndrome|diverticulum)", "voiding", "retention of urine", "cystitis", "nocturia", "kegel", "urinary (retention|incontinence)", "bladder injury", "ureteric injury"],
    weak: ["bladder", "urethra", "ureter"],
  },
  "gy-anatomy": {
    strong: ["anatom", "embryolog", "mullerian", "m.llerian", "wolffian", "mesonephric", "paramesonephric", "didelphys", "bicornuate", "septate uterus", "unicornuate", "arcuate", "vaginal (septum|agenesis|atresia)", "imperforate hymen", "\\bhymen", "transverse vaginal", "mayer", "rokitansky", "agenesis", "gartner", "broad ligament", "round ligament", "cardinal ligament", "mackenrodt", "uterosacral", "pubocervical", "ligaments? of", "ligamentum", "suppor(t|ts) of (the )?uterus", "blood supply", "arterial supply", "lymphatic drainage", "nerve supply", "innervation", "pudendal", "pelvic diaphragm", "levator ani", "perineal body", "perineum", "urogenital (diaphragm|triangle)", "vulva", "labia", "clitoris", "vestibule", "fornix", "fornices", "fallopian tube", "uterine tube", "ampulla", "isthmus", "ovarian (ligament|artery|vein)", "infundibulopelvic", "histology", "epithelium", "columnar", "squamocolumnar", "transformation zone", "pouch of douglas", "rectouterine", "vesicouterine", "paracolpium", "parametrium", "bony pelvis", "sacrum", "coccyx", "congenital (anomal|malformation)"],
    weak: ["ovary", "vagina", "cervix", "uterus"],
  },
};
const compileKw = (kw) => Object.fromEntries(Object.entries(kw).map(([id, k]) => [id, {
  strong: k.strong.map((s) => new RegExp(s, "i")),
  weak: k.weak.map((s) => new RegExp(s, "i")),
}]));
let KWRE = compileKw(KW);

// Switch the whole builder to another host (Narkē). Tokós stays the default so its build and test are untouched.
export function useHost(name) {
  if (name !== "narke") throw new Error(`unknown --host ${name}`);
  HOST = NARKE;
  SUBJECT = NARKE.subject;
  OUT_DIR = path.join(ROOT, NARKE.outSub, "decks", "mcq");
  SUBTOPICS = NARKE.subtopics;
  SUB_IDS = SUBTOPICS.map((s) => s.id);
  TOPIC_TABLE = NARKE.topicTable;
  KWRE = compileKw(NARKE.keywords);
}
// Side detection: does the item read as obstetric or gynaecological?
const OB_CTX = /pregnan|gravid|antenatal|gestation|trimester|labou?r\b|deliver|puerper|postpartum|lactat|fetus|fetal|foetal|obstetric|caesarean|cesarean|placenta|neonat|newborn|amnio|eclampsia|breech|parity|primigravida|multigravida|abortion|miscarriage|ectopic/i;
const GY_CTX = /menstru|menopaus|amenorrh|uterine bleeding|gynae?cologic|fibroid|endometriosis|ovarian|cervical (cancer|carcinoma|intraepithelial)|carcinoma (cervix|ovary|endometrium)|prolapse|vagina|vulva|contracept|infertil|pcos|hirsut|puberty|colposcop|pap smear|hysterectomy|pelvic inflammatory|intersex/i;

// ---------------------------------------------------------------------------------------------------------------------
// Text cleaning
const WS = /\s+/g;
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: " - ", hellip: "...", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', deg: "\u00b0", plusmn: "\u00b1", micro: "\u00b5", alpha: "\u03b1", beta: "\u03b2", gamma: "\u03b3" };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    const v = ENT[e.toLowerCase()]; return v === undefined ? m : v;
  });
}
// Strip HTML tags (block tags become spaces), decode entities, replace em/en dashes (the deck carries no em-dash), collapse whitespace.
export function cleanText(s) {
  let t = String(s == null ? "" : s);
  t = t.replace(/<\s*\/?\s*(br|p|div|li|ul|ol|tr|td|h\d)\b[^<>]*>/gi, " ").replace(/<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>/gi, "");
  t = decodeEntities(t);
  t = t.replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\u00a0/g, " ").replace(/\u2014/g, " - ").replace(/\u2013/g, "-");
  // source artefacts: "deg" left behind by a degree sign or bullet ("65deg", "implantsdeg"), "&;" for an apostrophe, "Vasa Pre(via)"
  t = t.replace(/(\d)deg\b/g, "$1\u00b0").replace(/([A-Za-z)\].])deg\b/g, "$1").replace(/&;/g, "'");
  t = t.replace(/\b(vasa|placenta) (pre|prae)\b/gi, (m, a) => a + " previa");
  return t.replace(WS, " ").trim();
}
export const normKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// The source dropped the letters "rt" in many words ("aboion", "infeility", "hea", "Antepaum"). Build the vocabulary from the
// whole corpus, then for a token that is not attested-good, insert "rt" at each position and accept an attested word.
// Never touched: KEEP (real words that only look corrupted), short all-caps abbreviations.
const RT_KEEP = new Set(["so", "was", "abo", "robe", "robes", "fo", "foe", "tule", "reve", "obsterics"]);
// opts (PrepNucleus; Tokós passes none and is unchanged): maxRatio skips a token seen more than maxRatio times as often
// as its "rt" form. A vocabulary over every subject attests rare words such as "rtis" (RTIs), "tort" and "arts", which
// would otherwise turn "is", "to" and "as" into them; the dropped forms are never that common relative to the real word
// ("hea" 7,740 vs "heart" 5,225). Tokens of shortLen letters or fewer use shortRatio ("po", per oral, is not "port").
// keep: more real words that only look corrupted ("hyperopia", "Poland").
export function buildRepair(texts, opts) {
  opts = opts || {};
  const keep = new Set(opts.keep || []);
  const ratioFor = (w) => (opts.shortLen && w.length <= opts.shortLen ? opts.shortRatio : opts.maxRatio);
  const vocab = new Map();
  for (const t of texts) for (const m of t.matchAll(/[A-Za-z]+/g)) { const w = m[0].toLowerCase(); vocab.set(w, (vocab.get(w) || 0) + 1); }
  const fix = new Map();
  for (const [w] of vocab) {
    if (w.length < 2 || RT_KEEP.has(w) || keep.has(w)) continue;
    const ratio = ratioFor(w);
    let best = null;
    for (let i = 0; i <= w.length; i++) {
      const v = w.slice(0, i) + "rt" + w.slice(i);
      const c = vocab.get(v) || 0;
      if (c >= 3 && (!best || c > best[1]) && !(ratio && vocab.get(w) > ratio * c)) best = [v, c];
    }
    if (best) fix.set(w, best[0]);
  }
  // HAART is the one all-caps abbreviation the source damaged (see the short all-caps rule in repairText).
  return { fix, apply: (t) => repairText(t, fix) };
}
function repairText(t, fix) {
  return t.replace(/[A-Za-z]+/g, (w) => {
    const lw = w.toLowerCase();
    if (w === w.toUpperCase() && w.length <= 3 && lw !== "haa") return w; // ABO, PA, HIV: abbreviations stay
    const v = fix.get(lw);
    if (!v) return w;
    if (w === w.toUpperCase() && w.length > 1) return v.toUpperCase();
    if (w[0] === w[0].toUpperCase() && w.slice(1) === w.slice(1).toLowerCase()) return v[0].toUpperCase() + v.slice(1);
    if (w === lw) return v;
    return w; // mixed case: leave alone
  });
}

// Explanation: drop the restated answer prefix ("Ans. is 'b' i.e. ..."), keep the rest (including the textbook reference).
const ANS_PREFIX = /^\s*ans(?:wer)?\b\.?\s*(?:is|:|-|=)?\s*/i;
const LETTER_LEAD = /^(?:\(\s*[a-d]\s*\)|['"\u2018\u201c][a-d]['"\u2019\u201d]|[a-d](?=\s*(?:[.:)\-,;]|i\.?\s?e\b|$)))\s*(?:[.:)\-,;]\s*)?/i;
const LETTER_IE = /^\s*(?:\(\s*[a-d]\s*\)|['"\u2018\u201c][a-d]['"\u2019\u201d]|[a-d])\s*(?:[,.:]\s*)?(?=i\.?\s?e\b)/i;
const IE_LEAD = /^\s*i\.?\s?e\.?\s*[,.:]?\s*/i;
export function cleanExplanation(exp, keyText) {
  let t = exp;
  if (ANS_PREFIX.test(t)) { t = t.replace(ANS_PREFIX, ""); t = t.replace(LETTER_LEAD, ""); }
  else if (LETTER_IE.test(t)) t = t.replace(LETTER_IE, "");
  const hadIe = IE_LEAD.test(t);
  t = t.replace(IE_LEAD, "").replace(/^\s*[:\-.]\s*/, "").trim();
  if (hadIe && keyText) { // "i.e. Karyotyping Karyotyping is best ..." -> drop the restated key
    const k = keyText.toLowerCase();
    if (t.toLowerCase().startsWith(k) && t.length - k.length >= 20) t = t.slice(k.length).replace(/^\s*[:\-.,]?\s*/, "");
  }
  const n = normKey(t), nk = normKey(keyText);
  if (t.length < 12 || (nk && (n === nk || nk.startsWith(n)))) return ""; // only restates the key
  return t;
}

// ---------------------------------------------------------------------------------------------------------------------
// Difficulty: 1 easy, 2 medium, 3 hard. Ported unchanged from ophthalmos/pipeline/tag_difficulty.mjs (stem heuristic).
// ponytail: stem heuristic, not item statistics; swap for per-item accuracy once enough answers are logged.
const VIGNETTE = /\b\d{1,3}[- ]?(years?|yrs?|months?|days?|weeks?)[- ]?old\b|\b(a|an)\s+(\w+\s+)?(patient|man|woman|boy|girl|child|lady|male|female|infant|neonate|baby|person|student|farmer|diabetic)\s*(presents?|presented|comes?|came|complain\w*|with|has|had|develops?|developed|was|is brought|reports?|noticed|underwent|gives?|on|who|suffering|having|,)/i;
const DURATION = /\b(since|for|of|last|past|over) (\d+|a|an|one|two|three|four|five|six|several|few)[- ](hours?|days?|weeks?|months?|years?)\b/i;
const NEGATIVE = /\bexcept\b|^\s*not\b|\bnot (true|correct|seen|a |an |associated|used|indicated|found|present|characteristic)|\b(false|incorrect|untrue)\b|\ball of the following\b/i;
const REASONING = /next (best )?step|most (likely|probable|appropriate)|investigation of choice|likely diagnosis|best (treatment|management)|management of|what would you/i;
export function difficulty(q) {
  q = String(q || "");
  const n = q.length;
  let s = 0;
  if (VIGNETTE.test(q)) s += 2;
  if (DURATION.test(q)) s += 1;
  if (NEGATIVE.test(q)) s += 1;
  if (REASONING.test(q)) s += 1;
  if (/[.?]\s+[A-Za-z]/.test(q.replace(/\b(e\.g|i\.e|vs|dr|mm|no|etc)\./gi, ""))) s += 1;
  if ((q.match(/(^|[\s-])[a-e]\)/g) || []).length >= 3) s += 1;
  if (n > 60) s += 1;
  if (n > 110) s += 1;
  return s >= 2 ? 3 : s === 0 && n <= 40 ? 1 : 2;
}

export const IMAGE_REF = /shown in the (image|figure|picture|photograph)|given (figure|image)|identify the (structure|lesion|finding) marked|marked (with an? )?arrow|structure marked|arrow (points?|marks?)|following (image|figure|photograph|picture)|image shown below|figure shows|picture shows|photograph shows|clinical photograph (below|above)|(shown|seen) in the (given|below|above) (image|figure|picture)|(image|picture|figure|photograph|ultrasound|usg|x-?ray|mri|ct scan|histopathology|slide) (below|above|given)/i;

// ---------------------------------------------------------------------------------------------------------------------
// Subtopic mapping
export function tableTopic(topicName) {
  const t = String(topicName || "").toLowerCase().trim();
  if (!t) return null;
  for (const [id, re] of TOPIC_TABLE) if (re.test(t)) return id;
  return null;
}
export function keywordTopic({ q, key, exp, topic }) {
  const ctx = `${q} ${key} ${topic}`;
  const ob = (OB_CTX.test(ctx) ? 1 : 0) + (OB_CTX.test(exp) ? 0.5 : 0);
  const gy = (GY_CTX.test(ctx) ? 1 : 0) + (GY_CTX.test(exp) ? 0.5 : 0);
  const side = HOST ? null : ob > gy ? "ob" : gy > ob ? "gy" : null;
  let best = null, bestScore = 0;
  for (const id of SUB_IDS) {
    if (!KWRE[id]) continue; // Narkē `general` is the fallback only
    let s = 0;
    for (const [list, mult] of [[KWRE[id].strong, 2], [KWRE[id].weak, 0.5]]) {
      let e = 0;
      for (const re of list) {
        if (re.test(q)) s += 3 * mult;
        if (re.test(key)) s += 2 * mult;
        if (re.test(exp)) e++;
        if (topic && re.test(topic)) s += 2 * mult;
      }
      s += Math.min(e, 3) * mult; // explanations are long: cap so they cannot outvote the stem
    }
    if (s > 0 && side && SIDE[id] === side) s += 2;
    if (s > bestScore) { best = id; bestScore = s; }
  }
  if (best) return { id: best, fallback: false };
  if (HOST) return { id: HOST.fallback, fallback: true };
  const t = String(topic || "").toLowerCase();
  const gyn = /gyn/.test(t) ? true : /obs/.test(t) ? false : side === "gy";
  return { id: gyn ? "gy-benign" : "ob-antenatal", fallback: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Doubtful-key heuristics (flags are hints for Review Desk, not verdicts; an item can carry several).
//  exp-letter  explanation opens "Ans. is 'c' ..." / "C i.e. ..." with a letter that is not the key's letter
//  exp-text    explanation opens "i.e. <option text>" naming an option that is not the key
//  dup-key     the source holds this exact question twice with different keys (the kept copy carries the flag)
//  dup-stem    same stem, different option set, and one item's key is an option in the other with a different key
const EXP_LETTER = [
  /^\s*ans(?:wer)?\b\.?\s*(?:is|:|-|=)?\s*(?:option\s*)?(?:\(\s*([a-d])\s*\)|['"\u2018\u201c]([a-d])['"\u2019\u201d]|([a-d])(?=\s*(?:[.:)\-;]|i\.?\s?e\b|$)))(?!\s*(?:,|and|&|or)\s*(?:\(\s*)?[a-d]\b)/i,
  /^\s*(?:\(\s*([a-d])\s*\)|['"\u2018\u201c]([a-d])['"\u2019\u201d]|([a-d]))\s*(?:[,.:]\s*)?i\.?\s?e\b/i,
];
export function expFlags(rawExp, opts, a) {
  const flags = [];
  const s = rawExp.slice(0, 160);
  for (const re of EXP_LETTER) {
    const m = re.exec(s);
    if (m) { const L = (m[1] || m[2] || m[3]).toLowerCase(); if ("abcd".indexOf(L) !== a) flags.push("exp-letter"); break; }
  }
  const multi = /^\s*ans\W*(?:is\W*)?[a-d]\s*(?:[,.&/]|and\b|or\b)\s*[a-d]\b/i.test(s); // "Ans. is a, b and c", "a/c": key is an "all of the above" style option
  const ie = /\bi\.?\s?e\b\.?\s*[,.:]?\s*/i.exec(s);
  if (ie && ie.index < 60 && !multi) {
    const head = normKey(s.slice(ie.index + ie[0].length, ie.index + ie[0].length + 90));
    const nk = normKey(opts[a]);
    let hit = -1, hitLen = 0;
    opts.forEach((o, j) => { const n = normKey(o); if (n.length >= 4 && head.startsWith(n) && n.length > hitLen) { hit = j; hitLen = n.length; } });
    if (hit >= 0 && hit !== a && !(nk.length >= 4 && head.startsWith(nk))) flags.push("exp-text");
  }
  return flags;
}

// ---------------------------------------------------------------------------------------------------------------------
function readRows(dir) {
  const base = process.env.MEDMCQA_COP_BASE === "1" ? 1 : 0;
  const files = fs.existsSync(path.join(dir, "train.jsonl")) ? ["train.jsonl", "validation.jsonl"] : ["train.json", "dev.json"];
  const rows = [];
  for (const fn of files) {
    const p = path.join(dir, fn);
    if (!fs.existsSync(p)) throw new Error(`missing ${p}; see the GET THE DATA block at the top of this script`);
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      if (r.subject_name === SUBJECT) rows.push({ ...r, cop: typeof r.cop === "number" ? r.cop - base : -1 });
    }
  }
  return rows;
}

export const debugRows = []; // dev aid: how each item was mapped (table | keyword | fallback), for spot checks
export function build(rows) {
  const st = { read: rows.length };
  // 1) clean strings, collect the corpus for the repair vocabulary
  const pre = rows.map((r) => ({
    id: r.id, cop: r.cop, ct: r.choice_type,
    q: cleanText(r.question), o: [r.opa, r.opb, r.opc, r.opd].map(cleanText), exp: cleanText(r.exp), topic: cleanText(r.topic_name),
  }));
  const rep = buildRepair(pre.flatMap((r) => [r.q, ...r.o, r.exp, r.topic]));
  st.repairWords = rep.fix.size;
  let repaired = 0;
  const fixText = (t) => { const u = rep.apply(t); if (u !== t) repaired++; return u; };
  for (const r of pre) { r.q = fixText(r.q); r.o = r.o.map(fixText); r.exp = fixText(r.exp); r.topic = fixText(r.topic); }
  st.repairedStrings = repaired;

  // 2) drop broken / no-key / figure-dependent items
  const drop = { brokenQuestion: 0, noValidKey: 0, brokenOptions: 0, imageRef: 0 };
  const items = [];
  for (const r of pre) {
    if (!r.q || r.q.length < 10) { drop.brokenQuestion++; continue; }
    if (!(r.cop >= 0 && r.cop <= 3)) { drop.noValidKey++; continue; }
    if (r.o.some((o) => !o || /^[-.\u2013\u2014\s]*$/.test(o)) || new Set(r.o.map(normKey)).size !== 4) { drop.brokenOptions++; continue; }
    if (IMAGE_REF.test(r.q) || IMAGE_REF.test(r.exp)) { drop.imageRef++; continue; }
    const key = r.o[r.cop];
    const flags = expFlags(r.exp, r.o, r.cop);
    items.push({ id: r.id, q: r.q, o: r.o, a: r.cop, key, exp: cleanExplanation(r.exp, key), rawTopic: r.topic, flags: new Set(flags), ct: r.ct });
  }
  st.drop = drop;
  st.afterDrops = items.length;

  // 3) de-duplicate: same normalized stem AND (same option set OR same key text, for non-trivial stems)
  const byStem = new Map();
  for (const it of items) { const k = normKey(it.q); if (!byStem.has(k)) byStem.set(k, []); byStem.get(k).push(it); }
  const kept = [];
  const dup = { removed: 0, keyConflicts: 0, stemConflicts: 0 };
  const optSet = (it) => it.o.map(normKey).sort().join("|");
  const better = (a, b) => (a.flags.size - b.flags.size) || (b.exp.length - a.exp.length) || (a.id < b.id ? -1 : 1);
  for (const [stem, group] of byStem) {
    const clusters = [];
    for (const it of group.sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const c = clusters.find((cl) => optSet(cl[0]) === optSet(it) || (stem.length >= 25 && normKey(cl[0].key) === normKey(it.key)));
      if (c) c.push(it); else clusters.push([it]);
    }
    const reps = [];
    for (const cl of clusters) {
      cl.sort(better);
      const rep = cl[0];
      dup.removed += cl.length - 1;
      if (cl.some((m) => normKey(m.key) !== normKey(rep.key))) { rep.flags.add("dup-key"); dup.keyConflicts++; }
      reps.push(rep);
    }
    if (reps.length > 1) {
      for (const a of reps) for (const b of reps) {
        if (a === b || normKey(a.key) === normKey(b.key)) continue;
        if (b.o.some((o) => normKey(o) === normKey(a.key)) || a.o.some((o) => normKey(o) === normKey(b.key))) { if (!a.flags.has("dup-stem")) { a.flags.add("dup-stem"); dup.stemConflicts++; } }
      }
    }
    kept.push(...reps);
  }
  st.dup = dup;
  st.afterDedupe = kept.length;

  // 4) subtopic + difficulty
  const bySub = Object.fromEntries(SUB_IDS.map((id) => [id, { table: 0, keyword: 0, fallback: 0 }]));
  const out = [];
  for (const it of kept.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    let t = tableTopic(it.rawTopic), how = "table";
    if (!t) { const k = keywordTopic({ q: it.q, key: it.key, exp: it.exp, topic: it.rawTopic }); t = k.id; how = k.fallback ? "fallback" : "keyword"; }
    bySub[t][how]++;
    debugRows.push({ id: it.id, t, how, topic: it.rawTopic });
    const o = { id: it.id, q: it.q, o: it.o, a: it.a, exp: it.exp, t, d: difficulty(it.q) };
    if (it.flags.size) o.flags = [...it.flags].sort();
    out.push(o);
  }
  st.bySubtopic = bySub;
  return { items: out, stats: st };
}

export function summarize(items) {
  const byLevel = { 1: 0, 2: 0, 3: 0 }, byTopic = Object.fromEntries(SUB_IDS.map((id) => [id, 0])), flags = {};
  let withExp = 0, flagged = 0;
  for (const it of items) {
    byLevel[it.d]++; byTopic[it.t]++;
    if (it.exp) withExp++;
    if (it.flags) { flagged++; for (const f of it.flags) flags[f] = (flags[f] || 0) + 1; }
  }
  return { total: items.length, byLevel, byTopic, withExplanation: withExp, flagged, flags };
}

function main() {
  const hi = process.argv.indexOf("--host");
  if (hi > 0) useHost(process.argv[hi + 1]);
  const dir = process.env.MEDMCQA_DIR;
  if (!dir) { console.error("set MEDMCQA_DIR (see the GET THE DATA block at the top of this script)"); process.exit(1); }
  const { items, stats } = build(readRows(dir));
  const sum = summarize(items);
  const index = {
    id: "mcq", v: 1, ...SOURCE, ...(HOST ? { modifications: SOURCE.modifications.replace("Gynaecology & Obstetrics", SUBJECT).replace(/Tokós subtopics/, `${HOST.name} subtopics`) } : {}), subject: SUBJECT,
    counts: { total: sum.total, d1: sum.byLevel[1], d2: sum.byLevel[2], d3: sum.byLevel[3] },
    topics: SUBTOPICS.map(({ id, title, group }) => ({ id, title, group, count: sum.byTopic[id], file: `mcq/${id}.json` })),
    flagLegend: FLAG_LEGEND,
    stats: { ...sum, build: stats },
  };
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  if (!HOST) fs.rmSync(path.join(ROOT, "tokos", "decks", "mcq.json"), { force: true }); // the old single-file deck
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let bytes = 0, biggest = 0;
  const write = (name, obj) => { const body = JSON.stringify(obj); bytes += Buffer.byteLength(body); biggest = Math.max(biggest, Buffer.byteLength(body)); fs.writeFileSync(path.join(OUT_DIR, name), body); };
  write("index.json", index);
  for (const id of SUB_IDS) write(`${id}.json`, { topic: id, items: items.filter((it) => it.t === id) });
  const searchBytes = writeSearch(OUT_DIR); // the compact search index over the topic files just written
  console.log(`wrote search.json ${(searchBytes / 1e6).toFixed(2)} MB`);
  console.log(JSON.stringify({ read: stats.read, repairWords: stats.repairWords, repairedStrings: stats.repairedStrings, drop: stats.drop, afterDrops: stats.afterDrops, dup: stats.dup, afterDedupe: stats.afterDedupe }, null, 1));
  console.log("difficulty:", JSON.stringify(sum.byLevel), "with explanation:", sum.withExplanation, "flagged:", sum.flagged, JSON.stringify(sum.flags));
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("subtopic", 18), pad("total", 7), pad("table", 7), pad("keyword", 8), "fallback");
  let kw = 0, fb = 0, tb = 0;
  for (const id of SUB_IDS) {
    const b = stats.bySubtopic[id]; kw += b.keyword; fb += b.fallback; tb += b.table;
    console.log(pad(id, 18), pad(sum.byTopic[id], 7), pad(b.table, 7), pad(b.keyword, 8), b.fallback);
  }
  console.log(`table-mapped ${tb}, keyword-mapped ${kw}, fallback (no keyword signal) ${fb}`);
  console.log(`wrote ${path.relative(ROOT, OUT_DIR)}/ (index + ${SUB_IDS.length} topic files) ${(bytes / 1e6).toFixed(2)} MB total, largest file ${(biggest / 1e6).toFixed(2)} MB, ${items.length} items`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
