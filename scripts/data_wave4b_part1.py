# Part 1 Data: Modules 1 to 5
# sur-urolithiasis, sur-renal-tumours, sur-bladder, sur-prostate, sur-testis

LESSONS_1_5 = [
    # 1. sur-urolithiasis
    {
        "module": "sur-urolithiasis",
        "subject": "surgery",
        "title": "Urolithiasis, acute renal colic, endourological procedures, and staghorn calculi",
        "minutes": 6,
        "refs": ["Sabiston Textbook of Surgery 22nd ed", "Campbell-Walsh Urology 12th ed"],
        "steps": [
            {
                "tx": "Renal **calculi** represent a frequent urological presentation affecting approximately ten percent of the adult population. Calcium oxalate stones comprise seventy-five percent of cases, followed by calcium phosphate, uric acid, and struvite. Uric acid stones are radiolucent on conventional radiography but visible on computed tomography. Struvite stones form in alkaline urine secondary to infection with urease-producing organisms such as Proteus mirabilis, often expanding into branched staghorn shapes.",
                "say": "Renal calculi affect ten percent of adults. Calcium oxalate represents seventy-five percent of stones, while uric acid and struvite comprise the remainder. Struvite stones form in alkaline urine from urease-producing bacteria and can produce staghorn configurations.",
                "vis": {
                    "kind": "table",
                    "cols": ["Stone composition", "Radiographic density", "Urinary pH profile"],
                    "rows": [
                        ["Calcium oxalate", "Opaque on radiography", "Variable urine pH"],
                        ["Uric acid", "Radiolucent on X-ray", "Acidic urine pH < 5.5"],
                        ["Struvite triple phosphate", "Faintly opaque / staghorn", "Alkaline urine pH > 7.2"],
                        ["Cystine", "Faintly radiopaque", "Acidic urine pH"]
                    ]
                }
            },
            {
                "tx": "Acute renal colic classically manifests as sudden, severe unilateral flank **pain** that radiates anteriorly toward the ipsilateral groin and genitalia. Patients typically writhe in discomfort, unlike peritonitis patients who remain motionless. Non-contrast helical computed tomography of the kidneys, ureters, and bladder represents the definitive diagnostic gold standard. It detects all stone varieties with high sensitivity, measuring stone dimensions, location, and Hounsfield unit density.",
                "say": "Acute renal colic produces severe flank pain radiating toward the groin. Non-contrast helical CT scan of the abdomen and pelvis is the gold standard diagnostic test, accurately determining stone size, location, and density.",
                "vis": {
                    "kind": "flow",
                    "nodes": [
                        {"id": "n1", "label": "Acute severe flank colic"},
                        {"id": "n2", "label": "Non-contrast helical CT scan"},
                        {"id": "n3", "label": "Assess size, density & location"},
                        {"id": "n4", "label": "Decompress or elective intervention"}
                    ],
                    "edges": [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]]
                }
            },
            {
                "tx": "Ureteral calculi smaller than five millimeters possess a seventy-five percent likelihood of spontaneous **passage** under conservative medical expulsive therapy utilizing alpha-1 adrenergic antagonists such as tamsulosin. Urgent surgical decompression with a ureteral stent or percutaneous nephrostomy is mandated when obstruction coincides with clinical infection or septic shock. Extracorporeal shock wave lithotripsy and ureteroscopy remain primary treatments for renal stones under twenty millimeters, while larger staghorn calculi necessitate percutaneous nephrolithotomy.",
                "say": "Distal ureteral stones under five millimeters frequently pass spontaneously with tamsulosin medical expulsive therapy. Obstructing stones with fever or sepsis require immediate urgent decompression with a retrograde stent or percutaneous nephrostomy. Larger stones require ureteroscopy or percutaneous nephrolithotomy.",
                "vis": {
                    "kind": "table",
                    "cols": ["Stone dimension & site", "Clinical indication", "Recommended procedure"],
                    "rows": [
                        ["Ureteral stone < 5 mm", "Uncomplicated colic", "Medical expulsive therapy"],
                        ["Obstructing stone with fever", "Urosepsis emergency", "Immediate stent or nephrostomy"],
                        ["Renal stone < 20 mm", "Symptomatic calculus", "Shock wave lithotripsy or RIRS"],
                        ["Staghorn calculus > 20 mm", "Complex pelvic stone", "Percutaneous nephrolithotomy"]
                    ]
                }
            },
            {
                "tx": "Recurrent stone formers require comprehensive metabolic **evaluation** including serum calcium, phosphate, intact parathyroid hormone, and 24-hour urine collections for calcium, oxalate, citrate, and uric acid. Thiazide diuretics decrease urinary calcium excretion, preventing calcium oxalate stone recurrence. Potassium citrate alkalinizes urine to treat and dissolve radiolucent uric acid stones. Adequate daily fluid intake exceeding two and a half liters represents the most critical universal preventive measure.",
                "say": "Metabolic evaluation in recurrent stone formers includes 24-hour urine collection for calcium, oxalate, and citrate. Thiazide diuretics reduce urinary calcium excretion, whereas potassium citrate treats uric acid stones. High daily fluid intake prevents recurrent nephrolithiasis.",
                "vis": {
                    "kind": "compare",
                    "a": {"title": "Calcium Oxalate Prevention", "bullets": ["Thiazide diuretics lower urine calcium", "Dietary calcium restriction contraindicated", "Maintain urine output > 2.5 L daily"]},
                    "b": {"title": "Uric Acid Stone Therapy", "bullets": ["Potassium citrate urine alkalinization", "Maintain urinary pH between 6.5 and 7.0", "Allopurinol for severe hyperuricosuria"]}
                }
            }
        ]
    },

    # 2. sur-renal-tumours
    {
        "module": "sur-renal-tumours",
        "subject": "surgery",
        "title": "Renal cell carcinoma, paraneoplastic syndromes, nephron-sparing surgery, and IVC thrombus",
        "minutes": 6,
        "refs": ["Sabiston Textbook of Surgery 22nd ed", "Campbell-Walsh Urology 12th ed"],
        "steps": [
            {
                "tx": "Renal cell carcinoma accounts for ninety percent of primary kidney **malignancies** in adults. Clear cell adenocarcinoma represents the dominant histological subtype, arising from proximal convoluted tubule epithelium and classically associated with von Hippel-Lindau gene mutations on chromosome 3p. Papillary renal cell carcinoma comprises fifteen percent, driven by MET proto-oncogene alterations. Chromophobe carcinoma arises from intercalated cells of the cortical collecting duct, exhibiting a more favorable clinical prognosis.",
                "say": "Renal cell carcinoma accounts for ninety percent of renal malignancies. Clear cell carcinoma arises from the proximal tubule and is linked to chromosome 3p VHL mutations. Papillary and chromophobe carcinomas comprise the remaining common subtypes.",
                "vis": {
                    "kind": "table",
                    "cols": ["RCC histological subtype", "Cell of anatomical origin", "Genetic association"],
                    "rows": [
                        ["Clear cell carcinoma", "Proximal convoluted tubule", "VHL inactivation (3p25)"],
                        ["Papillary carcinoma", "Proximal convoluted tubule", "MET proto-oncogene duplication"],
                        ["Chromophobe carcinoma", "Cortical collecting duct", "Birt-Hogg-Dube / FLCN mutation"],
                        ["Collecting duct carcinoma", "Medullary collecting duct", "Aggressive sarcomatoid variant"]
                    ]
                }
            },
            {
                "tx": "The classic clinical triad of flank pain, gross hematuria, and a palpable abdominal **mass** occurs in less than ten percent of modern cases due to widespread incidental radiological detection. Paraneoplastic syndromes occur frequently, including erythrocytosis from erythropoietin secretion, hypercalcemia from parathyroid hormone-related peptide, and Stauffer syndrome characterized by non-metastatic hepatic dysfunction. A newly developing left-sided varicocele that fails to decompress in the recumbent position suggests left renal vein tumor invasion.",
                "say": "The classic triad of flank pain, hematuria, and a palpable mass is rare today due to incidental imaging detection. Paraneoplastic manifestations include erythrocytosis, hypercalcemia, and Stauffer syndrome. A non-emptying left varicocele signals renal vein involvement.",
                "vis": {
                    "kind": "flow",
                    "nodes": [
                        {"id": "n1", "label": "Incidental renal mass on imaging"},
                        {"id": "n2", "label": "Evaluate paraneoplastic markers"},
                        {"id": "n3", "label": "Triple-phase contrast renal CT"},
                        {"id": "n4", "label": "Assess renal vein / IVC thrombus"}
                    ],
                    "edges": [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]]
                }
            },
            {
                "tx": "Triple-phase contrast-enhanced computed tomography of the abdomen and pelvis constitutes the primary staging **modality** for renal parenchymal masses. It evaluates tumor enhancement in the corticomedullary phase, washout in the nephrographic phase, and assesses renal vein or inferior vena cava tumor thrombus extension. Magnetic resonance imaging provides superior soft-tissue contrast when assessing cephalad caval thrombus propagation toward the hepatic veins or right atrium.",
                "say": "Triple-phase contrast CT scan evaluates renal mass enhancement and venous invasion into the renal vein or inferior vena cava. Magnetic resonance imaging is preferred when evaluating proximal caval tumor thrombus extending toward the right atrium.",
                "vis": {
                    "kind": "table",
                    "cols": ["IVC thrombus level", "Anatomical cranial extent", "Surgical approach"],
                    "rows": [
                        ["Level I (Subhepatic)", "Thrombus adjacent to renal vein", "Standard infrahepatic clamping"],
                        ["Level II (Intrahepatic)", "Thrombus below major hepatic veins", "Infrahepatic IVC mobilization"],
                        ["Level III (Suprahepatic)", "Thrombus reaches diaphragmatic IVC", "Retrohepatic liver mobilization"],
                        ["Level IV (Atrial)", "Thrombus extends into right atrium", "Cardiopulmonary bypass & arrest"]
                    ]
                }
            },
            {
                "tx": "Nephron-sparing partial nephrectomy represents the gold standard surgical **approach** for localized T1a renal tumors measuring four centimeters or smaller, preserving renal functional reserve while providing oncological outcomes equivalent to radical excision. Radical nephrectomy entails en bloc resection of the kidney within Gerota fascia, ipsilateral adrenal gland when indicated, and regional lymph nodes. Metastatic clear cell disease responds to vascular endothelial growth factor receptor inhibitors and immune checkpoint combination therapy.",
                "say": "Partial nephrectomy is the gold standard for tumors four centimeters or smaller to preserve renal function. Radical nephrectomy within Gerota fascia is reserved for larger lesions. Systemic VEGF inhibitors and immunotherapy treat metastatic disease.",
                "vis": {
                    "kind": "compare",
                    "a": {"title": "Partial Nephrectomy", "bullets": ["Mandatory for solitary functional kidney", "T1a tumors <= 4 cm gold standard", "Preserves long-term renal function"]},
                    "b": {"title": "Radical Nephrectomy", "bullets": ["En bloc resection within Gerota fascia", "Indicated for central or T2+ tumors", "May require IVC thrombectomy"]}
                }
            }
        ]
    },

    # 3. sur-bladder
    {
        "module": "sur-bladder",
        "subject": "surgery",
        "title": "Urothelial carcinoma of the bladder, TURBT, staging, and radical cystectomy",
        "minutes": 6,
        "refs": ["Sabiston Textbook of Surgery 22nd ed", "Campbell-Walsh Urology 12th ed"],
        "steps": [
            {
                "tx": "Urothelial transitional cell carcinoma accounts for more than ninety percent of primary urinary bladder **neoplasms** in Western countries. Cigarette smoking constitutes the single most important modifiable risk factor, increasing disease probability threefold through aromatic amine exposure. Occupational exposures to industrial dye intermediates, benzidine, and rubber compounds also strongly predispose to urothelial carcinogenesis. Squamous cell carcinoma occurs predominantly in regions with endemic Schistosoma haematobium bilharzial infection, where chronic irritation produces extensive squamous metaplasia.",
                "say": "Urothelial carcinoma accounts for ninety percent of bladder tumors, with cigarette smoking and aromatic amine exposures serving as primary causative factors. Squamous cell carcinoma is associated with chronic Schistosoma haematobium infection and recurrent irritation.",
                "vis": {
                    "kind": "table",
                    "cols": ["Histological tumor type", "Epidemiological proportion", "Primary etiological factors"],
                    "rows": [
                        ["Urothelial (transitional)", "Over 90 percent of cases", "Tobacco smoking & aromatic amines"],
                        ["Squamous cell carcinoma", "Approximately 5 percent", "Schistosoma & long-term catheters"],
                        ["Adenocarcinoma", "Under 2 percent", "Urachal remnants at bladder dome"],
                        ["Small cell neuroendocrine", "Under 1 percent", "Aggressive systemic metastasis"]
                    ]
                }
            },
            {
                "tx": "Painless gross hematuria throughout the urinary stream represents the cardinal clinical **presentation** of bladder cancer until proven otherwise. Irritative lower urinary tract voiding symptoms including frequency, urgency, and dysuria without demonstrable bacterial infection frequently accompany carcinoma in situ. Diagnostic workup mandates office flexible cystoscopy and voiding urine cytology, followed by examination under anesthesia and transurethral resection of bladder tumor to achieve definitive histological diagnosis and pathological depth staging.",
                "say": "Painless gross hematuria is the cardinal presenting sign of bladder cancer. Irritative voiding symptoms often signify carcinoma in situ. Diagnostic evaluation requires flexible cystoscopy, urine cytology, and complete transurethral resection of the bladder tumor.",
                "vis": {
                    "kind": "flow",
                    "nodes": [
                        {"id": "n1", "label": "Painless gross visible hematuria"},
                        {"id": "n2", "label": "Flexible cystoscopy & cytology"},
                        {"id": "n3", "label": "Complete transurethral resection (TURBT)"},
                        {"id": "n4", "label": "Assess detrusor muscle invasion"}
                    ],
                    "edges": [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]]
                }
            },
            {
                "tx": "Pathological staging hinges critically upon the histological presence of detrusor muscularis **propria** within the resected tissue specimen. Non-muscle-invasive bladder cancer encompasses stage Ta non-invasive papillary tumors, T1 tumors invading the subepithelial lamina propria, and Tis flat carcinoma in situ. Muscle-invasive disease encompasses stage T2 tumors invading the detrusor muscle, stage T3 invading perivesical fat, and stage T4 invading adjacent pelvic visceral structures such as the prostate, uterus, or pelvic sidewalls.",
                "say": "Pathological staging requires detrusor muscle in the resection specimen. Non-muscle-invasive cancer includes stages Ta, T1, and flat carcinoma in situ. Muscle-invasive cancer involves stage T2 detrusor invasion or deeper perivesical and pelvic organ spread.",
                "vis": {
                    "kind": "table",
                    "cols": ["Pathological T stage", "Microscopic depth of invasion", "Clinical category"],
                    "rows": [
                        ["Stage Ta", "Non-invasive papillary urothelium", "Non-muscle-invasive"],
                        ["Stage Tis", "Flat high-grade carcinoma in situ", "Non-muscle-invasive (high risk)"],
                        ["Stage T1", "Subepithelial lamina propria connective tissue", "Non-muscle-invasive"],
                        ["Stage T2", "Detrusor muscularis propria invasion", "Muscle-invasive disease"]
                    ]
                }
            },
            {
                "tx": "Non-muscle-invasive bladder cancer is managed by complete transurethral **resection** followed by intravesical chemotherapy instillation and maintenance Bacillus Calmette-Guerin immunotherapy for intermediate- and high-risk cases. Muscle-invasive disease mandates neoadjuvant cisplatin-based combination chemotherapy followed by radical cystectomy with bilateral pelvic lymphadenectomy. In men, radical cystectomy removes the bladder, prostate, and seminal vesicles, while in women it entails anterior pelvic exenteration. Urinary diversion utilizes an ileal conduit or orthotopic neobladder.",
                "say": "Non-muscle-invasive disease receives transurethral resection followed by intravesical Bacillus Calmette-Guerin therapy. Muscle-invasive bladder cancer requires neoadjuvant cisplatin chemotherapy followed by radical cystectomy, pelvic lymph node dissection, and urinary diversion.",
                "vis": {
                    "kind": "compare",
                    "a": {"title": "Non-Muscle-Invasive (NMIBC)", "bullets": ["Transurethral resection of tumor", "Adjuvant intravesical BCG immunotherapy", "Routine surveillance cystoscopy"]},
                    "b": {"title": "Muscle-Invasive (MIBC)", "bullets": ["Neoadjuvant cisplatin chemotherapy", "Radical cystoprostatectomy / exenteration", "Urinary diversion via ileal conduit / neobladder"]}
                }
            }
        ]
    },

    # 4. sur-prostate
    {
        "module": "sur-prostate",
        "subject": "surgery",
        "title": "Benign prostatic hyperplasia, prostatic adenocarcinoma, Gleason grading, and radical prostatectomy",
        "minutes": 6,
        "refs": ["Sabiston Textbook of Surgery 22nd ed", "Campbell-Walsh Urology 12th ed"],
        "steps": [
            {
                "tx": "Benign prostatic hyperplasia arises within the periurethral transition **zone** of the prostate gland under the permissive endocrine influence of dihydrotestosterone, synthesized locally by 5-alpha reductase type 2. Progressive nodular hyperplasia compresses the prostatic urethra, producing bladder outlet obstruction and lower urinary tract symptoms. Prostatic adenocarcinoma, by contrast, develops predominantly in the posterior peripheral zone in seventy percent of cases, remaining asymptomatic until local extension or distant bone metastases supervene.",
                "say": "Benign prostatic hyperplasia arises in the periurethral transition zone under dihydrotestosterone stimulation, causing urinary outflow obstruction. Prostatic adenocarcinoma develops primarily in the posterior peripheral zone, presenting silently without early obstruction.",
                "vis": {
                    "kind": "table",
                    "cols": ["Prostate anatomical zone", "Associated pathological entity", "Clinical presentation pattern"],
                    "rows": [
                        ["Transition zone", "Benign prostatic hyperplasia (BPH)", "Early urinary outflow obstruction"],
                        ["Peripheral zone", "Prostatic adenocarcinoma (70%)", "Palpable nodule on digital rectal exam"],
                        ["Central zone", "Uncommon benign / malignant growth", "Surrounds ejaculatory ducts"],
                        ["Anterior fibromuscular stroma", "Devoid of glandular tissue", "Non-neoplastic structural zone"]
                    ]
                }
            },
            {
                "tx": "Serum prostate-specific antigen is a kallikrein-like **serine** protease produced by prostatic epithelial cells to liquefy seminal coagulum. Elevated serum levels indicate disrupted prostatic architecture rather than cancer-specific transformation, occurring in BPH, prostatitis, urinary retention, and trauma. A total PSA level exceeding four nanograms per milliliter warrants diagnostic evaluation. A free-to-total PSA ratio under fifteen percent increases cancer suspicion, while multiparametric MRI utilizing PI-RADS scoring guides targeted transperineal or transrectal biopsies.",
                "say": "Prostate-specific antigen is an organ-specific serine protease that rises with architectural disruption in cancer, BPH, or prostatitis. A level exceeding four nanograms or a low free-to-total ratio prompts multiparametric MRI and targeted biopsy.",
                "vis": {
                    "kind": "flow",
                    "nodes": [
                        {"id": "n1", "label": "Elevated PSA or abnormal rectal exam"},
                        {"id": "n2", "label": "Multiparametric prostate MRI (PI-RADS)"},
                        {"id": "n3", "label": "Targeted plus systematic core biopsy"},
                        {"id": "n4", "label": "Gleason score & risk stratification"}
                    ],
                    "edges": [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]]
                }
            },
            {
                "tx": "Histopathological grading utilizes the Gleason architecture **scoring** system, combining the most predominant and second most common glandular architectural patterns into five prognostic Grade Groups. Grade Group 1 corresponds to Gleason score 3+3=6, exhibiting excellent clinical prognosis. Grade Group 5 corresponds to Gleason scores 9 and 10, characterized by sheets of undifferentiated cells or comedonecrosis. Staging incorporates digital examination, serum PSA, bone scintigraphy for osteoblastic skeletal metastases, and PSMA PET imaging.",
                "say": "Histological grading uses the Gleason system, grouping architectural patterns into Grade Groups 1 through 5. Bone scintigraphy and prostate-specific membrane antigen PET scans identify osteoblastic bone metastases in high-risk disease.",
                "vis": {
                    "kind": "table",
                    "cols": ["Gleason score pattern", "Grade Group designation", "Clinical biological behavior"],
                    "rows": [
                        ["Gleason 3 + 3 = 6", "Grade Group 1", "Indolent / active surveillance candidate"],
                        ["Gleason 3 + 4 = 7", "Grade Group 2", "Favorable intermediate risk"],
                        ["Gleason 4 + 3 = 7", "Grade Group 3", "Unfavorable intermediate risk"],
                        ["Gleason 4 + 4 = 8", "Grade Group 4", "High risk / aggressive local invasion"],
                        ["Gleason 9 or 10", "Grade Group 5", "Very high risk / high metastatic potential"]
                    ]
                }
            },
            {
                "tx": "Management of localized prostate cancer encompasses active **surveillance** for low-risk disease, robotic-assisted radical prostatectomy, or external beam radiation with concurrent androgen deprivation therapy. Radical prostatectomy removes the prostate, seminal vesicles, and ampullae of the vasa deferentia, with bilateral pelvic lymphadenectomy for intermediate- and high-risk tumors. For symptomatic BPH refractory to medical alpha-blocker and 5-alpha reductase inhibitor therapy, transurethral resection of the prostate remains the definitive endoscopic benchmark.",
                "say": "Localized prostate cancer is managed with active surveillance, robotic radical prostatectomy, or external beam radiotherapy with androgen deprivation. Refractory BPH is treated definitively with transurethral resection of the prostate.",
                "vis": {
                    "kind": "compare",
                    "a": {"title": "Radical Prostatectomy", "bullets": ["Complete prostate & seminal vesicle removal", "Bilateral pelvic lymph node dissection", "Risks: stress incontinence & erectile dysfunction"]},
                    "b": {"title": "Endoscopic BPH Surgery", "bullets": ["Transurethral resection of prostate (TURP)", "Removes adenomatous transition zone tissue", "Preserves peripheral zone and outer capsule"]}
                }
            }
        ]
    },

    # 5. sur-testis
    {
        "module": "sur-testis",
        "subject": "surgery",
        "title": "Testicular germ cell tumors, serum markers, radical inguinal orchiectomy, and retroperitoneal dissection",
        "minutes": 6,
        "refs": ["Sabiston Textbook of Surgery 22nd ed", "Campbell-Walsh Urology 12th ed"],
        "steps": [
            {
                "tx": "Testicular neoplasms represent the most frequent solid **malignancy** in young adult men aged fifteen to thirty-five years. Germ cell tumors comprise ninety-five percent of primary neoplasms, stratified clinically into seminomas and non-seminomatous germ cell tumors. Seminomas represent fifty percent of cases, composed of sheets of uniform cells with clear glycogen-rich cytoplasm, prominent nucleoli, and delicate fibrous septa infiltrated by lymphocytes. Cryptorchidism increases testicular malignancy risk four- to eightfold, even following successful early orchidopexy.",
                "say": "Testicular tumors are the most common solid cancer in young men. Germ cell tumors are divided into seminomas and non-seminomatous subtypes. Cryptorchidism increases malignancy risk several fold, even after corrective surgical orchidopexy.",
                "vis": {
                    "kind": "table",
                    "cols": ["Germ cell tumor subtype", "Histological features", "Serum tumor marker profile"],
                    "rows": [
                        ["Classic seminoma", "Uniform clear cells with lymphoid stroma", "Normal AFP; beta-hCG elevated in 15%"],
                        ["Embryonal carcinoma", "Anaplastic pleomorphic glandular sheets", "Both AFP and beta-hCG may be elevated"],
                        ["Yolk sac tumor", "Schiller-Duval bodies & microcysts", "Serum AFP elevated in nearly 100%"],
                        ["Choriocarcinoma", "Syncytio- and cytotrophoblasts", "Profoundly elevated serum beta-hCG"]
                    ]
                }
            },
            {
                "tx": "Serum tumor markers play an indispensable **role** in the diagnosis, clinical staging, risk stratification, and post-treatment monitoring of testicular neoplasms. Alpha-fetoprotein has a serum half-life of five to seven days, produced by yolk sac elements and embryonal carcinomas, but never by pure seminomas. Beta-human chorionic gonadotropin has a half-life of twenty-four to thirty-six hours, produced by syncytiotrophoblastic cells. Serum lactate dehydrogenase reflects overall tumor cell turnover and metabolic bulk.",
                "say": "Serum tumor markers include alpha-fetoprotein, beta-hCG, and lactate dehydrogenase. Alpha-fetoprotein is never produced by pure seminomas. Tracking marker half-lives verifies complete surgical resection and monitors treatment response.",
                "vis": {
                    "kind": "flow",
                    "nodes": [
                        {"id": "n1", "label": "Painless testicular enlargement"},
                        {"id": "n2", "label": "High-frequency scrotal Doppler ultrasound"},
                        {"id": "n3", "label": "Preoperative baseline serum markers"},
                        {"id": "n4", "label": "Radical inguinal orchiectomy"}
                    ],
                    "edges": [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]]
                }
            },
            {
                "tx": "A painless, firm intratesticular mass that does not **transilluminate** warrants immediate high-frequency Doppler ultrasonography. If an intratesticular vascular lesion is confirmed, radical inguinal orchiectomy with high ligation of the spermatic cord at the internal inguinal ring is mandatory. Transscrotal biopsy or scrotal orchiectomy is strictly contraindicated because violating the scrotal wall disrupts native retroperitoneal lymphatic drainage, predisposing to aberrant tumor dissemination into superficial inguinal lymph nodes.",
                "say": "Any firm intratesticular mass requires prompt scrotal Doppler ultrasound. Radical inguinal orchiectomy with high cord ligation is mandatory. Scrotal incision or needle biopsy is strictly prohibited to avoid altering lymphatic drainage.",
                "vis": {
                    "kind": "table",
                    "cols": ["Surgical step / decision", "Technical execution", "Oncological rationale"],
                    "rows": [
                        ["Skin incision", "Inguinal incision above groin crease", "Avoids scrotal skin contamination"],
                        ["Spermatic cord control", "Early cross-clamping at internal ring", "Prevents hematogenous tumor extrusion"],
                        ["En bloc mobilization", "Mobilize testis within tunica vaginalis", "Complete oncological resection margin"],
                        ["Contraindicated action", "Transscrotal needle or open biopsy", "Spills tumor into inguinal nodal basin"]
                    ]
                }
            },
            {
                "tx": "Staging requires abdominopelvic and chest computed **tomography** combined with serial post-orchiectomy serum marker decay kinetics. Primary lymphatic drainage from the right testis enters the interaortocaval and precaval nodes, while the left testis drains to the left para-aortic nodes. Seminomas demonstrate exquisite radiosensitivity and chemosensitivity to cisplatin-based regimens. Non-seminomatous tumors with persistent retroperitoneal lymphadenopathy exceeding one centimeter following induction chemotherapy mandate nerve-sparing retroperitoneal lymph node dissection to resect teratoma or viable residual carcinoma.",
                "say": "Staging involves contrast CT imaging and post-orchiectomy marker monitoring. Seminomas respond exquisitely to radiotherapy and cisplatin chemotherapy. Persistent post-chemotherapy retroperitoneal masses in non-seminomatous disease require retroperitoneal lymph node dissection.",
                "vis": {
                    "kind": "compare",
                    "a": {"title": "Seminoma Management", "bullets": ["Exquisitely sensitive to radiotherapy", "Surveillance or single-agent carboplatin in stage I", "BEP chemotherapy for advanced disease"]},
                    "b": {"title": "Non-Seminoma Management", "bullets": ["Retroperitoneal lymph node dissection (RPLND)", "BEP chemotherapy (bleomycin, etoposide, cisplatin)", "Resect post-chemo residual masses > 1 cm"]}
                }
            }
        ]
    }
]
