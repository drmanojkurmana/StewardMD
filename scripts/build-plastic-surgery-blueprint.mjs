import fs from "node:fs";
import path from "node:path";

const blueprint = {
  subject: "ss-plastic-surgery",
  title: "Plastic and Reconstructive Surgery",
  branch: "ss-surgery",
  curriculum: "NMC Competency-Based MCh Plastic and Reconstructive Surgery Curriculum / NBEMS NEET-SS Surgical Specialty Group",
  examPattern: "NEET-SS Surgical Group (100% General Surgery and Surgical Subspecialties). High-yield topics: flap biology, microsurgery, burns, hand surgery, craniofacial trauma, clefts, breast reconstruction, aesthetics.",
  book: "Neligan: Plastic Surgery 5th Edition 2024 (Elsevier)",
  sections: [
    {
      id: "spl-sec-principles",
      name: "General Principles, Grafts and Flap Physiology",
      modules: [
        {
          id: "spl-reconstructive",
          name: "Reconstructive Surgery and Flaps",
          topics: [
            {
              id: "spl-reconstructive",
              title: "Principles of Flap Physiology and Classifications",
              book: "Plastic Surgery 5E Vol 1 Ch 24 (Flap physiology, classification, and applications)",
              mustKnow: [
                {
                  fact: "Reconstructive ladder progresses from primary closure, healing by secondary intention, skin graft, local flap, regional flap, to distant free tissue transfer.",
                  terms: ["reconstructive ladder", "free tissue transfer"],
                  source: "Plastic Surgery 5E Ch 24"
                },
                {
                  fact: "Random pattern flaps rely on the subdermal plexus without a named axial vessel, with a traditional length-to-width ratio rarely exceeding 2:1 on the trunk or extremities.",
                  terms: ["subdermal plexus", "random pattern"],
                  numbers: ["2:1"],
                  source: "Plastic Surgery 5E Ch 24"
                },
                {
                  fact: "Axial pattern flaps are supplied by a named anatomically recognized arteriovenous vascular axis running along the long axis of the flap.",
                  terms: ["axial pattern", "arteriovenous"],
                  source: "Plastic Surgery 5E Ch 24"
                },
                {
                  fact: "Mathes and Nahai classify muscle flaps into 5 types based on their vascular pedicle anatomy.",
                  terms: ["Mathes and Nahai", "muscle flaps"],
                  numbers: ["5"],
                  source: "Plastic Surgery 5E Ch 24"
                },
                {
                  fact: "Type I muscle flap has a single vascular pedicle, exemplified by the tensor fasciae latae and gastrocnemius muscles.",
                  terms: ["Type I", "tensor fasciae latae", "gastrocnemius"],
                  source: "Plastic Surgery 5E Ch 24"
                },
                {
                  fact: "Type II muscle flap has a dominant vascular pedicle and minor pedicles, exemplified by the gracilis, trapezius, and soleus muscles.",
                  terms: ["Type II", "gracilis", "soleus"],
                  source: "Plastic Surgery 5E Ch 24"
                },
                {
                  fact: "Type III muscle flap has two dominant pedicles of equal size, exemplified by the gluteus maximus and rectus abdominis muscles.",
                  terms: ["Type III", "gluteus maximus", "rectus abdominis"],
                  numbers: ["two"],
                  source: "Plastic Surgery 5E Ch 24"
                },
                {
                  fact: "Type IV muscle flap has segmental pedicles without a dominant supply, exemplified by the sartorius and tibialis anterior muscles.",
                  terms: ["Type IV", "segmental pedicles", "sartorius"],
                  source: "Plastic Surgery 5E Ch 24"
                },
                {
                  fact: "Type V muscle flap has one dominant pedicle and secondary segmental pedicles, exemplified by the latissimus dorsi and pectoralis major muscles.",
                  terms: ["Type V", "latissimus dorsi", "pectoralis major"],
                  source: "Plastic Surgery 5E Ch 24"
                },
                {
                  fact: "Surgical delay phenomenon enhances flap survival by causing dilation of choke vessels and longitudinal reorientation of blood flow over 10 to 14 days.",
                  terms: ["delay phenomenon", "choke vessels"],
                  numbers: ["10", "14"],
                  source: "Plastic Surgery 5E Ch 24"
                }
              ]
            }
          ]
        },
        {
          id: "spl-wound-healing",
          name: "Wound Healing Biology and Scars",
          topics: [
            {
              id: "spl-wound-healing",
              title: "Wound Healing Biology, Cytokines and Abnormal Scars",
              book: "Plastic Surgery 5E Vol 1 Ch 15 (Wound healing) & Ch 16 (Scar prevention, treatment, and revision)",
              mustKnow: [
                {
                  fact: "Wound healing proceeds through four overlapping phases: haemostasis, inflammation, proliferation, and tissue remodelling or maturation.",
                  terms: ["haemostasis", "inflammation", "proliferation", "remodelling"],
                  numbers: ["four"],
                  source: "Plastic Surgery 5E Ch 15"
                },
                {
                  fact: "Platelets in the haemostatic clot release platelet-derived growth factor PDGF and transforming growth factor beta TGF-beta.",
                  terms: ["platelets", "PDGF", "TGF-beta"],
                  source: "Plastic Surgery 5E Ch 15"
                },
                {
                  fact: "Macrophages enter the wound at 48 to 72 hours and represent the key regulatory cell orchestrating wound transition from inflammation to proliferation.",
                  terms: ["macrophages", "regulatory cell"],
                  numbers: ["48", "72"],
                  source: "Plastic Surgery 5E Ch 15"
                },
                {
                  fact: "Type III collagen is synthesised early in granulation tissue and gradually replaced by stronger Type I collagen during the maturation phase.",
                  terms: ["Type III collagen", "Type I collagen", "granulation tissue"],
                  source: "Plastic Surgery 5E Ch 15"
                },
                {
                  fact: "Normal adult unwounded dermis has a Type I to Type III collagen ratio of approximately 4:1.",
                  terms: ["collagen ratio", "dermis"],
                  numbers: ["4:1"],
                  source: "Plastic Surgery 5E Ch 15"
                },
                {
                  fact: "Wound tensile strength reaches about 20% of normal at 3 weeks and plateaus at approximately 70% to 80% of uninjured skin strength by 3 months.",
                  terms: ["tensile strength"],
                  numbers: ["20%", "3", "70%", "80%"],
                  source: "Plastic Surgery 5E Ch 15"
                },
                {
                  fact: "Hypertrophic scars stay strictly within the original wound boundaries and typically regress spontaneously over 12 to 24 months.",
                  terms: ["hypertrophic scars", "original wound boundaries"],
                  numbers: ["12", "24"],
                  source: "Plastic Surgery 5E Ch 16"
                },
                {
                  fact: "Keloids extend beyond the original wound margins into normal adjacent dermis, rarely regress, and carry a high recurrence rate after simple surgical excision.",
                  terms: ["keloids", "original wound margins"],
                  source: "Plastic Surgery 5E Ch 16"
                },
                {
                  fact: "First-line conservative therapy for established hypertrophic and keloid scars includes silicone gel sheeting combined with intralesional triamcinolone acetonide injections.",
                  terms: ["silicone gel sheeting", "triamcinolone"],
                  drugs: ["triamcinolone"],
                  source: "Plastic Surgery 5E Ch 16"
                }
              ]
            }
          ]
        },
        {
          id: "spl-skin-grafts",
          name: "Skin Grafts and Skin Substitutes",
          topics: [
            {
              id: "spl-skin-grafts",
              title: "Skin Grafts: STSG, FTSG and Graft Take Biology",
              book: "Plastic Surgery 5E Vol 1 Ch 17 (Skin grafting)",
              mustKnow: [
                {
                  fact: "Split-thickness skin grafts STSG contain epidermis and a superficial variable portion of the dermis, categorised as thin 0.008 to 0.012 inches, medium 0.012 to 0.018 inches, and thick 0.018 to 0.024 inches.",
                  terms: ["split-thickness skin grafts", "STSG", "dermis"],
                  numbers: ["0.008", "0.012", "0.018", "0.024"],
                  source: "Plastic Surgery 5E Ch 17"
                },
                {
                  fact: "Full-thickness skin grafts FTSG contain epidermis and the entire dermis including adnexal structures, producing minimal secondary contracture but requiring a well-vascularised bed.",
                  terms: ["full-thickness skin grafts", "FTSG", "secondary contracture"],
                  source: "Plastic Surgery 5E Ch 17"
                },
                {
                  fact: "Skin graft take occurs through three sequential phases: plasmatic imbibition during the first 24 to 48 hours, inosculation at 48 to 72 hours, and revascularisation.",
                  terms: ["plasmatic imbibition", "inosculation", "revascularisation"],
                  numbers: ["24", "48", "72"],
                  source: "Plastic Surgery 5E Ch 17"
                },
                {
                  fact: "Plasmatic imbibition nourishes the graft via passive capillary absorption of nutrients and tissue fluid, leading to a 20% to 40% initial graft weight gain.",
                  terms: ["plasmatic imbibition", "capillary absorption"],
                  numbers: ["20%", "40%"],
                  source: "Plastic Surgery 5E Ch 17"
                },
                {
                  fact: "Inosculation represents direct alignment and micro-anastomosis between graft donor capillaries and recipient bed capillary buds around day 3.",
                  terms: ["inosculation", "micro-anastomosis"],
                  numbers: ["3"],
                  source: "Plastic Surgery 5E Ch 17"
                },
                {
                  fact: "Primary contraction is immediate elastic recoil of the graft upon harvesting, which is greatest in full-thickness grafts due to abundant dermal elastin.",
                  terms: ["primary contraction", "elastic recoil", "elastin"],
                  source: "Plastic Surgery 5E Ch 17"
                },
                {
                  fact: "Secondary contraction is wound bed myofibroblast-mediated contracture occurring after grafting, which is greatest in thin split-thickness grafts.",
                  terms: ["secondary contraction", "myofibroblast"],
                  source: "Plastic Surgery 5E Ch 17"
                },
                {
                  fact: "Haematoma formation under the graft is the most common single cause of skin graft failure.",
                  terms: ["haematoma", "graft failure"],
                  source: "Plastic Surgery 5E Ch 17"
                },
                {
                  fact: "Composite grafts consist of skin and underlying subcutaneous cartilage or fat, typically limited to 1.5 cm diameter due to reliance on peripheral bed revascularisation.",
                  terms: ["composite grafts", "cartilage"],
                  numbers: ["1.5"],
                  source: "Plastic Surgery 5E Ch 17"
                }
              ]
            }
          ]
        },
        {
          id: "spl-angiosomes-perforators",
          name: "Angiosomes and Perforator Flap Anatomy",
          topics: [
            {
              id: "spl-angiosomes-perforators",
              title: "Angiosomes, Perforator Flaps and Vascular Territories",
              book: "Plastic Surgery 5E Vol 1 Ch 23 (Vascular territories)",
              mustKnow: [
                {
                  fact: "Taylor and Palmer defined an angiosome as a three-dimensional anatomical block of tissue supplied by a specific source artery and its companion veins.",
                  terms: ["Taylor and Palmer", "angiosome", "source artery"],
                  source: "Plastic Surgery 5E Ch 23"
                },
                {
                  fact: "Adjacent angiosomes communicate across boundary territories through true anastomoses without caliber change, or choke vessels that exhibit caliber narrowing.",
                  terms: ["anastomoses", "choke vessels"],
                  source: "Plastic Surgery 5E Ch 23"
                },
                {
                  fact: "Perforator flaps are nourished by cutaneous perforator vessels that pierce deep fascia, dissected retrograde through muscle or septum to the source vessels.",
                  terms: ["perforator flaps", "cutaneous perforator", "deep fascia"],
                  source: "Plastic Surgery 5E Ch 23"
                },
                {
                  fact: "Musculocutaneous perforators traverse muscle fibres, whereas septocutaneous perforators travel entirely within intermuscular septa.",
                  terms: ["musculocutaneous", "septocutaneous"],
                  source: "Plastic Surgery 5E Ch 23"
                },
                {
                  fact: "Anterolateral thigh ALT flap is based on perforators from the descending branch of the lateral circumflex femoral artery LCFA.",
                  terms: ["anterolateral thigh", "ALT flap", "lateral circumflex femoral artery"],
                  source: "Plastic Surgery 5E Ch 23"
                },
                {
                  fact: "Deep inferior epigastric perforator DIEP flap is based on periumbilical perforators piercing the anterior rectus abdominis sheath.",
                  terms: ["DIEP flap", "deep inferior epigastric", "rectus abdominis"],
                  source: "Plastic Surgery 5E Ch 23"
                },
                {
                  fact: "Preoperative handheld acoustic Doppler, CT angiography CTA, and indocyanine green ICG fluorescence angiography reliably map perforator location and caliber.",
                  terms: ["CT angiography", "indocyanine green", "Doppler"],
                  source: "Plastic Surgery 5E Ch 23"
                },
                {
                  fact: "Perforator flaps preserve the underlying source muscle intact, eliminating donor site muscle morbidity, hernia risk, and functional weakness.",
                  terms: ["donor site morbidity", "muscle preservation"],
                  source: "Plastic Surgery 5E Ch 23"
                }
              ]
            }
          ]
        },
        {
          id: "spl-microsurgery-technique",
          name: "Microvascular Surgery and Free Tissue Transfer",
          topics: [
            {
              id: "spl-microsurgery-technique",
              title: "Microvascular Anastomosis, Thrombosis and Free Flap Monitoring",
              book: "Plastic Surgery 5E Vol 1 Ch 25 (Principles and techniques of microvascular surgery)",
              mustKnow: [
                {
                  fact: "Microvascular anastomoses under operating microscope magnification typically utilize 9-0 or 10-0 nylon interrupted or continuous sutures.",
                  terms: ["microvascular anastomoses", "operating microscope", "nylon"],
                  numbers: ["9-0", "10-0"],
                  source: "Plastic Surgery 5E Ch 25"
                },
                {
                  fact: "End-to-end arterial anastomosis is preferred when vessel diameters match, whereas end-to-side anastomosis accommodates size discrepancies greater than 1.5:1 to 2:1.",
                  terms: ["end-to-end", "end-to-side", "size discrepancies"],
                  numbers: ["1.5:1", "2:1"],
                  source: "Plastic Surgery 5E Ch 25"
                },
                {
                  fact: "Venous thrombosis occurs more frequently than arterial thrombosis and accounts for over 60% of all microvascular flap failures.",
                  terms: ["venous thrombosis", "arterial thrombosis"],
                  numbers: ["60%"],
                  source: "Plastic Surgery 5E Ch 25"
                },
                {
                  fact: "Microvascular flap thrombosis occurs predominantly within the first 24 to 72 hours postoperatively, demanding rigorous hourly flap monitoring.",
                  terms: ["flap thrombosis", "flap monitoring"],
                  numbers: ["24", "72"],
                  source: "Plastic Surgery 5E Ch 25"
                },
                {
                  fact: "Signs of arterial compromise include pallor, delayed capillary refill over 3 seconds, loss of tissue turgor, cool skin temperature, and bright red scant or absent pinprick bleeding.",
                  terms: ["arterial compromise", "capillary refill", "pallor"],
                  numbers: ["3"],
                  source: "Plastic Surgery 5E Ch 25"
                },
                {
                  fact: "Signs of venous congestion include cyanosis, rapid capillary refill under 1 second, brisk dark venous bleeding upon pinprick, and tense swelling.",
                  terms: ["venous congestion", "cyanosis", "pinprick"],
                  numbers: ["1"],
                  source: "Plastic Surgery 5E Ch 25"
                },
                {
                  fact: "Urgent surgical re-exploration within 4 to 6 hours of detected vascular insufficiency salvages over 70% of compromised free flaps.",
                  terms: ["re-exploration", "salvage"],
                  numbers: ["4", "6", "70%"],
                  source: "Plastic Surgery 5E Ch 25"
                },
                {
                  fact: "Pharmacological adjuncts in microvascular surgery include intraoperative topical papaverine or lidocaine irrigation to counteract vasospasm, and weight-based heparin prophylaxis.",
                  terms: ["papaverine", "lidocaine", "heparin"],
                  drugs: ["papaverine", "lidocaine", "heparin"],
                  source: "Plastic Surgery 5E Ch 25"
                }
              ]
            }
          ]
        },
        {
          id: "spl-tissue-expansion",
          name: "Tissue Expansion Principles and Biomaterials",
          topics: [
            {
              id: "spl-tissue-expansion",
              title: "Tissue Expansion: Physiology, Calculations and Complications",
              book: "Plastic Surgery 5E Vol 1 Ch 26 (Tissue expansion and implants) & Ch 31 (Implants and biomaterials)",
              mustKnow: [
                {
                  fact: "Tissue expansion recruits biological creep via real tissue generation through cellular proliferation, accompanied by stress relaxation and elastic fiber deformation.",
                  terms: ["tissue expansion", "biological creep", "stress relaxation"],
                  source: "Plastic Surgery 5E Ch 26"
                },
                {
                  fact: "Histological changes during tissue expansion include epidermal thickening, marked dermal thinning with collagen compaction, and formation of a vascularised fibrous capsule.",
                  terms: ["epidermal thickening", "dermal thinning", "fibrous capsule"],
                  source: "Plastic Surgery 5E Ch 26"
                },
                {
                  fact: "Muscle underlying an expander undergoes temporary atrophy and decreased muscle fiber thickness, but functional recovery occurs after expander removal.",
                  terms: ["muscle atrophy", "functional recovery"],
                  source: "Plastic Surgery 5E Ch 26"
                },
                {
                  fact: "Expanders are filled weekly with sterile normal saline via an integrated or remote metallic magnetic injection port until the target volume is reached over 8 to 12 weeks.",
                  terms: ["normal saline", "injection port"],
                  numbers: ["8", "12"],
                  source: "Plastic Surgery 5E Ch 26"
                },
                {
                  fact: "Expander base dimension should match or exceed the defect dimensions, generating tissue gain equal to approximately 25% to 35% of the total expander surface area.",
                  terms: ["expander base", "defect dimensions"],
                  numbers: ["25%", "35%"],
                  source: "Plastic Surgery 5E Ch 26"
                },
                {
                  fact: "Expander extrusion occurs most frequently due to excessive tension, wound dehiscence, or pocket infection with Staphylococcus aureus or epidermidis.",
                  terms: ["expander extrusion", "Staphylococcus aureus"],
                  source: "Plastic Surgery 5E Ch 26"
                },
                {
                  fact: "Major indications for tissue expansion include scalp reconstruction for alopecia, paediatric giant congenital melanocytic nevi, and two-stage breast reconstruction.",
                  terms: ["scalp reconstruction", "alopecia", "congenital melanocytic nevi"],
                  source: "Plastic Surgery 5E Ch 26"
                },
                {
                  fact: "Capsular contracture around smooth silicone implants is graded by the Baker classification from Grade I soft to Grade IV severe pain and distortion.",
                  terms: ["capsular contracture", "Baker classification"],
                  numbers: ["IV"],
                  source: "Plastic Surgery 5E Ch 31"
                }
              ]
            }
          ]
        },
        {
          id: "spl-fat-grafting",
          name: "Fat Grafting and Regenerative Surgery",
          topics: [
            {
              id: "spl-fat-grafting",
              title: "Autologous Fat Grafting: Coleman Technique and Adipose Stem Cells",
              book: "Plastic Surgery 5E Vol 1 Ch 22 (Repair and grafting fat and adipose tissue)",
              mustKnow: [
                {
                  fact: "Coleman technique for autologous fat transfer standardises low-pressure manual aspiration with 10 mL syringes, low-speed centrifugation at 3000 rpm for 3 minutes, and micro-droplet reinjection.",
                  terms: ["Coleman technique", "fat transfer", "centrifugation"],
                  numbers: ["10", "3000", "3"],
                  source: "Plastic Surgery 5E Ch 22"
                },
                {
                  fact: "Centrifugation separates the lipoaspirate into three distinct layers: an oily top layer of free lipids, a middle purified condensed fat graft, and a bottom aqueous and blood layer.",
                  terms: ["lipoaspirate", "free lipids", "condensed fat"],
                  numbers: ["three"],
                  source: "Plastic Surgery 5E Ch 22"
                },
                {
                  fact: "Adipose-derived stem cells ADSCs within the stromal vascular fraction SVF possess multipotent differentiation capacity and secrete potent pro-angiogenic cytokines VEGF and FGF.",
                  terms: ["adipose-derived stem cells", "ADSCs", "stromal vascular fraction", "VEGF"],
                  source: "Plastic Surgery 5E Ch 22"
                },
                {
                  fact: "Fat graft survival follows Eto and Yoshimura tri-zonal model consisting of an outer surviving zone under 300 micrometers, an intermediate regenerating zone, and a necrotic central zone.",
                  terms: ["Eto and Yoshimura", "surviving zone", "regenerating zone", "necrotic zone"],
                  numbers: ["300"],
                  source: "Plastic Surgery 5E Ch 22"
                },
                {
                  fact: "Fat parcels must be deposited in multi-planar micro-droplets under 0.1 mL to maximize the recipient surface-to-volume ratio and facilitate vascular ingrowth.",
                  terms: ["micro-droplets", "vascular ingrowth"],
                  numbers: ["0.1"],
                  source: "Plastic Surgery 5E Ch 22"
                },
                {
                  fact: "Long-term volumetric retention of autologous fat grafts typically ranges from 40% to 70%, with graft resorption peaking within the first 3 to 6 months.",
                  terms: ["volumetric retention", "graft resorption"],
                  numbers: ["40%", "70%", "3", "6"],
                  source: "Plastic Surgery 5E Ch 22"
                },
                {
                  fact: "Clinical applications include facial rejuvenation, correction of contour deformities, post-mastectomy radiation fibrosis, and autologous breast augmentation.",
                  terms: ["facial rejuvenation", "radiation fibrosis", "breast augmentation"],
                  source: "Plastic Surgery 5E Ch 22"
                },
                {
                  fact: "Complications of fat grafting include oil cyst formation, microcalcifications that may mimic malignancy on mammography, fat necrosis, and devastating intravascular fat embolism.",
                  terms: ["oil cyst", "microcalcifications", "fat embolism"],
                  source: "Plastic Surgery 5E Ch 22"
                }
              ]
            }
          ]
        },
        {
          id: "spl-local-flaps-geometry",
          name: "Local Flap Geometry and Design",
          topics: [
            {
              id: "spl-local-flaps-geometry",
              title: "Local Flap Geometry: Transposition, Rotation, Z-Plasty and V-Y",
              book: "Plastic Surgery 5E Vol 1 Ch 24 (Flap physiology, classification, and applications)",
              mustKnow: [
                {
                  fact: "Local flaps are classified by their primary movement into transposition, rotation, advancement, and interpolation flaps.",
                  terms: ["transposition", "rotation", "advancement", "interpolation"],
                  source: "Plastic Surgery 5E Ch 24"
                },
                {
                  fact: "A classic 60-degree angle Z-plasty theoretically lengthens the central limb by 75% while rotating the scar axis by 90 degrees.",
                  terms: ["Z-plasty", "central limb", "scar axis"],
                  numbers: ["60", "75%", "90"],
                  source: "Plastic Surgery 5E Ch 24"
                },
                {
                  fact: "A 45-degree angle Z-plasty yields 50% lengthening, whereas a 30-degree angle Z-plasty yields 25% lengthening of the central scar limb.",
                  terms: ["Z-plasty", "lengthening"],
                  numbers: ["45", "50%", "30", "25%"],
                  source: "Plastic Surgery 5E Ch 24"
                },
                {
                  fact: "Limberg rhomboid flap is designed with 60-degree and 120-degree angles, transposing tissue into an equilateral parallelogram defect.",
                  terms: ["Limberg", "rhomboid flap"],
                  numbers: ["60", "120"],
                  source: "Plastic Surgery 5E Ch 24"
                },
                {
                  fact: "Dufourmentel modification of the rhomboid flap bisects the angle between the defect extension line and its side, reducing donor closure tension.",
                  terms: ["Dufourmentel", "rhomboid flap"],
                  source: "Plastic Surgery 5E Ch 24"
                },
                {
                  fact: "Bilobed flap transfers tissue through two consecutive lobes sharing a single pivot point, frequently used for nasal tip and nasal sidewall defects under 1.5 cm.",
                  terms: ["bilobed flap", "nasal tip"],
                  numbers: ["two", "1.5"],
                  source: "Plastic Surgery 5E Ch 24"
                },
                {
                  fact: "V-Y advancement flap advances a triangular skin island linearly along its subcutaneous vascular pedicle, closing the donor trail as a straight Y-stem.",
                  terms: ["V-Y advancement", "subcutaneous pedicle"],
                  source: "Plastic Surgery 5E Ch 24"
                },
                {
                  fact: "Rotation flap moves along an arc of a circle around a pivot point, requiring a perimeter length approximately four to five times defect width.",
                  terms: ["rotation flap", "pivot point"],
                  numbers: ["four", "five"],
                  source: "Plastic Surgery 5E Ch 24"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "spl-sec-burns-trauma",
      name: "Burns, Resuscitation and Complex Trauma Reconstruction",
      modules: [
        {
          id: "spl-burns-hand",
          name: "Burns and Hand Surgery",
          topics: [
            {
              id: "spl-burns-hand",
              title: "Acute Burn Resuscitation, Parkland Formula and Inhalation Injury",
              book: "Plastic Surgery 5E Vol 4 Ch 16 (Acute care and resuscitation of the burn patient)",
              mustKnow: [
                {
                  fact: "Rule of Nines divides total body surface area TBSA into 9% head and neck, 9% each upper limb, 18% anterior trunk, 18% posterior trunk, 18% each lower limb, and 1% perineum.",
                  terms: ["Rule of Nines", "TBSA", "trunk"],
                  numbers: ["9%", "18%", "1%"],
                  source: "Plastic Surgery 5E Vol 4 Ch 16"
                },
                {
                  fact: "Lund and Browder chart adjusts body surface area percentages for pediatric patients to account for proportionally larger head surface area and smaller lower limbs.",
                  terms: ["Lund and Browder", "pediatric patients"],
                  source: "Plastic Surgery 5E Vol 4 Ch 16"
                },
                {
                  fact: "Parkland resuscitation formula prescribes 4 mL of lactated Ringer solution per kg body weight per percent TBSA second and third-degree burn over the first 24 hours.",
                  terms: ["Parkland formula", "lactated Ringer", "TBSA"],
                  numbers: ["4", "24"],
                  source: "Plastic Surgery 5E Vol 4 Ch 16"
                },
                {
                  fact: "Parkland fluid is administered with half of the calculated volume delivered during the first 8 hours post-burn injury and the remaining half over the next 16 hours.",
                  terms: ["first 8 hours", "16 hours"],
                  numbers: ["8", "16"],
                  source: "Plastic Surgery 5E Vol 4 Ch 16"
                },
                {
                  fact: "Target hourly urine output to gauge resuscitation adequacy is 0.5 mL per kg per hour in adults and 1.0 mL per kg per hour in children under 30 kg.",
                  terms: ["urine output", "resuscitation adequacy"],
                  numbers: ["0.5", "1.0", "30"],
                  source: "Plastic Surgery 5E Vol 4 Ch 16"
                },
                {
                  fact: "Jackson burn wound zones comprise the central irreversible zone of coagulation, the surrounding salvageable zone of stasis, and the outer zone of hyperemia.",
                  terms: ["Jackson", "zone of coagulation", "zone of stasis", "zone of hyperemia"],
                  numbers: ["three"],
                  source: "Plastic Surgery 5E Vol 4 Ch 16"
                },
                {
                  fact: "Inhalation injury significantly increases burn mortality and requires early proactive endotracheal intubation when facial burns, soot in sputum, or stridor are present.",
                  terms: ["inhalation injury", "intubation", "stridor"],
                  source: "Plastic Surgery 5E Vol 4 Ch 16"
                },
                {
                  fact: "Carbon monoxide poisoning shifts the oxyhemoglobin dissociation curve to the left and is treated with 100% normobaric or hyperbaric oxygen.",
                  terms: ["carbon monoxide", "oxyhemoglobin", "oxygen"],
                  numbers: ["100%"],
                  source: "Plastic Surgery 5E Vol 4 Ch 16"
                },
                {
                  fact: "Circumferential full-thickness burns of extremities or chest wall require emergency escharotomy within the first 12 hours to prevent compartment syndrome and ventilatory compromise.",
                  terms: ["circumferential burns", "escharotomy", "compartment syndrome"],
                  numbers: ["12"],
                  source: "Plastic Surgery 5E Vol 4 Ch 16"
                }
              ]
            }
          ]
        },
        {
          id: "spl-burn-excision-grafting",
          name: "Burn Wound Excision and Skin Substitutes",
          topics: [
            {
              id: "spl-burn-excision-grafting",
              title: "Tangential Excision, Dermal Matrices and Burn Critical Care",
              book: "Plastic Surgery 5E Vol 4 Ch 17 (Burn wound excision, grafting, and coverage)",
              mustKnow: [
                {
                  fact: "Early tangential excision of deep burns within 48 to 72 hours of injury significantly decreases bacterial translocation, systemic sepsis, and overall mortality.",
                  terms: ["tangential excision", "sepsis", "mortality"],
                  numbers: ["48", "72"],
                  source: "Plastic Surgery 5E Vol 4 Ch 17"
                },
                {
                  fact: "Tangential excision removes sequential thin layers of non-viable eschar with a Watson or Goulian knife until uniform punctate capillary bleeding is reached.",
                  terms: ["tangential excision", "Watson knife", "punctate bleeding"],
                  source: "Plastic Surgery 5E Vol 4 Ch 17"
                },
                {
                  fact: "Topical antimicrobial silver sulfadiazine SSD 1% causes transient leukopenia and delayed eschar separation, and is contraindicated in patients with sulfa allergy.",
                  terms: ["silver sulfadiazine", "leukopenia", "sulfa allergy"],
                  numbers: ["1%"],
                  drugs: ["silver sulfadiazine"],
                  source: "Plastic Surgery 5E Vol 4 Ch 17"
                },
                {
                  fact: "Mafenide acetate 8.5% cream penetrates deeply into thick burn eschar and cartilage but inhibits carbonic anhydrase, causing metabolic acidosis and hyperventilation.",
                  terms: ["mafenide acetate", "carbonic anhydrase", "metabolic acidosis"],
                  numbers: ["8.5%"],
                  drugs: ["mafenide acetate"],
                  source: "Plastic Surgery 5E Vol 4 Ch 17"
                },
                {
                  fact: "Acellular dermal matrix Integra consists of a bovine collagen-chondroitin-6-sulfate dermal replacement layer covered by a temporary protective silicone epidermal sheet.",
                  terms: ["Integra", "collagen", "silicone"],
                  source: "Plastic Surgery 5E Vol 4 Ch 17"
                },
                {
                  fact: "Integra vascularisation requires 14 to 21 days before the silicone layer is peeled and replaced with an ultra-thin split-thickness skin graft.",
                  terms: ["Integra", "split-thickness skin graft"],
                  numbers: ["14", "21"],
                  source: "Plastic Surgery 5E Vol 4 Ch 17"
                },
                {
                  fact: "Cultured epithelial autografts CEA provide expansive coverage in massive burns exceeding 70% TBSA but suffer from fragile anchoring and late mechanical shear blister formation.",
                  terms: ["cultured epithelial autografts", "CEA"],
                  numbers: ["70%"],
                  source: "Plastic Surgery 5E Vol 4 Ch 17"
                },
                {
                  fact: "Burn hypermetabolism drives severe protein catabolism with caloric demands reaching double basal rates, countered by early enteral feeding within 24 hours.",
                  terms: ["hypermetabolism", "enteral feeding"],
                  numbers: ["24"],
                  source: "Plastic Surgery 5E Vol 4 Ch 17"
                }
              ]
            }
          ]
        },
        {
          id: "spl-chemical-electrical-burns",
          name: "Electrical Burns, Chemical Burns and Cold Injury",
          topics: [
            {
              id: "spl-chemical-electrical-burns",
              title: "Electrical Injury, Hydrofluoric Acid and Frostbite Management",
              book: "Plastic Surgery 5E Vol 4 Ch 18 (Electrical, chemical, and cold injuries)",
              mustKnow: [
                {
                  fact: "High-voltage electrical injury is defined as contact exceeding 1000 volts, causing extensive deep muscle necrosis and osseous injury beneath deceptive intact skin.",
                  terms: ["high-voltage", "electrical injury", "muscle necrosis"],
                  numbers: ["1000"],
                  source: "Plastic Surgery 5E Vol 4 Ch 18"
                },
                {
                  fact: "Myoglobinuria from electrical muscle necrosis precipitates in renal tubules, requiring urine output maintenance of 1.5 to 2.0 mL per kg per hour and urine alkalinisation with sodium bicarbonate.",
                  terms: ["myoglobinuria", "sodium bicarbonate", "urine output"],
                  numbers: ["1.5", "2.0"],
                  drugs: ["sodium bicarbonate"],
                  source: "Plastic Surgery 5E Vol 4 Ch 18"
                },
                {
                  fact: "Continuous electrocardiographic monitoring for at least 24 hours is mandatory in high-voltage electrical injuries due to risk of fatal ventricular fibrillation and arrhythmias.",
                  terms: ["electrocardiographic", "ventricular fibrillation"],
                  numbers: ["24"],
                  source: "Plastic Surgery 5E Vol 4 Ch 18"
                },
                {
                  fact: "Chemical burn management mandates immediate copious water irrigation for a minimum of 30 to 60 minutes, avoiding neutralizing agents that generate harmful exothermic reactions.",
                  terms: ["water irrigation", "neutralizing agents"],
                  numbers: ["30", "60"],
                  source: "Plastic Surgery 5E Vol 4 Ch 18"
                },
                {
                  fact: "Hydrofluoric acid burns cause severe liquefactive necrosis and life-threatening hypocalcemia and hypomagnesemia due to fluoride ion chelation.",
                  terms: ["hydrofluoric acid", "hypocalcemia", "fluoride"],
                  source: "Plastic Surgery 5E Vol 4 Ch 18"
                },
                {
                  fact: "Specific treatment for hydrofluoric acid burns is immediate topical 2.5% calcium gluconate gel and subcutaneous or intra-arterial calcium gluconate injection.",
                  terms: ["calcium gluconate", "hydrofluoric acid"],
                  numbers: ["2.5%"],
                  drugs: ["calcium gluconate"],
                  source: "Plastic Surgery 5E Vol 4 Ch 18"
                },
                {
                  fact: "Frostbite management requires rapid rewarming in a circulating water bath maintained at 37 to 42 degrees Celsius for 15 to 30 minutes until distal erythema returns.",
                  terms: ["frostbite", "rewarming", "water bath"],
                  numbers: ["37", "42", "15", "30"],
                  source: "Plastic Surgery 5E Vol 4 Ch 18"
                },
                {
                  fact: "Definitive surgical debridement or amputation for severe frostbite should be delayed for 6 to 12 weeks to allow complete demarcation of viable tissue.",
                  terms: ["frostbite debridement", "demarcation"],
                  numbers: ["6", "12"],
                  source: "Plastic Surgery 5E Vol 4 Ch 18"
                }
              ]
            }
          ]
        },
        {
          id: "spl-lower-extremity-reconstruction",
          name: "Lower Extremity Reconstruction",
          topics: [
            {
              id: "spl-lower-extremity-reconstruction",
              title: "Gustilo Fractures, Lower Extremity Defect Coverage and Free Flaps",
              book: "Plastic Surgery 5E Vol 4 Ch 4 (Reconstruction of the lower extremity)",
              mustKnow: [
                {
                  fact: "Gustilo-Anderson classification grades open tibial fractures into Type I wound under 1 cm, Type II wound 1 to 10 cm without extensive soft tissue damage, and Type III high-energy injury.",
                  terms: ["Gustilo-Anderson", "open tibial fractures"],
                  numbers: ["1", "10"],
                  source: "Plastic Surgery 5E Vol 4 Ch 4"
                },
                {
                  fact: "Gustilo Type IIIA has adequate periosteal coverage, Type IIIB has extensive soft tissue stripping requiring flap coverage, and Type IIIC involves arterial injury requiring vascular repair.",
                  terms: ["Type IIIA", "Type IIIB", "Type IIIC"],
                  source: "Plastic Surgery 5E Vol 4 Ch 4"
                },
                {
                  fact: "Upper third tibial defect coverage is ideally provided by a medial or lateral gastrocnemius muscle rotational flap.",
                  terms: ["upper third tibia", "gastrocnemius"],
                  source: "Plastic Surgery 5E Vol 4 Ch 4"
                },
                {
                  fact: "Middle third tibial defect coverage is classically reconstructed using a soleus muscle transposition flap.",
                  terms: ["middle third tibia", "soleus flap"],
                  source: "Plastic Surgery 5E Vol 4 Ch 4"
                },
                {
                  fact: "Lower third tibial, ankle and heel defects lack reliable local muscle transposition options and generally require microvascular free flap coverage.",
                  terms: ["lower third tibia", "free flap coverage"],
                  source: "Plastic Surgery 5E Vol 4 Ch 4"
                },
                {
                  fact: "Workhorse free flaps for lower extremity reconstruction include the anterolateral thigh ALT flap, gracilis muscle, and latissimus dorsi flap.",
                  terms: ["anterolateral thigh", "gracilis", "latissimus dorsi"],
                  source: "Plastic Surgery 5E Vol 4 Ch 4"
                },
                {
                  fact: "Reverse sural artery neurofasciocutaneous island flap, based on the median superficial sural artery and peroneal perforators 5 cm above lateral malleolus, covers distal third defects.",
                  terms: ["reverse sural flap", "peroneal perforators"],
                  numbers: ["5"],
                  source: "Plastic Surgery 5E Vol 4 Ch 4"
                },
                {
                  fact: "Definitive flap coverage within 72 hours of open tibia fractures Godina principle significantly reduces osteomyelitis rates, nonunion, and flap failure.",
                  terms: ["Godina principle", "osteomyelitis"],
                  numbers: ["72"],
                  source: "Plastic Surgery 5E Vol 4 Ch 4"
                }
              ]
            }
          ]
        },
        {
          id: "spl-chest-abdominal-wall",
          name: "Chest and Abdominal Wall Reconstruction",
          topics: [
            {
              id: "spl-chest-abdominal-wall",
              title: "Sternal Dehiscence, Chest Wall Defects and Component Separation",
              book: "Plastic Surgery 5E Vol 4 Ch 8 (Chest wall reconstruction) & Ch 11 (Abdominal wall reconstruction)",
              mustKnow: [
                {
                  fact: "Median sternotomy wound infections and dehiscence require debridement, antibiotic therapy, and coverage with bilateral pectoralis major turnover or advancement flaps.",
                  terms: ["sternotomy dehiscence", "pectoralis major"],
                  source: "Plastic Surgery 5E Vol 4 Ch 8"
                },
                {
                  fact: "Inferior third sternal defects are reconstructed using a rectus abdominis muscle flap or a greater omentum free or pedicled flap.",
                  terms: ["inferior sternal", "rectus abdominis", "greater omentum"],
                  source: "Plastic Surgery 5E Vol 4 Ch 8"
                },
                {
                  fact: "Full-thickness chest wall resections involving four or more consecutive ribs require skeletal stabilization with titanium mesh or methylmethacrylate sandwich to prevent paradoxical flail chest.",
                  terms: ["chest wall resection", "paradoxical flail chest", "titanium mesh"],
                  numbers: ["four"],
                  source: "Plastic Surgery 5E Vol 4 Ch 8"
                },
                {
                  fact: "Ramirez anterior components separation technique releases the external oblique aponeurosis lateral to the semilunar line, advancing rectus muscle medially by up to 10 cm on each side.",
                  terms: ["Ramirez", "components separation", "external oblique"],
                  numbers: ["10"],
                  source: "Plastic Surgery 5E Vol 4 Ch 11"
                },
                {
                  fact: "Posterior components separation with transversus abdominis release TAR incises the posterior rectus sheath and transversus abdominis muscle, providing extensive preperitoneal space.",
                  terms: ["transversus abdominis release", "TAR", "posterior rectus sheath"],
                  source: "Plastic Surgery 5E Vol 4 Ch 11"
                },
                {
                  fact: "Synthetic polypropylene mesh provides high tensile strength in clean abdominal repairs but is contraindicated in contaminated fields due to high infection and fistula risks.",
                  terms: ["polypropylene mesh", "fistula"],
                  source: "Plastic Surgery 5E Vol 4 Ch 11"
                },
                {
                  fact: "Biologic meshes derived from human or porcine acellular dermal matrix are utilized in contaminated or infected hernia fields to promote neovascularisation and resist infection.",
                  terms: ["biologic meshes", "acellular dermal matrix"],
                  source: "Plastic Surgery 5E Vol 4 Ch 11"
                },
                {
                  fact: "Loss of abdominal domain exceeding 20% to 30% of total peritoneal cavity requires preoperative progressive pneumoperitoneum or botulinum toxin A to prevent abdominal compartment syndrome.",
                  terms: ["loss of domain", "pneumoperitoneum", "botulinum toxin"],
                  numbers: ["20%", "30%"],
                  drugs: ["botulinum toxin"],
                  source: "Plastic Surgery 5E Vol 4 Ch 11"
                }
              ]
            }
          ]
        },
        {
          id: "spl-pressure-ulcers",
          name: "Pressure Ulcers and Wound Reconstruction",
          topics: [
            {
              id: "spl-pressure-ulcers",
              title: "Pressure Injury Staging, Debridement and Flap Reconstruction",
              book: "Plastic Surgery 5E Vol 4 Ch 13 (Pressure sores)",
              mustKnow: [
                {
                  fact: "NPUAP-EPUAP staging classifies Stage 1 as non-blanchable erythema, Stage 2 as partial-thickness skin loss with exposed dermis, and Stage 3 as full-thickness skin loss into subcutaneous fat.",
                  terms: ["NPUAP", "Stage 1", "Stage 2", "Stage 3"],
                  numbers: ["1", "2", "3"],
                  source: "Plastic Surgery 5E Vol 4 Ch 13"
                },
                {
                  fact: "Stage 4 pressure injury features full-thickness skin and tissue loss with directly exposed or palpable fascia, muscle, tendon, ligament, cartilage, or bone.",
                  terms: ["Stage 4", "exposed bone", "fascia"],
                  numbers: ["4"],
                  source: "Plastic Surgery 5E Vol 4 Ch 13"
                },
                {
                  fact: "Unstageable pressure injury is obscured by slough or eschar, while deep tissue pressure injury DTPI presents as persistent non-blanchable deep red, maroon, or purple discoloration.",
                  terms: ["unstageable", "deep tissue pressure injury"],
                  source: "Plastic Surgery 5E Vol 4 Ch 13"
                },
                {
                  fact: "External pressure exceeding normal capillary closing pressure of 32 mmHg causes microvascular occlusion, tissue ischemia, and necrosis within 2 hours.",
                  terms: ["capillary closing pressure", "microvascular occlusion"],
                  numbers: ["32", "2"],
                  source: "Plastic Surgery 5E Vol 4 Ch 13"
                },
                {
                  fact: "Sacral pressure ulcers are most reliably reconstructed using a superior gluteal artery perforator SGAP flap or a gluteus maximus V-Y advancement flap.",
                  terms: ["sacral ulcer", "SGAP flap", "gluteus maximus"],
                  source: "Plastic Surgery 5E Vol 4 Ch 13"
                },
                {
                  fact: "Ischial tuberosity pressure ulcers are reconstructed using an inferior gluteal artery perforator IGAP flap, gluteus maximus rotation, or a hamstring advancement flap.",
                  terms: ["ischial ulcer", "IGAP flap", "hamstring"],
                  source: "Plastic Surgery 5E Vol 4 Ch 13"
                },
                {
                  fact: "Greater trochanteric pressure ulcers are reconstructed using a tensor fasciae latae TFL myofascial rotational or advancement flap.",
                  terms: ["trochanteric ulcer", "tensor fasciae latae", "TFL flap"],
                  source: "Plastic Surgery 5E Vol 4 Ch 13"
                },
                {
                  fact: "Preoperative serum albumin under 3.0 g/dL and hemoglobin under 10 g/dL correlate strongly with postoperative wound dehiscence and recurrent ulceration.",
                  terms: ["serum albumin", "hemoglobin", "dehiscence"],
                  numbers: ["3.0", "10"],
                  source: "Plastic Surgery 5E Vol 4 Ch 13"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "spl-sec-craniofacial",
      name: "Craniofacial, Head and Neck, and Paediatric Plastic Surgery",
      modules: [
        {
          id: "spl-craniofacial-aesthetic",
          name: "Craniofacial and Aesthetic Surgery",
          topics: [
            {
              id: "spl-craniofacial-aesthetic",
              title: "Facial Aesthetic Units and Aesthetic Surgery Principles",
              book: "Plastic Surgery 5E Vol 2 Ch 1 (Principles of facial aesthetic surgery) & Vol 3 Ch 1",
              mustKnow: [
                {
                  fact: "Gonzalez-Ulloa defined facial aesthetic units as forehead, eye and brow, nose, cheek, lip, and chin, advising that scar junctions be hidden along unit boundaries.",
                  terms: ["Gonzalez-Ulloa", "facial aesthetic units", "boundaries"],
                  source: "Plastic Surgery 5E Vol 2 Ch 1"
                },
                {
                  fact: "Relaxed skin tension lines RSTLs run perpendicular to the underlying dynamic mimetic facial muscle contracture vectors.",
                  terms: ["relaxed skin tension lines", "RSTLs", "mimetic muscle"],
                  source: "Plastic Surgery 5E Vol 2 Ch 1"
                },
                {
                  fact: "Facial nerve courses deep to the superficial musculoaponeurotic system SMAS within the cheek and emerges superficial to innervate mimetic muscles from their deep surface.",
                  terms: ["facial nerve", "SMAS", "mimetic muscles"],
                  source: "Plastic Surgery 5E Vol 2 Ch 1"
                },
                {
                  fact: "The only three facial mimetic muscles innervated on their superficial surface are the mentalis, levator anguli oris, and buccinator.",
                  terms: ["mentalis", "levator anguli oris", "buccinator"],
                  numbers: ["three"],
                  source: "Plastic Surgery 5E Vol 2 Ch 1"
                },
                {
                  fact: "Frontal branch of facial nerve crosses the zygomatic arch midway between tragus and lateral canthus Pitanguy line within the temporoparietal fascia.",
                  terms: ["frontal branch", "Pitanguy line", "temporoparietal fascia"],
                  source: "Plastic Surgery 5E Vol 2 Ch 1"
                },
                {
                  fact: "Marginal mandibular nerve runs superficial to facial vessels at the mandibular angle and dips up to 1 to 2 cm below the inferior mandibular border.",
                  terms: ["marginal mandibular nerve", "inferior mandibular border"],
                  numbers: ["1", "2"],
                  source: "Plastic Surgery 5E Vol 2 Ch 1"
                },
                {
                  fact: "Nasal subunits described by Burget and Menick comprise dorsum, tip, columella, paired sidewalls, paired alar lobules, and paired soft tissue triangles.",
                  terms: ["Burget and Menick", "nasal subunits", "columella"],
                  source: "Plastic Surgery 5E Vol 2 Ch 1"
                },
                {
                  fact: "When a nasal defect involves greater than 50% of a subunit, excising the remaining subunit skin and reconstructing the entire unit produces superior aesthetic outcomes.",
                  terms: ["nasal defect", "50% rule"],
                  numbers: ["50%"],
                  source: "Plastic Surgery 5E Vol 2 Ch 1"
                }
              ]
            }
          ]
        },
        {
          id: "spl-cleft-lip",
          name: "Cleft Lip Reconstruction",
          topics: [
            {
              id: "spl-cleft-lip",
              title: "Cleft Lip: Embryology, Millard Rotation-Advancement and Fisher Repairs",
              book: "Plastic Surgery 5E Vol 3 Ch 22 (Cleft lip: principles and primary repair)",
              mustKnow: [
                {
                  fact: "Cleft lip results from failure of fusion between the maxillary prominence and the medial nasal prominence around the 4th to 7th week of embryogenesis.",
                  terms: ["cleft lip", "maxillary prominence", "medial nasal prominence"],
                  numbers: ["4", "7"],
                  source: "Plastic Surgery 5E Vol 3 Ch 22"
                },
                {
                  fact: "The classic Rule of Tens for safe timing of elective cleft lip repair mandates age at least 10 weeks, weight 10 pounds, and hemoglobin 10 g/dL.",
                  terms: ["Rule of Tens", "cleft lip repair", "hemoglobin"],
                  numbers: ["10"],
                  source: "Plastic Surgery 5E Vol 3 Ch 22"
                },
                {
                  fact: "Orbicularis oris muscle in a cleft lip runs abnormally along the cleft margin to insert inappropriately into the anterior nasal spine and alar base.",
                  terms: ["orbicularis oris", "nasal spine", "alar base"],
                  source: "Plastic Surgery 5E Vol 3 Ch 22"
                },
                {
                  fact: "Millard rotation-advancement repair rotates the shortened medial lip downward with a back-cut and advances the lateral lip element into the rotation gap.",
                  terms: ["Millard", "rotation-advancement", "back-cut"],
                  source: "Plastic Surgery 5E Vol 3 Ch 22"
                },
                {
                  fact: "Fisher anatomical subunit repair plans incisions strictly along aesthetic subunit junctions, avoiding the high cross-lip scar of rotation-advancement.",
                  terms: ["Fisher", "anatomical subunit repair"],
                  source: "Plastic Surgery 5E Vol 3 Ch 22"
                },
                {
                  fact: "Bilateral cleft lip repair preserves the prolabium to construct the philtrum central column while repositioning the premaxilla into normal maxillary arch contour.",
                  terms: ["bilateral cleft lip", "prolabium", "premaxilla"],
                  source: "Plastic Surgery 5E Vol 3 Ch 22"
                },
                {
                  fact: "Primary cleft rhinoplasty simultaneously mobilises and repositions the displaced lower lateral alar cartilage to recreate nasal tip symmetry.",
                  terms: ["cleft rhinoplasty", "alar cartilage"],
                  source: "Plastic Surgery 5E Vol 3 Ch 22"
                },
                {
                  fact: "Presurgical infant orthopedics such as nasoalveolar molding NAM realigns alveolar segments and expands columellar height prior to surgical repair.",
                  terms: ["nasoalveolar molding", "NAM"],
                  source: "Plastic Surgery 5E Vol 3 Ch 22"
                }
              ]
            }
          ]
        },
        {
          id: "spl-cleft-palate",
          name: "Cleft Palate and Velopharyngeal Insufficiency",
          topics: [
            {
              id: "spl-cleft-palate",
              title: "Cleft Palate Repair, Furlow Z-Plasty and Velopharyngeal Function",
              book: "Plastic Surgery 5E Vol 3 Ch 23 (Cleft palate repair and velopharyngeal dysfunction)",
              mustKnow: [
                {
                  fact: "Cleft palate results from failure of fusion of the secondary palatal shelves derived from maxillary prominences between the 8th and 12th weeks of gestation.",
                  terms: ["secondary palatal shelves", "gestation"],
                  numbers: ["8", "12"],
                  source: "Plastic Surgery 5E Vol 3 Ch 23"
                },
                {
                  fact: "Optimal timing for cleft palate repair is between 9 and 12 months of age, balancing speech development needs against potential maxillary growth restriction.",
                  terms: ["cleft palate repair", "speech development"],
                  numbers: ["9", "12"],
                  source: "Plastic Surgery 5E Vol 3 Ch 23"
                },
                {
                  fact: "Abnormal insertion of the levator veli palatini muscle into the posterior border of the hard palate cleft margin Laimer muscle must be dissected and retropositioned into a transverse muscular sling.",
                  terms: ["levator veli palatini", "muscular sling"],
                  source: "Plastic Surgery 5E Vol 3 Ch 23"
                },
                {
                  fact: "Furlow double-reversing Z-plasty transposes opposing mucoperiosteal and myomucosal flaps across oral and nasal layers, retropositioning levator muscle and lengthening the soft palate.",
                  terms: ["Furlow", "double-reversing Z-plasty", "myomucosal flaps"],
                  source: "Plastic Surgery 5E Vol 3 Ch 23"
                },
                {
                  fact: "Two-flap palatoplasty Bardach provides complete tension-free oral closure by mobilizing bilateral mucoperiosteal flaps based on greater palatine arteries.",
                  terms: ["two-flap palatoplasty", "Bardach", "greater palatine artery"],
                  numbers: ["two"],
                  source: "Plastic Surgery 5E Vol 3 Ch 23"
                },
                {
                  fact: "Velopharyngeal insufficiency VPI presents with hypernasality, nasal air emission, and compensatory articulation errors, diagnosed via video nasoendoscopy.",
                  terms: ["velopharyngeal insufficiency", "VPI", "hypernasality"],
                  source: "Plastic Surgery 5E Vol 3 Ch 23"
                },
                {
                  fact: "Surgical management of VPI includes superiorly based posterior pharyngeal flap for coronal closure patterns, or sphincter pharyngoplasty for sagittal closure patterns.",
                  terms: ["pharyngeal flap", "sphincter pharyngoplasty"],
                  source: "Plastic Surgery 5E Vol 3 Ch 23"
                },
                {
                  fact: "Submucous cleft palate is defined by the classic Calnan triad: bifid uvula, palpable posterior hard palate notch, and central muscular diastasis zona pellucida.",
                  terms: ["submucous cleft palate", "Calnan triad", "bifid uvula"],
                  source: "Plastic Surgery 5E Vol 3 Ch 23"
                }
              ]
            }
          ]
        },
        {
          id: "spl-craniosynostosis",
          name: "Craniosynostosis and Craniofacial Syndromes",
          topics: [
            {
              id: "spl-craniosynostosis",
              title: "Craniosynostosis: Vault Deformities and Syndromic Management",
              book: "Plastic Surgery 5E Vol 3 Ch 26 (Craniosynostosis)",
              mustKnow: [
                {
                  fact: "Craniosynostosis is premature pathological fusion of one or more cranial sutures, causing skull deformation according to Virchow law perpendicular growth restriction.",
                  terms: ["craniosynostosis", "Virchow law", "cranial sutures"],
                  source: "Plastic Surgery 5E Vol 3 Ch 26"
                },
                {
                  fact: "Sagittal synostosis is the most common single suture synostosis over 50% of cases, producing a long, narrow scaphocephalic or dolichocephalic skull.",
                  terms: ["sagittal synostosis", "scaphocephaly", "dolichocephaly"],
                  numbers: ["50%"],
                  source: "Plastic Surgery 5E Vol 3 Ch 26"
                },
                {
                  fact: "Unilateral coronal synostosis causes anterior plagiocephaly, featuring ipsilateral forehead flattening, elevated eyebrow, and harlequin eye appearance on plain radiograph.",
                  terms: ["anterior plagiocephaly", "coronal synostosis", "harlequin eye"],
                  source: "Plastic Surgery 5E Vol 3 Ch 26"
                },
                {
                  fact: "Metopic synostosis causes trigonocephaly with a prominent midline triangular forehead ridge, hypotelorism, and bitemporal narrowing.",
                  terms: ["metopic synostosis", "trigonocephaly", "hypotelorism"],
                  source: "Plastic Surgery 5E Vol 3 Ch 26"
                },
                {
                  fact: "Crouzon syndrome is caused by mutations in FGFR2, manifesting bicoronal synostosis, severe midface hypoplasia, shallow orbits with ocular proptosis, but normal hands.",
                  terms: ["Crouzon syndrome", "FGFR2", "proptosis"],
                  source: "Plastic Surgery 5E Vol 3 Ch 26"
                },
                {
                  fact: "Apert syndrome FGFR2 Ser252Trp/Pro253Arg features bicoronal synostosis, midface retrusion, cleft palate, and complex symmetrical osseous syndactyly mitten hands and feet.",
                  terms: ["Apert syndrome", "syndactyly", "mitten hands"],
                  source: "Plastic Surgery 5E Vol 3 Ch 26"
                },
                {
                  fact: "Pfeiffer syndrome FGFR1 or FGFR2 features craniosynostosis, midface hypoplasia, broad thumbs, and broad great toes.",
                  terms: ["Pfeiffer syndrome", "broad thumbs", "great toes"],
                  source: "Plastic Surgery 5E Vol 3 Ch 26"
                },
                {
                  fact: "Surgical cranial vault remodeling or endoscopic suturectomy with helmet therapy is ideally performed between 3 and 9 months of age to prevent elevated intracranial pressure.",
                  terms: ["cranial vault remodeling", "endoscopic suturectomy", "intracranial pressure"],
                  numbers: ["3", "9"],
                  source: "Plastic Surgery 5E Vol 3 Ch 26"
                }
              ]
            }
          ]
        },
        {
          id: "spl-mandible-fractures",
          name: "Mandibular Fractures and Fixation",
          topics: [
            {
              id: "spl-mandible-fractures",
              title: "Mandibular Fractures: Champy Principles, Occlusion and Fixation",
              book: "Plastic Surgery 5E Vol 3 Ch 12 (Mandible fractures)",
              mustKnow: [
                {
                  fact: "Mandible fractures are anatomically classified into condyle 30%, angle 25%, body 20%, symphysis and parasymphysis 15%, ramus 3%, and coronoid 2%.",
                  terms: ["mandible fractures", "condyle", "symphysis"],
                  numbers: ["30%", "25%", "20%", "15%", "3%", "2%"],
                  source: "Plastic Surgery 5E Vol 3 Ch 12"
                },
                {
                  fact: "Restoration of pre-traumatic dental occlusion is the cardinal goal of mandible fracture treatment, established intraoperatively via maxillomandibular fixation MMF.",
                  terms: ["dental occlusion", "maxillomandibular fixation", "MMF"],
                  source: "Plastic Surgery 5E Vol 3 Ch 12"
                },
                {
                  fact: "Champy lines of ideal osteosynthesis demonstrate that tensile forces concentrate along the superior border of the mandible while compressive forces concentrate along the inferior border.",
                  terms: ["Champy lines", "osteosynthesis", "tensile forces", "compressive forces"],
                  source: "Plastic Surgery 5E Vol 3 Ch 12"
                },
                {
                  fact: "In mandibular angle fractures, a single non-compression monocortical 2.0 mm miniplate placed on the superior border external oblique ridge per Champy technique provides reliable stabilization.",
                  terms: ["mandibular angle", "Champy technique", "miniplate"],
                  numbers: ["2.0"],
                  source: "Plastic Surgery 5E Vol 3 Ch 12"
                },
                {
                  fact: "Parasymphysis and symphysis fractures experience high torsional torque and require two miniplates: a superior tension band plate and an inferior monocortical or bicortical plate.",
                  terms: ["parasymphysis", "torsional torque", "tension band"],
                  numbers: ["two"],
                  source: "Plastic Surgery 5E Vol 3 Ch 12"
                },
                {
                  fact: "Favorable angle fractures resist displacement due to masseter and medial pterygoid muscle vectors pulling the distal segment into reduction, whereas unfavorable fractures displace widely.",
                  terms: ["favorable fractures", "unfavorable fractures", "masseter"],
                  source: "Plastic Surgery 5E Vol 3 Ch 12"
                },
                {
                  fact: "Absolute indications for open reduction of condylar fractures include displacement into the middle cranial fossa, impossibility of obtaining occlusion, and lateral extracapsular displacement.",
                  terms: ["condylar fractures", "open reduction", "middle cranial fossa"],
                  source: "Plastic Surgery 5E Vol 3 Ch 12"
                },
                {
                  fact: "Mental nerve sensation paresthesia or hypesthesia occurs commonly in body fractures traversing the mental foramen between premolars.",
                  terms: ["mental nerve", "paresthesia", "mental foramen"],
                  source: "Plastic Surgery 5E Vol 3 Ch 12"
                }
              ]
            }
          ]
        },
        {
          id: "spl-midface-zygoma-fractures",
          name: "Midface and Zygomatic Fractures",
          topics: [
            {
              id: "spl-midface-zygoma-fractures",
              title: "Maxillary Le Fort and Zygomaticomaxillary Complex Fractures",
              book: "Plastic Surgery 5E Vol 3 Ch 13 (Maxillofacial trauma: midface and zygoma fractures)",
              mustKnow: [
                {
                  fact: "Le Fort I fracture Guerin transverse maxillary fracture separates the alveolar process and palate from the midface skeleton above the dental roots.",
                  terms: ["Le Fort I", "alveolar process", "dental roots"],
                  source: "Plastic Surgery 5E Vol 3 Ch 13"
                },
                {
                  fact: "Le Fort II pyramidal fracture traverses nasal bones, frontal process of maxilla, lacrimal bones, orbital floor, and zygomaticomaxillary suture.",
                  terms: ["Le Fort II", "pyramidal fracture", "orbital floor"],
                  source: "Plastic Surgery 5E Vol 3 Ch 13"
                },
                {
                  fact: "Le Fort III craniofacial dysjunction separates the entire facial skeleton from the cranial base, traversing frontonasal, frontomaxillary, and frontozygomatic sutures, and zygomatic arches.",
                  terms: ["Le Fort III", "craniofacial dysjunction", "cranial base"],
                  source: "Plastic Surgery 5E Vol 3 Ch 13"
                },
                {
                  fact: "Pterygoid plate fracture is pathognomonic and uniformly present in all three classic Le Fort fracture patterns.",
                  terms: ["pterygoid plate", "pathognomonic"],
                  numbers: ["three"],
                  source: "Plastic Surgery 5E Vol 3 Ch 13"
                },
                {
                  fact: "Zygomaticomaxillary complex ZMC tetrapod fracture disrupts four articulations: frontozygomatic suture, inferior orbital rim, zygomaticomaxillary buttress, and zygomatic arch.",
                  terms: ["ZMC fracture", "tetrapod", "frontozygomatic"],
                  numbers: ["four"],
                  source: "Plastic Surgery 5E Vol 3 Ch 13"
                },
                {
                  fact: "Classic clinical triad of ZMC fractures includes malar flattening, trismus due to impingement on the coronoid process, and infraorbital nerve numbness.",
                  terms: ["malar flattening", "trismus", "infraorbital nerve"],
                  numbers: ["three"],
                  source: "Plastic Surgery 5E Vol 3 Ch 13"
                },
                {
                  fact: "Gilles approach reduces isolated zygomatic arch fractures through a temporal hairline incision deep to deep temporal fascia.",
                  terms: ["Gilles approach", "zygomatic arch", "temporal fascia"],
                  source: "Plastic Surgery 5E Vol 3 Ch 13"
                },
                {
                  fact: "Fixation of ZMC fractures prioritises the frontozygomatic suture and the zygomaticomaxillary buttress with low-profile titanium miniplates.",
                  terms: ["frontozygomatic", "zygomaticomaxillary buttress", "titanium miniplates"],
                  source: "Plastic Surgery 5E Vol 3 Ch 13"
                }
              ]
            }
          ]
        },
        {
          id: "spl-nasoethmoid-orbital-fractures",
          name: "Nasoorbitoethmoid and Orbital Fractures",
          topics: [
            {
              id: "spl-nasoethmoid-orbital-fractures",
              title: "Nasoorbitoethmoid Complex and Orbital Blowout Fractures",
              book: "Plastic Surgery 5E Vol 3 Ch 14 (Orbital and nasoethmoid fractures)",
              mustKnow: [
                {
                  fact: "Nasoorbitoethmoid NOE fractures involve the central tendon-bearing bone fragment holding the medial canthal tendon MCT.",
                  terms: ["NOE fractures", "medial canthal tendon", "MCT"],
                  source: "Plastic Surgery 5E Vol 3 Ch 14"
                },
                {
                  fact: "Markowitz and Manson classify NOE fractures into Type I single large central fragment, Type II comminuted central fragment with intact MCT insertion, and Type III severe comminution with MCT avulsion.",
                  terms: ["Markowitz and Manson", "Type I", "Type II", "Type III"],
                  numbers: ["I", "II", "III"],
                  source: "Plastic Surgery 5E Vol 3 Ch 14"
                },
                {
                  fact: "Clinical hallmarks of NOE fractures include traumatic telecanthus intercanthal distance over 35 mm, saddle nose deformity, and CSF rhinorrhoea.",
                  terms: ["telecanthus", "intercanthal distance", "saddle nose", "CSF rhinorrhoea"],
                  numbers: ["35"],
                  source: "Plastic Surgery 5E Vol 3 Ch 14"
                },
                {
                  fact: "Orbital blowout fracture most commonly involves the thin posteromedial orbital floor and lamina papyracea of the ethmoid bone.",
                  terms: ["orbital blowout", "orbital floor", "lamina papyracea"],
                  source: "Plastic Surgery 5E Vol 3 Ch 14"
                },
                {
                  fact: "Entrapment of the inferior rectus or inferior oblique muscle causes vertical diplopia on upward gaze and a positive forced duction test.",
                  terms: ["inferior rectus", "diplopia", "forced duction test"],
                  source: "Plastic Surgery 5E Vol 3 Ch 14"
                },
                {
                  fact: "White-eyed blowout fracture in pediatric patients is a surgical emergency where entrapped muscle triggers the oculocardiac reflex causing life-threatening bradycardia, nausea, and syncope.",
                  terms: ["white-eyed blowout", "oculocardiac reflex", "bradycardia"],
                  source: "Plastic Surgery 5E Vol 3 Ch 14"
                },
                {
                  fact: "Indications for surgical orbital floor repair within 2 weeks include persistent diplopia with positive forced duction, enophthalmos exceeding 2 mm, or floor defect exceeding 50% of the orbital floor.",
                  terms: ["enophthalmos", "diplopia", "orbital floor repair"],
                  numbers: ["2", "50%"],
                  source: "Plastic Surgery 5E Vol 3 Ch 14"
                },
                {
                  fact: "Orbital floor reconstruction utilizes autologous bone/cartilage grafts or porous polyethylene Medpor / titanium sheets via transconjunctival or subciliary approaches.",
                  terms: ["transconjunctival", "porous polyethylene", "Medpor"],
                  source: "Plastic Surgery 5E Vol 3 Ch 14"
                }
              ]
            }
          ]
        },
        {
          id: "spl-orthognathic-surgery",
          name: "Orthognathic Surgery Principles",
          topics: [
            {
              id: "spl-orthognathic-surgery",
              title: "Orthognathic Surgery: Le Fort Osteotomy, BSSO and Cephalometrics",
              book: "Plastic Surgery 5E Vol 3 Ch 29 (Orthognathic surgery)",
              mustKnow: [
                {
                  fact: "Angle classification of malocclusion defines Class I normal molar relationship, Class II retrognathic mandible overjet, and Class III prognathic mandible underbite.",
                  terms: ["Angle classification", "Class I", "Class II", "Class III"],
                  numbers: ["I", "II", "III"],
                  source: "Plastic Surgery 5E Vol 3 Ch 29"
                },
                {
                  fact: "Bilateral sagittal split osteotomy BSSO splits the mandibular ramus sagitally, allowing controlled advancement or setback of the dentate mandible while maintaining condylar position.",
                  terms: ["BSSO", "mandibular ramus", "condylar position"],
                  numbers: ["two"],
                  source: "Plastic Surgery 5E Vol 3 Ch 29"
                },
                {
                  fact: "Inferior alveolar nerve IAN injury paresthesia is the most common sensory complication of BSSO, occurring in 10% to 30% of cases at one year.",
                  terms: ["inferior alveolar nerve", "IAN", "paresthesia"],
                  numbers: ["10%", "30%"],
                  source: "Plastic Surgery 5E Vol 3 Ch 29"
                },
                {
                  fact: "Le Fort I maxillary osteotomy mobilises the maxilla on a palatal soft tissue pedicle, enabling three-dimensional repositioning for vertical maxillary excess or hypoplasia.",
                  terms: ["Le Fort I osteotomy", "maxillary repositioning"],
                  numbers: ["I"],
                  source: "Plastic Surgery 5E Vol 3 Ch 29"
                },
                {
                  fact: "Distraction osteogenesis Ilizarov principle generates new bone via mechanical tensile strain across a corticotomy gap following a 5 to 7 day latency period.",
                  terms: ["distraction osteogenesis", "Ilizarov", "corticotomy"],
                  numbers: ["5", "7"],
                  source: "Plastic Surgery 5E Vol 3 Ch 29"
                },
                {
                  fact: "Standard distraction rate is 1.0 mm per day delivered in two to four increments 0.25 mm four times daily to optimize bone and soft tissue regeneration.",
                  terms: ["distraction rate", "increments"],
                  numbers: ["1.0", "0.25", "four"],
                  source: "Plastic Surgery 5E Vol 3 Ch 29"
                },
                {
                  fact: "Consolidation phase in distraction osteogenesis requires a minimum of 6 to 8 weeks or double the distraction time before device removal.",
                  terms: ["consolidation phase", "device removal"],
                  numbers: ["6", "8"],
                  source: "Plastic Surgery 5E Vol 3 Ch 29"
                },
                {
                  fact: "Genioplasty osteotomy of the mandibular symphysis alters chin projection in sagittal, vertical, and transverse planes without disturbing dental occlusion.",
                  terms: ["genioplasty", "chin projection", "symphysis"],
                  source: "Plastic Surgery 5E Vol 3 Ch 29"
                }
              ]
            }
          ]
        },
        {
          id: "spl-microtia-ear-reconstruction",
          name: "Microtia and External Ear Reconstruction",
          topics: [
            {
              id: "spl-microtia-ear-reconstruction",
              title: "Microtia: Brent and Nagata Autologous Costal Cartilage Reconstruction",
              book: "Plastic Surgery 5E Vol 3 Ch 25 (Auricular reconstruction: microtia and acquired deformities)",
              mustKnow: [
                {
                  fact: "Microtia is classified into Grade I mild dysmorphic pinna, Grade II partial development with stenotic canal, Grade III classic peanut ear, and Grade IV anotia complete absence.",
                  terms: ["microtia", "Grade I", "Grade II", "Grade III", "Grade IV"],
                  numbers: ["I", "II", "III", "IV"],
                  source: "Plastic Surgery 5E Vol 3 Ch 25"
                },
                {
                  fact: "Timing of autologous costal cartilage ear reconstruction is delayed until 6 to 10 years of age when chest circumference exceeds 60 cm to ensure sufficient cartilage volume.",
                  terms: ["costal cartilage", "ear reconstruction"],
                  numbers: ["6", "10", "60"],
                  source: "Plastic Surgery 5E Vol 3 Ch 25"
                },
                {
                  fact: "Brent technique reconstructs the auricle in four stages: cartilage framework fabrication, lobule transposition, framework elevation with skin graft, and tragus/concha creation.",
                  terms: ["Brent technique", "four stages", "framework"],
                  numbers: ["four"],
                  source: "Plastic Surgery 5E Vol 3 Ch 25"
                },
                {
                  fact: "Nagata technique compresses ear reconstruction into two stages: stage 1 framework fabrication including tragus and lobule transposition, and stage 2 framework elevation with temporoparietal fascia flap.",
                  terms: ["Nagata technique", "two stages", "temporoparietal fascia"],
                  numbers: ["two", "1", "2"],
                  source: "Plastic Surgery 5E Vol 3 Ch 25"
                },
                {
                  fact: "Cartilage framework is carved from ipsilateral synchondrosis of the 6th, 7th, and 8th costal cartilages, with the 8th cartilage forming the helical rim.",
                  terms: ["synchondrosis", "helical rim"],
                  numbers: ["6th", "7th", "8th"],
                  source: "Plastic Surgery 5E Vol 3 Ch 25"
                },
                {
                  fact: "Alloplastic porous polyethylene Medpor framework provides a one-stage alternative avoiding donor cartilage harvest but carries a lifelong risk of framework extrusion.",
                  terms: ["porous polyethylene", "Medpor", "framework extrusion"],
                  numbers: ["one"],
                  source: "Plastic Surgery 5E Vol 3 Ch 25"
                },
                {
                  fact: "Prominent ear deformity otoplasty corrects antihelical fold absence via Mustarde mattress cartilage sutures, and conchal hypertrophy via Furnas concho-mastoid sutures.",
                  terms: ["otoplasty", "Mustarde", "Furnas"],
                  source: "Plastic Surgery 5E Vol 3 Ch 25"
                },
                {
                  fact: "Normal auricle measures 5.5 to 6.5 cm in length, tilted posterior to the vertical axis by approximately 15 to 20 degrees, projecting 1.5 to 2.0 cm from the mastoid.",
                  terms: ["auricle dimensions", "auricular projection"],
                  numbers: ["5.5", "6.5", "15", "20", "1.5", "2.0"],
                  source: "Plastic Surgery 5E Vol 3 Ch 25"
                }
              ]
            }
          ]
        },
        {
          id: "spl-facial-palsy-reanimation",
          name: "Facial Nerve Palsy and Dynamic Reanimation",
          topics: [
            {
              id: "spl-facial-palsy-reanimation",
              title: "Facial Palsy: House-Brackmann, Nerve Transfers and Gracilis Muscle",
              book: "Plastic Surgery 5E Vol 3 Ch 17 (Facial paralysis and reanimation)",
              mustKnow: [
                {
                  fact: "House-Brackmann grading system evaluates facial nerve function from Grade I normal symmetry to Grade VI total paralysis without tone.",
                  terms: ["House-Brackmann", "Grade I", "Grade VI"],
                  numbers: ["I", "VI"],
                  source: "Plastic Surgery 5E Vol 3 Ch 17"
                },
                {
                  fact: "Corneal protection in lagophthalmos is the paramount immediate clinical priority, managed with lubricating drops, moisture chambers, and upper eyelid platinum or gold weight implantation.",
                  terms: ["lagophthalmos", "corneal protection", "gold weight"],
                  source: "Plastic Surgery 5E Vol 3 Ch 17"
                },
                {
                  fact: "Acute facial nerve transection within 72 hours is treated by primary direct epineurial end-to-end suture or sural / great auricular nerve cable grafting.",
                  terms: ["facial nerve transection", "cable grafting", "sural nerve"],
                  numbers: ["72"],
                  source: "Plastic Surgery 5E Vol 3 Ch 17"
                },
                {
                  fact: "When facial mimetic muscles remain viable under 18 to 24 months, masseteric nerve motor nerve to masseter V3 or hypoglossal nerve XII transfers restore strong voluntary smile.",
                  terms: ["masseteric nerve", "hypoglossal nerve", "mimetic muscles"],
                  numbers: ["18", "24"],
                  source: "Plastic Surgery 5E Vol 3 Ch 17"
                },
                {
                  fact: "Irreversible muscle atrophy beyond 2 years requires functional free muscle transfer, with microvascular gracilis muscle transfer representing the global gold standard.",
                  terms: ["muscle atrophy", "gracilis muscle", "free muscle transfer"],
                  numbers: ["2"],
                  source: "Plastic Surgery 5E Vol 3 Ch 17"
                },
                {
                  fact: "Cross-face nerve graft CFNG using sural nerve coapted to contralateral healthy buccal branches provides spontaneous emotional smile, requiring 9 to 12 months for axonal crossing.",
                  terms: ["cross-face nerve graft", "CFNG", "spontaneous smile"],
                  numbers: ["9", "12"],
                  source: "Plastic Surgery 5E Vol 3 Ch 17"
                },
                {
                  fact: "Dual-innervation gracilis transfer combines masseteric nerve for immediate bite-induced power and CFNG for long-term emotional spontaneity.",
                  terms: ["dual-innervation", "gracilis", "masseteric nerve"],
                  numbers: ["two"],
                  source: "Plastic Surgery 5E Vol 3 Ch 17"
                },
                {
                  fact: "Static reanimation techniques include fascia lata or acellular dermal matrix slings to suspend oral commissure and nasal alar collapse.",
                  terms: ["static reanimation", "fascia lata sling", "oral commissure"],
                  source: "Plastic Surgery 5E Vol 3 Ch 17"
                }
              ]
            }
          ]
        },
        {
          id: "spl-head-neck-flaps",
          name: "Head and Neck Defect Reconstruction",
          topics: [
            {
              id: "spl-head-neck-flaps",
              title: "Head and Neck Oncology Defect Coverage: Fibula, Radial Forearm and ALT",
              book: "Plastic Surgery 5E Vol 3 Ch 33 (Head and neck reconstruction)",
              mustKnow: [
                {
                  fact: "Free vascularised fibula osteocutaneous flap based on the peroneal artery and veins is the primary workhorse for segmental mandibular and maxillary reconstructions.",
                  terms: ["fibula", "osteocutaneous flap", "peroneal artery"],
                  source: "Plastic Surgery 5E Vol 3 Ch 33"
                },
                {
                  fact: "Fibula flap provides up to 25 to 30 cm of straight bicortical bone, can undergo multiple closing wedge osteotomies, and accepts osseointegrated dental implants.",
                  terms: ["bicortical bone", "osseointegrated implants"],
                  numbers: ["25", "30"],
                  source: "Plastic Surgery 5E Vol 3 Ch 33"
                },
                {
                  fact: "Distal 6 to 8 cm and proximal 6 to 8 cm of fibula must be preserved during harvest to safeguard lateral ankle stability and common peroneal nerve function.",
                  terms: ["fibula harvest", "ankle stability", "common peroneal nerve"],
                  numbers: ["6", "8"],
                  source: "Plastic Surgery 5E Vol 3 Ch 33"
                },
                {
                  fact: "Radial forearm free flap RFFF based on radial artery and cephalic vein provides pliable thin skin ideal for oral cavity tongue and floor of mouth reconstruction.",
                  terms: ["radial forearm", "RFFF", "oral cavity"],
                  source: "Plastic Surgery 5E Vol 3 Ch 33"
                },
                {
                  fact: "Mandatory pre-operative Allen test confirms palmar arch patency and adequate ulnar collateral circulation prior to radial forearm flap elevation.",
                  terms: ["Allen test", "ulnar circulation"],
                  source: "Plastic Surgery 5E Vol 3 Ch 33"
                },
                {
                  fact: "Anterolateral thigh ALT free flap provides versatile soft tissue and skin for complex head and neck defects with negligible donor site functional morbidity.",
                  terms: ["anterolateral thigh", "ALT", "soft tissue"],
                  source: "Plastic Surgery 5E Vol 3 Ch 33"
                },
                {
                  fact: "Pectoralis major myocutaneous flap PMMC based on the pectoral branch of the thoracoacromial artery serves as the reliable regional salvage workhorse flap.",
                  terms: ["pectoralis major", "PMMC", "thoracoacromial artery"],
                  source: "Plastic Surgery 5E Vol 3 Ch 33"
                },
                {
                  fact: "Pharyngoesophageal circumferencial defects are reconstructed with a free jejunal transfer or tubed anterolateral thigh / radial forearm cutaneous flaps.",
                  terms: ["pharyngoesophageal", "jejunal transfer"],
                  source: "Plastic Surgery 5E Vol 3 Ch 33"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "spl-sec-hand",
      name: "Hand, Wrist and Peripheral Nerve Surgery",
      modules: [
        {
          id: "spl-flexor-tendon-injuries",
          name: "Flexor Tendon Injuries and Repair",
          topics: [
            {
              id: "spl-flexor-tendon-injuries",
              title: "Flexor Tendon Zones, Pulley System, Repair and Rehabilitation",
              book: "Plastic Surgery 5E Vol 6 Ch 7 (Flexor tendon injury and repair)",
              mustKnow: [
                {
                  fact: "Flexor tendon system in the hand is divided into five anatomical zones: Zone I distal to FDS insertion, Zone II from A1 pulley to FDS insertion Bunnell no mans land, Zone III palm, Zone IV carpal tunnel, and Zone V forearm.",
                  terms: ["flexor tendon", "five zones", "Zone II", "no mans land"],
                  numbers: ["five", "I", "II", "III", "IV", "V"],
                  source: "Plastic Surgery 5E Vol 6 Ch 7"
                },
                {
                  fact: "Digital annular pulley system consists of five annular pulleys A1 to A5 and three cruciform pulleys C1 to C3, with A2 and A4 pulleys essential to prevent bowstringing.",
                  terms: ["annular pulley", "A2 pulley", "A4 pulley", "bowstringing"],
                  numbers: ["five", "three"],
                  source: "Plastic Surgery 5E Vol 6 Ch 7"
                },
                {
                  fact: "Tendon nutrition is mediated by both direct vascular perfusion via longitudinal vincula brevia and longa and passive synovial fluid diffusion.",
                  terms: ["vincula", "synovial fluid diffusion"],
                  source: "Plastic Surgery 5E Vol 6 Ch 7"
                },
                {
                  fact: "Modern core flexor tendon suture techniques employ 4-strand or 6-strand core repairs e.g., modified Kessler, cruciate, or Strickland with 3-0 or 4-0 braided or monofilament suture.",
                  terms: ["4-strand", "6-strand", "modified Kessler", "Strickland"],
                  numbers: ["4", "6", "3-0", "4-0"],
                  source: "Plastic Surgery 5E Vol 6 Ch 7"
                },
                {
                  fact: "Core tendon suture must be paired with a continuous running epitendinous suture 5-0 or 6-0 to smooth tendon gliding and increase repair tensile strength by 20% to 50%.",
                  terms: ["epitendinous suture", "gliding"],
                  numbers: ["5-0", "6-0", "20%", "50%"],
                  source: "Plastic Surgery 5E Vol 6 Ch 7"
                },
                {
                  fact: "Early active motion protocols such as Manchester or Saint John protocols initiated within 3 to 5 days post-repair prevent restrictive peritendinous adhesion formation.",
                  terms: ["early active motion", "peritendinous adhesion"],
                  numbers: ["3", "5"],
                  source: "Plastic Surgery 5E Vol 6 Ch 7"
                },
                {
                  fact: "Jersey finger is avulsion of the flexor digitorum profundus FDP tendon from the distal phalanx base, most commonly affecting the ring finger 75% of cases.",
                  terms: ["Jersey finger", "flexor digitorum profundus", "ring finger"],
                  numbers: ["75%"],
                  source: "Plastic Surgery 5E Vol 6 Ch 7"
                },
                {
                  fact: "Leddy and Pack classification grades Jersey finger into Type I retraction into palm with disrupted vincula, Type II retraction to PIP joint, and Type III bony avulsion trapped at A4.",
                  terms: ["Leddy and Pack", "Type I", "Type II", "Type III"],
                  numbers: ["I", "II", "III"],
                  source: "Plastic Surgery 5E Vol 6 Ch 7"
                }
              ]
            }
          ]
        },
        {
          id: "spl-extensor-tendon-injuries",
          name: "Extensor Tendon Injuries and Deformities",
          topics: [
            {
              id: "spl-extensor-tendon-injuries",
              title: "Extensor Tendon Zones, Mallet Finger, Boutonniere and Swan-Neck",
              book: "Plastic Surgery 5E Vol 6 Ch 8 (Extensor tendon injury and repair)",
              mustKnow: [
                {
                  fact: "Extensor tendons are divided into nine anatomical zones: Zone I DIP joint, Zone II middle phalanx, Zone III PIP joint, Zone IV proximal phalanx, Zone V MCP joint, Zone VI metacarpal dorsum, Zone VII carpal retinaculum, Zone VIII distal forearm, and Zone IX muscle belly.",
                  terms: ["extensor tendons", "nine zones", "DIP joint", "PIP joint"],
                  numbers: ["nine", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"],
                  source: "Plastic Surgery 5E Vol 6 Ch 8"
                },
                {
                  fact: "Zone I injury causes mallet finger extensor tendon rupture or bony avulsion from the distal phalanx base, resulting in involuntary DIP joint flexion.",
                  terms: ["mallet finger", "DIP joint flexion"],
                  numbers: ["I"],
                  source: "Plastic Surgery 5E Vol 6 Ch 8"
                },
                {
                  fact: "Closed mallet finger is managed non-operatively with continuous uninterrupted DIP joint extension splinting for 6 to 8 weeks, followed by 4 weeks of night splinting.",
                  terms: ["extension splinting", "DIP joint"],
                  numbers: ["6", "8", "4"],
                  source: "Plastic Surgery 5E Vol 6 Ch 8"
                },
                {
                  fact: "Zone III central slip rupture leads to boutonniere deformity, characterized by PIP joint flexion with compensatory DIP joint hyperextension due to volar lateral band subluxation.",
                  terms: ["central slip", "boutonniere deformity", "PIP flexion", "DIP hyperextension"],
                  numbers: ["III"],
                  source: "Plastic Surgery 5E Vol 6 Ch 8"
                },
                {
                  fact: "Elson test assesses central slip integrity by flexing the PIP joint 90 degrees over a table edge; weak PIP extension and rigid DIP extension confirms central slip rupture.",
                  terms: ["Elson test", "central slip integrity"],
                  numbers: ["90"],
                  source: "Plastic Surgery 5E Vol 6 Ch 8"
                },
                {
                  fact: "Swan-neck deformity features PIP joint hyperextension and DIP joint flexion, caused by lateral band dorsal subluxation, volar plate laxity, or terminal extensor rupture.",
                  terms: ["swan-neck deformity", "PIP hyperextension", "DIP flexion"],
                  source: "Plastic Surgery 5E Vol 6 Ch 8"
                },
                {
                  fact: "Zone V sagittal band rupture classically affects the middle finger extensor digitorum communis EDC tendon, causing extensor subluxation into the ulnar intermetacarpal groove.",
                  terms: ["sagittal band", "extensor digitorum communis"],
                  numbers: ["V"],
                  source: "Plastic Surgery 5E Vol 6 Ch 8"
                },
                {
                  fact: "Extensor retinaculum at Zone VII contains six dorsal fibro-osseous compartments separated by vertical septa, with APL/EPB in compartment 1 and EPL in compartment 3.",
                  terms: ["extensor retinaculum", "six dorsal compartments"],
                  numbers: ["six", "VII", "1", "3"],
                  source: "Plastic Surgery 5E Vol 6 Ch 8"
                }
              ]
            }
          ]
        },
        {
          id: "spl-peripheral-nerve-repair",
          name: "Peripheral Nerve Injury and Repair",
          topics: [
            {
              id: "spl-peripheral-nerve-repair",
              title: "Seddons & Sunderland Classifications, Nerve Grafts and Conduits",
              book: "Plastic Surgery 5E Vol 1 Ch 21 (Repair and grafting of peripheral nerve)",
              mustKnow: [
                {
                  fact: "Seddon classification grades nerve injury into neurapraxia local myelin conduction block, axonotmesis axonal disruption with intact endoneurium, and neurotmesis complete structural transection.",
                  terms: ["Seddon", "neurapraxia", "axonotmesis", "neurotmesis"],
                  numbers: ["three"],
                  source: "Plastic Surgery 5E Ch 21"
                },
                {
                  fact: "Sunderland expanded nerve injury classification into five degrees: 1st neurapraxia, 2nd axonotmesis, 3rd endoneurial disruption, 4th perineurial disruption, and 5th complete epineurial transection.",
                  terms: ["Sunderland", "five degrees", "endoneurium", "perineurium"],
                  numbers: ["five", "1st", "2nd", "3rd", "4th", "5th"],
                  source: "Plastic Surgery 5E Ch 21"
                },
                {
                  fact: "Wallerian degeneration begins within 24 to 48 hours distal to nerve transection, with Schwann cell proliferation forming bands of Bungner to guide regenerating axons.",
                  terms: ["Wallerian degeneration", "Schwann cell", "bands of Bungner"],
                  numbers: ["24", "48"],
                  source: "Plastic Surgery 5E Ch 21"
                },
                {
                  fact: "Axonal regeneration proceeds at a biological rate of approximately 1 mm per day or 1 inch per month following a latency period.",
                  terms: ["axonal regeneration"],
                  numbers: ["1"],
                  source: "Plastic Surgery 5E Ch 21"
                },
                {
                  fact: "Tinel sign tracks advancing regenerative axonal growth, where gentle percussion over the nerve trunk elicits distal tingling paresthesias.",
                  terms: ["Tinel sign", "regenerative axonal growth"],
                  source: "Plastic Surgery 5E Ch 21"
                },
                {
                  fact: "Direct end-to-end epineurial neurorrhaphy using 8-0 to 10-0 nylon under magnification is the preferred gold standard when repair is completely tension-free.",
                  terms: ["epineurial neurorrhaphy", "tension-free"],
                  numbers: ["8-0", "10-0"],
                  source: "Plastic Surgery 5E Ch 21"
                },
                {
                  fact: "Nerve gaps exceeding 2 cm cannot be closed without harmful tension and require autologous nerve grafting, with the sural nerve serving as the primary donor.",
                  terms: ["nerve gaps", "sural nerve", "autologous nerve grafting"],
                  numbers: ["2"],
                  source: "Plastic Surgery 5E Ch 21"
                },
                {
                  fact: "Processed nerve allografts Avance or bioabsorbable conduits provide effective alternatives for sensory digital nerve gaps under 2 to 3 cm.",
                  terms: ["nerve allografts", "conduits"],
                  numbers: ["2", "3"],
                  source: "Plastic Surgery 5E Ch 21"
                }
              ]
            }
          ]
        },
        {
          id: "spl-nerve-transfers-palsy",
          name: "Nerve Transfers and Tendon Transfers",
          topics: [
            {
              id: "spl-nerve-transfers-palsy",
              title: "Nerve Transfers and Tendon Transfers for Radial, Median and Ulnar Palsies",
              book: "Plastic Surgery 5E Vol 6 Ch 16 (Nerve transfers) & Ch 17 (Tendon transfers)",
              mustKnow: [
                {
                  fact: "Nerve transfers convert high proximal nerve injuries into low distal nerve coaptations close to the target neuromuscular junctions, avoiding prolonged regenerative delays.",
                  terms: ["nerve transfers", "neuromuscular junction"],
                  source: "Plastic Surgery 5E Vol 6 Ch 16"
                },
                {
                  fact: "In high radial nerve palsy, median nerve branches pronator teres PT and FDS motor fascicles are transferred directly to ECRB and PIN nerves to restore wrist and finger extension.",
                  terms: ["radial nerve palsy", "pronator teres", "PIN"],
                  source: "Plastic Surgery 5E Vol 6 Ch 16"
                },
                {
                  fact: "In high median nerve palsy, expendable branches of the radial nerve extensor carpi radialis brevis ECRB are transferred to the anterior interosseous nerve AIN to restore finger flexion.",
                  terms: ["median nerve palsy", "ECRB", "anterior interosseous nerve", "AIN"],
                  source: "Plastic Surgery 5E Vol 6 Ch 16"
                },
                {
                  fact: "In ulnar nerve intrinsic palsy, distal anterior interosseous nerve AIN pronator quadratus branch transfer to the ulnar deep motor branch preserves hand intrinsics.",
                  terms: ["ulnar nerve palsy", "pronator quadratus", "deep motor branch"],
                  source: "Plastic Surgery 5E Vol 6 Ch 16"
                },
                {
                  fact: "Classic Boyes or Brand tendon transfer for radial nerve palsy transfers pronator teres PT to ECRB for wrist extension, FCU or FDS to EDC for finger extension, and PL to EPL for thumb extension.",
                  terms: ["tendon transfer", "Boyes", "Brand", "pronator teres"],
                  source: "Plastic Surgery 5E Vol 6 Ch 17"
                },
                {
                  fact: "Opponensplasty for low median nerve palsy restores thumb opposition by transferring flexor digitorum superficialis FDS, abductor digiti minimi Huber, or extensor indicis proprius EIP.",
                  terms: ["opponensplasty", "thumb opposition", "Huber", "EIP"],
                  source: "Plastic Surgery 5E Vol 6 Ch 17"
                },
                {
                  fact: "Claw hand deformity in low ulnar nerve palsy causes MCP joint hyperextension and IP joint flexion, corrected dynamically via Stiles-Bunnell or Zancolli lasso transfers.",
                  terms: ["claw hand", "Zancolli lasso", "Stiles-Bunnell"],
                  source: "Plastic Surgery 5E Vol 6 Ch 17"
                },
                {
                  fact: "Prerequisites for successful tendon transfer include supple joints with full passive range of motion, adequate donor muscle strength grade 4 or 5, and synergic muscle action.",
                  terms: ["tendon transfer prerequisites", "muscle strength"],
                  numbers: ["4", "5"],
                  source: "Plastic Surgery 5E Vol 6 Ch 17"
                }
              ]
            }
          ]
        },
        {
          id: "spl-brachial-plexus-injuries",
          name: "Brachial Plexus Injuries",
          topics: [
            {
              id: "spl-brachial-plexus-injuries",
              title: "Brachial Plexus: Anatomy, Erb-Duchenne, Klumpke and Oberlin Transfer",
              book: "Plastic Surgery 5E Vol 6 Ch 18 (Brachial plexus injuries)",
              mustKnow: [
                {
                  fact: "Brachial plexus is formed by anterior primary rami of C5 to T1, organized into five roots, three trunks, six divisions, three cords, and terminal branches.",
                  terms: ["brachial plexus", "C5", "T1", "roots", "trunks"],
                  numbers: ["five", "three", "six"],
                  source: "Plastic Surgery 5E Vol 6 Ch 18"
                },
                {
                  fact: "Preganglionic root avulsion from spinal cord cannot be grafted directly and exhibits Horner syndrome T1, winged scapula long thoracic, and preserved sensory nerve action potentials SNAP.",
                  terms: ["preganglionic avulsion", "Horner syndrome", "SNAP"],
                  numbers: ["T1"],
                  source: "Plastic Surgery 5E Vol 6 Ch 18"
                },
                {
                  fact: "Erb-Duchenne palsy upper trunk C5-C6 results in classic waiters tip posture: shoulder adducted and internally rotated, elbow extended, forearm pronated, and wrist flexed.",
                  terms: ["Erb-Duchenne", "upper trunk", "C5-C6", "waiters tip"],
                  source: "Plastic Surgery 5E Vol 6 Ch 18"
                },
                {
                  fact: "Klumpke palsy lower trunk C7-T1 causes total claw hand deformity and intrinsic hand muscle paralysis, frequently associated with ipsilateral Horner syndrome.",
                  terms: ["Klumpke palsy", "lower trunk", "C7-T1", "claw hand"],
                  source: "Plastic Surgery 5E Vol 6 Ch 18"
                },
                {
                  fact: "Oberlin transfer restores active elbow flexion in upper plexus injury by transferring an expendable motor fascicle from the ulnar nerve to the biceps motor branch of musculocutaneous nerve.",
                  terms: ["Oberlin transfer", "ulnar nerve", "biceps", "musculocutaneous"],
                  source: "Plastic Surgery 5E Vol 6 Ch 18"
                },
                {
                  fact: "Mackinnon double fascicular transfer augments Oberlin transfer by adding a median nerve motor fascicle to the brachialis motor branch, providing powerful elbow flexion.",
                  terms: ["Mackinnon", "double fascicular transfer", "brachialis"],
                  numbers: ["two"],
                  source: "Plastic Surgery 5E Vol 6 Ch 18"
                },
                {
                  fact: "Spinal accessory nerve XI transfer to suprascapular nerve restores shoulder abduction and external rotation via supraspinatus and infraspinatus reinervation.",
                  terms: ["spinal accessory nerve", "suprascapular nerve", "shoulder abduction"],
                  numbers: ["XI"],
                  source: "Plastic Surgery 5E Vol 6 Ch 18"
                },
                {
                  fact: "Intercostal nerves T3-T6 or phrenic nerve transfers serve as donor neurotizers for motor reinnervation in pan-brachial plexus root avulsions.",
                  terms: ["intercostal nerves", "phrenic nerve", "neurotizers"],
                  numbers: ["T3", "T6"],
                  source: "Plastic Surgery 5E Vol 6 Ch 18"
                }
              ]
            }
          ]
        },
        {
          id: "spl-hand-fractures-dislocations",
          name: "Hand Fractures and Ligament Injuries",
          topics: [
            {
              id: "spl-hand-fractures-dislocations",
              title: "Hand Fractures: Bennett, Rolando, Scaphoid and Gamekeeper Thumb",
              book: "Plastic Surgery 5E Vol 6 Ch 5 (Fractures and dislocations of the hand and wrist)",
              mustKnow: [
                {
                  fact: "Bennett fracture is an intra-articular two-piece fracture-subluxation of the first metacarpal base, where abductor pollicis longus APL subluxates the shaft dorsally while the anterior oblique ligament holds the volar beak.",
                  terms: ["Bennett fracture", "first metacarpal", "abductor pollicis longus"],
                  numbers: ["two"],
                  source: "Plastic Surgery 5E Vol 6 Ch 5"
                },
                {
                  fact: "Rolando fracture is a comminuted T-shaped or Y-shaped intra-articular fracture of the first metacarpal base, requiring open reduction and internal fixation or external fixation.",
                  terms: ["Rolando fracture", "T-shaped", "first metacarpal"],
                  source: "Plastic Surgery 5E Vol 6 Ch 5"
                },
                {
                  fact: "Boxer fracture is a fracture of the fifth metacarpal neck with volar apex angulation, tolerating up to 40 to 50 degrees of volar angulation due to CMC joint mobility.",
                  terms: ["Boxer fracture", "fifth metacarpal", "volar angulation"],
                  numbers: ["40", "50"],
                  source: "Plastic Surgery 5E Vol 6 Ch 5"
                },
                {
                  fact: "Scaphoid fracture is the most common carpal bone fracture 60% to 70%, with waist fractures at highest risk for avascular necrosis due to retrograde blood supply from radial artery.",
                  terms: ["scaphoid fracture", "avascular necrosis", "retrograde blood supply"],
                  numbers: ["60%", "70%"],
                  source: "Plastic Surgery 5E Vol 6 Ch 5"
                },
                {
                  fact: "Snuffbox tenderness on physical examination mandates scaphoid series radiographs and prompt thumb spica splinting even when initial plain X-rays appear normal.",
                  terms: ["snuffbox tenderness", "thumb spica splint"],
                  source: "Plastic Surgery 5E Vol 6 Ch 5"
                },
                {
                  fact: "Gamekeeper or skier thumb is an acute or chronic rupture of the ulnar collateral ligament UCL of the thumb MCP joint.",
                  terms: ["Gamekeeper thumb", "ulnar collateral ligament", "UCL"],
                  source: "Plastic Surgery 5E Vol 6 Ch 5"
                },
                {
                  fact: "Stener lesion occurs when the torn UCL retracts superficial to the adductor pollicis aponeurosis, preventing ligamentous healing and requiring prompt surgical repair.",
                  terms: ["Stener lesion", "adductor pollicis"],
                  source: "Plastic Surgery 5E Vol 6 Ch 5"
                },
                {
                  fact: "PIP joint dorsal dislocation is the most common hand dislocation, treated by closed reduction and active extension block splinting to protect the disrupted volar plate.",
                  terms: ["PIP joint dislocation", "extension block splinting", "volar plate"],
                  source: "Plastic Surgery 5E Vol 6 Ch 5"
                }
              ]
            }
          ]
        },
        {
          id: "spl-replantation-revascularization",
          name: "Replantation and Microvascular Revascularization",
          topics: [
            {
              id: "spl-replantation-revascularization",
              title: "Digital Replantation: Indications, Cold Ischemia and Surgical Sequence",
              book: "Plastic Surgery 5E Vol 6 Ch 14 (Replantation and revascularization)",
              mustKnow: [
                {
                  fact: "Absolute indications for digital replantation include thumb amputations at any level, multiple digits, transmetacarpal amputations, any amputation in pediatric patients, and wrist or forearm amputations.",
                  terms: ["replantation indications", "thumb amputation", "pediatric"],
                  source: "Plastic Surgery 5E Vol 6 Ch 14"
                },
                {
                  fact: "Relative contraindications for replantation include severe crush or avulsion injuries, multiple-level amputations, severe psychiatric illness, and prolonged warm ischemia over 6 hours in proximal amputations.",
                  terms: ["replantation contraindications", "warm ischemia"],
                  numbers: ["6"],
                  source: "Plastic Surgery 5E Vol 6 Ch 14"
                },
                {
                  fact: "Maximum tolerable ischemia time for digit replantation with cold storage is up to 24 hours, whereas warm ischemia time for proximal muscle-containing parts should not exceed 6 hours.",
                  terms: ["ischemia time", "cold storage", "warm ischemia"],
                  numbers: ["24", "6"],
                  source: "Plastic Surgery 5E Vol 6 Ch 14"
                },
                {
                  fact: "Amputated parts must be wrapped in saline-moistened sterile gauze, placed inside a waterproof plastic bag, and floated in an ice-water slurry to prevent direct freezing frostbite.",
                  terms: ["amputated part preservation", "ice-water slurry"],
                  source: "Plastic Surgery 5E Vol 6 Ch 14"
                },
                {
                  fact: "Standard surgical sequence of replantation is: bone shortening and rigid skeletal fixation, extensor tendon repair, flexor tendon repair, digital arterial anastomosis, digital nerve repair, and venous anastomosis.",
                  terms: ["replantation sequence", "bone shortening", "skeletal fixation"],
                  source: "Plastic Surgery 5E Vol 6 Ch 14"
                },
                {
                  fact: "Vein-to-artery ratio of 2:1 two veins repaired for every one artery provides optimal venous outflow and minimizes postoperative venous congestion.",
                  terms: ["vein-to-artery ratio", "venous outflow"],
                  numbers: ["2:1", "two", "one"],
                  source: "Plastic Surgery 5E Vol 6 Ch 14"
                },
                {
                  fact: "Hirudo medicinalis medicinal leeches salvage congested replanted digits lacking venous repair by secreting the potent thrombin inhibitor hirudin, requiring ciprofloxacin prophylaxis against Aeromonas hydrophila.",
                  terms: ["Hirudo medicinalis", "leeches", "hirudin", "Aeromonas hydrophila", "ciprofloxacin"],
                  drugs: ["ciprofloxacin"],
                  source: "Plastic Surgery 5E Vol 6 Ch 14"
                },
                {
                  fact: "Tamai classification divides digital amputations into Zone I distal to the lunula base of nail bed and Zone II lunula to DIP joint, with Zone I repairs reliant on microvascular supermicrosurgery.",
                  terms: ["Tamai classification", "Zone I", "Zone II", "supermicrosurgery"],
                  numbers: ["I", "II"],
                  source: "Plastic Surgery 5E Vol 6 Ch 14"
                }
              ]
            }
          ]
        },
        {
          id: "spl-congenital-hand-anomalies",
          name: "Congenital Hand Anomalies",
          topics: [
            {
              id: "spl-congenital-hand-anomalies",
              title: "Congenital Hand: Oberg-Manske-Tonkin OMT, Syndactyly and Polydactyly",
              book: "Plastic Surgery 5E Vol 6 Ch 21 (Congenital hand anomalies)",
              mustKnow: [
                {
                  fact: "Oberg-Manske-Tonkin OMT classification categorizes congenital upper limb anomalies into malformations abnormal formation, deformations extrinsic forces, and dysplasias cellular organization.",
                  terms: ["Oberg-Manske-Tonkin", "OMT classification", "malformations"],
                  source: "Plastic Surgery 5E Vol 6 Ch 21"
                },
                {
                  fact: "Syndactyly is failure of digital separation, classified as simple skin only or complex bone fusion, and complete extending to fingertip or incomplete.",
                  terms: ["syndactyly", "simple", "complex", "complete"],
                  source: "Plastic Surgery 5E Vol 6 Ch 21"
                },
                {
                  fact: "Syndactyly release is timed around 12 to 18 months, utilizing zigzag volar and dorsal incisions with full-thickness skin grafts to prevent web creep.",
                  terms: ["syndactyly release", "web creep", "zigzag incisions"],
                  numbers: ["12", "18"],
                  source: "Plastic Surgery 5E Vol 6 Ch 21"
                },
                {
                  fact: "Adjacent syndactyly web spaces e.g., borders of middle finger should never be released simultaneously in a single operation to prevent digital ischemic compromise.",
                  terms: ["adjacent web spaces", "digital ischemia"],
                  source: "Plastic Surgery 5E Vol 6 Ch 21"
                },
                {
                  fact: "Radial polydactyly duplicate thumb is classified by Wassel into seven types, with Wassel Type IV bifid proximal phalanx duplicate thumb being the most common.",
                  terms: ["radial polydactyly", "Wassel", "Type IV"],
                  numbers: ["seven", "IV"],
                  source: "Plastic Surgery 5E Vol 6 Ch 21"
                },
                {
                  fact: "Bilhaut-Cloquet procedure combines symmetrical central wedges of both duplicate thumbs to create a single normal-width thumb in Wassel I and II deformities.",
                  terms: ["Bilhaut-Cloquet", "Wassel"],
                  numbers: ["I", "II"],
                  source: "Plastic Surgery 5E Vol 6 Ch 21"
                },
                {
                  fact: "Radial longitudinal deficiency radial club hand is associated with VACTERL, Holt-Oram, and Fanconi anemia syndromes, demanding baseline hematological and cardiac evaluation.",
                  terms: ["radial longitudinal deficiency", "VACTERL", "Fanconi anemia"],
                  source: "Plastic Surgery 5E Vol 6 Ch 21"
                },
                {
                  fact: "Constriction ring syndrome amniotic band sequence presents with circumferential digital constrictions, acrosyndactyly, or intrauterine amputations.",
                  terms: ["constriction ring syndrome", "amniotic band", "acrosyndactyly"],
                  source: "Plastic Surgery 5E Vol 6 Ch 21"
                }
              ]
            }
          ]
        },
        {
          id: "spl-dupuytren-contracture",
          name: "Dupuytren Contracture and Fascial Disorders",
          topics: [
            {
              id: "spl-dupuytren-contracture",
              title: "Dupuytren Disease: Cords, Myofibroblasts, Xiaflex and Fasciectomy",
              book: "Plastic Surgery 5E Vol 6 Ch 19 (Dupuytren disease)",
              mustKnow: [
                {
                  fact: "Dupuytren disease is a fibroproliferative disorder of the palmar and digital fascia driven by myofibroblasts expressing alpha-smooth muscle actin.",
                  terms: ["Dupuytren disease", "fibroproliferative", "myofibroblasts"],
                  source: "Plastic Surgery 5E Vol 6 Ch 19"
                },
                {
                  fact: "Dupuytren diathesis markers for aggressive disease include young age under 50, bilateral involvement, positive family history, and ectopic fibromatoses Ledderhose, Peyronie, Garrod pads.",
                  terms: ["Dupuytren diathesis", "Ledderhose", "Peyronie", "Garrod pads"],
                  numbers: ["50"],
                  source: "Plastic Surgery 5E Vol 6 Ch 19"
                },
                {
                  fact: "Pretendinous band forms the pretendinous cord, causing MCP joint flexion contracture; spiral band and lateral digital sheet form the spiral cord, which displaces the neurovascular bundle medially and superficially.",
                  terms: ["pretendinous cord", "spiral cord", "neurovascular bundle displacement"],
                  source: "Plastic Surgery 5E Vol 6 Ch 19"
                },
                {
                  fact: "Four anatomical structures contribute to the pathological spiral cord: pretendinous band, spiral band, Grayson ligament, and lateral digital sheet.",
                  terms: ["spiral cord", "Grayson ligament"],
                  numbers: ["four"],
                  source: "Plastic Surgery 5E Vol 6 Ch 19"
                },
                {
                  fact: "Hueston tabletop test is positive when a patient cannot place the palm completely flat on a table, representing an accepted indication for surgical intervention.",
                  terms: ["Hueston tabletop test"],
                  source: "Plastic Surgery 5E Vol 6 Ch 19"
                },
                {
                  fact: "Surgical intervention is indicated for MCP joint flexion contracture exceeding 30 degrees or any PIP joint contracture.",
                  terms: ["MCP joint contracture", "PIP joint contracture"],
                  numbers: ["30"],
                  source: "Plastic Surgery 5E Vol 6 Ch 19"
                },
                {
                  fact: "Limited selective fasciectomy through Brunner zigzag or longitudinal incisions with multiple Z-plasties is the standard surgical treatment.",
                  terms: ["limited selective fasciectomy", "Brunner incision", "Z-plasty"],
                  source: "Plastic Surgery 5E Vol 6 Ch 19"
                },
                {
                  fact: "Collagenase Clostridium histolyticum Xiaflex enzymatic fasciotomy lyses collagen cords, followed by manual finger manipulation 24 to 72 hours later to disrupt the cord.",
                  terms: ["collagenase", "Xiaflex", "enzymatic fasciotomy"],
                  numbers: ["24", "72"],
                  drugs: ["collagenase"],
                  source: "Plastic Surgery 5E Vol 6 Ch 19"
                }
              ]
            }
          ]
        },
        {
          id: "spl-carpal-tunnel-compression",
          name: "Compressive Neuropathies of the Upper Limb",
          topics: [
            {
              id: "spl-carpal-tunnel-compression",
              title: "Carpal Tunnel, Cubital Tunnel and Radial Tunnel Compressive Syndromes",
              book: "Plastic Surgery 5E Vol 6 Ch 15 (Compression neuropathies)",
              mustKnow: [
                {
                  fact: "Carpal tunnel contains ten structures: four tendons of FDS, four tendons of FDP, flexor pollicis longus FPL tendon, and the median nerve.",
                  terms: ["carpal tunnel", "median nerve", "FDS", "FDP", "FPL"],
                  numbers: ["ten", "four"],
                  source: "Plastic Surgery 5E Vol 6 Ch 15"
                },
                {
                  fact: "Phalen test produces median paresthesias in the radial 3.5 digits upon maximal wrist flexion for 60 seconds; Durkan carpal compression test is the most sensitive physical examination test.",
                  terms: ["Phalen test", "Durkan test", "carpal tunnel"],
                  numbers: ["3.5", "60"],
                  source: "Plastic Surgery 5E Vol 6 Ch 15"
                },
                {
                  fact: "Thenar muscle wasting abductor pollicis brevis APB and persistent sensory loss indicate severe chronic carpal tunnel syndrome requiring prompt open or endoscopic transverse carpal ligament release.",
                  terms: ["thenar wasting", "abductor pollicis brevis", "transverse carpal ligament"],
                  source: "Plastic Surgery 5E Vol 6 Ch 15"
                },
                {
                  fact: "Recurrent motor branch of median nerve demonstrates Lanz variations: extraligamentous 50%, subligamentous 30%, and transligamentous 20%.",
                  terms: ["recurrent motor branch", "Lanz classification"],
                  numbers: ["50%", "30%", "20%"],
                  source: "Plastic Surgery 5E Vol 6 Ch 15"
                },
                {
                  fact: "Cubital tunnel syndrome compresses the ulnar nerve at five potential anatomical sites, most commonly beneath the Osborne ligament / arcade between two heads of FCU.",
                  terms: ["cubital tunnel", "ulnar nerve", "Osborne ligament"],
                  numbers: ["five", "two"],
                  source: "Plastic Surgery 5E Vol 6 Ch 15"
                },
                {
                  fact: "Wartenberg sign involuntary abduction of the small finger due to unopposed extensor digiti minimi EDM and Froment sign compensatory IP thumb flexion by FPL confirm ulnar motor deficit.",
                  terms: ["Wartenberg sign", "Froment sign"],
                  source: "Plastic Surgery 5E Vol 6 Ch 15"
                },
                {
                  fact: "Pronator syndrome compresses median nerve in the proximal forearm, distinguished from carpal tunnel by sensory loss over the thenar eminence due to palmar cutaneous branch involvement.",
                  terms: ["pronator syndrome", "palmar cutaneous branch"],
                  source: "Plastic Surgery 5E Vol 6 Ch 15"
                },
                {
                  fact: "Radial tunnel syndrome compresses posterior interosseous nerve PIN at the arcade of Frohse, presenting with deep forearm pain without motor weakness.",
                  terms: ["radial tunnel", "arcade of Frohse", "PIN"],
                  source: "Plastic Surgery 5E Vol 6 Ch 15"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "spl-sec-breast",
      name: "Breast Reconstruction, Reduction and Aesthetics",
      modules: [
        {
          id: "spl-autologous-breast-diep",
          name: "Autologous Breast Reconstruction",
          topics: [
            {
              id: "spl-autologous-breast-diep",
              title: "Autologous Reconstruction: DIEP, Free TRAM and Latissimus Dorsi",
              book: "Plastic Surgery 5E Vol 5 Ch 5 (Autologous breast reconstruction: DIEP, TRAM, and alternative flaps)",
              mustKnow: [
                {
                  fact: "Deep inferior epigastric perforator DIEP flap transfers abdominal skin and adipose tissue while completely sparing the rectus abdominis muscle and anterior rectus sheath.",
                  terms: ["DIEP flap", "rectus abdominis", "anterior rectus sheath"],
                  source: "Plastic Surgery 5E Vol 5 Ch 5"
                },
                {
                  fact: "Internal mammary artery IMA and internal mammary vein IMV in the third or fourth rib intercostal space serve as the primary recipient vessels for microvascular breast reconstruction.",
                  terms: ["internal mammary artery", "IMA", "recipient vessels"],
                  numbers: ["third", "fourth"],
                  source: "Plastic Surgery 5E Vol 5 Ch 5"
                },
                {
                  fact: "Hartrampf vascular zones of the TRAM flap categorize perfusion: Zone I overlying pedicle, Zone II contralateral medial, Zone III ipsilateral lateral, and Zone IV contralateral lateral least perfused, discarded.",
                  terms: ["Hartrampf", "TRAM zones", "Zone IV"],
                  numbers: ["I", "II", "III", "IV"],
                  source: "Plastic Surgery 5E Vol 5 Ch 5"
                },
                {
                  fact: "Superficial inferior epigastric artery SIEA flap avoids entering the rectus sheath entirely but is only viable in approximately 20% to 30% of patients with adequate SIEA caliber over 1.5 mm.",
                  terms: ["SIEA flap", "rectus sheath"],
                  numbers: ["20%", "30%", "1.5"],
                  source: "Plastic Surgery 5E Vol 5 Ch 5"
                },
                {
                  fact: "Latissimus dorsi myocutaneous flap pedicled on the thoracodorsal vessels provides reliable autologous tissue, frequently combined with an implant for volume augmentation.",
                  terms: ["latissimus dorsi", "thoracodorsal vessels"],
                  source: "Plastic Surgery 5E Vol 5 Ch 5"
                },
                {
                  fact: "Alternative secondary autologous free flaps when abdominal donor sites are unsuitable include transverse upper gracilis TUG, profunda artery perforator PAP, and superior gluteal artery perforator SGAP flaps.",
                  terms: ["TUG flap", "PAP flap", "SGAP flap"],
                  source: "Plastic Surgery 5E Vol 5 Ch 5"
                },
                {
                  fact: "Post-mastectomy radiation therapy PMRT increases capsular contracture and implant failure rates by 3 to 4 times, making autologous tissue reconstruction the preferred modality.",
                  terms: ["post-mastectomy radiation", "PMRT", "autologous reconstruction"],
                  numbers: ["3", "4"],
                  source: "Plastic Surgery 5E Vol 5 Ch 5"
                },
                {
                  fact: "Preoperative abdominal CT angiography CTA reduces DIEP operative time by mapping the single largest dominant perforator and its intramuscular trajectory.",
                  terms: ["CT angiography", "DIEP", "intramuscular trajectory"],
                  source: "Plastic Surgery 5E Vol 5 Ch 5"
                }
              ]
            }
          ]
        },
        {
          id: "spl-implant-breast-reconstruction",
          name: "Implant-Based Breast Reconstruction",
          topics: [
            {
              id: "spl-implant-breast-reconstruction",
              title: "Implant Reconstruction: Prepectoral vs Subpectoral and ADM Use",
              book: "Plastic Surgery 5E Vol 5 Ch 4 (Implant-based breast reconstruction)",
              mustKnow: [
                {
                  fact: "Two-stage implant-based breast reconstruction utilizes a submuscular or prepectoral tissue expander exchanged for a permanent silicone gel implant after completing expansion.",
                  terms: ["tissue expander", "two-stage", "silicone implant"],
                  numbers: ["two"],
                  source: "Plastic Surgery 5E Vol 5 Ch 4"
                },
                {
                  fact: "Direct-to-implant DTI reconstruction places a permanent breast implant immediately at the time of mastectomy, requiring pristine, well-perfused mastectomy skin flaps verified by ICG angiography.",
                  terms: ["direct-to-implant", "DTI", "ICG angiography"],
                  source: "Plastic Surgery 5E Vol 5 Ch 4"
                },
                {
                  fact: "Prepectoral implant reconstruction places the device above the pectoralis major muscle, eliminating animation deformity and muscle spasm associated with subpectoral placement.",
                  terms: ["prepectoral", "pectoralis major", "animation deformity"],
                  source: "Plastic Surgery 5E Vol 5 Ch 4"
                },
                {
                  fact: "Acellular dermal matrix ADM serves as an internal sling or pocket complete wrap, stabilizing the implant position and providing lower pole coverage.",
                  terms: ["acellular dermal matrix", "ADM", "internal sling"],
                  source: "Plastic Surgery 5E Vol 5 Ch 4"
                },
                {
                  fact: "Breast implant-associated anaplastic large cell lymphoma BIA-ALCL is a CD30-positive, ALK-negative T-cell lymphoma associated primarily with textured implant surfaces.",
                  terms: ["BIA-ALCL", "CD30", "ALK-negative", "textured implant"],
                  source: "Plastic Surgery 5E Vol 5 Ch 4"
                },
                {
                  fact: "BIA-ALCL presents classically with a delayed peri-implant seroma occurring at a median of 8 to 10 years following implant placement.",
                  terms: ["delayed seroma", "peri-implant seroma"],
                  numbers: ["8", "10"],
                  source: "Plastic Surgery 5E Vol 5 Ch 4"
                },
                {
                  fact: "Diagnostic workup for suspected BIA-ALCL mandates ultrasound-guided aspiration of peri-implant seroma fluid for CD30 immunohistochemistry and cytology.",
                  terms: ["CD30", "immunohistochemistry", "seroma aspiration"],
                  source: "Plastic Surgery 5E Vol 5 Ch 4"
                },
                {
                  fact: "Definitive curative oncological treatment for localized BIA-ALCL is complete en bloc bilateral or ipsilateral capsulectomy with implant removal.",
                  terms: ["en bloc capsulectomy", "implant removal"],
                  source: "Plastic Surgery 5E Vol 5 Ch 4"
                }
              ]
            }
          ]
        },
        {
          id: "spl-breast-reduction-mastopexy",
          name: "Reduction Mammaplasty and Mastopexy",
          topics: [
            {
              id: "spl-breast-reduction-mastopexy",
              title: "Reduction Mammaplasty Pedicles, Wise Pattern and Regnault Ptosis",
              book: "Plastic Surgery 5E Vol 5 Ch 8 (Reduction mammaplasty) & Ch 9 (Mastopexy)",
              mustKnow: [
                {
                  fact: "Regnault classification of breast ptosis defines Grade I nipple at inframammary fold IMF, Grade II nipple below IMF but above lower breast contour, Grade III nipple at lowest contour point, and Pseudoptosis nipple at or above IMF with glandular bottoming out.",
                  terms: ["Regnault", "breast ptosis", "inframammary fold", "IMF"],
                  numbers: ["I", "II", "III"],
                  source: "Plastic Surgery 5E Vol 5 Ch 9"
                },
                {
                  fact: "Inferior pedicle Wise pattern inverted-T reduction mammaplasty is the workhorse technique for massive macromastia, reliably preserving nipple-areola complex NAC sensation and vascularity.",
                  terms: ["inferior pedicle", "Wise pattern", "macromastia", "NAC"],
                  source: "Plastic Surgery 5E Vol 5 Ch 8"
                },
                {
                  fact: "Superomedial pedicle technique supplies the NAC via internal thoracic anterior perforators and superior vessels, providing excellent upper pole projection and fullness.",
                  terms: ["superomedial pedicle", "upper pole projection"],
                  source: "Plastic Surgery 5E Vol 5 Ch 8"
                },
                {
                  fact: "Vertical scar reduction mammaplasty Lejour technique eliminates the transverse inframammary scar, relying on extensive parenchymal remodeling and skin elasticity.",
                  terms: ["vertical scar", "Lejour", "inframammary scar"],
                  source: "Plastic Surgery 5E Vol 5 Ch 8"
                },
                {
                  fact: "Free nipple graft FNG is indicated in gigantomastia with suprasternal notch to nipple distance exceeding 35 to 40 cm to eliminate risk of pedicle torsion and necrosis.",
                  terms: ["free nipple graft", "FNG", "gigantomastia"],
                  numbers: ["35", "40"],
                  source: "Plastic Surgery 5E Vol 5 Ch 8"
                },
                {
                  fact: "Nipple sensation is primarily mediated by the lateral cutaneous branch of the fourth intercostal nerve piercing deep fascia at the mid-axillary line.",
                  terms: ["nipple sensation", "fourth intercostal nerve"],
                  numbers: ["fourth"],
                  source: "Plastic Surgery 5E Vol 5 Ch 8"
                },
                {
                  fact: "Blood supply to the nipple-areola complex is multi-source, derived from anterior intercostal perforators of internal mammary artery, lateral thoracic artery, and thoracoacromial branches.",
                  terms: ["blood supply NAC", "internal mammary", "lateral thoracic"],
                  source: "Plastic Surgery 5E Vol 5 Ch 8"
                },
                {
                  fact: "Benelli round-block periareolar mastopexy utilizes a purse-string permanent suture to correct mild Grade I ptosis with minimal visible scarring.",
                  terms: ["Benelli", "periareolar mastopexy", "purse-string"],
                  numbers: ["I"],
                  source: "Plastic Surgery 5E Vol 5 Ch 9"
                }
              ]
            }
          ]
        },
        {
          id: "spl-gynecomastia-correction",
          name: "Gynecomastia and Male Chest Deformities",
          topics: [
            {
              id: "spl-gynecomastia-correction",
              title: "Gynecomastia: Simon Staging, Webster Excision and Liposuction",
              book: "Plastic Surgery 5E Vol 5 Ch 11 (Gynecomastia)",
              mustKnow: [
                {
                  fact: "Gynecomastia is benign proliferation of male breast glandular tissue resulting from an altered estrogen-to-androgen biological activity ratio.",
                  terms: ["gynecomastia", "estrogen", "androgen"],
                  source: "Plastic Surgery 5E Vol 5 Ch 11"
                },
                {
                  fact: "Simon classification grades gynecomastia: Grade 1 minor breast enlargement without skin excess, Grade 2a moderate enlargement without skin excess, Grade 2b moderate enlargement with skin excess, and Grade 3 marked enlargement with severe skin redundancy mimicking female breast.",
                  terms: ["Simon classification", "Grade 1", "Grade 2a", "Grade 2b", "Grade 3"],
                  numbers: ["1", "2", "3"],
                  source: "Plastic Surgery 5E Vol 5 Ch 11"
                },
                {
                  fact: "Physiological gynecomastia peaks in three distinct life periods: neonatal maternal estrogen transfer, pubertal hormonal surge around 13 to 14 years, and senescent declining testosterone in older males.",
                  terms: ["neonatal", "pubertal", "senescent"],
                  numbers: ["three", "13", "14"],
                  source: "Plastic Surgery 5E Vol 5 Ch 11"
                },
                {
                  fact: "Pathological etiologies include cirrhosis impaired estrogen degradation, chronic kidney disease, hypogonadism Klinefelter 47,XXY, testicular tumours Leydig/Sertoli, and thyrotoxicosis.",
                  terms: ["cirrhosis", "Klinefelter", "hypogonadism"],
                  numbers: ["47"],
                  source: "Plastic Surgery 5E Vol 5 Ch 11"
                },
                {
                  fact: "Pharmacological causes of gynecomastia include spironolactone, cimetidine, finasteride, ketoconazole, anabolic steroids, and antiretroviral protease inhibitors.",
                  terms: ["spironolactone", "finasteride", "anabolic steroids"],
                  drugs: ["spironolactone", "finasteride", "ketoconazole"],
                  source: "Plastic Surgery 5E Vol 5 Ch 11"
                },
                {
                  fact: "Webster intra-areolar semicircular inferior periareolar incision provides optimal direct exposure for sharp glandular excision beneath the nipple.",
                  terms: ["Webster incision", "glandular excision", "periareolar"],
                  source: "Plastic Surgery 5E Vol 5 Ch 11"
                },
                {
                  fact: "A 1.0 cm thick disc of retroareolar glandular tissue must be deliberately preserved to avoid permanent post-resection saucerization crater deformity of the nipple.",
                  terms: ["saucerization", "retroareolar tissue", "crater deformity"],
                  numbers: ["1.0"],
                  source: "Plastic Surgery 5E Vol 5 Ch 11"
                },
                {
                  fact: "Combined suction-assisted liposuction SAL or ultrasound-assisted liposuction UAL feathering smooths contour transitions between excised breast disc and surrounding chest wall.",
                  terms: ["liposuction", "contour feathering"],
                  source: "Plastic Surgery 5E Vol 5 Ch 11"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "spl-sec-aesthetic-lymph",
      name: "Aesthetic Surgery, Body Contouring and Lymphedema",
      modules: [
        {
          id: "spl-rhytidectomy-facelift",
          name: "Rhytidectomy and Facial Rejuvenation",
          topics: [
            {
              id: "spl-rhytidectomy-facelift",
              title: "Rhytidectomy: SMAS Plication, Deep Plane and Facial Retaining Ligaments",
              book: "Plastic Surgery 5E Vol 2 Ch 4 (Facelift: principles and techniques)",
              mustKnow: [
                {
                  fact: "Mitz and Peyronie defined the superficial musculoaponeurotic system SMAS as a continuous fibroaponeurotic network investing and connecting mimetic facial muscles.",
                  terms: ["Mitz and Peyronie", "SMAS", "fibroaponeurotic network"],
                  source: "Plastic Surgery 5E Vol 2 Ch 4"
                },
                {
                  fact: "Facial retaining ligaments true osteocutaneous ligaments zygomatic retaining ligament McGregor patch and retaining mandibular ligament anchor soft tissue to underlying facial skeleton.",
                  terms: ["retaining ligaments", "zygomatic ligament", "McGregor patch"],
                  source: "Plastic Surgery 5E Vol 2 Ch 4"
                },
                {
                  fact: "High-SMAS and extended SMAS techniques release zygomatic and upper masseteric retaining ligaments to mobilize midcheek malar fat pads superomedially.",
                  terms: ["high-SMAS", "malar fat pad"],
                  source: "Plastic Surgery 5E Vol 2 Ch 4"
                },
                {
                  fact: "Deep plane rhytidectomy Hamra releases retaining ligaments beneath the SMAS layer, elevating the SMAS, malar fat, and platysma as a composite tension-free flap.",
                  terms: ["deep plane rhytidectomy", "Hamra", "composite flap"],
                  source: "Plastic Surgery 5E Vol 2 Ch 4"
                },
                {
                  fact: "Platysma bands in the neck are managed via submental incision with anterior platysmaplasty midline corset plication and lateral SMAS-platysma suspension.",
                  terms: ["platysma bands", "platysmaplasty", "corset plication"],
                  source: "Plastic Surgery 5E Vol 2 Ch 4"
                },
                {
                  fact: "Great auricular nerve GAN is the most frequently injured nerve during rhytidectomy, running over sternocleidomastoid 6.5 cm below the external auditory meatus.",
                  terms: ["great auricular nerve", "GAN", "sternocleidomastoid"],
                  numbers: ["6.5"],
                  source: "Plastic Surgery 5E Vol 2 Ch 4"
                },
                {
                  fact: "Major haematoma is the most common early complication of rhytidectomy occurring in 1% to 3% of patients, presenting with sudden pain, unilateral swelling, and skin ecchymosis.",
                  terms: ["haematoma", "rhytidectomy complication"],
                  numbers: ["1%", "3%"],
                  source: "Plastic Surgery 5E Vol 2 Ch 4"
                },
                {
                  fact: "Preoperative control of hypertension systolic BP maintained strictly under 140 mmHg reduces postoperative haematoma risk by more than half.",
                  terms: ["hypertension", "systolic BP"],
                  numbers: ["140"],
                  source: "Plastic Surgery 5E Vol 2 Ch 4"
                }
              ]
            }
          ]
        },
        {
          id: "spl-blepharoplasty",
          name: "Blepharoplasty and Periorbital Aesthetics",
          topics: [
            {
              id: "spl-blepharoplasty",
              title: "Blepharoplasty: Upper Lid Anatomy, Lower Lid Fat Repositioning and Ptosis",
              book: "Plastic Surgery 5E Vol 2 Ch 7 (Blepharoplasty)",
              mustKnow: [
                {
                  fact: "Upper eyelid crease is formed by terminal insertions of levator palpebrae superioris aponeurosis fibers into the deep dermis, located 8 to 10 mm above ciliary margin in females and 7 to 8 mm in males.",
                  terms: ["eyelid crease", "levator palpebrae superioris"],
                  numbers: ["8", "10", "7"],
                  source: "Plastic Surgery 5E Vol 2 Ch 7"
                },
                {
                  fact: "Upper eyelid fat comprises two compartments: central preaponeurotic fat pad and medial pale fat pad, with lacrimal gland occupying the superolateral orbital compartment.",
                  terms: ["preaponeurotic fat pad", "lacrimal gland"],
                  numbers: ["two"],
                  source: "Plastic Surgery 5E Vol 2 Ch 7"
                },
                {
                  fact: "Lower eyelid fat contains three distinct compartments: medial, central, and lateral fat pads, separated by arcuate expansion of the inferior oblique muscle.",
                  terms: ["lower eyelid fat", "three compartments", "inferior oblique"],
                  numbers: ["three"],
                  source: "Plastic Surgery 5E Vol 2 Ch 7"
                },
                {
                  fact: "Transconjunctival lower blepharoplasty enters the retroseptal space without violating orbital septum or orbicularis oculi, eliminating external cutaneous scarring.",
                  terms: ["transconjunctival", "orbital septum"],
                  source: "Plastic Surgery 5E Vol 2 Ch 7"
                },
                {
                  fact: "Hamra lower eyelid fat transposition mobilises orbital fat pedicles over the inferior orbital rim into the tear trough subperiosteal pocket to eliminate the nasojugal groove.",
                  terms: ["Hamra", "fat transposition", "tear trough"],
                  source: "Plastic Surgery 5E Vol 2 Ch 7"
                },
                {
                  fact: "Snap-back and distraction tests assess lower eyelid horizontal laxity; distraction over 6 to 8 mm or delayed snap-back mandates lateral canthopexy or canthoplasty to prevent post-blepharoplasty ectropion.",
                  terms: ["snap-back test", "canthopexy", "ectropion"],
                  numbers: ["6", "8"],
                  source: "Plastic Surgery 5E Vol 2 Ch 7"
                },
                {
                  fact: "Blepharoptosis is assessed by margin reflex distance-1 MRD1 normal 4.0 to 4.5 mm and levator excursion normal 12 to 15 mm.",
                  terms: ["MRD1", "levator excursion", "blepharoptosis"],
                  numbers: ["4.0", "4.5", "12", "15"],
                  source: "Plastic Surgery 5E Vol 2 Ch 7"
                },
                {
                  fact: "Retrobulbar haematoma is an ophthalmic emergency causing acute intraocular hypertension and compartment syndrome, requiring immediate bedside lateral canthotomy and inferior cantholysis.",
                  terms: ["retrobulbar haematoma", "lateral canthotomy", "inferior cantholysis"],
                  source: "Plastic Surgery 5E Vol 2 Ch 7"
                }
              ]
            }
          ]
        },
        {
          id: "spl-rhinoplasty-techniques",
          name: "Rhinoplasty and Nasal Reconstruction",
          topics: [
            {
              id: "spl-rhinoplasty-techniques",
              title: "Open and Closed Rhinoplasty: Osteotomies, Grafts and Tip Dynamics",
              book: "Plastic Surgery 5E Vol 2 Ch 10 (Rhinoplasty)",
              mustKnow: [
                {
                  fact: "Open rhinoplasty incorporates an inverted-V transcolumellar incision paired with bilateral marginal incisions to provide complete unhindered exposure of the nasal cartilaginous framework.",
                  terms: ["open rhinoplasty", "transcolumellar incision", "marginal incisions"],
                  source: "Plastic Surgery 5E Vol 2 Ch 10"
                },
                {
                  fact: "Closed endonasal rhinoplasty employs intercartilaginous or intracartilaginous incisions, avoiding external columellar scars and minimizing postoperative tip edema.",
                  terms: ["endonasal rhinoplasty", "intercartilaginous"],
                  source: "Plastic Surgery 5E Vol 2 Ch 10"
                },
                {
                  fact: "Internal nasal valve is bounded by upper lateral cartilage, nasal septum, anterior head of inferior turbinate, and floor of pyriform aperture, forming the narrowest cross-sectional airway angle 10 to 15 degrees.",
                  terms: ["internal nasal valve", "upper lateral cartilage", "nasal septum"],
                  numbers: ["10", "15"],
                  source: "Plastic Surgery 5E Vol 2 Ch 10"
                },
                {
                  fact: "Spreader grafts Sheen placed between the dorsal septum and upper lateral cartilages reconstruct the internal nasal valve and prevent inverted-V roof collapse after hump reduction.",
                  terms: ["spreader grafts", "Sheen", "internal nasal valve"],
                  source: "Plastic Surgery 5E Vol 2 Ch 10"
                },
                {
                  fact: "Anderson tripod theory of nasal tip dynamics models the two lateral crura and conjoined medial crura; shortening the medial crura decreases tip projection and causes downward rotation.",
                  terms: ["Anderson tripod", "lateral crura", "medial crura"],
                  numbers: ["two"],
                  source: "Plastic Surgery 5E Vol 2 Ch 10"
                },
                {
                  fact: "Columellar strut graft placed between the medial crura strengthens tip support, maintains projection, and corrects columellar retraction.",
                  terms: ["columellar strut", "medial crura", "tip projection"],
                  source: "Plastic Surgery 5E Vol 2 Ch 10"
                },
                {
                  fact: "Lateral osteotomies mobilised along the nasofacial groove narrow a widened nasal vault and close the open-roof deformity following bony dorsal hump resection.",
                  terms: ["lateral osteotomies", "open-roof deformity"],
                  source: "Plastic Surgery 5E Vol 2 Ch 10"
                },
                {
                  fact: "Cephalic trim of the lower lateral cartilage must preserve at least 6 to 8 mm of residual lateral crus width to prevent external nasal valve collapse and alar retraction.",
                  terms: ["cephalic trim", "lateral crus", "external nasal valve"],
                  numbers: ["6", "8"],
                  source: "Plastic Surgery 5E Vol 2 Ch 10"
                }
              ]
            }
          ]
        },
        {
          id: "spl-abdominoplasty-body-contouring",
          name: "Abdominoplasty and Body Contouring",
          topics: [
            {
              id: "spl-abdominoplasty-body-contouring",
              title: "Abdominoplasty: Rectus Diastasis Plication and Massive Weight Loss",
              book: "Plastic Surgery 5E Vol 2 Ch 14 (Abdominoplasty and body contouring)",
              mustKnow: [
                {
                  fact: "Abdominoplasty addresses the triad of lower abdominal skin laxity, subcutaneous adipose excess, and rectus abdominis muscle diastasis.",
                  terms: ["abdominoplasty", "skin laxity", "rectus diastasis"],
                  numbers: ["three"],
                  source: "Plastic Surgery 5E Vol 2 Ch 14"
                },
                {
                  fact: "Full abdominoplasty involves low transverse suprapubic incision, umbilical transposition, extensive undermining to costal margins, and two-layer midline rectus fascia plication.",
                  terms: ["umbilical transposition", "rectus fascia plication"],
                  numbers: ["two"],
                  source: "Plastic Surgery 5E Vol 2 Ch 14"
                },
                {
                  fact: "Mini-abdominoplasty is indicated for mild infraumbilical skin laxity without supraumbilical excess, avoiding umbilical transposition.",
                  terms: ["mini-abdominoplasty", "infraumbilical"],
                  source: "Plastic Surgery 5E Vol 2 Ch 14"
                },
                {
                  fact: "High-superior tension abdominoplasty Lockwood anchors the superficial fascial system SFS to the deep iliac fascia, reducing scar migration and seroma rates.",
                  terms: ["Lockwood", "superficial fascial system", "SFS"],
                  source: "Plastic Surgery 5E Vol 2 Ch 14"
                },
                {
                  fact: "Progressive tension sutures Baroudi quilting sutures anchor the abdominal flap to underlying rectus sheath, obliterating dead space and reducing seroma rates under 2%.",
                  terms: ["progressive tension sutures", "Baroudi", "seroma"],
                  numbers: ["2%"],
                  source: "Plastic Surgery 5E Vol 2 Ch 14"
                },
                {
                  fact: "Fleur-de-lis abdominoplasty incorporates a vertical midline resection paired with low transverse excision for massive weight loss patients with circumferential laxity.",
                  terms: ["Fleur-de-lis", "massive weight loss", "vertical resection"],
                  source: "Plastic Surgery 5E Vol 2 Ch 14"
                },
                {
                  fact: "Circumferential lower body lift belt lipectomy extends excision 360 degrees around the waist to elevate the thighs, buttocks, and lower abdomen.",
                  terms: ["body lift", "belt lipectomy"],
                  numbers: ["360"],
                  source: "Plastic Surgery 5E Vol 2 Ch 14"
                },
                {
                  fact: "Postoperative venous thromboembolism VTE is the leading cause of mortality in abdominoplasty, requiring Caprini risk assessment, pneumatic compression, and enoxaparin prophylaxis.",
                  terms: ["venous thromboembolism", "Caprini", "enoxaparin"],
                  drugs: ["enoxaparin"],
                  source: "Plastic Surgery 5E Vol 2 Ch 14"
                }
              ]
            }
          ]
        },
        {
          id: "spl-liposuction-safety",
          name: "Liposuction and Body Contouring Safety",
          topics: [
            {
              id: "spl-liposuction-safety",
              title: "Tumescent Liposuction: Formulas, Lidocaine Toxicity and Volume Limits",
              book: "Plastic Surgery 5E Vol 2 Ch 13 (Liposuction: principles and safety)",
              mustKnow: [
                {
                  fact: "Klein tumescent formula consists of 1 liter normal saline with 500 to 1000 mg lidocaine, 1 mg epinephrine 1:1,000,000, and 10 mEq sodium bicarbonate.",
                  terms: ["Klein tumescent", "lidocaine", "epinephrine", "sodium bicarbonate"],
                  numbers: ["1", "500", "1000", "10"],
                  drugs: ["lidocaine", "epinephrine", "sodium bicarbonate"],
                  source: "Plastic Surgery 5E Vol 2 Ch 13"
                },
                {
                  fact: "Maximum safe dose of lidocaine in tumescent liposuction is 35 to 55 mg per kg body weight, compared to only 7 mg per kg for standard commercial lidocaine with epinephrine.",
                  terms: ["lidocaine dose", "tumescent liposuction"],
                  numbers: ["35", "55", "7"],
                  drugs: ["lidocaine"],
                  source: "Plastic Surgery 5E Vol 2 Ch 13"
                },
                {
                  fact: "Peak serum lidocaine concentrations occur 8 to 14 hours after tumescent infiltration due to delayed subcutaneous vascular absorption from profound epinephrine vasoconstriction.",
                  terms: ["peak serum lidocaine", "epinephrine vasoconstriction"],
                  numbers: ["8", "14"],
                  drugs: ["lidocaine", "epinephrine"],
                  source: "Plastic Surgery 5E Vol 2 Ch 13"
                },
                {
                  fact: "Lidocaine toxicity progresses from perioral numbness, metallic taste, and tinnitus, to slurred speech, seizures, respiratory arrest, and cardiovascular collapse.",
                  terms: ["lidocaine toxicity", "perioral numbness", "seizures"],
                  drugs: ["lidocaine"],
                  source: "Plastic Surgery 5E Vol 2 Ch 13"
                },
                {
                  fact: "Large-volume liposuction LVL is defined as removal of 5000 mL or greater of total lipoaspirate fat plus fluid in a single procedure, mandating overnight inpatient observation.",
                  terms: ["large-volume liposuction", "LVL", "lipoaspirate"],
                  numbers: ["5000"],
                  source: "Plastic Surgery 5E Vol 2 Ch 13"
                },
                {
                  fact: "Tumescent infiltration ratio in super-wet technique is 1 mL of fluid per 1 mL of expected aspirate, with blood loss comprising less than 1% of total aspirate volume.",
                  terms: ["super-wet technique", "blood loss"],
                  numbers: ["1", "1%"],
                  source: "Plastic Surgery 5E Vol 2 Ch 13"
                },
                {
                  fact: "Fatal pulmonary fat embolism syndrome during gluteal fat grafting BBL is caused by deep intramuscular cannula injection and laceration of gluteal venous tributaries.",
                  terms: ["fat embolism", "gluteal fat grafting", "intramuscular injection"],
                  source: "Plastic Surgery 5E Vol 2 Ch 13"
                },
                {
                  fact: "Multi-society safety guidelines mandate that fat grafting to the gluteal region must be strictly confined to the subcutaneous space, strictly avoiding the subfascial or intramuscular planes.",
                  terms: ["subcutaneous space", "safety guidelines"],
                  source: "Plastic Surgery 5E Vol 2 Ch 13"
                }
              ]
            }
          ]
        },
        {
          id: "spl-lymphedema-physiol-surgery",
          name: "Lymphedema Physiology and Micro-Surgical Management",
          topics: [
            {
              id: "spl-lymphedema-physiol-surgery",
              title: "Lymphedema: Staging, Lymphovenous Anastomosis LVA and VLNT",
              book: "Plastic Surgery 5E Vol 1 Ch 28 (Lymphedema pathophysiology and basic science) & Vol 4 Ch 6",
              mustKnow: [
                {
                  fact: "International Society of Lymphology ISL classifies lymphedema into Stage 0 subclinical, Stage 1 reversible pitting edema, Stage 2 irreversible non-pitting fibrotic edema, and Stage 3 lymphostatic elephantiasis.",
                  terms: ["ISL classification", "Stage 0", "Stage 1", "Stage 2", "Stage 3"],
                  numbers: ["0", "1", "2", "3"],
                  source: "Plastic Surgery 5E Vol 1 Ch 28"
                },
                {
                  fact: "Indocyanine green ICG lymphography with near-infrared imaging maps functional dermal lymphatics into linear normal, splash, stardust, and diffuse dermal backflow patterns.",
                  terms: ["indocyanine green", "ICG lymphography", "dermal backflow"],
                  source: "Plastic Surgery 5E Vol 1 Ch 28"
                },
                {
                  fact: "Lymphovenous anastomosis LVA supermicrosurgery connects functioning subdermal lymphatic channels 0.3 to 0.8 mm directly to adjacent venules under high-power microscope.",
                  terms: ["lymphovenous anastomosis", "LVA", "supermicrosurgery"],
                  numbers: ["0.3", "0.8"],
                  source: "Plastic Surgery 5E Vol 4 Ch 6"
                },
                {
                  fact: "LVA is most effective in early ISL Stage 1 and early Stage 2 lymphedema where lymphatic vessels maintain contractility and patent lumens without severe intraluminal sclerosis.",
                  terms: ["LVA efficacy", "intraluminal sclerosis"],
                  numbers: ["1", "2"],
                  source: "Plastic Surgery 5E Vol 4 Ch 6"
                },
                {
                  fact: "Vascularized lymph node transfer VLNT microvascularly transplants vascularized lymph node basins e.g., supraclavicular, omental, or lateral thoracic into the affected extremity.",
                  terms: ["vascularized lymph node transfer", "VLNT", "supraclavicular"],
                  source: "Plastic Surgery 5E Vol 4 Ch 6"
                },
                {
                  fact: "VLNT functions via lymphangiogenesis driven by VEGF-C secretion from transferred nodes, and internal pump-sponge mechanism channeling lymph into venous circulation.",
                  terms: ["lymphangiogenesis", "VEGF-C"],
                  source: "Plastic Surgery 5E Vol 4 Ch 6"
                },
                {
                  fact: "Late-stage irreversible fibro-adipose deposition Stage 2 late and Stage 3 is treated with circumferential suction-assisted lipectomy under tourniquet control.",
                  terms: ["suction-assisted lipectomy", "fibro-adipose deposition"],
                  numbers: ["2", "3"],
                  source: "Plastic Surgery 5E Vol 4 Ch 6"
                },
                {
                  fact: "Stewart-Treves syndrome is rare, aggressive lymphangiosarcoma developing in long-standing chronic lymphedematous extremities, carrying a dismal 5-year survival under 15%.",
                  terms: ["Stewart-Treves syndrome", "lymphangiosarcoma"],
                  numbers: ["5", "15%"],
                  source: "Plastic Surgery 5E Vol 1 Ch 28"
                }
              ]
            }
          ]
        },
        {
          id: "spl-vascular-anomalies-hemangioma",
          name: "Vascular Anomalies and Malformations",
          topics: [
            {
              id: "spl-vascular-anomalies-hemangioma",
              title: "ISSVA Classification: Infantile Hemangiomas and Vascular Malformations",
              book: "Plastic Surgery 5E Vol 3 Ch 31 (Vascular anomalies)",
              mustKnow: [
                {
                  fact: "ISSVA classification separates vascular anomalies into vascular tumours endothelial hyperplasia, e.g., infantile hemangioma and vascular malformations abnormal structural dysmorphogenesis.",
                  terms: ["ISSVA", "vascular tumours", "vascular malformations"],
                  source: "Plastic Surgery 5E Vol 3 Ch 31"
                },
                {
                  fact: "Infantile hemangiomas stain strongly positive for glucose transporter-1 GLUT-1, whereas congenital hemangiomas and vascular malformations are consistently GLUT-1 negative.",
                  terms: ["GLUT-1", "infantile hemangioma"],
                  source: "Plastic Surgery 5E Vol 3 Ch 31"
                },
                {
                  fact: "Infantile hemangiomas display a predictable natural life history: rapid proliferative phase during the first 6 to 9 months, followed by slow involution resolving by 5 to 9 years.",
                  terms: ["proliferative phase", "involution"],
                  numbers: ["6", "9", "5"],
                  source: "Plastic Surgery 5E Vol 3 Ch 31"
                },
                {
                  fact: "First-line pharmacotherapy for problematic proliferating infantile hemangiomas is oral propranolol dosed at 2 to 3 mg per kg per day, inducing pericyte apoptosis and vasoconstriction.",
                  terms: ["propranolol", "infantile hemangioma"],
                  numbers: ["2", "3"],
                  drugs: ["propranolol"],
                  source: "Plastic Surgery 5E Vol 3 Ch 31"
                },
                {
                  fact: "Kasabach-Merritt phenomenon life-threatening consumptive thrombocytopenia and coagulopathy is caused by kaposiform hemangioendothelioma KHE or tufted angioma, never common infantile hemangioma.",
                  terms: ["Kasabach-Merritt", "thrombocytopenia", "kaposiform hemangioendothelioma"],
                  source: "Plastic Surgery 5E Vol 3 Ch 31"
                },
                {
                  fact: "Vascular malformations are present at birth, grow proportionately with child growth, and never exhibit spontaneous involution.",
                  terms: ["vascular malformations", "proportionate growth"],
                  source: "Plastic Surgery 5E Vol 3 Ch 31"
                },
                {
                  fact: "Low-flow vascular malformations comprise venous malformations blue soft compressible, lymphatic malformations microcystic or macrocystic, and capillary malformations port-wine stain.",
                  terms: ["low-flow", "venous malformations", "lymphatic malformations", "port-wine stain"],
                  source: "Plastic Surgery 5E Vol 3 Ch 31"
                },
                {
                  fact: "High-flow arteriovenous malformations AVM feature direct arterial-venous nidi without intervening capillaries, staged by the Schobinger clinical classification from Stage I to IV.",
                  terms: ["arteriovenous malformations", "AVM", "Schobinger", "nidus"],
                  numbers: ["I", "IV"],
                  source: "Plastic Surgery 5E Vol 3 Ch 31"
                }
              ]
            }
          ]
        },
        {
          id: "spl-skin-tumours-reconstruction",
          name: "Cutaneous Malignancies and Reconstruction",
          topics: [
            {
              id: "spl-skin-tumours-reconstruction",
              title: "Basal Cell, Squamous Cell, Melanoma Margins and Mohs Micrographic Surgery",
              book: "Plastic Surgery 5E Vol 1 Ch 29 (Nonmelanocytic skin tumours) & Ch 30 (Melanoma)",
              mustKnow: [
                {
                  fact: "Basal cell carcinoma BCC is the most common human skin malignancy, categorized histologically into nodular, superficial, and aggressive infiltrating/morpheaform variants.",
                  terms: ["basal cell carcinoma", "BCC", "morpheaform"],
                  source: "Plastic Surgery 5E Vol 1 Ch 29"
                },
                {
                  fact: "Standard surgical excision margin for low-risk primary BCC is 4 mm, yielding a 95% complete histological clearance rate.",
                  terms: ["BCC margin", "low-risk BCC"],
                  numbers: ["4", "95%"],
                  source: "Plastic Surgery 5E Vol 1 Ch 29"
                },
                {
                  fact: "High-risk cutaneous squamous cell carcinoma cSCC characterized by diameter over 2 cm, depth over 4 mm, perineural invasion, or poorly differentiated histology requires 6 to 10 mm surgical margins.",
                  terms: ["squamous cell carcinoma", "cSCC", "perineural invasion"],
                  numbers: ["2", "4", "6", "10"],
                  source: "Plastic Surgery 5E Vol 1 Ch 29"
                },
                {
                  fact: "Mohs micrographic surgery evaluates 100% of peripheral and deep surgical margins via horizontal frozen sections, maximizing tissue preservation and cure rates in cosmetically sensitive facial zones.",
                  terms: ["Mohs micrographic surgery", "frozen sections", "margins"],
                  numbers: ["100%"],
                  source: "Plastic Surgery 5E Vol 1 Ch 29"
                },
                {
                  fact: "Cutaneous melanoma surgical excision margins according to Breslow depth are: melanoma in situ 5 mm, Breslow under 1.0 mm 1 cm margin, Breslow 1.01 to 2.0 mm 1 to 2 cm margin, and Breslow over 2.0 mm 2 cm margin.",
                  terms: ["melanoma margins", "Breslow depth", "melanoma in situ"],
                  numbers: ["5", "1.0", "1", "1.01", "2.0", "2"],
                  source: "Plastic Surgery 5E Vol 1 Ch 30"
                },
                {
                  fact: "Sentinel lymph node biopsy SLNB is recommended for cutaneous melanomas with Breslow thickness 0.8 mm or greater, or under 0.8 mm with ulceration.",
                  terms: ["sentinel lymph node biopsy", "SLNB", "Breslow thickness"],
                  numbers: ["0.8"],
                  source: "Plastic Surgery 5E Vol 1 Ch 30"
                },
                {
                  fact: "Breslow tumor thickness measured from granular cell layer to deepest invasive tumor cell is the single most important histological prognostic factor in primary localized melanoma.",
                  terms: ["Breslow tumor thickness", "prognostic factor"],
                  source: "Plastic Surgery 5E Vol 1 Ch 30"
                },
                {
                  fact: "Marjolin ulcer is an aggressive squamous cell carcinoma arising within chronic non-healing burn scars, chronic osteomyelitis sinus tracts, or venous stasis ulcers.",
                  terms: ["Marjolin ulcer", "squamous cell carcinoma", "burn scars"],
                  source: "Plastic Surgery 5E Vol 1 Ch 29"
                }
              ]
            }
          ]
        },
        {
          id: "spl-gender-affirming-surgery",
          name: "Gender-Affirming Surgery",
          topics: [
            {
              id: "spl-gender-affirming-surgery",
              title: "Gender Affirmation: Mastectomy, Phalloplasty and Inversion Vaginoplasty",
              book: "Plastic Surgery 5E Vol 1 Ch 40 (Gender-affirming surgery)",
              mustKnow: [
                {
                  fact: "Gender-affirming chest masculinization top surgery utilizes semicircular / periareolar concentric incisions in patients with minimal breast tissue and skin excess.",
                  terms: ["chest masculinization", "periareolar incision"],
                  source: "Plastic Surgery 5E Vol 1 Ch 40"
                },
                {
                  fact: "Double incision mastectomy with free nipple-areola grafting is the workhorse technique for masculinizing chest wall contour in patients with moderate to severe breast ptosis.",
                  terms: ["double incision mastectomy", "free nipple grafting"],
                  numbers: ["two"],
                  source: "Plastic Surgery 5E Vol 1 Ch 40"
                },
                {
                  fact: "Male nipple-areola complex NAC is positioned smaller 22 to 28 mm diameter, oval, and placed more lateral and inferiorly over the lateral border of pectoralis major fourth intercostal space.",
                  terms: ["male NAC", "pectoralis major", "fourth intercostal space"],
                  numbers: ["22", "28", "fourth"],
                  source: "Plastic Surgery 5E Vol 1 Ch 40"
                },
                {
                  fact: "Penile inversion vaginoplasty is the gold standard for transfeminine genital surgery, creating a neovaginal cavity between rectum and prostate using inverted penile skin flaps.",
                  terms: ["penile inversion vaginoplasty", "neovaginal cavity"],
                  source: "Plastic Surgery 5E Vol 1 Ch 40"
                },
                {
                  fact: "Neoclitoris is constructed from the glans penis pedicled on the dorsal neurovascular bundle, preserving erotic sensory innervation and vascularity.",
                  terms: ["neoclitoris", "glans penis", "dorsal neurovascular bundle"],
                  source: "Plastic Surgery 5E Vol 1 Ch 40"
                },
                {
                  fact: "Phalloplasty in transmasculine surgery is most frequently performed using the microvascular radial forearm free flap RFFF with tube-within-a-tube urethroplasty design.",
                  terms: ["phalloplasty", "radial forearm", "tube-within-a-tube"],
                  source: "Plastic Surgery 5E Vol 1 Ch 40"
                },
                {
                  fact: "Anterolateral thigh ALT flap serves as the primary alternative donor site for phalloplasty when radial forearm tissue is inadequate or declined.",
                  terms: ["anterolateral thigh", "ALT phalloplasty"],
                  source: "Plastic Surgery 5E Vol 1 Ch 40"
                },
                {
                  fact: "WPATH Standards of Care version 8 requires multidisciplinary mental health, endocrine, and surgical evaluations prior to irreversible genital reconstructive surgery.",
                  terms: ["WPATH", "Standards of Care", "version 8"],
                  numbers: ["8"],
                  source: "Plastic Surgery 5E Vol 1 Ch 40"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
};

const outPath = "/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/ss-lessons-B/prep/blueprints/ss/ss-plastic-surgery.json";
fs.writeFileSync(outPath, JSON.stringify(blueprint, null, 2));
console.log(`Successfully wrote ${blueprint.sections.length} sections and ${blueprint.sections.flatMap(s => s.modules).length} modules to ${outPath}`);
