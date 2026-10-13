/**
 * Wave 4A Surgical Lessons Part 1 (Topics 1-10)
 * Reference: Sabiston Textbook of Surgery 22nd ed
 */

export const wave4aLessonsPart1 = [
  // 1. sur-infections
  {
    module: "sur-infections",
    subject: "surgery",
    title: "Surgical site infections, necrotizing soft-tissue infections, and antimicrobial prophylaxis",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "CDC Surgical Site Infection Guidelines"],
    steps: [
      {
        tx: "Surgical **infections** are stratified into superficial incisional, deep incisional, and organ/space infections by CDC criteria. Superficial infections involve only subcutaneous tissue within 30 days of operation. Deep infections involve fascial and muscular layers. Organ space infections involve anatomical cavities manipulated during surgery. Preoperative antimicrobial prophylaxis must be administered within 60 minutes prior to surgical incision to achieve peak tissue bactericidal levels.",
        say: "Surgical site infections are classified into superficial incisional, deep incisional, and organ space categories. Prophylactic antibiotics should be infused within 60 minutes prior to surgical incision to guarantee bactericidal tissue levels during tissue division.",
        vis: {
          kind: "table",
          cols: ["Infection classification", "Anatomical depth", "Timeframe post-op"],
          rows: [
            ["Superficial incisional", "Skin and subcutaneous tissue only", "Within 30 days"],
            ["Deep incisional", "Deep fascial and muscular layers", "Within 30 to 90 days"],
            ["Organ or space", "Any anatomical cavity opened or manipulated", "Within 30 to 90 days"],
            ["Necrotizing fasciitis", "Subcutaneous necrosis extending along deep fascia", "Rapidly progressive (hours)"]
          ]
        }
      },
      {
        tx: "Necrotizing **fasciitis** represents a life-threatening surgical emergency characterized by widespread subcutaneous and fascial necrosis with relative sparing of underlying muscle. Type I is polymicrobial involving anaerobes and enterobacteriaceae; Type II is monomicrobial driven by group A Streptococcus. Clinical hallmarks include pain out of proportion to physical exam findings, dusky skin dishwater pus, wooden hard subcutaneous edema, and cutaneous bullae.",
        say: "Necrotizing fasciitis causes extensive subcutaneous necrosis. Type one is polymicrobial with anaerobes, while type two is caused by group A Streptococcus. Clinical features include pain out of proportion to physical signs, dishwater exudate, and tense wooden edema.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "n1", label: "Subcutaneous bacterial invasion" },
            { id: "n2", label: "Microvascular thrombosis & ischemia" },
            { id: "n3", label: "Liquefactive necrosis of deep fascia" },
            { id: "n4", label: "Systemic toxic shock & multiorgan failure" },
            { id: "n5", label: "Immediate radical surgical debridement" }
          ],
          edges: [
            ["n1", "n2"],
            ["n2", "n3"],
            ["n3", "n4"],
            ["n4", "n5"]
          ]
        }
      },
      {
        tx: "The Laboratory Risk Indicator for Necrotizing Fasciitis (**LRINEC**) score facilitates early distinction of necrotizing infections from simple cellulitis. The score evaluates six routine serum biomarkers: C-reactive protein, total white blood cell count, hemoglobin, sodium, creatinine, and fasting glucose. A score of 6 or greater raises high suspicion, while a score of 8 or greater carries a positive predictive value exceeding 90 percent.",
        say: "The LRINEC score differentiates necrotizing infections from simple cellulitis using six parameters: C-reactive protein, white blood cell count, hemoglobin, sodium, creatinine, and glucose. A score of six or more warrants urgent surgical evaluation.",
        vis: {
          kind: "table",
          cols: ["LRINEC parameter", "Scoring criteria threshold", "Assigned points"],
          rows: [
            ["C-reactive protein", "Greater than or equal to 150 mg/L", "4 points"],
            ["White cell count", "15 to 25 / greater than 25 x10^9/L", "1 to 2 points"],
            ["Hemoglobin", "11 to 13.5 / under 11 g/dL", "1 to 2 points"],
            ["Serum sodium", "Less than 135 mmol/L", "2 points"],
            ["Serum creatinine", "Greater than 1.6 mg/dL (141 umol/L)", "2 points"]
          ]
        }
      },
      {
        tx: "Definitive management of necrotizing soft tissue infections hinges on emergency **surgical** debridement down to viable bleeding tissue without awaiting imaging results. Broad-spectrum empiric parenteral antimicrobial coverage with vancomycin, piperacillin-tazobactam, and clindamycin must be initiated immediately. Clindamycin functions as a ribosomal protein synthesis inhibitor that suppresses staphylococcal and streptococcal toxin production. Planned second-look debridement is mandatory within 24 hours.",
        say: "Management of necrotizing fasciitis requires immediate surgical debridement down to healthy bleeding tissue. Empiric antibiotics must include vancomycin, piperacillin tazobactam, and clindamycin to halt bacterial toxin synthesis. Mandatory re-exploration occurs within 24 hours.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "d1", label: "Clinical suspicion of necrotizing infection" },
            { id: "d2", label: "Immediate aggressive crystalloid resuscitation" },
            { id: "d3", label: "Empiric antibiotics with antitoxin clindamycin" },
            { id: "d4", label: "Emergency radical debridement of dead tissue" },
            { id: "d5", label: "Mandatory planned 24-hour second-look operation" }
          ],
          edges: [
            ["d1", "d2"],
            ["d2", "d3"],
            ["d3", "d4"],
            ["d4", "d5"]
          ]
        }
      }
    ]
  },

  // 2. sur-skin
  {
    module: "sur-skin",
    subject: "surgery",
    title: "Cutaneous malignancies: melanoma staging, excision margins, and non-melanoma skin cancers",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "NCCN Cutaneous Melanoma Guidelines"],
    steps: [
      {
        tx: "Cutaneous **melanoma** prognosis is dictated primarily by histological tumor thickness measured in millimeters from the granular layer to the deepest tumor cell, termed Breslow thickness. Ulceration and mitotic rate serve as critical secondary microscopic variables. Clinical evaluation utilizes the ABCDE checklist: asymmetry, border irregularity, color variegation, diameter exceeding 6 mm, and evolving lesion characteristics.",
        say: "Melanoma prognosis depends primarily on Breslow depth measured from the epidermal granular layer to the deepest tumor margin. Lesions are evaluated using the ABCDE criteria: asymmetry, irregular border, variable color, diameter over 6 millimeters, and evolving features.",
        vis: {
          kind: "table",
          cols: ["Breslow depth", "Recommended excision margin", "Sentinel lymph node biopsy"],
          rows: [
            ["Melanoma in situ", "0.5 to 1.0 cm clear margin", "Not indicated"],
            ["Under 1.0 mm (pT1a)", "1.0 cm clear margin", "Not routinely indicated"],
            ["0.8 to 1.0 mm (pT1b)", "1.0 cm clear margin", "Consider / discuss with patient"],
            ["1.01 to 2.0 mm (pT2)", "1.0 to 2.0 cm clear margin", "Routinely indicated"],
            ["Greater than 2.0 mm (pT3-pT4)", "2.0 cm clear margin", "Routinely indicated"]
          ]
        }
      },
      {
        tx: "Sentinel lymph node biopsy (**SLNB**) maps the initial draining regional lymphatic basin using dual-tracer radiocolloid technetium-99m and vital blue dye or indocyanine green. SLNB is indicated for clinically node-negative melanomas with Breslow thickness greater than 1.0 mm, or 0.8 to 1.0 mm with ulceration or high-risk features. A positive sentinel node prompts molecular BRAF V600 mutation testing and adjuvant systemic targeted or immunotherapy.",
        say: "Sentinel node biopsy evaluates regional lymph node basins using technetium-99m and blue dye. It is indicated for melanomas thicker than 1 millimeter or thinner lesions with ulceration. Positive nodes guide systemic targeted therapy or immune checkpoint inhibition.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "s1", label: "Primary melanoma wide excision" },
            { id: "s2", label: "Dual tracer intradermal peritumoral injection" },
            { id: "s3", label: "Intraoperative gamma probe & visual localization" },
            { id: "s4", label: "Histopathological serial sectioning & IHC" },
            { id: "s5", label: "Adjuvant PD-1 inhibitor or BRAF-MEK therapy" }
          ],
          edges: [
            ["s1", "s2"],
            ["s2", "s3"],
            ["s3", "s4"],
            ["s4", "s5"]
          ]
        }
      },
      {
        tx: "Basal cell **carcinoma** (BCC) represents the most common human malignancy, arising from pluripotential basal cells of the hair follicle epidermis. Nodular BCC classically presents as a pearly translucent papule with telangiectasias and rolled borders. Squamous cell carcinoma (SCC) originates from keratinocytes, presenting as an indurated, hyperkeratotic plaque or crusted ulcer. SCC carries significant metastatic risk, particularly when arising in chronic burn scars, known as Marjolin ulcers.",
        say: "Basal cell carcinoma is the most common skin cancer, presenting as a pearly translucent papule with telangiectasia. Squamous cell carcinoma appears as an indurated keratotic ulcer and carries metastatic potential, especially when arising in burn scars as Marjolin ulcers.",
        vis: {
          kind: "table",
          cols: ["Feature", "Basal cell carcinoma (BCC)", "Squamous cell carcinoma (SCC)"],
          rows: [
            ["Cell of origin", "Basal cell layer / folliculosebaceous", "Keratinizing stratified squamous epithelium"],
            ["Classic appearance", "Pearly papule with arborizing telangiectasias", "Hyperkeratotic, ulcerated, firm nodule"],
            ["Metastatic risk", "Extremely rare (under 0.1 percent)", "Moderate (2 to 5 percent; higher in scars)"],
            ["Precursor lesion", "None recognized", "Actinic keratosis, Bowen disease"],
            ["Histopathology", "Peripheral palisading, retraction artifact", "Keratin pearls, intercellular bridges"]
          ]
        }
      },
      {
        tx: "Mohs **micrographic** surgery provides the highest cure rate for non-melanoma skin cancers in high-risk anatomical locations, including the central face, eyelids, nose, ears, and perioral region. The technique involves horizontal frozen-section analysis of 100 percent of the surgical peripheral and deep margins while sparing maximum normal tissue. Conventional surgical excision of low-risk BCC requires 4 mm clear margins, whereas low-risk SCC mandates 4 to 6 mm margins.",
        say: "Mohs micrographic surgery provides tissue sparing and exhaustive frozen margin evaluation for high-risk facial skin cancers. Low-risk basal cell carcinomas require four millimeter margins, while squamous cell carcinomas need four to six millimeter clear margins.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "m1", label: "High-risk facial cutaneous tumor" },
            { id: "m2", label: "Beveled surgical excision of visible tumor" },
            { id: "m3", label: "Color coding and precision mapping of margins" },
            { id: "m4", label: "Complete 100 percent horizontal frozen examination" },
            { id: "m5", label: "Targeted re-excision only where positive margins exist" }
          ],
          edges: [
            ["m1", "m2"],
            ["m2", "m3"],
            ["m3", "m4"],
            ["m4", "m5"]
          ]
        }
      }
    ]
  },

  // 3. sur-burns
  {
    module: "sur-burns",
    subject: "surgery",
    title: "Burn resuscitation, inhalation injury, escharotomy indications, and topical wound care",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "American Burn Association Guidelines"],
    steps: [
      {
        tx: "Burn **depth** governs physiological recovery and surgical intervention. Superficial first-degree burns affect only the epidermis, presenting with erythema without blister formation. Partial-thickness second-degree burns involve the dermis; superficial partial burns are blistered and exquisitely painful, whereas deep partial burns are mottled and hypoesthetic. Full-thickness third-degree burns destroy all epidermal and dermal elements, presenting as leathery, painless, thrombosed, translucent eschar.",
        say: "Burns are classified by depth. First-degree burns affect the epidermis. Second-degree partial-thickness burns involve the dermis with blisters. Third-degree full-thickness burns destroy all skin appendages, appearing leathery, white, and completely insensate.",
        vis: {
          kind: "table",
          cols: ["Burn degree", "Depth of tissue injury", "Sensory examination", "Healing time"],
          rows: [
            ["First degree", "Epidermis only", "Painful, hyperesthetic", "3 to 5 days without scar"],
            ["Superficial partial", "Upper papillary dermis", "Intensely painful, blistered", "10 to 14 days, minimal scar"],
            ["Deep partial", "Reticular dermis reached", "Reduced pinprick sensation", "3 to 6 weeks, hypertrophic scar"],
            ["Full thickness", "Entire dermis into subcutaneous fat", "Completely anesthetic", "Requires surgical excision & graft"]
          ]
        }
      },
      {
        tx: "Fluid **resuscitation** in major burns exceeding 20 percent total body surface area (TBSA) utilizes balanced crystalloids, traditionally calculated via the Parkland formula: 4 mL of lactated Ringer solution per kilogram body weight multiplied by percent TBSA burned. Half the total volume is infused during the first 8 hours post-injury, and the remainder over the subsequent 16 hours. Resuscitation titration is guided by target adult urine output of 0.5 mL/kg/h.",
        say: "Resuscitation for burns over 20 percent total body surface area uses the Parkland formula: 4 milliliters times weight in kilograms times percent burn of lactated Ringer. Half is given in the first 8 hours. Fluid titration targets urine output of 0.5 milliliters per kilogram per hour.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "b1", label: "TBSA estimation via Rule of Nines" },
            { id: "b2", label: "Parkland calculation (4 mL x kg x %TBSA)" },
            { id: "b3", label: "Infuse 50 percent total volume in initial 8 hours" },
            { id: "b4", label: "Infuse remaining 50 percent over subsequent 16 hours" },
            { id: "b5", label: "Titrate to target adult urine output 0.5 mL/kg/hr" }
          ],
          edges: [
            ["b1", "b2"],
            ["b2", "b3"],
            ["b3", "b4"],
            ["b4", "b5"]
          ]
        }
      },
      {
        tx: "Circumferential full-thickness burns produce unyielding, rigid eschars that constrict underlying neurovascular structures or restrict thoracic excursion during mechanical ventilation. Urgent bedside **escharotomy** is indicated when distal limb perfusion is compromised, evidenced by loss of arterial Doppler signals or compartmental pressures exceeding 30 mmHg. Thoracic escharotomies require bilateral mid-axillary incisions joined across the upper chest and subcostal margin.",
        say: "Circumferential full-thickness burns act like a constricting band. Urgent bedside escharotomy is required when Doppler signals disappear or compartment pressure exceeds 30 millimeters of mercury. Chest escharotomy relieves ventilatory restriction using mid-axillary and transverse cuts.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "e1", label: "Circumferential full-thickness limb or chest burn" },
            { id: "e2", label: " progressive third-space tissue edema beneath rigid eschar" },
            { id: "e3", label: "Compartment pressure exceeds capillary perfusion pressure" },
            { id: "e4", label: "Loss of Doppler signals, pallor, or respiratory restriction" },
            { id: "e5", label: "Immediate bedside escharotomy through full depth of eschar" }
          ],
          edges: [
            ["e1", "e2"],
            ["e2", "e3"],
            ["e3", "e4"],
            ["e4", "e5"]
          ]
        }
      },
      {
        tx: "Smoke **inhalation** injury dramatically increases mortality in burned individuals. Clinical signs mandate proactive endotracheal intubation before progressive laryngeal edema obliterates the airway. Supraglottic thermal injury causes immediate airway obstruction, while subglottic chemical injury triggers mucosal sloughing, bronchospasm, and acute respiratory distress syndrome. Carbon monoxide poisoning shifts the oxyhemoglobin dissociation curve leftward and is managed with 100 percent normobaric or hyperbaric oxygen.",
        say: "Smoke inhalation injury worsens burn outcomes. Stridor, facial burns, and singed nasal hairs necessitate early intubation before laryngeal swelling occludes the airway. Carbon monoxide toxicity causes cellular hypoxia and is treated with 100 percent oxygen.",
        vis: {
          kind: "table",
          cols: ["Injury component", "Pathophysiological mechanism", "Clinical management"],
          rows: [
            ["Supraglottic injury", "Direct thermal heat transfer and laryngeal edema", "Early proactive endotracheal intubation"],
            ["Subglottic chemical", "Toxics (acrolein, aldehydes) denude epithelium", "Nebulized heparin and N-acetylcysteine"],
            ["Carbon monoxide", "Carboxyhemoglobin impairs mitochondrial oxygen use", "100 percent high-flow oxygen until COHb under 5%"],
            ["Hydrogen cyanide", "Inhibits cytochrome c oxidase in complex IV", "Hydroxocobalamin intravenous infusion"]
          ]
        }
      }
    ]
  },

  // 4. sur-head-injury
  {
    module: "sur-head-injury",
    subject: "surgery",
    title: "Traumatic brain injury, intracranial hematomas, intracranial pressure monitoring, and herniation",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "Brain Trauma Foundation TBI Guidelines"],
    steps: [
      {
        tx: "Epidural **hematoma** (EDH) typically results from traumatic skull fracture through the pterion, tearing the middle meningeal artery. Patients classic demonstrate a lucid interval: brief loss of consciousness, temporary lucidity, followed by rapid neurological deterioration with ipsilateral pupillary dilation and contralateral hemiparesis. Non-contrast cranial CT reveals a pathognomonic hyperdense biconvex, lenticular collection that does not cross cranial suture lines.",
        say: "Epidural hematoma classically arises from pterion fractures tearing the middle meningeal artery. Patients present with a lucid interval followed by rapid coma and pupillary dilation. Non-contrast CT demonstrates a biconvex lenticular hyperdensity that respects suture lines.",
        vis: {
          kind: "table",
          cols: ["Feature", "Epidural hematoma (EDH)", "Subdural hematoma (SDH)"],
          rows: [
            ["Vascular source", "Middle meningeal artery / vein", "Bridging cortical veins"],
            ["CT appearance", "Biconvex / lenticular, hyperdense", "Crescentic / concavo-convex collection"],
            ["Crosses sutures", "No (limited by cranial periosteum)", "Yes (spreads over hemisphere)"],
            ["Lucid interval", "Classic presentation (up to 50%)", "Rarely observed"],
            ["Emergency surgery", "Craniotomy if volume over 30 mL or midline shift", "Craniotomy if thickness over 10 mm or shift > 5 mm"]
          ]
        }
      },
      {
        tx: "Subdural **hematoma** (SDH) originates from deceleration shearing of bridging cortical veins bridging the cerebral cortex and dural venous sinuses. Acute SDH manifests within 72 hours of major trauma as a crescentic, concavo-convex hyperdense collection that crosses suture lines but is bounded by the falx and tentorium. Chronic SDH is common in elderly and alcoholic patients with cerebral atrophy, presenting with insidious cognitive decline.",
        say: "Subdural hematoma results from tearing of cortical bridging veins. Acute subdural hematomas appear on CT as crescentic collections crossing sutures, accompanied by underlying parenchymal contusion. Chronic hematomas occur in elderly patients following minor trauma.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "h1", label: "Rotational deceleration traumatic head injury" },
            { id: "h2", label: "Shearing and tear of cortical bridging veins" },
            { id: "h3", label: "Blood accumulates in potential subdural space" },
            { id: "h4", label: "Mass effect, midline shift, and tentorial herniation" },
            { id: "h5", label: "Urgent craniotomy evacuation and clot decompression" }
          ],
          edges: [
            ["h1", "h2"],
            ["h2", "h3"],
            ["h3", "h4"],
            ["h4", "h5"]
          ]
        }
      },
      {
        tx: "The Monro-Kellie **doctrine** dictates that the rigid cranial vault holds a fixed total volume composed of brain parenchyma (80%), cerebrospinal fluid (10%), and blood (10%). An expanding mass lesion initially displaces CSF into the spinal subarachnoid space and shunts venous blood out of the skull. Once compensatory buffers are exhausted, small increments in mass volume produce exponential spikes in intracranial pressure (ICP), compromising cerebral perfusion pressure.",
        say: "The Monro-Kellie doctrine states the intracranial volume of brain, blood, and CSF is constant. Expansion of an intracranial mass initially displaces CSF and venous blood. Once spatial compensation is exhausted, intracranial pressure rises exponentially.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "k1", label: "Intracranial mass lesion expands" },
            { id: "k2", label: "CSF displaced into spinal canal & venous blood shunted" },
            { id: "k3", label: "Compensatory spatial reserve exhausted" },
            { id: "k4", label: "Exponential rise in intracranial pressure (ICP > 22 mmHg)" },
            { id: "k5", label: "Cerebral perfusion pressure falls below 60 mmHg" }
          ],
          edges: [
            ["k1", "k2"],
            ["k2", "k3"],
            ["k3", "k4"],
            ["k4", "k5"]
          ]
        }
      },
      {
        tx: "Uncal **herniation** occurs when the medial temporal lobe uncus is forced across the rigid tentorial incisura. Compression of the adjacent third cranial nerve produces ipsilateral pupillary dilation and loss of light reflex. Compression of the ipsilateral cerebral peduncle generates contralateral hemiparesis. Paradoxical ipsilateral hemiparesis occurs when the contralateral peduncle is compressed against the opposite tentorial edge, an anatomical phenomenon termed Kernohan notch phenomenon.",
        say: "Uncal herniation forces the temporal uncus over the tentorial notch. Compression of the third cranial nerve causes ipsilateral pupil dilation, while cerebral peduncle compression causes contralateral hemiparesis. Kernohan notch compression causes false localizing ipsilateral motor weakness.",
        vis: {
          kind: "table",
          cols: ["Herniation syndrome", "Displaced structure", "Key clinical manifestation"],
          rows: [
            ["Uncal (transtentorial)", "Medial temporal lobe uncus", "Ipsilateral blown pupil, contralateral hemiparesis"],
            ["Central tentorial", "Diencephalon and midbrain", "Bilateral pinpoint pupils, Cheyne-Stokes breathing"],
            ["Subfalcine (cingulate)", "Cingulate gyrus under falx", "ACA compression with contralateral leg weakness"],
            ["Tonsillar", "Cerebellar tonsils into foramen magnum", "Medullary respiratory arrest and flaccid quadriplegia"]
          ]
        }
      }
    ]
  },

  // 5. sur-chest-trauma
  {
    module: "sur-chest-trauma",
    subject: "surgery",
    title: "Thoracic trauma: tension pneumothorax, massive hemothorax, cardiac tamponade, and flail chest",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "ATLS 10th edition"],
    steps: [
      {
        tx: "Tension **pneumothorax** develops when a one-way parenchymal or chest wall valve permits air entry into the pleural space during inspiration without escape during expiration. Progressive intrapleural pressure collapses the ipsilateral lung, shifts mediastinal structures to the contralateral side, kinks the inferior vena cava, and halts venous return, causing fatal shock. Immediate needle decompression or finger thoracostomy must precede any diagnostic chest radiography.",
        say: "Tension pneumothorax is a one-way valve pleural air accumulation causing lung collapse, mediastinal shift, vena cava compression, and fatal obstructive shock. Immediate needle decompression or finger thoracostomy must be executed prior to imaging.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "t1", label: "Pleural tear acts as one-way inspiratory valve" },
            { id: "t2", label: "Progressive intrapleural positive pressure rises" },
            { id: "t3", label: "Mediastinal shift kinks vena cava and decreases preload" },
            { id: "t4", label: "Obstructive shock, severe hypoxia, and tracheal deviation" },
            { id: "t5", label: "Immediate needle thoracostomy in 5th intercostal space" }
          ],
          edges: [
            ["t1", "t2"],
            ["t2", "t3"],
            ["t3", "t4"],
            ["t4", "t5"]
          ]
        }
      },
      {
        tx: "Massive **hemothorax** is defined as rapid intrapleural blood accumulation exceeding 1,500 mL or greater than one-third of the patient circulating blood volume. Clinical findings include dullness to percussion, absent breath sounds, and hemorrhagic shock without tracheal shift. Urgent tube thoracostomy restores pulmonary expansion. Indications for emergency surgical thoracotomy include immediate evacuation of 1,500 mL or ongoing hemorrhage exceeding 200 mL/hour for 2 to 4 consecutive hours.",
        say: "Massive hemothorax is defined by accumulation of more than 1500 milliliters of blood in the pleural space. Emergency thoracotomy is indicated if initial drainage exceeds 1500 milliliters or if bleeding continues above 200 milliliters per hour for two to four hours.",
        vis: {
          kind: "table",
          cols: ["Feature", "Tension pneumothorax", "Massive hemothorax"],
          rows: [
            ["Percussion note", "Hyperresonant to percussion", "Stony dull to percussion"],
            ["Tracheal position", "Shifted toward contralateral side", "Usually midline / neutral"],
            ["Neck veins", "Distended (obstructive outflow)", "Flat / collapsed (hypovolemic shock)"],
            ["Immediate therapy", "Decompression needle / finger", "Large-bore chest tube (28-32 Fr)"],
            ["Surgical threshold", "Rarely requires emergent thoracotomy", "Thoracotomy if > 1500 mL or > 200 mL/hr ongoing"]
          ]
        }
      },
      {
        tx: "Cardiac **tamponade** occurs when acute hemopericardium restricts diastolic ventricular filling, most commonly following penetrating precordial trauma. Beck triad characterizes this state: systemic hypotension, distended jugular neck veins, and muffled heart sounds. Pulsus paradoxus (a drop in systolic blood pressure exceeding 10 mmHg during inspiration) is present. Extended Focused Assessment with Sonography for Trauma (**FAST**) rapidly identifies pericardial fluid; emergency operating room subxiphoid pericardial window or thoracotomy is definitive.",
        say: "Cardiac tamponade restricts ventricular filling due to pericardial effusion. Beck triad includes hypotension, elevated jugular venous pressure, and muffled heart sounds. Pulsus paradoxus is present. Bedside FAST ultrasound detects pericardial fluid for immediate operative decompression.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "c1", label: "Penetrating cardiac injury tears myocardium" },
            { id: "c2", label: "Hemopericardium fills non-distensible pericardial sac" },
            { id: "c3", label: "Intrapericardial pressure equalizes with diastolic ventricles" },
            { id: "c4", label: "Beck triad: hypotension, distended neck veins, muffled heart" },
            { id: "c5", label: "Emergency sternotomy or operative pericardial window" }
          ],
          edges: [
            ["c1", "c2"],
            ["c2", "c3"],
            ["c3", "c4"],
            ["c4", "c5"]
          ]
        }
      },
      {
        tx: "Flail **chest** occurs when three or more contiguous ribs are fractured in two or more places, creating a detached, freely mobile thoracic segment. The unstable segment exhibits paradoxical motion: moving inward during inspiration and outward during expiration. Underlying pulmonary contusion, rather than chest wall mechanics, drives profound hypoxemia and respiratory failure. Modern management prioritizes multimodal epidural analgesia, aggressive pulmonary toilet, and selective surgical stabilization of rib fractures.",
        say: "Flail chest requires three or more consecutive ribs broken in two places, causing paradoxical chest wall motion during breathing. The primary cause of hypoxia is the underlying pulmonary contusion. Management centers on epidural analgesia, pulmonary toilet, and selective surgical rib fixation.",
        vis: {
          kind: "table",
          cols: ["Respiratory phase", "Normal chest wall movement", "Flail segment paradoxical movement"],
          rows: [
            ["Inspiration (negative intrathoracic pressure)", "Expands outward and anteriorly", "Paradoxically sucked inward toward lung"],
            ["Expiration (positive intrathoracic pressure)", "Contracts inward and relaxes", "Paradoxically pushed outward into chest wall"],
            ["Underlying contusion effect", "Preserved ventilation-perfusion ratio", "Alveolar hemorrhage, edema, and severe shunt"],
            ["Definitive therapy", "Spontaneous unassisted breathing", "Epidural analgesia, CPAP, or surgical rib plating"]
          ]
        }
      }
    ]
  },

  // 6. sur-oral
  {
    module: "sur-oral",
    subject: "surgery",
    title: "Oral cavity cancer, mucosal premalignant lesions, TNM staging, and surgical resection margins",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "AJCC Cancer Staging Manual 8th ed"],
    steps: [
      {
        tx: "Oral cavity squamous cell **carcinoma** (SCC) accounts for over 90 percent of oral malignancies, strongly correlated with tobacco usage, betel quid chewing, and alcohol abuse. The lateral border of the tongue and floor of the mouth represent the most common anatomical sites. Premalignant lesions include leukoplakia (white plaque that cannot be scraped off) and erythroplakia (velvety red lesion), with erythroplakia harboring dysplasia or invasive carcinoma in up to 90 percent of biopsies.",
        say: "Oral squamous cell carcinoma arises predominantly on the lateral tongue and floor of mouth, linked to tobacco, betel quid, and alcohol. Leukoplakia is a non-scrapable white plaque, while velvety erythroplakia carries a 90 percent risk of harboring dysplasia or invasive cancer.",
        vis: {
          kind: "table",
          cols: ["Premalignant lesion", "Gross clinical appearance", "Malignant transformation risk"],
          rows: [
            ["Leukoplakia", "Hyperkeratotic white plaque that cannot be rubbed off", "3 to 5 percent transformation rate"],
            ["Erythroplakia", "Velvety, erythematous, smooth red mucosal patch", "Up to 90 percent harbor severe dysplasia or SCC"],
            ["Erythroleukoplakia", "Speckled mixed red and white mucosal plaque", "Intermediate to high risk (20 to 30 percent)"],
            ["Oral lichen planus", "Wickham striae, erosive reticular mucosal pattern", "Under 1 percent transformation risk"]
          ]
        }
      },
      {
        tx: "The AJCC 8th edition staging system for oral cancer incorporated depth of **invasion** (DOI) into primary tumor (T) categorization, reflecting the exponential risk of occult cervical lymph node metastases. DOI is measured microscopically from the level of the adjacent normal basement membrane to the deepest point of tumor invasion. Every 5 mm increase in depth of invasion upstages the primary tumor T-category independently of superficial diameter.",
        say: "The AJCC eighth edition incorporates depth of invasion into oral cavity T-staging. Depth is measured from the adjacent basement membrane to the deepest tumor margin. Every five millimeters of depth increases the T-stage and elevates nodal metastasis risk.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "o1", label: "Oral cavity squamous carcinoma biopsy" },
            { id: "o2", label: "Measure tumor diameter & microscopic depth of invasion" },
            { id: "o3", label: "DOI under 5 mm: T1 / DOI 5 to 10 mm: T2" },
            { id: "o4", label: "DOI over 10 mm upstages tumor directly to T3" },
            { id: "o5", label: "Selective neck dissection indicated if DOI > 3 to 4 mm" }
          ],
          edges: [
            ["o1", "o2"],
            ["o2", "o3"],
            ["o3", "o4"],
            ["o4", "o5"]
          ]
        }
      },
      {
        tx: "Surgical resection of oral cancer demands wide local **excision** with a 1.0 to 1.5 cm macroscopic three-dimensional surgical margin to secure a minimum 5 mm histological clear margin. Close margins (under 5 mm) and positive margins (tumor at ink) are associated with elevated local recurrence. When tumors approximate or invade the alveolar ridge, marginal mandibulectomy is performed if cortical bone alone is uninvolved, whereas segmental mandibulectomy is mandatory for marrow invasion.",
        say: "Oral cancer resection requires 1 to 1.5 centimeter gross margins to achieve a 5 millimeter clear microscopic margin. Marginal mandibulectomy preserves mandibular continuity for cortical proximity, while medullary invasion requires segmental bone resection.",
        vis: {
          kind: "table",
          cols: ["Mandibular status", "Surgical bone procedure", "Reconstruction modality"],
          rows: [
            ["Cortical bone untouched", "Wide soft-tissue resection alone", "Primary closure or split-thickness graft"],
            ["Tumor abuts or invades cortex", "Marginal mandibulectomy (rim resection)", "Local flap or submental island flap"],
            ["Gross medullary canal invasion", "Segmental mandibulectomy", "Vascularized free fibula osteocutaneous flap"],
            ["Extensive soft-tissue tongue defect", "Subtotal glossectomy", "Anterolateral thigh (ALT) free fasciocutaneous flap"]
          ]
        }
      },
      {
        tx: "Management of the cervical lymph nodes is vital, as oral cavity tumors exhibit occult nodal **metastasis** rates exceeding 20 percent even in clinically N0 necks. Elective selective neck dissection encompassing levels I, II, and III (supraomohyoid neck dissection) is standard for clinically node-negative early cancers with DOI greater than 3 to 4 mm. Pathological discovery of extranodal extension (ENE) in resected nodes necessitates postoperative concurrent chemoradiotherapy.",
        say: "Clinically node-negative oral cancers have an occult metastasis rate exceeding 20 percent. Elective supraomohyoid neck dissection of levels I through III is standard for tumors deeper than 4 millimeters. Extranodal extension mandates postoperative adjuvant chemoradiotherapy.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "n1", label: "Clinically N0 oral cancer with DOI > 3 mm" },
            { id: "n2", label: "Elective supraomohyoid neck dissection (levels I, II, III)" },
            { id: "n3", label: "Histological evaluation for extranodal extension" },
            { id: "n4", label: "Negative nodes: observation / Single node: radiotherapy" },
            { id: "n5", label: "Extranodal extension present: adjuvant chemoradiation" }
          ],
          edges: [
            ["n1", "n2"],
            ["n2", "n3"],
            ["n3", "n4"],
            ["n4", "n5"]
          ]
        }
      }
    ]
  },

  // 7. sur-salivary
  {
    module: "sur-salivary",
    subject: "surgery",
    title: "Salivary gland neoplasms: parotidectomy, facial nerve preservation, and malignant tumors",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "Blumgart's Surgery of the Liver, Biliary Tract and Pancreas"],
    steps: [
      {
        tx: "Salivary gland **tumors** adhere to the clinical rule of eighty: 80 percent occur in the parotid gland, 80 percent of parotid tumors are benign, and 80 percent of benign parotid tumors are pleomorphic adenomas. In contrast, tumors of the minor salivary glands carry an 80 percent malignancy rate. Pleomorphic adenoma presents as a firm, painless, slow-growing preauricular lump with pseudopodia that mandate formal parotidectomy rather than simple enucleation to avoid recurrences.",
        say: "Salivary neoplasms follow the rule of 80: 80 percent arise in the parotid, 80 percent are benign, and 80 percent are pleomorphic adenomas. Minor salivary gland tumors are 80 percent malignant. Pleomorphic adenomas require parotidectomy rather than enucleation to prevent recurrence.",
        vis: {
          kind: "table",
          cols: ["Salivary gland", "Proportion of all neoplasms", "Malignancy likelihood"],
          rows: [
            ["Parotid gland", "80 percent of all tumors", "20 to 25 percent malignant"],
            ["Submandibular gland", "10 to 15 percent of all tumors", "40 to 50 percent malignant"],
            ["Sublingual gland", "1 percent of all tumors", "70 to 80 percent malignant"],
            ["Minor salivary glands", "5 to 10 percent of all tumors", "80 to 85 percent malignant (predominantly adenoid cystic)"]
          ]
        }
      },
      {
        tx: "Superficial **parotidectomy** with facial nerve dissection constitutes the standard operation for benign tumors located lateral to the facial nerve plane. Enucleation is condemned due to capsular disruption and tumor seeding. The facial nerve exits the stylomastoid foramen and divides at the pes anserinus into temporofacial and cervicofacial trunks. Key anatomical landmarks used to locate the main trunk include the tragal pointer, tympanomastoid suture line, and posterior belly of the digastric.",
        say: "Superficial parotidectomy with facial nerve dissection is standard for tumors lateral to the nerve. Enucleation causes recurrence and is avoided. Landmarks to locate the facial nerve trunk include the tragal pointer, tympanomastoid suture line, and posterior belly of digastric.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "p1", label: "Skin incision & elevation of Blair parotid flap" },
            { id: "p2", label: "Dissection of tragal pointer & posterior digastric" },
            { id: "p3", label: "Identification of main facial nerve trunk at stylomastoid" },
            { id: "p4", label: "Meticulous neurolysis of five peripheral branches" },
            { id: "p5", label: "En bloc resection of superficial parotid lobe with tumor" }
          ],
          edges: [
            ["p1", "p2"],
            ["p2", "p3"],
            ["p3", "p4"],
            ["p4", "p5"]
          ]
        }
      },
      {
        tx: "Mucoepidermoid **carcinoma** is the most common malignant salivary neoplasm across adult and pediatric populations, composed of mucous, intermediate, and epidermoid squamoid cells. Low-grade tumors behave indolently and are cured by wide resection with nerve sparing. Adenoid cystic carcinoma is characterized by indolent relentless growth, pathognomonic perineural invasion along cranial nerves causing facial pain, and late hematogenous metastases to the lungs that can manifest decades following primary resection.",
        say: "Mucoepidermoid carcinoma is the most common salivary cancer, composed of mucous and squamoid cells. Adenoid cystic carcinoma features extensive perineural invasion causing facial pain, high recurrence rates, and late hematogenous lung metastases.",
        vis: {
          kind: "table",
          cols: ["Malignancy", "Histological hallmark", "Clinical behavior and spread"],
          rows: [
            ["Mucoepidermoid carcinoma", "Mixed mucin-secreting and squamous cells", "Most common salivary cancer; grade dictates prognosis"],
            ["Adenoid cystic carcinoma", "Cribriform Swiss-cheese pattern, basaloid cells", "Relentless perineural invasion, late pulmonary metastases"],
            ["Acinic cell carcinoma", "Serous acinar cells with zymogen granules", "Second most common pediatric parotid cancer; low grade"],
            ["Carcinoma ex pleomorphic", "Malignant transformation within benign adenoma", "Aggressive, high-grade; carries poor 5-year survival"]
          ]
        }
      },
      {
        tx: "Frey **syndrome** (gustatory sweating) represents a common long-term sequela of parotidectomy. Postoperative regeneration of transected parasympathetic secretomotor fibers from the auriculotemporal nerve aberrantly cross-innervate sympathetically denervated sweat glands and cutaneous capillaries of the overlying skin. Mastication or gustatory stimulation triggers facial sweating and erythema. Diagnosis is confirmed via Minor starch-iodine test; topical antiperspirants or intradermal botulinum toxin injections provide symptomatic relief.",
        say: "Frey syndrome causes gustatory sweating following parotidectomy. Transected parasympathetic secretomotor fibers aberrantly regenerate to reinnervate cutaneous sweat glands. Chewing triggers facial flushing and sweating, diagnosed by starch-iodine testing and treated with botulinum toxin.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "f1", label: "Parotidectomy transects auriculotemporal nerve fibers" },
            { id: "f2", label: "Parasympathetic secretomotor axons regenerate aberrantly" },
            { id: "f3", label: "Axons misroute into subdermal sweat glands & arterioles" },
            { id: "f4", label: "Gustatory stimulus induces localized facial sweating" },
            { id: "f5", label: "Minor starch-iodine confirmation & botulinum therapy" }
          ],
          edges: [
            ["f1", "f2"],
            ["f2", "f3"],
            ["f3", "f4"],
            ["f4", "f5"]
          ]
        }
      }
    ]
  },

  // 8. sur-neck
  {
    module: "sur-neck",
    subject: "surgery",
    title: "Congenital and acquired neck masses: branchial anomalies, thyroglossal duct cysts, and nodal metastases",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "Cummings Otolaryngology 7th ed"],
    steps: [
      {
        tx: "Differential diagnosis of a cervical **mass** is governed by age and anatomical triangles. In children, over 85 percent of masses are inflammatory or congenital anomalies. In adults older than 40 years, an asymptomatic lateral neck mass represents metastatic squamous cell carcinoma from an occult upper aerodigestive tract mucosal primary until proven otherwise. Initial diagnostic evaluation requires fine-needle aspiration biopsy (FNAB) and panendoscopy; open incisional biopsy is strictly contraindicated.",
        say: "Neck masses vary by age. In children, 85 percent are benign or congenital. In adults over 40, a persistent lateral neck mass is considered metastatic squamous cell carcinoma until proven otherwise. Evaluation requires fine-needle aspiration and endoscopy; incisional biopsy is contraindicated.",
        vis: {
          kind: "table",
          cols: ["Patient age", "Predominant pathology", "Diagnostic priority"],
          rows: [
            ["Pediatric (under 15 yr)", "Inflammatory lymphadenopathy (85%), congenital cysts", "Observation, antibiotic trial, ultrasound"],
            ["Young adult (16 to 40 yr)", "Inflammatory, thyroid, lymphoma, congenital branchial", "Ultrasound, serology, FNAB for persistent masses"],
            ["Adult (over 40 yr)", "Malignancy (80% rule: metastatic head/neck SCC)", "Urgent FNAB, CT neck/chest, mucosal panendoscopy"],
            ["Any age with midline mass", "Thyroglossal duct cyst, dermoid cyst, delphian node", "Confirm normal thyroid location before excision"]
          ]
        }
      },
      {
        tx: "Thyroglossal **duct** cyst (TGDC) arises from failure of obliteration of the embryonic thyroid descent pathway from the foramen cecum of the tongue base to the inferior neck. It presents as a painless, smooth, cystic midline mass located below the hyoid bone that elevates with tongue protrusion and swallowing. Definitive cure requires the Sistrunk procedure: en bloc resection of the cyst, the central body of the hyoid bone, and a core of tongue base tissue.",
        say: "Thyroglossal duct cysts result from incomplete obliteration of the thyroid descent tract. They present as midline masses that elevate with tongue protrusion. Surgical cure requires the Sistrunk procedure, which resects the cyst, central hyoid bone, and a tongue base tissue core.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "t1", label: "Thyroid descends from foramen cecum through hyoid" },
            { id: "t2", label: "Epithelial tract persists and fills with mucoid fluid" },
            { id: "t3", label: "Midline neck cyst moves upward on tongue protrusion" },
            { id: "t4", label: "Thyroid ultrasound confirms orthotopic thyroid gland" },
            { id: "t5", label: "Sistrunk en bloc excision of cyst, hyoid body, and tract" }
          ],
          edges: [
            ["t1", "t2"],
            ["t2", "t3"],
            ["t3", "t4"],
            ["t4", "t5"]
          ]
        }
      },
      {
        tx: "Branchial **cleft** anomalies arise from incomplete involution of embryonic pharyngeal arches. Second branchial cleft anomalies represent 95 percent of cases, typically manifesting as a smooth, fluctuant mass along the anterior border of the sternocleidomastoid muscle at the junction of its upper and middle thirds. The fistulous tract ascends between internal and external carotid arteries and terminates in the tonsillar fossa. First branchial anomalies relate to the parotid gland and external auditory canal.",
        say: "Second branchial cleft cysts account for 95 percent of branchial anomalies, presenting along the anterior border of the sternocleidomastoid muscle. The tract passes between the internal and external carotid arteries to the tonsillar fossa. Surgical excision requires complete tract removal.",
        vis: {
          kind: "table",
          cols: ["Cleft anomaly", "Anatomical location", "Internal tract course & opening"],
          rows: [
            ["First branchial cleft", "Parotid area, angle of mandible, submandibular", "Ascends toward external auditory canal / facial nerve"],
            ["Second branchial cleft", "Anterior border of SCM, upper-middle third", "Passes between carotids, enters tonsillar fossa"],
            ["Third branchial cleft", "Lower anterior neck, posterior to carotid sheath", "Passes above hypoglossal nerve, enters pyriform sinus"],
            ["Fourth branchial cleft", "Low left neck, recurrent thyroiditis / abscess", "Loops under aortic arch / subclavian, pyriform apex"]
          ]
        }
      },
      {
        tx: "Neck **dissection** classifications standardize regional oncological lymphadenectomy across cervical levels I through VI. Radical neck dissection (RND) removes all nodal levels I-V along with the sternocleidomastoid muscle, internal jugular vein, and spinal accessory nerve. Modified radical neck dissection (MRND) preserves one or more of these non-lymphatic structures. Selective neck dissection resects only nodal levels at greatest risk of occult metastases based on primary tumor location.",
        say: "Cervical lymph node dissections are categorized from levels I through VI. Radical neck dissection removes levels I through V plus the spinal accessory nerve, internal jugular vein, and sternocleidomastoid. Modified radical dissections preserve non-lymphatic structures, while selective dissections target specific levels.",
        vis: {
          kind: "table",
          cols: ["Cervical level", "Anatomical boundaries", "Primary tumor drainage sites"],
          rows: [
            ["Level I (submental / submandibular)", "Mandible to hyoid, anterior/posterior digastric", "Lip, oral cavity, floor of mouth, anterior tongue"],
            ["Level II (upper jugular)", "Skull base to carotid bifurcation (hyoid bone)", "Oral cavity, oropharynx, nasopharynx, parotid"],
            ["Level III (middle jugular)", "Carotid bifurcation down to cricoid cartilage", "Oropharynx, hypopharynx, larynx, thyroid"],
            ["Level IV (lower jugular)", "Cricoid cartilage to clavicle", "Hypopharynx, larynx, thyroid, cervical esophagus"],
            ["Level V (posterior triangle)", "SCM to trapezius, clavicle inferiorly", "Nasopharynx, posterior scalp, cutaneous neck"],
            ["Level VI (anterior / central)", "Hyoid to sternal notch, between carotid sheaths", "Thyroid, parathyroid, subglottic larynx"]
          ]
        }
      }
    ]
  },

  // 9. sur-parathyroid-adrenal
  {
    module: "sur-parathyroid-adrenal",
    subject: "surgery",
    title: "Surgical endocrinopathies: primary hyperparathyroidism, pheochromocytoma, and adrenalectomy",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "AAES Guidelines for Primary Hyperparathyroidism"],
    steps: [
      {
        tx: "Primary **hyperparathyroidism** (PHPT) is characterized by autonomous, uninhibited secretion of parathyroid hormone (PTH) producing hypercalcemia and hypophosphatemia. A single benign parathyroid adenoma accounts for 85 percent of cases, primary chief cell hyperplasia for 15 percent, and parathyroid carcinoma for under 1 percent. Classic clinical manifestations encompass painful bones, renal stones, abdominal groans, and psychic moans, though most modern patients present with asymptomatic hypercalcemia on routine screening.",
        say: "Primary hyperparathyroidism causes autonomous parathyroid hormone secretion, elevating serum calcium and lowering phosphate. A single adenoma accounts for 85 percent of cases, and four-gland hyperplasia for 15 percent. Symptoms include nephrolithiasis, bone disease, abdominal pain, and depression.",
        vis: {
          kind: "table",
          cols: ["Pathology", "Frequency", "Glandular involvement", "Surgical approach"],
          rows: [
            ["Single adenoma", "80 to 85 percent", "One abnormal enlarged gland", "Minimally invasive parathyroidectomy (MIP)"],
            ["Four-gland hyperplasia", "10 to 15 percent", "All four glands diffusely enlarged", "Subtotal (3.5 gland) resection or total + auto-transplant"],
            ["Double adenoma", "2 to 5 percent", "Two distinct enlarged glands", "Bilateral neck exploration & excision of both"],
            ["Parathyroid carcinoma", "Under 1 percent", "Hard, adherent, local invasion", "En bloc resection with ipsilateral thyroid lobectomy"]
          ]
        }
      },
      {
        tx: "Preoperative parathyroid **localization** utilizes sestamibi scintigraphy with single-photon emission CT (SPECT) and high-resolution cervical ultrasound. When concordant, these imaging modalities enable minimally invasive parathyroidectomy (MIP). Intraoperative parathyroid hormone (IOPTH) monitoring confirms complete resection via the Miami criterion: a drop in serum PTH of 50 percent or greater from baseline 10 minutes following adenoma excision, which carries a 98 percent cure rate.",
        say: "Parathyroid adenomas are localized preoperatively with ultrasound and sestamibi SPECT scans. Concordant imaging allows minimally invasive parathyroidectomy. Complete excision is confirmed intraoperatively by the Miami criterion: a 50 percent or greater PTH drop 10 minutes post-excision.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "p1", label: "Biochemical confirmation of primary hyperparathyroidism" },
            { id: "p2", label: "Concordant localization with ultrasound and sestamibi SPECT" },
            { id: "p3", label: "Targeted minimally invasive parathyroidectomy (MIP)" },
            { id: "p4", label: "Intraoperative PTH draw at baseline and 10 minutes post-excision" },
            { id: "p5", label: "Confirm > 50 percent PTH drop indicating operative cure" }
          ],
          edges: [
            ["p1", "p2"],
            ["p2", "p3"],
            ["p3", "p4"],
            ["p4", "p5"]
          ]
        }
      },
      {
        tx: "Pheochromocytoma is a catecholamine-secreting **chromaffin** tumor arising from the adrenal medulla. Diagnosis is established by 24-hour urinary fractionated metanephrines or plasma free metanephrines. Preoperative pharmacological preparation is non-negotiable to avert lethal intraoperative hypertensive crisis. Alpha-adrenergic blockade (phenoxybenzamine) must be initiated 10 to 14 days prior to surgery; beta-adrenergic blockers are added ONLY after adequate alpha blockade to avoid unopposed alpha vasoconstriction.",
        say: "Pheochromocytoma arises from the adrenal medulla, secreting catecholamines. Diagnosis is confirmed by elevated metanephrines. Preoperative alpha-blockade with phenoxybenzamine is mandatory for 10 to 14 days; beta-blockers are added only after alpha blockade to prevent hypertensive crisis.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "c1", label: "Elevated plasma and urinary metanephrines" },
            { id: "c2", label: "Initiate non-competitive alpha blockade (phenoxybenzamine)" },
            { id: "c3", label: " liberal salt and fluid intake to expand contracted intravascular volume" },
            { id: "c4", label: "Add beta-blocker (propranolol) only after full alpha blockade" },
            { id: "c5", label: "Laparoscopic adrenalectomy with early adrenal vein ligation" }
          ],
          edges: [
            ["c1", "c2"],
            ["c2", "c3"],
            ["c3", "c4"],
            ["c4", "c5"]
          ]
        }
      },
      {
        tx: "Laparoscopic transperitoneal or retroperitoneal **adrenalectomy** is the procedure of choice for benign functional adrenal tumors under 6 cm, including aldosteronomas (Conn syndrome), Cushing adenomas, and pheochromocytomas. Open adrenalectomy is mandated for suspected adrenal cortical carcinoma (ACC) or tumors exceeding 6 to 8 cm to achieve negative margins without capsular violation. Early ligation of the main adrenal vein is critical during pheochromocytoma resection to prevent hemodynamic instability.",
        say: "Laparoscopic adrenalectomy is the gold standard for benign functional tumors under 6 centimeters. Open adrenalectomy is indicated for suspected adrenocortical carcinoma or lesions larger than 6 centimeters. Early adrenal vein ligation prevents intraoperative catecholamine surges.",
        vis: {
          kind: "table",
          cols: ["Adrenal lesion", "Key biochemical diagnostic test", "First-line surgical indication"],
          rows: [
            ["Aldosteronoma (Conn syndrome)", "Elevated aldosterone-to-renin ratio (ARR > 20)", "Laparoscopic unilateral adrenalectomy"],
            ["Cushing adenoma", "24-hr urinary free cortisol, late-night salivary", "Laparoscopic unilateral adrenalectomy"],
            ["Pheochromocytoma", "Plasma / 24-hr urinary metanephrines", "Laparoscopic adrenalectomy post alpha-blockade"],
            ["Adrenocortical carcinoma", "Mixed hormone excess, large irregular mass > 6 cm", "Open transabdominal radical en bloc adrenalectomy"]
          ]
        }
      }
    ]
  },

  // 10. sur-oesophagus
  {
    module: "sur-oesophagus",
    subject: "surgery",
    title: "Esophageal motility disorders, antireflux surgery, Barrett esophagus, and esophagectomy",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "SAGES Antireflux Surgery Guidelines"],
    steps: [
      {
        tx: "Achalasia is a primary neurodegenerative esophageal **motility** disorder characterized by loss of nitric oxide-producing inhibitory ganglion cells in the myenteric Auerbach plexus. Pathophysiological consequences include absent peristalsis in the esophageal body and incomplete relaxation of the hypertensive lower esophageal sphincter (LES). Patients present with progressive dysphagia to both solids and liquids. High-resolution manometry is diagnostic; barium swallow reveals bird-beak tapering at the gastroesophageal junction.",
        say: "Achalasia results from loss of myenteric inhibitory ganglion cells, causing absent peristalsis and failure of lower esophageal sphincter relaxation. Patients present with dysphagia to solids and liquids. Barium swallow shows bird-beak tapering, and manometry confirms diagnosis.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "a1", label: "Autoimmune loss of myenteric inhibitory ganglion cells" },
            { id: "a2", label: "Loss of nitric oxide & VIP produces aperistalsis" },
            { id: "a3", label: "Failure of lower esophageal sphincter relaxation" },
            { id: "a4", label: "Progressive esophageal dilation & stasis" },
            { id: "a5", label: "Laparoscopic Heller myotomy with partial Dor fundoplication" }
          ],
          edges: [
            ["a1", "a2"],
            ["a2", "a3"],
            ["a3", "a4"],
            ["a4", "a5"]
          ]
        }
      },
      {
        tx: "Surgical management of achalasia is centered on laparoscopic **Heller** myotomy with partial anterior fundoplication (Dor) or posterior fundoplication (Toupet). The longitudinal and circular muscular layers of the lower esophagus are divided down to intact mucosal herniation, extending 2 cm onto the gastric cardia. A partial fundoplication is mandatory to prevent severe post-myotomy acid reflux while avoiding the postoperative dysphagia associated with complete 360-degree Nissen wraps.",
        say: "Laparoscopic Heller myotomy divides esophageal muscle down to bulging mucosa, extending two centimeters onto the stomach. A partial Dor or Toupet fundoplication is added to prevent acid reflux without causing the dysphagia of a complete 360-degree Nissen wrap.",
        vis: {
          kind: "table",
          cols: ["Procedure", "Mechanism of action", "Key advantage / limitation"],
          rows: [
            ["Laparoscopic Heller myotomy", "Surgical division of circular and longitudinal LES muscle", "Gold standard; durable relief; requires partial wrap"],
            ["POEM (Peroral endoscopic myotomy)", "Submucosal endoscopic tunnel and inner circular myotomy", "No incisions; higher post-op reflux rate without wrap"],
            ["Pneumatic balloon dilation", "Forceful disruption of LES circular fibers by radial air", "Effective; carries 2 to 3 percent esophageal perforation risk"],
            ["Botulinum toxin injection", "Inhibits acetylcholine release at motor endplates", "Temporary (6-12 months); reserved for frail elderly patients"]
          ]
        }
      },
      {
        tx: "Gastroesophageal **reflux** disease (GERD) refractory to medical proton-pump inhibitor therapy is managed with laparoscopic Nissen fundoplication. Preoperative workup mandates 24-hour ambulatory esophageal pH monitoring and manometry to rule out motility disorders. The procedure involves crural hiatal hernia repair, complete mobilization of the gastric fundus with division of short gastric vessels, and construction of a loose, floppy 360-degree 2 cm wrap over a 56 to 60 French bougie.",
        say: "Refractory gastroesophageal reflux disease is treated with laparoscopic Nissen fundoplication. Preoperative evaluation requires 24-hour pH monitoring and manometry. The surgery repairs the hiatus, divides short gastric vessels, and constructs a loose 360-degree wrap over a large bougie.",
        vis: {
          kind: "flow",
          nodes: [
            { id: "r1", label: "Confirmation of abnormal acid exposure on 24-hr pH study" },
            { id: "r2", label: "Manometry confirms normal peristalsis prior to wrap" },
            { id: "r3", label: "Crural closure with non-absorbable interrupted sutures" },
            { id: "r4", label: "Division of short gastric vessels for tension-free wrap" },
            { id: "r5", label: "Construct 2 cm loose 360-degree Nissen fundoplication" }
          ],
          edges: [
            ["r1", "r2"],
            ["r2", "r3"],
            ["r3", "r4"],
            ["r4", "r5"]
          ]
        }
      },
      {
        tx: "Esophageal **carcinoma** is divided into squamous cell carcinoma (upper and mid-esophagus, associated with alcohol and tobacco) and adenocarcinoma (distal esophagus and GE junction, arising from Barrett metaplasia). For locally advanced resectable disease (cT2-T4a or N+), neoadjuvant chemoradiation (CROSS regimen) precedes transthoracic esophagectomy. Ivor Lewis esophagectomy consists of laparotomy with gastric conduit creation and right thoracotomy with intrathoracic esophagogastric anastomosis.",
        say: "Esophageal adenocarcinoma arises in distal Barrett esophagus, while squamous cell carcinoma affects the upper esophagus. Locally advanced disease receives neoadjuvant chemoradiation prior to surgery. Ivor Lewis esophagectomy combines laparotomy and right thoracotomy with intrathoracic anastomosis.",
        vis: {
          kind: "table",
          cols: ["Esophagectomy approach", "Incisions used", "Anastomotic location & complications"],
          rows: [
            ["Ivor Lewis (two-stage)", "Laparotomy and right thoracotomy", "Intrathoracic; lower leak rate, higher mediastinitis risk"],
            ["McKeown (three-hole)", "Right thoracotomy, laparotomy, left neck", "Cervical anastomosis; easier leak management, more nerve injury"],
            ["Transhiatal", "Laparotomy and left neck incision", "Cervical; avoids thoracotomy; lower lymph node yield"],
            ["Minimally invasive (MIE)", "Thoracoscopy and laparoscopy", "Decreased pulmonary complications; equivalent oncologic clearance"]
          ]
        }
      }
    ]
  }
];
