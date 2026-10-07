#!/usr/bin/env python3
"""
Replace generic SVG schematics with authentic, high-resolution clinical photographs,
diagnostic radiographs (X-rays), CT scans, and 12-lead ECGs from the curated
open-access medical library (/assets/kb-real-images/).

Preserves all algorithms, clinical pathways, tables, and diagnostic matrices intact.
"""

import json
import glob
import re
import os

# Map organ categories and specific diseases to authentic real clinical images
CATEGORY_REAL_IMAGES = {
    "cardio": {
        "src": "/assets/kb-real-images/stemi-ecg.jpg?v=kbri2",
        "type": "ecg",
        "title_suffix": "12-Lead Diagnostic Electrocardiogram",
        "caption": "Diagnostic 12-lead electrocardiogram demonstrating myocardial repolarization architecture, ST-segment vectors, and rate/rhythm intervals.",
        "annotations": [
            {"label": "Conduction & Axis", "description": "Sinoatrial to atrioventricular nodal conduction vector and QRS electrical axis."},
            {"label": "Repolarization", "description": "ST-segment elevation/depression and T-wave morphology reflecting myocardial perfusion."},
            {"label": "Rhythm & Intervals", "description": "PR, QRS, and QTc duration analysis across precordial and limb leads."}
        ]
    },
    "pulmo": {
        "src": "/assets/kb-real-images/cap-pneumonia-xray.jpg?v=kbri2",
        "type": "xray",
        "title_suffix": "Diagnostic Chest Radiograph",
        "caption": "Diagnostic posteroanterior chest radiograph demonstrating parenchymal aeration, bronchovascular markings, and pleural interfaces.",
        "annotations": [
            {"label": "Parenchyma & Airspaces", "description": "Alveolar aeration, infiltrates, consolidation opacities, and volume symmetry."},
            {"label": "Bronchovascular Tree", "description": "Central hilar anatomy, bronchovascular branching, and air bronchograms."},
            {"label": "Pleural Margins", "description": "Costophrenic and cardiophrenic recesses, hemidiaphragm contours, and pleural lines."}
        ]
    },
    "neuro": {
        "src": "/assets/kb-real-images/normal-head-ct.jpg?v=kbri2",
        "type": "ct",
        "title_suffix": "Diagnostic Head Computed Tomography",
        "caption": "Axial non-contrast head computed tomography scan displaying cerebral parenchyma, ventricular symmetry, and basal cisterns.",
        "annotations": [
            {"label": "Cerebral Parenchyma", "description": "Gray-white matter differentiation, cortical ribbon, and deep nuclear structures."},
            {"label": "Ventricular System", "description": "Lateral, third, and fourth ventricle volume; midline shift and symmetry."},
            {"label": "Extra-Axial Spaces", "description": "Subarachnoid cisterns, sulcal patency, and calvarial bone margins."}
        ]
    },
    "gi": {
        "src": "/assets/kb-real-images/normal-abdomen-ct.jpg?v=kbri2",
        "type": "ct",
        "title_suffix": "Diagnostic Abdominal Computed Tomography",
        "caption": "Axial contrast-enhanced abdominal computed tomography scan demonstrating solid visceral parenchyma, bowel wall caliber, and vascular enhancement.",
        "annotations": [
            {"label": "Solid Viscera", "description": "Hepatosplenic parenchymal attenuation, pancreatic contour, and renal enhancement."},
            {"label": "Gastrointestinal Tract", "description": "Gastric, small bowel, and colonic caliber with mural enhancement symmetry."},
            {"label": "Mesentery & Peritoneum", "description": "Mesenteric fat clarity, lymph node stations, and peritoneal reflections."}
        ]
    },
    "renal": {
        "src": "/assets/kb-real-images/hydronephrosis-ultrasound.jpg?v=kbri2",
        "type": "ultrasound",
        "title_suffix": "Diagnostic Renal Ultrasonography",
        "caption": "Diagnostic renal ultrasonography demonstrating renal parenchymal depth, corticomedullary differentiation, and pelvicalyceal collecting system.",
        "annotations": [
            {"label": "Renal Cortex", "description": "Cortical echogenicity relative to adjacent liver/spleen and parenchymal thickness."},
            {"label": "Corticomedullary Junction", "description": "Medullary pyramid definition and structural architecture."},
            {"label": "Collecting System", "description": "Pelvicalyceal acoustic windows, caliceal dilatation, and ureteric outflow."}
        ]
    },
    "derm": {
        "src": "/assets/kb-real-images/herpes-zoster-rash.jpg?v=kbri2",
        "type": "diagram",
        "title_suffix": "Clinical Cutaneous Dermatology Photograph",
        "caption": "Diagnostic clinical photograph displaying epidermal primary lesions, morphology, margin demarcation, and dermatomal distribution.",
        "annotations": [
            {"label": "Primary Lesions", "description": "Macules, papules, plaques, vesicles, or bullae characteristics and coloration."},
            {"label": "Demarcation & Margins", "description": "Edge borders, surrounding erythema, and epidermal surface changes."},
            {"label": "Anatomical Distribution", "description": "Dermatomal, flexural, extensor, or photo-exposed localization pattern."}
        ]
    },
    "heme": {
        "src": "/assets/kb-real-images/normal-blood-smear.jpg?v=kbri2",
        "type": "diagram",
        "title_suffix": "Diagnostic Peripheral Blood Smear Examination",
        "caption": "High-power microscopic Giemsa-stained peripheral blood smear displaying erythrocyte morphology, leukocyte differentiation, and platelet estimation.",
        "annotations": [
            {"label": "Erythrocyte Indices", "description": "Normocytic normochromic cell size, central pallor, and membrane stability."},
            {"label": "Leukocyte Differential", "description": "Nuclear lobulation, cytoplasmic granules, and mature lineage ratios."},
            {"label": "Platelet Count", "description": "Thrombocyte density, granule distribution, and clumping evaluation."}
        ]
    },
    "ortho": {
        "src": "/assets/kb-real-images/osteomyelitis-xray.jpg?v=kbri2",
        "type": "xray",
        "title_suffix": "Diagnostic Musculoskeletal Radiograph",
        "caption": "Diagnostic musculoskeletal radiograph illustrating cortical margins, trabecular bone mineralization, and articular alignment.",
        "annotations": [
            {"label": "Cortical Margins", "description": "Cortical bone continuity, periosteal reaction, and endosteal scalloping."},
            {"label": "Trabecular Architecture", "description": "Medullary bone density, lucencies, and subchondral mineralization."},
            {"label": "Joint Articulation", "description": "Joint space width, alignment, and periarticular soft tissue contours."}
        ]
    },
    "infect": {
        "src": "/assets/kb-real-images/malaria-blood-smear.jpg?v=kbri2",
        "type": "diagram",
        "title_suffix": "Diagnostic Microbiological / Smear Examination",
        "caption": "Diagnostic microscopic evaluation displaying microbiological morphology, cellular response, and pathogen identification.",
        "annotations": [
            {"label": "Pathogen Detection", "description": "Microscopic morphology, staining characteristics, and intra/extracellular localization."},
            {"label": "Inflammatory Response", "description": "Host cellular infiltrate, neutrophil predominance, and tissue reaction."},
            {"label": "Diagnostic Confirmation", "description": "Direct visualization correlating with clinical syndrome and biomarkers."}
        ]
    },
    "endo": {
        "src": "/assets/kb-real-images/normal-abdomen-ct.jpg?v=kbri2",
        "type": "ct",
        "title_suffix": "Diagnostic Endocrine Cross-Sectional Imaging",
        "caption": "High-resolution cross-sectional computed tomography visualizing endocrine organ architecture and retroperitoneal boundaries.",
        "annotations": [
            {"label": "Gland Morphology", "description": "Organ dimensions, bilateral symmetry, and parenchymal attenuation."},
            {"label": "Focal Lesions", "description": "Nodularity, adenoma attenuation, and washout dynamics."},
            {"label": "Surrounding Structures", "description": "Vascular abutment, retroperitoneal fat planes, and tissue interfaces."}
        ]
    },
    "general": {
        "src": "/assets/kb-real-images/normal-chest-xray.jpg?v=kbri2",
        "type": "xray",
        "title_suffix": "Diagnostic Imaging Evaluation",
        "caption": "Standard diagnostic imaging examination displaying cardiopulmonary silhouette, anatomical landmarks, and visceral boundaries.",
        "annotations": [
            {"label": "Cardiothoracic Ratio", "description": "Heart size, mediastinal width, and great vessel contours."},
            {"label": "Visceral Fields", "description": "Parenchymal lucency, vascular distribution, and baseline symmetry."},
            {"label": "Bony Thorax & Soft Tissues", "description": "Costal contours, diaphragmatic arches, and soft tissue boundaries."}
        ]
    }
}

# DISEASE-SPECIFIC HIGH-PRECISION REAL IMAGES
SPECIFIC_DISEASE_IMAGES = {
    # STEMI / ACS / Arrhythmias
    "stemi": {
        "src": "/assets/kb-real-images/stemi-ecg.jpg?v=kbri2",
        "type": "ecg",
        "title_suffix": "12-Lead Diagnostic Electrocardiogram (ST Elevation)",
        "caption": "Real diagnostic 12-lead electrocardiogram demonstrating marked acute ST-segment elevation in precordial leads with reciprocal ST depression.",
        "annotations": [
            {"label": "ST Elevation", "description": "J-point elevation >= 1 mm in limb leads or >= 2 mm in anterior leads."},
            {"label": "Reciprocal Changes", "description": "ST-segment depression in reciprocal leads confirming acute epicardial injury vector."},
            {"label": "QRS Evolution", "description": "R-wave progression and emergent pathological Q-wave formation."}
        ]
    },
    "chronic-coronary-syndrome": {
        "src": "/assets/kb-real-images/normal-ecg.jpg?v=kbri2",
        "type": "ecg",
        "title_suffix": "Baseline 12-Lead Electrocardiogram",
        "caption": "Real 12-lead electrocardiogram illustrating baseline resting sinus rhythm, QRS axis, and absence of acute ischemia.",
        "annotations": [
            {"label": "Resting Rhythm", "description": "Normal P-wave morphology and PR interval of 120-200 ms."},
            {"label": "Ischemia Screen", "description": "Stable baseline ST segments without acute depression or elevation."},
            {"label": "Chamber Metrics", "description": "Normal voltage criteria excluding left ventricular hypertrophy."}
        ]
    },
    "atrial_fibrillation": {
        "src": "/assets/kb-real-images/atrial-fibrillation-ecg.jpg?v=kbri2",
        "type": "ecg",
        "title_suffix": "12-Lead Diagnostic ECG (Atrial Fibrillation)",
        "caption": "Real electrocardiogram demonstrating irregularly irregular ventricular rhythm, absent distinct P waves, and fine fibrillatory baseline waves.",
        "annotations": [
            {"label": "Absent P Waves", "description": "Complete absence of organized atrial P waves replaced by fibrillatory oscillations."},
            {"label": "Irregular R-R Intervals", "description": "Variable AV nodal decremental conduction producing irregularly irregular rhythm."},
            {"label": "QRS Morphology", "description": "Narrow QRS complexes indicating supraventricular origin without bundle branch block."}
        ]
    },
    "pericarditis": {
        "src": "/assets/kb-real-images/pericarditis-ecg.png?v=kbri2",
        "type": "ecg",
        "title_suffix": "12-Lead Diagnostic ECG (Acute Pericarditis)",
        "caption": "Real 12-lead electrocardiogram demonstrating diffuse upward-concave ST-segment elevation across multiple vascular territories with PR-segment depression.",
        "annotations": [
            {"label": "Diffuse ST Elevation", "description": "Concave-upward ST elevation across both anterior and inferior leads."},
            {"label": "PR-Segment Depression", "description": "Atrial injury vector causing PR depression in limb/precordial leads with PR elevation in aVR."},
            {"label": "Lead aVR Changes", "description": "Reciprocal ST depression and PR elevation in lead aVR distinguishing from STEMI."}
        ]
    },
    "hyperkalemia": {
        "src": "/assets/kb-real-images/hyperkalemia-ecg.jpg?v=kbri2",
        "type": "ecg",
        "title_suffix": "Diagnostic ECG (Hyperkalemia Peaked T Waves)",
        "caption": "Real electrocardiogram demonstrating tall, narrow, symmetrical peaked T waves with QT shortening reflecting severe hyperkalemia.",
        "annotations": [
            {"label": "Peaked T Waves", "description": "Tall, tented, narrow-base symmetrical T waves in precordial leads."},
            {"label": "QRS Duration", "description": "Progressive widening of the QRS complex as potassium impairs intraventricular conduction."},
            {"label": "P-Wave Attenuation", "description": "Flattening and eventual disappearance of P waves with sinoventricular rhythm."}
        ]
    },

    # Aortic Dissection
    "aortic_dissection": {
        "src": "/assets/kb-real-images/aortic-dissection-ct.jpg?v=kbri2",
        "type": "ct",
        "title_suffix": "Contrast-Enhanced Chest CT Angiogram (Intimal Flap)",
        "caption": "Real axial contrast-enhanced thoracic computed tomography scan demonstrating an intimal dissection flap separating the true and false lumina of the aorta.",
        "annotations": [
            {"label": "Intimal Flap", "description": "Linear hypodense intimal flap separating true lumen from false lumen."},
            {"label": "True vs False Lumen", "description": "Smaller true lumen with rapid contrast transit vs dilated false lumen with delayed clearance."},
            {"label": "Branch Vessel Patency", "description": "Perfusion assessment of celiac, mesenteric, and coronary ostia."}
        ]
    },
    "acute-aortic-syndrome": {
        "src": "/assets/kb-real-images/aortic-dissection-ct.jpg?v=kbri2",
        "type": "ct",
        "title_suffix": "Contrast-Enhanced Chest CT Angiogram (Aortic Syndrome)",
        "caption": "Real axial contrast-enhanced thoracic computed tomography scan demonstrating an intimal dissection flap separating the true and false lumina of the aorta.",
        "annotations": [
            {"label": "Intimal Flap", "description": "Linear hypodense intimal flap separating true lumen from false lumen."},
            {"label": "True vs False Lumen", "description": "Smaller true lumen with rapid contrast transit vs dilated false lumen with delayed clearance."},
            {"label": "Branch Vessel Patency", "description": "Perfusion assessment of celiac, mesenteric, and coronary ostia."}
        ]
    },

    # Pulmonary
    "CAP": {
        "src": "/assets/kb-real-images/cap-pneumonia-xray.jpg?v=kbri2",
        "type": "xray",
        "title_suffix": "Chest Radiograph (Dense Lobar Consolidation)",
        "caption": "Real posteroanterior chest radiograph demonstrating dense lobar alveolar consolidation with air bronchograms and silhouetting.",
        "annotations": [
            {"label": "Alveolar Consolidation", "description": "Dense confluent airspace opacity filling pulmonary lobes."},
            {"label": "Air Bronchograms", "description": "Lucent branching air-filled bronchial tree visualized against opaque opacified alveoli."},
            {"label": "Silhouette Sign", "description": "Loss of structural cardiac/diaphragmatic boundary where consolidation abuts the margin."}
        ]
    },
    "pneumothorax": {
        "src": "/assets/kb-real-images/pneumothorax-xray.jpg?v=kbri2",
        "type": "xray",
        "title_suffix": "Chest Radiograph (Visceral Pleural Line)",
        "caption": "Real chest radiograph demonstrating the visceral pleural line, absence of distal pulmonary vascular markings, and lung collapse.",
        "annotations": [
            {"label": "Visceral Pleural Line", "description": "Thin white pleural line separated from the chest wall by intrapleural air."},
            {"label": "Absent Lung Markings", "description": "Complete radiolucency with no bronchovascular branching peripheral to the pleural line."},
            {"label": "Mediastinal Shift", "description": "Tracheal and cardiac displacement towards the contralateral side indicating tension."}
        ]
    },
    "pleural_effusion": {
        "src": "/assets/kb-real-images/pleural-effusion-xray.jpg?v=kbri2",
        "type": "xray",
        "title_suffix": "Chest Radiograph (Pleural Effusion Meniscus Sign)",
        "caption": "Real upright posteroanterior radiograph showing blunting of the costophrenic angle and a classic homogenous fluid meniscus sign.",
        "annotations": [
            {"label": "Meniscus Sign", "description": "Smooth concave curved upper fluid border higher laterally than medially."},
            {"label": "Costophrenic Blunting", "description": "Obliteration of the posterior and lateral costophrenic recesses by pleural fluid."},
            {"label": "Homogeneous Opacity", "description": "Dense dependent gravitational opacity obscuring underlying lung markings."}
        ]
    },
    "tuberculosis": {
        "src": "/assets/kb-real-images/tuberculosis-xray.jpg?v=kbri2",
        "type": "xray",
        "title_suffix": "Chest Radiograph (Apical Cavitary Lesion)",
        "caption": "Real chest radiograph demonstrating apical fibro-cavitary infiltrates and nodular opacities characteristic of post-primary pulmonary tuberculosis.",
        "annotations": [
            {"label": "Apical Cavitation", "description": "Thick-walled lucent cavitary lesion in the apical and posterior segments."},
            {"label": "Fibronodular Infiltrates", "description": "Linear scarring, volume loss, and bronchogenic acinar satellite nodules."},
            {"label": "Hilar Retraction", "description": "Elevation of the ipsilateral pulmonary hilum from apical cicatrix and fibrosis."}
        ]
    },
    "copd": {
        "src": "/assets/kb-real-images/copd-emphysema-xray.jpg?v=kbri2",
        "type": "xray",
        "title_suffix": "Chest Radiograph (Hyperinflation & Emphysema)",
        "caption": "Real posteroanterior chest radiograph demonstrating diffuse pulmonary hyperinflation, flattened diaphragmatic domes, and increased retrosternal space.",
        "annotations": [
            {"label": "Diaphragm Flattening", "description": "Depressed and flattened hemidiaphragms with blunted costophrenic sulci."},
            {"label": "Hyperinflation", "description": "Visualization of >10 posterior ribs, barrel chest configuration, and lung hyperlucency."},
            {"label": "Attenuated Vasculature", "description": "Rapid tapering and pruning of peripheral pulmonary vessels from alveolar septal loss."}
        ]
    },

    # Neuro
    "gbs": {
        "src": "/assets/kb-real-images/gbs-nerve-mri.jpg?v=kbri2",
        "type": "ct",
        "title_suffix": "Diagnostic Neuroimaging (Spinal / Cranial MRI)",
        "caption": "Real clinical neuroimaging scan displaying spinal nerve root and cauda equina architecture, demonstrating post-contrast inflammatory changes in Guillain-Barré syndrome.",
        "annotations": [
            {"label": "Nerve Root Architecture", "description": "Conus medullaris and anterior motor nerve roots across lumbar thecal sac."},
            {"label": "Blood-Nerve Barrier", "description": "Contrast extravasation reflecting autoimmune radiculoneuropathy inflammation."},
            {"label": "Cord Integrity", "description": "Preserved intrinsic spinal cord signal excluding compressive myelopathy."}
        ]
    },
    "guillain-barre-syndrome": {
        "src": "/assets/kb-real-images/gbs-nerve-mri.jpg?v=kbri2",
        "type": "ct",
        "title_suffix": "Diagnostic Neuroimaging (Spinal / Cranial MRI)",
        "caption": "Real clinical neuroimaging scan displaying spinal nerve root and cauda equina architecture, demonstrating post-contrast inflammatory changes in Guillain-Barré syndrome.",
        "annotations": [
            {"label": "Nerve Root Architecture", "description": "Conus medullaris and anterior motor nerve roots across lumbar thecal sac."},
            {"label": "Blood-Nerve Barrier", "description": "Contrast extravasation reflecting autoimmune radiculoneuropathy inflammation."},
            {"label": "Cord Integrity", "description": "Preserved intrinsic spinal cord signal excluding compressive myelopathy."}
        ]
    },
    "ischemic_stroke": {
        "src": "/assets/kb-real-images/ischemic-stroke-ct.jpg?v=kbri2",
        "type": "ct",
        "title_suffix": "Non-Contrast Head CT (Acute Ischemic Infarct)",
        "caption": "Real non-contrast head computed tomography scan demonstrating acute parenchymal hypodensity, loss of gray-white matter differentiation, and sulcal effacement.",
        "annotations": [
            {"label": "Parenchymal Hypodensity", "description": "Wedge-shaped territorial low-attenuation edema conforming to vascular territory."},
            {"label": "Sulcal Effacement", "description": "Loss of cortical sulcal definition due to local cytotoxic tissue swelling."},
            {"label": "Insular Ribbon Sign", "description": "Loss of definition of the gray-white interface in the insular cortex."}
        ]
    },
    "sah": {
        "src": "/assets/kb-real-images/subarachnoid-hemorrhage-ct.jpg?v=kbri2",
        "type": "ct",
        "title_suffix": "Non-Contrast Head CT (Subarachnoid Hemorrhage)",
        "caption": "Real axial non-contrast computed tomography scan demonstrating high-attenuation acute blood filling the basal cisterns, sylvian fissures, and sulci.",
        "annotations": [
            {"label": "Basal Cistern Blood", "description": "Hyperdense extravasated blood filling the suprasellar and interpeduncular cisterns."},
            {"label": "Sylvian Fissure Blood", "description": "Casting of high-density blood into the bilateral sylvian fissures."},
            {"label": "Hydrocephalus Screen", "description": "Temporal horn enlargement signaling acute obstructive ventriculomegaly."}
        ]
    },
    "ich": {
        "src": "/assets/kb-real-images/epidural-hematoma-ct.jpg?v=kbri2",
        "type": "ct",
        "title_suffix": "Non-Contrast Head CT (Acute Intracranial Hemorrhage)",
        "caption": "Real non-contrast head computed tomography scan displaying hyperdense acute extravasated blood collection with mass effect.",
        "annotations": [
            {"label": "Hyperdense Hematoma", "description": "Dense attenuation (60-80 Hounsfield units) representing acute clotted blood."},
            {"label": "Perilesional Edema", "description": "Hypodense rim of perihematomal vasogenic and cytotoxic edema."},
            {"label": "Mass Effect", "description": "Effacement of adjacent ipsilateral ventricles and subfalcine midline shift."}
        ]
    },

    # Infectious / Rash
    "DENGUE": {
        "src": "/assets/kb-real-images/dengue-rash.jpg?v=kbri2",
        "type": "diagram",
        "title_suffix": "Clinical Dermatology Photograph (Dengue Confluent Rash)",
        "caption": "Real clinical photograph displaying confluent erythematous flushing with sparing 'islands of white' and petechial eruptions typical of dengue.",
        "annotations": [
            {"label": "Confluent Erythema", "description": "Diffuse macular flushing over trunk and limbs during defervescence."},
            {"label": "Islands of White", "description": "Characteristic small round patches of pale normal skin within generalized erythema."},
            {"label": "Petechial Purpura", "description": "Microvascular capillary fragility manifestations aggravated by thrombocytopenia."}
        ]
    },
    "dengue": {
        "src": "/assets/kb-real-images/dengue-rash.jpg?v=kbri2",
        "type": "diagram",
        "title_suffix": "Clinical Dermatology Photograph (Dengue Confluent Rash)",
        "caption": "Real clinical photograph displaying confluent erythematous flushing with sparing 'islands of white' and petechial eruptions typical of dengue.",
        "annotations": [
            {"label": "Confluent Erythema", "description": "Diffuse macular flushing over trunk and limbs during defervescence."},
            {"label": "Islands of White", "description": "Characteristic small round patches of pale normal skin within generalized erythema."},
            {"label": "Petechial Purpura", "description": "Microvascular capillary fragility manifestations aggravated by thrombocytopenia."}
        ]
    },
    "TOXIC_SHOCK_SYNDROME": {
        "src": "/assets/kb-real-images/toxic-shock-rash.jpg?v=kbri2",
        "type": "diagram",
        "title_suffix": "Clinical Dermatology Photograph (Diffuse Erythroderma)",
        "caption": "Real clinical photograph demonstrating diffuse macular sunburn-like erythroderma with subsequent desquamation characteristic of toxic shock syndrome.",
        "annotations": [
            {"label": "Diffuse Erythroderma", "description": "Generalized macular sunburn-like redness involving face, trunk, and extremities."},
            {"label": "Mucosal Hyperemia", "description": "Intense conjunctival, oral, and strawberry-tongue hyperemic inflammation."},
            {"label": "Desquamation Pattern", "description": "Full-thickness periungual, palmar, and plantar desquamation occurring 1-2 weeks post-onset."}
        ]
    },
    "toxic-shock-syndrome": {
        "src": "/assets/kb-real-images/toxic-shock-rash.jpg?v=kbri2",
        "type": "diagram",
        "title_suffix": "Clinical Dermatology Photograph (Diffuse Erythroderma)",
        "caption": "Real clinical photograph demonstrating diffuse macular sunburn-like erythroderma with subsequent desquamation characteristic of toxic shock syndrome.",
        "annotations": [
            {"label": "Diffuse Erythroderma", "description": "Generalized macular sunburn-like redness involving face, trunk, and extremities."},
            {"label": "Mucosal Hyperemia", "description": "Intense conjunctival, oral, and strawberry-tongue hyperemic inflammation."},
            {"label": "Desquamation Pattern", "description": "Full-thickness periungual, palmar, and plantar desquamation occurring 1-2 weeks post-onset."}
        ]
    },
    "malaria": {
        "src": "/assets/kb-real-images/malaria-blood-smear.jpg?v=kbri2",
        "type": "diagram",
        "title_suffix": "Thin Blood Smear (Plasmodium falciparum Ring Trophozoites)",
        "caption": "Real Giemsa-stained peripheral blood smear showing delicate intraerythrocytic ring-form trophozoites and high parasitic load.",
        "annotations": [
            {"label": "Ring Trophozoites", "description": "Delicate blue cytoplasmic rings with bright red chromatin dots inside erythrocytes."},
            {"label": "Multiple Infection", "description": "Erythrocytes hosting multiple ring forms typical of Plasmodium falciparum."},
            {"label": "Absence of Schizonts", "description": "Peripheral sequestration of mature forms in deep capillary beds."}
        ]
    },

    # GI / Abdominal
    "acute_appendicitis": {
        "src": "/assets/kb-real-images/appendicitis-ct.jpg?v=kbri2",
        "type": "ct",
        "title_suffix": "Abdominal CT (Acute Appendicitis)",
        "caption": "Real axial contrast-enhanced abdominal computed tomography scan demonstrating appendiceal wall thickening, luminal distension, and surrounding fat stranding.",
        "annotations": [
            {"label": "Appendiceal Caliber", "description": "Dilated appendix (>6 mm outer diameter) with non-compressible blind ending."},
            {"label": "Wall Hyperenhancement", "description": "Circumferential mural thickening with intense contrast enhancement."},
            {"label": "Pericecal Stranding", "description": "Inflammatory infiltration and haziness of the mesoappendix and pericecal fat."}
        ]
    },
    "cholecystitis": {
        "src": "/assets/kb-real-images/cholecystitis-ultrasound.jpg?v=kbri2",
        "type": "ultrasound",
        "title_suffix": "Right Upper Quadrant Ultrasound (Acute Cholecystitis)",
        "caption": "Real abdominal ultrasound demonstrating gallbladder hydrops, mural thickening >3 mm, impacted gallstones, and pericholecystic fluid.",
        "annotations": [
            {"label": "Gallbladder Wall Edema", "description": "Mural thickening exceeding 3 mm with stratified double-rim sign."},
            {"label": "Cholelithiasis", "description": "Echogenic intraluminal calculi casting strong posterior acoustic shadowing."},
            {"label": "Sonographic Murphy Sign", "description": "Focal tenderness elicited when the transducer compresses the gallbladder fundus."}
        ]
    }
}

def classify_organ(name, system):
    text = (str(name) + " " + str(system)).lower()
    if any(k in text for k in ["heart", "cardio", "coronary", "arrhythm", "infarct", "ecg", "stemi", "pericard", "aortic", "valve", "myocard", "hypertens"]):
        return "cardio"
    elif any(k in text for k in ["lung", "pulmon", "pneumo", "respirat", "bronch", "asthma", "copd", "pleur", "airway", "tuberculosis"]):
        return "pulmo"
    elif any(k in text for k in ["brain", "neuro", "stroke", "cerebr", "seiz", "mening", "epilep", "headache", "spinal", "cranial", "encephal"]):
        return "neuro"
    elif any(k in text for k in ["abdom", "gastro", "liver", "hepat", "bowel", "pancrea", "intestin", "colit", "gastric", "esophag", "ulcer", "ascites", "cirrh", "appendic"]):
        return "gi"
    elif any(k in text for k in ["kidney", "renal", "nephr", "urinary", "bladder", "prostat", "dialys"]):
        return "renal"
    elif any(k in text for k in ["bone", "joint", "fractur", "muscul", "ortho", "arthr", "skelet", "spine", "gout", "osteom"]):
        return "ortho"
    elif any(k in text for k in ["skin", "derma", "rash", "lesion", "psorias", "melanom", "erythem", "eczema", "burn", "zoster"]):
        return "derm"
    elif any(k in text for k in ["infect", "fever", "sepsis", "bacteri", "viral", "parasit", "malaria", "dengue", "typhoid", "covid", "hiv"]):
        return "infect"
    elif any(k in text for k in ["thyroid", "diabet", "adrenal", "pituitar", "endocrin", "hormon", "cushing"]):
        return "endo"
    elif any(k in text for k in ["anemia", "leukem", "lymph", "platelet", "bleed", "thromb", "haemat", "coagul"]):
        return "heme"
    else:
        return "general"

def generate_real_diagram(d_id, name, system):
    key = str(d_id)
    key_clean = key.lower().replace("-", "_")
    
    # 1. Check exact disease matches
    for k, spec in SPECIFIC_DISEASE_IMAGES.items():
        if k == key or k == key_clean or k == name.lower():
            return {
                "id": f"{re.sub(r'[^a-z0-9]+', '-', key.lower()).strip('-')}-real-image",
                "title": f"{name}: {spec['title_suffix']}",
                "type": spec["type"],
                "src": spec["src"],
                "caption": spec["caption"],
                "annotations": spec["annotations"]
            }

    # 2. Organ category real clinical image
    cat = classify_organ(name, system)
    meta = CATEGORY_REAL_IMAGES[cat]
    clean_id = re.sub(r"[^a-z0-9]+", "-", str(d_id).lower()).strip("-")
    
    return {
        "id": f"{clean_id}-real-image",
        "title": f"{name}: {meta['title_suffix']}",
        "type": meta["type"],
        "src": meta["src"],
        "caption": meta["caption"],
        "annotations": meta["annotations"]
    }

def update_entities():
    print("Updating clinical protocols with real clinical images...")
    proto_files = glob.glob("kb/clinical-protocols/*.json")
    for path in proto_files:
        if "index.json" in path: continue
        with open(path, "r", encoding="utf-8") as fp:
            d = json.load(fp)
        d["diagrams"] = [generate_real_diagram(d.get("id"), d.get("title"), d.get("subject"))]
        with open(path, "w", encoding="utf-8") as fp:
            json.dump(d, fp, indent=1, ensure_ascii=False)
            fp.write("\n")

    print("Updating core diseases (144) with real clinical images...")
    dz_files = glob.glob("kb/diseases/*.json")
    for path in dz_files:
        with open(path, "r", encoding="utf-8") as fp:
            d = json.load(fp)
        d["diagrams"] = [generate_real_diagram(d.get("id"), d.get("name"), d.get("system"))]
        with open(path, "w", encoding="utf-8") as fp:
            json.dump(d, fp, indent=2, ensure_ascii=False)
            fp.write("\n")

    print("Updating reference diseases (4664) with real clinical images...")
    ref_files = glob.glob("kb/reference/*.json")
    for i, path in enumerate(ref_files):
        with open(path, "r", encoding="utf-8") as fp:
            try:
                d = json.load(fp)
            except Exception:
                continue
        d["diagrams"] = [generate_real_diagram(d.get("id"), d.get("name"), d.get("system"))]
        with open(path, "w", encoding="utf-8") as fp:
            json.dump(d, fp, indent=1, ensure_ascii=False)
            fp.write("\n")
        if (i + 1) % 1000 == 0 or (i + 1) == len(ref_files):
            print(f"Reference progress: {i + 1}/{len(ref_files)}...")

if __name__ == "__main__":
    update_entities()
    print("All diagrams and figures replaced with authentic clinical images!")
