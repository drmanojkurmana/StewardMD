import json
import os
import sys

UPDATES = {
    "prep/lessons/v1/phm-pharmacodynamics.json": {
        3: { # 0-indexed step 3 (Step 4)
            "kind": "image",
            "src": "prep/lessons/media/pharma-dose-response.svg",
            "alt": "Sigmoid log concentration-response curves showing a full agonist at Emax 100 percent, a competitive antagonist causing a parallel rightward shift with preserved Emax, a non-competitive antagonist depressing Emax to 50 percent, and a partial agonist reaching submaximal efficacy.",
            "caption": "Log dose-response: competitive antagonist shifts curve right (higher EC50, same Emax); non-competitive depresses Emax.",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/phm-pharmacokinetics.json": {
        2: { # 0-indexed step 2 (Step 3)
            "kind": "image",
            "src": "prep/lessons/media/pharma-elimination-kinetics.svg",
            "alt": "Comparative plasma concentration decline curves over time: first-order elimination shows exponential decline with constant half-life (constant fraction eliminated per hour); zero-order elimination displays linear decline (constant amount eliminated per hour).",
            "caption": "Elimination kinetics: first-order rate is concentration-dependent (constant half-life); zero-order rate is constant and saturable.",
            "ar": 1.5384615384615385
        },
        4: { # 0-indexed step 4 (Step 5)
            "kind": "image",
            "src": "prep/lessons/media/pharma-therapeutic-index.svg",
            "alt": "Therapeutic index curves plotting cumulative population frequency against drug dose: effective dose curve (ED50) and toxic dose curve (TD50). The therapeutic index is the ratio TD50 to ED50, defining the margin of safety.",
            "caption": "Therapeutic index: ratio of toxic dose (TD50) to effective dose (ED50); narrow margins require therapeutic drug monitoring.",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/mic-antibodies-complement.json": {
        1: { # 0-indexed step 1 (Step 2)
            "kind": "image",
            "src": "prep/lessons/media/micro-antibody-response.svg",
            "alt": "Serum antibody titre comparison following initial antigen exposure versus booster exposure: primary response shows 5 to 7 day lag with modest IgM preceding IgG; secondary response exhibits brief 1 to 3 day lag, massive IgG production, and affinity maturation.",
            "caption": "Humoral immune kinetics: primary response is IgM-predominant; secondary anamnestic response is rapid and IgG-dominated.",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/mic-history-morphology.json": {
        1: { # 0-indexed step 1 (Step 2)
            "kind": "image",
            "src": "prep/lessons/media/micro-cell-wall.svg",
            "alt": "Cross-sectional comparison of bacterial envelopes: Gram-positive bacteria have thick multilayered peptidoglycan with teichoic and lipoteichoic acids above a single cell membrane; Gram-negative bacteria feature an outer membrane with lipopolysaccharide endotoxin and porins, thin periplasmic peptidoglycan, and inner cytoplasmic membrane.",
            "caption": "Bacterial envelope: Gram-positive has thick peptidoglycan and teichoic acid; Gram-negative has outer membrane LPS endotoxin and periplasm.",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/mic-culture-identification.json": {
        1: { # 0-indexed step 1 (Step 2)
            "kind": "image",
            "src": "prep/lessons/media/micro-growth-curve.svg",
            "alt": "Bacterial growth curve plotting log viable cell count against incubation time: 1. Lag phase with metabolic adaptation; 2. Log or exponential phase with maximal binary fission; 3. Stationary phase with balanced cell division and death; 4. Decline or death phase with exponential viability loss.",
            "caption": "Bacterial growth cycle: liquid media support progression through lag, log (exponential division), stationary, and decline phases.",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/pat-acute-inflammation.json": {
        1: { # 0-indexed step 1 (Step 2)
            "kind": "image",
            "src": "prep/lessons/media/path-extravasation.svg",
            "alt": "Stepwise sequence of neutrophil extravasation: margination, selectin-mediated rolling (E-selectin, P-selectin), integrin activation and firm adhesion (LFA-1, Mac-1 binding ICAM-1), PECAM-1 (CD31) diapedesis through endothelial junctions, and chemotaxis toward inflammatory chemoattractants.",
            "caption": "Leukocyte recruitment cascade: selectins mediate rolling, integrins mediate firm adhesion, PECAM-1 (CD31) drives transmigration.",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/pat-apoptosis.json": {
        1: { # 0-indexed step 1 (Step 2)
            "kind": "image",
            "src": "prep/lessons/media/path-apoptosis-pathways.svg",
            "alt": "Apoptosis signaling pathways: intrinsic mitochondrial pathway mediated by pro-apoptotic Bax and Bak releasing cytochrome c to activate initiator caspase 9; extrinsic death receptor pathway via FasL or TNF activating initiator caspase 8; both converging on executioner caspases 3, 6, and 7.",
            "caption": "Apoptosis pathways: intrinsic (mitochondrial/cytochrome c/caspase-9) and extrinsic (death receptor/caspase-8) converge on executioner caspase-3.",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/pat-chronic-granulomatous.json": {
        3: { # 0-indexed step 3 (Step 4)
            "kind": "image",
            "src": "prep/lessons/media/path-granuloma.svg",
            "alt": "Concentric architecture of a caseating tuberculous granuloma: central acellular eosinophilic caseous necrosis, surrounded by epithelioid histiocytes and multinucleated horseshoe Langhans giant cells, enclosed by a rim of CD4 T lymphocytes and outer fibroblasts.",
            "caption": "Caseating granuloma: central necrosis, horseshoe Langhans giant cells, epithelioid macrophages, and peripheral lymphocytic cuff.",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/bio-enzymes-kinetics.json": {
        2: { # 0-indexed step 2 (Step 3)
            "kind": "image",
            "src": "prep/lessons/media/bio-lineweaver-burk.svg",
            "alt": "Lineweaver-Burk double reciprocal plot showing 1/V versus 1/[S]. Competitive inhibition line intersects at identical Y-intercept (same 1/Vmax) with X-intercept shifted rightward towards origin (increased Km). Non-competitive inhibition line shares identical X-intercept (same -1/Km) with higher Y-intercept (reduced Vmax).",
            "caption": "Lineweaver-Burk plot: competitive inhibitors increase Km (same Vmax, same Y-intercept); non-competitive inhibitors decrease Vmax (same Km, same X-intercept).",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/bio-glycolysis-tca.json": {
        1: { # 0-indexed step 1 (Step 2)
            "kind": "image",
            "src": "prep/lessons/media/bio-glycolysis-tca.svg",
            "alt": "Metabolic pathway map connecting cytoplasmic glycolysis to mitochondrial respiration. Glucose converts to 2 pyruvate yielding 2 ATP and 2 NADH. Pyruvate dehydrogenase decarboxylates pyruvate to Acetyl-CoA. Krebs citric acid cycle produces 3 NADH, 1 FADH2, and 1 GTP per turn, fueling oxidative phosphorylation to produce 30 to 32 ATP.",
            "caption": "Cellular respiration hub: Glycolysis feeds Pyruvate Dehydrogenase, fueling the Krebs TCA cycle and oxidative phosphorylation (~30-32 ATP).",
            "ar": 1.5384615384615385
        }
    },
    "prep/lessons/v1/bio-purine-pyrimidine.json": {
        3: { # 0-indexed step 3 (Step 4)
            "kind": "image",
            "src": "prep/lessons/media/bio-purine-pathway.svg",
            "alt": "Purine metabolism pathway: HGPRT salvage recycling hypoxanthine and guanine back to IMP and GMP (blocked in Lesch-Nyhan syndrome), and Xanthine Oxidase catabolism producing uric acid, inhibited by allopurinol and febuxostat.",
            "caption": "Purine salvage versus degradation: HGPRT salvages bases; Xanthine Oxidase degrades them to uric acid (target of Allopurinol/Febuxostat).",
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

print("\nAll 11 lesson files successfully updated.")
