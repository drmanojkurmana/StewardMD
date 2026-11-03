// scripts/build-radiology-blueprint.mjs
// Compiles the high-yield Radiology (Radiodiagnosis) Stage 1 blueprint adhering to:
// - Crack the Core (CTC), RDN11, rad-notes-2
// - Grainger & Allison's Diagnostic Radiology 7th Edition
// - Core Exam / NEET-SS Radiodiagnosis Specialty Guidelines
// - 24 modules across 13 sections, 8 mustKnow facts per module (192 facts total)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const blueprint = {
  subject: "ss-radiology",
  title: "Radiology (Radiodiagnosis)",
  branch: "ss-medicine",
  curriculum: "NMC Competency-Based MD / DNB / DM Radiodiagnosis Curriculum / NBEMS NEET-SS Radiodiagnosis Specialty Group",
  examPattern: "NEET-SS Radiodiagnosis (100% Core diagnostic radiology, cross-sectional imaging protocols, neuro, head and neck, thoracic HRCT, cardiovascular, abdominal, pelvic, musculoskeletal, paediatric, breast BI-RADS, interventional radiology and radiological physics/safety).",
  book: "Crack the Core Exam (CTC); Core Exam Radiodiagnosis Notes (RDN11, rad-notes-2); Grainger and Allison's Diagnostic Radiology 7th Edition; Harrison's Principles of Internal Medicine 22nd Edition",
  sections: [
    {
      id: "srd-neuro",
      name: "Neuroradiology",
      modules: [
        {
          id: "srd-neuro-vascular",
          name: "Stroke, haemorrhage and cerebrovascular disease",
          size: "l",
          topics: [
            {
              id: "srd-neuro-vascular",
              title: "Stroke, haemorrhage and cerebrovascular disease",
              book: "Crack the Core Neuroradiology / RDN11 Neurovascular",
              mustKnow: [
                {
                  fact: "Hyperdense middle cerebral artery sign on non-contrast CT indicates acute intraluminal thromboembolism within the M1 segment, demonstrating high specificity for acute ischaemic stroke.",
                  terms: ["Hyperdense middle cerebral artery", "ischaemic stroke"],
                  source: "Crack the Core Neuro / RDN11"
                },
                {
                  fact: "ASPECTS (Alberta Stroke Program Early CT Score) scores baseline non-contrast CT ischaemic changes from 10 points across 10 defined middle cerebral artery territory regions, subtracting 1 point per involved zone.",
                  terms: ["ASPECTS", "middle cerebral artery"],
                  numbers: ["10", "1"],
                  source: "Crack the Core Neuro / RDN11"
                },
                {
                  fact: "Diffusion-weighted imaging (DWI) hyperintensity with corresponding apparent diffusion coefficient (ADC) hypointensity reflects cytotoxic oedema and cellular swelling from failure of ATP-dependent sodium-potassium pumps.",
                  terms: ["apparent diffusion coefficient", "cytotoxic oedema"],
                  source: "Crack the Core Neuro / RDN11"
                },
                {
                  fact: "CT perfusion mismatch defines the ischaemic penumbra by demonstrating elevated mean transit time (MTT > 145%) or Tmax > 6 seconds with preserved cerebral blood volume (CBV > 2.0 mL/100g).",
                  terms: ["ischaemic penumbra", "cerebral blood volume"],
                  numbers: ["145%", "6", "2.0"],
                  source: "Crack the Core Neuro / RDN11"
                },
                {
                  fact: "Subarachnoid haemorrhage appears as high-attenuation extravasated blood within basal cisterns and sulci on non-contrast CT, most commonly secondary to ruptured saccular aneurysms at the anterior communicating artery.",
                  terms: ["Subarachnoid haemorrhage", "anterior communicating artery"],
                  source: "Crack the Core Neuro / RDN11"
                },
                {
                  fact: "Hypertensive intracerebral microbleeds characteristically occur in deep subcortical structures including the putamen, thalamus, and pons, contrasting with cortical-subcortical lobar microbleeds of cerebral amyloid angiopathy.",
                  terms: ["cerebral amyloid angiopathy", "putamen"],
                  source: "Crack the Core Neuro / RDN11"
                },
                {
                  fact: "Spontaneous dissection of the internal carotid artery typically produces an eccentric crescent of hyperintense subacute mural haematoma narrowing the vessel lumen on fat-saturated T1-weighted MRI.",
                  terms: ["internal carotid artery", "mural haematoma"],
                  source: "Crack the Core Neuro / RDN11"
                },
                {
                  fact: "Dural venous sinus thrombosis demonstrates the dense clot sign on non-contrast CT and the empty delta sign consisting of a non-enhancing thrombus surrounded by collateral dural enhancement on contrast-enhanced CT.",
                  terms: ["empty delta sign", "venous sinus thrombosis"],
                  source: "Crack the Core Neuro / RDN11"
                }
              ]
            }
          ]
        },
        {
          id: "srd-neuro-tumour",
          name: "Brain tumours and the posterior fossa",
          size: "l",
          topics: [
            {
              id: "srd-neuro-tumour",
              title: "Brain tumours and the posterior fossa",
              book: "Crack the Core Neuroradiology / RDN11 Brain Tumours",
              mustKnow: [
                {
                  fact: "Glioblastoma IDH-wildtype classically demonstrates a thick, irregular, peripherally ring-enhancing necrotic mass with elevated choline-to-creatine ratio and lipid-lactate resonance peaks on MR spectroscopy.",
                  terms: ["Glioblastoma", "MR spectroscopy"],
                  source: "Crack the Core Neuro / RDN11"
                },
                {
                  fact: "Oligodendroglioma IDH-mutant and 1p/19q-codeleted characteristically arises in the frontal lobe cortical-subcortical white matter and shows coarse intratumoural calcifications in up to 90% of cases on CT.",
                  terms: ["Oligodendroglioma", "calcifications"],
                  numbers: ["90%"],
                  source: "Crack the Core Neuro / RDN11"
                },
                {
                  fact: "Pilocytic astrocytoma typically arises in the cerebellum of children as a cystic lesion with an intensely enhancing mural nodule, classically classified as WHO grade 1.",
                  terms: ["Pilocytic astrocytoma", "mural nodule"],
                  numbers: ["1"],
                  source: "Crack the Core Neuro / RDN11"
                },
                {
                  fact: "Medulloblastoma arises from the inferior medullary velum into the fourth ventricle, showing hyperdensity on unenhanced CT and marked restricted diffusion on DWI reflecting high cellularity and small round blue cells.",
                  terms: ["Medulloblastoma", "fourth ventricle"],
                  source: "Crack the Core Neuro / RDN11"
                },
                {
                  fact: "Ependymoma characteristically originates from the floor of the fourth ventricle and plasticity allows extrusion through the foramina of Luschka and Magendie into the prepontine cistern.",
                  terms: ["Ependymoma", "foramina of Luschka"],
                  source: "Crack the Core Neuro / RDN11"
                },
                {
                  fact: "Vestibular schwannoma arises from the inferior vestibular nerve within the internal auditory canal, widening the porus acusticus and producing an 'ice-cream cone' configuration within the cerebellopontine angle.",
                  terms: ["Vestibular schwannoma", "internal auditory canal"],
                  source: "Crack the Core Neuro / RDN11"
                },
                {
                  fact: "Meningioma displays homogeneous intense contrast enhancement, a broad dural tail, and hyperostosis of adjacent calvarial bone, frequently exhibiting elevated perfusion with prolonged MTT and elevated CBV.",
                  terms: ["Meningioma", "dural tail"],
                  source: "Crack the Core Neuro / RDN11"
                },
                {
                  fact: "Craniopharyngioma adamantinomatous type follows the 90% rule with 90% cystic component, 90% peripheral rim calcification, and 90% vivid contrast enhancement of the cyst wall and solid nodule.",
                  terms: ["Craniopharyngioma", "adamantinomatous"],
                  numbers: ["90%"],
                  source: "Crack the Core Neuro / RDN11"
                }
              ]
            }
          ]
        },
        {
          id: "srd-neuro-metabolic",
          name: "Infection, demyelination, toxic and metabolic disease",
          size: "l",
          topics: [
            {
              id: "srd-neuro-metabolic",
              title: "Infection, demyelination, toxic and metabolic disease",
              book: "Crack the Core Neuroradiology / RDN11 Neuroinfections and Demyelination",
              mustKnow: [
                {
                  fact: "Pyogenic brain abscess exhibits central restricted diffusion on DWI with low ADC and a thin, smooth, collagen-rich capsule demonstrating T2 hypointensity and ring enhancement on contrast T1 MRI.",
                  terms: ["brain abscess", "restricted diffusion"],
                  source: "Crack the Core Neuro / RDN11"
                },
                {
                  fact: "Herpes simplex virus encephalitis characteristically produces asymmetric FLAIR hyperintensity and diffusion restriction in the medial temporal lobes, insular cortex, and inferior frontal lobes, characteristically sparing the basal ganglia.",
                  terms: ["Herpes simplex virus", "medial temporal"],
                  source: "Crack the Core Neuro / RDN11"
                },
                {
                  fact: "Multiple sclerosis plaques appear as Dawson fingers oriented perpendicular to the lateral ventricular ependyma along callososeptal venules on sagittal FLAIR images.",
                  terms: ["Dawson fingers", "Multiple sclerosis"],
                  source: "Crack the Core Neuro / RDN11"
                },
                {
                  fact: "Neuromyelitis optica spectrum disorder (NMOSD) characteristically features longitudinally extensive transverse myelitis involving 3 or more contiguous vertebral segments and aquaporin-4 antibody seropositivity.",
                  terms: ["longitudinally extensive transverse myelitis", "aquaporin-4"],
                  numbers: ["3"],
                  source: "Crack the Core Neuro / RDN11"
                },
                {
                  fact: "Posterior reversible encephalopathy syndrome (PRES) manifests as symmetrical vasogenic subcortical oedema predominantly affecting the parieto-occipital white matter, sparing the calcarine and paramedian occipital cortex.",
                  terms: ["Posterior reversible encephalopathy syndrome", "vasogenic"],
                  source: "Crack the Core Neuro / RDN11"
                },
                {
                  fact: "Osmotic demyelination syndrome demonstrates trident-shaped or symmetrical bat-wing T2/FLAIR hyperintensity and restricted diffusion in the central pons, sparing the peripheral tegmentum and ventrolateral corticospinal tracts.",
                  terms: ["Osmotic demyelination syndrome", "central pons"],
                  source: "Crack the Core Neuro / RDN11"
                },
                {
                  fact: "Wernicke encephalopathy produces symmetric T2/FLAIR hyperintensity in the mammillary bodies, medial thalamic nuclei, periaqueductal grey matter, and tectal plate secondary to thiamine deficiency.",
                  terms: ["Wernicke encephalopathy", "mammillary bodies"],
                  source: "Crack the Core Neuro / RDN11"
                },
                {
                  fact: "Creutzfeldt-Jakob disease exhibits cortical ribboning and bilateral symmetrical hyperintensity in the caudate and putamen on DWI and FLAIR, often producing the pulvinar or hockey-stick sign on thalamic imaging.",
                  terms: ["Creutzfeldt-Jakob disease", "cortical ribboning"],
                  source: "Crack the Core Neuro / RDN11"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "srd-headneck",
      name: "Head and neck",
      modules: [
        {
          id: "srd-hn-skullbase",
          name: "Skull base and temporal bone",
          size: "m",
          topics: [
            {
              id: "srd-hn-skullbase",
              title: "Skull base and temporal bone",
              book: "Crack the Core Head and Neck / RDN11 Skull Base",
              mustKnow: [
                {
                  fact: "Glomus jugulare paraganglioma causes permeative 'moth-eaten' bone destruction of the jugular foramen and characteristic 'salt-and-pepper' appearance on T1/T2 MRI representing slow flow and arterial flow voids.",
                  terms: ["Glomus jugulare", "jugular foramen"],
                  source: "Crack the Core H&N / RDN11"
                },
                {
                  fact: "Acquired middle ear cholesteatoma characteristically originates in Prussak space, erodes the scutum, and exhibits pathognomonic restricted diffusion on non-echo planar diffusion-weighted MRI.",
                  terms: ["cholesteatoma", "Prussak space"],
                  source: "Crack the Core H&N / RDN11"
                },
                {
                  fact: "Fenestral otosclerosis causes bone resorption and lucency anterior to the oval window at the fissula ante fenestram on high-resolution temporal bone CT, resulting in conductive hearing loss.",
                  terms: ["otosclerosis", "fissula ante fenestram"],
                  source: "Crack the Core H&N / RDN11"
                },
                {
                  fact: "Retrocochlear sensorineural hearing loss most frequently results from vestibular schwannoma within the cerebellopontine angle, while retrofenestral otosclerosis produces a pericochlear halo of lucency on CT.",
                  terms: ["sensorineural hearing loss", "vestibular schwannoma"],
                  source: "Crack the Core H&N / RDN11"
                },
                {
                  fact: "Chordoma arises from notochord remnants, classically in the clivus midline, showing severe T2 hyperintensity, destructive lytic bone change, and lobulated 'honeycomb' enhancement.",
                  terms: ["Chordoma", "clivus"],
                  source: "Crack the Core H&N / RDN11"
                },
                {
                  fact: "Chondrosarcoma of the skull base arises off-midline along the petroclival synchondrosis, exhibiting typical 'rings-and-arcs' chondroid matrix calcifications on CT and high T2 signal.",
                  terms: ["Chondrosarcoma", "petroclival synchondrosis"],
                  source: "Crack the Core H&N / RDN11"
                },
                {
                  fact: "Petrous apicitis produces Gradenigo syndrome comprising the clinical triad of retro-orbital pain (trigeminal nerve), abducens nerve palsy, and otorrhea secondary to mastoiditis extension.",
                  terms: ["Gradenigo syndrome", "Petrous apicitis"],
                  source: "Crack the Core H&N / RDN11"
                },
                {
                  fact: "Perineural tumour spread along cranial nerves V and VII manifests on contrast MRI as abnormal nerve thickening, smooth or nodular enhancement, and obliteration of normal neural foramen fat pads.",
                  terms: ["Perineural tumour spread", "cranial nerves"],
                  source: "Crack the Core H&N / RDN11"
                }
              ]
            }
          ]
        },
        {
          id: "srd-hn-neck",
          name: "Sinonasal, pharynx and neck spaces",
          size: "m",
          topics: [
            {
              id: "srd-hn-neck",
              title: "Sinonasal, pharynx and neck spaces",
              book: "Crack the Core Head and Neck / RDN11 Neck Spaces",
              mustKnow: [
                {
                  fact: "Juvenile nasopharyngeal angiofibroma characteristically arises near the sphenopalatine foramen in adolescent males, causing anterior bowing of the posterior wall of the maxillary antrum (Holman-Miller sign).",
                  terms: ["Juvenile nasopharyngeal angiofibroma", "Holman-Miller sign"],
                  source: "Crack the Core H&N / RDN11"
                },
                {
                  fact: "Invasive fungal rhinosinusitis caused by Mucorales or Aspergillus presents in immunocompromised hosts with bone destruction, intrasinus soft tissue, and hypoenhancement indicating devascularized tissue (black turbinate sign).",
                  terms: ["black turbinate sign", "rhinosinusitis"],
                  source: "Crack the Core H&N / RDN11"
                },
                {
                  fact: "Inverted papilloma originates on the lateral nasal wall near the middle turbinate, demonstrating a cerebriform convoluted columnar pattern on T2 and contrast-enhanced T1 MRI, with 10% harbouring squamous cell carcinoma.",
                  terms: ["Inverted papilloma", "cerebriform"],
                  numbers: ["10%"],
                  source: "Crack the Core H&N / RDN11"
                },
                {
                  fact: "Parapharyngeal space tumours are localized by displacement patterns: deep parotid lobe lesions displace parapharyngeal fat anteromedially, whereas carotid space schwannomas displace fat anteriorly.",
                  terms: ["Parapharyngeal space", "parotid"],
                  source: "Crack the Core H&N / RDN11"
                },
                {
                  fact: "Lemierre syndrome is septic thrombophlebitis of the internal jugular vein caused by Fusobacterium necrophorum, classically arising from an oropharyngeal or peritonsillar abscess with septic pulmonary emboli.",
                  terms: ["Lemierre syndrome", "internal jugular vein"],
                  source: "Crack the Core H&N / RDN11"
                },
                {
                  fact: "Laryngeal squamous cell carcinoma invading through thyroid cartilage or cricoid cartilage into extralaryngeal soft tissues upstages the tumour to T4a, precluding organ-preservation radiotherapy.",
                  terms: ["Laryngeal squamous cell carcinoma", "thyroid cartilage"],
                  numbers: ["4"],
                  source: "Crack the Core H&N / RDN11"
                },
                {
                  fact: "Branchial cleft cyst second type is the most common lateral neck cystic mass (95%), located anteromedial to the sternocleidomastoid muscle at the angle of the mandible, lateral to the carotid bifurcation.",
                  terms: ["Branchial cleft cyst", "sternocleidomastoid"],
                  numbers: ["95%"],
                  source: "Crack the Core H&N / RDN11"
                },
                {
                  fact: "Thyroglossal duct cyst represents a midline or paramedian unilocular cyst along the tract of thyroid descent between the foramen cecum and the base of the neck, moving upwards on tongue protrusion.",
                  terms: ["Thyroglossal duct cyst", "foramen cecum"],
                  source: "Crack the Core H&N / RDN11"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "srd-chest",
      name: "Chest",
      modules: [
        {
          id: "srd-chest-ild",
          name: "Diffuse lung disease and HRCT",
          size: "l",
          topics: [
            {
              id: "srd-chest-ild",
              title: "Diffuse lung disease and HRCT",
              book: "Crack the Core Thoracic / RDN11 Interstitial Lung Disease",
              mustKnow: [
                {
                  fact: "Usual interstitial pneumonia (UIP) HRCT pattern is characterized by subpleural, basal predominance with reticular opacities, traction bronchiectasis, and subpleural honeycombing in the absence of inconsistent features.",
                  terms: ["Usual interstitial pneumonia", "honeycombing"],
                  source: "Crack the Core Chest / RDN11"
                },
                {
                  fact: "Nonspecific interstitial pneumonia (NSIP) features bilateral, symmetric, subpleural ground-glass opacities with fine reticulation, classically demonstrating immediate subpleural sparing of the dorsal costophrenic angles.",
                  terms: ["Nonspecific interstitial pneumonia", "subpleural sparing"],
                  source: "Crack the Core Chest / RDN11"
                },
                {
                  fact: "Chronic hypersensitivity pneumonitis shows mid-to-upper lung predominance with poorly defined centrilobular nodules, ground glass, and the 'three-density sign' or 'headcheese sign' on inspiratory and expiratory HRCT.",
                  terms: ["hypersensitivity pneumonitis", "three-density sign"],
                  source: "Crack the Core Chest / RDN11"
                },
                {
                  fact: "Lymphangioleiomyomatosis (LAM) presents almost exclusively in women of reproductive age as numerous thin-walled, round, uniform lung cysts distributed diffusely throughout both lungs with preserved lung volume.",
                  terms: ["Lymphangioleiomyomatosis", "lung cysts"],
                  source: "Crack the Core Chest / RDN11"
                },
                {
                  fact: "Pulmonary Langerhans cell histiocytosis (PLCH) is strongly associated with cigarette smoking (> 95%) and features bizarre, bilobed or cloverleaf-shaped cysts with mid-to-upper lung predominance and sparing of the lung bases.",
                  terms: ["Langerhans cell histiocytosis", "smoking"],
                  numbers: ["95%"],
                  source: "Crack the Core Chest / RDN11"
                },
                {
                  fact: "Pulmonary alveolar proteinosis demonstrates a pathognomonic 'crazy-paving' pattern consisting of patchy ground-glass attenuation with superimposed thickened interlobular and intralobular septa.",
                  terms: ["Pulmonary alveolar proteinosis", "crazy-paving"],
                  source: "Crack the Core Chest / RDN11"
                },
                {
                  fact: "Sarcoidosis on thoracic CT typically manifests as symmetric bilateral hilar and right paratracheal lymphadenopathy with perilymphatic micronodules clustered along bronchovascular bundles, subpleural surfaces, and fissures.",
                  terms: ["Sarcoidosis", "perilymphatic"],
                  source: "Crack the Core Chest / RDN11"
                },
                {
                  fact: "Silicosis exhibits multiple small, well-defined nodules predominantly in upper lobes, posterior segments, frequently progressing to progressive massive fibrosis (PMF) and peripheral 'eggshell' calcification in mediastinal nodes.",
                  terms: ["Silicosis", "eggshell calcification"],
                  source: "Crack the Core Chest / RDN11"
                }
              ]
            }
          ]
        },
        {
          id: "srd-chest-focal",
          name: "Nodules, masses, infection and congenital lesions",
          size: "l",
          topics: [
            {
              id: "srd-chest-focal",
              title: "Nodules, masses, infection and congenital lesions",
              book: "Crack the Core Thoracic / RDN11 Chest Focal",
              mustKnow: [
                {
                  fact: "Fleischner Society 2017 guidelines recommend no routine follow-up for low-risk solid pulmonary nodules smaller than 6 mm in patients aged 35 years or older without smoking history.",
                  terms: ["Fleischner Society", "pulmonary nodules"],
                  numbers: ["2017", "6", "35"],
                  source: "Crack the Core Chest / Fleischner 2017"
                },
                {
                  fact: "Angioinvasive aspergillosis presents in neutropenic patients as a nodule or consolidation surrounded by a rim of ground-glass attenuation reflecting alveolar haemorrhage (CT halo sign).",
                  terms: ["Angioinvasive aspergillosis", "CT halo sign"],
                  source: "Crack the Core Chest / RDN11"
                },
                {
                  fact: "Chronic cavitary pulmonary aspergillosis typically produces an aspergilloma within a pre-existing tuberculous cavity, showing a dependent fungus ball capped by air (Monod sign or air-crescent sign).",
                  terms: ["Monod sign", "aspergilloma"],
                  source: "Crack the Core Chest / RDN11"
                },
                {
                  fact: "Extralobar pulmonary sequestration possesses its own independent visceral pleura and drains systematically into the azygos, hemiazygos, or inferior vena cava, supplied by an aberrant systemic artery from the aorta.",
                  terms: ["pulmonary sequestration", "systemic artery"],
                  source: "Crack the Core Chest / RDN11"
                },
                {
                  fact: "Intralobar pulmonary sequestration shares the visceral pleura of the native lung, occurs predominantly in the left lower lobe (65%), and characteristically drains via pulmonary veins into the left atrium.",
                  terms: ["Intralobar", "pulmonary sequestration"],
                  numbers: ["65%"],
                  source: "Crack the Core Chest / RDN11"
                },
                {
                  fact: "Thymoma is the most common anterior mediastinal mass in adults, appearing as a smooth, rounded or lobulated, homogeneously enhancing mass associated with myasthenia gravis in 30% to 50% of cases.",
                  terms: ["Thymoma", "myasthenia gravis"],
                  numbers: ["30%", "50%"],
                  source: "Crack the Core Chest / RDN11"
                },
                {
                  fact: "Malignant pleural mesothelioma characteristically displays circumferential nodular pleural thickening exceeding 1 cm, mediastinal pleural involvement, and volume contraction of the affected hemithorax.",
                  terms: ["pleural mesothelioma", "circumferential"],
                  numbers: ["1"],
                  source: "Crack the Core Chest / RDN11"
                },
                {
                  fact: "Reversed halo sign or 'atoll sign' consists of a central area of ground-glass opacity surrounded by a crescentic or complete ring of consolidation, highly characteristic of cryptogenic organizing pneumonia.",
                  terms: ["Reversed halo sign", "cryptogenic organizing pneumonia"],
                  source: "Crack the Core Chest / RDN11"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "srd-cardiac",
      name: "Cardiac and vascular",
      modules: [
        {
          id: "srd-cardiac-vascular",
          name: "Cardiac CT and MRI, aorta and great vessels",
          size: "m",
          topics: [
            {
              id: "srd-cardiac-vascular",
              title: "Cardiac CT and MRI, aorta and great vessels",
              book: "Crack the Core Cardiac and Vascular / RDN11",
              mustKnow: [
                {
                  fact: "Late gadolinium enhancement (LGE) on cardiac MRI differentiates ischaemic cardiomyopathy (subendocardial or transmural enhancement conforming to a coronary vascular territory) from non-ischaemic cardiomyopathy (mid-wall or subepicardial enhancement).",
                  terms: ["Late gadolinium enhancement", "ischaemic cardiomyopathy"],
                  source: "Crack the Core Cardiac / RDN11"
                },
                {
                  fact: "Hypertrophic cardiomyopathy characteristically demonstrates patchy mid-wall fibrosis and LGE at the right ventricular insertion points into the hypertrophied interventricular septum.",
                  terms: ["Hypertrophic cardiomyopathy", "interventricular septum"],
                  source: "Crack the Core Cardiac / RDN11"
                },
                {
                  fact: "Cardiac amyloidosis exhibits difficulty nulling normal myocardium on TI scout sequences and diffuse, global subendocardial or transmural LGE with elevated native myocardial T1 values and extracellular volume (ECV > 40%).",
                  terms: ["Cardiac amyloidosis", "extracellular volume"],
                  numbers: ["40%"],
                  source: "Crack the Core Cardiac / RDN11"
                },
                {
                  fact: "Left ventricular non-compaction is diagnosed on end-diastolic cardiac MRI when the ratio of non-compacted to compacted myocardium exceeds 2.3 to 1 (Petersen criteria).",
                  terms: ["Left ventricular non-compaction", "Petersen criteria"],
                  numbers: ["2.3", "1"],
                  source: "Crack the Core Cardiac / RDN11"
                },
                {
                  fact: "Coronary artery calcium (Agatston) scoring on non-contrast ECG-gated CT stratifies cardiovascular risk: a score of 0 represents very low risk, 1 to 99 represents mild risk, 100 to 399 moderate risk, and 400 or greater extensive plaque burden.",
                  terms: ["Agatston", "Coronary artery calcium"],
                  numbers: ["0", "1", "99", "100", "399", "400"],
                  source: "Crack the Core Cardiac / RDN11"
                },
                {
                  fact: "Acute aortic dissection classification distinguishes Stanford type A (involving the ascending aorta, requiring urgent surgical repair) from Stanford type B (confined to the aorta distal to the origin of the left subclavian artery, managed medically unless complicated).",
                  terms: ["Stanford type A", "aortic dissection"],
                  source: "Crack the Core Vascular / RDN11"
                },
                {
                  fact: "Aortic intramural haematoma presents on non-contrast CT as a hyperdense, crescentic, non-enhancing thickening of the aortic wall without an identifiable intimal tear or false lumen flow.",
                  terms: ["intramural haematoma", "false lumen"],
                  source: "Crack the Core Vascular / RDN11"
                },
                {
                  fact: "Acute pulmonary embolism on CT pulmonary angiography appears as a partial or complete intraluminal filling defect forming an acute angle with the vessel wall on axial images, with right ventricular strain defined by RV-to-LV diameter ratio > 1.0.",
                  terms: ["pulmonary embolism", "filling defect"],
                  numbers: ["1.0"],
                  source: "Crack the Core Vascular / RDN11"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "srd-abdomen",
      name: "Abdomen and gastrointestinal",
      modules: [
        {
          id: "srd-abd-liver",
          name: "Liver, biliary tree and pancreas",
          size: "l",
          topics: [
            {
              id: "srd-abd-liver",
              title: "Liver, biliary tree and pancreas",
              book: "Crack the Core Gastrointestinal / RDN11 Liver and Pancreas",
              mustKnow: [
                {
                  fact: "LI-RADS definitive hepatocellular carcinoma (LR-5) criteria on multiphasic CT/MRI include non-rim arterial phase hyperenhancement (APHE) plus non-peripheral washout, enhancing capsule, or threshold growth (>= 50% increase in 6 months).",
                  terms: ["LI-RADS", "hepatocellular carcinoma"],
                  numbers: ["5", "50%", "6"],
                  source: "Crack the Core GI / LI-RADS v2018"
                },
                {
                  fact: "Hepatic haemangioma typically exhibits peripheral nodular discontinuous arterial puddling with progressive, centripetal fill-in that matches blood pool attenuation on portal venous and delayed phases.",
                  terms: ["Hepatic haemangioma", "centripetal"],
                  source: "Crack the Core GI / RDN11"
                },
                {
                  fact: "Focal nodular hyperplasia demonstrates intense homogeneous arterial enhancement, near-isointensity on portal venous phase, and a central stellate fibrous scar that exhibits delayed contrast enhancement.",
                  terms: ["Focal nodular hyperplasia", "stellate scar"],
                  source: "Crack the Core GI / RDN11"
                },
                {
                  fact: "Budd-Chiari syndrome results from hepatic venous outflow obstruction, demonstrating poor peripheral perfusion, massive caudate lobe hypertrophy, and a 'flip-flop' pattern of enhancement with central enhancement and peripheral hypoperfusion.",
                  terms: ["Budd-Chiari syndrome", "caudate lobe"],
                  source: "Crack the Core GI / RDN11"
                },
                {
                  fact: "Perihilar cholangiocarcinoma (Klatskin tumour) characteristically manifests on MRCP/CT as an infiltrating mass at the hepatic duct confluence causing marked intrahepatic biliary ductal dilation with non-dilated extrahepatic ducts.",
                  terms: ["Klatskin tumour", "cholangiocarcinoma"],
                  source: "Crack the Core GI / RDN11"
                },
                {
                  fact: "Autoimmune pancreatitis (type 1) features diffuse sausage-like pancreatic enlargement with loss of lobular architecture, a hypoattenuating capsule-like rim, and delayed parenchymal enhancement with elevated serum IgG4.",
                  terms: ["Autoimmune pancreatitis", "IgG4"],
                  numbers: ["1", "4"],
                  source: "Crack the Core GI / RDN11"
                },
                {
                  fact: "Pancreatic ductal adenocarcinoma typically presents on dual-phase CT as a hypoattenuating, hypovascular mass in the pancreatic head causing the 'double-duct sign' with simultaneous dilation of the common bile duct and main pancreatic duct.",
                  terms: ["Pancreatic ductal adenocarcinoma", "double-duct sign"],
                  source: "Crack the Core GI / RDN11"
                },
                {
                  fact: "Mucinous cystic neoplasm of the pancreas arises almost exclusively in women (95%), located in the pancreatic body or tail, and features thick internal septations with pathognomonic ovarian-type stroma on histopathology.",
                  terms: ["Mucinous cystic neoplasm", "ovarian-type stroma"],
                  numbers: ["95%"],
                  source: "Crack the Core GI / RDN11"
                }
              ]
            }
          ]
        },
        {
          id: "srd-abd-bowel",
          name: "Bowel, peritoneum and acute abdomen",
          size: "m",
          topics: [
            {
              id: "srd-abd-bowel",
              title: "Bowel, peritoneum and acute abdomen",
              book: "Crack the Core Gastrointestinal / RDN11 Bowel",
              mustKnow: [
                {
                  fact: "Small bowel obstruction on CT is diagnosed by dilated small bowel loops (> 2.5 cm) proximal to a discrete transition zone with collapsed distal bowel, where the 'small bowel faeces sign' indicates subacute stasis.",
                  terms: ["Small bowel obstruction", "transition zone"],
                  numbers: ["2.5"],
                  source: "Crack the Core GI / RDN11"
                },
                {
                  fact: "Gallstone ileus features Rigler triad on plain radiography or CT: small bowel obstruction, pneumobilia, and an ectopic gallstone within the bowel lumen, most commonly impacted at the ileocaecal valve.",
                  terms: ["Rigler triad", "Gallstone ileus"],
                  source: "Crack the Core GI / RDN11"
                },
                {
                  fact: "Superior mesenteric artery (SMA) syndrome causes acute or subacute duodenal obstruction where the third part of the duodenum is compressed by a narrowed aortomesenteric angle (< 22 degrees) and distance (< 8 mm).",
                  terms: ["SMA syndrome", "aortomesenteric angle"],
                  numbers: ["22", "8"],
                  source: "Crack the Core GI / RDN11"
                },
                {
                  fact: "Acute mesenteric ischaemia demonstrates bowel wall hypoenhancement or non-enhancement, bowel wall thickening, mesenteric stranding, and pathognomonic pneumatosis intestinalis with portovenous gas in advanced transmural necrosis.",
                  terms: ["mesenteric ischaemia", "pneumatosis intestinalis"],
                  source: "Crack the Core GI / RDN11"
                },
                {
                  fact: "Acute appendicitis on contrast-enhanced CT is diagnosed when the appendiceal diameter exceeds 6 mm with circumferential wall thickening, mural hyperenhancement, periappendiceal fat stranding, and frequent appendicolith.",
                  terms: ["appendicitis", "appendicolith"],
                  numbers: ["6"],
                  source: "Crack the Core GI / RDN11"
                },
                {
                  fact: "Crohn disease on CT or MR enterography displays transmural wall thickening, mucosal hyperenhancement, submucosal oedema, skip lesions, the 'comb sign' reflecting engorged vasa recta, and fibrostenotic strictures.",
                  terms: ["Crohn disease", "comb sign"],
                  source: "Crack the Core GI / RDN11"
                },
                {
                  fact: "Pneumoperitoneum on supine abdominal radiograph manifests as the Rigler sign (visualization of both inner and outer surfaces of the bowel wall) and the football sign (large oval gas collection outlining the peritoneal cavity).",
                  terms: ["Pneumoperitoneum", "Rigler sign"],
                  source: "Crack the Core GI / RDN11"
                },
                {
                  fact: "Epiploic appendagitis presents on CT as an oval fat-attenuation lesion (< 5 cm) with a hyperdense peripheral rim and central dot sign, located adjacent to the anterior colonic wall with self-limiting inflammation.",
                  terms: ["Epiploic appendagitis", "central dot sign"],
                  numbers: ["5"],
                  source: "Crack the Core GI / RDN11"
                }
              ]
            }
          ]
        },
        {
          id: "srd-abd-peritoneum",
          name: "Peritoneum, mesentery, retroperitoneum and abdominal wall",
          size: "m",
          topics: [
            {
              id: "srd-abd-peritoneum",
              title: "Peritoneum, mesentery, retroperitoneum and abdominal wall",
              book: "Crack the Core Abdominal / RDN11 Peritoneum",
              mustKnow: [
                {
                  fact: "Peritoneal carcinomatosis characteristically manifests on CT as scalloping of the hepatic or splenic margin, ascites, peritoneal nodularity, and diffuse thickening of the greater omentum forming an 'omental cake'.",
                  terms: ["Peritoneal carcinomatosis", "omental cake"],
                  source: "Crack the Core GI / RDN11"
                },
                {
                  fact: "Pseudomyxoma peritonei produces gelatinous ascites that causes extrinsic scalloping of visceral surfaces, especially the liver and spleen, characteristically sparing the small bowel parenchyma.",
                  terms: ["Pseudomyxoma peritonei", "scalloping"],
                  source: "Crack the Core GI / RDN11"
                },
                {
                  fact: "Mesenteric panniculitis manifests on CT as an encapsulated mass of increased mesenteric fat attenuation ('misty mesentery') that preserves a halo of normal fat around vessels (fat ring sign) with small lymph nodes.",
                  terms: ["Mesenteric panniculitis", "fat ring sign"],
                  source: "Crack the Core GI / RDN11"
                },
                {
                  fact: "Retroperitoneal fibrosis (Ormond disease) appears on CT/MRI as a plaque-like retroperitoneal soft-tissue mass enveloping the aorta and inferior vena cava from L4 to S1, causing medial deviation of the ureters.",
                  terms: ["Retroperitoneal fibrosis", "Ormond disease"],
                  numbers: ["4", "1"],
                  source: "Crack the Core GI / RDN11"
                },
                {
                  fact: "Mesenteric desmoid tumour (aggressive fibromatosis) presents on CT as a well-circumscribed, non-metastasizing, collagen-dense fibrous mass with high attenuation, strongly associated with Gardner syndrome and prior abdominal surgery.",
                  terms: ["desmoid tumour", "Gardner syndrome"],
                  source: "Crack the Core GI / RDN11"
                },
                {
                  fact: "Primary retroperitoneal liposarcoma is distinguished on CT/MRI between well-differentiated liposarcoma (predominantly macroscopic fat with thick nodular septa > 2 mm) and dedifferentiated liposarcoma (non-lipomatous solid nodules > 1 cm).",
                  terms: ["liposarcoma", "well-differentiated"],
                  numbers: ["2", "1"],
                  source: "Crack the Core GI / RDN11"
                },
                {
                  fact: "Inferior vena cava leiomyosarcoma is the most common primary IVC malignancy, typically presenting as an expansive intraluminal soft-tissue mass in middle-aged women that extends into hepatic or renal veins.",
                  terms: ["Inferior vena cava", "leiomyosarcoma"],
                  source: "Crack the Core GI / RDN11"
                },
                {
                  fact: "Perianal fistula MRI on high-resolution T2 and post-contrast sequences assesses the relation of the tract to the external anal sphincter according to the St James University Hospital classification grades 1 to 5.",
                  terms: ["Perianal fistula", "external anal sphincter"],
                  numbers: ["1", "5"],
                  source: "Crack the Core GI / RDN11"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "srd-gu",
      name: "Genitourinary and adrenal",
      modules: [
        {
          id: "srd-gu-kidney",
          name: "Kidney, adrenal and urinary tract",
          size: "l",
          topics: [
            {
              id: "srd-gu-kidney",
              title: "Kidney, adrenal and urinary tract",
              book: "Crack the Core Genitourinary / RDN11 Renal and Adrenal",
              mustKnow: [
                {
                  fact: "Bosniak classification 2019 categorizes cystic renal masses into Bosniak I (simple cyst), II (minimally complicated benign), IIF (minimally complex requiring follow-up), III (indeterminate, 50% malignant), and IV (clearly malignant cystic mass with enhancing solid nodules).",
                  terms: ["Bosniak classification", "renal masses"],
                  numbers: ["2019", "50%"],
                  source: "Crack the Core GU / Bosniak 2019"
                },
                {
                  fact: "Clear cell renal cell carcinoma (70% of RCC) shows intense, heterogeneous cortical nephrographic enhancement on CT, with frequent microscopic intracellular lipid causing signal dropout on out-of-phase chemical shift MRI.",
                  terms: ["Clear cell renal cell carcinoma", "chemical shift"],
                  numbers: ["70%"],
                  source: "Crack the Core GU / RDN11"
                },
                {
                  fact: "Renal angiomyolipoma classic type contains macroscopic fat demonstrating attenuation values below negative 20 Hounsfield units on non-contrast CT, associated with tuberous sclerosis when multiple and bilateral.",
                  terms: ["angiomyolipoma", "macroscopic fat"],
                  numbers: ["20"],
                  source: "Crack the Core GU / RDN11"
                },
                {
                  fact: "Emphysematous pyelonephritis is a life-threatening gas-forming parenchymal infection in diabetics characterized by necrotizing gas in the renal parenchyma on CT (type 1 dry streaky gas or type 2 bubbly gas with fluid collections).",
                  terms: ["Emphysematous pyelonephritis", "renal parenchyma"],
                  numbers: ["1", "2"],
                  source: "Crack the Core GU / RDN11"
                },
                {
                  fact: "Xanthogranulomatous pyelonephritis manifests as chronic destructive granulomatous infection, characteristically showing the 'bear paw sign' on CT with multiple caliceal fluid collections radiating from a central staghorn calculus.",
                  terms: ["Xanthogranulomatous pyelonephritis", "bear paw sign"],
                  source: "Crack the Core GU / RDN11"
                },
                {
                  fact: "Adrenal adenoma on unenhanced CT has attenuation <= 10 Hounsfield units due to intracytoplasmic lipid, and on contrast washout CT displays absolute percentage washout >= 60% or relative percentage washout >= 40% at 15 minutes.",
                  terms: ["Adrenal adenoma", "percentage washout"],
                  numbers: ["10", "60%", "40%", "15"],
                  source: "Crack the Core GU / RDN11"
                },
                {
                  fact: "Pheochromocytoma follows the '10% rule' (10% bilateral, 10% extra-adrenal, 10% malignant, 10% familial) and classically demonstrates marked T2 hyperintensity ('lightbulb sign') and intense contrast enhancement.",
                  terms: ["Pheochromocytoma", "lightbulb sign"],
                  numbers: ["10%"],
                  source: "Crack the Core GU / RDN11"
                },
                {
                  fact: "Adrenocortical carcinoma characteristically presents as a large, heterogeneous adrenal mass (> 5 cm) with necrosis, haemorrhage, calcifications (30%), and sluggish contrast washout.",
                  terms: ["Adrenocortical carcinoma", "calcifications"],
                  numbers: ["5", "30%"],
                  source: "Crack the Core GU / RDN11"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "srd-msk",
      name: "Musculoskeletal",
      modules: [
        {
          id: "srd-msk-tumour",
          name: "Bone and soft-tissue tumours",
          size: "m",
          topics: [
            {
              id: "srd-msk-tumour",
              title: "Bone and soft-tissue tumours",
              book: "Crack the Core Musculoskeletal / RDN11 Bone Tumours",
              mustKnow: [
                {
                  fact: "Osteoid osteoma is a benign bone-forming lesion (< 1.5 cm) featuring a radiolucent nidus surrounded by dense reactive cortical sclerosis on CT, classically relieved by aspirin or NSAIDs.",
                  terms: ["Osteoid osteoma", "nidus"],
                  numbers: ["1.5"],
                  source: "Crack the Core MSK / RDN11"
                },
                {
                  fact: "Osteosarcoma conventional intramedullary type occurs predominantly in adolescents around the knee, exhibiting a mixed lytic-sclerotic appearance with cloud-like osteoid matrix and aggressive periosteal reaction including Codman triangle and sunburst spiculation.",
                  terms: ["Osteosarcoma", "Codman triangle"],
                  source: "Crack the Core MSK / RDN11"
                },
                {
                  fact: "Ewing sarcoma characteristically affects children and young adults in the diaphysis or metadiaphysis of long bones, producing a permeative lytic lesion with laminated 'onion-skin' periosteal reaction and large soft-tissue mass.",
                  terms: ["Ewing sarcoma", "onion-skin"],
                  source: "Crack the Core MSK / RDN11"
                },
                {
                  fact: "Giant cell tumour of bone is an eccentric, purely lytic epiphyseal lesion abutting the articular cartilage in skeletally mature patients (aged 20 to 40), without a sclerotic margin or periosteal reaction.",
                  terms: ["Giant cell tumour", "epiphyseal"],
                  numbers: ["20", "40"],
                  source: "Crack the Core MSK / RDN11"
                },
                {
                  fact: "Aneurysmal bone cyst (ABC) is an expansile, multilocular lytic lesion with thin cortical 'blow-out' shell, characteristically exhibiting multiple internal fluid-fluid levels on MRI representing settled blood products.",
                  terms: ["Aneurysmal bone cyst", "fluid-fluid levels"],
                  source: "Crack the Core MSK / RDN11"
                },
                {
                  fact: "Enchondroma is a benign medullary hyaline cartilage tumour of short tubular bones and long bones, characterized by arcs and rings of chondroid matrix calcification without endosteal scalloping > 50% or cortical destruction.",
                  terms: ["Enchondroma", "chondroid matrix"],
                  numbers: ["50%"],
                  source: "Crack the Core MSK / RDN11"
                },
                {
                  fact: "Chondrosarcoma conventional type is differentiated from enchondroma in adults by deep endosteal scalloping (> two-thirds cortical thickness), cortical breakthrough, soft-tissue mass, and severe resting bone pain.",
                  terms: ["Chondrosarcoma", "endosteal scalloping"],
                  source: "Crack the Core MSK / RDN11"
                },
                {
                  fact: "Non-ossifying fibroma (fibrous cortical defect) is an eccentric, well-circumscribed lytic lesion in the metaphysis of long bones in children, featuring a thin sclerotic scalloped border ('soap-bubble' appearance) that spontaneously ossifies with skeletal maturity.",
                  terms: ["Non-ossifying fibroma", "soap-bubble"],
                  source: "Crack the Core MSK / RDN11"
                }
              ]
            }
          ]
        },
        {
          id: "srd-msk-joint",
          name: "Joints, spine, infection and trauma",
          size: "m",
          topics: [
            {
              id: "srd-msk-joint",
              title: "Joints, spine, infection and trauma",
              book: "Crack the Core Musculoskeletal / RDN11 Joints and Spine",
              mustKnow: [
                {
                  fact: "Tenosynovial giant cell tumour (pigmented villonodular synovitis) causes synovial proliferation and joint effusion with marked blooming artefact on gradient-echo T2* MRI due to extensive haemosiderin deposition.",
                  terms: ["Tenosynovial giant cell tumour", "blooming artefact"],
                  source: "Crack the Core MSK / RDN11"
                },
                {
                  fact: "Spinal tuberculosis (Pott spine) characteristically causes anterior subligamentous spread, destruction of adjacent vertebral endplates with disk space narrowing, large calcified paraspinal cold abscesses, and angular kyphosis.",
                  terms: ["Spinal tuberculosis", "Pott spine"],
                  source: "Crack the Core MSK / RDN11"
                },
                {
                  fact: "Pyogenic spondylodiscitis features rapid endplate erosion, hyperintensity on T2/STIR within the intervertebral disc and adjacent vertebral bodies, and prompt disc enhancement distinguishing it from degenerative Modic type 1 changes.",
                  terms: ["spondylodiscitis", "Modic type 1"],
                  numbers: ["1"],
                  source: "Crack the Core MSK / RDN11"
                },
                {
                  fact: "Ankylosing spondylitis characteristically starts as bilateral symmetric sacroiliitis progressing to squaring of vertebral bodies, shiny corners (Romanus lesions), and marginal syndesmophytes producing a 'bamboo spine'.",
                  terms: ["Ankylosing spondylitis", "bamboo spine"],
                  source: "Crack the Core MSK / RDN11"
                },
                {
                  fact: "Rheumatoid arthritis of the cervical spine causes transverse ligament laxity and erosions of the odontoid process, resulting in atlantoaxial subluxation defined by an anterior atlanto-dens interval (AADI) > 3 mm in adults.",
                  terms: ["Rheumatoid arthritis", "atlantoaxial subluxation"],
                  numbers: ["3"],
                  source: "Crack the Core MSK / RDN11"
                },
                {
                  fact: "Anterior cruciate ligament (ACL) tear on knee MRI is diagnosed by non-visualization of normal low-signal fibres, fluid signal traversing the ligament substance, and secondary signs including kissing bone contusions of the lateral femoral condyle and posterior lateral tibial plateau.",
                  terms: ["Anterior cruciate ligament", "kissing bone contusions"],
                  source: "Crack the Core MSK / RDN11"
                },
                {
                  fact: "Meniscal tears on knee MRI require intrameniscal high T2/PD signal unequivocally contacting the superior or inferior articular surface on at least 2 contiguous slices (the 'two-slice touch' rule).",
                  terms: ["Meniscal tears", "two-slice touch"],
                  numbers: ["2"],
                  source: "Crack the Core MSK / RDN11"
                },
                {
                  fact: "Osteochondritis dissecans involves focal subchondral bone necrosis and separation, most commonly affecting the lateral aspect of the medial femoral condyle, where high T2 fluid undercutting the osteochondral fragment indicates instability.",
                  terms: ["Osteochondritis dissecans", "femoral condyle"],
                  source: "Crack the Core MSK / RDN11"
                }
              ]
            }
          ]
        },
        {
          id: "srd-msk-metabolic",
          name: "Metabolic, haematological and infective bone disease",
          size: "m",
          topics: [
            {
              id: "srd-msk-metabolic",
              title: "Metabolic, haematological and infective bone disease",
              book: "Crack the Core Musculoskeletal / RDN11 Metabolic Bone",
              mustKnow: [
                {
                  fact: "Paget disease of bone progresses through osteolytic (blade of grass or candle-flame sign), mixed, and osteosclerotic phases, showing cortical thickening, coarsened trabeculae, bone enlargement, and increased risk of osteosarcoma (1%).",
                  terms: ["Paget disease", "blade of grass"],
                  numbers: ["1%"],
                  source: "Crack the Core MSK / RDN11"
                },
                {
                  fact: "Hyperparathyroidism produces subperiosteal bone resorption pathognomonically on the radial aspect of the middle phalanges of the 2nd and 3rd fingers, rugger-jersey spine, and lytic brown tumours.",
                  terms: ["Hyperparathyroidism", "rugger-jersey spine"],
                  numbers: ["2", "3"],
                  source: "Crack the Core MSK / RDN11"
                },
                {
                  fact: "Renal osteodystrophy combines osteomalacia, secondary hyperparathyroidism, and osteosclerosis, classically exhibiting vascular calcification, subchondral resorption, and tumoral calcinosis.",
                  terms: ["Renal osteodystrophy", "tumoral calcinosis"],
                  source: "Crack the Core MSK / RDN11"
                },
                {
                  fact: "Fibrous dysplasia manifests as an expansile medullary lesion with a characteristic 'ground-glass' matrix, smooth endosteal scalloping, and rind of sclerosis, potentially causing a shepherd crook deformity of the proximal femur.",
                  terms: ["Fibrous dysplasia", "shepherd crook"],
                  source: "Crack the Core MSK / RDN11"
                },
                {
                  fact: "Sickle cell anaemia on bone radiography displays marrow hyperplasia (hair-on-end skull appearance, H-shaped vertebrae with central endplate depression), bone infarction, and salmonella osteomyelitis.",
                  terms: ["Sickle cell anaemia", "H-shaped vertebrae"],
                  source: "Crack the Core MSK / RDN11"
                },
                {
                  fact: "Bone infarction (osteonecrosis) demonstrates a serpiginous, calcified sclerotic margin on radiographs and a pathognomonic 'double-line sign' on T2-weighted MRI consisting of an outer hypointense rim and inner hyperintense granulation rim.",
                  terms: ["Bone infarction", "double-line sign"],
                  source: "Crack the Core MSK / RDN11"
                },
                {
                  fact: "Chronic osteomyelitis exhibits a sequestrum (island of necrotic bone), an involucrum (surrounding thick shell of reactive periosteal bone), and a cloaca (cortical defect draining pus).",
                  terms: ["osteomyelitis", "sequestrum"],
                  source: "Crack the Core MSK / RDN11"
                },
                {
                  fact: "Haemophilic arthropathy results from recurrent intra-articular haemarthrosis, showing synovial haemosiderin deposition, epiphyseal overgrowth, squaring of the inferior patella, and enlargement of the intercondylar notch.",
                  terms: ["Haemophilic arthropathy", "intercondylar notch"],
                  source: "Crack the Core MSK / RDN11"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "srd-breast-sec",
      name: "Breast",
      modules: [
        {
          id: "srd-breast",
          name: "Breast imaging",
          size: "m",
          topics: [
            {
              id: "srd-breast",
              title: "Breast imaging",
              book: "Crack the Core Breast Imaging / RDN11 Breast",
              mustKnow: [
                {
                  fact: "BI-RADS assessment categories range from 0 (incomplete, needs additional imaging) to 6 (known biopsy-proven malignancy), with BI-RADS 3 conveying <= 2% risk of malignancy managed by short-interval follow-up.",
                  terms: ["BI-RADS", "short-interval follow-up"],
                  numbers: ["0", "6", "3", "2%"],
                  source: "Crack the Core Breast / BI-RADS 5th Ed"
                },
                {
                  fact: "BI-RADS 4 encompasses suspicious lesions (> 2% to < 95% malignancy risk) subdivided into 4A (2% to 10%), 4B (10% to 50%), and 4C (50% to 95%), all requiring tissue biopsy.",
                  terms: ["BI-RADS", "biopsy"],
                  numbers: ["4", "2%", "95%", "10%", "50%"],
                  source: "Crack the Core Breast / BI-RADS 5th Ed"
                },
                {
                  fact: "Mammographic microcalcifications with high predictive value for ductal carcinoma in situ (DCIS) include fine pleomorphic and fine linear branching calcifications in a segmental or linear distribution.",
                  terms: ["microcalcifications", "ductal carcinoma in situ"],
                  source: "Crack the Core Breast / RDN11"
                },
                {
                  fact: "Invasive ductal carcinoma typically presents on mammography as a dense, high-attenuation spicular mass with architectural distortion, while on ultrasound it appears as a hypoechoic mass that is taller than wide with posterior acoustic shadowing.",
                  terms: ["Invasive ductal carcinoma", "taller than wide"],
                  source: "Crack the Core Breast / RDN11"
                },
                {
                  fact: "Invasive lobular carcinoma is characteristically subtle on mammography due to its infiltrative single-file growth pattern, frequently presenting only as architectural distortion or asymmetric density without a focal mass.",
                  terms: ["Invasive lobular carcinoma", "architectural distortion"],
                  source: "Crack the Core Breast / RDN11"
                },
                {
                  fact: "Fibroadenoma on breast ultrasound characteristically appears as an oval or gently lobulated, circumscribed, hypoechoic solid mass oriented parallel to the skin (wider than tall) with thin pseudocapsule.",
                  terms: ["Fibroadenoma", "wider than tall"],
                  source: "Crack the Core Breast / RDN11"
                },
                {
                  fact: "Phyllodes tumour resembles a large, rapidly growing fibroadenoma on mammography and ultrasound, distinguished by older patient age (aged 40 to 50) and cystic clefts or internal fluid spaces on ultrasound.",
                  terms: ["Phyllodes tumour", "cystic clefts"],
                  numbers: ["40", "50"],
                  source: "Crack the Core Breast / RDN11"
                },
                {
                  fact: "Dynamic contrast-enhanced breast MRI kinetic curve assessment categorizes wash-out kinetics into Type 1 (persistent continuous enhancement, benign), Type 2 (plateau, intermediate), and Type 3 (rapid wash-out, high risk for malignancy).",
                  terms: ["kinetic curve", "breast MRI"],
                  numbers: ["1", "2", "3"],
                  source: "Crack the Core Breast / BI-RADS MRI"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "srd-paeds-sec",
      name: "Paediatric radiology",
      modules: [
        {
          id: "srd-paeds",
          name: "Paediatric radiology",
          size: "m",
          topics: [
            {
              id: "srd-paeds",
              title: "Paediatric radiology",
              book: "Crack the Core Paediatric / RDN11 Paediatric Radiology",
              mustKnow: [
                {
                  fact: "Intussusception in infants typically presents at the ileocolic junction, demonstrating the pathognomonic 'target sign' or 'doughnut sign' on transverse ultrasound and 'pseudokidney sign' on longitudinal imaging.",
                  terms: ["Intussusception", "target sign"],
                  source: "Crack the Core Paeds / RDN11"
                },
                {
                  fact: "Midgut volvulus complicates intestinal malrotation and produces the characteristic 'whirlpool sign' on ultrasound or CT as the superior mesenteric vein and mesentery wrap clockwise around the superior mesenteric artery.",
                  terms: ["Midgut volvulus", "whirlpool sign"],
                  source: "Crack the Core Paeds / RDN11"
                },
                {
                  fact: "Hypertrophic pyloric stenosis is confirmed on ultrasound when pyloric muscle wall thickness >= 3 mm and channel length >= 14 mm in an infant with non-bilious projectile vomiting.",
                  terms: ["Hypertrophic pyloric stenosis", "channel length"],
                  numbers: ["3", "14"],
                  source: "Crack the Core Paeds / RDN11"
                },
                {
                  fact: "Congenital diaphragmatic hernia (Bochdalek hernia) occurs predominantly on the left side (85%) through the posterolateral pleuroperitoneal canal, displacing the mediastinum to the contralateral side and causing pulmonary hypoplasia.",
                  terms: ["Bochdalek hernia", "pulmonary hypoplasia"],
                  numbers: ["85%"],
                  source: "Crack the Core Paeds / RDN11"
                },
                {
                  fact: "Necrotizing enterocolitis in premature neonates manifests radiographically as fixed dilated bowel loops, pneumatosis intestinalis, branching portal venous gas, and pneumoperitoneum.",
                  terms: ["Necrotizing enterocolitis", "pneumatosis intestinalis"],
                  source: "Crack the Core Paeds / RDN11"
                },
                {
                  fact: "Neuroblastoma originates from neural crest cells in the adrenal medulla or sympathetic chain, encasing and displacing abdominal vessels without invading vessel lumina, with calcifications in > 85% on CT.",
                  terms: ["Neuroblastoma", "vessels"],
                  numbers: ["85%"],
                  source: "Crack the Core Paeds / RDN11"
                },
                {
                  fact: "Wilms tumour (nephroblastoma) is an intrarenal mass that arises from metanephric blastema, displaces adjacent structures by pushing margins ('claw sign'), rarely encases vessels, and frequently invades the renal vein and IVC.",
                  terms: ["Wilms tumour", "claw sign"],
                  source: "Crack the Core Paeds / RDN11"
                },
                {
                  fact: "Non-accidental injury (child abuse) has high diagnostic specificity for metaphyseal corner fractures ('bucket-handle' fractures), posterior rib fractures, spinous process fractures, and classic subdural haematomas of varying ages.",
                  terms: ["bucket-handle", "Non-accidental injury"],
                  source: "Crack the Core Paeds / RDN11"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "srd-ir-sec",
      name: "Interventional radiology",
      modules: [
        {
          id: "srd-ir",
          name: "Vascular and non-vascular intervention",
          size: "m",
          topics: [
            {
              id: "srd-ir",
              title: "Vascular and non-vascular intervention",
              book: "Handbook of Interventional Radiology / RDN11 IR",
              mustKnow: [
                {
                  fact: "Transjugular intrahepatic portosystemic shunt (TIPS) creates a low-resistance conduit between the right hepatic vein and right portal vein to decompress portal hypertension, targeting a post-procedure portosystemic gradient < 12 mmHg.",
                  terms: ["Transjugular intrahepatic portosystemic shunt", "portosystemic gradient"],
                  numbers: ["12"],
                  source: "Crack the Core IR / RDN11"
                },
                {
                  fact: "Endovascular embolisation agents are classified into temporary mechanical agents (gelatin sponge/Gelfoam, lasting 2 to 6 weeks) and permanent agents (metallic coils, polyvinyl alcohol particles, n-butyl cyanoacrylate, and Onyx liquid embolic copolymer).",
                  terms: ["embolisation agents", "Gelfoam"],
                  numbers: ["2", "6"],
                  source: "Crack the Core IR / RDN11"
                },
                {
                  fact: "Iatrogenic femoral pseudoaneurysm exhibits characteristic 'yin-yang sign' on color Doppler ultrasound due to swirling bidirectional flow, and when neck anatomy is favourable, ultrasound-guided percutaneous thrombin injection achieves > 95% thrombosis.",
                  terms: ["pseudoaneurysm", "yin-yang sign"],
                  numbers: ["95%"],
                  source: "Crack the Core IR / RDN11"
                },
                {
                  fact: "Transarterial chemoembolisation (TACE) combines intra-arterial infusion of chemotherapy (doxorubicin or cisplatin emulsified in Lipiodol) followed by particulate embolisation to induce selective ischemic necrosis of hypervascular hepatocellular carcinoma.",
                  terms: ["Transarterial chemoembolisation", "Lipiodol"],
                  source: "Crack the Core IR / RDN11"
                },
                {
                  fact: "Percutaneous radiofrequency ablation (RFA) and microwave ablation (MWA) induce thermal coagulative necrosis of hepatic tumours, requiring a minimum 5 to 10 mm ablative margin of normal liver parenchyma to prevent local recurrence.",
                  terms: ["radiofrequency ablation", "ablative margin"],
                  numbers: ["5", "10"],
                  source: "Crack the Core IR / RDN11"
                },
                {
                  fact: "May-Thurner syndrome (iliac vein compression syndrome) involves extrinsic compression of the left common iliac vein by the overlying right common iliac artery against the fifth lumbar vertebra, treated with endovascular self-expanding nitinol stenting.",
                  terms: ["May-Thurner syndrome", "iliac vein"],
                  numbers: ["5"],
                  source: "Crack the Core IR / RDN11"
                },
                {
                  fact: "Percutaneous transhepatic biliary drainage (PTBD) is performed by fluoroscopic or ultrasound-guided puncture of a peripheral bile duct (ideally segment 3 on the left or segment 6 on the right) to decompress obstructive jaundice.",
                  terms: ["biliary drainage", "obstructive jaundice"],
                  numbers: ["3", "6"],
                  source: "Crack the Core IR / RDN11"
                },
                {
                  fact: "Inferior vena cava (IVC) filter placement requires the apex of the conical filter to be positioned immediately below the lowest renal vein orifice to prevent renal vein thrombosis and filter tilting.",
                  terms: ["Inferior vena cava filter", "renal vein"],
                  source: "Crack the Core IR / RDN11"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "srd-nm-physics",
      name: "Nuclear medicine, physics and safety",
      modules: [
        {
          id: "srd-nuclear",
          name: "Nuclear medicine and PET",
          size: "m",
          topics: [
            {
              id: "srd-nuclear",
              title: "Nuclear medicine and PET",
              book: "Crack the Core Nuclear Medicine / RDN11 Physics",
              mustKnow: [
                {
                  fact: "Technetium-99m methylene diphosphonate (Tc-99m MDP) bone scintigraphy incorporates into hydroxyapatite crystals via chemisorption in areas of osteoblastic bone turnover.",
                  terms: ["bone scintigraphy", "hydroxyapatite"],
                  numbers: ["99"],
                  source: "Crack the Core Nuclear / RDN11"
                },
                {
                  fact: "Metabolic 'superscan' on Tc-99m MDP bone scintigraphy demonstrates intensely increased diffuse skeletal uptake with markedly diminished or absent renal and soft-tissue background excretion, caused by diffuse osteoblastic metastases (prostate, breast) or hyperparathyroidism.",
                  terms: ["superscan", "bone scintigraphy"],
                  numbers: ["99"],
                  source: "Crack the Core Nuclear / RDN11"
                },
                {
                  fact: "Fluorine-18 fluorodeoxyglucose (F-18 FDG) PET assesses cellular glucose metabolism via glucose transporters (GLUT-1) and hexokinase trapping as FDG-6-phosphate, where physiological brown fat uptake is prevented by maintaining patient warmth.",
                  terms: ["fluorodeoxyglucose", "hexokinase"],
                  numbers: ["18", "1", "6"],
                  source: "Crack the Core Nuclear / RDN11"
                },
                {
                  fact: "Gallium-68 PSMA PET-CT demonstrates superior diagnostic sensitivity and specificity over conventional imaging for detecting biochemical recurrence of prostate adenocarcinoma at low serum PSA levels (< 0.5 ng/mL).",
                  terms: ["PSMA PET", "prostate adenocarcinoma"],
                  numbers: ["68", "0.5"],
                  source: "Crack the Core Nuclear / RDN11"
                },
                {
                  fact: "Technetium-99m pertechnetate thyroid scintigraphy differentiates Graves disease (diffuse, homogeneously elevated uptake > 4%) from subacute thyroiditis or factitious thyrotoxicosis (markedly suppressed or absent uptake < 1%).",
                  terms: ["thyroid scintigraphy", "Graves disease"],
                  numbers: ["99", "4%", "1%"],
                  source: "Crack the Core Nuclear / RDN11"
                },
                {
                  fact: "Technetium-99m MAG3 evaluates renal tubular secretion and effective renal plasma flow, whereas Tc-99m DTPA clearance reflects glomerular filtration rate (GFR).",
                  terms: ["renal scintigraphy", "glomerular filtration rate"],
                  numbers: ["99"],
                  source: "Crack the Core Nuclear / RDN11"
                },
                {
                  fact: "Ventilation-perfusion (V/Q) scintigraphy using inhaled Xe-133 or Tc-99m DTPA aerosol alongside IV Tc-99m MAA diagnoses pulmonary embolism by identifying a 'mismatched' segmental or subsegmental perfusion defect with normal ventilation.",
                  terms: ["scintigraphy", "pulmonary embolism"],
                  numbers: ["133", "99"],
                  source: "Crack the Core Nuclear / RDN11"
                },
                {
                  fact: "Radionuclide physical half-lives must be recognized: Technetium-99m has a half-life of 6.0 hours, Fluorine-18 is 110 minutes, Iodine-131 is 8.0 days, and Gallium-68 is 68 minutes.",
                  terms: ["half-life", "Technetium-99m"],
                  numbers: ["99", "6.0", "18", "110", "131", "8.0", "68"],
                  source: "Crack the Core Nuclear / RDN11"
                }
              ]
            }
          ]
        },
        {
          id: "srd-physics",
          name: "Physics, contrast and radiation safety",
          size: "m",
          topics: [
            {
              id: "srd-physics",
              title: "Physics, contrast and radiation safety",
              book: "Crack the Core Physics / RDN11 Physics",
              mustKnow: [
                {
                  fact: "Computed tomography radiation dose metrics include CTDIvol (volume CT dose index in mGy) and Dose Length Product (DLP in mGy-cm), where effective dose in mSv is derived by multiplying DLP by tissue weighting factor k.",
                  terms: ["CTDIvol", "Dose Length Product"],
                  source: "Crack the Core Physics / RDN11"
                },
                {
                  fact: "MRI T1 relaxation (spin-lattice or longitudinal relaxation) reflects the recovery of longitudinal magnetization along B0, whereas T2 relaxation (spin-spin or transverse relaxation) reflects the loss of phase coherence in the transverse plane.",
                  terms: ["longitudinal relaxation", "transverse relaxation"],
                  numbers: ["1", "0", "2"],
                  source: "Crack the Core Physics / RDN11"
                },
                {
                  fact: "Chemical shift artefact of the second type (in-phase and opposed-phase or Dixon imaging) occurs at 1.5 Tesla due to the 220 Hz difference in precession resonance frequency between lipid and water protons.",
                  terms: ["Chemical shift", "precession"],
                  numbers: ["2", "1.5", "220"],
                  source: "Crack the Core Physics / RDN11"
                },
                {
                  fact: "Nephrogenic systemic fibrosis (NSF) is a rare fibrosing condition associated with linear non-ionic gadolinium-based contrast agents in patients with severe renal dysfunction (eGFR < 30 mL/min/1.73m2), prevented by using macrocyclic agents.",
                  terms: ["Nephrogenic systemic fibrosis", "gadolinium"],
                  numbers: ["30", "1.73"],
                  source: "Crack the Core Physics / ACR Contrast Manual"
                },
                {
                  fact: "Acute adverse reactions to iodinated contrast media are categorized by ACR into mild (scattered urticaria, nausea), moderate (marked diffuse erythema, mild bronchospasm), and severe (severe laryngeal oedema, anaphylactic shock), treated immediately with intramuscular adrenaline (0.3 mg 1:1000).",
                  terms: ["iodinated contrast", "adrenaline"],
                  numbers: ["0.3", "1", "1000"],
                  source: "Crack the Core Physics / ACR Contrast Manual"
                },
                {
                  fact: "Ultrasound mechanical index (MI) measures the potential for cavitation bioeffects in tissue, while thermal index (TI) estimates temperature elevation, with clinical diagnostic ultrasound regulated to MI < 1.9.",
                  terms: ["mechanical index", "thermal index"],
                  numbers: ["1.9"],
                  source: "Crack the Core Physics / RDN11"
                },
                {
                  fact: "Annual occupational radiation dose limits established by ICRP and NCRP are 20 mSv per year averaged over 5 years (not to exceed 50 mSv in any single year) for whole-body effective dose, and 150 mSv for the lens of the eye.",
                  terms: ["dose limits", "effective dose"],
                  numbers: ["20", "5", "50", "150"],
                  source: "Crack the Core Physics / ICRP 103"
                },
                {
                  fact: "Specific Absorption Rate (SAR) in MRI quantifies radiofrequency energy deposition in patient tissues (watts per kilogram), where whole-body SAR is limited to 2 W/kg in Normal Operating Mode to prevent core body temperature elevation > 1.0 degree Celsius.",
                  terms: ["Specific Absorption Rate", "radiofrequency"],
                  numbers: ["2", "1.0"],
                  source: "Crack the Core Physics / IEC Standards"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "srd-emergency-sec",
      name: "Emergency radiology",
      modules: [
        {
          id: "srd-emergency",
          name: "Trauma and emergency imaging",
          size: "m",
          topics: [
            {
              id: "srd-emergency",
              title: "Trauma and emergency imaging",
              book: "Crack the Core Emergency Radiology / RDN11 Trauma",
              mustKnow: [
                {
                  fact: "Traumatic aortic injury typically occurs at the aortic isthmus immediately distal to the origin of the left subclavian artery, manifesting on contrast CT as pseudoaneurysm, intimal flap, contour deformity, or mediastinal haematoma.",
                  terms: ["aortic isthmus", "pseudoaneurysm"],
                  source: "Crack the Core Emergency / RDN11"
                },
                {
                  fact: "Boerhaave syndrome (spontaneous transmural oesophageal rupture) occurs most commonly in the left posterolateral distal oesophagus, producing pneumomediastinum, left-sided pleural effusion, subcutaneous emphysema (Mackler triad), and extravasation of water-soluble oral contrast.",
                  terms: ["Boerhaave syndrome", "pneumomediastinum"],
                  source: "Crack the Core Emergency / RDN11"
                },
                {
                  fact: "Epidural haematoma characteristically arises from rupture of the middle meningeal artery secondary to a temporal bone fracture, appearing as a biconvex, lentiform hyperdense collection that does not cross cranial sutures.",
                  terms: ["Epidural haematoma", "middle meningeal artery"],
                  source: "Crack the Core Emergency / RDN11"
                },
                {
                  fact: "Subdural haematoma results from tearing of bridging cortical veins, presenting as a crescentic hyperdense extra-axial collection that readily crosses cranial sutures but is restricted by dural reflections (falx and tentorium).",
                  terms: ["Subdural haematoma", "bridging cortical veins"],
                  source: "Crack the Core Emergency / RDN11"
                },
                {
                  fact: "Diffuse axonal injury (DAI) is caused by rotational acceleration-deceleration forces, classically producing petechial microhaemorrhages and restricted diffusion at the grey-white matter junction, corpus callosum (splenium), and dorsolateral brainstem.",
                  terms: ["Diffuse axonal injury", "corpus callosum"],
                  source: "Crack the Core Emergency / RDN11"
                },
                {
                  fact: "AAST splenic injury grading on CT defines Grade 1 (capsular tear < 1 cm, subcapsular haematoma < 10%), progressing to Grade 4 (active bleeding into peritoneum or segmental devascularization > 25%), and Grade 5 (completely shattered spleen).",
                  terms: ["splenic injury", "AAST"],
                  numbers: ["1", "10%", "4", "25%", "5"],
                  source: "Crack the Core Emergency / AAST"
                },
                {
                  fact: "Tension pneumothorax is a clinical and radiographic emergency characterized on CT or radiograph by ipsilateral lung collapse, depression of the hemidiaphragm, contralateral tracheal and mediastinal shift, and severe venous return compromise.",
                  terms: ["Tension pneumothorax", "mediastinal shift"],
                  source: "Crack the Core Emergency / RDN11"
                },
                {
                  fact: "Pelvic fractures with haemodynamic instability frequently result from disruption of the posterior sacroiliac ligamentous complex (AP compression or vertical shear injuries), causing injury to the internal iliac arterial branches and presacral venous plexus.",
                  terms: ["Pelvic fractures", "internal iliac"],
                  source: "Crack the Core Emergency / RDN11"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "srd-anatomy",
      name: "Radiological anatomy",
      modules: [
        {
          id: "srd-anat-neuro",
          name: "Brain, head and neck and spine anatomy",
          size: "m",
          topics: [
            {
              id: "srd-anat-neuro",
              title: "Brain, head and neck and spine anatomy",
              book: "Crack the Core Anatomy / RDN11 Neuroanatomy",
              mustKnow: [
                {
                  fact: "Circle of Willis classic complete arterial polygon occurs in only about 20% to 30% of individuals, comprising the internal carotid arteries, anterior cerebral arteries (A1), anterior communicating artery, posterior communicating arteries, and posterior cerebral arteries (P1).",
                  terms: ["Circle of Willis", "anterior communicating artery"],
                  numbers: ["20%", "30%", "1"],
                  source: "Crack the Core Anatomy / RDN11"
                },
                {
                  fact: "Cavernous sinus transmits through its lumen the internal carotid artery and abducens nerve (CN VI), while its lateral fibrous dural wall houses the oculomotor (CN III), trochlear (CN IV), ophthalmic (CN V1), and maxillary (CN V2) nerves from superior to inferior.",
                  terms: ["Cavernous sinus", "abducens nerve"],
                  numbers: ["6", "3", "4", "1", "2"],
                  source: "Crack the Core Anatomy / RDN11"
                },
                {
                  fact: "Internal auditory canal anatomy divides into four quadrants by the falciform crest horizontally and Bill bar vertically: facial nerve (CN VII) is anterosuperior, cochlear nerve is anteroinferior ('seven up, coke down'), and vestibular nerves are posterior.",
                  terms: ["Internal auditory canal", "Bill bar"],
                  numbers: ["7"],
                  source: "Crack the Core Anatomy / RDN11"
                },
                {
                  fact: "Jugular foramen anatomy comprises two distinct compartments: pars nervosa anteromedially (transmitting the glossopharyngeal nerve CN IX and inferior petrosal sinus) and pars vascularis posterolaterally (transmitting vagus CN X, accessory CN XI, and internal jugular vein).",
                  terms: ["Jugular foramen", "pars nervosa"],
                  numbers: ["9", "10", "11"],
                  source: "Crack the Core Anatomy / RDN11"
                },
                {
                  fact: "Skull base foramina identify precise nerve pathways: cribriform plate (CN I), optic canal (CN II), superior orbital fissure (CN III, IV, V1, VI), foramen rotundum (CN V2), foramen ovale (CN V3), and hypoglossal canal (CN XII).",
                  terms: ["foramen ovale", "foramen rotundum"],
                  numbers: ["1", "2", "3", "4", "6", "12"],
                  source: "Crack the Core Anatomy / RDN11"
                },
                {
                  fact: "Deep cervical neck spaces are bounded by layers of the deep cervical fascia: the masticator space contains the muscles of mastication, mandibular ramus, and mandibular division of the trigeminal nerve (V3).",
                  terms: ["masticator space", "deep cervical fascia"],
                  numbers: ["3"],
                  source: "Crack the Core Anatomy / RDN11"
                },
                {
                  fact: "Retropharyngeal space extends from the skull base to the superior mediastinum (T3 to T6 vertebral level), bounded posteriorly by the alar fascia and communicating laterally with the parapharyngeal space.",
                  terms: ["Retropharyngeal space", "alar fascia"],
                  numbers: ["3", "6"],
                  source: "Crack the Core Anatomy / RDN11"
                },
                {
                  fact: "Spinal cord conus medullaris normally terminates at the L1-L2 intervertebral disc level in adults, with a low-lying conus terminating below L2 indicating a tethered spinal cord.",
                  terms: ["conus medullaris", "tethered spinal cord"],
                  numbers: ["1", "2"],
                  source: "Crack the Core Anatomy / RDN11"
                }
              ]
            }
          ]
        },
        {
          id: "srd-anat-body",
          name: "Chest, heart, abdomen and pelvis anatomy",
          size: "m",
          topics: [
            {
              id: "srd-anat-body",
              title: "Chest, heart, abdomen and pelvis anatomy",
              book: "Crack the Core Anatomy / RDN11 Body Anatomy",
              mustKnow: [
                {
                  fact: "Bronchopulmonary segment anatomy divides the right lung into 10 segments (3 upper, 2 middle, 5 lower lobe) and the left lung into 8 to 10 segments (apicoposterior, anterior, superior/inferior lingula, anteromedial basal, lateral basal, posterior basal).",
                  terms: ["Bronchopulmonary segment", "lingula"],
                  numbers: ["10", "3", "2", "5", "8"],
                  source: "Crack the Core Anatomy / RDN11"
                },
                {
                  fact: "Couinaud hepatic segmentation is based on independent portal triads (portal vein, hepatic artery, bile duct) into 8 functional segments, where the middle hepatic vein separates the right lobe (segments 5 to 8) from the left lobe (segments 2 to 4).",
                  terms: ["Couinaud hepatic segmentation", "middle hepatic vein"],
                  numbers: ["8", "5", "2", "4"],
                  source: "Crack the Core Anatomy / RDN11"
                },
                {
                  fact: "Caudate lobe of the liver represents Couinaud segment 1, receiving independent portal venous branches and direct venous drainage into the retrohepatic inferior vena cava, sparing it in Budd-Chiari syndrome.",
                  terms: ["Caudate lobe", "Budd-Chiari syndrome"],
                  numbers: ["1"],
                  source: "Crack the Core Anatomy / RDN11"
                },
                {
                  fact: "Coronary artery dominance is determined by the vessel that gives rise to the posterior descending artery (PDA) and posterolateral branch: right coronary dominance occurs in approximately 85% of hearts, left dominance in 10%, and codominance in 5%.",
                  terms: ["Coronary artery dominance", "posterior descending artery"],
                  numbers: ["85%", "10%", "5%"],
                  source: "Crack the Core Anatomy / RDN11"
                },
                {
                  fact: "Coeliac trunk classically trifurcates into the left gastric artery, common hepatic artery, and splenic artery, where replaced right hepatic artery from the superior mesenteric artery occurs in 10% to 15% (Michels type VI).",
                  terms: ["Coeliac trunk", "replaced right hepatic artery"],
                  numbers: ["10%", "15%", "6"],
                  source: "Crack the Core Anatomy / RDN11"
                },
                {
                  fact: "Pancreatic ductal anatomy demonstrates the main pancreatic duct of Wirsung draining via the major duodenal papilla with the common bile duct, whereas the accessory duct of Santorini drains via the minor papilla located anterosuperiorly.",
                  terms: ["duct of Wirsung", "duct of Santorini"],
                  source: "Crack the Core Anatomy / RDN11"
                },
                {
                  fact: "Pancreas divisum is the most common congenital pancreatic ductal anomaly (5% to 10%), resulting from failure of fusion of dorsal and ventral pancreatic buds such that the bulk of the pancreas drains through the smaller minor papilla.",
                  terms: ["Pancreas divisum", "minor papilla"],
                  numbers: ["5%", "10%"],
                  source: "Crack the Core Anatomy / RDN11"
                },
                {
                  fact: "Retroperitoneal compartments defined by the renal fascia (Gerota and Zuckerkandl) comprise the anterior pararenal space (pancreas, ascending/descending colon, duodenum), perirenal space (kidneys, adrenals), and posterior pararenal space (fat only).",
                  terms: ["Gerota", "perirenal space"],
                  source: "Crack the Core Anatomy / RDN11"
                }
              ]
            }
          ]
        },
        {
          id: "srd-anat-limbs",
          name: "Musculoskeletal, breast, obstetric and paediatric anatomy",
          size: "m",
          topics: [
            {
              id: "srd-anat-limbs",
              title: "Musculoskeletal, breast, obstetric and paediatric anatomy",
              book: "Crack the Core Anatomy / RDN11 MSK and Limb Anatomy",
              mustKnow: [
                {
                  fact: "Rotator cuff anatomy comprises the subscapularis (anteriorly, inserting into the lesser tuberosity), supraspinatus (superiorly, into the superior facet of greater tuberosity), infraspinatus (posteriorly), and teres minor.",
                  terms: ["Rotator cuff", "supraspinatus"],
                  source: "Crack the Core Anatomy / RDN11"
                },
                {
                  fact: "Carpal tunnel anatomy transmits through an osteofibrous canal 9 flexor tendons (4 flexor digitorum superficialis, 4 flexor digitorum profundus, 1 flexor pollicis longus) and the median nerve beneath the flexor retinaculum.",
                  terms: ["Carpal tunnel", "median nerve"],
                  numbers: ["9", "4", "1"],
                  source: "Crack the Core Anatomy / RDN11"
                },
                {
                  fact: "Wrist carpal bones are arranged in two rows: proximal row (scaphoid, lunate, triquetrum, pisiform) and distal row (trapezium, trapezoid, capitate, hamate), with the scaphoid blood supply entering distally, predisposing to avascular necrosis of the proximal pole.",
                  terms: ["scaphoid", "avascular necrosis"],
                  numbers: ["2"],
                  source: "Crack the Core Anatomy / RDN11"
                },
                {
                  fact: "Cruciate and collateral knee ligaments identify precise anatomy: anterior cruciate ligament originates from the posteromedial aspect of the lateral femoral condyle, whereas posterior cruciate ligament originates from the anterolateral aspect of the medial femoral condyle.",
                  terms: ["anterior cruciate ligament", "posterior cruciate ligament"],
                  source: "Crack the Core Anatomy / RDN11"
                },
                {
                  fact: "Paediatric elbow ossification centres appear in predictable chronological order remembered by the mnemonic CRITOE: Capitellum (1 year), Radial head (3 years), Internal/medial epicondyle (5 years), Trochlea (7 years), Olecranon (9 years), and External/lateral epicondyle (11 years).",
                  terms: ["CRITOE", "Capitellum"],
                  numbers: ["1", "3", "5", "7", "9", "11"],
                  source: "Crack the Core Anatomy / RDN11"
                },
                {
                  fact: "Axillary lymph node staging is anatomically divided relative to the pectoralis minor muscle: Level I nodes lie lateral to pectoralis minor, Level II lie posterior to pectoralis minor, and Level III lie medial to pectoralis minor.",
                  terms: ["Axillary lymph node", "pectoralis minor"],
                  numbers: ["1", "2", "3"],
                  source: "Crack the Core Anatomy / RDN11"
                },
                {
                  fact: "Terminal ductal lobular unit (TDLU) represents the functional milk-producing unit and primary histopathological origin of both ductal and lobular breast carcinomas as well as benign fibroadenomas and cysts.",
                  terms: ["Terminal ductal lobular unit", "fibroadenomas"],
                  source: "Crack the Core Anatomy / RDN11"
                },
                {
                  fact: "Normal fetal umbilical cord contains 2 umbilical arteries carrying deoxygenated blood from the fetus to the placenta and 1 umbilical vein carrying oxygenated blood from the placenta to the fetus, surrounded by Wharton jelly.",
                  terms: ["umbilical cord", "Wharton jelly"],
                  numbers: ["2", "1"],
                  source: "Crack the Core Anatomy / RDN11"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
};

// Write output
const outPath = path.join(ROOT, "prep", "blueprints", "ss", "ss-radiology.json");
fs.writeFileSync(outPath, JSON.stringify(blueprint, null, 2) + "\n", "utf8");
console.log(`Successfully generated ss-radiology blueprint at ${outPath}`);
