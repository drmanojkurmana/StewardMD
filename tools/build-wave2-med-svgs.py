#!/usr/bin/env python3
"""
Generate 15 original, mathematically accurate SVG medical diagrams for StewardMD PrepNucleus Learn lessons.
Covers remaining imageless lessons in Anatomy (6/6), Physiology (4/4), plus high-yield
topics in Pharmacology (2), Pathology (1), Biochemistry (1), and Microbiology (1).
Follows StewardMD design rules:
- Palette: #071318 (text/dark), #3D5A54 (muted), #0B6B5B (primary teal), #EAF3F0 (soft teal fill), #B7791F (gold/amber), #B42318 (coral/red).
- Pure SVG, viewBox="0 0 800 520", accessible with <title id="t"> and <desc id="d">.
- White stage (#FFFFFF).
- Crisp typography, explicit labels, no glows, gradients, or backdrops.
"""

import math
import os

OUT_DIR = "prep/lessons/media"
os.makedirs(OUT_DIR, exist_ok=True)

def gen_ana_trilaminar_disc():
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" role="img" aria-labelledby="t d">
<title id="t">Trilaminar embryonic disc and germ layer derivatives</title>
<desc id="d">Schematic cross-section of the third-week human trilaminar germ disc showing ectoderm, mesoderm with notochord and somites, and endoderm, with clinical derivatives of each layer.</desc>
<rect width="800" height="520" fill="#FFFFFF"/>
<text x="400" y="34" font-size="20" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Gastrulation: The Trilaminar Germ Disc</text>
<text x="400" y="56" font-size="12.5" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Third-week conversion of bilaminar epiblast into three primary germ layers</text>

<!-- Amniotic Cavity Top -->
<text x="400" y="90" font-size="12" font-weight="600" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Amniotic cavity (dorsal)</text>

<!-- 1. Ectoderm Layer (Blue/Teal) -->
<path d="M 120 120 Q 400 95 680 120 L 680 150 Q 400 125 120 150 Z" fill="#0B6B5B"/>
<text x="140" y="140" font-size="14" font-weight="700" fill="#FFFFFF" font-family="system-ui,sans-serif">ECTODERM</text>

<!-- Neural Tube & Crest in center of Ectoderm -->
<circle cx="400" cy="135" r="16" fill="#16383E" stroke="#FFFFFF" stroke-width="2"/>
<text x="400" y="139" font-size="9" font-weight="700" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">Neural</text>
<circle cx="376" cy="122" r="5" fill="#B7791F"/>
<circle cx="424" cy="122" r="5" fill="#B7791F"/>
<text x="400" y="108" font-size="10.5" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">Neural crest</text>

<!-- 2. Mesoderm Layer (Amber/Gold) -->
<path d="M 120 160 Q 400 135 680 160 L 680 200 Q 400 175 120 200 Z" fill="#EAF3F0" stroke="#0B6B5B" stroke-width="1.5"/>
<!-- Notochord in midline -->
<circle cx="400" cy="180" r="14" fill="#B7791F" stroke="#071318" stroke-width="1.5"/>
<text x="400" y="184" font-size="9" font-weight="700" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">Noto</text>

<!-- Paraxial Somite blocks -->
<rect x="300" y="165" width="60" height="26" rx="4" fill="#B7791F" opacity="0.85"/>
<text x="330" y="182" font-size="10" font-weight="700" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">Paraxial</text>
<rect x="440" y="165" width="60" height="26" rx="4" fill="#B7791F" opacity="0.85"/>
<text x="470" y="182" font-size="10" font-weight="700" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">Paraxial</text>

<!-- Intermediate mesoderm -->
<rect x="220" y="168" width="55" height="22" rx="4" fill="#B7791F" opacity="0.6"/>
<text x="247" y="183" font-size="9" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Intermed</text>
<rect x="525" y="168" width="55" height="22" rx="4" fill="#B7791F" opacity="0.6"/>
<text x="552" y="183" font-size="9" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Intermed</text>

<!-- Lateral plate -->
<text x="160" y="184" font-size="9" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Lateral plate</text>
<text x="635" y="184" font-size="9" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Lateral plate</text>
<text x="140" y="218" font-size="14" font-weight="700" fill="#B7791F" font-family="system-ui,sans-serif">MESODERM</text>

<!-- 3. Endoderm Layer (Red/Coral) -->
<path d="M 120 220 Q 400 195 680 220 L 680 245 Q 400 220 120 245 Z" fill="#B42318"/>
<text x="140" y="238" font-size="14" font-weight="700" fill="#FFFFFF" font-family="system-ui,sans-serif">ENDODERM</text>

<!-- Yolk sac bottom -->
<text x="400" y="270" font-size="12" font-weight="600" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Yolk sac cavity (ventral)</text>

<!-- Key Derivatives Cards -->
<rect x="50" y="295" width="220" height="175" rx="8" fill="#F4F8F6" stroke="#0B6B5B" stroke-width="1.5"/>
<text x="65" y="320" font-size="13" font-weight="700" fill="#0B6B5B" font-family="system-ui,sans-serif">Ectoderm Derivatives</text>
<text x="65" y="342" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Surface: Epidermis, lens, enamel</text>
<text x="65" y="360" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Neural tube: Brain, spinal cord, retina</text>
<text x="65" y="378" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Neural crest: PNS ganglia, melanocytes,</text>
<text x="75" y="394" font-size="11" fill="#071318" font-family="system-ui,sans-serif">Schwann cells, adrenal medulla,</text>
<text x="75" y="410" font-size="11" fill="#071318" font-family="system-ui,sans-serif">parafollicular C cells, branchial arches</text>
<text x="65" y="435" font-size="10.5" font-weight="600" fill="#B42318" font-family="system-ui,sans-serif">Rule: Adrenal cortex is NOT crest</text>

<rect x="290" y="295" width="220" height="175" rx="8" fill="#FBF8EE" stroke="#B7791F" stroke-width="1.5"/>
<text x="305" y="320" font-size="13" font-weight="700" fill="#B7791F" font-family="system-ui,sans-serif">Mesoderm Derivatives</text>
<text x="305" y="342" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Notochord: Nucleus pulposus</text>
<text x="305" y="360" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Paraxial: Somites (sclerotome bones,</text>
<text x="315" y="376" font-size="11" fill="#071318" font-family="system-ui,sans-serif">myotome skeletal muscles, dermis)</text>
<text x="305" y="394" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Intermediate: Kidneys, ureters, gonads</text>
<text x="305" y="412" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Lateral plate: Heart, spleen, blood,</text>
<text x="315" y="428" font-size="11" fill="#071318" font-family="system-ui,sans-serif">serous linings (peritoneum, pleura)</text>
<text x="305" y="450" font-size="10.5" font-weight="600" fill="#0B6B5B" font-family="system-ui,sans-serif">Rule: Spleen is mesodermal</text>

<rect x="530" y="295" width="220" height="175" rx="8" fill="#FDF2F0" stroke="#B42318" stroke-width="1.5"/>
<text x="545" y="320" font-size="13" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">Endoderm Derivatives</text>
<text x="545" y="342" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Gut tube epithelial lining:</text>
<text x="555" y="360" font-size="11" fill="#071318" font-family="system-ui,sans-serif">Gastrointestinal tract (mouth to anal canal)</text>
<text x="545" y="378" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Respiratory lining: Trachea, lungs</text>
<text x="545" y="396" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Hepatobiliary &amp; Pancreas: Liver,</text>
<text x="555" y="412" font-size="11" fill="#071318" font-family="system-ui,sans-serif">gallbladder, pancreatic acini/islets</text>
<text x="545" y="430" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Endocrine: Thyroid follicular, parathyroid,</text>
<text x="555" y="446" font-size="11" fill="#071318" font-family="system-ui,sans-serif">thymus, middle ear cavity</text>

<text x="400" y="505" font-size="11" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">The primitive streak forms at the caudal epiblast; ingressing epiblast cells replace hypoblast (endoderm) and create mesoderm.</text>
</svg>'''
    with open(os.path.join(OUT_DIR, "ana-trilaminar-disc.svg"), "w") as f:
        f.write(svg)

def gen_ana_epiploic_foramen():
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" role="img" aria-labelledby="t d">
<title id="t">Boundaries of the Epiploic Foramen of Winslow</title>
<desc id="d">Anatomical orientation diagram of the epiploic foramen at T12 connecting the greater and lesser peritoneal sacs, detailing the anterior portal triad, posterior inferior vena cava, superior caudate lobe, and inferior first part of duodenum.</desc>
<rect width="800" height="520" fill="#FFFFFF"/>
<text x="400" y="34" font-size="20" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Epiploic Foramen of Winslow: Boundaries</text>
<text x="400" y="56" font-size="12.5" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Communication aperture between Greater Sac and Lesser Sac (Omental Bursa) at T12</text>

<!-- Central Aperture -->
<rect x="280" y="180" width="240" height="150" rx="20" fill="#EAF3F0" stroke="#0B6B5B" stroke-width="2" stroke-dasharray="6 4"/>
<text x="400" y="245" font-size="16" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">FORAMEN OF WINSLOW</text>
<text x="400" y="268" font-size="12" font-weight="600" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">(Slit-like aperture, ~3 cm long, at T12)</text>

<!-- Communication arrows -->
<line x1="220" y1="255" x2="265" y2="255" stroke="#0B6B5B" stroke-width="3" marker-end="url(#arr-gr)"/>
<text x="180" y="260" font-size="13" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Lesser Sac</text>
<line x1="535" y1="255" x2="580" y2="255" stroke="#0B6B5B" stroke-width="3" marker-end="url(#arr-gr)"/>
<text x="630" y="260" font-size="13" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Greater Sac</text>

<defs>
<marker id="arr-gr" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
<path d="M0 0 L6 3 L0 6 z" fill="#0B6B5B"/>
</marker>
</defs>

<!-- 1. Superior Boundary: Caudate Lobe -->
<rect x="250" y="90" width="300" height="65" rx="8" fill="#F4F8F6" stroke="#0B6B5B" stroke-width="1.5"/>
<text x="400" y="112" font-size="12" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">SUPERIOR (Roof)</text>
<text x="400" y="132" font-size="14" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Caudate Lobe of Liver (Segment I)</text>
<line x1="400" y1="155" x2="400" y2="175" stroke="#0B6B5B" stroke-width="2"/>

<!-- 2. Inferior Boundary: First part of Duodenum -->
<rect x="250" y="355" width="300" height="65" rx="8" fill="#F4F8F6" stroke="#0B6B5B" stroke-width="1.5"/>
<text x="400" y="377" font-size="12" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">INFERIOR (Floor)</text>
<text x="400" y="397" font-size="13.5" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">1st Part of Duodenum (D1) &amp; Hepatic Artery</text>
<line x1="400" y1="335" x2="400" y2="355" stroke="#0B6B5B" stroke-width="2"/>

<!-- 3. Anterior Boundary: Free Edge of Lesser Omentum -->
<rect x="50" y="130" width="200" height="250" rx="8" fill="#FBF8EE" stroke="#B7791F" stroke-width="1.5"/>
<text x="150" y="155" font-size="12" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">ANTERIOR BORDER</text>
<text x="150" y="175" font-size="13" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Free Edge of Lesser Omentum</text>
<text x="150" y="195" font-size="11" font-weight="600" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">(Hepatoduodenal ligament)</text>
<rect x="65" y="210" width="170" height="120" rx="6" fill="#FFFFFF" stroke="#D0E2DB" stroke-width="1"/>
<text x="150" y="230" font-size="11.5" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">Portal Triad Contents:</text>
<text x="75" y="252" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Bile Duct (anterior, right)</text>
<text x="75" y="272" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Hepatic Artery (ant, left)</text>
<text x="75" y="292" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Portal Vein (posterior)</text>
<text x="150" y="318" font-size="10" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">Site of Pringle Manoeuvre</text>
<line x1="250" y1="255" x2="275" y2="255" stroke="#B7791F" stroke-width="2"/>

<!-- 4. Posterior Boundary: IVC -->
<rect x="550" y="130" width="200" height="250" rx="8" fill="#FDF2F0" stroke="#B42318" stroke-width="1.5"/>
<text x="650" y="155" font-size="12" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">POSTERIOR BORDER</text>
<text x="650" y="175" font-size="13" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Inferior Vena Cava (IVC)</text>
<text x="650" y="195" font-size="11" font-weight="600" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">&amp; Right Adrenal Gland</text>
<rect x="565" y="210" width="170" height="120" rx="6" fill="#FFFFFF" stroke="#D0E2DB" stroke-width="1"/>
<text x="650" y="230" font-size="11.5" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">Vertebral Relation:</text>
<text x="575" y="255" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• T12 Vertebral Body</text>
<text x="575" y="278" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Right crus of diaphragm</text>
<text x="575" y="302" font-size="10.5" fill="#3D5A54" font-family="system-ui,sans-serif">• Covered by parietal</text>
<text x="585" y="318" font-size="10.5" fill="#3D5A54" font-family="system-ui,sans-serif">peritoneum</text>
<line x1="525" y1="255" x2="550" y2="255" stroke="#B42318" stroke-width="2"/>

<text x="400" y="505" font-size="11" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Surgeons compress the free edge of the lesser omentum between thumb and index finger to arrest liver bleeding (Pringle manoeuvre).</text>
</svg>'''
    with open(os.path.join(OUT_DIR, "ana-epiploic-foramen.svg"), "w") as f:
        f.write(svg)

def gen_ana_thyroid_relations():
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" role="img" aria-labelledby="t d">
<title id="t">Thyroid gland vascular supply and nerve relationships</title>
<desc id="d">Anterior anatomical schematic of the thyroid gland, trachea, and larynx, showing the superior thyroid artery related to the external laryngeal nerve, the inferior thyroid artery intimately related to the recurrent laryngeal nerve, and the isthmus crossing tracheal rings 2 to 4.</desc>
<rect width="800" height="520" fill="#FFFFFF"/>
<text x="400" y="34" font-size="20" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Thyroid Gland: Arteries and Nerve Relations</text>
<text x="400" y="56" font-size="12.5" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Surgical anatomy of ligation levels and risk of vocal fold paralysis</text>

<!-- Trachea central column -->
<rect x="360" y="100" width="80" height="300" rx="4" fill="#EAF3F0" stroke="#0B6B5B" stroke-width="1.5"/>
<line x1="360" y1="130" x2="440" y2="130" stroke="#0B6B5B" stroke-width="1.5"/>
<line x1="360" y1="160" x2="440" y2="160" stroke="#0B6B5B" stroke-width="1.5"/>
<line x1="360" y1="190" x2="440" y2="190" stroke="#0B6B5B" stroke-width="1.5"/>
<line x1="360" y1="220" x2="440" y2="220" stroke="#0B6B5B" stroke-width="1.5"/>
<line x1="360" y1="250" x2="440" y2="250" stroke="#0B6B5B" stroke-width="1.5"/>
<line x1="360" y1="280" x2="440" y2="280" stroke="#0B6B5B" stroke-width="1.5"/>
<line x1="360" y1="310" x2="440" y2="310" stroke="#0B6B5B" stroke-width="1.5"/>
<line x1="360" y1="340" x2="440" y2="340" stroke="#0B6B5B" stroke-width="1.5"/>
<text x="400" y="122" font-size="11" font-weight="600" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Cricoid C6</text>
<text x="400" y="152" font-size="11" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Ring 1</text>
<text x="400" y="182" font-size="11" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Ring 2</text>
<text x="400" y="212" font-size="11" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Ring 3</text>
<text x="400" y="242" font-size="11" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Ring 4</text>
<text x="400" y="272" font-size="11" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Ring 5</text>

<!-- Thyroid lobes and isthmus -->
<!-- Right lobe -->
<path d="M 360 140 C 310 140 280 180 280 250 C 280 320 320 340 360 320 Z" fill="#B42318" opacity="0.85"/>
<!-- Left lobe -->
<path d="M 440 140 C 490 140 520 180 520 250 C 520 320 480 340 440 320 Z" fill="#B42318" opacity="0.85"/>
<!-- Isthmus covering rings 2 to 4 -->
<rect x="350" y="180" width="100" height="70" rx="6" fill="#B42318"/>
<text x="400" y="218" font-size="12" font-weight="700" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">Isthmus</text>
<text x="400" y="233" font-size="10" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">(Rings 2-4)</text>

<!-- Superior Thyroid Artery + Ext Laryngeal Nerve (Left side schematic) -->
<path d="M 500 80 Q 480 110 460 145" fill="none" stroke="#B42318" stroke-width="3"/>
<path d="M 515 80 Q 495 110 450 160" fill="none" stroke="#B7791F" stroke-width="2" stroke-dasharray="4 2"/>
<circle cx="460" cy="145" r="4" fill="#B42318"/>

<!-- Inferior Thyroid Artery + Recurrent Laryngeal Nerve (Right side schematic) -->
<path d="M 220 360 Q 270 360 330 320" fill="none" stroke="#B42318" stroke-width="3"/>
<path d="M 335 390 Q 330 340 340 280 Q 345 220 355 160" fill="none" stroke="#B7791F" stroke-width="2.5"/>
<circle cx="330" cy="320" r="4" fill="#B42318"/>

<!-- Callout cards -->
<rect x="40" y="90" width="220" height="120" rx="8" fill="#F4F8F6" stroke="#0B6B5B" stroke-width="1.5"/>
<text x="50" y="112" font-size="12.5" font-weight="700" fill="#0B6B5B" font-family="system-ui,sans-serif">Superior Thyroid Artery (STA)</text>
<text x="50" y="132" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• 1st branch of External Carotid Artery</text>
<text x="50" y="150" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Runs with: Ext. Laryngeal Nerve</text>
<text x="50" y="168" font-size="11" fill="#3D5A54" font-family="system-ui,sans-serif">• Supplies Cricothyroid muscle</text>
<text x="50" y="195" font-size="11" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">Ligate CLOSE to gland pole</text>

<rect x="40" y="240" width="220" height="135" rx="8" fill="#FDF2F0" stroke="#B42318" stroke-width="1.5"/>
<text x="50" y="262" font-size="12.5" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">Inferior Thyroid Artery (ITA)</text>
<text x="50" y="282" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• From Thyrocervical trunk (Subclavian)</text>
<text x="50" y="300" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Crosses Recurrent Laryngeal Nerve</text>
<text x="50" y="318" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Supplies 4 Parathyroid glands</text>
<text x="50" y="336" font-size="11" fill="#3D5A54" font-family="system-ui,sans-serif">• Injury -> hoarseness (unilat) or</text>
<text x="60" y="352" font-size="11" fill="#3D5A54" font-family="system-ui,sans-serif">stridor / airway obstruction (bilat)</text>
<text x="50" y="368" font-size="11" font-weight="700" fill="#0B6B5B" font-family="system-ui,sans-serif">Ligate FAR away from gland</text>

<rect x="540" y="180" width="220" height="150" rx="8" fill="#FBF8EE" stroke="#B7791F" stroke-width="1.5"/>
<text x="550" y="202" font-size="12.5" font-weight="700" fill="#B7791F" font-family="system-ui,sans-serif">Recurrent Laryngeal Nerve (RLN)</text>
<text x="550" y="222" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Right RLN: loops under Subclavian</text>
<text x="550" y="240" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Left RLN: loops under Aortic arch</text>
<text x="560" y="256" font-size="11" fill="#3D5A54" font-family="system-ui,sans-serif">(longer course, mediastinal risk)</text>
<text x="550" y="274" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Ascends in tracheoesophageal groove</text>
<text x="550" y="292" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Motor to ALL intrinsic laryngeal</text>
<text x="560" y="308" font-size="11" fill="#071318" font-family="system-ui,sans-serif">muscles EXCEPT Cricothyroid</text>

<text x="400" y="505" font-size="11" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Surgical rule: ligate superior thyroid artery near the gland pole, and inferior thyroid artery trunk far from the gland to preserve the nerves.</text>
</svg>'''
    with open(os.path.join(OUT_DIR, "ana-thyroid-relations.svg"), "w") as f:
        f.write(svg)

def gen_ana_carotid_branches():
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" role="img" aria-labelledby="t d">
<title id="t">External Carotid Artery Branches and Bifurcation</title>
<desc id="d">Schematic branching tree of the external carotid artery showing the eight branches organized into anterior, medial, posterior, and terminal groups, originating from the common carotid bifurcation at C3-C4.</desc>
<rect width="800" height="520" fill="#FFFFFF"/>
<text x="400" y="34" font-size="20" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">External Carotid Artery: Eight Branches</text>
<text x="400" y="56" font-size="12.5" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Bifurcation at C3-C4 (upper border of thyroid cartilage); Internal Carotid gives NO branches in neck</text>

<!-- Main Vessel Tree -->
<!-- Common Carotid -->
<line x1="380" y1="450" x2="380" y2="340" stroke="#B42318" stroke-width="12"/>
<text x="365" y="400" font-size="13" font-weight="700" text-anchor="end" fill="#B42318" font-family="system-ui,sans-serif">Common Carotid (CCA)</text>

<!-- Bifurcation at C3-C4 -->
<circle cx="380" cy="340" r="8" fill="#071318"/>
<line x1="380" y1="340" x2="520" y2="340" stroke="#3D5A54" stroke-width="1" stroke-dasharray="3 3"/>
<text x="525" y="344" font-size="11.5" font-weight="700" fill="#0B6B5B" font-family="system-ui,sans-serif">C3-C4: Upper border of thyroid cartilage</text>

<!-- Internal Carotid (Straight deep, no branches) -->
<path d="M 380 340 Q 420 280 430 100" fill="none" stroke="#B42318" stroke-width="8" opacity="0.4"/>
<text x="445" y="160" font-size="13" font-weight="700" fill="#3D5A54" font-family="system-ui,sans-serif">Internal Carotid (ICA)</text>
<text x="445" y="178" font-size="11" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">(NO neck branches)</text>

<!-- External Carotid (Anterior and branching) -->
<path d="M 380 340 Q 350 280 340 130" fill="none" stroke="#B42318" stroke-width="8"/>
<text x="330" y="240" font-size="13" font-weight="700" text-anchor="end" fill="#B42318" font-family="system-ui,sans-serif">ECA Trunk</text>

<!-- 1. Anterior Branches (Left side green cards) -->
<!-- Superior Thyroid -->
<path d="M 365 320 Q 310 325 240 335" fill="none" stroke="#0B6B5B" stroke-width="3"/>
<rect x="70" y="315" width="160" height="36" rx="6" fill="#F4F8F6" stroke="#0B6B5B" stroke-width="1.2"/>
<text x="150" y="338" font-size="12" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">1. Superior Thyroid</text>

<!-- Lingual -->
<path d="M 355 270 Q 300 270 240 270" fill="none" stroke="#0B6B5B" stroke-width="3"/>
<rect x="70" y="252" width="160" height="36" rx="6" fill="#F4F8F6" stroke="#0B6B5B" stroke-width="1.2"/>
<text x="150" y="275" font-size="12" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">2. Lingual</text>

<!-- Facial -->
<path d="M 350 220 Q 290 215 240 205" fill="none" stroke="#0B6B5B" stroke-width="3"/>
<rect x="70" y="190" width="160" height="36" rx="6" fill="#F4F8F6" stroke="#0B6B5B" stroke-width="1.2"/>
<text x="150" y="212" font-size="12" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">3. Facial</text>

<text x="150" y="175" font-size="12.5" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">ANTERIOR GROUP</text>

<!-- 2. Medial Branch -->
<path d="M 355 295 Q 370 260 380 230" fill="none" stroke="#B7791F" stroke-width="3"/>
<rect x="300" y="200" width="150" height="36" rx="6" fill="#FBF8EE" stroke="#B7791F" stroke-width="1.2"/>
<text x="375" y="222" font-size="11" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">4. Ascending Pharyngeal</text>

<!-- 3. Posterior Branches (Right side amber) -->
<!-- Occipital -->
<path d="M 350 240 Q 420 230 540 230" fill="none" stroke="#B7791F" stroke-width="3"/>
<rect x="550" y="215" width="160" height="36" rx="6" fill="#FBF8EE" stroke="#B7791F" stroke-width="1.2"/>
<text x="630" y="238" font-size="12" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">5. Occipital</text>

<!-- Posterior Auricular -->
<path d="M 345 180 Q 430 170 540 170" fill="none" stroke="#B7791F" stroke-width="3"/>
<rect x="550" y="152" width="160" height="36" rx="6" fill="#FBF8EE" stroke="#B7791F" stroke-width="1.2"/>
<text x="630" y="175" font-size="12" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">6. Posterior Auricular</text>

<!-- 4. Terminal Branches (Top) -->
<!-- Maxillary -->
<path d="M 340 130 Q 300 100 240 90" fill="none" stroke="#B42318" stroke-width="3.5"/>
<rect x="100" y="75" width="130" height="36" rx="6" fill="#FDF2F0" stroke="#B42318" stroke-width="1.2"/>
<text x="165" y="98" font-size="12" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">7. Maxillary</text>

<!-- Superficial Temporal -->
<path d="M 340 130 L 340 70" fill="none" stroke="#B42318" stroke-width="3.5"/>
<rect x="270" y="50" width="150" height="36" rx="6" fill="#FDF2F0" stroke="#B42318" stroke-width="1.2"/>
<text x="345" y="73" font-size="12" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">8. Superficial Temporal</text>

<text x="260" y="120" font-size="11" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">TERMINAL (in Parotid)</text>

<!-- Mnemonic card bottom -->
<rect x="150" y="440" width="500" height="50" rx="8" fill="#EAF3F0" stroke="#0B6B5B" stroke-width="1.2"/>
<text x="400" y="462" font-size="12" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Mnemonic: "Some Anatomists Like Freaking Out Poor Medical Students"</text>
<text x="400" y="480" font-size="11" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Superior thyroid, Ascending pharyngeal, Lingual, Facial, Occipital, Post. auricular, Maxillary, Superficial temporal</text>

<text x="400" y="510" font-size="10.5" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Ophthalmic artery arises from the cerebral portion of the Internal Carotid Artery, not the External Carotid.</text>
</svg>'''
    with open(os.path.join(OUT_DIR, "ana-carotid-branches.svg"), "w") as f:
        f.write(svg)

def gen_ana_twinning_timing():
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" role="img" aria-labelledby="t d">
<title id="t">Monozygotic Twinning Cleavage Timing and Placentation</title>
<desc id="d">Embryological timeline diagram illustrating the outcomes of monozygotic twinning based on division day: dichorionic diamniotic (days 0-3), monochorionic diamniotic (days 4-8), monochorionic monoamniotic (days 8-12), and conjoined twins (after day 13).</desc>
<rect width="800" height="520" fill="#FFFFFF"/>
<text x="400" y="34" font-size="20" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Monozygotic Twinning: Cleavage Timing</text>
<text x="400" y="56" font-size="12.5" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Placentation and amniotic sac arrangement depend strictly on the day of zygote division</text>

<!-- Timeline axis -->
<line x1="80" y1="110" x2="720" y2="110" stroke="#071318" stroke-width="3"/>
<polygon points="725,110 715,105 715,115" fill="#071318"/>

<!-- 4 Timeline Nodes -->
<!-- Node 1: Days 0-3 -->
<circle cx="160" cy="110" r="10" fill="#0B6B5B"/>
<text x="160" y="90" font-size="13" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Days 0-3</text>
<text x="160" y="135" font-size="11" font-weight="600" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Morula stage</text>

<!-- Node 2: Days 4-8 -->
<circle cx="320" cy="110" r="10" fill="#0B6B5B"/>
<text x="320" y="90" font-size="13" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Days 4-8</text>
<text x="320" y="135" font-size="11" font-weight="600" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Blastocyst</text>

<!-- Node 3: Days 8-12 -->
<circle cx="480" cy="110" r="10" fill="#B7791F"/>
<text x="480" y="90" font-size="13" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">Days 8-12</text>
<text x="480" y="135" font-size="11" font-weight="600" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Implanted disc</text>

<!-- Node 4: > Day 13 -->
<circle cx="640" cy="110" r="10" fill="#B42318"/>
<text x="640" y="90" font-size="13" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">&gt; Day 13</text>
<text x="640" y="135" font-size="11" font-weight="600" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Primitive streak</text>

<!-- 4 Cards Below -->
<!-- Card 1 -->
<rect x="70" y="160" width="180" height="290" rx="8" fill="#F4F8F6" stroke="#0B6B5B" stroke-width="1.5"/>
<text x="160" y="185" font-size="14" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Di-Di (25-30%)</text>
<text x="160" y="205" font-size="11" font-weight="600" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Dichorionic Diamniotic</text>
<!-- Diagram mini -->
<circle cx="160" cy="265" r="45" fill="#FFFFFF" stroke="#0B6B5B" stroke-width="1.5"/>
<circle cx="140" cy="265" r="20" fill="#EAF3F0" stroke="#0B6B5B"/>
<circle cx="180" cy="265" r="20" fill="#EAF3F0" stroke="#0B6B5B"/>
<text x="80" y="340" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• 2 Placentas (or fused)</text>
<text x="80" y="360" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• 2 Chorions, 2 Amnions</text>
<text x="80" y="380" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Thick dividing septum</text>
<text x="80" y="400" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• "Twin peak" / Lambda sign</text>
<text x="160" y="435" font-size="10.5" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Lowest risk</text>

<!-- Card 2 -->
<rect x="260" y="160" width="180" height="290" rx="8" fill="#EAF3F0" stroke="#0B6B5B" stroke-width="1.5"/>
<text x="350" y="185" font-size="14" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Mo-Di (70-75%)</text>
<text x="350" y="205" font-size="11" font-weight="600" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Monochorionic Diamniotic</text>
<!-- Diagram mini -->
<circle cx="350" cy="265" r="45" fill="#FFFFFF" stroke="#0B6B5B" stroke-width="1.5"/>
<line x1="350" y1="220" x2="350" y2="310" stroke="#0B6B5B" stroke-width="1.5"/>
<circle cx="330" cy="265" r="10" fill="#0B6B5B"/>
<circle cx="370" cy="265" r="10" fill="#0B6B5B"/>
<text x="270" y="340" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• 1 Shared Placenta</text>
<text x="270" y="360" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• 1 Chorion, 2 Amnions</text>
<text x="270" y="380" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Thin "T-sign" junction</text>
<text x="270" y="400" font-size="11" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">• Risk: TTTS (twin-to-twin</text>
<text x="280" y="416" font-size="10.5" fill="#B42318" font-family="system-ui,sans-serif">transfusion syndrome)</text>
<text x="350" y="435" font-size="10.5" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">Most common type</text>

<!-- Card 3 -->
<rect x="450" y="160" width="160" height="290" rx="8" fill="#FBF8EE" stroke="#B7791F" stroke-width="1.5"/>
<text x="530" y="185" font-size="14" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">Mo-Mo (1-2%)</text>
<text x="530" y="205" font-size="11" font-weight="600" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Monochorionic Monoamniotic</text>
<!-- Diagram mini -->
<circle cx="530" cy="265" r="45" fill="#FFFFFF" stroke="#B7791F" stroke-width="1.5"/>
<circle cx="518" cy="265" r="10" fill="#B7791F"/>
<circle cx="542" cy="265" r="10" fill="#B7791F"/>
<text x="460" y="340" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• 1 Shared Placenta</text>
<text x="460" y="360" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• 1 Chorion, 1 Amnion</text>
<text x="460" y="380" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• NO dividing membrane</text>
<text x="460" y="400" font-size="11" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">• Cord entanglement</text>
<text x="530" y="435" font-size="10.5" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">High fetal mortality</text>

<!-- Card 4 -->
<rect x="620" y="160" width="140" height="290" rx="8" fill="#FDF2F0" stroke="#B42318" stroke-width="1.5"/>
<text x="690" y="185" font-size="14" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">Conjoined</text>
<text x="690" y="205" font-size="11" font-weight="600" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">&lt;1 in 50,000</text>
<!-- Diagram mini -->
<circle cx="690" cy="265" r="45" fill="#FFFFFF" stroke="#B42318" stroke-width="1.5"/>
<ellipse cx="690" cy="265" rx="18" ry="12" fill="#B42318"/>
<text x="630" y="340" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Incomplete split</text>
<text x="630" y="360" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Shared organs</text>
<text x="630" y="380" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Thoracopagus</text>
<text x="640" y="396" font-size="10.5" fill="#3D5A54" font-family="system-ui,sans-serif">(most common: 75%)</text>
<text x="690" y="435" font-size="10.5" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">Delivery by C-section</text>

<text x="400" y="505" font-size="11" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Dizygotic twins (two separate ova) are ALWAYS Dichorionic Diamniotic; only Monozygotic twins vary by cleavage day.</text>
</svg>'''
    with open(os.path.join(OUT_DIR, "ana-twinning-timing.svg"), "w") as f:
        f.write(svg)

def gen_ana_allens_test():
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" role="img" aria-labelledby="t d">
<title id="t">Modified Allen's test for palmar arch arterial patency</title>
<desc id="d">Stepwise clinical protocol for the modified Allen test evaluating collateral arterial perfusion via the superficial and deep palmar arches prior to radial artery cannulation or puncture.</desc>
<rect width="800" height="520" fill="#FFFFFF"/>
<text x="400" y="34" font-size="20" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Modified Allen's Test: Palmar Arch Patency</text>
<text x="400" y="56" font-size="12.5" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Assessment of ulnar collateral perfusion before radial artery puncture or cannulation</text>

<!-- 3 Steps horizontally -->
<!-- Step 1 -->
<rect x="50" y="100" width="210" height="340" rx="10" fill="#F4F8F6" stroke="#0B6B5B" stroke-width="1.5"/>
<text x="155" y="130" font-size="15" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Step 1: Exsanguinate</text>
<rect x="80" y="150" width="150" height="130" rx="8" fill="#FFFFFF" stroke="#D0E2DB"/>
<!-- Hand closed icon / text -->
<text x="155" y="210" font-size="14" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Clenched Fist</text>
<text x="155" y="235" font-size="11" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Forces blood out of palm</text>
<text x="65" y="310" font-size="11.5" fill="#071318" font-family="system-ui,sans-serif">• Patient tightly clenches fist</text>
<text x="75" y="328" font-size="11" fill="#3D5A54" font-family="system-ui,sans-serif">for 30 seconds</text>
<text x="65" y="350" font-size="11.5" fill="#071318" font-family="system-ui,sans-serif">• Examiner occludes BOTH</text>
<text x="75" y="368" font-size="11" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">Radial and Ulnar arteries</text>
<text x="75" y="386" font-size="11" fill="#3D5A54" font-family="system-ui,sans-serif">simultaneously at the wrist</text>

<!-- Step 2 -->
<rect x="295" y="100" width="210" height="340" rx="10" fill="#FBF8EE" stroke="#B7791F" stroke-width="1.5"/>
<text x="400" y="130" font-size="15" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">Step 2: Pallor</text>
<rect x="325" y="150" width="150" height="130" rx="8" fill="#FAF6EA" stroke="#B7791F"/>
<text x="400" y="210" font-size="14" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">Blanched Palm</text>
<text x="400" y="235" font-size="11" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Pale, ischemic appearance</text>
<text x="310" y="310" font-size="11.5" fill="#071318" font-family="system-ui,sans-serif">• Patient opens hand</text>
<text x="320" y="328" font-size="11" fill="#3D5A54" font-family="system-ui,sans-serif">(without hyperextending)</text>
<text x="310" y="350" font-size="11.5" fill="#071318" font-family="system-ui,sans-serif">• Palm and fingers appear</text>
<text x="320" y="368" font-size="11" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">pale and blanched</text>
<text x="310" y="390" font-size="11.5" fill="#071318" font-family="system-ui,sans-serif">• Both arteries held closed</text>

<!-- Step 3 -->
<rect x="540" y="100" width="210" height="340" rx="10" fill="#EAF3F0" stroke="#0B6B5B" stroke-width="1.5"/>
<text x="645" y="130" font-size="15" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Step 3: Ulnar Release</text>
<rect x="570" y="150" width="150" height="130" rx="8" fill="#FDF2F0" stroke="#B42318"/>
<text x="645" y="210" font-size="14" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">Erythema / Flush</text>
<text x="645" y="235" font-size="11" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Blood refills palmar arches</text>
<text x="555" y="310" font-size="11.5" fill="#071318" font-family="system-ui,sans-serif">• Release ULNAR artery</text>
<text x="565" y="328" font-size="11" fill="#3D5A54" font-family="system-ui,sans-serif">(maintain radial pressure)</text>
<text x="555" y="350" font-size="11.5" font-weight="700" fill="#0B6B5B" font-family="system-ui,sans-serif">NORMAL: &lt; 5-7 seconds</text>
<text x="565" y="368" font-size="11" fill="#3D5A54" font-family="system-ui,sans-serif">Color flushes back (Patent)</text>
<text x="555" y="390" font-size="11.5" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">ABNORMAL: &gt; 10 seconds</text>
<text x="565" y="408" font-size="11" fill="#B42318" font-family="system-ui,sans-serif">Do NOT cannulate radial!</text>

<text x="400" y="505" font-size="11" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Superficial palmar arch is completed primarily by the ulnar artery; deep palmar arch is formed primarily by the radial artery.</text>
</svg>'''
    with open(os.path.join(OUT_DIR, "ana-allens-test.svg"), "w") as f:
        f.write(svg)

def gen_phy_acid_base_map():
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" role="img" aria-labelledby="t d">
<title id="t">Davenport Acid-Base Map and Diagnostic Quadrants</title>
<desc id="d">Bicarbonate versus blood pH nomogram showing physiological normal point (pH 7.40, HCO3- 24 mEq/L, PaCO2 40 mmHg), isopleths of PaCO2, and four primary acid-base quadrants with compensatory trajectories.</desc>
<rect width="800" height="520" fill="#FFFFFF"/>
<text x="400" y="34" font-size="20" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Davenport Acid-Base Diagram</text>
<text x="400" y="56" font-size="12.5" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Plasma [HCO3⁻] versus pH and PaCO2 isobar compensation pathways</text>

<!-- Axes: X = pH (7.0 to 7.8, x: 140 to 680), Y = HCO3- (0 to 45, y: 420 to 110) -->
<line x1="140" y1="420" x2="680" y2="420" stroke="#071318" stroke-width="2"/>
<line x1="140" y1="420" x2="140" y2="100" stroke="#071318" stroke-width="2"/>

<!-- Normal reference lines: pH 7.40 (x=410), HCO3- 24 (y=255) -->
<line x1="410" y1="100" x2="410" y2="420" stroke="#D0E2DB" stroke-width="1.5" stroke-dasharray="4 4"/>
<line x1="140" y1="255" x2="680" y2="255" stroke="#D0E2DB" stroke-width="1.5" stroke-dasharray="4 4"/>
<!-- Normal range band (pH 7.35 to 7.45) -->
<rect x="376" y="100" width="68" height="320" fill="#EAF3F0" opacity="0.4"/>

<!-- 4 Quadrants -->
<!-- Top-Left: Respiratory Acidosis (pH low, HCO3 high) -->
<rect x="160" y="120" width="180" height="90" rx="8" fill="#FDF2F0" stroke="#B42318" stroke-width="1.2"/>
<text x="250" y="142" font-size="12.5" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">Respiratory Acidosis</text>
<text x="250" y="160" font-size="11" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">PaCO2 &gt; 45 mmHg (hypoventilation)</text>
<text x="250" y="176" font-size="10.5" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">COPD, asthma, CNS depression</text>
<text x="250" y="194" font-size="10.5" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Renal: Retains HCO3⁻ (takes days)</text>

<!-- Top-Right: Metabolic Alkalosis (pH high, HCO3 high) -->
<rect x="470" y="120" width="190" height="90" rx="8" fill="#FBF8EE" stroke="#B7791F" stroke-width="1.2"/>
<text x="565" y="142" font-size="12.5" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">Metabolic Alkalosis</text>
<text x="565" y="160" font-size="11" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">HCO3⁻ &gt; 26 mEq/L</text>
<text x="565" y="176" font-size="10.5" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Vomiting, diuretics, hyperaldosteronism</text>
<text x="565" y="194" font-size="10.5" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Resp: Hypoventilation (increases CO2)</text>

<!-- Bottom-Left: Metabolic Acidosis (pH low, HCO3 low) -->
<rect x="160" y="300" width="180" height="90" rx="8" fill="#FDF2F0" stroke="#B42318" stroke-width="1.2"/>
<text x="250" y="322" font-size="12.5" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">Metabolic Acidosis</text>
<text x="250" y="340" font-size="11" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">HCO3⁻ &lt; 22 mEq/L</text>
<text x="250" y="356" font-size="10.5" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">DKA, lactic acidosis, renal failure</text>
<text x="250" y="374" font-size="10.5" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Resp: Kussmaul hyperventilation</text>

<!-- Bottom-Right: Respiratory Alkalosis (pH high, HCO3 low) -->
<rect x="470" y="300" width="190" height="90" rx="8" fill="#F4F8F6" stroke="#0B6B5B" stroke-width="1.2"/>
<text x="565" y="322" font-size="12.5" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Respiratory Alkalosis</text>
<text x="565" y="340" font-size="11" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">PaCO2 &lt; 35 mmHg (hyperventilation)</text>
<text x="565" y="356" font-size="10.5" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Panic/anxiety, pulmonary embolism, altitude</text>
<text x="565" y="374" font-size="10.5" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Renal: Excretes HCO3⁻ into urine</text>

<!-- Normal Center Target -->
<circle cx="410" cy="255" r="7" fill="#0B6B5B"/>
<text x="410" y="278" font-size="12" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">NORMAL</text>
<text x="410" y="294" font-size="10" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">pH 7.40 | 24 mEq/L | 40 mmHg</text>

<!-- Labels -->
<text x="410" y="450" font-size="13" font-weight="600" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Arterial Blood pH</text>
<text x="210" y="440" font-size="11" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">&lt; 7.35 ACIDOSIS</text>
<text x="610" y="440" font-size="11" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">ALKALOSIS &gt; 7.45</text>

<text x="95" y="260" font-size="13" font-weight="600" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif" transform="rotate(-90 95 260)">Plasma [HCO3⁻] (mEq/L)</text>
<text x="130" y="424" font-size="11" text-anchor="end" fill="#3D5A54" font-family="system-ui,sans-serif">0</text>
<text x="130" y="259" font-size="11" text-anchor="end" fill="#3D5A54" font-family="system-ui,sans-serif">24</text>
<text x="130" y="115" font-size="11" text-anchor="end" fill="#3D5A54" font-family="system-ui,sans-serif">40</text>

<text x="400" y="505" font-size="11" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Respiratory compensation acts within minutes via ventilation; renal compensation requires 24 to 72 hours to alter bicarbonate.</text>
</svg>'''
    with open(os.path.join(OUT_DIR, "phy-acid-base-map.svg"), "w") as f:
        f.write(svg)

def gen_phy_fluid_compartments():
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" role="img" aria-labelledby="t d">
<title id="t">Body Fluid Compartments and Measurement Markers</title>
<desc id="d">The 60-40-20 rule for total body water distribution in a 70 kg individual showing intracellular fluid, interstitial fluid, plasma, and their respective dilution volume measurement markers.</desc>
<rect width="800" height="520" fill="#FFFFFF"/>
<text x="400" y="34" font-size="20" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Body Fluid Compartments: 60-40-20 Rule</text>
<text x="400" y="56" font-size="12.5" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Volumes and measurement indicators for a reference 70 kg adult male (TBW = 42 L)</text>

<!-- Total Body Water Outer Box -->
<rect x="70" y="90" width="660" height="230" rx="10" fill="#F4F8F6" stroke="#0B6B5B" stroke-width="2.5"/>
<text x="400" y="115" font-size="15" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">TOTAL BODY WATER (TBW) = 60% Body Weight (~42 Litres)</text>
<text x="400" y="132" font-size="11" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Direct measurement: Deuterium oxide (D2O), Tritiated water (THO), Antipyrine</text>

<!-- Left 2/3: Intracellular Fluid (ICF) -->
<rect x="90" y="145" width="410" height="155" rx="8" fill="#EAF3F0" stroke="#0B6B5B" stroke-width="1.8"/>
<text x="295" y="180" font-size="16" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">INTRACELLULAR FLUID (ICF)</text>
<text x="295" y="202" font-size="13" font-weight="600" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">40% Body Weight (~28 L, 2/3 of TBW)</text>
<text x="295" y="230" font-size="11" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Major Cation: K⁺ (Potassium) &amp; Mg²⁺</text>
<text x="295" y="248" font-size="11" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Major Anions: Organic phosphates (ATP) &amp; Proteins</text>
<rect x="180" y="260" width="230" height="26" rx="4" fill="#FFFFFF" stroke="#0B6B5B"/>
<text x="295" y="278" font-size="10.5" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Calculated: ICF = TBW - ECF</text>

<!-- Right 1/3: Extracellular Fluid (ECF) -->
<rect x="520" y="145" width="190" height="155" rx="8" fill="#FBF8EE" stroke="#B7791F" stroke-width="1.8"/>
<text x="615" y="170" font-size="14" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">EXTRACELLULAR (ECF)</text>
<text x="615" y="188" font-size="12" font-weight="600" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">20% Body Weight (~14 L)</text>
<text x="615" y="206" font-size="10" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Major Cation: Na⁺ (Sodium)</text>
<text x="615" y="222" font-size="10" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Major Anions: Cl⁻ &amp; HCO3⁻</text>
<!-- Inulin marker pill -->
<rect x="535" y="235" width="160" height="24" rx="4" fill="#FFFFFF" stroke="#B7791F"/>
<text x="615" y="251" font-size="10" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">Measured by: Inulin, Mannitol</text>

<!-- Subdivided ECF: Interstitial vs Plasma -->
<rect x="525" y="265" width="115" height="30" rx="4" fill="#FFFFFF" stroke="#D0E2DB"/>
<text x="582" y="280" font-size="9.5" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">ISF (15%, ~10.5 L)</text>
<text x="582" y="291" font-size="8.5" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">ECF - Plasma</text>

<rect x="645" y="265" width="60" height="30" rx="4" fill="#FDF2F0" stroke="#B42318"/>
<text x="675" y="280" font-size="9.5" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">Plasma</text>
<text x="675" y="291" font-size="8.5" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">5%, 3.5 L</text>

<!-- Summary Reference Table Below -->
<rect x="70" y="340" width="660" height="135" rx="8" fill="#FFFFFF" stroke="#071318" stroke-width="1.2"/>
<text x="90" y="365" font-size="13" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">Compartment Measurement Markers (Universal Exam High-Yield):</text>

<line x1="70" y1="375" x2="730" y2="375" stroke="#E0ECE8" stroke-width="1"/>
<text x="90" y="395" font-size="11.5" font-weight="700" fill="#0B6B5B" font-family="system-ui,sans-serif">• Total Body Water (TBW):</text>
<text x="270" y="395" font-size="11" fill="#071318" font-family="system-ui,sans-serif">Deuterium oxide (D2O), Tritiated water (THO), Antipyrine</text>

<text x="90" y="418" font-size="11.5" font-weight="700" fill="#B7791F" font-family="system-ui,sans-serif">• Extracellular Fluid (ECF):</text>
<text x="270" y="418" font-size="11" fill="#071318" font-family="system-ui,sans-serif">Inulin (most accurate gold standard), Mannitol, Sodium bromide</text>

<text x="90" y="441" font-size="11.5" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">• Plasma Volume (PV):</text>
<text x="270" y="441" font-size="11" fill="#071318" font-family="system-ui,sans-serif">Evans Blue (T-1824, binds albumin), Radio-iodinated serum albumin (131I-RISA)</text>

<text x="90" y="464" font-size="11.5" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">• Indirect (Calculated):</text>
<text x="270" y="464" font-size="11" font-weight="600" fill="#3D5A54" font-family="system-ui,sans-serif">Interstitial Fluid = ECF - PV  |  Intracellular Fluid = TBW - ECF</text>

<text x="400" y="505" font-size="11" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Inulin passes capillary walls freely but cannot cross cellular plasma membranes; Evans Blue binds albumin and stays intravascular.</text>
</svg>'''
    with open(os.path.join(OUT_DIR, "phy-fluid-compartments.svg"), "w") as f:
        f.write(svg)

def gen_phy_appetite_nuclei():
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" role="img" aria-labelledby="t d">
<title id="t">Hypothalamic Nuclei and Appetite Regulation Pathways</title>
<desc id="d">Schematic of hypothalamic appetite centers showing the lateral hunger center, ventromedial satiety center, and arcuate nucleus integrating peripheral hormonal signals including leptin, ghrelin, insulin, and orexin.</desc>
<rect width="800" height="520" fill="#FFFFFF"/>
<text x="400" y="34" font-size="20" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Hypothalamic Appetite Regulation</text>
<text x="400" y="56" font-size="12.5" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Neural balance between Lateral (Hunger) and Ventromedial (Satiety) Centers</text>

<!-- Arcuate Nucleus in Center Bottom -->
<rect x="250" y="340" width="300" height="90" rx="10" fill="#EAF3F0" stroke="#0B6B5B" stroke-width="2"/>
<text x="400" y="365" font-size="15" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Arcuate Nucleus (Sensory Hub)</text>
<text x="320" y="390" font-size="11" font-weight="700" fill="#0B6B5B" font-family="system-ui,sans-serif">POMC / CART neurons</text>
<text x="320" y="405" font-size="10" fill="#3D5A54" font-family="system-ui,sans-serif">Releases α-MSH (Satiety)</text>
<text x="480" y="390" font-size="11" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">NPY / AgRP neurons</text>
<text x="480" y="405" font-size="10" fill="#3D5A54" font-family="system-ui,sans-serif">Stimulates feeding</text>

<!-- Left: Lateral Hypothalamus (Feeding Center) -->
<rect x="60" y="110" width="280" height="190" rx="10" fill="#FDF2F0" stroke="#B42318" stroke-width="2"/>
<text x="200" y="140" font-size="16" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">LATERAL HYPOTHALAMUS</text>
<text x="200" y="160" font-size="13" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Hunger / Feeding Center</text>
<text x="80" y="190" font-size="11.5" fill="#071318" font-family="system-ui,sans-serif">• Secretes: Orexin / Hypocretin</text>
<text x="80" y="210" font-size="11.5" fill="#071318" font-family="system-ui,sans-serif">• Stimulated by: Ghrelin, NPY</text>
<text x="80" y="230" font-size="11.5" fill="#071318" font-family="system-ui,sans-serif">• Inhibited by: Leptin, α-MSH</text>
<rect x="75" y="245" width="250" height="40" rx="6" fill="#FFFFFF" stroke="#B42318"/>
<text x="200" y="262" font-size="11" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">Bilateral Lesion (Destruction):</text>
<text x="200" y="278" font-size="10.5" font-weight="600" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Aphagia, Anorexia, Starvation</text>

<!-- Right: Ventromedial Hypothalamus (Satiety Center) -->
<rect x="460" y="110" width="280" height="190" rx="10" fill="#F4F8F6" stroke="#0B6B5B" stroke-width="2"/>
<text x="600" y="140" font-size="16" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">VENTROMEDIAL NUCLEUS</text>
<text x="600" y="160" font-size="13" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Satiety Center</text>
<text x="480" y="190" font-size="11.5" fill="#071318" font-family="system-ui,sans-serif">• Stimulated by: Leptin, Insulin, CCK</text>
<text x="480" y="210" font-size="11.5" fill="#071318" font-family="system-ui,sans-serif">• Acts via: Melanocortin-4 receptor (MC4R)</text>
<text x="480" y="230" font-size="11.5" fill="#071318" font-family="system-ui,sans-serif">• Promotes fullness and energy expenditure</text>
<rect x="475" y="245" width="250" height="40" rx="6" fill="#FFFFFF" stroke="#0B6B5B"/>
<text x="600" y="262" font-size="11" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Bilateral Lesion (Destruction):</text>
<text x="600" y="278" font-size="10.5" font-weight="600" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">Hyperphagia, Savage behavior, Morbid Obesity</text>

<!-- Peripheral Hormone Signals (Bottom cards) -->
<line x1="200" y1="340" x2="200" y2="300" stroke="#B42318" stroke-width="2.5" marker-end="url(#arr-rd)"/>
<line x1="600" y1="340" x2="600" y2="300" stroke="#0B6B5B" stroke-width="2.5" marker-end="url(#arr-gr2)"/>
<defs>
<marker id="arr-rd" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L6 3 L0 6 z" fill="#B42318"/></marker>
<marker id="arr-gr2" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L6 3 L0 6 z" fill="#0B6B5B"/></marker>
</defs>

<!-- Peripheral Input Callouts -->
<rect x="60" y="445" width="180" height="45" rx="6" fill="#FDF2F0" stroke="#B42318" stroke-width="1.2"/>
<text x="150" y="465" font-size="11.5" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">Ghrelin (Stomach)</text>
<text x="150" y="480" font-size="10" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Rises pre-meal -> Stimulates Hunger</text>

<rect x="560" y="445" width="180" height="45" rx="6" fill="#F4F8F6" stroke="#0B6B5B" stroke-width="1.2"/>
<text x="650" y="465" font-size="11.5" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Leptin (Adipocytes)</text>
<text x="650" y="480" font-size="10" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Proportional to fat -> Signals Satiety</text>

<text x="400" y="505" font-size="11" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Lateral makes you Lean if lost; Ventromedial makes you Very Massive if lost.</text>
</svg>'''
    with open(os.path.join(OUT_DIR, "phy-appetite-nuclei.svg"), "w") as f:
        f.write(svg)

def gen_phy_stretch_reflex():
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" role="img" aria-labelledby="t d">
<title id="t">Monosynaptic Stretch Reflex Arc and Reciprocal Inhibition</title>
<desc id="d">Neuroanatomical circuit diagram showing the muscle spindle Ia primary sensory afferent synapsing directly onto the alpha motor neuron in the spinal cord ventral horn, alongside reciprocal inhibition of antagonist muscles.</desc>
<rect width="800" height="520" fill="#FFFFFF"/>
<text x="400" y="34" font-size="20" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">The Monosynaptic Stretch (Myotatic) Reflex</text>
<text x="400" y="56" font-size="12.5" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Spinal cord reflex arc: 1 synapse, Ia afferent, alpha motor neuron, and reciprocal inhibition</text>

<!-- Spinal Cord Cross Section Right Side -->
<rect x="420" y="100" width="320" height="340" rx="20" fill="#F4F8F6" stroke="#0B6B5B" stroke-width="2"/>
<text x="580" y="130" font-size="15" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">SPINAL CORD (Grey Matter)</text>

<!-- Dorsal Root Ganglion & Horn -->
<ellipse cx="460" cy="180" rx="18" ry="12" fill="#B7791F"/>
<text x="460" y="184" font-size="9" font-weight="700" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">DRG</text>
<text x="560" y="185" font-size="12" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">Dorsal Horn (Sensory)</text>

<!-- Ventral Horn (Motor) -->
<circle cx="500" cy="320" r="14" fill="#0B6B5B"/>
<text x="500" y="324" font-size="11" font-weight="700" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">α</text>
<text x="530" y="325" font-size="12" font-weight="700" fill="#0B6B5B" font-family="system-ui,sans-serif">Alpha Motor Neuron</text>

<!-- Inhibitory Interneuron -->
<circle cx="500" cy="245" r="10" fill="#B42318"/>
<text x="500" y="249" font-size="9" font-weight="700" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">Ia</text>
<text x="525" y="249" font-size="11" font-weight="600" fill="#B42318" font-family="system-ui,sans-serif">Inhibitory Interneuron (Glycine)</text>

<!-- Antagonist Motor Neuron -->
<circle cx="500" cy="380" r="12" fill="#3D5A54" opacity="0.6"/>
<text x="530" y="384" font-size="11" fill="#3D5A54" font-family="system-ui,sans-serif">Antagonist α-motor neuron (Inhibited)</text>

<!-- Left Side: Quadriceps & Patellar Tendon -->
<!-- Extensor Muscle (Quadriceps) -->
<rect x="60" y="120" width="260" height="90" rx="8" fill="#EAF3F0" stroke="#0B6B5B" stroke-width="1.8"/>
<text x="75" y="145" font-size="13" font-weight="700" fill="#0B6B5B" font-family="system-ui,sans-serif">Agonist Extensor (Quadriceps)</text>
<!-- Muscle spindle inside -->
<ellipse cx="200" cy="170" rx="45" ry="14" fill="#FFFFFF" stroke="#0B6B5B" stroke-width="1.5"/>
<text x="200" y="174" font-size="10.5" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Muscle Spindle (Length)</text>

<!-- Antagonist Muscle (Hamstrings) -->
<rect x="60" y="340" width="260" height="80" rx="8" fill="#FDF2F0" stroke="#B42318" stroke-width="1.8"/>
<text x="75" y="365" font-size="13" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">Antagonist Flexor (Hamstrings)</text>
<text x="75" y="388" font-size="11" fill="#3D5A54" font-family="system-ui,sans-serif">Relaxes via Reciprocal Inhibition</text>

<!-- Nerve Pathways -->
<!-- 1. Ia Afferent (Blue/Teal line) -->
<path d="M 245 170 Q 360 170 442 180" fill="none" stroke="#0B6B5B" stroke-width="3"/>
<path d="M 478 180 Q 520 200 500 306" fill="none" stroke="#0B6B5B" stroke-width="3"/>
<text x="350" y="160" font-size="12" font-weight="700" fill="#0B6B5B" font-family="system-ui,sans-serif">Ia Sensory Afferent</text>

<!-- Synapse directly on alpha neuron -->
<circle cx="500" cy="306" r="4" fill="#0B6B5B"/>
<text x="580" y="295" font-size="10.5" font-weight="700" fill="#0B6B5B" font-family="system-ui,sans-serif">ONLY 1 SYNAPSE (Monosynaptic)</text>

<!-- 2. Alpha Efferent to Quadriceps (Teal thick line back) -->
<path d="M 488 325 Q 360 320 280 205" fill="none" stroke="#0B6B5B" stroke-width="3.5"/>
<text x="320" y="275" font-size="12" font-weight="700" fill="#0B6B5B" font-family="system-ui,sans-serif">α Motor Efferent -> Contracts</text>

<!-- 3. Branch to inhibitory interneuron -->
<path d="M 478 180 Q 485 210 495 235" fill="none" stroke="#B42318" stroke-width="2" stroke-dasharray="3 3"/>
<!-- Interneuron to antagonist -->
<line x1="500" y1="255" x2="500" y2="368" stroke="#B42318" stroke-width="2.5"/>
<!-- Antagonist efferent inhibited -->
<line x1="488" y1="380" x2="320" y2="380" stroke="#B42318" stroke-width="2" stroke-dasharray="4 2"/>

<!-- Clinical Box -->
<rect x="60" y="235" width="220" height="75" rx="6" fill="#FBF8EE" stroke="#B7791F" stroke-width="1.2"/>
<text x="70" y="255" font-size="11.5" font-weight="700" fill="#B7791F" font-family="system-ui,sans-serif">Clinical Example: Knee Jerk</text>
<text x="70" y="272" font-size="10.5" fill="#071318" font-family="system-ui,sans-serif">• Tap patellar tendon -> stretches spindle</text>
<text x="70" y="288" font-size="10.5" fill="#071318" font-family="system-ui,sans-serif">• Quadriceps contracts (L2, L3, L4)</text>
<text x="70" y="302" font-size="10.5" fill="#3D5A54" font-family="system-ui,sans-serif">• Hamstrings relax (reciprocal)</text>

<text x="400" y="505" font-size="11" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">The stretch reflex is monosynaptic for the agonist muscle; reciprocal inhibition of the antagonist muscle is polysynaptic (via an interneuron).</text>
</svg>'''
    with open(os.path.join(OUT_DIR, "phy-stretch-reflex.svg"), "w") as f:
        f.write(svg)

def gen_pharma_nephron_diuretics():
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" role="img" aria-labelledby="t d">
<title id="t">Sites of Diuretic Action Along the Nephron</title>
<desc id="d">Nephron schematic illustrating the sites of action, transporter targets, and clinical classes of diuretics from the proximal convoluted tubule to the collecting duct.</desc>
<rect width="800" height="520" fill="#FFFFFF"/>
<text x="400" y="34" font-size="20" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Sites of Diuretic Action in the Nephron</text>
<text x="400" y="56" font-size="12.5" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Transport mechanisms, efficacy tiers, and electrolyte handling profiles</text>

<!-- 1. PCT -->
<rect x="50" y="90" width="160" height="150" rx="8" fill="#F4F8F6" stroke="#0B6B5B" stroke-width="1.5"/>
<text x="130" y="112" font-size="12.5" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">1. Proximal Tubule (PCT)</text>
<text x="130" y="130" font-size="11" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Acetazolamide</text>
<text x="60" y="152" font-size="10.5" fill="#3D5A54" font-family="system-ui,sans-serif">• Carbonic anhydrase inhibitor</text>
<text x="60" y="170" font-size="10.5" fill="#3D5A54" font-family="system-ui,sans-serif">• Blocks NaHCO3 reabsorption</text>
<text x="60" y="188" font-size="10.5" fill="#B42318" font-family="system-ui,sans-serif">• Risk: Hyperchloraemic acidosis</text>
<text x="60" y="206" font-size="10.5" fill="#071318" font-family="system-ui,sans-serif">• Uses: Glaucoma, altitude sickness</text>
<text x="130" y="230" font-size="10" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Low diuretic efficacy</text>

<!-- 2. Loop of Henle TAL -->
<rect x="230" y="90" width="160" height="150" rx="8" fill="#FDF2F0" stroke="#B42318" stroke-width="1.8"/>
<text x="310" y="112" font-size="12.5" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">2. Thick Ascending (TAL)</text>
<text x="310" y="130" font-size="11" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Loop: Furosemide</text>
<text x="240" y="152" font-size="10.5" fill="#3D5A54" font-family="system-ui,sans-serif">• Inhibits NKCC2 cotransporter</text>
<text x="240" y="170" font-size="10.5" fill="#3D5A54" font-family="system-ui,sans-serif">• Abolishes corticopapillary gradient</text>
<text x="240" y="188" font-size="10.5" fill="#B42318" font-family="system-ui,sans-serif">• Calciuric: increases Ca²⁺ loss</text>
<text x="240" y="206" font-size="10.5" fill="#071318" font-family="system-ui,sans-serif">• Uses: Acute pulmonary oedema</text>
<text x="310" y="230" font-size="10.5" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">High-ceiling (Most potent)</text>

<!-- 3. Early DCT -->
<rect x="410" y="90" width="160" height="150" rx="8" fill="#FBF8EE" stroke="#B7791F" stroke-width="1.5"/>
<text x="490" y="112" font-size="12.5" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">3. Distal Tubule (DCT)</text>
<text x="490" y="130" font-size="11" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Thiazides (HCTZ)</text>
<text x="420" y="152" font-size="10.5" fill="#3D5A54" font-family="system-ui,sans-serif">• Inhibits NCC (Na⁺/Cl⁻) cotransporter</text>
<text x="420" y="170" font-size="10.5" fill="#0B6B5B" font-family="system-ui,sans-serif">• Hypocalciuric: decreases Ca²⁺ loss</text>
<text x="420" y="188" font-size="10.5" fill="#B42318" font-family="system-ui,sans-serif">• Hyperuricemia &amp; hyperglycemia</text>
<text x="420" y="206" font-size="10.5" fill="#071318" font-family="system-ui,sans-serif">• 1st line for essential hypertension</text>
<text x="490" y="230" font-size="10" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">Prevents recurrent renal calculi</text>

<!-- 4. Collecting Tubule / Duct -->
<rect x="590" y="90" width="160" height="150" rx="8" fill="#F4F8F6" stroke="#0B6B5B" stroke-width="1.5"/>
<text x="670" y="112" font-size="12" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">4. Collecting Duct (CCT)</text>
<text x="670" y="130" font-size="11" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">K⁺-Sparing Diuretics</text>
<text x="600" y="152" font-size="10.5" fill="#3D5A54" font-family="system-ui,sans-serif">• Spironolactone: Aldosterone antag</text>
<text x="600" y="170" font-size="10.5" fill="#3D5A54" font-family="system-ui,sans-serif">• Amiloride / Triamterene: Block ENaC</text>
<text x="600" y="188" font-size="10.5" fill="#B42318" font-family="system-ui,sans-serif">• Retains potassium -> Hyperkalaemia</text>
<text x="600" y="206" font-size="10.5" fill="#071318" font-family="system-ui,sans-serif">• Uses: Hepatic ascites, heart failure</text>
<text x="670" y="230" font-size="10" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Saves potassium</text>

<!-- Comparative Electrolyte Summary Table Below -->
<rect x="50" y="260" width="700" height="210" rx="8" fill="#FFFFFF" stroke="#071318" stroke-width="1.2"/>
<text x="400" y="285" font-size="14" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Electrolyte &amp; Metabolic Changes Summary Table</text>
<line x1="50" y1="295" x2="750" y2="295" stroke="#071318" stroke-width="1"/>

<!-- Columns: Class | Na+ loss | K+ | Ca2+ | Uric Acid | pH -->
<text x="70" y="315" font-size="11" font-weight="700" fill="#3D5A54" font-family="system-ui,sans-serif">Diuretic Class</text>
<text x="220" y="315" font-size="11" font-weight="700" fill="#3D5A54" font-family="system-ui,sans-serif">Urinary Na⁺</text>
<text x="320" y="315" font-size="11" font-weight="700" fill="#3D5A54" font-family="system-ui,sans-serif">Serum K⁺</text>
<text x="420" y="315" font-size="11" font-weight="700" fill="#3D5A54" font-family="system-ui,sans-serif">Urinary Ca²⁺</text>
<text x="530" y="315" font-size="11" font-weight="700" fill="#3D5A54" font-family="system-ui,sans-serif">Serum Uric Acid</text>
<text x="660" y="315" font-size="11" font-weight="700" fill="#3D5A54" font-family="system-ui,sans-serif">Blood pH</text>
<line x1="50" y1="325" x2="750" y2="325" stroke="#E0ECE8" stroke-width="1"/>

<text x="70" y="348" font-size="11" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">Loop (Furosemide)</text>
<text x="220" y="348" font-size="11" fill="#B42318" font-family="system-ui,sans-serif">↑↑↑ (25%)</text>
<text x="320" y="348" font-size="11" fill="#B42318" font-family="system-ui,sans-serif">↓ (Hypokalaemia)</text>
<text x="420" y="348" font-size="11" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">↑↑ (Calciuric)</text>
<text x="530" y="348" font-size="11" fill="#071318" font-family="system-ui,sans-serif">↑ (Hyperuricemia)</text>
<text x="660" y="348" font-size="11" fill="#071318" font-family="system-ui,sans-serif">↑ (Alkalosis)</text>

<text x="70" y="378" font-size="11" font-weight="700" fill="#B7791F" font-family="system-ui,sans-serif">Thiazide (HCTZ)</text>
<text x="220" y="378" font-size="11" fill="#B7791F" font-family="system-ui,sans-serif">↑↑ (5-8%)</text>
<text x="320" y="378" font-size="11" fill="#B42318" font-family="system-ui,sans-serif">↓ (Hypokalaemia)</text>
<text x="420" y="378" font-size="11" font-weight="700" fill="#0B6B5B" font-family="system-ui,sans-serif">↓↓ (Hypocalciuric)</text>
<text x="530" y="378" font-size="11" fill="#071318" font-family="system-ui,sans-serif">↑ (Hyperuricemia)</text>
<text x="660" y="378" font-size="11" fill="#071318" font-family="system-ui,sans-serif">↑ (Alkalosis)</text>

<text x="70" y="408" font-size="11" font-weight="700" fill="#0B6B5B" font-family="system-ui,sans-serif">K⁺-Sparing (Spirono)</text>
<text x="220" y="408" font-size="11" fill="#0B6B5B" font-family="system-ui,sans-serif">↑ (2-3%)</text>
<text x="320" y="408" font-size="11" font-weight="700" fill="#0B6B5B" font-family="system-ui,sans-serif">↑↑ (Hyperkalaemia)</text>
<text x="420" y="408" font-size="11" fill="#071318" font-family="system-ui,sans-serif">No change</text>
<text x="530" y="408" font-size="11" fill="#071318" font-family="system-ui,sans-serif">No change</text>
<text x="660" y="408" font-size="11" fill="#B42318" font-family="system-ui,sans-serif">↓ (Acidosis)</text>

<text x="70" y="438" font-size="11" font-weight="700" fill="#3D5A54" font-family="system-ui,sans-serif">Acetazolamide</text>
<text x="220" y="438" font-size="11" fill="#3D5A54" font-family="system-ui,sans-serif">↑ (NaHCO3)</text>
<text x="320" y="438" font-size="11" fill="#B42318" font-family="system-ui,sans-serif">↓ (Wasting)</text>
<text x="420" y="438" font-size="11" fill="#071318" font-family="system-ui,sans-serif">No change</text>
<text x="530" y="438" font-size="11" fill="#071318" font-family="system-ui,sans-serif">No change</text>
<text x="660" y="438" font-size="11" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">↓↓ (Acidosis)</text>

<text x="400" y="505" font-size="11" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Rule: Loop diuretics lose calcium (hypocalcemia risk); thiazide diuretics retain calcium (helpful in osteoporosis and stone prevention).</text>
</svg>'''
    with open(os.path.join(OUT_DIR, "pharma-nephron-diuretics.svg"), "w") as f:
        f.write(svg)

def gen_pharma_raas_pathway():
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" role="img" aria-labelledby="t d">
<title id="t">Renin-Angiotensin-Aldosterone System and Pharmacological Inhibitors</title>
<desc id="d">Stepwise biochemical cascade of the renin-angiotensin-aldosterone axis showing direct renin inhibitors, ACE inhibitors, angiotensin receptor blockers, and aldosterone antagonists with their physiological targets.</desc>
<rect width="800" height="520" fill="#FFFFFF"/>
<text x="400" y="34" font-size="20" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">RAAS Axis and Pharmacological Inhibitors</text>
<text x="400" y="56" font-size="12.5" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Cascade of blood pressure regulation and therapeutic drug blockade targets</text>

<!-- Cascade Blocks Top to Bottom in Center -->
<!-- 1. Angiotensinogen -->
<rect x="260" y="85" width="280" height="40" rx="6" fill="#F4F8F6" stroke="#0B6B5B" stroke-width="1.5"/>
<text x="400" y="110" font-size="14" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Angiotensinogen (Liver)</text>

<line x1="400" y1="125" x2="400" y2="165" stroke="#071318" stroke-width="2.5" marker-end="url(#arr-dn)"/>

<!-- Renin arrow from JG cells -->
<text x="210" y="145" font-size="12" font-weight="700" text-anchor="end" fill="#0B6B5B" font-family="system-ui,sans-serif">Renin (JG cells)</text>
<line x1="220" y1="145" x2="390" y2="145" stroke="#0B6B5B" stroke-width="2"/>
<!-- Aliskiren inhibitor -->
<rect x="50" y="130" width="120" height="30" rx="4" fill="#FDF2F0" stroke="#B42318"/>
<text x="110" y="150" font-size="11" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">X: Aliskiren</text>

<!-- 2. Angiotensin I -->
<rect x="260" y="165" width="280" height="40" rx="6" fill="#F4F8F6" stroke="#0B6B5B" stroke-width="1.5"/>
<text x="400" y="190" font-size="14" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Angiotensin I (Decapeptide)</text>

<line x1="400" y1="205" x2="400" y2="255" stroke="#071318" stroke-width="2.5" marker-end="url(#arr-dn)"/>

<!-- ACE arrow from lungs -->
<text x="210" y="230" font-size="12" font-weight="700" text-anchor="end" fill="#0B6B5B" font-family="system-ui,sans-serif">ACE (Pulmonary)</text>
<line x1="220" y1="230" x2="390" y2="230" stroke="#0B6B5B" stroke-width="2"/>
<!-- ACE-I inhibitor & Bradykinin -->
<rect x="50" y="215" width="120" height="30" rx="4" fill="#FDF2F0" stroke="#B42318"/>
<text x="110" y="235" font-size="11" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">X: ACE Inhibitors</text>
<rect x="580" y="215" width="170" height="45" rx="6" fill="#FBF8EE" stroke="#B7791F"/>
<text x="665" y="233" font-size="11" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">Bradykinin breakdown ↓</text>
<text x="665" y="248" font-size="10" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">Cough &amp; Angioedema risk</text>

<!-- 3. Angiotensin II -->
<rect x="260" y="255" width="280" height="40" rx="6" fill="#FDF2F0" stroke="#B42318" stroke-width="2"/>
<text x="400" y="280" font-size="15" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">Angiotensin II (Octapeptide)</text>

<!-- Branches from Ang II -->
<!-- Left: Vasoconstriction via AT1 -->
<path d="M 330 295 L 200 340" fill="none" stroke="#071318" stroke-width="2" marker-end="url(#arr-dn)"/>
<rect x="80" y="340" width="220" height="90" rx="8" fill="#FFFFFF" stroke="#071318" stroke-width="1.2"/>
<text x="190" y="362" font-size="12.5" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">AT1 Receptor Activation</text>
<text x="95" y="385" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Potent arteriolar vasoconstriction</text>
<text x="95" y="403" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Efferent renal arteriolar constriction</text>
<text x="95" y="420" font-size="11" fill="#3D5A54" font-family="system-ui,sans-serif">• Sympathetic nervous activation</text>

<!-- ARB Inhibitor card -->
<rect x="50" y="295" width="140" height="30" rx="4" fill="#FDF2F0" stroke="#B42318"/>
<text x="120" y="315" font-size="11" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">X: ARBs (Losartan)</text>

<!-- Right: Adrenal Cortex -> Aldosterone -->
<path d="M 470 295 L 600 340" fill="none" stroke="#071318" stroke-width="2" marker-end="url(#arr-dn)"/>
<rect x="500" y="340" width="240" height="90" rx="8" fill="#FBF8EE" stroke="#B7791F" stroke-width="1.2"/>
<text x="620" y="362" font-size="12.5" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">Aldosterone (Zona Glomerulosa)</text>
<text x="515" y="385" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Acts on Principle Cells in CCT</text>
<text x="515" y="403" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Na⁺ &amp; H2O reabsorption -> Raises BP</text>
<text x="515" y="420" font-size="11" fill="#B42318" font-family="system-ui,sans-serif">• K⁺ &amp; H⁺ secretion into urine</text>

<!-- Spironolactone Blockade -->
<rect x="550" y="435" width="190" height="30" rx="4" fill="#FDF2F0" stroke="#B42318"/>
<text x="645" y="455" font-size="11" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">X: Spironolactone / Eplerenone</text>

<!-- Fetal toxicity warning -->
<rect x="80" y="440" width="360" height="30" rx="4" fill="#FDF2F0" stroke="#B42318"/>
<text x="260" y="460" font-size="10.5" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">Contraindication: ACE-I &amp; ARBs are fetotoxic in pregnancy</text>

<text x="400" y="505" font-size="11" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">ACE inhibitors preferentially dilate the efferent arteriole, reducing glomerular filtration pressure and slowing diabetic nephropathy.</text>
</svg>'''
    with open(os.path.join(OUT_DIR, "pharma-raas-pathway.svg"), "w") as f:
        f.write(svg)

def gen_path_necrosis_patterns():
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" role="img" aria-labelledby="t d">
<title id="t">Morphological Patterns of Tissue Necrosis</title>
<desc id="d">Comparative pathological guide to the six classic patterns of necrosis: coagulative, liquefactive, caseous, fat, fibrinoid, and gangrenous necrosis, with histological characteristics and clinical examples.</desc>
<rect width="800" height="520" fill="#FFFFFF"/>
<text x="400" y="34" font-size="20" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Morphological Patterns of Necrosis</text>
<text x="400" y="56" font-size="12.5" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Histological hallmarks, mechanisms, and high-yield clinical prototypes</text>

<!-- 6 Cards Grid: 3 top, 3 bottom -->
<!-- 1. Coagulative -->
<rect x="50" y="80" width="220" height="185" rx="8" fill="#F4F8F6" stroke="#0B6B5B" stroke-width="1.5"/>
<text x="160" y="105" font-size="13.5" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">1. Coagulative Necrosis</text>
<text x="65" y="128" font-size="11" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">Mechanism:</text>
<text x="65" y="144" font-size="10.5" fill="#3D5A54" font-family="system-ui,sans-serif">Protein denaturation exceeds digestion</text>
<text x="65" y="165" font-size="11" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">Histology:</text>
<text x="65" y="181" font-size="10.5" fill="#071318" font-family="system-ui,sans-serif">• Preserved tissue architecture</text>
<text x="65" y="197" font-size="10.5" fill="#071318" font-family="system-ui,sans-serif">• Anucleate "tombstone" ghost cells</text>
<text x="65" y="218" font-size="11" font-weight="700" fill="#0B6B5B" font-family="system-ui,sans-serif">Clinical Prototype:</text>
<text x="65" y="234" font-size="10.5" fill="#071318" font-family="system-ui,sans-serif">Infarcts in all solid organs (EXCEPT brain)</text>
<text x="65" y="248" font-size="10" fill="#3D5A54" font-family="system-ui,sans-serif">e.g. Myocardial, kidney, splenic infarct</text>

<!-- 2. Liquefactive -->
<rect x="290" y="80" width="220" height="185" rx="8" fill="#FDF2F0" stroke="#B42318" stroke-width="1.5"/>
<text x="400" y="105" font-size="13.5" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">2. Liquefactive Necrosis</text>
<text x="305" y="128" font-size="11" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">Mechanism:</text>
<text x="305" y="144" font-size="10.5" fill="#3D5A54" font-family="system-ui,sans-serif">Enzymatic lysis digests tissue into liquid</text>
<text x="305" y="165" font-size="11" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">Histology:</text>
<text x="305" y="181" font-size="10.5" fill="#071318" font-family="system-ui,sans-serif">• Loss of cellular architecture</text>
<text x="305" y="197" font-size="10.5" fill="#071318" font-family="system-ui,sans-serif">• Cystic space filled with debris / pus</text>
<text x="305" y="218" font-size="11" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">Clinical Prototype:</text>
<text x="305" y="234" font-size="10.5" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">• Brain infarcts (stroke)</text>
<text x="305" y="248" font-size="10" fill="#3D5A54" font-family="system-ui,sans-serif">• Bacterial &amp; fungal abscesses</text>

<!-- 3. Caseous -->
<rect x="530" y="80" width="220" height="185" rx="8" fill="#FBF8EE" stroke="#B7791F" stroke-width="1.5"/>
<text x="640" y="105" font-size="13.5" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">3. Caseous Necrosis</text>
<text x="545" y="128" font-size="11" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">Mechanism:</text>
<text x="545" y="144" font-size="10.5" fill="#3D5A54" font-family="system-ui,sans-serif">Combination of coagulative + liquefactive</text>
<text x="545" y="165" font-size="11" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">Histology:</text>
<text x="545" y="181" font-size="10.5" fill="#071318" font-family="system-ui,sans-serif">• Acellular pink amorphous debris</text>
<text x="545" y="197" font-size="10.5" fill="#071318" font-family="system-ui,sans-serif">• Granuloma rim (Langhans cells)</text>
<text x="545" y="218" font-size="11" font-weight="700" fill="#B7791F" font-family="system-ui,sans-serif">Clinical Prototype:</text>
<text x="545" y="234" font-size="10.5" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">Tuberculosis (TB)</text>
<text x="545" y="248" font-size="10" fill="#3D5A54" font-family="system-ui,sans-serif">Gross: friable, white "cottage cheese"</text>

<!-- 4. Fat Necrosis -->
<rect x="50" y="280" width="220" height="185" rx="8" fill="#F4F8F6" stroke="#0B6B5B" stroke-width="1.5"/>
<text x="160" y="305" font-size="13.5" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">4. Fat Necrosis</text>
<text x="65" y="328" font-size="11" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">Mechanism:</text>
<text x="65" y="344" font-size="10.5" fill="#3D5A54" font-family="system-ui,sans-serif">Lipase action + calcium saponification</text>
<text x="65" y="365" font-size="11" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">Histology:</text>
<text x="65" y="381" font-size="10.5" fill="#071318" font-family="system-ui,sans-serif">• Shadowy necrotic adipocytes</text>
<text x="65" y="397" font-size="10.5" fill="#071318" font-family="system-ui,sans-serif">• Basophilic calcium soap deposits</text>
<text x="65" y="418" font-size="11" font-weight="700" fill="#0B6B5B" font-family="system-ui,sans-serif">Clinical Prototype:</text>
<text x="65" y="434" font-size="10.5" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">Acute Pancreatitis</text>
<text x="65" y="448" font-size="10" fill="#3D5A54" font-family="system-ui,sans-serif">Trauma to breast (chalky white spots)</text>

<!-- 5. Fibrinoid -->
<rect x="290" y="280" width="220" height="185" rx="8" fill="#FDF2F0" stroke="#B42318" stroke-width="1.5"/>
<text x="400" y="305" font-size="13.5" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">5. Fibrinoid Necrosis</text>
<text x="305" y="328" font-size="11" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">Mechanism:</text>
<text x="305" y="344" font-size="10.5" fill="#3D5A54" font-family="system-ui,sans-serif">Immune complexes + leaked fibrin in walls</text>
<text x="305" y="365" font-size="11" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">Histology:</text>
<text x="305" y="381" font-size="10.5" fill="#071318" font-family="system-ui,sans-serif">• Smudgy bright pink arterial walls</text>
<text x="305" y="397" font-size="10.5" fill="#071318" font-family="system-ui,sans-serif">• Eosinophilic proteinaceous coat</text>
<text x="305" y="418" font-size="11" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">Clinical Prototype:</text>
<text x="305" y="434" font-size="10.5" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">Polyarteritis Nodosa (PAN)</text>
<text x="305" y="448" font-size="10" fill="#3D5A54" font-family="system-ui,sans-serif">Malignant hypertension, Preeclampsia</text>

<!-- 6. Gangrenous -->
<rect x="530" y="280" width="220" height="185" rx="8" fill="#FBF8EE" stroke="#B7791F" stroke-width="1.5"/>
<text x="640" y="305" font-size="13.5" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">6. Gangrenous Necrosis</text>
<text x="545" y="328" font-size="11" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">Mechanism:</text>
<text x="545" y="344" font-size="10.5" fill="#3D5A54" font-family="system-ui,sans-serif">Ischaemic coagulative + bacterial superinfection</text>
<text x="545" y="365" font-size="11" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">Subtypes:</text>
<text x="545" y="381" font-size="10.5" fill="#071318" font-family="system-ui,sans-serif">• Dry gangrene: mummified, clear line</text>
<text x="545" y="397" font-size="10.5" fill="#071318" font-family="system-ui,sans-serif">• Wet gangrene: liquefactive, foul odor</text>
<text x="545" y="418" font-size="11" font-weight="700" fill="#B7791F" font-family="system-ui,sans-serif">Clinical Prototype:</text>
<text x="545" y="434" font-size="10.5" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">Diabetic Lower Limb Foot</text>
<text x="545" y="448" font-size="10" fill="#3D5A54" font-family="system-ui,sans-serif">Bowel volvulus / mesenteric ischemia</text>

<text x="400" y="505" font-size="11" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">All brain infarcts undergo liquefactive necrosis due to rich lipid content and hydrolytic enzyme release from microglia.</text>
</svg>'''
    with open(os.path.join(OUT_DIR, "path-necrosis-patterns.svg"), "w") as f:
        f.write(svg)

def gen_bio_etc_complexes():
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" role="img" aria-labelledby="t d">
<title id="t">Mitochondrial Electron Transport Chain Complexes and Inhibitors</title>
<desc id="d">Biochemical pathway diagram of the inner mitochondrial membrane showing respiratory complexes I through IV, ATP synthase (complex V), proton pumping into the intermembrane space, and specific pharmacological and poison inhibitors.</desc>
<rect width="800" height="520" fill="#FFFFFF"/>
<text x="400" y="34" font-size="20" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Electron Transport Chain and Oxidative Phosphorylation</text>
<text x="400" y="56" font-size="12.5" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Inner mitochondrial membrane complexes, proton gradient generation, and toxic inhibitors</text>

<!-- Intermembrane space (Top, Acidic H+) -->
<rect x="50" y="80" width="700" height="60" fill="#FDF2F0" opacity="0.6"/>
<text x="70" y="105" font-size="13" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">INTERMEMBRANE SPACE (High H⁺, Electrochemical Gradient)</text>
<text x="70" y="125" font-size="11" fill="#3D5A54" font-family="system-ui,sans-serif">Protons pumped across generate proton motive force (Δψ + ΔpH)</text>

<!-- Inner Mitochondrial Membrane Strip -->
<rect x="50" y="140" width="700" height="130" fill="#EAF3F0" stroke="#0B6B5B" stroke-width="2"/>
<text x="70" y="160" font-size="11" font-weight="700" fill="#0B6B5B" font-family="system-ui,sans-serif">Inner Mitochondrial Membrane (Cardiolipin rich, impermeable to H⁺)</text>

<!-- Complex I -->
<rect x="90" y="170" width="85" height="90" rx="6" fill="#0B6B5B"/>
<text x="132" y="200" font-size="13" font-weight="700" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">Complex I</text>
<text x="132" y="218" font-size="9" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">NADH Dehyd.</text>
<text x="132" y="235" font-size="10" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">Pumps 4 H⁺</text>

<!-- Complex II -->
<rect x="210" y="190" width="75" height="70" rx="6" fill="#0B6B5B" opacity="0.85"/>
<text x="247" y="218" font-size="12" font-weight="700" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">Complex II</text>
<text x="247" y="234" font-size="8.5" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">Succinate Dehyd.</text>
<text x="247" y="248" font-size="9" font-weight="700" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">(0 H⁺ pumped)</text>

<!-- CoQ (Ubiquinone) -->
<circle cx="320" cy="205" r="16" fill="#B7791F"/>
<text x="320" y="210" font-size="10" font-weight="700" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">CoQ</text>

<!-- Complex III -->
<rect x="370" y="170" width="85" height="90" rx="6" fill="#0B6B5B"/>
<text x="412" y="200" font-size="13" font-weight="700" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">Complex III</text>
<text x="412" y="218" font-size="9" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">Cyt bc1</text>
<text x="412" y="235" font-size="10" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">Pumps 4 H⁺</text>

<!-- Cyt c -->
<circle cx="490" cy="155" r="15" fill="#B7791F"/>
<text x="490" y="159" font-size="10" font-weight="700" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">Cyt c</text>

<!-- Complex IV -->
<rect x="535" y="170" width="85" height="90" rx="6" fill="#0B6B5B"/>
<text x="577" y="200" font-size="13" font-weight="700" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">Complex IV</text>
<text x="577" y="218" font-size="9" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">Cyt c Oxidase</text>
<text x="577" y="235" font-size="10" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">Pumps 2 H⁺</text>

<!-- Complex V: ATP Synthase -->
<rect x="655" y="155" width="80" height="110" rx="8" fill="#16383E" stroke="#FFFFFF" stroke-width="1.5"/>
<text x="695" y="195" font-size="13" font-weight="700" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">Complex V</text>
<text x="695" y="212" font-size="9" text-anchor="middle" fill="#FFFFFF" font-family="system-ui,sans-serif">ATP Synthase</text>
<text x="695" y="235" font-size="10" font-weight="700" text-anchor="middle" fill="#42CDB5" font-family="system-ui,sans-serif">ADP -> ATP</text>

<!-- H+ flow down into Complex V -->
<line x1="695" y1="125" x2="695" y2="150" stroke="#42CDB5" stroke-width="3" marker-end="url(#arr-gr3)"/>
<defs><marker id="arr-gr3" viewBox="0 0 6 6" refX="3" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L3 6 L6 0 z" fill="#42CDB5"/></marker></defs>

<!-- Mitochondrial Matrix (Bottom) -->
<text x="70" y="295" font-size="13" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">MITOCHONDRIAL MATRIX (Krebs Cycle / β-Oxidation)</text>
<text x="132" y="320" font-size="11" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">NADH -> NAD⁺</text>
<text x="247" y="320" font-size="11" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">FADH2 -> FAD</text>
<text x="577" y="320" font-size="11" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">½ O2 -> H2O</text>

<!-- Inhibitor Reference Grid Below -->
<rect x="50" y="345" width="700" height="135" rx="8" fill="#FFFFFF" stroke="#B42318" stroke-width="1.5"/>
<text x="70" y="370" font-size="13" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">Classic ETC Inhibitors and Uncouplers (Universal Exam High-Yield):</text>
<line x1="50" y1="380" x2="750" y2="380" stroke="#FDF2F0" stroke-width="1.5"/>

<text x="70" y="402" font-size="11.5" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">• Complex I Inhibitors:</text>
<text x="240" y="402" font-size="11" fill="#3D5A54" font-family="system-ui,sans-serif">Rotenone (pesticide), Amobarbital (barbiturate), Metformin (mild)</text>

<text x="70" y="422" font-size="11.5" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">• Complex III Inhibitors:</text>
<text x="240" y="422" font-size="11" fill="#3D5A54" font-family="system-ui,sans-serif">Antimycin A</text>

<text x="70" y="442" font-size="11.5" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">• Complex IV Inhibitors:</text>
<text x="240" y="442" font-size="11" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">Cyanide (CN⁻), Carbon Monoxide (CO), Sodium Azide (NaN3), H2S</text>

<text x="70" y="462" font-size="11.5" font-weight="700" fill="#B7791F" font-family="system-ui,sans-serif">• Complex V &amp; Uncouplers:</text>
<text x="240" y="462" font-size="11" fill="#071318" font-family="system-ui,sans-serif">Oligomycin blocks Fo; 2,4-DNP, Aspirin, &amp; Thermogenin (UCP-1) dissipate H⁺ gradient as heat</text>

<text x="400" y="505" font-size="11" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Cyanide and CO inhibit Complex IV (Cytochrome c oxidase), halting ATP synthesis; uncouplers dissipate the gradient, causing hyperthermia.</text>
</svg>'''
    with open(os.path.join(OUT_DIR, "bio-etc-complexes.svg"), "w") as f:
        f.write(svg)

def gen_micro_viral_structure():
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" role="img" aria-labelledby="t d">
<title id="t">Virion Architecture: Naked versus Enveloped Viruses</title>
<desc id="d">Structural comparison of non-enveloped (naked) versus enveloped viruses, showing nucleic acid core, protein capsid, lipid bilayer envelope, glycoprotein spikes, and physical resistance differences.</desc>
<rect width="800" height="520" fill="#FFFFFF"/>
<text x="400" y="34" font-size="20" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Virion Structure: Naked vs Enveloped</text>
<text x="400" y="56" font-size="12.5" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Capsid symmetry, lipid envelope properties, and environmental stability rules</text>

<!-- Center divider -->
<line x1="400" y1="85" x2="400" y2="450" stroke="#E0ECE8" stroke-width="2" stroke-dasharray="6 4"/>

<!-- Left Side: Naked (Non-enveloped) -->
<text x="210" y="105" font-size="16" font-weight="700" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Naked (Non-Enveloped) Virus</text>
<text x="210" y="123" font-size="11.5" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Nucleic acid + Protein capsid only</text>

<!-- Naked Virion Diagram -->
<!-- Icosahedral Capsid -->
<polygon points="210,145 285,185 285,255 210,295 135,255 135,185" fill="#EAF3F0" stroke="#0B6B5B" stroke-width="3"/>
<!-- Genome core (DNA/RNA) -->
<path d="M 175 220 Q 210 180 210 220 T 245 220" fill="none" stroke="#071318" stroke-width="3"/>
<text x="210" y="245" font-size="11" font-weight="700" text-anchor="middle" fill="#071318" font-family="system-ui,sans-serif">Viral Genome (DNA/RNA)</text>
<text x="210" y="170" font-size="11" font-weight="600" text-anchor="middle" fill="#0B6B5B" font-family="system-ui,sans-serif">Protein Capsid (Capsomeres)</text>

<!-- Properties Card Left -->
<rect x="50" y="315" width="320" height="145" rx="8" fill="#F4F8F6" stroke="#0B6B5B" stroke-width="1.5"/>
<text x="65" y="338" font-size="12" font-weight="700" fill="#0B6B5B" font-family="system-ui,sans-serif">Physical &amp; Clinical Properties:</text>
<text x="65" y="358" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Stable to heat, acid, drying, bile, and detergents</text>
<text x="65" y="376" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Can survive the gastrointestinal tract</text>
<text x="65" y="394" font-size="11" font-weight="700" fill="#0B6B5B" font-family="system-ui,sans-serif">• Transmission: Fecal-oral route, fomites</text>
<text x="65" y="414" font-size="11" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">Examples:</text>
<text x="65" y="430" font-size="10.5" fill="#3D5A54" font-family="system-ui,sans-serif">Poliovirus, Rhinovirus, Norovirus, HAV, HEV, Adenovirus, Rotavirus, Parvovirus B19</text>

<!-- Right Side: Enveloped -->
<text x="590" y="105" font-size="16" font-weight="700" text-anchor="middle" fill="#B42318" font-family="system-ui,sans-serif">Enveloped Virus</text>
<text x="590" y="123" font-size="11.5" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">Capsid + Host-derived lipid bilayer + Spikes</text>

<!-- Enveloped Virion Diagram -->
<!-- Outer Envelope Circle with Spikes -->
<circle cx="590" cy="220" r="75" fill="#FDF2F0" stroke="#B42318" stroke-width="2.5"/>
<!-- Spikes radiating out -->
<line x1="590" y1="145" x2="590" y2="130" stroke="#B7791F" stroke-width="3"/>
<circle cx="590" cy="126" r="4" fill="#B7791F"/>
<line x1="590" y1="295" x2="590" y2="310" stroke="#B7791F" stroke-width="3"/>
<circle cx="590" cy="314" r="4" fill="#B7791F"/>
<line x1="515" y1="220" x2="500" y2="220" stroke="#B7791F" stroke-width="3"/>
<circle cx="496" cy="220" r="4" fill="#B7791F"/>
<line x1="665" y1="220" x2="680" y2="220" stroke="#B7791F" stroke-width="3"/>
<circle cx="684" cy="220" r="4" fill="#B7791F"/>

<!-- Inner Capsid -->
<polygon points="590,175 635,198 635,242 590,265 545,242 545,198" fill="#EAF3F0" stroke="#0B6B5B" stroke-width="2"/>
<!-- Genome core -->
<path d="M 570 220 Q 590 195 590 220 T 610 220" fill="none" stroke="#071318" stroke-width="2.5"/>
<text x="590" y="160" font-size="10.5" font-weight="700" text-anchor="middle" fill="#B7791F" font-family="system-ui,sans-serif">Glycoprotein Spike (Hemagglutinin)</text>

<!-- Properties Card Right -->
<rect x="430" y="315" width="320" height="145" rx="8" fill="#FDF2F0" stroke="#B42318" stroke-width="1.5"/>
<text x="445" y="338" font-size="12" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">Physical &amp; Clinical Properties:</text>
<text x="445" y="358" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• LABILE: Disrupted by acid, detergents, drying, ether</text>
<text x="445" y="376" font-size="11" fill="#071318" font-family="system-ui,sans-serif">• Must stay wet; destroyed by stomach gastric acid</text>
<text x="445" y="394" font-size="11" font-weight="700" fill="#B42318" font-family="system-ui,sans-serif">• Transmission: Respiratory droplets, blood, secretions</text>
<text x="445" y="414" font-size="11" font-weight="700" fill="#071318" font-family="system-ui,sans-serif">Examples:</text>
<text x="445" y="430" font-size="10.5" fill="#3D5A54" font-family="system-ui,sans-serif">Influenza, HIV, Herpesviruses (HSV/VZV/EBV), HBV, HCV, Rabies, Coronaviruses</text>

<text x="400" y="505" font-size="11" font-weight="400" text-anchor="middle" fill="#3D5A54" font-family="system-ui,sans-serif">All negative-sense RNA viruses are enveloped; ether sensitivity proves the presence of a lipid envelope.</text>
</svg>'''
    with open(os.path.join(OUT_DIR, "micro-viral-structure.svg"), "w") as f:
        f.write(svg)

if __name__ == "__main__":
    print("Generating 15 high-yield medical SVGs...")
    gen_ana_trilaminar_disc()
    gen_ana_epiploic_foramen()
    gen_ana_thyroid_relations()
    gen_ana_carotid_branches()
    gen_ana_twinning_timing()
    gen_ana_allens_test()
    gen_phy_acid_base_map()
    gen_phy_fluid_compartments()
    gen_phy_appetite_nuclei()
    gen_phy_stretch_reflex()
    gen_pharma_nephron_diuretics()
    gen_pharma_raas_pathway()
    gen_path_necrosis_patterns()
    gen_bio_etc_complexes()
    gen_micro_viral_structure()
    print("Done. All 15 SVGs written to prep/lessons/media/")
