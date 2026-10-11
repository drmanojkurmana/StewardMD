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
