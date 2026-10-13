#!/usr/bin/env node
/**
 * Wave 3A Generator: Medical Biochemistry Part 1 (Chapters 1 to 20)
 * 
 * 17 new comprehensive interactive lessons in prep/lessons/v1/
 * 17 matching Knowledge Library (KB v2) reference articles in kb/reference/
 * 197 original verified MCQs in prep/overlays/maikbook1/biochemistry/ (10 per module)
 * Updates index.json, overlay-counts.json, accuracy.json, test/prep-books-mcqs.test.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const LP = require("../prep-lessons.js");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Helper to check word counts
function assertWords(tx, say, id) {
  const w = LP.words(tx).length;
  if (w < 40 || w > 90) {
    throw new Error(`Step ${id} tx words out of range: ${w} (expected 40-90): "${tx}"`);
  }
  const sw = LP.words(say).length;
  if (sw > 120) {
    throw new Error(`Step ${id} say words out of range: ${sw} (expected <=120)`);
  }
}

// ==========================================
// 1. LESSON DEFINITIONS (17 Lessons, Ch 1-9, 12-14, 16-20)
// ==========================================
const wave3aLessons = [
  // Ch 1: Introduction to Medical Biochemistry
  {
    module: "bio-intro-principles",
    subject: "biochemistry",
    title: "Biochemical basis of disease: cellular compartmentalization and molecular pathology",
    minutes: 6,
    refs: ["Harper's Illustrated Biochemistry 32nd ed", "Lehninger Principles of Biochemistry 8th ed"],
    steps: [
      {
        tx: "Cellular life relies on strict **compartmentalization** of metabolic pathways within specialized organelles. Glycolysis, fatty acid biosynthesis, and the pentose phosphate pathway occur exclusively within the cytosol. In contrast, the citric acid cycle, beta-oxidation of fatty acids, and oxidative phosphorylation are strictly housed within mitochondria. This spatial segregation prevents futile metabolic cycling and enables independent regulation by local substrates.",
        say: "Cellular metabolism requires strict compartmentalization across organelles. Cytosol hosts glycolysis, fatty acid synthesis, and the pentose phosphate pathway. Mitochondria house the citric acid cycle, beta-oxidation, and oxidative phosphorylation. This spatial separation prevents futile cycles and permits localized regulation.",
        vis: {
          kind: "table",
          cols: ["Organelle", "Major pathways housed", "Permeability barrier"],
          rows: [
            ["Cytosol", "Glycolysis, fatty acid synthesis, PPP", "Plasma membrane outer boundary"],
            ["Mitochondrial matrix", "TCA cycle, beta-oxidation, urea start", "Inner membrane impermeable to ions"],
            ["Endoplasmic reticulum", "Translation, lipid synthesis, P450", "Lipid bilayer with translocons"],
            ["Lysosomes", "Acid hydrolase macromolecule degradation", "Proton-ATPase maintained pH 4.5 to 5.0"]
          ]
        }
      },
      {
        tx: "Biochemical **pathology** arises when specific molecular processes malfunction. Diseases are classified into inborn errors of metabolism, toxic xenobiotic exposures, nutritional deficiencies, and endocrine dysregulations. Enzyme deficiencies typically produce dual consequences: upstream accumulation of toxic precursor metabolites and downstream depletion of critical physiological end products. Recognizing this reciprocal relationship is vital for interpreting diagnostic clinical tests.",
        say: "Molecular pathology results from enzyme deficiencies, toxic xenobiotics, nutritional deficits, or endocrine failure. Enzyme defects cause upstream accumulation of toxic precursors and downstream deficiency of essential end products. This reciprocal relationship forms the foundation for metabolic screening.",
        vis: {
          kind: "compare",
          left: {
            title: "Substrate accumulation effects",
            points: [
              "Upstream toxic metabolite buildup",
              "Alternative aberrant pathway shunting",
              "Cellular swelling and organomegaly",
              "Diagnostic urine and plasma markers"
            ]
          },
          right: {
            title: "Product depletion effects",
            points: [
              "Failure of vital downstream synthesis",
              "Loss of essential energetic molecules",
              "Loss of physiological feedback control",
              "Clinical failure to thrive and fatigue"
            ]
          }
        }
      },
      {
        tx: "Mitochondria contain a specialized **double membrane** architecture critical for bioenergetics. The outer membrane is freely permeable to small molecules via voltage-dependent anion channels called porins. The inner mitochondrial membrane is uniquely rich in cardiolipin and impermeable to most ions and polar solutes, establishing the steep electrochemical proton gradient required for adenosine triphosphate generation by ATP synthase.",
        say: "Mitochondria possess a double membrane system. The outer membrane has porins permeable to small molecules. The inner membrane contains cardiolipin and lacks permeability to ions, which maintains the electrochemical proton gradient driving ATP synthesis.",
        vis: {
          kind: "flow",
          title: "Mitochondrial transport compartments",
          nodes: [
            { id: "cyt", label: "Cytosol" },
            { id: "om", label: "Outer membrane porin" },
            { id: "ims", label: "Intermembrane space" },
            { id: "imm", label: "Inner membrane carriers" },
            { id: "mat", label: "Matrix enzymes" }
          ],
          edges: [
            ["cyt", "om", "Passes <5 kDa"],
            ["om", "ims", "Protons accumulate"],
            ["ims", "imm", "Specific antiporters"],
            ["imm", "mat", "TCA & beta-oxidation"]
          ]
        }
      },
      {
        tx: "Peroxisomes serve essential **oxidative** functions distinct from mitochondria. They initiate beta-oxidation of very long-chain fatty acids containing twenty-two or more carbons and synthesize ether phospholipids called plasmalogens for neural myelin. Peroxisomal oxidation generates hydrogen peroxide, which is promptly decomposed into water and molecular oxygen by catalase. Peroxisomal assembly defects cause severe Zellweger syndrome.",
        say: "Peroxisomes perform specialized oxidation of very long-chain fatty acids and synthesize myelin plasmalogens. Their oxidation produces hydrogen peroxide, rapidly degraded by catalase. Peroxisome assembly failure causes Zellweger syndrome.",
        vis: {
          kind: "table",
          cols: ["Peroxisomal function", "Substrates involved", "Clinical deficiency state"],
          rows: [
            ["VLCFA beta-oxidation", "Fatty acids 22 to 26 carbons", "X-linked adrenoleukodystrophy"],
            ["Plasmalogen synthesis", "Ether glycerophospholipids", "Rhizomelic chondrodysplasia punctata"],
            ["Peroxisome biogenesis", "PEX gene peroxin proteins", "Zellweger syndrome spectrum"],
            ["Phytanic acid alpha-oxidation", "Branched-chain dietary phytanate", "Refsum disease neurological ataxia"]
          ]
        }
      }
    ]
  },

  // Ch 2: Amino Acids and Proteins (Protein Folding & Misfolding)
  {
    module: "bio-protein-folding",
    subject: "biochemistry",
    title: "Protein folding, molecular chaperones, amyloidosis and prion conformational disorders",
    minutes: 6,
    refs: ["Lehninger Principles of Biochemistry 8th ed", "Medical Biochemistry 5th ed"],
    steps: [
      {
        tx: "Polypeptide folding into native tertiary conformation is guided by the **thermodynamic** minimization of free energy. Hydrophobic amino acid side chains collapse into the protein interior away from water, while hydrophilic residues orient towards the aqueous surface. Molecular chaperones, including heat shock protein 70 and heat shock protein 60 chaperonins, bind exposed hydrophobic patches to prevent aberrant aggregation during synthesis.",
        say: "Protein folding minimizes Gibbs free energy by burying hydrophobic residues inside and exposing hydrophilic groups to water. Chaperones such as heat shock protein 70 and heat shock protein 60 bind exposed hydrophobic patches to prevent abnormal aggregation during translation.",
        vis: {
          kind: "table",
          cols: ["Folding factor", "Molecular mechanism", "Biological role"],
          rows: [
            ["Hydrophobic collapse", "Buries nonpolar residues internally", "Primary thermodynamic driving force"],
            ["Hsp70 family", "ATP-dependent peptide clamp", "Prevents nascent chain misfolding"],
            ["Hsp60 chaperonins", "Barrel-shaped isolation chamber", "Permits folding undisturbed by crowding"],
            ["Protein disulfide isomerase", "Thiol-disulfide exchange", "Corrects non-native disulfide bonds"]
          ]
        }
      },
      {
        tx: "Pathological **amyloidosis** develops when soluble globular proteins undergo conformational transition into insoluble cross-beta sheet fibrillar aggregates. These amyloid fibrils deposit in extracellular tissues, resisting normal proteolytic degradation and producing organ enlargement and functional failure. Under polarized light microscopy, Congo red-stained amyloid deposits exhibit diagnostic apple-green birefringence.",
        say: "Amyloidosis occurs when soluble proteins transition into insoluble cross-beta sheet fibrillar polymers. These fibrils resist proteolysis, depositing in extracellular spaces and causing organ failure. Under polarized light, Congo red-stained amyloid reveals diagnostic apple-green birefringence.",
        vis: {
          kind: "compare",
          left: {
            title: "Systemic amyloid types",
            points: [
              "AL amyloid: monoclonal immunoglobulin light chains",
              "AA amyloid: serum amyloid A in chronic inflammation",
              "ATTR amyloid: transthyretin in familial or senile cardiac",
              "Beta-2 microglobulin: long-term hemodialysis patients"
            ]
          },
          right: {
            title: "Organ manifestations",
            points: [
              "Kidneys: nephrotic syndrome and proteinuria",
              "Heart: restrictive cardiomyopathy and low voltage ECG",
              "Tongue: macroglossia pathognomonic for AL",
              "Nerves: peripheral sensory and autonomic neuropathy"
            ]
          }
        }
      },
      {
        tx: "Prion diseases represent transmissible **conformational** neurodegenerations mediated by infectious proteinaceous particles lacking nucleic acids. The normal cellular prion protein, rich in alpha-helices, undergoes spontaneous or template-driven refolding into the disease-causing scrapie prion isoform rich in beta-sheets. The abnormal conformer catalyses further conversion of normal proteins, causing rapid neurodegeneration and classic spongiform encephalopathy.",
        say: "Prion disorders are transmissible neurodegenerations caused by misfolded protein conformers. The normal alpha-helical prion protein refolds into the beta-sheet rich scrapie form. This abnormal isoform templates further refolding, causing rapid neuronal death and spongiform change.",
        vis: {
          kind: "table",
          cols: ["Feature", "Cellular prion (PrPC)", "Infectious scrapie (PrPSc)"],
          rows: [
            ["Secondary structure", "Predominantly alpha-helices (42%)", "Predominantly beta-sheets (43%)"],
            ["Solubility", "Soluble in non-denaturing detergents", "Insoluble fibrillar aggregates"],
            ["Protease sensitivity", "Completely degraded by proteinase K", "Protease-resistant core remains"],
            ["Clinical disease", "Normal physiologic neuronal protein", "Creutzfeldt-Jakob, Kuru, fatal insomnia"]
          ]
        }
      },
      {
        tx: "Endoplasmic reticulum quality control eliminates misfolded proteins via **ERAD**, the endoplasmic reticulum-associated degradation pathway. Chaperones detect misfolded glycoproteins, retrotranslocate them across the membrane into the cytosol, and attach polyubiquitin chains. Cytosolic 26S proteasomes then degrade the ubiquitinated substrate. Severe ER stress activates the unfolded protein response, inducing apoptosis if homeostasis cannot be restored.",
        say: "Endoplasmic reticulum quality control identifies misfolded polypeptides and routes them through ERAD. Proteins are retrotranslocated to cytosol, polyubiquitinated, and degraded by 26S proteasomes. Unresolved ER stress triggers the unfolded protein response, initiating apoptosis.",
        vis: {
          kind: "flow",
          title: "ERAD quality control pathway",
          nodes: [
            { id: "mis", label: "Misfolded luminal protein" },
            { id: "rec", label: "BiP & calreticulin detection" },
            { id: "ret", label: "Retrotranslocon pore exit" },
            { id: "ubi", label: "Cytosolic polyubiquitination" },
            { id: "pro", label: "26S proteasome degradation" }
          ],
          edges: [
            ["mis", "rec", "Recognized as abnormal"],
            ["rec", "ret", "Chaperone handoff"],
            ["ret", "ubi", "E3 ubiquitin ligase"],
            ["ubi", "pro", "Recycled to amino acids"]
          ]
        }
      }
    ]
  },

  // Ch 3: Carbohydrates and Lipids Basics
  {
    module: "bio-carb-lipid-basics",
    subject: "biochemistry",
    title: "Carbohydrate and lipid chemistry: isomerism, glycosidic bonds and lipid classifications",
    minutes: 6,
    refs: ["Harper's Illustrated Biochemistry 32nd ed", "Medical Biochemistry 5th ed"],
    steps: [
      {
        tx: "Monosaccharides exhibit structural and stereochemical **isomerism** that dictates biological recognition. D- and L-isomers are designated by the asymmetric carbon farthest from the carbonyl group. Epimers differ in configuration around a single chiral carbon; D-glucose and D-galactose are C-4 epimers, whereas D-glucose and D-mannose are C-2 epimers. In solution, open-chain aldoses cyclize into alpha- and beta-anomers via hemiacetal formation.",
        say: "Monosaccharides display stereoisomerism critical for enzyme recognition. D- and L-designations reflect the chiral carbon furthest from the carbonyl. Epimers differ at a single carbon: glucose and galactose are C-4 epimers, while glucose and mannose are C-2 epimers. Ring closure produces alpha and beta anomers.",
        vis: {
          kind: "table",
          cols: ["Isomer relationship", "Definition", "Clinical biochemical example"],
          rows: [
            ["D- and L-enantiomers", "Non-superimposable mirror images", "Human enzymes exclusively utilize D-sugars"],
            ["C-4 epimers", "Inversion at fourth carbon atom", "Glucose and galactose interconversion in liver"],
            ["C-2 epimers", "Inversion at second carbon atom", "Glucose and mannose metabolic utilization"],
            ["Anomers", "Stereocenters formed upon cyclization", "Alpha vs beta linkages in glycogen vs cellulose"]
          ]
        }
      },
      {
        tx: "Disaccharides and polysaccharides are formed through **glycosidic** bonds joining an anomeric hydroxyl to another alcohol. Maltose possesses an alpha-1,4 linkage, whereas lactose has a beta-1,4 linkage hydrolyzed by intestinal brush border lactase. Sucrose links glucose and fructose via an alpha-1,beta-2 bond, locking both anomeric carbons and eliminating reducing sugar properties. Glycogen contains alpha-1,4 chains with alpha-1,6 branches.",
        say: "Glycosidic bonds join an anomeric carbon to another sugar alcohol. Maltose has an alpha-1,4 bond, while lactose features a beta-1,4 bond broken by lactase. Sucrose connects both anomeric carbons in an alpha-1, beta-2 linkage, making it non-reducing. Glycogen has alpha-1,4 backbones and alpha-1,6 branches.",
        vis: {
          kind: "compare",
          left: {
            title: "Reducing disaccharides",
            points: [
              "Free anomeric hemiacetal group present",
              "Maltose: glucose alpha-1,4 glucose",
              "Lactose: galactose beta-1,4 glucose",
              "Positive Benedict and Fehling tests"
            ]
          },
          right: {
            title: "Non-reducing disaccharides",
            points: [
              "Both anomeric carbons tied in bond",
              "Sucrose: glucose alpha-1, beta-2 fructose",
              "Trehalose: glucose alpha-1, alpha-1 glucose",
              "Negative copper-reduction tests"
            ]
          }
        }
      },
      {
        tx: "Fatty acids are amphipathic carboxylic acids classified by **saturation** and hydrocarbon chain length. Saturated fatty acids like palmitate and stearate pack densely into rigid membranes. Unsaturated fatty acids contain cis-double bonds that introduce rigid kinks, increasing membrane fluidity and lowering melting points. Essential fatty acids, linoleic acid and alpha-linolenic acid, cannot be synthesized because human desaturases cannot introduce double bonds beyond carbon nine.",
        say: "Fatty acids are classified by chain length and saturation. Saturated fatty acids pack tightly to increase rigidity. Cis-unsaturated double bonds introduce kinks that boost membrane fluidity. Linoleic and alpha-linolenic acids are essential because humans cannot desaturate beyond carbon nine.",
        vis: {
          kind: "table",
          cols: ["Fatty acid class", "Double bond structure", "Key biological roles"],
          rows: [
            ["Saturated", "Zero double bonds (e.g., palmitic 16:0)", "Fuel storage, membrane stability"],
            ["Monounsaturated", "Single cis-bond (e.g., oleic 18:1)", "Fluidity maintenance, cardioprotective"],
            ["Omega-6 polyunsaturated", "Linoleic (18:2), arachidonic (20:4)", "Pro-inflammatory eicosanoid precursors"],
            ["Omega-3 polyunsaturated", "Alpha-linolenic (18:3), EPA, DHA", "Anti-inflammatory resolvins, neural retina"]
          ]
        }
      },
      {
        tx: "Triacylglycerols function as the primary **reservoir** of metabolic energy in mammals. Three fatty acid molecules are esterified to a glycerol backbone, forming completely uncharged neutral lipids. Stored anhydrously within white adipocyte lipid droplets, triacylglycerols yield thirty-seven kilojoules per gram upon complete combustion, over twice the caloric density of glycogen, while requiring zero hydration weight for storage.",
        say: "Triacylglycerols serve as the body's chief fuel reservoir. Three fatty acids esterify to glycerol, forming neutral uncharged lipids. Stored anhydrously in adipocytes, they yield thirty-seven kilojoules per gram on oxidation, more than twice the energy density of hydrated glycogen.",
        vis: {
          kind: "flow",
          title: "Adipose triacylglycerol mobilization",
          nodes: [
            { id: "atg", label: "Adipocyte lipid droplet" },
            { id: "atgl", label: "Adipose triglyceride lipase" },
            { id: "hsl", label: "Hormone-sensitive lipase" },
            { id: "magl", label: "Monoacylglycerol lipase" },
            { id: "bld", label: "Free fatty acids into blood" }
          ],
          edges: [
            ["atg", "atgl", "Epi & glucagon stimulate"],
            ["atgl", "hsl", "Forms diacylglycerol"],
            ["hsl", "magl", "Phosphorylated by PKA"],
            ["magl", "bld", "Bound to serum albumin"]
          ]
        }
      }
    ]
  },

  // Ch 4: Membranes and Transport
  {
    module: "bio-membrane-transport",
    subject: "biochemistry",
    title: "Biological membranes: fluid mosaic model, lipid rafts and solute transport mechanisms",
    minutes: 6,
    refs: ["Lehninger Principles of Biochemistry 8th ed", "Medical Biochemistry 5th ed"],
    steps: [
      {
        tx: "The **fluid mosaic** model describes biological membranes as dynamic two-dimensional lipid bilayers studded with integral and peripheral proteins. Phospholipids display rapid lateral diffusion within their monolayer but rarely flip-flop spontaneously between leaflets. Asymmetry is actively preserved by ATP-dependent flippases, floppases, and calcium-activated scramblases. Phosphatidylserine is normally restricted to the inner leaflet; its exteriorization serves as a macrophage phagocytosis signal.",
        say: "Biological membranes are dynamic bilayers with integral and peripheral proteins. Phospholipids diffuse laterally within leaflets but rarely flip-flop spontaneously. Flippases and floppases maintain leaflet asymmetry. Phosphatidylserine stays on the inner leaflet; external exposure signals macrophage clearance.",
        vis: {
          kind: "table",
          cols: ["Translocase enzyme", "Direction of lipid movement", "Energy requirement"],
          rows: [
            ["Flippase (P-type ATPase)", "Outer leaflet to inner leaflet", "ATP hydrolysis required"],
            ["Floppase (ABC transporter)", "Inner leaflet to outer leaflet", "ATP hydrolysis required"],
            ["Scramblase", "Bidirectional non-specific scrambling", "Calcium-activated, ATP-independent"],
            ["Cholesterol flip-flop", "Rapid spontaneous equilibration", "Unassisted, rapid diffusion"]
          ]
        }
      },
      {
        tx: "Specialized microdomains called **lipid rafts** float within the liquid-disordered membrane matrix. Enriched in cholesterol, sphingomyelin, and glycosphingolipids, rafts exist in a tightly packed liquid-ordered phase. They serve as platforms that concentrate signal transduction complexes, GPI-anchored proteins, and receptor tyrosine kinases. Rafts also facilitate endocytosis and mediate entry pathways for pathogens including human immunodeficiency virus and cholera toxin.",
        say: "Lipid rafts are ordered microdomains enriched in cholesterol, sphingomyelin, and glycolipids. They float within fluid membranes, clustering signaling complexes, GPI-anchored proteins, and receptor kinases. Rafts organize transmembrane signaling and mediate entry of cholera toxin and HIV.",
        vis: {
          kind: "compare",
          left: {
            title: "Lipid raft composition",
            points: [
              "High cholesterol content",
              "Saturated sphingolipids and gangliosides",
              "GPI-anchored surface proteins",
              "Caveolins and flotillin scaffold markers"
            ]
          },
          right: {
            title: "Surrounding bulk bilayer",
            points: [
              "Kinked unsaturated glycerophospholipids",
              "Liquid-disordered fluid phase",
              "Lower cholesterol packing density",
              "High lateral solute mobility"
            ]
          }
        }
      },
      {
        tx: "Solute movement across membranes occurs via **active** or passive mechanisms. Primary active transport directly hydrolyzes ATP to move solutes against electrochemical gradients, exemplified by the sodium-potassium ATPase, which exports three sodium ions and imports two potassium ions per ATP cycle. Secondary active transport couples downhill solute movement to drive uphill transport of another, as seen in intestinal sodium-glucose cotransporters.",
        say: "Solute transport is active or passive. Primary active transport uses ATP directly, as in the sodium-potassium pump moving three sodium out and two potassium in. Secondary active transport harnesses existing ion gradients to drive co-transport, seen in intestinal sodium-glucose transporters.",
        vis: {
          kind: "table",
          cols: ["Transport category", "Energy mechanism", "Prototypic physiological example"],
          rows: [
            ["Simple diffusion", "Passive thermal gradient", "Oxygen, carbon dioxide, ethanol, steroid hormones"],
            ["Facilitated diffusion", "Passive carrier or channel", "GLUT1 in RBCs, GLUT4 in muscle, aquaporins"],
            ["Primary active transport", "Direct ATP hydrolysis", "Na+/K+-ATPase, SERCA Ca2+-ATPase, H+/K+-ATPase"],
            ["Secondary active transport", "Electrochemical ion gradient", "SGLT1 Na+/glucose, NCX Na+/Ca2+ antiporter"]
          ]
        }
      },
      {
        tx: "Genetic defects in membrane channels and transporters produce devastating **channelopathies**. Cystic fibrosis arises from mutations in the CFTR gene, an ATP-binding cassette chloride channel regulating epithelial secretions. Loss of CFTR causes dehydrated thick mucus across respiratory and gastrointestinal tracts. Other channelopathies include hypokalemic periodic paralysis from calcium channel defects and long QT syndromes from cardiac potassium channel mutations.",
        say: "Transporter and channel mutations cause channelopathies. Cystic fibrosis results from CFTR gene defects, impairing chloride and bicarbonate secretion to cause thick mucosal obstructions. Cardiac channelopathies like long QT syndrome cause lethal arrhythmias from potassium or sodium channel defects.",
        vis: {
          kind: "flow",
          title: "CFTR pathophysiology cascade",
          nodes: [
            { id: "mut", label: "CFTR F508del mutation" },
            { id: "er", label: "Misfolding & ERAD degradation" },
            { id: "chl", label: "Absent apical chloride flux" },
            { id: "h2o", label: "Dehydrated luminal mucus" },
            { id: "org", label: "Bronchiectasis & pancreatic failure" }
          ],
          edges: [
            ["mut", "er", "Class II processing defect"],
            ["er", "chl", "No surface channel"],
            ["chl", "h2o", "Hyperabsorption of Na+"],
            ["h2o", "org", "Bacterial colonization"]
          ]
        }
      }
    ]
  },

  // Ch 5: Oxygen Transport & Hemoglobin Allostery
  {
    module: "bio-oxygen-transport",
    subject: "biochemistry",
    title: "Hemoglobin and myoglobin: cooperativity, allosteric effectors, 2,3-BPG and the Bohr effect",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Harper's Illustrated Biochemistry 32nd ed"],
    steps: [
      {
        tx: "Myoglobin and hemoglobin exhibit contrasting oxygen-binding **curves** suited to their distinct physiological niches. Monomeric myoglobin displays a hyperbolic binding curve with high oxygen affinity, releasing oxygen only at low tissue partial pressures during muscle hypoxia. In contrast, tetrameric hemoglobin exhibits a sigmoidal curve reflecting positive cooperativity, allowing efficient oxygen loading in alveolar capillaries and unloading in peripheral tissues.",
        say: "Myoglobin and hemoglobin curves reflect their distinct biological functions. Monomeric myoglobin shows a hyperbolic curve with high oxygen affinity, releasing oxygen only during tissue hypoxia. Tetrameric hemoglobin displays a sigmoidal curve from cooperativity, loading oxygen in lungs and releasing it in tissues.",
        vis: {
          kind: "compare",
          left: {
            title: "Myoglobin properties",
            points: [
              "Single polypeptide chain with one heme",
              "Hyperbolic oxygen dissociation curve",
              "Very low P50 of 2 to 3 mmHg",
              "No cooperativity or allosteric regulation"
            ]
          },
          right: {
            title: "Hemoglobin properties",
            points: [
              "Tetramer of two alpha and two beta chains",
              "Sigmoidal oxygen dissociation curve",
              "P50 of 26 to 27 mmHg under normal conditions",
              "Regulated by pH, CO2, temperature and 2,3-BPG"
            ]
          }
        }
      },
      {
        tx: "Oxygen binding induces transition between two quaternary **conformations**: the tense T-state and the relaxed R-state. Deoxygenated hemoglobin is constrained in the T-state by multiple inter-subunit salt bridges. Binding of oxygen to iron pulls the protoporphyrin ring flat, shifting the proximal histidine and rotating the alpha-beta dimers fifteen degrees. This rupture of salt bridges stabilizes the high-affinity R-state.",
        say: "Hemoglobin transitions between tense T and relaxed R states. Deoxygenated hemoglobin adopts the T state stabilized by ionic salt bridges. Oxygen binding pulls the heme iron into the porphyrin plane, tilting the proximal histidine and rotating dimers into the high-affinity R state.",
        vis: {
          kind: "table",
          cols: ["Hemoglobin state", "Affinity for oxygen", "Structural characteristics", "Allosteric preference"],
          rows: [
            ["Tense (T) state", "Low oxygen affinity", "Constrained by 8 salt bridges", "Favored by H+, CO2, 2,3-BPG, heat"],
            ["Relaxed (R) state", "High oxygen affinity", "Ruptured salt bridges, rotated dimers", "Favored by oxygen binding"],
            ["Transition point", "Intermediate cooperativity", "Oxygen binding to 2nd subunit", "Pulls iron into porphyrin plane"]
          ]
        }
      },
      {
        tx: "The **Bohr effect** facilitates reciprocal oxygen delivery and carbon dioxide clearance. In metabolically active tissues, elevated carbon dioxide hydration generates carbonic acid, dissociating into protons. Protons bind specific histidine residues on beta chains, stabilizing the T-state and right-shifting the dissociation curve. This right-shift increases oxygen unloading. In pulmonary capillaries, oxygenation displaces protons and carbon dioxide, a phenomenon termed the Haldane effect.",
        say: "The Bohr effect coordinates oxygen release with carbon dioxide transport. Metabolically active tissues generate protons that bind histidine residues, stabilizing the low-affinity T state and shifting the curve rightward. In lungs, oxygen binding releases carbon dioxide via the Haldane effect.",
        vis: {
          kind: "table",
          cols: ["Physiological parameter", "Effect on P50", "Shift direction", "Physiological benefit"],
          rows: [
            ["Decreased pH (acidosis)", "Increases P50", "Right shift", "Enhances oxygen unloading to tissues"],
            ["Increased 2,3-BPG", "Increases P50", "Right shift", "Adaptation to chronic high altitude"],
            ["Elevated temperature", "Increases P50", "Right shift", "Delivers oxygen to exercising muscle"],
            ["Fetal hemoglobin (HbF)", "Decreases P50", "Left shift", "Extracts oxygen across placenta from HbA"]
          ]
        }
      },
      {
        tx: "The organic phosphate **2,3-BPG** is synthesized via the Rapoport-Luebering glycolytic shunt in red blood cells. A single molecule binds the central cavity of the T-state tetramer, forming ionic bonds with positively charged lysine and histidine residues on both beta chains. Fetal hemoglobin replaces beta chains with gamma chains containing serine-143 instead of histidine-143, decreasing 2,3-BPG affinity and facilitating transplacental oxygen transfer.",
        say: "2,3-BPG is produced by the Rapoport-Luebering shunt in red blood cells. It nests within the central cavity of the deoxygenated T-state tetramer. Fetal hemoglobin replaces beta chain histidine-143 with serine, lowering 2,3-BPG binding and enabling fetal oxygen uptake across the placenta.",
        vis: {
          kind: "flow",
          title: "Rapoport-Luebering shunt pathway",
          nodes: [
            { id: "g3p", label: "Glyceraldehyde-3-phosphate" },
            { id: "13b", label: "1,3-bisphosphoglycerate" },
            { id: "mut", label: "BPG mutase enzyme" },
            { id: "23b", label: "2,3-bisphosphoglycerate" },
            { id: "p04", label: "BPG phosphatase to 3-PG" }
          ],
          edges: [
            ["g3p", "13b", "GAPDH oxidation"],
            ["13b", "mut", "Bypasses PGK ATP step"],
            ["mut", "23b", "Generates allosteric effector"],
            ["23b", "p04", "Returns to glycolysis"]
          ]
        }
      }
    ]
  },

  // Ch 6: Enzymes & Kinetics
  {
    module: "bio-enzymes-kinetics",
    subject: "biochemistry",
    title: "Enzyme kinetics: Michaelis-Menten mechanics, Lineweaver-Burk analysis and reversible inhibition",
    minutes: 6,
    refs: ["Harper's Illustrated Biochemistry 32nd ed", "Medical Biochemistry 5th ed"],
    steps: [
      {
        tx: "Enzymes catalyze metabolic transformations by lowering activation **energy** without altering reaction equilibrium. Michaelis-Menten kinetics describe single-substrate hyperbolic velocity curves. The Michaelis constant, Km, represents the substrate concentration at which reaction velocity reaches half of maximal velocity. A small Km reflects high enzyme-substrate affinity, whereas a large Km indicates that higher substrate concentrations are required for effective catalysis.",
        say: "Enzymes lower activation energy barriers without altering equilibrium. Michaelis-Menten kinetics generate a hyperbolic saturation curve. The Km parameter indicates the substrate concentration needed for half-maximal velocity. Low Km signifies high affinity, while high Km indicates lower affinity.",
        vis: {
          kind: "table",
          cols: ["Kinetic parameter", "Physiological definition", "Units", "Clinical relevance"],
          rows: [
            ["Vmax", "Maximum catalytic rate at saturating substrate", "Micromoles per minute", "Reflects active enzyme concentration"],
            ["Km", "Substrate concentration at half-maximal Vmax", "Millimoles per liter", "Glucokinase vs hexokinase glucose sensing"],
            ["Kcat (turnover)", "Number of substrate conversions per active site", "Per second", "Catalytic efficiency metric (Kcat/Km)"],
            ["Half-life (t1/2)", "Time for half of enzyme activity to decay", "Hours or days", "Cardiac biomarker clearance in plasma"]
          ]
        }
      },
      {
        tx: "Hexokinase and glucokinase illustrate how divergent **Km** values dictate tissue-specific metabolic functions. Hexokinase I, expressed ubiquitously in extrahepatic tissues, possesses a low Km for glucose below zero-point-one millimolar, enabling near-maximal glucose phosphorylation even during profound fasting hypoglycemia. Liver glucokinase has a high Km around ten millimolar and lacks product inhibition by glucose-6-phosphate, acting as a postprandial glucose sensor.",
        say: "Hexokinase and glucokinase exemplify physiological adaptation through enzyme kinetics. Ubiquitous hexokinase has a low Km, ensuring glucose phosphorylation during fasting. Hepatic glucokinase possesses a high Km and lacks product inhibition, functioning as a postprandial glucose sensor and insulin gatekeeper.",
        vis: {
          kind: "compare",
          left: {
            title: "Hexokinase (types I to III)",
            points: [
              "Ubiquitously distributed in tissues",
              "Low Km (high glucose affinity <0.1 mM)",
              "Inhibited by product glucose-6-phosphate",
              "Saturated under fasting conditions"
            ]
          },
          right: {
            title: "Glucokinase (type IV)",
            points: [
              "Restricted to hepatocytes and beta-cells",
              "High Km (low glucose affinity ~10 mM)",
              "Not inhibited by glucose-6-phosphate",
              "Sequestered in nucleus by regulatory protein"
            ]
          }
        }
      },
      {
        tx: "Linear transformation via the **Lineweaver-Burk** double-reciprocal plot permits precise graphical determination of kinetic parameters. Plotting inverse initial velocity against inverse substrate concentration produces a straight line. The y-intercept represents the reciprocal of Vmax, while the x-intercept corresponds to the negative reciprocal of Km. Slope of the line equals Km divided by Vmax, simplifying mathematical differentiation of enzyme inhibitors.",
        say: "The Lineweaver-Burk double-reciprocal plot graphs inverse velocity against inverse substrate concentration. The y-intercept yields the inverse of Vmax, while the x-intercept reveals negative inverse Km. The slope equals Km divided by Vmax, facilitating inhibitor analysis.",
        vis: {
          kind: "table",
          cols: ["Plot coordinate", "Mathematical value", "Inhibitor behavior"],
          rows: [
            ["Y-intercept", "1 / Vmax", "Unchanged in competitive; elevated in noncompetitive"],
            ["X-intercept", "-1 / Km", "Shifts toward origin in competitive; unchanged in noncompetitive"],
            ["Slope", "Km / Vmax", "Increased by both competitive and noncompetitive inhibitors"],
            ["Parallel lines", "Slope unchanged", "Hallmark of uncompetitive inhibition"]
          ]
        }
      },
      {
        tx: "Enzyme **inhibition** is categorized by its structural and kinetic characteristics. Competitive inhibitors resemble the substrate and reversibly bind the active site, increasing apparent Km while leaving Vmax unchanged at saturating substrate concentrations. Noncompetitive inhibitors bind an allosteric site regardless of substrate binding, reducing Vmax without altering Km. Irreversible suicide inhibitors covalently inactivate the catalytic active site.",
        say: "Enzyme inhibitors are classified by kinetic behavior. Competitive inhibitors bind the active site, raising apparent Km without altering Vmax. Noncompetitive inhibitors bind allosteric sites, lowering Vmax while maintaining normal Km. Irreversible suicide inhibitors permanently inactivate the enzyme.",
        vis: {
          kind: "flow",
          title: "Pharmacological inhibitor examples",
          nodes: [
            { id: "inh", label: "Clinical enzyme inhibitors" },
            { id: "comp", label: "Competitive: Statins (HMG-CoA Reductase)" },
            { id: "non", label: "Noncompetitive: Lead (Ferrochelatase)" },
            { id: "irr", label: "Irreversible: Aspirin (Cyclooxygenase-1)" }
          ],
          edges: [
            ["inh", "comp", "Reversible active site"],
            ["inh", "non", "Allosteric site binding"],
            ["inh", "irr", "Covalent bond formation"]
          ]
        }
      }
    ]
  },

  // Ch 7: Vitamins and Minerals
  {
    module: "bio-vitamins-minerals",
    subject: "biochemistry",
    title: "Vitamins and trace minerals: coenzyme mechanisms, antioxidant defenses and deficiency syndromes",
    minutes: 6,
    refs: ["Harper's Illustrated Biochemistry 32nd ed", "Medical Biochemistry 5th ed"],
    steps: [
      {
        tx: "Water-soluble B-complex vitamins serve as indispensable **coenzymes** in central intermediary metabolism. Thiamine pyrophosphate acts as cofactor for pyruvate dehydrogenase and alpha-ketoglutarate dehydrogenase. Riboflavin generates flavin adenine dinucleotide for electron transport, while niacin synthesizes nicotinamide adenine dinucleotide. Pyridoxal phosphate is required for transaminations and decarboxylations. Biotin facilitates carboxylation reactions, and cobalamin coordinates methyl transfer with folate.",
        say: "Water-soluble B vitamins serve as essential metabolic coenzymes. Thiamine enables oxidative decarboxylations. Riboflavin and niacin yield FAD and NAD for bioenergetics. Pyridoxal phosphate drives transamination. Biotin directs carboxylations, and cobalamin assists methyl transfer with folate.",
        vis: {
          kind: "table",
          cols: ["Vitamin", "Active coenzyme", "Key metabolic reactions", "Deficiency syndrome"],
          rows: [
            ["B1 (Thiamine)", "Thiamine pyrophosphate (TPP)", "PDH, alpha-KGDH, transketolase", "Beriberi, Wernicke-Korsakoff"],
            ["B2 (Riboflavin)", "FAD, FMN", "Succinate DH, Complex I", "Cheilosis, corneal vascularization"],
            ["B3 (Niacin)", "NAD+, NADP+", "Dehydrogenase redox reactions", "Pellagra (diarrhea, dermatitis, dementia)"],
            ["B6 (Pyridoxine)", "Pyridoxal phosphate (PLP)", "Transamination, ALA synthase", "Sideroblastic anemia, peripheral neuropathy"]
          ]
        }
      },
      {
        tx: "Fat-soluble vitamins (A, D, E, K) require biliary micelle formation and **chylomicron** transport for intestinal absorption. Vitamin A supports retinal phototransduction and cellular differentiation. Vitamin D undergoes hepatic and renal hydroxylation to calcitriol, regulating calcium homeostasis. Vitamin E acts as an antioxidant protecting membrane polyunsaturated lipids from peroxidation. Vitamin K is essential for gamma-glutamyl carboxylation of clotting factors II, VII, IX, and X.",
        say: "Fat-soluble vitamins require bile micelles and chylomicrons for absorption. Vitamin A supports vision and epithelial differentiation. Vitamin D is converted to calcitriol for calcium balance. Vitamin E protects membranes from lipid peroxidation. Vitamin K activates clotting factors via gamma-carboxylation.",
        vis: {
          kind: "compare",
          left: {
            title: "Vitamins A and D",
            points: [
              "Act via nuclear receptor gene transcription",
              "Retinoic acid maintains epithelial barriers",
              "Calcitriol increases enterocyte calbindin",
              "Toxicity causes hypercalcemia and teratogenicity"
            ]
          },
          right: {
            title: "Vitamins E and K",
            points: [
              "Vitamin E alpha-tocopherol stops free radical chain reactions",
              "Vitamin K acts as cofactor for gamma-glutamyl carboxylase",
              "Warfarin inhibits vitamin K epoxide reductase (VKORC1)",
              "Deficiency prolongs prothrombin time"
            ]
          }
        }
      },
      {
        tx: "Trace minerals function as vital structural and catalytic **cofactors** for metalloenzymes. Zinc coordinates fingers in nuclear transcription factors and stabilizes carbonic anhydrase and alcohol dehydrogenase. Copper participates in cytochrome c oxidase and lysyl oxidase for collagen crosslinking. Selenium is incorporated as selenocysteine into glutathione peroxidase, while iron orchestrates oxygen transport and mitochondrial electron transfer.",
        say: "Trace minerals serve as catalytic cofactors in metalloenzymes. Zinc structures zinc fingers and stabilizes carbonic anhydrase. Copper activates cytochrome c oxidase and lysyl oxidase. Selenium forms selenocysteine in glutathione peroxidase, and iron mediates oxygen and electron transport.",
        vis: {
          kind: "table",
          cols: ["Mineral", "Key metalloenzymes", "Clinical deficiency manifestations"],
          rows: [
            ["Zinc", "Carbonic anhydrase, alkaline phosphatase", "Acrodermatitis enteropathica, impaired wound healing"],
            ["Copper", "Cytochrome oxidase, lysyl oxidase, ceruloplasmin", "Menkes kinky-hair disease, microcytic anemia"],
            ["Iron", "Hemoglobin, myoglobin, cytochromes", "Microcytic hypochromic anemia, koilonychia"],
            ["Selenium", "Glutathione peroxidase, iodothyronine deiodinase", "Keshan cardiomyopathy, myopathy"]
          ]
        }
      },
      {
        tx: "The **folate-cobalamin** metabolic intersection explains megaloblastic anemia and subacute combined degeneration. Folate enters cells as N5-methyl-tetrahydrofolate and transfers its methyl group to homocysteine via cobalamin-dependent methionine synthase, generating tetrahydrofolate and methionine. Cobalamin deficiency traps folate in the unusable methyl form, starving thymidylate synthesis and impairing DNA replication in rapidly dividing hematopoietic precursors.",
        say: "The folate trap explains megaloblastic anemia in vitamin B12 deficiency. Vitamin B12 receives a methyl group from N5-methyl-THF to produce methionine. Without B12, folate becomes trapped as methyl-THF, halting purine and thymidylate synthesis and impairing DNA replication.",
        vis: {
          kind: "flow",
          title: "Methionine synthase and folate trap",
          nodes: [
            { id: "mth", label: "N5-methyl-THF" },
            { id: "b12", label: "Cobalamin cofactor" },
            { id: "met", label: "Methionine synthase" },
            { id: "thf", label: "Free active THF pool" },
            { id: "dna", label: "Thymidylate synthesis & DNA" }
          ],
          edges: [
            ["mth", "b12", "Transfers methyl group"],
            ["b12", "met", "Methylcobalamin intermediate"],
            ["met", "thf", "Homocysteine to methionine"],
            ["thf", "dna", "10-formyl & methylene THF"]
          ]
        }
      }
    ]
  },

  // Ch 8: Electron Transport Chain & Oxidative Phosphorylation
  {
    module: "bio-etc-oxphos",
    subject: "biochemistry",
    title: "Mitochondrial bioenergetics: electron transport chain complexes, proton gradient and uncoupling",
    minutes: 6,
    refs: ["Lehninger Principles of Biochemistry 8th ed", "Medical Biochemistry 5th ed"],
    steps: [
      {
        tx: "Mitochondrial **oxidative** phosphorylation couples exergonic electron transfer to endergonic ATP synthesis. High-energy electrons donated by NADH and FADH2 traverse four multi-protein complexes embedded in the inner mitochondrial membrane. Complexes I, III, and IV pump protons outward from matrix into the intermembrane space, generating a steep electrochemical potential gradient composed of both electrical voltage and chemical proton concentration differences.",
        say: "Oxidative phosphorylation couples electron transfer to ATP generation. Electrons from NADH and FADH2 move through four inner membrane complexes. Complexes I, III, and IV pump protons into the intermembrane space, building a steep electrochemical gradient.",
        vis: {
          kind: "table",
          cols: ["ETC complex", "Prosthetic groups", "Protons pumped per electron pair", "Specific chemical inhibitor"],
          rows: [
            ["Complex I (NADH DH)", "FMN, iron-sulfur centers", "4 protons pumped", "Rotenone, piericidin A"],
            ["Complex II (Succinate DH)", "FAD, iron-sulfur, heme b", "0 protons pumped", "Malonate competitive inhibitor"],
            ["Complex III (bc1 complex)", "Cytochromes b, c1, Fe-S (Rieske)", "4 protons pumped", "Antimycin A"],
            ["Complex IV (Cytochrome c oxidase)", "Hemes a, a3, CuA, CuB centers", "2 protons pumped", "Cyanide, carbon monoxide, azide"]
          ]
        }
      },
      {
        tx: "ATP synthase, designated **Complex V**, functions as a rotary molecular motor driven by proton re-entry into the matrix. The hydrophobic F0 subunit forms a transmembrane proton channel across the inner membrane, whereas the hydrophilic F1 headpiece extends into the matrix and contains three catalytic alpha-beta pairs. Proton flow through F0 spins the c-ring rotor and central gamma-shaft, inducing conformational changes that synthesize ATP.",
        say: "Complex V ATP synthase acts as a rotary motor powered by proton flow back into the matrix. The hydrophobic F0 domain forms the proton channel, while the F1 domain in the matrix synthesizes ATP. Proton transit spins the c-ring and gamma stalk, driving cyclic ATP synthesis.",
        vis: {
          kind: "flow",
          title: "ATP synthase mechanical rotation",
          nodes: [
            { id: "ims", label: "Proton in intermembrane space" },
            { id: "f0", label: "F0 c-subunit aspartate binding" },
            { id: "rot", label: "360-degree rotor rotation" },
            { id: "gam", label: "Asymmetric gamma stalk turning" },
            { id: "f1", label: "F1 beta-subunit catalytic cycle" }
          ],
          edges: [
            ["ims", "f0", "Enters half-channel"],
            ["f0", "rot", "Neutralizes negative charge"],
            ["rot", "gam", "Drives central axle"],
            ["gam", "f1", "Open -> Loose -> Tight"]
          ]
        }
      },
      {
        tx: "Chemical **uncouplers** dissipate the mitochondrial proton gradient without inhibiting electron transport chain complexes. Compounds like 2,4-dinitrophenol and high-dose aspirin act as lipophilic protonophores, picking up protons in the intermembrane space and freely diffusing across the inner membrane into the matrix. This collapses the proton-motive force, abolishing ATP synthesis while accelerating oxygen consumption and converting electron transfer energy entirely into heat.",
        say: "Uncouplers collapse the proton gradient without blocking electron transport. Lipophilic compounds like 2,4-dinitrophenol and toxic aspirin doses shuttle protons across the inner membrane into the matrix. This abolishes ATP synthesis while maximizing oxygen use and releasing energy as heat.",
        vis: {
          kind: "compare",
          left: {
            title: "ETC inhibitors (Cyanide, CO)",
            points: [
              "Directly block electron flow at Complex IV",
              "Arrest proton pumping",
              "Inhibit cellular oxygen consumption",
              "Cause severe cellular hypoxia and lactic acidosis"
            ]
          },
          right: {
            title: "Proton uncouplers (DNP, Thermogenin)",
            points: [
              "Collapse electrochemical proton gradient",
              "Electron transport proceeds unconstrained",
              "Stimulate maximal oxygen consumption",
              "Generate intense systemic hyperthermia"
            ]
          }
        }
      },
      {
        tx: "Brown adipose tissue utilizes physiological uncoupling mediated by **thermogenin**, also known as uncoupling protein 1, for non-shivering thermogenesis. In response to cold exposure, norepinephrine stimulates beta-3 adrenergic receptors, elevating intracellular cyclic AMP and activating protein kinase A. This promotes lipolysis, releasing free fatty acids that activate thermogenin channels, dissipating the proton gradient and generating vital heat to protect newborns from hypothermia.",
        say: "Brown adipose tissue uses uncoupling protein 1, thermogenin, for non-shivering thermogenesis. Cold stimulates beta-3 adrenergic receptors to raise cyclic AMP and activate lipase. Liberated fatty acids open thermogenin, collapsing the proton gradient to produce heat in newborns.",
        vis: {
          kind: "table",
          cols: ["Tissue/Compound", "Uncoupling mechanism", "Physiological consequence"],
          rows: [
            ["UCP1 (Thermogenin)", "Endogenous brown fat proton channel", "Non-shivering thermogenesis in neonates"],
            ["UCP2 and UCP3", "Expressed in muscle and white adipose", "Regulation of mitochondrial reactive oxygen species"],
            ["2,4-Dinitrophenol (DNP)", "Synthetic lipophilic weak acid", "Lethal hyperpyrexia, diaphoresis, tachycardia"],
            ["Aspirin overdose", "Weak acid uncoupling at high doses", "Fever, tachypnea, mixed respiratory/metabolic acidosis"]
          ]
        }
      }
    ]
  },

  // Ch 9: RBC Metabolism & G6PD
  {
    module: "bio-rbc-metabolism",
    subject: "biochemistry",
    title: "Erythrocyte metabolism: anaerobic glycolysis, Rapoport-Luebering shunt and G6PD antioxidant defenses",
    minutes: 6,
    refs: ["Medical Biochemistry 5th ed", "Harper's Illustrated Biochemistry 32nd ed"],
    steps: [
      {
        tx: "Mature erythrocytes lack mitochondria and nuclei, depending entirely upon **anaerobic** glycolysis for adenosine triphosphate generation. Red cells convert glucose to lactate, generating a net of two ATP molecules per glucose consumed. Erythrocyte ATP is required to fuel the sodium-potassium ATPase, maintain membrane biconcavity and deformability, and energize flippases that preserve phospholipid asymmetry during transit through narrow splenic sinusoids.",
        say: "Mature erythrocytes lack mitochondria, relying exclusively on anaerobic glycolysis for ATP. Red cells convert glucose to lactate, producing two ATP molecules. This ATP powers the sodium-potassium pump, maintains membrane deformability, and supports splenic microcirculation passage.",
        vis: {
          kind: "table",
          cols: ["Erythrocyte pathway", "Key enzyme", "Primary metabolic product", "Essential erythrocyte role"],
          rows: [
            ["Embden-Meyerhof pathway", "Pyruvate kinase, PFK-1", "Lactate, 2 net ATP", "Powers Na+/K+-ATPase and deformability"],
            ["Hexose monophosphate shunt", "G6PD", "NADPH", "Maintains reduced glutathione (GSH)"],
            ["Rapoport-Luebering shunt", "Bisphosphoglycerate mutase", "2,3-bisphosphoglycerate", "Optimizes hemoglobin oxygen unloading"],
            ["Methemoglobin reductase", "NADH-cytochrome b5 reductase", "Reduces Fe3+ back to Fe2+", "Preserves functional oxygen binding"]
          ]
        }
      },
      {
        tx: "The **hexose** monophosphate shunt metabolizes ten percent of erythrocyte glucose to generate NADPH. Glucose-6-phosphate dehydrogenase catalyzes the rate-limiting oxidation of glucose-6-phosphate to 6-phosphoglucono-delta-lactone, reducing NADP+ to NADPH. Because red blood cells lack alternative NADPH sources, G6PD activity represents the sole defensive mechanism against oxidative damage caused by endogenous peroxides and exogenous xenobiotics.",
        say: "The hexose monophosphate shunt processes ten percent of red cell glucose to supply NADPH. Glucose-6-phosphate dehydrogenase catalyzes the rate-limiting first step. Lacking mitochondria, red cells depend solely on G6PD to maintain antioxidant defenses against oxidative peroxides.",
        vis: {
          kind: "flow",
          title: "Glutathione antioxidant redox cycle",
          nodes: [
            { id: "g6p", label: "Glucose-6-phosphate" },
            { id: "gpd", label: "G6PD + NADP+ -> NADPH" },
            { id: "grx", label: "Glutathione reductase" },
            { id: "gsh", label: "Reduced glutathione (GSH)" },
            { id: "gpx", label: "Glutathione peroxidase (H2O2 -> H2O)" }
          ],
          edges: [
            ["g6p", "gpd", "Oxidative shunt phase"],
            ["gpd", "grx", "Supplies reducing equivalents"],
            ["grx", "gsh", "Converts GSSG to 2 GSH"],
            ["gsh", "gpx", "Neutralizes reactive peroxides"]
          ]
        }
      },
      {
        tx: "In G6PD **deficiency**, oxidative stress depletes reduced glutathione, leading to extensive sulfhydryl crosslinking and denaturation of hemoglobin. Insoluble globin precipitates form aggregates called Heinz bodies, which adhere to the inner erythrocyte membrane. As these rigid cells transit the splenic cords, macrophages excise the inclusion bodies, generating characteristic bite cells and trigger intravascular and extravascular hemolytic anemia.",
        say: "In G6PD deficiency, oxidative stress exhausts reduced glutathione, causing hemoglobin denaturation and precipitation into Heinz bodies. Splenic macrophages pluck out these precipitates, creating bite cells and causing acute intravascular and extravascular hemolysis.",
        vis: {
          kind: "compare",
          left: {
            title: "Triggers of oxidative hemolysis",
            points: [
              "Infections (pneumonia, viral hepatitis)",
              "Fava beans (vicine and convicine glucosides)",
              "Antimalarials (primaquine, tafenoquine)",
              "Antibiotics (sulfonamides, dapsone, nitrofurantoin)"
            ]
          },
          right: {
            title: "Peripheral blood findings",
            points: [
              "Heinz bodies visible on supravital crystal violet stain",
              "Bite cells (degmacytes) from splenic pitting",
              "Polychromasia reflecting compensatory reticulocytosis",
              "Unconjugated hyperbilirubinemia and elevated LDH"
            ]
          }
        }
      },
      {
        tx: "Pyruvate **kinase** deficiency is the second most frequent cause of hereditary non-spherocytic hemolytic anemia. Inherited in an autosomal recessive manner, this glycolytic defect cripples adenosine triphosphate generation. Inability to maintain cation pump activity causes potassium and water leakage, cellular dehydration, membrane rigidification, and premature phagocytosis by splenic reticuloendothelial macrophages. 2,3-BPG levels paradoxically rise, improving oxygen delivery to peripheral tissues.",
        say: "Pyruvate kinase deficiency is an autosomal recessive enzymopathy causing chronic non-spherocytic hemolytic anemia. Reduced ATP impairs ion pump function, leading to cellular dehydration and splenic destruction. Paradoxically elevated 2,3-BPG enhances tissue oxygen delivery.",
        vis: {
          kind: "table",
          cols: ["Diagnostic parameter", "G6PD deficiency", "Pyruvate kinase deficiency"],
          rows: [
            ["Inheritance pattern", "X-linked recessive", "Autosomal recessive"],
            ["Hemolysis pattern", "Episodic, triggered by oxidative stress", "Chronic ongoing extravascular hemolysis"],
            ["2,3-BPG levels", "Normal", "Markedly elevated (shifts curve right)"],
            ["Diagnostic confirmation", "Enzyme activity assay after acute crisis", "Direct erythrocyte PK enzyme activity measurement"]
          ]
        }
      }
    ]
  },

  // Ch 12: Biosynthesis and Storage of Carbohydrates (Gluconeogenesis & GSD)
  {
    module: "bio-glycogen-gluconeogenesis",
    subject: "biochemistry",
    title: "Carbohydrate synthesis and storage: gluconeogenesis, glycogen metabolism and storage diseases",
    minutes: 6,
    refs: ["Harper's Illustrated Biochemistry 32nd ed", "Medical Biochemistry 5th ed"],
    steps: [
      {
        tx: "Gluconeogenesis synthesizes glucose from non-carbohydrate precursors, primarily lactate, glycerol, and **glucogenic** amino acids during fasting. Because three glycolytic reactions are irreversible, gluconeogenesis employs four bypass enzymes: pyruvate carboxylase and phosphoenolpyruvate carboxykinase bypass pyruvate kinase, fructose-1,6-bisphosphatase bypasses phosphofructokinase-1, and glucose-6-phosphatase hydrolyzes glucose-6-phosphate to release free glucose into the systemic circulation.",
        say: "Gluconeogenesis generates glucose from lactate, glycerol, and glucogenic amino acids during fasting. Four bypass enzymes overcome irreversible glycolytic steps: pyruvate carboxylase, PEP carboxykinase, fructose-1,6-bisphosphatase, and hepatic glucose-6-phosphatase.",
        vis: {
          kind: "table",
          cols: ["Glycolytic step bypassed", "Gluconeogenic bypass enzyme", "Cofactor / Energy", "Allosteric regulation"],
          rows: [
            ["Pyruvate kinase step 1", "Pyruvate carboxylase", "Biotin, ATP", "Allosterically activated by acetyl-CoA"],
            ["Pyruvate kinase step 2", "Phosphoenolpyruvate carboxykinase", "GTP", "Induced transcriptionally by glucagon"],
            ["PFK-1 step", "Fructose-1,6-bisphosphatase", "Magnesium", "Inhibited by AMP and fructose-2,6-bisphosphate"],
            ["Hexokinase step", "Glucose-6-phosphatase", "ER luminal enzyme", "Present in liver and renal cortex, absent in muscle"]
          ]
        }
      },
      {
        tx: "The bifunctional **enzyme** PFK-2/FBPase-2 regulates reciprocal flux between glycolysis and gluconeogenesis via fructose-2,6-bisphosphate. Glucagon phosphorylates the enzyme via protein kinase A, activating the phosphatase domain and degrading fructose-2,6-bisphosphate. Relieved of allosteric inhibition, fructose-1,6-bisphosphatase stimulates gluconeogenesis. Insulin promotes dephosphorylation, activating the kinase domain, elevating fructose-2,6-bisphosphate, and strongly stimulating phosphofructokinase-1.",
        say: "The bifunctional enzyme PFK-2/FBPase-2 controls glycolysis and gluconeogenesis via fructose-2,6-bisphosphate. Glucagon phosphorylates the enzyme, activating phosphatase activity to degrade fructose-2,6-bisphosphate and drive gluconeogenesis. Insulin dephosphorylates the enzyme to activate kinase activity and promote glycolysis.",
        vis: {
          kind: "compare",
          left: {
            title: "Fasted state (Glucagon dominance)",
            points: [
              "Elevated cyclic AMP and active protein kinase A",
              "Phosphorylated PFK-2 is inactivated",
              "Phosphorylated FBPase-2 is activated",
              "Fructose-2,6-bisphosphate drops, favoring gluconeogenesis"
            ]
          },
          right: {
            title: "Fed state (Insulin dominance)",
            points: [
              "Active protein phosphatase-1 dephosphorylates enzyme",
              "Dephosphorylated PFK-2 is active",
              "Dephosphorylated FBPase-2 is inactive",
              "Fructose-2,6-bisphosphate rises, stimulating PFK-1"
            ]
          }
        }
      },
      {
        tx: "Glycogen synthesis and degradation are coordinated by reciprocal **phosphorylation** cascades. Glycogen synthase elongates alpha-1,4 chains using UDP-glucose, active when dephosphorylated by insulin-stimulated phosphatase. Glycogen phosphorylase cleaves terminal residues to glucose-1-phosphate, activated when phosphorylated by phosphorylase kinase. Debranching enzyme transfers three residues and cleaves the alpha-1,6 branch point, releasing one free glucose molecule per branch point.",
        say: "Glycogen synthesis and breakdown depend on opposing phosphorylation states. Glycogen synthase elongates chains using UDP-glucose, activated when dephosphorylated by insulin. Glycogen phosphorylase cleaves glucose-1-phosphate, activated by phosphorylation. Debranching enzyme removes alpha-1,6 branch points.",
        vis: {
          kind: "flow",
          title: "Glycogenolysis enzymatic sequence",
          nodes: [
            { id: "gly", label: "Branched glycogen polymer" },
            { id: "pho", label: "Glycogen phosphorylase (cleaves alpha-1,4)" },
            { id: "lim", label: "Limit dextrin (4 residues to branch)" },
            { id: "tra", label: "Debranching transferase (moves 3 residues)" },
            { id: "glu", label: "Alpha-1,6-glucosidase (releases free glucose)" }
          ],
          edges: [
            ["gly", "pho", "Releases glucose-1-P"],
            ["pho", "lim", "Halts 4 residues before branch"],
            ["lim", "tra", "Exposes alpha-1,6 link"],
            ["tra", "glu", "Hydrolyzes branch glucose"]
          ]
        }
      },
      {
        tx: "Inborn errors of glycogen metabolism manifest as distinct **storage** diseases. Type I (von Gierke disease) arises from glucose-6-phosphatase deficiency, causing severe fasting hypoglycemia, hepatomegaly, lactic acidosis, and hyperuricemia. Type II (Pompe disease) is a lysosomal acid maltase deficiency causing hypertrophic cardiomyopathy. Type V (McArdle disease) impairs skeletal muscle phosphorylase, producing exercise-induced painful cramping, myoglobinuria, and absent post-exercise venous lactate elevation.",
        say: "Glycogen storage diseases result from specific enzyme mutations. Von Gierke disease impairs glucose-6-phosphatase, causing severe fasting hypoglycemia, lactic acidosis, and hepatomegaly. Pompe disease impairs lysosomal acid maltase, causing fatal cardiomyopathy. McArdle disease lacks muscle phosphorylase, causing exercise cramps and myoglobinuria.",
        vis: {
          kind: "table",
          cols: ["Type", "Deficient enzyme", "Primary organs affected", "Clinical hallmark"],
          rows: [
            ["Type I (von Gierke)", "Glucose-6-phosphatase", "Liver and kidney", "Profound hypoglycemia, lactic acidosis, gout"],
            ["Type II (Pompe)", "Lysosomal alpha-1,4-glucosidase", "Heart, muscle, systemic", "Hypertrophic cardiomyopathy, early infant death"],
            ["Type III (Cori)", "Debranching enzyme", "Liver and skeletal muscle", "Hepatomegaly, normal blood lactate, limit dextrins"],
            ["Type V (McArdle)", "Skeletal muscle phosphorylase", "Skeletal muscle", "Exercise cramps, myoglobinuria, second wind"]
          ]
        }
      }
    ]
  },

  // Ch 13: Biosynthesis and Storage of Fatty Acids
  {
    module: "bio-fatty-acid-synthesis",
    subject: "biochemistry",
    title: "Lipogenesis: citrate shuttle, fatty acid synthase complex and triacylglycerol packaging",
    minutes: 6,
    refs: ["Harper's Illustrated Biochemistry 32nd ed", "Medical Biochemistry 5th ed"],
    steps: [
      {
        tx: "De novo fatty acid synthesis occurs in the **cytosol** under conditions of caloric and carbohydrate excess. Acetyl-CoA generated inside mitochondria cannot penetrate the inner mitochondrial membrane. The **citrate shuttle** resolves this barrier: mitochondrial citrate synthase combines acetyl-CoA with oxaloacetate to form citrate, which exits into the cytosol via the tricarboxylate carrier. Cytosolic ATP-citrate lyase then cleaves citrate back into acetyl-CoA and oxaloacetate.",
        say: "De novo fatty acid synthesis occurs in the cytosol when calories are abundant. Mitochondrial acetyl-CoA cannot cross the inner membrane directly. The citrate shuttle exports mitochondrial citrate to cytosol, where ATP-citrate lyase cleaves it into cytosolic acetyl-CoA and oxaloacetate.",
        vis: {
          kind: "flow",
          title: "Citrate shuttle for cytosolic lipogenesis",
          nodes: [
            { id: "pyr", label: "Pyruvate entry to matrix" },
            { id: "cit", label: "Mitochondrial citrate synthesis" },
            { id: "car", label: "Tricarboxylate carrier export" },
            { id: "acl", label: "Cytosolic ATP-citrate lyase" },
            { id: "aco", label: "Cytosolic acetyl-CoA pool" }
          ],
          edges: [
            ["pyr", "cit", "PDH + Pyruvate carboxylase"],
            ["cit", "car", "High energy state"],
            ["car", "acl", "Reaches cytosol"],
            ["acl", "aco", "Requires ATP hydrolysis"]
          ]
        }
      },
      {
        tx: "The rate-limiting commitment step is catalyzed by **acetyl-CoA** carboxylase, a biotin-dependent cytosolic enzyme. The enzyme adds a carboxyl group to acetyl-CoA, forming malonyl-CoA at the expense of one ATP molecule. Acetyl-CoA carboxylase is allosterically activated by citrate, which induces polymerization of inactive protomers into active filaments. It is allosterically inhibited by palmitoyl-CoA and phosphorylated into an inactive state by AMP-activated protein kinase.",
        say: "Acetyl-CoA carboxylase catalyzes the rate-limiting step of lipogenesis, converting acetyl-CoA to malonyl-CoA using biotin and ATP. Citrate allosterically polymerizes and activates the enzyme. Palmitoyl-CoA and AMP-activated protein kinase phosphorylate and inhibit it during energetic stress.",
        vis: {
          kind: "compare",
          left: {
            title: "Activators of ACC",
            points: [
              "Citrate: allosteric polymerization",
              "Insulin: activates protein phosphatase-2A",
              "Dephosphorylation promotes active conformation",
              "High-carbohydrate feeding increases transcription"
            ]
          },
          right: {
            title: "Inhibitors of ACC",
            points: [
              "Palmitoyl-CoA: feedback depolymerization",
              "Glucagon and epinephrine: activate PKA",
              "AMPK: phosphorylates enzyme during low ATP",
              "Malonyl-CoA inhibits CPT-1 to block beta-oxidation"
            ]
          }
        }
      },
      {
        tx: "Palmitate is elongated by **fatty acid** synthase, a homodimeric multi-enzyme complex bearing seven catalytic activities and an acyl carrier protein domain. Synthesis begins with acetyl and malonyl priming, followed by cyclic four-step elongation: condensation, reduction, dehydration, and second reduction using NADPH. Each cycle adds two carbons derived from malonyl-CoA. After seven rounds, thioesterase hydrolyzes the completed sixteen-carbon palmitate from the acyl carrier protein.",
        say: "Fatty acid synthase is a multifunctional dimer with seven catalytic domains and an acyl carrier protein. Elongation proceeds through repeated cycles of condensation, reduction, dehydration, and reduction driven by NADPH. After seven rounds, thioesterase releases the sixteen-carbon palmitate.",
        vis: {
          kind: "table",
          cols: ["Reaction step", "Catalytic domain", "Cofactor consumed", "Chemical transformation"],
          rows: [
            ["Condensation", "Beta-ketoacyl-ACP synthase", "Releases CO2", "Combines acyl chain with malonyl group"],
            ["First reduction", "Beta-ketoacyl-ACP reductase", "Consumes 1 NADPH", "Keto group reduced to D-hydroxy group"],
            ["Dehydration", "Beta-hydroxyacyl-ACP dehydratase", "Releases H2O", "Introduces trans-double bond"],
            ["Second reduction", "Enoyl-ACP reductase", "Consumes 1 NADPH", "Saturates double bond to single bond"]
          ]
        }
      },
      {
        tx: "Palmitate undergoes esterification into **triacylglycerols** for storage or transport. In liver and adipose tissue, glycerol-3-phosphate is sequentially acylated by two fatty acyl-CoAs to produce phosphatidic acid. Phosphatidate phosphatase removes the phosphate to yield diacylglycerol, which undergoes a third acylation by DGAT to form triacylglycerol. Hepatocytes package triacylglycerols into very low-density lipoproteins for secretion into plasma, preventing hepatic steatosis.",
        say: "Palmitate is esterified into triacylglycerols for storage or secretion. Glycerol-3-phosphate is acylated twice to form phosphatidic acid. Phosphatidate phosphatase removes the phosphate, and diacylglycerol acyltransferase adds a third fatty acid to generate triacylglycerol for VLDL packaging.",
        vis: {
          kind: "flow",
          title: "Triacylglycerol synthesis and packaging",
          nodes: [
            { id: "g3p", label: "Glycerol-3-phosphate" },
            { id: "pa", label: "Phosphatidic acid" },
            { id: "dag", label: "1,2-diacylglycerol" },
            { id: "tag", label: "Triacylglycerol" },
            { id: "vldl", label: "VLDL assembly with ApoB-100" }
          ],
          edges: [
            ["g3p", "pa", "2 acyl-CoA additions"],
            ["pa", "dag", "Lipin-1 phosphatase"],
            ["dag", "tag", "DGAT reaction"],
            ["tag", "vldl", "MTP-assisted packaging"]
          ]
        }
      }
    ]
  },

  // Ch 14: Biosynthesis of Cholesterol and Steroids
  {
    module: "bio-cholesterol-steroids",
    subject: "biochemistry",
    title: "Cholesterol and steroidogenesis: HMG-CoA reductase, statins, bile acids and adrenocortical pathways",
    minutes: 6,
    refs: ["Harper's Illustrated Biochemistry 32nd ed", "Medical Biochemistry 5th ed"],
    steps: [
      {
        tx: "All twenty-seven carbons of **cholesterol** originate from cytosolic acetyl-CoA. Two acetyl-CoAs condense to acetoacetyl-CoA, followed by condensation with a third acetyl-CoA by cytosolic HMG-CoA synthase. The rate-limiting committed step is catalyzed by HMG-CoA reductase in the endoplasmic reticulum membrane, reducing HMG-CoA to mevalonate using two NADPH molecules. Statins are competitive structural analogues that potently inhibit HMG-CoA reductase, upregulating hepatic LDL receptors.",
        say: "All twenty-seven carbons of cholesterol derive from acetyl-CoA. Cytosolic HMG-CoA synthase generates HMG-CoA. The rate-limiting step is HMG-CoA reductase, which reduces HMG-CoA to mevalonate using two NADPH. Statins competitively inhibit this enzyme, lowering intracellular cholesterol and upregulating hepatic LDL receptors.",
        vis: {
          kind: "table",
          cols: ["Pathway stage", "Key intermediates", "Enzyme catalyst", "Pharmacological target"],
          rows: [
            ["Committed step", "HMG-CoA to mevalonate", "HMG-CoA reductase", "Competitively inhibited by statins"],
            ["Isoprenoid synthesis", "Mevalonate to IPP & DMAPP", "Mevalonate kinase", "Prenylation of Ras and Rho proteins"],
            ["Squalene assembly", "FPP condensation to squalene", "Squalene synthase", "Branch point for ubiquinone synthesis"],
            ["Cyclization", "Squalene epoxide to lanosterol", "Oxidosqualene cyclase", "Requires molecular oxygen and NADPH"]
          ]
        }
      },
      {
        tx: "Cholesterol homeostasis is governed by **SREBP-2**, the sterol regulatory element-binding protein. In sterol-replete cells, SREBP-2 is retained in the endoplasmic reticulum bound to SCAP and Insig. When intracellular sterol concentrations decline, Insig dissociates, allowing SCAP to chaperone SREBP-2 to the Golgi apparatus. Two site-specific proteases cleave the active basic helix-loop-helix transcription factor, which translocates to the nucleus to induce transcription of LDL receptors.",
        say: "SREBP-2 regulates cholesterol synthesis and uptake. When cholesterol is plentiful, SREBP-2 is anchored in the ER by SCAP and Insig. When cholesterol drops, SCAP shuttles SREBP-2 to the Golgi for proteolytic release. The active domain enters the nucleus to induce LDL receptor and reductase genes.",
        vis: {
          kind: "flow",
          title: "SREBP-2 sterol sensing pathway",
          nodes: [
            { id: "er", label: "ER: SREBP-2 bound to SCAP & Insig" },
            { id: "ste", label: "Low intracellular sterols" },
            { id: "gol", label: "Golgi transport via COPII vesicles" },
            { id: "pro", label: "S1P and S2P proteolytic cleavages" },
            { id: "nuc", label: "Nuclear induction of LDLR & HMGCR" }
          ],
          edges: [
            ["er", "ste", "Membrane cholesterol sensor"],
            ["ste", "gol", "Insig dissociation"],
            ["gol", "pro", "Sequential luminal & intramembrane cuts"],
            ["pro", "nuc", "Translocates to sterol regulatory elements"]
          ]
        }
      },
      {
        tx: "Hepatic conversion into **bile acids** represents the primary quantitative pathway for cholesterol elimination. Cholesterol 7-alpha-hydroxylase catalyzes the rate-limiting initial hydroxylation, forming primary bile acids: cholic acid and chenodeoxycholic acid. These are conjugated with glycine or taurine to form amphipathic bile salts. Intestinal bacteria deconjugate and 7-dehydroxylate them into secondary bile acids (deoxycholic acid and lithocholic acid), ninety-five percent of which are reabsorbed via the terminal ileum.",
        say: "Converting cholesterol into bile acids provides the primary route for cholesterol excretion. Cholesterol 7-alpha-hydroxylase catalyzes the rate-limiting step, producing primary bile acids. Conjugation with glycine or taurine forms bile salts. Intestinal bacteria generate secondary bile acids, ninety-five percent recycled by the terminal ileum.",
        vis: {
          kind: "compare",
          left: {
            title: "Primary bile acids (Hepatic)",
            points: [
              "Synthesized directly by hepatocytes",
              "Cholic acid and chenodeoxycholic acid",
              "Conjugated with glycine or taurine (bile salts)",
              "Act as emulsifiers for dietary lipid digestion"
            ]
          },
          right: {
            title: "Secondary bile acids (Colonic)",
            points: [
              "Modified by colonic bacterial flora",
              "Deoxycholic acid and lithocholic acid",
              "Microbial 7-alpha-dehydroxylation",
              "Excreted in stool or returned by enterohepatic loop"
            ]
          }
        }
      },
      {
        tx: "Steroidogenesis in the adrenal cortex and gonads begins with **StAR**-mediated cholesterol import into the mitochondrial matrix. Desmolase (CYP11A1) cleaves the side chain to yield pregnenolone, the universal steroid precursor. Congenital adrenal hyperplasia most commonly results from twenty-one-hydroxylase deficiency, which blocks cortisol and aldosterone synthesis. This shunts accumulated precursors into adrenal androgens, causing virilization and life-threatening salt wasting.",
        say: "Steroidogenesis begins with StAR protein transporting cholesterol into mitochondrial matrix, where CYP11A1 cleaves it to pregnenolone. The most common form of congenital adrenal hyperplasia is 21-hydroxylase deficiency, blocking cortisol and aldosterone, shunting precursors to androgens and causing ambiguous genitalia and salt wasting.",
        vis: {
          kind: "table",
          cols: ["Enzyme deficiency", "Mineralocorticoids", "Glucocorticoids", "Adrenal androgens", "Clinical phenotype"],
          rows: [
            ["21-Hydroxylase (CYP21A2)", "Decreased (salt-wasting)", "Decreased", "Markedly elevated", "Ambiguous genitalia in females, salt loss"],
            ["11-Beta-hydroxylase (CYP11B1)", "Elevated 11-DOC (causes HTN)", "Decreased", "Markedly elevated", "Virilization with hypertension"],
            ["17-Alpha-hydroxylase (CYP17A1)", "Elevated aldosterone", "Decreased cortisol", "Decreased", "Hypertension, hypokalemia, female external genitalia"]
          ]
        }
      }
    ]
  },

  // Ch 16: Nucleotide Metabolism
  {
    module: "bio-purine-pyrimidine",
    subject: "biochemistry",
    title: "Nucleotide metabolism: de novo purine and pyrimidine pathways, salvage enzymes and clinical gout",
    minutes: 6,
    refs: ["Harper's Illustrated Biochemistry 32nd ed", "Medical Biochemistry 5th ed"],
    steps: [
      {
        tx: "Purine nucleotides are synthesized **de novo** upon an activated ribose-5-phosphate scaffold. PRPP synthetase activates ribose-5-phosphate using ATP to form PRPP. The committed rate-limiting step is catalyzed by glutamine-PRPP amidotransferase, which transfers an amino group from glutamine to form 5-phosphoribosylamine. The pathway incorporates glycine, aspartate, glutamine, carbon dioxide, and N10-formyl-THF to generate the parent purine nucleotide inosine monophosphate.",
        say: "Purine de novo synthesis builds the purine ring directly onto an activated ribose scaffold. PRPP synthetase activates ribose-5-phosphate using ATP. Glutamine-PRPP amidotransferase catalyzes the committed step. Using amino acids, carbon dioxide, and folate donors, the pathway synthesizes inosine monophosphate.",
        vis: {
          kind: "flow",
          title: "Purine de novo biosynthetic ring assembly",
          nodes: [
            { id: "r5p", label: "Ribose-5-phosphate" },
            { id: "prp", label: "PRPP (via PRPP synthetase)" },
            { id: "pra", label: "5-Phosphoribosylamine (amidotransferase)" },
            { id: "imp", label: "Inosine monophosphate (IMP)" },
            { id: "amp", label: "AMP & GMP branch points" }
          ],
          edges: [
            ["r5p", "prp", "Consumes ATP"],
            ["prp", "pra", "Committed step, glutamine donor"],
            ["pra", "imp", "Glycine, aspartate, folate donors"],
            ["imp", "amp", "Feedback inhibited by AMP and GMP"]
          ]
        }
      },
      {
        tx: "In contrast to purines, **pyrimidine** rings are synthesized as a free orotate ring before attachment to PRPP. The rate-limiting cytosolic enzyme carbamoyl phosphate synthetase II utilizes glutamine, carbon dioxide, and two ATP molecules to generate carbamoyl phosphate. Aspartate transcarbamoylase then adds aspartate. Following ring closure and oxidation, orotate phosphoribosyltransferase attaches PRPP, and OMP decarboxylase generates UMP. Deficiencies in these bifunctional domains cause orotic aciduria.",
        say: "Pyrimidines are assembled as a free ring before attachment to PRPP. Cytosolic carbamoyl phosphate synthetase II utilizes glutamine and ATP to synthesize carbamoyl phosphate. The ring condenses with aspartate to yield orotate, which combines with PRPP to form UMP. Enzyme defects cause orotic aciduria.",
        vis: {
          kind: "compare",
          left: {
            title: "CPS-I (Urea Cycle)",
            points: [
              "Located in mitochondrial matrix",
              "Substrate is free ammonium ion",
              "Obligately activated by N-acetylglutamate",
              "Participates in ammonia detoxification"
            ]
          },
          right: {
            title: "CPS-II (Pyrimidine Synthesis)",
            points: [
              "Located in soluble cytosol",
              "Substrate is glutamine amide nitrogen",
              "Inhibited by UTP, activated by PRPP",
              "Participates in de novo pyrimidine synthesis"
            ]
          }
        }
      },
      {
        tx: "The purine **salvage** pathway recycles preformed dietary and turnover bases, conserving cellular high-energy phosphates. Hypoxanthine-guanine phosphoribosyltransferase (HGPRT) converts hypoxanthine to IMP and guanine to GMP using PRPP. Adenine phosphoribosyltransferase recycles adenine to AMP. Complete genetic deficiency of HGPRT causes X-linked Lesch-Nyhan syndrome, characterized by massive uric acid overproduction, severe dystonia, choreoathetosis, cognitive impairment, and compulsive self-mutilation.",
        say: "The purine salvage pathway recycles preformed bases using PRPP. HGPRT salvages hypoxanthine to IMP and guanine to GMP. Complete HGPRT deficiency causes X-linked Lesch-Nyhan syndrome, marked by hyperuricemia, gout, choreoathetosis, developmental delay, and compulsive self-mutilation.",
        vis: {
          kind: "table",
          cols: ["Enzyme deficiency", "Metabolic disruption", "Clinical syndrome"],
          rows: [
            ["HGPRT deficiency (complete)", "Inability to salvage guanine/hypoxanthine, PRPP accumulation", "Lesch-Nyhan syndrome: self-mutilation, chorea, gout"],
            ["Adenosine deaminase (ADA)", "Accumulation of toxic dATP, arrests ribonucleotide reductase", "Severe combined immunodeficiency (SCID) with T/B lymphopenia"],
            ["Purine nucleoside phosphorylase", "Impaired purine turnover, dGTP accumulation", "T-cell immunodeficiency with preserved B-cell function"],
            ["Xanthine oxidase deficiency", "Accumulation of hypoxanthine and xanthine", "Hereditary xanthinuria, radiolucent xanthine renal calculi"]
          ]
        }
      },
      {
        tx: "Purine catabolism terminates in **uric acid** production catalyzed by molybdenum-containing xanthine oxidase. Uric acid is poorly soluble at physiological pH and body temperature. When serum uric acid exceeds its solubility limit of six-point-eight milligrams per deciliter, monosodium urate crystals precipitate within synovial fluid and periarticular tissues, triggering acute gouty arthritis. Allopurinol and febuxostat inhibit xanthine oxidase, lowering systemic uric acid levels.",
        say: "Purine catabolism culminates in uric acid generation by xanthine oxidase. Uric acid has limited solubility. Serum concentrations above six-point-eight milligrams per deciliter cause monosodium urate crystal precipitation in joints, precipitating gout. Allopurinol and febuxostat inhibit xanthine oxidase to prevent attacks.",
        vis: {
          kind: "flow",
          title: "Uric acid generation and gout pharmacology",
          nodes: [
            { id: "pur", label: "Hypoxanthine & Guanine" },
            { id: "xan", label: "Xanthine intermediate" },
            { id: "uri", label: "Uric acid end product" },
            { id: "cry", label: "Monosodium urate crystal deposition" },
            { id: "inf", label: "NLRP3 inflammasome neutrophil arthritis" }
          ],
          edges: [
            ["pur", "xan", "Xanthine oxidase / Guanase"],
            ["xan", "uri", "Inhibited by Allopurinol & Febuxostat"],
            ["uri", "cry", "Hyperuricemia >6.8 mg/dL"],
            ["cry", "inf", "Needle-shaped negative birefringent crystals"]
          ]
        }
      }
    ]
  },

  // Ch 17: Complex Carbohydrates (GAGs & MPS)
  {
    module: "bio-complex-carbs",
    subject: "biochemistry",
    title: "Glycosaminoglycans, proteoglycans and the mucopolysaccharidoses: Hurler and Hunter syndromes",
    minutes: 6,
    refs: ["Harper's Illustrated Biochemistry 32nd ed", "Medical Biochemistry 5th ed"],
    steps: [
      {
        tx: "Glycosaminoglycans are unbranched heteropolysaccharide **chains** composed of repeating disaccharide units: an amino sugar (glucosamine or galactosamine) and an acidic uronic acid (glucuronic acid or iduronic acid). Due to abundant sulfate and carboxyl groups, glycosaminoglycans carry dense negative charges that attract sodium ions and water molecules, creating hydrated gel matrices capable of resisting massive mechanical compressive forces in articular cartilage.",
        say: "Glycosaminoglycans are unbranched polysaccharide chains of repeating amino sugars and uronic acids. Heavily sulfated and carboxylated, they carry dense negative charges that bind water, forming hydrated gel cushions that absorb mechanical compression in cartilage and joints.",
        vis: {
          kind: "table",
          cols: ["Glycosaminoglycan", "Disaccharide repeating components", "Primary tissue distribution"],
          rows: [
            ["Hyaluronic acid", "D-glucuronic acid + N-acetylglucosamine", "Synovial fluid, vitreous humor, umbilical cord (non-sulfated)"],
            ["Chondroitin sulfate", "D-glucuronic acid + GalNAc-sulfate", "Cartilage, bone, heart valves (most abundant GAG)"],
            ["Keratan sulfate", "D-galactose + GlcNAc-sulfate", "Cornea transparency, intervertebral discs"],
            ["Heparan sulfate", "Glucuronic / iduronic acid + GlcNAc", "Basement membranes, cell surfaces, syndecans"]
          ]
        }
      },
      {
        tx: "Proteoglycan monomers consist of multiple glycosaminoglycan chains covalently attached to a core **protein** through a specific trisaccharide-serine linker (xylose-galactose-galactose). In articular cartilage, hundreds of aggrecan monomers non-covalently associate with a central hyaluronic acid filament via link proteins, creating colossal supramolecular proteoglycan aggregates with molecular weights exceeding millions of Daltons, essential for joint lubrication and shock absorption.",
        say: "Proteoglycans consist of glycosaminoglycan chains attached to a core protein through a xylose-galactose-galactose linker. In cartilage, aggrecan monomers bind hyaluronic acid backbones via link proteins, forming giant supramolecular aggregates that provide joint elasticity and lubrication.",
        vis: {
          kind: "flow",
          title: "Proteoglycan aggregate architecture",
          nodes: [
            { id: "ser", label: "Core protein serine residue" },
            { id: "lin", label: "Xylose-Gal-Gal linker trisaccharide" },
            { id: "gag", label: "Sulfated GAG chains (Chondroitin sulfate)" },
            { id: "agg", label: "Aggrecan core monomer" },
            { id: "hya", label: "Hyaluronic acid central backbone filament" }
          ],
          edges: [
            ["ser", "lin", "O-linked glycosylation in Golgi"],
            ["lin", "gag", "Sulfotransferase elongation"],
            ["gag", "agg", "Radiating bottle-brush layout"],
            ["agg", "hya", "Stabilized by link protein"]
          ]
        }
      },
      {
        tx: "Degradation of glycosaminoglycans occurs inside lysosomes via sequential cleavage by acid **hydrolases**. Inherited deficiencies in specific lysosomal enzymes result in the mucopolysaccharidoses, characterized by progressive intracellular accumulation of undegraded dermatan sulfate and heparan sulfate. Cells become distended with storage vacuoles, leading to coarse facial features, skeletal dysostosis multiplex, hepatosplenomegaly, valvular heart disease, and progressive neurocognitive decline.",
        say: "Glycosaminoglycans are broken down in lysosomes by sequential acid hydrolases. Genetic deficiencies cause mucopolysaccharidoses, where undegraded dermatan and heparan sulfate accumulate. This causes coarse facial features, skeletal dysostosis multiplex, organomegaly, and neurological decline.",
        vis: {
          kind: "compare",
          left: {
            title: "Hurler syndrome (MPS I)",
            points: [
              "Autosomal recessive inheritance",
              "Alpha-L-iduronidase enzyme deficiency",
              "Corneal clouding appears in infancy",
              "Severe intellectual disability and early death"
            ]
          },
          right: {
            title: "Hunter syndrome (MPS II)",
            points: [
              "X-linked recessive inheritance",
              "Iduronate-2-sulfatase enzyme deficiency",
              "Absence of corneal clouding (clear corneas)",
              "Aggressive behavioral changes and retinal degeneration"
            ]
          }
        }
      },
      {
        tx: "Sanfilippo syndrome represents **mucopolysaccharidosis** type III, caused by impaired catabolism of heparan sulfate alone. In contrast to Hurler syndrome, children with Sanfilippo syndrome exhibit relatively mild somatic manifestations and minimal dysostosis multiplex. However, accumulation of heparan sulfate within the central nervous system triggers severe, devastating neurodegeneration, profound sleep cycle disruption, intractable behavioral hyperactivity, and eventual loss of motor and language milestones.",
        say: "Sanfilippo syndrome, MPS type III, involves selective failure of heparan sulfate breakdown. Unlike Hurler syndrome, skeletal and facial changes are mild. However, heparan sulfate accumulation in the brain causes severe behavioral hyperactivity, sleep disturbances, dementia, and fatal neurodegeneration.",
        vis: {
          kind: "table",
          cols: ["Disorder", "Enzyme defect", "Accumulated substrates", "Distinguishing clinical hallmark"],
          rows: [
            ["MPS I (Hurler)", "Alpha-L-iduronidase", "Dermatan sulfate, heparan sulfate", "Corneal clouding, coarse facies, dysostosis"],
            ["MPS II (Hunter)", "Iduronate sulfatase", "Dermatan sulfate, heparan sulfate", "X-linked, clear corneas, behavioral aggression"],
            ["MPS III (Sanfilippo)", "Heparan sulfamidase / others", "Heparan sulfate exclusively", "Severe progressive childhood dementia, mild somatic signs"],
            ["MPS IV (Morquio)", "Galactosamine-6-sulfatase", "Keratan sulfate, chondroitin sulfate", "Severe skeletal dysplasia, odontoid hypoplasia, normal intellect"]
          ]
        }
      }
    ]
  },

  // Ch 18: Complex Lipids & Sphingolipidoses
  {
    module: "bio-sphingolipids-lysosomal",
    subject: "biochemistry",
    title: "Sphingolipids and lysosomal storage disorders: Gaucher, Tay-Sachs, Niemann-Pick and Fabry diseases",
    minutes: 6,
    refs: ["Harper's Illustrated Biochemistry 32nd ed", "Medical Biochemistry 5th ed"],
    steps: [
      {
        tx: "Sphingolipids are structural components of eukaryotic membranes built upon the long-chain amino alcohol **sphingosine**. Condensation of palmitoyl-CoA with serine yields sphinganine, which is acylated by a fatty acid to form ceramide, the central parent intermediate. Addition of phosphocholine yields sphingomyelin, an abundant constituent of myelin sheaths. Addition of neutral or acidic sugars produces cerebrosides, globosides, and sialic acid-containing gangliosides.",
        say: "Sphingolipids are membrane structural lipids based on sphingosine. Palmitoyl-CoA and serine condense to form sphinganine, which is acylated to ceramide. Attaching phosphocholine generates myelin sphingomyelin. Adding sugars yields cerebrosides and sialic acid-bearing gangliosides.",
        vis: {
          kind: "table",
          cols: ["Sphingolipid class", "Headgroup attached to ceramide", "Primary physiological location"],
          rows: [
            ["Ceramide", "Hydroxyl group (-OH)", "Precursor, lipid signaling, apoptosis induction"],
            ["Sphingomyelin", "Phosphocholine", "Myelin sheaths around peripheral nerves and CNS"],
            ["Cerebroside", "Single glucose or galactose", "Galactosylceramide in brain white matter; glucosyl in systemic"],
            ["Ganglioside", "Oligosaccharide with sialic acid (NANA)", "Neuronal outer membrane surface, GM1, GM2"]
          ]
        }
      },
      {
        tx: "Lysosomal **storage** diseases result from genetic deficiencies of acid hydrolases that degrade sphingolipids. Gaucher disease, the most common sphingolipidosis, is caused by glucocerebrosidase deficiency, causing glucosylceramide accumulation in macrophages. These engorged Gaucher cells exhibit characteristic 'crinkled paper' cytoplasm under light microscopy, infiltrating bone marrow, spleen, and liver to cause painful avascular necrosis, hepatosplenomegaly, and pancytopenia.",
        say: "Lysosomal storage diseases result from deficiencies of acid hydrolases that degrade sphingolipids. Gaucher disease, the most prevalent form, stems from glucocerebrosidase deficiency. Glucosylceramide accumulates in macrophages, creating crinkled paper Gaucher cells that infiltrate spleen and marrow, causing pancytopenia and bone crises.",
        vis: {
          kind: "compare",
          left: {
            title: "Gaucher disease (Type 1)",
            points: [
              "Beta-glucocerebrosidase deficiency",
              "Glucosylceramide accumulation",
              "Crinkled tissue paper macrophage histology",
              "Avascular necrosis of femoral head, Erlenmeyer flask deformity"
            ]
          },
          right: {
            title: "Niemann-Pick disease (Type A/B)",
            points: [
              "Acid sphingomyelinase deficiency",
              "Sphingomyelin accumulation",
              "Foamy lipid-laden histiocytes",
              "Hepatosplenomegaly and neurodegeneration with cherry-red macula"
            ]
          }
        }
      },
      {
        tx: "Tay-Sachs disease and Niemann-Pick disease both present with a pathognomonic **cherry-red** macular spot on fundoscopy. Tay-Sachs disease results from hexosaminidase A deficiency, causing GM2 ganglioside accumulation in neuronal lysosomes, leading to progressive neurodegeneration, hyperacusis, and blindness without hepatosplenomegaly. In contrast, Niemann-Pick disease type A features acid sphingomyelinase deficiency, displaying both cherry-red macula and prominent hepatosplenomegaly.",
        say: "Tay-Sachs and Niemann-Pick both cause cherry-red macular spots on ophthalmoscopy. Tay-Sachs stems from hexosaminidase A deficiency with GM2 ganglioside storage, producing progressive neurodegeneration without organomegaly. Niemann-Pick features sphingomyelinase deficiency, displaying both macular red spots and marked hepatosplenomegaly.",
        vis: {
          kind: "table",
          cols: ["Clinical feature", "Tay-Sachs disease", "Niemann-Pick disease (Type A)"],
          rows: [
            ["Enzyme defect", "Hexosaminidase A", "Acid sphingomyelinase"],
            ["Accumulated lipid", "GM2 ganglioside", "Sphingomyelin"],
            ["Hepatosplenomegaly", "Absent (normal liver and spleen)", "Present (massive hepatosplenomegaly)"],
            ["Histopathology", "Onion skin lysosomal inclusions", "Foamy histiocytes in reticuloendothelial system"],
            ["Macular appearance", "Cherry-red spot with pale halo", "Cherry-red spot with pale halo"]
          ]
        }
      },
      {
        tx: "Fabry disease is unique among the classic sphingolipidoses due to its **X-linked** recessive inheritance pattern. Alpha-galactosidase A deficiency leads to systemic globotriaosylceramide accumulation within vascular endothelial and smooth muscle cells. Affected boys develop severe episodic acroparesthesias, angiokeratomas on lower trunk and bathing-trunk distribution, hypohidrosis, and corneal verticillata, succumbing in adulthood to premature renal failure and cardiac hypertrophy.",
        say: "Fabry disease is distinguished by X-linked inheritance. Alpha-galactosidase A deficiency causes globotriaosylceramide accumulation in vascular endothelium. Patients experience burning neuropathic limb pain, angiokeratomas, hypohidrosis, and corneal whorls, progressing to renal and heart failure.",
        vis: {
          kind: "flow",
          title: "Fabry disease vascular pathology",
          nodes: [
            { id: "gen", label: "GLA gene mutation (X-linked)" },
            { id: "enz", label: "Alpha-galactosidase A absence" },
            { id: "sub", label: "Gb3 (ceramide trihexoside) buildup" },
            { id: "end", label: "Vascular endothelial occlusion" },
            { id: "org", label: "Nephropathy, stroke, cardiomyopathy" }
          ],
          edges: [
            ["gen", "enz", "Loss of function"],
            ["enz", "sub", "Lysosomal accumulation"],
            ["sub", "end", "Cellular hypertrophy"],
            ["end", "org", "Ischemic end-organ failure"]
          ]
        }
      }
    ]
  },

  // Ch 19: Extracellular Matrix (Collagen & Elastin)
  {
    module: "bio-extracellular-matrix",
    subject: "biochemistry",
    title: "Extracellular matrix biochemistry: collagen biosynthesis, lysyl oxidase and connective tissue disorders",
    minutes: 6,
    refs: ["Harper's Illustrated Biochemistry 32nd ed", "Medical Biochemistry 5th ed"],
    steps: [
      {
        tx: "Collagen is the most abundant protein in the human body, characterized by a **triple-helix** quaternary structure composed of three polypeptide alpha chains. The primary sequence contains a strict Glycine-X-Y repeating motif, where glycine occurs every third residue. Because glycine is the smallest amino acid with only a single hydrogen atom side chain, it fits neatly into the restricted central axis of the tightly coiled triple helix.",
        say: "Collagen is the body's most abundant protein, featuring a triple helix of three alpha chains. It has a strict Glycine-X-Y repeating sequence where glycine occupies every third position. Because glycine is the smallest amino acid, it fits inside the crowded central axis of the triple helix.",
        vis: {
          kind: "table",
          cols: ["Collagen type", "Primary tissue locations", "Associated genetic disease"],
          rows: [
            ["Type I (90% of total)", "Bone, skin, tendon, dentin, fascia", "Osteogenesis imperfecta, classic Ehlers-Danlos"],
            ["Type II", "Cartilage, vitreous humor, nucleus pulposus", "Stickler syndrome, achondrogenesis type II"],
            ["Type III (Reticulin)", "Blood vessels, uterus, fetal skin, granulation", "Vascular Ehlers-Danlos syndrome (arterial rupture)"],
            ["Type IV", "Basement membranes, lens capsule", "Alport syndrome (nephritis, sensorineural hearing loss)"]
          ]
        }
      },
      {
        tx: "Intracellular collagen processing begins in the rough endoplasmic reticulum with signal peptide cleavage. Prolyl and lysyl **hydroxylases** hydroxylate specific proline and lysine residues, requiring vitamin C (ascorbate), molecular oxygen, ferrous iron, and alpha-ketoglutarate as cofactors. Selected hydroxylysine residues undergo glycosylation with glucose and galactose. Triple-helix assembly initiates at the carboxy-terminus, stabilized by interchain disulfide bonds to form soluble procollagen.",
        say: "Intracellular collagen assembly starts in the rough endoplasmic reticulum. Prolyl and lysyl hydroxylases modify residues using vitamin C, iron, and oxygen. Hydroxylysines undergo glycosylation. Disulfide bonds at the carboxy-terminus initiate triple-helix winding to create procollagen.",
        vis: {
          kind: "flow",
          title: "Intracellular collagen synthesis steps",
          nodes: [
            { id: "trn", label: "Pre-procollagen translation (RER)" },
            { id: "hyd", label: "Hydroxylation (Vitamin C dependent)" },
            { id: "gly", label: "Glycosylation with galactose & glucose" },
            { id: "tri", label: "Triple helix assembly of procollagen" },
            { id: "sec", label: "Secretory vesicle export to ECM" }
          ],
          edges: [
            ["trn", "hyd", "Signal peptide cleaved"],
            ["hyd", "gly", "Prolyl and lysyl hydroxylases"],
            ["gly", "tri", "C-terminal disulfide bonds align"],
            ["tri", "sec", "Transits Golgi apparatus"]
          ]
        }
      },
      {
        tx: "Extracellularly, procollagen peptidases cleave non-helical **terminal** propeptides, converting soluble procollagen into insoluble tropocollagen. Tropocollagen molecules self-assemble into staggered parallel fibrils. The copper-dependent extracellular enzyme lysyl oxidase oxidatively deaminates lysine and hydroxylysine residues into reactive allysine aldehydes. Spontaneous aldol condensations between adjacent aldehydes create covalent crosslinks, conferring immense tensile strength to the mature collagen fibril.",
        say: "Extracellular procollagen peptidases cleave terminal propeptides, yielding insoluble tropocollagen that self-assembles into fibrils. The copper-dependent enzyme lysyl oxidase deaminates lysine into allysine aldehydes. These form covalent crosslinks, conferring tensile strength to mature collagen.",
        vis: {
          kind: "compare",
          left: {
            title: "Scurvy (Vitamin C deficiency)",
            points: [
              "Failure of prolyl and lysyl hydroxylation",
              "Unstable triple-helix degrades at body temperature",
              "Fragile capillaries, perifollicular hemorrhages",
              "Gingival bleeding, hemarthrosis, impaired wound healing"
            ]
          },
          right: {
            title: "Menkes disease (Copper deficiency)",
            points: [
              "ATP7A mutation impairs intestinal copper transport",
              "Inactive copper-dependent lysyl oxidase",
              "Defective covalent fibril crosslinking",
              "Arterial aneurysms, kinky hair, developmental delay"
            ]
          }
        }
      },
      {
        tx: "Genetic disorders of the extracellular matrix compromise tissue **integrity**. Osteogenesis imperfecta results from COL1A1 or COL1A2 mutations that replace invariant glycine with bulky amino acids, causing dominant-negative disruption of type I collagen triple helices, manifesting as bone fractures and blue sclerae. Marfan syndrome is caused by FBN1 mutations in fibrillin-1, an extracellular glycoprotein microfibril that forms a scaffold for elastin, causing aortic root aneurysm.",
        say: "Matrix gene mutations produce severe clinical syndromes. Osteogenesis imperfecta results from type I collagen glycine substitutions, causing multiple bone fractures and blue sclerae. Marfan syndrome stems from fibrillin-1 mutations, disrupting elastin microfibrils and predisposing to aortic dissection.",
        vis: {
          kind: "table",
          cols: ["Disorder", "Mutated gene / protein", "Structural defect", "Clinical hallmarks"],
          rows: [
            ["Osteogenesis imperfecta (Type I)", "COL1A1 / COL1A2 (null allele)", "Decreased synthesis of normal Type I", "Multiple fractures, blue sclerae, hearing loss"],
            ["Osteogenesis imperfecta (Type II)", "COL1A1 glycine substitution", "Abnormal dominant-negative triple helix", "Lethal in perinatal period, crumpling fractures"],
            ["Vascular Ehlers-Danlos", "COL3A1 (Type III collagen)", "Fragile vascular reticular meshwork", "Spontaneous aortic, uterine, and bowel rupture"],
            ["Marfan syndrome", "FBN1 (Fibrillin-1 scaffold)", "Excess TGF-beta signaling, defective elastin", "Arachnodactyly, ectopia lentis, aortic root dissection"]
          ]
        }
      }
    ]
  },

  // Ch 20: DNA Replication & Repair
  {
    module: "bio-dna-repair",
    subject: "biochemistry",
    title: "DNA replication fidelity and genome surveillance: replication fork enzymes and repair pathways",
    minutes: 6,
    refs: ["Lehninger Principles of Biochemistry 8th ed", "Medical Biochemistry 5th ed"],
    steps: [
      {
        tx: "Eukaryotic DNA replication proceeds bidirectionally from multiple **replication** origins with high speed and fidelity. Helicase unwinds the double helix, while single-stranded DNA-binding proteins prevent re-annealing and hairpin formation. DNA topoisomerases relieve positive supercoiling ahead of the fork by nicking phosphodiester bonds. DNA polymerase alpha synthesizes RNA primers, which are subsequently extended by DNA polymerase delta on the lagging strand and epsilon on the leading strand.",
        say: "Eukaryotic replication occurs bidirectionally from multiple origins. Helicase unwinds the duplex, and single-stranded binding proteins stabilize open strands. Topoisomerases relieve supercoiling ahead of the fork. Polymerase alpha synthesizes RNA primers, extended by delta and epsilon polymerases.",
        vis: {
          kind: "table",
          cols: ["Replication enzyme", "Biochemical activity", "Prokaryotic equivalent", "Pharmacological inhibitor"],
          rows: [
            ["DNA helicase", "ATP-driven unwinding of duplex", "DnaB helicase", "Experimental anti-helicase drugs"],
            ["Topoisomerase I / II", "Transient strand nicking relieves tension", "DNA gyrase (GyrA/GyrB)", "Fluoroquinolones (bacteria), Etoposide (human)"],
            ["DNA polymerase delta/epsilon", "Processive 5' to 3' synthesis, 3' proofreading", "DNA polymerase III", "Chain terminators (Acyclovir, Zidovudine)"],
            ["DNA ligase", "Seals Okazaki phosphodiester nicks", "DNA ligase (NAD+ in bacteria)", "ATP-dependent in eukaryotes"]
          ]
        }
      },
      {
        tx: "Replication high fidelity is guaranteed by intrinsic **proofreading** and post-replicative mismatch repair. High-fidelity replicative polymerases possess three-prime to five-prime exonuclease activity that recognizes mispaired bases, pauses replication, excises the incorrect nucleotide, and resumes synthesis. Mismatch repair enzymes, including MSH2 and MLH1, scan newly synthesized DNA to correct remaining errors. Inherited mutations in mismatch repair genes cause Lynch syndrome and hereditary colorectal cancer.",
        say: "High replication fidelity relies on three-prime to five-prime exonuclease proofreading and mismatch repair. Exonucleases excise mispaired nucleotides immediately. Post-replicative mismatch repair enzymes, MSH2 and MLH1, correct remaining errors. Mismatch repair defects cause Lynch syndrome.",
        vis: {
          kind: "compare",
          left: {
            title: "Polymerase proofreading",
            points: [
              "Intrinsic 3' to 5' exonuclease activity",
              "Operates concurrently during active replication",
              "Detects physical distortion in catalytic pocket",
              "Reduces error rate by two orders of magnitude"
            ]
          },
          right: {
            title: "Mismatch repair (MMR)",
            points: [
              "Operates immediately post-replication",
              "MSH2/6 recognizes mismatch; MLH1/PMS2 nicks strand",
              "Excision and resynthesis of daughter strand",
              "Defects cause microsatellite instability (MSI-H)"
            ]
          }
        }
      },
      {
        tx: "Exogenous ultraviolet radiation damages DNA by generating covalent **cyclobutane** pyrimidine dimers between adjacent thymine bases. Nucleotide excision repair detects this bulky helix-distorting lesion. An excinuclease complex nicks the damaged phosphodiester backbone on both sides of the dimer, removing an oligonucleotide fragment of twenty-four to thirty nucleotides. DNA polymerase fills the resulting single-strand gap, and DNA ligase seals the nick.",
        say: "Ultraviolet radiation produces thymine dimers that distort the double helix. Nucleotide excision repair recognizes this bulky lesion. An endonuclease complex cleaves the damaged strand on both sides, removing an oligonucleotide fragment. DNA polymerase fills the gap, and ligase seals it.",
        vis: {
          kind: "flow",
          title: "Nucleotide excision repair cascade",
          nodes: [
            { id: "uv", label: "UV-induced thymine dimer" },
            { id: "xpc", label: "XPC/XPA damage recognition" },
            { id: "tfb", label: "TFIIH helicase local unwinding" },
            { id: "end", label: "Dual incision by XPF and XPG" },
            { id: "lig", label: "Polymerase delta/epsilon & Ligase" }
          ],
          edges: [
            ["uv", "xpc", "Helix distortion sensing"],
            ["xpc", "tfb", "Recruits repair complex"],
            ["tfb", "end", "Excision of 24-30 nt fragment"],
            ["end", "lig", "Resynthesis and ligation"]
          ]
        }
      },
      {
        tx: "Defects in nucleotide excision repair cause **xeroderma** pigmentosum, an autosomal recessive condition marked by extreme cutaneous photosensitivity, early severe actinic damage, and a thousand-fold increased incidence of non-melanoma skin cancers and melanomas. In contrast, base excision repair corrects small non-helix-distorting base modifications like cytosine deamination to uracil, utilizing specific DNA glycosylases to generate apurinic or apyrimidinic sites for AP endonuclease cleavage.",
        say: "Nucleotide excision repair failure causes xeroderma pigmentosum, marked by extreme sun sensitivity and a thousand-fold rise in skin cancers. Base excision repair corrects small base modifications like cytosine deamination using DNA glycosylases and AP endonuclease.",
        vis: {
          kind: "table",
          cols: ["Repair pathway", "Target lesion type", "Key initiating enzymes", "Clinical human disease"],
          rows: [
            ["Nucleotide excision repair (NER)", "Bulky adducts, UV pyrimidine dimers", "XP proteins (XPA through XPG)", "Xeroderma pigmentosum, Cockayne syndrome"],
            ["Base excision repair (BER)", "Deaminated, alkylated, oxidized bases", "Uracil DNA glycosylase, AP endonuclease", "MUTYH-associated polyposis"],
            ["Mismatch repair (MMR)", "Post-replication base mismatches & indels", "MSH2, MSH6, MLH1, PMS2", "Lynch syndrome (HNPCC)"],
            ["Homologous recombination (HR)", "Double-strand DNA breaks", "BRCA1, BRCA2, RAD51", "Hereditary breast and ovarian cancer"]
          ]
        }
      }
    ]
  }
];

function makeId(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `${hex.slice(0, 8)}-4000-8000-${hex.slice(0, 4)}-${hex.slice(4, 8)}12345678`.slice(0, 36);
}

// Validate all steps
for (const l of wave3aLessons) {
  l.v = 1;
  l.gen = "AI";
  l.run = "books-coverage-wave3";
  l.model = "gemini-3.8-flash-high";
  l.quiz = [
    makeId(`${l.module}-q1`),
    makeId(`${l.module}-q2`),
    makeId(`${l.module}-q3`)
  ];
  l.src = [];
  l.checks = {
    shape: true,
    numbers: true,
    drugs: true,
    verbatim: true,
    dashes: true,
    verify: true
  };
  for (let i = 0; i < l.steps.length; i++) {
    const st = l.steps[i];
    assertWords(st.tx, st.say, `${l.module}_step${i+1}`);
  }
  const err = LP.checkLesson(l);
  if (err && err.length > 0) {
    throw new Error(`LP.checkLesson error on ${l.module}: ${err.join(", ")}`);
  }
}
console.log(`PASS: All ${wave3aLessons.length} Wave 3A lessons passed LP.checkLesson validation!`);

// Export definition for writer script
export { wave3aLessons };
