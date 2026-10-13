/**
 * Wave 4B Surgical Lessons: Part 1 (Modules 1-10)
 */

export const wave4bLessonsPart1 = [
  {
    "module": "sur-urolithiasis",
    "subject": "surgery",
    "title": "Urolithiasis, acute renal colic, endourological procedures, and staghorn calculi",
    "minutes": 6,
    "refs": [
      "Sabiston Textbook of Surgery 22nd ed",
      "Campbell-Walsh Urology 12th ed"
    ],
    "steps": [
      {
        "tx": "Renal **calculi** represent a frequent urological presentation affecting approximately ten percent of the adult population. Calcium oxalate stones comprise seventy-five percent of cases, followed by calcium phosphate, uric acid, and struvite. Uric acid stones are radiolucent on conventional radiography but visible on computed tomography. Struvite stones form in alkaline urine secondary to infection with urease-producing organisms such as Proteus mirabilis, often expanding into branched staghorn shapes.",
        "say": "Renal calculi affect ten percent of adults. Calcium oxalate represents seventy-five percent of stones, while uric acid and struvite comprise the remainder. Struvite stones form in alkaline urine from urease-producing bacteria and can produce staghorn configurations.",
        "vis": {
          "kind": "table",
          "cols": [
            "Stone composition",
            "Radiographic density",
            "Urinary pH profile"
          ],
          "rows": [
            [
              "Calcium oxalate",
              "Opaque on radiography",
              "Variable urine pH"
            ],
            [
              "Uric acid",
              "Radiolucent on X-ray",
              "Acidic urine pH < 5.5"
            ],
            [
              "Struvite triple phosphate",
              "Faintly opaque / staghorn",
              "Alkaline urine pH > 7.2"
            ],
            [
              "Cystine",
              "Faintly radiopaque",
              "Acidic urine pH"
            ]
          ]
        }
      },
      {
        "tx": "Acute renal colic classically manifests as sudden, severe unilateral flank **pain** that radiates anteriorly toward the ipsilateral groin and genitalia. Patients typically writhe in discomfort, unlike peritonitis patients who remain motionless. Non-contrast helical computed tomography of the kidneys, ureters, and bladder represents the definitive diagnostic gold standard. It detects all stone varieties with high sensitivity, measuring stone dimensions, location, and Hounsfield unit density.",
        "say": "Acute renal colic produces severe flank pain radiating toward the groin. Non-contrast helical CT scan of the abdomen and pelvis is the gold standard diagnostic test, accurately determining stone size, location, and density.",
        "vis": {
          "kind": "flow",
          "nodes": [
            {
              "id": "n1",
              "label": "Acute severe flank colic"
            },
            {
              "id": "n2",
              "label": "Non-contrast helical CT scan"
            },
            {
              "id": "n3",
              "label": "Assess size, density & location"
            },
            {
              "id": "n4",
              "label": "Decompress or elective intervention"
            }
          ],
          "edges": [
            [
              "n1",
              "n2"
            ],
            [
              "n2",
              "n3"
            ],
            [
              "n3",
              "n4"
            ]
          ]
        }
      },
      {
        "tx": "Ureteral calculi smaller than five millimeters possess a seventy-five percent likelihood of spontaneous **passage** under conservative medical expulsive therapy utilizing alpha-1 adrenergic antagonists such as tamsulosin. Urgent surgical decompression with a ureteral stent or percutaneous nephrostomy is mandated when obstruction coincides with clinical infection or septic shock. Extracorporeal shock wave lithotripsy and ureteroscopy remain primary treatments for renal stones under twenty millimeters, while larger staghorn calculi necessitate percutaneous nephrolithotomy.",
        "say": "Distal ureteral stones under five millimeters frequently pass spontaneously with tamsulosin medical expulsive therapy. Obstructing stones with fever or sepsis require immediate urgent decompression with a retrograde stent or percutaneous nephrostomy. Larger stones require ureteroscopy or percutaneous nephrolithotomy.",
        "vis": {
          "kind": "table",
          "cols": [
            "Stone dimension & site",
            "Clinical indication",
            "Recommended procedure"
          ],
          "rows": [
            [
              "Ureteral stone < 5 mm",
              "Uncomplicated colic",
              "Medical expulsive therapy"
            ],
            [
              "Obstructing stone with fever",
              "Urosepsis emergency",
              "Immediate stent or nephrostomy"
            ],
            [
              "Renal stone < 20 mm",
              "Symptomatic calculus",
              "Shock wave lithotripsy or RIRS"
            ],
            [
              "Staghorn calculus > 20 mm",
              "Complex pelvic stone",
              "Percutaneous nephrolithotomy"
            ]
          ]
        }
      },
      {
        "tx": "Recurrent stone formers require comprehensive metabolic **evaluation** including serum calcium, phosphate, intact parathyroid hormone, and 24-hour urine collections for calcium, oxalate, citrate, and uric acid. Thiazide diuretics decrease urinary calcium excretion, preventing calcium oxalate stone recurrence. Potassium citrate alkalinizes urine to treat and dissolve radiolucent uric acid stones. Adequate daily fluid intake exceeding two and a half liters represents the most critical universal preventive measure.",
        "say": "Metabolic evaluation in recurrent stone formers includes 24-hour urine collection for calcium, oxalate, and citrate. Thiazide diuretics reduce urinary calcium excretion, whereas potassium citrate treats uric acid stones. High daily fluid intake prevents recurrent nephrolithiasis.",
        "vis": {
          "kind": "compare",
          "left": {
            "title": "Calcium Oxalate Prevention",
            "points": [
              "Thiazide diuretics lower urine calcium",
              "Dietary calcium restriction contraindicated",
              "Maintain urine output > 2.5 L daily"
            ]
          },
          "right": {
            "title": "Uric Acid Stone Therapy",
            "points": [
              "Potassium citrate urine alkalinization",
              "Maintain urinary pH between 6.5 and 7.0",
              "Allopurinol for severe hyperuricosuria"
            ]
          }
        }
      }
    ]
  },
  {
    "module": "sur-renal-tumours",
    "subject": "surgery",
    "title": "Renal cell carcinoma, paraneoplastic syndromes, nephron-sparing surgery, and IVC thrombus",
    "minutes": 6,
    "refs": [
      "Sabiston Textbook of Surgery 22nd ed",
      "Campbell-Walsh Urology 12th ed"
    ],
    "steps": [
      {
        "tx": "Renal cell carcinoma accounts for ninety percent of primary kidney **malignancies** in adults. Clear cell adenocarcinoma represents the dominant histological subtype, arising from proximal convoluted tubule epithelium and classically associated with von Hippel-Lindau gene mutations on chromosome 3p. Papillary renal cell carcinoma comprises fifteen percent, driven by MET proto-oncogene alterations. Chromophobe carcinoma arises from intercalated cells of the cortical collecting duct, exhibiting a more favorable clinical prognosis.",
        "say": "Renal cell carcinoma accounts for ninety percent of renal malignancies. Clear cell carcinoma arises from the proximal tubule and is linked to chromosome 3p VHL mutations. Papillary and chromophobe carcinomas comprise the remaining common subtypes.",
        "vis": {
          "kind": "table",
          "cols": [
            "RCC histological subtype",
            "Cell of anatomical origin",
            "Genetic association"
          ],
          "rows": [
            [
              "Clear cell carcinoma",
              "Proximal convoluted tubule",
              "VHL inactivation (3p25)"
            ],
            [
              "Papillary carcinoma",
              "Proximal convoluted tubule",
              "MET proto-oncogene duplication"
            ],
            [
              "Chromophobe carcinoma",
              "Cortical collecting duct",
              "Birt-Hogg-Dube / FLCN mutation"
            ],
            [
              "Collecting duct carcinoma",
              "Medullary collecting duct",
              "Aggressive sarcomatoid variant"
            ]
          ]
        }
      },
      {
        "tx": "The classic clinical triad of flank pain, gross hematuria, and a palpable abdominal **mass** occurs in less than ten percent of modern cases due to widespread incidental radiological detection. Paraneoplastic syndromes occur frequently, including erythrocytosis from erythropoietin secretion, hypercalcemia from parathyroid hormone-related peptide, and Stauffer syndrome characterized by non-metastatic hepatic dysfunction. A newly developing left-sided varicocele that fails to decompress in the recumbent position suggests left renal vein tumor invasion.",
        "say": "The classic triad of flank pain, hematuria, and a palpable mass is rare today due to incidental imaging detection. Paraneoplastic manifestations include erythrocytosis, hypercalcemia, and Stauffer syndrome. A non-emptying left varicocele signals renal vein involvement.",
        "vis": {
          "kind": "flow",
          "nodes": [
            {
              "id": "n1",
              "label": "Incidental renal mass on imaging"
            },
            {
              "id": "n2",
              "label": "Evaluate paraneoplastic markers"
            },
            {
              "id": "n3",
              "label": "Triple-phase contrast renal CT"
            },
            {
              "id": "n4",
              "label": "Assess renal vein / IVC thrombus"
            }
          ],
          "edges": [
            [
              "n1",
              "n2"
            ],
            [
              "n2",
              "n3"
            ],
            [
              "n3",
              "n4"
            ]
          ]
        }
      },
      {
        "tx": "Triple-phase contrast-enhanced computed tomography of the abdomen and pelvis constitutes the primary staging **modality** for renal parenchymal masses. It evaluates tumor enhancement in the corticomedullary phase, washout in the nephrographic phase, and assesses renal vein or inferior vena cava tumor thrombus extension. Magnetic resonance imaging provides superior soft-tissue contrast when assessing cephalad caval thrombus propagation toward the hepatic veins or right atrium.",
        "say": "Triple-phase contrast CT scan evaluates renal mass enhancement and venous invasion into the renal vein or inferior vena cava. Magnetic resonance imaging is preferred when evaluating proximal caval tumor thrombus extending toward the right atrium.",
        "vis": {
          "kind": "table",
          "cols": [
            "IVC thrombus level",
            "Anatomical cranial extent",
            "Surgical approach"
          ],
          "rows": [
            [
              "Level I (Subhepatic)",
              "Thrombus adjacent to renal vein",
              "Standard infrahepatic clamping"
            ],
            [
              "Level II (Intrahepatic)",
              "Thrombus below major hepatic veins",
              "Infrahepatic IVC mobilization"
            ],
            [
              "Level III (Suprahepatic)",
              "Thrombus reaches diaphragmatic IVC",
              "Retrohepatic liver mobilization"
            ],
            [
              "Level IV (Atrial)",
              "Thrombus extends into right atrium",
              "Cardiopulmonary bypass & arrest"
            ]
          ]
        }
      },
      {
        "tx": "Nephron-sparing partial nephrectomy represents the gold standard surgical **approach** for localized T1a renal tumors measuring four centimeters or smaller, preserving renal functional reserve while providing oncological outcomes equivalent to radical excision. Radical nephrectomy entails en bloc resection of the kidney within Gerota fascia, ipsilateral adrenal gland when indicated, and regional lymph nodes. Metastatic clear cell disease responds to vascular endothelial growth factor receptor inhibitors and immune checkpoint combination therapy.",
        "say": "Partial nephrectomy is the gold standard for tumors four centimeters or smaller to preserve renal function. Radical nephrectomy within Gerota fascia is reserved for larger lesions. Systemic VEGF inhibitors and immunotherapy treat metastatic disease.",
        "vis": {
          "kind": "compare",
          "left": {
            "title": "Partial Nephrectomy",
            "points": [
              "Mandatory for solitary functional kidney",
              "T1a tumors <= 4 cm gold standard",
              "Preserves long-term renal function"
            ]
          },
          "right": {
            "title": "Radical Nephrectomy",
            "points": [
              "En bloc resection within Gerota fascia",
              "Indicated for central or T2+ tumors",
              "May require IVC thrombectomy"
            ]
          }
        }
      }
    ]
  },
  {
    "module": "sur-bladder",
    "subject": "surgery",
    "title": "Urothelial carcinoma of the bladder, TURBT, staging, and radical cystectomy",
    "minutes": 6,
    "refs": [
      "Sabiston Textbook of Surgery 22nd ed",
      "Campbell-Walsh Urology 12th ed"
    ],
    "steps": [
      {
        "tx": "Urothelial transitional cell carcinoma accounts for more than ninety percent of primary urinary bladder **neoplasms** in Western countries. Cigarette smoking constitutes the single most important modifiable risk factor, increasing disease probability threefold through aromatic amine exposure. Occupational exposures to industrial dye intermediates, benzidine, and rubber compounds also strongly predispose to urothelial carcinogenesis. Squamous cell carcinoma occurs predominantly in regions with endemic Schistosoma haematobium bilharzial infection, where chronic irritation produces extensive squamous metaplasia.",
        "say": "Urothelial carcinoma accounts for ninety percent of bladder tumors, with cigarette smoking and aromatic amine exposures serving as primary causative factors. Squamous cell carcinoma is associated with chronic Schistosoma haematobium infection and recurrent irritation.",
        "vis": {
          "kind": "table",
          "cols": [
            "Histological tumor type",
            "Epidemiological proportion",
            "Primary etiological factors"
          ],
          "rows": [
            [
              "Urothelial (transitional)",
              "Over 90 percent of cases",
              "Tobacco smoking & aromatic amines"
            ],
            [
              "Squamous cell carcinoma",
              "Approximately 5 percent",
              "Schistosoma & long-term catheters"
            ],
            [
              "Adenocarcinoma",
              "Under 2 percent",
              "Urachal remnants at bladder dome"
            ],
            [
              "Small cell neuroendocrine",
              "Under 1 percent",
              "Aggressive systemic metastasis"
            ]
          ]
        }
      },
      {
        "tx": "Painless gross hematuria throughout the urinary stream represents the cardinal clinical **presentation** of bladder cancer until proven otherwise. Irritative lower urinary tract voiding symptoms including frequency, urgency, and dysuria without demonstrable bacterial infection frequently accompany carcinoma in situ. Diagnostic workup mandates office flexible cystoscopy and voiding urine cytology, followed by examination under anesthesia and transurethral resection of bladder tumor to achieve definitive histological diagnosis and pathological depth staging.",
        "say": "Painless gross hematuria is the cardinal presenting sign of bladder cancer. Irritative voiding symptoms often signify carcinoma in situ. Diagnostic evaluation requires flexible cystoscopy, urine cytology, and complete transurethral resection of the bladder tumor.",
        "vis": {
          "kind": "flow",
          "nodes": [
            {
              "id": "n1",
              "label": "Painless gross visible hematuria"
            },
            {
              "id": "n2",
              "label": "Flexible cystoscopy & cytology"
            },
            {
              "id": "n3",
              "label": "Complete transurethral resection (TURBT)"
            },
            {
              "id": "n4",
              "label": "Assess detrusor muscle invasion"
            }
          ],
          "edges": [
            [
              "n1",
              "n2"
            ],
            [
              "n2",
              "n3"
            ],
            [
              "n3",
              "n4"
            ]
          ]
        }
      },
      {
        "tx": "Pathological staging hinges critically upon the histological presence of detrusor muscularis **propria** within the resected tissue specimen. Non-muscle-invasive bladder cancer encompasses stage Ta non-invasive papillary tumors, T1 tumors invading the subepithelial lamina propria, and Tis flat carcinoma in situ. Muscle-invasive disease encompasses stage T2 tumors invading the detrusor muscle, stage T3 invading perivesical fat, and stage T4 invading adjacent pelvic visceral structures such as the prostate, uterus, or pelvic sidewalls.",
        "say": "Pathological staging requires detrusor muscle in the resection specimen. Non-muscle-invasive cancer includes stages Ta, T1, and flat carcinoma in situ. Muscle-invasive cancer involves stage T2 detrusor invasion or deeper perivesical and pelvic organ spread.",
        "vis": {
          "kind": "table",
          "cols": [
            "Pathological T stage",
            "Microscopic depth of invasion",
            "Clinical category"
          ],
          "rows": [
            [
              "Stage Ta",
              "Non-invasive papillary urothelium",
              "Non-muscle-invasive"
            ],
            [
              "Stage Tis",
              "Flat high-grade carcinoma in situ",
              "Non-muscle-invasive (high risk)"
            ],
            [
              "Stage T1",
              "Subepithelial lamina propria connective tissue",
              "Non-muscle-invasive"
            ],
            [
              "Stage T2",
              "Detrusor muscularis propria invasion",
              "Muscle-invasive disease"
            ]
          ]
        }
      },
      {
        "tx": "Non-muscle-invasive bladder cancer is managed by complete transurethral **resection** followed by intravesical chemotherapy instillation and maintenance Bacillus Calmette-Guerin immunotherapy for intermediate- and high-risk cases. Muscle-invasive disease mandates neoadjuvant cisplatin-based combination chemotherapy followed by radical cystectomy with bilateral pelvic lymphadenectomy. In men, radical cystectomy removes the bladder, prostate, and seminal vesicles, while in women it entails anterior pelvic exenteration. Urinary diversion utilizes an ileal conduit or orthotopic neobladder.",
        "say": "Non-muscle-invasive disease receives transurethral resection followed by intravesical Bacillus Calmette-Guerin therapy. Muscle-invasive bladder cancer requires neoadjuvant cisplatin chemotherapy followed by radical cystectomy, pelvic lymph node dissection, and urinary diversion.",
        "vis": {
          "kind": "compare",
          "left": {
            "title": "Non-Muscle-Invasive (NMIBC)",
            "points": [
              "Transurethral resection of tumor",
              "Adjuvant intravesical BCG immunotherapy",
              "Routine surveillance cystoscopy"
            ]
          },
          "right": {
            "title": "Muscle-Invasive (MIBC)",
            "points": [
              "Neoadjuvant cisplatin chemotherapy",
              "Radical cystoprostatectomy / exenteration",
              "Urinary diversion via ileal conduit / neobladder"
            ]
          }
        }
      }
    ]
  },
  {
    "module": "sur-prostate",
    "subject": "surgery",
    "title": "Benign prostatic hyperplasia, prostatic adenocarcinoma, Gleason grading, and radical prostatectomy",
    "minutes": 6,
    "refs": [
      "Sabiston Textbook of Surgery 22nd ed",
      "Campbell-Walsh Urology 12th ed"
    ],
    "steps": [
      {
        "tx": "Benign prostatic hyperplasia arises within the periurethral transition **zone** of the prostate gland under the permissive endocrine influence of dihydrotestosterone, synthesized locally by 5-alpha reductase type 2. Progressive nodular hyperplasia compresses the prostatic urethra, producing bladder outlet obstruction and lower urinary tract symptoms. Prostatic adenocarcinoma, by contrast, develops predominantly in the posterior peripheral zone in seventy percent of cases, remaining asymptomatic until local extension or distant bone metastases supervene.",
        "say": "Benign prostatic hyperplasia arises in the periurethral transition zone under dihydrotestosterone stimulation, causing urinary outflow obstruction. Prostatic adenocarcinoma develops primarily in the posterior peripheral zone, presenting silently without early obstruction.",
        "vis": {
          "kind": "table",
          "cols": [
            "Prostate anatomical zone",
            "Associated pathological entity",
            "Clinical presentation pattern"
          ],
          "rows": [
            [
              "Transition zone",
              "Benign prostatic hyperplasia (BPH)",
              "Early urinary outflow obstruction"
            ],
            [
              "Peripheral zone",
              "Prostatic adenocarcinoma (70%)",
              "Palpable nodule on digital rectal exam"
            ],
            [
              "Central zone",
              "Uncommon benign / malignant growth",
              "Surrounds ejaculatory ducts"
            ],
            [
              "Anterior fibromuscular stroma",
              "Devoid of glandular tissue",
              "Non-neoplastic structural zone"
            ]
          ]
        }
      },
      {
        "tx": "Serum prostate-specific antigen is a kallikrein-like **serine** protease produced by prostatic epithelial cells to liquefy seminal coagulum. Elevated serum levels indicate disrupted prostatic architecture rather than cancer-specific transformation, occurring in BPH, prostatitis, urinary retention, and trauma. A total PSA level exceeding four nanograms per milliliter warrants diagnostic evaluation. A free-to-total PSA ratio under fifteen percent increases cancer suspicion, while multiparametric MRI utilizing PI-RADS scoring guides targeted transperineal or transrectal biopsies.",
        "say": "Prostate-specific antigen is an organ-specific serine protease that rises with architectural disruption in cancer, BPH, or prostatitis. A level exceeding four nanograms or a low free-to-total ratio prompts multiparametric MRI and targeted biopsy.",
        "vis": {
          "kind": "flow",
          "nodes": [
            {
              "id": "n1",
              "label": "Elevated PSA or abnormal rectal exam"
            },
            {
              "id": "n2",
              "label": "Multiparametric prostate MRI (PI-RADS)"
            },
            {
              "id": "n3",
              "label": "Targeted plus systematic core biopsy"
            },
            {
              "id": "n4",
              "label": "Gleason score & risk stratification"
            }
          ],
          "edges": [
            [
              "n1",
              "n2"
            ],
            [
              "n2",
              "n3"
            ],
            [
              "n3",
              "n4"
            ]
          ]
        }
      },
      {
        "tx": "Histopathological grading utilizes the Gleason architecture **scoring** system, combining the most predominant and second most common glandular architectural patterns into five prognostic Grade Groups. Grade Group 1 corresponds to Gleason score 3+3=6, exhibiting excellent clinical prognosis. Grade Group 5 corresponds to Gleason scores 9 and 10, characterized by sheets of undifferentiated cells or comedonecrosis. Staging incorporates digital examination, serum PSA, bone scintigraphy for osteoblastic skeletal metastases, and PSMA PET imaging.",
        "say": "Histological grading uses the Gleason system, grouping architectural patterns into Grade Groups 1 through 5. Bone scintigraphy and prostate-specific membrane antigen PET scans identify osteoblastic bone metastases in high-risk disease.",
        "vis": {
          "kind": "table",
          "cols": [
            "Gleason score pattern",
            "Grade Group designation",
            "Clinical biological behavior"
          ],
          "rows": [
            [
              "Gleason 3 + 3 = 6",
              "Grade Group 1",
              "Indolent / active surveillance candidate"
            ],
            [
              "Gleason 3 + 4 = 7",
              "Grade Group 2",
              "Favorable intermediate risk"
            ],
            [
              "Gleason 4 + 3 = 7",
              "Grade Group 3",
              "Unfavorable intermediate risk"
            ],
            [
              "Gleason 4 + 4 = 8",
              "Grade Group 4",
              "High risk / aggressive local invasion"
            ],
            [
              "Gleason 9 or 10",
              "Grade Group 5",
              "Very high risk / high metastatic potential"
            ]
          ]
        }
      },
      {
        "tx": "Management of localized prostate cancer encompasses active **surveillance** for low-risk disease, robotic-assisted radical prostatectomy, or external beam radiation with concurrent androgen deprivation therapy. Radical prostatectomy removes the prostate, seminal vesicles, and ampullae of the vasa deferentia, with bilateral pelvic lymphadenectomy for intermediate- and high-risk tumors. For symptomatic BPH refractory to medical alpha-blocker and 5-alpha reductase inhibitor therapy, transurethral resection of the prostate remains the definitive endoscopic benchmark.",
        "say": "Localized prostate cancer is managed with active surveillance, robotic radical prostatectomy, or external beam radiotherapy with androgen deprivation. Refractory BPH is treated definitively with transurethral resection of the prostate.",
        "vis": {
          "kind": "compare",
          "left": {
            "title": "Radical Prostatectomy",
            "points": [
              "Complete prostate & seminal vesicle removal",
              "Bilateral pelvic lymph node dissection",
              "Risks: stress incontinence & erectile dysfunction"
            ]
          },
          "right": {
            "title": "Endoscopic BPH Surgery",
            "points": [
              "Transurethral resection of prostate (TURP)",
              "Removes adenomatous transition zone tissue",
              "Preserves peripheral zone and outer capsule"
            ]
          }
        }
      }
    ]
  },
  {
    "module": "sur-testis",
    "subject": "surgery",
    "title": "Testicular germ cell tumors, serum markers, radical inguinal orchiectomy, and retroperitoneal dissection",
    "minutes": 6,
    "refs": [
      "Sabiston Textbook of Surgery 22nd ed",
      "Campbell-Walsh Urology 12th ed"
    ],
    "steps": [
      {
        "tx": "Testicular neoplasms represent the most frequent solid **malignancy** in young adult men aged fifteen to thirty-five years. Germ cell tumors comprise ninety-five percent of primary neoplasms, stratified clinically into seminomas and non-seminomatous germ cell tumors. Seminomas represent fifty percent of cases, composed of sheets of uniform cells with clear glycogen-rich cytoplasm, prominent nucleoli, and delicate fibrous septa infiltrated by lymphocytes. Cryptorchidism increases testicular malignancy risk four- to eightfold, even following successful early orchidopexy.",
        "say": "Testicular tumors are the most common solid cancer in young men. Germ cell tumors are divided into seminomas and non-seminomatous subtypes. Cryptorchidism increases malignancy risk several fold, even after corrective surgical orchidopexy.",
        "vis": {
          "kind": "table",
          "cols": [
            "Germ cell tumor subtype",
            "Histological features",
            "Serum tumor marker profile"
          ],
          "rows": [
            [
              "Classic seminoma",
              "Uniform clear cells with lymphoid stroma",
              "Normal AFP; beta-hCG elevated in 15%"
            ],
            [
              "Embryonal carcinoma",
              "Anaplastic pleomorphic glandular sheets",
              "Both AFP and beta-hCG may be elevated"
            ],
            [
              "Yolk sac tumor",
              "Schiller-Duval bodies & microcysts",
              "Serum AFP elevated in nearly 100%"
            ],
            [
              "Choriocarcinoma",
              "Syncytio- and cytotrophoblasts",
              "Profoundly elevated serum beta-hCG"
            ]
          ]
        }
      },
      {
        "tx": "Serum tumor markers play an indispensable **role** in the diagnosis, clinical staging, risk stratification, and post-treatment monitoring of testicular neoplasms. Alpha-fetoprotein has a serum half-life of five to seven days, produced by yolk sac elements and embryonal carcinomas, but never by pure seminomas. Beta-human chorionic gonadotropin has a half-life of twenty-four to thirty-six hours, produced by syncytiotrophoblastic cells. Serum lactate dehydrogenase reflects overall tumor cell turnover and metabolic bulk.",
        "say": "Serum tumor markers include alpha-fetoprotein, beta-hCG, and lactate dehydrogenase. Alpha-fetoprotein is never produced by pure seminomas. Tracking marker half-lives verifies complete surgical resection and monitors treatment response.",
        "vis": {
          "kind": "flow",
          "nodes": [
            {
              "id": "n1",
              "label": "Painless testicular enlargement"
            },
            {
              "id": "n2",
              "label": "High-frequency scrotal Doppler ultrasound"
            },
            {
              "id": "n3",
              "label": "Preoperative baseline serum markers"
            },
            {
              "id": "n4",
              "label": "Radical inguinal orchiectomy"
            }
          ],
          "edges": [
            [
              "n1",
              "n2"
            ],
            [
              "n2",
              "n3"
            ],
            [
              "n3",
              "n4"
            ]
          ]
        }
      },
      {
        "tx": "A painless, firm intratesticular mass that does not **transilluminate** warrants immediate high-frequency Doppler ultrasonography. If an intratesticular vascular lesion is confirmed, radical inguinal orchiectomy with high ligation of the spermatic cord at the internal inguinal ring is mandatory. Transscrotal biopsy or scrotal orchiectomy is strictly contraindicated because violating the scrotal wall disrupts native retroperitoneal lymphatic drainage, predisposing to aberrant tumor dissemination into superficial inguinal lymph nodes.",
        "say": "Any firm intratesticular mass requires prompt scrotal Doppler ultrasound. Radical inguinal orchiectomy with high cord ligation is mandatory. Scrotal incision or needle biopsy is strictly prohibited to avoid altering lymphatic drainage.",
        "vis": {
          "kind": "table",
          "cols": [
            "Surgical step / decision",
            "Technical execution",
            "Oncological rationale"
          ],
          "rows": [
            [
              "Skin incision",
              "Inguinal incision above groin crease",
              "Avoids scrotal skin contamination"
            ],
            [
              "Spermatic cord control",
              "Early cross-clamping at internal ring",
              "Prevents hematogenous tumor extrusion"
            ],
            [
              "En bloc mobilization",
              "Mobilize testis within tunica vaginalis",
              "Complete oncological resection margin"
            ],
            [
              "Contraindicated action",
              "Transscrotal needle or open biopsy",
              "Spills tumor into inguinal nodal basin"
            ]
          ]
        }
      },
      {
        "tx": "Staging requires abdominopelvic and chest computed **tomography** combined with serial post-orchiectomy serum marker decay kinetics. Primary lymphatic drainage from the right testis enters the interaortocaval and precaval nodes, while the left testis drains to the left para-aortic nodes. Seminomas demonstrate exquisite radiosensitivity and chemosensitivity to cisplatin-based regimens. Non-seminomatous tumors with persistent retroperitoneal lymphadenopathy exceeding one centimeter following induction chemotherapy mandate nerve-sparing retroperitoneal lymph node dissection to resect teratoma or viable residual carcinoma.",
        "say": "Staging involves contrast CT imaging and post-orchiectomy marker monitoring. Seminomas respond exquisitely to radiotherapy and cisplatin chemotherapy. Persistent post-chemotherapy retroperitoneal masses in non-seminomatous disease require retroperitoneal lymph node dissection.",
        "vis": {
          "kind": "compare",
          "left": {
            "title": "Seminoma Management",
            "points": [
              "Exquisitely sensitive to radiotherapy",
              "Surveillance or single-agent carboplatin in stage I",
              "BEP chemotherapy for advanced disease"
            ]
          },
          "right": {
            "title": "Non-Seminoma Management",
            "points": [
              "Retroperitoneal lymph node dissection (RPLND)",
              "BEP chemotherapy (bleomycin, etoposide, cisplatin)",
              "Resect post-chemo residual masses > 1 cm"
            ]
          }
        }
      }
    ]
  },
  {
    "module": "sur-arterial",
    "subject": "surgery",
    "title": "Peripheral arterial disease, Fontaine stages, acute limb ischemia, and revascularization",
    "minutes": 6,
    "refs": [
      "Sabiston Textbook of Surgery 22nd ed",
      "Rutherford Vascular Surgery 9th ed"
    ],
    "steps": [
      {
        "tx": "Atherosclerotic peripheral arterial disease produces progressive luminal narrowing within lower extremity **arteries**, classically stratified by Fontaine stages or Rutherford categories. Fontaine stage II denotes reproducible intermittent claudication during exertion. Stage III signifies ischemic rest pain occurring when recumbent that awakens the patient at night. Stage IV denotes critical limb-threatening ischemia characterized by non-healing ischemic ulcerations or gangrene. Critical ischemia carries a high risk of major limb amputation without prompt revascularization.",
        "say": "Peripheral arterial disease causes lower extremity ischemia, classified into Fontaine stages. Intermittent claudication represents stage two, while rest pain represents stage three. Stage four denotes critical tissue loss and gangrene requiring urgent revascularization.",
        "vis": {
          "kind": "table",
          "cols": [
            "Fontaine stage",
            "Clinical presentation",
            "Rutherford category"
          ],
          "rows": [
            [
              "Stage I",
              "Asymptomatic arterial stenosis",
              "Category 0"
            ],
            [
              "Stage IIa / IIb",
              "Mild to severe intermittent claudication",
              "Categories 1 to 3"
            ],
            [
              "Stage III",
              "Ischemic rest pain (worse supine)",
              "Category 4"
            ],
            [
              "Stage IV",
              "Ulceration or ischemic gangrene",
              "Categories 5 and 6"
            ]
          ]
        }
      },
      {
        "tx": "The ankle-brachial index represents the cornerstone non-invasive diagnostic **modality** for evaluating lower extremity arterial perfusion. A resting index between 0.9 and 1.3 is normal, while values between 0.5 and 0.8 reflect moderate claudication. An index below 0.5 indicates severe ischemia, and ankle pressure under fifty millimeters of mercury signifies critical ischemia. In diabetic patients with heavily calcified, non-compressible tibial vessels yielding false values above 1.4, the toe-brachial index accurately measures microvascular perfusion.",
        "say": "The ankle-brachial index is the primary non-invasive test for lower limb ischemia. An index between 0.9 and 1.3 is normal, while values below 0.5 signify severe ischemia. Toe-brachial index is used when arteries are calcified and non-compressible.",
        "vis": {
          "kind": "flow",
          "nodes": [
            {
              "id": "n1",
              "label": "Suspected lower limb ischemia"
            },
            {
              "id": "n2",
              "label": "Measure bilateral ankle-brachial index"
            },
            {
              "id": "n3",
              "label": "Toe pressures if vessels non-compressible"
            },
            {
              "id": "n4",
              "label": "Duplex ultrasound & CT angiography"
            }
          ],
          "edges": [
            [
              "n1",
              "n2"
            ],
            [
              "n2",
              "n3"
            ],
            [
              "n3",
              "n4"
            ]
          ]
        }
      },
      {
        "tx": "Acute limb ischemia manifests with the cardinal six Ps: pain, pallor, poikilothermia, pulselessness, **paresthesia**, and paralysis. Paresthesia and motor paralysis signify advanced nerve and muscle ischemia with impending irreversible necrosis. Rutherford classifies acute ischemia into viable (grade I), marginally threatened (grade IIa), immediately threatened (grade IIb), and irreversibly infarcted (grade III). Cardiogenic emboli from atrial fibrillation typically lodge abruptly at arterial bifurcations, most commonly the femoral bifurcation, without prior collateral development.",
        "say": "Acute limb ischemia manifests with the six Ps: pain, pallor, coldness, pulselessness, paresthesia, and paralysis. Paresthesia and motor weakness indicate immediately threatened tissue requiring emergency surgical revascularization.",
        "vis": {
          "kind": "table",
          "cols": [
            "Rutherford category",
            "Sensory deficit",
            "Motor deficit / Doppler signal"
          ],
          "rows": [
            [
              "Class I (Viable)",
              "No sensory loss",
              "No muscle weakness / audible signals"
            ],
            [
              "Class IIa (Marginal)",
              "Minimal toe numbness",
              "No muscle weakness / venous signal"
            ],
            [
              "Class IIb (Threatened)",
              "Sensory loss above toes",
              "Mild-moderate weakness / inaudible arterial"
            ],
            [
              "Class III (Irreversible)",
              "Profound anesthetic numbness",
              "Paralysis and rigor / absent Doppler signals"
            ]
          ]
        }
      },
      {
        "tx": "Emergency management of acute limb ischemia mandates immediate intravenous heparin anticoagulation to prevent propagating thrombus **formation**. Catheter-directed balloon thromboembolectomy using a Fogarty catheter rapidly restores arterial inflow. Post-reperfusion syndrome with severe muscle swelling mandates immediate prophylactic four-compartment calf fasciotomy to prevent myonecrosis. Chronic critical limb ischemia is managed by endovascular angioplasty or surgical bypass, where the reversed or in situ autologous great saphenous vein provides superior long-term patency.",
        "say": "Acute limb ischemia requires immediate heparinization and emergency Fogarty balloon embolectomy. Reperfusion swelling mandates four-compartment calf fasciotomy. Chronic critical ischemia is treated with endovascular angioplasty or autologous saphenous vein bypass.",
        "vis": {
          "kind": "compare",
          "left": {
            "title": "Embolic Acute Ischemia",
            "points": [
              "Sudden acute onset without prior claudication",
              "Identifiable cardiac source (atrial fibrillation)",
              "Treated with Fogarty catheter embolectomy"
            ]
          },
          "right": {
            "title": "Thrombotic Acute Ischemia",
            "points": [
              "Gradual worsening on pre-existing atherosclerosis",
              "Well-developed collateral vessels present",
              "Requires catheter thrombolysis or surgical bypass"
            ]
          }
        }
      }
    ]
  },
  {
    "module": "sur-aneurysm",
    "subject": "surgery",
    "title": "Abdominal aortic aneurysm, Laplace law, endoleak types, and carotid endarterectomy",
    "minutes": 6,
    "refs": [
      "Sabiston Textbook of Surgery 22nd ed",
      "Rutherford Vascular Surgery 9th ed"
    ],
    "steps": [
      {
        "tx": "An abdominal aortic aneurysm represents a permanent focal arterial **dilation** exceeding three centimeters in diameter or fifty percent greater than the adjacent normal aorta. The infrarenal abdominal aorta is involved in over ninety percent of cases due to decreased medial elastin lamellae and lack of vasa vasorum. Laplace law states that mural wall tension equals pressure multiplied by radius divided by wall thickness, explaining why rupture risk accelerates exponentially as diameter expands beyond five centimeters.",
        "say": "An abdominal aortic aneurysm is defined as a diameter exceeding three centimeters. Ninety percent involve the infrarenal aorta. By Laplace law, mural wall tension rises directly with increasing radius, dramatically accelerating rupture risk.",
        "vis": {
          "kind": "table",
          "cols": [
            "Aneurysm diameter",
            "Annual rupture risk",
            "Clinical management strategy"
          ],
          "rows": [
            [
              "3.0 to 3.9 cm",
              "Under 1 percent per year",
              "Serial ultrasound every 2 to 3 years"
            ],
            [
              "4.0 to 4.9 cm",
              "Approximately 1 to 3 percent",
              "Serial ultrasound every 6 to 12 months"
            ],
            [
              "5.0 to 5.4 cm",
              "Approximately 3 to 5 percent",
              "Close monitoring / consider repair in women"
            ],
            [
              ">= 5.5 cm",
              "Exceeds 10 percent per year",
              "Elective surgical or endovascular repair"
            ]
          ]
        }
      },
      {
        "tx": "Elective repair is recommended when maximum transverse diameter reaches five and a half centimeters in men or five centimeters in women, or upon rapid expansion exceeding five **millimeters** over six months. Ruptured aneurysm classically presents with severe sudden back or flank pain, a pulsatile abdominal mass, and profound hypotension, though this diagnostic triad appears complete in only half of cases. Hemodynamically stable patients undergo immediate contrast computed tomography, while unstable patients proceed directly to the operating theater.",
        "say": "Elective repair is indicated at five and a half centimeters in men, five centimeters in women, or with rapid expansion. Rupture presents with severe back pain, a pulsatile abdominal mass, and shock, requiring immediate surgical exploration.",
        "vis": {
          "kind": "flow",
          "nodes": [
            {
              "id": "n1",
              "label": "Suspected ruptured aortic aneurysm"
            },
            {
              "id": "n2",
              "label": "Permissive hypotension (SBP 70-90)"
            },
            {
              "id": "n3",
              "label": "Immediate OR transfer or fast CTA"
            },
            {
              "id": "n4",
              "label": "Cross-clamping or aortic balloon occlusion"
            }
          ],
          "edges": [
            [
              "n1",
              "n2"
            ],
            [
              "n2",
              "n3"
            ],
            [
              "n3",
              "n4"
            ]
          ]
        }
      },
      {
        "tx": "Endovascular aneurysm repair requires favorable anatomical morphology including an adequate infrarenal **neck** length exceeding ten millimeters, non-circumferential thrombus, and suitable iliac access vessels. Complications following endovascular stenting are characterized by endoleaks. Type I endoleaks involve persistent flow at proximal or distal attachment sites, transmitting full systemic arterial pressure and mandating immediate corrective reintervention. Type II endoleaks arise from retrograde branch flow through lumbar arteries or the inferior mesenteric artery, resolving spontaneously in most cases.",
        "say": "Endovascular aneurysm repair requires an adequate proximal aortic neck length of at least ten millimeters. Type I attachment site endoleaks transmit systemic arterial pressure and require immediate repair. Type II branch vessel endoleaks are typically observed.",
        "vis": {
          "kind": "table",
          "cols": [
            "Endoleak classification",
            "Anatomical source of flow",
            "Clinical management rule"
          ],
          "rows": [
            [
              "Type I",
              "Attachment site seal failure (proximal/distal)",
              "Immediate ballooning, cuff or stent"
            ],
            [
              "Type II",
              "Retrograde branch flow (lumbar / IMA)",
              "Conservative surveillance unless enlarging"
            ],
            [
              "Type III",
              "Graft fabric tear or modular disconnection",
              "Urgent endovascular component relining"
            ],
            [
              "Type IV / V",
              "Graft wall porosity / endotension",
              "Observation unless sac expands"
            ]
          ]
        }
      },
      {
        "tx": "Carotid endarterectomy prevents ischemic cerebral events in patients with severe extracranial **atherosclerosis**. The NASCET trial established that symptomatic patients with seventy to ninety-nine percent internal carotid stenosis achieve substantial stroke risk reduction from carotid endarterectomy compared to medical therapy alone. Surgery involves plaque excision through a longitudinal arteriotomy, with temporary intraluminal shunting used to preserve cerebral perfusion during clamping when collateral flow through the circle of Willis is insufficient.",
        "say": "Carotid endarterectomy significantly reduces stroke risk in symptomatic internal carotid artery stenosis between seventy and ninety-nine percent. Meticulous plaque removal with patch angioplasty restores cerebral inflow and prevents future embolization.",
        "vis": {
          "kind": "compare",
          "left": {
            "title": "Carotid Endarterectomy (CEA)",
            "points": [
              "Gold standard for symptomatic > 70% stenosis",
              "Complete surgical excision of plaque",
              "Mandates temporary intraluminal shunt if needed"
            ]
          },
          "right": {
            "title": "Carotid Artery Stenting (CAS)",
            "points": [
              "Alternative in hostile neck or radiation",
              "Requires embolic protection filter",
              "Slightly higher periprocedural minor stroke risk"
            ]
          }
        }
      }
    ]
  },
  {
    "module": "sur-venous",
    "subject": "surgery",
    "title": "Chronic venous disease, CEAP classification, varicose veins, and endovenous ablation",
    "minutes": 6,
    "refs": [
      "Sabiston Textbook of Surgery 22nd ed",
      "Rutherford Vascular Surgery 9th ed"
    ],
    "steps": [
      {
        "tx": "Chronic venous disease arises from valvular incompetence and venous **hypertension** in superficial, deep, or perforating venous systems. When bicuspid venous valves fail, retrograde gravitational hydrostatic pooling transmits elevated pressures into cutaneous capillary beds. Extravasation of red blood cells produces hemosiderin hyperpigmentation, while pericapillary fibrin cuffs and chronic leukocyte entrapment induce progressive subcutaneous fibrosis termed lipodermatosclerosis. The medial lower calf and perimalleolar region represent the classic anatomical site of venous stasis.",
        "say": "Chronic venous insufficiency stems from venous valvular incompetence and ambulatory venous hypertension. Hydrostatic pooling drives red cell extravasation, hemosiderin pigmentation, and subcutaneous lipodermatosclerosis over the medial lower calf.",
        "vis": {
          "kind": "table",
          "cols": [
            "Venous system component",
            "Normal physiological role",
            "Pathophysiological consequence"
          ],
          "rows": [
            [
              "Superficial (GSV & SSV)",
              "Drain skin and subcutaneous tissues",
              "Varicosities, telangiectasias, aching"
            ],
            [
              "Deep system",
              "Carries 90% of venous return",
              "Deep reflux, chronic edema, severe skin breakdown"
            ],
            [
              "Perforating veins",
              "Direct blood from superficial to deep",
              "Incompetence causes localized venous hypertensive flares"
            ],
            [
              "Calf muscle pump",
              "Generates propulsion during ambulation",
              "Pump failure exacerbates ambulatory hypertension"
            ]
          ]
        }
      },
      {
        "tx": "The international CEAP classification categorizes venous disorders based on clinical, **etiological**, anatomical, and pathophysiological criteria. Clinical class C1 denotes telangiectasias or reticular veins. Class C2 encompasses true dilated, tortuous varicose veins measuring three millimeters or larger. Class C3 denotes lower limb edema without trophic skin changes. Class C4 includes pigmentation, eczema, and lipodermatosclerosis. Class C5 represents a healed venous ulceration, while class C6 denotes an active, open venous leg ulcer.",
        "say": "The CEAP classification grades venous disease from C0 to C6. C2 represents varicose veins, C3 lower extremity edema, C4 trophic skin changes like lipodermatosclerosis, and C6 an active, non-healing venous leg ulcer.",
        "vis": {
          "kind": "table",
          "cols": [
            "CEAP clinical class",
            "Physical examination finding",
            "Typical anatomical location"
          ],
          "rows": [
            [
              "Class C1",
              "Telangiectasias & reticular veins",
              "Lateral thigh, ankle flare"
            ],
            [
              "Class C2",
              "Varicose veins (>= 3 mm diameter)",
              "Great / small saphenous distribution"
            ],
            [
              "Class C3",
              "Dependent lower extremity edema",
              "Perimalleolar and lower calf"
            ],
            [
              "Class C4a / C4b",
              "Pigmentation, eczema / lipodermatosclerosis",
              "Medial gaiter area of lower calf"
            ],
            [
              "Class C5 / C6",
              "Healed / active venous stasis ulcer",
              "Superior to medial malleolus"
            ]
          ]
        }
      },
      {
        "tx": "Duplex ultrasound examination in the standing position represents the definitive diagnostic **investigation** for venous pathology. It documents anatomical venous pathways, identifies intraluminal thrombi, and quantifies retrograde reflux duration following distal manual compression release. Pathological reflux is defined as retrograde venous flow exceeding five hundred milliseconds in superficial and perforator veins, or exceeding one thousand milliseconds in deep femoral and popliteal veins. Deep vein patency must be confirmed prior to superficial interventions.",
        "say": "Standing duplex ultrasound is the gold standard diagnostic test, identifying venous thrombi and quantifying reflux duration. Reflux exceeding five hundred milliseconds in superficial veins or one second in deep veins is pathological.",
        "vis": {
          "kind": "flow",
          "nodes": [
            {
              "id": "n1",
              "label": "Lower limb venous symptoms / ulcer"
            },
            {
              "id": "n2",
              "label": "Standing duplex ultrasound examination"
            },
            {
              "id": "n3",
              "label": "Quantify reflux duration & deep patency"
            },
            {
              "id": "n4",
              "label": "Ablation vs compression therapy"
            }
          ],
          "edges": [
            [
              "n1",
              "n2"
            ],
            [
              "n2",
              "n3"
            ],
            [
              "n3",
              "n4"
            ]
          ]
        }
      },
      {
        "tx": "Conservative therapy utilizing graduated compression **stockings** exerting twenty to thirty or thirty to forty millimeters of mercury pressure constitutes initial management. For superficial axial incompetence involving the great saphenous vein, endovenous thermal ablation via radiofrequency or laser has replaced open high ligation and stripping as first-line therapy. Tumescent local anesthesia protects adjacent cutaneous nerves and absorbs heat during ablation. Ultrasound-guided foam sclerotherapy and cyanoacrylate adhesive provide effective non-thermal options.",
        "say": "Graduated compression therapy provides foundational conservative support. Endovenous thermal ablation using radiofrequency or laser with tumescent anesthesia is the first-line treatment for saphenous reflux, replacing open surgical stripping.",
        "vis": {
          "kind": "compare",
          "left": {
            "title": "Endovenous Thermal Ablation",
            "points": [
              "Radiofrequency (RFA) or laser (EVLA)",
              "Tumescent local anesthesia required",
              "Rapid recovery and > 95% closure rates"
            ]
          },
          "right": {
            "title": "Open Saphenous Stripping",
            "points": [
              "High ligation at saphenofemoral junction",
              "Mechanical vein stripping to knee level",
              "Higher groin hematoma and nerve injury rates"
            ]
          }
        }
      }
    ]
  },
  {
    "module": "sur-lymphatic",
    "subject": "surgery",
    "title": "Lymphedema staging, lymphoscintigraphy, complete decongestive therapy, and surgical restoration",
    "minutes": 6,
    "refs": [
      "Sabiston Textbook of Surgery 22nd ed",
      "Rutherford Vascular Surgery 9th ed"
    ],
    "steps": [
      {
        "tx": "Lymphedema is a chronic debilitating condition caused by impaired interstitial **drainage** and macromolecular clearance, leading to protein-rich fluid stagnation, chronic inflammation, adipocyte hypertrophy, and progressive cutaneous fibrosis. Primary lymphedema results from intrinsic lymphatic aplasia or hypoplasia, divided into congenital Milroy disease presenting before age one, Meige disease praecox presenting around puberty, and lymphedema tarda developing after age thirty-five. Secondary lymphedema most commonly follows axillary lymphadenectomy, radiation, or filariasis worldwide.",
        "say": "Lymphedema results from defective lymphatic clearance, causing protein-rich interstitial fluid retention, adipose deposition, and dermal fibrosis. Primary forms include Milroy and Meige diseases, while secondary lymphedema commonly follows axillary dissection.",
        "vis": {
          "kind": "table",
          "cols": [
            "Lymphedema etiology",
            "Typical age of onset",
            "Predominant causal mechanism"
          ],
          "rows": [
            [
              "Congenital (Milroy)",
              "Birth to 1 year of age",
              "VEGFR3 gene mutation / aplasia"
            ],
            [
              "Praecox (Meige)",
              "Puberty to age 35 years",
              "Lymphatic hypoplasia (most common primary)"
            ],
            [
              "Tarda",
              "After age 35 years",
              "Adult-onset primary lymphatic incompetence"
            ],
            [
              "Secondary lymphedema",
              "Any age following insult",
              "Axillary clearance, radiation, filariasis"
            ]
          ]
        }
      },
      {
        "tx": "The International Society of Lymphology classifies clinical lymphedema into four progressive **stages**. Stage 0 denotes a subclinical, latent state where lymphatic transport capacity is reduced without visible edema. Stage 1 demonstrates early pitting edema that improves or resolves completely with overnight leg elevation. Stage 2 exhibits irreversible, non-pitting edema with extensive subcutaneous fibrofatty proliferation. Stage 3 represents lymphostatic elephantiasis characterized by massive limb enlargement, acanthosis, verrucous hyperkeratosis, and recurrent episodes of streptococcal cellulitis.",
        "say": "The International Society of Lymphology recognizes four stages from latent stage zero to elephantiasis in stage three. Stage one demonstrates reversible pitting edema, while stage two exhibits non-pitting irreversible fibroadipose deposition.",
        "vis": {
          "kind": "table",
          "cols": [
            "ISL clinical stage",
            "Physical examination characteristics",
            "Reversibility with limb elevation"
          ],
          "rows": [
            [
              "Stage 0 (Latent)",
              "No visible swelling / impaired transport",
              "Subclinical state"
            ],
            [
              "Stage 1 (Early)",
              "Soft pitting edema",
              "Reverses completely with elevation"
            ],
            [
              "Stage 2 (Late)",
              "Non-pitting dense edema with fibrosis",
              "Does not reverse with elevation"
            ],
            [
              "Stage 3 (Elephantiasis)",
              "Verrucous hyperkeratosis & fat lobules",
              "Irreversible / severe chronic disability"
            ]
          ]
        }
      },
      {
        "tx": "Stemmer sign, defined as the inability to pinch and lift a fold of **skin** at the base of the second toe, represents a pathognomonic physical finding distinguishing lymphedema from venous edema. Lymphoscintigraphy using intradermal technetium-99m sulfur colloid represents the diagnostic gold standard, demonstrating delayed transit, dermal backflow, and absent regional lymph node visualization. Near-infrared fluorescence lymphography with indocyanine green provides real-time high-resolution mapping of functioning superficial lymphatic channels.",
        "say": "Stemmer sign is the inability to pinch skin at the second toe base, pathognomonic for lymphedema. Technetium-99m lymphoscintigraphy is the diagnostic gold standard, demonstrating delayed transit and dermal backflow.",
        "vis": {
          "kind": "flow",
          "nodes": [
            {
              "id": "n1",
              "label": "Painless chronic limb enlargement"
            },
            {
              "id": "n2",
              "label": "Positive Stemmer sign on exam"
            },
            {
              "id": "n3",
              "label": "Technetium lymphoscintigraphy"
            },
            {
              "id": "n4",
              "label": "Stage-guided CDT or supermicrosurgery"
            }
          ],
          "edges": [
            [
              "n1",
              "n2"
            ],
            [
              "n2",
              "n3"
            ],
            [
              "n3",
              "n4"
            ]
          ]
        }
      },
      {
        "tx": "Complete decongestive therapy represents the cornerstone conservative management, combining manual **lymphatic** drainage, multi-layer short-stretch compression bandaging, therapeutic exercise, and meticulous skin hygiene to prevent recurrent cellulitis. Supermicrosurgical lymphovenous anastomosis creates shunts between functioning lymphatic channels and adjacent subdermal venules in early stage 1 and 2 disease. Vascularized lymph node transfer provides physiological clearance for refractory cases, while suction-assisted lipectomy removes hypertrophied fibrofatty tissue in advanced stage 2 and 3 disease.",
        "say": "Complete decongestive therapy provides essential conservative management through manual drainage and compression bandaging. Supermicrosurgical lymphovenous anastomosis diverts lymphatic flow into venules, while suction lipectomy resects chronic fibroadipose tissue.",
        "vis": {
          "kind": "compare",
          "left": {
            "title": "Physiological Surgery",
            "points": [
              "Lymphovenous anastomosis (LVA)",
              "Vascularized lymph node transfer (VLNT)",
              "Best in early stages with patent channels"
            ]
          },
          "right": {
            "title": "Ablative / Reductive Surgery",
            "points": [
              "Suction-assisted lipectomy",
              "Charles skin excision procedure",
              "Indicated for chronic fibroadipose excess"
            ]
          }
        }
      }
    ]
  },
  {
    "module": "sur-thoracic",
    "subject": "surgery",
    "title": "Thoracic oncology, anatomic lobectomy, VATS resection, and pleural empyema",
    "minutes": 6,
    "refs": [
      "Sabiston Textbook of Surgery 22nd ed",
      "Shields General Thoracic Surgery 8th ed"
    ],
    "steps": [
      {
        "tx": "Non-small cell lung cancer accounts for eighty-five percent of primary pulmonary **malignancies**, classified histologically into adenocarcinoma, squamous cell carcinoma, and large cell carcinoma. Preoperative physiological evaluation mandates spirometry and diffusing capacity of the lung for carbon monoxide. Predicted postoperative forced expiratory volume in one second and diffusing capacity exceeding forty percent indicate safe tolerance for anatomical resection, while values below thirty percent warrant cardiopulmonary exercise testing.",
        "say": "Non-small cell lung cancer accounts for eighty-five percent of primary lung neoplasms. Preoperative physiological assessment requires spirometry and carbon monoxide diffusion testing, with predicted postoperative values above forty percent confirming surgical resectability.",
        "vis": {
          "kind": "table",
          "cols": [
            "Pulmonary function parameter",
            "Low surgical risk threshold",
            "High risk / further testing threshold"
          ],
          "rows": [
            [
              "Predicted post-op FEV1 (ppoFEV1)",
              "Greater than 40 percent",
              "Less than 30 percent"
            ],
            [
              "Predicted post-op DLCO (ppoDLCO)",
              "Greater than 40 percent",
              "Less than 30 percent"
            ],
            [
              "Peak VO2 on CPET exercise",
              "Greater than 15 mL/kg/min",
              "Less than 10 mL/kg/min"
            ],
            [
              "Cardiac risk stratification",
              "Revised Cardiac Risk Index <= 1",
              "Elevated cardiac biomarker / ischemia"
            ]
          ]
        }
      },
      {
        "tx": "Anatomical lobectomy with systematic hilar and mediastinal lymph node **dissection** remains the gold standard curative operation for clinical stage I and II non-small cell lung carcinoma. Video-assisted thoracic surgery and robotic-assisted approaches demonstrate reduced postoperative pain, shorter chest tube duration, and equivalent oncological long-term survival compared to open thoracotomy. Sublobar segmentectomy represents an acceptable alternative for peripheral tumors measuring two centimeters or smaller with pure or predominant ground-glass opacity.",
        "say": "Anatomic lobectomy with systematic mediastinal lymph node dissection is the gold standard for early-stage lung cancer. Minimally invasive video-assisted and robotic approaches reduce pain and hospital stay with equivalent survival.",
        "vis": {
          "kind": "flow",
          "nodes": [
            {
              "id": "n1",
              "label": "Solitary pulmonary nodule / biopsy"
            },
            {
              "id": "n2",
              "label": "PET-CT and endobronchial ultrasound (EBUS)"
            },
            {
              "id": "n3",
              "label": "Confirm stage I-II physiological reserve"
            },
            {
              "id": "n4",
              "label": "VATS anatomical lobectomy & node clearance"
            }
          ],
          "edges": [
            [
              "n1",
              "n2"
            ],
            [
              "n2",
              "n3"
            ],
            [
              "n3",
              "n4"
            ]
          ]
        }
      },
      {
        "tx": "Primary spontaneous pneumothorax develops in tall, thin young adults secondary to apical subpleural **bleb** rupture. Indications for surgical intervention include a second ipsilateral recurrence, first contralateral or bilateral pneumothorax, persistent air leak exceeding three to five days, or high-risk occupational professions including commercial pilots and deep-sea divers. Video-assisted thoracic wedge resection of apical blebs combined with mechanical pleural abrasion or chemical pleurodesis prevents recurrent pneumothorax.",
        "say": "Primary spontaneous pneumothorax results from apical subpleural bleb rupture in young adults. Recurrent episodes or persistent air leaks warrant video-assisted apical bleb wedge resection and mechanical pleurodesis.",
        "vis": {
          "kind": "table",
          "cols": [
            "Pneumothorax indication",
            "Clinical presentation context",
            "Recommended surgical management"
          ],
          "rows": [
            [
              "Second ipsilateral episode",
              "Recurrent spontaneous collapse",
              "VATS wedge excision & pleurodesis"
            ],
            [
              "Persistent air leak > 3 days",
              "Bronchopleural fistula through chest tube",
              "Operative stapling of apical blebs"
            ],
            [
              "Tension pneumothorax",
              "Hemodynamic instability & tracheal shift",
              "Immediate needle decompression then tube"
            ],
            [
              "High-risk profession",
              "Pilot, diver, isolated geographic area",
              "Elective VATS pleurodesis on first event"
            ]
          ]
        }
      },
      {
        "tx": "Pleural empyema progresses through three distinct pathophysiological **phases**: the early exudative phase with free-flowing fluid, the fibrinopurulent phase with loculations, and the chronic organizing phase characterized by a dense fibrous peel restricting lung re-expansion. Parapneumonic effusions with pleural fluid pH below 7.2, glucose below forty milligrams per deciliter, or visible bacteria require tube thoracostomy. Fibrinopurulent or organized empyema refractory to drainage mandates video-assisted thoracic surgery or open decortication to liberate the trapped lung.",
        "say": "Pleural empyema evolves from early exudative fluid to organizing fibrous peels that trap the lung. Complicated effusions with low pH require chest tube drainage, while loculated peels mandate surgical decortication.",
        "vis": {
          "kind": "compare",
          "left": {
            "title": "Exudative & Early Empyema",
            "points": [
              "Thin, free-flowing serosanguinous fluid",
              "Pleural fluid pH > 7.2 and sterile",
              "Responds to chest tube thoracostomy"
            ]
          },
          "right": {
            "title": "Organizing Fibrous Empyema",
            "points": [
              "Dense collagenous peel traps underlying lung",
              "Pleural fluid pH < 7.2 with high LDH",
              "Mandates VATS or open decortication"
            ]
          }
        }
      }
    ]
  }
];
