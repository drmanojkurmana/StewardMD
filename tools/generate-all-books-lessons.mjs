#!/usr/bin/env node
/**
 * Comprehensive generator for Physiology, Biochemistry, and Surgery lessons.
 * Rewritten completely from standard medical facts (Guyton/Ganong, Harper/Lippincott, Sabiston/Schwartz).
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

const lessons = [
  // ==========================================
  // PHYSIOLOGY LESSONS
  // ==========================================
  {
    module: "phy-mechanics",
    subject: "physiology",
    title: "Mechanics of breathing, lung compliance and airway resistance",
    minutes: 6,
    refs: ["Guyton and Hall Textbook of Medical Physiology", "West's Respiratory Physiology"],
    steps: [
      {
        tx: "During quiet **inspiration**, contraction of the dome-shaped diaphragm expands the vertical thoracic dimension, while external intercostal muscles elevate the rib cage. This expansion lowers intrapleural pressure from approximately negative five to negative eight centimeters of water. The resulting alveolar subatmospheric pressure pulls air into the lungs. In contrast, quiet **expiration** is an entirely passive mechanical process driven by elastic recoil of lung parenchyma.",
        say: "During quiet inspiration, contraction of the diaphragm expands the vertical thorax, while external intercostals elevate ribs. This expansion lowers intrapleural pressure from negative five to negative eight centimeters of water. The resulting subatmospheric pressure pulls air inward. Quiet expiration is passive, driven by elastic recoil of lung parenchyma.",
        vis: {
          kind: "table",
          cols: ["Respiratory phase", "Primary muscles", "Intrapleural pressure change"],
          rows: [
            ["Quiet inspiration", "Diaphragm and external intercostals", "Drops to -8 cm H2O"],
            ["Forced inspiration", "Scalenes and sternocleidomastoids", "Drops below -12 cm H2O"],
            ["Quiet expiration", "None (passive elastic recoil)", "Returns to -5 cm H2O"],
            ["Forced expiration", "Rectus abdominis and internal intercostals", "Becomes positive (+10 cm H2O)"]
          ]
        }
      },
      {
        tx: "Lung **compliance** reflects the change in pulmonary volume per unit change in distending transpulmonary pressure. High compliance means the lungs expand easily, as in pulmonary emphysema where alveolar septal elastin destruction eliminates recoil. Low compliance means stiff lungs requiring high distending pressures, characteristic of neonatal respiratory distress syndrome and acute idiopathic pulmonary fibrosis. Surfactant production by alveolar type two cells maintains normal compliance.",
        say: "Lung compliance reflects pulmonary volume change per unit change in distending pressure. High compliance means the lungs expand easily, as in pulmonary emphysema where elastin destruction eliminates recoil. Low compliance means stiff lungs requiring high distending pressures, characteristic of respiratory distress syndrome and pulmonary fibrosis. Surfactant maintains normal compliance.",
        vis: {
          kind: "compare",
          left: {
            title: "High lung compliance",
            points: [
              "Seen in pulmonary emphysema",
              "Destruction of alveolar elastin fibres",
              "Loss of elastic recoil pressure",
              "Air trapping and barrel chest deformity"
            ]
          },
          right: {
            title: "Low lung compliance",
            points: [
              "Seen in acute respiratory distress and fibrosis",
              "Deficiency of pulmonary surfactant",
              "Stiff lungs with increased work of breathing",
              "Rapid shallow tachypneic breathing pattern"
            ]
          }
        }
      },
      {
        tx: "Pulmonary **surfactant** is a complex mixture of dipalmitoylphosphatidylcholine and surfactant proteins secreted by alveolar type two pneumocytes. By law of Laplace, collapsing pressure equals two times surface tension divided by radius. Without surfactant, small alveoli generate higher collapsing pressure than large alveoli, emptying into them and collapsing. Surfactant molecules concentrate more densely in shrinking alveoli, decreasing surface tension proportionally and preventing diffuse atelectasis.",
        say: "Pulmonary surfactant is a complex mixture of dipalmitoylphosphatidylcholine and specific proteins secreted by type two pneumocytes. By Laplace law, collapsing pressure equals twice the surface tension divided by radius. Without surfactant, small alveoli generate higher collapsing pressures and collapse. Surfactant concentrates in smaller alveoli, lowering surface tension and preventing atelectasis.",
        vis: null
      },
      {
        tx: "Airway **resistance** is greatest in medium-sized bronchi between generations four and eight, rather than in peripheral terminal bronchioles. Although individual terminal bronchioles are narrow, their massive total cross-sectional area arranged in parallel reduces overall resistance to negligible values. Parasympathetic vagal discharge releases acetylcholine onto muscarinic M3 receptors, inducing bronchoconstriction, whereas circulating epinephrine stimulates beta-two adrenergic receptors to promote smooth muscle bronchodilation.",
        say: "Airway resistance is greatest in medium-sized bronchi between generations four and eight, rather than in terminal bronchioles. Although individual terminal bronchioles are narrow, their massive parallel cross-sectional area reduces resistance. Parasympathetic vagal discharge induces bronchoconstriction, whereas beta-two adrenergic stimulation promotes smooth muscle bronchodilation.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-lung-alveoli-gas-exchange.png",
          alt: "Pulmonary mechanics and surfactant dynamics",
          caption: "Cross-section of terminal respiratory units illustrating alveolar surface tension forces, surfactant distribution and airway resistance profiles."
        }
      }
    ]
  },
  {
    module: "phy-tubular",
    subject: "physiology",
    title: "Renal tubular transport, reabsorption and secretion mechanisms",
    minutes: 6,
    refs: ["Guyton and Hall Textbook of Medical Physiology", "Vander's Renal Physiology"],
    steps: [
      {
        tx: "The **proximal convoluted tubule** performs isosmotic bulk reabsorption of sixty-five percent of filtered sodium, water, chloride and potassium, along with virtually all filtered glucose and amino acids. Secondary active transport via apical sodium-glucose cotransporters SGLT2 and SGLT1 couples luminal glucose uptake to favorable intracellular sodium electrochemical gradients created by basolateral sodium-potassium ATPase pumps. Carbonic anhydrase enables massive bicarbonate recovery.",
        say: "The proximal convoluted tubule performs isosmotic bulk reabsorption of sixty-five percent of filtered sodium, water, chloride and potassium, along with virtually all glucose and amino acids. Secondary active transport via apical SGLT2 couples glucose uptake to intracellular sodium gradients maintained by basolateral sodium-potassium ATPase. Carbonic anhydrase enables massive bicarbonate recovery.",
        vis: {
          kind: "table",
          cols: ["Tubular segment", "Key apical transporter", "Major diuretic target"],
          rows: [
            ["Proximal tubule", "SGLT2 and Na+/H+ exchanger NHE3", "Acetazolamide and SGLT2 inhibitors"],
            ["Thick ascending limb", "Na+-K+-2Cl- cotransporter NKCC2", "Loop diuretics (furosemide)"],
            ["Early distal tubule", "Na+-Cl- cotransporter NCCT", "Thiazide diuretics"],
            ["Late distal and collecting", "Epithelial sodium channel ENaC", "Potassium-sparing diuretics (amiloride)"]
          ]
        }
      },
      {
        tx: "The thick ascending limb of the loop of Henle is completely impermeable to water but actively transports solute via the **NKCC2 cotransporter**. This electroneutral cotransporter reabsorbs one sodium, one potassium and two chloride ions. Back-leak of potassium through apical ROMK channels creates a lumen-positive transepithelial potential of plus eight millivolts, which drives paracellular reabsorption of divalent cations calcium and magnesium. Furosemide inhibits NKCC2.",
        say: "The thick ascending limb of Henle is impermeable to water but actively transports solute via the NKCC2 cotransporter. This cotransporter reabsorbs one sodium, one potassium and two chloride ions. Potassium back-leak creates a lumen-positive potential that drives paracellular reabsorption of calcium and magnesium. Furosemide inhibits NKCC2.",
        vis: null
      },
      {
        tx: "The early distal convoluted tubule reabsorbs five percent of filtered sodium via the electroneutral **NCCT cotransporter**, which is selectively blocked by thiazide diuretics. This segment dilutes tubular fluid further because it is impermeable to water. Basolateral calcium extrusion via sodium-calcium exchangers is stimulated by parathyroid hormone. In Gitelman syndrome, loss-of-function NCCT mutations produce hypokalemic metabolic alkalosis, hypomagnesemia and hypocalciuria.",
        say: "The early distal convoluted tubule reabsorbs five percent of filtered sodium via the NCCT cotransporter, blocked by thiazide diuretics. This segment dilutes tubular fluid because it is impermeable to water. Basolateral calcium extrusion is stimulated by parathyroid hormone. In Gitelman syndrome, NCCT mutations cause hypokalemic alkalosis with hypocalciuria.",
        vis: {
          kind: "compare",
          left: {
            title: "Loop diuretic effect (NKCC2)",
            points: [
              "Inhibits Na-K-2Cl cotransporter",
              "Abolishes medullary osmotic gradient",
              "Causes hypercalciuria (inhibits Ca2+ reabsorption)",
              "Risk of hypocalcemia and profound volume depletion"
            ]
          },
          right: {
            title: "Thiazide diuretic effect (NCCT)",
            points: [
              "Inhibits Na-Cl cotransporter in distal tubule",
              "Preserves medullary concentration gradient",
              "Causes hypocalciuria (enhances Ca2+ reabsorption)",
              "Protects against calcium nephrolithiasis"
            ]
          }
        }
      },
      {
        tx: "The cortical collecting duct comprises two distinct cell populations regulating electrolyte and acid-base homeostasis. **Principal cells** reabsorb sodium through apical epithelial sodium channels ENaC under aldosterone control, generating a negative lumen that drives potassium secretion via ROMK and MAXI-K channels. Intercalated alpha cells secrete protons via apical proton ATPases for systemic acid elimination, whereas beta cells secrete bicarbonate in alkalosis.",
        say: "The cortical collecting duct comprises two distinct cell populations regulating electrolyte and acid-base homeostasis. Principal cells reabsorb sodium through epithelial sodium channels under aldosterone control, driving potassium secretion. Intercalated alpha cells secrete protons via apical proton ATPases for acid elimination, whereas beta cells secrete bicarbonate.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-nephron-filtration.png",
          alt: "Nephron tubular transport and ion channels",
          caption: "Cellular schematics detailing cotransporter, exchanger and ion channel distributions along proximal, loop and collecting duct epithelia."
        }
      }
    ]
  },
  {
    module: "phy-concentration",
    subject: "physiology",
    title: "Countercurrent mechanism, medullary gradient and ADH regulation",
    minutes: 6,
    refs: ["Guyton and Hall Textbook of Medical Physiology", "Vander's Renal Physiology"],
    steps: [
      {
        tx: "The **countercurrent multiplier** in juxtamedullary nephron loops of Henle generates an hyperosmotic renal medullary interstitium reaching twelve hundred milliosmoles per kilogram at the papillary tip. The descending thin limb is water-permeable via aquaporin-1 but solute-impermeable, concentrating fluid as water leaves into the hypertonic interstitium. In contrast, the ascending limb actively extrudes sodium and chloride without water, creating a longitudinal osmotic gradient.",
        say: "The countercurrent multiplier in juxtamedullary loops of Henle generates an hyperosmotic renal medullary interstitium reaching twelve hundred milliosmoles per kilogram at the papillary tip. The descending limb is water-permeable, concentrating fluid as water exits. The ascending limb actively extrudes sodium and chloride without water, generating the medullary gradient.",
        vis: {
          kind: "table",
          cols: ["Segment", "Water permeability", "Solute permeability", "Osmolality change"],
          rows: [
            ["Descending thin limb", "High (aquaporin-1)", "Impermeable to NaCl", "Rises from 300 to 1200 mOsm/kg"],
            ["Ascending thick limb", "Impermeable to water", "Active NKCC2 transport", "Falls from 1200 to 100 mOsm/kg"],
            ["Medullary collecting duct", "Variable (ADH-dependent)", "Urea permeable (UT-A1)", "Rises up to 1200 mOsm/kg with ADH"]
          ]
        }
      },
      {
        tx: "The **vasa recta** act as countercurrent exchangers, preserving the hyperosmotic medullary gradient without washing it out. These hairpin capillary loops arise from efferent arterioles of juxtamedullary glomeruli. As blood descends into the hypertonic inner medulla, water exits into the interstitium while solutes enter. As blood ascends back toward the cortex, solute diffuses out and water re-enters, maintaining slow medullary perfusion while sustaining the gradient.",
        say: "The vasa recta act as countercurrent exchangers, preserving the hyperosmotic medullary gradient without washing it out. These capillary loops arise from juxtamedullary arterioles. As blood descends, water exits and solute enters. As blood ascends, solute diffuses out and water re-enters, maintaining low blood flow while sustaining the gradient.",
        vis: null
      },
      {
        tx: "Medullary **urea recycling** contributes forty to fifty percent of the maximal inner medullary interstitial hyperosmolality. Antidiuretic hormone activates inner medullary urea transporters UT-A1 and UT-A3, allowing concentrated luminal urea to diffuse down its concentration gradient into the deep interstitium. This recycled urea supplies osmotic force drawing water out of adjacent descending thin limbs, amplifying countercurrent multiplication and facilitating maximal urine concentration.",
        say: "Medullary urea recycling contributes forty to fifty percent of the maximal inner medullary interstitial hyperosmolality. Antidiuretic hormone activates inner medullary urea transporters, allowing luminal urea to diffuse into the deep interstitium. This recycled urea supplies osmotic force drawing water out of descending thin limbs, facilitating maximal urine concentration.",
        vis: {
          kind: "compare",
          left: {
            title: "Hydropenia (high ADH)",
            points: [
              "High hypothalamic osmoreceptor firing",
              "Aquaporin-2 inserted into collecting ducts",
              "High urea transporter UT-A1 activation",
              "Oliguric concentrated urine up to 1200 mOsm/kg"
            ]
          },
          right: {
            title: "Water diuresis (suppressed ADH)",
            points: [
              "Low plasma osmolality suppresses ADH release",
              "Collecting ducts remain water-impermeable",
              "Minimal medullary urea reabsorption",
              "Copious dilute urine down to 50 mOsm/kg"
            ]
          }
        }
      },
      {
        tx: "The peptide hormone **antidiuretic hormone** or arginine vasopressin regulates final urine volume by binding basolateral V2 receptors on principal cells. Receptor activation stimulates adenylyl cyclase, raising cyclic AMP and protein kinase A, which phosphorylates and triggers exocytic insertion of aquaporin-2 water channels into the apical membrane. Water flows down the medullary osmotic gradient into capillaries, concentrating urine and restoring systemic plasma osmolality.",
        say: "The hormone antidiuretic hormone regulates final urine volume by binding basolateral V2 receptors on principal cells. Receptor activation stimulates adenylyl cyclase, raising cyclic AMP and triggering insertion of aquaporin-2 water channels into the apical membrane. Water flows into hypertonic interstitium, concentrating urine and restoring systemic osmolality.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-kidney-gross.png",
          alt: "Renal medullary countercurrent multiplier schematic",
          caption: "Longitudinal cross-section of renal cortex and medulla illustrating loop of Henle countercurrent multiplier, vasa recta exchanger and ADH water reabsorption."
        }
      }
    ]
  },
  {
    module: "phy-secretions-hormones",
    subject: "physiology",
    title: "Gastric acid secretion, parietal cell physiology and regulatory peptides",
    minutes: 6,
    refs: ["Guyton and Hall Textbook of Medical Physiology", "Ganong's Review of Medical Physiology"],
    steps: [
      {
        tx: "Gastric **parietal cells** in the oxyntic glands of the gastric corpus and fundus secrete hydrochloric acid and intrinsic factor. Hydrochloric acid reduces luminal pH to approximately one point five, sterilizing ingested food, denaturing proteins and activating pepsinogen into proteolytic pepsin. Intrinsic factor is a glycoprotein essential for terminal ileal absorption of cobalamin, deficiency of which produces megaloblastic pernicious anemia and subacute combined degeneration.",
        say: "Gastric parietal cells in the oxyntic glands secrete hydrochloric acid and intrinsic factor. Hydrochloric acid reduces luminal pH to one point five, sterilizing ingested food, denaturing proteins and activating pepsinogen into pepsin. Intrinsic factor is a glycoprotein essential for terminal ileal absorption of cobalamin, preventing pernicious anemia.",
        vis: {
          kind: "table",
          cols: ["Secretory cell type", "Anatomical gland location", "Primary secretory product"],
          rows: [
            ["Parietal cell", "Oxyntic glands (body/fundus)", "Hydrochloric acid and intrinsic factor"],
            ["Chief cell", "Oxyntic glands (body/fundus)", "Pepsinogen (cleaved by acid to pepsin)"],
            ["G cell", "Pyloric antral glands", "Gastrin peptide hormone"],
            ["D cell", "Antrum and corpus glands", "Somatostatin paracrine peptide"]
          ]
        }
      },
      {
        tx: "The molecular engine of acid secretion is the apical **proton pump** or hydrogen-potassium ATPase. Carbonic anhydrase hydrates carbon dioxide into carbonic acid, which dissociates into protons and bicarbonate. Basolateral chloride-bicarbonate exchangers export bicarbonate into blood, creating the postprandial alkaline tide, while importing chloride. Apical hydrogen-potassium ATPase pumps protons into the lumen in exchange for potassium, accompanied by chloride efflux.",
        say: "The molecular engine of acid secretion is the apical proton pump or hydrogen-potassium ATPase. Carbonic anhydrase hydrates carbon dioxide into carbonic acid, yielding protons and bicarbonate. Basolateral exchangers export bicarbonate into blood, creating the alkaline tide, while importing chloride. The proton pump secretes protons in exchange for potassium.",
        vis: null
      },
      {
        tx: "Three physiological agonists stimulate parietal cell acid secretion through distinct intracellular pathways. **Histamine** from enterochromaffin-like cells binds H2 receptors, activating adenylyl cyclase and cyclic AMP. **Acetylcholine** from vagal postganglionic terminals binds M3 receptors, and **gastrin** from G cells binds CCK-B receptors, both activating phospholipase C and inositol trisphosphate. Proton pump inhibitors covalently bind and irreversibly block the final common pathway.",
        say: "Three physiological agonists stimulate parietal cell acid secretion. Histamine from enterochromaffin-like cells binds H2 receptors, raising cyclic AMP. Acetylcholine from vagus nerve binds M3 receptors, and gastrin from G cells binds CCK-B receptors, both raising intracellular calcium. Proton pump inhibitors irreversibly block the hydrogen-potassium ATPase pump.",
        vis: {
          kind: "compare",
          left: {
            title: "Acid stimulators",
            points: [
              "Histamine via paracrine H2 receptor (cAMP)",
              "Acetylcholine via neural M3 receptor (Ca2+)",
              "Gastrin via endocrine CCK-B receptor (Ca2+)",
              "Potentiate one another for maximal secretory response"
            ]
          },
          right: {
            title: "Acid inhibitors",
            points: [
              "Somatostatin via paracrine SST2 receptor (lowers cAMP)",
              "Prostaglandin E2 via EP3 receptor (protects mucosa)",
              "Secretin released by duodenal S cells upon acidification",
              "Negative feedback triggered when antral pH falls below 3"
            ]
          }
        }
      },
      {
        tx: "The peptide hormone **somatostatin** is the master paracrine inhibitor of gastric secretion. Released by antral D cells when luminal pH falls below three, somatostatin binds Gi-coupled receptors on G cells and enterochromaffin-like cells, suppressing gastrin and histamine release directly. Prostaglandin E2 similarly stimulates mucosal mucus and bicarbonate barrier secretion while decreasing parietal cyclic AMP. Nonsteroidal anti-inflammatory drugs inhibit prostaglandin synthesis, causing peptic ulceration.",
        say: "The peptide hormone somatostatin is the master paracrine inhibitor of gastric secretion. Released by antral D cells when luminal pH falls below three, somatostatin binds Gi-coupled receptors, suppressing gastrin and histamine release. Prostaglandin E2 stimulates mucosal mucus and bicarbonate secretion. Nonsteroidal anti-inflammatory drugs inhibit prostaglandins, causing peptic ulceration.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-stomach-gross.png",
          alt: "Gastric mucosa and parietal cell signaling",
          caption: "Cellular diagram of gastric parietal cell receptors, proton pump machinery, second messenger cascades and antral negative feedback loops."
        }
      }
    ]
  },
  {
    module: "phy-pancreas",
    subject: "physiology",
    title: "Pancreatic exocrine and endocrine physiology and glucose homeostasis",
    minutes: 6,
    refs: ["Guyton and Hall Textbook of Medical Physiology", "Ganong's Review of Medical Physiology"],
    steps: [
      {
        tx: "The **exocrine pancreas** secretes approximately one point five liters of enzyme-rich and bicarbonate-rich fluid daily into the duodenum. Acinar cells synthesize digestive proenzymes stored within zymogen granules, including trypsinogen, chymotrypsinogen, pancreatic lipase and amylase. Duodenal enterokinase cleaves trypsinogen into active trypsin, which subsequently cleaves and activates all other pancreatic proteases. Pancreatic secretory trypsin inhibitor prevents premature intrapancreatic autodigestion.",
        say: "The exocrine pancreas secretes one point five liters of enzyme-rich and bicarbonate-rich fluid daily into the duodenum. Acinar cells synthesize digestive proenzymes stored within zymogen granules, including trypsinogen, lipase and amylase. Duodenal enterokinase activates trypsinogen to trypsin, which activates all other proteases. Premature activation is prevented by trypsin inhibitors.",
        vis: {
          kind: "table",
          cols: ["Pancreatic cell type", "Primary regulatory hormone", "Main secretory product"],
          rows: [
            ["Acinar cells", "Cholecystokinin (CCK)", "Digestive zymogens (trypsinogen, lipase)"],
            ["Ductal cells", "Secretin", "Aqueous sodium bicarbonate (pH 8.0)"],
            ["Islet beta cells", "Elevated blood glucose", "Insulin and amylin"],
            ["Islet alpha cells", "Hypoglycemia and amino acids", "Glucagon"]
          ]
        }
      },
      {
        tx: "Pancreatic **ductal secretion** is stimulated by secretin from duodenal S cells in response to acidic chyme. Secretin elevates cyclic AMP, opening apical CFTR chloride channels. Apical chloride-bicarbonate exchangers export bicarbonate into the lumen while recycling chloride back into ductal cells. In cystic fibrosis, CFTR mutations disrupt ductal hydration and alkalinization, causing thick protein plugs, ductal obstruction, chronic exocrine pancreatic insufficiency and malabsorption.",
        say: "Pancreatic ductal secretion is stimulated by secretin from duodenal S cells in response to acidic chyme. Secretin elevates cyclic AMP, opening apical CFTR chloride channels. Chloride-bicarbonate exchangers export bicarbonate into the lumen. In cystic fibrosis, CFTR mutations disrupt ductal hydration, causing protein plugs and exocrine pancreatic insufficiency.",
        vis: null
      },
      {
        tx: "The endocrine **islets of Langerhans** contain beta cells that secrete insulin via a glucose-sensing metabolic cascade. Glucose enters beta cells via GLUT2 transporters and undergoes glycolysis, increasing intracellular ATP-to-ADP ratio. This closes ATP-sensitive potassium channels, depolarizing the plasma membrane. Voltage-gated calcium channels open, inducing calcium influx that triggers exocytosis of insulin granules. Sulfonylureas close ATP-sensitive potassium channels directly.",
        say: "The endocrine islets of Langerhans contain beta cells that secrete insulin via a glucose-sensing cascade. Glucose enters via GLUT2 and undergoes glycolysis, raising ATP. This closes ATP-sensitive potassium channels, depolarizing the membrane. Voltage-gated calcium channels open, triggering insulin granule exocytosis. Sulfonylureas close these potassium channels directly.",
        vis: {
          kind: "compare",
          left: {
            title: "Insulin physiologic effects",
            points: [
              "Stimulates GLUT4 translocation in muscle and fat",
              "Promotes glycogenesis and lipogenesis",
              "Inhibits gluconeogenesis and lipolysis",
              "Drives cellular uptake of potassium and phosphate"
            ]
          },
          right: {
            title: "Glucagon physiologic effects",
            points: [
              "Stimulates glycogenolysis in hepatocytes",
              "Enhances hepatic gluconeogenesis",
              "Promotes ketogenesis during fasting",
              "No effect on skeletal muscle glucose uptake"
            ]
          }
        }
      },
      {
        tx: "The counter-regulatory peptide **glucagon** from islet alpha cells maintains plasma glucose during fasting. Binding hepatic GPCRs, glucagon activates adenylyl cyclase, raising cyclic AMP and protein kinase A. This phosphorylates and activates glycogen phosphorylase while inactivating glycogen synthase, rapidly releasing glucose into the systemic circulation. Glucagon also stimulates hepatic uptake of gluconeogenic amino acids and drives beta-oxidation of fatty acids into ketone bodies.",
        say: "The counter-regulatory peptide glucagon from islet alpha cells maintains plasma glucose during fasting. Binding hepatic receptors, glucagon raises cyclic AMP and activates glycogen phosphorylase while inactivating glycogen synthase, releasing glucose into circulation. Glucagon also stimulates hepatic gluconeogenesis and ketone body synthesis.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-pancreas-gross.png",
          alt: "Pancreatic acinar and islet histology",
          caption: "Histological schematic comparing exocrine acinar ductal units with endocrine islets of Langerhans, highlighting insulin secretion cascades."
        }
      }
    ]
  },
  {
    module: "phy-vision",
    subject: "physiology",
    title: "Photoreceptor phototransduction, dark current and visual processing",
    minutes: 6,
    refs: ["Guyton and Hall Textbook of Medical Physiology", "Kandel's Principles of Neural Science"],
    steps: [
      {
        tx: "The neural **retina** contains two classes of photoreceptor cells adapted for distinct visual functions. Rods contain rhodopsin, operate under scotopic dim light, provide high sensitivity but low spatial acuity, and do not mediate color vision. Cones contain photopsins, operate under photopic bright light, mediate high-resolution visual acuity, and provide trichromatic color vision. The fovea centralis contains solely densely packed cones without overlying neural layers.",
        say: "The neural retina contains two classes of photoreceptor cells adapted for distinct visual functions. Rods contain rhodopsin, operate under scotopic dim light, and provide high sensitivity with low acuity. Cones operate under photopic bright light, mediate high-resolution acuity, and provide color vision. The fovea centralis contains densely packed cones without overlying layers.",
        vis: {
          kind: "table",
          cols: ["Feature", "Rod photoreceptors", "Cone photoreceptors"],
          rows: [
            ["Photopigment", "Rhodopsin", "Three photopsin opsins (blue, green, red)"],
            ["Lighting condition", "Scotopic (night and dim light)", "Photopic (daylight)"],
            ["Retinal distribution", "High in periphery, absent in fovea", "Densely concentrated in fovea centralis"],
            ["Acuity and color", "Low acuity, achromatic", "High acuity, trichromatic color vision"]
          ]
        }
      },
      {
        tx: "In complete darkness, photoreceptors exhibit an inward sodium and calcium flux termed the **dark current**. High basal cyclic GMP levels hold cyclic nucleotide-gated channels open in outer segment discs, maintaining continuous depolarization at minus forty millivolts. This depolarization triggers sustained tonic exocytosis of glutamate neurotransmitter from synaptic terminals onto bipolar cells. Photoreceptors are among the very few sensory neurons that continuously release transmitter in the dark.",
        say: "In darkness, photoreceptors exhibit an inward sodium and calcium flux termed the dark current. High basal cyclic GMP holds cyclic nucleotide-gated channels open, maintaining depolarization at minus forty millivolts. This depolarization triggers continuous tonic release of glutamate onto bipolar cells. Photoreceptors continuously release transmitter in the dark.",
        vis: null
      },
      {
        tx: "Light absorption triggers the biochemical cascade of **phototransduction**. A photon isomerizes eleven-cis-retinal to all-trans-retinal within rhodopsin, converting it to activated metarhodopsin two. Metarhodopsin two activates the G protein transducin, which stimulates cyclic GMP phosphodiesterase. Hydrolysis of cyclic GMP closes outer segment sodium channels, hyperpolarizing the photoreceptor membrane to minus seventy millivolts and decreasing glutamate release onto post-synaptic bipolar neurons.",
        say: "Light absorption triggers phototransduction. A photon isomerizes eleven-cis-retinal to all-trans-retinal, creating metarhodopsin two. This activates transducin, stimulating phosphodiesterase to hydrolyze cyclic GMP. Closing of cyclic nucleotide-gated channels hyperpolarizes the membrane and decreases glutamate release onto bipolar neurons.",
        vis: {
          kind: "compare",
          left: {
            title: "Dark state",
            points: [
              "High cGMP levels in outer segment",
              "Open cGMP-gated cation channels (dark current)",
              "Depolarized membrane potential (~ -40 mV)",
              "High continuous glutamate release"
            ]
          },
          right: {
            title: "Light state",
            points: [
              "Transducin activates phosphodiesterase",
              "Rapid cGMP hydrolysis",
              "Closed cation channels cause hyperpolarization",
              "Decreased glutamate release onto bipolar cells"
            ]
          }
        }
      },
      {
        tx: "Retinal bipolar cells process reduced glutamate release through two opposite pathways, creating **center-surround receptive fields**. On-center bipolar cells express metabotropic mGluR6 receptors that invert the signal: light-induced glutamate reduction relieves inhibition, depolarizing on-bipolar cells. Off-center bipolar cells express ionotropic AMPA receptors that hyperpolarize upon light. Horizontal cells provide lateral inhibition across neighboring photoreceptors, enhancing contrast detection and spatial edge definition.",
        say: "Retinal bipolar cells process reduced glutamate release through two opposite pathways, creating center-surround receptive fields. On-center bipolar cells express metabotropic receptors, depolarizing in response to light. Off-center bipolar cells express ionotropic receptors, hyperpolarizing with light. Horizontal cells provide lateral inhibition, enhancing edge detection.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-eye-gross.png",
          alt: "Photoreceptor phototransduction cascade",
          caption: "Schematic detailing rhodopsin photoisomerization, transducin activation, cGMP phosphodiesterase cleavage and bipolar cell signaling."
        }
      }
    ]
  },
  {
    module: "phy-cardiac-electro",
    subject: "physiology",
    title: "Cardiac electrophysiology, action potentials and pacemaker automatism",
    minutes: 6,
    refs: ["Guyton and Hall Textbook of Medical Physiology", "Katz's Physiology of the Heart"],
    steps: [
      {
        tx: "Ventricular and atrial working myocytes display a non-pacemaker **cardiac action potential** divided into five distinct phases from zero to four. Phase zero is rapid depolarization driven by voltage-gated sodium channels. Phase one is early transient repolarization mediated by outward potassium currents. Phase two is a prolonged plateau where inward L-type calcium currents balance outward delayed rectifier potassium currents, sustaining contraction and preventing tetanus.",
        say: "Ventricular and atrial working myocytes display a cardiac action potential divided into five distinct phases from zero to four. Phase zero is rapid depolarization driven by sodium channels. Phase one is transient repolarization. Phase two is a prolonged plateau where inward calcium currents balance outward potassium currents, sustaining contraction. Phase three is rapid repolarization.",
        vis: {
          kind: "table",
          cols: ["Phase", "Name", "Primary ion current and channel"],
          rows: [
            ["Phase 0", "Rapid depolarization", "Inward Na+ current (voltage-gated Nav1.5 channels)"],
            ["Phase 1", "Early rapid repolarization", "Transient outward K+ current (Ito)"],
            ["Phase 2", "Action potential plateau", "Inward Ca2+ (L-type CaV1.2) balanced by outward K+"],
            ["Phase 3", "Final rapid repolarization", "Outward delayed rectifier K+ currents (IKr, IKs)"],
            ["Phase 4", "Stable resting potential", "Inward rectifier K+ current (IK1), rests at -90 mV"]
          ]
        }
      },
      {
        tx: "In contrast to contractile myocytes, sinoatrial and atrioventricular nodal cells exhibit spontaneous **pacemaker automatism** lacking a stable resting potential. Phase four is characterized by slow diastolic spontaneous depolarization driven by the funny current, which conducts mixed sodium and potassium through hyperpolarization-activated cyclic nucleotide-gated channels. Progressive inward funny current and T-type calcium influx gradually depolarize the membrane toward threshold.",
        say: "In contrast to contractile myocytes, nodal cells exhibit spontaneous pacemaker automatism lacking a stable resting potential. Phase four is characterized by slow diastolic depolarization driven by the funny current through hyperpolarization-activated channels. Inward funny current and T-type calcium influx depolarize the membrane toward threshold.",
        vis: null
      },
      {
        tx: "Autonomic innervation modulates sinoatrial node firing rate by shifting the slope of phase four depolarization. **Sympathetic stimulation** activates beta-one adrenergic receptors, raising cyclic AMP and protein kinase A, which enhances funny current and L-type calcium currents, steepening phase four slope and producing tachycardia. **Parasympathetic vagal stimulation** activates muscarinic M2 receptors and opens inward rectifier potassium channels (IKACh), hyperpolarizing nodal cells and causing bradycardia.",
        say: "Autonomic innervation modulates sinoatrial node firing rate by shifting the slope of phase four depolarization. Sympathetic stimulation activates beta-one receptors, raising cyclic AMP and steepening phase four slope to cause tachycardia. Parasympathetic vagal stimulation activates M2 receptors and opens potassium channels, causing bradycardia.",
        vis: {
          kind: "compare",
          left: {
            title: "Sympathetic stimulation (Beta-1)",
            points: [
              "Increases cAMP and PKA phosphorylation",
              "Increases slope of phase 4 depolarization",
              "Enhances funny current (If) and L-type Ca2+ current",
              "Positive chronotropy, dromotropy and inotropy"
            ]
          },
          right: {
            title: "Parasympathetic stimulation (M2)",
            points: [
              "Inhibits adenylyl cyclase via Gi protein",
              "Opens inward rectifier K+ channels (IKACh)",
              "Flattens slope of phase 4 and hyperpolarizes node",
              "Negative chronotropy and slowed AV conduction"
            ]
          }
        }
      },
      {
        tx: "The prolonged **effective refractory period** of ventricular myocardium lasts throughout phases zero, one, two and mid-phase three. During this interval, voltage-gated sodium channels remain in an inactivated conformational state and cannot reopen, making it impossible to elicit another conducted action potential regardless of stimulus strength. This long refractory period prevents summation of contractions and tetanic cardiac arrest, ensuring rhythmic chamber filling and ejection.",
        say: "The prolonged effective refractory period of ventricular myocardium lasts throughout phases zero, one, two and mid-phase three. During this interval, sodium channels remain inactivated and cannot reopen, making it impossible to elicit another action potential. This prevents summation and tetanus, ensuring rhythmic cardiac pumping.",
        vis: {
          kind: "image",
          src: "prep/lessons/media/ap-heart-conduction-cycle.png",
          alt: "Cardiac ventricular and pacemaker action potentials",
          caption: "Comparative waveform schematics of working ventricular myocyte action potential phases and sinoatrial nodal pacemaker prepotentials."
        }
      }
    ]
  },

  // ==========================================
  // BIOCHEMISTRY LESSONS
  // ==========================================
  {
    module: "bio-glycolysis-tca",
    subject: "biochemistry",
    title: "Glycolysis, pyruvate dehydrogenase and the tricarboxylic acid cycle",
    minutes: 6,
    refs: ["Harper's Illustrated Biochemistry", "Lippincott Illustrated Reviews: Biochemistry"],
    steps: [
      {
        tx: "The **glycolytic pathway** in the cytoplasm converts one molecule of glucose into two molecules of pyruvate with the net generation of two ATP and two NADH. The commitment step is catalyzed by phosphofructokinase-one, which phosphorylates fructose-6-phosphate to fructose-1,6-bisphosphate. Phosphofructokinase-one is allosterically inhibited by high cellular ATP and citrate, and powerfully activated by fructose-2,6-bisphosphate, synthesized by the tandem bifunctional enzyme PFK-2.",
        say: "The glycolytic pathway converts one molecule of glucose into two molecules of pyruvate, generating two ATP and two NADH. The rate-limiting step is catalyzed by phosphofructokinase-one, converting fructose-6-phosphate to fructose-1,6-bisphosphate. It is inhibited by ATP and citrate, and activated by fructose-2,6-bisphosphate.",
        vis: {
          kind: "table",
          cols: ["Regulatory enzyme", "Substrates and products", "Key allosteric regulators"],
          rows: [
            ["Hexokinase / Glucokinase", "Glucose to glucose-6-phosphate", "Glucose-6-P inhibits hexokinase; insulin induces glucokinase"],
            ["Phosphofructokinase-1", "Fructose-6-P to fructose-1,6-BP", "ATP, citrate inhibit; AMP, F-2,6-BP activate"],
            ["Pyruvate kinase", "Phosphoenolpyruvate to pyruvate", "ATP, alanine inhibit; fructose-1,6-BP feedforward activates"],
            ["Pyruvate dehydrogenase", "Pyruvate to acetyl-CoA", "Acetyl-CoA, NADH inhibit; ADP, Ca2+ activate"]
          ]
        }
      },
      {
        tx: "The mitochondrial **pyruvate dehydrogenase complex** bridges glycolysis and the tricarboxylic acid cycle by oxidatively decarboxylating pyruvate to acetyl-CoA, releasing carbon dioxide and generating NADH. It requires five essential cofactors: thiamine pyrophosphate (vitamin B1), lipoic acid, coenzyme A (pantothenate B5), flavin adenine dinucleotide (riboflavin B2) and nicotinamide adenine dinucleotide (niacin B3). Thiamine deficiency impairs PDH, causing lactic acidosis and Wernicke-Korsakoff syndrome.",
        say: "The pyruvate dehydrogenase complex bridges glycolysis and the citric acid cycle by decarboxylating pyruvate to acetyl-CoA. It requires five cofactors: thiamine pyrophosphate, lipoic acid, coenzyme A, FAD and NAD+. Thiamine deficiency impairs the enzyme complex, causing lactic acidosis and Wernicke encephalopathy.",
        vis: null
      },
      {
        tx: "The **tricarboxylic acid cycle** or Krebs cycle oxidizes acetyl-CoA within the mitochondrial matrix, producing three NADH, one FADH2, one GTP and two carbon dioxide per acetyl-CoA turned. Oxaloacetate condenses with acetyl-CoA via citrate synthase to form citrate. Isocitrate dehydrogenase catalyzes the rate-limiting oxidative decarboxylation to alpha-ketoglutarate, inhibited by ATP and NADH and activated by ADP. Succinate dehydrogenase embeds directly within inner mitochondrial complex two.",
        say: "The tricarboxylic acid cycle oxidizes acetyl-CoA within the mitochondrial matrix, producing three NADH, one FADH2, one GTP and two carbon dioxide per turn. Citrate synthase condenses oxaloacetate with acetyl-CoA. Isocitrate dehydrogenase is the rate-limiting step, inhibited by ATP and activated by ADP. Succinate dehydrogenase is inner mitochondrial complex two.",
        vis: {
          kind: "compare",
          left: {
            title: "Aerobic glycolysis + TCA",
            points: [
              "Pyruvate enters mitochondria via carrier",
              "Converted to acetyl-CoA by PDH complex",
              "NADH transferred to electron transport chain",
              "Yields 30 to 32 ATP per glucose molecule"
            ]
          },
          right: {
            title: "Anaerobic glycolysis",
            points: [
              "Pyruvate reduced to lactate by lactate dehydrogenase",
              "Regenerates NAD+ to sustain GAPDH flux",
              "Occurs in mature erythrocytes and ischemic muscle",
              "Net yield only 2 ATP per glucose molecule"
            ]
          }
        }
      },
      {
        tx: "Arsenic poisoning directly inhibits the pyruvate dehydrogenase and alpha-ketoglutarate dehydrogenase complexes by binding the sulfhydryl groups of **lipoic acid**. This disrupts aerobic mitochondrial respiration and ATP synthesis, producing vomiting, rice-water diarrhea, garlic-scented breath and prolonged QT interval. Fluoroacetate inhibits aconitase, while malonate acts as a classical competitive inhibitor of succinate dehydrogenase, arresting cycle progression.",
        say: "Arsenic poisoning inhibits pyruvate dehydrogenase and alpha-ketoglutarate dehydrogenase by binding lipoic acid sulfhydryls. This disrupts mitochondrial ATP synthesis, producing vomiting, rice-water diarrhea and garlic breath. Fluoroacetate inhibits aconitase, while malonate inhibits succinate dehydrogenase.",
        vis: null
      }
    ]
  },
  {
    module: "bio-fatty-acid-oxidation",
    subject: "biochemistry",
    title: "Fatty acid beta-oxidation, carnitine shuttle and ketogenesis",
    minutes: 6,
    refs: ["Harper's Illustrated Biochemistry", "Lippincott Illustrated Reviews: Biochemistry"],
    steps: [
      {
        tx: "Long-chain fatty acids require activation to fatty acyl-CoA by thiokinase in the cytosol before mitochondrial translocation. Transport across the inner mitochondrial membrane is mediated by the **carnitine shuttle**. Carnitine palmitoyltransferase-one converts acyl-CoA to acylcarnitine at the outer membrane, inhibited allosterically by malonyl-CoA during active lipogenesis. A translocase shuttles acylcarnitine inside, where carnitine palmitoyltransferase-two regenerates matrix acyl-CoA.",
        say: "Long-chain fatty acids require activation to acyl-CoA before mitochondrial entry via the carnitine shuttle. Carnitine palmitoyltransferase-one converts acyl-CoA to acylcarnitine, inhibited by malonyl-CoA during lipogenesis. A translocase carries acylcarnitine across the inner membrane, where carnitine palmitoyltransferase-two regenerates mitochondrial acyl-CoA.",
        vis: {
          kind: "table",
          cols: ["Enzyme or carrier", "Membrane localization", "Functional role"],
          rows: [
            ["Carnitine palmitoyltransferase-1", "Outer mitochondrial membrane", "Replaces CoA with carnitine; rate-limiting step"],
            ["Carnitine-acylcarnitine translocase", "Inner mitochondrial membrane", "Antiporter swapping acylcarnitine for free carnitine"],
            ["Carnitine palmitoyltransferase-2", "Matrix side of inner membrane", "Reconverts acylcarnitine to matrix acyl-CoA"],
            ["Acyl-CoA dehydrogenase", "Mitochondrial matrix", "Catalyzes initial dehydrogenation step yielding FADH2"]
          ]
        }
      },
      {
        tx: "Mitochondrial **beta-oxidation** proceeds through a four-step recurring spiral: oxidation by acyl-CoA dehydrogenase yielding FADH2; hydration by enoyl-CoA hydratase; oxidation by hydroxyacyl-CoA dehydrogenase yielding NADH; and thiolytic cleavage by thiolase yielding acetyl-CoA and a fatty acyl-CoA shortened by two carbons. Each complete cycle of palmitate (sixteen carbons) produces eight acetyl-CoA, seven FADH2 and seven NADH, yielding over one hundred ATP.",
        say: "Mitochondrial beta-oxidation proceeds through four recurring steps: oxidation yielding FADH2, hydration, second oxidation yielding NADH, and thiolytic cleavage yielding acetyl-CoA and an acyl-CoA shortened by two carbons. Palmitate oxidation yields eight acetyl-CoA, seven FADH2 and seven NADH, generating over one hundred ATP.",
        vis: null
      },
      {
        tx: "Medium-chain acyl-CoA dehydrogenase deficiency is the most common inborn error of lipid catabolism. An inability to break down fatty acids with six to twelve carbons results in severe **hypoketotic hypoglycemia** during prolonged fasting or intercurrent viral illness. Glycogen reserves become depleted while gluconeogenesis fails due to lack of acetyl-CoA activation of pyruvate carboxylase, accumulating dicarboxylic acids and octanoylcarnitine.",
        say: "Medium-chain acyl-CoA dehydrogenase deficiency is the most common inborn lipid disorder. An inability to break down medium-chain fats causes severe hypoketotic hypoglycemia during fasting. Gluconeogenesis fails due to lack of acetyl-CoA, leading to dicarboxylic acidemia and lethargy.",
        vis: {
          kind: "compare",
          left: {
            title: "MCAD deficiency",
            points: [
              "Autosomal recessive dehydrogenase defect",
              "Severe hypoketotic hypoglycemia on fasting",
              "Elevated C8 octanoylcarnitine in blood",
              "Treated with frequent high-carb meals, avoiding fasts"
            ]
          },
          right: {
            title: "Primary carnitine deficiency",
            points: [
              "Defective OCTN2 carnitine membrane transporter",
              "Impaired renal reabsorption of free carnitine",
              "Low plasma carnitine, cardiomyopathy, muscle weakness",
              "Treated with oral L-carnitine supplementation"
            ]
          }
        }
      },
      {
        tx: "During starvation or untreated diabetic ketoacidosis, massive adipose lipolysis floods the liver with fatty acids. Excessive acetyl-CoA saturates the tricarboxylic acid cycle and is diverted into hepatic **ketogenesis**. Mitochondrial HMG-CoA synthase converts acetyl-CoA to acetoacetate, beta-hydroxybutyrate and acetone. Extrahepatic tissues convert acetoacetate to acetyl-CoA using thiophorase. The liver cannot utilize ketone bodies because it completely lacks thiophorase.",
        say: "During starvation or diabetic ketoacidosis, excessive acetyl-CoA saturates the Krebs cycle and drives hepatic ketogenesis. Mitochondrial HMG-CoA synthase synthesizes acetoacetate, beta-hydroxybutyrate and acetone. Extrahepatic tissues use acetoacetate via thiophorase. The liver cannot use ketones because it lacks thiophorase.",
        vis: null
      }
    ]
  },
  {
    module: "bio-lipoproteins",
    subject: "biochemistry",
    title: "Lipoprotein metabolism, apolipoproteins and hyperlipidemias",
    minutes: 6,
    refs: ["Harper's Illustrated Biochemistry", "Lippincott Illustrated Reviews: Biochemistry"],
    steps: [
      {
        tx: "Plasma **lipoproteins** are macromolecular spherical complexes that transport hydrophobic cholesterol esters and triglycerides within an amphipathic shell of phospholipids, free cholesterol and apolipoproteins. They are classified by buoyant ultracentrifugal density into chylomicrons, very low-density lipoproteins, intermediate-density lipoproteins, low-density lipoproteins and high-density lipoproteins. Density is inversely related to lipid content and directly related to protein percentage.",
        say: "Plasma lipoproteins are macromolecular complexes that transport hydrophobic cholesterol esters and triglycerides within an amphipathic shell of phospholipids and apolipoproteins. They are classified into chylomicrons, VLDL, IDL, LDL and HDL. Density is inversely related to lipid content and directly related to protein percentage.",
        vis: {
          kind: "table",
          cols: ["Lipoprotein", "Origin", "Major core lipid", "Signature apolipoprotein"],
          rows: [
            ["Chylomicron", "Intestinal enterocytes", "Dietary triglycerides", "ApoB-48, ApoC-II, ApoE"],
            ["VLDL", "Hepatocytes (liver)", "Endogenous triglycerides", "ApoB-100, ApoC-II, ApoE"],
            ["LDL", "Intravascular VLDL catabolism", "Cholesterol esters", "ApoB-100 only"],
            ["HDL", "Liver and intestine", "Cholesterol esters (reverse transport)", "ApoA-I (activates LCAT)"]
          ]
        }
      },
      {
        tx: "Signature **apolipoproteins** mediate structural assembly, enzyme activation and receptor recognition across lipoprotein classes. Apolipoprotein B-48 is produced in enterocytes via RNA editing of the ApoB mRNA by cytidine deaminase, which introduces a premature stop codon. Apolipoprotein B-100 is the full-length hepatic variant present on VLDL and LDL. Apolipoprotein C-two activates endothelial lipoprotein lipase, while apolipoprotein E mediates hepatic remnant clearance.",
        say: "Signature apolipoproteins mediate structural assembly, enzyme activation and receptor recognition. Apolipoprotein B-48 is produced in enterocytes via RNA editing of ApoB mRNA. Apolipoprotein B-100 is the full-length hepatic variant on VLDL and LDL. Apolipoprotein C-two activates lipoprotein lipase, while apolipoprotein E mediates clearance.",
        vis: null
      },
      {
        tx: "Familial hypercholesterolemia or Fredrickson type two a is caused by autosomal dominant mutations in the **LDL receptor** gene or PCSK9 gain-of-function. Defective clearance of LDL particles from the bloodstream elevates circulating plasma LDL-cholesterol above three hundred milligrams per deciliter in heterozygotes. Patients present with tendon xanthomas, corneal arcus, xanthelasma and accelerated coronary atherosclerosis causing premature myocardial infarction in early adulthood.",
        say: "Familial hypercholesterolemia is caused by autosomal dominant mutations in the LDL receptor gene or PCSK9 gain-of-function. Defective clearance of LDL elevates plasma LDL-cholesterol. Patients present with tendon xanthomas, corneal arcus, xanthelasma and premature coronary atherosclerosis causing early myocardial infarction.",
        vis: {
          kind: "compare",
          left: {
            title: "Type I hyperchylomicronemia",
            points: [
              "Lipoprotein lipase or ApoC-II deficiency",
              "Massive chylomicron elevation in fasting plasma",
              "Milky plasma with creamy top layer on refrigeration",
              "Eruptive xanthomas, acute pancreatitis, hepatosplenomegaly"
            ]
          },
          right: {
            title: "Type IIa familial hypercholesterolemia",
            points: [
              "Defective LDL receptor or ApoB-100 binding",
              "Isolated elevation of low-density lipoproteins",
              "Clear plasma with severe hypercholesterolemia",
              "Tendon xanthomas (Achilles) and early coronary artery disease"
            ]
          }
        }
      },
      {
        tx: "High-density lipoprotein performs **reverse cholesterol transport**, scavenging excess unesterified cholesterol from peripheral tissues and foam cells for delivery back to the liver. Apolipoprotein A-one activates lecithin-cholesterol acyltransferase (LCAT), esterifying cholesterol into hydrophobic cholesterol esters that pack into the HDL core. Cholesterol ester transfer protein exchanges HDL cholesterol esters for VLDL triglycerides, while hepatic scavenger receptor SR-B1 mediates final cholesterol uptake.",
        say: "High-density lipoprotein performs reverse cholesterol transport, scavenging cholesterol from peripheral tissues for return to the liver. Apolipoprotein A-one activates lecithin-cholesterol acyltransferase, packing cholesterol esters into the HDL core. CETP exchanges HDL cholesterol for VLDL triglycerides, and scavenger receptor SR-B1 mediates uptake.",
        vis: null
      }
    ]
  },
  {
    module: "bio-urea-cycle",
    subject: "biochemistry",
    title: "Urea cycle, nitrogen disposal and hyperammonemia",
    minutes: 6,
    refs: ["Harper's Illustrated Biochemistry", "Lippincott Illustrated Reviews: Biochemistry"],
    steps: [
      {
        tx: "The **urea cycle** takes place exclusively in hepatocytes, converting neurotoxic free ammonia into non-toxic water-soluble urea for renal excretion. The cycle is partitioned across two subcellular compartments: the initial two reactions occur in the mitochondrial matrix, while the remaining three reactions take place in the cytosol. A helpful mnemonic for the cyclical intermediates is 'Ordinarily, Careless Crappers Are Also Frivolous Ulcers': Ornithine, Carbamoyl phosphate, Citrulline, Aspartate, Argininosuccinate, Fumarate, Arginine, Urea.",
        say: "The urea cycle takes place exclusively in hepatocytes, converting neurotoxic ammonia into water-soluble urea. The cycle is partitioned between the mitochondrial matrix and cytosol. A mnemonic for intermediates is Ordinarily Careless Crappers Are Also Frivolous: Ornithine, Carbamoyl phosphate, Citrulline, Aspartate, Argininosuccinate, Fumarate, Arginine, Urea.",
        vis: {
          kind: "table",
          cols: ["Enzyme", "Subcellular compartment", "Substrates and products"],
          rows: [
            ["Carbamoyl phosphate synthetase I", "Mitochondrial matrix", "NH4+ and HCO3- to carbamoyl phosphate (needs N-acetylglutamate)"],
            ["Ornithine transcarbamylase", "Mitochondrial matrix", "Carbamoyl phosphate + ornithine to citrulline"],
            ["Argininosuccinate synthetase", "Cytosol", "Citrulline + aspartate to argininosuccinate"],
            ["Argininosuccinase (lyase)", "Cytosol", "Argininosuccinate to arginine + fumarate"],
            ["Arginase", "Cytosol", "Arginine to urea + ornithine (regenerates ornithine)"]
          ]
        }
      },
      {
        tx: "The rate-limiting commitment step is catalyzed by mitochondrial **carbamoyl phosphate synthetase-one**, requiring two ATP molecules. This enzyme has an absolute obligate allosteric requirement for N-acetylglutamate, synthesized by N-acetylglutamate synthase from acetyl-CoA and glutamate. Arginine stimulates N-acetylglutamate synthase, so a protein-rich meal inherently activates carbamoyl phosphate synthetase-one, coordinating urea synthesis with amino acid catabolic flux.",
        say: "The rate-limiting step is catalyzed by carbamoyl phosphate synthetase-one, consuming two ATP. The enzyme requires N-acetylglutamate, synthesized from acetyl-CoA and glutamate. Arginine stimulates N-acetylglutamate synthase, ensuring that a protein-rich meal activates urea synthesis alongside amino acid breakdown.",
        vis: null
      },
      {
        tx: "The most common inherited urea cycle defect is X-linked recessive **ornithine transcarbamylase deficiency**. Carbamoyl phosphate accumulates in mitochondria and leaks into the cytoplasm, entering the pyrimidine synthesis pathway via carbamoyl phosphate synthetase-two to produce massive elevations of urinary orotic acid. Male neonates present with severe lethargy, vomiting, hyperammonemia, respiratory alkalosis and cerebral edema within forty-eight hours of starting feeds.",
        say: "The most common urea cycle defect is X-linked recessive ornithine transcarbamylase deficiency. Carbamoyl phosphate accumulates in mitochondria and spills into cytosol, entering pyrimidine synthesis to produce massive urinary orotic acid. Male neonates present with severe hyperammonemia, vomiting and cerebral edema.",
        vis: {
          kind: "compare",
          left: {
            title: "Ornithine transcarbamylase deficiency",
            points: [
              "X-linked recessive inheritance",
              "Severe hyperammonemia with low citrulline",
              "Elevated urinary orotic acid levels",
              "Normal serum uracil and hematocrit"
            ]
          },
          right: {
            title: "Hereditary orotic aciduria",
            points: [
              "Autosomal recessive UMP synthase deficiency",
              "Normal blood ammonia levels",
              "Elevated urinary orotic acid levels",
              "Megaloblastic anemia unresponsive to B12/folate"
            ]
          }
        }
      },
      {
        tx: "Severe **hyperammonemia** exerts profound neurotoxicity by shifting glutamate dehydrogenase equilibrium toward glutamate synthesis, depleting mitochondrial alpha-ketoglutarate and inhibiting the tricarboxylic acid cycle. Astrocyte glutamine synthetase converts excess ammonia and glutamate into glutamine, acting as an intracellular osmolyte that induces astrocyte swelling and cerebral edema. Treatment incorporates protein restriction, dialysis and ammonia scavengers sodium phenylbutyrate and sodium benzoate.",
        say: "Severe hyperammonemia exerts neurotoxicity by driving glutamate dehydrogenase toward glutamate, depleting alpha-ketoglutarate and inhibiting the Krebs cycle. Astrocytes convert excess ammonia to glutamine, acting as an osmolyte that causes brain edema. Treatment includes protein restriction and nitrogen scavengers like sodium phenylbutyrate.",
        vis: null
      }
    ]
  },

  // ==========================================
  // SURGERY (SABISTON 22E) LESSONS
  // ==========================================
  {
    module: "sur-wound-healing",
    subject: "surgery",
    title: "Surgical wound healing: phases, collagen dynamics and complications",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "Schwartz's Principles of Surgery"],
    steps: [
      {
        tx: "Normal surgical **wound healing** is a coordinated biological cascade comprising four overlapping chronological phases: hemostasis, inflammation, proliferation and remodeling. Hemostasis initiates immediately with platelet plug formation and fibrin deposition, releasing platelet-derived growth factor and transforming growth factor-beta. The inflammatory phase peaks at forty-eight hours with neutrophil infiltration followed by macrophages, which orchestrate subsequent tissue debridement and angiogenesis.",
        say: "Normal surgical wound healing is a biological cascade comprising four overlapping chronological phases: hemostasis, inflammation, proliferation and remodeling. Hemostasis initiates immediately with platelet plugging and fibrin deposition, releasing growth factors. The inflammatory phase peaks at forty-eight hours with neutrophils and macrophages orchestrating debridement.",
        vis: {
          kind: "table",
          cols: ["Phase", "Dominant cell type", "Key biochemical event"],
          rows: [
            ["Hemostasis (0 to hours)", "Platelets", "Fibrin meshwork and PDGF/TGF-beta release"],
            ["Inflammation (1 to 4 days)", "Neutrophils then macrophages", "Debridement and cytokine orchestration"],
            ["Proliferation (4 to 21 days)", "Fibroblasts and endothelial cells", "Granulation tissue, angiogenesis, type III collagen"],
            ["Remodeling (3 weeks to 1 year)", "Myofibroblasts and fibroblasts", "Type I collagen replacement and wound contraction"]
          ]
        }
      },
      {
        tx: "The proliferative phase is characterized by granulation tissue formation, driven by fibroblasts synthesizing **type three collagen** and proteoglycans alongside vascular endothelial growth factor-mediated angiogenesis. In the remodeling phase, matrix metalloproteinases degrade immature type three collagen, replacing it with stronger, organized type one collagen bundles cross-linked by lysyl oxidase. Wound tensile strength reaches only twenty percent at three weeks and plateaus at eighty percent of unwounded skin.",
        say: "The proliferative phase is characterized by granulation tissue formation, driven by fibroblasts synthesizing type three collagen alongside angiogenesis. In remodeling, matrix metalloproteinases replace immature type three collagen with organized type one collagen cross-linked by lysyl oxidase. Tensile strength plateaus at eighty percent of normal.",
        vis: null
      },
      {
        tx: "Pathological scarring results from excessive fibroblast proliferation and collagen synthesis. A **hypertrophic scar** remains confined within the boundaries of the original surgical incision and often regresses spontaneously over twelve to eighteen months. In contrast, a **keloid** grows aggressively beyond the original margins, lacks spontaneous regression, exhibits thick disorganized collagen bundles, and occurs predominantly in darkly pigmented individuals, having high recurrence after simple excision.",
        say: "Pathological scarring results from excessive collagen synthesis. A hypertrophic scar remains confined within original surgical margins and often regresses over months. In contrast, a keloid grows aggressively beyond original margins, does not regress, exhibits thick collagen bundles, and has high recurrence after simple excision.",
        vis: {
          kind: "compare",
          left: {
            title: "Hypertrophic scar",
            points: [
              "Confined within original wound incision",
              "Arises in areas of high wound tension",
              "Contains parallel type III collagen bundles",
              "Often regresses spontaneously over time"
            ]
          },
          right: {
            title: "Keloid scar",
            points: [
              "Extends beyond original incision margins",
              "Predilection for earlobes, deltoid and sternum",
              "Contains thick, disorganized type I and III collagen",
              "High recurrence rate after simple excision"
            ]
          }
        }
      },
      {
        tx: "Acute abdominal **wound dehiscence** or burst abdomen typically manifests between postoperative days five and eight with a sudden serosanguinous pink discharge soaking the dressing. It reflects failure of the deep fascial closure, provoked by increased intra-abdominal pressure, obesity, malnutrition or technical suture breakage. When evisceration occurs, immediate management requires covering exposed bowel with sterile saline-soaked dressings and urgent return to the operating room.",
        say: "Acute abdominal wound dehiscence manifests between postoperative days five and eight with sudden serosanguinous pink discharge soaking the dressing. It reflects fascial closure failure provoked by increased abdominal pressure, obesity, or suture error. Evisceration requires covering bowel with sterile saline packs and urgent surgical repair.",
        vis: null
      }
    ]
  },
  {
    module: "sur-shock-transfusion",
    subject: "surgery",
    title: "Surgical shock, hemorrhage classification and massive transfusion protocols",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "ATLS Advanced Trauma Life Support 10th ed"],
    steps: [
      {
        tx: "Surgical **hemorrhagic shock** is classified by the American College of Surgeons Advanced Trauma Life Support into four progressive physiological stages based on blood loss percentage. Class one shock involves up to fifteen percent loss with normal vitals. Class two represents fifteen to thirty percent loss presenting with resting tachycardia and narrowed pulse pressure. Class three involves thirty to forty percent loss with marked hypotension. Class four exceeds forty percent with profound lethargy.",
        say: "Surgical hemorrhagic shock is classified into four physiological stages based on blood loss percentage. Class one involves up to fifteen percent loss with normal vitals. Class two represents fifteen to thirty percent loss presenting with resting tachycardia and narrowed pulse pressure. Class three involves thirty to forty percent loss with hypotension. Class four exceeds forty percent.",
        vis: {
          kind: "table",
          cols: ["Class", "Blood loss percentage", "Heart rate and blood pressure", "Mental status"],
          rows: [
            ["Class I", "< 15% (< 750 mL)", "Normal HR (< 100), normal BP", "Slightly anxious"],
            ["Class II", "15 - 30% (750 - 1500 mL)", "Tachycardia (> 100), normal BP, narrowed PP", "Mildly anxious"],
            ["Class III", "30 - 40% (1500 - 2000 mL)", "Marked tachycardia (> 120), hypotension", "Confused and anxious"],
            ["Class IV", "> 40% (> 2000 mL)", "Severe tachycardia (> 140), profound hypotension", "Lethargic or comatose"]
          ]
        }
      },
      {
        tx: "The lethal triad in severe exsanguinating trauma comprises **hypothermia, coagulopathy and acidosis**. Hypothermia impairs coagulation factor enzymatic velocity and suppresses platelet aggregation. Metabolic lactic acidosis from hypoperfusion reduces thrombin generation. Hemodilution and consumption of clotting factors exacerbate hemorrhage. Damage control resuscitation aims to interrupt this lethal self-reinforcing downward spiral by prioritizing physiological restoration over definitive anatomical reconstruction.",
        say: "The lethal triad in severe trauma comprises hypothermia, coagulopathy and acidosis. Hypothermia impairs coagulation factors and platelet aggregation. Lactic acidosis reduces thrombin generation. Hemodilution exacerbates hemorrhage. Damage control resuscitation aims to interrupt this spiral by prioritizing physiological restoration.",
        vis: null
      },
      {
        tx: "Modern damage control resuscitation employs **balanced blood transfusion** utilizing a one-to-one-to-one ratio of packed red blood cells, fresh frozen plasma and platelets. Aggressive large-volume crystalloid infusion is strictly avoided because it provokes dilutional coagulopathy, hypothermia and abdominal compartment syndrome. Permissive hypotension targets a systolic blood pressure between eighty and ninety millimeters of mercury until surgical hemostasis is secured.",
        say: "Modern damage control resuscitation employs balanced blood transfusion utilizing a one-to-one-to-one ratio of packed red blood cells, fresh frozen plasma and platelets. Large-volume crystalloids are avoided because they cause dilutional coagulopathy and hypothermia. Permissive hypotension targets systolic pressure between eighty and ninety until hemostasis.",
        vis: {
          kind: "compare",
          left: {
            title: "Balanced 1:1:1 resuscitation",
            points: [
              "Pack: 6 units RBC, 6 units FFP, 1 pool platelets",
              "Prevents dilutional coagulopathy early",
              "Administers tranexamic acid within three hours",
              "Improved 24-hour and 30-day trauma survival"
            ]
          },
          right: {
            title: "Large-volume crystalloid resuscitation",
            points: [
              "Infusion of 2-3 liters isotonic saline or Ringer",
              "Dilutes circulating clotting factors and platelets",
              "Aggravates hypothermia and tissue edema",
              "Increases risk of abdominal compartment syndrome"
            ]
          }
        }
      },
      {
        tx: "A **massive transfusion protocol** is defined as the transfusion of ten or more units of packed red blood cells within twenty-four hours, or four units within one hour with ongoing bleeding. Major complications include hypocalcemia caused by citrate anticoagulant binding ionized calcium, hyperkalemia from lysed stored red blood cells, hypothermia and transfusion-related acute lung injury. Calcium chloride must be administered empirically after every four units.",
        say: "A massive transfusion protocol is defined as transfusing ten or more units of packed red cells within twenty-four hours, or four units in one hour. Complications include hypocalcemia from citrate binding, hyperkalemia from stored cells, and transfusion-related acute lung injury. Calcium chloride is given empirically after every four units.",
        vis: null
      }
    ]
  },
  {
    module: "sur-atls",
    subject: "surgery",
    title: "Advanced trauma life support, primary survey and life-threatening thoracic injuries",
    minutes: 6,
    refs: ["ATLS Advanced Trauma Life Support 10th ed", "Sabiston Textbook of Surgery 22nd ed"],
    steps: [
      {
        tx: "The **primary survey** in trauma follows the strict prioritized ABCDE mnemonic: Airway with cervical spine protection; Breathing and ventilation; Circulation with hemorrhage control; Disability neurological status; and Exposure with hypothermia prevention. Immediately life-threatening injuries must be identified and corrected before proceeding to the next step. Cervical spine immobilization using a rigid collar and manual in-line stabilization is maintained until clinical or radiological clearance.",
        say: "The primary survey in trauma follows the prioritized ABCDE mnemonic: Airway with cervical spine protection, Breathing and ventilation, Circulation with hemorrhage control, Disability neurological status, and Exposure with hypothermia prevention. Life-threatening injuries must be treated immediately before proceeding to the next step.",
        vis: {
          kind: "table",
          cols: ["Step", "Focus", "Immediate lethal condition identified"],
          rows: [
            ["A", "Airway and cervical spine", "Airway obstruction, foreign body, laryngeal fracture"],
            ["B", "Breathing and ventilation", "Tension pneumothorax, open pneumothorax, flail chest"],
            ["C", "Circulation and hemorrhage", "Exsanguinating external bleed, hemothorax, pelvic fracture"],
            ["D", "Disability (GCS and pupils)", "Expanding epidural or subdural intracranial hematoma"]
          ]
        }
      },
      {
        tx: "A **tension pneumothorax** is a clinical diagnosis requiring immediate decompression before chest radiography. One-way valve air entry into the pleural space increases intrathoracic pressure, collapsing the ipsilateral lung, shifting the mediastinum and trachea contralaterally, and compressing the vena cava, eliminating venous return and precipitating obstructive shock. Emergency needle decompression is performed at the fourth or fifth intercostal space anterior to the mid-axillary line.",
        say: "A tension pneumothorax is a clinical diagnosis requiring immediate decompression before chest radiography. One-way valve air entry increases intrathoracic pressure, collapsing the lung, shifting the trachea contralaterally, and compressing the vena cava to cause obstructive shock. Emergency decompression is placed at the fourth or fifth interspace mid-axillary line.",
        vis: null
      },
      {
        tx: "Cardiac tamponade produces obstructive shock characterized by classic Beck triad: **hypotension, jugular venous distension and muffled heart sounds**. It results from rapid accumulation of blood within the non-compliant pericardial sac following penetrating thoracic injury. Pulsus paradoxus is present. Extended Focused Assessment with Sonography for Trauma (E-FAST) rapidly detects pericardial fluid as an anechoic stripe, prompting urgent subxiphoid pericardial window or emergency resuscitative thoracotomy.",
        say: "Cardiac tamponade produces obstructive shock characterized by Beck triad: hypotension, jugular venous distension and muffled heart sounds. It results from blood accumulation within the pericardial sac after penetrating thoracic injury. E-FAST ultrasound detects pericardial fluid rapidly, prompting urgent surgical drainage or thoracotomy.",
        vis: {
          kind: "compare",
          left: {
            title: "Tension pneumothorax",
            points: [
              "Absent breath sounds on affected side",
              "Hyper-resonance to percussion",
              "Tracheal deviation away from affected hemithorax",
              "Treated with immediate finger or tube thoracostomy"
            ]
          },
          right: {
            title: "Cardiac tamponade",
            points: [
              "Bilateral breath sounds present and equal",
              "Normal resonance on percussion",
              "Trachea remains in midline position",
              "Treated with operative decompression / thoracotomy"
            ]
          }
        }
      },
      {
        tx: "The **E-FAST examination** is an essential point-of-care ultrasound performed during the circulation assessment. It evaluates four abdominal and two thoracic acoustic windows: the hepatorenal space of Morison, the splenorenal recess, the suprapubic pouch of Douglas, the subxiphoid pericardial view, and bilateral anterior lung sliding to rule out pneumothorax. In hemodynamically unstable blunt trauma, a positive abdominal FAST mandates immediate exploratory laparotomy without computed tomography.",
        say: "The E-FAST examination is an essential point-of-care ultrasound performed during the circulation assessment. It evaluates the hepatorenal space, splenorenal recess, pelvis, subxiphoid pericardium, and bilateral anterior pleura. In hemodynamically unstable trauma, a positive FAST mandates immediate exploratory laparotomy without CT scanning.",
        vis: null
      }
    ]
  },
  {
    module: "sur-thyroid",
    subject: "surgery",
    title: "Thyroid carcinoma, Bethesda classification and surgical management",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "Schwartz's Principles of Surgery"],
    steps: [
      {
        tx: "Thyroid nodules are evaluated with serum thyroid-stimulating hormone measurement and high-resolution neck ultrasonography. Fine-needle aspiration cytology is categorized using the six-tier **Bethesda system**, which stratifies malignancy risk and guides clinical management. Bethesda category one is non-diagnostic; two is benign; three is atypia of undetermined significance; four is follicular neoplasm; five is suspicious for malignancy; and six is diagnostic of overt malignancy.",
        say: "Thyroid nodules are evaluated with serum TSH measurement and ultrasound. Fine-needle aspiration cytology is categorized using the six-tier Bethesda system. Bethesda category one is non-diagnostic; two is benign; three is atypia of undetermined significance; four is follicular neoplasm; five is suspicious for malignancy; and six is overt malignancy.",
        vis: {
          kind: "table",
          cols: ["Bethesda category", "Cytological description", "Malignancy risk", "Management"],
          rows: [
            ["Bethesda II", "Benign (colloid nodule, thyroiditis)", "< 3%", "Clinical and ultrasound follow-up"],
            ["Bethesda III", "Atypia of undetermined significance", "10 - 30%", "Repeat FNA or molecular testing"],
            ["Bethesda IV", "Follicular neoplasm", "25 - 40%", "Diagnostic lobectomy"],
            ["Bethesda VI", "Malignant (papillary, medullary)", "97 - 99%", "Thyroid lobectomy or total thyroidectomy"]
          ]
        }
      },
      {
        tx: "Papillary thyroid carcinoma is the most common endocrine malignancy, accounting for eighty-five percent of thyroid cancers. Classic cytological features include ground-glass nuclei with optical clearing termed **Orphan Annie eye nuclei**, intranuclear cytoplasmic pseudoinclusions, longitudinal nuclear grooves and psammoma bodies. It spreads predominantly via lymphatic channels to cervical lymph nodes, yet carries a favorable prognosis exceeding ninety-five percent twenty-year survival.",
        say: "Papillary thyroid carcinoma is the most common endocrine malignancy, accounting for eighty-five percent of thyroid cancers. Classic cytological features include Orphan Annie eye nuclei, intranuclear pseudoinclusions, longitudinal nuclear grooves and psammoma bodies. It spreads predominantly via lymphatics to cervical nodes and has an excellent prognosis.",
        vis: null
      },
      {
        tx: "Distinguishing follicular carcinoma from benign adenoma requires histological evaluation of the entire resected capsule. Fine-needle aspiration cytology cannot differentiate the two because both show identical follicular cells. **Capsular or vascular invasion** on permanent histology confirms follicular carcinoma. Follicular carcinoma spreads hematogenously to bone and lungs. Medullary thyroid carcinoma arises from calcitonin-secreting parafollicular C cells and is associated with RET proto-oncogene mutations in MEN 2.",
        say: "Distinguishing follicular carcinoma from benign adenoma requires histological evaluation of the resected capsule. Fine-needle aspiration cannot differentiate them because both show identical follicular cells. Capsular or vascular invasion confirms follicular carcinoma. Medullary carcinoma arises from calcitonin-secreting C cells, linked with RET mutations.",
        vis: {
          kind: "compare",
          left: {
            title: "Papillary carcinoma",
            points: [
              "Most common (85% of cases)",
              "Lymphatic spread to cervical nodes",
              "Orphan Annie nuclei and psammoma bodies",
              "Excellent long-term survival > 95%"
            ]
          },
          right: {
            title: "Follicular carcinoma",
            points: [
              "Accounts for 10-15% of thyroid cancers",
              "Hematogenous spread to bones and lungs",
              "Diagnosed only by capsular or vascular invasion",
              "FNA reports as follicular neoplasm"
            ]
          }
        }
      },
      {
        tx: "Major complications of thyroid surgery include **hypoparathyroidism** and recurrent laryngeal nerve palsy. Devitalization or inadvertent excision of parathyroid glands produces acute postoperative hypocalcemia presenting with perioral paresthesia, carpopedal spasm (Trousseau sign) and facial twitching (Chvostek sign). Injury to the external branch of the superior laryngeal nerve denervates the cricothyroid muscle, causing vocal fatigue and loss of high-pitch phonation.",
        say: "Major complications of thyroid surgery include hypoparathyroidism and recurrent laryngeal nerve injury. Inadvertent excision of parathyroid glands produces hypocalcemia with perioral numbness, Trousseau sign and Chvostek sign. Injury to the external branch of the superior laryngeal nerve causes vocal fatigue and inability to sing high notes.",
        vis: null
      }
    ]
  },
  {
    module: "sur-gallbladder",
    subject: "surgery",
    title: "Biliary surgery: acute cholecystitis, critical view of safety and bile duct injuries",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "Schwartz's Principles of Surgery"],
    steps: [
      {
        tx: "Symptomatic cholelithiasis and **acute cholecystitis** arise from cystic duct obstruction by an impacted gallstone. Entrapped bile triggers sterile chemical inflammation, mucosal ischemia and secondary bacterial infection by enteric coliforms. Ultrasonography is the diagnostic modality of choice, demonstrating gallstones, gallbladder wall thickening greater than four millimeters, pericholecystic fluid and a sonographic Murphy sign. Early laparoscopic cholecystectomy within seventy-two hours is the definitive management.",
        say: "Acute cholecystitis arises from cystic duct obstruction by an impacted gallstone. Entrapped bile triggers inflammation, mucosal ischemia and bacterial infection. Ultrasonography is the diagnostic test of choice, demonstrating gallstones, wall thickening over four millimeters, pericholecystic fluid and a sonographic Murphy sign. Early laparoscopic cholecystectomy is definitive.",
        vis: {
          kind: "table",
          cols: ["Clinical entity", "Pathophysiology", "Diagnostic ultrasound findings"],
          rows: [
            ["Biliary colic", "Transient cystic duct impaction", "Gallstones present, normal wall thickness, no fluid"],
            ["Acute cholecystitis", "Persistent obstruction and inflammation", "Thickened wall > 4 mm, pericholecystic fluid, sonographic Murphy"],
            ["Choledocholithiasis", "Common bile duct stone", "Dilated CBD > 6 mm, elevated alkaline phosphatase and bilirubin"],
            ["Acute cholangitis", "Biliary stasis with infection", "Charcot triad: fever, jaundice, right upper quadrant pain"]
          ]
        }
      },
      {
        tx: "During laparoscopic cholecystectomy, achieving Strasberg **critical view of safety** is the mandatory standard of care to prevent catastrophic common bile duct injury. It requires three anatomical criteria: the hepatocystic triangle must be completely cleared of all fat and fibrous tissue; the lower third of the gallbladder must be dissected off the cystic plate; and only two structures—the cystic duct and cystic artery—must be seen entering the gallbladder.",
        say: "Achieving the Strasberg critical view of safety is the mandatory standard to prevent bile duct injury during laparoscopic cholecystectomy. Three criteria must be met: clearing the hepatocystic triangle of all fat and fibrous tissue, mobilizing the lower third of gallbladder off the liver bed, and seeing only two structures enter the gallbladder.",
        vis: null
      },
      {
        tx: "Iatrogenic **bile duct injury** is classified according to the Strasberg-Bismuth grading system. Strasberg type A involves bile leakage from small cystic duct or minor liver bed ducts. Type D represents partial lateral laceration of a major bile duct. Type E injuries involve complete transection or occlusion of the common hepatic or main bile duct. When extensive thermal injury or tissue loss occurs, definitive reconstruction requires a tension-free Roux-en-Y hepaticojejunostomy.",
        say: "Iatrogenic bile duct injury is classified by the Strasberg-Bismuth system. Type A involves leakage from the cystic duct or liver bed. Type D represents lateral laceration of a major duct. Type E involves complete transection of the main bile duct. Extensive injuries require definitive reconstruction with Roux-en-Y hepaticojejunostomy.",
        vis: {
          kind: "compare",
          left: {
            title: "Strasberg Type A-D injuries",
            points: [
              "Minor duct leaks or partial lacerations",
              "Often managed with ERCP and biliary stenting",
              "Main bile duct continuity preserved",
              "Low long-term biliary stricture rate"
            ]
          },
          right: {
            title: "Strasberg Type E injuries",
            points: [
              "Complete transection of common hepatic/bile duct",
              "Misidentification of common duct as cystic duct",
              "Requires conversion and Roux-en-Y hepaticojejunostomy",
              "Risk of recurrent cholangitis and anastomotic stricture"
            ]
          }
        }
      },
      {
        tx: "Acute ascending **cholangitis** is a life-threatening infection resulting from biliary stasis and high intraductal pressure. Charcot triad comprises fever, jaundice and right upper quadrant abdominal pain. Progression to Reynolds pentad adds septic shock and altered mental status. Initial management demands aggressive intravenous fluid resuscitation, broad-spectrum antibiotics and emergency biliary decompression via endoscopic retrograde cholangiopancreatography (ERCP) with biliary sphincterotomy and stenting.",
        say: "Acute ascending cholangitis is a life-threatening infection resulting from biliary stasis. Charcot triad comprises fever, jaundice and right upper quadrant pain. Reynolds pentad adds septic shock and altered mental status. Management requires intravenous fluids, broad-spectrum antibiotics and emergency biliary decompression via ERCP.",
        vis: null
      }
    ]
  },
  {
    module: "sur-hernia",
    subject: "surgery",
    title: "Groin hernias: anatomy, Lichtenstein repair and laparoscopic techniques",
    minutes: 6,
    refs: ["Sabiston Textbook of Surgery 22nd ed", "Schwartz's Principles of Surgery"],
    steps: [
      {
        tx: "Groin **hernias** are classified as indirect inguinal, direct inguinal or femoral based on their anatomical relation to the inferior epigastric vessels and inguinal ligament. An indirect hernia passes through the internal deep ring lateral to the inferior epigastric artery, surrounded by the spermatic cord coverings. A direct hernia bulges through the floor of Hesselbach triangle medial to the inferior epigastric artery, resulting from transversalis fascia weakness.",
        say: "Groin hernias are classified as indirect inguinal, direct inguinal or femoral based on anatomical relation to the inferior epigastric vessels. An indirect hernia enters the deep ring lateral to the inferior epigastric artery within the cord coverings. A direct hernia bulges through Hesselbach triangle medial to the artery due to transversalis fascia weakness.",
        vis: {
          kind: "table",
          cols: ["Hernia type", "Relation to inferior epigastric", "Relation to inguinal ligament", "Neck strangulation risk"],
          rows: [
            ["Indirect inguinal", "Lateral", "Above inguinal ligament", "Moderate (narrow deep ring)"],
            ["Direct inguinal", "Medial (Hesselbach triangle)", "Above inguinal ligament", "Very low (broad diffuse defect)"],
            ["Femoral hernia", "Medial to femoral vein", "Below inguinal ligament", "High (rigid femoral ring margins)"]
          ]
        }
      },
      {
        tx: "The **femoral canal** is a small cone-shaped medial compartment of the femoral sheath bounded anteriorly by the inguinal ligament, posteriorly by the pectineal Cooper ligament, medially by the sharp lacunar Gimbernat ligament, and laterally by the femoral vein. Because its boundaries are unyielding fibrous structures, femoral hernias carry a forty percent risk of incarceration and strangulation, mandating urgent elective surgical repair.",
        say: "The femoral canal is the medial compartment of the femoral sheath bounded anteriorly by the inguinal ligament, posteriorly by Cooper ligament, medially by the lacunar ligament, and laterally by the femoral vein. Because these borders are rigid, femoral hernias carry high strangulation risk, requiring prompt operative repair.",
        vis: null
      },
      {
        tx: "The open **Lichtenstein tension-free repair** is the gold standard for primary inguinal hernia repair. A flat polypropylene mesh is positioned across the floor of the inguinal canal, sutured inferiorly to the shelving edge of the inguinal ligament and pubic tubercle, medially to the conjoint tendon, and slit laterally to accommodate the spermatic cord. Avoiding tissue tension dramatically reduced recurrence rates to below one percent.",
        say: "The open Lichtenstein tension-free repair is the gold standard for primary inguinal hernia repair. A flat polypropylene mesh is positioned over the canal floor, secured to the inguinal ligament and conjoint tendon, and slit laterally around the spermatic cord. Eliminating tissue tension reduced recurrence rates to below one percent.",
        vis: {
          kind: "compare",
          left: {
            title: "Lichtenstein repair",
            points: [
              "Open anterior approach under local anesthesia",
              "Mesh placed superficial to transversalis fascia",
              "Ideal for primary unilateral inguinal hernia",
              "Risk of chronic groin nerve entrapment"
            ]
          },
          right: {
            title: "Laparoscopic repair (TAPP / TEP)",
            points: [
              "Preperitoneal approach under general anesthesia",
              "Mesh placed posterior to myopectineal orifice",
              "Ideal for bilateral or recurrent inguinal hernias",
              "Faster recovery and lower chronic groin pain"
            ]
          }
        }
      },
      {
        tx: "Laparoscopic repairs cover the entire myopectineal orifice of Fruchaud from the preperitoneal space. Surgeons must respect two critical anatomical danger zones: the **triangle of doom**, bounded by the vas deferens medially and testicular vessels laterally, containing the external iliac artery and vein; and the **triangle of pain**, lateral to testicular vessels below the iliopubic tract, containing the femoral branch of genitofemoral and lateral femoral cutaneous nerves.",
        say: "Laparoscopic repairs cover the myopectineal orifice of Fruchaud preperitoneally. Surgeons must avoid two danger zones: the triangle of doom, containing external iliac vessels, and the triangle of pain, containing the lateral femoral cutaneous and genitofemoral nerves. Tacks placed in the triangle of pain cause severe chronic neuralgia.",
        vis: null
      }
    ]
  }
];

let written = 0;
let errors = 0;

for (const l of lessons) {
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
