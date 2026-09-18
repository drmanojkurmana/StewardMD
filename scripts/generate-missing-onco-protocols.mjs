import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const protoDir = path.join(ROOT, "kb/protocols");
const otDir = path.join(ROOT, "kb/oncotree");

const newProtocols = [
  // 1. Wilms DD-4A
  {
    id: "peds-wilms-dd4a",
    diseaseId: "wilms",
    name: "Regimen DD-4A: Vincristine + Dactinomycin + DOXOrubicin (Stage III-IV / High-Risk Wilms Tumor)",
    version: "1.0",
    lifecycleState: "draft",
    experimental: true,
    intentOptions: ["curative"],
    cycleLengthDays: 21,
    cycles: 8,
    caps: "drug",
    source: {
      nccn: "Standard Guidelines (NCCN), Pediatric Wilms Tumor v1.2026",
      textbook: "Principles and Practice of Pediatric Oncology, 8th ed."
    },
    stage: ["III", "IV", "high-risk"],
    treatmentSetting: ["adjuvant", "curative"],
    histology: "nephroblastoma / Wilms tumor (favorable histology with Stage III/IV or 1p/16q LOH)",
    premedications: [
      { name: "Ondansetron", dose: "0.15 mg/kg IV", notes: "Prior to chemotherapy" }
    ],
    supportiveCare: [
      "Bowel management to prevent vincristine constipation",
      "Hepatopathy monitoring for sinusoidal obstruction syndrome with dactinomycin",
      "Flank or whole-lung radiotherapy coordination per COG AREN0532/AREN0533"
    ],
    monitoring: [
      "CBC with differential prior to each cycle",
      "CMP, LFTs, BUN/creatinine",
      "Echocardiogram baseline and cumulative doxorubicin tracking"
    ],
    clearanceChecks: ["CBC/platelets", "liver", "renal"],
    doseModificationRules: [],
    drugs: [
      {
        id: "vincristine",
        name: "vinCRIStine",
        basis: "bsa",
        dosePerUnit: 1.5,
        unit: "mg/m2",
        route: "IV",
        days: [1],
        caps: { perDose: 2 },
        notes: "vinCRIStine 1.5 mg/m2 (hard cap 2.0 mg) IV push on Day 1. Fatal if given intrathecally."
      },
      {
        id: "dactinomycin",
        name: "Dactinomycin",
        basis: "mgkg",
        dosePerUnit: 0.045,
        unit: "mg/kg",
        route: "IV",
        days: [1],
        notes: "Dactinomycin 0.045 mg/kg (or 1.35 mg/m2) IV push on Day 1. Reduce dose by 50% during concurrent radiotherapy."
      },
      {
        id: "doxorubicin",
        name: "DOXOrubicin",
        basis: "bsa",
        dosePerUnit: 45,
        unit: "mg/m2",
        route: "IV",
        days: [1],
        caps: { cumulativeLifetime: { warn: 250, hard: 350, unit: "mg/m2" } },
        notes: "DOXOrubicin 45 mg/m2 IV infusion on Day 1. Lifetime cumulative anthracycline cardiotoxicity guard applied."
      }
    ]
  },

  // 2. Waldenstrom BR
  {
    id: "wm-bendamustine-rituximab",
    diseaseId: "waldenstrom",
    name: "Bendamustine + Rituximab (BR) (Waldenström Macroglobulinemia)",
    version: "1.0",
    lifecycleState: "draft",
    experimental: true,
    intentOptions: ["curative", "palliative"],
    cycleLengthDays: 28,
    cycles: 6,
    caps: "protocol",
    source: {
      nccn: "Standard Guidelines (NCCN), Waldenström Macroglobulinemia v1.2026",
      textbook: "DeVita, Hellman, and Rosenberg's Cancer, 12th ed."
    },
    stage: ["symptomatic"],
    treatmentSetting: ["first-line", "salvage"],
    histology: "lymphoplasmacytic lymphoma / Waldenström macroglobulinemia",
    premedications: [
      { name: "Acetaminophen", dose: "650 mg PO", notes: "30 min prior to rituximab" },
      { name: "Diphenhydramine", dose: "25-50 mg IV/PO", notes: "30 min prior to rituximab" }
    ],
    supportiveCare: ["PJP and VZV prophylaxis", "Prehydration and TLS prophylaxis"],
    monitoring: ["CBC weekly", "Serum IgM and SPEP/IFE each cycle", "Serum viscosity for hyperviscosity syndrome"],
    clearanceChecks: ["CBC/platelets", "renal", "liver"],
    doseModificationRules: [],
    drugs: [
      {
        id: "bendamustine",
        name: "Bendamustine",
        basis: "bsa",
        dosePerUnit: 90,
        unit: "mg/m2",
        route: "IV",
        days: [1, 2],
        notes: "Bendamustine 90 mg/m2 IV over 30-60 min on Days 1 and 2."
      },
      {
        id: "rituximab",
        name: "Rituximab",
        basis: "bsa",
        dosePerUnit: 375,
        unit: "mg/m2",
        route: "IV",
        days: [1],
        notes: "Rituximab 375 mg/m2 IV on Day 1. Caution with IgM flare; plasmapheresis indicated if IgM > 4000 mg/dL or symptomatic hyperviscosity."
      }
    ]
  },

  // 3. Waldenstrom DRC
  {
    id: "wm-drc",
    diseaseId: "waldenstrom",
    name: "DRC: Dexamethasone + Rituximab + Cyclophosphamide (Waldenström Macroglobulinemia)",
    version: "1.0",
    lifecycleState: "draft",
    experimental: true,
    intentOptions: ["palliative", "curative"],
    cycleLengthDays: 21,
    cycles: 6,
    caps: "protocol",
    source: {
      nccn: "Standard Guidelines (NCCN), Waldenström Macroglobulinemia v1.2026"
    },
    stage: ["symptomatic"],
    treatmentSetting: ["first-line"],
    histology: "lymphoplasmacytic lymphoma",
    premedications: [{ name: "Ondansetron", dose: "8 mg PO", notes: "Prior to cyclophosphamide" }],
    supportiveCare: ["Hydration", "Allopurinol for TLS prophylaxis"],
    monitoring: ["CBC, CMP, Serum IgM"],
    clearanceChecks: ["CBC/platelets", "renal"],
    doseModificationRules: [],
    drugs: [
      {
        id: "dexamethasone",
        name: "Dexamethasone",
        basis: "flat",
        dosePerUnit: 20,
        unit: "mg",
        route: "IV",
        days: [1],
        notes: "Dexamethasone 20 mg IV on Day 1 prior to rituximab."
      },
      {
        id: "rituximab",
        name: "Rituximab",
        basis: "bsa",
        dosePerUnit: 375,
        unit: "mg/m2",
        route: "IV",
        days: [1],
        notes: "Rituximab 375 mg/m2 IV on Day 1."
      },
      {
        id: "cyclophosphamide",
        name: "Cyclophosphamide",
        basis: "bsa",
        dosePerUnit: 100,
        unit: "mg/m2",
        route: "PO",
        days: [1, 2, 3, 4, 5],
        notes: "Cyclophosphamide 100 mg/m2 PO twice daily on Days 1-5."
      }
    ]
  },

  // 4. Small Bowel mFOLFOX6
  {
    id: "small-bowel-folfox",
    diseaseId: "small_bowel",
    name: "mFOLFOX6: Oxaliplatin + Leucovorin + 5-Fluorouracil (Small Bowel Adenocarcinoma)",
    version: "1.0",
    lifecycleState: "draft",
    experimental: true,
    intentOptions: ["curative", "palliative"],
    cycleLengthDays: 14,
    cycles: 12,
    caps: "protocol",
    source: {
      nccn: "Standard Guidelines (NCCN), Small Bowel Adenocarcinoma v1.2026"
    },
    stage: ["II", "III", "IV"],
    treatmentSetting: ["adjuvant", "first-line"],
    histology: "small bowel adenocarcinoma (duodenal, jejunal, or ileal)",
    premedications: [
      { name: "Ondansetron", dose: "16 mg IV", notes: "Prior to oxaliplatin" },
      { name: "Dexamethasone", dose: "12 mg IV", notes: "Prior to oxaliplatin" }
    ],
    supportiveCare: ["Cold avoidance for oxaliplatin acute neuropathy", "Antidiarrheal management with loperamide"],
    monitoring: ["CBC with diff, CMP", "Sensory neuropathy assessment before each cycle"],
    clearanceChecks: ["CBC/platelets", "liver", "renal"],
    doseModificationRules: [],
    drugs: [
      {
        id: "oxaliplatin",
        name: "Oxaliplatin",
        basis: "bsa",
        dosePerUnit: 85,
        unit: "mg/m2",
        route: "IV",
        days: [1],
        notes: "Oxaliplatin 85 mg/m2 IV in D5W over 2 hours on Day 1."
      },
      {
        id: "leucovorin",
        name: "Leucovorin",
        basis: "bsa",
        dosePerUnit: 400,
        unit: "mg/m2",
        route: "IV",
        days: [1],
        notes: "Leucovorin 400 mg/m2 IV over 2 hours concurrently with oxaliplatin on Day 1."
      },
      {
        id: "fluorouracil-bolus",
        name: "Fluorouracil (5-FU Bolus)",
        basis: "bsa",
        dosePerUnit: 400,
        unit: "mg/m2",
        route: "IV",
        days: [1],
        notes: "5-FU 400 mg/m2 IV bolus on Day 1 following leucovorin."
      },
      {
        id: "fluorouracil-infusion",
        name: "Fluorouracil (5-FU Continuous)",
        basis: "bsa",
        dosePerUnit: 2400,
        unit: "mg/m2",
        route: "IV",
        days: [1, 2],
        notes: "5-FU 2400 mg/m2 continuous IV infusion over 46-48 hours via elastomeric or electronic pump."
      }
    ]
  },

  // 5. Vaginal Cisplatin RT
  {
    id: "gyn-vaginal-cisplatin-rt",
    diseaseId: "vaginal",
    name: "Concurrent Cisplatin Chemoradiotherapy (Vaginal Cancer)",
    version: "1.0",
    lifecycleState: "draft",
    experimental: true,
    intentOptions: ["curative"],
    cycleLengthDays: 7,
    cycles: 6,
    caps: "protocol",
    source: {
      nccn: "Standard Guidelines (NCCN), Vaginal Cancer v1.2026"
    },
    stage: ["II", "III", "IVa"],
    treatmentSetting: ["concurrent-chemoradiotherapy"],
    histology: "vaginal squamous cell carcinoma / adenocarcinoma",
    premedications: [{ name: "Ondansetron", dose: "8-16 mg IV", notes: "Prior to cisplatin" }],
    supportiveCare: ["Pre- and post-hydration with 1 L normal saline", "Magnesium and potassium supplementation"],
    monitoring: ["CBC weekly", "Serum creatinine, BUN, electrolytes weekly before cisplatin"],
    clearanceChecks: ["ANC >= 1500/mcL, Platelets >= 100,000/mcL", "Serum creatinine <= 1.5 mg/dL"],
    doseModificationRules: [],
    drugs: [
      {
        id: "cisplatin",
        name: "CISplatin",
        basis: "bsa",
        dosePerUnit: 40,
        unit: "mg/m2",
        route: "IV",
        days: [1],
        caps: { perDose: 70 },
        notes: "CISplatin 40 mg/m2 (cap 70 mg) IV weekly concurrently with external beam radiation therapy."
      }
    ]
  },

  // 6. Vulvar Cisplatin RT
  {
    id: "gyn-vulvar-cisplatin-rt",
    diseaseId: "vulvar",
    name: "Concurrent Cisplatin Chemoradiotherapy (Vulvar Cancer)",
    version: "1.0",
    lifecycleState: "draft",
    experimental: true,
    intentOptions: ["curative"],
    cycleLengthDays: 7,
    cycles: 6,
    caps: "protocol",
    source: {
      nccn: "Standard Guidelines (NCCN), Vulvar Cancer v1.2026"
    },
    stage: ["III", "IVa"],
    treatmentSetting: ["concurrent-chemoradiotherapy", "organ-sparing"],
    histology: "vulvar squamous cell carcinoma",
    premedications: [{ name: "Ondansetron", dose: "8-16 mg IV", notes: "Prior to cisplatin" }],
    supportiveCare: ["Pre- and post-hydration with 1 L normal saline", "Meticulous perineal skin care during radiotherapy"],
    monitoring: ["CBC weekly", "Serum creatinine, BUN, electrolytes weekly"],
    clearanceChecks: ["CBC/platelets", "renal"],
    doseModificationRules: [],
    drugs: [
      {
        id: "cisplatin",
        name: "CISplatin",
        basis: "bsa",
        dosePerUnit: 40,
        unit: "mg/m2",
        route: "IV",
        days: [1],
        caps: { perDose: 70 },
        notes: "CISplatin 40 mg/m2 (cap 70 mg) IV weekly concurrently with pelvic/inguinal EBRT."
      }
    ]
  },

  // 7. Bone Osteosarcoma MAP
  {
    id: "sarc-osteosarcoma-map",
    diseaseId: "bone",
    name: "MAP: High-Dose Methotrexate + DOXOrubicin + CISplatin (Osteosarcoma)",
    version: "1.0",
    lifecycleState: "draft",
    experimental: true,
    intentOptions: ["curative"],
    cycleLengthDays: 35,
    cycles: 6,
    caps: "protocol",
    source: {
      nccn: "Standard Guidelines (NCCN), Bone Cancer v1.2026"
    },
    stage: ["localized", "metastatic"],
    treatmentSetting: ["neoadjuvant", "adjuvant"],
    histology: "high-grade osteosarcoma",
    premedications: [
      { name: "Ondansetron", dose: "16 mg IV", notes: "Prior to cisplatin/doxorubicin" },
      { name: "Aprepitant", dose: "125 mg d1, 80 mg d2-3", notes: "For high emetogenicity" },
      { name: "Sodium bicarbonate", dose: "Urine alkalinization pH >= 7.0", notes: "Mandatory for high-dose methotrexate" }
    ],
    supportiveCare: [
      "Vigorous hydration with sodium bicarbonate for urine pH >= 7.0 before, during, and after HD-MTX",
      "Leucovorin calcium rescue 15 mg/m2 IV/PO q6h starting at hour 24-36 until MTX level < 0.1 mcmol/L"
    ],
    monitoring: ["Serum methotrexate levels at 24, 48, 72 hours until cleared", "Audiometry baseline and post-cisplatin", "Echocardiogram"],
    clearanceChecks: ["CBC/platelets", "renal (CrCl >= 70 mL/min)", "liver"],
    doseModificationRules: [],
    drugs: [
      {
        id: "methotrexate",
        name: "High-Dose Methotrexate",
        basis: "bsa",
        dosePerUnit: 12000,
        unit: "mg/m2",
        route: "IV",
        days: [1],
        notes: "Methotrexate 12 g/m2 (cap 20 g) IV over 4 hours with vigorous alkalinized hydration and leucovorin rescue."
      },
      {
        id: "doxorubicin",
        name: "DOXOrubicin",
        basis: "bsa",
        dosePerUnit: 37.5,
        unit: "mg/m2",
        route: "IV",
        days: [1, 2],
        caps: { cumulativeLifetime: { warn: 450, hard: 550, unit: "mg/m2" } },
        notes: "DOXOrubicin 37.5 mg/m2/day continuous IV infusion on Days 1-2 (total 75 mg/m2)."
      },
      {
        id: "cisplatin",
        name: "CISplatin",
        basis: "bsa",
        dosePerUnit: 60,
        unit: "mg/m2",
        route: "IV",
        days: [1, 2],
        notes: "CISplatin 60 mg/m2/day continuous IV infusion on Days 1-2 (total 120 mg/m2) with pre- and post-hydration."
      }
    ]
  },

  // 8. Bone Ewing VDC/IE
  {
    id: "sarc-ewing-vdc-ie",
    diseaseId: "bone",
    name: "Interval-Compressed VDC / IE (Ewing Sarcoma)",
    version: "1.0",
    lifecycleState: "draft",
    experimental: true,
    intentOptions: ["curative"],
    cycleLengthDays: 14,
    cycles: 14,
    caps: "protocol",
    source: {
      nccn: "Standard Guidelines (NCCN), Bone Cancer v1.2026"
    },
    stage: ["localized", "metastatic"],
    treatmentSetting: ["neoadjuvant", "adjuvant"],
    histology: "Ewing sarcoma / PNET",
    premedications: [
      { name: "Ondansetron", dose: "0.15 mg/kg IV", notes: "Prior to chemotherapy" },
      { name: "Mesna", dose: "Equal to 100% of ifosfamide dose", notes: "Divided IV doses or continuous infusion for uroprotection" }
    ],
    supportiveCare: [
      "Filgrastim (G-CSF) or pegfilgrastim mandatory after every cycle for 14-day interval compression",
      "Hydration 2-3 L/m2/day during ifosfamide"
    ],
    monitoring: ["CBC with diff, CMP, urinalysis (check for hematuria)", "Echocardiogram"],
    clearanceChecks: ["CBC/platelets", "renal", "liver"],
    doseModificationRules: [],
    drugs: [
      {
        id: "vincristine",
        name: "vinCRIStine",
        basis: "bsa",
        dosePerUnit: 1.5,
        unit: "mg/m2",
        route: "IV",
        days: [1],
        caps: { perDose: 2 },
        notes: "vinCRIStine 1.5 mg/m2 (cap 2 mg) IV push on Day 1 of VDC cycles."
      },
      {
        id: "doxorubicin",
        name: "DOXOrubicin",
        basis: "bsa",
        dosePerUnit: 75,
        unit: "mg/m2",
        route: "IV",
        days: [1],
        caps: { cumulativeLifetime: { warn: 375, hard: 450, unit: "mg/m2" } },
        notes: "DOXOrubicin 75 mg/m2 IV over 48 hours or continuous infusion on VDC cycles."
      },
      {
        id: "cyclophosphamide",
        name: "Cyclophosphamide",
        basis: "bsa",
        dosePerUnit: 1200,
        unit: "mg/m2",
        route: "IV",
        days: [1],
        notes: "Cyclophosphamide 1200 mg/m2 IV over 1 hour with Mesna on VDC cycles."
      },
      {
        id: "ifosfamide",
        name: "Ifosfamide",
        basis: "bsa",
        dosePerUnit: 1800,
        unit: "mg/m2",
        route: "IV",
        days: [1, 2, 3, 4, 5],
        notes: "Ifosfamide 1800 mg/m2/day IV over 1 hour with Mesna on Days 1-5 of IE cycles."
      },
      {
        id: "etoposide",
        name: "Etoposide",
        basis: "bsa",
        dosePerUnit: 100,
        unit: "mg/m2",
        route: "IV",
        days: [1, 2, 3, 4, 5],
        notes: "Etoposide 100 mg/m2/day IV over 2 hours on Days 1-5 of IE cycles."
      }
    ]
  },

  // 9. CML Imatinib
  {
    id: "cml-imatinib",
    diseaseId: "cml",
    name: "Imatinib 400 mg (Chronic Myeloid Leukemia - Chronic Phase)",
    version: "1.0",
    lifecycleState: "draft",
    experimental: true,
    intentOptions: ["curative", "disease-control"],
    cycleLengthDays: 28,
    cycles: 12,
    caps: "drug",
    source: {
      nccn: "Standard Guidelines (NCCN), Chronic Myeloid Leukemia v1.2026"
    },
    stage: ["chronic-phase", "accelerated-phase"],
    treatmentSetting: ["first-line", "maintenance"],
    histology: "chronic myeloid leukemia (BCR::ABL1 positive)",
    premedications: [],
    supportiveCare: ["Take with a large glass of water and food to minimize GI irritation"],
    monitoring: [
      "CBC with differential every 2-4 weeks initially until CHR",
      "Quantitative RT-PCR for BCR::ABL1 on International Scale (IS) at 3, 6, 12 months (milestone: <=10% at 3m, <=1% at 6m, <=0.1% MMR at 12m)",
      "LFTs, creatinine, electrolytes"
    ],
    clearanceChecks: ["CBC/platelets", "liver", "renal"],
    doseModificationRules: [],
    drugs: [
      {
        id: "imatinib",
        name: "Imatinib",
        basis: "flat",
        dosePerUnit: 400,
        unit: "mg",
        route: "PO",
        days: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28],
        notes: "Imatinib 400 mg PO once daily continuously with a meal and water. May escalate to 600-800 mg daily for accelerated phase or inadequate molecular response."
      }
    ]
  },

  // 10. CML Dasatinib
  {
    id: "cml-dasatinib",
    diseaseId: "cml",
    name: "Dasatinib 100 mg (Chronic Myeloid Leukemia - Second-Generation TKI)",
    version: "1.0",
    lifecycleState: "draft",
    experimental: true,
    intentOptions: ["disease-control", "curative"],
    cycleLengthDays: 28,
    cycles: 12,
    caps: "drug",
    source: {
      nccn: "Standard Guidelines (NCCN), Chronic Myeloid Leukemia v1.2026"
    },
    stage: ["chronic-phase", "accelerated-phase", "blast-phase"],
    treatmentSetting: ["first-line", "second-line"],
    histology: "chronic myeloid leukemia (BCR::ABL1 positive)",
    premedications: [],
    supportiveCare: ["Monitor for pleural effusion, fluid retention, and pulmonary arterial hypertension"],
    monitoring: ["Chest X-ray for pleural effusion", "BCR::ABL1 RT-PCR q3m", "CBC, CMP"],
    clearanceChecks: ["CBC/platelets", "cardiac"],
    doseModificationRules: [],
    drugs: [
      {
        id: "dasatinib",
        name: "Dasatinib",
        basis: "flat",
        dosePerUnit: 100,
        unit: "mg",
        route: "PO",
        days: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28],
        notes: "Dasatinib 100 mg PO once daily continuously. For accelerated or blast phase, dose is 140 mg PO once daily."
      }
    ]
  },

  // 11. HCL Cladribine
  {
    id: "rare-hcl-cladribine",
    diseaseId: "hcl",
    name: "Cladribine (2-CdA) (Hairy Cell Leukemia)",
    version: "1.0",
    lifecycleState: "draft",
    experimental: true,
    intentOptions: ["curative"],
    cycleLengthDays: 28,
    cycles: 1,
    caps: "protocol",
    source: {
      nccn: "Standard Guidelines (NCCN), Hairy Cell Leukemia v1.2026"
    },
    stage: ["symptomatic"],
    treatmentSetting: ["first-line"],
    histology: "hairy cell leukemia",
    premedications: [{ name: "Allopurinol", dose: "300 mg PO daily", notes: "TLS prophylaxis" }],
    supportiveCare: [
      "PJP prophylaxis with Bactrim DS 3x/week for at least 6 months post-therapy",
      "Acyclovir 400 mg PO BID for VZV prophylaxis",
      "Irradiated blood products mandatory to prevent transfusion-associated GVHD"
    ],
    monitoring: ["CBC weekly", "CD4+ T-cell count recovery", "Renal and liver panels"],
    clearanceChecks: ["CBC/platelets", "renal"],
    doseModificationRules: [],
    drugs: [
      {
        id: "cladribine",
        name: "Cladribine",
        basis: "mgkg",
        dosePerUnit: 0.14,
        unit: "mg/kg",
        route: "IV",
        days: [1, 2, 3, 4, 5],
        notes: "Cladribine 0.14 mg/kg/day IV over 2 hours on Days 1-5 (single 5-day course yields >90% overall response and ~80% complete response)."
      }
    ]
  },

  // 12. DFSP Imatinib
  {
    id: "rare-dfsp-imatinib",
    diseaseId: "dfsp",
    name: "Imatinib 800 mg (Dermatofibrosarcoma Protuberans - COL1A1::PDGFB Targeted)",
    version: "1.0",
    lifecycleState: "draft",
    experimental: true,
    intentOptions: ["disease-control", "neoadjuvant"],
    cycleLengthDays: 28,
    cycles: 6,
    caps: "drug",
    source: {
      nccn: "Standard Guidelines (NCCN), Dermatofibrosarcoma Protuberans v1.2026"
    },
    stage: ["locally-advanced", "unresectable", "metastatic", "fibrosarcomatous"],
    treatmentSetting: ["neoadjuvant", "first-line"],
    histology: "dermatofibrosarcoma protuberans (DFSP / FS-DFSP)",
    premedications: [],
    supportiveCare: ["Administer with meals and plenty of water to prevent GI intolerance"],
    monitoring: ["CBC, CMP, LFTs monthly", "Tumor dimensional response by MRI/CT"],
    clearanceChecks: ["CBC/platelets", "liver"],
    doseModificationRules: [],
    drugs: [
      {
        id: "imatinib",
        name: "Imatinib",
        basis: "flat",
        dosePerUnit: 400,
        unit: "mg",
        route: "PO",
        days: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28],
        notes: "Imatinib 400 mg PO twice daily (total 800 mg/day) continuously for unresectable or metastatic DFSP harboring t(17;22) COL1A1::PDGFB fusion."
      }
    ]
  },

  // 13. Merkel Avelumab
  {
    id: "skin-merkel-avelumab",
    diseaseId: "merkel",
    name: "Avelumab Monotherapy (Metastatic / Locally Advanced Merkel Cell Carcinoma)",
    version: "1.0",
    lifecycleState: "draft",
    experimental: true,
    intentOptions: ["disease-control", "curative"],
    cycleLengthDays: 14,
    cycles: 12,
    caps: "protocol",
    source: {
      nccn: "Standard Guidelines (NCCN), Merkel Cell Carcinoma v1.2026"
    },
    stage: ["III", "IV", "metastatic"],
    treatmentSetting: ["first-line"],
    histology: "Merkel cell carcinoma (neuroendocrine carcinoma of skin)",
    premedications: [
      { name: "Diphenhydramine", dose: "25-50 mg IV/PO", notes: "Mandatory for first 4 infusions" },
      { name: "Acetaminophen", dose: "650 mg PO", notes: "Mandatory for first 4 infusions" }
    ],
    supportiveCare: ["Monitor for immune-related adverse events (colitis, pneumonitis, thyroid, hepatitis)"],
    monitoring: ["TSH, free T4, CMP, CBC every 2-4 weeks", "Tumor restaging CT/PET every 8-12 weeks"],
    clearanceChecks: ["CBC/platelets", "liver", "renal"],
    doseModificationRules: [],
    drugs: [
      {
        id: "avelumab",
        name: "Avelumab",
        basis: "flat",
        dosePerUnit: 800,
        unit: "mg",
        route: "IV",
        days: [1],
        notes: "Avelumab 800 mg IV over 60 minutes every 2 weeks until disease progression or unacceptable toxicity (JAVELIN Merkel 200 trial)."
      }
    ]
  },

  // 14. MPN Ruxolitinib
  {
    id: "heme-mpn-ruxolitinib",
    diseaseId: "mpn",
    name: "Ruxolitinib (JAK1/2 Inhibitor for Myelofibrosis / Polycythemia Vera)",
    version: "1.0",
    lifecycleState: "draft",
    experimental: true,
    intentOptions: ["disease-control", "symptom-relief"],
    cycleLengthDays: 28,
    cycles: 12,
    caps: "drug",
    source: {
      nccn: "Standard Guidelines (NCCN), Myeloproliferative Neoplasms v1.2026"
    },
    stage: ["intermediate-2", "high-risk", "hydroxyurea-resistant"],
    treatmentSetting: ["first-line", "second-line"],
    histology: "primary myelofibrosis / post-PV MF / post-ET MF / polycythemia vera",
    premedications: [],
    supportiveCare: ["Monitor and manage dose-dependent thrombocytopenia and anemia", "Screen for latent tuberculosis and viral hepatitis prior to initiation"],
    monitoring: ["CBC with differential every 2-4 weeks until stable, then monthly", "Spleen size palpation and MPN-SAF symptom score assessment"],
    clearanceChecks: ["Platelets >= 50,000/mcL"],
    doseModificationRules: [],
    drugs: [
      {
        id: "ruxolitinib",
        name: "Ruxolitinib",
        basis: "flat",
        dosePerUnit: 20,
        unit: "mg",
        route: "PO",
        days: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28],
        notes: "Ruxolitinib 20 mg PO twice daily (if baseline platelets > 200k/mcL) or 15 mg PO twice daily (platelets 100-200k) or 5 mg BID (platelets 50-100k)."
      }
    ]
  },

  // 15. Adult ALL Hyper-CVAD
  {
    id: "all-hypercvad",
    diseaseId: "all",
    name: "Hyper-CVAD (Part A): Cyclophosphamide + Vincristine + DOXOrubicin + Dexamethasone",
    version: "1.0",
    lifecycleState: "draft",
    experimental: true,
    intentOptions: ["curative"],
    cycleLengthDays: 21,
    cycles: 8,
    caps: "protocol",
    source: {
      nccn: "Standard Guidelines (NCCN), Adult ALL v1.2026"
    },
    stage: ["Ph-negative", "Ph-positive", "induction"],
    treatmentSetting: ["induction", "consolidation"],
    histology: "B-ALL or T-ALL",
    premedications: [
      { name: "Ondansetron", dose: "16 mg IV", notes: "Prior to chemotherapy" },
      { name: "Mesna", dose: "600 mg/m2/day continuous IV on days 1-3", notes: "Uroprotection during cyclophosphamide" }
    ],
    supportiveCare: [
      "Mandatory TLS prophylaxis with hydration and rasburicase or allopurinol",
      "PJP and fungal prophylaxis with posaconazole / voriconazole",
      "Filgrastim (G-CSF) 5 mcg/kg/day SC starting Day 5 until ANC recovery"
    ],
    monitoring: ["CBC with diff daily during inpatient admission", "CMP, electrolytes, uric acid, phosphorus q12-24h during induction"],
    clearanceChecks: ["CBC/platelets", "renal", "cardiac"],
    doseModificationRules: [],
    drugs: [
      {
        id: "cyclophosphamide",
        name: "Cyclophosphamide",
        basis: "bsa",
        dosePerUnit: 300,
        unit: "mg/m2",
        route: "IV",
        days: [1, 2, 3],
        notes: "Cyclophosphamide 300 mg/m2 IV q12h x 6 doses (Days 1-3) with continuous Mesna."
      },
      {
        id: "vincristine",
        name: "vinCRIStine",
        basis: "bsa",
        dosePerUnit: 2,
        unit: "mg",
        route: "IV",
        days: [4, 11],
        caps: { perDose: 2 },
        notes: "vinCRIStine 2 mg flat IV push on Days 4 and 11. Fatal if given intrathecally. IV only."
      },
      {
        id: "doxorubicin",
        name: "DOXOrubicin",
        basis: "bsa",
        dosePerUnit: 50,
        unit: "mg/m2",
        route: "IV",
        days: [4],
        caps: { cumulativeLifetime: { warn: 450, hard: 550, unit: "mg/m2" } },
        notes: "DOXOrubicin 50 mg/m2 IV over 24 hours on Day 4."
      },
      {
        id: "dexamethasone",
        name: "Dexamethasone",
        basis: "flat",
        dosePerUnit: 40,
        unit: "mg",
        route: "PO",
        days: [1, 2, 3, 4, 11, 12, 13, 14],
        notes: "Dexamethasone 40 mg PO or IV once daily on Days 1-4 and Days 11-14."
      }
    ]
  },

  // 16. Occult Primary Carbo-Paclitaxel
  {
    id: "rare-occult-carbo-paclitaxel",
    diseaseId: "occult_primary",
    name: "Empiric Carboplatin + Paclitaxel (Carcinoma of Unknown Primary - CUP)",
    version: "1.0",
    lifecycleState: "draft",
    experimental: true,
    intentOptions: ["palliative", "curative"],
    cycleLengthDays: 21,
    cycles: 6,
    caps: "protocol",
    source: {
      nccn: "Standard Guidelines (NCCN), Occult Primary (CUP) v1.2026"
    },
    stage: ["disseminated"],
    treatmentSetting: ["first-line", "empiric"],
    histology: "adenocarcinoma or poorly differentiated carcinoma of unknown primary",
    premedications: [
      { name: "Dexamethasone", dose: "20 mg PO", notes: "12 and 6 hours prior to paclitaxel" },
      { name: "Diphenhydramine", dose: "50 mg IV", notes: "30 min prior to paclitaxel" },
      { name: "Famotidine", dose: "20 mg IV", notes: "30 min prior to paclitaxel" }
    ],
    supportiveCare: ["Antiemetics with 5-HT3 antagonist", "Monitor for peripheral neuropathy and taxane hypersensitivity"],
    monitoring: ["CBC with differential prior to each cycle", "CMP, liver enzymes, creatinine"],
    clearanceChecks: ["ANC >= 1500/mcL, Platelets >= 100,000/mcL", "Renal function for carboplatin Calvert AUC"],
    doseModificationRules: [],
    drugs: [
      {
        id: "paclitaxel",
        name: "PACLitaxel",
        basis: "bsa",
        dosePerUnit: 175,
        unit: "mg/m2",
        route: "IV",
        days: [1],
        notes: "PACLitaxel 175 mg/m2 IV over 3 hours on Day 1."
      },
      {
        id: "carboplatin",
        name: "Carboplatin",
        basis: "auc",
        dosePerUnit: 5,
        unit: "AUC",
        route: "IV",
        days: [1],
        notes: "Carboplatin AUC 5 IV over 30-60 minutes on Day 1 (Calvert formula CrCl)."
      }
    ]
  },

  // 17. Pediatric ALL Induction
  {
    id: "ped-all-induction",
    diseaseId: "pediatric_all",
    name: "COG 4-Drug Induction (Pediatric High-Risk ALL)",
    version: "1.0",
    lifecycleState: "draft",
    experimental: true,
    intentOptions: ["curative"],
    cycleLengthDays: 28,
    cycles: 1,
    caps: "protocol",
    source: {
      nccn: "Standard Guidelines (NCCN), Pediatric ALL v1.2026"
    },
    stage: ["high-risk", "standard-risk"],
    treatmentSetting: ["induction"],
    histology: "precursor B-cell or T-cell lymphoblastic leukemia",
    premedications: [{ name: "Ondansetron", dose: "0.15 mg/kg IV", notes: "Prior to chemotherapy" }],
    supportiveCare: [
      "TLS prophylaxis with allopurinol/rasburicase and pre-hydration",
      "Intrathecal methotrexate for CNS prophylaxis on Days 1 and 8"
    ],
    monitoring: ["CBC daily during induction", "End-of-induction bone marrow aspirate for MRD assessment at Day 29"],
    clearanceChecks: ["CBC/platelets", "liver", "renal"],
    doseModificationRules: [],
    drugs: [
      {
        id: "vincristine",
        name: "vinCRIStine",
        basis: "bsa",
        dosePerUnit: 1.5,
        unit: "mg/m2",
        route: "IV",
        days: [1, 8, 15, 22],
        caps: { perDose: 2 },
        notes: "vinCRIStine 1.5 mg/m2 (cap 2 mg) IV push weekly on Days 1, 8, 15, 22. Fatal if given intrathecally. IV only."
      },
      {
        id: "dexamethasone",
        name: "Dexamethasone",
        basis: "bsa",
        dosePerUnit: 6,
        unit: "mg/m2",
        route: "PO",
        days: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28],
        notes: "Dexamethasone 6 mg/m2/day PO divided TID on Days 1-28."
      },
      {
        id: "pegaspargase",
        name: "Pegaspargase",
        basis: "bsa",
        dosePerUnit: 2500,
        unit: "IU/m2",
        route: "IM",
        days: [4],
        notes: "Pegaspargase 2500 IU/m2 IM/IV on Day 4."
      },
      {
        id: "daunorubicin",
        name: "DAUNOrubicin",
        basis: "bsa",
        dosePerUnit: 25,
        unit: "mg/m2",
        route: "IV",
        days: [1, 8, 15, 22],
        notes: "DAUNOrubicin 25 mg/m2 IV over 15-30 minutes weekly on Days 1, 8, 15, 22 (for high-risk ALL)."
      }
    ]
  },

  // 18. Pediatric B-Cell Lymphoma COPADM
  {
    id: "ped-lymphoma-copadm",
    diseaseId: "pediatric_lymphoma",
    name: "LMB96 Group B: Rituximab + COPADM (Pediatric Burkitt / DLBCL)",
    version: "1.0",
    lifecycleState: "draft",
    experimental: true,
    intentOptions: ["curative"],
    cycleLengthDays: 21,
    cycles: 4,
    caps: "protocol",
    source: {
      nccn: "Standard Guidelines (NCCN), Pediatric B-Cell Lymphoma v1.2026"
    },
    stage: ["Group B", "III", "IV"],
    treatmentSetting: ["induction", "consolidation"],
    histology: "Burkitt lymphoma / Diffuse large B-cell lymphoma",
    premedications: [{ name: "Ondansetron", dose: "0.15 mg/kg IV", notes: "Prior to chemotherapy" }],
    supportiveCare: ["Intensive TLS management", "Leucovorin rescue starting 24h after methotrexate"],
    monitoring: ["CBC, CMP, Methotrexate clearance levels"],
    clearanceChecks: ["CBC/platelets", "renal"],
    doseModificationRules: [],
    drugs: [
      {
        id: "rituximab",
        name: "Rituximab",
        basis: "bsa",
        dosePerUnit: 375,
        unit: "mg/m2",
        route: "IV",
        days: [1],
        notes: "Rituximab 375 mg/m2 IV Day 1."
      },
      {
        id: "vincristine",
        name: "vinCRIStine",
        basis: "bsa",
        dosePerUnit: 2,
        unit: "mg/m2",
        route: "IV",
        days: [1],
        caps: { perDose: 2 },
        notes: "vinCRIStine 2 mg/m2 (cap 2 mg) IV push on Day 1. IV only."
      },
      {
        id: "methotrexate",
        name: "Methotrexate (Intermediate-Dose)",
        basis: "bsa",
        dosePerUnit: 3000,
        unit: "mg/m2",
        route: "IV",
        days: [1],
        notes: "Methotrexate 3 g/m2 IV over 4 hours with alkalinized hydration and leucovorin rescue."
      },
      {
        id: "cyclophosphamide",
        name: "Cyclophosphamide",
        basis: "bsa",
        dosePerUnit: 500,
        unit: "mg/m2",
        route: "IV",
        days: [2, 3, 4],
        notes: "Cyclophosphamide 500 mg/m2/day IV with Mesna on Days 2-4."
      },
      {
        id: "doxorubicin",
        name: "DOXOrubicin",
        basis: "bsa",
        dosePerUnit: 60,
        unit: "mg/m2",
        route: "IV",
        days: [2],
        caps: { cumulativeLifetime: { warn: 250, hard: 350, unit: "mg/m2" } },
        notes: "DOXOrubicin 60 mg/m2 IV on Day 2."
      }
    ]
  },

  // 19. Pediatric CNS Medulloblastoma
  {
    id: "ped-cns-medulloblastoma",
    diseaseId: "pediatric_cns",
    name: "Adjuvant Pack: Cisplatin + Lomustine (CCNU) + Vincristine (Pediatric Medulloblastoma)",
    version: "1.0",
    lifecycleState: "draft",
    experimental: true,
    intentOptions: ["curative"],
    cycleLengthDays: 42,
    cycles: 8,
    caps: "protocol",
    source: {
      nccn: "Standard Guidelines (NCCN), Pediatric CNS Tumors v1.2026"
    },
    stage: ["average-risk", "high-risk"],
    treatmentSetting: ["adjuvant-post-csi"],
    histology: "medulloblastoma (classic, desmoplastic, or large cell/anaplastic)",
    premedications: [{ name: "Ondansetron", dose: "0.15 mg/kg IV", notes: "Prior to cisplatin" }],
    supportiveCare: ["Pre- and post-hydration with mannitol/furosemide as needed", "Audiometry monitoring for cisplatin"],
    monitoring: ["CBC with differential weekly (CCNU has delayed 4-6 week platelet/WBC nadir)", "BUN/creatinine, electrolytes"],
    clearanceChecks: ["ANC >= 1500/mcL, Platelets >= 100,000/mcL", "Renal function normal for age"],
    doseModificationRules: [],
    drugs: [
      {
        id: "cisplatin",
        name: "CISplatin",
        basis: "bsa",
        dosePerUnit: 75,
        unit: "mg/m2",
        route: "IV",
        days: [1],
        notes: "CISplatin 75 mg/m2 IV over 6 hours with vigorous hydration on Day 1."
      },
      {
        id: "lomustine",
        name: "Lomustine (CCNU)",
        basis: "bsa",
        dosePerUnit: 75,
        unit: "mg/m2",
        route: "PO",
        days: [1],
        notes: "Lomustine 75 mg/m2 PO once on Day 1 at bedtime (delayed myelosuppression nadir at week 4-5)."
      },
      {
        id: "vincristine",
        name: "vinCRIStine",
        basis: "bsa",
        dosePerUnit: 1.5,
        unit: "mg/m2",
        route: "IV",
        days: [1, 8, 15],
        caps: { perDose: 2 },
        notes: "vinCRIStine 1.5 mg/m2 (cap 2 mg) IV push on Days 1, 8, 15. Fatal if given intrathecally. IV only."
      }
    ]
  }
];

console.log(`Writing ${newProtocols.length} standard protocols to kb/protocols/...`);
for (const p of newProtocols) {
  const target = path.join(protoDir, `${p.id}.json`);
  fs.writeFileSync(target, JSON.stringify(p, null, 2), "utf8");
  console.log(`  ✓ ${p.id}.json written`);
}
console.log("All protocols written successfully!");
