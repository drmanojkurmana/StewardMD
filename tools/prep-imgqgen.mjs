#!/usr/bin/env node
// tools/prep-imgqgen.mjs - Writes Board-style MCQs with claude-sonnet-5-5 vision and verifies blind with claude-haiku-5-5.
// Complies with:
//   - NBEMS / NEET-PG / INI-CET clinical vignette style
//   - Authority rule: Key is established strictly by image's source caption/diagnosis
//   - 4 homogeneous plausible options, distinct, balanced
//   - Reasoning fields: clues, ddx, mech, why-key, others, pearl, lo, rev, next
//   - Blind verification: Independent model solves image + question without seeing key
//   - Style gates: no em/en-dashes, no emojis, no brand/source names in stem/options

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(os.homedir(), "prep-data", "assessment", "images");

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf("--" + k); return i < 0 ? d : argv[i + 1]; };
const LEDGER = opt("ledger", path.join(os.homedir(), "prep-data", "assessment", "spend-ledger.tsv"));
const MANIFEST_FILE = opt("manifest", path.join(DATA_DIR, "clean-manifest.json"));
const OUT_PASSED = opt("out-passed", path.join(DATA_DIR, "candidates-passed.jsonl"));
const OUT_REVIEW = opt("out-review", path.join(DATA_DIR, "review-queue.jsonl"));
const LIMIT = Number(opt("limit", 0)) || 0;
const CONCURRENCY = Number(opt("concurrency", 3)) || 3;

const GEN_MODEL = opt("gen-model", "claude-sonnet-5-5");
const VERIFY_MODEL = opt("verify-model", "claude-haiku-5-5");
const PROFILE = opt("profile", "default");
const TARGET_SUBJECTS = opt("subjects", "anatomy,surgery,pathology").split(",").map((s) => s.trim()).filter(Boolean);

const PRICES = {
  "claude-haiku-5-5": { in: 0.10, out: 0.50 },
  "claude-sonnet-5-5": { in: 2.00, out: 10.00 },
  "claude-opus-5-5": { in: 4.00, out: 20.00 }
};

export function loadEnv() {
  const f = path.join(os.homedir(), ".config", "stewardmd", "anthropic.env");
  if (!fs.existsSync(f)) throw new Error("anthropic.env missing");
  const env = {};
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && (m[1] === "ANTHROPIC_API_KEY" || m[1] === "ANTHROPIC_WORKSPACE_ID")) env[m[1]] = m[2];
  }
  if (!env.ANTHROPIC_API_KEY) throw new Error("No ANTHROPIC_API_KEY in env file");
  return env;
}

export function logLedger(job, model, usage, costUsd, note) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const row = [
    dateStr,
    job,
    model,
    usage.input_tokens || 0,
    usage.output_tokens || 0,
    costUsd.toFixed(4),
    note
  ].join("\t");
  fs.appendFileSync(LEDGER, row + "\n");
}

export const GEN_SYSTEM_PROMPT = `You are a distinguished senior faculty member of the National Board of Examinations (NBEMS) designing image-based single-best-answer MCQs for NEET-PG and INI-CET.

You will be given:
1. A clinical medical image (histopathology slide, gross specimen, cytology, anatomical dissection, surgical specimen, or intraoperative photograph).
2. The authoritative diagnosis or anatomical structure established by the source caption.

Requirements:
1. Question Stem (q):
   - A short, realistic clinical vignette (2 to 4 sentences) including patient age/sex, clinical presentation, key symptoms, and relevant physical or laboratory findings.
   - Conclude with a clear prompt: "The characteristic histopathological/anatomical/surgical appearance is shown in the image. What is the most likely diagnosis?" OR "Identify the indicated structure/lesion shown in the image."
   - DO NOT reveal the answer, filename, source, or author in the stem!
   - NO em-dashes (—) or en-dashes (–). Use hyphens (-), commas, colons, or parentheses.
   - NO emojis.
   - NO source citations, book names, or hospital mentions.
2. Four Options (o):
   - Array of exactly 4 plausible, medically homogeneous options (all conditions at similar diagnostic level).
   - Exactly ONE correct option matching the authoritative diagnosis.
   - The correct answer position should be randomly distributed among indices 0, 1, 2, 3.
3. Reasons (r) & Explanation (exp):
   - r: Array of 4 concise explanations, one for each option (why the correct option is right based on microscopic/gross/anatomical landmarks, and why each distractor is wrong).
   - exp: Comprehensive clinical explanation paragraph detailing hallmark visual features seen in the image, diagnostic criteria, and clinical significance.
4. Key Pearl (kp):
   - High-yield, memorable "Remember" pearl for rapid exam revision.
5. Reasoning Object (x):
   - key: Detailed reason why the keyed option is correct based on visual findings.
   - others: Object with keys "A", "B", "C", "D" (for the 3 distractors) explaining why they are ruled out.
   - clues: 2-3 decisive visual or clinical clues.
   - ddx: Differential diagnosis comparison.
   - mech: Underlying pathophysiology or anatomical relationships.
   - lo: Learning objective statement.
   - rev: 2-3 bullet-point summary lines for quick recall.
6. Cognitive Level (cog): "reasoning" or "application" (or "recall").
7. Difficulty (d): 1 (straightforward classic), 2 (moderate clinical vignette), 3 (challenging).
8. Module ID (t): Valid module identifier matching the topic.

Return ONLY a valid JSON object matching this schema:
{
  "q": string,
  "o": [string, string, string, string],
  "a": number (0, 1, 2, or 3),
  "exp": string,
  "d": number (1, 2, or 3),
  "r": [string, string, string, string],
  "kp": string,
  "cog": "reasoning" | "application" | "recall",
  "t": string,
  "x": {
    "key": string,
    "others": { "A": string, ... },
    "pearl": string,
    "clues": string,
    "ddx": string,
    "mech": string,
    "lo": string,
    "rev": string
  }
}`;

export const ECG_GEN_SYSTEM_PROMPT = `You are a distinguished senior faculty member of the National Board of Examinations (NBEMS) designing ECG-based single-best-answer MCQs for NEET-PG and INI-CET.

You will be given:
1. An ECG tracing. It is a clean teaching illustration drawn for education, not a real patient recording. Read rate, rhythm, P waves, PR interval, QRS width and axis, ST segments and T waves from it.
2. The authoritative ECG diagnosis established by the source teaching entry.

Requirements:
1. Question Stem (q):
   - A short, realistic clinical vignette (2 to 4 sentences) including patient age/sex, presentation, and key examination or laboratory findings that fit the authoritative diagnosis.
   - Conclude with a clear prompt naming the ECG task, e.g. "The ECG is shown in the image. What is the most likely diagnosis?" or "What does this ECG show?" or "Which territory is involved?" or "What is the next best step?"
   - Vary the task across rhythm/ECG diagnosis, axis determination, ischaemia localisation, and electrolyte/metabolic ECG changes as the tracing allows.
   - DO NOT reveal the answer, filename, source, or author in the stem!
   - NO em-dashes (—) or en-dashes (–). Use hyphens (-), commas, colons, or parentheses.
   - NO emojis.
   - NO source citations, book names, or hospital mentions.
2. Four Options (o):
   - Array of exactly 4 plausible, medically homogeneous options (all ECG diagnoses, all territories, all axes, or all next steps at a similar level).
   - Exactly ONE correct option matching the authoritative diagnosis.
   - The correct answer position should be randomly distributed among indices 0, 1, 2, 3.
3. Reasons (r) & Explanation (exp):
   - r: Array of 4 concise explanations, one for each option (why the correct option is right based on ECG landmarks, and why each distractor is wrong).
   - exp: Comprehensive explanation paragraph detailing hallmark ECG features seen in the tracing, diagnostic criteria, and clinical significance.
4. Key Pearl (kp):
   - High-yield, memorable "Remember" pearl for rapid exam revision.
5. Reasoning Object (x):
   - key: Detailed reason why the keyed option is correct based on ECG findings.
   - others: Object with keys "A", "B", "C", "D" (for the 3 distractors) explaining why they are ruled out.
   - clues: 2-3 decisive ECG or clinical clues.
   - ddx: Differential diagnosis comparison.
   - mech: Underlying pathophysiology.
   - lo: Learning objective statement.
   - rev: 2-3 bullet-point summary lines for quick recall.
6. Cognitive Level (cog): "reasoning" or "application" (or "recall").
7. Difficulty (d): 1 (straightforward classic), 2 (moderate clinical vignette), 3 (challenging).
8. Module ID (t): Valid module identifier matching the topic.

Return ONLY a valid JSON object matching this schema:
{
  "q": string,
  "o": [string, string, string, string],
  "a": number (0, 1, 2, or 3),
  "exp": string,
  "d": number (1, 2, or 3),
  "r": [string, string, string, string],
  "kp": string,
  "cog": "reasoning" | "application" | "recall",
  "t": string,
  "x": {
    "key": string,
    "others": { "A": string, ... },
    "pearl": string,
    "clues": string,
    "ddx": string,
    "mech": string,
    "lo": string,
    "rev": string
  }
}`;

export const EYE_GEN_SYSTEM_PROMPT = `You are a distinguished senior faculty member of the National Board of Examinations (NBEMS) designing image-based ophthalmology single-best-answer MCQs for NEET-PG and INI-CET.

You will be given:
1. A real clinical eye image (optical coherence tomography scan, fundus photograph, optic disc photograph, slit lamp photograph, or ocular ultrasound).
2. The authoritative diagnosis, grade, or stage established by the source dataset ground truth.

Requirements:
1. Question Stem (q):
   - A short, realistic clinical vignette (2 to 4 sentences) including patient age/sex, presentation, and key examination findings that fit the authoritative diagnosis.
   - Conclude with a clear prompt, e.g. "The finding is shown in the image. What is the most likely diagnosis?" or "What grade/stage is shown?" or "What is the next best step?"
   - Medical term first with the plain meaning in brackets at its first use (e.g. "neovascularisation (new abnormal blood vessel growth)"). Never use a lay word instead of the medical term.
   - Expand every abbreviation at its first use (e.g. "optical coherence tomography (OCT)", "diabetic retinopathy (DR)", "retinopathy of prematurity (ROP)", "intraocular pressure (IOP)"). Later uses may be short.
   - DO NOT reveal the answer, filename, source, or author in the stem!
   - NO em-dashes (—) or en-dashes (–). Use hyphens (-), commas, colons, or parentheses.
   - NO emojis.
   - NO source citations, book names, author names, coaching brands, or hospital mentions.
2. Four Options (o):
   - Array of exactly 4 plausible, medically homogeneous options (all diagnoses, all grades/stages, or all next steps at a similar level).
   - Exactly ONE correct option matching the authoritative diagnosis.
   - The correct answer position should be randomly distributed among indices 0, 1, 2, 3.
   - Options follow the same term-first and abbreviation rules as the stem.
3. Reasons (r) & Explanation (exp):
   - r: Array of 4 concise explanations, one for each option (why the correct option is right based on image landmarks, and why each distractor is wrong).
   - exp: Comprehensive explanation paragraph detailing hallmark image features, diagnostic criteria or grading, and clinical significance, following the same term-first and abbreviation rules.
4. Key Pearl (kp):
   - High-yield, memorable "Remember" pearl for rapid exam revision.
5. Reasoning Object (x):
   - key: Detailed reason why the keyed option is correct based on image findings.
   - others: Object with keys "A", "B", "C", "D" (for the 3 distractors) explaining why they are ruled out.
   - clues: 2-3 decisive image or clinical clues.
   - ddx: Differential diagnosis comparison.
   - mech: Underlying pathophysiology.
   - lo: Learning objective statement.
   - rev: 2-3 bullet-point summary lines for quick recall.
6. Cognitive Level (cog): "reasoning" or "application" (or "recall").
7. Difficulty (d): 1 (straightforward classic), 2 (moderate clinical vignette), 3 (challenging).
8. Module ID (t): Valid module identifier matching the topic.

Return ONLY a valid JSON object matching this schema:
{
  "q": string,
  "o": [string, string, string, string],
  "a": number (0, 1, 2, or 3),
  "exp": string,
  "d": number (1, 2, or 3),
  "r": [string, string, string, string],
  "kp": string,
  "cog": "reasoning" | "application" | "recall",
  "t": string,
  "x": {
    "key": string,
    "others": { "A": string, ... },
    "pearl": string,
    "clues": string,
    "ddx": string,
    "mech": string,
    "lo": string,
    "rev": string
  }
}`;

export const VERIFY_SYSTEM_PROMPT = `You are an independent Chief Medical Examiner evaluating an image-based question blind.
Examine the image and the 4 options carefully without knowing which option the author intended as the key.
Determine the single best answer based solely on standard medical evidence and visual hallmarks in the image.

Output ONLY valid JSON:
{
  "picked_option": number (0, 1, 2, or 3),
  "confidence": "high" | "medium" | "low",
  "reasoning": string
}`;

async function callClaude(env, model, system, content, maxTokens = 1200) {
  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content }]
  };
  if (model === "claude-haiku-5-5") {
    body.thinking = { type: "disabled" };
  }

  const headers = {
    "content-type": "application/json",
    "x-api-key": env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01"
  };
  if (env.ANTHROPIC_WORKSPACE_ID) {
    headers["anthropic-workspace-id"] = env.ANTHROPIC_WORKSPACE_ID;
  }

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000)
      });

      if (!res.ok) {
        const err = await res.text();
        if ((res.status === 429 || res.status >= 500) && attempt < 4) {
          const delay = attempt * 2000;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`Anthropic ${model} HTTP ${res.status}: ${err.slice(0, 300)}`);
      }

      return await res.json();
    } catch (e) {
      if (attempt < 4 && !String(e.message).includes("HTTP 40")) {
        await new Promise((r) => setTimeout(r, attempt * 2000));
        continue;
      }
      throw e;
    }
  }
}

function sanitizeText(s) {
  return String(s || "")
    .replace(/[\u2014\u2013]/g, "-") // replace em-dash and en-dash
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "") // strip emojis
    .trim();
}

export function mediaType(p) {
  if (/\.jpe?g$/i.test(p)) return "image/jpeg";
  if (/\.png$/i.test(p)) return "image/png";
  if (/\.gif$/i.test(p)) return "image/gif";
  return "image/webp";
}

// Module mapping heuristic based on subject and keywords
export function mapModuleId(subject, topic, caption, item) {
  if (item && item.module) return item.module;
  if (subject === "ss-cardiology") return "sca-ecg";
  const text = `${topic} ${caption}`.toLowerCase();
  const route = (rules, dflt) => {
    for (const [re, mid] of rules) if (new RegExp(re, "i").test(text)) return mid;
    return dflt;
  };
  if (subject === "pathology") return route([
    ["smudge|cll|small lymphocytic|hairy cell|burkitt|starry sky|diffuse large b|follicular lymphoma|mantle cell|maltoma|mycosis fungoides|sezary", "pat-non-hodgkin-lymphoma"],
    ["hodgkin|reed-sternberg|nodular scleros", "pat-hodgkin-lymphoma"],
    ["myeloblast|auer rod|promyelocyt|blast crisis|acute (myeloid|lymphoblastic|leuk|leuk)|leukaem|leukem|lymphoblast", "pat-acute-leukaemias"],
    ["myelodysplas|ring sideroblast|5q-|myeloproliferat|polycythaemia|polycythemia|myelofibrosis|essential thrombocythaemia|jak2|jak 2", "pat-mpn-mds"],
    ["myeloma|bence jones|plasmacyt|rouleaux|mgus|waldenstrom|histiocyt|langerhans|erdheim|rosai", "pat-plasma-cell-histiocytic"],
    ["spherocyt|elliptocyt|sickle|drepanocyte|target cell|schistocyte|bite cell|blister cell|g6pd|thalassaemia|thalassemia|hb bart|hb ?h |brill", "pat-haemolytic-hereditary"],
    ["haemoglobinopath|hemoglobinopath", "pat-haemoglobinopathies"],
    ["microcy|hypochrom|pencil cell|koilony|iron deficien|ferritin", "pat-iron-deficiency"],
    ["macro-ovalocyte|hypersegment|megaloblast|b12|folate|pernicious", "pat-megaloblastic"],
    ["coombs|cold agglutinin|warm autoimmune|paroxysmal nocturnal|\\bpnh\\b|transfusion reaction", "pat-haemolytic-acquired"],
    ["blood smear|blood film|peripheral smear|reticulocyte|neutrophil|eosinophil|basophil|monocyte|band form|left shift|leukemoid|pelger|alder|chediak|may-hegglin|leukocyte|wbc ", "pat-benign-wbc-lymph-node"],
    ["marrow|aplastic|pancytopenia|pure red cell|fanconi|diamond-blackfan", "pat-haematopoiesis-marrow-failure"],
    ["platelet|megakaryocyte|\\bitp\\b|\\bttp\\b|\\bhus\\b|disseminated intravascular|glanzmann|bernard-soulier", "pat-platelet-disorders"],
    ["haemophilia|hemophilia|christmas disease|von willebrand|factor (viii|ix|xi)|lupus anticoagulant", "pat-coagulation-disorders"],
    ["transfusion|crossmatch|blood group|\\babo\\b|rh\\(|iron overload", "pat-transfusion"],
    ["pap smear|papnicolaou|bethesda|ascus|lsil|hsil|koilocyt", "pat-cervix-uterus"],
    ["thyroid|papillary|psammoma|parathyroid|medullary carcinoma|hashimoto|graves", "pat-thyroid-parathyroid"],
    ["fnac|fine needle|aspirat|cytolog|effusion|nipple discharge", "pat-tumour-diagnosis"],
    ["cervi|uterus|endometr|molar|choriocarcinoma|leiomyoma|fibroid", "pat-cervix-uterus"],
    ["teratoma.*(mediastin|lung|retroperiton|pineal|sacrococcygeal)|(mediastin|lung|retroperiton|pineal|sacrococcygeal).*teratoma", "pat-tumour-diagnosis"],
    ["ovary|teratoma|krukenberg", "pat-ovary"],
    ["glomerul|nephr|kidney|renal|tubulo|polycystic kidney|pyelonephr", "pat-glomerular"],
    ["hepat|biliary|cholangio|cirrhosis|liver|hepatitis|budd-chiari|alpha-1 antitrypsin", "pat-hepatitis-cirrhosis"],
    ["pancrea|gallbladder|cholecyst|ampulla|pancreatitis|islet", "pat-gallbladder-pancreas"],
    ["mammary|breast|fibroadenoma|phyllodes|ductal carcinoma|lobular|fat necrosis", "pat-breast"],
    ["prostat|testis|seminoma|penile|epididym", "pat-male-genital"],
    ["pituitary|adrenal|cushing|addison|phaeochromocytoma|\\bmen \\b|diabetes insipidus|acromegaly", "pat-pituitary-adrenal"],
    ["diabet|insulinoma|gastrinoma|neuroendocrine", "pat-diabetes-men"],
    ["brain|cns|glio|meningi|medullo|schwann|oligodendro|ependym|craniopharyngioma|astrocytoma", "pat-cns-tumours"],
    ["alzheimer|parkinson|demyelin|multiple sclerosis|stroke|berry aneurysm|subarachnoid", "pat-cns-non-neoplastic"],
    ["muscle biopsy|duchenne|myasthenia|neuropathy|guillain", "pat-nerve-muscle"],
    ["melanoma|nevus|basal cell|keratoacanthoma|pemphigus|psoriasis|lichen|dermatitis|schamberg", "pat-skin"],
    ["osteosarcoma|ewing|chondrosarcoma|giant cell tumo[u]?r|osteochondroma|osteoid osteoma|bone cyst|paget.*bone", "pat-bone"],
    ["synov|gout|tophi|rheumatoid|osteoarthritis|ganglion|lipoma|fibrosarcoma|rhabdomyosarcoma|synovial sarcoma|dermatofibroma|neurofibroma", "pat-joints-soft-tissue"],
    ["atheroscler|aneurysm|aortic dissection|vasculitis|takayasu|kawasaki|polyarteritis|temporal arteritis|varicose|thrombophlebit", "pat-atherosclerosis-aneurysm"],
    ["myocardial infarct|coronary thrombus|vegetation|endocarditis|rheumatic heart|cardiomyopathy|pericarditis", "pat-ischaemic-heart"],
    ["pneumoconiosis|silicos|asbestos|ferruginous|coal worker|berylliosis", "pat-pneumoconiosis"],
    ["emphysema|bronchiectasis|asthma|chronic bronchitis|ards|hyaline membrane|pneumonia|lobar|bronchopneumonia|miliary", "pat-obstructive-restrictive"],
    ["lung (tumour|tumor|carcinoma)|adenocarcinoma.*lung|squamous.*lung|small cell|mesothelioma|carcinoid.*lung|hamartoma.*lung", "pat-lung-tumours"],
    ["colorectal|colon|intestine|bowel|rectal|appendi|gastric|stomach|esophag|barrett|coeliac|crohn|ulcerative colitis|polyp|diverticul|hirschsprung|peutz|gardner|turcot", "pat-intestine"],
    ["oral|squamous.*mouth|leukoplakia|salivary|pleomorphic adenoma|warthin|sialaden", "pat-oral-salivary"],
    ["granuloma|tuberculo|langhans|caseat|sarcoid|leprosy|rhinoscleroma", "pat-chronic-granulomatous"],
    ["amyloid|congo red|transthyretin", "pat-amyloidosis"],
    ["apoptos|necrosis|gangrene|fat necrosis|liquefactive|coagulative|dystrophic calcif", "pat-cell-injury-necrosis"],
    ["metaplasia|dysplasia|hyperplasia|hypertrophy|atrophy|lipofuscin|steatosis|haemosiderin|bilirubin", "pat-adaptations-accumulations"],
    ["shock|ards|multiorgan", "pat-shock"],
    ["thromb|embolus|infarct", "pat-thrombosis-embolism"],
  ], "pat-tumour-diagnosis");
  if (subject === "anatomy") return route([
    ["brachial|axill|pectoral", "ana-axilla-plexus"],
    ["femoral|thigh|inguinal", "ana-thigh"],
    ["knee|popliteal", "ana-knee-popliteal"],
    ["cranial|skull|cavity|calvaria|sella|foramen", "ana-skull-cranial-cavity"],
    ["triangle|carotid", "ana-neck-triangles"],
    ["coronary|myocard|pericard|valve", "ana-heart"],
    ["periton|mesenter|celiac|coeliac|portal", "ana-peritoneum"],
    ["cerebell|purkinje", "ana-cerebellum"],
    ["brainstem|pons|medulla|midbrain", "ana-brainstem"],
    ["spinal cord|vertebra|intervertebral", "ana-spinal-cord"],
    ["cerebr|cortex|hippocampus|gyrus", "ana-cerebrum"],
    ["larynx|pharynx|vocal|trachea", "ana-larynx"],
    ["pleura|bronch|mediastin|thymus", "ana-mediastinum"],
    ["liver|gallbladder|bile duct", "ana-liver-portal"],
    ["stomach|spleen|pancreas|duoden", "ana-stomach-spleen"],
    ["jejun|ileum|colon|rectum|appendix", "ana-intestines"],
    ["kidney|ureter|suprarenal", "ana-kidney-posterior-wall"],
    ["prostate|bladder|urethra|testis|uterus|ovary|pelvi|perine", "ana-pelvis-perineum"],
    ["orbit|extraocular|lacrimal", "ana-orbit"],
    ["parotid|infratemporal|pterygoid", "ana-parotid-infratemporal"],
    ["nasal|sinus|turbinate|olfactory", "ana-nose-sinuses"],
    ["middle ear|ossicle|tympanic|mastoid", "ana-ear"],
    ["lymph node|lymphatic|tonsil", "ana-lymphoid-vessels"],
    ["epitheli|goblet|microvilli|basement membrane", "ana-epithelium"],
    ["osteon|haversian|endochondral|epiphys|diaphys|joint|cartilage|synovi", "ana-connective-cartilage-bone"],
    ["placenta|umbilical|embryo|fetus|morula|blastocyst|gastrulat", "ana-implantation-placenta"],
    ["neural tube|somite|pharyngeal arch|dermatome", "ana-germ-layers"],
    ["retina|cochlea|optic nerve|visual pathway|auditory", "ana-visual-auditory-pathways"],
    ["circle of willis|cerebral arter", "ana-blood-supply-brain"],
    ["mening|ventricle|subarachnoid|dura", "ana-ventricles-meninges"],
  ], "ana-muscles-nerves-vessels");
  if (subject === "surgery") return route([
    ["cholecyst|gallbladder|calot|biliary", "sur-gallbladder"],
    ["appendix|appendic", "sur-appendix"],
    ["hernia|hydrocele|inguinal canal", "sur-hernia"],
    ["thyroid|goitre|thyroglossal", "sur-thyroid"],
    ["parathyroid|adrenal|phaeo|pheo", "sur-parathyroid-adrenal"],
    ["breast|mastectomy|lactat|mammogra|nipple", "sur-breast-cancer"],
    ["colon|rectal|colectomy|stoma", "sur-colorectal-cancer"],
    ["stomach|gastric|gastrectomy|peptic|vagotomy", "sur-stomach"],
    ["pancreas|whipple|pseudocyst", "sur-pancreas"],
    ["instrument|forceps|retractor|clamp|scalpel", "sur-periop"],
    ["oesophag|barrett|achalasia", "sur-oesophagus"],
    ["liver (tumour|tumor|resection|abscess)|hepatectomy|hydatid", "sur-liver"],
    ["varic|portal hypertension|splenorenal", "sur-portal-hypertension"],
    ["splenectomy|spleen", "sur-spleen"],
    ["obstruct|volvulus|intussuscept|adhesion|ileostomy", "sur-obstruction"],
    ["crohn|fistula|short bowel|meckel", "sur-small-bowel"],
    ["polyp|diverticul|ulcerative colitis", "sur-colon-benign"],
    ["haemorrhoid|hemorrhoid|fissure|perianal|pilonidal", "sur-anorectal"],
    ["peritonitis|oment|retroperiton", "sur-peritoneum"],
    ["calculus|stone|ureteric colic|pyelonephr|lithotripsy", "sur-urolithiasis"],
    ["renal (tumour|tumor|cell carcinoma)|nephrectomy|wilms", "sur-renal-tumours"],
    ["bladder|prostat|turp|bph", "sur-bladder"],
    ["testis|torsion|varicocele|phimosis|urethra", "sur-testis"],
    ["aneurysm|aortic|dissection|claudicat|bypass|graft|av fistula", "sur-aneurysm"],
    ["venous ulcer|dvt|thrombophlebit", "sur-venous"],
    ["lymphoedema|lymphedema|filarias|elephantiasis", "sur-lymphatic"],
    ["thorac|rib fracture|haemothorax|empyema|decortication", "sur-thoracic"],
    ["burn|contracture|flap|melanoma|skin tumour|basal cell", "sur-plastic"],
    ["laparoscop|trocar|pneumoperitoneum|robotic", "sur-mis"],
    ["head injury|gcs|extradural|subdural", "sur-head-injury"],
    ["transplant|rejection|donor", "sur-transplant"],
    ["paediat|neonat|hirschsprung|atresia|pyloric stenosis", "sur-paed-gi"],
  ], "sur-onc-principles");
  if (subject === "dermatology") return route([
    ["impetigo|erysipelas|cellulitis|furuncle|carbuncle|ecthyma|folliculitis|staph.*skin", "der-bacterial"],
    ["leprosy|leonine|claw hand|hypoesthetic patch", "der-leprosy"],
    ["tinea|ringworm|kerion|versicolor|pityriasis versicolor|onychomycosis|candid|thrush|mycetoma|malassezia|pityrosporum|athlete.?s foot", "der-fungal"],
    ["zoster|shingles|varicella|chickenpox|herpes|molluscum|wart|verruca|scabies|burrow|pediculosis|larva migrans", "der-viral-parasitic"],
    ["chancre|syphilis|chancroid|granuloma inguinale|donovan|lymphogranuloma", "der-sti"],
    ["psoriasis|guttate|auspitz", "der-psoriasis"],
    ["lichen planus|wickham|pityriasis rosea|herald patch|lichenoid", "der-other-papulosquamous"],
    ["eczema|dermatitis|atopic|contact|seborrhe|dyshidrotic|nummular|cradle cap", "der-eczema"],
    ["pemphigus|nikolsky|bullous pemphigoid|dermatitis herpetiformis|linear iga|epidermolysis", "der-vesiculobullous"],
    ["stevens-johnson|toxic epidermal|fixed drug|drug (rash|eruption|reaction)|dress|erythema multiforme", "der-drug-reactions"],
    ["urticaria|wheal|angioedema|vasculitis|purpura|erythema nodosum|pyoderma gangrenosum|henoch", "der-urticaria-vasculitis"],
    ["vitiligo|melasma|albinism|pigment|caf.-au-lait|freckle|lentigo", "der-pigmentary"],
    ["acne|rosacea|rhinophyma|rhinopyma|hidradenitis", "der-acne-rosacea"],
    ["alopecia|baldness|hirsutism|nail|onycho|koilonychia|clubbing|paronychia|telogen|anagen", "der-hair-nail"],
    ["dermatomyositis|gottron|heliotrope|lupus|morphea|scleroderma|scleromyxedema", "der-connective-tissue"],
    ["acanthosis|necrolysis migratory|necrolytic|leser-trelat|paraneoplastic skin|pellagra|casal|tripe palm|pyoderma.*systemic", "der-cutaneous-markers"],
    ["photosensitiv|xeroderma|polymorphic light|porphyria.*skin|solar", "der-photodermatoses"],
    ["ichthyosis|neurofibroma|tuberous|darier|hailey|incontinentia pigmenti|genoderm", "der-genodermatoses"],
    ["keloid|seborrheic keratosis|hemangioma|port-wine|pyogenic granuloma|dermatofibroma|lipoma|epidermoid cyst|nevu|mole|skin tag|milia|syringoma", "der-benign-tumours"],
    ["actinic|bowen|basal cell|melanoma|squamous cell|kaposi|mycosis fungoides|paget|keratoacanthoma", "der-skin-malignancy"],
    ["biopsy|patch test|tzanck|phototherapy|retinoid|isotretinoin|dermoscopy", "der-drugs-procedures"],
    ["venous ulcer|stasis|diabetic foot|pressure ulcer|gaiter", "der-eczema"],
  ], "der-structure-lesions");
  if (subject === "microbiology") return route([
    ["sterilis|autoclave|disinfect|antiseptic|hospital infection control|biomedical waste", "mic-sterilisation"],
    ["plasmid|resistance|conjugation|transduction|transformation|beta-lactamase|mrsa gene|mecA", "mic-bacterial-genetics"],
    ["neutrophil|macrophage|innate|toll-like|antigen presentation", "mic-innate-antigens"],
    ["antibody|immunoglobulin|complement|opson", "mic-antibodies-complement"],
    ["widal|vdrl|elisa|agglutination|precipitation|coombs|immunofluorescence|western blot", "mic-ag-ab-reactions"],
    ["hypersensitivity|cytokine|mhc|graft-vs", "mic-immune-response"],
    ["hiv.*immun|cd4|opportunistic.*immun|transplant rejection", "mic-immunodeficiency-transplant"],
    ["staphylococcus|coagulase|mrsa|toxic shock.*staph|scalded skin", "mic-staphylococcus"],
    ["streptococc|rheumatic|quellung|pneumococcus|enterococcus|scarlet", "mic-streptococcus"],
    ["neisseria|gonococcus|meningococcus|moraxella|kidney.*diplococc", "mic-neisseria"],
    ["corynebacterium|diphther|bacillus anthracis|listeria|medusa head|tumbling", "mic-gram-positive-bacilli"],
    ["clostridium|tetanus|gas gangrene|botulism|drumstick|actinomyces|sulfur granule|nocardia", "mic-clostridia-anaerobes"],
    ["e[.-]? ?coli|escherichia|klebsiella|shigella|proteus|enterobacter|metallic sheen|string test", "mic-enterobacteriaceae"],
    ["salmonella|typhi|widal|enteric fever", "mic-salmonella"],
    ["vibrio|cholera|campylobacter|helicobacter|tcbs|darting motility", "mic-vibrio-campylobacter"],
    ["pseudomonas|pyocyanin|non-ferment", "mic-non-fermenters"],
    ["haemophilus|bordetella|legionella|brucella|yersinia|pasteurella|francisella|satellitism", "mic-haemophilus-zoonotic"],
    ["tuberculosis|mycobacterium tuberculosis|ziehl|ghon|tuberculin|mntoux", "mic-tuberculosis"],
    ["leprosy|leprae|atypical mycobact|buruli|avium", "mic-ntm-leprosy"],
    ["treponema|syphilis|dark ground|borrelia|leptospira|corkscrew", "mic-spirochaetes"],
    ["rickettsia|weil-felix|chlamydia|trachoma|mycoplasma|fried egg|ureaplasma", "mic-rickettsia-chlamydia-mycoplasma"],
    ["virus structure|prion|bacteriophage|viral replication|inclusion body.*general", "mic-general-virology"],
    ["herpes|tzanck|cytomegalovirus|owl eye|ebv|varicella.*virus", "mic-herpesviruses"],
    ["pox|adenovirus|papillomavirus|hpv|pap.?smear|parvovirus|koilocyt|molluscum.*virus|henderson-paterson", "mic-other-dna-viruses"],
    ["polio|picorna|rotavirus|norovirus|enterovirus", "mic-picorna-enteric"],
    ["influenza|orthomyxo|paramyxo|coronavirus|measles.*virus|mumps.*virus|rsv", "mic-respiratory-rna-viruses"],
    ["arbo|dengue|rabies|negri|yellow fever|ebola|chikungunya", "mic-arbo-rabies"],
    ["hepatitis|ground glass hepat", "mic-hepatitis-viruses"],
    ["hiv|retrovirus|cd4|western blot.*hiv", "mic-hiv"],
    ["koh|dermatophyte|tinea.*fung|mycetoma|sporothrix|chromoblast|rhinosporidi|superficial mycos", "mic-superficial-subcutaneous-mycoses"],
    ["aspergillus|candid|mucor|cryptococcus|histoplasma|blastomyces|coccidioides|paracoccidioides|pneumocystis|germ tube|india ink|lactophenol", "mic-systemic-opportunistic-mycoses"],
    ["giardia|entamoeba|trichomonas|cryptosporidium|cyclospora|isospora|balantidium|falling leaf", "mic-intestinal-protozoa"],
    ["plasmodium|malaria|babesia|leishmania|donovan|trypanosoma|toxoplasma|sch\u00fcffner|schuffner|maltese cross", "mic-blood-tissue-protozoa"],
    ["taenia|cestode|echinococcus|hydatid|schistosoma|trematode|fasciola|clonorchis|paragonimus", "mic-cestodes-trematodes"],
    ["ascaris|hookworm|trichuris|enterobius|strongyloides|wuchereria|microfilaria|nematode|filaria", "mic-nematodes"],
    ["gram stain|morphology|flagella|capsule|spore|acid-fast stain technique|albert stain|wayson", "mic-history-morphology"],
    ["blood agar|culture|chocolate agar|macconkey|wilson blair|lj slope|middlebrook|sabouraud|colony|haemolysis|hemolysis|swarming|satellitism", "mic-culture-identification"],
  ], "mic-culture-identification");
  if (subject === "orthopaedics") return route([
    ["garden|pauwels|schatzker|tile |young-burgess|judet|letournel|gartland|meyerding|classification|healing|callus", "ort-fracture-principles"],
    ["malunion|nonunion|myositis ossificans|compartment|fat embolism|crush|gas gangrene.*fracture|stiffness", "ort-fracture-complications"],
    ["radial nerve|median nerve|ulnar nerve|foot drop|wrist drop|claw|crutch palsy|holstein-lewis|han.*fracture.*nerve", "ort-nerve-injuries"],
    ["cast|traction|splint|thomas|nail|plate|screw|external fixator|prosthesis|implant", "ort-splints-implants"],
    ["clavicle|acromio|shoulder dislocation|humerus.*proximal|bankart|hill-sachs|rotator", "ort-shoulder-arm-injuries"],
    ["supracondylar|olecranon|lateral condyle|medial epicondyle|radial head|tennis elbow.*fracture", "ort-elbow-injuries"],
    ["colles|smith|monteggia|galeazzi|nightstick|barton|chauffeur|die-punch", "ort-forearm-wrist-injuries"],
    ["scaphoid|bennett|rolando|boxer|mallet|jersey|metacarpal|phalang", "ort-hand-injuries"],
    ["pelvi|pelvis|acetabul|ischi", "ort-pelvis-acetabulum"],
    ["hip dislocation|femoral neck|intertrochanteric|shenton|klein line|trethowan", "ort-hip-injuries"],
    ["femoral shaft|tibial spine|cruciate|menisc|patella|winquist", "ort-femur-knee-injuries"],
    ["ankle|weber|calcaneus|bohler|talus|hawkins|lisfranc|jones|metatarsal|march fracture", "ort-leg-ankle-foot-injuries"],
    ["\\bburst\\b|jefferson|hangman|odontoid|\\bchance\\b|whiplash|paraplegia|quadriplegia|spinal (injury|fracture|trauma)", "ort-spinal-injuries"],
    ["pott|paradiscal|spine.*tuberculosis|cold abscess|caries spine", "ort-tb-spine"],
    ["scoliosis|cobb|kyphosis|scheuermann|lordosis", "ort-scoliosis-kyphosis"],
    ["disc prolapse|slipped disc|sciatica|modic|spondylolisthesis|scotty|back pain|spondylosis|canal stenosis", "ort-low-back-pain"],
    ["osteomyelitis|involucrum|sequestrum|cloaca|brodie", "ort-osteomyelitis"],
    ["septic arthritis|tom smith|joint.*tuberculosis|triple deformity|wandering acetabulum", "ort-septic-arthritis-joint-tb"],
    ["osteochondroma|enchondroma|giant cell|osteoid osteoma|nidus|osteoblastoma|abc |aneurysmal|fibrous dysplasia|ground glass|simple bone cyst|fallen fragment|adamantinoma|chondromyxoid|nof ", "ort-benign-bone-tumours"],
    ["osteosarcoma|codman|sunburst|ewing|onion peel|chondrosarcoma|popcorn|myeloma|punched-out|winking owl|metastasis.*bone", "ort-malignant-bone-tumours"],
    ["dysplasia.*hip|ddh|perkin|hilgenreiner|acetabular index|barlow|ortolani", "ort-ddh"],
    ["clubfoot|ctev|pirani|ponseti|denis browne", "ort-ctev"],
    ["perthes|catterall|herring|scfe|slipped.*epiphysis", "ort-perthes-scfe"],
    ["dysplasia.*skeletal|achondroplasia|osteogenesis imperfecta|mucopolysaccharid", "ort-skeletal-dysplasia"],
    ["poliomyelitis.*ortho|cerebral palsy.*ortho|muscular dystrophy.*ortho|arthrogryposis", "ort-neuromuscular"],
    ["rickets|cupping|fraying|scurvy|osteoporosis|codfish|osteomalacia|paget|cotton wool|osteopetrosis|marble bone|hyperparathyroid.*bone|renal osteodystrophy", "ort-metabolic-bone"],
    ["avascular necrosis|avn|osteonecrosis|crescent sign|ficat|osteochondritis|panner|osgood", "ort-osteonecrosis-osteochondritis"],
    ["arthritis|rheumatoid|ulnar deviation|osteoarthritis|heberden|bouchard|gout|tophi|ankylosing|bamboo|arthroplasty|replacement", "ort-arthritis"],
    ["frozen shoulder|tennis elbow.*soft|golfer|impingement|bursitis", "ort-shoulder-elbow-conditions"],
    ["carpal tunnel|dupuytren|ganglion|de quervain|trigger|kienbock", "ort-hand-wrist-conditions"],
    ["bunion|hallux|plantar fasciitis|flat foot|tarsal coalition|anterior knee pain|chondromalacia", "ort-knee-foot-conditions"],
    ["amputat|prosthes|gait|trendelenburg|orthosis", "ort-amputation-gait"],
  ], "ort-fracture-principles");
  if (subject === "medicine") return route([
    ["pneumonia|lobar|bronchopneumonia|air bronchogram|consolidation", "med-pneumonia"],
    ["tuberculosis|cavitar|miliary|ghon|ranke|caseat.*lung", "med-tb"],
    ["pleural effusion|meniscus sign|pneumothorax|pleural line|empyema|hydropneumothorax|pleural plaque|plaque.*pleura", "med-pleural"],
    ["cardiomegaly|water bottle|pericardial effusion|pulmonary edema|bat wing|kerley|cephalization|alveolar.*edema", "med-heart-failure"],
    ["mitral stenosis|straightened.*border|left atrial enlargement|double density", "med-valvular"],
    ["coarctation|rib notching|aortic dissection|aortic aneurysm", "med-hypertension"],
    ["boot-shaped|tetralogy|egg-on-string|transposition|snowman|shunt.*cardiac|eisenmenger", "med-clinical-cardiology"],
    ["ards|ground glass.*(bilateral|diffuse)|white.?out lung", "med-resp-failure"],
    ["bronchiectasis|tramline|signet ring|cystic fibrosis", "med-bronchiectasis-cf"],
    ["hilar mass|pancoast|superior sulcus|coin lesion|solitary nodule|pulmonary nodule|lung nodule|part-solid|halo sign|cannonball|lung cancer|lung carcinoma", "med-lung-cancer"],
    ["silicos|asbestos|eggshell|honeycomb|\\buip\\b|hypersensitivity pneumonitis|sarcoid|bilateral hilar|interstitial lung|ground glass opacity|clubb.*ipf|ipf.*clubb", "med-ild"],
    ["hyperinflation|flat diaphragm|\\bcopd\\b|emphysema|bullae.*lung", "med-copd"],
    ["hampton|westermark|filling defect|pulmonary embol|dvt.*pe|pruned.*pulmonary|pulmonary hypertension", "med-pe-pulmonary-htn"],
    ["lung.?abscess|air-fluid.*lung|cavitary.*pneumonia", "med-pneumonia"],
    ["hydatid|water lily|echinococcal.*lung", "med-parasitic"],
    ["asthma|wheeze", "med-asthma"],
    ["infarct.*(mca|brain|cerebral)|stroke|insular ribbon|dense mca|thrombolysis.*window", "med-stroke"],
    ["h(ae)?morrhage.*(basal|brain|intracerebral)|hematoma|subdural|crescent.*brain|extradural|lens-shaped|subarachnoid|berry aneurysm", "med-ich"],
    ["hydrocephalus|transependymal|evans index|raised icp|papilledema.*mass|coning", "med-ich"],
    ["multiple sclerosis|dawson|demyelin|optic neuritis.*ms|internuclear", "med-ms"],
    ["ring-enhancing|toxoplasma.*brain|tuberculoma.*brain|meningitis|encephalitis|cerebritis|brain abscess|subdural empyema", "med-cns-infections"],
    ["rheumatoid|ulnar deviation|swan neck|boutonniere|z-thumb|rheumatoid nodule", "med-ra"],
    ["sacroiliitis|bamboo|ankylosing|psoriatic arthritis|reactive arthritis", "med-spa"],
    ["gout|tophi|topus|pseudogout|chondrocalcinosis|podagra", "med-crystal"],
    ["janeway|osler|splinter h(ae)?morrhage|roth spot|vegetation.*valve|duke criteria", "med-endocarditis"],
    ["scleroderma|raynaud|gottron|heliotrope|sjogren|sicca|myositis.*inflammatory|anti-jo|dm.*rash", "med-ctd"],
    ["malar rash|discoid.*lupus|aps |antiphospholipid|lupus nephritis", "med-sle"],
    ["takayasu|giant cell arteritis|temporal arteritis|kawasaki|polyarteritis nodosa", "med-vasculitis-large"],
    ["anca|granulomatosis|microscopic polyangiitis|henoch|palpable purpura|leukocytoclastic|cryoglobulin", "med-vasculitis-small"],
    ["amyloid|transthyretin|familial mediterranean|behcet", "med-amyloid-misc"],
    ["anaphylaxis|angioedema|urticaria.*allerg|allergy|immunodeficiency.*adult|cvid", "med-allergy-immunology"],
    ["cushing|striae|buffalo hump|moon facies|dexamethasone suppress|ectopic acth", "med-adrenal"],
    ["addison|hyperpigment.*(palm|mucosa)|salt craving|adrenal crisis|21-hydroxylase.*adult", "med-adrenal"],
    ["aldosterone|conn syndrome|adrenal adenoma.*aldo|pheochromocytoma|paraganglioma|men 2", "med-aldo-pheo"],
    ["spider naevi|palmar erythema|caput medusae|ascites|hepatic encephalopathy|meld|child-pugh|variceal bleed|\\btips\\b", "med-cirrhosis"],
    ["jaundice|hyperbilirubin|cholestasis.*adult|alkaline phosphatase.*raised|vanishing bile", "med-jaundice"],
    ["hepatitis (a|b|c|d|e)|viral hepatitis|acute liver failure|hepatic failure.*acute|wilson.*liver|budd-chiari", "med-viral-hepatitis"],
    ["fatty liver|steatosis|nash|nafld|alcoholic hepatitis|mallory", "med-fatty-liver"],
    ["autoimmune hepatitis|primary biliary|psc |igg4.*liver|drug-induced liver|hemochromatosis|alpha-1.*liver", "med-autoimmune-metabolic-liver"],
    ["acromegaly|pituitary|prolactinoma|galactorrhea.*pituitary|diabetes insipidus|siadh|sheehan|apoplexy.*pituitary", "med-pituitary"],
    ["exophthalmos|graves|thyroid storm|pretibial myxedema|hyperthyroid", "med-hyperthyroidism"],
    ["goitre|myxoedema|hashimoto|hypothyroid|cretinism.*adult|thyroiditis", "med-hypothyroidism"],
    ["tetany|chvostek|trousseau|hypocalcemia|hypercalcemia|parathyroid|pseudohypoparathyroid", "med-parathyroid"],
    ["paget.*bone|osteoporosis|osteomalacia|vitamin d.*adult|fragility fracture", "med-bone"],
    ["\\bcah\\b|congenital adrenal hyperplasia|hirsutism.*endocrine|turner.*adult|klinefelter.*adult|hypogonadism", "med-gonadal-cah"],
    ["diabetes|hyperglycemia|charcot|diabetic.*(foot|nephropathy|retinopathy|neuropathy)", "med-diabetes"],
    ["dka|hypoglycemia|hyperosmolar|diabetic ketoacidosis|lactic acidosis.*metformin", "med-diabetes-complications"],
    ["pallor|koilonychia|microcyt|iron deficien|ferritin.*low|thalassemia.*adult|sickle.*adult|hemoglobinopath", "med-microcytic"],
    ["macrocyt|megaloblast|b12|folate|pernicious|hypersegment", "med-megaloblastic"],
    ["hemolysis|spherocyt|g6pd|pnh|autoimmune hemolytic|evans syndrome|schistocyte", "med-haemolytic"],
    ["thalassaemia|thalassemia|sickle cell|hb ss|hb bart|hbf.*raised", "med-haemoglobinopathies"],
    ["aplastic|pancytopenia|myelodysplas|5q-|ring sideroblast", "med-marrow-failure"],
    ["auer|myeloblast|lymphoblast|acute leuk|blast crisis.*acute", "med-acute-leukaemia"],
    ["\\bcml\\b|jak2|polycythemia vera|myelofibrosis|essential thrombocythemia", "med-mpn"],
    ["lymphadenopathy|reed-sternberg|cll|smudge|burkitt|follicular lymphoma|mantle|dlbcl|mycosis", "med-lymphoma"],
    ["myeloma|bence jones|plasmacyt|rouleaux|mgus|waldenstrom|amyloid.*myeloma", "med-myeloma"],
    ["itp|purpura.*platelet|hemophilia|christmas disease|von willebrand|dvt.*bleed|thrombocytopen|platelet dysfunction", "med-bleeding"],
    ["anticoag|warfarin|heparin|doac|antiphospholipid.*clot|factor v leiden|transfusion reaction|trali|taco ", "med-thrombosis-transfusion"],
    ["sepsis|septic shock|qsofa|febrile neutropenia|fuor|fever.*unknown origin|catheter.*infection|uti.*sepsis", "med-sepsis"],
    ["hiv|cd4|opportunistic.*(candida|cmv|toxo|pcp|mac)|kaposi|aids", "med-hiv"],
    ["malaria|plasmodium|falciparum|vivax|schizont", "med-malaria"],
    ["dengue|chikungunya|zika|yellow fever.*adult|ns1", "med-arbovirus"],
    ["typhoid|enteric fever|scrub typhus|eschar|leptospirosis|weil disease", "med-enteric-rickettsial"],
    ["rabies|tetanus|diphtheria.*adult|anthrax.*adult|plague|brucellosis.*adult|leptospir", "med-zoonoses-toxin"],
    ["leprosy|leonine|claw hand.*leprosy|saddle nose", "med-leprosy"],
    ["chancre|syphilis|gumma|tabes|chancroid|lgv ", "med-sti"],
    ["mucor|aspergill.*invasive|candida.*systemic|cryptococc.*mening|histoplasma|pneumocystis", "med-fungal"],
    ["influenza|covid|h1n1|sars|cytokine storm|viral pneumonia", "med-viral"],
    ["stemi|nstemi|unstable angina|troponin|coronary.*(thrombus|occlusion|dissection)|mi.*ecg", "med-acs"],
    ["stable angina|xanthelasma|xanthoma|dyslipidemia|statin|coronary calcium|ct angio.*coronary", "med-cad-stable"],
    ["cardiomyopathy|myocarditis|takotsubo|hcm |arvc|dilated.*cardiomyopathy|peripartum.*cardio", "med-cardiomyopathy"],
    ["pericarditis|friction rub|beck triad|kussmaul|pulsus paradoxus|tamponade", "med-pericardial"],
    ["hypertension|hypertensive emergency|malignant hypertension|renal artery stenosis", "med-hypertension"],
    ["atrial fibrillation|flutter|svt|vtach|heart block|bundle branch|torsades|brugada|long qt|sick sinus|wpw", "med-arrhythmias"],
    ["orthopnea|paroxysmal nocturnal|gallop|raised jvp|jvp.*raised|acute decompensated|nyha", "med-heart-failure"],
    ["ecg|ekg|p wave|qrs|st segment|t wave|u wave|osborn| brugada", "med-ecg"],
    ["cranial nerve|hemiplegia|aphasia|agnosia|apraxia|gcs |decorticate|decerebrate|brainstem death", "med-localisation"],
    ["seizure|epilepsy|status epilepticus|absence|tonic-clonic|eeg ", "med-epilepsy"],
    ["headache|migraine|cluster headache|trigeminal neuralgia|giant cell.*headache|thunderclap|meningeal.*headache", "med-headache"],
    ["parkinson|tremor|chorea|dystonia|ataxia|huntington|wilson.*neuro|restless leg", "med-movement"],
    ["dementia|alzheimer|delirium|confusion.*acute|lewy body|frontotemporal", "med-dementia"],
    ["paraplegia|quadriplegia|brown-sequard|syringomyelia|motor neuron|als |transverse myelitis|spinal (shock|stenosis)", "med-spinal-cord"],
    ["stocking|glove.*neuropathy|foot drop|guillain|gbs |cidp|carpal tunnel|brachial neuritis", "med-neuropathy"],
    ["myasthenia|ptosis.*fatig|muscular dystrophy|duchenne|myotonic|periodic paralysis|lambert-eaton", "med-neuromuscular"],
    ["barrett|oesophagitis|achalasia|dysphagia.*adult|dyspepsia|gerd", "med-oesophagus"],
    ["peptic ulcer|gi bleed|melena|hematemesis|variceal.*bleed|forrest|blatchford|rockall", "med-peptic-gi-bleed"],
    ["malabsorption|coeliac|chronic diarrhoea|lactose|whipple|short bowel|steatorrhea", "med-malabsorption"],
    ["crohn|ulcerative colitis|ibd|toxic megacolon|fistula.*crohn", "med-ibd"],
    ["pancreatitis|amylase|lipase|pseudocyst|ranson|glasgow.*pancreatitis", "med-pancreatitis"],
    ["aki|acute kidney injury|rising creatinine|oliguria|contrast nephropathy|atn |rhabdomyolysis.*renal", "med-aki"],
    ["ckd|dialysis fistula|uremic|esrd|transplant kidney|gfr.*low", "med-ckd"],
    ["glomerulonephritis|nephritic|rbc cast|hematuria.*glomerular|iga nephropathy|psgn|rapidly progressive", "med-glomerulonephritis"],
    ["nephrotic|anasarca|proteinuria.*massive|minimal change|membranous|fsgs", "med-nephrotic"],
    ["tubulointerstitial|pyelonephritis.*chronic|analgesic nephropathy|polycystic kidney|medullary sponge", "med-tubulointerstitial"],
    ["renovascular|renal artery|thrombotic microangiopathy|\\bhus\\b|\\bttp\\b|scleroderma renal", "med-renovascular"],
    ["uti |cystitis|pyelonephritis.*acute|kidney stone|urolithiasis|colic.*flank|nitrite.*urine", "med-uti-stones"],
    ["hyponatremia|hypernatremia|diabetes insipidus.*sodium|siadh.*sodium|osmolarity", "med-sodium"],
    ["hyperkalemia|hypokalemia|tented t|u wave.*k|magnesium|phosphate.*low|hypophosphatemia", "med-potassium"],
    ["acidosis|alkalosis|anion gap|winter formula|delta gap|rta |renal tubular acidosis|abg ", "med-acid-base"],
    ["iv fluid|normal saline|ringer|fluid resuscitation|fluid overload.*iv", "med-iv-fluids"],
    ["pft|spirometry|abg.*interp|hypoxemia|hypercapnia|a-a gradient|dlco|flow-volume", "med-pft-abg"],
    ["shock|hypotension.*shock|vasopressor|noradrenaline|map |lactate.*shock|capillary refill", "med-shock"],
    ["cardiac arrest|cpr|asystole|pef |rosc|defibrillat|acls", "med-resuscitation"],
    ["poison|overdose|antidote|naloxone|flumazenil|methanol|ethylene glycol|salicylate|paracetamol.*overdose", "med-overdose"],
    ["organophosph|pesticide|carbamate|atropine.*op|pralidoxime|aluminum phosphide", "med-pesticides"],
    ["snake bite|scorpion|krait|cobra|viper|anti-snake venom|heavy metal.*poison|lead poison|mercury poison|arsenic", "med-envenomation"],
    ["heat stroke|hypothermia|drowning|altitude sickness|decompression|lightning|electrocution", "med-environmental"],
    ["scurvy|beriberi|pellagra|vitamin|zinc deficien|magnesium.*nutrition|refeeding|bmi.*adult|kwashiorkor.*adult", "med-nutrition"],
    ["paraneoplastic|tumour marker|ca-125|psa |cea |small cell.*paraneo|lambert.*paraneo", "med-paraneoplastic"],
    ["neutropenic sepsis|spinal cord compression.*malign|svc syndrome|tumour lysis|hypercalcemia.*malign", "med-onc-emergencies"],
    ["cancer screening|chemotherapy principle|tnm|performance status|adjuvant|neoadjuvant|immunotherapy.*principle", "med-onc-principles"],
    ["pedigree|down syndrome.*adult|turner.*inherit|klinefelter|fragile x|autosomal|consanguin", "med-inheritance"],
    ["albinism|pku|homocystinuria|porphyria|tay-sachs|gaucher|fabry|mps |urea cycle", "med-inborn-errors"],
    ["generalised tonic|aura.*seizure", "med-epilepsy"],
  ], "med-clinical-cardiology");
  if (subject === "paediatrics") return route([
    ["rickets|rachitic|cupping|fraying|rosary|genu varum|bow leg|vitamin d.*child|widened.*(wrist|growth plate)", "ped-micronutrients"],
    ["scurvy|wimberger|white line.*frankel|subperiosteal.*child|gum.*bleed.*child", "ped-micronutrients"],
    ["kwashiorkor|marasmus|flaky paint|mid-upper arm|wasting.*child|stunting|undernutrition|sam |severe acute malnutrition|appetite test.*child", "ped-malnutrition"],
    ["measles|koplik|rubella.*child|roseola|fifth disease|parvovirus.*child|slapped cheek", "ped-exanthems"],
    ["chickenpox|varicella|zoster.*child|scarlet|strawberry tongue|hand.?foot|\bhfmd\b|herpangina|onychomadesis|kawasaki.*rash", "ped-exanthems"],
    ["respiratory distress.*neonat|ground glass.*neonat|hyaline membrane|surfactant|meconium aspiration|transient tachypnea|ttn |pneumothorax.*neonat|bronchopulmonary dysplasia|apnea.*preterm", "ped-neonatal-respiratory"],
    ["necrotising|necrotizing|pneumatosis|portal venous gas.*neonat", "ped-gi-disorders"],
    ["double.?bubble|duodenal atresia|annular pancreas.*child", "ped-gi-disorders"],
    ["intussusception|target sign|red currant|sausage.*mass", "ped-gi-disorders"],
    ["pyloric|projectile.*vomit|olive.*mass.*infant|visible peristalsis.*infant", "ped-gi-disorders"],
    ["hirschsprung|transition zone.*colon|aganglionic|delayed.*meconium", "ped-gi-disorders"],
    ["diaphragmatic hernia|bowel.*thorax.*neonat|scaphoid abdomen", "ped-neonatal-respiratory"],
    ["oesophageal atresia|coiled.*(tube|ngt)|tracheoesophageal fistula|polyhydramnios.*pouch|frothing.*neonat", "ped-gi-disorders"],
    ["omphalocele|gastroschisis|exomphalos|abdominal wall defect", "ped-gi-disorders"],
    ["umbilical granulat|umbilical granuloma|omphalitis|umbilical sepsis|single umbilical artery|cord.*(bleed|infection).*neonat", "ped-newborn-care"],
    ["boot-shaped|tetralogy|egg-on-string|transposition.*great|snowman.*heart|coarctation.*child|shunt.*congenital|ductus.*patent|asd |vsd |tet spells|hypercyanotic", "ped-congenital-heart"],
    ["rheumatic.*child|jones criteria|sydenham|kawasaki.*coronary|myocarditis.*child|cardiomyopathy.*child", "ped-acquired-heart"],
    ["down syndrome|simian|epicanthal|sandal gap|trisomy 21|brushfield", "ped-chromosomal"],
    ["turner.*child|webbed neck.*child|klinefelter.*child|noonan|williams.*child|prader-willi|angelman|fragile x.*child|di?george", "ped-inheritance-syndromes"],
    ["spina bifida|meningomyelocele|myelomeningocele|hairy patch.*back|dermal sinus.*spine|tethered cord.*child", "ped-neuro-disorders"],
    ["clubfoot|ctev|talipes|developmental dysplasia|ddh|barlow|ortolani|hip.*click.*neonat", "ped-newborn-care"],
    ["bronchiolitis|rsv|hyperinflation.*child|wheeze.*child|viral.*wheeze", "ped-respiratory-infections"],
    ["pneumonia.*child|consolidation.*child|empyema.*child", "ped-respiratory-infections"],
    ["tuberculosis.*child|primary complex|ghon.*child|scrofula|bovine tb.*child", "ped-respiratory-infections"],
    ["asthma.*child|cystic fibrosis|bronchiectasis.*child|foreign body.*aspirat.*child", "ped-chronic-respiratory"],
    ["coin.*esophagus|button batter|halo sign.*battery|ingested.*(coin|battery)", "ped-emergencies-poisoning"],
    ["wilms|nephroblastoma|neuroblastoma|retinoblastoma|leukocoria|rhabdomyosarcoma.*child|ewing.*child|osteosarcoma.*child", "ped-oncology"],
    ["leukemia.*child|lymphoblast.*child|lymphoma.*child|mediastinal mass.*child", "ped-oncology"],
    ["hemophilia|hemarthrosis|christmas disease.*child|von willebrand.*child|itp |immune thrombocytopen.*child|purpura.*child|aplastic.*child|fanconi.*child", "ped-haematology"],
    ["thalassemia|hair-on-end|chipmunk|crew-cut.*skull|beta.*thal.*child", "ped-haematology"],
    ["sickle|dactylitis|hand-foot syndrome|sickling.*child", "ped-haematology"],
    ["cataract.*congenital|rubella.*cataract|torch.*eye|retinopathy.*prematurity|rop ", "ped-neonatal-infections"],
    ["sepsis.*neonat|torch|congenital.*(syphilis|cmv|toxo|rubella|zika|parvo)|funisitis|early onset sepsis|late onset sepsis", "ped-neonatal-infections"],
    ["jaundice.*neonat|kernicterus|breast milk jaundice|physiologic.*jaundice|exchange transfusion.*neonat|phototherapy.*neonat", "ped-neonatal-jaundice"],
    ["cephalohematoma|caput succedaneum|subgaleal|forceps.*mark|vacuum.*mark|birth trauma|Erb|klumpke|facial palsy.*birth", "ped-newborn-care"],
    ["scalp hematoma|hematoma.*scalp|erythema toxicum|neonatal.*pustul|milia.*neonat|mongolian spot|cradle cap|vernix|lanugo|acne.*neonat", "ped-newborn-care"],
    ["preterm|low birth weight|lbw |kangaroo|incubator|small for gestational|intrauterine growth.*neonat", "ped-preterm-lbw"],
    ["seizure.*(child|neonat|infant)|epilepsy.*child|febrile seizure|infantile spasm|hypsarrhythmia|breath-holding.*seizure|neonatal.*(seizure|convulsion)", "ped-seizures"],
    ["hydrocephalus.*child|cerebral palsy|developmental delay.*neuro|neural tube defect|microcephaly|macrocephaly|neurocutaneous|tuberous sclerosis.*child|sturge-weber", "ped-neuro-disorders"],
    ["short stature|growth chart|failure to thrive|growth velocity|constitutional delay.*growth", "ped-growth"],
    ["milestone|developmental.*(milestone|screening)|autism|adhd|developmental quotient", "ped-development"],
    ["breath-holding.*behav|pica.*child|enuresis|encopresis|temper tantrum|thumb sucking|sleep.*behav.*child", "ped-behavioural"],
    ["breastfeeding|lactation|complementary feeding|weaning|formula.*infant|exclusive.*breast", "ped-infant-feeding"],
    ["immunisation schedule|ePI schedule|bcg scar|opv.*schedule|pentavalent|measles vaccine.*schedule|national.*immun.*child", "ped-national-schedule"],
    ["vaccine|coid chain|cold chain|adverse.*vaccin|aeFI|optional vaccine|influenza vaccine.*child|typhoid conjugate", "ped-vaccine-principles"],
    ["diarrhoea.*child|dehydration.*child|ors |rotavirus|cholera.*child|dysentery.*child|plan (a|b|c).*dehydration", "ped-diarrhoea"],
    ["biliary atresia|neonatal cholestasis|wilson.*child|autoimmune hepatitis.*child|portal hypertension.*child", "ped-hepatology"],
    ["nephritic.*child|hematuria.*child|psgn|iga.*child|rapidly progressive.*child", "ped-glomerular"],
    ["nephrotic.*child|anasarca.*child|proteinuria.*child|minimal change.*child", "ped-glomerular"],
    ["uti.*child|vesicoureteric|puj obstruction|posterior urethral valve|enuresis.*organic|undescended testis|cryptorchid", "ped-urinary-tract"],
    ["hypothyroid.*child|cretinism|goitre.*child|cushing.*child|congenital adrenal.*child|growth hormone.*deficien", "ped-thyroid-adrenal"],
    ["diabetes.*child|dka.*child|precocious puberty|delayed puberty|thelarche|menarche.*(early|late)|turner.*puberty", "ped-diabetes-puberty"],
    ["poisoning.*child|kerosene|drowning|burns.*child|anaphylaxis.*child|status (asthmaticus|epilepticus).*child|shock.*child|choking.*child", "ped-emergencies-poisoning"],
    ["fluid.*child|electrolyte.*child|abg.*child|metabolic acidosis.*child|dehydration.*fluid|hypotonic.*child", "ped-fluids-electrolytes"],
    ["agammaglobulinemia|scid|wiskott|job syndrome|juvenile.*arthritis|henoch.*child|lupus.*child|vasculitis.*child|periodic fever", "ped-immunology-rheumatology"],
    ["imnci|anganwadi|child protection|pocso|tracked.*growth|under-five clinic|bfhi|essential newborn.*programme", "ped-child-health-programmes"],
    ["pku|maple syrup|galactosemia|mucopolysaccharid|glycogen storage|tandem mass|newborn screening.*metabolic", "ped-inborn-errors"],
  ], "ped-childhood-infections");
  if (subject === "obstetrics-gynaecology") return route([
    ["molar|snowstorm|vesicle.*molar|theca lutein|choriocarcinoma|invasive mole|\\bgtd\\b|gestational trophoblastic|persistently.*hcg", "obg-gtd"],
    ["ectopic|adnexal.*pregnancy|tubal ring|tubal pregnancy|interstitial.*pregnancy|ruptured ectopic|salping", "obg-ectopic"],
    ["miscarriage|abortion|blighted ovum|inevitable|incomplete.*abortion|missed.*abortion|septic abortion|mtp |medical termination|recurrent.*loss", "obg-abortion"],
    ["placenta previa|painless.*bleeding.*third|low-lying placenta|placental.*previa", "obg-aph"],
    ["abruption|retroplacental|painful.*bleeding.*third|concealed.*hemorrhage|couvelaire uterus|dic.*abruption", "obg-aph"],
    ["twin|multiple pregnancy|lambda sign|t-sign|twin-twin|monochorionic|dichorionic|triplet|vanishing twin", "obg-multiple-pregnancy"],
    ["ctg|cardiotocograph|deceleration|fetal (bradycardia|tachycardia)|variability.*fetal|sinusoidal.*fetal|non-stress|non.*stress test|biophysical profile|doppler.*(umbilical|mca|ductus)|growth restriction|\\biugr\\b|\\bfgr\\b|hydrops", "obg-fetal-growth-surveillance"],
    ["amniotic fluid|oligohydramnios|polyhydramnios|\\bafi\\b|prom |prelabour rupture|leaking.*membranes|chorioamnionitis|amnioinfusion", "obg-amniotic-fluid"],
    ["preterm|cervical length|funneling|fetal fibronectin|tocolysis|post-term|postmaturity|postdate|macrosomia.*postterm", "obg-preterm-prom-postterm"],
    ["diabetes.*pregnancy|\\bgdm\\b|gct.*pregnancy|ogtt.*pregnancy|macrosomia|shoulder dystocia.*diabet", "obg-diabetes-pregnancy"],
    ["preeclampsia|eclampsia|hellp|gestational hypertension|proteinuria.*pregnancy|magnesium sulfate|imminent eclampsia|pulmonary edema.*preeclampsia", "obg-hypertensive-disorders"],
    ["anaemia.*pregnancy|hemoglobin.*pregnancy|ferritin.*pregnancy|anemia.*pregnancy", "obg-anaemia-pregnancy"],
    ["heart disease.*pregnancy|mitral.*pregnancy|eisenmenger.*pregnancy|cardiomyopathy.*pregnancy", "obg-heart-disease-pregnancy"],
    ["torch|rubella.*pregnancy|cmv.*pregnancy|toxoplasmosis.*pregnancy|uti.*pregnancy|asymptomatic bacteriuria|hepatitis.*pregnancy|hiv.*pregnancy|malaria.*pregnancy|parvovirus.*pregnancy|varicella.*pregnancy|group b strep|gbs.*pregnancy|listeria.*pregnancy", "obg-infections-pregnancy"],
    ["thyroid.*pregnancy|epilepsy.*pregnancy|asthma.*pregnancy|lupus.*pregnancy|itp.*pregnancy|cholestasis.*pregnancy|sickle.*pregnancy|renal.*pregnancy|appendicitis.*pregnancy", "obg-other-medical"],
    ["rh.*isoimmun|anti-d|kleihauer|hydrops.*immune|mca.*psv|middle cerebral.*peak|exchange.*rhesus", "obg-rh-isoimmunisation"],
    ["teratogen|thalidomide|warfarin.*pregnancy|valproate.*pregnancy|rubella vaccine|radiation.*pregnancy|folic acid.*prevention|category.*drug.*pregnancy|smoking.*pregnancy|alcohol.*pregnancy", "obg-teratogens"],
    ["nuchal|nasal bone.*fetus|double marker|triple test|quadruple|nipt|amniocentesis|cvs.*prenatal|anomaly scan|anencephaly|hydrocephalus.*fetus|hydronephrosis.*fetus|cystic hygroma|omphalocele.*fetus|first trimester screening|second trimester screening|soft marker", "obg-prenatal-screening"],
    ["antenatal|dating scan|booking.*pregnancy|fundal height|mcdonald|estimated.*delivery|naegele|anc visit", "obg-diagnosis-antenatal-care"],
    ["breech|face presentation|brow presentation|transverse lie|oblique lie|compound presentation|shoulder dystocia|cord prolapse|obstructed labour|rupture uterus|bandl|dystocia|malpresentation|contracted pelvis|\\bcpd\\b|deep transverse arrest", "obg-abnormal-labour"],
    ["conjugate|ischial spine|moulding|fetal skull|pelvic (inlet|outlet|cavity|brim)|diagonal conjugate|obstetric conjugate", "obg-pelvis-fetal-skull"],
    ["induction|augmentation.*labour|bishop|dinoprostone|stripping.*membranes|artificial rupture|oxytocin.*(induction|augmentation)", "obg-induction"],
    ["normal labour|vertex.*labour|occipito|cardinal movements|engagement.*head|labour.*(first|second) stage.*normal|crowning", "obg-normal-labour"],
    ["postpartum hemorrhage|\\bpph\\b|atonic uterus|retained placenta|placenta accreta|increta|percreta|inversion.*uterus|third stage|active management|balloon tamponade|b-lynch|uterine artery.*embol.*pph", "obg-pph"],
    ["puerperium|lochia|subinvolution|puerperal (pyrexia|sepsis)|mastitis|breast abscess|postpartum (depression|psychosis|thyroiditis|hemorrhage.*secondary)|lactational", "obg-puerperium"],
    ["forceps|ventouse|vacuum.*delivery|caesarean|lscs|episiotomy|version.*(external|internal)|destructive operation|craniotomy.*obstetric|symphysiotomy", "obg-operative-obstetrics"],
    ["maternal mortality|\\bmmr\\b|jsy|jssy|pmsma|laQshya|suman|safe motherhood|maternal near miss", "obg-maternal-health"],
    ["fibroid|leiomyoma|myoma.*uterine|submucous.*fibroid|red degeneration", "obg-fibroid"],
    ["endometriosis|adenomyosis|chocolate cyst|endometrioma", "obg-endometriosis-adenomyosis"],
    ["ovarian cyst|dermoid|rokitansky|corpus luteum cyst|hemorrhagic cyst|adnexal mass.*benign|serous cystadenoma|mucinous cystadenoma", "obg-benign-ovarian"],
    ["ovarian.*(malign|cancer|carcinoma)|krukenberg|ca-125.*malign", "obg-ovarian-cancer"],
    ["cervical.*(cancer|carcinoma)|\\bcin\\b|pap smear.*abnorm|bethesda|colposcopy|acetowhite|schiller|hpv.*cervi|visual inspection|vault.*cancer", "obg-cervical-cancer"],
    ["endometrial.*(cancer|hyperplasia|thickness)|postmenopausal bleeding|tamoxifen.*endometr", "obg-endometrial-cancer"],
    ["vulval|vaginal.*(cancer|lesion|discharge.*malign)|bartholin|lichen sclerosus|vain |vulval cancer", "obg-vulval-vaginal"],
    ["\\bpid\\b|pelvic inflammatory|genital tuberculosis|beaded tube|tobacco pouch|pyosalpinx|tubo-ovarian|fitz-hugh", "obg-pid-genital-tb"],
    ["chlamydia|gonorrhoea|genital (wart|herpes|ulcer)|chancroid|granuloma inguinale.*female|lgv.*female|trichomoniasis.*vaginal|bacterial vaginosis|clue cells|whiff|candidiasis.*vaginal", "obg-vaginitis-sti"],
    ["prolapse|cystocele|rectocele|enterocele|procidentia|incontinence.*(stress|urinary)|fistula.*(vesico|recto)|pessary|conservative.*prolapse", "obg-prolapse-urogynaecology"],
    ["abnormal uterine bleeding|\\baub\\b|menorrhagia|metrorrhagia|polymenorrhea|palm-coein|dysfunctional.*bleeding", "obg-aub"],
    ["pcos|polycystic ovar|hirsutism|stein-leventhal|ferriman|hyperandrogen", "obg-pcos-hirsutism"],
    ["amenorrhoea|asherman|sheehan|hyperprolactinemia|galactorrhea.*amenorr|premature ovarian|mayer-rokitansky", "obg-amenorrhoea"],
    ["infertility|seminal|azoospermia|hsg |tubal patency|ovulation induction|\\biui\\b|\\bivf\\b|\\bicsi\\b|ovarian reserve|amH ", "obg-infertility"],
    ["contracept|iucd|copper-t|\\bocp\\b|condom|sterilization|vasectomy|tubectomy|emergency.*contracept|mala-n|chhaya|antara|injectable.*contracept", "obg-contraception"],
    ["precocious puberty|delayed puberty|menopause|climacteric|hot flush|postmenopausal.*(bleeding|osteoporosis)|\\bhrt\\b|premature menopause|turner.*puberty", "obg-puberty-menopause"],
    ["menstrual cycle|follicular phase|luteal phase|ovulation|estrogen|progesterone|gnrh|lh surge|mittelschmerz", "obg-menstrual-physiology"],
    ["mullerian|uterine anomaly|bicornuate|septate uterus|vaginal atresia|imperforate hymen|female genital tract.*anatomy|broad ligament|uterine artery.*anatomy", "obg-anatomy-development"],
    ["placenta|fetal circulation|ductus (venosus|arteriosus)|foramen ovale|umbilical (artery|cord|vessels)|cord insertion|velamentous|vasa previa|succenturiate|circumvallate|amniotic band|wharton", "obg-placenta-fetus"],
    ["maternal physiolog|cardiac output.*pregnancy|gfr.*pregnancy|weight gain.*pregnancy|linea nigra|striae.*pregnancy|melasma.*pregnancy|physiologic.*(anemia|leukocytosis).*pregnancy", "obg-maternal-physiology"],
    ["hysteroscopy|laparoscopy.*gyn|dilatation.*curettage|hysterectomy|myomectomy|conization|leep|ultrasound.*(pelvic|gyn)|doppler.*pelvic|saline infusion|hysterosalping", "obg-gyn-procedures"],
  ], "obg-gyn-procedures");
  return `${subject}-general`;
}

async function main() {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("Usage: node tools/prep-imgqgen.mjs [--limit N] [--concurrency N] [--manifest F] [--out-passed F] [--out-review F] [--ledger F] [--gen-model M] [--verify-model M] [--profile default|ecg|eye] [--subjects a,b]");
    console.log("Writes image MCQs with blind verification by a second model. Resumable: skips ids already in out files. Limit 0 = all remaining.");
    return;
  }
  console.log("=== PrepNucleus Image MCQ Generator & Blind Verifier ===");
  const env = loadEnv();

  if (!fs.existsSync(MANIFEST_FILE)) {
    console.error("Clean manifest missing:", MANIFEST_FILE);
    process.exit(1);
  }

  const items = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
  console.log(`Loaded ${items.length} clean staged images.`);

  const doneIds = new Set();
  for (const f of [OUT_PASSED, OUT_REVIEW]) {
    if (fs.existsSync(f)) {
      for (const l of fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean)) {
        try {
          const row = JSON.parse(l);
          if (row.id) {
            doneIds.add(row.id);
            doneIds.add(row.id.replace(/^q_/, "i-"));
          }
          if (row.img && row.img[0]) {
            doneIds.add(row.img[0]);
            doneIds.add(row.img[0].replace(/\.webp$/, ""));
          }
        } catch {}
      }
    }
  }

  // Count passed items by subject so far
  const passedCounts = {};
  if (fs.existsSync(OUT_PASSED)) {
    for (const l of fs.readFileSync(OUT_PASSED, "utf8").trim().split("\n").filter(Boolean)) {
      try {
        const row = JSON.parse(l);
        const s = row.sid || row.subject || "other";
        passedCounts[s] = (passedCounts[s] || 0) + 1;
      } catch {}
    }
  }

  const todo = items.filter(it => !doneIds.has(it.id) && !doneIds.has(`q_${it.sha12}`) && !doneIds.has(it.neutralName));

  todo.sort((a, b) => {
    const aIsTarget = TARGET_SUBJECTS.includes(a.subject) ? 0 : 1;
    const bIsTarget = TARGET_SUBJECTS.includes(b.subject) ? 0 : 1;
    if (aIsTarget !== bIsTarget) return aIsTarget - bIsTarget;
    const ca = passedCounts[a.subject] || 0;
    const cb = passedCounts[b.subject] || 0;
    return ca - cb;
  });

  const work = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;
  console.log(`To generate & verify: ${work.length} items (concurrency: ${CONCURRENCY})`);

  let genTokensIn = 0, genTokensOut = 0;
  let verTokensIn = 0, verTokensOut = 0;
  let passCount = 0, reviewCount = 0;

  async function processOne(item) {
    if (!fs.existsSync(item.destPath)) return;
    const b64 = fs.readFileSync(item.destPath).toString("base64");

    const genPrompt = `Image Details:
Authoritative Diagnosis / Structure: ${item.authoritativeAnswer}
Subject: ${item.subject}
Caption: ${item.caption}
${item.brief ? `Required question angle: ${item.brief}\n` : ""}
Generate a rigorous Board-style single-best-answer MCQ where the correct answer matches the authoritative diagnosis above.`;

    try {
      // 1. Generate with the first-pass model
      const genSys = PROFILE === "ecg" ? ECG_GEN_SYSTEM_PROMPT : PROFILE === "eye" ? EYE_GEN_SYSTEM_PROMPT : GEN_SYSTEM_PROMPT;
      const genResp = await callClaude(env, GEN_MODEL, genSys, [
        { type: "image", source: { type: "base64", media_type: mediaType(item.destPath), data: b64 } },
        { type: "text", text: genPrompt }
      ], 4000);

      const genUsage = genResp.usage || {};
      genTokensIn += genUsage.input_tokens || 0;
      genTokensOut += genUsage.output_tokens || 0;

      const genTextBlock = (genResp.content || []).filter(b => b.type === "text").pop();
      const genText = genTextBlock ? genTextBlock.text : "{}";
      const mGen = genText.match(/\{[\s\S]*\}/);
      if (!mGen) {
        console.warn(`[Skip] No JSON found in gen response for ${item.id}`);
        return;
      }
      let qData;
      try {
        qData = JSON.parse(mGen[0]);
      } catch (e1) {
        try {
          const sanitized = mGen[0].replace(/[\x00-\x09\x0B-\x1F\x7F]/g, "");
          qData = JSON.parse(sanitized);
        } catch (e2) {
          console.warn(`[Skip] Could not parse JSON for ${item.id}:`, e2.message);
          return;
        }
      }

      // Sanitize fields against style gates
      qData.q = sanitizeText(qData.q);
      qData.o = (qData.o || []).map(sanitizeText);
      qData.exp = sanitizeText(qData.exp);
      qData.kp = sanitizeText(qData.kp);
      if (qData.r) qData.r = qData.r.map(sanitizeText);

      // Shuffle options so the key is uniformly distributed (the model
      // otherwise parks the answer at index 1); remap key, reasons, x.others.
      if (Array.isArray(qData.o) && qData.o.length === 4 && typeof qData.a === "number") {
        const order = [0, 1, 2, 3];
        for (let i = order.length - 1; i > 0; i--) {
          const j = crypto.randomInt(i + 1);
          [order[i], order[j]] = [order[j], order[i]];
        }
        const newO = order.map((k) => qData.o[k]);
        const newR = Array.isArray(qData.r) && qData.r.length === 4 ? order.map((k) => qData.r[k]) : qData.r;
        const letters = ["A", "B", "C", "D"];
        if (qData.x && qData.x.others && typeof qData.x.others === "object") {
          const newOthers = {};
          for (let ni = 0; ni < 4; ni++) {
            const oi = order[ni];
            if (oi !== qData.a && qData.x.others[letters[oi]] !== undefined) newOthers[letters[ni]] = qData.x.others[letters[oi]];
          }
          qData.x.others = newOthers;
        }
        qData.a = order.indexOf(qData.a);
        qData.o = newO;
        qData.r = newR;
      }

      // Validate basic shape
      if (!qData.q || !Array.isArray(qData.o) || qData.o.length !== 4 || typeof qData.a !== "number") {
        console.warn(`[Skip] Malformed question structure for ${item.id}`);
        return;
      }

      // 2. Blind verification with the second model
      const verPrompt = `Examine this medical image and answer the multiple-choice question:
Stem: ${qData.q}
Options:
A) ${qData.o[0]}
B) ${qData.o[1]}
C) ${qData.o[2]}
D) ${qData.o[3]}

Provide the single best answer index (0 for A, 1 for B, 2 for C, 3 for D) with your confidence and brief reasoning.`;

      const verResp = await callClaude(env, VERIFY_MODEL, VERIFY_SYSTEM_PROMPT, [
        { type: "image", source: { type: "base64", media_type: mediaType(item.destPath), data: b64 } },
        { type: "text", text: verPrompt }
      ], 1500);

      const verUsage = verResp.usage || {};
      verTokensIn += verUsage.input_tokens || 0;
      verTokensOut += verUsage.output_tokens || 0;

      const verTextBlock = (verResp.content || []).filter(b => b.type === "text").pop();
      const verText = verTextBlock ? verTextBlock.text : "{}";
      const mVer = verText.match(/\{[\s\S]*\}/);
      let verJson = {};
      if (mVer) {
        try { verJson = JSON.parse(mVer[0]); } catch {}
      }
      let blindPick = verJson.picked_option;
      if (typeof blindPick === "string") {
        if (/^[0-3]$/.test(blindPick.trim())) blindPick = parseInt(blindPick.trim(), 10);
        else if (/^[A-Da-d]$/.test(blindPick.trim())) blindPick = { a: 0, b: 1, c: 2, d: 3 }[blindPick.trim().toLowerCase()];
      }
      const agreed = blindPick === qData.a;

      const finalItem = {
        id: `q_${item.sha12}`,
        q: qData.q,
        o: qData.o,
        a: qData.a,
        exp: qData.exp,
        t: mapModuleId(item.subject, qData.t || item.subject, item.caption, item),
        d: qData.d || 2,
        r: qData.r || [],
        kp: qData.kp || "",
        cog: qData.cog || "reasoning",
        et: ["knowledge", null, "confused", "knowledge"],
        src: { maik: 1 },
        prov: "SMD",
        gen: "AI",
        ex: ["neet-pg", "ini-cet"],
        sid: item.subject,
        img: [item.neutralName],
        imgPlace: "stem",
        credit: item.author,
        licence: item.licence,
        licenceStandard: item.licenceStandard,
        licenseUrl: item.licenceUrl,
        sourceUrl: item.sourceUrl,
        title: item.title,
        x: qData.x || {},
        quality: {
          status: agreed ? "automated_checks_passed" : "held_for_review",
          gates: {
            blind_key: {
              model: VERIFY_MODEL,
              pick: blindPick,
              agree: agreed,
              confidence: verJson.confidence,
              reasoning: verJson.reasoning
            }
          }
        }
      };

      if (agreed) {
        fs.appendFileSync(OUT_PASSED, JSON.stringify(finalItem) + "\n");
        passCount++;
      } else {
        finalItem.reviewReason = `Blind verification disagreement: generator set ${qData.a} (${qData.o[qData.a]}), verifier picked ${blindPick} (${qData.o[blindPick] || "unknown"})`;
        fs.appendFileSync(OUT_REVIEW, JSON.stringify(finalItem) + "\n");
        reviewCount++;
      }

      console.log(`[QGen] ${item.id} -> ${agreed ? "PASS" : "HELD (Review)"} (${item.subject}) | Key: ${qData.a} | Blind: ${blindPick}`);
    } catch (e) {
      console.error(`Error generating for ${item.id}:`, e.message);
    }
  }

  let idx = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (idx < work.length) {
        const it = work[idx++];
        await processOne(it);
      }
    })
  );

  const costGen = (genTokensIn * PRICES[GEN_MODEL].in / 1e6) + (genTokensOut * PRICES[GEN_MODEL].out / 1e6);
  const costVer = (verTokensIn * PRICES[VERIFY_MODEL].in / 1e6) + (verTokensOut * PRICES[VERIFY_MODEL].out / 1e6);
  const totalCost = costGen + costVer;

  const short = (m) => String(m).replace(/^claude-/, "");
  logLedger(`qgen-image-${short(GEN_MODEL)}`, GEN_MODEL, { input_tokens: genTokensIn, output_tokens: genTokensOut }, costGen, `Generated ${work.length} items (profile ${PROFILE})`);
  logLedger(`verify-image-${short(VERIFY_MODEL)}`, VERIFY_MODEL, { input_tokens: verTokensIn, output_tokens: verTokensOut }, costVer, `Verified ${work.length} items (profile ${PROFILE})`);

  console.log("\n=== Generation & Verification Complete ===");
  console.log(`Passed: ${passCount} | Held for Review: ${reviewCount}`);
  console.log(`Total Spend: $${totalCost.toFixed(4)} (${GEN_MODEL}: $${costGen.toFixed(4)}, ${VERIFY_MODEL}: $${costVer.toFixed(4)})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  });
}
