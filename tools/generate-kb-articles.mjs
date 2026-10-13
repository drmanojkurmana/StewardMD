#!/usr/bin/env node
/**
 * Knowledge Library (KB v2) generator for books-derived topics.
 * Ensures 1:1 parity so every lesson topic has a corresponding Knowledge Library reference article.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const REF_DIR = path.join(ROOT, "kb", "reference");
fs.mkdirSync(REF_DIR, { recursive: true });

const articles = [
  // --- ANATOMY ---
  {
    id: "bony_orbit_and_extraocular_muscles",
    name: "Bony Orbit and Extraocular Muscles",
    aliases: ["Orbital anatomy", "Extraocular muscles", "Ciliary ganglion", "Superior orbital fissure"],
    system: "Special Senses / Ophthalmology",
    specialty: "Anatomy / Ophthalmology",
    source: "Gray's Anatomy for Students / Snell's Clinical Anatomy",
    pearls: [
      "Pyramidal bony cavity formed by seven bones: frontal, sphenoid, ethmoid, lacrimal, maxilla, zygomatic and palatine",
      "Lateral rectus is innervated by CN VI (abducens); superior oblique by CN IV (trochlear); all other extraocular muscles by CN III (oculomotor)",
      "Superior oblique passes through the fibrocartilaginous trochlea and depresses the adducted eye; inferior oblique elevates the adducted eye",
      "Ciliary ganglion receives preganglionic parasympathetics from CN III and supplies sphincter pupillae (constriction) and ciliary muscle (accommodation)",
      "Superior orbital fissure syndrome impairs CN III, IV, V1 and VI, causing ophthalmoplegia and forehead sensory loss"
    ],
    patho: "The orbit encloses the globe, extraocular muscles, orbital fat and neurovascular structures. The common tendinous ring of Zinn encircles the optic canal and central superior orbital fissure. Pathologies including orbital cellulitis, thyroid eye disease (Graves orbitopathy) with extraocular muscle belly enlargement sparing tendons, and orbital apex syndrome produce proptosis, diplopia and visual loss.",
    investigations: ["High-resolution orbital CT without contrast for fractures", "Contrast-enhanced orbital MRI with fat suppression for optic nerve lesions", "Hess screen / Lancaster red-green test for diplopia quantification"],
    differentials: ["Cavernous sinus thrombosis", "Thyroid eye disease (Graves orbitopathy)", "Idiopathic orbital inflammatory syndrome (orbital pseudotumour)", "Superior orbital fissure syndrome"]
  },
  {
    id: "laryngeal_framework_and_vocal_cords",
    name: "Laryngeal Framework, Musculature and Innervation",
    aliases: ["Larynx anatomy", "Vocal cords", "Recurrent laryngeal nerve", "Cricothyroid"],
    system: "Respiratory System / Head and Neck",
    specialty: "Anatomy / Otorhinolaryngology",
    source: "Gray's Anatomy for Students / Last's Anatomy",
    pearls: [
      "Composed of three unpaired cartilages (thyroid, cricoid, epiglottis) and three paired cartilages (arytenoid, corniculate, cuneiform)",
      "Cricoid cartilage is the only complete ring in the entire human respiratory tract",
      "Posterior cricoarytenoid is the sole abductor of the vocal cords; bilateral paralysis causes life-threatening airway obstruction",
      "Recurrent laryngeal nerve innervates all intrinsic laryngeal muscles except the cricothyroid, which is supplied by the external superior laryngeal nerve",
      "Left recurrent laryngeal nerve loops under the aortic arch lateral to ligamentum arteriosum, vulnerable in mediastinal lymphadenopathy and thoracic aortic aneurysm"
    ],
    patho: "The larynx serves as an airway sphincter, phonatory oscillator and conduit for pulmonary ventilation. Intrinsic muscles alter tension, length and aperture of the vocal folds. Damage to the external branch of the superior laryngeal nerve causes monotone voice and loss of high-pitch projection. Unilateral recurrent laryngeal nerve injury causes hoarseness with a paramedian cord; bilateral injury causes stridor.",
    investigations: ["Flexible fiberoptic laryngoscopy to observe dynamic vocal cord mobility", "Contrast-enhanced CT of neck and chest to trace recurrent laryngeal nerve course", "Laryngeal electromyography (LEMG) for neurogenic vs mechanical immobility"],
    differentials: ["Vocal cord polyp or nodule (singer's nodule)", "Laryngeal papillomatosis (HPV 6/11)", "Squamous cell carcinoma of the larynx", "Cricoarytenoid joint fixation in rheumatoid arthritis"]
  },
  {
    id: "nasal_cavity_and_paranasal_sinuses",
    name: "Nasal Cavity and Paranasal Sinuses",
    aliases: ["Nasal conchae", "Ostiomeatal complex", "Kiesselbach plexus", "Epistaxis"],
    system: "Respiratory System / Head and Neck",
    specialty: "Anatomy / Otorhinolaryngology",
    source: "Gray's Anatomy for Students / Scott-Brown's Otorhinolaryngology",
    pearls: [
      "Inferior concha is an independent facial bone; middle and superior conchae are ethmoid bone projections",
      "Frontal, maxillary and anterior ethmoidal sinuses drain into the middle meatus via the ostiomeatal complex",
      "Nasolacrimal duct drains exclusively into the inferior meatus under the valve of Hasner",
      "Kiesselbach plexus (Little area) on the anterior nasal septum is the site of 90% of epistaxis episodes",
      "Cribriform plate fractures cause CSF rhinorrhea (high beta-2 transferrin) and anosmia with risk of bacterial meningitis"
    ],
    patho: "The nasal cavity and paranasal sinuses condition, filter and humidify inspired air while reducing skull weight and providing vocal resonance. The ostiomeatal complex is a critical drainage bottleneck. Mucosal edema from viral rhinitis or allergic inflammation obstructs the maxillary sinus ostium, precipitating secondary acute bacterial rhinosinusitis with Streptococcus pneumoniae and Haemophilus influenzae.",
    investigations: ["Non-contrast coronal CT of paranasal sinuses for ostiomeatal patency", "Nasal endoscopy with 0-degree and 30-degree rigid endoscopes", "Beta-2 transferrin assay on clear nasal fluid to confirm CSF leak"],
    differentials: ["Acute bacterial rhinosinusitis", "Allergic fungal rhinosinusitis", "Inverting papilloma", "Antrochoanal polyp"]
  },
  {
    id: "middle_ear_and_auditory_apparatus",
    name: "Middle Ear Cavity and Auditory Apparatus",
    aliases: ["Tympanic cavity", "Auditory ossicles", "Organ of Corti", "Eustachian tube"],
    system: "Special Senses / Otology",
    specialty: "Anatomy / Otorhinolaryngology",
    source: "Gray's Anatomy for Students / Scott-Brown's Otorhinolaryngology",
    pearls: [
      "Ossicular chain (malleus, incus, stapes) provides impedance matching, amplifying sound pressure 20-fold from air to cochlear perilymph",
      "Tensor tympani (CN V3) attaches to malleus handle; stapedius (CN VII) attaches to stapes neck; stapedius paralysis causes hyperacusis",
      "Tegmen tympani roof separates tympanic cavity from temporal lobe dura; erosion leads to temporal lobe otogenic abscess",
      "Organ of Corti resides in the scala media, bathed in potassium-rich endolymph (+80 mV endocochlear potential) secreted by stria vascularis",
      "Deflection of hair cell stereocilia against tectorial membrane opens mechanosensitive K+ channels, triggering depolarization"
    ],
    patho: "The middle ear converts acoustic air waves into fluid waves in the inner ear cochlea. Eustachian tube dysfunction creates negative middle ear pressure, transudation of fluid (otitis media with effusion) and conductive hearing loss. Cholesteatoma causes osteoclast-mediated bone erosion of ossicles and tegmen tympani.",
    investigations: ["Pure tone audiometry and tympanometry (Type A normal, Type B flat effusion, Type C negative pressure)", "High-resolution CT of temporal bone (0.5 mm slices)", "Brainstem auditory evoked responses (BAER)"],
    differentials: ["Chronic suppurative otitis media", "Cholesteatoma", "Otosclerosis (Schwartze sign, Carhart notch at 2 kHz)", "Glomus tympanicum tumour"]
  },
  {
    id: "cranial_nerves_and_brainstem_nuclei",
    name: "Cranial Nerves and Brainstem Nuclei",
    aliases: ["Cranial nerve anatomy", "Brainstem foramina", "Facial palsy", "Jugular foramen"],
    system: "Nervous System / Neuroanatomy",
    specialty: "Anatomy / Neurology",
    source: "Gray's Anatomy for Students / Snell's Clinical Neuroanatomy",
    pearls: [
      "CN I and II arise from forebrain; CN III and IV from midbrain; CN V to VIII from pons; CN IX to XII from medulla",
      "CN IV (trochlear) is the only cranial nerve that exits from the dorsal brainstem and decussates completely before exit",
      "Upper motor neuron facial palsy spares the forehead due to bilateral corticonuclear innervation; lower motor neuron palsy (Bell palsy) affects whole hemiface",
      "Jugular foramen transmits CN IX, X, XI and internal jugular vein; lesions cause dysphagia, hoarseness and trapezius weakness (Vernet syndrome)",
      "Corneal reflex afferent limb is CN V1 (nasociliary); efferent limb is CN VII (orbicularis oculi)"
    ],
    patho: "Cranial nerves transmit sensory, motor and parasympathetic innervation between brainstem nuclei and peripheral structures. Skull base trauma, microvascular ischemia (diabetic mononeuropathy) and compression by aneurysms (PCOM aneurysm compressing CN III causing pupil dilation) or tumours (vestibular schwannoma at cerebellopontine angle) produce characteristic cranial neuropathies.",
    investigations: ["Contrast-enhanced MRI brain with thin CISS/FIESTA sequences for cranial nerve cisternal segments", "CT angiography or MR angiography for aneurysmal nerve compression", "Blink reflex electrophysiology"],
    differentials: ["Bell palsy", "Ramsay Hunt syndrome (Herpes zoster oticus)", "Trigeminal neuralgia", "Tolosa-Hunt syndrome"]
  },
  {
    id: "brainstem_and_alternating_syndromes",
    name: "Brainstem Architecture and Alternating Stroke Syndromes",
    aliases: ["Brainstem syndromes", "Wallenberg syndrome", "Medial medullary syndrome", "Weber syndrome"],
    system: "Nervous System / Neurovascular",
    specialty: "Anatomy / Neurology",
    source: "Gray's Anatomy for Students / Snell's Clinical Neuroanatomy",
    pearls: [
      "Pyramidal decussation in caudal medulla: 85% of corticospinal fibres cross to form lateral corticospinal tract",
      "Lateral medullary (Wallenberg) syndrome: PICA occlusion damages nucleus ambiguus (dysphagia/hoarseness), spinal trigeminal (ipsilateral face numbness), spinothalamic (contralateral body numbness), sympathetic (Horner)",
      "Medial medullary (Dejerine) syndrome: anterior spinal artery occlusion causes ipsilateral tongue paralysis (CN XII) and contralateral hemiparesis",
      "Weber syndrome: paramedian midbrain branch occlusion causes ipsilateral CN III palsy with contralateral hemiparesis",
      "Locked-in syndrome: basilar artery thrombosis infarcts bilateral ventral pons, sparing consciousness and vertical eye movements (CN III/IV in midbrain)"
    ],
    patho: "Brainstem alternating syndromes feature ipsilateral cranial nerve signs coupled with contralateral long tract motor or sensory deficits. Long tracts (corticospinal and spinothalamic) cross, while cranial nerve nuclei project ipsilaterally from their respective brainstem levels.",
    investigations: ["Diffusion-weighted MRI (DWI) brain for acute posterior circulation infarction", "CT angiography of head and neck for vertebral and basilar artery dissection or occlusion", "Transcranial Doppler for posterior circulation hemodynamics"],
    differentials: ["Wallenberg lateral medullary syndrome", "Weber midbrain syndrome", "Millard-Gubler pontine syndrome", "Basilar artery occlusion"]
  },
  {
    id: "cerebellar_circuits_and_ataxia",
    name: "Cerebellar Circuits, Deep Nuclei and Ataxia",
    aliases: ["Cerebellum anatomy", "Purkinje cells", "Dentate nucleus", "Cerebellar ataxia"],
    system: "Nervous System / Motor Control",
    specialty: "Anatomy / Neurology",
    source: "Gray's Anatomy for Students / Snell's Clinical Neuroanatomy",
    pearls: [
      "Deep cerebellar nuclei from lateral to medial: Dentate, Emboliform, Globose, Fastigial (Don't Eat Greasy Food)",
      "Purkinje cells provide the sole output from the cerebellar cortex, releasing inhibitory GABA onto deep nuclei",
      "Climbing fibres arise exclusively from inferior olivary nucleus, making multiple synapses directly on Purkinje cells (error signaling)",
      "Mossy fibres originate from pontine nuclei and spinal cord, synapsing on granule cells whose parallel fibres excite Purkinje cells",
      "Cerebellar lesions produce ipsilateral deficits: vermis lesions cause truncal ataxia; hemispheric lesions cause intention tremor and dysmetria"
    ],
    patho: "The cerebellum functions as a motor comparator, adjusting movement trajectories by comparing intended motor commands from cerebral cortex with proprioceptive feedback from periphery. Vermian lesions disrupt vestibular and axial balance. Hemispheric damage impairs rapid alternating movements (dysdiadochokinesia) and terminal targeting (past-pointing, intention tremor).",
    investigations: ["MRI brain with sagittal T1 and axial FLAIR sequences for cerebellar atrophy or mass", "Genetic testing for spinocerebellar ataxias (SCA trinucleotide repeats)", "Screening for paraneoplastic anti-Yo / anti-Hu antibodies"],
    differentials: ["Alcoholic cerebellar degeneration", "Multiple system atrophy cerebellar type (MSA-C, hot cross bun sign)", "Friedreich ataxia (FXN GAA repeat)", "Paraneoplastic cerebellar degeneration"]
  },
  {
    id: "ventricular_system_and_hydrocephalus",
    name: "Ventricular System, CSF Circulation and Hydrocephalus",
    aliases: ["Cerebrospinal fluid", "Ventricles of brain", "Aqueductal stenosis", "Normal pressure hydrocephalus"],
    system: "Nervous System / Neuroanatomy",
    specialty: "Anatomy / Neurosurgery",
    source: "Gray's Anatomy for Students / Snell's Clinical Neuroanatomy",
    pearls: [
      "CSF is produced by choroid plexus in lateral, third and fourth ventricles at ~500 mL/day (~0.35 mL/min); total volume is ~150 mL",
      "Foramina of Monro connect lateral ventricles to third ventricle; aqueduct of Sylvius connects third to fourth ventricle",
      "Fourth ventricle exits into subarachnoid space via median foramen of Magendie and two lateral foramina of Luschka",
      "Arachnoid granulations absorb CSF into superior sagittal sinus; absorption rate is pressure-dependent",
      "Normal pressure hydrocephalus triad (Hakim-Adams triad): gait disturbance (magnetic gait), urinary incontinence, dementia (Wet, Wobbly, Wacky)"
    ],
    patho: "Obstruction of ventricular pathways causes non-communicating (obstructive) hydrocephalus, most frequently at the narrow cerebral aqueduct of Sylvius (aqueductal stenosis) or fourth ventricle outlets. Impaired absorption by scarred arachnoid villi following subarachnoid hemorrhage or purulent meningitis produces communicating hydrocephalus. Overproduction by choroid plexus papilloma is rare.",
    investigations: ["Brain MRI with 3D CISS/FIESTA for aqueductal patency and Evans index (>0.30 confirms ventriculomegaly)", "High-volume lumbar puncture (tap test: 30-50 mL CSF removal) demonstrating gait improvement in NPH", "Continuous intracranial pressure (ICP) monitoring with B-waves"],
    differentials: ["Aqueductal stenosis", "Normal pressure hydrocephalus", "Colloid cyst of third ventricle", "Idiopathic intracranial hypertension (pseudotumour cerebri)"]
  },
  {
    id: "spinal_cord_tracts_and_syndromes",
    name: "Spinal Cord Tracts and Incomplete Cord Syndromes",
    aliases: ["Spinal cord anatomy", "Brown-Sequard syndrome", "Syringomyelia", "Anterior cord syndrome"],
    system: "Nervous System / Neuroanatomy",
    specialty: "Anatomy / Neurology",
    source: "Gray's Anatomy for Students / Snell's Clinical Neuroanatomy",
    pearls: [
      "Adult spinal cord terminates at lower border of L1 (conus medullaris); dural sac terminates at S2; safe lumbar puncture is L3-L4 or L4-L5",
      "Dorsal columns (fasciculus gracilis and cuneatus) convey proprioception and vibration; ascend uncrossed, decussate in medulla",
      "Lateral spinothalamic tract decussates in anterior white commissure within 1-2 segments, conveying pain and temperature contralaterally",
      "Brown-Sequard syndrome (cord hemisection): ipsilateral spastic paralysis and dorsal column loss; contralateral pain/temperature loss 1-2 levels below",
      "Syringomyelia causes cape-like bilateral loss of pain and temperature sensation due to central canal cavitation interrupting crossing commissural fibres"
    ],
    patho: "Incomplete cord syndromes result from vascular compromise, trauma or intrinsic cavitation. Anterior spinal artery syndrome spares dorsal columns while infarcting bilateral corticospinal and spinothalamic tracts. Central cord syndrome (hyperextension injury in cervical spondylosis) impairs upper extremities more than lower extremities because cervical motor fibres lie medially in the lateral corticospinal tract.",
    investigations: ["Sagittal and axial T2-weighted MRI of spine for cord compression, syrinx or edema", "Somatosensory evoked potentials (SSEP) assessing dorsal column conduction", "Motor evoked potentials (MEP) assessing corticospinal integrity"],
    differentials: ["Brown-Sequard syndrome", "Anterior spinal artery syndrome", "Central cord syndrome", "Subacute combined degeneration of the cord (Vitamin B12 deficiency)"]
  },
  {
    id: "basal_ganglia_circuits_and_disorders",
    name: "Basal Ganglia Circuitry and Movement Disorders",
    aliases: ["Corpus striatum", "Substantia nigra", "Parkinson disease", "Huntington chorea"],
    system: "Nervous System / Motor Control",
    specialty: "Anatomy / Neurology",
    source: "Gray's Anatomy for Students / Kandel's Principles of Neural Science",
    pearls: [
      "Corpus striatum consists of caudate nucleus and lentiform nucleus (putamen and globus pallidus)",
      "Direct pathway (D1 receptors) disinhibits thalamus via striatal inhibition of GPi, facilitating intended voluntary movements",
      "Indirect pathway (D2 receptors) excites GPi via subthalamic nucleus, suppressing unwanted motor programmes",
      "Parkinson disease: loss of dopaminergic neurons in substantia nigra pars compacta reduces direct pathway activity and overactivates indirect pathway",
      "Hemiballismus: lacunar infarction of contralateral subthalamic nucleus causes violent involuntary flinging limb movements"
    ],
    patho: "The basal ganglia modulate motor cortical output through balanced direct (facilitatory) and indirect (inhibitory) loops. In Parkinson disease, alpha-synuclein Lewy body pathology destroys nigrostriatal dopamine projections, shifting the balance toward profound indirect pathway inhibition, causing bradykinesia, resting tremor and cogwheel rigidity. In Huntington disease, striatal GABA/enkephalin neuron loss disinhibits movement, causing chorea.",
    investigations: ["Dopamine transporter SPECT (DaTscan) demonstrating asymmetric striatal uptake loss in Parkinsonism", "Genetic testing for Huntington disease (CAG trinucleotide repeats in HTT gene >36)", "Brain MRI showing caudate atrophy (box-car ventricles) in Huntington chorea"],
    differentials: ["Idiopathic Parkinson disease", "Huntington chorea", "Progressive supranuclear palsy (hummingbird sign)", "Multiple system atrophy parkinsonian type (MSA-P)"]
  },
  {
    id: "primitive_gut_tube_and_diaphragm",
    name: "Embryology of the Gut Tube and Diaphragm Development",
    aliases: ["Gut rotation", "Midgut volvulus", "Bochdalek hernia", "Septum transversum"],
    system: "Gastrointestinal System / Embryology",
    specialty: "Anatomy / Paediatric Surgery",
    source: "Langman's Medical Embryology / Gray's Anatomy for Students",
    pearls: [
      "Foregut supplied by celiac trunk; midgut by superior mesenteric artery; hindgut by inferior mesenteric artery",
      "Midgut undergoes 270-degree counterclockwise rotation around the SMA during physiologic herniation and return (weeks 6-10)",
      "Diaphragm develops from four structures: septum transversum (central tendon), pleuroperitoneal membranes, esophageal dorsal mesentery (crura), and body wall rim",
      "Congenital diaphragmatic hernia of Bochdalek (posterolateral, 90% left-sided) results from failed pleuroperitoneal membrane closure",
      "Motor innervation of diaphragm is entirely phrenic nerve (C3, C4, C5), reflecting cervical origin of septum transversum"
    ],
    patho: "Failure of normal 270-degree midgut rotation results in intestinal malrotation with a narrow mesenteric base, predisposing to midgut volvulus and catastrophic mesenteric ischemia (Ladd bands crossing duodenum). In congenital diaphragmatic hernia, abdominal viscera herniate into the hemithorax during pseudoglandular lung development, causing severe bilateral pulmonary hypoplasia.",
    investigations: ["Upper GI contrast series (fluoroscopy) demonstrating abnormal duodenojejunal junction position in malrotation", "Prenatal obstetric ultrasound calculating lung-to-head ratio (LHR) in diaphragmatic hernia", "Postnatal chest radiograph showing intrathoracic bowel loops and scaphoid abdomen"],
    differentials: ["Midgut volvulus with malrotation", "Congenital diaphragmatic hernia of Bochdalek", "Congenital diaphragmatic hernia of Morgagni (retrosternal)", "Duodenal atresia (double bubble sign)"]
  },
  {
    id: "peripheral_nerve_injuries_and_deformities",
    name: "Peripheral Nerve Injuries and Limb Deformities",
    aliases: ["Radial nerve palsy", "Ulnar claw hand", "Median nerve carpal tunnel", "Common peroneal foot drop"],
    system: "Musculoskeletal / Peripheral Nervous System",
    specialty: "Anatomy / Orthopaedics",
    source: "Gray's Anatomy for Students / Hoppenfeld's Physical Examination",
    pearls: [
      "Radial nerve injury at spiral groove of humerus causes wrist drop with sensory loss over first dorsal web space; triceps is spared",
      "Ulnar paradox: higher ulnar lesion at elbow causes LESS clawing than a low lesion at wrist because FDP to digits 4-5 is denervated",
      "Carpal tunnel syndrome: compression of median nerve under flexor retinaculum; thenar wasting, ape hand, numbness of lateral 3.5 digits",
      "Common fibular (peroneal) nerve winds around fibular neck; injury paralyses dorsiflexors and everters, producing foot drop and high-stepping gait",
      "Seddon classification: neuropraxia (conduction block, axon intact), axonotmesis (axonal severance, sheath intact), neurotmesis (complete transection)"
    ],
    patho: "Nerve trauma produces Wallerian degeneration distal to the injury site within twenty-four to forty-eight hours. Axons regenerate at approximately one millimeter per day from the proximal stump. Prolonged denervation beyond twelve to eighteen months results in irreversible motor end-plate atrophy and fibrous replacement of muscle fibers.",
    investigations: ["Nerve conduction studies (NCS) and electromyography (EMG) performed 3-4 weeks post-injury", "High-resolution neuromuscular ultrasound for nerve continuity or neuroma", "Magnetic resonance neurography (MRN)"],
    differentials: ["Radial nerve palsy (Saturday night palsy)", "Cubital tunnel syndrome vs Guyon canal compression", "Carpal tunnel syndrome", "Common fibular nerve entrapment vs L5 radiculopathy"]
  },

  // --- PHYSIOLOGY ---
  {
    id: "pulmonary_mechanics_and_surfactant",
    name: "Pulmonary Mechanics, Lung Compliance and Surfactant",
    aliases: ["Lung compliance", "Pulmonary surfactant", "Airway resistance", "Work of breathing"],
    system: "Respiratory System / Physiology",
    specialty: "Physiology / Pulmonology",
    source: "Guyton and Hall Textbook of Medical Physiology / West's Respiratory Physiology",
    pearls: [
      "Inspiration is active (diaphragm and external intercostals), lowering intrapleural pressure to -8 cm H2O; quiet expiration is passive",
      "Compliance is delta V / delta P; increased in emphysema (loss of elastic fibers), decreased in fibrosis and surfactant deficiency",
      "Surfactant (DPPC + SP-A/B/C/D) produced by type II pneumocytes reduces surface tension, preventing alveolar collapse (Laplace law: P = 2T/r)",
      "Airway resistance is highest in medium-sized bronchi (generations 4-8); terminal bronchioles have huge total cross-sectional area",
      "Parasympathetic vagal M3 stimulation causes bronchoconstriction; sympathetic beta-2 stimulation mediates bronchodilation"
    ],
    patho: "Neonatal respiratory distress syndrome arises from surfactant deficiency in premature infants born before thirty-four weeks gestation. Increased surface tension promotes widespread diffuse microatelectasis, intrapulmonary right-to-left shunting, hypoxemia and hyaline membrane formation. In ARDS, inflammatory exudate neutralizes surfactant, severely reducing compliance.",
    investigations: ["Spirometry measuring FEV1, FVC, and FEV1/FVC ratio (<0.70 defines obstructive deficit)", "Body plethysmography for total lung capacity (TLC) and residual volume (RV)", "Diffusing capacity of the lung for carbon monoxide (DLCO)"],
    differentials: ["Neonatal respiratory distress syndrome", "Acute respiratory distress syndrome (Berlin criteria)", "Chronic obstructive pulmonary disease (emphysema)", "Idiopathic pulmonary fibrosis"]
  },
  {
    id: "renal_tubular_transport_and_diuretics",
    name: "Renal Tubular Transport and Diuretic Pharmacology",
    aliases: ["Nephron transport", "SGLT2", "NKCC2 loop diuretics", "Thiazide NCCT"],
    system: "Renal System / Physiology",
    specialty: "Physiology / Nephrology",
    source: "Guyton and Hall Textbook of Medical Physiology / Vander's Renal Physiology",
    pearls: [
      "Proximal convoluted tubule reabsorbs 65% of filtered Na+, water and Cl-, and 100% of glucose and amino acids via secondary active transport",
      "Thick ascending limb NKCC2 cotransporter reabsorbs 1 Na+, 1 K+, 2 Cl-; lumen-positive potential (+8 mV) drives paracellular Ca2+ and Mg2+ uptake",
      "Loop diuretics (furosemide) inhibit NKCC2, abolishing medullary osmotic gradient and causing hypercalciuria",
      "Thiazides inhibit distal tubule NCCT cotransporter, promoting Ca2+ reabsorption (protective against calcium nephrolithiasis)",
      "Collecting duct principal cells reabsorb Na+ via ENaC under aldosterone control, generating negative lumen driving K+ and H+ secretion"
    ],
    patho: "Genetic mutations of tubular transporters model diuretic actions: Bartter syndrome mutations (NKCC2, ROMK) mimic loop diuretics with hypokalemic alkalosis and hypercalciuria. Gitelman syndrome mutations (NCCT) mimic thiazides with hypokalemic alkalosis and hypocalciuria. Liddle syndrome gain-of-function ENaC mutations cause pseudoaldosteronism with hypertension and suppressed renin.",
    investigations: ["Serum electrolytes, urea, creatinine, calcium, magnesium, phosphate", "Spot urine electrolytes and fractional excretion of sodium (FENa)", "Transtubular potassium gradient (TTKG) and plasma renin/aldosterone ratio"],
    differentials: ["Bartter syndrome", "Gitelman syndrome", "Liddle syndrome", "Renal tubular acidosis types 1, 2, and 4"]
  },
  {
    id: "renal_countercurrent_multiplier_and_adh",
    name: "Renal Countercurrent Mechanism and ADH Regulation",
    aliases: ["Countercurrent multiplier", "Vasopressin V2", "Aquaporin-2", "Diabetes insipidus"],
    system: "Renal System / Fluid and Electrolytes",
    specialty: "Physiology / Nephrology",
    source: "Guyton and Hall Textbook of Medical Physiology / Vander's Renal Physiology",
    pearls: [
      "Countercurrent multiplier in juxtamedullary nephrons creates an hyperosmotic medullary interstitium reaching 1200 mOsm/kg at papilla",
      "Descending thin limb is water-permeable and solute-impermeable; thick ascending limb is water-impermeable and actively pumps NaCl",
      "Vasa recta hairpin capillary loops act as countercurrent exchangers, preserving the medullary gradient while supplying nutrients",
      "ADH (vasopressin) binds basolateral V2 receptors on principal cells, stimulating cAMP/PKA to insert aquaporin-2 water channels apically",
      "Urea recycling via ADH-stimulated UT-A1/UT-A3 transporters provides 40-50% of inner medullary interstitial hyperosmolality"
    ],
    patho: "Central diabetes insipidus arises from defective synthesis or release of ADH by hypothalamic supraoptic/paraventricular nuclei. Nephrogenic diabetes insipidus involves renal insensitivity to ADH due to V2 receptor mutations or lithium therapy. SIADH involves unsuppressed ADH secretion, causing euvolemic hyponatremia with inappropriately concentrated urine.",
    investigations: ["Water deprivation test with desmopressin challenge", "Paired plasma and urine osmolality with urinary sodium concentration", "Copeptin measurement as a surrogate for arginine vasopressin"],
    differentials: ["Central diabetes insipidus", "Nephrogenic diabetes insipidus", "Syndrome of inappropriate ADH secretion (SIADH)", "Primary polydipsia"]
  },
  {
    id: "gastric_acid_secretion_and_parietal_cells",
    name: "Gastric Acid Secretion and Parietal Cell Physiology",
    aliases: ["Parietal cell", "Proton pump", "Gastrin", "Zollinger-Ellison syndrome"],
    system: "Gastrointestinal System / Physiology",
    specialty: "Physiology / Gastroenterology",
    source: "Guyton and Hall Textbook of Medical Physiology / Ganong's Review of Medical Physiology",
    pearls: [
      "Parietal cells in gastric oxyntic glands secrete hydrochloric acid (pH ~1.5) and intrinsic factor (for cobalamin absorption)",
      "Proton pump (H+/K+ ATPase) secretes H+ in exchange for K+ at apical canalicular membrane; basolateral HCO3-/Cl- creates alkaline tide",
      "Three secretagogues stimulate acid: Histamine (paracrine from ECL cells via H2/cAMP), Acetylcholine (vagus via M3/Ca2+), Gastrin (G cells via CCK-B/Ca2+)",
      "Somatostatin from antral D cells acts as master inhibitor via Gi/SST2 receptors when luminal pH falls below 3.0",
      "Proton pump inhibitors (omeprazole) form covalent disulphide bonds with H+/K+ ATPase, irreversibly blocking the final common pathway"
    ],
    patho: "Helicobacter pylori antral gastritis destroys D cells, decreasing somatostatin and disinhibiting gastrin release, producing hyperchlorhydria and duodenal ulceration. Autoimmune metaplastic atrophic gastritis destroys parietal cells via anti-parietal cell and anti-intrinsic factor antibodies, causing achlorhydria, compensatory hypergastrinemia and pernicious anemia.",
    investigations: ["Fasting serum gastrin measurement (>1000 pg/mL suggests gastrinoma)", "Secretin stimulation test (paradoxical gastrin rise confirms Zollinger-Ellison)", "Upper gastrointestinal endoscopy with antral and corpus biopsies"],
    differentials: ["Zollinger-Ellison syndrome (gastrinoma)", "Peptic ulcer disease (Helicobacter pylori / NSAID)", "Autoimmune atrophic gastritis (pernicious anemia)", "Non-ulcer functional dyspepsia"]
  },
  {
    id: "pancreatic_exocrine_and_endocrine_physiology",
    name: "Pancreatic Exocrine Secretion and Endocrine Regulation",
    aliases: ["Pancreatic enzymes", "Secretin", "CCK", "Islets of Langerhans", "Insulin secretion"],
    system: "Gastrointestinal System / Endocrinology",
    specialty: "Physiology / Gastroenterology",
    source: "Guyton and Hall Textbook of Medical Physiology / Ganong's Review of Medical Physiology",
    pearls: [
      "Acinar cells secrete zymogens (trypsinogen, chymotrypsinogen, amylase, lipase) stimulated by CCK and vagal acetylcholine",
      "Ductal cells secrete watery alkaline sodium bicarbonate fluid (pH 8.0) stimulated by secretin via CFTR-mediated chloride recycling",
      "Duodenal enterokinase (enteropeptidase) cleaves trypsinogen to trypsin; trypsin activates all other pancreatic digestive proenzymes",
      "Beta-cell insulin secretion: glucose entry via GLUT2 raises ATP/ADP ratio, closing KATP channels, depolarizing cell and opening CaV channels",
      "Glucagon from alpha cells activates hepatic adenylyl cyclase, stimulating glycogenolysis and gluconeogenesis while inhibiting glycolysis"
    ],
    patho: "In cystic fibrosis, defective CFTR impairs ductal bicarbonate and fluid secretion, causing inspissated proteinaceous secretions, ductal obstruction, acinar atrophy and pancreatic exocrine insufficiency. In acute pancreatitis, premature intra-acinar trypsinogen activation overwhelms protective trypsin inhibitors, initiating autodigestive necrotizing injury.",
    investigations: ["Fecal elastase-1 assay (<200 mcg/g diagnostic of exocrine pancreatic insufficiency)", "Serum amylase and lipase (lipase >3x upper limit of normal diagnostic of acute pancreatitis)", "Oral glucose tolerance test and HbA1c for endocrine dysfunction"],
    differentials: ["Chronic pancreatitis", "Exocrine pancreatic insufficiency in cystic fibrosis", "Type 1 diabetes mellitus", "Insulinoma (Whipple triad)"]
  },
  {
    id: "photoreceptor_phototransduction_and_retina",
    name: "Photoreceptor Phototransduction and Retinal Circuitry",
    aliases: ["Rhodopsin", "Transducin", "Dark current", "Retinitis pigmentosa"],
    system: "Special Senses / Visual Physiology",
    specialty: "Physiology / Ophthalmology",
    source: "Guyton and Hall Textbook of Medical Physiology / Kandel's Principles of Neural Science",
    pearls: [
      "Rods mediate scotopic dim-light vision (high sensitivity, low acuity); cones mediate photopic daylight trichromatic vision (fovea)",
      "In darkness, high cGMP levels hold cyclic nucleotide-gated channels open (dark current), maintaining tonic depolarization (-40 mV) and glutamate release",
      "Light activates rhodopsin (11-cis to all-trans retinal) -> metarhodopsin II activates transducin -> cGMP phosphodiesterase hydrolyzes cGMP",
      "Channel closure causes photoreceptor hyperpolarization (-70 mV), DECREASING glutamate release onto bipolar cells",
      "On-center bipolar cells express mGluR6 receptors and DEPOLARIZE to light; off-center bipolar cells express AMPA receptors and hyperpolarize"
    ],
    patho: "Genetic mutations in rhodopsin or photoreceptor disc turnover cause retinitis pigmentosa, characterized by progressive rod apoptosis, bone-spicule retinal pigmentation, nyctalopia (night blindness) and tunnel vision. Congenital stationary night blindness and achromatopsia arise from transducin, phosphodiesterase or cyclic nucleotide channel subunit defects.",
    investigations: ["Full-field electroretinography (ERG) assessing scotopic and photopic retinal responses", "Optical coherence tomography (OCT) of macula measuring photoreceptor layer integrity", "Automated static visual field perimetry (Humphrey 24-2 / 30-2)"],
    differentials: ["Retinitis pigmentosa", "Stargardt disease (ABCA4 mutation)", "Cone-rod dystrophy", "Vitamin A deficiency nyctalopia"]
  },
  {
    id: "cardiac_electrophysiology_and_pacemaker_cells",
    name: "Cardiac Electrophysiology and Pacemaker Automatism",
    aliases: ["Cardiac action potential", "Funny current", "Refractory period", "Arrhythmogenesis"],
    system: "Cardiovascular System / Electrophysiology",
    specialty: "Physiology / Cardiology",
    source: "Guyton and Hall Textbook of Medical Physiology / Katz's Physiology of the Heart",
    pearls: [
      "Ventricular action potential: Phase 0 (inward Na+ via Nav1.5), Phase 1 (transient outward K+), Phase 2 (plateau: inward Ca2+ balanced by outward K+), Phase 3 (repolarization: IKr, IKs), Phase 4 (IK1, resting -90 mV)",
      "Pacemaker cells (SA/AV node) exhibit spontaneous Phase 4 depolarization driven by the funny current (If) via HCN channels and T-type Ca2+ channels",
      "Sympathetic beta-1 stimulation raises cAMP, steepening Phase 4 slope (positive chronotropy); vagal M2 stimulation opens IKACh, hyperpolarizing node (bradycardia)",
      "Effective refractory period spans phases 0, 1, 2, and early 3, preventing tetanic contraction and ensuring rhythmic chamber filling",
      "Early afterdepolarizations (EADs) occur during phase 2/3 in prolonged QT intervals, triggering polymorphic ventricular tachycardia (Torsades de pointes)"
    ],
    patho: "Congenital long QT syndrome arises from loss-of-function potassium channel mutations (LQT1 KCNQ1, LQT2 KCNH2) or gain-of-function sodium channel mutations (LQT3 SCN5A). Delayed ventricular repolarization permits reactivation of L-type calcium channels, triggering early afterdepolarizations that provoke Torsades de pointes and sudden cardiac death.",
    investigations: ["12-lead electrocardiogram calculating corrected QT interval (QTc = QT / sqrt(RR))", "24-hour ambulatory Holter ECG monitoring for transient arrhythmias", "Electrophysiological study (EPS) with programmed electrical stimulation"],
    differentials: ["Congenital long QT syndromes (Romano-Ward, Jervell and Lange-Nielsen)", "Brugada syndrome (SCN5A ST elevation V1-V3)", "Catecholaminergic polymorphic ventricular tachycardia (CPVT)", "Wolff-Parkinson-White syndrome"]
  },

  // --- BIOCHEMISTRY ---
  {
    id: "glycolysis_pyruvate_dehydrogenase_and_tca_cycle",
    name: "Glycolysis, Pyruvate Dehydrogenase and the TCA Cycle",
    aliases: ["Glycolysis regulation", "PFK-1", "Pyruvate dehydrogenase", "Krebs cycle"],
    system: "Metabolism / Carbohydrate Biochemistry",
    specialty: "Biochemistry / Metabolic Genetics",
    source: "Harper's Illustrated Biochemistry / Lippincott Illustrated Reviews: Biochemistry",
    pearls: [
      "Phosphofructokinase-1 (PFK-1) is the rate-limiting commitment step of glycolysis; inhibited by ATP and citrate; activated by AMP and fructose-2,6-bisphosphate",
      "Fructose-2,6-bisphosphate is synthesized by PFK-2; insulin dephosphorylates and activates PFK-2, promoting glycolysis; glucagon phosphorylates and activates FBPase-2",
      "Pyruvate dehydrogenase (PDH) complex requires 5 cofactors: Thiamine (B1), Lipoic acid, Coenzyme A (B5), FAD (B2), NAD+ (B3)",
      "PDH deficiency is an X-linked cause of congenital lactic acidosis; arsenic inhibits lipoic acid, causing cellular energy depletion",
      "TCA cycle generates 3 NADH, 1 FADH2, 1 GTP and 2 CO2 per turn; rate-limiting enzyme is isocitrate dehydrogenase"
    ],
    patho: "Pyruvate dehydrogenase deficiency results in pyruvate accumulation and shunting to lactate via lactate dehydrogenase, causing severe neonatal lactic acidosis and psychomotor retardation. Arsenic binds lipoic acid sulfhydryls, halting both PDH and alpha-ketoglutarate dehydrogenase. Fluoroacetate inhibits aconitase, arresting the citric acid cycle.",
    investigations: ["Plasma lactate and pyruvate ratio (normal <20; elevated in mitochondrial respiratory chain defects)", "Urine organic acid analysis via gas chromatography-mass spectrometry", "Genetic testing for PDHA1 mutations (X-linked)"],
    differentials: ["Pyruvate dehydrogenase complex deficiency", "Pyruvate carboxylase deficiency", "Mitochondrial encephalomyopathy with lactic acidosis and stroke-like episodes (MELAS)", "Thiamine deficiency (Beri-beri / Wernicke encephalopathy)"]
  },
  {
    id: "fatty_acid_beta_oxidation_and_ketogenesis",
    name: "Fatty Acid Beta-Oxidation and Ketogenesis",
    aliases: ["Carnitine shuttle", "MCAD deficiency", "Beta-oxidation", "Ketone bodies"],
    system: "Metabolism / Lipid Biochemistry",
    specialty: "Biochemistry / Inborn Errors of Metabolism",
    source: "Harper's Illustrated Biochemistry / Lippincott Illustrated Reviews: Biochemistry",
    pearls: [
      "Carnitine palmitoyltransferase-1 (CPT-1) is the rate-limiting enzyme of fatty acid oxidation; inhibited by malonyl-CoA during active lipogenesis",
      "Beta-oxidation spiral four steps: oxidation (acyl-CoA dehydrogenase / FADH2), hydration, oxidation (hydroxyacyl-CoA dehydrogenase / NADH), thiolysis",
      "MCAD deficiency: most common inborn error of beta-oxidation; presents with severe hypoketotic hypoglycemia during fasting, elevated octanoylcarnitine (C8)",
      "Ketogenesis occurs exclusively in liver mitochondria via HMG-CoA synthase; produces acetoacetate, beta-hydroxybutyrate and acetone",
      "Liver CANNOT utilize ketone bodies because it completely lacks beta-ketoacyl-CoA transferase (thiophorase)"
    ],
    patho: "Impaired beta-oxidation prevents gluconeogenesis during prolonged fasting because acetyl-CoA is required to allosterically activate pyruvate carboxylase. Medium-chain acyl-CoA dehydrogenase (MCAD) deficiency manifests in infants aged three to twenty-four months during intercurrent viral illness with lethargy, hypoketotic hypoglycemia, seizures and hepatic dysfunction mimicking Reye syndrome.",
    investigations: ["Acylcarnitine profile by tandem mass spectrometry demonstrating prominent C8 octanoylcarnitine", "Urine organic acid analysis showing dicarboxylic aciduria (adipic, suberic, sebacic acids)", "Targeted genetic testing for ACADM c.985A>G mutation"],
    differentials: ["MCAD deficiency", "Primary systemic carnitine deficiency", "Carnitine palmitoyltransferase-2 deficiency", "Reye syndrome"]
  },
  {
    id: "lipoprotein_metabolism_and_hyperlipidemias",
    name: "Lipoprotein Metabolism and Familial Hyperlipidemias",
    aliases: ["Lipoproteins", "Apolipoproteins", "Familial hypercholesterolemia", "LDL receptor"],
    system: "Metabolism / Lipid Biochemistry",
    specialty: "Biochemistry / Cardiology",
    source: "Harper's Illustrated Biochemistry / Braunwald's Heart Disease",
    pearls: [
      "ApoB-48 is produced by enterocyte RNA editing of ApoB mRNA; full-length ApoB-100 is produced in liver and present on VLDL, IDL and LDL",
      "ApoC-II activates endothelial lipoprotein lipase (LPL); ApoE mediates hepatic clearance of remnants and chylomicrons",
      "Type I hyperchylomicronemia: LPL or ApoC-II deficiency; massive fasting chylomicrons, creamy layer, eruptive xanthomas, acute pancreatitis",
      "Type IIa familial hypercholesterolemia: autosomal dominant LDL receptor mutations; elevated LDL, tendon xanthomas, premature CAD in 30s-40s",
      "HDL mediates reverse cholesterol transport; ApoA-I activates LCAT; CETP transfers cholesterol esters from HDL to VLDL in exchange for triglycerides"
    ],
    patho: "Familial hypercholesterolemia results in defective clearance of circulating LDL particles, leading to accelerated atherogenesis, subendothelial foam cell accumulation and fibrous plaque formation. Familial dysbetalipoproteinemia (Type III) results from homozygosity for ApoE2, which binds poorly to hepatic receptors, causing accumulation of chylomicron remnants and IDL with palmar xanthomas.",
    investigations: ["Fasting lipid panel (total cholesterol, LDL-C, HDL-C, triglycerides)", "Apolipoprotein B and lipoprotein(a) quantitation", "Genetic testing for LDLR, APOB, and PCSK9 pathogenic variants"],
    differentials: ["Familial hypercholesterolemia (Type IIa)", "Familial combined hyperlipidemia (Type IIb)", "Familial dysbetalipoproteinemia (Type III)", "Familial hypertriglyceridemia (Type IV)"]
  },
  {
    id: "urea_cycle_and_hyperammonemia",
    name: "Urea Cycle Disorders and Hyperammonemia",
    aliases: ["Urea cycle", "Ornithine transcarbamylase", "Hyperammonemia", "Orotic aciduria"],
    system: "Metabolism / Amino Acid Biochemistry",
    specialty: "Biochemistry / Genetics",
    source: "Harper's Illustrated Biochemistry / Lippincott Illustrated Reviews: Biochemistry",
    pearls: [
      "Urea cycle converts toxic ammonia to urea; initial 2 steps are mitochondrial (CPS-I, OTC); final 3 steps are cytosolic (ASS, ASL, arginase)",
      "Carbamoyl phosphate synthetase-I (CPS-I) is rate-limiting and requires N-acetylglutamate (NAG) as an obligate allosteric activator",
      "Ornithine transcarbamylase (OTC) deficiency is X-linked recessive; carbamoyl phosphate spills into cytosol, causing massive urinary orotic acid",
      "Hereditary orotic aciduria (UMP synthase deficiency) features normal blood ammonia, whereas OTC deficiency features severe hyperammonemia",
      "Ammonia neurotoxicity: drives glutamate dehydrogenase toward glutamate, depleting alpha-ketoglutarate; astrocyte glutamine accumulation causes brain edema"
    ],
    patho: "Urea cycle enzyme defects prevent nitrogen disposal, causing acute hyperammonemic encephalopathy in neonates shortly after protein feeds begin. Excess ammonia crosses the blood-brain barrier, where astrocytes convert it to glutamine via glutamine synthetase. Intracellular glutamine functions as an osmolyte, causing astrocyte swelling, cerebral edema and intracranial hypertension.",
    investigations: ["Plasma ammonia (normal <35 mcmol/L; >150 mcmol/L in neonate is medical emergency)", "Plasma amino acid analysis (citrulline, arginine, glutamine)", "Urine organic acid and orotic acid quantitation"],
    differentials: ["Ornithine transcarbamylase (OTC) deficiency", "Carbamoyl phosphate synthetase-I deficiency", "Citrullinemia (argininosuccinate synthetase deficiency)", "Argininosuccinic aciduria"]
  },

  // --- SURGERY (SABISTON 22E) ---
  {
    id: "surgical_wound_healing_and_scarring",
    name: "Surgical Wound Healing, Collagen Dynamics and Abnormal Scarring",
    aliases: ["Wound healing", "Hypertrophic scar", "Keloid", "Burst abdomen"],
    system: "Integumentary and Musculoskeletal / Surgery",
    specialty: "General Surgery / Plastic Surgery",
    source: "Sabiston Textbook of Surgery 22nd ed / Schwartz's Principles of Surgery",
    pearls: [
      "Four phases of wound healing: Hemostasis (platelets, fibrin), Inflammation (neutrophils then macrophages), Proliferation (fibroblasts, granulation tissue), Remodeling",
      "Proliferation phase features type III collagen; remodeling replaces it with organized type I collagen bundles cross-linked by lysyl oxidase",
      "Wound tensile strength reaches 20% at 3 weeks and plateaus at maximum 80% of uninjured skin at 1 year",
      "Hypertrophic scars remain confined within original incision margins; keloids invade normal surrounding tissue and have high recurrence",
      "Abdominal wound dehiscence typically presents on postoperative days 5-8 with sudden serosanguinous pink discharge soaking dressings"
    ],
    patho: "Abnormal wound healing reflects dysregulated cytokine signaling. Excessive TGF-beta and PDGF signaling alongside impaired apoptosis of myofibroblasts produces keloids and hypertrophic scars. Scurvy (Vitamin C deficiency) impairs prolyl and lysyl hydroxylase, preventing collagen triple-helix stabilization and causing wound breakdown.",
    investigations: ["Clinical inspection and physical examination of wound margins", "Histopathological biopsy with Masson trichrome staining in atypical scarred lesions", "High-frequency ultrasound of surgical scar for deep seroma or fascial gap"],
    differentials: ["Hypertrophic scar", "Keloid", "Dermatofibrosarcoma protuberans", "Wound dehiscence with evisceration"]
  },
  {
    id: "surgical_hemorrhagic_shock_and_transfusion",
    name: "Surgical Hemorrhagic Shock and Massive Transfusion Protocols",
    aliases: ["Hemorrhagic shock", "Trauma resuscitation", "Massive transfusion protocol", "Lethal triad"],
    system: "Cardiovascular System / Trauma Surgery",
    specialty: "Trauma Surgery / Critical Care",
    source: "Sabiston Textbook of Surgery 22nd ed / ATLS 10th ed",
    pearls: [
      "ATLS Shock classification: Class I (<15% loss, normal vitals), Class II (15-30%, tachycardia, narrowed pulse pressure), Class III (30-40%, hypotension), Class IV (>40%, lethargic/comatose)",
      "Trauma lethal triad: hypothermia, coagulopathy and acidosis; damage control resuscitation aims to prevent this downward spiral",
      "Damage control resuscitation utilizes 1:1:1 balanced transfusion of packed RBCs, fresh frozen plasma and platelets, avoiding large-volume crystalloids",
      "Permissive hypotension targets systolic BP 80-90 mmHg until surgical hemostasis is achieved, preventing clot blow-off",
      "Massive transfusion protocol complications: hypocalcemia (citrate binding), hyperkalemia (lysed stored red cells), hypothermia, TRALI"
    ],
    patho: "Severe hemorrhagic shock causes systemic microvascular hypoperfusion, tissue hypoxia and anaerobic metabolism with lactic acidosis. Uncontrolled bleeding triggers trauma-induced coagulopathy (TIC) driven by endothelial glycocalyx degradation, hyperfibrinolysis and consumption of coagulation factors. Large-volume isotonic crystalloids worsen hypothermia and dilute clotting factors.",
    investigations: ["Serial venous/arterial blood gas and lactate clearance monitoring", "Rotational thromboelastometry (ROTEM) or Thromboelastography (TEG) for targeted blood component therapy", "Ionized calcium and potassium monitoring every 4 units of PRBCs"],
    differentials: ["Hemorrhagic shock", "Neurogenic shock (hypotension with bradycardia)", "Obstructive shock (tension pneumothorax / tamponade)", "Septic shock"]
  },
  {
    id: "advanced_trauma_life_support_primary_survey",
    name: "Advanced Trauma Life Support: Primary Survey and Thoracic Emergencies",
    aliases: ["ATLS", "Primary survey", "Tension pneumothorax", "Cardiac tamponade", "FAST ultrasound"],
    system: "Trauma / Emergency Surgery",
    specialty: "Trauma Surgery / Emergency Medicine",
    source: "ATLS 10th ed / Sabiston Textbook of Surgery 22nd ed",
    pearls: [
      "Primary survey priority ABCDE: Airway with C-spine stabilization, Breathing, Circulation with hemorrhage control, Disability, Exposure",
      "Tension pneumothorax: clinical diagnosis (hypotension, absent breath sounds, tracheal deviation); treat with immediate decompression, never delay for CXR",
      "Cardiac tamponade: Beck triad (hypotension, jugular venous distension, muffled heart sounds); E-FAST demonstrates pericardial fluid",
      "E-FAST assesses 6 acoustic windows: Morison pouch, splenorenal recess, suprapubic pouch, subxiphoid pericardium, bilateral pleural sliding",
      "In hemodynamically unstable blunt trauma, a positive abdominal FAST mandates immediate exploratory laparotomy"
    ],
    patho: "Tension pneumothorax creates a one-way valve air leak into the pleural space. Positive intrathoracic pressure collapses the lung and shifts the mediastinum contralaterally, compressing the inferior and superior vena cavae and eliminating venous return, leading to electromechanical dissociation and death unless decompressed.",
    investigations: ["Extended Focused Assessment with Sonography for Trauma (E-FAST)", "Portable supine chest radiograph and pelvic radiograph in resuscitation bay", "Contrast-enhanced whole-body CT (pan-scan) once hemodynamically stable"],
    differentials: ["Tension pneumothorax", "Massive hemothorax (>1500 mL blood or >200 mL/hr for 2-4 hours)", "Cardiac tamponade", "Flail chest with pulmonary contusion"]
  },
  {
    id: "thyroid_carcinoma_and_bethesda_classification",
    name: "Thyroid Carcinoma and the Bethesda Cytopathology System",
    aliases: ["Thyroid cancer", "Bethesda classification", "Papillary thyroid carcinoma", "Follicular thyroid carcinoma"],
    system: "Endocrine System / Surgical Oncology",
    specialty: "Endocrine Surgery / Surgical Oncology",
    source: "Sabiston Textbook of Surgery 22nd ed / American Thyroid Association Guidelines",
    pearls: [
      "Bethesda classification: I non-diagnostic, II benign (<3% risk), III AUS/FLUS, IV follicular neoplasm (25-40%), V suspicious, VI malignant (97-99%)",
      "Papillary thyroid cancer (85% of cases): Orphan Annie eye nuclei, nuclear pseudoinclusions, psammoma bodies; lymphatic spread; >95% survival",
      "Follicular thyroid cancer: FNA cannot distinguish from adenoma; requires histological proof of capsular or vascular invasion; hematogenous spread",
      "Medullary thyroid cancer arises from calcitonin-secreting parafollicular C cells; associated with RET mutations in MEN 2A and 2B",
      "Thyroidectomy complications: hypoparathyroidism (hypocalcemia, Chvostek/Trousseau signs), recurrent laryngeal nerve palsy (hoarseness), hematoma"
    ],
    patho: "Papillary thyroid carcinoma is driven by BRAF V600E mutations (60%) or RET/PTC translocations, activating the MAPK pathway. Follicular carcinoma is driven by RAS mutations or PAX8-PPARG fusions. Anaplastic carcinoma represents undifferentiated transformation with TP53 mutations, presenting as a rapidly expanding, highly lethal neck mass invading tracheal and esophageal structures.",
    investigations: ["High-resolution neck ultrasound (TI-RADS risk stratification)", "Ultrasound-guided fine-needle aspiration (FNA) with Bethesda reporting", "Serum calcitonin and carcinoembryonic antigen (CEA) for medullary carcinoma"],
    differentials: ["Papillary thyroid carcinoma", "Follicular thyroid carcinoma vs follicular adenoma", "Medullary thyroid carcinoma", "Anaplastic thyroid carcinoma"]
  },
  {
    id: "cholecystitis_critical_view_and_biliary_injury",
    name: "Acute Cholecystitis, Critical View of Safety and Biliary Injury",
    aliases: ["Cholecystitis", "Laparoscopic cholecystectomy", "Critical view of safety", "Bile duct injury"],
    system: "Gastrointestinal System / Hepatobiliary Surgery",
    specialty: "General Surgery / HPB Surgery",
    source: "Sabiston Textbook of Surgery 22nd ed / Tokyo Guidelines 2018",
    pearls: [
      "Acute cholecystitis: cystic duct gallstone impaction; ultrasound shows wall thickening >4 mm, pericholecystic fluid, sonographic Murphy sign",
      "Early laparoscopic cholecystectomy within 72 hours of symptom onset reduces complications and hospital stay compared to delayed repair",
      "Strasberg Critical View of Safety requires 3 criteria: hepatocystic triangle cleared of fat, lower third of gallbladder mobilized off cystic plate, only 2 structures seen entering gallbladder",
      "Strasberg bile duct injuries: Type A minor cystic leak, Type D lateral duct laceration, Type E complete transection of main common bile duct",
      "Charcot triad (fever, jaundice, RUQ pain) and Reynolds pentad (+ shock, altered mental status) define acute cholangitis, requiring emergency ERCP decompression"
    ],
    patho: "Persistent cystic duct obstruction leads to mucosal ischemia, secondary bacterial invasion and transmural gallbladder inflammation. Failure to achieve the critical view of safety during laparoscopic cholecystectomy leads to misidentification of the common bile duct as the cystic duct, causing catastrophic duct transection or clipping.",
    investigations: ["Right upper quadrant transabdominal ultrasound as first-line imaging", "Magnetic resonance cholangiopancreatography (MRCP) for choledocholithiasis or duct injury", "Endoscopic retrograde cholangiopancreatography (ERCP) for therapeutic stone extraction or stenting"],
    differentials: ["Acute calculous cholecystitis", "Acute acalculous cholecystitis in critically ill patients", "Acute ascending cholangitis", "Biliary pancreatitis"]
  },
  {
    id: "groin_hernias_anatomy_and_surgical_repair",
    name: "Groin Hernias: Inguinal Anatomy, Lichtenstein and Laparoscopic Repairs",
    aliases: ["Inguinal hernia", "Femoral hernia", "Lichtenstein repair", "TAPP and TEP"],
    system: "Abdominal Wall / General Surgery",
    specialty: "General Surgery / Hernia Surgery",
    source: "Sabiston Textbook of Surgery 22nd ed / European Hernia Society Guidelines",
    pearls: [
      "Indirect inguinal hernia passes through deep ring lateral to inferior epigastric vessels; direct hernia bulges through Hesselbach triangle medial to vessels",
      "Femoral hernia passes below inguinal ligament medial to femoral vein; rigid boundaries (lacunar ligament) confer a 40% strangulation risk",
      "Lichtenstein tension-free mesh repair is the open standard; polypropylene mesh secured to inguinal ligament and conjoint tendon",
      "Laparoscopic repairs (TAPP/TEP) cover the entire myopectineal orifice of Fruchaud, superior for bilateral or recurrent hernias",
      "Anatomical danger zones in preperitoneal repair: Triangle of Doom (iliac vessels), Triangle of Pain (femoral branch of genitofemoral and LFCN)"
    ],
    patho: "Inguinal hernias result from patent processus vaginalis (indirect, congenital) or transversalis fascia attenuation in Hesselbach triangle (direct, acquired collagen disorder with decreased type I to type III collagen ratio). Incarceration occurs when contents cannot be reduced; strangulation occurs when tissue venous outflow and arterial inflow become compromised, resulting in ischemic bowel necrosis.",
    investigations: ["Clinical physical examination in standing and supine positions during Valsalva", "Groin ultrasound for occult or ambiguous groin swelling", "Dynamic pelvic MRI or CT with Valsalva maneuver for complex or recurrent hernias"],
    differentials: ["Indirect inguinal hernia", "Direct inguinal hernia", "Femoral hernia", "Hydrocele of cord / testicular hydrocele", "Groin lymphadenopathy"]
  }
];

let written = 0;
for (const art of articles) {
  const obj = {
    id: art.id,
    name: art.name,
    aliases: art.aliases,
    class: "non_infective",
    system: art.system,
    specialty: art.specialty,
    referenceOnly: true,
    review: { status: "ai_drafted" },
    reference: {
      source: art.source,
      sourceEdition: "current",
      clinicalPearls: art.pearls,
      pathophysiology: art.patho,
      additionalDifferentials: art.differentials,
      additionalInvestigations: art.investigations
    }
  };

  const p = path.join(REF_DIR, `${art.id}.json`);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
  written++;
}

console.log(`Successfully generated ${written} KB reference articles in kb/reference/.`);
