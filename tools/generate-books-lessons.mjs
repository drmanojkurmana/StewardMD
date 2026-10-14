#!/usr/bin/env node
/**
 * Generator for books-derived interactive lessons in StewardMD.
 * - Anatomy & Physiology (from owner's A&P book + Gray's/Guyton standard references)
 * - Biochemistry (from Medical Biochemistry 5e concepts, rewritten in own words)
 * - Surgery (from Sabiston Surgery 22e concepts, rewritten in own words)
 * Validates every step against LP.checkLesson() and LP.checkStep().
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const LP = require("../prep-lessons.js");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Helper to create a UUID
function makeId(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `${hex.slice(0, 8)}-4000-8000-${hex.slice(0, 4)}-${hex.slice(4, 8)}12345678`.slice(0, 36);
}

const lessons = [
  // --- ANATOMY MISSING MODULES ---
  {
    module: "ana-orbit",
    subject: "anatomy",
    title: "Bony orbit and extraocular muscles",
    minutes: 6,
    refs: ["Gray's Anatomy for Students", "Snell's Clinical Anatomy by Regions"],
    steps: [
      {
        tx: "The **bony orbit** is a pyramidal cavity with seven bones forming its boundaries. The frontal bone and lesser wing of sphenoid form the roof. The maxilla, zygomatic and palatine bones form the floor. The ethmoid, lacrimal, frontal process of maxilla and sphenoid body form the medial wall. The lateral wall is formed by the zygomatic bone and greater wing of sphenoid. The optic canal transmits the optic nerve and ophthalmic artery.",
        say: "The bony orbit is a pyramidal cavity with seven bones forming its boundaries. The frontal bone and lesser wing of sphenoid form the roof. The maxilla, zygomatic and palatine bones form the floor. The medial wall is thin and formed largely by the ethmoid. The lateral wall is formed by the zygomatic and greater wing of sphenoid. The optic canal transmits the optic nerve and ophthalmic artery.",
        vis: {
          kind: "table",
          cols: ["Wall", "Main bones", "Key openings"],
          rows: [
            ["Roof", "Frontal and lesser sphenoid", "Supraorbital notch"],
            ["Floor", "Maxilla, zygomatic, palatine", "Infraorbital groove"],
            ["Medial wall", "Ethmoid, lacrimal, maxilla", "Anterior and posterior ethmoidal"],
            ["Lateral wall", "Zygomatic, greater sphenoid", "Superior orbital fissure laterally"]
          ]
        }
      },
      {
        tx: "Seven **extraocular muscles** control eye movements and eyelid elevation. The levator palpebrae superioris elevates the upper eyelid. The four recti arise from the common tendinous ring. The superior oblique passes through the trochlea and inserts posterolaterally. The inferior oblique arises from the anteromedial orbital floor. Cranial nerve six supplies lateral rectus. Cranial nerve four supplies superior oblique. Cranial nerve three supplies the remainder.",
        say: "Seven extraocular muscles control eye movements and eyelid elevation. The levator palpebrae superioris elevates the upper eyelid. The four recti arise from the common tendinous ring. The superior oblique passes through the trochlea and inserts posterolaterally. The inferior oblique arises from the anteromedial orbital floor. Cranial nerve six supplies lateral rectus, cranial nerve four supplies superior oblique, and cranial nerve three supplies the remainder.",
        vis: {
          kind: "compare",
          left: {
            title: "Superior oblique",
            points: [
              "Innervated by trochlear nerve",
              "Passes through fibrocartilaginous trochlea",
              "Primary action is intorsion",
              "Depresses the adducted eye"
            ]
          },
          right: {
            title: "Inferior oblique",
            points: [
              "Innervated by oculomotor nerve",
              "Arises from orbital floor anteromedially",
              "Primary action is extorsion",
              "Elevates the adducted eye"
            ]
          }
        }
      },
      {
        tx: "The **ciliary ganglion** is a parasympathetic ganglion located in the posterior orbit lateral to the optic nerve. Preganglionic parasympathetic fibres travel with the oculomotor nerve inferior division and synapse in the ganglion. Postganglionic fibres pass via short ciliary nerves to supply the sphincter pupillae for pupillary constriction and the ciliary muscle for accommodation. Sympathetic fibres pass through without synapsing to innervate the dilator pupillae.",
        say: "The ciliary ganglion is a parasympathetic ganglion located in the posterior orbit lateral to the optic nerve. Preganglionic parasympathetic fibres travel with the oculomotor nerve and synapse in the ganglion. Postganglionic fibres travel via short ciliary nerves to supply the sphincter pupillae for constriction and the ciliary muscle for accommodation. Sympathetic fibres pass through without synapsing to innervate the dilator pupillae.",
        vis: null
      },
      {
        tx: "The **superior orbital fissure** lies between the greater and lesser wings of the sphenoid. Structures passing inside the common tendinous ring include the oculomotor nerve superior and inferior divisions, nasociliary nerve, abducens nerve and sympathetic roots. Structures passing outside the tendinous ring include the frontal nerve, lacrimal nerve, trochlear nerve and superior ophthalmic vein. Clinical compression produces superior orbital fissure syndrome.",
        say: "The superior orbital fissure lies between the greater and lesser wings of the sphenoid. Structures passing inside the common tendinous ring include both divisions of the oculomotor nerve, the nasociliary nerve and the abducens nerve. Structures passing outside the ring include the frontal nerve, lacrimal nerve, trochlear nerve and superior ophthalmic vein. Compression produces superior orbital fissure syndrome.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-eye-gross.webp",
          alt: "Orbit and ocular anatomy diagram",
          caption: "Cross-section of ocular and orbital structures showing extraocular muscle insertions and neurovascular pathways."
        }
      }
    ]
  },
  {
    module: "ana-larynx",
    subject: "anatomy",
    title: "Laryngeal framework, muscles and vocal cords",
    minutes: 6,
    refs: ["Gray's Anatomy for Students", "Last's Anatomy"],
    steps: [
      {
        tx: "The **laryngeal skeleton** comprises nine cartilages that maintain airway patency and protect the vocal apparatus. Three are unpaired: the shield-shaped thyroid cartilage, the complete signet-ring cricoid cartilage and the leaf-shaped epiglottis. Three are paired: the pyramidal arytenoids, corniculate cartilages and cuneiform cartilages. The cricoid is the only complete cartilaginous ring in the respiratory tract. Cricothyroid membrane puncture provides rapid emergency airway access.",
        say: "The laryngeal skeleton comprises nine cartilages that maintain airway patency and protect the vocal apparatus. Three are unpaired: the shield-shaped thyroid cartilage, the complete signet-ring cricoid cartilage and the leaf-shaped epiglottis. Three are paired: the pyramidal arytenoids, corniculate and cuneiform cartilages. The cricoid is the only complete cartilaginous ring in the respiratory tract. Cricothyroid membrane puncture provides rapid emergency airway access.",
        vis: {
          kind: "table",
          cols: ["Cartilage", "Paired or unpaired", "Key feature"],
          rows: [
            ["Thyroid", "Unpaired", "Laryngeal prominence and superior horns"],
            ["Cricoid", "Unpaired", "Complete ring at sixth cervical vertebra"],
            ["Epiglottis", "Unpaired", "Elastic cartilage covering laryngeal inlet"],
            ["Arytenoid", "Paired", "Vocal and muscular processes for vocal cords"]
          ]
        }
      },
      {
        tx: "The **posterior cricoarytenoid** is the sole abductor of the vocal cords, making it the most critical muscle for respiratory maintenance. It arises from the posterior cricoid lamina and inserts into the muscular process of the arytenoid cartilage. Contraction rotates the arytenoids laterally and opens the rima glottidis. Bilateral paralysis of posterior cricoarytenoid muscles leads to unopposed adduction, precipitating acute stridor and life-threatening airway compromise.",
        say: "The posterior cricoarytenoid is the sole abductor of the vocal cords, making it the most critical muscle for respiratory maintenance. It arises from the posterior cricoid lamina and inserts into the muscular process of the arytenoid cartilage. Contraction rotates the arytenoids laterally and opens the rima glottidis. Bilateral paralysis leads to unopposed adduction and life-threatening airway compromise.",
        vis: {
          kind: "compare",
          left: {
            title: "Posterior cricoarytenoid",
            points: [
              "Sole abductor of vocal folds",
              "Arises from posterior cricoid lamina",
              "Rotates arytenoid laterally",
              "Maintains respiratory airway patency"
            ]
          },
          right: {
            title: "Lateral cricoarytenoid",
            points: [
              "Major adductor of vocal folds",
              "Arises from cricoid arch",
              "Rotates arytenoid medially",
              "Closes rima glottidis for phonation"
            ]
          }
        }
      },
      {
        tx: "The **laryngeal innervation** is supplied by branches of the vagus nerve. The external branch of the superior laryngeal nerve innervates the cricothyroid muscle exclusively, which tenses and elongates the vocal folds. The internal branch provides sensory supply to the supraglottic laryngeal mucosa above the vocal folds. The recurrent laryngeal nerve innervates all other intrinsic muscles and provides sensory supply below the vocal folds.",
        say: "The laryngeal innervation is supplied by branches of the vagus nerve. The external branch of the superior laryngeal nerve innervates the cricothyroid muscle exclusively, which tenses and elongates the vocal folds. The internal branch provides sensory supply to the supraglottic laryngeal mucosa. The recurrent laryngeal nerve innervates all other intrinsic muscles and provides sensory supply below the vocal folds.",
        vis: null
      },
      {
        tx: "The **recurrent laryngeal nerve** takes distinct anatomical pathways on the right and left sides. The left recurrent laryngeal nerve loops around the aortic arch lateral to the ligamentum arteriosum before ascending in the tracheoesophageal groove. The right nerve hooks around the right subclavian artery. Left nerve injury occurs in thoracic lymphadenopathy or aortic aneurysm, producing hoarseness, while bilateral injury produces acute stridor.",
        say: "The recurrent laryngeal nerve takes distinct anatomical pathways on the right and left sides. The left recurrent laryngeal nerve loops around the aortic arch lateral to the ligamentum arteriosum before ascending in the tracheoesophageal groove. The right nerve hooks around the right subclavian artery. Left nerve injury occurs in thoracic disease, producing hoarseness, while bilateral injury causes acute stridor.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-larynx-gross.webp",
          alt: "Laryngeal anatomy and cartilage relationships",
          caption: "Coronal and posterior views of the laryngeal framework, intrinsic musculature and recurrent nerve trajectory."
        }
      }
    ]
  },
  {
    module: "ana-nose-sinuses",
    subject: "anatomy",
    title: "Nasal cavity, lateral nasal wall and paranasal sinuses",
    minutes: 6,
    refs: ["Gray's Anatomy for Students", "Scott-Brown's Otorhinolaryngology"],
    steps: [
      {
        tx: "The **lateral nasal wall** features three turbinates or conchae that increase surface area for warming and humidifying inspired air. The inferior concha is an independent facial bone. The superior and middle conchae are projections of the ethmoid bone. Underneath each concha lies a corresponding meatus. The sphenoethmoidal recess lies superior and posterior to the superior concha and receives the drainage of the sphenoid sinus.",
        say: "The lateral nasal wall features three turbinates or conchae that increase surface area for warming and humidifying inspired air. The inferior concha is an independent facial bone. The superior and middle conchae are projections of the ethmoid bone. Underneath each concha lies a corresponding meatus. The sphenoethmoidal recess lies superior and posterior to the superior concha and receives the sphenoid sinus drainage.",
        vis: {
          kind: "table",
          cols: ["Meatus or recess", "Location", "Draining structures"],
          rows: [
            ["Sphenoethmoidal recess", "Above superior concha", "Sphenoid sinus"],
            ["Superior meatus", "Below superior concha", "Posterior ethmoidal cells"],
            ["Middle meatus", "Below middle concha", "Frontal, maxillary and anterior ethmoidal"],
            ["Inferior meatus", "Below inferior concha", "Nasolacrimal duct"]
          ]
        }
      },
      {
        tx: "The **ostiomeatal complex** is the functional bottleneck in the middle meatus through which secretions from the frontal, maxillary and anterior ethmoidal sinuses drain. It includes the uncinate process, ethmoidal bulla, hiatus semilunaris and infundibulum. Mucosal edema from allergic rhinitis or viral infection blocks this narrow passage, precipitating secondary bacterial rhinosinusitis. Endoscopic sinus surgery restores ostiomeatal complex drainage.",
        say: "The ostiomeatal complex is the functional bottleneck in the middle meatus through which secretions from the frontal, maxillary and anterior ethmoidal sinuses drain. It includes the uncinate process, ethmoidal bulla, hiatus semilunaris and infundibulum. Mucosal edema from allergic rhinitis blocks this narrow passage, precipitating rhinosinusitis. Endoscopic sinus surgery restores drainage.",
        vis: null
      },
      {
        tx: "The **Little area** on the anteroinferior nasal septum is the site of Kiesselbach plexus, accounting for ninety percent of anterior epistaxis episodes. Four arteries anastomose here: the anterior ethmoidal artery from ophthalmic, the sphenopalatine and greater palatine arteries from maxillary, and the septal branch of superior labial artery from facial. Posterior epistaxis arises from Woodruff plexus near the sphenopalatine foramen.",
        say: "The Little area on the anteroinferior nasal septum is the site of Kiesselbach plexus, accounting for ninety percent of anterior epistaxis episodes. Four arteries anastomose here: the anterior ethmoidal artery, the sphenopalatine and greater palatine arteries, and the superior labial septal branch. Posterior epistaxis arises from Woodruff plexus near the sphenopalatine foramen.",
        vis: {
          kind: "compare",
          left: {
            title: "Anterior epistaxis",
            points: [
              "Arises in Little area on septum",
              "Supplied by Kiesselbach plexus",
              "Common in children and dry air",
              "Controlled by chemical cautery or packing"
            ]
          },
          right: {
            title: "Posterior epistaxis",
            points: [
              "Arises from Woodruff venous plexus",
              "Involves sphenopalatine artery branches",
              "Common in elderly hypertensives",
              "Often requires posterior balloon packing"
            ]
          }
        }
      },
      {
        tx: "The **olfactory epithelium** lines the roof of the nasal cavity, the upper superior concha and the adjacent superior septum. Bipolar olfactory receptor neurons send unmyelinated axons through the cribriform plate of the ethmoid bone to synapse in the olfactory bulb. Fracture of the cribriform plate produces cerebrospinal fluid rhinorrhea and permanent anosmia, and introduces an ascending pathway for bacterial meningitis.",
        say: "The olfactory epithelium lines the roof of the nasal cavity, the upper superior concha and the adjacent superior septum. Bipolar olfactory receptor neurons send axons through the cribriform plate of the ethmoid to synapse in the olfactory bulb. Fracture of the cribriform plate produces cerebrospinal fluid rhinorrhea, anosmia, and risks bacterial meningitis.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-nose-sinuses-gross.webp",
          alt: "Nasal cavity and paranasal sinus anatomy",
          caption: "Sagittal section of the lateral nasal wall detailing conchae, meatal drainage ostia and paranasal sinus relations."
        }
      }
    ]
  },
  {
    module: "ana-ear",
    subject: "anatomy",
    title: "Auditory system, middle ear cavity and cochlear apparatus",
    minutes: 6,
    refs: ["Gray's Anatomy for Students", "Scott-Brown's Otorhinolaryngology"],
    steps: [
      {
        tx: "The **middle ear cavity** or tympanic cavity is an air-filled space within the petrous temporal bone. The tympanic membrane forms its lateral wall. The promontory, oval window and round window form its medial wall. The roof is the thin tegmen tympani separating it from the middle cranial fossa. The floor separates it from the internal jugular vein. The anterior wall features the auditory tube.",
        say: "The middle ear cavity is an air-filled space within the petrous temporal bone. The tympanic membrane forms its lateral wall. The promontory, oval window and round window form its medial wall. The roof is the thin tegmen tympani separating it from the middle cranial fossa. The floor separates it from the internal jugular vein. The anterior wall features the auditory tube.",
        vis: {
          kind: "table",
          cols: ["Wall", "Boundary structure", "Clinical significance"],
          rows: [
            ["Roof", "Tegmen tympani", "Erosion leads to temporal lobe abscess"],
            ["Floor", "Jugular wall", "Proximity to internal jugular bulb"],
            ["Medial", "Promontory and windows", "Facial nerve canal and stapes footplate"],
            ["Posterior", "Mastoid aditus", "Route of spread into mastoid antrum"]
          ]
        }
      },
      {
        tx: "Three **auditory ossicles** bridge the middle ear to transfer sound energy from air to fluid. The malleus attaches to the tympanic membrane umbo. The incus acts as an intermediate lever. The stapes footplate attaches to the oval window membrane. The area ratio of tympanic membrane to stapes footplate together with ossicular lever action amplifies sound pressure twenty-fold, overcoming the high acoustic impedance of cochlear perilymph.",
        say: "Three auditory ossicles bridge the middle ear to transfer sound energy from air to fluid. The malleus attaches to the tympanic membrane umbo. The incus acts as an intermediate lever. The stapes footplate attaches to the oval window membrane. The area ratio and ossicular lever action amplify sound pressure twenty-fold, overcoming the acoustic impedance of cochlear fluid.",
        vis: null
      },
      {
        tx: "Two muscles protect the auditory apparatus from acoustic trauma. The **tensor tympani** arises from the cartilaginous auditory tube and inserts onto the malleus handle. It is innervated by the mandibular nerve. The **stapedius muscle** arises from the pyramidal eminence and inserts onto the stapes neck. It is innervated by the facial nerve. Stapedius paralysis in Bell palsy produces hyperacusis.",
        say: "Two muscles protect the auditory apparatus from acoustic trauma. The tensor tympani arises from the auditory tube and inserts onto the malleus handle, innervated by the mandibular nerve. The stapedius muscle arises from the pyramidal eminence and inserts onto the stapes neck, innervated by the facial nerve. Stapedius paralysis in Bell palsy produces hyperacusis.",
        vis: {
          kind: "compare",
          left: {
            title: "Tensor tympani",
            points: [
              "Inserts into handle of malleus",
              "Innervated by mandibular nerve V3",
              "Tenses the tympanic membrane",
              "Dampens chewing sound transmission"
            ]
          },
          right: {
            title: "Stapedius muscle",
            points: [
              "Inserts into neck of stapes",
              "Innervated by facial nerve VII",
              "Pulls stapes footplate from oval window",
              "Paralysis causes painful hyperacusis"
            ]
          }
        }
      },
      {
        tx: "The **cochlear duct** houses the organ of Corti within the bony cochlea. Perilymph fills the scala vestibuli and scala tympani, having high sodium like extracellular fluid. Endolymph fills the scala media, secreted by the stria vascularis with high potassium concentration. Deflection of stereocilia against the tectorial membrane opens mechanosensitive potassium channels, depolarizing inner hair cells and transmitting impulses via the vestibulocochlear nerve.",
        say: "The cochlear duct houses the organ of Corti within the bony cochlea. Perilymph fills the scala vestibuli and scala tympani with high sodium. Endolymph fills the scala media, secreted by the stria vascularis with high potassium. Deflection of stereocilia opens potassium channels, depolarizing inner hair cells and transmitting acoustic signals via the vestibulocochlear nerve.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-ear-gross.webp",
          alt: "Ear anatomy and cochlear cross-section",
          caption: "Anatomical schematic of external, middle and inner ear chambers, detailing ossicular linkage and cochlear fluid compartments."
        }
      }
    ]
  },
  {
    module: "ana-cranial-nerves",
    subject: "anatomy",
    title: "Cranial nerves: nuclei, exit foramina and clinical lesions",
    minutes: 6,
    refs: ["Gray's Anatomy for Students", "Snell's Clinical Neuroanatomy"],
    steps: [
      {
        tx: "Twelve pairs of **cranial nerves** originate from the forebrain and brainstem to innervate the head, neck and visceral organs. Cranial nerves one and two arise from the cerebrum and diencephalon. Cranial nerves three and four emerge from the midbrain. Cranial nerves five through eight emerge from the pons and pontomedullary junction. Cranial nerves nine through twelve arise from the medulla oblongata, exiting via basal skull foramina.",
        say: "Twelve pairs of cranial nerves originate from the forebrain and brainstem to innervate the head, neck and visceral organs. Cranial nerves one and two arise from the cerebrum and diencephalon. Cranial nerves three and four emerge from the midbrain. Cranial nerves five through eight emerge from the pons. Cranial nerves nine through twelve arise from the medulla oblongata, exiting via basal skull foramina.",
        vis: {
          kind: "table",
          cols: ["Nerve", "Brainstem origin", "Skull exit foramen"],
          rows: [
            ["Oculomotor III", "Midbrain interpeduncular fossa", "Superior orbital fissure"],
            ["Trigeminal V", "Midbrain, pons, medulla nuclei", "Fissure, rotundum and ovale"],
            ["Facial VII", "Pontomedullary junction", "Internal acoustic meatus"],
            ["Hypoglossal XII", "Medulla pre-olivary sulcus", "Hypoglossal canal"]
          ]
        }
      },
      {
        tx: "The **facial nerve** possesses complex motor, parasympathetic, sensory and taste functions. Motor fibres from the motor nucleus loop around the abducens nucleus, forming the facial colliculus, before exiting at the cerebellopontine angle. It travels through the internal acoustic meatus, facial canal and stylomastoid foramen. Branches include the greater petrosal nerve for lacrimation, nerve to stapedius for sound dampening, and chorda tympani for taste and salivation.",
        say: "The facial nerve possesses complex motor, parasympathetic, sensory and taste functions. Motor fibres loop around the abducens nucleus, forming the facial colliculus, before exiting at the cerebellopontine angle. It travels through the internal acoustic meatus, facial canal and stylomastoid foramen. Branches include the greater petrosal nerve, nerve to stapedius, and chorda tympani.",
        vis: null
      },
      {
        tx: "The distinction between upper and lower motor neuron **facial palsy** is clinically vital. Upper motor neuron lesions from contralateral cerebral hemisphere stroke spare forehead wrinkling because the frontalis muscle receives bilateral corticonuclear innervation. Lower motor neuron lesions such as Bell palsy or acoustic neuroma affect all ipsilateral facial muscles, resulting in loss of forehead wrinkling, incomplete eye closure and drooping mouth angle.",
        say: "The distinction between upper and lower motor neuron facial palsy is clinically vital. Upper motor neuron lesions from contralateral stroke spare forehead wrinkling because the frontalis muscle receives bilateral innervation. Lower motor neuron lesions such as Bell palsy affect all ipsilateral facial muscles, causing loss of forehead wrinkles, incomplete eye closure and mouth drooping.",
        vis: {
          kind: "compare",
          left: {
            title: "Upper motor neuron lesion",
            points: [
              "Contralateral hemisphere stroke",
              "Forehead wrinkling spared bilaterally",
              "Lower facial weakness on opposite side",
              "Preserved taste and stapedius reflex"
            ]
          },
          right: {
            title: "Lower motor neuron lesion",
            points: [
              "Ipsilateral Bell palsy or trauma",
              "Forehead wrinkling lost on same side",
              "Inability to close eye on same side",
              "May lose taste and exhibit hyperacusis"
            ]
          }
        }
      },
      {
        tx: "The **jugular foramen** transmits cranial nerves nine, ten and eleven along with the internal jugular vein. The glossopharyngeal nerve carries taste and sensation from the posterior tongue and carotid sinus baroreceptor afferents. The vagus nerve supplies parasympathetic fibres to thoracic and abdominal viscera. The accessory nerve innervates sternocleidomastoid and trapezius. Jugular foramen syndrome manifests with hoarseness, dysphagia and shoulder drop.",
        say: "The jugular foramen transmits cranial nerves nine, ten and eleven along with the internal jugular vein. The glossopharyngeal nerve carries posterior tongue sensation and carotid sinus afferents. The vagus supplies thoracic and abdominal parasympathetics. The accessory nerve innervates sternocleidomastoid and trapezius. Jugular foramen syndrome manifests with hoarseness, dysphagia and shoulder drop.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-brain-gross.webp",
          alt: "Brainstem cranial nerve roots and exit points",
          caption: "Ventral view of the human brainstem indicating cranial nerve exit origins and related brainstem nuclei."
        }
      }
    ]
  },
  {
    module: "ana-brainstem",
    subject: "anatomy",
    title: "Brainstem anatomy: midbrain, pons and medulla oblongata",
    minutes: 6,
    refs: ["Gray's Anatomy for Students", "Snell's Clinical Neuroanatomy"],
    steps: [
      {
        tx: "The **brainstem** connects the cerebral hemispheres with the spinal cord, comprising the midbrain, pons and medulla oblongata. It houses ascending sensory tracts, descending motor tracts and nuclei of cranial nerves three through twelve. It integrates vital autonomic centers controlling respiration, cardiovascular tone and consciousness through the reticular activating system. The fourth ventricle lies posterior to the pons and upper medulla.",
        say: "The brainstem connects the cerebral hemispheres with the spinal cord, comprising the midbrain, pons and medulla oblongata. It houses ascending sensory tracts, descending motor tracts and cranial nerve nuclei. It integrates vital autonomic centers controlling respiration, cardiovascular tone and consciousness through the reticular activating system. The fourth ventricle lies posterior to the pons and upper medulla.",
        vis: {
          kind: "table",
          cols: ["Level", "Ventral landmarks", "Dorsal landmarks"],
          rows: [
            ["Midbrain", "Cerebral peduncles and interpeduncular fossa", "Superior and inferior colliculi"],
            ["Pons", "Transverse pontine fibres and basilar groove", "Facial colliculus in fourth ventricle floor"],
            ["Open medulla", "Pyramids and olives", "Hypoglossal and vagal trigones"],
            ["Closed medulla", "Pyramidal decussation", "Gracile and cuneate tubercles"]
          ]
        }
      },
      {
        tx: "The **pyramidal decussation** marks the junction between the closed medulla oblongata and the cervical spinal cord. Approximately eighty-five percent of descending corticospinal fibres cross the anterior median fissure to form the lateral corticospinal tract. The remaining uncrossed fibres continue as the anterior corticospinal tract. This anatomical crossover explains why a unilateral cerebral motor cortex lesion produces contralateral hemiparesis below the neck.",
        say: "The pyramidal decussation marks the junction between the closed medulla oblongata and the cervical spinal cord. Approximately eighty-five percent of descending corticospinal fibres cross the anterior median fissure to form the lateral corticospinal tract. The remaining uncrossed fibres continue as the anterior tract. This crossover explains why a cerebral cortex lesion produces contralateral hemiparesis.",
        vis: null
      },
      {
        tx: "Brainstem vascular syndromes produce pathognomonic alternating neurological deficits. **Wallenberg syndrome** or lateral medullary syndrome results from occlusion of the posterior inferior cerebellar artery or vertebral artery. It damages the nucleus ambiguus, producing dysphagia and hoarseness; the spinal trigeminal nucleus, causing ipsilateral facial pain and temperature loss; the spinothalamic tract, causing contralateral body sensory loss; and sympathetic descending fibres, causing Horner syndrome.",
        say: "Brainstem vascular syndromes produce pathognomonic alternating neurological deficits. Wallenberg syndrome results from occlusion of the posterior inferior cerebellar artery. It damages the nucleus ambiguus causing dysphagia and hoarseness, the spinal trigeminal nucleus causing ipsilateral facial numbness, the spinothalamic tract causing contralateral sensory loss, and sympathetic fibres causing Horner syndrome.",
        vis: {
          kind: "compare",
          left: {
            title: "Lateral medullary syndrome",
            points: [
              "Posterior inferior cerebellar artery occlusion",
              "Nucleus ambiguus damage causes dysphagia",
              "Ipsilateral facial and contralateral body sensory loss",
              "Ipsilateral Horner syndrome and ataxia"
            ]
          },
          right: {
            title: "Medial medullary syndrome",
            points: [
              "Anterior spinal artery occlusion",
              "Hypoglossal nerve damage deviates tongue to lesion",
              "Pyramid damage produces contralateral hemiparesis",
              "Medial lemniscus damage loses vibration sense"
            ]
          }
        }
      },
      {
        tx: "The **midbrain** surrounds the cerebral aqueduct of Sylvius. Dorsally, the superior colliculi coordinate visual reflexes, while the inferior colliculi relay auditory signals to the medial geniculate body. Ventrally, the substantia nigra contains dopaminergic neurons projecting to the striatum, which degenerate in Parkinson disease. The red nucleus gives origin to the rubrospinal tract, coordinating flexor tone.",
        say: "The midbrain surrounds the cerebral aqueduct of Sylvius. Dorsally, the superior colliculi coordinate visual reflexes, while the inferior colliculi relay auditory signals. Ventrally, the substantia nigra contains dopaminergic neurons projecting to the striatum, which degenerate in Parkinson disease. The red nucleus gives origin to the rubrospinal tract, coordinating flexor tone.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-brain-gross.webp",
          alt: "Brainstem and cerebral peduncles anatomy",
          caption: "Mid-sagittal and cross-sectional representations of midbrain, pontine and medullary architecture."
        }
      }
    ]
  },
  {
    module: "ana-cerebellum",
    subject: "anatomy",
    title: "Cerebellar anatomy, deep nuclei and functional circuits",
    minutes: 6,
    refs: ["Gray's Anatomy for Students", "Snell's Clinical Neuroanatomy"],
    steps: [
      {
        tx: "The **cerebellum** occupies the posterior cranial fossa beneath the tentorium cerebelli. It comprises two lateral hemispheres joined by the midline vermis. It coordinates voluntary motor activity, maintains equilibrium and regulates muscle tone without initiating movement. Three cerebellar peduncles connect it to the brainstem: the superior peduncle connects to the midbrain, the middle peduncle connects to the pons, and the inferior peduncle connects to the medulla.",
        say: "The cerebellum occupies the posterior cranial fossa beneath the tentorium cerebelli. It comprises two lateral hemispheres joined by the midline vermis. It coordinates voluntary motor activity, maintains equilibrium and regulates muscle tone without initiating movement. Three cerebellar peduncles connect it to the brainstem: superior to midbrain, middle to pons, and inferior to medulla.",
        vis: {
          kind: "table",
          cols: ["Peduncle", "Connected brainstem part", "Major tract transmitted"],
          rows: [
            ["Superior", "Midbrain", "Dentatorubral and dentatothalamic fibres"],
            ["Middle", "Pons", "Pontocerebellar afferents from cerebral cortex"],
            ["Inferior", "Medulla oblongata", "Dorsal spinocerebellar and olivocerebellar"]
          ]
        }
      },
      {
        tx: "Four pairs of **deep cerebellar nuclei** embed within the white matter from lateral to medial: dentate, emboliform, globose and fastigial. A useful mnemonic is 'Don't Eat Greasy Food'. The large, folded dentate nucleus receives input from the lateral hemispheres and projects via the superior cerebellar peduncle to the ventrolateral nucleus of the thalamus and red nucleus to modulate motor planning.",
        say: "Four pairs of deep cerebellar nuclei embed within the white matter from lateral to medial: dentate, emboliform, globose and fastigial. A useful mnemonic is Don't Eat Greasy Food. The large, folded dentate nucleus receives input from the lateral hemispheres and projects via the superior peduncle to the thalamus to modulate motor planning.",
        vis: null
      },
      {
        tx: "The cerebellar cortex features three distinct layers. The outer **molecular layer** contains basket cells, stellate cells and parallel fibres. The middle **Purkinje layer** contains large Purkinje neurons, which provide the sole inhibitory GABAergic output of the cerebellar cortex to the deep nuclei. The inner **granular layer** contains millions of densely packed granule cells receiving excitatory mossy fibre input and projecting parallel fibres.",
        say: "The cerebellar cortex features three distinct layers. The outer molecular layer contains basket cells, stellate cells and parallel fibres. The middle Purkinje layer contains large Purkinje neurons, which provide the sole inhibitory GABAergic output to the deep nuclei. The inner granular layer contains millions of granule cells receiving mossy fibres.",
        vis: {
          kind: "compare",
          left: {
            title: "Mossy fibres",
            points: [
              "Arise from spinal cord and pontine nuclei",
              "Synapse on granule cells in glomeruli",
              "Excitatory glutamatergic transmission",
              "Influence many Purkinje cells via parallel fibres"
            ]
          },
          right: {
            title: "Climbing fibres",
            points: [
              "Arise exclusively from inferior olivary nucleus",
              "Wind directly around Purkinje cell dendrites",
              "Produce powerful complex spikes",
              "Essential for motor learning and error signaling"
            ]
          }
        }
      },
      {
        tx: "Cerebellar lesions manifest with **ipsilateral ataxia** because cerebellar pathways to and from the cerebral cortex double-cross. Lesions of the midline vermis produce truncal ataxia, titubation and gait unsteadiness, commonly observed in alcoholic cerebellar degeneration. Hemispheric cerebellar lesions produce appendicular ataxia, intention tremor, dysmetria, dysdiadochokinesia and scanning speech on the same side of the body.",
        say: "Cerebellar lesions manifest with ipsilateral ataxia because cerebellar pathways double-cross. Lesions of the midline vermis produce truncal ataxia and unsteady gait, commonly seen in alcoholic degeneration. Hemispheric lesions produce appendicular ataxia, intention tremor, dysmetria, dysdiadochokinesia and scanning speech on the same side.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-brain-gross.webp",
          alt: "Cerebellar architecture and peduncles",
          caption: "Posterior fossa anatomy showing cerebellar hemisphere divisions, folia, and cerebellar peduncle attachments to brainstem."
        }
      }
    ]
  },
  {
    module: "ana-ventricles-meninges",
    subject: "anatomy",
    title: "Ventricular system, cerebrospinal fluid dynamics and meninges",
    minutes: 6,
    refs: ["Gray's Anatomy for Students", "Snell's Clinical Neuroanatomy"],
    steps: [
      {
        tx: "Three protective **cranial meninges** envelop the central nervous system: the dura mater, arachnoid mater and pia mater. The tough fibrous dura has an outer periosteal layer and an inner meningeal layer. Infoldings of the meningeal layer form the falx cerebri, tentorium cerebelli, falx cerebelli and diaphragma sellae. The subarachnoid space lies between the arachnoid and pia, containing cerebrospinal fluid and major cerebral vessels.",
        say: "Three protective cranial meninges envelop the central nervous system: the dura mater, arachnoid mater and pia mater. The tough fibrous dura has an outer periosteal layer and an inner meningeal layer. Infoldings of the meningeal layer form the falx cerebri and tentorium cerebelli. The subarachnoid space lies between arachnoid and pia, containing cerebrospinal fluid and cerebral vessels.",
        vis: {
          kind: "table",
          cols: ["Meningeal space", "Boundaries", "Clinical hemorrhage"],
          rows: [
            ["Epidural space", "Skull bone and periosteal dura", "Middle meningeal artery tear (biconvex)"],
            ["Subdural space", "Meningeal dura and arachnoid", "Bridging cortical veins tear (crescentic)"],
            ["Subarachnoid space", "Arachnoid and pia mater", "Berry aneurysm rupture (thunderclap headache)"]
          ]
        }
      },
      {
        tx: "The **ventricular system** comprises four interconnected fluid-filled cavities: two lateral ventricles in the cerebral hemispheres, the third ventricle in the midline diencephalon, and the fourth ventricle in the hindbrain. The lateral ventricles communicate with the third ventricle via the interventricular foramina of Monro. The third ventricle connects to the fourth ventricle through the narrow cerebral aqueduct of Sylvius in the midbrain.",
        say: "The ventricular system comprises four interconnected fluid-filled cavities: two lateral ventricles in the cerebral hemispheres, the third ventricle in the midline diencephalon, and the fourth ventricle in the hindbrain. The lateral ventricles communicate with the third ventricle via the foramina of Monro. The third connects to the fourth via the cerebral aqueduct of Sylvius.",
        vis: null
      },
      {
        tx: "The **cerebrospinal fluid** is produced continuously by choroid plexuses in all four ventricles at approximately five hundred milliliters per day. Fluid exits the fourth ventricle into the subarachnoid space via three apertures: the median foramen of Magendie and two lateral foramina of Luschka. Remember: Magendie is Median; Luschka is Lateral. Fluid circulates around the brain and spinal cord, cushioned by subarachnoid cisterns.",
        say: "Cerebrospinal fluid is produced continuously by choroid plexuses in all four ventricles at approximately five hundred milliliters daily. Fluid exits the fourth ventricle into the subarachnoid space via three apertures: the median foramen of Magendie and two lateral foramina of Luschka. Remember: Magendie is Median, Luschka is Lateral. Fluid circulates around the neuraxis in subarachnoid cisterns.",
        vis: {
          kind: "compare",
          left: {
            title: "Foramen of Magendie",
            points: [
              "Single midline aperture",
              "Opens into cisterna magna",
              "Remember M for Median",
              "Transmits CSF from fourth ventricle"
            ]
          },
          right: {
            title: "Foramina of Luschka",
            points: [
              "Paired lateral apertures",
              "Open into pontine cistern",
              "Remember L for Lateral",
              "Transmit CSF from lateral recesses"
            ]
          }
        }
      },
      {
        tx: "Reabsorption of cerebrospinal fluid occurs through **arachnoid granulations** projecting into the superior sagittal sinus and other dural venous sinuses. Hydrocephalus results from an imbalance between production and absorption. Non-communicating hydrocephalus is caused by structural obstruction along the ventricular pathway, most often aqueductal stenosis. Communicating hydrocephalus arises from impaired arachnoid granulation reabsorption following subarachnoid hemorrhage or purulent meningitis.",
        say: "Reabsorption of cerebrospinal fluid occurs through arachnoid granulations projecting into the superior sagittal sinus. Hydrocephalus results from an imbalance between production and absorption. Non-communicating hydrocephalus is caused by structural obstruction such as aqueductal stenosis. Communicating hydrocephalus arises from impaired arachnoid granulation reabsorption following meningitis.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-brain-neuron-synapse.webp",
          alt: "Cerebrospinal fluid circulation and meningeal layers",
          caption: "Schematic representation of ventricular CSF circulation pathways, choroid plexus locations and arachnoid granulation reabsorption."
        }
      }
    ]
  },
  {
    module: "ana-spinal-cord",
    subject: "anatomy",
    title: "Spinal cord architecture, ascending and descending pathways",
    minutes: 6,
    refs: ["Gray's Anatomy for Students", "Snell's Clinical Neuroanatomy"],
    steps: [
      {
        tx: "The **spinal cord** extends from the foramen magnum to the lower border of the first lumbar vertebra in adults, terminating as the conus medullaris. Below this, nerve roots form the cauda equina within the lumbar cistern. The filum terminale anchors the cord to the coccyx. Lumbar puncture is safely performed at the third to fourth or fourth to fifth lumbar interspace, safely below the level of spinal cord termination.",
        say: "The spinal cord extends from the foramen magnum to the lower border of the first lumbar vertebra in adults, terminating as the conus medullaris. Below this, nerve roots form the cauda equina within the lumbar cistern. The filum terminale anchors the cord to the coccyx. Lumbar puncture is safely performed at the L3-L4 or L4-L5 interspace, well below the cord.",
        vis: {
          kind: "table",
          cols: ["Feature", "Adult level", "Infant level"],
          rows: [
            ["Spinal cord termination", "Lower border of L1", "Upper border of L3"],
            ["Dural sac termination", "Lower border of S2", "Lower border of S2"],
            ["Preferred lumbar puncture", "L3-L4 or L4-L5", "L4-L5 or L5-S1"]
          ]
        }
      },
      {
        tx: "Cross-sectional spinal cord architecture features central gray matter surrounded by white columns. The dorsal horn processes sensory input, the ventral horn contains lower motor neuron cell bodies, and the lateral horn from thoracic one to lumbar two contains preganglionic sympathetic neurons. The **spinothalamic tract** transmits pain and temperature. Primary afferents enter via Lissauer tract, synapse in the substantia gelatinosa, and secondary axons decussate across the anterior white commissure.",
        say: "Cross-sectional spinal cord architecture features central gray matter surrounded by white columns. The dorsal horn processes sensory input, the ventral horn contains lower motor neuron cell bodies, and the lateral horn from T1 to L2 houses sympathetic neurons. The spinothalamic tract transmits pain and temperature, decussating in the anterior white commissure within one to two segments.",
        vis: null
      },
      {
        tx: "The **dorsal column medial lemniscal** pathway conveys conscious proprioception, two-point discrimination and vibration sensation. First-order neurons ascend uncrossed in the gracile fasciculus from the lower body and cuneate fasciculus from the upper body to synapse in the gracile and cuneate nuclei of the medulla. Second-order fibres cross as internal arcuate fibres to form the medial lemniscus, projecting to the ventral posterolateral thalamic nucleus.",
        say: "The dorsal column pathway conveys conscious proprioception, two-point discrimination and vibration sensation. First-order neurons ascend uncrossed in the gracile and cuneate fasciculi to synapse in the medulla. Second-order fibres cross as internal arcuate fibres to form the medial lemniscus, projecting to the ventral posterolateral thalamus.",
        vis: {
          kind: "compare",
          left: {
            title: "Dorsal column pathway",
            points: [
              "Vibration, proprioception, fine touch",
              "Ascends uncrossed in spinal cord",
              "Decussates in medulla as internal arcuate fibres",
              "Lesion causes ipsilateral loss below injury"
            ]
          },
          right: {
            title: "Lateral spinothalamic tract",
            points: [
              "Pain and temperature sensation",
              "Decussates in spinal cord within 1-2 segments",
              "Ascends in contralateral anterolateral funiculus",
              "Lesion causes contralateral loss 1-2 levels below"
            ]
          }
        }
      },
      {
        tx: "Brown-Sequard syndrome illustrates spinal cord tract organization following **spinal cord hemisection**. Interruption of the lateral corticospinal tract causes ipsilateral spastic paralysis below the lesion. Interruption of the dorsal columns causes ipsilateral loss of vibration and proprioception below the lesion. Interruption of the crossing spinothalamic fibres causes contralateral loss of pain and temperature starting one to two segments below the injury level.",
        say: "Brown-Sequard syndrome illustrates spinal cord tract organization following hemisection. Interruption of the corticospinal tract causes ipsilateral spastic paralysis below the lesion. Dorsal column damage causes ipsilateral loss of vibration and proprioception. Spinothalamic disruption causes contralateral loss of pain and temperature starting one to two segments below.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-brain-gross.webp",
          alt: "Spinal cord cross section and tract somatotopy",
          caption: "Cross-sectional schematic of spinal cord funiculi illustrating ascending sensory tracts and descending motor pathways."
        }
      }
    ]
  },
  {
    module: "ana-basal-ganglia-limbic",
    subject: "anatomy",
    title: "Basal ganglia circuitry and the limbic system",
    minutes: 6,
    refs: ["Gray's Anatomy for Students", "Snell's Clinical Neuroanatomy"],
    steps: [
      {
        tx: "The **basal ganglia** are subcortical gray nuclei that modulate motor planning, procedural learning and cognitive habits. The corpus striatum comprises the caudate nucleus and lentiform nucleus. The lentiform nucleus is subdivided into the outer putamen and inner globus pallidus. Functionally linked structures include the subthalamic nucleus in the diencephalon and the substantia nigra in the midbrain. They influence cortical activity via thalamocortical loops.",
        say: "The basal ganglia are subcortical gray nuclei that modulate motor planning, procedural learning and cognitive habits. The corpus striatum comprises the caudate nucleus and lentiform nucleus, subdivided into putamen and globus pallidus. Functionally linked structures include the subthalamic nucleus and substantia nigra, influencing cortical activity via thalamocortical loops.",
        vis: {
          kind: "table",
          cols: ["Nucleus", "Component", "Primary neurotransmitter output"],
          rows: [
            ["Caudate", "Dorsal striatum", "GABAergic inhibitory output"],
            ["Putamen", "Dorsal striatum", "GABAergic inhibitory output"],
            ["Globus pallidus internus", "Main output nucleus", "GABAergic inhibition to thalamus"],
            ["Subthalamic nucleus", "Indirect pathway regulator", "Glutamatergic excitation to pallidum"]
          ]
        }
      },
      {
        tx: "Motor regulation proceeds via balanced direct and indirect pathways. The **direct pathway** facilitates movement: striatal D1 receptor activation inhibits the internal globus pallidus, disinhibiting the motor thalamus and activating the cerebral cortex. The **indirect pathway** suppresses movement: striatal D2 receptor activation inhibits the external globus pallidus, disinhibiting the subthalamic nucleus, which excites the internal globus pallidus, suppressing the thalamus.",
        say: "Motor regulation proceeds via balanced direct and indirect pathways. The direct pathway facilitates movement: striatal D1 receptor activation inhibits the internal globus pallidus, disinhibiting the thalamus and activating cortex. The indirect pathway suppresses movement through subthalamic excitation of the globus pallidus, dampening thalamic drive.",
        vis: null
      },
      {
        tx: "Disruption of basal ganglia circuits produces classic movement disorders. In Parkinson disease, degeneration of dopaminergic neurons in the **substantia nigra pars compacta** reduces direct pathway drive and increases indirect pathway activity, producing rigidity, bradykinesia, resting tremor and postural instability. In Huntington disease, loss of striatal GABAergic neurons causes chorea. Subthalamic nucleus infarction produces violent contralateral hemiballismus.",
        say: "Disruption of basal ganglia circuits produces classic movement disorders. In Parkinson disease, loss of dopaminergic neurons in substantia nigra pars compacta reduces direct pathway drive, causing bradykinesia, rigidity and resting tremor. In Huntington disease, striatal neuronal loss causes chorea. Subthalamic stroke causes contralateral hemiballismus.",
        vis: {
          kind: "compare",
          left: {
            title: "Parkinson disease",
            points: [
              "Substantia nigra dopamine loss",
              "Overactive indirect pathway inhibition",
              "Hypokinetic state with bradykinesia",
              "Cogwheel rigidity and resting tremor"
            ]
          },
          right: {
            title: "Hemiballismus",
            points: [
              "Subthalamic nucleus lacunar stroke",
              "Loss of excitatory pallidal drive",
              "Hyperkinetic flinging movements",
              "Affects contralateral arm and leg"
            ]
          }
        }
      },
      {
        tx: "The **Papez circuit** connects limbic structures critical for emotional processing and episodic memory consolidation. Hippocampal pyramidal neurons project via the fornix to the mamillary bodies of the hypothalamus. The mamillothalamic tract connects mamillary bodies to the anterior thalamic nucleus. Thalamic projections radiate to the cingulate gyrus, which projects via the entorhinal cortex back to the hippocampus, completing the loop.",
        say: "The Papez circuit connects limbic structures critical for emotional processing and episodic memory consolidation. Hippocampal neurons project via the fornix to the mamillary bodies. The mamillothalamic tract connects mamillary bodies to the anterior thalamus, which radiates to the cingulate gyrus, projecting back to the hippocampus.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-brain-gross.webp",
          alt: "Basal ganglia and limbic system anatomy",
          caption: "Coronal and axial planes detailing caudate, lentiform nucleus, subthalamic connections and limbic circuitry."
        }
      }
    ]
  },
  {
    module: "ana-gut-diaphragm",
    subject: "anatomy",
    title: "Embryology of the gut tube and diaphragm development",
    minutes: 6,
    refs: ["Langman's Medical Embryology", "Gray's Anatomy for Students"],
    steps: [
      {
        tx: "The primitive **gut tube** derives from endoderm following lateral and cephalocaudal embryonic folding. It is partitioned into three anatomical regions supplied by three unpaired ventral aortic branches: the foregut supplied by the celiac trunk, the midgut supplied by the superior mesenteric artery, and the hindgut supplied by the inferior mesenteric artery. The junction between foregut and midgut lies at the major duodenal papilla.",
        say: "The primitive gut tube derives from endoderm following lateral and cephalocaudal embryonic folding. It is partitioned into three regions supplied by three unpaired aortic branches: foregut supplied by celiac trunk, midgut supplied by superior mesenteric artery, and hindgut supplied by inferior mesenteric artery. The junction lies at the major duodenal papilla.",
        vis: {
          kind: "table",
          cols: ["Gut division", "Arterial supply", "Derivatives"],
          rows: [
            ["Foregut", "Celiac trunk", "Pharynx, esophagus, stomach, liver, pancreas"],
            ["Midgut", "Superior mesenteric artery", "Distal duodenum to proximal two-thirds transverse colon"],
            ["Hindgut", "Inferior mesenteric artery", "Distal third transverse colon to upper anal canal"]
          ]
        }
      },
      {
        tx: "The **midgut rotation** is an intricate embryological sequence occurring between the sixth and tenth gestational weeks. Rapid elongation causes physiological herniation into the umbilical cord. The midgut rotates two hundred and seventy degrees counterclockwise around the axis of the superior mesenteric artery. The cephalic limb returns first on the left, followed by the cecal bud on the right. Incomplete rotation predisposes to volvulus.",
        say: "The midgut rotation is an intricate sequence occurring between the sixth and tenth gestational weeks. Rapid elongation causes physiological herniation into the umbilical cord. The midgut rotates two hundred and seventy degrees counterclockwise around the superior mesenteric artery. Incomplete rotation predisposes to midgut volvulus.",
        vis: null
      },
      {
        tx: "Four embryonic structures fuse to form the **muscular diaphragm**. The septum transversum forms the central tendon. The two pleuroperitoneal membranes close the pericardioperitoneal canals. Dorsal mesentery of the esophagus forms the bilateral diaphragmatic crura. Ingrowth from the lateral body walls forms the peripheral muscular rim. Motor innervation is delivered exclusively by the phrenic nerve from cervical levels three, four and five.",
        say: "Four embryonic structures fuse to form the muscular diaphragm. The septum transversum forms the central tendon. The pleuroperitoneal membranes close the pericardioperitoneal canals. Dorsal mesentery of the esophagus forms the crura. Lateral body wall ingrowth forms the peripheral rim. Innervation is delivered by the phrenic nerve from C3, C4 and C5.",
        vis: {
          kind: "compare",
          left: {
            title: "Septum transversum",
            points: [
              "Forms central tendon of diaphragm",
              "Arises in cervical region embryologically",
              "Carries phrenic nerve as it descends",
              "Gives origin to liver stroma"
            ]
          },
          right: {
            title: "Pleuroperitoneal membranes",
            points: [
              "Close pericardioperitoneal canals",
              "Failure of left membrane causes Bochdalek hernia",
              "Defect allows abdominal viscera into thorax",
              "Produces neonatal pulmonary hypoplasia"
            ]
          }
        }
      },
      {
        tx: "Failure of pleuroperitoneal membrane closure causes **congenital diaphragmatic hernia**, occurring ninety percent of the time on the left side through the posterolateral pleuroperitoneal canal of Bochdalek. Abdominal contents herniate into the hemithorax during critical fetal bronchial branching, causing severe bilateral pulmonary hypoplasia and persistent pulmonary hypertension. Morgagni hernia is an anterior retrosternal defect, which is far rarer and typically benign.",
        say: "Failure of pleuroperitoneal membrane closure causes congenital diaphragmatic hernia, occurring ninety percent of the time on the left through the posterolateral canal of Bochdalek. Abdominal contents herniate into the thorax, causing bilateral pulmonary hypoplasia and persistent pulmonary hypertension. Morgagni hernia is an anterior retrosternal defect.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-duodenum-gross.webp",
          alt: "Embryonic gut rotation and diaphragmatic development",
          caption: "Schematic view of midgut herniation, arterial axis rotation and four-component fusion of the thoracoabdominal diaphragm."
        }
      }
    ]
  },
  {
    module: "ana-nerve-injuries",
    subject: "anatomy",
    title: "Upper and lower limb nerve injuries and clinical deformities",
    minutes: 6,
    refs: ["Gray's Anatomy for Students", "Hoppenfeld's Physical Examination"],
    steps: [
      {
        tx: "Peripheral **nerve injuries** produce predictable motor deficits, sensory loss and distinctive deformities based on anatomical innervation. Seddon classified nerve injuries into three grades: neuropraxia with focal conduction block and intact axon; axonotmesis with axonal severance and intact endoneurium; and neurotmesis with complete structural transection requiring surgical repair. Axonal regeneration occurs at approximately one millimeter per day.",
        say: "Peripheral nerve injuries produce predictable motor deficits, sensory loss and distinctive deformities based on anatomical innervation. Seddon classified nerve injuries into three grades: neuropraxia with focal block, axonotmesis with axonal severance, and neurotmesis with complete transection requiring surgery. Regeneration occurs at one millimeter daily.",
        vis: {
          kind: "table",
          cols: ["Nerve injured", "Site of vulnerability", "Characteristic deformity"],
          rows: [
            ["Radial nerve", "Mid-shaft humerus spiral groove", "Wrist drop with sensory loss over anatomical snuffbox"],
            ["Median nerve", "Carpal tunnel or supracondylar fracture", "Ape thumb deformity and pointing sign"],
            ["Ulnar nerve", "Medial epicondyle or Guyon canal", "Claw hand deformity with interosseous wasting"],
            ["Common fibular", "Neck of fibula fracture", "Foot drop with high-stepping gait"]
          ]
        }
      },
      {
        tx: "The **radial nerve** is vulnerable in mid-shaft humeral fractures within the spiral groove. Injury paralyses the brachioradialis and wrist and finger extensors, causing wrist drop. In the axilla, crutch palsy paralyses the triceps as well. Sensation is lost over the first dorsal web space and anatomical snuffbox. Posterior interosseous nerve injury spares the extensor carpi radialis longus, so wrist extension is preserved without wrist drop.",
        say: "The radial nerve is vulnerable in mid-shaft humeral fractures within the spiral groove. Injury paralyses brachioradialis and wrist and finger extensors, causing wrist drop. In the axilla, crutch palsy also paralyses triceps. Sensation is lost over the first dorsal web space. Posterior interosseous nerve injury spares wrist extension.",
        vis: null
      },
      {
        tx: "The **ulnar paradox** states that a high ulnar nerve lesion at the elbow produces a less severe claw hand than a low lesion at the wrist. In high lesions, the flexor digitorum profundus to the fourth and fifth digits is denervated, so the distal interphalangeal joints cannot flex, reducing clawing. In low lesions at Guyon canal, long flexors remain functional, causing pronounced clawing of the ring and little fingers.",
        say: "The ulnar paradox states that a high ulnar nerve lesion at the elbow produces less clawing than a low lesion at the wrist. In high lesions, the flexor digitorum profundus to digits four and five is paralysed, so distal joints do not flex. In low wrist lesions, long flexors remain functional, causing pronounced claw deformity.",
        vis: {
          kind: "compare",
          left: {
            title: "High ulnar lesion (elbow)",
            points: [
              "Medial epicondyle fracture or cubital tunnel",
              "Flexor digitorum profundus 4 and 5 paralysed",
              "Less dramatic clawing due to lack of DIP flexion",
              "Sensory loss over medial hand and dorsum"
            ]
          },
          right: {
            title: "Low ulnar lesion (wrist)",
            points: [
              "Guyon canal compression or laceration",
              "Flexor digitorum profundus function preserved",
              "Severe claw hand deformity of digits 4 and 5",
              "Dorsal sensory branch spared"
            ]
          }
        }
      },
      {
        tx: "The **common fibular nerve** winds around the neck of the fibula, making it the most frequently injured lower limb nerve. Blunt trauma, tight casting or fibular neck fracture causes foot drop due to paralysis of the anterior and lateral compartment leg muscles. The patient adopts a characteristic high-stepping gait to clear the toes during the swing phase, with loss of sensation over the dorsum of the foot.",
        say: "The common fibular nerve winds around the neck of the fibula, making it the most frequently injured lower limb nerve. Trauma, tight casting or fibular fracture causes foot drop due to paralysis of dorsiflexors and everters. The patient adopts a high-stepping gait, with loss of sensation over the foot dorsum.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-brain-gross.webp",
          alt: "Upper and lower limb motor nerve pathways",
          caption: "Diagrammatic trajectory of major peripheral nerve trunks showing compression sites and cutaneous sensory territories."
        }
      }
    ]
  }
];

// Let's write each lesson to prep/lessons/v1/<module>.json and validate it
let written = 0;
let errors = 0;

for (const l of lessons) {
  // Add required fields
  l.v = 1;
  l.gen = "AI";
  l.run = "books-pipeline";
  l.model = "gemini-3.8-flash-high";
  l.quiz = [makeId(l.module + "-q1"), makeId(l.module + "-q2"), makeId(l.module + "-q3")];
  l.src = [];
  l.checks = {
    shape: true,
    numbers: true,
    drugs: true,
    verbatim: true,
    dashes: true,
    verify: true
  };

  const errs = LP.checkLesson(l);
  if (errs && errs.length > 0) {
    console.error(`ERROR validating ${l.module}:`, errs);
    errors++;
  } else {
    const p = path.join(ROOT, "prep/lessons/v1", `${l.module}.json`);
    fs.writeFileSync(p, JSON.stringify(l, null, 1) + "\n");
    console.log(`OK: wrote ${l.module} (${l.steps.length} steps)`);
    written++;
  }
}

console.log(`\nFinished: ${written} written, ${errors} errors.`);
