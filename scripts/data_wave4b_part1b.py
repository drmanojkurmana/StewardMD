# Part 1b Data: Modules 6 to 10
# sur-arterial, sur-aneurysm, sur-venous, sur-lymphatic, sur-thoracic

LESSONS_6_10 = [
    # 6. sur-arterial
    {
        "module": "sur-arterial",
        "subject": "surgery",
        "title": "Peripheral arterial disease, Fontaine stages, acute limb ischemia, and revascularization",
        "minutes": 6,
        "refs": ["Sabiston Textbook of Surgery 22nd ed", "Rutherford Vascular Surgery 9th ed"],
        "steps": [
            {
                "tx": "Atherosclerotic peripheral arterial disease produces progressive luminal narrowing within lower extremity **arteries**, classically stratified by Fontaine stages or Rutherford categories. Fontaine stage II denotes reproducible intermittent claudication during exertion. Stage III signifies ischemic rest pain occurring when recumbent that awakens the patient at night. Stage IV denotes critical limb-threatening ischemia characterized by non-healing ischemic ulcerations or gangrene. Critical ischemia carries a high risk of major limb amputation without prompt revascularization.",
                "say": "Peripheral arterial disease causes lower extremity ischemia, classified into Fontaine stages. Intermittent claudication represents stage two, while rest pain represents stage three. Stage four denotes critical tissue loss and gangrene requiring urgent revascularization.",
                "vis": {
                    "kind": "table",
                    "cols": ["Fontaine stage", "Clinical presentation", "Rutherford category"],
                    "rows": [
                        ["Stage I", "Asymptomatic arterial stenosis", "Category 0"],
                        ["Stage IIa / IIb", "Mild to severe intermittent claudication", "Categories 1 to 3"],
                        ["Stage III", "Ischemic rest pain (worse supine)", "Category 4"],
                        ["Stage IV", "Ulceration or ischemic gangrene", "Categories 5 and 6"]
                    ]
                }
            },
            {
                "tx": "The ankle-brachial index represents the cornerstone non-invasive diagnostic **modality** for evaluating lower extremity arterial perfusion. A resting index between 0.9 and 1.3 is normal, while values between 0.5 and 0.8 reflect moderate claudication. An index below 0.5 indicates severe ischemia, and ankle pressure under fifty millimeters of mercury signifies critical ischemia. In diabetic patients with heavily calcified, non-compressible tibial vessels yielding false values above 1.4, the toe-brachial index accurately measures microvascular perfusion.",
                "say": "The ankle-brachial index is the primary non-invasive test for lower limb ischemia. An index between 0.9 and 1.3 is normal, while values below 0.5 signify severe ischemia. Toe-brachial index is used when arteries are calcified and non-compressible.",
                "vis": {
                    "kind": "flow",
                    "nodes": [
                        {"id": "n1", "label": "Suspected lower limb ischemia"},
                        {"id": "n2", "label": "Measure bilateral ankle-brachial index"},
                        {"id": "n3", "label": "Toe pressures if vessels non-compressible"},
                        {"id": "n4", "label": "Duplex ultrasound & CT angiography"}
                    ],
                    "edges": [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]]
                }
            },
            {
                "tx": "Acute limb ischemia manifests with the cardinal six Ps: pain, pallor, poikilothermia, pulselessness, **paresthesia**, and paralysis. Paresthesia and motor paralysis signify advanced nerve and muscle ischemia with impending irreversible necrosis. Rutherford classifies acute ischemia into viable (grade I), marginally threatened (grade IIa), immediately threatened (grade IIb), and irreversibly infarcted (grade III). Cardiogenic emboli from atrial fibrillation typically lodge abruptly at arterial bifurcations, most commonly the femoral bifurcation, without prior collateral development.",
                "say": "Acute limb ischemia manifests with the six Ps: pain, pallor, coldness, pulselessness, paresthesia, and paralysis. Paresthesia and motor weakness indicate immediately threatened tissue requiring emergency surgical revascularization.",
                "vis": {
                    "kind": "table",
                    "cols": ["Rutherford category", "Sensory deficit", "Motor deficit / Doppler signal"],
                    "rows": [
                        ["Class I (Viable)", "No sensory loss", "No muscle weakness / audible signals"],
                        ["Class IIa (Marginal)", "Minimal toe numbness", "No muscle weakness / venous signal"],
                        ["Class IIb (Threatened)", "Sensory loss above toes", "Mild-moderate weakness / inaudible arterial"],
                        ["Class III (Irreversible)", "Profound anesthetic numbness", "Paralysis and rigor / absent Doppler signals"]
                    ]
                }
            },
            {
                "tx": "Emergency management of acute limb ischemia mandates immediate intravenous heparin anticoagulation to prevent propagating thrombus **formation**. Catheter-directed balloon thromboembolectomy using a Fogarty catheter rapidly restores arterial inflow. Post-reperfusion syndrome with severe muscle swelling mandates immediate prophylactic four-compartment calf fasciotomy to prevent myonecrosis. Chronic critical limb ischemia is managed by endovascular angioplasty or surgical bypass, where the reversed or in situ autologous great saphenous vein provides superior long-term patency.",
                "say": "Acute limb ischemia requires immediate heparinization and emergency Fogarty balloon embolectomy. Reperfusion swelling mandates four-compartment calf fasciotomy. Chronic critical ischemia is treated with endovascular angioplasty or autologous saphenous vein bypass.",
                "vis": {
                    "kind": "compare",
                    "a": {"title": "Embolic Acute Ischemia", "bullets": ["Sudden acute onset without prior claudication", "Identifiable cardiac source (atrial fibrillation)", "Treated with Fogarty catheter embolectomy"]},
                    "b": {"title": "Thrombotic Acute Ischemia", "bullets": ["Gradual worsening on pre-existing atherosclerosis", "Well-developed collateral vessels present", "Requires catheter thrombolysis or surgical bypass"]}
                }
            }
        ]
    },

    # 7. sur-aneurysm
    {
        "module": "sur-aneurysm",
        "subject": "surgery",
        "title": "Abdominal aortic aneurysm, Laplace law, endoleak types, and carotid endarterectomy",
        "minutes": 6,
        "refs": ["Sabiston Textbook of Surgery 22nd ed", "Rutherford Vascular Surgery 9th ed"],
        "steps": [
            {
                "tx": "An abdominal aortic aneurysm represents a permanent focal arterial **dilation** exceeding three centimeters in diameter or fifty percent greater than the adjacent normal aorta. The infrarenal abdominal aorta is involved in over ninety percent of cases due to decreased medial elastin lamellae and lack of vasa vasorum. Laplace law states that mural wall tension equals pressure multiplied by radius divided by wall thickness, explaining why rupture risk accelerates exponentially as diameter expands beyond five centimeters.",
                "say": "An abdominal aortic aneurysm is defined as a diameter exceeding three centimeters. Ninety percent involve the infrarenal aorta. By Laplace law, mural wall tension rises directly with increasing radius, dramatically accelerating rupture risk.",
                "vis": {
                    "kind": "table",
                    "cols": ["Aneurysm diameter", "Annual rupture risk", "Clinical management strategy"],
                    "rows": [
                        ["3.0 to 3.9 cm", "Under 1 percent per year", "Serial ultrasound every 2 to 3 years"],
                        ["4.0 to 4.9 cm", "Approximately 1 to 3 percent", "Serial ultrasound every 6 to 12 months"],
                        ["5.0 to 5.4 cm", "Approximately 3 to 5 percent", "Close monitoring / consider repair in women"],
                        [">= 5.5 cm", "Exceeds 10 percent per year", "Elective surgical or endovascular repair"]
                    ]
                }
            },
            {
                "tx": "Elective repair is recommended when maximum transverse diameter reaches five and a half centimeters in men or five centimeters in women, or upon rapid expansion exceeding five **millimeters** over six months. Ruptured aneurysm classically presents with severe sudden back or flank pain, a pulsatile abdominal mass, and profound hypotension, though this diagnostic triad appears complete in only half of cases. Hemodynamically stable patients undergo immediate contrast computed tomography, while unstable patients proceed directly to the operating theater.",
                "say": "Elective repair is indicated at five and a half centimeters in men, five centimeters in women, or with rapid expansion. Rupture presents with severe back pain, a pulsatile abdominal mass, and shock, requiring immediate surgical exploration.",
                "vis": {
                    "kind": "flow",
                    "nodes": [
                        {"id": "n1", "label": "Suspected ruptured aortic aneurysm"},
                        {"id": "n2", "label": "Permissive hypotension (SBP 70-90)"},
                        {"id": "n3", "label": "Immediate OR transfer or fast CTA"},
                        {"id": "n4", "label": "Cross-clamping or aortic balloon occlusion"}
                    ],
                    "edges": [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]]
                }
            },
            {
                "tx": "Endovascular aneurysm repair requires favorable anatomical morphology including an adequate infrarenal **neck** length exceeding ten millimeters, non-circumferential thrombus, and suitable iliac access vessels. Complications following endovascular stenting are characterized by endoleaks. Type I endoleaks involve persistent flow at proximal or distal attachment sites, transmitting full systemic arterial pressure and mandating immediate corrective reintervention. Type II endoleaks arise from retrograde branch flow through lumbar arteries or the inferior mesenteric artery, resolving spontaneously in most cases.",
                "say": "Endovascular aneurysm repair requires an adequate proximal aortic neck length of at least ten millimeters. Type I attachment site endoleaks transmit systemic arterial pressure and require immediate repair. Type II branch vessel endoleaks are typically observed.",
                "vis": {
                    "kind": "table",
                    "cols": ["Endoleak classification", "Anatomical source of flow", "Clinical management rule"],
                    "rows": [
                        ["Type I", "Attachment site seal failure (proximal/distal)", "Immediate ballooning, cuff or stent"],
                        ["Type II", "Retrograde branch flow (lumbar / IMA)", "Conservative surveillance unless enlarging"],
                        ["Type III", "Graft fabric tear or modular disconnection", "Urgent endovascular component relining"],
                        ["Type IV / V", "Graft wall porosity / endotension", "Observation unless sac expands"]
                    ]
                }
            },
            {
                "tx": "Carotid endarterectomy prevents ischemic cerebral events in patients with severe extracranial **atherosclerosis**. The NASCET trial established that symptomatic patients with seventy to ninety-nine percent internal carotid stenosis achieve substantial stroke risk reduction from carotid endarterectomy compared to medical therapy alone. Surgery involves plaque excision through a longitudinal arteriotomy, with temporary intraluminal shunting used to preserve cerebral perfusion during clamping when collateral flow through the circle of Willis is insufficient.",
                "say": "Carotid endarterectomy significantly reduces stroke risk in symptomatic internal carotid artery stenosis between seventy and ninety-nine percent. Meticulous plaque removal with patch angioplasty restores cerebral inflow and prevents future embolization.",
                "vis": {
                    "kind": "compare",
                    "a": {"title": "Carotid Endarterectomy (CEA)", "bullets": ["Gold standard for symptomatic > 70% stenosis", "Complete surgical excision of plaque", "Mandates temporary intraluminal shunt if needed"]},
                    "b": {"title": "Carotid Artery Stenting (CAS)", "bullets": ["Alternative in hostile neck or radiation", "Requires embolic protection filter", "Slightly higher periprocedural minor stroke risk"]}
                }
            }
        ]
    },

    # 8. sur-venous
    {
        "module": "sur-venous",
        "subject": "surgery",
        "title": "Chronic venous disease, CEAP classification, varicose veins, and endovenous ablation",
        "minutes": 6,
        "refs": ["Sabiston Textbook of Surgery 22nd ed", "Rutherford Vascular Surgery 9th ed"],
        "steps": [
            {
                "tx": "Chronic venous disease arises from valvular incompetence and venous **hypertension** in superficial, deep, or perforating venous systems. When bicuspid venous valves fail, retrograde gravitational hydrostatic pooling transmits elevated pressures into cutaneous capillary beds. Extravasation of red blood cells produces hemosiderin hyperpigmentation, while pericapillary fibrin cuffs and chronic leukocyte entrapment induce progressive subcutaneous fibrosis termed lipodermatosclerosis. The medial lower calf and perimalleolar region represent the classic anatomical site of venous stasis.",
                "say": "Chronic venous insufficiency stems from venous valvular incompetence and ambulatory venous hypertension. Hydrostatic pooling drives red cell extravasation, hemosiderin pigmentation, and subcutaneous lipodermatosclerosis over the medial lower calf.",
                "vis": {
                    "kind": "table",
                    "cols": ["Venous system component", "Normal physiological role", "Pathophysiological consequence"],
                    "rows": [
                        ["Superficial (GSV & SSV)", "Drain skin and subcutaneous tissues", "Varicosities, telangiectasias, aching"],
                        ["Deep system", "Carries 90% of venous return", "Deep reflux, chronic edema, severe skin breakdown"],
                        ["Perforating veins", "Direct blood from superficial to deep", "Incompetence causes localized venous hypertensive flares"],
                        ["Calf muscle pump", "Generates propulsion during ambulation", "Pump failure exacerbates ambulatory hypertension"]
                    ]
                }
            },
            {
                "tx": "The international CEAP classification categorizes venous disorders based on clinical, **etiological**, anatomical, and pathophysiological criteria. Clinical class C1 denotes telangiectasias or reticular veins. Class C2 encompasses true dilated, tortuous varicose veins measuring three millimeters or larger. Class C3 denotes lower limb edema without trophic skin changes. Class C4 includes pigmentation, eczema, and lipodermatosclerosis. Class C5 represents a healed venous ulceration, while class C6 denotes an active, open venous leg ulcer.",
                "say": "The CEAP classification grades venous disease from C0 to C6. C2 represents varicose veins, C3 lower extremity edema, C4 trophic skin changes like lipodermatosclerosis, and C6 an active, non-healing venous leg ulcer.",
                "vis": {
                    "kind": "table",
                    "cols": ["CEAP clinical class", "Physical examination finding", "Typical anatomical location"],
                    "rows": [
                        ["Class C1", "Telangiectasias & reticular veins", "Lateral thigh, ankle flare"],
                        ["Class C2", "Varicose veins (>= 3 mm diameter)", "Great / small saphenous distribution"],
                        ["Class C3", "Dependent lower extremity edema", "Perimalleolar and lower calf"],
                        ["Class C4a / C4b", "Pigmentation, eczema / lipodermatosclerosis", "Medial gaiter area of lower calf"],
                        ["Class C5 / C6", "Healed / active venous stasis ulcer", "Superior to medial malleolus"]
                    ]
                }
            },
            {
                "tx": "Duplex ultrasound examination in the standing position represents the definitive diagnostic **investigation** for venous pathology. It documents anatomical venous pathways, identifies intraluminal thrombi, and quantifies retrograde reflux duration following distal manual compression release. Pathological reflux is defined as retrograde venous flow exceeding five hundred milliseconds in superficial and perforator veins, or exceeding one thousand milliseconds in deep femoral and popliteal veins. Deep vein patency must be confirmed prior to superficial interventions.",
                "say": "Standing duplex ultrasound is the gold standard diagnostic test, identifying venous thrombi and quantifying reflux duration. Reflux exceeding five hundred milliseconds in superficial veins or one second in deep veins is pathological.",
                "vis": {
                    "kind": "flow",
                    "nodes": [
                        {"id": "n1", "label": "Lower limb venous symptoms / ulcer"},
                        {"id": "n2", "label": "Standing duplex ultrasound examination"},
                        {"id": "n3", "label": "Quantify reflux duration & deep patency"},
                        {"id": "n4", "label": "Ablation vs compression therapy"}
                    ],
                    "edges": [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]]
                }
            },
            {
                "tx": "Conservative therapy utilizing graduated compression **stockings** exerting twenty to thirty or thirty to forty millimeters of mercury pressure constitutes initial management. For superficial axial incompetence involving the great saphenous vein, endovenous thermal ablation via radiofrequency or laser has replaced open high ligation and stripping as first-line therapy. Tumescent local anesthesia protects adjacent cutaneous nerves and absorbs heat during ablation. Ultrasound-guided foam sclerotherapy and cyanoacrylate adhesive provide effective non-thermal options.",
                "say": "Graduated compression therapy provides foundational conservative support. Endovenous thermal ablation using radiofrequency or laser with tumescent anesthesia is the first-line treatment for saphenous reflux, replacing open surgical stripping.",
                "vis": {
                    "kind": "compare",
                    "a": {"title": "Endovenous Thermal Ablation", "bullets": ["Radiofrequency (RFA) or laser (EVLA)", "Tumescent local anesthesia required", "Rapid recovery and > 95% closure rates"]},
                    "b": {"title": "Open Saphenous Stripping", "bullets": ["High ligation at saphenofemoral junction", "Mechanical vein stripping to knee level", "Higher groin hematoma and nerve injury rates"]}
                }
            }
        ]
    },

    # 9. sur-lymphatic
    {
        "module": "sur-lymphatic",
        "subject": "surgery",
        "title": "Lymphedema staging, lymphoscintigraphy, complete decongestive therapy, and surgical restoration",
        "minutes": 6,
        "refs": ["Sabiston Textbook of Surgery 22nd ed", "Rutherford Vascular Surgery 9th ed"],
        "steps": [
            {
                "tx": "Lymphedema is a chronic debilitating condition caused by impaired interstitial **drainage** and macromolecular clearance, leading to protein-rich fluid stagnation, chronic inflammation, adipocyte hypertrophy, and progressive cutaneous fibrosis. Primary lymphedema results from intrinsic lymphatic aplasia or hypoplasia, divided into congenital Milroy disease presenting before age one, Meige disease praecox presenting around puberty, and lymphedema tarda developing after age thirty-five. Secondary lymphedema most commonly follows axillary lymphadenectomy, radiation, or filariasis worldwide.",
                "say": "Lymphedema results from defective lymphatic clearance, causing protein-rich interstitial fluid retention, adipose deposition, and dermal fibrosis. Primary forms include Milroy and Meige diseases, while secondary lymphedema commonly follows axillary dissection.",
                "vis": {
                    "kind": "table",
                    "cols": ["Lymphedema etiology", "Typical age of onset", "Predominant causal mechanism"],
                    "rows": [
                        ["Congenital (Milroy)", "Birth to 1 year of age", "VEGFR3 gene mutation / aplasia"],
                        ["Praecox (Meige)", "Puberty to age 35 years", "Lymphatic hypoplasia (most common primary)"],
                        ["Tarda", "After age 35 years", "Adult-onset primary lymphatic incompetence"],
                        ["Secondary lymphedema", "Any age following insult", "Axillary clearance, radiation, filariasis"]
                    ]
                }
            },
            {
                "tx": "The International Society of Lymphology classifies clinical lymphedema into four progressive **stages**. Stage 0 denotes a subclinical, latent state where lymphatic transport capacity is reduced without visible edema. Stage 1 demonstrates early pitting edema that improves or resolves completely with overnight leg elevation. Stage 2 exhibits irreversible, non-pitting edema with extensive subcutaneous fibrofatty proliferation. Stage 3 represents lymphostatic elephantiasis characterized by massive limb enlargement, acanthosis, verrucous hyperkeratosis, and recurrent episodes of streptococcal cellulitis.",
                "say": "The International Society of Lymphology recognizes four stages from latent stage zero to elephantiasis in stage three. Stage one demonstrates reversible pitting edema, while stage two exhibits non-pitting irreversible fibroadipose deposition.",
                "vis": {
                    "kind": "table",
                    "cols": ["ISL clinical stage", "Physical examination characteristics", "Reversibility with limb elevation"],
                    "rows": [
                        ["Stage 0 (Latent)", "No visible swelling / impaired transport", "Subclinical state"],
                        ["Stage 1 (Early)", "Soft pitting edema", "Reverses completely with elevation"],
                        ["Stage 2 (Late)", "Non-pitting dense edema with fibrosis", "Does not reverse with elevation"],
                        ["Stage 3 (Elephantiasis)", "Verrucous hyperkeratosis & fat lobules", "Irreversible / severe chronic disability"]
                    ]
                }
            },
            {
                "tx": "Stemmer sign, defined as the inability to pinch and lift a fold of **skin** at the base of the second toe, represents a pathognomonic physical finding distinguishing lymphedema from venous edema. Lymphoscintigraphy using intradermal technetium-99m sulfur colloid represents the diagnostic gold standard, demonstrating delayed transit, dermal backflow, and absent regional lymph node visualization. Near-infrared fluorescence lymphography with indocyanine green provides real-time high-resolution mapping of functioning superficial lymphatic channels.",
                "say": "Stemmer sign is the inability to pinch skin at the second toe base, pathognomonic for lymphedema. Technetium-99m lymphoscintigraphy is the diagnostic gold standard, demonstrating delayed transit and dermal backflow.",
                "vis": {
                    "kind": "flow",
                    "nodes": [
                        {"id": "n1", "label": "Painless chronic limb enlargement"},
                        {"id": "n2", "label": "Positive Stemmer sign on exam"},
                        {"id": "n3", "label": "Technetium lymphoscintigraphy"},
                        {"id": "n4", "label": "Stage-guided CDT or supermicrosurgery"}
                    ],
                    "edges": [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]]
                }
            },
            {
                "tx": "Complete decongestive therapy represents the cornerstone conservative management, combining manual **lymphatic** drainage, multi-layer short-stretch compression bandaging, therapeutic exercise, and meticulous skin hygiene to prevent recurrent cellulitis. Supermicrosurgical lymphovenous anastomosis creates shunts between functioning lymphatic channels and adjacent subdermal venules in early stage 1 and 2 disease. Vascularized lymph node transfer provides physiological clearance for refractory cases, while suction-assisted lipectomy removes hypertrophied fibrofatty tissue in advanced stage 2 and 3 disease.",
                "say": "Complete decongestive therapy provides essential conservative management through manual drainage and compression bandaging. Supermicrosurgical lymphovenous anastomosis diverts lymphatic flow into venules, while suction lipectomy resects chronic fibroadipose tissue.",
                "vis": {
                    "kind": "compare",
                    "a": {"title": "Physiological Surgery", "bullets": ["Lymphovenous anastomosis (LVA)", "Vascularized lymph node transfer (VLNT)", "Best in early stages with patent channels"]},
                    "b": {"title": "Ablative / Reductive Surgery", "bullets": ["Suction-assisted lipectomy", "Charles skin excision procedure", "Indicated for chronic fibroadipose excess"]}
                }
            }
        ]
    },

    # 10. sur-thoracic
    {
        "module": "sur-thoracic",
        "subject": "surgery",
        "title": "Thoracic oncology, anatomic lobectomy, VATS resection, and pleural empyema",
        "minutes": 6,
        "refs": ["Sabiston Textbook of Surgery 22nd ed", "Shields General Thoracic Surgery 8th ed"],
        "steps": [
            {
                "tx": "Non-small cell lung cancer accounts for eighty-five percent of primary pulmonary **malignancies**, classified histologically into adenocarcinoma, squamous cell carcinoma, and large cell carcinoma. Preoperative physiological evaluation mandates spirometry and diffusing capacity of the lung for carbon monoxide. Predicted postoperative forced expiratory volume in one second and diffusing capacity exceeding forty percent indicate safe tolerance for anatomical resection, while values below thirty percent warrant cardiopulmonary exercise testing.",
                "say": "Non-small cell lung cancer accounts for eighty-five percent of primary lung neoplasms. Preoperative physiological assessment requires spirometry and carbon monoxide diffusion testing, with predicted postoperative values above forty percent confirming surgical resectability.",
                "vis": {
                    "kind": "table",
                    "cols": ["Pulmonary function parameter", "Low surgical risk threshold", "High risk / further testing threshold"],
                    "rows": [
                        ["Predicted post-op FEV1 (ppoFEV1)", "Greater than 40 percent", "Less than 30 percent"],
                        ["Predicted post-op DLCO (ppoDLCO)", "Greater than 40 percent", "Less than 30 percent"],
                        ["Peak VO2 on CPET exercise", "Greater than 15 mL/kg/min", "Less than 10 mL/kg/min"],
                        ["Cardiac risk stratification", "Revised Cardiac Risk Index <= 1", "Elevated cardiac biomarker / ischemia"]
                    ]
                }
            },
            {
                "tx": "Anatomical lobectomy with systematic hilar and mediastinal lymph node **dissection** remains the gold standard curative operation for clinical stage I and II non-small cell lung carcinoma. Video-assisted thoracic surgery and robotic-assisted approaches demonstrate reduced postoperative pain, shorter chest tube duration, and equivalent oncological long-term survival compared to open thoracotomy. Sublobar segmentectomy represents an acceptable alternative for peripheral tumors measuring two centimeters or smaller with pure or predominant ground-glass opacity.",
                "say": "Anatomic lobectomy with systematic mediastinal lymph node dissection is the gold standard for early-stage lung cancer. Minimally invasive video-assisted and robotic approaches reduce pain and hospital stay with equivalent survival.",
                "vis": {
                    "kind": "flow",
                    "nodes": [
                        {"id": "n1", "label": "Solitary pulmonary nodule / biopsy"},
                        {"id": "n2", "label": "PET-CT and endobronchial ultrasound (EBUS)"},
                        {"id": "n3", "label": "Confirm stage I-II physiological reserve"},
                        {"id": "n4", "label": "VATS anatomical lobectomy & node clearance"}
                    ],
                    "edges": [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]]
                }
            },
            {
                "tx": "Primary spontaneous pneumothorax develops in tall, thin young adults secondary to apical subpleural **bleb** rupture. Indications for surgical intervention include a second ipsilateral recurrence, first contralateral or bilateral pneumothorax, persistent air leak exceeding three to five days, or high-risk occupational professions including commercial pilots and deep-sea divers. Video-assisted thoracic wedge resection of apical blebs combined with mechanical pleural abrasion or chemical pleurodesis prevents recurrent pneumothorax.",
                "say": "Primary spontaneous pneumothorax results from apical subpleural bleb rupture in young adults. Recurrent episodes or persistent air leaks warrant video-assisted apical bleb wedge resection and mechanical pleurodesis.",
                "vis": {
                    "kind": "table",
                    "cols": ["Pneumothorax indication", "Clinical presentation context", "Recommended surgical management"],
                    "rows": [
                        ["Second ipsilateral episode", "Recurrent spontaneous collapse", "VATS wedge excision & pleurodesis"],
                        ["Persistent air leak > 3 days", "Bronchopleural fistula through chest tube", "Operative stapling of apical blebs"],
                        ["Tension pneumothorax", "Hemodynamic instability & tracheal shift", "Immediate needle decompression then tube"],
                        ["High-risk profession", "Pilot, diver, isolated geographic area", "Elective VATS pleurodesis on first event"]
                    ]
                }
            },
            {
                "tx": "Pleural empyema progresses through three distinct pathophysiological **phases**: the early exudative phase with free-flowing fluid, the fibrinopurulent phase with loculations, and the chronic organizing phase characterized by a dense fibrous peel restricting lung re-expansion. Parapneumonic effusions with pleural fluid pH below 7.2, glucose below forty milligrams per deciliter, or visible bacteria require tube thoracostomy. Fibrinopurulent or organized empyema refractory to drainage mandates video-assisted thoracic surgery or open decortication to liberate the trapped lung.",
                "say": "Pleural empyema evolves from early exudative fluid to organizing fibrous peels that trap the lung. Complicated effusions with low pH require chest tube drainage, while loculated peels mandate surgical decortication.",
                "vis": {
                    "kind": "compare",
                    "a": {"title": "Exudative & Early Empyema", "bullets": ["Thin, free-flowing serosanguinous fluid", "Pleural fluid pH > 7.2 and sterile", "Responds to chest tube thoracostomy"]},
                    "b": {"title": "Organizing Fibrous Empyema", "bullets": ["Dense collagenous peel traps underlying lung", "Pleural fluid pH < 7.2 with high LDH", "Mandates VATS or open decortication"]}
                }
            }
        ]
    }
]
