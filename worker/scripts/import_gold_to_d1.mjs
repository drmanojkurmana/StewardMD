import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const GOLD_DIR = path.join(ROOT, 'worker', 'data', 'gold');
const OUT_SQL = path.join(ROOT, 'worker', 'data', 'import_gold_68.sql');

const missing = [
  "Adagrasib", "Amivantamab", "Asciminib", "Avapritinib", "Avelumab",
  "BCG Vaccine", "Brentuximab Vedotin", "Camizestrant", "Capivasertib", "Cefiderocol",
  "Cemiplimab", "Daraxonrasib", "Dostarlimab", "Elacestrant", "Elranatamab",
  "Enasidenib", "Enfortumab Vedotin", "Epcoritamab", "Erdafitinib", "Fedratinib",
  "Fruquintinib", "Futibatinib", "Glofitamab", "Herpes Zoster Vaccine", "Human Papillomavirus Vaccine",
  "Iberdomide", "Inavolisib", "Ipilimumab", "Ivosidenib", "Linvoseltamab",
  "Luspatercept", "Mirdametinib", "Mirvetuximab Soravtansine", "Mobocertinib", "Momelotinib",
  "Neratinib", "Nogapendekin Alfa Inbakicept", "Olutasidenib", "Pacritinib", "Pemigatinib",
  "Pirtobrutinib", "Polatuzumab Vedotin", "Pralsetinib", "Rabies Vaccine", "Repotrectinib",
  "Retatrutide", "Retifanlimab", "Ripretinib", "Rotavirus Vaccine", "Sacubitril",
  "Selpercatinib", "Sevabertinib", "Sotorasib", "Talquetamab", "Tarlatamab",
  "Teclistamab", "Tepotinib", "Tirzepatide", "Tislelizumab", "Tisotumab Vedotin",
  "Toripalimab", "Trastuzumab Deruxtecan", "Tremelimumab", "Tucatinib", "Vorasidenib",
  "Zanidatamab", "Zanubrutinib", "Zolbetuximab"
];

// Key aliases that Indian brands / catalogue frequently use
const ALIASES = {
  "Rabies Vaccine": ["Rabies Vaccine (Human)", "Human + Rabies Vaccine"],
  "Tetanus Toxoid": ["Adsorbed Tetanus Vaccine", "Tetanus Toxoid Vaccine"],
  "Rotavirus Vaccine": ["Rotavirus Vaccine (Live Attenuated)"],
  "Human Papillomavirus Vaccine": ["HPV Vaccine"],
  "Herpes Zoster Vaccine": ["Zoster Vaccine Live"],
  "BCG Vaccine": ["Bacillus Calmette-Guerin Vaccine"]
};

function lit(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function getQuick(quickList, key) {
  if (!Array.isArray(quickList)) return "";
  for (const item of quickList) {
    if (Array.isArray(item) && item[0] && item[0].toLowerCase() === key.toLowerCase()) {
      return item[1] || "";
    }
  }
  return "";
}

function getPK(pkList, key) {
  if (!Array.isArray(pkList)) return "";
  for (const item of pkList) {
    if (Array.isArray(item) && item[0] && item[0].toLowerCase() === key.toLowerCase()) {
      return item[1] || "";
    }
  }
  return "";
}

const COLS = [
  "composition", "summary", "therapeutic_class", "pharm_class", "moa", "rx_otc",
  "habit_forming", "routes", "adult_dose", "ped_dose", "geriatric", "dosage_table",
  "renal_adjust", "hepatic_adjust", "administration", "food_timing", "oral_admin",
  "iv_admin", "im_admin", "dilution_infusion", "pregnancy", "lactation",
  "contraindications", "boxed_warning", "precautions", "common_se", "serious_se",
  "interactions", "food_interactions", "alcohol", "monitoring", "onset", "peak",
  "half_life", "duration", "storage", "counseling", "missed_dose", "overdose",
  "offlabel", "guideline_notes", "refs", "sources", "reviewed",
  "updated_at", "gold"
];

let sqlOut = "-- Import 68 gold monographs + aliases into Cloudflare D1 drug_structured\n";

for (const name of missing) {
  const filePath = path.join(GOLD_DIR, name + ".json");
  const raw = fs.readFileSync(filePath, "utf8");
  const d = JSON.parse(raw);

  const compositionsToInsert = [name];
  if (ALIASES[name]) {
    for (const al of ALIASES[name]) {
      if (!compositionsToInsert.includes(al)) compositionsToInsert.push(al);
    }
  }

  for (const compName of compositionsToInsert) {
    const adultDose = getQuick(d.quick, "Adult dose") || (d.dosage && d.dosage[0] && d.dosage[0].d) || "";
    const meal = getQuick(d.quick, "Meal") || (d.interactions && d.interactions.food) || "";
    const preg = getQuick(d.quick, "Pregnancy") || d.preg || "";
    const lact = getQuick(d.quick, "Lactation") || d.lact || "";
    const renal = getQuick(d.quick, "Renal") || d.renal || "";
    const hepatic = getQuick(d.quick, "Hepatic") || d.hepatic || "";
    const alc = getQuick(d.quick, "Alcohol") || (d.interactions && d.interactions.alcohol) || "";
    const mon = getQuick(d.quick, "Monitoring") || (Array.isArray(d.monitoring) ? d.monitoring.join("; ") : "");

    const row = {
      composition: compName,
      summary: d.summary || "",
      therapeutic_class: d.cls || "",
      pharm_class: d.pharm || "",
      moa: d.moa || "",
      rx_otc: "Rx",
      habit_forming: "",
      routes: JSON.stringify(d.dosage ? Array.from(new Set(d.dosage.map(x => x.r).filter(Boolean))) : []),
      adult_dose: adultDose,
      ped_dose: "",
      geriatric: "",
      dosage_table: JSON.stringify(d.dosage || []),
      renal_adjust: renal,
      hepatic_adjust: hepatic,
      administration: Array.isArray(d.admin) ? d.admin.join("; ") : (d.admin || ""),
      food_timing: meal,
      oral_admin: "",
      iv_admin: "",
      im_admin: "",
      dilution_infusion: "",
      pregnancy: preg,
      lactation: lact,
      contraindications: JSON.stringify(d.contra || {}),
      boxed_warning: d.boxed_warning || "",
      precautions: JSON.stringify((d.contra && d.contra.relative) || d.warnings || []),
      common_se: JSON.stringify((d.se && d.se.common) || []),
      serious_se: JSON.stringify((d.se && d.se.serious) || []),
      interactions: JSON.stringify((d.interactions && d.interactions.major) || []),
      food_interactions: (d.interactions && d.interactions.food) || "",
      alcohol: alc,
      monitoring: mon,
      onset: getPK(d.pk, "Onset"),
      peak: getPK(d.pk, "Peak"),
      half_life: getPK(d.pk, "Half-life"),
      duration: getPK(d.pk, "Duration"),
      storage: getPK(d.pk, "Storage") || d.storage || "",
      counseling: JSON.stringify(d.counsel || []),
      missed_dose: d.missed || "",
      overdose: d.overdose || "",
      offlabel: "[]",
      guideline_notes: "",
      refs: JSON.stringify((d.refs || []).map(r => ({ title: r[0], url: r[1] }))),
      sources: JSON.stringify(d.sources || ["DailyMed", "openFDA", "WHO"]),
      reviewed: 1,
      updated_at: "2026-09-21",
      gold: JSON.stringify(d)
    };

    const valList = COLS.map(c => lit(row[c])).join(", ");
    sqlOut += `INSERT OR REPLACE INTO drug_structured (${COLS.join(", ")}) VALUES (${valList});\n`;
  }
}

fs.writeFileSync(OUT_SQL, sqlOut, "utf8");
console.log(`Generated ${OUT_SQL} (${(fs.statSync(OUT_SQL).size / 1024).toFixed(1)} KB)`);
