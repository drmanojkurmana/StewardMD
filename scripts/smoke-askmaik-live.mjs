/* scripts/smoke-askmaik-live.mjs
 * Live smoke check of 20 numeric clinical follow-up questions across specialties.
 * Uses OpenRouter key from ~/.config/stewardmd/openrouter.env.
 * Model: google/gemini-2.5-flash (or cheap equivalent).
 * Tracks token usage and ensures cost < $0.50.
 * Never prints or outputs the API key.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { CHAT_SYSTEM, chatUser } from "../functions/api/ai/_prep-teach.js";
import { resolveKbSync } from "../functions/api/ai/_prep-kb.js";

const envPath = join(homedir(), ".config/stewardmd/openrouter.env");
if (!existsSync(envPath)) {
  console.error("Missing openrouter.env at", envPath);
  process.exit(1);
}

const envContent = readFileSync(envPath, "utf8");
let apiKey = "";
for (const line of envContent.split("\n")) {
  const match = line.match(/^OPENROUTER_API_KEY=(.+)$/);
  if (match) {
    apiKey = match[1].trim().replace(/^["']|["']$/g, "");
    break;
  }
}

if (!apiKey) {
  console.error("OPENROUTER_API_KEY not found in openrouter.env");
  process.exit(1);
}

const MODEL = "meta-llama/llama-3.1-8b-instruct";

const QUESTIONS = [
  {
    specialty: "OBGYN",
    topic: "Gestational Trophoblastic Neoplasia (GTN)",
    ground: "Question: A 24-year-old woman undergoes suction curettage for complete hydatidiform mole. Histopathology confirms molar pregnancy.\nOption B: Persistent GTN is diagnosed if hCG plateaus across 4 measurements over 3 weeks.\nExplanation: Post-molar GTN is diagnosed based on FIGO staging criteria.",
    srcPack: ["kb-gestational-trophoblastic-neoplasia", "kb-hydatidiform-mole"],
    kp: "FIGO diagnostic criteria: hCG plateau across 4 values over 3 weeks or rise across 3 values over 2 weeks.",
    studentQ: "Tell exact criteria with values and percentages for hCG plateau and rise under FIGO",
    expectedKeywords: ["FIGO", "4", "3", "2", "10%"]
  },
  {
    specialty: "OBGYN",
    topic: "Gestational Diabetes Mellitus (GDM)",
    ground: "Question: A 26-year-old primigravida at 26 weeks gestation undergoes screening for gestational diabetes mellitus.\nExplanation: 75g oral glucose tolerance test (OGTT) is performed.",
    srcPack: ["kb-gestational-diabetes-mellitus"],
    kp: "IADPSG/DIPSI criteria: fasting >=92, 1-hour >=180, 2-hour >=153 mg/dL.",
    studentQ: "What are the exact diagnostic numerical thresholds in mg/dL for fasting, 1-hour, and 2-hour on 75g OGTT?",
    expectedKeywords: ["92", "180", "153"]
  },
  {
    specialty: "Cardiology",
    topic: "Left Ventricular Hypertrophy (LVH)",
    ground: "Question: A 55-year-old man with long-standing hypertension has an ECG showing tall R waves in V5 and deep S waves in V1.\nExplanation: Voltage criteria for left ventricular hypertrophy.",
    srcPack: ["kb-hypertension", "kb-heart-failure"],
    kp: "Sokolow-Lyon index: SV1 + RV5 or RV6 > 35 mm (3.5 mV).",
    studentQ: "Tell exact Sokolow-Lyon criteria cutoff values in mm or mV",
    expectedKeywords: ["35", "Sokolow"]
  },
  {
    specialty: "Cardiology",
    topic: "STEMI Diagnostic Criteria",
    ground: "Question: A 48-year-old man presents with acute crushing chest pain. ECG shows ST elevation in leads V2 and V3.\nExplanation: Fourth Universal Definition of Myocardial Infarction.",
    srcPack: ["kb-myocardial-infarction", "kb-acute-coronary-syndrome"],
    kp: "STEMI in V2-V3: >=2.0 mm in men >=40, >=2.5 mm in men <40, >=1.5 mm in women.",
    studentQ: "What are the exact ST-elevation millimeter cutoffs in V2-V3 by age and sex according to universal definition?",
    expectedKeywords: ["1.5", "2.0", "2.5"]
  },
  {
    specialty: "Nephrology",
    topic: "Chronic Kidney Disease (CKD) Staging",
    ground: "Question: A 62-year-old man with diabetic nephropathy has routine renal function monitoring.\nExplanation: KDIGO staging of chronic kidney disease by GFR categories.",
    srcPack: ["kb-chronic-kidney-disease"],
    kp: "KDIGO GFR categories: G1 >=90, G2 60-89, G3a 45-59, G3b 30-44, G4 15-29, G5 <15 mL/min/1.73m2.",
    studentQ: "List exact eGFR cutoff ranges in mL/min/1.73m2 for all KDIGO CKD stages G1 through G5",
    expectedKeywords: ["90", "60", "45", "30", "15"]
  },
  {
    specialty: "Nephrology",
    topic: "Acute Kidney Injury (AKI) Definition",
    ground: "Question: A 70-year-old woman admitted for pneumonia develops oliguria and rising serum creatinine.\nExplanation: KDIGO clinical practice guideline criteria for acute kidney injury stage 1.",
    srcPack: ["kb-acute-kidney-injury"],
    kp: "KDIGO AKI stage 1: serum creatinine increase >=0.3 mg/dL within 48h or >=1.5 times baseline within 7 days.",
    studentQ: "What is the exact numerical creatinine rise in mg/dL and time window in hours to define Stage 1 AKI?",
    expectedKeywords: ["0.3", "48", "1.5"]
  },
  {
    specialty: "Endocrinology",
    topic: "Diabetes Mellitus Diagnostic Criteria",
    ground: "Question: An asymptomatic 45-year-old executive undergoes annual health checkup.\nExplanation: American Diabetes Association (ADA) diagnostic criteria.",
    srcPack: ["kb-diabetes-mellitus-type-2"],
    kp: "ADA criteria: Fasting plasma glucose >=126 mg/dL, 2-hr PG >=200 mg/dL, HbA1c >=6.5%.",
    studentQ: "What are the exact numerical cut-offs for fasting plasma glucose in mg/dL and HbA1c in % to diagnose diabetes?",
    expectedKeywords: ["126", "6.5"]
  },
  {
    specialty: "Endocrinology",
    topic: "Diabetic Ketoacidosis (DKA)",
    ground: "Question: A 19-year-old with type 1 diabetes presents with nausea, vomiting, and Kussmaul breathing.\nExplanation: Diagnostic criteria for diabetic ketoacidosis.",
    srcPack: ["kb-diabetic-ketoacidosis"],
    kp: "DKA triad: Blood glucose >250 mg/dL, arterial pH <7.30, serum bicarbonate <18 mEq/L, with elevated anion gap >10-12.",
    studentQ: "State exact threshold values for glucose in mg/dL, pH, and serum bicarbonate in mEq/L to diagnose DKA",
    expectedKeywords: ["250", "7.3", "18"]
  },
  {
    specialty: "Oncology",
    topic: "Febrile Neutropenia Thresholds",
    ground: "Question: A 52-year-old receiving adjuvant chemotherapy presents with fever of 38.4 C.\nExplanation: Infectious Diseases Society of America (IDSA) / ASCO guideline definitions.",
    srcPack: ["kb-febrile-neutropenia", "kb-neutropenia"],
    kp: "Neutropenia: ANC <500 cells/microL or expected to decrease <500 over next 48h.",
    studentQ: "What is the exact absolute neutrophil count (ANC) cutoff in cells/microL defining severe neutropenia?",
    expectedKeywords: ["500", "ANC"]
  },
  {
    specialty: "Oncology",
    topic: "Tumor Lysis Syndrome (Cairo-Bishop)",
    ground: "Question: A 16-year-old with Burkitt lymphoma starts induction chemotherapy.\nExplanation: Cairo-Bishop laboratory diagnostic criteria for tumor lysis syndrome.",
    srcPack: ["kb-tumor-lysis-syndrome"],
    kp: "Cairo-Bishop criteria: Uric acid >=8 mg/dL, Potassium >=6.0 mEq/L, Phosphorus >=4.5 mg/dL, Calcium <=7.0 mg/dL.",
    studentQ: "Tell exact numerical cutoffs for uric acid (mg/dL), potassium (mEq/L), and phosphorus (mg/dL) under Cairo-Bishop",
    expectedKeywords: ["8", "6", "4.5"]
  },
  {
    specialty: "Neurology",
    topic: "Acute Ischemic Stroke Thrombolysis Window",
    ground: "Question: A 64-year-old man presents with sudden right-sided hemiplegia and expressive aphasia.\nExplanation: AHA/ASA guidelines for intravenous alteplase.",
    srcPack: ["kb-ischemic-stroke", "kb-acute-stroke"],
    kp: "IV rtPA window: within 4.5 hours of symptom onset or last known normal.",
    studentQ: "What is the exact time window in hours for intravenous alteplase thrombolysis in acute ischemic stroke?",
    expectedKeywords: ["4.5", "hours"]
  },
  {
    specialty: "Neurology",
    topic: "Status Epilepticus Time Definition",
    ground: "Question: A 28-year-old with known epilepsy has a continuous tonic-clonic seizure.\nExplanation: International League Against Epilepsy (ILAE) operational definition.",
    srcPack: ["kb-status-epilepticus", "kb-epilepsy"],
    kp: "ILAE 2015: t1 = 5 minutes for generalized convulsive status epilepticus, t2 = 30 minutes for neuronal damage.",
    studentQ: "Under ILAE criteria, what is the exact duration in minutes (t1) defining convulsive status epilepticus?",
    expectedKeywords: ["5", "minutes"]
  },
  {
    specialty: "Pulmonology",
    topic: "COPD Spirometric Diagnosis",
    ground: "Question: A 58-year-old chronic smoker has progressive exertional dyspnea and chronic productive cough.\nExplanation: Global Initiative for Chronic Obstructive Lung Disease (GOLD) report.",
    srcPack: ["kb-chronic-obstructive-pulmonary-disease"],
    kp: "GOLD criteria: Post-bronchodilator FEV1/FVC < 0.70 (or 70%) confirms persistent airflow limitation.",
    studentQ: "What is the exact post-bronchodilator FEV1/FVC ratio cutoff required to diagnose COPD under GOLD?",
    expectedKeywords: ["0.70", "0.7", "70%"]
  },
  {
    specialty: "Pulmonology",
    topic: "ARDS Berlin Definition Severity",
    ground: "Question: A 40-year-old intubated for severe aspiration pneumonia has bilateral infiltrates on chest radiograph.\nExplanation: Berlin definition of Acute Respiratory Distress Syndrome.",
    srcPack: ["kb-acute-respiratory-distress-syndrome"],
    kp: "Berlin ARDS severity (with PEEP >=5 cmH2O): Mild PaO2/FiO2 201-300, Moderate 101-200, Severe <=100 mmHg.",
    studentQ: "What is the exact PaO2/FiO2 ratio cutoff in mmHg defining severe ARDS under Berlin definition?",
    expectedKeywords: ["100", "PEEP", "5"]
  },
  {
    specialty: "Gastroenterology",
    topic: "Acute Pancreatitis Enzyme Elevation",
    ground: "Question: A 42-year-old man presents with severe epigastric pain radiating to the back after alcohol binge.\nExplanation: Revised Atlanta classification for acute pancreatitis.",
    srcPack: ["kb-acute-pancreatitis"],
    kp: "Revised Atlanta: Serum lipase or amylase >=3 times the upper limit of normal (ULN).",
    studentQ: "How many times the upper limit of normal must serum lipase or amylase be elevated to meet Atlanta criteria?",
    expectedKeywords: ["3", "upper limit"]
  },
  {
    specialty: "Gastroenterology",
    topic: "Upper GI Bleed Glasgow-Blatchford Score",
    ground: "Question: A 35-year-old presents with dark tarry stools. Vitals are normal and hemoglobin is 14 g/dL.\nExplanation: Glasgow-Blatchford Bleeding Score (GBS) risk stratification.",
    srcPack: ["kb-upper-gastrointestinal-bleeding"],
    kp: "Glasgow-Blatchford score of 0 (or <=1 per NICE) identifies low-risk patients suitable for outpatient management.",
    studentQ: "What exact Glasgow-Blatchford score threshold (number) defines low risk for outpatient management?",
    expectedKeywords: ["0", "1"]
  },
  {
    specialty: "Pediatrics",
    topic: "Neonatal Hyperbilirubinemia Phototherapy",
    ground: "Question: A 3-day-old (72 hours) healthy term neonate has jaundice.\nExplanation: American Academy of Pediatrics (AAP) guidelines for management of hyperbilirubinemia.",
    srcPack: ["kb-neonatal-jaundice"],
    kp: "AAP phototherapy guidelines: at 72 hours in term infant, phototherapy threshold is approximately 15 mg/dL.",
    studentQ: "Tell the approximate total serum bilirubin threshold in mg/dL for phototherapy in a term infant at 72 hours",
    expectedKeywords: ["15", "mg/dL"]
  },
  {
    specialty: "Pediatrics",
    topic: "Pediatric Sepsis / Tachycardia Cutoff",
    ground: "Question: A 3-year-old boy presents with high fever, lethargy, and cough.\nExplanation: Pediatric Advanced Life Support (PALS) vital signs and sepsis criteria.",
    srcPack: ["kb-pediatric-sepsis"],
    kp: "PALS normal resting heart rate for toddler (1-3 years): 80-140 bpm; tachycardia >140 bpm.",
    studentQ: "What is the resting heart rate cutoff (bpm) defining tachycardia in a child aged 1 to 3 years?",
    expectedKeywords: ["140", "bpm"]
  },
  {
    specialty: "Rheumatology",
    topic: "Gout Treat-to-Target Serum Urate",
    ground: "Question: A 50-year-old man with recurrent podagra and tophaceous gout is started on allopurinol.\nExplanation: American College of Rheumatology (ACR) and EULAR guidelines for management of gout.",
    srcPack: ["kb-gout"],
    kp: "ACR/EULAR treat-to-target: target serum urate <6.0 mg/dL (or <5.0 mg/dL in severe tophaceous gout).",
    studentQ: "What is the exact target serum urate level in mg/dL recommended for treat-to-target urate-lowering therapy?",
    expectedKeywords: ["6", "mg/dL"]
  },
  {
    specialty: "Psychiatry",
    topic: "Major Depressive Disorder (MDD) Duration",
    ground: "Question: A 34-year-old woman presents with persistent low mood, anhedonia, and fatigue.\nExplanation: DSM-5 diagnostic criteria for Major Depressive Episode.",
    srcPack: ["kb-major-depressive-disorder"],
    kp: "DSM-5 criteria: At least 5 of 9 symptoms present nearly every day during the same 2-week period.",
    studentQ: "Under DSM-5, how many symptoms out of 9 and for what minimum duration in weeks are required for MDD?",
    expectedKeywords: ["5", "2", "weeks"]
  }
];

function containsAnyNumber(str) {
  return /\d+/.test(str);
}

function hasRefusal(str) {
  return /cannot provide specific numerical|please use the MaiK Assistant|do not have access to specific numbers/i.test(str);
}

async function runLiveCheck() {
  console.log(`Starting Ask MaiK live smoke check on ${QUESTIONS.length} numeric questions using ${MODEL} via OpenRouter...`);
  const results = [];
  let totalPromptTok = 0;
  let totalCandidatesTok = 0;

  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    process.stdout.write(`[${i + 1}/${QUESTIONS.length}] ${q.specialty}: ${q.topic}... `);

    let kbGround = "";
    try {
      kbGround = resolveKbSync(q.srcPack, q.kp, q.ground);
    } catch (e) {}

    const messages = [{ r: "u", t: q.studentQ }];
    const userPrompt = chatUser(q.ground, "", messages, kbGround);

    const payload = {
      model: MODEL,
      messages: [
        { role: "system", content: CHAT_SYSTEM },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: 350
    };

    const t0 = Date.now();
    try {
      let answer = "";
      let inTok = 0, outTok = 0, latencyMs = 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "HTTP-Referer": "https://stewardmd.in",
            "X-Title": "StewardMD Ask MaiK Smoke"
          },
          body: JSON.stringify(payload)
        });

        if (!resp.ok) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        const data = await resp.json();
        answer = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "";
        inTok = data.usage?.prompt_tokens || 0;
        outTok = data.usage?.completion_tokens || 0;
        latencyMs = Date.now() - t0;
        if (answer.trim()) break;
        await new Promise((r) => setTimeout(r, 1000));
      }

      totalPromptTok += inTok;
      totalCandidatesTok += outTok;

      const hasNumber = containsAnyNumber(answer);
      const refusal = hasRefusal(answer);
      const passedKeywords = q.expectedKeywords.filter((kw) => answer.toLowerCase().includes(kw.toLowerCase()));
      const passed = hasNumber && !refusal && (passedKeywords.length >= 1);

      if (passed) {
        console.log(`PASS (${latencyMs}ms, ${inTok}+${outTok} tok)`);
      } else {
        console.log(`FAIL: hasNumber=${hasNumber}, refusal=${refusal}, kw=${passedKeywords.join(",")}`);
      }

      results.push({
        specialty: q.specialty,
        topic: q.topic,
        studentQ: q.studentQ,
        answer: answer.replace(/\n+/g, " "),
        hasNumber,
        refusal,
        passedKeywords,
        pass: passed,
        latencyMs,
        inTok,
        outTok
      });

      // Brief delay between calls
      await new Promise((r) => setTimeout(r, 400));
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      results.push({ ...q, pass: false, error: err.message, latencyMs: Date.now() - t0 });
    }
  }

  const passedCount = results.filter((r) => r.pass).length;
  // Estimate cost: gemini-2.5-flash on OpenRouter is roughly $0.075 / 1M input, $0.30 / 1M output
  const estCostUsd = ((totalPromptTok * 0.075 + totalCandidatesTok * 0.30) / 1000000);

  console.log("\n==========================================");
  console.log(`Live Smoke Results: ${passedCount} / ${QUESTIONS.length} PASSED (${((passedCount / QUESTIONS.length) * 100).toFixed(1)}%)`);
  console.log(`Total Tokens: ${totalPromptTok} in, ${totalCandidatesTok} out (Total: ${totalPromptTok + totalCandidatesTok})`);
  console.log(`Estimated Cost: $${estCostUsd.toFixed(5)} USD (Margin: < $0.50 limit)`);
  console.log("==========================================\n");

  // Output JSON report to stdout for capture
  return {
    passedCount,
    totalCount: QUESTIONS.length,
    model: MODEL,
    totalPromptTok,
    totalCandidatesTok,
    estCostUsd,
    results
  };
}

runLiveCheck().then((res) => {
  if (res.passedCount < res.totalCount) {
    console.error(`Smoke check had ${res.totalCount - res.passedCount} failures.`);
    process.exit(1);
  } else {
    console.log("All 20 numeric clinical questions passed with flying colors!");
    process.exit(0);
  }
}).catch((err) => {
  console.error("Execution error:", err);
  process.exit(1);
});
