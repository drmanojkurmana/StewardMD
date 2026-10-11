#!/usr/bin/env node
// tools/prep-imgharvest.mjs - Harvester for openly licensed medical images (Pathology, Anatomy, Surgery).
// Commercial app (Pro) license rules:
//   Allowed ONLY: CC0, Public Domain (US gov, pre-1930), CC BY 2.0/3.0/4.0, CC BY-SA 2.0/3.0/4.0 (flagged share-alike).
//   EXCLUDED: CC BY-NC, CC BY-ND, GFDL-only, 'fair use', unknown/ambiguous, 'no derivatives/commercial'.
//   Attribution preserved: { title, author, sourceUrl, licence, licenceUrl, fetchDate, sha256, caption, subject }.
//
// Usage:
//   node tools/prep-imgharvest.mjs [--dir DIR] [--target 1500] [--subject pathology|anatomy|surgery|all]

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BANK_DIR = "/Volumes/WD BLACK SN7100 1TB Media/stewardmd/imagebank";
const DEFAULT_DATA_DIR = path.join(os.homedir(), "prep-data", "assessment", "images");

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf("--" + k); return i < 0 ? d : argv[i + 1]; };
const BANK_DIR = opt("dir", fs.existsSync(DEFAULT_BANK_DIR) ? DEFAULT_BANK_DIR : path.join(os.homedir(), "prep-data", "imagebank"));
const DATA_DIR = opt("data", DEFAULT_DATA_DIR);
const TARGET_PER_SUBJ = Number(opt("target", 600)) || 600;
const SUBJ_FILTER = opt("subject", "all");

const UA = "StewardMD-PrepNucleus-ImageHarvest/1.0 (https://stewardmd.com; contact drmanojkurmana@gmail.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseLicence(lic) {
  if (!lic) return null;
  const s = String(lic).trim();
  if (/(-nc\b|-nd\b|\bnc\b|\bnd\b|non-?commercial|no-?derivatives|fair\s*use|unknown|ambiguous)/i.test(s)) return null;
  if (/^gfdl/i.test(s) && !/cc\s*by/i.test(s)) return null;
  if (/^(cc0|pdm|public\s*domain|pd\b|pd-)/i.test(s)) return { code: "CC0/PD", shareAlike: false, name: s };
  const mBySa = s.match(/cc\s*by-sa(?:-igo)?(?:\s*v?(\d(?:\.\d)?))?/i);
  if (mBySa) return { code: "CC BY-SA" + (mBySa[1] ? " " + mBySa[1] : ""), shareAlike: true, name: s };
  const mBy = s.match(/cc\s*by(?:-igo)?(?:\s*v?(\d(?:\.\d)?))?/i);
  if (mBy) return { code: "CC BY" + (mBy[1] ? " " + mBy[1] : ""), shareAlike: false, name: s };
  return null;
}

export function cleanText(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanAuthor(raw) {
  const c = cleanText(raw);
  if (!c) return "Unknown / Public domain";
  return c.slice(0, 160);
}

// Queries designed for high-yield Board exams (NEET-PG / INI-CET / NBEMS)
export const SUBJECT_QUERIES = {
  pathology: [
    "histopathology of",
    "gross pathology",
    "cytopathology of",
    "immunohistochemistry",
    "\"H&E stain\"",
    "adenocarcinoma histopathology",
    "squamous cell carcinoma histopathology",
    "lymphoma histopathology",
    "sarcoma histopathology",
    "granuloma histopathology",
    "Burkitt lymphoma histopathology",
    "Hodgkin lymphoma Reed-Sternberg",
    "papillary thyroid carcinoma psammoma",
    "pheochromocytoma histopathology",
    "Wilms tumor histopathology",
    "Ewing sarcoma histopathology",
    "osteosarcoma histopathology",
    "melanoma histopathology",
    "crescentic glomerulonephritis",
    "membranous nephropathy",
    "minimal change disease",
    "amyloidosis Congo red",
    "Barrett esophagus histopathology",
    "cirrhosis liver gross pathology",
    "myocardial infarction gross pathology",
    "tuberculosis caseous necrosis histopathology",
    "Aschoff body rheumatic",
    "Councilman body hepatitis",
    "Mallory-Denk bodies liver",
    "Krukenberg tumor gross",
    "teratoma gross pathology",
    "seminoma histopathology",
    "fibroadenoma breast histopathology",
    "ductal carcinoma breast histopathology",
    "cervical intraepithelial neoplasia CIN",
    "gout tophus histopathology",
    "bone giant cell tumor histopathology",
    "pleomorphic adenoma salivary",
    "Warthin tumor histopathology",
    "meningioma psammoma bodies",
    "glioblastoma pseudopalisading",
    "schwannoma Antoni A Antoni B",
    "peripheral blood smear spherocytosis",
    "peripheral blood smear sickle cell",
    "blood smear chronic lymphocytic leukemia smudge cells",
    "blood smear acute myeloid leukemia Auer rods",
    "blood smear target cells thalassemia",
    "blood smear schistocytes microangiopathic",
    "bone marrow aspirate",
    "Pap smear koilocytes",
    "thyroid FNAC cytology",
    "pleural fluid cytology malignant",
    "urine cytology malignant cells",
    "gross specimen myocardial infarction heart",
    "gross specimen cirrhosis liver",
    "gross specimen renal cell carcinoma kidney",
    "gross specimen teratoma ovary",
    "X-ray osteosarcoma",
    "X-ray Ewing sarcoma onion skin",
    "CT glioblastoma",
    "mammogram breast cancer",
    "barium swallow achalasia bird beak"
  ],
  anatomy: [
    "Gray's Anatomy plate",
    "human anatomy dissection",
    "anatomical dissection",
    "cadaveric dissection",
    "cross section anatomy",
    "cadaver dissection",
    "anatomical specimen",
    "plastination anatomy",
    "osteology human bone",
    "human skeleton bone",
    "skull foramina human",
    "sphenoid bone human",
    "temporal bone anatomy",
    "cranial nerves brain dissection",
    "human brainstem dissection",
    "human heart dissection",
    "thoracic wall dissection",
    "larynx dissection",
    "brachial plexus cadaver",
    "femoral triangle dissection",
    "popliteal fossa dissection",
    "carpal tunnel dissection",
    "cervical vertebra anatomy",
    "lumbar vertebra anatomy",
    "thoracic vertebra anatomy",
    "pelvis bone human anatomy",
    "scapula bone human anatomy",
    "humerus bone human anatomy",
    "radius ulna bone human",
    "femur bone human anatomy",
    "tibia fibula human anatomy",
    "talus calcaneus bone human",
    "knee joint dissection",
    "shoulder joint dissection",
    "circle of Willis specimen",
    "cross section brain human",
    "cross section thorax human",
    "cross section abdomen human",
    "cross section pelvis human",
    "peritoneal cavity anatomy dissection",
    "submandibular gland dissection",
    "parotid gland dissection",
    "orbit extraocular dissection",
    "cavernous sinus dissection",
    "brachial plexus anatomy",
    "lumbosacral plexus anatomy",
    "cranial nerves anatomy",
    "circle of Willis anatomy",
    "coronary arteries anatomy",
    "coeliac trunk branches",
    "superior mesenteric artery anatomy",
    "inferior mesenteric artery anatomy",
    "portal venous system anatomy",
    "inguinal canal anatomy",
    "femoral triangle anatomy",
    "popliteal fossa anatomy",
    "cubital fossa anatomy",
    "carotid triangle anatomy",
    "submandibular triangle anatomy",
    "larynx cartilage vocal cords anatomy",
    "tracheobronchial tree bronchus",
    "mediastinum compartments anatomy",
    "peritoneal recesses foramen of Winslow",
    "retroperitoneal space anatomy",
    "kidney anatomical relation cross section",
    "pelvic floor perineum levator ani",
    "ischiorectal fossa anatomy",
    "internal capsule thalamus basal ganglia",
    "cerebellar peduncles brainstem",
    "cavernous sinus relations anatomy",
    "middle ear ossicles tympanic cavity",
    "orbit extraocular muscles anatomy",
    "wrist carpal tunnel flexor retinaculum",
    "sole of foot layers muscles",
    "knee ligaments menisci anatomy",
    "shoulder joint rotator cuff anatomy",
    "hip joint ligaments relations",
    "Sobotta anatomy plate",
    "sciatic nerve dissection",
    "brachial plexus cadaveric",
    "median nerve dissection",
    "radial nerve dissection",
    "ulnar nerve dissection",
    "facial nerve branches parotid",
    "trigeminal nerve cadaver",
    "cranial nerves brainstem dissection",
    "circle of Willis cadaver dissection",
    "coronary arteries heart dissection",
    "thoracic aorta branches dissection",
    "coeliac trunk dissection cadaver",
    "superior mesenteric artery dissection",
    "inferior mesenteric artery dissection",
    "portal vein liver dissection",
    "Calot triangle anatomy dissection",
    "inguinal canal dissection layers",
    "femoral triangle cadaver dissection",
    "popliteal fossa cadaver dissection",
    "carpal tunnel cadaver dissection",
    "foot anatomy muscles dissection",
    "skull base foramina anatomy",
    "sphenoid sinus anatomy",
    "temporal bone facial canal",
    "larynx vocal cords anatomy dissection",
    "kidney cross section gross anatomy",
    "pelvic floor perineum dissection",
    "ischiorectal fossa dissection",
    "internal capsule brain anatomy",
    "cerebellum dissection anatomy",
    "spinal cord cross section anatomy",
    "human histology slide",
    "thyroid gland histology",
    "pituitary gland histology",
    "adrenal gland histology",
    "liver lobule histology",
    "pancreas islets histology",
    "glomerulus histology H&E",
    "lymph node histology germinal center",
    "spleen red white pulp histology",
    "oesophagus histology H&E",
    "stomach fundus histology H&E",
    "duodenum Brunner glands histology",
    "jejunum ileum histology Peyer",
    "colon histology crypts of Lieberkuhn",
    "appendix histology lymphoid follicles",
    "trachea histology pseudostratified ciliated",
    "lung alveoli histology pneumocyte",
    "ureter histology transitional epithelium",
    "urinary bladder urothelium histology",
    "testis seminiferous tubules histology",
    "epididymis stereocilia histology",
    "prostate histology corpora amylacea",
    "ovary primordial follicle histology",
    "fallopian tube histology ciliated",
    "endometrium proliferative secretory histology",
    "cervix squamocolumnar junction histology",
    "placenta chorionic villi histology",
    "skin epidermis dermis histology",
    "cerebral cortex pyramidal cells histology",
    "cerebellar Purkinje cells histology",
    "spinal cord anterior horn motor neurons",
    "compact bone Haversian system osteon",
    "hyaline cartilage chondrocytes lacunae",
    "elastic cartilage epiglottis histology",
    "fibrocartilage intervertebral disc histology",
    "skeletal muscle cross striations histology",
    "cardiac muscle intercalated discs histology",
    "smooth muscle spindle cells histology",
    "elastic artery aorta tunica media",
    "cornea layers histology Bowman Descemet",
    "thymus Hassall corpuscles histology",
    "parathyroid chief cells oxyphil histology"
  ],
  surgery: [
    "surgical specimen",
    "laparoscopic cholecystectomy",
    "laparoscopic appendectomy",
    "laparoscopic hernia",
    "laparoscopic colectomy",
    "laparoscopy abdomen",
    "cholecystectomy specimen",
    "gallbladder stone specimen",
    "thyroidectomy specimen",
    "mastectomy specimen",
    "splenectomy specimen",
    "nephrectomy specimen",
    "colectomy specimen",
    "gastrectomy specimen",
    "pancreatectomy Whipple specimen",
    "adrenalectomy specimen",
    "appendectomy specimen",
    "lipoma surgical excision",
    "sebaceous cyst excision",
    "gangrene foot amputation",
    "amputation specimen surgical",
    "inguinal hernia sac",
    "umbilical hernia repair",
    "incisional hernia surgery",
    "surgical forceps",
    "surgical retractor",
    "surgical hemostat",
    "surgical clamp",
    "needle holder surgery",
    "surgical scalpel",
    "laparoscopic trocars",
    "colostomy stoma",
    "ileostomy stoma",
    "chest tube thoracostomy",
    "tracheostomy tube",
    "arteriovenous fistula hemodialysis",
    "pilonidal sinus surgery",
    "hemorrhoids surgery",
    "fistula in ano surgery",
    "wound dehiscence surgical",
    "diabetic foot ulcer surgery",
    "split thickness skin graft",
    "burn contracture surgical",
    "carotid endarterectomy specimen",
    "parotidectomy specimen",
    "intussusception resection",
    "volvulus sigmoid resection",
    "Meckel diverticulum surgery",
    "ovarian cystectomy specimen",
    "leiomyoma myomectomy specimen",
    "resected specimen surgery",
    "intraoperative finding",
    "intraoperative photograph",
    "laparoscopic view",
    "laparoscopic cholecystectomy Calot triangle",
    "laparoscopic appendectomy",
    "Whipple procedure specimen pancreas",
    "thyroidectomy specimen thyroid",
    "mastectomy specimen breast",
    "colectomy specimen colon",
    "gastrectomy specimen stomach",
    "splenectomy specimen spleen",
    "nephrectomy specimen kidney",
    "adrenalectomy specimen",
    "parotidectomy specimen facial nerve",
    "esophagectomy specimen",
    "diverticulitis sigmoid resection",
    "intussusception surgical specimen",
    "volvulus sigmoid surgical specimen",
    "inguinal hernia sac Bassini Lichtenstein",
    "femoral hernia intraoperative",
    "umbilical hernia mesh repair",
    "surgical instrument forceps",
    "surgical instrument retractor",
    "surgical instrument clamp",
    "surgical instrument scalpel trocars",
    "surgical needle holder sutures",
    "stoma ileostomy colostomy",
    "wound debridement surgical",
    "skin graft split thickness surgery",
    "tracheostomy surgical procedure",
    "intercostal chest drain insertion",
    "arteriovenous fistula hemodialysis surgery",
    "abominal aortic aneurysm resection",
    "carotid endarterectomy intraoperative",
    "common bile duct stone choledochotomy"
  ]
};

async function searchCommons(query, limit = 80) {
  const qUrl = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6", // File: namespace
    gsrlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
    format: "json"
  });

  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(qUrl, { headers: { "User-Agent": UA } });
      if (res.status === 429 || res.status >= 500) {
        await sleep(1500 * (a + 1));
        continue;
      }
      if (!res.ok) return [];
      const data = await res.json();
      const pages = Object.values(data.query?.pages || {});
      const candidates = [];
      for (const p of pages) {
        const ii = p.imageinfo?.[0];
        if (!ii || !ii.url) continue;
        const meta = ii.extmetadata || {};
        const licStr = meta.LicenseShortName?.value;
        const lic = parseLicence(licStr);
        if (!lic) continue; // License filter
        const title = p.title || "";
        // Skip svgs, gifs, tiffs, audio, video
        if (!/\.(jpe?g|png|webp)$/i.test(title)) continue;
        const desc = cleanText(meta.ImageDescription?.value || meta.ObjectName?.value || "");
        const artist = cleanAuthor(meta.Artist?.value || meta.Credit?.value);
        candidates.push({
          title,
          originalUrl: ii.url,
          width: ii.width || 0,
          height: ii.height || 0,
          licence: lic.name,
          licenceStandard: lic.code,
          licenceUrl: meta.LicenseUrl?.value || "",
          shareAlike: lic.shareAlike,
          author: artist,
          caption: desc,
          source: "commons",
          sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`
        });
      }
      return candidates;
    } catch (e) {
      if (a === 2) console.error("Search failed:", query, e.message);
      await sleep(1000);
    }
  }
  return [];
}

async function downloadAndProcessImage(cand, rawDir, tmpDir) {
  const tmpRaw = path.join(tmpDir, `pi-raw-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  const tmpPng = path.join(tmpDir, `pi-png-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);

  try {
    const res = await fetch(cand.originalUrl, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 5000) return null; // Too small or broken
    fs.writeFileSync(tmpRaw, buf);

    // Downscale max edge 1000px using native sips
    execFileSync("sips", ["-Z", "1000", "-s", "format", "png", tmpRaw, "--out", tmpPng], { stdio: "ignore" });

    // Convert to webp q80
    const tmpWebp = path.join(os.tmpdir(), `pi-webp-${Date.now()}-${Math.random().toString(36).slice(2)}.webp`);
    execFileSync("cwebp", ["-quiet", "-q", "80", tmpPng, "-o", tmpWebp], { stdio: "ignore" });

    const webpBuf = fs.readFileSync(tmpWebp);
    const sha256 = crypto.createHash("sha256").update(webpBuf).digest("hex");
    const sha12 = sha256.slice(0, 12);
    const finalName = `cand-${sha12}.webp`;
    const finalPath = path.join(rawDir, finalName);

    fs.writeFileSync(finalPath, webpBuf);

    try { fs.unlinkSync(tmpRaw); } catch {}
    try { fs.unlinkSync(tmpPng); } catch {}
    try { fs.unlinkSync(tmpWebp); } catch {}

    return {
      file: finalName,
      filePath: finalPath,
      sha256,
      sha12,
      bytes: webpBuf.length
    };
  } catch (e) {
    try { fs.unlinkSync(tmpRaw); } catch {}
    try { fs.unlinkSync(tmpPng); } catch {}
    return null;
  }
}

async function main() {
  console.log("=== PrepNucleus Image Harvester ===");
  console.log(`Bank dir: ${BANK_DIR}`);
  console.log(`Data dir: ${DATA_DIR}`);
  console.log(`Target per subject: ${TARGET_PER_SUBJ}`);

  const rawDir = path.join(BANK_DIR, "raw");
  const metaDir = path.join(BANK_DIR, "meta");
  const tmpDir = path.join(BANK_DIR, "tmp");
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(metaDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const poolPath = path.join(DATA_DIR, "pool.jsonl");
  const existingSeen = new Set();
  const subjectCounts = { pathology: 0, anatomy: 0, surgery: 0 };

  if (fs.existsSync(poolPath)) {
    const lines = fs.readFileSync(poolPath, "utf8").trim().split("\n").filter(Boolean);
    for (const l of lines) {
      try {
        const item = JSON.parse(l);
        existingSeen.add(item.title);
        if (item.sha256) existingSeen.add(item.sha256);
        if (item.subject && subjectCounts[item.subject] !== undefined) {
          subjectCounts[item.subject]++;
        }
      } catch {}
    }
  }

  console.log("Existing pool counts:", subjectCounts, `total loaded: ${existingSeen.size}`);

  const subjectsToHarvest = SUBJ_FILTER === "all" ? ["pathology", "anatomy", "surgery"] : [SUBJ_FILTER];
  const dateStr = new Date().toISOString().slice(0, 10);

  for (const subj of subjectsToHarvest) {
    const only = opt("only", "");
    let queries = SUBJECT_QUERIES[subj] || [];
    if (only) queries = queries.filter((q) => only.split(",").some((s) => q.toLowerCase().includes(s.trim().toLowerCase())));
    console.log(`\nStarting harvest for subject: ${subj.toUpperCase()} (target: ${TARGET_PER_SUBJ}, current: ${subjectCounts[subj] || 0})`);

    for (const q of queries) {
      if ((subjectCounts[subj] || 0) >= TARGET_PER_SUBJ) {
        console.log(`Target reached for ${subj} (${subjectCounts[subj]}). Moving to next subject.`);
        break;
      }

      const cands = await searchCommons(q, 80);
      console.log(`Query [${subj}]: "${q}" (found ${cands.length} candidates)`);
      let added = 0;
      const validCands = cands.filter(c => !existingSeen.has(c.title) && c.caption && c.caption.length >= 15);
      
      // Process in batches of 4 concurrently
      const CONCURRENCY = 4;
      let ci = 0;
      await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
        while (ci < validCands.length) {
          if ((subjectCounts[subj] || 0) >= TARGET_PER_SUBJ) break;
          const cand = validCands[ci++];
          if (existingSeen.has(cand.title)) continue;
          
          const processed = await downloadAndProcessImage(cand, rawDir, tmpDir);
          if (!processed) continue;
          if (existingSeen.has(processed.sha256)) continue;

          const record = {
            id: `cand-${processed.sha12}`,
            subject: subj,
            query: q,
            title: cand.title,
            source: cand.source,
            sourceUrl: cand.sourceUrl,
            originalUrl: cand.originalUrl,
            author: cand.author,
            licence: cand.licence,
            licenceStandard: cand.licenceStandard,
            licenceUrl: cand.licenceUrl,
            shareAlike: cand.shareAlike,
            caption: cand.caption,
            file: processed.file,
            filePath: processed.filePath,
            sha256: processed.sha256,
            sha12: processed.sha12,
            bytes: processed.bytes,
            fetchDate: dateStr
          };

          fs.writeFileSync(path.join(metaDir, `${record.id}.json`), JSON.stringify(record, null, 2));
          fs.appendFileSync(poolPath, JSON.stringify(record) + "\n");

          existingSeen.add(cand.title);
          existingSeen.add(processed.sha256);
          subjectCounts[subj] = (subjectCounts[subj] || 0) + 1;
          added++;
          await sleep(100);
        }
      }));

      console.log(`  -> +${added} kept (total ${subjectCounts[subj]}/${TARGET_PER_SUBJ})`);
      await sleep(200);
    }
  }

  console.log("\n=== Harvest Complete ===");
  console.log("Final pool counts:", subjectCounts);
  const total = Object.values(subjectCounts).reduce((a, b) => a + b, 0);
  console.log(`Total candidate images in pool: ${total}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  });
}
