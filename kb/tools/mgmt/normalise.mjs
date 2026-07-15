/* mgmt/normalise.mjs — mechanically convert American → British spellings in the
   generated management sidecars (house style). Word-boundary, case-preserving
   for the first letter. Safe: only touches the `management` strings; leaves the
   canonical files alone (run BEFORE apply.mjs). Run after generation completes. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MG = join(process.cwd(), "kb", "_mgmt");

// [regex (case-insensitive, word-bounded), britishLowercase]
const MAP = [
  [/\bfoetal\b/gi, "foetal"], // no-op guard first (avoids double-touch order issues)
  [/\bfetal\b/gi, "foetal"], [/\bfetus\b/gi, "foetus"], [/\bfetuses\b/gi, "foetuses"], [/\bfeto-/gi, "foeto-"],
  [/\btumor\b/gi, "tumour"], [/\btumors\b/gi, "tumours"], [/\btumoral\b/gi, "tumoural"],
  [/\bedema\b/gi, "oedema"], [/\bedematous\b/gi, "oedematous"],
  [/\bhemorrhage\b/gi, "haemorrhage"], [/\bhemorrhages\b/gi, "haemorrhages"], [/\bhemorrhagic\b/gi, "haemorrhagic"],
  [/\bhematoma\b/gi, "haematoma"], [/\bhematomas\b/gi, "haematomas"], [/\bhematuria\b/gi, "haematuria"],
  [/\bhematologic\b/gi, "haematological"], [/\bhematological\b/gi, "haematological"], [/\bhematopoietic\b/gi, "haematopoietic"],
  [/\bhemolysis\b/gi, "haemolysis"], [/\bhemolytic\b/gi, "haemolytic"], [/\bhemoglobin\b/gi, "haemoglobin"],
  [/\bhematemesis\b/gi, "haematemesis"], [/\bhemostasis\b/gi, "haemostasis"], [/\bhemostatic\b/gi, "haemostatic"],
  [/\bhemodynamic\b/gi, "haemodynamic"], [/\bhemodynamically\b/gi, "haemodynamically"],
  [/\bhemarthrosis\b/gi, "haemarthrosis"], [/\bhematochezia\b/gi, "haematochezia"], [/\bhemophilia\b/gi, "haemophilia"],
  [/\bhemithorax\b/gi, "haemithorax"], [/\bhemoptysis\b/gi, "haemoptysis"], [/\bhemothorax\b/gi, "haemothorax"],
  [/\banemia\b/gi, "anaemia"], [/\banemias\b/gi, "anaemias"], [/\banemic\b/gi, "anaemic"],
  [/\bischemia\b/gi, "ischaemia"], [/\bischemic\b/gi, "ischaemic"],
  [/\bpediatric\b/gi, "paediatric"], [/\bpediatrician\b/gi, "paediatrician"], [/\bpediatrics\b/gi, "paediatrics"],
  [/\borthopedic\b/gi, "orthopaedic"], [/\borthopedics\b/gi, "orthopaedics"],
  [/\besophageal\b/gi, "oesophageal"], [/\besophagus\b/gi, "oesophagus"], [/\besophagitis\b/gi, "oesophagitis"],
  [/\bestrogen\b/gi, "oestrogen"], [/\bestrogens\b/gi, "oestrogens"], [/\bestradiol\b/gi, "oestradiol"],
  [/\bleukemia\b/gi, "leukaemia"], [/\bleukemias\b/gi, "leukaemias"], [/\bleukemic\b/gi, "leukaemic"],
  [/\bdiarrhea\b/gi, "diarrhoea"], [/\bceliac\b/gi, "coeliac"],
  [/\bgynecologic\b/gi, "gynaecological"], [/\bgynecological\b/gi, "gynaecological"], [/\bgynecology\b/gi, "gynaecology"],
  [/\bhospitalization\b/gi, "hospitalisation"], [/\bhospitalizations\b/gi, "hospitalisations"], [/\bhospitalize\b/gi, "hospitalise"], [/\bhospitalized\b/gi, "hospitalised"],
  [/\bimmunization\b/gi, "immunisation"], [/\bimmunizations\b/gi, "immunisations"], [/\bimmunize\b/gi, "immunise"], [/\bimmunized\b/gi, "immunised"],
  [/\bcatheterization\b/gi, "catheterisation"], [/\bcatheterize\b/gi, "catheterise"], [/\bcatheterized\b/gi, "catheterised"],
  [/\bnebulized\b/gi, "nebulised"], [/\bnebulizer\b/gi, "nebuliser"],
  [/\bnormalize\b/gi, "normalise"], [/\bnormalized\b/gi, "normalised"], [/\bnormalization\b/gi, "normalisation"],
  [/\boptimize\b/gi, "optimise"], [/\boptimized\b/gi, "optimised"], [/\boptimization\b/gi, "optimisation"],
  [/\bminimize\b/gi, "minimise"], [/\bminimized\b/gi, "minimised"], [/\bmaximize\b/gi, "maximise"], [/\bmaximized\b/gi, "maximised"],
  [/\bstabilize\b/gi, "stabilise"], [/\bstabilized\b/gi, "stabilised"], [/\bstabilization\b/gi, "stabilisation"],
  [/\bmobilize\b/gi, "mobilise"], [/\bmobilized\b/gi, "mobilised"], [/\bmobilization\b/gi, "mobilisation"],
  [/\bindividualize\b/gi, "individualise"], [/\bindividualized\b/gi, "individualised"],
  [/\bprioritize\b/gi, "prioritise"], [/\bprioritized\b/gi, "prioritised"],
  [/\bcharacterize\b/gi, "characterise"], [/\bcharacterized\b/gi, "characterised"],
  [/\butilize\b/gi, "utilise"], [/\butilized\b/gi, "utilised"], [/\banesthesia\b/gi, "anaesthesia"], [/\banesthetic\b/gi, "anaesthetic"],
  [/\bpupillary sphincter\b/gi, "pupillary sphincter"],
];

function keepCase(match, british) {
  return (match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase())
    ? british[0].toUpperCase() + british.slice(1) : british;
}
function brify(s) {
  let out = s;
  for (const [re, br] of MAP) out = out.replace(re, (m) => keepCase(m, br));
  return out;
}

const files = readdirSync(MG).filter((f) => f.endsWith(".json") && f !== "_index.json");
let changed = 0, touchedFiles = 0;
for (const f of files) {
  let sc;
  try { sc = JSON.parse(readFileSync(join(MG, f), "utf8")); } catch (e) { continue; }
  if (!Array.isArray(sc.management)) continue;
  let fileTouched = false;
  sc.management = sc.management.map((s) => {
    if (typeof s !== "string") return s;
    const b = brify(s);
    if (b !== s) { changed++; fileTouched = true; }
    return b;
  });
  if (fileTouched) { writeFileSync(join(MG, f), JSON.stringify(sc, null, 2)); touchedFiles++; }
}
console.log(`normalise: files=${files.length} touchedFiles=${touchedFiles} stringsChanged=${changed}`);
