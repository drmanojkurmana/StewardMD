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
  if (subject === "ent") return route([
    ["microtia|atresia.*ear|preauricular|bat ear|cauliflower ear|perichondritis|otitis externa|otomycosis|swimmer.*ear|aural polyp|wax | impacted cerumen|furuncle.*ear|malignant otitis", "ent-external-ear"],
    ["acute otitis|aom |bulging.*(drum|tympanic)|myringitis|bullous myringitis|otorrhea.*acute", "ent-aom-ome"],
    ["effusion|ome |retract|atelecta|air-fluid.*(ear|middle)|glue ear|grommet", "ent-aom-ome"],
    ["csom|chronic.*otitis|perforat.*(drum|tympanic|ear)|attic|cholesteatoma|tympanosclerosis|mastoidectomy cavity|ossiculoplast|myringoplast|radical mastoid", "ent-csom"],
    ["mastoiditis|petrositis|gradenigo|labyrinthitis|otogenic.*(abscess|meningitis|facial)|lateral sinus thromb|coalescent mastoid", "ent-om-complications"],
    ["otosclerosis|stapes fix|carhart|schwartze sign|stapedotomy", "ent-otosclerosis"],
    ["presbycusis|snhl|sensorineural|noise.*(notch|deaf)|ototoxic|meniere|endolymphatic|sudden.*hearing loss|labyrinthine concussion", "ent-snhl-inner-ear"],
    ["audiogram|audiometr|rinne|weber|tuning fork|abr |ber a|otoacoustic|pt a |pure tone|air-bone gap|carhart.*audio", "ent-hearing-tests"],
    ["caloric|dix-hallpike|epley|nystagmus|vertigo.*(test|positional)|vh it|electronystagmo|bppv.*test", "ent-vestibular-tests"],
    ["hearing aid|cochlear implant|bone anchored|baha|rehabilitat.*hear", "ent-hearing-rehab"],
    ["glomus|vestibular schwannoma|acoustic neuroma|ear.*(tumour|tumor|cancer|carcinoma)|external auditory.*(mass|tumour)", "ent-ear-tumours"],
    ["facial.*(palsy|paralysis|nerve)|bell.*palsy|ramsay hunt|house-brackmann", "ent-facial-nerve"],
    ["pinna|ossicle|eustachian|round window|oval window|cochlea.*anatomy|normal.*(drum|tympanic)|cone of light|pars (tensa|flaccida)", "ent-ear-anatomy"],
    ["cochlear physiolog|organ of corti|endolymph|perilymph|travelling wave|place theory|hair cell", "ent-ear-physiology"],
    ["turbinate|nasal (anatomy|conchae)|lateral wall.*nose|olfactory.*anatomy|choana", "ent-nose-anatomy"],
    ["dns |deviated.*septum|septal.*(hematoma|perforation|spur)|external nose.*(deform|fracture)|saddle nose|hump nose", "ent-septum-external-nose"],
    ["epistaxis|nosebleed|little.*area|kiesselbach|posterior.*nasal.*bleed|sphenopalatine.*bleed|nasal pack", "ent-epistaxis"],
    ["polyp.*(nose|nasal|antrochoanal)|rhinitis|allergic.*nose|samter|pale.*turbinate", "ent-rhinitis-polyps"],
    ["sinusitis|pns.*(haz|opac|mucosal)|waters view|maxillary.*sinus|frontal.*sinus.*(opac|haz)|osteit.*sinus", "ent-sinusitis"],
    ["inverted papilloma|sinonasal.*(tumour|tumor|mass|cancer)|esthesioneuroblastoma|nasal.*(malign|carcinoma|melanoma)", "ent-sinonasal-tumours"],
    ["fracture.*(nasal|zygoma|maxilla|orbit.*blowout|noe |mandible.*condyle)|blowout.*orbit|facial trauma", "ent-facial-trauma"],
    ["waldeyer|adenoid.*anatomy|tonsil.*(anatomy|crypts)|pharyngeal.*(recess|anatomy)", "ent-pharynx-anatomy"],
    ["tonsillitis|quinsy|peritonsillar|tonsillolith|adenoid.*(hypertrophy|facies)|sleep.*adenoid|tonsillectomy", "ent-tonsils-adenoids"],
    ["ludwig|retropharyngeal|parapharyngeal|neck space.*abscess|danger space", "ent-neck-spaces"],
    ["jna |juvenile.*angiofibroma|nasopharynx.*(mass|cancer|carcinoma)|npc |trotter", "ent-nasopharynx"],
    ["leukoplakia|oral.*(cancer|tumour|ulcer.*malign)|submucous fibrosis|hypopharyn.*cancer|pyriform.*growth", "ent-oral-hypopharynx-cancer"],
    ["dysphagia|plummer-vinson|web.*(esophag|cricopharyn)|cricopharyngeal|zenker|foreign body.*(throat|esophagus)|fish ?bone|coin.*esophag", "ent-dysphagia"],
    ["ranula|sialaden|parotid.*swell|salivary.*(stone|calculus|tumour)|wharton.*stone", "ent-salivary"],
    ["epiglottis.*anatomy|larynx.*(cartilage|anatomy)|vocal cord.*anatomy|cricoid|thyroid cartilage", "ent-larynx-anatomy"],
    ["stridor.*(child|infant|paed)|croup|epiglottitis.*child|laryngomalacia|subglottic.*(hemangioma|stenosis.*child)", "ent-stridor-paediatric"],
    ["vocal.*nodule|polyp.*cord|reinke|papilloma.*laryn|granuloma.*(cord|intubation)|contact ulcer.*cord", "ent-benign-larynx"],
    ["cord palsy|palsy.*cord|paramedian.*cord|recurrent laryngeal.*palsy|vocal.*immobil", "ent-vocal-cord-palsy"],
    ["glottic.*(cancer|carcinoma|tumour)|supraglottic.*cancer|transglottic|hoarseness.*malign|laryngectomy|hemilaryngectomy", "ent-laryngeal-cancer"],
    ["tracheostomy|tracheotomy|cricothyroid|airway.*(emergency|obstruct.*adult)|decannulation", "ent-airway"],
    ["neck.*(mass|lump|node.*neck|swelling)|branchial|thyroglossal|paraganglioma.*neck|carotid body", "ent-neck-masses"],
    ["snor|sleep apn(o|)ea|osa |uppp|cpap.*osa", "ent-sleep-apnoea"],
    ["mastoid.*(xray|x-ray|scleros)|ct.*(temporal|pns|neck)|mri.*neck|lateral.*neck.*(xray|film)|instrument.*ent|speculum.*ear", "ent-instruments-radiology"],
  ], "ent-ear-anatomy");
  if (subject === "forensic-medicine") return route([
    ["abrasion|graze|brush burn|scratch|imprint.*abrasion", "fmt-mechanical-injuries"],
    ["bruise|contusion|hematoma.*(pattern|black eye|periorbital)|ecchymosis", "fmt-mechanical-injuries"],
    ["lacerat|incis|stab |punctur|chop |slash|slash wound|cut throat|defen[cs]e wound|hesitation", "fmt-mechanical-injuries"],
    ["gunshot|bullet|rifl|tattooing.*(shot|powder)|stippling|contact wound|stellate.*(wound|entry)|exit wound|shotgun|pellet.*wound|wound.*(entry|firearm)", "fmt-firearm"],
    ["scalp.*(wound|hematoma)|skull fracture|head injury.*forensic|contrecoup", "fmt-regional-injuries"],
    ["burn |scald|splash.*burn|pugilistic|heat (fracture|rupture|hematoma)|electrocut|joule|arborescent|lightning.*burn|flash burn", "fmt-thermal"],
    ["hanging|ligature.*(mark|neck)|furrow.*neck|garrot|strangul|cord mark.*neck", "fmt-asphyxia"],
    ["throttl|manual strangul|nail.*(mark|abrasion).*neck|fingernail.*neck|hyoid.*fracture.*throttl", "fmt-asphyxia"],
    ["drown|washerwoman|bleach.*hand|froth.*(mouth|nostril)|diatom|weed.*hand.*drown", "fmt-drowning"],
    ["livid|livor|hypostasis|postmortem.*(stain|lividity)|rigor|algor mortis|pallor.*death", "fmt-early-changes"],
    ["marbl|mummif|adipocere|putrefact|maggot|purge fluid|bloat.*(body|putref)|saponif", "fmt-late-changes"],
    ["autopsy|postmortem examination|pm report|virchow|inquest.*autopsy", "fmt-autopsy"],
    ["dental.*(ident|record|age)|bite mark|tattoo.*ident|rugae|fingerprint.*ident|dactylograph|age.*(bone|teeth|suture)", "fmt-identification"],
    ["blood.*(spatter|group.*forensic|stain pattern)|hair.*forensic|fibre|seminal stain|saliva.*forensic", "fmt-trace-evidence"],
    ["infanticide|battered baby|shaken baby|starvation.*child", "fmt-infanticide"],
    ["datura|thornapple|oleander|kaner|nux vomica|strychnine|aconite|monkshood|castor|ricin|abrus|rati |calotropis|poppy|opium|cannabis|hemlock|belladonna|atropine.*plant|plant.*poison", "fmt-plant-animal"],
    ["snake ?bite|scorpion|krait|cobra|viper sting|animal.*(bite|venom)", "fmt-plant-animal"],
    ["acid burn|alkali burn|corrosive.*(burn|lip|mouth)|lead line|burtonian|arsenic.*(rain|hyperpigment)|mercury.*tremor", "fmt-corrosive-metallic"],
    ["organophosph|op poison|carbamate|paraquat|aluminium phosphide|celphos|pesticide", "fmt-agrochemical"],
    ["alcohol poison|methanol|barbiturate|benzodiazepine.*overdose|opioid.*overdose.*forensic|cyanide|strychnine.*convuls", "fmt-cns-poisons"],
    ["carbon monoxide|carboxyhemoglobin|cherry red.*co|hanging.*gas|sewer gas|h2s ", "fmt-asphyxiant-gases"],
    ["sexual|rape |sodomy|virgin|hymen|pregnan.*(forensic|conceal)|abortion.*(criminal|mtp.*forensic)", "fmt-sexual-offences"],
    ["consent.*medic|negligence|euthanasia|organ transplant.*law|mci |nmc |inquest|dying declaration|witness.*court", "fmt-legal-procedures"],
  ], "fmt-mechanical-injuries");
  if (subject === "ss-neurology") return route([
    ["mca|middle cerebral|insular ribbon|dense (mca|vessel)|acute.*(infarct|stroke).*ct|thrombolysis.*window|perfusion.*core|penumbra", "sne-acute-stroke-thrombolysis"],
    ["thrombectomy|clot retrieval|tici |large vessel occlusion|lvo ", "sne-mechanical-thrombectomy"],
    ["carotid.*(stenosis|doppler|endarterectomy|stenting)|nascet ", "sne-carotid-disease"],
    ["stroke.*(prevent|aspirin|statin|secondary)|abcd2 ", "sne-stroke-secondary-prevention"],
    ["ich |intracerebral.*h(ae)?morrhage|basal ganglia.*bleed|hypertensive.*bleed|hematoma.*brain", "sne-intracerebral-haemorrhage"],
    ["subarachnoid|sah |berry aneurysm|thunderclap.*ct|vasospasm", "sne-subarachnoid-haemorrhage"],
    ["subdural|crescent.*(brain|ct)|extradural|lens-shaped|chronic.*sdh|burr hole", "sne-neurotrauma"],
    ["venous.*(thrombosis|infarct)|cord sign|empty delta|cvt ", "sne-cerebral-venous-thrombosis"],
    ["moyamoya|puff of smoke|vasculitis.*(brain|vessel.*brain)|rcvs |young.*stroke", "sne-young-stroke-vasculopathies"],
    ["avm |arteriovenous malformation|cavernoma|popcorn.*lesion|dural fistula", "sne-vascular-malformations"],
    ["hydrocephalus|nph |evans index|transependymal|shunt.*(vp|brain)|coning|raised icp", "sne-raised-icp-neurocritical"],
    ["ms |multiple sclerosis|dawson|demyelin|plaque.*(brain|mri).*ms|optic neuritis.*ms|internuclear", "sne-multiple-sclerosis"],
    ["nmo |neuromyelitis|mogad|aquaporin|anti-mog|longitudinal.*myelitis.*nmo", "sne-nmosd-mogad"],
    ["adem |demyelination.*(child|postinfect)|clinically isolated", "sne-adem-other-demyelination"],
    ["ms.*(therap|ocrelizumab|natalizumab|fingolimod|dmt )", "sne-ms-therapy"],
    ["ring.?enhanc|tuberculoma.*brain|toxoplasma.*brain|abscess.*brain|cysticerc.*brain|neurocysticercosis|scolex", "sne-parasitic-infections"],
    ["meningitis|encephalitis|cerebritis|empyema.*subdural|ventriculitis", "sne-bacterial-meningitis"],
    ["tbm |tuberculous meningitis|basal.*exudate.*brain", "sne-tuberculous-meningitis"],
    ["hsv.*brain|temporal.*encephalitis|viral.*encephalitis.*mri", "sne-viral-encephalitis"],
    ["hiv.*(brain|toxoplasma|pml|neuro)|opportunistic.*brain", "sne-hiv-opportunistic-neuro"],
    ["cryptococc.*brain|fungal.*(brain|meningitis)|mucor.*brain", "sne-chronic-fungal-other-infections"],
    ["autoimmune.*encephalitis|anti-nmda|limbic.*encephalitis|lg i1|caspr2", "sne-autoimmune-encephalitis"],
    ["paraneoplastic.*(neuro|hu |yo )|lambert.*neuro", "sne-paraneoplastic-syndromes"],
    ["glioblastoma|butterfly.*glioma|astrocytoma|oligodendro|brainstem glioma", "sne-gliomas"],
    ["meningioma|dural tail|schwannoma|acoustic neuroma|pituitary.*(adenoma|mri)|craniopharyngioma|medulloblastoma|ependymoma|cns.*(tumour|tumor|lymphoma)", "sne-other-cns-tumours"],
    ["tuberous sclerosis|neurofibroma.*brain|sturge-weber|von hippel|neurocutaneous", "sne-neurocutaneous-syndromes"],
    ["myelitis|transverse myelitis|cord.*(signal|lesion|edema)|myelopath", "sne-myelopathies"],
    ["syrinx|syringomyelia|chiari |craniovertebral|basilar invagination|tethered cord", "sne-craniovertebral-syrinx-hydrocephalus"],
    ["als |motor neuron|mnd |frontotemporal.*motor|split hand.*als", "sne-motor-neuron-disease"],
    ["sma |spinal muscular atrophy|smn |floppy infant.*genetic", "sne-spinal-muscular-atrophy"],
    ["gbs |guillain|albuminocytologic|aidp |aman |miller fisher", "sne-guillain-barre"],
    ["cidp|immune.*neuropathy|ivig.*neuropathy|multifocal motor", "sne-cidp-immune-neuropathies"],
    ["cmt |charcot-marie|hereditary.*neuropathy|pes cavus.*neuro", "sne-hereditary-neuropathies"],
    ["neuropathy|stocking|glove.*neuro|foot drop|carpal.*neuro", "sne-acquired-neuropathies"],
    ["myasthenia|decrement.*rnst|ptosis.*fatig|edrophonium|achr ", "sne-myasthenia-gravis"],
    ["lems|lambert-eaton|increment.*rnst", "sne-lems-nmj-disorders"],
    ["duchenne|becker.*muscular|dystrophin|gower|calf.*pseudohypertrophy", "sne-muscular-dystrophies"],
    ["myositis.*(muscle|biopsy)|dermatomyositis.*muscle|inclusion body myositis", "sne-inflammatory-myopathies"],
    ["ragged red|mitochondrial.*myopathy|channelopath|periodic paralysis|mcardle|carnitine.*muscle", "sne-metabolic-myopathies-channelopathies"],
    ["eeg|epilepsy|seizure|hypsarrhythmia|spike.*eeg|status epilepticus", "sne-seizure-classification"],
    ["migraine|headache|trigeminal.*neuralgia|cluster.*headache|hemicrania", "sne-migraine"],
    ["i ih|idiopathic intracranial|papilledema|pseudotumor", "sne-idiopathic-intracranial-hypertension"],
    ["alzheimer|hippocampal.*atrophy|dementia.*mri|lewy|frontotemporal.*dementia|prion|cjd |rapidly progressive.*dementia", "sne-alzheimer-disease"],
    ["kf ring|kayser|wilson.*(brain|mri|panda)|panda.*wilson", "sne-neurology-systemic-disease"],
    ["csf |lumbar puncture|xanthochromia|oligoclonal", "sne-csf-analysis"],
    ["emg|nerve conduction|ncs ", "sne-nerve-conduction-emg"],
    ["vertigo|dix-hallpike|bppv |vestibular.*(neuritis|test)", "sne-vertigo-neuro-otology"],
    ["coma|brain death|gcs |decorticate|decerebrate", "sne-coma-brain-death"],
  ], "sne-neuroimaging");
  if (subject === "ss-nephrology") return route([
    ["crescent.*glomerul|rpgn|rapidly progressive.*(gn|kidney)|anti-gbm|goodpasture", "snp-rpgn-anca-vasculitis"],
    ["anca|granulomatosis.*kidney|microscopic polyangiitis.*kidney|pauci-immune", "snp-rpgn-anca-vasculitis"],
    ["minimal change|foot process|podocyte.*efface|selective proteinuria.*child", "snp-minimal-change-fsgs"],
    ["fsgs|focal segmental|tip lesion|collapsing.*glomerulo", "snp-minimal-change-fsgs"],
    ["membranous|spike.*(dome|bubbles)|pla2r ", "snp-membranous-nephropathy"],
    ["iga |mesangial.*iga|berger|synpharyngitic", "snp-iga-nephropathy"],
    ["psgn|post.*(strep|infectious).*gn|subepithelial humps|infection-related.*gn", "snp-infection-related-gn"],
    ["mpgn|tram.?track|dense deposit|c3 glomerulopathy|mesangiocapillary", "snp-mpgn-c3-glomerulopathy"],
    ["lupus nephritis|wire loop|full house.*kidney", "snp-lupus-nephritis"],
    ["myeloma.*kidney|cast nephropathy|light chain.*kidney|amyloid.*kidney|paraprotein", "snp-paraprotein-kidney"],
    ["diabetic.*(kidney|nephropathy|nodule)|kimmelstiel|g b m.*thicken.*diabet|microalbuminuria.*diabet", "snp-diabetic-kidney-disease"],
    ["tma |thrombotic microangiopathy|hus |ttp |onion skin.*kidney|schistocyte.*aki", "snp-thrombotic-microangiopathy"],
    ["interstitial nephritis|tubulitis|eosinophil.*kidney.*drug|analgesic.*kidney", "snp-interstitial-nephritis"],
    ["pkd|polycystic.*kidney|liver cyst.*pkd|berry aneurysm.*pkd", "snp-polycystic-kidney-disease"],
    ["alport|thin.*membrane.*kidney|hematuria.*deafness|lenticonus", "snp-alport-thin-membrane"],
    ["bartter|gitelman|liddle|tubulopath|renal tubular acidosis|rta ", "snp-tubulopathies"],
    ["stone|calculus.*(kidney|ureter)|kub |staghorn|nephrolithiasis|colic.*flank", "snp-nephrolithiasis"],
    ["hydronephrosis|hydroureter|obstruct.*(uropathy|kidney)|puj |posterior urethral valve", "snp-obstructive-uropathy"],
    ["uti |pyelonephritis|cystitis|nitrite.*urine|emphysematous.*pyelo", "snp-urinary-tract-infection"],
    ["atn |acute tubular|muddy brown|aki |acute kidney injury|rising creatinine|oliguria|contrast.*nephropathy", "snp-aki-evaluation"],
    ["nephrotoxic|aminoglycoside.*kidney|vancomycin.*aki|nsaid.*kidney", "snp-nephrotoxicity"],
    ["cardiorenal|hepatorenal|hrs |type 1 hrs", "snp-cardiorenal-hepatorenal"],
    ["dialysis.*aki|rrt |crrt |indication.*dialysis.*aki|refractory.*(hyperkalemia|acidosis|fluid)", "snp-kidney-replacement-aki"],
    ["proteinuria|hematuria.*glomerular|rbc cast|nephritic|glomerular.*approach", "snp-glomerular-approach"],
    ["nephrotic|anasarca|albumin.*low.*proteinuria|massive proteinuria", "snp-minimal-change-fsgs"],
    ["urinalysis|dipstick|sediment.*urine|dysmorphic.*rbc|cast.*urine", "snp-urinalysis-proteinuria"],
    ["gfr|creatinine.*(egfr|clearance)|cystatin|ckd-epi", "snp-gfr-biomarkers"],
    ["imaging.*kidney|usg kidney|ct.*kidney|renal biopsy|kidney.*(size|echogenicity)", "snp-kidney-imaging-biopsy"],
    ["sodium|hyponatremia|hypernatremia", "snp-sodium-water"],
    ["potassium|hyperkalemia|hypokalemia", "snp-potassium"],
    ["acidosis|alkalosis|anion gap|abg.*kidney", "snp-acid-base"],
    ["calcium|phosphate|magnesium.*kidney|ckd-mbd|secondary.*hyperparathyroid.*ckd", "snp-calcium-phosphate-magnesium"],
    ["diuretic|furosemide|thiazide.*kidney", "snp-diuretics"],
    ["ckd |chronic kidney|esrd|progression.*ckd|gfr.*low.*chronic", "snp-ckd-progression"],
    ["anaemia.*ckd|anemia.*ckd|epo |erythropoietin.*ckd", "snp-anaemia-ckd"],
    ["fistula|graft.*dialysis|vascular access|steal.*fistula|maturation.*fistula", "snp-vascular-access"],
    ["h(ae)?modialysis|hd adequacy|kt/v|disequilibrium|first-use.*dialyser", "snp-haemodialysis-principles"],
    ["capd|peritoneal dialysis|pd peritonitis|cloudy.*pd fluid|ultrafiltration failure.*pd", "snp-peritoneal-dialysis"],
    ["transplant.*(kidney|renal)|rejection.*kidney|tacrolimus|donor.*kidney|bk virus|polyomavirus.*kidney", "snp-transplant-immunology"],
    ["renal artery|renovascular|fibromuscular dysplasia.*renal|flash.*pulmonary edema.*renal", "snp-renovascular-disease"],
    ["crystal.*urine|oxalate|struvite|uric acid.*crystal|cystine.*crystal|envelope.*crystal|coffin.?lid", "snp-urinalysis-proteinuria"],
    ["edema.*(legs|nephrotic)|periorbital.*edema.*kidney", "snp-glomerular-approach"],
  ], "snp-kidney-imaging-biopsy");
  if (subject === "ss-pulmonology") return route([
    ["pft|spirometry|flow-volume|fvc |fev1|dlco|lung volumes", "spu-pft"],
    ["abg |blood gas|a-a gradient|hypoxemia|hypercapnia|respiratory.*(acidosis|alkalosis)", "spu-abg-physiology"],
    ["asthma|wheeze|reversible.*obstruct|methacholine", "spu-asthma"],
    ["copd|emphysema|chronic bronchitis|hyperinflation|flat diaphragm|bullae", "spu-copd"],
    ["bronchiectasis|tramline|signet ring|cylindrical.*bronchi", "spu-bronchiectasis"],
    ["abpa|allergic.*aspergillus|eosinophilic.*(lung|pneumonia)|churg|egpa.*lung", "spu-abpa-eosinophilic"],
    ["pneumonia|consolidation|air bronchogram|lobar.*pneumonia|bronchopneumonia", "spu-pneumonia"],
    ["tb |tuberculosis|miliary|cavitar.*(tb|tubercul)|tree-in-bud|ghon|caseat.*lung", "spu-tb"],
    ["ntm|atypical.*mycobact|fungal.*lung|aspergilloma|air crescent|mucor.*lung|pcp |pneumocystis", "spu-ntm-fungal"],
    ["ild |interstitial|honeycomb|uip |nsip|ground glass.*(chronic|fibros)|traction bronchiectasis", "spu-ild-approach"],
    ["ipf |usual interstitial|basal.*honeycomb|pirfenidone|nintedanib", "spu-ipf"],
    ["sarcoid|bilateral hilar|eggshell|perilymphatic|noncaseating.*lung", "spu-sarcoid"],
    ["silicos|asbestos|pneumoconiosis|occupational.*lung|coal worker|berylliosis|hypersensitivity pneumonitis", "spu-occupational"],
    ["embol|pe |hampton|westermark|filling defect.*pulmon|dvt.*pe|pruned.*pulmonary", "spu-pe"],
    ["pulmonary hypertension|pruned.*tree|right heart.*ph|vasoreactivity", "spu-ph"],
    ["vasculitis.*lung|gpa.*lung|dah |diffuse alveolar.*h(ae)?morrhage|hemoptysis.*vasculitis", "spu-dah-vasculitis"],
    ["effusion|pleural|meniscus.*pleura|empyema|thoracentesis|light criteria|chylothorax", "spu-pleural"],
    ["pneumothorax|pleural line|lung.*(point|sliding.*absent)|chest tube.*pneumothorax", "spu-pneumothorax"],
    ["mediastin|thymoma|lymphoma.*mediastin|anterior.*mediastinal.*mass|teratoma.*mediastin", "spu-mediastinum"],
    ["nodule.*lung|solitary.*nodule|lung (cancer|carcinoma|mass)|hilar mass|pancoast|mesothelioma|cannonball", "spu-nodule-lung-cancer"],
    ["ards|white.?out|bilateral.*opacit.*ards|pf ratio|prone.*ards", "spu-resp-failure"],
    ["sleep apn(o|)ea|osa |cpap|obesity.*hypoventilation|overlap.*copd.*osa", "spu-sleep-disorders"],
    ["neuromuscular.*resp|gbs.*resp|myasthenia.*resp|diaphragm.*(palsy|paralysis)", "spu-neuromuscular"],
    ["hemoptysis|cough.*(chronic|blood)|bronchitis.*chronic", "spu-haemoptysis-cough"],
    ["bronchoscop|ebus|thoracoscop|pleuroscopy|endobronchial", "spu-imaging-bronchoscopy"],
    ["lung abscess|hydatid.*lung|water lily|echinococcal.*lung", "spu-pneumonia"],
    ["clubbing|hypertrophic osteoarthropathy", "spu-systemic"],
    ["transplant.*lung|rehab.*pulmonary|oxygen.*long.?term.*copd", "spu-transplant-rehab"],
    ["tobacco|smoking.*cessation|biomass.*lung|vaping.*lung", "spu-tobacco-environmental"],
  ], "spu-imaging-bronchoscopy");
  if (subject === "ss-gastroenterology") return route([
    ["barrett|salmon.*esophag|intestinal metaplasia.*esophag", "sgi-gerd-barrett"],
    ["gerd|reflux.*esophagitis|los angeles.*esophagitis", "sgi-gerd-barrett"],
    ["achalasia|bird beak|rosette.*(gej|esophag)|high.*les pressure.*achalasia|pneumatic dilat.*achalasia", "sgi-oesophageal-motility"],
    ["des |diffuse.*spasm|corkscrew|nutcracker|jackhammer.*esophag|ineffective.*motility", "sgi-oesophageal-motility"],
    ["candida.*esophag|thrush.*esophag|eosinophilic.*esophag|rings.*eoe|furrows.*esophag|pill.*esophagitis", "sgi-eosinophilic-infectious-oesophagitis"],
    ["esophageal.*(cancer|carcinoma|tumour|mass)|scc.*esophag|adenocarcinoma.*esophag", "sgi-oesophageal-cancer"],
    ["h pylori|hpylori|nodular gastritis|peptic ulcer|duodenal ulcer|gastric ulcer", "sgi-hpylori-peptic-ulcer"],
    ["gastric.*(cancer|carcinoma|gist|linitis|maltoma)|linitis plastica", "sgi-gastric-neoplasms"],
    ["gastroparesis|dyspepsia|functional.*dyspepsia| Rome iv.*dyspepsia", "sgi-gastroparesis-dyspepsia"],
    ["varic.*(esophag|gastric|bleed)|upper.*gi.*bleed|melena.*varic|band ligation.*varic", "sgi-upper-gi-bleeding"],
    ["lower.*gi.*bleed|hematochezia|small bowel.*bleed|capsule.*bleed|obscure.*bleed", "sgi-lower-small-bowel-bleeding"],
    ["celiac|scallop.*duoden|villous atrophy|tTG |malabsorption|steatorrhea", "sgi-malabsorption-coeliac"],
    ["sibo|tropical sprue|blind loop|breath test.*sibo", "sgi-sibo-tropical-sprue"],
    ["mesenteric ischemia|ischemic.*(bowel|colitis)|thumbprint.*colon", "sgi-small-bowel-ischaemia-tumours"],
    ["ulcerative colitis|friab.*colon|pseudopolyp|lead pipe|toxic megacolon.*uc", "sgi-ulcerative-colitis"],
    ["crohn|cobblestone|aphth.*crohn|string sign|skip lesion|fistula.*crohn|creeping fat", "sgi-crohn-disease"],
    ["biologic.*ibd|vedolizumab|ustekinumab|tofacitinib.*uc|ibd.*therap", "sgi-ibd-therapeutics"],
    ["intestinal.*tuberculosis|ileocecal.*tb|tuberculous.*(colitis|abdomen)", "sgi-intestinal-tuberculosis"],
    ["polyp.*(colon|adenoma|hyperplastic)|adenoma.*colon|colorectal.*(cancer|carcinoma|neoplasia)|apple core|hereditary.*polyposis", "sgi-colorectal-neoplasia"],
    ["ibs |constipation| Rome iv.*ibs|dyssynergic", "sgi-ibs-constipation"],
    ["c diff|clostridioides|pseudomembrane.*colon|infectious.*diarrh(o|)ea|cholera.*colon", "sgi-infectious-diarrhoea-cdi"],
    ["microscopic colitis|collagenous|lymphocytic.*colitis|anorectal|hemorrhoid.*image", "sgi-microscopic-colitis-anorectal"],
    ["pancreatitis|amylase|lipase|stranding.*pancreas|necrosis.*pancreas", "sgi-acute-pancreatitis"],
    ["chronic pancreatitis|calcific.*pancreas|pseudocyst|walled-off.*pancreas", "sgi-chronic-pancreatitis"],
    ["pancreatic.*(cancer|adenocarcinoma|net|ipmn|mcn)|double duct", "sgi-pancreatic-neoplasms"],
    ["gallstone|cholecystitis|cholangitis|choledocholithiasis|mirizzi|gallbladder.*(wall|shadowing)", "sgi-biliary-disease"],
    ["ercp|sphincterotomy|colonoscopy.*(screen|polypectomy|technique)|peg |enteroscopy", "sgi-endoscopy-procedures"],
    ["carcinoid.*gi|neuroendocrine.*gi|gastroparesis.*diabet", "sgi-gi-neuroendocrine-systemic"],
  ], "sgi-endoscopy-procedures");
  if (subject === "ss-hepatology") return route([
    ["lft|transaminitis|alt |ast |alp |bilirubin.*(direct|indirect)|ggt ", "shp-liver-function-tests"],
    ["usg.*liver|ultrasound.*liver|bright liver|coarse.*liver|nodular.*liver.*usg|elastograph|fibroscan|liver biopsy", "shp-liver-imaging-biopsy"],
    ["hav |hepatitis a|hev |hepatitis e.*adult|acute.*hepatitis.*viral", "shp-hav-hev"],
    ["hepatitis b|hbv |surface antigen|e antigen|precore|occult.*hbv", "shp-hepatitis-b"],
    ["hepatitis c|hcv |daa |sustained.*virologic", "shp-hepatitis-c"],
    ["hdv|delta.*hepatitis|hepatitis d", "shp-hdv-other-viruses"],
    ["alcohol.*liver|alcoholic.*(hepatitis|steatohepatitis)|maddrey|mallory.*alcohol|lille ", "shp-alcohol-related-liver-disease"],
    ["masld|nafld|fatty liver|nash|steatosis.*metabolic|fib-4 ", "shp-masld"],
    ["wilson|kf ring|atp7b|penicillamine.*wilson|panda.*wilson", "shp-wilson-disease"],
    ["hemochromatosis|iron overload.*liver|ferritin.*high.*liver|hfe ", "shp-haemochromatosis-genetic"],
    ["autoimmune hepatitis|aih |interface hepatitis|piecemeal necrosis|ana.*liver|sma.*liver", "shp-autoimmune-hepatitis"],
    ["pbc|primary biliary|ama |cholestasis.*pbc|pruritus.*pbc", "shp-primary-biliary-cholangitis"],
    ["psc|primary sclerosing|bead.*mrcp|cholangiopath|dominant stricture.*psc", "shp-psc-cholangiopathies"],
    ["dili|drug-induced.*liver|herbal.*liver|hy law|atorvastatin.*liver|anti-tb.*liver", "shp-drug-induced-liver-injury"],
    ["acute liver failure|alf |fulminant.*hepatic|king.*college.*alf|paracetamol.*alf", "shp-acute-liver-failure"],
    ["aclf|acute-on-chronic|clif-", "shp-aclf"],
    ["ascites|ascitic|sbp |spontaneous.*peritonitis|hrs |hepatorenal|cell count.*ascitic|morrison.*pouch.*fluid", "shp-ascites-sbp-hrs"],
    ["portal hypertension|varic.*(portal|bleed)|splenomegaly.*portal|saag |hvpg ", "shp-portal-hypertension-varices"],
    ["encephalopathy|asterixis|ammonia|west haven|lactulose|rifaximin", "shp-hepatic-encephalopathy"],
    ["hepatopulmonary|portopulmonary|platypnea|bubble.*echo.*liver", "shp-hepatopulmonary-cardiac"],
    ["meld |child.?pugh|prognosis.*cirrhosis|decompensat.*cirrhosis|acl f.*prognosis", "shp-cirrhosis-prognosis-care"],
    ["budd.?chiari|portal vein thrombosis|pvt |veno-occlusive.*liver|sos ", "shp-vascular-liver-disorders"],
    ["liver abscess|amoebic.*liver|hydatid.*liver|pyogenic.*liver abscess", "shp-liver-infections"],
    ["hcc|hepatocellular|washout.*liver|arterial.*enhance.*liver|li-rads|afp ", "shp-hepatocellular-carcinoma"],
    ["cholangiocarcinoma|klatskin|hemangioma.*liver|fnh |adenoma.*liver|benign.*lesion.*liver", "shp-biliary-tumours-benign-lesions"],
    ["liver transplant|milan |post.?transplant.*liver|rejection.*liver", "shp-liver-transplantation"],
    ["hellp|aflp|pregnancy.*liver|intrahepatic cholestasis.*pregnancy", "shp-liver-in-pregnancy"],
    ["palmar erythema|spider.*(nevi|angioma)|caput medusae|gynecomastia.*liver|dupuytren.*liver", "shp-cirrhosis-prognosis-care"],
    ["steatohepatitis|ballooning.*liver|bridging fibrosis|bile plug.*liver|granuloma.*liver", "shp-liver-imaging-biopsy"],
  ], "shp-liver-imaging-biopsy");
  if (subject === "ss-endocrinology") return route([
    ["acromegaly|gh excess|prognathism|spade.*hand.*acromegaly|ogtt.*gh |pegvisomant", "sen-acromegaly"],
    ["cushing|striae.*(purple|cushing)|buffalo hump|moon facies|dexamethasone.*suppress|ectopic acth", "sen-cushing-syndrome"],
    ["addison|adrenal insufficiency|hyperpigment.*(addison|knuckle|buccal)|salt craving|adrenal crisis|synacthen", "sen-adrenal-insufficiency"],
    ["aldosterone|conn |adrenal.*(adenoma.*aldo|hyperplasia.*aldo)|arr ", "sen-primary-aldosteronism"],
    ["pheo|paraganglioma|men 2.*pheo|metanephrine", "sen-pheochromocytoma"],
    ["cah |congenital adrenal|21-hydroxylase|ambiguous genitalia.*cah", "sen-congenital-adrenal-hyperplasia"],
    ["incidentaloma|adrenal.*(mass|nodule|carcinoma).*incidental", "sen-adrenal-incidentaloma-carcinoma"],
    ["prolactinoma|galactorrhea|hyperprolactin|cabergoline", "sen-prolactinoma"],
    ["hypopituitarism|panhypopit|sheehan|apoplexy.*pituitary|empty sella", "sen-hypopituitarism"],
    ["pituitary.*(mass|mri|macroadenoma|microadenoma)|bitemporal.*pituitary", "sen-pituitary-masses"],
    ["diabetes insipidus|di |polyuria.*di|desmopressin|water deprivation", "sen-diabetes-insipidus"],
    ["siadh|hyponatr(ae)?mia.*siadh|fluid restrict.*siadh|tolvaptan", "sen-siadh-hyponatraemia"],
    ["hypothyroid|hashimoto|myxoedema|raised tsh|thyroxine.*dose", "sen-hypothyroidism"],
    ["thyrotoxicosis|graves|hyperthyroid|storm.*thyroid|carbimazole|radioiodine.*graves", "sen-thyrotoxicosis"],
    ["thyroiditis|subacute.*thyroid|painless.*thyroiditis|de quervain.*thyroid", "sen-thyroiditis"],
    ["nodule.*thyroid|goitre|goiter|tirads|bethesda.*thyroid|fnac.*thyroid|mng ", "sen-thyroid-nodules-cancer"],
    ["thyroid.*(cancer|carcinoma|papillary|medullary|anaplastic)|calcitonin", "sen-thyroid-nodules-cancer"],
    ["thyroid.*pregnancy|trimester.*tsh|propylthiouracil.*pregnancy", "sen-thyroid-pregnancy"],
    ["ophthalmopathy|proptosis|pretibial|acropachy.*thyroid|teprotumumab", "sen-thyroid-eye-disease"],
    ["hypercalcemia|hypercalcaemia|parathyroid.*(adenoma|hyperplasia)|mibi |cinacalcet", "sen-hyperparathyroidism-hypercalcaemia"],
    ["hypocalcemia|hypocalcaemia|chvostek|trousseau|hypoparathyroid|pseudohypoparathyroid", "sen-hypocalcaemia-hypoparathyroidism"],
    ["vitamin d|rickets|osteomalacia|cholecalciferol", "sen-vitamin-d-rickets"],
    ["osteoporosis|dexa|fragility fracture|bisphosphonate|denosumab", "sen-osteoporosis"],
    ["t1dm|type 1.*diabet|dka |ketoacidosis|insulin.*(pump|basal-bolus|t1dm)", "sen-type1-insulin-technology"],
    ["t2dm|type 2.*diabet|metformin|sglt2|glp-1|hba1c ", "sen-type2-pharmacotherapy"],
    ["diabetic.*(emergency|hypo|hyperosmolar)|hos |lactic acidosis.*metformin", "sen-diabetic-emergencies"],
    ["hypoglycem|whipple.*triad|insulinoma|sulfonylurea.*hypo", "sen-hypoglycaemia"],
    ["retinopathy.*diabet|nephropathy.*diabet|neuropathy.*diabet|charcot.*diabet|diabetic foot", "sen-diabetic-complications"],
    ["gdm|diabetes.*pregnancy|pregestational.*diabet", "sen-diabetes-pregnancy"],
    ["mody|lada |monogenic.*diabet|neonatal.*diabet", "sen-monogenic-diabetes"],
    ["obes|bmi.*high|bariatric|orlistat|weight.*(drug|pharma)", "sen-obesity"],
    ["dyslipid|xanthoma|xanthelasma|statin|hypertriglycerid|fh |familial hyperchol", "sen-dyslipidaemia"],
    ["hypogonad|klinefelter|testosterone.*low|erectile.*endocrine", "sen-male-hypogonadism"],
    ["pcos|hirsutism|amenorrh(o|)ea.*endo|pof |premature ovarian", "sen-female-reproductive"],
    ["puberty.*(precocious|delayed)|thelarche|menarche.*(early|late)", "sen-puberty-disorders"],
    ["turner|noonan|dsd |disorders.*sex development", "sen-disorders-sex-development"],
    ["short stature|growth hormone.*deficien|gh stimulation|tall stature", "sen-growth-disorders"],
    ["men 1|men1|men 2|sipple|wermer|gastrinoma.*men|parathyroid.*men", "sen-men-syndromes"],
    ["neuroendocrine.*(tumour|tumor|gep)|carcinoid|vipoma|glucagonoma|somatostatinoma", "sen-gep-neuroendocrine-tumours"],
    ["polyglandular|aps 1|aps 2|schmidt|immunotherapy.*endocrine.*irae", "sen-polyglandular-immunotherapy"],
    ["tft|thyroid.*(test|function)|tsh |ft4 |anti-tpo", "sen-thyroid-physiology-tests"],
  ], "sen-endocrine-testing");
  if (subject === "ss-haematology") return route([
    ["iron deficien|microcy|pencil cell|koilony|ferritin.*low|anemia.*chronic.*disease", "shm-iron-deficiency-chronic-disease"],
    ["b12|folate|megaloblast|hypersegment|macro-ovalocyte|pernicious", "shm-megaloblastic-anaemia"],
    ["spherocyt|autoimmune hemolytic|coombs.*positive|warm.*agglutinin|cold agglutinin|pnh |paroxysmal nocturnal", "shm-acquired-haemolytic-anaemia"],
    ["sickle|drepanocyte|thalassemia|target cell|hb bart|hb ?h |g6pd|bite cell|heinz|pyruvate kinase|membrane.*(ellipto|spherocytosis.*hereditary)", "shm-hereditary-haemolytic-anaemia"],
    ["thalassaemia|thalassemia|hair-on-end|chipmunk|crew cut.*skull|beta.*thal", "shm-thalassaemia"],
    ["sickle cell|hb ss|dactylitis|sickling|acute chest.*sickle", "shm-sickle-cell-disease"],
    ["aplastic|pancytopenia|fanconi|diamond-blackfan|pure red cell|pnh.*marrow", "shm-marrow-failure-pnh"],
    ["auer|myeloblast|acute myeloid|aml |promyelocyt.*aml|t(8;21)|inv(16)", "shm-acute-myeloid-leukaemia"],
    ["mds |myelodysplas|ring sideroblast|5q-|del(5q)|blast.*mds", "shm-myelodysplastic-syndromes"],
    ["cml|philadelphia|bcr-abl|blast crisis.*cml|leukostasis", "shm-chronic-myeloid-leukaemia"],
    ["jak2|polycythemia vera|myelofibrosis|teardrop|essential thrombocythemia|calr |mpl ", "shm-myeloproliferative-neoplasms"],
    ["lymphoblast|acute lymphoblastic|all |t(12;21)|philadelphia.*all", "shm-acute-lymphoblastic-leukaemia"],
    ["cll|smudge|small lymphocytic|del(17p).*cll|ibrutinib.*cll", "shm-chronic-lymphocytic-leukaemia"],
    ["hodgkin|reed.?sternberg|nodular scleros.*hodgkin|abvd|brentuximab", "shm-hodgkin-lymphoma"],
    ["burkitt|starry sky|diffuse large b|follicular lymphoma|mantle cell|maltoma|dlbcl|mycosis fungoides.*blood|sezary", "shm-non-hodgkin-lymphoma"],
    ["myeloma|bence jones|plasmacyt|rouleaux|mgus|waldenstrom|punched-out.*myeloma", "shm-plasma-cell-disorders"],
    ["platelet|itp |ttp |hus |glanzmann|bernard-soulier|thrombocytopen|purpura.*platelet", "shm-platelet-disorders"],
    ["schistocyte|microangiopath|dic |disseminated intravascular|tma.*blood|hus.*blood", "shm-thrombotic-microangiopathies"],
    ["hemophilia|haemophilia|christmas disease|von willebrand|hemarthrosis|factor (viii|ix|xi)", "shm-inherited-bleeding-disorders"],
    ["anticoag|warfarin|heparin|doac|thrombophilia|factor v leiden|protein (c|s).*deficien|antithrombin", "shm-thrombophilia-anticoagulation"],
    ["liver.*coagulopath|vitamin k.*bleed|dIC.*acquired|uremic.*bleed", "shm-acquired-coagulopathies"],
    ["transfusion|blood group|crossmatch|trali|taco.*transfusion|hemolytic.*transfusion reaction", "shm-transfusion-medicine"],
    ["hsct|stem cell transplant|graft-vs-host|gvhd|engraftment", "shm-stem-cell-transplant-cellular-therapy"],
    ["reticulocyte|ldh.*hemolysis|haptoglobin|bilirubin.*hemolysis|blood film.*general", "shm-haematopoiesis-lab"],
    ["hairy cell|braf.*hairy|cladribine", "shm-non-hodgkin-lymphoma"],
    ["gaucher|niemann-pick|storage.*marrow|crinkled.*marrow", "shm-haematopoiesis-lab"],
    ["splenomegaly|hypersplenism|howell-jolly|siderotic.*granule", "shm-haematopoiesis-lab"],
  ], "shm-haematopoiesis-lab");
  if (subject === "ss-medical-oncology") return route([
    ["melanoma|breslow|sentinel.*melanoma|braf.*melanoma", "son-melanoma"],
    ["bcc |basal cell|scc.*skin|squamous cell.*skin|keratoacanthoma|actinic.*onc", "son-nmsc"],
    ["kaposi|hhv-8|aids.*kaposi", "son-hiv-malignancy"],
    ["mycosis fungoides|sezary.*skin|ctcl|patches.*fungoides", "son-tcell"],
    ["breast.*(peau|paget|nipple.*eczema)|inflammatory.*breast", "son-breast-early-hr"],
    ["hodgkin.*node|lymphoma.*(node|cervical.*node)|dlbcl.*node|burkitt.*(jaw|abdominal)", "son-nhl-aggressive"],
    ["cll.*node|follicular.*node|indolent.*lymphoma.*node|malt.*node", "son-nhl-indolent"],
    ["myeloma.*(bone|skull|punched)|plasmacytoma.*bone|mgus.*bone", "son-myeloma"],
    ["aml.*blood|apl |promyelocytic|all.*blood|blast.*leukemia.*blood|cml.*blood|cll.*blood", "son-aml"],
    ["clubbing|hoa |hypertrophic osteoarthropathy.*lung|paraneoplastic.*clubbing", "son-paraneoplastic"],
    ["brain met|mets.*brain|cerebral met|whole brain.*rt.*mets", "son-brain-mets"],
    ["bone met|lytic.*(bone|met)|sclerotic.*met|spine.*met|denosumab.*bone met", "son-bone-mets"],
    ["svcs|superior vena cava.*syndrome|facial.*swelling.*svcs|collateral.*svcs", "son-emergencies"],
    ["cord compression|cauda equina.*mets|mets.*spine.*compress", "son-emergencies"],
    ["hypercalcemia.*malign|tumour lysis|tls |rasburicase|neutropenic.*(sepsis|fever)|febrile neutropenia", "son-emergencies"],
    ["effusion.*malign|pleural.*mets|ascites.*malign|pericardial.*mets", "son-effusions-nutrition"],
    ["mucositis|extravasation|chemo.*skin|hand-foot.*capecitabine|radiation.*dermatitis", "son-mucositis-skin"],
    ["neutropenia.*(nadir|g-csf)|anemia.*chemo|thrombocytopenia.*chemo|myelosuppress", "son-myelosuppression"],
    ["nausea.*chemo|emetogenic|cinv |aprepitant", "son-cinv"],
    ["cardiotox.*(anthracycline|trastuzumab)|nephrotox.*cisplatin|neuropathy.*(taxane|vincristine|oxaliplatin)|ototox.*cisplatin", "son-organ-tox"],
    ["colitis.*(ipi|nivo|pembro)|pneumonitis.*(ici|nivo)|thyroiditis.*ici|irae ", "son-irae"],
    ["nsclc|lung.*(adeno|squamous).*onc|egfr.*lung|alk.*lung|pancoast.*onc", "son-nsclc-driver"],
    ["sclc|small cell.*lung.*onc|limited.*sclc|prophylactic cranial", "son-sclc"],
    ["mesothelioma|thymoma|thymic.*onc", "son-mesothelioma-thymic"],
    ["colorectal.*onc|crc |hereditary.*crc.*onc|lynch.*onc", "son-crc-early"],
    ["pancreas.*onc|whipple.*onc|hcc.*onc|sorafenib|cholangiocarcinoma.*onc", "son-pancreas"],
    ["prostate.*onc|psa |gleason|bladder.*onc|cystectomy|kidney.*(rcc|onc)|testis.*onc|orchidectomy", "son-prostate-local"],
    ["ovary.*onc|ca-125|cervix.*onc|hpv.*cervix.*onc|endometr.*onc", "son-ovary"],
    ["sarcoma|gist|gist.*imatinib|ewing.*onc|osteosarcoma.*onc", "son-sarcoma"],
    ["hereditary.*(brca|lynch|fap)|li-fraumeni|genetic.*onc|cup |unknown primary", "son-hereditary"],
    ["her2|er |pr |triple negative|tnbc ", "son-breast-her2"],
    ["hodgkin.*(abvd|beacopp)|hsct.*lymphoma|car-t|car t ", "son-hodgkin"],
    ["palliative|pain.*onc|opioid.*onc|hospice|performance status", "son-pain-palliative"],
    ["thrombosis.*cancer|trousseau|khorana", "son-thrombosis"],
  ], "son-staging-response");
  if (subject === "ss-rheumatology-immunology") return route([
    ["ra |rheumatoid.*(hand|arthritis|erosion|nodule)|ulnar drift|swan neck|boutonniere|anti-ccp", "srh-ra-management"],
    ["atlantoaxial.*ra|felty|rheumatoid.*(lung|vasculitis|eye)|extraarticular.*ra", "srh-ra-extraarticular"],
    ["methotrexate.*ra|csdmard|leflunomide|sulfasalazine.*ra", "srh-csdmards"],
    ["tnf.*(ra|blocker)|rituximab.*ra|abatacept|jak.*(ra|tofacitinib)|biologic.*ra", "srh-biologics"],
    ["jia |juvenile.*arthritis|still.*disease|periodic fever.*child", "srh-jia"],
    ["ankylosing|bamboo|sacroiliitis|axspa|hla-b27.*axial", "srh-axspa"],
    ["secukinumab.*axspa|axspa.*treatment|nsaid.*axspa", "srh-axspa-treatment"],
    ["psoriatic|psa |sausage digit|pencil-in-cup|caspar|nail.*psoriasis.*arthritis", "srh-psa"],
    ["reactive arthritis|reiter|post.*(chlamydia|dysentery).*arthritis|circinate", "srh-reactive-arthritis"],
    ["ibd.*arthritis|enteropathic", "srh-enteropathic"],
    ["gout|tophi|topus|podagra|urate|monosodium.*urate|needles.*gout", "srh-gout"],
    ["cppd|pseudogout|chondrocalcinosis|rhomboid.*crystal|positively birefringent", "srh-cppd"],
    ["osteoarthritis|heberden|bouchard|oa knee|joint space.*oa", "srh-osteoarthritis"],
    ["osteoporosis.*rheum|fragility.*rheum|steroid.*bone|avascular necrosis.*steroid|osteonecrosis", "srh-osteonecrosis"],
    ["sle |lupus|malar|discoid.*lupus|ana.*lupus|anti-dsdna|lupus.*(rash|serositis|cytopenia)", "srh-sle-organ"],
    ["lupus nephritis|proteinuria.*lupus|class.*lupus.*nephritis", "srh-lupus-nephritis"],
    ["hydroxychloroquine.*sle|sle.*management|belimumab|lupus.*(treat|therapy)", "srh-sle-management"],
    ["drug-induced lupus|procainamide.*lupus|hydralazine.*lupus|anti-histone", "srh-drug-induced-lupus"],
    ["aps |antiphospholipid|hughes|triple positive.*aps|catastrophic.*aps", "srh-aps"],
    ["sjogren|sicca|schirmer|anti-(ro|la)|parotid.*sjogren", "srh-sjogren"],
    ["scleroderma|systemic sclerosis|ssc |salt.*pepper.*ssc|tapered.*fingers.*ssc|raynaud.*ssc", "srh-ssc"],
    ["pah.*ssc|ild.*ssc|renal crisis.*ssc|digital ulcer.*ssc", "srh-ssc-organ"],
    ["raynaud|triphasic.*raynaud|nifedipine.*raynaud", "srh-raynaud"],
    ["myositis|gottron|heliotrope|anti-jo|dm.*rash|polymyositis|inclusion body.*rheum", "srh-myositis"],
    ["mctd|overlap.*ctd|anti-rnp|undifferentiated.*ctd", "srh-mctd-overlap"],
    ["igg4|mikulicz|autoimmune pancreatitis.*igg4|retroperitoneal fibrosis", "srh-igg4"],
    ["ild.*ctd|ctd.*ild|nsip.*ctd|myositis.*ild", "srh-ctd-ild"],
    ["gca|giant cell arteritis|temporal arteritis|jaw claudication.*gca|halo.*temporal|pmr |polymyalgia", "srh-gca"],
    ["takayasu|pulseless|aortic.*takayasu|subclavian.*takayasu", "srh-takayasu"],
    ["pan |polyarteritis nodosa|microaneurysm.*pan|hbv.*pan", "srh-pan"],
    ["kawasaki|strawberry tongue.*kawasaki|coronary.*kawasaki|bCG.*kawasaki", "srh-kawasaki"],
    ["gpa|granulomatosis.*polyangiitis|wegener|saddle nose.*gpa|c-anca|pr3 ", "srh-gpa"],
    ["mpa|microscopic polyangiitis|p-anca|mpo ", "srh-mpa"],
    ["egpa|churg-strauss|eosinophilic.*vasculitis|asthma.*egpa", "srh-egpa"],
    ["iga vasculitis|henoch|hsp |urticarial vasculitis|leukocytoclastic|palpable purpura", "srh-iga-urticarial"],
    ["anti-gbm|goodpasture.*rheum|pulmonary-renal.*gbm", "srh-anti-gbm"],
    ["cryoglobulin|behcet|oral.*ulcer.*behcet|pathergy|single organ.*vasculitis", "srh-cryo"],
    ["autoinflammatory|fMF |adult still|mas |hlh |hemophagocytic", "srh-autoinflammatory"],
    ["sarcoid.*rheum|löfgren|amyloid.*rheum|septic arthritis|culture.*joint|gonococcal.*arthritis", "srh-septic-arthritis"],
    ["fibromyalgia|tender point|soft tissue.*rheum|bursitis.*rheum|polychondritis", "srh-fibromyalgia"],
    ["uveitis.*rheum|episcleritis.*rheum|scleritis.*rheum|sicca.*eye", "srh-ocular-rheum"],
    ["synovial fluid|arthrocentesis|crystal.*(joint|synovial)|kocher.*septic", "srh-synovial-fluid"],
    ["autoantibod|ana |rf |anti-ccp|anca |complement.*(c3|c4)|esr |crp ", "srh-autoantibodies"],
    ["steroid.*(rheum|taper|prophylaxis)|glucocorticoid.*rheum|immunosuppress.*rheum|prophylaxis.*(pcp|tb).*immunosuppress", "srh-glucocorticoids"],
  ], "srh-imaging");
  if (subject === "ss-infectious-diseases") return route([
    ["staph|mrsa|folliculitis|boil |abscess.*staph|toxic shock.*staph", "sid-staph"],
    ["strep|scarlet|erysipelas|cellulitis|necrotizing fasciitis|gas gangrene|clostridial.*soft", "sid-strep-entero"],
    ["diphtheria|pseudomembrane.*throat|bull neck|list test.*diphtheria", "sid-gp-other"],
    ["tetanus|lockjaw|risus|spasms.*tetanus", "sid-toxin-mediated"],
    ["e coli.*(uti|sepsis)|klebsiella|proteus|enterobacter.*infect", "sid-enterobacterales"],
    ["pseudomonas|ecthyma|non-fermenter|acinetobacter|burkholderia", "sid-non-fermenters"],
    ["typhoid|enteric fever|rose spots|salmonella.*(typhi|blood culture)", "sid-typhoid"],
    ["cholera|rice water|vibrio.*cholera", "sid-gi-infections"],
    ["leptospirosis|weil|conjunctival suffusion", "sid-leptospirosis"],
    ["scrub typhus|eschar|orientia|rickettsia|spotted fever|weil-felix", "sid-rickettsia"],
    ["tb |tuberculosis|miliary|ghon|caseat|scrofula|lupus vulgaris|cold abscess", "sid-tb"],
    ["mdr|dr-tb|xdr|drug-resistant.*tb|bedaquiline", "sid-dr-tb"],
    ["ntm|atypical.*mycobact|leprosy|leprae|claw hand.*leprosy", "sid-ntm-leprosy"],
    ["candida|thrush|vulvovaginal.*candida|esophageal.*candida", "sid-candida"],
    ["aspergillus|aspergilloma|air crescent|galactomannan|abpa.*id", "sid-aspergillus"],
    ["mucor|rhizopus|black.*eschar.*(nose|palate)|reverse halo.*mucor", "sid-mucor"],
    ["cryptococcus|india ink|histoplasma|endemic.*fung|talaromyces", "sid-cryptococcus-endemic"],
    ["pcp |pneumocystis|ground glass.*hiv|cotrim.*pcp", "sid-pcp-other-fungal"],
    ["hiv|aids|cd4 |leukoplakia.*hairy|kaposi.*hiv", "sid-hiv-basics"],
    ["art |antiretroviral|dolutegravir|efavirenz|iris ", "sid-art"],
    ["cmv|ebv|hsv |herpes.*(labialis|genital|encephalitis)|vzv|shingles|chickenpox", "sid-hsv-vzv"],
    ["hepatitis b.*id|hbv.*id|hepatitis c.*id|hcv.*id", "sid-hbv"],
    ["influenza|covid|sars|rsv |respiratory.*virus|h1n1", "sid-respiratory-viral"],
    ["dengue|ns1 |tourniquet.*dengue|chikungunya|zika|yellow fever", "sid-arbovirus"],
    ["rabies|hydrophobia|aerosol.*rabies|pep.*rabies", "sid-rabies"],
    ["malaria|plasmodium|falciparum|vivax|schizont", "sid-malaria"],
    ["kala.?azar|leishmania|donovan bodies|rk39", "sid-kala-azar"],
    ["giardia|entamoeba|flask ulcer|cryptosporidium.*stool|isospora", "sid-protozoa-other"],
    ["ascaris|hookworm|filaria|elephantiasis|wuchereria|cysticercosis|hydatid.*id", "sid-helminths"],
    ["sepsis|qsofa|septic shock|blood culture.*sepsis", "sid-sepsis-id"],
    ["endocarditis|vegetation.*valve|janeway|osler|duke ", "sid-endocarditis"],
    ["meningitis|meningococcal|purpura.*meningitis|csf.*bacterial", "sid-meningitis"],
    ["encephalitis|brain abscess|toxoplasma.*brain.*id|tuberculoma.*brain.*id", "sid-encephalitis-abscess"],
    ["uti.*id|cystitis|pyelonephritis|nitrite.*uti", "sid-uti"],
    ["osteomyelitis.*id|septic arthritis.*id|diabetic foot.*infect|cellulitis.*id", "sid-skin-bone-joint"],
    ["peritonitis.*id|cholangitis.*id|liver abscess.*id|amoebic.*id", "sid-intra-abdominal"],
    ["pneumonia.*id|empyema.*id|lung abscess.*id|aspiration.*id", "sid-respiratory-id"],
    ["sti |syphilis|chancre|gonorrh(o|)ea|chancroid|lgv |trichomoniasis", "sid-stis"],
    ["fuor|fever.*unknown|puo |febrile.*(adult|approach)", "sid-fever-approach"],
    ["measles|mumps|rubella|koplik|parotid.*mumps|fifth disease.*id", "sid-fever-rash"],
    ["neutropen|febrile neutropenia|g-csf.*neutropenia|mascc ", "sid-febrile-neutropenia"],
    ["transplant.*infect|sot |opportunistic.*transplant|cmv.*transplant", "sid-sot"],
    ["hai |catheter.*infect|vap |clabsi|cauti |hand hygiene", "sid-hai"],
    ["vaccine|immuniz|travel.*(vaccine|prophylaxis)|yellow card", "sid-vaccines"],
    ["gram stain.*id|culture.*id|maldi|pcr.*id|procalcitonin|beta-d-glucan", "sid-micro-diagnostics"],
  ], "sid-fever-approach");
  if (subject === "ss-critical-care") return route([
    ["ards|bilateral.*opacit|pf ratio|peep.*ards|prone.*ards|whiteout.*ards", "scc-ards-def"],
    ["lung protective|low tidal|plateau.*ards|recruitment.*ards|paralysis.*ards", "scc-ards-management"],
    ["mv mode|assist control|simv|pressure support|volume control|vcv |pcv |psv ", "scc-mv-modes"],
    ["wean|spontaneous breathing trial|sbt |rsbi |extubation.*icu|tracheostomy.*wean", "scc-weaning"],
    ["niv | bipap|cpap.*ards|hfno|high flow.*oxygen|noninvasive.*ards", "scc-niv-hfno"],
    ["copd.*vent|asthma.*vent|auto-peep|breath stacking|permissive hypercapnia", "scc-obstructive-vent"],
    ["oxygen.*(delivery|device|mask|nasal.*icu)|spo2.*target|o2 delivery", "scc-oxygen-therapy"],
    ["ecmo|vv ecmo|va ecmo|oxygenator|anticoag.*ecmo", "scc-ecmo"],
    ["respiratory failure|resus.*resp|intubation.*icu|airway.*icu|rsI |rapid sequence.*icu", "scc-acute-resp-failure"],
    ["pneumonia.*icu|vap |severe.*pneumonia.*icu|curb.*icu", "scc-severe-pneumonia"],
    ["covid.*icu|pandemic.*icu|h1n1.*icu|viral.*pneumonia.*icu", "scc-viral-pandemic"],
    ["shock|map |lactate.*shock|capillary refill|mottl|vasopressor.*shock", "scc-shock-approach"],
    ["fluid.*(resus|challenge|responsiveness)|plr |ivc.*fluid|balanced.*crystalloid|albumin.*icu", "scc-fluids"],
    ["noradrenaline|vasopressor|inotrop|dobutamine|adrenaline.*shock|vasopressin.*shock", "scc-vasopressors"],
    ["cardiogenic|pump failure.*icu|iabp|impella|lvedp.*shock", "scc-cardiogenic-shock"],
    ["tamponade|tension pneumothorax.*shock|massive pe.*shock|obstructive.*shock", "scc-obstructive-shock"],
    ["bleed.*icu|massive transfusion|trauma.*bleed|gI bleed.*icu|variceal.*icu", "scc-haemorrhagic"],
    ["arrest|rosc|cpr|acls|asystole|vf |vt.*arrest|pea |post-arrest", "scc-cardiac-arrest"],
    ["stemi.*icu|acs.*icu|hfref.*icu|cardiomyopathy.*icu|arrhythmia.*icu", "scc-cardiac-icu"],
    ["sepsis.*(def|3|sofa)|qsofa.*icu", "scc-sepsis-def"],
    ["bundle.*sepsis|antibiotic.*hour.*sepsis|source control.*sepsis|steroid.*sepsis", "scc-sepsis-management"],
    ["fungal.*icu|candida.*icu|mdr.*icu|tropical.*icu|dengue.*icu|malaria.*icu|lepto.*icu", "scc-infections-icu"],
    ["aki.*icu|dialysis.*icu|rrt.*icu|crrt|indication.*dialysis.*icu", "scc-aki"],
    ["electrolyte.*icu|hyperkalemia.*icu|hyponatremia.*icu|repletion.*icu", "scc-electrolytes"],
    ["abg.*icu|acidosis.*icu|alkalosis.*icu|anion gap.*icu", "scc-acid-base"],
    ["dka.*icu|thyroid storm.*icu|adrenal crisis.*icu|glucose.*icu", "scc-endocrine-icu"],
    ["ng tube|feed.*icu|trophic.*icu|parenteral.*icu|aspiration.*feed", "scc-nutrition"],
    ["sedation|rass |cam-icu|delirium.*icu|propofol.*icu|dexmedetomidine", "scc-sedation"],
    ["tbi|head injury.*icu|icp |evd |decompressive", "scc-tbi"],
    ["stroke.*icu|sah.*icu|ich.*icu|status epilepticus.*icu", "scc-stroke-sah"],
    ["brain death|apnea test|organ.*donor.*brain death", "scc-brain-death"],
    ["gbs.*icu|myasthenia.*icu|critical illness.*(myopathy|neuropathy)", "scc-neuromuscular-icu"],
    ["trauma.*icu|atls|damage control|burns.*icu|parkland|toxicology.*icu|poison.*icu|envenomation.*icu", "scc-trauma-care"],
    ["obstetric.*icu|hellp.*icu|amniotic.*embolism|peripartum.*icu", "scc-obstetric-icu"],
    ["onco.*icu|tumour lysis.*icu|neutropenic.*icu.*onc|hypercalcemia.*icu.*onc", "scc-onco-icu"],
    ["coagulopath.*icu|dic.*icu|transfusion.*icu|platelet.*icu|fibrinogen.*icu", "scc-coagulation"],
    ["pocus|fast |echo.*icu|ivc.*pocus|lung.*(ultrasound|pocus)|dvt.*pocus|arterial line|central line.*icu", "scc-pocus"],
    ["haemodynamic monitoring|cardiac output.*icu|svv |ppv |pasC |scvo2", "scc-haemodynamic-monitoring"],
    ["ett |endotracheal.*icu|tracheostomy.*icu|airway.*(difficult|device).*icu|ventilator.*(circuit|alarm)", "scc-airway"],
    ["pressure sore|pressure injury|dvt prophylaxis.*icu|stress ulcer.*icu|vte.*icu", "scc-quality-icu"],
    ["ecg|ekg|av block|bundle branch|af |flutter|svt |torsades|brugada|qt.*ecg|st elevation|peaked.*ecg", "scc-cardiac-icu"],
    ["cxr|chest xray|ards.*cxr|effusion.*icu.*cxr|pneumothorax.*icu.*cxr|line.*(tip|position).*cxr", "scc-resp-monitoring"],
  ], "scc-pocus");
  if (subject === "ss-general-medicine") return route([
    ["a-fib|atrial fibrillation|flutter.*atrial|svt|vtach|heart block|bundle branch|torsades|brugada|long qt|wpw|stemi|nstemi|st elevation|peaked.*ecg|u wave|delta wave|qrs.*wide|p wave.*ecg", "sgm-ecg"],
    ["cardiac.*(exam|murmur|gallop|jvp|edema.*cardiac)|orthopnea|pnd ", "sgm-cardiac-examination"],
    ["acs |troponin|unstable angina|coronary.*occlusion", "sgm-acute-coronary"],
    ["stable angina|dyslipidemia|statin|coronary calcium", "sgm-chronic-coronary"],
    ["hypertension|hypertensive|bp.*high|malignant hypertension", "sgm-hypertension"],
    ["cardiomyopathy|myocarditis|takotsubo|hcm |pericarditis|tamponade|endocarditis|vegetation.*valve|rheumatic.*(heart|valve)|valvular|mitral|aortic.*valve|cardiomegaly", "sgm-valvular"],
    ["heart failure|hfref|hfpef|gallop|raised jvp|pulmonary edema|kerley", "sgm-hfref"],
    ["pneumonia|consolidation|air bronchogram", "sgm-pneumonia"],
    ["tb |tuberculosis|miliary|ghon|cavitar.*tb", "sgm-pulmonary-tb"],
    ["copd|emphysema|asthma|wheeze|bronchiectasis|tramline", "sgm-copd"],
    ["ild |honeycomb|ground glass|uip |sarcoid|pneumoconiosis", "sgm-ild"],
    ["effusion|pleural|pneumothorax|mesothelioma", "sgm-pleural-disease"],
    ["lung.*(cancer|nodule|mass)|hilar mass|pancoast", "sgm-lung-cancer"],
    ["pe |embol|hampton|dvt ", "sgm-vte-pulmonary-hypertension"],
    ["ards|resp.*failure|abg |pft|spirometry", "sgm-pft-abg"],
    ["barrett|gerd|peptic|ulcer.*(gastric|duodenal)|gi bleed|melena|crohn|ulcerative colitis|ibd |polyp.*colon|colorectal|gallstone|cholecystitis|pancreatitis|cirrhosis|ascites|varic|hepatitis|jaundice|fatty liver|hcc ", "sgm-gi-bleeding"],
    ["malabsorption|celiac|diarrh(o|)ea.*chronic", "sgm-malabsorption"],
    ["aki|ckd|dialysis|glomerulo|nephr|proteinuria|hematuria|stone.*(kidney|ureter)|uti |hyponatremia|hyperkalemia|acidosis", "sgm-aki"],
    ["goitre|goiter|thyroid|graves|hashimoto|thyrotox|hypothyroid", "sgm-hyperthyroidism"],
    ["cushing|addison|pheo|aldosterone|adrenal", "sgm-cushing"],
    ["diabetes|hba1c|dka|hypoglycem|diabetic.*(foot|retino|nephro|neuro)", "sgm-diabetes-diagnosis"],
    ["anemia|anaemia|pallor|iron deficien|b12|thalassemia|sickle|hemolysis|spherocyt|pancytopenia|leukemia|lymphoma|myeloma|purpura|hemophilia|thrombosis|transfusion", "sgm-anaemia-approach"],
    ["rheumatoid|gout|tophi|lupus|scleroderma|vasculitis|purpura.*vasculitis|arthritis|ulnar drift|clubbing", "sgm-arthritis-approach"],
    ["stroke|infarct.*brain|hemorrhage.*brain|seizure|epilepsy|headache|migraine|parkinson|dementia|delirium|neuropathy|myasthenia|ms |multiple sclerosis|meningitis|encephalitis", "sgm-acute-ischaemic-stroke"],
    ["hiv|malaria|dengue|typhoid|sepsis|fever|eschar|leprosy|syphilis|chancre|fungal|mucor|thrush|zoster|measles|mumps", "sgm-fever-approach"],
    ["shock|sepsis.*shock|ards|ards.*sepsis|ventilator|arrest|cpr", "sgm-sepsis"],
    ["poison|overdose|antidote|snake|scorpion|op |pesticide", "sgm-poisoning-approach"],
    ["depression|anxiety|psychosis|delirium|dementia.*psych|suicide", "sgm-depression-anxiety"],
    ["rash|dermatoses|skin.*(lesion|rash|infection)|vitiligo|psoriasis|eczema", "sgm-skin-systemic"],
    ["otoscopy|otitis|cholesteatoma|vocal cord|palsy.*cord|laryngoscopy", "sgm-head-neck"],
    ["blood smear|smear.*(sickle|auer|smudge|malaria)|film.*blood", "sgm-haemolytic-anaemia"],
    ["endoscopy|colonoscopy|biopsy.*gi|ultrasound.*(thyroid|gallbladder|liver|kidney)|ct.*(chest|head|kidney)|mri.*brain|xray.*(chest|foot|skull)|casts.*urine", "sgm-diagnostic-tests"],
  ], "sgm-diagnostic-tests");
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
