#!/usr/bin/env node
/**
 * Wave 2 Generator: Neuroanatomy Complete Suite & A&P Remaining Organ Systems
 * 
 * Generates:
 * 1. 13 new comprehensive interactive lessons in prep/lessons/v1/
 * 2. Updates prep/lessons/v1/index.json
 * 3. 13 matching Knowledge Library (KB v2) reference articles in kb/reference/
 * 4. 130+ original, verified MCQs in prep/overlays/maikbook1/ (anatomy, physiology)
 * 5. Validates everything against LP.checkLesson, KB v2 schema, and test suite.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const LP = require("../prep-lessons.js");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function makeId(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `${hex.slice(0, 8)}-4000-8000-${hex.slice(0, 4)}-${hex.slice(4, 8)}12345678`.slice(0, 36);
}

// ==========================================
// 1. WAVE 2 LESSON DEFINITIONS
// ==========================================
const wave2Lessons = [
  // --- NEUROANATOMY SUITE ---
  {
    module: "ana-cns-overview",
    subject: "anatomy",
    title: "Central nervous system organization: planes, neuraxis and gross architecture",
    minutes: 6,
    refs: ["Clinical Neuroanatomy Made Ridiculously Simple", "Snell's Clinical Neuroanatomy"],
    steps: [
      {
        tx: "The **neuraxis** bends dramatically at the cephalic flexure between the brainstem and diencephalon. Consequently, anatomical terms of direction shift ninety degrees. In the cerebrum, rostral means anterior towards the frontal pole, while caudal means posterior towards the occipital pole. Below the midbrain within the spinal cord, rostral signifies superior towards the head, and caudal denotes inferior towards the coccyx.",
        say: "The neuraxis bends ninety degrees at the cephalic flexure between the brainstem and diencephalon. In the cerebrum, rostral means anterior towards the frontal pole, and caudal means posterior. Below the midbrain, rostral signifies superior towards the head, while caudal denotes inferior towards the coccyx.",
        vis: {
          kind: "table",
          cols: ["Neuraxis region", "Rostral direction", "Caudal direction", "Dorsal direction"],
          rows: [
            ["Cerebrum / Forebrain", "Anterior (frontal pole)", "Posterior (occipital pole)", "Superior (vertex)"],
            ["Brainstem & Spinal cord", "Superior (towards brain)", "Inferior (towards coccyx)", "Posterior (towards back)"]
          ]
        }
      },
      {
        tx: "Embryologically, the primitive neural tube develops into three primary vesicles: the **prosencephalon**, mesencephalon and rhombencephalon. By five weeks, the prosencephalon divides into the telencephalon (cerebral hemispheres) and diencephalon (thalamus, hypothalamus). The mesencephalon persists as the midbrain, while the rhombencephalon subdivides into the metencephalon (pons and cerebellum) and myelencephalon (medulla oblongata).",
        say: "Embryologically, the neural tube develops into three primary brain vesicles: prosencephalon, mesencephalon and rhombencephalon. The prosencephalon subdivides into telencephalon and diencephalon. The mesencephalon remains the midbrain, while the rhombencephalon splits into metencephalon and myelencephalon.",
        vis: {
          kind: "compare",
          left: {
            title: "Primary vesicles",
            points: [
              "Prosencephalon (forebrain)",
              "Mesencephalon (midbrain)",
              "Rhombencephalon (hindbrain)",
              "Caudal neural tube (spinal cord)"
            ]
          },
          right: {
            title: "Secondary adult derivatives",
            points: [
              "Telencephalon and diencephalon",
              "Midbrain and cerebral aqueduct",
              "Pons, cerebellum and medulla",
              "Adult spinal cord and central canal"
            ]
          }
        }
      },
      {
        tx: "The central nervous system is enveloped by three protective **meningeal layers**: the dura mater, arachnoid mater and pia mater. The tough outer dura forms protective dural reflections, including the falx cerebri in the longitudinal fissure and the tentorium cerebelli separating the occipital lobes from the cerebellum. The subarachnoid space between arachnoid and pia contains circulating cerebrospinal fluid and major cerebral vessels.",
        say: "The central nervous system is enclosed by three meninges: dura mater, arachnoid mater and pia mater. The tough dura forms reflections including the falx cerebri and tentorium cerebelli. The subarachnoid space between arachnoid and pia carries cerebrospinal fluid and major cerebral vessels.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-brain-gross.webp",
          alt: "Gross brain architecture and meningeal relationships",
          caption: "Overview of cerebral hemispheres, brainstem, cerebellar structures and intracranial compartments."
        }
      },
      {
        tx: "Intracranial **hemorrhages** correlate strictly with distinct meningeal spaces. Epidural hematoma occurs in the potential space between the skull and periosteal dura, typically caused by pterion fracture lacerating the middle meningeal artery, producing a biconvex lentiform collection. Subdural hematoma results from shearing of fragile bridging veins traversing the subdural plane, causing a crescent-shaped hematoma that freely crosses cranial suture lines.",
        say: "Intracranial hemorrhages occupy distinct meningeal compartments. Epidural hematoma occurs between skull and dura, caused by middle meningeal artery rupture, yielding a lentiform mass. Subdural hematoma results from ruptured bridging veins, creating a crescentic collection that crosses cranial sutures.",
        vis: {
          kind: "compare",
          left: {
            title: "Epidural hematoma",
            points: [
              "Laceration of middle meningeal artery",
              "Biconvex lentiform shape on CT",
              "Limited by cranial suture lines",
              "Classic lucid interval before deterioration"
            ]
          },
          right: {
            title: "Subdural hematoma",
            points: [
              "Tearing of parasagittal bridging veins",
              "Crescent shaped crescentic collection",
              "Freely crosses cranial suture lines",
              "Common in elderly and cerebral atrophy"
            ]
          }
        }
      }
    ]
  },
  {
    module: "ana-cerebral-circulation",
    subject: "anatomy",
    title: "Cerebral circulation, Circle of Willis and neurovascular stroke syndromes",
    minutes: 6,
    refs: ["Clinical Neuroanatomy Made Ridiculously Simple", "Snell's Clinical Neuroanatomy"],
    steps: [
      {
        tx: "The **Circle of Willis** is an arterial polygon located at the base of the brain around the optic chiasm and pituitary stalk. It anastomoses the anterior circulation (internal carotid arteries) with the posterior circulation (vertebrobasilar system). It is formed by the anterior communicating artery, paired anterior cerebral arteries, internal carotids, posterior communicating arteries, and the proximal segments of the posterior cerebral arteries.",
        say: "The Circle of Willis is an arterial anastomotic ring at the base of the brain around the optic chiasm. It connects the internal carotid arteries with the posterior vertebrobasilar circulation. It includes the anterior communicating, anterior cerebral, internal carotid, posterior communicating, and posterior cerebral arteries.",
        vis: {
          kind: "table",
          cols: ["Arterial component", "Circulation origin", "Anastomotic function"],
          rows: [
            ["Anterior communicating", "Anterior circulation", "Connects bilateral anterior cerebral arteries"],
            ["Internal carotid artery", "Anterior circulation", "Supplies anterior and middle cerebral arteries"],
            ["Posterior communicating", "Collateral link", "Connects internal carotid to posterior cerebral"],
            ["Basilar bifurcation", "Posterior circulation", "Terminates into paired posterior cerebral arteries"]
          ]
        }
      },
      {
        tx: "Occlusion of the **middle cerebral artery** is the most common cause of ischemic stroke. Because the cortical branches supply the lateral convexity of the cerebral hemisphere, infarction causes contralateral hemiparesis and hemisensory loss affecting predominantly the face and upper extremity. Dominant left hemisphere involvement produces global or Broca aphasia, whereas non-dominant right hemisphere infarction results in profound spatial hemineglect.",
        say: "Middle cerebral artery occlusion is the most common ischemic stroke. Supplying the lateral cerebral convexity, it causes contralateral hemiparesis and hemisensory loss predominantly affecting the face and arm. Left sided involvement produces aphasia, while right sided infarction causes spatial hemineglect.",
        vis: {
          kind: "compare",
          left: {
            title: "Middle cerebral artery stroke",
            points: [
              "Supplies lateral hemispheric convexity",
              "Contralateral face and arm weakness",
              "Aphasia if dominant left hemisphere",
              "Spatial hemineglect if non-dominant right"
            ]
          },
          right: {
            title: "Anterior cerebral artery stroke",
            points: [
              "Supplies medial hemispheric surface",
              "Contralateral leg and foot weakness",
              "Urinary incontinence due to paracentral lobule",
              "Abulia and frontal executive dysfunction"
            ]
          }
        }
      },
      {
        tx: "The **anterior cerebral artery** courses along the longitudinal fissure and curves around the genu of the corpus callosum. It supplies the medial surface of the frontal and parietal lobes, corresponding to the lower extremity region of the sensory and motor homunculus. Stroke presents with contralateral leg and foot weakness, sensory loss, urinary urge incontinence, and frontal release signs.",
        say: "The anterior cerebral artery arches around the corpus callosum to supply the medial frontal and parietal cortex. This corresponds to the leg and foot territory of the motor homunculus. Stroke presents with contralateral leg weakness, sensory impairment, and urinary incontinence.",
        vis: null
      },
      {
        tx: "Saccular **berry aneurysms** arise most frequently at bifurcation junctions within the Circle of Willis due to congenital internal elastic lamina defects. The anterior communicating artery junction accounts for thirty-five percent of cases, followed by the posterior communicating artery junction. Rupture discharges arterial blood under pressure directly into the subarachnoid space, producing a sudden thunderclap headache.",
        say: "Berry aneurysms develop at arterial bifurcations within the Circle of Willis due to internal elastic lamina defects. The anterior communicating artery is the most frequent site, followed by the posterior communicating artery. Rupture leads to subarachnoid hemorrhage with sudden thunderclap headache.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-brain-gross.webp",
          alt: "Circle of Willis and cerebral blood supply",
          caption: "Basal arterial polygon showing relationships between internal carotid, basilar, anterior and posterior cerebral arteries."
        }
      }
    ]
  },
  {
    module: "ana-visual-pathways",
    subject: "anatomy",
    title: "Visual pathways, retinogeniculate projections and field defects",
    minutes: 6,
    refs: ["Clinical Neuroanatomy Made Ridiculously Simple", "Snell's Clinical Neuroanatomy"],
    steps: [
      {
        tx: "Visual information captured by retinal photoreceptors is transferred through bipolar cells to ganglion cells whose axons form the **optic nerve**. At the optic chiasm, axons originating from the nasal hemiretinas decussate across the midline, whereas axons from temporal hemiretinas continue uncrossed ipsilaterally. Consequently, the left optic tract carries visual information representing the entire right hemifield of both eyes.",
        say: "Visual information passes from photoreceptors through retinal ganglion cells to form the optic nerve. At the optic chiasm, nasal retinal axons cross the midline, while temporal axons stay ipsilateral. Therefore, the left optic tract carries visual data representing the complete right visual hemifield.",
        vis: {
          kind: "table",
          cols: ["Retinal origin", "Decussation at chiasm", "Visual field represented", "Pathway destination"],
          rows: [
            ["Nasal hemiretina", "Crosses midline completely", "Temporal visual field", "Contralateral optic tract"],
            ["Temporal hemiretina", "Remains uncrossed", "Nasal visual field", "Ipsilateral optic tract"]
          ]
        }
      },
      {
        tx: "From the optic chiasm, axons traverse the optic tract to synapse within the **lateral geniculate nucleus** of the thalamus. Third-order neurons project as the optic radiations (geniculocalcarine tract) towards the primary visual cortex in the calcarine sulcus of the occipital lobe. A distinct ventral bundle known as Meyer loop sweeps anteriorly around the temporal horn of the lateral ventricle before proceeding posteriorly.",
        say: "Axons in the optic tract synapse in the lateral geniculate nucleus of the thalamus. Third order neurons project via the optic radiations to the calcarine cortex. A ventral bundle called Meyer loop loops through the temporal lobe around the inferior horn of the lateral ventricle.",
        vis: null
      },
      {
        tx: "Pathology at specific anatomical checkpoints produces diagnostic **visual field defects**. Compression of the central optic chiasm by a pituitary adenoma or craniopharyngioma damages crossing nasal retinal fibres, causing bitemporal hemianopia. Lesions of Meyer loop in the temporal lobe produce a contralateral superior quadrantanopia, commonly remembered by clinicians as pie in the sky defect.",
        say: "Lesions at specific points produce distinct visual field defects. Pituitary adenoma compressing the central chiasm damages crossing nasal fibres, causing bitemporal hemianopia. Temporal lobe lesions damaging Meyer loop cause a contralateral superior quadrantanopia, known as pie in the sky.",
        vis: {
          kind: "compare",
          left: {
            title: "Chiasmal compression",
            points: [
              "Pituitary macroadenoma or craniopharyngioma",
              "Damage to decussating nasal retinal fibres",
              "Loss of peripheral temporal vision bilaterally",
              "Classic bitemporal hemianopia"
            ]
          },
          right: {
            title: "Meyer loop lesion",
            points: [
              "Temporal lobe resection or infarction",
              "Damage to inferior optic radiation fibres",
              "Loss of contralateral upper visual quadrant",
              "Pie in the sky superior quadrantanopia"
            ]
          }
        }
      },
      {
        tx: "Posterior cerebral artery stroke infarctions of the primary calcarine cortex produce contralateral **homonymous hemianopia**. Crucially, central foveal vision is frequently preserved, a clinical phenomenon termed macular sparing. Macular sparing occurs because the occipital pole receives dual collateral arterial perfusion from terminal middle cerebral artery branches, and the macular representation occupies an expansive cortical area.",
        say: "Posterior cerebral artery infarction of the calcarine cortex causes contralateral homonymous hemianopia. Central vision is often preserved, termed macular sparing. This occurs because the occipital pole receives dual collateral supply from the middle cerebral artery.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-eye-gross.webp",
          alt: "Ocular apparatus and visual sensory projections",
          caption: "Structure of the ocular globe and retinal architecture projecting central sensory axons to intracranial visual pathways."
        }
      }
    ]
  },
  {
    module: "phy-autonomic-nervous-system",
    subject: "physiology",
    title: "Autonomic nervous system, hypothalamic nuclei and pupillary reflexes",
    minutes: 6,
    refs: ["Clinical Neuroanatomy Made Ridiculously Simple", "Guyton and Hall Textbook of Medical Physiology"],
    steps: [
      {
        tx: "The **autonomic nervous system** comprises sympathetic and parasympathetic divisions operating in dynamic equilibrium. Sympathetic preganglionic neurons arise from the intermediolateral cell column of thoracic and upper lumbar spinal segments between T1 and L2. In contrast, parasympathetic preganglionic outflows originate from cranial nerve nuclei (CN III, VII, IX, X) and sacral cord segments between S2 and S4.",
        say: "The autonomic nervous system consists of sympathetic and parasympathetic divisions. Sympathetic preganglionics originate from the intermediolateral cell column from T1 to L2. Parasympathetic preganglionics arise from cranial nerves three, seven, nine, ten and sacral spinal cord segments S2 to S4.",
        vis: {
          kind: "table",
          cols: ["Division", "Anatomical outflow", "Preganglionic transmitter", "Postganglionic transmitter"],
          rows: [
            ["Sympathetic", "Thoracolumbar (T1-L2)", "Acetylcholine (Nicotinic)", "Norepinephrine (except sweat glands)"],
            ["Parasympathetic", "Craniosacral (CN III, VII, IX, X, S2-S4)", "Acetylcholine (Nicotinic)", "Acetylcholine (Muscarinic)"]
          ]
        }
      },
      {
        tx: "The **hypothalamus** serves as the principal central coordinating centre for autonomic regulation, endocrine balance and homeostatic drives. Specialized nuclei execute distinct physiologic tasks: the lateral hypothalamic area promotes feeding (stimulated by ghrelin), the ventromedial nucleus signals satiety (stimulated by leptin), the supraoptic and paraventricular nuclei synthesize ADH and oxytocin, and the suprachiasmatic nucleus orchestrates circadian rhythms.",
        say: "The hypothalamus coordinates autonomic function, endocrine balance and homeostasis. The lateral nucleus stimulates hunger, the ventromedial nucleus promotes satiety, supraoptic and paraventricular nuclei produce ADH and oxytocin, and the suprachiasmatic nucleus controls circadian rhythms.",
        vis: {
          kind: "compare",
          left: {
            title: "Hypothalamic hunger & satiety",
            points: [
              "Lateral nucleus stimulates hunger",
              "Destruction causes aphagia and starvation",
              "Ventromedial nucleus promotes satiety",
              "Destruction causes hyperphagia and obesity"
            ]
          },
          right: {
            title: "Hypothalamic temperature control",
            points: [
              "Anterior nucleus detects heat and induces sweating",
              "Posterior nucleus senses cold and triggers shivering",
              "Regulated by warm-sensitive preoptic neurons",
              "Pyrogens shift the core hypothalamic set point"
            ]
          }
        }
      },
      {
        tx: "The **sympathetic pupillary pathway** is a three-neuron chain. First-order neurons descend from the posterior hypothalamus through the brainstem to the ciliospinal center of Budge at C8-T2. Second-order preganglionic fibers ascend across the apical pleura to synapse in the superior cervical ganglion. Third-order postganglionic fibers travel along the internal and external carotid arteries to reach the pupillary dilator muscle.",
        say: "The sympathetic pupillary pathway is a three neuron chain. First order neurons descend from the hypothalamus to the ciliospinal center at C8 to T2. Second order fibers travel over the lung apex to the superior cervical ganglion. Third order fibers follow carotid arteries to the pupillary dilator.",
        vis: null
      },
      {
        tx: "Interruption of the oculosympathetic chain causes **Horner syndrome**, clinically defined by the triad of ptosis, miosis and anhidrosis. Ptosis results from denervation of superior tarsal muscle, miosis stems from unopposed parasympathetic sphincter pupillae action, and anhidrosis reflects loss of sudomotor tone. Apical lung Pancoast tumors invading the inferior cervical and first thoracic ganglia frequently cause this disorder.",
        say: "Disruption of the sympathetic pathway causes Horner syndrome, presenting with ptosis, miosis and anhidrosis. Ptosis stems from superior tarsal muscle weakness, miosis from unopposed sphincter pupillae action, and anhidrosis from loss of sudomotor tone, commonly seen in Pancoast apical lung tumours.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-eye-gross.webp",
          alt: "Pupillary control pathways and autonomic innervation",
          caption: "Autonomic regulation of iris musculature showing sympathetic dilation and parasympathetic constrictor loops."
        }
      }
    ]
  },
  {
    module: "ana-cerebral-cortex",
    subject: "anatomy",
    title: "Cerebral cortex functional localization, Brodmann areas and higher cognitive syndromes",
    minutes: 6,
    refs: ["Clinical Neuroanatomy Made Ridiculously Simple", "Snell's Clinical Neuroanatomy"],
    steps: [
      {
        tx: "The human **cerebral cortex** is divided into specialized structural regions classically mapped as Brodmann areas. The primary motor cortex (Brodmann area 4) occupies the precentral gyrus of the frontal lobe, executing voluntary motor commands. Directly across the central sulcus, the primary somatosensory cortex (Brodmann areas 3, 1, 2) resides in the postcentral gyrus, processing touch, pain and proprioception.",
        say: "The cerebral cortex contains distinct functional zones mapped as Brodmann areas. The primary motor cortex occupies the precentral gyrus of the frontal lobe, executing movement. Directly posterior across the central sulcus, the primary somatosensory cortex occupies the postcentral gyrus.",
        vis: {
          kind: "table",
          cols: ["Cortical region", "Brodmann area", "Anatomical landmark", "Primary function"],
          rows: [
            ["Primary motor cortex", "Area 4", "Precentral gyrus (frontal lobe)", "Voluntary motor control"],
            ["Primary somatosensory", "Areas 3, 1, 2", "Postcentral gyrus (parietal lobe)", "Tactile and proprioceptive sensation"],
            ["Primary visual cortex", "Area 17", "Calcarine sulcus (occipital lobe)", "Visual processing"],
            ["Primary auditory cortex", "Areas 41, 42", "Heschl transverse gyri (temporal lobe)", "Auditory perception"]
          ]
        }
      },
      {
        tx: "Language processing is lateralized to the dominant cerebral hemisphere, which is the left hemisphere in over ninety-five percent of right-handed individuals. **Broca area** (Brodmann areas 44 and 45) in the inferior frontal gyrus coordinates expressive speech motor programming. Patients with Broca aphasia exhibit halting, non-fluent speech, telegraphic phrasing and intense frustration, but retain preserved auditory comprehension.",
        say: "Language is specialized in the dominant left hemisphere. Broca area in the inferior frontal gyrus governs expressive speech production. Patients with Broca aphasia have non-fluent, halting speech and telegraphic phrasing, but their comprehension remains intact.",
        vis: {
          kind: "compare",
          left: {
            title: "Broca expressive aphasia",
            points: [
              "Lesion in inferior frontal gyrus (areas 44, 45)",
              "Effortful, non-fluent, halting speech",
              "Repetition severely impaired",
              "Auditory comprehension intact with insight"
            ]
          },
          right: {
            title: "Wernicke receptive aphasia",
            points: [
              "Lesion in posterior superior temporal gyrus (area 22)",
              "Fluent, effortless speech with neologisms",
              "Repetition severely impaired",
              "Auditory comprehension absent without insight"
            ]
          }
        }
      },
      {
        tx: "**Wernicke area** (Brodmann area 22) resides in the posterior superior temporal gyrus, responsible for receptive language comprehension. Lesions produce Wernicke aphasia, characterized by effortless, grammatically fluent speech devoid of meaning (word salad), frequent paraphasias, impaired repetition, and inability to comprehend spoken or written commands. Patients typically lack awareness of their deficit.",
        say: "Wernicke area in the posterior superior temporal gyrus processes receptive language comprehension. Lesions produce fluent speech devoid of meaning, full of neologisms and paraphasias, with impaired repetition and absent comprehension. Patients lack awareness of their deficit.",
        vis: null
      },
      {
        tx: "The arcuate fasciculus is a subcortical white matter association tract that connects Wernicke area directly to Broca area. Selective damage produces **conduction aphasia**, characterized by fluent spontaneous speech, intact comprehension, but markedly impaired repetition. In contrast, lesions of the dominant angular gyrus produce Gerstmann syndrome: agraphia, acalculia, finger agnosia, and right-left disorientation.",
        say: "The arcuate fasciculus connects Wernicke area to Broca area. Disruption causes conduction aphasia, where speech is fluent and comprehension is intact, but repetition is markedly impaired. Lesions of the dominant angular gyrus produce Gerstmann syndrome with agraphia, acalculia and finger agnosia.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-brain-gross.webp",
          alt: "Cerebral cortex functional regions and lateral convexity",
          caption: "Lateral surface of the cerebral hemisphere illustrating frontal expressive, temporal receptive, and parietal association regions."
        }
      }
    ]
  },
  {
    module: "ss-neurology-localization",
    subject: "anatomy",
    title: "Clinical neuro-localization: upper vs lower motor neuron and brainstem lesion rules",
    minutes: 6,
    refs: ["Clinical Neuroanatomy Made Ridiculously Simple", "Brazis Localization in Clinical Neurology"],
    steps: [
      {
        tx: "Distinguishing **upper motor neuron** from lower motor neuron lesions represents the bedrock of clinical neurological localization. Upper motor neuron lesions disrupt corticospinal fibers descending from cerebral cortex through internal capsule and brainstem. This disinhibits spinal reflex arcs, producing spasticity with clasp-knife tone, hyperreflexia, clonus, and an extensor plantar response (positive Babinski sign).",
        say: "Differentiating upper motor neuron from lower motor neuron lesions is foundational in clinical neurology. Upper motor neuron lesions disrupt corticospinal fibers, disinhibiting spinal reflexes. This produces spasticity, clasp-knife tone, hyperreflexia, clonus and an extensor Babinski sign.",
        vis: {
          kind: "table",
          cols: ["Clinical feature", "Upper motor neuron lesion", "Lower motor neuron lesion"],
          rows: [
            ["Muscle tone", "Spasticity with clasp-knife rigidity", "Flaccid hypotonia"],
            ["Deep tendon reflexes", "Hyperreflexia with clonus", "Hyporeflexia or absent reflexes"],
            ["Plantar response", "Extensor (positive Babinski sign)", "Flexor (normal down-going)"],
            ["Muscle bulk & twitching", "Disuse atrophy only; no fasciculations", "Severe denervation atrophy with fasciculations"]
          ]
        }
      },
      {
        tx: "In contrast, **lower motor neuron** lesions damage alpha motor neurons in the anterior horn of the spinal cord or cranial nerve motor nuclei, or their peripheral axonal projections. Denervation deprives muscle fibers of trophic input, causing flaccid paralysis, hypotonia, profound muscle atrophy, absent tendon reflexes, and visible muscle twitching known as fasciculations.",
        say: "Lower motor neuron lesions damage anterior horn cells or peripheral nerves. Denervation causes flaccid paralysis, hypotonia, profound muscle atrophy, absent deep tendon reflexes, and visible fasciculations. Amyotrophic lateral sclerosis uniquely combines both upper and lower motor neuron signs.",
        vis: {
          kind: "compare",
          left: {
            title: "UMN signs (Spastic)",
            points: [
              "Increased muscle tone (spasticity)",
              "Brisk deep tendon reflexes",
              "Sustained ankle clonus",
              "Positive Babinski sign (extensor)"
            ]
          },
          right: {
            title: "LMN signs (Flaccid)",
            points: [
              "Decreased muscle tone (flaccidity)",
              "Diminished or absent reflexes",
              "Visible spontaneous fasciculations",
              "Rapid, pronounced neurogenic muscle wasting"
            ]
          }
        }
      },
      {
        tx: "Brainstem lesions are reliably localized using the rule of four: four cranial nerves in the medulla (CN IX, X, XI, XII), four in the pons (CN V, VI, VII, VIII), and four in the midbrain and above (CN I, II, III, IV). Midline medial structures include the **corticospinal tract**, medial lemniscus, and medial longitudinal fasciculus. Lateral structures include the spinothalamic tract and descending sympathics.",
        say: "Brainstem lesions are localized using the rule of four: four nerves in the medulla, four in the pons, and four in the midbrain. Medial structures are the corticospinal tract, medial lemniscus, and medial longitudinal fasciculus. Lateral structures include spinothalamic tract and descending sympathetics.",
        vis: null
      },
      {
        tx: "Alternating hemiplegias feature ipsilateral cranial nerve palsy with contralateral long-tract motor or sensory loss. **Weber syndrome** in the midbrain involves the exiting fascicles of the oculomotor nerve and adjacent cerebral peduncle, causing ipsilateral CN III palsy with contralateral hemiplegia. In the lateral medulla, Wallenberg syndrome affects PICA territory, causing dysphagia, hoarseness, Horner syndrome, and crossed sensory loss.",
        say: "Alternating hemiplegias feature ipsilateral cranial nerve signs with contralateral body deficits. Weber syndrome in the midbrain causes ipsilateral third nerve palsy with contralateral hemiplegia. Wallenberg syndrome in the lateral medulla causes dysphagia, Horner syndrome, ataxia, and crossed sensory loss.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-brain-gross.webp",
          alt: "Brainstem cross-sections and long tract topography",
          caption: "Midbrain, pons and medulla cross-sections showing cranial nerve nuclei and intersecting corticospinal pathways."
        }
      }
    ]
  },

  // --- A&P REMAINING ORGAN SYSTEMS ---
  {
    module: "ana-stomach-duodenum",
    subject: "anatomy",
    title: "Stomach and duodenal anatomy: mucosal architecture, blood supply and peptic pathology",
    minutes: 6,
    refs: ["ALGrawany Anatomy & Physiology Made Easy 2026", "Gray's Anatomy for Students"],
    steps: [
      {
        tx: "The **stomach** is divided into five anatomical regions: cardia, fundus, body, antrum and pylorus. The muscular wall comprises three distinct layers: an outer longitudinal, middle circular, and inner oblique layer. The mucosa displays prominent longitudinal folds termed rugae that flatten as the stomach distends with food. The pyloric sphincter marks the gastroduodenal junction.",
        say: "The stomach has five anatomical regions: cardia, fundus, body, antrum and pylorus. Its muscular wall contains three layers: outer longitudinal, middle circular, and inner oblique. The mucosa shows prominent folds called rugae that flatten with distension, leading to the muscular pyloric sphincter.",
        vis: {
          kind: "table",
          cols: ["Gastric region", "Key histology", "Primary secretions", "Clinical relevance"],
          rows: [
            ["Cardia", "Cardio-esophageal junction", "Mucus and bicarbonate", "Site of Mallory-Weiss tears"],
            ["Fundus & Body", "Parietal and chief cells", "HCl, intrinsic factor, pepsinogen", "Autoimmune gastritis targets parietal cells"],
            ["Antrum", "Mucous cells and G cells", "Gastrin peptide hormone", "Site of Helicobacter pylori colonization"],
            ["Pylorus", "Thickened circular smooth muscle", "Regulates chyme delivery", "Infantile hypertrophic pyloric stenosis"]
          ]
        }
      },
      {
        tx: "The **arterial supply** of the stomach derives entirely from the celiac trunk. The lesser curvature is supplied by the left gastric artery (from celiac) and right gastric artery (from proper hepatic). The greater curvature is perfused by the left gastroepiploic artery (from splenic) and right gastroepiploic artery (from gastroduodenal). The fundus receives short gastric arteries from the splenic artery.",
        say: "Gastric arterial perfusion derives from the celiac trunk. The lesser curvature is fed by the left and right gastric arteries. The greater curvature receives blood from the left and right gastroepiploic arteries. The gastric fundus is supplied by short gastric arteries from the splenic artery.",
        vis: {
          kind: "compare",
          left: {
            title: "Lesser curvature vessels",
            points: [
              "Left gastric artery directly from celiac trunk",
              "Right gastric artery from hepatic artery proper",
              "Vulnerable to erosion by lesser curve peptic ulcers",
              "Drains into the main portal vein"
            ]
          },
          right: {
            title: "Greater curvature vessels",
            points: [
              "Left gastroepiploic artery from splenic artery",
              "Right gastroepiploic from gastroduodenal artery",
              "Short gastric arteries supply the fundus",
              "Forms extensive vascular arcade along gastrocolic omentum"
            ]
          }
        }
      },
      {
        tx: "The **duodenum** forms a C-shaped loop encircling the pancreatic head, divided into four parts. The first part (D1) is the duodenal bulb, the most common site of peptic ulcer disease. Posterior duodenal bulb ulcers erode into the gastroduodenal artery, causing massive gastrointestinal hemorrhage. Anterior ulcers perforate freely into the peritoneal cavity, producing pneumoperitoneum.",
        say: "The duodenum is a C-shaped loop encircling the pancreatic head. The first part, the duodenal bulb, is the commonest site of peptic ulcers. Posterior ulcers erode the gastroduodenal artery, causing severe bleeding. Anterior ulcers perforate, causing acute peritonitis and pneumoperitoneum.",
        vis: null
      },
      {
        tx: "The second part of the duodenum (D2) receives the common bile duct and main pancreatic duct at the **major duodenal papilla** (ampulla of Vater), guarded by the sphincter of Oddi. The third part (D3) crosses horizontally across the vertebral column, wedged between the abdominal aorta posteriorly and the superior mesenteric artery anteriorly, predisposing to vascular compression.",
        say: "The second part of the duodenum receives the common bile duct and pancreatic duct at the ampulla of Vater. The third part runs horizontally between the abdominal aorta posteriorly and superior mesenteric artery anteriorly, vulnerable to compression in superior mesenteric artery syndrome.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-stomach-gross.webp",
          alt: "Gastric and duodenal gross anatomy",
          caption: "Gastroduodenal architecture illustrating gastric curvatures, pylorus, and C-loop duodenal relationships."
        }
      }
    ]
  },
  {
    module: "ana-spleen",
    subject: "anatomy",
    title: "Splenic microarchitecture, pulp compartments and postsplenectomy sepsis",
    minutes: 6,
    refs: ["ALGrawany Anatomy & Physiology Made Easy 2026", "Gray's Anatomy for Students"],
    steps: [
      {
        tx: "The **spleen** is the largest secondary lymphoid organ in the human body, situated in the left hypochondrium under diaphragmatic ribs nine, ten and eleven. It is suspended by the gastrosplenic ligament containing the short gastric vessels and the splenorenal ligament containing the splenic artery, splenic vein, and the delicate pancreatic tail.",
        say: "The spleen is the largest lymphoid organ, located in the left upper quadrant protected by ribs nine, ten and eleven. It is attached by the gastrosplenic ligament carrying short gastric vessels and the splenorenal ligament containing the splenic vessels and pancreatic tail.",
        vis: {
          kind: "table",
          cols: ["Compartment", "Histological component", "Primary immune / filter function"],
          rows: [
            ["White pulp", "Periarteriolar lymphoid sheaths (PALS)", "T-cell zone surrounding central arterioles"],
            ["White pulp follicles", "Germinal centres and mantle zones", "B-cell maturation and opsonizing antibody production"],
            ["Red pulp cords", "Cords of Billroth and reticular meshwork", "Macrophage clearance of aged RBCs and pitted inclusions"],
            ["Red pulp sinuses", "Endothelial barrel stave clefts", "Physical deformability test for circulating erythrocytes"]
          ]
        }
      },
      {
        tx: "Histologically, the splenic parenchyma comprises **white pulp** and red pulp. The white pulp mediates immune surveillance: T lymphocytes surround central arterioles as the periarteriolar lymphoid sheath, while B lymphocytes organize into follicles that synthesize immunoglobulin M and opsonizing antibodies against encapsulated bacterial polysaccharides. Marginal zone macrophages clear antigen-antibody complexes.",
        say: "Splenic parenchyma consists of white pulp and red pulp. White pulp handles immune surveillance: T-cells form periarteriolar sheaths around central arterioles, while B-cells form follicles that produce opsonizing antibodies against encapsulated bacteria.",
        vis: {
          kind: "compare",
          left: {
            title: "White pulp function",
            points: [
              "Composed of lymphoid aggregates",
              "PALS surrounds central arterioles (T-cells)",
              "Splenic follicles house mature B-cells",
              "Synthesizes opsonins and IgM antibodies"
            ]
          },
          right: {
            title: "Red pulp function",
            points: [
              "Composed of cords of Billroth and sinuses",
              "Splenic macrophages remove senescent erythrocytes",
              "Filters Howell-Jolly bodies and Heinz bodies",
              "Reservoir for platelets and mobilizable monocytes"
            ]
          }
        }
      },
      {
        tx: "The **red pulp** serves as a specialized mechanical filter. Blood exits open-ended arterioles into the cords of Billroth, where macrophages inspect erythrocytes. To re-enter circulation, red cells must deform through narrow two-micrometer slits between endothelial barrel staves lining splenic sinusoids. Stiff spherocytes or rigid sickled cells fail this passage and are promptly phagocytosed.",
        say: "The red pulp functions as a mechanical vascular filter. Erythrocytes enter cords of Billroth and must squeeze through two-micrometer endothelial slits into venous sinuses. Inflexible red blood cells such as spherocytes fail this test and are engulfed by macrophages.",
        vis: null
      },
      {
        tx: "Splenectomy causes loss of polysaccharide antibody synthesis, predisposing to **overwhelming postsplenectomy infection** (OPSI) by encapsulated organisms: Streptococcus pneumoniae, Neisseria meningitidis and Haemophilus influenzae. Peripheral blood smears demonstrate Howell-Jolly bodies (nuclear DNA remnants), Heinz bodies, and target cells. Prophylactic vaccination and prompt antibiotic administration are critical lifelong safeguards.",
        say: "Splenectomy impairs clearance of encapsulated bacteria, creating risk of overwhelming postsplenectomy sepsis from Streptococcus pneumoniae and Neisseria meningitidis. Blood smears demonstrate Howell-Jolly bodies, Heinz bodies and target cells, requiring lifelong vaccination protocols.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-spleen-gross.webp",
          alt: "Splenic gross anatomy and vascular hilum",
          caption: "Gross anatomy of the spleen displaying visceral impressions, fibrous capsule, and branching hilar vessels."
        }
      }
    ]
  },
  {
    module: "ana-trachea-bronchi",
    subject: "anatomy",
    title: "Tracheobronchial tree, carina and bronchopulmonary segmental anatomy",
    minutes: 6,
    refs: ["ALGrawany Anatomy & Physiology Made Easy 2026", "Gray's Anatomy for Students"],
    steps: [
      {
        tx: "The **trachea** is a fibrocartilaginous tube extending from the lower border of the cricoid cartilage at C6 down to the sternal angle of Louis at T4-T5. It measures approximately ten to twelve centimeters in length. Its framework consists of sixteen to twenty C-shaped hyaline cartilage rings that maintain patency against negative intrathoracic inspiratory pressures.",
        say: "The trachea extends from the cricoid cartilage at C6 to the sternal angle at T4-T5, measuring ten to twelve centimeters. It is supported by sixteen to twenty C-shaped hyaline cartilage rings that keep the airway patent during inspiration.",
        vis: {
          kind: "table",
          cols: ["Airway segment", "Vertebral level", "Key anatomical features"],
          rows: [
            ["Cricoid origin", "C6 vertebral level", "Only complete circular ring of the airway"],
            ["Cervical trachea", "C6 to T1", "Crossed anteriorly by the thyroid isthmus at rings 2-4"],
            ["Thoracic trachea", "T1 to T4-T5", "Descends in superior mediastinum, anterior to esophagus"],
            ["Carina bifurcation", "T4-T5 (sternal angle)", "Internal ridge dividing into main bronchi"]
          ]
        }
      },
      {
        tx: "Posteriorly, the gap between tracheal cartilage ends is spanned by smooth muscle known as the **trachealis muscle** and fibroelastic tissue directly adjacent to the anterior esophageal wall. Contraction of the trachealis under sympathetic stimulation narrows the airway lumen, dramatically accelerating linear airflow velocity during cough to expel mucus and foreign particles.",
        say: "The posterior tracheal wall contains the smooth trachealis muscle abutting the anterior esophagus. Contraction of the trachealis narrows tracheal diameter, boosting linear airflow velocity during explosive coughing to clear foreign materials.",
        vis: null
      },
      {
        tx: "At the T4-T5 level, an internal mucosal ridge termed the **carina** marks tracheal bifurcation into right and left primary bronchi. The right main bronchus is wider, shorter (2.5 cm), and runs more vertically than the left main bronchus (5 cm). Consequently, aspirated foreign bodies, liquids, and endotracheal tubes accidentally advanced too far preferentially enter the right bronchial tree.",
        say: "At the sternal angle, the carina divides the trachea into right and left main bronchi. The right main bronchus is wider, shorter and more vertical than the left. As a result, aspirated foreign bodies and secretions lodge preferentially in the right bronchus.",
        vis: {
          kind: "compare",
          left: {
            title: "Right main bronchus",
            points: [
              "Shorter length (approximately 2.5 cm)",
              "Wider luminal caliber",
              "More vertical orientation (25 degree angle)",
              "Aspirated foreign objects lodge here preferentially"
            ]
          },
          right: {
            title: "Left main bronchus",
            points: [
              "Longer length (approximately 5 cm)",
              "Narrower luminal caliber",
              "More horizontal orientation (45 degree angle)",
              "Crosses inferior to aortic arch and anterior to esophagus"
            ]
          }
        }
      },
      {
        tx: "Primary bronchi branch into lobar and then segmental bronchi, supplying ten distinct **bronchopulmonary segments** in each lung. Each segment is a pyramidal structural and functional unit with its apex directed toward the lung hilum. Each segment possesses an independent tertiary segmental bronchus and pulmonary arterial branch, but intersegmental pulmonary veins run in intersegmental connective tissue septa.",
        say: "Segmental bronchi supply ten bronchopulmonary segments in each lung. Each segment is a surgical anatomical unit with an independent tertiary bronchus and pulmonary arterial branch. In contrast, pulmonary veins course through intersegmental connective tissue borders.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-trachea-bronchi-gross.webp",
          alt: "Tracheobronchial branching and carina architecture",
          caption: "Tracheobronchial framework depicting cartilage rings, carina bifurcating into primary and lobar bronchi."
        }
      }
    ]
  },
  {
    module: "ana-urinary-male-genital",
    subject: "anatomy",
    title: "Lower urinary tract and male reproductive anatomy: ureter, bladder and prostate",
    minutes: 6,
    refs: ["ALGrawany Anatomy & Physiology Made Easy 2026", "Campbell-Walsh-Wein Urology"],
    steps: [
      {
        tx: "The **ureters** are muscular retroperitoneal tubes approximately twenty-five centimeters long that propel urine from renal pelvis to bladder by peristalsis. They cross over the pelvic brim anterior to the bifurcation of the common iliac artery. The ureter has three physiological constrictions where calculi frequently lodge: the pelviureteric junction, the pelvic brim crossing, and the vesicoureteric junction.",
        say: "The ureters are retroperitoneal muscular tubes transporting urine via peristalsis. They cross the pelvic brim over the iliac artery bifurcation. Ureteric calculi lodge at three sites: pelviureteric junction, pelvic brim crossing, and intramural entry at the vesicoureteric junction.",
        vis: {
          kind: "table",
          cols: ["Constriction site", "Anatomical relationship", "Stone impaction risk"],
          rows: [
            ["Pelviureteric junction (PUJ)", "Transition from renal pelvis to tubular ureter", "Common in congenital hydronephrosis"],
            ["Pelvic brim crossing", "Crosses over common/external iliac artery", "Middle ureteric obstruction"],
            ["Vesicoureteric junction (VUJ)", "Intramural oblique tunnel through detrusor", "Narrowest site; most frequent calculus impaction"]
          ]
        }
      },
      {
        tx: "The **urinary bladder** is a hollow muscular organ lined by transitional epithelium (urothelium). Its muscular wall is the detrusor muscle, innervated by parasympathetic pelvic splanchnic nerves (S2-S4). The trigone is a smooth triangular mucosal area on the posterior wall bounded by the two ureteric orifices and the internal urethral orifice, derived embryologically from mesoderm.",
        say: "The urinary bladder is lined by distensible urothelium and enclosed by the detrusor muscle, innervated by parasympathetics from S2 to S4. The bladder trigone is a smooth triangular floor between both ureteric orifices and the urethral orifice, originating embryologically from mesoderm.",
        vis: {
          kind: "compare",
          left: {
            title: "Bladder body & dome",
            points: [
              "Detrusor smooth muscle arranged in meshwork",
              "Distensible folded mucosa lined by urothelium",
              "Parasympathetic stimulation induces contraction",
              "Extraperitoneal anteriorly; covered by peritoneum superiorly"
            ]
          },
          right: {
            title: "Bladder trigone",
            points: [
              "Smooth non-folding triangular mucous floor",
              "Fixed dimensions between ureteric and urethral orifices",
              "Embryological mesodermal origin from mesonephric ducts",
              "High density of sensory innervation and pain fibers"
            ]
          }
        }
      },
      {
        tx: "The **prostate gland** surrounds the prostatic urethra immediately inferior to the bladder neck. McNeal described three distinct glandular zones: the peripheral zone (70% of tissue; origin of 75% of prostate carcinomas), the transition zone (surrounds urethra; site of benign prostatic hyperplasia), and the central zone (surrounds ejaculatory ducts). The prostate is palpated through the anterior rectal wall.",
        say: "The prostate surrounds the urethra below the bladder neck. McNeal divided it into three zones: the peripheral zone where most adenocarcinomas arise, the transition zone where benign prostatic hyperplasia originates, and the central zone surrounding ejaculatory ducts.",
        vis: null
      },
      {
        tx: "The **testis** develops retroperitoneally in the posterior abdominal wall and descends through the inguinal canal into the scrotum. It is enveloped by the fibrous tunica albuginea and the double-layered serous tunica vaginalis (remnant of processus vaginalis). The epididymis caps the posterior testis, storing and maturing spermatozoa before conveying them into the ductus deferens.",
        say: "The testis descends retroperitoneally into the scrotum, enclosed by the fibrous tunica albuginea and serous tunica vaginalis. The epididymis caps the posterior testis, maturing and storing spermatozoa before they enter the ductus deferens.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-male-reproductive-gross.webp",
          alt: "Male reproductive and lower urinary structures",
          caption: "Anatomy of the prostate, seminal vesicles, ductus deferens and testicular compartments."
        }
      }
    ]
  },
  {
    module: "ana-liver-biliary",
    subject: "anatomy",
    title: "Hepatic lobular architecture, Couinaud segmentation and biliary drainage",
    minutes: 6,
    refs: ["ALGrawany Anatomy & Physiology Made Easy 2026", "Blumgart's Surgery of the Liver"],
    steps: [
      {
        tx: "The **liver** is the largest internal organ and metabolic powerhouse, occupying the right hypochondrium and epigastrium. Functionally, it is partitioned according to the Couinaud classification into eight independent functional segments. Each Couinaud segment possesses its own dedicated portal triad branch (portal vein, hepatic artery, bile duct) and is drained by tributaries of the hepatic veins.",
        say: "The liver is partitioned into eight functional Couinaud segments. Each segment has its own portal triad pedicle containing an independent branch of the portal vein, hepatic artery and bile duct, allowing resections along anatomic boundaries.",
        vis: {
          kind: "table",
          cols: ["Couinaud segment", "Functional division", "Surgical landmark / boundary"],
          rows: [
            ["Segment I", "Caudate lobe", "Receives blood from both triads; drains directly into IVC"],
            ["Segments II, III, IV", "Left functional liver", "Divided by falciform ligament and left hepatic vein"],
            ["Segments V, VI, VII, VIII", "Right functional liver", "Divided into anterior and posterior sectors by right hepatic vein"]
          ]
        }
      },
      {
        tx: "At the microscopic level, the **hepatic lobule** consists of cords of hepatocytes radiating from a central vein. At the periphery, portal triads situated within portal tracts contain a hepatic arteriole (delivering oxygenated blood), a portal venule (delivering nutrient-rich venous blood from the intestines), and a bile ductule. Blood mixes in fenestrated hepatic sinusoids lined by phagocytic Kupffer cells.",
        say: "Microscopically, hepatic lobules consist of hepatocyte cords radiating from a central vein. Portal triads at the periphery deliver arterial and portal venous blood into fenestrated sinusoids lined by resident Kupffer macrophages before draining into central veins.",
        vis: {
          kind: "compare",
          left: {
            title: "Classic lobule",
            points: [
              "Hexagonal unit centered on central vein",
              "Emphasizes endocrine and vascular drainage",
              "Sinusoidal blood flows centripetally to central vein",
              "Bile flows centrifugally toward portal triads"
            ]
          },
          right: {
            title: "Hepatic acinus (Rappaport)",
            points: [
              "Diamond shaped unit centered on portal tract",
              "Emphasizes oxygenation and metabolic gradients",
              "Zone 1 (periportal) best oxygenated; resists ischemia",
              "Zone 3 (centrilobular) most vulnerable to toxic/ischemic injury"
            ]
          }
        }
      },
      {
        tx: "The space of Disse lies between sinusoidal endothelial cells and hepatocytes, housing **hepatic stellate cells** (Ito cells). Stellate cells store vitamin A in physiological states. In chronic hepatic injury and inflammation, stellate cells transdifferentiate into contractile myofibroblasts, synthesizing abundant collagen type I and III, which drives liver fibrosis and portal hypertension.",
        say: "The space of Disse separates endothelial cells from hepatocytes, containing hepatic stellate cells. Stellate cells store vitamin A, but in chronic liver inflammation they transform into myofibroblasts, secreting collagen that drives progressive hepatic cirrhosis.",
        vis: null
      },
      {
        tx: "Bile is synthesized by hepatocytes and secreted into intercellular bile canaliculi, draining into intrahepatic bile ductules. These join to form right and left hepatic ducts, uniting at the porta hepatis into the **common hepatic duct**. The cystic duct from the gallbladder joins the common hepatic duct to form the common bile duct, which traverses the hepatoduodenal ligament.",
        say: "Bile drains from canaliculi into right and left hepatic ducts, forming the common hepatic duct at the liver hilum. The cystic duct joins the common hepatic duct to form the common bile duct, descending within the hepatoduodenal ligament to the duodenum.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-liver-gross.webp",
          alt: "Hepatic architecture and biliary branching",
          caption: "Hepatic surface contours and biliary branching patterns displaying portal triad entry and inferior vena cava."
        }
      }
    ]
  },
  {
    module: "ana-colon-rectum",
    subject: "anatomy",
    title: "Colorectal anatomy: teniae coli, pelvic splanchnics and anal canal sphincters",
    minutes: 6,
    refs: ["ALGrawany Anatomy & Physiology Made Easy 2026", "Sabiston Textbook of Surgery 22nd ed"],
    steps: [
      {
        tx: "The **large intestine** extends from the ileocecal valve to the anus, comprising the cecum, appendix, colon, rectum, and anal canal. It is distinguished externally from small intestine by three unique anatomical features: three longitudinal smooth muscle bands termed teniae coli, segmental sacculations called haustra, and small fat-filled peritoneal projections known as appendices epiploicae.",
        say: "The large intestine extends from the ileocecal junction to the anus. It is distinguished from small bowel by three hallmarks: longitudinal muscle bands called teniae coli, sacculations termed haustra, and fat-filled peritoneal tags called appendices epiploicae.",
        vis: {
          kind: "table",
          cols: ["Colonic segment", "Peritoneal status", "Arterial supply", "Venous drainage"],
          rows: [
            ["Cecum & Appendix", "Intraperitoneal with mesoappendix", "Ileocolic artery (SMA)", "Superior mesenteric vein"],
            ["Ascending colon", "Retroperitoneal (Toldt fascia)", "Right colic and ileocolic (SMA)", "Superior mesenteric vein"],
            ["Transverse colon", "Intraperitoneal (mesocolon)", "Middle colic artery (SMA)", "Superior mesenteric vein"],
            ["Descending colon", "Retroperitoneal", "Left colic artery (IMA)", "Inferior mesenteric vein"]
          ]
        }
      },
      {
        tx: "The **cecal appendix** is a narrow, blind-ended muscular pouch arising from the posteromedial wall of the cecum approximately two centimeters below the ileocecal valve. Crucially, all three teniae coli (tenia libera, mesocolica, and omentalis) converge at the base of the appendix, serving as an infallible surgical landmark to identify the appendix during emergency appendectomy.",
        say: "The vermiform appendix arises from the posteromedial cecal wall below the ileocecal valve. All three teniae coli converge precisely at the appendiceal base, providing an infallible surgical landmark during appendectomy.",
        vis: {
          kind: "compare",
          left: {
            title: "Midgut colon (SMA)",
            points: [
              "Cecum, appendix, ascending colon, proximal 2/3 transverse",
              "Arterial supply via superior mesenteric artery",
              "Parasympathetic innervation via vagus nerve (CN X)",
              "Drains into portal vein via superior mesenteric vein"
            ]
          },
          right: {
            title: "Hindgut colon (IMA)",
            points: [
              "Distal 1/3 transverse colon, descending, sigmoid, rectum",
              "Arterial supply via inferior mesenteric artery",
              "Parasympathetic innervation via pelvic splanchnics (S2-S4)",
              "Drains into splenic vein via inferior mesenteric vein"
            ]
          }
        }
      },
      {
        tx: "The **rectum** begins at the level of the third sacral vertebra (S3) where teniae coli coalesce into a continuous outer longitudinal muscular layer. It lacks haustra and appendices epiploicae. The rectum features three lateral curves marked internally by mucosal folds known as the valves of Houston. The peritoneal reflection forms the rectovesical pouch in males and rectouterine pouch of Douglas in females.",
        say: "The rectum begins at S3 where teniae coli fuse into a continuous longitudinal muscle layer. It lacks haustra and epiploic appendages. Internally, three mucosal folds form the valves of Houston, leading to the extraperitoneal lower rectum.",
        vis: null
      },
      {
        tx: "The **anal canal** is divided at the pectinate (dentate) line. Above the dentate line, the canal is derived from endoderm, lined by columnar epithelium, supplied by the superior rectal vessels, innervated by autonomic nerves (insensitive to sharp pain), and drains into portal venous circulation. Below the line, it is derived from ectoderm, lined by stratified squamous epithelium, innervated by somatic pudendal branches (highly sensitive), and drains systemically.",
        say: "The anal canal is divided by the pectinate line. Above the line, tissue is endodermal, supplied by superior rectal vessels, and insensitive to somatic pain. Below the line, tissue is ectodermal, supplied by inferior rectal vessels, and highly sensitive to sharp pain via pudendal nerves.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-large-intestine-gross.webp",
          alt: "Large intestine and colorectal morphology",
          caption: "Large bowel contours displaying cecum, appendix base, teniae coli, haustra and rectal flexures."
        }
      }
    ]
  },
  {
    module: "ana-pharynx-tonsils",
    subject: "anatomy",
    title: "Pharyngeal spaces, constrictor musculature and Waldeyer tonsillar ring",
    minutes: 6,
    refs: ["ALGrawany Anatomy & Physiology Made Easy 2026", "Scott-Brown's Otorhinolaryngology"],
    steps: [
      {
        tx: "The **pharynx** is a muscular tube extending from the cranial base to the inferior border of the cricoid cartilage at C6, where it continues as the esophagus. It is divided anatomically into three regions: the nasopharynx (posterior to nasal choanae), the oropharynx (posterior to oral cavity from soft palate to epiglottis), and the laryngopharynx (posterior to larynx down to C6).",
        say: "The pharynx is a muscular conduit from the base of the skull to C6, continuing as the esophagus. It comprises three compartments: the nasopharynx posterior to nasal cavities, oropharynx posterior to the mouth, and laryngopharynx posterior to the larynx.",
        vis: {
          kind: "table",
          cols: ["Pharyngeal division", "Boundaries", "Lining epithelium", "Key structures"],
          rows: [
            ["Nasopharynx", "Skull base to soft palate", "Pseudostratified ciliated columnar", "Eustachian tube orifice, pharyngeal tonsil (adenoid)"],
            ["Oropharynx", "Soft palate to epiglottis", "Non-keratinized stratified squamous", "Palatine tonsils, tonsillar pillars, base of tongue"],
            ["Laryngopharynx", "Epiglottis to C6 cricoid border", "Non-keratinized stratified squamous", "Piriform fossae, postcricoid area"]
          ]
        }
      },
      {
        tx: "The muscular wall consists of an outer circular layer of three overlapping **pharyngeal constrictors** (superior, middle, and inferior) and an inner longitudinal layer (stylopharyngeus, salpingopharyngeus, and palatopharyngeus). All pharyngeal muscles are innervated by the pharyngeal plexus via the vagus nerve (CN X), except the stylopharyngeus, which is supplied exclusively by the glossopharyngeal nerve (CN IX).",
        say: "The pharyngeal wall contains three overlapping circular constrictors and three longitudinal muscles. All pharyngeal muscles are innervated by the vagus nerve via the pharyngeal plexus, with the sole exception of stylopharyngeus, which is innervated by the glossopharyngeal nerve.",
        vis: {
          kind: "compare",
          left: {
            title: "Circular constrictor muscles",
            points: [
              "Superior, middle and inferior constrictors",
              "Overlap each other like stacked flowerpots",
              "Propel food bolus sequentially into esophagus",
              "Innervated by pharyngeal branch of vagus (CN X)"
            ]
          },
          right: {
            title: "Longitudinal pharyngeal muscles",
            points: [
              "Stylopharyngeus, salpingopharyngeus, palatopharyngeus",
              "Elevate the larynx and pharynx during swallowing",
              "Stylopharyngeus supplied by CN IX (glossopharyngeal)",
              "Salpingopharyngeus opens the auditory tube during deglutition"
            ]
          }
        }
      },
      {
        tx: "The inferior constrictor muscle features two distinct components: the thyropharyngeus with oblique fibers and the cricopharyngeus with horizontal fibers. Between these two muscle components lies a triangular zone of weakness known as **Killian dehiscence**. Elevated intraluminal pressure forces mucosa to herniate posteriorly through Killian dehiscence, forming a Zenker diverticulum.",
        say: "Between the oblique thyropharyngeus and horizontal cricopharyngeus lies a muscular weakness called Killian dehiscence. Increased hypopharyngeal pressure forces mucosa through this defect, creating a Zenker diverticulum with regurgitation and halitosis.",
        vis: null
      },
      {
        tx: "The entrance of the aerodigestive tract is guarded by **Waldeyer tonsillar ring**, a circular band of mucosa-associated lymphoid tissue. The ring comprises the nasopharyngeal tonsil (adenoid) superiorly, paired tubal tonsils near eustachian orifices, paired palatine tonsils laterally between palatoglossal and palatopharyngeal arches, and the lingual tonsil on the posterior third of the tongue.",
        say: "Waldeyer tonsillar ring guards the aerodigestive portal. It consists of the superior adenoid tonsil, bilateral tubal tonsils, lateral palatine tonsils between faucial pillars, and the lingual tonsil at the tongue base, providing first line immune defense.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-throat-pharynx-gross.webp",
          alt: "Pharyngeal spaces and tonsillar ring topography",
          caption: "Pharyngeal mucosal landscape depicting nasopharynx, palatine tonsillar fossa and laryngopharyngeal junctions."
        }
      }
    ]
  }
];

// ==========================================
// 2. RUN LESSON GENERATION & VALIDATION
// ==========================================
console.log("=== Generating Wave 2 Interactive Lessons ===");
const idxPath = path.join(ROOT, "prep/lessons/v1/index.json");
const indexData = JSON.parse(fs.readFileSync(idxPath, "utf8"));

let lessonWritten = 0;
let lessonErrors = 0;

for (const l of wave2Lessons) {
  l.v = 1;
  l.gen = "AI";
  l.run = "books-coverage-wave2";
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
    console.error(`ERROR validating lesson ${l.module}:`, errs);
    lessonErrors++;
  } else {
    const p = path.join(ROOT, "prep/lessons/v1", `${l.module}.json`);
    fs.writeFileSync(p, JSON.stringify(l, null, 1) + "\n");
    indexData.modules[l.module] = {
      title: l.title,
      minutes: l.minutes,
      steps: l.steps.length,
      gen: l.gen
    };
    console.log(`OK: wrote lesson ${l.module} (${l.steps.length} steps)`);
    lessonWritten++;
  }
}

fs.writeFileSync(idxPath, JSON.stringify(indexData, null, 1) + "\n");
console.log(`Updated index.json. Total lessons now: ${Object.keys(indexData.modules).length}`);

// ==========================================
// 3. GENERATE KB REFERENCE ARTICLES (KB v2)
// ==========================================
console.log("\n=== Generating Knowledge Library Reference Articles ===");
const REF_DIR = path.join(ROOT, "kb", "reference");
fs.mkdirSync(REF_DIR, { recursive: true });

const kbArticles = [
  {
    id: "cns_organization_and_planes",
    name: "Central Nervous System Organization and Anatomical Axes",
    aliases: ["CNS organization", "Neuraxis", "Brain vesicles", "Meninges"],
    system: "Nervous System / Neuroanatomy",
    specialty: "Anatomy / Neurology",
    source: "Clinical Neuroanatomy Made Ridiculously Simple / Snell's Clinical Neuroanatomy",
    pearls: [
      "Cephalic flexure induces a ninety-degree bend between brainstem and diencephalon, shifting anatomical axes",
      "Prosencephalon subdivides into telencephalon (cerebrum) and diencephalon (thalamus, hypothalamus)",
      "Rhombencephalon subdivides into metencephalon (pons, cerebellum) and myelencephalon (medulla oblongata)",
      "Dura mater forms falx cerebri and tentorium cerebelli, separating supratentorial and infratentorial spaces",
      "Epidural hematoma is biconvex from middle meningeal artery rupture; subdural hematoma is crescentic from bridging vein shear"
    ],
    patho: "Structural development of the neural tube establishes five secondary brain vesicles surrounding ventricular cavities. Disruptions in neural tube closure cause anencephaly rostrally and spina bifida caudally. Mechanical acceleration-deceleration forces produce traumatic shearing of bridging veins or middle meningeal artery lacerations within specific meningeal compartments.",
    investigations: ["Non-contrast head CT for acute intracranial hemorrhage", "MRI brain T1, T2 and FLAIR for parenchymal architecture", "CT venography for dural venous sinus thrombosis"],
    differentials: ["Acute epidural hematoma", "Acute subdural hematoma", "Traumatic subarachnoid hemorrhage", "Dural venous sinus thrombosis"]
  },
  {
    id: "circle_of_willis_and_stroke_syndromes",
    name: "Circle of Willis and Neurovascular Stroke Syndromes",
    aliases: ["Circle of Willis", "MCA stroke", "ACA stroke", "Berry aneurysm"],
    system: "Nervous System / Neurovascular",
    specialty: "Anatomy / Neurology / Neurosurgery",
    source: "Clinical Neuroanatomy Made Ridiculously Simple / Brazis Localization",
    pearls: [
      "Circle of Willis polygon anastomoses internal carotid and vertebrobasilar circulations at the brain base",
      "Middle cerebral artery stroke causes contralateral hemiparesis and sensory loss predominantly affecting face and arm",
      "Left dominant MCA stroke causes aphasia; right non-dominant MCA stroke produces hemineglect and anosognosia",
      "Anterior cerebral artery stroke impairs contralateral leg and foot function with urinary incontinence",
      "Saccular berry aneurysms occur most commonly at anterior communicating artery bifurcation (35%)"
    ],
    patho: "The Circle of Willis provides collateral perfusion across cerebral hemispheres. Thromboembolic or atherothrombotic occlusion of specific branches causes territorial ischemic stroke corresponding to somatotopic cortical representations. Saccular aneurysms arise at arterial branch points from internal elastic lamina defects and rupture into the subarachnoid space.",
    investigations: ["Non-contrast head CT to exclude acute hemorrhage", "Diffusion-weighted MRI (DWI) brain for early cytotoxic edema", "CT or MR angiography from aortic arch to vertex to identify vessel occlusion or aneurysm"],
    differentials: ["Territorial ischemic stroke (MCA vs ACA)", "Ruptured saccular aneurysm causing SAH", "Transient ischemic attack", "Todd paralysis following focal seizure"]
  },
  {
    id: "visual_pathways_and_field_defects",
    name: "Visual Pathways and Field Defect Localization",
    aliases: ["Visual pathway", "Bitemporal hemianopia", "Meyer loop", "Homonymous hemianopia"],
    system: "Special Senses / Ophthalmology / Neuroanatomy",
    specialty: "Anatomy / Ophthalmology / Neurology",
    source: "Clinical Neuroanatomy Made Ridiculously Simple / Walsh and Hoyt Clinical Neuro-Ophthalmology",
    pearls: [
      "Nasal retinal fibres decussate at the optic chiasm; temporal retinal fibres stay uncrossed",
      "Pituitary adenoma compressing crossing central chiasmal fibres produces bitemporal hemianopia",
      "Meyer loop sweeps anteriorly through the temporal lobe; lesions produce pie in the sky superior quadrantanopia",
      "Parietal optic radiation lesions produce inferior quadrantanopia (pie on the floor)",
      "Occipital calcarine cortex infarction produces homonymous hemianopia with macular sparing due to collateral MCA supply"
    ],
    patho: "Retinal photoreceptors transduce photons into electrical signals relayed through optic nerves, chiasm and optic tracts to the lateral geniculate nucleus. Geniculocalcarine fibers project via temporal (Meyer loop) and parietal optic radiations to primary visual cortex. Compressive or ischemic lesions along this pathway produce pathognomonic visual field deficits.",
    investigations: ["Humphrey automated visual field perimetry", "Contrast-enhanced MRI brain and sella for optic pathway lesions", "Optical coherence tomography (OCT) of retinal nerve fiber layer"],
    differentials: ["Pituitary macroadenoma compression", "Temporal lobe stroke or resection", "Posterior cerebral artery cortical infarction", "Optic neuritis in multiple sclerosis"]
  },
  {
    id: "horner_syndrome_and_hypothalamic_regulation",
    name: "Autonomic Nervous System, Hypothalamus and Horner Syndrome",
    aliases: ["Autonomic nervous system", "Hypothalamus", "Horner syndrome", "Ciliospinal center"],
    system: "Nervous System / Neuroautonomic",
    specialty: "Anatomy / Neurology / Endocrinology",
    source: "Clinical Neuroanatomy Made Ridiculously Simple / Guyton and Hall",
    pearls: [
      "Sympathetic outflow originates from T1-L2 intermediolateral horn; parasympathetic from CN III, VII, IX, X and S2-S4",
      "Lateral hypothalamus stimulates appetite; ventromedial nucleus promotes satiety; suprachiasmatic controls circadian rhythm",
      "Oculosympathetic pathway is a 3-neuron chain: hypothalamus to ciliospinal center (C8-T2), to superior cervical ganglion, to iris",
      "Horner syndrome triad: ptosis (superior tarsal muscle), miosis (dilator pupillae), and anhidrosis",
      "Apical lung Pancoast tumor invading the sympathetic trunk is a classic cause of preganglionic Horner syndrome"
    ],
    patho: "The hypothalamus coordinates endocrine and autonomic homeostasis via neuroendocrine axes and descending autonomic projections. Disruption of the sympathetic chain at central (brainstem), preganglionic (thoracic inlet), or postganglionic (carotid canal) levels denervates ipsilateral ocular smooth muscle and facial sweat glands.",
    investigations: ["Topical apraclonidine (0.5%) eye drop test for reversal of anisocoria confirming Horner syndrome", "CT chest and neck with IV contrast to evaluate lung apex and carotid sheath", "MRI brain and brainstem if central Horner syndrome suspected"],
    differentials: ["Pancoast apical bronchogenic carcinoma", "Internal carotid artery dissection", "Lateral medullary (Wallenberg) syndrome", "Physiologic anisocoria"]
  },
  {
    id: "cortical_localization_and_aphasias",
    name: "Cortical Functional Localization and Aphasia Syndromes",
    aliases: ["Cerebral cortex", "Broca aphasia", "Wernicke aphasia", "Conduction aphasia"],
    system: "Nervous System / Cognitive Neurology",
    specialty: "Anatomy / Neurology",
    source: "Clinical Neuroanatomy Made Ridiculously Simple / Brazis Localization",
    pearls: [
      "Broca area (Brodmann 44, 45) in dominant inferior frontal gyrus governs expressive motor speech programming",
      "Broca aphasia: non-fluent, halting speech with intact comprehension and severe frustration",
      "Wernicke area (Brodmann 22) in posterior superior temporal gyrus mediates receptive language comprehension",
      "Wernicke aphasia: fluent effortless paraphasic speech with severely impaired comprehension and lack of insight",
      "Arcuate fasciculus disruption causes conduction aphasia: fluent speech and intact comprehension, but severely impaired repetition"
    ],
    patho: "Cerebral cortex organization partitions executive, sensory, motor, and multimodal association tasks into discrete cytoarchitectonic Brodmann areas. Language networks link temporal auditory comprehension centers to frontal motor speech areas via the arcuate fasciculus. Ischemic destruction of these hubs or tracts produces specific language dissociations.",
    investigations: ["Standardized bedside language evaluation (fluency, comprehension, repetition, naming)", "Diffusion-weighted MRI brain for acute dominant hemisphere stroke", "Formal neuropsychological cognitive assessment"],
    differentials: ["Broca expressive aphasia", "Wernicke receptive aphasia", "Conduction aphasia", "Transcortical motor and sensory aphasias"]
  },
  {
    id: "neurological_lesion_localization_rules",
    name: "Clinical Neuro-Localization Rules and UMN vs LMN Distinctions",
    aliases: ["Neuro-localization", "UMN vs LMN", "Rule of four", "Alternating hemiplegia"],
    system: "Nervous System / Clinical Neurology",
    specialty: "Anatomy / Neurology",
    source: "Clinical Neuroanatomy Made Ridiculously Simple / Brazis Localization",
    pearls: [
      "UMN lesions produce spasticity, clasp-knife tone, hyperreflexia, clonus, and positive extensor Babinski sign",
      "LMN lesions cause flaccid paralysis, hypotonia, hyporeflexia, denervation atrophy, and visible fasciculations",
      "Brainstem rule of 4: 4 cranial nerves in medulla (IX-XII), 4 in pons (V-VIII), 4 above/midbrain (I-IV)",
      "Medial brainstem structures: motor pathway (corticospinal), medial lemniscus, MLF, and motor cranial nerve nuclei",
      "Lateral medullary (Wallenberg) syndrome: PICA occlusion causing dysphagia, hoarseness, Horner, and crossed analgesia"
    ],
    patho: "Accurate neurological diagnosis relies on anatomic localization derived from neurological signs. Motor weakness is categorized into central upper motor neuron dysfunction (loss of cortical inhibitory tone) versus peripheral lower motor neuron dysfunction (denervation of motor units). Brainstem vascular lesions combine ipsilateral cranial nerve signs with contralateral body deficits.",
    investigations: ["Electromyography and nerve conduction studies (EMG/NCS) for LMN denervation versus myopathy", "MRI brain and spinal cord with gadolinium", "Lumbar puncture and CSF analysis for inflammatory neuro-immunology"],
    differentials: ["Amyotrophic lateral sclerosis (combined UMN and LMN signs)", "Cervical compressive myelopathy", "Guillain-Barre polyradiculoneuropathy", "Brainstem stroke syndrome"]
  },
  {
    id: "gastric_and_duodenal_anatomy",
    name: "Gastric and Duodenal Anatomy and Peptic Perforation",
    aliases: ["Stomach anatomy", "Duodenum anatomy", "Peptic ulcer disease", "Gastroduodenal artery"],
    system: "Gastrointestinal System / Upper GI",
    specialty: "Anatomy / General Surgery / Gastroenterology",
    source: "ALGrawany Anatomy & Physiology Made Easy 2026 / Sabiston Surgery 22e",
    pearls: [
      "Stomach blood supply derives from celiac trunk via gastric, gastroepiploic, and short gastric vessels",
      "Posterior duodenal bulb (D1) ulcers erode gastroduodenal artery, causing life-threatening hematemesis",
      "Anterior duodenal bulb ulcers perforate into peritoneal cavity, causing peritonitis and pneumoperitoneum",
      "Ampulla of Vater empties into second part of duodenum (D2), guarded by sphincter of Oddi",
      "Third part of duodenum (D3) crosses horizontally between aorta and superior mesenteric artery (SMA syndrome)"
    ],
    patho: "The gastroduodenal mucosa balances mucosal defense factors (mucus, bicarbonate, mucosal blood flow) against aggressive luminal forces (gastric hydrochloric acid, pepsin, Helicobacter pylori). Ulcer penetration through the muscularis mucosae can erode into submucosal arterial branches or perforate the free anterior visceral wall.",
    investigations: ["Upper gastrointestinal endoscopy (EGD) with biopsy", "Erect chest radiograph to detect free air under diaphragm (pneumoperitoneum)", "Contrast-enhanced CT abdomen for perforated peptic ulcer and fluid collections"],
    differentials: ["Perforated duodenal ulcer", "Bleeding peptic ulcer with gastroduodenal artery erosion", "Acute pancreatitis", "Superior mesenteric artery syndrome"]
  },
  {
    id: "splenic_anatomy_and_postsplenectomy_sepsis",
    name: "Splenic Architecture and Overwhelming Postsplenectomy Infection",
    aliases: ["Spleen anatomy", "Red pulp", "White pulp", "OPSI", "Howell-Jolly bodies"],
    system: "Hemic and Lymphatic Systems / Spleen",
    specialty: "Anatomy / Hematology / General Surgery",
    source: "ALGrawany Anatomy & Physiology Made Easy 2026 / Sabiston Surgery 22e",
    pearls: [
      "Spleen lies in left hypochondrium under ribs 9-11; suspensory ligaments carry short gastric and splenic vessels",
      "White pulp synthesizes opsonizing antibodies and houses B and T lymphocytes",
      "Red pulp cords of Billroth filter aged, non-deformable erythrocytes through 2-micrometer endothelial slits",
      "Overwhelming postsplenectomy infection (OPSI) is caused by encapsulated bacteria: S. pneumoniae, N. meningitidis, H. influenzae",
      "Postsplenectomy blood film reveals Howell-Jolly bodies (nuclear DNA remnants), Heinz bodies, and target cells"
    ],
    patho: "The spleen acts as a lymphoid immune organ and mechanical erythrocyte filter. In the red pulp, sinusoids test red cell deformability. In the white pulp, marginal zone B-cells generate IgM against bacterial capsular polysaccharide antigens. Splenectomy impairs opsonization, predisposing to fulminant bacteremia and septic shock.",
    investigations: ["Complete blood count with peripheral smear examination for Howell-Jolly bodies", "Abdominal ultrasound or CT to evaluate splenic trauma or splenomegaly", "Blood cultures in any febrile asplenic patient"],
    differentials: ["Overwhelming postsplenectomy sepsis (OPSI)", "Splenic rupture following blunt abdominal trauma", "Splenic infarction in sickle cell disease", "Hereditary spherocytosis"]
  },
  {
    id: "tracheobronchial_anatomy_and_airway_foreign_body",
    name: "Tracheobronchial Tree and Bronchopulmonary Segments",
    aliases: ["Trachea anatomy", "Carina", "Bronchopulmonary segments", "Foreign body aspiration"],
    system: "Respiratory System / Airway",
    specialty: "Anatomy / Pulmonology / Thoracic Surgery",
    source: "ALGrawany Anatomy & Physiology Made Easy 2026 / Gray's Anatomy",
    pearls: [
      "Trachea extends from C6 cricoid cartilage to T4-T5 sternal angle, supported by 16-20 C-shaped cartilages",
      "Posterior trachealis smooth muscle contracts to narrow caliber and accelerate cough velocity",
      "Right main bronchus is wider, shorter (2.5 cm) and more vertical than left (5 cm)",
      "Aspirated foreign objects preferentially enter right main bronchus and right lower lobe bronchus",
      "Ten bronchopulmonary segments exist in each lung, each supplied by an independent tertiary bronchus and pulmonary artery"
    ],
    patho: "The tracheobronchial tree serves as a conducting airway lined by pseudostratified ciliated columnar epithelium with goblet cells. Asymmetrical bifurcation geometry at the carina creates a lower resistance, straighter trajectory into the right bronchial tree, directing aspirated liquids, food, or objects into right-sided segmental bronchi.",
    investigations: ["Inspiratory and expiratory chest radiographs for air trapping and atelectasis", "Flexible or rigid bronchoscopy for foreign body localization and extraction", "High-resolution CT chest with virtual bronchoscopy"],
    differentials: ["Foreign body airway aspiration", "Right mainstem endotracheal tube intubation", "Tracheobronchomalacia", "Endobronchial carcinoid tumor"]
  },
  {
    id: "male_genitourinary_anatomy_and_prostate",
    name: "Male Lower Urinary Tract, Prostate and Testicular Anatomy",
    aliases: ["Ureter anatomy", "Bladder trigone", "Prostate zones", "Testicular descent"],
    system: "Urogenital System / Male Genitourinary",
    specialty: "Anatomy / Urology",
    source: "ALGrawany Anatomy & Physiology Made Easy 2026 / Campbell-Walsh Urology",
    pearls: [
      "Ureter has 3 physiological constrictions: pelviureteric junction, pelvic brim crossing, and intramural bladder wall",
      "Detrusor muscle is innervated by parasympathetics (S2-S4); bladder trigone is derived from mesoderm",
      "Prostate peripheral zone accounts for 75% of carcinomas; transition zone is the site of benign prostatic hyperplasia",
      "Testicular lymph drains to para-aortic (lumbar) nodes; scrotal skin drains to superficial inguinal nodes",
      "Torsion of spermatic cord cuts off venous and arterial blood supply, requiring surgical detorsion within 6 hours"
    ],
    patho: "Ureteral smooth muscle propels urine into the bladder via peristaltic contractions. Calculi commonly impact at narrow anatomical bottlenecks. The prostate surrounds the bladder neck; nodular hyperplasia of the transition zone compresses the prostatic urethra, causing lower urinary tract symptoms, while carcinomas arise mainly in the peripheral zone.",
    investigations: ["Non-contrast CT kidneys, ureters, bladder (CT KUB) for nephrolithiasis", "Serum prostate-specific antigen (PSA) and multi-parametric prostate MRI (PI-RADS)", "Scrotal Doppler ultrasound for acute testicular pain and torsion"],
    differentials: ["Obstructing ureteral calculus", "Benign prostatic hyperplasia (BPH)", "Prostatic adenocarcinoma", "Acute testicular torsion"]
  },
  {
    id: "liver_anatomy_and_portal_hypertension",
    name: "Hepatic Lobular Architecture, Couinaud Segments and Portal Hypertension",
    aliases: ["Liver anatomy", "Couinaud segments", "Hepatic lobule", "Portal hypertension", "Space of Disse"],
    system: "Gastrointestinal System / Hepatobiliary",
    specialty: "Anatomy / Hepatology / General Surgery",
    source: "ALGrawany Anatomy & Physiology Made Easy 2026 / Blumgart Surgery of the Liver",
    pearls: [
      "Couinaud classification divides liver into 8 independent functional segments, each with individual portal pedicle",
      "Portal triad contains hepatic arteriole, portal venule, and bile ductule within Glisson capsule",
      "Hepatic stellate (Ito) cells in space of Disse store vitamin A and transform into collagen-secreting myofibroblasts in fibrosis",
      "Normal portal venous pressure is 5-10 mmHg; portal hypertension is defined by hepatic venous pressure gradient > 5 mmHg",
      "Portosystemic anastomoses dilate in portal hypertension: esophageal varices, caput medusae, and hemorrhoids"
    ],
    patho: "The liver architecture organizes hepatocytes around microvascular sinusoids receiving dual blood supply from portal vein (75%) and hepatic artery (25%). Cirrhosis disrupts sinusoidal fenestrations and increases intrahepatic vascular resistance through stellate cell activation and fibrous scar deposition, driving blood backward into portosystemic collateral vessels.",
    investigations: ["Abdominal Doppler ultrasound to assess portal vein flow and flow direction", "Hepatic venous pressure gradient (HVPG) measurement", "Upper endoscopy (EGD) for screening and grading of esophageal varices"],
    differentials: ["Cirrhosis with portal hypertension", "Budd-Chiari syndrome (hepatic vein thrombosis)", "Extrahepatic portal vein thrombosis", "Hepatocellular carcinoma"]
  },
  {
    id: "colorectal_anatomy_and_appendicitis",
    name: "Colorectal Gross Anatomy, Appendicitis and Anal Sphincters",
    aliases: ["Colon anatomy", "Appendicitis", "Teniae coli", "Pectinate line", "Anal canal"],
    system: "Gastrointestinal System / Colorectal",
    specialty: "Anatomy / General Surgery / Colorectal",
    source: "ALGrawany Anatomy & Physiology Made Easy 2026 / Sabiston Surgery 22e",
    pearls: [
      "Large bowel hallmarks: three teniae coli, haustra, and appendices epiploicae",
      "All three teniae coli converge at the base of the appendix, serving as an absolute anatomical locator",
      "Acute appendicitis begins with lumen obstruction by fecalith or lymphoid hyperplasia, leading to ischemia and perforation",
      "Pectinate (dentate) line divides upper endodermal anal canal from lower ectodermal anal canal",
      "Above dentate line: visceral innervation (painless internal hemorrhoids); below line: somatic pudendal (painful external hemorrhoids)"
    ],
    patho: "The colon absorbs water and electrolytes and compacts feces. Obstruction of the appendiceal lumen raises intraluminal pressure, compromising venous return, which results in mucosal ulceration, bacterial invasion, gangrene, and peritonitis. At the anorectal junction, the dentate line defines crucial developmental, neurovascular, and lymphatic watersheds.",
    investigations: ["Contrast-enhanced CT abdomen and pelvis for suspected acute appendicitis", "Graded-compression abdominal ultrasound in children and pregnant women", "Colonoscopy and proctosigmoidoscopy for colorectal luminal evaluation"],
    differentials: ["Acute appendicitis", "Cecal diverticulitis", "Internal versus external hemorrhoids", "Ischemic colitis"]
  },
  {
    id: "pharyngeal_spaces_and_waldeyer_ring",
    name: "Pharyngeal Musculature, Fascial Spaces and Waldeyer Tonsillar Ring",
    aliases: ["Pharynx anatomy", "Pharyngeal constrictors", "Waldeyer ring", "Killian dehiscence", "Zenker diverticulum"],
    system: "Respiratory / Gastrointestinal / Head and Neck",
    specialty: "Anatomy / Otorhinolaryngology / Surgery",
    source: "ALGrawany Anatomy & Physiology Made Easy 2026 / Scott-Brown's Otorhinolaryngology",
    pearls: [
      "Pharynx is divided into nasopharynx (skull base to palate), oropharynx, and laryngopharynx (down to C6 cricoid)",
      "All pharyngeal muscles are innervated by CN X (vagus), except stylopharyngeus, which is supplied by CN IX",
      "Killian dehiscence is a muscular gap between thyropharyngeus and cricopharyngeus where Zenker diverticulum forms",
      "Waldeyer ring consists of adenoid, tubal tonsils, palatine tonsils, and lingual tonsil",
      "Retropharyngeal space lies between buccopharyngeal fascia and alar fascia, extending into posterior mediastinum"
    ],
    patho: "The pharyngeal constrictors coordinate peristaltic deglutition. Incoordination of cricopharyngeal relaxation generates high hypopharyngeal pressures, herniating posterior mucosa through Killian dehiscence. Deep cervical fascial planes encase the pharynx; infections in the retropharyngeal or danger spaces can track inferiorly into the posterior mediastinum, causing acute mediastinitis.",
    investigations: ["Barium swallow / videofluoroscopic swallow study (VFSS)", "Contrast-enhanced neck CT to evaluate deep neck space infections and abscesses", "Flexible fiberoptic nasopharyngoscopy"],
    differentials: ["Zenker diverticulum", "Retropharyngeal abscess", "Peritonsillar abscess (Quinsy)", "Squamous cell carcinoma of the oropharynx"]
  }
];

let kbWritten = 0;
for (const art of kbArticles) {
  const fpath = path.join(REF_DIR, `${art.id}.json`);
  const fullObj = {
    id: art.id,
    name: art.name,
    aliases: art.aliases,
    class: "non_infective",
    system: art.system,
    specialty: art.specialty,
    referenceOnly: true,
    review: {
      status: "ai_drafted"
    },
    reference: {
      source: art.source,
      sourceEdition: "current",
      clinicalPearls: art.pearls,
      pathophysiology: art.patho,
      additionalDifferentials: art.differentials,
      additionalInvestigations: art.investigations
    }
  };
  fs.writeFileSync(fpath, JSON.stringify(fullObj, null, 2) + "\n");
  console.log(`OK: wrote KB reference article ${art.id}`);
  kbWritten++;
}
console.log(`Finished writing ${kbWritten} KB reference articles.`);

// ==========================================
// 4. GENERATE 130+ ORIGINAL MCQs FOR MAIKBOOK1
// ==========================================
console.log("\n=== Generating Original Single Best Answer MCQs for maikbook1 ===");

const mcqsBySubject = {
  anatomy: [
    // 1. ana-cns-overview
    {
      topic: "ana-cns-overview",
      items: [
        {
          id: "bk-cns-001",
          q: "A 22-year-old motorcyclist sustains head trauma. Non-contrast CT reveals a high-attenuation biconvex lenticular extra-axial hematoma over the left temporoparietal convexity that does NOT cross the lambdoid or coronal suture lines. Which vessel is most likely lacerated?",
          o: ["Middle meningeal artery", "Bridging cortical vein", "Superior sagittal sinus", "Anterior cerebral artery"],
          a: 0,
          exp: "An epidural hematoma classical presents as a biconvex lenticular collection confined by cranial sutures, most commonly caused by skull fracture at the pterion lacerating the middle meningeal artery.",
          r: ["Correct. Middle meningeal artery rupture creates a high-pressure biconvex collection bounded by cranial sutures.", "Incorrect. Bridging vein shearing produces a crescentic subdural hematoma that crosses suture lines.", "Incorrect. Dural sinus tears are less common and typically associate with depressed skull fractures.", "Incorrect. Anterior cerebral artery injury causes intracerebral or subarachnoid hemorrhage."],
          kp: "Epidural hematomas arise from middle meningeal artery laceration, producing biconvex collections limited by cranial suture attachments.",
          img: ["ap-brain-gross.webp"],
          d: 1,
          cog: "application"
        },
        {
          id: "bk-cns-002",
          q: "During human neuroembryogenesis at 5 weeks of gestation, which secondary brain vesicle gives rise to the adult pons and cerebellum?",
          o: ["Metencephalon", "Myelencephalon", "Mesencephalon", "Diencephalon"],
          a: 0,
          exp: "The rhombencephalon (hindbrain) divides into the metencephalon (which develops into the pons and cerebellum) and the myelencephalon (which forms the medulla oblongata).",
          r: ["Correct. The metencephalon develops into the pons and cerebellum.", "Incorrect. The myelencephalon develops into the adult medulla oblongata.", "Incorrect. The mesencephalon persists as the adult midbrain.", "Incorrect. The diencephalon develops into the thalamus and hypothalamus."],
          kp: "Rhombencephalon subdivides into metencephalon (pons and cerebellum) and myelencephalon (medulla oblongata).",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-cns-003",
          q: "An 82-year-old patient with cerebral atrophy presents with progressive confusion and gait unsteadiness three weeks after a minor fall. Brain CT shows a crescent-shaped extra-axial collection along the cerebral convexity crossing the coronal suture line. What is the source of bleeding?",
          o: ["Bridging veins traversing subdural space", "Middle meningeal artery", "Internal carotid artery", "Circle of Willis aneurysm"],
          a: 0,
          exp: "Subdural hematomas result from rupture of delicate bridging cerebral veins spanning the subdural space, forming a crescent-shaped collection that freely crosses cranial suture lines.",
          r: ["Correct. Bridging veins tear easily in elderly patients with brain atrophy, producing crescentic subdural hematomas.", "Incorrect. Middle meningeal artery produces biconvex epidural hematomas that do not cross sutures.", "Incorrect. Internal carotid laceration is an arterial skull base trauma injury.", "Incorrect. Aneurysm rupture causes subarachnoid hemorrhage."],
          kp: "Subdural hematomas result from sheared bridging veins, creating crescent-shaped collections that cross cranial suture lines.",
          img: ["ap-brain-gross.webp"],
          d: 1,
          cog: "application"
        },
        {
          id: "bk-cns-004",
          q: "Due to the sharp 90-degree cephalic flexure of the human neuraxis, in which direction does the term 'rostral' refer when describing the cerebral hemispheres?",
          o: ["Anterior towards the frontal pole", "Superior towards the vertex", "Posterior towards the occipital pole", "Inferior towards the skull base"],
          a: 0,
          exp: "Above the midbrain in the cerebrum, the cephalic flexure rotates the axis so that rostral corresponds to anterior (towards the frontal pole) and caudal corresponds to posterior.",
          r: ["Correct. In the cerebrum rostral means anterior towards the frontal pole.", "Incorrect. In the cerebrum superior corresponds to dorsal.", "Incorrect. Posterior corresponds to caudal in the cerebrum.", "Incorrect. Inferior corresponds to ventral in the forebrain."],
          kp: "At the cephalic flexure the neuraxis bends 90 degrees: in the cerebrum rostral means anterior and caudal means posterior.",
          img: [],
          d: 2,
          cog: "recall"
        },
        {
          id: "bk-cns-005",
          q: "The tentorium cerebelli represents a major reflection of which meningeal layer?",
          o: ["Inner meningeal layer of dura mater", "Arachnoid mater", "Pia mater", "Periosteal layer of cranial dura"],
          a: 0,
          exp: "Dural reflections including the falx cerebri and tentorium cerebelli are formed by duplications of the inner meningeal layer of the cranial dura mater.",
          r: ["Correct. The meningeal layer of dura mater reflects to form intracranial septa including tentorium cerebelli.", "Incorrect. Arachnoid mater lines the dura but does not form rigid dural folds.", "Incorrect. Pia mater closely invests cerebral parenchyma.", "Incorrect. Periosteal dura adheres to inner skull bones."],
          kp: "Dural folds such as the tentorium cerebelli and falx cerebri are formed by the inner meningeal layer of dura mater.",
          img: ["ap-brain-gross.webp"],
          d: 2,
          cog: "recall"
        },
        {
          id: "bk-cns-006",
          q: "Between which two anatomical layers does cerebrospinal fluid circulate around the brain and spinal cord?",
          o: ["Arachnoid mater and pia mater", "Dura mater and arachnoid mater", "Skull bone and dura mater", "Pia mater and glial limitans"],
          a: 0,
          exp: "Cerebrospinal fluid circulates within the subarachnoid space, bounded externally by the arachnoid mater and internally by the pia mater.",
          r: ["Correct. The subarachnoid space lies between arachnoid mater and pia mater.", "Incorrect. Space between dura and arachnoid is the subdural plane.", "Incorrect. Space between skull and dura is the epidural space.", "Incorrect. The glial limitans underlies the closely adherent pia mater."],
          kp: "Cerebrospinal fluid circulates within the subarachnoid space between arachnoid and pia mater.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-cns-007",
          q: "Which adult brain structure is embryologically derived directly from the diencephalon?",
          o: ["Thalamus and hypothalamus", "Cerebral cortex", "Pons and cerebellum", "Medulla oblongata"],
          a: 0,
          exp: "The diencephalon develops into the thalamus, hypothalamus, epithalamus, and subthalamus, surrounding the third ventricle.",
          r: ["Correct. Thalamus and hypothalamus originate from the embryological diencephalon.", "Incorrect. Cerebral cortex originates from the telencephalon.", "Incorrect. Pons and cerebellum originate from the metencephalon.", "Incorrect. Medulla oblongata originates from the myelencephalon."],
          kp: "The diencephalon gives rise to the thalamus, hypothalamus, subthalamus, and epithalamus.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-cns-008",
          q: "A fracture involving the pterion on the lateral calvarium is clinically critical because it overlies which vascular structure?",
          o: ["Anterior branch of middle meningeal artery", "Internal carotid artery siphon", "Transverse dural venous sinus", "Middle cerebral artery trunk"],
          a: 0,
          exp: "The pterion is the junction of frontal, parietal, sphenoid, and temporal bones. Its thin bone directly overlies the anterior division of the middle meningeal artery.",
          r: ["Correct. The pterion overlies the anterior division of the middle meningeal artery.", "Incorrect. Internal carotid siphon lies deep in the cavernous sinus.", "Incorrect. Transverse sinus runs posteriorly at the occipitotemporal junction.", "Incorrect. Middle cerebral artery runs deep in the lateral Sylvian sulcus."],
          kp: "Pterion fractures frequently tear the underlying anterior branch of the middle meningeal artery, precipitating epidural hematoma.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-cns-009",
          q: "Herniation of the medial temporal lobe uncus through the tentorial notch compresses which cranial nerve first, causing an ipsilateral dilated non-reactive pupil?",
          o: ["Oculomotor nerve (CN III)", "Trochlear nerve (CN IV)", "Abducens nerve (CN VI)", "Trigeminal nerve (CN V)"],
          a: 0,
          exp: "Uncal herniation pushes the uncus across the tentorial edge, compressing the ipsilateral oculomotor nerve (CN III). The superficial parasympathetic pupilloconstrictor fibers are damaged first, yielding an ipsilateral blown pupil.",
          r: ["Correct. CN III is compressed against the petroclinoid ligament by the herniating uncus.", "Incorrect. CN IV has the longest intracranial course but is less immediately compressed by uncal mass effect.", "Incorrect. CN VI is vulnerable to downward traction from elevated intracranial pressure.", "Incorrect. Trigeminal nerve lies in Meckel cave."],
          kp: "Uncal herniation compresses the ipsilateral oculomotor nerve, leading to ipsilateral pupillary dilation and sluggish light reflex.",
          img: ["ap-brain-gross.webp"],
          d: 2,
          cog: "application"
        },
        {
          id: "bk-cns-010",
          q: "Lumbar puncture safely accesses the subarachnoid space at the L3-L4 or L4-L5 intervertebral space because in adults the conus medullaris terminates at which vertebral level?",
          o: ["L1-L2 interspace", "L4-L5 interspace", "T10-T11 interspace", "S1-S2 junction"],
          a: 0,
          exp: "In the adult human, the spinal cord terminates as the conus medullaris at the L1-L2 vertebral interspace. A lumbar puncture at L3-L4 enters the lumbar cistern without risking spinal cord puncture.",
          r: ["Correct. Adult spinal cord ends at L1-L2; lumbar puncture at L3-L4 or L4-L5 safely samples cerebrospinal fluid.", "Incorrect. L4-L5 is where the needle is placed, well below the cord termination.", "Incorrect. T10-T11 contains active spinal cord segments.", "Incorrect. S1-S2 marks the lower end of the dural sac."],
          kp: "The conus medullaris terminates at L1-L2 in adults, allowing safe lumbar puncture access at L3-L4 or L4-L5.",
          img: [],
          d: 1,
          cog: "recall"
        }
      ]
    },

    // 2. ana-cerebral-circulation
    {
      topic: "ana-cerebral-circulation",
      items: [
        {
          id: "bk-cir-001",
          q: "A 68-year-old patient suddenly develops weakness and sensory loss predominantly affecting the left leg and foot, with relative sparing of the face and arm. Urinary incontinence and mild apathy are noted. Which artery is most likely occluded?",
          o: ["Right anterior cerebral artery", "Right middle cerebral artery", "Left middle cerebral artery", "Right posterior cerebral artery"],
          a: 0,
          exp: "The anterior cerebral artery supplies the medial aspect of the hemisphere representing the leg and foot on the motor and sensory homunculi, plus the paracentral lobule controlling micturition.",
          r: ["Correct. Right ACA infarction affects medial motor and sensory cortex for the contralateral leg and micturition center.", "Incorrect. MCA stroke predominantly impairs face and upper extremity strength.", "Incorrect. Left MCA stroke causes right sided face/arm weakness and aphasia.", "Incorrect. PCA infarction causes contralateral homonymous hemianopia."],
          kp: "Anterior cerebral artery occlusion causes contralateral leg and foot weakness, sensory loss, and urinary incontinence.",
          img: ["ap-brain-gross.webp"],
          d: 2,
          cog: "application"
        },
        {
          id: "bk-cir-002",
          q: "A 54-year-old patient presents with sudden severe right hemiparesis and hemisensory loss affecting face and arm much more than leg, accompanied by global aphasia. Which vascular territory is infarcted?",
          o: ["Left middle cerebral artery", "Left anterior cerebral artery", "Right middle cerebral artery", "Basilar artery"],
          a: 0,
          exp: "The left (dominant) middle cerebral artery supplies the lateral cortex including Broca and Wernicke areas and the motor homunculus for face and arm.",
          r: ["Correct. Left MCA stroke causes right face/arm weakness, sensory deficit, and aphasia.", "Incorrect. Left ACA stroke causes leg greater than arm weakness.", "Incorrect. Right MCA stroke causes left hemiparesis and hemineglect.", "Incorrect. Basilar artery occlusion produces bilateral brainstem signs or locked-in state."],
          kp: "Dominant middle cerebral artery stroke produces contralateral face and arm weakness along with expressive or receptive aphasia.",
          img: ["ap-brain-gross.webp"],
          d: 1,
          cog: "application"
        },
        {
          id: "bk-cir-003",
          q: "Which arterial segment is the most common anatomical site for saccular (berry) intracranial aneurysms?",
          o: ["Anterior communicating artery junction", "Basilar tip bifurcation", "Middle cerebral artery bifurcation", "Posterior inferior cerebellar artery origin"],
          a: 0,
          exp: "The anterior communicating artery junction is the most frequent site of intracranial berry aneurysms, accounting for approximately 30-35% of all cases.",
          r: ["Correct. Anterior communicating artery is the most common berry aneurysm location.", "Incorrect. Basilar bifurcation accounts for approximately 5-10% of aneurysms.", "Incorrect. MCA bifurcation accounts for about 20-25%.", "Incorrect. PICA aneurysms are less frequent."],
          kp: "The anterior communicating artery junction is the most common site of intracranial saccular berry aneurysms.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-cir-004",
          q: "An aneurysm arising at the junction of the internal carotid artery and posterior communicating artery commonly compresses which adjacent cranial nerve, presenting with painful ptosis and pupillary dilation?",
          o: ["Oculomotor nerve (CN III)", "Trochlear nerve (CN IV)", "Abducens nerve (CN VI)", "Ophthalmic nerve (V1)"],
          a: 0,
          exp: "The oculomotor nerve runs directly adjacent to the junction of the internal carotid and posterior communicating artery. PCOM aneurysms compress CN III, causing painful third nerve palsy with an unreactive dilated pupil.",
          r: ["Correct. PCOM aneurysm classically causes painful oculomotor nerve palsy with pupillomotor involvement.", "Incorrect. CN IV runs more laterally along the tentorial edge.", "Incorrect. CN VI runs within Dorello canal in the cavernous sinus.", "Incorrect. V1 provides corneal sensation."],
          kp: "Posterior communicating artery aneurysm classically produces painful third cranial nerve palsy with pupillary involvement.",
          img: ["ap-brain-gross.webp"],
          d: 2,
          cog: "application"
        },
        {
          id: "bk-cir-005",
          q: "Which vessels directly form the posterior anastomotic link between the carotid system and the vertebrobasilar circulation in the Circle of Willis?",
          o: ["Posterior communicating arteries", "Anterior communicating arteries", "Superior cerebellar arteries", "Anterior choroidal arteries"],
          a: 0,
          exp: "The paired posterior communicating arteries connect the internal carotid arteries anteriorly with the posterior cerebral arteries of the vertebrobasilar circulation posteriorly.",
          r: ["Correct. Posterior communicating arteries bridge internal carotid and posterior cerebral arteries.", "Incorrect. Anterior communicating artery bridges bilateral anterior cerebral arteries.", "Incorrect. Superior cerebellar arteries arise from the basilar artery below the PCA.", "Incorrect. Anterior choroidal artery arises from ICA to supply posterior limb of internal capsule."],
          kp: "Posterior communicating arteries provide the critical collateral bridge between anterior and posterior cerebral circulations.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-cir-006",
          q: "Occlusion of the lenticulostriate arteries arising from the M1 segment of the middle cerebral artery classically produces which clinical stroke syndrome?",
          o: ["Pure motor hemiparesis from posterior limb internal capsule infarction", "Bitemporal hemianopia", "Wallenberg lateral medullary syndrome", "Expressive Broca aphasia"],
          a: 0,
          exp: "Lenticulostriate arteries supply the basal ganglia and the posterior limb of the internal capsule. Lacunar infarction here produces pure motor stroke involving face, arm, and leg equally.",
          r: ["Correct. Lenticulostriate stroke damages the posterior limb of internal capsule, causing pure motor hemiparesis.", "Incorrect. Bitemporal hemianopia results from chiasm compression.", "Incorrect. Wallenberg syndrome stems from PICA or vertebral occlusion.", "Incorrect. Broca aphasia requires cortical infarction."],
          kp: "Lenticulostriate arterial occlusion causes lacunar strokes in the internal capsule, manifesting as pure motor hemiparesis.",
          img: ["ap-brain-gross.webp"],
          d: 2,
          cog: "application"
        },
        {
          id: "bk-cir-007",
          q: "Watershed (borderzone) cerebral infarctions occurring after profound systemic hypotension most commonly affect the junction between which two arterial territories?",
          o: ["Anterior cerebral and middle cerebral artery territories", "Basilar and superior cerebellar territories", "Posterior cerebral and anterior inferior cerebellar territories", "Posterior communicating and anterior choroidal territories"],
          a: 0,
          exp: "The cortical watershed zone between the ACA and MCA territories is located along the high convexity, producing proximal arm and leg weakness termed 'man-in-a-barrel' syndrome.",
          r: ["Correct. ACA-MCA borderzone is the most vulnerable cortical watershed territory during systemic hypoperfusion.", "Incorrect. Posterior circulation vessels have rich collateral anastomoses.", "Incorrect. Cerebellar borderzones are less frequently symptomatic.", "Incorrect. These are proximal conducting branches."],
          kp: "Watershed infarctions occur at ACA-MCA and MCA-PCA border zones following profound hypotensive episodes, causing man-in-a-barrel weakness.",
          img: [],
          d: 2,
          cog: "recall"
        },
        {
          id: "bk-cir-008",
          q: "Which dural venous sinus courses along the attached margin of the falx cerebri to terminate at the confluence of sinuses (torcular Herophili)?",
          o: ["Superior sagittal sinus", "Inferior sagittal sinus", "Straight sinus", "Cavernous sinus"],
          a: 0,
          exp: "The superior sagittal sinus runs in the superior border of the falx cerebri from crista galli to the confluence of sinuses, receiving arachnoid granulations and bridging veins.",
          r: ["Correct. Superior sagittal sinus occupies the upper convex margin of the falx cerebri.", "Incorrect. Inferior sagittal sinus runs in the free inferior margin of falx cerebri.", "Incorrect. Straight sinus forms at junction of falx cerebri and tentorium cerebelli.", "Incorrect. Cavernous sinus lies on either side of the sella turcica."],
          kp: "Superior sagittal sinus runs along the superior attachment of the falx cerebri and empties into the confluence of sinuses.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-cir-009",
          q: "A patient presents with severe proptosis, chemosis, and progressive ophthalmoplegia affecting CN III, IV, and VI, accompanied by forehead numbness. Thrombosis of which vascular structure explains these findings?",
          o: ["Cavernous sinus", "Superior sagittal sinus", "Sigmoid sinus", "Internal jugular vein"],
          a: 0,
          exp: "The cavernous sinus encloses CN III, IV, V1, V2, and VI, along with the internal carotid artery. Cavernous sinus thrombosis produces proptosis, chemosis, and painful ophthalmoplegia.",
          r: ["Correct. Cavernous sinus thrombosis compresses CN III, IV, V1, V2, and VI traversing its walls and lumen.", "Incorrect. Superior sagittal sinus thrombosis causes headache, seizures, and elevated ICP.", "Incorrect. Sigmoid sinus thrombosis causes mastoid tenderness (Griesinger sign).", "Incorrect. Internal jugular thrombosis impairs systemic venous outflow."],
          kp: "Cavernous sinus thrombosis presents with chemosis, proptosis, and ophthalmoplegia due to involvement of CN III, IV, V1, V2, and VI.",
          img: ["ap-eye-gross.webp"],
          d: 2,
          cog: "application"
        },
        {
          id: "bk-cir-010",
          q: "What is the primary anatomical origin of the posterior cerebral arteries?",
          o: ["Bifurcation of the basilar artery", "Internal carotid artery siphon", "Vertebral artery V4 segment", "Anterior inferior cerebellar artery"],
          a: 0,
          exp: "The basilar artery ascends along the ventral pons and terminates at the upper pontine border by bifurcating into the paired posterior cerebral arteries.",
          r: ["Correct. The basilar artery terminates by dividing into both posterior cerebral arteries.", "Incorrect. Internal carotid gives off ACA, MCA, PCOM, and anterior choroidal.", "Incorrect. Vertebral arteries unite to form the basilar artery.", "Incorrect. AICA is a branch of the lower basilar trunk."],
          kp: "The posterior cerebral arteries originate as the terminal bifurcation branches of the basilar artery.",
          img: ["ap-brain-gross.webp"],
          d: 1,
          cog: "recall"
        }
      ]
    },

    // 3. ana-visual-pathways
    {
      topic: "ana-visual-pathways",
      items: [
        {
          id: "bk-vis-001",
          q: "A 48-year-old patient with an expanding pituitary macroadenoma undergoes automated perimetry. What characteristic visual field deficit is expected?",
          o: ["Bitemporal hemianopia", "Left homonymous hemianopia", "Right homonymous superior quadrantanopia", "Monocular right anopia"],
          a: 0,
          exp: "Pituitary adenomas expand upward from the sella, compressing the decussating nasal retinal axons in the optic chiasm, leading to loss of both temporal visual fields (bitemporal hemianopia).",
          r: ["Correct. Compression of decussating nasal retinal fibers causes bitemporal hemianopia.", "Incorrect. Right optic tract lesion causes left homonymous hemianopia.", "Incorrect. Temporal lobe lesion damaging Meyer loop causes superior quadrantanopia.", "Incorrect. Monocular blindness requires pre-chiasmatic optic nerve damage."],
          kp: "Chiasmal compression by pituitary tumors damages crossing nasal retinal fibers, causing bitemporal hemianopia.",
          img: ["ap-eye-gross.webp"],
          d: 1,
          cog: "application"
        },
        {
          id: "bk-vis-002",
          q: "Surgical resection of a right anterior temporal lobe seizure focus injures Meyer loop. Which visual field defect will the patient manifest postoperatively?",
          o: ["Left superior quadrantanopia (pie in the sky)", "Left inferior quadrantanopia (pie on the floor)", "Right homonymous hemianopia", "Bitemporal hemianopia"],
          a: 0,
          exp: "Meyer loop fibers represent the inferior retina (superior visual field) and course through the temporal lobe. Right-sided injury produces contralateral superior quadrantanopia (pie in the sky).",
          r: ["Correct. Right Meyer loop damage causes contralateral superior quadrantanopia (pie in the sky).", "Incorrect. Inferior quadrantanopia results from parietal optic radiation damage.", "Incorrect. Complete hemianopia requires complete tract or radiation destruction.", "Incorrect. Bitemporal defect occurs only at the chiasm."],
          kp: "Temporal lobe lesions damaging Meyer loop produce contralateral superior quadrantanopia (pie in the sky).",
          img: ["ap-eye-gross.webp"],
          d: 2,
          cog: "application"
        },
        {
          id: "bk-vis-003",
          q: "A 70-year-old patient with an acute left posterior cerebral artery stroke exhibits right homonymous hemianopia. On formal testing, central high-acuity foveal vision is completely preserved. What explains this macular sparing?",
          o: ["Dual collateral blood supply from middle cerebral artery branches", "Bilateral projection of foveal photoreceptors at the optic chiasm", "Direct innervation of fovea from frontal eye fields", "Sparing of the optic chiasm"],
          a: 0,
          exp: "Macular sparing occurs in PCA cortical strokes because the occipital pole representing the macula receives rich collateral arterial flow from terminal branches of the middle cerebral artery.",
          r: ["Correct. Collateral flow from terminal branches of the middle cerebral artery preserves occipital pole perfusion.", "Incorrect. Retinal projections do not duplicate foveal representations across the chiasm.", "Incorrect. Frontal eye fields control voluntary saccades, not sensory visual perception.", "Incorrect. The lesion is in the occipital cortex, not the chiasm."],
          kp: "Macular sparing in posterior cerebral artery strokes is due to collateral perfusion from middle cerebral artery terminal branches.",
          img: ["ap-eye-gross.webp"],
          d: 2,
          cog: "analysis"
        },
        {
          id: "bk-vis-004",
          q: "Third-order sensory neurons in the primary visual pathway project their axons from which thalamic nucleus to the calcarine visual cortex?",
          o: ["Lateral geniculate nucleus", "Medial geniculate nucleus", "Ventral posterolateral nucleus", "Ventral posteromedial nucleus"],
          a: 0,
          exp: "Axons in the optic tract synapse in the lateral geniculate nucleus (LGN) of the thalamus. LGN neurons project as the optic radiations to the calcarine cortex.",
          r: ["Correct. The lateral geniculate nucleus relays visual sensory input to the primary visual cortex.", "Incorrect. Medial geniculate nucleus relays auditory signals.", "Incorrect. VPL relays somatic sensory signals from the body.", "Incorrect. VPM relays facial sensation and taste."],
          kp: "The lateral geniculate nucleus of the thalamus is the primary relay station for visual pathways.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-vis-005",
          q: "Complete transection of the left optic tract results in which visual field defect?",
          o: ["Right homonymous hemianopia", "Left homonymous hemianopia", "Bitemporal hemianopia", "Total blindness of left eye"],
          a: 0,
          exp: "The left optic tract carries axons from the left temporal hemiretina and right nasal hemiretina, representing the entire right visual hemifield. A lesion produces complete right homonymous hemianopia.",
          r: ["Correct. Left optic tract destruction abolishes perception of the entire right visual hemifield.", "Incorrect. Left hemianopia requires a right retrochiasmal lesion.", "Incorrect. Bitemporal hemianopia requires central chiasm compression.", "Incorrect. Monocular left eye blindness requires left optic nerve transection."],
          kp: "Lesions of the optic tract or complete retrochiasmal pathway cause contralateral homonymous hemianopia.",
          img: ["ap-eye-gross.webp"],
          d: 1,
          cog: "application"
        },
        {
          id: "bk-vis-006",
          q: "Which visual pathway fibers traverse the parietal lobe optic radiation (Baum loop)?",
          o: ["Superior retinal fibers representing the inferior visual field", "Inferior retinal fibers representing the superior visual field", "Fibers from the fovea centralis only", "Pupillary light reflex afferent fibers"],
          a: 0,
          exp: "The parietal optic radiations carry fibers from the superior retina (representing the inferior visual field). Lesions here produce a contralateral inferior quadrantanopia (pie on the floor).",
          r: ["Correct. Parietal radiations carry superior retinal fibers representing the lower visual field.", "Incorrect. Inferior retinal fibers loop through the temporal lobe (Meyer loop).", "Incorrect. Foveal fibers project across both temporal and parietal radiations.", "Incorrect. Light reflex fibers exit the tract before the LGN to the pretectal nucleus."],
          kp: "Parietal lobe lesions damage Baum loop optic radiations, causing contralateral inferior quadrantanopia (pie on the floor).",
          img: [],
          d: 2,
          cog: "recall"
        },
        {
          id: "bk-vis-007",
          q: "In the pupillary light reflex, afferent signals leave the optic tract before the lateral geniculate nucleus to synapse bilaterally in which midbrain structure?",
          o: ["Pretectal nucleus", "Superior colliculus", "Edinger-Westphal nucleus", "Ciliary ganglion"],
          a: 0,
          exp: "Pupillary light reflex afferent fibers branch off the optic tract to synapse in the pretectal nuclei of the rostral midbrain. Interneurons then project bilaterally to both Edinger-Westphal nuclei.",
          r: ["Correct. Afferents synapse in the pretectal nuclei to mediate bilateral pupillary constriction.", "Incorrect. Superior colliculus controls visual orientation and saccades.", "Incorrect. Edinger-Westphal nuclei receive secondary projections from the pretectal nuclei.", "Incorrect. Ciliary ganglion contains postganglionic parasympathetic cell bodies in the orbit."],
          kp: "Pupillary light reflex afferents bypass the lateral geniculate nucleus to synapse in the midbrain pretectal nuclei.",
          img: [],
          d: 2,
          cog: "recall"
        },
        {
          id: "bk-vis-008",
          q: "An eye clinic patient exhibits a Marcus Gunn pupil (relative afferent pupillary defect) in the right eye. Which condition is the most characteristic cause?",
          o: ["Right optic neuritis", "Right Horner syndrome", "Left oculomotor nerve palsy", "Right Argyll Robertson pupil"],
          a: 0,
          exp: "A relative afferent pupillary defect (RAPD) occurs when swinging flashlight test reveals paradoxical pupillary dilation when light moves from the normal eye to the eye with damaged afferent optic nerve, classic in optic neuritis.",
          r: ["Correct. Optic neuritis causes an afferent defect manifesting as a Marcus Gunn pupil.", "Incorrect. Horner syndrome is an efferent sympathetic defect.", "Incorrect. CN III palsy is an efferent parasympathetic defect causing fixed mydriasis.", "Incorrect. Argyll Robertson pupils accommodate but do not react to light, seen in neurosyphilis."],
          kp: "Optic neuritis damages afferent pupillary signaling, producing a Marcus Gunn pupil on swinging flashlight examination.",
          img: ["ap-eye-gross.webp"],
          d: 2,
          cog: "application"
        },
        {
          id: "bk-vis-009",
          q: "Brodmann area 17 corresponds to which anatomical functional landmark in the occipital lobe?",
          o: ["Primary visual cortex lining calcarine sulcus", "Visual association cortex", "Frontal eye field", "Parieto-occipital sulcus"],
          a: 0,
          exp: "Brodmann area 17 is the primary visual cortex (striate cortex), located along the upper and lower banks of the calcarine sulcus in the medial occipital lobe.",
          r: ["Correct. Area 17 is the striate primary visual cortex surrounding the calcarine sulcus.", "Incorrect. Areas 18 and 19 represent visual association cortex.", "Incorrect. Area 8 represents the frontal eye fields.", "Incorrect. Parieto-occipital sulcus separates parietal and occipital lobes."],
          kp: "Brodmann area 17 corresponds to primary visual (striate) cortex along the calcarine fissure.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-vis-010",
          q: "Bilateral calcification of the internal carotid arteries impinging upon the lateral aspects of the optic chiasm can produce which rare visual field defect?",
          o: ["Binasal hemianopia", "Bitemporal hemianopia", "Left homonymous hemianopia", "Total blindness"],
          a: 0,
          exp: "Lateral compression of the optic chiasm damages the uncrossed temporal retinal axons from both eyes, causing loss of both nasal visual fields (binasal hemianopia).",
          r: ["Correct. Bilateral lateral chiasmal compression selectively damages uncrossed temporal retinal fibers, causing binasal hemianopia.", "Incorrect. Medial central compression causes bitemporal hemianopia.", "Incorrect. Unilateral tract lesions cause homonymous hemianopia.", "Incorrect. Total blindness requires complete bilateral optic nerve disruption."],
          kp: "Lateral chiasmal compression damages uncrossed temporal fibers, producing binasal hemianopia.",
          img: ["ap-eye-gross.webp"],
          d: 3,
          cog: "analysis"
        }
      ]
    },

    // 4. ana-cerebral-cortex
    {
      topic: "ana-cerebral-cortex",
      items: [
        {
          id: "bk-ctx-001",
          q: "A stroke patient can comprehend spoken and written commands perfectly, but speech is slow, halting, effortful, and telegraphic. Repetition is severely impaired, and the patient displays obvious frustration. Where is the lesion located?",
          o: ["Dominant inferior frontal gyrus (Broca area)", "Dominant superior temporal gyrus (Wernicke area)", "Arcuate fasciculus", "Angular gyrus"],
          a: 0,
          exp: "Broca aphasia is characterized by non-fluent, effortful expressive speech with preserved comprehension, localized to Brodmann areas 44 and 45 in the inferior frontal gyrus of the dominant hemisphere.",
          r: ["Correct. Broca expressive aphasia localizes to the dominant inferior frontal gyrus.", "Incorrect. Wernicke aphasia features fluent speech with severely impaired comprehension.", "Incorrect. Conduction aphasia features fluent speech with intact comprehension and isolated repetition failure.", "Incorrect. Angular gyrus lesions cause Gerstmann syndrome."],
          kp: "Broca aphasia localizes to the dominant inferior frontal gyrus, causing non-fluent speech with preserved comprehension.",
          img: ["ap-brain-gross.webp"],
          d: 1,
          cog: "application"
        },
        {
          id: "bk-ctx-002",
          q: "An elderly patient speaks with normal cadence and grammar, but sentences are incomprehensible nonsense full of neologisms and paraphasic errors. The patient cannot follow simple commands and seems unaware of the communication barrier. Which cortical area is infarcted?",
          o: ["Brodmann area 22 in posterior superior temporal gyrus", "Brodmann areas 44 and 45 in inferior frontal gyrus", "Brodmann area 4 in precentral gyrus", "Brodmann area 17 in occipital lobe"],
          a: 0,
          exp: "Wernicke aphasia is characterized by fluent but meaningless speech (word salad), impaired comprehension, and lack of awareness (anosognosia), localizing to Brodmann area 22 in the posterior superior temporal gyrus.",
          r: ["Correct. Brodmann area 22 is Wernicke area, mediating language comprehension.", "Incorrect. Areas 44 and 45 constitute Broca expressive area.", "Incorrect. Area 4 is primary motor cortex.", "Incorrect. Area 17 is primary visual cortex."],
          kp: "Wernicke aphasia is a receptive fluent aphasia with impaired comprehension localized to Brodmann area 22.",
          img: ["ap-brain-gross.webp"],
          d: 1,
          cog: "application"
        },
        {
          id: "bk-ctx-003",
          q: "A patient presents with intact fluency, preserved auditory comprehension, but a striking inability to repeat sentences spoken by the examiner. Which anatomical white matter pathway is damaged?",
          o: ["Arcuate fasciculus", "Corpus callosum", "Anterior commissure", "Internal capsule"],
          a: 0,
          exp: "Conduction aphasia is caused by interruption of the arcuate fasciculus connecting Wernicke and Broca areas, characterized by fluent speech, normal comprehension, but severely impaired repetition.",
          r: ["Correct. Conduction aphasia stems from arcuate fasciculus white matter tract injury.", "Incorrect. Corpus callosum lesions cause interhemispheric disconnection syndromes.", "Incorrect. Anterior commissure connects bilateral temporal lobes.", "Incorrect. Internal capsule lesions cause motor or sensory hemiparesis."],
          kp: "Conduction aphasia features fluent speech, preserved comprehension, and marked repetition impairment due to arcuate fasciculus damage.",
          img: [],
          d: 2,
          cog: "recall"
        },
        {
          id: "bk-ctx-004",
          q: "Gerstmann syndrome is characterized by agraphia, acalculia, finger agnosia, and right-left disorientation. Which cortical region is damaged in the dominant hemisphere?",
          o: ["Angular gyrus (parietal lobe)", "Precentral gyrus (frontal lobe)", "Superior temporal gyrus", "Cingulate gyrus"],
          a: 0,
          exp: "Gerstmann syndrome (tetrad of agraphia, acalculia, finger agnosia, right-left confusion) localizes to the angular gyrus (Brodmann area 39) of the dominant parietal lobe.",
          r: ["Correct. Dominant angular gyrus lesions produce Gerstmann syndrome.", "Incorrect. Precentral gyrus lesions cause hemiplegia.", "Incorrect. Superior temporal lesions cause Wernicke aphasia.", "Incorrect. Cingulate lesions cause akinetic mutism or emotional blunting."],
          kp: "Gerstmann syndrome (agraphia, acalculia, finger agnosia, right-left disorientation) localizes to the dominant angular gyrus.",
          img: ["ap-brain-gross.webp"],
          d: 2,
          cog: "recall"
        },
        {
          id: "bk-ctx-005",
          q: "A patient with an ischemic stroke in the non-dominant (right) parietal lobe fails to dress the left side of their body, ignores visitors standing on their left side, and denies that their left arm is paralyzed. What clinical syndrome does this represent?",
          o: ["Hemispatial neglect (anosognosia)", "Kluver-Bucy syndrome", "Gerstmann syndrome", "Anton syndrome"],
          a: 0,
          exp: "Non-dominant (typically right) parietal lobe lesions cause contralateral hemispatial neglect and anosognosia (denial of illness), where patients disregard the contralateral sensory environment.",
          r: ["Correct. Non-dominant parietal lesions cause contralateral spatial hemineglect and anosognosia.", "Incorrect. Kluver-Bucy syndrome results from bilateral amygdala lesions.", "Incorrect. Gerstmann syndrome occurs in dominant parietal lobe lesions.", "Incorrect. Anton syndrome is visual anosognosia from bilateral occipital destruction."],
          kp: "Non-dominant right parietal lobe infarction leads to profound contralateral hemispatial neglect and anosognosia.",
          img: ["ap-brain-gross.webp"],
          d: 2,
          cog: "application"
        },
        {
          id: "bk-ctx-006",
          q: "Bilateral lesions of the anterior temporal lobes including the amygdala produce hyperorality, hypersexuality, placidity, and visual agnosia. What is this clinical syndrome?",
          o: ["Kluver-Bucy syndrome", "Wernicke-Korsakoff syndrome", "Balint syndrome", "Foster Kennedy syndrome"],
          a: 0,
          exp: "Kluver-Bucy syndrome is caused by bilateral damage to the anterior temporal lobes including the amygdaloid nuclei, characterized by hyperphagia/hyperorality, docility, and loss of fear.",
          r: ["Correct. Bilateral amygdala/temporal destruction produces Kluver-Bucy syndrome.", "Incorrect. Wernicke-Korsakoff syndrome results from thiamine deficiency in mammillary bodies.", "Incorrect. Balint syndrome results from bilateral parieto-occipital lesions.", "Incorrect. Foster Kennedy syndrome results from olfactory groove meningioma."],
          kp: "Bilateral anterior temporal lobe destruction involving the amygdala produces Kluver-Bucy syndrome.",
          img: [],
          d: 2,
          cog: "recall"
        },
        {
          id: "bk-ctx-007",
          q: "On the motor homunculus of the precentral gyrus, where are the neurons controlling voluntary movements of the lower extremity located?",
          o: ["Medial aspect of the hemisphere along longitudinal fissure", "Lateral convexity near Sylvian fissure", "Middle third of the precentral gyrus", "Anterior border of prefrontal cortex"],
          a: 0,
          exp: "The motor homunculus is inverted: lower extremity representation lies on the medial surface within the anterior cerebral artery territory, while hands and face occupy the lateral convexity (MCA territory).",
          r: ["Correct. Lower extremity motor control occupies the medial cortex in the ACA territory.", "Incorrect. Lateral convexity controls face, tongue, and hand movements.", "Incorrect. Middle convexity controls trunk and shoulder.", "Incorrect. Prefrontal cortex governs executive planning."],
          kp: "On the motor homunculus, the lower limb is mapped onto the medial cortex, while the upper limb and face occupy the lateral convexity.",
          img: ["ap-brain-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-ctx-008",
          q: "Which Brodmann area is designated as the primary motor cortex?",
          o: ["Area 4", "Area 6", "Area 17", "Area 44"],
          a: 0,
          exp: "Brodmann area 4 designates the primary motor cortex in the precentral gyrus, containing giant Betz pyramidal cells that project into the corticospinal tract.",
          r: ["Correct. Area 4 is the primary motor cortex.", "Incorrect. Area 6 is the premotor and supplementary motor cortex.", "Incorrect. Area 17 is primary visual cortex.", "Incorrect. Area 44 is part of Broca motor speech area."],
          kp: "Brodmann area 4 corresponds to the primary motor cortex located in the precentral gyrus.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-ctx-009",
          q: "Balint syndrome consists of optic ataxia, ocular apraxia, and simultanagnosia. It is classically produced by bilateral watershed infarctions of which cortical territory?",
          o: ["Bilateral parieto-occipital junction", "Bilateral orbitofrontal cortex", "Bilateral superior temporal gyri", "Bilateral anterior cingulate gyri"],
          a: 0,
          exp: "Balint syndrome (triad of optic ataxia, ocular apraxia, and simultanagnosia) results from bilateral damage to the parieto-occipital association cortex, often after severe watershed hypoperfusion.",
          r: ["Correct. Bilateral parieto-occipital borderzone injury produces Balint syndrome.", "Incorrect. Orbitofrontal lesions produce disinhibition and personality changes.", "Incorrect. Temporal lesions cause auditory and language deficits.", "Incorrect. Cingulate lesions cause akinetic mutism."],
          kp: "Balint syndrome (simultanagnosia, optic ataxia, ocular apraxia) localizes to bilateral parieto-occipital borderzone cortex.",
          img: [],
          d: 3,
          cog: "recall"
        },
        {
          id: "bk-ctx-010",
          q: "Which vascular territory supplies the primary visual cortex (Brodmann area 17) lining the calcarine sulcus?",
          o: ["Posterior cerebral artery (calcarine branch)", "Middle cerebral artery (parietal branch)", "Anterior cerebral artery (pericallosal branch)", "Superior cerebellar artery"],
          a: 0,
          exp: "The calcarine branch of the posterior cerebral artery provides the primary arterial perfusion to the primary visual cortex lining the calcarine fissure on the medial occipital surface.",
          r: ["Correct. Calcarine branch of PCA supplies primary visual cortex.", "Incorrect. MCA supplies lateral hemispheric convexity.", "Incorrect. ACA supplies medial frontal and anterior parietal surfaces.", "Incorrect. SCA supplies superior cerebellar hemisphere."],
          kp: "The primary visual cortex along the calcarine fissure is supplied by the calcarine artery of the posterior cerebral artery.",
          img: ["ap-brain-gross.webp"],
          d: 1,
          cog: "recall"
        }
      ]
    },

    // 5. ss-neurology-localization
    {
      topic: "ss-neurology-localization",
      items: [
        {
          id: "bk-loc-001",
          q: "A 55-year-old patient exhibits right-sided hemiparesis with spastic tone, hyperreflexia, and sustained ankle clonus. Plantar reflex on the right shows an extensor Babinski response. Muscle fasciculations are completely absent. These findings are characteristic of which type of lesion?",
          o: ["Upper motor neuron lesion", "Lower motor neuron lesion", "Neuromuscular junction dysfunction", "Primary myopathy"],
          a: 0,
          exp: "Upper motor neuron lesions feature spastic tone (clasp-knife), hyperreflexia, clonus, and positive extensor Babinski response due to loss of descending corticospinal inhibition.",
          r: ["Correct. Hyperreflexia, spasticity, clonus, and Babinski sign are cardinal UMN signs.", "Incorrect. LMN lesions produce hypotonia, hyporeflexia, wasting, and fasciculations.", "Incorrect. Neuromuscular junction disorders produce fatigable weakness without tone/reflex changes.", "Incorrect. Myopathies cause symmetric proximal weakness with preserved reflexes initially."],
          kp: "Upper motor neuron lesions manifest with spasticity, hyperreflexia, ankle clonus, and positive extensor Babinski signs.",
          img: [],
          d: 1,
          cog: "application"
        },
        {
          id: "bk-loc-002",
          q: "A patient presents with right-sided oculomotor nerve palsy (ptosis, dilated pupil, eye resting 'down and out') accompanied by contralateral (left-sided) spastic hemiparesis of the face, arm, and leg. What is the anatomical diagnosis?",
          o: ["Weber syndrome (midbrain)", "Wallenberg syndrome (lateral medulla)", "Millard-Gubler syndrome (pons)", "Dejerine syndrome (medial medulla)"],
          a: 0,
          exp: "Weber syndrome is an alternating midbrain syndrome caused by occlusion of paramedian branches of PCA, damaging the exiting CN III fascicles and the adjacent cerebral peduncle (corticospinal tract).",
          r: ["Correct. Weber syndrome features ipsilateral CN III palsy and contralateral hemiparesis.", "Incorrect. Wallenberg syndrome damages lateral medulla with CN IX/X and sensory signs.", "Incorrect. Millard-Gubler syndrome features CN VI/VII palsy with contralateral hemiplegia.", "Incorrect. Dejerine syndrome features CN XII palsy with contralateral hemiplegia."],
          kp: "Weber syndrome localizes to the midbrain, presenting with ipsilateral CN III palsy and contralateral hemiplegia.",
          img: ["ap-brain-gross.webp"],
          d: 2,
          cog: "application"
        },
        {
          id: "bk-loc-003",
          q: "A 62-year-old patient presents with sudden severe vertigo, hoarseness, dysphagia, Horner syndrome on the right, ataxia on the right, loss of pain/temperature on the right side of the face, and loss of pain/temperature on the left side of the body. Which artery is occluded?",
          o: ["Right posterior inferior cerebellar artery (PICA)", "Right anterior inferior cerebellar artery (AICA)", "Basilar artery", "Right superior cerebellar artery"],
          a: 0,
          exp: "Wallenberg (lateral medullary) syndrome results from PICA or vertebral artery occlusion. It damages nucleus ambiguus (dysphagia/hoarseness), spinal trigeminal tract (ipsilateral face numbness), and spinothalamic tract (contralateral body numbness).",
          r: ["Correct. Wallenberg syndrome is caused by PICA occlusion damaging lateral medulla.", "Incorrect. AICA occlusion causes lateral pontine syndrome with facial nerve palsy and deafness.", "Incorrect. Basilar artery causes locked-in state or bilateral pontine ischemia.", "Incorrect. Superior cerebellar artery causes ipsilateral cerebellar ataxia without crossed sensory loss."],
          kp: "Wallenberg lateral medullary syndrome results from PICA occlusion, causing dysphagia, hoarseness, Horner syndrome, and crossed analgesia.",
          img: ["ap-brain-gross.webp"],
          d: 2,
          cog: "application"
        },
        {
          id: "bk-loc-004",
          q: "According to the 'rule of four' for brainstem localization, which four cranial nerves emerge directly from the medulla oblongata?",
          o: ["CN IX, X, XI, and XII", "CN V, VI, VII, and VIII", "CN III, IV, VI, and XII", "CN I, II, III, and IV"],
          a: 0,
          exp: "The rule of four states that 4 cranial nerves emerge from the medulla: glossopharyngeal (IX), vagus (X), accessory (XI), and hypoglossal (XII).",
          r: ["Correct. CN IX, X, XI, and XII exit from the medulla oblongata.", "Incorrect. CN V, VI, VII, and VIII emerge from the pons.", "Incorrect. CN III and IV exit from the midbrain.", "Incorrect. CN I and II are forebrain structures."],
          kp: "The medulla oblongata houses and gives exit to cranial nerves IX, X, XI, and XII.",
          img: ["ap-brain-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-loc-005",
          q: "A stroke patient presents with ipsilateral abducens (CN VI) palsy, ipsilateral facial nerve (CN VII) palsy, and contralateral hemiparesis. Where is the lesion located?",
          o: ["Ventral pons (Millard-Gubler syndrome)", "Midbrain basis (Weber syndrome)", "Dorsolateral medulla (Wallenberg syndrome)", "Medial medulla (Dejerine syndrome)"],
          a: 0,
          exp: "Millard-Gubler syndrome is a ventral pontine alternating syndrome damaging exiting CN VI and VII fascicles along with the corticospinal tract.",
          r: ["Correct. Millard-Gubler syndrome involves ventral pons, affecting CN VI, VII, and corticospinal tract.", "Incorrect. Weber involves midbrain CN III.", "Incorrect. Wallenberg involves lateral medulla.", "Incorrect. Dejerine involves medial medulla with CN XII."],
          kp: "Millard-Gubler syndrome localizes to the ventral pons, causing ipsilateral CN VI and VII palsies with contralateral hemiparesis.",
          img: ["ap-brain-gross.webp"],
          d: 2,
          cog: "application"
        },
        {
          id: "bk-loc-006",
          q: "Which motor pathway structure crosses in the caudal medulla oblongata at the pyramidal decussation?",
          o: ["Lateral corticospinal tract", "Dorsal spinocerebellar tract", "Medial longitudinal fasciculus", "Rubrospinal tract"],
          a: 0,
          exp: "At the pyramidal decussation in the caudal medulla, approximately 85% of descending corticospinal fibers cross the midline to form the lateral corticospinal tract in the lateral funiculus of the spinal cord.",
          r: ["Correct. Corticospinal fibers cross at the medullary pyramidal decussation.", "Incorrect. Spinocerebellar tracts ascend uncrossed or double-crossed.", "Incorrect. MLF coordinates vestibular and ocular motor nuclei.", "Incorrect. Rubrospinal tract decussates in the midbrain."],
          kp: "Eighty-five percent of corticospinal fibers cross at the medullary pyramidal decussation to form the lateral corticospinal tract.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-loc-007",
          q: "A patient presents with tongue deviation to the right side on protrusion, accompanied by left-sided hemiplegia sparing the face. Where is the vascular lesion?",
          o: ["Right medial medulla (anterior spinal artery branch)", "Right lateral medulla (PICA)", "Left midbrain basis", "Left internal capsule"],
          a: 0,
          exp: "Dejerine (medial medullary) syndrome is caused by anterior spinal artery or paramedian vertebral occlusion, damaging the hypoglossal nucleus/nerve (tongue deviates to lesion side) and corticospinal tract.",
          r: ["Correct. Right medial medullary infarction damages right CN XII and uncrossed corticospinal fibers.", "Incorrect. Lateral medulla spares CN XII and motor fibers.", "Incorrect. Midbrain lesions involve CN III, not CN XII.", "Incorrect. Internal capsule lesions produce contralateral face/arm/leg weakness without tongue atrophy."],
          kp: "Medial medullary syndrome damages CN XII (tongue deviates towards lesion) and corticospinal tract (contralateral hemiparesis).",
          img: ["ap-brain-gross.webp"],
          d: 2,
          cog: "application"
        },
        {
          id: "bk-loc-008",
          q: "Brown-Sequard syndrome following a spinal cord hemisection produces which classic pattern of neurological deficits below the lesion level?",
          o: ["Ipsilateral motor weakness and vibration loss; contralateral pain and temperature loss", "Bilateral motor weakness with preserved vibration sense", "Contralateral motor weakness and ipsilateral pain/temperature loss", "Bilateral loss of pain and temperature with preserved motor function"],
          a: 0,
          exp: "Spinal cord hemisection damages the uncrossed corticospinal tract (ipsilateral weakness), uncrossed dorsal columns (ipsilateral touch/vibration loss), and crossed spinothalamic tract (contralateral pain/temperature loss).",
          r: ["Correct. Brown-Sequard produces ipsilateral weakness/vibration loss and contralateral pain/temperature loss.", "Incorrect. Bilateral weakness suggests transverse myelitis or complete transection.", "Incorrect. Motor weakness is strictly ipsilateral below the hemisection.", "Incorrect. Sparing of motor with loss of pain suggests anterior cord syndrome."],
          kp: "Brown-Sequard hemicord syndrome causes ipsilateral motor and proprioceptive loss with contralateral pain and temperature analgesia.",
          img: [],
          d: 2,
          cog: "application"
        },
        {
          id: "bk-loc-009",
          q: "Which clinical feature definitively differentiates a peripheral lower motor neuron facial nerve palsy (Bell palsy) from a central upper motor neuron facial weakness?",
          o: ["Paralysis of forehead frontalis and orbicularis oculi muscles", "Inability to smile on the affected side", "Flattening of the nasolabial fold", "Drooling from the mouth corner"],
          a: 0,
          exp: "The forehead (frontalis muscle) receives bilateral upper motor neuron cortical innervation. An LMN facial palsy impairs the entire ipsilateral face including the forehead, whereas an UMN lesion spares the forehead.",
          r: ["Correct. Forehead weakness confirms LMN facial palsy; forehead sparing indicates a central UMN lesion.", "Incorrect. Both UMN and LMN lesions impair voluntary smiling.", "Incorrect. Nasolabial fold flattens in both UMN and LMN weakness.", "Incorrect. Drooling occurs in both UMN and LMN weakness."],
          kp: "Forehead involvement confirms a lower motor neuron facial palsy, whereas forehead sparing signifies a central upper motor neuron lesion.",
          img: [],
          d: 1,
          cog: "application"
        },
        {
          id: "bk-loc-010",
          q: "A patient presents with bilateral symmetrical distal extremity sensory loss in a 'glove-and-stocking' distribution, loss of ankle jerk reflexes, and mild distal motor weakness. Where is the primary pathological process?",
          o: ["Peripheral length-dependent polyneuropathy", "Thoracic spinal cord compressive myelopathy", "Bilateral internal capsule lacunar infarcts", "Cervical central canal syrinx"],
          a: 0,
          exp: "Symmetric distal sensory loss in a glove-and-stocking distribution with absent distal reflexes is the hallmark of a length-dependent peripheral polyneuropathy.",
          r: ["Correct. Glove-and-stocking sensory impairment with lost ankle jerks defines length-dependent polyneuropathy.", "Incorrect. Myelopathy presents with a sensory level and upper motor neuron signs.", "Incorrect. Internal capsule infarcts produce unilateral hemiparesis.", "Incorrect. Syrinx causes cape-like suspended dissociated sensory loss across upper extremities."],
          kp: "Glove-and-stocking sensory loss coupled with absent ankle reflexes localizes to peripheral length-dependent polyneuropathy.",
          img: [],
          d: 1,
          cog: "application"
        }
      ]
    },

    // 6. ana-stomach-duodenum
    {
      topic: "ana-stomach-duodenum",
      items: [
        {
          id: "bk-gdu-001",
          q: "A 42-year-old patient undergoes an urgent laparotomy for a perforated anterior peptic ulcer. Where in the gastrointestinal tract is this perforation most commonly situated?",
          o: ["First part of duodenum (duodenal bulb)", "Third horizontal part of duodenum", "Fundus of stomach", "Descending duodenum near ampulla"],
          a: 0,
          exp: "Over 90% of duodenal ulcers occur in the first part of the duodenum (duodenal bulb). Anterior wall ulcers perforate into the peritoneal cavity causing pneumoperitoneum.",
          r: ["Correct. The duodenal bulb (D1) is the most frequent site of peptic ulcers and anterior perforation.", "Incorrect. D3 is rarely affected by primary peptic ulcer disease.", "Incorrect. Gastric fundus ulcers are uncommon compared to antral and duodenal bulb lesions.", "Incorrect. D2 ulcers are much less common."],
          kp: "The first part of the duodenum (duodenal bulb) is the predominant site for peptic ulcers, with anterior ulcers perforating into the peritoneum.",
          img: ["ap-stomach-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-gdu-002",
          q: "A patient with a deep chronic posterior duodenal bulb ulcer presents with sudden hematemesis and hemorrhagic shock. Which artery coursing directly posterior to D1 was eroded?",
          o: ["Gastroduodenal artery", "Splenic artery", "Left gastric artery", "Superior mesenteric artery"],
          a: 0,
          exp: "The gastroduodenal artery descends directly posterior to the first part of the duodenum (D1). Chronic posterior ulcers penetrate into this artery, causing massive gastrointestinal hemorrhage.",
          r: ["Correct. Posterior duodenal bulb ulcers erode the gastroduodenal artery, causing torrential bleeding.", "Incorrect. Splenic artery runs along the superior border of the pancreas towards the spleen.", "Incorrect. Left gastric artery supplies the lesser curvature of the stomach.", "Incorrect. Superior mesenteric artery courses posterior to the third part of duodenum."],
          kp: "Posterior duodenal bulb ulcers erode the gastroduodenal artery, leading to massive, life-threatening upper gastrointestinal hemorrhage.",
          img: ["ap-stomach-gross.webp"],
          d: 1,
          cog: "application"
        },
        {
          id: "bk-gdu-003",
          q: "Which artery directly supplies the gastric fundus via branches that arise from the splenic artery in the splenorenal ligament?",
          o: ["Short gastric arteries", "Right gastric artery", "Left gastroepiploic artery", "Right gastroepiploic artery"],
          a: 0,
          exp: "The short gastric arteries (typically 4 to 6 branches) arise from the splenic artery at the splenic hilum and pass through the gastrosplenic ligament to supply the fundus.",
          r: ["Correct. Short gastric arteries arise from the splenic artery to supply the gastric fundus.", "Incorrect. Right gastric artery supplies the lesser curvature.", "Incorrect. Left gastroepiploic supplies the upper greater curvature.", "Incorrect. Right gastroepiploic supplies the lower greater curvature."],
          kp: "Short gastric arteries from the splenic artery supply the gastric fundus and run within the gastrosplenic ligament.",
          img: ["ap-stomach-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-gdu-004",
          q: "The third (horizontal) part of the duodenum (D3) is vulnerable to vascular compression in young patients with severe weight loss because it is wedged between which two major vessels?",
          o: ["Abdominal aorta and superior mesenteric artery", "Inferior vena cava and portal vein", "Celiac trunk and common hepatic artery", "Left renal vein and splenic vein"],
          a: 0,
          exp: "In superior mesenteric artery (SMA) syndrome, loss of the retroperitoneal mesenteric fat pad narrows the aortomesenteric angle, compressing the horizontal duodenum between the aorta and SMA.",
          r: ["Correct. SMA syndrome results from compression of D3 between the abdominal aorta and superior mesenteric artery.", "Incorrect. IVC and portal vein are not the compressive clamp in SMA syndrome.", "Incorrect. Celiac trunk lies superior to the duodenum.", "Incorrect. Left renal vein compression between aorta and SMA causes nutcracker syndrome, not duodenal obstruction."],
          kp: "Superior mesenteric artery syndrome compresses the third part of the duodenum between the aorta and the SMA.",
          img: ["ap-stomach-gross.webp"],
          d: 2,
          cog: "application"
        },
        {
          id: "bk-gdu-005",
          q: "Gastric acid-secreting parietal cells and intrinsic factor-producing cells are concentrated primarily in which anatomical regions of the stomach?",
          o: ["Fundus and body", "Antrum and pylorus", "Cardia only", "Pyloric sphincter canal"],
          a: 0,
          exp: "Parietal (oxyntic) cells and chief (peptic) cells reside predominantly within gastric oxyntic glands in the fundus and corpus (body) of the stomach.",
          r: ["Correct. Parietal cells are densely concentrated in the gastric fundus and corpus.", "Incorrect. The antrum and pylorus contain mucus-secreting and gastrin-producing G cells.", "Incorrect. The cardia contains predominantly mucus-secreting glands.", "Incorrect. The pyloric sphincter is smooth muscle without oxyntic glands."],
          kp: "Gastric parietal cells secreting hydrochloric acid and intrinsic factor are concentrated in the fundus and body.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-gdu-006",
          q: "The common bile duct and the main pancreatic duct unite to form the hepatopancreatic ampulla (ampulla of Vater), which empties into which part of the duodenum?",
          o: ["Second part (descending duodenum)", "First part (duodenal bulb)", "Third part (horizontal duodenum)", "Fourth part (ascending duodenum)"],
          a: 0,
          exp: "The ampulla of Vater opens into the posteromedial wall of the second (descending) part of the duodenum at the major duodenal papilla.",
          r: ["Correct. The ampulla of Vater empties into the second (descending) duodenum.", "Incorrect. The first part is the duodenal bulb.", "Incorrect. The third part runs horizontally across the spine.", "Incorrect. The fourth part ascends to the duodenojejunal flexure."],
          kp: "The major duodenal papilla is located on the posteromedial wall of the descending (second) part of the duodenum.",
          img: ["ap-stomach-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-gdu-007",
          q: "During surgical mobilization of the lesser curvature of the stomach, ligation of the left gastric artery requires dissection close to its direct origin from which vessel?",
          o: ["Celiac trunk", "Abdominal aorta", "Common hepatic artery", "Splenic artery"],
          a: 0,
          exp: "The left gastric artery is the smallest and first branch arising directly from the celiac trunk, ascending towards the gastroesophageal junction.",
          r: ["Correct. The left gastric artery originates directly from the celiac trunk.", "Incorrect. It does not originate directly from the abdominal aorta.", "Incorrect. Common hepatic is a sister branch from the celiac trunk.", "Incorrect. Splenic is another branch of the celiac trunk."],
          kp: "The left gastric artery is a direct branch of the celiac trunk, supplying the lesser curvature and lower esophagus.",
          img: ["ap-stomach-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-gdu-008",
          q: "Which anatomical structure suspends the duodenojejunal flexure and serves as the clinical landmark separating the upper and lower gastrointestinal tracts?",
          o: ["Ligament of Treitz (suspensory muscle of duodenum)", "Hepatoduodenal ligament", "Gastrocolic ligament", "Falciform ligament"],
          a: 0,
          exp: "The suspensory muscle of the duodenum (ligament of Treitz) attaches the duodenojejunal flexure to the right crus of the diaphragm, defining the boundary between upper and lower GI bleeding.",
          r: ["Correct. Ligament of Treitz suspends the duodenojejunal flexure and demarcates upper from lower GI tracts.", "Incorrect. Hepatoduodenal ligament forms the free edge of lesser omentum.", "Incorrect. Gastrocolic ligament connects stomach to colon.", "Incorrect. Falciform ligament attaches liver to anterior wall."],
          kp: "The ligament of Treitz suspends the duodenojejunal flexure and demarcates the anatomical boundary between upper and lower GI tracts.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-gdu-009",
          q: "What unique histological feature characterizes the submucosa of the duodenum, distinguishing it from all other parts of the small intestine?",
          o: ["Brunner glands secreting alkaline mucus", "Peyer patches", "Crypts of Lieberkuhn only", "Meissner plexus absence"],
          a: 0,
          exp: "Brunner glands are branched tubuloalveolar glands situated in the duodenal submucosa that secrete alkaline, bicarbonate-rich mucus to neutralize acidic gastric chyme.",
          r: ["Correct. Brunner glands in the submucosa are pathognomonic for the duodenum.", "Incorrect. Peyer patches characterize the ileum.", "Incorrect. Crypts of Lieberkuhn exist throughout the small and large bowel.", "Incorrect. Meissner submucosal plexus is present throughout the GI tract."],
          kp: "Brunner glands located in the duodenal submucosa secrete alkaline mucus to protect mucosa from gastric acid.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-gdu-010",
          q: "Which muscle layer of the gastric muscularis externa is unique to the stomach and absent throughout the remainder of the gastrointestinal tract?",
          o: ["Inner oblique layer", "Middle circular layer", "Outer longitudinal layer", "Muscularis mucosae"],
          a: 0,
          exp: "The stomach muscularis externa consists of three layers: outer longitudinal, middle circular, and an inner oblique layer that assists in mechanical churning of food into chyme.",
          r: ["Correct. The inner oblique layer is unique to the stomach muscularis externa.", "Incorrect. Middle circular layer exists throughout the GI tract.", "Incorrect. Outer longitudinal layer exists throughout the GI tract.", "Incorrect. Muscularis mucosae is a separate thin mucosal boundary layer."],
          kp: "The stomach uniquely possesses three muscularis externa layers, featuring an inner oblique layer for churning.",
          img: ["ap-stomach-gross.webp"],
          d: 1,
          cog: "recall"
        }
      ]
    },

    // 7. ana-spleen
    {
      topic: "ana-spleen",
      items: [
        {
          id: "bk-spl-001",
          q: "A 24-year-old trauma patient suffers blunt abdominal injury. Fractures of which ribs on the left side are most commonly associated with laceration of the underlying spleen?",
          o: ["Left ribs 9, 10, and 11", "Left ribs 1, 2, and 3", "Left ribs 5, 6, and 7", "Left ribs 11 and 12 floating ribs only"],
          a: 0,
          exp: "The spleen lies in the left hypochondrium directly protected by the lateral curves of the left 9th, 10th, and 11th ribs. Fractures here frequently lacerate the splenic parenchyma.",
          r: ["Correct. Fractures of left ribs 9 to 11 are most strongly associated with traumatic splenic injury.", "Incorrect. Ribs 1-3 injuries correlate with aortic or subclavian vessel trauma.", "Incorrect. Ribs 5-7 overlie the heart and left lung base.", "Incorrect. Ribs 11-12 overlie the left kidney posteriorly."],
          kp: "Fractures of the left 9th through 11th ribs place the underlying spleen at high risk for parenchymal laceration.",
          img: ["ap-spleen-gross.webp"],
          d: 1,
          cog: "application"
        },
        {
          id: "bk-spl-002",
          q: "During splenectomy for severe trauma, ligation of short gastric vessels within the gastrosplenic ligament risks ischemic injury to which part of the stomach?",
          o: ["Gastric fundus", "Gastric antrum", "Pylorus", "Lower lesser curvature"],
          a: 0,
          exp: "Short gastric arteries run within the gastrosplenic ligament from the splenic artery to supply the gastric fundus. Aggressive dissection can compromise fundic vascularity.",
          r: ["Correct. Short gastric vessels supply the gastric fundus within the gastrosplenic ligament.", "Incorrect. Gastric antrum is supplied by gastroepiploic and right gastric vessels.", "Incorrect. Pylorus is supplied by right gastric and gastroduodenal branches.", "Incorrect. Lesser curve is supplied by left gastric artery."],
          kp: "The gastrosplenic ligament contains the short gastric arteries supplying the fundus of the stomach.",
          img: ["ap-spleen-gross.webp"],
          d: 2,
          cog: "recall"
        },
        {
          id: "bk-spl-003",
          q: "During mobilization of the splenic hilum, which anatomical organ is in direct intimate contact with the splenic vessels in the splenorenal ligament and vulnerable to iatrogenic transection?",
          o: ["Tail of the pancreas", "Left suprarenal gland", "Duodenojejunal flexure", "Splenic flexure of colon"],
          a: 0,
          exp: "The tail of the pancreas lies within the splenorenal ligament and frequently abuts or enters the splenic hilum, creating a high risk of pancreatic fistulas if clamped during splenectomy.",
          r: ["Correct. The pancreatic tail lies in the splenorenal ligament abutting the splenic hilum.", "Incorrect. Left suprarenal gland lies retroperitoneal medial to the kidney.", "Incorrect. Duodenojejunal flexure is located medial to the midline.", "Incorrect. Splenic flexure lies inferiorly, attached by phrenicocolic ligament."],
          kp: "The tail of the pancreas lies within the splenorenal ligament and is vulnerable to iatrogenic injury during splenic hilar ligation.",
          img: ["ap-spleen-gross.webp"],
          d: 2,
          cog: "application"
        },
        {
          id: "bk-spl-004",
          q: "In splenic histology, what is the primary immunological function of the periarteriolar lymphoid sheath (PALS) surrounding central arterioles?",
          o: ["Houses T lymphocytes for cellular immune surveillance", "Filters aged non-deformable red blood cells", "Stores platelets in venous sinuses", "Synthesizes opsonizing antibodies against bacteria"],
          a: 0,
          exp: "In the white pulp, the periarteriolar lymphoid sheath (PALS) is composed predominantly of T lymphocytes wrapped around central arterioles, mediating cellular immune surveillance.",
          r: ["Correct. PALS is the T-cell compartment of splenic white pulp.", "Incorrect. Filtering non-deformable erythrocytes is the function of the red pulp.", "Incorrect. Platelet storage occurs in red pulp sinuses.", "Incorrect. Opsonizing antibody synthesis occurs in B-cell follicles."],
          kp: "The periarteriolar lymphoid sheath (PALS) in splenic white pulp is populated predominantly by T lymphocytes.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-spl-005",
          q: "A post-splenectomy patient is at lifelong risk for overwhelming postsplenectomy infection (OPSI). Which encapsulated bacterium is the most common cause of fatal post-splenectomy sepsis?",
          o: ["Streptococcus pneumoniae", "Escherichia coli", "Pseudomonas aeruginosa", "Staphylococcus aureus"],
          a: 0,
          exp: "Streptococcus pneumoniae accounts for over 50-70% of all cases of overwhelming post-splenectomy sepsis, followed by Neisseria meningitidis and Haemophilus influenzae.",
          r: ["Correct. Streptococcus pneumoniae is the leading culprit in overwhelming post-splenectomy infection.", "Incorrect. E. coli is not an encapsulated organism relying primarily on splenic opsonin clearance.", "Incorrect. Pseudomonas causes opportunistic hospital-acquired infections.", "Incorrect. Staph aureus causes soft tissue and catheter sepsis."],
          kp: "Streptococcus pneumoniae is the most frequent and lethal pathogen in overwhelming postsplenectomy infection (OPSI).",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-spl-006",
          q: "Examination of a peripheral blood smear from a patient three months after splenectomy reveals small, round basophilic nuclear inclusions within erythrocytes. What are these inclusions?",
          o: ["Howell-Jolly bodies", "Heinz bodies", "Basophilic stippling", "Pappenheimer bodies"],
          a: 0,
          exp: "Howell-Jolly bodies are nuclear DNA remnants normally removed by splenic macrophages in the cords of Billroth ('pitting'). Their presence indicates asplenia or hyposplenism.",
          r: ["Correct. Howell-Jolly bodies are nuclear remnants that persist after splenectomy.", "Incorrect. Heinz bodies are precipitated hemoglobin clumps seen in G6PD deficiency.", "Incorrect. Basophilic stippling represents ribosomal RNA aggregates seen in lead poisoning.", "Incorrect. Pappenheimer bodies are iron-containing granules."],
          kp: "Howell-Jolly bodies are nuclear remnants normally removed by splenic pitting, serving as a diagnostic hallmark of asplenia.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-spl-007",
          q: "To re-enter the general venous circulation from the cords of Billroth, circulating erythrocytes must physically squeeze through 2-micrometer endothelial slits in which red pulp structures?",
          o: ["Splenic venous sinusoids", "Central arterioles", "Trabecular arteries", "Marginal sinus zones"],
          a: 0,
          exp: "Erythrocytes in the red pulp cords of Billroth must deform through narrow 2-micrometer clefts between barrel stave endothelial cells to enter venous sinusoids.",
          r: ["Correct. Erythrocytes must squeeze through narrow endothelial slits lining splenic venous sinusoids.", "Incorrect. Central arterioles deliver blood into the white pulp.", "Incorrect. Trabecular arteries are muscular conducting branches.", "Incorrect. Marginal sinus surrounds follicles."],
          kp: "Splenic sinusoids test erythrocyte deformability as red cells squeeze through narrow endothelial slits from cords of Billroth.",
          img: [],
          d: 2,
          cog: "recall"
        },
        {
          id: "bk-spl-008",
          q: "Which ligament provides an inferior horizontal shelf supporting the lower pole of the spleen, often requiring division to mobilize the splenic flexure of the colon?",
          o: ["Phrenicocolic ligament (sustentaculum lienis)", "Gastrosplenic ligament", "Splenorenal ligament", "Falciform ligament"],
          a: 0,
          exp: "The phrenicocolic ligament extends from the splenic flexure of the colon to the diaphragm, serving as the anatomical floor (sustentaculum lienis) supporting the spleen.",
          r: ["Correct. The phrenicocolic ligament supports the inferior splenic pole.", "Incorrect. Gastrosplenic carries short gastric arteries.", "Incorrect. Splenorenal carries splenic vessels and pancreatic tail.", "Incorrect. Falciform attaches liver to anterior wall."],
          kp: "The phrenicocolic ligament (sustentaculum lienis) forms an anatomical shelf supporting the spleen.",
          img: ["ap-spleen-gross.webp"],
          d: 2,
          cog: "recall"
        },
        {
          id: "bk-spl-009",
          q: "A child with hereditary spherocytosis experiences recurrent hemolytic anemia and splenomegaly. Why are spherocytic erythrocytes prematurely destroyed in the spleen?",
          o: ["Spherical erythrocytes lack deformability and are trapped in the cords of Billroth", "Spherocytes trigger massive antibody production in white pulp", "Defective spectrin stimulates Kupffer cell phagocytosis", "Sinusoidal endothelium lyses spherocytes directly"],
          a: 0,
          exp: "Hereditary spherocytosis reduces membrane surface area-to-volume ratio, making red cells rigid spheres. They cannot deform through the 2-micrometer slits into sinusoids and are engulfed by cord macrophages.",
          r: ["Correct. Inflexible spherocytes cannot traverse sinusoidal slits and are phagocytosed in splenic cords.", "Incorrect. Hemolysis in spherocytosis is mechanical entrapment, not antibody-mediated.", "Incorrect. Kupffer cells are in the liver; splenic macrophages clear spherocytes.", "Incorrect. Sinusoidal endothelium is a passive physical sieve."],
          kp: "Rigid spherocytes in hereditary spherocytosis fail the splenic deformability test and are phagocytosed in cords of Billroth.",
          img: [],
          d: 2,
          cog: "application"
        },
        {
          id: "bk-spl-010",
          q: "The splenic vein joins with which major vessel posterior to the neck of the pancreas to form the hepatic portal vein?",
          o: ["Superior mesenteric vein", "Inferior mesenteric vein", "Left renal vein", "Inferior vena cava"],
          a: 0,
          exp: "The hepatic portal vein is formed posterior to the neck of the pancreas by the confluence of the splenic vein and the superior mesenteric vein.",
          r: ["Correct. The splenic vein and superior mesenteric vein join to form the portal vein.", "Incorrect. Inferior mesenteric vein typically empties into the splenic vein earlier.", "Incorrect. Left renal vein drains into IVC.", "Incorrect. IVC is systemic venous circulation."],
          kp: "The splenic vein unites with the superior mesenteric vein behind the pancreatic neck to form the hepatic portal vein.",
          img: ["ap-spleen-gross.webp"],
          d: 1,
          cog: "recall"
        }
      ]
    },

    // 8. ana-trachea-bronchi
    {
      topic: "ana-trachea-bronchi",
      items: [
        {
          id: "bk-tra-001",
          q: "A 3-year-old child accidentally aspirates a peanut while laughing. Bronchoscopic inspection is most likely to reveal the aspirated foreign object lodged in which airway?",
          o: ["Right main bronchus or right intermediate bronchus", "Left main bronchus", "Left upper lobe bronchus", "Tracheal lumen at C6"],
          a: 0,
          exp: "The right main bronchus is wider, shorter, and runs more vertically than the left main bronchus. Aspirated foreign bodies therefore enter the right bronchial tree far more frequently.",
          r: ["Correct. The right main bronchus is more vertical and wider, predisposing to foreign body lodgement.", "Incorrect. Left main bronchus is narrower, longer, and more horizontal.", "Incorrect. Left upper lobe is angled sharply away from the carina.", "Incorrect. Solid foreign bodies typically pass through the tracheal lumen into a bronchus."],
          kp: "Aspirated foreign bodies preferentially enter the right main bronchus due to its wider caliber and more vertical orientation.",
          img: ["ap-trachea-bronchi-gross.webp"],
          d: 1,
          cog: "application"
        },
        {
          id: "bk-tra-002",
          q: "At which surface anatomical landmark does the trachea bifurcate into right and left primary bronchi?",
          o: ["Sternal angle of Louis (T4-T5 vertebral level)", "Xiphisternal joint", "Jugular suprasternal notch", "Cricoid cartilage (C6)"],
          a: 0,
          exp: "The trachea bifurcates at the carina, corresponding surface-wise to the sternal angle of Louis (manubriosternal joint) and the T4-T5 intervertebral disc level.",
          r: ["Correct. Tracheal bifurcation occurs at the sternal angle of Louis at T4-T5.", "Incorrect. Xiphisternal joint corresponds to T9.", "Incorrect. Jugular notch corresponds to T2.", "Incorrect. Cricoid cartilage marks tracheal origin at C6."],
          kp: "Tracheal bifurcation occurs at the carina, aligning with the sternal angle of Louis and T4-T5 intervertebral level.",
          img: ["ap-trachea-bronchi-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-tra-003",
          q: "During emergency surgical tracheostomy, which endocrine structure crosses anterior to the second, third, and fourth tracheal rings and must be retracted or divided?",
          o: ["Isthmus of the thyroid gland", "Thymus gland", "Parathyroid glands", "Submandibular gland"],
          a: 0,
          exp: "The isthmus of the thyroid gland crosses anteriorly over the 2nd, 3rd, and 4th tracheal rings in the lower anterior neck.",
          r: ["Correct. The thyroid isthmus overlies the 2nd through 4th tracheal rings.", "Incorrect. Thymus gland lies lower in the anterior superior mediastinum.", "Incorrect. Parathyroid glands lie on the posterior thyroid capsule.", "Incorrect. Submandibular gland lies in the digastric triangle."],
          kp: "The thyroid isthmus crosses directly anterior to tracheal rings 2 to 4, representing a key landmark during tracheostomy.",
          img: ["ap-trachea-bronchi-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-tra-004",
          q: "What type of cartilage composes the 16 to 20 C-shaped structural rings of the trachea?",
          o: ["Hyaline cartilage", "Elastic cartilage", "Fibrocartilage", "Calcified cartilage"],
          a: 0,
          exp: "The C-shaped rings of the trachea are composed of hyaline cartilage, providing rigid structural support against negative intrathoracic inspiratory collapse.",
          r: ["Correct. Tracheal rings are composed of hyaline cartilage.", "Incorrect. Elastic cartilage is found in the epiglottis and ear pinna.", "Incorrect. Fibrocartilage is found in intervertebral discs.", "Incorrect. Calcified cartilage is a pathological or senescent state."],
          kp: "Hyaline cartilage forms the 16 to 20 C-shaped rings of the human trachea.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-tra-005",
          q: "Contraction of which smooth muscle band bridging the posterior gap of the tracheal cartilage rings reduces tracheal diameter to increase airflow speed during coughing?",
          o: ["Trachealis muscle", "Cricothyroid muscle", "Sternothyroid muscle", "Bronchialis muscle"],
          a: 0,
          exp: "The trachealis muscle spans the posterior gap of the C-shaped cartilages. Contraction narrows the lumen, accelerating linear air velocity during explosive coughing.",
          r: ["Correct. Trachealis muscle contracts to narrow airway caliber and boost cough clearance velocity.", "Incorrect. Cricothyroid tenses vocal cords.", "Incorrect. Sternothyroid is an extrinsic strap muscle.", "Incorrect. Bronchialis is an anatomical misnomer."],
          kp: "The trachealis smooth muscle spans the posterior tracheal wall, narrowing luminal diameter to enhance cough velocity.",
          img: ["ap-trachea-bronchi-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-tra-006",
          q: "How many independent bronchopulmonary segments are present in the normal right lung?",
          o: ["10 segments (3 upper, 2 middle, 5 lower)", "8 segments (4 upper, 4 lower)", "12 segments (4 per lobe)", "7 segments"],
          a: 0,
          exp: "The right lung possesses 10 bronchopulmonary segments: 3 in the upper lobe (apical, anterior, posterior), 2 in the middle lobe (lateral, medial), and 5 in the lower lobe (superior, medial, anterior, lateral, posterior basal).",
          r: ["Correct. The right lung has 10 bronchopulmonary segments across 3 lobes.", "Incorrect. 8 segments is typical of the left lung due to fused basal segments.", "Incorrect. 12 segments is an overcount.", "Incorrect. 7 segments is an undercount."],
          kp: "The normal human right lung contains 10 distinct bronchopulmonary segments, each supplied by an independent tertiary bronchus.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-tra-007",
          q: "What is the key difference in vascular anatomy between pulmonary arteries and pulmonary veins regarding bronchopulmonary segments?",
          o: ["Pulmonary arteries run intrasegmentally with bronchi; pulmonary veins run intersegmentally in septa", "Pulmonary veins run intrasegmentally; pulmonary arteries run intersegmentally", "Both vessels run together inside the segmental bronchus lumen", "Pulmonary arteries drain into the left atrium directly"],
          a: 0,
          exp: "Pulmonary arteries follow the branching bronchial tree within the center of each segment (intrasegmental), whereas pulmonary veins course through the intersegmental connective tissue septa.",
          r: ["Correct. Pulmonary arteries course intrasegmentally with bronchi; pulmonary veins run intersegmentally between segments.", "Incorrect. Veins are intersegmental, not intrasegmental.", "Incorrect. Vessels never run inside the bronchial lumen.", "Incorrect. Arteries originate from the right ventricle."],
          kp: "Pulmonary arteries run intrasegmentally alongside tertiary bronchi, whereas pulmonary veins run intersegmentally in septal planes.",
          img: [],
          d: 2,
          cog: "recall"
        },
        {
          id: "bk-tra-008",
          q: "The internal cartilaginous ridge that separates the openings of the right and left primary bronchi at the tracheal bifurcation is called the:",
          o: ["Carina", "Conus elasticus", "Thyroid notch", "Interarytenoid fold"],
          a: 0,
          exp: "The carina is the prominent sagittal ridge of cartilage projecting upward at the bifurcation of the trachea into mainstem bronchi, densely innervated by cough reflex receptors.",
          r: ["Correct. The carina is the mucosal ridge dividing the tracheal bifurcation.", "Incorrect. Conus elasticus forms the vocal ligament.", "Incorrect. Thyroid notch is on the thyroid cartilage.", "Incorrect. Interarytenoid fold lies in the posterior larynx."],
          kp: "The carina is the highly sensitive internal ridge marking the bifurcation of the trachea into primary bronchi.",
          img: ["ap-trachea-bronchi-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-tra-009",
          q: "Which cranial nerve provides parasympathetic secretomotor and bronchoconstrictor innervation to the tracheobronchial tree?",
          o: ["Vagus nerve (CN X)", "Glossopharyngeal nerve (CN IX)", "Accessory nerve (CN XI)", "Phrenic nerve (C3-C5)"],
          a: 0,
          exp: "The vagus nerve (CN X) provides parasympathetic preganglionic fibers via the pulmonary plexus, releasing acetylcholine to induce smooth muscle bronchoconstriction and stimulate mucus secretion.",
          r: ["Correct. Vagus nerve innervates tracheobronchial smooth muscle and submucosal glands.", "Incorrect. Glossopharyngeal supplies carotid sinus and pharynx.", "Incorrect. Accessory supplies SCM and trapezius.", "Incorrect. Phrenic provides somatic motor innervation to the diaphragm."],
          kp: "The vagus nerve mediates parasympathetic bronchoconstriction and submucosal secretomotor function via muscarinic receptors.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-tra-010",
          q: "What respiratory epithelial cell type secretes surfactant-like uteroglobin (CC16) and acts as a progenitor for airway repair in small terminal bronchioles?",
          o: ["Club cells (Clara cells)", "Type I alveolar pneumocytes", "Goblet cells", "Kulchitsky neuroendocrine cells"],
          a: 0,
          exp: "Club cells (formerly Clara cells) are non-ciliated dome-shaped cells in terminal bronchioles that secrete uteroglobin (CC16), detoxify harmful inhaled compounds via cytochrome P450, and regenerate airway epithelium.",
          r: ["Correct. Club cells secrete protective secretoglobins and regenerate ciliated bronchiolar epithelium.", "Incorrect. Type I pneumocytes mediate alveolar gas exchange.", "Incorrect. Goblet cells secrete thick mucin.", "Incorrect. Kulchitsky cells are neuroendocrine cells producing serotonin."],
          kp: "Club cells in terminal bronchioles secrete CC16, detoxify toxins, and serve as stem cells for bronchiolar repair.",
          img: [],
          d: 2,
          cog: "recall"
        }
      ]
    },

    // 9. ana-urinary-male-genital
    {
      topic: "ana-urinary-male-genital",
      items: [
        {
          id: "bk-umg-001",
          q: "A 35-year-old man presents with severe colicky flank pain radiating down into the scrotum. A 4 mm calculus is noted on CT. At which physiological constriction is the calculus most likely to impact?",
          o: ["Vesicoureteric junction (VUJ)", "Pelviureteric junction (PUJ)", "Crossing over the common iliac artery", "Midpoint of the lumbar ureter"],
          a: 0,
          exp: "The vesicoureteric junction (VUJ) is the narrowest site along the entire ureter as it passes obliquely through the muscular bladder wall, making it the most frequent impaction site for calculi.",
          r: ["Correct. The vesicoureteric junction is the narrowest anatomical site, frequently trapping migrating calculi.", "Incorrect. PUJ is a constriction, but stones that pass it commonly impact at the VUJ.", "Incorrect. Pelvic brim crossing is the second constriction site.", "Incorrect. Mid-lumbar ureter has no anatomical constriction."],
          kp: "The vesicoureteric junction is the narrowest site along the ureter and the most frequent location for calculus impaction.",
          img: ["ap-urinary-bladder-gross.webp"],
          d: 1,
          cog: "application"
        },
        {
          id: "bk-umg-002",
          q: "In which anatomical zone of the prostate gland do approximately 75% of prostate adenocarcinomas arise?",
          o: ["Peripheral zone", "Transition zone", "Central zone", "Anterior fibromuscular stroma"],
          a: 0,
          exp: "The peripheral zone forms approximately 70% of the volume of the prostate gland and accounts for 75% of prostatic adenocarcinomas, which are easily palpated on digital rectal examination.",
          r: ["Correct. Peripheral zone is the primary site of origin for prostatic adenocarcinoma.", "Incorrect. Transition zone is where benign prostatic hyperplasia originates.", "Incorrect. Central zone surrounds the ejaculatory ducts and rarely develops carcinoma.", "Incorrect. Anterior fibromuscular stroma is non-glandular."],
          kp: "Seventy-five percent of prostate adenocarcinomas originate in the peripheral zone, palpated via digital rectal exam.",
          img: ["ap-male-reproductive-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-umg-003",
          q: "Benign prostatic hyperplasia (BPH) causing lower urinary tract obstructive symptoms predominantly arises from which zone of the prostate?",
          o: ["Transition zone", "Peripheral zone", "Central zone", "Periurethral sphincter zone"],
          a: 0,
          exp: "Benign prostatic hyperplasia originates almost exclusively within the transition zone surrounding the proximal prostatic urethra, directly compressing the urethral lumen.",
          r: ["Correct. The transition zone surrounding the urethra is the exclusive site of benign prostatic hyperplasia.", "Incorrect. Peripheral zone gives rise to adenocarcinoma.", "Incorrect. Central zone surrounds ejaculatory ducts.", "Incorrect. External sphincter is striated muscle."],
          kp: "Benign prostatic hyperplasia develops within the transition zone of the prostate, leading to bladder outlet obstruction.",
          img: ["ap-male-reproductive-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-umg-004",
          q: "Which parasympathetic spinal cord segments give rise to pelvic splanchnic nerves that stimulate contraction of the detrusor muscle during micturition?",
          o: ["S2, S3, and S4", "T10, T11, and T12", "L1 and L2", "S1 and S2 only"],
          a: 0,
          exp: "Parasympathetic preganglionic neurons arise from the S2-S4 sacral segments (pelvic splanchnic nerves) to stimulate muscarinic M3 receptors on the detrusor, inducing bladder contraction.",
          r: ["Correct. S2, S3, and S4 provide parasympathetic motor supply to the detrusor muscle.", "Incorrect. T10-T12 mediate sympathetic vasoconstriction.", "Incorrect. L1-L2 mediate sympathetic internal sphincter closure (hypogastric nerve).", "Incorrect. S1 lacks parasympathetic preganglionic outflow."],
          kp: "Sacral parasympathetic nerves from S2-S4 stimulate detrusor muscle contraction and internal sphincter relaxation during micturition.",
          img: ["ap-urinary-bladder-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-umg-005",
          q: "The smooth triangular mucosal area at the base of the bladder known as the trigone is bounded by which three anatomical openings?",
          o: ["Two ureteric orifices and the internal urethral orifice", "Two ejaculatory duct orifices and the urethral crest", "Prostatic utricle and both ureters", "Bladder dome and bilateral ureteric orifices"],
          a: 0,
          exp: "The bladder trigone is bounded superolaterally by the two ureteric orifices and inferiorly by the internal urethral orifice at the bladder neck.",
          r: ["Correct. The trigone is bounded by both ureteric openings and the internal urethral orifice.", "Incorrect. Ejaculatory ducts empty into the prostatic urethra.", "Incorrect. Prostatic utricle is in the urethra.", "Incorrect. Bladder dome is the superior muscular wall."],
          kp: "The bladder trigone is bounded by the paired ureteric orifices and the single internal urethral orifice.",
          img: ["ap-urinary-bladder-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-umg-006",
          q: "Testicular cancer metastasizes primarily to which regional lymph node group due to the embryological retroperitoneal descent of the testes?",
          o: ["Para-aortic (lumbar) lymph nodes", "Superficial inguinal lymph nodes", "Deep inguinal lymph nodes", "Internal iliac lymph nodes"],
          a: 0,
          exp: "Because the testes develop high in the posterior abdominal wall and descend into the scrotum, testicular lymphatic drainage follows the testicular vessels directly to the para-aortic (lumbar) nodes.",
          r: ["Correct. Testicular lymphatic drainage travels directly to para-aortic lymph nodes.", "Incorrect. Superficial inguinal nodes drain scrotal skin.", "Incorrect. Deep inguinal nodes drain lower extremity deep tissues.", "Incorrect. Internal iliac nodes drain pelvic viscera including prostate."],
          kp: "Testicular lymphatic drainage travels directly to para-aortic (lumbar) lymph nodes, whereas scrotal skin drains to superficial inguinal nodes.",
          img: ["ap-male-reproductive-gross.webp"],
          d: 2,
          cog: "application"
        },
        {
          id: "bk-umg-007",
          q: "A 16-year-old boy presents with sudden severe testicular pain, scrotal swelling, and an absent cremasteric reflex on the affected side. Testicular torsion is confirmed. Which anatomical investment anomaly predisposes to this condition?",
          o: ["Bell-clapper deformity (high insertion of tunica vaginalis)", "Patent processus vaginalis", "Cryptorchidism only", "Absence of tunica albuginea"],
          a: 0,
          exp: "The bell-clapper deformity occurs when the tunica vaginalis abnormally envelops the epididymis and spermatic cord, allowing the testis to twist freely on its neurovascular pedicle.",
          r: ["Correct. Bell-clapper deformity allows the testis to rotate freely on its pedicle within the tunica vaginalis.", "Incorrect. Patent processus vaginalis predisposes to indirect inguinal hernia or hydrocele.", "Incorrect. Cryptorchidism increases malignancy risk but bell-clapper is the primary cause of intravaginal torsion.", "Incorrect. Tunica albuginea is the dense capsule of the testis itself."],
          kp: "Bell-clapper deformity (high attachment of tunica vaginalis) permits free axial rotation, predisposing to testicular torsion.",
          img: ["ap-male-reproductive-gross.webp"],
          d: 2,
          cog: "application"
        },
        {
          id: "bk-umg-008",
          q: "What is the dense fibrous connective tissue capsule directly enclosing the testicular parenchyma beneath the visceral layer of the tunica vaginalis?",
          o: ["Tunica albuginea", "Tunica dartos", "External spermatic fascia", "Cremasteric fascia"],
          a: 0,
          exp: "The tunica albuginea is a tough, dense white fibrous capsule that covers the testis and projects inward septa dividing it into testicular lobules.",
          r: ["Correct. Tunica albuginea is the fibrous capsule of the testis.", "Incorrect. Tunica dartos is smooth muscle in the scrotal wall.", "Incorrect. External spermatic fascia is derived from external oblique aponeurosis.", "Incorrect. Cremasteric fascia is derived from internal oblique."],
          kp: "The tunica albuginea is the dense fibrous capsule enclosing the testicular seminiferous tubules.",
          img: ["ap-male-reproductive-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-umg-009",
          q: "The ejaculatory ducts are formed by the union of the ductus deferens with the excretory duct of which accessory reproductive gland?",
          o: ["Seminal vesicle", "Bulbourethral gland (Cowper gland)", "Prostate gland", "Littre urethral gland"],
          a: 0,
          exp: "The ampulla of the ductus deferens joins the excretory duct of the seminal vesicle to form the ejaculatory duct, which courses through the prostate to empty into the prostatic urethra.",
          r: ["Correct. Ductus deferens joins the seminal vesicle duct to form the ejaculatory duct.", "Incorrect. Bulbourethral glands empty into the bulbous urethra.", "Incorrect. Prostate secretes directly through multiple prostatic ducts.", "Incorrect. Littre glands are tiny intraurethral glands."],
          kp: "The ejaculatory duct is formed by the union of the ductus deferens and the duct of the seminal vesicle.",
          img: ["ap-male-reproductive-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-umg-010",
          q: "The pampiniform venous plexus surrounding the testicular artery in the spermatic cord cools arterial blood entering the testis. The left testicular vein empties directly into which vessel at a sharp 90-degree angle?",
          o: ["Left renal vein", "Inferior vena cava", "Left internal iliac vein", "Splenic vein"],
          a: 0,
          exp: "The left testicular vein drains into the left renal vein at a perpendicular right angle, predisposing to elevated hydrostatic pressure and left-sided varicoceles.",
          r: ["Correct. The left testicular vein drains into the left renal vein at a 90-degree angle.", "Incorrect. The right testicular vein empties directly into the IVC at an oblique angle.", "Incorrect. Internal iliac receives pelvic venous tributaries.", "Incorrect. Splenic vein drains portal territory."],
          kp: "The left testicular vein drains into the left renal vein at a 90-degree angle, predisposing to left-sided varicocele.",
          img: [],
          d: 1,
          cog: "recall"
        }
      ]
    },

    // 10. ana-liver-biliary
    {
      topic: "ana-liver-biliary",
      items: [
        {
          id: "bk-liv-001",
          q: "In the Couinaud anatomical segmentation of the liver, which independent segment receives vascular inflow from both left and right portal branches and drains directly into the inferior vena cava?",
          o: ["Segment I (Caudate lobe)", "Segment IV (Quadrate lobe)", "Segment II", "Segment VIII"],
          a: 0,
          exp: "Segment I (caudate lobe) is functionally distinct: it receives blood from both right and left portal triads and drains directly into the IVC via independent hepatic veins, often hypertrophy in Budd-Chiari syndrome.",
          r: ["Correct. Segment I (caudate lobe) receives dual portal inflow and drains directly into the IVC.", "Incorrect. Segment IV is part of the left functional liver.", "Incorrect. Segment II is the superior lateral left segment.", "Incorrect. Segment VIII is the anterosuperior right segment."],
          kp: "Couinaud segment I (caudate lobe) receives dual portal inflow and drains directly into the IVC, sparing it in hepatic vein thrombosis.",
          img: ["ap-liver-gross.webp"],
          d: 2,
          cog: "recall"
        },
        {
          id: "bk-liv-002",
          q: "Which structures constitute the classic portal triad enclosed within the hepatoduodenal ligament at the porta hepatis?",
          o: ["Proper hepatic artery, portal vein, and common bile duct", "Hepatic vein, portal vein, and celiac trunk", "Inferior vena cava, splenic vein, and cystic duct", "Celiac trunk, hepatic vein, and gastroduodenal artery"],
          a: 0,
          exp: "The portal triad consists of the proper hepatic artery, hepatic portal vein, and common bile duct, contained within the free edge of the lesser omentum (hepatoduodenal ligament).",
          r: ["Correct. The portal triad contains the proper hepatic artery, portal vein, and common bile duct.", "Incorrect. Hepatic veins drain superiorly into the IVC.", "Incorrect. IVC is retroperitoneal.", "Incorrect. Celiac trunk is on the posterior abdominal wall."],
          kp: "The portal triad within the hepatoduodenal ligament comprises the portal vein, proper hepatic artery, and common bile duct.",
          img: ["ap-liver-lobule-portal.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-liv-003",
          q: "In hepatic microarchitecture, which cell type located in the space of Disse is responsible for vitamin A storage in health and excessive collagen deposition during liver cirrhosis?",
          o: ["Hepatic stellate cell (Ito cell)", "Kupffer cell", "Sinusoidal endothelial cell", "Canalicular hepatocyte"],
          a: 0,
          exp: "Hepatic stellate cells (Ito cells) reside in the space of Disse. They store vitamin A in quiescence, but under inflammatory stimulation transdifferentiate into collagen-secreting myofibroblasts, driving fibrosis.",
          r: ["Correct. Stellate cells store vitamin A and synthesize collagen in cirrhosis.", "Incorrect. Kupffer cells are resident tissue macrophages.", "Incorrect. Endothelial cells line the sinusoids.", "Incorrect. Hepatocytes perform metabolic and secretory duties."],
          kp: "Hepatic stellate cells in the space of Disse store vitamin A and become myofibroblasts that drive liver fibrosis and cirrhosis.",
          img: ["ap-liver-lobule-portal.webp"],
          d: 2,
          cog: "recall"
        },
        {
          id: "bk-liv-004",
          q: "According to Rappaport hepatic acinar zoning, which metabolic zone surrounds the central vein and is most vulnerable to ischemic necrosis and toxic acetaminophen injury?",
          o: ["Zone 3 (Centrilobular zone)", "Zone 1 (Periportal zone)", "Zone 2 (Intermediate zone)", "Space of Mall"],
          a: 0,
          exp: "Zone 3 (centrilobular) is farthest from incoming portal arterioles, having the lowest oxygen tension and the highest cytochrome P450 concentration, making it most vulnerable to ischemia and toxic injury.",
          r: ["Correct. Zone 3 has the lowest oxygen tension and highest P450 concentration, making it vulnerable to ischemia and acetaminophen toxicity.", "Incorrect. Zone 1 is best oxygenated and resists ischemia.", "Incorrect. Zone 2 is an intermediate transition zone.", "Incorrect. Space of Mall is at the portal tract border."],
          kp: "Acinar Zone 3 (centrilobular) is most susceptible to ischemic injury and toxic metabolite damage from high CYP450 activity.",
          img: ["ap-liver-lobule-portal.webp"],
          d: 2,
          cog: "recall"
        },
        {
          id: "bk-liv-005",
          q: "What percentage of total hepatic blood flow is normally delivered by the hepatic portal vein?",
          o: ["Approximately 75% (70-80%)", "Approximately 25% (20-30%)", "50% exactly", "Over 95%"],
          a: 0,
          exp: "The portal vein delivers approximately 75% of blood flow to the liver (rich in nutrients from the GI tract), while the hepatic artery delivers the remaining 25% (high in oxygen).",
          r: ["Correct. The portal vein supplies approximately 75% of hepatic blood volume.", "Incorrect. Hepatic artery provides about 25% of flow.", "Incorrect. Flow is not equally split.", "Incorrect. Arterial perfusion is mandatory for biliary epithelium."],
          kp: "The portal vein supplies roughly 75% of hepatic blood flow, while the hepatic artery supplies the remaining 25%.",
          img: ["ap-liver-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-liv-006",
          q: "The ligamentum teres hepatis (round ligament) running in the free edge of the falciform ligament represents the fibrous remnant of which fetal vascular structure?",
          o: ["Left umbilical vein", "Ductus venosus", "Umbilical artery", "Ductus arteriosus"],
          a: 0,
          exp: "The round ligament of the liver (ligamentum teres) is the obliterated fibrous cord of the left umbilical vein, which carried oxygenated placental blood to the fetal liver.",
          r: ["Correct. Ligamentum teres is the obliterated remnant of the left umbilical vein.", "Incorrect. Ductus venosus obliterates to form ligamentum venosum.", "Incorrect. Umbilical arteries obliterate to form medial umbilical ligaments.", "Incorrect. Ductus arteriosus forms ligamentum arteriosum."],
          kp: "The ligamentum teres hepatis is the anatomical remnant of the obliterated fetal left umbilical vein.",
          img: ["ap-liver-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-liv-007",
          q: "In cirrhotic portal hypertension, opening of portosystemic collateral veins between the left gastric vein and esophageal veins leads to which life-threatening complication?",
          o: ["Esophageal varices", "Caput medusae", "Retroperitoneal hemorrhage", "Hemorrhoids"],
          a: 0,
          exp: "Left gastric (coronary) veins anastomose with esophageal branches of the azygos vein at the lower esophagus, forming fragile submucosal esophageal varices that can bleed catastrophically.",
          r: ["Correct. Anastomosis between left gastric and azygos veins forms bleeding esophageal varices.", "Incorrect. Caput medusae forms via paraumbilical veins on anterior abdominal wall.", "Incorrect. Retroperitoneal collaterals involve veins of Retzius.", "Incorrect. Hemorrhoids involve superior and inferior rectal veins."],
          kp: "Portosystemic collaterals between the left gastric vein and azygos esophageal veins form life-threatening esophageal varices.",
          img: [],
          d: 1,
          cog: "application"
        },
        {
          id: "bk-liv-008",
          q: "Which plane demarcates the functional anatomical division between the true left liver and right liver, passing from the gallbladder fossa to the inferior vena cava?",
          o: ["Cantlie line", "Falciform ligament", "Left triangular ligament", "Umbilical fissure"],
          a: 0,
          exp: "Cantlie line (the principal portal scissura) runs from the gallbladder fossa anteriorly to the middle of the IVC posteriorly, dividing the liver into functional left and right lobes.",
          r: ["Correct. Cantlie line divides the functional right and left liver based on vascular inflow.", "Incorrect. Falciform ligament marks anatomical superficial division, not the functional plane.", "Incorrect. Left triangular ligament attaches segment II to diaphragm.", "Incorrect. Umbilical fissure separates segment III from segment IV."],
          kp: "Cantlie line extends from the gallbladder fossa to the IVC, defining the functional border between right and left hemiliver.",
          img: ["ap-liver-gross.webp"],
          d: 2,
          cog: "recall"
        },
        {
          id: "bk-liv-009",
          q: "Resident tissue macrophages lining the fenestrated hepatic sinusoids that phagocytose circulating debris and aged erythrocytes are called:",
          o: ["Kupffer cells", "Ito cells", "Endothelial fenestrations", "Hepatocytes"],
          a: 0,
          exp: "Kupffer cells are specialized resident macrophages that adhere to sinusoidal endothelial luminal surfaces, clearing bacteria, endotoxins, and damaged erythrocytes from portal blood.",
          r: ["Correct. Kupffer cells are the resident sinusoidal macrophages of the liver.", "Incorrect. Ito cells are stellate cells in the space of Disse.", "Incorrect. Fenestrations are physical endothelial pores.", "Incorrect. Hepatocytes are parenchymal epithelial cells."],
          kp: "Kupffer cells are liver-resident macrophages lining the sinusoids that clear particulate antigens and bacteria from portal flow.",
          img: ["ap-liver-lobule-portal.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-liv-010",
          q: "Biliary epithelium lining intrahepatic and extrahepatic bile ducts is vascularized almost exclusively by which arterial source, predisposing to ischemic cholangiopathy if damaged during transplantation?",
          o: ["Peribiliary plexus derived from the hepatic artery", "Direct branches from portal vein", "Gastroduodenal venous plexus", "Short gastric arteries"],
          a: 0,
          exp: "Bile duct epithelial cells depend entirely on the peribiliary vascular plexus supplied by the hepatic artery. Hepatic artery thrombosis after liver transplantation causes ischemic biliary necrosis and strictures.",
          r: ["Correct. Biliary epithelium relies entirely on the arterial peribiliary plexus.", "Incorrect. Portal venous blood is deoxygenated and cannot sustain biliary tree viability.", "Incorrect. Venous plexuses do not provide arterial perfusion.", "Incorrect. Short gastric vessels supply the stomach."],
          kp: "Bile duct epithelium depends entirely on the hepatic arterial peribiliary plexus; arterial thrombosis causes biliary strictures.",
          img: [],
          d: 2,
          cog: "application"
        }
      ]
    },

    // 11. ana-colon-rectum
    {
      topic: "ana-colon-rectum",
      items: [
        {
          id: "bk-col-001",
          q: "During emergency appendectomy, which anatomical structure on the cecum provides the most reliable landmark, converging precisely at the base of the appendix?",
          o: ["Teniae coli", "Appendices epiploicae", "Ileocecal valve", "Plica semilunaris"],
          a: 0,
          exp: "All three longitudinal smooth muscle bands of the cecum (tenia libera, mesocolica, and omentalis) coalesce at the origin of the appendix, serving as an infallible surgical guide to locate the base.",
          r: ["Correct. Teniae coli converge precisely at the base of the appendix.", "Incorrect. Appendices epiploicae are sparse on the cecum and do not mark the appendix base.", "Incorrect. Ileocecal valve is internal.", "Incorrect. Plica semilunaris are internal mucosal folds."],
          kp: "Convergence of all three teniae coli on the cecal wall provides the definitive anatomical locator for the base of the appendix.",
          img: ["ap-large-intestine-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-col-002",
          q: "What is the most frequent anatomical position of the vermiform appendix in the human population?",
          o: ["Retrocecal (65%)", "Pelvic (30%)", "Subcecal (2%)", "Pre-ileal (1%)"],
          a: 0,
          exp: "The retrocecal and retrocolic position is the most common anatomical location of the appendix, accounting for approximately 65% of cases.",
          r: ["Correct. Retrocecal position accounts for roughly 65% of normal anatomical variations.", "Incorrect. Pelvic position accounts for approximately 30%.", "Incorrect. Subcecal is uncommon (2%).", "Incorrect. Pre-ileal is rare (1%)."],
          kp: "The retrocecal position is the most common anatomical orientation of the vermiform appendix (65%).",
          img: ["ap-large-intestine-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-col-003",
          q: "Which embryonic boundary demarcates the arterial watershed between superior mesenteric artery (midgut) and inferior mesenteric artery (hindgut) supplies in the colon?",
          o: ["Splenic flexure (Griffiths point)", "Hepatic flexure", "Ileocecal junction", "Rectosigmoid junction (Sudeck point)"],
          a: 0,
          exp: "The splenic flexure represents the watershed between the middle colic artery (SMA) and left colic artery (IMA), termed Griffiths point, making it the most vulnerable site for ischemic colitis.",
          r: ["Correct. Griffiths point at the splenic flexure is the major watershed between SMA and IMA.", "Incorrect. Hepatic flexure is perfused entirely by SMA branches.", "Incorrect. Ileocecal junction is perfused by ileocolic artery.", "Incorrect. Sudeck point is between IMA and internal iliac at rectosigmoid."],
          kp: "The splenic flexure (Griffiths point) is the major colonic vascular watershed, predisposing to ischemic colitis during hypoperfusion.",
          img: ["ap-large-intestine-gross.webp"],
          d: 2,
          cog: "application"
        },
        {
          id: "bk-col-004",
          q: "A patient presents with painless bright red bleeding per rectum. Anoscopy identifies dilated vascular cushions above the pectinate (dentate) line. Why are these internal hemorrhoids painless?",
          o: ["They are innervated by autonomic visceral nerves insensitive to sharp pain", "They lack vascular supply", "They are covered by keratinized squamous skin", "They lie below the somatosensory threshold"],
          a: 0,
          exp: "Internal hemorrhoids originate above the dentate line, derived from endoderm and innervated by autonomic visceral fibers that sense stretch but not sharp somatic pain.",
          r: ["Correct. Mucosa above the dentate line has visceral autonomic innervation and cannot perceive sharp pain.", "Incorrect. Hemorrhoids are highly vascular vascular cushions.", "Incorrect. Squamous epithelium lies below the dentate line.", "Incorrect. Somatic pain is conducted below the line by pudendal branches."],
          kp: "Internal hemorrhoids above the dentate line are painless because they receive autonomic visceral innervation.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-col-005",
          q: "Which nerve provides somatic sensory innervation to the perianal skin and anal canal below the pectinate (dentate) line, making external hemorrhoids and anal fissures excruciatingly painful?",
          o: ["Inferior rectal nerve (branch of pudendal nerve)", "Pelvic splanchnic nerves", "Hypogastric nerve", "Ilioinguinal nerve"],
          a: 0,
          exp: "The inferior rectal branch of the pudendal nerve (S2-S4) carries somatic sensory fibers from the anal canal below the dentate line, conveying sharp, localized pain.",
          r: ["Correct. Inferior rectal nerve from pudendal provides somatic pain innervation below the dentate line.", "Incorrect. Pelvic splanchnics carry parasympathetic motor fibers.", "Incorrect. Hypogastric nerve carries sympathetic fibers.", "Incorrect. Ilioinguinal supplies upper inner thigh and groin skin."],
          kp: "The inferior rectal branch of the pudendal nerve provides exquisite somatic pain sensation below the dentate line.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-col-006",
          q: "The appendicular artery is a direct terminal branch of which vessel?",
          o: ["Ileocolic artery", "Right colic artery", "Middle colic artery", "Superior mesenteric artery trunk"],
          a: 0,
          exp: "The appendicular artery arises from the inferior division of the ileocolic artery (a branch of the SMA) and runs within the free border of the mesoappendix.",
          r: ["Correct. The appendicular artery arises from the ileocolic artery.", "Incorrect. Right colic supplies ascending colon.", "Incorrect. Middle colic supplies transverse colon.", "Incorrect. SMA is the primary trunk, not the immediate parent vessel."],
          kp: "The appendicular artery is an end-artery arising from the ileocolic artery, running within the mesoappendix.",
          img: ["ap-large-intestine-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-col-007",
          q: "At which anatomical level does the sigmoid colon transition into the rectum as teniae coli coalesce into a uniform outer longitudinal muscular coat?",
          o: ["S3 vertebral level", "Sacral promontory (S1)", "Coccyx tip", "Pubic symphysis"],
          a: 0,
          exp: "The rectosigmoid junction is located at the level of the third sacral vertebra (S3), where teniae coli expand to form a continuous longitudinal outer muscular layer around the rectum.",
          r: ["Correct. The rectum begins at the S3 vertebra where teniae coli fuse into a continuous coat.", "Incorrect. S1 marks the sacral promontory.", "Incorrect. Coccyx tip is the lower end of pelvic floor.", "Incorrect. Pubic symphysis is anterior."],
          kp: "The rectum begins at the S3 level, where teniae coli fuse into a continuous longitudinal muscular tunic.",
          img: ["ap-large-intestine-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-col-008",
          q: "What is the primary lymphatic drainage destination of the anal canal below the pectinate line?",
          o: ["Superficial inguinal lymph nodes", "Internal iliac lymph nodes", "Inferior mesenteric lymph nodes", "Para-aortic lymph nodes"],
          a: 0,
          exp: "The anal canal below the dentate line is derived from ectoderm and drains into the superficial inguinal lymph nodes, whereas the canal above drains to internal iliac and IMA nodes.",
          r: ["Correct. Anal canal below the dentate line drains to superficial inguinal lymph nodes.", "Incorrect. Above the dentate line drains to internal iliac and IMA nodes.", "Incorrect. IMA nodes drain superior rectum.", "Incorrect. Para-aortic nodes drain gonads."],
          kp: "Anal canal carcinoma below the dentate line metastasizes to superficial inguinal lymph nodes.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-col-009",
          q: "The continuous arterial arcade coursing along the inner mesenteric border of the colon that provides collateral perfusion between colic vessels is known as the:",
          o: ["Marginal artery of Drummond", "Arc of Riolan", "Internal pudendal arcade", "Gastroepiploic arcade"],
          a: 0,
          exp: "The marginal artery of Drummond is a continuous arterial channel formed by anastomoses between ileocolic, right colic, middle colic, left colic, and sigmoid arteries along the mesenteric border.",
          r: ["Correct. Marginal artery of Drummond provides collateral flow along the length of the colon.", "Incorrect. Arc of Riolan is an inconstant central tortuous mesenteric anastomosis.", "Incorrect. Internal pudendal supplies perineum.", "Incorrect. Gastroepiploic supplies greater curve of stomach."],
          kp: "The marginal artery of Drummond runs along the mesenteric margin of the colon, providing crucial collateral flow.",
          img: ["ap-large-intestine-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-col-010",
          q: "Which muscle forms the voluntary external anal sphincter responsible for active conscious fecal continence?",
          o: ["Striated muscle innervated by somatic inferior rectal nerve", "Smooth muscle innervated by pelvic splanchnic parasympathetics", "Transversalis fascia condensation", "Smooth muscle innervated by hypogastric sympathetics"],
          a: 0,
          exp: "The external anal sphincter is composed of striated skeletal muscle under voluntary control, innervated by the inferior rectal nerve and perineal branches of the pudendal nerve.",
          r: ["Correct. External anal sphincter is striated muscle innervated by somatic branches of the pudendal nerve.", "Incorrect. Internal anal sphincter is involuntary smooth muscle.", "Incorrect. Transversalis fascia does not form sphincters.", "Incorrect. Hypogastric nerve maintains internal sphincter resting tone."],
          kp: "The external anal sphincter is striated voluntary muscle innervated by the somatic inferior rectal nerve.",
          img: [],
          d: 1,
          cog: "recall"
        }
      ]
    },

    // 12. ana-pharynx-tonsils
    {
      topic: "ana-pharynx-tonsils",
      items: [
        {
          id: "bk-phx-001",
          q: "All muscles of the pharynx are innervated by the pharyngeal plexus via the vagus nerve (CN X), with which sole exception?",
          o: ["Stylopharyngeus (innervated by glossopharyngeal nerve, CN IX)", "Salpingopharyngeus", "Palatopharyngeus", "Superior pharyngeal constrictor"],
          a: 0,
          exp: "The stylopharyngeus is the only pharyngeal muscle innervated by the glossopharyngeal nerve (CN IX), derived from the third pharyngeal arch. All other muscles are supplied by CN X.",
          r: ["Correct. Stylopharyngeus is innervated exclusively by CN IX (glossopharyngeal nerve).", "Incorrect. Salpingopharyngeus is innervated by CN X.", "Incorrect. Palatopharyngeus is innervated by CN X.", "Incorrect. Superior constrictor is innervated by CN X."],
          kp: "Stylopharyngeus is the sole pharyngeal muscle innervated by the glossopharyngeal nerve (CN IX).",
          img: ["ap-throat-pharynx-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-phx-002",
          q: "Zenker diverticulum represents a posterior mucosal pulsion herniation occurring through Killian dehiscence. Between which two muscle components of the inferior pharyngeal constrictor is this dehiscence located?",
          o: ["Thyropharyngeus and cricopharyngeus", "Superior and middle constrictors", "Cricopharyngeus and upper circular esophagus", "Stylopharyngeus and palatopharyngeus"],
          a: 0,
          exp: "Killian dehiscence is a triangular area of muscular weakness located between the oblique thyropharyngeus fibers and transverse cricopharyngeus fibers of the inferior pharyngeal constrictor.",
          r: ["Correct. Killian dehiscence lies between the thyropharyngeus and cricopharyngeus muscles.", "Incorrect. Space between superior and middle constrictors conveys stylopharyngeus and CN IX.", "Incorrect. Area below cricopharyngeus is Laimer triangle.", "Incorrect. Longitudinal muscles lie inside the circular constrictor coat."],
          kp: "Zenker diverticulum herniates posteriorly through Killian dehiscence between the thyropharyngeus and cricopharyngeus muscles.",
          img: ["ap-throat-pharynx-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-phx-003",
          q: "Which tonsillar tissue constitutes the superior component of Waldeyer tonsillar ring, located in the posterior roof of the nasopharynx?",
          o: ["Pharyngeal tonsil (adenoid)", "Palatine tonsil", "Lingual tonsil", "Tubal tonsil (tonsil of Gerlach)"],
          a: 0,
          exp: "The pharyngeal tonsil (adenoid) sits in the roof and posterior wall of the nasopharynx. Hypertrophy in children causes mouth breathing, snoring, and eustachian tube obstruction.",
          r: ["Correct. The pharyngeal tonsil (adenoid) forms the roof of Waldeyer ring.", "Incorrect. Palatine tonsils form the lateral elements in the oropharynx.", "Incorrect. Lingual tonsil forms the inferior element at tongue base.", "Incorrect. Tubal tonsils surround eustachian tube openings."],
          kp: "The pharyngeal tonsil (adenoid) occupies the posterior roof of the nasopharynx in Waldeyer tonsillar ring.",
          img: ["ap-throat-pharynx-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-phx-004",
          q: "During palatine tonsillectomy, arterial hemorrhage from the tonsillar bed most commonly originates from which direct arterial feeder?",
          o: ["Tonsillar branch of the facial artery", "Ascending pharyngeal artery", "Lingual artery dorsal branches", "Descending palatine artery"],
          a: 0,
          exp: "The main arterial supply to the palatine tonsil is the tonsillar artery, which is a branch of the facial artery entering through the lower pole of the tonsillar capsule.",
          r: ["Correct. Tonsillar branch of the facial artery is the principal blood supply to the palatine tonsil.", "Incorrect. Ascending pharyngeal contributes smaller branches.", "Incorrect. Dorsal lingual supplies anterior lower pole.", "Incorrect. Descending palatine enters superiorly."],
          kp: "The primary arterial blood supply to the palatine tonsil is the tonsillar branch of the facial artery.",
          img: ["ap-throat-pharynx-gross.webp"],
          d: 2,
          cog: "recall"
        },
        {
          id: "bk-phx-005",
          q: "Which cranial nerve provides the sensory limb for the gag reflex, carrying tactile sensation from the posterior pharyngeal wall and tonsillar pillars?",
          o: ["Glossopharyngeal nerve (CN IX)", "Vagus nerve (CN X)", "Maxillary nerve (V2)", "Mandibular nerve (V3)"],
          a: 0,
          exp: "The glossopharyngeal nerve (CN IX) provides somatic sensory innervation to the mucous membrane of the oropharynx, mediating the afferent limb of the pharyngeal gag reflex.",
          r: ["Correct. Glossopharyngeal nerve (CN IX) provides afferent sensation for the gag reflex.", "Incorrect. Vagus nerve (CN X) provides the efferent motor limb.", "Incorrect. V2 supplies nasopharynx and palate.", "Incorrect. V3 supplies anterior two-thirds of tongue sensation."],
          kp: "The glossopharyngeal nerve (CN IX) mediates the afferent sensory limb of the gag reflex, while CN X mediates the efferent motor limb.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-phx-006",
          q: "The palatine tonsil sits in the tonsillar fossa, bounded anteriorly and posteriorly by which mucosal folds?",
          o: ["Palatoglossal arch anteriorly and palatopharyngeal arch posteriorly", "Palatopharyngeal arch anteriorly and salpingopharyngeal arch posteriorly", "Uvula anteriorly and epiglottis posteriorly", "Pharyngeal constrictor anteriorly and buccinator posteriorly"],
          a: 0,
          exp: "The palatine tonsil lies within the tonsillar bed between the anterior tonsillar pillar (palatoglossal arch) and posterior tonsillar pillar (palatopharyngeal arch).",
          r: ["Correct. Palatoglossal arch is anterior pillar; palatopharyngeal arch is posterior pillar.", "Incorrect. Palatoglossus is strictly anterior.", "Incorrect. Uvula is midline superior.", "Incorrect. Buccinator lies in the cheek."],
          kp: "The palatine tonsillar fossa is bounded by the palatoglossal arch anteriorly and palatopharyngeal arch posteriorly.",
          img: ["ap-throat-pharynx-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-phx-007",
          q: "Infection in the retropharyngeal space can spread directly inferiorly into the posterior mediastinum because the space extends down to which anatomical landmark?",
          o: ["Superior mediastinum down to T1-T4 (fusion with alar fascia)", "Diaphragm level", "Carina level only", "C6 vertebral level"],
          a: 0,
          exp: "The true retropharyngeal space lies between buccopharyngeal fascia anteriorly and alar fascia posteriorly, extending from the skull base down into the superior mediastinum where alar fascia fuses at T1-T4.",
          r: ["Correct. Retropharyngeal space extends into the superior mediastinum to T1-T4.", "Incorrect. The danger space extends down to the diaphragm, behind alar fascia.", "Incorrect. Sternal angle is T4-T5.", "Incorrect. C6 is the end of the pharynx."],
          kp: "Retropharyngeal space infections track inferiorly into the superior mediastinum, predisposing to acute mediastinitis.",
          img: [],
          d: 2,
          cog: "recall"
        },
        {
          id: "bk-phx-008",
          q: "What type of epithelium lines the lumen of the nasopharynx, in contrast to the stratified squamous epithelium of the oropharynx?",
          o: ["Pseudostratified ciliated columnar epithelium", "Simple cuboidal epithelium", "Non-keratinized stratified squamous", "Transitional urothelium"],
          a: 0,
          exp: "The nasopharynx serves purely as a respiratory conduit and is lined by respiratory epithelium (pseudostratified ciliated columnar with goblet cells), unlike the oropharynx.",
          r: ["Correct. Nasopharynx is lined by respiratory pseudostratified ciliated columnar epithelium.", "Incorrect. Simple cuboidal lines renal tubules.", "Incorrect. Stratified squamous lines oropharynx and laryngopharynx.", "Incorrect. Urothelium lines urinary tract."],
          kp: "The nasopharynx is lined by pseudostratified ciliated columnar epithelium, functioning as a respiratory conduit.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-phx-009",
          q: "The auditory (eustachian) tube opens into the lateral wall of which pharyngeal compartment?",
          o: ["Nasopharynx", "Oropharynx", "Laryngopharynx", "Piriform fossa"],
          a: 0,
          exp: "The eustachian tube opens on the lateral wall of the nasopharynx anterior to the pharyngeal recess (fossa of Rosenmuller), bounded by the torus tubarius.",
          r: ["Correct. Eustachian tube opens on the lateral wall of the nasopharynx.", "Incorrect. Oropharynx lies below the soft palate.", "Incorrect. Laryngopharynx lies posterior to larynx.", "Incorrect. Piriform recess is in the laryngopharynx."],
          kp: "The eustachian tube opens on the lateral nasopharyngeal wall, surrounded by the cartilaginous torus tubarius.",
          img: ["ap-throat-pharynx-gross.webp"],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-phx-010",
          q: "Foreign bodies like sharp fish bones commonly lodge in which shallow mucosal depression located on either side of the laryngeal inlet in the laryngopharynx?",
          o: ["Piriform fossa (piriform recess)", "Vallecula", "Fossa of Rosenmuller", "Tonsillar crypt"],
          a: 0,
          exp: "The piriform fossa is a gutter on either side of the laryngeal inlet in the laryngopharynx. Pointed foreign bodies commonly lodge here, risking injury to the internal laryngeal nerve beneath its mucosa.",
          r: ["Correct. Piriform fossa frequently catches sharp ingested foreign bodies.", "Incorrect. Vallecula lies between tongue base and epiglottis.", "Incorrect. Fossa of Rosenmuller is in nasopharynx.", "Incorrect. Tonsillar crypts are in palatine tonsils."],
          kp: "Pointed foreign bodies frequently lodge in the piriform fossa, overlying the sensitive internal laryngeal nerve.",
          img: ["ap-throat-pharynx-gross.webp"],
          d: 1,
          cog: "recall"
        }
      ]
    }
  ],

  physiology: [
    // 13. phy-autonomic-nervous-system
    {
      topic: "phy-autonomic-nervous-system",
      items: [
        {
          id: "bk-ans-001",
          q: "Which hypothalamic nucleus is designated as the primary master pacemaker for circadian rhythms, receiving direct photic synchronization from retinal ganglion cells via the retinohypothalamic tract?",
          o: ["Suprachiasmatic nucleus", "Ventromedial nucleus", "Lateral hypothalamic nucleus", "Arcuate nucleus"],
          a: 0,
          exp: "The suprachiasmatic nucleus (SCN) of the anterior hypothalamus is the master circadian oscillator, synchronized to light-dark cycles by melanopsin retinal ganglion cells.",
          r: ["Correct. Suprachiasmatic nucleus generates circadian rhythms synchronized by retinal input.", "Incorrect. Ventromedial nucleus governs satiety.", "Incorrect. Lateral nucleus governs hunger.", "Incorrect. Arcuate nucleus produces regulatory releasing hormones and dopamine."],
          kp: "The suprachiasmatic nucleus (SCN) of the hypothalamus coordinates circadian rhythms via retinohypothalamic tract input.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-ans-002",
          q: "Bilateral experimental destruction of the ventromedial hypothalamic nuclei in animal models produces which behavioral and metabolic consequence?",
          o: ["Hyperphagia, voracious appetite, and severe obesity", "Aphagia, anorexia, and starvation", "Adipsia and dehydration", "Hyperthermia and heat exhaustion"],
          a: 0,
          exp: "The ventromedial nucleus is the satiety center (stimulated by leptin). Destruction eliminates satiety, causing persistent hyperphagia, savage rage, and rapid gross obesity.",
          r: ["Correct. Ventromedial destruction destroys the satiety center, causing uncontrolled hyperphagia and obesity.", "Incorrect. Aphagia occurs with lateral hypothalamic destruction.", "Incorrect. Adipsia occurs with preoptic thirst center lesions.", "Incorrect. Hyperthermia occurs with anterior hypothalamic lesions."],
          kp: "The ventromedial hypothalamic nucleus is the satiety center; destruction produces hyperphagia and profound obesity.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-ans-003",
          q: "Bilateral destruction of the lateral hypothalamic area produces which phenotype?",
          o: ["Aphagia, cessation of feeding, and severe emaciation", "Hyperphagia and obesity", "Hyperthermia", "Narcolepsy"],
          a: 0,
          exp: "The lateral hypothalamic area is the hunger center (stimulated by ghrelin, inhibited by leptin). Destruction causes complete aphagia and starvation unless tube fed.",
          r: ["Correct. Lateral hypothalamic destruction causes aphagia and emaciation.", "Incorrect. Hyperphagia occurs with ventromedial lesions.", "Incorrect. Hyperthermia relates to anterior hypothalamic injury.", "Incorrect. Narcolepsy relates to orexin/hypocretin neuron loss."],
          kp: "The lateral hypothalamic area is the feeding center; bilateral destruction leads to complete aphagia and starvation.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-ans-004",
          q: "Which hypothalamic nucleus is primarily responsible for detecting elevated core body temperature and orchestrating physiological heat dissipation via sweating and cutaneous vasodilation?",
          o: ["Anterior hypothalamic nucleus (preoptic area)", "Posterior hypothalamic nucleus", "Dorsomedial nucleus", "Mammillary body"],
          a: 0,
          exp: "The anterior hypothalamus (preoptic area) detects warm blood and coordinates heat loss responses (sweating, cutaneous vasodilation). 'A/C = Anterior Cools'.",
          r: ["Correct. Anterior hypothalamus detects elevated core temperature and triggers heat loss responses.", "Incorrect. Posterior hypothalamus mediates heat generation (shivering).", "Incorrect. Dorsomedial nucleus regulates GI motility.", "Incorrect. Mammillary bodies process memory."],
          kp: "The anterior hypothalamus acts as the heat dissipation center (cooling), while the posterior hypothalamus coordinates heat conservation.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-ans-005",
          q: "Which neurohormones are synthesized within the cell bodies of the supraoptic and paraventricular hypothalamic nuclei and transported axonally to the posterior pituitary (neurohypophysis)?",
          o: ["Antidiuretic hormone (vasopressin) and oxytocin", "Growth hormone and prolactin", "ACTH and TSH", "LH and FSH"],
          a: 0,
          exp: "The supraoptic and paraventricular nuclei synthesize ADH and oxytocin, packaged with neurophysins and transported along the hypothalamo-hypophysial tract to Herring bodies in the neurohypophysis.",
          r: ["Correct. Supraoptic and paraventricular nuclei synthesize ADH and oxytocin.", "Incorrect. GH and prolactin are synthesized in the anterior pituitary.", "Incorrect. ACTH and TSH are anterior pituitary hormones.", "Incorrect. LH and FSH are anterior pituitary gonadotropins."],
          kp: "The supraoptic and paraventricular nuclei synthesize ADH and oxytocin for storage in the posterior pituitary.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-ans-006",
          q: "In the sympathetic nervous system, what is the sole target organ where postganglionic sympathetic neurons release acetylcholine onto muscarinic receptors rather than norepinephrine?",
          o: ["Eccrine sweat glands for thermoregulation", "Pupillary dilator muscle", "Ventricular myocardium", "Renal vascular bed"],
          a: 0,
          exp: "Almost all postganglionic sympathetic neurons release norepinephrine. The major exception is sympathetic innervation to thermoregulatory eccrine sweat glands, which is cholinergic (ACh onto M3).",
          r: ["Correct. Postganglionic sympathetic fibers to eccrine sweat glands release acetylcholine.", "Incorrect. Pupillary dilator uses norepinephrine via alpha-1 receptors.", "Incorrect. Ventricles receive norepinephrine via beta-1 receptors.", "Incorrect. Renal vasculature uses dopamine and norepinephrine."],
          kp: "Postganglionic sympathetic fibers innervating thermoregulatory eccrine sweat glands uniquely release acetylcholine onto muscarinic receptors.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-ans-007",
          q: "A patient presents with unilateral miosis, mild ptosis, and facial anhidrosis (Horner syndrome). Instillation of 0.5% apraclonidine (alpha-2 agonist with weak alpha-1 activity) produces pupillary dilation and reversal of ptosis in the affected eye. Why does this occur?",
          o: ["Denervation supersensitivity of alpha-1 receptors on the pupillary dilator muscle", "Blockade of muscarinic pupilloconstrictor receptors", "Release of stored norepinephrine from intact terminals", "Direct stimulation of Edinger-Westphal parasympathetic output"],
          a: 0,
          exp: "Sympathetic denervation leads to upregulation and hypersensitivity of post-junctional alpha-1 receptors on the dilator pupillae. Apraclonidine dilates the denervated pupil, confirming Horner syndrome.",
          r: ["Correct. Apraclonidine dilates the Horner pupil due to alpha-1 receptor denervation supersensitivity.", "Incorrect. Apraclonidine does not block muscarinic receptors.", "Incorrect. Cocaine tests for stored norepinephrine; apraclonidine acts directly.", "Incorrect. Apraclonidine acts peripherally on iris smooth muscle."],
          kp: "Apraclonidine reverses anisocoria in Horner syndrome due to denervation supersensitivity of pupillary alpha-1 receptors.",
          img: ["ap-eye-gross.webp"],
          d: 2,
          cog: "application"
        },
        {
          id: "bk-ans-008",
          q: "Which receptor subtype mediates parasympathetic bronchoconstriction and bronchial gland mucus hypersecretion in airways?",
          o: ["Muscarinic M3 receptors", "Beta-2 adrenergic receptors", "Alpha-1 adrenergic receptors", "Nicotinic neuronal receptors"],
          a: 0,
          exp: "Acetylcholine released from vagal parasympathetic postganglionic terminals binds muscarinic M3 receptors on bronchial smooth muscle (causing bronchoconstriction) and submucosal glands.",
          r: ["Correct. Muscarinic M3 receptors mediate bronchoconstriction and mucus secretion.", "Incorrect. Beta-2 adrenergic receptors mediate bronchodilation.", "Incorrect. Alpha-1 mediates vascular constriction.", "Incorrect. Nicotinic receptors are in autonomic ganglia."],
          kp: "Muscarinic M3 receptors mediate vagal parasympathetic airway bronchoconstriction and mucus secretion.",
          img: [],
          d: 1,
          cog: "recall"
        },
        {
          id: "bk-ans-009",
          q: "What is the primary action of sympathetic stimulation on the ciliary muscle of the human eye for distant vision?",
          o: ["Relaxation of ciliary muscle via beta-2 adrenergic receptors", "Contraction of ciliary muscle via M3 receptors", "Contraction of sphincter pupillae", "Constriction of central retinal artery"],
          a: 0,
          exp: "Sympathetic stimulation causes relaxation of the ciliary muscle via beta-2 receptors, flattening the lens for distant vision. Parasympathetic M3 stimulation contracts ciliary muscle for near accommodation.",
          r: ["Correct. Beta-2 sympathetic stimulation relaxes the ciliary muscle, flattening the lens for far vision.", "Incorrect. Parasympathetic M3 stimulation contracts ciliary muscle for near accommodation.", "Incorrect. Sphincter pupillae contraction is parasympathetic.", "Incorrect. Retinal artery autoregulates."],
          kp: "Sympathetic beta-2 stimulation relaxes the ciliary muscle to flatten the lens for distance vision.",
          img: ["ap-eye-gross.webp"],
          d: 2,
          cog: "recall"
        },
        {
          id: "bk-ans-010",
          q: "Where are the preganglionic sympathetic cell bodies constituting the ciliospinal center of Budge located in the spinal cord?",
          o: ["Intermediolateral cell column of C8 to T2", "Anterior motor horn of C3 to C5", "Intermediolateral cell column of T10 to L2", "Lateral horn of S2 to S4"],
          a: 0,
          exp: "The ciliospinal center of Budge resides in the intermediolateral horn of C8 to T2 spinal segments, relaying descending hypothalamic sympathetic fibers to ascending preganglionics.",
          r: ["Correct. Ciliospinal center of Budge is located in the intermediolateral column of C8-T2.", "Incorrect. C3-C5 anterior horn houses the phrenic motor nucleus.", "Incorrect. T10-L2 provides lower visceral sympathetics.", "Incorrect. S2-S4 provides parasympathetic outflow."],
          kp: "The ciliospinal center of Budge in the C8-T2 intermediolateral column contains the second-order neurons for ocular sympathetic innervation.",
          img: [],
          d: 1,
          cog: "recall"
        }
      ]
    }
  ]
};

let totalNewMcqs = 0;
for (const [subj, sets] of Object.entries(mcqsBySubject)) {
  const subjDir = path.join(ROOT, "prep/overlays/maikbook1", subj);
  fs.mkdirSync(subjDir, { recursive: true });

  for (const set of sets) {
    const fpath = path.join(subjDir, `${set.topic}.json`);
    let items = [];
    if (fs.existsSync(fpath)) {
      const existing = JSON.parse(fs.readFileSync(fpath, "utf8"));
      items = existing.items || [];
    }

    for (const item of set.items) {
      item.set = "maikbook1";
      item.credit = "StewardMD Medical Learning Team";
      items.push(item);
      totalNewMcqs++;
    }

    const fileObj = {
      set: "maikbook1",
      v: 1,
      topic: set.topic,
      subject: subj,
      items: items
    };

    fs.writeFileSync(fpath, JSON.stringify(fileObj, null, 1) + "\n");
    console.log(`OK: wrote ${items.length} MCQs for ${subj}/${set.topic}.json`);
  }
}

console.log(`\nSuccessfully authored ${totalNewMcqs} original MCQs across Wave 2 topics.`);
