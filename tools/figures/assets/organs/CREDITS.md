# Organ Vector Art Credits & Attributions

This directory contains open-licensed vector illustrations of human anatomical organs curated for educational medical decision-support within StewardMD.

---

## 0. How the art is used in figures

`tools/figures/scenes/organs.lib.js` draws one organ per `kind`; `tools/figures/scenes/bio-scene.mjs`
(`ORG_SLIM`) inlines the slimmed file for each kind a scene's page script actually calls `organ()` with.
Slim files live in `slim/`, are vector-only and each under 70 KB (see `tools/figures/dev/svgslim.py`;
`joint-1` needed an Illustrator-DOCTYPE/PGF pre-clean and `skin-2` a stipple thin to meet the budget,
both documented in the slim step, look preserved).

| kind | slim file | source |
|---|---|---|
| liver | `liver-4.svg` | Servier CC BY 3.0 (replaces `liver-1`; bare mass, the lib adds a procedural gallbladder plus portal/hepatic vein stubs) |
| bowel | `small-intestine-1.svg` | Servier CC BY 3.0 |
| colon | `large-intestine-2.svg` | Servier CC BY 3.0 |
| bladder | `bladder-1.svg` | Servier CC BY 3.0 |
| eye | `eye-1.svg` | Servier CC BY 3.0 |
| muscle | `muscle-1.svg` | Servier CC BY 3.0 |
| vessel | `blood-vessel-1.svg` | Servier CC BY 3.0 |
| heart | `heart-1.svg` | NIH BioArt public domain |
| kidney | `kidney-1.svg` | NIH BioArt public domain (`kidney-2` cross-section not used) |
| lung | `lung-1.svg` | NIH BioArt public domain |
| stomach | `stomach-1.svg` | NIH BioArt public domain |
| intestine | `intestine-1.svg` | NIH BioArt public domain |
| brain | `brain-1.svg` | NIH BioArt public domain |
| pancreas | `pancreas-1.svg` | NIH BioArt public domain |
| spleen | `spleen-1.svg` | NIH BioArt public domain |
| ear | `ear-2.svg` | NIH BioArt public domain |
| skin | `skin-2.svg` | NIH BioArt public domain |
| joint | `joint-1.svg` | DBCLS CC BY 4.0 (knee) |
| uterus, thyroid, ganglion | procedural (no art file) | original drawing |

Attribution (CC BY 3.0 needs it) is decided at generation time from the scene's source text
(`ORG_SRC` in `bio-scene.mjs`): the figure footer names exactly the sources of the organ kinds that
page embeds. NIH-only pages read exactly as before. The Servier credit reads
"Servier Medical Art by Servier, CC BY 3.0 (https://smart.servier.com), recoloured and animated":
the files were slimmed to vector-only, posed with procedural additions where noted above, and are
tinted for disease states and animated inside the figures. The DBCLS knee reads
"knee joint art by DataBase Center for Life Science (DBCLS), CC BY 4.0".

Labelled diagrams with text are intentionally NOT used as organ kinds (they would inject
diagram text into figures): `alveolus-2`, `bladder-2`, `uterus-1`, `thyroid-1`, `body-2`, `bone-1`,
`large-intestine-1`, `liver-2`, `liver-3`, `nephron-1`. Uterus and thyroid keep procedural drawings.

---

## 1. NIH BioArt Source (NIAID / NIH)

The anatomical vector illustrations in this library are sourced from **NIH BioArt Source**, a biomedical illustration repository produced and maintained by the National Institute of Allergy and Infectious Diseases (NIAID), part of the National Institutes of Health (NIH), as well as the NIH HuBMAP initiative.

* **Source Repository:** [NIH BioArt Source](https://bioart.niaid.nih.gov)
* **Creator / Illustrator:** Ryan Kissinger, NIAID Visual and Medical Arts; NIH HuBMAP Consortium
* **Publisher:** National Institute of Allergy and Infectious Diseases (NIAID / NIH)
* **Licence:** Public Domain (U.S. Government Work / [Creative Commons CC0 / Public Domain Mark 1.0](https://creativecommons.org/publicdomain/mark/1.0/))
* **Modifications:** Downloaded in native SVG vector format. Inspected, validated, and indexed for educational and clinical decision-support display across mobile UI themes.

### Included NIH BioArt Assets:
- `heart-1.svg` & `heart-2.svg`: **Human Heart** ([BIOART-000228](https://bioart.niaid.nih.gov/bioart/228)) - Shaded whole-organ heart showing ascending aorta, superior vena cava, pulmonary trunk/arteries, pulmonary veins, and coronary vasculature.
- `kidney-1.svg`: **Human Kidney** ([BIOART-000229](https://bioart.niaid.nih.gov/bioart/229)) - Whole-organ kidney with ureter, renal pelvis, renal artery, renal vein, and adrenal gland.
- `liver-1.svg`: **Human Liver** ([BIOART-000230](https://bioart.niaid.nih.gov/bioart/230)) - Whole-organ anterior view of liver showing right and left lobes and falciform ligament.
- `liver-3.svg`: **Liver Lobule** ([BIOART-000565](https://bioart.niaid.nih.gov/bioart/565)) - Detailed functional tissue unit (FTU) of hepatic lobule microanatomy showing central vein, portal triad, sinusoids, and hepatocytes.
- `lung-1.svg` & `lung-2.svg`: **Human Lungs** ([BIOART-000231](https://bioart.niaid.nih.gov/bioart/231)) - Both lungs with trachea, cartilaginous rings, and bronchial tree.
- `stomach-1.svg` & `stomach-2.svg`: **Human Digestive Tract** ([BIOART-000212](https://bioart.niaid.nih.gov/bioart/212)) - Gastrointestinal tract highlighting the stomach in continuity with esophagus and duodenum.
- `intestine-1.svg` & `intestine-2.svg`: **Human Digestive Tract** ([BIOART-000212](https://bioart.niaid.nih.gov/bioart/212)) - Complete small intestine (duodenum, jejunum, ileum) and large intestine (ascending, transverse, descending colon, sigmoid, rectum).
- `brain-1.svg`: **Brain Lateral** ([BIOART-000060](https://bioart.niaid.nih.gov/bioart/60)) - Lateral human brain showing cerebral hemispheres, sulci, gyri, cerebellum, and brainstem.
- `pancreas-1.svg`: **Pancreas with Duodenum** ([BIOART-000239](https://bioart.niaid.nih.gov/bioart/239)) - Pancreas with duodenal C-loop curve framing the pancreatic head.
- `spleen-1.svg`: **Human Spleen** ([BIOART-000243](https://bioart.niaid.nih.gov/bioart/243)) - Spleen with splenic hilum vessels and internal red/white pulp architecture.
- `nephron-1.svg`: **Nephron** ([BIOART-000560](https://bioart.niaid.nih.gov/bioart/560)) - Detailed shaded 2D functional tissue unit (FTU) showing glomerulus, Bowman capsule, convoluted tubules, loop of Henle, and collecting duct.
- `ear-2.svg`: **Inner Ear** ([BIOART-000256](https://bioart.niaid.nih.gov/bioart/256)) - Detailed shaded inner ear labyrinth showing semicircular canals, vestibule, and cochlea.
- `skin-2.svg`: **Skin Histological Cross-Section** ([BIOART-000677](https://bioart.niaid.nih.gov/bioart/677)) - High-detail histological cross-section showing epidermal stratification, dermal papillae, eccrine sweat glands, neurovascular bundles, and hypodermis.
- `blood-vessel-3.svg`: **Blood Vessel Longitudinal Section** ([BIOART-000055](https://bioart.niaid.nih.gov/bioart/55)) - Longitudinal view of capillary vessel with erythrocytes.
- `alveolus-1.svg`: **Pulmonary Alveolus** ([BIOART-000567](https://bioart.niaid.nih.gov/bioart/567)) - Shaded functional tissue unit of alveoli with capillary meshwork.
- `body-1.svg`: **Human Body Silhouette with Major Organs** ([BIOART-000852](https://bioart.niaid.nih.gov/bioart/852)) - Front-view human silhouette with visceral organs and circulatory vasculature.

---

## 2. Servier Medical Art (SMART)

* **Source Repository:** [Servier Medical Art](https://smart.servier.com)
* **Author / Provider:** Les Laboratoires Servier
* **Licence:** [Creative Commons Attribution 3.0 Unported (CC BY 3.0)](https://creativecommons.org/licenses/by/3.0/) / [CC BY 4.0 International](https://creativecommons.org/licenses/by/4.0/)
* **Attribution Notice:** *Servier Medical Art by Servier is licensed under a Creative Commons Attribution License.*
* **Included Assets:**
  - `liver-4.svg`: **Human Liver 3D View** - 3D shaded illustration showing diaphragmatic surface, right and left lobes, and inferior border.
  - `small-intestine-1.svg` & `small-intestine-2.svg`: **Small Intestine** - Separate realistic shaded drawings of coiled bowel loops (duodenum, jejunum, ileum) isolated without stomach.
  - `large-intestine-1.svg` & `large-intestine-2.svg`: **Large Intestine (Colon)** - Complete colon illustrations showing caecum, vermiform appendix, ascending, transverse, descending, and sigmoid colon, and rectum.
  - `bladder-1.svg`: **Urinary Bladder** - Shaded urinary bladder with detrusor contours, bilateral ureter entries, and urethra.
  - `kidney-2.svg`: **Kidney Cross-Section** - Coronal section displaying cortex, medulla, renal pyramids, renal pelvis, calyces, ureter, and vessels.
  - `eye-1.svg`: **Eye Cross-Section** - Horizontal cross-section showing cornea, anterior chamber, iris, lens, ciliary body, vitreous body, retina, choroid, sclera, and optic nerve.
  - `ear-1.svg`: **Ear Anatomy** - Complete ear illustration detailing outer ear, middle ear ossicles (malleus, incus, stapes), and inner ear cochlea and canals.
  - `skin-1.svg`: **Skin Layers Cross-Section** - Shaded cross-section depicting epidermis, dermis, hypodermis, hair follicle, sebaceous gland, and arrector pili.
  - `muscle-1.svg`: **Skeletal Muscle Architecture** - Structural hierarchy of muscle belly, fascicle, muscle fibers, and myofibrils.
  - `blood-vessel-1.svg`: **Artery Cross-Section** - Shaded arterial wall showing tunica intima, tunica media, and tunica adventitia.
  - `blood-vessel-2.svg`: **Vein Cross-Section** - Transverse cross-section of vein with venous valve.

---

## 3. National Cancer Institute (NCI / SEER)

* **Source Repository:** [NCI SEER Training Modules](https://training.seer.cancer.gov/) / Wikimedia Commons
* **Author / Provider:** National Cancer Institute (NIH / U.S. Federal Government)
* **Licence:** Public Domain (U.S. Government Work / [Public Domain Mark 1.0](https://creativecommons.org/publicdomain/mark/1.0/))
* **Included Assets:**
  - `bladder-2.svg`: **Urinary Tract with Bladder & Ureters** ([File:Illu_urinary_system.svg](https://commons.wikimedia.org/wiki/File:Illu_urinary_system.svg)) - Complete urinary tract showing kidneys, bilateral ureters, urinary bladder, and urethra.
  - `uterus-1.svg`: **Female Internal Reproductive System** ([File:Illu_cervix.svg](https://commons.wikimedia.org/wiki/File:Illu_cervix.svg)) - Uterus (fundus, body, cavity, myometrium, endometrium), cervix, vagina, bilateral fallopian tubes, and ovaries.
  - `bone-1.svg`: **Long Bone Cutaway** ([File:Illu_long_bone.svg](https://commons.wikimedia.org/wiki/File:Illu_long_bone.svg)) - Anatomical cutaway showing compact bone, spongy cancellous bone, medullary cavity, epiphyseal line, and periosteum.

---

## 4. National Library of Medicine (NLM / MedlinePlus)

* **Source Repository:** [MedlinePlus / NLM](https://medlineplus.gov/) / Wikimedia Commons
* **Author / Provider:** Arnavaz / MedlinePlus (U.S. National Library of Medicine / NIH)
* **Licence:** Public Domain (U.S. Government Work / [Public Domain Mark 1.0](https://creativecommons.org/publicdomain/mark/1.0/))
* **Included Assets:**
  - `thyroid-1.svg`: **Thyroid Gland with Trachea** ([File:Thyroid_gland-fr.svg](https://commons.wikimedia.org/wiki/File:Thyroid_gland-fr.svg)) - Anatomical illustration of thyroid gland (lobes and isthmus) with larynx, thyroid cartilage, and tracheal rings.

---

## 5. Wikimedia Commons & Community Science Illustrators

* **`liver-2.svg`**: **Biliary System with Liver, Gallbladder, & Vessels** ([File:Biliary_system_new.svg](https://commons.wikimedia.org/wiki/File:Biliary_system_new.svg))
  - Creator: Drriad / Vishnu2011
  - Licence: Public Domain ([PD-self](https://creativecommons.org/publicdomain/zero/1.0/))
  - Details: Detailed liver illustration displaying right and left lobes, falciform ligament, gallbladder, hepatic ducts, cystic duct, common bile duct, portal vein, hepatic artery, duodenum, and pancreas.
* **`joint-1.svg`**: **Knee Synovial Joint** ([File:Anterior_view_of_knee_joint.svg](https://commons.wikimedia.org/wiki/File:Anterior_view_of_knee_joint.svg))
  - Creator: DataBase Center for Life Science (DBCLS TogoTV)
  - Licence: [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)
  - Details: Shaded anterior view of knee joint with femur, tibia, fibula, patella, articular cartilage, menisci, and cruciate and collateral ligaments.
* **`alveolus-2.svg`**: **Pulmonary Alveolus Gas Exchange** ([File:Alveolus_diagram.svg](https://commons.wikimedia.org/wiki/File:Alveolus_diagram.svg))
  - Creator: Mariana Ruiz Villarreal (LadyofHats)
  - Licence: Public Domain ([CC0 / Public Domain Dedication](https://creativecommons.org/publicdomain/zero/1.0/))
  - Details: Alveolus cross-section showing pulmonary capillary bed, red blood cells, and gas exchange.
* **`body-2.svg`**: **Human Body Silhouette with Visceral Organs** ([File:Internal_organs.svg](https://commons.wikimedia.org/wiki/File:Internal_organs.svg))
  - Creator: Mikael Haggstrom / Mariana Ruiz Villarreal (LadyofHats)
  - Licence: Public Domain ([CC0 / Public Domain Dedication](https://creativecommons.org/publicdomain/zero/1.0/))
  - Details: Complete front view human body silhouette with all major visceral organs in anatomical position.
* **`nephron-2.svg`**: **Nephron 2D Functional Schematic** ([BioIcons](https://bioicons.com))
  - Creator: Emily A. Daniel / BioIcons
  - Licence: [Creative Commons Zero 1.0 (CC0 1.0)](https://creativecommons.org/publicdomain/zero/1.0/)
  - Details: Clean vector schematic illustrating nephron tubule path and vascular relationships.

---

## 6. Compliance and Textbook Notice

* None of the figures in this repository are copied from Netter, Gray's Anatomy, Harrison's Principles of Internal Medicine, or any copyrighted medical textbook.
* All assets adhere strictly to open licences (Public Domain, CC0, CC BY 3.0, or CC BY 4.0). No assets with Non-Commercial (NC), No-Derivatives (ND), ShareAlike (SA), or ambiguous licensing are included.
