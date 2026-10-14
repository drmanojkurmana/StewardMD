#!/usr/bin/env python3
"""
Wire wave 2 medical SVG diagrams into lesson steps.
Updates 15 lessons across Anatomy, Physiology, Pharmacology, Pathology, Biochemistry, and Microbiology.
"""

import json
import os
import sys

UPDATES = {
    "prep/lessons/v1/ana-germ-layers.json": {
        1: { # Step 2
            "kind": "image",
            "src": "prep/lessons/media/ana-trilaminar-disc.svg",
            "alt": "Schematic cross-section of the third-week human trilaminar germ disc showing ectoderm, mesoderm with notochord and somites, and endoderm, with clinical derivatives of each layer.",
            "caption": "Trilaminar embryonic disc: gastrulation produces ectoderm, mesoderm (notochord, paraxial somites), and endoderm.",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/ana-peritoneum.json": {
        2: { # Step 3
            "kind": "image",
            "src": "prep/lessons/media/ana-epiploic-foramen.svg",
            "alt": "Anatomical orientation diagram of the epiploic foramen at T12 connecting the greater and lesser peritoneal sacs, detailing the anterior portal triad, posterior inferior vena cava, superior caudate lobe, and inferior first part of duodenum.",
            "caption": "Epiploic foramen of Winslow: anterior portal triad in lesser omentum, posterior IVC at T12, superior caudate lobe, inferior duodenum.",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/ana-thyroid-root.json": {
        1: { # Step 2
            "kind": "image",
            "src": "prep/lessons/media/ana-thyroid-relations.svg",
            "alt": "Anterior anatomical schematic of the thyroid gland, trachea, and larynx, showing the superior thyroid artery related to the external laryngeal nerve, the inferior thyroid artery intimately related to the recurrent laryngeal nerve, and the isthmus crossing tracheal rings 2 to 4.",
            "caption": "Thyroid surgical relations: STA ligated close to gland to protect external laryngeal nerve; ITA ligated far to protect recurrent laryngeal nerve.",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/ana-vessels-lymphatics.json": {
        1: { # Step 2
            "kind": "image",
            "src": "prep/lessons/media/ana-carotid-branches.svg",
            "alt": "Schematic branching tree of the external carotid artery showing the eight branches organized into anterior, medial, posterior, and terminal groups, originating from the common carotid bifurcation at C3-C4.",
            "caption": "External carotid branches: 3 anterior (STA, lingual, facial), 1 medial (ascending pharyngeal), 2 posterior (occipital, post-auricular), 2 terminal (maxillary, superficial temporal).",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/ana-twinning-teratology.json": {
        3: { # Step 4
            "kind": "image",
            "src": "prep/lessons/media/ana-twinning-timing.svg",
            "alt": "Embryological timeline diagram illustrating the outcomes of monozygotic twinning based on division day: dichorionic diamniotic (days 0-3), monochorionic diamniotic (days 4-8), monochorionic monoamniotic (days 8-12), and conjoined twins (after day 13).",
            "caption": "Monozygotic twinning: days 0-3 split gives Di-Di; days 4-8 gives Mo-Di (TTTS risk); days 8-12 gives Mo-Mo (entanglement risk); >day 13 yields conjoined twins.",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/ana-mixed.json": {
        0: { # Step 1
            "kind": "image",
            "src": "prep/lessons/media/ana-allens-test.svg",
            "alt": "Stepwise clinical protocol for the modified Allen test evaluating collateral arterial perfusion via the superficial and deep palmar arches prior to radial artery cannulation or puncture.",
            "caption": "Modified Allen's test: palmar flushing within 5 to 7 seconds confirms ulnar collateral patency before radial cannulation.",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/phy-acid-base.json": {
        2: { # Step 3
            "kind": "image",
            "src": "prep/lessons/media/phy-acid-base-map.svg",
            "alt": "Bicarbonate versus blood pH nomogram showing physiological normal point (pH 7.40, HCO3- 24 mEq/L, PaCO2 40 mmHg), isopleths of PaCO2, and four primary acid-base quadrants with compensatory trajectories.",
            "caption": "Davenport diagram: metabolic acidosis/alkalosis and respiratory acidosis/alkalosis quadrants with physiological compensation pathways.",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/phy-body-fluids.json": {
        0: { # Step 1
            "kind": "image",
            "src": "prep/lessons/media/phy-fluid-compartments.svg",
            "alt": "The 60-40-20 rule for total body water distribution in a 70 kg individual showing intracellular fluid, interstitial fluid, plasma, and their respective dilution volume measurement markers.",
            "caption": "60-40-20 rule: TBW is 60% (D2O), ICF is 40% (calculated), ECF is 20% (Inulin), divided into interstitial fluid 15% and plasma 5% (Evans blue).",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/phy-hypothalamus-limbic.json": {
        2: { # Step 3
            "kind": "image",
            "src": "prep/lessons/media/phy-appetite-nuclei.svg",
            "alt": "Schematic of hypothalamic appetite centers showing the lateral hunger center, ventromedial satiety center, and arcuate nucleus integrating peripheral hormonal signals including leptin, ghrelin, insulin, and orexin.",
            "caption": "Appetite regulation: Lateral hypothalamus drives feeding (orexin/ghrelin); Ventromedial nucleus mediates satiety (leptin/alpha-MSH).",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/phy-motor-reflexes.json": {
        1: { # Step 2
            "kind": "image",
            "src": "prep/lessons/media/phy-stretch-reflex.svg",
            "alt": "Neuroanatomical circuit diagram showing the muscle spindle Ia primary sensory afferent synapsing directly onto the alpha motor neuron in the spinal cord ventral horn, alongside reciprocal inhibition of antagonist muscles.",
            "caption": "Monosynaptic stretch reflex: muscle spindle Ia afferent synapses directly on alpha motor neuron, with reciprocal interneuron inhibition of antagonist.",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/phm-diuretics.json": {
        0: { # Step 1
            "kind": "image",
            "src": "prep/lessons/media/pharma-nephron-diuretics.svg",
            "alt": "Nephron schematic illustrating the sites of action, transporter targets, and clinical classes of diuretics from the proximal convoluted tubule to the collecting duct.",
            "caption": "Nephron diuretic sites: PCT (Acetazolamide CA-I), TAL (Loop NKCC2 inhibitor), DCT (Thiazide NCC inhibitor), and Collecting Duct (K+-sparing).",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/phm-raas.json": {
        0: { # Step 1
            "kind": "image",
            "src": "prep/lessons/media/pharma-raas-pathway.svg",
            "alt": "Stepwise biochemical cascade of the renin-angiotensin-aldosterone axis showing direct renin inhibitors, ACE inhibitors, angiotensin receptor blockers, and aldosterone antagonists with their physiological targets.",
            "caption": "RAAS pathway: Renin (Aliskiren), ACE (ACE-I), Angiotensin II AT1 receptors (ARBs), and Aldosterone (Spironolactone).",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/pat-cell-injury-necrosis.json": {
        2: { # Step 3
            "kind": "image",
            "src": "prep/lessons/media/path-necrosis-patterns.svg",
            "alt": "Comparative pathological guide to the six classic patterns of necrosis: coagulative, liquefactive, caseous, fat, fibrinoid, and gangrenous necrosis, with histological characteristics and clinical examples.",
            "caption": "Six necrosis patterns: coagulative (solid organ infarcts), liquefactive (brain stroke, abscess), caseous (TB), fat (pancreatitis), fibrinoid (PAN), gangrenous (foot).",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/bio-etc-oxphos.json": {
        0: { # Step 1
            "kind": "image",
            "src": "prep/lessons/media/bio-etc-complexes.svg",
            "alt": "Biochemical pathway diagram of the inner mitochondrial membrane showing respiratory complexes I through IV, ATP synthase (complex V), proton pumping into the intermembrane space, and specific pharmacological and poison inhibitors.",
            "caption": "Electron Transport Chain: Complexes I, III, IV pump H+ to create proton motive force for ATP synthase; Rotenone, Antimycin A, Cyanide/CO, and Oligomycin inhibit specific complexes.",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/mic-general-virology.json": {
        0: { # Step 1
            "kind": "image",
            "src": "prep/lessons/media/micro-viral-structure.svg",
            "alt": "Structural comparison of non-enveloped (naked) versus enveloped viruses, showing nucleic acid core, protein capsid, lipid bilayer envelope, glycoprotein spikes, and physical resistance differences.",
            "caption": "Virion architecture: naked viruses have resistant protein capsids (fecal-oral transmission); enveloped viruses have labile host lipid bilayers (respiratory/blood transmission).",
            "ar": 1.5384615384615385
        }
    }
}

for path, step_updates in UPDATES.items():
    if not os.path.exists(path):
        print(f"Error: {path} not found")
        sys.exit(1)
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    for step_idx, vis_obj in step_updates.items():
        data["steps"][step_idx]["vis"] = vis_obj
        print(f"Updated {path} step {step_idx + 1} -> {vis_obj['src']}")
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(data, indent=1) + "\n")

print("\nAll 15 lesson files successfully updated.")
