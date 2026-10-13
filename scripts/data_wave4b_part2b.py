# Part 2b Data: Modules 16 to 20
# sur-paed-uro, sur-transplant, sur-uro-congenital, sur-urethra-penis, sur-atls

LESSONS_16_20 = [
    # 16. sur-paed-uro
    {
        "module": "sur-paed-uro",
        "subject": "surgery",
        "title": "Paediatric urology, hypospadias, cryptorchidism, and Wilms tumor",
        "minutes": 6,
        "refs": ["Sabiston Textbook of Surgery 22nd ed", "Campbell-Walsh Urology 12th ed"],
        "steps": [
            {
                "tx": "Hypospadias represents a common congenital penile **anomaly** characterized by incomplete development of the anterior urethra, resulting in a ventrally displaced urethral meatus, ventral fibrous chordee curvature, and a deficient ventral prepuce creating a dorsal hood. Neonatal circumcision is strictly contraindicated because the vascularized dorsal prepuce provides essential tissue for future surgical reconstruction. Surgical repair utilizing tubularized incised plate urethroplasty is ideally scheduled between six and eighteen months of age to minimize psychological awareness.",
                "say": "Hypospadias features a ventrally displaced urethral meatus, ventral chordee, and a dorsal prepuce hood. Neonatal circumcision is strictly contraindicated to preserve foreskin for reconstruction, with urethroplasty scheduled between six and eighteen months.",
                "vis": {
                    "kind": "table",
                    "cols": ["Hypospadias anatomic class", "Urethral meatus position", "Surgical reconstructive approach"],
                    "rows": [
                        ["Distal (Glandular/coronal)", "Glans or coronal sulcus (65%)", "Tubularized incised plate (Snodgrass)"],
                        ["Midshaft penile", "Mid-pendulous shaft (15%)", "Onlay island flap or incised plate"],
                        ["Proximal (Penoscrotal)", "Scrotum or perineum (20%)", "Staged buccal mucosa graft urethroplasty"],
                        ["Associated chordee", "Ventral tunical tethering", "Dorsal plication / degloving release"]
                    ]
                }
            },
            {
                "tx": "Cryptorchidism denotes failure of normal testicular **descent** into the scrotal sac, increasing risks of impaired spermatogenesis, testicular torsion, inguinal hernia, and malignant testicular germ cell degeneration. The increased risk of testicular cancer persists throughout life, involving both the undescended and contralateral descended testicles. Diagnostic laparoscopy represents the definitive investigation for non-palpable intra-abdominal testicles. Surgical orchidopexy with fixation within a subdartos pouch is recommended between six and twelve months of age to preserve germinal epithelium.",
                "say": "Cryptorchidism increases the risk of subfertility and testicular cancer in both testes. Diagnostic laparoscopy is the gold standard for non-palpable intra-abdominal testes. Surgical orchidopexy is performed between six and twelve months of age.",
                "vis": {
                    "kind": "flow",
                    "nodes": [
                        {"id": "n1", "label": "Undescended testis on neonatal exam"},
                        {"id": "n2", "label": "Palpate inguinal canal carefully"},
                        {"id": "n3", "label": "Diagnostic laparoscopy if non-palpable"},
                        {"id": "n4", "label": "Orchidopexy between 6 and 12 months"}
                    ],
                    "edges": [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]]
                }
            },
            {
                "tx": "Posterior urethral valves represent the most common cause of congenital lower urinary **tract** obstruction in newborn boys, consisting of obstructing mucosal folds within the prostatic urethra. Fetal ultrasound reveals bilateral hydroureteronephrosis, distended thick-walled bladder with a dilated posterior urethra termed the keyhole sign, and oligohydramnios producing secondary pulmonary hypoplasia. Urgent neonatal decompression with a small feeding tube followed by cystoscopic transurethral valve ablation restores urinary outflow and preserves renal function.",
                "say": "Posterior urethral valves produce severe urinary outflow obstruction in male neonates, displaying the keyhole bladder sign and hydronephrosis on ultrasound. Prompt transurethral valve ablation prevents progressive chronic renal failure.",
                "vis": {
                    "kind": "table",
                    "cols": ["Pathological entity", "Diagnostic imaging sign", "Clinical management priority"],
                    "rows": [
                        ["Posterior urethral valves", "Keyhole sign on bladder ultrasound", "Primary endoscopic valve ablation"],
                        ["Vesicoureteral reflux (VUR)", "Retrograde contrast into ureter on VCUG", "Prophylactic antibiotics or ureteral reimplantation"],
                        ["Reflux nephropathy", "Cortical scarring on DMSA scintigraphy", "Control hypertension & prevent infection"],
                        ["Antenatal hydronephrosis", "Renal pelvis AP diameter > 10 mm", "Postnatal ultrasound & MAG3 renography"]
                    ]
                }
            },
            {
                "tx": "Wilms tumor represents the most frequent malignant renal **tumor** of childhood, presenting at a median age of three years with an asymptomatic, smooth, firm abdominal flank mass that rarely crosses the midline. Neuroblastoma, by contrast, arises from sympathetic neuroblasts in the adrenal gland or retroperitoneum, presenting as a hard, irregular mass that frequently crosses the aortic midline and encases major vascular structures. Wilms tumor is treated by multimodality chemotherapy and radical nephrectomy without prior needle biopsy.",
                "say": "Wilms tumor presents in toddlers as a smooth painless flank mass that rarely crosses the midline. Neuroblastoma arises from sympathetic tissue, is calcified, and characteristically crosses the aortic midline. Multimodal therapy achieves high cure rates.",
                "vis": {
                    "kind": "compare",
                    "a": {"title": "Wilms Tumor (Nephroblastoma)", "bullets": ["Smooth, firm mass; rarely crosses midline", "Arises from metanephric renal blastema", "Biopsy contraindicated; radical nephrectomy", "WT1 gene deletion on chromosome 11p13"]},
                    "b": {"title": "Neuroblastoma", "bullets": ["Irregular, nodular mass; crosses midline", "Arises from neural crest adrenal medulla", "Elevated urinary VMA and HVA catecholamines", "Frequent encasement of mesenteric vessels"]}
                }
            }
        ]
    },

    # 17. sur-transplant
    {
        "module": "sur-transplant",
        "subject": "surgery",
        "title": "Organ transplantation, allorecognition, rejection mechanisms, and renal allografting",
        "minutes": 6,
        "refs": ["Sabiston Textbook of Surgery 22nd ed", "Danovitch Handbook of Kidney Transplantation 6th ed"],
        "steps": [
            {
                "tx": "Allogeneic organ transplantation requires matching of human leukocyte **antigens** encoded within the major histocompatibility complex on chromosome 6. Class I molecules including HLA-A, B, and C are expressed on all nucleated cells and present endogenous antigens to CD8 cytotoxic T lymphocytes. Class II molecules including HLA-DR, DP, and DQ are restricted to antigen-presenting cells and present exogenous antigens to CD4 helper T lymphocytes. Direct allorecognition occurs when recipient T cells recognize intact intact donor MHC molecules directly.",
                "say": "Organ transplantation relies on matching HLA class I and class II antigens. Class I antigens present to CD8 cytotoxic T cells, while class II molecules present to CD4 helper cells. Direct allorecognition drives acute allograft rejection.",
                "vis": {
                    "kind": "table",
                    "cols": ["MHC / HLA category", "Tissue expression pattern", "Target T lymphocyte subset"],
                    "rows": [
                        ["Class I (HLA-A, B, C)", "All nucleated somatic cells", "CD8+ cytotoxic T lymphocytes"],
                        ["Class II (HLA-DR, DP, DQ)", "Dendritic cells, macrophages, B cells", "CD4+ helper T lymphocytes"],
                        ["Direct allorecognition", "Recipient T cells bind donor intact MHC", "Drives early acute cellular rejection"],
                        ["Indirect allorecognition", "Recipient APCs process donor peptides", "Drives chronic antibody-mediated rejection"]
                    ]
                }
            },
            {
                "tx": "Allograft rejection is categorized into hyperacute, acute cellular, acute **antibody-mediated**, and chronic rejection. Hyperacute rejection occurs within minutes to hours, driven by pre-existing circulating anti-donor antibodies that activate complement, producing microvascular thrombosis, graft cyanosis, and cortical necrosis; it is prevented by complement-dependent cytotoxicity crossmatching. Acute cellular rejection develops within weeks to months, featuring T-lymphocyte tubulitis and interstitial infiltrate that responds to pulsed methylprednisolone. Chronic rejection manifests with progressive obliterative graft vasculopathy and interstitial fibrosis.",
                "say": "Hyperacute rejection occurs within minutes from preformed antibodies and is prevented by crossmatching. Acute cellular rejection manifests as T-cell tubulitis responsive to intravenous corticosteroids, while chronic rejection causes irreversible graft fibrosis.",
                "vis": {
                    "kind": "flow",
                    "nodes": [
                        {"id": "n1", "label": "Donor-recipient HLA typing & crossmatch"},
                        {"id": "n2", "label": "Negative crossmatch confirms suitability"},
                        {"id": "n3", "label": "Induction therapy with basiliximab / ATG"},
                        {"id": "n4", "label": "Maintenance triple immunosuppression"}
                    ],
                    "edges": [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]]
                }
            },
            {
                "tx": "Maintenance immunosuppression typically incorporates a triple-drug **regimen** consisting of a calcineurin inhibitor, an antimetabolite, and a corticosteroid. Tacrolimus binds FK-binding protein 12 to inhibit calcineurin phosphatase, blocking interleukin-2 transcription; therapeutic monitoring of trough blood levels is mandatory to prevent nephrotoxicity and neurotoxicity. Mycophenolate mofetil reversibly inhibits inosine monophosphate dehydrogenase, blocking de novo purine synthesis in proliferating lymphocytes. Basiliximab or anti-thymocyte globulin provides biological induction therapy during the perioperative implantation window.",
                "say": "Triple maintenance immunosuppression includes tacrolimus, mycophenolate mofetil, and prednisone. Tacrolimus blocks interleukin-2 transcription, requiring trough monitoring to avoid nephrotoxicity. Mycophenolate inhibits de novo purine synthesis in lymphocytes.",
                "vis": {
                    "kind": "table",
                    "cols": ["Immunosuppressive agent", "Molecular pharmacological target", "Primary clinical adverse effect"],
                    "rows": [
                        ["Tacrolimus (CNI)", "Inhibits calcineurin phosphatase / IL-2", "Nephrotoxicity, tremor, new-onset diabetes"],
                        ["Cyclosporine (CNI)", "Binds cyclophilin / blocks calcineurin", "Nephrotoxicity, gingival hyperplasia, hirsutism"],
                        ["Mycophenolate mofetil", "Inhibits IMPDH / blocks purine synthesis", "Gastrointestinal diarrhea, leukopenia"],
                        ["Corticosteroids", "Inhibits NF-kB & cytokine transcription", "Hypertension, hyperglycemia, osteoporosis"]
                    ]
                }
            },
            {
                "tx": "Renal transplantation involves heterotopic placement of the donor **allograft** within the recipient iliac fossa extraperitoneally. Vascular reconstruction anastomoses the donor renal vein end-to-side to the external iliac vein, and the donor renal artery end-to-side to the external iliac artery. Urinary continuity is re-established via an extravesical Lich-Gregoir ureteroneocystostomy over an internal double-J stent. Early postoperative oliguria warrants immediate Doppler ultrasonography to rule out renal artery thrombosis, renal vein kinking, or perigraft fluid collections such as urinoma or lymphocele.",
                "say": "Renal transplantation places the kidney extraperitoneally in the iliac fossa. Vascular anastomoses connect to the external iliac vessels, and the ureter is implanted into the bladder. Postoperative oliguria mandates Doppler ultrasound to exclude vascular thrombosis.",
                "vis": {
                    "kind": "compare",
                    "a": {"title": "Renal Vascular Anastomosis", "bullets": ["Donor renal vein to external iliac vein", "Donor renal artery to external iliac artery", "Meticulous de-airing prior to clamp release"]},
                    "b": {"title": "Ureteral Reimplantation", "bullets": ["Extravesical Lich-Gregoir ureteroneocystostomy", "Submucosal anti-reflux tunneling into bladder", "Protected by internal double-J ureteral stent"]}
                }
            }
        ]
    },

    # 18. sur-uro-congenital
    {
        "module": "sur-uro-congenital",
        "subject": "surgery",
        "title": "Congenital urinary tract anomalies, ureteropelvic obstruction, duplex ureter, and pyeloplasty",
        "minutes": 6,
        "refs": ["Sabiston Textbook of Surgery 22nd ed", "Campbell-Walsh Urology 12th ed"],
        "steps": [
            {
                "tx": "Congenital pelviureteric junction obstruction represents the most frequent **cause** of significant pediatric hydronephrosis, characterized by impaired urine transport from the renal pelvis into the proximal ureter. Intrinsic aperistaltic ureteral segments or extrinsic mechanical compression by lower pole crossing accessory renal vessels account for the obstruction. Infants present with palpable abdominal masses or urinary tract infections, while older children develop intermittent Dietl crises with severe episodic flank pain following excessive fluid consumption and diuresis.",
                "say": "Pelviureteric junction obstruction is the most common cause of neonatal hydronephrosis. Aperistaltic ureteral segments or crossing vessels impede flow, causing Dietl crises with flank pain after heavy fluid intake.",
                "vis": {
                    "kind": "table",
                    "cols": ["Etiological mechanism", "Underlying pathological defect", "Typical age of clinical detection"],
                    "rows": [
                        ["Intrinsic UPJ obstruction", "Aperistaltic collagenous muscular segment", "Antenatal ultrasound or newborn period"],
                        ["Extrinsic crossing vessel", "Lower pole accessory renal artery compression", "Older children and young adults"],
                        ["High ureteral insertion", "Angulation at pelvic-ureteral junction", "Childhood intermittent flank fullness"],
                        ["Secondary UPJ stricture", "Chronic reflux-induced pelvic tortuosity", "Associated with high-grade VUR"]
                    ]
                }
            },
            {
                "tx": "Evaluation requires renal ultrasonography and dynamic diuretic **renography** utilizing technetium-99m mercaptoacetyltriglycine (MAG3) with intravenous furosemide challenge. A persistent non-clearing excretion curve with an elimination half-time exceeding twenty minutes confirms functional obstruction. The surgical gold standard for symptomatic or progressive functional obstruction is the Anderson-Hynes dismembered pyeloplasty, excising the aperistaltic segment, trimming the redundant renal pelvis, and reconstructing a widely spatulated, tension-free pelviureteric anastomosis over an internal double-J stent.",
                "say": "Diuretic MAG3 renography confirms obstruction when clearance half-time exceeds twenty minutes. Anderson-Hynes dismembered pyeloplasty represents the gold standard surgical repair, excising the aperistaltic segment and constructing a spatulated anastomosis.",
                "vis": {
                    "kind": "flow",
                    "nodes": [
                        {"id": "n1", "label": "Hydronephrosis on renal ultrasound"},
                        {"id": "n2", "label": "MAG3 diuretic renogram with furosemide"},
                        {"id": "n3", "label": "Obstructive washout curve (T1/2 > 20 min)"},
                        {"id": "n4", "label": "Anderson-Hynes dismembered pyeloplasty"}
                    ],
                    "edges": [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]]
                }
            },
            {
                "tx": "Duplex collecting systems follow the classic Weigert-Meyer **law** of embryological development in complete ureteral duplication. The upper pole moiety ureter inserts ectopically into the bladder more inferomedially than normal, frequently terminating in an obstructing ureterocele. The lower pole moiety ureter inserts orthotopically into the bladder higher and more laterally, possessing a shortened intramural tunnel that strongly predisposes to vesicoureteral reflux and recurrent pyelonephritis. Ectopic ureter insertion distal to the external urinary sphincter produces continuous incontinence in females.",
                "say": "In duplex systems, the Weigert-Meyer law dictates that the upper pole ureter inserts inferomedially and tends to obstruct with a ureterocele. The lower pole ureter inserts laterally and refluxes. Ectopic insertion distal to the sphincter causes continuous female dribbling.",
                "vis": {
                    "kind": "table",
                    "cols": ["Duplex renal moiety", "Bladder insertion location", "Pathological complication"],
                    "rows": [
                        ["Upper pole moiety ureter", "Inferomedial ectopic insertion", "Ureterocele and urinary obstruction"],
                        ["Lower pole moiety ureter", "Superolateral orthotopic insertion", "Vesicoureteral reflux & pyelonephritis"],
                        ["Ectopic ureter in females", "Vagina or urethra below sphincter", "Continuous urinary dribbling"],
                        ["Ectopic ureter in males", "Prostatic urethra / seminal vesicle", "Epididymitis without incontinence"]
                    ]
                }
            },
            {
                "tx": "Autosomal dominant polycystic kidney disease results from mutations in the **PKD1** gene on chromosome 16 or PKD2 on chromosome 4, manifesting in adult life with bilateral palpable renal enlargement, flank pain, microscopic hematuria, hypertension, and progressive renal insufficiency. Extrarenal manifestations include hepatic cysts, mitral valve prolapse, and intracranial berry aneurysms of the circle of Willis. Bladder exstrophy represents a severe midline infraumbilical defect with an open exposed bladder plate and pubic diastasis, treated by multidisciplinary staged functional closure.",
                "say": "Autosomal dominant polycystic kidney disease produces bilateral massive cyst formation, hypertension, and intracranial berry aneurysms. Bladder exstrophy features an exposed bladder wall and wide pubic diastasis requiring staged reconstructive closure.",
                "vis": {
                    "kind": "compare",
                    "a": {"title": "ADPKD (Adult Form)", "bullets": ["PKD1 (16p13) or PKD2 (4q21) mutations", "Massive bilateral cysts in adult life", "Associated with cerebral berry aneurysms"]},
                    "b": {"title": "ARPKD (Infantile Form)", "bullets": ["PKHD1 fibrocystin gene mutation", "Congenital bilateral enlarged spongy kidneys", "Obligatory congenital hepatic fibrosis"]}
                }
            }
        ]
    },

    # 19. sur-urethra-penis
    {
        "module": "sur-urethra-penis",
        "subject": "surgery",
        "title": "Urethral stricture disease, urethroplasty techniques, and penile carcinoma",
        "minutes": 6,
        "refs": ["Sabiston Textbook of Surgery 22nd ed", "Campbell-Walsh Urology 12th ed"],
        "steps": [
            {
                "tx": "Urethral stricture disease arises from ischemic scarring and progressive spongiofibrosis within the corpus **spongiosum** surrounding the urethral epithelium. Etiologies include iatrogenic trauma from traumatic catheterization or transurethral instrumentation, straddle pelvic perineal trauma, chronic urethritis from Neisseria gonorrhoeae, and lichen sclerosus balanitis xerotica obliterans. The bulbar urethra represents the most frequent anatomical site of anterior urethral strictures, producing progressive obstructive voiding symptoms, decreased urinary stream force, and post-void dribbling.",
                "say": "Urethral strictures result from spongiofibrosis in the corpus spongiosum, commonly following catheterization, straddle trauma, or gonococcal infection. The bulbar urethra is the most frequent site, causing decreased urinary flow and post-void dribbling.",
                "vis": {
                    "kind": "table",
                    "cols": ["Stricture anatomical region", "Etiological causal mechanism", "Preferred reconstructive approach"],
                    "rows": [
                        ["Bulbar urethra", "Straddle injury / iatrogenic instrumentation", "Excision & primary anastomosis (< 2 cm)"],
                        ["Penile pendulous urethra", "Lichen sclerosus / failed hypospadias", "Buccal mucosa graft substitution"],
                        ["Membranous urethra", "Pelvic fracture urethral distraction (PFUI)", "Delayed anastomotic perineal repair"],
                        ["Fossa navicularis / meatus", "Chronic balanitis xerotica obliterans", "Extended meatoplasty / graft onlay"]
                    ]
                }
            },
            {
                "tx": "Retrograde urethrography combined with voiding cystourethrography constitutes the gold standard diagnostic **imaging** modality, delineating stricture length, caliber, anatomical location, and associated false passages or diverticula. For short bulbar strictures under two centimeters, primary anastomotic urethroplasty provides long-term success rates exceeding ninety percent by excising the fibrotic segment and performing a spatulated end-to-end anastomosis. Long or complex penile strictures require substitution urethroplasty utilizing autologous buccal mucosal graft onlays, which possess a thick elastin-rich lamina propria facilitating robust vascular inosculation.",
                "say": "Retrograde urethrography is the diagnostic gold standard, mapping stricture length and location. Short bulbar strictures are cured by primary anastomotic urethroplasty, while long strictures require substitution urethroplasty with buccal mucosal grafts.",
                "vis": {
                    "kind": "flow",
                    "nodes": [
                        {"id": "n1", "label": "Obstructive lower urinary voiding symptoms"},
                        {"id": "n2", "label": "Retrograde urethrogram & cystourethrogram"},
                        {"id": "n3", "label": "Measure stricture length & spongiofibrosis"},
                        {"id": "n4", "label": "Anastomotic repair (< 2 cm) vs buccal graft"}
                    ],
                    "edges": [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]]
                }
            },
            {
                "tx": "Penile carcinoma represents an uncommon malignancy in developed nations, with squamous cell carcinoma accounting for ninety-five **percent** of cases. Uncircumcised status with chronic phimosis, poor hygiene, smegma accumulation, and high-risk human papillomavirus infection (types 16 and 18) are primary risk factors. Premalignant lesions include erythroplasia of Queyrat on the glans and Bowen disease on the shaft. Tumors present as painless, non-healing ulcerations or exophytic verrucous masses on the glans penis or prepuce.",
                "say": "Squamous cell carcinoma accounts for ninety-five percent of penile cancers, linked to uncircumcised status with phimosis, poor hygiene, and human papillomavirus infection. Lesions present as painless non-healing ulcers on the glans or foreskin.",
                "vis": {
                    "kind": "table",
                    "cols": ["Penile lesion type", "Clinical morphology & site", "Malignancy potential"],
                    "rows": [
                        ["Erythroplasia of Queyrat", "Velvety red plaque on glans / prepuce", "Carcinoma in situ (10-30% invasive)"],
                        ["Bowen disease", "Crusted solitary plaque on penile shaft", "Carcinoma in situ"],
                        ["Buschke-Lowenstein tumor", "Giant verrucous condyloma of glans", "Locally aggressive non-metastasizing"],
                        ["Invasive squamous carcinoma", "Ulcerated or fungating glans lesion", "Regional inguinal nodal metastases"]
                    ]
                }
            },
            {
                "tx": "Surgical management prioritizes complete oncological clearance while preserving maximum penile length for upright micturition and sexual **function**. Superficial low-grade tumors are managed with organ-sparing glansectomy or wide local excision, whereas invasive corporal lesions necessitate partial penectomy with a minimum clear margin of two to three millimeters, or total penectomy with perineal urethrostomy. Bilateral inguinal lymphadenectomy is indicated for intermediate- and high-risk primary tumors or palpable adenopathy persisting after antimicrobial therapy.",
                "say": "Surgical treatment aims for oncological clearance with functional length preservation. Low-grade lesions undergo organ-sparing glansectomy, while deep corporal invasion requires partial or total penectomy with inguinal lymph node dissection.",
                "vis": {
                    "kind": "compare",
                    "a": {"title": "Organ-Sparing Surgery", "bullets": ["Wide local excision or glansectomy", "Indicated for superficial T1 disease", "Preserves corporal length & function"]},
                    "b": {"title": "Radical Resection", "bullets": ["Partial penectomy or total penectomy", "Indicated for T2+ corporal cavernous invasion", "Bilateral inguinal lymph node staging"]}
                }
            }
        ]
    },

    # 20. sur-atls
    {
        "module": "sur-atls",
        "subject": "surgery",
        "title": "Advanced Trauma Life Support, primary survey, definitive airway, and lethal triad",
        "minutes": 6,
        "refs": ["Sabiston Textbook of Surgery 22nd ed", "ATLS Advanced Trauma Life Support 10th ed"],
        "steps": [
            {
                "tx": "The Advanced Trauma Life Support primary survey organizes resuscitation into an orderly sequence designed to rapidly identify and treat immediately life-threatening **injuries**. The survey follows the ABCDE mnemonic: airway with cervical spine motion restriction, breathing and ventilation, circulation with hemorrhage control, disability and neurological status, and exposure with environmental hypothermia prevention. Resuscitative interventions occur concurrently with assessment, and deterioration at any stage mandates immediate reversion to airway re-evaluation.",
                "say": "The ATLS primary survey follows the ABCDE sequence: airway with cervical protection, breathing, circulation with hemorrhage control, neurological disability, and environmental exposure. Deterioration mandates immediate return to airway re-evaluation.",
                "vis": {
                    "kind": "table",
                    "cols": ["Primary survey step", "Clinical assessment target", "Immediate life-saving intervention"],
                    "rows": [
                        ["Airway with C-spine", "Vocal responsiveness & airway patency", "Chin lift, jaw thrust, endotracheal tube"],
                        ["Breathing", "Tension pneumothorax, open chest wound", "Needle thoracostomy, chest tube, 3-sided dressing"],
                        ["Circulation", "External exsanguination & internal shock", "Direct pressure, pelvic binder, 1:1:1 blood"],
                        ["Disability", "Glasgow Coma Scale & pupillary light", "Correct hypoxia, hypotension, herniation"],
                        ["Exposure", "Complete body inspection & hypothermia", "Warm blankets, fluid warmers, room control"]
                    ]
                }
            },
            {
                "tx": "Establishing a definitive airway is indicated for apnea, severe neurological depression with Glasgow Coma Scale score of eight or **less**, impending airway compromise from inhalation burns, severe maxillofacial fractures, or inability to maintain oxygenation. Endotracheal intubation with rapid sequence induction and in-line manual cervical stabilization represents the primary approach. When endotracheal intubation fails or is anatomically impossible, surgical cricothyroidotomy through the cricothyroid membrane provides emergency surgical access in adults, whereas needle cricothyroidotomy is preferred in children under twelve.",
                "say": "Definitive airway placement is indicated for coma with GCS eight or less, apnea, or severe facial trauma. Endotracheal intubation with manual in-line cervical stabilization is first-line, followed by surgical cricothyroidotomy if intubation fails.",
                "vis": {
                    "kind": "flow",
                    "nodes": [
                        {"id": "n1", "label": "Severe trauma with airway compromise"},
                        {"id": "n2", "label": "Rapid sequence intubation with C-spine control"},
                        {"id": "n3", "label": "Failed intubation / cannot oxygenate"},
                        {"id": "n4", "label": "Emergency surgical cricothyroidotomy"}
                    ],
                    "edges": [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]]
                }
            },
            {
                "tx": "Hemorrhagic shock is the leading preventable cause of early post-injury death. The five anatomical compartments capable of hiding major internal **bleeding** are the chest, abdomen, pelvis, retroperitoneum with long-bone fractures, and the external scene floor. Hemostatic resuscitation avoids excessive crystalloid infusion, employing early balanced blood component therapy utilizing packed red blood cells, fresh frozen plasma, and platelets in an equal one-to-one-to-one ratio alongside intravenous tranexamic acid administered within three hours of injury.",
                "say": "Hemorrhagic shock is assessed across five major compartments: chest, abdomen, pelvis, retroperitoneum, and floor. Resuscitation avoids crystalloids, prioritizing balanced one-to-one-to-one blood components and tranexamic acid within three hours.",
                "vis": {
                    "kind": "table",
                    "cols": ["Major bleeding compartment", "Bedside physical / radiological sign", "Emergency hemostatic control"],
                    "rows": [
                        ["Thoracic cavity", "Dullness to percussion / hemothorax on X-ray", "Tube thoracostomy (thoracotomy if > 1500 mL)"],
                        ["Peritoneal cavity", "Abdominal distension / fluid on FAST scan", "Emergency exploratory laparotomy"],
                        ["Pelvic ring fracture", "Mechanically unstable open-book pelvis", "Immediate pelvic circumferential binder"],
                        ["Femoral / long bones", "Deformity, tense swelling, shortening", "Traction splinting & compartment monitoring"]
                    ]
                }
            },
            {
                "tx": "The lethal triad of trauma comprises hypothermia, metabolic acidosis, and coagulopathy, creating a self-reinforcing vicious physiological **cycle** that drives cellular shock and microvascular failure. Resuscitation room hypothermia impairs platelet aggregation and enzymatic clotting cascades, worsening hemorrhage and hypoperfusion. Damage control surgery interrupts this lethal spiral by prioritizing rapid operative control of active exsanguination and enteric contamination, temporary abdominal wall closure, and transfer to the intensive care unit for physiological correction.",
                "say": "The lethal triad of hypothermia, acidosis, and coagulopathy drives mortality in severe trauma. Damage control surgery interrupts this cycle by rapidly controlling bleeding and contamination, delaying definitive reconstruction until physiological stabilization.",
                "vis": {
                    "kind": "compare",
                    "a": {"title": "Lethal Triad Cycle", "bullets": ["Hypothermia inhibits coagulation enzymes", "Acidosis reduces clotting factor activity", "Coagulopathy perpetuates exsanguinating hemorrhage", "Drive end-organ ischemia and death"]},
                    "b": {"title": "Damage Control Surgery", "bullets": ["Abbreviated laparotomy (< 60 minutes)", "Pack bleeding liver & staple hollow viscera", "Temporary abdominal closure with negative pressure", "ICU resuscitation of warmth & pH prior to re-exploration"]}
                }
            }
        ]
    }
]
