// scripts/build-neurology-blueprint.mjs
// Compiles the high-yield Neurology Stage 1 blueprint adhering to:
// - Adams and Victor's Principles of Neurology 11th Edition
// - Harrison's Principles of Internal Medicine 22nd Edition
// - Netter's Neurology 2nd Edition & Dr VG Neurology Notes
// - NMC DM Neurology Curriculum / NBEMS NEET-SS Neurology Medical Specialty Group
// - 27 modules across 9 sections, exactly 8 mustKnow facts per module (216 facts total, 27 % 3 == 0)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const blueprint = {
  subject: "ss-neurology",
  title: "Neurology",
  branch: "ss-medicine",
  curriculum: "NMC Competency-Based DM / DNB Neurology Curriculum / NBEMS NEET-SS Medical Specialty Group",
  examPattern: "NEET-SS Neurology (100% General Medicine feeder and Neurology subspecialty: cerebrovascular disease, neurocritical care, epilepsy, movement disorders, demyelinating disease, neuromuscular disorders, cognitive/behavioural neurology, neuro-infections, headache, neuro-oncology and clinical neurophysiology).",
  book: "Adams and Victor's Principles of Neurology 11th Edition; Harrison's Principles of Internal Medicine 22nd Edition; Netter's Neurology 2nd Edition; Neurology Notes by Dr VG",
  sections: [
    {
      id: "sne-stroke-sec",
      name: "Cerebrovascular Disease",
      modules: [
        {
          id: "sne-stroke-syndromes",
          name: "Ischaemic stroke syndromes and vascular territories",
          size: "l",
          topics: [
            {
              id: "sne-stroke-syndromes",
              title: "Ischaemic stroke syndromes and vascular territories",
              book: "Adams & Victor 11e Ch. 34; Harrison 22e Ch. 434",
              mustKnow: [
                {
                  fact: "Lateral medullary syndrome (Wallenberg syndrome) results from occlusion of the posterior inferior cerebellar artery (PICA) or vertebral artery, presenting with ipsilateral facial pain and temperature loss, Horner syndrome, ataxia, and contralateral hemisensory loss.",
                  terms: ["Lateral medullary syndrome", "posterior inferior cerebellar artery"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Medial medullary syndrome (Dejerine syndrome) arises from anterior spinal artery occlusion, manifesting with ipsilateral hypoglossal palsy with tongue deviation to the lesion side, contralateral hemiplegia sparing the face, and contralateral loss of proprioception and vibration.",
                  terms: ["Medial medullary syndrome", "anterior spinal artery"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Weber syndrome localizes to the midbrain base due to paramedian branch occlusion of the posterior cerebral artery, characterized by ipsilateral oculomotor (third nerve) palsy and contralateral spastic hemiplegia.",
                  terms: ["Weber syndrome", "oculomotor"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Claude syndrome combines ipsilateral oculomotor fascicular palsy with contralateral cerebellar ataxia and tremor caused by a lesion affecting the red nucleus in the midbrain tegmentum.",
                  terms: ["Claude syndrome", "red nucleus"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Benedikt syndrome involves both the third nerve fascicle, red nucleus, and corticospinal tract, producing ipsilateral third nerve palsy with contralateral hemiparesis, chorea, and coarse intention tremor.",
                  terms: ["Benedikt syndrome", "corticospinal tract"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Millard-Gubler syndrome localizes to the ventral caudal pons, combining ipsilateral sixth and seventh nerve palsies with contralateral hemiplegia due to involvement of the abducens, facial fascicles, and pyramidal tract.",
                  terms: ["Millard-Gubler syndrome", "pyramidal tract"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Foville syndrome manifests with conjugate gaze palsy towards the side of the lesion along with ipsilateral facial palsy and contralateral hemiplegia due to pontine tegmental involvement including the PPRF.",
                  terms: ["Foville syndrome", "PPRF"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Top of the basilar artery syndrome causes rostral brainstem and diencephalic ischaemia, resulting in visual defects, vertical gaze paresis, pupillary abnormalities, and acute behavioural alterations.",
                  terms: ["basilar artery", "vertical gaze"],
                  source: "Adams & Victor 11e Ch. 34"
                }
              ]
            }
          ]
        },
        {
          id: "sne-mechanical-thrombectomy",
          name: "Acute reperfusion therapy and mechanical thrombectomy",
          size: "l",
          topics: [
            {
              id: "sne-mechanical-thrombectomy",
              title: "Acute reperfusion therapy and mechanical thrombectomy",
              book: "Adams & Victor 11e Ch. 34; Harrison 22e Ch. 434; AHA/ASA Guidelines",
              mustKnow: [
                {
                  fact: "Intravenous thrombolysis with tenecteplase 0.25 mg/kg or alteplase 0.9 mg/kg is recommended for eligible patients with acute ischaemic stroke within 4.5 hours of symptom onset.",
                  terms: ["tenecteplase", "alteplase"],
                  numbers: ["0.25", "0.9", "4.5"],
                  source: "AHA/ASA Stroke Guidelines / Harrison 22e Ch. 434"
                },
                {
                  fact: "Mechanical thrombectomy is standard of care within 6 hours of onset for anterior circulation large vessel occlusion (ICA or proximal MCA M1) with baseline ASPECTS score of 6 or greater.",
                  terms: ["Mechanical thrombectomy", "ASPECTS"],
                  numbers: ["6"],
                  source: "DAWN / DEFUSE-3 / AHA/ASA Guidelines"
                },
                {
                  fact: "Extended window mechanical thrombectomy up to 24 hours is indicated in patients selected by mismatch criteria established in the DAWN and DEFUSE-3 trials.",
                  terms: ["DEFUSE-3", "thrombectomy"],
                  numbers: ["24"],
                  source: "DAWN / DEFUSE-3 Trials"
                },
                {
                  fact: "Blood pressure prior to initiating intravenous thrombolysis must be carefully reduced to systolic below 185 mmHg and diastolic below 110 mmHg using labetalol, nicardipine, or clevidipine.",
                  terms: ["thrombolysis", "labetalol"],
                  numbers: ["185", "110"],
                  source: "AHA/ASA Guidelines / Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Following reperfusion therapy, blood pressure must be strictly maintained below 180/105 mmHg for the first 24 hours to minimize the risk of symptomatic intracerebral haemorrhage.",
                  terms: ["reperfusion", "intracerebral haemorrhage"],
                  numbers: ["180/105", "24"],
                  source: "AHA/ASA Guidelines"
                },
                {
                  fact: "ASPECTS (Alberta Stroke Program Early CT Score) evaluates 10 non-contrast CT brain zones in the MCA territory, where scores under 6 designate extensive irreversible ischemic core infarction.",
                  terms: ["ASPECTS", "infarction"],
                  numbers: ["10", "6"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Post-thrombectomy successful reperfusion is angiographically graded using the modified Treatment in Cerebral Ischemia (mTICI) scale, with grade 2b or 3 defining successful recanalization.",
                  terms: ["mTICI", "recanalization"],
                  numbers: ["2b", "3"],
                  source: "AHA/ASA Guidelines"
                },
                {
                  fact: "Antiplatelet therapy including aspirin must be withheld for 24 hours after intravenous alteplase until a repeat brain CT rules out hemorrhagic transformation.",
                  terms: ["aspirin", "alteplase"],
                  numbers: ["24"],
                  source: "AHA/ASA Guidelines / Harrison 22e Ch. 434"
                }
              ]
            }
          ]
        },
        {
          id: "sne-stroke-secondary-prevention",
          name: "Secondary prevention and aetiological evaluation of stroke",
          size: "l",
          topics: [
            {
              id: "sne-stroke-secondary-prevention",
              title: "Secondary prevention and aetiological evaluation of stroke",
              book: "Adams & Victor 11e Ch. 34; Harrison 22e Ch. 434",
              mustKnow: [
                {
                  fact: "Dual antiplatelet therapy with aspirin and clopidogrel is indicated for 21 days following minor non-cardioembolic ischemic stroke (NIHSS 3 or less) or high-risk TIA (ABCD2 score 4 or greater) based on the CHANCE and POINT trials.",
                  terms: ["clopidogrel", "aspirin"],
                  numbers: ["21", "3", "4"],
                  source: "CHANCE / POINT Trials / Harrison 22e Ch. 434"
                },
                {
                  fact: "Carotid endarterectomy provides significant benefit for symptomatic carotid artery stenosis of 70% to 99% when performed within 14 days of transient ischemic attack or non-disabling ischemic stroke.",
                  terms: ["Carotid endarterectomy", "carotid artery stenosis"],
                  numbers: ["70%", "99%", "14"],
                  source: "NASCET / ECST Trials / Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Non-vitamin K antagonist oral anticoagulants (DOACs including apixaban, rivaroxaban, and dabigatran) are superior or non-inferior to warfarin for secondary prevention in non-valvular atrial fibrillation.",
                  terms: ["apixaban", "dabigatran"],
                  source: "Adams & Victor 11e Ch. 34 / Harrison 22e Ch. 434"
                },
                {
                  fact: "High-intensity statin therapy (atorvastatin 80 mg daily) significantly reduces recurrent ischemic stroke and cardiovascular events according to the SPARCL clinical trial.",
                  terms: ["atorvastatin", "SPARCL"],
                  numbers: ["80"],
                  source: "SPARCL Trial / Harrison 22e Ch. 434"
                },
                {
                  fact: "Percutaneous patent foramen ovale (PFO) closure combined with antiplatelet therapy is indicated in cryptogenic ischemic stroke patients aged 18 to 60 with high-risk anatomical features such as atrial septal aneurysm.",
                  terms: ["patent foramen ovale", "antiplatelet therapy"],
                  numbers: ["18", "60"],
                  source: "CLOSE / REDUCE / RESPECT Trials"
                },
                {
                  fact: "Intensive blood pressure reduction targeting systolic pressure below 130 mmHg significantly lowers long-term recurrent stroke risk.",
                  terms: ["blood pressure", "recurrent stroke"],
                  numbers: ["130"],
                  source: "AHA/ASA Secondary Prevention Guidelines"
                },
                {
                  fact: "Direct oral anticoagulant resumption after cardioembolic stroke is traditionally timed using the 1-3-6-12 day rule according to clinical stroke severity and hemorrhagic transformation risk.",
                  terms: ["oral anticoagulant", "cardioembolic stroke"],
                  numbers: ["1-3-6-12"],
                  source: "EHRA Guidelines / Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Anticoagulation is contraindicated in cerebral amyloid angiopathy-associated lobar intracerebral haemorrhage due to prohibitively elevated recurrence rates.",
                  terms: ["cerebral amyloid angiopathy", "intracerebral haemorrhage"],
                  source: "Adams & Victor 11e Ch. 34"
                }
              ]
            }
          ]
        },
        {
          id: "sne-carotid-disease",
          name: "Carotid and vertebral artery disease and dissection",
          size: "l",
          topics: [
            {
              id: "sne-carotid-disease",
              title: "Carotid and vertebral artery disease and dissection",
              book: "Adams & Victor 11e Ch. 34; Harrison 22e Ch. 434",
              mustKnow: [
                {
                  fact: "Spontaneous internal carotid artery dissection characteristically presents with the classic triad of ipsilateral facial pain, partial Horner syndrome without anhidrosis, and cerebral or retinal ischemia.",
                  terms: ["Horner syndrome", "internal carotid artery"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Vertebral artery dissection classically involves the V3 segment at the atlas loop, presenting with severe unilateral occipitonuchal headache followed by posterior circulation ischemic symptoms.",
                  terms: ["Vertebral artery dissection", "atlas loop"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "MRI with fat-saturated axial T1-weighted sequences confirms arterial dissection by demonstrating an eccentric crescentic hyperintense intramural hematoma.",
                  terms: ["intramural hematoma", "T1-weighted"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Initial antithrombotic management of extracranial cervical artery dissection shows equivalent efficacy between antiplatelet agents and anticoagulation based on the CADISS and TREAT-CAD trials.",
                  terms: ["cervical artery dissection", "anticoagulation"],
                  source: "CADISS / TREAT-CAD Trials"
                },
                {
                  fact: "Carotid web represents an atypical shelf-like intimal fibrovascular projection in the internal carotid bulb, predisposing young adults to recurrent embolic ischemic strokes.",
                  terms: ["Carotid web", "internal carotid"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Carotid artery stenting (CAS) is an established alternative to carotid endarterectomy (CEA) particularly in patients with high-risk surgical anatomy such as prior cervical irradiation or hostile neck anatomy.",
                  terms: ["Carotid artery stenting", "carotid endarterectomy"],
                  source: "CREST / SAPPHIRE Trials"
                },
                {
                  fact: "Subclavian steal syndrome occurs due to proximal subclavian artery stenosis resulting in retrograde flow in the ipsilateral vertebral artery triggered by ipsilateral arm exertion.",
                  terms: ["Subclavian steal syndrome", "vertebral artery"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Fibromuscular dysplasia (FMD) predominantly affects middle-aged women, producing the characteristic string-of-beads angiographic appearance of the mid-distal internal carotid arteries.",
                  terms: ["Fibromuscular dysplasia", "internal carotid"],
                  source: "Adams & Victor 11e Ch. 34"
                }
              ]
            }
          ]
        },
        {
          id: "sne-young-stroke-vasculopathies",
          name: "Young stroke, Moyamoya and CNS vasculitis",
          size: "l",
          topics: [
            {
              id: "sne-young-stroke-vasculopathies",
              title: "Young stroke, Moyamoya and CNS vasculitis",
              book: "Adams & Victor 11e Ch. 34; Harrison 22e Ch. 434",
              mustKnow: [
                {
                  fact: "Moyamoya disease is an idiopathic chronic progressive steno-occlusive arteriopathy of the terminal internal carotid arteries and Circle of Willis, generating prominent basal collateral vessels resembling a puff of smoke.",
                  terms: ["Moyamoya disease", "puff of smoke"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Moyamoya disease is strongly associated with the RNF213 p.R4810K founder variant in East Asian populations, presenting with recurrent TIAs provoked by hyperventilation in children.",
                  terms: ["RNF213", "Moyamoya"],
                  source: "Adams & Victor 11e Ch. 34 / Netter's Neurology"
                },
                {
                  fact: "Surgical revascularization for Moyamoya includes direct superficial temporal artery to middle cerebral artery (STA-MCA) bypass and indirect procedures like encephaloduroarteriosynangiosis (EDAS).",
                  terms: ["revascularization", "STA-MCA"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Primary angiitis of the central nervous system (PACNS) is a rare vasculitis restricted to small and medium vessels of the brain parenchyma and leptomeninges, requiring definitive brain biopsy for diagnosis.",
                  terms: ["Primary angiitis", "brain biopsy"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Reversible cerebral vasoconstriction syndrome (RCVS) is characterized by severe hyperacute thunderclap headaches and reversible multifocal segmental cerebral arterial vasoconstriction resolving within 3 months.",
                  terms: ["Reversible cerebral vasoconstriction syndrome", "thunderclap headaches"],
                  numbers: ["3"],
                  source: "Adams & Victor 11e Ch. 34 / Harrison 22e Ch. 434"
                },
                {
                  fact: "CADASIL (Cerebral Autosomal Dominant Arteriopathy with Subcortical Infarcts and Leukoencephalopathy) is caused by mutations in the NOTCH3 gene on chromosome 19, characteristically involving the anterior temporal poles and external capsule on MRI.",
                  terms: ["CADASIL", "NOTCH3"],
                  numbers: ["19"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "CARASIL is an autosomal recessive cerebral small vessel arteriopathy linked to mutations in HTRA1, presenting clinically with recurrent lacunar strokes, alopecia, and premature spondylosis.",
                  terms: ["CARASIL", "HTRA1"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Fabry disease causes premature stroke through deficiency of alpha-galactosidase A and accumulation of globotriaosylceramide (Gb3), associated with angiokeratomas, acroparesthesias, and the pulvinar sign on T1-weighted MRI.",
                  terms: ["Fabry disease", "alpha-galactosidase"],
                  source: "Harrison 22e Ch. 434 / Adams & Victor 11e Ch. 37"
                }
              ]
            }
          ]
        },
        {
          id: "sne-venous-thrombosis",
          name: "Cerebral venous sinus thrombosis",
          size: "l",
          topics: [
            {
              id: "sne-venous-thrombosis",
              title: "Cerebral venous sinus thrombosis",
              book: "Adams & Victor 11e Ch. 34; Harrison 22e Ch. 434; EFNS Guidelines",
              mustKnow: [
                {
                  fact: "Cerebral venous sinus thrombosis most frequently involves the superior sagittal sinus and transverse sinuses, presenting with headache, papilloedema, focal neurological deficits, and seizures.",
                  terms: ["superior sagittal sinus", "papilloedema"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Contrast-enhanced CT and MR venography establish definitive diagnosis of venous sinus thrombosis by demonstrating the empty delta sign, representing a non-enhancing intraluminal clot surrounded by enhanced dural collaterals.",
                  terms: ["empty delta sign", "MR venography"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Bilateral parasagittal frontal and parietal hemorrhagic infarctions crossing arterial vascular territories are pathognomonic for superior sagittal sinus thrombosis.",
                  terms: ["hemorrhagic infarctions", "superior sagittal sinus"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Bilateral thalamic and basal ganglia congestion or hemorrhagic infarction indicates deep cerebral venous system thrombosis involving the straight sinus and internal cerebral veins.",
                  terms: ["straight sinus", "internal cerebral veins"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Therapeutic anticoagulation with low-molecular-weight heparin or dose-adjusted unfractionated heparin is the first-line treatment for acute cerebral venous thrombosis even in the presence of baseline hemorrhagic infarction.",
                  terms: ["heparin", "venous thrombosis"],
                  source: "EFNS / AHA Guidelines / Harrison 22e Ch. 434"
                },
                {
                  fact: "Following acute stabilization, oral anticoagulation is continued for 3 to 6 months for provoked cerebral venous thrombosis, and 6 to 12 months or lifelong for unprovoked cases or severe thrombophilia.",
                  terms: ["oral anticoagulation", "thrombophilia"],
                  numbers: ["3", "6", "12"],
                  source: "EFNS / AHA Guidelines"
                },
                {
                  fact: "Cavernous sinus thrombosis commonly arises from spread of facial or paranasal sinus infections, presenting with painful proptosis, chemosis, ophthalmoplegia, and sensory loss in the V1 and V2 distribution.",
                  terms: ["Cavernous sinus thrombosis", "proptosis"],
                  source: "Adams & Victor 11e Ch. 34"
                },
                {
                  fact: "Endovascular mechanical thrombectomy or local thrombolysis is reserved as salvage therapy for patients who experience neurological deterioration despite therapeutic heparin anticoagulation.",
                  terms: ["mechanical thrombectomy", "neurological deterioration"],
                  source: "Adams & Victor 11e Ch. 34"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "sne-neurocritical-sec",
      name: "Neurocritical Care and Consciousness",
      modules: [
        {
          id: "sne-raised-icp-neurocritical",
          name: "Raised intracranial pressure and brain herniation",
          size: "l",
          topics: [
            {
              id: "sne-raised-icp-neurocritical",
              title: "Raised intracranial pressure and brain herniation",
              book: "Adams & Victor 11e Ch. 17, 30; Harrison 22e Ch. 317",
              mustKnow: [
                {
                  fact: "Normal intracranial pressure in adults ranges between 5 and 15 mmHg, with sustained elevations above 20 to 22 mmHg requiring aggressive medical and surgical interventions.",
                  terms: ["intracranial pressure", "interventions"],
                  numbers: ["5", "15", "20", "22"],
                  source: "Brain Trauma Foundation / Adams & Victor 11e Ch. 30"
                },
                {
                  fact: "Cerebral perfusion pressure (CPP) is calculated as Mean Arterial Pressure (MAP) minus Intracranial Pressure (ICP), with guidelines recommending target maintenance between 60 and 70 mmHg.",
                  terms: ["Cerebral perfusion pressure", "Mean Arterial Pressure"],
                  numbers: ["60", "70"],
                  source: "Brain Trauma Foundation Guidelines"
                },
                {
                  fact: "Uncal herniation (lateral transtentorial herniation) compresses the ipsilateral oculomotor (third) nerve and posterior cerebral artery, causing an ipsilateral sluggish or dilated pupil and contralateral hemiparesis.",
                  terms: ["Uncal herniation", "oculomotor"],
                  source: "Adams & Victor 11e Ch. 17"
                },
                {
                  fact: "Kernohan notch phenomenon describes paradoxical ipsilateral hemiparesis occurring when contralateral uncal herniation pushes the midbrain across against the opposite tentorial edge.",
                  terms: ["Kernohan notch", "uncal herniation"],
                  source: "Adams & Victor 11e Ch. 17"
                },
                {
                  fact: "Subfalcine herniation involves displacement of the cingulate gyrus beneath the falx cerebri, potentially causing anterior cerebral artery compression and contralateral lower limb paresis.",
                  terms: ["Subfalcine herniation", "cingulate gyrus"],
                  source: "Adams & Victor 11e Ch. 17"
                },
                {
                  fact: "Tonsillar herniation forces the cerebellar tonsils through the foramen magnum, compressing the medulla oblongata and leading to rapid respiratory arrest, bradycardia, and death.",
                  terms: ["Tonsillar herniation", "foramen magnum"],
                  source: "Adams & Victor 11e Ch. 17"
                },
                {
                  fact: "First-tier medical therapies for elevated ICP include head elevation to 30 degrees, analgesia, light sedation, and osmotic agents like hypertonic saline (3% or 23.4%) or mannitol (0.5 to 1 g/kg).",
                  terms: ["hypertonic saline", "mannitol"],
                  numbers: ["30", "3%", "23.4%", "0.5", "1"],
                  source: "Adams & Victor 11e Ch. 30"
                },
                {
                  fact: "Cushing triad is a late sign of critical intracranial hypertension and impending brainstem herniation, characterized by arterial hypertension with widened pulse pressure, bradycardia, and irregular respirations.",
                  terms: ["Cushing triad", "bradycardia"],
                  source: "Adams & Victor 11e Ch. 17"
                }
              ]
            }
          ]
        },
        {
          id: "sne-coma-brain-death",
          name: "Coma, encephalopathy and brain death determination",
          size: "l",
          topics: [
            {
              id: "sne-coma-brain-death",
              title: "Coma, encephalopathy and brain death determination",
              book: "Adams & Victor 11e Ch. 17; AAN Brain Death Guidelines; Harrison 22e Ch. 317",
              mustKnow: [
                {
                  fact: "Coma is defined as a state of unarousable unresponsiveness resulting from extensive bilateral cerebral hemispheric dysfunction or disruption of the ascending reticular activating system (ARAS) in the brainstem.",
                  terms: ["reticular activating system", "Coma"],
                  source: "Adams & Victor 11e Ch. 17"
                },
                {
                  fact: "The Glasgow Coma Scale (GCS) objectively quantifies impairment of consciousness by evaluating Eye (1-4), Verbal (1-5), and Motor (1-6) responses, yielding scores ranging from 3 to 15.",
                  terms: ["Glasgow Coma Scale", "impairment of consciousness"],
                  numbers: ["1-4", "1-5", "1-6", "3", "15"],
                  source: "Harrison 22e Ch. 317"
                },
                {
                  fact: "Decorticate posturing (flexor rigidity) features flexion of the upper limbs and extension of the lower limbs, indicating severe bilateral cortical or diencephalic lesions with preservation of the red nucleus.",
                  terms: ["Decorticate posturing", "red nucleus"],
                  source: "Adams & Victor 11e Ch. 17"
                },
                {
                  fact: "Decerebrate posturing (extensor rigidity) features extensor posturing of all four limbs with internal rotation, signifying destructive brainstem lesions below the level of the red nucleus.",
                  terms: ["Decerebrate posturing", "extensor posturing"],
                  source: "Adams & Victor 11e Ch. 17"
                },
                {
                  fact: "Prerequisites for brain death determination require established irreversible cause, core body temperature above 36 degrees Celsius, systolic blood pressure of 100 mmHg or greater, and absence of confounding drugs or hypothermia.",
                  terms: ["brain death", "temperature"],
                  numbers: ["36", "100"],
                  source: "AAN Brain Death Guidelines / Adams & Victor 11e Ch. 17"
                },
                {
                  fact: "Clinical brain death examination requires complete absence of all brainstem reflexes including pupillary, corneal, oculocephalic, oculovestibular, gag, and cough reflexes.",
                  terms: ["brainstem reflexes", "oculovestibular"],
                  source: "AAN Brain Death Guidelines"
                },
                {
                  fact: "Apnea testing confirms brain death when pre-oxygenated patients demonstrate absent respiratory effort despite arterial PaCO2 rising to 60 mmHg or greater (or at least 20 mmHg above baseline) with arterial pH below 7.28.",
                  terms: ["Apnea testing", "PaCO2"],
                  numbers: ["60", "20", "7.28"],
                  source: "AAN Brain Death Guidelines"
                },
                {
                  fact: "Ancillary confirmatory tests for brain death are indicated when apnea testing cannot be safely completed, including four-vessel cerebral angiography, radionuclide brain perfusion imaging, and transcranial Doppler ultrasound.",
                  terms: ["cerebral angiography", "transcranial Doppler"],
                  source: "AAN Brain Death Guidelines / Harrison 22e Ch. 317"
                }
              ]
            }
          ]
        },
        {
          id: "sne-neurology-systemic-disease",
          name: "Metabolic encephalopathy and systemic disease neurology",
          size: "l",
          topics: [
            {
              id: "sne-neurology-systemic-disease",
              title: "Metabolic encephalopathy and systemic disease neurology",
              book: "Adams & Victor 11e Ch. 38, 40; Harrison 22e Ch. 318, 442",
              mustKnow: [
                {
                  fact: "Wernicke encephalopathy results from acute thiamine (vitamin B1) deficiency, classically presenting with the clinical triad of encephalopathy, oculomotor dysfunction (nystagmus, abducens palsy), and gait ataxia.",
                  terms: ["Wernicke encephalopathy", "thiamine"],
                  source: "Adams & Victor 11e Ch. 40"
                },
                {
                  fact: "Characteristic MRI findings in acute Wernicke encephalopathy demonstrate symmetrical hyperintensity and enhancement of the mammillary bodies, medial thalami, periaqueductal gray matter, and tectum on T2 and FLAIR.",
                  terms: ["mammillary bodies", "Wernicke encephalopathy"],
                  source: "Adams & Victor 11e Ch. 40"
                },
                {
                  fact: "Osmotic demyelination syndrome (central pontine myelinolysis) is caused by overly rapid correction of severe chronic hyponatremia (>10-12 mEq/L per 24 hours), causing spastic quadriparesis, pseudobulbar palsy, and locked-in syndrome.",
                  terms: ["Osmotic demyelination syndrome", "hyponatremia"],
                  numbers: ["10-12", "24"],
                  source: "Adams & Victor 11e Ch. 38"
                },
                {
                  fact: "Hepatic encephalopathy is characterized by elevated blood ammonia, asterixis (flapping tremor), and bilateral symmetrical frontally predominant triphasic waves on electroencephalography (EEG).",
                  terms: ["Hepatic encephalopathy", "triphasic waves"],
                  source: "Adams & Victor 11e Ch. 38"
                },
                {
                  fact: "Subacute combined degeneration of the spinal cord is caused by vitamin B12 (cobalamin) deficiency, producing demyelination of the posterior and lateral columns manifesting with sensory ataxia, spasticity, and absent ankle jerks with extensor plantars.",
                  terms: ["Subacute combined degeneration", "vitamin B12"],
                  source: "Adams & Victor 11e Ch. 40"
                },
                {
                  fact: "Uremic encephalopathy presents with fluctuating mental status, multifocal myoclonus, asterixis, and prominent seizure susceptibility, improving rapidly following adequate hemodialysis.",
                  terms: ["Uremic encephalopathy", "myoclonus"],
                  source: "Adams & Victor 11e Ch. 38"
                },
                {
                  fact: "Posterior reversible encephalopathy syndrome (PRES) manifests with acute headache, altered mental status, visual disturbances, and vasogenic subcortical edema predominantly affecting the parieto-occipital white matter on MRI.",
                  terms: ["Posterior reversible encephalopathy syndrome", "vasogenic"],
                  source: "Adams & Victor 11e Ch. 34 / Harrison 22e Ch. 318"
                },
                {
                  fact: "Copper deficiency myeloneuropathy causes an identical clinical syndrome to vitamin B12 deficiency (subacute combined degeneration) and is frequently associated with high dietary zinc ingestion or previous gastric bypass surgery.",
                  terms: ["Copper deficiency", "subacute combined degeneration"],
                  source: "Adams & Victor 11e Ch. 40"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "sne-epilepsy-sec",
      name: "Epilepsy and Clinical Neurophysiology",
      modules: [
        {
          id: "sne-eeg",
          name: "EEG patterns in epilepsy and encephalopathy",
          size: "l",
          topics: [
            {
              id: "sne-eeg",
              title: "EEG patterns in epilepsy and encephalopathy",
              book: "Adams & Victor 11e Ch. 2, 16; Harrison 22e Ch. 433; Netter's Neurology",
              mustKnow: [
                {
                  fact: "Childhood absence epilepsy shows classic generalized, symmetrical 3 Hz spike-and-wave discharges with sudden onset and offset on EEG, precipitated by hyperventilation and photic stimulation.",
                  terms: ["absence epilepsy", "spike-and-wave"],
                  numbers: ["3"],
                  source: "Adams & Victor 11e Ch. 16"
                },
                {
                  fact: "Lennox-Gastaut syndrome is characterized by the classic clinical triad of multiple seizure types (tonic, atonic, atypical absence), cognitive impairment, and slow spike-and-wave discharges (<2.5 Hz) on EEG.",
                  terms: ["Lennox-Gastaut syndrome", "spike-and-wave"],
                  numbers: ["2.5"],
                  source: "Adams & Victor 11e Ch. 16"
                },
                {
                  fact: "West syndrome (infantile spasms) demonstrates hypsarrhythmia on EEG, characterized by high-voltage, chaotic, disorganized background activity with multifocal spikes, treated first-line with ACTH or vigabatrin.",
                  terms: ["West syndrome", "hypsarrhythmia"],
                  source: "Adams & Victor 11e Ch. 16"
                },
                {
                  fact: "Periodic lateralized epileptiform discharges (PLEDs or LPDs) on EEG are most commonly associated with acute focal structural cerebral lesions, particularly herpes simplex encephalitis and acute cortical ischaemic infarction.",
                  terms: ["epileptiform discharges", "herpes simplex encephalitis"],
                  source: "Adams & Victor 11e Ch. 2"
                },
                {
                  fact: "Generalized periodic discharges (GPDs) occurring at 1 to 2 second intervals in an encephalopathic patient with rapid dementia and startle myoclonus are highly characteristic of sporadic Creutzfeldt-Jakob disease.",
                  terms: ["periodic discharges", "Creutzfeldt-Jakob disease"],
                  numbers: ["1", "2"],
                  source: "Adams & Victor 11e Ch. 32"
                },
                {
                  fact: "Triphasic waves on EEG are frontally dominant, generalized, synchronous waveforms characteristically seen in metabolic encephalopathies including hepatic, uremic, and toxic states.",
                  terms: ["Triphasic waves", "encephalopathies"],
                  source: "Adams & Victor 11e Ch. 2"
                },
                {
                  fact: "Benign epilepsy with centrotemporal spikes (Rolandic epilepsy) features high-voltage centrotemporal spikes with broad horizontal dipoles that characteristically increase markedly during non-REM sleep.",
                  terms: ["Rolandic epilepsy", "centrotemporal spikes"],
                  source: "Adams & Victor 11e Ch. 16"
                },
                {
                  fact: "Juvenile myoclonic epilepsy (JME) demonstrates generalized 4 to 6 Hz polyspike-and-wave complexes on EEG, with seizures occurring predominantly within one to two hours of waking.",
                  terms: ["Juvenile myoclonic epilepsy", "polyspike-and-wave"],
                  numbers: ["4", "6"],
                  source: "Adams & Victor 11e Ch. 16"
                }
              ]
            }
          ]
        },
        {
          id: "sne-epilepsy-syndromes-status",
          name: "Epilepsy syndromes and status epilepticus",
          size: "l",
          topics: [
            {
              id: "sne-epilepsy-syndromes-status",
              title: "Epilepsy syndromes and status epilepticus",
              book: "Adams & Victor 11e Ch. 16; Harrison 22e Ch. 433; AES Status Guidelines",
              mustKnow: [
                {
                  fact: "Status epilepticus is defined by the ILAE at operational time point T1 (5 minutes for convulsive status) when treatment must be initiated, and time point T2 (30 minutes) when neuronal injury accelerates.",
                  terms: ["Status epilepticus", "ILAE"],
                  numbers: ["5", "30"],
                  source: "ILAE Status Epilepticus Guidelines / Harrison 22e Ch. 433"
                },
                {
                  fact: "First-line therapy for convulsive status epilepticus is intravenous lorazepam (0.1 mg/kg) or intramuscular midazolam (10 mg for patients >40 kg), which must be administered promptly within the first 5 to 10 minutes.",
                  terms: ["lorazepam", "midazolam"],
                  numbers: ["0.1", "10", "40", "5", "10"],
                  source: "AES Guidelines / Harrison 22e Ch. 433"
                },
                {
                  fact: "Second-line intravenous antiepileptic drugs for established status epilepticus include levetiracetam (60 mg/kg, max 4500 mg), fosphenytoin (20 mg PE/kg), or sodium valproate (40 mg/kg), which showed equivalent efficacy in the ESETT trial.",
                  terms: ["levetiracetam", "ESETT"],
                  numbers: ["60", "4500", "20", "40"],
                  source: "ESETT Trial / AES Guidelines"
                },
                {
                  fact: "Refractory status epilepticus is defined as persistence of seizures despite adequate doses of a benzodiazepine and a second-line antiepileptic drug, requiring continuous intravenous anesthetic infusions such as propofol, midazolam, or ketamine.",
                  terms: ["Refractory status epilepticus", "propofol"],
                  source: "Adams & Victor 11e Ch. 16"
                },
                {
                  fact: "Mesial temporal lobe epilepsy with hippocampal sclerosis is the most common refractory focal epilepsy syndrome, characterized by epigastric aura, automotor semeiologies, and responsiveness to anterior temporal lobectomy.",
                  terms: ["hippocampal sclerosis", "epigastric aura"],
                  source: "Adams & Victor 11e Ch. 16"
                },
                {
                  fact: "Juvenile myoclonic epilepsy responds well to broad-spectrum agents such as valproate, levetiracetam, and lamotrigine, but may be exacerbated by sodium-channel blockers like carbamazepine and phenytoin.",
                  terms: ["Juvenile myoclonic epilepsy", "valproate"],
                  source: "Adams & Victor 11e Ch. 16"
                },
                {
                  fact: "Valproate is teratogenic with significant risks of neural tube defects and neurodevelopmental delay, and is contraindicated in women of childbearing potential unless no alternative exists.",
                  terms: ["Valproate", "neural tube defects"],
                  source: "Harrison 22e Ch. 433"
                },
                {
                  fact: "Dravet syndrome (severe myoclonic epilepsy of infancy) is caused by loss-of-function mutations in SCN1A, presenting with prolonged febrile hemiclonus, where sodium channel blockers are strictly contraindicated.",
                  terms: ["Dravet syndrome", "SCN1A"],
                  source: "Adams & Victor 11e Ch. 16"
                }
              ]
            }
          ]
        },
        {
          id: "sne-nerve-conduction-emg",
          name: "Electromyography and nerve conduction studies",
          size: "l",
          topics: [
            {
              id: "sne-nerve-conduction-emg",
              title: "Electromyography and nerve conduction studies",
              book: "Adams & Victor 11e Ch. 43, 44; Harrison 22e Ch. 444",
              mustKnow: [
                {
                  fact: "Demyelinating neuropathies in electrodiagnostic studies are characterized by marked reduction in conduction velocity (>30% below normal), prolonged distal motor latencies (>130% of normal), and temporal dispersion or partial conduction block.",
                  terms: ["Demyelinating neuropathies", "conduction velocity"],
                  numbers: ["30%", "130%"],
                  source: "Adams & Victor 11e Ch. 44"
                },
                {
                  fact: "Axonal neuropathies predominantly feature reduced compound muscle action potential (CMAP) and sensory nerve action potential (SNAP) amplitudes with relatively preserved conduction velocities and distal latencies.",
                  terms: ["Axonal neuropathies", "action potential"],
                  source: "Adams & Victor 11e Ch. 44"
                },
                {
                  fact: "Spontaneous fibrillations and positive sharp waves on needle EMG represent muscle fiber denervation, appearing 2 to 3 weeks after acute motor axon transection or severe axonal injury.",
                  terms: ["positive sharp waves", "denervation"],
                  numbers: ["2", "3"],
                  source: "Adams & Victor 11e Ch. 43"
                },
                {
                  fact: "Fasciculation potentials represent spontaneous motor unit discharges that occur in neurogenic disorders like amyotrophic lateral sclerosis (ALS) as well as benign fasciculation syndrome.",
                  terms: ["Fasciculation potentials", "amyotrophic lateral sclerosis"],
                  source: "Adams & Victor 11e Ch. 43"
                },
                {
                  fact: "Myopathic needle EMG demonstrates small-amplitude, short-duration, polyphasic motor unit action potentials (MUAPs) accompanied by rapid, early recruitment despite weak effort.",
                  terms: ["Myopathic", "early recruitment"],
                  source: "Adams & Victor 11e Ch. 43"
                },
                {
                  fact: "Neurogenic motor units in chronic reinnervation are characterized by enlarged, long-duration, polyphasic MUAPs with reduced recruitment firing at high frequencies.",
                  terms: ["reinnervation", "polyphasic"],
                  source: "Adams & Victor 11e Ch. 43"
                },
                {
                  fact: "Myotonic discharges on EMG produce a characteristic waxing and waning high-frequency audio pattern resembling a dive-bomber, seen in myotonic dystrophy and myotonia congenita.",
                  terms: ["Myotonic discharges", "dive-bomber"],
                  source: "Adams & Victor 11e Ch. 43"
                },
                {
                  fact: "Repetitive nerve stimulation at low frequencies (2 to 3 Hz) demonstrates a decremental CMAP response (>10% drop between first and fourth stimulus) in postsynaptic disorders like myasthenia gravis.",
                  terms: ["Repetitive nerve stimulation", "myasthenia gravis"],
                  numbers: ["2", "3", "10%"],
                  source: "Adams & Victor 11e Ch. 46"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "sne-demyelination-sec",
      name: "Demyelinating and Neuroimmunological Disorders",
      modules: [
        {
          id: "sne-multiple-sclerosis",
          name: "Multiple sclerosis: diagnosis, phenotypes and pathology",
          size: "l",
          topics: [
            {
              id: "sne-multiple-sclerosis",
              title: "Multiple sclerosis: diagnosis, phenotypes and pathology",
              book: "Adams & Victor 11e Ch. 35; Harrison 22e Ch. 441; McDonald Criteria 2017",
              mustKnow: [
                {
                  fact: "McDonald criteria 2017 define dissemination in space (DIS) by demonstrating one or more T2-hyperintense lesions in at least two of four CNS locations: periventricular, cortical/juxtacortical, infratentorial, and spinal cord.",
                  terms: ["McDonald criteria", "dissemination in space"],
                  numbers: ["2017", "two", "four"],
                  source: "McDonald Criteria 2017 / Adams & Victor 11e Ch. 35"
                },
                {
                  fact: "Dissemination in time (DIT) can be satisfied on a single baseline MRI by the simultaneous presence of asymptomatic gadolinium-enhancing and non-enhancing lesions, or by the presence of CSF-specific oligoclonal bands.",
                  terms: ["Dissemination in time", "oligoclonal bands"],
                  source: "McDonald Criteria 2017 / Harrison 22e Ch. 441"
                },
                {
                  fact: "Dawson fingers represent demyelinating perivenular T2/FLAIR hyperintense plaques extending perpendicularly from the ventricular margins along deep medullary veins in multiple sclerosis.",
                  terms: ["Dawson fingers", "multiple sclerosis"],
                  source: "Adams & Victor 11e Ch. 35"
                },
                {
                  fact: "Lhermitte sign is an electric shock-like sensation radiating down the spine into the limbs upon neck flexion, reflecting posterior column cervical cord demyelination in multiple sclerosis.",
                  terms: ["Lhermitte sign", "cervical cord"],
                  source: "Adams & Victor 11e Ch. 35"
                },
                {
                  fact: "Uhthoff phenomenon describes temporary transient worsening of existing neurological symptoms triggered by elevated core body temperature, exercise, or hot baths in demyelinated axons.",
                  terms: ["Uhthoff phenomenon", "core body temperature"],
                  source: "Adams & Victor 11e Ch. 35"
                },
                {
                  fact: "Internuclear ophthalmoplegia (INO) results from a demyelinating lesion in the medial longitudinal fasciculus (MLF), manifesting as impaired adduction of the ipsilateral eye with horizontal nystagmus of the abducting contralateral eye.",
                  terms: ["Internuclear ophthalmoplegia", "medial longitudinal fasciculus"],
                  source: "Adams & Victor 11e Ch. 13"
                },
                {
                  fact: "CSF analysis in multiple sclerosis typically shows unique oligoclonal IgG bands absent in matching serum (type 2 pattern) and an elevated IgG index in over 85% to 90% of patients.",
                  terms: ["oligoclonal", "IgG index"],
                  numbers: ["85%", "90%"],
                  source: "Adams & Victor 11e Ch. 35"
                },
                {
                  fact: "Tumefactive multiple sclerosis presents with large demyelinating lesions (>2 cm) with mass effect and open-ring enhancement, where the incomplete open ring points towards the cerebral cortex.",
                  terms: ["Tumefactive", "open-ring enhancement"],
                  numbers: ["2"],
                  source: "Adams & Victor 11e Ch. 35"
                }
              ]
            }
          ]
        },
        {
          id: "sne-ms-therapy",
          name: "Disease-modifying therapies in multiple sclerosis",
          size: "l",
          topics: [
            {
              id: "sne-ms-therapy",
              title: "Disease-modifying therapies in multiple sclerosis",
              book: "Adams & Victor 11e Ch. 35; Harrison 22e Ch. 441",
              mustKnow: [
                {
                  fact: "Acute multiple sclerosis relapses are treated with high-dose intravenous methylprednisolone (1000 mg daily for 3 to 5 days), with plasma exchange (PLEX) indicated for severe corticosteroid-refractory relapses.",
                  terms: ["methylprednisolone", "plasma exchange"],
                  numbers: ["1000", "3", "5"],
                  source: "Adams & Victor 11e Ch. 35"
                },
                {
                  fact: "Natalizumab is a monoclonal antibody against alpha-4 integrin that blocks leukocyte extravasation into the CNS, but carries a high risk of progressive multifocal leukoencephalopathy (PML) in anti-JC virus antibody-positive patients.",
                  terms: ["Natalizumab", "alpha-4 integrin"],
                  source: "Harrison 22e Ch. 441"
                },
                {
                  fact: "Anti-CD20 monoclonal antibodies (ocrelizumab, ofatumumab, ublituximab) deplete B cells and show potent efficacy across relapsing-remitting MS, with ocrelizumab also approved for primary progressive MS.",
                  terms: ["ocrelizumab", "ofatumumab"],
                  source: "Adams & Victor 11e Ch. 35"
                },
                {
                  fact: "Sphingosine-1-phosphate (S1P) receptor modulators (fingolimod, siponimod, ozanimod, ponesimod) sequester lymphocytes in lymph nodes, requiring baseline screening for first-dose bradycardia and macular edema.",
                  terms: ["fingolimod", "macular edema"],
                  source: "Harrison 22e Ch. 441"
                },
                {
                  fact: "Cladribine is an oral synthetic purine nucleoside analogue that produces selective, intermittent depletion of T and B lymphocytes administered in short annual treatment pulses.",
                  terms: ["Cladribine", "purine nucleoside"],
                  source: "Adams & Victor 11e Ch. 35"
                },
                {
                  fact: "Dimethyl fumarate (and diroximel fumarate) activates the Nrf2 transcriptional pathway, mediating antioxidant neuroprotection with common side effects of flushing and gastrointestinal intolerance.",
                  terms: ["Dimethyl fumarate", "Nrf2"],
                  source: "Harrison 22e Ch. 441"
                },
                {
                  fact: "Teriflunomide inhibits dihydroorotate dehydrogenase (DHODH) to block de novo pyrimidine synthesis, requiring accelerated elimination with cholestyramine or activated charcoal in case of planned pregnancy.",
                  terms: ["Teriflunomide", "cholestyramine"],
                  source: "Adams & Victor 11e Ch. 35"
                },
                {
                  fact: "Alemtuzumab targets CD52 causing rapid lymphopenia, but requires 48 months of monthly monitoring due to risks of secondary autoimmune disorders such as thyroiditis and ITP.",
                  terms: ["Alemtuzumab", "CD52"],
                  numbers: ["48"],
                  source: "Adams & Victor 11e Ch. 35"
                }
              ]
            }
          ]
        },
        {
          id: "sne-nmo-mogad",
          name: "Neuromyelitis optica spectrum disorder and MOGAD",
          size: "l",
          topics: [
            {
              id: "sne-nmo-mogad",
              title: "Neuromyelitis optica spectrum disorder and MOGAD",
              book: "Adams & Victor 11e Ch. 35; Harrison 22e Ch. 441; IPND Guidelines",
              mustKnow: [
                {
                  fact: "Neuromyelitis optica spectrum disorder (NMOSD) is an autoantibody-mediated astrocytopathy targeting the aquaporin-4 (AQP4) water channel localized on astrocytic foot processes at the blood-brain barrier.",
                  terms: ["aquaporin-4", "astrocytopathy"],
                  source: "Adams & Victor 11e Ch. 35"
                },
                {
                  fact: "Longitudinally extensive transverse myelitis (LETM) is defined on spinal cord MRI by continuous T2 hyperintensity spanning 3 or more contiguous vertebral body segments, characteristic of NMOSD.",
                  terms: ["transverse myelitis", "contiguous vertebral"],
                  numbers: ["3"],
                  source: "IPND Guidelines / Harrison 22e Ch. 441"
                },
                {
                  fact: "Area postrema syndrome is a core clinical manifestation of NMOSD, producing intractable hiccups, nausea, and vomiting due to periventricular medullary inflammation in the dorsal brainstem.",
                  terms: ["Area postrema", "intractable hiccups"],
                  source: "IPND Guidelines / Adams & Victor 11e Ch. 35"
                },
                {
                  fact: "Targeted maintenance therapies approved for AQP4-IgG-positive NMOSD include eculizumab and ravulizumab (complement C5 inhibitors), satralizumab and inebilizumab (anti-CD19), and rituximab.",
                  terms: ["eculizumab", "satralizumab"],
                  source: "Adams & Victor 11e Ch. 35 / Harrison 22e Ch. 441"
                },
                {
                  fact: "Standard multiple sclerosis disease-modifying agents such as interferon-beta, natalizumab, and fingolimod may exacerbate or trigger catastrophic relapses in NMOSD and are strictly contraindicated.",
                  terms: ["interferon-beta", "NMOSD"],
                  source: "Adams & Victor 11e Ch. 35"
                },
                {
                  fact: "Myelin oligodendrocyte glycoprotein antibody-associated disease (MOGAD) is an oligodendrogliopathy presenting with bilateral optic neuritis with marked optic disc swelling, LETM, or acute disseminated encephalomyelitis (ADEM).",
                  terms: ["MOGAD", "oligodendrocyte glycoprotein"],
                  source: "MOGAD Consensus Criteria / Harrison 22e Ch. 441"
                },
                {
                  fact: "Optic neuritis in MOGAD typically shows longitudinally extensive retrobulbar optic nerve and perineural optic sheath enhancement with sparing of the optic chiasm, distinguishing it from AQP4-NMOSD.",
                  terms: ["optic sheath", "optic chiasm"],
                  source: "Adams & Victor 11e Ch. 35"
                },
                {
                  fact: "Acute disseminated encephalomyelitis (ADEM) presents in children with post-infectious encephalopathy and widespread multifocal, poorly marginated demyelinating white matter lesions on MRI, frequently associated with transient MOG-IgG positivity.",
                  terms: ["encephalomyelitis", "post-infectious"],
                  source: "Adams & Victor 11e Ch. 35"
                }
              ]
            }
          ]
        },
        {
          id: "sne-autoimmune-encephalitis",
          name: "Autoimmune encephalitis and paraneoplastic syndromes",
          size: "l",
          topics: [
            {
              id: "sne-autoimmune-encephalitis",
              title: "Autoimmune encephalitis and paraneoplastic syndromes",
              book: "Adams & Victor 11e Ch. 32; Harrison 22e Ch. 87; Graus Diagnostic Criteria",
              mustKnow: [
                {
                  fact: "Anti-NMDA receptor encephalitis typically affects young females, presenting with a multistage course of psychiatric symptoms, cognitive decline, seizures, movement disorders (orofacial dyskinesias), and autonomic instability.",
                  terms: ["NMDA receptor", "orofacial dyskinesias"],
                  source: "Adams & Victor 11e Ch. 32"
                },
                {
                  fact: "Anti-NMDA receptor encephalitis is strongly associated with underlying mature ovarian teratomas, requiring prompt pelvic MRI and transvaginal ultrasound followed by surgical resection.",
                  terms: ["ovarian teratomas", "Anti-NMDA receptor"],
                  source: "Adams & Victor 11e Ch. 32"
                },
                {
                  fact: "Extreme delta brush is a unique EEG pattern pathognomonic for anti-NMDA receptor encephalitis, consisting of rhythmic delta activity with superimposed fast beta activity.",
                  terms: ["Extreme delta brush", "rhythmic delta"],
                  source: "Adams & Victor 11e Ch. 32"
                },
                {
                  fact: "Anti-LGI1 encephalitis produces faciobrachial dystonic seizures (FBDS) characterized by brief, frequent unilateral facial grimacing and arm posturing, responding dramatically to early immunotherapy before cognitive decline ensues.",
                  terms: ["faciobrachial dystonic seizures", "Anti-LGI1"],
                  source: "Graus Criteria / Adams & Victor 11e Ch. 32"
                },
                {
                  fact: "Anti-CASPR2 encephalitis presents with Morvan syndrome, a clinical triad of neuromyotonia (continuous muscle fiber activity), autonomic hyperactivity, and severe insomnia with encephalopathy.",
                  terms: ["Morvan syndrome", "neuromyotonia"],
                  source: "Adams & Victor 11e Ch. 32"
                },
                {
                  fact: "Anti-Hu (ANNA-1) antibodies target intracellular neuronal antigens, strongly associated with small cell lung cancer (SCLC) and manifesting as paraneoplastic subacute sensory neuronopathy or encephalomyelitis.",
                  terms: ["Anti-Hu", "small cell lung cancer"],
                  source: "Adams & Victor 11e Ch. 32 / Harrison 22e Ch. 87"
                },
                {
                  fact: "Anti-Yo (PCA-1) antibodies occur in females with breast or ovarian malignancies, mediating subacute cerebellar degeneration through autoimmune destruction of Purkinje cells.",
                  terms: ["Anti-Yo", "Purkinje cells"],
                  source: "Adams & Victor 11e Ch. 32"
                },
                {
                  fact: "First-line immunotherapy for autoimmune encephalitis comprises intravenous methylprednisolone (1 g daily for 5 days), intravenous immunoglobulin (IVIG 2 g/kg), or therapeutic plasma exchange (PLEX).",
                  terms: ["immunoglobulin", "methylprednisolone"],
                  numbers: ["1", "5", "2"],
                  source: "Adams & Victor 11e Ch. 32"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "sne-movement-sec",
      name: "Movement Disorders",
      modules: [
        {
          id: "sne-parkinson-disease",
          name: "Parkinson disease and motor fluctuations",
          size: "l",
          topics: [
            {
              id: "sne-parkinson-disease",
              title: "Parkinson disease and motor fluctuations",
              book: "Adams & Victor 11e Ch. 37; Harrison 22e Ch. 437; MDS Clinical Diagnostic Criteria",
              mustKnow: [
                {
                  fact: "MDS clinical diagnostic criteria require parkinsonism defined as bradykinesia combined with at least one of rest tremor (4 to 6 Hz pill-rolling) or lead-pipe/cogwheel muscle rigidity.",
                  terms: ["bradykinesia", "parkinsonism"],
                  numbers: ["4", "6"],
                  source: "MDS Diagnostic Criteria / Harrison 22e Ch. 437"
                },
                {
                  fact: "The pathological hallmark of Parkinson disease is progressive loss of dopaminergic neurons in the substantia nigra pars compacta and presence of Lewy bodies containing aggregated alpha-synuclein.",
                  terms: ["substantia nigra", "alpha-synuclein"],
                  source: "Adams & Victor 11e Ch. 37"
                },
                {
                  fact: "Levodopa combined with a dopa-decarboxylase inhibitor (carbidopa or benserazide) remains the most effective symptomatic pharmacotherapy for motor symptoms of Parkinson disease.",
                  terms: ["Levodopa", "carbidopa"],
                  source: "Harrison 22e Ch. 437"
                },
                {
                  fact: "COMT inhibitors (entacapone, opicapone) and MAO-B inhibitors (rasagiline, safinamide) extend levodopa half-life to manage wearing-off motor fluctuations in advancing disease.",
                  terms: ["entacapone", "rasagiline"],
                  source: "Adams & Victor 11e Ch. 37"
                },
                {
                  fact: "Dopamine agonists (pramipexole, ropinirole, rotigotine) carry a recognized risk of impulse control disorders (pathological gambling, hypersexuality, binge eating) mediated by mesolimbic D3 receptors.",
                  terms: ["impulse control disorders", "pramipexole"],
                  source: "Adams & Victor 11e Ch. 37"
                },
                {
                  fact: "Amantadine is a non-competitive NMDA receptor antagonist that provides unique, evidence-based efficacy in suppressing levodopa-induced peak-dose choreiform dyskinesias.",
                  terms: ["Amantadine", "dyskinesias"],
                  source: "Adams & Victor 11e Ch. 37"
                },
                {
                  fact: "Deep brain stimulation (DBS) targeting the subthalamic nucleus (STN) or globus pallidus internus (GPi) significantly improves motor complications and dyskinesias in levodopa-responsive patients.",
                  terms: ["Deep brain stimulation", "subthalamic nucleus"],
                  source: "Harrison 22e Ch. 437"
                },
                {
                  fact: "REM sleep behaviour disorder (RBD), anosmia, and constipation frequently precede clinical motor manifestations of Parkinson disease by a decade or more.",
                  terms: ["sleep behaviour disorder", "anosmia"],
                  source: "MDS Criteria / Adams & Victor 11e Ch. 37"
                }
              ]
            }
          ]
        },
        {
          id: "sne-atypical-parkinsonism",
          name: "Atypical parkinsonian syndromes",
          size: "l",
          topics: [
            {
              id: "sne-atypical-parkinsonism",
              title: "Atypical parkinsonian syndromes",
              book: "Adams & Victor 11e Ch. 37; Harrison 22e Ch. 437",
              mustKnow: [
                {
                  fact: "Progressive supranuclear palsy (PSP, Steele-Richardson-Olszewski syndrome) features early unexplained backward falls, symmetric axial rigidity, retrocollis, and vertical supranuclear gaze palsy affecting downgaze first.",
                  terms: ["Progressive supranuclear palsy", "supranuclear gaze"],
                  source: "Adams & Victor 11e Ch. 37"
                },
                {
                  fact: "Midbrain atrophy in PSP produces the characteristic hummingbird sign (penguin sign) on midsagittal MRI and the Mickey Mouse sign on axial midbrain sections.",
                  terms: ["hummingbird sign", "midbrain atrophy"],
                  source: "Adams & Victor 11e Ch. 37"
                },
                {
                  fact: "Multiple system atrophy (MSA) is an alpha-synucleinopathy presenting with severe autonomic failure (orthostatic hypotension, neurogenic bladder) combined with either parkinsonism (MSA-P) or cerebellar ataxia (MSA-C).",
                  terms: ["Multiple system atrophy", "autonomic failure"],
                  source: "Adams & Victor 11e Ch. 37"
                },
                {
                  fact: "Brain MRI in MSA-C characteristically demonstrates the hot cross bun sign on T2-weighted axial images, representing selective degeneration of pontocerebellar transverse fibres and raphe nuclei.",
                  terms: ["hot cross bun sign", "pontocerebellar"],
                  source: "Adams & Victor 11e Ch. 37"
                },
                {
                  fact: "Corticobasal syndrome (CBS) is a 4R-tauopathy featuring asymmetric progressive limb dystonia, limb apraxia, cortical sensory loss, and alien limb phenomenon.",
                  terms: ["Corticobasal", "alien limb"],
                  source: "Adams & Victor 11e Ch. 37"
                },
                {
                  fact: "Dementia with Lewy bodies (DLB) is clinically diagnosed by progressive cognitive decline with core features of fluctuating cognition, recurrent detailed visual hallucinations, REM sleep behaviour disorder, and spontaneous parkinsonism.",
                  terms: ["Dementia with Lewy bodies", "visual hallucinations"],
                  source: "DLB Consensus Criteria / Harrison 22e Ch. 437"
                },
                {
                  fact: "Patients with Dementia with Lewy bodies exhibit severe, life-threatening neuroleptic sensitivity when exposed to typical first-generation antipsychotics.",
                  terms: ["neuroleptic sensitivity", "Lewy bodies"],
                  source: "Adams & Victor 11e Ch. 37"
                },
                {
                  fact: "Pathologically, PSP and corticobasal degeneration are four-repeat (4R) tauopathies with tufted astrocytes and astrocytic plaques respectively, whereas MSA and DLB are alpha-synucleinopathies with glial cytoplasmic inclusions.",
                  terms: ["tauopathies", "glial cytoplasmic inclusions"],
                  source: "Adams & Victor 11e Ch. 37"
                }
              ]
            }
          ]
        },
        {
          id: "sne-hyperkinetic-tremor-chorea",
          name: "Tremor, dystonia, chorea and ataxia",
          size: "l",
          topics: [
            {
              id: "sne-hyperkinetic-tremor-chorea",
              title: "Tremor, dystonia, chorea and ataxia",
              book: "Adams & Victor 11e Ch. 4, 37; Harrison 22e Ch. 437",
              mustKnow: [
                {
                  fact: "Essential tremor is an 8 to 12 Hz postural and kinetic action tremor predominantly involving the hands and head (titubation) that improves with alcohol and first-line therapy with propranolol or primidone.",
                  terms: ["Essential tremor", "propranolol"],
                  numbers: ["8", "12"],
                  source: "Adams & Victor 11e Ch. 4"
                },
                {
                  fact: "Huntington disease is an autosomal dominant neurodegenerative disorder caused by CAG trinucleotide repeat expansion (>36 repeats) in the HTT gene on chromosome 4p16.3, characterized by caudate nucleus atrophy and chorea.",
                  terms: ["Huntington disease", "caudate nucleus"],
                  numbers: ["36", "4"],
                  source: "Adams & Victor 11e Ch. 37"
                },
                {
                  fact: "Tetrabenazine and deutetrabenazine inhibit vesicular monoamine transporter 2 (VMAT2) to deplete presynaptic dopamine, serving as first-line therapy for Huntington chorea.",
                  terms: ["deutetrabenazine", "VMAT2"],
                  source: "Harrison 22e Ch. 437"
                },
                {
                  fact: "Wilson disease (hepatolenticular degeneration) results from autosomal recessive ATP7B gene mutations, featuring low ceruloplasmin, elevated 24-hour urinary copper, Kayser-Fleischer rings, and the face of the giant panda sign on midbrain MRI.",
                  terms: ["Wilson disease", "ceruloplasmin"],
                  numbers: ["24"],
                  source: "Adams & Victor 11e Ch. 37"
                },
                {
                  fact: "Cervical dystonia (spasmodic torticollis) is the most frequent focal dystonia, characterized by sensory tricks (geste antagoniste) that temporarily alleviate abnormal head postures, treated first-line with botulinum toxin injections.",
                  terms: ["Cervical dystonia", "botulinum toxin"],
                  source: "Adams & Victor 11e Ch. 4"
                },
                {
                  fact: "Dopa-responsive dystonia (Segawa syndrome) is an autosomal dominant disorder caused by mutations in GCH1 (GTP cyclohydrolase 1), presenting with diurnal fluctuation of foot dystonia that responds exquisitely to low-dose levodopa.",
                  terms: ["Segawa syndrome", "GCH1"],
                  source: "Adams & Victor 11e Ch. 37"
                },
                {
                  fact: "Friedreich ataxia is an autosomal recessive spinocerebellar degeneration caused by GAA trinucleotide expansions in the FXN gene (encoding frataxin), presenting with progressive sensory ataxia, absent reflexes, hypertrophic cardiomyopathy, and diabetes.",
                  terms: ["Friedreich ataxia", "frataxin"],
                  source: "Adams & Victor 11e Ch. 37"
                },
                {
                  fact: "Spinocerebellar ataxias (SCAs) represent autosomal dominant ataxias with cerebellar atrophy, where SCA1, SCA2, SCA3 (Machado-Joseph disease), SCA6, and SCA7 are polyglutamine disorders caused by translated CAG repeat expansions.",
                  terms: ["Spinocerebellar ataxias", "Machado-Joseph"],
                  numbers: ["1", "2", "3", "6", "7"],
                  source: "Adams & Victor 11e Ch. 37"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "sne-neuromuscular-sec",
      name: "Neuromuscular and Peripheral Nerve Disorders",
      modules: [
        {
          id: "sne-acquired-neuropathies",
          name: "Guillain-Barré syndrome and chronic neuropathies",
          size: "l",
          topics: [
            {
              id: "sne-acquired-neuropathies",
              title: "Guillain-Barré syndrome and chronic neuropathies",
              book: "Adams & Victor 11e Ch. 44; Harrison 22e Ch. 445; EFNS/PNS Guidelines",
              mustKnow: [
                {
                  fact: "Guillain-Barré syndrome (GBS) classically manifests as an acute, ascending, symmetrical flaccid quadriparesis with generalized hyporeflexia or areflexia, reaching nadir within 4 weeks.",
                  terms: ["Guillain-Barré syndrome", "quadriparesis"],
                  numbers: ["4"],
                  source: "Adams & Victor 11e Ch. 44"
                },
                {
                  fact: "Albuminocytological dissociation in CSF, defined as elevated protein with normal total leukocyte count (<50 cells/uL), is typical in GBS, though CSF protein may be normal within the first week.",
                  terms: ["Albuminocytological dissociation", "CSF"],
                  numbers: ["50"],
                  source: "Harrison 22e Ch. 445"
                },
                {
                  fact: "Miller Fisher syndrome is a distinct GBS variant characterized by the clinical triad of acute ophthalmoplegia, ataxia, and areflexia, strongly associated with anti-GQ1b ganglioside IgG antibodies in over 90% of cases.",
                  terms: ["Miller Fisher syndrome", "anti-GQ1b"],
                  numbers: ["90%"],
                  source: "Adams & Victor 11e Ch. 44"
                },
                {
                  fact: "First-line disease-modifying immunotherapies for Guillain-Barré syndrome are intravenous immunoglobulin (IVIG 0.4 g/kg/day for 5 days) or plasma exchange (PLEX), which have proven equal clinical efficacy.",
                  terms: ["immunoglobulin", "plasma exchange"],
                  numbers: ["0.4", "5"],
                  source: "Adams & Victor 11e Ch. 44"
                },
                {
                  fact: "Systemic corticosteroids administered alone are ineffective in Guillain-Barré syndrome and are not recommended for acute therapy.",
                  terms: ["corticosteroids", "Guillain-Barré"],
                  source: "Adams & Victor 11e Ch. 44 / Harrison 22e Ch. 445"
                },
                {
                  fact: "Chronic inflammatory demyelinating polyneuropathy (CIDP) is distinguished from GBS by progressive or relapsing sensory and motor deficits continuing beyond 8 weeks, responding favourably to IVIG, plasma exchange, or corticosteroids.",
                  terms: ["inflammatory demyelinating polyneuropathy", "CIDP"],
                  numbers: ["8"],
                  source: "EFNS/PNS CIDP Guidelines / Adams & Victor 11e Ch. 44"
                },
                {
                  fact: "Multifocal motor neuropathy (MMN) presents with asymmetric progressive distal upper limb motor weakness without sensory involvement, demonstrating persistent motor conduction block and high titers of anti-GM1 IgM antibodies.",
                  terms: ["Multifocal motor neuropathy", "anti-GM1"],
                  source: "Adams & Victor 11e Ch. 44"
                },
                {
                  fact: "Charcot-Marie-Tooth disease type 1A (CMT1A) is the most common hereditary motor and sensory neuropathy, caused by a 1.4 Mb duplication of the PMP22 gene on chromosome 17p11.2, resulting in uniform, symmetrical nerve conduction slowing.",
                  terms: ["Charcot-Marie-Tooth", "PMP22"],
                  numbers: ["1.4", "17"],
                  source: "Adams & Victor 11e Ch. 44"
                }
              ]
            }
          ]
        },
        {
          id: "sne-myasthenia-nmj",
          name: "Myasthenia gravis and junctional disorders",
          size: "l",
          topics: [
            {
              id: "sne-myasthenia-nmj",
              title: "Myasthenia gravis and junctional disorders",
              book: "Adams & Victor 11e Ch. 46; Harrison 22e Ch. 446; International MG Guidelines",
              mustKnow: [
                {
                  fact: "Myasthenia gravis is an autoimmune postsynaptic neuromuscular junction disorder caused by antibodies to acetylcholine receptors (AChR-Ab, present in 85% of generalized cases), muscle-specific kinase (MuSK), or LRP4.",
                  terms: ["acetylcholine receptors", "Myasthenia gravis"],
                  numbers: ["85%"],
                  source: "Adams & Victor 11e Ch. 46"
                },
                {
                  fact: "The clinical hallmark of myasthenia gravis is fluctuating, painless muscle weakness that worsens with repetitive activity and improves with rest, most commonly presenting with ptosis and diplopia.",
                  terms: ["ptosis", "muscle weakness"],
                  source: "Adams & Victor 11e Ch. 46"
                },
                {
                  fact: "Single-fiber electromyography (SFEMG) demonstrating increased jitter and impulse blocking is the most sensitive diagnostic electrophysiological test for myasthenia gravis (>95% sensitivity).",
                  terms: ["Single-fiber electromyography", "jitter"],
                  numbers: ["95%"],
                  source: "Adams & Victor 11e Ch. 46"
                },
                {
                  fact: "Chest CT or MRI is mandatory in all newly diagnosed myasthenia gravis patients to identify thymoma (present in 10% to 15% of patients) or thymic follicular hyperplasia.",
                  terms: ["thymoma", "thymic"],
                  numbers: ["10%", "15%"],
                  source: "Adams & Victor 11e Ch. 46"
                },
                {
                  fact: "Thymectomy improves clinical outcomes and reduces corticosteroid requirements in AChR-antibody-positive generalized myasthenia gravis patients aged 18 to 65 without thymoma according to the MGTX trial.",
                  terms: ["Thymectomy", "MGTX"],
                  numbers: ["18", "65"],
                  source: "MGTX Trial / Harrison 22e Ch. 446"
                },
                {
                  fact: "Myasthenic crisis with respiratory failure is managed in an intensive care setting with urgent plasma exchange or IVIG while temporarily discontinuing cholinesterase inhibitors to avoid excess airway secretions.",
                  terms: ["Myasthenic crisis", "cholinesterase inhibitors"],
                  source: "Adams & Victor 11e Ch. 46"
                },
                {
                  fact: "Lambert-Eaton myasthenic syndrome (LEMS) is a presynaptic disorder targeting voltage-gated P/Q-type calcium channels (VGCC), strongly linked to small cell lung cancer, characterized by hyporeflexia, dry mouth, and paradoxical post-exercise facilitation.",
                  terms: ["Lambert-Eaton", "calcium channels"],
                  source: "Adams & Victor 11e Ch. 46"
                },
                {
                  fact: "Repetitive nerve stimulation in LEMS demonstrates low baseline CMAP amplitude that displays dramatic increment (>100% increase) following high-frequency 20 to 50 Hz stimulation or 10 seconds of maximal isometric exercise.",
                  terms: ["Repetitive nerve stimulation", "increment"],
                  numbers: ["100%", "20", "50", "10"],
                  source: "Adams & Victor 11e Ch. 46"
                }
              ]
            }
          ]
        },
        {
          id: "sne-myopathies-muscular-dystrophies",
          name: "Myopathies, muscular dystrophies and motor neuron disease",
          size: "l",
          topics: [
            {
              id: "sne-myopathies-muscular-dystrophies",
              title: "Myopathies, muscular dystrophies and motor neuron disease",
              book: "Adams & Victor 11e Ch. 45, 47; Harrison 22e Ch. 443, 447",
              mustKnow: [
                {
                  fact: "Amyotrophic lateral sclerosis (ALS) is characterized by concurrent upper motor neuron (hyperreflexia, spasticity, Babinski sign) and lower motor neuron (fasciculations, wasting, flaccid weakness) degeneration without sensory involvement.",
                  terms: ["Amyotrophic lateral sclerosis", "fasciculations"],
                  source: "Adams & Victor 11e Ch. 45"
                },
                {
                  fact: "Duchenne muscular dystrophy is an X-linked recessive disorder caused by out-of-frame mutations in the DMD gene leading to complete absence of dystrophin, manifesting with calf pseudohypertrophy, Gowers sign, and extreme CK elevation (>10,000 U/L).",
                  terms: ["Duchenne muscular dystrophy", "dystrophin"],
                  numbers: ["10,000"],
                  source: "Adams & Victor 11e Ch. 47"
                },
                {
                  fact: "Becker muscular dystrophy results from in-frame mutations in DMD preserving partially functional truncated dystrophin, displaying a milder clinical course with later ambulatory loss.",
                  terms: ["Becker muscular dystrophy", "dystrophin"],
                  source: "Adams & Victor 11e Ch. 47"
                },
                {
                  fact: "Myotonic dystrophy type 1 (Steinert disease) is an autosomal dominant CTG trinucleotide repeat expansion (>50 repeats) in the DMPK gene on chromosome 19q13.3, manifesting with grip myotonia, frontal balding, cataracts, and cardiac conduction blocks.",
                  terms: ["Myotonic dystrophy", "DMPK"],
                  numbers: ["50", "19"],
                  source: "Adams & Victor 11e Ch. 47"
                },
                {
                  fact: "Dermatomyositis features proximal muscle weakness and pathognomonic cutaneous findings including heliotrope rash, Gottron papules, and shawl sign, showing perifascicular muscle fiber atrophy on muscle biopsy.",
                  terms: ["Dermatomyositis", "heliotrope rash"],
                  source: "Adams & Victor 11e Ch. 47"
                },
                {
                  fact: "Inclusion body myositis (IBM) typically affects males over age 50, featuring asymmetrical weakness of the deep finger flexors (flexor digitorum profundus) and quadriceps, with rimmed vacuoles on muscle biopsy.",
                  terms: ["Inclusion body myositis", "rimmed vacuoles"],
                  numbers: ["50"],
                  source: "Adams & Victor 11e Ch. 47"
                },
                {
                  fact: "Spinal muscular atrophy (SMA) is an autosomal recessive motor neuron disease caused by homozygous SMN1 gene deletions, treated with SMN-upregulating therapies like nusinersen, risdiplam, or onasemnogene abeparvovec.",
                  terms: ["Spinal muscular atrophy", "nusinersen"],
                  source: "Harrison 22e Ch. 443"
                },
                {
                  fact: "Riluzole (glutamate release inhibitor) and edaravone (free radical scavenger) are disease-modifying therapies that modestly prolong tracheostomy-free survival in patients with amyotrophic lateral sclerosis.",
                  terms: ["Riluzole", "edaravone"],
                  source: "Adams & Victor 11e Ch. 45"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "sne-cognitive-sec",
      name: "Cognitive, Cortical and Neurodegenerative Disorders",
      modules: [
        {
          id: "sne-cortical-syndromes",
          name: "Higher cortical functions, aphasia and apraxia",
          size: "l",
          topics: [
            {
              id: "sne-cortical-syndromes",
              title: "Higher cortical functions, aphasia and apraxia",
              book: "Adams & Victor 11e Ch. 22; Harrison 22e Ch. 31",
              mustKnow: [
                {
                  fact: "Broca aphasia (expressive, motor aphasia) localizes to the posterior inferior frontal gyrus (Brodmann areas 44 and 45), producing non-fluent, effortful, agrammatic speech with intact auditory comprehension but impaired repetition.",
                  terms: ["Broca aphasia", "Brodmann"],
                  numbers: ["44", "45"],
                  source: "Adams & Victor 11e Ch. 22"
                },
                {
                  fact: "Wernicke aphasia (receptive, sensory aphasia) localizes to the posterior superior temporal gyrus (Brodmann area 22), presenting with fluent, paraphasic speech, profound comprehension loss, and severely impaired repetition.",
                  terms: ["Wernicke aphasia", "temporal gyrus"],
                  numbers: ["22"],
                  source: "Adams & Victor 11e Ch. 22"
                },
                {
                  fact: "Conduction aphasia results from disruption of the arcuate fasciculus connecting Wernicke and Broca areas, characterized by intact auditory comprehension and fluent speech but prominent impairment of repetition and phonemic paraphasias.",
                  terms: ["Conduction aphasia", "arcuate fasciculus"],
                  source: "Adams & Victor 11e Ch. 22"
                },
                {
                  fact: "Gerstmann syndrome localizes to the left (dominant) angular gyrus of the inferior parietal lobule, comprising the tetrad of finger agnosia, left-right disorientation, agraphia without alexia, and acalculia.",
                  terms: ["Gerstmann syndrome", "angular gyrus"],
                  source: "Adams & Victor 11e Ch. 22"
                },
                {
                  fact: "Hemispatial neglect syndrome (inattention) characteristically occurs following acute destructive lesions of the non-dominant right inferior parietal lobule or temporoparietal junction.",
                  terms: ["Hemispatial neglect", "inferior parietal lobule"],
                  source: "Adams & Victor 11e Ch. 22"
                },
                {
                  fact: "Balint syndrome localizes to bilateral parieto-occipital cortical lesions, producing the clinical triad of optic ataxia (inability to reach visually guided targets), ocular apraxia (inability to direct voluntary saccades), and simultanagnosia.",
                  terms: ["Balint syndrome", "simultanagnosia"],
                  source: "Adams & Victor 11e Ch. 22"
                },
                {
                  fact: "Anton syndrome (visual anosognosia) occurs with extensive bilateral striate occipital cortex infarction, where patients are cortically blind yet adamantly deny blindness and confabulate visual experiences.",
                  terms: ["Anton syndrome", "visual anosognosia"],
                  source: "Adams & Victor 11e Ch. 22"
                },
                {
                  fact: "Klüver-Bucy syndrome results from bilateral anterior temporal lobe damage involving the amygdalae, producing hyperorality, hypersexuality, psychic blindness (visual agnosia), docility, and dietary alterations.",
                  terms: ["Klüver-Bucy syndrome", "amygdalae"],
                  source: "Adams & Victor 11e Ch. 22"
                }
              ]
            }
          ]
        },
        {
          id: "sne-dementia-alzheimer",
          name: "Alzheimer disease and frontotemporal dementia",
          size: "l",
          topics: [
            {
              id: "sne-dementia-alzheimer",
              title: "Alzheimer disease and frontotemporal dementia",
              book: "Adams & Victor 11e Ch. 37; Harrison 22e Ch. 438; NIA-AA Guidelines",
              mustKnow: [
                {
                  fact: "Alzheimer disease neuropathology is defined by extracellular amyloid-beta 42 senile plaques and intracellular neurofibrillary tangles composed of hyperphosphorylated tau protein.",
                  terms: ["Alzheimer disease", "neurofibrillary tangles"],
                  numbers: ["42"],
                  source: "Adams & Victor 11e Ch. 37"
                },
                {
                  fact: "Early-onset familial Alzheimer disease is caused by autosomal dominant mutations in APP (chromosome 21), PSEN1 (presenilin 1 on chromosome 14), and PSEN2 (chromosome 1), while APOE epsilon-4 on chromosome 19 is the major genetic risk factor for late-onset disease.",
                  terms: ["presenilin", "APOE"],
                  numbers: ["21", "14", "1", "19"],
                  source: "Harrison 22e Ch. 438"
                },
                {
                  fact: "CSF and plasma biomarkers for Alzheimer disease demonstrate decreased amyloid-beta 42/40 ratio accompanied by elevated levels of phosphorylated tau (p-tau181, p-tau217).",
                  terms: ["amyloid-beta", "phosphorylated tau"],
                  numbers: ["42/40", "181", "217"],
                  source: "NIA-AA Diagnostic Guidelines"
                },
                {
                  fact: "Behavioral variant frontotemporal dementia (bvFTD) presents with early disinhibition, apathy, loss of empathy, hyperorality, and compulsive stereotyped behaviours associated with focal frontal and anterior temporal atrophy.",
                  terms: ["frontotemporal dementia", "disinhibition"],
                  source: "Adams & Victor 11e Ch. 37"
                },
                {
                  fact: "Semantic variant primary progressive aphasia (svPPA) features progressive loss of word meaning and object knowledge (confrontation naming loss) with preserved fluency, linked to anterior inferior temporal lobe atrophy.",
                  terms: ["primary progressive aphasia", "confrontation naming"],
                  source: "Adams & Victor 11e Ch. 37"
                },
                {
                  fact: "Normal pressure hydrocephalus (NPH) presents with the classic Hakim-Adams triad of gait apraxia (magnetic gait), urinary incontinence, and progressive cognitive impairment, showing ventriculomegaly disproportionate to sulcal enlargement (DESH) on MRI.",
                  terms: ["Normal pressure hydrocephalus", "Hakim-Adams"],
                  source: "Adams & Victor 11e Ch. 29"
                },
                {
                  fact: "High-volume therapeutic lumbar puncture (tap test with 30 to 50 mL removal) that produces objective gait velocity improvement confirms shunt-responsiveness in normal pressure hydrocephalus.",
                  terms: ["lumbar puncture", "gait velocity"],
                  numbers: ["30", "50"],
                  source: "Adams & Victor 11e Ch. 29"
                },
                {
                  fact: "Anti-amyloid monoclonal antibodies (lecanemab and donanemab) clear cerebral amyloid-beta plaques in early symptomatic Alzheimer disease, requiring MRI surveillance for amyloid-related imaging abnormalities (ARIA-E and ARIA-H).",
                  terms: ["lecanemab", "donanemab"],
                  source: "Harrison 22e Ch. 438"
                }
              ]
            }
          ]
        },
        {
          id: "sne-neurometabolic-storage",
          name: "Prion diseases and adult neurometabolic storage disorders",
          size: "l",
          topics: [
            {
              id: "sne-neurometabolic-storage",
              title: "Prion diseases and adult neurometabolic storage disorders",
              book: "Adams & Victor 11e Ch. 32, 36; Harrison 22e Ch. 439, 448",
              mustKnow: [
                {
                  fact: "Sporadic Creutzfeldt-Jakob disease (sCJD) manifests with rapidly progressive dementia, startle myoclonus, ataxia, and visual abnormalities, leading to death typically within 6 to 12 months.",
                  terms: ["Creutzfeldt-Jakob disease", "startle myoclonus"],
                  numbers: ["6", "12"],
                  source: "Adams & Victor 11e Ch. 32"
                },
                {
                  fact: "Brain MRI in Creutzfeldt-Jakob disease demonstrates striking cortical ribboning (hyperintensity along cerebral gyri on DWI and FLAIR) and hyperintensity in the caudate and anterior putamen (hockey-stick sign in the pulvinar in variant CJD).",
                  terms: ["cortical ribboning", "hockey-stick sign"],
                  source: "Adams & Victor 11e Ch. 32"
                },
                {
                  fact: "Real-time quaking-induced conversion (RT-QuIC) assay in CSF provides definitive diagnosis of sporadic CJD with greater than 95% sensitivity and near 100% specificity by detecting pathologically misfolded prion protein (PrPSc).",
                  terms: ["RT-QuIC", "prion protein"],
                  numbers: ["95%", "100%"],
                  source: "CDC / WHO CJD Criteria / Harrison 22e Ch. 439"
                },
                {
                  fact: "Adrenoleukodystrophy (X-linked ALD) is caused by ABCD1 gene mutations impairing peroxisomal beta-oxidation, leading to accumulation of very long chain fatty acids (VLCFAs) with posterior white matter demyelination and adrenal insufficiency.",
                  terms: ["Adrenoleukodystrophy", "fatty acids"],
                  source: "Adams & Victor 11e Ch. 36"
                },
                {
                  fact: "Gaucher disease type 1 is the most common lysosomal storage disease, caused by glucocerebrosidase (GBA) deficiency, presenting with hepatosplenomegaly, bone crises, Erlenmeyer flask deformity, and lipid-laden Gaucher cells with crinkled paper appearance.",
                  terms: ["Gaucher disease", "glucocerebrosidase"],
                  numbers: ["1"],
                  source: "Harrison 22e Ch. 448"
                },
                {
                  fact: "Niemann-Pick disease type C is a lysosomal lipid trafficking disorder caused by mutations in NPC1 or NPC2, presenting with progressive supranuclear vertical gaze palsy, cerebellar ataxia, and gelastic cataplexy.",
                  terms: ["Niemann-Pick", "vertical gaze"],
                  source: "Adams & Victor 11e Ch. 36"
                },
                {
                  fact: "Tay-Sachs disease results from hexosaminidase A deficiency with accumulation of GM2 ganglioside, featuring neurodegeneration, hyperacusis, and a pathognomonic cherry-red spot at the macula without hepatosplenomegaly.",
                  terms: ["Tay-Sachs", "cherry-red spot"],
                  numbers: ["2"],
                  source: "Adams & Victor 11e Ch. 36"
                },
                {
                  fact: "Krabbe disease (globoid cell leukodystrophy) results from galactocerebrosidase (GALC) deficiency, producing severe demyelination with accumulation of cytotoxic psychosine and globoid multinucleated macrophages.",
                  terms: ["Krabbe disease", "galactocerebrosidase"],
                  source: "Adams & Victor 11e Ch. 36"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "sne-infections-headache-sec",
      name: "CNS Infections, Headache and Neuro-Oncology",
      modules: [
        {
          id: "sne-cns-infections",
          name: "Bacterial, viral and fungal CNS infections",
          size: "l",
          topics: [
            {
              id: "sne-cns-infections",
              title: "Bacterial, viral and fungal CNS infections",
              book: "Adams & Victor 11e Ch. 31, 32; Harrison 22e Ch. 138, 143; IDSA Guidelines",
              mustKnow: [
                {
                  fact: "Empiric antimicrobial therapy for community-acquired acute bacterial meningitis in adults aged 18 to 50 comprises intravenous ceftriaxone (2 g every 12 hours) plus vancomycin (15-20 mg/kg every 8-12 hours), adding ampicillin for adults over 50 to cover Listeria monocytogenes.",
                  terms: ["ceftriaxone", "vancomycin"],
                  numbers: ["18", "50", "2", "12", "15-20", "8-12"],
                  source: "IDSA Meningitis Guidelines / Harrison 22e Ch. 138"
                },
                {
                  fact: "Adjunctive intravenous dexamethasone (10 mg every 6 hours for 4 days) initiated before or with the first antibiotic dose significantly reduces mortality and hearing loss in Streptococcus pneumoniae meningitis.",
                  terms: ["dexamethasone", "Streptococcus pneumoniae"],
                  numbers: ["10", "6", "4"],
                  source: "IDSA Guidelines / Adams & Victor 11e Ch. 31"
                },
                {
                  fact: "Herpes simplex virus encephalitis (HSV-1) characteristically causes focal necrotizing encephalitis of the temporal and inferior frontal lobes, diagnosed by CSF HSV PCR and treated urgently with intravenous acyclovir (10 mg/kg every 8 hours for 14 to 21 days).",
                  terms: ["acyclovir", "Herpes simplex virus"],
                  numbers: ["1", "10", "8", "14", "21"],
                  source: "Adams & Victor 11e Ch. 32"
                },
                {
                  fact: "Tuberculous meningitis typically produces thick, gelatinous basilar meningeal exudate, cranial nerve neuropathies (especially CN III and VI), hydrocephalus, and obliterative endarteritis leading to basal ganglia lacunar infarctions.",
                  terms: ["Tuberculous meningitis", "basilar meningeal"],
                  source: "Adams & Victor 11e Ch. 31"
                },
                {
                  fact: "Cryptococcal meningitis in immunocompromised patients presents with high opening CSF pressure (>250 mmH2O), positive India ink stain, and CSF cryptococcal antigen, treated induction with liposomal amphotericin B plus flucytosine.",
                  terms: ["Cryptococcal meningitis", "amphotericin B"],
                  numbers: ["250"],
                  source: "IDSA Cryptococcal Guidelines / Harrison 22e Ch. 143"
                },
                {
                  fact: "Neurocysticercosis caused by Taenia solium larval stages demonstrates non-viable calcified granulomas or active cysticerci with mural nodules representing the invaginated scolex (hole-with-dot sign on neuroimaging).",
                  terms: ["Neurocysticercosis", "scolex"],
                  source: "Adams & Victor 11e Ch. 31"
                },
                {
                  fact: "CNS toxoplasmosis in HIV presents with multiple ring-enhancing subcortical lesions with marked surrounding vasogenic edema, treated first-line with pyrimethamine, sulfadiazine, and leucovorin.",
                  terms: ["toxoplasmosis", "pyrimethamine"],
                  source: "Adams & Victor 11e Ch. 31"
                },
                {
                  fact: "Brain abscesses demonstrate classic rim enhancement with restriction of diffusion within the necrotic purulent core on diffusion-weighted MRI, distinguishing them from necrotic high-grade glioblastomas.",
                  terms: ["Brain abscesses", "restriction of diffusion"],
                  source: "Adams & Victor 11e Ch. 31"
                }
              ]
            }
          ]
        },
        {
          id: "sne-hiv-opportunistic-neuro",
          name: "HIV neurology and opportunistic neuro-infections",
          size: "l",
          topics: [
            {
              id: "sne-hiv-opportunistic-neuro",
              title: "HIV neurology and opportunistic neuro-infections",
              book: "Adams & Victor 11e Ch. 32; Harrison 22e Ch. 202, 442",
              mustKnow: [
                {
                  fact: "HIV-associated neurocognitive disorder (HAND) encompasses asymptomatic neurocognitive impairment (ANI), mild neurocognitive disorder (MND), and HIV-associated dementia (HAD), driven by productive viral infection of perivascular macrophages and microglia.",
                  terms: ["neurocognitive", "macrophages"],
                  source: "Frascati Criteria / Harrison 22e Ch. 202"
                },
                {
                  fact: "Progressive multifocal leukoencephalopathy (PML) is caused by JC polyomavirus reactivation in severe immunosuppression, producing demyelinating white matter lesions that involve subcortical U-fibers without mass effect or enhancement on MRI.",
                  terms: ["Progressive multifocal leukoencephalopathy", "polyomavirus"],
                  source: "Adams & Victor 11e Ch. 32"
                },
                {
                  fact: "Primary CNS lymphoma (PCNSL) in HIV is an Epstein-Barr virus (EBV)-driven diffuse large B-cell lymphoma that typically appears as dense periventricular or subependymal enhancing lesions positive for EBV DNA in CSF by PCR.",
                  terms: ["Primary CNS lymphoma", "Epstein-Barr virus"],
                  source: "Adams & Victor 11e Ch. 31"
                },
                {
                  fact: "Thallium-201 SPECT or FDG-PET imaging differentiates hypermetabolic primary CNS lymphoma from hypometabolic infectious cerebral toxoplasmosis lesions in HIV patients with intracranial ring-enhancing masses.",
                  terms: ["thrombosis", "toxoplasmosis"],
                  numbers: ["201"],
                  source: "Adams & Victor 11e Ch. 31"
                },
                {
                  fact: "Immune reconstitution inflammatory syndrome (IRIS) in HIV occurs following initiation of antiretroviral therapy (ART), where paradoxical clinical worsening is driven by vigorous recovery of pathogen-specific CD4 T-cell immune responses.",
                  terms: ["reconstitution inflammatory syndrome", "antiretroviral therapy"],
                  numbers: ["4"],
                  source: "Harrison 22e Ch. 202"
                },
                {
                  fact: "In patients presenting with HIV and acute cryptococcal meningitis, antiretroviral therapy is intentionally delayed for 2 to 6 weeks following initiation of antifungal therapy to avoid fatal intracranial IRIS.",
                  terms: ["cryptococcal meningitis", "antiretroviral therapy"],
                  numbers: ["2", "6"],
                  source: "IDSA / WHO Guidelines / Adams & Victor 11e Ch. 32"
                },
                {
                  fact: "Cytomegalovirus (CMV) encephalitis in advanced AIDS (CD4 count <50 cells/uL) presents as acute necrotizing ventriculoencephalitis with periventricular subependymal enhancement, treated with intravenous ganciclovir and foscarnet.",
                  terms: ["Cytomegalovirus", "ganciclovir"],
                  numbers: ["4", "50"],
                  source: "Harrison 22e Ch. 202"
                },
                {
                  fact: "HIV distal sensory polyneuropathy is a symmetrical, length-dependent axonal painful neuropathy that must be differentiated from antiretroviral toxic neuropathy caused by older nucleoside reverse transcriptase inhibitors.",
                  terms: ["sensory polyneuropathy", "reverse transcriptase inhibitors"],
                  source: "Adams & Victor 11e Ch. 44"
                }
              ]
            }
          ]
        },
        {
          id: "sne-headache-cranial-neuralgias",
          name: "Headache disorders and cranial neuralgias",
          size: "l",
          topics: [
            {
              id: "sne-headache-cranial-neuralgias",
              title: "Headache disorders and cranial neuralgias",
              book: "Adams & Victor 11e Ch. 9; Harrison 22e Ch. 431; ICHD-3 Classification",
              mustKnow: [
                {
                  fact: "Migraine is diagnosed by ICHD-3 criteria requiring at least 5 attacks lasting 4 to 72 hours with unilateral, pulsating quality, moderate to severe intensity, aggravation by routine physical activity, and association with nausea, vomiting, photophobia, or phonophobia.",
                  terms: ["Migraine", "ICHD-3"],
                  numbers: ["5", "4", "72"],
                  source: "ICHD-3 Headache Classification / Harrison 22e Ch. 431"
                },
                {
                  fact: "Calcitonin gene-related peptide (CGRP) receptor antagonists (rimegepant, ubrogepant, zavegepant) and 5-HT1F receptor agonists (lasmiditan) provide effective acute migraine abortive therapy without vasoconstrictive cardiovascular risks.",
                  terms: ["Calcitonin gene-related peptide", "lasmiditan"],
                  numbers: ["5"],
                  source: "Harrison 22e Ch. 431"
                },
                {
                  fact: "Cluster headache is a severe trigeminal autonomic cephalalgia characterized by strictly unilateral, orbital/supraorbital pain lasting 15 to 180 minutes, accompanied by ipsilateral conjunctival injection, lacrimation, rhinorrhea, and restlessness.",
                  terms: ["Cluster headache", "trigeminal autonomic cephalalgia"],
                  numbers: ["15", "180"],
                  source: "Adams & Victor 11e Ch. 9"
                },
                {
                  fact: "Acute cluster headache attacks are treated with 100% high-flow normobaric oxygen (12 to 15 L/min via non-rebreather mask) and subcutaneous sumatriptan (6 mg), with oral verapamil as the first-line preventive therapy.",
                  terms: ["oxygen", "sumatriptan"],
                  numbers: ["100%", "12", "15", "6"],
                  source: "Adams & Victor 11e Ch. 9"
                },
                {
                  fact: "Trigeminal neuralgia manifests with excruciating, electric shock-like paroxysmal facial pain in the V2 and V3 sensory divisions triggered by light cutaneous stimuli, most commonly caused by neurovascular compression by the superior cerebellar artery.",
                  terms: ["Trigeminal neuralgia", "superior cerebellar artery"],
                  source: "Adams & Victor 11e Ch. 9"
                },
                {
                  fact: "Carbamazepine (200 to 1200 mg daily) and oxcarbazepine represent established first-line medical therapy for trigeminal neuralgia, with microvascular decompression (Janetta procedure) providing definitive surgical cure for vascular loops.",
                  terms: ["Carbamazepine", "oxcarbazepine"],
                  numbers: ["200", "1200"],
                  source: "AAN Guidelines / Adams & Victor 11e Ch. 9"
                },
                {
                  fact: "Idiopathic intracranial hypertension (pseudotumor cerebri) typically occurs in obese females of childbearing age, presenting with papilledema, sixth nerve palsies, pulsatile tinnitus, and elevated opening pressure (>25 cmH2O) with normal CSF constituents.",
                  terms: ["intracranial hypertension", "papilledema"],
                  numbers: ["25"],
                  source: "Friedman Modified Dandy Criteria / Adams & Victor 11e Ch. 30"
                },
                {
                  fact: "Spontaneous intracranial hypotension results from spontaneous spinal CSF leaks, presenting with orthostatic headache that worsens within 15 minutes of standing and relieves on recumbency, showing pachymeningeal enhancement and brain sagging on MRI.",
                  terms: ["orthostatic headache", "pachymeningeal enhancement"],
                  numbers: ["15"],
                  source: "Adams & Victor 11e Ch. 30"
                }
              ]
            }
          ]
        },
        {
          id: "sne-neuro-oncology-tumours",
          name: "Brain tumours and neuro-oncology",
          size: "l",
          topics: [
            {
              id: "sne-neuro-oncology-tumours",
              title: "Brain tumours and neuro-oncology",
              book: "Adams & Victor 11e Ch. 30; Harrison 22e Ch. 86; WHO CNS5 Classification",
              mustKnow: [
                {
                  fact: "Glioblastoma IDH-wildtype is classified as WHO grade 4, defined molecularly in adult diffuse astrocytic gliomas by wildtype IDH1/2 along with TERT promoter mutation, EGFR gene amplification, or combined +7/-10 chromosomal copy number alterations.",
                  terms: ["Glioblastoma", "IDH-wildtype"],
                  numbers: ["4", "1/2", "+7/-10"],
                  source: "WHO CNS5 Classification 2021 / Harrison 22e Ch. 86"
                },
                {
                  fact: "The Stupp protocol for newly diagnosed glioblastoma comprises maximal safe surgical resection followed by concurrent radiotherapy (60 Gy in 30 fractions) plus daily temozolomide (75 mg/m2), followed by 6 cycles of adjuvant temozolomide.",
                  terms: ["temozolomide", "Stupp"],
                  numbers: ["60", "30", "75", "6"],
                  source: "Stupp Protocol / Harrison 22e Ch. 86"
                },
                {
                  fact: "Oligodendroglioma diagnosis by WHO CNS5 requires both an IDH mutation (IDH1 or IDH2) and complete codeletion of chromosomal arms 1p and 19q (1p/19q codeletion), conferring superior chemosensitivity to PCV chemotherapy.",
                  terms: ["Oligodendroglioma", "codeletion"],
                  numbers: ["1", "2", "1", "19"],
                  source: "WHO CNS5 Classification"
                },
                {
                  fact: "MGMT (O-6-methylguanine-DNA methyltransferase) promoter methylation in glioblastoma silences the DNA repair enzyme, conferring marked chemosensitivity to temozolomide and independently predicting improved overall survival.",
                  terms: ["promoter methylation", "temozolomide"],
                  numbers: ["6"],
                  source: "Harrison 22e Ch. 86"
                },
                {
                  fact: "Pilocytic astrocytoma is a benign, circumscribed WHO grade 1 glioma typically arising in the cerebellum of children, characterized histopathologically by bipolar piloid cells with Rosenthal fibers and eosinophilic granular bodies.",
                  terms: ["Pilocytic astrocytoma", "Rosenthal fibers"],
                  numbers: ["1"],
                  source: "WHO CNS5 / Adams & Victor 11e Ch. 30"
                },
                {
                  fact: "Medulloblastoma is a malignant WHO grade 4 embryonal small round blue cell tumour of the posterior fossa in children, stratified by consensus molecular subgroups into WNT-activated, SHH-activated, Group 3, and Group 4.",
                  terms: ["Medulloblastoma", "small round blue cell"],
                  numbers: ["4", "3", "4"],
                  source: "WHO CNS5 Classification"
                },
                {
                  fact: "Meningiomas arise from arachnoid cap cells, demonstrating vivid homogeneous contrast enhancement with a dural tail sign on brain MRI, with the majority being benign WHO grade 1 neoplasms.",
                  terms: ["Meningiomas", "dural tail"],
                  numbers: ["1"],
                  source: "Adams & Victor 11e Ch. 30"
                },
                {
                  fact: "Vestibular schwannoma (acoustic neuroma) arises from the vestibular division of the eighth cranial nerve at the internal auditory canal, presenting with progressive asymmetrical sensorineural hearing loss, tinnitus, and vestibular dysfunction.",
                  terms: ["Vestibular schwannoma", "internal auditory canal"],
                  source: "Adams & Victor 11e Ch. 30"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: "sne-neurogenetics-cranial-sec",
      name: "Neurogenetics, Cranial Nerves and Spine",
      modules: [
        {
          id: "sne-neurocutaneous-syndromes",
          name: "Neurocutaneous syndromes and phakomatoses",
          size: "l",
          topics: [
            {
              id: "sne-neurocutaneous-syndromes",
              title: "Neurocutaneous syndromes and phakomatoses",
              book: "Adams & Victor 11e Ch. 37, 38; Harrison 22e Ch. 448",
              mustKnow: [
                {
                  fact: "Neurofibromatosis type 1 (NF1, von Recklinghausen disease) is an autosomal dominant disorder caused by mutations in the NF1 gene encoding neurofibromin on chromosome 17q11.2, characterized by café-au-lait macules, neurofibromas, and Lisch nodules.",
                  terms: ["Neurofibromatosis type 1", "neurofibromin"],
                  numbers: ["1", "17"],
                  source: "Adams & Victor 11e Ch. 38"
                },
                {
                  fact: "Diagnostic criteria for NF1 require two or more features including: 6 or more café-au-lait macules (>5 mm prepubertal or >15 mm postpubertal), axillary/inguinal freckling (Crowe sign), 2 or more neurofibromas, optic pathway glioma, and 2 or more iris Lisch nodules.",
                  terms: ["café-au-lait", "Crowe sign"],
                  numbers: ["6", "5", "15", "2", "2"],
                  source: "NIH NF1 Diagnostic Criteria"
                },
                {
                  fact: "Neurofibromatosis type 2 (NF2) is caused by mutations in the NF2 gene on chromosome 22q12.2 encoding merlin (schwannomin), defined by bilateral vestibular schwannomas, meningiomas, and spinal ependymomas (MISME syndrome).",
                  terms: ["vestibular schwannomas", "schwannomin"],
                  numbers: ["2", "22"],
                  source: "Adams & Victor 11e Ch. 38"
                },
                {
                  fact: "Tuberous sclerosis complex (TSC) is caused by mutations in TSC1 (hamartin on chromosome 9q34) or TSC2 (tuberin on chromosome 16p13.3), leading to hyperactivation of the mechanistic target of rapamycin (mTOR) signaling pathway.",
                  terms: ["Tuberous sclerosis", "hamartin"],
                  numbers: ["1", "9", "2", "16"],
                  source: "Adams & Victor 11e Ch. 38"
                },
                {
                  fact: "Major clinical features of tuberous sclerosis include facial angiofibromas, ash-leaf hypomelanotic macules, shagreen patches, subependymal giant cell astrocytomas (SEGA), cardiac rhabdomyomas, and renal angiomyolipomas.",
                  terms: ["angiofibromas", "astrocytomas"],
                  source: "International TSC Consensus Criteria"
                },
                {
                  fact: "mTOR inhibitors (everolimus and sirolimus) are approved targeted therapies that shrink subependymal giant cell astrocytomas and renal angiomyolipomas in tuberous sclerosis complex.",
                  terms: ["everolimus", "angiomyolipomas"],
                  source: "Harrison 22e Ch. 448"
                },
                {
                  fact: "Sturge-Weber syndrome (encephalotrigeminal angiomatosis) is a non-familial neurocutaneous condition caused by somatic mosaic mutations in GNAQ, presenting with a facial port-wine stain in the V1 distribution and leptomeningeal angiomatosis with gyriform tram-track cortical calcifications.",
                  terms: ["Sturge-Weber", "tram-track"],
                  numbers: ["1"],
                  source: "Adams & Victor 11e Ch. 38"
                },
                {
                  fact: "Von Hippel-Lindau disease (VHL) is an autosomal dominant condition linked to the VHL tumor suppressor gene on chromosome 3p25, predisposing to capillary hemangioblastomas of the cerebellum and retina, clear cell renal cell carcinoma, and pheochromocytomas.",
                  terms: ["Von Hippel-Lindau", "hemangioblastomas"],
                  numbers: ["3"],
                  source: "Adams & Victor 11e Ch. 38"
                }
              ]
            }
          ]
        },
        {
          id: "sne-pupil-visual-pathway",
          name: "Neuro-ophthalmology, pupils and cranial neuropathies",
          size: "l",
          topics: [
            {
              id: "sne-pupil-visual-pathway",
              title: "Neuro-ophthalmology, pupils and cranial neuropathies",
              book: "Adams & Victor 11e Ch. 12, 13; Harrison 22e Ch. 33",
              mustKnow: [
                {
                  fact: "Relative afferent pupillary defect (RAPD or Marcus Gunn pupil) indicates asymmetric anterior visual pathway pathology (optic nerve or severe retinal disease), diagnosed by paradoxical pupillary dilatation when light swings from the healthy to the affected eye.",
                  terms: ["pupillary defect", "Marcus Gunn"],
                  source: "Adams & Victor 11e Ch. 13"
                },
                {
                  fact: "Horner syndrome results from disruption of the oculosympathetic pathway, characterized by the classic ipsilateral triad of miosis, partial ptosis (due to Müller muscle paresis), and anhidrosis.",
                  terms: ["Horner syndrome", "miosis"],
                  source: "Adams & Victor 11e Ch. 13"
                },
                {
                  fact: "First-order oculosympathetic pathway lesions localize between the hypothalamus and the ciliospinal center of Budge (C8-T2), while third-order postganglionic lesions (distal to the superior cervical ganglion) lack facial anhidrosis.",
                  terms: ["ciliospinal center", "oculosympathetic"],
                  numbers: ["8", "2"],
                  source: "Adams & Victor 11e Ch. 13"
                },
                {
                  fact: "Adie tonic pupil is caused by postganglionic parasympathetic denervation of the ciliary ganglion, presenting with a unilaterally dilated pupil displaying light-near dissociation and supersensitivity to dilute pilocarpine (0.125%).",
                  terms: ["Adie tonic pupil", "pilocarpine"],
                  numbers: ["0.125%"],
                  source: "Adams & Victor 11e Ch. 13"
                },
                {
                  fact: "Argyll Robertson pupils are small, irregular bilateral pupils that constrict briskly to accommodation but do not react to light (light-near dissociation), historically pathognomonic for tabes dorsalis and neurosyphilis.",
                  terms: ["Argyll Robertson", "light-near dissociation"],
                  source: "Adams & Victor 11e Ch. 13"
                },
                {
                  fact: "Bitemporal hemianopia results from compression of decussating nasal retinal fibers at the optic chiasm, most frequently caused by pituitary macroadenomas, craniopharyngiomas, or anterior communicating artery aneurysms.",
                  terms: ["Bitemporal hemianopia", "optic chiasm"],
                  source: "Adams & Victor 11e Ch. 12"
                },
                {
                  fact: "Homonymous superior quadrantanopia (pie-in-the-sky defect) is caused by contralateral temporal lobe lesions disrupting Meyer loop fibers passing through the temporal lobe around the lateral ventricle inferior horn.",
                  terms: ["quadrantanopia", "Meyer loop"],
                  source: "Adams & Victor 11e Ch. 12"
                },
                {
                  fact: "Oculomotor (third) nerve palsy presenting with pupillary dilatation and non-reactivity (blown pupil) indicates external compressive pathology, urgently demanding exclusion of a posterior communicating artery (PCOM) aneurysm until proven otherwise.",
                  terms: ["Oculomotor", "posterior communicating artery"],
                  source: "Adams & Victor 11e Ch. 13"
                }
              ]
            }
          ]
        },
        {
          id: "sne-spinal-cord-radiculopathy",
          name: "Spinal cord syndromes and myelopathies",
          size: "l",
          topics: [
            {
              id: "sne-spinal-cord-radiculopathy",
              title: "Spinal cord syndromes and myelopathies",
              book: "Adams & Victor 11e Ch. 42; Harrison 22e Ch. 440",
              mustKnow: [
                {
                  fact: "Brown-Séquard syndrome (spinal cord hemisection) causes ipsilateral spastic paresis (corticospinal tract) and ipsilateral loss of proprioception/vibration (dorsal columns) with contralateral loss of pain and temperature sensation 1 to 2 segments below the lesion.",
                  terms: ["Brown-Séquard", "corticospinal"],
                  numbers: ["1", "2"],
                  source: "Adams & Victor 11e Ch. 42"
                },
                {
                  fact: "Anterior spinal artery syndrome produces acute loss of motor function (bilateral flaccid paraplegia) and loss of pain and temperature sensation below the lesion, with complete preservation of posterior column vibration and proprioception.",
                  terms: ["Anterior spinal artery", "posterior column"],
                  source: "Adams & Victor 11e Ch. 42"
                },
                {
                  fact: "Central cord syndrome, typically occurring after cervical hyperextension in patients with preexisting cervical spondylosis, produces disproportionate motor weakness in the upper extremities compared to the lower extremities.",
                  terms: ["Central cord syndrome", "hyperextension"],
                  source: "Adams & Victor 11e Ch. 42"
                },
                {
                  fact: "Syringomyelia presents with a suspended, cape-like distribution of dissociated sensory loss (loss of pain and temperature with preserved touch and vibration) across the shoulders and arms due to cystic disruption of decussating spinothalamic fibers.",
                  terms: ["Syringomyelia", "dissociated sensory loss"],
                  source: "Adams & Victor 11e Ch. 42"
                },
                {
                  fact: "Chiari type 1 malformation features downward herniation of cerebellar tonsils >5 mm below the foramen magnum, which is strongly associated with cervical syringomyelia in over 50% of symptomatic patients.",
                  terms: ["Chiari", "foramen magnum"],
                  numbers: ["1", "5", "50%"],
                  source: "Adams & Victor 11e Ch. 42"
                },
                {
                  fact: "Conus medullaris syndrome localizes to the L1-L2 vertebral level, presenting with early symmetrical bilateral perianal sensory loss (saddle anesthesia), early bowel and bladder incontinence, and symmetrical lower limb weakness.",
                  terms: ["Conus medullaris", "saddle anesthesia"],
                  numbers: ["1", "2"],
                  source: "Adams & Victor 11e Ch. 42"
                },
                {
                  fact: "Cauda equina syndrome localizes below the conus medullaris involving the lumbosacral nerve roots, characterized by severe asymmetric radicular pain, asymmetric flaccid paraparesis, asymmetric sensory loss, and late sphincter dysfunction.",
                  terms: ["Cauda equina", "radicular pain"],
                  source: "Adams & Victor 11e Ch. 42"
                },
                {
                  fact: "Compressive spinal cord myelopathy from epidural metastases or abscess demands urgent high-dose intravenous dexamethasone (10 to 16 mg bolus) and emergency spine MRI spanning the entire neuraxis within 24 hours.",
                  terms: ["dexamethasone", "neuraxis"],
                  numbers: ["10", "16", "24"],
                  source: "Adams & Victor 11e Ch. 42 / Harrison 22e Ch. 440"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
};

// Write blueprint file
const targetDir = path.join(ROOT, "prep", "blueprints", "ss");
fs.mkdirSync(targetDir, { recursive: true });
const targetPath = path.join(targetDir, "ss-neurology.json");
fs.writeFileSync(targetPath, JSON.stringify(blueprint, null, 2) + "\n", "utf8");

console.log(`Successfully generated ss-neurology blueprint at: ${targetPath}`);
console.log(`Sections: ${blueprint.sections.length}`);
let totalModules = 0;
let totalTopics = 0;
let totalMustKnow = 0;
for (const sec of blueprint.sections) {
  for (const mod of sec.modules) {
    totalModules++;
    for (const top of mod.topics) {
      totalTopics++;
      totalMustKnow += top.mustKnow.length;
    }
  }
}
console.log(`Total Modules: ${totalModules}`);
console.log(`Total Topics: ${totalTopics}`);
console.log(`Total Must-Know Facts: ${totalMustKnow}`);
